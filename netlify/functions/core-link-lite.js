'use strict';

/*
 * IGDC Core Link Lite v1.0.3
 * --------------------------------------------------------------------------
 * Independent external-data inbox/outbox.  This function deliberately does
 * not import or mutate SearchBank, Sanmaru, Snapshot, Automap, Index, Front,
 * Revenue, payment, or any existing IGDC function.
 *
 * Data boundary:
 *   external source <-> Core Link Lite tables only <-> administrator review
 *
 * No automatic handoff into any other system exists in this file.
 */

const crypto = require('crypto');
const dns = require('dns').promises;
const https = require('https');
const net = require('net');

const VERSION = 'igdc-core-link-lite-v1.0.4-isolated-auth0-session-inventory-diagnostic';
const FUNCTION_PATH = '/.netlify/functions/core-link-lite';
const LINK_TABLE = 'igdc_core_link_lite_links';
const MESSAGE_TABLE = 'igdc_core_link_lite_messages';
const MAX_LINKS = 100;
const MAX_MESSAGES = 80;
const MAX_DIAGNOSTIC_RECENT_MESSAGES = 20;
const INVENTORY_VIEW = 'igdc_core_link_lite_inventory';
const INVENTORY_SUMMARY_VIEW = 'igdc_core_link_lite_inventory_summary';
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_MAX_SEND_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DIRECTIONS = new Set(['pull', 'push', 'inbound']);
const STATES = new Set(['draft', 'enabled', 'blocked']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'POST']);
const DEFAULT_AUTH_ISSUER = 'https://login.igdcglobal.com/';
const DEFAULT_AUTH_AUDIENCE = '4JeT1FdyDZaN7nEODVsKe2Sx8kKMWagj';
const AUTH_JWKS_CACHE_MS = 10 * 60 * 1000;
let authJwksCache = null;


// These rows are display-only diagnostic metadata. They are not probed, invoked,
// imported, or otherwise connected to the existing systems by Core Link Lite.
const INTERNAL_DISPLAY_LINKS = Object.freeze([
  { name: 'Search Bank Engine', endpoint: '/.netlify/functions/search-bank-engine', state: 'connected', purpose: '검색/슬롯/스냅샷 데이터 게이트웨이' },
  { name: 'Maru Search', endpoint: '/.netlify/functions/maru-search', state: 'connected', purpose: '외부 검색/미디어/뉴스/상품 검색 통로' },
  { name: 'Revenue / Commerce Engine', endpoint: '/.netlify/functions/maru-revenue-engine', state: 'connected', purpose: '수익 구조/상품/정산/제휴 라인' },
  { name: 'Ledger / Donation', endpoint: '/api/ledger', state: 'connected', purpose: '도네이션/입금/정산 로그 확인' },
  { name: 'Web3 / Wallet Provider', endpoint: '/api/wallets', state: 'connected', purpose: '블록체인 지갑/네트워크 상태 확인' },
  { name: 'Supabase Core Registry', endpoint: 'igdc_core_status', state: 'connected', purpose: '기존 Core 상태 저장소' },
  { name: 'Maru Global Insight', endpoint: '/.netlify/functions/maru-global-insight-engine', state: 'connected', purpose: '글로벌 인사이트/국가·권역 분석 연결' },
  { name: 'Planetary / Collector', endpoint: '/.netlify/functions/planetary-data-connector', state: 'partial', purpose: '외부 데이터 어댑터/수집기 확장' },
  { name: 'Media / SNS / Broadcaster Adapter', endpoint: 'pending-adapter', state: 'planned', purpose: '향후 SNS·방송·미디어 소스 어댑터' }
]);

function clean(value, maxLength) {
  const text = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Vary': 'Authorization, Origin'
    },
    body: statusCode === 204 ? '' : JSON.stringify(body)
  };
}

function failure(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function header(event, name) {
  const headers = (event && event.headers) || {};
  const wanted = String(name || '').toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === wanted) return String(headers[key] == null ? '' : headers[key]);
  }
  return '';
}

function requestMethod(event) {
  return clean(event && event.httpMethod || 'GET', 12).toUpperCase() || 'GET';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isoNow() { return new Date().toISOString(); }

function makeId(prefix) {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : crypto.randomBytes(18).toString('hex');
  return `${prefix}_${random}`;
}

function safeId(value, maxLength) {
  const output = clean(value, maxLength || 160);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(output) ? output : '';
}

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function objectEnv(name) {
  const parsed = safeJson(process.env[name] || '{}', {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function listEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map(value => clean(value, 320).toLowerCase())
    .filter(Boolean);
}

function config() {
  const url = clean(process.env.CORE_LINK_LITE_SUPABASE_URL, 500).replace(/\/+$/, '');
  const serviceKey = clean(process.env.CORE_LINK_LITE_SERVICE_ROLE_KEY, 4096);
  const adminsByEmail = new Set(listEnv('CORE_LINK_LITE_ADMIN_EMAILS'));
  const adminsByUserId = new Set(listEnv('CORE_LINK_LITE_ADMIN_USER_IDS'));
  const explicitEnabled = String(process.env.CORE_LINK_LITE_ENABLED || '').trim().toLowerCase();
  const enabled = !['0', 'false', 'off', 'no'].includes(explicitEnabled);
  const ready = Boolean(enabled && url && serviceKey && (adminsByEmail.size || adminsByUserId.size));
  return {
    enabled,
    ready,
    storageCredentialsConfigured: Boolean(url && serviceKey),
    administratorAllowListConfigured: Boolean(adminsByEmail.size || adminsByUserId.size),
    url,
    serviceKey,
    adminsByEmail,
    adminsByUserId,
    inboundSecrets: objectEnv('CORE_LINK_LITE_INBOUND_SECRETS_JSON'),
    outboundHeaders: objectEnv('CORE_LINK_LITE_OUTBOUND_HEADERS_JSON'),
    // These defaults match the existing IGDC browser login. They are optional
    // overrides only; no new environment variable is required for the current site.
    authIssuer: normalizeAuthIssuer(process.env.CORE_LINK_LITE_AUTH_ISSUER || DEFAULT_AUTH_ISSUER),
    authAudience: clean(process.env.CORE_LINK_LITE_AUTH_AUDIENCE || DEFAULT_AUTH_AUDIENCE, 500),
    maxPayloadBytes: intEnv('CORE_LINK_LITE_MAX_PAYLOAD_BYTES', DEFAULT_MAX_PAYLOAD_BYTES, 1024, 1024 * 1024),
    maxSendBytes: intEnv('CORE_LINK_LITE_MAX_SEND_BYTES', DEFAULT_MAX_SEND_BYTES, 1024, 512 * 1024)
  };
}

function configurationError(cfg) {
  if (!cfg.enabled) return failure(503, 'core_link_lite_disabled', 'Core Link Lite가 현재 비활성화되어 있습니다.');
  return failure(503, 'core_link_lite_not_configured', 'Core Link Lite 전용 환경변수와 관리자 허용 목록을 먼저 설정해야 합니다.');
}

function canonicalAuthIssuer(value) {
  const raw = clean(value, 500).replace(/\/+$/, '');
  if (!/^https:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw + '/');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return url.origin + '/';
  } catch (_) {
    return '';
  }
}

function normalizeAuthIssuer(value) {
  return canonicalAuthIssuer(value) || DEFAULT_AUTH_ISSUER;
}

function nativeHttpsFetch(urlText, init) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(urlText); }
    catch (_) { reject(failure(503, 'runtime_fetch_unavailable', '서버 HTTP 요청 주소가 올바르지 않습니다.')); return; }
    if (target.protocol !== 'https:') { reject(failure(503, 'runtime_fetch_unavailable', '서버 HTTP 요청은 HTTPS만 사용할 수 있습니다.')); return; }
    const options = init || {};
    const headers = Object.assign({}, options.headers || {});
    const body = options.body == null ? null : Buffer.from(String(options.body), 'utf8');
    if (body && !Object.keys(headers).some(key => String(key).toLowerCase() === 'content-length')) headers['Content-Length'] = String(body.length);
    const request = https.request({
      protocol: 'https:', hostname: target.hostname, port: target.port || 443,
      path: (target.pathname || '/') + (target.search || ''),
      method: options.method || 'GET', headers, agent: false, servername: target.hostname
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = Number(response.statusCode || 0);
        resolve({ ok: status >= 200 && status < 300, status, text: async () => text });
      });
    });
    request.setTimeout(10000, () => request.destroy(new Error('timeout')));
    request.on('error', error => reject(error));
    if (body) request.write(body);
    request.end();
  });
}

