# PLAN.md — CJD Control Panel

## Objetivo y acuerdos vigentes

Aplicación Python Linux autónoma con interfaz táctil web local para **Curvas**, **Control** y **Cocciones**. Funciona sin Internet, Home Assistant, MQTT ni PostgreSQL. SQLite local es la fuente de verdad y CSV el formato de intercambio. No hay límite artificial de perfiles; el CJD mantiene cuatro memorias físicas y 20 puntos por curva.

El CJD conserva regulación térmica, pantalla y botones originales. La aplicación debe reflejar sus cambios sin atribuir un origen que el protocolo no permita identificar. El LXC de desarrollo se mantiene separado del ASUS Fedora, del horno y del LXC Ubuntu existente. No se ha accedido ni modificado ninguno de esos sistemas.

## Decisiones técnicas adoptadas

- Python >=3.11. Entorno efectivamente comprobado: Debian 13.7, x86-64, Python 3.13.5.
- Backend WSGI con biblioteca estándar, servidor local con hilos y API JSON. Sin framework externo ni instalación por pip.
- Interfaz HTML/CSS/JavaScript sin compilación, CDN ni bibliotecas remotas. Navegador moderno; revisión visual y táctil pendiente.
- Un worker serializa todas las transacciones RTU y órdenes. Servidor del simulador en un hilo separado, mediante PTY Linux.
- SQLite con WAL, sincronización FULL, snapshots de curva, índices, eventos UTC y copias consistentes mediante la API de SQLite.
- Empaquetado de fuentes `.tar.gz` con manifiesto SHA-256 y plantilla systemd de usuario. La versión se toma exclusivamente de `cjd_panel.__version__`.
- Acceso loopback por defecto; LAN opcional con clave por variable de entorno o sin contraseña mediante `--no-auth`, por petición del usuario. El transporte LAN básico es HTTP; para confidencialidad, túnel o proxy TLS.

## Implementado en la entrega con simulador

1. Extracción y lectura de la documentación entregada; inventario y hashes de fuentes originales. Comunicador raíz y copia del ZIP idénticos; dos PDF idénticos.
2. Autopruebas originales del comunicador y simulador superadas; contrato documentado en `docs/CONTRATO_COMUNICACION.md`.
3. Lectura del bloque C9H–CEH y configuración; sincronización de cuatro memorias; worker exclusivo.
4. Carga de curvas, selección de memoria y RUN/PAUSE/RESUME/STOP con relectura; adaptación de C01 a PV sin editar la biblioteca; no se repiten escrituras sin confirmar.
5. Biblioteca SQLite: crear, editar, duplicar, borrar, buscar, graficar, importar/exportar CSV y copiar memorias del simulador.
6. Control: PV, SV, estado, punto, tiempo virtual del tramo, memoria y gráfica en vivo; eventos externos observados y herramientas de ensayo de fallos.
7. Historial de cocciones y lecturas UTC; snapshots inmutables; detalle, gráfica, comparación de dos a siete terminadas y CSV. Importación del formato propio, sin inferir formatos antiguos.
8. Copia consistente descargable, restauración documentada y marcado de sesiones interrumpidas tras reinicio.
9. Pruebas automatizadas del contrato, persistencia y API WSGI; validación de sintaxis JavaScript con V8.
10. Comando de arranque local, plantilla systemd y generador de paquete sin datos privados.

## Limitaciones de verificación del entorno

El sandbox permite PTY, SQLite y llamadas directas a la aplicación WSGI, pero impide crear sockets IP (`Operation not permitted`). No se ha podido verificar el servidor escuchando ni navegar por el panel. Tampoco hay navegador instalado. Las pruebas de API son llamadas WSGI directas, no una prueba de red ni visual. No afirmar que se ha comprobado el acceso por LAN.

## Siguientes fases

- Comprobar `python3 -m cjd_panel` en el LXC con permisos de red normales, abrir el panel y revisar escritorio/táctil, tamaños y accesibilidad real.
- Confirmar el archivo exacto del comunicador más reciente probado con el equipo real. El recuperado V7.3.0 no está confirmado como esa última versión y conserva etiquetas internas históricas V7.2.0.
- Adaptador físico implementado con parámetros del comunicador recuperado y dependencias nuevas fijadas; pendiente validación con el equipo y confirmar la versión histórica de PyModbus. La conexión física es una fase separada acordada; no habilitarla en las pruebas del simulador.
- Validar instalación/arranque en Ubuntu y Fedora y, si se elige hardware ARM, en ARM64.
- Ajustar empaquetado de producto y recuperación/watchdog sobre el sistema destino. El instalador systemd de usuario y su verificación de arranque se documentan en `docs/SERVICIO.md`; la plantilla inicial ha sido sustituida.
- Recopilar CSV antiguos para su adaptador de importación. Política de copias inicial manual y sin borrado automático; automatizar cuando se concrete ubicación/retención.
- Evaluar LAN autenticada con TLS/proxy según el despliegue real; la entrega actual valida clave y origen, sin roles múltiples.
- MQTT opcional implementado para simulador con el contrato histórico de HA; nunca dependencia del uso local.

