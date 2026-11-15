import argparse
import fcntl
import os
import math
from pathlib import Path
import signal
import sys
from . import __version__
from .modbus import SimulatedRTU
from .store import Store
from .worker import Worker
from .server import Application, serve


def main():
    parser = argparse.ArgumentParser(description="CJD Control Panel · simulador aislado, sin horno físico")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--no-auth", action="store_true", help="Permitir acceso sin contraseña, también por LAN")
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--segment-seconds", type=float, default=10, help="Duración real de cada tramo simulado")
    args = parser.parse_args()
    token = None if args.no_auth else os.environ.get("CJD_ACCESS_TOKEN")
    if not args.no_auth and args.host not in ("127.0.0.1", "localhost") and (not token or len(token) < 20):
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
        worker = Worker(SimulatedRTU(segment_seconds=args.segment_seconds), store)
        try:
            try:
                server = serve(Application(worker, store, token, args.host), args.host, args.port)
            except OSError as exc:
                parser.exit(1, f"No se puede abrir el servidor local: {exc}\n")
            worker.start()
            def stop(signum, frame):
                raise KeyboardInterrupt
            signal.signal(signal.SIGTERM, stop)
            print(f"CJD Control Panel {__version__} · http://{args.host}:{server.server_port}", flush=True)
            print("Modo SIMULADOR. No se abre ningún puerto del horno físico.", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
        finally:
            if worker.thread.is_alive():
                worker.close()
            else:
                worker.adapter.close()
            store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
