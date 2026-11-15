# Arquitectura — aplicación autónoma CJD-9000P

## Producto y límites

Aplicación Linux local con backend Python, interfaz web táctil y SQLite. No depende de Home Assistant, Internet, MQTT ni PostgreSQL. Las distribuciones objetivo son Debian, Ubuntu y Fedora; ARM64 requiere validación posterior.

El CJD conserva la regulación térmica, pantalla y botones originales. El ordenador aporta interfaz y comunicación; no implementa el control térmico. La entrega permite seleccionar simulador PTY o adaptador Modbus serie; una instalación nueva arranca simulada. El desplegable Conexión gestiona la selección dentro del mismo worker, con el puerto físico predeterminado `/dev/ttyUSB1`. El adaptador físico se ha probado con PTY, no con el horno.

## Componentes implementados

| Componente | Archivo | Responsabilidad |
|---|---|---|
| Arranque | `cjd_panel/__main__.py` | CLI, exclusión de instancias por directorio, ciclo de vida y loopback por defecto |
| Servidor/API | `cjd_panel/server.py` | WSGI, recursos locales, JSON/CSV, copias, clave opcional para LAN y validación de solicitudes |
| Worker | `cjd_panel/worker.py` | Único dueño del cliente RTU; cola, sondeo, relectura y sesiones |
| Adaptador simulado | `cjd_panel/modbus.py` | Cliente FC03/FC16, CRC y ACK; servidor de referencia en PTY Linux aislado |
| Modelo | `cjd_panel/model.py` | Validación de los 20 puntos, límites y tiempo UTC |
| Análisis | `cjd_panel/analysis.py` | Indicadores sobre todas las muestras e identidad de curva ignorando C01 |
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
- `firings`: inicio/fin UTC, nombre editable, observaciones, nombre original de curva, memoria, estado, origen y snapshot de la curva realmente utilizada.
- `readings`: PV, SV, estado, segmento, minutos del tramo y memoria; índice por cocción e instante.
- `events`: cambios de estado, conexión, órdenes verificadas, fallos e importaciones.

SQLite usa WAL, sincronización FULL, claves foráneas y transacciones. Las gráficas del historial reciben unas 2000 muestras más los extremos de huecos que deban conservarse; las marcas de tramos y pausas proceden de todas las lecturas; la base y exportación conservan todas. CSV propio para curvas e históricos; formatos antiguos requieren muestras y adaptadores. Los CSV de cocción no contienen eventos ni snapshot.

Copias manuales consistentes descargables, sin política de eliminación automática. La migración histórica al esquema 2 añadió observaciones y nombre original de curva; al partir del esquema 1 crea una copia consistente previa sin sobrescribir una copia anterior. Restauración en directorio nuevo con servicio detenido. Tras reinicio, las sesiones simuladas abiertas se marcan interrumpidas y no se manda RUN automáticamente. El simulador reinicia sus cuatro memorias; la biblioteca y el historial persisten.

## Operación

Biblioteca estándar Python >=3.11, sin dependencias externas para el modo actual. WSGI sirve la interfaz y API. Por defecto escucha en `127.0.0.1`; el acceso LAN admite una clave de al menos 20 caracteres o la opción explícita `--no-auth` para acceso sin contraseña, solicitada por el usuario. Sin TLS integrado: usar túnel o proxy cuando se requiera confidencialidad. No hay permisos múltiples ni cuentas.

Un bloqueo por directorio impide dos instancias del servicio sobre los mismos datos. La plantilla systemd arranca el modo simulado; se suministra sin instalación automática. La versión del producto tiene una única fuente en `cjd_panel/__init__.py` y el paquete deriva de ella.

## Entornos y fases pendientes

LXC Debian de desarrollo, aislado del ASUS Fedora, horno y LXC Ubuntu existente. No se ha conectado con ninguno de esos sistemas. Verificación realizada en Debian 13.7 x86-64. El sandbox impide sockets IP y no contiene navegador; API comprobada por WSGI directo, sin prueba de red ni visual.

La regulación y el panel original se mantienen en la futura fase física, con un solo maestro RS485. Hardware, alimentación AC/DC desde la entrada 220–240 V y diseño de la caja adjunta se resolverán después. La arquitectura antigua HA/MQTT es referencia histórica; no es dependencia ni fuente de verdad del producto nuevo.

