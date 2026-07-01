'use strict';

/*
 * Reserved, fail-closed lifecycle seam for a future verified PG webhook or
 * owner-operated back-office bridge. It is not a public checkout endpoint and
 * is disabled in stages 7–10. Keeping the boundary explicit prevents payment
 * callbacks from ever being wired directly to playback delivery.
 */
const { text } = require('./lib/media-catalog-policy');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Media-Access-Signature'
    },
    body: JSON.stringify(body || {})
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Media-Access-Signature', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  // No branch may grant/revoke access until an approved provider adapter with
  // signature verification is installed. Returning a deterministic response is
  // safer than accepting an unverified webhook or a browser request.
  return json(503, {
    ok: false,
    error: 'media_access_lifecycle_not_activated',
    message: 'The verified payment lifecycle bridge is not activated.'
  });
};
