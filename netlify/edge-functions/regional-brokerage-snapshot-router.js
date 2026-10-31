/**
 * Canonical IP Slot Snapshot Router
 *
 * The four fully commercial PSOM surfaces and the Social right panel whose
 * commercial thumbnail slots must follow the request's country/subdivision are
 * routed here. The router stores no visitor
 * identity. It selects a same-country published snapshot, verifies its exact
 * manifest hash and its Canonical market-evidence envelope, then returns it.
 */
export const config = {
  path: [
    "/data/front.snapshot.json",
    "/data/distribution.snapshot.json",
    "/data/networkhub-snapshot.json",
    "/data/tour-snapshot.json",
    "/data/social.snapshot.json"
  ]
};

const MANIFEST_PATH = "/data/auto/ip-slot-manifest.json";
const FILE_TO_PAGE = Object.freeze({
  "front.snapshot.json": "home",
  "distribution.snapshot.json": "distribution",
  "networkhub-snapshot.json": "network",
  "tour-snapshot.json": "tour",
  "social.snapshot.json": "social"
});

// Request-time validation stays authoritative. A fully verified, exact-hash
// snapshot may be reused briefly inside the same Edge isolate so repeated
// navigation does not re-parse and re-hash multi-megabyte JSON on every hit.
// The cache key binds origin + release + policy + scope + path + exact SHA-256,
// so a new build/release/policy/file automatically misses this cache.
// The manifest is still loaded on every distinct request: never retain an old
// release across deploys. Only coalesce truly concurrent reads in this isolate.
const manifestReadsInFlight = new Map();
const snapshotVerificationsInFlight = new Map();

// View projections are bound to the fully verified snapshot's immutable release,
// policy, country, region, source path and exact SHA-256 (verifiedCacheKey).
// In-memory only: never allow a CDN/public browser cache to reuse one country's
// product list in another country. Bounded storage is important for 249 markets.
const PROJECTION_CACHE_TTL_MS = 60 * 1000;
const PROJECTION_CACHE_MAX_ENTRIES = 24;
const PROJECTION_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const projectionCache = new Map();
let projectionCacheBytes = 0;
function getProjection(key) {
  const row = projectionCache.get(key);
  if (!row) return null;
  if (Date.now() >= row.expiresAt) {
    projectionCache.delete(key);
    projectionCacheBytes = Math.max(0, projectionCacheBytes - row.bytes.byteLength);
    return null;
  }
  projectionCache.delete(key);
  projectionCache.set(key, row);
  return row.bytes;
}
function putProjection(key, bytes) {
  if (!bytes || !bytes.byteLength || bytes.byteLength > PROJECTION_CACHE_MAX_BYTES) return;
  const existing = projectionCache.get(key);
  if (existing) {
    projectionCache.delete(key);
    projectionCacheBytes = Math.max(0, projectionCacheBytes - existing.bytes.byteLength);
  }
  const data = new Uint8Array(bytes);
  projectionCache.set(key, {bytes:data, expiresAt:Date.now()+PROJECTION_CACHE_TTL_MS});
  projectionCacheBytes += data.byteLength;
  while (projectionCache.size > PROJECTION_CACHE_MAX_ENTRIES || projectionCacheBytes > PROJECTION_CACHE_MAX_BYTES) {
    const first = projectionCache.entries().next().value;
    if (!first) break;
    projectionCache.delete(first[0]);
    projectionCacheBytes = Math.max(0, projectionCacheBytes - first[1].bytes.byteLength);
  }
}

const VERIFIED_CACHE_TTL_MS = 60 * 1000;
const VERIFIED_CACHE_MAX_ENTRIES = 12;
const VERIFIED_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const verifiedSnapshotCache = new Map();
let verifiedSnapshotCacheBytes = 0;

