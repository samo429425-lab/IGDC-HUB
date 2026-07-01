'use strict';

/*
 * Media Hub OTT catalog and rights policy — stages 5–6 hardened.
 *
 * A title is eligible for the member pilot only when every legal and delivery
 * fact is explicitly recorded. Public availability, a familiar source domain,
 * or a card title never substitutes for a rights clearance. Profiles remain
 * disabled until an operator enables a verified delivery path.
 */
const fs = require('fs');
const path = require('path');

const MAX_CONTENT_ID_LENGTH = 260;
const MAX_TEXT_LENGTH = 5000;
const ALLOWED_RIGHTS_BASIS = new Set([
  'public_domain',
  'cc_by',
  'cc_by_sa',
  'government_open',
  'direct_license',
  'distribution_agreement'
]);
const ALLOWED_FORMATS = new Set(['mp4', 'webm', 'hls']);
const ALLOWED_PROFILE_MODES = new Set(['direct', 'broker']);

function clean(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F]/g, ' ').trim();
}

function text(value, max) {
  return clean(value).replace(/\s+/g, ' ').slice(0, max || MAX_TEXT_LENGTH);
}

function contentId(value) {
  const id = clean(value);
  if (!id || id.length > MAX_CONTENT_ID_LENGTH || /[<>"'`]/.test(id)) return '';
  return id;
}

function finite(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(number, max || 60 * 60 * 24 * 365);
}

function allowedUrl(value) {
  const raw = text(value, 4096);
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch (_) {
    return '';
  }
}

function urlHost(value) {
  const raw = allowedUrl(value);
  if (!raw || raw.startsWith('/')) return '';
  try { return new URL(raw).hostname.toLowerCase(); } catch (_) { return ''; }
}

function validLanguage(value) {
  const raw = text(value, 48).toLowerCase().replace(/_/g, '-');
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,12})?$/i.test(raw) ? raw : '';
}

function dateValue(value) {
  const time = Date.parse(text(value, 80));
  if (!Number.isFinite(time) || time <= 0) return '';
  if (time > Date.now() + (24 * 60 * 60 * 1000)) return '';
  return new Date(time).toISOString();
}

function firstJson(locations, fallback) {
  for (const file of locations) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
  }
  return fallback;
}

function secureLocations(name) {
  return [
    path.join(__dirname, '..', 'secure', name),
    path.join(process.cwd(), 'netlify', 'functions', 'secure', name)
  ];
}

function readCatalog() {
  const value = firstJson(secureLocations('media-catalog.json'), { version: 'media.catalog.v2', items: {} });
  return value && typeof value === 'object' ? value : { version: 'media.catalog.v2', items: {} };
}

function readDeliveryProfiles() {
  const value = firstJson(secureLocations('media-delivery-profiles.json'), { version: 'media.delivery.v1', profiles: {} });
  return value && typeof value === 'object' ? value : { version: 'media.delivery.v1', profiles: {} };
}

function listItems(catalog) {
  const raw = catalog && catalog.items;
  if (Array.isArray(raw)) return raw.map((item) => item && typeof item === 'object' ? Object.assign({}, item) : null).filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.keys(raw).map((key) => {
      const item = raw[key];
      return item && typeof item === 'object' ? Object.assign({ contentId: key }, item) : null;
    }).filter(Boolean);
  }
  return [];
}

function findItem(catalog, wantedId) {
  const id = contentId(wantedId);
  if (!id) return null;
  return listItems(catalog).find((item) => contentId(item.contentId || item.id) === id) || null;
}

function normalizeTerritories(value) {
  const rows = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
  const unique = new Set();
  for (const entry of rows) {
    const code = text(entry, 40).toLowerCase();
    if (code === 'global' || /^[a-z]{2}$/i.test(code) || /^[a-z]{2,3}-[a-z0-9-]{2,24}$/i.test(code)) unique.add(code);
  }
  return Array.from(unique);
}

function profileFor(profiles, name) {
  const raw = profiles && profiles.profiles;
  const key = text(name, 80).replace(/[^a-z0-9._-]/gi, '');
  return key && raw && typeof raw === 'object' && raw[key] && typeof raw[key] === 'object'
    ? Object.assign({ id: key }, raw[key])
    : null;
}

