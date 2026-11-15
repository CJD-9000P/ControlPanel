# CJD Control Panel

Aplicación Python para gestionar curvas y supervisar cocciones del CJD-9000P mediante una interfaz web local táctil. Esta entrega funciona **exclusivamente con el simulador incluido**, aislado del horno físico. No necesita Internet, MQTT, Home Assistant, pip ni paquetes externos.

## Arranque

Desde la carpeta del proyecto, con Python 3.11 o posterior en Linux:

```bash
python3 -m cjd_panel
```

Abre **http://127.0.0.1:8080** en el navegador del mismo equipo. Para terminar, pulsa `Ctrl+C` en el terminal. Los datos quedan en `data/cjd.sqlite3`; no se borran al cerrar. Para ver la versión real: `python3 -m cjd_panel --version`.

Si ejecutas la aplicación en el LXC y el navegador está en otro equipo, `127.0.0.1` representa ese otro equipo. Usa un túnel SSH al LXC o habilita explícitamente el acceso LAN descrito más abajo.

## Primer recorrido

1. En **Curvas**, copia una de las cuatro memorias del simulador a la biblioteca, o crea una curva nueva. Los ejemplos del simulador son ficticios y no constituyen recetas de cocción.
2. Edita nombre, notas y los 20 puntos. `Cᵢ` es la temperatura inicial y `tᵢ` los minutos de transición a `Cᵢ₊₁`; para una meseta, repite temperatura en el siguiente punto. `t20` es cero. Guarda la curva.
3. Puedes cargarla en una memoria 1–4 con el simulador parado. La aplicación verifica los 40 registros y adapta C01 a la PV actual. El perfil de biblioteca queda intacto.
4. En **Control**, selecciona memoria y, opcionalmente, un perfil guardado. Inicia, pausa, reanuda o detén la cocción. Cada orden se confirma leyendo el estado del simulador.
5. En **Cocciones**, consulta gráfica PV/SV, lecturas y eventos. Selecciona dos terminadas para comparar PV desde su inicio. Exporta CSV o importa un CSV compatible.
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

La batería comprueba el ciclo completo, integridad de datos, relectura, ACK perdido, desconexión, exclusividad del worker, cambios externos, importación y control de acceso. Consulta [el contrato de comunicación](docs/CONTRATO_COMUNICACION.md) y [el inventario de fuentes](docs/INVENTARIO.md).

## Servicio y paquete

`packaging/cjd-panel.service` es una plantilla de servicio systemd de usuario para un checkout en `~/cjd-control-panel`. Ajusta rutas si lo instalas en otro sitio. No se ha instalado ni activado automáticamente. En una sesión de usuario con systemd:

```bash
mkdir -p ~/.config/systemd/user
cp packaging/cjd-panel.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now cjd-panel
```

Genera un paquete de fuentes sin datos privados:

```bash
python3 packaging/build.py
```

El archivo aparece en `dist/`, con versión derivada de `cjd_panel.__version__`. Descomprímelo en el destino y ejecuta el mismo comando de arranque. No requiere compilación ni instalación de dependencias. Debian 13 x86-64 es el entorno probado; Ubuntu, Fedora y ARM64 quedan pendientes de validación.

## Alcance pendiente

La integración física RS485 se realizará en una fase separada, cuando se confirme la versión exacta probada con el programador. Esta entrega no expone una opción para abrir `/dev/ttyUSB*`. Tampoco incorpora MQTT, selección de hardware ni migración del PostgreSQL existente. La revisión visual en navegador y la validación táctil en pantalla real siguen pendientes en este entorno.

## Repositorio público

Se publican la aplicación, las pruebas, el simulador y los manuales. El comunicador histórico original y el ZIP entregado se conservan solo en el entorno local porque contienen configuración de la instalación; están excluidos de Git y de los paquetes generados. Los hashes originales se mantienen como inventario de las fuentes recibidas, aunque alguna no se distribuya públicamente.
