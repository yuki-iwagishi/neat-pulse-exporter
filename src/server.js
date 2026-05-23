import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import pLimit from 'p-limit';
import { stringify } from 'csv-stringify/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT        = Number(process.env.PORT) || 3000;
const HOST        = process.env.HOST || '127.0.0.1';
const CONCURRENCY = Number(process.env.CONCURRENCY) || 3;
const MAX_RETRIES = Number(process.env.MAX_RETRIES) || 4;
const PULSE_BASE  = 'https://api.pulse.neat.no/v1';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Warn when exposed beyond localhost
if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.warn(
    '\n⚠️  WARNING: Server is bound to ' + HOST +
    ' — anyone on the same network can trigger exports.\n' +
    '   Set HOST=127.0.0.1 in .env for local-only access.\n',
  );
}

// -------- Decoding helpers --------

function decodeIpv4(b64) {
  if (!b64 || typeof b64 !== 'string') return '';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 4) return '';
    return Array.from(buf).join('.');
  } catch { return ''; }
}

/**
 * Decode a base64 IPv6 address and compress it to RFC 5952 notation.
 * e.g. "2001:0db8:0000:0000:0000:ff00:0042:8329" → "2001:db8::ff00:42:8329"
 */
function decodeIpv6(b64) {
  if (!b64 || typeof b64 !== 'string') return '';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 16) return '';
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(buf.readUInt16BE(i));

    // RFC 5952 §4.2: find the longest run of consecutive zeros for "::" compression
    let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (let i = 0; i <= groups.length; i++) {
      if (i < groups.length && groups[i] === 0) {
        if (curStart === -1) { curStart = i; curLen = 0; }
        curLen++;
      } else {
        if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
        curStart = -1; curLen = 0;
      }
    }

    if (bestLen < 2) {
      // No compression: just join with leading-zero removal
      return groups.map((g) => g.toString(16)).join(':');
    }

    const head = groups.slice(0, bestStart).map((g) => g.toString(16)).join(':');
    const tail = groups.slice(bestStart + bestLen).map((g) => g.toString(16)).join(':');
    return `${head}::${tail}`;
  } catch { return ''; }
}

// -------- Enum normalization --------

/**
 * Pulse Profile API returns enum values in protobuf long-form
 * (e.g. "USB_MODE_AUTO"), while the device /config API returns the
 * short form ("AUTO"). Normalize the long form to short form so that
 * profile.* and config.* values can be compared directly for drift detection.
 *
 * Only applied to profile.* columns; config.* and effective.* are unchanged.
 */
const ENUM_PREFIX_RE = /^(?:USB_MODE|FRAMING_MODE|DEVICE_CHANNEL|NETWORK_TYPE|NETWORK_MODE|TEMPERATURE_UNIT|USB_CABLE_INSTRUCTIONS)_/;

function normalizeEnum(v) {
  if (typeof v !== 'string') return v;
  return v.replace(ENUM_PREFIX_RE, '');
}

function decodeMac(b64) {
  if (!b64 || typeof b64 !== 'string') return '';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 6) return '';
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  } catch { return ''; }
}

function bytesToGB(bytes) {
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!Number.isFinite(n)) return '';
  return Math.round((n / (1024 ** 3)) * 100) / 100;
}

function msToMinutes(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '';
  return Math.round(n / 60000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------- CSV safety helpers --------

/**
 * Prevent CSV formula injection.
 * Excel / Sheets interprets cells starting with =, +, -, @, | as formulas.
 * Prefix them with a single quote so they are treated as plain text.
 */
function sanitizeCsvValue(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@|]/.test(value)) return "'" + value;
  return value;
}

/**
 * Normalize booleans: true → "true", false → "false", otherwise pass-through.
 * This makes the output unambiguous in Excel (no 1 / empty confusion).
 */
function normalizeValue(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (v === null || v === undefined) return '';
  return v;
}

function cellValue(v) {
  const n = normalizeValue(v);
  // After normalisation, arrays and objects must be JSON-stringified so they
  // never reach String() as "[object Object]".
  if (n !== null && n !== undefined && typeof n === 'object') {
    return sanitizeCsvValue(JSON.stringify(n));
  }
  return sanitizeCsvValue(n === null || n === undefined ? '' : String(n));
}

// -------- Secret detection --------

