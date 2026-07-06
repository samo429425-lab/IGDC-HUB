"use strict";

/**
 * Global Market Sale Scope v1
 *
 * Separates origin/manufacturer/headquarters from each independently verified
 * sale market. A candidate is materialized once per exact country/region sale
 * scope; origin, language, domain and generic international-shipping text are
 * never used to infer another market.
 */

const crypto = require("crypto");

const VERSION = "market-sale-scope-v1.1.0-market-evidence-integrity";
const DEFAULT_MAX_AGE_DAYS = 30;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function text(value) { return value == null ? "" : String(value).trim(); }
function lower(value) { return text(value).toLowerCase(); }
function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
function bool(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ["1", "true", "yes", "on", "verified", "available", "approved"].includes(lower(value));
}
function array(value) { return Array.isArray(value) ? value : (value == null || value === "" ? [] : [value]); }
function uniq(values) {
  const seen = new Set(); const out = [];
  for (const value of values || []) { const item = text(value); if (item && !seen.has(item)) { seen.add(item); out.push(item); } }
  return out;
}
function first() { for (const value of arguments) { const item = text(value); if (item) return item; } return ""; }
function nested(object, keys) { let current = object; for (const key of keys) { if (!isObject(current) || !(key in current)) return undefined; current = current[key]; } return current; }
function stable(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
}
function sha256(value) { return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : stable(value), "utf8")).digest("hex"); }

function normalizeCountry(value) {
  if (isObject(value)) value = value.code || value.countryCode || value.country || value.iso || value.alpha2 || "";
  const code = text(value).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
function normalizeRegion(value, country) {
  if (isObject(value)) value = value.code || value.regionCode || value.subdivisionCode || value.state || value.province || value.name || "";
  let code = text(value).toUpperCase().replace(/[._/\s]+/g, "-").replace(/^-+|-+$/g, "");
  const cc = normalizeCountry(country);
  if (cc && code.startsWith(cc + "-")) code = code.slice(3);
  if (code === "NATIONAL" || code === "NATIONWIDE") return "NATIONWIDE";
  return /^[A-Z0-9][A-Z0-9-]{1,15}$/.test(code) ? code : "";
}
function valuesFrom() {
  const output = [];
  for (const value of arguments) {
    if (Array.isArray(value)) output.push(...value);
    else if (value !== undefined && value !== null && text(value)) output.push(value);
  }
  return output;
}
function validIsoTimestamp(value, maxAgeDays) {
  const stamp = Date.parse(text(value));
  if (!Number.isFinite(stamp)) return false;
  const maximum = Math.max(1, Number(maxAgeDays) || DEFAULT_MAX_AGE_DAYS) * 86400000;
  const now = Date.now();
  return stamp <= now + FUTURE_SKEW_MS && stamp >= now - maximum;
}
function safeHttpsUrl(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:" || !url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) return "";
    url.hash = "";
    return url.toString();
  } catch (_e) { return ""; }
}

