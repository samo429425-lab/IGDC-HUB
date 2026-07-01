'use strict';

/*
 * Media Hub OTT access-product policy — stages 7–10.
 *
 * This module contains no payment credential and never decides a price from
 * client input. It only reads the server-side access-product configuration,
 * normalizes catalog access rules, and exposes redacted product details.
 */
const fs = require('fs');
const path = require('path');
const { contentId, text } = require('./media-catalog-policy');

const ACCESS_MODE_ALIASES = Object.freeze({
  member_free: 'member_free',
  pilot_member_free: 'member_free',
  free_member: 'member_free',
  entitlement: 'entitlement',
  pass: 'entitlement',
  access_pass: 'entitlement',
  subscription: 'subscription',
  recurring: 'subscription',
  transaction: 'transaction',
  rental: 'transaction',
  purchase: 'transaction'
});
const ACCESS_MODES = new Set(['member_free', 'entitlement', 'subscription', 'transaction']);
const SCOPE_TYPES = new Set(['content', 'series', 'catalog']);
const CURRENCIES = new Set(['USD', 'CNY', 'EUR']);
const MAX_PRODUCT_IDS = 24;

function clean(value) { return String(value == null ? '' : value).replace(/[\u0000-\u001F]/g, ' ').trim(); }
function enabled(value) { return /^(1|true|yes)$/i.test(clean(value)); }
function safeId(value, maximum) {
  const raw = clean(value);
  const cap = Number(maximum) || 120;
  return raw && raw.length <= cap && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw) ? raw : '';
}
function iso(value) {
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';
}
function bool(value) { return value === true || value === 1 || value === '1' || value === 'true'; }

function firstJson(locations, fallback) {
  for (const file of locations) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
  }
  return fallback;
}
function secureLocations(name) {
  return [
    path.join(__dirname, '..', 'secure', name),
    path.join(process.cwd(), 'netlify', 'functions', 'secure', name)
  ];
}
function readAccessProducts() {
  const fallback = {
    version: 'media.access.products.v1',
    updatedAt: null,
    policy: { paymentMode: 'pg_pending_approval', allowedCurrencies: ['USD', 'CNY', 'EUR'], defaultCurrency: 'USD' },
    products: {}
  };
  const value = firstJson(secureLocations('media-access-products.json'), fallback);
  return value && typeof value === 'object' ? value : fallback;
}

function productList(catalog) {
  const raw = catalog && catalog.products;
  const items = Array.isArray(raw) ? raw : (raw && typeof raw === 'object'
    ? Object.keys(raw).map((id) => Object.assign({ productId: id }, raw[id] || {}))
    : []);
  const seen = new Set();
  return items.map((item) => normalizeProduct(item)).filter((item) => {
    if (!item || seen.has(item.productId)) return false;
    seen.add(item.productId);
    return true;
  });
}

