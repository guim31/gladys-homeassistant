# Puente Home Assistant

Esta integración conecta Gladys con **su Home Assistant** y ofrece sus
dispositivos en la pestaña **Descubrir** de Gladys: luces, interruptores y
enchufes, persianas, termostatos, sensores, detectores, reproductores
multimedia, ventiladores y cerraduras. Una vez añadido un dispositivo, sus
estados siguen a Home Assistant **en directo**, y Gladys lo controla **a través
de Home Assistant**, que conserva sus integraciones Zigbee, Z-Wave, Matter,
Wi-Fi y en la nube. Pase a Gladys a su ritmo, habitación por habitación, o use
ambos en paralelo. Todo permanece en su red local. No oficial, sin relación con
el proyecto Home Assistant ni con Nabu Casa.

> Probada con Home Assistant 2026.10 (sus entidades de demostración), todavía no
> en muchas instalaciones reales: sus comentarios son bienvenidos en el
> repositorio de GitHub.

## Requisitos

- Un Home Assistant reciente (probado con 2026.10), accesible desde la máquina
  de Gladys (misma red, o una VPN).
- Un **token de acceso de larga duración**, preferiblemente de una cuenta de
  **administrador**: solo un administrador puede leer los dispositivos y las
  áreas de Home Assistant. Sin ella, cada entidad se convierte en un
  dispositivo aparte y el filtro por área no hace nada.

## Configuración

### Dirección y token

1. En Home Assistant, abra su perfil (abajo a la izquierda), pestaña
   **Seguridad**, y luego **Tokens de acceso de larga duración → Crear token**.
   Llámelo «Gladys» y copie el token: Home Assistant solo lo muestra una vez.
2. En Gladys, abra la integración, **Configuración**:
   - **Dirección de Home Assistant**: como `http://192.168.1.20:8123`, o
     `https://ha.example.org` detrás de un proxy inverso. Sin nombre `.local`,
     sin `localhost`: la integración se ejecuta en su propio contenedor.
   - **Token de acceso de larga duración**: péguelo.
3. Pulse **Probar la conexión**: se muestran la versión de Home Assistant, el
   número de dispositivos ofrecidos y los tipos de entidades no importadas.
4. Abra la pestaña **Descubrir** y añada los dispositivos que quiera. Sus
   valores se envían en cuanto se añaden.

### Elegir qué se importa

Una instalación de Home Assistant suele tener cientos de entidades. Gladys
solo ofrece:

- los **tipos de entidades** marcados (luces, interruptores, persianas,
  termostatos, sensores, detectores, reproductores multimedia, ventiladores,
  cerraduras, ayudantes de interruptor);
- en las **áreas** indicadas, si las hay (nombres separados por comas, como
  `Salón, Cocina`);
- nunca las entidades indicadas en **Entidades a excluir**
  (`sensor.*_signal_strength`, `*` sustituye cualquier texto);
- más las **entidades a importar de todos modos**, sean cuales sean los tipos y
  las áreas.

Las entidades desactivadas y ocultas, y las entidades de configuración y de
diagnóstico (brillo de un LED, intensidad de señal) se excluyen, salvo los
niveles de batería. Solo los dispositivos añadidos en Gladys reciben estados:
los demás no cuestan nada.

### Cerraduras, puertas de garaje y portones

Por defecto, las **cerraduras** y las persianas que Home Assistant clasifica
como **puerta de garaje, portón o puerta** son de **solo lectura** en Gladys:
usted ve si están bloqueadas, abiertas o cerradas, pero ni un dispositivo, ni
una escena, ni un asistente de voz vinculado a Gladys puede abrirlas. Marque
**Permitir comandos de cerraduras, puertas de garaje y portones** para
controlarlas (y luego pulse «Actualizar» en estos dispositivos en la pestaña
Descubrir). Las alarmas nunca se importan; la acción de escena que llama a un
servicio de Home Assistant rechaza `lock.*` y `alarm_control_panel.*` mientras
esta casilla no esté marcada.

### Opciones

- **Intervalo mínimo entre dos valores de un sensor**: 10 segundos por
  defecto. Un enchufe que informa de su potencia cada segundo se envía a Gladys
  a este ritmo. Interruptores, luces, persianas y detectores nunca se
  retrasan.
- **Idioma de los nombres de funciones**: las palabras añadidas a los nombres
  de las funciones secundarias («Cocina – Brillo»). Francés por defecto.
- **Tipos de eventos a escuchar** y **Entidades no importadas a vigilar**: vea
  los disparadores de escena más abajo.

## Lo que obtiene

### Dispositivos

Un dispositivo de Gladys por **dispositivo de Home Assistant**, con las
funciones de sus entidades; una entidad sin dispositivo (un ayudante, una
plantilla) es un dispositivo aparte. El nombre es el de Home Assistant, con su
área («Techo (Salón)»).

| Home Assistant                                    | En Gladys                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `light`                                           | encendido/apagado, brillo, color, temperatura de color (si se admiten) |
| `switch`, `input_boolean`                         | un interruptor                                                         |
| `cover`                                           | una persiana (o cortina): abrir, cerrar, detener, posición             |
| `cover` puerta de garaje, portón, puerta          | abierta o cerrada (solo lectura salvo permiso)                         |
| `climate`                                         | consigna, modo (apagado, calor, frío, auto), temperatura ambiente      |
| `sensor` según su clase                           | temperatura, humedad, presión, iluminancia, CO2, PM2,5, PM10           |
|                                                   | potencia, energía (índice), tensión, corriente, batería, gas, agua     |
|                                                   | ruido, velocidad del viento, distancia, duración, lluvia, AQI          |
| `binary_sensor` puerta, ventana, garaje, apertura | un detector de apertura                                                |
| `binary_sensor` movimiento, ocupación, presencia  | un detector de movimiento o de presencia                               |
| `binary_sensor` humo, humedad, CO, sabotaje, etc. | detectores de humo, fuga, CO, sabotaje; una entrada genérica si no     |
| `media_player`                                    | encendido, reproducir, pausa, siguiente, anterior, volumen, estado     |
| `fan`                                             | encendido/apagado, velocidad en %                                      |
| `lock`                                            | bloqueada o no (solo lectura salvo permiso)                            |

