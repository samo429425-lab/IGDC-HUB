'use strict';

/*
 * IGDC Core Link Security Gateway v1.0.0
 *
 * Server-side administrator-only control plane for Core Link records, inbound
 * webhook observation, controlled endpoint testing, decision audit, and
 * read-only diagnostic export.
 *
 * Important safety contract:
 * - Browser/localStorage values never grant a connection.
 * - No request from an external caller can create, approve, or activate a link.
 * - Unknown inbound traffic is observed (when durable storage is configured)
 *   and rejected. It cannot execute a connector or alter platform data.
 * - A registry item becomes active only after server-side privileged approval.
 * - Endpoint tests are server-only and use strict HTTPS / public-host checks.
 */

const crypto = require('crypto');
const dns = require('dns').promises;
const https = require('https');
const net = require('net');
const memberAdmin = require('./member-admin');

const VERSION = 'igdc-core-link-security-gateway-v1.0.3-storage-fallback-diagnostic';
const GATEWAY_PATH = '/.netlify/functions/core-link-security-gateway';
const INGRESS_PATH = GATEWAY_PATH + '?action=ingress';
const MAX_ROWS = 300;
const MAX_EVENTS = 300;
const MAX_DECISIONS = 300;
const MAX_INGRESS_BYTES = 32 * 1024;
const DEFAULT_INGRESS_RATE_PER_MINUTE = 60;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const CONTROL_ROLES = new Set(['owner', 'super_admin', 'admin']);
const FINAL_ROLES = new Set(['owner', 'super_admin']);
const LINK_STATES = new Set(['candidate', 'hold', 'test_passed', 'test_failed', 'approved', 'active', 'blocked', 'retired']);
const DIRECTIONS = new Set(['inbound', 'outbound']);
const METHOD_SET = new Set(['GET', 'HEAD', 'POST', 'PUT']);

const BUILT_IN_LINKS = Object.freeze([
  { id: 'core-search-bank', scope: 'internal', group: 'internal-connected', name: 'Search Bank Engine', endpoint: '/.netlify/functions/search-bank-engine', purpose: '검색/슬롯/스냅샷 데이터 게이트웨이', state: 'connected', source: 'internal' },
  { id: 'core-maru-search', scope: 'internal', group: 'internal-connected', name: 'Maru Search', endpoint: '/.netlify/functions/maru-search', purpose: '외부 검색/미디어/뉴스/상품 검색 통로', state: 'connected', source: 'internal' },
  { id: 'core-revenue-commerce', scope: 'internal', group: 'internal-connected', name: 'Revenue / Commerce Engine', endpoint: '/.netlify/functions/maru-revenue-engine', purpose: '수익 구조/상품/정산/제휴 라인', state: 'connected', source: 'internal' },
  { id: 'core-ledger-donation', scope: 'internal', group: 'internal-connected', name: 'Ledger / Donation', endpoint: '/api/ledger', purpose: '도네이션/입금/정산 로그 확인', state: 'connected', source: 'internal' },
  { id: 'core-web3-wallet', scope: 'internal', group: 'internal-connected', name: 'Web3 / Wallet Provider', endpoint: '/api/wallets', purpose: '블록체인 지갑/네트워크 상태 확인', state: 'connected', source: 'internal' },
  { id: 'core-supabase-registry', scope: 'internal', group: 'internal-connected', name: 'Supabase Core Registry', endpoint: 'igdc_core_status', purpose: 'Core Link 등록/상태/승인 이력 저장소', state: 'connected', source: 'internal' },
  { id: 'core-global-insight', scope: 'internal', group: 'internal-connected', name: 'Maru Global Insight', endpoint: '/.netlify/functions/maru-global-insight-engine', purpose: '글로벌 인사이트/국가·권역 분석 연결', state: 'connected', source: 'internal' },
  { id: 'core-planetary-collector', scope: 'internal', group: 'internal-partial', name: 'Planetary / Collector', endpoint: '/.netlify/functions/planetary-data-connector', purpose: '외부 데이터 어댑터/수집기/연합 소스 확장', state: 'partial', source: 'internal' },
  { id: 'core-media-sns-broadcaster', scope: 'external', group: 'external-candidate', name: 'Media / SNS / Broadcaster Adapter', endpoint: 'pending-adapter', purpose: '향후 SNS·방송·미디어 소스 어댑터 연결 후보', state: 'planned', source: 'planned' }
]);

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

function clean(value, maxLength) {
  const text = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function boolEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function validTable(value, fallback) {
  const candidate = clean(value || fallback, 120);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate) ? candidate : fallback;
}

function isoNow() { return new Date().toISOString(); }
function randomId(prefix) {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().replace(/-/g, '') : crypto.randomBytes(20).toString('hex');
  return `${prefix || 'core'}_${id}`;
}
function sha256(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function hmac(secret, value) { return crypto.createHmac('sha256', secret).update(value).digest('hex'); }
function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function header(event, name) {
  const headers = event && event.headers || {};
  const wanted = String(name || '').toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === wanted) return String(headers[key] == null ? '' : headers[key]);
  }
  return '';
}

function requestMethod(event) { return clean(event && event.httpMethod || 'GET', 12).toUpperCase() || 'GET'; }

function routeAction(event) {
  const query = event && event.queryStringParameters || {};
  const queryAction = clean(query.action || query.route, 80).toLowerCase();
  if (queryAction) return queryAction;
  const raw = clean((event && (event.path || event.rawUrl)) || '', 800).toLowerCase();
  const map = [
    ['security-events', 'events'], ['diagnostic', 'diagnostic'], ['requests', 'list'], ['register', 'register'],
    ['approve', 'approve'], ['activate', 'activate'], ['block', 'block'], ['hold', 'hold'],
    ['release', 'release'], ['test', 'test'], ['sync', 'sync'], ['ingress', 'ingress']
  ];
  for (const [needle, action] of map) if (raw.includes(`/core/link/${needle}`)) return action;
  return 'list';
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
  if (origin.toLowerCase() !== expected) throw failure(403, 'cross_origin_control_denied', 'Core Link 관리 요청은 동일 사이트 관리자 화면에서만 실행할 수 있습니다.');
}

