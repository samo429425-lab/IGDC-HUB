
/**
 * IGDC Snapshot Engine vNext
 * Strict Routing + PSOM Mapping + Safe Merge
 */

"use strict";

const fs = require("fs");
const path = require("path");
const NonPgRevenue = require("./lib/nonpg-revenue-contract.core.v1");
const PublicSnapshot = require("./lib/public-snapshot-sanitizer.v1");
const crypto = require("crypto");

const ROOT = process.cwd();
const STRICT_ROUTE = true;

const SNAPSHOT_FILES = {
  home: "front.snapshot.json",
  distribution: "distribution.snapshot.json",
  media: "media.snapshot.json",
  social: "social.snapshot.json",
  network: "networkhub-snapshot.json",
  tour: "tour-snapshot.json",
};

const LIMIT_MAP = {
  home: 740,
  distribution: 700,
  media: 500,
  social: 1000,
  network: 100,
  tour: 100,
  default: 300
};

const SNAPSHOT_ENGINE_VERSION = "snapshot-engine-vNext.3.3-distribution-section-order";
const SEARCH_BANK_CONTRACT_VERSION = "sanmaru-searchbank-supply-contract-v1.1";
const PG_STATUS_PENDING = "pending_pg_approval";
const SECTION_SLOT_LIMIT = 100;

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const x = String(v || "");
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function truthy(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const x = String(v).trim().toLowerCase();
  return !!x && !["0", "false", "no", "off", "disabled", "disable", "null", "undefined"].includes(x);
}

function explicitFalse(v) {
  if (v === false) return true;
  const x = String(v == null ? "" : v).trim().toLowerCase();
  return ["0", "false", "no", "off", "disabled", "disable"].includes(x);
}

function snapshotPathCandidates(fileName) {
  return uniq([
    path.join(ROOT, fileName),
    path.join(ROOT, "data", fileName),
    path.join(ROOT, "netlify", "functions", "data", fileName),
    path.join(ROOT, "netlify", "functions", fileName),
    path.join(__dirname, "data", fileName),
    path.join(__dirname, fileName),
    path.join(__dirname, "..", "..", "data", fileName),
    path.join("/tmp", fileName)
  ]);
}

function firstExistingPath(fileName) {
  for (const p of snapshotPathCandidates(fileName)) {
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (_e) {}
  }
  return "";
}

function existingSnapshotPaths(fileName) {
  return snapshotPathCandidates(fileName).filter(p => {
    try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch (_e) { return false; }
  });
}

function readSnapshotJson(fileName) {
  const p = firstExistingPath(fileName);
  if (!p) return { path: "", data: null };
  return { path: p, data: readJson(p) };
}

function writeSnapshotJson(fileName, data) {
  const targets = existingSnapshotPaths(fileName);
  const writeTargets = targets.length ? targets : [snapshotPathCandidates(fileName)[0]];
  const publicData = PublicSnapshot.sanitizeDocument(data);
  for (const target of writeTargets) {
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeJson(target, publicData);
    } catch (e) {
      console.error("Snapshot write failed:", target, e && e.message);
    }
  }
  return writeTargets;
}

function contractOf(raw) {
  raw = raw || {};
  const d = raw.osaiDiscernment && typeof raw.osaiDiscernment === "object" ? raw.osaiDiscernment : {};
  return (raw.searchBankContract && typeof raw.searchBankContract === "object") ? raw.searchBankContract
    : (raw.sanmaruSearchBankContract && typeof raw.sanmaruSearchBankContract === "object") ? raw.sanmaruSearchBankContract
    : (raw.searchBankUnifiedContract && typeof raw.searchBankUnifiedContract === "object") ? raw.searchBankUnifiedContract
    : (d.searchBankContract && typeof d.searchBankContract === "object") ? d.searchBankContract
    : {};
}

