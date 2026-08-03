'use strict';

/*
 * MARU paid-AI access boundary.
 *
 * Security rules:
 * - Browser/body identity, role, paid, subscription and license labels are never trusted.
 * - A signed Auth0 bearer token is verified through member-admin?action=me.
 * - owner/admin/super_admin may use MARU AI while PG is pending.
 * - Ordinary members are blocked while PG is pending.
 * - After PG is approved and live, only a server-verified paid role may use MARU AI.
 */

const crypto = require('crypto');

const DEFAULT_PRIVILEGED_ROLES = Object.freeze(['owner', 'admin', 'super_admin']);
const DEFAULT_PAID_ROLES = Object.freeze(['member_premium']);
const RATE_STATE = new Map();

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
  const member = await verifyMember(event);
  const privilegedSet = privilegedRoles();
  const paidSet = paidRoles();
  const privileged = member.roles.some((role) => privilegedSet.has(role));
  if (privileged) {
    const access = Object.assign({}, member, { allowed: true, accessClass: 'privileged', plan: 'OWNER_ADMIN', pgReady: pgExecutionReady() });
    enforceRateLimit(access, event, settings.purpose || 'maru-ai');
    return access;
  }

  if (settings.allowPaid === false) {
    throw accessError(403, 'privileged_role_required', 'This MARU AI operation is limited to owner and administrator accounts.');
  }
  if (!pgExecutionReady()) {
    throw accessError(403, 'ai_public_service_preparing', 'AI subtitle, translation, and dubbing service for general members is preparing while PG approval is pending.');
  }
  const paid = member.roles.some((role) => paidSet.has(role));
  if (!paid) {
    throw accessError(402, 'ai_membership_required', 'An active paid MARU AI membership is required.');
  }

  const access = Object.assign({}, member, { allowed: true, accessClass: 'paid_member', plan: 'MONTHLY_MEMBER', pgReady: true });
  enforceRateLimit(access, event, settings.purpose || 'maru-ai');
  return access;
}
function publicServiceState() {
  return {
    publicServiceState: pgExecutionReady() ? 'paid_membership_required' : 'preparing',
    pgReady: pgExecutionReady(),
    privilegedAccess: 'owner_admin_available',
    generalMemberAccess: pgExecutionReady() ? 'paid_membership_required' : 'blocked_pending_pg'
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
  pgExecutionReady,
  publicServiceState,
  uniqueRoles
};
