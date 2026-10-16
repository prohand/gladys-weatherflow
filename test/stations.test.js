import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStationRegistry, normalizeSerial } from '../src/tempest/stations.js';

test('only Tempest serial numbers are stations', () => {
  assert.equal(normalizeSerial(' st-00012345 '), 'ST-00012345');
  assert.equal(normalizeSerial('HB-00013030'), null, 'a hub');
  assert.equal(normalizeSerial('AR-00004049'), null, 'an Air');
  assert.equal(normalizeSerial(42), null);
});

test('stations and their counters survive a restart', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tempest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'stations.json');

  const first = createStationRegistry({ file });
  const { station, added } = first.upsert({ serial: 'ST-00012345', name: 'Garden', deviceId: 1 });
  assert.equal(added, true);
  station.rainDay = { day: '2026-10-16', mm: 3.2 };
  first.save();
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).stations.length === 1);

  const second = createStationRegistry({ file });
  second.load();
  assert.equal(second.get('ST-00012345').name, 'Garden');
  assert.deepEqual(second.get('ST-00012345').rainDay, { day: '2026-10-16', mm: 3.2 });
  assert.equal(second.byDeviceId(1).serial, 'ST-00012345');
});

test('upsert completes a station without erasing what is known', () => {
  const registry = createStationRegistry({ file: null });
  registry.upsert({ serial: 'ST-1', name: 'Garden', deviceId: 1 });
  const { added, changed, station } = registry.upsert({ serial: 'ST-1', hubSerial: 'HB-2' });
  assert.equal(added, false);
  assert.equal(changed, true);
  assert.equal(station.name, 'Garden');
  assert.equal(registry.upsert({ serial: 'ST-1', name: 'Garden' }).changed, false);
  assert.equal(registry.upsert({ serial: 'HB-2' }), null);
});

test('a missing or broken file starts empty', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tempest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const registry = createStationRegistry({ file: join(dir, 'missing.json') });
  registry.load();
  assert.deepEqual(registry.list(), []);
});