## Hardware aplazado

No seleccionar ni comprar todavía. Candidatos históricos: Raspberry Pi, CM5 con portadora o panel PC industrial Linux. CPU ARM64/x86-64, pantalla y dimensiones pendientes; RAM/almacenamiento del diseño anterior son provisionales. La caja será nueva y adjunta a la principal. La entrada prevista 220–240 V AC requiere fuente AC/DC y diseño eléctrico apropiado. Medición térmica, caja y validación física corresponden a esa fase.

Las arquitecturas anteriores de HA, el manual histórico V3.4.2 y el Plan V4 son referencias históricas, no requisitos de esta aplicación. Las versiones de fuentes se documentan como históricas y no se usan para numerar el producto nuevo.

## Actualización de interfaz a partir de actualiza.zip

Se incorpora `ESPECIFICACION_UI_PARA_CODEX.md` y las referencias de `ui_reference/` y `fuentes_referencia/tarjetas_homeassistant/`. Su alcance visual/funcional complementa este plan; los documentos antiguos del ZIP no reemplazan las decisiones técnicas ya implementadas.

Completado: tarjetas oscuras con acentos verdes; navegación Mis curvas / Control del horno / Mis cocciones; fichas con gráficas y acciones; editor de 19 recorridos con C01/PV no editable; carga con memoria y resumen propios; inicio separado con elección explícita de memoria; programa y avance visual con tabla; búsqueda, filtros, agrupación por snapshot ignorando C01 y comparación de hasta siete sesiones terminadas; nombre, observaciones y borrado protegido; estadísticas sobre todas las lecturas. Migración aditiva SQLite con backup previo al cambiar desde esquema 1.

`docs/REVISION_UI.md` contiene la matriz tarjeta → función local → API/SQLite y los cambios motivados por uso táctil e independencia de HA. Pendiente: verificación visual de cada pantalla en navegador y pantalla táctil, imposible dentro del sandbox sin navegador ni sockets. No se presenta esa aceptación visual como superada.

## Revisión acordada tras la entrega anterior

Se aplican los 15 puntos recuperados de la conversación: nombres de importación; vista de una cocción; observaciones visibles; tabla comparativa por tramo/cocción; colores y barras originales; borrado desde selección; importación con apertura del detalle; exportación y cronología conservadas; memorias ocultas en marcha/pausa; selección directa de tarjeta; resaltado verde de la elección; opciones de programa/segmentos/eventos; detalle conjunto de programa y observado; controles de visibilidad y duración de tramo; selección por fila e indicador de notas.

La versión sigue derivándose únicamente de `cjd_panel.__version__`. No hay migración de datos ni dependencias nuevas. Pruebas con SQLite temporal y simulador aislado; sin modificar la base de usuario. Aceptación visual/táctil en navegador pendiente. Los CSV históricos ajenos al panel siguen pendientes de comprobar.

## Revisión de históricos y comunicación

Completadas las nueve mejoras acordadas: tramos visibles y conservados antes de muestrear; título/leyenda/cero de desviación; escala temporal compartida; huecos sin líneas ficticias; pausas desde estado registrado; diferencias Δ y continuidad absoluta; detalle abierto autoactualizado conservando borradores; desviación media firmada por tramo. Colores/barras trasladados a clases CSS/SVG por compatibilidad con CSP.

Comunicación revisada exclusivamente con simulador: arranque ya funcionando/pausado sin escrituras, fallo inicial y recuperación, error de E/S, sincronización parcial, cambio de memoria/estado durante lectura y detección de lecturas antiguas/worker detenido. USB físico sigue no implementado y no se ha conectado el horno; matriz de requisitos y casos pendientes en `docs/DIAGNOSTICO_MODBUS.md`. No se ha modificado la base de datos de usuario. La versión se deriva de `cjd_panel.__version__`; sin migración ni dependencias nuevas.

## Integración MQTT opcional acordada

Se implementa publicación y recepción de control en los mismos temas históricos por petición expresa del usuario, que confirma el horno real desconectado. Broker configurado en archivo privado, credenciales recuperadas del original sin ejecutarlo. MQTT mantiene el adaptador simulado y el único worker; no abre puertos físicos. Discovery de HA añade sensores y botones con identificadores separados, conservando los temas pedidos.

Se añaden paho-mqtt 2.1.0 opcional con hash, configuración excluida, deduplicación SQLite separada, validaciones del contrato histórico y script de prueba bidireccional. Ensayo real del broker realizado fuera del sandbox con simulador/SQLite temporales; éxito de autenticación, telemetría, ciclo RUN/PAUSE/RESUME/STOP, duplicados y cambios locales publicados. La revisión de la interfaz HA sigue pendiente. El paso físico sigue siendo una fase separada; no se modifica PostgreSQL ni el comunicador antiguo.

## Corrección de registro de cocciones en HA

Se detectó que el puente inicial no emitía los temas `coccion/event` y `coccion/state` presentes en el comunicador histórico, aunque las lecturas generales funcionaban. Se añaden eventos de ciclo y muestras con `run_id` estable y programa guardado; cola transaccional SQLite, QoS 1 y confirmación antes de borrar. No se modifica el registrador PostgreSQL ni el HA remoto.

