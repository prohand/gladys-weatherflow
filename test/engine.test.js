import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE, featureExternalId } from '../src/devices/tempest.js';
import { UNREACHABLE_AFTER_MS, dayKey } from '../src/tempest/engine.js';
import {
  SERIAL,
  T0,
  cloudObs,
  localObs,
  localRainStart,
  localStrike,
  rapidWind,
  setup,
} from './helpers/tempest.js';

const feature = (ctx, key) => featureExternalId(ctx.gladys, ctx.registry.get(SERIAL), key);
const last = (ctx, key) => ctx.gladys.fake.lastState(feature(ctx, key));
const eventsOf = (ctx, key) => ctx.gladys.fake.sceneEvents.filter((e) => e.key === key);

/** One observation a minute, from T0 on. */
async function minute(ctx, index, values = {}, make = localObs, source = 'local') {
  ctx.clock.now = (T0 + index * 60) * 1000;
  await ctx.engine.handleMessage(make({ epoch: T0 + index * 60, ...values }), source);
}

test('a station heard on the LAN is registered and its values published', async () => {
  const ctx = setup();
  await minute(ctx, 0, { temperature: 18.4, humidity: 65, windAvg: 3.5 });
  assert.deepEqual(ctx.newStations, [SERIAL]);
  assert.deepEqual(ctx.observations, [SERIAL]);
  assert.equal(last(ctx, FEATURE.TEMPERATURE), 18.4);
  assert.equal(last(ctx, FEATURE.HUMIDITY), 65);
  assert.equal(last(ctx, FEATURE.WIND_SPEED), 12.6, 'm/s converted to km/h');
  assert.equal(last(ctx, FEATURE.RAINING), 0);
  assert.equal(last(ctx, FEATURE.SEA_LEVEL_PRESSURE), undefined, 'no altitude known');
});

test('the same observation brought by both channels is processed once', async () => {
  const ctx = setup({ cloudStation: true });
  await ctx.engine.handleMessage(localObs({ epoch: T0 }), 'local');
  const published = ctx.gladys.fake.states.length;
  await ctx.engine.handleMessage(cloudObs({ epoch: T0 }), 'cloud');
  await ctx.engine.handleMessage(localObs({ epoch: T0 - 60 }), 'local');
  assert.equal(ctx.gladys.fake.states.length, published, 'nothing published again');
  assert.deepEqual(ctx.observations, [SERIAL]);
});

test('a cloud message names the station by its device id', async () => {
  const ctx = setup({ cloudStation: true });
  await minute(ctx, 0, { temperature: 10 }, cloudObs, 'cloud');
  assert.equal(last(ctx, FEATURE.TEMPERATURE), 10);
  assert.ok(last(ctx, FEATURE.SEA_LEVEL_PRESSURE) > 1000, 'the cloud altitude is used');

  const unknown = setup();
  await unknown.engine.handleMessage(cloudObs(), 'cloud');
  assert.equal(unknown.gladys.fake.states.length, 0, 'an unknown device id is ignored');
});

test('the configured altitude wins over the cloud one', async () => {
  const ctx = setup({ cloudStation: true, config: { elevation: '0' } });
  await minute(ctx, 0, { pressure: 1000.2 }, cloudObs, 'cloud');
  assert.equal(last(ctx, FEATURE.SEA_LEVEL_PRESSURE), 1000.2);
});

test('the hub status and the Air/Sky are not stations', async () => {
  const ctx = setup();
  await ctx.engine.handleMessage(
    { serial_number: 'HB-00013030', type: 'hub_status', uptime: 1 },
    'local',
  );
  await ctx.engine.handleMessage({ ...localObs(), serial_number: 'AR-00004049' }, 'local');
  assert.deepEqual(ctx.registry.list(), []);
});

