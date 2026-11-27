# MQTT opcional con Home Assistant

## Alcance actual

El programa local publica el estado del simulador y recibe órdenes a través del broker MQTT. La interfaz web local sigue funcionando si HA o MQTT no están disponibles. El único worker RTU mantiene las lecturas, escrituras, adaptación C01/PV, relectura y confirmación; el hilo MQTT nunca abre el transporte ni un puerto USB.

Por petición expresa del usuario se usan **los mismos temas históricos `horno/cjd9000p/...`**, con el horno real desconectado durante esta fase. Las pruebas no usan un prefijo alternativo. El publicador del comunicador antiguo debe permanecer detenido para que no haya estados contradictorios. El adaptador físico seleccionable está documentado en `MODBUS_USB.md`; las pruebas y la instalación actual permanecen en simulador.

La versión del producto se obtiene de `cjd_panel.__version__`. El contrato proviene del comunicador histórico recuperado y las tarjetas existentes; no se importa ni ejecuta el comunicador original.

## Configuración privada y dependencia opcional

- `.mqtt.json` contiene host, puerto y credenciales. Está excluido del repositorio y del paquete; permisos de creación 0600. La API no devuelve usuario ni contraseña.
- En este entorno se configuró el host indicado por el usuario y se extrajeron usuario/contraseña del Python antiguo mediante AST, sin ejecutarlo ni mostrar credenciales.
- `requirements-mqtt.txt` fija paho-mqtt 2.1.0 con hash SHA-256 de su wheel universal. El modo local sin MQTT no necesita esta dependencia.
- Aquí se instaló la wheel verificada en `.mqtt-deps/`, también excluida. En otro equipo con pip, usar `python3 -m pip install --require-hashes -r requirements-mqtt.txt` en el entorno Python elegido. La wheel local no se incluye en el paquete.

Para recuperar las credenciales en otra copia donde esté disponible el original local:

```bash
python3 scripts/configure_mqtt.py --source CJD9000P_Fedora_CJD_V7_3.py --host IP_BROKER
```

No sobrescribe un archivo ya existente. También se puede copiar `mqtt.example.json` como `.mqtt.json`, ajustar los valores y ejecutar `chmod 600 .mqtt.json`. La plantilla pública no contiene las credenciales reales. El esquema es:

```json
{
  "host": "IP_BROKER",
  "port": 1883,
  "username": "USUARIO_MQTT",
  "password": "CONTRASENA_MQTT",
  "topic_prefix": "horno/cjd9000p",
  "client_id": "cjd-control-panel-local",
  "discovery_prefix": "homeassistant",
  "device_id": "cjd9000p_local",
  "tls": false
}
```

La configuración usa credenciales del broker MQTT, no un token de la API de HA. `tls` permite TLS con validación del sistema cuando el broker esté configurado para ello; aquí se usa el puerto histórico del broker.

## Arranque

```bash
python3 -m cjd_panel --host 0.0.0.0 --port 8080 --no-auth
```

Si existe `.mqtt.json` en la carpeta de trabajo, se activa automáticamente. Se puede elegir otro archivo con `--mqtt-config RUTA`. Para funcionamiento únicamente local, incluso con ese archivo presente:

```bash
python3 -m cjd_panel --no-mqtt
```

El panel muestra por separado conexión RTU del simulador y conexión MQTT. Una caída de MQTT no altera PV/SV ni bloquea los mandos locales. El estado JSON incluye un resumen MQTT sin credenciales.

## Temas publicados

