# DEPENDENCIAS.md — CJD Control Panel

## Producto actual: simulador aislado

No se han añadido paquetes de terceros. `requirements.txt` documenta la ausencia de dependencias pip; no hay paquetes que bloquear ni resolver por red. La versión del producto se obtiene de `cjd_panel.__version__`.

| Componente | Versión probada | Función | Tipo / plataforma |
|---|---|---|---|
| Python | 3.13.5; mínimo elegido 3.11 | Runtime, WSGI, JSON/CSV, hilos, PTY, pruebas y empaquetado | Ejecución/desarrollo; Linux x86-64 probado; ARM64 pendiente |
| SQLite | 3.46.1, mediante `sqlite3` de Python | Biblioteca e historial transaccional, WAL y backup | Ejecución; runtime del sistema |
| HTML/CSS/JavaScript | Estándares del navegador, sin bibliotecas | Interfaz local táctil | Ejecución; navegador moderno; validación visual pendiente |
| Simulador de referencia | DEMO V7.5.1, copia incluida sin cambios | Servidor RTU sobre PTY y modelo ficticio | Ejecución de la entrega simulada y pruebas; Linux |
| unittest / compileall | Incluidos en Python 3.13.5 probado | Pruebas y sintaxis Python | Desarrollo |
| tarfile / hashlib | Incluidos en Python 3.13.5 probado | Paquete de fuentes y manifiesto SHA-256 | Empaquetado offline |
| systemd | Versión del destino pendiente de comprobar | Arranque de usuario opcional | Operación; plantilla incluida, sin activación ni prueba en este sandbox |

Los módulos estándar no tienen versiones independientes del runtime Python. No se usa Node, npm, CDN, framework web externo, MQTT ni HA. No hay servidor SQLite separado. Las plataformas objetivo Ubuntu/Fedora y ARM64 no se presentan como probadas.

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