function verifiedCacheKey(url, selected, manifest) {
  const row = selected && selected.row || {};
  return [
    url.origin,
    manifest && manifest.canonicalReleaseId || "",
    manifest && manifest.ipSlotPolicyDigest || "",
    row.page || "", row.country || "", row.region || "",
    row.path || "", row.sha256 || ""
  ].join("|");
}
function removeVerifiedCacheEntry(key, entry) {
  if (!verifiedSnapshotCache.has(key)) return;
  verifiedSnapshotCache.delete(key);
  verifiedSnapshotCacheBytes = Math.max(0, verifiedSnapshotCacheBytes - Number(entry && entry.byteLength || 0));
}
function getVerifiedCacheEntry(key) {
  const entry = verifiedSnapshotCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    removeVerifiedCacheEntry(key, entry);
    return null;
  }
  // Refresh LRU order without extending the validation TTL.
  verifiedSnapshotCache.delete(key);
  verifiedSnapshotCache.set(key, entry);
  return entry;
}
function putVerifiedCacheEntry(key, published) {
  const bytes = published && published.bytes;
  const byteLength = bytes && Number(bytes.byteLength || 0);
  if (!bytes || !byteLength || byteLength > VERIFIED_CACHE_MAX_BYTES) return;

  const existing = verifiedSnapshotCache.get(key);
  if (existing) removeVerifiedCacheEntry(key, existing);

  const entry = {
    bytes: new Uint8Array(bytes),
    byteLength,
    headers: Array.from(published.response.headers.entries()),
    status: published.response.status,
    statusText: published.response.statusText,
    expiresAt: Date.now() + VERIFIED_CACHE_TTL_MS
  };
  verifiedSnapshotCache.set(key, entry);
  verifiedSnapshotCacheBytes += byteLength;

  while (verifiedSnapshotCache.size > VERIFIED_CACHE_MAX_ENTRIES || verifiedSnapshotCacheBytes > VERIFIED_CACHE_MAX_BYTES) {
    const oldest = verifiedSnapshotCache.entries().next().value;
    if (!oldest) break;
    removeVerifiedCacheEntry(oldest[0], oldest[1]);
  }
}
function cachedPublished(entry) {
  return {
    response: {
      headers: new Headers(entry.headers),
      status: entry.status,
      statusText: entry.statusText
    },
    bytes: entry.bytes
  };
}