function parseBody(event, maxBytes) {
  const raw = event && event.body == null ? '' : String(event && event.body || '');
  if (maxBytes && Buffer.byteLength(raw, 'utf8') > maxBytes) throw failure(413, 'request_too_large', '요청 크기가 허용 범위를 초과했습니다.');
  if (!raw) return { raw: '', json: {} };
  const contentType = header(event, 'content-type').toLowerCase();
  if (contentType.includes('application/json') || raw.trim().startsWith('{')) {
    const parsed = safeJson(raw, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure(400, 'invalid_json', 'JSON 요청 형식이 올바르지 않습니다.');
    return { raw, json: parsed };
  }
  return { raw, json: {} };
}

function storageConfig() {
  const url = clean(process.env.CORE_LINK_SUPABASE_URL || process.env.SUPABASE_URL, 500).replace(/\/+$/, '');
  const key = clean(process.env.CORE_LINK_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, 4096);
  const explicit = boolEnv('CORE_LINK_SECURITY_ENABLED');
  const enabled = explicit === undefined ? Boolean(url && key) : explicit;
  if (!enabled) return { ready: false, mode: 'disabled', reason: 'core_link_security_disabled' };
  if (!url || !key) return { ready: false, mode: 'unconfigured', reason: 'supabase_credentials_missing' };
  return {
    ready: true,
    mode: 'supabase',
    url,
    key,
    registryTable: validTable(process.env.CORE_LINK_REGISTRY_TABLE, 'igdc_core_link_registry'),
    eventTable: validTable(process.env.CORE_LINK_EVENT_TABLE, 'igdc_core_link_security_events'),
    decisionTable: validTable(process.env.CORE_LINK_DECISION_TABLE, 'igdc_core_link_decisions'),
    auditSalt: clean(process.env.CORE_LINK_AUDIT_HASH_SALT || key, 4096),
    webhookSecrets: safeJson(process.env.CORE_LINK_WEBHOOK_SECRETS_JSON || '{}', {}) || {},
    ingressRatePerMinute: intEnv('CORE_LINK_INGRESS_RATE_PER_MINUTE', DEFAULT_INGRESS_RATE_PER_MINUTE, 5, 1000)
  };
}

async function fetchCompat(url, init) {
  if (typeof fetch === 'function') return fetch(url, init);
  return require('node-fetch')(url, init);
}

async function dbRequest(config, path, init) {
  if (!config || !config.ready) throw failure(503, 'core_link_storage_unavailable', 'Core Link 보안 저장소가 아직 연결되지 않았습니다.');
  let response;
  try {
    response = await fetchCompat(config.url + path, {
      method: init && init.method || 'GET',
      headers: Object.assign({
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json'
      }, init && init.headers || {}),
      body: init && init.body
    });
  } catch (_) {
    throw failure(503, 'core_link_storage_unavailable', 'Core Link 보안 저장소에 연결할 수 없습니다.');
  }
  const text = await response.text().catch(() => '');
  const data = text ? safeJson(text, null) : null;
  if (!response.ok) {
    const code = response.status === 404 || response.status === 400 ? 'core_link_storage_schema_required' : 'core_link_storage_failed';
    throw failure(503, code, 'Core Link 보안 저장소 스키마 또는 연결 상태를 확인해야 합니다.');
  }
  return data;
}

function rest(table, query) {
  return `/rest/v1/${encodeURIComponent(table)}${query ? `?${query}` : ''}`;
}

async function dbSelect(config, table, query) {
  return dbRequest(config, rest(table, query), { method: 'GET', headers: { Prefer: 'count=exact' } });
}

async function dbInsert(config, table, row, prefer) {
  return dbRequest(config, rest(table), {
    method: 'POST',
    headers: { Prefer: prefer || 'return=representation' },
    body: JSON.stringify(Array.isArray(row) ? row : [row])
  });
}

async function dbPatch(config, table, query, patch) {
  return dbRequest(config, rest(table, query), {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
}

async function resolveControlActor(event) {
  const result = await memberAdmin.handler({
    httpMethod: 'GET',
    headers: event && event.headers || {},
    queryStringParameters: { action: 'me' },
    body: null
  });
  const payload = safeJson(result && result.body || '', {});
  if (!result || Number(result.statusCode) !== 200 || !payload || !payload.ok || !payload.me) {
    const status = Number(result && result.statusCode) || 401;
    throw failure(status === 401 || status === 403 ? status : 503, 'member_admin_session_required', payload && payload.error || '관리자 공통 세션을 확인할 수 없습니다.');
  }
  const role = clean(payload.me.role, 80).toLowerCase();
  const roles = Array.isArray(payload.me.roles) ? payload.me.roles.map(value => clean(value, 80).toLowerCase()).filter(Boolean) : [];
  if (!CONTROL_ROLES.has(role)) throw failure(403, 'core_link_admin_required', 'Core Link 보안 관제는 owner·super_admin·admin 권한에서만 실행할 수 있습니다.');
  return { id: clean(payload.me.user_id, 320), role, roles, name: clean(payload.me.name, 160), sessionValidation: 'member_admin_common_session' };
}

function requireFinalActor(actor) {
  if (!actor || !FINAL_ROLES.has(actor.role)) throw failure(403, 'core_link_final_authority_required', 'Core Link 최종 승인·활성화·해제는 owner 또는 super_admin 권한에서만 실행할 수 있습니다.');
}

function actorRecord(actor) {
  return { actor_id: clean(actor && actor.id, 320) || null, actor_role: clean(actor && actor.role, 80) || 'unknown' };
}

function hashSource(config, source) {
  return hmac(config && config.auditSalt || 'core-link-no-salt', clean(source, 1000)).slice(0, 48);
}

function clientIp(event) {
  return clean(header(event, 'x-nf-client-connection-ip') || header(event, 'client-ip') || header(event, 'x-forwarded-for').split(',')[0] || 'unknown', 128);
}

function safeRefererHost(event) {
  const ref = header(event, 'referer') || header(event, 'referrer');
  try { return new URL(ref).hostname.toLowerCase().slice(0, 253); } catch (_) { return ''; }
}

function userAgentSummary(event) {
  return clean(header(event, 'user-agent'), 180);
}

function safeId(value, maxLength) {
  const output = clean(value, maxLength || 180);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(output) ? output : '';
}

function normalizedMethods(value, direction) {
  const raw = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
  const methods = raw.map(item => clean(item, 12).toUpperCase()).filter(item => METHOD_SET.has(item));
  if (methods.length) return Array.from(new Set(methods));
  return direction === 'inbound' ? ['POST'] : ['HEAD', 'GET'];
}

function isPrivateIpv4(address) {
  const chunks = String(address || '').split('.').map(value => Number(value));
  if (chunks.length !== 4 || chunks.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = chunks;
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
}

function isPrivateIp(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) {
    const value = String(address || '').toLowerCase();
    if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true;
    // IPv4-mapped IPv6 can conceal loopback/private addresses.
    if (value.startsWith('::ffff:')) return isPrivateIpv4(value.slice('::ffff:'.length));
    return false;
  }
  return true;
}

function blockedHost(host) {
  const value = clean(host, 253).toLowerCase().replace(/\.$/, '');
  if (!value) return true;
  if (net.isIP(value)) return true;
  if (['localhost', 'metadata.google.internal', 'metadata', 'instance-data'].includes(value)) return true;
  return value.endsWith('.local') || value.endsWith('.internal') || value.endsWith('.lan') || value.endsWith('.home') || value.endsWith('.test') || value.endsWith('.invalid') || value.endsWith('.corp');
}

function normalizeExternalEndpoint(value) {
  const raw = clean(value, 2048);
  let url;
  try { url = new URL(raw); } catch (_) { throw failure(400, 'invalid_external_endpoint', '외부 endpoint는 HTTPS 공식 URL이어야 합니다.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw failure(400, 'unsafe_external_endpoint', 'HTTPS·기본 포트·인증정보 없는 endpoint만 등록할 수 있습니다.');
  }
  if (blockedHost(url.hostname)) throw failure(400, 'unsafe_external_host', 'localhost·사설망·직접 IP·내부 도메인은 Core Link endpoint로 등록할 수 없습니다.');
  if (url.search || url.hash) throw failure(400, 'external_endpoint_query_not_allowed', 'endpoint 등록값에는 토큰·키가 들어갈 수 있는 query/hash를 포함할 수 없습니다.');
  url.pathname = url.pathname.replace(/\/+/g, '/');
  if (url.pathname.includes('..')) throw failure(400, 'unsafe_external_endpoint_path', 'endpoint 경로가 올바르지 않습니다.');
  return url.toString();
}

async function assertPublicResolvable(urlText) {
  const url = new URL(urlText);
  if (blockedHost(url.hostname)) throw failure(400, 'unsafe_external_host', '허용되지 않은 외부 endpoint 호스트입니다.');
  let records;
  try { records = await dns.lookup(url.hostname, { all: true, verbatim: true }); }
  catch (_) { throw failure(400, 'external_host_resolution_failed', '외부 endpoint의 공개 DNS 확인에 실패했습니다.'); }
  if (!Array.isArray(records) || !records.length || records.some(record => isPrivateIp(record.address))) {
    throw failure(400, 'external_host_not_public', '외부 endpoint가 사설·내부 주소로 해석되어 테스트를 차단했습니다.');
  }
  return { url, addresses: records.map(record => record.address) };
}

function sanitizeEndpoint(value) {
  const raw = clean(value, 2048);
  if (!raw) return '';
  if (raw === 'igdc_core_status' || raw === 'pending-adapter') return raw;
  try {
    const url = new URL(raw, 'https://igdc.invalid');
    url.username = '';
    url.password = '';
    const secretKeys = /^(token|access_token|id_token|refresh_token|api[_-]?key|key|secret|client_secret|authorization|password|passwd|credential)$/i;
    Array.from(url.searchParams.keys()).forEach(key => { if (secretKeys.test(key)) url.searchParams.set(key, '[REDACTED]'); });
    return url.origin === 'https://igdc.invalid' ? url.pathname : url.toString();
  } catch (_) { return raw.replace(/(token|secret|key|password)=([^&\s]+)/ig, '$1=[REDACTED]'); }
}

function safeRegistryRow(row, config) {
  const raw = row && typeof row === 'object' ? row : {};
  const state = LINK_STATES.has(clean(raw.state, 40)) ? clean(raw.state, 40) : 'candidate';
  const direction = DIRECTIONS.has(clean(raw.direction, 24)) ? clean(raw.direction, 24) : 'outbound';
  const testState = clean(raw.test_state, 60) || 'not_run';
  return {
    id: safeId(raw.id, 180),
    scope: 'external',
    direction,
    group: state === 'blocked' ? 'blocked' : state === 'active' ? 'active' : state === 'approved' ? 'approved' : 'external-candidate',
    managementState: state,
    state,
    name: clean(raw.name, 240) || '관리자 등록 외부 연동',
    endpoint: sanitizeEndpoint(raw.endpoint),
    purpose: clean(raw.purpose, 2000),
    source: 'server_registry',
    risk: { level: clean(raw.risk_level, 30) || 'watch', label: riskLabel(raw.risk_level), reason: clean(raw.risk_reason, 300) },
    allowedMethods: normalizedMethods(raw.allowed_methods, direction),
    latestTest: { state: testState, label: testLabel(testState), at: raw.tested_at || null, status: Number.isFinite(Number(raw.test_http_status)) ? Number(raw.test_http_status) : null },
    webhookReady: direction === 'inbound' ? Boolean(raw.webhook_key_ref && config && config.webhookSecrets && config.webhookSecrets[raw.webhook_key_ref]) : null,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
    approvedAt: raw.approved_at || null,
    activatedAt: raw.activated_at || null,
    expiresAt: raw.expires_at || null
  };
}

function riskLabel(level) {
  const value = clean(level, 30).toLowerCase();
  if (value === 'safe') return '안전';
  if (value === 'normal') return '보통';
  if (value === 'danger') return '위험';
  if (value === 'blocked') return '차단';
  return '주의';
}

function testLabel(state) {
  const value = clean(state, 60).toLowerCase();
  if (value === 'passed') return '최근 서버 테스트 통과';
  if (value === 'failed') return '최근 서버 테스트 실패';
  if (value === 'blocked') return '테스트 차단';
  return '최근 테스트 기록 없음';
}

function builtInRows() {
  return BUILT_IN_LINKS.map(row => Object.assign({}, row, {
    managementState: row.state,
    risk: { level: row.scope === 'internal' ? 'safe' : 'watch', label: row.scope === 'internal' ? '안전' : '관찰', reason: row.scope === 'internal' ? '내부 기본 연동' : 'endpoint 미정/준비중' },
    latestTest: { state: 'not_run', label: '최근 서버 테스트 기록 없음', at: null, status: null },
    allowedMethods: [],
    webhookReady: null
  }));
}

async function listRegistry(config) {
  const rows = await dbSelect(config, config.registryTable, 'select=id,direction,name,endpoint,purpose,state,risk_level,risk_reason,allowed_methods,webhook_key_ref,test_state,test_http_status,tested_at,created_at,updated_at,approved_at,activated_at,expires_at&order=updated_at.desc&limit=' + MAX_ROWS);
  return Array.isArray(rows) ? rows : [];
}

async function findRegistry(config, id) {
  const safe = safeId(id, 180);
  if (!safe) throw failure(400, 'invalid_link_id', 'Core Link ID가 올바르지 않습니다.');
  const rows = await dbSelect(config, config.registryTable, 'select=*&id=eq.' + encodeURIComponent(safe) + '&limit=1');
  const row = Array.isArray(rows) && rows[0];
  if (!row) throw failure(404, 'core_link_not_found', 'Core Link 등록 항목을 찾을 수 없습니다.');
  return row;
}

async function listSecurityEvents(config, limit) {
  const cap = Math.max(1, Math.min(Number(limit) || 100, MAX_EVENTS));
  const rows = await dbSelect(config, config.eventTable, 'select=id,event_kind,integration_id,request_method,request_path,source_ip_hash,user_agent_summary,referer_host,signature_state,allowlist_state,risk_level,decision,rule_code,status_code,created_at&order=created_at.desc&limit=' + cap);
  return Array.isArray(rows) ? rows : [];
}

async function listDecisions(config, limit) {
  const cap = Math.max(1, Math.min(Number(limit) || 100, MAX_DECISIONS));
  const rows = await dbSelect(config, config.decisionTable, 'select=id,link_id,action,previous_state,next_state,actor_id,actor_role,reason,created_at&order=created_at.desc&limit=' + cap);
  return Array.isArray(rows) ? rows : [];
}

function safeEvent(row) {
  const sourceHash = clean(row && row.source_ip_hash, 80);
  return {
    id: safeId(row && row.id, 180),
    kind: clean(row && row.event_kind, 80),
    integrationId: safeId(row && row.integration_id, 180) || null,
    method: clean(row && row.request_method, 12),
    path: clean(row && row.request_path, 320),
    source: sourceHash ? `src_${sourceHash}` : null,
    userAgent: clean(row && row.user_agent_summary, 180),
    refererHost: clean(row && row.referer_host, 253) || null,
    signature: clean(row && row.signature_state, 60),
    allowlist: clean(row && row.allowlist_state, 60),
    risk: clean(row && row.risk_level, 30),
    decision: clean(row && row.decision, 80),
    rule: clean(row && row.rule_code, 100),
    statusCode: Number.isFinite(Number(row && row.status_code)) ? Number(row.status_code) : null,
    createdAt: row && row.created_at || null
  };
}

function safeDecision(row) {
  return {
    id: safeId(row && row.id, 180),
    linkId: safeId(row && row.link_id, 180),
    action: clean(row && row.action, 80),
    previousState: clean(row && row.previous_state, 60),
    nextState: clean(row && row.next_state, 60),
    actorId: clean(row && row.actor_id, 320) || null,
    actorRole: clean(row && row.actor_role, 80) || null,
    reason: clean(row && row.reason, 800),
    createdAt: row && row.created_at || null
  };
}

async function appendSecurityEvent(config, input) {
  if (!config || !config.ready) return null;
  const record = {
    id: randomId('clevt'),
    event_kind: clean(input && input.kind, 80) || 'security_event',
    integration_id: safeId(input && input.integrationId, 180) || null,
    request_method: clean(input && input.method, 12) || null,
    request_path: clean(input && input.path, 320) || null,
    source_ip_hash: clean(input && input.sourceIpHash, 64) || null,
    user_agent_summary: clean(input && input.userAgent, 180) || null,
    referer_host: clean(input && input.refererHost, 253) || null,
    signature_state: clean(input && input.signatureState, 60) || null,
    allowlist_state: clean(input && input.allowlistState, 60) || null,
    risk_level: clean(input && input.riskLevel, 30) || 'watch',
    decision: clean(input && input.decision, 80) || 'observed',
    rule_code: clean(input && input.ruleCode, 100) || null,
    status_code: Number.isFinite(Number(input && input.statusCode)) ? Number(input.statusCode) : null,
    nonce_hash: clean(input && input.nonceHash, 64) || null,
    created_at: isoNow()
  };
  await dbInsert(config, config.eventTable, record, 'return=minimal');
  return record;
}

async function appendDecision(config, actor, input) {
  const record = Object.assign({
    id: randomId('cldec'),
    link_id: safeId(input && input.linkId, 180) || null,
    action: clean(input && input.action, 80),
    previous_state: clean(input && input.previousState, 60) || null,
    next_state: clean(input && input.nextState, 60) || null,
    reason: clean(input && input.reason, 800) || null,
    created_at: isoNow()
  }, actorRecord(actor));
  await dbInsert(config, config.decisionTable, record, 'return=minimal');
  return record;
}

function ensureStorage(config) {
  if (!config || !config.ready) throw failure(503, 'core_link_storage_required', 'Core Link 보안 저장소가 아직 구성되지 않았습니다. 승인·차단·활성화는 저장소 연결 전에는 실행하지 않습니다.');
}

function controlSummary(rows, events) {
  const all = rows || [];
  const registry = all.filter(row => row.scope === 'external');
  const stateCount = name => registry.filter(row => row.state === name || row.managementState === name).length;
  return {
    totalLinks: all.length,
    internalConnected: all.filter(row => row.scope === 'internal' && row.state === 'connected').length,
    externalCandidate: stateCount('candidate') + stateCount('hold') + stateCount('test_failed'),
    approved: stateCount('approved'),
    active: stateCount('active'),
    blocked: stateCount('blocked'),
    securityEvents: (events || []).length,
    highRiskEvents: (events || []).filter(event => event.risk === 'danger' || event.risk === 'blocked').length
  };
}

function publicStorageState(config, issue) {
  const configured = Boolean(config && config.ready);
  const code = clean(issue && issue.code, 100) || (config && config.reason) || null;
  const base = {
    configured,
    ready: configured && !issue,
    mode: configured ? 'supabase' : (config && config.mode || 'unconfigured'),
    reason: code,
    diagnosticCode: code,
    lastCheckedAt: isoNow()
  };
  if (!issue) return base;
  if (code === 'core_link_storage_schema_required') {
    base.ready = false;
    base.mode = 'schema_required';
    base.message = 'Core Link 전용 보안 테이블을 찾지 못했습니다. 기존 목록과 점검 JSON은 유지되며, 등록·승인·차단·테스트는 닫힌 상태입니다.';
    return base;
  }
  if (code === 'core_link_storage_unavailable') {
    base.ready = false;
    base.mode = 'supabase_unavailable';
    base.message = 'Core Link 보안 저장소 연결을 확인하지 못했습니다. 기존 목록과 점검 JSON은 유지되며, 등록·승인·차단·테스트는 닫힌 상태입니다.';
    return base;
  }
  if (code === 'core_link_storage_required' || code === 'core_link_security_disabled' || code === 'supabase_credentials_missing') {
    base.ready = false;
    base.mode = configured ? 'storage_unavailable' : (config && config.mode || 'unconfigured');
    base.message = 'Core Link 보안 저장소가 아직 구성되지 않았습니다. 기존 목록과 점검 JSON은 유지되며, 등록·승인·차단·테스트는 닫힌 상태입니다.';
    return base;
  }
  base.ready = false;
  base.mode = 'storage_error';
  base.message = 'Core Link 보안 저장소 상태를 확인하지 못했습니다. 기존 목록과 점검 JSON은 유지되며, 등록·승인·차단·테스트는 닫힌 상태입니다.';
  return base;
}

function fallbackSnapshot(config, actor, issue) {
  const rows = builtInRows();
  const storage = publicStorageState(config, issue || null);
  const warning = storage.message || 'Core Link 보안 저장소가 아직 구성되지 않아 외부 유입 로그·승인 이력을 보존할 수 없습니다.';
  return {
    ok: true,
    version: VERSION,
    administrator: actor ? { role: actor.role, roles: actor.roles, sessionValidation: actor.sessionValidation } : null,
    storage,
    defaultDeny: true,
    rows,
    events: [],
    decisions: [],
    summary: controlSummary(rows, []),
    coverage: coverageStatement(),
    warnings: [warning],
    degraded: true
  };
}

async function buildSnapshot(config, actor, query) {
  if (!config || !config.ready) return fallbackSnapshot(config, actor, null);
  const eventLimit = Math.max(1, Math.min(Number(query && query.event_limit) || 100, MAX_EVENTS));
  const decisionLimit = Math.max(1, Math.min(Number(query && query.decision_limit) || 100, MAX_DECISIONS));
  try {
    const [registry, rawEvents, rawDecisions] = await Promise.all([
      listRegistry(config),
      listSecurityEvents(config, eventLimit),
      listDecisions(config, decisionLimit)
    ]);
    const external = registry.map(row => safeRegistryRow(row, config)).filter(row => row.id);
    const rows = builtInRows().concat(external);
    const events = rawEvents.map(safeEvent);
    const decisions = rawDecisions.map(safeDecision);
    return {
      ok: true,
      version: VERSION,
      administrator: actor ? { role: actor.role, roles: actor.roles, sessionValidation: actor.sessionValidation } : null,
      storage: publicStorageState(config, null),
      defaultDeny: true,
      rows,
      events,
      decisions,
      summary: controlSummary(rows, events),
      coverage: coverageStatement(),
      warnings: [],
      degraded: false
    };
  } catch (error) {
    // A failed storage read must not erase the built-in Core Link registry or
    // prevent the administrator from downloading a diagnostic. Control writes
    // still remain fail-closed through ensureStorage/dbRequest.
    return fallbackSnapshot(config, actor, error);
  }
}

function coverageStatement() {
  return {
    coreLinkGateway: 'Core Link 보안 게이트웨이와 승인된 inbound webhook 경로의 접근·차단·결정 이력을 기록합니다.',
    siteWideTraffic: '정적 파일·다른 API·WAF 선차단 요청 등 전체 사이트 접근은 배포 플랫폼/WAF 로그 영역이며, 이 함수만으로 전부 수집하지는 않습니다.',
    bodyPolicy: '요청 본문·비밀번호·토큰·API 키·인증 헤더는 저장하거나 JSON으로 내보내지 않습니다.'
  };
}

async function registerCandidate(config, actor, body) {
  ensureStorage(config);
  const direction = clean(body.direction, 24).toLowerCase();
  if (!DIRECTIONS.has(direction)) throw failure(400, 'invalid_core_link_direction', '외부 연동 방향은 inbound 또는 outbound만 허용됩니다.');
  const endpoint = normalizeExternalEndpoint(body.endpoint);
  const name = clean(body.name, 240);
  const purpose = clean(body.purpose, 2000);
  const webhookKeyRef = safeId(body.webhookKeyRef, 120) || null;
  if (!name || purpose.length < 5) throw failure(400, 'invalid_core_link_candidate', '연동 이름과 구체적인 목적을 입력해야 합니다.');
  const now = isoNow();
  const row = Object.assign({
    id: randomId('clink'),
    direction,
    name,
    endpoint,
    endpoint_host: new URL(endpoint).hostname,
    purpose,
    state: 'candidate',
    risk_level: 'watch',
    risk_reason: '관리자 등록 후보: 서버 안전 테스트와 최종 승인이 필요합니다.',
    allowed_methods: normalizedMethods(body.allowedMethods, direction),
    webhook_key_ref: webhookKeyRef,
    test_state: 'not_run',
    test_http_status: null,
    tested_at: null,
    created_at: now,
    updated_at: now,
    approved_at: null,
    activated_at: null,
    expires_at: null
  }, actorRecord(actor));
  await dbInsert(config, config.registryTable, row, 'return=minimal');
  await appendDecision(config, actor, { linkId: row.id, action: 'register_candidate', previousState: null, nextState: 'candidate', reason: '관리자 등록: 자동 연결 없음' });
  await appendSecurityEvent(config, { kind: 'admin_register_candidate', integrationId: row.id, method: 'POST', path: `${GATEWAY_PATH}?action=register`, signatureState: 'not_applicable', allowlistState: 'candidate', riskLevel: 'watch', decision: 'registered_not_active', ruleCode: 'default_deny' });
  return safeRegistryRow(row, config);
}

function endpointForInternalTest(event, row) {
  const endpoint = clean(row && row.endpoint, 2048);
  if (!endpoint || endpoint === 'igdc_core_status' || endpoint === 'pending-adapter') throw failure(400, 'internal_test_not_available', '이 내부 항목은 네트워크 endpoint 테스트 대상이 아닙니다.');
  if (!endpoint.startsWith('/')) throw failure(400, 'invalid_internal_endpoint', '내부 endpoint가 올바르지 않습니다.');
  const origin = clean(process.env.URL || '', 500).replace(/\/+$/, '');
  if (!/^https:\/\//i.test(origin)) throw failure(503, 'internal_test_origin_missing', '내부 endpoint 상태확인에 필요한 배포 origin이 설정되지 않았습니다.');
  return new URL(endpoint, origin).toString();
}

function pinnedHttpsHead(url, addresses) {
  const selected = (addresses || []).find(address => !isPrivateIp(address));
  if (!selected) return Promise.resolve({ status: null, reason: 'public_address_missing' });
  const family = net.isIP(selected) || 4;
  return new Promise(resolve => {
    let settled = false;
    const finish = result => { if (!settled) { settled = true; resolve(result); } };
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      path: url.pathname || '/',
      method: 'HEAD',
      agent: false,
      servername: url.hostname,
      headers: { 'User-Agent': 'IGDC-CoreLink-Security-Test/1.0', 'Accept': '*/*' },
      // Pin the already-validated public address so a later DNS answer cannot
      // redirect this one-time test toward a private/internal network.
      lookup: function(hostname, options, callback) { callback(null, selected, family); }
    }, response => {
      const status = Number(response.statusCode || 0) || null;
      response.resume();
      finish({ status, reason: status && status >= 300 && status < 400 ? 'redirect_blocked' : (status && status >= 200 && status < 300 ? 'https_head_ok' : `http_${status || 0}`) });
    });
    request.setTimeout(5000, () => { request.destroy(new Error('timeout')); finish({ status: null, reason: 'network_or_timeout' }); });
    request.on('error', () => finish({ status: null, reason: 'network_or_timeout' }));
    request.end();
  });
}

async function safeEndpointTest(target) {
  const check = await assertPublicResolvable(target);
  const started = Date.now();
  const result = await pinnedHttpsHead(check.url, check.addresses);
  const status = result.status;
  const passed = Number.isFinite(status) && status >= 200 && status < 300;
  return { passed, status, elapsedMs: Date.now() - started, reason: result.reason, resolved: check.addresses };
}

async function testLink(config, actor, event, body) {
  ensureStorage(config);
  const id = safeId(body.id, 180);
  if (!id) throw failure(400, 'invalid_link_id', 'Core Link ID가 필요합니다.');
  const builtIn = BUILT_IN_LINKS.find(row => row.id === id);
  let target = '';
  let record = null;
  let previousState = '';
  let result;
  if (builtIn) {
    target = endpointForInternalTest(event, builtIn);
    result = await safeEndpointTest(target);
    await appendSecurityEvent(config, { kind: 'internal_endpoint_test', integrationId: id, method: 'HEAD', path: new URL(target).pathname, signatureState: 'not_applicable', allowlistState: 'internal', riskLevel: result.passed ? 'safe' : 'watch', decision: result.passed ? 'test_passed' : 'test_failed', ruleCode: result.reason, statusCode: result.status });
    await appendDecision(config, actor, { linkId: id, action: 'test_internal_endpoint', previousState: builtIn.state, nextState: builtIn.state, reason: `서버 HEAD 테스트: ${result.reason}` });
    return { id, internal: true, result };
  }
  record = await findRegistry(config, id);
  previousState = clean(record.state, 60);
  if (previousState === 'blocked' || previousState === 'retired') throw failure(409, 'blocked_link_test_denied', '차단 또는 종료된 링크는 먼저 서버에서 재검토 상태로 전환해야 합니다.');
  result = await safeEndpointTest(record.endpoint);
  const nextState = result.passed ? 'test_passed' : 'test_failed';
  await dbPatch(config, config.registryTable, 'id=eq.' + encodeURIComponent(id), {
    state: nextState,
    test_state: result.passed ? 'passed' : 'failed',
    test_http_status: result.status,
    tested_at: isoNow(),
    updated_at: isoNow(),
    risk_level: result.passed ? 'normal' : 'watch',
    risk_reason: result.passed ? '서버 HTTPS HEAD 테스트 통과: 최종 승인 전' : `서버 테스트 실패: ${result.reason}`
  });
  await appendDecision(config, actor, { linkId: id, action: 'server_test', previousState, nextState, reason: `서버 HEAD 테스트: ${result.reason}` });
  await appendSecurityEvent(config, { kind: 'external_endpoint_test', integrationId: id, method: 'HEAD', path: new URL(record.endpoint).pathname, signatureState: 'not_applicable', allowlistState: previousState, riskLevel: result.passed ? 'normal' : 'watch', decision: result.passed ? 'test_passed' : 'test_failed', ruleCode: result.reason, statusCode: result.status });
  return { id, internal: false, result };
}

async function decideLink(config, actor, body, action) {
  ensureStorage(config);
  const id = safeId(body.id, 180);
  const reason = clean(body.reason, 800);
  if (!id) throw failure(400, 'invalid_link_id', 'Core Link ID가 필요합니다.');
  if (BUILT_IN_LINKS.some(row => row.id === id)) throw failure(409, 'internal_link_control_denied', '내부 기본 엔진은 이 외부 연동 승인·차단 흐름의 대상이 아닙니다.');
  const record = await findRegistry(config, id);
  const previousState = clean(record.state, 60);
  let nextState = previousState;
  const patch = { updated_at: isoNow() };
  if (action === 'hold') {
    nextState = 'hold'; patch.state = nextState; patch.risk_level = 'watch'; patch.risk_reason = '관리자 보류 상태';
  } else if (action === 'block') {
    nextState = 'blocked'; patch.state = nextState; patch.risk_level = 'blocked'; patch.risk_reason = reason || '관리자 차단';
  } else if (action === 'release') {
    requireFinalActor(actor); nextState = 'hold'; patch.state = nextState; patch.risk_level = 'watch'; patch.risk_reason = '차단 해제 후 재검토 필요';
  } else if (action === 'approve') {
    requireFinalActor(actor);
    if (clean(record.test_state, 60) !== 'passed') throw failure(409, 'server_test_required', '최종 승인 전 서버 안전 테스트 통과 기록이 필요합니다.');
    nextState = 'approved'; patch.state = nextState; patch.approved_at = isoNow(); patch.approved_by = actor.id; patch.risk_level = 'normal'; patch.risk_reason = '최종 승인 완료. 아직 활성 연결은 아님.';
  } else if (action === 'activate') {
    requireFinalActor(actor);
    if (previousState !== 'approved') throw failure(409, 'approval_required_before_activation', '활성화 전에는 최종 승인 상태가 필요합니다.');
    if (clean(record.direction, 24) === 'inbound') {
      const ref = clean(record.webhook_key_ref, 120);
      if (!ref || !config.webhookSecrets || !clean(config.webhookSecrets[ref], 4096)) throw failure(409, 'webhook_secret_reference_required', 'inbound 활성화에는 서버 환경변수에 등록된 webhook key reference가 필요합니다.');
    }
    nextState = 'active'; patch.state = nextState; patch.activated_at = isoNow(); patch.activated_by = actor.id; patch.risk_level = 'safe'; patch.risk_reason = '관리자 최종 활성화: 서버 allowlist에 등록됨';
  } else if (action === 'sync') {
    nextState = previousState;
  } else {
    throw failure(404, 'unsupported_core_link_action', '지원하지 않는 Core Link 제어 요청입니다.');
  }
  if (action !== 'sync') await dbPatch(config, config.registryTable, 'id=eq.' + encodeURIComponent(id), patch);
  await appendDecision(config, actor, { linkId: id, action, previousState, nextState, reason: reason || (action === 'sync' ? '외부 호출 없이 서버 목록/이력 새로고침' : '') });
  await appendSecurityEvent(config, { kind: `admin_${action}`, integrationId: id, method: 'POST', path: `${GATEWAY_PATH}?action=${encodeURIComponent(action)}`, signatureState: 'not_applicable', allowlistState: nextState, riskLevel: patch.risk_level || clean(record.risk_level, 30) || 'watch', decision: action === 'sync' ? 'record_refreshed' : `state_${nextState}`, ruleCode: `admin_${action}` });
  return { id, previousState, nextState };
}

function rawIngressIdentity(event, config) {
  const source = clientIp(event);
  return {
    sourceIpHash: hashSource(config, source),
    userAgent: userAgentSummary(event),
    refererHost: safeRefererHost(event)
  };
}

function parseTimestamp(value) {
  const raw = clean(value, 80);
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric > 100000000000 ? numeric : numeric * 1000;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function isReplay(config, integrationId, nonceHash) {
  if (!nonceHash) return false;
  const rows = await dbSelect(config, config.eventTable, 'select=id&integration_id=eq.' + encodeURIComponent(integrationId) + '&nonce_hash=eq.' + encodeURIComponent(nonceHash) + '&limit=1');
  return Array.isArray(rows) && rows.length > 0;
}

async function ingressRateLimited(config, sourceIpHash) {
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const rows = await dbSelect(config, config.eventTable, 'select=id&source_ip_hash=eq.' + encodeURIComponent(sourceIpHash) + '&created_at=gte.' + encodeURIComponent(since) + '&limit=' + config.ingressRatePerMinute);
  return Array.isArray(rows) && rows.length >= config.ingressRatePerMinute;
}

async function handleIngress(event, config) {
  const method = requestMethod(event);
  const identity = rawIngressIdentity(event, config || { auditSalt: 'unknown' });
  const requestPath = INGRESS_PATH;
  if (!config || !config.ready) return json(503, { ok: false, error: 'core_link_ingress_unavailable' });
  let parsed;
  try { parsed = parseBody(event, MAX_INGRESS_BYTES); }
  catch (error) {
    await appendSecurityEvent(config, { kind: 'inbound_attempt', method, path: requestPath, sourceIpHash: identity.sourceIpHash, userAgent: identity.userAgent, refererHost: identity.refererHost, signatureState: 'not_checked', allowlistState: 'none', riskLevel: 'danger', decision: 'blocked', ruleCode: error.code || 'request_too_large', statusCode: error.statusCode || 400 });
    return json(error.statusCode || 400, { ok: false, error: 'invalid_request' });
  }
  const body = parsed.json || {};
  const integrationId = safeId(body.integrationId || (event.queryStringParameters || {}).integration_id || (event.queryStringParameters || {}).integrationId, 180);
  const nonce = clean(header(event, 'x-igdc-nonce'), 160);
  const timestamp = parseTimestamp(header(event, 'x-igdc-timestamp'));
  const signature = clean(header(event, 'x-igdc-signature'), 300);
  const nonceHash = nonce ? hashSource(config, `${integrationId}|${nonce}`) : '';
  let record = null;
  try { if (integrationId) record = await findRegistry(config, integrationId); } catch (_) { record = null; }
  let rule = '';
  let signatureState = 'missing';
  let allowlistState = record ? clean(record.state, 60) : 'unknown';
  let decision = 'blocked';
  let riskLevel = 'danger';
  let statusCode = 403;
  if (!integrationId || !record) rule = 'unknown_integration';
  else if (clean(record.direction, 24) !== 'inbound') rule = 'direction_mismatch';
  else if (clean(record.state, 60) !== 'active') rule = 'not_active';
  else if (!normalizedMethods(record.allowed_methods, 'inbound').includes(method)) rule = 'method_not_allowed';
  else if (!timestamp || Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_SECONDS * 1000) rule = 'timestamp_invalid';
  else if (!nonce || !/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) rule = 'nonce_invalid';
  else if (await ingressRateLimited(config, identity.sourceIpHash)) rule = 'rate_limited';
  else if (await isReplay(config, integrationId, nonceHash)) rule = 'replay_detected';
  else {
    const keyRef = clean(record.webhook_key_ref, 120);
    const secret = keyRef && config.webhookSecrets && clean(config.webhookSecrets[keyRef], 4096);
    if (!secret) { rule = 'webhook_secret_unconfigured'; signatureState = 'not_configured'; }
    else {
      const received = signature.replace(/^sha256=/i, '');
      const expected = hmac(secret, `${timestamp}.${nonce}.${sha256(parsed.raw)}`);
      if (!received || !timingSafeEqual(received, expected)) { rule = 'signature_invalid'; signatureState = 'invalid'; }
      else { signatureState = 'valid'; decision = 'accepted_observe_only'; riskLevel = 'safe'; statusCode = 202; rule = 'validated_inbound_observed'; }
    }
  }
  await appendSecurityEvent(config, {
    kind: 'inbound_attempt', integrationId, method, path: requestPath,
    sourceIpHash: identity.sourceIpHash, userAgent: identity.userAgent, refererHost: identity.refererHost,
    signatureState, allowlistState, riskLevel, decision, ruleCode: rule, statusCode, nonceHash
  });
  if (statusCode === 202) return json(202, { ok: true, accepted: true, mode: 'observe_only', requestId: randomId('clingress') });
  return json(statusCode, { ok: false, error: 'core_link_ingress_denied' });
}

async function recordDeniedControlAttempt(event, config, error) {
  // Only authentication/origin denials are security ingress events. Validation,
  // storage, and operational errors from a legitimate administrator must not be
  // misclassified as hostile traffic in the audit JSON.
  const status = Number(error && error.statusCode) || 0;
  const code = clean(error && error.code, 100);
  const denied = status === 401 || status === 403 || code === 'cross_origin_control_denied';
  if (!denied || !config || !config.ready) return;
  const identity = rawIngressIdentity(event, config);
  try {
    await appendSecurityEvent(config, {
      kind: 'control_access_denied', method: requestMethod(event), path: clean(event && event.path, 320) || GATEWAY_PATH,
      sourceIpHash: identity.sourceIpHash, userAgent: identity.userAgent, refererHost: identity.refererHost,
      signatureState: 'not_applicable', allowlistState: 'none', riskLevel: 'danger', decision: 'blocked',
      ruleCode: code || 'admin_session_required', statusCode: status || 403
    });
  } catch (_) {}
}

async function handler(event) {
  const method = requestMethod(event);
  if (method === 'OPTIONS') return json(204, {});
  const action = routeAction(event);
  const config = storageConfig();
  if (action === 'ingress') return handleIngress(event, config);
  try {
    assertSameOrigin(event);
    const actor = await resolveControlActor(event);
    const parsed = method === 'GET' ? { raw: '', json: {} } : parseBody(event, 24 * 1024);
    const query = event && event.queryStringParameters || {};
    if (action === 'list' && method === 'GET') return json(200, await buildSnapshot(config, actor, query));
    if (action === 'events' && method === 'GET') {
      const snapshot = await buildSnapshot(config, actor, query);
      return json(200, { ok: true, version: VERSION, events: snapshot.events, coverage: snapshot.coverage, storage: snapshot.storage });
    }
    if (action === 'diagnostic' && method === 'GET') {
      const snapshot = await buildSnapshot(config, actor, query);
      return json(200, {
        reportType: 'igdc-core-link-security-diagnostic', version: VERSION, generatedAt: isoNow(),
        safety: { readOnly: true, writes: false, approvals: false, blocks: false, endpointTests: false, secretsExcluded: true, requestBodiesExcluded: true },
        administrator: snapshot.administrator, defaultDeny: true, storage: snapshot.storage, coverage: snapshot.coverage,
        summary: snapshot.summary, registry: snapshot.rows, ingressEvents: snapshot.events, decisionHistory: snapshot.decisions, warnings: snapshot.warnings
      });
    }
    if (action === 'register' && method === 'POST') return json(201, { ok: true, row: await registerCandidate(config, actor, parsed.json) });
    if (action === 'test' && method === 'POST') return json(200, { ok: true, result: await testLink(config, actor, event, parsed.json) });
    if (['hold', 'block', 'release', 'approve', 'activate', 'sync'].includes(action) && method === 'POST') return json(200, { ok: true, result: await decideLink(config, actor, parsed.json, action) });
    throw failure(404, 'unsupported_core_link_route', '지원하지 않는 Core Link 보안 게이트웨이 경로입니다.');
  } catch (error) {
    await recordDeniedControlAttempt(event, config, error);
    return json(error.statusCode || 500, { ok: false, error: error.code || 'core_link_security_error', message: error.message || 'Core Link 보안 게이트웨이 처리 중 오류가 발생했습니다.' });
  }
}

exports.handler = handler;
exports._test = {
  normalizeExternalEndpoint,
  isPrivateIp,
  blockedHost,
  sanitizeEndpoint,
  normalizedMethods,
  routeAction,
  safeRegistryRow,
  timingSafeEqual,
  parseTimestamp,
  coverageStatement
};
