'use strict';

/*
 * Media Hub pilot playback metadata gateway — stages 2–6 + series.
 *
 * A series card opens an in-page season/episode browser. It never receives a
 * delivery URL. An individual episode receives a delivery URL only after its
 * own rights, pilot, and delivery validation passes for a verified member.
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

function access(member) {
  return {
    viewer: { member: true, key: viewerKey(member.memberId), roles: member.roles },
    access: { mode: 'pilot_member_free', memberOnly: true, paymentRequired: false, noticeRequired: true }
  };
}

function query(event, name) {
  return contentId(event && event.queryStringParameters && event.queryStringParameters[name]);
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
    // enrolled in the OTT pilot catalog.
    if (!record) return json(404, { ok: false, error: 'ott_not_registered' });

    // A registered OTT item remains member-only, including a series whose
    // episodes may still be incomplete. Unregistered cards fall through above.
    const member = await authenticateMember(event);
    const profiles = readDeliveryProfiles();
    const identity = access(member);

    if (isSeriesItem(record)) {
      const seriesValidation = validatePilotSeries(record, profiles);
      if (!seriesValidation.ok) return json(409, { ok: false, error: 'content_not_ready' });
      const series = publicSeries(seriesValidation, profiles);
      if (!series.seasons.length) return json(409, { ok: false, error: 'content_not_ready' });

      if (!requestedEpisodeId) {
        return json(200, Object.assign({
          ok: true,
          stage: 'pilot_member_series',
          mode: 'series',
          series
        }, identity));
      }

      const episode = findSeriesEpisode(record, requestedEpisodeId);
      if (!episode) return json(404, { ok: false, error: 'episode_not_found' });
      const episodeValidation = validatePilotItem(episodeItem(record, episode), profiles);
      if (!episodeValidation.ok) return json(409, { ok: false, error: 'episode_not_ready' });
      const stream = await resolveDelivery(episodeValidation, member);
      return json(200, Object.assign({
        ok: true,
        stage: 'pilot_member_playback',
        mode: 'episode',
        series: Object.assign({}, series, { selectedEpisodeId: episodeValidation.contentId }),
        content: Object.assign(publicContent(episodeValidation, stream), {
          episodeNumber: episode.episodeNumber,
          seasonNumber: episode.seasonNumber,
          seasonTitle: episode.seasonTitle || ''
        })
      }, identity));
    }

    if (requestedEpisodeId) return json(400, { ok: false, error: 'episode_parameter_not_allowed' });
    const validation = validatePilotItem(record, profiles);
    if (!validation.ok) return json(409, { ok: false, error: 'content_not_ready' });

    const stream = await resolveDelivery(validation, member);
    return json(200, Object.assign({
      ok: true,
      stage: 'pilot_member_playback',
      mode: 'single',
      content: publicContent(validation, stream)
    }, identity));
  } catch (error) {
    return json(error.statusCode || 500, {
      ok: false,
      error: error.code || 'media_playback_failed',
      message: text(error.message || 'Unable to prepare pilot playback.', 360)
    });
  }
};
