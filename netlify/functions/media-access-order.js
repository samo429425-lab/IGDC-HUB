'use strict';

/*
 * Payment-preparation endpoint — stages 7–10.
 *
 * It creates at most a server-side, idempotent payment-not-started order. It
 * never accepts card data, never calls the legacy checkout endpoint, and never
 * grants entitlement. A provider-specific PG adapter is intentionally absent.
 */
const crypto = require('crypto');
const { findItem, contentId, readCatalog, text } = require('./lib/media-catalog-policy');
const { authenticateMember } = require('./lib/media-member-auth');
const { accessRule, eligibleProducts, paymentPublicState, readAccessProducts, safeId } = require('./lib/media-access-policy');
const { createPendingOrder, storageConfig } = require('./lib/media-access-store');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body || {})
  };
}
function parseBody(event) {
  try {
    const raw = event && event.body ? event.body : '';
    const source = event && event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    const value = source ? JSON.parse(source) : {};
    return value && typeof value === 'object' ? value : {};
  } catch (_) { return {}; }
}
function idempotencyKey(event, body, memberId) {
  const header = event && event.headers && (event.headers['idempotency-key'] || event.headers['Idempotency-Key']);
  const supplied = safeId(header || body.idempotencyKey, 180);
  if (supplied) return supplied;
  // A deterministic non-secret fallback keeps repeated clicks from producing
  // multiple pending orders within the same minute without trusting client price.
  const minute = Math.floor(Date.now() / 60000);
  return 'auto_' + crypto.createHash('sha256').update(String(memberId) + '|' + String(body.contentId || '') + '|' + String(body.productId || '') + '|' + minute).digest('hex').slice(0, 48);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const member = await authenticateMember(event);
    const body = parseBody(event);
    const targetId = contentId(body.contentId || body.id);
    const productId = safeId(body.productId, 120);
    if (!targetId || !productId) return json(400, { ok: false, error: 'invalid_order_request' });
    if (body.termsAccepted !== true) return json(400, { ok: false, error: 'terms_acceptance_required' });

    const record = findItem(readCatalog(), targetId);
    if (!record) return json(404, { ok: false, error: 'ott_not_registered' });
    const rule = accessRule(record, { contentId: targetId, rootContentId: targetId });
    if (!rule.valid || rule.mode === 'member_free' || !rule.productIds.includes(productId)) return json(409, { ok: false, error: 'access_product_not_available' });

    const productsCatalog = readAccessProducts();
    const product = eligibleProducts(rule, productsCatalog).find((entry) => entry.productId === productId);
    if (!product) return json(409, { ok: false, error: 'access_product_not_available' });
    const requestedCurrency = text(body.currency, 12).toUpperCase();
    const price = product.prices[requestedCurrency] || product.prices[paymentPublicState(productsCatalog).defaultCurrency] || Object.keys(product.prices).sort().map((key) => product.prices[key])[0];
    if (!price) return json(409, { ok: false, error: 'access_price_not_available' });
    const config = storageConfig();
    if (!config) return json(503, { ok: false, error: 'media_access_storage_not_configured', payment: paymentPublicState(productsCatalog) });

    const created = await createPendingOrder(config, member, {
      productId,
      currency: price.currency,
      amountMinor: price.amountMinor,
      idempotencyKey: idempotencyKey(event, body, member.memberId),
      scopeType: rule.scopeType,
      scopeId: rule.scopeId,
      termsVersion: product.termsVersion,
      ttlMinutes: 30
    });
    const payment = paymentPublicState(productsCatalog);
    return json(202, {
      ok: true,
      order: created.order,
      created: created.created,
      payment,
      state: 'pg_pending_approval',
      message: 'The access order is prepared. Card payment remains disabled until the PG connection is approved and activated.'
    });
  } catch (error) {
    return json(error.statusCode || 500, { ok: false, error: error.code || 'media_access_order_failed', message: text(error.message || 'Unable to prepare the access order.', 360) });
  }
};