async function platformFetch(url, init) {
  if (typeof fetch === 'function') return fetch(url, init);
  return nativeHttpsFetch(url, init);
}

function base64urlBuffer(value) {
  const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function jwtJsonPart(part, code) {
  try { return JSON.parse(base64urlBuffer(part).toString('utf8')); }
  catch (_) { throw failure(401, code || 'core_link_lite_session_required', '관리자 로그인 토큰 형식이 올바르지 않습니다.'); }
}

function audienceIncludes(aud, expected) {
  const values = Array.isArray(aud) ? aud : [aud];
  return values.some(value => clean(value, 500) === expected);
}

function validateAuthClaims(payload, cfg) {
  const now = Math.floor(Date.now() / 1000);
  const issuer = canonicalAuthIssuer(payload && payload.iss || '');
  if (!payload || !issuer || issuer !== cfg.authIssuer) throw failure(401, 'core_link_lite_session_required', '관리자 로그인 발급자를 확인할 수 없습니다.');
  if (!audienceIncludes(payload.aud, cfg.authAudience)) throw failure(401, 'core_link_lite_session_required', '관리자 로그인 대상 정보를 확인할 수 없습니다.');
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now - 60) throw failure(401, 'core_link_lite_session_required', '관리자 로그인 세션이 만료되었습니다.');
  if (Number.isFinite(Number(payload.nbf)) && Number(payload.nbf) > now + 60) throw failure(401, 'core_link_lite_session_required', '관리자 로그인 세션이 아직 유효하지 않습니다.');
  if (Number.isFinite(Number(payload.iat)) && Number(payload.iat) > now + 300) throw failure(401, 'core_link_lite_session_required', '관리자 로그인 세션 시간이 올바르지 않습니다.');
  const email = clean(payload.email, 320).toLowerCase();
  const subject = clean(payload.sub, 320);
  if (!email || !subject) throw failure(401, 'core_link_lite_session_required', '관리자 이메일 또는 사용자 식별자가 없는 세션입니다.');
  return { email, subject, name: clean(payload.name || payload.nickname || email, 160) };
}

async function authJwks(issuer) {
  if (authJwksCache && authJwksCache.issuer === issuer && (Date.now() - authJwksCache.at) < AUTH_JWKS_CACHE_MS) return authJwksCache.keys;
  let response;
  try { response = await platformFetch(new URL('.well-known/jwks.json', issuer).toString(), { method: 'GET', headers: { Accept: 'application/json' } }); }
  catch (_) { throw failure(503, 'core_link_lite_auth_unavailable', 'Core Link Lite 전용 관리자 로그인 확인에 실패했습니다.'); }
  const raw = await response.text().catch(() => '');
  const body = raw ? safeJson(raw, null) : null;
  if (!response.ok || !body || !Array.isArray(body.keys)) throw failure(503, 'core_link_lite_auth_unavailable', 'Core Link Lite 전용 관리자 로그인 확인에 실패했습니다.');
  const keys = body.keys.filter(key => key && key.kty === 'RSA' && clean(key.kid, 300));
  if (!keys.length) throw failure(503, 'core_link_lite_auth_unavailable', 'Core Link Lite 전용 관리자 로그인 키를 확인할 수 없습니다.');
  authJwksCache = { issuer, at: Date.now(), keys };
  return keys;
}

async function verifyAuth0IdToken(token, cfg) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw failure(401, 'core_link_lite_session_required', '관리자 로그인 세션이 필요합니다.');
  const headerValue = jwtJsonPart(parts[0]);
  const payload = jwtJsonPart(parts[1]);
  if (clean(headerValue.alg, 20) !== 'RS256' || !clean(headerValue.kid, 300)) throw failure(401, 'core_link_lite_session_required', '지원하지 않는 관리자 로그인 토큰 형식입니다.');
  const claims = validateAuthClaims(payload, cfg);
  const keys = await authJwks(cfg.authIssuer);
  const key = keys.find(candidate => clean(candidate.kid, 300) === clean(headerValue.kid, 300));
  if (!key) throw failure(401, 'core_link_lite_session_required', '관리자 로그인 서명 키를 찾을 수 없습니다.');
  let verified = false;
  try {
    const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
    verified = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1], 'utf8'), { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, base64urlBuffer(parts[2]));
  } catch (_) { verified = false; }
  if (!verified) throw failure(401, 'core_link_lite_session_required', '관리자 로그인 서명을 확인할 수 없습니다.');
  return claims;
}

async function dbRequest(cfg, path, init) {
  if (!cfg || !cfg.ready) throw configurationError(cfg || {});
  let response;
  try {
    response = await platformFetch(cfg.url + path, {
      method: (init && init.method) || 'GET',
      headers: Object.assign({
        apikey: cfg.serviceKey,
        Authorization: `Bearer ${cfg.serviceKey}`,
        'Content-Type': 'application/json'
      }, (init && init.headers) || {}),
      body: init && init.body
    });
  } catch (_) {
    throw failure(503, 'core_link_lite_storage_unavailable', 'Core Link Lite 전용 저장소에 연결할 수 없습니다.');
  }
  const text = await response.text().catch(() => '');
  const data = text ? safeJson(text, null) : null;
  if (!response.ok) {
    const code = response.status === 404 || response.status === 400
      ? 'core_link_lite_schema_required'
      : 'core_link_lite_storage_failed';
    throw failure(503, code, 'Core Link Lite 전용 테이블 또는 저장소 연결 상태를 확인해야 합니다.');
  }
  return data;
}

