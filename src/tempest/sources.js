// -----------------------------------------------------------------------------
// Which channel runs: the local network, the cloud, or both for a while.
//
// The user picks a preference with the standard "Prefer the local connection"
// toggle of Gladys (reserved config key GLADYS_PREFER_LOCAL):
//
//   - local preferred (default): the LAN listener runs; the cloud WebSocket
//     only starts when the LAN has been silent for a while and a token is set,
//     and stops as soon as the hub is heard again;
//   - cloud preferred: the reverse;
//   - no token: the LAN only, whatever the preference.
//
// The engine processes each observation once, whichever channel brings it,
// so the overlap while one channel takes over is harmless.
//
// This module also owns what the user sees of it: the per-station transport
// badge and the connection status of the Configuration screen.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import {
  CloudListener,
  TempestApiError,
  fetchLatestObservation,
  fetchStations as fetchCloudStations,
} from './cloud.js';
import { LocalListener, captureOnce } from './local.js';
import { FRESHNESS_MS, SOURCES } from './engine.js';
import { stationIds } from '../devices/tempest.js';
import { localize, pick } from '../i18n.js';

const logger = createLogger({ name: 'sources' });

// A channel just started gets this long to prove itself before the other one
// is called in (the hub sends a wind reading every 3 s, the cloud an
// observation every minute).
export const GRACE_MS = 2 * 60 * 1000;

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {ReturnType<import('./engine.js').createEngine>} options.engine
 * @param {ReturnType<import('./stations.js').createStationRegistry>} options.registry
 * @param {(stations: object[]) => void | Promise<void>} [options.onStationsChanged]
 * @param {() => number} [options.now]
 * @param {(onMessage) => LocalListener} [options.createLocal]
 * @param {(token, deviceIds, onMessage) => CloudListener} [options.createCloud]
 * @param {typeof fetchCloudStations} [options.fetchStations]
 * @param {typeof fetchLatestObservation} [options.fetchObservation]
 * @param {typeof captureOnce} [options.capture]
 */