function nestedValue(obj, pathList) {
  let cur = obj || {};
  for (const key of pathList) {
    if (!cur || typeof cur !== "object" || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function firstDefined() {
  for (const v of arguments) if (v !== undefined) return v;
  return undefined;
}

function snapshotPaymentState(raw) {
  raw = raw || {};
  const c = contractOf(raw);
  const envLive = truthy(process.env.IGDC_PAYMENT_LIVE || process.env.IGDC_PG_LIVE || process.env.PAYMENT_LIVE || process.env.PG_EXECUTION || process.env.PG_APPROVED);
  const rawPaymentReady = firstDefined(raw.paymentStructureReady, raw.paymentReady, c.paymentStructureReady, c.paymentReady, nestedValue(raw, ["osaiDiscernment", "payment", "paymentReady"]), false);
  return {
    paymentStructureReady: !!rawPaymentReady,
    paymentLive: !!envLive,
    pgExecution: !!envLive,
    pgStatus: envLive ? "pg_live" : PG_STATUS_PENDING,
    policy: "pg-execution-disabled-until-approval"
  };
}

function snapshotCandidateAllowed(raw, context) {
  raw = raw || {};
  const c = contractOf(raw);
  const d = raw.osaiDiscernment && typeof raw.osaiDiscernment === "object" ? raw.osaiDiscernment : {};
  const blockedReason = val(raw.blockedReason, c.blockedReason, d.blockedReason, raw?.sanmaruTrust?.blockedReason, "");
  const blocked = raw.blocked === true || c.blocked === true || d.blocked === true || raw?.sanmaruTrust?.blocked === true || !!blockedReason;
  if (blocked) return false;

  if (explicitFalse(firstDefined(raw.snapshotEligible, c.snapshotEligible, nestedValue(d, ["eligibility", "snapshotEligible"])))) return false;
  if (explicitFalse(firstDefined(raw.frontSupplyAllowed, c.frontSupplyAllowed, nestedValue(d, ["eligibility", "frontSupplyAllowed"])))) return false;
  if (explicitFalse(firstDefined(raw.searchBankEligible, c.searchBankEligible, nestedValue(d, ["eligibility", "searchBankEligible"])))) return false;

  const riskLevel = String(val(raw.riskLevel, c.riskLevel, d.riskLevel, raw?.sanmaruTrust?.riskLevel, "low")).toLowerCase();
  if (["critical", "blocked", "illegal", "unsafe"].includes(riskLevel)) return false;

  const unsafe = String(val(raw.unsafeProductRisk, c.unsafeProductRisk, nestedValue(d, ["safety", "unsafeProductRisk"]), "low")).toLowerCase();
  const illegal = String(val(raw.illegalSiteRisk, c.illegalSiteRisk, nestedValue(d, ["safety", "illegalSiteRisk"]), "low")).toLowerCase();
  const harmful = String(val(raw.harmfulContentRisk, c.harmfulContentRisk, nestedValue(d, ["safety", "harmfulContentRisk"]), "low")).toLowerCase();
  if ([unsafe, illegal, harmful].some(v => ["critical", "blocked", "illegal", "unsafe"].includes(v))) return false;

  return true;
}

function enrichSnapshotCard(card, raw) {
  const c = contractOf(raw || {});
  const pay = snapshotPaymentState(raw || {});
  if (!card || typeof card !== "object") return card;
  card.snapshotEngineVersion = SNAPSHOT_ENGINE_VERSION;
  card.searchBankContractVersion = val(c.contractVersion, SEARCH_BANK_CONTRACT_VERSION);
  card.snapshotEligible = !explicitFalse(firstDefined(card.snapshotEligible, raw && raw.snapshotEligible, c.snapshotEligible, true));
  card.frontSupplyAllowed = !explicitFalse(firstDefined(card.frontSupplyAllowed, raw && raw.frontSupplyAllowed, c.frontSupplyAllowed, true));
  card.searchBankEligible = !explicitFalse(firstDefined(card.searchBankEligible, raw && raw.searchBankEligible, c.searchBankEligible, true));
  card.riskLevel = val(card.riskLevel, raw && raw.riskLevel, c.riskLevel, "low");
  card.blockedReason = val(card.blockedReason, raw && raw.blockedReason, c.blockedReason, "");
  card.paymentStructureReady = pay.paymentStructureReady;
  card.paymentLive = pay.paymentLive;
  card.pgExecution = pay.pgExecution;
  card.pgStatus = pay.pgStatus;
  if (card.payment && typeof card.payment === "object") {
    const structureReady = !!(card.payment.structureReady || card.payment.enabled || card.payment.price || pay.paymentStructureReady);
    card.payment = Object.assign({}, card.payment, {
      enabled: !!(pay.paymentLive && card.payment.enabled === true),
      structureReady,
      paymentStructureReady: structureReady,
      paymentLive: pay.paymentLive,
      pgExecution: pay.pgExecution,
      pgStatus: pay.pgStatus,
      pg: pay.paymentLive ? (card.payment.pg || null) : null
    });
  }
  if (card.revenue && typeof card.revenue === "object" && card.revenue.directSale === true && !(raw && raw.directSale && raw.directSale.enabled === true)) {
    card.revenue = Object.assign({}, card.revenue, { directSale: false });
  }
  return card;
}

function sanitizeSnapshotArray(items, pageName, sectionKey) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    if (!snapshotCandidateAllowed(item, { pageName, sectionKey })) continue;
    const id = val(item.id, item.contentId, item.slotId, stableId(JSON.stringify(item)));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(enrichSnapshotCard(item, item));
  }
  return out;
}

function sanitizeSectionCollection(sections, pageName) {
  if (!sections || typeof sections !== "object") return sections;
  for (const [sectionKey, sectionValue] of Object.entries(sections)) {
    if (Array.isArray(sectionValue)) {
      sections[sectionKey] = capSnapshotList(sanitizeSnapshotArray(sectionValue, pageName, sectionKey), pageName, sectionKey);
      continue;
    }
    if (sectionValue && typeof sectionValue === "object" && Array.isArray(sectionValue.slots)) {
      sectionValue.slots = capSnapshotList(sanitizeSnapshotArray(sectionValue.slots, pageName, sectionKey), pageName, sectionKey);
    }
  }
  return sections;
}

function internalPlaceholderImage() {
  return "/assets/img/placeholder.png";
}

function sectionSlotLimit(_pageName, _sectionKey, fallback) {
  const n = Number(fallback || SECTION_SLOT_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.min(SECTION_SLOT_LIMIT, Math.max(1, Math.trunc(n))) : SECTION_SLOT_LIMIT;
}

function urlOfSnapshotItem(item) {
  if (!item || typeof item !== "object") return "";
  return String(item.url || item.link || item.href || item.video || item.videoUrl || "").trim();
}

function imageOfSnapshotItem(item) {
  if (!item || typeof item !== "object") return "";
  return String(item.thumbnail || item.thumb || item.image || item.poster || "").trim();
}

function isPlaceholderUrlValue(url) {
  const u = String(url || "").trim().toLowerCase();
  if (!u || u === "#" || u === "about:blank") return true;
  if (u.startsWith("javascript:")) return true;
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return h === "example.com" || h === "example.edu" || h.endsWith(".example.com") || h.endsWith(".example.edu");
  } catch (_e) {
    return false;
  }
}

function isSampleAssetValue(src) {
  const s = String(src || "").trim().toLowerCase();
  return !s || s.includes("/assets/sample/") || s.includes("/assets/img/placeholder") || s.includes("placeholder.png");
}

function isSeedLikeSnapshotSlot(item) {
  if (!item || typeof item !== "object") return true;
  if (item.sample === true || item.isSample === true || item.placeholder === true || item.replaceableSlot === true) return true;
  const title = String(item.title || item.name || "").trim();
  const summary = String(item.summary || item.description || "").trim();
  // The Social baseline contains URL-shaped demonstration cards explicitly
  // marked as "Seed placeholder". Only this declared marker is replaceable;
  // ordinary public cards with valid URLs remain protected.
  if (/^seed placeholder\b/i.test(summary)) return true;
  if (/^(network|home|distribution|media|social|tour|donation)\s+item\s+\d+$/i.test(title)) return true;
  if (isPlaceholderUrlValue(urlOfSnapshotItem(item))) return true;
  if (isSampleAssetValue(imageOfSnapshotItem(item))) return true;
  return false;
}

function isRealIncomingCandidate(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.realContent === true || raw.verified === true || raw.producerVerified === true || raw.officialSource === true) return true;
  const url = urlOfSnapshotItem(raw);
  const img = imageOfSnapshotItem(raw);
  const title = String(raw.title || raw.name || "").trim();
  if (isPlaceholderUrlValue(url)) return false;
  if (isSampleAssetValue(img) && !/youtu|vimeo|tiktok/i.test(url)) return false;
  if (/^(network|home|distribution|media|social|tour|donation)\s+item\s+\d+$/i.test(title)) return false;
  return /^https?:\/\//i.test(url);
}

