"""Update an installed user service from the project's published branches."""
import ast
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request

from . import __version__

LAUNCHER = 'https://raw.githubusercontent.com/CJD-9000P/ControlPanel/main/bin/instalar-cjd.sh'
ARCHIVE = 'https://codeload.github.com/CJD-9000P/ControlPanel/tar.gz/refs/heads/version/'
SERVICE = 'cjd-panel.service'
VERSION = r'[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}'
ARCHIVE_LIMIT = 64 * 1024 * 1024


def systemctl(*args, timeout=15):
    return subprocess.check_output(
        ['systemctl', '--user', '--no-ask-password', *args], text=True, timeout=timeout
    ).strip()


def version_key(version):
    return tuple(map(int, version.split('.')))


def published_version():
    with urllib.request.urlopen(LAUNCHER, timeout=8) as response:
        launcher = response.read(16_385).decode('utf-8')
    match = re.search(r'^CJD_VERSION=\x27(' + VERSION + r')\x27$', launcher, re.MULTILINE)
    if not match or len(launcher) > 16_384:
        raise ValueError('El lanzador publicado no contiene una versión válida.')
    version = match.group(1)
    return version if version_key(version) > version_key(__version__) else None


def unpack_release(version, directory):
    if not re.fullmatch(VERSION, version):
        raise ValueError('Versión de actualización no válida.')
    archive = directory / 'release.tar.gz'
    source = directory / 'source'
    source.mkdir()
    deadline = time.monotonic() + 120
    with urllib.request.urlopen(ARCHIVE + version, timeout=15) as response:
        with archive.open('wb') as output:
            for block in iter(lambda: response.read(128 * 1024), b''):
                if time.monotonic() >= deadline:
                    raise TimeoutError('La descarga de la actualización ha tardado demasiado.')
                if output.tell() + len(block) > ARCHIVE_LIMIT:
                    raise ValueError('El paquete publicado supera el tamaño permitido.')
                output.write(block)
    total = 0
    with tarfile.open(archive, 'r:gz') as package:
        for member in package:
            parts = Path(member.name).parts
            if not parts or member.name.startswith('/') or '..' in parts:
                raise ValueError('Ruta no válida en el paquete publicado.')
            if member.isdir():
                continue
            total += member.size
            if not member.isfile() or len(parts) < 2 or total > ARCHIVE_LIMIT:
                raise ValueError('Contenido no válido en el paquete publicado.')
            target = source.joinpath(*parts[1:])
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.extractfile(member) as incoming, target.open('xb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
    module = ast.parse((source / 'cjd_panel/__init__.py').read_bytes())
    versions = [ast.literal_eval(node.value) for node in module.body
                if isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == '__version__' for target in node.targets)]
    if versions != [version]:
        raise ValueError('La versión descargada no coincide con la publicada.')
    return source


class ProgramUpdater:
    def __init__(self, root, data_dir, port, worker):
        self.root = root
        self.data_dir = data_dir
        self.port = port
        self.worker = worker
        self.lock = threading.Lock()
        self.next_check = 0
        self.version = None
        self.running = False
        self.error = None

    @classmethod
    def for_service(cls, root, data_dir, port, worker):
        if not os.environ.get('INVOCATION_ID') or not shutil.which('systemd-run'):
            return None
        try:
            if systemctl('show', SERVICE, '--property=MainPID', '--value', timeout=3) == str(os.getpid()):
                return cls(root, data_dir, port, worker)
        except (OSError, subprocess.SubprocessError):
            pass
        return None

    def _check(self):
        try:
            version = published_version()
        except (OSError, ValueError, HTTPException):
            version = None
        with self.lock:
            self.version = version

    def snapshot(self, state):
        with self.lock:
            if time.monotonic() >= self.next_check:
                self.next_check = time.monotonic() + 300
                threading.Thread(target=self._check, daemon=True).start()
            available = self.version if state['update_idle'] and not self.running else None
            try:
                error = json.loads((self.data_dir / 'update-error.json').read_text())
            except (OSError, ValueError):
                error = self.error
            return {'version': available, 'running': self.running or state['update_pending'], 'error': error}

    def start(self, version):
        with self.lock:
            if self.running or not self.version or version != self.version:
                raise ValueError('No hay una actualización disponible para iniciar.')
            if not self.worker.snapshot()['update_idle']:
                raise ValueError('El programador debe estar parado y comunicado, sin una cocción programada.')
            (self.data_dir / 'update-error.json').unlink(missing_ok=True)
            self.running, self.error = True, None
        threading.Thread(target=self._prepare, args=(version,), daemon=True).start()

    def _prepare(self, version):
        directory = None
        try:
            directory = Path(tempfile.mkdtemp(prefix='.cjd-update-', dir=self.root))
            source = unpack_release(version, directory)
            # Keep the existing environment. Dependency changes use the assisted installer.
            dependency_files = {'installer-wheels.json'}
            dependency_files.update(p.name for p in self.root.glob('requirements*.txt'))
            dependency_files.update(p.name for p in source.glob('requirements*.txt'))
            if any(not (source / name).is_file() or not (self.root / name).is_file()
                   or (source / name).read_bytes() != (self.root / name).read_bytes()
                   for name in dependency_files):
                raise ValueError('Esta versión requiere actualizar las dependencias con el instalador de terminal.')
            from scripts.install import copy_sources
            prepared = directory / 'prepared'
            copy_sources(source, prepared)
            runner = directory / 'apply_update.py'
            shutil.copy2(self.root / 'scripts/apply_update.py', runner)

            def launch():
                subprocess.run(
                    ['systemd-run', '--user', '--quiet', '--no-block',
                     '--unit=cjd-panel-update', '--property=UMask=0077',
                     sys.executable, str(runner),
                     str(self.root), str(self.data_dir), str(self.port), version],
                    check=True, timeout=8,
                )

            self.worker.submit('prepare_update', {'launch': launch}).result()
            directory = None  # The transient service owns the staged files.
        except (OSError, ValueError, RuntimeError, SyntaxError, EOFError, HTTPException,
                tarfile.TarError, subprocess.SubprocessError) as exc:
            with self.lock:
                self.error = str(exc)
        finally:
            if directory:
                shutil.rmtree(directory, ignore_errors=True)
            with self.lock:
                self.running = False
