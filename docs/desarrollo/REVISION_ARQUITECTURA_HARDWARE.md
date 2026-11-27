# Revisión de arquitectura y hardware — CJD Control Panel

Fecha: 15/11/2026. Actualizado con las decisiones confirmadas por el usuario.

## Acuerdos cerrados

- App Linux autónoma en red local; no necesita Home Assistant, Internet ni MQTT.
- Tendrá lectura y escritura. Copiará el comportamiento de comunicación de las últimas versiones que funcionaron correctamente con el CJD real.
- El simulador permite pruebas de software en entorno ficticio; no se usa para afirmar que la física térmica sea idéntica.
- La colección de curvas no tendrá límite artificial. El programador mantiene sus cuatro memorias físicas.
- SQLite local será la base recomendada para perfiles, cocciones, lecturas y eventos; CSV servirá para importar/exportar.
- La pantalla original del programador se mantiene junto con la nueva pantalla táctil. Se mantienen los botones originales. Las pruebas recientes confirman que las acciones desde los botones físicos y desde la pantalla táctil se reflejan en el panel existente; la app nueva debe conservar esa sincronización. Atribuir el origen de cada evento solo si el comunicador permite distinguirlo.
- Se fabricará una caja nueva adjunta a la principal, así que las dimensiones de la caja actual no limitan la pantalla.
- La alimentación prevista es la entrada 220–240 V AC del programador; la caja nueva necesita conversión AC/DC apropiada.
- La medición de temperatura/caja y medidas mecánicas se aplazan hasta diseñar el conjunto físico.

## Almacenamiento recomendado: SQLite + CSV

Recomiendo SQLite como fuente local principal. No requiere servidor, funciona en Linux y ofrece consultas/transacciones para enlazar cada lectura con una cocción, su curva y sus eventos. Las cocciones pueden exportarse a CSV para archivo o análisis externo y también se pueden importar historiales existentes tras definir un formato. PostgreSQL queda fuera de la operación normal y podrá usarse como fuente de importación si hace falta.

Guardar tiempos en UTC, mostrar hora local, indexar por cocción e instante y conservar una copia de la curva usada en cada sesión. Conocemos cocciones importadas de alrededor de 80.000 lecturas; SQLite puede manejar ese orden de magnitud sin necesidad de un servidor separado. Falta definir política de copias de seguridad y retención.

## Dispositivo: recomendación escalonada

### Prototipo

Raspberry Pi 5 + pantalla táctil de 5 o 7 pulgadas para probar la experiencia en banco; o desarrollar en el ASUS Fedora y conectar una pantalla de prueba. La pantalla Touch Display 2 ofrece 5, 7 y 10 pulgadas; los modelos de 5/7 tienen resolución 720 × 1280. Sus dimensiones exteriores son 91.5 × 143.5 mm y 120 × 189.5 mm, respectivamente. La caja nueva elimina la restricción de tamaño anterior, pero sigue siendo útil escoger pantalla por legibilidad y distancia.

### Integración compacta

Compute Module 5 + placa portadora propia + pantalla táctil DSI/HDMI. Partida preliminar: 4 GB RAM y 32 GB eMMC/SSD, no valores medidos. Requiere configurar DSI si se elige esa interfaz; no asumir que la placa de desarrollo CM5IO será la placa de producto.

### Opción lista para montar

Panel PC industrial Linux fanless con pantalla táctil integrada, almacenamiento sólido y RS485 aislado. Puede reducir diseño eléctrico/mecánico, con posible coste y volumen mayores. Comparar hojas de datos antes de compra.

## Requisitos provisionales de hardware

| Área | Propuesta de partida | Estado |
|---|---|---|
| CPU | ARM64 o x86-64 de 64 bits | Definir después de probar el stack; ARM64 si se elige CM5 |
| RAM | 4 GB | Recomendación provisional para interfaz táctil y servicio local |
| Almacenamiento | 32 GB eMMC o SSD | Recomendación provisional; definir respaldo y vida útil |
| Pantalla | LCD táctil; tamaño a escoger por legibilidad y diseño de caja | Usuario confirma táctil; pulgadas pendientes |
| Serial | RS485/Modbus RTU; un único maestro y worker | Copiar interfaz/parametrización del programa que funcionó con el CJD real |
| Entrada | 220–240 V AC desde cable común del programador | Diseñar fuente AC/DC para ordenador y pantalla, protecciones y conexión interna adecuadas |
| Inicio/recuperación | Arranque automático, watchdog y recuperación tras apagado | Definir al elegir SO/placa |
| Térmico | Operación separada del calor del horno y conforme a límites del equipo | Medir en el diseño de caja futura |

