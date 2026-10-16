// -----------------------------------------------------------------------------
// The engine: every message of every channel goes through here.
//
// The LAN listener and the cloud WebSocket hand it the same Tempest messages
// (src/tempest/protocol.js). It keeps the state of each station, publishes
// the device states and fires the scene triggers. Both channels may run at
// the same time (one taking over from the other): an observation or an event
// is processed once, by its timestamp, whichever channel brings it first.
//
// The rolling values the hub does not send are computed here: the rain of the
// last hour and of the day, the lightning strikes of the last hour, whether
// it is raining.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import {
  MESSAGE_TYPES,
  PRECIPITATION_TYPES,
  batteryPercent,
  decodeMessage,
  dewPoint,
  feelsLike,
  parseObservation,
  parseRainStart,
  parseStrike,
  seaLevelPressure,
} from './protocol.js';
import { normalizeSerial } from './stations.js';
import {
  FEATURE,
  SCENE_TRIGGERS,
  buildStates,
  featureExternalId,
  stationIds,
} from '../devices/tempest.js';
import * as units from '../units.js';
import { localize, pick } from '../i18n.js';

const logger = createLogger({ name: 'engine' });

export const SOURCES = { LOCAL: 'local', CLOUD: 'cloud' };

const MINUTE_MS = 60 * 1000;
const HOUR_S = 60 * 60;

// A station sends an observation every minute and a wind reading every 3 s:
// three minutes of silence on a channel means the channel is down.
export const FRESHNESS_MS = 3 * MINUTE_MS;
// Ten minutes without any message: the station is reported unreachable.
export const UNREACHABLE_AFTER_MS = 10 * MINUTE_MS;
// It has stopped raining after ten dry minutes.
const RAIN_STOP_MS = 10 * MINUTE_MS;
// A storm sends strikes by the dozen: one `lightning_detected` event a minute
// per station at most, so a scene sending a notification does not flood.
const STRIKE_EVENT_GAP_MS = MINUTE_MS;
// An unchanged value is published again after 30 minutes, so the Gladys
// history and the "last seen" of the device stay alive on a calm day.
const HEARTBEAT_MS = 30 * MINUTE_MS;

/**
 * 'YYYY-MM-DD' of an instant, in a time zone ('' = the container's).
 * @param {number} epochSeconds
 * @param {string} [timeZone]
 */
export function dayKey(epochSeconds, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSeconds * 1000));
}

/**
 * @param {object} options
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
 * @param {ReturnType<import('./stations.js').createStationRegistry>} options.registry
 * @param {() => object} options.getConfig the current normalized config
 * @param {() => number} [options.now]
 * @param {(station: object) => void} [options.onNewStation] a station heard for the first time
 * @param {(station: object) => void} [options.onObservation] an observation was published
 */