function rest(table, query) {
  return `/rest/v1/${encodeURIComponent(table)}${query ? `?${query}` : ''}`;
}

function dbSelect(cfg, table, query) {
  return dbRequest(cfg, rest(table, query), { method: 'GET' });
}

function dbInsert(cfg, table, value, prefer) {
  return dbRequest(cfg, rest(table), {
    method: 'POST',
    headers: { Prefer: prefer || 'return=representation' },
    body: JSON.stringify(Array.isArray(value) ? value : [value])
  });
}

function dbPatch(cfg, table, query, value) {
  return dbRequest(cfg, rest(table, query), {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(value)
  });
}

function normalizeOrigin(event) {
  const origin = header(event, 'origin');
  if (!origin) return '';
  try { return new URL(origin).origin; } catch (_) { return ''; }
}

function assertSameOrigin(event) {
  const origin = normalizeOrigin(event);
  if (!origin) return;
  const host = clean(header(event, 'x-forwarded-host') || header(event, 'host'), 300).split(',')[0].trim();
  if (!host) return;
  const expected = `https://${host}`.toLowerCase();
  if (origin.toLowerCase() !== expected) {
    throw failure(403, 'cross_origin_control_denied', 'Core Link Lite 관리 요청은 동일 사이트의 관리자 화면에서만 실행할 수 있습니다.');
  }
}

function bearerToken(event) {
  const authorization = header(event, 'authorization');
  const matched = authorization.match(/^Bearer\s+(.+)$/i);
  return matched ? clean(matched[1], 6000) : '';
}

async function verifyAdministrator(event, cfg) {
  if (!cfg || !cfg.ready) throw configurationError(cfg || {});
  const token = bearerToken(event);
  if (!token) throw failure(401, 'core_link_lite_session_required', 'Core Link Lite 관리에는 관리자 로그인 세션이 필요합니다.');

  // IGDC uses Auth0-issued ID tokens, not Supabase Auth tokens. This validates
  // that signed ID token against the issuer's public JWKS; it does not call,
  // import, mutate, or depend on any IGDC business/engine function.
  const identity = await verifyAuth0IdToken(token, cfg);
  if (!cfg.adminsByEmail.has(identity.email) && !cfg.adminsByUserId.has(identity.subject.toLowerCase())) {
    throw failure(403, 'core_link_lite_admin_required', 'Core Link Lite는 전용 관리자 허용 목록에 등록된 계정만 사용할 수 있습니다.');
  }
  return { id: identity.subject, email: identity.email, name: identity.name, sessionValidation: 'auth0_jwks_id_token' };
}

function parseRawBody(event, maxBytes) {
  let raw = event && event.body == null ? '' : String(event && event.body || '');
  if (event && event.isBase64Encoded) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); }
    catch (_) { throw failure(400, 'invalid_base64_body', '수신 자료 인코딩이 올바르지 않습니다.'); }
  }
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw failure(413, 'payload_too_large', '자료 크기가 Core Link Lite 허용 범위를 초과했습니다.');
  }
  return raw;
}

function normalizeContentType(value) {
  const raw = clean(value, 180).toLowerCase().split(';')[0].trim();
  if (raw === 'application/json' || raw === 'text/json') return 'application/json';
  if (raw === 'text/csv' || raw === 'application/csv') return 'text/csv';
  if (raw === 'text/plain' || !raw) return 'text/plain';
  throw failure(415, 'unsupported_content_type', 'Core Link Lite는 현재 JSON·CSV·텍스트 자료만 독립 보관합니다.');
}

function payloadFromRaw(raw, contentType) {
  if (contentType === 'application/json') {
    const parsed = safeJson(raw, null);
    if (parsed === null || typeof parsed !== 'object') throw failure(400, 'invalid_json_payload', 'JSON 자료 형식이 올바르지 않습니다.');
    return { payloadJson: parsed, payloadText: null };
  }
  return { payloadJson: null, payloadText: raw };
}

function payloadFromControl(value, contentType, maxBytes) {
  let raw;
  let format = contentType || '';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    raw = JSON.stringify(value);
    format = 'application/json';
  } else {
    raw = String(value == null ? '' : value);
  }
  if (!raw.trim()) throw failure(400, 'outgoing_payload_required', '보낼 자료를 입력해야 합니다.');
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw failure(413, 'outgoing_payload_too_large', '전송 자료 크기가 허용 범위를 초과했습니다.');
  const normalized = normalizeContentType(format || 'text/plain');
  return Object.assign({ raw, contentType: normalized }, payloadFromRaw(raw, normalized));
}

function isPrivateIpv4(address) {
  const parts = String(address || '').split('.').map(value => Number(value));
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function isPrivateIp(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) {
    const value = String(address || '').toLowerCase();
    if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true;
    if (value.startsWith('::ffff:')) return isPrivateIpv4(value.slice('::ffff:'.length));
    return false;
  }
  return true;
}

function blockedHost(host) {
  const value = clean(host, 253).toLowerCase().replace(/\.$/, '');
  if (!value || net.isIP(value)) return true;
  if (['localhost', 'metadata.google.internal', 'metadata', 'instance-data'].includes(value)) return true;
  return value.endsWith('.local') || value.endsWith('.internal') || value.endsWith('.lan') ||
    value.endsWith('.home') || value.endsWith('.test') || value.endsWith('.invalid') || value.endsWith('.corp');
}

