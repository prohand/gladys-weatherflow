// -----------------------------------------------------------------------------
// The WeatherFlow Tempest message format, shared by both channels.
//
// The hub broadcasts JSON datagrams on the LAN (UDP 50222) and the cloud
// WebSocket relays the same messages: same `type`, same arrays, same order of
// the values. Only the identity differs: a datagram names the station by its
// `serial_number` (ST-00012345), the cloud by its numeric `device_id`.
//
// Reference: https://weatherflow.github.io/Tempest/api/udp/v171/ and
// https://weatherflow.github.io/Tempest/api/ws.html
//
// Every value is metric here (°C, m/s, hPa, mm, km, V): the units chosen by
// the user are applied when publishing (src/units.js).
// -----------------------------------------------------------------------------

/** Message types this integration reads. */
export const MESSAGE_TYPES = {
  OBSERVATION: 'obs_st',
  RAPID_WIND: 'rapid_wind',
  RAIN_START: 'evt_precip',
  LIGHTNING_STRIKE: 'evt_strike',
  DEVICE_STATUS: 'device_status',
  HUB_STATUS: 'hub_status',
};

// Position of each value in an `obs_st` row. The cloud appends four values
// the hub does not compute (local day rain accumulation...).
const OBS_ST = {
  EPOCH: 0,
  WIND_LULL: 1,
  WIND_AVG: 2,
  WIND_GUST: 3,
  WIND_DIRECTION: 4,
  PRESSURE: 6,
  TEMPERATURE: 7,
  HUMIDITY: 8,
  ILLUMINANCE: 9,
  UV: 10,
  SOLAR_RADIATION: 11,
  RAIN_MINUTE: 12,
  PRECIPITATION_TYPE: 13,
  STRIKE_DISTANCE: 14,
  STRIKE_COUNT: 15,
  BATTERY: 16,
  REPORT_INTERVAL: 17,
  RAIN_DAY: 18,
};

/** `precipitation_type` of an observation. */
export const PRECIPITATION_TYPES = { NONE: 0, RAIN: 1, HAIL: 2, RAIN_AND_HAIL: 3 };

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Decode one message (a datagram payload, a WebSocket frame or an already
 * parsed object). Anything that is not a JSON object with a `type` is `null`:
 * the LAN carries other broadcasts too.
 *
 * @param {string | Buffer | object} raw
 * @returns {object | null}
 */
export function decodeMessage(raw) {
  let message = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return null;
    }
  }
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  return typeof message.type === 'string' ? message : null;
}

/**
 * One `obs_st` row as named values (`null` when the station did not measure
 * it: a sensor failure sends `null` in the array).
 *
 * @param {Array<number|null>} row
 */
export function parseObservation(row) {
  const at = (index) => num(row?.[index]);
  return {
    epoch: at(OBS_ST.EPOCH),
    windLull: at(OBS_ST.WIND_LULL),
    windAvg: at(OBS_ST.WIND_AVG),
    windGust: at(OBS_ST.WIND_GUST),
    windDirection: at(OBS_ST.WIND_DIRECTION),
    pressure: at(OBS_ST.PRESSURE),
    temperature: at(OBS_ST.TEMPERATURE),
    humidity: at(OBS_ST.HUMIDITY),
    illuminance: at(OBS_ST.ILLUMINANCE),
    uv: at(OBS_ST.UV),
    solarRadiation: at(OBS_ST.SOLAR_RADIATION),
    rainMinute: at(OBS_ST.RAIN_MINUTE),
    precipitationType: at(OBS_ST.PRECIPITATION_TYPE),
    strikeDistance: at(OBS_ST.STRIKE_DISTANCE),
    strikeCount: at(OBS_ST.STRIKE_COUNT),
    battery: at(OBS_ST.BATTERY),
    reportInterval: at(OBS_ST.REPORT_INTERVAL),
    // Cloud only: the station's own count since its local midnight.
    rainDay: at(OBS_ST.RAIN_DAY),
  };
}

/** `evt_strike`: `[epoch, distance km, energy]`. */
export function parseStrike(evt) {
  return { epoch: num(evt?.[0]), distance: num(evt?.[1]), energy: num(evt?.[2]) };
}

/** `evt_precip`: `[epoch]`. */
export function parseRainStart(evt) {
  return { epoch: num(evt?.[0]) };
}

const round = (value, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Dew point in °C (Magnus formula, the one the Tempest app uses). */
export function dewPoint(temperature, humidity) {
  if (temperature === null || humidity === null || humidity <= 0) {
    return null;
  }
  const a = 17.625;
  const b = 243.04;
  const gamma = Math.log(humidity / 100) + (a * temperature) / (b + temperature);
  return round((b * gamma) / (a - gamma));
}

/**
 * Feels-like temperature in °C: wind chill when it is cold and windy, heat
 * index when it is hot and humid, the air temperature otherwise (the NWS
 * rules, the ones the Tempest app applies).
 */
export function feelsLike(temperature, humidity, windAvg) {
  if (temperature === null) {
    return null;
  }
  const windKmh = (windAvg ?? 0) * 3.6;
  if (temperature <= 10 && windKmh > 4.8) {
    const v = windKmh ** 0.16;
    return round(13.12 + 0.6215 * temperature - 11.37 * v + 0.3965 * temperature * v);
  }
  if (temperature >= 26.7 && humidity !== null && humidity >= 40) {
    const t = temperature * 1.8 + 32;
    const r = humidity;
    const heatIndex =
      -42.379 +
      2.04901523 * t +
      10.14333127 * r -
      0.22475541 * t * r -
      0.00683783 * t * t -
      0.05481717 * r * r +
      0.00122874 * t * t * r +
      0.00085282 * t * r * r -
      0.00000199 * t * t * r * r;
    return round((heatIndex - 32) / 1.8);
  }
  return round(temperature);
}

/**
 * Sea-level pressure in hPa from the station pressure and its altitude: the
 * formula WeatherFlow documents for its own "sea level pressure" field.
 */
export function seaLevelPressure(stationPressure, elevation) {
  if (stationPressure === null || stationPressure <= 0 || elevation === null) {
    return null;
  }
  const p0 = 1013.25;
  const rd = 287.05;
  const gammaS = 0.0065;
  const g = 9.80665;
  const t0 = 288.15;
  const exponent = (rd * gammaS) / g;
  const factor = 1 + ((p0 / stationPressure) ** exponent * gammaS * elevation) / t0;
  return round(stationPressure * factor ** (1 / exponent));
}

// The Tempest runs on a supercapacitor and a rechargeable battery charged by
// its solar panel: 2.80 V and above is full, under 2.355 V it drops to its
// lowest reporting mode. The percentage is an estimate between the two.
const BATTERY_EMPTY_VOLTS = 2.355;
const BATTERY_FULL_VOLTS = 2.8;

/** Estimated battery charge in %, from the voltage. */
export function batteryPercent(volts) {
  if (volts === null) {
    return null;
  }
  const ratio = (volts - BATTERY_EMPTY_VOLTS) / (BATTERY_FULL_VOLTS - BATTERY_EMPTY_VOLTS);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Compass point of a wind direction in degrees ('N', 'NE'...). */
export function cardinal(degrees) {
  if (degrees === null) {
    return null;
  }
  return CARDINALS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}
