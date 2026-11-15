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
