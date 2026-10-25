# Gladys WeatherFlow Tempest

External integration for [Gladys Assistant](https://gladysassistant.com) that brings
**WeatherFlow Tempest** weather stations into Gladys, built on the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js) and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- **Local** (no account, no Internet): the Tempest hub broadcasts its data on the LAN (UDP
  50222); the Gladys core captures it for the integration.
- **Cloud** (optional personal access token): Tempest REST API + real-time WebSocket, station
  names, altitude, time zone and forecast.
- **Both**: the "Prefer the local connection" toggle picks the main channel, the other one
  takes over when it falls silent, and a badge per station shows which one is in use.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## Features

| Surface                     | Content                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Device (one per Tempest)    | temperature, humidity, station and sea-level pressure, wind speed / gust / direction, illuminance, UV index, rain of the last hour and of the day, raining, lightning strikes (last hour), last strike distance, battery |
| Scene triggers              | `rain_started`, `lightning_detected`, `station_unreachable`                                                                                                                                                              |
| Scene actions               | `get_weather` (current values as outputs), `get_forecast` (cloud forecast of a day, with its Gladys weather condition)                                                                                                   |
| Dashboard widget            | `tempest_station`: live tiles, 24 h temperature chart, computed status (feels like, dew point, wind, lightning, battery, connection), Refresh button                                                                     |
| Configuration screen button | `test_connection`: listens to the LAN and queries the cloud                                                                                                                                                              |

Units: °C / °F, km/h / m/s / mph (the lightning distance follows: km or miles). Rain stays in
mm and pressure in hPa (Gladys has no imperial unit for them).

Requires **Gladys ≥ 5.3.0** (scene triggers, scene actions, widgets and the catalog search keywords).

## Project structure

```
.
├─ index.js                          # SDK bootstrap + wiring (no Tempest logic)
├─ src/
│  ├─ config.js                      # config defaults + normalization
│  ├─ i18n.js                        # en, fr, de, es
│  ├─ units.js                       # unit conversions
│  ├─ devices/tempest.js             # the Gladys device: features and states
│  ├─ tempest/
│  │  ├─ protocol.js                 # Tempest messages, derived values
│  │  ├─ stations.js                 # known stations, persisted in /data
│  │  ├─ engine.js                   # dedup, states, rain / lightning, triggers, badge
│  │  ├─ local.js                    # LAN listener (core-mediated UDP capture)
│  │  ├─ cloud.js                    # REST + WebSocket
│  │  └─ sources.js                  # channel choice, fallback, status, connection test
│  ├─ scenes.js                      # scene actions
│  └─ widgets.js                     # dashboard widget
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # unit tests (`node --test`), no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready, non-root
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
├─ .github/workflows/ci.yml          # format, lint, tests (Node 22 + 24), store checks, Docker build
├─ .github/workflows/release.yml     # UI-driven release: bump + changelog + tag + build + GitHub Release
├─ .github/workflows/build.yml       # multi-arch build (tag, manual, or called by release)
├─ .github/workflows/github-release.yml # GitHub Release of every version tag
├─ .github/scripts/changelog-release.mjs # rolls the Unreleased section of the changelog
├─ .github/dependabot.yml            # weekly npm / monthly Actions and Docker updates
└─ cover.png                         # catalog cover, 800×534 px
```

## How the local channel works

An integration container runs on a Docker bridge network: the hub's UDP broadcasts never reach
it. The manifest declares `"network_discovery": [{ "type": "udp-broadcast", "ports": [50222] }]`
(shown to the user on the install screen), and the integration asks the Gladys core, which
runs on the host network, to capture the datagrams: one 30-second capture after the other
(`src/tempest/local.js`). The SDK request timeout is raised to 45 s in `index.js` so the HTTP
call outlasts the capture.

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="gladys-weatherflow" \
DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

The CI runs the first three on Node 22 and 24 for every push to `main` and every pull request;
pull requests also build the Docker image and run the store checks without the registry check
(`--skip-image-check`): the image a pull request names is only pushed by the release. The
Release workflow runs the full check, image included, once it has published the image.

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository, and turn on
   **Private vulnerability reporting** in the security settings ([`SECURITY.md`](SECURITY.md)
   sends reporters there).
2. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
3. **Actions → Release → Run workflow**, pick `major` for the first release (0.0.0 → 1.0.0),
   then `patch` / `minor` / `major`. The workflow bumps `package.json` and the manifest
   (`version` + `docker_image`), moves the changelog section, tags `vX.Y.Z`, builds the
   `linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-weatherflow` (`:X.Y.Z` and
   `:latest`) and publishes the GitHub Release.
4. Make the `ghcr.io` package public, so Gladys can pull it.
5. The store indexer picks up the new version; Gladys offers the install / update.

## License

Apache-2.0
