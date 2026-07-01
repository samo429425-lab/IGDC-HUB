'use strict';

/*
 * Media Hub stage 4 ad-decision gateway — hardened for catalog v2.
 *
 * The default is no advertisement. A decision is returned only after the title
 * itself passes the rights/delivery pilot gate and a first-party or contracted
 * creative has its own written approval, rights evidence, and HTTPS allowlist.
 * No third-party ad network, behavioural profile, or payment signal is used.
 */
const {
  allowedUrl,
  episodeItem,
  findItem,
  findSeriesEpisodeRecord,
  readCatalog,
  readDeliveryProfiles,
  text,
  validatePilotItem
} = require('./lib/media-catalog-policy');
const { authenticateMember } = require('./lib/media-member-auth');

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

function allowedHttps(url, hosts) {
  const raw = allowedUrl(url);
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    const allowed = Array.isArray(hosts) ? hosts.map((host) => text(host, 260).toLowerCase()).filter(Boolean) : [];
    return parsed.protocol === 'https:' && allowed.includes(parsed.hostname.toLowerCase()) ? parsed.toString() : '';
  } catch (_) { return ''; }
}

function isoDate(value) {
  const epoch = Date.parse(text(value, 80));
  return Number.isFinite(epoch) && epoch > 0 && epoch <= Date.now() + (24 * 60 * 60 * 1000) ? new Date(epoch).toISOString() : '';
}

function approvedCreative(record) {
  const policy = record && record.adPolicy && typeof record.adPolicy === 'object' ? record.adPolicy : null;
  if (!policy || policy.enabled !== true || policy.approved !== true) return null;
  const mode = text(policy.mode, 24).toLowerCase();
  const placement = text(policy.placement || 'preroll', 24).toLowerCase();
  const approvedAt = isoDate(policy.approvedAt);
  const approvedBy = text(policy.approvedBy, 160);
  const creative = policy.creative && typeof policy.creative === 'object' ? policy.creative : null;
  const rights = creative && creative.rights && typeof creative.rights === 'object' ? creative.rights : {};
  if (!creative || !['house', 'sponsored'].includes(mode) || placement !== 'preroll' || !approvedAt || !approvedBy) return null;
  if (text(rights.status, 40).toLowerCase() !== 'cleared' || !allowedUrl(rights.sourceUrl) || (!allowedUrl(rights.licenseUrl) && !allowedUrl(rights.evidenceUrl))) return null;

  const type = text(creative.type || creative.mediaType, 16).toLowerCase();
  const hosts = Array.isArray(policy.allowedHosts) ? policy.allowedHosts : [];
  const src = allowedHttps(creative.src || creative.url || creative.mediaUrl, hosts);
  const clickUrl = allowedHttps(creative.clickUrl || creative.href || '', hosts);
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
    const id = text(event.queryStringParameters && (event.queryStringParameters.id || event.queryStringParameters.contentId), 260);
    if (!id) return json(400, { ok: false, error: 'invalid_content_id' });
    const catalog = readCatalog();
    let record = findItem(catalog, id);
    let policyRecord = record;
    if (!record) {
      const match = findSeriesEpisodeRecord(catalog, id);
      if (!match) return json(404, { ok: false, error: 'ott_not_registered' });
      record = episodeItem(match.series, match.episode);
      // Episode policy overrides the parent series policy. Falling back to the
      // parent is deliberate only after the episode itself passes the gate.
      policyRecord = Object.assign({}, match.series, { adPolicy: record.adPolicy || match.series.adPolicy });
    }
    await authenticateMember(event);
    const validation = validatePilotItem(record, readDeliveryProfiles());
    if (!validation.ok) return json(409, { ok: false, error: 'content_not_ready' });
    const ad = approvedCreative(policyRecord);
    return json(200, { ok: true, decision: ad ? 'preroll' : 'none', ad: ad || null });
  } catch (error) {
    return json(error.statusCode || 500, { ok: false, error: error.code || 'media_ad_decision_failed', message: 'Unable to decide playback advertising.' });
  }
};