function normalizedCountry(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
function normalizedRegion(value, country) {
  let code = String(value || "").trim().toUpperCase().replace(/[._/\s]+/g, "-").replace(/^-+|-+$/g, "");
  if (country && code.startsWith(country + "-")) code = code.slice(3);
  return /^[A-Z0-9][A-Z0-9-]{1,15}$/.test(code) ? code : "";
}
function countryCode(context) {
  const geo = context && context.geo && typeof context.geo === "object" ? context.geo : {};
  const country = geo.country && typeof geo.country === "object" ? geo.country : {};
  for (const value of [country.code, country.alpha2, country.iso_code, geo.countryCode, geo.country_code]) {
    const code = normalizedCountry(value);
    if (code) return code;
  }
  return "";
}
function regionCode(context, country) {
  const geo = context && context.geo && typeof context.geo === "object" ? context.geo : {};
  const subdivision = geo.subdivision && typeof geo.subdivision === "object" ? geo.subdivision : {};
  for (const value of [subdivision.code, subdivision.iso_code, subdivision.id, geo.subdivisionCode, geo.regionCode, geo.stateCode, geo.provinceCode]) {
    const code = normalizedRegion(value, country);
    if (code) return code;
  }
  return "";
}
function requestedFile(url) {
  const last = url.pathname.split("/").filter(Boolean).pop() || "";
  return Object.prototype.hasOwnProperty.call(FILE_TO_PAGE, last) ? last : "";
}
function cardRows(doc, page) {
  const rows = []; const seen = new Set();
  const add = (card) => {
    if (!card || typeof card !== "object") return;
    const publication = card.canonicalPublication || {};
    const placement = card.placement || {};
    const key = [publication.candidateId || card.id || "", placement.section || card.section || "", placement.slot || card.slot || ""].join("|");
    if (!key || seen.has(key)) return;
    seen.add(key); rows.push(card);
  };
  const addSections = (sections) => {
    for (const value of Object.values(sections || {})) {
      if (Array.isArray(value)) value.forEach(add);
      else if (value && Array.isArray(value.slots)) value.slots.forEach(add);
    }
  };
  if (page === "home") addSections(doc && doc.pages && doc.pages.home && doc.pages.home.sections);
  else if (page === "distribution") addSections(doc && doc.pages && doc.pages.distribution && doc.pages.distribution.sections);
  else if (page === "social") {
    const sections = doc && doc.pages && doc.pages.social && doc.pages.social.sections;
    const rightPanel = sections && sections.rightPanel;
    if (Array.isArray(rightPanel)) rightPanel.forEach(add);
    else if (rightPanel && Array.isArray(rightPanel.slots)) rightPanel.slots.forEach(add);
  } else {
    (Array.isArray(doc && doc.items) ? doc.items : []).forEach(add);
    (Array.isArray(doc && doc.slots) ? doc.slots : []).forEach(add);
  }
  return rows;
}

function isSampleCard(card) {
  if (!card || typeof card !== "object" || card.canonicalPublication) return false;
  const type = String(card.type || "").toLowerCase();
  const origin = String(card.audit && card.audit.origin || "").toLowerCase();
  return card.sample === true || card.placeholder === true || card.isSample === true || type === "placeholder" || type === "sample" || origin === "placeholder_seed";
}
function safeSampleCard(card) {
  return isSampleCard(card)
    && String(card.url || "") === "#"
    && String(card.link || "") === "#"
    && card.realProduct === false
    && card.monetization && card.monetization.enabled === false
    && !card.externalProductUrl && !card.affiliateOutboundUrl && !card.externalOutboundUrl && !card.outboundRoute && !card.affiliate;
}

function text(value) { return value == null ? "" : String(value).trim(); }
function stable(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
}
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
}
async function loadManifest(url) {
  const target = new URL(MANIFEST_PATH, url).toString();
  if (manifestReadsInFlight.has(target)) return manifestReadsInFlight.get(target);
  const operation = (async () => {
    try {
      // Fresh on each distinct call, but concurrent page rails share a single
      // origin read. No TTL here: a deploy must take effect without waiting.
      const response = await fetch(target, { method: "GET", headers: { Accept: "application/json" } });
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (!response.ok || !contentType.includes("application/json")) return null;
      const manifest = await response.json();
      if (!manifest || manifest.schema !== "canonical-ip-slot-release-manifest-v1" || !Array.isArray(manifest.snapshots)) return null;
      return manifest;
    } catch (_e) { return null; }
  })();
  manifestReadsInFlight.set(target, operation);
  try { return await operation; }
  finally { if (manifestReadsInFlight.get(target) === operation) manifestReadsInFlight.delete(target); }
}
function matchingSnapshot(manifest, file, country, region) {
  const page = FILE_TO_PAGE[file];
  const rows = Array.isArray(manifest && manifest.snapshots) ? manifest.snapshots : [];
  const candidates = rows.filter(row => row && row.file === file && row.page === page && row.country === country && typeof row.path === "string" && row.path.startsWith("/data/auto/") && row.path.endsWith("/" + file));
  if (region) {
    const exact = candidates.find(row => String(row.region || "") === region);
    if (exact) return { row: exact, scope: country + "-" + region };
  }
  const nationwide = candidates.find(row => !row.region);
  return nationwide ? { row: nationwide, scope: country } : null;
}
function marketEvidenceDigest(record) {
  if (!record || typeof record !== "object") return "";
  const evidence = (service) => ({
    verified: !!(service && service.verified),
    evidenceUrl: service && service.evidenceUrl || null,
    evidence: Array.isArray(service && service.evidence) ? service.evidence.slice().sort() : []
  });
  // The server publisher uses stable JSON before SHA-256. The projection must
  // remain identical to market-sale-scope.v1.js; it deliberately excludes the
  // stored digest itself.
  return {
    country: record.country || null,
    regions: Array.isArray(record.regions) ? record.regions.slice().sort() : [],
    nationwide: record.nationwide === true,
    active: record.active === true,
    verifiedAt: record.verifiedAt || null,
    shipping: evidence(record.shipping),
    returns: evidence(record.returns),
    support: evidence(record.support),
    sellerResponsibility: {
      verified: !!(record.sellerResponsibility && record.sellerResponsibility.verified),
      legalEntity: record.sellerResponsibility && record.sellerResponsibility.legalEntity || null,
      supportUrl: record.sellerResponsibility && record.sellerResponsibility.supportUrl || null
    },
    fulfillmentProvider: record.fulfillmentProvider || null,
    source: record.source || null,
    rawEvidence: Array.isArray(record.rawEvidence) ? record.rawEvidence.slice().sort() : []
  };
}
async function evidenceDigest(record) {
  const payload = new TextEncoder().encode(stable(marketEvidenceDigest(record)));
  return sha256Hex(payload);
}
function serviceEvidence(service) {
  return !!(service && service.verified === true && ((Array.isArray(service.evidence) && service.evidence.length) || service.evidenceUrl));
}
function verificationIsFresh(value, maxAgeDays) {
  const stamp = Date.parse(String(value || ""));
  if (!Number.isFinite(stamp)) return false;
  const maxAge = Math.max(1, Number(maxAgeDays) || 30) * 86400000;
  const now = Date.now();
  return stamp <= now + 5 * 60 * 1000 && stamp >= now - maxAge;
}
async function documentMatchesPublishedScope(doc, selected, manifest) {
  const output = selected.row;
  const page = output.page;
  const country = normalizedCountry(output.country);
  const region = output.region ? normalizedRegion(output.region, country) : "";
  const meta = doc && doc.meta || {};
  if (!doc || !country || !page) return false;
  if (page === "distribution") {
    if (meta.regionalBrokerageSnapshot !== true || meta.targetMarket !== country) return false;
    if ((meta.targetRegion || "") !== (region || "")) return false;
  } else {
    if (meta.ipSlotSnapshot !== true || meta.geoMatched !== true || meta.targetCountry !== country) return false;
    if ((meta.targetRegion || "") !== (region || "")) return false;
    if (meta.canonicalReleaseId !== manifest.canonicalReleaseId || meta.ipSlotPolicyDigest !== manifest.ipSlotPolicyDigest) return false;
  }
  const cards = cardRows(doc, page);
  if (!cards.length) return false;
  const slots = new Set();
  const evidenceDigests = new Map();
  const encoder = new TextEncoder();
  let realCount = 0;
  for (const card of cards) {
    if (isSampleCard(card)) {
      if (!safeSampleCard(card)) return false;
      continue;
    }
    realCount += 1;
    const publication = card && card.canonicalPublication;
    const placement = card && card.placement;
    const ipSlot = card && card.ipSlot;
    const scope = card && card.marketScope;
    if (!publication || publication.status !== "published" || publication.releaseId !== manifest.canonicalReleaseId || !publication.candidateId || !publication.mappingDigest) return false;
    if (!placement || placement.page !== page || placement.country !== country || !placement.section || !Number.isInteger(Number(placement.slot))) return false;
    const cardRegion = normalizedRegion(placement.region, country);
    if (region ? (cardRegion !== region && cardRegion !== "NATIONWIDE") : cardRegion !== "NATIONWIDE") return false;
    const slotKey = placement.section + "|" + placement.slot;
    if (slots.has(slotKey)) return false;
    slots.add(slotKey);
    if (!ipSlot || ipSlot.required !== true || ipSlot.marketCountry !== placement.country || ipSlot.marketRegion !== placement.region || !ipSlot.marketEvidenceDigest) return false;
    if (!scope || scope.marketCountry !== placement.country || scope.marketRegion !== placement.region || scope.key !== placement.country + "-" + placement.region) return false;
    const record = scope.marketEvidence;
    if (!record || record.country !== placement.country) return false;
    const commercePublication = card && card.commerceCandidatePublication || {};
    const review = commercePublication && commercePublication.review || {};
    const explicitAdminPublication = review.explicitPublicationRequested === true;
    // For an explicit administrator Front Match, all product/company/market
    // eligibility was decided before the final board.  Edge routing verifies
    // only exact scope + immutable evidence-envelope integrity; it must not
    // rejudge shipping/returns/support policy and hide an already published card.
    if (!explicitAdminPublication) {
      if (record.active !== true || !verificationIsFresh(record.verifiedAt, manifest.marketVerificationMaxAgeDays) || !serviceEvidence(record.shipping) || !serviceEvidence(record.returns) || !serviceEvidence(record.support)) return false;
      const seller = record.sellerResponsibility;
      if (!seller || seller.verified !== true || !seller.legalEntity || !seller.supportUrl) return false;
    }
    // Multiple cards can share an identical signed market-evidence envelope.
    // Only dedupe when the EXACT stable payload matches, never by a claimed
    // digest or merely by seller host. All three original integrity gates stay.
    const evidencePayload = stable(marketEvidenceDigest(record));
    let digest = evidenceDigests.get(evidencePayload);
    if (!digest) {
      digest = await sha256Hex(encoder.encode(evidencePayload));
      evidenceDigests.set(evidencePayload, digest);
    }
    if (record.evidenceDigest !== digest || scope.marketEvidenceDigest !== digest || ipSlot.marketEvidenceDigest !== digest) return false;
  }
  return realCount > 0;
}
function initialDistributionCard(card) {
  if (!card || typeof card !== "object") return card;
  const keep = [
    "id","uid","productId","contentId","title","name","text","meta","subtitle","summary","description",
    "thumb","thumbnail","thumbnail_url","image","imageUrl","imageOriginalUrl","thumbnailUrl",
    "affiliateOutboundUrl","affiliate_outbound_url","externalOutboundUrl","external_outbound_url",
    "externalProductUrl","officialProductUrl","productUrl","product_url","productPageUrl","detailUrl",
    "checkoutUrl","purchaseUrl","orderUrl","productLink","displayUrl",
    "sourceUrl","source_url","targetUrl","target_url","outboundUrl","outbound_url","url","href","link",
    "affiliate","trackId","track_id","revenueLine","revenue_line","price","salePrice","amount","currency","ccy",
    "section","psom_key","type","sample","placeholder","isSample","realProduct","monetization"
  ];
  const out = {};
  for (const key of keep) if (card[key] !== undefined) out[key] = card[key];
  // Never lose the Canonical candidate/slot identity in a fast front projection.
  // The public card may have a legacy SearchBank id distinct from candidateId.
  // These are public routing references, not private candidate/financial data.
  const publication = card.canonicalPublication || {};
  const placement = card.placement || {};
  const candidateId = String(publication.candidateId || card.candidateId || "").trim();
  if (candidateId) out.candidateId = candidateId;
  const slot = card.slot !== undefined && card.slot !== null ? card.slot : placement.slot;
  if (slot !== undefined && slot !== null && slot !== "") {
    out.slot = slot;
    out.slotId = slot;
  }
  if (candidateId && publication.status === "published") {
    out.canonicalPublication = { candidateId, status: "published", releaseId: publication.releaseId || "", mappingDigest: publication.mappingDigest || "" };
  }
  if (placement.page && placement.section) {
    out.placement = { page: placement.page, section: placement.section,
      slot: slot === undefined ? null : slot, country: placement.country || "", region: placement.region || "" };
  }
  return out;
}
function initialDistributionView(bytes, limit, view = "initial") {
  try {
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    const sections = doc && doc.pages && doc.pages.distribution && doc.pages.distribution.sections;
    if (!sections || typeof sections !== "object") return null;
    const max = Math.max(1, Math.min(100, Number(limit) || 20));
    const nextSections = {};
    for (const [key, value] of Object.entries(sections)) {
      if (Array.isArray(value)) nextSections[key] = value.slice(0, max).map(initialDistributionCard);
      else if (value && typeof value === "object" && Array.isArray(value.slots)) nextSections[key] = Object.assign({}, value, { slots: value.slots.slice(0, max).map(initialDistributionCard) });
      else nextSections[key] = value;
    }
    const out = {
      pages: { distribution: Object.assign({}, doc.pages.distribution, { sections: nextSections }) },
      meta: Object.assign({}, doc.meta || {}, {
        deliveryView: view,
        deliveryLimitPerSection: max,
        deliveryProjection: "front-card-minimal-v1"
      })
    };
    return new TextEncoder().encode(JSON.stringify(out));
  } catch (_e) { return null; }
}

