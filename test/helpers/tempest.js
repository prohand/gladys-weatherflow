// -----------------------------------------------------------------------------
// Tempest messages for the tests, in the shapes the hub and the cloud send
// them (https://weatherflow.github.io/Tempest/api/udp/v171/).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createEngine } from '../../src/tempest/engine.js';
import { createStationRegistry } from '../../src/tempest/stations.js';
import { normalizeConfig } from '../../src/config.js';

export const SERIAL = 'ST-00012345';
export const HUB = 'HB-00013030';
export const DEVICE_ID = 98765;

// 2026-10-16 12:00:00 UTC
export const T0 = 1792152000;

/** An obs_st row, metric, with overridable values. */
export function obsRow({
  epoch = T0,
  windLull = 1.2,
  windAvg = 3.5,
  windGust = 6.1,
  windDirection = 225,
  pressure = 1000.2,
  temperature = 18.4,
  humidity = 65,
  illuminance = 25000,
  uv = 3.2,
  solarRadiation = 210,
  rainMinute = 0,
  precipitationType = 0,
  strikeDistance = 0,
  strikeCount = 0,
  battery = 2.69,
  rainDay,
} = {}) {
  const row = [
    epoch,
    windLull,
    windAvg,
    windGust,
    windDirection,
    3,
    pressure,
    temperature,
    humidity,
    illuminance,
    uv,
    solarRadiation,
    rainMinute,
    precipitationType,
    strikeDistance,
    strikeCount,
    battery,
    1,
  ];
  if (rainDay !== undefined) {
    row.push(rainDay, 0, 0, 0);
  }
  return row;
}

/** What the hub broadcasts on the LAN. */
export const localObs = (values) => ({
  serial_number: SERIAL,
  type: 'obs_st',
  hub_sn: HUB,
  obs: [obsRow(values)],
  firmware_revision: 172,
});

/** What the cloud WebSocket pushes. */
export const cloudObs = (values) => ({
  type: 'obs_st',
  device_id: DEVICE_ID,
  obs: [obsRow(values)],
});

export const localStrike = (epoch, distance = 12, energy = 3848) => ({
  serial_number: SERIAL,
  type: 'evt_strike',
  hub_sn: HUB,
  evt: [epoch, distance, energy],
});

export const localRainStart = (epoch) => ({
  serial_number: SERIAL,
  type: 'evt_precip',
  hub_sn: HUB,
  evt: [epoch],
});

export const rapidWind = (epoch) => ({
  serial_number: SERIAL,
  type: 'rapid_wind',
  hub_sn: HUB,
  ob: [epoch, 2.3, 128],
});

/** A raw `udp-broadcast` capture result, as the core relays it. */
export const datagram = (message, ip = '192.168.1.40') => ({
  source_ip: ip,
  source_port: 50222,
  payload_base64: Buffer.from(JSON.stringify(message)).toString('base64'),
});

/** A fake Gladys, an in-memory registry, an engine and a controllable clock. */
export function setup({ config: rawConfig = {}, cloudStation = false } = {}) {
  const gladys = createFakeGladys();
  const registry = createStationRegistry({ file: null });
  let config = normalizeConfig({ timezone: 'UTC', ...rawConfig });
  const clock = { now: T0 * 1000 };
  const newStations = [];
  const observations = [];
  if (cloudStation) {
    registry.upsert({
      serial: SERIAL,
      name: 'Garden',
      deviceId: DEVICE_ID,
      stationId: 4242,
      elevation: 152,
      timezone: 'Europe/Paris',
    });
  }
  const engine = createEngine({
    gladys,
    registry,
    getConfig: () => config,
    now: () => clock.now,
    onNewStation: (station) => newStations.push(station.serial),
    onObservation: (station) => observations.push(station.serial),
  });
  return {
    gladys,
    registry,
    engine,
    clock,
    newStations,
    observations,
    get config() {
      return config;
    },
    setConfig(raw) {
      config = normalizeConfig({ timezone: 'UTC', ...raw });
    },
  };
}
