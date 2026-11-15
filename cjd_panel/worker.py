"""Único propietario Modbus: sondeo, cola de órdenes y confirmación por relectura."""
from collections import deque
from concurrent.futures import Future
import copy
import queue
import threading
import time
from .model import integer, profile, utcnow
from .modbus import CommunicationError, MEMORIES


class Worker:
    def __init__(self, adapter, store, interval=1):
        self.adapter, self.store, self.interval = adapter, store, interval
        self.queue = queue.Queue(maxsize=32)
        self.stop_event = threading.Event()
        self.lock = threading.RLock()
        self.state = {"online": False, "mode": "simulator", "error": "Conectando con el simulador…"}
        self.memories = {}
        self.recent = deque(maxlen=600)
        self.active = None
        self.previous = None
        self.thread = threading.Thread(target=self._run, name="modbus-worker", daemon=True)

    def start(self):
        self.thread.start()

    def submit(self, operation, payload=None):
        future = Future()
        try:
            self.queue.put_nowait((operation, payload or {}, future))
        except queue.Full:
            raise ValueError("Hay demasiadas órdenes pendientes.")
        return future

    def snapshot(self):
        with self.lock:
            return copy.deepcopy({**self.state, "memories": self.memories,
                                   "recent": list(self.recent), "active_firing": self.active})

    def _run(self):
        next_poll = 0
        try:
            while not self.stop_event.is_set():
                if time.monotonic() >= next_poll:
                    try:
                        self._poll()
                    except Exception as exc:
                        self._offline(exc)
                    next_poll = time.monotonic() + self.interval
                try:
                    operation, data, future = self.queue.get(timeout=0.05)
                except queue.Empty:
                    continue
                if not future.set_running_or_notify_cancel():
                    continue
                try:
                    result = self._execute(operation, data)
                    future.set_result(result)
                except Exception as exc:
                    self.store.event("command_error", "app", f"{operation}: {exc}", self.active)
                    if isinstance(exc, CommunicationError):
                        self._offline(exc)
                    future.set_exception(exc)
                next_poll = 0
        finally:
            self.adapter.close()
            while not self.queue.empty():
                _, _, future = self.queue.get_nowait()
                future.set_exception(RuntimeError("Servicio detenido."))

    def _offline(self, exc):
        with self.lock:
            was_online = self.state.get("online")
            self.state = {**self.state, "online": False, "error": str(exc)}
        if was_online:
            self.store.event("offline", "observed", str(exc), self.active)

    def _memory(self, memory):
        values = self.adapter.read(MEMORIES[memory], 40)
        return [{"temperature": values[i], "minutes": values[i+1]} for i in range(0, 40, 2)]

    def _poll(self, origin="observed", name=None):
        v = self.adapter.read(0xC9, 6)
        memory = self.adapter.read(0xA0)[0]
        dp = self.adapter.read(0xA3)[0]
        if v[1] not in (0, 1, 2) or not 1 <= v[0] <= 20 or memory not in MEMORIES or dp != 0:
            raise CommunicationError("Estado, segmento, memoria o dP no compatibles; se bloquea el control.")
        s = {"online": True, "mode": "simulator", "timestamp": utcnow(), "pv": v[4], "sv": v[5],
             "step": v[0], "state": v[1], "minutes": v[3], "memory": memory, "dp": dp, "error": None}
        # Releer memorias en cada sincronización mantiene visibles cambios externos.
        memories = {i: self._memory(i) for i in MEMORIES}
        if not self.state.get("online"):
            self.store.event("online", "observed", "Comunicación y cuatro memorias sincronizadas.", self.active)
        with self.lock:
            if s["state"] in (1, 2) and not self.active:
                self.active = self.store.start(name or f"Memoria {memory}", memory, memories[memory], origin)
                self.store.event("started", origin, "Cocción observada y registrada.", self.active)
            if self.previous is not None and s["state"] != self.previous:
                self.store.event("state", origin, f"Estado confirmado: {['PARADO','FUNCIONANDO','PAUSADO'][s['state']]}", self.active)
            if self.active:
                self.store.record(self.active, s)
                if s["state"] == 0:
                    self.store.finish(self.active)
                    self.active = None
            self.previous = s["state"]
            self.state, self.memories = s, memories
            self.recent.append(s)
        return s

    def _stopped(self):
        if self.adapter.read(0xCA)[0] != 0:
            raise ValueError("El programador debe estar PARADO para modificar memorias.")
        if self.adapter.read(0xA3)[0] != 0:
            raise ValueError("Solo se admite dP=0; escala decimal pendiente de comprobar.")

    def _write_verified(self, address, values, readback=None):
        # Nunca repetir una escritura automáticamente: un ACK perdido puede haberla aplicado.
        failure = None
        try:
            self.adapter.write(address, values)
        except CommunicationError as exc:
            failure = exc
        observed = self.adapter.read(address, len(values)) if readback is None else readback()
        if observed != values:
            raise CommunicationError("Escritura no confirmada por relectura; no se reintentará automáticamente.")
        if failure:
            self.store.event("ack_recovered", "app", "ACK perdido: escritura confirmada por relectura exacta.", self.active)

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
        self.store.event("memory_loaded", "app", f"Memoria {memory} verificada; C01 adaptada a PV={pv} °C. Biblioteca intacta.", self.active)
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
        try:
            self.adapter.write(0xC4, [command])
        except CommunicationError as exc:
            failure = exc
        limit = time.monotonic() + 6
        while time.monotonic() < limit:
            if self.adapter.read(0xCA)[0] == target:
                if failure:
                    self.store.event("ack_recovered", "app", "ACK perdido: orden confirmada por CAH.", self.active)
                return
            self.stop_event.wait(0.3)
        raise CommunicationError("Estado final no confirmado en CAH; resultado incierto.")

    def _execute(self, operation, data):
        if operation == "simulate":
            self.adapter.simulate(data.get("action"))
            # Origen intencionalmente no atribuido a botones: el sondeo no puede distinguirlo.
            return {"message": "Acción aplicada al simulador."}
        if operation not in {"load", "select", "run", "stop", "pause", "resume", "read"}:
            raise ValueError("Operación desconocida.")
        if operation == "read":
            return self._poll()
        if operation == 'run' and 'memory' not in data:
            raise ValueError('Elige explícitamente la memoria que se va a iniciar.')
        if operation == 'run' and data.get('profile_id'):
            raise ValueError('Carga el perfil en una memoria antes de iniciar; Cargar e Iniciar son acciones distintas.')
        self._poll()  # Conciliar cambios externos ANTES de atribuir una orden a la app.
        memory = integer(data.get("memory", self.adapter.read(0xA0)[0]), "Memoria", 1, 4)
        name = None
        if operation in {"load", "select", "run"}:
            self._stopped()
        if operation == "load":
            selected = self.store.get_profile(data.get("profile_id"))
            self._load(memory, selected["segments"])
        elif operation == "select":
            self._write_verified(0xA0, [memory])
        elif operation == "run":
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
        self._poll(origin="app", name=name)
        self.store.event("command", "app", f"{operation.upper()} confirmada por relectura.", self.active)
        return {"message": "Operación confirmada por el programador simulado.", "state": self.snapshot()}

    def close(self):
        self.stop_event.set()
        self.thread.join(12)
        if self.thread.is_alive():
            raise RuntimeError("No se pudo detener el worker.")