function isSecretKey(key, value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    /password|secret|token|apikey|privatekey|credential/i.test(key) &&
    !/required|enabled|set$/i.test(key)
  );
}

// -------- Pulse API helper --------

const FETCH_TIMEOUT_MS = 30_000; // 30 s per request

async function pulseFetch(urlPath, apiKey, { allow404 = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      // AbortSignal.timeout is available in Node 18+.
      // Falls back to a manual controller for older environments.
      const signal = typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
        : (() => {
            const c = new AbortController();
            setTimeout(() => c.abort(new Error('Request timed out')), FETCH_TIMEOUT_MS);
            return c.signal;
          })();

      res = await fetch(`${PULSE_BASE}${urlPath}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal,
      });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        // Jitter prevents thundering-herd re-collisions on concurrent retries
        const jitter = Math.random() * 500;
        await sleep(2 ** attempt * 1000 + jitter);
        continue;
      }
      throw e;
    }
    if (res.ok) return res.json();
    if (allow404 && res.status === 404) return null;
    const isRetryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (isRetryable && attempt < MAX_RETRIES) {
      const ra = Number(res.headers.get('retry-after'));
      const jitter = Math.random() * 500;
      const wait = Number.isFinite(ra) && ra > 0
        ? ra * 1000 + jitter
        : 2 ** attempt * 1000 + jitter;
      await sleep(wait);
      continue;
    }
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Pulse API ${res.status} ${res.statusText} for ${urlPath}${text ? ` — ${text.slice(0, 200)}` : ''}`,
    );
    err.status = res.status;
    throw err;
  }
  throw lastErr || new Error(`Pulse API failed after ${MAX_RETRIES} retries for ${urlPath}`);
}

// -------- Row builder --------

/**
 * Source constants for _source.* columns.
 * These tell the reader exactly where effective.* came from.
 *   device   — value was explicitly written on the device
 *   profile  — value came from the assigned profile (device had no override)
 *   none     — neither device nor profile had a value for this key
 */
const SRC_DEVICE  = 'device';
const SRC_PROFILE = 'profile';
const SRC_NONE    = '';

