#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CJD-9000P - SIMULADOR DE DEMOSTRACION V7.5.1 (Modbus RTU/PTTY Linux).

Derivado del simulador V7.1 validado con nuestro comunicador Python/MQTT.
No publica MQTT por si solo. No abre puertos fisicos de horno.

Modo DEMO por defecto: cada TRAMO con tiempo positivo ocupa 10 segundos
reales, independientemente de cuantos minutos virtuales tenga programados.
Se acepta tambien FC16 de UN registro sobre C01 de cada memoria,
para la adaptacion de PV que realiza el comunicador V7.2.
Registros y respuestas Modbus se conservan (FC03/FC16, SPC, C4, C9, CA,
CC, CD, CE). 0xCC comunica minutos VIRTUALES del segmento y se reinicia
al cambiarlo. PAUSA congela tiempo, consigna y temperatura simulada.

Las memorias precargadas incluyen 20 temperaturas / 19 tramos para
probar grafica y colores, con t20=0. 19 x 10s = 3m10s.
Para una exposicion cercana a 5 minutos: --segment-seconds 16
(19 x 16s = 5m04s). El chip permite como maximo 20 temperaturas; no
se inventan mas registros ni segmentos.

EJEMPLOS:
    python3 cjd9000p_simulador_modbus_demo_v7_5.py --self-test
    python3 cjd9000p_simulador_modbus_demo_v7_5.py
    python3 cjd9000p_simulador_modbus_demo_v7_5.py --segment-seconds 16

Al iniciar indica /dev/pts/N; configurar ese puerto en el puente Python
V7 existente, aislado del broker MQTT del horno real.
Este modelo termico es VISUAL y no predice el comportamiento de un horno.
"""
from __future__ import annotations

import argparse
import errno
import os
import select
import sys
import time
import tty
from dataclasses import dataclass, field

REG_SPC = 0xA0
REG_CYC = 0xA1
REG_DP = 0xA3
REG_C4 = 0xC4
REG_STEP = 0xC9
REG_STATE = 0xCA
REG_TIME = 0xCC
REG_PV = 0xCD
REG_SV = 0xCE
MEMORIES = {1: 0x00, 2: 0x28, 3: 0x50, 4: 0x78}
MAX_REG = REG_SV
REGS_PER_CURVE = 40


def crc16(data: bytes) -> int:
    """CRC16 Modbus (valor numerico; en la trama viaja primero el byte bajo)."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if (crc & 1) else 0)
    return crc


def frame_with_crc(data: bytes) -> bytes:
    return data + crc16(data).to_bytes(2, "little")


def is_valid_frame(frame: bytes) -> bool:
    return len(frame) >= 4 and crc16(frame[:-2]) == int.from_bytes(frame[-2:], "little")


def u16(value: int) -> int:
    return value & 0xFFFF


def s16(value: int) -> int:
    return value - 65536 if value & 0x8000 else value


