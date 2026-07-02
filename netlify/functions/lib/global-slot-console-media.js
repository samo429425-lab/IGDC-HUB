'use strict';

/*
 * Media registry for the Global Slot Console.
 * PostgreSQL stores metadata/rights/asset records; Supabase Storage stores only
 * approved test previews, posters and sidecars. Full masters are always tracked
 * as external/private delivery references and are never exposed by this module.
 */
const sb = require('./global-slot-console-supabase');
const { requireCapability } = require('./global-slot-console-auth');

const MEDIA_KINDS = new Set(['film','series','episode','documentary','short','clip','broadcast','music_video','audio','live_event','other']);
const WORKFLOW_STATES = new Set(['draft','metadata_ready','rights_pending','ingest_ready','processing','ready_for_review','approved_metadata','approved_for_delivery','hold','suppressed','retired']);
const RIGHTS_STATES = new Set(['unknown','pending','cleared','restricted','expired','rejected']);
const RIGHTS_BASIS = new Set(['public_domain','cc_by','cc_by_sa','government_open','direct_license','distribution_agreement','platform_authorization','other']);
const DELIVERY_MODES = new Set(['not_set','external_official','private_preview','approved_delivery_provider','information_only']);
const ASSET_ROLES = new Set(['poster','thumbnail','trailer','preview_video','preview_audio','subtitle','transcript','metadata_file','rights_document','external_master','delivery_manifest','other']);
const STORAGE_MODES = new Set(['supabase_private','external_https','delivery_provider']);
const INGEST_STATES = new Set(['pending_upload','uploaded','processing','ready','failed','external_ready','blocked','retired']);
const JOB_TYPES = new Set(['probe_metadata','make_poster','transcode_preview','validate_delivery','sync_external_reference']);
const JOB_STATES = new Set(['queued','running','succeeded','failed','cancelled']);
const COUNTRY_RIGHTS_STATES = new Set(['unknown','cleared','restricted','blocked','expired']);
const MAX_DEFAULT = 250 * 1024 * 1024;