function buildRow({ endpoint, room, config, profile }) {
  const row = {};

  // ----- Identity -----
  row['id']             = endpoint.id ?? '';
  row['serial']         = endpoint.serial ?? '';
  row['pairingSerial']  = endpoint.pairingSerial ?? '';
  row['model']          = endpoint.model ?? '';
  row['upgradeModel']   = endpoint.upgradeModel ?? '';
  row['buildType']      = endpoint.buildType ?? '';
  row['orientation']    = endpoint.orientation ?? '';

  // ----- Room / Location / Region -----
  row['roomId']         = endpoint.roomId ?? room?.id ?? '';
  row['roomName']       = endpoint.roomName ?? room?.name ?? '';
  row['locationId']     = room?.location?.id ?? '';
  row['locationName']   = room?.location?.name ?? '';
  row['regionId']       = room?.location?.region?.id ?? '';
  row['regionName']     = room?.location?.region?.name ?? '';
  row['dec']            = room?.dec ?? '';
  row['decTimeout']     = room?.decTimeout ?? '';
  row['occupancy']      = room?.occupancy ?? '';

  // ----- Profile metadata -----
  row['profileId']          = endpoint.profileId ?? '';
  row['profileName']        = profile?.profile?.name        ?? profile?.name        ?? '';
  row['profileDescription'] = profile?.profile?.description ?? profile?.description ?? '';
  row['profileConfigId']    = profile?.profile?.configId    ?? profile?.configId    ?? '';

  // ----- Connection / status -----
  row['connected']              = normalizeValue(endpoint.connected ?? '');
  row['inCallStatus']           = endpoint.inCallStatus ?? '';
  row['connectionTime']         = endpoint.connectionTime ?? '';
  row['enrolmentTime']          = endpoint.enrolmentTime ?? '';
  row['remoteControlEnabled']   = normalizeValue(endpoint.remoteControlEnabled ?? '');

  // ----- Firmware -----
  row['firmwareVersion']              = endpoint.firmwareVersion ?? '';
  row['firmwareReleaseName']          = endpoint.firmwareVersionReleaseName ?? '';
  row['latestVersion']                = endpoint.latestVersion ?? '';
  row['latestReleaseName']            = endpoint.latestVersionReleaseName ?? '';
  row['otaChannel']                   = endpoint.otaChannel ?? '';
  row['upgradeStatus']                = endpoint.upgradeStatus ?? '';
  row['hasScheduledFirmwareUpdate']   = normalizeValue(endpoint.hasScheduledFirmwareUpdate ?? '');
  row['hasUnscheduledFirmwareUpdate'] = normalizeValue(endpoint.hasUnscheduledFirmwareUpdate ?? '');
  row['upgradeTime']                  = endpoint.upgradeTime ?? '';
  row['hexapaBuild']                  = endpoint.hexapaBuild ?? '';
  row['automaticUpdates']             = normalizeValue(endpoint.automaticUpdates ?? '');

  // ----- NTP -----
  row['ntpServerConfigured']  = endpoint.ntpServer ?? '';
  row['ntpServerActive']      = endpoint.activeNtpServer ?? '';
  row['ntpServerReachable']   = normalizeValue(endpoint.ntpServerReachable ?? '');
  row['timezone']             = endpoint.timezone ?? '';

  // ----- Misc -----
  row['primaryMode']          = endpoint.primaryMode ?? '';
  row['controllerMode']       = endpoint.controllerMode ?? '';
  row['bulkEnrolmentPending'] = normalizeValue(endpoint.bulkEnrolmentPending ?? '');

  // ----- Network -----
  row['localIpAddress'] = endpoint.localIpAddress ?? '';
  const networks = Array.isArray(endpoint.networks) ? endpoint.networks : [];
  for (let netIdx = 0; netIdx < networks.length; netIdx++) {
    const net = networks[netIdx];
    // Use display name if available; fall back to a stable index-based label
    // to avoid "NETWORK_TYPE_ETHERNET" as a column name when display is absent.
    const display = (net.display && net.display.trim()) || `net${netIdx}`;
    const prefix = `network.${display}`;
    row[`${prefix}.type`]        = net.type ?? '';
    row[`${prefix}.linkUp`]      = normalizeValue(net.linkUp ?? '');
    row[`${prefix}.mode`]        = net.mode ?? '';
    row[`${prefix}.mtu`]         = net.mtu ?? '';
    row[`${prefix}.networkName`] = net.networkName ?? '';
    row[`${prefix}.macAddress`]  = decodeMac(net.macAddress);
    const addresses = Array.isArray(net.addresses) ? net.addresses : [];
    const ipv4 = addresses.find((a) => a?.address?.ipv4);
    const ipv6s = addresses.filter((a) => a?.address?.ipv6);
    row[`${prefix}.ipv4`]       = ipv4 ? `${decodeIpv4(ipv4.address.ipv4)}/${ipv4.prefix ?? ''}` : '';
    row[`${prefix}.ipv6`]       = ipv6s[0] ? `${decodeIpv6(ipv6s[0].address.ipv6)}/${ipv6s[0].prefix ?? ''}` : '';
    row[`${prefix}.ipv6Count`]  = ipv6s.length || '';
    const gws = Array.isArray(net.gateway) ? net.gateway : [];
    const gw4 = gws.find((g) => g?.ipv4);
    const gw6 = gws.find((g) => g?.ipv6);
    row[`${prefix}.gateway`]     = gw4?.ipv4 ? decodeIpv4(gw4.ipv4) : '';
    row[`${prefix}.gatewayIpv6`] = gw6?.ipv6 ? decodeIpv6(gw6.ipv6) : '';
  }

  // ----- Storage (GB) -----
  row['storage.systemTotalGB']     = bytesToGB(endpoint.totalSystemStorage);
  row['storage.systemFreeGB']      = bytesToGB(endpoint.freeSystemStorage);
  row['storage.internalTotalGB']   = bytesToGB(endpoint.totalInternalStorage);
  row['storage.internalFreeGB']    = bytesToGB(endpoint.freeInternalStorage);
  row['storage.externalTotalGB']   = bytesToGB(endpoint.totalExternalStorage);
  row['storage.externalFreeGB']    = bytesToGB(endpoint.freeExternalStorage);

  // ----- Config / Profile / Effective / Source -----
  const deviceConfig  = (config  && typeof config  === 'object') ? config  : {};
  const profileConfig = (profile && typeof profile.config === 'object' && profile.config)
    ? profile.config : {};

  const allConfigKeys = new Set([...Object.keys(deviceConfig), ...Object.keys(profileConfig)]);

  for (const k of allConfigKeys) {
    const inDevice  = Object.prototype.hasOwnProperty.call(deviceConfig, k);
    const inProfile = Object.prototype.hasOwnProperty.call(profileConfig, k);

    // config.* — only keys explicitly written on the device
    if (inDevice) {
      let v = deviceConfig[k];
      if (k === 'screenStandby') row['config.screenStandbyMinutes'] = msToMinutes(v);
      if (isSecretKey(k, v)) v = '***MASKED***';
      row[`config.${k}`] = cellValue(v);
    }

    // profile.* — only keys declared in the assigned profile
    // Enum values are normalized to short form (e.g. "USB_MODE_AUTO" → "AUTO")
    // so they compare directly with device config.* values for drift detection.
    if (inProfile) {
      let v = profileConfig[k];
      if (k === 'screenStandby') row['profile.screenStandbyMinutes'] = msToMinutes(v);
      if (isSecretKey(k, v)) v = '***MASKED***';
      row[`profile.${k}`] = cellValue(typeof v === 'string' ? normalizeEnum(v) : v);
    }

    // effective.* — device wins, profile fills in
    {
      const v = inDevice ? deviceConfig[k] : profileConfig[k];
      if (k === 'screenStandby') row['effective.screenStandbyMinutes'] = msToMinutes(v);
      const masked = isSecretKey(k, v) ? '***MASKED***' : v;
      row[`effective.${k}`] = cellValue(masked);
    }

    // _source.* — where did effective.* come from?
    //   "device"  = explicitly written on the device
    //   "profile" = inherited from assigned profile
    //   ""        = not found in either (shouldn't happen, but defensive)
    row[`_source.${k}`] = inDevice ? SRC_DEVICE : (inProfile ? SRC_PROFILE : SRC_NONE);
  }

  return row;
}

