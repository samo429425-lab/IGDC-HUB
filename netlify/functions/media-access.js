'use strict';

/* Member-facing Media Access status endpoint — stages 7–10. */
const { findItem, findSeriesEpisodeRecord, contentId, text } = require('./lib/media-catalog-policy');
const { authenticateMember } = require('./lib/media-member-auth');
const { evaluateMediaAccess, memberAccessSummary } = require('./lib/media-access-service');
const { readCatalog } = require('./lib/media-catalog-policy');

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
function requestedId(event) { return contentId(event && event.queryStringParameters && (event.queryStringParameters.contentId || event.queryStringParameters.id)); }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const member = await authenticateMember(event);
    const id = requestedId(event);
    if (!id) return json(200, await memberAccessSummary(member));
    const catalog = readCatalog();
    const record = findItem(catalog, id);
    if (record) {
      const access = await evaluateMediaAccess(member, record, { contentId: id, rootContentId: id });
      return json(200, { ok: true, version: 'media.access.v1', contentId: id, access, payment: access.payment });
    }
    const episodeRecord = findSeriesEpisodeRecord(catalog, id);
    if (episodeRecord) {
      const access = await evaluateMediaAccess(member, require('./lib/media-catalog-policy').episodeItem(episodeRecord.series, episodeRecord.episode), {
        contentId: id,
        rootContentId: contentId(episodeRecord.series.contentId || episodeRecord.series.id),
        seriesId: contentId(episodeRecord.series.contentId || episodeRecord.series.id)
      });
      return json(200, { ok: true, version: 'media.access.v1', contentId: id, access, payment: access.payment });
    }
    return json(404, { ok: false, error: 'ott_not_registered' });
  } catch (error) {
    return json(error.statusCode || 500, { ok: false, error: error.code || 'media_access_failed', message: text(error.message || 'Unable to load media access.', 360) });
  }
};
