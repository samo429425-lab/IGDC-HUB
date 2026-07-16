'use strict';

/**
 * Global Slot Console media registry adapter.
 *
 * Server-only bridge for media profiles, territorial rights, private assets,
 * processing jobs and readiness checks stored in the isolated Global Slot
 * Supabase project. It never publishes a public snapshot or calls a media
 * provider.
 */
const { requireCapability } = require('./global-slot-console-auth');
const sb = require('./global-slot-console-supabase');

const VERSION = 'global-slot-console-media-v1.0.0';
const TABLES = Object.freeze({
  profiles: process.env.GSLOT_MEDIA_PROFILE_TABLE || 'gslot_media_profiles',
  assets: process.env.GSLOT_MEDIA_ASSET_TABLE || 'gslot_media_assets',
  rights: process.env.GSLOT_MEDIA_RIGHTS_TABLE || 'gslot_media_rights',
  jobs: process.env.GSLOT_MEDIA_JOB_TABLE || 'gslot_media_jobs'
});
const ALLOWED_UPLOAD_BUCKETS = new Set(['gslot-media-drafts']);
const INGEST_STATES = new Set(['awaiting_upload', 'uploaded', 'verified', 'ready', 'failed', 'rejected']);

function clean(value, max) {
  const out = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return max ? out.slice(0, max) : out;
}
function lower(value, max) { return clean(value, max).toLowerCase().replace(/[\s-]+/g, '_'); }
function iso() { return new Date().toISOString(); }
function fail(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function safeId(value, label) {
  const id = clean(value, 180);
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(id)) {
    throw fail(400, 'media_identifier_invalid', (label || '식별자') + '가 올바르지 않습니다.');
  }
  return id;
}
function safeUrl(value, required) {
  const raw = clean(value, 4096);
  if (!raw && !required) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') throw new Error('protocol');
    return parsed.toString();
  } catch (_) {
    throw fail(400, 'media_https_url_required', 'HTTPS 공식 주소가 필요합니다.');
  }
}
function bool(value) {
  return value === true || /^(1|true|yes|on)$/i.test(clean(value));
}
function finiteInt(value, min, max) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}
function stringArray(value, maxItems) {
  const source = Array.isArray(value) ? value : clean(value).split(',');
  return Array.from(new Set(source.map((entry) => lower(entry, 48)).filter((entry) => /^[a-z]{2,3}(?:_[a-z0-9]{2,12})?$/.test(entry))))
    .slice(0, maxItems || 30)
    .map((entry) => entry.replace(/_/g, '-'));
}
function optionalDate(value) {
  const raw = clean(value, 80);
  if (!raw) return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) throw fail(400, 'media_date_invalid', '날짜 형식이 올바르지 않습니다.');
  return new Date(time).toISOString();
}
function quoteIn(values) {
  return 'in.(' + values.map((value) => JSON.stringify(clean(value, 180))).join(',') + ')';
}
function actorId(actor) { return clean(actor && (actor.sub || actor.memberId), 180) || 'unknown'; }

async function audit(actor, action, entityType, entityId, detail) {
  try {
    await sb.insert('gslot_audit_log', {
      id: sb.id('audit'),
      actor_id: actorId(actor),
      actor_role: clean(actor && actor.role, 80) || 'unknown',
      action: clean(action, 80),
      entity_type: clean(entityType, 80),
      entity_id: clean(entityId, 180) || null,
      detail: detail || {},
      created_at: iso()
    }, 'return=minimal');
  } catch (_) {
    // The primary mutation result is authoritative; audit health is checked separately.
  }
}

async function candidate(candidateId) {
  const id = safeId(candidateId, '후보 ID');
  const rows = await sb.select('gslot_candidates', 'select=id,kind,title,official_url,thumbnail_url,status,source_ref,updated_at&id=eq.' + encodeURIComponent(id) + '&limit=1');
  const row = (rows || [])[0] || null;
  if (!row) throw fail(404, 'media_candidate_not_found', '미디어 후보 원장을 찾지 못했습니다.');
  return row;
}

async function list(event) {
  const query = event && event.queryStringParameters || {};
  const limit = Math.max(1, Math.min(300, Number(query.limit) || 100));
  const filters = ['select=*'];
  if (query.workflowStatus) filters.push('workflow_status=eq.' + encodeURIComponent(lower(query.workflowStatus, 80)));
  if (query.rightsStatus) filters.push('rights_status=eq.' + encodeURIComponent(lower(query.rightsStatus, 80)));
  filters.push('order=updated_at.desc', 'limit=' + limit);
  const rows = await sb.select(TABLES.profiles, filters.join('&')) || [];
  const ids = Array.from(new Set(rows.map((row) => clean(row && row.candidate_id, 180)).filter(Boolean)));
  let candidates = [];
  if (ids.length) {
    candidates = await sb.select('gslot_candidates', 'select=id,kind,title,official_url,thumbnail_url,status&id=' + quoteIn(ids) + '&limit=' + Math.min(1000, ids.length));
  }
  const byId = new Map((candidates || []).map((row) => [clean(row && row.id, 180), row]));
  const search = lower(query.search, 120);
  const joined = rows.map((row) => Object.assign({}, row, { candidate: byId.get(clean(row && row.candidate_id, 180)) || null }));
  return {
    ok: true,
    version: VERSION,
    rows: search ? joined.filter((row) => lower([row.candidate_id, row.media_kind, row.workflow_status, row.rights_status, row.candidate && row.candidate.title].join(' ')).includes(search)) : joined
  };
}

