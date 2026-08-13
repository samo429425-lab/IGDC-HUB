"use strict";

/**
 * IP Slot Policy v1
 *
 * PSOM remains the strategic page/section registry. This module holds the
 * stricter operational contract for pages whose product thumbnails must be
 * resolved by the visitor's country and region. It never infers a seller's
 * service area from the visitor IP; it only validates supply that the upper
 * engine has explicitly evidenced.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const MarketSaleScope = require("./market-sale-scope.v1");

const VERSION = "ip-slot-policy-runtime-v1.3.3-optional-sponsorship-mode";
const POLICY_FILE = "ip-slot-policy.v1.json";

function text(value) { return value == null ? "" : String(value).trim(); }
function lower(value) { return text(value).toLowerCase(); }
function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function array(value) { return Array.isArray(value) ? value : (value == null ? [] : [value]); }
function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
function sha256(value) {
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(stable(value), "utf8");
  return crypto.createHash("sha256").update(raw).digest("hex");
}
function stable(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
}
function safeRead(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { return null; } }
function rootOf(input) { return path.resolve(typeof input === "string" ? input : (input && input.root) || process.cwd()); }
function policyPaths(root) {
  return [
    path.join(root, "data", POLICY_FILE),
    path.join(root, "netlify", "functions", "data", POLICY_FILE)
  ];
}
function truthy(value) { return value === true || value === 1 || ["true", "1", "yes", "on"].includes(lower(value)); }
function first() { for (const value of arguments) { const candidate = text(value); if (candidate) return candidate; } return ""; }
function nested(object, pathList) {
  let current = object;
  for (const key of pathList) {
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}
function valuesFrom() {
  const out = [];
  for (const value of arguments) {
    for (const entry of array(value)) {
      const normalized = text(entry);
      if (normalized) out.push(normalized);
    }
  }
  return Array.from(new Set(out));
}
function normalizeCountry(value) {
  const code = text(value).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
function normalizeRegion(value, country) {
  let code = text(value).toUpperCase().replace(/[._/\s]+/g, "-").replace(/^-+|-+$/g, "");
  const upperCountry = normalizeCountry(country);
  if (upperCountry && code.startsWith(upperCountry + "-")) code = code.slice(3);
  if (code === "NATIONAL" || code === "NATIONWIDE") return "NATIONWIDE";
  return /^[A-Z0-9][A-Z0-9-]{1,15}$/.test(code) ? code : "";
}
function parseDate(value) { const stamp = Date.parse(text(value)); return Number.isFinite(stamp) ? stamp : NaN; }
function fresh(value, maxDays) {
  const stamp = parseDate(value);
  if (!Number.isFinite(stamp)) return false;
  const now = Date.now();
  const maxAge = Math.max(1, Number(maxDays) || 30) * 86400000;
  return stamp <= now + 5 * 60 * 1000 && stamp >= now - maxAge;
}

function validatePolicy(policy) {
  const problems = [];
  if (!isObject(policy)) return ["IP_SLOT_POLICY_MISSING_OR_INVALID"];
  if (!Array.isArray(policy.ipScopedPages) || !policy.ipScopedPages.length) problems.push("IP_SCOPED_PAGES_MISSING");
  if (!isObject(policy.slotStrategies)) problems.push("IP_SLOT_STRATEGIES_MISSING");
  const pages = Array.isArray(policy.ipScopedPages) ? policy.ipScopedPages : [];
  for (const page of pages) {
    if (!isObject(policy.slotStrategies && policy.slotStrategies[page])) problems.push("IP_SLOT_STRATEGY_PAGE_MISSING:" + page);
  }
  return problems;
}

function load(rootInput) {
  const root = rootOf(rootInput);
  const [sourcePath, mirrorPath] = policyPaths(root);
  const source = safeRead(sourcePath);
  const mirror = safeRead(mirrorPath);
  const problems = [];
  if (!source) problems.push("IP_SLOT_POLICY_SOURCE_MISSING");
  if (!mirror) problems.push("IP_SLOT_POLICY_MIRROR_MISSING");
  if (source && mirror && sha256(source) !== sha256(mirror)) problems.push("IP_SLOT_POLICY_MIRROR_DIVERGED");
  const policy = source || mirror || {};
  problems.push(...validatePolicy(policy));
  return {
    ok: problems.length === 0,
    version: VERSION,
    policy,
    fingerprint: sha256(policy),
    source: sourcePath,
    mirror: mirrorPath,
    problems
  };
}

function strategyFor(policyOrLoaded, page, section) {
  const policy = policyOrLoaded && policyOrLoaded.policy ? policyOrLoaded.policy : policyOrLoaded;
  if (!policy || !isObject(policy.slotStrategies)) return null;
  const pageStrategies = policy.slotStrategies[page];
  if (!isObject(pageStrategies)) return null;
  const strategy = pageStrategies[section];
  return isObject(strategy) ? clone(strategy) : null;
}
function isScoped(policyOrLoaded, page, section) { return !!strategyFor(policyOrLoaded, page, section); }
function policyValidation(policyOrLoaded) {
  const policy = policyOrLoaded && policyOrLoaded.policy ? policyOrLoaded.policy : policyOrLoaded;
  return isObject(policy && policy.validation) ? policy.validation : {};
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
  const sources = [
    item && item.productMapping,
    item && item.ipSlotMapping,
    contract && contract.productMapping,
    contract && contract.ipSlotMapping,
    discernment && discernment.productMapping,
    discernment && discernment.ipSlotMapping
  ];
  for (const source of sources) if (isObject(source)) return source;
  return {};
}
function availabilityOf(item, contract, mapping) {
  const supply = isObject(item && item.countrySupply) ? item.countrySupply : {};
  const sources = [
    mapping && mapping.marketAvailability,
    mapping && mapping.availability,
    contract && contract.marketAvailability,
    contract && contract.availability,
    supply
  ];
  for (const source of sources) if (isObject(source)) return source;
  return {};
}
function sellerOf(item, contract, mapping) {
  const sources = [
    mapping && mapping.sellerResponsibility,
    contract && contract.sellerResponsibility,
    item && item.sellerResponsibility,
    item && item.sellerProfile,
    item && item.merchantResponsibility
  ];
  for (const source of sources) if (isObject(source)) return source;
  return {};
}
function marketRecordOf(item, country) {
  return MarketSaleScope.resolveForCountry(item, country);
}
function objectEvidence(value) {
  if (Array.isArray(value)) return value.filter(v => text(v));
  if (typeof value === "string") return text(value) ? [text(value)] : [];
  if (isObject(value)) return Object.values(value).flatMap(objectEvidence).filter(Boolean);
  return [];
}
function normalizedClasses(mapping, item, contract) {
  return valuesFrom(
    mapping && mapping.productClass,
    mapping && mapping.productClasses,
    mapping && mapping.class,
    contract && contract.productClass,
    item && item.productClass
  ).map(lower);
}
function exactProfile(mapping, contract, item) {
  return lower(first(
    mapping && mapping.slotProfile,
    mapping && mapping.profile,
    contract && contract.slotProfile,
    item && item.slotProfile
  ));
}
function productIdentity(mapping, item, contract) {
  const identity = first(
    mapping && mapping.productIdentity,
    mapping && mapping.catalogIdentity,
    mapping && mapping.sku,
    mapping && mapping.productId,
    contract && contract.productIdentity,
    item && item.productIdentity,
    item && item.productId,
    item && item.sku,
    item && item.gtin
  );
  return identity;
}
function declaredCountries(availability, item) {
  const supply = isObject(item && item.countrySupply) ? item.countrySupply : {};
  return valuesFrom(
    availability && availability.countries,
    availability && availability.countryCodes,
    availability && availability.targetMarket,
    availability && availability.country,
    supply && supply.availabilityCountries,
    supply && supply.targetMarket,
    item && item.targetCountry,
    item && item.countryCode
  ).map(normalizeCountry).filter(Boolean);
}
function declaredRegions(availability, item, country) {
  const supply = isObject(item && item.countrySupply) ? item.countrySupply : {};
  return valuesFrom(
    availability && availability.regions,
    availability && availability.regionCodes,
    availability && availability.targetRegion,
    availability && availability.region,
    supply && supply.availabilityRegions,
    supply && supply.targetRegion,
    item && item.targetRegion,
    nested(item, ["geo", "regionCode"])
  ).map(value => normalizeRegion(value, country)).filter(Boolean);
}
function availabilityVerifiedAt(availability, mapping, contract, item) {
  return first(
    availability && availability.verifiedAt,
    availability && availability.lastVerifiedAt,
    mapping && mapping.marketAvailabilityVerifiedAt,
    contract && contract.marketAvailabilityVerifiedAt,
    item && item.marketAvailabilityVerifiedAt,
    nested(item, ["countrySupply", "verifiedAt"]),
    nested(item, ["countrySupply", "lastVerifiedAt"])
  );
}
function explicitRegionCode(item, contract, mapping, country) {
  return normalizeRegion(first(
    mapping && mapping.regionCode,
    mapping && mapping.targetRegionCode,
    contract && contract.regionCode,
    contract && contract.targetRegionCode,
    nested(item, ["marketScope", "marketRegion"]),
    nested(item, ["marketScope", "marketEvidence", "regionCode"]),
    nested(item, ["geo", "regionCode"]),
    nested(item, ["countrySupply", "regionCode"]),
    nested(item, ["countrySupply", "targetRegionCode"])
  ), country);
}
function hasSellerResponsibility(seller) {
  const verified = truthy(seller && seller.verified) || truthy(seller && seller.responsible) || truthy(seller && seller.localResponsibilityVerified);
  const entity = first(seller && seller.legalEntity, seller && seller.merchantOfRecord, seller && seller.name, seller && seller.provider);
  const service = first(seller && seller.supportUrl, seller && seller.customerServiceUrl, seller && seller.returnsUrl, seller && seller.servicePolicyUrl);
  return verified && !!entity && !!service;
}
function sponsorshipOf(item, contract, mapping) {
  return (mapping && isObject(mapping.sponsorship) && mapping.sponsorship)
    || (contract && isObject(contract.sponsorship) && contract.sponsorship)
    || (item && isObject(item.sponsorship) && item.sponsorship)
    || {};
}
function sponsorshipModeActive(item, contract, mapping) {
  const sponsor = sponsorshipOf(item, contract, mapping);
  const mode = lower(first(sponsor.mode, sponsor.state, sponsor.status));
  return truthy(sponsor.active)
    || truthy(sponsor.enabled)
    || truthy(sponsor.required)
    || ["sponsored","sponsorship","contracted","paid_sponsor","paid-sponsor"].includes(mode);
}
function sponsorDisclosed(item, contract, mapping) {
  const sponsor = sponsorshipOf(item, contract, mapping);
  return truthy(sponsor.disclosed) && truthy(sponsor.verified) && !!first(sponsor.sponsorName, sponsor.provider, sponsor.contractId);
}
function trendVerified(item, contract, mapping) {
  const evidence = (mapping && mapping.trendEvidence) || (contract && contract.trendEvidence) || (item && item.trendEvidence) || {};
  const verified = truthy(evidence.verified) || truthy(evidence.measured);
  const metric = Number(first(evidence.score, evidence.demandScore, evidence.orders, evidence.views, evidence.rank));
  return verified && Number.isFinite(metric) && metric >= 0;
}
function newnessVerified(item, contract, mapping, validation) {
  const value = first(
    mapping && mapping.firstVerifiedAt,
    mapping && mapping.listedAt,
    contract && contract.firstVerifiedAt,
    item && item.firstVerifiedAt,
    item && item.listedAt,
    item && item.createdAt
  );
  return fresh(value, validation.newnessMaxAgeDays || 45);
}
function specialVerified(item, contract, mapping) {
  const evidence = (mapping && mapping.specialEvidence) || (contract && contract.specialEvidence) || (item && item.specialEvidence) || {};
  const types = valuesFrom(evidence.type, evidence.types, evidence.kind, mapping && mapping.specialType, item && item.specialType).map(lower);
  const verified = truthy(evidence.verified) || truthy(evidence.certified) || truthy(evidence.cooperativeVerified) || truthy(evidence.producerVerified);
  return verified && types.some(type => ["certified", "cooperative", "producer", "seasonal", "regional-special", "official-special"].includes(type));
}
function travelVerified(item, contract, mapping) {
  const evidence = (mapping && mapping.travelOperator) || (contract && contract.travelOperator) || (item && item.travelOperator) || {};
  const verified = truthy(evidence.verified) || truthy(evidence.licensed) || truthy(evidence.responsibleOperatorVerified);
  const operator = first(evidence.name, evidence.operatorName, evidence.licenseId, evidence.registrationId);
  const service = first(evidence.supportUrl, evidence.bookingPolicyUrl, evidence.cancellationPolicyUrl);
  return verified && !!operator && !!service;
}
function explicitAdministratorPublication(item, page, section) {
  const review = isObject(item && item.commerceReview) ? item.commerceReview : {};
  const candidate = isObject(item && item.commerceCandidate) ? item.commerceCandidate : {};
  const request = isObject(review.publicationRequest) ? review.publicationRequest : {};
  const scope = isObject(candidate.publicationScope) ? candidate.publicationScope : {};
  const tier = lower(first(candidate.sourceTier, review.sourceTier));
  const requested = request.requested === true || truthy(review.explicitPublicationRequested) || truthy(candidate.explicitPublicationRequested) || lower(review.publicationStatus) === "publish_requested";
  const requestedPage = lower(first(request.page, scope.page));
  const requestedSection = text(first(request.section, scope.section));
  if (requestedPage && requestedPage !== lower(page)) return false;
  if (requestedSection && requestedSection !== text(section)) return false;
  return requested && tier === "approved_commerce_member";
}

function validateCandidate(item, details) {
  const page = text(details && details.page);
  const section = text(details && details.section);
  const country = normalizeCountry(details && details.country);
  const region = normalizeRegion(details && details.region, country);
  const strategy = strategyFor(details && details.policy, page, section);
  if (!strategy) return { ok: true, scoped: false, reasons: [], mapping: null };
  const policy = details && details.policy && (details.policy.policy || details.policy) || {};
  const validation = policyValidation(policy);
  const contract = contractOf(item);
  const mapping = mappingOf(item, contract);
  const marketRecord = marketRecordOf(item, country);
  const availability = marketRecord || availabilityOf(item, contract, mapping);
  const seller = marketRecord && isObject(marketRecord.sellerResponsibility) ? marketRecord.sellerResponsibility : sellerOf(item, contract, mapping);
  const marketScope = isObject(item && item.marketScope) ? item.marketScope : null;
  const marketValidation = MarketSaleScope.validateMarketScope(marketScope, country, region, {
    maxVerificationAgeDays: Number(policyValidation(details && details.policy).maxAvailabilityVerificationAgeDays || 30),
    requireFresh: true
  });
  const reasons = [];
  const classes = normalizedClasses(mapping, item, contract);
  const profile = exactProfile(mapping, contract, item);
  const identity = productIdentity(mapping, item, contract);
  const countries = marketRecord ? [marketRecord.country] : declaredCountries(availability, item);
  const regions = marketRecord ? array(marketRecord.regions).map(value => normalizeRegion(value, country)).filter(Boolean) : declaredRegions(availability, item, country);
  const verifiedAt = marketRecord && marketRecord.verifiedAt ? marketRecord.verifiedAt : availabilityVerifiedAt(availability, mapping, contract, item);
  const regionCode = explicitRegionCode(item, contract, mapping, country);
  const allowedClasses = array(strategy.allowedProductClasses).map(lower);
  const requiredProfiles = array(strategy.requiredSlotProfiles).map(lower);
  const administratorPublication = explicitAdministratorPublication(item, page, section);

  if (validation.requireExplicitSlotProfile !== false && (!profile || !requiredProfiles.includes(profile))) reasons.push("IP_SLOT_PROFILE_MISMATCH");
  if (allowedClasses.length && !classes.some(value => allowedClasses.includes(value))) reasons.push("IP_PRODUCT_CLASS_MISMATCH");
  if (validation.requireProductIdentity !== false && !identity) reasons.push("IP_PRODUCT_IDENTITY_MISSING");
  if (validation.requireMarketAvailabilityEvidence !== false) {
    if (!marketRecord) reasons.push("IP_MARKET_SCOPE_RECORD_MISSING");
    if (!countries.includes(country)) reasons.push("IP_MARKET_COUNTRY_EVIDENCE_MISMATCH");
    if (region === "NATIONWIDE") {
      if (!(marketRecord ? marketRecord.nationwide === true : (truthy(availability.nationalAvailability) || truthy(nested(item, ["countrySupply", "nationalAvailability"]))))) reasons.push("IP_NATIONWIDE_AVAILABILITY_NOT_EXPLICIT");
    } else if (!regions.includes(region)) {
      reasons.push("IP_REGION_AVAILABILITY_EVIDENCE_MISMATCH");
    }
  }
  const marketReasonMap = {
    MARKET_SCOPE_ENVELOPE_MISSING: "IP_MARKET_SCOPE_RECORD_MISSING",
    MARKET_SCOPE_COUNTRY_MISMATCH: "IP_MARKET_SCOPE_COUNTRY_MISMATCH",
    MARKET_SCOPE_REGION_MISMATCH: "IP_MARKET_SCOPE_REGION_MISMATCH",
    MARKET_SCOPE_KEY_MISMATCH: "IP_MARKET_SCOPE_KEY_MISMATCH",
    MARKET_SCOPE_RECORD_COUNTRY_MISMATCH: "IP_MARKET_SCOPE_RECORD_COUNTRY_MISMATCH",
    MARKET_EVIDENCE_DIGEST_MISMATCH: "IP_MARKET_EVIDENCE_DIGEST_MISMATCH",
    MARKET_SCOPE_ENVELOPE_DIGEST_MISMATCH: "IP_MARKET_EVIDENCE_DIGEST_MISMATCH",
    MARKET_RESPONSIBLE_SELLER_EVIDENCE_MISSING: "IP_MARKET_RESPONSIBLE_SELLER_EVIDENCE_MISSING",
    MARKET_SHIPPING_EVIDENCE_MISSING: "IP_MARKET_SHIPPING_EVIDENCE_MISSING",
    MARKET_RETURNS_EVIDENCE_MISSING: "IP_MARKET_RETURNS_EVIDENCE_MISSING",
    MARKET_SUPPORT_EVIDENCE_MISSING: "IP_MARKET_SUPPORT_EVIDENCE_MISSING",
    MARKET_VERIFICATION_TIMESTAMP_MISSING: "IP_MARKET_VERIFICATION_RECORD_MISSING",
    MARKET_VERIFICATION_TIMESTAMP_STALE_OR_INVALID: "IP_MARKET_AVAILABILITY_VERIFICATION_MISSING_OR_STALE"
  };
  for (const marketReason of marketValidation.reasons || []) {
    const mapped = marketReasonMap[marketReason];
    if (!mapped) continue;
    if (mapped === "IP_MARKET_RESPONSIBLE_SELLER_EVIDENCE_MISSING" && validation.requireMarketScopedSellerResponsibility === false) continue;
    if (mapped === "IP_MARKET_SHIPPING_EVIDENCE_MISSING" && validation.requireMarketFulfillmentEvidence === false) continue;
    if (mapped === "IP_MARKET_RETURNS_EVIDENCE_MISSING" && validation.requireMarketReturnsEvidence === false) continue;
    if (mapped === "IP_MARKET_SUPPORT_EVIDENCE_MISSING" && validation.requireMarketSupportEvidence === false) continue;
    if ((mapped === "IP_MARKET_VERIFICATION_RECORD_MISSING" || mapped === "IP_MARKET_AVAILABILITY_VERIFICATION_MISSING_OR_STALE") && validation.requireMarketVerificationRecord === false) continue;
    reasons.push(mapped);
  }
  if (validation.requireIpRegionCodeForRegionalSupply !== false && region !== "NATIONWIDE" && regionCode !== region) reasons.push("IP_REGION_CODE_MISSING_OR_MISMATCH");
  if (validation.requireFreshAvailabilityVerification !== false && !fresh(verifiedAt, validation.maxAvailabilityVerificationAgeDays || 30)) reasons.push("IP_MARKET_AVAILABILITY_VERIFICATION_MISSING_OR_STALE");
  if (validation.requireSellerResponsibility !== false && !hasSellerResponsibility(seller)) reasons.push("IP_SELLER_RESPONSIBILITY_EVIDENCE_MISSING");
  // The Distribution Sponsor rail is a normal product rail by default.
  // Sponsorship-specific disclosure/contract evidence becomes mandatory only
  // when the product explicitly activates sponsorship mode.
  if (strategy.requires === "sponsorDisclosure" && validation.requireSponsorDisclosure !== false && sponsorshipModeActive(item, contract, mapping) && !sponsorDisclosed(item, contract, mapping)) reasons.push("IP_SPONSOR_DISCLOSURE_MISSING");
  if (strategy.requires === "trendEvidence" && validation.requireTrendEvidenceForTrending !== false && !administratorPublication && !trendVerified(item, contract, mapping)) reasons.push("IP_TREND_EVIDENCE_MISSING");
  if (strategy.requires === "newnessEvidence" && validation.requireNewnessEvidenceForNew !== false && !newnessVerified(item, contract, mapping, validation)) reasons.push("IP_NEWNESS_EVIDENCE_MISSING_OR_STALE");
  if (strategy.requires === "specialEvidence" && validation.requireSpecialEvidenceForSpecial !== false && !administratorPublication && !specialVerified(item, contract, mapping)) reasons.push("IP_SPECIAL_EVIDENCE_MISSING");
  // Tour travel-service offers need a responsible operator/booking-service
  // evidence record. Physical/recreation/dining products mapped to the same
  // Tour rail remain external-seller products and are already protected by the
  // market/seller-responsibility gates above; do not require a travel operator
  // licence-style record from those product cards.
  if (strategy.requires === "travelOperatorEvidence" && validation.requireTravelOperatorEvidence !== false && classes.includes("travel_service") && !travelVerified(item, contract, mapping)) reasons.push("IP_TRAVEL_OPERATOR_EVIDENCE_MISSING");

  return {
    ok: reasons.length === 0,
    scoped: true,
    reasons,
    mapping: {
      strategyId: text(strategy.strategyId),
      role: text(strategy.role),
      slotProfile: profile || null,
      productClasses: classes,
      productIdentity: identity || null,
      country,
      region,
      regionCode: regionCode || null,
      availabilityVerifiedAt: verifiedAt || null,
      sellerResponsibilityVerified: hasSellerResponsibility(seller),
      marketScopeKey: marketScope && marketScope.key || (marketRecord ? MarketSaleScope.marketKey(marketRecord, region || "NATIONWIDE") : null),
      marketEvidenceDigest: marketValidation.evidenceDigest || null,
      marketServicesVerified: marketValidation.ok,
      policyVersion: policy.version || VERSION,
      strategyDigest: sha256(strategy)
    }
  };
}

module.exports = {
  VERSION,
  POLICY_FILE,
  load,
  strategyFor,
  isScoped,
  validateCandidate,
  normalizeCountry,
  normalizeRegion,
  sha256,
  stable
};
