'use strict';

/*
 * IGDC Social main viewer: public YouTube watch-detail bridge.
 * Scope: opened YouTube card only. Never runs during Social list rendering.
 * Secret API keys remain server-side. No write/OAuth operations are exposed.
 */

const CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ROWS = 120;

function response(statusCode, body, cacheControl) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl || 'no-store',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function flatten(input, out) {
  out = out || {};
  if (!input || typeof input !== 'object') return out;
  Object.keys(input).forEach((key) => {
    const value = input[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, out);
    else if (typeof value === 'string' || typeof value === 'number') out[key] = String(value);
  });
  return out;
}

function bundledKeys() {
  const raw = text(process.env.MARU_API_KEYS_JSON || process.env.API_KEYS_JSON || process.env.IGDC_API_KEYS_JSON);
  if (!raw) return {};
  const candidates = [raw];
  try {
    if (/^[A-Za-z0-9+/=]{80,}$/.test(raw)) candidates.push(Buffer.from(raw, 'base64').toString('utf8'));
  } catch (_) {}
  for (const candidate of candidates) {
    try { return flatten(JSON.parse(candidate)); } catch (_) {}
  }
  return {};
}

function youtubeKey() {
  const direct = text(
    process.env.YOUTUBE_API_KEY ||
    process.env.GOOGLE_YOUTUBE_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_SEARCH_API_KEY
  );
  if (direct) return direct;
  const values = bundledKeys();
  const aliases = [
    'YOUTUBE_API_KEY', 'GOOGLE_YOUTUBE_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_SEARCH_API_KEY',
    'youtubeApiKey', 'youtubeKey', 'googleApiKey', 'googleKey'
  ];
  for (const alias of aliases) {
    const exact = text(values[alias]);
    if (exact) return exact;
    const found = Object.keys(values).find((key) => key.toLowerCase() === alias.toLowerCase());
    if (found && text(values[found])) return text(values[found]);
  }
  return '';
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 4500);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(text(body && body.error && body.error.message) || ('http_' + res.status));
      err.statusCode = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function thumbOf(snippet) {
  const t = snippet && snippet.thumbnails || {};
  return text((t.high || t.medium || t.default || {}).url);
}

function normalizeComment(row) {
  const top = row && row.snippet && row.snippet.topLevelComment;
  const s = top && top.snippet || {};
  return {
    id: text(top && top.id),
    author: text(s.authorDisplayName),
    authorAvatar: text(s.authorProfileImageUrl),
    text: text(s.textDisplay || s.textOriginal),
    likeCount: Number(s.likeCount || 0),
    publishedAt: text(s.publishedAt)
  };
}

function pruneCache() {
  if (CACHE.size <= MAX_CACHE_ROWS) return;
  const rows = Array.from(CACHE.entries()).sort((a, b) => a[1].at - b[1].at);
  rows.slice(0, Math.max(1, CACHE.size - MAX_CACHE_ROWS)).forEach(([key]) => CACHE.delete(key));
}

exports.handler = async function handler(event) {
  if (!event || event.httpMethod !== 'GET') {
    return response(405, { ok: false, error: 'method_not_allowed' });
  }

  const videoId = text(event.queryStringParameters && event.queryStringParameters.videoId);
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return response(400, { ok: false, error: 'invalid_video_id' });
  }

  const cached = CACHE.get(videoId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return response(200, cached.body, 'public, max-age=120, s-maxage=300, stale-while-revalidate=300');
  }

  const key = youtubeKey();
  if (!key) {
    return response(200, { ok: false, configured: false, error: 'youtube_api_key_not_configured' }, 'public, max-age=60, s-maxage=120');
  }

  const base = 'https://www.googleapis.com/youtube/v3/';
  const videoUrl = base + 'videos?part=snippet,statistics&id=' + encodeURIComponent(videoId) + '&key=' + encodeURIComponent(key);
  const commentsUrl = base + 'commentThreads?part=snippet&videoId=' + encodeURIComponent(videoId) + '&maxResults=20&order=relevance&textFormat=plainText&key=' + encodeURIComponent(key);

  try {
    const videoData = await fetchJson(videoUrl, 4500);
    const row = Array.isArray(videoData.items) ? videoData.items[0] : null;
    if (!row) return response(404, { ok: false, configured: true, error: 'video_not_found' }, 'public, max-age=60, s-maxage=120');

    const snippet = row.snippet || {};
    const statistics = row.statistics || {};
    const channelId = text(snippet.channelId);
    const channelUrl = channelId
      ? base + 'channels?part=snippet,statistics&id=' + encodeURIComponent(channelId) + '&key=' + encodeURIComponent(key)
      : '';

    const [channelResult, commentsResult] = await Promise.allSettled([
      channelUrl ? fetchJson(channelUrl, 3500) : Promise.resolve({ items: [] }),
      fetchJson(commentsUrl, 4500)
    ]);

    const channelData = channelResult.status === 'fulfilled' ? channelResult.value : { items: [] };
    const channelRow = Array.isArray(channelData.items) ? channelData.items[0] : null;
    const channelSnippet = channelRow && channelRow.snippet || {};
    const channelStats = channelRow && channelRow.statistics || {};
    const commentsData = commentsResult.status === 'fulfilled' ? commentsResult.value : { items: [] };
    const comments = (Array.isArray(commentsData.items) ? commentsData.items : [])
      .map(normalizeComment)
      .filter((item) => item.text)
      .slice(0, 20);

    const body = {
      ok: true,
      configured: true,
      video: {
        id: videoId,
        title: text(snippet.title),
        description: text(snippet.description),
        channelId,
        channelTitle: text(snippet.channelTitle),
        publishedAt: text(snippet.publishedAt),
        thumbnail: thumbOf(snippet),
        statistics: {
          viewCount: statistics.viewCount != null ? Number(statistics.viewCount) : null,
          likeCount: statistics.likeCount != null ? Number(statistics.likeCount) : null,
          commentCount: statistics.commentCount != null ? Number(statistics.commentCount) : null
        }
      },
      channel: channelRow ? {
        id: text(channelRow.id),
        title: text(channelSnippet.title || snippet.channelTitle),
        thumbnail: thumbOf(channelSnippet),
        subscriberCount: channelStats.subscriberCount != null ? Number(channelStats.subscriberCount) : null,
        hiddenSubscriberCount: !!channelStats.hiddenSubscriberCount
      } : {
        id: channelId,
        title: text(snippet.channelTitle),
        thumbnail: '',
        subscriberCount: null,
        hiddenSubscriberCount: false
      },
      comments,
      commentsAvailable: commentsResult.status === 'fulfilled'
    };

    CACHE.set(videoId, { at: Date.now(), body });
    pruneCache();
    return response(200, body, 'public, max-age=120, s-maxage=300, stale-while-revalidate=300');
  } catch (error) {
    const status = Number(error && error.statusCode || 0);
    return response(status === 404 ? 404 : 200, {
      ok: false,
      configured: true,
      error: status === 403 ? 'youtube_api_quota_or_permission' : 'youtube_detail_unavailable'
    }, 'public, max-age=30, s-maxage=60');
  }
};
