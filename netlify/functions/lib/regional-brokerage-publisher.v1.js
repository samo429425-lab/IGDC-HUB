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

function sourceBank(root) {
  const file = firstExisting([
    path.join(root, "data", "search-bank.snapshot.json"),
    path.join(root, "netlify", "functions", "data", "search-bank.snapshot.json"),
    path.join(root, "netlify", "functions", "search-bank.snapshot.json")
  ]);
  const data = file ? safeRead(file) : null;
  return { file, items: Array.isArray(data && data.items) ? data.items : [] };
}
function sourceDistributionTemplate(root) {
  const file = firstExisting([
    path.join(root, "data", SNAPSHOT_FILE),
    path.join(root, "netlify", "functions", "data", SNAPSHOT_FILE)
  ]);
  return { file, data: file ? safeRead(file) : null };
}
function targetUrl(item) {
  return httpUrl(first(
    item && item.externalProductUrl,
    item && item.officialProductUrl,
    item && item.productUrl,
    item && item.landingUrl,
    item && item.externalSellerUrl,
    item && item.url,
    item && item.link && (item.link.url || item.link.href || item.link)
  ));
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
    const selection = Gate.buildSelection([scope.item], { targetMarket: market, targetRegion: region || "", hub: "distribution", policy });
    if (selection.accepted.length) out.push(selection.accepted[0]);
  }
  return out;
}
function scopes(root, items, policy) {
  const result = new Map();
  function ensure(market) { if (!result.has(market)) result.set(market, new Set()); return result.get(market); }
  for (const item of items) {
    const dist = Policy.distributionMarketEvidence(item);
    const availability = Policy.availabilityEvidence(item);
    const responsibility = Policy.localResponsibilityEvidence(item);
    if (!dist.country || dist.country === "GLOBAL" || !availability.countries.includes(dist.country) || !responsibility.present) continue;
    const regions = ensure(dist.country);
    const sellerRegion = Policy.distributionRegionEvidence(item, dist.country).region;
    const availabilityRegions = Policy.regionalAvailabilityEvidence(item, dist.country).regions || [];
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
function emptyDistributionTemplate(template) {
  const doc = clone(template);
  const sections = doc && doc.pages && doc.pages.distribution && doc.pages.distribution.sections;
  if (!sections || typeof sections !== "object") return null;
  for (const [key, value] of Object.entries(sections)) {
    if (Array.isArray(value)) sections[key] = [];
    else if (value && Array.isArray(value.slots)) value.slots = [];
  }
  doc.meta = Object.assign({}, doc.meta || {}, {
    regionalBrokerageSnapshot: true,
    source: "verified-external-responsible-seller-referral",
    directSale: false,
    globalCardsInherited: false
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
  registry[id] = {
    id,
    targetUrl: destination,
    approvedHost: host,
    targetMarket: market,
    targetRegion: region || null,
    revenueLine: "brokerage_referral_lead_ad",
    seller: sellerLabel(item),
    sourceItemId: first(item.id, item.contentId, item.productId),
    createdAt: new Date().toISOString()
  };
  return {
    id,
    title: first(item.title, item.name, "Verified external listing"),
    summary: first(item.summary, item.description, item.snippet, "External seller listing with seller-side checkout, delivery and service."),
    description: first(item.description, item.summary, item.snippet, ""),
    price: item.price == null ? undefined : item.price,
    currency: item.currency || undefined,
    cta: first(item.cta, "View seller offer"),
    url: "/.netlify/functions/regional-brokerage-outbound?id=" + encodeURIComponent(id),
    externalProductUrl: destination,
    thumb: imageOf(item),
    image: imageOf(item),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 20) : undefined,
    priority: item.managedPriority ? 1000000 : Number(item.priority || item.score || 0),
    managedPriority: item.managedPriority === true,
    saleMode: "external_brokerage",
    directSale: { enabled: false, policy: "seller_checkout_only" },
    commerce: { mode: "external_seller_referral", sellerCheckout: true, inventoryOwner: "external_seller", fulfilmentOwner: "external_seller", returnsOwner: "external_seller" },
    monetization: { model: "brokerage_referral_lead_ad", revenueLine: "brokerage_referral_lead_ad", outboundTracking: true },
    revenueDestination: "external-seller-referral",
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
    }
  };
}
function outputPath(root, market, region) {
  return path.join(root, "data", "auto", market, ...(region ? [region] : []), SNAPSHOT_FILE);
}
function publishScope(root, template, allItems, market, region, policy, registry) {
  const selection = Gate.buildSelection(allItems, { targetMarket: market, targetRegion: region || "", hub: "distribution", policy });
  const priority = priorityItems(root, market, region, policy);
  const accepted = priority.concat(selection.accepted.filter((entry) => !priority.some((p) => p.id === entry.id)));
  if (!accepted.length) return { published: false, market, region: region || null, audit: selection.audit };
  const doc = emptyDistributionTemplate(template);
  if (!doc) return { published: false, market, region: region || null, reason: "DISTRIBUTION_TEMPLATE_INVALID", audit: selection.audit };
  const sections = doc.pages.distribution.sections;
  const templateSections = template.pages.distribution.sections;
  const seen = new Set();
  let written = 0;
  for (const entry of accepted) {
    const item = entry.item || entry;
    const decision = entry.decision || Gate.decisionForCandidate(item, selection, { hub: "distribution" });
    const card = makeCard(item, decision || {}, market, region, registry);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    const section = sectionFor(item, sections);
    const list = listForSection(sections, section);
    if (list.length >= slotCapacity(templateSections, section)) continue;
    list.push(card);
    written++;
  }
  if (!written) return { published: false, market, region: region || null, audit: selection.audit };
  doc.meta = Object.assign({}, doc.meta || {}, {
    targetMarket: market,
    targetRegion: region || null,
    generatedAt: new Date().toISOString(),
    regionalBrokerageAccepted: written,
    regionalBrokerageAudit: selection.audit
  });
  const output = outputPath(root, market, region);
  write(output, doc);
  return { published: true, market, region: region || null, output: path.relative(root, output), written, audit: selection.audit };
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
    version: "regional-brokerage-publisher-v1.1",
    generatedAt: new Date().toISOString(),
    sourceBank: source.file ? path.relative(root, source.file) : null,
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
