import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDevice, stationIds } from '../src/devices/tempest.js';
import { STATION_WIDGET, WIDGETS, refreshWidgets } from '../src/widgets.js';
import { SERIAL, T0, cloudObs, localObs, localStrike, setup } from './helpers/tempest.js';

const widget = WIDGETS[STATION_WIDGET];

const getContent = (ctx, settings = {}) =>
  widget.get(ctx.gladys, {
    settings,
    language: 'en',
    units: 'metric',
    config: ctx.config,
    engine: ctx.engine,
    registry: ctx.registry,
    now: () => ctx.clock.now,
  });

test('the empty state is rendered exactly as sent', async () => {
  const content = await getContent(setup());
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');
});

test('the station content is rendered exactly as sent, in every situation', async () => {
  // [] = nothing the core would drop, truncate or trim to the content budget.
  const ctx = setup({ cloudStation: true, config: { token: 't' } });
  assert.deepEqual(validateWidgetContent(await getContent(ctx)), [], 'no observation yet');

  await ctx.engine.handleMessage(cloudObs({ rainMinute: 0.4, battery: 2.4 }), 'cloud');
  await ctx.engine.handleMessage(localStrike(T0 + 5, 8), 'local');
  const content = await getContent(ctx);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(
    content.components.some((c) => c.type === 'button'),
    'refresh offered with a token',
  );
  assert.ok(content.components.some((c) => c.type === 'chart'));

  const imperial = setup({
    config: { temperature_unit: 'fahrenheit', wind_unit: 'mile-per-hour' },
  });
  await imperial.engine.handleMessage(localObs(), 'local');
  const local = await getContent(imperial);
  assert.deepEqual(validateWidgetContent(local), []);
  assert.ok(!local.components.some((c) => c.type === 'button'), 'no cloud, no refresh');
});

test('the live tiles reference features the station publishes', async () => {
  const ctx = setup({ cloudStation: true });
  const ids = new Set(
    buildDevice(ctx.gladys, ctx.registry.get(SERIAL), ctx.config).features.map(
      (f) => f.external_id,
    ),
  );
  const content = await getContent(ctx);
  const bound = content.components.flatMap(
    (c) => c.device_features ?? (c.device_feature ? [c.device_feature] : []),
  );
  assert.ok(bound.length >= 5);
  for (const id of bound) {
    assert.ok(ids.has(id), `unknown feature ${id}`);
  }
});

test('the settings pick the station', async () => {
  const ctx = setup({ cloudStation: true });
  ctx.registry.upsert({ serial: 'ST-00000001', name: 'Roof' });
  const roof = stationIds(ctx.gladys, ctx.registry.get('ST-00000001')).device;
  const content = await getContent(ctx, { station: roof });
  const tile = content.components.find((c) => c.type === 'value');
  assert.match(tile.device_feature, /st-00000001/);
});

test('the refresh button asks the cloud and answers a short toast', async () => {
  const ctx = setup({ cloudStation: true, config: { token: 't' } });
  const content = await getContent(ctx);
  const { action } = content.components.find((c) => c.type === 'button');
  const asked = [];
  const sources = {
    refreshFromCloud: async (serials) => {
      asked.push(serials);
      return 1;
    },
  };
  const toast = await widget.action(ctx.gladys, {
    actionKey: action.key,
    params: action.params,
    settings: {},
    sources,
  });
  assert.deepEqual(asked, [[SERIAL]]);
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.ok(toast[language].length <= 200, language);
  }
  await assert.rejects(
    widget.action(ctx.gladys, { actionKey: 'nope', params: {}, settings: {}, sources }),
    /Unknown widget action/,
  );
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.keys(WIDGETS));
});
