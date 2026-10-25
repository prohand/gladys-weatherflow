# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors
when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **WeatherFlow Tempest** weather
stations. It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

Two channels bring the same Tempest messages (`obs_st`, `evt_strike`, `evt_precip`,
`rapid_wind`...):

- **local**: the hub broadcasts JSON in UDP on port 50222. The container sits on a bridge
  network broadcasts never reach, so the **Gladys core captures them** (manifest
  `network_discovery`, `gladys.scanNetwork('udp-broadcast')`, 30 s per capture, chained);
- **cloud**: REST (`swd.weatherflow.com/swd/rest`) + WebSocket (`ws.weatherflow.com`) with a
  personal access token.

Manifest `transports: ["local", "cloud"]`: Gladys shows the "Prefer the local connection"
toggle, read as `GLADYS_PREFER_LOCAL`. Requires Gladys 5.3+ (catalog `keywords`). Gladys 5.1+ capabilities: scene triggers (rain started,
lightning detected, station unreachable), scene actions (read the station, get the forecast)
and the `tempest_station` widget.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/engine.test.js             # one file
node --test --test-name-pattern "rain"      # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `test` on Node 22 and 24, and on
pull requests the store checks and a Docker build. Releases: **Actions → Release** only (bumps
`package.json`, manifest `version` + `docker_image`, rolls `CHANGELOG.md`, re-runs Prettier,
tags, builds the multi-arch image, publishes the GitHub Release).

## Architecture

```
index.js                  SDK wiring only: handlers registered before connect(), 30 s tick
src/config.js             DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js               LANGUAGES (en, fr, de, es), pick(), localize()
src/units.js              metric -> configured units (temperature, wind, distance)
src/tempest/protocol.js   message decoding, obs_st indexes, dew point, feels like, sea-level pressure
src/tempest/stations.js   known stations + rolling counters, persisted in /data/stations.json
src/tempest/engine.js     every message goes through here: dedup, states, rain/lightning, triggers, badge
src/tempest/local.js      LAN listener (chained core captures)
src/tempest/cloud.js      REST client + WebSocket listener (reconnect, silence watchdog)
src/tempest/sources.js    which channel runs (preference, fallback), transports, connection status, test
src/devices/tempest.js    the Gladys device: features, states
src/scenes.js             scene actions (manifest `scene_actions`)
src/widgets.js            dashboard widget (manifest `widgets`)
docs/{en,fr,de,es}.md     user documentation, re-hosted by Gladys
```

### Invariants worth knowing

- **External ids are forever.** A device is `gladys.externalIds('tempest', serial)` with the
  lowercased serial (`st-00012345`), never the station name. Feature keys, trigger, action,
  widget and config keys are stored by users: never rename them.
- **One observation, processed once.** Both channels can run together while one takes over;
  the engine drops an `obs_st` whose epoch is not newer, and events already seen
  (`<serial>:<type>:<epoch>`).
- **The hub sends no daily rain.** `rain_today` is summed locally from the minute rain since
  local midnight (config time zone, else the station's, else the container's); a cloud
  observation carries the station's own count (index 18) and replaces the sum.
- **Events, not states.** `rain_started` fires on the dry -> wet edge only (not at startup);
  `lightning_detected` at most once a minute per station; `station_unreachable` once per
  silence. State values (raining, distance...) are device features.
- **Polling is not used**: the station pushes every minute. Never publish a `poll_frequency`.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- **SDK request timeout** is raised to 45 s in `index.js`: a LAN capture is one 30 s HTTP call.
- **The token is a secret**: Authorization header for REST, query string only for the
  WebSocket URL, which is never logged.
- **The container rootfs is read-only.** Write only under `/data`.

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or in
  the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading: the Release workflow moves the section.
- **Manifest.** Every text is `{ en, fr, de, es }` (labels, descriptions, placeholders,
  options); `test/manifest.test.js` checks it, plus the store length limits and the links
  between the manifest and the code (handlers, defaults, options), and the Gladys 5.3 store
  rules: `gladys_version >=5.3.0` for `keywords` (1-10, 2-30 characters), `categories` in the
  store vocabulary, no `countries` (Tempest is worldwide).
- **User-facing text** is written in the four languages (`src/i18n.js`): action answers,
  connection status, transport badges, widget texts, and `docs/*.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
  Tests never touch the network: they use the SDK's fake Gladys
  (`@gladysassistant/integration-sdk/testing`), a fake `fetch` and a fake WebSocket
  (`test/helpers/tempest.js` builds the Tempest messages).
