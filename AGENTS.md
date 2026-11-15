# AGENTS.md — CJD Control Panel

## Propósito y alcance

Desarrollar una aplicación Linux autónoma para el programador CJD-9000P, con interfaz táctil y acceso opcional desde otros equipos de la red local. Debe permitir gestionar un número ilimitado de curvas, controlar y supervisar cocciones y consultar su historial.

La aplicación funciona sin Home Assistant, sin Internet y sin MQTT. MQTT podrá añadirse como integración opcional, nunca como requisito para el uso básico. El entorno de pruebas no se conecta al horno real.

## Decisiones confirmadas

- El producto se ejecutará en Linux; las distribuciones iniciales a considerar son Debian, Ubuntu y Fedora.
- La interfaz principal será web local, optimizada para pantalla táctil. El propio dispositivo la mostrará en pantalla completa y podrá ofrecerla en la red local.
- Se mantienen la pantalla y los botones originales del CJD junto con la nueva pantalla táctil. La aplicación debe reflejar en su interfaz los cambios de estado y las acciones, tanto si se originan en sus controles táctiles como si se hacen con los botones físicos. Atribuir el origen solo cuando la comunicación permita identificarlo; si no, registrar el cambio como observado externamente.
- La electrónica CJD seguirá regulando el horno. El nuevo ordenador será la interfaz y comunicará con el programador; no sustituirá su control térmico.
- La aplicación tendrá lectura y escritura. Las últimas versiones del programa ya probaron escritura y control con el programador real y funcionaron correctamente. Reutilizar ese comportamiento conocido, identificando la versión y copiando sus verificaciones.
- El simulador sirve para probar software en un entorno ficticio y aislado; no representa toda la dinámica térmica de un horno real.
- No habrá límite artificial en el número de curvas guardadas por la aplicación. El programador físico conserva sus cuatro memorias.
- SQLite local será el almacén principal propuesto para perfiles e historial. CSV se conservará como formato de importación/exportación. No depender de PostgreSQL ni modificar la base existente.
- La alimentación disponible para la nueva caja será 220–240 V AC desde la entrada del programador. El diseño deberá incorporar una fuente AC/DC apropiada para el ordenador y la pantalla; nunca conectar la tensión de red directamente a la placa informática.
- El LXC Debian nuevo de Proxmox es el entorno dedicado de desarrollo. Mantener intacto el LXC Ubuntu existente. Registrar sistema y arquitectura reales del LXC.

## Entorno y límites de las pruebas

- Usar primero una copia del simulador CJD-9000P en el LXC de desarrollo.
- Mantener el entorno de pruebas aislado del ASUS Fedora y del horno físico mientras se desarrolla con el simulador.
- No conectar ni enviar órdenes al horno físico durante la fase de simulador. La conexión física será una fase separada, basada en el comportamiento de comunicación ya probado y acordada para ese paso.
- El puerto RS485 debe tener un solo maestro activo. Mantener un único worker de comunicación como en el programa existente; no permitir que el ASUS y el nuevo dispositivo sondeen el mismo bus simultáneamente.
- El simulador permite verificar el protocolo y los estados simulados, pero no demuestra la respuesta térmica real ni sustituye las pruebas ya realizadas con el CJD.

## Referencia visual y funcional de la interfaz

- Antes de implementar o rediseñar pantallas, leer `ESPECIFICACION_UI_PARA_CODEX.md`, revisar el manual PDF y las capturas renderizadas, y estudiar los tres archivos JS de tarjetas en `fuentes_referencia/tarjetas_homeassistant/`. El manual documenta la interfaz existente y sirve como referencia visual/funcional.
- Mantener la organización reconocible de las tarjetas, la navegación y los flujos del manual (Mis curvas, Editar curva, Cargar curva, Control del horno y Mis cocciones). No omitir controles de cocción: Iniciar, Pausar, Reanudar y Parar deben estar visibles y su estado debe depender del estado real observado del programador. C01/C1 es la temperatura inicial real tomada de PV; mostrar también PV viva como temperatura actual.
- La aplicación nueva es independiente de HA. Sustituir indicadores/avisos específicos de MQTT, Home Assistant y Telegram por estado de la conexión local con el CJD y funciones locales equivalentes. No convertirlos en requisitos.
- Si el usuario ya tiene una versión nueva de la aplicación, pedir su código/capturas para comparar antes de rediseñar; el manual refleja la interfaz de octubre de 2026, no necesariamente el prototipo actual.

