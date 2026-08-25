"use strict";

/**
 * Canonical Snapshot Publisher v1
 *
 * Single publication boundary between SearchBank/Sanmaru candidate output and
 * every public Snapshot consumer.  The publisher is intentionally fail-closed:
 * it accepts only candidates that carry explicit routing, source, geography,
 * eligibility and evidence; it never infers missing proof from a title, tag,
 * sample slot or previous front snapshot.
 *
 * Publication model
 *   upstream candidate mirrors -> canonical validation -> atomic public mirrors
 *   -> Snapshot Engine / SearchBank Index / Regional Brokerage Publisher
 *
 * The module does not replace upstream engines.  It is a contract gate and an
 * auditable publisher only.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const IpSlotPolicy = require("./ip-slot-policy.v1");
const MarketSaleScope = require("./market-sale-scope.v1");
const CommerceCandidateIntake = require("./commerce-candidate-intake.v1");
const PublicSnapshot = require("./public-snapshot-sanitizer.v1");

const VERSION = "canonical-snapshot-publisher-v1.6.1-exact-product-destination-contract";
const CONTRACT_VERSION = "sanmaru-searchbank-canonical-publication-contract-v1.6-country-scoped-admin-publication";
// Backward-compatible export name; the actual durable source is the Commerce review queue.
const UPSTREAM_FILE = "commerce-candidate-review-queue.v1.json";
const PUBLIC_FILE = "search-bank.snapshot.json";
const POLICY_FILE = "canonical-snapshot-policy.v1.json";
const RELEASE_DIR = "canonical-snapshot";
const MAX_AUDIT_ROWS = 50000;

const PAGE_ALIASES = Object.freeze({
  home: "home",
  front: "home",
  homepage: "home",
  network: "network",
  networkhub: "network",
  web: "network",
  commerce: "distribution",
  distribution: "distribution",
  distributionhub: "distribution",
  social: "social",
  socialnetwork: "social",
  media: "media",
  mediahub: "media",
  tour: "tour",
  tourpage: "tour",
  travel: "tour",
  donation: "donation",
  academic: "literature-academic",
  culture: "literature-academic",
  literature: "literature-academic",
  "literature-academic": "literature-academic"
});

const SECTION_ALIASES = Object.freeze({
  home: {
    main1: "home_1", main2: "home_2", main3: "home_3", main4: "home_4", main5: "home_5",
    "home-1": "home_1", "home-2": "home_2", "home-3": "home_3", "home-4": "home_4", "home-5": "home_5",
    right_top: "home_right_top", right_mid: "home_right_middle", right_middle: "home_right_middle", right_bottom: "home_right_bottom"
  },
  network: {
    right_panel: "network-right", rightpanel: "network-right", "network-right": "network-right"
  },
  distribution: {
    recommend: "distribution-recommend", today: "distribution-recommend", sponsored: "distribution-sponsor", sponsor: "distribution-sponsor",
    trending: "distribution-trending", popular: "distribution-trending", new: "distribution-new", special: "distribution-special",
    others: "distribution-others", etc: "distribution-others", right_panel: "distribution-right", rightpanel: "distribution-right"
  },
  social: {
    maru: "social-maru", youtube: "social-youtube", instagram: "social-instagram", tiktok: "social-tiktok", facebook: "social-facebook",
    wechat: "social-wechat", weibo: "social-weibo", pinterest: "social-pinterest", reddit: "social-reddit", twitter: "social-twitter",
    x: "social-twitter", right_panel: "rightPanel", rightpanel: "rightPanel"
  },
  media: {
    trending: "media-trending", movie: "media-movie", film: "media-movie", drama: "media-drama", thriller: "media-thriller",
    romance: "media-romance", variety: "media-variety", entertainment: "media-variety", documentary: "media-documentary",
    animation: "media-animation", music: "media-music", musicvideo: "media-music", shorts: "media-shorts"
  },
  tour: { right_panel: "tour", rightpanel: "tour", main: "tour" },
  donation: {
    global: "donation-global", ngo: "donation-ngo", mission: "donation-mission", service: "donation-service",
    relief: "donation-relief", education: "donation-education", environment: "donation-environment", others: "donation-others", etc: "donation-others"
  },
  "literature-academic": { main: "main" }
});

function rootOf(input) { return path.resolve((input && input.root) || process.cwd()); }
function str(v) { return v == null ? "" : String(v).trim(); }
function lower(v) { return str(v).toLowerCase(); }
function nowIso() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function bool(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  return ["1", "true", "yes", "on"].includes(lower(v));
}
function sha256(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : stableStringify(value), "utf8");
  return crypto.createHash("sha256").update(data).digest("hex");
}
function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}
function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { return null; }
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function atomicWriteJson(file, data) {
  ensureDir(path.dirname(file));
  const text = JSON.stringify(data, null, 2) + "\n";
  const tmp = path.join(path.dirname(file), "." + path.basename(file) + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp");
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
  return sha256(Buffer.from(text, "utf8"));
}
function fileHash(file) {
  try { return sha256(fs.readFileSync(file)); } catch (_e) { return ""; }
}
function fileExists(file) {
  try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch (_e) { return false; }
}
function uniq(values) { return Array.from(new Set(values.filter(Boolean))); }
function firstValue() {
  for (const value of arguments) {
    if (value !== undefined && value !== null && str(value)) return value;
  }
  return "";
}
function objectAt(object, keys) {
  let current = object;
  for (const key of keys) {
    if (!isObject(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}
function valuesFrom() {
  const out = [];
  for (const value of arguments) {
    if (Array.isArray(value)) out.push(...value);
    else if (value !== undefined && value !== null && str(value)) out.push(value);
  }
  return out.map(v => str(v)).filter(Boolean);
}
function normalizeUrl(value) {
  const raw = str(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch (_e) { return ""; }
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch (_e) { return ""; } }
function isHostMatch(host, rule) { return host === rule || host.endsWith("." + rule); }
function arrayOf(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function limitText(value, max) { const text = str(value); return text.length <= max ? text : text.slice(0, max); }

function upstreamPaths(root) {
  // Diagnostic compatibility only. Canonical publication in this system is fed
  // an explicit in-memory release bank by build-regional-brokerage-snapshots.js.
  // The durable source on disk is the actual Global Slot review queue.
  return [
    path.join(root, "netlify", "functions", "data", "commerce-candidate-review-queue.v1.json")
  ];
}
function publicPaths(root) {
  return [
    path.join(root, "data", PUBLIC_FILE),
    path.join(root, "netlify", "functions", "data", PUBLIC_FILE),
    path.join(root, "netlify", "functions", PUBLIC_FILE)
  ];
}
function policyPaths(root) {
  return [
    path.join(root, "netlify", "functions", "data", POLICY_FILE),
    path.join(root, "data", POLICY_FILE)
  ];
}
function releaseRoot(root) { return path.join(root, "data", RELEASE_DIR); }
function manifestPath(root) { return path.join(releaseRoot(root), "current-manifest.json"); }
function auditPath(root) { return path.join(releaseRoot(root), "audit", "latest.json"); }
function placementLedgerPath(root) { return path.join(releaseRoot(root), "placement-ledger.json"); }
function releaseManifestPath(root, releaseId) { return path.join(releaseRoot(root), "releases", releaseId, "manifest.json"); }
function rollbackRoot(root) { return path.join(releaseRoot(root), "rollback", "previous"); }

function defaultPolicy() {
  return {
    version: "canonical-snapshot-policy-v1",
    slotCapacityDefault: 100,
    requireMirrorConsensus: true,
    requireHttps: true,
    requireExplicitEligibility: true,
    requireCountryIso2: true,
    requireRegion: true,
    requireSourceTrace: true,
    requireTrustEvidence: true,
    requireVerificationTimestamp: true,
    maxVerificationAgeDays: 30,
    minimumTrustScore: 62,
    allowGlobalScopeOnlyWhenExplicit: true,
    outputSchema: "search-bank.snapshot.canonical.v1"
  };
}
function loadPolicy(root) {
  const base = defaultPolicy();
  for (const file of policyPaths(root)) {
    const loaded = safeReadJson(file);
    if (isObject(loaded)) return Object.assign({}, base, loaded);
  }
  return base;
}

function normalizePage(value) {
  const key = lower(value).replace(/\s+/g, "-");
  return PAGE_ALIASES[key] || "";
}
function normalizeSection(page, value, registry) {
  const raw = str(value);
  if (!raw) return "";
  const exact = raw;
  const allowed = registry.pages.get(page) || new Set();
  if (allowed.has(exact)) return exact;
  const lowerKey = lower(raw).replace(/\s+/g, "_");
  const aliases = SECTION_ALIASES[page] || {};
  const mapped = aliases[lowerKey] || aliases[lowerKey.replace(/_/g, "-")] || "";
  if (mapped && allowed.has(mapped)) return mapped;
  const caseMatch = Array.from(allowed).find(section => lower(section) === lower(raw));
  return caseMatch || "";
}

function loadRouteRegistry(root) {
  const source = path.join(root, "data", "psom.json");
  const mirror = path.join(root, "netlify", "functions", "data", "psom.json");
  const problems = [];
  const sourceJson = safeReadJson(source);
  const mirrorJson = safeReadJson(mirror);
  if (!sourceJson || !isObject(sourceJson)) problems.push("PSOM_SOURCE_MISSING_OR_INVALID");
  if (!mirrorJson || !isObject(mirrorJson)) problems.push("PSOM_MIRROR_MISSING_OR_INVALID");
  if (!problems.length && sha256(sourceJson) !== sha256(mirrorJson)) problems.push("PSOM_MIRROR_DIVERGED");
  const psom = sourceJson || mirrorJson || {};
  const pages = new Map();
  if (isObject(psom.pages)) {
    for (const [pageRaw, def] of Object.entries(psom.pages)) {
      const page = normalizePage(pageRaw) || pageRaw;
      const sections = Array.isArray(def && def.sections) ? def.sections.map(str).filter(Boolean) : [];
      if (page && sections.length) pages.set(page, new Set(sections));
    }
  }
  for (const needed of ["home", "network", "distribution", "social", "media", "tour", "donation", "literature-academic"]) {
    if (!pages.has(needed)) problems.push("PSOM_REQUIRED_PAGE_MISSING:" + needed);
  }
  return { ok: problems.length === 0, problems, pages, fingerprint: sha256(psom), source, mirror };
}

function loadTrustResources(root) {
  const base = path.join(root, "netlify", "functions", "data");
  const allow = safeReadJson(path.join(base, "trust.allowlist.json")) || {};
  const block = safeReadJson(path.join(base, "trust.blocklist.json")) || {};
  return {
    allowDomains: new Set(valuesFrom(allow.frontEligibleDomains, allow.authorityDomains, allow.cooperativeDomains).map(lower)),
    denyDomains: new Set(valuesFrom(block.domains, block.frontDeniedDomains).map(lower)),
    denyTlds: new Set(valuesFrom(block.tlds, block.frontDeniedTlds).map(lower)),
    denyPatterns: valuesFrom(block.patterns, block.frontDeniedPatterns).map(text => { try { return new RegExp(text, "i"); } catch (_e) { return null; } }).filter(Boolean)
  };
}

function sourceSnapshot(root, options) {
  if (options && options.bank && Array.isArray(options.bank.items)) {
    const doc = clone(options.bank);
    const digest = sha256(doc);
    return { ok: true, doc, digest, mirrors: [{ path: "[input.bank]", sha256: digest, count: doc.items.length }], source: "input.bank" };
  }

  // Current IGDC publication never reads a synthetic
  // SearchBank upstream mirror file. The build bridge must validate the
  // real Commerce review queue, run Candidate Intake, and pass the resulting
  // release bank explicitly. Failing here is safer than silently treating a
  // public SearchBank snapshot or an empty queue as a new publication source.
  return {
    ok: false,
    code: "EXPLICIT_RELEASE_BANK_REQUIRED",
    source: null,
    mirrors: upstreamPaths(root).map(file => ({ path: file, present: fileExists(file) }))
  };
}

function contractOf(item) {
  const discernment = isObject(item && item.osaiDiscernment) ? item.osaiDiscernment : {};
  return (isObject(item && item.searchBankContract) && item.searchBankContract)
    || (isObject(item && item.sanmaruSearchBankContract) && item.sanmaruSearchBankContract)
    || (isObject(item && item.searchBankUnifiedContract) && item.searchBankUnifiedContract)
    || (isObject(discernment.searchBankContract) && discernment.searchBankContract)
    || {};
}
function evidenceOf(item, contract) {
  const discernment = isObject(item.osaiDiscernment) ? item.osaiDiscernment : {};
  const evidence = isObject(item.sanmaruEvidence) ? item.sanmaruEvidence : {};
  const trusted = valuesFrom(
    item.trustEvidence, item.officialEvidence, item.producerEvidence, item.safetyEvidence,
    discernment.trustEvidence, discernment.officialEvidence, discernment.producerEvidence, discernment.safetyEvidence,
    evidence.trustEvidence, evidence.officialEvidence, evidence.producerEvidence, evidence.safetyEvidence,
    contract.trustEvidence, contract.officialEvidence, contract.producerEvidence, contract.safetyEvidence
  );
  const source = valuesFrom(item.sourceEvidence, discernment.sourceEvidence, evidence.sourceEvidence, contract.sourceEvidence);
  const verificationAt = firstValue(
    item.lastVerifiedAt, item.verifiedAt, item.checkedAt, item.linkVerifiedAt,
    discernment.lastVerifiedAt, discernment.verifiedAt, discernment.checkedAt,
    evidence.lastVerifiedAt, evidence.verifiedAt, evidence.checkedAt,
    contract.lastVerifiedAt, contract.verifiedAt, contract.checkedAt
  );
  const trustScore = Number(firstValue(item.sourceTrustScore, item.trustScore, discernment.trustScore, evidence.trustScore, contract.sourceTrustScore, 0)) || 0;
  const tier = str(firstValue(item.trustTier, discernment.trustTier, evidence.trustTier, contract.trustTier)).toUpperCase();
  return { trusted, source, verificationAt, trustScore, tier };
}
function specificProductUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if ((!url.pathname || url.pathname === "/") && !url.search) return "";
    return url.toString();
  } catch (_e) { return ""; }
}
function directProductUrlOf(item) {
  if (!item || typeof item !== "object") return "";
  const card = isObject(item.productCard) ? item.productCard : {};
  const readinessCard = isObject(objectAt(item, ["researchReadiness", "productCard"])) ? objectAt(item, ["researchReadiness", "productCard"]) : {};
  const listing = isObject(item.directCommerceListing) ? item.directCommerceListing : {};
  const contract = isObject(item.brokerageContract) ? item.brokerageContract : {};
  const values = [
    item.externalProductUrl, item.officialProductUrl, item.productUrl, item.productPageUrl,
    item.detailUrl, item.checkoutUrl, item.purchaseUrl, item.orderUrl, item.productLink,
    card.checkoutUrl, card.productUrl, readinessCard.checkoutUrl, readinessCard.productUrl,
    listing.destinationUrl, contract.destinationUrl
  ];
  for (const value of values) {
    const url = specificProductUrl(value);
    if (url) return url;
  }
  return "";
}
function productBearingRoute(page, section) {
  return ["home", "distribution", "network", "tour"].includes(page) || (page === "social" && section === "rightPanel");
}
function urlOf(item) {
  const directProductUrl = directProductUrlOf(item);
  if (directProductUrl) return directProductUrl;
  const link = item && item.link;
  const source = firstValue(item && item.url, item && item.homepage, isObject(link) ? firstValue(link.url, link.href) : link, objectAt(item, ["org", "homepage"]));
  return str(source);
}
function sourceTraceOf(item, url) {
  const source = item && item.source;
  const sourceName = firstValue(
    isObject(source) ? firstValue(source.name, source.provider, source.engine, source.id, source.type) : source,
    item && item.sourceName, item && item.provider, item && item.seller, item && item.producer && item.producer.name,
    item && item.collector && item.collector.engine, item && item.engine
  );
  const sourceUrlRaw = firstValue(
    isObject(source) ? firstValue(source.url, source.href, source.homepage) : "",
    item && item.sourceUrl, item && item.source_url, item && item.provenance && arrayOf(item.provenance.source_urls)[0], url
  );
  return { name: str(sourceName), url: normalizeUrl(sourceUrlRaw), host: hostOf(normalizeUrl(sourceUrlRaw)) };
}
function geoOf(item) {
  const geo = isObject(item && item.geo) ? item.geo : {};
  const supply = isObject(item && item.countrySupply) ? item.countrySupply : {};
  const mapping = isObject(item && item.productMapping) ? item.productMapping : {};
  const countryRaw = firstValue(
    item && item.targetCountry, item && item.countryCode, geo.countryCode, geo.country_code, geo.alpha2, geo.country,
    supply.targetMarket, supply.country, mapping.targetCountry, item && item.country
  );
  const regionCodeRaw = firstValue(
    geo.regionCode, geo.region_code, supply.regionCode, supply.targetRegionCode, mapping.regionCode, mapping.targetRegionCode
  );
  const regionRaw = firstValue(
    item && item.targetRegion, regionCodeRaw, geo.region, geo.state, supply.targetRegion, supply.distributionMarketRegion,
    mapping.targetRegion, item && item.region
  );
  const globalExplicit = bool(item && item.globalAvailability) || bool(supply.globalAvailability) || lower(countryRaw) === "global" || lower(countryRaw) === "all";
  const nationalExplicit = bool(supply.nationalAvailability) || bool(item && item.nationalAvailability) || ["national", "nationwide"].includes(lower(regionRaw));
  return { countryRaw: str(countryRaw), regionRaw: str(regionRaw), regionCodeRaw: str(regionCodeRaw), globalExplicit, nationalExplicit };
}
function normalizeCountry(raw, globalExplicit) {
  const code = str(raw).toUpperCase();
  if (globalExplicit && ["GLOBAL", "ALL"].includes(code)) return "GLOBAL";
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
function normalizeRegion(raw, globalExplicit, nationalExplicit, country) {
  let value = str(raw).toUpperCase().replace(/[._/\s]+/g, "-").replace(/^-+|-+$/g, "");
  const countryCode = str(country).toUpperCase();
  if (countryCode && value.startsWith(countryCode + "-")) value = value.slice(3);
  if (globalExplicit && ["GLOBAL", "ALL"].includes(value)) return "GLOBAL";
  if (nationalExplicit && (!value || ["NATIONAL", "NATIONWIDE"].includes(value))) return "NATIONWIDE";
  if (value.length < 2 || value.length > 16) return "";
  if (/^(sample|placeholder|unknown|none|null|n\/a)$/i.test(value)) return "";
  return /^[A-Z0-9][A-Z0-9-]*$/.test(value) ? value : "";
}
function placementValues(item) {
  const placement = isObject(item && item.placement) ? item.placement : {};
  const bind = isObject(item && item.bind) ? item.bind : {};
  const pointer = isObject(item && item.layerPointer) ? item.layerPointer : {};
  return {
    pages: uniq(valuesFrom(placement.page, bind.page, pointer.page, item && item.page, item && item.channel, item && item.route)),
    sections: uniq(valuesFrom(placement.section, bind.section, pointer.section, item && item.psom_key, item && item.section, item && item.slotKey)),
    slots: uniq(valuesFrom(placement.slot, placement.slotId, bind.slot, bind.slotId, pointer.slot, item && item.slot, item && item.slotId))
  };
}
function requestedSlot(values) {
  if (!values || !values.length) return null;
  const parsed = uniq(values.map(value => String(Number(value))).filter(value => /^\d+$/.test(value) && Number(value) > 0));
  return parsed.length === 1 ? Number(parsed[0]) : NaN;
}
function blockedByText(item, patterns) {
  const text = [item && item.title, item && item.name, item && item.summary, item && item.description, item && item.url, item && item.source].map(str).join(" ");
  return patterns.some(pattern => pattern.test(text));
}
function isSampleLike(item, url) {
  const raw = lower(url);
  const image = lower(firstValue(item && item.image, item && item.thumb, item && item.thumbnail, objectAt(item, ["media", "thumb"])));
  const source = lower(firstValue(item && item.source, objectAt(item, ["collector", "engine"])));
  const text = lower([item && item.title, item && item.summary, item && item.description].map(str).join(" "));
  return !raw || raw === "#" || raw === "/" || raw.startsWith("javascript:") ||
    /(^|\/)(sample|samples|placeholder|demo|mock|fixture)(\/|$)/.test(raw) ||
    /(^|\/)(sample|samples|placeholder|demo|mock|fixture)(\/|$)/.test(image) ||
    /\b(seed|placeholder|sample|demo|mock|test item|replace when verified)\b/.test(source + " " + text) ||
    /^(network|distribution|media|social|donation|tour|home) item \d+$/i.test(str(item && item.title));
}
function verificationTimestampValid(value, maxAgeDays) {
  const parsed = Date.parse(str(value));
  if (!Number.isFinite(parsed)) return false;
  const now = Date.now();
  return parsed <= now + 5 * 60 * 1000 && parsed >= now - Math.max(1, Number(maxAgeDays) || 30) * 86400000;
}
function explicitTrue(value) { return value === true || lower(value) === "true" || value === 1 || value === "1"; }

function validateCandidate(raw, index, context) {
  const reasons = [];
  if (!isObject(raw)) return { ok: false, reasons: ["CANDIDATE_NOT_OBJECT"], audit: { index, candidateId: null } };
  const item = clone(raw);
  const baseCandidateId = str(firstValue(item.id, item.contentId, item.productId, item.uid, item.indexId)) || "anon-" + sha256({ index, url: urlOf(item), title: item.title || item.name }).slice(0, 20);
  const marketScopeKey = str(objectAt(item, ["marketScope", "key"]));
  const candidateId = marketScopeKey ? baseCandidateId + "::" + marketScopeKey : baseCandidateId;
  const destinationRaw = urlOf(item);
  const destination = normalizeUrl(destinationRaw);
  const imageRaw = firstValue(item.image, item.thumb, item.thumbnail, objectAt(item, ["media", "thumb"]), objectAt(item, ["media", "image"]));
  const image = normalizeUrl(imageRaw);
  const host = hostOf(destination);
  const contract = contractOf(item);
  const evidence = evidenceOf(item, contract);
  const source = sourceTraceOf(item, destination);
  const geo = geoOf(item);
  const placement = placementValues(item);
  const pageRaw = placement.pages.map(normalizePage).filter(Boolean);
  const pages = uniq(pageRaw);
  const requested = requestedSlot(placement.slots);

  if (!str(item.title || item.name)) reasons.push("TITLE_MISSING");
  if (!destination) reasons.push("DESTINATION_NOT_HTTPS");
  if (!image) reasons.push("IMAGE_NOT_HTTPS");
  if (isSampleLike(item, destinationRaw) || /(^|\/)(sample|samples|placeholder|demo|mock|fixture)(\/|$)/i.test(str(imageRaw))) reasons.push("PLACEHOLDER_OR_SAMPLE");
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "localhost" || host.endsWith(".local") || host.includes("example.")) reasons.push("DESTINATION_HOST_UNSAFE");
  if (host && Array.from(context.trust.denyDomains).some(rule => isHostMatch(host, rule))) reasons.push("DESTINATION_DOMAIN_DENIED");
  if (host && context.trust.denyTlds.has(host.split(".").pop())) reasons.push("DESTINATION_TLD_DENIED");
  if (blockedByText(item, context.trust.denyPatterns)) reasons.push("BLOCKLIST_PATTERN_MATCH");

  if (pages.length !== 1) reasons.push(pages.length ? "PAGE_MAPPING_CONFLICT" : "PAGE_MAPPING_MISSING");
  const page = pages[0] || "";
  if (page && !context.registry.pages.has(page)) reasons.push("PAGE_NOT_IN_PSOM");
  const normalizedSections = page ? placement.sections.map(value => normalizeSection(page, value, context.registry)).filter(Boolean) : [];
  const sections = uniq(normalizedSections);
  if (sections.length !== 1) reasons.push(sections.length ? "SECTION_MAPPING_CONFLICT" : "SECTION_MAPPING_MISSING");
  const section = sections[0] || "";
  if (page && section && !(context.registry.pages.get(page) || new Set()).has(section)) reasons.push("SECTION_NOT_IN_PSOM_PAGE");
  if (page && section && productBearingRoute(page, section) && !specificProductUrl(destination)) reasons.push("PRODUCT_DETAIL_DESTINATION_REQUIRED");
  if (Number.isNaN(requested)) reasons.push("SLOT_MAPPING_CONFLICT");
  if (requested != null && requested > context.policy.slotCapacityDefault) reasons.push("SLOT_OUT_OF_CAPACITY");

  const country = normalizeCountry(geo.countryRaw, geo.globalExplicit);
  const region = normalizeRegion(geo.regionRaw, geo.globalExplicit, geo.nationalExplicit, country);
  if (!country) reasons.push("COUNTRY_REQUIRES_ISO_3166_ALPHA2");
  if (!region) reasons.push("REGION_MISSING_OR_INVALID");
  if (country === "GLOBAL" && !geo.globalExplicit) reasons.push("GLOBAL_SCOPE_NOT_EXPLICIT");
  if (region === "GLOBAL" && !geo.globalExplicit) reasons.push("GLOBAL_REGION_NOT_EXPLICIT");
  let ipSlot = { ok: true, scoped: false, reasons: [], mapping: null };
  if (context.ipPolicy && context.ipPolicy.ok && page && section && country && region) {
    ipSlot = IpSlotPolicy.validateCandidate(item, { policy: context.ipPolicy, page, section, country, region });
    if (!ipSlot.ok) reasons.push(...ipSlot.reasons);
    if (ipSlot.scoped && country === "GLOBAL") reasons.push("IP_SLOT_GLOBAL_SCOPE_FORBIDDEN");
    // IP-owned product surfaces must arrive through the private Commerce
    // Candidate Intake envelope.  Raw SearchBank rows cannot bypass the
    // life-need, non-PG revenue-right, review and release-key gates.
    if (ipSlot.scoped) {
      const selection = isObject(item.candidateSelection) ? item.candidateSelection : {};
      const commerceCandidate = isObject(item.commerceCandidate) ? item.commerceCandidate : {};
      if (selection.releaseEligible !== true || commerceCandidate.releaseEligible !== true) reasons.push("COMMERCE_CANDIDATE_RELEASE_ENVELOPE_MISSING");
      if (!str(selection.sourceTier) || !str(selection.selectionDigest)) reasons.push("COMMERCE_CANDIDATE_PROVENANCE_MISSING");
    }
  }

  if (!source.name) reasons.push("SOURCE_NAME_MISSING");
  if (!source.url) reasons.push("SOURCE_URL_NOT_HTTPS");
  if (source.host && Array.from(context.trust.denyDomains).some(rule => isHostMatch(source.host, rule))) reasons.push("SOURCE_DOMAIN_DENIED");
  if (/(seed|sample|placeholder|demo|mock)/i.test(source.name)) reasons.push("SOURCE_IS_NONPRODUCTION");

  if (contract.blocked === true || item.blocked === true || str(firstValue(contract.blockedReason, item.blockedReason))) reasons.push("CONTRACT_BLOCKED");
  for (const flag of ["frontSupplyAllowed", "searchBankEligible", "snapshotEligible", "indexEligible"]) {
    const value = firstValue(contract[flag], item[flag], objectAt(item, ["osaiDiscernment", "eligibility", flag]));
    if (!explicitTrue(value)) reasons.push("ELIGIBILITY_NOT_EXPLICIT:" + flag);
  }
  const risk = lower(firstValue(contract.riskLevel, item.riskLevel, objectAt(item, ["osaiDiscernment", "riskLevel"]), "low"));
  if (["high", "critical", "blocked", "illegal", "unsafe"].includes(risk)) reasons.push("RISK_LEVEL_NOT_PUBLISHABLE:" + risk);
  if (evidence.trustScore < Number(context.policy.minimumTrustScore || 62) && !["A+", "A", "B"].includes(evidence.tier) && !bool(firstValue(item.officialSource, contract.officialSource, item.institutionVerified, contract.institutionVerified, item.producerVerified, contract.producerVerified, item.directProducerChannel, contract.directProducerChannel))) {
    reasons.push("TRUST_THRESHOLD_NOT_MET");
  }
  if (!evidence.trusted.length && !evidence.source.length && !bool(firstValue(item.officialSource, contract.officialSource, item.institutionVerified, contract.institutionVerified, item.producerVerified, contract.producerVerified))) reasons.push("TRUST_EVIDENCE_MISSING");
  if (!verificationTimestampValid(evidence.verificationAt, context.policy.maxVerificationAgeDays)) reasons.push("VERIFICATION_TIMESTAMP_MISSING_OR_STALE");

  const fingerprint = sha256({
    candidateId, destination, page, section, country, region,
    source: { name: source.name, url: source.url },
    trust: { score: evidence.trustScore, tier: evidence.tier, evidence: evidence.trusted.slice().sort() },
    ipSlot: ipSlot && ipSlot.mapping || null
  });
  const audit = {
    index,
    candidateId,
    inputDigest: sha256(raw),
    destinationHost: host || null,
    destinationDigest: destination ? sha256(destination) : null,
    page: page || null,
    section: section || null,
    country: country || null,
    region: region || null,
    marketScope: marketScopeKey || null,
    ipSlot: ipSlot && ipSlot.mapping || null,
    reasons: reasons.slice(0, 80),
    source: source.name ? { name: limitText(source.name, 160), host: source.host || null } : null
  };
  if (reasons.length) return { ok: false, reasons, audit };
  return {
    ok: true,
    raw: item,
    index,
    candidateId,
    fingerprint,
    destination,
    image,
    source,
    evidence,
    page,
    section,
    requestedSlot: requested,
    country,
    region,
    ipSlotMapping: ipSlot && ipSlot.mapping || null,
    audit
  };
}

function loadLedger(root) {
  const existing = safeReadJson(placementLedgerPath(root));
  const entries = isObject(existing && existing.entries) ? existing.entries : {};
  return { version: "canonical-placement-ledger-v1", entries };
}
function sourceTierOf(candidate) {
  const raw = candidate && candidate.raw || {};
  const selection = isObject(raw.candidateSelection) ? raw.candidateSelection : {};
  return str(selection.sourceTier || objectAt(raw, ["commerceCandidate", "sourceTier"]));
}
function isApprovedDirect(candidate) { return sourceTierOf(candidate) === "approved_commerce_member"; }
function numeric(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function getPriority(candidate) {
  const raw = candidate.raw || {};
  const selection = isObject(raw.candidateSelection) ? raw.candidateSelection : {};
  const sourceTier = sourceTierOf(candidate);
  const sourceBoost = sourceTier === "approved_commerce_member" ? 10000000 : (sourceTier === "managed_sponsor" ? 5000000 : 0);
  const managedBoost = raw.managedPriority === true ? 1000000 : 0;
  // Use a sum, not the first numeric value: a generic candidate with
  // managedPriority=false must still keep its verified ranking score.
  return sourceBoost + managedBoost + numeric(selection.rankingScore) + numeric(raw.priority) + numeric(raw.score) + numeric(raw.compositeScore) + numeric(raw.qualityScore);
}
function assignSlots(candidates, ledger, policy) {
  const rejected = [];
  const assigned = [];
  const capacity = Math.max(1, Number(policy.slotCapacityDefault) || 100);
  const groups = new Map();
  const firstFree = used => { for (let i = 1; i <= capacity; i += 1) if (!used.has(i)) return i; return null; };
  for (const candidate of candidates) {
    const key = candidate.page + "|" + candidate.section + "|" + candidate.country + "|" + candidate.region;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  for (const [, group] of groups.entries()) {
    const used = new Map();
    const priorFor = candidate => {
      const prior = ledger.entries[candidate.candidateId];
      return prior && prior.fingerprint === candidate.fingerprint && prior.page === candidate.page && prior.section === candidate.section && prior.country === candidate.country && prior.region === candidate.region && Number(prior.slot) >= 1 && Number(prior.slot) <= capacity ? Number(prior.slot) : null;
    };
    const place = (candidate, slot, origin) => {
      used.set(slot, candidate.candidateId);
      assigned.push(Object.assign({}, candidate, { slot, slotOrigin: origin }));
    };

    // Administrator-approved direct commerce is intentionally allowed to take
    // the foremost free positions before generic referral rows retained from a
    // prior release. It still must satisfy all Canonical evidence contracts.
    const direct = group.filter(isApprovedDirect).sort((a, b) => getPriority(b) - getPriority(a) || a.candidateId.localeCompare(b.candidateId));
    const remaining = group.filter(candidate => !isApprovedDirect(candidate));
    for (const candidate of direct) {
      // Direct listings are re-ranked ahead of generic brokerage on every
      // release unless an administrator explicitly pins a slot upstream.
      let slot = candidate.requestedSlot != null ? candidate.requestedSlot : firstFree(used);
      if (slot != null && used.has(slot)) {
        // A direct item may not displace another direct item; when the desired
        // slot is occupied it falls to the next free slot rather than silently
        // overwriting a manager's approved placement.
        slot = firstFree(used);
      }
      if (!slot || slot > capacity) { rejected.push({ candidate, reason: "SECTION_CAPACITY_EXHAUSTED" }); continue; }
      place(candidate, slot, candidate.requestedSlot != null ? "upstream-direct" : "publisher-direct");
    }

    const retained = [];
    const incoming = [];
    for (const candidate of remaining) {
      const priorSlot = priorFor(candidate);
      if (priorSlot != null && !used.has(priorSlot)) retained.push({ candidate, slot: priorSlot, origin: "ledger" });
      else incoming.push(candidate);
    }
    retained.sort((a, b) => a.slot - b.slot || getPriority(b.candidate) - getPriority(a.candidate) || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
    for (const entry of retained) {
      if (used.has(entry.slot)) { incoming.push(entry.candidate); continue; }
      place(entry.candidate, entry.slot, entry.origin);
    }
    incoming.sort((a, b) => getPriority(b) - getPriority(a) || a.candidateId.localeCompare(b.candidateId));
    for (const candidate of incoming) {
      let slot = candidate.requestedSlot;
      if (slot != null && used.has(slot)) {
        const incumbentId = used.get(slot);
        const incumbent = assigned.find(entry => entry.candidateId === incumbentId);
        // An approved direct item may legitimately take the prominent slot;
        // retain the otherwise valid generic candidate in the next free slot.
        if (incumbent && isApprovedDirect(incumbent)) slot = firstFree(used);
        else { rejected.push({ candidate, reason: "REQUESTED_SLOT_COLLISION" }); continue; }
      }
      if (slot == null) slot = firstFree(used);
      if (!slot || slot > capacity) { rejected.push({ candidate, reason: "SECTION_CAPACITY_EXHAUSTED" }); continue; }
      place(candidate, slot, candidate.requestedSlot != null ? "upstream" : "publisher");
    }
  }
  return { assigned, rejected };
}

function buildCanonicalItem(entry, releaseId) {
  const item = clone(entry.raw);
  const trustSignals = uniq(entry.evidence.trusted.concat(entry.evidence.source)).slice(0, 60);
  const sourceDigest = sha256({ name: entry.source.name, url: entry.source.url, destination: entry.destination });
  const evidenceDigest = sha256({ score: entry.evidence.trustScore, tier: entry.evidence.tier, signals: trustSignals, verifiedAt: entry.evidence.verificationAt });
  const mapping = { page: entry.page, section: entry.section, slot: entry.slot, country: entry.country, region: entry.region, ipSlot: entry.ipSlotMapping || null };
  const mappingDigest = sha256(mapping);
  item.id = item.id || entry.candidateId;
  item.page = entry.page;
  item.channel = entry.page;
  item.section = entry.section;
  item.psom_key = entry.section;
  item.bind = Object.assign({}, isObject(item.bind) ? item.bind : {}, { page: entry.page, section: entry.section, slot: entry.slot });
  item.placement = {
    page: entry.page,
    section: entry.section,
    slot: entry.slot,
    country: entry.country,
    region: entry.region,
    slotOrigin: entry.slotOrigin,
    locked: true,
    mappingVersion: CONTRACT_VERSION
  };
  item.slot = entry.slot;
  item.slotId = entry.slot;
  item.country = entry.country;
  item.region = entry.region;
  item.url = entry.destination;
  const isProductRoute = productBearingRoute(entry.page, entry.section);
  const directProductUrl = directProductUrlOf(entry.raw) || (isProductRoute ? specificProductUrl(entry.destination) : "");
  if (directProductUrl) {
    item.externalProductUrl = directProductUrl;
    item.productUrl = directProductUrl;
    item.productPageUrl = directProductUrl;
    item.detailUrl = directProductUrl;
    item.checkoutUrl = directProductUrl;
  }
  item.image = entry.image;
  item.thumb = entry.image;
  item.thumbnail = entry.image;
  item.canonicalSource = {
    name: entry.source.name,
    url: entry.source.url,
    host: entry.source.host,
    digest: sourceDigest
  };
  item.canonicalEvidence = {
    verifiedAt: entry.evidence.verificationAt,
    trustScore: entry.evidence.trustScore,
    trustTier: entry.evidence.tier || null,
    signals: trustSignals,
    digest: evidenceDigest
  };
  if (entry.ipSlotMapping) {
    item.ipSlot = {
      required: true,
      policyVersion: entry.ipSlotMapping.policyVersion || null,
      strategyId: entry.ipSlotMapping.strategyId || null,
      role: entry.ipSlotMapping.role || null,
      slotProfile: entry.ipSlotMapping.slotProfile || null,
      strategyDigest: entry.ipSlotMapping.strategyDigest || null,
      marketCountry: entry.country,
      marketRegion: entry.region,
      availabilityVerifiedAt: entry.ipSlotMapping.availabilityVerifiedAt || null,
      sellerResponsibilityVerified: entry.ipSlotMapping.sellerResponsibilityVerified === true,
      marketScopeKey: entry.ipSlotMapping.marketScopeKey || null,
      marketEvidenceDigest: entry.ipSlotMapping.marketEvidenceDigest || null,
      marketServicesVerified: entry.ipSlotMapping.marketServicesVerified === true
    };
  }
  if (isObject(item.candidateSelection) || isObject(item.commerceCandidate)) {
    const selection = isObject(item.candidateSelection) ? item.candidateSelection : {};
    const commerceCandidate = isObject(item.commerceCandidate) ? item.commerceCandidate : {};
    item.commerceCandidatePublication = {
      version: CommerceCandidateIntake.VERSION,
      sourceTier: str(selection.sourceTier || commerceCandidate.sourceTier) || null,
      selectionDigest: str(selection.selectionDigest || commerceCandidate.selectionDigest) || null,
      rankingScore: Number(selection.rankingScore) || null,
      revenue: isObject(selection.revenue) ? clone(selection.revenue) : (isObject(commerceCandidate.revenue) ? clone(commerceCandidate.revenue) : null),
      review: isObject(selection.review) ? clone(selection.review) : (isObject(commerceCandidate.review) ? clone(commerceCandidate.review) : null)
    };
  }
  item.canonicalPublication = {
    version: VERSION,
    contractVersion: CONTRACT_VERSION,
    status: "published",
    releaseId,
    candidateId: entry.candidateId,
    candidateFingerprint: entry.fingerprint,
    mappingDigest,
    sourceDigest,
    evidenceDigest,
    publishedAt: nowIso()
  };
  return item;
}

function makeReleaseId(upstreamDigest, items) {
  return "cs-" + nowIso().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + sha256({ upstreamDigest, items: items.map(item => item.id) }).slice(0, 12);
}
function publishedDoc(releaseId, registry, upstream, items, counts) {
  return {
    meta: {
      schema: "search-bank.snapshot.canonical.v1",
      publisherVersion: VERSION,
      contractVersion: CONTRACT_VERSION,
      releaseId,
      generatedAt: nowIso(),
      source: "canonical-snapshot-publisher",
      upstreamDigest: upstream.digest,
      routeRegistryDigest: registry.fingerprint,
      candidateCounts: counts,
      publicOnlyVerified: true,
      pgPolicy: "payment execution remains pending until separate PG approval"
    },
    items
  };
}

function snapshotForRollback(root, currentManifest) {
  if (!isObject(currentManifest) || currentManifest.status !== "published") return null;
  const finalPath = publicPaths(root)[0];
  if (!fileExists(finalPath)) return null;
  const doc = safeReadJson(finalPath);
  if (!doc || !Array.isArray(doc.items)) return null;
  if (!currentManifest.outputs || !currentManifest.outputs[0] || currentManifest.outputs[0].sha256 !== fileHash(finalPath)) return null;
  const dir = rollbackRoot(root);
  ensureDir(dir);
  atomicWriteJson(path.join(dir, PUBLIC_FILE), doc);
  atomicWriteJson(path.join(dir, "manifest.json"), currentManifest);
  return { releaseId: currentManifest.releaseId || null, storedAt: nowIso() };
}

function writePublicMirrors(root, document) {
  const writes = [];
  const publicDocument = PublicSnapshot.sanitizeDocument(document);
  for (const file of publicPaths(root)) {
    const digest = atomicWriteJson(file, publicDocument);
    writes.push({ path: path.relative(root, file).replace(/\\/g, "/"), sha256: digest, count: publicDocument.items.length });
  }
  const hashes = new Set(writes.map(entry => entry.sha256));
  if (hashes.size !== 1) throw new Error("PUBLIC_MIRROR_WRITE_DIVERGENCE");
  return writes;
}

function publish(input) {
  const root = rootOf(input);
  const policy = loadPolicy(root);
  const registry = loadRouteRegistry(root);
  const ipPolicy = IpSlotPolicy.load(root);
  const upstream = sourceSnapshot(root, { bank: input && input.bank, requireMirrorConsensus: policy.requireMirrorConsensus !== false && !(input && input.requireMirrorConsensus === false) });
  const startedAt = nowIso();
  const report = {
    version: VERSION,
    contractVersion: CONTRACT_VERSION,
    startedAt,
    trigger: (input && input.trigger) || "manual",
    status: "blocked",
    upstream: { source: upstream.source || null, digest: upstream.digest || null, mirrors: upstream.mirrors || [] },
    routeRegistry: { fingerprint: registry.fingerprint || null, source: registry.source, mirror: registry.mirror },
    ipSlotPolicy: { fingerprint: ipPolicy.fingerprint || null, source: ipPolicy.source, mirror: ipPolicy.mirror },
    counts: { received: 0, marketVariants: 0, accepted: 0, rejected: 0, slotRejected: 0 },
    errors: []
  };
  if (!registry.ok) { report.errors.push(...registry.problems); return report; }
  if (!ipPolicy.ok) { report.errors.push(...ipPolicy.problems); return report; }
  // No IP slot strategy may point outside the PSOM page/section registry. A
  // page is normally fully IP scoped; a partial surface (currently social) must
  // declare its exact IP-owned sections so non-commercial body sections remain
  // on their existing snapshot contract.
  const partialIpSections = isObject(ipPolicy.policy.ipScopedSections) ? ipPolicy.policy.ipScopedSections : {};
  for (const scopedPage of ipPolicy.policy.ipScopedPages || []) {
    const psomSections = registry.pages.get(scopedPage) || new Set();
    const strategies = ipPolicy.policy.slotStrategies && ipPolicy.policy.slotStrategies[scopedPage] || {};
    const partial = Array.isArray(partialIpSections[scopedPage]) ? new Set(partialIpSections[scopedPage].map(str).filter(Boolean)) : null;
    const requiredSections = partial || psomSections;
    for (const section of requiredSections) {
      if (!psomSections.has(section)) report.errors.push("IP_SLOT_PARTIAL_SECTION_NOT_IN_PSOM:" + scopedPage + ":" + section);
      else if (!strategies[section]) report.errors.push("IP_SLOT_STRATEGY_MISSING_FOR_PSOM_SECTION:" + scopedPage + ":" + section);
    }
    for (const section of Object.keys(strategies)) {
      if (!psomSections.has(section)) report.errors.push("IP_SLOT_STRATEGY_NOT_IN_PSOM:" + scopedPage + ":" + section);
      else if (partial && !partial.has(section)) report.errors.push("IP_SLOT_STRATEGY_OUTSIDE_DECLARED_PARTIAL_SCOPE:" + scopedPage + ":" + section);
    }
  }
  if (report.errors.length) return report;
  if (!upstream.ok) { report.errors.push(upstream.code || "UPSTREAM_UNAVAILABLE"); return report; }

  const trust = loadTrustResources(root);
  const context = { root, policy, registry, trust, ipPolicy };
  // Build the private commerce staging queue first.  The intake owns category,
  // non-PG revenue-right, direct-listing approval and release-key gating;
  // Canonical remains the sole public publication boundary.
  const commerceIntake = CommerceCandidateIntake.build({ root, items: Array.isArray(upstream.doc.items) ? upstream.doc.items : [], trigger: report.trigger });
  report.commerceCandidateIntake = {
    version: CommerceCandidateIntake.VERSION,
    digest: commerceIntake.digest,
    releaseGate: commerceIntake.releaseGate,
    summary: commerceIntake.summary,
    queue: { digest: commerceIntake.queue && commerceIntake.queue.digest || null, stale: !!(commerceIntake.queue && commerceIntake.queue.stale) },
    stagePath: path.relative(root, path.join(root, "netlify", "functions", "data", CommerceCandidateIntake.STAGING_FILE)).replace(/\\/g, "/")
  };
  if (!commerceIntake.ok) { report.errors.push(...(commerceIntake.problems || ["COMMERCE_CANDIDATE_INTAKE_BLOCKED"])); return report; }
  const effectiveUpstream = Object.assign({}, upstream, {
    digest: sha256({ upstreamDigest: upstream.digest, commerceCandidateIntakeDigest: commerceIntake.digest }),
    source: String(upstream.source || "upstream") + "+commerce-candidate-intake",
    candidateIntakeDigest: commerceIntake.digest
  });
  const rawItems = commerceIntake.releaseItems;
  report.counts.received = commerceIntake.summary.considered;
  const expandedItems = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const marketVariants = MarketSaleScope.expand(rawItems[index]);
    if (marketVariants.length) {
      for (const variant of marketVariants) expandedItems.push({ item: variant.item, sourceIndex: index, marketKey: variant.key });
    } else {
      // Non-IP surfaces retain their existing canonical contract. IP surfaces
      // without a real market-sale record fail closed in IpSlotPolicy.
      expandedItems.push({ item: rawItems[index], sourceIndex: index, marketKey: "" });
    }
  }
  report.counts.marketVariants = expandedItems.length;
  const acceptedCandidates = [];
  const auditRows = [];
  const seenCandidate = new Map();
  const seenDestination = new Set();
  for (let index = 0; index < expandedItems.length; index += 1) {
    const expanded = expandedItems[index];
    const result = validateCandidate(expanded.item, expanded.sourceIndex, context);
    if (!result.ok) { auditRows.push(Object.assign({ status: "rejected", marketVariant: expanded.marketKey || null }, result.audit)); continue; }
    if (seenCandidate.has(result.candidateId)) {
      auditRows.push(Object.assign({ status: "rejected", duplicateOf: seenCandidate.get(result.candidateId), marketVariant: expanded.marketKey || null, reasons: ["DUPLICATE_CANDIDATE_ID"] }, result.audit));
      continue;
    }
    // One product destination may validly be published in several verified
    // sale markets. Deduplication is therefore market-scope aware.
    const destinationKey = result.page + "|" + result.section + "|" + result.country + "|" + result.region + "|" + result.destination;
    if (seenDestination.has(destinationKey)) {
      auditRows.push(Object.assign({ status: "rejected", marketVariant: expanded.marketKey || null, reasons: ["DUPLICATE_DESTINATION_IN_MARKET_SECTION"] }, result.audit));
      continue;
    }
    seenCandidate.set(result.candidateId, expanded.sourceIndex);
    seenDestination.add(destinationKey);
    acceptedCandidates.push(result);
  }
  const ledger = loadLedger(root);
  const slotResult = assignSlots(acceptedCandidates, ledger, policy);
  for (const rejected of slotResult.rejected) {
    auditRows.push(Object.assign({ status: "rejected", reasons: [rejected.reason] }, rejected.candidate.audit));
  }
  const provisionalReleaseId = makeReleaseId(effectiveUpstream.digest, slotResult.assigned);
  const items = slotResult.assigned
    .sort((a, b) => a.page.localeCompare(b.page) || a.section.localeCompare(b.section) || a.slot - b.slot || a.candidateId.localeCompare(b.candidateId))
    .map(entry => buildCanonicalItem(entry, provisionalReleaseId));
  report.counts.accepted = items.length;
  report.counts.rejected = auditRows.length;
  report.counts.slotRejected = slotResult.rejected.length;

  const previousManifest = safeReadJson(manifestPath(root));
  const rollback = snapshotForRollback(root, previousManifest);
  const document = publishedDoc(provisionalReleaseId, registry, effectiveUpstream, items, report.counts);
  const outputs = writePublicMirrors(root, document);
  const nextLedger = { version: "canonical-placement-ledger-v1", updatedAt: nowIso(), releaseId: provisionalReleaseId, entries: {} };
  for (const entry of slotResult.assigned) {
    nextLedger.entries[entry.candidateId] = { fingerprint: entry.fingerprint, page: entry.page, section: entry.section, slot: entry.slot, country: entry.country, region: entry.region, updatedAt: nowIso() };
  }
  const manifest = {
    schema: "canonical-snapshot-release-manifest-v1",
    status: "published",
    publisherVersion: VERSION,
    contractVersion: CONTRACT_VERSION,
    releaseId: provisionalReleaseId,
    generatedAt: nowIso(),
    trigger: report.trigger,
    input: {
      source: effectiveUpstream.source,
      upstreamDigest: effectiveUpstream.digest,
      upstreamMirrors: upstream.mirrors,
      routeRegistryDigest: registry.fingerprint,
      received: report.counts.received,
      accepted: report.counts.accepted,
      rejected: report.counts.rejected
    },
    outputs,
    rollback,
    commerceCandidateIntake: {
      version: CommerceCandidateIntake.VERSION,
      digest: commerceIntake.digest,
      releaseGate: { enabled: commerceIntake.releaseGate.enabled, mode: commerceIntake.releaseGate.mode, reason: commerceIntake.releaseGate.reason },
      summary: commerceIntake.summary,
      queueDigest: commerceIntake.queue && commerceIntake.queue.digest || null
    },
    mapping: items.map(item => ({
      candidateId: item.canonicalPublication.candidateId,
      candidateFingerprint: item.canonicalPublication.candidateFingerprint,
      page: item.placement.page,
      section: item.placement.section,
      slot: item.placement.slot,
      country: item.placement.country,
      region: item.placement.region,
      mappingDigest: item.canonicalPublication.mappingDigest,
      ipSlot: item.ipSlot || null,
      sourceDigest: item.canonicalPublication.sourceDigest,
      evidenceDigest: item.canonicalPublication.evidenceDigest
    })),
    verification: {
      publicMirrorConsensus: true,
      noImplicitPromotion: true,
      placeholderAndSampleBlocked: true,
      sourceAndEvidenceRequired: true,
      exactPageSectionSlotRequired: true,
      countryRegionRequired: true,
      marketSaleScopeRequiredForIpSlots: true,
      originCountryIsNotEligibilityGate: true,
      crossCountrySnapshotFallbackDisabled: true,
      legacyFallbackDisabled: true,
      commerceCandidateIntakeRequiredForIpSlots: true,
      commercePublicationAuthorizationRequired: true,
      deploymentReleaseKeyOrExplicitAdminQueueRequired: true,
      explicitAdminQueueIsCountryRegionScoped: true,
      authoritativeEmptyQueueRestoresSampleFallback: true,
      ipSlotPolicyDigest: ipPolicy.fingerprint
    }
  };
  const audit = {
    schema: "canonical-snapshot-audit-v1",
    releaseId: provisionalReleaseId,
    generatedAt: nowIso(),
    sourceDigest: effectiveUpstream.digest,
    received: report.counts.received,
    accepted: manifest.mapping,
    rejected: auditRows.slice(0, MAX_AUDIT_ROWS),
    rejectedTruncated: auditRows.length > MAX_AUDIT_ROWS,
    policy: {
      maxVerificationAgeDays: policy.maxVerificationAgeDays,
      minimumTrustScore: policy.minimumTrustScore,
      slotCapacityDefault: policy.slotCapacityDefault
    }
  };
  atomicWriteJson(placementLedgerPath(root), nextLedger);
  atomicWriteJson(manifestPath(root), manifest);
  atomicWriteJson(auditPath(root), audit);
  atomicWriteJson(releaseManifestPath(root, provisionalReleaseId), manifest);
  report.status = "published";
  report.releaseId = provisionalReleaseId;
  report.outputs = outputs;
  report.audit = path.relative(root, auditPath(root)).replace(/\\/g, "/");
  return report;
}

function verifyPublished(input) {
  const root = rootOf(input);
  const manifest = safeReadJson(manifestPath(root));
  const ipPolicy = IpSlotPolicy.load(root);
  const problems = [];
  if (!ipPolicy.ok) problems.push(...ipPolicy.problems);
  if (!manifest || manifest.status !== "published") problems.push("MANIFEST_MISSING_OR_UNPUBLISHED");
  const expected = manifest && Array.isArray(manifest.outputs) ? manifest.outputs : [];
  const actualPaths = publicPaths(root);
  if (expected.length !== actualPaths.length) problems.push("MANIFEST_OUTPUT_COUNT_MISMATCH");
  const parsed = [];
  for (let i = 0; i < actualPaths.length; i += 1) {
    const file = actualPaths[i];
    const doc = safeReadJson(file);
    const actualHash = fileHash(file);
    const expectedHash = expected[i] && expected[i].sha256;
    if (!doc || !Array.isArray(doc.items)) problems.push("PUBLIC_SNAPSHOT_INVALID:" + path.relative(root, file));
    if (expectedHash && actualHash !== expectedHash) problems.push("PUBLIC_SNAPSHOT_HASH_MISMATCH:" + path.relative(root, file));
    parsed.push({ file, doc, actualHash });
  }
  const primary = parsed[0] && parsed[0].doc;
  const mapping = new Map((manifest && Array.isArray(manifest.mapping) ? manifest.mapping : []).map(row => [row.candidateId, row]));
  const slotSeen = new Set();
  for (const item of (primary && primary.items) || []) {
    const publication = item && item.canonicalPublication;
    const placement = item && item.placement;
    if (!publication || publication.status !== "published" || publication.releaseId !== (manifest && manifest.releaseId)) { problems.push("ITEM_PUBLICATION_ENVELOPE_INVALID:" + str(item && item.id)); continue; }
    if (!placement || !placement.page || !placement.section || !Number.isInteger(Number(placement.slot)) || !placement.country || !placement.region) { problems.push("ITEM_PLACEMENT_INVALID:" + str(item && item.id)); continue; }
    const row = mapping.get(publication.candidateId);
    if (!row || row.mappingDigest !== publication.mappingDigest) problems.push("ITEM_MANIFEST_MAPPING_MISMATCH:" + str(item && item.id));
    const key = [placement.page, placement.section, placement.country, placement.region, placement.slot].join("|");
    if (slotSeen.has(key)) problems.push("PUBLISHED_SLOT_COLLISION:" + key);
    const scoped = IpSlotPolicy.isScoped(ipPolicy, placement.page, placement.section);
    if (scoped && (!item.ipSlot || item.ipSlot.required !== true || item.ipSlot.marketCountry !== placement.country || item.ipSlot.marketRegion !== placement.region)) problems.push("PUBLISHED_IP_SLOT_ENVELOPE_INVALID:" + str(item && item.id));
    if (scoped) {
      const marketScope = item && item.marketScope;
      const marketValidation = MarketSaleScope.validateMarketScope(marketScope, placement.country, placement.region, {
        maxVerificationAgeDays: Number(ipPolicy.policy && ipPolicy.policy.validation && ipPolicy.policy.validation.maxAvailabilityVerificationAgeDays || 30),
        requireFresh: true
      });
      if (!marketValidation.ok) problems.push("PUBLISHED_MARKET_SCOPE_EVIDENCE_INVALID:" + str(item && item.id) + ":" + marketValidation.reasons.join(","));
      if (!item.ipSlot || item.ipSlot.marketEvidenceDigest !== marketValidation.evidenceDigest) problems.push("PUBLISHED_MARKET_EVIDENCE_DIGEST_MISMATCH:" + str(item && item.id));
    }
    slotSeen.add(key);
    if (isSampleLike(item, item.url) || !normalizeUrl(item.url)) problems.push("PUBLISHED_ITEM_NOT_REAL:" + str(item && item.id));
  }
  return {
    ok: problems.length === 0,
    version: VERSION,
    releaseId: manifest && manifest.releaseId || null,
    itemCount: (primary && primary.items || []).length,
    problems,
    manifest: manifest ? path.relative(root, manifestPath(root)).replace(/\\/g, "/") : null
  };
}

module.exports = {
  VERSION,
  CONTRACT_VERSION,
  UPSTREAM_FILE,
  PUBLIC_FILE,
  publish,
  verifyPublished,
  loadRouteRegistry,
  loadPolicy,
  publicPaths,
  upstreamPaths,
  manifestPath,
  auditPath
};
