# CJD Control Panel

Aplicación Python para gestionar curvas y supervisar cocciones del CJD-9000P mediante una interfaz web local táctil. Ofrece simulador aislado y conexión Modbus USB seleccionables con el desplegable **Conexión** de la cabecera. Una instalación nueva arranca en simulador; al elegir **USB · /dev/ttyUSB1** intenta conectar con `/dev/ttyUSB1`, sin enviar órdenes de cocción automáticamente.

El modo local no necesita Internet ni Home Assistant. MQTT es opcional y usa su [configuración privada](docs/MQTT.md). El adaptador USB incorpora dependencias opcionales y parámetros del comunicador recuperado: [configuración, pruebas y alcance físico](docs/MODBUS_USB.md). Las pruebas de desarrollo usan PTY del simulador, no el horno real.

## Instalador

En Fedora ejecuta `./instalar-fedora.sh`; en Debian/Ubuntu, `./instalar.sh`, como usuario normal. Consulta también [la guía Fedora](docs/FEDORA.md). Pregunta por MQTT, contraseña web, red, soporte USB y servicio; prepara dependencias aisladas, SQLite y servidor HTTP. Consulta [la instalación y actualización](INSTALLACION.md). No cambia la instalación actual hasta que ejecutes y confirmes el asistente.

## Arranque

Desde la carpeta del proyecto, con Python 3.11 o posterior en Linux:

```bash
python3 -m cjd_panel
```

Abre **http://127.0.0.1:8080** en el navegador del mismo equipo. Para terminar, pulsa `Ctrl+C` en el terminal. Los datos quedan en `data/cjd.sqlite3`; no se borran al cerrar. La migración al esquema SQLite 4 es automática y conserva una copia previa `cjd.sqlite3.pre-schema-4.bak` al actualizar una base de esquema anterior. Conserva la cola histórica MQTT y añade el origen simulado/físico de las sesiones sin eliminar curvas ni cocciones. Para ver la versión real: `python3 -m cjd_panel --version`.

Si ejecutas la aplicación en el LXC y el navegador está en otro equipo, `127.0.0.1` representa ese otro equipo. Usa un túnel SSH al LXC o habilita explícitamente el acceso LAN descrito más abajo.

## MQTT opcional con Home Assistant

En instalaciones asistidas, `.panel.json` determina si se activa MQTT; sin ese archivo se conserva el comportamiento anterior de activarlo si existe `.mqtt.json`. Publica las lecturas del simulador, el ciclo histórico de cada cocción y recibe Iniciar/Pausar/Reanudar/Parar por los mismos temas históricos `horno/cjd9000p/...`, tal como se ha solicitado. También permite seleccionar/cargar memorias con relectura. Home Assistant descubre un dispositivo **CJD local · simulador** con sensores y botones; el historial identifica las acciones recibidas como Home Assistant.

El uso local continúa si falla MQTT. `--no-mqtt` lo desactiva; `--mqtt-config RUTA` elige la configuración. Los datos de conexión (IP, puerto, usuario y contraseña) están en `.mqtt.json`, ignorado por Git y excluido del paquete. Se incluye `mqtt.example.json` como plantilla sin credenciales. La dependencia opcional instalada localmente tampoco se incluye en el paquete. Instalación, temas, formatos, pruebas y alcance en [docs/MQTT.md](docs/MQTT.md). La conexión física se activa exclusivamente al seleccionar USB; véase [Modbus USB](docs/MODBUS_USB.md).

## Primer recorrido