function formatFor(delivery) {
  const raw = text(delivery && (delivery.format || delivery.type || delivery.protocol), 24).toLowerCase();
  if (raw === 'm3u8' || raw === 'hls') return 'hls';
  if (raw === 'mp4' || raw === 'webm') return raw;
  const source = text(delivery && (delivery.url || delivery.streamUrl || delivery.manifestUrl), 4096).toLowerCase();
  if (source.includes('.m3u8')) return 'hls';
  if (source.includes('.webm')) return 'webm';
  if (source.includes('.mp4')) return 'mp4';
  return '';
}

function allowedByProfile(profile, url) {
  const raw = allowedUrl(url);
  if (!raw || !profile) return false;
  if (raw.startsWith('/')) return profile.allowSameOrigin === true;
  const host = urlHost(raw);
  const allowedHosts = Array.isArray(profile.allowedHosts)
    ? profile.allowedHosts.map((value) => text(value, 260).toLowerCase()).filter(Boolean)
    : [];
  return !!host && allowedHosts.includes(host);
}

function secureDeliveryUrl(profile, value) {
  const raw = allowedUrl(value);
  if (!raw) return '';
  if (raw.startsWith('/')) return profile && profile.allowSameOrigin === true ? raw : '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
  } catch (_) { return ''; }
  return allowedByProfile(profile, raw) ? raw : '';
}

function normalizeCaptions(item, delivery, profile) {
  const raw = (item && (item.captions || item.subtitleTracks || item.tracks)) ||
    (delivery && (delivery.captions || delivery.subtitleTracks || delivery.tracks)) || [];
  const rows = Array.isArray(raw) ? raw : Object.values(raw && typeof raw === 'object' ? raw : {});
  const seen = new Set();
  const out = [];
  const issues = [];
  for (const entry of rows.slice(0, 30)) {
    if (!entry || typeof entry !== 'object') continue;
    const src = secureDeliveryUrl(profile, entry.src || entry.url || entry.href || entry.vttUrl);
    const language = validLanguage(entry.language || entry.lang || entry.srclang);
    const kind = text(entry.kind || 'subtitles', 20).toLowerCase();
    const label = text(entry.label || entry.name || language, 120) || language;
    if (!src || !language || !['subtitles', 'captions'].includes(kind)) {
      issues.push('caption_track_not_allowed');
      continue;
    }
    const key = language + '|' + src;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: text(entry.id || language, 80).replace(/[^a-z0-9._-]/gi, '') || language,
      language,
      label,
      kind,
      src,
      default: entry.default === true || entry.isDefault === true
    });
  }
  return { tracks: out, issues: Array.from(new Set(issues)) };
}

function validateRights(item) {
  const issues = [];
  const rights = item && item.rights && typeof item.rights === 'object' ? item.rights : {};
  const status = text(rights.status, 40).toLowerCase();
  const basis = text(rights.basis || rights.licenseBasis, 80).toLowerCase();
  const sourceUrl = allowedUrl(rights.sourceUrl || rights.sourceEvidenceUrl || item.sourceUrl);
  const licenseUrl = allowedUrl(rights.licenseUrl || rights.licenseEvidenceUrl);
  const evidenceUrl = allowedUrl(rights.evidenceUrl || rights.contractUrl || rights.reviewDocumentUrl);
  const verifiedAt = dateValue(rights.verifiedAt);
  const verifiedBy = text(rights.verifiedBy, 160);
  const territories = normalizeTerritories(rights.territories || rights.territory || item.territories);
  const attribution = text(rights.attribution, 1000);

  if (status !== 'cleared') issues.push('rights_status_not_cleared');
  if (!ALLOWED_RIGHTS_BASIS.has(basis)) issues.push('rights_basis_not_allowed');
  if (!sourceUrl) issues.push('rights_source_evidence_missing');
  if (!licenseUrl && !evidenceUrl) issues.push('rights_license_or_contract_evidence_missing');
  if (!verifiedAt) issues.push('rights_verification_date_missing');
  if (!verifiedBy) issues.push('rights_verifier_missing');
  if (!territories.length) issues.push('rights_territory_missing');
  if ((basis === 'cc_by' || basis === 'cc_by_sa') && !attribution) issues.push('rights_attribution_missing');

  return { ok: issues.length === 0, issues, rights: { status, basis, sourceUrl, licenseUrl, evidenceUrl, verifiedAt, verifiedBy, territories, attribution } };
}

