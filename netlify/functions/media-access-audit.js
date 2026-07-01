'use strict';

/* Owner/admin readiness audit for stages 7–10. No entitlement mutation. */
const { authenticateMember } = require('./lib/media-member-auth');
const { productList, paymentPublicState, readAccessProducts, text } = require('./lib/media-access-policy');
const { storageConfig } = require('./lib/media-access-store');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body || {})
  };
}
function adminMember(member) {
  const roles = Array.isArray(member && member.roles) ? member.roles.map((value) => text(value, 80).toLowerCase()) : [];
  return roles.some((role) => ['owner', 'admin', 'administrator', 'site_admin', 'super_admin'].includes(role));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });
  try {
    const member = await authenticateMember(event);
    if (!adminMember(member)) return json(403, { ok: false, error: 'admin_role_required' });
    const catalog = readAccessProducts();
    const products = productList(catalog);
    const ready = products.filter((product) => product.status === 'active' && Object.keys(product.prices || {}).length > 0).length;
    const storage = storageConfig();
    return json(200, {
      ok: true,
      version: 'media.access.audit.v1',
      payment: paymentPublicState(catalog),
      storage: storage ? 'configured' : 'not_configured',
      lifecycle: {
        enabled: false,
        note: 'No PG webhook or manual lifecycle mutation is enabled in this stage.'
      },
      products: {
        total: products.length,
        activePriced: ready,
        pending: products.length - ready,
        items: products.map((product) => ({
          productId: product.productId,
          status: product.status,
          billingType: product.billing.type,
          scopeType: product.scope.type,
          priceCurrencies: Object.keys(product.prices || {}).sort(),
          termsVersion: product.termsVersion || null
        }))
      },
      requiredBeforeLive: [
        'approved_card_pg_account',
        'server_side_provider_adapter',
        'signed_webhook_verification',
        'entitlements_orders_events_tables',
        'rights_cleared_content_and_delivery_profile',
        'published_terms_refund_and_privacy_text'
      ]
    });
  } catch (error) {
    return json(error.statusCode || 500, { ok: false, error: error.code || 'media_access_audit_failed', message: text(error.message || 'Unable to audit media access.', 360) });
  }
};
