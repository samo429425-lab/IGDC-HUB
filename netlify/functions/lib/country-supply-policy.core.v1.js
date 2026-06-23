"use strict";

/**
 * Country-aware supply policy core.
 *
 * This module deliberately separates:
 * - request / visitor country (where a request came from)
 * - research country (where discovery is currently aimed)
 * - source country (where the candidate actually originates)
 * - target market (where the candidate may be supplied on a front snapshot)
 *
 * Search and global research stay broad. The policy only controls front/snapshot
 * supply eligibility and records sufficient evidence for later audits.
 */

const fs = require("fs");
const path = require("path");

const VERSION = "country-supply-policy-core-v1.0";
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = { loadedAt: 0, mtimeMs: 0, value: null, source: null };

function text(v) { return v == null ? "" : String(v).trim(); }
function lower(v) { return text(v).toLowerCase(); }
function truthy(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  return !["", "0", "false", "no", "off", "disabled", "disable", "null", "undefined"].includes(lower(v));
}
function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const item = text(value);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value === "string") return value.split(/[\s,|]+/).filter(Boolean);
  return [value];
}

const COUNTRY_ALIASES = Object.freeze({
  korea: "KR", "south korea": "KR", "republic of korea": "KR", "대한민국": "KR", "한국": "KR",
  japan: "JP", "일본": "JP", taiwan: "TW", "대만": "TW", vietnam: "VN", "베트남": "VN",
  thailand: "TH", "태국": "TH", indonesia: "ID", "인도네시아": "ID", singapore: "SG", "싱가포르": "SG",
  china: "CN", "중국": "CN", hongkong: "HK", "hong kong": "HK", "홍콩": "HK",
  usa: "US", "u.s.": "US", "united states": "US", america: "US", "미국": "US",
  canada: "CA", "캐나다": "CA", mexico: "MX", "멕시코": "MX", brazil: "BR", "브라질": "BR",
  uk: "GB", "united kingdom": "GB", britain: "GB", england: "GB", "영국": "GB",
  france: "FR", "프랑스": "FR", germany: "DE", "독일": "DE", italy: "IT", "이탈리아": "IT",
  spain: "ES", "스페인": "ES", australia: "AU", "호주": "AU", india: "IN", "인도": "IN",
  global: "GLOBAL", worldwide: "GLOBAL", international: "GLOBAL"
});

function normalizeCountry(value) {
  if (value && typeof value === "object") {
    value = value.code || value.countryCode || value.country || value.iso || value.id || "";
  }
  const raw = text(value);
  if (!raw) return "";
  const alias = COUNTRY_ALIASES[lower(raw)];
  if (alias) return alias;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  if (upperGlobal(raw)) return "GLOBAL";
  return "";
}
function upperGlobal(value) { return ["GLOBAL", "WORLD", "WORLDWIDE", "INTERNATIONAL"].includes(text(value).toUpperCase()); }

