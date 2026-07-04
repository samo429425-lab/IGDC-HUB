/* IGDC Member Admin API v2.7.5-member-review-diagnostic
 * Secure server-side Auth0/OSO member list and hierarchy enforcement.
 * OSO/M2M remains the automatic source for ordinary member roles.
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

const AUTO_MANAGED_ROLES = new Set(['guest', 'member', 'member_standard']);
const PROTECTED_ROLES = new Set(['owner', 'admin', 'super_admin']);
const ROLE_AUDIT_LIMIT = 32;
const BLOCK_CHALLENGE_TTL_MS = 5 * 60 * 1000;

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

    if (method === 'GET' && action === 'member-review-diagnostic') {
      const report = await memberReviewDiagnostic(env, requester);
      return json(200, { ok: true, report });
    }

    if (method === 'GET' && action === 'members') {
      const scope = managementScope(requester);
      const requestedPage = clampInt(qs.page, 0, 1000000);
      const requestedPerPage = clampInt(qs.per_page || qs.perPage, 1, 100);
      const query = buildUserQuery(qs.q || '');
      const rawUsers = await listAllUsers(env, query);
      const publicUsers = await mapWithConcurrency(rawUsers, 4, user => publicUserWithRoles(env, user));
      const visibleUsers = publicUsers.filter(user => scopeAllowsDirectory(scope, user.roles || [], user.site_keys || []));
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
      requireTargetVisible(scope, target.roles || [], target.site_keys || []);
      requireRoleAssignment(scope, requestedRole);
      requireManualRoleAssignment(requestedRole);
      await updateUserRole(env, userId, requestedRole, requester, body.reason);
      return json(200, { ok: true });
    }

    if (method === 'POST' && action === 'clear-role-override') {
      const scope = managementScope(requester);
      const userId = required(body.user_id, 'user_id');
      const target = await getPublicUserWithRoles(env, userId);
      requireTargetVisible(scope, target.roles || [], target.site_keys || []);
      await clearRoleOverride(env, userId, requester, body.reason);
      return json(200, { ok: true });
    }

    if (method === 'POST' && action === 'prepare-block') {
      const scope = managementScope(requester);
      const userId = required(body.user_id, 'user_id');
      const target = await getPublicUserWithRoles(env, userId);
      const reason = normalizeReason(body.reason);
      requireBlockTarget(scope, requester, target, env);
      const protectedAccount = !!target.protected_account;
      const challenge = issueBlockChallenge(env, {
        requester_id: requester.sub,
        user_id: userId,
        protected_account: protectedAccount,
        reason,
        exp: Date.now() + BLOCK_CHALLENGE_TTL_MS
      });
      return json(200, {
        ok: true,
        block_token: challenge,
        protected_account: protectedAccount,
        confirmation_phrase: protectedAccount ? blockConfirmationPhrase(target) : '',
        expires_at: new Date(Date.now() + BLOCK_CHALLENGE_TTL_MS).toISOString()
      });
    }

    if (method === 'POST' && action === 'block-user') {
      const scope = managementScope(requester);
      const userId = required(body.user_id, 'user_id');
      const challenge = verifyBlockChallenge(env, required(body.block_token, 'block_token'));
      if (challenge.requester_id !== requester.sub || challenge.user_id !== userId || !challenge.exp || Number(challenge.exp) < Date.now()) {
        throw forbidden('차단 검토 확인이 만료되었거나 대상과 일치하지 않습니다.');
      }
      const target = await getPublicUserWithRoles(env, userId);
      requireBlockTarget(scope, requester, target, env);
      if (!!challenge.protected_account !== !!target.protected_account) {
        throw forbidden('보호 계정 상태가 변경되었습니다. 차단 검토를 다시 시작해야 합니다.');
      }
      if (target.protected_account && String(body.confirmation_phrase || '') !== blockConfirmationPhrase(target)) {
        throw forbidden('보호 계정 최종 확인 문구가 일치하지 않습니다.');
      }
      await setUserBlocked(env, target, requester, true, challenge.reason);
      return json(200, { ok: true });
    }

    if (method === 'POST' && action === 'unblock-user') {
      const scope = managementScope(requester);
      const userId = required(body.user_id, 'user_id');
      const target = await getPublicUserWithRoles(env, userId);
      requireTargetVisible(scope, target.roles || [], target.site_keys || []);
      if (requester.sub === userId) throw forbidden('자기 자신의 차단 상태는 이 화면에서 변경할 수 없습니다.');
      if (target.protected_account && scope.role !== 'owner') {
        throw forbidden('보호 계정의 상태 변경은 owner만 처리할 수 있습니다.');
      }
      await setUserBlocked(env, target, requester, false, body.reason);
      return json(200, { ok: true });
    }

    // Member review records and private supporting files are stored through the server-side
    // Supabase service role. Browser clients never receive the service role key.
    if (method === 'POST' && action === 'request-upgrade') {
      const document = await createUpgradeRequest(env, requester, body);
      return json(201, { ok: true, document, already_pending: !!document.already_pending });
    }

    if (method === 'POST' && action === 'submit-document') {
      const result = await createReviewDocument(env, requester, body);
      return json(201, Object.assign({ ok: true }, result));
    }

    if (method === 'POST' && action === 'complete-document-upload') {
      const document = await completeReviewDocumentUpload(env, requester, body);
      return json(200, { ok: true, document });
    }

    if (method === 'GET' && action === 'my-review-documents') {
      const result = await listOwnReviewDocuments(env, requester, qs);
      return json(200, Object.assign({ ok: true }, result));
    }

    if (method === 'GET' && action === 'review-documents') {
      const result = await listReviewDocuments(env, requester, qs);
      return json(200, Object.assign({ ok: true }, result));
    }

    if (method === 'GET' && action === 'review-document-url') {
      const result = await createReviewDocumentDownloadUrl(env, requester, qs);
      return json(200, Object.assign({ ok: true }, result));
    }

    if (method === 'POST' && action === 'review-document') {
      const document = await reviewMemberDocument(env, requester, body);
      return json(200, { ok: true, document });
    }

    // The Q&A / reply store is intentionally kept inactive until its own operational
    // workflow is connected. It is separate from membership-review records.
    if (method === 'POST' && ['submit-question', 'admin-reply'].includes(action)) {
      return json(501, { ok: false, error: '질문·답글 저장소는 별도 운영 연결 후 활성화됩니다.' });
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
    loadUserRoles: String(process.env.AUTH0_LOAD_USER_ROLES || 'true') !== 'false',
    protectedUserIds: new Set(String(process.env.IGDC_PROTECTED_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean)),
    supabaseUrl: String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    supabaseServiceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim(),
    memberReviewTable: String(process.env.MEMBER_REVIEW_TABLE || 'igdc_member_review_cases').trim(),
    memberReviewFilesTable: String(process.env.MEMBER_REVIEW_FILES_TABLE || 'igdc_member_review_files').trim(),
    memberReviewEventsTable: String(process.env.MEMBER_REVIEW_EVENTS_TABLE || 'igdc_member_review_events').trim(),
    memberReviewBucket: String(process.env.MEMBER_REVIEW_BUCKET || 'igdc-member-review').trim(),
    memberReviewMaxFiles: optionalPositiveInt(process.env.MEMBER_REVIEW_MAX_FILES),
    memberReviewMaxUploadBytes: optionalPositiveInt(process.env.MEMBER_REVIEW_MAX_UPLOAD_BYTES),
    memberReviewAllowedMimeTypes: new Set(String(process.env.MEMBER_REVIEW_ALLOWED_MIME_TYPES || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
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
  const list = Array.isArray(values)
    ? values
    : (typeof values === 'string' ? values.split(',') : []);
  return [...new Set(list.map(normalizeRole).filter(Boolean))];
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

function normalizeSiteKey(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function uniqueSiteKeys(values) {
  const out = [];
  const seen = new Set();
  function add(value) {
    const key = normalizeSiteKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  }
  function read(value) {
    if (Array.isArray(value)) return value.forEach(read);
    if (typeof value === 'string') return value.split(',').forEach(add);
    if (value && typeof value === 'object') {
      if (value.site_key || value.site || value.key || value.id) {
        add(value.site_key || value.site || value.key || value.id);
        return;
      }
      Object.keys(value).forEach(key => {
        if (value[key] === true || value[key] === 1 || value[key] === 'true') add(key);
      });
      return;
    }
    if (value !== undefined && value !== null) add(value);
  }
  read(values);
  return out;
}

function siteKeyFromManagerRole(role) {
  const normalized = normalizeRole(role);
  if (!normalized.startsWith('site_manager_') || normalized === 'site_manager_director') return '';
  return normalizeSiteKey(normalized.replace(/^site_manager_/, '').replace(/_(?:om|op)$/, ''));
}

function siteKeyFromMembershipRole(role) {
  const normalized = normalizeRole(role);
  const managerSite = siteKeyFromManagerRole(normalized);
  if (managerSite) return managerSite;
  if (normalized.startsWith('site_member_')) return normalizeSiteKey(normalized.replace(/^site_member_/, ''));
  if (normalized.startsWith('member_site_')) return normalizeSiteKey(normalized.replace(/^member_site_/, ''));
  return '';
}

function siteKeysFromMetadata(metadata, roles) {
  const meta = metadata || {};
  const values = [
    meta.igdc_site_keys,
    meta.igdc_site_key,
    meta.site_keys,
    meta.site_key,
    meta.igdc_site_memberships,
    meta.site_memberships
  ];
  const roleKeys = uniqueRoles(roles || []).map(siteKeyFromMembershipRole).filter(Boolean);
  return uniqueSiteKeys(values.concat(roleKeys));
}

function isDirectorRole(role) {
  role = normalizeRole(role);
  return role === 'director' || role === 'coordinator_director' || role === 'site_manager_director';
}

function isSiteManagerRole(role) {
  role = normalizeRole(role);
  return role === 'site_manager' || (role.startsWith('site_manager_') && role !== 'site_manager_director');
}

function siteManagerVariant(role) {
  const normalized = normalizeRole(role);
  if (/^site_manager_.+_om$/.test(normalized)) return 'om';
  if (/^site_manager_.+_op$/.test(normalized)) return 'op';
  if (isSiteManagerRole(normalized)) return 'site_manager';
  return '';
}

// Site-manager privacy matrix:
// - Global consumer tiers (member through commerce_manager) are directory-only.
// - Site-manager accounts may expose/manage only same-site OM/OP accounts below
//   the requester's own level. A site manager never gains cross-site access simply
//   because another role is lower in the generic hierarchy.
function isSiteOperationalRole(role) {
  return /^site_manager_[a-z0-9_]+_(?:om|op)$/.test(normalizeRole(role));
}

function roleSiteKeys(role) {
  const key = siteKeyFromManagerRole(role);
  return key ? [key] : [];
}

function isSameSiteLowerOperationalTarget(scope, targetRoles, targetSiteKeys) {
  const target = highestRole(targetRoles || []);
  if (!isSiteOperationalRole(target)) return false;
  if (roleLevel(target) >= Number(scope.level || 0)) return false;
  const roleSites = roleSiteKeys(target);
  return sharesSite(scope.siteKeys || [], targetSiteKeys || []) &&
    (!roleSites.length || sharesSite(scope.siteKeys || [], roleSites));
}

function canSiteManagerAssignRole(scope, requestedRole) {
  const role = normalizeRole(requestedRole);
  return isSiteOperationalRole(role) &&
    roleLevel(role) < Number(scope.level || 0) &&
    sharesSite(scope.siteKeys || [], roleSiteKeys(role));
}

function managementScope(requester) {
  const roles = uniqueRoles(requester.roles || []);
  const role = highestRole(roles);
  if (role === 'owner') return { kind: 'all', role, level: roleLevel(role), siteKeys: [] };
  if (role === 'admin' || role === 'super_admin') return { kind: 'all_except_owner', role, level: roleLevel(role), siteKeys: [] };
  if (isDirectorRole(role)) return { kind: 'below_only', role, level: roleLevel(role), siteKeys: [] };
  if (isSiteManagerRole(role)) {
    // All site-manager variants use the same privacy boundary:
    // - OM/OP/basic site managers may see global consumer/member tiers only as a directory;
    // - site-bound operational accounts and submitted records are restricted to their own site;
    // - within that site, only lower role levels may be managed or reviewed.
    return {
      kind: 'site_only_below',
      role,
      level: roleLevel(role),
      siteKeys: uniqueSiteKeys(requester.site_keys || []),
      siteVariant: siteManagerVariant(role)
    };
  }
  const err = new Error('관리자 권한이 필요합니다. 일반·스탠다드·프리미엄·특수·커머스 회원은 본인 신청 자료만 볼 수 있습니다.');
  err.statusCode = 403;
  throw err;
}

function safeManagementScope(requester) {
  try { return publicScope(managementScope(requester)); }
  catch (_) { return { kind: 'self_only', role: highestRole(requester.roles || []), site_keys: [] }; }
}

function publicScope(scope) {
  return {
    kind: scope.kind,
    role: scope.role,
    site_keys: uniqueSiteKeys(scope.siteKeys || []),
    site_variant: scope.siteVariant || ''
  };
}

function sharesSite(scopeSiteKeys, targetSiteKeys) {
  const allowed = new Set(uniqueSiteKeys(scopeSiteKeys || []));
  return uniqueSiteKeys(targetSiteKeys || []).some(key => allowed.has(key));
}

function isCommonGlobalMember(targetRoles, targetSiteKeys) {
  const role = highestRole(targetRoles || []);
  // Consumer/member tiers are global unless a concrete site assignment exists.
  // Site operations (OP/OM/site manager etc.) always carry a site key and never
  // become globally visible merely because they are lower in the role hierarchy.
  return roleLevel(role) <= roleLevel('commerce_manager') && uniqueSiteKeys(targetSiteKeys || []).length === 0;
}

// Strict authority check: used for role changes, block/unblock, review decisions,
// attachment access, and all other actions that alter or expose sensitive records.
function scopeAllows(scope, targetRoles, targetSiteKeys) {
  const target = highestRole(targetRoles || []);
  if (scope.kind === 'all') return true;
  if (scope.kind === 'all_except_owner') return target !== 'owner';
  if (scope.kind === 'below_only') return roleLevel(target) < scope.level;
  if (scope.kind === 'site_only_below') {
    // Common members are never administrable by a site manager. Only an OM/OP
    // in the same assigned site, lower than the requester, is an actionable target.
    return isSameSiteLowerOperationalTarget(scope, targetRoles, targetSiteKeys);
  }
  return false;
}

// Directory visibility is deliberately narrower than full administration:
// site managers can see global consumer/member accounts as a directory, plus
// only same-site OM/OP accounts below their own level. Other site-bound accounts
// never appear merely because their generic role level is lower.
function scopeAllowsDirectory(scope, targetRoles, targetSiteKeys) {
  if (scope.kind !== 'site_only_below') return scopeAllows(scope, targetRoles, targetSiteKeys);
  return isCommonGlobalMember(targetRoles, targetSiteKeys) ||
    isSameSiteLowerOperationalTarget(scope, targetRoles, targetSiteKeys);
}

function requireTargetVisible(scope, targetRoles, targetSiteKeys) {
  if (scopeAllows(scope, targetRoles || [], targetSiteKeys || [])) return;
  const err = new Error(scope.kind === 'site_only_below'
    ? '사이트 매니저 및 사이트 매니저 OM/OP는 자기 사이트의 자기보다 낮은 OM/OP만 변경·차단·심사할 수 있습니다. 일반~커머스 공통회원은 조회 전용입니다.'
    : '상위 또는 동급 권한 회원에는 접근할 수 없습니다.');
  err.statusCode = 403;
  throw err;
}

function requireRoleAssignment(scope, requestedRole) {
  if (scope.kind === 'site_only_below') {
    if (canSiteManagerAssignRole(scope, requestedRole)) return;
    const err = new Error('사이트 매니저 및 사이트 매니저 OM/OP는 자기 사이트의 자기보다 낮은 OM/OP 역할만 부여할 수 있습니다.');
    err.statusCode = 403;
    throw err;
  }
  if (scopeAllows(scope, [requestedRole], roleSiteKeys(requestedRole))) return;
  const err = new Error('현재 권한으로 해당 롤을 부여할 수 없습니다.');
  err.statusCode = 403;
  throw err;
}

function requireManualRoleAssignment(role) {
  const normalized = normalizeRole(role);
  if (AUTO_MANAGED_ROLES.has(normalized)) {
    const err = new Error('guest, member, member_standard은 OSO/M2M 자동 역할입니다. 이 화면에서는 특수 역할만 예외 적용할 수 있습니다.');
    err.statusCode = 400;
    throw err;
  }
}

function forbidden(message) {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
}

function normalizeReason(value) {
  const reason = String(value || '').trim().replace(/\s+/g, ' ');
  if (!reason) {
    const err = new Error('처리 사유를 입력해야 합니다.');
    err.statusCode = 400;
    throw err;
  }
  return reason.slice(0, 500);
}

function metadataRole(metadata, key) {
  const value = metadata && metadata[key];
  if (Array.isArray(value)) return highestRole(value);
  return normalizeRole(value);
}

function os0SourceSnapshot(metadata, fallbackRoles) {
  const sourceKeys = [
    'igdc_os0_role',
    'os0_role',
    'oso_role',
    'm2m_role',
    'igdc_auto_role',
    'auto_role'
  ];
  for (const key of sourceKeys) {
    const role = metadataRole(metadata, key);
    if (role) {
      return {
        role,
        updated_at: String((metadata && (
          metadata[`${key}_updated_at`] ||
          metadata.os0_role_updated_at ||
          metadata.oso_role_updated_at ||
          metadata.m2m_role_updated_at ||
          metadata.igdc_auto_role_updated_at
        )) || ''),
        explicit: true
      };
    }
  }
  const role = metadataRole(metadata, 'igdc_role') || highestRole(metadata && metadata.roles) || highestRole(fallbackRoles || []);
  return {
    role: role || 'guest',
    updated_at: String((metadata && (metadata.os0_role_updated_at || metadata.oso_role_updated_at || metadata.m2m_role_updated_at || metadata.igdc_auto_role_updated_at)) || ''),
    explicit: false
  };
}

function readManualOverride(metadata) {
  const value = metadata && metadata.igdc_manual_role_override;
  if (!value || typeof value !== 'object' || value.active === false) return null;
  const role = normalizeRole(value.role);
  if (!role) return null;
  return {
    active: true,
    role,
    source_role: normalizeRole(value.source_role),
    source_updated_at: String(value.source_updated_at || ''),
    updated_at: String(value.updated_at || ''),
    updated_by: String(value.updated_by || ''),
    reason: String(value.reason || '')
  };
}

function readMembershipApproval(metadata) {
  const value = metadata && metadata.igdc_membership_approval;
  if (!value || typeof value !== 'object' || value.active === false || value.status !== 'approved') return null;
  const role = normalizeRole(value.role);
  if (!role) return null;
  return {
    active: true,
    role,
    approved_at: String(value.approved_at || value.updated_at || ''),
    approved_by: String(value.approved_by || ''),
    case_id: String(value.case_id || ''),
    source_role: normalizeRole(value.source_role),
    source_updated_at: String(value.source_updated_at || ''),
    review_note: String(value.review_note || '')
  };
}

function toMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function resolveRoleState(metadata, rawRoles) {
  const source = os0SourceSnapshot(metadata || {}, rawRoles || []);
  const approval = readMembershipApproval(metadata || {});
  const manual = readManualOverride(metadata || {});
  let effectiveRole = source.role || 'guest';
  let sourceKind = 'oso';
  let manualActive = false;
  let sourceChanged = false;

  // A formal membership review is distinct from an administrator exception.
  // It is retained as an approved role source until a later controlled action
  // replaces or clears it; OSO/M2M source information remains visible separately.
  if (approval) {
    effectiveRole = approval.role;
    sourceKind = 'member_review';
  }

  if (manual) {
    const manualBaseRole = approval ? approval.role : source.role;
    const manualBaseUpdatedAt = approval ? approval.approved_at : source.updated_at;
    const sourceRoleChanged = approval
      ? (!!manual.source_role && manualBaseRole && manualBaseRole !== manual.source_role)
      : (source.explicit
        ? (!!manual.source_role && !!source.role && source.role !== manual.source_role)
        : (!!source.role && source.role !== manual.role));
    const sourceTimeChanged = !!manualBaseUpdatedAt && !!manual.updated_at && toMs(manualBaseUpdatedAt) > toMs(manual.updated_at);
    sourceChanged = sourceRoleChanged || sourceTimeChanged;

    if (!sourceChanged) {
      effectiveRole = manual.role;
      sourceKind = 'member_admin';
      manualActive = true;
    }
  }

  return {
    source_role: source.role || (approval && approval.source_role) || (manual && manual.source_role) || 'guest',
    source_updated_at: source.updated_at || (approval && approval.source_updated_at) || (manual && manual.source_updated_at) || '',
    effective_role: effectiveRole,
    applied_source: sourceKind,
    membership_approval_active: !!approval,
    membership_approval_role: approval ? approval.role : '',
    membership_approved_at: approval ? approval.approved_at : '',
    membership_approved_by: approval ? approval.approved_by : '',
    membership_review_case_id: approval ? approval.case_id : '',
    manual_override_active: manualActive,
    manual_override_changed_by_source: !!manual && sourceChanged,
    manual_updated_at: manual ? manual.updated_at : '',
    manual_updated_by: manual ? manual.updated_by : ''
  };
}

function protectedAccount(env, user, roleState, rawRoles) {
  const metadata = (user && user.app_metadata) || {};
  if (env.protectedUserIds && env.protectedUserIds.has(user && user.user_id)) return true;
  if (metadata.igdc_protected_account === true || metadata.igdc_protected_account === 'true') return true;
  const roles = uniqueRoles([roleState && roleState.effective_role].concat(rawRoles || []).filter(Boolean));
  return roles.some(role => PROTECTED_ROLES.has(normalizeRole(role)));
}

function memberAudit(metadata, entry) {
  const previous = Array.isArray(metadata && metadata.igdc_member_role_audit) ? metadata.igdc_member_role_audit : [];
  const safeEntry = {
    at: new Date().toISOString(),
    action: String(entry.action || '').slice(0, 80),
    actor_id: String(entry.actor_id || '').slice(0, 300),
    role: normalizeRole(entry.role),
    source_role: normalizeRole(entry.source_role),
    reason: String(entry.reason || '').slice(0, 500)
  };
  return previous.concat([safeEntry]).slice(-ROLE_AUDIT_LIMIT);
}

function blockConfirmationPhrase(target) {
  return 'BLOCK ' + String(target.user_id || '');
}

function issueBlockChallenge(env, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', env.clientSecret).update(body).digest('base64url');
  return body + '.' + signature;
}

function verifyBlockChallenge(env, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw forbidden('차단 검토 확인이 올바르지 않습니다.');
  const expected = crypto.createHmac('sha256', env.clientSecret).update(parts[0]).digest('base64url');
  const actualBuffer = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw forbidden('차단 검토 확인이 올바르지 않습니다.');
  }
  try {
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (_) {
    throw forbidden('차단 검토 확인이 올바르지 않습니다.');
  }
}

function requireBlockTarget(scope, requester, target, env) {
  requireTargetVisible(scope, target.roles || [], target.site_keys || []);
  if (requester.sub === target.user_id) throw forbidden('자기 자신의 계정은 차단할 수 없습니다.');
  if (target.protected_account && scope.role !== 'owner') {
    throw forbidden('보호 owner/admin 계정은 owner만 이중 확인 절차로 조치할 수 있습니다.');
  }
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


const MEMBER_REQUEST_ROLE_MAP = Object.freeze({
  standard: 'member_standard',
  member_standard: 'member_standard',
  premium: 'member_premium',
  member_premium: 'member_premium',
  commerce: 'commerce_manager',
  commerce_manager: 'commerce_manager'
});

function diagnosticRoleAllowed(requester) {
  const role = highestRole(requester && requester.roles || []);
  return role === 'owner' || role === 'admin' || role === 'super_admin';
}

function requireMemberReviewDiagnosticAccess(requester) {
  if (diagnosticRoleAllowed(requester)) return;
  throw forbidden('회원 심사 Supabase 시스템 점검은 owner와 admin 계열만 실행할 수 있습니다.');
}

function describeSupabaseServiceKey(value) {
  const key = String(value || '').trim();
  if (!key) return { configured: false, kind: 'missing', role: null };
  if (key.indexOf('sb_secret_') === 0) return { configured: true, kind: 'secret', role: 'secret' };
  if (key.indexOf('sb_publishable_') === 0) return { configured: true, kind: 'publishable', role: 'anon' };
  const payload = safeJsonFromJwt(key);
  if (payload) return { configured: true, kind: 'legacy_jwt', role: String(payload.role || 'unknown') };
  return { configured: true, kind: 'unknown', role: null };
}

function safeJsonFromJwt(value) {
  try {
    const parts = String(value || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(b64urlToBuffer(parts[1]).toString('utf8'));
  } catch (_) { return null; }
}

function safeSupabaseHost(url) {
  try { return new URL(String(url || '')).host || null; }
  catch (_) { return null; }
}

function compactDiagnosticMessage(error) {
  return String(error && error.message || 'Supabase probe failed').replace(/\s+/g, ' ').slice(0, 500);
}

async function diagnosticProbe(name, task, success) {
  try {
    const value = await task();
    return Object.assign({ name, ok: true }, success ? success(value) : {});
  } catch (error) {
    return {
      name,
      ok: false,
      status_code: Number(error && error.statusCode) || 502,
      message: compactDiagnosticMessage(error)
    };
  }
}

function memberReviewDiagnosticSummary(report) {
  if (!report.database.url_configured || !report.database.key.configured) {
    return { code: 'config_missing', summary: 'SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 Netlify 환경변수에 등록되지 않았습니다.' };
  }
  const failed = (report.probes || []).filter(item => !item.ok);
  if (!failed.length) {
    return { code: 'ok', summary: '회원 심사 Supabase 연결, 심사 테이블, 사이트 소속 열, 비공개 파일 보관함을 읽기 전용으로 확인했습니다.' };
  }
  const allMessages = failed.map(item => String(item.message || '')).join(' ').toLowerCase();
  if (allMessages.indexOf('submitted_site_keys') >= 0 || allMessages.indexOf('does not exist') >= 0 || allMessages.indexOf('schema cache') >= 0 || allMessages.indexOf('could not find') >= 0) {
    return { code: 'schema_migration_required', summary: '회원 심사 테이블 또는 submitted_site_keys 열이 없습니다. 패키지의 supabase/member-review-schema-final.sql을 Supabase SQL Editor에서 실행해야 합니다.' };
  }
  if (allMessages.indexOf('permission denied') >= 0 || allMessages.indexOf('42501') >= 0) {
    return { code: 'service_role_grant_missing', summary: '서비스 역할의 회원 심사 테이블 또는 비공개 보관함 접근 권한이 부족합니다. 최종 스키마 SQL의 service_role 권한 구문을 실행했는지 확인하십시오.' };
  }
  if (allMessages.indexOf('invalid api key') >= 0 || allMessages.indexOf('jwt') >= 0 || failed.some(item => item.status_code === 401)) {
    return { code: 'key_invalid', summary: 'SUPABASE_SERVICE_ROLE_KEY가 SUPABASE_URL의 프로젝트 키와 일치하지 않거나 사용할 수 없습니다.' };
  }
  if (allMessages.indexOf('bucket') >= 0 || failed.some(item => item.name === 'private_review_bucket')) {
    return { code: 'private_bucket_missing', summary: '비공개 심사 보관함이 없거나 서버가 해당 버킷을 읽을 수 없습니다. 최종 스키마 SQL의 storage.buckets 구문을 확인하십시오.' };
  }
  return { code: 'connection_failed', summary: '회원 심사 Supabase 연결 또는 스키마 확인에 실패했습니다. JSON의 probes 항목을 기준으로 원인을 확인하십시오.' };
}

async function memberReviewDiagnostic(env, requester) {
  requireMemberReviewDiagnosticAccess(requester);
  const report = {
    report_type: 'igdc-member-review-supabase-diagnostic',
    checked_at: new Date().toISOString(),
    ok: false,
    read_only: true,
    access: { role: highestRole(requester.roles || []), owner_or_admin: true },
    database: {
      url_configured: !!env.supabaseUrl,
      host: safeSupabaseHost(env.supabaseUrl),
      key: describeSupabaseServiceKey(env.supabaseServiceRoleKey)
    },
    review_store: {
      cases_table: env.memberReviewTable,
      files_table: env.memberReviewFilesTable,
      events_table: env.memberReviewEventsTable,
      private_bucket: env.memberReviewBucket
    },
    probes: [],
    note: '읽기 전용 점검입니다. 회원 정보·제출 서류·첨부 파일·서명 URL·비밀키·시험 데이터는 반환하거나 생성하지 않습니다.'
  };
  if (!report.database.url_configured || !report.database.key.configured) {
    report.diagnosis = memberReviewDiagnosticSummary(report);
    return report;
  }
  report.probes.push(await diagnosticProbe('review_cases_table',
    () => supabaseSelect(env, env.memberReviewTable, { select: 'id', limit: 1 }),
    rows => ({ row_count_at_most_one: Array.isArray(rows) ? rows.length : 0 })
  ));
  report.probes.push(await diagnosticProbe('review_cases_site_scope_column',
    () => supabaseSelect(env, env.memberReviewTable, { select: 'id,submitted_site_keys', limit: 1 }),
    rows => ({ row_count_at_most_one: Array.isArray(rows) ? rows.length : 0, required_column: 'submitted_site_keys' })
  ));
  report.probes.push(await diagnosticProbe('review_files_table',
    () => supabaseSelect(env, env.memberReviewFilesTable, { select: 'id', limit: 1 }),
    rows => ({ row_count_at_most_one: Array.isArray(rows) ? rows.length : 0 })
  ));
  report.probes.push(await diagnosticProbe('review_events_table',
    () => supabaseSelect(env, env.memberReviewEventsTable, { select: 'id', limit: 1 }),
    rows => ({ row_count_at_most_one: Array.isArray(rows) ? rows.length : 0 })
  ));
  report.probes.push(await diagnosticProbe('private_review_bucket',
    () => supabaseStorageRequest(env, 'bucket/' + encodeURIComponent(env.memberReviewBucket), { method: 'GET', headers: { Accept: 'application/json' } }),
    () => ({ private_bucket: env.memberReviewBucket })
  ));
  report.diagnosis = memberReviewDiagnosticSummary(report);
  report.ok = report.diagnosis.code === 'ok';
  return report;
}

function optionalPositiveInt(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function requireSupabase(env) {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    const err = new Error('회원 심사 저장소를 사용하려면 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 Netlify 환경변수에 등록되어 있어야 합니다.');
    err.statusCode = 503;
    throw err;
  }
}

function normalizeOptionalText(value, maxLength) {
  return String(value == null ? '' : value).trim().replace(/\r\n/g, '\n').slice(0, maxLength || 4000);
}

function normalizeRequestedRole(value, requiredRole) {
  const normalized = normalizeRole(value);
  const role = MEMBER_REQUEST_ROLE_MAP[normalized] || '';
  if (requiredRole && !role) {
    const err = new Error('지원하지 않는 승급 신청 등급입니다.');
    err.statusCode = 400;
    throw err;
  }
  return role;
}

function safeAttachmentName(value) {
  const name = String(value || '').replace(/[\\/\0-\x1f<>:"|?*]+/g, '_').trim().replace(/^\.+/, '');
  if (!name) {
    const err = new Error('첨부 파일 이름이 올바르지 않습니다.');
    err.statusCode = 400;
    throw err;
  }
  return name.slice(0, 180);
}

function normalizeAttachmentList(env, value) {
  const raw = Array.isArray(value) ? value : [];
  if (env.memberReviewMaxFiles && raw.length > env.memberReviewMaxFiles) {
    const err = new Error('첨부 파일 수가 운영 설정 한도를 초과했습니다.');
    err.statusCode = 400;
    throw err;
  }
  return raw.map((item, index) => {
    const file = item && typeof item === 'object' ? item : {};
    const name = safeAttachmentName(file.name || file.original_name || `attachment-${index + 1}`);
    const size = Number(file.size == null ? file.size_bytes : file.size);
    if (!Number.isFinite(size) || size < 0) {
      const err = new Error('첨부 파일 크기 정보가 올바르지 않습니다.');
      err.statusCode = 400;
      throw err;
    }
    if (env.memberReviewMaxUploadBytes && size > env.memberReviewMaxUploadBytes) {
      const err = new Error('첨부 파일 크기가 운영 설정 한도를 초과했습니다.');
      err.statusCode = 400;
      throw err;
    }
    const mimeType = String(file.type || file.mime_type || 'application/octet-stream').trim().toLowerCase().slice(0, 200);
    if (env.memberReviewAllowedMimeTypes.size && !env.memberReviewAllowedMimeTypes.has(mimeType)) {
      const err = new Error('허용되지 않은 첨부 파일 형식입니다.');
      err.statusCode = 400;
      throw err;
    }
    return { original_name: name, size_bytes: Math.floor(size), mime_type: mimeType || 'application/octet-stream' };
  });
}

function encodeStoragePath(value) {
  return String(value || '').split('/').map(part => encodeURIComponent(part)).join('/');
}

function supabaseHeaders(env, extra) {
  return Object.assign({
    apikey: env.supabaseServiceRoleKey,
    Authorization: 'Bearer ' + env.supabaseServiceRoleKey
  }, extra || {});
}

async function supabaseRequest(env, path, options) {
  requireSupabase(env);
  const opts = options || {};
  const headers = supabaseHeaders(env, opts.headers);
  const response = await fetch(env.supabaseUrl + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    const message = (data && (data.message || data.error || data.hint || data.details)) || text || `Supabase ${opts.method || 'GET'} ${path} failed`;
    throw Object.assign(new Error(String(message)), { statusCode: response.status === 401 || response.status === 403 ? 503 : response.status });
  }
  return { data, headers: response.headers };
}

function queryString(params) {
  const pairs = [];
  Object.keys(params || {}).forEach(key => {
    const value = params[key];
    if (value === undefined || value === null || value === '') return;
    pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  return pairs.length ? '?' + pairs.join('&') : '';
}

async function supabaseSelect(env, table, params) {
  const result = await supabaseRequest(env, '/rest/v1/' + encodeURIComponent(table) + queryString(params), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  return Array.isArray(result.data) ? result.data : [];
}

async function supabaseInsert(env, table, row) {
  const result = await supabaseRequest(env, '/rest/v1/' + encodeURIComponent(table), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: row
  });
  return Array.isArray(result.data) ? result.data : [];
}

async function supabasePatch(env, table, filters, patch) {
  const result = await supabaseRequest(env, '/rest/v1/' + encodeURIComponent(table) + queryString(filters), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: patch
  });
  return Array.isArray(result.data) ? result.data : [];
}

async function supabaseStorageRequest(env, path, options) {
  return supabaseRequest(env, '/storage/v1/' + path, options);
}

async function logReviewEvent(env, reviewCaseId, eventType, actor, detail) {
  try {
    await supabaseInsert(env, env.memberReviewEventsTable, {
      review_case_id: reviewCaseId,
      event_type: String(eventType || '').slice(0, 80),
      actor_id: actor && actor.sub ? actor.sub : null,
      actor_email: actor && actor.email ? actor.email : null,
      detail: detail || {}
    });
  } catch (_) {
    // The case and file records remain authoritative if audit insertion is temporarily unavailable.
  }
}

function reviewCasePayload(requester, values) {
  return {
    user_id: requester.sub,
    user_email: normalizeOptionalText(requester.email, 320),
    user_name: normalizeOptionalText(requester.name, 320),
    submitted_role: normalizeRole(requester.role || highestRole(requester.roles || [])) || 'guest',
    submitted_role_level: roleLevel(requester.role || highestRole(requester.roles || [])),
    submitted_site_keys: uniqueSiteKeys(requester.site_keys || []),
    request_kind: values.request_kind,
    requested_role: values.requested_role || null,
    title: values.title,
    body: values.body,
    status: values.status,
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function findPendingUpgrade(env, requester, requestedRole) {
  const rows = await supabaseSelect(env, env.memberReviewTable, {
    select: '*',
    user_id: 'eq.' + requester.sub,
    requested_role: 'eq.' + requestedRole,
    status: 'in.(pending,uploading)',
    order: 'submitted_at.desc',
    limit: 1
  });
  return rows[0] || null;
}

async function createUpgradeRequest(env, requester, body) {
  const requestedRole = normalizeRequestedRole(required(body.role, 'role'), true);
  const existing = await findPendingUpgrade(env, requester, requestedRole);
  if (existing) return Object.assign(publicReviewCase(existing, []), { already_pending: true });
  const label = requestedRole === 'member_standard' ? 'Standard membership application'
    : requestedRole === 'member_premium' ? 'Premium membership application'
      : 'Commerce membership application';
  const rows = await supabaseInsert(env, env.memberReviewTable, reviewCasePayload(requester, {
    request_kind: 'upgrade',
    requested_role: requestedRole,
    title: label,
    body: normalizeOptionalText(body.body, 12000),
    status: 'pending'
  }));
  const reviewCase = rows[0];
  if (!reviewCase) throw Object.assign(new Error('승급 신청 저장 결과를 확인할 수 없습니다.'), { statusCode: 502 });
  await logReviewEvent(env, reviewCase.id, 'upgrade_requested', requester, { requested_role: requestedRole });
  return publicReviewCase(reviewCase, []);
}

async function createReviewDocument(env, requester, body) {
  const title = normalizeOptionalText(body.title, 500);
  const text = normalizeOptionalText(body.body, 12000);
  const requestedRole = normalizeRequestedRole(body.requested_role || body.role, false);
  const attachments = normalizeAttachmentList(env, body.attachments);
  if (!title || !text) {
    const err = new Error('제목과 내용을 입력해야 합니다.');
    err.statusCode = 400;
    throw err;
  }
  const rows = await supabaseInsert(env, env.memberReviewTable, reviewCasePayload(requester, {
    request_kind: requestedRole ? 'upgrade' : 'document',
    requested_role: requestedRole,
    title,
    body: text,
    status: attachments.length ? 'uploading' : 'pending'
  }));
  const reviewCase = rows[0];
  if (!reviewCase) throw Object.assign(new Error('제출 자료 저장 결과를 확인할 수 없습니다.'), { statusCode: 502 });

  const fileRows = [];
  for (const attachment of attachments) {
    const storagePath = 'review-cases/' + reviewCase.id + '/' + crypto.randomUUID() + '-' + attachment.original_name;
    const inserted = await supabaseInsert(env, env.memberReviewFilesTable, {
      review_case_id: reviewCase.id,
      storage_bucket: env.memberReviewBucket,
      storage_path: storagePath,
      original_name: attachment.original_name,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      upload_status: 'pending_upload',
      uploaded_by: requester.sub,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    if (!inserted[0]) throw Object.assign(new Error('첨부 자료 저장 정보를 만들 수 없습니다.'), { statusCode: 502 });
    fileRows.push(inserted[0]);
  }

  const uploads = [];
  for (const file of fileRows) {
    const signed = await supabaseStorageRequest(env, 'object/upload/sign/' + encodeURIComponent(file.storage_bucket) + '/' + encodeStoragePath(file.storage_path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {}
    });
    const signedPath = signed.data && (signed.data.signedURL || signed.data.signedUrl || signed.data.url);
    if (!signedPath) throw Object.assign(new Error('첨부 파일 업로드 주소를 만들 수 없습니다.'), { statusCode: 502 });
    uploads.push({
      file_id: file.id,
      original_name: file.original_name,
      url: /^https?:\/\//i.test(signedPath) ? signedPath : env.supabaseUrl + '/storage/v1' + (String(signedPath).startsWith('/') ? signedPath : '/' + signedPath)
    });
  }
  await logReviewEvent(env, reviewCase.id, 'document_submitted', requester, { requested_role: requestedRole || null, attachment_count: uploads.length });
  return { document: publicReviewCase(reviewCase, fileRows), uploads };
}

async function completeReviewDocumentUpload(env, requester, body) {
  const id = required(body.id || body.document_id, 'id');
  const cases = await supabaseSelect(env, env.memberReviewTable, { select: '*', id: 'eq.' + id, limit: 1 });
  const reviewCase = cases[0];
  if (!reviewCase) throw Object.assign(new Error('제출 자료를 찾을 수 없습니다.'), { statusCode: 404 });
  if (reviewCase.user_id !== requester.sub) throw forbidden('본인이 제출한 자료만 업로드 완료 처리할 수 있습니다.');
  if (reviewCase.status !== 'uploading' && reviewCase.status !== 'pending') throw Object.assign(new Error('현재 상태에서는 업로드 완료 처리를 할 수 없습니다.'), { statusCode: 409 });
  const files = await supabaseSelect(env, env.memberReviewFilesTable, { select: '*', review_case_id: 'eq.' + id, order: 'created_at.asc' });
  const requestedIds = new Set((Array.isArray(body.file_ids) ? body.file_ids : []).map(value => String(value)));
  const targets = requestedIds.size ? files.filter(file => requestedIds.has(String(file.id))) : files;
  if (targets.length !== files.length) throw Object.assign(new Error('업로드 완료 대상이 제출 자료와 일치하지 않습니다.'), { statusCode: 400 });
  for (const file of targets) {
    await supabasePatch(env, env.memberReviewFilesTable, { id: 'eq.' + file.id }, {
      upload_status: 'uploaded', uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
  }
  const updated = await supabasePatch(env, env.memberReviewTable, { id: 'eq.' + id }, { status: 'pending', updated_at: new Date().toISOString() });
  const current = updated[0] || Object.assign({}, reviewCase, { status: 'pending' });
  await logReviewEvent(env, id, 'attachments_uploaded', requester, { file_count: files.length });
  const refreshedFiles = await supabaseSelect(env, env.memberReviewFilesTable, { select: '*', review_case_id: 'eq.' + id, order: 'created_at.asc' });
  return publicReviewCase(current, refreshedFiles);
}

function noReviewRowsFilter() {
  return { id: 'eq.00000000-0000-0000-0000-000000000000' };
}

function postgrestArrayLiteral(values) {
  const keys = uniqueSiteKeys(values || []);
  if (!keys.length) return '';
  return '{' + keys.map(key => '"' + key.replace(/"/g, '') + '"').join(',') + '}';
}

function reviewScopeFilters(scope) {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'all_except_owner') return { submitted_role: 'neq.owner' };
  if (scope.kind === 'below_only') return { submitted_role_level: 'lt.' + String(scope.level || 0) };
  if (scope.kind === 'site_only_below') {
    const sites = postgrestArrayLiteral(scope.siteKeys || []);
    const allowedRoles = uniqueSiteKeys(scope.siteKeys || []).flatMap(site => {
      const roles = [];
      const om = 'site_manager_' + site + '_om';
      const op = 'site_manager_' + site + '_op';
      if (canSiteManagerAssignRole(scope, om)) roles.push(om);
      if (canSiteManagerAssignRole(scope, op)) roles.push(op);
      return roles;
    });
    if (!sites || !allowedRoles.length) return noReviewRowsFilter();
    return {
      submitted_role: 'in.(' + allowedRoles.join(',') + ')',
      submitted_role_level: 'lt.' + String(scope.level || 0),
      submitted_site_keys: 'ov.' + sites
    };
  }
  return noReviewRowsFilter();
}

function reviewCaseSiteKeys(reviewCase) {
  return uniqueSiteKeys(reviewCase && reviewCase.submitted_site_keys);
}

function reviewCaseAllowed(scope, reviewCase) {
  return scopeAllows(
    scope,
    [normalizeRole(reviewCase && reviewCase.submitted_role) || 'guest'],
    reviewCaseSiteKeys(reviewCase)
  );
}

async function listOwnReviewDocuments(env, requester, query) {
  const page = clampInt(query.page, 0, 1000000);
  const perPage = clampInt(query.per_page || query.perPage, 1, 100);
  const cases = await supabaseSelect(env, env.memberReviewTable, {
    select: '*', user_id: 'eq.' + requester.sub, order: 'submitted_at.desc', limit: perPage, offset: page * perPage
  });
  const ids = cases.map(row => row.id).filter(Boolean);
  const files = ids.length ? await supabaseSelect(env, env.memberReviewFilesTable, {
    select: '*', review_case_id: 'in.(' + ids.join(',') + ')', order: 'created_at.asc'
  }) : [];
  const fileMap = new Map();
  files.forEach(file => {
    const list = fileMap.get(file.review_case_id) || [];
    list.push(file);
    fileMap.set(file.review_case_id, list);
  });
  return {
    documents: cases.map(row => publicReviewCase(row, fileMap.get(row.id) || [])),
    page,
    per_page: perPage,
    has_more: cases.length === perPage,
    scope: { kind: 'self_only', role: highestRole(requester.roles || []) }
  };
}

async function listReviewDocuments(env, requester, query) {
  const scope = managementScope(requester);
  const page = clampInt(query.page, 0, 1000000);
  const perPage = clampInt(query.per_page || query.perPage, 1, 100);
  const params = Object.assign({ select: '*', order: 'submitted_at.desc', limit: perPage, offset: page * perPage }, reviewScopeFilters(scope));
  const cases = (await supabaseSelect(env, env.memberReviewTable, params)).filter(row => reviewCaseAllowed(scope, row));
  const ids = cases.map(row => row.id).filter(Boolean);
  const files = ids.length ? await supabaseSelect(env, env.memberReviewFilesTable, {
    select: '*', review_case_id: 'in.(' + ids.join(',') + ')', order: 'created_at.asc'
  }) : [];
  const fileMap = new Map();
  files.forEach(file => {
    const list = fileMap.get(file.review_case_id) || [];
    list.push(file);
    fileMap.set(file.review_case_id, list);
  });
  const documents = cases.map(row => publicReviewCase(row, fileMap.get(row.id) || []));
  return { documents, page, per_page: perPage, has_more: cases.length === perPage, scope: publicScope(scope) };
}

function publicReviewFile(file) {
  return {
    id: file.id,
    original_name: file.original_name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    upload_status: file.upload_status,
    uploaded_at: file.uploaded_at || null
  };
}

function publicReviewCase(reviewCase, files) {
  return {
    id: reviewCase.id,
    document_id: reviewCase.id,
    user_id: reviewCase.user_id,
    email: reviewCase.user_email,
    user_email: reviewCase.user_email,
    name: reviewCase.user_name,
    user_name: reviewCase.user_name,
    roles: [reviewCase.submitted_role || 'guest'],
    user_roles: [reviewCase.submitted_role || 'guest'],
    submitted_role: reviewCase.submitted_role || 'guest',
    submitted_site_keys: uniqueSiteKeys(reviewCase.submitted_site_keys || []),
    request_kind: reviewCase.request_kind,
    requested_role: reviewCase.requested_role || '',
    target_role: reviewCase.requested_role || '',
    title: reviewCase.title,
    body: reviewCase.body,
    status: reviewCase.status,
    review_note: reviewCase.review_note || '',
    submitted_at: reviewCase.submitted_at || reviewCase.created_at,
    created_at: reviewCase.submitted_at || reviewCase.created_at,
    updated_at: reviewCase.updated_at || reviewCase.submitted_at || reviewCase.created_at,
    reviewed_at: reviewCase.reviewed_at || null,
    attachments: (files || []).map(publicReviewFile)
  };
}

async function getReviewCase(env, id) {
  const rows = await supabaseSelect(env, env.memberReviewTable, { select: '*', id: 'eq.' + id, limit: 1 });
  if (!rows[0]) throw Object.assign(new Error('제출 자료를 찾을 수 없습니다.'), { statusCode: 404 });
  return rows[0];
}

async function authorizeReviewCase(env, requester, reviewCase) {
  const scope = managementScope(requester);
  if (!reviewCaseAllowed(scope, reviewCase)) {
    throw forbidden(scope.kind === 'site_only_below'
      ? '사이트 매니저 및 사이트 매니저 OM/OP는 자기 사이트의 자기보다 낮은 OM/OP 신청 자료만 열람할 수 있습니다.'
      : '현재 권한으로는 이 신청 자료를 열람할 수 없습니다.');
  }
  const target = await getPublicUserWithRoles(env, reviewCase.user_id);
  requireTargetVisible(scope, target.roles || [], target.site_keys || []);
  return { scope, target };
}

async function createReviewDocumentDownloadUrl(env, requester, query) {
  const id = required(query.id || query.document_id, 'id');
  const reviewCase = await getReviewCase(env, id);
  if (reviewCase.user_id !== requester.sub) await authorizeReviewCase(env, requester, reviewCase);
  const files = await supabaseSelect(env, env.memberReviewFilesTable, { select: '*', review_case_id: 'eq.' + id, order: 'created_at.asc' });
  const fileId = String(query.file_id || '');
  const file = fileId ? files.find(item => String(item.id) === fileId) : files.find(item => item.upload_status === 'uploaded');
  if (!file || file.upload_status !== 'uploaded') throw Object.assign(new Error('열람 가능한 첨부 파일이 없습니다.'), { statusCode: 404 });
  const signed = await supabaseStorageRequest(env, 'object/sign/' + encodeURIComponent(file.storage_bucket) + '/' + encodeStoragePath(file.storage_path), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { expiresIn: 300 }
  });
  const signedPath = signed.data && (signed.data.signedURL || signed.data.signedUrl || signed.data.url);
  if (!signedPath) throw Object.assign(new Error('첨부 파일 열람 주소를 만들 수 없습니다.'), { statusCode: 502 });
  await logReviewEvent(env, id, 'attachment_opened', requester, { file_id: file.id });
  return {
    file_id: file.id,
    original_name: file.original_name,
    url: /^https?:\/\//i.test(signedPath) ? signedPath : env.supabaseUrl + '/storage/v1' + (String(signedPath).startsWith('/') ? signedPath : '/' + signedPath)
  };
}

async function applyFormalMembershipApproval(env, reviewCase, reviewer, reviewNote) {
  const requestedRole = normalizeRole(reviewCase.requested_role);
  if (!requestedRole) return;
  const user = await auth0Get(env, '/api/v2/users/' + encodeURIComponent(reviewCase.user_id));
  const metadata = user.app_metadata || {};
  const rawRoles = await auth0UserRoles(env, user);
  const current = resolveRoleState(metadata, rawRoles);
  const now = new Date().toISOString();
  const approval = {
    active: true,
    status: 'approved',
    role: requestedRole,
    case_id: reviewCase.id,
    approved_at: now,
    approved_by: reviewer.sub,
    reviewer_email: reviewer.email || '',
    source_role: current.source_role,
    source_updated_at: current.source_updated_at || '',
    review_note: reviewNote || ''
  };
  await auth0Patch(env, '/api/v2/users/' + encodeURIComponent(reviewCase.user_id), {
    app_metadata: {
      roles: [requestedRole],
      igdc_role: requestedRole,
      igdc_membership_approval: approval,
      role_updated_by: reviewer.sub,
      role_updated_at: now,
      role_source: 'member_review',
      igdc_member_role_audit: memberAudit(metadata, {
        action: 'formal_membership_approval',
        actor_id: reviewer.sub,
        role: requestedRole,
        source_role: current.source_role,
        reason: reviewNote || 'membership review approved'
      })
    }
  });
  await replaceManagedAuth0Role(env, reviewCase.user_id, requestedRole);
}

async function reviewMemberDocument(env, requester, body) {
  const id = required(body.id || body.document_id, 'id');
  const decision = normalizeRole(required(body.decision, 'decision'));
  if (decision !== 'approve' && decision !== 'reject') {
    const err = new Error('승인 또는 반려 결정이 필요합니다.');
    err.statusCode = 400;
    throw err;
  }
  const reviewCase = await getReviewCase(env, id);
  const { scope } = await authorizeReviewCase(env, requester, reviewCase);
  if (reviewCase.status !== 'pending') {
    const err = new Error('대기 중인 제출 자료만 처리할 수 있습니다.');
    err.statusCode = 409;
    throw err;
  }
  const reviewNote = normalizeOptionalText(body.review_note || body.note, 2000);
  const requestedRole = normalizeRole(reviewCase.requested_role);
  if (decision === 'approve' && requestedRole) {
    requireRoleAssignment(scope, requestedRole);
    await applyFormalMembershipApproval(env, reviewCase, requester, reviewNote);
  }
  const now = new Date().toISOString();
  const updated = await supabasePatch(env, env.memberReviewTable, { id: 'eq.' + id }, {
    status: decision === 'approve' ? 'approved' : 'rejected',
    review_note: reviewNote || null,
    reviewed_at: now,
    reviewed_by: requester.sub,
    reviewed_by_email: requester.email || null,
    reviewed_role: scope.role,
    approved_role: decision === 'approve' ? (requestedRole || null) : null,
    updated_at: now
  });
  const current = updated[0] || Object.assign({}, reviewCase, { status: decision === 'approve' ? 'approved' : 'rejected' });
  await logReviewEvent(env, id, decision === 'approve' ? 'approved' : 'rejected', requester, {
    requested_role: requestedRole || null,
    review_note: reviewNote || null
  });
  const files = await supabaseSelect(env, env.memberReviewFilesTable, { select: '*', review_case_id: 'eq.' + id, order: 'created_at.asc' });
  return publicReviewCase(current, files);
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
  const siteKeys = await requesterSiteKeys(env, payload.sub, roles);
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.nickname || payload.email,
    roles,
    role: highestRole(roles),
    site_keys: siteKeys
  };
}

async function requesterSiteKeys(env, userId, roles) {
  try {
    const user = await auth0Get(env, '/api/v2/users/' + encodeURIComponent(userId));
    const serverRoles = await auth0UserRoles(env, user);
    return siteKeysFromMetadata((user && user.app_metadata) || {}, uniqueRoles((roles || []).concat(serverRoles || [])));
  } catch (_) {
    return siteKeysFromMetadata({}, roles || []);
  }
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
    site_keys: uniqueSiteKeys(user.site_keys || []),
    admin: safeManagementScope(user).kind !== 'self_only',
    manager: safeManagementScope(user).kind !== 'self_only',
    management_scope: safeManagementScope(user)
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
  const rawRoles = await auth0UserRoles(env, user);
  const roleState = resolveRoleState(metadata, rawRoles);
  const override = readManualOverride(metadata);
  const rolesWithoutSupersededManual = (roleState.manual_override_changed_by_source && override)
    ? rawRoles.filter(role => normalizeRole(role) !== override.role)
    : rawRoles;
  const effectiveRoles = uniqueRoles([roleState.effective_role].concat(rolesWithoutSupersededManual));
  const protectedFlag = protectedAccount(env, user, roleState, effectiveRoles);
  return {
    user_id: user.user_id,
    email: user.email,
    name: user.name || user.nickname || '',
    nickname: user.nickname || '',
    picture: user.picture || '',
    blocked: !!user.blocked,
    created_at: user.created_at,
    last_login: user.last_login,
    roles: effectiveRoles,
    source_roles: uniqueRoles(rawRoles),
    role: highestRole(effectiveRoles),
    role_state: Object.assign({}, roleState, {
      protected_account: protectedFlag
    }),
    protected_account: protectedFlag,
    site_keys: siteKeysFromMetadata(metadata, effectiveRoles)
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

async function replaceManagedAuth0Role(env, userId, role) {
  const roleId = env.roleIdMap && env.roleIdMap[role];
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

async function updateUserRole(env, userId, role, requester, reason) {
  const user = await auth0Get(env, `/api/v2/users/${encodeURIComponent(userId)}`);
  const metadata = user.app_metadata || {};
  const rawRoles = await auth0UserRoles(env, user);
  const current = resolveRoleState(metadata, rawRoles);
  const now = new Date().toISOString();
  const normalizedReason = normalizeReason(reason);
  const manualOverride = {
    active: true,
    role,
    source_role: current.source_role,
    source_updated_at: current.source_updated_at || '',
    updated_at: now,
    updated_by: requester.sub,
    reason: normalizedReason
  };

  await auth0Patch(env, `/api/v2/users/${encodeURIComponent(userId)}`, {
    app_metadata: {
      roles: [role],
      igdc_role: role,
      igdc_manual_role_override: manualOverride,
      role_updated_by: requester.sub,
      role_updated_at: now,
      role_source: 'member_admin',
      igdc_member_role_audit: memberAudit(metadata, {
        action: 'manual_role_override',
        actor_id: requester.sub,
        role,
        source_role: current.source_role,
        reason: normalizedReason
      })
    }
  });

  await replaceManagedAuth0Role(env, userId, role);
}

async function clearRoleOverride(env, userId, requester, reason) {
  const user = await auth0Get(env, `/api/v2/users/${encodeURIComponent(userId)}`);
  const metadata = user.app_metadata || {};
  const rawRoles = await auth0UserRoles(env, user);
  const current = resolveRoleState(metadata, rawRoles);
  const existing = readManualOverride(metadata);
  if (!existing) {
    const err = new Error('해제할 관리자 예외 역할이 없습니다.');
    err.statusCode = 400;
    throw err;
  }
  const approved = readMembershipApproval(metadata);
  const sourceRole = normalizeRole((approved && approved.role) || current.source_role || existing.source_role || 'member');
  const now = new Date().toISOString();
  const normalizedReason = normalizeReason(reason);

  await auth0Patch(env, `/api/v2/users/${encodeURIComponent(userId)}`, {
    app_metadata: {
      roles: [sourceRole],
      igdc_role: sourceRole,
      igdc_manual_role_override: Object.assign({}, existing, {
        active: false,
        cleared_at: now,
        cleared_by: requester.sub,
        clear_reason: normalizedReason
      }),
      role_updated_by: requester.sub,
      role_updated_at: now,
      role_source: 'oso_restore',
      igdc_member_role_audit: memberAudit(metadata, {
        action: 'clear_manual_override',
        actor_id: requester.sub,
        role: sourceRole,
        source_role: sourceRole,
        reason: normalizedReason
      })
    }
  });

  await replaceManagedAuth0Role(env, userId, sourceRole);
}

async function setUserBlocked(env, target, requester, blocked, reason) {
  const user = await auth0Get(env, `/api/v2/users/${encodeURIComponent(target.user_id)}`);
  const metadata = user.app_metadata || {};
  const now = new Date().toISOString();
  const normalizedReason = normalizeReason(reason);

  await auth0Patch(env, `/api/v2/users/${encodeURIComponent(target.user_id)}`, {
    blocked,
    app_metadata: {
      igdc_status: blocked ? 'blocked' : 'active',
      [blocked ? 'blocked_by' : 'unblocked_by']: requester.sub,
      [blocked ? 'blocked_at' : 'unblocked_at']: now,
      [blocked ? 'block_reason' : 'unblock_reason']: normalizedReason,
      igdc_member_role_audit: memberAudit(metadata, {
        action: blocked ? 'block_user' : 'unblock_user',
        actor_id: requester.sub,
        role: target.role,
        source_role: target.role_state && target.role_state.source_role,
        reason: normalizedReason
      })
    }
  });
}
