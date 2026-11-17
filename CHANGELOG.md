# Cambios del producto

## 0.7.3

- Seguimiento de la cocción más compacto, con barra de progreso del tramo y puntos de referencia en la gráfica.
- Las memorias en Mis curvas llevan al perfil coincidente o permiten crear uno a partir de su contenido.
- La selección de memoria en Control muestra los perfiles coincidentes y la interfaz distingue los avisos del simulador.

## 0.7.2 — referencia histórica, sustituida

- Lanzador descargable bin/instalar-cjd.sh: comprueba Linux, distribución, usuario normal, curl/tar/mktemp y Python >=3.11 con SQLite/SSL/venv; ofrece paquetes base y abre el asistente de la misma versión.
- Generación automática durante empaquetado solo cuando cambia la versión fuente; conserva contenido y fecha si no cambia. Descarga por HTTPS desde la rama de versión y comprueba la versión del archivo antes de iniciar el asistente.
- Modo --check sin descarga ni instalación y modo --version. El lanzador se incluye en paquete y copia instalada.

## 0.7.1 — referencia histórica, sustituida

- Lanzador específico Fedora y comprobación del entorno Python tras instalar paquetes DNF; rechazo explícito de instalación como root y Fedora Atomic no verificado.
- Preparación opcional de permisos dialout y puerto HTTP en una zona firewalld elegida, con reglas runtime/permanentes y sin recarga global. No conecta al horno ni cambia SELinux.
- Guía de instalación y comprobación de servicio tras reinicio en Fedora. Pruebas de integración del asistente en Debian y pasos Fedora simulados; aceptación nativa Fedora pendiente.

## 0.7.0 — referencia histórica, sustituida

- Asistente de instalación Linux: carpeta, MQTT opcional, credenciales, red/puerto, contraseña web opcional, soporte USB y servicio. Entorno virtual aislado, dependencias con hash, inicialización y backup SQLite.
- Configuración privada del despliegue y contraseña web PBKDF2 salada; API compatible con clave anterior y contraseña Unicode. Servicio respeta configuración y comprueba salud sin revelar datos.
- Validación en instalación temporal con HTTP real, simulador y todas las dependencias opcionales; sin conexión al horno. Las rutas apt/dnf de instalación de paquetes necesitan verificación en cada distribución.

## 0.6.1 — referencia histórica, sustituida

- Sustituido el checkbox por un desplegable Conexión: Simulador o USB · /dev/ttyUSB1. Conserva selección, bloqueo durante cocción y cambio por el único worker.
- Instalador de servicio systemd de usuario con linger para arrancar con Debian sin iniciar sesión; valida la unidad, guarda copia SQLite y conserva el directorio data y los archivos privados actuales.
- Plantilla de servicio corregida: no cambia la ubicación de los datos, no depende de default.target para iniciarse y conserva acceso LAN y credenciales por archivo. Reinicio ante fallo y registro en journald.
- Servicio instalado, activo y habilitado en el LXC; `Linger=yes` comprobado tras el paso de administrador para arrancar sin sesión. Sin dependencias nuevas del producto ni reinicio del sistema operativo.

## 0.6.0 — referencia histórica, sustituida

- Recuperados estilo y textos de los indicadores antiguos MQTT/Modbus; checkbox Simulador junto a ellos.
- Marcado usa el PTY simulado; desmarcado selecciona Modbus RTU en `/dev/ttyUSB1`, con 9600 8N2 y dirección 1 del comunicador recuperado. Se conserva la selección al reiniciar.
- Cambio gestionado por un solo worker: cierra el transporte anterior, limpia cachés y selección, bloquea cambios durante cocción y rechaza órdenes en cola destinadas al modo anterior. No envía órdenes de cocción al conectar/cambiar modo.
- Adaptador serie con PyModbus 3.11.4/pyserial 3.5 opcionales y hashes fijados; exclusión, reconexión, estabilización, respaldo de lectura dinámica y verificaciones del worker. Sin repetición automática de escrituras.
- Esquema SQLite 4 con backup previo: origen simulado/físico en sesiones y mensajes MQTT, preservando registros anteriores como simulados.
- Configuración opcional `.modbus.json` privada y plantilla pública; herramientas ficticias desactivadas en modo físico. Adaptador validado solo contra PTY propio; no se ha abierto el puerto del horno.

## 0.5.5 — referencia histórica, sustituida