// -------- Routes --------

// Read version once at startup to avoid repeated disk I/O
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const PKG_VERSION = _require('../package.json').version;

// -------- Job store --------
// In-memory CSV store keyed by jobId.
// Each job is auto-deleted after JOB_TTL_MS to prevent memory leaks.

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const jobs = new Map(); // jobId → { status, csv, filename, meta, error, listeners, timer }

function createJob() {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { status: 'running', csv: null, filename: null, meta: null,
                error: null, listeners: [], eventBuffer: [], timer: null };
  jobs.set(jobId, job);
  return { jobId, job };
}

function scheduleExpiry(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  clearTimeout(job.timer);
  job.timer = setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
}

// -------- Routes --------

app.get('/api/health', (_req, res) => {
  const apiKey  = process.env.PULSE_API_KEY || '';
  const orgId   = process.env.PULSE_ORG_ID  || '';
  const lanMode = HOST !== '127.0.0.1' && HOST !== 'localhost';
  res.json({
    ok: true,
    version: PKG_VERSION,
    node: process.version,
    hasEnvCredentials: Boolean(apiKey && orgId),
    hasEnvApiKey: Boolean(apiKey),
    hasEnvOrgId:  Boolean(orgId),
    orgIdPreview: orgId ? orgId.slice(0, 4) : '',
    concurrency: CONCURRENCY,
    maxRetries: MAX_RETRIES,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    lanMode,
  });
});

/**
 * POST /api/export
 * Body: { apiKey?: string, orgId?: string }
 * Returns { jobId } immediately (HTTP 202).
 * The client then connects to GET /api/progress/:jobId for SSE,
 * and GET /api/download/:jobId once 'done' fires.
 * API key stays in the POST body — never in a URL.
 */
app.post('/api/export', (req, res) => {
  const apiKey = req.body?.apiKey || process.env.PULSE_API_KEY;
  const orgId  = req.body?.orgId  || process.env.PULSE_ORG_ID;

  if (!apiKey || !orgId) {
    return res.status(400).json({ error: 'apiKey and orgId are required.' });
  }

  const { jobId, job } = createJob();
  res.status(202).json({ jobId });

  // Fire-and-forget: run export in background
  runExport({ jobId, job, apiKey, orgId }).catch((e) => {
    job.status = 'error';
    job.error  = e.message || String(e);
    broadcastToJob(job, 'error', { message: job.error });
    scheduleExpiry(jobId);
  });
});

/**
 * GET /api/progress/:jobId
 * SSE stream. 'done' event carries only metadata (no CSV payload).
 */