function clean(value, max) { const text = String(value == null ? '' : value).trim(); return max ? text.slice(0, max) : text; }
function now() { return new Date().toISOString(); }
function bool(value) { return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'; }
function safeUrl(value) { try { const u = new URL(clean(value)); return u.protocol === 'https:' ? u.toString() : ''; } catch (_) { return ''; } }
function enumValue(value, set, fallback) { const v = clean(value).toLowerCase(); return set.has(v) ? v : fallback; }
function maxUploadBytes() { const n = Number(process.env.GSLOT_MEDIA_MAX_UPLOAD_BYTES || MAX_DEFAULT); return Math.max(5 * 1024 * 1024, Math.min(Number.isFinite(n) ? n : MAX_DEFAULT, 1024 * 1024 * 1024)); }
function normalizeLanguageList(value) {
  if (Array.isArray(value)) return value.map(v => clean(v, 24)).filter(Boolean).slice(0, 40);
  return clean(value, 1000).split(',').map(v => clean(v, 24)).filter(Boolean).slice(0, 40);
}
function displayBytes(bytes) { const n = Number(bytes || 0); if (!n) return '0 B'; const units=['B','KB','MB','GB']; const p=Math.min(units.length-1,Math.floor(Math.log(n)/Math.log(1024))); return (n/Math.pow(1024,p)).toFixed(p ? 1 : 0)+' '+units[p]; }

async function audit(actor, action, entityType, entityId, detail) {
  try { await sb.insert('gslot_audit_log', { id: sb.id('audit'), actor_id: actor && actor.sub || null, actor_role: actor && actor.role || 'system', action, entity_type: entityType, entity_id: entityId || null, detail: detail || {}, created_at: now() }, 'return=minimal'); } catch (_) {}
}

async function candidate(id) {
  const candidateId = clean(id, 180);
  if (!candidateId) { const e = new Error('영상 후보 ID가 필요합니다.'); e.statusCode = 400; throw e; }
  const rows = await sb.select('gslot_candidates', 'select=id,kind,title,official_url,status,thumbnail_url,description&id=eq.' + encodeURIComponent(candidateId) + '&limit=1');
  const row = (rows || [])[0];
  if (!row) { const e = new Error('저장된 후보를 찾지 못했습니다. 먼저 후보 원장을 저장하세요.'); e.statusCode = 404; throw e; }
  return row;
}

async function list(event) {
  const q = event.queryStringParameters || {};
  const filters = ['select=*,candidate:gslot_candidates(id,title,kind,status,official_url,thumbnail_url)', 'order=updated_at.desc', 'limit=' + Math.max(1, Math.min(300, Number(q.limit) || 100))];
  if (q.workflowStatus) filters.push('workflow_status=eq.' + encodeURIComponent(enumValue(q.workflowStatus, WORKFLOW_STATES, 'draft')));
  if (q.rightsStatus) filters.push('rights_status=eq.' + encodeURIComponent(enumValue(q.rightsStatus, RIGHTS_STATES, 'unknown')));
  const rows = await sb.select('gslot_media_profiles', filters.join('&'));
  return { ok: true, rows: rows || [] };
}

async function detail(id) {
  const candidateRow = await candidate(id);
  const candidateId = candidateRow.id;
  const [profiles, assets, rights, jobs] = await Promise.all([
    sb.select('gslot_media_profiles', 'select=*&candidate_id=eq.' + encodeURIComponent(candidateId) + '&limit=1'),
    sb.select('gslot_media_assets', 'select=*&candidate_id=eq.' + encodeURIComponent(candidateId) + '&order=updated_at.desc&limit=500'),
    sb.select('gslot_media_rights', 'select=*&candidate_id=eq.' + encodeURIComponent(candidateId) + '&order=country_code.asc,updated_at.desc&limit=500'),
    sb.select('gslot_media_jobs', 'select=*&candidate_id=eq.' + encodeURIComponent(candidateId) + '&order=created_at.desc&limit=200')
  ]);
  const profile = (profiles || [])[0] || null;
  const readiness = readinessOf(candidateRow, profile, assets || [], rights || []);
  return { ok: true, candidate: candidateRow, profile, assets: assets || [], rights: rights || [], jobs: jobs || [], readiness };
}

function readinessOf(candidateRow, profile, assets, rights) {
  const checks = [];
  const add = (id, ok, message) => checks.push({ id, ok, message });
  add('candidate', !!candidateRow, '후보 원장이 저장되어 있어야 합니다.');
  add('profile', !!profile, '영상 제목·권리·전송 방식 프로필이 필요합니다.');
  const rightsCleared = !!profile && profile.rights_status === 'cleared';
  add('rights', rightsCleared, '전체 권리 상태가 cleared여야 합니다.');
  const basisOk = !!profile && RIGHTS_BASIS.has(profile.rights_basis || '');
  add('rights_basis', basisOk, '허용된 권리 근거가 기록되어야 합니다.');
  const hasRightsEvidence = rights.some(row => row.rights_state === 'cleared' && row.license_evidence_url);
  add('territory', hasRightsEvidence || (!!profile && profile.rights_basis === 'public_domain'), '국가별 권리 또는 공용 권리 근거가 필요합니다.');
  const hasPoster = assets.some(row => ['poster','thumbnail'].includes(row.asset_role) && ['ready','external_ready'].includes(row.ingest_status));
  add('artwork', hasPoster, '포스터 또는 썸네일 자산이 준비되어야 합니다.');
  const delivery = profile && profile.delivery_mode;
  const externalReady = assets.some(row => ['external_master','delivery_manifest'].includes(row.asset_role) && ['external_ready','ready'].includes(row.ingest_status));
  const previewReady = assets.some(row => ['preview_video','trailer'].includes(row.asset_role) && row.storage_mode === 'supabase_private' && row.ingest_status === 'ready');
  const deliveryOk = delivery === 'external_official' ? externalReady : delivery === 'approved_delivery_provider' ? externalReady : delivery === 'private_preview' ? previewReady : delivery === 'information_only';
  add('delivery', deliveryOk, '선택한 전송 방식에 맞는 검증된 자산 또는 공식 전달 경로가 필요합니다.');
  const metadataOk = !!profile && ['approved_metadata','approved_for_delivery'].includes(profile.workflow_status);
  add('metadata_approval', metadataOk, '관리자가 metadata 또는 delivery 단계로 승인해야 합니다.');
  const canPublishMetadata = checks.filter(x => ['candidate','profile','rights','rights_basis','territory','artwork','metadata_approval'].includes(x.id)).every(x => x.ok);
  const canEnablePlayback = checks.every(x => x.ok) && !!profile && profile.workflow_status === 'approved_for_delivery';
  return { canPublishMetadata, canEnablePlayback, checks };
}

async function saveProfile(actor, body) {
  requireCapability(actor, 'edit');
  const candidateRow = await candidate(body.candidateId);
  const candidateId = candidateRow.id;
  const mediaKind = enumValue(body.mediaKind, MEDIA_KINDS, 'other');
  const workflowStatus = enumValue(body.workflowStatus, WORKFLOW_STATES, 'draft');
  const rightsStatus = enumValue(body.rightsStatus, RIGHTS_STATES, 'unknown');
  const rightsBasis = enumValue(body.rightsBasis, RIGHTS_BASIS, 'other');
  const deliveryMode = enumValue(body.deliveryMode, DELIVERY_MODES, 'not_set');
  const runtimeSeconds = Math.max(0, Math.min(864000, Number(body.runtimeSeconds) || 0)) || null;
  const releaseYear = Math.max(1800, Math.min(3000, Number(body.releaseYear) || 0)) || null;
  const row = {
    candidate_id: candidateId,
    media_kind: mediaKind,
    workflow_status: workflowStatus,
    rights_status: rightsStatus,
    rights_basis: rightsBasis,
    rights_expiry: clean(body.rightsExpiry, 40) || null,
    license_reference: clean(body.licenseReference, 500) || null,
    release_year: releaseYear,
    runtime_seconds: runtimeSeconds,
    original_language: clean(body.originalLanguage, 24) || null,
    audio_languages: normalizeLanguageList(body.audioLanguages),
    caption_languages: normalizeLanguageList(body.captionLanguages),
    content_rating: clean(body.contentRating, 80) || null,
    delivery_mode: deliveryMode,
    public_summary: clean(body.publicSummary, 8000) || null,
    internal_note: clean(body.internalNote, 8000) || null,
    updated_at: now(),
    updated_by: actor.sub
  };
  const rows = await sb.insert('gslot_media_profiles', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'save_media_profile', 'media_profile', candidateId, { mediaKind, workflowStatus, rightsStatus, rightsBasis, deliveryMode });
  return { ok: true, row: (rows || [row])[0] };
}

async function saveRights(actor, body) {
  requireCapability(actor, 'edit');
  const candidateRow = await candidate(body.candidateId);
  const candidateId = candidateRow.id;
  const countryCode = clean(body.countryCode, 3).toUpperCase() || 'GLOBAL';
  if (!/^(GLOBAL|[A-Z]{2,3})$/.test(countryCode)) { const e = new Error('권리 적용 국가 코드는 GLOBAL 또는 ISO 국가 코드여야 합니다.'); e.statusCode = 400; throw e; }
  const rightsState = enumValue(body.rightsState, COUNTRY_RIGHTS_STATES, 'unknown');
  const evidenceUrl = safeUrl(body.licenseEvidenceUrl);
  if (rightsState === 'cleared' && !evidenceUrl && clean(body.licenseReference, 500) === '') { const e = new Error('권리 cleared 상태에는 라이선스 증빙 URL 또는 계약 참조가 필요합니다.'); e.statusCode = 400; throw e; }
  const row = {
    id: clean(body.id, 180) || sb.id('media_rights'),
    candidate_id: candidateId,
    country_code: countryCode,
    rights_state: rightsState,
    access_type: clean(body.accessType, 80) || 'information_only',
    start_at: clean(body.startAt, 40) || null,
    end_at: clean(body.endAt, 40) || null,
    license_evidence_url: evidenceUrl || null,
    license_reference: clean(body.licenseReference, 500) || null,
    note: clean(body.note, 3000) || null,
    updated_at: now(),
    updated_by: actor.sub
  };
  if (!body.id) row.created_at = now();
  const rows = await sb.insert('gslot_media_rights', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'save_media_rights', 'media_rights', row.id, { candidateId, countryCode, rightsState });
  return { ok: true, row: (rows || [row])[0] };
}

function allowedMediaBucket(bucket) { return new Set(['gslot-media-preview','gslot-media-sidecars']).has(bucket); }
function allowedMime(bucket, mime, role) {
  const value = clean(mime, 120).toLowerCase();
  if (bucket === 'gslot-media-sidecars') return /^(text\/(vtt|plain)|application\/(x-subrip|json|xml)|image\/(jpeg|png|webp))$/.test(value);
  if (bucket === 'gslot-media-preview') {
    if (role === 'poster' || role === 'thumbnail') return /^image\/(jpeg|png|webp)$/.test(value);
    if (role === 'subtitle' || role === 'transcript') return /^(text\/(vtt|plain)|application\/(x-subrip|json|xml))$/.test(value);
    return /^(video\/(mp4|webm)|audio\/(mpeg|mp4|ogg)|image\/(jpeg|png|webp)|text\/vtt)$/.test(value);
  }
  return false;
}
function safeFileName(value) { return clean(value, 180).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'asset.bin'; }

async function signAsset(actor, body) {
  requireCapability(actor, 'edit');
  const candidateRow = await candidate(body.candidateId);
  const candidateId = candidateRow.id;
  const bucket = clean(body.bucket, 80);
  const assetRole = enumValue(body.assetRole, ASSET_ROLES, 'other');
  const mimeType = clean(body.mimeType, 120).toLowerCase();
  const byteSize = Math.max(0, Number(body.byteSize) || 0);
  if (!allowedMediaBucket(bucket) || !allowedMime(bucket, mimeType, assetRole)) { const e = new Error('자산 역할·저장소·파일 형식 조합이 허용되지 않습니다.'); e.statusCode = 400; throw e; }
  if (!byteSize || byteSize > maxUploadBytes()) { const e = new Error('시험용 비공개 업로드는 현재 ' + displayBytes(maxUploadBytes()) + ' 이하로 제한됩니다. 대형 원본은 외부 전달 경로로 등록하세요.'); e.statusCode = 400; throw e; }
  const assetId = sb.id('media_asset');
  const path = 'media/' + candidateId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) + '/' + assetId + '_' + safeFileName(body.fileName);
  const row = {
    id: assetId,
    candidate_id: candidateId,
    asset_role: assetRole,
    storage_mode: 'supabase_private',
    bucket,
    object_path: path,
    external_url: null,
    file_name: safeFileName(body.fileName),
    mime_type: mimeType,
    byte_size: byteSize,
    sha256: clean(body.sha256, 128) || null,
    duration_ms: Math.max(0, Number(body.durationMs) || 0) || null,
    width: Math.max(0, Number(body.width) || 0) || null,
    height: Math.max(0, Number(body.height) || 0) || null,
    language_tag: clean(body.languageTag, 24) || null,
    ingest_status: 'pending_upload',
    delivery_allowed: false,
    note: clean(body.note, 3000) || null,
    created_at: now(), updated_at: now(), updated_by: actor.sub
  };
  await sb.insert('gslot_media_assets', row, 'return=minimal');
  const signed = await sb.storageSignedUpload(bucket, path);
  await audit(actor, 'sign_media_asset_upload', 'media_asset', assetId, { candidateId, bucket, assetRole, byteSize });
  return { ok: true, asset: row, upload: signed, maxUploadBytes: maxUploadBytes() };
}

