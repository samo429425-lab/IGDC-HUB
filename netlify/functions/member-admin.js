/* IGDC Member Admin API v2.2 - Netlify Function
   Purpose: secure server-side Auth0/OS0 member list + role management for member-admin-modal.js.
   Required ENV:
   - AUTH0_DOMAIN                 ex) your-tenant.us.auth0.com
   - AUTH0_M2M_CLIENT_ID
   - AUTH0_M2M_CLIENT_SECRET
   Optional ENV:
   - AUTH0_AUDIENCE               default: https://AUTH0_DOMAIN/api/v2/
   - AUTH0_ROLES_CLAIM            default: https://igdcglobal.com/roles
   - AUTH0_ROLE_ID_MAP_JSON        ex) {"premium":"rol_xxx","admin":"rol_yyy"}
   - IGDC_ADMIN_ROLES              default: owner,admin,super_admin,manager
*/
const crypto = require('crypto');

const TOKEN_CACHE = { value: null, exp: 0 };
const JWKS_CACHE = { value: null, exp: 0 };

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return json(204, {});

    const env = readEnv();
    const requester = await authenticateRequester(event, env);
    const method = event.httpMethod || 'GET';
    const qs = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || qs.action || 'me';

    if (action === 'me') {
      return json(200, { ok: true, me: publicRequester(requester) });
    }

    if (['members', 'update-role', 'block-user', 'unblock-user'].includes(action)) {
      requireAdmin(requester, env);
    }

    if (method === 'GET' && action === 'members') {
      const page = clampInt(qs.page, 0, 1000);
      const perPage = clampInt(qs.per_page || qs.perPage, 1, 100);
      const q = buildUserQuery(qs.q || '');
      const users = await auth0Get(env, `/api/v2/users?search_engine=v3&include_totals=true&page=${page}&per_page=${perPage}${q ? '&q=' + encodeURIComponent(q) : ''}`);
      const list = Array.isArray(users) ? users : users.users || [];
      const publicList = await Promise.all(list.map(u => publicUserWithRoles(env, u)));
      return json(200, { ok: true, users: publicList, total: users.total || list.length, page, per_page: perPage });
    }

    if (method === 'POST' && action === 'update-role') {
      const userId = required(body.user_id, 'user_id');
      const role = normalizeRole(required(body.role, 'role'));
      await updateUserRole(env, userId, role, requester);
      return json(200, { ok: true });
    }

    if (method === 'POST' && action === 'block-user') {
      const userId = required(body.user_id, 'user_id');
      await auth0Patch(env, `/api/v2/users/${encodeURIComponent(userId)}`, { blocked: body.blocked !== false, app_metadata: { igdc_status: 'blocked', blocked_by: requester.sub, blocked_at: new Date().toISOString() } });
      return json(200, { ok: true });
    }

    if (method === 'POST' && action === 'unblock-user') {
      const userId = required(body.user_id, 'user_id');
      await auth0Patch(env, `/api/v2/users/${encodeURIComponent(userId)}`, { blocked: false, app_metadata: { igdc_status: 'active', unblocked_by: requester.sub, unblocked_at: new Date().toISOString() } });
      return json(200, { ok: true });
    }

    // These need a real DB/Form engine in production. Return a clear integration response, not fake persistence.
    if (method === 'POST' && ['submit-document', 'submit-question', 'admin-reply', 'request-upgrade'].includes(action)) {
      return json(501, { ok: false, error: '이 작업은 문서/문의 저장소 또는 검토 큐 DB 연결 후 활성화해야 합니다.' });
    }

    return json(404, { ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json(err.statusCode || 500, { ok: false, error: err.message || 'Server error' });
  }
};

