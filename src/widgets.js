// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+).
//
// `tempest_station` puts a whole station on one card: five live tiles bound to
// the device features (they follow the published states, nothing to
// refresh), the temperature of the last 24 hours, and a status list of what
// no single feature carries (feels like, dew point, wind direction, last
// lightning, the channel in use...). Its Refresh button asks the cloud for
// the latest observation.
//
// The content is declarative: the core renders it with its own theme, dark
// mode and translations. Every text is a multi-language object.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_TRANSPORTS,
  WIDGET_CHART_INTERVALS,
  WIDGET_COLORS,
} from '@gladysassistant/integration-sdk';
import { FEATURE, featureExternalId, findStation } from './devices/tempest.js';
import { cardinal } from './tempest/protocol.js';
import * as units from './units.js';
import { localize, pick } from './i18n.js';

const logger = createLogger({ name: 'widgets' });

// Widget key, as declared in the manifest `widgets` field: never renamed.
export const STATION_WIDGET = 'tempest_station';

// Keys of the `button` actions the content declares.
const ACTIONS = { REFRESH: 'refresh' };

const TRANSPORT_STATUS = {
  [DEVICE_TRANSPORTS.LOCAL]: {
    value: { en: 'Local network', fr: 'Réseau local', de: 'Lokales Netzwerk', es: 'Red local' },
    color: WIDGET_COLORS.SUCCESS,
  },
  [DEVICE_TRANSPORTS.CLOUD]: {
    value: { en: 'Cloud', fr: 'Cloud', de: 'Cloud', es: 'Nube' },
    color: WIDGET_COLORS.INFO,
  },
  [DEVICE_TRANSPORTS.UNREACHABLE]: {
    value: { en: 'No data', fr: 'Aucune donnée', de: 'Keine Daten', es: 'Sin datos' },
    color: WIDGET_COLORS.DANGER,
  },
};

const fmt = (value, unit = '') => (value === null || value === undefined ? '-' : `${value}${unit}`);

/** "5 min ago" in every language. */
function ago(ms, nowMs) {
  const minutes = Math.max(0, Math.round((nowMs - ms) / 60000));
  if (minutes < 60) {
    return localize((language) =>
      pick(language, {
        en: `${minutes} min ago`,
        fr: `il y a ${minutes} min`,
        de: `vor ${minutes} Min.`,
        es: `hace ${minutes} min`,
      }),
    );
  }
  const hours = Math.round(minutes / 60);
  return localize((language) =>
    pick(language, {
      en: `${hours} h ago`,
      fr: `il y a ${hours} h`,
      de: `vor ${hours} Std.`,
      es: `hace ${hours} h`,
    }),
  );
}

