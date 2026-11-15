# Revisión de interfaz a partir del paquete de actualización

## Comparación previa con el prototipo

Se revisaron la aplicación existente, la especificación nueva, las páginas 2–8 del manual mediante sus capturas y el código de las tarjetas de referencia. El código propio ya estaba disponible; no fue necesario solicitarlo de nuevo. Los documentos técnicos actuales se conservaron, incorporando las instrucciones nuevas del ZIP sin restaurar sus planes antiguos.

Antes de modificar código se identificaron estas diferencias: aspecto claro en lugar de oscuro; lista de perfiles sin fichas gráficas y acciones propias; editor por registros sin las tres columnas de recorrido; C01 editable como temperatura fija; carga accesible solo desde el editor; control sin tabla ni programa con avance; historial sin filtros ni anotaciones y comparación limitada a PV de dos sesiones.

## Equivalencias entre la referencia y el producto local

| Tarjeta / elemento histórico | Función local | Estado, API o almacenamiento |
|---|---|---|
| Curvas: inventario de cuatro memorias | Memorias encima de la biblioteca, coincidencias ignorando C01 | `GET /api/state`, `memories`; `GET /api/profiles` |
| Curvas: ficha con nombre, descripción, gráfica, máxima y tiempo | Fichas oscuras con las mismas acciones y vista previa SVG | Perfiles SQLite; las operaciones de biblioteca no escriben Modbus |
| Curvas: Nueva / Editar / Duplicar / Eliminar | Acciones directas en biblioteca y guardado explícito | POST/PUT/DELETE `/api/profiles` |
| Editor: Tª inicial / duración / Tª final | 19 recorridos entre 20 puntos; siguiente inicio heredado | Modelo local; C01 se presenta como PV no editable; t20=0 |
| Curvas: diálogo Cargar | Selección 1–4, resumen y aviso de sustitución; confirmar carga | `POST /api/commands`, `operation=load`, relectura de 40 registros |
| Control: selección de memoria y confirmación de inicio | Elección explícita, sin seleccionar una memoria por defecto para RUN | `operation=run`, requiere `memory`; no acepta perfil para carga implícita |
| Control: Iniciar / Pausar / Reanudar / Parar | Cuatro botones visibles, habilitados según estado confirmado | Worker único; CAH; confirmación de estado posterior |
| Control: PV / SV / tramo / tiempo / estado / SPC | Lecturas y tarjetas de seguimiento | Bloque C9H–CEH, A0H y dP; ocultar valores como disponibles si offline |
| Control: programa y avance | SVG del programa, recorrido observado, marcador naranja y tabla con tramo activo | Memoria confirmada; fracción por SV en rampas o CCH en mesetas |
| Estado MQTT/Modbus combinado | Un indicador de conexión con adaptador local CJD | `state.online`; no se depende de broker ni HA |
| Telegram y entidades auxiliares | No se portan; actividad y fallos visibles localmente | Eventos SQLite y herramientas del simulador |
| Cocciones: búsqueda, estados, fechas y agrupación | Filtros que conservan selección y no reconstruyen sus inputs | Lista local; agrupación por hash de snapshot ignorando C01 |
| Cocciones: gráfica de una sesión o varias | Detalle y comparación de 2–7 terminadas, PV/SV, desviación opcional | `GET /api/firings/:id`; timestamps UTC mostrados en hora local |
| Cocciones: pausas, reanudaciones y fallos | Marcadores con títulos en gráfica y cronología textual | Eventos registrados; no se deduce una pausa a partir de SV estable |
| Cocciones: máxima, duración, desviación, continuidad y tramos | Indicadores y tabla comparativa; huecos visibles | `analysis.summarize` sobre todas las lecturas, antes del muestreo gráfico |
| Cocciones: nombre y notas personales | Edición local de nombre/observaciones hasta 4000 caracteres | PUT `/api/firings/:id`; esquema SQLite 2 |
| Cocciones: eliminación | Confirmación y borrado de sesión terminada con sus datos asociados | DELETE `/api/firings/:id`; se rechaza si sigue abierta |

## Adaptaciones deliberadas

