"""Transporte RTU del simulador incluido; el adaptador físico está separado."""
import importlib.util
import os
from pathlib import Path
import queue
import select
import struct
import sys
import threading
import time

SOURCE = Path(__file__).resolve().parent.parent / "fuentes_referencia/cjd9000p_simulador_modbus_demo_v7_5_1.py"
spec = importlib.util.spec_from_file_location("cjd_reference_simulator", SOURCE)
simulator = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = simulator
spec.loader.exec_module(simulator)
MEMORIES = {1: 0x00, 2: 0x28, 3: 0x50, 4: 0x78}


class CommunicationError(RuntimeError):
    pass


class SimulatedRTU:
    """Servidor PTY y cliente FC03/FC16; un único worker es dueño del cliente."""
    mode = 'simulator'
    def __init__(self, segment_seconds=10, timeout=0.8):
        self.furnace = simulator.Furnace(segment_seconds=segment_seconds)
        self.server = simulator.RTUServer(self.furnace)
        self.fd = os.open(self.server.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        self.timeout = timeout
        self.commands = queue.Queue()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._serve, name="simulador-rtu", daemon=True)
        self.thread.start()

    def program_completed(self, programmed_minutes):
        # The simulator keeps the last segment at STOP, even on natural completion.
        return (programmed_minutes > 0
                and self.furnace.virtual_seconds_total + 1e-6 >= programmed_minutes * 60)

    def _serve(self):
        previous = time.monotonic()
        while not self.stop_event.is_set():
            while True:
                try:
                    action, done = self.commands.get_nowait()
                except queue.Empty:
                    break
                if action in ("offline", "online"):
                    self.furnace.faulty = action == "offline"
                elif action == "lost_ack":
                    self.furnace.drop_next_write_reply = True
                else:
                    self.furnace.write(0xC4, [{"run": 1, "stop": 2, "pause": 3, "resume": 4}[action]])
                done.set()
            now = time.monotonic()
            self.furnace.tick(now - previous)
            previous = now
            ready, _, _ = select.select([self.server.master_fd], [], [], 0.02)
            if ready:
                try:
                    self.server.buffer.extend(os.read(self.server.master_fd, 4096))
                    self.server._consume_frames()
                except OSError:
                    break

    def simulate(self, action):
        if action not in {"offline", "online", "lost_ack", "run", "stop", "pause", "resume"}:
            raise ValueError("Acción de simulador desconocida.")
        done = threading.Event()
        self.commands.put((action, done))
        if not done.wait(2):
            raise CommunicationError("El simulador no respondió.")

    def _exchange(self, function, data, expected):
        # Drenar respuestas atrasadas: nunca reutilizar un ACK de otra transacción.
        while select.select([self.fd], [], [], 0)[0]:
            os.read(self.fd, 4096)
        frame = simulator.frame_with_crc(bytes((1, function)) + data)
        if os.write(self.fd, frame) != len(frame):
            raise CommunicationError("Solicitud RTU incompleta.")
        end = time.monotonic() + self.timeout
        reply = bytearray()
        while time.monotonic() < end:
            if select.select([self.fd], [], [], max(0, end - time.monotonic()))[0]:
                reply.extend(os.read(self.fd, 4096))
                size = 5 if len(reply) >= 2 and reply[1] & 0x80 else expected
                if len(reply) >= size:
                    break
        if len(reply) < 5 or not simulator.is_valid_frame(reply):
            raise CommunicationError("Sin respuesta RTU válida; resultado de escritura posiblemente incierto.")
        if reply[0] != 1 or reply[1] not in (function, function | 0x80):
            raise CommunicationError("Respuesta RTU ajena a la solicitud.")
        if reply[1] & 0x80:
            raise CommunicationError(f"Excepción Modbus {reply[2]}.")
        if len(reply) != expected:
            raise CommunicationError("Longitud RTU incorrecta.")
        return bytes(reply)

    def read(self, address, count=1):
        result = self._exchange(3, struct.pack(">HH", address, count), 5 + 2 * count)
        if result[2] != 2 * count:
            raise CommunicationError("Número de registros incorrecto.")
        return list(struct.unpack(">" + "h" * count, result[3:-2]))

    def write(self, address, values):
        data = struct.pack(">HHB", address, len(values), 2 * len(values))
        data += b"".join(struct.pack(">H", v & 0xFFFF) for v in values)
        reply = self._exchange(16, data, 8)
        if reply[2:6] != data[:4]:
            raise CommunicationError("ACK de escritura incorrecto.")

    def close(self):
        if self.stop_event.is_set():
            return
        self.stop_event.set()
        self.thread.join(2)
        os.close(self.fd)
        self.server.close()
