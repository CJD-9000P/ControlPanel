# DEPENDENCIAS.md — CJD Control Panel

## Producto actual: simulador aislado

El modo local base no necesita paquetes de terceros. `requirements.txt` documenta esa ausencia. La integración MQTT opcional usa `requirements-mqtt.txt`, con paquete y hash fijados. La versión del producto se obtiene de `cjd_panel.__version__`.

| Componente | Versión probada | Función | Tipo / plataforma |
|---|---|---|---|
| Python | 3.13.5; mínimo elegido 3.11 | Runtime, WSGI, JSON/CSV, hilos, PTY, pruebas y empaquetado | Ejecución/desarrollo; Linux x86-64 probado; ARM64 pendiente |
| SQLite | 3.46.1, mediante `sqlite3` de Python | Biblioteca e historial transaccional, WAL y backup | Ejecución; runtime del sistema |
| HTML/CSS/JavaScript | Estándares del navegador, sin bibliotecas | Interfaz local táctil | Ejecución; navegador moderno; validación visual pendiente |
| Simulador de referencia | DEMO V7.5.1, copia incluida sin cambios | Servidor RTU sobre PTY y modelo ficticio | Ejecución de la entrega simulada y pruebas; Linux |
| unittest / compileall | Incluidos en Python 3.13.5 probado | Pruebas y sintaxis Python | Desarrollo |
| tarfile / hashlib | Incluidos en Python 3.13.5 probado | Paquete de fuentes y manifiesto SHA-256 | Empaquetado offline |
| systemd / systemctl / loginctl / systemd-analyze | 257 (257.13-1~deb13u1) | Servicio de usuario, arranque con linger y validación de unidad | Operación/instalación; Debian 13.7 actual; otras distribuciones pendientes |

Los módulos estándar no tienen versiones independientes del runtime Python. El modo local no usa Node, npm, CDN ni framework externo; MQTT/HA son opcionales. No hay servidor SQLite separado. Las plataformas objetivo Ubuntu/Fedora y ARM64 no se presentan como probadas.

## Herramientas del LXC comprobadas

| Herramienta / entorno | Versión observada | Alcance |
|---|---|---|
| Debian | 13.7 (trixie) | Entorno dedicado de desarrollo |
| Arquitectura | x86_64 | Entorno actual |
| Kernel Proxmox visible | 7.0.14-4-pve | Informativo; no dependencia del producto |
| Codex CLI | 0.169.0 | Herramienta de desarrollo, no requisito de la aplicación |
| Tailscale | 1.104.7 | Acceso del entorno, no requisito de la aplicación |
| pip | No instalado | Innecesario para esta entrega |
| Navegador / Playwright / Selenium | No disponibles | Revisión visual pendiente |

El entorno restringe sockets IP incluso en loopback. Se han podido probar PTY, SQLite y API WSGI directa; el servidor de red debe comprobarse fuera del sandbox.

## Referencias e integración física pendiente

| Fuente / dependencia | Versión | Uso |
|---|---|---|
| Comunicador Fedora | Cabecera V7.3.0; etiquetas internas históricas V7.2.0 | Fuente de lectura/escritura y autopruebas; no se ejecuta como servicio de esta app |
| PyModbus | Versión física exacta pendiente de comprobar | No se instala ni importa en la app actual; evaluar para el adaptador físico futuro |
| paho-mqtt | Versión histórica pendiente de comprobar | Solo del comunicador de referencia; no dependencia del producto |
| Manuales PDF RS485 | Edición exacta pendiente de comprobar; dos copias idénticas por hash | Referencia del protocolo, no runtime |

El comunicador suministrado es el último recuperable, no está confirmado como última versión físicamente probada. Su autoprueba pasa con cliente falso y no necesita instalar PyModbus/paho. El simulador y el comunicador tienen numeración propia; no deben confundirse con la versión del panel.

Inventario y hashes en `docs/INVENTARIO.md` y `docs/FUENTES_SHA256.json`. Cualquier dependencia externa nueva deberá registrar versión exacta, función, plataforma, manifiesto/bloqueo y validación efectuada antes de incorporarse.

## Referencias añadidas para la actualización de interfaz

El manual de usuario y sus siete capturas se conservan en `ui_reference/`; las tres tarjetas históricas en `fuentes_referencia/tarjetas_homeassistant/`. Son documentación de desarrollo y material del paquete, no dependencias ejecutables del panel. Sus hashes constan en `docs/REFERENCIAS_UI_SHA256.json`.

Las etiquetas históricas son Curvas V7.6.0 (archivo original denominado V7.6.1), Control V7.5.9.2 y Cocciones V0.6.7. No son versiones de la aplicación nueva. No se incorporan Lovelace, entidades HA, MQTT, Telegram ni PostgreSQL. El módulo de análisis usa solo `datetime`, `hashlib` y `json` del runtime Python probado; no hay paquetes nuevos que instalar o bloquear.

La sintaxis y escenarios de lógica de interfaz se verifican con V8 proporcionado por las herramientas del entorno; su versión exacta está pendiente de comprobar y no es una dependencia del producto. La revisión visual sigue pendiente.

## Revisión de históricos y conexión

Sin dependencias nuevas. `analysis.chart_data`, el diagnóstico de antigüedad y las pruebas adicionales usan únicamente biblioteca estándar Python. El navegador emplea `AbortController` (API estándar, sin paquete externo) para limitar solicitudes. Los colores y las barras usan clases del CSS local y atributos SVG compatibles con la CSP del servidor.

Las regresiones de `tests/ui_history.js` se ejecutaron con V8 proporcionado por el entorno, cuya versión exacta sigue pendiente de comprobar; usan DOM y respuestas HTTP simulados. No se ha instalado Node ni navegador. No se han añadido pyserial, PyModbus ni herramientas de detección USB; el producto continúa sin adaptador físico.