1. En **Curvas**, copia una de las cuatro memorias del simulador a la biblioteca, o crea una curva nueva. Los ejemplos del simulador son ficticios y no constituyen recetas de cocción.
2. Edita nombre, descripción, las duraciones y las temperaturas finales de los 19 recorridos entre 20 puntos. C01 se muestra como PV, sin un campo editable de temperatura fija. `Cᵢ` es la temperatura inicial y `tᵢ` los minutos de transición a `Cᵢ₊₁`; para una meseta, repite temperatura en el siguiente punto. `t20` es cero. Guarda la curva.
3. Puedes cargarla en una memoria 1–4 con el simulador parado. La aplicación verifica los 40 registros y adapta C01 a la PV actual. El perfil de biblioteca queda intacto.
4. En **Control del horno**, pulsa la tarjeta de una memoria ya cargada: queda seleccionada en verde. Inicia, pausa, reanuda o detén la cocción. Cada orden se confirma leyendo el estado del simulador. Las cuatro memorias se ocultan durante marcha o pausa. Puedes mostrar u ocultar la gráfica y la tabla del programa; el tiempo de tramo indica su duración programada.
5. En **Mis cocciones**, selecciona una sesión y pulsa **Ver gráfica**, o abre su detalle para editar nombre y observaciones. Consulta PV/SV, programa original y marcas opcionales de segmentos y eventos. Los números T1/T2… y su listado indican los tramos observados; temperatura y desviación comparten exactamente la escala temporal. La desviación se muestra por defecto; puedes ocultarla desmarcando **Desviación PV − SV**. Las franjas azules indican PAUSA registrada y los huecos de comunicación interrumpen las líneas. Selecciona entre dos y siete terminadas para comparar PV/SV, duración, máxima temperatura, desviación y continuidad desde su inicio. Busca por nombre/ID, filtra por estado y fechas o agrupa por curva. La comparación mantiene un color por cocción en gráfica, barras de resultados, tabla de tramos y observaciones; Δ compara con la primera seleccionada y la continuidad usa 0–100 %. El detalle de una sesión abierta actualiza lecturas/eventos hasta el cierre, conservando los borradores sin guardar. Puedes seleccionar pulsando la fila, guardar observaciones y eliminar sesiones terminadas desde el detalle o mediante **Eliminar seleccionadas**, siempre con confirmación. **Exportar CSV** conserva las lecturas y **Importar cocción** añade un CSV compatible al historial y abre su detalle. **Importar curva** incorpora perfiles a la biblioteca.
6. En **Herramientas del simulador**, prueba acciones externas, desconexión/reconexión o pérdida del próximo ACK. Los cambios externos se registran como observados, sin atribuirlos a un botón concreto.

Los tramos del simulador duran 10 segundos reales por defecto. Cambia esa duración con `--segment-seconds 30`. Los minutos mostrados por el programador son minutos **virtuales del tramo**, no la duración real de la sesión.

## Acceso opcional por red local

El servicio escucha solo en loopback por defecto. Para acceder desde otro PC sin contraseña, como se ha solicitado para este entorno de simulación:

```bash
python3 -m cjd_panel --host 0.0.0.0 --port 8080 --no-auth
```

Abre `http://IP_DEL_LXC:8080` desde el otro PC. No hace falta navegador ni monitor en el LXC. `--no-auth` desactiva también cualquier clave heredada mediante `CJD_ACCESS_TOKEN`.

Si quieres activar autenticación, omite `--no-auth` y configura `CJD_ACCESS_TOKEN` con al menos 20 caracteres. El panel solicitará esa clave. El servicio no modifica el firewall de Debian/Proxmox ni Tailscale.

## Datos, exportación y copias

