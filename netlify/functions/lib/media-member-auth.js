'use strict';

/*
 * Existing-site member token verifier for Media Hub pilot viewing.
 * The expected Auth0 audience is read only from Netlify environment variables;
 * no client identifier or credential is embedded in deployable source.
 */
const crypto = require('crypto');

const JWKS_CACHE = { value: null, expiresAt: 0 };

function clean(value) { return String(value == null ? '' : value).trim(); }
function fail(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function b64urlToBuffer(value) {
  let input = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64');
}
function decodeJson(value) { return JSON.parse(b64urlToBuffer(value).toString('utf8')); }
function normalizeRole(value) { return clean(value).toLowerCase().replace(/\s+/g, '_'); }
function config() {
  const domain = clean(process.env.AUTH0_DOMAIN || 'login.igdcglobal.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const clientId = clean(process.env.AUTH0_CLIENT_ID || process.env.AUTH0_SPA_CLIENT_ID || process.env.IGDC_AUTH0_CLIENT_ID);
  if (!domain || !clientId) throw fail(503, 'member_auth_not_configured', 'Pilot member authentication is not configured.');
  return {
    domain,
    clientId,
    issuer: clean(process.env.AUTH0_ISSUER || `https://${domain}/`).replace(/\/?$/, '/'),
    rolesClaim: clean(process.env.AUTH0_ROLES_CLAIM || 'https://igdcglobal.com/roles')
  };
}
function authorizationToken(event) {
  const headers = event && event.headers || {};
  const raw = clean(headers.authorization || headers.Authorization);
  if (!/^Bearer\s+/i.test(raw)) throw fail(401, 'member_login_required', 'Member login is required.');
  return raw.replace(/^Bearer\s+/i, '').trim();
}
async function jwks(settings) {
  if (JWKS_CACHE.value && JWKS_CACHE.expiresAt > Date.now()) return JWKS_CACHE.value;
  const response = await fetch(`https://${settings.domain}/.well-known/jwks.json`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw fail(401, 'member_token_invalid', 'Unable to verify the member session.');
  const value = await response.json();
  JWKS_CACHE.value = value;
  JWKS_CACHE.expiresAt = Date.now() + 60 * 60 * 1000;
  return value;
}
function rolesFor(payload, settings) {
  const values = [];
  [settings.rolesClaim, 'https://igdcglobal.com/roles', 'https://example.com/roles', 'roles', 'role', 'permissions'].forEach((key) => {
    const value = payload && payload[key];
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === 'string') values.push(...value.split(','));
  });
  return [...new Set(values.map(normalizeRole).filter(Boolean))];
}
async function authenticateMember(event) {
  const settings = config();
  const token = authorizationToken(event);
  const parts = token.split('.');
  if (parts.length !== 3) throw fail(401, 'member_token_invalid', 'Invalid member session.');
  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch (_) {
    throw fail(401, 'member_token_invalid', 'Invalid member session.');
  }
  const now = Math.floor(Date.now() / 1000);
  if (!header || header.alg !== 'RS256' || !header.kid || !payload || !clean(payload.sub)) {
    throw fail(401, 'member_token_invalid', 'Invalid member session.');
  }
  if ((payload.exp && Number(payload.exp) <= now) || (payload.nbf && Number(payload.nbf) > now + 30)) {
    throw fail(401, 'member_token_expired', 'Member login has expired.');
  }
  if (clean(payload.iss) !== settings.issuer) throw fail(401, 'member_token_invalid', 'Invalid member session issuer.');
  const audiences = Array.isArray(payload.aud) ? payload.aud.map(clean) : [clean(payload.aud)];
  if (!audiences.includes(settings.clientId)) throw fail(401, 'member_token_invalid', 'Invalid member session audience.');

  const keys = await jwks(settings);
  const jwk = (keys.keys || []).find((entry) => entry && entry.kid === header.kid);
  if (!jwk) throw fail(401, 'member_token_invalid', 'Member signing key is unavailable.');
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(`${parts[0]}.${parts[1]}`);
    verify.end();
    if (!verify.verify(key, b64urlToBuffer(parts[2]))) throw new Error('signature');
  } catch (_) {
    throw fail(401, 'member_token_invalid', 'Invalid member session signature.');
  }
  return { memberId: clean(payload.sub), roles: rolesFor(payload, settings) };
}

module.exports = { authenticateMember, clean, fail };
