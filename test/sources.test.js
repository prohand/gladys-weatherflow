import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSourceManager, GRACE_MS } from '../src/tempest/sources.js';
import { TempestApiError } from '../src/tempest/cloud.js';
import { normalizeConfig } from '../src/config.js';
import { DEVICE_ID, SERIAL, T0, cloudObs, localObs, rapidWind, setup } from './helpers/tempest.js';

const CLOUD_STATION = {
  serial: SERIAL,
  name: 'Garden',
  deviceId: DEVICE_ID,
  stationId: 4242,
  elevation: 152,
  timezone: 'Europe/Paris',
};

/** A source manager whose channels are recorded instead of opened. */
function managerFor(ctx, overrides = {}) {
  const channels = { local: [], cloud: [] };
  const changed = [];
  const manager = createSourceManager({
    gladys: ctx.gladys,
    engine: ctx.engine,
    registry: ctx.registry,
    now: () => ctx.clock.now,
    onStationsChanged: (stations) => changed.push(stations.map((s) => s.serial)),
    createLocal: (onMessage) => {
      const channel = {
        running: false,
        onMessage,
        start() {
          this.running = true;
        },
        stop() {
          this.running = false;
        },
      };
      channels.local.push(channel);
      return channel;
    },
    createCloud: (token, deviceIds, onMessage) => {
      const channel = {
        token,
        deviceIds,
        running: false,
        onMessage,
        start() {
          this.running = true;
        },
        stop() {
          this.running = false;
        },
      };
      channels.cloud.push(channel);
      return channel;
    },
    fetchStations: async () => [CLOUD_STATION],
    fetchObservation: async () => cloudObs({ epoch: T0 + 30 }),
    capture: async () => [],
    ...overrides,
  });
  const running = (kind) => channels[kind].filter((c) => c.running).length;
  return { manager, channels, changed, running };
}

test('without a token, the LAN only', async () => {
  const ctx = setup();
  const { manager, running } = managerFor(ctx);
  await manager.apply(normalizeConfig({ GLADYS_PREFER_LOCAL: false }));
  assert.equal(running('local'), 1);
  assert.equal(running('cloud'), 0);
});

test('with a token, the stations are listed and published', async () => {
  const ctx = setup();
  const { manager, changed } = managerFor(ctx);
  await manager.apply(normalizeConfig({ token: 't' }));
  assert.equal(ctx.registry.get(SERIAL).name, 'Garden');
  assert.deepEqual(changed, [[SERIAL]]);
});

test('local preferred: the cloud takes over when the LAN stays silent, and leaves when it is back', async () => {
  const ctx = setup();
  const { manager, running, channels } = managerFor(ctx);
  await manager.apply(normalizeConfig({ token: 't' }));
  assert.equal(running('local'), 1);
  assert.equal(running('cloud'), 0, 'local preferred, still in its grace time');

  ctx.clock.now += GRACE_MS + 1000;
  await manager.apply();
  assert.equal(running('cloud'), 1, 'nothing heard on the LAN: the cloud is called in');
  assert.deepEqual(channels.cloud[0].deviceIds, [DEVICE_ID]);
  assert.equal(running('local'), 1, 'the LAN keeps listening for the hub to come back');

  await channels.local[0].onMessage(rapidWind(Math.floor(ctx.clock.now / 1000)));
  await manager.apply();
  assert.equal(running('cloud'), 0, 'the hub is back: the cloud is closed');
});

test('cloud preferred: the LAN is only a fallback', async () => {
  const ctx = setup();
  const { manager, running, channels } = managerFor(ctx);
  await manager.apply(normalizeConfig({ token: 't', GLADYS_PREFER_LOCAL: false }));
  assert.equal(running('cloud'), 1);
  assert.equal(running('local'), 0);

  ctx.clock.now += GRACE_MS + 1000;
  await manager.apply();
  assert.equal(running('local'), 1, 'the cloud is silent: the LAN takes over');

  await channels.cloud[0].onMessage(cloudObs({ epoch: Math.floor(ctx.clock.now / 1000) }));
  await manager.apply();
  assert.equal(running('local'), 0);
});