- SQLite local con WAL, `synchronous=FULL`, claves foráneas e índices. Sin límite artificial de perfiles.
- Tiempos guardados en UTC y presentados en la zona horaria del navegador.
- Cada sesión conserva una copia de los 20 puntos realmente utilizados, independiente de ediciones posteriores.
- **Copia de seguridad** descarga una copia consistente de SQLite incluso con el servicio activo. La política inicial es copia manual antes de actualizar y después de procesos que quieras conservar; no se elimina historial automáticamente.
- Para restaurar: detén el servicio, conserva aparte el directorio `data` completo y coloca la copia descargada como `cjd.sqlite3` en un directorio de datos nuevo. Arranca con `--data-dir RUTA_NUEVA`. Evita mezclar una copia restaurada con archivos WAL de otra base.
- Al reiniciar se conservan perfiles e historial; las sesiones abiertas se marcan **interrumpidas**, porque el simulador nuevo no garantiza continuidad. No se envía RUN automáticamente.
- CSV de curvas: `name,notes,segment,temperature,minutes`, 20 filas ordenadas. CSV de cocciones: `timestamp,pv,sv,state,step,minutes,memory`, con fechas que incluyen zona horaria. El límite por importación es 32 MiB. El CSV de cocción no incluye snapshot ni eventos.
- Los CSV antiguos del registrador necesitan un adaptador específico: no se ha proporcionado una muestra y no se interpreta su formato por suposición.

## Verificación

```bash
python3 -m unittest discover -s tests -v
python3 fuentes_referencia/cjd9000p_simulador_modbus_demo_v7_5_1.py --self-test
python3 -m compileall -q cjd_panel
```

Las pruebas Python comprueban arranque con simulador ya funcionando/pausado, fallo inicial y recuperación, errores de E/S, datos antiguos, sincronización parcial, marcas de tramos antes de reducción, huecos, pausas y desviación firmada, además del ciclo completo, integridad de datos, relectura, ACK perdido, desconexión, exclusividad del worker, cambios externos, importación y control de acceso. Consulta [el contrato de comunicación](docs/CONTRATO_COMUNICACION.md) y [el inventario de fuentes](docs/INVENTARIO.md).

## Servicio y paquete

El instalador configura el servicio systemd del usuario actual con arranque automático al iniciar Debian, incluso sin iniciar sesión, conservando la carpeta `data` que ya utilizas:

```bash
python3 scripts/install_service.py --install
```

En este LXC el servicio está activo y habilitado, con `Linger=yes` confirmado para arrancar con Debian sin iniciar sesión. Comprueba su estado con `systemctl --user status cjd-panel.service` y consulta los mensajes con `journalctl --user -u cjd-panel.service`. El servicio usa la selección Simulador/USB guardada y no inicia una cocción automáticamente. [Instalación, arranque sin sesión y mantenimiento](docs/SERVICIO.md).


Genera un paquete de fuentes sin datos privados:

```bash
python3 packaging/build.py
```

El archivo aparece en `dist/`, con versión derivada de `cjd_panel.__version__`. Descomprímelo en el destino y ejecuta el mismo comando de arranque. El modo simulador local no requiere compilación ni paquetes externos; MQTT y Modbus USB usan sus dependencias opcionales fijadas. Debian 13 x86-64 es el entorno probado; Ubuntu, Fedora y ARM64 quedan pendientes de validación.

## Alcance pendiente

La integración física RS485 se realizará en una fase separada, cuando se confirme la versión exacta probada con el programador. Esta entrega no expone una opción para abrir `/dev/ttyUSB*`. Tampoco incorpora MQTT, selección de hardware ni migración del PostgreSQL existente. La revisión visual en navegador y la validación táctil en pantalla real siguen pendientes en este entorno.

## Repositorio público

Se publican la aplicación, las pruebas, el simulador y los manuales. El comunicador histórico original y el ZIP entregado se conservan solo en el entorno local porque contienen configuración de la instalación; están excluidos de Git y de los paquetes generados. Los hashes originales se mantienen como inventario de las fuentes recibidas, aunque alguna no se distribuya públicamente.

## Interfaz de referencia y actualización

La interfaz oscura de tarjetas y acentos verdes sigue el manual y las capturas aportados en `actualiza.zip`. **Mis curvas** separa biblioteca, edición y carga; **Control del horno** mantiene Iniciar, Pausar, Reanudar y Parar visibles, con datos reales confirmados, curva programada, avance visual y tabla de tramos; **Mis cocciones** incluye filtros, comparación, estadísticas y observaciones.