function normalizeExternalEndpoint(value) {
  const raw = clean(value, 2048);
  let url;
  try { url = new URL(raw); } catch (_) { throw failure(400, 'invalid_external_endpoint', '외부 endpoint는 HTTPS URL이어야 합니다.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw failure(400, 'unsafe_external_endpoint', 'HTTPS·기본 포트·인증정보 없는 endpoint만 등록할 수 있습니다.');
  }
  if (blockedHost(url.hostname)) throw failure(400, 'unsafe_external_host', 'localhost·사설망·직접 IP·내부 도메인은 Core Link Lite endpoint로 등록할 수 없습니다.');
  if (url.search || url.hash) throw failure(400, 'external_endpoint_query_not_allowed', 'endpoint 등록값에는 token·key가 들어갈 수 있는 query 또는 hash를 넣을 수 없습니다.');
  url.pathname = url.pathname.replace(/\/+/g, '/');
  if (url.pathname.includes('..')) throw failure(400, 'unsafe_external_path', '외부 endpoint 경로가 올바르지 않습니다.');
  return url.toString();
}

async function publicResolvedEndpoint(urlText) {
  const url = new URL(urlText);
  if (blockedHost(url.hostname)) throw failure(400, 'unsafe_external_host', '허용되지 않은 외부 endpoint 호스트입니다.');
  let records;
  try { records = await dns.lookup(url.hostname, { all: true, verbatim: true }); }
  catch (_) { throw failure(400, 'external_host_resolution_failed', '외부 endpoint의 공개 DNS 확인에 실패했습니다.'); }
  const publicRecords = (records || []).filter(record => record && !isPrivateIp(record.address));
  if (!publicRecords.length || publicRecords.length !== records.length) {
    throw failure(400, 'external_host_not_public', '외부 endpoint가 사설·내부 주소로 해석되어 요청을 차단했습니다.');
  }
  return { url, addresses: publicRecords };
}

function sanitizeServerHeaders(cfg, headerRef) {
  const ref = safeId(headerRef, 120);
  if (!ref) return {};
  const source = cfg && cfg.outboundHeaders && cfg.outboundHeaders[ref];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const headers = {};
  for (const [key, value] of Object.entries(source)) {
    const name = clean(key, 120);
    const lower = name.toLowerCase();
    if (!name || ['host', 'content-length', 'connection', 'transfer-encoding'].includes(lower)) continue;
    if (!(lower === 'authorization' || lower === 'accept' || lower === 'content-type' || lower.startsWith('x-'))) continue;
    headers[name] = clean(value, 4096);
  }
  return headers;
}

function pinnedHttpsRequest(target, options) {
  const method = clean(options && options.method || 'GET', 12).toUpperCase();
  if (!SAFE_METHODS.has(method)) return Promise.reject(failure(400, 'unsupported_external_method', '허용되지 않은 외부 요청 방식입니다.'));
  return publicResolvedEndpoint(target).then(check => new Promise(resolve => {
    const selected = check.addresses[0];
    const maxBytes = Math.max(1024, Number(options && options.maxBytes) || DEFAULT_MAX_PAYLOAD_BYTES);
    const body = options && options.body ? Buffer.from(options.body, 'utf8') : null;
    const headers = Object.assign({
      'User-Agent': 'IGDC-Core-Link-Lite/1.0',
      Accept: 'application/json, text/csv, text/plain;q=0.9, */*;q=0.1'
    }, options && options.headers || {});
    if (body) headers['Content-Length'] = String(body.length);
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    const request = https.request({
      protocol: 'https:',
      hostname: check.url.hostname,
      port: 443,
      method,
      path: `${check.url.pathname || '/'}${check.url.search || ''}`,
      servername: check.url.hostname,
      agent: false,
      headers,
      lookup: function(_hostname, _options, callback) { callback(null, selected.address, selected.family || net.isIP(selected.address)); }
    }, response => {
      const chunks = [];
      let total = 0;
      let exceeded = false;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > maxBytes) {
          exceeded = true;
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const status = Number(response.statusCode || 0) || null;
        if (exceeded) return finish({ ok: false, status, error: 'external_response_too_large', contentType: '', raw: '' });
        finish({
          ok: Boolean(status && status >= 200 && status < 300),
          status,
          contentType: String(response.headers['content-type'] || ''),
          raw: Buffer.concat(chunks).toString('utf8'),
          redirect: Boolean(status && status >= 300 && status < 400)
        });
      });
      response.on('error', () => finish({ ok: false, status: null, error: 'external_response_error', contentType: '', raw: '' }));
    });
    request.setTimeout(10000, () => {
      request.destroy(new Error('timeout'));
      finish({ ok: false, status: null, error: 'external_timeout', contentType: '', raw: '' });
    });
    request.on('error', () => finish({ ok: false, status: null, error: 'external_network_error', contentType: '', raw: '' }));
    if (body) request.write(body);
    request.end();
  }));
}

function safeLink(row) {
  const raw = row && typeof row === 'object' ? row : {};
  return {
    id: safeId(raw.id, 160),
    name: clean(raw.name, 240),
    direction: DIRECTIONS.has(clean(raw.direction, 24)) ? clean(raw.direction, 24) : 'pull',
    endpoint: clean(raw.endpoint, 2048),
    purpose: clean(raw.purpose, 1600),
    state: STATES.has(clean(raw.state, 24)) ? clean(raw.state, 24) : 'draft',
    lastSyncAt: raw.last_sync_at || null,
    lastSyncStatus: clean(raw.last_sync_status, 80) || null,
    lastReceivedAt: raw.last_received_at || null,
    lastSentAt: raw.last_sent_at || null,
    lastError: clean(raw.last_error, 500) || null,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null
  };
}

function safeMessage(row, includePayload) {
  const raw = row && typeof row === 'object' ? row : {};
  const base = {
    id: safeId(raw.id, 160),
    linkId: safeId(raw.link_id, 160),
    flow: clean(raw.flow, 40),
    title: clean(raw.title, 240),
    contentType: clean(raw.content_type, 180),
    bytes: Number(raw.payload_bytes || 0),
    payloadSha256: clean(raw.payload_sha256, 64),
    externalStatus: Number.isFinite(Number(raw.external_status)) ? Number(raw.external_status) : null,
    responseSummary: clean(raw.response_summary, 600) || null,
    createdAt: raw.created_at || null
  };
  if (includePayload) {
    base.payload = raw.payload_json != null ? raw.payload_json : (raw.payload_text || '');
  }
  return base;
}

async function listLinks(cfg) {
  const rows = await dbSelect(cfg, LINK_TABLE,
    'select=id,name,direction,endpoint,purpose,state,secret_ref,header_ref,last_sync_at,last_sync_status,last_received_at,last_sent_at,last_error,created_at,updated_at&order=updated_at.desc&limit=' + MAX_LINKS);
  return (Array.isArray(rows) ? rows : []).map(safeLink).filter(row => row.id);
}

async function findLink(cfg, id) {
  const safe = safeId(id, 160);
  if (!safe) throw failure(400, 'invalid_core_link_lite_id', 'Core Link Lite 링크 ID가 올바르지 않습니다.');
  const rows = await dbSelect(cfg, LINK_TABLE, 'select=*&id=eq.' + encodeURIComponent(safe) + '&limit=1');
  const row = Array.isArray(rows) && rows[0];
  if (!row) throw failure(404, 'core_link_lite_not_found', 'Core Link Lite 등록 항목을 찾을 수 없습니다.');
  return row;
}

