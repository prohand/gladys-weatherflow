import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudListener,
  TempestApiError,
  fetchDailyForecast,
  fetchLatestObservation,
  fetchStations,
} from '../src/tempest/cloud.js';
import { obsRow } from './helpers/tempest.js';

/** A fetch that answers one JSON body and records the requests. */
function fakeFetch(body, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

const STATIONS = {
  stations: [
    {
      station_id: 4242,
      name: 'Garden',
      timezone: 'Europe/Paris',
      station_meta: { elevation: 152.4 },
      devices: [
        { device_id: 1, serial_number: 'HB-00013030', device_type: 'HB' },
        { device_id: 98765, serial_number: 'ST-00012345', device_type: 'ST' },
        { device_id: 5, serial_number: 'AR-00004049', device_type: 'AR' },
      ],
    },
  ],
  status: { status_code: 0 },
};

test('fetchStations keeps the Tempest devices with their station details', async () => {
  const { calls, fetchImpl } = fakeFetch(STATIONS);
  const stations = await fetchStations('secret-token', { fetchImpl });
  assert.deepEqual(stations, [
    {
      serial: 'ST-00012345',
      name: 'Garden',
      deviceId: 98765,
      stationId: 4242,
      elevation: 152.4,
      timezone: 'Europe/Paris',
      hubSerial: 'HB-00013030',
    },
  ]);
  assert.equal(calls[0].url, 'https://swd.weatherflow.com/swd/rest/stations');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-token');
  assert.ok(!calls[0].url.includes('secret-token'), 'the token never sits in a REST URL');
});

test('a refused token is an unauthorized TempestApiError', async () => {
  const { fetchImpl } = fakeFetch({}, 401);
  await assert.rejects(fetchStations('bad', { fetchImpl }), (err) => {
    assert.ok(err instanceof TempestApiError);
    assert.equal(err.unauthorized, true);
    return true;
  });
});

test('an unreachable cloud is a TempestApiError too', async () => {
  const fetchImpl = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  await assert.rejects(fetchStations('t', { fetchImpl }), /unreachable/);
});

test('fetchLatestObservation returns an obs_st message, or null', async () => {
  const row = obsRow();
  const { fetchImpl } = fakeFetch({ device_id: 98765, type: 'obs_st', obs: [row] });
  assert.deepEqual(await fetchLatestObservation('t', 98765, { fetchImpl }), {
    type: 'obs_st',
    device_id: 98765,
    obs: [row],
  });
  const empty = fakeFetch({ obs: [] });
  assert.equal(await fetchLatestObservation('t', 98765, { fetchImpl: empty.fetchImpl }), null);
});

test('fetchDailyForecast asks for metric units', async () => {
  const { calls, fetchImpl } = fakeFetch({ forecast: { daily: [{ conditions: 'Clear' }] } });
  assert.deepEqual(await fetchDailyForecast('t', 4242, { fetchImpl }), [{ conditions: 'Clear' }]);
  assert.match(calls[0].url, /better_forecast\?station_id=4242&units_temp=c/);
});

/** A WebSocket stand-in driven by the test. */
class FakeSocket extends EventTarget {
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
  open() {
    this.dispatchEvent(new Event('open'));
  }
  receive(message) {
    const event = new Event('message');
    event.data = JSON.stringify(message);
    this.dispatchEvent(event);
  }
}

test('the listener subscribes to every device and hands the messages over', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  FakeSocket.instances = [];
  const received = [];
  const listener = new CloudListener({
    token: 'tok en',
    deviceIds: [98765, 111],
    onMessage: (message) => received.push(message),
    WebSocketImpl: FakeSocket,
  });
  listener.start();
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, 'wss://ws.weatherflow.com/swd/data?token=tok%20en');
  socket.open();
  assert.deepEqual(
    socket.sent.map((m) => [m.type, m.device_id]),
    [
      ['listen_start', 98765],
      ['listen_start', 111],
    ],
  );
  socket.receive({ type: 'connection_opened' });
  socket.receive({ type: 'ack', id: 'x' });
  socket.receive({ type: 'obs_st', device_id: 98765, obs: [obsRow()] });
  await Promise.resolve();
  assert.deepEqual(
    received.map((m) => m.type),
    ['obs_st'],
  );
  assert.equal(listener.connected, true);
  listener.stop();
  assert.equal(socket.closed, true);
});

test('the listener reconnects after a close, with a growing delay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  FakeSocket.instances = [];
  const listener = new CloudListener({
    token: 't',
    deviceIds: [1],
    onMessage: () => {},
    WebSocketImpl: FakeSocket,
  });
  listener.start();
  FakeSocket.instances[0].close();
  t.mock.timers.tick(4999);
  assert.equal(FakeSocket.instances.length, 1);
  t.mock.timers.tick(1);
  assert.equal(FakeSocket.instances.length, 2, 'reconnected after 5 s');
  FakeSocket.instances[1].close();
  t.mock.timers.tick(5000);
  assert.equal(FakeSocket.instances.length, 2, 'the second delay is longer');
  t.mock.timers.tick(5000);
  assert.equal(FakeSocket.instances.length, 3);
  listener.stop();
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(FakeSocket.instances.length, 3, 'stopped: no reconnection');
});

test('a socket silent for 3 minutes is replaced', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  FakeSocket.instances = [];
  let now = 0;
  const listener = new CloudListener({
    token: 't',
    deviceIds: [1],
    onMessage: () => {},
    WebSocketImpl: FakeSocket,
    now: () => now,
  });
  listener.start();
  FakeSocket.instances[0].open();
  now = 4 * 60 * 1000;
  t.mock.timers.tick(60 * 1000);
  assert.equal(FakeSocket.instances[0].closed, true);
  t.mock.timers.tick(5000);
  assert.equal(FakeSocket.instances.length, 2);
  listener.stop();
});
