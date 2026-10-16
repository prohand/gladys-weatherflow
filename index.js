// -----------------------------------------------------------------------------
// Entry point of the WeatherFlow Tempest integration for Gladys.
//
// This file only wires the SDK to the modules: it holds no Tempest logic.
//   1. instantiates the SDK (connection, auth, reconnection: handled by it);
//   2. registers the handlers BEFORE connect();
//   3. on every (re)connection: reads the config, publishes the stations,
//      starts the channels (LAN and/or cloud) and the 30-second tick.
//
// The data path, for reference:
//   LAN (UDP 50222, captured by the Gladys core) ─┐
//                                                  ├─> engine ─> device states
//   cloud WebSocket (tempestwx.com token) ────────┘          └─> scene triggers
//
// Environment variables provided by the Gladys supervisor to the container:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { buildDevice } from './src/devices/tempest.js';
import { createEngine } from './src/tempest/engine.js';
import { CAPTURE_SECONDS } from './src/tempest/local.js';
import { createSourceManager } from './src/tempest/sources.js';
import { createStationRegistry } from './src/tempest/stations.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { WIDGETS, refreshWidgets } from './src/widgets.js';

// A LAN capture lasts up to 30 s and is one HTTP call to the core: the request
// timeout of the SDK (15 s by default) must outlast it.
const gladys = new GladysIntegration({ requestTimeout: (CAPTURE_SECONDS + 15) * 1000 });

const TICK_MS = 30 * 1000;

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();
let tickTimer = null;

const registry = createStationRegistry();
registry.load();

const engine = createEngine({
  gladys,
  registry,
  getConfig: () => config,
  // A station heard for the first time on the LAN: offer it in Discovery.
  onNewStation: () => publishDevices().catch((err) => logger.error('Publication failed', err)),
  // The widget's computed rows follow the observations.
  onObservation: () => refreshWidgets(gladys),
});

const sources = createSourceManager({
  gladys,
  engine,
  registry,
  onStationsChanged: () => publishDevices(),
});

// Shared by the scene actions and the widget.
const context = () => ({ config, engine, registry, sources });

async function publishDevices() {
  await gladys.publishDiscoveredDevices(
    registry.list().map((station) => buildDevice(gladys, station, config)),
  );
}

// --- Discovery: the user opens the Discovery tab -----------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> looking for Tempest stations');
  await sources.discover();
  await publishDevices();
});

// --- Configuration screen button ---------------------------------------------
// The ack is awaited under the action's `timeout_seconds` (manifest).
gladys.onAction('test_connection', () => {
  logger.info('Action test_connection');
  return sources.testConnection();
});

// --- Scene actions (Gladys 5.1+) -----------------------------------------------
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(gladys, { fields, ...context() }));
}

// --- Dashboard widgets (Gladys 5.1+) -------------------------------------------
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, { ...request, ...context() }));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
    widget.action(gladys, { actionKey, params, settings, ...context() }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // The units are part of the features: publish the devices, then the values
  // in the new units.
  await publishDevices();
  await sources.apply(config);
  await engine.republish();
  await sources.publishTransports(true);
  await sources.publishConnectionStatus(true);
  refreshWidgets(gladys);
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    // The remembered stations first; the cloud's ones are published by
    // onStationsChanged when apply() lists them.
    await publishDevices();
    await sources.apply(config);
    await sources.publishTransports(true);
    await sources.publishConnectionStatus(true);
    refreshWidgets(gladys);
    startTick();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Logs der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  stopAll();
});

function startTick() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    sources.tick().catch((err) => logger.error('Tick failed', err));
  }, TICK_MS);
}

function stopAll() {
  clearInterval(tickTimer);
  tickTimer = null;
  sources.stop();
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopAll();
  registry.save();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the WeatherFlow Tempest integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
