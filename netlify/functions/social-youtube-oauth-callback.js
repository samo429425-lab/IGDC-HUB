'use strict';
const OAuth = require('./lib/social-youtube-oauth.v1');

function page(event, ok, error, setCookie) {
  const origin = OAuth.requestOrigin(event) || '*';
  const payload = JSON.stringify({ type: 'IGDC_SOCIAL_OAUTH', provider: 'youtube', ok: !!ok, error: error || null });
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return {
    statusCode: ok ? 200 : 400,
    headers,
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube connection</title></head><body style="font-family:system-ui;padding:24px"><p>' + (ok ? 'YouTube account connected. You can close this window.' : 'YouTube account connection failed.') + '</p><script>(function(){var p=' + payload + ';try{if(window.opener&&!window.opener.closed){window.opener.postMessage(p,' + JSON.stringify(origin) + ');}}catch(e){}setTimeout(function(){try{window.close();}catch(e){}},250);})();</script></body></html>'
  };
}

exports.handler = async function handler(event) {
  if (!event || event.httpMethod !== 'GET') return page(event, false, 'method_not_allowed');
  const query = event.queryStringParameters || {};
  if (query.error) return page(event, false, OAuth.text(query.error));
  const verified = OAuth.verifyState(event, query.state);
  if (!verified.ok) return page(event, false, verified.error);
  const code = OAuth.text(query.code);
  if (!code) return page(event, false, 'authorization_code_missing');
  try {
    const token = await OAuth.exchangeCode(event, code);
    const previous = OAuth.sessionFromEvent(event) || {};
    const accessToken = OAuth.text(token.access_token);
    if (!accessToken) return page(event, false, 'access_token_missing');
    const session = {
      accessToken,
      refreshToken: OAuth.text(token.refresh_token || previous.refreshToken),
      expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000,
      scope: OAuth.text(token.scope),
      tokenType: OAuth.text(token.token_type || 'Bearer'),
      connectedAt: Date.now()
    };
    return page(event, true, '', OAuth.cookieHeader(event, session));
  } catch (error) {
    return page(event, false, OAuth.text(error && error.message) || 'oauth_exchange_failed');
  }
};