export function createSourceManager({
  gladys,
  engine,
  registry,
  onStationsChanged = () => {},
  now = () => Date.now(),
  createLocal = (onMessage) => new LocalListener({ gladys, onMessage }),
  createCloud = (token, deviceIds, onMessage) => new CloudListener({ token, deviceIds, onMessage }),
  fetchStations = fetchCloudStations,
  fetchObservation = fetchLatestObservation,
  capture = captureOnce,
}) {
  let config = null;
  let local = null;
  let localStartedAt = 0;
  let cloud = null;
  let cloudStartedAt = 0;
  let cloudKey = '';
  let cloudError = null;
  let stationsFetchedFor = null;
  let startedAt = now();
  let lastTransports = '';
  let lastStatus = '';

  const fromLocal = (message) => engine.handleMessage(message, SOURCES.LOCAL);
  const fromCloud = (message) => engine.handleMessage(message, SOURCES.CLOUD);

  const healthy = (source, channelStartedAt) =>
    now() - channelStartedAt < GRACE_MS || now() - engine.lastSeen(source) < FRESHNESS_MS;

  /**
   * Ask the cloud for the stations of the account and remember them.
   * @returns {Promise<object[]>} the Tempest stations of the account
   */
  async function refreshStations() {
    const stations = await fetchStations(config.token);
    let changed = false;
    for (const station of stations) {
      changed = registry.upsert(station)?.changed || changed;
    }
    stationsFetchedFor = config.token;
    cloudError = null;
    if (changed) {
      await onStationsChanged(registry.list());
    }
    return stations;
  }

  function cloudDeviceIds() {
    return registry
      .list()
      .map((station) => station.deviceId)
      .filter((id) => id !== undefined);
  }

  function startLocal() {
    if (!local) {
      local = createLocal(fromLocal);
      localStartedAt = now();
      local.start();
    }
  }

  function stopLocal() {
    local?.stop();
    local = null;
  }

  function startCloud() {
    const deviceIds = cloudDeviceIds();
    const key = `${config.token}|${deviceIds.join(',')}`;
    if (cloud && key === cloudKey) {
      return;
    }
    stopCloud();
    if (deviceIds.length === 0) {
      return;
    }
    cloudKey = key;
    cloud = createCloud(config.token, deviceIds, fromCloud);
    cloudStartedAt = now();
    cloud.start();
  }

  function stopCloud() {
    cloud?.stop();
    cloud = null;
    cloudKey = '';
  }

  /**
   * (Re)decide which channels run, for a config (on connection, on a config
   * change) or the current one (every tick).
   */
  async function apply(newConfig = config) {
    if (newConfig !== config) {
      config = newConfig;
      startedAt = now();
    }
    const hasToken = Boolean(config.token);
    if (!hasToken) {
      // A refusal of a token since removed is no longer news.
      cloudError = null;
      stationsFetchedFor = null;
    }

    if (hasToken && stationsFetchedFor !== config.token) {
      try {
        await refreshStations();
      } catch (err) {
        cloudError = err;
        logger.error(`Could not list the Tempest stations: ${err.message}`);
      }
    }

    const preferLocal = config.GLADYS_PREFER_LOCAL;
    const tokenRefused = cloudError instanceof TempestApiError && cloudError.unauthorized;
    // The cloud can only stream the devices it listed.
    const cloudUsable = hasToken && !tokenRefused && cloudDeviceIds().length > 0;
    // A channel is "down" once it has run past its grace time with nothing heard.
    const localDown = local !== null && !healthy(SOURCES.LOCAL, localStartedAt);
    const cloudDown = cloud !== null && !healthy(SOURCES.CLOUD, cloudStartedAt);

    const wantLocal = !cloudUsable || preferLocal || cloudDown;
    const wantCloud = cloudUsable && (!preferLocal || localDown);

    if (wantLocal) {
      startLocal();
    } else if (local) {
      logger.info('The cloud is preferred and answers: stopping the local capture');
      stopLocal();
    }
    if (wantCloud) {
      startCloud();
    } else if (cloud) {
      logger.info('Back to the local network: closing the cloud connection');
      stopCloud();
    }
  }

  /** Every station's badge, published only when one changed. */
  async function publishTransports(force = false) {
    const entries = registry.list().map((station) => ({
      external_id: stationIds(gladys, station).device,
      ...engine.transport(station.serial, config),
    }));
    const serialized = JSON.stringify(entries);
    if (entries.length > 0 && (force || serialized !== lastTransports)) {
      lastTransports = serialized;
      await gladys.publishTransports(entries);
    }
  }

  /** What the Configuration screen says about the connection. */
  function connectionStatus() {
    if (cloudError instanceof TempestApiError && cloudError.unauthorized) {
      return {
        connected: false,
        message: localize((language) =>
          pick(language, {
            en: 'The Tempest cloud refuses the token: create a new one on tempestwx.com.',
            fr: 'Le cloud Tempest refuse le jeton : créez-en un nouveau sur tempestwx.com.',
            de: 'Die Tempest-Cloud lehnt das Token ab: Erstelle ein neues auf tempestwx.com.',
            es: 'La nube Tempest rechaza el token: cree uno nuevo en tempestwx.com.',
          }),
        ),
      };
    }
    if (now() - startedAt < GRACE_MS) {
      return { connected: true };
    }
    const stations = registry.list();
    if (stations.length === 0) {
      return {
        connected: false,
        message: localize((language) =>
          pick(language, {
            en: 'No Tempest found: no hub heard on the local network, and no token to ask the cloud.',
            fr: 'Aucune Tempest trouvée : aucun hub entendu sur le réseau local, et pas de jeton pour interroger le cloud.',
            de: 'Keine Tempest gefunden: Kein Hub im lokalen Netzwerk gehört und kein Token für die Cloud.',
            es: 'No se encontró ninguna Tempest: ningún hub en la red local y ningún token para la nube.',
          }),
        ),
      };
    }
    const unreachable = stations.filter(
      (station) =>
        engine.transport(station.serial, config).transport === DEVICE_TRANSPORTS.UNREACHABLE,
    );
    if (unreachable.length === stations.length) {
      return {
        connected: false,
        message: localize((language) =>
          pick(language, {
            en: 'No data from the station for a few minutes: check the hub, its Wi-Fi and the token.',
            fr: 'Aucune donnée de la station depuis quelques minutes : vérifiez le hub, son Wi-Fi et le jeton.',
            de: 'Seit einigen Minuten keine Daten von der Station: Prüfe den Hub, sein WLAN und das Token.',
            es: 'Sin datos de la estación desde hace unos minutos: compruebe el hub, su Wi-Fi y el token.',
          }),
        ),
      };
    }
    return { connected: true };
  }

  async function publishConnectionStatus(force = false) {
    const status = connectionStatus();
    const serialized = JSON.stringify(status);
    if (force || serialized !== lastStatus) {
      lastStatus = serialized;
      await gladys.setConnectionStatus(status.connected, status.message);
    }
  }

  /** Every 30 s: the end of a shower, a silent channel, the badges, the status. */
  async function tick() {
    await engine.tick();
    await apply();
    await publishTransports();
    await publishConnectionStatus();
  }

  /**
   * Fetch the latest observation of the stations from the cloud now (the
   * widget's Refresh button). Resolves the number of stations refreshed.
   */
  async function refreshFromCloud(serials) {
    if (!config.token) {
      return 0;
    }
    let refreshed = 0;
    for (const station of registry.list()) {
      if (station.deviceId === undefined || (serials && !serials.includes(station.serial))) {
        continue;
      }
      const message = await fetchObservation(config.token, station.deviceId);
      if (message) {
        await fromCloud(message);
        refreshed += 1;
      }
    }
    return refreshed;
  }

  /**
   * Find the stations for the Discovery tab: the account's ones from the
   * cloud, and the ones heard on the LAN in a short capture (skipped while
   * the LAN listener already runs: it registers every station it hears).
   */
  async function discover() {
    if (config.token) {
      try {
        await refreshStations();
      } catch (err) {
        cloudError = err;
        logger.error(`Could not list the Tempest stations: ${err.message}`);
      }
    }
    if (!local) {
      try {
        for (const { message } of await capture(gladys, 10)) {
          await fromLocal(message);
        }
      } catch (err) {
        logger.warn(`LAN capture for the discovery failed: ${err.message}`);
      }
    }
    return registry.list();
  }

  /** Both channels, tested now: the answer of the "Test the connection" button. */
  async function testConnection() {
    const lines = [];

    let heard = [];
    let localFailure = null;
    if (local && now() - engine.lastSeen(SOURCES.LOCAL) < FRESHNESS_MS) {
      heard = registry
        .list()
        .filter(
          (station) =>
            engine.transport(station.serial, config).transport === DEVICE_TRANSPORTS.LOCAL,
        )
        .map((station) => station.serial);
      heard = heard.length ? heard : ['hub'];
    } else {
      try {
        const messages = await capture(gladys, 15);
        for (const { message } of messages) {
          await fromLocal(message);
        }
        heard = [
          ...new Set(
            messages
              .map(({ message }) => message.serial_number)
              .filter((s) => /^ST-/i.test(s ?? '')),
          ),
        ];
        if (heard.length === 0 && messages.length > 0) {
          heard = ['hub'];
        }
      } catch (err) {
        localFailure = err;
      }
    }
    lines.push((language) => {
      if (localFailure) {
        return pick(language, {
          en: `Local network: capture impossible (${localFailure.message}).`,
          fr: `Réseau local : écoute impossible (${localFailure.message}).`,
          de: `Lokales Netzwerk: Abhören unmöglich (${localFailure.message}).`,
          es: `Red local: escucha imposible (${localFailure.message}).`,
        });
      }
      if (heard.length === 0) {
        return pick(language, {
          en: 'Local network: nothing heard from a Tempest hub.',
          fr: "Réseau local : rien reçu d'un hub Tempest.",
          de: 'Lokales Netzwerk: Nichts von einem Tempest-Hub empfangen.',
          es: 'Red local: no se recibe nada de un hub Tempest.',
        });
      }
      return pick(language, {
        en: `Local network: OK (${heard.join(', ')}).`,
        fr: `Réseau local : OK (${heard.join(', ')}).`,
        de: `Lokales Netzwerk: OK (${heard.join(', ')}).`,
        es: `Red local: OK (${heard.join(', ')}).`,
      });
    });

    if (!config.token) {
      lines.push((language) =>
        pick(language, {
          en: 'Cloud: no token given.',
          fr: 'Cloud : aucun jeton saisi.',
          de: 'Cloud: kein Token angegeben.',
          es: 'Nube: ningún token indicado.',
        }),
      );
    } else {
      try {
        const stations = await refreshStations();
        const names = stations.map((s) => s.name ?? s.serial).join(', ') || '-';
        lines.push((language) =>
          pick(language, {
            en: `Cloud: OK, ${stations.length} Tempest (${names}).`,
            fr: `Cloud : OK, ${stations.length} Tempest (${names}).`,
            de: `Cloud: OK, ${stations.length} Tempest (${names}).`,
            es: `Nube: OK, ${stations.length} Tempest (${names}).`,
          }),
        );
        await apply();
      } catch (err) {
        cloudError = err;
        const refused = err instanceof TempestApiError && err.unauthorized;
        lines.push((language) =>
          refused
            ? pick(language, {
                en: 'Cloud: the token is refused.',
                fr: 'Cloud : le jeton est refusé.',
                de: 'Cloud: Das Token wird abgelehnt.',
                es: 'Nube: el token es rechazado.',
              })
            : pick(language, {
                en: `Cloud: unreachable (${err.message}).`,
                fr: `Cloud : injoignable (${err.message}).`,
                de: `Cloud: nicht erreichbar (${err.message}).`,
                es: `Nube: inaccesible (${err.message}).`,
              }),
        );
      }
    }
    await publishConnectionStatus();
    return localize((language) => lines.map((line) => line(language)).join(' '));
  }

  function status() {
    return {
      local: local ? { running: true, lastError: local.lastError, hubIp: local.hubIp } : null,
      cloud: cloud
        ? { running: true, connected: cloud.connected, lastError: cloud.lastError }
        : null,
    };
  }

  function stop() {
    stopLocal();
    stopCloud();
  }

  return {
    apply,
    tick,
    discover,
    refreshStations,
    refreshFromCloud,
    publishTransports,
    publishConnectionStatus,
    testConnection,
    status,
    stop,
    get config() {
      return config;
    },
  };
}
