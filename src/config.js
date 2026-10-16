// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it
// (`gladys.getConfig()`) and notifies every change (`gladys.onConfigUpdated()`).
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`, strings typed in a
// number box or a unit it does not know.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';

export const TEMPERATURE_UNITS = [DEVICE_FEATURE_UNITS.CELSIUS, DEVICE_FEATURE_UNITS.FAHRENHEIT];

export const WIND_UNITS = [
  DEVICE_FEATURE_UNITS.KILOMETER_PER_HOUR,
  DEVICE_FEATURE_UNITS.METER_PER_SECOND,
  DEVICE_FEATURE_UNITS.MILE_PER_HOUR,
];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // Personal access token of tempestwx.com. Empty: local network only.
  token: '',
  temperature_unit: DEVICE_FEATURE_UNITS.CELSIUS,
  wind_unit: DEVICE_FEATURE_UNITS.KILOMETER_PER_HOUR,
  // Station altitude in metres, for the sea-level pressure. A text field on
  // purpose: a Gladys number box cannot be cleared, and empty means "take the
  // altitude declared in the Tempest app" (cloud).
  elevation: '',
  // IANA time zone of the "rain today" midnight. Empty: the station's own
  // (cloud), else the container's.
  timezone: '',
  // Reserved key (NOT in config_schema): the manifest declares both 'local'
  // and 'cloud' transports, so Gladys shows a standard "Prefer the local
  // connection" toggle and sends the user's choice here. Defaults to true.
  GLADYS_PREFER_LOCAL: true,
};

/** A finite number from a number or a text box, `null` when there is none. */
function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim().replace(',', '.');
  if (text === '') {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** The IANA time zone when the runtime knows it, '' otherwise. */
export function validTimezone(value) {
  const zone = typeof value === 'string' ? value.trim() : '';
  if (!zone) {
    return '';
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return '';
  }
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const elevation = toNumber(raw.elevation);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    token: typeof raw.token === 'string' ? raw.token.trim() : '',
    temperature_unit: TEMPERATURE_UNITS.includes(raw.temperature_unit)
      ? raw.temperature_unit
      : DEFAULT_CONFIG.temperature_unit,
    wind_unit: WIND_UNITS.includes(raw.wind_unit) ? raw.wind_unit : DEFAULT_CONFIG.wind_unit,
    // -500 m (Dead Sea shore) to 9000 m: anything else is a typo, ignored.
    elevation: elevation !== null && elevation >= -500 && elevation <= 9000 ? elevation : null,
    timezone: validTimezone(raw.timezone),
    // The preference is a boolean; anything but an explicit false means true.
    GLADYS_PREFER_LOCAL: raw.GLADYS_PREFER_LOCAL !== false,
  };
}
