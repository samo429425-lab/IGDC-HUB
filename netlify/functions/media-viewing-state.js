'use strict';

/*
 * Media Hub Stage 4 viewing-state gateway.
 *
 * The browser retains an immediately available local resume point. When the
 * existing Supabase server credentials and the shared igdc_social_events table
 * are available, the same state is also written under a verified member scope
 * so it can be restored on another signed-in device. This function never
 * fabricates a durable save when server storage is unavailable.
 */
const crypto = require('crypto');
const { authenticateMember, clean } = require('./lib/media-member-auth');

const VERSION = 'igdc-media-viewing-state.v1';
const TABLE = clean(process.env.MEDIA_VIEWING_STATE_TABLE || 'igdc_social_events') || 'igdc_social_events';
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

function parseBody(event) {
  try {
    const raw = event && event.body ? event.body : '';
    const value = event && event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    return value ? JSON.parse(value) : {};
  } catch (_) {
    return {};
  }
}

function contentId(value) {
  const id = clean(value);
  if (!id || id.length > MAX_CONTENT_ID || /[\u0000-\u001F<>"'`]/.test(id)) return '';
  return id;
}

function finite(value, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(number, maximum || MAX_POSITION);
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function boundedText(value, maximum) {
  return clean(value).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum || 500);
}

function sameOriginPath(value) {
  const path = boundedText(value, MAX_PAGE);
  return path.startsWith('/') && !path.startsWith('//') ? path.split('?')[0] : '';
}

function memberHash(memberId) {
  return crypto.createHash('sha256').update(clean(memberId)).digest('hex').slice(0, 40);
}

function eventId(memberId, id) {
  return 'media-watch-' + crypto.createHash('sha256').update(clean(memberId) + '|' + id).digest('hex').slice(0, 42);
}

function storageConfig() {
  const url = clean(process.env.SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

async function fetchCompat(url, init) {
  if (typeof fetch === 'function') return fetch(url, init);
  const module = await import('node-fetch');
  return module.default(url, init);
}

async function supabaseRequest(config, target, init) {
  const response = await fetchCompat(config.url + '/rest/v1/' + target, {
    method: init && init.method || 'GET',
    headers: Object.assign({
      'Content-Type': 'application/json',
      apikey: config.key,
      Authorization: 'Bearer ' + config.key
    }, init && init.headers || {}),
    body: init && init.body
  });
  const raw = await response.text();
  let value = null;
  try { value = raw ? JSON.parse(raw) : null; } catch (_) { value = raw; }
  if (!response.ok) {
    const message = boundedText(value && (value.message || value.error || value.hint) || raw || ('Supabase HTTP ' + response.status), 360);
    throw fail(502, 'viewing_state_storage_failed', message || 'Unable to store viewing state.');
  }
  return value;
}

function rowToState(row) {
  const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
  const id = contentId(payload.contentId || row && row.title);
  if (!id) return null;
  return {
    contentId: id,
    title: boundedText(payload.title || row && row.description || '', MAX_TITLE),
    positionSec: finite(payload.positionSec != null ? payload.positionSec : row && row.watch_time_sec, MAX_POSITION),
    durationSec: finite(payload.durationSec, MAX_POSITION),
    completed: bool(payload.completed),
    captionLanguage: boundedText(payload.captionLanguage, 32),
    updatedAt: boundedText(payload.updatedAt || row && (row.event_ts || row.created_at) || '', 80)
  };
}

async function loadState(config, member, id) {
  const key = eventId(member.memberId, id);
  const target = encodeURIComponent(TABLE) + '?select=event_id,event_ts,created_at,title,description,watch_time_sec,payload&event_id=eq.' + encodeURIComponent(key) + '&limit=1';
  const rows = await supabaseRequest(config, target, { method: 'GET', headers: { Prefer: '' } });
  return Array.isArray(rows) && rows[0] ? rowToState(rows[0]) : null;
}

async function loadHistory(config, member, limit) {
  const scope = 'media-watch-' + memberHash(member.memberId);
  const target = encodeURIComponent(TABLE) + '?select=event_id,event_ts,created_at,title,description,watch_time_sec,payload&section_key=eq.' + encodeURIComponent(scope) + '&event_type=eq.media_watch_state&order=event_ts.desc&limit=' + Math.max(1, Math.min(Number(limit) || 20, MAX_HISTORY));
  const rows = await supabaseRequest(config, target, { method: 'GET', headers: { Prefer: '' } });
  return (Array.isArray(rows) ? rows : []).map(rowToState).filter(Boolean);
}

async function saveState(config, member, state) {
  const id = state.contentId;
  const now = new Date().toISOString();
  const scope = 'media-watch-' + memberHash(member.memberId);
  const row = {
    page: state.page || '/',
    section_key: scope,
    event_type: 'media_watch_state',
    title: id,
    description: state.title || id,
    href: null,
    watch_time_sec: Math.round(state.positionSec * 1000) / 1000,
    event_id: eventId(member.memberId, id),
    event_ts: now,
    payload: {
      version: VERSION,
      contentId: id,
      title: state.title || id,
      positionSec: Math.round(state.positionSec * 1000) / 1000,
      durationSec: Math.round(state.durationSec * 1000) / 1000,
      completed: Boolean(state.completed),
      captionLanguage: state.captionLanguage || '',
      updatedAt: now
    },
    created_at: now
  };
  const target = encodeURIComponent(TABLE) + '?on_conflict=event_id';
  const result = await supabaseRequest(config, target, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row)
  });
  const saved = Array.isArray(result) && result[0] ? rowToState(result[0]) : Object.assign({}, state, { updatedAt: now });
  return saved;
}

function requestValue(event, body, key) {
  return clean(body && body[key] != null ? body[key] : event && event.queryStringParameters && event.queryStringParameters[key]);
}

function buildState(event, body) {
  const id = contentId(requestValue(event, body, 'contentId') || requestValue(event, body, 'id'));
  if (!id) throw fail(400, 'invalid_content_id', 'A valid content id is required.');
  const positionSec = finite(body && body.positionSec, MAX_POSITION);
  const durationSec = finite(body && body.durationSec, MAX_POSITION);
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  try {
    const member = await authenticateMember(event);
    const config = storageConfig();
    const body = event.httpMethod === 'POST' ? parseBody(event) : {};
    const wantsHistory = event.httpMethod === 'GET' && requestValue(event, body, 'history') === '1';

    if (!config) {
      if (event.httpMethod === 'POST') {
        const state = buildState(event, body);
        return json(200, { ok: true, persistence: 'local_only', stored: false, state, warning: 'Durable viewing-state storage is not configured.' });
      }
      return json(200, { ok: true, persistence: 'local_only', state: null, history: wantsHistory ? [] : undefined, warning: 'Durable viewing-state storage is not configured.' });
    }

    if (event.httpMethod === 'POST') {
      const state = await saveState(config, member, buildState(event, body));
      return json(200, { ok: true, persistence: 'server', stored: true, state });
    }

    if (wantsHistory) {
      return json(200, { ok: true, persistence: 'server', history: await loadHistory(config, member, requestValue(event, body, 'limit')) });
    }

    const id = contentId(requestValue(event, body, 'contentId') || requestValue(event, body, 'id'));
    if (!id) throw fail(400, 'invalid_content_id', 'A valid content id is required.');
    return json(200, { ok: true, persistence: 'server', state: await loadState(config, member, id) });
  } catch (error) {
    return json(error.statusCode || 500, {
      ok: false,
      error: error.code || 'viewing_state_failed',
      message: boundedText(error.message || 'Unable to access viewing state.', 360)
    });
  }
};
