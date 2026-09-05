'use strict';

/*
 * Social-only YouTube OAuth session helper.
 * IMPORTANT: this module is deliberately isolated from IGDC member/Auth0/OS0.
 * No IGDC member id, role, login cookie or membership database is read or written.
 */
const crypto = require('crypto');

const VERSION = 'social-youtube-oauth-v1.0.0';
const COOKIE_NAME = 'igdc_social_youtube_oauth_v1';
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function text(value) { return value == null ? '' : String(value).trim(); }

function firstEnv(names) {
  for (const name of names) {
    const value = text(process.env[name]);
    if (value) return value;
  }
  return '';
}

function config() {
  const clientId = firstEnv(['SOCIAL_YOUTUBE_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_ID', 'GOOGLE_SOCIAL_CLIENT_ID']);
  const clientSecret = firstEnv(['SOCIAL_YOUTUBE_CLIENT_SECRET', 'YOUTUBE_OAUTH_CLIENT_SECRET', 'GOOGLE_SOCIAL_CLIENT_SECRET']);
  const stateSecret = firstEnv(['SOCIAL_YOUTUBE_OAUTH_STATE_SECRET', 'SOCIAL_OAUTH_STATE_SECRET']) || clientSecret;
  const tokenSecret = firstEnv(['SOCIAL_YOUTUBE_TOKEN_SECRET', 'SOCIAL_OAUTH_TOKEN_SECRET']) || clientSecret;
  return {
    clientId,
    clientSecret,
    stateSecret,
    tokenSecret,
    configured: !!(clientId && clientSecret && stateSecret && tokenSecret)
  };
}

function requestOrigin(event) {
  const headers = event && event.headers || {};
  const host = text(headers['x-forwarded-host'] || headers['X-Forwarded-Host'] || headers.host || headers.Host);
  const proto = text(headers['x-forwarded-proto'] || headers['X-Forwarded-Proto']) || 'https';
  if (host && /^(https?)$/i.test(proto)) return proto.toLowerCase() + '://' + host;
  const envUrl = text(process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL);
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      if (/^https?:$/.test(u.protocol)) return u.origin;
    } catch (_) {}
  }
  return '';
}

function callbackUrl(event) {
  const origin = requestOrigin(event);
  return origin ? origin + '/.netlify/functions/social-youtube-oauth-callback' : '';
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}
function unb64url(input) {
  return Buffer.from(String(input || ''), 'base64url');
}
function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function makeState(event) {
  const cfg = config();
  if (!cfg.configured) return '';
  const payload = {
    v: 1,
    iat: Date.now(),
    nonce: crypto.randomBytes(18).toString('base64url'),
    origin: requestOrigin(event)
  };
  const encoded = b64url(JSON.stringify(payload));
  return encoded + '.' + hmac(cfg.stateSecret, encoded);
}

function verifyState(event, state) {
  const cfg = config();
  const raw = text(state);
  const parts = raw.split('.');
  if (!cfg.configured || parts.length !== 2) return { ok: false, error: 'invalid_state' };
  if (!safeEqual(parts[1], hmac(cfg.stateSecret, parts[0]))) return { ok: false, error: 'invalid_state_signature' };
  let payload;
  try { payload = JSON.parse(unb64url(parts[0]).toString('utf8')); } catch (_) { return { ok: false, error: 'invalid_state_payload' }; }
  if (!payload || payload.v !== 1 || !Number.isFinite(Number(payload.iat))) return { ok: false, error: 'invalid_state_payload' };
  if (Date.now() - Number(payload.iat) > STATE_TTL_MS || Number(payload.iat) > Date.now() + 60000) return { ok: false, error: 'expired_state' };
  const origin = requestOrigin(event);
  if (!origin || payload.origin !== origin) return { ok: false, error: 'state_origin_mismatch' };
  return { ok: true, payload };
}

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret || '')).digest();
}

function encryptSession(session) {
  const cfg = config();
  if (!cfg.configured) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(cfg.tokenSecret), iv);
  const plain = Buffer.from(JSON.stringify(session || {}), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decryptSession(value) {
  const cfg = config();
  const raw = text(value);
  if (!cfg.configured || !raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(cfg.tokenSecret), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}

function parseCookies(event) {
  const headers = event && event.headers || {};
  const raw = text(headers.cookie || headers.Cookie);
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function sessionFromEvent(event) {
  return decryptSession(parseCookies(event)[COOKIE_NAME]);
}

function cookieHeader(event, session) {
  const origin = requestOrigin(event);
  const secure = /^https:/i.test(origin);
  const value = encryptSession(session);
  const parts = [
    COOKIE_NAME + '=' + value,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + SESSION_MAX_AGE_SEC
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookieHeader(event) {
  const origin = requestOrigin(event);
  const parts = [COOKIE_NAME + '=deleted', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (/^https:/i.test(origin)) parts.push('Secure');
  return parts.join('; ');
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 7000);
  try {
    const res = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    const raw = await res.text();
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = { raw }; }
    if (!res.ok) {
      const err = new Error(text(body && body.error_description) || text(body && body.error && body.error.message) || ('http_' + res.status));
      err.statusCode = res.status;
      err.payload = body;
      throw err;
    }
    return body;
  } finally { clearTimeout(timer); }
}

async function exchangeCode(event, code) {
  const cfg = config();
  if (!cfg.configured) throw Object.assign(new Error('youtube_social_oauth_not_configured'), { statusCode: 503 });
  const redirectUri = callbackUrl(event);
  if (!redirectUri) throw Object.assign(new Error('oauth_origin_unavailable'), { statusCode: 500 });
  const body = new URLSearchParams({
    code: text(code),
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  return fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString()
  }, 8000);
}

async function refreshAccessToken(session) {
  const cfg = config();
  if (!cfg.configured || !session || !text(session.refreshToken)) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: text(session.refreshToken),
    grant_type: 'refresh_token'
  });
  const data = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString()
  }, 8000);
  return Object.assign({}, session, {
    accessToken: text(data.access_token),
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000,
    scope: text(data.scope || session.scope),
    tokenType: text(data.token_type || session.tokenType || 'Bearer')
  });
}

async function activeSession(event) {
  const cfg = config();
  if (!cfg.configured) return { configured: false, session: null, setCookie: '' };
  let session = sessionFromEvent(event);
  if (!session || !text(session.accessToken)) return { configured: true, session: null, setCookie: '' };
  const expiresAt = Number(session.expiresAt || 0);
  if (expiresAt && expiresAt > Date.now() + 60000) return { configured: true, session, setCookie: '' };
  if (!text(session.refreshToken)) return { configured: true, session: null, setCookie: clearCookieHeader(event) };
  try {
    session = await refreshAccessToken(session);
    return { configured: true, session, setCookie: cookieHeader(event, session) };
  } catch (_) {
    return { configured: true, session: null, setCookie: clearCookieHeader(event) };
  }
}

module.exports = {
  VERSION,
  COOKIE_NAME,
  config,
  requestOrigin,
  callbackUrl,
  makeState,
  verifyState,
  sessionFromEvent,
  cookieHeader,
  clearCookieHeader,
  exchangeCode,
  activeSession,
  text
};
