# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-05-23

### Added
- **Job/download separation**: `POST /api/export` now returns a `jobId`
  immediately (HTTP 202). Progress is streamed via `GET /api/progress/:jobId`
  (SSE, metadata only). The CSV is delivered via `GET /api/download/:jobId`.
  The CSV payload is no longer embedded in the SSE `done` event, which removes
  the main memory pressure for large tenants.
- **Room-phase progress**: progress events are now emitted every 10 rooms
  during the room-detail fetch phase (previously this phase was silent).
  Progress bar runs 0→50% during room fetch, 50→100% during config fetch.
- **Estimated time display**: for tenants with >100 rooms, an estimated
  completion time is shown in the log panel immediately after room discovery.
- **Enum normalisation**: `profile.*` column values are now normalised from
  protobuf long-form (`USB_MODE_AUTO`, `FRAMING_MODE_INDIVIDUAL`, …) to the
  short form used by the device API (`AUTO`, `INDIVIDUAL`, …). This eliminates
  false-positive drift detections in `_source.*` comparisons.
- **IPv6 RFC 5952 compression**: decoded IPv6 addresses are now output in
  compressed notation (`fe80::fc51:9e86:74eb:1325` instead of
  `fe80:0000:0000:0000:fc51:9e86:74eb:1325`).
- **Network display-name fallback**: interfaces without a `display` field now
  get a stable index-based label (`net0`, `net1`, …) instead of the raw type
  string (`NETWORK_TYPE_ETHERNET`), preventing awkward column names.
- **Dockerfile** and `.dockerignore` for containerised deployment.
- **GitHub Actions CI** (`.github/workflows/ci.yml`): syntax check and
  smoke-test on Node 18, 20, and 22.
- **License and Node.js badges** in README.
- **Tested on** table in README.
- **Docker setup** instructions in README.
- **Screenshots** placeholder section in README.
- Multi-language READMEs: `docs/README.ja.md`, `ko.md`, `zh-TW.md`, `zh-CN.md`.

### Fixed
- `addEventListener` for input unlock was registered inside `applyEnvLoaded`,
  which accumulated duplicate listeners on every language switch. Moved to
  top-level, registered once.
- `<button>` had duplicate `id` attributes (`id="exportBtn" id="t-exportBtn"`).
  Removed the redundant `id`.
- `README.md` incorrectly stated `CONCURRENCY` default as `5`; corrected to `3`.
- `README.md` referenced `SENSITIVE_KEY_PATTERNS` (removed); updated to describe
  the current `isSecretKey()` function.

## [0.1.0] - 2026-05-23

Initial public release.

### Added
- Web UI (single-page, vanilla JS) for triggering a CSV export against
  the Neat Pulse API.
- Express server that orchestrates Pulse API calls and streams progress
  via Server-Sent Events.
- Room-first traversal strategy
  (`/orgs/{org}/rooms` → `/orgs/{org}/rooms/{id}`) so location and
  region context is included for every device.
- Per-endpoint config fetch (`/endpoints/{id}/config`) and per-profile
  config fetch (`/profiles/{profileId}`) with in-memory profile cache.
- Three column groups per setting key: `config.*` (device-side),
  `profile.*` (declared baseline) and `effective.*` (merged view).
- Decoding of base64-encoded MAC / IPv4 / IPv6 addresses and gateway
  fields; storage figures normalised to GB.
- Automatic masking of true secret values
  (`password`, `secret`, `token`, `apiKey`, `privateKey`, `credential`)
  while leaving boolean flags such as `settingsPasswordRequired` intact.
- Orphan-endpoint detection: devices not assigned to a room are still
  exported, sourced via `/endpoints/{id}`.
- Configurable concurrency (`CONCURRENCY` env var, default 3) with
  retry on 429/5xx using `Retry-After` and exponential backoff.
- README sections documenting confirmed Pulse API behaviour, including
  known limitations around `office_hours`, Channel apps and other
  write-only keys.

### Verified
- Functional and rate-limit behaviour validated against a real
  production tenant with 560 endpoints / 296 rooms / 25 profiles /
  11 device models.

### Known limitations
See [README → Known Pulse API limitations](./README.md#known-pulse-api-limitations).
Briefly: 24+ configuration keys observable in the audit log
(`office_hours`, `channelApps*`, `homeApp`, `kioskMode`, etc.) are not
returned by any documented Read API and therefore cannot be exported.
Reported to Neat.

[Unreleased]: https://github.com/<your-account>/neat-pulse-exporter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/<your-account>/neat-pulse-exporter/releases/tag/v0.1.0
