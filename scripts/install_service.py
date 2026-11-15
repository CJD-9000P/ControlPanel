"""Instala systemd --user con linger, conservando la carpeta data del proyecto."""
import argparse
from contextlib import closing
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import pwd
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from cjd_panel import __version__


UNIT_NAME='cjd-panel.service'


def quote(value, *, command=False):
    value=str(value)
    if any(c in value for c in ('\0','\n','\r')):
        raise ValueError('Ruta no válida para systemd.')
    value=value.replace('\\','\\\\').replace('"','\\"').replace('%','%%')
    if command:value=value.replace('$','$$')
    return '"'+value+'"'


def render_unit(root, python='/usr/bin/python3'):
    root=Path(root).resolve()
    args=[str(python),'-m','cjd_panel','--host','0.0.0.0','--port','8080','--no-auth',
          '--data-dir',str(root/'data'),'--mqtt-config',str(root/'.mqtt.json'),
          '--modbus-config',str(root/'.modbus.json')]
    if (root/'.panel.json').exists():
        args=[str(python),'-m','cjd_panel','--config',str(root/'.panel.json')]
    return ('[Unit]\nDescription=CJD Control Panel\nStartLimitIntervalSec=60\nStartLimitBurst=5\n\n'
            '[Service]\nType=simple\nWorkingDirectory='+quote(root)[1:-1]+'\nExecStart='+
            ' '.join(quote(arg,command=True) for arg in args)+
            '\nEnvironment=PYTHONUNBUFFERED=1\nRestart=on-failure\nRestartSec=3\n'
            'TimeoutStopSec=60\nUMask=0077\nNoNewPrivileges=true\n\n'
            '[Install]\nWantedBy=default.target\n')


def manual_instances(root):
    result=[]
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():continue
        try:
            if entry.stat().st_uid!=os.getuid() or (entry/'cwd').resolve()!=root:continue
            args=(entry/'cmdline').read_bytes().decode().strip('\0').split('\0')
            if '-m' in args and args[args.index('-m')+1]=='cjd_panel':result.append(int(entry.name))
        except (OSError,ValueError,IndexError):pass
    return result


