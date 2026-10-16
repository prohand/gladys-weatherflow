import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  FEATURE,
  buildDevice,
  buildStates,
  findStation,
  stationName,
} from '../src/devices/tempest.js';
import { createStationRegistry } from '../src/tempest/stations.js';
import { normalizeConfig } from '../src/config.js';
import { SERIAL } from './helpers/tempest.js';

const station = { serial: SERIAL, name: 'Garden' };

test('Gladys accepts the discovery payload, in every unit', async () => {
  // The SDK fake checks the payload like the host API: external_id prefix,
  // known category/type/unit... A refusal is a 400 for the WHOLE list.
  for (const raw of [
    {},
    { temperature_unit: 'fahrenheit', wind_unit: 'mile-per-hour' },
    { wind_unit: 'meter-per-second' },
  ]) {
    const gladys = createFakeGladys();
    await gladys.publishDiscoveredDevices([buildDevice(gladys, station, normalizeConfig(raw))]);
    assert.equal(gladys.fake.discoveredDevices.length, 1);
  }
});

test('the device is built from the serial number, never from the name', () => {
  const gladys = createFakeGladys();
  const config = normalizeConfig();
  const named = buildDevice(gladys, station, config);
  const renamed = buildDevice(gladys, { ...station, name: 'Roof' }, config);
  assert.equal(named.external_id, renamed.external_id);
  assert.match(named.external_id, /st-00012345$/);
  assert.equal(named.name, 'Tempest Garden');
  assert.equal(stationName({ serial: SERIAL }), `Tempest ${SERIAL}`);
});

test('every feature is a read-only sensor with min and max', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, station, normalizeConfig());
  assert.equal(device.features.length, Object.keys(FEATURE).length);
  for (const feature of device.features) {
    assert.equal(feature.read_only, true, feature.name);
    assert.equal(typeof feature.min, 'number', `${feature.name}: min`);
    assert.equal(typeof feature.max, 'number', `${feature.name}: max`);
    assert.ok(feature.min < feature.max, feature.name);
  }
  assert.notEqual(device.should_poll, true, 'pushed, never polled');
});

test('the units of the features follow the configuration', () => {
  const gladys = createFakeGladys();
  const unitOf = (config, key) =>
    buildDevice(gladys, station, config).features.find((f) => f.external_id.endsWith(`:${key}`))
      .unit;
  const imperial = normalizeConfig({ temperature_unit: 'fahrenheit', wind_unit: 'mile-per-hour' });
  assert.equal(unitOf(normalizeConfig(), FEATURE.TEMPERATURE), 'celsius');
  assert.equal(unitOf(imperial, FEATURE.TEMPERATURE), 'fahrenheit');
  assert.equal(unitOf(imperial, FEATURE.WIND_SPEED), 'mile-per-hour');
  assert.equal(unitOf(imperial, FEATURE.LIGHTNING_DISTANCE), 'mile');
});

test('a value the station did not measure is not published', () => {
  const gladys = createFakeGladys();
  const states = buildStates(
    gladys,
    station,
    { temperature: 12.3, humidity: null },
    normalizeConfig(),
  );
  assert.deepEqual(
    states.map((s) => s.device_feature_external_id.split(':').pop()),
    [FEATURE.TEMPERATURE],
  );
});

test('findStation maps a device external id back to its station', () => {
  const gladys = createFakeGladys();
  const registry = createStationRegistry({ file: null });
  registry.upsert(station);
  const { external_id } = buildDevice(gladys, station, normalizeConfig());
  assert.equal(findStation(gladys, registry, external_id).serial, SERIAL);
  assert.equal(findStation(gladys, registry, 'ext:other:device'), null);
});
