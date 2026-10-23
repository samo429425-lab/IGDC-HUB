'use strict';

/* MARU AI license/status gate — V190 Google Play Billing aware. */
const {
  accessErrorResponse,
  authorizeAiAccess,
  bearerToken,
  googlePlayBillingConfigured,
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
    message: 'MARU AI 유료 서비스의 결제 검증 연결을 준비 중입니다.',
    paymentUrl: ''
  }, publicServiceState());
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (!['GET', 'POST'].includes(String(event.httpMethod || '').toUpperCase())) {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

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
      googlePlayProductId: access.googlePlayProductId || '',
      googlePlayBasePlanId: access.googlePlayBasePlanId || '',
      monthlyCreditUnits: access.monthlyCreditUnits || 0,
      googlePlaySubscriptionState: access.googlePlaySubscriptionState || '',
      googlePlayExpiryTime: access.googlePlayExpiryTime || '',
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
        code: 'ai_membership_required',
        plan: 'PAID_MEMBERSHIP_REQUIRED',
        role: 'member',
        roles: [],
        message: googlePlayBillingConfigured()
          ? 'Google Play에서 활성화된 MARU AI 월 구독이 필요합니다.'
          : 'MARU AI 월 회원권 또는 유효한 유료 이용권이 필요합니다.',
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