- Se conserva el orden del manual: inventario/biblioteca, editor, carga independiente, mandos/seguimiento/programa y, finalmente, historial/comparación/observaciones.
- Botones e inputs tienen al menos 44–46 px de alto y las filas de tabla permiten desplazamiento. En pantallas estrechas, los cuatro mandos se distribuyen en dos filas; no se esconden en menús.
- La navegación principal usa los nombres Mis curvas, Control del horno y Mis cocciones. La aplicación es local y el registro de eventos sustituye dependencias de HA/MQTT/Telegram.
- El límite temporal de edición sigue siendo 0–32767 del modelo validado del producto; no se copia el límite visual histórico de 999 minutos como una nueva restricción del protocolo. Se conserva t20=0.
- La PV puede seguir subiendo tras una pausa en un horno real. Se explica esa inercia, sin alterar el simulador original ni afirmar que este la reproduce.
- C01 en vistas previas se toma de PV si hay lectura confirmada; sin comunicación se indica que falta. La biblioteca mantiene su formato CSV compatible y el backend adapta C01 de nuevo al cargar/iniciar.
- No se etiqueta una parada como final natural solo por la posición de la curva. El trazado conserva el último avance observado, no inventa tramos completados.
- Los indicadores describen medidas, no valoran la calidad de una pieza. Si falta snapshot, no se reconstruye un programa supuesto. La duración real y los minutos virtuales programados se identifican por separado.

## Verificación y aceptación pendiente

Las pruebas automatizadas cubren protocolo, persistencia y API, más migración, metadatos/borrado, elección explícita para RUN, estadísticas antes de reducir la gráfica y tratamiento de huecos. Se comprobó sintaxis JavaScript con V8 y escenarios de lógica de C01/PV, mandos por estado, selección de memoria, SVG y filtros con DOM simulado.

El entorno sigue sin navegador y bloquea sockets IP. No se ha realizado una captura del panel nuevo ni una prueba de renderizado, tacto, LAN o comparación visual lado a lado en navegador. Las capturas de `ui_reference/` son únicamente las referencias históricas proporcionadas. La aceptación visual definitiva requiere abrir cada pantalla del panel actualizado junto a la página correspondiente del manual en el navegador del otro PC.

## Revisión de los 15 cambios acordados

| Puntos | Comportamiento resultante | Origen de datos |
|---|---|---|
| 1 y 7 | Importar curva / Importar cocción; formato propio explicado y sesión importada abierta | API CSV y SQLite existentes |
| 2 y 15 | Ver gráfica con una; comparar 2–7 terminadas; fila seleccionable e indicador de notas | Lista de sesiones, selección local |
| 3 y 6 | Formulario de observaciones junto a gráfica, notas en comparación, eliminar seleccionadas con confirmación | PUT/DELETE de sesión; API rechaza abiertas |
| 4, 5 y 13 | Paleta histórica, barras por indicador, columnas por cocción y detalle individual de programa/observado | Estadísticas completas y snapshot |
| 8 y 12 | Exportar CSV y cronología conservados; programa original y marcas de eventos/tramos opcionales | Snapshot, eventos y lecturas de sesión |
| 9–11 | Cuatro botones completos; elección en verde independiente de SPC; ocultos durante marcha/pausa | Memorias y estado observado; selección explícita de RUN |
| 14 | Mostrar/Ocultar gráfica/tabla y duración programada del tramo | Programa de memoria activa y CCH observado |

La tabla de comparación identifica cada memoria dentro de la celda cuando hay lecturas del mismo tramo en memorias distintas; no mezcla esos grupos. El programa original usa C01 del snapshot, sin sustituirla por PV actual, y se dibuja con punteado distinto de SV. Sus minutos son teóricos y no incluyen esperas/pausas reales. Limitación histórica de la entrega anterior, ya corregida: las marcas se calculaban sobre la gráfica reducida y podían omitir cambios breves. Ahora se obtienen de todas las lecturas, incluido el tramo inicial. Los eventos conservan su registro completo.

El borrado múltiple usa las operaciones existentes por sesión. Si una falla, muestra cuántas se eliminaron, actualiza el listado y conserva seleccionadas las pendientes. No se presenta como una transacción única. Se bloquean sesiones abiertas tanto en UI como en API.

Verificación de esta revisión: 21 pruebas Python superadas y escenarios JavaScript ejecutados con V8 y DOM simulado para selección de memoria, marcha/pausa, tiempo programado, sesión única, notas, protección del borrado, barras/columnas y opciones gráficas. Sin navegador instalado: sigue pendiente comparar cada pantalla ejecutándose junto al manual y probar el tacto real. No se sustituyen las capturas de referencia por supuestas capturas del producto.

## Corrección posterior de gráficas y actualización

Las nueve mejoras solicitadas se aplican con una escala temporal única, etiquetas visibles de tramos y un listado desplegable accesible con tiempos; título/leyenda y cero de desviación; cortes de líneas en huecos; bandas de PAUSA desde estado registrado; Δ y continuidad 0–100; actualización del detalle abierto hasta cierre sin perder borradores; media firmada por tramo. Las barras/colores usan CSS local y atributos SVG, evitando estilos en línea bloqueados por la CSP.

