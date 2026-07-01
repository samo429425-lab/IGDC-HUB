/* IGDC Member Admin API v2.5.2
 * Secure server-side Auth0/OSO member list and hierarchy enforcement.
 * Browser role labels are never trusted for list visibility or management.
 */
const crypto = require('crypto');

const TOKEN_CACHE = { value: null, exp: 0 };
const JWKS_CACHE = new Map();

const ROLE_LEVEL = {
  guest: 0,
  member: 1,
  member_standard: 2,
  member_premium: 3,
  special_member: 4,
  special_menber: 4,
  commerce_manager: 5,
  site_manager: 12,
  site_manager_home_om: 10,
  site_manager_distribution_om: 10,
  site_manager_donation_om: 10,
  site_manager_mediahub_om: 10,
  site_manager_networkhub_om: 10,
  site_manager_socialnetwork_om: 10,
  site_manager_tour_om: 10,
  site_manager_home_op: 11,
  site_manager_distribution_op: 11,
  site_manager_donation_op: 11,
  site_manager_mediahub_op: 11,
  site_manager_networkhub_op: 11,
  site_manager_socialnetwork_op: 11,
  site_manager_tour_op: 11,
  site_manager_home: 12,
  site_manager_distribution: 12,
  site_manager_donation: 12,
  site_manager_mediahub: 12,
  site_manager_networkhub: 12,
  site_manager_socialnetwork: 12,
  site_manager_tour: 12,
  coordinator_director: 13,
  site_manager_director: 14,
  director: 15,
  admin: 20,
  super_admin: 25,
  owner: 30
};

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
      return json(200, {
        ok: true,
        me: publicRequester(requester),
        management_scope: safeManagementScope(requester)
      });
    }

    if (method === 'GET' && action === 'members') {
      const scope = managementScope(requester);
      const requestedPage = clampInt(qs.page, 0, 1000000);
      const requestedPerPage = clampInt(qs.per_page || qs.perPage, 1, 100);
      const query = buildUserQuery(qs.q || '');
      const rawUsers = await listAllUsers(env, query);
      const publicUsers = await mapWithConcurrency(rawUsers, 4, user => publicUserWithRoles(env, user));
      const visibleUsers = publicUsers.filter(user => scopeAllows(scope, user.roles || []));
      const start = requestedPage * requestedPerPage;
      const pageUsers = visibleUsers.slice(start, start + requestedPerPage);

      return json(200, {
        ok: true,
        users: pageUsers,
        total: visibleUsers.length,
        page: requestedPage,
        per_page: requestedPerPage,
        has_more: start + requestedPerPage < visibleUsers.length,
        scope: publicScope(scope)
      });
    }

    if (method === 'POST' && action === 'update-role') {
      const scope = managementScope(requester);
      const userId = required(body.user_id, 'user_id');
      const requestedRole = normalizeRole(required(body.role, 'role'));
      const target = await getPublicUserWithRoles(env, userId);
      requireTargetVisible(scope, target.roles || []);
      requireRoleAssignment(scope, requestedRole);
      await updateUserRole(env, userId, requestedRole, requester);
      return json(200, { ok: true });
    }

    if (method === 'POST' && (action === 'block-user' || action === 'unblock-user')) {
      const scope = managementScope(requester);
      const userId = required(body.user_id, 'user_id');
      const target = await getPublicUserWithRoles(env, userId);
      requireTargetVisible(scope, target.roles || []);
      const blocked = action === 'block-user' ? body.blocked !== false : false;
      await auth0Patch(env, `/api/v2/users/${encodeURIComponent(userId)}`, {
        blocked,
        app_metadata: {
          igdc_status: blocked ? 'blocked' : 'active',
          [blocked ? 'blocked_by' : 'unblocked_by']: requester.sub,
          [blocked ? 'blocked_at' : 'unblocked_at']: new Date().toISOString()
        }
      });
      return json(200, { ok: true });
    }

    // These require a production document/question store. Do not fake persistence.
    if (method === 'POST' && ['submit-document', 'submit-question', 'admin-reply', 'request-upgrade', 'review-document'].includes(action)) {
      return json(501, { ok: false, error: '이 작업은 문서·문의·검토 저장소가 연결된 뒤 활성화됩니다.' });
    }
    if (method === 'GET' && action === 'review-documents') {
      managementScope(requester);
      return json(501, { ok: false, error: '승급 검토 큐 저장소가 아직 연결되지 않았습니다.' });
    }

    return json(404, { ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json(err.statusCode || 500, { ok: false, error: err.message || 'Server error' });
  }
};

