'use strict';

/* MARU AI V190 Google Play one-time credit claim endpoint. */
const {
  googleAccessToken,
  verifyMember,
  authorizeAiAccess,
  googlePlayAccountBindingMatches
} = require('./lib/maru-ai-access-control');
const {
  grantTopup,
  getTopupGrant,
  checkAllowance,
  getBalance
} = require('./lib/maru-ai-credit-store');

const PACKAGE_NAME = 'com.maru.mediaplayer';
const DEFAULT_CREDIT_PRODUCT_ID = 'maru_ai_credit_5';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.MARU_AI_CORS_ALLOW_ORIGIN || 'https://igdcglobal.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
  'X-Content-Type-Options': 'nosniff'
};
function json(statusCode, body) { return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body || {}) }; }
function clean(v) { return String(v == null ? '' : v).trim(); }
function parseBody(event) {
  try {
    const raw = event && event.body ? String(event.body) : '{}';
    return JSON.parse(event && event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw) || {};
  } catch (_) { return {}; }
}
function creditProductId() {
  return clean(process.env.MARU_GOOGLE_PLAY_CREDIT_PRODUCT_ID) || DEFAULT_CREDIT_PRODUCT_ID;
}
function creditUnits() {
  const n = Number(process.env.MARU_AI_EXTRA_5_UNITS);
  return Number.isFinite(n) && n > 0 ? n : 200;
}
function err(statusCode, code, message) {
  const e = new Error(message || code);
  e.statusCode = statusCode; e.code = code;
  return e;
}
async function verifyProductPurchase(packageName, productId, purchaseToken) {
  const accessToken = await googleAccessToken();
  const endpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`
    + `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  let response;
  try {
    response = await fetch(endpoint, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  } catch (_) {
    throw err(503, 'google_play_verifier_unavailable', 'Google Play purchase verification is temporarily unavailable.');
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (response.status === 401 || response.status === 403) {
    throw err(503, 'google_play_verifier_misconfigured', 'Google Play verifier permission is not configured correctly.');
  }
  if (!response.ok || !payload) throw err(402, 'credit_purchase_not_found', 'The Google Play credit purchase could not be verified.');
  // ProductPurchase: purchaseState 0 = purchased, 1 = canceled, 2 = pending.
  if (Number(payload.purchaseState) !== 0) throw err(402, 'credit_purchase_not_completed', 'The Google Play credit purchase is not completed.');
  return payload;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (String(event.httpMethod || '').toUpperCase() !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const body = parseBody(event);
    const action = clean(body.action);
    if (action === 'check-allowance' || action === 'balance') {
      const access = await authorizeAiAccess(event, { purpose: 'billing-check', maximumBytes: 256 * 1024 });
      if (action === 'balance') {
        const balance = await getBalance(access);
        return json(200, Object.assign({ ok: true, allowed: true }, balance));
      }
      const requested = Math.max(0, Math.min(10000, Number(body.creditRequestedUnits || 0) || 0));
      const allowance = await checkAllowance(access, requested);
      if (!allowance.allowed) {
        return json(200, Object.assign({
          ok: false,
          allowed: false,
          code: 'ai_credit_required',
          error: 'ai_credit_required',
          message: 'MARU AI credits are not sufficient for this operation.'
        }, allowance));
      }
      return json(200, Object.assign({ ok: true, allowed: true }, allowance));
    }
    if (action !== 'claim-credit') return json(400, { ok: false, error: 'unsupported_action' });
    const member = await verifyMember(event);
    const packageName = clean(body.googlePlayPackageName);
    const productId = clean(body.googlePlayProductId);
    const purchaseToken = clean(body.googlePlayPurchaseToken);
    if (packageName !== PACKAGE_NAME || productId !== creditProductId() || !purchaseToken) {
      throw err(400, 'invalid_credit_purchase', 'Google Play credit purchase information does not match MARU.');
    }

    const purchase = await verifyProductPurchase(packageName, productId, purchaseToken);
    const boundAccountId = clean(purchase.obfuscatedExternalAccountId);
    // Extra credits are a V190-only product, so every new checkout must be bound to the
    // currently signed-in MARU account. This prevents an unconsumed purchase on a shared
    // device from being claimed by a different MARU login.
    if (!boundAccountId || !googlePlayAccountBindingMatches(member, boundAccountId)) {
      throw err(403, 'credit_purchase_account_mismatch', 'This Google Play credit purchase belongs to a different MARU account.');
    }
    // A consumed purchase may still be retried after an earlier successful grant whose
    // HTTP response was lost. Return idempotent success only when our durable ledger already
    // contains this exact token; otherwise a consumed-but-unrecorded token is rejected.
    if (Number(purchase.consumptionState) === 1) {
      const existing = await getTopupGrant(member.userId, purchaseToken);
      if (!existing) {
        throw err(409, 'credit_purchase_already_consumed', 'This Google Play credit purchase has already been consumed without a matching MARU credit grant.');
      }
      return json(200, {
        ok: true,
        code: 'credit_already_granted',
        granted: false,
        alreadyGranted: true,
        grantedUnits: existing.grantedUnits,
        extraCreditUnits: existing.extraCreditUnits,
        productId,
        message: 'Credit purchase was already applied.'
      });
    }

    const grant = await grantTopup(member.userId, purchaseToken, creditUnits());
    // Do not consume on the server. Android consumes the one-time product only after this
    // durable, idempotent grant succeeds. If the response is lost or the app closes, the
    // unconsumed purchase is discovered on the next BillingClient restore and safely retried.
    return json(200, {
      ok: true,
      code: grant.alreadyGranted ? 'credit_already_granted' : 'credit_granted',
      granted: !!grant.granted,
      alreadyGranted: !!grant.alreadyGranted,
      grantedUnits: grant.grantedUnits,
      extraCreditUnits: grant.extraCreditUnits,
      productId,
      message: grant.alreadyGranted ? 'Credit purchase was already applied.' : 'Extra credits were added.'
    });
  } catch (error) {
    return json(Number(error && error.statusCode) || 500, {
      ok: false,
      code: clean(error && error.code) || 'credit_claim_failed',
      error: clean(error && error.code) || 'credit_claim_failed',
      message: clean(error && error.message) || 'Credit claim failed.'
    });
  }
};
