"""Preparación opcional del anfitrión Fedora; nunca abre el puerto serie."""
import grp
import os
from pathlib import Path
import pwd
import platform
import shutil
import subprocess


def is_fedora():
    try:return platform.freedesktop_os_release().get('ID')=='fedora'
    except OSError:return False


def collect(ask,lan,usb):
    if not is_fedora():return {}
    if Path('/run/ostree-booted').exists():
        raise ValueError('Este asistente está preparado para Fedora con DNF. Fedora Atomic/Silverblue requiere una instalación específica, pendiente de comprobar.')
    options={}
    if usb:
        try:group=grp.getgrnam('dialout')
        except KeyError:
            raise ValueError('No existe el grupo dialout; comprueba las reglas serie de este Fedora antes de configurar USB.') from None
        user=pwd.getpwuid(os.getuid())
        if group.gr_gid not in os.getgroups() and user.pw_name not in group.gr_mem and user.pw_gid!=group.gr_gid:
            options['serial_user']=user.pw_name if ask('¿Dar a tu usuario acceso serie mediante el grupo dialout? (requiere reiniciar Fedora)',False) else None
    if lan and shutil.which('firewall-cmd'):
        state=subprocess.run(['firewall-cmd','--state'],capture_output=True,text=True)
        if state.returncode==0 and ask('¿Abrir el puerto HTTP en firewalld para acceder desde la red?',False):
            zones=subprocess.run(['firewall-cmd','--get-zones'],capture_output=True,text=True,check=True).stdout.split()
            active=subprocess.run(['firewall-cmd','--get-active-zones'],capture_output=True,text=True,check=True).stdout
            print('Zonas activas:\n'+active)
            zone=input('Zona en la que permitir el acceso HTTP: ').strip()
            if zone not in zones:raise ValueError('Zona firewalld no válida; no se modifica el firewall.')
            options['zone']=zone
    return options


def commands(options,port):
    if type(port) is not int or not 1024<=port<=65535:raise ValueError('Puerto HTTP no válido.')
    result=[]
    if options.get('serial_user'):
        result.append(['sudo','usermod','--append','--groups','dialout','--',options['serial_user']])
    if options.get('zone'):
        # Cambios concretos, sin reload global que afecte otras reglas temporales.
        for permanent in (False,True):
            result.append(['sudo','firewall-cmd',*(['--permanent'] if permanent else []),
                           '--zone='+options['zone'],'--add-port='+str(port)+'/tcp'])
    return result


def apply(options,port):
    for command in commands(options,port):subprocess.run(command,check=True)
    if options.get('serial_user'):
        print('Acceso serie configurado. Reinicia Fedora antes de seleccionar USB; el gestor systemd de usuario necesita renovar sus grupos. La instalación permanece en simulador si es nueva.')
