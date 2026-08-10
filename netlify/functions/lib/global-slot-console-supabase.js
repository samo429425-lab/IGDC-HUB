'use strict';

const crypto = require('crypto');

const PUBLICATION_STATUS_COMPAT_VERSION = 'gslot-publication-status-compat-v1.0.0';

function clean(value) { return String(value == null ? '' : value).trim(); }

function config() {
  const url = clean(process.env.GSLOT_SUPABASE_URL).replace(/\/+$/, '');
  const serviceKey = clean(process.env.GSLOT_SUPABASE_SECRET_KEY || process.env.GSLOT_SUPABASE_SERVICE_ROLE_KEY || process.env.GSLOT_SUPABASE_SERVICE_KEY);
  if (!url || !serviceKey) {
    const error = new Error('관리 DB가 아직 연결되지 않았습니다. Netlify 환경변수 GSLOT_SUPABASE_URL 및 GSLOT_SUPABASE_SECRET_KEY를 설정하세요.');
    error.statusCode = 503;
    throw error;
  }
  return { url, serviceKey };
}

function isAssignmentPath(value) {
  return /^\/rest\/v1\/gslot_slot_assignments(?:\?|$)/.test(String(value || ''));
}

function normalizeAssignmentStatusForWrite(value, method) {
  const status = clean(value).toLowerCase();
  const verb = clean(method).toUpperCase();
  // The deployed Global Slot registry uses its established four-state DB
  // contract: not_ready / ready / published / failed.  Newer commerce modules
  // use richer in-memory names.  Translate only at the persistence boundary so
  // no database migration or core-engine replacement is required.
  if (status === 'audit_ready') return verb === 'PATCH' ? 'not_ready' : 'ready';
  if (status === 'publish_requested') return 'published';
  if (status === 'unpublish_requested') return 'not_ready';
  return value;
}

function normalizeAssignmentWriteBody(path, init) {
  if (!isAssignmentPath(path) || !init || init.body == null) return init;
  let parsed;
  try { parsed = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; }
  catch (_) { return init; }
  const method = clean(init.method || 'GET').toUpperCase();
  const normalize = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const copy = Object.assign({}, row);
    if (Object.prototype.hasOwnProperty.call(copy, 'publication_status')) {
      copy.publication_status = normalizeAssignmentStatusForWrite(copy.publication_status, method);
    }
    return copy;
  };
  const body = Array.isArray(parsed) ? parsed.map(normalize) : normalize(parsed);
  return Object.assign({}, init, { body: JSON.stringify(body) });
}

function normalizeAssignmentReadBody(path, body) {
  if (!isAssignmentPath(path)) return body;
  const normalize = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const copy = Object.assign({}, row);
    // "published" is the persistent active/front-matched state.  Existing
    // commerce modules call that state "publish_requested" until a build has
    // regenerated and verified the SearchBank/front snapshots.
    const storedStatus = clean(copy.publication_status).toLowerCase();
    if (storedStatus === 'published') {
      copy.publication_status = 'publish_requested';
    } else if (storedStatus === 'not_ready') {
      // Read-side counterpart of normalizeAssignmentStatusForWrite().
      // The deployed DB stores the in-memory audit_ready state as not_ready
      // when an assignment is unpublished.  Without this reverse mapping, a
      // correctly preserved PSOM assignment disappears from Registry/Go-Live
      // reads after "전체 매칭 해제", even though the row still exists.
      copy.publication_status = 'audit_ready';
    }
    return copy;
  };
  return Array.isArray(body) ? body.map(normalize) : normalize(body);
}

async function request(path, init) {
  const cfg = config();
  const baseHeaders = {
    apikey: cfg.serviceKey,
    Authorization: 'Bearer ' + cfg.serviceKey,
    'Content-Type': 'application/json'
  };
  // Per-call headers such as Prefer must be added without discarding the
  // service-role headers required by Supabase REST and Storage APIs.
  let options = Object.assign({}, init || {});
  options = normalizeAssignmentWriteBody(path, options);
  options.headers = Object.assign({}, (options && options.headers) || {}, baseHeaders);
  const response = await fetch(cfg.url + path, options);
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = raw; }
  if (!response.ok) {
    const error = new Error((body && body.message) || (body && body.error_description) || (body && body.error) || raw || ('Supabase HTTP ' + response.status));
    error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }
  return normalizeAssignmentReadBody(path, body);
}

function rest(table, query) {
  return '/rest/v1/' + encodeURIComponent(table) + (query ? '?' + query : '');
}

async function select(table, query) {
  return request(rest(table, query), { method: 'GET', headers: { Prefer: 'count=exact' } });
}

async function insert(table, rows, prefer) {
  return request(rest(table), {
    method: 'POST',
    headers: { Prefer: prefer || 'return=representation' },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows])
  });
}

async function update(table, query, patch, prefer) {
  return request(rest(table, query), {
    method: 'PATCH',
    headers: { Prefer: prefer || 'return=representation' },
    body: JSON.stringify(patch || {})
  });
}

async function remove(table, query) {
  return request(rest(table, query), { method: 'DELETE', headers: { Prefer: 'return=representation' } });
}

async function storageSignedUpload(bucket, fileName) {
  const safeBucket = clean(bucket).replace(/[^a-z0-9_-]/gi, '');
  const safeName = clean(fileName).replace(/^\/+/, '').replace(/\.\.+/g, '.');
  if (!safeBucket || !safeName) {
    const error = new Error('업로드 경로가 올바르지 않습니다.');
    error.statusCode = 400;
    throw error;
  }
  const body = await request('/storage/v1/object/upload/sign/' + encodeURIComponent(safeBucket), {
    method: 'POST', body: JSON.stringify({ name: safeName })
  });
  const cfg = config();
  const relative = body && (body.url || body.signedURL || body.signedUrl);
  if (!relative) throw new Error('서명 업로드 URL을 만들지 못했습니다.');
  return { bucket: safeBucket, path: safeName, uploadUrl: /^https?:\/\//i.test(relative) ? relative : cfg.url + '/storage/v1' + relative, token: body.token || null };
}

function id(prefix) {
  return String(prefix || 'gslot') + '_' + crypto.randomBytes(12).toString('hex');
}

module.exports = {
  config, request, rest, select, insert, update, remove, storageSignedUpload, id,
  PUBLICATION_STATUS_COMPAT_VERSION,
  normalizeAssignmentStatusForWrite,
  normalizeAssignmentWriteBody,
  normalizeAssignmentReadBody
};
