'use strict';

/*
 * Media Hub stage 4 viewing-state gateway — hardened.
 *
 * Local browser resume is always available. Cross-device state is deliberately
 * dormant until an operator explicitly enables a dedicated Supabase table using
 * MEDIA_VIEWING_STATE_ENABLED=true and MEDIA_VIEWING_STATE_TABLE. This avoids
 * silently writing into an unrelated legacy table or pretending that durable
 * storage is active before its contract is verified.
 */
const crypto = require('crypto');
const { authenticateMember, clean } = require('./lib/media-member-auth');

const VERSION = 'igdc-media-viewing-state.v1';
const MAX_CONTENT_ID = 260;
const MAX_TITLE = 300;
const MAX_PAGE = 320;
const MAX_POSITION = 60 * 60 * 24 * 365;
const MAX_HISTORY = 50;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body || {})
  };
}

function fail(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function enabled(value) { return /^(1|true|yes)$/i.test(clean(value)); }
function tableName(value) { const name = clean(value); return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : ''; }
function boundedText(value, maximum) { return clean(value).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum || 500); }
function contentId(value) { const id = clean(value); return id && id.length <= MAX_CONTENT_ID && !/[\u0000-\u001F<>"'`]/.test(id) ? id : ''; }
function finite(value, maximum) { const number = Number(value); return !Number.isFinite(number) || number < 0 ? 0 : Math.min(number, maximum || MAX_POSITION); }
function bool(value) { return value === true || value === 1 || value === '1' || value === 'true'; }
function sameOriginPath(value) { const path = boundedText(value, MAX_PAGE); return path.startsWith('/') && !path.startsWith('//') ? path.split('?')[0] : ''; }

function parseBody(event) {
  try {
    const raw = event && event.body ? event.body : '';
    const body = event && event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    return body ? JSON.parse(body) : {};
  } catch (_) { return {}; }
}

function storageConfig() {
  if (!enabled(process.env.MEDIA_VIEWING_STATE_ENABLED)) return null;
  const url = clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
  const table = tableName(process.env.MEDIA_VIEWING_STATE_TABLE);
  return url && key && table ? { url, key, table } : null;
}

async function fetchCompat(url, init) {
  if (typeof fetch === 'function') return fetch(url, init);
  return require('node-fetch')(url, init);
}

function memberHash(memberId) { return crypto.createHash('sha256').update(clean(memberId)).digest('hex').slice(0, 40); }
function rowId(memberId, id) { return crypto.createHash('sha256').update(clean(memberId) + '|' + id).digest('hex').slice(0, 56); }

async function supabaseRequest(config, target, init) {
  let response;
  try {
    response = await fetchCompat(config.url + '/rest/v1/' + target, {
      method: init && init.method || 'GET',
      headers: Object.assign({
        'Content-Type': 'application/json',
        apikey: config.key,
        Authorization: 'Bearer ' + config.key
      }, init && init.headers || {}),
      body: init && init.body
    });
  } catch (_) {
    throw fail(502, 'viewing_state_storage_unavailable', 'Viewing-state storage is unavailable.');
  }
  const raw = await response.text().catch(() => '');
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch (_) { payload = null; }
  if (!response.ok) throw fail(502, 'viewing_state_storage_failed', 'Viewing-state storage is unavailable.');
  return payload;
}

function rowToState(row) {
  if (!row || typeof row !== 'object') return null;
  const id = contentId(row.content_id || row.contentId);
  if (!id) return null;
  return {
    contentId: id,
    title: boundedText(row.title, MAX_TITLE),
    positionSec: finite(row.position_sec != null ? row.position_sec : row.positionSec, MAX_POSITION),
    durationSec: finite(row.duration_sec != null ? row.duration_sec : row.durationSec, MAX_POSITION),
    completed: bool(row.completed),
    captionLanguage: boundedText(row.caption_language != null ? row.caption_language : row.captionLanguage, 32),
    updatedAt: boundedText(row.updated_at || row.updatedAt || '', 80)
  };
}

function buildState(event, body) {
  const id = contentId(body && (body.contentId || body.id) || event && event.queryStringParameters && (event.queryStringParameters.contentId || event.queryStringParameters.id));
  if (!id) throw fail(400, 'invalid_content_id', 'A valid content id is required.');
  const durationSec = finite(body && body.durationSec, MAX_POSITION);
  const positionSec = finite(body && body.positionSec, MAX_POSITION);
  return {
    contentId: id,
    title: boundedText(body && body.title, MAX_TITLE),
    page: sameOriginPath(body && body.page) || '/',
    positionSec: durationSec && positionSec > durationSec ? durationSec : positionSec,
    durationSec,
    completed: bool(body && body.completed),
    captionLanguage: boundedText(body && body.captionLanguage, 32)
  };
}

async function loadState(config, member, id) {
  const key = rowId(member.memberId, id);
  const target = encodeURIComponent(config.table) + '?select=content_id,title,position_sec,duration_sec,completed,caption_language,updated_at&id=eq.' + encodeURIComponent(key) + '&limit=1';
  const rows = await supabaseRequest(config, target, { method: 'GET' });
  return Array.isArray(rows) && rows.length ? rowToState(rows[0]) : null;
}

async function loadHistory(config, member, limit) {
  const scope = memberHash(member.memberId);
  const cap = Math.max(1, Math.min(Number(limit) || 20, MAX_HISTORY));
  const target = encodeURIComponent(config.table) + '?select=content_id,title,position_sec,duration_sec,completed,caption_language,updated_at&member_hash=eq.' + encodeURIComponent(scope) + '&order=updated_at.desc&limit=' + cap;
  const rows = await supabaseRequest(config, target, { method: 'GET' });
  return (Array.isArray(rows) ? rows : []).map(rowToState).filter(Boolean);
}

async function saveState(config, member, state) {
  const now = new Date().toISOString();
  const row = {
    id: rowId(member.memberId, state.contentId),
    member_hash: memberHash(member.memberId),
    content_id: state.contentId,
    title: state.title || state.contentId,
    page_path: state.page || '/',
    position_sec: Math.round(state.positionSec * 1000) / 1000,
    duration_sec: Math.round(state.durationSec * 1000) / 1000,
    completed: Boolean(state.completed),
    caption_language: state.captionLanguage || '',
    record_version: VERSION,
    updated_at: now
  };
  const target = encodeURIComponent(config.table) + '?on_conflict=id';
  const saved = await supabaseRequest(config, target, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row])
  });
  return Array.isArray(saved) && saved.length ? rowToState(saved[0]) : Object.assign({}, state, { updatedAt: now });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const member = await authenticateMember(event);
    const config = storageConfig();
    const body = event.httpMethod === 'POST' ? parseBody(event) : {};
    const wantsHistory = event.httpMethod === 'GET' && clean(event.queryStringParameters && event.queryStringParameters.history) === '1';
    if (!config) {
      const state = event.httpMethod === 'POST' ? buildState(event, body) : null;
      return json(200, { ok: true, persistence: 'local_only', stored: false, state, history: wantsHistory ? [] : undefined, warning: 'Durable viewing-state storage is not enabled.' });
    }
    if (event.httpMethod === 'POST') return json(200, { ok: true, persistence: 'server', stored: true, state: await saveState(config, member, buildState(event, body)) });
    if (wantsHistory) return json(200, { ok: true, persistence: 'server', history: await loadHistory(config, member, event.queryStringParameters && event.queryStringParameters.limit) });
    const id = contentId(event.queryStringParameters && (event.queryStringParameters.contentId || event.queryStringParameters.id));
    if (!id) throw fail(400, 'invalid_content_id', 'A valid content id is required.');
    return json(200, { ok: true, persistence: 'server', state: await loadState(config, member, id) });
  } catch (error) {
    return json(error.statusCode || 500, { ok: false, error: error.code || 'viewing_state_failed', message: 'Unable to access viewing state.' });
  }
};