function contractOf(item) {
  const discernment = isObject(item && item.osaiDiscernment) ? item.osaiDiscernment : {};
  return (isObject(item && item.searchBankContract) && item.searchBankContract)
    || (isObject(item && item.sanmaruSearchBankContract) && item.sanmaruSearchBankContract)
    || (isObject(item && item.searchBankUnifiedContract) && item.searchBankUnifiedContract)
    || (isObject(discernment.searchBankContract) && discernment.searchBankContract)
    || {};
}
function mappingOf(item, contract) {
  const discernment = isObject(item && item.osaiDiscernment) ? item.osaiDiscernment : {};
  const candidates = [item && item.productMapping, item && item.ipSlotMapping, contract && contract.productMapping, contract && contract.ipSlotMapping, discernment && discernment.productMapping, discernment && discernment.ipSlotMapping];
  return candidates.find(isObject) || {};
}
function marketSourceObjects(item, contract, mapping) {
  const supply = isObject(item && item.countrySupply) ? item.countrySupply : {};
  return [
    mapping && mapping.marketAvailability, mapping && mapping.availability,
    contract && contract.marketAvailability, contract && contract.availability,
    item && item.marketAvailability, item && item.availability,
    supply && supply.marketAvailability, supply
  ].filter(isObject);
}
function recordList(source) {
  const output = [];
  if (isObject(source) && (source.country || source.countryCode || source.marketCountry || source.targetMarket || source.saleCountry)) output.push(source);
  for (const key of ["markets", "marketEntries", "marketScopes", "countryMarkets", "marketAvailability"]) {
    const value = source && source[key];
    if (Array.isArray(value)) output.push(...value);
  }
  for (const key of ["byCountry", "countryEvidence", "marketEvidenceByCountry", "countries"]) {
    const value = source && source[key];
    if (!isObject(value) || Array.isArray(value)) continue;
    for (const [country, entry] of Object.entries(value)) {
      if (isObject(entry)) output.push(Object.assign({ country }, entry));
      else if (entry === true) output.push({ country, available: true });
    }
  }
  return output.filter(isObject);
}
function normalizeService(value) {
  const src = isObject(value) ? clone(value) : {};
  const verified = bool(src.verified) || bool(src.available) || bool(src.confirmed) || bool(src.active);
  const evidenceUrl = first(src.policyUrl, src.url, src.evidenceUrl, src.proofUrl, src.serviceUrl, src.helpUrl, src.portalUrl);
  const evidence = valuesFrom(src.evidence, src.evidenceId, src.reference, src.policyId, evidenceUrl).map(text).filter(Boolean);
  return Object.assign({}, src, { verified, evidenceUrl: safeHttpsUrl(evidenceUrl) || null, evidence: uniq(evidence) });
}
function normalizeSeller(value) {
  const src = isObject(value) ? clone(value) : {};
  const verified = bool(src.verified) || bool(src.responsible) || bool(src.localResponsibilityVerified) || bool(src.merchantOfRecordVerified);
  const legalEntity = first(src.legalEntity, src.merchantOfRecord, src.entityName, src.name, src.provider);
  const supportUrl = first(src.supportUrl, src.customerServiceUrl, src.returnsUrl, src.servicePolicyUrl, src.contactUrl);
  return Object.assign({}, src, { verified, legalEntity: legalEntity || null, supportUrl: safeHttpsUrl(supportUrl) || null });
}
function evidenceProjection(service) {
  return {
    verified: !!(service && service.verified),
    evidenceUrl: service && service.evidenceUrl || null,
    evidence: (service && service.evidence || []).slice().sort()
  };
}
function evidenceFingerprint(record) {
  if (!record) return "";
  return sha256({
    country: record.country || null,
    regions: (record.regions || []).slice().sort(),
    nationwide: record.nationwide === true,
    active: record.active === true,
    verifiedAt: record.verifiedAt || null,
    shipping: evidenceProjection(record.shipping),
    returns: evidenceProjection(record.returns),
    support: evidenceProjection(record.support),
    sellerResponsibility: {
      verified: !!(record.sellerResponsibility && record.sellerResponsibility.verified),
      legalEntity: record.sellerResponsibility && record.sellerResponsibility.legalEntity || null,
      supportUrl: record.sellerResponsibility && record.sellerResponsibility.supportUrl || null
    },
    fulfillmentProvider: record.fulfillmentProvider || null,
    source: record.source || null,
    rawEvidence: (record.rawEvidence || []).slice().sort()
  });
}
function normalizeRecord(record, item, fallbackCountry) {
  const country = normalizeCountry(first(record && record.country, record && record.countryCode, record && record.marketCountry, record && record.targetMarket, record && record.saleCountry, fallbackCountry));
  if (!country) return null;
  const regionInputs = valuesFrom(
    record && record.regions, record && record.regionCodes, record && record.availabilityRegions,
    record && record.serviceRegions, record && record.targetRegion, record && record.region,
    record && record.regionCode, record && record.subdivision, record && record.state, record && record.province
  );
  const regions = uniq(regionInputs.map(value => normalizeRegion(value, country)).filter(value => value && value !== "NATIONWIDE"));
  const nationwide = bool(record && record.nationwide) || bool(record && record.nationalAvailability) || bool(record && record.nationwideAvailability) || regionInputs.some(value => normalizeRegion(value, country) === "NATIONWIDE");
  const availability = isObject(record && record.availability) ? record.availability : record || {};
  const shipping = normalizeService(firstObject(record && record.shipping, record && record.fulfilment, record && record.fulfillment, availability && availability.shipping, item && item.shipping));
  const returns = normalizeService(firstObject(record && record.returns, record && record.returnPolicy, availability && availability.returns, item && item.returns));
  const support = normalizeService(firstObject(record && record.support, record && record.customerSupport, availability && availability.support, item && item.support));
  const seller = normalizeSeller(firstObject(record && record.sellerResponsibility, record && record.localSeller, record && record.merchantOfRecord, item && item.sellerResponsibility, item && item.sellerProfile, item && item.merchantResponsibility));
  const fulfilledBy = first(record && record.fulfillmentProvider, record && record.fulfilmentProvider, record && record.shippingProvider, record && record.deliveryProvider, shipping && shipping.provider);
  const verifiedAt = first(record && record.verifiedAt, record && record.lastVerifiedAt, availability && availability.verifiedAt, availability && availability.lastVerifiedAt);
  const active = record && Object.prototype.hasOwnProperty.call(record, "active") ? bool(record.active) : true;
  const normalized = {
    country,
    regions,
    nationwide,
    active,
    verifiedAt: verifiedAt || null,
    shipping,
    returns,
    support,
    sellerResponsibility: seller,
    fulfillmentProvider: fulfilledBy || null,
    source: record && record.source ? clone(record.source) : null,
    rawEvidence: valuesFrom(record && record.evidence, record && record.evidenceId, record && record.reference).map(text).filter(Boolean)
  };
  normalized.evidenceDigest = evidenceFingerprint(normalized);
  return normalized;
}
function firstObject() { for (const value of arguments) if (isObject(value)) return value; return {}; }
function explicitRecords(item) {
  const contract = contractOf(item);
  const mapping = mappingOf(item, contract);
  const records = [];
  for (const source of marketSourceObjects(item, contract, mapping)) {
    for (const record of recordList(source)) {
      const normalized = normalizeRecord(record, item, "");
      if (normalized) records.push(normalized);
    }
  }
  const unique = new Map();
  for (const record of records) {
    const key = record.country + "|" + record.regions.slice().sort().join(",") + "|" + (record.nationwide ? "N" : "") + "|" + record.evidenceDigest;
    if (!unique.has(key)) unique.set(key, record);
  }
  return Array.from(unique.values());
}
function legacySingleMarket(item) {
  const contract = contractOf(item);
  const mapping = mappingOf(item, contract);
  const supply = isObject(item && item.countrySupply) ? item.countrySupply : {};
  const country = normalizeCountry(first(item && item.targetCountry, item && item.countryCode, supply.targetMarket, mapping && mapping.targetCountry, contract && contract.targetCountry, item && item.distributionMarketCountry));
  if (!country) return null;
  return normalizeRecord({
    country,
    targetRegion: first(item && item.targetRegion, supply.targetRegion, mapping && mapping.targetRegion, contract && contract.targetRegion),
    nationwide: bool(supply.nationalAvailability) || bool(item && item.nationalAvailability),
    verifiedAt: first(supply.verifiedAt, item && item.marketAvailabilityVerifiedAt, contract && contract.marketAvailabilityVerifiedAt),
    shipping: firstObject(item && item.shipping, supply.shipping),
    returns: firstObject(item && item.returns, supply.returns),
    support: firstObject(item && item.support, supply.support),
    sellerResponsibility: firstObject(item && item.sellerResponsibility, contract && contract.sellerResponsibility, mapping && mapping.sellerResponsibility)
  }, item, country);
}
function recordsFor(item) {
  const explicit = explicitRecords(item);
  const legacy = legacySingleMarket(item);
  return explicit.length ? explicit : (legacy ? [legacy] : []);
}
function resolveForCountry(item, country) {
  const wanted = normalizeCountry(country);
  if (!wanted) return null;
  const scoped = isObject(item && item.marketScope) && isObject(item.marketScope.marketEvidence)
    ? normalizeRecord(item.marketScope.marketEvidence, item, item.marketScope.marketCountry)
    : null;
  if (scoped && scoped.country === wanted) return scoped;
  return recordsFor(item).find(record => record.country === wanted) || null;
}
function regionsFor(record) {
  const output = [];
  for (const region of record && record.regions || []) output.push(region);
  if (record && record.nationwide) output.push("NATIONWIDE");
  return uniq(output);
}
function marketKey(record, region) { return [record.country, normalizeRegion(region, record.country) || "NATIONWIDE"].join("-"); }
function originCountry(item) { return normalizeCountry(first(item && item.originCountry, item && item.manufacturingCountry, nested(item, ["product", "originCountry"]), nested(item, ["producer", "country"]))); }
function materialize(item, record, region) {
  const out = clone(item);
  const marketRegion = normalizeRegion(region, record.country) || "NATIONWIDE";
  const key = marketKey(record, marketRegion);
  const evidence = clone(record);
  const digest = evidenceFingerprint(evidence);
  evidence.evidenceDigest = digest;
  out.marketScope = {
    schema: VERSION,
    key,
    marketCountry: record.country,
    marketRegion,
    originCountry: originCountry(item) || null,
    marketEvidence: evidence,
    marketEvidenceDigest: digest,
    sourceCountryIsNotEligibilityGate: true
  };
  out.targetCountry = record.country;
  out.targetRegion = marketRegion;
  out.country = record.country;
  out.region = marketRegion;
  out.distributionMarketCountry = record.country;
  out.distributionMarketRegion = marketRegion === "NATIONWIDE" ? null : marketRegion;
  out.sellerMarketCountry = record.country;
  out.availabilityCountries = [record.country];
  out.availabilityRegions = record.regions.slice();
  out.nationalAvailability = record.nationwide === true;
  out.marketAvailabilityVerifiedAt = record.verifiedAt;
  out.shipping = Object.assign({}, isObject(out.shipping) ? out.shipping : {}, clone(record.shipping));
  out.returns = Object.assign({}, isObject(out.returns) ? out.returns : {}, clone(record.returns));
  out.support = Object.assign({}, isObject(out.support) ? out.support : {}, clone(record.support));
  out.sellerResponsibility = Object.assign({}, isObject(out.sellerResponsibility) ? out.sellerResponsibility : {}, clone(record.sellerResponsibility));
  out.marketAvailability = Object.assign({}, clone(record), { countries: [record.country], countryCodes: [record.country], targetMarket: record.country, regions: record.regions.slice(), nationwide: record.nationwide, nationalAvailability: record.nationwide, verifiedAt: record.verifiedAt, markets: [clone(record)] });
  out.countrySupply = Object.assign({}, isObject(out.countrySupply) ? out.countrySupply : {}, {
    targetMarket: record.country,
    targetRegion: marketRegion,
    availabilityCountries: [record.country],
    availabilityRegions: record.regions.slice(),
    nationalAvailability: record.nationwide,
    verifiedAt: record.verifiedAt,
    marketAvailability: clone(out.marketAvailability),
    shipping: clone(record.shipping),
    returns: clone(record.returns),
    support: clone(record.support),
    sellerResponsibility: clone(record.sellerResponsibility)
  });
  const contract = contractOf(out);
  if (isObject(contract)) {
    contract.marketAvailability = clone(out.marketAvailability);
    contract.availability = clone(out.marketAvailability);
    contract.sellerResponsibility = clone(record.sellerResponsibility);
  }
  const mapping = mappingOf(out, contract);
  if (isObject(mapping)) {
    mapping.marketAvailability = clone(out.marketAvailability);
    mapping.availability = clone(out.marketAvailability);
    mapping.sellerResponsibility = clone(record.sellerResponsibility);
  }
  return out;
}
function expand(item) {
  const records = recordsFor(item);
  const output = [];
  for (const record of records) {
    if (!record.active) continue;
    for (const region of regionsFor(record)) output.push({ key: marketKey(record, region), record, item: materialize(item, record, region) });
  }
  return output;
}
function hasEvidence(service) { return !!(service && service.verified === true && ((service.evidence && service.evidence.length) || service.evidenceUrl)); }
function validateMarketRecord(record, options) {
  const rules = isObject(options) ? options : {};
  const reasons = [];
  if (!record || !record.country) reasons.push("MARKET_COUNTRY_MISSING");
  if (!record || !record.active) reasons.push("MARKET_INACTIVE");
  if (!record || (!record.nationwide && !(record.regions && record.regions.length))) reasons.push("MARKET_SCOPE_MISSING");
  if (!record || !record.verifiedAt) reasons.push("MARKET_VERIFICATION_TIMESTAMP_MISSING");
  else if (rules.requireFresh !== false && !validIsoTimestamp(record.verifiedAt, rules.maxVerificationAgeDays)) reasons.push("MARKET_VERIFICATION_TIMESTAMP_STALE_OR_INVALID");
  if (!hasEvidence(record && record.shipping)) reasons.push("MARKET_SHIPPING_EVIDENCE_MISSING");
  if (!hasEvidence(record && record.returns)) reasons.push("MARKET_RETURNS_EVIDENCE_MISSING");
  if (!hasEvidence(record && record.support)) reasons.push("MARKET_SUPPORT_EVIDENCE_MISSING");
  const seller = record && record.sellerResponsibility;
  if (!(seller && seller.verified && seller.legalEntity && seller.supportUrl)) reasons.push("MARKET_RESPONSIBLE_SELLER_EVIDENCE_MISSING");
  if (record && record.evidenceDigest && record.evidenceDigest !== evidenceFingerprint(record)) reasons.push("MARKET_EVIDENCE_DIGEST_MISMATCH");
  return { ok: reasons.length === 0, reasons, evidenceDigest: record ? evidenceFingerprint(record) : "" };
}
function validateMarketScope(scope, countryInput, regionInput, options) {
  const country = normalizeCountry(countryInput);
  const region = normalizeRegion(regionInput, country);
  const reasons = [];
  if (!isObject(scope)) reasons.push("MARKET_SCOPE_ENVELOPE_MISSING");
  const scopeCountry = normalizeCountry(scope && scope.marketCountry);
  const scopeRegion = normalizeRegion(scope && scope.marketRegion, scopeCountry);
  if (!scopeCountry || scopeCountry !== country) reasons.push("MARKET_SCOPE_COUNTRY_MISMATCH");
  if (!scopeRegion || scopeRegion !== region) reasons.push("MARKET_SCOPE_REGION_MISMATCH");
  if (scope && scope.key !== marketKey({ country: scopeCountry || country }, scopeRegion || region)) reasons.push("MARKET_SCOPE_KEY_MISMATCH");
  const record = scope && scope.marketEvidence;
  const recordResult = validateMarketRecord(record, options);
  reasons.push(...recordResult.reasons);
  if (record && scopeCountry && record.country !== scopeCountry) reasons.push("MARKET_SCOPE_RECORD_COUNTRY_MISMATCH");
  const digest = recordResult.evidenceDigest;
  if (scope && scope.marketEvidenceDigest && scope.marketEvidenceDigest !== digest) reasons.push("MARKET_SCOPE_ENVELOPE_DIGEST_MISMATCH");
  return { ok: reasons.length === 0, reasons: uniq(reasons), evidenceDigest: digest, record };
}

module.exports = { VERSION, DEFAULT_MAX_AGE_DAYS, normalizeCountry, normalizeRegion, recordsFor, resolveForCountry, expand, materialize, validateMarketRecord, validateMarketScope, evidenceFingerprint, marketKey, sha256 };
