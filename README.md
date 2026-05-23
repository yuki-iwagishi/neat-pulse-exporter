# Neat Pulse Settings Exporter

**[English](./README.md)** · [日本語](./docs/README.ja.md) · [한국어](./docs/README.ko.md) · [繁體中文](./docs/README.zh-TW.md) · [简体中文](./docs/README.zh-CN.md)

---

![MIT License](https://img.shields.io/badge/license-MIT-green)
![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)
![Unofficial](https://img.shields.io/badge/Neat-unofficial-lightgrey)

A small Node.js web tool that exports per-device settings from the
[Neat Pulse API](https://api.pulse.neat.no/docs/) as a CSV file, intended for
cross-checking against an Excel inventory of meeting-room devices.

> ⚠️ **Unofficial.** This project is not affiliated with or endorsed by Neat.
> It only calls publicly documented endpoints with an API key you provide.

## Features

- Iterates the Pulse organisation by **rooms** (`GET /orgs/{org}/rooms` →
  `GET /orgs/{org}/rooms/{id}`) so location and region context is included.
- For each device, fetches the active configuration
  (`GET /endpoints/{id}/config`) and, when one is assigned, the assigned
  **profile** (`GET /profiles/{profileId}`).
- Emits three sets of config columns for every setting key:
  - `config.*` — values returned by the device itself
  - `profile.*` — values declared in the assigned profile
  - `effective.*` — device value if present, else the profile value
- Decodes base64-encoded MAC / IPv4 / IPv6 / gateway fields and exposes
  storage figures in GB so the result opens cleanly in Excel.
- Live progress streamed to the browser via Server-Sent Events.
- Automatically masks values whose key suggests a secret (`password`,
  `token`, `secret`, `apiKey`, `privateKey`, `credential`, …) but leaves
  boolean flags such as `settingsPasswordRequired` untouched.
- UTF-8 BOM prepended so Excel opens the CSV as UTF-8 by default.

## Scale tested

Verified against a production Pulse tenant with **560 endpoints across
296 rooms, 25 unique profiles and 11 device models**, completing the
full export with 0 errors. The default `CONCURRENCY=3` was chosen to
avoid Pulse rate-limit triggers in that environment; smaller deployments
can safely raise it.

## Screenshots


## Tested on

| OS | Node.js | Status |
|---|---|---|
| macOS 15 (Apple Silicon) | 22.x | ✅ Verified |
| macOS 15 (Apple Silicon) | 18.x | ✅ Verified |
| _(Windows 11)_ | — | Not yet tested — contributions welcome |
| _(Ubuntu 24.04)_ | — | Not yet tested — contributions welcome |

## Requirements

- Node.js 18 or newer (uses the global `fetch`).
- A Neat Pulse **Plus** or **Pro** subscription (required to generate API keys).
- An API key generated in **Pulse → Settings → API**.
- Your organisation ID (`orgId`).

## Setup

### Option A — Node.js (recommended for development)

```bash
git clone https://github.com/yuki-iwagishi/neat-pulse-exporter.git
cd neat-pulse-exporter
npm install
cp .env.example .env   # optional, see below
npm start
```

Then open <http://127.0.0.1:3000> in a browser.

### Option B — Docker

```bash
# Build
docker build -t neat-pulse-exporter .

# Run (pass credentials via environment variables)
docker run --rm -p 3000:3000 \
  -e PULSE_API_KEY=your_key \
  -e PULSE_ORG_ID=your_org_id \
  neat-pulse-exporter
```

Then open <http://127.0.0.1:3000> in a browser.

> **Note:** Do not use `HOST=0.0.0.0` unless the container is behind
> a private network or reverse proxy. The server warns at startup when
> a non-loopback address is used.

### Configuration via `.env` (optional)

Copy `.env.example` to `.env` and fill in the values you want. Every variable
is optional.

| Variable        | Default     | Description                                                       |
| --------------- | ----------- | ----------------------------------------------------------------- |
| `PORT`          | `3000`      | HTTP port to listen on.                                           |
| `HOST`          | `127.0.0.1` | Bind address. Use `0.0.0.0` only if you want LAN access.          |
| `CONCURRENCY`   | `3`         | Maximum parallel requests to the Pulse API.                       |
| `PULSE_API_KEY` | _(empty)_   | If set, the UI will use this and the API Key field becomes optional. |
| `PULSE_ORG_ID`  | _(empty)_   | Same as above for the Organisation ID.                            |

> **Never commit your real `.env`.** It is already listed in `.gitignore`.

## Usage

1. Run `npm start` and open the page in a browser.
2. Paste the API key and organisation ID (unless they are already in `.env`).
3. Click **Export to CSV**. Progress will stream into the panel.
4. When finished, a CSV download is triggered automatically.

The CSV has one row per device. Columns are the union of all keys seen across
devices, sorted alphabetically, so different models can coexist in one file.

## Customising

### Sensitive-field masking

`src/server.js` defines `isSecretKey()`. Any config value whose key name
matches the heuristic pattern (`password`, `secret`, `token`, `apiKey`,
`privateKey`, `credential`) is replaced with `***MASKED***` in all three
column groups (`config.*`, `profile.*`, `effective.*`). Boolean flags such
as `settingsPasswordRequired` are excluded from masking. Edit `isSecretKey()`
to fit your organisation's policy.

### Column mapping to match your Excel sheet

By default every key the API returns becomes a column. If your Excel sheet
has a fixed set of columns, the simplest approach is to post-process the CSV
in Excel with `VLOOKUP` / Power Query, or modify the `Promise.all` block in
`/api/export` to project only the keys you need.

### Polling vs. SSE

The progress channel uses Server-Sent Events. If your environment has issues
with long-lived connections (e.g. a corporate proxy that buffers), switch to a
plain `POST /api/export` returning the CSV body — the bulk of the logic in
`server.js` is unchanged.

## Known Pulse API limitations

Investigated and confirmed against the live Pulse API (May 2026). These
shape what `effective.*` can and cannot tell you:

### 1. Model-specific keys

A setting only appears in `/endpoints/{id}/config` if the device's model
supports it. For example, **HDMI sleep signal** is supported on Neat Bar
Pro but not on the original Neat Bar, so `config.hdmiSleepSignal` will be
empty for Bar rows even though the key exists in the assigned profile.
The corresponding `effective.*` column will fall back to the profile
value, which does not mean the device actually applies it. Cross-check
against the model's published feature list if in doubt.

### 2. Profile-inherited values are omitted from device config

`GET /endpoints/{id}/config` only returns keys that have been
**explicitly written on the device itself**. Keys whose effective value
comes from an assigned profile (via inheritance) are silently omitted.
This is normal Pulse behaviour, not a bug. The exporter compensates by
also fetching `/profiles/{profileId}` and merging the two into
`effective.*`.

### 3. Local overrides on profile-locked settings

The Pulse UI marks a setting as *locked by profile* when a profile is
assigned, but users can still override the setting directly on the Neat
device. When that happens, Pulse shows the warning *"A locked profile
setting has been changed on this device: Restore profile setting"* in
its UI. The override **is** reflected in `/endpoints/{id}/config`, so
`effective.*` correctly shows the device's actual value. However, the
API does **not** expose the warning flag itself, so the CSV cannot tell
you which keys are in this overridden state without also checking the
Pulse UI.


**Channel apps (16 keys)** — none of these per-app enable/disable
toggles are exposed:

```
channelAppsAppspace      channelAppsKahoot       channelAppsSmartenspaces
channelAppsAround        channelAppsMiro         channelAppsSpotify
channelAppsBrowser       channelAppsRobin        channelAppsTeams
channelAppsHubspot       channelAppsSlack        channelAppsTrello
channelAppsJira          channelAppsZoom         channelAppsWhatsapp
                                                  channelAppsWorkplace
```

**Other UI-settable keys with no Read API exposure:**

```
homeApp                       avosChannel
kioskMode                     scheduledFirmwareUpdateDelay
ngmsEnabled                   settingsPassword
ngmsFeatureToggle             settingsPasswordMode
```

`settingsPassword` and the related Remote-access password are omitted
for legitimate security reasons; the others appear to be a Read API
gap. Reported together with `office_hours`.

### Coverage summary

For a typical assigned profile the tool exports **roughly 35 / 45**
visible Pulse UI settings via `profile.*`, plus another 14 device-only
keys via `config.*` (e.g. `pairingSerial`, `controllerMode`,
`wifiEnabled`). The 24 + 2 keys above are out of reach until Neat
exposes them in the Read APIs.


## Security notes

- **The API key is sent from the browser to your local Node process via HTTPS
  POST body**, not as a URL query parameter. It is not logged, not stored, and
  only used in-memory for the duration of the request.
- **The exported CSV may still contain network details** (MAC addresses, IP
  addresses, room/location metadata) even after masking. Treat the file like
  any other inventory document.
- **Bind to `127.0.0.1` by default.** When `HOST` is set to a non-loopback
  address the server logs a warning at startup and the UI displays a visible
  banner. Anyone on the same network can then trigger exports.
- **No authentication is built into the web UI.** For team use, put the server
  behind an existing SSO / reverse proxy, or package it as an Electron desktop
  app.

### Secret-detection limitations

The tool automatically masks values whose key name matches a heuristic pattern
(`password`, `secret`, `token`, `apiKey`, `privateKey`, `credential`).
This has known failure modes:

| Case | Examples of keys that may be **incorrectly handled** |
|------|------------------------------------------------------|
| Over-masked (false positive) | `secretariatMode`, `tokenRefreshInterval` |
| Under-masked (false negative) | `pwd`, `clientKey`, `bearer`, `passphrase` |

**Always review exported CSV files before sharing them externally.**
The tool cannot guarantee perfect secret detection.

## Project layout

```
neat-pulse-exporter/
├── .github/
│   └── workflows/
│       └── ci.yml             # Syntax check + smoke test (Node 18/20/22)
├── docs/
│   ├── api_findings.md        # Detailed notes on Pulse API behaviour
│   ├── README.ja.md           # 日本語
│   ├── README.ko.md           # 한국어
│   ├── README.zh-TW.md        # 繁體中文
│   └── README.zh-CN.md        # 简体中文
├── examples/
│   └── sample_output_columns.txt   # Representative CSV column inventory
├── public/
│   └── index.html        # Single-file UI (no build step)
├── src/
│   └── server.js         # Express server + Pulse API client
├── .dockerignore
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── Dockerfile
├── LICENSE
├── package.json
└── README.md
```

## Further reading

- [`docs/api_findings.md`](./docs/api_findings.md) — Detailed notes on
  Pulse API behaviour collected while building this tool. Useful if you
  are building any other Pulse-based integration.
- [`examples/sample_output_columns.txt`](./examples/sample_output_columns.txt) —
  Representative list of CSV columns produced against a 560-endpoint
  tenant, grouped by prefix.

## Troubleshooting

| Symptom                              | Likely cause / fix                                             |
| ------------------------------------ | -------------------------------------------------------------- |
| `Pulse API 401`                      | API key invalid or expired. Regenerate in Pulse Settings.      |
| `Pulse API 403`                      | The key has no Read scope, or your plan does not include APIs. |
| `Pulse API 404` on `/profiles/{id}`  | Device has no profile assigned; rows still export, `profile.*` columns just stay empty. |
| `_configError` column populated      | Device returned an error for `/config` (e.g. transient timeout). Other columns still valid. |
| Empty `endpoints` array              | Wrong `orgId`, or the key belongs to a different organisation. |
| Excel shows mojibake / 文字化け      | Excel < 2016 may ignore BOM; try _Data → From Text/CSV_ instead. |

## Future improvements

The following are known enhancement opportunities that are out of scope
for v0.1.0 but worth tracking:

**Streaming CSV for very large tenants**  
The current implementation accumulates all rows in memory and
stringifies at the end. For tenants with thousands of endpoints this
could cause a memory spike. A future version should stream rows
directly using `csv-stringify`'s async API.

## License

MIT — see [LICENSE](./LICENSE).
