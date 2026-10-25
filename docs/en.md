# WeatherFlow Tempest

This integration brings your **WeatherFlow Tempest** weather station into Gladys:
temperature, humidity, pressure, wind, light, UV, rain and lightning, updated
every minute, plus scene triggers (rain started, lightning, station
unreachable), scene actions (read the station, get the forecast) and a
dashboard widget.

It works **on your local network**, with no account and no Internet, and/or
**through the Tempest cloud** with a personal access token.

## Requirements

- Gladys **5.3.0 or later**.
- A Tempest station and its hub, set up in the Tempest app.
- For the local network: the hub and Gladys on the **same network** (same
  subnet, no VLAN or guest Wi-Fi between them). The hub broadcasts its data in
  UDP on port **50222**.
- For the cloud (optional): a personal access token.

## Configuration

1. Install the integration, then open its **Configuration** tab.
2. Optional — **cloud**: on [tempestwx.com](https://tempestwx.com/settings/tokens)
   (Settings → Data Authorizations → Create Token), create a personal access
   token and paste it in **Personal access token**. It brings the name of your
   stations, their altitude and time zone, the forecast, and takes over when the
   hub cannot be heard on the local network.
3. Choose the **temperature** and **wind** units. The lightning distance
   follows the wind unit (miles with mph, kilometres otherwise). Rain stays in
   millimetres and pressure in hectopascals: Gladys has no imperial unit for
   them.
4. Optional — **station altitude** (metres): needed for the sea-level pressure
   when you have no token. With a token, leave it empty: the altitude set in the
   Tempest app is used.
5. Optional — **time zone** (e.g. `Europe/Paris`): when the "rain today"
   counter goes back to zero. Empty: the station's time zone (token), else UTC.
6. Save, open the **Discovery** tab and add your station. A station heard on
   the local network shows up within a minute.

### Local network or cloud

Gladys shows a **Prefer the local connection** toggle:

- **On** (default): the integration listens to the hub on the local network.
  If nothing is heard for two minutes and a token is set, the cloud takes over,
  and the local network takes back as soon as the hub is heard again.
- **Off**: the cloud is used, the local network only when the cloud does not
  answer.
- Without a token, only the local network is used.

Each station shows a **badge** with the channel in use: local, cloud, or
unreachable. An orange dot means "it works, but not over the channel you
prefer"; its tooltip says why.

Each observation is processed once, whichever channel brings it first: nothing
is counted twice while both channels run.

## What you get

One Gladys device per Tempest, with these features:

| Feature                       | Unit             | Notes                                         |
| ----------------------------- | ---------------- | --------------------------------------------- |
| Temperature                   | °C or °F         |                                               |
| Humidity                      | %                |                                               |
| Station pressure              | hPa              | measured at the station                       |
| Sea-level pressure            | hPa              | needs the altitude (token or configuration)   |
| Wind speed, Wind gust         | km/h, m/s or mph | 1-minute average and gust                     |
| Wind direction                | °                |                                               |
| Illuminance                   | lux              |                                               |
| UV index                      | -                |                                               |
| Rain (last hour)              | mm/h             | rain of the last 60 minutes                   |
| Rain (today)                  | mm/day           | since midnight                                |
| Raining                       | yes/no           | ends after 10 dry minutes                     |
| Lightning strikes (last hour) | -                |                                               |
| Last lightning distance       | km or mi         |                                               |
| Battery                       | %                | estimated from the voltage (2.35 V to 2.80 V) |

Every value can be used in the standard Gladys scenes ("device state"
trigger, conditions) and charts.

## Actions

- **Test the connection** — listens to the local network for 15 seconds and
  queries the cloud with your token, then tells what it found under the button.

## Scenes

The integration adds its own cards to the scene editor, under the
**Integrations** category.

Triggers:

- **Rain started** — the first drops after at least ten dry minutes. Variable:
  `{{triggerEvent.data.rain_today}}` (mm).
- **Lightning detected** — a strike within 40 km, at most one event a minute
  per station (a storm sends dozens). Variables:
  `{{triggerEvent.data.distance}}` (km or miles),
  `{{triggerEvent.data.energy}}`, `{{triggerEvent.data.strikes_last_hour}}`.
- **Station unreachable** — nothing received from the station for ten
  minutes, on any channel.

For each trigger you can pick the station; left empty, any station matches.

Actions:

- **Read the station** — gives the current values to the following actions:
  temperature, feels like, dew point, humidity, pressure, wind speed, gust and
  direction (in degrees and as N, NE, E...), UV, illuminance, rain of the last
  hour and of the day, raining, lightning of the last hour, last lightning
  distance and the age of the observation in minutes. `available` is false
  when no observation has been received yet.
- **Get the forecast** — the Tempest forecast for today, tomorrow or the day
  after: conditions (English text from Tempest), icon code, the weather as a
  Gladys condition (`clear`, `partly-cloudy`, `cloud`, `fog`, `rain`, `sleet`,
  `snow`, `thunderstorm`, `wind` or `unknown`: easy to compare in a scene
  condition), highest and lowest
  temperature, chance and type of precipitation, sunrise and sunset. Needs
  the token.

Example: "Every morning at 7:00 → Get the forecast (today) → send me
`Today: {{conditions}}, {{temperature_low}} to {{temperature_high}}°`".

## Dashboard

Add the **Tempest station** widget to a dashboard. It shows live tiles
(temperature, humidity, wind, rain today, UV), the temperature of the last
24 hours, and a list with the feels-like temperature, dew point, pressure, wind
direction and gusts, last lightning, rain, battery, connection in use and age
of the last observation. With a token, a **Refresh** button fetches the latest
observation from the cloud.

If you have several stations, choose one in the widget settings.

## Troubleshooting

- **No station in Discovery, no token**: the hub and Gladys must share the
  network. Check that UDP port 50222 is not filtered, that the hub is not on a
  guest Wi-Fi or another VLAN, and that the Tempest app shows the station
  online. Use **Test the connection**.
- **"The Tempest cloud refuses the token"**: the token was revoked or mistyped;
  create a new one.
- **Sea-level pressure empty**: set the station altitude, or add a token.
- **"Rain today" resets at the wrong time**: set the time zone.
- **The badge shows the cloud with an orange dot**: the hub is not heard on the
  local network; data keeps coming from the cloud.

Check the integration logs from the Gladys interface for the details.

## Privacy

On the local network, no data leaves your home. The token is stored in Gladys
as a secret, sent only to the Tempest servers, and never written to the logs.
