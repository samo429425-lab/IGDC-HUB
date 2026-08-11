"use strict";

/**
 * Publishes only Distribution Hub regional brokerage snapshots.
 * It never edits global public snapshots, SearchBank source data, Search.js,
 * Media, Tour, Donation, or any other hub.
 *
 * A generated regional snapshot is deleted on the next build when all of its
 * candidates no longer pass the safety/responsibility gate. This prevents a
 * stale external seller card from remaining live after source data changes.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Policy = require("./regional-brokerage-policy.core.v1");
const Gate = require("./regional-brokerage-front-supply-gate.core.v1");
const NonPgRevenue = require("./nonpg-revenue-contract.core.v1");
const CanonicalPublisher = require("./canonical-snapshot-publisher.v1");
const SlotOverlay = require("./sample-slot-overlay.v1");
const PublicSnapshot = require("./public-snapshot-sanitizer.v1");

const SNAPSHOT_FILE = "distribution.snapshot.json";
const REGISTRY_FILE = "regional-brokerage-outbound.json";
const MANIFEST_FILE = "regional-brokerage-manifest.json";
const DEFAULT_SECTION = "distribution-recommend";

function text(v) { return v == null ? "" : String(v).trim(); }
function first() { for (const v of arguments) { const x = text(v); if (x) return x; } return ""; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function safeRead(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { return null; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function sha(v) { return crypto.createHash("sha256").update(String(v)).digest("hex").slice(0, 24); }
function httpUrl(v) { try { const u = new URL(String(v)); return u.protocol === "https:" ? u.toString() : ""; } catch (_e) { return ""; } }
function rootOf(input) { return path.resolve(input && input.root || process.cwd()); }
function firstExisting(paths) { return paths.find((p) => { try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch (_e) { return false; } }) || ""; }
function unique(values) { const out = []; const seen = new Set(); for (const value of values || []) { const x = text(value); if (!x || seen.has(x)) continue; seen.add(x); out.push(x); } return out; }

function lower(v) { return text(v).toLowerCase(); }
function truthy(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  return !["", "0", "false", "no", "off", "disabled", "disable", "null", "undefined"].includes(lower(v));
}

/**
 * Canonical publication stores responsibility evidence in a normalized market
 * envelope. The older regional policy reader expects a few legacy top-level
 * evidence fields. Build a non-mutating compatibility view so the already
 * verified Canonical evidence is evaluated without weakening the gate.
 */
function policyCandidate(item) {
  if (!item || typeof item !== "object") return item;
  const out = clone(item);
  const marketScope = out.marketScope && typeof out.marketScope === "object" ? out.marketScope : {};
  const evidence = marketScope.marketEvidence && typeof marketScope.marketEvidence === "object" ? marketScope.marketEvidence : {};
  const shipping = evidence.shipping && typeof evidence.shipping === "object" ? evidence.shipping : (out.shipping || {});
  const returns = evidence.returns && typeof evidence.returns === "object" ? evidence.returns : (out.returns || {});
  const support = evidence.support && typeof evidence.support === "object" ? evidence.support : (out.support || {});
  const responsibility = evidence.sellerResponsibility && typeof evidence.sellerResponsibility === "object" ? evidence.sellerResponsibility : (out.sellerResponsibility || {});
  const responsibilityVerified = truthy(responsibility.verified) && truthy(shipping.verified) && truthy(returns.verified) && truthy(support.verified);
  const responsibilityEvidence = unique([
    returns.evidenceUrl,
    support.evidenceUrl,
    responsibility.supportUrl,
    responsibility.legalEntity,
    marketScope.marketEvidenceDigest,
    marketScope.evidenceDigest
  ]);

  if (responsibilityVerified && responsibilityEvidence.length) {
    out.localResponsibilityEvidence = out.localResponsibilityEvidence || responsibilityEvidence.join(" | ");
    out.returnPolicyUrl = out.returnPolicyUrl || text(returns.evidenceUrl);
    out.customerSupportUrl = out.customerSupportUrl || text(support.evidenceUrl || responsibility.supportUrl);
    out.seller = Object.assign({}, out.seller || {}, {
      responsibilityEvidence: out.seller && out.seller.responsibilityEvidence || responsibilityEvidence.join(" | "),
      customerSupportUrl: out.seller && out.seller.customerSupportUrl || text(support.evidenceUrl || responsibility.supportUrl)
    });
  }

  out.distributionMarketCountry = out.distributionMarketCountry || text(marketScope.marketCountry);
  if (!out.distributionMarketRegion && text(marketScope.marketRegion) && text(marketScope.marketRegion).toUpperCase() !== "NATIONWIDE") {
    out.distributionMarketRegion = text(marketScope.marketRegion);
  }
  if (!Array.isArray(out.availabilityCountries) || !out.availabilityCountries.length) {
    const country = text(marketScope.marketCountry);
    if (country) out.availabilityCountries = [country];
  }
  if (text(marketScope.marketRegion).toUpperCase() === "NATIONWIDE") out.nationalAvailability = true;
  return out;
}

