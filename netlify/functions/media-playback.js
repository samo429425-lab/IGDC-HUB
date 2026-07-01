'use strict';

/*
 * Media Hub playback gateway — stages 2–10.
 *
 * A registered title is authenticated, rights/delivery-validated, and then
 * access-evaluated before any stream URL is resolved. Unregistered cards keep
 * the original inline player path. PG execution remains outside this endpoint:
 * only a verified entitlement can open a paid delivery path.
 */
const crypto = require('crypto');
const {
  contentId,
  episodeItem,
  findItem,
  findSeriesEpisode,
  isSeriesItem,
  publicContent,
  publicSeries,
  readCatalog,
  readDeliveryProfiles,
  text,
  validatePilotItem,
  validatePilotSeries
} = require('./lib/media-catalog-policy');
const { resolveDelivery } = require('./lib/media-delivery');
const { authenticateMember } = require('./lib/media-member-auth');
const { evaluateMediaAccess } = require('./lib/media-access-service');

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
function viewerKey(memberId) {
  return crypto.createHash('sha256').update(text(memberId, 500)).digest('hex').slice(0, 32);
}
function identity(member) {
  return { viewer: { member: true, key: viewerKey(member.memberId), roles: member.roles } };
}
function query(event, name) { return contentId(event && event.queryStringParameters && event.queryStringParameters[name]); }
function accessDenied(member, decision) {
  return json(decision.httpStatus || 403, Object.assign({
    ok: false,
    error: decision.code || 'media_access_required',
    access: decision,
    payment: decision.payment || null
  }, identity(member)));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const id = query(event, 'id') || query(event, 'contentId');
    const requestedEpisodeId = query(event, 'episode') || query(event, 'episodeId');
    if (!id) return json(400, { ok: false, error: 'invalid_content_id' });

    const catalog = readCatalog();
    const record = findItem(catalog, id);
    // Preserve the original inline player for every card not explicitly
    // enrolled in the OTT catalog.
    if (!record) return json(404, { ok: false, error: 'ott_not_registered' });

    const member = await authenticateMember(event);
    const profiles = readDeliveryProfiles();

    if (isSeriesItem(record)) {
      const seriesValidation = validatePilotSeries(record, profiles);
      if (!seriesValidation.ok) return json(409, { ok: false, error: 'content_not_ready' });
      const seriesAccess = await evaluateMediaAccess(member, record, { contentId: seriesValidation.contentId, rootContentId: seriesValidation.contentId });
      if (!seriesAccess.allowed) return accessDenied(member, seriesAccess);
      const series = publicSeries(seriesValidation, profiles);
      if (!series.seasons.length) return json(409, { ok: false, error: 'content_not_ready' });

      if (!requestedEpisodeId) {
        return json(200, Object.assign({
          ok: true,
          stage: 'member_series',
          mode: 'series',
          series,
          access: seriesAccess
        }, identity(member)));
      }

      const episode = findSeriesEpisode(record, requestedEpisodeId);
      if (!episode) return json(404, { ok: false, error: 'episode_not_found' });
      const episodeRecord = episodeItem(record, episode);
      const episodeValidation = validatePilotItem(episodeRecord, profiles);
      if (!episodeValidation.ok) return json(409, { ok: false, error: 'episode_not_ready' });
      const episodeAccess = await evaluateMediaAccess(member, episodeRecord, {
        contentId: episodeValidation.contentId,
        rootContentId: seriesValidation.contentId,
        seriesId: seriesValidation.contentId
      });
      if (!episodeAccess.allowed) return accessDenied(member, episodeAccess);
      const stream = await resolveDelivery(episodeValidation, member);
      return json(200, Object.assign({
        ok: true,
        stage: 'member_playback',
        mode: 'episode',
        series: Object.assign({}, series, { selectedEpisodeId: episodeValidation.contentId }),
        access: episodeAccess,
        content: Object.assign(publicContent(episodeValidation, stream), {
          episodeNumber: episode.episodeNumber,
          seasonNumber: episode.seasonNumber,
          seasonTitle: episode.seasonTitle || ''
        })
      }, identity(member)));
    }

    if (requestedEpisodeId) return json(400, { ok: false, error: 'episode_parameter_not_allowed' });
    const validation = validatePilotItem(record, profiles);
    if (!validation.ok) return json(409, { ok: false, error: 'content_not_ready' });
    const access = await evaluateMediaAccess(member, record, { contentId: validation.contentId, rootContentId: validation.contentId });
    if (!access.allowed) return accessDenied(member, access);

    const stream = await resolveDelivery(validation, member);
    return json(200, Object.assign({
      ok: true,
      stage: 'member_playback',
      mode: 'single',
      access,
      content: publicContent(validation, stream)
    }, identity(member)));
  } catch (error) {
    return json(error.statusCode || 500, {
      ok: false,
      error: error.code || 'media_playback_failed',
      message: text(error.message || 'Unable to prepare member playback.', 360)
    });
  }
};
