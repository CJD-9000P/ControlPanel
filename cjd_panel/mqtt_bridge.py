"""Puente MQTT opcional: contrato histórico, un solo worker RTU y confirmaciones."""
from concurrent.futures import CancelledError
from dataclasses import dataclass, field
from datetime import datetime, timezone
import importlib
import json
import math
from pathlib import Path
import queue
import re
import sqlite3
import sys
import threading
import time
import uuid

from . import __version__
from .model import integer, profile, utcnow
from .modbus import CommunicationError


@dataclass(frozen=True)
class MQTTConfig:
    host: str
    port: int = 1883
    username: str = field(default='', repr=False)
    password: str = field(default='', repr=False)
    topic_prefix: str = 'horno/cjd9000p'
    client_id: str = 'cjd-control-panel-local'
    discovery_prefix: str = 'homeassistant'
    device_id: str = 'cjd9000p_local'
    tls: bool = False

    def __post_init__(self):
        if not isinstance(self.host, str) or not self.host.strip():
            raise ValueError('Falta el host MQTT.')
        integer(self.port, 'Puerto MQTT', 1, 65535)
        for name in ('topic_prefix', 'discovery_prefix'):
            value = getattr(self, name)
            if not isinstance(value, str) or not value or any(c in value for c in '#+\0') or value.endswith('/'):
                raise ValueError(f'{name} MQTT no válido.')
        for name in ('device_id', 'client_id'):
            if not isinstance(getattr(self, name), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', getattr(self, name)):
                raise ValueError(f'{name} MQTT no válido.')
        if type(self.tls) is not bool or not isinstance(self.username, str) or not isinstance(self.password, str):
            raise ValueError('Configuración MQTT no válida.')

    @classmethod
    def read(cls, path):
        try:
            data = json.loads(Path(path).read_text())
            return cls(**data)
        except (OSError, ValueError, TypeError) as exc:
            raise ValueError('No se pudo cargar la configuración MQTT; revisa el archivo privado.') from None


def paho_client(config):
    # Una instalación local opcional no modifica el Python del sistema.
    try:
        mqtt = importlib.import_module('paho.mqtt.client')
    except ModuleNotFoundError:
        directory = Path(__file__).resolve().parent.parent / '.mqtt-deps'
        if directory.is_dir():
            sys.path.insert(0, str(directory))
        try:
            mqtt = importlib.import_module('paho.mqtt.client')
        except ModuleNotFoundError:
            raise RuntimeError('Falta paho-mqtt: instala requirements-mqtt.txt para activar MQTT.') from None
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=config.client_id,
                         clean_session=True, protocol=mqtt.MQTTv311)
    if config.username:
        client.username_pw_set(config.username, config.password)
    if config.tls:
        client.tls_set()
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.max_queued_messages_set(256)
    client.max_inflight_messages_set(20)
    client.will_set(config.topic_prefix+'/mqtt/availability', 'offline', qos=1, retain=True)
    return client


class CommandJournal:
    """Deduplicación persistente; nunca reanudar órdenes tras reiniciar el proceso."""
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY,received REAL,status TEXT)')
        with self.db:
            self.db.execute("UPDATE commands SET status='outcome_unknown' WHERE status IN ('accepted','executing')")

    def claim(self, ident):
        with self.lock, self.db:
            self.db.execute('DELETE FROM commands WHERE received < ?', (time.time()-86400,))
            if self.db.execute('SELECT 1 FROM commands WHERE id=?', (ident,)).fetchone():
                return False
            if self.db.execute('SELECT count(*) FROM commands').fetchone()[0] >= 2048:
                raise ValueError('Registro de órdenes lleno; espera a que caduquen las entradas.')
            self.db.execute('INSERT INTO commands VALUES(?,?,?)', (ident, time.time(), 'accepted'))
            return True

    def status(self, ident, status):
        with self.lock, self.db:
            self.db.execute('UPDATE commands SET status=? WHERE id=?', (status, ident))

    def close(self):
        with self.lock:
            self.db.close()