async function confirmAsset(actor, body) {
  requireCapability(actor, 'edit');
  const assetId = clean(body.assetId, 180);
  if (!assetId) { const e = new Error('확정할 영상 자산 ID가 필요합니다.'); e.statusCode = 400; throw e; }
  const assets = await sb.select('gslot_media_assets', 'select=*&id=eq.' + encodeURIComponent(assetId) + '&limit=1');
  const asset = (assets || [])[0];
  if (!asset) { const e = new Error('영상 자산을 찾지 못했습니다.'); e.statusCode = 404; throw e; }
  const next = enumValue(body.ingestStatus, INGEST_STATES, 'uploaded');
  if (!['uploaded','processing','ready','failed','blocked','retired'].includes(next)) { const e = new Error('업로드 확정에 사용할 수 없는 자산 상태입니다.'); e.statusCode = 400; throw e; }
  const patch = { ingest_status: next, sha256: clean(body.sha256, 128) || asset.sha256 || null, duration_ms: Math.max(0, Number(body.durationMs) || 0) || asset.duration_ms || null, width: Math.max(0, Number(body.width) || 0) || asset.width || null, height: Math.max(0, Number(body.height) || 0) || asset.height || null, language_tag: clean(body.languageTag, 24) || asset.language_tag || null, note: clean(body.note, 3000) || asset.note || null, updated_at: now(), updated_by: actor.sub };
  const rows = await sb.update('gslot_media_assets', 'id=eq.' + encodeURIComponent(assetId), patch);
  await audit(actor, 'confirm_media_asset', 'media_asset', assetId, { candidateId: asset.candidate_id, state: next });
  return { ok: true, row: (rows || [])[0] || Object.assign({}, asset, patch) };
}

