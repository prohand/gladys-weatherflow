import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { LocalListener, captureOnce, decodeCapture } from '../src/tempest/local.js';
import { datagram, localObs, rapidWind, T0 } from './helpers/tempest.js';

test('decodeCapture keeps the Tempest messages of a capture', () => {
  const messages = decodeCapture([
    datagram(localObs()),
    datagram(rapidWind(T0), '192.168.1.41'),
    {
      source_ip: '192.168.1.9',
      source_port: 50222,
      payload_base64: Buffer.from('garbage').toString('base64'),
    },
  ]);
  assert.deepEqual(
    messages.map(({ message, ip }) => [message.type, ip]),
    [
      ['obs_st', '192.168.1.40'],
      ['rapid_wind', '192.168.1.41'],
    ],
  );
  assert.deepEqual(decodeCapture(null), []);
});

test('captureOnce asks the core for an udp-broadcast capture', async () => {
  const gladys = createFakeGladys({ scanResults: { 'udp-broadcast': [datagram(localObs())] } });
  const messages = await captureOnce(gladys, 12);
  assert.equal(messages.length, 1);
  assert.deepEqual(gladys.fake.scans, [{ type: 'udp-broadcast', timeout_seconds: 12 }]);
});

test('the listener chains the captures and hands every message over', async () => {
  const received = [];
  let scans = 0;
  let listener;
  const gladys = {
    async scanNetwork(type, options) {
      assert.equal(type, 'udp-broadcast');
      assert.equal(options.timeoutSeconds, 30);
      scans += 1;
      if (scans === 2) {
        listener.stop();
      }
      return [datagram(rapidWind(T0 + scans))];
    },
  };
  listener = new LocalListener({ gladys, onMessage: (message) => received.push(message) });
  listener.start();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, 2);
  assert.equal(received.length, 1, 'the capture finishing after stop() is dropped');
  assert.equal(listener.hubIp, '192.168.1.40');
});

test('a failed capture is retried later, and stop() cuts the wait', async () => {
  let scans = 0;
  const gladys = {
    async scanNetwork() {
      scans += 1;
      throw Object.assign(new Error('Too many requests'), { status: 429 });
    },
  };
  const listener = new LocalListener({ gladys, onMessage: () => {} });
  listener.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, 1);
  assert.equal(listener.lastError, 'Too many requests');
  listener.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, 1, 'no new capture once stopped');
});