| Tema relativo a `horno/cjd9000p/` | Contenido |
|---|---|
| `state` | `timestamp`, `pv`, `sv`, `segmento`, `estado`, `estado_texto`, `tiempo_cjd`, `memoria`; además `mode=simulator` y versión derivada |
| `config` | `curva`, `spc`, `cyc`, `dp`, modo y versión; retenido |
| `curva` | `memoria_activa`, cuatro `memorias` con 20 puntos `segmento`/`temperatura`/`tiempo`; retenido |
| `status` | Disponibilidad separada de MQTT/Modbus, modo y versión; retenido |
| `mqtt/availability` | `online`/`offline`; testamento MQTT y cierre ordenado |
| `modbus/availability` | `online` solo con lectura RTU completa y reciente; retenido |
| `coccion/event` | INICIO, PAUSA, REANUDACION, FIN con `run_id` y metadatos históricos; QoS 1 sin retención |
| `coccion/state` | Lecturas registradas de cocción con `run_id`; QoS 1 sin retención |
| `event` | Eventos locales/observados y `RESULTADO_ORDEN` con identificador, estado y resultado confirmado; no retenido |
| `controls/run/availability`, `controls/pause/availability`, `controls/resume/availability`, `controls/stop/availability` | Disponibilidad específica según estado RTU confirmado |

`state` se publica sin retención; una muestra antigua no convierte una desconexión en comunicación válida. Los sensores descubiertos expiran si dejan de recibir estado. Las memorias y configuración retenidas se acompañan siempre de disponibilidad; no sustituyen las relecturas RTU ni SQLite.

## Órdenes recibidas

| Tema relativo | `command` y datos |
|---|---|
| `run/set` | `run`, `memoria` explícita 1–4 |
| `pause/set` | `pause` |
| `resume/set` | `resume` |
| `stop/set` | `stop` |
| `curva/activa/set` | `seleccionar_curva`, `memoria` 1–4, solo PARADO |
| `curva/set` | `escritura_curva`, `memoria_destino` (o `memoria`) y 20 `segmentos` con `temperatura`/`tiempo`; solo carga y verifica, nunca inicia |
| `curvas/get` | `{}`; lectura por el worker y republicación de memorias |

Ejemplo de inicio (la fecha y el identificador deben generarse en el momento de pulsar):

```json
{
  "command": "run",
  "command_id": "IDENTIFICADOR_UNICO",
  "issued_at": "FECHA_ISO_CON_ZONA_HORARIA",
  "ttl_seconds": 30,
  "memoria": 1
}
```

Las acciones se publican con `retain=false`. Se rechazan retenidos, payloads inválidos, órdenes caducadas, fechas sin zona o demasiado futuras, RUN sin memoria y comandos incompatibles con el estado. TTL de 1 a 120 segundos, tolerancia futura de 15 segundos, como en el contrato histórico. El worker revalida caducidad y conexión antes de escribir; nunca repite una escritura por reconectar MQTT.

Un diario separado `data/mqtt-commands.sqlite3` conserva hasta 2048 identificadores durante 24 horas. Impide ejecutar un duplicado tras reiniciar; las órdenes pendientes de una ejecución anterior se marcan con resultado incierto y no se recuperan. Esta base es de deduplicación, no reemplaza la biblioteca/historial de `cjd.sqlite3`. La copia de seguridad del panel conserva perfiles e historial; el diario debe conservarse aparte si se traslada el servicio sin querer perder deduplicación.

Resultados: `accepted` significa recibida/encolada; `succeeded` solo se publica después de la relectura RTU; también existen `rejected`, `failed`, `duplicate` y `cancelled`. Si una escritura empezó y pierde confirmación, el resultado es incierto y no debe reenviarse automáticamente. La pérdida de MQTT cancela órdenes que todavía no habían empezado; una operación ya iniciada puede completarse y debe consultarse el estado observado.

## Home Assistant

El puente publica discovery para un dispositivo **CJD local · simulador**, con identificador propio `cjd9000p_local`, sin reemplazar los identificadores de discovery antiguos. Usa los temas históricos pedidos para sus datos y órdenes. Incluye seis sensores y siete botones: Iniciar memoria 1/2/3/4, Pausar, Reanudar y Parar. Cada botón genera un identificador y una fecha nuevos mediante plantilla HA y no retiene órdenes. La disponibilidad de cada acción sigue el estado confirmado.