test('a refused token falls back to the LAN and says so', async () => {
  const ctx = setup();
  const { manager, running } = managerFor(ctx, {
    fetchStations: async () => {
      throw new TempestApiError(401, 'Tempest cloud answered HTTP 401');
    },
  });
  await manager.apply(normalizeConfig({ token: 'bad', GLADYS_PREFER_LOCAL: false }));
  assert.equal(running('cloud'), 0);
  assert.equal(running('local'), 1);
  await manager.publishConnectionStatus();
  const status = ctx.gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /jeton/);
});

test('the connection status reports a setup where nothing is found', async () => {
  const ctx = setup();
  const { manager } = managerFor(ctx);
  await manager.apply(normalizeConfig());
  await manager.publishConnectionStatus();
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true, 'grace time');
  ctx.clock.now += GRACE_MS + 1000;
  await manager.tick();
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.ok(ctx.gladys.fake.connectionStatus.message[language], language);
  }
});

test('the transport badges are published when they change only', async () => {
  const ctx = setup();
  const { manager, channels } = managerFor(ctx);
  await manager.apply(normalizeConfig());
  await channels.local[0].onMessage(localObs({ epoch: T0 }));
  await manager.publishTransports();
  await manager.publishTransports();
  assert.equal(ctx.gladys.fake.transports.length, 1);
  assert.equal(ctx.gladys.fake.transports[0].transport, 'local');
});

test('refreshFromCloud publishes the latest cloud observation', async () => {
  const ctx = setup();
  const { manager } = managerFor(ctx);
  await manager.apply(normalizeConfig({ token: 't' }));
  assert.equal(await manager.refreshFromCloud([SERIAL]), 1);
  assert.equal(ctx.engine.snapshot(SERIAL).source, 'cloud');

  const noToken = managerFor(setup()).manager;
  await noToken.apply(normalizeConfig());
  assert.equal(await noToken.refreshFromCloud(), 0);
});

test('discover lists the cloud stations and the ones heard on the LAN', async () => {
  const ctx = setup();
  const { manager } = managerFor(ctx, {
    capture: async () => [
      { message: { ...localObs(), serial_number: 'ST-00099999' }, ip: '1.2.3.4' },
    ],
  });
  await manager.apply(normalizeConfig({ token: 't', GLADYS_PREFER_LOCAL: false }));
  const stations = await manager.discover();
  assert.deepEqual(
    stations.map((s) => s.serial),
    ['ST-00012345', 'ST-00099999'],
  );
});

test('the connection test reports both channels in every language', async () => {
  const ctx = setup();
  const { manager } = managerFor(ctx, {
    capture: async () => [{ message: localObs(), ip: '1.2.3.4' }],
  });
  await manager.apply(normalizeConfig({ token: 't', GLADYS_PREFER_LOCAL: false }));
  const message = await manager.testConnection();
  assert.match(message.en, /Local network: OK \(ST-00012345\)\. Cloud: OK, 1 Tempest \(Garden\)\./);
  assert.match(message.fr, /Réseau local : OK/);
  assert.match(message.de, /Lokales Netzwerk: OK/);
  assert.match(message.es, /Red local: OK/);
});

test('the connection test without a token and nothing on the LAN', async () => {
  const ctx = setup();
  const { manager } = managerFor(ctx);
  await manager.apply(normalizeConfig({ GLADYS_PREFER_LOCAL: false }));
  // The listener runs but heard nothing: a fresh capture is made.
  const message = await manager.testConnection();
  assert.match(message.en, /nothing heard/);
  assert.match(message.en, /no token/);
});

test('removing a refused token clears the refusal', async () => {
  const ctx = setup();
  const { manager } = managerFor(ctx, {
    fetchStations: async () => {
      throw new TempestApiError(401, 'Tempest cloud answered HTTP 401');
    },
  });
  await manager.apply(normalizeConfig({ token: 'bad' }));
  await manager.apply(normalizeConfig());
  await manager.publishConnectionStatus();
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
});
