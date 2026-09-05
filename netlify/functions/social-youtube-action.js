'use strict';
const OAuth = require('./lib/social-youtube-oauth.v1');

function response(statusCode, body, setCookie) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return { statusCode, headers, body: JSON.stringify(body) };
}
function validVideoId(value) { return /^[A-Za-z0-9_-]{6,20}$/.test(OAuth.text(value)); }
function validChannelId(value) { return /^UC[A-Za-z0-9_-]{20,}$/.test(OAuth.text(value)); }

async function youtubeFetch(path, options, accessToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://www.googleapis.com/youtube/v3/' + path, Object.assign({}, options || {}, {
      signal: controller.signal,
      headers: Object.assign({ 'Accept': 'application/json', 'Authorization': 'Bearer ' + accessToken }, options && options.headers || {})
    }));
    const raw = await res.text();
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = { raw }; }
    if (!res.ok) {
      const error = new Error(OAuth.text(body && body.error && body.error.message) || ('youtube_http_' + res.status));
      error.statusCode = res.status;
      throw error;
    }
    return body;
  } finally { clearTimeout(timer); }
}

exports.handler = async function handler(event) {
  const method = event && event.httpMethod || '';
  if (method !== 'GET' && method !== 'POST') return response(405, { ok: false, error: 'method_not_allowed' });

  const active = await OAuth.activeSession(event);
  const cookie = active.setCookie || '';
  if (method === 'GET') {
    return response(200, {
      ok: true,
      provider: 'youtube',
      configured: !!active.configured,
      authorized: !!(active.session && active.session.accessToken),
      memberAuthLinked: false,
      oauthScope: 'social_viewer_only'
    }, cookie);
  }

  if (!active.configured) return response(503, { ok: false, error: 'youtube_social_oauth_not_configured', oauthRequired: true }, cookie);
  if (!active.session || !active.session.accessToken) return response(401, { ok: false, error: 'youtube_oauth_required', oauthRequired: true }, cookie);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return response(400, { ok: false, error: 'invalid_json' }, cookie); }
  const action = OAuth.text(body.action).toLowerCase();
  const token = active.session.accessToken;
  try {
    if (action === 'like') {
      const videoId = OAuth.text(body.videoId);
      if (!validVideoId(videoId)) return response(400, { ok: false, error: 'invalid_video_id' }, cookie);
      await youtubeFetch('videos/rate?id=' + encodeURIComponent(videoId) + '&rating=like', { method: 'POST' }, token);
      return response(200, { ok: true, action: 'like', videoId }, cookie);
    }
    if (action === 'subscribe') {
      const channelId = OAuth.text(body.channelId);
      if (!validChannelId(channelId)) return response(400, { ok: false, error: 'invalid_channel_id' }, cookie);
      const result = await youtubeFetch('subscriptions?part=snippet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippet: { resourceId: { kind: 'youtube#channel', channelId } } })
      }, token);
      return response(200, { ok: true, action: 'subscribe', channelId, subscriptionId: OAuth.text(result && result.id) || null }, cookie);
    }
    if (action === 'comment') {
      const videoId = OAuth.text(body.videoId);
      const comment = OAuth.text(body.comment);
      if (!validVideoId(videoId)) return response(400, { ok: false, error: 'invalid_video_id' }, cookie);
      if (!comment || comment.length > 10000) return response(400, { ok: false, error: 'invalid_comment' }, cookie);
      const result = await youtubeFetch('commentThreads?part=snippet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippet: { videoId, topLevelComment: { snippet: { textOriginal: comment } } } })
      }, token);
      return response(200, { ok: true, action: 'comment', videoId, commentId: OAuth.text(result && result.id) || null }, cookie);
    }
    return response(400, { ok: false, error: 'unsupported_action' }, cookie);
  } catch (error) {
    const status = Number(error && error.statusCode || 0);
    if (status === 401) return response(401, { ok: false, error: 'youtube_oauth_expired', oauthRequired: true }, OAuth.clearCookieHeader(event));
    return response(status === 403 ? 403 : 502, { ok: false, error: status === 403 ? 'youtube_action_not_permitted' : 'youtube_action_failed', message: OAuth.text(error && error.message) }, cookie);
  }
};