La reducción conserva extremos de huecos y transporta grupos de continuidad; las marcas de tramo y las pausas usan todas las muestras. Una muestra aislada se representa con un punto. En comparaciones, las etiquetas indican además el número de serie; el listado de tramos identifica la cocción cuando las marcas se solapan. La gráfica del programa expresa minutos teóricos y puede alargar el dominio común, sin inventar lecturas de desviación en el tiempo restante.

El autorefresco conserva el formulario cuando existen cambios sin guardar y evita aplicar respuestas de un detalle anterior sobre uno recién abierto. Los fallos de actualización quedan visibles. Un error de cronología no cambia falsamente la disponibilidad del RTU.

Pruebas actuales: 34 Python y 20 comprobaciones de interfaz V8/DOM simulado (incluyendo la política de no generar estilos en línea). La aceptación visual y táctil sigue pendiente; no hay navegador disponible ni se han generado supuestas capturas del producto.

## Visibilidad inicial de desviación

La casilla real `show-deviation` se inicia marcada. Antes faltaba `checked` en el HTML, mientras el DOM simulado de las pruebas la iniciaba activa; esa diferencia ocultaba la gráfica por defecto sin impedir activarla manualmente. Se verificó el atributo del documento real y su enlace con `renderHistoryChart`, que quita `hidden` al panel al abrir una cocción. Se conserva la posibilidad de ocultarla. La comprobación de DOM simulado anterior no acreditaba el estado inicial del HTML real.

## Estado MQTT opcional

La franja del simulador muestra un indicador MQTT separado del estado RTU. El fallo MQTT no deshabilita controles locales ni se presenta como fallo RTU. La cronología identifica el origen conocido `mqtt` como Home Assistant. No se han rediseñado pantallas ni modificado las tarjetas históricas. El dispositivo descubierto en HA incluye controles y sensores; su revisión visual queda pendiente.

## Corrección del color de estado en Control

Se eliminó el verde fijo de la tarjeta Estado del programador. La tarjeta y la insignia superior comparten la clase derivada del estado observado: PARADO rojo, FUNCIONANDO verde, PAUSADO azul claro (preferencia confirmada); sin comunicación, neutro. La conexión RTU conserva su indicador independiente, que puede estar conectado con el programador parado. Se conserva la disposición existente; no cambia la comunicación ni el historial.

## Ancho completo y cabecera de conexiones

Por petición del usuario se retira el límite de ancho de las tres secciones y se conserva un margen lateral adaptado a móvil. Se elimina la insignia de estado superior: Estado del programador aparece una sola vez, en la tarjeta de seguimiento con los colores acordados. Esto sustituye las referencias anteriores a dos indicadores del estado del horno.

El botón MQTT pasa a la cabecera junto al indicador RTU y aparece si la integración está habilitada. Distingue conectado/suscrito, desconectado, sincronizando y sin confirmar por fallo HTTP. Su diálogo ofrece broker, temas y cola histórica pendiente sin credenciales. Es una consulta de estado; no envía órdenes al programador. La comparación visual/táctil en navegador sigue pendiente.

## Estilo común de conexiones

RTU y MQTT usan el mismo estilo y altura, con el fondo verdoso del indicador MQTT cuando están conectados. Se mantienen estados independientes: una caída MQTT no cambia el indicador RTU. Los colores se aplican al selector compartido, tanto al indicador RTU como al botón MQTT.

## Recuperación de indicadores antiguos y selector de simulación

Se recuperan del JS histórico de Control los chips de 152 px mínimos, tipografía, borde de 11 px, fondo translúcido y punto de conexión. Textos MQTT · Conectado y MODBUS · Conectado (o su estado desconectado/desconocido), en ese orden; Modbus mantiene independencia de MQTT.

El checkbox Simulador queda al lado y refleja el modo efectivo del servidor. Durante cambio/HTTP no confirmado/cocción activa se deshabilita. Desmarcar selecciona el adaptador físico, borra la selección de inicio y cambia la franja de origen; las herramientas simuladas desaparecen. Un error no deja una marca optimista: se vuelve a consultar el estado. Historial y detalle identifican Simulación/Horno físico. La versión actual se deja en simulador durante la validación; comparación visual/táctil pendiente.

## Desplegable de conexión

Por indicación del usuario se sustituye el checkbox por un select nativo junto a MQTT y MODBUS, con opciones Simulador y USB · /dev/ttyUSB1. Usa los valores de modo existentes y refleja la selección del servidor; mantiene bloqueo por cocción, operación pendiente o estado HTTP sin confirmar. El puerto de la opción USB se actualiza con el configurado cuando está seleccionado el modo físico. Las referencias anteriores al checkbox describen la revisión sustituida.