function normalizePrice(value, currency) {
  const row = value && typeof value === 'object' ? value : {};
  const amount = Number(row.amountMinor != null ? row.amountMinor : row.amount_minor);
  if (!CURRENCIES.has(currency) || !Number.isSafeInteger(amount) || amount < 0 || amount > 999999999) return null;
  return {
    currency,
    amountMinor: amount,
    taxIncluded: bool(row.taxIncluded),
    label: text(row.label || '', 120)
  };
}
function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const productId = safeId(raw.productId || raw.id, 120);
  if (!productId) return null;
  const status = text(raw.status || 'draft', 40).toLowerCase();
  const billingRaw = raw.billing && typeof raw.billing === 'object' ? raw.billing : {};
  const billingType = text(billingRaw.type || billingRaw.kind || raw.billingType || 'one_time', 40).toLowerCase();
  const durationDays = Number(billingRaw.durationDays != null ? billingRaw.durationDays : raw.durationDays);
  const scopesRaw = raw.scope && typeof raw.scope === 'object' ? raw.scope : {};
  const scopeType = text(scopesRaw.type || raw.scopeType || 'content', 32).toLowerCase();
  const scopeIdsInput = Array.isArray(scopesRaw.ids) ? scopesRaw.ids : (Array.isArray(raw.scopeIds) ? raw.scopeIds : []);
  const scopeIds = [...new Set(scopeIdsInput.map((value) => contentId(value)).filter(Boolean))].slice(0, 300);
  const pricesRaw = raw.prices && typeof raw.prices === 'object' ? raw.prices : {};
  const prices = {};
  Object.keys(pricesRaw).forEach((code) => {
    const currency = text(code, 12).toUpperCase();
    const price = normalizePrice(pricesRaw[code], currency);
    if (price) prices[currency] = price;
  });
  const territoriesRaw = Array.isArray(raw.territories) ? raw.territories : ['global'];
  const territories = [...new Set(territoriesRaw.map((value) => text(value, 40).toLowerCase()).filter((value) => value === 'global' || /^[a-z]{2}$/i.test(value)))].slice(0, 300);
  const product = {
    productId,
    status,
    title: text(raw.title || raw.name || productId, 180),
    description: text(raw.description || raw.summary || '', 1000),
    billing: {
      type: ['one_time', 'recurring'].includes(billingType) ? billingType : 'one_time',
      durationDays: Number.isInteger(durationDays) && durationDays > 0 && durationDays <= 36500 ? durationDays : null,
      renewsAutomatically: bool(billingRaw.renewsAutomatically)
    },
    scope: { type: SCOPE_TYPES.has(scopeType) ? scopeType : 'content', ids: scopeIds },
    prices,
    territories,
    refundWindowHours: Number.isInteger(Number(raw.refundWindowHours)) && Number(raw.refundWindowHours) >= 0 && Number(raw.refundWindowHours) <= 24 * 365
      ? Number(raw.refundWindowHours) : null,
    termsVersion: text(raw.termsVersion || '', 80),
    availableFrom: iso(raw.availableFrom),
    availableUntil: iso(raw.availableUntil)
  };
  return product;
}