function normalizeIssuer(value) {
  let issuer = String(value || '').trim();
  if (!issuer) return '';
  if (!/^https:\/\//i.test(issuer)) issuer = 'https://' + issuer;
  return issuer.replace(/\/+$/, '') + '/';
}

function issuerList(value) {
  return [...new Set(String(value || '').split(',').map(normalizeIssuer).filter(Boolean))];
}

function readEnv() {
  // AUTH0_DOMAIN remains the Auth0 Management API host. The browser signs in
  // through the public custom domain login.igdcglobal.com, whose issuer/JWKS
  // must be verified separately from the Management API host.
  const domain = required(process.env.AUTH0_DOMAIN, 'AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const publicIssuer = normalizeIssuer(process.env.AUTH0_PUBLIC_ISSUER || 'https://login.igdcglobal.com/');
  const trustedIssuers = [...new Set([
    publicIssuer,
    normalizeIssuer(`https://${domain}/`),
    ...issuerList(process.env.AUTH0_TRUSTED_ISSUERS || '')
  ].filter(Boolean))];
  return {
    domain,
    audience: process.env.AUTH0_AUDIENCE || `https://${domain}/api/v2/`,
    clientId: required(process.env.AUTH0_M2M_CLIENT_ID, 'AUTH0_M2M_CLIENT_ID'),
    clientSecret: required(process.env.AUTH0_M2M_CLIENT_SECRET, 'AUTH0_M2M_CLIENT_SECRET'),
    publicClientId: String(process.env.AUTH0_PUBLIC_CLIENT_ID || '').trim(),
    publicIssuer,
    trustedIssuers,
    rolesClaim: process.env.AUTH0_ROLES_CLAIM || 'https://igdcglobal.com/roles',
    roleIdMap: safeJson(process.env.AUTH0_ROLE_ID_MAP_JSON || '{}'),
    loadUserRoles: String(process.env.AUTH0_LOAD_USER_ROLES || 'true') !== 'false'
  };
}

function required(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    const err = new Error('Missing required value: ' + name);
    err.statusCode = 400;
    throw err;
  }
  return String(value).trim();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s.]+/g, '_');
}

function uniqueRoles(values) {
  return [...new Set((values || []).map(normalizeRole).filter(Boolean))];
}

function roleLevel(role) {
  const normalized = normalizeRole(role);
  if (Object.prototype.hasOwnProperty.call(ROLE_LEVEL, normalized)) return ROLE_LEVEL[normalized];
  if (normalized.indexOf('site_manager_') === 0) return 12;
  return 0;
}

function highestRole(roles) {
  const values = uniqueRoles(roles);
  if (!values.length) return 'guest';
  return values.sort((left, right) => roleLevel(right) - roleLevel(left))[0] || 'guest';
}

function isDelegatedManager(role) {
  role = normalizeRole(role);
  return role === 'director' || role === 'coordinator_director' || role === 'site_manager' || role === 'site_manager_director' || role.indexOf('site_manager_') === 0;
}

function managementScope(requester) {
  const role = highestRole(requester.roles || []);
  if (role === 'owner') return { kind: 'all', role, level: roleLevel(role) };
  if (role === 'admin' || role === 'super_admin') return { kind: 'all_except_owner', role, level: roleLevel(role) };
  if (isDelegatedManager(role)) return { kind: 'below_only', role, level: roleLevel(role) };
  const err = new Error('관리자 권한이 필요합니다.');
  err.statusCode = 403;
  throw err;
}

function safeManagementScope(requester) {
  try { return publicScope(managementScope(requester)); }
  catch (_) { return { kind: 'self_only', role: highestRole(requester.roles || []) }; }
}

function publicScope(scope) {
  return { kind: scope.kind, role: scope.role };
}

function scopeAllows(scope, targetRoles) {
  const target = highestRole(targetRoles || []);
  if (scope.kind === 'all') return true;
  if (scope.kind === 'all_except_owner') return target !== 'owner';
  if (scope.kind === 'below_only') return roleLevel(target) < scope.level;
  return false;
}