Esquema SQLite 3 con copia previa; la cola no se genera en modo únicamente local. Los ensayos breves se conservan y los reinicios cierran sesiones como interrumpidas, sin fingir un fin natural. Las pruebas cubren orden, pausa/reanudación, mensajes de ciclo corto, cola sin ACK, reinicio, atomicidad, migración y borrado local. La prueba de broker no demuestra inserción en la base de HA; esa aceptación se mantiene explícita.

## Selector de modo y adaptación USB solicitados

El usuario solicita explícitamente que desmarcar Simulador intente conectar con el puerto físico; este acuerdo amplía la fase anterior, que solo permitía PTY. Se implementa `/dev/ttyUSB1` como interpretación del nombre USB indicado, con 9600 8N2 y dirección 1 del comunicador recuperado. No se realiza prueba física durante el desarrollo; la instalación se deja seleccionada en simulador.

Se elige PyModbus 3.11.4 con pyserial 3.5 como dependencias opcionales reproducibles, sin afirmar que sean las versiones históricas probadas físicamente. Se reutilizan detección de argumento de dispositivo, FC03/FC16, signed16, lectura dinámica de respaldo, worker y relecturas/validaciones. Reintentos de escritura desactivados para conservar la política de no repetir órdenes inciertas. Pruebas en PTY propio y dobles, incluyendo exclusión y cambio de modo sin trasladar órdenes de la cola.

El selector se gestiona dentro del mismo worker, conserva preferencia en `data/connection.json`, bloquea cambios durante cocción y expone modo/puerto/generación a la UI. Se recupera el estilo de indicadores del JS de Control antiguo, con estado independiente de MQTT. La migración aditiva al esquema 4 registra origen de las sesiones; hay backup previo. Detalles y pendientes físicos en `docs/MODBUS_USB.md`.

## Desplegable y servicio de arranque solicitados

Se sustituye el checkbox por un desplegable Conexión con Simulador/USB, manteniendo las verificaciones y la selección persistente del worker. El usuario solicita además iniciar el programa al arrancar el sistema: se prepara un servicio systemd de cjddev en el Debian del LXC, con linger y sin depender de una sesión gráfica. La configuración de arranque del contenedor en Proxmox es independiente.

Se conservan exactamente el directorio data del proyecto, los archivos privados y el acceso LAN sin contraseña ya autorizado. El instalador valida antes de detener el proceso manual, crea copia SQLite, instala la unidad con rutas actuales y comprueba servicio/API/proceso único. No requiere ejecutar la aplicación como root; si logind exige administrador para linger, conserva el servicio activo cuando existe gestor de usuario y deja ese único paso pendiente. Detalles en `docs/SERVICIO.md`.

Resultado actual: servicio de cjddev instalado, activo y habilitado; API comprobada y datos conservados. El usuario ejecutó el paso de administrador y se verificó `Linger=yes`. Configurado el arranque con Debian sin sesión; no se ha reiniciado el SO como prueba.

## Instalación asistida actual

La versión del producto deriva exclusivamente de `cjd_panel/__init__.py`. `instalar.sh` y `scripts/install.py` preparan `.venv`, SQLite y HTTP WSGI estándar, configuración privada, contraseña PBKDF2-SHA256 y servicio opcional. Detalles en [INSTALLACION.md](INSTALLACION.md). No se añade un servidor de base de datos externo.

Verificación actual del instalador: se han probado sockets HTTP reales fuera del sandbox en una carpeta temporal, con simulador, autenticación y dependencias completas. Las limitaciones de sockets descritas para la entrega inicial son históricas. No hay prueba visual en navegador ni instalación de paquetes apt/dnf en otras distribuciones.

## Destino Fedora

Lanzador `instalar-fedora.sh` sobre el asistente común, DNF para paquetes base y preparación opcional del anfitrión mediante `scripts/fedora_setup.py`: grupo dialout y regla HTTP en zona firewalld elegida. Se conserva systemd de usuario con linger, SQLite y HTTP de Python. No se cambia SELinux ni se conecta el puerto serie durante la instalación. Fedora Atomic queda fuera de este procedimiento. Pruebas simuladas del anfitrión Fedora; instalación nativa y versión exacta del equipo final pendientes de comprobar. Véase [guía Fedora](docs/FEDORA.md).

## Lanzador generado por versión

`bin/instalar-cjd.sh` se deriva de la versión fuente del producto al empaquetar; no se reescribe mientras esa versión coincida. Requiere shell POSIX y herramientas del anfitrión curl, tar y mktemp para descarga/extracción; apt/DNF y sudo son opcionales para preparar requisitos faltantes. Versiones de esas herramientas en cada destino: pendiente de comprobar. No hay dependencias Python nuevas ni cambios de versiones bloqueadas. Se comprueba la versión descargada antes de ejecutar el asistente. Los datos, secretos y servicio actuales no se alteran al generar el lanzador o ejecutar --check.
