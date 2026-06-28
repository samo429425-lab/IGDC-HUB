'use strict';

const OWNER_DEFAULTS = ['owner', 'admin', 'samo429425@gmail.com'];
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};
function json(statusCode, body) { return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) }; }
function splitEnv(name) { return String(process.env[name] || '').split(',').map((x) => x.trim()).filter(Boolean); }
function norm(value) { return String(value || '').trim().toLowerCase(); }
function parseBody(event) { try { const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || ''); return raw.trim() ? JSON.parse(raw) : {}; } catch { return {}; } }
function ownerSet() { return new Set([...OWNER_DEFAULTS, ...splitEnv('MARU_AI_OWNER_IDENTITIES')].map(norm)); }
function paidSet() { return new Set(splitEnv('MARU_AI_PAID_IDENTITIES').map(norm)); }
function paymentUrl(identity, deviceId) {
  const base = process.env.MARU_AI_PAYMENT_URL || 'https://igdcglobal.com/maru-player/ai-pro';
  try { const url = new URL(base); if (identity) url.searchParams.set('license_identity', identity); if (deviceId) url.searchParams.set('device_id', deviceId); url.searchParams.set('app', 'maru-media-player'); return url.toString(); } catch { return base; }
}
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  const body = event.httpMethod === 'GET' ? Object.fromEntries(new URLSearchParams(event.rawQuery || '')) : parseBody(event);
  const identity = String(body.identity || body.email || body.user_id || body.member_id || '').trim();
  const licenseKey = String(body.licenseKey || body.license_key || '').trim();
  const deviceId = String(body.deviceId || body.device_id || '').trim();
  const key = norm(identity || licenseKey);
  const owners = ownerSet();
  const paid = paidSet();
  if (key && owners.has(key)) return json(200, { ok: true, active: true, allowed: true, status: 'active', plan: 'OWNER_ADMIN', role: 'owner', roles: ['owner'], source: 'owner-allowlist', paymentUrl: paymentUrl(identity, deviceId) });
  if (key && paid.has(key)) return json(200, { ok: true, active: true, allowed: true, status: 'active', plan: 'AI_PRO', role: 'paid_user', roles: ['paid_user'], source: 'paid-allowlist', paymentUrl: paymentUrl(identity, deviceId) });
  return json(200, { ok: true, active: false, allowed: false, status: 'payment_required', plan: 'FREE', role: 'guest_or_unpaid', roles: [], message: identity ? 'AI Pro payment is required.' : 'Login or member identity is required.', paymentUrl: paymentUrl(identity, deviceId) });
};