- RTU y MQTT comparten estilo, altura y fondo verdoso cuando están conectados; conservan estados independientes.
- Configuración MQTT real mantenida en `.mqtt.json`, ignorada por Git y con permisos privados; nueva plantilla pública `mqtt.example.json` sin credenciales.
- Exclusión explícita del archivo privado también en el empaquetado, incluso si se encuentra dentro de un subdirectorio de fuentes. Se distribuye únicamente la plantilla.

## 0.5.4 — referencia histórica, sustituida

- Mis curvas, Control del horno y Mis cocciones ocupan el ancho disponible del navegador, conservando márgenes y adaptación móvil.
- Eliminada la insignia superior de estado duplicada; se conserva la tarjeta de seguimiento con PARADO rojo, FUNCIONANDO verde y PAUSADO azul claro.
- Botón MQTT junto al indicador RTU cuando la integración está habilitada: verde con conexión/suscripción confirmadas, rojo sin conexión y pendiente durante suscripción. Al pulsarlo muestra broker, temas y mensajes históricos pendientes, sin credenciales.
- Si falla el servidor local, MQTT se muestra sin confirmar para evitar un verde basado en datos antiguos. Sin cambios de transporte ni persistencia.

## 0.5.3 — referencia histórica, sustituida

- PAUSADO se muestra en azul claro en la tarjeta de estado y en la insignia superior, por indicación del usuario. PARADO rojo y FUNCIONANDO verde.

## 0.5.2 — referencia histórica, sustituida

- Corregido el indicador de Control que tenía fondo/texto verdes fijos: PARADO aparece en rojo, FUNCIONANDO en verde y PAUSADO en ámbar. Sin comunicación se muestra neutro.
- La tarjeta de seguimiento y la insignia superior usan el mismo estado confirmado. Sin cambios de comunicación, datos ni dependencias.

## 0.5.1 — referencia histórica, sustituida

- Corregida la omisión de los temas históricos `coccion/event` y `coccion/state`: se emiten INICIO, PAUSA, REANUDACION, FIN y lecturas correlacionados por `run_id`, con los nombres/campos del comunicador antiguo.
- Snapshot de 20 puntos y nombre en INICIO; cierre confirmado al observar PARADO, o no confirmado si el servicio interrumpe una sesión. No se inventa un archivo CSV ni se descartan ensayos cortos por temperatura.
- Cola de salida en la misma transacción SQLite que guarda la sesión/lectura/cierre. Entrega ordenada QoS 1, borrado solo tras PUBACK, recuperación tras desconexión/reinicio y `event_id` estable para reconocer retransmisiones.
- Esquema SQLite 3 con copia consistente del esquema anterior; ninguna modificación de PostgreSQL ni de archivos HA. El modo sin MQTT no acumula mensajes históricos.
- Se amplía el diagnóstico con el ciclo histórico y la opción de verificar el simulador activo sin crear un segundo puente. Prueba real superada con el mismo run_id y cola vacía; 63 pruebas Python superadas. Confirmar recepción del broker no equivale a comprobar inserción en el historial de HA.

## 0.5.0 — referencia histórica, sustituida

- MQTT bidireccional opcional con los temas históricos `horno/cjd9000p/...`: telemetría y memorias del simulador, eventos, RUN/PAUSE/RESUME/STOP, selección y carga verificada sin inicio implícito.
- Home Assistant discovery con sensores y controles, estado de disponibilidad por acción y republicación tras reconexión/nacimiento de HA.
- Mismo worker para órdenes web y MQTT; origen Home Assistant en el historial, plazos y validación antes de escribir, rechazo de retenidos y deduplicación persistente sin reenvío de órdenes.
- Configuración privada extraída como datos del original, sin ejecutarlo ni distribuir credenciales. paho-mqtt 2.1.0 fijado con hash como dependencia opcional; no se necesita en modo local.
- Indicador MQTT separado de RTU y API sin credenciales. El horno físico y su puerto siguen sin habilitarse.
- Prueba real contra el broker del usuario y simulador temporal: autenticación, lecturas, ciclo de control, duplicados y cambios locales publicados. Detalles y límites en `docs/MQTT.md`.

## 0.4.1 — referencia histórica, sustituida