function normalizedMode(value) {
  const key = text(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return ACCESS_MODE_ALIASES[key] || '';
}
function idsFrom(value) {
  const raw = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
  return [...new Set(raw.map((entry) => safeId(entry, 120)).filter(Boolean))].slice(0, MAX_PRODUCT_IDS);
}

/*
 * Catalog access rule. Legacy pilot.member_free remains the default, so stages
 * 1–6 continue exactly as before until an item explicitly receives access{}.
 */
function accessRule(item, context) {
  const source = item && item.access && typeof item.access === 'object' ? item.access : {};
  const pilot = item && item.pilot && typeof item.pilot === 'object' ? item.pilot : {};
  const mode = normalizedMode(source.mode || source.model || pilot.access || 'member_free') || 'member_free';
  const issues = [];
  const requestedScope = text(source.scope || source.scopeType || '', 32).toLowerCase();
  const seriesRootId = contentId(context && (context.rootContentId || context.seriesId));
  const currentContentId = contentId(context && context.contentId) || contentId(item && (item.contentId || item.id));
  let scopeType = requestedScope || (seriesRootId && seriesRootId !== currentContentId ? 'series' : 'content');
  if (!SCOPE_TYPES.has(scopeType)) {
    issues.push('access_scope_not_allowed');
    scopeType = 'content';
  }
  const scopeId = scopeType === 'catalog' ? 'global' : (scopeType === 'series' ? seriesRootId : currentContentId);
  if (mode !== 'member_free' && !scopeId) issues.push('access_scope_id_missing');
  const productIds = idsFrom(source.productIds || source.products || source.productId);
  if (mode !== 'member_free' && !productIds.length) issues.push('access_product_missing');
  const availability = text(source.availability || 'active', 32).toLowerCase();
  if (!['active', 'scheduled', 'disabled'].includes(availability)) issues.push('access_availability_not_allowed');
  return {
    valid: issues.length === 0,
    issues,
    mode,
    scopeType,
    scopeId,
    productIds,
    availability: ['active', 'scheduled', 'disabled'].includes(availability) ? availability : 'disabled',
    requireTerms: source.requireTerms !== false
  };
}

function productAvailable(product, now) {
  const at = now || Date.now();
  if (!product || product.status !== 'active') return false;
  if (product.availableFrom && Date.parse(product.availableFrom) > at) return false;
  if (product.availableUntil && Date.parse(product.availableUntil) <= at) return false;
  return Object.keys(product.prices || {}).length > 0;
}
function eligibleProducts(rule, catalog, now) {
  const wanted = new Set(rule && Array.isArray(rule.productIds) ? rule.productIds : []);
  const targetScope = rule && rule.scopeType;
  const targetId = rule && rule.scopeId;
  return productList(catalog).filter((product) => {
    if (!wanted.has(product.productId) || !productAvailable(product, now)) return false;
    if (product.scope.type === 'catalog') return true;
    if (product.scope.type !== targetScope) return false;
    return product.scope.ids.includes(targetId);
  });
}
function defaultCurrency(catalog) {
  const policy = catalog && catalog.policy && typeof catalog.policy === 'object' ? catalog.policy : {};
  const candidate = text(policy.defaultCurrency || 'USD', 12).toUpperCase();
  return CURRENCIES.has(candidate) ? candidate : 'USD';
}
function allowedCurrencies(catalog) {
  const policy = catalog && catalog.policy && typeof catalog.policy === 'object' ? catalog.policy : {};
  const raw = Array.isArray(policy.allowedCurrencies) ? policy.allowedCurrencies : ['USD', 'CNY', 'EUR'];
  const values = [...new Set(raw.map((value) => text(value, 12).toUpperCase()).filter((value) => CURRENCIES.has(value)))];
  return values.length ? values : ['USD', 'CNY', 'EUR'];
}
function publicProduct(product, preferredCurrency) {
  if (!product) return null;
  const currency = CURRENCIES.has(text(preferredCurrency, 12).toUpperCase()) ? text(preferredCurrency, 12).toUpperCase() : '';
  const selected = currency && product.prices[currency]
    ? product.prices[currency]
    : Object.keys(product.prices).sort().map((code) => product.prices[code])[0] || null;
  return {
    productId: product.productId,
    title: product.title,
    description: product.description,
    billing: product.billing,
    scope: { type: product.scope.type },
    price: selected ? { currency: selected.currency, amountMinor: selected.amountMinor, taxIncluded: selected.taxIncluded, label: selected.label } : null,
    availableCurrencies: Object.keys(product.prices).sort(),
    refundWindowHours: product.refundWindowHours,
    termsVersion: product.termsVersion || null
  };
}
function paymentPublicState(catalog) {
  const policy = catalog && catalog.policy && typeof catalog.policy === 'object' ? catalog.policy : {};
  const approved = enabled(process.env.MEDIA_ACCESS_PG_APPROVED);
  const executionEnabled = enabled(process.env.MEDIA_ACCESS_PG_EXECUTION_ENABLED);
  const provider = text(process.env.MEDIA_ACCESS_PAYMENT_PROVIDER || '', 80).toLowerCase();
  // There is intentionally no live provider adapter in stages 7–10. Even if
  // variables are accidentally set, checkout remains unavailable until a later,
  // provider-specific server adapter is installed and explicitly enabled.
  const adapterInstalled = false;
  const live = approved && executionEnabled && Boolean(provider) && adapterInstalled;
  return {
    state: live ? 'live' : 'pg_pending_approval',
    live,
    provider: live ? provider : null,
    allowedCurrencies: allowedCurrencies(catalog),
    defaultCurrency: defaultCurrency(catalog),
    cardOnly: true
  };
}

module.exports = {
  ACCESS_MODES,
  CURRENCIES,
  SCOPE_TYPES,
  accessRule,
  allowedCurrencies,
  clean,
  defaultCurrency,
  eligibleProducts,
  enabled,
  paymentPublicState,
  productAvailable,
  productList,
  publicProduct,
  readAccessProducts,
  safeId,
  text
};