La publicación se repite al reconectar el broker o recibir el nacimiento `homeassistant/status=online`. Las tarjetas/integraciones ya instaladas que utilicen el contrato histórico pueden consumir los mismos datos y acciones; no se han modificado archivos de HA. La biblioteca/historial de las antiguas integraciones personalizadas no se ha sustituido: el puente cubre telemetría, control, carga de memorias y flujo histórico compatible, pero no añade un servidor WebSocket `cjd9000p_history` ni convierte su base PostgreSQL en fuente local.

Referencias consultadas: [MQTT button de Home Assistant](https://www.home-assistant.io/integrations/button.mqtt/) para `command_template`, discovery y disponibilidad; [Eclipse Paho Python](https://eclipse.dev/paho/clients/python/docs/) para callbacks VERSION2 y conexión asíncrona.

## Validación

```bash
python3 -m unittest discover -s tests -v
python3 scripts/check_mqtt.py --config .mqtt.json
```

La primera prueba es local y no conecta un broker. La segunda comprueba autenticación/suscripción sin publicar acciones ni modificar la disponibilidad. Para repetir deliberadamente el ensayo de control con simulador temporal, con el horno físico desconectado y sin otra instancia usando los mismos temas:

```bash
python3 scripts/check_mqtt.py --config .mqtt.json --exercise
```

El ensayo usa SQLite temporal, un PTY y clientes de prueba con identificadores propios; publica acciones reales en los temas acordados. Se verificaron en el broker del usuario autenticación, suscripción, telemetría, RUN/PAUSE/RESUME/STOP, rechazo de duplicados y publicación de un cambio originado localmente. No se abrió un puerto físico ni se modificó la base de datos del usuario durante ese ensayo. La visualización y pulsación dentro de HA siguen pendientes de comprobar en su interfaz.

## Activación en el entorno del usuario

Se guardó una copia SQLite consistente antes de sustituir la instancia local del panel. El arranque actualizado se verificó mediante `/api/state` en HTTP loopback: versión derivada vigente, RTU del simulador online y MQTT conectado con suscripciones confirmadas sobre los temas históricos. No se afirma una comprobación visual del navegador ni de la interfaz HA, ni una prueba del puerto físico. El servicio escribe su salida local en `data/panel.log`.

Validación final de la entrega: 53 pruebas Python superadas y 20 comprobaciones de interfaz con V8/DOM simulado. La prueba de broker usó datos temporales; la activación posterior conserva los datos del panel y añade su diario MQTT.

## Registro histórico corregido

La revisión anterior enviaba `state` y `event` generales, pero omitía `coccion/event` y `coccion/state`. Por eso las lecturas en vivo podían funcionar sin que el registrador antiguo recibiera la sesión. El programa histórico publica eventos `tipo=INICIO/PAUSA/REANUDACION/FIN` y lecturas con `run_id`; ahora el puente también los emite desde los datos guardados en SQLite.

INICIO contiene `run_id`, `timestamp`, `inicio`, `memoria`, `nombre_curva`, `perfil_id` y `segmentos` (`segmento`, `temperatura`, `tiempo`). El ID de perfil HA no se inventa: `perfil_id=null` mientras no exista un mapeo confirmado; `csv=null` porque la fuente local es SQLite y no existe el fichero del antiguo comunicador. Las lecturas contienen `run_id`, `timestamp`, `pv`, `sv`, `segmento`, `estado`, `estado_texto`, `tiempo_cjd` y memoria. FIN incluye `motivo`, `confirmado`, `descartada`, `clasificacion` y `ultima_lectura`.

Los mensajes se guardan en `mqtt_history_outbox` en la misma transacción que crea la sesión, guarda una lectura o la cierra. Solo se generan al activar el puente o para sesiones que ya se habían anunciado; el funcionamiento exclusivamente local no acumula una cola inútil. Una sesión activa se anuncia al habilitar MQTT, una sola vez. No se reenvía automáticamente todo el historial anterior a esta corrección ni se reconstruyen sesiones antiguas de HA.

La cola se envía ordenada en lotes, con QoS 1 y `retain=false`. Solo se elimina un elemento tras PUBACK. Si la confirmación tarda, se espera al mismo envío pendiente en lugar de publicar otra copia en cada iteración. Un corte justo después del PUBACK y antes del borrado todavía puede retransmitir: el `event_id` estable y el `run_id` permiten reconocerlo. Es entrega al menos una vez, no una garantía de inserción exactamente una vez en PostgreSQL/HA.

El esquema SQLite actual se define en `store.SCHEMA_VERSION`; la migración crea una copia consistente `cjd.sqlite3.pre-schema-N.bak (N es el esquema de destino)` antes de actualizar. Al reiniciar el simulador, una sesión pendiente se cierra con FIN no confirmado y motivo `servicio_reiniciado`; no se presenta como fin térmico natural. Los ensayos breves no se descartan automáticamente por estar fríos: el producto local los guarda como cocciones. Esto difiere deliberadamente de la heurística de falso arranque del comunicador histórico.

Si el broker permanece desconectado durante cocciones, la cola crece en disco hasta poder recibir las confirmaciones. Comprueba el espacio libre y la cola si mantienes MQTT habilitado. La API muestra `mqtt.history_pending`. Un valor cero significa que el broker confirmó la cola, no que el registrador HA haya aceptado las filas. Si HA sigue sin mostrarlas, se necesitan sus registros o el código del consumidor para comprobar sus validaciones concretas; el puente no accede ni modifica directamente esa base.

Para comprobar el ciclo histórico contra el panel que ya está funcionando, sin crear una segunda instancia en los mismos temas:

```bash
python3 scripts/check_mqtt.py --config .mqtt.json --exercise --against-running
```

Es una prueba deliberada que inicia/pausa/reanuda/para el simulador activo y deja sesiones de ensayo en el historial local. El observador exige INICIO/PAUSA/REANUDACION/FIN y muestras del mismo `run_id`. La recepción se comprueba en el broker; la aparición en Mis cocciones de HA necesita verificación separada en su interfaz.

## Verificación de la corrección histórica

La entrega corregida se activó con copia previa de perfiles/historial y migración del esquema anterior. Se ejecutó el ensayo sobre el simulador activo, sin segundo puente: el observador del broker recibió INICIO/PAUSA/REANUDACION/FIN y muestras del mismo run_id; el ensayo terminó PARADO y la cola histórica quedó en cero. Se verificó también el rechazo de duplicados y la publicación de un cambio local. Pasaron 63 pruebas Python. La base de HA no fue inspeccionada ni modificada; su aceptación sigue siendo una comprobación distinta.

## Archivo privado y repositorio

IP (`host`), puerto (`port`), usuario (`username`) y contraseña (`password`) se leen exclusivamente de la configuración privada al activar MQTT; no se copian al código ni a la plantilla pública. `.gitignore` excluye `.mqtt.json`. El generador de paquetes excluye expresamente ese nombre aunque aparezca dentro de fuentes y distribuye `mqtt.example.json` como guía. La configuración ya existente no se sobrescribe. Para aplicar cambios de conexión hay que reiniciar el servicio; el código no recarga credenciales durante una cocción.

## Origen físico seleccionable

El desplegable Conexión permite seleccionar el adaptador físico descrito en `MODBUS_USB.md`. MQTT conserva temas, credenciales y el único worker. La telemetría/resultados publican el modo actual y el historial conserva el origen guardado de cada sesión; no etiqueta como simulados los datos físicos ni transforma sesiones antiguas en físicas. La generación del transporte impide que una orden encolada para el simulador actúe después sobre el puerto físico. Los indicadores MQTT/Modbus siguen siendo independientes.
