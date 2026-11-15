"""Persistencia transaccional SQLite; timestamps UTC y snapshots inmutables."""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import threading
import uuid
from .model import profile, utcnow
from .analysis import summarize, curve_key, chart_data


SCHEMA_VERSION = 4


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.mqtt_history_enabled = False
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        schema = self.db.execute('PRAGMA user_version').fetchone()[0]
        if schema > SCHEMA_VERSION:
            self.db.close()
            raise ValueError('La base usa un esquema posterior; utiliza una versión compatible del panel.')
        if 0 < schema < SCHEMA_VERSION:
            backup = self.path.with_name(self.path.name + f'.pre-schema-{SCHEMA_VERSION}.bak')
            if not backup.exists():
                with closing(sqlite3.connect(backup)) as target:
                    self.db.backup(target)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, notes TEXT NOT NULL,
          segments TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS firings (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, started_at TEXT NOT NULL,
          ended_at TEXT, status TEXT NOT NULL, memory INTEGER NOT NULL,
          snapshot TEXT NOT NULL, origin TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS readings (
          id INTEGER PRIMARY KEY, firing_id TEXT REFERENCES firings(id),
          timestamp TEXT NOT NULL, pv REAL NOT NULL, sv REAL NOT NULL,
          state INTEGER NOT NULL, step INTEGER NOT NULL, minutes INTEGER NOT NULL,
          memory INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS readings_firing_time ON readings(firing_id,timestamp);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY, firing_id TEXT REFERENCES firings(id),
          timestamp TEXT NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL,
          message TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_firing ON events(firing_id,id);
        CREATE TABLE IF NOT EXISTS mqtt_history_runs (run_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS mqtt_history_outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          topic TEXT NOT NULL, payload TEXT NOT NULL);

        ''')
        # Migración aditiva del esquema inicial; no elimina perfiles ni lecturas.
        with self.lock, self.db:
            columns = {r['name'] for r in self.db.execute('PRAGMA table_info(firings)')}
            if 'notes' not in columns:
                self.db.execute("ALTER TABLE firings ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
            if 'curve_name' not in columns:
                self.db.execute("ALTER TABLE firings ADD COLUMN curve_name TEXT NOT NULL DEFAULT ''")
                self.db.execute("UPDATE firings SET curve_name=name")
            if 'mode' not in columns:
                self.db.execute("ALTER TABLE firings ADD COLUMN mode TEXT NOT NULL DEFAULT 'simulator'")
            self.db.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
        # No asumir continuidad tras reiniciar la app; no se envía STOP ni RUN al CJD.
        with self.lock, self.db:
            active = self.db.execute("SELECT id FROM firings WHERE ended_at IS NULL").fetchall()
            for row in active:
                self.event("interrupted", "system", "Servicio reiniciado: sesión anterior interrumpida; continuidad no confirmada.", row["id"])
            stamp = utcnow()
            self.db.execute("UPDATE firings SET ended_at=?, status='interrupted' WHERE ended_at IS NULL", (stamp,))
            for row in active:
                self._queue_firing_end(row['id'], stamp, confirmed=False, reason='servicio_reiniciado')

    def profiles(self):
        with self.lock:
            return [self._profile(r) for r in self.db.execute("SELECT * FROM profiles ORDER BY name COLLATE NOCASE")]

    @staticmethod
    def _profile(row):
        result = dict(row)
        result["segments"] = json.loads(result["segments"])
        return result

    def get_profile(self, ident):
        with self.lock:
            row = self.db.execute("SELECT * FROM profiles WHERE id=?", (ident,)).fetchone()
            if row is None:
                raise KeyError("Curva no encontrada.")
            return self._profile(row)

    def save_profile(self, data, ident=None):
        clean = profile(data)
        with self.lock, self.db:
            if ident:
                self.get_profile(ident)
            ident = ident or uuid.uuid4().hex
            self.db.execute('''INSERT INTO profiles VALUES (?,?,?,?,?) ON CONFLICT(id)
              DO UPDATE SET name=excluded.name,notes=excluded.notes,
              segments=excluded.segments,updated_at=excluded.updated_at''',
              (ident, clean["name"], clean["notes"], json.dumps(clean["segments"]), utcnow()))
        return self.get_profile(ident)

    def delete_profile(self, ident):
        with self.lock, self.db:
            self.get_profile(ident)
            self.db.execute("DELETE FROM profiles WHERE id=?", (ident,))

    def event(self, kind, origin, message, firing=None):
        with self.lock, self.db:
            self.db.execute("INSERT INTO events(firing_id,timestamp,kind,origin,message) VALUES(?,?,?,?,?)",
                            (firing, utcnow(), kind, origin, message))

    def events(self, firing=None):
        with self.lock:
            if firing:
                rows = self.db.execute("SELECT * FROM events WHERE firing_id=? ORDER BY id DESC", (firing,))
            else:
                rows = self.db.execute("SELECT * FROM events ORDER BY id DESC LIMIT 100")
            return [dict(r) for r in rows]

    def start(self, name, memory, segments, origin, *, mode="simulator"):
        if mode not in ('simulator','physical'):
            raise ValueError('Origen de cocción no válido.')
        ident = uuid.uuid4().hex
        with self.lock, self.db:
            self.db.execute("INSERT INTO firings(id,name,started_at,ended_at,status,memory,snapshot,origin,curve_name) VALUES(?,?,?,?,?,?,?,?,?)",
                            (ident, name, utcnow(), None, "running", memory, json.dumps(segments), origin, name))
            self.db.execute('UPDATE firings SET mode=? WHERE id=?',(mode,ident))
            if self.mqtt_history_enabled:
                self._announce_firing(ident)
        return ident

    def finish(self, ident):
        with self.lock, self.db:
            row = self.db.execute('SELECT ended_at FROM firings WHERE id=?', (ident,)).fetchone()
            if row is None or row['ended_at'] is not None:
                return
            stamp = utcnow()
            self.db.execute("UPDATE firings SET ended_at=?,status='ended' WHERE id=?", (stamp, ident))
            self._queue_firing_end(ident, stamp, confirmed=True, reason='parado')

    def record(self, firing, state):
        with self.lock, self.db:
            previous = self.db.execute('SELECT status FROM firings WHERE id=?', (firing,)).fetchone()
            self.db.execute('''INSERT INTO readings(firing_id,timestamp,pv,sv,state,step,minutes,memory)
                               VALUES(?,?,?,?,?,?,?,?)''',
                            (firing, state["timestamp"], state["pv"], state["sv"], state["state"],
                             state["step"], state["minutes"], state["memory"]))
            self.db.execute("UPDATE firings SET status=? WHERE id=?", ("paused" if state["state"] == 2 else "running", firing))
            if self._mqtt_run(firing) and state['state'] in (1, 2):
                base = dict(run_id=firing, timestamp=state['timestamp'], memoria=state['memory'])
                if state['state'] == 2 and previous and previous['status'] != 'paused':
                    self._queue_mqtt('coccion/event', dict(base, tipo='PAUSA'))
                elif state['state'] == 1 and previous and previous['status'] == 'paused':
                    self._queue_mqtt('coccion/event', dict(base, tipo='REANUDACION'))
                self._queue_mqtt('coccion/state', dict(base, pv=state['pv'], sv=state['sv'],
                    segmento=state['step'], estado=state['state'],
                    estado_texto=['PARADO', 'FUNCIONANDO', 'PAUSADO'][state['state']],
                    tiempo_cjd=state['minutes']))

    def _mqtt_run(self, ident):
        return self.db.execute('SELECT 1 FROM mqtt_history_runs WHERE run_id=?', (ident,)).fetchone() is not None

    def _queue_mqtt(self, topic, payload):
        # Invocar dentro de la misma transacción que guarda inicio/lectura/cierre.
        row = self.db.execute('SELECT mode FROM firings WHERE id=?',(payload['run_id'],)).fetchone()
        payload = dict(payload, mode=row['mode'] if row else payload.get('mode','simulator'))
        cursor = self.db.execute('INSERT INTO mqtt_history_outbox(topic,payload) VALUES(?,?)',
                                 (topic, json.dumps(payload, ensure_ascii=False)))
        payload['event_id'] = f"local:{payload['run_id']}:{cursor.lastrowid}"
        self.db.execute('UPDATE mqtt_history_outbox SET payload=? WHERE sequence=?',
                        (json.dumps(payload, ensure_ascii=False), cursor.lastrowid))

    def _announce_firing(self, ident):
        if self._mqtt_run(ident):
            return
        row = self.db.execute('SELECT * FROM firings WHERE id=?', (ident,)).fetchone()
        if row is None:
            return
        self.db.execute('INSERT INTO mqtt_history_runs(run_id) VALUES(?)', (ident,))
        segments = json.loads(row['snapshot'])
        self._queue_mqtt('coccion/event', dict(tipo='INICIO', run_id=ident,
            timestamp=row['started_at'], inicio=row['started_at'], memoria=row['memory'],
            nombre_curva=row['curve_name'] or row['name'], perfil_id=None, csv=None,
            segmentos=[dict(segmento=i+1, temperatura=p['temperature'], tiempo=p['minutes'])
                       for i,p in enumerate(segments)]))

    def _queue_firing_end(self, ident, stamp, *, confirmed, reason):
        if not self._mqtt_run(ident):
            return
        firing = self.db.execute('SELECT memory FROM firings WHERE id=?', (ident,)).fetchone()
        last = self.db.execute('SELECT timestamp FROM readings WHERE firing_id=? ORDER BY id DESC LIMIT 1', (ident,)).fetchone()
        self._queue_mqtt('coccion/event', dict(tipo='FIN', run_id=ident, timestamp=stamp,
            memoria=firing['memory'], motivo=reason, confirmado=confirmed,
            descartada=False, clasificacion='coccion', ultima_lectura=last['timestamp'] if last else None))

    def enable_mqtt_history(self):
        with self.lock, self.db:
            self.mqtt_history_enabled = True
            for row in self.db.execute('SELECT id FROM firings WHERE ended_at IS NULL').fetchall():
                self._announce_firing(row['id'])

    def mqtt_history_batch(self, limit=32):
        with self.lock:
            return [dict(r) for r in self.db.execute(
                'SELECT * FROM mqtt_history_outbox ORDER BY sequence LIMIT ?', (limit,))]

    def mqtt_history_ack(self, sequence):
        with self.lock, self.db:
            self.db.execute('DELETE FROM mqtt_history_outbox WHERE sequence=?', (sequence,))

    def mqtt_history_pending(self):
        with self.lock:
            return self.db.execute('SELECT count(*) FROM mqtt_history_outbox').fetchone()[0]

    def firings(self):
        with self.lock:
            rows = self.db.execute('''SELECT f.*, coalesce(r.samples,0) AS samples,
              r.pv_max,r.first_reading,r.last_reading FROM firings f LEFT JOIN
              (SELECT firing_id,count(*) AS samples,max(pv) AS pv_max,
              min(timestamp) AS first_reading,max(timestamp) AS last_reading
              FROM readings GROUP BY firing_id) r ON r.firing_id=f.id ORDER BY f.started_at DESC''').fetchall()
            data = []
            for row in rows:
                item = dict(row)
                item['curve_key'] = curve_key(json.loads(item.pop('snapshot')))
                data.append(item)
            return data

    def update_firing(self, ident, data):
        if not isinstance(data, dict):
            raise ValueError('Se esperaba nombre y observaciones.')
        name, notes = data.get('name'), data.get('notes')
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError('El nombre es obligatorio y admite hasta 120 caracteres.')
        if not isinstance(notes, str) or len(notes) > 4000:
            raise ValueError('Las observaciones admiten hasta 4000 caracteres.')
        with self.lock, self.db:
            if not self.db.execute('SELECT id FROM firings WHERE id=?', (ident,)).fetchone():
                raise KeyError('Cocción no encontrada.')
            self.db.execute('UPDATE firings SET name=?,notes=? WHERE id=?', (name.strip(), notes, ident))
        return {'id': ident, 'name': name.strip(), 'notes': notes}

    def delete_firing(self, ident):
        with self.lock, self.db:
            row = self.db.execute('SELECT ended_at FROM firings WHERE id=?', (ident,)).fetchone()
            if row is None:
                raise KeyError('Cocción no encontrada.')
            if row['ended_at'] is None:
                raise ValueError('No se puede eliminar una cocción en curso.')
            self.db.execute('DELETE FROM readings WHERE firing_id=?', (ident,))
            self.db.execute('DELETE FROM events WHERE firing_id=?', (ident,))
            self.db.execute('DELETE FROM firings WHERE id=?', (ident,))

    def firing(self, ident, chart=False):
        with self.lock:
            row = self.db.execute("SELECT * FROM firings WHERE id=?", (ident,)).fetchone()
            if row is None:
                raise KeyError("Cocción no encontrada.")
            data = dict(row)
            data["snapshot"] = json.loads(data["snapshot"])
            data['curve_key'] = curve_key(data['snapshot'])
            all_rows = [dict(r) for r in self.db.execute('SELECT * FROM readings WHERE firing_id=? ORDER BY id', (ident,))]
            data['statistics'] = summarize(all_rows)
            # Los huecos y marcas se calculan antes de reducir la gráfica.
            total = len(all_rows)
            data['readings'], data['timeline'] = chart_data(all_rows, reduced=chart)
            data["events"] = self.events(ident)
            data["samples"] = total
            return data

    def backup(self, destination):
        with self.lock:
            with closing(sqlite3.connect(destination)) as target:
                self.db.backup(target)

    def close(self):
        with self.lock:
            self.db.close()
