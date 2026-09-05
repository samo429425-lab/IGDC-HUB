'use strict';
const OAuth = require('./lib/social-youtube-oauth.v1');

function html(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body };
}
function popupFailure(event, message) {
  const origin = OAuth.requestOrigin(event) || '*';
  const payload = JSON.stringify({ type: 'IGDC_SOCIAL_OAUTH', provider: 'youtube', ok: false, error: message });
  return html(503, '<!doctype html><meta charset="utf-8"><title>YouTube connection</title><body style="font-family:system-ui;padding:24px">YouTube account connection is not configured.<script>try{if(window.opener){window.opener.postMessage(' + payload + ',' + JSON.stringify(origin) + ');}}catch(e){} setTimeout(function(){window.close();},600);</script></body>');
}

exports.handler = async function handler(event) {
  if (!event || event.httpMethod !== 'GET') return html(405, 'Method not allowed');
  const cfg = OAuth.config();
  if (!cfg.configured) return popupFailure(event, 'youtube_social_oauth_not_configured');
  const redirectUri = OAuth.callbackUrl(event);
  const state = OAuth.makeState(event);
  if (!redirectUri || !state) return popupFailure(event, 'oauth_origin_unavailable');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.force-ssl');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return { statusCode: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store' }, body: '' };
};
