# Especificación de interfaz para Codex — CJD Control Panel

## Fuentes de referencia

- Manual PDF: `ui_reference/CJD9000P_Manual_de_usuario_para_artesanos.pdf` y capturas de páginas 2–8.
- Código de tarjetas existentes: `fuentes_referencia/tarjetas_homeassistant/`. Leer las tres tarjetas completas antes de diseñar. Son el referente más preciso para estructura, jerarquía, distribución de datos, controles, gráficas, estilos y comportamiento de la interfaz actual.

El manual y las tarjetas se crearon para Home Assistant; sirven como referencia de interfaz y reglas de producto. No portar sus dependencias Lovelace, entidades HA, servicios HA, MQTT ni Telegram a la nueva app. Traducir el diseño y los flujos al backend local Linux.

### C01 / C1 y temperatura real

- **C01 (C1) es el punto de inicio de la curva y toma la temperatura real actual del horno, es decir PV.** Al cargar/iniciar una cocción se adapta a la lectura PV actual del programador; no es un objetivo fijo que el usuario deba inventar o editar como otro tramo.
- En Control, mostrar además **PV como temperatura actual en vivo**, actualizada con cada lectura. No confundir el valor C01 inicial con la PV que sigue variando durante toda la cocción.
- La tabla/gráfica de Curvas debe identificar claramente C01/PV como inicio real y C02–C20 como temperaturas finales de los tramos.

## Fuente visual de referencia

Usar `ui_reference/CJD9000P_Manual_de_usuario_para_artesanos.pdf` y las imágenes `ui_reference/capturas/pagina_02.png` a `pagina_08.png` como referencia de la estructura y aspecto de la interfaz anterior. El manual se creó para la implementación de Home Assistant de octubre de 2026; es una referencia visual y funcional, no una exigencia de depender de HA.

Las capturas enseñan una interfaz oscura dentro de tarjetas, con acentos verdes, gráficas de curva y tablas de tramos. Mantener esa jerarquía visual y distribución reconocible en la nueva app. Usa como base el sistema de tarjetas, tarjetas de estado, colores, tipografía, espacios, bordes, gráficas SVG y orden de acciones de los JS de referencia; evita inventar una composición distinta sin motivo. Adaptar a pantalla táctil, sin reducir controles a botones pequeños ni esconder acciones importantes en menús.

## Navegación y paneles

La navegación principal debe ofrecer estas tres áreas, con nombres reconocibles:

1. **Mis curvas**
2. **Control del horno**
3. **Mis cocciones**

## Mis curvas — referencia página 2

- Mostrar acceso visible a **Nueva curva**.
- Mostrar por separado las cuatro memorias físicas del programador y si se conoce una coincidencia con un perfil guardado.
- Mostrar la biblioteca local de perfiles, sin límite artificial.
- Cada perfil debe mostrar nombre, gráfica de temperatura/tiempo, temperatura máxima, duración y acciones **Editar**, **Duplicar**, **Cargar** y **Eliminar**.
- Distinguir perfil guardado de memoria física: crear/editar/duplicar/eliminar perfiles no escribe automáticamente en el programador.

## Editar curva — referencia página 3

- Campos de nombre y descripción.
- Editor tabular de tramos con temperatura inicial, duración y temperatura final, más una gráfica de vista previa actualizada al editar.
- Mostrar la temperatura inicial como PV/temperatura real cuando así lo requiera el protocolo; conservar la adaptación de inicio existente y no inventar una temperatura inicial fija.
- Guardar explícitamente. Validar valores antes de aceptar.

## Cargar curva — referencia página 4

- Permitir elegir una memoria física 1–4 y revisar el resumen de la curva seleccionada.
- Advertir que cargar sustituye el contenido de la memoria elegida.
- Exigir confirmación antes de escribir.
- **Cargar solo escribe la curva; nunca inicia una cocción.** Iniciar es una acción distinta desde Control del horno.
- Después de escribir, volver a leer y verificar la memoria según la secuencia ya probada en el comunicador existente.

## Control del horno — referencias páginas 5 y 6

La ausencia de estos botones es un defecto funcional: el panel debe presentar de forma directa y reconocible **Iniciar**, **Pausar**, **Reanudar** y **Parar**. Usa la tarjeta Control como fuente para la jerarquía visual de estos controles y sus estados; muestra claramente cuándo están disponibles o deshabilitados.