function validateDelivery(item, profiles) {
  const issues = [];
  const delivery = item && item.delivery && typeof item.delivery === 'object'
    ? item.delivery
    : (item && item.stream && typeof item.stream === 'object' ? item.stream : {});
  const profile = profileFor(profiles, delivery.profile || delivery.deliveryProfile || item.deliveryProfile);
  const format = formatFor(delivery);
  const directUrl = allowedUrl(delivery.url || delivery.streamUrl || delivery.manifestUrl);
  const assetKey = text(delivery.assetKey || delivery.assetId || delivery.contentKey, 320);
  const rawMode = text(profile && profile.mode || '', 32).toLowerCase();
  const mode = ALLOWED_PROFILE_MODES.has(rawMode) ? rawMode : '';

  if (!profile) issues.push('delivery_profile_missing');
  else if (profile.enabled !== true) issues.push('delivery_profile_disabled');
  if (!mode) issues.push('delivery_mode_not_supported');
  if (!format || !ALLOWED_FORMATS.has(format)) issues.push('delivery_format_not_supported');
  if (profile && Array.isArray(profile.formats) && profile.formats.length && !profile.formats.map((value) => text(value, 24).toLowerCase()).includes(format)) {
    issues.push('delivery_format_not_allowed_by_profile');
  }
  if (format === 'hls' && text(profile && profile.hlsBrowserMode, 40).toLowerCase() !== 'native_only') {
    issues.push('hls_browser_mode_not_confirmed');
  }

  let resolvedUrl = '';
  if (mode === 'broker') {
    if (!assetKey) issues.push('delivery_asset_key_missing');
  } else if (mode === 'direct') {
    resolvedUrl = secureDeliveryUrl(profile, directUrl);
    if (!resolvedUrl) issues.push('delivery_url_missing_or_not_allowlisted');
  }

  const posterCandidate = allowedUrl(item && (item.posterUrl || item.poster || item.thumbnail));
  const posterUrl = posterCandidate ? secureDeliveryUrl(profile, posterCandidate) : '';
  if (posterCandidate && !posterUrl) issues.push('poster_not_allowlisted');
  const captions = normalizeCaptions(item, delivery, profile);
  issues.push(...captions.issues);

  return {
    ok: issues.length === 0,
    issues: Array.from(new Set(issues)),
    delivery: {
      profile: profile ? profile.id : '',
      profileConfig: profile || null,
      mode,
      format,
      url: resolvedUrl,
      assetKey,
      posterUrl,
      captions: captions.tracks
    }
  };
}

function validatePilotItem(item, profiles) {
  const id = contentId(item && (item.contentId || item.id));
  const issues = [];
  const status = text(item && item.status, 40).toLowerCase();
  const pilot = item && item.pilot && typeof item.pilot === 'object' ? item.pilot : {};
  const pilotEnabled = pilot.enabled === true;
  const pilotAccess = text(pilot.access || '', 40).toLowerCase();
  const rights = validateRights(item);
  const delivery = validateDelivery(item, profiles);

  if (!id) issues.push('content_id_missing');
  if (status !== 'ready') issues.push('content_status_not_ready');
  if (!pilotEnabled) issues.push('pilot_not_explicitly_enabled');
  if (pilotAccess !== 'member_free') issues.push('pilot_access_not_member_free');
  issues.push(...rights.issues, ...delivery.issues);

  return {
    ok: issues.length === 0,
    issues: Array.from(new Set(issues)),
    contentId: id,
    title: text(item && (item.title || item.name || id), 300) || id,
    description: text(item && (item.description || item.summary), 4000),
    rights,
    delivery
  };
}

function publicContent(validation, stream) {
  const result = validation || {};
  const rights = result.rights && result.rights.rights || {};
  return {
    contentId: result.contentId,
    title: result.title,
    description: result.description,
    posterUrl: result.delivery && result.delivery.posterUrl || '',
    attribution: rights.attribution || '',
    stream: { format: result.delivery && result.delivery.format || '', url: stream && stream.url || '', expiresAt: stream && stream.expiresAt || null },
    captions: result.delivery && result.delivery.captions || []
  };
}

function safeAuditItem(validation) {
  const rights = validation && validation.rights && validation.rights.rights || {};
  const delivery = validation && validation.delivery && validation.delivery.delivery || {};
  return {
    contentId: validation && validation.contentId || '',
    title: validation && validation.title || '',
    ready: Boolean(validation && validation.ok),
    issues: validation && validation.issues || [],
    rights: {
      status: rights.status || '', basis: rights.basis || '', sourceHost: urlHost(rights.sourceUrl),
      licenseHost: urlHost(rights.licenseUrl || rights.evidenceUrl), verifiedAt: rights.verifiedAt || '',
      verifiedBy: rights.verifiedBy || '', territories: rights.territories || []
    },
    delivery: {
      profile: delivery.profile || '', mode: delivery.mode || '', format: delivery.format || '',
      streamHost: urlHost(delivery.url),
      captions: Array.isArray(delivery.captions) ? delivery.captions.map((track) => ({ language: track.language, label: track.label, host: urlHost(track.src) })) : []
    }
  };
}


