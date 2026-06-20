/**
 * trustFilter.core.v1.js
 * ------------------------------------------------------------------
 * MARU / Sanmaru core trust policy.
 * Broad discovery: block only hard-dangerous inputs.
 * Front supply: require objective source evidence before exposure.
 * ------------------------------------------------------------------
 */
"use strict";

const fs = require("fs");
const path = require("path");

const VERSION = "trust-filter-core-v2.0-tiered-front-contract";
const HARD_RISK = new Set(["blocked", "critical", "illegal", "unsafe", "high"]);
const FRONT_CONTEXT_KEYS = ["frontSupply", "frontExposure", "snapshot", "snapshotWrite", "slotSupply", "paymentFacing", "commerce", "strictFront", "requireTrusted"];

function readJsonSafe(filePath, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_e) { return fallback; }
}
function loadPolicy(name, fallback) {
  const candidates = [
    path.join(__dirname, "..", "data", name),
    path.join(process.cwd(), "netlify", "functions", "data", name),
    path.join(process.cwd(), "functions", "data", name),
    path.join(process.cwd(), "data", name)
  ];
  for (const candidate of candidates) {
    const value = readJsonSafe(candidate, null);
    if (value) return value;
  }
  return fallback;
}

const ALLOW_LIST = loadPolicy("trust.allowlist.json", { domains: [], sources: [] });
const BLOCK_LIST = loadPolicy("trust.blocklist.json", { domains: [], tlds: [], patterns: [], categories: [], keywords: [], sources: [] });

