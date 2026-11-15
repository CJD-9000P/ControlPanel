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
- Implementar y probar el adaptador físico con la versión PyModbus y parámetros seriales confirmados. La conexión física es una fase separada acordada; no habilitarla en las pruebas del simulador.
- Validar instalación/arranque en Ubuntu y Fedora y, si se elige hardware ARM, en ARM64.
- Ajustar empaquetado de producto y recuperación/watchdog sobre el sistema destino. La plantilla systemd se incluye pero no se ha activado aquí.
- Recopilar CSV antiguos para su adaptador de importación. Política de copias inicial manual y sin borrado automático; automatizar cuando se concrete ubicación/retención.
- Evaluar LAN autenticada con TLS/proxy según el despliegue real; la entrega actual valida clave y origen, sin roles múltiples.
- MQTT opcional posterior, nunca dependencia del uso local.

## Hardware aplazado

No seleccionar ni comprar todavía. Candidatos históricos: Raspberry Pi, CM5 con portadora o panel PC industrial Linux. CPU ARM64/x86-64, pantalla y dimensiones pendientes; RAM/almacenamiento del diseño anterior son provisionales. La caja será nueva y adjunta a la principal. La entrada prevista 220–240 V AC requiere fuente AC/DC y diseño eléctrico apropiado. Medición térmica, caja y validación física corresponden a esa fase.

Las arquitecturas anteriores de HA, el manual histórico V3.4.2 y el Plan V4 son referencias históricas, no requisitos de esta aplicación. Las versiones de fuentes se documentan como históricas y no se usan para numerar el producto nuevo.

## Actualización de interfaz a partir de actualiza.zip

Se incorpora `ESPECIFICACION_UI_PARA_CODEX.md` y las referencias de `ui_reference/` y `fuentes_referencia/tarjetas_homeassistant/`. Su alcance visual/funcional complementa este plan; los documentos antiguos del ZIP no reemplazan las decisiones técnicas ya implementadas.

Completado: tarjetas oscuras con acentos verdes; navegación Mis curvas / Control del horno / Mis cocciones; fichas con gráficas y acciones; editor de 19 recorridos con C01/PV no editable; carga con memoria y resumen propios; inicio separado con elección explícita de memoria; programa y avance visual con tabla; búsqueda, filtros, agrupación por snapshot ignorando C01 y comparación de hasta siete sesiones terminadas; nombre, observaciones y borrado protegido; estadísticas sobre todas las lecturas. Migración aditiva SQLite con backup previo al cambiar desde esquema 1.

`docs/REVISION_UI.md` contiene la matriz tarjeta → función local → API/SQLite y los cambios motivados por uso táctil e independencia de HA. Pendiente: verificación visual de cada pantalla en navegador y pantalla táctil, imposible dentro del sandbox sin navegador ni sockets. No se presenta esa aceptación visual como superada.
