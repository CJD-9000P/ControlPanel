# Instalar y usar CJD Control Panel en Android

La app funciona con el **CJD‑9000P**, un adaptador **RS485–USB** y el [servidor Python](../INSTALLACION.md) en un **equipo Linux junto al programador**. Puedes practicar con el simulador antes de conectar el equipo físico. La app necesita llegar al servidor por red.

## Instalar y conectar

1. Instala el [APK firmado más reciente](https://raw.githubusercontent.com/CJD-9000P/ControlPanel/refs/heads/codex/android-updates/android/latest.apk). El APK admite Android 8.0 o superior. Si Android lo pide, autoriza la instalación desde la aplicación que abrió el archivo.
2. Lee el aviso de uso. En **⋮ → Ajustes de notificaciones**, introduce la dirección y la contraseña del panel. Usa la IP y el puerto anunciados por el servidor. Recomendamos la vista **`/movil`**, por ejemplo `http://192.168.1.50:8080/movil`.
3. Comprueba que cargan **Mis curvas**, **Control del horno** y **Mis cocciones**. Si el móvil está en otra red, conecta primero el acceso privado entre el móvil y el Linux. Puedes probar la misma URL desde el navegador del teléfono para comprobar la red.

## Avisos y archivos

Activa los avisos que quieras en **Ajustes de notificaciones** y permite las notificaciones en Android. La vigilancia consulta el panel en segundo plano. El recordatorio silencioso es el estado del servicio. Los avisos de cambios se limitan a una cocción activa. Si el último estado confirmado era en marcha y se pierde el acceso al panel, el aviso de corte tarda al menos dos minutos y se retira al reconectar. La confirmación de fin de cocción requiere el servidor Python **0.7.17 o posterior**.

El teléfono tiene que seguir teniendo acceso al panel para recibir sus cambios. Las notificaciones pueden retrasarse o perderse. Comprueba el estado del horno directamente en su programador. Los botones de importación y exportación de CSV abren el selector de archivos de Android.

## Ayuda y actualizaciones

**⋮ → Ayuda** resume los requisitos y la conexión. En **⋮ → Acerca de** puedes ver la versión y pulsar **Buscar actualización**. Si hay una nueva, la app descarga el APK de GitHub, verifica su integridad y firma y abre la confirmación de instalación de Android. Para autorizar la primera actualización desde la app puede ser necesario concederle permiso de instalación. La instalación sobre una versión firmada del mismo modo conserva la configuración.
