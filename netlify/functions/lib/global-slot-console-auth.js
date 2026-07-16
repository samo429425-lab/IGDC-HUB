'use strict';

/*
 * Shared administrator-session verifier for the Global Slot console and the
 * private commerce candidate queue. It validates the existing Auth0 ID token
 * used by admin.html; it does not create a second login flow.
 */
const crypto = require('crypto');

const VERSION = 'global-slot-console-auth-v1.0.0-common-admin-session-restored';
const JWKS_CACHE = new Map();
const ROLE_LEVEL = {
  guest: 0,
  member: 1,
  member_standard: 2,
  member_premium: 3,
  special_member: 4,
  special_menber: 4,
  commerce_manager: 5,
  media_manager: 5,
  site_manager: 12,
  coordinator_director: 13,
  site_manager_director: 14,
  director: 15,
  super_admin: 20,
  admin: 20,
  owner: 30
};

function text(value) { return value == null ? '' : String(value).trim(); }
function fail(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function normalizeRole(value) {
  return text(value).toLowerCase().replace(/[\s.]+/g, '_');
}
function unique(values) {
  return Array.from(new Set((values || []).map(text).filter(Boolean)));
}
function normalizeIssuer(value) {
  let issuer = text(value);
  if (!issuer) return '';
  if (!/^https:\/\//i.test(issuer)) issuer = 'https://' + issuer;
  return issuer.replace(/\/+$/, '') + '/';
}
function issuerList(value) {
  return unique(text(value).split(',').map(normalizeIssuer).filter(Boolean));
}
function config() {
  const domain = text(process.env.AUTH0_DOMAIN || 'login.igdcglobal.com')
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  const publicIssuer = normalizeIssuer(
    process.env.AUTH0_PUBLIC_ISSUER ||
    process.env.AUTH0_ISSUER ||
    'https://login.igdcglobal.com/'
  );
  const trustedIssuers = unique([
    publicIssuer,
    normalizeIssuer(domain ? 'https://' + domain + '/' : ''),
    ...issuerList(process.env.AUTH0_TRUSTED_ISSUERS || '')
  ]);
  const audiences = unique([
    process.env.AUTH0_PUBLIC_CLIENT_ID,
    process.env.AUTH0_SPA_CLIENT_ID,
    process.env.IGDC_AUTH0_SPA_CLIENT_ID,
    process.env.IGDC_AUTH0_CLIENT_ID,
    process.env.AUTH0_CLIENT_ID,
    process.env.COMMERCE_CANDIDATE_AUTH_AUDIENCE
  ]);
  if (!trustedIssuers.length) {
    throw fail(503, 'admin_auth_not_configured', '관리자 공통 인증 발급자 설정을 찾지 못했습니다.');
  }
  return {
    trustedIssuers,
    audiences,
    rolesClaim: text(process.env.AUTH0_ROLES_CLAIM || 'https://igdcglobal.com/roles')
  };
}
function authorizationToken(event) {
  const headers = event && event.headers || {};
  const raw = text(headers.authorization || headers.Authorization);
  if (!/^Bearer\s+/i.test(raw)) throw fail(401, 'member_login_required', '관리자 로그인이 필요합니다.');
  return raw.replace(/^Bearer\s+/i, '').trim();
}
function b64urlToBuffer(value) {
  let input = text(value).replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64');
}
function decodeJson(value) {
  return JSON.parse(b64urlToBuffer(value).toString('utf8'));
}
async function jwks(issuer) {
  const cached = JWKS_CACHE.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let response;
  try {
    response = await fetch(issuer + '.well-known/jwks.json', { headers: { Accept: 'application/json' } });
  } catch (_error) {
    throw fail(401, 'member_token_invalid', '관리자 세션 서명 키를 확인하지 못했습니다.');
  }
  if (!response.ok) throw fail(401, 'member_token_invalid', '관리자 세션 서명 키를 확인하지 못했습니다.');
  const value = await response.json();
  if (!value || !Array.isArray(value.keys)) throw fail(401, 'member_token_invalid', '관리자 세션 서명 키가 올바르지 않습니다.');
  JWKS_CACHE.set(issuer, { value, expiresAt: Date.now() + 60 * 60 * 1000 });
  return value;
}
function rolesFor(payload, settings) {
  const values = [];
  [
    settings.rolesClaim,
    'https://igdcglobal.com/roles',
    'https://os.auth/roles',
    'https://os0.app/roles',
    'https://example.com/roles',
    'https://osu/roles',
    'roles',
    'role',
    'permissions'
  ].forEach((key) => {
    const value = payload && payload[key];
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === 'string') values.push(...value.split(','));
  });
  return unique(values.map(normalizeRole));
}
function roleLevel(role) {
  const normalized = normalizeRole(role);
  if (Object.prototype.hasOwnProperty.call(ROLE_LEVEL, normalized)) return ROLE_LEVEL[normalized];
  if (normalized.indexOf('site_manager_') === 0) return 12;
  return 0;
}
function highestRole(roles) {
  return (roles || []).slice().sort((left, right) => roleLevel(right) - roleLevel(left))[0] || 'guest';
}
async function resolveUser(event) {
  const settings = config();
  const token = authorizationToken(event);
  const parts = token.split('.');
  if (parts.length !== 3) throw fail(401, 'member_token_invalid', '관리자 세션 형식이 올바르지 않습니다.');

  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch (_error) {
    throw fail(401, 'member_token_invalid', '관리자 세션 형식이 올바르지 않습니다.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!header || header.alg !== 'RS256' || !header.kid || !payload || !text(payload.sub)) {
    throw fail(401, 'member_token_invalid', '관리자 세션이 올바르지 않습니다.');
  }
  if ((payload.exp && Number(payload.exp) <= now) || (payload.nbf && Number(payload.nbf) > now + 30)) {
    throw fail(401, 'member_token_expired', '관리자 로그인이 만료되었습니다.');
  }

  const issuer = normalizeIssuer(payload.iss);
  if (!issuer || !settings.trustedIssuers.includes(issuer)) {
    throw fail(401, 'member_token_invalid', '관리자 세션 발급자가 일치하지 않습니다.');
  }
  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud.map(text) : [text(payload.aud)];
  if (settings.audiences.length && !tokenAudiences.some((value) => settings.audiences.includes(value))) {
    throw fail(401, 'member_token_invalid', '관리자 세션 대상이 일치하지 않습니다.');
  }

  const keys = await jwks(issuer);
  const jwk = keys.keys.find((entry) => entry && entry.kid === header.kid);
  if (!jwk) throw fail(401, 'member_token_invalid', '관리자 세션 서명 키가 현재 키와 일치하지 않습니다.');
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(parts[0] + '.' + parts[1]);
    verify.end();
    if (!verify.verify(key, b64urlToBuffer(parts[2]))) throw new Error('signature');
  } catch (_error) {
    throw fail(401, 'member_token_invalid', '관리자 세션 서명이 올바르지 않습니다.');
  }

  const roles = rolesFor(payload, settings);
  return {
    sub: text(payload.sub),
    memberId: text(payload.sub),
    email: text(payload.email),
    name: text(payload.name || payload.nickname || payload.email),
    roles,
    role: highestRole(roles),
    issuer,
    tokenAudience: tokenAudiences.find((value) => settings.audiences.includes(value)) || tokenAudiences[0] || null
  };
}
function capability(actor) {
  const roles = unique((actor && actor.roles || []).map(normalizeRole));
  const has = (role) => roles.includes(role);
  const owner = has('owner');
  const admin = owner || has('admin') || has('super_admin');
  const director = admin || has('director') || has('site_manager_director') || has('coordinator_director');
  const siteManager = director || has('site_manager') || roles.some((role) => role.indexOf('site_manager_') === 0);
  const commerceManager = has('commerce_manager');
  const mediaManager = has('media_manager');
  return {
    owner,
    read: siteManager || commerceManager,
    edit: siteManager || commerceManager,
    mediaRead: siteManager || mediaManager,
    mediaEdit: siteManager || mediaManager,
    approve: siteManager,
    policy: director
  };
}
function requireCapability(actor, name) {
  const caps = capability(actor);
  if (caps[name] === true) return caps;
  const error = fail(403, 'admin_capability_required', '이 관리 작업을 실행할 권한이 없습니다.');
  error.capability = name;
  throw error;
}

module.exports = { VERSION, resolveUser, capability, requireCapability, config };
