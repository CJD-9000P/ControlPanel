"""Persistencia transaccional SQLite; timestamps UTC y snapshots inmutables."""
import json
from pathlib import Path
import sqlite3
import threading
import uuid
from .model import profile, utcnow


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
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
        PRAGMA user_version=1;
        ''')
        # El simulador pierde estado al reiniciar; no inventar continuidad de la cocción.
        with self.lock, self.db:
            active = self.db.execute("SELECT id FROM firings WHERE ended_at IS NULL").fetchall()
            for row in active:
                self.event("interrupted", "system", "Servicio reiniciado: sesión anterior interrumpida; continuidad no confirmada.", row["id"])
            self.db.execute("UPDATE firings SET ended_at=?, status='interrupted' WHERE ended_at IS NULL", (utcnow(),))

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
                rows = self.db.execute("SELECT * FROM events WHERE firing_id=? ORDER BY id DESC LIMIT 300", (firing,))
            else:
                rows = self.db.execute("SELECT * FROM events ORDER BY id DESC LIMIT 100")
            return [dict(r) for r in rows]

    def start(self, name, memory, segments, origin):
        ident = uuid.uuid4().hex
        with self.lock, self.db:
            self.db.execute("INSERT INTO firings VALUES(?,?,?,?,?,?,?,?)",
                            (ident, name, utcnow(), None, "running", memory, json.dumps(segments), origin))
        return ident

    def finish(self, ident):
        with self.lock, self.db:
            self.db.execute("UPDATE firings SET ended_at=?,status='ended' WHERE id=?", (utcnow(), ident))

    def record(self, firing, state):
        with self.lock, self.db:
            self.db.execute('''INSERT INTO readings(firing_id,timestamp,pv,sv,state,step,minutes,memory)
                               VALUES(?,?,?,?,?,?,?,?)''',
                            (firing, state["timestamp"], state["pv"], state["sv"], state["state"],
                             state["step"], state["minutes"], state["memory"]))
            self.db.execute("UPDATE firings SET status=? WHERE id=?", ("paused" if state["state"] == 2 else "running", firing))

    def firings(self):
        with self.lock:
            return [dict(r) for r in self.db.execute('''SELECT f.*, (SELECT count(*) FROM readings r
              WHERE r.firing_id=f.id) AS samples FROM firings f ORDER BY started_at DESC''')]

    def firing(self, ident, chart=False):
        with self.lock:
            row = self.db.execute("SELECT * FROM firings WHERE id=?", (ident,)).fetchone()
            if row is None:
                raise KeyError("Cocción no encontrada.")
            data = dict(row)
            data["snapshot"] = json.loads(data["snapshot"])
            # Reducir solo la gráfica; CSV siempre conserva todas las lecturas.
            total = self.db.execute("SELECT count(*) FROM readings WHERE firing_id=?", (ident,)).fetchone()[0]
            stride = max(1, (total + 1999) // 2000) if chart else 1
            data["readings"] = [dict(r) for r in self.db.execute('''SELECT * FROM (
              SELECT *,row_number() OVER(ORDER BY id) AS n FROM readings WHERE firing_id=?)
              WHERE (n-1) % ? = 0 OR n=? ORDER BY id''', (ident, stride, total))]
            data["events"] = self.events(ident)
            data["samples"] = total
            return data

    def backup(self, destination):
        with self.lock:
            with sqlite3.connect(destination) as target:
                self.db.backup(target)

    def close(self):
        with self.lock:
            self.db.close()
