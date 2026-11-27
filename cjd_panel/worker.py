"""Único propietario Modbus: sondeo, cola de órdenes y confirmación por relectura."""
from collections import deque
from concurrent.futures import Future
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import queue
import threading
import time
from .model import integer, profile, utcnow
from .modbus import CommunicationError, MEMORIES


class Worker:
    def __init__(self, adapter, store, interval=1, *, adapter_factory=None, settings_path=None,
                 serial_ports=None, selected_port=None, default_port=None):
        self.adapter, self.store, self.interval = adapter, store, interval
        self.adapter_factory = adapter_factory
        self.serial_ports = serial_ports
        self.selected_port = selected_port
        self.default_port = default_port
        self.settings_path = Path(settings_path) if settings_path else None
        self.mode = getattr(adapter, 'mode', 'simulator')
        self.generation = 0
        self.command_adapter_epoch = None
        self.queue = queue.Queue(maxsize=32)
        self.stop_event = threading.Event()
        self.update_until = 0
        self.lock = threading.RLock()
        self.state = {"online": False, "mode": self.mode, "error": "Conectando con el programador…"}
        self.memories = {}
        self.scheduled = None
        self.recent = deque(maxlen=600)
        self.segment_run_seconds = {}
        self.completed_memory = None
        self.active = None
        self.command_origin = "app"
        self.command_deadline = None
        self.command_guard = None
        self.previous = None
        self.last_success = None
        self.offline_reported = False
        self.freshness_limit = max(10, interval * 3 + getattr(adapter, 'timeout', .8) * 10 + 6)
        self.thread = threading.Thread(target=self._run, name="modbus-worker", daemon=True)

    def start(self):
        self.thread.start()

    def submit(self, operation, payload=None, *, origin="app", deadline=None, guard=None):
        if self.stop_event.is_set():
            raise ValueError('Servicio detenido; no se admiten órdenes.')
        future = Future()
        with self.lock:
            generation = self.generation
        try:
            self.queue.put_nowait((operation, payload or {}, future, origin, deadline, guard, generation))
        except queue.Full:
            raise ValueError("Hay demasiadas órdenes pendientes.")
        return future

    def snapshot(self):
        with self.lock:
            age = None if self.last_success is None else max(0, time.monotonic()-self.last_success)
            result = copy.deepcopy({**self.state, "memories": self.memories,
                                    "recent": list(self.recent), "active_firing": self.active,
                                    "segment_run_seconds": self.segment_run_seconds,
                                    "completed_memory": self.completed_memory})
            status = 'online' if result['online'] else 'offline' if self.offline_reported else 'connecting'
            if result['online'] and (not self.thread.is_alive() or age is None or age > self.freshness_limit):
                result.update(online=False, error='Sin lecturas recientes confirmadas; control bloqueado.')
                status = 'stale'
            result.update(communication_status=status, last_success_age_seconds=age,
                          freshness_limit_seconds=self.freshness_limit, physical_usb_supported=self.adapter_factory is not None or self.mode=='physical',
                          simulator_enabled=self.mode == 'simulator', mode_generation=self.generation,
                          scheduled_start=copy.deepcopy(self.scheduled and {
                              key: self.scheduled[key] for key in ('start_at', 'memory')
                          }),
                          port=getattr(self.adapter, 'port', None),
                          configured_port=self.selected_port or self.default_port,
                          serial_ports=self.serial_ports() if self.serial_ports else [])
            pending = time.monotonic() < self.update_until
            result.update(update_pending=pending, update_idle=(
                result['online'] and result.get('state') == 0 and self.active is None
                and self.scheduled is None and not pending
            ))
            return result

    def _run(self):
        next_poll = 0
        try:
            while not self.stop_event.is_set():
                if time.monotonic() >= next_poll:
                    try:
                        self._poll(refresh_memories=False)
                    except Exception as exc:
                        self._offline(exc)
                    interval = min(self.interval, 0.25) if self.mode == "simulator" else self.interval
                    next_poll = time.monotonic() + interval
                self._start_if_due()
                try:
                    operation, data, future, origin, deadline, guard, generation = self.queue.get(timeout=0.05)
                except queue.Empty:
                    continue
                if not future.set_running_or_notify_cancel():
                    continue
                try:
                    if generation != self.generation and operation != 'read':
                        raise ValueError('Orden cancelada: se cambió el origen de comunicación.')
                    if deadline is not None and time.monotonic() > deadline:
                        raise ValueError('command_expired: la orden caducó en cola.')
                    if guard is not None and not guard():
                        raise ValueError('Orden cancelada: la conexión MQTT cambió antes de ejecutar.')
                    self.command_origin, self.command_deadline, self.command_guard = origin, deadline, guard
                    result = self._execute(operation, data, origin=origin, deadline=deadline, guard=guard)
                    future.set_result(result)
                except Exception as exc:
                    if isinstance(exc, OSError):
                        exc = CommunicationError(f'Error de E/S RTU: {exc}')
                    self.store.event("command_error", origin, f"{operation}: {exc}", self.active)
                    if isinstance(exc, (CommunicationError, OSError)):
                        self._offline(exc)
                    future.set_exception(exc)
                finally:
                    self.command_origin, self.command_deadline, self.command_guard = 'app', None, None
                    self.command_adapter_epoch = None
                next_poll = 0
        finally:
            self.adapter.close()
            while not self.queue.empty():
                _, _, future, _, _, _, _ = self.queue.get_nowait()
                if not future.done():
                    future.set_exception(RuntimeError("Servicio detenido."))

    def _offline(self, exc):
        self._cancel_start("Se perdió la comunicación con el programador.")
        with self.lock:
            was_online = self.state.get("online")
            self.state = {**self.state, "online": False, "error": str(exc)}
        if was_online or not self.offline_reported:
            self.store.event("offline", "observed", str(exc), self.active)
        self.offline_reported = True

    def _memory(self, memory):
        values = self.adapter.read(MEMORIES[memory], 40)
        return [{"temperature": values[i], "minutes": values[i+1]} for i in range(0, 40, 2)]

    def _poll(self, origin="observed", name=None, *, refresh_memories=True):
        v = self.adapter.read(0xC9, 6)
        memory = self.adapter.read(0xA0)[0]
        cyc = self.adapter.read(0xA1)[0]
        dp = self.adapter.read(0xA3)[0]
        if v[1] not in (0, 1, 2) or not 1 <= v[0] <= 20 or memory not in MEMORIES or dp != 0:
            raise CommunicationError("Estado, segmento, memoria o dP no compatibles; se bloquea el control.")
        s = {"online": True, "mode": self.mode, "timestamp": utcnow(), "pv": v[4], "sv": v[5],
             "step": v[0], "state": v[1], "minutes": v[3], "memory": memory, "cyc": cyc, "dp": dp, "error": None}
        memories = self.memories.copy()
        if refresh_memories or not self.state.get("online"):
            to_read = MEMORIES
        elif memory != self.state.get("memory") or (s["state"] in (1, 2) and not self.active):
            to_read = (memory,)
        else:
            to_read = ()
        if to_read:
            memories.update((i, self._memory(i)) for i in to_read)
            # Confirmar el estado y la selección tras leer las curvas.
            latest = self.adapter.read(0xC9, 6)
            latest_memory = self.adapter.read(0xA0)[0]
            latest_dp = self.adapter.read(0xA3)[0]
            if (latest[1] not in (0, 1, 2) or not 1 <= latest[0] <= 20
                    or latest_memory != memory or latest_dp != 0):
                raise CommunicationError('Estado o memoria cambiaron durante la sincronización; esperando nueva lectura.')
            s.update(timestamp=utcnow(), pv=latest[4], sv=latest[5], step=latest[0],
                     state=latest[1], minutes=latest[3])
        if not self.state.get("online"):
            self.store.event("online", "observed", "Comunicación y cuatro memorias sincronizadas.", self.active)
        with self.lock:
            if self.completed_memory is not None and (
                    self.memories.get(self.completed_memory) != memories.get(self.completed_memory)):
                self.completed_memory = None
            if s["state"] in (1, 2) and not self.active:
                self.segment_run_seconds.clear()
                self.completed_memory = None
                self.active = self.store.start(name or f"Memoria {memory}", memory, memories[memory], origin, mode=self.mode)
                self.store.event("started", origin, "Cocción observada y registrada.", self.active)
            if self.previous is not None and s["state"] != self.previous:
                self.store.event("state", origin, f"Estado confirmado: {['PARADO','FUNCIONANDO','PAUSADO'][s['state']]}", self.active)
            now = time.monotonic()
            if self.active:
                previous = self.state
                seconds = self.segment_run_seconds.setdefault(memory, {})
                if s["state"] == 1:
                    seconds.setdefault(s["step"], 0)
                if (previous.get("online") and self.last_success is not None
                    and previous.get("state") == 1 and s["state"] in (0, 1)
                    and previous["memory"] == memory):
                    elapsed = now - self.last_success
                    if 0 < elapsed <= 5:
                        # The next confirmed sample closes the previously observed running interval.
                        step = previous["step"]
                        seconds[step] = seconds.get(step, 0) + elapsed
                self.store.record(self.active, s)
                if s["state"] == 0:
                    completed = getattr(self.adapter, "program_completed", None)
                    if previous.get("memory") == memory and (
                            s["step"] == 20 or (completed and completed(
                                sum(segment["minutes"] for segment in memories[memory])))):
                        self.completed_memory = memory
                    self.store.finish(self.active)
                    self.active = None
            self.previous = s["state"]
            self.state, self.memories = s, memories
            self.last_success = now
            self.offline_reported = False
            self.recent.append(s)
        return s

    def _cancel_start(self, reason):
        with self.lock:
            scheduled, self.scheduled = self.scheduled, None
        if scheduled is not None:
            self.store.event("schedule_cancelled", "system", reason)

    def _start_if_due(self):
        with self.lock:
            scheduled = self.scheduled
        if scheduled is None:
            return
        if (self.state.get("state") != 0 or self.generation != scheduled["generation"]
                or self.memories.get(scheduled["memory"]) != scheduled["segments"]):
            self._cancel_start("Cancelada la próxima cocción: cambió el estado, la conexión o el programa.")
            return
        remaining = scheduled["timestamp"] - time.time()
        if remaining > 0:
            return
        if remaining < -30:
            self._cancel_start("Cancelada la próxima cocción: pasó la hora programada.")
            return
        with self.lock:
            self.scheduled = None
        self.command_deadline = time.monotonic() + 30 + remaining
        try:
            self._execute("run", {"memory": scheduled["memory"]}, deadline=self.command_deadline,
                          scheduled=scheduled)
        except Exception as exc:
            self.store.event("schedule_error", "system", f"Inicio programado: {exc}", self.active)
            if isinstance(exc, (CommunicationError, OSError)):
                self._offline(exc)
        finally:
            self.command_deadline = None
            self.command_adapter_epoch = None

    def _stopped(self):
        if self.adapter.read(0xCA)[0] != 0:
            raise ValueError("El programador debe estar PARADO para modificar memorias.")
        if self.adapter.read(0xA3)[0] != 0:
            raise ValueError("Solo se admite dP=0; escala decimal pendiente de comprobar.")

    def _guard_command(self):
        if self.command_adapter_epoch is not None and self.command_adapter_epoch != getattr(self.adapter, 'epoch', 0):
            raise ValueError('El puerto se reconectó durante la orden; vuelve a sincronizar antes de escribir.')
        if self.command_deadline is not None and time.monotonic() > self.command_deadline:
            raise ValueError('command_expired: la orden caducó antes de escribir.')
        if self.command_guard is not None and not self.command_guard():
            raise ValueError('Orden cancelada antes de escribir: conexión MQTT cambiada.')

    def _write_verified(self, address, values, readback=None):
        # Nunca repetir una escritura automáticamente: un ACK perdido puede haberla aplicado.
        failure = None
        self._guard_command()
        try:
            self.adapter.write(address, values)
        except CommunicationError as exc:
            failure = exc
        observed = self.adapter.read(address, len(values)) if readback is None else readback()
        if observed != values:
            raise CommunicationError("Escritura no confirmada por relectura; no se reintentará automáticamente.")
        if failure:
            self.store.event("ack_recovered", self.command_origin, "ACK perdido: escritura confirmada por relectura exacta.", self.active)

    def _load(self, memory, segments):
        self._stopped()
        pv = self.adapter.read(0xCD)[0]
        integer(pv, "PV inicial", 0, 1200)
        target = copy.deepcopy(segments)
        target[0]["temperature"] = pv
        actual = self._memory(memory)
        if actual != target:
            self._stopped()
            values = [v for s in target for v in (s["temperature"], s["minutes"])]
            if actual[1:] == target[1:] and actual[0]["minutes"] == target[0]["minutes"]:
                self._write_verified(MEMORIES[memory], [pv])
            else:
                self._write_verified(MEMORIES[memory], values)
            if self._memory(memory) != target:
                raise CommunicationError("Los 40 registros no coinciden; RUN bloqueado.")
        self.store.event("memory_loaded", self.command_origin, f"Memoria {memory} verificada; C01 adaptada a PV={pv} °C. Biblioteca intacta.", self.active)
        return target

    def _control(self, action):
        command, allowed, target = {"run": (1, {0}, 1), "stop": (2, {0,1,2}, 0),
                                    "pause": (3, {1}, 2), "resume": (4, {2}, 1)}[action]
        state = self.adapter.read(0xCA)[0]
        if state == target:
            return
        if state not in allowed:
            raise ValueError("Orden incompatible con el estado actual.")
        failure = None
        self._guard_command()
        try:
            self.adapter.write(0xC4, [command])
        except CommunicationError as exc:
            failure = exc
        limit = time.monotonic() + 6
        while time.monotonic() < limit:
            if self.adapter.read(0xCA)[0] == target:
                if failure:
                    self.store.event("ack_recovered", self.command_origin, "ACK perdido: orden confirmada por CAH.", self.active)
                return
            self.stop_event.wait(0.3)
        raise CommunicationError("Estado final no confirmado en CAH; resultado incierto.")

    def _switch_mode(self, mode, port=None):
        if mode not in ('simulator','physical') or self.adapter_factory is None:
            raise ValueError('Modo de comunicación no disponible.')
        if port is not None and (mode != 'physical' or not self.serial_ports
                                 or port not in self.serial_ports()
                                 and port not in (self.selected_port, self.default_port)):
            raise ValueError('El puerto USB seleccionado no está disponible.')
        if mode == self.mode and (port is None or port == getattr(self.adapter, 'port', None)):
            return {'message': 'El modo ya está seleccionado.', 'state': self.snapshot()}
        if self.state.get('online'):
            try:
                self._poll()  # Observar un posible RUN físico antes de cerrar el puerto.
            except (CommunicationError,OSError) as exc:
                self._offline(exc)
        if self.active or self.state.get('state') in (1,2):
            raise ValueError('No se puede cambiar de modo durante una cocción en marcha o pausada.')
        selected_port = port or self.selected_port
        if self.settings_path:
            connection = {'mode': mode}
            if selected_port:
                connection['port'] = selected_port
            temporary = self.settings_path.with_suffix('.tmp')
            fd = os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
            with os.fdopen(fd,'w') as f:
                json.dump(connection,f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporary,self.settings_path)
        with self.lock:
            self.state = {**self.state,'online':False,'error':'Cambiando el origen de comunicación…'}
        self.adapter.close()
        adapter = (self.adapter_factory(mode, selected_port)
                   if mode == 'physical' and selected_port else self.adapter_factory(mode))
        with self.lock:
            self.adapter = adapter
            self.mode = mode
            self.selected_port = selected_port
            self.generation += 1
            self.state = dict(online=False,mode=mode,error='Conectando con el programador…')
            self.memories = {}
            self.recent.clear()
            self.segment_run_seconds.clear()
            self.completed_memory = None
            self.previous = self.last_success = None
            self.offline_reported = False
            self.freshness_limit = max(10,self.interval*3+getattr(adapter,'timeout',.8)*10+6)
        self.store.event('mode_changed','app',f'Origen de comunicación: {mode}. No se enviaron órdenes de cocción.')
        try:
            self._poll()
        except Exception as exc:
            self._offline(exc)
        return {'message': 'Simulador activado.' if mode=='simulator' else 'Modo físico seleccionado; consulta el estado de MODBUS.', 'state': self.snapshot()}

    def _execute(self, operation, data, *, origin="app", deadline=None, guard=None, scheduled=None):
        if operation == 'prepare_update':
            launch = data.get('launch')
            if not callable(launch) or not self.snapshot()['update_idle']:
                raise ValueError('El programador debe estar parado y comunicado, sin una cocción programada.')
            self._poll()
            if not self.snapshot()['update_idle']:
                raise ValueError('El programador ya no está disponible para actualizar.')
            with self.lock:
                self.update_until = time.monotonic() + 120
            try:
                launch()
            except Exception:
                with self.lock:
                    self.update_until = 0
                raise
            return None
        if time.monotonic() < self.update_until and operation not in ('read', 'stop'):
            raise ValueError('Actualización del programa en curso.')
        if operation == 'cancel_start':
            self._cancel_start("Cocción programada cancelada desde el panel.")
            return {"message": "Programación cancelada.", "state": self.snapshot()}
        if operation == 'schedule_start':
            if self.scheduled is not None:
                raise ValueError("Ya hay una cocción programada.")
            memory = integer(data.get('memory'), "Memoria", 1, 4)
            raw = data.get('start_at')
            if not isinstance(raw, str):
                raise ValueError("Indica una fecha y hora de inicio.")
            when = datetime.fromisoformat(raw)
            self._poll()
            if when.tzinfo is None or when.timestamp() <= time.time():
                raise ValueError("Elige una fecha y hora futura.")
            if self.state["state"] != 0:
                raise ValueError("El programador debe estar PARADO para programar la próxima cocción.")
            segments = self.memories[memory]
            profile({"name": "Memoria", "segments": segments})
            with self.lock:
                self.scheduled = {"start_at": when.astimezone(timezone.utc).isoformat(),
                                  "timestamp": when.timestamp(), "memory": memory,
                                  "generation": self.generation, "segments": segments}
            self.store.event("scheduled_start", origin, f"Inicio programado para memoria {memory} ({self.scheduled['start_at']}).")
            return {"message": "Cocción programada.", "state": self.snapshot()}
        if operation == 'run' and self.scheduled is not None:
            raise ValueError("Cancela primero la cocción programada.")
        if operation == 'set_mode':
            previous_generation = self.generation
            result = self._switch_mode(data.get('mode'), data.get('port'))
            if self.generation != previous_generation:
                self._cancel_start("Cancelada la próxima cocción al cambiar la conexión.")
                result["state"] = self.snapshot()
            return result
        if operation == "simulate":
            if self.mode != 'simulator':
                raise ValueError('Las herramientas del simulador están desactivadas en modo físico.')
            self.adapter.simulate(data.get("action"))
            # Origen intencionalmente no atribuido a botones: el sondeo no puede distinguirlo.
            return {"message": "Acción aplicada al simulador."}
        if operation not in {"load", "load_segments", "select", "run", "stop", "pause", "resume", "read"}:
            raise ValueError("Operación desconocida.")
        if operation == "read":
            return self._poll()
        if operation == 'run' and 'memory' not in data:
            raise ValueError('Elige explícitamente la memoria que se va a iniciar.')
        if operation == 'run' and data.get('profile_id'):
            raise ValueError('Carga el perfil en una memoria antes de iniciar; Cargar e Iniciar son acciones distintas.')
        self._poll()  # Conciliar cambios externos ANTES de atribuir una orden a la app.
        self.command_adapter_epoch = getattr(self.adapter,'epoch',0)
        if deadline is not None and time.monotonic() > deadline:
            raise ValueError('command_expired: la orden caducó durante la sincronización.')
        if guard is not None and not guard():
            raise ValueError('Orden cancelada antes de escribir: conexión MQTT cambiada.')
        memory = integer(data.get("memory", self.adapter.read(0xA0)[0]), "Memoria", 1, 4)
        name = None
        if operation in {"load", "load_segments", "select", "run"}:
            self._stopped()
        if operation == "load":
            selected = self.store.get_profile(data.get("profile_id"))
            self._load(memory, selected["segments"])
        elif operation == 'load_segments':
            validated = profile({'name': 'Curva de Home Assistant', 'segments': data.get('segments')})
            self._load(memory, validated['segments'])
        elif operation == "select":
            self._write_verified(0xA0, [memory])
        elif operation == "run":
            if scheduled is not None and (self.generation != scheduled["generation"]
                                          or self.memories[memory] != scheduled["segments"]):
                raise ValueError("Cambió el programa de la memoria seleccionada.")
            self._write_verified(0xA0, [memory])
            segments = self._memory(memory)
            candidates = [p for p in self.store.profiles() if all(
                a['minutes'] == b['minutes'] and (i == 0 or a['temperature'] == b['temperature'])
                for i, (a, b) in enumerate(zip(p['segments'], segments)))]
            if len(candidates) == 1:
                name = candidates[0]['name']
            profile({"name": "Memoria", "segments": segments})
            target = self._load(memory, segments)
            pv = self.adapter.read(0xCD)[0]
            if pv != target[0]["temperature"]:
                self._load(memory, target)
            self._stopped()
            if self.adapter.read(0xA0)[0] != memory:
                raise ValueError("La memoria cambió durante la preparación; RUN cancelado.")
            self._control("run")
        else:
            self._control(operation)
        self._poll(origin=origin, name=name)
        self.store.event("command", origin, f"{operation.upper()} confirmada por relectura.", self.active)
        return {"message": "Operación confirmada por el programador.", "state": self.snapshot()}

    def close(self):
        self.stop_event.set()
        self.thread.join(12)
        if self.thread.is_alive():
            raise RuntimeError("No se pudo detener el worker.")