async function saveExternalAsset(actor, body) {
  requireCapability(actor, 'edit');
  const candidateRow = await candidate(body.candidateId);
  const candidateId = candidateRow.id;
  const storageMode = enumValue(body.storageMode, new Set(['external_https','delivery_provider']), 'external_https');
  const assetRole = enumValue(body.assetRole, ASSET_ROLES, 'external_master');
  const externalUrl = safeUrl(body.externalUrl);
  if (!externalUrl) { const e = new Error('외부 공식 또는 전달 제공자 HTTPS URL이 필요합니다.'); e.statusCode = 400; throw e; }
  const row = {
    id: clean(body.id, 180) || sb.id('media_asset'), candidate_id: candidateId, asset_role: assetRole, storage_mode: storageMode,
    bucket: null, object_path: null, external_url: externalUrl, file_name: clean(body.fileName, 240) || null,
    mime_type: clean(body.mimeType, 120) || null, byte_size: Math.max(0, Number(body.byteSize) || 0) || null,
    sha256: clean(body.sha256, 128) || null, duration_ms: Math.max(0, Number(body.durationMs) || 0) || null,
    width: Math.max(0, Number(body.width) || 0) || null, height: Math.max(0, Number(body.height) || 0) || null,
    language_tag: clean(body.languageTag, 24) || null, ingest_status: 'external_ready', delivery_allowed: bool(body.deliveryAllowed),
    note: clean(body.note, 3000) || null, created_at: now(), updated_at: now(), updated_by: actor.sub
  };
  const rows = await sb.insert('gslot_media_assets', row, 'resolution=merge-duplicates,return=representation');
  await audit(actor, 'save_external_media_asset', 'media_asset', row.id, { candidateId, assetRole, storageMode, deliveryAllowed: row.delivery_allowed });
  return { ok: true, row: (rows || [row])[0] };
}

