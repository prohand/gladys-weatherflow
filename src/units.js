// -----------------------------------------------------------------------------
// Unit conversions, from the metric values of the station to the units the
// user chose in the configuration.
//
// Gladys has no inch-per-hour nor inch-of-mercury unit: precipitation stays in
// millimetres and pressure in hectopascals whatever the choice. The lightning
// distance follows the wind unit (miles with mph, kilometres otherwise).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';

const round = (value, decimals = 1) => {
  if (value === null || value === undefined) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** °C -> the configured temperature unit. */
export function temperature(celsius, config) {
  if (celsius === null || celsius === undefined) {
    return null;
  }
  return config.temperature_unit === DEVICE_FEATURE_UNITS.FAHRENHEIT
    ? round(celsius * 1.8 + 32)
    : round(celsius);
}

const WIND_FACTORS = {
  [DEVICE_FEATURE_UNITS.METER_PER_SECOND]: 1,
  [DEVICE_FEATURE_UNITS.KILOMETER_PER_HOUR]: 3.6,
  [DEVICE_FEATURE_UNITS.MILE_PER_HOUR]: 2.2369363,
};

/** m/s -> the configured wind unit. */
export function wind(metersPerSecond, config) {
  if (metersPerSecond === null || metersPerSecond === undefined) {
    return null;
  }
  return round(metersPerSecond * (WIND_FACTORS[config.wind_unit] ?? 1));
}

/** The distance unit that goes with the wind unit. */
export function distanceUnit(config) {
  return config.wind_unit === DEVICE_FEATURE_UNITS.MILE_PER_HOUR
    ? DEVICE_FEATURE_UNITS.MILE
    : DEVICE_FEATURE_UNITS.KM;
}

/** km -> the distance unit that goes with the wind unit. */
export function distance(kilometers, config) {
  if (kilometers === null || kilometers === undefined) {
    return null;
  }
  return distanceUnit(config) === DEVICE_FEATURE_UNITS.MILE
    ? round(kilometers * 0.6213712)
    : round(kilometers);
}

/** Short label of a unit, for the texts the integration formats itself. */
export const UNIT_SYMBOLS = {
  [DEVICE_FEATURE_UNITS.CELSIUS]: '°C',
  [DEVICE_FEATURE_UNITS.FAHRENHEIT]: '°F',
  [DEVICE_FEATURE_UNITS.KILOMETER_PER_HOUR]: 'km/h',
  [DEVICE_FEATURE_UNITS.METER_PER_SECOND]: 'm/s',
  [DEVICE_FEATURE_UNITS.MILE_PER_HOUR]: 'mph',
  [DEVICE_FEATURE_UNITS.KM]: 'km',
  [DEVICE_FEATURE_UNITS.MILE]: 'mi',
};

export { round };