function projectedFrontCard(card) {
  if (!card || typeof card !== "object") return card;
  const keep = [
    "id","uid","productId","product_id","contentId","content_id","itemId","item_id","sku","code","pid",
    "title","name","text","label","caption",
    "thumb","image","image_url","imageOriginalUrl","thumbnail","thumbnail_url","img","photo","cover","coverUrl","thumbnailUrl","imageUrl",
    "affiliateOutboundUrl","affiliate_outbound_url","externalOutboundUrl","external_outbound_url",
    "checkoutUrl","paymentUrl","purchaseUrl","orderUrl","externalProductUrl","officialProductUrl",
    "productUrl","product_url","productPageUrl","detailUrl","productLink","displayUrl",
    "sourceUrl","source_url","targetUrl","target_url", "contentUrl","pageUrl","internalUrl","path","url","href","link",
    "priority","order","rank","weight","enabled","lang","page","section","psom_key",
    "type","sample","placeholder","isSample","realProduct","monetization",
    "productCard","researchReadiness","directCommerceListing","brokerageContract"
  ];
  const out = {};
  for (const key of keep) if (card[key] !== undefined) out[key] = card[key];
  // Never lose the Canonical candidate/slot identity in a fast front projection.
  // The public card may have a legacy SearchBank id distinct from candidateId.
  // These are public routing references, not private candidate/financial data.
  const publication = card.canonicalPublication || {};
  const placement = card.placement || {};
  const candidateId = String(publication.candidateId || card.candidateId || "").trim();
  if (candidateId) out.candidateId = candidateId;
  const slot = card.slot !== undefined && card.slot !== null ? card.slot : placement.slot;
  if (slot !== undefined && slot !== null && slot !== "") {
    out.slot = slot;
    out.slotId = slot;
  }
  if (candidateId && publication.status === "published") {
    out.canonicalPublication = { candidateId, status: "published", releaseId: publication.releaseId || "", mappingDigest: publication.mappingDigest || "" };
  }
  if (placement.page && placement.section) {
    out.placement = { page: placement.page, section: placement.section,
      slot: slot === undefined ? null : slot, country: placement.country || "", region: placement.region || "" };
  }
  return out;
}
function frontPageView(bytes, page) {
  try {
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    let out = null;
    if (page === "home") {
      const sections = doc && doc.pages && doc.pages.home && doc.pages.home.sections;
      if (!sections || typeof sections !== "object") return null;
      const nextSections = {};
      for (const [key,value] of Object.entries(sections)) {
        if (Array.isArray(value)) nextSections[key] = value.slice(0,100).map(projectedFrontCard);
        else if (value && typeof value === "object" && Array.isArray(value.slots)) nextSections[key] = Object.assign({}, value, {slots:value.slots.slice(0,100).map(projectedFrontCard)});
      }
      out = { pages:{home:{sections:nextSections}}, meta:Object.assign({},doc.meta||{},{deliveryView:"front",deliveryProjection:"home-front-minimal-v1"}) };
    } else if (page === "network" || page === "tour") {
      const items = Array.isArray(doc && doc.items) ? doc.items.slice(0,140).map(projectedFrontCard) : [];
      const slots = Array.isArray(doc && doc.slots) ? doc.slots.slice(0,140).map(projectedFrontCard) : [];
      if (!items.length && !slots.length) return null;
      out = {items,slots,meta:Object.assign({},doc.meta||{},{deliveryView:"front",deliveryProjection:page+"-front-minimal-v1"})};
    }
    return out ? new TextEncoder().encode(JSON.stringify(out)) : null;
  } catch (_e) { return null; }
}