## Flujos de interfaz actualizados

La referencia visual/funcional es `ESPECIFICACION_UI_PARA_CODEX.md`. La UI usa tarjetas oscuras, acentos verdes y navegación reconocible. Las tarjetas HA del paquete se conservan como fuentes de estudio y no se sirven como scripts del producto.

La carga se realiza en diálogo propio y solo escribe/valida una memoria. RUN exige una memoria explícita; la API rechaza mezclar un perfil de biblioteca en esa orden. El editor presenta 19 recorridos y marca C01 como PV dinámica previa al inicio; el historial conserva por separado su valor inicial realmente utilizado.

El historial agrupa por identidad del snapshot ignorando C01, no por el nombre mutable de la sesión. Los indicadores de máxima, desviación, continuidad y tiempo por tramo usan todas las lecturas antes de reducir el trazado. La continuidad suma solo intervalos positivos de hasta 5 segundos; los tiempos por tramo requieren además el mismo tramo y memoria. La UI ofrece hasta siete sesiones terminadas en comparación y una cronología de eventos observados, sin inferir pausas de una meseta.

## Integridad del trazado y disponibilidad

`analysis.chart_data` obtiene marcas iniciales/de cambio de tramo y memoria, huecos y pausas de las lecturas completas antes de reducir el trazado. Asigna un grupo de continuidad a cada muestra, por lo que un intervalo grande entre puntos reducidos no se confunde con un hueco real. Se conservan ambos extremos de cada hueco. Los CSV mantienen todas las lecturas; sus campos exportados no cambian.

La interfaz comparte un único dominio y ticks de tiempo entre temperatura y desviación; al incluir el programa puede extender ambas escalas sin extender las lecturas reales. Las pausas usan estado PAUSA explícito; no se deducen de SV constante. Un hueco puede contener cambios de estado desconocidos: el sombreado entre observaciones no demuestra qué ocurrió durante la desconexión.

El worker expone estado de comunicación y edad monotónica de última sincronización completa. La disponibilidad deja de ser válida si se detiene el hilo o supera el margen de antigüedad, aun cuando el último bloque decía conectado. El sondeo relee dinámicos/memoria/escala después de las cuatro memorias; si SPC cambia, o dP/estado no son compatibles, no publica datos parciales. El frontend distingue indisponibilidad HTTP y RTU, y limita la espera por solicitud sin reenviar escrituras. Un fallo de la API de eventos no degrada falsamente la comunicación del programador.

El modo sigue siendo simulador exclusivamente. La futura integración USB necesita configuración estable del dispositivo y passthrough al LXC, permisos, exclusión de maestro, apertura al arrancar y reapertura tras hotplug, usando el comunicador físico confirmado. No se ha implementado ni probado esa integración.

## Puente MQTT opcional

`mqtt_bridge.py` contiene configuración privada, cliente Paho opcional, adaptación del contrato histórico y discovery. El callback MQTT valida fecha/TTL, identificador, retención y payload; entrega la operación al worker existente con origen `mqtt`, plazo monotónico y guardia de generación de conexión. No lee ni escribe RTU directamente. El worker comprueba la guardia/caducidad en cola, tras sincronizar y antes de cada escritura. Las verificaciones de una escritura ya iniciada se completan sin repetirla.

Los resultados de futuros se recogen en una cola y se publican después de confirmar la operación. La telemetría procede de snapshots confirmados del mismo worker; una caída MQTT no modifica la disponibilidad RTU ni el control web. La API expone solo estado/host/temas del puente, nunca credenciales. MQTT y RTU tienen indicadores separados.

Un diario `mqtt-commands.sqlite3` conserva deduplicación durante 24 horas, con capacidad limitada y rechazo al llenarse; no elimina entradas vigentes para permitir reejecuciones. Tras reinicio no se ejecutan órdenes pendientes. El cierre cancela órdenes no empezadas; si una estaba en curso se conserva el estado local y no se reenvía.

Los temas históricos se usan por petición expresa con horno físico desconectado. Discovery usa el identificador independiente `cjd9000p_local`, conservando la identidad de los descubrimientos antiguos. No se migra ni modifica la base PostgreSQL ni se reemplazan servicios WebSocket de historial HA. Protocolo, configuración y pruebas reales en `docs/MQTT.md`.