function approvedRevenueMarketplaceCandidate(item) {
  const publication = item && item.canonicalPublication || {};
  const commerce = item && item.commerceCandidate || {};
  const review = commerce.review || item && item.commerceReview || {};
  const revenue = commerce.revenue || {};
  const route = item && item.outboundRoute || {};
  const contract = item && item.brokerageContract || {};
  const state = lower(first(review.state, review.assignment, review.status, review.assignmentState));
  const routeMode = lower(route.mode);
  const contractId = first(route.contractId, revenue.contractId, contract.id, contract.contractId);
  const approvedRoute = ["approved_manual_affiliate", "approved_direct_revenue"].includes(routeMode);
  return publication.status === "published" && !!publication.releaseId && commerce.releaseEligible === true &&
    ["approved", "pinned"].includes(state) && revenue.payable === true &&
    revenue.disclosureReady === true && revenue.payoutBasisVerified === true &&
    approvedRoute && !!contractId;
}

function marketplaceExceptionPolicy(policy, market) {
  const copy = clone(policy || {});
  copy.defaults = Object.assign({}, copy.defaults || {}, { excludeLargeMarketplacesFromDistribution: false });
  copy.hubProfiles = Object.assign({}, copy.hubProfiles || {});
  copy.hubProfiles.distribution = Object.assign({}, copy.hubProfiles.distribution || {}, { excludeLargeMarketplaces: false });
  const code = Policy.normalizeCountry(market);
  if (code) {
    copy.markets = Object.assign({}, copy.markets || {});
    const existing = copy.markets[code] || copy.markets[code.toLowerCase()] || copy.markets[code.toUpperCase()] || {};
    const selected = clone(existing);
    selected.excludeLargeMarketplacesFromDistribution = false;
    selected.hubProfiles = Object.assign({}, selected.hubProfiles || {});
    selected.hubProfiles.distribution = Object.assign({}, selected.hubProfiles.distribution || {}, { excludeLargeMarketplaces: false });
    copy.markets[code] = selected;
  }
  return copy;
}

/**
 * Large marketplaces remain excluded by default. A narrowly scoped exception
 * is allowed only after Canonical publication plus the payable-revenue gate,
 * operator approval, disclosure approval and a verified payout contract.
 */