function firstValue() {
  for (const value of arguments) {
    const out = text(value);
    if (out) return out;
  }
  return "";
}
function nested(obj, pathList) {
  let current = obj;
  for (const key of pathList) {
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { return null; }
}
function candidatePolicyPaths() {
  return unique([
    process.env.MARU_BANK_COUNTRY_POLICY_FILE,
    process.env.COUNTRY_SUPPLY_POLICY_FILE,
    path.join(__dirname, "..", "data", "country-policy.json"),
    path.join(process.cwd(), "netlify", "functions", "data", "country-policy.json"),
    path.join(process.cwd(), "data", "country-policy.json")
  ]);
}
function defaultPolicy() {
  return {
    version: "country-supply-policy-v1",
    defaults: {
      enforcement: "audit",
      minimumLocalCandidates: { default: 20 },
      allowGlobalOfficialFallback: true,
      requireAvailabilityEvidenceForForeign: true,
      requireSourceCountryForFront: true,
      requireVerifiedSourceCountryForFront: true,
      allowUnknownSourceCountryInSearchBank: true,
      requireExplicitNeighborApproval: true
    },
    markets: {}
  };
}
function loadPolicy(force) {
  const now = Date.now();
  if (!force && cached.value && now - cached.loadedAt < CACHE_TTL_MS) return cached.value;
  for (const file of candidatePolicyPaths()) {
    try {
      const stat = fs.statSync(file);
      if (!force && cached.value && cached.source === file && cached.mtimeMs === stat.mtimeMs && now - cached.loadedAt < CACHE_TTL_MS) return cached.value;
      const parsed = readJson(file);
      if (parsed && typeof parsed === "object") {
        cached = { loadedAt: now, mtimeMs: stat.mtimeMs, value: parsed, source: file };
        return parsed;
      }
    } catch (_e) {}
  }
  const fallback = defaultPolicy();
  cached = { loadedAt: now, mtimeMs: 0, value: fallback, source: "built-in" };
  return fallback;
}
function policySource() { loadPolicy(); return cached.source || "built-in"; }
function policyVersion(policy) { return text(policy && policy.version) || "country-supply-policy-v1"; }
function marketPolicy(policy, market) {
  const markets = (policy && policy.markets && typeof policy.markets === "object") ? policy.markets : policy || {};
  const code = normalizeCountry(market);
  if (!code || code === "GLOBAL") return null;
  return markets[code] || markets[code.toLowerCase()] || markets[code.toUpperCase()] || null;
}
function mergePlain() {
  const out = {};
  for (const value of arguments) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    Object.assign(out, value);
  }
  return out;
}
function normalizeTiers(value) {
  const tiers = [];
  for (const rawTier of Array.isArray(value) ? value : []) {
    const countries = unique(asArray(rawTier && typeof rawTier === "object" ? rawTier.countries : rawTier).map(normalizeCountry).filter(code => code && code !== "GLOBAL"));
    if (!countries.length) continue;
    tiers.push({
      countries,
      reason: text(rawTier && rawTier.reason) || "approved-neighbor-market",
      requireAvailabilityEvidence: rawTier && Object.prototype.hasOwnProperty.call(rawTier, "requireAvailabilityEvidence") ? truthy(rawTier.requireAvailabilityEvidence) : true
    });
  }
  return tiers;
}
function resolveTargetMarket(context) {
  context = context || {};
  return normalizeCountry(firstValue(
    context.targetMarket,
    context.targetCountry,
    context.marketCountry,
    context.audienceCountry,
    context.visitorCountry,
    context.country,
    nested(context, ["geoContext", "country"]),
    nested(context, ["ipGeo", "country"]),
    nested(context, ["params", "targetMarket"]),
    nested(context, ["params", "targetCountry"]),
    nested(context, ["params", "audienceCountry"]),
    nested(context, ["params", "ipCountry"])
  ));
}
function hubOf(context) {
  context = context || {};
  return lower(firstValue(context.hub, context.channel, context.page, nested(context, ["slotContext", "channel"]), nested(context, ["params", "channel"]), nested(context, ["params", "page"]))) || "default";
}
function resolveSupplyPlan(context) {
  context = context || {};
  const policy = context.policy && typeof context.policy === "object" ? context.policy : loadPolicy();
  const targetMarket = resolveTargetMarket(context) || "GLOBAL";
  const hub = hubOf(context);
  const defaults = mergePlain(defaultPolicy().defaults, policy.defaults);
  const selected = marketPolicy(policy, targetMarket) || {};
  const effective = mergePlain(defaults, selected);
  const localSources = unique(asArray(selected.localSources || selected.localCountries || (targetMarket !== "GLOBAL" ? [targetMarket] : [])).map(normalizeCountry).filter(Boolean));
  const fallbackTiers = normalizeTiers(selected.fallbackTiers || selected.approvedFallbackTiers || []);
  const excludedCountries = unique(asArray(selected.excludedCountries || selected.blockedSourceCountries || []).map(normalizeCountry).filter(Boolean));
  const minimums = effective.minimumLocalCandidates && typeof effective.minimumLocalCandidates === "object" ? effective.minimumLocalCandidates : { default: Number(effective.minimumLocalCandidates) || 20 };
  const minimumLocalCandidates = Number(minimums[hub] || minimums.default || 20);
  const localCandidateCount = Number(context.localCandidateCount || context.localCount || 0);
  const localShortageKnown = Number.isFinite(localCandidateCount) && context.localCandidateCount != null;
  const localShortage = localShortageKnown ? localCandidateCount < minimumLocalCandidates : false;
  const localDeficit = localShortage ? Math.max(0, minimumLocalCandidates - localCandidateCount) : 0;
  const fallbackCandidateCount = Number(context.fallbackCandidateCount || context.approvedFallbackCandidateCount || 0);
  const fallbackCountKnown = Number.isFinite(fallbackCandidateCount) && (context.fallbackCandidateCount != null || context.approvedFallbackCandidateCount != null);
  const fallbackShortage = fallbackTiers.length ? (fallbackCountKnown ? fallbackCandidateCount < localDeficit : false) : true;
  const globalFallbackNeeded = !!(localShortage && effective.allowGlobalOfficialFallback !== false && fallbackShortage);
  const enforcement = lower(effective.enforcement || "audit") === "enforce" ? "enforce" : "audit";
  return {
    version: VERSION,
    policyVersion: policyVersion(policy),
    policySource: policySource(),
    targetMarket,
    hub,
    enforcement,
    localSources,
    fallbackTiers,
    excludedCountries,
    allowGlobalOfficialFallback: effective.allowGlobalOfficialFallback !== false,
    requireAvailabilityEvidenceForForeign: effective.requireAvailabilityEvidenceForForeign !== false,
    requireSourceCountryForFront: effective.requireSourceCountryForFront !== false,
    requireVerifiedSourceCountryForFront: effective.requireVerifiedSourceCountryForFront !== false,
    allowUnknownSourceCountryInSearchBank: effective.allowUnknownSourceCountryInSearchBank !== false,
    requireExplicitNeighborApproval: effective.requireExplicitNeighborApproval !== false,
    minimumLocalCandidates,
    localCandidateCount: localShortageKnown ? localCandidateCount : null,
    localShortage,
    localDeficit,
    fallbackCandidateCount: fallbackCountKnown ? fallbackCandidateCount : null,
    fallbackShortage,
    globalFallbackNeeded,
    researchOrder: [
      ...localSources.map(country => ({ tier: "same-country", countries: [country], reason: "local-first" })),
      ...(localShortage ? fallbackTiers.map((tier, index) => ({ tier: "neighbor-tier-" + (index + 1), countries: tier.countries, reason: tier.reason })) : []),
      ...(globalFallbackNeeded ? [{ tier: "global-official", countries: ["GLOBAL"], reason: "official-fallback-after-approved-source-shortage" }] : [])
    ],
    mode: "country-aware-front-supply"
  };
}
function sourceCountryEvidence(candidate) {
  candidate = candidate || {};
  const fields = [
    ["sourceCountry", candidate.sourceCountry],
    ["source_country", candidate.source_country],
    ["originCountry", candidate.originCountry],
    ["origin_country", candidate.origin_country],
    ["sourceGeo.country", nested(candidate, ["sourceGeo", "country"])],
    ["producer.country", nested(candidate, ["producer", "country"])],
    ["org.country", nested(candidate, ["org", "country"])],
    ["entity.country", nested(candidate, ["entity", "country"])],
    ["provenance.country", nested(candidate, ["provenance", "country"])],
    ["legacy.geo.country", nested(candidate, ["geo", "country"])],
    ["legacy.country", candidate.country]
  ];
  for (const [field, raw] of fields) {
    const country = normalizeCountry(raw);
    if (country && country !== "GLOBAL") return { country, field, raw: text(raw), verified: !field.startsWith("legacy.") };
  }
  return { country: "", field: "", raw: "", verified: false };
}
function countryListFrom(value) {
  const values = [];
  if (Array.isArray(value)) values.push(...value);
  else if (typeof value === "string") values.push(...value.split(/[\s,|]+/));
  else if (value && typeof value === "object") {
    values.push(...asArray(value.countries || value.countryCodes || value.allowed || value.available || value.destinations));
  } else if (value != null) values.push(value);
  return unique(values.map(normalizeCountry).filter(code => code && code !== "GLOBAL"));
}
function availabilityEvidence(candidate) {
  candidate = candidate || {};
  const fields = [
    ["availabilityCountries", candidate.availabilityCountries],
    ["availableCountries", candidate.availableCountries],
    ["allowedCountries", candidate.allowedCountries],
    ["market.availableCountries", nested(candidate, ["market", "availableCountries"])],
    ["market.allowedCountries", nested(candidate, ["market", "allowedCountries"])],
    ["shipping.shipTo", nested(candidate, ["shipping", "shipTo"])],
    ["shipping.availableCountries", nested(candidate, ["shipping", "availableCountries"])],
    ["shipTo", candidate.shipTo],
    ["deliveryCountries", candidate.deliveryCountries]
  ];
  const countries = [];
  const evidence = [];
  for (const [field, raw] of fields) {
    const list = countryListFrom(raw);
    if (!list.length) continue;
    countries.push(...list);
    evidence.push(field);
  }
  return { countries: unique(countries), evidence: unique(evidence) };
}
function hasAvailabilityForTarget(availability, targetMarket, sourceCountry) {
  if (!targetMarket || targetMarket === "GLOBAL") return true;
  const countries = availability && Array.isArray(availability.countries) ? availability.countries : [];
  if (countries.includes(targetMarket)) return true;
  // Same-country sources do not need an explicit shipping declaration merely to
  // remain searchable. Front enforcement still evaluates trust and eligibility.
  return !!sourceCountry && sourceCountry === targetMarket;
}
function tierForSource(plan, sourceCountry) {
  if (!sourceCountry) return { tier: "unknown", sourceTier: 0, approved: false };
  if (plan.localSources.includes(sourceCountry)) return { tier: "same-country", sourceTier: 1, approved: true };
  for (let i = 0; i < plan.fallbackTiers.length; i++) {
    if (plan.fallbackTiers[i].countries.includes(sourceCountry)) return { tier: "neighbor-tier-" + (i + 1), sourceTier: i + 2, approved: true, reason: plan.fallbackTiers[i].reason };
  }
  return { tier: "global", sourceTier: 99, approved: false };
}
function candidateIsOfficial(candidate) {
  candidate = candidate || {};
  const contract = candidate.searchBankContract || candidate.sanmaruSearchBankContract || candidate.searchBankUnifiedContract || {};
  const discernment = candidate.osaiDiscernment || {};
  return truthy(candidate.officialSource) || truthy(candidate.institutionVerified) || truthy(candidate.producerVerified) || truthy(contract.officialSource) || truthy(contract.institutionVerified) || truthy(contract.producerVerified) || truthy(nested(discernment, ["source", "officialSource"])) || truthy(nested(discernment, ["source", "institutionVerified"]));
}
function evaluateCandidateForTarget(candidate, context) {
  const plan = context && context.plan ? context.plan : resolveSupplyPlan(context || {});
  const source = sourceCountryEvidence(candidate);
  const availability = availabilityEvidence(candidate);
  const sourceTier = tierForSource(plan, source.country);
  const reasons = [];
  let wouldAllow = true;

  if (source.country && plan.excludedCountries.includes(source.country)) {
    wouldAllow = false;
    reasons.push("SOURCE_COUNTRY_EXCLUDED");
  }
  if (!source.country && plan.requireSourceCountryForFront) {
    wouldAllow = false;
    reasons.push("SOURCE_COUNTRY_UNRESOLVED");
  }
  if (source.country && !source.verified && plan.requireVerifiedSourceCountryForFront) {
    wouldAllow = false;
    reasons.push("SOURCE_COUNTRY_EVIDENCE_WEAK");
  }
  if (source.country && sourceTier.tier === "global") {
    if (plan.requireExplicitNeighborApproval && !plan.allowGlobalOfficialFallback) {
      wouldAllow = false;
      reasons.push("GLOBAL_FALLBACK_DISABLED");
    }
    if (!plan.globalFallbackNeeded) {
      wouldAllow = false;
      reasons.push("GLOBAL_FALLBACK_NOT_YET_NEEDED");
    }
    if (plan.allowGlobalOfficialFallback && !candidateIsOfficial(candidate)) {
      wouldAllow = false;
      reasons.push("GLOBAL_SOURCE_NOT_OFFICIAL_OR_VERIFIED");
    }
  }
  if (source.country && source.country !== plan.targetMarket && plan.targetMarket !== "GLOBAL") {
    if (plan.requireAvailabilityEvidenceForForeign && !hasAvailabilityForTarget(availability, plan.targetMarket, source.country)) {
      wouldAllow = false;
      reasons.push("FOREIGN_MARKET_AVAILABILITY_UNVERIFIED");
    }
    if (sourceTier.tier.startsWith("neighbor-tier-") && !plan.localShortage) {
      reasons.push("NEIGHBOR_FALLBACK_NOT_YET_NEEDED");
      wouldAllow = false;
    }
  }
  const enforcement = plan.enforcement;
  const frontAllowed = enforcement === "enforce" ? wouldAllow : true;
  return {
    version: VERSION,
    policyVersion: plan.policyVersion,
    targetMarket: plan.targetMarket,
    hub: plan.hub,
    enforcement,
    sourceCountry: source.country || null,
    sourceCountryEvidence: source.field || null,
    sourceCountryVerified: source.verified,
    availabilityCountries: availability.countries,
    availabilityEvidence: availability.evidence,
    supplyTier: sourceTier.tier,
    supplyTierOrder: sourceTier.sourceTier,
    approvedSourceMarket: sourceTier.approved,
    wouldAllowFrontSupply: wouldAllow,
    frontSupplyAllowed: frontAllowed,
    readiness: wouldAllow ? "country-policy-ready" : "hold-for-country-policy-evidence",
    reasons: unique(reasons),
    searchBankAllowed: !(!source.country && plan.allowUnknownSourceCountryInSearchBank === false),
    plan: {
      localSources: plan.localSources,
      localShortage: plan.localShortage,
      localDeficit: plan.localDeficit,
      fallbackShortage: plan.fallbackShortage,
      globalFallbackNeeded: plan.globalFallbackNeeded,
      minimumLocalCandidates: plan.minimumLocalCandidates
    }
  };
}
function enrichCandidateForPolicy(candidate, context) {
  if (!candidate || typeof candidate !== "object") return candidate;
  const evaluation = evaluateCandidateForTarget(candidate, context || {});
  candidate.countrySupply = Object.assign({}, candidate.countrySupply || {}, evaluation);
  if(evaluation.sourceCountryVerified) candidate.sourceCountry = candidate.sourceCountry || evaluation.sourceCountry || undefined;
  // targetMarket is request-contextual; keep it only inside countrySupply so a
  // global SearchBank record is never permanently stamped with one visitor country.
  if (!Array.isArray(candidate.availabilityCountries) && evaluation.availabilityCountries.length) candidate.availabilityCountries = evaluation.availabilityCountries.slice();
  candidate.supplyTier = evaluation.supplyTier;
  candidate.countryPolicyVersion = evaluation.policyVersion;
  return candidate;
}

module.exports = {
  version: VERSION,
  loadPolicy,
  policySource,
  normalizeCountry,
  resolveTargetMarket,
  resolveSupplyPlan,
  sourceCountryEvidence,
  availabilityEvidence,
  evaluateCandidateForTarget,
  enrichCandidateForPolicy
};
