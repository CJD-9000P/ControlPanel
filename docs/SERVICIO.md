# Arranque automático con systemd

Para instalaciones nuevas utiliza [el asistente](../INSTALLACION.md): genera el servicio con `.venv` y `.panel.json`, respetando contraseña, MQTT y puerto elegidos. Las instrucciones manuales siguientes conservan el flujo anterior para instalaciones sin configuración del asistente.

## Servicio de usuario y arranque sin sesión

El panel se instala como `cjd-panel.service` de systemd para el usuario que ejecuta la aplicación. El instalador habilita **linger**, de modo que el gestor de ese usuario arranque con el sistema y continúe después de cerrar sesión. No requiere una ventana de terminal ni un inicio de sesión gráfico.

En este proyecto el sistema es el Debian del LXC de desarrollo. El servicio se instala ahí, donde están el código y los datos del panel. No configura el arranque del contenedor desde Proxmox; eso es una configuración independiente del anfitrión de virtualización.

## Instalación

Desde la carpeta del proyecto, como el usuario del panel y sin sudo:

```bash
python3 scripts/install_service.py --install
```

Sin `--install`, el script solo muestra el archivo de unidad que instalaría. Con la opción:

1. Genera y valida la unidad con rutas absolutas a la copia actual del proyecto.
2. Comprueba/intenta habilitar linger para el propio usuario. Si la política exige administrador, puede instalar y activar la unidad en el gestor de usuario que ya está disponible, dejando explícitamente pendiente el arranque sin sesión. Si ese gestor no existe, deja la unidad preparada y conserva la instancia manual.
3. Instala `~/.config/systemd/user/cjd-panel.service` y recarga el gestor de usuario.
4. Guarda una copia consistente de SQLite y detiene ordenadamente la instancia anterior de esta carpeta.
5. Habilita e inicia el servicio; comprueba API, versión, un único proceso, estado `active`, unidad `enabled` y `Linger=yes`.

El acceso web conserva el despliegue solicitado: `0.0.0.0:8080` sin contraseña. Se conserva el mismo directorio `data` de la aplicación, con perfiles, historial, deduplicación, cola MQTT y selección de conexión; no se sustituye por un directorio vacío en `.local/share`. Las credenciales siguen leyéndose de `.mqtt.json` y los parámetros serie de `.modbus.json`. Ninguna contraseña se escribe en la unidad ni en los argumentos del proceso.

`packaging/cjd-panel.service` es una plantilla equivalente para una copia en `~/cjd-control-panel`. El instalador se recomienda para resolver las rutas reales y evitar errores al copiar la plantilla manualmente.

## Comandos habituales

```bash
systemctl --user status cjd-panel.service
systemctl --user restart cjd-panel.service
systemctl --user stop cjd-panel.service
systemctl --user start cjd-panel.service
journalctl --user -u cjd-panel.service -n 100 --no-pager
systemctl --user is-enabled cjd-panel.service
loginctl show-user "$USER" --property=Linger
```

Para desactivar el arranque del panel:

```bash
systemctl --user disable --now cjd-panel.service
```

No se desactiva linger automáticamente: puede estar siendo utilizado por otros servicios del usuario.

## Reinicio y transporte

El servicio conserva `data/connection.json`: al arrancar selecciona Simulador o USB según lo guardado. No envía RUN automáticamente. Si falta el USB o MQTT no está disponible, la aplicación sigue iniciada y muestra el fallo, con reintentos de lectura/conexión correspondientes.

Se configura reinicio ante fallo del proceso (`Restart=on-failure`) y un margen de parada de 60 segundos. Una parada normal no ordena STOP al regulador CJD. El bloqueo de datos, la exclusión del puerto y un solo proceso del servicio mantienen un único worker. No se utiliza `PrivateTmp=true`, para conservar el ámbito compartido de los bloqueos de dispositivo.

La unidad mantiene los permisos del usuario; no ejecuta el panel como root ni añade permisos al USB. El acceso físico continúa sujeto a los permisos/passthrough del dispositivo en el LXC.

## Comprobación del arranque

`enabled` más `Linger=yes` comprueban la configuración de arranque sin sesión; `active` y la API verifican la ejecución actual. No se reinicia el sistema operativo para esta comprobación. El instalador deja un resumen en `data/service-check.json`; la salida normal del servicio pasa a journald.

Referencia: [loginctl y enable-linger](https://www.freedesktop.org/software/systemd/man/258/loginctl.html), que documenta el inicio del gestor de usuario al arrancar el sistema y su permanencia tras cerrar sesión. systemd se verificó en el Debian actual; Ubuntu/Fedora y otros gestores de inicio necesitan su propia validación.

## Estado comprobado en este LXC

La unidad está instalada en `/home/cjddev/.config/systemd/user/cjd-panel.service`, utilizando la carpeta data del proyecto. Tras ejecutar el usuario el comando de administrador, se verificaron `active`, `enabled` y `Linger=yes`. El servicio queda configurado para arrancar con Debian sin iniciar sesión. La API y el proceso único ya se comprobaron durante la instalación.

Se conserva la selección Simulador/USB guardada y no se envía RUN automáticamente. No se ha reiniciado el sistema operativo como prueba. Si se reinicia el anfitrión Proxmox, el LXC también debe estar configurado allí para arrancar; esa configuración es independiente y no se ha modificado.
