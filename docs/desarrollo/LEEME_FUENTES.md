# Fuentes de referencia para Codex — CJD Control Panel

El paquete original recibido contiene documentación de producto, un comunicador existente, un simulador y documentos de protocolo RS485/Modbus. La distribución pública excluye el comunicador y el ZIP originales, que permanecen en local por contener configuración de la instalación.

## Qué es cada archivo

- `CJD9000P_Fedora_CJD_V7_3.py`: último archivo de comunicador recuperable en la documentación disponible. Cabecera V7.3.0; fecha del archivo en Biblioteca: 27/10/2026. Es la referencia principal para estudiar el comportamiento Modbus ya desarrollado.
- `cjd9000p_simulador_modbus_demo_v7_5_1.py`: simulador DEMO por pseudo-terminal Linux; no abre puertos del horno físico y su modelo térmico es visual.
- `Manual comunicacion RS485 CJD_9000_P.pdf` y `RS485 communication protocol_completo.pdf`: referencias de protocolo que deben compararse con el código.
- Los cinco archivos Markdown en la raíz: acuerdos, plan, arquitectura, dependencias y análisis de hardware actuales.

## Precauciones de versión y uso

La copia del comunicador se titula V7.3.0, pero algunos metadatos internos y mensajes de inicio dicen V7.2.0. No cambiar el código fuente original a escondidas: identificar esta discrepancia en el inventario y corregirla cuando se adopte una fuente de versión única.

El usuario confirma que las últimas versiones ejecutadas escribieron correctamente en el programador físico. Sin embargo, el archivo más reciente que se ha podido recuperar aquí es V7.3.0 y no se ha confirmado que sea exactamente la versión física más reciente que él probó. Su autoprueba incluida declara explícitamente que solo prueba con simulación. Usar el código como referencia técnica; no afirmar que este archivo particular supera una prueba física que no está documentada en él.

No ejecutar el comunicador contra el horno real desde el entorno de desarrollo. Primero revisar dependencias, configuración por defecto y puertos. En la aplicación nueva, separar el adaptador Modbus de MQTT/Home Assistant y conservar las verificaciones de escritura, el worker único y la confirmación de estado.

El simulador V7.5.1 y el comunicador V7.3.0 son versiones diferentes. Confirmar compatibilidad por autopruebas y código antes de usar ambos como pareja. El simulador no representa la dinámica térmica real del horno.

## Implementación nueva

El código del panel está en `cjd_panel/`; el uso se describe en `README.md`. Las fuentes de referencia permanecen intactas y sus hashes están en `docs/FUENTES_SHA256.json`. `PLAN.md`, `ARQUITECTURA.md` y `DEPENDENCIAS.md` reflejan ahora la entrega con simulador; la revisión de hardware conserva el contexto histórico y enlaza ese estado.

## Nuevas referencias visuales

`actualiza.zip` aporta `ESPECIFICACION_UI_PARA_CODEX.md`, el manual y capturas en `ui_reference/` y las tres tarjetas JS en `fuentes_referencia/tarjetas_homeassistant/`. Se conservan byte a byte como referencias históricas; no se ejecutan como parte de la app local. El ZIP original sigue excluido de Git por incluir también configuración de la instalación. La comparación con el prototipo y la adaptación local constan en `docs/REVISION_UI.md`.
