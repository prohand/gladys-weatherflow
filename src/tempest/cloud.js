// -----------------------------------------------------------------------------
// The cloud channel: the Tempest REST API and its real-time WebSocket.
//
//   - REST (https://swd.weatherflow.com/swd/rest): the list of the stations of
//     the account (names, altitude, time zone, device ids), the latest
//     observation of a device, the forecast;
//   - WebSocket (wss://ws.weatherflow.com/swd/data): the same messages the hub
//     broadcasts on the LAN, pushed as they arrive (observation every minute,
//     rain start, lightning strikes).
//
// Authentication is a personal access token created on tempestwx.com. It is a
// secret: it travels in the Authorization header for REST, and in the query
// string of the WebSocket URL (a WebSocket cannot carry a header) — that URL
// is never logged.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { decodeMessage, MESSAGE_TYPES } from './protocol.js';
import { normalizeSerial } from './stations.js';

const logger = createLogger({ name: 'cloud' });

export const REST_URL = 'https://swd.weatherflow.com/swd/rest';
export const WS_URL = 'wss://ws.weatherflow.com/swd/data';

const REQUEST_TIMEOUT_MS = 15 * 1000;

/** An answer of the Tempest API that is not a success. */
export class TempestApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TempestApiError';
    this.status = status;
  }

  /** The token is refused (wrong, revoked). */
  get unauthorized() {
    return this.status === 401 || this.status === 403;
  }
}

async function request(path, token, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(`${REST_URL}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new TempestApiError(0, `Tempest cloud unreachable: ${err.message}`);
  }
  if (!response.ok) {
    throw new TempestApiError(response.status, `Tempest cloud answered HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * The Tempest stations of the account, ready for the registry.
 * @returns {Promise<Array<{ serial, name, deviceId, stationId, elevation, timezone, hubSerial }>>}
 */
export async function fetchStations(token, options) {
  const body = await request('/stations', token, options);
  const stations = [];
  for (const station of body.stations ?? []) {
    const hub = (station.devices ?? []).find((device) => device.device_type === 'HB');
    for (const device of station.devices ?? []) {
      const serial = normalizeSerial(device.serial_number);
      if (device.device_type !== 'ST' || !serial) {
        continue;
      }
      const elevation = Number(station.station_meta?.elevation);
      stations.push({
        serial,
        name: station.name || station.public_name || undefined,
        deviceId: device.device_id,
        stationId: station.station_id,
        elevation: Number.isFinite(elevation) ? elevation : undefined,
        timezone: station.timezone || undefined,
        hubSerial: hub?.serial_number,
      });
    }
  }
  return stations;
}

/**
 * The latest observation of a device, as an `obs_st` message (the shape the
 * WebSocket and the hub send), or `null` when the device has none.
 */
export async function fetchLatestObservation(token, deviceId, options) {
  const body = await request(
    `/observations/device/${encodeURIComponent(deviceId)}`,
    token,
    options,
  );
  if (!Array.isArray(body.obs) || body.obs.length === 0) {
    return null;
  }
  return { type: MESSAGE_TYPES.OBSERVATION, device_id: deviceId, obs: body.obs };
}

/**
 * The daily forecast of a station, in metric units.
 * @returns {Promise<Array<object>>} `forecast.daily` of the API
 */
export async function fetchDailyForecast(token, stationId, options) {
  const query = new URLSearchParams({
    station_id: String(stationId),
    units_temp: 'c',
    units_wind: 'mps',
    units_pressure: 'mb',
    units_precip: 'mm',
    units_distance: 'km',
  });
  const body = await request(`/better_forecast?${query}`, token, options);
  return body.forecast?.daily ?? [];
}

const RECONNECT_MIN_MS = 5 * 1000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
// An observation arrives every minute: three silent minutes mean a dead socket.
const SILENCE_MS = 3 * 60 * 1000;

/**
 * The WebSocket listener: subscribes to every device, hands the messages over,
 * reconnects with a growing delay, and closes a socket gone silent.
 */
export class CloudListener {
  /**
   * @param {object} options
   * @param {string} options.token
   * @param {number[]} options.deviceIds cloud ids of the Tempest devices
   * @param {(message: object) => void | Promise<void>} options.onMessage
   * @param {typeof WebSocket} [options.WebSocketImpl]
   * @param {() => number} [options.now]
   */
  constructor({ token, deviceIds, onMessage, WebSocketImpl = globalThis.WebSocket, now }) {
    this.token = token;
    this.deviceIds = deviceIds;
    this.onMessage = onMessage;
    this.WebSocketImpl = WebSocketImpl;
    this.now = now ?? (() => Date.now());
    this.socket = null;
    this.stopped = true;
    this.attempts = 0;
    this.reconnectTimer = null;
    this.watchdog = null;
    this.lastMessageAt = 0;
    this.connected = false;
    this.lastError = null;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.connect();
    this.watchdog = setInterval(() => this.checkSilence(), 60 * 1000);
    this.watchdog.unref?.();
  }

  connect() {
    if (this.stopped) {
      return;
    }
    logger.info(`Connecting to the Tempest cloud (${this.deviceIds.length} device(s))`);
    let socket;
    try {
      socket = new this.WebSocketImpl(`${WS_URL}?token=${encodeURIComponent(this.token)}`);
    } catch (err) {
      this.lastError = err.message;
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.lastMessageAt = this.now();

    socket.addEventListener('open', () => {
      this.connected = true;
      this.attempts = 0;
      this.lastError = null;
      for (const deviceId of this.deviceIds) {
        socket.send(
          JSON.stringify({ type: 'listen_start', device_id: deviceId, id: `gladys-${deviceId}` }),
        );
      }
    });
    socket.addEventListener('message', (event) => {
      this.lastMessageAt = this.now();
      const message = decodeMessage(event.data);
      if (!message || message.type === 'ack' || message.type === 'connection_opened') {
        return;
      }
      Promise.resolve(this.onMessage(message)).catch((err) =>
        logger.error('Cloud message handling failed', err),
      );
    });
    socket.addEventListener('error', (event) => {
      this.lastError = event?.message || 'WebSocket error';
    });
    socket.addEventListener('close', () => {
      this.connected = false;
      if (this.socket === socket) {
        this.socket = null;
        this.scheduleReconnect();
      }
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.attempts);
    this.attempts += 1;
    logger.warn(`Tempest cloud disconnected, reconnecting in ${Math.round(delay / 1000)} s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  checkSilence() {
    if (this.socket && this.now() - this.lastMessageAt > SILENCE_MS) {
      logger.warn('Tempest cloud silent for 3 minutes, reconnecting');
      const socket = this.socket;
      this.socket = null;
      this.connected = false;
      socket.close();
      this.scheduleReconnect();
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdog);
    this.reconnectTimer = null;
    this.watchdog = null;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    socket?.close();
  }
}
