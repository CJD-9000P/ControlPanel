"""Asistente de instalación local. No conecta al horno durante la instalación."""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import venv
import zipfile

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from cjd_panel.auth import password_record
from cjd_panel.config import PanelConfig
from cjd_panel.mqtt_bridge import MQTTConfig


def private_json(path,value):
    path=Path(path)
    temporary=path.with_name(path.name+'.tmp')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    os.fchmod(fd,0o600)
    with os.fdopen(fd,'w') as file:json.dump(value,file,ensure_ascii=False,indent=2)
    os.replace(temporary,path)


def yes(prompt,default=True):
    while True:
        value=input(prompt+(' [S/n]: ' if default else ' [s/N]: ')).strip().lower()
        if not value:return default
        if value in ('s','si','sí','y','yes'):return True
        if value in ('n','no'):return False
        print('Responde sí o no.')


def port(prompt,default,minimum=1024):
    while True:
        try:
            value=int(input(f'{prompt} [{default}]: ').strip() or default)
            if minimum<=value<=65535:return value
        except ValueError:pass
        print(f'Usa un puerto entre {minimum} y 65535.')


def dependencies(root,mqtt,usb,wheelhouse=None):
    python=root/'.venv/bin/python'
    venv.EnvBuilder(with_pip=False).create(root/'.venv')
    names=(['paho-mqtt'] if mqtt else [])+(['pymodbus','pyserial'] if usb else [])
    if not names:return python
    cache=root/'data/installer-wheels'
    cache.mkdir(parents=True,exist_ok=True)
    lock=json.loads((root/'installer-wheels.json').read_text())
    for name in ['pip',*names]:
        item=lock[name]
        filename=item['filename']
        if Path(filename).name!=filename:raise ValueError('Nombre de wheel no válido.')
        destination=cache/filename
        if wheelhouse:
            shutil.copyfile(Path(wheelhouse)/filename,destination)
        elif not destination.exists():
            print('Descargando dependencia: '+name,flush=True)
            with urllib.request.urlopen(item['url'],timeout=60) as response:
                destination.write_bytes(response.read())
        if hashlib.sha256(destination.read_bytes()).hexdigest()!=item['sha256']:
            destination.unlink()
            raise ValueError('La verificación SHA-256 falló: '+name)
    with tempfile.TemporaryDirectory() as temporary:
        with zipfile.ZipFile(cache/lock['pip']['filename']) as archive:
            if any(Path(n).is_absolute() or '..' in Path(n).parts for n in archive.namelist()):
                raise ValueError('Wheel no válido.')
            archive.extractall(temporary)
        bootstrap="import runpy,sys;sys.path.insert(0,sys.argv.pop(1));sys.argv[0]='pip';runpy.run_module('pip',run_name='__main__')"
        common=['--isolated','install','--no-deps','--no-user','--require-hashes','--no-index','--find-links',str(cache)]
        subprocess.run([str(python),'-I','-c',bootstrap,temporary,*common,'--ignore-installed','-r',str(root/'requirements-bootstrap.txt')],check=True)
    for enabled,name in ((mqtt,'mqtt'),(usb,'modbus')):
        if enabled:subprocess.run([str(python),'-I','-m','pip',*common,'-r',str(root/f'requirements-{name}.txt')],check=True)
    return python