function arr(value) { return Array.isArray(value) ? value : []; }
function str(value) { return String(value == null ? "" : value); }
function normalize(value) { return str(value).trim().toLowerCase(); }
function truthy(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return !["", "0", "false", "no", "off", "disabled", "null", "undefined"].includes(normalize(value));
}
function firstDefined() { for (const value of arguments) if (value !== undefined) return value; return undefined; }
function firstNonEmpty() { for (const value of arguments) { const out = str(value).trim(); if (out) return out; } return ""; }
function safeUrl(value) { try { return new URL(str(value)); } catch (_e) { return null; } }
function hostnameOf(value) { const url = safeUrl(value); return url ? normalize(url.hostname).replace(/^www\./, "") : ""; }
function tldOf(host) { const parts = normalize(host).split(".").filter(Boolean); return parts.length ? parts[parts.length - 1] : ""; }
function domainMatch(host, domains) {
  const target = normalize(host).replace(/^www\./, "");
  return !!target && arr(domains).some(domain => {
    const candidate = normalize(domain).replace(/^www\./, "");
    return !!candidate && (target === candidate || target.endsWith("." + candidate));
  });
}
function patternMatch(text, patterns) {
  const body = str(text);
  const lowered = normalize(body);
  return arr(patterns).some(pattern => {
    if (!pattern) return false;
    try { return new RegExp(str(pattern), "i").test(body); }
    catch (_e) { return lowered.includes(normalize(pattern)); }
  });
}
function anyField(value) { return value && typeof value === "object" ? value : {}; }
function nestedValue(obj, keys) {
  let current = obj;
  for (const key of keys) {
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}
function combinedText(item) {
  item = item || {};
  return [
    item.title, item.name, item.label, item.summary, item.description, item.source, item.provider,
    item.category, item.type, item.section, item.country, item.url,
    arr(item.tags).join(" "), arr(item.supplyCategory).join(" "),
    anyField(item.producer).name, anyField(item.org).name, anyField(item.seller).name
  ].filter(Boolean).join(" ");
}
function contextIsFront(context) {
  context = context || {};
  return FRONT_CONTEXT_KEYS.some(key => truthy(context[key])) || /front|snapshot|slot|payment|commerce/.test(normalize(context.mode));
}
function looksLikePlaceholder(item) {
  item = item || {};
  const url = firstNonEmpty(item.url, item.link, item.href);
  const text = normalize(combinedText(item));
  return !!(
    item.placeholder === true || item.isPlaceholder === true || item.replaceableSlot === true || item.isLayerPointer === true ||
    !url || url === "#" || url === "about:blank" || /placeholder|replaceable-front-slot|seed slot|sample\/(network|home|media|distribution)/.test(text)
  );
}
function officialHost(host) {
  return !!host && /(^|\.)gov(\.|$)|\.go\.(kr|jp|vn)$|(^|\.)gob\.|\.or\.kr$|\.ac\.kr$|(^|\.)edu(\.|$)|(^|\.)korea\.kr$/.test(host);
}
function cooperativeSignal(text) {
  return /농협|수협|축협|산림조합|협동조합|생산자조합|영농조합|어업회사법인|생산자\s*단체|cooperative|producer\s*group|farmers?\s*(union|cooperative)|fishery\s*cooperative|forestry\s*cooperative|agricultural\s*cooperative/.test(normalize(text));
}
function officialSignal(text) {
  return /공식|정부|공공|기관|지자체|협회|재단|연맹|공기업|official|government|ministry|public\s*(institution|data|agency)|municipality|authority|foundation|association/.test(normalize(text));
}
function explicitVerification(item) {
  item = item || {};
  return !!(
    item.verified === true || normalize(nestedValue(item, ["verify", "status"])) === "verified" ||
    nestedValue(item, ["org", "verified"]) === true || nestedValue(item, ["source", "verified"]) === true ||
    nestedValue(item, ["seller", "verified"]) === true || nestedValue(item, ["producer", "verified"]) === true
  );
}
function trustedSourceFields(item) {
  item = item || {};
  const d = anyField(item.osaiDiscernment);
  const source = anyField(d.source);
  const supply = anyField(d.supply || item.supplyChain);
  const contract = anyField(item.searchBankContract || item.sanmaruSearchBankContract || item.searchBankUnifiedContract);
  const text = combinedText(item);
  const host = hostnameOf(firstNonEmpty(item.url, item.link, item.href));
  const frontDomain = domainMatch(host, ALLOW_LIST.frontEligibleDomains || ALLOW_LIST.domains);
  const authorityDomain = domainMatch(host, ALLOW_LIST.authorityDomains);
  const cooperativeDomain = domainMatch(host, ALLOW_LIST.cooperativeDomains);
  const marketplaceDomain = domainMatch(host, ALLOW_LIST.verifiedMarketplaceDomains);
  const paymentProviderDomain = domainMatch(host, ALLOW_LIST.paymentProviderDomains);
  const technologyPlatformDomain = domainMatch(host, ALLOW_LIST.technologyPlatformDomains);
  const official = !!firstDefined(item.officialSource, contract.officialSource, source.officialSource, false) || officialHost(host) || authorityDomain || officialSignal(text);
  const institution = !!firstDefined(item.institutionVerified, contract.institutionVerified, source.institutionVerified, false) || authorityDomain || /기관|협회|재단|연맹|대학|연구소|institute|institution|association|foundation|university/.test(normalize(text));
  const producer = !!firstDefined(item.producerVerified, contract.producerVerified, supply.producerVerified, nestedValue(item, ["producer", "verified"]), false) || cooperativeDomain || cooperativeSignal(text) || !!(anyField(item.producer).id || anyField(item.producer).name || anyField(item.producer).home);
  const direct = !!firstDefined(item.directProducerChannel, contract.directProducerChannel, supply.directProducerChannel, false) || (producer && !marketplaceDomain);
  const orderReady = !!firstDefined(item.orderReady, contract.orderReady, nestedValue(d, ["payment", "orderReady"]), false);
  const contactReady = !!firstDefined(item.contactReady, item.inquiryReady, item.customerSupportReady, nestedValue(d, ["payment", "contactReady"]), false);
  const deliveryReady = !!firstDefined(item.deliveryReady, contract.deliveryReady, nestedValue(d, ["payment", "deliveryReady"]), false);
  const policyReady = !!firstDefined(item.policyReady, contract.policyReady, nestedValue(d, ["payment", "policyReady"]), false);
  const trustScore = Number(firstDefined(item.sourceTrustScore, contract.sourceTrustScore, d.trustScore, item.trustScore, item.sourceTrust, 0)) || 0;
  const normalizedScore = trustScore > 0 && trustScore <= 1 ? trustScore * 100 : trustScore;
  const tier = normalize(firstDefined(item.trustTier, contract.trustTier, d.trustTier, ""));
  const strongTrust = ["a", "a+"].includes(tier) || normalizedScore >= 76;
  const intermediaryRisk = normalize(firstDefined(item.intermediaryRisk, contract.intermediaryRisk, supply.intermediaryRisk, marketplaceDomain ? "medium" : "low"));
  return { host, text, frontDomain, authorityDomain, cooperativeDomain, marketplaceDomain, paymentProviderDomain, technologyPlatformDomain, official, institution, producer, direct, orderReady, contactReady, deliveryReady, policyReady, trustScore: normalizedScore, tier, strongTrust, intermediaryRisk };
}
function evaluateTrust(item, context = {}) {
  const reasons = [];
  const evidence = [];
  const signals = {};
  const frontMode = contextIsFront(context);
  if (!item || typeof item !== "object") return { ok: false, trusted: false, frontEligible: false, score: 0, reasons: ["ITEM_INVALID"], evidence, signals, version: VERSION };

  const url = firstNonEmpty(item.url, item.link, item.href);
  const parsedUrl = safeUrl(url);
  if (!url || !parsedUrl || !/^https?:$/.test(parsedUrl.protocol)) return { ok: false, trusted: false, frontEligible: false, score: 0, reasons: ["URL_INVALID"], evidence, signals, version: VERSION };
  const title = firstNonEmpty(item.title, item.name, item.label);
  if (!title && !looksLikePlaceholder(item)) return { ok: false, trusted: false, frontEligible: false, score: 0, reasons: ["REQUIRED_FIELD_MISSING:title"], evidence, signals, version: VERSION };

  const host = hostnameOf(url);
  const text = combinedText(item);
  const tld = tldOf(host);
  const hardDomain = domainMatch(host, BLOCK_LIST.domains);
  const hardTld = arr(BLOCK_LIST.tlds).map(normalize).includes(tld);
  const hardPattern = patternMatch(text, BLOCK_LIST.patterns) || arr(BLOCK_LIST.keywords).some(keyword => normalize(text).includes(normalize(keyword)));
  const hardCategory = arr(item.categories).concat(item.category ? [item.category] : []).map(normalize).some(category => arr(BLOCK_LIST.categories).map(normalize).includes(category));
  const sourceBlocked = arr(BLOCK_LIST.sources).map(normalize).includes(normalize(item.source));
  if (hardDomain) reasons.push("BLOCKLIST_DOMAIN");
  if (hardTld) reasons.push("BLOCKLIST_TLD");
  if (hardPattern) reasons.push("BLOCKLIST_PATTERN");
  if (hardCategory) reasons.push("BLOCKLIST_CATEGORY");
  if (sourceBlocked) reasons.push("BLOCKLIST_SOURCE");
  if (item.fake === true) reasons.push("ITEM_FAKE");
  if (item.scam === true) reasons.push("ITEM_SCAM");
  if (/^xn--/.test(host)) reasons.push("DOMAIN_PUNYCODE_BLOCK");
  if (reasons.length) return { ok: false, trusted: false, frontEligible: false, score: -100, reasons, evidence, signals: { host }, version: VERSION, riskLevel: "blocked", classification: "blocked" };

  const f = trustedSourceFields(item);
  const placeholder = looksLikePlaceholder(item);
  const explicit = explicitVerification(item);
  const frontDeniedDomain = domainMatch(host, BLOCK_LIST.frontDeniedDomains);
  const frontDeniedTld = arr(BLOCK_LIST.frontDeniedTlds).map(normalize).includes(tld);
  const frontDeniedPattern = patternMatch(text, BLOCK_LIST.frontDeniedPatterns);
  const frontDeniedCategory = arr(item.categories).concat(item.category ? [item.category] : []).map(normalize).some(category => arr(BLOCK_LIST.frontDeniedCategories).map(normalize).includes(category));
  const riskLevel = normalize(firstDefined(item.riskLevel, nestedValue(item, ["searchBankContract", "riskLevel"]), nestedValue(item, ["osaiDiscernment", "riskLevel"]), "low"));
  const unsafe = normalize(firstDefined(item.unsafeProductRisk, nestedValue(item, ["searchBankContract", "unsafeProductRisk"]), nestedValue(item, ["osaiDiscernment", "safety", "unsafeProductRisk"]), "low"));
  const illegal = normalize(firstDefined(item.illegalSiteRisk, nestedValue(item, ["searchBankContract", "illegalSiteRisk"]), nestedValue(item, ["osaiDiscernment", "safety", "illegalSiteRisk"]), "low"));
  const harmful = normalize(firstDefined(item.harmfulContentRisk, nestedValue(item, ["searchBankContract", "harmfulContentRisk"]), nestedValue(item, ["osaiDiscernment", "safety", "harmfulContentRisk"]), "low"));
  const risky = [riskLevel, unsafe, illegal, harmful].some(value => HARD_RISK.has(value));
  const highIntermediary = f.intermediaryRisk === "high" && !(f.official || f.direct || f.cooperativeDomain);
  const isCommerce = truthy(context.commerce) || truthy(context.paymentFacing) || /product|commerce|shop|distribution|상품|유통|판매|구매|주문/.test(normalize([item.category, item.type, item.section, context.surface].filter(Boolean).join(" ")));

  if (placeholder) evidence.push("placeholder-layout-only");
  if (explicit) evidence.push("explicit-verified");
  if (f.frontDomain) evidence.push("front-eligible-domain");
  if (f.authorityDomain || f.official) evidence.push("official-source");
  if (f.institution) evidence.push("institution-verified");
  if (f.cooperativeDomain || cooperativeSignal(text)) evidence.push("producer-or-cooperative-verified");
  if (f.producer) evidence.push("producer-verified");
  if (f.direct) evidence.push("direct-producer-channel");
  if (f.strongTrust) evidence.push("strong-trust-score");
  if (f.marketplaceDomain) evidence.push("verified-marketplace-platform");
  if (f.paymentProviderDomain) evidence.push("payment-provider-infrastructure");
  if (f.technologyPlatformDomain) evidence.push("technology-platform-host");
  if (f.orderReady || f.contactReady) evidence.push("contact-or-order-path");
  if (f.deliveryReady || f.policyReady) evidence.push("policy-or-delivery-signal");

  const sourceVerified = explicit || f.frontDomain || f.official || f.institution || f.producer || f.direct || f.strongTrust;
  const commercePath = f.orderReady || f.contactReady || truthy(item.orderReady) || truthy(item.inquiryReady);
  const policyPath = f.deliveryReady || f.policyReady || truthy(item.deliveryReady) || truthy(item.policyReady);
  const marketplaceSellerVerified = f.marketplaceDomain && !!(item.sellerVerified || item.marketplaceSellerVerified || nestedValue(item, ["seller", "verified"]) || f.producer || f.direct || explicit);
  const platformOnly = (f.marketplaceDomain || f.paymentProviderDomain || f.technologyPlatformDomain) && !sourceVerified && !marketplaceSellerVerified;
  const frontEvidence = sourceVerified || marketplaceSellerVerified;
  const commerceReady = !isCommerce || (commercePath && (policyPath || f.official || f.producer || f.direct || explicit));
  const frontEligible = !!(!risky && !highIntermediary && !frontDeniedDomain && !frontDeniedTld && !frontDeniedPattern && !frontDeniedCategory && !platformOnly && frontEvidence && commerceReady && !placeholder);

  let score = 36;
  if (parsedUrl.protocol === "https:") score += 8; else score -= 6;
  if (explicit) score += 24;
  if (f.frontDomain) score += 24;
  if (f.official) score += 20;
  if (f.institution) score += 10;
  if (f.producer) score += 16;
  if (f.direct) score += 12;
  if (f.strongTrust) score += 14;
  if (marketplaceSellerVerified) score += 8;
  if (f.orderReady || f.contactReady) score += 6;
  if (f.deliveryReady || f.policyReady) score += 5;
  if (f.marketplaceDomain) score += 2;
  if (f.paymentProviderDomain || f.technologyPlatformDomain) score += 1;
  if (frontDeniedDomain || frontDeniedTld || frontDeniedPattern || frontDeniedCategory) score -= 28;
  if (platformOnly) score -= 20;
  if (highIntermediary) score -= 35;
  if (risky) score -= 100;
  score = Math.max(-100, Math.min(100, score));

  const trusted = !!(sourceVerified || marketplaceSellerVerified);
  let classification = "discovery-safe";
  if (frontEligible) classification = isCommerce ? "verified-commerce-front" : "verified-content-front";
  else if (platformOnly) classification = "platform-known-but-seller-unverified";
  else if (frontDeniedDomain || frontDeniedTld || frontDeniedPattern || frontDeniedCategory) classification = "front-hold-risk-signal";
  else if (trusted) classification = "trusted-hold-for-front-readiness";
  if (f.marketplaceDomain && !marketplaceSellerVerified) reasons.push("MARKETPLACE_SELLER_VERIFICATION_REQUIRED");
  if (f.paymentProviderDomain && !sourceVerified) reasons.push("PAYMENT_PROVIDER_NOT_SELLER_EVIDENCE");
  if (f.technologyPlatformDomain && !sourceVerified) reasons.push("TECH_PLATFORM_NOT_SUPPLIER_EVIDENCE");
  if (frontDeniedDomain) reasons.push("FRONT_DENIED_REDIRECT_DOMAIN");
  if (frontDeniedTld) reasons.push("FRONT_DENIED_TLD");
  if (frontDeniedPattern) reasons.push("FRONT_DENIED_PATTERN");
  if (frontDeniedCategory) reasons.push("FRONT_DENIED_CATEGORY");
  if (highIntermediary) reasons.push("INTERMEDIARY_RISK_HIGH");
  if (!frontEvidence) reasons.push("FRONT_VERIFICATION_REQUIRED");
  if (isCommerce && !commerceReady) reasons.push("COMMERCE_CONTACT_OR_POLICY_EVIDENCE_REQUIRED");

  const discoveryOk = !risky;
  const ok = frontMode ? frontEligible : discoveryOk;
  signals.host = host;
  signals.frontMode = frontMode;
  signals.isCommerce = isCommerce;
  signals.frontDomain = f.frontDomain;
  signals.marketplaceDomain = f.marketplaceDomain;
  signals.paymentProviderDomain = f.paymentProviderDomain;
  signals.technologyPlatformDomain = f.technologyPlatformDomain;
  signals.intermediaryRisk = f.intermediaryRisk;
  signals.trustScore = f.trustScore;
  return {
    ok, trusted, frontEligible, score, reasons: Array.from(new Set(reasons)), evidence: Array.from(new Set(evidence)), signals,
    version: VERSION, riskLevel: risky ? "high" : (frontEligible ? "low" : "medium"), classification,
    frontVerificationStatus: frontEligible ? "verified-front-supply" : "hold-for-front-verification",
    frontSupplyAllowed: frontEligible,
    searchBankEligible: discoveryOk,
    snapshotEligible: frontEligible,
    indexEligible: discoveryOk
  };
}
function trustFilter(item, context = {}) { return evaluateTrust(item, context).ok; }
function filterBatch(items = [], context = {}) {
  const passed = []; const dropped = [];
  for (const item of arr(items)) (trustFilter(item, context) ? passed : dropped).push(item);
  return { passed, dropped };
}
function evaluateFrontEligibility(item, context = {}) { return evaluateTrust(item, Object.assign({}, context, { frontSupply: true })); }

module.exports = { version: VERSION, trustFilter, filterBatch, evaluateTrust, evaluateFrontEligibility, ALLOW_LIST, BLOCK_LIST };