function requireTargetVisible(scope, targetRoles) {
  if (scopeAllows(scope, targetRoles || [])) return;
  const err = new Error('상위 또는 동급 권한 회원에는 접근할 수 없습니다.');
  err.statusCode = 403;
  throw err;
}

function requireRoleAssignment(scope, requestedRole) {
  if (scopeAllows(scope, [requestedRole])) return;
  const err = new Error('현재 권한으로 해당 롤을 부여할 수 없습니다.');
  err.statusCode = 403;
  throw err;
}

function safeJson(value) {
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function clampInt(value, min, max) {
  const number = Number.parseInt(value, 10);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
}

function buildUserQuery(query) {
  const value = String(query || '').trim();
  if (!value) return '';
  const safe = value.replace(/["\\]/g, '');
  return `email:*${safe}* OR name:*${safe}* OR user_id:*${safe}*`;
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    },
    body: statusCode === 204 ? '' : JSON.stringify(data)
  };
}

function b64urlToBuffer(input) {
  input = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64');
}

function decodePart(part) {
  return JSON.parse(b64urlToBuffer(part).toString('utf8'));
}

async function getJwks(issuer) {
  const normalizedIssuer = normalizeIssuer(issuer);
  const cached = JWKS_CACHE.get(normalizedIssuer);
  if (cached && cached.exp > Date.now()) return cached.value;
  const response = await fetch(normalizedIssuer + '.well-known/jwks.json');
  if (!response.ok) throw Object.assign(new Error('Failed to load issuer JWKS'), { statusCode: 401 });
  const jwks = await response.json();
  JWKS_CACHE.set(normalizedIssuer, { value: jwks, exp: Date.now() + 60 * 60 * 1000 });
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
  if (payload.nbf && payload.nbf * 1000 > Date.now() + 15000) throw Object.assign(new Error('Token not active'), { statusCode: 401 });
  const issuer = normalizeIssuer(payload.iss);
  if (!issuer || env.trustedIssuers.indexOf(issuer) < 0) throw Object.assign(new Error('Token issuer mismatch'), { statusCode: 401 });
  if (env.publicClientId) {
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audience.indexOf(env.publicClientId) === -1) throw Object.assign(new Error('Token audience mismatch'), { statusCode: 401 });
  }

  const jwks = await getJwks(issuer);
  const jwk = (jwks.keys || []).find(key => key.kid === header.kid);
  if (!jwk) throw Object.assign(new Error('Signing key not found'), { statusCode: 401 });
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(parts[0] + '.' + parts[1]);
  verify.end();
  if (!verify.verify(key, b64urlToBuffer(parts[2]))) throw Object.assign(new Error('Token signature invalid'), { statusCode: 401 });

  const claimRoles = extractRoles(payload, env);
  const serverRoles = await requesterRoles(env, payload.sub);
  // Auth0 role assignments/app_metadata are authoritative when available.
  // Signed custom-claim roles are retained for deployments that issue roles only in the ID token.
  const roles = uniqueRoles(serverRoles.length ? serverRoles.concat(claimRoles) : claimRoles);
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.nickname || payload.email,
    roles,
    role: highestRole(roles)
  };
}

function extractRoles(payload, env) {
  let roles = [];
  [env.rolesClaim, 'https://igdcglobal.com/roles', 'https://os.auth/roles', 'https://os0.app/roles', 'https://example.com/roles', 'https://osu/roles', 'roles', 'role', 'permissions'].forEach(claim => {
    const value = payload[claim];
    if (Array.isArray(value)) roles = roles.concat(value);
    else if (typeof value === 'string') roles = roles.concat(value.split(','));
  });
  return uniqueRoles(roles);
}

function publicRequester(user) {
  return {
    user_id: user.sub,
    email: user.email,
    name: user.name,
    roles: user.roles,
    role: user.role,
    admin: safeManagementScope(user).kind !== 'self_only',
    manager: safeManagementScope(user).kind !== 'self_only'
  };
}