ACTIONS = {'run/set': ('run', 'run'), 'stop/set': ('stop', 'stop'),
           'pause/set': ('pause', 'pause'), 'resume/set': ('resume', 'resume'),
           'curva/activa/set': ('seleccionar_curva', 'select'),
           'curva/set': ('escritura_curva', 'load_segments')}


def decode_command(suffix, raw, retained=False):
    if retained:
        raise ValueError('retained_action_rejected: no se ejecutan órdenes retenidas.')
    if len(raw) > 65536:
        raise ValueError('Mensaje MQTT demasiado grande.')
    data = json.loads(raw.decode('utf-8')) if raw else {}
    if not isinstance(data, dict):
        raise ValueError('El mensaje MQTT debe ser un objeto JSON.')
    if suffix == 'curvas/get':
        return 'read', {}, None, None
    command, operation = ACTIONS[suffix]
    ident = data.get('command_id')
    if not isinstance(ident, str) or not ident.strip() or len(ident) > 128:
        raise ValueError('missing_command_id: falta command_id.')
    if data.get('command') != command:
        raise ValueError('invalid_command: la orden no coincide con el tema MQTT.')
    stamp = data.get('issued_at')
    if not isinstance(stamp, str):
        raise ValueError('issued_at debe incluir fecha y zona horaria.')
    issued = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    if issued.tzinfo is None:
        raise ValueError('issued_at debe incluir zona horaria.')
    ttl = integer(data.get('ttl_seconds'), 'ttl_seconds', 1, 120)
    age = (datetime.now(timezone.utc)-issued).total_seconds()
    if not math.isfinite(age) or age < -15 or age > ttl:
        raise ValueError('command_expired: fecha futura o caducada.')
    payload = {}
    if operation == 'run' and ('segmentos' in data or 'profile_id' in data):
        raise ValueError('Carga la curva por separado antes de RUN; no se acepta una carga implícita.')
    if operation in ('run', 'select', 'load_segments'):
        memory = data.get('memoria_destino', data.get('memoria')) if operation == 'load_segments' else data.get('memoria')
        if operation == 'load_segments' and 'memoria_destino' in data and 'memoria' in data and data['memoria_destino'] != data['memoria']:
            raise ValueError('Memorias de destino contradictorias.')
        payload['memory'] = integer(memory, 'Memoria', 1, 4)
    if operation == 'load_segments':
        segments = data.get('segmentos')
        if not isinstance(segments, list) or len(segments) != 20:
            raise ValueError('La curva MQTT debe contener 20 segmentos.')
        normalized = []
        for i, segment in enumerate(segments, 1):
            if not isinstance(segment, dict) or segment.get('segmento', i) != i:
                raise ValueError('Los segmentos MQTT deben estar ordenados de 1 a 20.')
            normalized.append({'temperature': segment.get('temperatura'), 'minutes': segment.get('tiempo')})
        payload['segments'] = profile({'name': data.get('nombre') or 'Curva de Home Assistant',
                                       'segments': normalized})['segments']
    return operation, payload, ident.strip(), time.monotonic()+max(0, ttl-age)