- Mostrar estado local de conexión con el programador (conectado/desconectado), memoria seleccionada y estado de cocción.
- Elegir explícitamente la memoria que se va a iniciar. Iniciar solicita confirmación y solo se ofrece cuando el estado lo permite.
- Pausar, reanudar y parar según las condiciones permitidas por el estado real. Mostrar confirmación/resultado, no limitarse a indicar que se envió una orden.
- Datos en vivo: PV (temperatura real), SV (consigna), tramo actual, tiempo y memoria/curva activa.
- Gráfica con recorrido realizado y avance/programa, acompañada de tabla de tramos.
- Explicar que PV puede seguir subiendo tras pausar por inercia térmica.
- La pantalla debe actualizarse también si la acción se realizó en los botones físicos originales. Registrar transiciones observadas aunque no pueda atribuirse con certeza el origen. Si la app sí conoce el origen de su propio comando, puede anotarlo.
- No mostrar MQTT ni Telegram como requisitos. Si se ofrecen después, que sean integraciones opcionales; la conectividad que importa para operar es la del propio CJD por el adaptador local.

## Mis cocciones — referencias páginas 7 y 8

- Listar sesiones con búsqueda por nombre/ID, filtros de estado y fechas, y agrupación por curva si los datos lo permiten.
- Seleccionar una sesión para ver su gráfica o varias para compararlas.
- Comparar PV/SV, duración, máxima temperatura, tramos y continuidad cuando existan datos suficientes.
- Marcar pausas y otros eventos en la gráfica o cronología.
- Permitir nombre/observaciones del usuario y eliminar una sesión con confirmación.
- Guardar la cocción en SQLite local y permitir exportarla como CSV.

## Reglas funcionales globales

- No confundir **Guardar**, **Cargar** e **Iniciar**. Son acciones distintas.
- La app refleja tanto las órdenes táctiles como los cambios hechos desde los mandos originales del CJD.
- Usar un único worker/maestro Modbus como en el comunicador probado. Validar, escribir, volver a leer y confirmar el resultado.
- No conectar el desarrollo del LXC al horno real. Implementar y afinar primero con el simulador.
- Home Assistant, Internet, MQTT y Telegram no son necesarios para el funcionamiento normal.

## Criterio de aceptación visual

Antes de dar por buena la interfaz, revisar cada pantalla junto a su página del manual. Comprobar distribución, orden de la información, gráficas, tabla y acciones; verificar que los cuatro botones de Control aparecen en la pantalla sin tener que buscarlos. Anotar de forma explícita cualquier cambio motivado por el uso táctil o por independencia de Home Assistant.


## Instrucción para pegar en Codex

> Revisa primero `AGENTS.md`, `PLAN.md`, `ARQUITECTURA.md`, `ESPECIFICACION_UI_PARA_CODEX.md` y el manual PDF con sus capturas. Inspecciona la aplicación que ya has creado y compárala pantalla por pantalla con el manual. Antes de cambiar código, deja una lista breve de diferencias entre la versión actual y los requisitos. Después corrige la interfaz conservando el proyecto existente: replica la estructura de Mis curvas, Editar curva, Cargar curva, Control del horno y Mis cocciones; añade claramente Iniciar, Pausar, Reanudar y Parar; implementa selección de memoria y confirmación de inicio/carga; no mezcles Cargar con Iniciar. La pantalla Control debe mostrar PV, SV, estado, tramo, tiempo, gráfica y tabla de tramos. El historial debe buscar, filtrar y comparar cocciones. Mantén el aspecto oscuro con acentos verdes y tarjetas/gráficas del manual, adaptado a pantalla táctil. La app funciona en Linux local sin Home Assistant, Internet, MQTT ni Telegram obligatorios. Debe reflejar también cambios hechos con los botones físicos del CJD. Reutiliza el adaptador Modbus/comportamiento del comunicador de referencia, con un único worker y confirmación de órdenes; no conectes con el horno real desde el LXC. Si una función necesita un dato o integración que aún no existe, déjala indicada y no la sustituyas por un botón sin acción. Al final resume qué pantallas y controles has corregido y qué sigue pendiente.


## Lectura de las tarjetas JS

Antes de implementar, crear una tabla interna de equivalencias: elemento de la tarjeta HA → función local → estado/API/tabla SQLite que lo alimentará. Mantener la misma organización funcional en pantallas, trasladando solo lo que pertenece al producto. Dejar fuera avisos de Telegram y sensores/entidades propios de Home Assistant; sustituir el estado MQTT/Modbus combinado por el estado real del adaptador local CJD.

Las fuentes recuperadas tienen etiquetas históricas: el archivo de Curvas se guardó con nombre V7.6.1, aunque su cabecera indica V7.6.0; Control indica V7.5.9.2 y Cocciones V0.6.7. Son referencias, no versiones del software nuevo. No copiar ninguna etiqueta como versión de la app nueva.