test('the rain of the day adds up the minutes and restarts at midnight', async () => {
  const ctx = setup();
  await minute(ctx, 0, { rainMinute: 0.2 });
  await minute(ctx, 1, { rainMinute: 0.3 });
  assert.equal(last(ctx, FEATURE.RAIN_TODAY), 0.5);
  assert.equal(last(ctx, FEATURE.RAIN_LAST_HOUR), 0.5);

  // The next day (T0 is noon UTC).
  await minute(ctx, 12 * 60, { rainMinute: 0.1 });
  assert.equal(last(ctx, FEATURE.RAIN_TODAY), 0.1);
  assert.equal(last(ctx, FEATURE.RAIN_LAST_HOUR), 0.1, 'the old minutes left the hour');
});

test('the cloud count of the day replaces the local sum', async () => {
  const ctx = setup({ cloudStation: true });
  await minute(ctx, 0, { rainMinute: 0.2 }, localObs);
  await minute(ctx, 1, { rainMinute: 0.1, rainDay: 7.4 }, cloudObs, 'cloud');
  assert.equal(last(ctx, FEATURE.RAIN_TODAY), 7.4);
  await minute(ctx, 2, { rainMinute: 0.1 }, localObs);
  assert.equal(last(ctx, FEATURE.RAIN_TODAY), 7.5);
});

test('the day of the rain follows the station time zone', () => {
  // 23:30 UTC is already the next day in Paris.
  const epoch = Date.UTC(2026, 9, 16, 23, 30) / 1000;
  assert.equal(dayKey(epoch, 'UTC'), '2026-10-16');
  assert.equal(dayKey(epoch, 'Europe/Paris'), '2026-10-17');
});

test('rain_started fires once on the dry -> wet edge, and raining ends after 10 dry minutes', async () => {
  const ctx = setup();
  await minute(ctx, 0);
  await minute(ctx, 1, { rainMinute: 0.1, precipitationType: 1 });
  await minute(ctx, 2, { rainMinute: 0.2, precipitationType: 1 });
  assert.equal(last(ctx, FEATURE.RAINING), 1);
  assert.equal(eventsOf(ctx, 'rain_started').length, 1);
  assert.equal(eventsOf(ctx, 'rain_started')[0].data.rain_today, 0.1, 'at the first wet minute');

  for (let i = 3; i <= 11; i += 1) {
    await minute(ctx, i);
  }
  assert.equal(last(ctx, FEATURE.RAINING), 1, 'nine dry minutes: still raining');
  await minute(ctx, 12);
  assert.equal(last(ctx, FEATURE.RAINING), 0);

  await minute(ctx, 13, { rainMinute: 0.1 });
  assert.equal(eventsOf(ctx, 'rain_started').length, 2, 'a new shower');
});

test('the hub rain start event fires the trigger at once, once for both channels', async () => {
  const ctx = setup({ cloudStation: true });
  await minute(ctx, 0);
  ctx.clock.now += 20 * 1000;
  await ctx.engine.handleMessage(localRainStart(T0 + 20), 'local');
  await ctx.engine.handleMessage({ type: 'evt_precip', device_id: 98765, evt: [T0 + 20] }, 'cloud');
  assert.equal(eventsOf(ctx, 'rain_started').length, 1);
  assert.equal(last(ctx, FEATURE.RAINING), 1);
});

test('raining at startup is a state, not the start of a shower', async () => {
  const ctx = setup();
  await minute(ctx, 0, { rainMinute: 0.4 });
  assert.equal(last(ctx, FEATURE.RAINING), 1);
  assert.equal(eventsOf(ctx, 'rain_started').length, 0);
});

test('lightning: distance published, one event a minute at most, counted over the hour', async () => {
  const ctx = setup();
  await minute(ctx, 0);
  await ctx.engine.handleMessage(localStrike(T0 + 5, 12, 3000), 'local');
  await ctx.engine.handleMessage(localStrike(T0 + 5, 12, 3000), 'cloud'); // same strike
  ctx.clock.now += 10 * 1000;
  await ctx.engine.handleMessage(localStrike(T0 + 15, 9, 2000), 'local');
  assert.equal(last(ctx, FEATURE.LIGHTNING_DISTANCE), 9);

  const events = eventsOf(ctx, 'lightning_detected');
  assert.equal(events.length, 1, 'the second strike of the minute fires nothing');
  assert.equal(events[0].data.distance, 12);
  assert.equal(events[0].data.energy, 3000);
  assert.match(events[0].data.device, /st-00012345$/);

  await minute(ctx, 1, { strikeCount: 2, strikeDistance: 10 });
  assert.equal(last(ctx, FEATURE.LIGHTNING_STRIKES), 2);
  ctx.clock.now += 60 * 1000;
  await ctx.engine.handleMessage(localStrike(T0 + 130, 5), 'local');
  assert.equal(eventsOf(ctx, 'lightning_detected').length, 2);
  assert.equal(eventsOf(ctx, 'lightning_detected')[1].data.strikes_last_hour, 2);
});