`docs/REVISION_UI.md` registra las diferencias, las equivalencias con las tarjetas históricas y los límites de verificación. Los JS de Home Assistant se distribuyen solo como referencias: no se cargan ni se ejecutan en la aplicación local.

Para usar el código actualizado, detén el proceso anterior con `Ctrl+C` y vuelve a arrancarlo con el mismo directorio de datos. Si usas LAN sin contraseña:

```bash
python3 -m cjd_panel --host 0.0.0.0 --port 8080 --no-auth
```

Después recarga la página del navegador. El nuevo backend debe reiniciarse para migrar la base y servir la API de observaciones; recargar solo la página no sustituye ese reinicio. El simulador vuelve a su estado inicial y las sesiones abiertas anteriores se marcan interrumpidas; la biblioteca y el historial se conservan.

## Comunicación y diagnóstico

El navegador diferencia servidor local sin respuesta de RTU simulado desconectado, conectando o con datos antiguos. El backend bloquea la disponibilidad si faltan lecturas recientes o el worker se detuvo. Un fallo al consultar la cronología no cambia el estado de comunicación RTU.

La primera sincronización es de lectura: si el simulador ya está funcionando o pausado, se abre una sesión observada sin enviar RUN. Su hora de inicio es la primera observación local; no permite recuperar una hora de inicio anterior desconocida. La reconexión no reenvía escrituras. Si hubo una parada y un reinicio no observados durante el corte, no se pueden reconstruir ni atribuir por suposición.

Consulta la [matriz de diagnóstico Modbus y USB](docs/DIAGNOSTICO_MODBUS.md), que diferencia lo probado con simulador de lo pendiente para el adaptador físico. No se habilitan puertos USB ni se cambia el maestro del bus.

`tests/ui_history.js` contiene la función `runHistoryUITests(codigoApp)`, ejecutada con V8 del entorno de desarrollo: comprueba escala compartida, etiquetas, cortes, leyendas, pausas, barras compatibles con CSP, diferencias, actualización y conservación de borradores usando un DOM simulado. No necesita instalar bibliotecas ni forma parte del código servido al usuario. La revisión visual/táctil sigue pendiente.

El historial HA utiliza los temas `coccion/event` y `coccion/state`, además del estado en vivo. Se publican INICIO, PAUSA, REANUDACION, FIN y muestras con un `run_id` estable y el snapshot del programa. Una cola SQLite entrega los mensajes en orden con QoS 1 y confirmación del broker; conserva los pendientes durante desconexiones. Esto no equivale a una confirmación de inserción en la base de HA. La API informa de `mqtt.history_pending`.

## Selector Simulador y estado de conexiones

En la cabecera aparecen **MQTT · Conectado**, **MODBUS · Conectado** y el desplegable **Conexión**, con el estilo de la tarjeta antigua. Los indicadores solo se ponen verdes cuando cada conexión está confirmada; Modbus no depende de que MQTT esté conectado.

Al elegir USB se cierra el PTY del simulador y se selecciona `/dev/ttyUSB1` (9600 8N2, esclavo 1). Si falta el USB o el CJD no responde, queda desconectado y reintenta lecturas; no crea datos ficticios ni inicia una cocción. El cambio no se admite mientras hay una cocción activa o pausada. La selección se guarda en `data/connection.json`; el puerto/parámetros pueden ajustarse mediante `.modbus.json`, usando `modbus.example.json` como plantilla. El modo físico requiere `requirements-modbus.txt`. Mantener un solo maestro en el bus RS485.

La aceptación física sigue pendiente: la entrega se deja en simulador y el adaptador serie se probó contra PTY propio, sin conectar el horno. El historial identifica el origen de cada sesión y MQTT publica el modo efectivo, conservando los temas existentes.
