'use strict';

const { resolveUser, capability, requireCapability } = require('./lib/global-slot-console-auth');
const sb = require('./lib/global-slot-console-supabase');
const media = require('./lib/global-slot-console-media');
const ReleaseDispatch = require('./lib/commerce-release-dispatch.v1');

const HUBS = new Set(['home','distribution','network','media','social','tour','donation','literature_academic']);
const STATES = new Set(['discovered','verified_candidate','revenue_ready','approval_pending','enrollable','hold','suppressed','retired','information_only']);
const ASSIGNMENT_STATES = new Set(['draft','recommended','approved','pinned','hold','suppressed','retired']);
const PUBLICATION_STATES = new Set(['not_ready','ready','published','failed']);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': process.env.URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
    },
    body: statusCode === 204 ? '' : JSON.stringify(body)
  };
}
function parseBody(event) {
  if (!event || !event.body) return {};
  try { return JSON.parse(event.body); } catch (_) { const e = new Error('JSON 요청 형식이 올바르지 않습니다.'); e.statusCode = 400; throw e; }
}
function clean(value, max) { const text = String(value == null ? '' : value).trim(); return max ? text.slice(0, max) : text; }
function iso() { return new Date().toISOString(); }
function inSet(value, set, fallback) { const v = clean(value).toLowerCase(); return set.has(v) ? v : fallback; }
function bool(value) { return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'; }
function safeUrl(value) { try { const u = new URL(clean(value)); return u.protocol === 'https:' ? u.toString() : ''; } catch (_) { return ''; } }
function auditPayload(input) { try { return JSON.stringify(input || {}).slice(0, 12000); } catch (_) { return '{}'; } }

async function audit(actor, action, entityType, entityId, detail) {
  try {
    await sb.insert('gslot_audit_log', {
      id: sb.id('audit'), actor_id: actor && actor.sub || null, actor_role: actor && actor.role || 'system',
      action: clean(action, 80), entity_type: clean(entityType, 80), entity_id: clean(entityId, 180) || null,
      detail: detail || {}, created_at: iso()
    }, 'return=minimal');
  } catch (_) {
    // Audit failures are surfaced by operational health but must not corrupt a completed DB mutation.
  }
}

async function ensureBaseHubs(actor) {
  const existing = await sb.select('gslot_hubs', 'select=hub_key');
  const set = new Set((existing || []).map(row => row.hub_key));
  const rows = [];
  for (const hub of HUBS) {
    if (!set.has(hub)) rows.push({ hub_key: hub, label: hubLabel(hub), enabled: true, created_at: iso(), updated_at: iso() });
  }
  if (rows.length) {
    await sb.insert('gslot_hubs', rows, 'return=minimal');
    await audit(actor, 'seed_hubs', 'hub', null, { added: rows.map(row => row.hub_key) });
  }
}
function hubLabel(key) {
  return ({ home:'홈', distribution:'유통', network:'네트워크', media:'미디어', social:'소셜', tour:'여행·관광', donation:'후원', literature_academic:'문학·학술' })[key] || key;
}

function session(actor) {
  // The handler has already verified the existing admin login and its server-side role.
  // Do not touch the management database here: DB availability must never look like a login failure.
  const caps = capability(actor);
  if (!caps.read) { const e = new Error('글로벌 슬롯 관리 콘솔은 admin 이상 권한에서 열립니다.'); e.statusCode = 403; throw e; }
  return { ok: true, user: { id: actor.sub, email: actor.email, name: actor.name, role: actor.role, roles: actor.roles }, capabilities: caps };
}

async function listHubs(actor) {
  await ensureBaseHubs(actor);
  const rows = await sb.select('gslot_hubs', 'select=hub_key,label,enabled,updated_at&order=hub_key.asc');
  return { ok: true, rows: rows || [] };
}
async function listCountries() {
  const rows = await sb.select('gslot_countries', 'select=code,name,region_code,enabled,legal_source_id,updated_at&order=code.asc&limit=1000');
  return { ok: true, rows: rows || [] };
}
async function listRegions() {
  const rows = await sb.select('gslot_regions', 'select=code,name,enabled,updated_at&order=code.asc&limit=200');
  return { ok: true, rows: rows || [] };
}

async function upsertRegion(actor, body) {
  requireCapability(actor, 'policy');
  const code = clean(body.code, 32).toUpperCase();
  const name = clean(body.name, 120);
  if (!code || !name) { const e = new Error('권역 코드와 이름이 필요합니다.'); e.statusCode = 400; throw e; }
  const row = { code, name, enabled: body.enabled !== false, updated_at: iso() };
  await sb.insert('gslot_regions', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'upsert_region', 'region', code, row);
  return { ok: true, row };
}
async function upsertCountry(actor, body) {
  requireCapability(actor, 'policy');
  const code = clean(body.code, 3).toUpperCase();
  const name = clean(body.name, 120);
  const regionCode = clean(body.regionCode, 32).toUpperCase() || null;
  const legalSourceId = clean(body.legalSourceId, 180);
  if (!/^[A-Z]{2,3}$/.test(code) || !name || !legalSourceId) { const e = new Error('국가 코드·이름·합법 데이터원 근거가 필요합니다.'); e.statusCode = 400; throw e; }
  const row = { code, name, region_code: regionCode, legal_source_id: legalSourceId, enabled: body.enabled !== false, updated_at: iso() };
  await sb.insert('gslot_countries', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'upsert_country', 'country', code, row);
  return { ok: true, row };
}

async function listCandidates(event, actor) {
  const q = event.queryStringParameters || {};
  const filters = ['select=id,kind,title,official_url,status,source_ref,created_at,updated_at,owner_note,thumbnail_url'];
  if (q.status) filters.push('status=eq.' + encodeURIComponent(clean(q.status, 40)));
  if (q.kind) filters.push('kind=eq.' + encodeURIComponent(clean(q.kind, 60)));
  if (q.search) filters.push('title=ilike.*' + encodeURIComponent(clean(q.search, 100)) + '*');
  filters.push('order=updated_at.desc', 'limit=' + Math.max(1, Math.min(300, Number(q.limit) || 100)));
  const rows = await sb.select('gslot_candidates', filters.join('&'));
  return { ok: true, rows: rows || [] };
}
async function candidateDetail(id) {
  const candidateId = clean(id, 180);
  if (!candidateId) { const e = new Error('후보 ID가 필요합니다.'); e.statusCode = 400; throw e; }
  const [candidates, evidence, availability, revenue, assignments] = await Promise.all([
    sb.select('gslot_candidates', 'select=*&id=eq.' + encodeURIComponent(candidateId) + '&limit=1'),
    sb.select('gslot_candidate_evidence', 'select=*&candidate_id=eq.' + encodeURIComponent(candidateId) + '&order=created_at.desc'),
    sb.select('gslot_candidate_availability', 'select=*&candidate_id=eq.' + encodeURIComponent(candidateId) + '&order=country_code.asc'),
    sb.select('gslot_candidate_revenue', 'select=*&candidate_id=eq.' + encodeURIComponent(candidateId) + '&order=updated_at.desc'),
    sb.select('gslot_slot_assignments', 'select=*&candidate_id=eq.' + encodeURIComponent(candidateId) + '&order=updated_at.desc')
  ]);
  return { ok: true, candidate: (candidates || [])[0] || null, evidence: evidence || [], availability: availability || [], revenue: revenue || [], assignments: assignments || [] };
}
async function saveCandidate(actor, body) {
  requireCapability(actor, 'edit');
  const id = clean(body.id, 180) || sb.id('candidate');
  const kind = clean(body.kind, 60) || 'content';
  const title = clean(body.title, 300);
  const officialUrl = safeUrl(body.officialUrl);
  if (!title || !officialUrl) { const e = new Error('후보 제목과 HTTPS 공식 URL이 필요합니다.'); e.statusCode = 400; throw e; }
  const status = inSet(body.status, STATES, 'discovered');
  const row = {
    id, kind, title, official_url: officialUrl, status,
    source_ref: clean(body.sourceRef, 240) || null,
    thumbnail_url: safeUrl(body.thumbnailUrl) || null,
    description: clean(body.description, 8000) || null,
    owner_note: clean(body.ownerNote, 8000) || null,
    source_payload: body.sourcePayload && typeof body.sourcePayload === 'object' ? body.sourcePayload : {},
    updated_at: iso()
  };
  if (!body.id) { row.created_at = iso(); row.created_by = actor.sub; }
  const rows = await sb.insert('gslot_candidates', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, body.id ? 'update_candidate' : 'create_candidate', 'candidate', id, { title, status, kind });
  return { ok: true, row: (rows || [row])[0] };
}
async function addEvidence(actor, body) {
  requireCapability(actor, 'edit');
  const candidateId = clean(body.candidateId, 180);
  const evidenceUrl = safeUrl(body.evidenceUrl);
  if (!candidateId || !evidenceUrl) { const e = new Error('후보와 HTTPS 증빙 URL이 필요합니다.'); e.statusCode = 400; throw e; }
  const row = { id: sb.id('evidence'), candidate_id: candidateId, evidence_type: clean(body.type, 80) || 'official_source', evidence_url: evidenceUrl, note: clean(body.note, 2000) || null, verified: bool(body.verified), created_at: iso(), created_by: actor.sub };
  const rows = await sb.insert('gslot_candidate_evidence', row);
  await audit(actor, 'add_evidence', 'candidate', candidateId, { evidenceType: row.evidence_type, verified: row.verified });
  return { ok: true, row: (rows || [row])[0] };
}
async function saveAvailability(actor, body) {
  requireCapability(actor, 'edit');
  const candidateId = clean(body.candidateId, 180);
  const countryCode = clean(body.countryCode, 3).toUpperCase();
  if (!candidateId || !/^[A-Z]{2,3}$/.test(countryCode)) { const e = new Error('후보와 국가 코드가 필요합니다.'); e.statusCode = 400; throw e; }
  const row = { candidate_id: candidateId, country_code: countryCode, region_code: clean(body.regionCode, 32).toUpperCase() || null, availability_state: clean(body.state, 40) || 'unknown', legal_basis: clean(body.legalBasis, 2000) || null, delivery_or_access: clean(body.deliveryOrAccess, 500) || null, updated_at: iso(), updated_by: actor.sub };
  const rows = await sb.insert('gslot_candidate_availability', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'upsert_availability', 'candidate', candidateId, row);
  return { ok: true, row: (rows || [row])[0] };
}
async function saveRevenue(actor, body) {
  requireCapability(actor, 'edit');
  const candidateId = clean(body.candidateId, 180);
  if (!candidateId) { const e = new Error('후보가 필요합니다.'); e.statusCode = 400; throw e; }
  const row = { id: clean(body.id, 180) || sb.id('revenue'), candidate_id: candidateId, revenue_type: clean(body.type, 60) || 'information_only', status: clean(body.status, 60) || 'unknown', affiliate_url: safeUrl(body.affiliateUrl) || null, provider_name: clean(body.providerName, 180) || null, currency: clean(body.currency, 3).toUpperCase() || null, note: clean(body.note, 3000) || null, updated_at: iso(), updated_by: actor.sub };
  const rows = await sb.insert('gslot_candidate_revenue', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'upsert_revenue', 'candidate', candidateId, { revenueType: row.revenue_type, status: row.status });
  return { ok: true, row: (rows || [row])[0] };
}
async function saveAssignment(actor, body) {
  requireCapability(actor, 'edit');
  const candidateId = clean(body.candidateId, 180);
  const hubKey = clean(body.hubKey, 80);
  const countryCode = clean(body.countryCode, 3).toUpperCase() || 'GLOBAL';
  const slotKey = clean(body.slotKey, 120);
  if (!candidateId || !HUBS.has(hubKey) || !slotKey) { const e = new Error('후보·허브·슬롯 키가 필요합니다.'); e.statusCode = 400; throw e; }
  const assignmentId = clean(body.id, 180) || sb.id('assignment');
  const state = inSet(body.state, ASSIGNMENT_STATES, 'draft');
  const pub = inSet(body.publicationStatus, PUBLICATION_STATES, 'not_ready');
  const row = { id: assignmentId, candidate_id: candidateId, hub_key: hubKey, country_code: countryCode, region_code: clean(body.regionCode, 32).toUpperCase() || null, slot_key: slotKey, priority: Math.max(-1000000, Math.min(1000000, Number(body.priority) || 0)), state, publication_status: pub, manual_pinned: bool(body.manualPinned), decision_note: clean(body.note, 3000) || null, updated_at: iso(), updated_by: actor.sub };
  if (!body.id) row.created_at = iso();
  const rows = await sb.insert('gslot_slot_assignments', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, body.id ? 'update_assignment' : 'create_assignment', 'assignment', assignmentId, { candidateId, hubKey, countryCode, slotKey, state, publicationStatus: pub });
  let releaseDispatch = null;
  if ((state === 'approved' || state === 'pinned') && pub === 'ready') {
    releaseDispatch = await ReleaseDispatch.dispatch({ candidateId, assignmentId, actorId: actor.sub });
  }
  return { ok: true, row: (rows || [row])[0], releaseDispatch };
}
async function decideAssignment(actor, body) {
  requireCapability(actor, 'approve');
  const assignmentId = clean(body.assignmentId, 180);
  const state = inSet(body.state, ASSIGNMENT_STATES, 'hold');
  if (!assignmentId) { const e = new Error('배치 ID가 필요합니다.'); e.statusCode = 400; throw e; }
  const patch = { state, publication_status: state === 'approved' || state === 'pinned' ? 'ready' : (state === 'suppressed' || state === 'retired' ? 'not_ready' : 'not_ready'), decision_note: clean(body.note, 3000) || null, updated_at: iso(), updated_by: actor.sub };
  const rows = await sb.update('gslot_slot_assignments', 'id=eq.' + encodeURIComponent(assignmentId), patch);
  await audit(actor, 'decide_assignment', 'assignment', assignmentId, patch);
  const saved = (rows || [])[0] || null;
  let releaseDispatch = null;
  if (state === 'approved' || state === 'pinned') {
    releaseDispatch = await ReleaseDispatch.dispatch({ candidateId: saved && saved.candidate_id, assignmentId, actorId: actor.sub });
  }
  return { ok: true, row: saved, releaseDispatch };
}
async function listPolicies() { const rows = await sb.select('gslot_policies', 'select=*&order=updated_at.desc&limit=200'); return { ok: true, rows: rows || [] }; }
async function savePolicy(actor, body) {
  requireCapability(actor, 'policy');
  const id = clean(body.id, 180) || sb.id('policy');
  const row = { id, name: clean(body.name, 180), scope_hub: clean(body.scopeHub, 80) || null, scope_country: clean(body.scopeCountry, 3).toUpperCase() || null, scope_region: clean(body.scopeRegion, 32).toUpperCase() || null, enabled: body.enabled !== false, rule: body.rule && typeof body.rule === 'object' ? body.rule : {}, updated_at: iso(), updated_by: actor.sub };
  if (!body.id) row.created_at = iso();
  if (!row.name) { const e = new Error('정책 이름이 필요합니다.'); e.statusCode = 400; throw e; }
  const rows = await sb.insert('gslot_policies', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, body.id ? 'update_policy' : 'create_policy', 'policy', id, { name: row.name, scopeHub: row.scope_hub, scopeCountry: row.scope_country });
  return { ok: true, row: (rows || [row])[0] };
}
async function listSources() { const rows = await sb.select('gslot_data_sources', 'select=*&order=updated_at.desc&limit=200'); return { ok: true, rows: rows || [] }; }
async function saveSource(actor, body) {
  requireCapability(actor, 'policy');
  const id = clean(body.id, 180) || sb.id('source');
  const officialUrl = safeUrl(body.officialUrl);
  if (!clean(body.name, 180) || !officialUrl || !clean(body.legalBasis, 2000)) { const e = new Error('데이터원 이름·공식 URL·법적/약관 근거가 필요합니다.'); e.statusCode = 400; throw e; }
  const row = { id, name: clean(body.name, 180), official_url: officialUrl, legal_basis: clean(body.legalBasis, 2000), access_mode: clean(body.accessMode, 80) || 'manual', enabled: body.enabled !== false, rate_limit_note: clean(body.rateLimitNote, 500) || null, updated_at: iso(), updated_by: actor.sub };
  if (!body.id) row.created_at = iso();
  const rows = await sb.insert('gslot_data_sources', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, body.id ? 'update_data_source' : 'create_data_source', 'data_source', id, { name: row.name, accessMode: row.access_mode });
  return { ok: true, row: (rows || [row])[0] };
}
async function listAffiliates() { const rows = await sb.select('gslot_affiliate_crm', 'select=*&order=updated_at.desc&limit=200'); return { ok: true, rows: rows || [] }; }
async function saveAffiliate(actor, body) {
  requireCapability(actor, 'edit');
  const id = clean(body.id, 180) || sb.id('affiliate');
  const row = { id, name: clean(body.name, 180), official_url: safeUrl(body.officialUrl) || null, contact_url: safeUrl(body.contactUrl) || null, status: clean(body.status, 80) || 'discovered', renewal_at: clean(body.renewalAt, 80) || null, note: clean(body.note, 3000) || null, updated_at: iso(), updated_by: actor.sub };
  if (!body.id) row.created_at = iso();
  if (!row.name) { const e = new Error('제휴 대상 이름이 필요합니다.'); e.statusCode = 400; throw e; }
  const rows = await sb.insert('gslot_affiliate_crm', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, body.id ? 'update_affiliate' : 'create_affiliate', 'affiliate', id, { name: row.name, status: row.status });
  return { ok: true, row: (rows || [row])[0] };
}
async function listAudit(event) { const q = event.queryStringParameters || {}; const rows = await sb.select('gslot_audit_log', 'select=*&order=created_at.desc&limit=' + Math.max(1, Math.min(300, Number(q.limit) || 100))); return { ok: true, rows: rows || [] }; }
async function storageSign(actor, body) {
  requireCapability(actor, 'edit');
  const allowed = new Set(['gslot-evidence','gslot-documents','gslot-media-drafts']);
  const bucket = clean(body.bucket, 80);
  if (!allowed.has(bucket)) { const e = new Error('허용되지 않은 저장소입니다.'); e.statusCode = 400; throw e; }
  const fileName = clean(body.fileName, 180).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!fileName) { const e = new Error('파일 이름이 필요합니다.'); e.statusCode = 400; throw e; }
  const path = actor.sub.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) + '/' + Date.now() + '_' + fileName;
  const result = await sb.storageSignedUpload(bucket, path);
  await audit(actor, 'sign_storage_upload', 'storage', path, { bucket });
  return { ok: true, result };
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return json(204, {});
    const method = String(event.httpMethod || 'GET').toUpperCase();
    const query = event.queryStringParameters || {};
    const body = method === 'GET' ? {} : parseBody(event);
    const action = clean(query.action || body.action || 'session', 80);
    const actor = await resolveUser(event);
    requireCapability(actor, 'read');

    // This isolated console deliberately has no front publication, build-hook, or Snapshot action.
    let out;
    if (action === 'session') out = session(actor);
    else if (action === 'hubs') out = await listHubs(actor);
    else if (action === 'regions') out = await listRegions();
    else if (action === 'countries') out = await listCountries();
    else if (action === 'region.save' && method !== 'GET') out = await upsertRegion(actor, body);
    else if (action === 'country.save' && method !== 'GET') out = await upsertCountry(actor, body);
    else if (action === 'candidates') out = await listCandidates(event, actor);
    else if (action === 'candidate.detail') out = await candidateDetail(query.id || body.id);
    else if (action === 'candidate.save' && method !== 'GET') out = await saveCandidate(actor, body);
    else if (action === 'evidence.add' && method !== 'GET') out = await addEvidence(actor, body);
    else if (action === 'availability.save' && method !== 'GET') out = await saveAvailability(actor, body);
    else if (action === 'revenue.save' && method !== 'GET') out = await saveRevenue(actor, body);
    else if (action === 'assignment.save' && method !== 'GET') out = await saveAssignment(actor, body);
    else if (action === 'assignment.decide' && method !== 'GET') out = await decideAssignment(actor, body);
    else if (action === 'policies') out = await listPolicies();
    else if (action === 'policy.save' && method !== 'GET') out = await savePolicy(actor, body);
    else if (action === 'sources') out = await listSources();
    else if (action === 'source.save' && method !== 'GET') out = await saveSource(actor, body);
    else if (action === 'affiliates') out = await listAffiliates();
    else if (action === 'affiliate.save' && method !== 'GET') out = await saveAffiliate(actor, body);
    else if (action === 'audit') out = await listAudit(event);
    else if (action === 'media.list') out = await media.list(event);
    else if (action === 'media.detail') out = await media.detail(query.candidateId || body.candidateId || query.id || body.id);
    else if (action === 'media.profile.save' && method !== 'GET') out = await media.saveProfile(actor, body);
    else if (action === 'media.rights.save' && method !== 'GET') out = await media.saveRights(actor, body);
    else if (action === 'media.asset.sign' && method !== 'GET') out = await media.signAsset(actor, body);
    else if (action === 'media.asset.confirm' && method !== 'GET') out = await media.confirmAsset(actor, body);
    else if (action === 'media.asset.external.save' && method !== 'GET') out = await media.saveExternalAsset(actor, body);
    else if (action === 'media.job.queue' && method !== 'GET') out = await media.queueJob(actor, body);
    else if (action === 'media.readiness') out = await media.readiness(query.candidateId || body.candidateId || query.id || body.id);
    else if (action === 'storage.sign' && method !== 'GET') out = await storageSign(actor, body);
    else { const error = new Error('지원하지 않는 관리 콘솔 요청입니다: ' + action); error.statusCode = 404; throw error; }
    return json(200, out);
  } catch (error) {
    return json(error.statusCode || 500, { ok: false, error: error.message || '관리 콘솔 처리 중 오류가 발생했습니다.' });
  }
};