function statusItems(snapshot, transport, config, nowMs) {
  const t = units.UNIT_SYMBOLS[config.temperature_unit];
  const w = units.UNIT_SYMBOLS[config.wind_unit];
  const d = units.UNIT_SYMBOLS[units.distanceUnit(config)];
  const strike = snapshot.lastStrike;
  const recentStrike = strike?.epoch && nowMs - strike.epoch * 1000 < 3 * 60 * 60 * 1000;
  const { value: transportValue, color: transportColor } = TRANSPORT_STATUS[transport.transport];

  return [
    {
      label: { en: 'Feels like', fr: 'Ressenti', de: 'Gefühlt', es: 'Sensación' },
      icon: 'thermometer',
      value: fmt(units.temperature(snapshot.feelsLike, config), ` ${t}`),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Dew point', fr: 'Point de rosée', de: 'Taupunkt', es: 'Punto de rocío' },
      icon: 'droplet',
      value: fmt(units.temperature(snapshot.dewPoint, config), ` ${t}`),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Pressure', fr: 'Pression', de: 'Luftdruck', es: 'Presión' },
      icon: 'activity',
      value: fmt(units.round(snapshot.seaLevelPressure ?? snapshot.pressure), ' hPa'),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Wind', fr: 'Vent', de: 'Wind', es: 'Viento' },
      icon: 'navigation',
      value:
        snapshot.windDirection === null
          ? '-'
          : localize(
              (language) =>
                `${cardinal(snapshot.windDirection)} ${Math.round(snapshot.windDirection)}°, ${pick(
                  language,
                  { en: 'gusts', fr: 'rafales', de: 'Böen', es: 'ráfagas' },
                )} ${fmt(units.wind(snapshot.windGust, config), ` ${w}`)}`,
            ),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Lightning', fr: 'Foudre', de: 'Blitze', es: 'Rayos' },
      icon: 'zap',
      value: recentStrike
        ? localize(
            (language) =>
              `${fmt(units.distance(strike.distance, config), ` ${d}`)}, ${ago(strike.epoch * 1000, nowMs)[language]}`,
          )
        : { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguno' },
      color: recentStrike ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Raining', fr: 'Il pleut', de: 'Regen', es: 'Lloviendo' },
      icon: 'cloud-rain',
      value: snapshot.raining
        ? { en: 'Yes', fr: 'Oui', de: 'Ja', es: 'Sí' }
        : { en: 'No', fr: 'Non', de: 'Nein', es: 'No' },
      color: snapshot.raining ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
      icon: 'battery',
      value:
        snapshot.batteryVolts === null
          ? '-'
          : `${snapshot.batteryPercent} % (${snapshot.batteryVolts.toFixed(2)} V)`,
      color:
        snapshot.batteryPercent !== null && snapshot.batteryPercent < 20
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
      icon: 'wifi',
      value: transportValue,
      color: transport.degraded ? WIDGET_COLORS.WARNING : transportColor,
    },
    {
      label: {
        en: 'Last observation',
        fr: 'Dernière mesure',
        de: 'Letzte Messung',
        es: 'Última medición',
      },
      icon: 'clock',
      value: snapshot.observedAt ? ago(snapshot.observedAt, nowMs) : '-',
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
}

/** The station the widget shows: the one chosen in its settings, or the first one. */
function widgetStation(gladys, registry, settings) {
  return (
    (settings?.station && findStation(gladys, registry, settings.station)) ??
    registry.list()[0] ??
    null
  );
}

export const WIDGETS = {
  [STATION_WIDGET]: {
    /**
     * @param {object} gladys
     * @param {{ settings, config, engine, registry, now? }} context
     */
    async get(gladys, { settings, config, engine, registry, now = Date.now }) {
      logger.debug(`onWidgetGet <- ${STATION_WIDGET}`);
      const station = widgetStation(gladys, registry, settings);
      if (!station) {
        return {
          ttl_seconds: 60,
          components: [
            {
              type: 'text',
              variant: 'body',
              text: {
                en: 'No Tempest yet: add the station from the Discovery tab of the integration.',
                fr: "Pas encore de Tempest : ajoutez la station depuis l'onglet Découverte de l'intégration.",
                de: 'Noch keine Tempest: Füge die Station im Tab „Erkennung“ der Integration hinzu.',
                es: 'Aún no hay Tempest: añada la estación desde la pestaña Descubrimiento de la integración.',
              },
            },
          ],
        };
      }
      const snapshot = engine.snapshot(station.serial);
      const transport = engine.transport(station.serial, config);
      const tile = (key, label, icon) => ({
        type: 'value',
        label,
        icon,
        device_feature: featureExternalId(gladys, station, key),
      });

      return {
        // The tiles and the chart are live; the status list is computed, and
        // index.js nudges the widget after every observation. The TTL is a
        // safety net.
        ttl_seconds: 120,
        components: [
          tile(
            FEATURE.TEMPERATURE,
            { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
            'thermometer',
          ),
          tile(
            FEATURE.HUMIDITY,
            { en: 'Humidity', fr: 'Humidité', de: 'Feuchte', es: 'Humedad' },
            'droplet',
          ),
          tile(FEATURE.WIND_SPEED, { en: 'Wind', fr: 'Vent', de: 'Wind', es: 'Viento' }, 'wind'),
          tile(
            FEATURE.RAIN_TODAY,
            { en: 'Rain today', fr: "Pluie aujourd'hui", de: 'Regen heute', es: 'Lluvia hoy' },
            'cloud-rain',
          ),
          tile(
            FEATURE.UV,
            { en: 'UV index', fr: 'Indice UV', de: 'UV-Index', es: 'Índice UV' },
            'sun',
          ),
          {
            type: 'chart',
            chart_type: 'line',
            title: {
              en: 'Temperature, last 24 h',
              fr: 'Température, dernières 24 h',
              de: 'Temperatur, letzte 24 Std.',
              es: 'Temperatura, últimas 24 h',
            },
            device_features: [featureExternalId(gladys, station, FEATURE.TEMPERATURE)],
            interval: WIDGET_CHART_INTERVALS.LAST_DAY,
          },
          { type: 'status', items: statusItems(snapshot, transport, config, now()) },
          // `params` are declared HERE and sent back as-is: the handler never
          // receives user input.
          ...(config.token && station.deviceId !== undefined
            ? [
                {
                  type: 'button',
                  label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
                  icon: 'refresh-cw',
                  style: 'secondary',
                  action: { key: ACTIONS.REFRESH, params: { serial: station.serial } },
                },
              ]
            : []),
        ],
      };
    },

    /** A tapped button: resolves the toast. */
    async action(gladys, { actionKey, params, sources }) {
      logger.info(`onWidgetAction <- ${STATION_WIDGET}.${actionKey}`);
      if (actionKey !== ACTIONS.REFRESH) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const refreshed = await sources.refreshFromCloud([params.serial]);
      return refreshed > 0
        ? {
            en: 'Latest observation fetched from the cloud.',
            fr: 'Dernière mesure récupérée depuis le cloud.',
            de: 'Letzte Messung aus der Cloud abgerufen.',
            es: 'Última medición obtenida de la nube.',
          }
        : {
            en: 'The cloud has no observation for this station.',
            fr: "Le cloud n'a aucune mesure pour cette station.",
            de: 'Die Cloud hat keine Messung für diese Station.',
            es: 'La nube no tiene ninguna medición para esta estación.',
          };
    },
  },
};

/**
 * Ask the core to re-pull every widget now: the computed status changed (an
 * observation, a configuration, a reconnection). Rate-limited core-side to 1
 * per 10 s per widget, dropped while disconnected.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