async function insertMessage(cfg, input) {
  const raw = String(input && input.raw || '');
  const record = {
    id: makeId('clmsg'),
    link_id: safeId(input && input.linkId, 160),
    flow: clean(input && input.flow, 40) || 'received',
    title: clean(input && input.title, 240) || 'Core Link Lite 자료',
    content_type: clean(input && input.contentType, 180) || 'text/plain',
    payload_json: input && input.payloadJson != null ? input.payloadJson : null,
    payload_text: input && input.payloadText != null ? String(input.payloadText) : null,
    payload_bytes: Buffer.byteLength(raw, 'utf8'),
    payload_sha256: sha256(raw),
    source_nonce_hash: clean(input && input.nonceHash, 64) || null,
    external_status: Number.isFinite(Number(input && input.externalStatus)) ? Number(input.externalStatus) : null,
    response_summary: clean(input && input.responseSummary, 600) || null,
    created_at: isoNow()
  };
  await dbInsert(cfg, MESSAGE_TABLE, record, 'return=minimal');
  return record;
}

function directionLabel(direction) {
  if (direction === 'pull') return '외부에서 자료 받기';
  if (direction === 'push') return '외부로 자료 보내기';
  return '외부가 IGDC로 자료 보내기';
}

async function createLink(cfg, actor, body) {
  const direction = clean(body && body.direction, 24).toLowerCase();
  if (!DIRECTIONS.has(direction)) throw failure(400, 'invalid_core_link_lite_direction', '방향은 pull·push·inbound 중 하나여야 합니다.');
  const endpoint = normalizeExternalEndpoint(body && body.endpoint);
  const name = clean(body && body.name, 240);
  const purpose = clean(body && body.purpose, 1600);
  const secretRef = safeId(body && body.secretRef, 120) || null;
  const headerRef = safeId(body && body.headerRef, 120) || null;
  if (!name || purpose.length < 3) throw failure(400, 'invalid_core_link_lite_details', '연동 이름과 용도를 입력해야 합니다.');
  if (direction === 'inbound' && !secretRef) throw failure(400, 'inbound_secret_ref_required', '외부 수신 연결에는 전용 수신 키 참조값이 필요합니다.');
  if (direction === 'inbound' && !clean(cfg.inboundSecrets[secretRef], 4096)) {
    throw failure(409, 'inbound_secret_ref_unconfigured', '입력한 수신 키 참조값이 Core Link Lite 전용 환경변수에 등록되어 있지 않습니다.');
  }
  const now = isoNow();
  const row = {
    id: makeId('clink'), name, direction, endpoint, purpose,
    state: 'draft', secret_ref: secretRef, header_ref: headerRef,
    created_by: actor.id, created_at: now, updated_at: now
  };
  await dbInsert(cfg, LINK_TABLE, row, 'return=minimal');
  return safeLink(row);
}

async function setLinkState(cfg, id, state) {
  const requested = clean(state, 24).toLowerCase();
  if (!STATES.has(requested)) throw failure(400, 'invalid_core_link_lite_state', '허용되지 않은 Core Link Lite 상태입니다.');
  const row = await findLink(cfg, id);
  if (requested === 'enabled' && clean(row.direction, 24) === 'inbound') {
    const ref = safeId(row.secret_ref, 120);
    if (!ref || !clean(cfg.inboundSecrets[ref], 4096)) {
      throw failure(409, 'inbound_secret_ref_unconfigured', '외부 수신 활성화 전에는 전용 수신 키 참조값을 환경변수에 등록해야 합니다.');
    }
  }
  await dbPatch(cfg, LINK_TABLE, 'id=eq.' + encodeURIComponent(row.id), {
    state: requested,
    updated_at: isoNow(),
    last_error: requested === 'blocked' ? '관리자가 Core Link Lite 연결을 차단했습니다.' : null
  });
  return Object.assign(safeLink(row), { state: requested });
}

async function syncLink(cfg, id) {
  const row = await findLink(cfg, id);
  const link = safeLink(row);
  if (link.state !== 'enabled') throw failure(409, 'core_link_lite_not_enabled', '활성 상태의 Core Link Lite 연결만 동기화할 수 있습니다.');
  let status = '';
  let error = null;
  if (link.direction === 'inbound') {
    const secretRef = safeId(row.secret_ref, 120);
    const secretReady = Boolean(secretRef && clean(cfg.inboundSecrets[secretRef], 4096));
    status = secretReady ? 'receiver_ready' : 'receiver_secret_missing';
    error = secretReady ? null : '외부 수신 키 참조값이 서버 환경변수에 없습니다.';
  } else {
    const result = await pinnedHttpsRequest(link.endpoint, { method: 'HEAD', maxBytes: 1024, headers: sanitizeServerHeaders(cfg, safeId(row.header_ref, 120)) });
    status = result.ok ? `http_${result.status}` : (result.error || `http_${result.status || 0}`);
    error = result.ok ? null : '외부 endpoint 상태확인에 실패했습니다.';
  }
  const now = isoNow();
  await dbPatch(cfg, LINK_TABLE, 'id=eq.' + encodeURIComponent(link.id), {
    last_sync_at: now, last_sync_status: status, last_error: error, updated_at: now
  });
  return { id: link.id, ok: !error, status, at: now };
}

async function syncAll(cfg) {
  const links = await listLinks(cfg);
  const enabled = links.filter(link => link.state === 'enabled').slice(0, 50);
  const results = [];
  for (const link of enabled) {
    try { results.push(await syncLink(cfg, link.id)); }
    catch (error) { results.push({ id: link.id, ok: false, status: error.code || 'sync_failed' }); }
  }
  return { checked: results.length, results };
}

async function pullData(cfg, id) {
  const row = await findLink(cfg, id);
  const link = safeLink(row);
  if (link.direction !== 'pull') throw failure(409, 'core_link_lite_pull_direction_required', '자료 받기는 pull 방향 연결에서만 실행할 수 있습니다.');
  if (link.state !== 'enabled') throw failure(409, 'core_link_lite_not_enabled', '활성 상태의 연결만 자료를 받을 수 있습니다.');
  const result = await pinnedHttpsRequest(link.endpoint, {
    method: 'GET', maxBytes: cfg.maxPayloadBytes, headers: sanitizeServerHeaders(cfg, safeId(row.header_ref, 120))
  });
  const now = isoNow();
  if (!result.ok || result.redirect) {
    const code = result.redirect ? 'external_redirect_blocked' : (result.error || `http_${result.status || 0}`);
    await dbPatch(cfg, LINK_TABLE, 'id=eq.' + encodeURIComponent(link.id), {
      last_sync_at: now, last_sync_status: code, last_error: '외부 자료 수신에 실패했습니다.', updated_at: now
    });
    throw failure(502, 'core_link_lite_pull_failed', '외부 자료 수신에 실패했습니다. 리디렉션과 과도한 자료는 안전상 저장하지 않습니다.');
  }
  const contentType = normalizeContentType(result.contentType || 'text/plain');
  const payload = payloadFromRaw(result.raw, contentType);
  const message = await insertMessage(cfg, {
    linkId: link.id, flow: 'pulled', title: `${link.name} 자료 수신`, contentType,
    raw: result.raw, payloadJson: payload.payloadJson, payloadText: payload.payloadText,
    externalStatus: result.status, responseSummary: `외부 GET 수신 ${result.status}`
  });
  await dbPatch(cfg, LINK_TABLE, 'id=eq.' + encodeURIComponent(link.id), {
    last_sync_at: now, last_sync_status: `received_${result.status}`, last_received_at: now, last_error: null, updated_at: now
  });
  return { message: safeMessage(message, false), receivedAt: now };
}

