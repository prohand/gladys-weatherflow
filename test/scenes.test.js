import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import { SCENE_ACTIONS, SCENE_ACTION_KEYS, weatherCondition } from '../src/scenes.js';
import { stationIds } from '../src/devices/tempest.js';
import { SERIAL, T0, cloudObs, localObs, localStrike, setup } from './helpers/tempest.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declared = (list, key) => list.find((entry) => entry.key === key);
const outputKeys = (key) => declared(manifest.scene_actions, key).outputs.map((o) => o.key);

const context = (ctx, extra = {}) => ({
  config: ctx.config,
  engine: ctx.engine,
  registry: ctx.registry,
  now: () => ctx.clock.now,
  ...extra,
});

test('get_weather returns the declared outputs only, in the configured units', async () => {
  const ctx = setup({ cloudStation: true, config: { temperature_unit: 'fahrenheit' } });
  await ctx.engine.handleMessage(cloudObs({ temperature: 20, rainMinute: 0.2 }), 'cloud');
  await ctx.engine.handleMessage(localStrike(T0 + 5, 14), 'local');
  ctx.clock.now += 2 * 60 * 1000;
  const device = stationIds(ctx.gladys, ctx.registry.get(SERIAL)).device;

  const outputs = await SCENE_ACTIONS[SCENE_ACTION_KEYS.GET_WEATHER](ctx.gladys, {
    fields: { device },
    ...context(ctx),
  });
  assert.equal(outputs.available, true);
  assert.equal(outputs.temperature, 68);
  assert.equal(outputs.wind_cardinal, 'SW');
  assert.equal(outputs.raining, true);
  assert.equal(outputs.last_lightning_distance, 14);
  assert.equal(outputs.minutes_since_observation, 2);
  const allowed = outputKeys(SCENE_ACTION_KEYS.GET_WEATHER);
  for (const [key, value] of Object.entries(outputs)) {
    assert.ok(allowed.includes(key), `output "${key}" is not declared`);
    assert.ok(['number', 'string', 'boolean'].includes(typeof value), `${key} is a scalar`);
  }
});

test('get_weather without data says so instead of failing', async () => {
  const ctx = setup();
  const outputs = await SCENE_ACTIONS[SCENE_ACTION_KEYS.GET_WEATHER](ctx.gladys, {
    fields: { device: 'ext:test-integration:tempest:unknown' },
    ...context(ctx),
  });
  assert.deepEqual(outputs, { available: false });

  await ctx.engine.handleMessage(localObs(), 'local');
  const station = ctx.registry.get(SERIAL);
  const known = await SCENE_ACTIONS[SCENE_ACTION_KEYS.GET_WEATHER](ctx.gladys, {
    fields: { device: stationIds(ctx.gladys, station).device },
    ...context(ctx),
  });
  assert.equal(known.available, true);
});

test('get_forecast reads the asked day, converted', async () => {
  const ctx = setup({ cloudStation: true, config: { token: 't' } });
  const device = stationIds(ctx.gladys, ctx.registry.get(SERIAL)).device;
  const asked = [];
  const fetchForecast = async (token, stationId) => {
    asked.push([token, stationId]);
    return [
      { conditions: 'Clear', air_temp_high: 20, air_temp_low: 8 },
      {
        conditions: 'Rain Likely',
        icon: 'rainy',
        air_temp_high: 15,
        air_temp_low: 9,
        precip_probability: 80,
        precip_type: 'rain',
        sunrise: 1792131600,
        sunset: 1792170000,
      },
    ];
  };
  const outputs = await SCENE_ACTIONS[SCENE_ACTION_KEYS.GET_FORECAST](ctx.gladys, {
    fields: { device, day: 'tomorrow' },
    ...context(ctx, { fetchForecast }),
  });
  assert.deepEqual(asked, [['t', 4242]]);
  assert.deepEqual(outputs, {
    available: true,
    conditions: 'Rain Likely',
    icon: 'rainy',
    weather: 'rain',
    temperature_high: 15,
    temperature_low: 9,
    precipitation_probability: 80,
    precipitation_type: 'rain',
    // In the configured time zone (UTC in these tests), which wins over the station's.
    sunrise: '06:20',
    sunset: '17:00',
  });
  for (const key of Object.keys(outputs)) {
    assert.ok(outputKeys(SCENE_ACTION_KEYS.GET_FORECAST).includes(key), key);
  }

  const far = await SCENE_ACTIONS[SCENE_ACTION_KEYS.GET_FORECAST](ctx.gladys, {
    fields: { device, day: 'day_after_tomorrow' },
    ...context(ctx, { fetchForecast }),
  });
  assert.deepEqual(far, { available: false });
});

test('get_forecast without a token fails this action with an explanation', async () => {
  const ctx = setup({ cloudStation: true });
  const device = stationIds(ctx.gladys, ctx.registry.get(SERIAL)).device;
  await assert.rejects(
    SCENE_ACTIONS[SCENE_ACTION_KEYS.GET_FORECAST](ctx.gladys, {
      fields: { device, day: 'today' },
      ...context(ctx),
    }),
    /token/,
  );
});

test('the scene events carry only declared keys, flat and scalar', async () => {
  const ctx = setup();
  await ctx.engine.handleMessage(localObs({ epoch: T0 }), 'local');
  ctx.clock.now += 60 * 1000;
  await ctx.engine.handleMessage(localObs({ epoch: T0 + 60, rainMinute: 0.2 }), 'local');
  ctx.clock.now += 60 * 1000;
  await ctx.engine.handleMessage(localStrike(T0 + 125), 'local');
  ctx.clock.now += 11 * 60 * 1000;
  await ctx.engine.tick();

  const fired = ctx.gladys.fake.sceneEvents;
  assert.deepEqual(
    fired.map((e) => e.key),
    ['rain_started', 'lightning_detected', 'station_unreachable'],
  );
  for (const { key, data } of fired) {
    const trigger = declared(manifest.scene_triggers, key);
    const allowed = [...trigger.fields, ...(trigger.variables ?? [])].map((f) => f.key);
    for (const [name, value] of Object.entries(data)) {
      assert.ok(allowed.includes(name), `${key}: "${name}" is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}.${name} is flat`);
    }
  }
});

test('the forecast icon becomes a Gladys weather condition', () => {
  assert.equal(weatherCondition('clear-night'), 'clear');
  assert.equal(weatherCondition('partly-cloudy-day'), 'partly-cloudy');
  assert.equal(weatherCondition('cloudy'), 'cloud');
  assert.equal(weatherCondition('foggy'), 'fog');
  assert.equal(weatherCondition('possibly-rainy-night'), 'rain');
  assert.equal(weatherCondition('possibly-sleet-day'), 'sleet');
  assert.equal(weatherCondition('snow'), 'snow');
  assert.equal(weatherCondition('possibly-thunderstorm-day'), 'thunderstorm');
  assert.equal(weatherCondition('windy'), 'wind');
  assert.equal(weatherCondition('volcano'), 'unknown');
  assert.equal(weatherCondition(undefined), null);
  for (const icon of ['clear-day', 'rainy', 'windy', 'volcano']) {
    assert.ok(Object.values(WEATHER_CONDITIONS).includes(weatherCondition(icon)), icon);
    assert.notEqual(weatherCondition(icon), WEATHER_CONDITIONS.NIGHT, 'night is deprecated');
  }
});
