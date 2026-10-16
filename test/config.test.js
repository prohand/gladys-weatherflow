import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import * as units from '../src/units.js';

test('an empty config is the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.token, '');
  assert.equal(config.temperature_unit, DEFAULT_CONFIG.temperature_unit);
  assert.equal(config.wind_unit, DEFAULT_CONFIG.wind_unit);
  assert.equal(config.elevation, null);
  assert.equal(config.timezone, '');
  assert.equal(config.GLADYS_PREFER_LOCAL, true);
});

test('values are cleaned up', () => {
  const config = normalizeConfig({
    token: '  abc  ',
    temperature_unit: 'kelvin',
    wind_unit: 'mile-per-hour',
    elevation: ' 152,5 ',
    timezone: 'Not/AZone',
    GLADYS_PREFER_LOCAL: false,
  });
  assert.equal(config.token, 'abc');
  assert.equal(config.temperature_unit, 'celsius', 'an unknown unit falls back');
  assert.equal(config.wind_unit, 'mile-per-hour');
  assert.equal(config.elevation, 152.5, 'a comma is a decimal separator');
  assert.equal(config.timezone, '', 'an unknown time zone is ignored');
  assert.equal(config.GLADYS_PREFER_LOCAL, false);
});

test('an altitude out of range or empty is ignored', () => {
  assert.equal(normalizeConfig({ elevation: '' }).elevation, null);
  assert.equal(normalizeConfig({ elevation: 'abc' }).elevation, null);
  assert.equal(normalizeConfig({ elevation: 12000 }).elevation, null);
  assert.equal(normalizeConfig({ elevation: 0 }).elevation, 0);
  assert.equal(normalizeConfig({ timezone: 'Europe/Paris' }).timezone, 'Europe/Paris');
});

test('unit conversions', () => {
  const metric = normalizeConfig();
  const imperial = normalizeConfig({ temperature_unit: 'fahrenheit', wind_unit: 'mile-per-hour' });
  assert.equal(units.temperature(20, metric), 20);
  assert.equal(units.temperature(20, imperial), 68);
  assert.equal(units.wind(10, metric), 36);
  assert.equal(units.wind(10, imperial), 22.4);
  assert.equal(units.wind(10, normalizeConfig({ wind_unit: 'meter-per-second' })), 10);
  assert.equal(units.distance(10, metric), 10);
  assert.equal(units.distance(10, imperial), 6.2);
  assert.equal(units.distanceUnit(imperial), 'mile');
  assert.equal(units.temperature(null, metric), null);
});