function socialRightPanelView(bytes) {
  try {
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    const sections = doc && doc.pages && doc.pages.social && doc.pages.social.sections;
    const raw = sections && sections.rightPanel;
    const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.slots) ? raw.slots : []);
    if (!list.length) return null;
    const keep = [
      "id","uid","productId","product_id","contentId","content_id","itemId","item_id","sku","code",
      "title","name","text","label","thumb","image","thumbnail","imageUrl","thumbnailUrl",
      "contentUrl","pageUrl","internalUrl","detailPage","detailUrl","path",
      "latestContentUrl","latest_content_url","sourceContentUrl","source_content_url","viewerUrl","permalink",
      "sourceUrl","source_url","affiliateOutboundUrl","affiliate_outbound_url","externalOutboundUrl","external_outbound_url",
      "checkoutUrl","paymentUrl","productUrl","productLink","redirectUrl","url","href","link",
      "type","sample","placeholder","isSample","realProduct","monetization"
    ];
    const project = (card) => {
      if (!card || typeof card !== "object") return card;
      const out = {};
      for (const key of keep) if (card[key] !== undefined) out[key] = card[key];
      return out;
    };
    const rightPanel = Array.isArray(raw)
      ? list.slice(0, 100).map(project)
      : Object.assign({}, raw, { slots: list.slice(0, 100).map(project) });
    const out = {
      pages: { social: { sections: { rightPanel } } },
      meta: Object.assign({}, doc.meta || {}, { deliveryView: "right-panel", deliveryProjection: "social-right-panel-minimal-v1" })
    };
    return new TextEncoder().encode(JSON.stringify(out));
  } catch (_e) { return null; }
}

