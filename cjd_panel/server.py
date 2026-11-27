"""Servidor local WSGI y API JSON; MQTT opcional, recursos web locales."""
from concurrent.futures import TimeoutError
import csv
from datetime import datetime, timezone
import hmac
import io
from ipaddress import ip_address
import json
import mimetypes
from pathlib import Path
import tempfile
from urllib.parse import parse_qs, urlsplit
import uuid
from wsgiref.simple_server import make_server, WSGIServer
from socketserver import ThreadingMixIn
from . import __version__
from .auth import PasswordVerifier, supplied_password
from .model import integer, utcnow
from .modbus import CommunicationError

STATIC = Path(__file__).parent / "static"
MAX_BODY = 32 * 1024 * 1024
CSV_FIELDS = ["timestamp", "pv", "sv", "state", "step", "minutes", "memory"]
LEGACY_FIRING_FIELDS = {"fecha", "hora", "PV", "SV", "segmento", "estado", "tiempo_CJD"}


def csv_bytes(fields, rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("utf-8-sig")


class Application:
    def __init__(self, worker, store, token=None, host="127.0.0.1", mqtt_bridge=None, password_record=None, updater=None):
        self.worker, self.store, self.token, self.host = worker, store, token, host
        self.mqtt_bridge = mqtt_bridge
        self.updater = updater
        self.password_verifier = PasswordVerifier(password_record) if password_record else None

    def __call__(self, env, start_response):
        try:
            status, headers, body = self.handle(env)
        except KeyError as exc:
            status, headers, body = self.error(404, str(exc.args[0]))
        except (ValueError, TypeError, UnicodeError, csv.Error) as exc:
            status, headers, body = self.error(400, str(exc))
        except CommunicationError as exc:
            status, headers, body = self.error(503, str(exc))
        except TimeoutError:
            status, headers, body = self.error(504, "La orden sigue en curso o su resultado es incierto. Consulta el estado antes de repetirla.")
        except Exception:
            import traceback
            traceback.print_exc()
            status, headers, body = self.error(500, "Error interno. Consulta el registro del servicio.")
        headers += [("Content-Length", str(len(body))), ("Cache-Control", "no-store"),
                    ("X-Content-Type-Options", "nosniff"),
                    ("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
                    ("Referrer-Policy", "no-referrer")]
        start_response(f"{status} { {200:'OK',201:'Created',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',405:'Method Not Allowed',413:'Payload Too Large',500:'Internal Server Error',503:'Service Unavailable',504:'Gateway Timeout'}.get(status,'Error')}", headers)
        return [body]

    @staticmethod
    def json(data, status=200):
        return status, [("Content-Type", "application/json; charset=utf-8")], json.dumps(data, ensure_ascii=False, allow_nan=False).encode()

    def error(self, status, message):
        return self.json({"error": message}, status)

    @staticmethod
    def download(body, filename, content_type):
        return 200, [("Content-Type", content_type), ("Content-Disposition", f'attachment; filename="{filename}"')], body

    def handle(self, env):
        method, path = env["REQUEST_METHOD"], env.get("PATH_INFO", "/")
        request_host = urlsplit("//" + env.get("HTTP_HOST", "")).hostname
        if self.host in ("127.0.0.1", "localhost") and request_host not in ("127.0.0.1", "localhost"):
            return self.error(403, "Host no autorizado.")
        if method not in ("GET", "POST", "PUT", "DELETE"):
            return self.error(405, "Método no permitido.")
        if path == '/healthz':
            if method != 'GET':return self.error(405,'Método no permitido.')
            return self.json({'status':'ok','version':__version__})
        if not path.startswith("/api/"):
            if method != "GET":
                return self.error(405, "Método no permitido.")
            compact = path in {"/movil", "/movil/"}
            filename = "index.html" if path == "/" or compact else path.removeprefix("/")
            if filename not in {"index.html", "app.js", "style.css", "logo-cjd.png"}:
                raise KeyError("Recurso no encontrado.")
            content_type = mimetypes.guess_type(filename)[0]
            if filename != "logo-cjd.png":
                content_type += "; charset=utf-8"
            body = (STATIC / filename).read_bytes()
            if compact:
                body = body.replace(b"<body>", b'<body class="compact-panel">', 1)
            return 200, [("Content-Type", content_type)], body
        if self.token or self.password_verifier:
            candidate=supplied_password(env.get('HTTP_AUTHORIZATION',''))
            authorized=(self.password_verifier.verify(candidate) if self.password_verifier else
                candidate is not None and hmac.compare_digest(candidate.encode('utf-8'),self.token.encode('utf-8')))
            if not authorized:
                return self.error(401, "Introduce la clave de acceso del servicio.")
        data = None
        if method != "GET":
            if env.get("HTTP_X_CJD_REQUEST") != "1":
                return self.error(403, "Falta la cabecera de solicitud local.")
            origin = env.get("HTTP_ORIGIN")
            if origin and urlsplit(origin).netloc != env.get("HTTP_HOST"):
                return self.error(403, "Origen de solicitud no permitido.")
            length = int(env.get("CONTENT_LENGTH") or 0)
            if not 0 <= length <= MAX_BODY:
                return self.error(413, "El archivo supera 32 MiB.")
            raw = env["wsgi.input"].read(length)
            if method != "DELETE":
                if "application/json" in env.get("CONTENT_TYPE", ""):
                    data = json.loads(raw)
                    if not isinstance(data, dict):
                        raise ValueError("Se esperaba un objeto JSON.")
                else:
                    data = raw.decode("utf-8-sig")
        parts = path.strip("/").split("/")
        updates_allowed = self.updater and (
            self.token or self.password_verifier or (
                request_host in ('127.0.0.1', 'localhost')
                and ip_address(env.get('REMOTE_ADDR') or '0.0.0.0').is_loopback
            )
        )
        if path == "/api/state" and method == "GET":
            state = self.worker.snapshot()
            return self.json({**state, "version": __version__,
                "update": self.updater.snapshot(state) if updates_allowed else {},
                "mqtt": self.mqtt_bridge.snapshot() if self.mqtt_bridge else {"enabled": False, "connected": False}})
        if path == "/api/update" and method == "POST":
            if not updates_allowed:
                return self.error(403, 'La actualización requiere el servicio instalado y acceso local o autenticado.')
            if not isinstance(data, dict):
                raise ValueError('Se esperaba una versión publicada.')
            self.updater.start(data.get('version'))
            return self.json({'message': 'Preparando la actualización del programa.'})
        if path == "/api/events" and method == "GET":
            cursor = parse_qs(env.get("QUERY_STRING", ""), keep_blank_values=True).get("before")
            before = None if cursor is None else integer(int(cursor[0]), "Evento", 1, 2**63-1)
            return self.json(self.store.events(before=before))
        if path == "/api/profiles":
            if method == "GET":
                return self.json(self.store.profiles())
            if method == "POST":
                return self.json(self.store.save_profile(data), 201)
        if path == "/api/profiles/import" and method == "POST":
            reader = csv.DictReader(io.StringIO(data))
            if not reader.fieldnames or not {"name", "segment", "temperature", "minutes"}.issubset(reader.fieldnames):
                raise ValueError("CSV de curva no compatible: faltan columnas obligatorias.")
            rows = list(reader)
            if len(rows) != 20:
                raise ValueError("El CSV de curva debe contener 20 puntos.")
            for i, row in enumerate(rows, 1):
                if int(row["segment"]) != i:
                    raise ValueError("Los puntos del CSV deben ir ordenados de 1 a 20.")
            result = self.store.save_profile({"name": rows[0]["name"], "notes": rows[0].get("notes", ""),
                "segments": [{"temperature": int(r["temperature"]), "minutes": int(r["minutes"])} for r in rows]})
            return self.json(result, 201)
        if len(parts) >= 3 and parts[1] == "profiles":
            ident = parts[2]
            if len(parts) == 4 and parts[3] == "csv" and method == "GET":
                p = self.store.get_profile(ident)
                rows = [{"name": p["name"], "notes": p["notes"], "segment": i, **s} for i,s in enumerate(p["segments"], 1)]
                return self.download(csv_bytes(["name", "notes", "segment", "temperature", "minutes"], rows), "curva.csv", "text/csv; charset=utf-8")
            if len(parts) == 3:
                if method == "GET":
                    return self.json(self.store.get_profile(ident))
                if method == "PUT":
                    return self.json(self.store.save_profile(data, ident))
                if method == "DELETE":
                    self.store.delete_profile(ident)
                    return self.json({"message": "Curva eliminada."})
        if path == "/api/commands" and method == "POST":
            if not isinstance(data, dict):
                raise ValueError("Se esperaba una orden JSON.")
            future = self.worker.submit(data.get("operation"), data)
            try:
                return self.json(future.result(timeout=15))
            except TimeoutError:
                future.cancel()  # Si seguía en cola, impedir una ejecución tardía.
                raise
        if path == "/api/firings" and method == "GET":
            return self.json(self.store.firings())
        if path == "/api/firings/import" and method == "POST":
            return self.json(self.import_firing(data), 201)
        if len(parts) == 3 and parts[1] == 'firings':
            if method == 'PUT':
                return self.json(self.store.update_firing(parts[2], data))
            if method == 'DELETE':
                self.store.delete_firing(parts[2])
                return self.json({'message': 'Cocción eliminada con sus lecturas y eventos.'})
        if len(parts) in (3,4) and parts[1] == "firings" and method == "GET":
            ident = parts[2]
            exporting = len(parts) == 4 and parts[3] == "csv"
            if len(parts) == 4 and not exporting:
                raise KeyError("Recurso no encontrado.")
            f = self.store.firing(ident, chart=not exporting)
            if exporting:
                return self.download(csv_bytes(CSV_FIELDS, f["readings"]), f"coccion-{ident}.csv", "text/csv; charset=utf-8")
            return self.json(f)
        if path == "/api/backup" and method == "GET":
            with tempfile.TemporaryDirectory() as directory:
                dest = Path(directory) / "cjd.sqlite3"
                self.store.backup(dest)
                return self.download(dest.read_bytes(), "cjd-backup.sqlite3", "application/vnd.sqlite3")
        raise KeyError("Recurso o método no encontrado.")

    def import_firing(self, text):
        text = text.removeprefix("\ufeff")
        reader = csv.DictReader(io.StringIO(text))
        legacy = not set(CSV_FIELDS).issubset(reader.fieldnames or ())
        if legacy:
            reader = csv.DictReader(io.StringIO(text), delimiter=";")
            if not LEGACY_FIRING_FIELDS.issubset(reader.fieldnames or ()):
                raise ValueError("CSV no compatible. Usa un histórico del comunicador CJD o un CSV exportado por el panel.")
        rows = []
        previous = None
        for r in reader:
            if legacy:
                stamp = r.get("timestamp_utc") or datetime.fromisoformat(
                    f'{r["fecha"]}T{r["hora"]}').astimezone().isoformat()
                r = {"timestamp": stamp, "pv": r["PV"], "sv": r["SV"], "state": r["estado"],
                     "step": r["segmento"], "minutes": r["tiempo_CJD"], "memory": "0"}
            stamp = datetime.fromisoformat(r["timestamp"])
            if stamp.tzinfo is None:
                raise ValueError("Las fechas CSV deben incluir zona horaria.")
            stamp = stamp.astimezone(timezone.utc).isoformat(timespec="milliseconds")
            if previous and stamp < previous:
                raise ValueError("Las lecturas deben estar ordenadas por fecha.")
            previous = stamp
            pv, sv = float(r["pv"]), float(r["sv"])
            if not (-32768 <= pv <= 32767 and -32768 <= sv <= 32767):
                raise ValueError("Temperaturas CSV inválidas.")
            rows.append((stamp, pv, sv, integer(int(r["state"]), "Estado",0,2),
                         integer(int(r["step"]), "Segmento",0 if r["memory"] == "0" else 1,20),
                         integer(int(r["minutes"]), "Tiempo",0,32767),
                         integer(int(r["memory"]), "Memoria",0,4)))
        if not rows:
            raise ValueError("CSV vacío.")
        ident = uuid.uuid4().hex
        with self.store.lock, self.store.db:
            self.store.db.execute("INSERT INTO firings(id,name,started_at,ended_at,status,memory,snapshot,origin) VALUES(?,?,?,?,?,?,?,?)",
                (ident, "Cocción importada", rows[0][0], rows[-1][0], "imported", rows[0][-1], "[]", "import"))
            self.store.db.executemany("INSERT INTO readings(firing_id,timestamp,pv,sv,state,step,minutes,memory) VALUES(?,?,?,?,?,?,?,?)",
                                     [(ident,*r) for r in rows])
            self.store.db.execute("INSERT INTO events(firing_id,timestamp,kind,origin,message) VALUES(?,?,?,?,?)",
                (ident, utcnow(), "imported", "import", "CSV importado. No incluye snapshot de curva ni atribución de órdenes."))
        return {"id": ident, "samples": len(rows)}


class ThreadedServer(ThreadingMixIn, WSGIServer):
    daemon_threads = False


def serve(app, host, port):
    return make_server(host, port, app, server_class=ThreadedServer)
