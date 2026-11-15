# Estado histórico y actual del diagnóstico

Las secciones iniciales describen la entrega solo simulador. El adaptador USB seleccionable ya está implementado y probado con PTY: véase [MODBUS_USB.md](MODBUS_USB.md). La validación con el horno real sigue pendiente.

# Diagnóstico de comunicación Modbus y USB

## Alcance comprobado

La versión del producto procede exclusivamente de `cjd_panel.__version__`. El transporte actual es `SimulatedRTU`: crea su propio PTY Linux y no enumera ni abre `/dev/ttyUSB*`, `/dev/ttyACM*` ni `/dev/serial/by-id/`. Tener el CJD conectado por USB antes de arrancar **no lo conecta con esta aplicación**. El indicador verde corresponde al RTU del simulador, tal como indica la interfaz. No se ha conectado ni enviado órdenes al horno real.

## Casos revisados y corregidos en el simulador

| Caso | Resultado exigido / verificado |
|---|---|
| Arranque con servidor RTU respondiendo | Sincronizar dinámicos, escala y cuatro memorias antes de publicar conectado |
| Arranque con cocción ya funcionando | Registrar una sesión observada, sin escribir RUN ni modificar C01/memorias |
| Arranque con cocción ya pausada | Mostrar PAUSADO y registrar estado observado; no reanudar automáticamente |
| Arranque sin respuesta | Offline con mensaje de error y evento inicial único; no guardar lecturas ficticias |
| Recuperación de respuesta | Releer estado, configuración y todas las memorias; no reenviar órdenes anteriores |
| Fallo de una memoria durante sincronización | No publicar una sincronización parcial como válida |
| Cambio de estado mientras se leen memorias | Releer dinámicos antes de publicar el estado final |
| Cambio de SPC durante sincronización | Rechazar el sondeo y recuperar en el siguiente; no mezclar memoria y datos |
| dP/estado/segmento incompatibles | Bloquear control, sin reinterpretar registros por suposición |
| Error de E/S del transporte | Declarar fallo de comunicación; recuperar lecturas si el transporte vuelve a responder |
| Worker detenido o lectura demasiado antigua | API expone `online=false`, estado `stale` y motivo; UI bloquea mandos |
| Error HTTP del navegador | Identificar servidor local sin respuesta, diferenciándolo del fallo RTU |
| Error al cargar eventos | Mostrar error de actividad, sin declarar falsamente desconexión RTU |
| ACK de escritura perdido | Relectura/confirmación según contrato existente, sin repetir la escritura |

`tests/test_history_connection.py` y `tests/test_panel.py` verifican estos casos relevantes con PTY, adaptadores intervenidos y SQLite temporal. El timeout HTTP y los mensajes de frontend se verifican en lógica con respuestas simuladas, sin afirmar prueba de red real. Un fallo permanente del descriptor PTY no equivale a hotplug físico: esta entrega no reabre un puerto USB.

La disponibilidad incluye `communication_status` (`connecting`, `online`, `offline`, `stale`), edad monotónica de última lectura y margen de antigüedad. Una muestra antigua puede conservarse para historial, pero no se presenta como PV/SV actual confirmada. El frontend limita las solicitudes de lectura a 12 segundos y las operaciones a 20; cancelar la espera HTTP no cancela una escritura ya iniciada ni autoriza repetirla.

## Casos USB físicos pendientes de implementar y verificar

| Caso | Requisito para la fase física |
|---|---|
| USB conectado antes del arranque | Abrir el dispositivo configurado al iniciar; no depender exclusivamente de recibir un evento de conexión posterior |
| USB conectado después | Detectar disponibilidad y reintentar apertura/lectura, sin escrituras automáticas |
| Desenchufar y volver a conectar | Cerrar descriptor inválido y reabrir la identidad estable del adaptador; no reutilizar un descriptor muerto |
| Cambio de ttyUSB0 a ttyUSB1 | Identificar el adaptador mediante ruta estable y configuración explícita; evitar elegir el primer puerto por azar |
| Dispositivo no visible en LXC | Comprobar passthrough y permisos del contenedor, sin modificar el LXC Ubuntu existente |
| Puerto visible pero acceso denegado | Mostrar error de permisos, diferenciándolo de timeout o CRC |
| Puerto ocupado / segundo maestro | Exclusión del dispositivo y coordinación con el ASUS; un solo maestro RS485 |
| Adaptador USB presente, CJD sin alimentación o RS485 desconectado | Mostrar dispositivo abierto pero sin respuesta válida del CJD; abrir el USB no basta para declarar conexión |
| Baudrate, paridad, bits, dirección de esclavo o cableado incorrectos | Validar parámetros del comunicador físico confirmado; no adivinarlos ni barrer escribiendo |
| Ruido, CRC, respuesta tardía o de otro esclavo | Descartar tramas ajenas/inválidas, evitar respuestas antiguas y no repetir escrituras sin confirmación |
| CJD ya funcionando al conectar | Leer estado/programa y registrar desde la primera observación; no asumir conocer el inicio anterior |

Esta matriz no implica que esos casos físicos estén implementados ni probados. Antes de esa fase hay que confirmar la versión exacta del comunicador probado con el equipo real y reutilizar sus parámetros y verificaciones. El archivo local recuperado tiene cabecera histórica V7.3.0 y etiquetas históricas V7.2.0; no está confirmado como la última versión físicamente probada. La versión exacta de PyModbus física está pendiente de comprobar.

Durante una desconexión pueden ocurrir cambios que no se observen: si el CJD para y reinicia entre dos lecturas, el protocolo de sondeo actual no permite reconstruirlo con certeza. No se inventan eventos, identidad del botón ni continuidad térmica. Las franjas de pausa históricas se basan en estados registrados y no demuestran qué ocurrió dentro de un hueco de comunicación.