- La gráfica de desviación PV − SV se muestra por defecto al abrir el detalle o la comparación de cocciones. Se conserva su casilla para ocultarla voluntariamente.
- Corregida la omisión de `checked` en el HTML: la lógica y las pruebas con DOM simulado asumían la opción activa, pero el documento real la iniciaba desmarcada.
- Sin cambios de datos ni dependencias. La aceptación visual/táctil continúa pendiente.

## 0.4.0 — referencia histórica, sustituida

- Historial con etiquetas visibles T1/T2…, incluido primer tramo; marcas calculadas antes del muestreo y listado accesible de sus tiempos.
- Temperatura y desviación comparten escala temporal, incluso al mostrar/ocultar programa; título y leyenda de desviación, escala simétrica y línea de cero.
- Cortes de trazado en huecos de comunicación, conservando extremos tras reducción; franjas de pausa basadas en estado PAUSA registrado, nunca en SV estable.
- Comparación con diferencias Δ y continuidad en escala fija 0–100; análisis por tramo con desviación media firmada.
- Detalle de sesiones abiertas actualizado hasta el cierre sin sobrescribir borradores de nombre/observaciones ni desplazar la pantalla.
- Colores y barras compatibles con la política CSP existente, sin estilos en línea bloqueados.
- Estado de comunicación con arranque/fallo/datos antiguos, antigüedad monotónica y detección de worker detenido; error de eventos separado del enlace RTU. Solicitudes del navegador con timeout, sin reenvío automático de órdenes.
- Relectura dinámica al terminar de sincronizar memorias y rechazo de cambios de memoria/escala durante el sondeo. Error inicial registrado una vez; errores de E/S tratados como comunicación fallida.
- 34 pruebas Python y regresiones de interfaz con V8/DOM simulado. Sin dependencias ni migraciones nuevas; aceptación visual/táctil pendiente.
- El USB físico sigue sin habilitarse: esta versión solo abre el PTY del simulador. Diagnóstico y matriz de casos físicos pendientes en `docs/DIAGNOSTICO_MODBUS.md`.

## 0.3.0 — referencia histórica, sustituida

- Importar curva e Importar cocción con formato admitido explicado; la cocción importada se abre tras añadirla a SQLite.
- Selección de una sesión para Ver gráfica o de dos a siete terminadas para Comparar gráficas; selección pulsando la fila e indicador de observaciones.
- Observaciones individuales junto a la gráfica y por cocción en la comparación; borrado de seleccionadas con confirmación y protección de sesiones abiertas.
- Paleta original, barras de resultados y tabla con número de tramo a la izquierda y una columna por cocción. Detalle individual que reúne programa y datos observados.
- Opciones Programa original, Marcar segmentos y Marcar eventos; se conservan PV/SV, desviación, exportación CSV y cronología.
- Memorias como botones completos, selección verde independiente de SPC y ocultación durante marcha/pausa. Sin desplegable duplicado.
- Mostrar/Ocultar gráfica y tabla en Control; tiempo programado del tramo junto al tiempo observado virtual.
- Sin cambios de esquema SQLite ni dependencias nuevas. Revisión visual/táctil en navegador pendiente; no se ha conectado con el horno físico.

## 0.2.0 — referencia histórica, sustituida

- Interfaz oscura con acentos verdes basada en el manual y las tarjetas de referencia: Mis curvas, Control del horno y Mis cocciones.
- Biblioteca con fichas gráficas, acciones propias y memorias separadas; editor de 19 recorridos con C01/PV no editable; carga con selección y resumen independientes.
- Control con Iniciar, Pausar, Reanudar y Parar visibles; RUN requiere memoria explícita y no carga perfiles implícitamente; programa, avance y tabla de tramos.
- Historial con búsqueda, filtros, agrupación por programa y comparación de hasta siete sesiones terminadas; PV/SV, eventos, desviación y estadísticas sobre todas las lecturas.
- Nombre y observaciones por sesión, borrado confirmado de terminadas y migración aditiva al esquema SQLite 2 con copia previa del esquema inicial.
- Acceso LAN sin contraseña conservado mediante `--no-auth`. Sin paquetes externos nuevos. Pruebas y documentación actualizadas.
- Pendientes: aceptación visual en navegador/pantalla táctil, otras plataformas e integración física RS485. No se ha conectado con el horno real.

## 0.1.1 — referencia histórica, sustituida

Primera entrega pública con simulador, biblioteca, control e historial local; opción de acceso LAN sin contraseña. La versión vigente del producto se obtiene de `cjd_panel.__version__`.
