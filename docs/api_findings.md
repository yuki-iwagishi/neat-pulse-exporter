# Neat Pulse API — Findings from Building This Tool

Documented behaviour observed while building `neat-pulse-exporter`,
verified against the live Pulse API in May 2026 across two tenants:
a 4-device BYOD-only test tenant and a 560-device / 296-room /
25-profile / 11-model production tenant.

This is not official Neat documentation. Where these notes contradict
[Neat's public API docs](https://api.pulse.neat.no/docs/), trust the
docs.

---

## 1. Traversal: rooms vs endpoints

`GET /v1/orgs/{org}/endpoints` returns a list of endpoint stubs but
*not* their location/region context. `GET /v1/orgs/{org}/rooms/{id}`,
on the other hand, returns:

- the room's `location.{id, name, region.{id, name}}`
- an `endpoints[]` array containing the same shape returned by
  `/endpoints/{id}` — so it doubles as a bulk fetch.

This makes a rooms-first traversal both faster (fewer requests) and
richer (location/region included). The exporter uses this approach,
falling back to `/endpoints/{id}` only for orphan devices (devices not
assigned to any room).

The list view of `/rooms` is intentionally sparse — only `id` and
`name`. `locationId` does not appear there; you must hit
`/rooms/{id}` to see the location.

`/v1/orgs/{org}/locations/{id}/rooms` returns 404. The reverse lookup
isn't supported; iterate rooms and build the index client-side.

## 2. Encoding of network fields

Network addresses inside `/endpoints/{id}` (and inside the embedded
endpoints in `/rooms/{id}`) are base64-encoded packed bytes, not
human-readable strings:

```
"macAddress": "xGP7Ax96"                        // 6 bytes → C4:63:FB:03:17:96
"address": { "ipv4": "wKgA3A==" }               // 4 bytes → 192.168.0.220
"address": { "ipv6": "/oAAAAAAAAD8UZ6GdOsTJQ==" } // 16 bytes → fe80::fc51:...
"gateway": [{ "ipv4": "wKgA/g==" }]             // 4 bytes → 192.168.0.254
```

`localIpAddress` is the only IPv4 string returned as plain text. For
everything else you have to decode. The exporter does this and
publishes both the decoded value and a `/prefix` suffix (CIDR form).

Bytes interpretation: `ipv4` is 4 bytes big-endian, `ipv6` is 16 bytes
big-endian, `macAddress` is 6 bytes.

## 3. Storage figures

`totalSystemStorage`, `freeInternalStorage` and friends are returned
as **strings of bytes**, not numbers:

```
"totalInternalStorage": "11701923840"  // → 10.9 GB
```

The exporter converts these to GB to keep the CSV readable in Excel.

## 4. Profile config retrieval

The only working read path is `GET /v1/orgs/{org}/profiles/{id}`.
Both of these alternatives return 404:

```
GET /v1/orgs/{org}/configs/{configId}
GET /v1/orgs/{org}/profiles/{id}/config
```

The `profile.configId` field is present in the response but appears
to be an internal pointer, not an addressable resource. Treat it as
opaque.

## 5. Enum representation differs between Profile and Device

Several enum-valued keys are returned with a `_*` prefix on the
profile side and without it on the device side:

| key                  | Profile config           | Device config |
| -------------------- | ------------------------ | ------------- |
| `usbMode`            | `USB_MODE_AUTO`          | `AUTO`        |
| `defaultFramingMode` | `FRAMING_MODE_INDIVIDUAL`| `INDIVIDUAL`  |
| `neatOtaChannel`     | `DEVICE_CHANNEL_UNKNOWN` | `BETA`        |

`USB_MODE_AUTO` and `AUTO` are the same setting. For Excel-style
diff comparison you have to normalise one side. The exporter does
not auto-normalise today; an opt-in `NORMALIZE_ENUMS` flag is on the
roadmap.

## 6. Device `/config` returns only explicit writes

`GET /v1/orgs/{org}/endpoints/{id}/config` only returns keys that
have been **explicitly written on the device**. Keys whose value is
inherited from an assigned profile (and not overridden locally) are
silently omitted.

This was confirmed by direct experiment:

1. Profile 50 contains `hdmiSleepSignal: true`.
2. With the profile applied and no local override, `hdmiSleepSignal`
   is **absent** from `/config`.
3. Toggling the setting locally via the device's own settings UI to
   `false` causes `hdmiSleepSignal: false` to appear in `/config`,
   along with two unrelated keys (`concurrentAudioOverHdmi`,
   `framingBoundaryRadius`) that were apparently rewritten as part of
   the same write batch.
4. Clicking "Restore profile setting" rewrites the value back to the
   profile value and the key remains in `/config` as
   `hdmiSleepSignal: true`.
5. State is stable: re-fetching after no further changes returns the
   exact same payload.

So the rule is: presence ⇒ explicit write. Absence ⇒ either
inherited from profile, or not supported by the model. Pulse's UI
distinguishes those two cases (it greys out unsupported toggles); the
API doesn't.

## 7. Locked-profile overrides

Pulse's profile system marks a setting as "locked by profile" when a
profile is assigned. The Pulse web UI then refuses to change it.
However, **the device's own on-device settings UI ignores the lock**
and can override the value. When that happens, Pulse displays the
warning:

> *A locked profile setting has been changed on this device:*
> *Restore profile setting*

The override is correctly visible in `/endpoints/{id}/config`, so
`effective.*` in the CSV reflects the actual device value. But the
warning state itself is **not** exposed in the API. There is no
boolean like `localOverridesProfile` you can read. To enumerate
overridden devices you have to compare `config.X` vs `profile.X` per
row and flag the mismatches client-side.

## 8. Write-only keys (no Read API exposure)

The Pulse UI lets you set, and the Pulse audit log records,
configuration keys that **no Read API returns**. Verified against
both tenants (4 devices + 560 devices, the latter with all device
families):

- `office_hours`, `office_hours_enabled`        (Sleep schedule)
- `kioskMode`, `homeApp`                        (App Hub home screen)
- `ngmsEnabled`, `ngmsFeatureToggle`            (NGMS)
- `avosChannel`                                 (AVOS firmware channel)
- `scheduledFirmwareUpdateDelay`                (a `scheduledUpdateDelay` is returned and may be the same field renamed)
- `settingsPassword`, `settingsPasswordMode`    (settings-lock password; the *Required* boolean IS returned)
- All sixteen `channelApps*` toggles:
  `channelAppsZoom`, `channelAppsTeams`, `channelAppsMiro`,
  `channelAppsSpotify`, `channelAppsSlack`, `channelAppsJira`,
  `channelAppsTrello`, `channelAppsHubspot`, `channelAppsWhatsapp`,
  `channelAppsKahoot`, `channelAppsBrowser`, `channelAppsAppspace`,
  `channelAppsSmartenspaces`, `channelAppsAround`, `channelAppsRobin`,
  `channelAppsWorkplace`

Endpoints tested (all confirmed missing the keys above):
`/profiles/{id}`, `/endpoints/{id}/config`, `/endpoints/{id}`,
`/rooms/{id}`.

This is the single biggest gap for inventory-comparison use cases:
without `channelApps*` from the API there is no way to verify which
apps a given Neat Frame / Board has enabled. Reported to Neat.

## 9. Rate limits

Concurrent requests above ~5–6 from a single API key trigger
`429 Too Many Requests` on busy tenants. The exporter defaults to
`CONCURRENCY=3` and retries `429` and `5xx` responses with
exponential backoff, honouring `Retry-After` when present. With those
defaults a 560-endpoint export completes in roughly 3 minutes and
hits zero unrecoverable errors.

## 10. URL paths worth remembering

| Purpose                      | Verified path                                                    |
| ---------------------------- | ---------------------------------------------------------------- |
| List rooms                   | `GET /v1/orgs/{org}/rooms`                                       |
| Room detail + endpoints      | `GET /v1/orgs/{org}/rooms/{id}`                                  |
| List endpoints               | `GET /v1/orgs/{org}/endpoints`                                   |
| Endpoint detail              | `GET /v1/orgs/{org}/endpoints/{id}`                              |
| Endpoint live config         | `GET /v1/orgs/{org}/endpoints/{id}/config`                       |
| List profiles                | `GET /v1/orgs/{org}/profiles`                                    |
| Profile detail + config      | `GET /v1/orgs/{org}/profiles/{id}`                               |
| List locations               | `GET /v1/orgs/{org}/locations`                                   |
| List regions                 | `GET /v1/orgs/{org}/regions`                                     |

`GET /v1/orgs/{org}/endpoints/{id}/settings` (mentioned by name in
the OpenAPI summary as `endpointsSettings`) returns 404 — the path
that actually works is `/config`. Don't waste time on `/settings`.
