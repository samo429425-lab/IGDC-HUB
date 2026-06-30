'use strict';

/*
 * Media Hub pilot playback metadata gateway — stages 2–4
 *
 * Delivery URLs are read only from netlify/functions/secure/media-catalog.json.
 * A content record must be explicitly marked ready and rights-cleared before a
 * verified existing IGDC member receives any stream metadata. Stage 4 adds
 * optional caption-track metadata only; advertising and viewing-state decisions
 * remain separate authenticated server contracts. There is no PG, subtitle
 * generation, translation, or dubbing in this browser OTT path.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authenticateMember, clean } = require('./lib/media-member-auth');

const MAX_CONTENT_ID_LENGTH = 260;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body || {})
  };
}
function readCatalog() {
  const locations = [
    path.join(__dirname, 'secure', 'media-catalog.json'),
    path.join(process.cwd(), 'netlify', 'functions', 'secure', 'media-catalog.json')
  ];
  for (const file of locations) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
  }
  return { items: {} };
}
function contentId(value) {
  const id = clean(value);
  if (!id || id.length > MAX_CONTENT_ID_LENGTH || /[\u0000-\u001F<>"'`]/.test(id)) return '';
  return id;
}
function catalogRecord(catalog, id) {
  const items = catalog && catalog.items;
  if (Array.isArray(items)) return items.find((item) => contentId(item && (item.contentId || item.id)) === id) || null;
  if (items && typeof items === 'object') {
    const direct = items[id];
    if (direct && typeof direct === 'object') return { ...direct, contentId: contentId(direct.contentId || id) };
    return Object.values(items).find((item) => item && contentId(item.contentId || item.id) === id) || null;
  }
  return null;
}
function allowedUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch (_) {
    return '';
  }
}
function text(value, limit) { return clean(value).slice(0, limit || 5000); }
function language(value) {
  const raw = text(value, 48).toLowerCase().replace(/_/g, '-');
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,12})?$/i.test(raw) ? raw : '';
}
function captionTracks(record, delivery) {
  const raw = (record && (record.captions || record.subtitleTracks || record.tracks)) ||
    (delivery && (delivery.captions || delivery.subtitleTracks || delivery.tracks)) || [];
  const rows = Array.isArray(raw) ? raw : Object.values(raw && typeof raw === 'object' ? raw : {});
  const seen = new Set();
  const out = [];
  for (const item of rows.slice(0, 30)) {
    if (!item || typeof item !== 'object') continue;
    const src = allowedUrl(item.src || item.url || item.href || item.vttUrl);
    const lang = language(item.language || item.lang || item.srclang);
    const kind = text(item.kind || 'subtitles', 20).toLowerCase();
    if (!src || !lang || !['subtitles', 'captions'].includes(kind)) continue;
    const key = lang + '|' + src;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: text(item.id || lang, 80).replace(/[^a-z0-9._-]/gi, '') || lang,
      language: lang,
      label: text(item.label || item.name || lang, 120) || lang,
      kind,
      src,
      default: item.default === true || item.isDefault === true
    });
  }
  return out;
}
function viewerKey(memberId) {
  return crypto.createHash('sha256').update(text(memberId, 500)).digest('hex').slice(0, 32);
}
function isReadyForPilot(record) {
  const status = text(record && record.status, 40).toLowerCase();
  const rights = text(record && (record.rightsStatus || (record.rights && record.rights.status)), 40).toLowerCase();
  return status === 'ready' && rights === 'cleared';
}
function buildContent(record, id) {
  const delivery = record && (record.delivery || record.stream || record);
  const streamUrl = allowedUrl(delivery && (delivery.url || delivery.streamUrl || delivery.manifestUrl));
  if (!streamUrl) return null;
  const format = text(delivery && (delivery.format || delivery.type || delivery.protocol), 24).toLowerCase() ||
    (streamUrl.toLowerCase().includes('.webm') ? 'webm' : streamUrl.toLowerCase().includes('.m3u8') ? 'hls' : 'mp4');
  return {
    contentId: id,
    title: text(record.title || record.name || id, 300),
    description: text(record.description || record.summary || '', 4000),
    posterUrl: allowedUrl(record.posterUrl || record.poster || record.thumbnail),
    stream: { format, url: streamUrl },
    captions: captionTracks(record, delivery)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const id = contentId(event.queryStringParameters && (event.queryStringParameters.id || event.queryStringParameters.contentId));
    if (!id) return json(400, { ok: false, error: 'invalid_content_id' });

    const record = catalogRecord(readCatalog(), id);
    // Preserve the pre-existing inline player for every card not explicitly
    // enrolled in the OTT pilot catalog.
    if (!record) return json(404, { ok: false, error: 'ott_not_registered' });
    if (!isReadyForPilot(record)) return json(409, { ok: false, error: 'content_not_ready' });

    const content = buildContent(record, id);
    if (!content) return json(409, { ok: false, error: 'content_not_ready' });

    const member = await authenticateMember(event);
    return json(200, {
      ok: true,
      stage: 'pilot_member_playback',
      viewer: { member: true, key: viewerKey(member.memberId), roles: member.roles },
      access: { mode: 'pilot_member_free', memberOnly: true, paymentRequired: false, noticeRequired: true },
      content
    });
  } catch (error) {
    return json(error.statusCode || 500, {
      ok: false,
      error: error.code || 'media_playback_failed',
      message: error.message || 'Unable to prepare pilot playback.'
    });
  }
};
