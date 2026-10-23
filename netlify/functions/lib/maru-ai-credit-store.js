'use strict';

/*
 * MARU AI V190 credit ledger stored in Auth0 app_metadata.
 *
 * This intentionally keeps the Android V190 rollout self-contained: no browser-supplied
 * balance is trusted, and no new database is required. The server reads/writes only the
 * authenticated user's app_metadata through Auth0 Management API.
 *
 * Units are "AI minutes-equivalent":
 * - subtitle generation: 1.0 unit per source audio minute
 * - subtitle translation: configurable fraction of source subtitle duration
 * - extra-credit product: configurable units per verified one-time purchase
 *
 * Plan limits are server-configurable so unit economics can be tuned without rebuilding
 * the Android app.
 */

const crypto = require('crypto');

const META_KEY = 'maru_ai_billing_v190';
const TOKEN_CACHE = { value: '', expiresAt: 0 };
const MAX_EVENT_ROWS = 160;
const MAX_TOPUP_ROWS = 80;
const MAX_MUTATION_ATTEMPTS = 3;
const USER_MUTATION_CHAINS = new Map();

function clean(v) { return String(v == null ? '' : v).trim(); }
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round3(v) { return Math.round(Math.max(0, num(v, 0)) * 1000) / 1000; }
function requiredEnv(name) {
  const v = clean(process.env[name]);
  if (!v) {
    const e = new Error(`Missing required server setting: ${name}`);
    e.statusCode = 503; e.code = 'billing_store_misconfigured';
    throw e;
  }
  return v;
}
function auth0Env() {
  const domain = requiredEnv('AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    domain,
    clientId: requiredEnv('AUTH0_M2M_CLIENT_ID'),
    clientSecret: requiredEnv('AUTH0_M2M_CLIENT_SECRET'),
    audience: clean(process.env.AUTH0_AUDIENCE) || `https://${domain}/api/v2/`
  };
}
function billingError(statusCode, code, message, detail) {
  const e = new Error(message || code);
  e.statusCode = statusCode || 500;
  e.code = code || 'billing_store_error';
  e.detail = detail || null;
  return e;
}
async function managementToken() {
  if (TOKEN_CACHE.value && TOKEN_CACHE.expiresAt - Date.now() > 60000) return TOKEN_CACHE.value;
  const env = auth0Env();
  let response;
  try {
    response = await fetch(`https://${env.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: env.clientId,
        client_secret: env.clientSecret,
        audience: env.audience
      })
    });
  } catch (_) {
    throw billingError(503, 'billing_store_unavailable', 'MARU credit storage is temporarily unavailable.');
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok || !payload || !payload.access_token) {
    throw billingError(503, 'billing_store_misconfigured', 'MARU credit storage authorization failed.');
  }
  const ttl = Math.max(300, Math.min(3600, Number(payload.expires_in || 3600) || 3600));
  TOKEN_CACHE.value = String(payload.access_token);
  TOKEN_CACHE.expiresAt = Date.now() + ttl * 1000;
  return TOKEN_CACHE.value;
}
async function auth0Request(method, path, body) {
  const env = auth0Env();
  const token = await managementToken();
  let response;
  try {
    response = await fetch(`https://${env.domain}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (_) {
    throw billingError(503, 'billing_store_unavailable', 'MARU credit storage is temporarily unavailable.');
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (response.status === 401 || response.status === 403) {
    TOKEN_CACHE.value = ''; TOKEN_CACHE.expiresAt = 0;
    throw billingError(503, 'billing_store_misconfigured', 'MARU credit storage permission is not configured correctly.');
  }
  if (!response.ok) {
    throw billingError(response.status || 502, 'billing_store_failed', clean(payload && (payload.message || payload.error)) || 'MARU credit storage update failed.');
  }
  return payload || {};
}
async function getUser(userId) {
  const id = clean(userId);
  if (!id) throw billingError(401, 'authentication_required', 'A signed-in MARU account is required.');
  return auth0Request('GET', `/api/v2/users/${encodeURIComponent(id)}`);
}
async function patchBillingMetadata(userId, state) {
  // Patch only MARU's dedicated top-level metadata key. Do not replay the whole
  // app_metadata object, which could overwrite unrelated concurrent profile updates.
  return auth0Request('PATCH', `/api/v2/users/${encodeURIComponent(clean(userId))}`, {
    app_metadata: { [META_KEY]: state }
  });
}
function withUserMutation(userId, task) {
  const key = clean(userId);
  const previous = USER_MUTATION_CHAINS.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  USER_MUTATION_CHAINS.set(key, current);
  current.then(
    () => { if (USER_MUTATION_CHAINS.get(key) === current) USER_MUTATION_CHAINS.delete(key); },
    () => { if (USER_MUTATION_CHAINS.get(key) === current) USER_MUTATION_CHAINS.delete(key); }
  );
  return current;
}
function normalizeEventRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((x) => x && clean(x.h)).slice(-MAX_EVENT_ROWS).map((x) => ({
    h: clean(x.h).slice(0, 64),
    units: round3(x.units),
    planUnits: round3(x.planUnits),
    extraUnits: round3(x.extraUnits),
    action: clean(x.action).slice(0, 48),
    at: clean(x.at).slice(0, 40)
  }));
}
function normalizeTopupRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((x) => x && clean(x.h)).slice(-MAX_TOPUP_ROWS).map((x) => ({
    h: clean(x.h).slice(0, 64),
    units: round3(x.units),
    at: clean(x.at).slice(0, 40)
  }));
}
function normalizeState(raw) {
  const x = raw && typeof raw === 'object' ? raw : {};
  return {
    schema: 'maru-ai-billing/v190',
    periodKey: clean(x.periodKey),
    periodExpiresAt: clean(x.periodExpiresAt),
    periodProductId: clean(x.periodProductId),
    periodUsageUnits: round3(x.periodUsageUnits),
    extraCreditUnits: round3(x.extraCreditUnits),
    events: normalizeEventRows(x.events),
    topups: normalizeTopupRows(x.topups),
    updatedAt: clean(x.updatedAt)
  };
}
function hashKey(value) {
  return crypto.createHash('sha256').update(clean(value)).digest('hex').slice(0, 40);
}
function periodKeyForAccess(access) {
  const expiry = clean(access && access.googlePlayExpiryTime);
  if (expiry) return `play:${expiry}`;
  const now = new Date();
  return `legacy:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
function syncBillingPeriod(access, state) {
  if (!state || !access || access.accessClass !== 'google_play_paid_member') return false;
  const before = JSON.stringify({
    periodKey: state.periodKey,
    periodExpiresAt: state.periodExpiresAt,
    periodProductId: state.periodProductId,
    periodUsageUnits: state.periodUsageUnits,
    eventCount: state.events.length
  });
  const currentExpiryText = clean(access.googlePlayExpiryTime);
  const currentExpiryMs = Date.parse(currentExpiryText);
  const currentProduct = clean(access.googlePlayProductId);
  const storedExpiryMs = Date.parse(clean(state.periodExpiresAt));
  const storedProduct = clean(state.periodProductId);
  let reset = false;

  if (Number.isFinite(currentExpiryMs) && currentExpiryMs > 0) {
    if (Number.isFinite(storedExpiryMs) && storedExpiryMs > 0 && currentExpiryMs !== storedExpiryMs) {
      // Same-product expiry extension is a normal renewal and starts a fresh allowance.
      // Product replacement is treated conservatively: existing usage is preserved so
      // Pro<->Premium switching cannot reset consumed monthly units mid-period.
      if (!storedProduct || !currentProduct || storedProduct === currentProduct) {
        if (currentExpiryMs > storedExpiryMs) reset = true;
      }
    }
    state.periodExpiresAt = currentExpiryText;
    state.periodKey = `play:${currentExpiryText}`;
    state.periodProductId = currentProduct;
  } else {
    const key = periodKeyForAccess(access);
    if (state.periodKey && state.periodKey !== key) reset = true;
    state.periodKey = key;
    state.periodExpiresAt = '';
    state.periodProductId = currentProduct;
  }

  if (reset) {
    state.periodUsageUnits = 0;
    state.events = [];
  }
  const after = JSON.stringify({
    periodKey: state.periodKey,
    periodExpiresAt: state.periodExpiresAt,
    periodProductId: state.periodProductId,
    periodUsageUnits: state.periodUsageUnits,
    eventCount: state.events.length
  });
  return before !== after;
}
function planLimitForAccess(access) {
  const direct = num(access && access.monthlyCreditUnits, 0);
  if (direct > 0) return round3(direct);
  const premium = clean(access && access.plan) === 'GOOGLE_PLAY_PREMIUM';
  const envValue = Number(process.env[premium ? 'MARU_AI_PREMIUM_MONTHLY_UNITS' : 'MARU_AI_PRO_MONTHLY_UNITS']);
  if (Number.isFinite(envValue) && envValue > 0) return round3(envValue);
  return premium ? 1200 : 400;
}
async function readState(userId) {
  const user = await getUser(userId);
  const appMetadata = user && user.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {};
  return { user, state: normalizeState(appMetadata[META_KEY]) };
}
async function writeState(userId, state) {
  state.updatedAt = new Date().toISOString();
  await patchBillingMetadata(userId, state);
  return state;
}
function balanceSnapshot(access, state) {
  const limit = planLimitForAccess(access);
  return {
    plan: clean(access && access.plan),
    monthlyLimitUnits: limit,
    monthlyUsedUnits: round3(state.periodUsageUnits),
    monthlyRemainingUnits: round3(Math.max(0, limit - state.periodUsageUnits)),
    extraCreditUnits: round3(state.extraCreditUnits),
    periodKey: state.periodKey
  };
}
async function chargeUsage(access, eventKey, units, action) {
  if (!access || !access.userId) throw billingError(401, 'authentication_required', 'A signed-in MARU account is required.');
  if (access.accessClass === 'privileged') return { bypass: true, privileged: true };
  if (access.accessClass !== 'google_play_paid_member') return { bypass: true, legacyPaid: true };

  const cost = round3(units);
  if (!(cost > 0)) return { bypass: true, zeroCost: true };
  const eventHash = hashKey(eventKey || `${access.userId}|${action}|${Date.now()}`);

  return withUserMutation(access.userId, async () => {
    for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
      const loaded = await readState(access.userId);
      const state = loaded.state;
      syncBillingPeriod(access, state);
      const existing = state.events.find((row) => row.h === eventHash);
      if (existing) return Object.assign({ idempotent: true, eventHash }, balanceSnapshot(access, state));

      const limit = planLimitForAccess(access);
      const planRemaining = Math.max(0, limit - state.periodUsageUnits);
      const planUse = round3(Math.min(cost, planRemaining));
      const extraUse = round3(Math.max(0, cost - planUse));
      if (extraUse > state.extraCreditUnits + 0.0005) {
        throw billingError(402, 'ai_credit_required', 'MARU AI credits are not sufficient for this operation.', {
          requiredUnits: cost,
          monthlyRemainingUnits: round3(planRemaining),
          extraCreditUnits: round3(state.extraCreditUnits)
        });
      }

      state.periodUsageUnits = round3(state.periodUsageUnits + planUse);
      state.extraCreditUnits = round3(Math.max(0, state.extraCreditUnits - extraUse));
      state.events.push({
        h: eventHash,
        units: cost,
        planUnits: planUse,
        extraUnits: extraUse,
        action: clean(action).slice(0, 48),
        at: new Date().toISOString()
      });
      state.events = state.events.slice(-MAX_EVENT_ROWS);
      await writeState(access.userId, state);

      // Read-after-write verification repairs rare cross-instance lost updates. If another
      // server instance overwrote this metadata key concurrently, retry against the newest
      // ledger instead of silently losing a debit/idempotency marker.
      const confirmed = (await readState(access.userId)).state;
      const row = confirmed.events.find((item) => item.h === eventHash);
      if (row) {
        return Object.assign({ charged: true, eventHash, chargedUnits: cost }, balanceSnapshot(access, confirmed));
      }
    }
    throw billingError(503, 'billing_store_conflict', 'MARU credit ledger was updated concurrently. Please retry.');
  });
}

async function refundUsageByHash(access, eventHash) {
  if (!access || !access.userId || access.accessClass !== 'google_play_paid_member') return { refunded: false };
  const wanted = clean(eventHash).slice(0, 64);
  if (!wanted) return { refunded: false };
  return withUserMutation(access.userId, async () => {
    for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
      const loaded = await readState(access.userId);
      const state = loaded.state;
      const index = state.events.findIndex((row) => row.h === wanted);
      if (index < 0) return { refunded: false, alreadyAbsent: true };
      const row = state.events[index];
      state.periodUsageUnits = round3(Math.max(0, state.periodUsageUnits - round3(row.planUnits)));
      state.extraCreditUnits = round3(state.extraCreditUnits + round3(row.extraUnits));
      state.events.splice(index, 1);
      await writeState(access.userId, state);
      const confirmed = (await readState(access.userId)).state;
      if (!confirmed.events.some((item) => item.h === wanted)) {
        return Object.assign({ refunded: true, eventHash: wanted }, balanceSnapshot(access, confirmed));
      }
    }
    throw billingError(503, 'billing_store_conflict', 'MARU credit refund could not be confirmed. Please retry.');
  });
}

async function refundUsage(access, eventKey) {
  return refundUsageByHash(access, hashKey(eventKey));
}

async function getTopupGrant(userId, purchaseToken) {
  const tokenHash = hashKey(purchaseToken);
  const loaded = await readState(userId);
  const existing = loaded.state.topups.find((row) => row.h === tokenHash);
  if (!existing) return null;
  return {
    tokenHash,
    grantedUnits: round3(existing.units),
    extraCreditUnits: round3(loaded.state.extraCreditUnits),
    at: clean(existing.at)
  };
}

async function grantTopup(userId, purchaseToken, units) {
  const id = clean(userId);
  if (!id) throw billingError(401, 'authentication_required', 'A signed-in MARU account is required.');
  const tokenHash = hashKey(purchaseToken);
  const grantUnits = round3(units);
  if (!(grantUnits > 0)) throw billingError(503, 'billing_store_misconfigured', 'Extra-credit grant amount is invalid.');

  return withUserMutation(id, async () => {
    for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
      const loaded = await readState(id);
      const state = loaded.state;
      const existing = state.topups.find((row) => row.h === tokenHash);
      if (existing) {
        return { granted: false, alreadyGranted: true, grantedUnits: round3(existing.units), extraCreditUnits: round3(state.extraCreditUnits), tokenHash };
      }
      state.extraCreditUnits = round3(state.extraCreditUnits + grantUnits);
      state.topups.push({ h: tokenHash, units: grantUnits, at: new Date().toISOString() });
      state.topups = state.topups.slice(-MAX_TOPUP_ROWS);
      await writeState(id, state);
      const confirmed = (await readState(id)).state;
      const row = confirmed.topups.find((item) => item.h === tokenHash);
      if (row) {
        return { granted: true, alreadyGranted: false, grantedUnits: round3(row.units), extraCreditUnits: round3(confirmed.extraCreditUnits), tokenHash };
      }
    }
    throw billingError(503, 'billing_store_conflict', 'MARU top-up ledger was updated concurrently. Please retry.');
  });
}

async function getBalance(access) {
  if (!access || !access.userId) throw billingError(401, 'authentication_required', 'A signed-in MARU account is required.');
  const loaded = await readState(access.userId);
  const state = loaded.state;
  const periodChanged = syncBillingPeriod(access, state);
  if (periodChanged) await writeState(access.userId, state);
  return balanceSnapshot(access, state);
}

async function checkAllowance(access, units) {
  if (!access || !access.userId) throw billingError(401, 'authentication_required', 'A signed-in MARU account is required.');
  if (access.accessClass === 'privileged' || access.accessClass !== 'google_play_paid_member') {
    return { allowed: true, bypass: true };
  }
  const cost = round3(units);
  const loaded = await readState(access.userId);
  const state = loaded.state;
  const periodChanged = syncBillingPeriod(access, state);
  if (periodChanged) await writeState(access.userId, state);
  const snapshot = balanceSnapshot(access, state);
  const available = round3(snapshot.monthlyRemainingUnits + snapshot.extraCreditUnits);
  return Object.assign({ allowed: !(cost > available + 0.0005), requiredUnits: cost, availableUnits: available }, snapshot);
}

module.exports = {
  billingError,
  chargeUsage,
  refundUsage,
  refundUsageByHash,
  grantTopup,
  getTopupGrant,
  getBalance,
  checkAllowance,
  hashKey,
  planLimitForAccess
};