function buildRegionalSelection(items, context) {
  const prepared = (items || []).map(policyCandidate);
  const base = Gate.buildSelection(prepared, context || {});
  const promoted = [];
  const held = [];
  for (const entry of base.held || []) {
    const reasons = Array.isArray(entry.decision && entry.decision.reasons) ? entry.decision.reasons : [];
    const marketplaceOnly = reasons.length > 0 && reasons.every(reason => reason === "LARGE_MARKETPLACE_RESERVED_FOR_MARKET_HUB");
    if (!marketplaceOnly || !approvedRevenueMarketplaceCandidate(entry.item)) {
      held.push(entry);
      continue;
    }
    const relaxed = Gate.buildSelection([entry.item], Object.assign({}, context || {}, {
      policy: marketplaceExceptionPolicy(context && context.policy, context && context.targetMarket)
    }));
    if (relaxed.accepted && relaxed.accepted.length) promoted.push(relaxed.accepted[0]);
    else held.push(relaxed.held && relaxed.held[0] || entry);
  }
  const accepted = (base.accepted || []).concat(promoted);
  const heldByReason = {};
  for (const entry of held) {
    const reasons = Array.isArray(entry.decision && entry.decision.reasons) && entry.decision.reasons.length ? entry.decision.reasons : ["COUNTRY_POLICY_HOLD"];
    for (const reason of reasons) heldByReason[reason] = (heldByReason[reason] || 0) + 1;
  }
  const acceptedByTier = {};
  for (const entry of accepted) {
    const tier = entry.decision && entry.decision.supplyTier || "unknown";
    acceptedByTier[tier] = (acceptedByTier[tier] || 0) + 1;
  }
  return Object.assign({}, base, {
    accepted,
    held,
    acceptedItems: accepted.map(entry => entry.item),
    heldItems: held.map(entry => entry.item),
    audit: Object.assign({}, base.audit || {}, {
      acceptedCount: accepted.length,
      heldCount: held.length,
      acceptedByTier,
      heldByReason,
      approvedRevenueMarketplaceExceptions: promoted.length
    })
  });
}