class MQTTBridge:
    def __init__(self, worker, store, config, journal_path, client=None):
        self.worker, self.store, self.config = worker, store, config
        self.client = client if client is not None else paho_client(config)
        self.journal = CommandJournal(journal_path)
        self.store.enable_mqtt_history()
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.connected = False
        self.ready = False
        self.generation = 0
        self.error = None
        self.last_published = None
        self.pending = {}
        self.results = queue.Queue(maxsize=128)
        self.event_cursor = max((e['id'] for e in store.events()), default=0)
        self.last_memories = None
        self.history_inflight = None
        self.last_mode = None
        self.thread = threading.Thread(target=self._run, name='mqtt-bridge', daemon=True)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_connect_fail = self._on_connect_fail
        self.client.on_subscribe = self._on_subscribe
        self.client.on_message = self._on_message

    def snapshot(self):
        with self.lock:
            return dict(enabled=True, connected=self.connected, subscribed=self.ready,
                        host=self.config.host, port=self.config.port, topic_prefix=self.config.topic_prefix,
                        error=self.error, last_published=self.last_published, mode=self.worker.snapshot(compact=True).get('mode','simulator'),
                        history_pending=self.store.mqtt_history_pending())

    def start(self):
        self.client.connect_async(self.config.host, self.config.port, keepalive=20)
        self.client.loop_start()
        self.thread.start()

    def _set_connection(self, connected, error=None):
        with self.lock:
            self.connected, self.ready, self.error = connected, False, error
            self.generation += 1
            self.last_memories = None
            pending = list(self.pending.values()) if not connected else []
        for future in pending:
            future.cancel()

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code != 0:
            self._set_connection(False, 'Broker MQTT rechazó la conexión.')
            return
        self._set_connection(True)
        topics = [(self.config.topic_prefix+'/'+suffix, 1) for suffix in (*ACTIONS, 'curvas/get')]
        topics.append((self.config.discovery_prefix+'/status', 1))
        rc, mid = client.subscribe(topics)
        if rc:
            self._set_connection(False, 'No se pudo solicitar la suscripción MQTT.')
            client.disconnect()

    def _on_subscribe(self, client, userdata, mid, reason_codes, properties):
        if any(getattr(code, 'is_failure', False) or (isinstance(code, int) and code >= 128) for code in reason_codes):
            self._set_connection(False, 'El broker rechazó una suscripción MQTT.')
            client.disconnect()
            return
        with self.lock:
            self.ready = self.connected
        self._publish('mqtt/availability', 'online', retain=True)
        self._discovery()
        self.publish_state()

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        self._set_connection(False, 'MQTT desconectado; el control local sigue disponible.')

    def _on_connect_fail(self, client, userdata):
        self._set_connection(False, 'Broker MQTT no disponible; se reintentará la conexión.')

    def _publish(self, suffix, payload, retain=False, qos=1):
        if not self.connected:
            return None
        text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False, allow_nan=False)
        return self.client.publish(self.config.topic_prefix+'/'+suffix, text, qos=qos, retain=retain)

    def _result(self, ident, command, status, code, message):
        self._publish('event', dict(evento='RESULTADO_ORDEN', tipo='ORDEN', timestamp=utcnow(),
            hora=datetime.now().strftime('%H:%M:%S'), command_id=ident, command=command,
            status=status, code=code, mensaje=message, mode=self.worker.snapshot(compact=True).get('mode','simulator'),
            ok=status=='succeeded'), retain=False)

    def _on_message(self, client, userdata, message):
        if self.stop_event.is_set():
            return
        if message.topic == self.config.discovery_prefix+'/status':
            if message.payload == b'online':
                self._discovery()
                self.publish_state()
            return
        prefix = self.config.topic_prefix+'/'
        if not message.topic.startswith(prefix):
            return
        suffix = message.topic[len(prefix):]
        if suffix not in ACTIONS and suffix != 'curvas/get':
            return
        ident = None
        command = ACTIONS.get(suffix, ('curvas_get',))[0]
        try:
            if len(message.payload) <= 65536:
                candidate = json.loads(message.payload.decode('utf-8')) if message.payload else {}
                if isinstance(candidate, dict) and isinstance(candidate.get('command_id'), str) and len(candidate['command_id']) <= 128:
                    ident = candidate['command_id']
            operation, payload, ident, deadline = decode_command(suffix, message.payload, message.retain)
            if not self.ready or not self.worker.snapshot(compact=True)['online']:
                raise ValueError('modbus_offline: el programador no está sincronizado.')
            if ident is not None and not self.journal.claim(ident):
                self._result(ident, command, 'duplicate', 'duplicate_command', 'Orden ya recibida; no se repite.')
                return
            with self.lock:
                if len(self.pending) >= 32:
                    raise ValueError('Hay demasiadas órdenes MQTT pendientes.')
            generation = self.generation
            future = self.worker.submit(operation, payload, origin='mqtt', deadline=deadline,
                                        guard=lambda: self.ready and self.generation == generation)
            key = ident or uuid.uuid4().hex
            with self.lock:
                self.pending[key] = future
            if ident:
                self._result(ident, command, 'accepted', 'ok', 'Orden recibida; pendiente de verificar en RTU.')
            future.add_done_callback(lambda f: self.results.put_nowait((key, ident, command, f)))
        except (ValueError, KeyError, UnicodeError) as exc:
            if ident:
                self.journal.status(ident, 'rejected')
            self._result(ident, command, 'rejected', 'invalid_command', str(exc))

    def _drain_results(self):
        while True:
            try:
                key, ident, command, future = self.results.get_nowait()
            except queue.Empty:
                break
            with self.lock:
                self.pending.pop(key, None)
            status, code, message = 'succeeded', 'ok', 'Orden confirmada por relectura RTU.'
            try:
                future.result()
            except CancelledError:
                status, code, message = 'cancelled', 'cancelled_on_disconnect', 'Orden no iniciada cancelada al desconectar.'
            except CommunicationError:
                status, code, message = 'failed', 'outcome_unknown', 'Sin confirmación RTU; consulta el estado antes de repetir.'
            except Exception as exc:
                status, code, message = 'rejected', 'command_rejected', str(exc)
            if ident:
                self.journal.status(ident, status)
                self._result(ident, command, status, code, message)
            self.last_memories = None
            self.publish_state()

    def publish_state(self):
        if not self.connected or not self.ready:
            return
        s = self.worker.snapshot(compact=True)
        online = s['online']
        state = s.get('state') if online else None
        self._publish('modbus/availability', 'online' if online else 'offline', retain=True)
        self._publish('status', dict(mqtt='online', modbus='online' if online else 'offline',
                                    mode=s.get('mode','simulator'), version=__version__), retain=True)
        for action, allowed in [('run',{0}), ('pause',{1}), ('resume',{2}), ('stop',{1,2})]:
            self._publish('controls/'+action+'/availability', 'online' if state in allowed else 'offline', retain=True)
        if not online:
            return
        self._publish('state', dict(timestamp=s['timestamp'], pv=s['pv'], sv=s['sv'],
            segmento=s['step'], estado=state, estado_texto=['PARADO','FUNCIONANDO','PAUSADO'][state],
            tiempo_cjd=s['minutes'], memoria=s['memory'], mode=s.get('mode','simulator'), version=__version__), qos=0)
        self._publish('config', dict(curva=s['memory'], spc=s['memory'], cyc=s['cyc'], dp=s['dp'], mode=s.get('mode','simulator'), version=__version__), retain=True)
        memories = dict(version=__version__, memoria_activa=s['memory'], mode=s.get('mode','simulator'),
            memorias={str(i):[dict(segmento=n+1, temperatura=p['temperature'], tiempo=p['minutes'])
                for n,p in enumerate(points)] for i,points in s['memories'].items()})
        signature = json.dumps(memories, sort_keys=True)
        if signature != self.last_memories:
            self._publish('curva', memories, retain=True)
            self.last_memories = signature
        self.last_published = utcnow()

    def _discovery(self):
        cfg = self.config
        device = dict(identifiers=[cfg.device_id], name='CJD Control Panel',
                      manufacturer='CJD Control Panel', model='CJD-9000P · '+self.worker.snapshot(compact=True).get('mode','simulator'), sw_version=__version__)
        availability = [dict(topic=cfg.topic_prefix+'/mqtt/availability'),
                        dict(topic=cfg.topic_prefix+'/modbus/availability')]
        def send(component, key, data):
            base = dict(unique_id=cfg.device_id+'_'+key, device=device, availability=availability,
                        availability_mode='all')
            base.update(data)
            self.client.publish(f'{cfg.discovery_prefix}/{component}/{cfg.device_id}/{key}/config',
                                json.dumps(base, ensure_ascii=False), qos=1, retain=True)
        for key, name, unit in [('pv','Temperatura actual','°C'),('sv','Consigna','°C'),
            ('segmento','Tramo',None),('tiempo_cjd','Tiempo del tramo','min'),
            ('memoria','Memoria activa',None),('estado_texto','Estado',None)]:
            data = dict(name=name, state_topic=cfg.topic_prefix+'/state',
                        value_template='{{ value_json.'+key+' }}', expire_after=30)
            if unit:
                data['unit_of_measurement'] = unit
            if key in ('pv','sv'):
                data.update(device_class='temperature', state_class='measurement')
            send('sensor', key, data)
        for command, memory in [('run',i) for i in range(1,5)]+[(c,None) for c in ('pause','resume','stop')]:
            key = command+('_'+str(memory) if memory else '')
            names = dict(run='Iniciar memoria '+str(memory), pause='Pausar', resume='Reanudar', stop='Parar')
            template = "{{ {'command': '"+command+"', 'command_id': 'ha-"+key+"-' ~ now().strftime('%Y%m%d%H%M%S%f'), 'issued_at': now().isoformat(), 'ttl_seconds': 30"
            if memory:
                template += ", 'memoria': "+str(memory)
            template += '} | tojson }}'
            send('button', key, dict(name=names[command], command_topic=cfg.topic_prefix+'/'+command+'/set',
                 command_template=template, payload_press='PRESS', qos=1, retain=False,
                 availability=availability+[dict(topic=cfg.topic_prefix+'/controls/'+command+'/availability')]))

    def _publish_history(self):
        # QoS 1: no quitar de SQLite hasta recibir PUBACK del broker.
        # Una caída entre PUBACK y DELETE puede duplicar el mismo event_id/run_id.
        if not self.connected or not self.ready:
            return
        for item in self.store.mqtt_history_batch():
            if self.stop_event.is_set() or not self.connected or not self.ready:
                break
            if self.history_inflight is not None and self.history_inflight[0] == item['sequence']:
                info = self.history_inflight[1]
            else:
                info = self._publish(item['topic'], item['payload'], retain=False, qos=1)
                if info is None or info.rc != 0:
                    break
                self.history_inflight = (item['sequence'], info)
            try:
                info.wait_for_publish(timeout=1)
                if not info.is_published():
                    break
            except (RuntimeError, ValueError):
                break
            self.store.mqtt_history_ack(item['sequence'])
            self.history_inflight = None

    def _run(self):
        while not self.stop_event.is_set():
            try:
                self._drain_results()
                mode = self.worker.snapshot(compact=True).get('mode','simulator')
                if self.connected and self.ready and mode != self.last_mode:
                    self._discovery()
                    self.last_mode = mode
                self._publish_history()
                self.publish_state()
                if self.connected and self.ready:
                    events = self.store.events()
                    for event in sorted((e for e in events if e['id'] > self.event_cursor), key=lambda e:e['id']):
                        self._publish('event', dict(evento=event['kind'], tipo='EVENTO', mensaje=event['message'],
                            timestamp=event['timestamp'], origen=event['origin'], coccion_id=event['firing_id'],
                            mode=mode))
                        self.event_cursor = event['id']
            except Exception:
                with self.lock:
                    self.error = 'Error al publicar MQTT; el control local sigue disponible.'
            self.stop_event.wait(1)

    def close(self):
        self.stop_event.set()
        with self.lock:
            self.ready = False
            self.generation += 1
            futures = list(self.pending.values())
        for future in futures:
            future.cancel()
        if self.thread.is_alive():
            self.thread.join(4)
        self._drain_results()
        if self.connected:
            self._publish('modbus/availability', 'offline', retain=True)
            info = self._publish('mqtt/availability', 'offline', retain=True)
            if info is not None:
                try:
                    info.wait_for_publish(timeout=2)
                except (RuntimeError, ValueError):
                    pass
        self.client.disconnect()
        self.client.loop_stop()
        self.journal.close()
