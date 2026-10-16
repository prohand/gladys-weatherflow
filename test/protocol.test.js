import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  batteryPercent,
  cardinal,
  decodeMessage,
  dewPoint,
  feelsLike,
  parseObservation,
  parseStrike,
  seaLevelPressure,
} from '../src/tempest/protocol.js';
import { localObs, obsRow, T0 } from './helpers/tempest.js';

test('decodeMessage reads a datagram, a frame or an object, and ignores anything else', () => {
  const message = localObs();
  assert.deepEqual(decodeMessage(Buffer.from(JSON.stringify(message))), message);
  assert.deepEqual(decodeMessage(JSON.stringify(message)), message);
  assert.deepEqual(decodeMessage(message), message);
  assert.equal(decodeMessage('not json'), null);
  assert.equal(decodeMessage('[1,2]'), null);
  assert.equal(decodeMessage('{"no":"type"}'), null);
  assert.equal(decodeMessage(null), null);
});

test('parseObservation names every value of an obs_st row', () => {
  const obs = parseObservation(obsRow({ temperature: 21.5, humidity: 50, rainMinute: 0.2 }));
  assert.equal(obs.epoch, T0);
  assert.equal(obs.temperature, 21.5);
  assert.equal(obs.humidity, 50);
  assert.equal(obs.windAvg, 3.5);
  assert.equal(obs.windDirection, 225);
  assert.equal(obs.pressure, 1000.2);
  assert.equal(obs.rainMinute, 0.2);
  assert.equal(obs.battery, 2.69);
  assert.equal(obs.rainDay, null, 'the hub does not send the rain of the day');
  assert.equal(parseObservation(obsRow({ rainDay: 4.2 })).rainDay, 4.2, 'the cloud does');
});

test('a value the sensor failed to measure is null, not 0', () => {
  const obs = parseObservation(obsRow({ temperature: null, humidity: null }));
  assert.equal(obs.temperature, null);
  assert.equal(obs.humidity, null);
});

test('parseStrike reads epoch, distance and energy', () => {
  assert.deepEqual(parseStrike([T0, 27, 3848]), { epoch: T0, distance: 27, energy: 3848 });
});

test('dew point and feels like follow the usual formulas', () => {
  assert.equal(dewPoint(20, 50), 9.3);
  assert.equal(dewPoint(null, 50), null);
  // Cold and windy: wind chill.
  assert.ok(feelsLike(0, 80, 10) < -4);
  // Hot and humid: heat index.
  assert.ok(feelsLike(32, 70, 1) > 38);
  // In between: the air temperature.
  assert.equal(feelsLike(18, 60, 2), 18);
});

test('sea-level pressure needs the altitude', () => {
  assert.equal(seaLevelPressure(1000, null), null);
  assert.equal(seaLevelPressure(1000, 0), 1000);
  const corrected = seaLevelPressure(995.1, 152);
  assert.ok(corrected > 1012 && corrected < 1014, `got ${corrected}`);
});

test('battery percentage is bounded', () => {
  assert.equal(batteryPercent(2.9), 100);
  assert.equal(batteryPercent(2.2), 0);
  assert.equal(batteryPercent(null), null);
  assert.ok(batteryPercent(2.6) > 40 && batteryPercent(2.6) < 70);
});

test('cardinal points', () => {
  assert.equal(cardinal(0), 'N');
  assert.equal(cardinal(359), 'N');
  assert.equal(cardinal(225), 'SW');
  assert.equal(cardinal(95), 'E');
  assert.equal(cardinal(null), null);
});