function readinessFrom(profile, assets, rights) {
  const now = Date.now();
  const activeRights = (rights || []).filter((row) => {
    const state = lower(row && row.rights_state, 80);
    const start = row && row.start_at ? Date.parse(row.start_at) : NaN;
    const end = row && row.end_at ? Date.parse(row.end_at) : NaN;
    return ['cleared', 'allowed', 'active', 'approved'].includes(state) && (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end > now);
  });
  const usableAssets = (assets || []).filter((row) => {
    const state = lower(row && row.ingest_status, 80);
    const mode = lower(row && row.storage_mode, 80);
    const hasPath = !!clean(row && (row.object_path || row.external_url), 4096);
    return hasPath && ['uploaded', 'verified', 'ready', 'registered'].includes(state) && (row.delivery_allowed === true || ['supabase_private', 'official_external', 'provider_stream', 'provider_embed', 'provider_download'].includes(mode));
  });
  const checks = [
    { key: 'profile', ok: !!profile, message: profile ? '미디어 프로필이 저장되었습니다.' : '미디어 프로필이 필요합니다.' },
    { key: 'workflow', ok: lower(profile && profile.workflow_status, 80) === 'approved_for_delivery', message: lower(profile && profile.workflow_status, 80) === 'approved_for_delivery' ? '전달 승인 단계입니다.' : '전달 승인 단계가 필요합니다.' },
    { key: 'rights-profile', ok: lower(profile && profile.rights_status, 80) === 'cleared', message: lower(profile && profile.rights_status, 80) === 'cleared' ? '기본 권리 상태가 확인되었습니다.' : '기본 권리 확인이 필요합니다.' },
    { key: 'territory-rights', ok: activeRights.length > 0, message: activeRights.length ? '유효한 국가별 권리 기록이 있습니다.' : '유효한 국가별 권리 기록이 필요합니다.' },
    { key: 'delivery-mode', ok: !!profile && !['', 'not_set', 'disabled'].includes(lower(profile.delivery_mode, 80)), message: profile && !['', 'not_set', 'disabled'].includes(lower(profile.delivery_mode, 80)) ? '전송 방식이 지정되었습니다.' : '전송 방식을 지정해야 합니다.' },
    { key: 'asset', ok: usableAssets.length > 0, message: usableAssets.length ? '사용 가능한 비공개/공식 자산 경로가 있습니다.' : '사용 가능한 자산 경로가 필요합니다.' }
  ];
  const metadataChecks = checks.filter((entry) => ['profile', 'rights-profile', 'territory-rights'].includes(entry.key));
  return {
    canPublishMetadata: metadataChecks.every((entry) => entry.ok),
    canEnablePlayback: checks.every((entry) => entry.ok),
    checks,
    activeRightsCount: activeRights.length,
    usableAssetCount: usableAssets.length
  };
}

async function loadBundle(candidateId) {
  const id = safeId(candidateId, '후보 ID');
  const [candidateRow, profiles, assets, rights, jobs] = await Promise.all([
    candidate(id),
    sb.select(TABLES.profiles, 'select=*&candidate_id=eq.' + encodeURIComponent(id) + '&limit=1'),
    sb.select(TABLES.assets, 'select=*&candidate_id=eq.' + encodeURIComponent(id) + '&order=updated_at.desc&limit=500'),
    sb.select(TABLES.rights, 'select=*&candidate_id=eq.' + encodeURIComponent(id) + '&order=country_code.asc&limit=500'),
    sb.select(TABLES.jobs, 'select=*&candidate_id=eq.' + encodeURIComponent(id) + '&order=created_at.desc&limit=500')
  ]);
  const profile = (profiles || [])[0] || null;
  return {
    candidate: candidateRow,
    profile,
    assets: assets || [],
    rights: rights || [],
    jobs: jobs || [],
    readiness: readinessFrom(profile, assets || [], rights || [])
  };
}

async function detail(candidateId) {
  const bundle = await loadBundle(candidateId);
  return Object.assign({ ok: true, version: VERSION }, bundle);
}