function canonicalDistributionItem(item) {
  const publication = item && item.canonicalPublication;
  const placement = item && item.placement;
  return !!(
    publication && publication.status === "published" && publication.releaseId && publication.candidateId && publication.mappingDigest &&
    placement && placement.page === "distribution" && placement.section && Number.isInteger(Number(placement.slot)) && placement.country && placement.region
  );
}
function sourceBank(root) {
  const verification = CanonicalPublisher.verifyPublished({ root });
  if (!verification || !verification.ok) return { file:null, items:[], verification:verification || { ok:false, problems:["CANONICAL_VERIFIER_UNAVAILABLE"] } };
  const file = firstExisting([
    path.join(root, "data", "search-bank.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "search-bank.snapshot.json"),
    path.join(root, "netlify", "functions", "search-bank.snapshot.json")
  ]);
  const data = file ? safeRead(file) : null;
  const canonical = !!(data && data.meta && data.meta.schema === "search-bank.snapshot.canonical.v1");
  return {
    file: canonical ? file : null,
    items: canonical && Array.isArray(data && data.items) ? data.items.filter(canonicalDistributionItem) : [],
    verification
  };
}
function sourceDistributionTemplate(root) {
  const file = firstExisting([
    path.join(root, "data", SNAPSHOT_FILE),
    path.join(root, "netlify", "functions", "data", SNAPSHOT_FILE)
  ]);
  return { file, data: file ? safeRead(file) : null };
}
function specificProductUrl(value) {
  const url = httpUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if ((!parsed.pathname || parsed.pathname === "/") && !parsed.search) return "";
    return parsed.toString();
  } catch (_e) { return ""; }
}
function targetUrl(item) {
  const candidates = [
    item && item.externalProductUrl,
    item && item.officialProductUrl,
    item && item.productUrl,
    item && item.productPageUrl,
    item && item.detailUrl,
    item && item.checkoutUrl,
    item && item.purchaseUrl,
    item && item.orderUrl,
    item && item.productLink,
    item && item.url,
    item && item.link && (item.link.url || item.link.href || item.link)
  ];
  for (const candidate of candidates) {
    const url = specificProductUrl(candidate);
    if (url) return url;
  }
  return "";
}
function sectionMap(sections) {
  const out = Object.create(null);
  for (const key of Object.keys(sections || {})) out[key.toLowerCase()] = key;
  return out;
}
function sectionFor(item, sections) {
  const map = sectionMap(sections);
  const raw = first(item && item.bind && item.bind.section, item && item.section, item && item.psom_key, item && item.slotKey).toLowerCase();
  const aliases = {
    "dist_1": "distribution-recommend", "distribution_1": "distribution-recommend",
    "dist_2": "distribution-sponsor", "distribution_2": "distribution-sponsor",
    "dist_3": "distribution-trending", "distribution_3": "distribution-trending",
    "dist_4": "distribution-new", "distribution_4": "distribution-new",
    "dist_5": "distribution-special", "distribution_5": "distribution-special",
    "dist_6": "distribution-others", "distribution_6": "distribution-others",
    "dist_right": "distribution-right", "distribution-right": "distribution-right"
  };
  return map[raw] || map[aliases[raw]] || map[DEFAULT_SECTION] || Object.keys(sections || {})[0] || DEFAULT_SECTION;
}
function cardId(item, market, region, url) {
  return "rb-" + sha([market, region || "national", first(item && item.id, item && item.contentId, item && item.productId, item && item.title), url].join("|"));
}
function sellerLabel(item) {
  return first(item && item.seller && item.seller.name, item && item.distributor && item.distributor.name, item && item.merchant && item.merchant.name, item && item.provider, item && item.source, item && item.org && item.org.name, "Verified external seller");
}
function imageOf(item) {
  return first(item && item.thumbnail, item && item.thumb, item && item.image, item && item.imageUrl, item && item.media && item.media.thumb, "/assets/img/placeholder.png");
}
function managerListings(root) {
  const file = firstExisting([
    path.join(root, "netlify", "functions", "data", "distribution-priority-listings.json"),
    path.join(root, "data", "distribution-priority-listings.json")
  ]);
  const parsed = file ? safeRead(file) : null;
  return Array.isArray(parsed && parsed.listings) ? parsed.listings : [];
}
function approvedManagerItem(listing) {
  if (!listing || typeof listing !== "object") return null;
  const approved = listing.approved === true || String(listing.status || "").toLowerCase() === "approved";
  const authorized = listing.ownerAuthorized === true || (listing.owner && listing.owner.authorized === true);
  if (!approved || !authorized) return null;
  return Object.assign({}, listing.item && typeof listing.item === "object" ? listing.item : listing, {
    managedPriority: true,
    platformVerified: true
  });
}
function listingScope(listing, fallbackMarket) {
  const item = approvedManagerItem(listing);
  if (!item) return null;
  const market = Policy.normalizeCountry(first(listing.targetMarket, listing.market, listing.country, item.targetMarket, item.distributionMarketCountry, item.sellerMarketCountry, fallbackMarket));
  if (!market || market === "GLOBAL") return null;
  const region = Policy.normalizeRegion(first(listing.targetRegion, listing.region, item.targetRegion, item.distributionMarketRegion, item.sellerRegion), market);
  return { item, market, region };
}
function priorityItems(root, market, region, policy) {
  const out = [];
  for (const listing of managerListings(root)) {
    const scope = listingScope(listing, market);
    if (!scope || scope.market !== market) continue;
    // A region-specific manager listing is never copied into a country-wide
    // snapshot. A country-wide listing can appear in each regional view.
    if (!region && scope.region) continue;
    if (region && scope.region && scope.region !== region) continue;
    const selection = buildRegionalSelection([scope.item], { targetMarket: market, targetRegion: region || "", hub: "distribution", policy });
    if (selection.accepted.length) out.push(selection.accepted[0]);
  }
  return out;
}
function scopes(root, items, policy) {
  const result = new Map();
  function ensure(market) { if (!result.has(market)) result.set(market, new Set()); return result.get(market); }
  for (const item of items) {
    const prepared = policyCandidate(item);
    const dist = Policy.distributionMarketEvidence(prepared);
    const availability = Policy.availabilityEvidence(prepared);
    const responsibility = Policy.localResponsibilityEvidence(prepared);
    if (!dist.country || dist.country === "GLOBAL" || !availability.countries.includes(dist.country) || !responsibility.present) continue;
    const regions = ensure(dist.country);
    const sellerRegion = Policy.distributionRegionEvidence(prepared, dist.country).region;
    const availabilityRegions = Policy.regionalAvailabilityEvidence(prepared, dist.country).regions || [];
    if (sellerRegion) regions.add(sellerRegion);
    for (const region of availabilityRegions) regions.add(region);
  }
  // An approved manager listing can legitimately be the first listing for a
  // market/region, before automatic discovery has produced a local candidate.
  for (const listing of managerListings(root)) {
    const scope = listingScope(listing);
    if (!scope) continue;
    const regions = ensure(scope.market);
    if (scope.region) regions.add(scope.region);
  }
  return result;
}
function distributionTemplateWithSamples(template) {
  const doc = clone(template);
  const sections = doc && doc.pages && doc.pages.distribution && doc.pages.distribution.sections;
  if (!sections || typeof sections !== "object") return null;
  doc.pages.distribution.sections = SlotOverlay.overlaySections(sections, new Map());
  doc.meta = Object.assign({}, doc.meta || {}, {
    regionalBrokerageSnapshot: true,
    source: "verified-external-responsible-seller-referral",
    directSale: false,
    globalCardsInherited: false,
    sampleFallbackPreserved: true
  });
  return doc;
}
function listForSection(sections, key) {
  const value = sections[key];
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.slots)) return value.slots;
  sections[key] = [];
  return sections[key];
}
function slotCapacity(templateSections, key) {
  const value = templateSections && templateSections[key];
  if (Array.isArray(value)) return Math.max(1, value.length || 100);
  if (value && Array.isArray(value.slots)) return Math.max(1, value.slots.length || 100);
  return 100;
}
function makeCard(item, decision, market, region, registry) {
  const destination = targetUrl(item);
  if (!destination) return null;
  const id = cardId(item, market, region, destination);
  const host = new URL(destination).host.toLowerCase();
  // Preserve only an explicit, provider-approved affiliate contract.
  // A generic seller URL or a policy percentage never becomes a claimed margin.
  const affiliate = NonPgRevenue.publicAffiliate(item);
  const outboundRoute = item && item.outboundRoute && typeof item.outboundRoute === "object" ? clone(item.outboundRoute) : null;
  const providerOutbound = item && (item.affiliateOutboundUrl || item.externalOutboundUrl) || "";
  const outboundUrl = providerOutbound || ("/.netlify/functions/regional-brokerage-outbound?id=" + encodeURIComponent(id));
  registry[id] = {
    id,
    targetUrl: destination,
    approvedHost: host,
    targetMarket: market,
    targetRegion: region || null,
    revenueLine: "brokerage_referral_lead_ad",
    seller: sellerLabel(item),
    sourceItemId: first(item.id, item.contentId, item.productId),
    affiliate,
    createdAt: new Date().toISOString()
  };
  return {
    id,
    title: first(item.title, item.name, "Verified external listing"),
    summary: "",
    description: "",
    price: item.price == null ? undefined : item.price,
    currency: item.currency || undefined,
    cta: first(item.cta, "View seller offer"),
    url: outboundUrl,
    // Keep the exact seller product detail as a first-class front contract.
    // `url` may remain a measurement redirect, but every AutoMap can now use
    // the same verified product destination without guessing from section data.
    externalProductUrl: destination,
    productUrl: destination,
    detailUrl: destination,
    checkoutUrl: destination,
    affiliateOutboundUrl: item && item.affiliateOutboundUrl || undefined,
    externalOutboundUrl: item && item.externalOutboundUrl || undefined,
    outboundRoute,
    thumb: imageOf(item),
    image: imageOf(item),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 20) : undefined,
    priority: item.managedPriority ? 1000000 : Number(item.priority || item.score || 0),
    managedPriority: item.managedPriority === true,
    saleMode: "external_brokerage",
    directSale: { enabled: false, policy: "seller_checkout_only" },
    commerce: { mode: "external_seller_referral", sellerCheckout: true, inventoryOwner: "external_seller", fulfilmentOwner: "external_seller", returnsOwner: "external_seller" },
    monetization: {
      model: outboundRoute && outboundRoute.mode === "approved_manual_affiliate" ? "approved_manual_affiliate" : (outboundRoute && outboundRoute.mode === "verified_external_referral" ? "external_referral_traffic" : "brokerage_referral_lead_ad"),
      revenueLine: outboundRoute && outboundRoute.mode === "approved_manual_affiliate" ? "product_affiliate" : "external_seller_visit",
      outboundTracking: true,
      affiliate: affiliate ? {
        eligible: affiliate.eligible === true,
        providerId: affiliate.providerId || null,
        programId: affiliate.programId || null,
        commissionRate: affiliate.commissionRate == null ? null : affiliate.commissionRate
      } : null
    },
    affiliate,
    revenueDestination: outboundRoute && outboundRoute.mode === "approved_manual_affiliate" ? "provider-approved-affiliate" : "external-seller-referral",
    seller: { name: sellerLabel(item), responsibility: "external_seller" },
    countrySupply: {
      targetMarket: market,
      targetRegion: region || null,
      distributionMarketCountry: decision.distributionMarketCountry || decision.sourceCountry || null,
      distributionMarketRegion: decision.distributionMarketRegion || null,
      availabilityCountries: decision.availabilityCountries || [],
      availabilityRegions: decision.availabilityRegions || [],
      nationalAvailability: decision.nationalAvailability === true,
      supplierVerified: decision.supplierVerified === true,
      supplierTrustEvidence: decision.supplierTrustEvidence || [],
      localResponsibilityVerified: decision.localResponsibilityVerified === true,
      supplyTier: decision.supplyTier || "unknown",
      policyVersion: decision.policyVersion || null
    },
    // The brokerage renderer may rewrite the outbound URL for tracking, but it
    // must preserve the Canonical Publisher admission envelope and exact PSOM
    // placement. The IP router verifies this envelope before exposing a scope.
    canonicalPublication: item && item.canonicalPublication ? clone(item.canonicalPublication) : null,
    placement: item && item.placement ? clone(item.placement) : null,
    ipSlot: item && item.ipSlot ? clone(item.ipSlot) : null,
    marketScope: item && item.marketScope ? clone(item.marketScope) : null,
    productMapping: item && item.productMapping ? clone(item.productMapping) : null
  };
}
function outputPath(root, market, region) {
  return path.join(root, "data", "auto", market, ...(region ? [region] : []), SNAPSHOT_FILE);
}
function publishScope(root, template, allItems, market, region, policy, registry) {
  const selection = buildRegionalSelection(allItems, { targetMarket: market, targetRegion: region || "", hub: "distribution", policy });
  const priority = priorityItems(root, market, region, policy);
  const accepted = priority.concat(selection.accepted.filter((entry) => !priority.some((p) => p.id === entry.id)));
  if (!accepted.length) return { published: false, market, region: region || null, audit: selection.audit };
  const doc = distributionTemplateWithSamples(template);
  if (!doc) return { published: false, market, region: region || null, reason: "DISTRIBUTION_TEMPLATE_INVALID", audit: selection.audit };
  const sections = doc.pages.distribution.sections;
  const templateSections = template.pages.distribution.sections;
  const seenIds = new Set();
  const seenSlots = new Set();
  const realBySection = new Map();
  let written = 0;
  for (const entry of accepted) {
    const item = entry.item || entry;
    const decision = entry.decision || Gate.decisionForCandidate(item, selection, { hub: "distribution" });
    const card = makeCard(item, decision || {}, market, region, registry);
    if (!card || seenIds.has(card.id)) continue;
    const section = sectionFor(item, sections);
    const capacity = slotCapacity(templateSections, section);
    const slot = SlotOverlay.slotOf(card, 0);
    const slotKey = section + "|" + slot;
    if (!slot || slot > capacity || seenSlots.has(slotKey)) continue;
    seenIds.add(card.id);
    seenSlots.add(slotKey);
    card.section = section;
    card.psom_key = section;
    card.slot = slot;
    card.slotId = slot;
    card.bind = Object.assign({}, card.bind || {}, { page: "distribution", section, slot });
    card.placement = Object.assign({}, card.placement || {}, { page: "distribution", section, slot });
    if (!realBySection.has(section)) realBySection.set(section, []);
    realBySection.get(section).push(card);
    written += 1;
  }
  if (!written) return { published: false, market, region: region || null, audit: selection.audit };
  doc.pages.distribution.sections = SlotOverlay.overlaySections(templateSections, realBySection);
  const sampleCount = Object.values(doc.pages.distribution.sections).reduce((sum, value) => sum + SlotOverlay.list(value).filter(SlotOverlay.isSampleCard).length, 0);
  doc.meta = Object.assign({}, doc.meta || {}, {
    targetMarket: market,
    targetRegion: region || null,
    generatedAt: new Date().toISOString(),
    regionalBrokerageAccepted: written,
    realCardCount: written,
    sampleCardCount: sampleCount,
    sampleFallbackPreserved: true,
    regionalBrokerageAudit: selection.audit
  });
  const output = outputPath(root, market, region);
  write(output, PublicSnapshot.sanitizeDocument(doc));
  return { published: true, market, region: region || null, output: path.relative(root, output), written, sampleCount, audit: selection.audit };
}
function pruneEmptyDirs(root, dir) {
  const autoRoot = path.join(root, "data", "auto");
  let current = dir;
  while (current.startsWith(autoRoot)) {
    try {
      if (fs.readdirSync(current).length) break;
      fs.rmdirSync(current);
      if (current === autoRoot) break;
      current = path.dirname(current);
    } catch (_e) { break; }
  }
}
function managedSnapshotFiles(root) {
  const autoRoot = path.join(root, "data", "auto");
  const files = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === SNAPSHOT_FILE) {
        const doc = safeRead(full);
        if (doc && doc.meta && doc.meta.regionalBrokerageSnapshot === true) files.push(full);
      }
    }
  }
  walk(autoRoot);
  return files;
}
function cleanupStaleSnapshots(root, keepOutputs) {
  const removed = [];
  for (const file of managedSnapshotFiles(root)) {
    if (keepOutputs.has(path.resolve(file))) continue;
    try {
      fs.unlinkSync(file);
      removed.push(path.relative(root, file));
      pruneEmptyDirs(root, path.dirname(file));
    } catch (_e) {}
  }
  return removed;
}
function publishFromSearchBank(input) {
  const root = rootOf(input);
  const policy = Policy.loadPolicy(true);
  const source = sourceBank(root);
  const templateInfo = sourceDistributionTemplate(root);
  const report = {
    version: "regional-brokerage-publisher-v1.2-exact-product-destination",
    generatedAt: new Date().toISOString(),
    sourceBank: source.file ? path.relative(root, source.file) : null,
    canonicalPublicationVerified: !!(source.verification && source.verification.ok),
    scopes: [],
    removedStaleSnapshots: []
  };
  const registry = {};
  const keepOutputs = new Set();
  if (templateInfo.data && source.items.length) {
    for (const [market, regions] of scopes(root, source.items, policy).entries()) {
      const country = publishScope(root, templateInfo.data, source.items, market, "", policy, registry);
      report.scopes.push(country);
      if (country.published) keepOutputs.add(path.resolve(root, country.output));
      for (const region of regions) {
        const regional = publishScope(root, templateInfo.data, source.items, market, region, policy, registry);
        report.scopes.push(regional);
        if (regional.published) keepOutputs.add(path.resolve(root, regional.output));
      }
    }
  }
  report.removedStaleSnapshots = cleanupStaleSnapshots(root, keepOutputs);
  const registryOut = { version: "regional-brokerage-outbound-registry-v1", generatedAt: new Date().toISOString(), entries: registry };
  write(path.join(root, "netlify", "functions", "data", REGISTRY_FILE), registryOut);
  const webPaths = Array.from(keepOutputs).map((file) => "/" + path.relative(root, file).replace(/\\/g, "/")).sort();
  const manifestOut = {
    version: "regional-brokerage-manifest-v1",
    generatedAt: new Date().toISOString(),
    model: "verified-external-responsible-seller-referral",
    snapshots: webPaths
  };
  const manifestFile = path.join(root, "data", "auto", MANIFEST_FILE);
  write(manifestFile, manifestOut);
  report.manifest = path.relative(root, manifestFile);
  report.publishedSnapshotCount = webPaths.length;
  return report;
}

module.exports = { publishFromSearchBank };
