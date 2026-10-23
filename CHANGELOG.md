# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [0.0.2] - 2026-10-23

- Maintenance release, no functional change.

## [0.0.1] - 2026-10-16

### Added

- WeatherFlow Tempest stations in Gladys: temperature, humidity, station and sea-level pressure, wind speed, gust and direction, illuminance, UV index, rain of the last hour and of the day, raining, lightning strikes of the last hour and last strike distance, battery.
- Local channel: the hub's UDP broadcasts (port 50222), captured by the Gladys core, with no account and no Internet.
- Cloud channel: the Tempest REST API and WebSocket, with a personal access token (station names, altitude, time zone, forecast).
- "Prefer the local connection" toggle: the other channel takes over when the preferred one falls silent, with a transport badge per station (local, cloud, unreachable, degraded).
- Scene triggers: rain started, lightning detected, station unreachable.
- Scene actions: read the station, get the forecast.
- "Tempest station" dashboard widget.
- "Test the connection" button in the configuration.
- Temperature unit (°C, °F) and wind unit (km/h, m/s, mph) settings.
- English, French, German and Spanish translations (configuration screen, messages, widget, documentation).

[Unreleased]: https://github.com/prohand/gladys-weatherflow/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/prohand/gladys-weatherflow/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/prohand/gladys-weatherflow/releases/tag/v0.0.1