async function queueJob(actor, body) {
  requireCapability(actor, 'edit');
  const candidateRow = await candidate(body.candidateId);
  const candidateId = candidateRow.id;
  const jobType = enumValue(body.jobType, JOB_TYPES, 'probe_metadata');
  const assetId = clean(body.assetId, 180) || null;
  const row = { id: sb.id('media_job'), candidate_id: candidateId, asset_id: assetId, job_type: jobType, status: 'queued', request: body.request && typeof body.request === 'object' ? body.request : {}, result: { pipeline: 'not_connected' }, requested_by: actor.sub, created_at: now(), updated_at: now() };
  await sb.insert('gslot_media_jobs', row, 'return=minimal');
  await audit(actor, 'queue_media_job', 'media_job', row.id, { candidateId, jobType, pipelineConnected: false });
  return { ok: true, row, note: '처리 요청을 관리 원장에만 기록했습니다. 외부 워커·AI 처리·변환·프런트 전달은 아직 연결하지 않았습니다.' };
}

async function readiness(id) { const data = await detail(id); return { ok:true, candidate:data.candidate, readiness:data.readiness, profile:data.profile }; }

module.exports = { list, detail, saveProfile, saveRights, signAsset, confirmAsset, saveExternalAsset, queueJob, readiness, readinessOf, constants: { MEDIA_KINDS, WORKFLOW_STATES, RIGHTS_STATES, RIGHTS_BASIS, DELIVERY_MODES, ASSET_ROLES, STORAGE_MODES, INGEST_STATES, JOB_TYPES, JOB_STATES } };
