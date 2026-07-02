'use strict';

const crypto = require('crypto');

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

async function request(path, init) {
  const cfg = config();
  const baseHeaders = {
    apikey: cfg.serviceKey,
    Authorization: 'Bearer ' + cfg.serviceKey,
    'Content-Type': 'application/json'
  };
  // Per-call headers such as Prefer must be added without discarding the
  // service-role headers required by Supabase REST and Storage APIs.
  const options = Object.assign({}, init || {});
  options.headers = Object.assign({}, (init && init.headers) || {}, baseHeaders);
  const response = await fetch(cfg.url + path, options);
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = raw; }
  if (!response.ok) {
    const error = new Error((body && body.message) || (body && body.error_description) || (body && body.error) || raw || ('Supabase HTTP ' + response.status));
    error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }
  return body;
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

module.exports = { config, request, rest, select, insert, update, remove, storageSignedUpload, id };
