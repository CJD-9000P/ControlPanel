# Arquitectura — aplicación autónoma CJD-9000P

## Producto y límites

Aplicación Linux local con backend Python, interfaz web táctil y SQLite. No depende de Home Assistant, Internet, MQTT ni PostgreSQL. Las distribuciones objetivo son Debian, Ubuntu y Fedora; ARM64 requiere validación posterior.

El CJD conserva la regulación térmica, pantalla y botones originales. El ordenador aporta interfaz y comunicación; no implementa el control térmico. La entrega actual usa exclusivamente el simulador mediante un PTY creado por ella misma y no ofrece configuración para abrir un puerto físico.

## Componentes implementados

| Componente | Archivo | Responsabilidad |
|---|---|---|
| Arranque | `cjd_panel/__main__.py` | CLI, exclusión de instancias por directorio, ciclo de vida y loopback por defecto |
| Servidor/API | `cjd_panel/server.py` | WSGI, recursos locales, JSON/CSV, copias, clave opcional para LAN y validación de solicitudes |
| Worker | `cjd_panel/worker.py` | Único dueño del cliente RTU; cola, sondeo, relectura y sesiones |
| Adaptador simulado | `cjd_panel/modbus.py` | Cliente FC03/FC16, CRC y ACK; servidor de referencia en PTY Linux aislado |
| Modelo | `cjd_panel/model.py` | Validación de los 20 puntos, límites y tiempo UTC |
| Persistencia | `cjd_panel/store.py` | SQLite, biblioteca, cocciones, lecturas, snapshots, eventos y backup |
| Interfaz | `cjd_panel/static/` | Curvas, Control y Cocciones, sin compilación ni recursos externos |
| Referencias | `fuentes_referencia/` | Código y manuales originales, sin modificación |

## Flujo

1. HTTP consulta el último estado confirmado o encola una orden; nunca accede al transporte directamente.
2. El worker sincroniza seis registros dinámicos, memoria activa, dP y las cuatro memorias. Concilia cambios externos antes de una orden de la app.
3. Valida estado y escala. Para cargas e inicio adapta C01 a PV, conserva el perfil local y verifica los 40 registros. RUN/STOP/PAUSE/RESUME se confirman leyendo CAH.
4. La UI consulta el estado cada dos segundos. Sin comunicación oculta valores como disponibles y bloquea controles; no inventa lecturas durante el fallo.
5. Una transición a ejecución/pausa abre una sesión; las lecturas se registran localmente. PARADO cierra la sesión. Los cambios externos se registran como observados; no se atribuyen a botones concretos.
6. Historial, CSV y copias proceden de SQLite. Si se pierde un ACK, se confirma por relectura antes de declarar éxito, sin reenviar la escritura automáticamente.

El futuro adaptador físico deberá conservar la misma separación y copiar/validar parámetros y comportamiento del comunicador físico confirmado. Esta entrega conserva la secuencia esencial de referencia, pero no declara su transporte PTY como driver físico validado. Detalles en `docs/CONTRATO_COMUNICACION.md`.

## Datos y persistencia

- `profiles`: identificador, nombre, notas, 20 puntos y fecha de actualización; sin límite artificial.
- `firings`: inicio/fin UTC, nombre, memoria, estado, origen y snapshot de la curva realmente utilizada.
- `readings`: PV, SV, estado, segmento, minutos del tramo y memoria; índice por cocción e instante.
- `events`: cambios de estado, conexión, órdenes verificadas, fallos e importaciones.

SQLite usa WAL, sincronización FULL, claves foráneas y transacciones. Las gráficas del historial reciben una selección de hasta unas 2000 muestras; la base y exportación conservan todas. CSV propio para curvas e históricos; formatos antiguos requieren muestras y adaptadores. Los CSV de cocción no contienen eventos ni snapshot.

Copias manuales consistentes descargables, sin política de eliminación automática. Restauración en directorio nuevo con servicio detenido. Tras reinicio, las sesiones simuladas abiertas se marcan interrumpidas y no se manda RUN automáticamente. El simulador reinicia sus cuatro memorias; la biblioteca y el historial persisten.

## Operación

Biblioteca estándar Python >=3.11, sin dependencias externas para el modo actual. WSGI sirve la interfaz y API. Por defecto escucha en `127.0.0.1`; el acceso LAN admite una clave de al menos 20 caracteres o la opción explícita `--no-auth` para acceso sin contraseña, solicitada por el usuario. Sin TLS integrado: usar túnel o proxy cuando se requiera confidencialidad. No hay permisos múltiples ni cuentas.

Un bloqueo por directorio impide dos instancias del servicio sobre los mismos datos. La plantilla systemd arranca el modo simulado; se suministra sin instalación automática. La versión del producto tiene una única fuente en `cjd_panel/__init__.py` y el paquete deriva de ella.

## Entornos y fases pendientes

LXC Debian de desarrollo, aislado del ASUS Fedora, horno y LXC Ubuntu existente. No se ha conectado con ninguno de esos sistemas. Verificación realizada en Debian 13.7 x86-64. El sandbox impide sockets IP y no contiene navegador; API comprobada por WSGI directo, sin prueba de red ni visual.

La regulación y el panel original se mantienen en la futura fase física, con un solo maestro RS485. Hardware, alimentación AC/DC desde la entrada 220–240 V y diseño de la caja adjunta se resolverán después. La arquitectura antigua HA/MQTT es referencia histórica; no es dependencia ni fuente de verdad del producto nuevo.
