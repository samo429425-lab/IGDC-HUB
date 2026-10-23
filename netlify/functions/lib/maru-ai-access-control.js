'use strict';

/*
 * MARU paid-AI access boundary — Google Play Billing edition (V190).
 *
 * Security rules:
 * - Browser/body identity, role, paid, subscription and license labels are never trusted.
 * - A signed Auth0 bearer token is verified through member-admin?action=me.
 * - owner/admin/super_admin retain privileged access.
 * - Android paid access may be proved by a Google Play purchase token. The token is
 *   verified server-to-server against Android Publisher before AI access is granted.
 * - Legacy external-PG/member_premium access remains available as a fallback.
 */

const crypto = require('crypto');
const { chargeUsage } = require('./maru-ai-credit-store');

const DEFAULT_PRIVILEGED_ROLES = Object.freeze(['owner', 'admin', 'super_admin']);
const DEFAULT_PAID_ROLES = Object.freeze(['member_premium']);
const GOOGLE_PLAY_PACKAGE = 'com.maru.mediaplayer';
const GOOGLE_PLAY_PRO_PRODUCT_DEFAULT = 'maru_ai_pro_monthly';
const GOOGLE_PLAY_PREMIUM_PRODUCT_DEFAULT = 'maru_ai_premium_monthly';
const GOOGLE_PLAY_BASE_PLAN_DEFAULT = 'monthly';
const GOOGLE_PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RATE_STATE = new Map();
const PLAY_VERIFY_CACHE = new Map();
let googleAccessTokenCache = { token: '', expiresAt: 0 };
let googleServiceAccountCache = { value: null, expiresAt: 0 };

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizeRole(value) { return clean(value).toLowerCase().replace(/[\s.\-]+/g, '_'); }
function uniqueRoles(values) {
  const input = Array.isArray(values) ? values : [values];
  return [...new Set(input.flatMap((value) => typeof value === 'string' ? value.split(',') : []).map(normalizeRole).filter(Boolean))];
}
function envRoles(name, fallback) {
  const configured = uniqueRoles(clean(process.env[name]).split(','));
  return new Set(configured.length ? configured : fallback);
}
function privilegedRoles() { return envRoles('MARU_AI_PRIVILEGED_ROLES', DEFAULT_PRIVILEGED_ROLES); }
function paidRoles() { return envRoles('MARU_AI_PAID_ROLES', DEFAULT_PAID_ROLES); }
function envTrue(name) { return /^(1|true|yes|on)$/i.test(clean(process.env[name])); }
function pgExecutionReady() {
  const rawProvider = clean(process.env.IGDC_PG_PROVIDER || process.env.PG_PROVIDER);
  const provider = ['', 'auto', 'none', 'pending'].includes(rawProvider.toLowerCase()) ? '' : rawProvider;
  return (
    envTrue('IGDC_PG_APPROVED') &&
    envTrue('IGDC_PG_EXECUTION_ENABLED') &&
    envTrue('PAYMENT_LIVE') &&
    Boolean(provider) &&
    /^https:\/\//i.test(clean(process.env.IGDC_PG_CHECKOUT_BRIDGE_URL)) &&
    Boolean(clean(process.env.IGDC_PG_BRIDGE_TOKEN))
  );
}
function getHeader(event, name) {
  const headers = event && event.headers || {};
  const wanted = clean(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (clean(key).toLowerCase() === wanted) return clean(value);
  }
  return '';
}
function bearerToken(event) {
  const raw = getHeader(event, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? clean(match[1]) : '';
}
function clientIp(event) {
  const raw = getHeader(event, 'x-nf-client-connection-ip') || getHeader(event, 'x-forwarded-for') || 'unknown';
  return clean(raw.split(',')[0]).slice(0, 96) || 'unknown';
}
function accessError(statusCode, code, message, detail) {
  const error = new Error(message || code);
  error.statusCode = Number(statusCode) || 500;
  error.code = code || 'ai_access_denied';
  error.detail = detail || null;
  return error;
}
function authVerifyUrl() {
  const explicit = clean(process.env.MARU_AUTH_VERIFY_URL);
  const siteBase = clean(process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://igdcglobal.com').replace(/\/+$/, '');
  const raw = explicit || `${siteBase}/.netlify/functions/member-admin?action=me`;
  let url;
  try { url = new URL(raw); } catch (_) { throw accessError(503, 'auth_verifier_misconfigured', 'AI authorization verifier URL is invalid.'); }
  if (url.protocol !== 'https:') throw accessError(503, 'auth_verifier_misconfigured', 'AI authorization verifier must use HTTPS.');
  return url.toString();
}
async function verifyMember(event) {
  const token = bearerToken(event);
  if (!token) throw accessError(401, 'authentication_required', 'A valid signed-in account is required.');

  let response;
  try {
    response = await fetch(authVerifyUrl(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error'
    });
  } catch (_) {
    throw accessError(503, 'authorization_service_unavailable', 'AI authorization could not be verified.');
  }

  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (response.status === 401) throw accessError(401, 'authentication_invalid', 'The login token is missing, invalid, or expired.');
  if (response.status === 403) throw accessError(403, 'account_forbidden', 'This account is not permitted to use MARU AI.');
  if (!response.ok || !payload || payload.ok !== true || !payload.me) {
    throw accessError(503, 'authorization_service_unavailable', 'AI authorization could not be verified.');
  }

  const me = payload.me || {};
  const roles = uniqueRoles([...(Array.isArray(me.roles) ? me.roles : []), me.role]);
  return {
    userId: clean(me.user_id || me.sub),
    email: clean(me.email).toLowerCase(),
    roles,
    role: normalizeRole(me.role || roles[0] || 'member')
  };
}

function parseJsonBody(event) {
  if (!event || String(event.httpMethod || '').toUpperCase() !== 'POST' || !event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(String(event.body), 'base64').toString('utf8') : String(event.body);
    return JSON.parse(raw || '{}') || {};
  } catch (_) { return {}; }
}
function googlePlayProof(event) {
  const body = parseJsonBody(event);
  const packageName = clean(body.googlePlayPackageName);
  const productId = clean(body.googlePlayProductId);
  const purchaseToken = clean(body.googlePlayPurchaseToken);
  if (!packageName || !productId || !purchaseToken) return null;
  return { packageName, productId, purchaseToken };
}

function requestPlatform(event) {
  const body = parseJsonBody(event);
  const platform = clean(body.platform).toLowerCase();
  const channel = clean(body.channel).toLowerCase();
  const client = clean(body.client).toLowerCase();
  if (platform) return platform;
  if (channel === 'mobile-player' || client.includes('maru media player')) return 'android';
  return '';
}
function isAndroidRequest(event) {
  return requestPlatform(event) === 'android';
}
function paidFeatureDisabled(purpose) {
  const action = clean(purpose).toLowerCase().replace(/_/g, '-');
  if (!action) return false;
  const dubbing = action.includes('dubbing') || ['tts', 'text-to-speech', 'generate-speech', 'speech'].includes(action);
  if (dubbing && !envTrue('MARU_AI_DUBBING_ENABLED')) return 'dubbing';
  const videoEnhance = action.includes('video-enhance') || action.includes('video-enhancement') || action.includes('enhance-video');
  if (videoEnhance && !envTrue('MARU_AI_VIDEO_ENHANCEMENT_ENABLED')) return 'video-enhancement';
  return false;
}
function googlePlayProProductId() {
  return clean(process.env.MARU_GOOGLE_PLAY_PRO_PRODUCT_ID || process.env.MARU_GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID)
    || GOOGLE_PLAY_PRO_PRODUCT_DEFAULT;
}
function googlePlayPremiumProductId() {
  return clean(process.env.MARU_GOOGLE_PLAY_PREMIUM_PRODUCT_ID) || GOOGLE_PLAY_PREMIUM_PRODUCT_DEFAULT;
}
function googlePlayProBasePlanId() {
  return clean(process.env.MARU_GOOGLE_PLAY_PRO_BASE_PLAN_ID) || GOOGLE_PLAY_BASE_PLAN_DEFAULT;
}
function googlePlayPremiumBasePlanId() {
  return clean(process.env.MARU_GOOGLE_PLAY_PREMIUM_BASE_PLAN_ID) || GOOGLE_PLAY_BASE_PLAN_DEFAULT;
}
function expectedBasePlanId(productId) {
  return productId === googlePlayPremiumProductId() ? googlePlayPremiumBasePlanId() : googlePlayProBasePlanId();
}
function isAllowedSubscriptionProduct(productId) {
  return productId === googlePlayProProductId() || productId === googlePlayPremiumProductId();
}
function positiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
function creditUnitsForProduct(productId) {
  return productId === googlePlayPremiumProductId()
    ? positiveNumberEnv('MARU_AI_PREMIUM_MONTHLY_UNITS', 1200)
    : positiveNumberEnv('MARU_AI_PRO_MONTHLY_UNITS', 400);
}
function planCodeForProduct(productId) {
  return productId === googlePlayPremiumProductId() ? 'GOOGLE_PLAY_PREMIUM' : 'GOOGLE_PLAY_PRO';
}
function googlePlayAccountBindingCandidates(member) {
  const values = [clean(member && member.email).toLowerCase(), clean(member && member.userId).toLowerCase()].filter(Boolean);
  return [...new Set(values.map((value) => crypto.createHash('sha256').update(`maru-billing|${value}`).digest('hex')))];
}
function googlePlayAccountBindingMatches(member, obfuscatedAccountId) {
  const supplied = clean(obfuscatedAccountId).toLowerCase();
  if (!supplied) return false;
  return googlePlayAccountBindingCandidates(member).includes(supplied);
}
function parseGoogleServiceAccount(value) {
  let raw = clean(value);
  if (!raw) return null;
  try {
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    const clientEmail = clean(parsed.client_email);
    const privateKey = clean(parsed.private_key).replace(/\\n/g, '\n');
    return clientEmail && privateKey ? { clientEmail, privateKey } : null;
  } catch (_) { return null; }
}
function googleServiceAccountFromEnv() {
  const fromJson = parseGoogleServiceAccount(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (fromJson) return fromJson;
  const clientEmail = clean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const privateKey = clean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).replace(/\\n/g, '\n');
  return clientEmail && privateKey ? { clientEmail, privateKey } : null;
}
function supabaseSecretStoreConfig() {
  const candidates = [
    {
      url: clean(process.env.GSLOT_SUPABASE_URL).replace(/\/+$/, ''),
      key: clean(process.env.GSLOT_SUPABASE_SECRET_KEY || process.env.GSLOT_SUPABASE_SERVICE_ROLE_KEY || process.env.GSLOT_SUPABASE_SERVICE_KEY),
      source: 'gslot'
    },
    {
      url: clean(process.env.SUPABASE_URL).replace(/\/+$/, ''),
      key: clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
      source: 'default'
    }
  ];
  for (const item of candidates) {
    if (/^https:\/\/[^/]+$/i.test(item.url) && item.key) return item;
  }
  return null;
}
async function googleServiceAccountFromSupabase() {
  const now = Date.now();
  if (googleServiceAccountCache.value && googleServiceAccountCache.expiresAt > now) return googleServiceAccountCache.value;
  const config = supabaseSecretStoreConfig();
  if (!config) return null;
  const endpoint = `${config.url}/rest/v1/igdc_server_secrets?secret_name=eq.google_play_service_account_json&select=secret_value&limit=1`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: 'application/json'
      }
    });
  } catch (_) {
    throw accessError(503, 'google_play_secret_store_unavailable', 'Google Play credential storage is temporarily unavailable.');
  }
  let rows = null;
  try { rows = await response.json(); } catch (_) { rows = null; }
  if (!response.ok) {
    throw accessError(503, 'google_play_secret_store_misconfigured', 'Google Play credential storage is not configured correctly.');
  }
  const raw = Array.isArray(rows) && rows[0] ? rows[0].secret_value : '';
  const account = parseGoogleServiceAccount(raw);
  if (!account) return null;
  googleServiceAccountCache = { value: account, expiresAt: now + 5 * 60 * 1000 };
  return account;
}
async function googleServiceAccount() {
  return googleServiceAccountFromEnv() || await googleServiceAccountFromSupabase();
}
function googlePlayBillingConfigured() {
  if (!envTrue('MARU_GOOGLE_PLAY_BILLING_ENABLED')) return false;
  return Boolean(googleServiceAccountFromEnv() || supabaseSecretStoreConfig());
}
function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function googleAccessToken() {
  const now = Date.now();
  if (googleAccessTokenCache.token && googleAccessTokenCache.expiresAt - now > 60 * 1000) {
    return googleAccessTokenCache.token;
  }
  const service = await googleServiceAccount();
  if (!service) throw accessError(503, 'google_play_verifier_misconfigured', 'Google Play server verification credentials are not configured.');
  const nowSec = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: service.clientEmail,
    scope: GOOGLE_PLAY_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600
  }));
  const unsigned = `${header}.${claims}`;
  let signature;
  try {
    signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned, 'utf8'), service.privateKey);
  } catch (_) {
    throw accessError(503, 'google_play_verifier_misconfigured', 'Google Play service-account private key is invalid.');
  }
  const assertion = `${unsigned}.${base64Url(signature)}`;
  let response;
  try {
    response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString()
    });
  } catch (_) {
    throw accessError(503, 'google_play_verifier_unavailable', 'Google Play purchase verification is temporarily unavailable.');
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok || !payload || !payload.access_token) {
    throw accessError(503, 'google_play_verifier_misconfigured', 'Google Play service-account authorization failed.');
  }
  const expiresIn = Math.max(300, Math.min(3600, Number(payload.expires_in || 3600) || 3600));
  googleAccessTokenCache = { token: String(payload.access_token), expiresAt: now + expiresIn * 1000 };
  return googleAccessTokenCache.token;
}
function maxSubscriptionExpiry(payload) {
  let max = 0;
  const items = Array.isArray(payload && payload.lineItems) ? payload.lineItems : [];
  for (const item of items) {
    const expiry = Date.parse(clean(item && item.expiryTime));
    if (Number.isFinite(expiry) && expiry > max) max = expiry;
  }
  return max;
}
function subscriptionBasePlanId(payload, expectedProductId) {
  const items = Array.isArray(payload && payload.lineItems) ? payload.lineItems : [];
  for (const item of items) {
    if (expectedProductId && clean(item && item.productId) !== expectedProductId) continue;
    const offerDetails = item && item.offerDetails || {};
    const basePlanId = clean(offerDetails.basePlanId || item.basePlanId);
    if (basePlanId) return basePlanId;
  }
  return '';
}
async function verifyGooglePlaySubscription(event, member) {
  const proof = googlePlayProof(event);
  if (!proof) return { supplied: false, active: false };
  if (!googlePlayBillingConfigured()) {
    throw accessError(503, 'google_play_verifier_misconfigured', 'Google Play Billing is not enabled on the MARU server.');
  }
  if (proof.packageName !== GOOGLE_PLAY_PACKAGE || !isAllowedSubscriptionProduct(proof.productId)) {
    throw accessError(402, 'ai_membership_required', 'The Google Play purchase does not match the MARU AI subscription.');
  }
  const tokenHash = crypto.createHash('sha256').update(proof.purchaseToken).digest('hex');
  // Cache must be scoped to the authenticated MARU account as well as the Play token.
  // Otherwise a recently verified token could be replayed under another signed-in account
  // during the short cache window without re-evaluating the account binding.
  const memberCacheKey = crypto.createHash('sha256')
    .update(clean(member && (member.userId || member.email)).toLowerCase())
    .digest('hex').slice(0, 20);
  const verifyCacheKey = `${tokenHash}:${memberCacheKey}`;
  const cached = PLAY_VERIFY_CACHE.get(verifyCacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const accessToken = await googleAccessToken();
  const endpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(proof.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(proof.purchaseToken)}`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    });
  } catch (_) {
    throw accessError(503, 'google_play_verifier_unavailable', 'Google Play purchase verification is temporarily unavailable.');
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (response.status === 401 || response.status === 403) {
    googleAccessTokenCache = { token: '', expiresAt: 0 };
    throw accessError(503, 'google_play_verifier_misconfigured', 'Google Play purchase verifier permission is not configured correctly.');
  }
  if (!response.ok || !payload) {
    const value = { supplied: true, active: false, productId: proof.productId, state: 'not_found', basePlanId: '', planCode: '', monthlyCreditUnits: 0 };
    PLAY_VERIFY_CACHE.set(verifyCacheKey, { expiresAt: Date.now() + 30 * 1000, value });
    return value;
  }

  const lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  const productMatch = lineItems.some((item) => clean(item && item.productId) === proof.productId);
  // V190 checkouts bind the Play purchase to the signed-in MARU account using a one-way
  // SHA-256 identifier. V189 purchases have no identifier, so absence remains compatible;
  // if Play supplies an identifier it must match the authenticated account.
  const externalIds = payload.externalAccountIdentifiers || {};
  const boundAccountId = clean(externalIds.obfuscatedExternalAccountId);
  const accountBindingValid = !boundAccountId || googlePlayAccountBindingMatches(member, boundAccountId);
  const state = clean(payload.subscriptionState);
  const expiry = maxSubscriptionExpiry(payload);
  const now = Date.now();
  const activeState = state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
  const cancelledButEntitled = state === 'SUBSCRIPTION_STATE_CANCELED' && expiry > now;
  const active = productMatch && expiry > now && (activeState || cancelledButEntitled);
  const basePlanId = subscriptionBasePlanId(payload, proof.productId);
  const knownBasePlan = basePlanId === expectedBasePlanId(proof.productId);
  const value = {
    supplied: true,
    active: active && knownBasePlan && accountBindingValid,
    productId: proof.productId,
    state,
    basePlanId,
    planCode: planCodeForProduct(proof.productId),
    monthlyCreditUnits: creditUnitsForProduct(proof.productId),
    expiryTime: expiry > 0 ? new Date(expiry).toISOString() : ''
  };
  PLAY_VERIFY_CACHE.set(verifyCacheKey, { expiresAt: Date.now() + (value.active ? 60 : 30) * 1000, value });
  return value;
}

function bodyForUsage(event) {
  return parseJsonBody(event);
}
function subtitleDurationMinutesFromText(text) {
  const raw = clean(text).replace(/\r/g, '');
  const re = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->/g;
  let maxStart = 0;
  let match;
  while ((match = re.exec(raw))) {
    const ms = (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000)
      + Number(String(match[4]).padEnd(3, '0').slice(0, 3));
    if (Number.isFinite(ms) && ms > maxStart) maxStart = ms;
  }
  if (maxStart > 0) return Math.max(0.25, maxStart / 60000);
  // Fallback only when timestamps are unavailable. Rough subtitle reading rate keeps
  // translation charging proportional without trusting a client-supplied number.
  return Math.max(0.25, raw.length / 900);
}
function usageUnitsForRequest(event, purpose) {
  const action = clean(purpose).toLowerCase().replace(/_/g, '-');
  const body = bodyForUsage(event);
  if (['generate-subtitle', 'subtitle', 'transcribe'].includes(action)) {
    // Charge the server request by this actual chunk's duration. Do not trust the
    // client-supplied whole-job total as the amount to debit on every chunk.
    const seconds = Number(body.chunkDurationSeconds);
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(10000, seconds / 60) : 0.5;
  }
  if (['translate-subtitle', 'subtitle-translate', 'translate'].includes(action)) {
    const factorRaw = Number(process.env.MARU_AI_TRANSLATION_UNIT_FACTOR);
    const factor = Number.isFinite(factorRaw) && factorRaw > 0 ? Math.min(1, factorRaw) : 0.15;
    return Math.min(10000, subtitleDurationMinutesFromText(body.subtitle || body.text || '') * factor);
  }
  return 0;
}
function usageEventKey(event, purpose, access) {
  const body = bodyForUsage(event);
  const action = clean(purpose).toLowerCase().replace(/_/g, '-');
  const supplied = clean(body.creditEventKey);
  const raw = event && event.body ? String(event.body) : '';

  if (['generate-subtitle', 'subtitle', 'transcribe'].includes(action) && supplied) {
    // One stable key per subtitle chunk: retries of the same chunk are idempotent,
    // while later chunks of the same video are still charged exactly once each.
    const chunkIndex = clean(body.chunkIndex || body.segmentIndex || '0');
    return `${clean(access && access.userId)}|${action}|${supplied}|chunk:${chunkIndex}`;
  }
  if (['translate-subtitle', 'subtitle-translate', 'translate'].includes(action) && supplied) {
    // Bind the caller's retry key to the actual subtitle payload/target so a modified
    // client cannot reuse one old event key for different translation jobs.
    const contentDigest = crypto.createHash('sha256')
      .update(`${clean(body.targetLanguage || body.targetLang)}|${clean(body.subtitle || body.text)}`)
      .digest('hex').slice(0, 32);
    return `${clean(access && access.userId)}|${action}|${supplied}|${contentDigest}`;
  }
  if (supplied) return `${clean(access && access.userId)}|${action}|${supplied}`;

  // Direct/legacy callers without a V190 event key remain metered. The digest is stable
  // for a retry of the same payload but does not expose request content in metadata.
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  return `${clean(access && access.userId)}|${action}|${digest}`;
}
async function enforceCreditsForGooglePlay(access, event, purpose) {
  if (!access || access.accessClass !== 'google_play_paid_member') return access;
  const action = clean(purpose).toLowerCase().replace(/_/g, '-');
  // V190 paid tiers are subtitle-generation/translation plans. Dubbing and video
  // enhancement remain outside these products unless a later release explicitly adds them.
  if (action.includes('dubbing') || action === 'tts' || action === 'text-to-speech' || action === 'generate-speech') {
    throw accessError(402, 'feature_not_in_plan', 'AI dubbing is not included in the current MARU AI Pro/Premium plans.');
  }
  const units = usageUnitsForRequest(event, action);
  if (!(units > 0)) return access;
  const usage = await chargeUsage(access, usageEventKey(event, action, access), units, action);
  return Object.assign(access, { creditUsage: usage });
}

function rateLimitKey(access, event, purpose) {
  const stableUser = access && access.userId ? access.userId : 'anonymous';
  const digest = crypto.createHash('sha256').update(`${stableUser}|${clientIp(event)}|${clean(purpose)}`).digest('hex').slice(0, 32);
  return `${clean(purpose) || 'maru-ai'}:${digest}`;
}
function enforceRateLimit(access, event, purpose) {
  const privileged = access && access.accessClass === 'privileged';
  const configured = Number(process.env[privileged ? 'MARU_AI_PRIVILEGED_RPM' : 'MARU_AI_PAID_RPM']);
  const limit = Number.isFinite(configured) && configured > 0 ? Math.min(300, Math.floor(configured)) : (privileged ? 90 : 30);
  const now = Date.now();
  const key = rateLimitKey(access, event, purpose);
  const current = RATE_STATE.get(key) || { startedAt: now, count: 0 };
  if (now - current.startedAt >= 60 * 1000) {
    current.startedAt = now;
    current.count = 0;
  }
  current.count += 1;
  RATE_STATE.set(key, current);
  if (current.count > limit) throw accessError(429, 'ai_rate_limited', 'Too many MARU AI requests. Please retry after a short delay.');
}
function requestBodyBytes(event) {
  const raw = event && event.body ? String(event.body) : '';
  return Buffer.byteLength(raw, event && event.isBase64Encoded ? 'base64' : 'utf8');
}
function enforceRequestSize(event, maximumBytes) {
  const configured = Number(process.env.MARU_AI_MAX_REQUEST_BYTES);
  const fallback = Number(maximumBytes) > 0 ? Number(maximumBytes) : 48 * 1024 * 1024;
  const limit = Number.isFinite(configured) && configured > 0 ? Math.min(64 * 1024 * 1024, Math.floor(configured)) : fallback;
  const bytes = requestBodyBytes(event);
  if (bytes > limit) throw accessError(413, 'ai_request_too_large', `MARU AI request exceeds the ${limit} byte server limit.`);
  return bytes;
}
async function authorizeAiAccess(event, options) {
  const settings = options && typeof options === 'object' ? options : {};
  enforceRequestSize(event, settings.maximumBytes);
  const disabled = paidFeatureDisabled(settings.purpose || 'maru-ai');
  if (disabled === 'dubbing') {
    throw accessError(403, 'feature_not_available', 'AI dubbing is currently disabled in MARU Media Player.');
  }
  if (disabled === 'video-enhancement') {
    throw accessError(403, 'feature_not_available', 'AI video enhancement is currently disabled in MARU Media Player.');
  }
  const member = await verifyMember(event);
  const privilegedSet = privilegedRoles();
  const paidSet = paidRoles();
  const privileged = member.roles.some((role) => privilegedSet.has(role));
  if (privileged) {
    const access = Object.assign({}, member, { allowed: true, accessClass: 'privileged', plan: 'OWNER_ADMIN', pgReady: pgExecutionReady(), googlePlayReady: googlePlayBillingConfigured() });
    enforceRateLimit(access, event, settings.purpose || 'maru-ai');
    return access;
  }

  if (settings.allowPaid === false) {
    throw accessError(403, 'privileged_role_required', 'This MARU AI operation is limited to owner and administrator accounts.');
  }

  // Android Google Play subscription is checked before legacy PG/member roles.
  const play = await verifyGooglePlaySubscription(event, member);
  if (play.supplied) {
    if (!play.active) throw accessError(402, 'ai_membership_required', 'An active Google Play MARU AI subscription is required.');
    const access = Object.assign({}, member, {
      allowed: true,
      accessClass: 'google_play_paid_member',
      plan: play.planCode || 'GOOGLE_PLAY_PRO',
      pgReady: true,
      googlePlayReady: true,
      googlePlayProductId: play.productId,
      googlePlayBasePlanId: play.basePlanId || '',
      googlePlaySubscriptionState: play.state,
      googlePlayExpiryTime: play.expiryTime,
      monthlyCreditUnits: play.monthlyCreditUnits || 0
    });
    enforceRateLimit(access, event, settings.purpose || 'maru-ai');
    await enforceCreditsForGooglePlay(access, event, settings.purpose || 'maru-ai');
    return access;
  }

  // Preserve the existing external-PG / server-role path for web/Windows customers.
  // Android V190 must never inherit a site membership role as a Google Play entitlement:
  // it requires a verified Play purchase token whenever Play Billing is configured.
  const androidPlayOnly = isAndroidRequest(event) && googlePlayBillingConfigured();
  if (!androidPlayOnly && pgExecutionReady()) {
    const paid = member.roles.some((role) => paidSet.has(role));
    if (paid) {
      const access = Object.assign({}, member, { allowed: true, accessClass: 'paid_member', plan: 'MONTHLY_MEMBER', pgReady: true, googlePlayReady: googlePlayBillingConfigured() });
      enforceRateLimit(access, event, settings.purpose || 'maru-ai');
      return access;
    }
  }

  if (googlePlayBillingConfigured() || pgExecutionReady()) {
    throw accessError(402, 'ai_membership_required', 'An active paid MARU AI membership is required.');
  }
  throw accessError(403, 'ai_public_service_preparing', 'AI subtitle generation and translation are preparing while payment verification is not configured.');
}
function publicServiceState() {
  const playReady = googlePlayBillingConfigured();
  const pgReady = pgExecutionReady();
  const paidReady = playReady || pgReady;
  return {
    publicServiceState: paidReady ? 'paid_membership_required' : 'preparing',
    pgReady,
    googlePlayReady: playReady,
    dubbingEnabled: envTrue('MARU_AI_DUBBING_ENABLED'),
    videoEnhancementEnabled: envTrue('MARU_AI_VIDEO_ENHANCEMENT_ENABLED'),
    privilegedAccess: 'owner_admin_available',
    generalMemberAccess: paidReady ? 'paid_membership_required' : 'blocked_pending_payment_verification'
  };
}
function accessErrorResponse(error) {
  return {
    statusCode: Number(error && error.statusCode) || 500,
    code: clean(error && error.code) || 'ai_access_failed',
    message: clean(error && error.message) || 'MARU AI access failed.'
  };
}

module.exports = {
  accessError,
  accessErrorResponse,
  authorizeAiAccess,
  bearerToken,
  googlePlayBillingConfigured,
  pgExecutionReady,
  publicServiceState,
  uniqueRoles,
  verifyGooglePlaySubscription,
  verifyMember,
  googleAccessToken,
  googlePlayProProductId,
  googlePlayPremiumProductId,
  googlePlayProBasePlanId,
  googlePlayPremiumBasePlanId,
  creditUnitsForProduct,
  googlePlayAccountBindingMatches,
  isAndroidRequest,
  paidFeatureDisabled
};
