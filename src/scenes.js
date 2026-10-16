// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+).
//
// Each action declared in the manifest `scene_actions` field is handled here,
// keyed by that same `key`; index.js registers every entry with
// `gladys.onSceneAction(key, ...)`. The scene TRIGGERS go the other way: the
// engine fires them (src/tempest/engine.js).
//
// The rules that matter:
//   - `fields` arrive RESOLVED (scene variables substituted, defaults
//     applied); a `"source": "devices"` field is the chosen device external_id;
//   - resolve the declared `outputs` (scalars only), readable by the
//     following actions of the scene; a value the station has not measured is
//     left out (it reads as empty);
//   - a scene action is never a condition: "no data" is the `available`
//     output, not an error. Throwing fails this action only.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { cardinal } from './tempest/protocol.js';
import { fetchDailyForecast } from './tempest/cloud.js';
import { findStation } from './devices/tempest.js';
import * as units from './units.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTION_KEYS = {
  GET_WEATHER: 'get_weather',
  GET_FORECAST: 'get_forecast',
};

// The forecast days a scene can ask for, as the `day` field options.
export const FORECAST_DAYS = { today: 0, tomorrow: 1, day_after_tomorrow: 2 };

/** Drop the outputs that have no value: an absent output reads as empty. */
function defined(outputs) {
  return Object.fromEntries(
    Object.entries(outputs).filter(([, value]) => value !== null && value !== undefined),
  );
}

/** 'HH:MM' of an epoch, in a time zone ('' = the container's). */
function clock(epochSeconds, timeZone) {
  if (typeof epochSeconds !== 'number') {
    return null;
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || undefined,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochSeconds * 1000));
}

export const SCENE_ACTIONS = {
  /** The station's current values, in the units of the configuration. */
  async [SCENE_ACTION_KEYS.GET_WEATHER](gladys, { fields, config, engine, registry, now }) {
    logger.info(`Scene action get_weather <- ${fields.device}`);
    const station = findStation(gladys, registry, fields.device);
    const s = station ? engine.snapshot(station.serial) : null;
    if (!s || s.observedAt === null) {
      return { available: false };
    }
    return defined({
      available: true,
      temperature: units.temperature(s.temperature, config),
      feels_like: units.temperature(s.feelsLike, config),
      dew_point: units.temperature(s.dewPoint, config),
      humidity: units.round(s.humidity),
      pressure: units.round(s.seaLevelPressure ?? s.pressure),
      wind_speed: units.wind(s.windAvg, config),
      wind_gust: units.wind(s.windGust, config),
      wind_direction: s.windDirection,
      wind_cardinal: cardinal(s.windDirection),
      uv: units.round(s.uv),
      illuminance: s.illuminance,
      rain_last_hour: units.round(s.rainLastHour, 2),
      rain_today: units.round(s.rainToday, 2),
      raining: s.raining ?? false,
      lightning_last_hour: s.strikesLastHour,
      last_lightning_distance: units.distance(s.lastStrike?.distance ?? null, config),
      minutes_since_observation: Math.max(
        0,
        Math.round(((now?.() ?? Date.now()) - s.observedAt) / 60000),
      ),
    });
  },

  /** The Tempest forecast for one day (cloud: needs the token). */
  async [SCENE_ACTION_KEYS.GET_FORECAST](
    gladys,
    { fields, config, registry, fetchForecast = fetchDailyForecast },
  ) {
    logger.info(`Scene action get_forecast <- ${fields.device} (${fields.day})`);
    const station = findStation(gladys, registry, fields.device);
    if (!station) {
      throw new Error('Unknown station');
    }
    if (!config.token || station.stationId === undefined) {
      throw new Error(
        'The forecast comes from the Tempest cloud: set a token in the configuration',
      );
    }
    const daily = await fetchForecast(config.token, station.stationId);
    const day = daily[FORECAST_DAYS[fields.day] ?? 0];
    if (!day) {
      return { available: false };
    }
    const timezone = config.timezone || station.timezone || '';
    return defined({
      available: true,
      conditions: day.conditions,
      icon: day.icon,
      temperature_high: units.temperature(day.air_temp_high ?? null, config),
      temperature_low: units.temperature(day.air_temp_low ?? null, config),
      precipitation_probability: day.precip_probability,
      precipitation_type: day.precip_type,
      sunrise: clock(day.sunrise, timezone),
      sunset: clock(day.sunset, timezone),
    });
  },
};