function snapshotIdOf(item, fields) {
  for (const f of Array.isArray(fields) ? fields : ["id"]) {
    const v = item && item[f];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return item ? stableId(JSON.stringify(item)) : "";
}

function pushOrReplaceSnapshotSlot(list, card, raw, opts) {
  if (!Array.isArray(list) || !card || typeof card !== "object") return false;
  opts = opts || {};
  const limit = sectionSlotLimit(opts.pageName, opts.sectionKey, opts.limit || SECTION_SLOT_LIMIT);
  const idFields = opts.idFields || ["id"];
  const incomingId = snapshotIdOf(card, idFields);

  if (list.some(existing => snapshotIdOf(existing, idFields) === incomingId)) return false;

  if (list.length < limit) {
    list.push(card);
    return true;
  }

  if (!isRealIncomingCandidate(raw)) return false;

  const replaceIndex = list.findIndex(isSeedLikeSnapshotSlot);
  if (replaceIndex < 0) return false;

  const previous = list[replaceIndex] || {};
  if (previous.slotId !== undefined && card.slotId === undefined) card.slotId = previous.slotId;
  if (previous.slotId !== undefined && card.slotId !== previous.slotId) card.slotId = previous.slotId;
  list[replaceIndex] = card;
  return true;
}

function capSnapshotList(list, pageName, sectionKey) {
  if (!Array.isArray(list)) return [];
  const limit = sectionSlotLimit(pageName, sectionKey);
  return list.length > limit ? list.slice(0, limit) : list;
}

function getSnapshotSections(snapshot, pageName) {
  if (snapshot?.pages?.[pageName]?.sections && typeof snapshot.pages[pageName].sections === "object") {
    return snapshot.pages[pageName].sections;
  }
  if (snapshot?.sections && typeof snapshot.sections === "object") {
    return snapshot.sections;
  }
  return null;
}

function setSnapshotSections(snapshot, pageName, sections) {
  if (snapshot?.pages?.[pageName]?.sections && typeof snapshot.pages[pageName].sections === "object") {
    snapshot.pages[pageName].sections = sections;
    return snapshot;
  }
  if (snapshot?.sections && typeof snapshot.sections === "object") {
    snapshot.sections = sections;
    return snapshot;
  }
  if (!snapshot.pages) snapshot.pages = {};
  if (!snapshot.pages[pageName]) snapshot.pages[pageName] = {};
  snapshot.pages[pageName].sections = sections;
  return snapshot;
}

function normalizeLimitCard(raw, context = {}) {
  const id = raw?.id || stableId(JSON.stringify(raw));
  const sectionKey = val(
    context.sectionKey,
    raw?.psom_key,
    raw?.bind?.section,
    raw?.section,
    raw?.category,
    "unknown"
  );

  return {
    id,
    title: raw.title || raw.name || "Untitled",
    summary: raw.summary || "",
    url: raw.url || raw.link || "#",
    thumb:
      raw.thumbnail ||
      raw.thumb ||
      raw.image ||
      "/assets/img/placeholder.png",
    priority: raw.priority || raw.score || 0,
    ...buildTrackingMeta(raw, {
      ...context,
      id,
      sectionKey
    })
  };
}

function resolveLimitSectionKey(pageName, raw, sections) {
  const sectionKeys = Object.keys(sections || {});
  if (!sectionKeys.length) return null;

  const rawKey =
    raw?.psom_key ||
    raw?.bind?.psom_key ||
    raw?.bind?.section ||
    raw?.section ||
    raw?.category ||
    null;

  if (!rawKey) return null;

  const key = String(rawKey).trim();

  if (pageName === "home") {
    const HOME_SECTION_ALIAS = {
      "main1": "home_1",
      "main2": "home_2",
      "main3": "home_3",
      "main4": "home_4",
      "main5": "home_5",
      "right_top": "home_right_top",
      "right_mid": "home_right_middle",
      "right_bottom": "home_right_bottom",
      "dist_1": "home_1",
      "distribution_1": "home_1",
      "distribution-recommend": "home_1",
      "distribution-sponsor": "home_2",
      "distribution-trending": "home_3",
      "distribution-new": "home_4",
      "distribution-special": "home_5",
      "social-instagram": "home_right_top",
      "social-youtube": "home_right_middle"
    };
    const mapped = HOME_SECTION_ALIAS[key] || key;
    return sections[mapped] ? mapped : null;
  }

  if (pageName === "distribution") {
    const MAP = {
      "dist_1": "distribution-recommend",
      "dist1": "distribution-recommend",
      "distribution_1": "distribution-recommend",
      "distribution1": "distribution-recommend",
      "distribution-recommend": "distribution-recommend",
      // visual section 2: sponsor
      "dist_2": "distribution-sponsor",
      "dist2": "distribution-sponsor",
      "distribution_2": "distribution-sponsor",
      "distribution2": "distribution-sponsor",
      "distribution-new": "distribution-new",
      "dist_3": "distribution-trending",
      "dist3": "distribution-trending",
      "distribution_3": "distribution-trending",
      "distribution3": "distribution-trending",
      "distribution-trending": "distribution-trending",
      "dist_4": "distribution-new",
      "dist4": "distribution-new",
      "distribution_4": "distribution-new",
      "distribution4": "distribution-new",
      "distribution-special": "distribution-special",
      "dist_5": "distribution-special",
      "dist5": "distribution-special",
      "distribution_5": "distribution-special",
      "distribution5": "distribution-special",
      "distribution-sponsor": "distribution-sponsor",
      "dist_6": "distribution-others",
      "dist6": "distribution-others",
      "distribution_6": "distribution-others",
      "distribution6": "distribution-others",
      "distribution-others": "distribution-others",
      "dist_7": "distribution-right",
      "dist7": "distribution-right",
      "distribution_7": "distribution-right",
      "distribution7": "distribution-right",
      "distribution-right": "distribution-right"
    };
    const mapped = MAP[key] || key;
    return sections[mapped] ? mapped : null;
  }

  return sections[key] ? key : null;
}

function enforceSnapshotFileLimit(pageName, bankItems) {
  const fileName = SNAPSHOT_FILES[pageName];
  if (!fileName) return;

  if (pageName === "network" || pageName === "media") return;

  const found = readSnapshotJson(fileName);
  if (!found.data) return;

  const snapshot = found.data || {};
  const sections = getSnapshotSections(snapshot, pageName);
  if (!sections) return;
  sanitizeSectionCollection(sections, pageName);

  const usedIds = new Set();
  for (const sectionValue of Object.values(sections)) {
    const arr = Array.isArray(sectionValue) ? sectionValue : (sectionValue && Array.isArray(sectionValue.slots) ? sectionValue.slots : []);
    for (const item of arr) {
      if (item && item.id) usedIds.add(item.id);
      if (item && item.contentId) usedIds.add(item.contentId);
    }
  }

  for (const raw of (Array.isArray(bankItems) ? bankItems : [])) {
    const id = raw?.id || stableId(JSON.stringify(raw));
    if (usedIds.has(id)) continue;
    if (!pageMatches(raw, pageName)) continue;

    const sectionKey = resolveLimitSectionKey(pageName, raw, sections);
    if (!sectionKey || !sections[sectionKey]) continue;
    if (!snapshotCandidateAllowed(raw, { pageName, sectionKey })) continue;

    const target = sections[sectionKey];
    const card = normalizeLimitCard(raw, { pageName, sectionKey });
    const changed = Array.isArray(target)
      ? pushOrReplaceSnapshotSlot(target, card, raw, { pageName, sectionKey, limit: SECTION_SLOT_LIMIT, idFields: ["id", "contentId"] })
      : (target && Array.isArray(target.slots)
          ? pushOrReplaceSnapshotSlot(target.slots, card, raw, { pageName, sectionKey, limit: SECTION_SLOT_LIMIT, idFields: ["id", "contentId"] })
          : false);
    if (changed) usedIds.add(id);
  }

  sanitizeSectionCollection(sections, pageName);
  setSnapshotSections(snapshot, pageName, sections);
  writeSnapshotJson(fileName, snapshot);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function stableId(str) {
  return crypto.createHash("sha1").update(String(str)).digest("hex").slice(0, 16);
}

function val() {
  for (const v of arguments) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    return v;
  }
  return "";
}

function safeObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
}

