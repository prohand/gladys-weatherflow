// -----------------------------------------------------------------------------
// The Tempest stations this integration knows, remembered across restarts.
//
// A station becomes known two ways: the cloud lists it (token given), or its
// hub is heard on the LAN. Both name it by its serial number (ST-00012345),
// which is what the device external_id is built from: it never changes, even
// when the station is renamed or moved to another account.
//
// The record also keeps what the rolling values need to survive a restart (an
// update, a Gladys reboot): the rain counted since midnight, the rain and the
// lightning of the last hour, the last strike. It lives in /data, the only
// writable path of the container.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'stations' });

export const DATA_DIR = process.env.DATA_DIR || '/data';

/** Tempest serial numbers start with ST- (hubs HB-, the older Air AR- and Sky SK-). */
export function normalizeSerial(serial) {
  if (typeof serial !== 'string') {
    return null;
  }
  const value = serial.trim().toUpperCase();
  return /^ST-[0-9A-Z]+$/.test(value) ? value : null;
}

const STATION_FIELDS = ['name', 'deviceId', 'stationId', 'elevation', 'timezone', 'hubSerial'];

/**
 * @param {object} [options]
 * @param {string | null} [options.file] JSON file, `null` to keep it in memory
 */
export function createStationRegistry({ file = join(DATA_DIR, 'stations.json') } = {}) {
  /** @type {Map<string, object>} */
  const stations = new Map();

  function load() {
    if (!file) {
      return;
    }
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      for (const record of saved.stations ?? []) {
        const serial = normalizeSerial(record.serial);
        if (serial) {
          stations.set(serial, { ...record, serial });
        }
      }
      logger.info(`${stations.size} station(s) remembered`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Could not read ${file}: ${err.message}`);
      }
    }
  }

  function save() {
    if (!file) {
      return;
    }
    try {
      mkdirSync(dirname(file), { recursive: true });
      // Write then rename: a container stopped mid-write never leaves half a file.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ stations: [...stations.values()] }, null, 2));
      renameSync(tmp, file);
    } catch (err) {
      logger.warn(`Could not write ${file}: ${err.message}`);
    }
  }

  /**
   * Add a station or complete what is known about it.
   * @returns {{ station: object, added: boolean, changed: boolean } | null}
   */
  function upsert(info) {
    const serial = normalizeSerial(info.serial);
    if (!serial) {
      return null;
    }
    const existing = stations.get(serial);
    const station = existing ?? { serial };
    let changed = !existing;
    for (const field of STATION_FIELDS) {
      if (info[field] !== undefined && info[field] !== null && station[field] !== info[field]) {
        station[field] = info[field];
        changed = true;
      }
    }
    stations.set(serial, station);
    if (changed) {
      save();
    }
    return { station, added: !existing, changed };
  }

  return {
    load,
    save,
    upsert,
    get: (serial) => stations.get(normalizeSerial(serial)) ?? null,
    byDeviceId: (deviceId) =>
      [...stations.values()].find((station) => station.deviceId === deviceId) ?? null,
    list: () => [...stations.values()].sort((a, b) => a.serial.localeCompare(b.serial)),
  };
}
