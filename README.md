# CJD Control Panel

Gestiona curvas, controla y supervisa cocciones y consulta el historial del **programador CJD‑9000P** desde un navegador o la app Android. El software solo es compatible con ese modelo.

## Qué necesitas

- Un **CJD‑9000P** instalado en el horno y un **adaptador RS485–USB** para comunicar con él.
- Un **equipo Linux junto al programador**, conectado al adaptador. Ahí se ejecuta la aplicación Python y se guardan las curvas y cocciones en SQLite.
- Para entrar desde otro equipo, el navegador o el móvil tienen que poder acceder por red al equipo Linux. En casa puede bastar la misma red local. Desde fuera hace falta una conexión privada que permita llegar al panel, por ejemplo Tailscale.
- La app Android y MQTT son opcionales. Puedes usar el panel desde el navegador del propio equipo Linux.

## Instalar y empezar

1. [Instala el servidor Python en Linux](INSTALLACION.md). Activa **Modbus USB** si vas a usar el programador físico. Activa el acceso por red y configura una contraseña si vas a usar el móvil.
2. Abre el panel en un navegador. Una instalación nueva arranca en **Simulador** y permite practicar con curvas y cocciones sin conectar el horno. Para pasar al equipo real, consulta la [guía Modbus USB](docs/MODBUS_USB.md).
3. En el móvil puedes usar el navegador o [instalar el APK de Android](docs/ANDROID.md). En la app recomendamos la ruta **`/movil`**, por ejemplo `http://192.168.1.50:8080/movil`. La dirección y el puerto dependen de tu instalación.

[Guía de uso del panel Python](docs/USO_PYTHON.md) · [Android y notificaciones](docs/ANDROID.md) · [Integración MQTT opcional](docs/MQTT.md)

## Uso y limitaciones

La aplicación Android permite consultar remotamente el estado del horno. Las notificaciones pueden retrasarse o perderse. Comprueba siempre el estado del horno directamente en su programador.

La aplicación Android y el servidor Python se proporcionan tal cual y su instalación y uso son responsabilidad de quien los utilice. El autor no asume responsabilidad por daños derivados de su instalación o uso.

## Para desarrollo

- [Arquitectura y referencias técnicas](docs/desarrollo/ARQUITECTURA.md)
- [Contrato del programador](docs/CONTRATO_COMUNICACION.md)
- [Historial de cambios](CHANGELOG.md)
- [Código y compilación de Android](https://github.com/CJD-9000P/ControlPanel/tree/codex/android-updates/android/source)