## MQTT opcional actual

| Componente | Versión | Función y alcance |
|---|---|---|
| paho-mqtt | 2.1.0 | Ejecución opcional, cliente MQTT 3.1.1/callbacks VERSION2, reconexión y discovery HA; probado en Debian x86-64/Python 3.13.5 con broker del usuario |
| requirements-mqtt.txt | Deriva del paquete y hash de wheel de paho-mqtt | Bloqueo reproducible SHA-256; instalar con `--require-hashes` |
| Home Assistant MQTT discovery/button | Versión del servidor pendiente de comprobar | Contrato externo opcional; `command_template` y disponibilidad contrastados con documentación oficial; revisión de su interfaz pendiente |
| SQLite del diario MQTT | Mismo runtime SQLite ya registrado | Deduplicación local independiente de la base de perfiles/historial |

Se descargó la wheel universal oficial, se verificó SHA-256 y se extrajo en `.mqtt-deps/` como instalación local del entorno, sin instalar pip ni modificar Python del sistema. Esta carpeta y `.mqtt.json` no se distribuyen. La dependencia fijada solo se importa al activar MQTT; `--no-mqtt` conserva el funcionamiento autónomo. El origen, autenticación y pruebas están descritos en `docs/MQTT.md` sin credenciales.

Las afirmaciones anteriores de ausencia de dependencias nuevas corresponden a las revisiones históricas de interfaz. La incorporación actual se limita al cliente MQTT opcional; no se añade PyModbus ni pyserial.

## Corrección del flujo histórico MQTT

Sin dependencias nuevas. La cola de sesiones utiliza el mismo SQLite de Python y las confirmaciones QoS 1 de paho-mqtt 2.1.0 ya fijado; el esquema SQLite es un componente independiente de la versión del producto. No se instala un cliente PostgreSQL ni una API de HA. Las pruebas de migración/cola/contrato usan solo unittest y biblioteca estándar; la versión del consumidor histórico de HA sigue pendiente de comprobar.

## Adaptador Modbus USB opcional

| Componente | Versión elegida y probada | Función / plataforma |
|---|---|---|
| PyModbus | 3.11.4 | Cliente Modbus RTU FC03/FC16; ejecución opcional Linux; probado en Python 3.13.5 con PTY propio, no con horno físico |
| pyserial | 3.5 | Apertura serie y exclusión; ejecución opcional Linux; pruebas con PTY |
| requirements-modbus.txt | Versiones y SHA-256 de wheels oficiales | Bloqueo reproducible para `pip install --require-hashes` |
| fcntl/termios | Biblioteca estándar del Python ya registrado | Bloqueo de puerto y TIOCEXCL en Linux; sin paquete externo |

Wheels descargadas de PyPI y verificadas antes de instalar localmente en `.serial-deps/`, sin modificar el Python del sistema. Esa carpeta no se distribuye. El simulador no requiere importar estas dependencias. No se añaden dependencias web ni herramientas de HA. La versión exacta del PyModbus histórico utilizado con el horno continúa pendiente de comprobar; la elección actual no se presenta como esa versión.

Las referencias anteriores a ausencia total de adaptador físico/dependencia PyModbus corresponden a las entregas históricas. El adaptador actual está implementado y probado contra PTY; su aceptación física, otras distribuciones y ARM64 permanecen pendientes. Configuración y límites en `docs/MODBUS_USB.md`.

## Instalador de servicio y desplegable

Sin paquetes nuevos del producto. El instalador utiliza únicamente biblioteca estándar Python (`subprocess`, `pwd`, `sqlite3`, `pathlib`, `urllib`) y las herramientas systemd ya presentes en Debian. No instala sudo ni requiere ejecutar el panel como root. La versión de systemd observada pertenece al sistema operativo, no a la versión del panel. La plantilla inicial sin activación es histórica; la instalación actual y su alcance se documentan en `docs/SERVICIO.md`.

## Instalación asistida actual

La versión del producto deriva exclusivamente de `cjd_panel/__init__.py`. `instalar.sh` y `scripts/install.py` preparan `.venv`, SQLite y HTTP WSGI estándar, configuración privada, contraseña PBKDF2-SHA256 y servicio opcional. Detalles en [INSTALLACION.md](INSTALLACION.md). No se añade un servidor de base de datos externo.

Herramienta nueva: pip 26.3, solo instalación/empaquetado, Linux/Python >=3.11, fijado con SHA-256 en `requirements-bootstrap.txt` e `installer-wheels.json`. Se instala en `.venv` únicamente si se eligen dependencias opcionales. `venv`, `ssl`, `hashlib` y SQLite pertenecen a la biblioteca estándar Python ya requerida. apt/dnf y sudo son herramientas del anfitrión para paquetes base, no dependencias de ejecución del producto; sus versiones dependen de la distribución (pendiente de comprobar fuera de Debian). Las dependencias MQTT y Modbus mantienen sus versiones fijadas existentes.

## Preparación del anfitrión Fedora

Sin nuevas bibliotecas Python. Herramientas del anfitrión: DNF (paquetes base), sudo (elevación puntual), usermod/grupo dialout (permisos USB opcionales), firewalld/firewall-cmd (puerto HTTP opcional), systemd/loginctl (servicio). Sus versiones en Fedora están pendientes de comprobar; no se instalan como dependencias pip ni se incluyen en el paquete. La ausencia de firewalld no bloquea el uso local. Fedora con DNF es el destino; Atomic/Silverblue requiere otro procedimiento. Los comandos Fedora se prueban mediante dobles en Debian, sin afirmar una validación nativa. Las versiones bloqueadas de las dependencias Python no cambian.
