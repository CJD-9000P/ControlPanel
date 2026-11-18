# Instalación asistida

Desde la carpeta del paquete descomprimido, como usuario normal:

```bash
./instalar.sh
```

En Fedora utiliza `./instalar-fedora.sh` y sigue la [guía específica](docs/FEDORA.md), que incluye permisos USB y firewalld opcionales. Fedora Atomic/Silverblue necesita otro procedimiento, pendiente de comprobar.

El asistente pregunta carpeta de destino, activación de MQTT (IP/nombre, puerto, usuario, contraseña y TLS), acceso local o desde la red, puerto HTTP, contraseña web opcional, soporte Modbus USB y servicio con arranque automático. Muestra las opciones para confirmar antes de instalar. No muestra ni pasa contraseñas en argumentos de procesos. Puedes conservar las credenciales existentes al actualizar.

Requiere Linux y Python 3.11 o posterior. Si faltan Python, SQLite, SSL o venv, el lanzador ofrece instalar paquetes mediante apt en Debian/Ubuntu o dnf en Fedora, usando sudo solo para los paquetes del sistema. La instalación de la aplicación y su servicio se realizan con el usuario normal. Estas rutas de paquetes están preparadas; la prueba integral se ha realizado en Debian 13.7 x86_64, Python 3.13.5. Ubuntu y Fedora quedan pendientes de comprobar en sus propios sistemas.

El servidor HTTP y SQLite están incluidos en Python: no necesitan Apache, nginx, PostgreSQL ni un servicio de base de datos. Se crea `.venv` aislado. Solo se descargan las dependencias opcionales elegidas, con versiones y hashes fijados en los requisitos y `installer-wheels.json`. pip es herramienta de instalación; no es necesario para ejecutar el modo básico.

Los ajustes quedan en `.panel.json`; MQTT en `.mqtt.json`; la contraseña web se guarda como hash PBKDF2 salado en `.web-auth.json`. Los tres archivos tienen permisos 0600 y se excluyen de Git y del paquete. La contraseña MQTT debe guardarse para autenticarse contra el broker. No se incorporan los secretos ni los datos de la máquina desde la que se distribuye el instalador. HTTP no cifra el tráfico; para acceso fuera de la red de confianza utiliza un túnel o un proxy HTTPS.

Una instalación nueva utiliza el simulador. Instalar soporte USB no conecta al horno; en el desplegable Conexión del panel puedes elegir el puerto USB detectado. El panel guarda la elección y prefiere los identificadores estables de Linux cuando están disponibles. Una actualización conserva el modo existente. La base se inicializa en `data/cjd.sqlite3`; si existe se crea una copia consistente `data/cjd.pre-install-*.bak` antes de abrirla. No se eliminan curvas ni cocciones.

Para actualizar una carpeta que está funcionando, detén primero el panel:

```bash
systemctl --user stop cjd-panel.service
./instalar.sh
```

Selecciona su carpeta y conserva la opción de servicio si ya lo tenía. El asistente rechaza actualizar datos usados por un proceso activo y no sustituye un servicio que pertenezca a otra carpeta. Si la instalación falla, corrige la causa y repítela; no se anuncia como completa. Guarda también una copia externa de `data` y los archivos privados antes de actualizar.

El servicio systemd de usuario usa el entorno `.venv`, respeta contraseña, puerto y MQTT del asistente, se habilita y se comprueba mediante `/healthz`. Para arrancar sin iniciar sesión requiere `Linger=yes`. El instalador intenta habilitarlo; si el sistema exige administrador muestra el comando exacto pendiente (`sudo loginctl enable-linger USUARIO`). No configura el arranque del contenedor en Proxmox ni abre automáticamente el navegador.

Sin servicio, inicia con `./iniciar.sh` desde la carpeta instalada. Con servicio:

```bash
systemctl --user status cjd-panel.service
journalctl --user -u cjd-panel.service
```

Abre `http://localhost:PUERTO` en el equipo instalado, o `http://IP_DEL_EQUIPO:PUERTO` si elegiste acceso por red. Sin MQTT la aplicación funciona igualmente.

Para instalación sin Internet, prepara en otro equipo los wheels exactos enumerados en `installer-wheels.json` y ejecuta `./instalar.sh --wheelhouse /ruta/wheels`. Se comprueban sus hashes igualmente; los paquetes del sistema deben estar ya disponibles.

## Lanzador descargable y requisitos mínimos

En una copia local del proyecto puedes comprobar sin instalar ni descargar:

```bash
./bin/instalar-cjd.sh --check
```

Para descargar el lanzador publicado y abrir el asistente desde una terminal Bash, con curl disponible, una sola línea:

```bash
bash -c 'f=$(mktemp) && curl -fL https://raw.githubusercontent.com/CJD-9000P/ControlPanel/main/bin/instalar-cjd.sh -o "$f" && sh "$f"'
```

Usa tu usuario normal, sin sudo. Evita `curl | sh`: el asistente necesita conservar la entrada del teclado para sus preguntas. El lanzador comprueba Linux, Fedora/Debian/Ubuntu, usuario sin privilegios y ausencia de Atomic/Silverblue; verifica curl, tar, mktemp y Python >=3.11 con SQLite, SSL y venv. Si faltan paquetes ofrece instalarlos con apt o DNF, con elevación puntual. El comando de descarga inicial necesita curl y mktemp; si faltan, un administrador debe instalarlos antes. systemd es necesario solo si eliges servicio; MQTT y USB conservan sus opciones del asistente. No se fija un mínimo de RAM o disco no medido.

Descarga el código de su propia rama `version/VERSION`, comprueba la versión sin ejecutar el Python descargado y abre el asistente. Los temporales se conservan para diagnóstico. No ejecuta el panel, no modifica credenciales ni conecta al horno antes de las opciones y confirmaciones del asistente. Si falta la publicación de esa versión o falla la descarga, no instala. HTTPS y comprobación de versión no equivalen a una firma criptográfica del paquete.

`python3 packaging/generate_launcher.py` genera el archivo en `bin` a partir de `packaging/instalar-cjd.sh.in`. `python3 packaging/build.py` lo llama automáticamente. La versión sale exclusivamente de `cjd_panel/__init__.py`: si coincide con la del archivo generado, no lo reescribe ni cambia su fecha, aunque cambie la plantilla. Para publicar cambios del lanzador hay que incrementar la versión. El flujo de publicación debe subir el código y crear su rama de versión antes de anunciar el comando de instalación.


## Actualizar desde el panel

Con el servicio de usuario instalado, **Actualizar programa** aparece en la barra superior cuando el panel detecta una versión nueva y confirma que el programador está parado, comunicado y sin una cocción programada. La consulta de versiones necesita Internet en el PC del panel. Desde otro equipo de la red, la actualización requiere acceso web autenticado.

Al confirmar, el servicio descarga el código publicado, vuelve a comprobar el estado del programador y guarda una copia de SQLite en el directorio de datos. Después reinicia el panel y comprueba la versión instalada. Si la versión requiere cambiar dependencias o el panel se ejecuta manualmente, usa el instalador de terminal. Los errores de aplicación se registran en `journalctl --user -u cjd-panel-update.service`.