async function sendData(cfg, id, body) {
  const row = await findLink(cfg, id);
  const link = safeLink(row);
  if (link.direction !== 'push') throw failure(409, 'core_link_lite_push_direction_required', '자료 보내기는 push 방향 연결에서만 실행할 수 있습니다.');
  if (link.state !== 'enabled') throw failure(409, 'core_link_lite_not_enabled', '활성 상태의 연결만 자료를 보낼 수 있습니다.');
  const outgoing = payloadFromControl(body && body.payload, body && body.contentType, cfg.maxSendBytes);
  const headers = Object.assign({}, sanitizeServerHeaders(cfg, safeId(row.header_ref, 120)), {
    'Content-Type': outgoing.contentType,
    'X-IGDC-Core-Link-Lite': 'manual-send'
  });
  const result = await pinnedHttpsRequest(link.endpoint, {
    method: 'POST', body: outgoing.raw, maxBytes: 8192, headers
  });
  const now = isoNow();
  const summary = result.ok
    ? `외부 POST 전송 ${result.status}`
    : `외부 POST 전송 실패: ${result.error || `http_${result.status || 0}`}`;
  const message = await insertMessage(cfg, {
    linkId: link.id, flow: 'sent', title: `${link.name} 수동 전송`, contentType: outgoing.contentType,
    raw: outgoing.raw, payloadJson: outgoing.payloadJson, payloadText: outgoing.payloadText,
    externalStatus: result.status, responseSummary: summary
  });
  await dbPatch(cfg, LINK_TABLE, 'id=eq.' + encodeURIComponent(link.id), {
    last_sent_at: now, last_sync_at: now, last_sync_status: result.ok ? `sent_${result.status}` : 'send_failed',
    last_error: result.ok ? null : '외부 자료 전송에 실패했습니다.', updated_at: now
  });
  if (!result.ok) throw failure(502, 'core_link_lite_send_failed', summary);
  return { message: safeMessage(message, false), sentAt: now, status: result.status };
}