La electrónica del CJD debe seguir llevando la regulación de temperatura. El equipo nuevo aporta pantalla/interfaz y comunica con el programador; mantiene el panel original en paralelo.

## Incongruencias resueltas y pendientes documentales

1. **HA vs app local:** no es una incompatibilidad funcional sino dos proyectos. La app nueva no dependerá de HA; conservar los modelos/validaciones útiles.
2. **Lectura/escritura:** el manual V3.4.2 es solo lectura y Plan V4 refleja una etapa anterior. El usuario confirma que las últimas versiones sí escribieron y controlaron correctamente el CJD real. La fuente actual de implementación debe ser el comunicador exacto que pasó esas pruebas, no el manual antiguo por sí solo.
3. **Simulador:** su alcance es entorno ficticio. Puede validar intercambio de comandos y estados simulados; no reproduce necesariamente inercia u otros fenómenos térmicos.
4. **Versión V7.3/V7.2:** en el material recuperado, cabecera de archivo V7.3.0 y valor interno V7.2.0. Puede ser metadato viejo; identificar intención y corregirlo en futuros archivos. La regla ya se añade a `AGENTS.md`.
5. **Límite de perfiles:** la documentación histórica de HA contiene máximo 10 y una revisión que lo elimina. Para la app se confirma ahora que no habrá límite artificial.
6. **Almacenamiento:** resuelto como recomendación SQLite local + CSV de intercambio; PostgreSQL no será requisito.
7. **Plataformas:** primera familia Linux Debian/Ubuntu/Fedora. La CPU final (ARM64/x86-64) queda abierta; probar distribución y arquitectura elegidas.
8. **Caja:** se descarta adaptar la caja actual. Será una caja nueva adjunta y conservará la pantalla original junto con la nueva táctil.
9. **Cableado:** el nuevo dispositivo compartirá la entrada 220–240 V AC, pero necesitará su propia conversión AC/DC adecuada.

## Datos que todavía faltan

- Qué última versión exacta del comunicador se toma como base y dónde está el archivo/código fuente accesible en el LXC nuevo; confirmar su etiqueta y el metadato interno.
- Copia exacta y versión del simulador que se usará.
- Modelo/revisión y firmware de los programadores CJD que se comprarían para esa caja.
- Pantalla concreta: 5”, 7” u otra; orientación, brillo, interfaz DSI/HDMI y distancia de uso.
- Elegir ARM64 (CM5) o x86-64 (panel PC/mini PC) tras comparar disponibilidad, soporte y precio.
- Fuente AC/DC, potencia máxima, fusible/protecciones, puesta a tierra/aislamiento y distribución dentro de caja; diseñar con requisitos eléctricos aplicables.
- Política de copia de seguridad/retención del historial y proceso de importación de los CSV existentes.
- Protocolo de acceso por LAN: solo subred local o también acceso autenticado desde otros equipos.

Las dimensiones exactas y temperatura interna de la caja quedan para la fase de diseño físico, tal como indica el usuario.

## Estado posterior al inicio del desarrollo

La entrega actual ya implementa el panel Python con SQLite y el simulador aislado. El contrato e inventario constan en `docs/CONTRATO_COMUNICACION.md` y `docs/INVENTARIO.md`. Los pendientes software de este análisis inicial se sustituyen por el estado detallado de `PLAN.md`; las decisiones de hardware siguen aplazadas. La versión física exacta, las pruebas de red/visuales y las plataformas adicionales siguen pendientes.

## Próximos pasos históricos de este análisis (estado actualizado en PLAN.md)

1. Localizar e identificar versiones del comunicador probado y del simulador.
2. Congelar el contrato software de lectura/escritura copiando la secuencia validada, worker único, relectura/verificación, reintentos y confirmaciones.
3. Decidir backend/framework Linux y esquema SQLite; fijar formato CSV de importación/exportación.
4. Implementar panel táctil usando simulador; conservar entorno de pruebas aislado.
5. Probar arranque/paquete en Debian, Ubuntu y Fedora; medir compatibilidad de arquitectura objetivo.
6. Con la interfaz estable, elegir dispositivo y diseñar fuente, pantalla y caja adjunta.
