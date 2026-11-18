"""Adaptador físico opcional: parámetros históricos y cliente exclusivo del worker."""
from dataclasses import dataclass
import fcntl
import hashlib
import importlib
import inspect
import json
import math
import os
from pathlib import Path
import sys
import termios
import time

from .model import integer
from .modbus import CommunicationError


@dataclass(frozen=True)
class SerialConfig:
    port: str = '/dev/ttyUSB1'
    baudrate: int = 9600
    bytesize: int = 8
    parity: str = 'N'
    stopbits: int = 2
    device_id: int = 1
    timeout: float = 2.0
    settle_seconds: float = 5.0
    reconnect_seconds: float = 5.0

    def __post_init__(self):
        if not isinstance(self.port, str) or not self.port.startswith('/dev/') or '\0' in self.port:
            raise ValueError('El puerto Modbus debe ser una ruta absoluta de /dev/.')
        integer(self.baudrate, 'Baudrate', 1200, 115200)
        integer(self.device_id, 'Dirección Modbus', 1, 247)
        if self.bytesize != 8 or self.parity not in ('N','E','O') or self.stopbits not in (1,2):
            raise ValueError('Parámetros serie no compatibles.')
        for key in ('timeout','settle_seconds','reconnect_seconds'):
            value = getattr(self, key)
            if isinstance(value, bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value < 0 or value > 30:
                raise ValueError(f'{key} no válido.')
        if self.timeout <= 0:
            raise ValueError('El timeout Modbus debe ser positivo.')

    @classmethod
    def read(cls, path):
        try:
            return cls(**json.loads(Path(path).read_text()))
        except (OSError, TypeError, ValueError):
            raise ValueError('No se pudo cargar la configuración Modbus.') from None


def available_serial_ports():
    """Prefer stable USB identifiers and avoid listing their tty aliases twice."""
    stable = sorted(path for path in Path('/dev/serial/by-id').glob('*')
                    if path.is_symlink() and path.exists())
    targets = {path.resolve() for path in stable}
    devices = sorted(path for pattern in ('ttyUSB*', 'ttyACM*')
                     for path in Path('/dev').glob(pattern)
                     if path.is_char_device() and path.resolve() not in targets)
    return [str(path) for path in stable + devices]


def serial_client(config):
    try:
        module = importlib.import_module('pymodbus.client')
    except ModuleNotFoundError:
        folder = Path(__file__).resolve().parent.parent/'.serial-deps'
        if folder.is_dir():
            sys.path.insert(0,str(folder))
        try:
            module = importlib.import_module('pymodbus.client')
        except ModuleNotFoundError:
            raise CommunicationError('Faltan dependencias del puerto físico; instala requirements-modbus.txt.') from None
    return module.ModbusSerialClient(port=config.port,baudrate=config.baudrate,
        bytesize=config.bytesize,parity=config.parity,stopbits=config.stopbits,
        timeout=config.timeout,retries=0)


def device_argument(client):
    # Mismo mecanismo del comunicador recuperado: detectar la firma, no reintentar
    # una escritura capturando TypeError de una llamada que pudo haber salido.
    read = inspect.signature(client.read_holding_registers).parameters
    write = inspect.signature(client.write_registers).parameters
    for name in ('device_id','slave','unit'):
        if name in read and name in write:
            return name
    raise CommunicationError('API de PyModbus no compatible con el comunicador.')


class PhysicalRTU:
    mode = 'physical'
    def __init__(self, config=None):
        self.config = config or SerialConfig()
        self.timeout = self.config.timeout
        self.port = self.config.port
        self.client = None
        self.id_argument = None
        self.lock_fd = None
        self.identity = None
        self.next_attempt = 0.0
        self.ready_at = 0.0
        self.last_error = 'Esperando conexión Modbus.'
        self.epoch = 0
        self.dynamic_block_supported = None

    def _identity(self):
        status = os.stat(self.port)
        return status.st_dev,status.st_ino,status.st_rdev

    def _close_port(self):
        if self.client is not None:
            try:
                sock = getattr(self.client,'socket',None)
                if sock is not None and getattr(sock,'is_open',False):
                    try:
                        fcntl.ioctl(sock.fileno(),termios.TIOCNXCL)
                    except OSError:
                        pass
                self.client.close()
            finally:
                self.identity = None
        if self.lock_fd is not None:
            os.close(self.lock_fd)
            self.lock_fd = None

    def _connected(self):
        sock = getattr(self.client,'socket',None)
        return bool(sock is not None and sock.is_open)

    def _ensure(self):
        now = time.monotonic()
        if self._connected():
            try:
                same = self.identity == self._identity()
            except OSError:
                same = False
            if not same:
                self._close_port()
                self.next_attempt = 0
            elif now < self.ready_at:
                raise CommunicationError('Esperando estabilización del puerto USB; todavía sin sincronizar.')
            else:
                return
        if now < self.next_attempt:
            raise CommunicationError(self.last_error)
        self.next_attempt = now+self.config.reconnect_seconds
        try:
            if not Path(self.port).exists():
                raise CommunicationError(f'Puerto {self.port} ausente; esperando USB.')
            folder = Path('/tmp/cjd-control-panel-modbus')
            folder.mkdir(mode=0o700,exist_ok=True)
            key = hashlib.sha256(os.path.realpath(self.port).encode()).hexdigest()
            self.lock_fd = os.open(folder/(key+'.lock'),os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
            fcntl.flock(self.lock_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.client = serial_client(self.config)
            self.id_argument = device_argument(self.client)
            if not self.client.connect():
                raise CommunicationError(f'No se pudo abrir {self.port}; comprueba permisos y adaptador USB.')
            self.client.socket.exclusive = True
            fcntl.ioctl(self.client.socket.fileno(),termios.TIOCEXCL)
            self.identity = self._identity()
            self.epoch += 1
            self.ready_at = time.monotonic()+self.config.settle_seconds
        except Exception as exc:
            self.last_error = f'Puerto {self.port} ocupado por otro comunicador.' if isinstance(exc, BlockingIOError) else str(exc)
            self._close_port()
            raise CommunicationError(self.last_error) from None
        if self.config.settle_seconds:
            raise CommunicationError('Esperando estabilización del puerto USB; todavía sin sincronizar.')

    def _validate(self, response):
        if response is None or response.isError():
            raise CommunicationError('Respuesta Modbus nula o de excepción.')
        if getattr(response,'dev_id',self.config.device_id) != self.config.device_id:
            raise CommunicationError('Respuesta de otra dirección Modbus.')

    def read(self, address, count=1):
        if address == 0xC9 and count == 6:
            if self.dynamic_block_supported is not False:
                try:
                    values = self._read(address,count)
                    self.dynamic_block_supported = True
                    return values
                except CommunicationError:
                    if self.dynamic_block_supported is not None:
                        raise
                    self.dynamic_block_supported = False
            # Respaldo del comunicador: C9/CA, CC y CD/CE; CB no se utiliza.
            return self._read(0xC9,2)+[0]+self._read(0xCC,1)+self._read(0xCD,2)
        return self._read(address,count)

    def _read(self, address, count=1):
        self._ensure()
        try:
            response = self.client.read_holding_registers(address=address,count=count,
                **{self.id_argument:self.config.device_id})
            self._validate(response)
            if not hasattr(response,'registers') or len(response.registers) != count:
                raise CommunicationError('Número de registros Modbus incorrecto.')
            return [value-65536 if value & 0x8000 else value for value in response.registers]
        except Exception as exc:
            self.last_error = f'Lectura Modbus fallida: {exc}'
            self._close_port()
            self.next_attempt = time.monotonic()+self.config.reconnect_seconds
            raise CommunicationError(self.last_error) from None

    def write(self, address, values):
        # Nunca abrir/reconectar desde una escritura: primero debe sincronizar lectura.
        if not self._connected() or time.monotonic()<self.ready_at:
            raise CommunicationError('Puerto no sincronizado para escribir; no se envió la orden.')
        try:
            if self.identity != self._identity():
                raise CommunicationError('El dispositivo USB cambió antes de escribir.')
            response = self.client.write_registers(address=address,values=[v & 0xffff for v in values],
                **{self.id_argument:self.config.device_id})
            self._validate(response)
            if response.address != address or response.count != len(values):
                raise CommunicationError('ACK Modbus incorrecto.')
        except Exception as exc:
            self.last_error = f'Escritura no confirmada: {exc}'
            self._close_port()
            # Permitir la relectura inmediata del worker, nunca el reenvío de la escritura.
            self.next_attempt = 0
            raise CommunicationError(self.last_error) from None

    def simulate(self, action):
        raise ValueError('Las herramientas del simulador están desactivadas en modo físico.')

    def close(self):
        self._close_port()