const MAX_SERIES_SEASONS = 60;
const MAX_SERIES_EPISODES = 600;

function isSeriesItem(item) {
  const kind = text(item && (item.kind || item.type || item.contentType), 32).toLowerCase();
  return kind === 'series' || kind === 'season_collection' || (Array.isArray(item && item.seasons) && item.seasons.length > 0);
}

function seasonNumber(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 999 ? number : fallback;
}

function episodeNumber(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 9999 ? number : fallback;
}

function seriesSeasons(item) {
  const raw = Array.isArray(item && item.seasons) ? item.seasons : [];
  const ids = new Set();
  const result = [];
  let total = 0;
  raw.slice(0, MAX_SERIES_SEASONS).forEach((season, seasonIndex) => {
    if (!season || typeof season !== 'object') return;
    const episodesRaw = Array.isArray(season.episodes) ? season.episodes : [];
    const episodes = [];
    episodesRaw.slice(0, Math.max(0, MAX_SERIES_EPISODES - total)).forEach((episode, episodeIndex) => {
      if (!episode || typeof episode !== 'object') return;
      const id = contentId(episode.contentId || episode.id);
      if (!id || ids.has(id)) return;
      ids.add(id);
      episodes.push(Object.assign({}, episode, {
        contentId: id,
        episodeNumber: episodeNumber(episode.episodeNumber || episode.number || episodeIndex + 1, episodeIndex + 1)
      }));
      total += 1;
    });
    if (!episodes.length) return;
    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber || a.contentId.localeCompare(b.contentId));
    result.push({
      seasonNumber: seasonNumber(season.seasonNumber || season.number || seasonIndex + 1, seasonIndex + 1),
      title: text(season.title || season.name || ('Season ' + (seasonIndex + 1)), 180),
      description: text(season.description || season.summary || '', 1000),
      episodes
    });
  });
  return result.sort((a, b) => a.seasonNumber - b.seasonNumber);
}

function episodeItem(series, episode) {
  if (!series || !episode) return null;
  // Rights and pilot rules may be stated once at series level, but every
  // episode must still provide its own delivery target and content id.
  return {
    contentId: contentId(episode.contentId || episode.id),
    title: text(episode.title || episode.name || (series.title || 'Episode'), 300),
    description: text(episode.description || episode.summary || '', 4000),
    status: text(episode.status || series.status, 40).toLowerCase(),
    pilot: episode.pilot && typeof episode.pilot === 'object' ? episode.pilot : series.pilot,
    rights: episode.rights && typeof episode.rights === 'object' ? episode.rights : series.rights,
    territories: episode.territories || series.territories,
    posterUrl: episode.posterUrl || episode.poster || episode.thumbnail || series.posterUrl || series.poster || series.thumbnail,
    captions: episode.captions || episode.subtitleTracks || episode.tracks || [],
    delivery: episode.delivery && typeof episode.delivery === 'object' ? episode.delivery : null,
    adPolicy: episode.adPolicy && typeof episode.adPolicy === 'object' ? episode.adPolicy : series.adPolicy || null,
    episodeNumber: episode.episodeNumber,
    seasonNumber: episode.seasonNumber
  };
}

function validatePilotSeries(item, profiles) {
  const id = contentId(item && (item.contentId || item.id));
  const issues = [];
  const status = text(item && item.status, 40).toLowerCase();
  const pilot = item && item.pilot && typeof item.pilot === 'object' ? item.pilot : {};
  const pilotEnabled = pilot.enabled === true;
  const pilotAccess = text(pilot.access || '', 40).toLowerCase();
  const rights = validateRights(item);
  const seasons = seriesSeasons(item);

  if (!id) issues.push('content_id_missing');
  if (!isSeriesItem(item)) issues.push('series_type_missing');
  if (status !== 'ready') issues.push('content_status_not_ready');
  if (!pilotEnabled) issues.push('pilot_not_explicitly_enabled');
  if (pilotAccess !== 'member_free') issues.push('pilot_access_not_member_free');
  if (!seasons.length) issues.push('series_episodes_missing');
  issues.push(...rights.issues);

  return {
    ok: issues.length === 0,
    issues: Array.from(new Set(issues)),
    contentId: id,
    title: text(item && (item.title || item.name || id), 300) || id,
    description: text(item && (item.description || item.summary), 4000),
    posterUrl: allowedUrl(item && (item.posterUrl || item.poster || item.thumbnail)),
    rights,
    seasons
  };
}

