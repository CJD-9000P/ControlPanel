# Cambios del producto

## 0.2.0

- Interfaz oscura con acentos verdes basada en el manual y las tarjetas de referencia: Mis curvas, Control del horno y Mis cocciones.
- Biblioteca con fichas gráficas, acciones propias y memorias separadas; editor de 19 recorridos con C01/PV no editable; carga con selección y resumen independientes.
- Control con Iniciar, Pausar, Reanudar y Parar visibles; RUN requiere memoria explícita y no carga perfiles implícitamente; programa, avance y tabla de tramos.
- Historial con búsqueda, filtros, agrupación por programa y comparación de hasta siete sesiones terminadas; PV/SV, eventos, desviación y estadísticas sobre todas las lecturas.
- Nombre y observaciones por sesión, borrado confirmado de terminadas y migración aditiva al esquema SQLite 2 con copia previa del esquema inicial.
- Acceso LAN sin contraseña conservado mediante `--no-auth`. Sin paquetes externos nuevos. Pruebas y documentación actualizadas.
- Pendientes: aceptación visual en navegador/pantalla táctil, otras plataformas e integración física RS485. No se ha conectado con el horno real.

## 0.1.1 — referencia histórica, sustituida

Primera entrega pública con simulador, biblioteca, control e historial local; opción de acceso LAN sin contraseña. La versión vigente del producto se obtiene de `cjd_panel.__version__`.