La **consigna** de un termostato se mantiene dentro de los límites que Home
Assistant indica para él (`min_temp`, `max_temp`): un valor fuera de ellos se
rechaza, nunca se convierte en otro. Un termostato que solo acepta un rango
(heat_cool) muestra su modo y su temperatura, sin consigna. Una luz de color
muestra su color en modo color y su temperatura de color en modo blanco.

### Widget del panel

**Home Assistant**: los dispositivos ofrecidos, los dispositivos añadidos, las
entidades seguidas, la conexión y la versión de Home Assistant, y un botón
**Recargar** que vuelve a leer la lista de dispositivos.

### Disparadores de escena

- **Evento de Home Assistant**: ocurrió un evento de un tipo indicado en
  **Tipos de eventos a escuchar** (`zha_event` de un mando Zigbee,
  `tag_scanned` de una etiqueta NFC, sus propios eventos). Filtros: el tipo de
  evento, la entidad. La escena recibe el tipo, la entidad y los datos del
  evento (JSON).
- **Entidad de Home Assistant modificada**: una entidad indicada en
  **Entidades no importadas a vigilar** cambió de estado (alarma armada,
  aspiradora limpiando, persona en casa). Filtros: la entidad, el nuevo
  estado. La escena recibe la entidad, su nombre, el nuevo y el anterior
  estado.

Para las entidades importadas en Gladys, use el disparador habitual «Estado de
un dispositivo».

### Acciones de escena

- **Llamar a una acción de Home Assistant**: cualquier servicio, como
  `dominio.servicio` (`light.turn_on`, `notify.mobile_app_telefono`), con
  entidades y datos en JSON (`{"brightness_pct": 50}`).
- **Ejecutar un script de Home Assistant**: `script.good_night`, con variables
  opcionales en JSON.
- **Activar una escena de Home Assistant**: `scene.movie_time`.
- **Pulsar un botón de Home Assistant**: `button.restart_router`.

## Ejemplos de escenas

- **Mando Zigbee que se queda en Home Assistant**: disparador «Evento de Home
  Assistant», tipo `zha_event`; acción: iniciar una escena de Gladys del
  salón.
- **Alarma armada en Home Assistant**: vigile `alarm_control_panel.home`;
  disparador «Entidad de Home Assistant modificada», nuevo estado
  `armed_away`; acción: apagar las luces de Gladys y enviarle un mensaje.
- **Buenas noches**: a las 23 h, acción «Ejecutar un script de Home Assistant»
  `script.good_night`, y luego Gladys cierra sus propias persianas.

## Solución de problemas

| Mensaje de estado                              | Qué hacer                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Escriba la dirección y un token de acceso      | Rellene los dos campos de la configuración.                                                       |
| La dirección de Home Assistant no es válida    | Escriba `http://IP:8123` (o `https://…`), sin nombre de usuario ni contraseña.                    |
| Home Assistant rechaza el token de acceso      | Cree un token nuevo en su perfil, pestaña Seguridad, y péguelo.                                   |
| Home Assistant no está accesible               | Compruebe la dirección desde la máquina de Gladys (no `localhost`) y que Home Assistant funcione. |
| «no es administrador» en la prueba de conexión | Cree el token con una cuenta de administrador para obtener dispositivos y áreas.                  |
| Falta un dispositivo                           | Compruebe los tipos y áreas elegidos, o añada la entidad a «Entidades a importar de todos modos». |

Cuando Home Assistant se reinicia, sus dispositivos pasan a «no accesible» en
Gladys; la integración se vuelve a conectar en unos segundos o un minuto y
envía los valores que cambiaron mientras tanto. Un dispositivo cuyas entidades
no están disponibles en Home Assistant también se muestra no accesible. Los
registros de la integración (Gladys, página de la integración) dan los
detalles.

## Límites

- Home Assistant sigue a cargo de los dispositivos: manténgalo en marcha.
- No se importan: alarmas, aspiradoras, cámaras, válvulas, humidificadores,
  calentadores de agua, sirenas, números y listas, sensores de texto y
  enumerados, inclinación de persianas, preajustes de termostatos y modos de
  ventiladores. La prueba de conexión indica los tipos excluidos; vigílelos
  con el disparador «entidad modificada» y contrólelos con la acción de escena
  «Llamar a una acción de Home Assistant».
- Los nombres de las funciones se fijan al añadir el dispositivo en Gladys: un
  nombre cambiado después en Home Assistant aparece en el nombre ofrecido en
  Descubrir, no en el dispositivo ya añadido.
- Los eventos de escena están limitados a 120 por minuto: un tipo de evento muy
  frecuente se corta por encima, con una línea en los registros.

## Privacidad

Todo permanece en su red local: la integración solo habla con su Home
Assistant, mediante su API WebSocket. Gladys guarda el token como secreto y
nunca se escribe en los registros. Home Assistant es un proyecto de la Open
Home Foundation; esta integración no tiene relación con ella ni con Nabu Casa.