## Arquitectura

Separar estas responsabilidades:

1. Interfaz web local táctil: **Curvas**, **Control** y **Cocciones**.
2. Lógica de aplicación: validación de perfiles, coordinación de comandos, estados, sesiones e historial.
3. Adaptador del programador: primero el simulador, después el CJD mediante Modbus RTU/RS485, siguiendo el comportamiento del comunicador que ya funcionó con el equipo real.
4. Persistencia local: SQLite como fuente principal; importación/exportación CSV.
5. Integración opcional: MQTT, sin dependencia de HA ni de un broker.

Mantener las capas independientes de la distribución Linux y preparar ejecución en Debian, Ubuntu y Fedora. Registrar decisiones de lenguaje, framework, servidor y empaquetado en `PLAN.md`, y dependencias en `DEPENDENCIAS.md`.

## Curvas, comunicación e historial

- Distinguir perfiles editables de las cuatro memorias físicas del CJD.
- Usar como modelo inicial las cuatro memorias y 20 segmentos por memoria, verificando campos y límites en la implementación de comunicación elegida.
- Mostrar PV, SV, estado, segmento, tiempo y curva/memoria de forma inequívoca.
- Mantener la interfaz e historial sincronizados con cambios realizados desde los botones físicos del CJD y desde la pantalla táctil; no asumir que todas las acciones se originan en la app.
- Copiar el comportamiento probado de lectura y escritura del comunicador existente, incluidos su worker único, validaciones, relectura/verificación y confirmación de estado. No rediseñar comandos basándose solo en un borrador antiguo.
- Guardar las lecturas de cocción y eventos localmente en SQLite con marcas de tiempo UTC; mostrar la hora local al usuario. Permitir exportación CSV y planificar copias de seguridad.
- No tratar MQTT retained, cachés ni la base PostgreSQL del registrador como fuente de verdad de la aplicación.

## Regla obligatoria de versiones y coherencia documental

Al crear o modificar cualquier archivo del proyecto:

1. Buscar todas las versiones mencionadas en el archivo y en los archivos relacionados: cabecera, nombre, telemetría, manifiestos, documentación y dependencias.
2. Compararlas con la versión fuente de verdad del componente. Si solo es una etiqueta de telemetría o una referencia histórica, indicarlo explícitamente.
3. Corregir toda versión antigua copiada por error. No dejar números desactualizados en ejemplos, comentarios, instrucciones, nombres de artefactos ni changelog.
4. Si hay una versión desconocida o no verificable, escribir `pendiente de comprobar` en vez de adivinar.
5. Revisar referencias cruzadas y marcar claramente documentación histórica/sustituida.
6. Antes de cerrar el cambio, hacer una pasada de búsqueda de patrones de versión en todos los archivos modificados y confirmar que coinciden.

En versiones nuevas del software, mantener una sola fuente de verdad de versión y derivar de ella metadatos, cabeceras, nombres y versión reportada por el programa. Incluir esta comprobación en el flujo normal de revisión y empaquetado.

## Dependencias reproducibles

- Registrar cada dependencia y herramienta nueva en `DEPENDENCIAS.md`, con versión, función, plataforma y si es ejecución, desarrollo o empaquetado.
- Mantener manifiestos y archivos de bloqueo cuando se elija el stack.
- Diferenciar Codex CLI, Tailscale y herramientas del LXC de las dependencias del producto.
- Preferir instrucciones de reemplazo completo de archivo cuando ayuden a evitar problemas de formato al usuario.