async function saveProfile(actor, body) {
  requireCapability(actor, 'mediaEdit');
  const candidateId = safeId(body && body.candidateId, '후보 ID');
  await candidate(candidateId);
  const row = {
    id: candidateId,
    candidate_id: candidateId,
    media_kind: lower(body.mediaKind, 60) || 'other',
    workflow_status: lower(body.workflowStatus, 80) || 'draft',
    rights_status: lower(body.rightsStatus, 80) || 'unknown',
    rights_basis: lower(body.rightsBasis, 80) || 'other',
    rights_expiry: optionalDate(body.rightsExpiry),
    license_reference: clean(body.licenseReference, 1000) || null,
    release_year: finiteInt(body.releaseYear, 1800, 2200),
    runtime_seconds: finiteInt(body.runtimeSeconds, 0, 60 * 60 * 24),
    original_language: stringArray(body.originalLanguage, 1)[0] || null,
    audio_languages: stringArray(body.audioLanguages, 30),
    caption_languages: stringArray(body.captionLanguages, 30),
    content_rating: clean(body.contentRating, 80) || null,
    delivery_mode: lower(body.deliveryMode, 80) || 'not_set',
    public_summary: clean(body.publicSummary, 8000) || null,
    internal_note: clean(body.internalNote, 12000) || null,
    updated_at: iso(),
    updated_by: actorId(actor)
  };
  const rows = await sb.insert(TABLES.profiles, row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'media_profile_save', 'media_profile', candidateId, { workflowStatus: row.workflow_status, rightsStatus: row.rights_status, deliveryMode: row.delivery_mode });
  return { ok: true, row: (rows || [row])[0] };
}

async function saveRights(actor, body) {
  requireCapability(actor, 'mediaEdit');
  const candidateId = safeId(body && body.candidateId, '후보 ID');
  await candidate(candidateId);
  const countryCode = clean(body.countryCode, 32).toUpperCase();
  if (!(countryCode === 'GLOBAL' || /^[A-Z]{2,3}$/.test(countryCode))) throw fail(400, 'media_country_invalid', '국가 코드가 올바르지 않습니다.');
  const id = candidateId + ':' + countryCode;
  const row = {
    id,
    candidate_id: candidateId,
    country_code: countryCode,
    rights_state: lower(body.rightsState, 80) || 'review_required',
    access_type: lower(body.accessType, 80) || 'member_free',
    start_at: optionalDate(body.startAt),
    end_at: optionalDate(body.endAt),
    license_evidence_url: body.licenseEvidenceUrl ? safeUrl(body.licenseEvidenceUrl, true) : null,
    license_reference: clean(body.licenseReference, 1000) || null,
    note: clean(body.note, 5000) || null,
    updated_at: iso(),
    updated_by: actorId(actor)
  };
  if (row.start_at && row.end_at && Date.parse(row.start_at) >= Date.parse(row.end_at)) throw fail(400, 'media_rights_period_invalid', '권리 종료일은 시작일보다 뒤여야 합니다.');
  const rows = await sb.insert(TABLES.rights, row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'media_rights_save', 'media_rights', id, { candidateId, countryCode, rightsState: row.rights_state, accessType: row.access_type });
  return { ok: true, row: (rows || [row])[0] };
}

async function signAsset(actor, body) {
  requireCapability(actor, 'mediaEdit');
  const candidateId = safeId(body && body.candidateId, '후보 ID');
  await candidate(candidateId);
  const bucket = clean(body.bucket, 80);
  if (!ALLOWED_UPLOAD_BUCKETS.has(bucket)) throw fail(400, 'media_bucket_not_allowed', '허용되지 않은 비공개 미디어 저장소입니다.');
  const rawFileName = clean(body.fileName, 180);
  const fileName = rawFileName.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!fileName) throw fail(400, 'media_file_name_required', '파일 이름이 필요합니다.');
  const assetId = sb.id('media_asset');
  const objectPath = candidateId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) + '/' + Date.now() + '_' + fileName;
  const upload = await sb.storageSignedUpload(bucket, objectPath);
  const row = {
    id: assetId,
    candidate_id: candidateId,
    asset_role: lower(body.assetRole, 80) || 'source',
    storage_mode: 'supabase_private',
    bucket,
    object_path: objectPath,
    external_url: null,
    file_name: fileName,
    mime_type: clean(body.mimeType, 160) || 'application/octet-stream',
    byte_size: finiteInt(body.byteSize, 0, Number.MAX_SAFE_INTEGER) || 0,
    language_tag: stringArray(body.languageTag, 1)[0] || null,
    ingest_status: 'awaiting_upload',
    delivery_allowed: false,
    note: clean(body.note, 5000) || null,
    created_at: iso(),
    updated_at: iso(),
    created_by: actorId(actor),
    updated_by: actorId(actor)
  };
  const rows = await sb.insert(TABLES.assets, row, 'return=representation');
  const asset = (rows || [row])[0];
  await audit(actor, 'media_asset_sign', 'media_asset', assetId, { candidateId, bucket, objectPath, assetRole: row.asset_role });
  return { ok: true, asset, upload };
}

