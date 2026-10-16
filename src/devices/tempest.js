// -----------------------------------------------------------------------------
// Device type: TEMPEST WEATHER STATION
//
// One Gladys device per Tempest (serial ST-...), whatever channel its data
// comes from. Read-only sensors only: the station is never commanded.
//
// No polling: the hub pushes an observation every minute (LAN or cloud), and
// the engine (src/tempest/engine.js) publishes it as it arrives.
//
// Feature keys are part of the external ids: never rename one, Gladys keys the
// history, the scenes and the dashboards on them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import * as units from '../units.js';

export const DEVICE_TYPE = 'tempest';

// Scene trigger keys, as declared in the manifest `scene_triggers` field. Keys
// are forever: scenes store them.
export const SCENE_TRIGGERS = {
  RAIN_STARTED: 'rain_started',
  LIGHTNING_DETECTED: 'lightning_detected',
  STATION_UNREACHABLE: 'station_unreachable',
};

export const FEATURE = {
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  PRESSURE: 'pressure',
  SEA_LEVEL_PRESSURE: 'sea_level_pressure',
  WIND_SPEED: 'wind_speed',
  WIND_GUST: 'wind_gust',
  WIND_DIRECTION: 'wind_direction',
  ILLUMINANCE: 'illuminance',
  UV: 'uv',
  RAIN_LAST_HOUR: 'rain_last_hour',
  RAIN_TODAY: 'rain_today',
  RAINING: 'raining',
  LIGHTNING_STRIKES: 'lightning_strikes',
  LIGHTNING_DISTANCE: 'lightning_distance',
  BATTERY: 'battery',
};

const { SENSOR } = DEVICE_FEATURE_TYPES;
const C = DEVICE_FEATURE_CATEGORIES;
const U = DEVICE_FEATURE_UNITS;

const isFahrenheit = (config) => config.temperature_unit === U.FAHRENHEIT;

// The Tempest wind sensor reads up to 45 m/s (100 mph); a little headroom.
const MAX_WIND_MS = 60;
// Its lightning sensor sees strikes up to 40 km away.
const MAX_STRIKE_KM = 50;

/**
 * Every feature of the device: how Gladys sees it, and which value of the
 * engine snapshot (metric) it shows, converted to the configured units.
 * Every feature declares `min`/`max`: Gladys stores them NOT NULL.
 */
