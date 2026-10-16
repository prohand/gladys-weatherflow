# WeatherFlow Tempest

Esta integración lleva su estación meteorológica **WeatherFlow Tempest** a
Gladys: temperatura, humedad, presión, viento, luminosidad, UV, lluvia y rayos,
actualizados cada minuto, además de disparadores de escena (empieza a llover,
rayo, estación inaccesible), acciones de escena (leer la estación, obtener la
previsión) y un widget para el panel.

Funciona **en su red local**, sin cuenta ni Internet, y/o **a través de la
nube Tempest** con un token de acceso personal.

## Requisitos

- Gladys **5.1 o posterior**.
- Una estación Tempest y su hub, configurados con la app Tempest.
- Para la red local: el hub y Gladys en la **misma red** (misma subred, sin
  VLAN ni Wi-Fi de invitados entre ellos). El hub difunde sus datos por UDP en
  el puerto **50222**.
- Para la nube (opcional): un token de acceso personal.

## Configuración

1. Instale la integración y abra su pestaña **Configuración**.
2. Opcional — **nube**: en [tempestwx.com](https://tempestwx.com/settings/tokens)
   (Settings → Data Authorizations → Create Token), cree un token de acceso
   personal y péguelo en **Token de acceso personal**. Aporta el nombre de sus
   estaciones, su altitud y zona horaria, la previsión, y toma el relevo cuando
   el hub no se escucha en la red local.
3. Elija las unidades de **temperatura** y de **viento**. La distancia de los
   rayos sigue la unidad del viento (millas con mph, kilómetros si no). La
   lluvia se queda en milímetros y la presión en hectopascales: Gladys no
   tiene unidad imperial para ellas.
4. Opcional — **altitud de la estación** (metros): necesaria para la presión a
   nivel del mar cuando no tiene token. Con un token, déjela vacía: se usa la
   altitud configurada en la app Tempest.
5. Opcional — **zona horaria** (p. ej. `Europe/Madrid`): cuándo el contador
   «lluvia de hoy» vuelve a cero. Vacía: la zona de la estación (token), si no
   UTC.
6. Guarde, abra la pestaña **Descubrimiento** y añada su estación. Una
   estación escuchada en la red local aparece en menos de un minuto.

### Red local o nube

Gladys muestra un interruptor **Preferir la conexión local**:

- **Activado** (por defecto): la integración escucha el hub en la red local.
  Si no se recibe nada durante dos minutos y hay un token, la nube toma el
  relevo, y la red local lo retoma en cuanto el hub se vuelve a escuchar.
- **Desactivado**: se usa la nube, y la red local solo cuando la nube no
  responde.
- Sin token, solo se usa la red local.

Cada estación muestra una **insignia** con el canal en uso: local, nube o
inaccesible. Un punto naranja significa «funciona, pero no por el canal que
prefiere»; su descripción emergente explica por qué.

Cada medición se procesa una sola vez, sea cual sea el canal que la trae
primero: nada se cuenta dos veces mientras funcionan ambos canales.

## Lo que obtiene

Un dispositivo Gladys por Tempest, con estas funciones:

| Función                      | Unidad          | Notas                                         |
| ---------------------------- | --------------- | --------------------------------------------- |
| Temperatura                  | °C o °F         |                                               |
| Humedad                      | %               |                                               |
| Presión en la estación       | hPa             | medida en la estación                         |
| Presión a nivel del mar      | hPa             | requiere la altitud (token o configuración)   |
| Velocidad del viento, Ráfaga | km/h, m/s o mph | media de 1 minuto y ráfaga                    |
| Dirección del viento         | °               |                                               |
| Iluminancia                  | lux             |                                               |
| Índice UV                    | -               |                                               |
| Lluvia (última hora)         | mm/h            | lluvia de los últimos 60 minutos              |
| Lluvia (hoy)                 | mm/día          | desde medianoche                              |
| Está lloviendo               | sí/no           | termina tras 10 minutos sin lluvia            |
| Rayos (última hora)          | -               |                                               |
| Distancia del último rayo    | km o mi         |                                               |
| Batería                      | %               | estimada a partir del voltaje (2,35 a 2,80 V) |

Los nombres de las funciones están en inglés en Gladys; puede renombrarlos.
Cada valor sirve en las escenas habituales de Gladys (disparador «estado de un
dispositivo», condiciones) y en los gráficos.

## Acciones

- **Probar la conexión** — escucha la red local durante 15 segundos y consulta
  la nube con su token, y luego muestra lo que encontró debajo del botón.

## Escenas

La integración añade sus propias tarjetas al editor de escenas, en la
categoría **Integraciones**.

Disparadores:

- **Empieza a llover** — las primeras gotas tras al menos diez minutos sin
  lluvia. Variable: `{{triggerEvent.data.rain_today}}` (mm).
- **Rayo detectado** — un rayo a menos de 40 km, como mucho un evento por
  minuto y estación (una tormenta envía decenas). Variables:
  `{{triggerEvent.data.distance}}` (km o millas),
  `{{triggerEvent.data.energy}}`, `{{triggerEvent.data.strikes_last_hour}}`.
- **Estación inaccesible** — nada recibido de la estación desde hace diez
  minutos, por ningún canal.

En cada disparador puede elegir la estación; si lo deja vacío, vale cualquier
estación.

Acciones:

- **Leer la estación** — da los valores actuales a las acciones siguientes:
  temperatura, sensación térmica, punto de rocío, humedad, presión, velocidad,
  ráfaga y dirección del viento (en grados y como N, NE, E...), UV,
  iluminancia, lluvia de la última hora y del día, si llueve, rayos de la
  última hora, distancia del último rayo y antigüedad de la medición en
  minutos. `available` es falso mientras no se haya recibido ninguna medición.
- **Obtener la previsión** — la previsión Tempest para hoy, mañana o pasado
  mañana: condiciones (texto en inglés de Tempest), código de icono,
  temperaturas máxima y mínima, probabilidad y tipo de precipitación, amanecer
  y atardecer. Requiere el token.

Ejemplo: «Cada mañana a las 7:00 → Obtener la previsión (hoy) → enviarme
`Hoy: {{conditions}}, de {{temperature_low}} a {{temperature_high}}°`».

## Panel

Añada el widget **Estación Tempest** a un panel. Muestra mosaicos en directo
(temperatura, humedad, viento, lluvia de hoy, UV), la temperatura de las
últimas 24 horas y una lista con la sensación térmica, el punto de rocío, la
presión, la dirección del viento y las ráfagas, el último rayo, la lluvia, la
batería, la conexión en uso y la antigüedad de la última medición. Con un
token, un botón **Actualizar** obtiene la última medición de la nube.

Si tiene varias estaciones, elija una en los ajustes del widget.

## Solución de problemas

- **Ninguna estación en Descubrimiento, sin token**: el hub y Gladys deben
  compartir la red. Compruebe que el puerto UDP 50222 no está filtrado, que el
  hub no está en un Wi-Fi de invitados u otra VLAN, y que la app Tempest
  muestra la estación en línea. Use **Probar la conexión**.
- **«La nube Tempest rechaza el token»**: el token fue revocado o copiado mal;
  cree uno nuevo.
- **Presión a nivel del mar vacía**: indique la altitud de la estación o añada
  un token.
- **«Lluvia de hoy» se reinicia a la hora equivocada**: indique la zona
  horaria.
- **La insignia muestra la nube con un punto naranja**: el hub no se escucha en
  la red local; los datos siguen llegando por la nube.

Consulte los registros de la integración desde la interfaz de Gladys para los
detalles.

## Privacidad

En la red local, ningún dato sale de su casa. El token se guarda en Gladys como
secreto, se envía solo a los servidores de Tempest y nunca se escribe en los
registros.