app.get('/api/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  // Replay buffered events for late-connecting clients
  for (const { event, data } of (job.eventBuffer || [])) {
    send(event, data);
  }

  if (job.status === 'done' || job.status === 'error') return res.end();

  job.listeners.push(send);
  req.on('close', () => {
    job.listeners = job.listeners.filter((s) => s !== send);
  });
});

/**
 * GET /api/download/:jobId
 * Returns the completed CSV file as a download.
 * Available for JOB_TTL_MS (30 min) after completion.
 */
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job)                    return res.status(404).json({ error: 'Job not found or expired.' });
  if (job.status !== 'done')   return res.status(409).json({ error: 'Export not yet complete.' });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
  res.end(job.csv);
});

// -------- Helpers --------

function broadcastToJob(job, event, data) {
  const frame = { event, data };
  if (job.eventBuffer) job.eventBuffer.push(frame);
  for (const send of (job.listeners || [])) {
    try { send(event, data); } catch { /* disconnected */ }
  }
}

// -------- Core export logic --------

async function runExport({ jobId, job, apiKey, orgId }) {
  const send = (event, data) => broadcastToJob(job, event, data);
  const orgEnc = encodeURIComponent(orgId);
  const limit  = pLimit(CONCURRENCY);

  try {
    send('status', { message: 'Listing rooms...' });
    const roomsListResp = await pulseFetch(`/orgs/${orgEnc}/rooms`, apiKey);
    const roomStubs = roomsListResp?.rooms || roomsListResp?.items || [];

    send('status', {
      message: `Found ${roomStubs.length} rooms. Fetching room details + endpoints...`,
      phase: 'rooms',
      total: roomStubs.length,
    });

    let roomsFetched = 0;
    const roomDetails = await Promise.all(
      roomStubs.map((rs) =>
        limit(async () => {
          try {
            return await pulseFetch(`/orgs/${orgEnc}/rooms/${rs.id}`, apiKey);
          } catch (e) {
            return { id: rs.id, name: rs.name, _error: e.message, endpoints: [] };
          } finally {
            roomsFetched += 1;
            if (roomsFetched % 10 === 0 || roomsFetched === roomStubs.length) {
              send('progress', {
                phase: 'rooms',
                completed: roomsFetched,
                total: roomStubs.length,
                message: `Fetching room details: ${roomsFetched} / ${roomStubs.length}`,
              });
            }
          }
        }),
      ),
    );

    const endpointIndex = new Map();
    for (const room of roomDetails) {
      for (const ep of (Array.isArray(room.endpoints) ? room.endpoints : [])) {
        if (ep?.id) endpointIndex.set(ep.id, { endpoint: ep, room });
      }
    }

    send('status', { message: 'Listing endpoints to find orphans...' });
    const epListResp = await pulseFetch(`/orgs/${orgEnc}/endpoints`, apiKey);
    const allEndpointStubs = epListResp?.endpoints || epListResp?.items || [];

    const orphans = [];
    for (const es of allEndpointStubs) {
      const id = es.id || es.endpointId || es.uuid;
      if (id && !endpointIndex.has(id)) orphans.push(id);
    }

    if (orphans.length > 0) {
      send('status', { message: `Fetching ${orphans.length} unassigned endpoints...` });
      await Promise.all(
        orphans.map((id) =>
          limit(async () => {
            try {
              const detail = await pulseFetch(
                `/orgs/${orgEnc}/endpoints/${encodeURIComponent(id)}`, apiKey,
              );
              endpointIndex.set(id, { endpoint: detail, room: null });
            } catch (e) {
              endpointIndex.set(id, { endpoint: { id, _error: e.message }, room: null });
            }
          }),
        ),
      );
    }

    const totalEndpoints = endpointIndex.size;
    send('status', {
      message: `Resolved ${totalEndpoints} endpoints. Fetching configs (concurrency=${CONCURRENCY})...`,
      phase: 'configs',
      total: totalEndpoints,
    });

    let completed = 0;
    const profileCache = new Map();
    const profileMu    = new Map();

    async function getProfile(profileId) {
      if (!profileId) return null;
      if (profileCache.has(profileId)) return profileCache.get(profileId);
      if (profileMu.has(profileId))    return profileMu.get(profileId);
      const p = (async () => {
        try {
          const data = await pulseFetch(
            `/orgs/${orgEnc}/profiles/${encodeURIComponent(profileId)}`,
            apiKey, { allow404: true },
          );
          profileCache.set(profileId, data);
          return data;
        } catch (e) {
          profileCache.set(profileId, null);
          return null;
        } finally {
          profileMu.delete(profileId);
        }
      })();
      profileMu.set(profileId, p);
      return p;
    }

    const rows = await Promise.all(
      Array.from(endpointIndex.entries()).map(([id, { endpoint, room }]) =>
        limit(async () => {
          let config  = null;
          let profile = null;
          if (!endpoint._error) {
            try {
              config = await pulseFetch(
                `/orgs/${orgEnc}/endpoints/${encodeURIComponent(id)}/config`,
                apiKey, { allow404: true },
              );
            } catch (e) {
              endpoint._configError = e.message;
            }
            if (endpoint.profileId) profile = await getProfile(endpoint.profileId);
          }
          completed += 1;
          send('progress', { phase: 'configs', completed, total: totalEndpoints });
          if (endpoint._error) return { id, _error: endpoint._error };
          const row = buildRow({ endpoint, room, config, profile });
          if (endpoint._configError) row['_configError'] = endpoint._configError;
          return row;
        }),
      ),
    );

    send('status', { message: 'Building CSV...' });

    const preferred = [
      'id', 'serial', 'pairingSerial', 'model', 'upgradeModel', 'buildType', 'orientation',
      'roomId', 'roomName', 'locationId', 'locationName', 'regionId', 'regionName',
      'dec', 'decTimeout', 'occupancy',
      'profileId', 'profileName', 'profileDescription', 'profileConfigId',
      'connected', 'inCallStatus', 'connectionTime', 'enrolmentTime', 'remoteControlEnabled',
      'firmwareVersion', 'firmwareReleaseName', 'latestVersion', 'latestReleaseName',
      'otaChannel', 'upgradeStatus', 'hasScheduledFirmwareUpdate',
      'hasUnscheduledFirmwareUpdate', 'upgradeTime', 'hexapaBuild', 'automaticUpdates',
      'ntpServerConfigured', 'ntpServerActive', 'ntpServerReachable', 'timezone',
      'primaryMode', 'controllerMode', 'bulkEnrolmentPending', 'localIpAddress',
    ];
    const allKeys       = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const networkKeys   = allKeys.filter((k) => k.startsWith('network.')).sort();
    const storageKeys   = allKeys.filter((k) => k.startsWith('storage.')).sort();
    const effectiveKeys = allKeys.filter((k) => k.startsWith('effective.')).sort();
    const configKeys    = allKeys.filter((k) => k.startsWith('config.')).sort();
    const profileKeys   = allKeys.filter((k) => k.startsWith('profile.') && !preferred.includes(k)).sort();
    const sourceKeys    = allKeys.filter((k) => k.startsWith('_source.')).sort();
    const errorKeys     = allKeys.filter((k) => k.startsWith('_') && !k.startsWith('_source.')).sort();
    const otherKeys     = allKeys.filter(
      (k) => !preferred.includes(k) &&
             !['network.','storage.','effective.','config.','profile.','_'].some(p => k.startsWith(p)),
    ).sort();

    const columns = [
      ...preferred.filter((k) => allKeys.includes(k)),
      ...networkKeys, ...storageKeys,
      ...effectiveKeys, ...configKeys, ...profileKeys,
      ...sourceKeys, ...otherKeys, ...errorKeys,
    ];

    const filename = `neat_pulse_export_${new Date().toISOString().slice(0, 10)}.csv`;
    const csvBody  = '\uFEFF' + stringify(rows, { header: true, columns });

    // Store CSV server-side; only metadata goes over SSE
    job.status   = 'done';
    job.csv      = csvBody;
    job.filename = filename;
    job.meta     = {
      jobId,
      filename,
      deviceCount: totalEndpoints,
      roomCount: roomStubs.length,
      orphanCount: orphans.length,
      profileCount: profileCache.size,
      errorCount: rows.filter((r) => r._error).length,
      columnCount: columns.length,
    };
    scheduleExpiry(jobId);
    send('done', job.meta); // metadata only — no csv field

  } catch (e) {
    job.status = 'error';
    job.error  = e.message || String(e);
    scheduleExpiry(jobId);
    send('error', { message: job.error, status: e.status });
  }
}

app.listen(PORT, HOST, () => {
  console.log(`Neat Pulse Exporter  →  http://${HOST}:${PORT}`);
});
