# Uso del panel Python

Abre la dirección que indique el instalador. En el equipo Linux suele ser `http://localhost:8080`. Desde otro dispositivo, usa la IP y el puerto del Linux y la contraseña que hayas configurado. La vista `/movil` mantiene las tres pestañas en la cabecera. Usa la dirección raíz para cambiar el origen de comunicación o actualizar el servidor.

## Primer recorrido

1. En la dirección raíz comprueba el selector **Conexión**. El simulador sirve para ensayar. Para el CJD‑9000P físico, selecciona el puerto del adaptador [RS485–USB](MODBUS_USB.md) y espera a que se confirme la comunicación.
2. En **Mis curvas**, crea o importa una curva y guárdala en la biblioteca. Para usarla, cárgala explícitamente en una de las cuatro memorias del programador. Cargar la memoria y arrancar la cocción son acciones separadas.
3. En **Control del horno**, selecciona la memoria, revisa el programa y elige el inicio inmediato o programado. Comprueba la temperatura real (PV), la consigna (SV), el tramo y los avisos de comunicación. El panel comprueba las órdenes por relectura del programador.
4. En **Mis cocciones**, consulta las gráficas, eventos y observaciones. Puedes comparar cocciones y exportar sus lecturas. Las ayudas de cada pantalla explican sus controles.

## Lecturas, tiempos y CSV

El programador conserva el control del horno. La tabla distingue los **minutos programados** del **tiempo real observado** en marcha. Los intervalos sin observación y las pausas no cuentan como tiempo confirmado. La hora de Actividad reciente se presenta en la zona horaria del dispositivo.

El servidor guarda perfiles, cocciones, lecturas y eventos en `data/cjd.sqlite3`. El CSV de una cocción contiene lecturas con marca de tiempo UTC y conserva el mismo instante al exportar e importar. El CSV de una curva contiene sus puntos y metadatos. **Actividad reciente** consulta la tabla de eventos en SQLite. La copia de la base desde el panel conserva también eventos y perfiles. Conserva una copia externa antes de actualizar. [Instalación y actualización](../INSTALLACION.md)

## Acceso desde fuera y MQTT

Si el móvil y el equipo Linux no están en la misma red, la dirección del panel tiene que ser accesible a través de una conexión privada o de un acceso protegido. El panel HTTP local no cifra el tráfico por sí mismo. Evita publicar directamente en Internet la interfaz que controla el horno.

MQTT es opcional. El servidor guarda en SQLite el historial local y publica mensajes al broker cuando está configurado. El registro de otro sistema, como Home Assistant, requiere su propio consumidor. [Configuración, entrega y diagnóstico de MQTT](MQTT.md)
