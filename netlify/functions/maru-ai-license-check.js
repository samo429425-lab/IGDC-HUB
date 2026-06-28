'use strict';

// PG approval is pending. Until a signed membership/payment service exists,
// this endpoint deliberately grants AI access only to owner/admin identities.
const OWNER_DEFAULTS = ['owner', 'admin', 'master', 'administrator', 'samo429425', 'samo429425@gmail.com', 'wam429425', 'wam429425@gmail.com', 'igdcplatform@gmail.com', 'maruowner', 'maruadmin'];
const PREPARING_MESSAGE = 'AI 연동을 위한 유료버전은 준비 중입니다.';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};
function json(statusCode, body) { return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) }; }
function splitEnv(name) { return String(process.env[name] || '').split(',').map((x) => x.trim()).filter(Boolean); }
function norm(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ''); }
function parseBody(event) { try { const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || ''); return raw.trim() ? JSON.parse(raw) : {}; } catch { return {}; } }
function ownerSet() { return new Set([...OWNER_DEFAULTS, ...splitEnv('MARU_AI_OWNER_IDENTITIES')].map(norm)); }
function ownerResult(identity) {
  return {
    ok: true, active: true, allowed: true, status: 'active', plan: 'OWNER_ADMIN', role: 'owner', roles: ['owner', 'admin'],
    source: 'owner-admin-pre-pg', paymentUrl: '', publicPurchaseEnabled: false, serviceMode: 'owner-admin-only-pre-pg', userId: String(identity || 'owner')
  };
}
function preparingResult() {
  return {
    ok: true, active: false, allowed: false, status: 'preparing', plan: 'PRE_PG', role: 'member_or_guest', roles: [],
    source: 'public-ai-preparing', paymentUrl: '', publicPurchaseEnabled: false, serviceMode: 'owner-admin-only-pre-pg', message: PREPARING_MESSAGE
  };
}
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  const body = event.httpMethod === 'GET' ? Object.fromEntries(new URLSearchParams(event.rawQuery || '')) : parseBody(event);
  const identity = String(body.identity || body.email || body.user_id || body.member_id || body.licenseKey || body.license_key || '').trim();
  if (identity && ownerSet().has(norm(identity))) return json(200, ownerResult(identity));
  return json(200, preparingResult());
};
