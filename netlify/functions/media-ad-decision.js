'use strict';

/*
 * Media Hub Stage 4 ad-decision gateway.
 *
 * Only an explicitly approved first-party/contracted creative declared in the
 * secure media catalog can be returned. The default for every title is no ad.
 * There is no third-party ad-network call, user profiling, or payment logic.
 */
const fs = require('fs');
const path = require('path');
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

function contentId(value) {
  const id = clean(value);
  if (!id || id.length > MAX_CONTENT_ID_LENGTH || /[\u0000-\u001F<>"'`]/.test(id)) return '';
  return id;
}

function text(value, maximum) {
  return clean(value).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum || 500);
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

function catalogRecord(catalog, id) {
  const items = catalog && catalog.items;
  if (Array.isArray(items)) return items.find((item) => contentId(item && (item.contentId || item.id)) === id) || null;
  if (items && typeof items === 'object') {
    const direct = items[id];
    if (direct && typeof direct === 'object') return Object.assign({}, direct, { contentId: contentId(direct.contentId || id) });
    return Object.values(items).find((item) => item && contentId(item.contentId || item.id) === id) || null;
  }
  return null;
}

function allowedUrl(value) {
  const raw = text(value, 4000);
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function pilotReady(record) {
  const status = text(record && record.status, 40).toLowerCase();
  const rights = text(record && (record.rightsStatus || record.rights && record.rights.status), 40).toLowerCase();
  return status === 'ready' && rights === 'cleared';
}

function approvedCreative(record) {
  const policy = record && (record.adPolicy || record.ad || record.advertising);
  if (!policy || typeof policy !== 'object') return null;
  const mode = text(policy.mode || policy.type, 24).toLowerCase();
  const placement = text(policy.placement || 'preroll', 24).toLowerCase();
  const approved = policy.approved === true || text(policy.status, 24).toLowerCase() === 'approved';
  if (!approved || !['house', 'sponsored'].includes(mode) || placement !== 'preroll') return null;

  const creative = policy.creative && typeof policy.creative === 'object' ? policy.creative : policy;
  const type = text(creative.type || creative.mediaType, 16).toLowerCase();
  const src = allowedUrl(creative.src || creative.url || creative.mediaUrl);
  const clickUrl = allowedUrl(creative.clickUrl || creative.href || '');
  const label = text(creative.label || policy.label || (mode === 'house' ? 'IGDC notice' : 'Sponsored message'), 120);
  const durationSec = Math.max(1, Math.min(Number(creative.durationSec || policy.durationSec || 0) || 0, 60));
  const skipAfterSec = Math.max(0, Math.min(Number(creative.skipAfterSec || policy.skipAfterSec || durationSec) || durationSec, durationSec));
  if (!src || !['video', 'image'].includes(type) || !durationSec) return null;
  return { mode, placement: 'preroll', type, src, clickUrl, label, durationSec, skipAfterSec };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const id = contentId(event.queryStringParameters && (event.queryStringParameters.id || event.queryStringParameters.contentId));
    if (!id) return json(400, { ok: false, error: 'invalid_content_id' });
    const record = catalogRecord(readCatalog(), id);
    if (!record || !pilotReady(record)) return json(404, { ok: false, error: 'ott_not_registered' });
    await authenticateMember(event);
    const ad = approvedCreative(record);
    return json(200, { ok: true, decision: ad ? 'preroll' : 'none', ad: ad || null });
  } catch (error) {
    return json(error.statusCode || 500, {
      ok: false,
      error: error.code || 'media_ad_decision_failed',
      message: text(error.message || 'Unable to decide playback advertising.', 360)
    });
  }
};