async function confirmAsset(actor, body) {
  requireCapability(actor, 'mediaEdit');
  const assetId = safeId(body && body.assetId, '자산 ID');
  const existing = await sb.select(TABLES.assets, 'select=*&id=eq.' + encodeURIComponent(assetId) + '&limit=1');
  const asset = (existing || [])[0] || null;
  if (!asset) throw fail(404, 'media_asset_not_found', '미디어 자산 기록을 찾지 못했습니다.');
  const state = lower(body.ingestStatus, 80) || 'uploaded';
  if (!INGEST_STATES.has(state)) throw fail(400, 'media_ingest_status_invalid', '자산 처리 상태가 올바르지 않습니다.');
  const patch = {
    ingest_status: state,
    language_tag: body.languageTag == null ? asset.language_tag : (stringArray(body.languageTag, 1)[0] || null),
    note: body.note == null ? asset.note : (clean(body.note, 5000) || null),
    updated_at: iso(),
    updated_by: actorId(actor)
  };
  if (body.deliveryAllowed !== undefined) patch.delivery_allowed = bool(body.deliveryAllowed);
  const rows = await sb.update(TABLES.assets, 'id=eq.' + encodeURIComponent(assetId), patch);
  await audit(actor, 'media_asset_confirm', 'media_asset', assetId, { candidateId: asset.candidate_id, ingestStatus: state });
  return { ok: true, row: (rows || [Object.assign({}, asset, patch)])[0] };
}

async function saveExternalAsset(actor, body) {
  requireCapability(actor, 'mediaEdit');
  const candidateId = safeId(body && body.candidateId, '후보 ID');
  await candidate(candidateId);
  const assetId = sb.id('media_asset');
  const storageMode = lower(body.storageMode, 80) || 'official_external';
  const allowedModes = new Set(['official_external', 'provider_stream', 'provider_embed', 'provider_download']);
  if (!allowedModes.has(storageMode)) throw fail(400, 'media_storage_mode_invalid', '외부 미디어 경로 유형이 올바르지 않습니다.');
  const externalUrl = safeUrl(body.externalUrl, true);
  const row = {
    id: assetId,
    candidate_id: candidateId,
    asset_role: lower(body.assetRole, 80) || 'delivery',
    storage_mode: storageMode,
    bucket: null,
    object_path: null,
    external_url: externalUrl,
    file_name: null,
    mime_type: null,
    byte_size: 0,
    language_tag: stringArray(body.languageTag, 1)[0] || null,
    ingest_status: 'registered',
    delivery_allowed: bool(body.deliveryAllowed),
    note: clean(body.note, 5000) || null,
    created_at: iso(),
    updated_at: iso(),
    created_by: actorId(actor),
    updated_by: actorId(actor)
  };
  const rows = await sb.insert(TABLES.assets, row, 'return=representation');
  await audit(actor, 'media_external_asset_save', 'media_asset', assetId, { candidateId, storageMode, deliveryAllowed: row.delivery_allowed });
  return { ok: true, row: (rows || [row])[0] };
}

async function queueJob(actor, body) {
  requireCapability(actor, 'mediaEdit');
  const candidateId = safeId(body && body.candidateId, '후보 ID');
  await candidate(candidateId);
  const jobType = lower(body.jobType, 80);
  if (!jobType || !/^[a-z0-9][a-z0-9_.:]{1,79}$/.test(jobType)) throw fail(400, 'media_job_type_invalid', '미디어 처리 작업 유형이 올바르지 않습니다.');
  const row = {
    id: sb.id('media_job'),
    candidate_id: candidateId,
    job_type: jobType,
    status: 'queued',
    request: body.request && typeof body.request === 'object' && !Array.isArray(body.request) ? body.request : {},
    created_at: iso(),
    updated_at: iso(),
    created_by: actorId(actor),
    updated_by: actorId(actor)
  };
  const rows = await sb.insert(TABLES.jobs, row, 'return=representation');
  await audit(actor, 'media_job_queue', 'media_job', row.id, { candidateId, jobType });
  return { ok: true, row: (rows || [row])[0], note: '미디어 처리 작업이 대기열에 등록되었습니다.' };
}

async function readiness(candidateId) {
  const bundle = await loadBundle(candidateId);
  return { ok: true, version: VERSION, candidate: bundle.candidate, readiness: bundle.readiness };
}

module.exports = {
  VERSION,
  TABLES,
  list,
  detail,
  saveProfile,
  saveRights,
  signAsset,
  confirmAsset,
  saveExternalAsset,
  queueJob,
  readiness,
  readinessFrom
};
