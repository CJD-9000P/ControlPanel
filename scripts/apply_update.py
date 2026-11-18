"""Apply staged sources from a transient systemd user service."""
from contextlib import closing
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request

SERVICE = 'cjd-panel.service'


def systemctl(*args):
    return subprocess.check_output(
        ['systemctl', '--user', '--no-ask-password', *args], text=True, timeout=75
    ).strip()


def wait_for_version(port, version):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            with opener.open(f'http://127.0.0.1:{port}/healthz', timeout=2) as response:
                state = json.load(response)
            if state == {'status': 'ok', 'version': version}:
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise RuntimeError('El servicio actualizado no respondió con la versión esperada.')


def apply(root, data, port, version, workspace):
    prepared = workspace / 'prepared'
    previous = workspace / 'previous'
    previous.mkdir()
    if Path(systemctl('show', SERVICE, '--property=WorkingDirectory', '--value')).resolve() != root:
        raise RuntimeError('La carpeta del servicio ha cambiado.')
    systemctl('stop', SERVICE)
    backups, installed = [], []
    try:
        with (data / 'service.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            database = data / ('cjd.pre-update-' + stamp + '.bak')
            with closing(sqlite3.connect(data / 'cjd.sqlite3')) as active:
                with closing(sqlite3.connect(database)) as backup:
                    active.backup(backup)
            for incoming in sorted(prepared.iterdir()):
                target = root / incoming.name
                if target.exists() or target.is_symlink():
                    target.rename(previous / target.name)
                    backups.append(target)
                incoming.rename(target)
                installed.append(target)
        systemctl('start', SERVICE)
        wait_for_version(port, version)
    except Exception:
        systemctl('stop', SERVICE)
        with (data / 'service.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for target in installed:
                target.rename(prepared / target.name)
            for target in backups:
                (previous / target.name).rename(target)
        systemctl('reset-failed', SERVICE)
        systemctl('start', SERVICE)
        raise


def main():
    root, data = map(Path, sys.argv[1:3])
    port, version = int(sys.argv[3]), sys.argv[4]
    workspace = Path(__file__).resolve().parent
    try:
        apply(root, data, port, version, workspace)
    except Exception:
        error = 'No se pudo actualizar el programa. Consulta el registro cjd-panel-update.service.'
        (data / '.update-error.tmp').write_text(json.dumps(error))
        os.replace(data / '.update-error.tmp', data / 'update-error.json')
        raise
    else:
        shutil.rmtree(workspace)


if __name__ == '__main__':
    main()
