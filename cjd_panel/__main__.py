import argparse
import fcntl
import os
import math
import json
from pathlib import Path
import signal
import sys
from . import __version__
from .config import PanelConfig
from .auth import read_record
from .modbus import SimulatedRTU
from .serial_adapter import PhysicalRTU, SerialConfig
from .store import Store
from .worker import Worker
from .server import Application, serve


def main():
    parser = argparse.ArgumentParser(description="CJD Control Panel · simulador o Modbus RTU/USB")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    parser.add_argument("--no-auth", action="store_true", help="Permitir acceso sin contraseña, también por LAN")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--segment-seconds", type=float, default=10, help="Duración real de cada tramo simulado")
    parser.add_argument('--mqtt-config', type=Path, help='Archivo privado MQTT opcional')
    parser.add_argument('--no-mqtt', action='store_true', help='Desactivar MQTT y usar solo el panel local')
    parser.add_argument('--modbus-config',type=Path,help='Configuración serie opcional; por defecto /dev/ttyUSB1, 9600 8N2, dirección 1')
    parser.add_argument('--config',type=Path,default=Path('.panel.json'),help='Configuración privada generada por el instalador')
    args = parser.parse_args()
    configured=args.config.exists()
    try:
        settings=PanelConfig.read(args.config) if configured else PanelConfig()
        base=args.config.resolve().parent
        args.host=args.host if args.host is not None else settings.host
        args.port=args.port if args.port is not None else settings.port
        args.data_dir=args.data_dir or settings.resolve(base,'data_dir')
        args.mqtt_config=args.mqtt_config or settings.resolve(base,'mqtt_config')
        args.modbus_config=args.modbus_config or settings.resolve(base,'modbus_config')
        auth_record=read_record(settings.resolve(base,'auth_file')) if configured and settings.auth_required and not args.no_auth else None
        serial_config = SerialConfig.read(args.modbus_config) if args.modbus_config.exists() else SerialConfig()
    except ValueError as exc:
        parser.error(str(exc))
    mqtt_config = None
    if not args.no_mqtt and (not configured or settings.mqtt_enabled) and args.mqtt_config.exists():
        from .mqtt_bridge import MQTTConfig
        try:
            mqtt_config = MQTTConfig.read(args.mqtt_config)
        except ValueError as exc:
            parser.error(str(exc))
    token = None if args.no_auth or configured else os.environ.get("CJD_ACCESS_TOKEN")
    anonymous=args.no_auth or configured and not settings.auth_required
    if not anonymous and not auth_record and args.host not in ("127.0.0.1", "localhost") and (not token or len(token) < 20):
        parser.error("Configura CJD_ACCESS_TOKEN con al menos 20 caracteres o usa --no-auth para acceso sin contraseña.")
    if not math.isfinite(args.segment_seconds) or args.segment_seconds <= 0:
        parser.error("--segment-seconds debe ser positivo.")
    args.data_dir.mkdir(parents=True, exist_ok=True)
    with (args.data_dir / "service.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.exit(1, "Ya hay un servicio usando este directorio de datos.\n")
        store = Store(args.data_dir / "cjd.sqlite3")
        settings_path = args.data_dir/'connection.json'
        mode = 'simulator'
        if settings_path.exists():
            try:
                mode = json.loads(settings_path.read_text())['mode']
                if mode not in ('simulator','physical'):
                    raise ValueError('modo no válido')
            except (OSError,ValueError,KeyError,TypeError):
                store.close()
                parser.error('No se pudo leer el modo de conexión guardado.')
        def adapter_factory(selected):
            return SimulatedRTU(segment_seconds=args.segment_seconds) if selected=='simulator' else PhysicalRTU(serial_config)
        worker = Worker(adapter_factory(mode),store,adapter_factory=adapter_factory,settings_path=settings_path)
        bridge = None
        try:
            if mqtt_config:
                from .mqtt_bridge import MQTTBridge
                bridge = MQTTBridge(worker, store, mqtt_config, args.data_dir/'mqtt-commands.sqlite3')
            try:
                server = serve(Application(worker, store, token, args.host, bridge, auth_record), args.host, args.port)
            except OSError as exc:
                parser.exit(1, f"No se puede abrir el servidor local: {exc}\n")
            worker.start()
            if bridge:
                bridge.start()
                print(f'MQTT opcional: {mqtt_config.host}:{mqtt_config.port} · {mqtt_config.topic_prefix}', flush=True)
            def stop(signum, frame):
                raise KeyboardInterrupt
            signal.signal(signal.SIGTERM, stop)
            print(f"CJD Control Panel {__version__} · http://{args.host}:{server.server_port}", flush=True)
            print(f"Modo inicial: {mode}. Puerto físico configurado: {serial_config.port}.",flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
        finally:
            if bridge:
                bridge.close()
            if worker.thread.is_alive():
                worker.close()
            else:
                worker.adapter.close()
            store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