const FEATURES = [
  {
    key: FEATURE.TEMPERATURE,
    name: 'Temperature',
    category: C.TEMPERATURE_SENSOR,
    type: SENSOR.DECIMAL,
    unit: (config) => config.temperature_unit,
    min: (config) => (isFahrenheit(config) ? -58 : -50),
    max: (config) => (isFahrenheit(config) ? 158 : 70),
    value: (s, config) => units.temperature(s.temperature, config),
  },
  {
    key: FEATURE.HUMIDITY,
    name: 'Humidity',
    category: C.HUMIDITY_SENSOR,
    type: SENSOR.DECIMAL,
    unit: () => U.PERCENT,
    min: () => 0,
    max: () => 100,
    value: (s) => units.round(s.humidity),
  },
  {
    key: FEATURE.PRESSURE,
    name: 'Station pressure',
    category: C.PRESSURE_SENSOR,
    type: SENSOR.DECIMAL,
    unit: () => U.HECTO_PASCAL,
    min: () => 300,
    max: () => 1100,
    value: (s) => units.round(s.pressure),
  },
  {
    key: FEATURE.SEA_LEVEL_PRESSURE,
    name: 'Sea-level pressure',
    category: C.PRESSURE_SENSOR,
    type: SENSOR.DECIMAL,
    unit: () => U.HECTO_PASCAL,
    min: () => 850,
    max: () => 1100,
    value: (s) => units.round(s.seaLevelPressure),
  },
  {
    key: FEATURE.WIND_SPEED,
    name: 'Wind speed',
    category: C.SPEED_SENSOR,
    type: SENSOR.DECIMAL,
    unit: (config) => config.wind_unit,
    min: () => 0,
    max: (config) => Math.ceil(units.wind(MAX_WIND_MS, config)),
    value: (s, config) => units.wind(s.windAvg, config),
  },
  {
    key: FEATURE.WIND_GUST,
    name: 'Wind gust',
    category: C.SPEED_SENSOR,
    type: SENSOR.DECIMAL,
    unit: (config) => config.wind_unit,
    min: () => 0,
    max: (config) => Math.ceil(units.wind(MAX_WIND_MS, config)),
    value: (s, config) => units.wind(s.windGust, config),
  },
  {
    key: FEATURE.WIND_DIRECTION,
    name: 'Wind direction',
    category: C.ANGLE_SENSOR,
    type: SENSOR.INTEGER,
    unit: () => U.DEGREE,
    min: () => 0,
    max: () => 360,
    value: (s) => (s.windDirection === null ? null : Math.round(s.windDirection)),
  },
  {
    key: FEATURE.ILLUMINANCE,
    name: 'Illuminance',
    category: C.LIGHT_SENSOR,
    type: SENSOR.INTEGER,
    unit: () => U.LUX,
    min: () => 0,
    max: () => 200000,
    value: (s) => (s.illuminance === null ? null : Math.round(s.illuminance)),
  },
  {
    key: FEATURE.UV,
    name: 'UV index',
    category: C.UV_SENSOR,
    type: DEVICE_FEATURE_TYPES.UV_SENSOR.INTEGER,
    unit: () => U.UV_INDEX,
    min: () => 0,
    max: () => 20,
    value: (s) => (s.uv === null ? null : Math.round(s.uv)),
  },
  {
    // The rain of the last 60 minutes: an amount per hour, hence mm/h.
    key: FEATURE.RAIN_LAST_HOUR,
    name: 'Rain (last hour)',
    category: C.PRECIPITATION_SENSOR,
    type: DEVICE_FEATURE_TYPES.PRECIPITATION_SENSOR.DECIMAL,
    unit: () => U.MILLIMETER_PER_HOUR,
    min: () => 0,
    max: () => 500,
    value: (s) => units.round(s.rainLastHour, 2),
  },
  {
    key: FEATURE.RAIN_TODAY,
    name: 'Rain (today)',
    category: C.PRECIPITATION_SENSOR,
    type: DEVICE_FEATURE_TYPES.PRECIPITATION_SENSOR.DECIMAL,
    unit: () => U.MILLIMETER_PER_DAY,
    min: () => 0,
    max: () => 2000,
    value: (s) => units.round(s.rainToday, 2),
  },
  {
    key: FEATURE.RAINING,
    name: 'Raining',
    category: C.RAIN_SENSOR,
    type: SENSOR.BINARY,
    unit: () => undefined,
    min: () => 0,
    max: () => 1,
    value: (s) => (typeof s.raining === 'boolean' ? Number(s.raining) : null),
  },
  {
    key: FEATURE.LIGHTNING_STRIKES,
    name: 'Lightning strikes (last hour)',
    category: C.COUNTER_SENSOR,
    type: SENSOR.INTEGER,
    unit: () => undefined,
    min: () => 0,
    max: () => 100000,
    value: (s) => s.strikesLastHour,
  },
  {
    key: FEATURE.LIGHTNING_DISTANCE,
    name: 'Last lightning distance',
    category: C.DISTANCE_SENSOR,
    type: SENSOR.DECIMAL,
    unit: (config) => units.distanceUnit(config),
    min: () => 0,
    max: (config) => Math.ceil(units.distance(MAX_STRIKE_KM, config)),
    value: (s, config) => units.distance(s.lastStrike?.distance ?? null, config),
  },
  {
    key: FEATURE.BATTERY,
    name: 'Battery',
    category: C.BATTERY,
    type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    unit: () => U.PERCENT,
    min: () => 0,
    max: () => 100,
    value: (s) => s.batteryPercent,
  },
];

/** External ids of a station's device and features. */
export function stationIds(gladys, station) {
  return gladys.externalIds(DEVICE_TYPE, station.serial.toLowerCase());
}

/** Default name of a station in Gladys: the cloud name when known. */
export function stationName(station) {
  return station.name ? `Tempest ${station.name}` : `Tempest ${station.serial}`;
}

/**
 * The discovery payload of one station.
 * @param {object} station a record of the registry (src/tempest/stations.js)
 */
export function buildDevice(gladys, station, config) {
  const ids = stationIds(gladys, station);
  return {
    name: stationName(station),
    external_id: ids.device,
    features: FEATURES.map((feature) => {
      const payload = {
        name: feature.name,
        external_id: ids.feature(feature.key),
        category: feature.category,
        type: feature.type,
        min: feature.min(config),
        max: feature.max(config),
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
      const unit = feature.unit(config);
      if (unit) {
        payload.unit = unit;
      }
      return payload;
    }),
  };
}

/**
 * The states of one station, from an engine snapshot (metric values). A value
 * the station did not measure is left out, never published as 0.
 */
export function buildStates(gladys, station, snapshot, config) {
  const ids = stationIds(gladys, station);
  return FEATURES.map((feature) => ({
    device_feature_external_id: ids.feature(feature.key),
    state: feature.value(snapshot, config),
  })).filter(({ state }) => state !== null && state !== undefined && Number.isFinite(state));
}

/** The external id of one feature of a station. */
export function featureExternalId(gladys, station, key) {
  return stationIds(gladys, station).feature(key);
}

/**
 * The station behind a device external id (the value of a
 * `"source": "devices"` select), `null` when it is not one of ours.
 */
export function findStation(gladys, registry, deviceExternalId) {
  return (
    registry.list().find((station) => stationIds(gladys, station).device === deviceExternalId) ??
    null
  );
}
