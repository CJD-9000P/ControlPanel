# Contrato adoptado para el desarrollo con simulador

Fuentes históricas: comunicador V7.3.0 y simulador DEMO V7.5.1 aportados para el desarrollo. El comunicador original se conserva solo en local; véase `INVENTARIO.md`. Sus versiones pertenecen a esos componentes, no a la nueva aplicación. Las fuentes originales no se modifican. Los dos PDF proporcionados son idénticos por SHA-256.

## Registros y operaciones

| Operación | Registro / función | Verificación |
|---|---|---|
| Lectura dinámica | FC03, C9H–CEH, seis signed16 | Estado 0/1/2, segmento 1–20 |
| Memoria activa | A0H, SPC 1–4 | Relectura después de FC16 |
| Escala decimal | A3H, dP | Solo dP=0; cualquier otro valor bloquea control |
| Memorias 1–4 | 00H / 28H / 50H / 78H | 40 registros, 20 pares temperatura/tiempo |
| RUN / STOP / PAUSE / RESUME | FC16, C4H = 1 / 2 / 3 / 4 | CAH = 1 / 0 / 2 / 1 |
| Temperatura actual / consigna | CDH / CEH | signed16 con dP=0 |
| Minutos transcurridos del tramo | CCH | No confundir con duración total de sesión |

Los campos C4H y C9H–CEH, la codificación de estado, las funciones FC03/FC16 y signed16 se han contrastado con el texto del manual proporcionado. El mapa de memorias y la secuencia operativa proceden además del código de referencia y sus autopruebas. No se ha realizado una prueba física.

## Secuencia de carga e inicio

1. Sincronizar estado y cambios externos antes de ejecutar la orden de la app.
2. Leer CAH y dP; requerir PARADO y dP=0.
3. Seleccionar SPC y releerlo, si la operación es selección o RUN.
4. Leer PV y validar 0–1200 °C. Adaptar solo C01 de una copia del perfil; no editar la biblioteca.
5. Si solo cambia C01, escribir un registro. En otro caso, escribir los 40 registros. Revalidar PARADO inmediatamente antes de escribir.
6. Releer y comparar exactamente los 40 registros, incluso al escribir solo C01.
7. Para RUN, releer PV y adaptar de nuevo si cambió; comprobar de nuevo SPC y PARADO, escribir C4H=1 y confirmar CAH=1.
8. PAUSE, RESUME y STOP conservan sus estados permitidos y se confirman leyendo CAH, con límite de seis segundos e intervalo de 300 ms.

Un solo worker es propietario del cliente RTU. HTTP nunca lee ni escribe directamente. El transporte actual solo abre el PTY que acaba de crear el simulador incluido; no recibe un puerto físico configurable. El servidor del simulador tiene su hilo aislado para procesar tramas y avanzar su modelo ficticio.

## Fallos y decisiones de esta entrega

- Timeout RTU de 0,8 segundos. Las lecturas vuelven a intentarse en el siguiente sondeo, normalmente cada segundo; no hay reenvío automático de escrituras.
- Si se pierde un ACK, se intenta relectura exacta o confirmación de CAH. Se registra recuperación solo si el resultado coincide. Sin confirmación se devuelve error y resultado incierto.
- Ante pérdida de comunicación, la UI muestra valores no disponibles y bloquea controles. No se guardan muestras ficticias durante la desconexión. Al reconectar se releen estado, configuración y cuatro memorias.
- Una solicitud HTTP espera hasta 15 segundos. Si una orden sigue en cola, se cancela al vencer el plazo; si ya ejecutaba, se avisa de resultado incierto y se consulta el estado antes de repetirla.
- Las sesiones observadas por sondeo se registran como `observed`. No se infiere que un cambio externo procede de un botón físico.
- Se han restringido los perfiles nuevos a temperaturas 0–1200 °C, tiempos 0–32767 y t20=0, con alguna transición positiva. Son límites del producto para el modo actualmente soportado, no una afirmación sobre todas las funciones posibles del firmware.
- Un reinicio interrumpe la sesión de simulación anterior; no se confunde con reanudar un horno real.

