# Inventario de fuentes y verificación

## Material entregado

Se recibió `CJD_Control_Panel_documentacion_actualizada.zip` y un comunicador Python suelto. El ZIP se extrajo después de validar que sus rutas no eran absolutas ni escapaban al proyecto. Contiene los acuerdos de producto, plan, arquitectura, dependencias, revisión de hardware, un comunicador, un simulador y dos PDF.

- La copia raíz `CJD9000P_Fedora_CJD_V7_3.py` y la copia en `fuentes_referencia/` son idénticas. Se conservan ambas fuentes entregadas sin alteraciones.
- Comunicador: cabecera V7.3.0, etiquetas internas V7.2.0. Discrepancia histórica explícita; no se modifica la fuente para ocultarla. Su último entorno físico y la última versión probada con el horno siguen pendientes de comprobar.
- Simulador: DEMO V7.5.1. Algunos ejemplos y comentarios internos mencionan otras revisiones históricas; se conserva intacto como referencia.
- Los PDF `Manual comunicacion RS485 CJD_9000_P.pdf` y `RS485 communication protocol_completo.pdf` tienen exactamente el mismo contenido por SHA-256; no son dos ediciones independientes.
- Los hashes de los cuatro archivos de referencia constan en `FUENTES_SHA256.json` y se comprobaron contra el ZIP original después del desarrollo.
- No se incluyeron muestras CSV del registrador histórico ni una base PostgreSQL; no se han supuesto sus formatos.

## Resultado implementado

La versión del producto nuevo se define solo en `cjd_panel/__init__.py`; el arranque, la API y el nombre del paquete la derivan de ahí. La numeración de referencias y el número de esquema SQLite son componentes distintos, no versiones del panel.

El panel ejecuta el simulador incluido sobre PTY y solo ese transporte. No abre `/dev/ttyUSB0`, no inicia MQTT ni conecta a la instalación física. El comunicador original se ejecutó únicamente con `--self-test`, que usa un cliente falso; sus mensajes mencionan un puerto histórico, pero no se abrió ese puerto.

Las autopruebas originales de ambos archivos pasaron. La batería nueva usa SQLite temporal, PTY y aplicación WSGI directa, sin puertos del horno ni sockets de red.

## Límites pendientes

- El sandbox impide crear sockets IP: el intento de arrancar el servidor falló con `Operation not permitted`. No hay prueba de escucha HTTP, LAN, proxy ni túnel en este entorno.
- No hay navegador instalado; no se ha realizado revisión visual ni prueba táctil. Se comprobó sintaxis JavaScript con V8, no renderizado.
- Solo se ha ejecutado en Debian 13.7 x86-64 / Python 3.13.5 / SQLite 3.46.1. Ubuntu/Fedora, Python mínimo 3.11, ARM64 y plantilla systemd necesitan prueba en destino.
- No se ha modificado el ASUS Fedora, el LXC Ubuntu, el horno, Tailscale ni el firewall. El hardware y la fuente de alimentación continúan en la fase posterior.

## Distribución pública

El comunicador histórico original (tanto la copia raíz como la de `fuentes_referencia/`) y el ZIP original no se suben al repositorio ni se empaquetan: incluyen configuración de conexión de la instalación. Permanecen intactos en local. Los hashes de ese comunicador describen la fuente local recibida; no implican que se distribuya con el repositorio público. El simulador y los dos manuales sí se incluyen.

## Paquete de actualización de interfaz

`actualiza.zip` añade especificación visual, manual de usuario, siete capturas y tres tarjetas históricas. Se integran las instrucciones nuevas de AGENTS sin sobreescribir el estado técnico actual con versiones anteriores de PLAN/ARQUITECTURA/DEPENDENCIAS. La especificación se conserva en raíz. Referencias visuales y JS originales verificadas byte a byte contra el ZIP; hashes en `REFERENCIAS_UI_SHA256.json`.

Las capturas muestran la aplicación histórica, no son capturas del panel nuevo. Los originales del comunicador y ambos ZIP permanecen locales; la distribución del producto contiene solo las referencias sin configuración privada. Las comprobaciones de sintaxis/lógica JavaScript no sustituyen una prueba real de navegador.
