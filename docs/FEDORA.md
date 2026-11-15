# Instalación en Fedora

Desde el paquete descomprimido, en una terminal de tu usuario habitual:

```bash
./instalar-fedora.sh
```

El lanzador identifica Fedora y utiliza el asistente común. Ofrece instalar con DNF `python3`, `python3-pip` y `ca-certificates` si falta el entorno base. SQLite, SSL y venv se comprueban antes de continuar. No necesitas instalar Apache, nginx ni un servidor de base de datos. No ejecutes el instalador completo con sudo: solo las operaciones del anfitrión solicitan privilegios.

Se conservan las preguntas sobre carpeta, MQTT, contraseñas, acceso local o por red, puerto, USB y servicio. La aplicación y sus dependencias se instalan en la carpeta elegida y `.venv`; los datos locales quedan en `data`. Los archivos privados y los paquetes opcionales mantienen las exclusiones del instalador común. Consulta [instalación, actualización y modo offline](../INSTALLACION.md).

Si eliges USB y tu usuario aún no pertenece a `dialout`, ofrece añadirlo a ese grupo. Reinicia Fedora después de aceptar: los procesos y el gestor systemd de usuario necesitan renovar sus grupos. No cambia permisos globales de dispositivos, no crea reglas udev y no abre el puerto serie durante la instalación. El programador debe continuar desconectado durante las pruebas de simulador. Antes de pasar a conexión física, detén cualquier comunicador antiguo que use el mismo bus.

Para acceso por red, si firewalld está activo, ofrece abrir exclusivamente el puerto HTTP elegido. Muestra las zonas activas y pide la zona que corresponde a tu conexión. Añade la regla temporal y permanente sin recargar globalmente las otras reglas. Si no aceptas, el panel sigue disponible localmente; el acceso remoto dependerá de tu configuración de red. No abre puertos entrantes para MQTT: la aplicación es cliente del broker. El comportamiento por zonas y persistencia sigue la [documentación oficial de firewalld](https://firewalld.org/documentation/howto/open-a-port-or-service).

El servicio es systemd de usuario con linger. Si el sistema no permite habilitarlo automáticamente, el instalador indica el comando de administrador pendiente. Esto no inicia el navegador: abre `http://localhost:8080` (o el puerto elegido). No se desactiva SELinux ni se cambian sus políticas. Ante un error del servicio, consulta `journalctl --user -u cjd-panel.service`; los bloqueos SELinux deberán diagnosticarse en el equipo, sin desactivar la protección.

Al terminar y después de reiniciar, comprueba:

```bash
systemctl --user is-enabled cjd-panel.service
systemctl --user is-active cjd-panel.service
loginctl show-user "$USER" --property=Linger
id -nG
```

El servicio debe estar habilitado/activo y Linger debe ser yes. Si aceptaste permisos USB, `dialout` debe figurar entre tus grupos. Verifica el panel en simulador, luego MQTT si lo necesitas. La conexión y aceptación física del horno se realizarán en una fase separada.

Alcance preparado: Fedora convencional con DNF y systemd, Python >=3.11. La versión y arquitectura exactas del Fedora final están pendientes de comprobar. Fedora Atomic/Silverblue se rechaza expresamente porque requiere otro procedimiento. Se han ejecutado pruebas de detección, comandos DNF simulados, permisos y firewall simulados, y regresiones en Debian; no se ha ejecutado una instalación nativa Fedora ni un reinicio de ese equipo.
