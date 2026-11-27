# Código Android de CJD Control Panel

Para compilar, abre esta carpeta en Android Studio con JDK 17 y la plataforma Android 35. El proyecto declara la versión del complemento de Gradle en `app/build.gradle`. El paquete admite Android 8.0 o posterior.

El script `build-apk.sh` es la alternativa sin Android Studio. Necesita `CJD_JDK`, `CJD_ANDROID_JAR`, `CJD_BUILD_TOOLS` y `CJD_TEST_KEYSTORE`. Pásale como argumento la ruta del APK resultante. La clave usada para firmar los APK publicados queda fuera del repositorio. Una compilación firmada con otra clave no puede actualizar un APK público instalado.

La app enlaza con el servidor Python del CJD‑9000P. Para probarla, configura una dirección desde la que pueda consultar el panel. Usa `/movil` para la cabecera compacta y el simulador para probar sin operar el horno. [Guía de instalación y uso](https://github.com/CJD-9000P/ControlPanel/blob/main/docs/ANDROID.md)