def install(root=ROOT, python='/usr/bin/python3'):
    root=Path(root).resolve()
    uid=os.getuid()
    user=pwd.getpwuid(uid)
    service_home=Path(user.pw_dir)
    if uid==0:
        raise RuntimeError('Ejecuta este instalador como el usuario del panel, sin sudo.')
    if not Path('/run/systemd/system').is_dir():
        raise RuntimeError('Este sistema no está iniciado con systemd.')
    env=os.environ.copy()
    env['XDG_RUNTIME_DIR']=f'/run/user/{uid}'
    env['DBUS_SESSION_BUS_ADDRESS']=f'unix:path=/run/user/{uid}/bus'
    def run(args, *, required=True):
        r=subprocess.run(args,env=env,capture_output=True,text=True)
        if required and r.returncode:
            raise RuntimeError('Falló '+args[0]+': '+(r.stderr.strip() or r.stdout.strip()))
        return r
    def ctl(*args,required=True):return run(['systemctl','--user','--no-ask-password',*args],required=required)
    unit=render_unit(root,python)
    preview=root/'data/service-preview'
    preview.mkdir(parents=True,exist_ok=True)
    (preview/UNIT_NAME).write_text(unit)
    # Validar antes de reemplazar la instancia que funciona.
    run(['systemd-analyze','--user','verify',str(preview/UNIT_NAME)])
    needs_admin=False
    linger=run(['loginctl','show-user',user.pw_name,'--property=Linger','--value'],required=False)
    if linger.stdout.strip()!='yes':
        result=run(['loginctl','--no-ask-password','enable-linger',user.pw_name],required=False)
        if result.returncode:
            needs_admin=True
    info=ctl('show',UNIT_NAME,'--property=LoadState,WorkingDirectory',required=False).stdout
    values=dict(line.split('=',1) for line in info.splitlines() if '=' in line)
    directory=values.get('WorkingDirectory')
    if directory and Path(directory).resolve()!=root:
        raise RuntimeError('Existe un servicio del mismo nombre para otra carpeta; no se modifica.')
    target=service_home/'.config/systemd/user'/UNIT_NAME
    target.parent.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if target.exists():
        (preview/(UNIT_NAME+'.'+stamp+'.bak')).write_bytes(target.read_bytes())
    temporary=target.with_suffix('.tmp')
    temporary.write_text(unit)
    temporary.chmod(0o644)
    os.replace(temporary,target)
    ready_limit=time.monotonic()+8
    while ctl('show-environment',required=False).returncode:
        if time.monotonic()>=ready_limit:
            ctl('--no-reload','enable',UNIT_NAME)
            raise RuntimeError('Unidad instalada y habilitada; el gestor de usuario necesita que un administrador ejecute en este equipo: loginctl enable-linger '+user.pw_name+'. La instancia manual sigue funcionando.')
        time.sleep(.2)
    ctl('daemon-reload')
    database=root/'data/cjd.sqlite3'
    if database.exists():
        with closing(sqlite3.connect('file:'+str(database)+'?mode=ro',uri=True)) as source:
            with closing(sqlite3.connect(root/'data'/('cjd.pre-service-'+stamp+'.bak'))) as destination:
                source.backup(destination)
        print('Copia consistente de datos guardada antes de instalar el servicio.',flush=True)
    ctl('stop',UNIT_NAME)
    for pid in manual_instances(root):
        os.kill(pid,signal.SIGTERM)
        limit=time.monotonic()+45
        while time.monotonic()<limit:
            try:
                if (Path('/proc')/str(pid)/'stat').read_text().split()[2]=='Z':break
            except FileNotFoundError:break
            time.sleep(.1)
        else:raise RuntimeError('El proceso anterior no terminó; no se arranca otro worker.')
    ctl('enable',UNIT_NAME)
    ctl('start',UNIT_NAME)
    from cjd_panel.config import PanelConfig
    settings=PanelConfig.read(root/'.panel.json') if (root/'.panel.json').exists() else PanelConfig()
    limit=time.monotonic()+20
    state=None
    while time.monotonic()<limit:
        if ctl('is-active',UNIT_NAME,required=False).stdout.strip()=='active':
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{settings.port}/healthz',timeout=2) as response:state=json.load(response)
                if state.get('version')==__version__:break
            except (OSError,ValueError):pass
        time.sleep(.3)
    else:raise RuntimeError('No se confirmó la API del servicio. Consulta journalctl --user -u '+UNIT_NAME)
    enabled=ctl('is-enabled',UNIT_NAME).stdout.strip()
    active=ctl('is-active',UNIT_NAME).stdout.strip()
    linger=run(['loginctl','show-user',user.pw_name,'--property=Linger','--value']).stdout.strip()
    if enabled!='enabled' or active!='active':
        raise RuntimeError('No se confirmó el servicio activo y habilitado.')
    pid=ctl('show',UNIT_NAME,'--property=MainPID','--value').stdout.strip()
    instances=manual_instances(root)
    if instances!=[int(pid)]:
        raise RuntimeError('No se pudo confirmar un único proceso del panel.')
    report=dict(version=state['version'],unit=UNIT_NAME,user=user.pw_name,active=active,
                enabled=enabled,linger=linger,pid=int(pid),data_dir=str(root/'data'),
                http='ok',mode=state.get('mode'),boot_ready=linger=='yes',boot_retested=False)
    (root/'data/service-check.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False),flush=True)
    if linger!='yes':
        raise RuntimeError('Servicio instalado, activo y habilitado. Falta permiso de administrador para arrancar sin sesión: ejecutar loginctl enable-linger '+user.pw_name+' en este equipo.')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--install',action='store_true',help='Instalar y activar el servicio del usuario actual')
    args=p.parse_args()
    try:
        if args.install:install()
        else:print(render_unit(ROOT),end='')
    except Exception as exc:
        print('Instalación no completada: '+str(exc),file=sys.stderr)
        sys.exit(1)
