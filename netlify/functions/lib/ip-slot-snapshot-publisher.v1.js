"use strict";

/**
 * Canonical IP Slot Snapshot Publisher v1
 *
 * Publishes only IP-scoped snapshots for the PSOM sections explicitly marked
 * in ip-slot-policy.v1.json. The public root snapshot remains a safe,
 * non-clickable sample fallback; an Edge function selects only an approved
 * same-country regional or nationwide real-product snapshot when available.
 *
 * Distribution keeps the existing regional brokerage publisher as the owner
 * of outbound tracking and seller-referral cards. This module validates and
 * registers those distribution snapshots but never recreates their links.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Canonical = require("./canonical-snapshot-publisher.v1");
const IpPolicy = require("./ip-slot-policy.v1");
const MarketSaleScope = require("./market-sale-scope.v1");
const SlotOverlay = require("./sample-slot-overlay.v1");
const PublicSnapshot = require("./public-snapshot-sanitizer.v1");

const VERSION = "canonical-ip-slot-snapshot-publisher-v1.5.1-policy-digest-bound-scoped-output";
const MANIFEST_FILE = "ip-slot-manifest.json";
const AUTO_ROOT = ["data", "auto"];
const ROUTES = Object.freeze({
  home: { file: "front.snapshot.json", page: "home" },
  distribution: { file: "distribution.snapshot.json", page: "distribution" },
  network: { file: "networkhub-snapshot.json", page: "network" },
  tour: { file: "tour-snapshot.json", page: "tour" },
  social: { file: "social.snapshot.json", page: "social", partialSection: "rightPanel" }
});

function rootOf(input) { return path.resolve(input && input.root || process.cwd()); }
function text(value) { return value == null ? "" : String(value).trim(); }
function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
function safeRead(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_e) { return null; } }
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function stable(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
}
function sha256(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(stable(value), "utf8");
  return crypto.createHash("sha256").update(data).digest("hex");
}
function atomicWrite(file, value) {
  ensure(path.dirname(file));
  const raw = JSON.stringify(value, null, 2) + "\n";
  const temp = path.join(path.dirname(file), "." + path.basename(file) + "." + process.pid + ".tmp");
  fs.writeFileSync(temp, raw, "utf8");
  fs.renameSync(temp, file);
  return sha256(Buffer.from(raw, "utf8"));
}
function exists(file) { try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch (_e) { return false; } }
function array(value) { return Array.isArray(value) ? value : []; }
function publicPath(root, country, region, file) {
  return path.join(root, ...AUTO_ROOT, country, ...(region ? [region] : []), file);
}
function webPath(root, absolute) { return "/" + path.relative(root, absolute).replace(/\\/g, "/"); }
function rootSnapshotPaths(root, file) {
  return [
    path.join(root, "data", file),
    path.join(root, "netlify", "functions", "data", file)
  ];
}
function canonicalSnapshot(root) {
  const verification = Canonical.verifyPublished({ root });
  const file = path.join(root, "data", "search-bank.snapshot.json");
  const document = safeRead(file);
  if (!verification.ok || !document || !Array.isArray(document.items)) return { ok: false, verification, file, items: [] };
  return { ok: true, verification, file, document, items: document.items };
}
function canonicalCard(item) {
  const publication = item && item.canonicalPublication;
  const placement = item && item.placement;
  const ipSlot = item && item.ipSlot;
  return !!(
    publication && publication.status === "published" && publication.releaseId && publication.candidateId && publication.mappingDigest &&
    placement && placement.page && placement.section && Number.isInteger(Number(placement.slot)) && placement.country && placement.region &&
    ipSlot && ipSlot.required === true && ipSlot.marketCountry === placement.country && ipSlot.marketRegion === placement.region && ipSlot.marketEvidenceDigest
  );
}
function scopeKey(country, region) { return country + "|" + (region || ""); }
function mapScopes(items) {
  const output = new Map();
  for (const item of items) {
    if (!canonicalCard(item)) continue;
    const placement = item.placement;
    if (!ROUTES[placement.page]) continue;
    const country = IpPolicy.normalizeCountry(placement.country);
    const region = IpPolicy.normalizeRegion(placement.region, country);
    if (!country || country === "GLOBAL" || !region || region === "GLOBAL") continue;
    const key = scopeKey(country, region === "NATIONWIDE" ? "" : region);
    if (!output.has(key)) output.set(key, { country, region: region === "NATIONWIDE" ? "" : region });
    if (region !== "NATIONWIDE") {
      const countryKey = scopeKey(country, "");
      if (!output.has(countryKey)) output.set(countryKey, { country, region: "" });
    }
  }
  return Array.from(output.values()).sort((a, b) => a.country.localeCompare(b.country) || a.region.localeCompare(b.region));
}
function candidatePriority(item) {
  const values = [item && item.managedPriority === true ? 1000000 : 0, item && item.priority, item && item.score, item && item.qualityScore];
  for (const value of values) { const number = Number(value); if (Number.isFinite(number)) return number; }
  return 0;
}
function selectScopeItems(items, page, country, region) {
  const selected = new Map();
  for (const item of items) {
    if (!canonicalCard(item)) continue;
    const placement = item.placement;
    if (placement.page !== page || placement.country !== country) continue;
    const candidateRegion = IpPolicy.normalizeRegion(placement.region, country);
    const exact = !!region && candidateRegion === region;
    const nationwide = candidateRegion === "NATIONWIDE";
    if (!exact && !nationwide) continue;
    const rank = exact ? 2 : 1;
    const key = [placement.section, Number(placement.slot)].join("|");
    const previous = selected.get(key);
    const record = { item, rank, priority: candidatePriority(item), candidateId: item.canonicalPublication.candidateId };
    if (!previous || rank > previous.rank || (rank === previous.rank && (record.priority > previous.priority || (record.priority === previous.priority && record.candidateId.localeCompare(previous.candidateId) < 0)))) selected.set(key, record);
  }
  return Array.from(selected.values()).map(row => row.item).sort((a, b) => a.placement.section.localeCompare(b.placement.section) || Number(a.placement.slot) - Number(b.placement.slot) || a.canonicalPublication.candidateId.localeCompare(b.canonicalPublication.candidateId));
}
function cloneCard(item) {
  const placement = clone(item.placement);
  const publication = clone(item.canonicalPublication);
  const ipSlot = clone(item.ipSlot);
  const card = {
    id: item.id || publication.candidateId,
    contentId: item.contentId || item.id || publication.candidateId,
    title: text(item.title || item.name),
    name: text(item.name || item.title),
    summary: text(item.summary || item.description),
    description: text(item.description || item.summary),
    url: text(item.url),
    link: text(item.link || item.url),
    thumb: text(item.thumb || item.thumbnail || item.image),
    image: text(item.image || item.thumb || item.thumbnail),
    thumbnail: text(item.thumbnail || item.thumb || item.image),
    price: item.price == null ? undefined : item.price,
    currency: item.currency || undefined,
    priority: candidatePriority(item),
    score: item.score == null ? undefined : item.score,
    provider: item.provider || undefined,
    seller: item.seller || undefined,
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 30) : undefined,
    page: placement.page,
    channel: placement.page,
    section: placement.section,
    psom_key: placement.section,
    slot: placement.slot,
    slotId: placement.slot,
    bind: { page: placement.page, section: placement.section, slot: placement.slot },
    placement,
    canonicalPublication: publication,
    ipSlot,
    country: placement.country,
    region: placement.region,
    countrySupply: clone(item.countrySupply || null),
    marketScope: clone(item.marketScope || null),
    productMapping: clone(item.productMapping || null),
    searchBankContract: clone(item.searchBankContract || item.sanmaruSearchBankContract || item.searchBankUnifiedContract || null),
    commerceCandidatePublication: clone(item.commerceCandidatePublication || null),
    outboundRoute: clone(item.outboundRoute || null),
    affiliateOutboundUrl: text(item.affiliateOutboundUrl || "") || undefined,
    externalOutboundUrl: text(item.externalOutboundUrl || "") || undefined
  };
  for (const key of Object.keys(card)) if (card[key] === undefined) delete card[key];
  return card;
}
function clearArrayValue(section) {
  if (Array.isArray(section)) return [];
  if (isObject(section) && Array.isArray(section.slots)) return Object.assign({}, section, { slots: [] });
  return section;
}
function clearFront(document) {
  const doc = clone(document);
  const pages = doc && doc.pages;
  for (const pageName of ["home", "distribution"]) {
    const sections = pages && pages[pageName] && pages[pageName].sections;
    if (isObject(sections)) for (const [key, value] of Object.entries(sections)) sections[key] = clearArrayValue(value);
  }
  return doc;
}
function clearDistribution(document) {
  const doc = clone(document);
  const sections = doc && doc.pages && doc.pages.distribution && doc.pages.distribution.sections;
  if (isObject(sections)) for (const [key, value] of Object.entries(sections)) sections[key] = clearArrayValue(value);
  return doc;
}
function clearSimple(document) {
  const doc = clone(document);
  doc.items = [];
  if (Array.isArray(doc.slots)) doc.slots = [];
  if (isObject(doc.sections)) {
    for (const [key, value] of Object.entries(doc.sections)) doc.sections[key] = clearArrayValue(value);
  }
  return doc;
}
function clearSocialRightPanel(document) {
  const doc = clone(document);
  const sections = doc && doc.pages && doc.pages.social && doc.pages.social.sections;
  if (!isObject(sections) || !("rightPanel" in sections)) return null;
  // Social's nine channel rows remain a non-IP content surface. Only the
  // commercial right panel is cleared/replaced by the geo-scoped publisher.
  sections.rightPanel = clearArrayValue(sections.rightPanel);
  return doc;
}
function clearForPage(document, page) {
  if (page === "home") return clearFront(document);
  if (page === "distribution") return clearDistribution(document);
  if (page === "social") return clearSocialRightPanel(document);
  return clearSimple(document);
}

function genericSampleBase(section, slot) {
  return {
    id: "sample-" + section + "-" + String(slot).padStart(3, "0"),
    title: "Loading…",
    name: "Loading…",
    summary: "",
    description: "",
    thumb: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    image: "data:image/gif;base64,R0lGODlhAQABAAAAACw="
  };
}
function sampleLikeTemplate(row) {
  if (!isObject(row) || SlotOverlay.canonicalRealCard(row)) return false;
  if (SlotOverlay.isSampleCard(row)) return true;
  const url = text(row.url || row.link).toLowerCase();
  const marker = text([row.id,row.type,row.title,row.name,row.audit&&row.audit.origin].filter(Boolean).join(" ")).toLowerCase();
  return !url || url === "#" || /(^|\.)example\.(com|org|net)(\/|$)/.test(url.replace(/^https?:\/\//,"")) || /placeholder|sample|loading|준비 중/.test(marker);
}
function safeTemplateRows(rows, section, capacityInput) {
  const source = Array.isArray(rows) ? rows : [];
  const capacity = Math.max(1, Number(capacityInput) || source.length || 100);
  const bases = [];
  for (let index = 0; index < capacity; index += 1) {
    const row = source[index];
    bases.push(sampleLikeTemplate(row) ? row : genericSampleBase(section, index + 1));
  }
  return SlotOverlay.overlayList(bases, [], section, capacity);
}
function sampleFallbackDocument(template, page) {
  const doc = clone(template || {});
  if (page === "home" || page === "distribution") {
    const holder = doc.pages && doc.pages[page];
    const sections = holder && holder.sections;
    if (!isObject(sections)) return null;
    for (const key of Object.keys(sections)) {
      const base = SlotOverlay.list(sections[key]);
      SlotOverlay.setList(sections, key, safeTemplateRows(base, key, base.length || 100));
    }
  } else if (page === "network" || page === "tour") {
    const section = page === "network" ? "network-right" : "tour";
    const base = array(doc.items).length ? array(doc.items) : array(doc.slots);
    const rows = safeTemplateRows(base, section, base.length || 100);
    doc.items = rows;
    doc.slots = clone(rows);
  } else if (page === "social") {
    const sections = doc.pages && doc.pages.social && doc.pages.social.sections;
    if (!isObject(sections) || !("rightPanel" in sections)) return null;
    const base = SlotOverlay.list(sections.rightPanel);
    SlotOverlay.setList(sections, "rightPanel", safeTemplateRows(base, "rightPanel", base.length || 100));
  } else {
    return null;
  }
  const cards = outputCards(doc, page);
  if (!cards.length || cards.some(card => !SlotOverlay.safeSampleCard(card))) return null;
  doc.meta = Object.assign({}, doc.meta || {}, {
    ipSlotSampleFallback: true,
    ipSlotGeoGate: false,
    geoResolutionRequired: true,
    geoMatched: false,
    scope: "sample-fallback",
    source: "canonical-ip-slot-snapshot-publisher",
    generatedAt: new Date().toISOString(),
    cardCount: cards.length,
    realCardCount: 0,
    sampleCardCount: cards.length,
    sampleFallbackPreserved: true,
    noCrossCountryFallback: true,
    noGlobalRealProductFallback: true
  });
  return doc;
}
function captureSampleFallbackTemplates(input) {
  const root = rootOf(input);
  const templates = {};
  const problems = [];
  for (const [page, route] of Object.entries(ROUTES)) {
    const sourcePath = rootSnapshotPaths(root, route.file).find(exists);
    const source = sourcePath ? safeRead(sourcePath) : null;
    const template = source ? sampleFallbackDocument(source, page) : null;
    if (!template) problems.push("IP_SLOT_SAMPLE_TEMPLATE_INVALID:" + route.file);
    else templates[page] = template;
  }
  return { ok: problems.length === 0, version: VERSION, templates, problems };
}
function listForSection(sections, key) {
  const value = sections[key];
  if (Array.isArray(value)) return value;
  if (isObject(value) && Array.isArray(value.slots)) return value.slots;
  sections[key] = [];
  return sections[key];
}
function setListForSection(sections, key, list) {
  if (Array.isArray(sections[key])) sections[key] = list;
  else if (isObject(sections[key]) && Array.isArray(sections[key].slots)) sections[key].slots = list;
  else sections[key] = list;
}
function renderPage(template, page, items, scope, policyDigest) {
  const doc = clone(template);
  if (page === "home") {
    const holder = doc.pages && doc.pages.home;
    const sections = holder && holder.sections;
    if (!isObject(sections)) return null;
    const per = new Map();
    for (const item of items) {
      const key = item.placement.section;
      if (!(key in sections)) return null;
      if (!per.has(key)) per.set(key, []);
      per.get(key).push(cloneCard(item));
    }
    holder.sections = SlotOverlay.overlaySections(sections, per);
  } else if (page === "network" || page === "tour") {
    const section = page === "network" ? "network-right" : "tour";
    const base = array(doc.items).length ? array(doc.items) : array(doc.slots);
    const cards = SlotOverlay.overlayList(base, items.map(cloneCard), section, base.length || 100);
    doc.items = cards;
    doc.slots = clone(cards);
  } else if (page === "social") {
    const sections = doc.pages && doc.pages.social && doc.pages.social.sections;
    if (!isObject(sections) || !("rightPanel" in sections)) return null;
    if (items.some(item => item && item.placement && item.placement.section !== "rightPanel")) return null;
    const base = SlotOverlay.list(sections.rightPanel);
    SlotOverlay.setList(sections, "rightPanel", SlotOverlay.overlayList(base, items.map(cloneCard), "rightPanel", base.length || 100));
  } else {
    return null;
  }
  const allCards = outputCards(doc, page);
  const sampleCount = allCards.filter(SlotOverlay.isSampleCard).length;
  doc.meta = Object.assign({}, doc.meta || {}, {
    ipSlotSnapshot: true,
    geoResolutionRequired: true,
    geoMatched: true,
    canonicalReleaseId: items[0] && items[0].canonicalPublication.releaseId || null,
    // Bind the scoped document to the same IP-slot policy fingerprint carried
    // by the manifest and verified by the Edge router. Without this field the
    // router must reject the real snapshot and fall back to the root sample.
    ipSlotPolicyDigest: text(policyDigest) || null,
    targetCountry: scope.country,
    targetRegion: scope.region || null,
    scope: scope.region ? "country-region" : "country-nationwide",
    source: "canonical-ip-slot-snapshot-publisher",
    generatedAt: new Date().toISOString(),
    cardCount: items.length,
    realCardCount: items.length,
    sampleCardCount: sampleCount,
    sampleFallbackPreserved: true,
    noCrossCountryFallback: true,
    noGlobalFallback: true
  });
  return doc;
}
function writeSampleFallback(root, file, page, template) {
  const paths = rootSnapshotPaths(root, file);
  const doc = sampleFallbackDocument(template, page);
  if (!doc) return [];
  return paths.map((output) => ({
    path: path.relative(root, output).replace(/\\/g, "/"),
    sha256: atomicWrite(output, PublicSnapshot.sanitizeDocument(clone(doc))),
    cardCount: outputCards(doc, page).length,
    sampleFallback: true
  }));
}
function walk(dir, result) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, result);
    else if (entry.isFile()) result.push(full);
  }
}
function cleanupStale(root, keep) {
  const files = [];
  walk(path.join(root, ...AUTO_ROOT), files);
  const removed = [];
  for (const file of files) {
    const doc = safeRead(file);
    if (!doc || !(doc.meta && doc.meta.ipSlotSnapshot === true)) continue;
    if (keep.has(path.resolve(file))) continue;
    try { fs.unlinkSync(file); removed.push(path.relative(root, file).replace(/\\/g, "/")); } catch (_e) {}
  }
  return removed;
}
function verifyDistributionSnapshot(file, scope, releaseId) {
  const doc = safeRead(file);
  const sections = doc && doc.pages && doc.pages.distribution && doc.pages.distribution.sections;
  if (!doc || !(doc.meta && doc.meta.regionalBrokerageSnapshot === true) || !isObject(sections)) return { ok: false, reason: "DISTRIBUTION_SCOPE_DOCUMENT_INVALID" };
  const cards = [];
  for (const value of Object.values(sections)) {
    if (Array.isArray(value)) cards.push(...value);
    else if (isObject(value) && Array.isArray(value.slots)) cards.push(...value.slots);
  }
  if (!cards.length) return { ok: false, reason: "DISTRIBUTION_SCOPE_EMPTY" };
  let realCount = 0;
  let sampleCount = 0;
  for (const card of cards) {
    if (SlotOverlay.isSampleCard(card)) {
      if (!SlotOverlay.safeSampleCard(card)) return { ok: false, reason: "DISTRIBUTION_SAMPLE_CARD_UNSAFE" };
      sampleCount += 1;
      continue;
    }
    realCount += 1;
    if (!canonicalCard(card)) return { ok: false, reason: "DISTRIBUTION_CARD_CANONICAL_ENVELOPE_INVALID" };
    if (card.canonicalPublication.releaseId !== releaseId) return { ok: false, reason: "DISTRIBUTION_CARD_RELEASE_MISMATCH" };
    const placement = card.placement;
    if (placement.page !== "distribution" || placement.country !== scope.country) return { ok: false, reason: "DISTRIBUTION_CARD_SCOPE_COUNTRY_MISMATCH" };
    const marketScope = card.marketScope;
    const marketValidation = MarketSaleScope.validateMarketScope(marketScope, placement.country, placement.region, { maxVerificationAgeDays: 30, requireFresh: true });
    if (!marketValidation.ok) return { ok: false, reason: "DISTRIBUTION_CARD_MARKET_SCOPE_EVIDENCE_INVALID:" + marketValidation.reasons.join(",") };
    if (!card.ipSlot || card.ipSlot.marketEvidenceDigest !== marketValidation.evidenceDigest) return { ok: false, reason: "DISTRIBUTION_CARD_MARKET_EVIDENCE_DIGEST_MISMATCH" };
    const candidateRegion = IpPolicy.normalizeRegion(placement.region, scope.country);
    if (scope.region && candidateRegion !== scope.region && candidateRegion !== "NATIONWIDE") return { ok: false, reason: "DISTRIBUTION_CARD_SCOPE_REGION_MISMATCH" };
    if (!scope.region && candidateRegion !== "NATIONWIDE") return { ok: false, reason: "DISTRIBUTION_COUNTRY_SCOPE_NOT_NATIONWIDE" };
  }
  if (!realCount) return { ok: false, reason: "DISTRIBUTION_SCOPE_HAS_NO_REAL_CARD" };
  return { ok: true, cardCount: realCount, sampleCount };
}
function outputCards(doc, page) {
  const rows = [];
  const seen = new Set();
  const push = (card) => {
    if (!card || typeof card !== "object") return;
    const publication = card.canonicalPublication || {};
    const key = String(publication.candidateId || card.id || "") + "|" + String(card.section || card.placement && card.placement.section || "") + "|" + String(card.slot || card.placement && card.placement.slot || "");
    if (!key || seen.has(key)) return;
    seen.add(key); rows.push(card);
  };
  if (page === "home") {
    const sections = doc && doc.pages && doc.pages.home && doc.pages.home.sections;
    for (const value of Object.values(sections || {})) {
      if (Array.isArray(value)) value.forEach(push);
      else if (value && Array.isArray(value.slots)) value.slots.forEach(push);
    }
  } else if (page === "distribution") {
    const sections = doc && doc.pages && doc.pages.distribution && doc.pages.distribution.sections;
    for (const value of Object.values(sections || {})) {
      if (Array.isArray(value)) value.forEach(push);
      else if (value && Array.isArray(value.slots)) value.slots.forEach(push);
    }
  } else if (page === "social") {
    const sections = doc && doc.pages && doc.pages.social && doc.pages.social.sections;
    const rightPanel = sections && sections.rightPanel;
    if (Array.isArray(rightPanel)) rightPanel.forEach(push);
    else if (rightPanel && Array.isArray(rightPanel.slots)) rightPanel.slots.forEach(push);
  } else {
    array(doc && doc.items).forEach(push);
    array(doc && doc.slots).forEach(push);
  }
  return rows;
}
function validateScopedOutput(doc, output, manifest, policy) {
  const page = output && output.page;
  const country = IpPolicy.normalizeCountry(output && output.country);
  const region = output && output.region ? IpPolicy.normalizeRegion(output.region, country) : "";
  const problems = [];
  if (!ROUTES[page] || !country) return ["IP_SLOT_OUTPUT_SCOPE_INVALID:" + String(output && output.path || "")];
  const meta = doc && doc.meta || {};
  if (page !== "distribution") {
    if (!(meta.ipSlotSnapshot === true && meta.geoMatched === true && meta.targetCountry === country)) problems.push("IP_SLOT_SNAPSHOT_META_INVALID:" + output.path);
    if (!manifest || !manifest.ipSlotPolicyDigest || meta.ipSlotPolicyDigest !== manifest.ipSlotPolicyDigest) problems.push("IP_SLOT_SNAPSHOT_POLICY_DIGEST_MISMATCH:" + output.path);
    if (region && meta.targetRegion !== region) problems.push("IP_SLOT_SNAPSHOT_REGION_META_INVALID:" + output.path);
    if (!region && meta.targetRegion) problems.push("IP_SLOT_SNAPSHOT_NATIONWIDE_META_INVALID:" + output.path);
  }
  if (meta.canonicalReleaseId && manifest && meta.canonicalReleaseId !== manifest.canonicalReleaseId) problems.push("IP_SLOT_SNAPSHOT_RELEASE_META_MISMATCH:" + output.path);
  const slotSeen = new Set();
  const cards = outputCards(doc, page);
  let realCount = 0;
  if (!cards.length) problems.push("IP_SLOT_SNAPSHOT_EMPTY:" + output.path);
  for (const card of cards) {
    if (SlotOverlay.isSampleCard(card)) {
      if (!SlotOverlay.safeSampleCard(card)) problems.push("IP_SLOT_SAMPLE_CARD_UNSAFE:" + output.path + ":" + String(card && card.id || ""));
      continue;
    }
    realCount += 1;
    if (!canonicalCard(card)) { problems.push("IP_SLOT_CARD_ENVELOPE_INVALID:" + output.path + ":" + String(card && card.id || "")); continue; }
    const placement = card.placement;
    if (card.canonicalPublication.releaseId !== (manifest && manifest.canonicalReleaseId)) problems.push("IP_SLOT_CARD_RELEASE_MISMATCH:" + output.path + ":" + String(card.id));
    if (placement.page !== page || placement.country !== country) problems.push("IP_SLOT_CARD_COUNTRY_PAGE_MISMATCH:" + output.path + ":" + String(card.id));
    const placementRegion = IpPolicy.normalizeRegion(placement.region, country);
    if (region ? (placementRegion !== region && placementRegion !== "NATIONWIDE") : placementRegion !== "NATIONWIDE") problems.push("IP_SLOT_CARD_REGION_MISMATCH:" + output.path + ":" + String(card.id));
    const slotKey = [placement.section, placement.slot].join("|");
    if (slotSeen.has(slotKey)) problems.push("IP_SLOT_CARD_SLOT_COLLISION:" + output.path + ":" + slotKey);
    slotSeen.add(slotKey);
    const scope = MarketSaleScope.validateMarketScope(card.marketScope, placement.country, placement.region, {
      maxVerificationAgeDays: Number(policy && policy.validation && policy.validation.maxAvailabilityVerificationAgeDays || 30),
      requireFresh: true
    });
    if (!scope.ok) problems.push("IP_SLOT_CARD_MARKET_EVIDENCE_INVALID:" + output.path + ":" + String(card.id) + ":" + scope.reasons.join(","));
    if (!card.ipSlot || card.ipSlot.marketEvidenceDigest !== scope.evidenceDigest) problems.push("IP_SLOT_CARD_MARKET_EVIDENCE_DIGEST_MISMATCH:" + output.path + ":" + String(card.id));
  }
  if (!realCount) problems.push("IP_SLOT_SNAPSHOT_HAS_NO_REAL_CARD:" + output.path);
  return problems;
}

function registeredDistributionOutputs(root, releaseId) {
  const regionalManifest = safeRead(path.join(root, "data", "auto", "regional-brokerage-manifest.json"));
  const registered = array(regionalManifest && regionalManifest.snapshots);
  const outputs = [];
  for (const web of registered) {
    if (typeof web !== "string" || !web.startsWith("/data/auto/") || !web.endsWith("/distribution.snapshot.json")) continue;
    const pieces = web.split("/").filter(Boolean);
    const autoAt = pieces.indexOf("auto");
    if (autoAt < 0) continue;
    const country = IpPolicy.normalizeCountry(pieces[autoAt + 1]);
    const possibleRegion = pieces.length === autoAt + 4 ? pieces[autoAt + 2] : "";
    const region = possibleRegion ? IpPolicy.normalizeRegion(possibleRegion, country) : "";
    const absolute = path.join(root, web.replace(/^\//, ""));
    const checked = verifyDistributionSnapshot(absolute, { country, region }, releaseId);
    if (checked.ok) outputs.push({ page: "distribution", file: "distribution.snapshot.json", country, region: region || null, path: web, sha256: sha256(fs.readFileSync(absolute)), cardCount: checked.cardCount, sampleCount: checked.sampleCount || 0 });
  }
  return outputs;
}
function publish(input) {
  const root = rootOf(input);
  const policy = IpPolicy.load(root);
  const source = canonicalSnapshot(root);
  const report = { version: VERSION, generatedAt: new Date().toISOString(), status: "blocked", errors: [], scopedOutputs: [], rootFallbacks: [], rootGates: [], removedStale: [] };
  if (!policy.ok) { report.errors.push(...policy.problems); return report; }
  if (!source.ok) { report.errors.push(...(source.verification && source.verification.problems || ["CANONICAL_SOURCE_UNAVAILABLE"])); return report; }
  const releaseId = source.document.meta && source.document.meta.releaseId;
  if (!releaseId) { report.errors.push("CANONICAL_RELEASE_ID_MISSING"); return report; }
  const targetPages = array(policy.policy.ipScopedPages).filter(page => ROUTES[page]);
  const captured = input && isObject(input.fallbackTemplates)
    ? { ok:true, templates:input.fallbackTemplates, problems:[] }
    : captureSampleFallbackTemplates({ root });
  const templates = captured.templates || {};
  if (!captured.ok) report.errors.push(...(captured.problems || ["IP_SLOT_SAMPLE_TEMPLATE_CAPTURE_FAILED"]));
  for (const page of targetPages) if (!templates[page]) report.errors.push("IP_SLOT_TEMPLATE_MISSING:" + ROUTES[page].file);
  if (report.errors.length) return report;

  const items = source.items.filter(canonicalCard);
  const scopes = mapScopes(items);
  const keep = new Set();
  const outputs = [];
  for (const scope of scopes) {
    for (const page of targetPages) {
      if (page === "distribution") continue; // preserved regional-brokerage publisher owns this surface
      const selected = selectScopeItems(items, page, scope.country, scope.region);
      if (!selected.length) continue;
      const document = renderPage(templates[page], page, selected, scope, policy.fingerprint);
      if (!document) { report.errors.push("IP_SLOT_RENDER_FAILED:" + page + ":" + scope.country + ":" + (scope.region || "NATIONWIDE")); continue; }
      const absolute = publicPath(root, scope.country, scope.region, ROUTES[page].file);
      const digest = atomicWrite(absolute, PublicSnapshot.sanitizeDocument(document));
      keep.add(path.resolve(absolute));
      outputs.push({ page, file: ROUTES[page].file, country: scope.country, region: scope.region || null, path: webPath(root, absolute), sha256: digest, cardCount: selected.length, sampleCount: outputCards(document, page).filter(SlotOverlay.isSampleCard).length });
    }
  }
  const distribution = registeredDistributionOutputs(root, releaseId);
  for (const output of distribution) keep.add(path.resolve(path.join(root, output.path.replace(/^\//, ""))));
  outputs.push(...distribution);

  for (const page of targetPages) report.rootFallbacks.push(...writeSampleFallback(root, ROUTES[page].file, page, templates[page]));
  report.rootGates = report.rootFallbacks.slice();
  report.removedStale = cleanupStale(root, keep);
  const manifest = {
    schema: "canonical-ip-slot-release-manifest-v1",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    canonicalReleaseId: releaseId,
    canonicalManifest: "data/canonical-snapshot/current-manifest.json",
    ipSlotPolicyVersion: policy.policy.version || null,
    ipSlotPolicyDigest: policy.fingerprint,
    mode: policy.policy.mode || null,
    fallback: clone(policy.policy.fallback || {}),
    globalMarketSaleScope: clone(policy.policy.globalMarketRule || {}),
    originCountryIsNotEligibilityGate: policy.policy.globalMarketRule && policy.policy.globalMarketRule.originCountryIsNotAnEligibilityGate === true,
    marketVerificationMaxAgeDays: Number(policy.policy.validation && policy.policy.validation.maxAvailabilityVerificationAgeDays || 30),
    geoPrivacy: "Country and subdivision codes are used only at request routing time. No visitor IP or precise visitor location is written to snapshots, manifests or audit records.",
    routes: targetPages.map(page => ({ page, file: ROUTES[page].file })),
    snapshots: outputs.sort((a, b) => a.file.localeCompare(b.file) || a.country.localeCompare(b.country) || String(a.region || "").localeCompare(String(b.region || ""))),
    rootFallbacks: report.rootFallbacks.map((row)=>({path:row.path,sha256:row.sha256,cardCount:row.cardCount})),
    rootGeoGate: false,
    rootSampleFallback: true,
    noCrossCountryFallback: true,
    noGlobalRealProductFallback: true
  };
  const manifestPath = path.join(root, "data", "auto", MANIFEST_FILE);
  atomicWrite(manifestPath, manifest);
  report.status = report.errors.length ? "blocked" : "published";
  report.manifest = path.relative(root, manifestPath).replace(/\\/g, "/");
  report.scopedOutputs = outputs;
  report.releaseId = releaseId;
  return report;
}

function verifyPublished(input) {
  const root = rootOf(input);
  const manifest = safeRead(path.join(root, "data", "auto", MANIFEST_FILE));
  const problems = [];
  if (!manifest || manifest.schema !== "canonical-ip-slot-release-manifest-v1") problems.push("IP_SLOT_MANIFEST_MISSING_OR_INVALID");
  const canonical = Canonical.verifyPublished({ root });
  if (!canonical.ok) problems.push(...canonical.problems.map(problem => "CANONICAL:" + problem));
  if (manifest && manifest.canonicalReleaseId !== canonical.releaseId) problems.push("IP_SLOT_RELEASE_MISMATCH");
  const outputs = array(manifest && manifest.snapshots);
  for (const output of outputs) {
    const absolute = path.join(root, String(output.path || "").replace(/^\//, ""));
    const doc = safeRead(absolute);
    if (!doc) { problems.push("IP_SLOT_SNAPSHOT_MISSING:" + output.path); continue; }
    const actual = sha256(fs.readFileSync(absolute));
    if (actual !== output.sha256) problems.push("IP_SLOT_SNAPSHOT_HASH_MISMATCH:" + output.path);
    const policy = IpPolicy.load(root);
    if (!policy.ok) problems.push(...policy.problems.map(problem => "IP_POLICY:" + problem));
    problems.push(...validateScopedOutput(doc, output, manifest, policy.policy));
  }
  const fallbacks=array(manifest&&manifest.rootFallbacks);
  for(const fallback of fallbacks){
    const absolute=path.join(root,String(fallback&&fallback.path||"").replace(/^\//,""));
    const doc=safeRead(absolute);
    if(!doc){problems.push("IP_SLOT_ROOT_FALLBACK_MISSING:"+String(fallback&&fallback.path||""));continue;}
    const actual=sha256(fs.readFileSync(absolute));
    if(actual!==fallback.sha256)problems.push("IP_SLOT_ROOT_FALLBACK_HASH_MISMATCH:"+fallback.path);
    const page=Object.keys(ROUTES).find((key)=>ROUTES[key].file===path.basename(absolute));
    const cards=page?outputCards(doc,page):[];
    const meta=doc&&doc.meta||{};
    if(!page||meta.ipSlotSampleFallback!==true||meta.geoMatched!==false||meta.noCrossCountryFallback!==true||meta.noGlobalRealProductFallback!==true)problems.push("IP_SLOT_ROOT_FALLBACK_META_INVALID:"+fallback.path);
    if(!cards.length||cards.some((card)=>!SlotOverlay.safeSampleCard(card)))problems.push("IP_SLOT_ROOT_FALLBACK_UNSAFE_OR_EMPTY:"+fallback.path);
  }
  return { ok: problems.length === 0, version: VERSION, releaseId: canonical.releaseId || null, outputCount: outputs.length, fallbackCount:fallbacks.length, problems };
}

module.exports = { VERSION, MANIFEST_FILE, publish, verifyPublished, captureSampleFallbackTemplates, sampleFallbackDocument };