function readEnv() {
  const domain = required(process.env.AUTH0_DOMAIN, 'AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    domain,
    audience: process.env.AUTH0_AUDIENCE || `https://${domain}/api/v2/`,
    clientId: required(process.env.AUTH0_M2M_CLIENT_ID, 'AUTH0_M2M_CLIENT_ID'),
    clientSecret: required(process.env.AUTH0_M2M_CLIENT_SECRET, 'AUTH0_M2M_CLIENT_SECRET'),
    rolesClaim: process.env.AUTH0_ROLES_CLAIM || 'https://igdcglobal.com/roles',
    adminRoles: String(process.env.IGDC_ADMIN_ROLES || 'owner,admin,super_admin,manager').split(',').map(normalizeRole),
    roleIdMap: safeJson(process.env.AUTH0_ROLE_ID_MAP_JSON || '{}'),
    loadUserRoles: String(process.env.AUTH0_LOAD_USER_ROLES || 'true') !== 'false'
  };
}
function required(v, name) {
  if (v === undefined || v === null || String(v).trim() === '') {
    const e = new Error('Missing required value: ' + name); e.statusCode = 400; throw e;
  }
  return String(v).trim();
}
function normalizeRole(v) { return String(v || '').trim().toLowerCase().replace(/\s+/g, '_'); }
function safeJson(v) { try { return JSON.parse(v); } catch (_) { return {}; } }
function clampInt(v, min, max) { const n = Number.parseInt(v, 10); return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min)); }
function buildUserQuery(q) {
  q = String(q || '').trim();
  if (!q) return '';
  const s = q.replace(/["\\]/g, '');
  return `email:*${s}* OR name:*${s}* OR user_id:*${s}*`;
}
function json(statusCode, data) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }, body: statusCode === 204 ? '' : JSON.stringify(data) };
}
function b64urlToBuffer(input) {
  input = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64');
}
function decodePart(part) { return JSON.parse(b64urlToBuffer(part).toString('utf8')); }
async function getJwks(env) {
  if (JWKS_CACHE.value && JWKS_CACHE.exp > Date.now()) return JWKS_CACHE.value;
  const res = await fetch(`https://${env.domain}/.well-known/jwks.json`);
  if (!res.ok) throw Object.assign(new Error('Failed to load JWKS'), { statusCode: 401 });
  const jwks = await res.json();
  JWKS_CACHE.value = jwks; JWKS_CACHE.exp = Date.now() + 60 * 60 * 1000;
  return jwks;
}
async function authenticateRequester(event, env) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw Object.assign(new Error('로그인이 필요합니다.'), { statusCode: 401 });
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Invalid token'), { statusCode: 401 });
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== 'RS256') throw Object.assign(new Error('Unsupported token algorithm'), { statusCode: 401 });
  if (payload.exp && payload.exp * 1000 < Date.now()) throw Object.assign(new Error('Token expired'), { statusCode: 401 });

  const jwks = await getJwks(env);
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw Object.assign(new Error('Signing key not found'), { statusCode: 401 });
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(parts[0] + '.' + parts[1]); verify.end();
  if (!verify.verify(key, b64urlToBuffer(parts[2]))) throw Object.assign(new Error('Token signature invalid'), { statusCode: 401 });

  const roles = extractRoles(payload, env);
  return { sub: payload.sub, email: payload.email, name: payload.name || payload.nickname || payload.email, roles, admin: roles.some(r => env.adminRoles.includes(r)) };
}
function extractRoles(payload, env) {
  let roles = [];
  [env.rolesClaim, 'https://igdcglobal.com/roles', 'https://example.com/roles', 'https://osu/roles', 'roles', 'role', 'permissions'].forEach(k => {
    const v = payload[k];
    if (Array.isArray(v)) roles = roles.concat(v);
    else if (typeof v === 'string') roles = roles.concat(v.split(','));
  });
  return [...new Set(roles.map(normalizeRole).filter(Boolean))];
}
function requireAdmin(requester) {
  if (!requester.admin) throw Object.assign(new Error('관리자 권한이 필요합니다.'), { statusCode: 403 });
}
function publicRequester(u) { return { user_id: u.sub, email: u.email, name: u.name, roles: u.roles, admin: u.admin }; }
async function publicUserWithRoles(env, u) {
  const meta = u.app_metadata || {};
  let roles = [];
  if (Array.isArray(meta.roles)) roles = roles.concat(meta.roles);
  if (meta.igdc_role) roles.push(meta.igdc_role);
  if (env.loadUserRoles) {
    try {
      const assigned = await auth0Get(env, `/api/v2/users/${encodeURIComponent(u.user_id)}/roles`);
      if (Array.isArray(assigned)) roles = roles.concat(assigned.map(r => r.name || r.id).filter(Boolean));
    } catch (_) {}
  }
  roles = [...new Set(roles.map(normalizeRole).filter(Boolean))];
  return { user_id: u.user_id, email: u.email, name: u.name || u.nickname || '', nickname: u.nickname || '', picture: u.picture || '', blocked: !!u.blocked, created_at: u.created_at, last_login: u.last_login, roles, app_metadata: meta };
}
async function managementToken(env) {
  if (TOKEN_CACHE.value && TOKEN_CACHE.exp > Date.now() + 30000) return TOKEN_CACHE.value;
  const res = await fetch(`https://${env.domain}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: env.clientId, client_secret: env.clientSecret, audience: env.audience }) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error_description || data.error || 'Auth0 M2M token failed'), { statusCode: 502 });
  TOKEN_CACHE.value = data.access_token;
  TOKEN_CACHE.exp = Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000;
  return TOKEN_CACHE.value;
}
async function auth0Request(env, method, path, body) {
  const token = await managementToken(env);
  const res = await fetch(`https://${env.domain}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  const data = txt ? safeJson(txt) || { raw: txt } : {};
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || `Auth0 ${method} ${path} failed`), { statusCode: res.status });
  return data;
}
function auth0Get(env, path) { return auth0Request(env, 'GET', path); }
function auth0Patch(env, path, body) { return auth0Request(env, 'PATCH', path, body); }
async function updateUserRole(env, userId, role, requester) {
  const roleId = env.roleIdMap && env.roleIdMap[role];
  await auth0Patch(env, `/api/v2/users/${encodeURIComponent(userId)}`, { app_metadata: { roles: [role], igdc_role: role, role_updated_by: requester.sub, role_updated_at: new Date().toISOString() } });
  if (roleId) {
    await auth0Request(env, 'POST', `/api/v2/users/${encodeURIComponent(userId)}/roles`, { roles: [roleId] });
  }
}
