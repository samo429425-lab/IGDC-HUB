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
  const identity = String(body.identity || body.email || body.user_id || body.member_id || body.licenseKey || '').trim();
  const key = norm(identity);
  if (key && ownerSet().has(key)) {
    return json(200, { ok: true, active: true, allowed: true, status: 'active', plan: 'OWNER_ADMIN', role: 'owner', roles: ['owner','admin'], source: 'owner-allowlist', publicServiceState: 'preparing', message: '' });
  }
  // PG approval is not active. Do not expose a payment URL, paid allowlist,
  // or a provisional member upgrade path to general users.
  return json(200, {
    ok: true, active: false, allowed: false, status: 'preparing', plan: 'PREPARING',
    role: 'guest_or_member', roles: [], publicServiceState: 'preparing',
    message: 'AI 연동을 위한 유료버전은 준비 중입니다.', paymentUrl: ''
  });
};