function timestampValue(value) {
  const raw = clean(value, 80);
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric > 100000000000 ? numeric : numeric * 1000;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function nonceUsed(cfg, linkId, nonceHash) {
  if (!nonceHash) return false;
  const rows = await dbSelect(cfg, MESSAGE_TABLE,
    'select=id&link_id=eq.' + encodeURIComponent(linkId) + '&source_nonce_hash=eq.' + encodeURIComponent(nonceHash) + '&limit=1');
  return Array.isArray(rows) && rows.length > 0;
}

async function receiveData(event, cfg) {
  if (!cfg || !cfg.ready) return json(503, { ok: false, error: 'core_link_lite_not_configured' });
  if (requestMethod(event) !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  const query = (event && event.queryStringParameters) || {};
  const linkId = safeId(query.link_id || query.linkId, 160);
  if (!linkId) return json(400, { ok: false, error: 'missing_link_id' });
  let row;
  try { row = await findLink(cfg, linkId); }
  catch (_) { return json(404, { ok: false, error: 'unknown_link' }); }
  const link = safeLink(row);
  if (link.direction !== 'inbound' || link.state !== 'enabled') return json(403, { ok: false, error: 'inbound_link_not_enabled' });
  const secretRef = safeId(row.secret_ref, 120);
  const secret = secretRef && clean(cfg.inboundSecrets[secretRef], 4096);
  if (!secret) return json(503, { ok: false, error: 'inbound_secret_not_configured' });
  // Validate time using a normalized millisecond value, but sign the exact
  // cleaned header representation.  This keeps UNIX-seconds and ISO-time
  // senders compatible with the documented HMAC contract.
  const timestampRaw = clean(header(event, 'x-core-link-timestamp'), 80);
  const timestamp = timestampValue(timestampRaw);
  const nonce = clean(header(event, 'x-core-link-nonce'), 160);
  const signature = clean(header(event, 'x-core-link-signature'), 300).replace(/^sha256=/i, '');
  if (!timestampRaw || !timestamp || Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS || !/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) {
    return json(403, { ok: false, error: 'invalid_timestamp_or_nonce' });
  }
  let raw;
  try { raw = parseRawBody(event, cfg.maxPayloadBytes); }
  catch (error) { return json(error.statusCode || 400, { ok: false, error: error.code || 'invalid_payload' }); }
  const expected = hmac(secret, `${timestampRaw}.${nonce}.${sha256(raw)}`);
  if (!signature || !timingSafeEqual(signature, expected)) return json(403, { ok: false, error: 'invalid_signature' });
  const nonceHash = sha256(`${link.id}|${nonce}`);
  if (await nonceUsed(cfg, link.id, nonceHash)) return json(409, { ok: false, error: 'replay_detected' });
  let contentType;
  let payload;
  try {
    contentType = normalizeContentType(header(event, 'content-type'));
    payload = payloadFromRaw(raw, contentType);
  } catch (error) { return json(error.statusCode || 400, { ok: false, error: error.code || 'invalid_payload' }); }
  const message = await insertMessage(cfg, {
    linkId: link.id, flow: 'received', title: `${link.name} 외부 수신`, contentType, raw,
    payloadJson: payload.payloadJson, payloadText: payload.payloadText, nonceHash,
    externalStatus: 202, responseSummary: '서명 검증된 외부 수신 자료'
  });
  const now = isoNow();
  await dbPatch(cfg, LINK_TABLE, 'id=eq.' + encodeURIComponent(link.id), {
    last_received_at: now, last_sync_at: now, last_sync_status: 'received_202', last_error: null, updated_at: now
  });
  return json(202, { ok: true, received: true, messageId: message.id });
}

async function listMessages(cfg, linkId) {
  const safe = safeId(linkId, 160);
  if (!safe) throw failure(400, 'invalid_core_link_lite_id', '자료를 조회할 링크 ID가 올바르지 않습니다.');
  const rows = await dbSelect(cfg, MESSAGE_TABLE,
    'select=id,link_id,flow,title,content_type,payload_json,payload_text,payload_bytes,payload_sha256,external_status,response_summary,created_at&link_id=eq.' + encodeURIComponent(safe) + '&order=created_at.desc&limit=' + MAX_MESSAGES);
  return (Array.isArray(rows) ? rows : []).map(row => safeMessage(row, true));
}

function summaryForLinks(links) {
  const all = links || [];
  return {
    total: all.length,
    draft: all.filter(link => link.state === 'draft').length,
    enabled: all.filter(link => link.state === 'enabled').length,
    blocked: all.filter(link => link.state === 'blocked').length,
    pull: all.filter(link => link.direction === 'pull').length,
    push: all.filter(link => link.direction === 'push').length,
    inbound: all.filter(link => link.direction === 'inbound').length
  };
}

function publicConfigurationSummary(cfg) {
  const source = cfg || {};
  const enabled = Boolean(source.enabled);
  const storageCredentialsConfigured = Boolean(source.storageCredentialsConfigured);
  const administratorAllowListConfigured = Boolean(source.administratorAllowListConfigured);
  let state = 'ready';
  if (!enabled) state = 'disabled';
  else if (!storageCredentialsConfigured && !administratorAllowListConfigured) state = 'storage_and_admin_not_configured';
  else if (!storageCredentialsConfigured) state = 'storage_not_configured';
  else if (!administratorAllowListConfigured) state = 'administrator_allow_list_not_configured';
  return {
    state,
    enabled,
    storageCredentialsConfigured,
    administratorAllowListConfigured,
    storageAccessAttempted: false,
    secretsIncluded: false,
    administratorIdentifiersIncluded: false
  };
}

function diagnosticBase(cfg) {
  return {
    ok: true,
    reportType: 'igdc-core-link-lite-diagnostic',
    version: VERSION,
    generatedAt: isoNow(),
    readOnly: true,
    isolation: {
      writesOnlyTo: [LINK_TABLE, MESSAGE_TABLE],
      automaticHandoffs: false,
      doesNotReadOrWrite: ['SearchBank', 'Sanmaru', 'Snapshot', 'Automap', 'Index', 'Front rendering', 'Revenue', 'Payment', 'Existing Core Engines']
    },
    existingInternalDisplayLinks: INTERNAL_DISPLAY_LINKS,
    existingInternalDisplaySummary: {
      total: INTERNAL_DISPLAY_LINKS.length,
      connected: INTERNAL_DISPLAY_LINKS.filter(row => row.state === 'connected').length,
      partial: INTERNAL_DISPLAY_LINKS.filter(row => row.state === 'partial').length,
      planned: INTERNAL_DISPLAY_LINKS.filter(row => row.state === 'planned').length,
      readOnly: true,
      endpointTestsExecuted: false
    },
    configuration: publicConfigurationSummary(cfg),
    safety: {
      externalDataIsStoredOnlyInCoreLinkLite: true,
      automaticFrontOrEnginePublishing: false,
      externalEndpointPolicy: 'HTTPS public host only; private network, IP host, query token, redirect, and oversized payload are denied.',
      inboundPolicy: 'Registered inbound link + enabled state + HMAC signature + timestamp + nonce required.',
      outboundPolicy: 'Administrator manual action only; no scheduled or automatic send.',
      diagnosticPolicy: 'This diagnostic never writes, never tests endpoints, never exposes secrets, and remains downloadable before Core Link Lite storage setup.'
    }
  };
}

// Read-only diagnostic is intentionally available before SQL, environment variables,
// and administrator allow-list setup. It reveals no secret, administrator ID, link
// payload, or external connection list without a verified administrator session.
function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyStoredDataSummary() {
  return {
    exact: false,
    state: 'not_checked',
    externalLinkCount: null,
    storedRecordCount: null,
    receivedCount: null,
    pulledCount: null,
    sentCount: null,
    storedBytes: null,
    hasStoredData: null,
    lastStoredAt: null,
    lastReceivedAt: null,
    lastPulledAt: null,
    lastSentAt: null,
    recentRecordLimit: MAX_DIAGNOSTIC_RECENT_MESSAGES,
    recentRecordsIncluded: 0,
    recordBodiesIncluded: false
  };
}

function safeInventory(row) {
  const raw = row && typeof row === 'object' ? row : {};
  const storedRecordCount = numeric(raw.stored_record_count);
  return {
    linkId: safeId(raw.link_id, 160),
    storedRecordCount,
    receivedCount: numeric(raw.received_count),
    pulledCount: numeric(raw.pulled_count),
    sentCount: numeric(raw.sent_count),
    storedBytes: numeric(raw.stored_bytes),
    hasStoredData: storedRecordCount > 0,
    lastStoredAt: raw.last_stored_at || null,
    lastReceivedAt: raw.last_received_at || null,
    lastPulledAt: raw.last_pulled_at || null,
    lastSentAt: raw.last_sent_at || null
  };
}

function safeInventorySummary(row) {
  const raw = row && typeof row === 'object' ? row : {};
  const storedRecordCount = numeric(raw.stored_record_count);
  return {
    exact: true,
    state: 'available',
    externalLinkCount: numeric(raw.external_link_count),
    storedRecordCount,
    receivedCount: numeric(raw.received_count),
    pulledCount: numeric(raw.pulled_count),
    sentCount: numeric(raw.sent_count),
    storedBytes: numeric(raw.stored_bytes),
    hasStoredData: storedRecordCount > 0,
    lastStoredAt: raw.last_stored_at || null,
    lastReceivedAt: raw.last_received_at || null,
    lastPulledAt: raw.last_pulled_at || null,
    lastSentAt: raw.last_sent_at || null,
    recentRecordLimit: MAX_DIAGNOSTIC_RECENT_MESSAGES,
    recentRecordsIncluded: 0,
    recordBodiesIncluded: false
  };
}

async function diagnosticInventory(cfg) {
  const [summaryRows, inventoryRows, recentRows] = await Promise.all([
    dbSelect(cfg, INVENTORY_SUMMARY_VIEW,
      'select=external_link_count,stored_record_count,received_count,pulled_count,sent_count,stored_bytes,last_stored_at,last_received_at,last_pulled_at,last_sent_at&limit=1'),
    dbSelect(cfg, INVENTORY_VIEW,
      'select=link_id,stored_record_count,received_count,pulled_count,sent_count,stored_bytes,last_stored_at,last_received_at,last_pulled_at,last_sent_at&order=link_id.asc&limit=' + MAX_LINKS),
    dbSelect(cfg, MESSAGE_TABLE,
      'select=id,link_id,flow,title,content_type,payload_bytes,payload_sha256,external_status,response_summary,created_at&order=created_at.desc&limit=' + MAX_DIAGNOSTIC_RECENT_MESSAGES)
  ]);
  const summary = safeInventorySummary(Array.isArray(summaryRows) ? summaryRows[0] : null);
  const inventoryByLink = new Map((Array.isArray(inventoryRows) ? inventoryRows : [])
    .map(safeInventory)
    .filter(row => row.linkId)
    .map(row => [row.linkId, row]));
  const recentRecords = (Array.isArray(recentRows) ? recentRows : []).map(row => safeMessage(row, false));
  summary.recentRecordsIncluded = recentRecords.length;
  return { summary, inventoryByLink, recentRecords };
}

// Read-only diagnostic is intentionally available before SQL, environment variables,
// and administrator allow-list setup. It reveals no secret or administrator ID. With
// a verified administrator + available dedicated storage, it also reports exact stored
// data counts and recent metadata, but never returns stored payload bodies.
async function diagnostic(cfg, event) {
  const report = diagnosticBase(cfg);
  report.externalLinks = [];
  report.externalSummary = summaryForLinks([]);
  report.storedDataInventory = emptyStoredDataSummary();
  report.recentStoredData = [];
  report.storage = {
    state: report.configuration.state,
    databaseReadAttempted: false,
    schemaVerified: false
  };
  report.administrator = {
    state: 'not_checked',
    externalLinkListIncluded: false,
    storedDataInventoryIncluded: false
  };
  report.warnings = [];

  if (!cfg || !cfg.ready) {
    report.storedDataInventory.state = 'not_available_before_configuration';
    report.warnings.push('Core Link Lite 전용 SQL·환경변수·관리자 허용 목록이 아직 완성되지 않아 외부 보관함의 실제 등록·저장 자료를 조회하지 않았습니다. 기존 내부 기본 목록과 격리 상태만 읽기 전용으로 확인했습니다.');
    return report;
  }

  let actor;
  try {
    actor = await verifyAdministrator(event, cfg);
    report.administrator = {
      state: 'verified',
      externalLinkListIncluded: true,
      storedDataInventoryIncluded: true
    };
  } catch (error) {
    report.administrator = {
      state: 'not_verified',
      reason: clean(error && error.code, 120) || 'administrator_session_not_available',
      externalLinkListIncluded: false,
      storedDataInventoryIncluded: false
    };
    report.storedDataInventory.state = 'administrator_session_not_verified';
    report.warnings.push('외부 연결 및 저장 자료의 실제 존재 여부는 전용 관리자 로그인 확인 후에만 JSON에 포함됩니다. 현재 JSON은 설정·격리 상태만 제공합니다.');
    return report;
  }

  try {
    const [links, inventory] = await Promise.all([listLinks(cfg), diagnosticInventory(cfg)]);
    report.externalLinks = links.map(link => Object.assign({}, link, {
      storedData: inventory.inventoryByLink.get(link.id) || {
        linkId: link.id, storedRecordCount: 0, receivedCount: 0, pulledCount: 0, sentCount: 0,
        storedBytes: 0, hasStoredData: false, lastStoredAt: null, lastReceivedAt: null,
        lastPulledAt: null, lastSentAt: null
      }
    }));
    report.externalSummary = summaryForLinks(links);
    report.storedDataInventory = inventory.summary;
    report.recentStoredData = inventory.recentRecords;
    report.storage = {
      state: 'ready',
      databaseReadAttempted: true,
      schemaVerified: true
    };
    if (!inventory.summary.hasStoredData) {
      report.warnings.push('전용 저장소는 정상 연결되었으며, 현재 저장된 외부 자료는 없습니다.');
    }
    return report;
  } catch (error) {
    report.storage = {
      state: 'schema_or_storage_unavailable',
      databaseReadAttempted: true,
      schemaVerified: false,
      reason: clean(error && error.code, 120) || 'storage_unavailable'
    };
    report.storedDataInventory.state = 'schema_or_storage_unavailable';
    report.warnings.push('Core Link Lite 전용 테이블·진단 인벤토리 또는 저장소를 아직 읽을 수 없습니다. 이 JSON은 계속 읽기 전용으로 저장되며 기존 사이트에는 영향이 없습니다.');
    return report;
  }
}

function actionOf(event) {
  const query = (event && event.queryStringParameters) || {};
  return clean(query.action || '', 40).toLowerCase();
}

function parseControlBody(event) {
  const raw = parseRawBody(event, 128 * 1024);
  if (!raw) return {};
  const body = safeJson(raw, null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure(400, 'invalid_json_request', 'Core Link Lite 관리 요청 형식이 올바르지 않습니다.');
  return body;
}

async function handler(event) {
  const cfg = config();
  const method = requestMethod(event);
  const action = actionOf(event);
  if (method === 'OPTIONS') return json(204, {});
  // The diagnostic path is deliberately before administrator/storage gating.
  // It only returns static isolation/configuration metadata until a verified
  // administrator session and Core Link Lite storage are both available.
  if (method === 'GET' && action === 'diagnostic') return json(200, await diagnostic(cfg, event));
  if (action === 'receive') return receiveData(event, cfg);
  try {
    assertSameOrigin(event);
    const actor = await verifyAdministrator(event, cfg);
    if (method === 'GET' && action === 'list') {
      const links = await listLinks(cfg);
      return json(200, { ok: true, version: VERSION, links, summary: summaryForLinks(links), actor: { email: actor.email } });
    }
    if (method === 'GET' && action === 'messages') {
      const query = (event && event.queryStringParameters) || {};
      return json(200, { ok: true, messages: await listMessages(cfg, query.link_id || query.linkId) });
    }
    if (method !== 'POST') throw failure(404, 'unsupported_core_link_lite_route', '지원하지 않는 Core Link Lite 경로입니다.');
    const body = parseControlBody(event);
    if (action === 'create') return json(201, { ok: true, link: await createLink(cfg, actor, body) });
    if (action === 'state') return json(200, { ok: true, link: await setLinkState(cfg, body.id, body.state) });
    if (action === 'sync') {
      const result = clean(body.id, 160) === 'all' ? await syncAll(cfg) : await syncLink(cfg, body.id);
      return json(200, { ok: true, result });
    }
    if (action === 'pull') return json(200, { ok: true, result: await pullData(cfg, body.id) });
    if (action === 'send') return json(200, { ok: true, result: await sendData(cfg, body.id, body) });
    throw failure(404, 'unsupported_core_link_lite_route', '지원하지 않는 Core Link Lite 요청입니다.');
  } catch (error) {
    return json(error.statusCode || 500, {
      ok: false,
      error: error.code || 'core_link_lite_error',
      message: error.message || 'Core Link Lite 처리 중 오류가 발생했습니다.'
    });
  }
}

exports.handler = handler;
exports._test = {
  normalizeExternalEndpoint,
  normalizeContentType,
  isPrivateIp,
  blockedHost,
  safeId,
  summaryForLinks,
  publicConfigurationSummary,
  payloadFromControl,
  normalizeAuthIssuer,
  canonicalAuthIssuer,
  validateAuthClaims,
  verifyAuth0IdToken,
  base64urlBuffer
};
