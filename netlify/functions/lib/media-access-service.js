'use strict';

/*
 * Media Hub OTT entitlement decision service — stages 7–10.
 *
 * The service is intentionally fail-closed for every non-free catalog rule.
 * It keeps stages 1–6 pilot-member-free titles unchanged and returns only
 * redacted access/offer data to the browser.
 */
const {
  accessRule,
  eligibleProducts,
  paymentPublicState,
  productList,
  publicProduct,
  readAccessProducts,
  text
} = require('./media-access-policy');
const { entitlementActive, listEntitlements, storageConfig } = require('./media-access-store');

function memberPublic(member) {
  return {
    member: true,
    roles: Array.isArray(member && member.roles) ? member.roles.slice(0, 20) : []
  };
}
function entitlementMatches(entitlement, rule) {
  if (!entitlement || !rule || !entitlementActive(entitlement)) return false;
  if (!rule.productIds.includes(entitlement.productId)) return false;
  if (entitlement.scopeType === 'catalog' && entitlement.scopeId === 'global') return true;
  return entitlement.scopeType === rule.scopeType && entitlement.scopeId === rule.scopeId;
}
function publicEntitlement(entitlement) {
  return {
    productId: entitlement.productId,
    scopeType: entitlement.scopeType,
    scopeId: entitlement.scopeId,
    status: entitlement.status,
    validUntil: entitlement.validUntil,
    source: entitlement.source
  };
}
function publicRule(rule) {
  return {
    mode: rule.mode,
    scope: { type: rule.scopeType, id: rule.scopeId },
    requiresPayment: rule.mode !== 'member_free',
    requiresTerms: rule.requireTerms === true
  };
}
function entitlementResponse(rule, productsCatalog, state, entitlements, extra) {
  const offers = eligibleProducts(rule, productsCatalog).map((product) => publicProduct(product));
  return Object.assign({
    allowed: state === 'granted' || state === 'member_free',
    state,
    rule: publicRule(rule),
    offers,
    activeEntitlements: (entitlements || []).filter((item) => entitlementMatches(item, rule)).map(publicEntitlement),
    payment: paymentPublicState(productsCatalog)
  }, extra || {});
}

async function evaluateMediaAccess(member, item, context) {
  const rule = accessRule(item, context);
  const productsCatalog = readAccessProducts();
  if (!rule.valid || rule.availability === 'disabled') {
    return entitlementResponse(rule, productsCatalog, 'configuration_pending', [], {
      allowed: false,
      code: 'media_access_not_configured',
      httpStatus: 503
    });
  }
  if (rule.mode === 'member_free') {
    return entitlementResponse(rule, productsCatalog, 'member_free', [], { allowed: true, code: null, httpStatus: 200 });
  }
  const config = storageConfig();
  if (!config) {
    return entitlementResponse(rule, productsCatalog, 'storage_pending', [], {
      allowed: false,
      code: 'media_access_not_configured',
      httpStatus: 503
    });
  }
  const entitlements = await listEntitlements(config, member, 100);
  if (entitlements.some((entry) => entitlementMatches(entry, rule))) {
    return entitlementResponse(rule, productsCatalog, 'granted', entitlements, { allowed: true, code: null, httpStatus: 200 });
  }
  const response = entitlementResponse(rule, productsCatalog, 'required', entitlements, {
    allowed: false,
    code: 'media_access_required',
    httpStatus: 402
  });
  if (!response.offers.length) {
    response.state = 'offer_pending';
    response.code = 'media_access_offer_unavailable';
    response.httpStatus = 503;
  }
  return response;
}

async function memberAccessSummary(member) {
  const productsCatalog = readAccessProducts();
  const config = storageConfig();
  const entitlements = config ? await listEntitlements(config, member, 100) : [];
  const now = Date.now();
  return {
    ok: true,
    version: 'media.access.v1',
    member: memberPublic(member),
    storage: config ? 'server' : 'not_configured',
    payment: paymentPublicState(productsCatalog),
    products: productList(productsCatalog).filter((product) => Object.keys(product.prices || {}).length > 0 && product.status === 'active')
      .map((product) => publicProduct(product)),
    entitlements: entitlements.map((entry) => Object.assign(publicEntitlement(entry), { active: entitlementActive(entry, now) }))
  };
}


module.exports = { evaluateMediaAccess, memberAccessSummary, publicRule };