export function createEngine({
  gladys,
  registry,
  getConfig,
  now = () => Date.now(),
  onNewStation = () => {},
  onObservation = () => {},
}) {
  /** Live, in-memory state per serial (the registry keeps what must survive a restart). */
  const live = new Map();
  // Events already processed, by "<serial>:<type>:<epoch>", bounded.
  const processedEvents = new Set();

  function liveState(serial) {
    let state = live.get(serial);
    if (!state) {
      state = {
        lastEpoch: 0,
        observation: null,
        observedAt: 0,
        source: null,
        seen: { [SOURCES.LOCAL]: 0, [SOURCES.CLOUD]: 0 },
        raining: null,
        reachable: null,
        lastStrikeEventAt: 0,
      };
      live.set(serial, state);
    }
    return state;
  }

  function firstTime(key) {
    if (processedEvents.has(key)) {
      return false;
    }
    processedEvents.add(key);
    if (processedEvents.size > 500) {
      processedEvents.delete(processedEvents.values().next().value);
    }
    return true;
  }

  function timezoneOf(station) {
    return getConfig().timezone || station.timezone || '';
  }

  function elevationOf(station) {
    return getConfig().elevation ?? station.elevation ?? null;
  }

  // Rolling windows, kept on the station record: [[epoch, value], ...], only
  // the non-zero minutes of the last hour.
  function pushWindow(station, field, epoch, value) {
    const since = epoch - HOUR_S;
    const kept = (station[field] ?? []).filter(([at]) => at > since && at !== epoch);
    if (value > 0) {
      kept.push([epoch, value]);
    }
    station[field] = kept;
  }

  function sumWindow(station, field, atEpoch) {
    const since = atEpoch - HOUR_S;
    return (station[field] ?? [])
      .filter(([at]) => at > since && at <= atEpoch)
      .reduce((sum, [, value]) => sum + value, 0);
  }

  // Last minute it rained, from the observations (rain measured or
  // precipitation typed) and from the hub's own "rain started" event.
  function lastRainEpoch(station) {
    return Math.max(station.lastWetEpoch ?? 0, station.rainStartEpoch ?? 0);
  }

  /** The station's values right now, metric, derived values included. */
  function snapshot(serial) {
    const station = registry.get(serial);
    if (!station) {
      return null;
    }
    const state = liveState(station.serial);
    const obs = state.observation;
    const nowEpoch = Math.floor(now() / 1000);
    const today = dayKey(nowEpoch, timezoneOf(station));
    return {
      serial: station.serial,
      observedAt: state.observedAt || null,
      source: state.source,
      temperature: obs?.temperature ?? null,
      humidity: obs?.humidity ?? null,
      feelsLike: obs ? feelsLike(obs.temperature, obs.humidity, obs.windAvg) : null,
      dewPoint: obs ? dewPoint(obs.temperature, obs.humidity) : null,
      pressure: obs?.pressure ?? null,
      seaLevelPressure: obs ? seaLevelPressure(obs.pressure, elevationOf(station)) : null,
      windLull: obs?.windLull ?? null,
      windAvg: obs?.windAvg ?? null,
      windGust: obs?.windGust ?? null,
      windDirection: obs?.windDirection ?? null,
      illuminance: obs?.illuminance ?? null,
      uv: obs?.uv ?? null,
      solarRadiation: obs?.solarRadiation ?? null,
      rainLastHour: obs ? sumWindow(station, 'recentRain', nowEpoch) : null,
      rainToday: station.rainDay?.day === today ? station.rainDay.mm : obs ? 0 : null,
      raining: state.raining,
      strikesLastHour: obs ? sumWindow(station, 'recentStrikes', nowEpoch) : null,
      lastStrike: station.lastStrike ?? null,
      batteryVolts: obs?.battery ?? null,
      batteryPercent: obs ? batteryPercent(obs.battery) : null,
    };
  }

  async function publishStation(station) {
    const states = buildStates(gladys, station, snapshot(station.serial), getConfig());
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    }
  }

  /** Raining or not, at a given instant; fires `rain_started` on the dry -> wet edge. */
  async function updateRaining(station, atEpoch) {
    const state = liveState(station.serial);
    const lastRain = lastRainEpoch(station);
    const raining = lastRain > 0 && (atEpoch - lastRain) * 1000 < RAIN_STOP_MS;
    if (raining === state.raining) {
      return;
    }
    const wasDry = state.raining === false;
    state.raining = raining;
    await gladys.publishState(featureExternalId(gladys, station, FEATURE.RAINING), raining ? 1 : 0);
    // Only a real transition: the first reading after a start is a state, not
    // the beginning of a shower.
    if (raining && wasDry) {
      logger.info(`${station.serial}: rain started`);
      await gladys.publishSceneEvent(SCENE_TRIGGERS.RAIN_STARTED, {
        device: stationIds(gladys, station).device,
        rain_today: units.round(snapshot(station.serial).rainToday ?? 0, 2),
      });
    }
  }

  async function handleObservation(station, obs, source) {
    const state = liveState(station.serial);
    if (obs.epoch === null || obs.epoch <= state.lastEpoch) {
      return; // already brought by the other channel, or replayed
    }
    state.lastEpoch = obs.epoch;
    state.observation = obs;
    state.observedAt = obs.epoch * 1000;
    state.source = source;

    // Rain of the day: the cloud sends the station's own count, the hub only
    // the rain of the minute, added up here since local midnight.
    const day = dayKey(obs.epoch, timezoneOf(station));
    if (station.rainDay?.day !== day) {
      station.rainDay = { day, mm: 0 };
    }
    const rainMinute = obs.rainMinute ?? 0;
    if (obs.rainDay !== null) {
      station.rainDay.mm = obs.rainDay;
    } else {
      station.rainDay.mm = units.round(station.rainDay.mm + rainMinute, 3);
    }
    const precipitating =
      rainMinute > 0 ||
      (obs.precipitationType !== null && obs.precipitationType !== PRECIPITATION_TYPES.NONE);
    if (precipitating) {
      station.lastWetEpoch = obs.epoch;
    }
    pushWindow(station, 'recentRain', obs.epoch, rainMinute);
    pushWindow(station, 'recentStrikes', obs.epoch, obs.strikeCount ?? 0);
    // A strike missed by the event channel (a gap between two LAN captures)
    // still shows in the minute's count, with its average distance.
    if (obs.strikeCount > 0 && obs.strikeDistance !== null) {
      if ((station.lastStrike?.epoch ?? 0) < obs.epoch - 60) {
        station.lastStrike = { epoch: obs.epoch, distance: obs.strikeDistance, energy: null };
      }
    }
    registry.save();

    await updateRaining(station, obs.epoch);
    await publishStation(station);
    onObservation(station);
  }

  async function handleStrike(station, strike) {
    if (strike.epoch === null || !firstTime(`${station.serial}:strike:${strike.epoch}`)) {
      return;
    }
    if ((station.lastStrike?.epoch ?? 0) <= strike.epoch) {
      station.lastStrike = strike;
      registry.save();
    }
    const config = getConfig();
    const distance = units.distance(strike.distance, config);
    if (distance !== null) {
      await gladys.publishChangedStates([
        {
          device_feature_external_id: featureExternalId(
            gladys,
            station,
            FEATURE.LIGHTNING_DISTANCE,
          ),
          state: distance,
        },
      ]);
    }
    const state = liveState(station.serial);
    if (now() - state.lastStrikeEventAt < STRIKE_EVENT_GAP_MS) {
      return;
    }
    state.lastStrikeEventAt = now();
    logger.info(`${station.serial}: lightning at ${strike.distance} km`);
    await gladys.publishSceneEvent(SCENE_TRIGGERS.LIGHTNING_DETECTED, {
      device: stationIds(gladys, station).device,
      distance,
      energy: strike.energy,
      strikes_last_hour: sumWindow(station, 'recentStrikes', Math.floor(now() / 1000)),
    });
  }

  async function handleRainStart(station, evt) {
    if (evt.epoch === null || !firstTime(`${station.serial}:rain:${evt.epoch}`)) {
      return;
    }
    station.rainStartEpoch = Math.max(station.rainStartEpoch ?? 0, evt.epoch);
    registry.save();
    await updateRaining(station, Math.max(evt.epoch, Math.floor(now() / 1000)));
  }

  /** The station a message is about, registering a station heard for the first time. */
  function resolveStation(message, source) {
    if (message.serial_number !== undefined) {
      const serial = normalizeSerial(message.serial_number);
      if (!serial) {
        return null; // the hub's own status, an Air or a Sky
      }
      const result = registry.upsert({ serial, hubSerial: message.hub_sn });
      if (result.added) {
        logger.info(`New station heard on the ${source} channel: ${serial}`);
        onNewStation(result.station);
      }
      return result.station;
    }
    if (message.device_id !== undefined) {
      return registry.byDeviceId(message.device_id);
    }
    return null;
  }

  /**
   * Process one message from one channel.
   * @param {string | object} raw
   * @param {'local' | 'cloud'} source
   */
  async function handleMessage(raw, source) {
    const message = decodeMessage(raw);
    if (!message) {
      return;
    }
    const station = resolveStation(message, source);
    if (!station) {
      return;
    }
    const state = liveState(station.serial);
    state.seen[source] = now();
    state.reachable = true;

    switch (message.type) {
      case MESSAGE_TYPES.OBSERVATION:
        for (const row of Array.isArray(message.obs) ? message.obs : []) {
          await handleObservation(station, parseObservation(row), source);
        }
        break;
      case MESSAGE_TYPES.LIGHTNING_STRIKE:
        await handleStrike(station, parseStrike(message.evt));
        break;
      case MESSAGE_TYPES.RAIN_START:
        await handleRainStart(station, parseRainStart(message.evt));
        break;
      default:
        // rapid_wind, device_status...: proof of life only.
        break;
    }
  }

  /** Last time a channel brought anything, for any station. */
  function lastSeen(source) {
    return Math.max(0, ...[...live.values()].map((state) => state.seen[source]));
  }

  /**
   * The transport badge of a station: which channel its data comes from, and
   * whether that is the one the user prefers.
   */
  function transport(serial, config) {
    const state = liveState(normalizeSerial(serial));
    const fresh = (source) => now() - state.seen[source] < FRESHNESS_MS;
    const preferLocal = config.GLADYS_PREFER_LOCAL;
    if (fresh(SOURCES.LOCAL) && (preferLocal || !config.token || !fresh(SOURCES.CLOUD))) {
      if (!preferLocal && config.token) {
        return {
          transport: DEVICE_TRANSPORTS.LOCAL,
          degraded: true,
          message: localize((language) =>
            pick(language, {
              en: 'The cloud does not answer: the local network takes over.',
              fr: 'Le cloud ne répond pas : le réseau local prend le relais.',
              de: 'Die Cloud antwortet nicht: Das lokale Netzwerk übernimmt.',
              es: 'La nube no responde: la red local toma el relevo.',
            }),
          ),
        };
      }
      return { transport: DEVICE_TRANSPORTS.LOCAL };
    }
    if (fresh(SOURCES.CLOUD)) {
      if (preferLocal) {
        return {
          transport: DEVICE_TRANSPORTS.CLOUD,
          degraded: true,
          message: localize((language) =>
            pick(language, {
              en: 'Nothing heard from the hub on the local network: the cloud takes over.',
              fr: 'Rien reçu du hub sur le réseau local : le cloud prend le relais.',
              de: 'Nichts vom Hub im lokalen Netzwerk empfangen: Die Cloud übernimmt.',
              es: 'No se recibe nada del hub en la red local: la nube toma el relevo.',
            }),
          ),
        };
      }
      return { transport: DEVICE_TRANSPORTS.CLOUD };
    }
    return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
  }

  /**
   * Periodic housekeeping (every 30 s, from index.js): the end of a shower,
   * and the `station_unreachable` trigger when a station falls silent.
   */
  async function tick() {
    for (const station of registry.list()) {
      const state = liveState(station.serial);
      if (state.observation) {
        await updateRaining(station, Math.floor(now() / 1000));
      }
      const lastHeard = Math.max(state.seen[SOURCES.LOCAL], state.seen[SOURCES.CLOUD]);
      if (state.reachable && now() - lastHeard >= UNREACHABLE_AFTER_MS) {
        state.reachable = false;
        logger.warn(`${station.serial}: nothing heard for ${UNREACHABLE_AFTER_MS / MINUTE_MS} min`);
        await gladys.publishSceneEvent(SCENE_TRIGGERS.STATION_UNREACHABLE, {
          device: stationIds(gladys, station).device,
        });
      }
    }
  }

  /** Publish every station's states again (the units changed). */
  async function republish() {
    for (const station of registry.list()) {
      if (liveState(station.serial).observation) {
        await publishStation(station);
      }
    }
  }

  return { handleMessage, snapshot, transport, lastSeen, tick, republish };
}