async function fetchPublishedSnapshot(url, relative) {
  try {
    const target = new URL(relative, url);
    target.search = url.search;
    // Fetch only the immutable deploy artifact. Forwarding the visitor Request
    // carries cookies/headers into an internal static fetch and can defeat CDN
    // reuse. It is unnecessary for the already-selected country scope.
    const response = await fetch(target.toString(), {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || !type.includes("application/json")) return null;
    const bytes = await response.arrayBuffer();
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    return { response, bytes, doc };
  } catch (_e) { return null; }
}

export default async function canonicalIpSlotSnapshotRouter(request, context) {
  if (request.method !== "GET" && request.method !== "HEAD") return context.next();
  const url = new URL(request.url);
  const file = requestedFile(url);
  if (!file) return context.next();
  const country = countryCode(context);
  if (!country) return context.next(); // root document is a deliberate empty geo gate
  const manifest = await loadManifest(url);
  if (!manifest) return context.next();
  const selected = matchingSnapshot(manifest, file, country, regionCode(context, country));
  if (!selected) return context.next(); // never cross country or use a global fallback

  const cacheKey = verifiedCacheKey(url, selected, manifest);
  const cached = getVerifiedCacheEntry(cacheKey);
  let published = cached ? cachedPublished(cached) : null;
  let verificationCacheState = cached ? "hit" : "miss";

  if (!published) {
    let inFlight = snapshotVerificationsInFlight.get(cacheKey);
    if (!inFlight) {
      inFlight = (async () => {
        const candidate = await fetchPublishedSnapshot(url, selected.row.path);
        if (!candidate) return null;
        if (await sha256Hex(candidate.bytes) !== selected.row.sha256) return null;
        if (!(await documentMatchesPublishedScope(candidate.doc, selected, manifest))) return null;
        putVerifiedCacheEntry(cacheKey, candidate);
        return candidate;
      })();
      snapshotVerificationsInFlight.set(cacheKey, inFlight);
    } else {
      verificationCacheState = "coalesced";
    }
    try { published = await inFlight; }
    catch (_error) { published = null; }
    finally { if (snapshotVerificationsInFlight.get(cacheKey) === inFlight) snapshotVerificationsInFlight.delete(cacheKey); }
    if (!published) return context.next();
    if (verificationCacheState === "miss") verificationCacheState = "fill";
  }

  const headers = new Headers(published.response.headers);
  let responseBytes = published.bytes;
  const requestedView = url.searchParams.get("view") || "";
  const page = FILE_TO_PAGE[file];
  const wantsInitialDistribution = page === "distribution" && requestedView === "initial";
  const wantsDistributionCards = page === "distribution" && requestedView === "cards";
  const wantsSocialRightPanel = page === "social" && requestedView === "right-panel";
  const wantsFrontProjection = ["home","network","tour"].includes(page) && requestedView === "front";
  const projectionType = wantsInitialDistribution ? "initial-20-v1"
    : wantsDistributionCards ? "cards-100-v1"
    : wantsSocialRightPanel ? "social-right-v1"
    : wantsFrontProjection ? "front-"+page+"-v1" : "";
  if (projectionType) {
    const projectionKey = cacheKey + "|" + projectionType;
    const existing = getProjection(projectionKey);
    let compact = existing;
    if (!compact) {
      if (wantsInitialDistribution) compact = initialDistributionView(published.bytes, 20);
      else if (wantsDistributionCards) compact = initialDistributionView(published.bytes, 100, "cards");
      else if (wantsSocialRightPanel) compact = socialRightPanelView(published.bytes);
      else compact = frontPageView(published.bytes, page);
      if (compact) putProjection(projectionKey, compact);
    }
    if (compact) responseBytes = compact;
    // Projections have different bytes from the verified full static artifact.
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Content-Encoding");
    headers.delete("Content-MD5");
    headers.delete("Digest");
    headers.set("X-IGDC-Snapshot-View", wantsInitialDistribution ? "initial" : wantsDistributionCards ? "cards" : wantsSocialRightPanel ? "right-panel" : "front");
    headers.set("X-IGDC-Projection-Cache", existing ? "hit" : compact ? "fill" : "unavailable");
  } else {
    headers.set("X-IGDC-Snapshot-View", "full");
  }
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Vary", "x-nf-geo, cf-ipcountry, x-country, x-region");
  headers.set("X-IGDC-Canonical-Release", String(manifest.canonicalReleaseId || ""));
  headers.set("X-IGDC-IP-Slot-Scope", selected.scope);
  headers.set("X-IGDC-IP-Slot-Page", FILE_TO_PAGE[file]);
  headers.set("X-IGDC-IP-Slot-Policy", String(manifest.ipSlotPolicyDigest || ""));
  headers.set("X-IGDC-IP-Slot-Verify-Cache", verificationCacheState);
  return new Response(request.method === "HEAD" ? null : responseBytes, {
    status: published.response.status,
    statusText: published.response.statusText,
    headers
  });
}