function toKey(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function inferRevenueLine(raw, context) {
  raw = raw || {};
  context = context || {};

  const direct = val(
    raw.revenueLine,
    raw.revenue_line,
    raw?.content?.revenue_line,
    raw?.monetization?.revenueLine,
    raw?.revenue?.line,
    context.revenueLine
  );
  if (direct) return direct;

  const text = [
    raw.kind,
    raw.type,
    raw.mediaType,
    raw.category,
    raw.section,
    raw.psom_key,
    raw.title,
    raw.summary,
    raw.url,
    raw.link,
    context.pageName,
    context.sectionKey
  ].join(" ").toLowerCase();

  if (raw?.linkRevenue?.enabled || raw.affiliate) return "product_affiliate";
  if (raw?.directSale?.enabled || raw?.payment?.enabled || raw?.commerce?.directSale) return "commerce_direct";
  if (raw?.donation?.enabled || text.includes("donation") || text.includes("donate") || text.includes("후원") || text.includes("기부")) return "donation_intent";
  if (text.includes("ad") || text.includes("sponsor") || text.includes("banner")) return "display_ad";
  if (text.includes("tour") || text.includes("travel") || text.includes("hotel") || text.includes("관광") || text.includes("여행")) return "tour_commission";
  if (
    text.includes("media") || text.includes("video") || text.includes("movie") || text.includes("drama") ||
    text.includes("shorts") || text.includes("youtube") || text.includes("vimeo") || text.includes("tiktok")
  ) return "media_engagement";
  if (raw.price || raw.amount || raw.productId || raw.sku || text.includes("product") || text.includes("commerce") || text.includes("shop") || text.includes("상품")) return "product_affiliate";

  return "slot_click";
}

function buildTrackingMeta(raw, context) {
  raw = raw || {};
  context = context || {};

  const id = val(
    context.id,
    raw.id,
    raw.uid,
    raw.item_id,
    raw.contentId,
    raw.content_id,
    raw.productId,
    raw.product_id,
    raw.sku,
    stableId(JSON.stringify(raw))
  );

  const sectionKey = val(
    context.sectionKey,
    raw.psom_key,
    raw.psomKey,
    raw?.bind?.psom_key,
    raw?.bind?.section,
    raw.section,
    raw.category,
    "unknown"
  );

  const pageName = val(
    context.pageName,
    raw.page,
    raw.channel,
    raw?._snapshotPage,
    raw?.bind?.page,
    "unknown"
  );

  const trackId = val(
    raw.trackId,
    raw.track_id,
    raw?.track?.track_id,
    raw?.monetization?.impression?.trackId,
    raw?.monetization?.click?.trackId,
    raw?.monetization?.searchClick?.trackId,
    raw?.monetization?.referral?.trackCode,
    raw?.linkRevenue?.trackId,
    `igdc-${toKey(pageName)}-${toKey(sectionKey)}-${toKey(id)}`
  );

  const snapshotRecordId = val(
    raw.snapshotRecordId,
    raw.snapshot_record_id,
    raw?.bank_ref?.record_id,
    raw?.sourceRecordId,
    raw?.source_id,
    id
  );

  const price = val(
    raw.price,
    raw.amount,
    raw.value,
    raw?.transaction?.price,
    raw?.commerce?.price,
    raw?.directSale?.price,
    raw?.payment?.price,
    raw?.donation?.amount
  );

  const currency = val(
    raw.currency,
    raw.ccy,
    raw.priceCurrency,
    raw?.commerce?.currency,
    raw?.directSale?.currency,
    raw?.payment?.currency,
    raw?.donation?.currency,
    "KRW"
  );

  const meta = {
    contentId: val(raw.contentId, raw.content_id, raw.uid, id),
    productId: val(raw.productId, raw.product_id, raw.sku, raw?.directSale?.productSku, raw?.commerce?.sku, ""),
    slotId: val(context.slotId, raw.slotId, raw.slot_id, trackId),
    trackId,
    revenueLine: inferRevenueLine(raw, context),
    providerId: val(raw.providerId, raw.provider_id, raw.provider, raw.producerId, raw.creatorId, raw?.commerce?.provider, raw?.source?.platform, raw?.source?.name, raw.source, "igdc"),
    sellerId: val(raw.sellerId, raw.seller_id, raw.seller, raw.merchant, raw?.commerce?.seller, raw.provider, ""),
    campaignId: val(raw.campaignId, raw.campaign_id, raw?.donation?.campaign_id, raw?.monetization?.campaignId, ""),
    price: price === "" ? raw.price : price,
    currency,
    page: pageName,
    section: sectionKey,
    snapshotSource: val(context.snapshotSource, raw.snapshotSource, raw._snapshotSource, "search-bank.snapshot.json"),
    snapshotRecordId,
    sourceType: "snapshot_seed"
  };
  // Preserve only explicit outbound contracts already verified upstream.
  // AutoMaps can then open the exact seller product page instead of falling
  // back to an IGDC internal content route.
  const externalOutboundUrl = val(raw.externalOutboundUrl, raw.external_outbound_url);
  const affiliateOutboundUrl = val(raw.affiliateOutboundUrl, raw.affiliate_outbound_url);
  if (/^https:\/\//i.test(externalOutboundUrl)) meta.externalOutboundUrl = externalOutboundUrl;
  if (affiliateOutboundUrl) meta.affiliateOutboundUrl = affiliateOutboundUrl;

  const contract = contractOf(raw);
  const pg = snapshotPaymentState(raw);
  meta.snapshotEngineVersion = SNAPSHOT_ENGINE_VERSION;
  meta.searchBankContractVersion = val(contract.contractVersion, SEARCH_BANK_CONTRACT_VERSION);
  meta.snapshotEligible = !explicitFalse(firstDefined(raw.snapshotEligible, contract.snapshotEligible, true));
  meta.frontSupplyAllowed = !explicitFalse(firstDefined(raw.frontSupplyAllowed, contract.frontSupplyAllowed, true));
  meta.searchBankEligible = !explicitFalse(firstDefined(raw.searchBankEligible, contract.searchBankEligible, true));
  meta.riskLevel = val(raw.riskLevel, contract.riskLevel, "low");
  meta.blockedReason = val(raw.blockedReason, contract.blockedReason, "");
  meta.paymentStructureReady = pg.paymentStructureReady;
  meta.paymentLive = pg.paymentLive;
  meta.pgExecution = pg.pgExecution;
  meta.pgStatus = pg.pgStatus;
  meta.pgPolicy = pg.policy;

  if (safeObj(raw.monetization)) meta.monetization = raw.monetization;
  if (safeObj(raw.linkRevenue)) meta.linkRevenue = raw.linkRevenue;
  // Keep only the public, explicit affiliate contract. A generic external URL
  // is never promoted into an affiliate margin route.
  const affiliate = NonPgRevenue.publicAffiliate(raw);
  if (affiliate) {
    meta.affiliate = affiliate;
    if (affiliate.eligible === true && affiliate.providerId && id) {
      meta.affiliateOutboundUrl = "/.netlify/functions/affiliate-outbound?id=" + encodeURIComponent(id);
    }
  }
  if (safeObj(raw.directSale)) meta.directSale = raw.directSale;
  if (safeObj(raw.payment)) meta.payment = raw.payment;
  if (safeObj(raw.revenue)) meta.revenue = raw.revenue;
  if (safeObj(raw.revenueDestination)) meta.revenueDestination = raw.revenueDestination;
  if (safeObj(raw.blockchainPayment)) meta.blockchainPayment = raw.blockchainPayment;
  if (safeObj(raw.metrics)) meta.metrics = raw.metrics;
  if (safeObj(raw.donation)) meta.donation = raw.donation;
  if (safeObj(raw.commerce)) meta.commerce = raw.commerce;
  if (safeObj(raw.mediaRevenue)) meta.mediaRevenue = raw.mediaRevenue;
  if (safeObj(raw.searchBankContract)) meta.searchBankContract = raw.searchBankContract;
  if (safeObj(raw.osaiDiscernment)) meta.osaiDiscernment = raw.osaiDiscernment;
  if (safeObj(raw.supplyChain)) meta.supplyChain = raw.supplyChain;
  if (safeObj(raw.sanmaruTrust)) meta.sanmaruTrust = raw.sanmaruTrust;

  return meta;
}


function loadSearchBank() {
  const found = readSnapshotJson("search-bank.snapshot.json");
  if (found.data && Array.isArray(found.data.items)) return found.data;
  return { meta: { source: "search-bank.snapshot.json", missing: true, generatedAt: new Date().toISOString() }, items: [] };
}

function loadSnapshot(page) {
  const file = SNAPSHOT_FILES[page];
  if (!file) return null;
  const found = readSnapshotJson(file);
  return found.data || null;
}

function getDefaultSection(bank, page) {
  return bank?.meta?.policy?.routing?.page_default_section?.[page] || null;
}

function resolveSection(item, defaultSection) {
  if (item.psom_key) return item.psom_key;
  if (item.category) return item.category;
  return defaultSection;
}

function explicitPageOf(item) {
  item = item || {};
  // `channel` is a content/platform dimension (youtube, instagram, etc.),
  // not an authoritative front-page route.  Treating it as a page caused valid
  // Social rows to fail pageMatches().  Only explicit page-bearing fields
  // participate in cross-page isolation.
  return String(
    item.page ||
    item?.bind?.page ||
    item?.placement?.page ||
    item?.layerPointer?.page ||
    ""
  ).trim().toLowerCase();
}
function pageMatches(item, expected) {
  const page = explicitPageOf(item);
  if (!page) return true; // legacy unscoped rows keep their old section routing.
  const aliases = {
    home: ["home"],
    distribution: ["distribution", "distributionhub", "distribution-hub", "commerce"],
    network: ["network", "networkhub", "network-hub"],
    social: ["social", "socialnetwork", "social-network"],
    tour: ["tour", "travel"]
  };
  return (aliases[expected] || [expected]).includes(page);
}

function getSlotLimit(snapshot, sectionKey) {
  if (snapshot?.sections?.[sectionKey]) {
    return snapshot.sections[sectionKey].length;
  }
  if (snapshot?.capacity?.sections_default) {
    return snapshot.capacity.sections_default;
  }
  return 100;
}

function mergeItems(snapshot, sectionKey, items, slotLimit) {
  if (!snapshot.sections) return snapshot;

  if (!snapshot.sections[sectionKey]) {
    if (STRICT_ROUTE) return snapshot;
    snapshot.sections[sectionKey] = [];
  }

  const existing = snapshot.sections[sectionKey];
  const existingIds = new Set(existing.map(i => i.id));
  let count = existing.length;

  for (const item of items) {
    if (count >= slotLimit) break;

    if (!snapshotCandidateAllowed(item, { sectionKey })) continue;
    const id = item.id || stableId(JSON.stringify(item));
    if (existingIds.has(id)) continue;

    const converted = enrichSnapshotCard({
      id,
      title: item.title || item.name || "Untitled",
      summary: item.summary || "",
      url: item.url || item.link || "#",
      thumb:
        item.thumbnail ||
        item.thumb ||
        item.image ||
        "/assets/img/placeholder.png",
      priority: item.priority || item.score || 0,
      ...buildTrackingMeta(item, {
        id,
        pageName: item.page || item.channel || "snapshot",
        sectionKey
      })
    }, item);

    existing.push(converted);
    existingIds.add(id);
    count++;
  }

  snapshot.sections[sectionKey] = existing;
  return snapshot;
}

function run(payload) {

  const suppliedBank = payload && payload.bank;
  const suppliedTarget = String(payload && payload.targetPage || "").trim().toLowerCase();
  const targetPage = Object.prototype.hasOwnProperty.call(SNAPSHOT_FILES, suppliedTarget)
    ? suppliedTarget
    : "";
  // Optional build-time input contract. Existing calls still load the normal
  // SearchBank snapshot and execute every handler. A validated caller may
  // supply one SearchBank-shaped bank and one target page without bypassing
  // this Snapshot Engine.
  let bank = suppliedBank && Array.isArray(suppliedBank.items)
    ? suppliedBank
    : loadSearchBank();

  bank.items = (Array.isArray(bank.items) ? bank.items : []).filter(item => snapshotCandidateAllowed(item, { pageName: "snapshot" }));
  const executionReport = {
    ok: false,
    version: SNAPSHOT_ENGINE_VERSION,
    canonicalReleaseId: payload && payload.canonicalReleaseId || null,
    targetPage: targetPage || "all",
    searchBankItemCount: bank.items.length,
    completedHandlers: [],
    generatedAt: new Date().toISOString()
  };
  
function mergeFrontFromSearchBank(frontSnap, searchbankSnap) {

  if (!frontSnap.pages) frontSnap.pages = {};
  if (!frontSnap.pages.home) frontSnap.pages.home = { sections: {} };
  if (!frontSnap.pages.home.sections) frontSnap.pages.home.sections = {};

  const homeSections = sanitizeSectionCollection(frontSnap.pages.home.sections, "home");
  const items = Array.isArray(searchbankSnap?.items) ? searchbankSnap.items : [];

  for (const item of items) {

    if (!pageMatches(item, "home")) continue;

 const rawSectionKey =
  item?.bind?.section ||
  item?.psom_key ||
  item?.category;

// 🔥 HOME 매핑 테이블
const HOME_SECTION_ALIAS = {

  // ===== 🔥 핵심: PSOM → HOME =====
  "main1": "home_1",
  "main2": "home_2",
  "main3": "home_3",
  "main4": "home_4",
  "main5": "home_5",

  "right_top": "home_right_top",
  "right_mid": "home_right_middle",
  "right_bottom": "home_right_bottom",

  // ===== 기존 유지 =====
  "dist_1": "home_1",
  "distribution_1": "home_1",
  "distribution-recommend": "home_1",

  "distribution-sponsor": "home_2",
  "distribution-trending": "home_3",
  "distribution-new": "home_4",
  "distribution-special": "home_5",

  "social-instagram": "home_right_top",
  "social-youtube": "home_right_middle",

};

const sectionKey = HOME_SECTION_ALIAS[rawSectionKey] || rawSectionKey;

    if (!sectionKey) continue;
    if (!homeSections[sectionKey]) continue;
    if (!snapshotCandidateAllowed(item, { pageName: "home", sectionKey })) continue;

    const existing = homeSections[sectionKey];
    const id = item.id || stableId(JSON.stringify(item));

if (existing.find(i => i.id === id || i.contentId === id)) continue;

const card = enrichSnapshotCard({
  id,
  title: item.title || item.name || "Untitled",
  summary: item.summary || "",
  url: item.url || item.link || "#",
  thumb:
    item.thumbnail ||
    item.thumb ||
    item.image ||
    "/assets/img/placeholder.png",
  ...buildTrackingMeta(item, {
    id,
    pageName: "home",
    sectionKey
  })
}, item);

pushOrReplaceSnapshotSlot(existing, card, item, { pageName: "home", sectionKey, limit: SECTION_SLOT_LIMIT, idFields: ["id", "contentId"] });
  }

  return frontSnap;
}

function handleHomeSnapshot(bank) {

  const found = readSnapshotJson("front.snapshot.json");
  if (!found.data) return;

  const frontSnap = found.data || {};
  const merged = mergeFrontFromSearchBank(frontSnap, bank);

  writeSnapshotJson("front.snapshot.json", merged);
}

/* ===== NETWORK SNAPSHOT MERGE (FIXED: ITEMS BASED) ===== */

function handleNetworkSnapshot(bank) {

  const fileName = "networkhub-snapshot.json";
  const found = readSnapshotJson(fileName);

  if (!found.data) return;

  const snapshot = found.data || {};
  const bankItems = Array.isArray(bank?.items) ? bank.items : [];

  if (!Array.isArray(snapshot.items)) snapshot.items = [];
  snapshot.items = sanitizeSnapshotArray(snapshot.items, "network", "network-right");

  const NETWORK_LIMIT = 100;

  if (snapshot.items.length > NETWORK_LIMIT) {
    snapshot.items = snapshot.items.slice(0, NETWORK_LIMIT);
  }

  const existingIds = new Set(
    snapshot.items.map(item => item?.id).filter(Boolean)
  );

  let count = snapshot.items.length;

  for (const item of bankItems) {

    if (!pageMatches(item, "network")) continue;

    const rawKey =
      item?.psom_key ||
      item?.bind?.section ||
      item?.category ||
      item?.section ||
      "";

    if (rawKey !== "network-right") continue;
    if (!snapshotCandidateAllowed(item, { pageName: "network", sectionKey: "network-right" })) continue;

    const id = item.id || stableId(JSON.stringify(item));
    if (existingIds.has(id)) continue;

    const card = enrichSnapshotCard({
      id,
      title: item.title || item.name || "Untitled",
      summary: item.summary || "",
      url: item.url || item.link || "#",
      thumb:
        item.thumb ||
        item.thumbnail ||
        item.image ||
        "/assets/img/placeholder.png",
      psom_key: "network-right",
      route: item.route || "networkhub",
      type: item.type || "product",
      priority: item.priority || 0,
      ...buildTrackingMeta(item, {
        id,
        pageName: "network",
        sectionKey: "network-right",
        revenueLine: item.revenueLine || item.revenue_line || "product_affiliate"
      })
    }, item);

    if (pushOrReplaceSnapshotSlot(snapshot.items, card, item, { pageName: "network", sectionKey: "network-right", limit: NETWORK_LIMIT, idFields: ["id", "contentId"] })) {
      existingIds.add(id);
      count = Math.min(NETWORK_LIMIT, snapshot.items.length);
    }
  }

  snapshot.items = capSnapshotList(snapshot.items, "network", "network-right");
  writeSnapshotJson(fileName, snapshot);
}

/* ===== DISTRIBUTION SNAPSHOT ENGINE (PSOM FULL + FALLBACK) ===== */
function handleDistributionSnapshot(bank) {

  const fileName = "distribution.snapshot.json";
  const found = readSnapshotJson(fileName);

  if (!found.data) return;

  const snapshot = found.data || {};
  const bankItems = Array.isArray(bank?.items) ? bank.items : [];
  const now = Date.now();

  if (!snapshot.pages) snapshot.pages = {};
  if (!snapshot.pages.distribution) snapshot.pages.distribution = { sections: {} };
  if (!snapshot.pages.distribution.sections) snapshot.pages.distribution.sections = {};

const sections = sanitizeSectionCollection(snapshot.pages.distribution.sections, "distribution");
snapshot.pages.distribution.sections = sections;

const REQUIRED_SECTION_KEYS = [
  "distribution-recommend",
  "distribution-sponsor",
  "distribution-trending",
  "distribution-new",
  "distribution-special",
  "distribution-others",
  "distribution-right"
];

REQUIRED_SECTION_KEYS.forEach(key => {
  if (!Array.isArray(sections[key])) sections[key] = [];
  sections[key] = capSnapshotList(sections[key], "distribution", key);
});

  function normalize(item) {
    if (!item || typeof item !== "object") return null;

    const sectionKeyForContract = item.psom_key || item?.bind?.section || item?.section || item?.category || "distribution";
    if (!snapshotCandidateAllowed(item, { pageName: "distribution", sectionKey: sectionKeyForContract })) return null;

    return enrichSnapshotCard({
      id: item.id || stableId(JSON.stringify(item)),
      title: item.title || item.name || "Untitled",
      summary: item.summary || "",
      url: item.url || item.link || "#",
      thumb:
        item.thumbnail ||
        item.thumb ||
        item.image ||
        "/assets/img/placeholder.png",
      price: item.price || "",
      currency: item.currency || "USD",
      priority: item.priority || item.score || 0,
      score: item._finalScore || item.score || 0,
      createdAt: item.createdAt || item.timestamp || 0,
      views: item.views || 0,
      sponsor: item.sponsor === true,
      tag: item.tag || "",
      psom_key: item.psom_key || null,
      source: item.source || "",
      seller: item.seller || item.source || "",
      ...buildTrackingMeta(item, {
        pageName: "distribution",
        sectionKey:
          item.psom_key ||
          item?.bind?.section ||
          item?.section ||
          item?.category ||
          "distribution"
      })
    }, item);
  }

  function pushUnique(sectionKey, items, limit) {
    if (!Array.isArray(sections[sectionKey])) sections[sectionKey] = [];

    const existing = sections[sectionKey];
    const existingIds = new Set(existing.map(i => i.id));

    for (const raw of items) {
      const item = normalize(raw);
      if (!item) continue;
      if (existingIds.has(item.id)) continue;

      const changed = pushOrReplaceSnapshotSlot(existing, item, raw, { pageName: "distribution", sectionKey, limit: limit || SECTION_SLOT_LIMIT, idFields: ["id", "contentId"] });
      if (changed) existingIds.add(item.id);

      if (typeof limit === "number" && existing.length >= limit && !isRealIncomingCandidate(raw)) break;
    }
  }

  function isCommerceLike(raw) {
    const text = (
      (raw.title || "") + " " +
      (raw.summary || "") + " " +
      (raw.description || "")
    ).toLowerCase();

    return (
      raw.type === "product" ||
      raw.category === "distribution" ||
      text.includes("shop") ||
      text.includes("buy") ||
      text.includes("price") ||
      text.includes("상품") ||
      text.includes("구매") ||
      text.includes("판매")
    );
  }

  function distributionSectionOf(raw) {
    const rawSectionKey =
      raw?.psom_key ||
      raw?.bind?.psom_key ||
      raw?.bind?.section ||
      raw?.section ||
      raw?.category ||
      null;
    const MAP = {
      "dist_1": "distribution-recommend", "dist1": "distribution-recommend", "distribution_1": "distribution-recommend", "distribution1": "distribution-recommend", "distribution-recommend": "distribution-recommend",
      "dist_2": "distribution-sponsor", "dist2": "distribution-sponsor", "distribution_2": "distribution-sponsor", "distribution2": "distribution-sponsor", "distribution-new": "distribution-new",
      "dist_3": "distribution-trending", "dist3": "distribution-trending", "distribution_3": "distribution-trending", "distribution3": "distribution-trending", "distribution-trending": "distribution-trending",
      "dist_4": "distribution-new", "dist4": "distribution-new", "distribution_4": "distribution-new", "distribution4": "distribution-new", "distribution-special": "distribution-special",
      "dist_5": "distribution-special", "dist5": "distribution-special", "distribution_5": "distribution-special", "distribution5": "distribution-special", "distribution-sponsor": "distribution-sponsor",
      "dist_6": "distribution-others", "dist6": "distribution-others", "distribution_6": "distribution-others", "distribution6": "distribution-others", "distribution-others": "distribution-others",
      "dist_7": "distribution-right", "dist7": "distribution-right", "distribution_7": "distribution-right", "distribution7": "distribution-right", "distribution-right": "distribution-right"
    };
    return MAP[rawSectionKey] || rawSectionKey;
  }

  function belongsToDistribution(raw) {
    const pageLike = explicitPageOf(raw);
    if (pageLike) return pageMatches(raw, "distribution");
    const mapped = distributionSectionOf(raw);
    if (mapped && sections[mapped]) return true;
    const nonDistribution = /^(network|network-right|social|media|tour|donation|home)/i.test(String(mapped || ""));
    return !nonDistribution && isCommerceLike(raw);
  }

  const commercePool = bankItems.filter(raw => belongsToDistribution(raw));

  for (const raw of commercePool) {
    const item = normalize(raw);
    if (!item) continue;

    // 1) PSOM / bind 우선
    const rawSectionKey =
      item.psom_key ||
      raw?.bind?.psom_key ||
      raw?.bind?.section ||
      raw?.section ||
      null;

   const MAP = {

  // ===== recommend =====
  "dist_1": "distribution-recommend",
  "dist1": "distribution-recommend",
  "distribution_1": "distribution-recommend",
  "distribution1": "distribution-recommend",
  "distribution-recommend": "distribution-recommend",

  // ===== sponsor (visual section 2) =====
  "dist_2": "distribution-sponsor",
  "dist2": "distribution-sponsor",
  "distribution_2": "distribution-sponsor",
  "distribution2": "distribution-sponsor",
  "distribution-new": "distribution-new",

  // ===== trending =====
  "dist_3": "distribution-trending",
  "dist3": "distribution-trending",
  "distribution_3": "distribution-trending",
  "distribution3": "distribution-trending",
  "distribution-trending": "distribution-trending",

  // ===== new (visual section 4) =====
  "dist_4": "distribution-new",
  "dist4": "distribution-new",
  "distribution_4": "distribution-new",
  "distribution4": "distribution-new",
  "distribution-special": "distribution-special",

  // ===== special (visual section 5) =====
  "dist_5": "distribution-special",
  "dist5": "distribution-special",
  "distribution_5": "distribution-special",
  "distribution5": "distribution-special",
  "distribution-sponsor": "distribution-sponsor",

  // ===== others =====
  "dist_6": "distribution-others",
  "dist6": "distribution-others",
  "distribution_6": "distribution-others",
  "distribution6": "distribution-others",
  "distribution-others": "distribution-others",

  // ===== right =====
  "dist_7": "distribution-right",
  "dist7": "distribution-right",
  "distribution_7": "distribution-right",
  "distribution7": "distribution-right",
  "distribution-right": "distribution-right"
};

    const mapped = MAP[rawSectionKey] || rawSectionKey;

    if (mapped && sections[mapped]) {
      pushUnique(mapped, [raw], 100);
      continue;
    }

    // 2) fallback
    if (item.sponsor === true) {
      pushUnique("distribution-sponsor", [raw], 100);
      continue;
    }

    if (item.tag === "special") {
      pushUnique("distribution-special", [raw], 100);
      continue;
    }

    if (item.createdAt && (now - item.createdAt) < (86400000 * 3)) {
      pushUnique("distribution-new", [raw], 100);
      continue;
    }

    if (item.views > 1000 || item.score >= 0.6) {
      pushUnique("distribution-trending", [raw], 100);
      continue;
    }

    if (item.score >= 0.8 || item.priority >= 0.8) {
      pushUnique("distribution-recommend", [raw], 100);
      continue;
    }

    pushUnique("distribution-others", [raw], 100);
  }

  // right panel
  const rightPool = commercePool.filter(raw => {

    const item = normalize(raw);
    if (!item) return false;

    const rawSectionKey =
      item.psom_key ||
      raw?.bind?.psom_key ||
      raw?.bind?.section ||
      raw?.section ||
      null;

    const MAP = {
      "dist_7": "distribution-right",
      "distribution_7": "distribution-right",
      "distribution-right": "distribution-right"
    };

    const mapped = MAP[rawSectionKey] || rawSectionKey;

    // 🔥 핵심: right 전용 섹션만 허용
    return mapped === "distribution-right";
  });

  pushUnique("distribution-right", rightPool, 100);

snapshot.pages.distribution.sections = sections;
writeSnapshotJson(fileName, snapshot);
}

/* ===== SOCIAL SNAPSHOT MERGE ===== */

function handleSocialSnapshot(bank) {

  const fileName = "social.snapshot.json";
  const found = readSnapshotJson(fileName);

  if (!found.data) return;

  const snapshot = found.data || {};

  // 🔥 pages 구조 강제
  if (!snapshot.pages) snapshot.pages = {};
  if (!snapshot.pages.social) snapshot.pages.social = { sections: {} };
  if (!snapshot.pages.social.sections) snapshot.pages.social.sections = {};

  const sections = sanitizeSectionCollection(snapshot.pages.social.sections, "social");
  const bankItems = bank.items || [];

  const sectionKeys = Object.keys(sections);

  for (const sectionKey of sectionKeys) {

    const existing = sections[sectionKey] || [];
    const existingIds = new Set(existing.map(i => i.id));

    const supply = bankItems.filter(item => {
      if (!pageMatches(item, "social")) return false;
      const sec =
        item?.bind?.section ||
        item?.psom_key ||
        item?.category;
      return sec === sectionKey && snapshotCandidateAllowed(item, { pageName: "social", sectionKey });
    });

    for (const item of supply) {

      const id = item.id || stableId(JSON.stringify(item));
      if (existingIds.has(id)) continue;

      const card = enrichSnapshotCard({
        id,
        contentId: item.contentId || item.candidateId || id,
        candidateId: item.candidateId || item.contentId || id,
        type: item.type || "external_social",
        title: item.title || item.name || "Untitled",
        description: item.description || item.summary || "",
        summary: item.summary || "",
        url: item.url || item.link || "#",
        link: item.link || item.url || "#",
        href: item.href || item.url || item.link || "#",
        thumb:
          item.thumbnail ||
          item.thumb ||
          item.image ||
          "/assets/img/placeholder.png",
        thumbnail: item.thumbnail || item.thumb || item.image || "",
        thumbnailUrl: item.thumbnailUrl || item.thumbnail || item.thumb || item.image || "",
        image: item.image || item.thumbnail || item.thumb || "",
        creator: item.creator || item.creatorName || item.creatorHandle || "",
        creatorName: item.creatorName || "",
        creatorHandle: item.creatorHandle || "",
        embedUrl: item.embedUrl || undefined,
        displayMode: item.displayMode || "link_card",
        source: item.source && typeof item.source === "object" ? Object.assign({}, item.source) : {},
        social: item.social && typeof item.social === "object" ? Object.assign({}, item.social) : {},
        signals: item.signals && typeof item.signals === "object" ? Object.assign({}, item.signals) : {},
        audit: item.audit && typeof item.audit === "object" ? Object.assign({}, item.audit) : {
          origin: "social_candidates",
          candidate_id: item.contentId || item.candidateId || id
        },
        timestamps: item.timestamps && typeof item.timestamps === "object" ? Object.assign({}, item.timestamps) : {},
        priority: item.priority || item.score || 0,
        ...buildTrackingMeta(item, {
          id,
          pageName: "social",
          sectionKey
        })
      }, item);

      if (pushOrReplaceSnapshotSlot(existing, card, item, { pageName: "social", sectionKey, limit: SECTION_SLOT_LIMIT, idFields: ["id", "contentId"] })) {
        existingIds.add(id);
      }
    }

    sections[sectionKey] = capSnapshotList(existing, "social", sectionKey);
  }

  snapshot.pages.social.sections = sections;

  writeSnapshotJson(fileName, snapshot);
}

/* ===== MEDIA SNAPSHOT MERGE ===== */

function handleMediaSnapshot(bank) {

  const fileName = "media.snapshot.json";
  const found = readSnapshotJson(fileName);

  if (!found.data) return;

  const snapshot = found.data || {};
  const bankItems = Array.isArray(bank?.items) ? bank.items : [];

  if (!snapshot.sections || typeof snapshot.sections !== "object") return;

  const sections = sanitizeSectionCollection(snapshot.sections, "media");

  const MEDIA_ALIAS = {
    "trending_now": "media-trending",
    "latest_movie": "media-movie",
    "latest_drama": "media-drama",
    "section_1": "media-thriller",
    "section_2": "media-romance",
    "section_3": "media-variety",
    "section_4": "media-documentary",
    "section_5": "media-animation",
    "section_6": "media-music",
    "section_7": "media-shorts"
  };

  const MEDIA_KEYS = new Set([
    "media-trending",
    "media-movie",
    "media-drama",
    "media-thriller",
    "media-romance",
    "media-variety",
    "media-documentary",
    "media-animation",
    "media-music",
    "media-shorts"
  ]);

function resolveMediaKey(rawKey) {
  if (!rawKey) return null;

  const key = String(rawKey).toLowerCase();

  // ===== 직접 키 =====
  if (MEDIA_KEYS.has(key)) return key;

  // ===== 기존 alias =====
  if (MEDIA_ALIAS[key]) return MEDIA_ALIAS[key];

  // ===== 확장 alias =====
  const EXTENDED = {
    "movie": "media-movie",
    "film": "media-movie",

    "drama": "media-drama",
    "series": "media-drama",

    "thriller": "media-thriller",
    "mystery": "media-thriller",

    "romance": "media-romance",
    "love": "media-romance",

    "variety": "media-variety",
    "entertainment": "media-variety",
    "show": "media-variety",

    "documentary": "media-documentary",
    "docu": "media-documentary",

    "animation": "media-animation",
    "anime": "media-animation",
    "cartoon": "media-animation",

    "music": "media-music",
    "mv": "media-music",

    "shorts": "media-shorts",
    "short": "media-shorts",
    "clip": "media-shorts"
  };

  if (EXTENDED[key]) return EXTENDED[key];

  return null;
}

function isVideoLike(item) {
  if (!item) return false;

  const t = String(item.type || "").toLowerCase();
  const m = String(item.mediaType || "").toLowerCase();
  const p = String(item.platform || "").toLowerCase();
  const c = String(item.category || "").toLowerCase();
  const u = String(item.url || item.link || item.videoUrl || "").toLowerCase();

  return !!(
    t === "video" ||
    t === "movie" ||
    t === "clip" ||
    t === "shorts" ||

    m === "video" ||
    m === "movie" ||
    m === "clip" ||
    m === "shorts" ||

    p === "youtube" ||
    p === "vimeo" ||
    p === "tiktok" ||

    c === "video" ||
    c === "movie" ||
    c === "clip" ||
    c === "shorts" ||

    item.videoUrl ||

    u.includes("youtu") ||
    u.includes("vimeo") ||
    u.includes("tiktok") ||
    u.includes("/shorts/")
  );
}

  function buildSlot(raw, fallbackSlotId) {
    const videoUrl =
      raw.videoUrl ||
      raw.url ||
      raw.link ||
      "#";

    const thumb =
  raw.thumbnail ||
  raw.poster ||
  raw.thumb ||
  raw.image ||
  (typeof videoUrl === "string" && videoUrl.includes("youtu")
    ? `https://img.youtube.com/vi/${extractYouTubeId(videoUrl)}/hqdefault.jpg`
    : "/assets/img/placeholder.png");
	
    return enrichSnapshotCard({
      slotId: fallbackSlotId,
      contentId: raw.id || stableId(JSON.stringify(raw)),
      title: raw.title || raw.name || "Untitled",
      thumb,
      provider: raw.provider || raw.source || null,
      url: videoUrl,
      video: raw.videoUrl || raw.url || raw.link || "",
      metrics: {
        click: Number(raw.clicks || 0),
        view: Number(raw.views || 0),
        like: Number(raw.likes || 0),
        recommend: Number(raw.recommend || raw.recommends || 0),
        watchTime: Number(raw.watchTime || 0)
      },
      outbound: {
        enabled: true,
        track: true
      },
      payment: Object.assign({
        enabled: false,
        structureReady: !!(raw.price || raw.productId || raw.paymentReady || raw.paymentStructureReady),
        type: raw.paymentType || "media_access",
        price: raw.price || null,
        currency: raw.currency || "KRW",
        pg: null,
        productId: raw.productId || null
      }, snapshotPaymentState(raw)),
      revenue: {
        ads: true,
        affiliate: true,
        provider: true,
        directSale: !!(raw.directSale && raw.directSale.enabled)
      },
      ...buildTrackingMeta(raw, {
        id: raw.id || stableId(JSON.stringify(raw)),
        slotId: fallbackSlotId,
        pageName: "media",
        sectionKey:
          raw?.psom_key ||
          raw?.bind?.section ||
          raw?.category ||
          "media",
        revenueLine: raw.revenueLine || raw.revenue_line || "media_engagement"
      })
    }, raw);
  }

  for (const raw of bankItems) {

    if (!isVideoLike(raw)) continue;

    const rawKey =
      raw?.psom_key ||
      raw?.bind?.section ||
      raw?.category;

    const sectionKey = resolveMediaKey(rawKey);

    if (!sectionKey) continue;
    if (!snapshotCandidateAllowed(raw, { pageName: "media", sectionKey })) continue;

    if (sectionKey === "media-trending") continue;

    const sectionObj = sections[sectionKey];
    if (!sectionObj || typeof sectionObj !== "object") continue;

    if (!Array.isArray(sectionObj.slots)) sectionObj.slots = [];

    sectionObj.slots = capSnapshotList(sectionObj.slots, "media", sectionKey);
    const slots = sectionObj.slots;
    const existingIds = new Set(
      slots.map(s => s?.contentId || s?.id).filter(Boolean)
    );

    const contentId = raw.id || stableId(JSON.stringify(raw));
    if (existingIds.has(contentId)) continue;

    const nextSlotId =
      slots.length > 0
        ? Math.max(...slots.map(s => Number(s?.slotId) || 0)) + 1
        : 1;

    pushOrReplaceSnapshotSlot(slots, buildSlot(raw, nextSlotId), raw, { pageName: "media", sectionKey, limit: SECTION_SLOT_LIMIT, idFields: ["contentId", "id"] });
  }

  snapshot.sections = sections;
  writeSnapshotJson(fileName, snapshot);
}

/* ===== 유튜브 ID 추출 ===== */
function extractYouTubeId(url) {
  if (!url) return "";
  const match =
    url.match(/v=([^&]+)/) ||
    url.match(/youtu\.be\/([^?]+)/);
  return match ? match[1] : "";
}

/* ===== TOUR SNAPSHOT ENGINE (FEED INTEGRATION) ===== */
function handleTourSnapshot(bank) {

  const fileName = "tour-snapshot.json";
  const found = readSnapshotJson(fileName);

  if (!found.data) return;

  const snapshot = found.data || {};
  const bankItems = Array.isArray(bank?.items) ? bank.items : [];

  let items = sanitizeSnapshotArray(Array.isArray(snapshot.items) ? snapshot.items : [], "tour", "tour");

  const TOUR_LIMIT = 100;

  /* ===== TOUR FILTER ===== */
  function isTour(item){
    if (!item || !pageMatches(item, "tour")) return false;
    const page = explicitPageOf(item);
    if (page) return true;
    return item.type === "tour" || item.category === "tour" || item.travel === true;
  }

  /* ===== THUMB BUILDER ===== */
  function buildTourThumbnail(item){

    if (item.image || item.thumb || item.thumbnail) {
      return item.image || item.thumb || item.thumbnail;
    }

    return internalPlaceholderImage();
  }

  /* ===== 기존 ID 추출 ===== */
  const existingIds = new Set(
    items.map(i => i?.id).filter(Boolean)
  );

  /* ===== MERGE ===== */
  for (const item of bankItems) {

    if (!item) continue;
    if (!isTour(item)) continue;
    if (!snapshotCandidateAllowed(item, { pageName: "tour", sectionKey: item.psom_key || item.section || item.category || "tour" })) continue;

    const id = item.id || stableId(JSON.stringify(item));
    if (existingIds.has(id)) continue;

    const card = enrichSnapshotCard({
      id,
      title: item.title || item.name || "",
      thumb: buildTourThumbnail(item),
      link: item.link || item.url || "#",
      url: item.url || item.link || "#",
      priority: item.priority || item.score || 0,
      createdAt: item.createdAt || item.timestamp || 0,
      ...buildTrackingMeta(item, {
        id,
        pageName: "tour",
        sectionKey: item.psom_key || item.section || item.category || "tour",
        revenueLine: item.revenueLine || item.revenue_line || "tour_commission"
      })
    }, item);

    if (pushOrReplaceSnapshotSlot(items, card, item, { pageName: "tour", sectionKey: "tour", limit: TOUR_LIMIT, idFields: ["id", "contentId"] })) {
      existingIds.add(id);
    }
  }

  /* ===== 정렬 (최신 + 우선순위) ===== */
  items.sort((a, b) => {
    return (b.priority || 0) - (a.priority || 0) ||
           (b.createdAt || 0) - (a.createdAt || 0);
  });

  /* ===== LIMIT ===== */
  if (items.length > TOUR_LIMIT) {
    items = items.slice(0, TOUR_LIMIT);
  }

  snapshot.items = items;
  writeSnapshotJson(fileName, snapshot);
}
  
  /* ===== SNAPSHOT ENGINE FULL EXECUTION ===== */

try {

  if ((!targetPage || targetPage === "home") && typeof handleHomeSnapshot === "function") {
    handleHomeSnapshot(bank); executionReport.completedHandlers.push("home");
  }

  if ((!targetPage || targetPage === "network") && typeof handleNetworkSnapshot === "function") {
    handleNetworkSnapshot(bank); executionReport.completedHandlers.push("network");
  }
  
  if ((!targetPage || targetPage === "distribution") && typeof handleDistributionSnapshot === "function") {
    handleDistributionSnapshot(bank); executionReport.completedHandlers.push("distribution");
  }

  if ((!targetPage || targetPage === "social") && typeof handleSocialSnapshot === "function") {
    handleSocialSnapshot(bank); executionReport.completedHandlers.push("social");
  }

  if ((!targetPage || targetPage === "media") && typeof handleMediaSnapshot === "function") {
    handleMediaSnapshot(bank); executionReport.completedHandlers.push("media");
  }

  if ((!targetPage || targetPage === "tour") && typeof handleTourSnapshot === "function") {
    handleTourSnapshot(bank); executionReport.completedHandlers.push("tour");
  }

  if (!targetPage || targetPage === "home") enforceSnapshotFileLimit("home", bank.items);
  if (!targetPage || targetPage === "distribution") enforceSnapshotFileLimit("distribution", bank.items);
  if (!targetPage || targetPage === "media") enforceSnapshotFileLimit("media", bank.items);
  if (!targetPage || targetPage === "social") enforceSnapshotFileLimit("social", bank.items);
  if (!targetPage || targetPage === "network") enforceSnapshotFileLimit("network", bank.items);
  if (!targetPage || targetPage === "tour") enforceSnapshotFileLimit("tour", bank.items);

} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  error.code = error.code || "SNAPSHOT_ENGINE_EXECUTION_FAILED";
  error.snapshotEngineVersion = SNAPSHOT_ENGINE_VERSION;
  throw error;
}
  executionReport.ok = true;
  executionReport.completedAt = new Date().toISOString();
  return executionReport;
}

module.exports = { run };

if (require.main === module) {
  run();
}