async function listAllUsers(env, query) {
  const users = [];
  const seen = new Set();
  let page = 0;
  let total = null;
  const perPage = 100;

  do {
    const payload = await auth0Get(env, `/api/v2/users?search_engine=v3&include_totals=true&page=${page}&per_page=${perPage}${query ? '&q=' + encodeURIComponent(query) : ''}`);
    const batch = Array.isArray(payload) ? payload : payload.users || [];
    if (total === null && payload && !Array.isArray(payload) && Number.isFinite(Number(payload.total))) total = Number(payload.total);
    batch.forEach(user => {
      if (user && user.user_id && !seen.has(user.user_id)) {
        seen.add(user.user_id);
        users.push(user);
      }
    });
    page += 1;
    if (!batch.length || batch.length < perPage) break;
  } while (total === null || users.length < total);

  return users;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);
  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function getPublicUserWithRoles(env, userId) {
  const user = await auth0Get(env, `/api/v2/users/${encodeURIComponent(userId)}`);
  return publicUserWithRoles(env, user);
}

async function requesterRoles(env, userId) {
  try {
    const user = await auth0Get(env, `/api/v2/users/${encodeURIComponent(userId)}`);
    return auth0UserRoles(env, user);
  } catch (error) {
    return [];
  }
}

async function auth0UserRoles(env, user) {
  const metadata = user.app_metadata || {};
  let roles = [];
  if (Array.isArray(metadata.roles)) roles = roles.concat(metadata.roles);
  if (metadata.igdc_role) roles.push(metadata.igdc_role);
  if (env.loadUserRoles && user && user.user_id) {
    try {
      const assigned = await auth0Get(env, `/api/v2/users/${encodeURIComponent(user.user_id)}/roles`);
      if (Array.isArray(assigned)) roles = roles.concat(assigned.map(role => role.name || role.id).filter(Boolean));
    } catch (_) {}
  }
  return uniqueRoles(roles);
}

async function publicUserWithRoles(env, user) {
  const metadata = user.app_metadata || {};
  const roles = await auth0UserRoles(env, user);
  return {
    user_id: user.user_id,
    email: user.email,
    name: user.name || user.nickname || '',
    nickname: user.nickname || '',
    picture: user.picture || '',
    blocked: !!user.blocked,
    created_at: user.created_at,
    last_login: user.last_login,
    roles
  };
}

async function managementToken(env) {
  if (TOKEN_CACHE.value && TOKEN_CACHE.exp > Date.now() + 30000) return TOKEN_CACHE.value;
  const response = await fetch(`https://${env.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.clientId,
      client_secret: env.clientSecret,
      audience: env.audience
    })
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error_description || data.error || 'Auth0 M2M token failed'), { statusCode: 502 });
  TOKEN_CACHE.value = data.access_token;
  TOKEN_CACHE.exp = Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000;
  return TOKEN_CACHE.value;
}

async function auth0Request(env, method, path, body) {
  const token = await managementToken(env);
  const response = await fetch(`https://${env.domain}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const data = text ? safeJson(text) || { raw: text } : {};
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || `Auth0 ${method} ${path} failed`), { statusCode: response.status });
  return data;
}

function auth0Get(env, path) {
  return auth0Request(env, 'GET', path);
}

function auth0Patch(env, path, body) {
  return auth0Request(env, 'PATCH', path, body);
}

async function updateUserRole(env, userId, role, requester) {
  const roleId = env.roleIdMap && env.roleIdMap[role];
  await auth0Patch(env, `/api/v2/users/${encodeURIComponent(userId)}`, {
    app_metadata: {
      roles: [role],
      igdc_role: role,
      role_updated_by: requester.sub,
      role_updated_at: new Date().toISOString()
    }
  });

  if (!roleId) return;

  try {
    const assigned = await auth0Get(env, `/api/v2/users/${encodeURIComponent(userId)}/roles`);
    const managedIds = new Set(Object.keys(env.roleIdMap || {}).map(key => env.roleIdMap[key]).filter(Boolean));
    const replaceIds = (assigned || []).map(item => item.id).filter(id => managedIds.has(id));
    if (replaceIds.length) {
      await auth0Request(env, 'DELETE', `/api/v2/users/${encodeURIComponent(userId)}/roles`, { roles: replaceIds });
    }
  } catch (_) {
    // Metadata remains authoritative where M2M role replacement is not enabled.
  }

  await auth0Request(env, 'POST', `/api/v2/users/${encodeURIComponent(userId)}/roles`, { roles: [roleId] });
}
