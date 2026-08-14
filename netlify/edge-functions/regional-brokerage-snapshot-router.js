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
  try {
    const target = new URL(MANIFEST_PATH, url);
    // This is a deploy artifact. Do not force an origin revalidation on every
    // front request; the deployment URL/content cache remains the authority.
    const response = await fetch(target.toString(), { method: "GET", headers: { Accept: "application/json" } });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || !contentType.includes("application/json")) return null;
    const manifest = await response.json();
    if (!manifest || manifest.schema !== "canonical-ip-slot-release-manifest-v1" || !Array.isArray(manifest.snapshots)) return null;
    return manifest;
  } catch (_e) { return null; }
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
    if (!record || record.country !== placement.country || record.active !== true || !verificationIsFresh(record.verifiedAt, manifest.marketVerificationMaxAgeDays) || !serviceEvidence(record.shipping) || !serviceEvidence(record.returns) || !serviceEvidence(record.support)) return false;
    const seller = record.sellerResponsibility;
    if (!seller || seller.verified !== true || !seller.legalEntity || !seller.supportUrl) return false;
    const digest = await evidenceDigest(record);
    if (record.evidenceDigest !== digest || scope.marketEvidenceDigest !== digest || ipSlot.marketEvidenceDigest !== digest) return false;
  }
  return realCount > 0;
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
    published = await fetchPublishedSnapshot(url, selected.row.path);
    if (!published) return context.next();
    if (await sha256Hex(published.bytes) !== selected.row.sha256) return context.next();
    if (!(await documentMatchesPublishedScope(published.doc, selected, manifest))) return context.next();
    putVerifiedCacheEntry(cacheKey, published);
    verificationCacheState = "fill";
  }

  const headers = new Headers(published.response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Vary", "x-nf-geo, cf-ipcountry, x-country, x-region");
  headers.set("X-IGDC-Canonical-Release", String(manifest.canonicalReleaseId || ""));
  headers.set("X-IGDC-IP-Slot-Scope", selected.scope);
  headers.set("X-IGDC-IP-Slot-Page", FILE_TO_PAGE[file]);
  headers.set("X-IGDC-IP-Slot-Policy", String(manifest.ipSlotPolicyDigest || ""));
  headers.set("X-IGDC-IP-Slot-Verify-Cache", verificationCacheState);
  return new Response(request.method === "HEAD" ? null : published.bytes, {
    status: published.response.status,
    statusText: published.response.statusText,
    headers
  });
}