La activación MQTT se ejecutó fuera del sandbox con autorización: se comprobó respuesta HTTP loopback del panel y suscripción al broker real. Las limitaciones de sockets del sandbox siguen vigentes; esta comprobación no equivale a una prueba visual/táctil ni a acceso desde otro equipo de la LAN.

## Cola transaccional para el historial MQTT

El esquema actual SQLite se define únicamente en `store.SCHEMA_VERSION`. El esquema 3 añade `mqtt_history_runs` y `mqtt_history_outbox`; antes de actualizar se crea copia consistente del esquema anterior. Los campos de perfiles y cocciones no se eliminan. La cola se incluye en las copias SQLite normales.

Con el puente habilitado, Store crea INICIO junto a la sesión, encola muestras y transiciones PAUSA/REANUDACION junto a cada lectura, y FIN junto al cierre. Esa transacción evita un historial local confirmado sin su mensaje pendiente correspondiente. La cola independiente de claves foráneas conserva los mensajes todavía no publicados aunque el usuario borre una sesión terminada localmente. La biblioteca/historial local no se reconstruye a partir de MQTT.

El hilo de publicación envía por los temas históricos con QoS 1 y no retención, espera PUBACK y elimina solo el elemento confirmado. Una retransmisión conserva event_id/run_id. No hay confirmación de aplicación del consumidor remoto: PUBACK acredita al broker, no una inserción de HA. El modo sin MQTT no genera mensajes históricos nuevos. No se realiza importación retrospectiva automática de las sesiones anteriores a esta corrección.

## Selección de transporte dentro del worker

`serial_adapter.py` separa configuración y cliente físico del simulador. PyModbus/pyserial solo se importan al intentar abrir el transporte físico. La selección `set_mode` de la API se encola en el worker; no cambia el adaptador desde HTTP ni desde el callback MQTT. Se bloquea durante sesiones activas/pausadas, cierra el anterior y reinicia cachés/estado de lectura antes de sincronizar el nuevo. La generación asociada a cada solicitud impide ejecutar una orden antigua en otro origen.

El adaptador físico usa dispositivo configurado, control de identidad del nodo, bloqueo local, PySerial exclusivo y TIOCEXCL. La apertura inicia solo lecturas y una espera de estabilización no bloqueante. Se releen configuración y cuatro memorias antes de online. `retries=0` conserva una sola escritura; la relectura determina ACK perdido o incertidumbre. Se evita escribir después de una reconexión durante la preparación. Una retirada/reaparición del USB vuelve a intentarse desde el sondeo, sin reenvío de comandos.

El esquema SQLite 4 añade `firings.mode`; los registros anteriores se etiquetan simulados porque las versiones previas no abrían un puerto físico. La cola histórica toma el modo de la sesión, no el modo actual, y MQTT usa el origen actual en telemetría. La preferencia de conexión se guarda en un archivo local atómico dentro de data, y el arranque respeta esa elección; por defecto es simulador.

Esto sustituye las descripciones históricas de transporte únicamente PTY. Continúan pendientes validación real y confirmación de la biblioteca física histórica. El regulador CJD mantiene control térmico; cambiar de modo o reiniciar la app no le envía STOP ni RUN. Detalles en `docs/MODBUS_USB.md`.

## Ejecución como servicio

`scripts/install_service.py` genera una unidad de usuario con rutas a la copia actual, valida la unidad, conserva el directorio de datos y sustituye la instancia manual de forma ordenada. Se habilita `cjd-panel.service` para `default.target` y linger para arrancar el gestor de usuario con Debian sin depender de una sesión. No se introduce una dependencia de Home Assistant/MQTT para el arranque ni se espera a que el USB exista. La unidad reinicia ante fallo y conserva el modo elegido; la aplicación no envía RUN al iniciar.

Los datos y archivos privados siguen perteneciendo al usuario y la unidad no contiene credenciales. El registro operativo pasa a journald. El instalador comprueba un solo proceso y respuesta de API, además de `active`, `enabled` y `Linger=yes`; no reinicia el sistema operativo. Configuración de inicio del contenedor en Proxmox independiente, descrita en `docs/SERVICIO.md`.