@dataclass
class Furnace:
    slave_id: int = 1
    speed: float = 60.0  # aceleracion antigua, usada solo con segment_seconds=0
    segment_seconds: float = 10.0  # segundos REALES por tramo con tiempo positivo
    ramp: float = 45.0   # limite de seguimiento de PV (grados/min virtual)
    registers: list[int] = field(default_factory=lambda: [0] * (MAX_REG + 1))
    pv: float = 25.0
    setpoint: float = 25.0
    virtual_seconds_in_segment: float = 0.0
    virtual_seconds_total: float = 0.0  # diagnostico interno; NO se publica en 0xCC
    faulty: bool = False  # no responde: permite ensayar timeout/reconexion
    drop_next_write_reply: bool = False  # escritura aplicada, ACK perdido
    write_log: list[tuple[int, list[int], float]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not 1 <= self.slave_id <= 247:
            raise ValueError("Modbus ID debe estar entre 1 y 247")
        if self.speed <= 0 or self.ramp <= 0 or self.segment_seconds < 0:
            raise ValueError("speed y ramp deben ser positivos")
        self.registers[REG_SPC] = 1
        self.registers[REG_CYC] = 0
        self.registers[REG_DP] = 0
        self.registers[REG_STEP] = 1
        self.registers[REG_STATE] = 0
        self.registers[REG_TIME] = 0
        self.registers[REG_PV] = 25
        self.registers[REG_SV] = 25
        # 20 puntos C01-C20; 19 transiciones t01-t19, t20=0.
        # La curva es ficticia para PRESENTACION, no una receta de vidrio.
        curves = {
            1: [25, 100, 180, 260, 360, 460, 570, 680, 760, 800,
                800, 820, 820, 760, 680, 580, 470, 360, 260, 180],
            2: [25, 80, 150, 240, 340, 450, 530, 580, 620, 640,
                640, 625, 580, 530, 460, 390, 320, 260, 200, 140],
            3: [25, 130, 240, 370, 490, 610, 710, 780, 810, 810,
                790, 740, 660, 570, 490, 420, 360, 300, 245, 190],
            4: [25, 160, 300, 450, 600, 750, 900, 1050, 1170, 1200,
                1200, 1160, 1070, 960, 840, 720, 600, 475, 350, 220],
        }
        for mem, temps in curves.items():
            # Como en el firmware real, el tiempo t_i pertenece al
            # recorrido C_i -> C_(i+1). El tiempo t20 se deja a cero.
            self.set_memory(mem, [(temp, 10 if i < 19 else 0)
                                  for i, temp in enumerate(temps)])

    def set_memory(self, mem: int, segments: list[tuple[int, int]]) -> None:
        base = MEMORIES[mem]
        if len(segments) > 20:
            raise ValueError("maximo 20 segmentos")
        for i in range(20):
            temp, minutes = segments[i] if i < len(segments) else (0, 0)
            if not (-32768 <= temp <= 32767 and 0 <= minutes <= 32767):
                raise ValueError("valores fuera de rango de registro de 16 bits")
            self.registers[base + 2 * i] = u16(temp)
            self.registers[base + 2 * i + 1] = u16(minutes)

    def segments(self, mem: int) -> list[tuple[int, int]]:
        base = MEMORIES[mem]
        return [(s16(self.registers[base + 2 * i]), s16(self.registers[base + 2 * i + 1]))
                for i in range(20)]

    def _refresh_sv(self) -> None:
        """Reproduce la consigna dentro del tramo C_i -> C_(i+1).

        Necesario para que el punto naranja del Control V7.5.2 se mueva
        en las rampas: alli se calcula su posicion a partir de SV.
        """
        state = self.registers[REG_STATE]
        if state == 0:
            self.setpoint = 25.0
            return
        if state == 2:  # pausa: no alterar SV
            return
        segments = self.segments(self.registers[REG_SPC])
        pos = max(0, self.registers[REG_STEP] - 1)
        while pos < 20 and segments[pos][1] <= 0:
            pos += 1
            self.virtual_seconds_in_segment = 0.0
        if pos >= 20:
            self.registers[REG_STATE] = 0
            self.setpoint = 25.0
            return
        self.registers[REG_STEP] = pos + 1
        start_temp, mins = segments[pos]
        end_temp = segments[pos + 1][0] if pos < 19 else start_temp
        fraction = max(0.0, min(1.0, self.virtual_seconds_in_segment / (mins * 60.0)))
        self.setpoint = start_temp + (end_temp - start_temp) * fraction

    def _advance_running(self, real_seconds: float) -> float:
        """Consume tiempo real respetando limites de cada tramo.

        El valor devuelto es tiempo virtual total para actualizar PV con
        el mismo mecanismo que tenia el simulador V7.1.
        """
        segments = self.segments(self.registers[REG_SPC])
        pos = max(0, self.registers[REG_STEP] - 1)
        remaining_real = real_seconds
        virtual_advanced = 0.0
        while pos < 20:
            _, mins = segments[pos]
            if mins <= 0:
                pos += 1
                self.virtual_seconds_in_segment = 0.0
                continue
            if remaining_real <= 1e-9:
                break
            virtual_rate = (mins * 60.0 / self.segment_seconds
                            if self.segment_seconds > 0 else self.speed)
            needed_virtual = max(0.0, mins * 60.0 - self.virtual_seconds_in_segment)
            consumed_real = min(remaining_real, needed_virtual / virtual_rate)
            increment = consumed_real * virtual_rate
            self.virtual_seconds_in_segment += increment
            self.virtual_seconds_total += increment
            virtual_advanced += increment
            remaining_real -= consumed_real
            if self.virtual_seconds_in_segment + 1e-6 >= mins * 60.0:
                self.virtual_seconds_in_segment = 0.0
                pos += 1
                continue
            break
        # Saltar datos finales vacios en cuanto se completa el ultimo tramo.
        while pos < 20 and segments[pos][1] <= 0:
            pos += 1
            self.virtual_seconds_in_segment = 0.0
        if pos >= 20:
            self.registers[REG_STATE] = 0
            self.registers[REG_TIME] = 0
            self.virtual_seconds_in_segment = 0.0
            self.setpoint = 25.0
            # Conserva el numero del ultimo tramo valido al pasar a PARADO.
        else:
            self.registers[REG_STEP] = pos + 1
            self._refresh_sv()
        return virtual_advanced

    def tick(self, real_seconds: float) -> None:
        if real_seconds <= 0:
            return
        # Como en V7.1, una PAUSA congela todo el modelo.
        if self.registers[REG_STATE] == 2:
            return
        real_dt = min(real_seconds, 2.0)
        virtual_dt = 0.0
        if self.registers[REG_STATE] == 1:
            virtual_dt = self._advance_running(real_dt)
        else:
            self.setpoint = 25.0
        change = self.ramp * virtual_dt / 60.0
        self.pv += max(-change, min(change, self.setpoint - self.pv))
        # Contrato V7.1: minutos VIRTUALES del segmento actual.
        # En DEMO avanzan rapido, pero el formato MQTT/Modbus no cambia.
        self.registers[REG_TIME] = min(32767, int((self.virtual_seconds_in_segment + 1e-7) / 60))
        self.registers[REG_PV] = u16(round(self.pv))
        self.registers[REG_SV] = u16(round(self.setpoint))

    def write(self, address: int, values: list[int]) -> int:
        """Devuelve codigo de excepcion 0=OK, 2=direccion, 3=valor."""
        n = len(values)
        if n < 1 or n > 123 or address < 0 or address + n - 1 > MAX_REG:
            return 2
        if address == REG_C4 and n == 1:
            command = values[0]
            state = self.registers[REG_STATE]
            if command == 1 and state == 0:
                self.registers[REG_STATE] = 1
                self.registers[REG_STEP] = 1
                self.virtual_seconds_in_segment = 0
                self.virtual_seconds_total = 0
                self.registers[REG_TIME] = 0
                self._refresh_sv()
            elif command == 2 and state in (0, 1, 2):
                self.registers[REG_STATE] = 0
                self.setpoint = 25.0
            elif command == 3 and state == 1:
                self.registers[REG_STATE] = 2
            elif command == 4 and state == 2:
                self.registers[REG_STATE] = 1
            else:
                return 3
        elif address == REG_SPC and n == 1:
            if self.registers[REG_STATE] != 0 or values[0] not in MEMORIES:
                return 3
            self.registers[REG_SPC] = values[0]
            self.registers[REG_STEP] = 1
            self.virtual_seconds_in_segment = 0.0
            self.registers[REG_TIME] = 0
        elif address in MEMORIES.values() and n == REGS_PER_CURVE:
            if self.registers[REG_STATE] != 0:
                return 3
            if any(s16(values[i]) < 0 or s16(values[i + 1]) < 0 for i in range(0, 40, 2)):
                return 3
            self.registers[address:address + 40] = values
        elif address in MEMORIES.values() and n == 1:
            # Compatibilidad con V7.2: escribir SOLO la temperatura C01
            # en una memoria mientras el programador esta PARADO.
            # El simulador trabaja con dP=0 y acepta 0..1200 °C.
            initial = s16(values[0])
            if self.registers[REG_STATE] != 0 or not 0 <= initial <= 1200:
                return 3
            self.registers[address] = values[0]
        else:
            # Simulacion deliberadamente estricta: nunca escribe registros
            # ajenos al protocolo de operaciones que necesitamos probar.
            return 2
        self.write_log.append((address, values.copy(), time.time()))
        return 0

    def handle_pdu(self, function: int, data: bytes) -> bytes | None:
        if function == 3:
            if len(data) != 4:
                return bytes((0x83, 3))
            address = int.from_bytes(data[:2], "big")
            count = int.from_bytes(data[2:], "big")
            if count < 1 or count > 125:
                return bytes((0x83, 3))
            if address + count - 1 > MAX_REG:
                return bytes((0x83, 2))
            values = self.registers[address:address + count]
            return bytes((3, count * 2)) + b"".join(v.to_bytes(2, "big") for v in values)
        if function == 16:
            if len(data) < 5:
                return bytes((0x90, 3))
            address = int.from_bytes(data[:2], "big")
            count = int.from_bytes(data[2:4], "big")
            byte_count = data[4]
            if count < 1 or count > 123 or byte_count != 2 * count or len(data) != 5 + byte_count:
                return bytes((0x90, 3))
            values = [int.from_bytes(data[5 + i:7 + i], "big") for i in range(0, byte_count, 2)]
            code = self.write(address, values)
            if code:
                return bytes((0x90, code))
            return bytes((16,)) + data[:4]
        return bytes((function | 0x80, 1))

    def status(self) -> str:
        state = ("PARADO", "FUNCIONANDO", "PAUSADO")[self.registers[REG_STATE]]
        return (f"{state} | SPC={self.registers[REG_SPC]} | segmento={self.registers[REG_STEP]} "
                f"| PV={s16(self.registers[REG_PV])}°C | SV={s16(self.registers[REG_SV])}°C "
                f"| tiempo_segmento={self.registers[REG_TIME]} min (virtual) | escrituras={len(self.write_log)} "
                f"| comunicacion={'OFFLINE (sin respuestas)' if self.faulty else 'ONLINE'}")


class RTUServer:
    def __init__(self, furnace: Furnace) -> None:
        self.furnace = furnace
        self.master_fd, self.slave_fd = os.openpty()
        tty.setraw(self.master_fd)
        tty.setraw(self.slave_fd)
        self.port = os.ttyname(self.slave_fd)
        self.buffer = bytearray()
        self.running = True
        self.frames_received = 0
        self.frames_bad_crc = 0
        self.frames_ignored = 0

    def close(self) -> None:
        for fd in (self.master_fd, self.slave_fd):
            try:
                os.close(fd)
            except OSError:
                pass

    def _consume_frames(self) -> None:
        while len(self.buffer) >= 8:
            slave, function = self.buffer[0], self.buffer[1]
            if slave != self.furnace.slave_id:
                del self.buffer[0]
                self.frames_ignored += 1
                continue
            if function == 3:
                length = 8
            elif function == 16:
                if len(self.buffer) < 7:
                    return
                count = self.buffer[6]
                if count > 246:
                    del self.buffer[0]
                    continue
                length = 9 + count
            else:
                # Un RTU request con funcion no soportada suele ocupar 8 B.
                length = 8
            if len(self.buffer) < length:
                return
            frame = bytes(self.buffer[:length])
            if not is_valid_frame(frame):
                self.frames_bad_crc += 1
                del self.buffer[0]
                continue
            del self.buffer[:length]
            self.frames_received += 1
            if self.furnace.faulty:
                continue
            pdu = self.furnace.handle_pdu(function, frame[2:-2])
            if pdu is None:
                continue
            if function == 16 and pdu[0] == 16 and self.furnace.drop_next_write_reply:
                self.furnace.drop_next_write_reply = False
                print("[SIM] Escritura APLICADA pero respuesta Modbus descartada (resultado incierto)", flush=True)
                continue
            reply = frame_with_crc(bytes((slave,)) + pdu)
            try:
                os.write(self.master_fd, reply)
            except OSError:
                pass

    def command(self, line: str) -> None:
        parts = line.strip().lower().split()
        if not parts:
            return
        cmd = parts[0]
        try:
            if cmd in ("help", "ayuda", "?"):
                print("Comandos: status | curvas | log | offline | online | ack-perdido | "
                      "duracion N | speed N | ramp N | pv N | salir", flush=True)
            elif cmd == "status":
                print(self.furnace.status(), flush=True)
            elif cmd == "curvas":
                for mem in MEMORIES:
                    active = [(t, m) for t, m in self.furnace.segments(mem) if m > 0]
                    print(f"  Memoria {mem}: {active}", flush=True)
            elif cmd == "log":
                for address, values, stamp in self.furnace.write_log[-20:]:
                    print(f"  {time.strftime('%H:%M:%S', time.localtime(stamp))} "
                          f"0x{address:02X} ({len(values)} registros) "
                          f"{values[:8]}{' ...' if len(values)>8 else ''}", flush=True)
            elif cmd == "offline":
                self.furnace.faulty = True
                print("[SIM] No respondera a las solicitudes Modbus", flush=True)
            elif cmd == "online":
                self.furnace.faulty = False
                print("[SIM] Reanudadas las respuestas Modbus", flush=True)
            elif cmd == "ack-perdido":
                self.furnace.drop_next_write_reply = True
                print("[SIM] Proxima escritura valida: se aplicara pero NO se respondera", flush=True)
            elif cmd in ("duracion", "segment-seconds") and len(parts) == 2:
                value = float(parts[1]); assert 1 <= value <= 600
                self.furnace.segment_seconds = value
                print(f"[SIM] Duracion: {value:g} segundos reales por tramo", flush=True)
            elif cmd == "speed" and len(parts) == 2:
                value = float(parts[1]); assert 0 < value <= 3600
                self.furnace.speed = value
                self.furnace.segment_seconds = 0
                print(f"[SIM] Modo aceleracion antiguo: {value:g}x; "
                      "usa 'duracion 10' para volver a modo DEMO", flush=True)
            elif cmd == "ramp" and len(parts) == 2:
                value = float(parts[1]); assert 0 < value <= 2000
                self.furnace.ramp = value
                print(f"[SIM] Rampa visual: {value} °C/min virtual", flush=True)
            elif cmd == "pv" and len(parts) == 2:
                value = float(parts[1]); assert -200 <= value <= 2000
                self.furnace.pv = value
                self.furnace.registers[REG_PV] = u16(round(value))
                print(f"[SIM] PV fijada manualmente a {value} °C", flush=True)
            elif cmd in ("salir", "quit", "exit"):
                self.running = False
            else:
                print("Comando no reconocido. Usa 'ayuda'.", flush=True)
        except (ValueError, AssertionError):
            print("Valor no valido. Usa 'ayuda'.", flush=True)

    def serve(self) -> None:
        print("\n" + "=" * 68)
        print("SIMULADOR CJD-9000P DEMO V7.5 - SIN HARDWARE NI MQTT")
        print("=" * 68)
        print(f"PUERTO VIRTUAL: {self.port}")
        print("9600 8N2 en el CLIENTE (PTY no simula temporizacion electrica).")
        print("Registro 0xCC: minutos VIRTUALES del segmento actual (reinicio por tramo).")
        if self.furnace.segment_seconds > 0:
            print(f"MODO DEMO: {self.furnace.segment_seconds:g} segundos reales por tramo")
            print(f"Memoria 1: 19 tramos = {19 * self.furnace.segment_seconds / 60:.2f} min aprox.")
        else:
            print(f"MODO ACELERADO CLASICO: {self.furnace.speed:g}x")
        print(f"Modbus ID: {self.furnace.slave_id}")
        print("ESTADO INICIAL: " + self.furnace.status())
        print("Escribe ayuda, status, curvas, duracion 16, offline, online, log, salir.")
        print("NUNCA conectar simultaneamente el puente a MQTT de produccion.")
        print("=" * 68, flush=True)
        last_time = time.monotonic()
        listen_stdin = sys.stdin.isatty()
        try:
            while self.running:
                now = time.monotonic()
                self.furnace.tick(now - last_time)
                last_time = now
                fds = [self.master_fd] + ([sys.stdin.fileno()] if listen_stdin else [])
                try:
                    readable, _, _ = select.select(fds, [], [], 0.1)
                except InterruptedError:
                    continue
                for fd in readable:
                    if fd == self.master_fd:
                        try:
                            incoming = os.read(fd, 4096)
                        except OSError as exc:
                            if exc.errno == errno.EIO:  # pty abierto, sin cliente
                                self.buffer.clear()
                                continue
                            raise
                        if incoming:
                            self.buffer.extend(incoming)
                            self._consume_frames()
                        if len(self.buffer) > 8192:
                            self.buffer.clear()
                    else:
                        line = sys.stdin.readline()
                        if not line:
                            listen_stdin = False
                        else:
                            self.command(line)
        except KeyboardInterrupt:
            print("\nSimulador detenido.", flush=True)
        finally:
            self.close()


def self_test() -> None:
    furnace = Furnace()
    assert len(furnace.registers) == 0xCF
    assert crc16(bytes.fromhex("010300000001")) == 0x0A84
    assert is_valid_frame(frame_with_crc(bytes.fromhex("010300000001")))
    response = furnace.handle_pdu(3, bytes.fromhex("00a00001"))
    assert response == bytes.fromhex("03020001")
    # Escritura de una curva completa y su verificacion, sin hardware.
    values = [v for segment in [(100, 3), (300, 4), (750, 5)] + [(0, 0)] * 17 for v in segment]
    pdu = bytes.fromhex("0000") + (40).to_bytes(2, "big") + b"\x50" + b"".join(x.to_bytes(2, "big") for x in values)
    answer = furnace.handle_pdu(16, pdu)
    assert answer == bytes.fromhex("1000000028")
    assert furnace.segments(1)[:3] == [(100, 3), (300, 4), (750, 5)]
    assert furnace.write(0xC4, [1]) == 0
    assert furnace.registers[REG_STATE] == 1
    assert furnace.write(0, values) == 3  # prohibe escribir curva en marcha
    assert furnace.write(0xC4, [3]) == 0
    assert furnace.registers[REG_STATE] == 2
    assert furnace.setpoint == 100.0  # detectaría subida de PV si PAUSA fallara
    frozen = (furnace.registers[REG_PV], furnace.registers[REG_SV],
              furnace.registers[REG_TIME], furnace.registers[REG_STEP],
              furnace.pv, furnace.setpoint, furnace.virtual_seconds_in_segment,
              furnace.virtual_seconds_total)
    furnace.tick(120.0)
    assert (furnace.registers[REG_PV], furnace.registers[REG_SV],
            furnace.registers[REG_TIME], furnace.registers[REG_STEP],
            furnace.pv, furnace.setpoint, furnace.virtual_seconds_in_segment,
            furnace.virtual_seconds_total) == frozen, "PAUSA debe congelar toda la simulacion"
    assert furnace.write(0xC4, [4]) == 0
    assert furnace.registers[REG_STATE] == 1
    furnace.tick(0.5)
    assert furnace.registers[REG_PV] > 25, "REANUDAR debe volver a calentar"
    assert furnace.write(0xC4, [2]) == 0
    assert furnace.registers[REG_STATE] == 0
    assert furnace.write(REG_SPC, [4]) == 0
    assert furnace.registers[REG_SPC] == 4
    assert furnace.write(REG_SPC, [5]) == 3
    assert furnace.write(0xBF, [9600]) == 2  # no permite cambiar baud / addr
    assert len(furnace.write_log) == 6
    # V7.1: probar ademas el contrato del contador leido por FC03.
    # En el segmento 1 dura 3 min, el 2 dura 4 y el 3 dura 5.
    timer = Furnace(speed=60, segment_seconds=0)
    timer.set_memory(1, [(100, 3), (300, 4), (750, 5)])
    assert timer.write(REG_C4, [1]) == 0
    def read_time_from_modbus() -> int:
        response = timer.handle_pdu(3, REG_TIME.to_bytes(2, "big") + (1).to_bytes(2, "big"))
        assert response is not None and response[:2] == bytes((3, 2))
        return int.from_bytes(response[2:4], "big")
    assert read_time_from_modbus() == 0
    timer.tick(1.0)  # 1 minuto virtual, segmento 1
    assert timer.registers[REG_STEP] == 1 and read_time_from_modbus() == 1
    timer.tick(2.0)  # 3 min acumulados, CAMBIO a segmento 2
    assert timer.registers[REG_STEP] == 2 and read_time_from_modbus() == 0
    assert timer.virtual_seconds_total == 180
    timer.tick(2.0)  # 2 min EN segmento 2
    assert read_time_from_modbus() == 2
    assert timer.write(REG_C4, [3]) == 0  # PAUSA
    before = read_time_from_modbus()
    timer.tick(1.0)
    assert read_time_from_modbus() == before == 2
    assert timer.write(REG_C4, [4]) == 0  # REANUDAR
    timer.tick(2.0)  # CAMBIO a segmento 3
    assert timer.registers[REG_STEP] == 3 and read_time_from_modbus() == 0
    timer.tick(1.0)
    assert read_time_from_modbus() == 1
    assert timer.write(REG_C4, [2]) == 0  # STOP
    assert timer.write(REG_C4, [1]) == 0  # NUEVO RUN
    assert timer.registers[REG_STEP] == 1 and read_time_from_modbus() == 0
    # NUEVO: 19 tramos de demostracion, 10 segundos por tramo,
    # lectura FC03 de consigna interpolada y cambios de registro C9.
    demo = Furnace(segment_seconds=10)
    assert all(len(demo.segments(mem)) == 20 for mem in MEMORIES)
    assert all(demo.segments(mem)[-1][1] == 0 for mem in MEMORIES)
    assert demo.write(REG_C4, [1]) == 0
    assert demo.registers[REG_SV] == 25
    demo.tick(2)
    assert demo.registers[REG_STEP] == 1 and demo.registers[REG_TIME] == 2
    assert 25 < s16(demo.registers[REG_SV]) < 100
    demo.tick(2)
    assert demo.registers[REG_STEP] == 1 and demo.registers[REG_TIME] == 4
    assert demo.write(REG_C4, [3]) == 0
    paused_values = (demo.registers[REG_TIME], demo.registers[REG_PV],
                     demo.registers[REG_SV], demo.registers[REG_STEP])
    demo.tick(50)
    assert paused_values == (demo.registers[REG_TIME], demo.registers[REG_PV],
                             demo.registers[REG_SV], demo.registers[REG_STEP])
    assert demo.write(REG_C4, [4]) == 0
    for _ in range(3): demo.tick(2)
    assert demo.registers[REG_STEP] == 2 and demo.registers[REG_TIME] == 0
    assert s16(demo.registers[REG_SV]) == 100
    # Una lectura por Modbus debe ver la misma consigna y estado.
    for addr in (REG_STEP, REG_TIME, REG_SV):
        value = int.from_bytes(demo.handle_pdu(3, addr.to_bytes(2,'big')+b'\x00\x01')[2:4], 'big')
        assert value == demo.registers[addr]
    demo5 = Furnace(segment_seconds=16)
    assert demo5.write(REG_C4, [1]) == 0
    for _ in range(152): demo5.tick(2)  # 304 segundos = 19 x 16
    assert demo5.registers[REG_STATE] == 0
    demo10 = Furnace(segment_seconds=10)
    assert demo10.write(REG_C4, [1]) == 0
    for _ in range(95): demo10.tick(2)  # 190 segundos = 19 x 10
    assert demo10.registers[REG_STATE] == 0
    # Cargar una curva de usuario no altera el principio de 10 segundos
    # por tramo, ni cambia el protocolo FC16 que emplea el puente.
    sample = Furnace(segment_seconds=10)
    sample.set_memory(1, [(25, 120), (300, 20), (450, 0)])
    assert sample.write(REG_C4, [1]) == 0
    sample.tick(2)
    assert sample.registers[REG_TIME] == 24  # 20 % de 120 min
    sample.tick(2)
    assert sample.registers[REG_TIME] == 48
    # V7.5.1: C01 puntual en cualquiera de las cuatro memorias.
    check = Furnace(segment_seconds=10)
    for mem, base in MEMORIES.items():
        before = check.registers[base:base+40].copy()
        new_pv = 15 + mem
        pdu = (base.to_bytes(2, 'big') + (1).to_bytes(2, 'big') +
               b'\x02' + new_pv.to_bytes(2, 'big'))
        assert check.handle_pdu(16, pdu) == bytes((16,)) + pdu[:4]
        assert check.registers[base] == new_pv
        assert check.registers[base+1:base+40] == before[1:], 'No tocar t01 ni resto de curva'
        assert check.write(base, [1201]) == 3, 'PV superior al limite'
        assert check.write(base, [65535]) == 3, 'PV negativa'
    # La memoria activa debe reflejar C01=PV en la consigna al iniciar RUN.
    assert check.write(MEMORIES[1], [25]) == 0
    assert check.write(REG_C4, [1]) == 0
    assert s16(check.registers[REG_SV]) == 25
    assert check.write(MEMORIES[1], [30]) == 3, 'No cambiar C01 en RUN'
    check.tick(2)
    assert 25 < s16(check.registers[REG_SV]) < 100, 'SV interpolada en rampa'
    print("SELF-TEST OK (DEMO V7.5.1): CRC, FC03, FC16, C01 individual, "
          "SPC, C4, tramos, SV interpolada, 0xCC, PAUSA y STOP.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Simulador CJD9000P DEMO V7.5.1 por pseudo-terminal Linux")
    parser.add_argument("--self-test", action="store_true", help="Autoprueba sin MQTT ni puertos fisicos")
    parser.add_argument("--slave-id", type=int, default=1, help="Modbus ID simulado (1-247)")
    parser.add_argument("--speed", type=float, default=60.0,
                        help="Factor de aceleracion para modo clasico (--segment-seconds 0)")
    parser.add_argument("--segment-seconds", type=float, default=10.0,
                        help="Segundos REALES por tramo (10 por defecto, 16 para ~5 min)")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if os.name != "posix":
        parser.error("el simulador de puertos PTY requiere Linux / POSIX")
    if args.segment_seconds < 0 or args.segment_seconds > 600:
        parser.error("--segment-seconds debe estar entre 0 (modo clasico) y 600")
    sim = RTUServer(Furnace(slave_id=args.slave_id, speed=args.speed,
                            segment_seconds=args.segment_seconds))
    sim.serve()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
