# Selector de simulador y conexión Modbus USB

## Funcionamiento

La cabecera recupera el aspecto de los indicadores de la tarjeta antigua: **MQTT · Conectado** y **MODBUS · Conectado**, con el mismo fondo verde translúcido, punto y bordes. MQTT y Modbus conservan estados independientes.

El desplegable **Conexión**, junto a los indicadores, selecciona el transporte:

- **Simulador**: simulador incluido, sobre un PTY creado por la app.
- **USB · /dev/ttyUSB1**: cliente Modbus RTU físico, por defecto `/dev/ttyUSB1`.

En una instalación nueva arranca con Simulador seleccionado. La elección confirmada se guarda en `data/connection.json` y se conserva al reiniciar. El desplegable refleja la selección del servidor, no una preferencia del navegador. Abrir un puerto no equivale a conexión válida: MODBUS solo se pone verde tras sincronizar estado, escala y las cuatro memorias.

El cambio se ejecuta en el worker existente, cierra el adaptador anterior antes de crear el nuevo y limpia memorias, gráfica reciente y selección de inicio. No escribe RUN, STOP, PAUSE, RESUME ni curvas por cambiar la selección. Las órdenes que estaban en cola para el modo anterior se rechazan por generación; nunca se trasladan automáticamente al nuevo transporte.

Se rechaza el cambio mientras se observa una cocción funcionando o pausada, sin enviar STOP automáticamente. Las herramientas ficticias se ocultan y la API las rechaza en modo físico. La primera conexión a un CJD que ya funciona solo lee y registra el estado observado; no adapta C01 ni envía RUN. La hora de inicio anterior desconocida no se reconstruye.

## Parámetros y configuración

Los valores proceden del comunicador recuperado: 9600 baudios, 8 bits, paridad N, 2 bits de parada, dirección Modbus 1, timeout de 2 s y estabilización/reconexión de 5 s. El cambio de puerto a `/dev/ttyUSB1` procede de la petición actual del usuario. No se interpreta literalmente `usbttty1`, que no es el nombre estándar Linux solicitado en contexto.

Se puede copiar `modbus.example.json` a `.modbus.json` y ajustar los parámetros. `.modbus.json` está ignorado por Git y excluido del paquete; la plantilla no contiene secretos. También puede elegirse con `--modbus-config RUTA`. El puerto debe ser una ruta absoluta de `/dev/`; no se escanean dispositivos ni se elige uno por azar.

La versión exacta de la biblioteca utilizada antiguamente con el horno sigue **pendiente de comprobar**. Para este adaptador se fija una instalación nueva reproducible: PyModbus 3.11.4 y pyserial 3.5, probada contra el simulador por PTY. No se afirma que sea la versión histórica físicamente validada. Se reutilizan la detección de `device_id`/`slave`/`unit`, FC03/FC16, signed16, respaldo de lectura dinámica C9/CA + CC + CD/CE, y las validaciones/relecturas del worker del programa local.

## Dependencias opcionales

```bash
python3 -m pip install --require-hashes -r requirements-modbus.txt
```

En este entorno se instalaron las wheels verificadas en `.serial-deps/`, sin modificar Python del sistema. La carpeta está ignorada y no se distribuye. El modo simulador no necesita importar estas bibliotecas. Si faltan, el modo físico queda seleccionado pero offline y explica qué instalar; no vuelve silenciosamente al simulador.

Referencias de biblioteca: [cliente serie PyModbus](https://pymodbus.readthedocs.io/en/v3.11.0/source/client.html) y [distribución fijada](https://pypi.org/project/pymodbus/3.11.4/). Las versiones son de dependencias; la versión del panel se deriva de `cjd_panel.__version__`.

## Exclusión, reconexión y escrituras

El worker es el único propietario del cliente serie. Hay bloqueo de dispositivo por ruta canónica entre instancias locales, exclusión PySerial y exclusión de nuevas aperturas con TIOCEXCL. Eso no impide que otro ordenador sea maestro del mismo bus RS485: el comunicador del ASUS debe permanecer detenido antes de utilizar este enlace físico.

Se intenta conectar tanto si el USB estaba presente al arrancar como si aparece después. Ausencia, permisos, puerto ocupado o falta de respuesta quedan offline con error; se reintenta desde lecturas. Si se desconecta o cambia la identidad del dispositivo, se cierra el descriptor y se vuelve a abrir el puerto configurado. Se respeta la espera de estabilización sin dormir el worker.

Las escrituras usan `retries=0`: no se reenvían automáticamente. Un ACK perdido permite relectura exacta para determinar el resultado; sin confirmación se informa de incertidumbre. No se abre un puerto desde una escritura ni se continúa escribiendo si hubo una reconexión durante la preparación. El worker mantiene el estado permitido, C01/PV, comparación de 40 registros y confirmación CAH que ya tenía la aplicación.

## Historial y MQTT

El esquema SQLite actual se toma de `store.SCHEMA_VERSION`. El esquema 4 añade el origen `simulator`/`physical` a cada sesión, con backup previo del esquema anterior. Los registros existentes se conservan como simulados, porque las entregas anteriores nunca abrían un puerto físico. El listado y detalle muestran ese origen; el outbox usa el origen guardado de cada cocción y la telemetría identifica el transporte actual.

La selección del desplegable no modifica los temas MQTT ni sus credenciales. Las órdenes de HA siguen pasando por el mismo worker. Un reinicio interrumpe la sesión local anterior porque no se puede asegurar continuidad, pero no envía STOP ni RUN al CJD; si se observa una cocción física en marcha al reconectar, se registra desde la nueva observación.

## Validación y alcance

Las pruebas usan exclusivamente clientes intervenidos y puertos PTY del simulador creado por ellas. Cubren puerto ya presente, ausencia/reaparición, FC03/FC16 y ACK, exclusión, estabilización, ACK perdido sin repetición, respaldo de lectura dinámica, arranque ya funcionando sin escrituras, cambio serializado, bloqueo durante cocción y rechazo de órdenes del modo anterior.

No se ha abierto `/dev/ttyUSB1` del horno ni se ha afirmado validación física/térmica. La instalación se deja en modo simulador; el usuario activa la conexión física al seleccionar USB. Si el adaptador no aparece dentro del LXC, debe revisarse su acceso/passthrough en la fase física, sin modificar el LXC Ubuntu ni el ASUS desde estas pruebas.

Verificación de esta entrega: 77 pruebas Python superadas y comprobaciones V8 de historial e indicadores/selector con DOM simulado. Ninguna prueba abrió el puerto del horno. La revisión visual/táctil y la aceptación con el CJD real siguen pendientes.
