# Security policy

## Supported versions

Only the latest release of the WeatherFlow Tempest integration receives security
fixes. Update the integration from the Gladys store before reporting an issue.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-weatherflow](https://github.com/prohand/gladys-weatherflow/security),
then **Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, passwords and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), the
Tempest hardware, and the WeatherFlow / Tempest cloud services (report to
WeatherFlow).

## What the integration handles

- **The personal access token** of tempestwx.com: stored by Gladys as a secret field,
  sent only to `swd.weatherflow.com` (Authorization header) and `ws.weatherflow.com`
  (WebSocket URL), never written to the logs. It gives read access to the stations of
  the account: revoke it on tempestwx.com if it leaks.
- **The local channel**: the hub broadcasts its data unauthenticated on the LAN (UDP
  50222); anyone on the network can read it, or send fake datagrams. The integration
  only reads JSON from it, never executes or forwards it.
- **Files**: only `/data/stations.json` (station list and rain/lightning counters).

## Good practices for users

- Keep the token only in the integration's secret field.
- Keep Gladys and the integration up to date.
