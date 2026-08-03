'use strict';

/*
 * MARU AI license/status gate.
 *
 * This endpoint never trusts identity, email, role, license, paid or subscription
 * values supplied by the player. Access is derived only from a signed bearer
 * session and current server-side role state.
 */
const {
  accessErrorResponse,
  authorizeAiAccess,
  bearerToken,
  pgExecutionReady,
  publicServiceState
} = require('./lib/maru-ai-access-control');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.MARU_AI_CORS_ALLOW_ORIGIN || 'https://igdcglobal.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
  'X-Content-Type-Options': 'nosniff'
};
function json(statusCode, body) { return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body || {}) }; }
function paymentUrl() {
  if (!pgExecutionReady()) return '';
  const raw = String(process.env.MARU_AI_PAYMENT_URL || 'https://igdcglobal.com/maru-player/ai-pro').trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    url.searchParams.set('app', 'maru-media-player');
    return url.toString();
  } catch (_) { return ''; }
}
function preparingResponse() {
  return Object.assign({
    ok: true,
    active: false,
    allowed: false,
    status: 'preparing',
    plan: 'PREPARING',
    role: 'guest_or_member',
    roles: [],
    message: 'AI 자막·번역·더빙 유료 서비스는 PG 승인 및 운영 연결을 준비 중입니다.',
    paymentUrl: ''
  }, publicServiceState());
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (!['GET', 'POST'].includes(String(event.httpMethod || '').toUpperCase())) {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  // Public/legacy identity checks never grant access. They receive only the
  // non-sensitive preparing state until the player supplies a signed session.
  if (!bearerToken(event)) return json(200, preparingResponse());

  try {
    const access = await authorizeAiAccess(event, { purpose: 'license-check', maximumBytes: 64 * 1024 });
    return json(200, Object.assign({
      ok: true,
      active: true,
      allowed: true,
      status: 'active',
      plan: access.plan,
      role: access.role,
      roles: access.roles,
      accessClass: access.accessClass,
      message: '',
      paymentUrl: ''
    }, publicServiceState()));
  } catch (error) {
    const classified = accessErrorResponse(error);
    if (classified.code === 'ai_public_service_preparing') return json(200, preparingResponse());
    if (classified.code === 'ai_membership_required') {
      return json(200, Object.assign({
        ok: true,
        active: false,
        allowed: false,
        status: 'membership_required',
        plan: 'PAID_MEMBERSHIP_REQUIRED',
        role: 'member',
        roles: [],
        message: 'MARU AI 월 회원권 또는 유효한 유료 이용권이 필요합니다.',
        paymentUrl: paymentUrl()
      }, publicServiceState()));
    }
    return json(classified.statusCode, {
      ok: false,
      active: false,
      allowed: false,
      status: classified.code,
      error: classified.code,
      message: classified.message,
      paymentUrl: ''
    });
  }
};