function findSeriesEpisode(series, wantedEpisodeId) {
  const wanted = contentId(wantedEpisodeId);
  if (!wanted) return null;
  for (const season of seriesSeasons(series)) {
    const episode = season.episodes.find((entry) => entry.contentId === wanted);
    if (episode) return Object.assign({}, episode, { seasonNumber: season.seasonNumber, seasonTitle: season.title });
  }
  return null;
}


function findSeriesEpisodeRecord(catalog, wantedEpisodeId) {
  const wanted = contentId(wantedEpisodeId);
  if (!wanted) return null;
  for (const series of listItems(catalog)) {
    if (!isSeriesItem(series)) continue;
    const episode = findSeriesEpisode(series, wanted);
    if (episode) return { series, episode };
  }
  return null;
}

function publicSeries(validation, profiles) {
  const result = validation || {};
  const series = {
    contentId: result.contentId || '',
    title: result.title || '',
    description: result.description || '',
    posterUrl: '',
    seasons: []
  };
  if (!result.ok) return series;
  result.seasons.forEach((season) => {
    const episodes = [];
    season.episodes.forEach((episode) => {
      const candidate = episodeItem({
        title: result.title,
        status: 'ready',
        pilot: { enabled: true, access: 'member_free' },
        rights: result.rights && result.rights.rights,
        posterUrl: result.posterUrl
      }, episode);
      const validation = validatePilotItem(candidate, profiles);
      // Never send a direct stream URL in a series listing. Only ready,
      // rights-cleared episodes are selectable, and their URL is still
      // resolved after a dedicated server request.
      if (!validation.ok) return;
      if (!series.posterUrl && validation.delivery && validation.delivery.delivery && validation.delivery.delivery.posterUrl) series.posterUrl = validation.delivery.delivery.posterUrl;
      episodes.push({
        contentId: validation.contentId,
        title: validation.title,
        description: validation.description,
        episodeNumber: episode.episodeNumber,
        seasonNumber: season.seasonNumber,
        posterUrl: validation.delivery && validation.delivery.delivery && validation.delivery.delivery.posterUrl || '',
        captionsAvailable: Boolean(validation.delivery && validation.delivery.delivery && validation.delivery.delivery.captions && validation.delivery.delivery.captions.length)
      });
    });
    if (episodes.length) series.seasons.push({
      seasonNumber: season.seasonNumber,
      title: season.title,
      description: season.description,
      episodes
    });
  });
  return series;
}


function safeAuditSeries(validation, profiles) {
  const rights = validation && validation.rights && validation.rights.rights || {};
  const summary = publicSeries(validation, profiles);
  const availableEpisodes = summary.seasons.reduce((count, season) => count + season.episodes.length, 0);
  const issues = Array.isArray(validation && validation.issues) ? validation.issues.slice() : [];
  if (!availableEpisodes) issues.push('series_no_ready_episodes');
  return {
    contentId: validation && validation.contentId || '',
    title: validation && validation.title || '',
    kind: 'series',
    ready: Boolean(validation && validation.ok && availableEpisodes),
    issues: Array.from(new Set(issues)),
    rights: {
      status: rights.status || '', basis: rights.basis || '', sourceHost: urlHost(rights.sourceUrl),
      licenseHost: urlHost(rights.licenseUrl || rights.evidenceUrl), verifiedAt: rights.verifiedAt || '',
      verifiedBy: rights.verifiedBy || '', territories: rights.territories || []
    },
    seasons: summary.seasons.map((season) => ({
      seasonNumber: season.seasonNumber,
      title: season.title,
      availableEpisodes: season.episodes.length,
      firstEpisodeId: season.episodes[0] && season.episodes[0].contentId || ''
    }))
  };
}

module.exports = {
  ALLOWED_RIGHTS_BASIS,
  allowedByProfile,
  allowedUrl,
  clean,
  contentId,
  dateValue,
  findItem,
  finite,
  formatFor,
  listItems,
  publicContent,
  readCatalog,
  readDeliveryProfiles,
  safeAuditItem,
  secureDeliveryUrl,
  text,
  validatePilotItem,
  validLanguage,
  isSeriesItem,
  validatePilotSeries,
  findSeriesEpisode,
  episodeItem,
  publicSeries,
  seriesSeasons,
  findSeriesEpisodeRecord,
  safeAuditSeries
};