test('lightning distance follows the distance unit', async () => {
  const ctx = setup({ config: { wind_unit: 'mile-per-hour' } });
  await minute(ctx, 0);
  await ctx.engine.handleMessage(localStrike(T0 + 5, 10), 'local');
  assert.equal(last(ctx, FEATURE.LIGHTNING_DISTANCE), 6.2);
});

test('station_unreachable fires once when the station falls silent', async () => {
  const ctx = setup();
  await minute(ctx, 0);
  ctx.clock.now += UNREACHABLE_AFTER_MS - 1000;
  await ctx.engine.tick();
  assert.equal(eventsOf(ctx, 'station_unreachable').length, 0);
  ctx.clock.now += 2000;
  await ctx.engine.tick();
  await ctx.engine.tick();
  assert.equal(eventsOf(ctx, 'station_unreachable').length, 1);

  // Back, then silent again: a new event.
  await ctx.engine.handleMessage(rapidWind(T0 + 700), 'local');
  ctx.clock.now += UNREACHABLE_AFTER_MS;
  await ctx.engine.tick();
  assert.equal(eventsOf(ctx, 'station_unreachable').length, 2);
});

test('the transport badge says which channel brings the data', async () => {
  const ctx = setup({ cloudStation: true, config: { token: 't' } });
  assert.equal(ctx.engine.transport(SERIAL, ctx.config).transport, 'unreachable');

  await ctx.engine.handleMessage(rapidWind(T0), 'local');
  assert.deepEqual(ctx.engine.transport(SERIAL, ctx.config), { transport: 'local' });

  // The LAN falls silent, the cloud takes over: degraded, local was preferred.
  ctx.clock.now += 4 * 60 * 1000;
  await ctx.engine.handleMessage(cloudObs({ epoch: T0 + 240 }), 'cloud');
  const fallback = ctx.engine.transport(SERIAL, ctx.config);
  assert.equal(fallback.transport, 'cloud');
  assert.equal(fallback.degraded, true);
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.ok(fallback.message[language].length <= 200, language);
  }

  // Cloud preferred and answering: nominal.
  ctx.setConfig({ token: 't', GLADYS_PREFER_LOCAL: false });
  assert.deepEqual(ctx.engine.transport(SERIAL, ctx.config), { transport: 'cloud' });
});

test('local only, without a token, is nominal', async () => {
  const ctx = setup({ config: { GLADYS_PREFER_LOCAL: false } });
  await ctx.engine.handleMessage(rapidWind(T0), 'local');
  assert.deepEqual(ctx.engine.transport(SERIAL, ctx.config), { transport: 'local' });
});

test('changing the units publishes the values again in the new units', async () => {
  const ctx = setup();
  await minute(ctx, 0, { temperature: 20 });
  ctx.setConfig({ temperature_unit: 'fahrenheit' });
  await ctx.engine.republish();
  assert.equal(last(ctx, FEATURE.TEMPERATURE), 68);
});

test('the snapshot gives the derived values', async () => {
  const ctx = setup();
  await minute(ctx, 0, { temperature: 20, humidity: 50, battery: 2.8 });
  const snapshot = ctx.engine.snapshot(SERIAL);
  assert.equal(snapshot.dewPoint, 9.3);
  assert.equal(snapshot.feelsLike, 20);
  assert.equal(snapshot.batteryPercent, 100);
  assert.equal(snapshot.source, 'local');
  assert.equal(ctx.engine.snapshot('ST-99999999'), null);
});