def copy_sources(source,destination):
    # La lista pública del empaquetador excluye datos y todos los archivos privados.
    # Misma selección que el paquete distribuible, sin generar un tar en el origen.
    roots=['bin','cjd_panel','scripts','packaging','tests','docs','ui_reference','fuentes_referencia']
    files=[p for name in roots for p in (source/name).rglob('*') if p.is_file()]
    files+=list(source.glob('*.md'))+list(source.glob('requirements*.txt'))
    files += [source/n for n in ('installer-wheels.json','instalar.sh','instalar-fedora.sh','iniciar.sh','.gitignore','mqtt.example.json','modbus.example.json')]
    excluded={'.mqtt.json','.modbus.json','.panel.json','.web-auth.json','.env','CJD9000P_Fedora_CJD_V7_3.py'}
    for file in files:
        if not file.is_file() or '__pycache__' in file.parts or file.suffix=='.pyc' or file.name in excluded:continue
        target=destination/file.relative_to(source)
        target.parent.mkdir(parents=True,exist_ok=True)
        if file.resolve()!=target.resolve():shutil.copy2(file,target)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wheelhouse',type=Path,help='Carpeta de wheels verificados para instalación sin Internet')
    args=parser.parse_args()
    if os.getuid()==0:raise ValueError('Ejecuta ./instalar.sh como usuario normal, sin sudo.')
    destination=Path(input(f'Carpeta de instalación [{Path.home()/"cjd-control-panel"}]: ').strip() or Path.home()/'cjd-control-panel').expanduser().resolve()
    if destination==Path('/') or destination==Path.home():raise ValueError('Elige una subcarpeta propia para la aplicación.')
    if (destination/'data/service.lock').exists():
        import fcntl
        with (destination/'data/service.lock').open('a') as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise ValueError('El panel está en ejecución. Detén su servicio o proceso antes de actualizar esta carpeta; se conservarán sus datos.') from None
    mqtt=yes('¿Activar integración MQTT?',False)
    mqtt_data=None
    if mqtt:
        if (destination/'.mqtt.json').exists() and yes('¿Conservar la configuración MQTT existente?'):
            MQTTConfig.read(destination/'.mqtt.json')
        else:
            host=input('IP o nombre del servidor MQTT: ').strip()
            mqtt_port=port('Puerto MQTT',1883,1)
            username=input('Usuario MQTT (vacío si no requiere): ').strip()
            password=getpass.getpass('Contraseña MQTT: ')
            tls=yes('¿El broker utiliza TLS?',False)
            mqtt_data=dict(host=host,port=mqtt_port,username=username,password=password,tls=tls)
            MQTTConfig(**mqtt_data)
    lan=yes('¿Permitir acceso desde otros equipos de la red?')
    http_port=port('Puerto HTTP',8080)
    auth=yes('¿Proteger el acceso web con contraseña?')
    record=None
    if auth:
        if (destination/'.web-auth.json').exists() and yes('¿Conservar la contraseña web existente?'):
            from cjd_panel.auth import read_record
            read_record(destination/'.web-auth.json')
        else:
            while True:
                password=getpass.getpass('Nueva contraseña web (mínimo 8 caracteres): ')
                confirmation=getpass.getpass('Repite la contraseña web: ')
                if password!=confirmation:print('Las contraseñas no coinciden.');continue
                try:record=password_record(password);break
                except ValueError as exc:print(exc)
    usb=yes('¿Instalar soporte Modbus USB? (Se iniciará en simulador en instalaciones nuevas)')
    service=yes('¿Instalar como servicio con arranque automático?')
    unit=Path.home()/'.config/systemd/user/cjd-panel.service'
    if unit.exists():
        current=unit.read_text()
        from scripts.install_service import quote
        matching=('WorkingDirectory='+quote(destination)[1:-1]+'\n') in current
        if service and not matching:
            raise ValueError('Ya existe un servicio para otra carpeta; elige instalación manual o utiliza la carpeta original.')
        if not service and matching:
            raise ValueError('Esta carpeta ya tiene servicio. Conserva esa opción, o deshabilítalo antes con systemctl --user disable --now cjd-panel.service.')
    from scripts.fedora_setup import collect,apply
    fedora_options=collect(yes,lan,usb)
    settings=PanelConfig(host='0.0.0.0' if lan else '127.0.0.1',port=http_port,mqtt_enabled=mqtt,auth_required=auth)
    print(f'\nDestino: {destination}\nMQTT: {mqtt} · Contraseña web: {auth} · USB: {usb} · Servicio: {service}\nHTTP: puerto {http_port}; acceso '+('desde la red' if lan else 'solo local'))
    if fedora_options:print('Cambios Fedora: '+str(fedora_options))
    if not yes('¿Instalar con estas opciones?'):return
    destination.mkdir(parents=True,exist_ok=True)
    (destination/'data').mkdir(mode=0o700,exist_ok=True)
    import fcntl
    installation_lock=(destination/'data/service.lock').open('a')
    try:fcntl.flock(installation_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise ValueError('El panel se ha iniciado; detén el proceso antes de actualizar.') from None
    copy_sources(ROOT,destination)
    python=dependencies(destination,mqtt,usb,args.wheelhouse)
    database=destination/'data/cjd.sqlite3'
    if database.exists():
        import sqlite3
        from contextlib import closing
        from datetime import datetime,timezone
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        with closing(sqlite3.connect(database)) as source:
            with closing(sqlite3.connect(destination/'data'/('cjd.pre-install-'+stamp+'.bak'))) as backup:source.backup(backup)
    # Inicializar SQLite no crea worker, ni conexiones MQTT/serie.
    subprocess.run([str(python),'-c','from cjd_panel.store import Store; s=Store("data/cjd.sqlite3"); s.close()'],cwd=destination,check=True)
    if mqtt_data is not None:private_json(destination/'.mqtt.json',mqtt_data)
    if record is not None:private_json(destination/'.web-auth.json',record)
    private_json(destination/'.panel.json',settings.as_dict())
    installation_lock.close()
    apply(fedora_options,http_port)
    if service:
        from scripts.install_service import install
        install(destination,python=str(python))
    else:
        print('Instalación completada. Inicio manual: '+str(destination/'iniciar.sh'))
    print(f'Abre http://localhost:{http_port} en el equipo instalado. SQLite y servidor HTTP incluidos.')


if __name__=='__main__':
    try:main()
    except (ValueError,OSError,RuntimeError,subprocess.CalledProcessError) as exc:
        print('Instalación no completada: '+str(exc),file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt,EOFError):
        print('\nInstalación cancelada.',file=sys.stderr)
        sys.exit(1)