El comunicador histórico usaba PyModbus, reintentos y otros mecanismos ligados a MQTT. Esta entrega conserva mapa, secuencia, worker y verificaciones, pero usa un transporte PTY mínimo con biblioteca estándar. El futuro adaptador físico deberá recuperar y validar parámetros, compatibilidad PyModbus y comportamiento de reconexión contra el archivo físico confirmado. No presentar el transporte simulado como driver físico validado.

## Separación de órdenes en la interfaz actualizada

La API exige `memory` explícita para RUN y rechaza `profile_id` en esa orden. Primero se carga el perfil mediante la acción `load`, que no escribe C4H ni inicia una sesión; después RUN utiliza el programa confirmado de la memoria. El editor muestra C01 como PV y el backend sigue releyendo PV para la adaptación real, sin confiar en la vista previa del navegador.

## Revisión de disponibilidad y arranque

La disponibilidad requiere una sincronización completa reciente y worker vivo. El margen de antigüedad usa el intervalo y timeout del adaptador y se expone como `freshness_limit_seconds`; no es una garantía sobre un puerto físico. La edad se calcula con reloj monotónico, independiente de ajustes del reloj UTC. El bloque dinámico, SPC y dP se releen tras sincronizar memorias; un cambio de SPC o valor incompatible impide publicar una mezcla de estados.

Los fallos iniciales también generan evento offline, sin repetirse en cada sondeo. Los errores de E/S se convierten en fallos de comunicación y las lecturas se recuperan en sondeos posteriores; nunca se reenvía una escritura por este motivo. Un arranque con simulador ya funcionando/pausado registra estado y sesión observados mediante lecturas, sin RUN ni adaptación de C01. La hora inicial corresponde a primera observación, no a una hora histórica desconocida.

Casos probados y pendientes del USB físico: `DIAGNOSTICO_MODBUS.md`. La entrega actual no enumera ni abre dispositivos USB.

## Entrada MQTT opcional

El puente reutiliza los temas y el sobre histórico con `command_id`, `command`, `issued_at` con zona y `ttl_seconds` 1–120. RUN exige memoria explícita. Retenidos, duplicados y órdenes caducadas no se ejecutan. No existe un segundo maestro: MQTT solo encola operaciones en el worker. Una escritura ya iniciada se verifica sin reenvío; `accepted` no equivale a éxito. La carga MQTT usa la misma adaptación C01/PV y los 40 registros verificados, sin iniciar ni añadir automáticamente un perfil a SQLite.

Las acciones que se conocen como originadas por HA se registran como `mqtt`; los cambios externos siguen siendo observados. Configuración y contrato MQTT completo en `MQTT.md`. El transporte continúa siendo únicamente el PTY del simulador.

## Adaptador físico seleccionable

El usuario ha solicitado el paso seleccionable a USB desde la cabecera. `PhysicalRTU` usa `/dev/ttyUSB1` por defecto y los parámetros 9600 8N2/dirección 1 del código recuperado. Copia la detección del argumento de dispositivo y la secuencia de lectura de respaldo (C9/CA, CC, CD/CE). El worker conserva FC03/FC16, dP=0, C01/PV, comparación de memorias y confirmación CAH. PyModbus 3.11.4/pyserial 3.5 son dependencias nuevas elegidas y probadas con PTY; no se atribuyen a la instalación física antigua desconocida.

No hay reintentos de escritura de biblioteca. La selección no envía RUN/STOP ni cargas; se conecta por lectura. Los tests usan únicamente PTY propios, incluido ACK perdido y exclusión de un segundo cliente. Documentación y pendientes de aceptación física en `MODBUS_USB.md`. Esta sección sustituye las limitaciones históricas que indicaban ausencia de puerto configurable.
