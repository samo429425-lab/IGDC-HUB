
/**
 * IGDC Snapshot Engine vNext
 * Strict Routing + PSOM Mapping + Safe Merge
 */

"use strict";

const fs = require("fs");
const path = require("path");
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

function normalizeLimitCard(raw) {
  return {
    id: raw.id || stableId(JSON.stringify(raw)),
    title: raw.title || raw.name || "Untitled",
    summary: raw.summary || "",
    url: raw.url || raw.link || "#",
    thumb:
      raw.thumbnail ||
      raw.thumb ||
      raw.image ||
      "/assets/img/placeholder.png",
    priority: raw.priority || raw.score || 0
  };
}

function enforceSnapshotFileLimit(pageName, bankItems) {
  const fileName = SNAPSHOT_FILES[pageName];
  if (!fileName) return;

  if (pageName === "network" || pageName === "media") return;

  const filePath = path.join(ROOT, fileName);
  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const sections = getSnapshotSections(snapshot, pageName);
  if (!sections) return;

  const limit = LIMIT_MAP[pageName] || LIMIT_MAP.default;

  let currentCount = 0;
  const usedIds = new Set();

  Object.values(sections).forEach(arr => {
    if (!Array.isArray(arr)) return;
    currentCount += arr.length;
    arr.forEach(item => {
      if (item && item.id) usedIds.add(item.id);
    });
  });

  if (currentCount >= limit) return;

  const need = limit - currentCount;
  let filled = 0;

  const preferredSections = Object.keys(sections);
  if (!preferredSections.length) return;

  for (const raw of (Array.isArray(bankItems) ? bankItems : [])) {
    if (filled >= need) break;

    const id = raw?.id || stableId(JSON.stringify(raw));
    if (usedIds.has(id)) continue;

    let sectionKey =
      raw?.psom_key ||
      raw?.bind?.section ||
      raw?.category ||
      preferredSections[0];

    if (!sections[sectionKey]) {
      sectionKey = preferredSections[0];
    }

    sections[sectionKey].push(normalizeLimitCard(raw));
    usedIds.add(id);
    filled++;
  }

  setSnapshotSections(snapshot, pageName, sections);
  writeJson(filePath, snapshot);
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

function loadSearchBank() {
  const bankPath = path.join(ROOT, "search-bank.snapshot.json");
  if (!fs.existsSync(bankPath)) {
    throw new Error("search-bank.snapshot.json not found in root.");
  }
  return readJson(bankPath);
}

function loadSnapshot(page) {
  const file = SNAPSHOT_FILES[page];
  if (!file) return null;

  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return null;

  return readJson(p);
}

function getDefaultSection(bank, page) {
  return bank?.meta?.policy?.routing?.page_default_section?.[page] || null;
}

function resolveSection(item, defaultSection) {
  if (item.psom_key) return item.psom_key;
  if (item.category) return item.category;
  return defaultSection;
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

    const id = item.id || stableId(JSON.stringify(item));
    if (existingIds.has(id)) continue;

    const converted = {
      id,
      title: item.title || item.name || "Untitled",
      summary: item.summary || "",
      url: item.url || "#",
      thumb: item.thumb || item.image || "/assets/img/placeholder.png",
      priority: item.priority || 0
    };

    existing.push(converted);
    existingIds.add(id);
    count++;
  }

  snapshot.sections[sectionKey] = existing;
  return snapshot;
}

function run(payload) {

  const bankPath = path.join(ROOT,"search-bank.snapshot.json");

  let bank = { items:[] };

  if(fs.existsSync(bankPath)){
    bank = readJson(bankPath);
  }

  bank.items = bank.items || [];
  
function mergeFrontFromSearchBank(frontSnap, searchbankSnap) {

  if (!frontSnap.pages) frontSnap.pages = {};
  if (!frontSnap.pages.home) frontSnap.pages.home = { sections: {} };
  if (!frontSnap.pages.home.sections) frontSnap.pages.home.sections = {};

  const homeSections = frontSnap.pages.home.sections;
  const items = Array.isArray(searchbankSnap?.items) ? searchbankSnap.items : [];

  for (const item of items) {

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

  "donation-global": "home_right_bottom"
};

const sectionKey = HOME_SECTION_ALIAS[rawSectionKey] || rawSectionKey;

    if (!sectionKey) continue;
    if (!homeSections[sectionKey]) continue;

    const existing = homeSections[sectionKey];
    const id = item.id || stableId(JSON.stringify(item));

if (existing.find(i => i.id === id)) continue;

if (existing.length >= 5) continue;

existing.push({
  id,
  title: item.title || "Untitled",
  summary: item.summary || "",
  url: item.url || "#",
  thumb: item.thumbnail || "/assets/img/placeholder.png"
});
  }

  return frontSnap;
}

function handleHomeSnapshot(bank) {

  const frontPath = path.join(ROOT, "front.snapshot.json");
  if (!fs.existsSync(frontPath)) return;

  const frontSnap = readJson(frontPath) || {};
  const merged = mergeFrontFromSearchBank(frontSnap, bank);

  writeJson(frontPath, merged);
}

/* ===== NETWORK SNAPSHOT MERGE (FIXED: ITEMS BASED) ===== */

function handleNetworkSnapshot(bank) {

  const fileName = "networkhub-snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = Array.isArray(bank?.items) ? bank.items : [];

  if (!Array.isArray(snapshot.items)) snapshot.items = [];

  const NETWORK_LIMIT = 100;

  if (snapshot.items.length > NETWORK_LIMIT) {
    snapshot.items = snapshot.items.slice(0, NETWORK_LIMIT);
  }

  const existingIds = new Set(
    snapshot.items.map(item => item?.id).filter(Boolean)
  );

  let count = snapshot.items.length;

  for (const item of bankItems) {

    const rawKey =
      item?.psom_key ||
      item?.bind?.section ||
      item?.category ||
      item?.section ||
      "";

    if (rawKey !== "network-right") continue;
    if (count >= NETWORK_LIMIT) break;

    const id = item.id || stableId(JSON.stringify(item));
    if (existingIds.has(id)) continue;

    snapshot.items.push({
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
      route: item.route || "distribution",
      type: item.type || "product",
      priority: item.priority || 0
    });

    existingIds.add(id);
    count++;
  }

  writeJson(filePath, snapshot);
}

/* ===== DISTRIBUTION SNAPSHOT ENGINE (PSOM FULL + FALLBACK) ===== */
function handleDistributionSnapshot(bank) {

  const fileName = "distribution.snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = Array.isArray(bank?.items) ? bank.items : [];
  const now = Date.now();

  if (!snapshot.pages) snapshot.pages = {};
  if (!snapshot.pages.distribution) snapshot.pages.distribution = { sections: {} };
  if (!snapshot.pages.distribution.sections) snapshot.pages.distribution.sections = {};

snapshot.pages.distribution.sections = {};
const sections = snapshot.pages.distribution.sections;

const REQUIRED_SECTION_KEYS = [
  "distribution-recommend",
  "distribution-new",
  "distribution-trending",
  "distribution-special",
  "distribution-sponsor",
  "distribution-others",
  "distribution-right"
];

REQUIRED_SECTION_KEYS.forEach(key => {
  sections[key] = [];
});

  function normalize(item) {
    if (!item || typeof item !== "object") return null;

    return {
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
      seller: item.seller || item.source || ""
    };
  }

  function pushUnique(sectionKey, items, limit) {
    if (!Array.isArray(sections[sectionKey])) sections[sectionKey] = [];

    const existing = sections[sectionKey];
    const existingIds = new Set(existing.map(i => i.id));

    for (const raw of items) {
      const item = normalize(raw);
      if (!item) continue;
      if (existingIds.has(item.id)) continue;

      existing.push(item);
      existingIds.add(item.id);

      if (typeof limit === "number" && existing.length >= limit) break;
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

  const commercePool = bankItems.filter(isCommerceLike);

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

  // ===== new =====
  "dist_2": "distribution-new",
  "dist2": "distribution-new",
  "distribution_2": "distribution-new",
  "distribution2": "distribution-new",
  "distribution-new": "distribution-new",

  // ===== trending =====
  "dist_3": "distribution-trending",
  "dist3": "distribution-trending",
  "distribution_3": "distribution-trending",
  "distribution3": "distribution-trending",
  "distribution-trending": "distribution-trending",

  // ===== special =====
  "dist_4": "distribution-special",
  "dist4": "distribution-special",
  "distribution_4": "distribution-special",
  "distribution4": "distribution-special",
  "distribution-special": "distribution-special",

  // ===== sponsor =====
  "dist_5": "distribution-sponsor",
  "dist5": "distribution-sponsor",
  "distribution_5": "distribution-sponsor",
  "distribution5": "distribution-sponsor",
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
writeJson(filePath, snapshot);
}

/* ===== SOCIAL SNAPSHOT MERGE ===== */

function handleSocialSnapshot(bank) {

  const fileName = "social.snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};

  // 🔥 pages 구조 강제
  if (!snapshot.pages) snapshot.pages = {};
  if (!snapshot.pages.social) snapshot.pages.social = { sections: {} };
  if (!snapshot.pages.social.sections) snapshot.pages.social.sections = {};

  const sections = snapshot.pages.social.sections;
  const bankItems = bank.items || [];

  const sectionKeys = Object.keys(sections);

  for (const sectionKey of sectionKeys) {

    const existing = sections[sectionKey] || [];
    const existingIds = new Set(existing.map(i => i.id));

    const supply = bankItems.filter(item => {
      const sec =
        item?.bind?.section ||
        item?.psom_key ||
        item?.category;
      return sec === sectionKey;
    });

    for (const item of supply) {

      const id = item.id || stableId(JSON.stringify(item));
      if (existingIds.has(id)) continue;

      existing.push({
        id,
        title: item.title || item.name || "Untitled",
        summary: item.summary || "",
        url: item.url || "#",
        thumb:
          item.thumbnail ||
          item.thumb ||
          item.image ||
          "/assets/img/placeholder.png",
        priority: item.priority || item.score || 0
      });

      existingIds.add(id);
    }

    sections[sectionKey] = existing;
  }

  snapshot.pages.social.sections = sections;

  writeJson(filePath, snapshot);
}

/* ===== MEDIA SNAPSHOT MERGE ===== */

function handleMediaSnapshot(bank) {

  const fileName = "media.snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = Array.isArray(bank?.items) ? bank.items : [];

  if (!snapshot.sections || typeof snapshot.sections !== "object") return;

  const sections = snapshot.sections;

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
	
    return {
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
      payment: {
        enabled: true,
        type: "rent|buy|sub",
        price: raw.price || null,
        currency: raw.currency || "KRW",
        pg: "default",
        productId: raw.productId || null
      },
      revenue: {
        ads: true,
        affiliate: true,
        provider: true,
        directSale: true
      }
    };
  }

  for (const raw of bankItems) {

    if (!isVideoLike(raw)) continue;

    const rawKey =
      raw?.psom_key ||
      raw?.bind?.section ||
      raw?.category;

    const sectionKey = resolveMediaKey(rawKey);

    if (!sectionKey) continue;

    if (sectionKey === "media-trending") continue;

    const sectionObj = sections[sectionKey];
    if (!sectionObj || typeof sectionObj !== "object") continue;

    if (!Array.isArray(sectionObj.slots)) sectionObj.slots = [];

    const slots = sectionObj.slots;
    const existingIds = new Set(
      slots.map(s => s?.contentId).filter(Boolean)
    );

    const contentId = raw.id || stableId(JSON.stringify(raw));
    if (existingIds.has(contentId)) continue;

    const nextSlotId =
      slots.length > 0
        ? Math.max(...slots.map(s => Number(s?.slotId) || 0)) + 1
        : 1;

    slots.push(buildSlot(raw, nextSlotId));
  }

  snapshot.sections = sections;
  writeJson(filePath, snapshot);
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
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = Array.isArray(bank?.items) ? bank.items : [];

  let items = Array.isArray(snapshot.items) ? snapshot.items : [];

  const TOUR_LIMIT = 100;

  /* ===== TOUR FILTER ===== */
  function isTour(item){
    return (
      item.type === "tour" ||
      item.category === "tour" ||
      item.travel ||
      item.location ||
      item.region
    );
  }

  /* ===== THUMB BUILDER ===== */
  function buildTourThumbnail(item){

    if (item.image || item.thumb || item.thumbnail) {
      return item.image || item.thumb || item.thumbnail;
    }

    const title = encodeURIComponent(item.title || "TOUR");

    if (item.location || item.region) {
      return `https://dummyimage.com/600x400/0a3d62/ffffff&text=${title}`;
    }

    return `https://dummyimage.com/600x400/1e3799/ffffff&text=TOUR`;
  }

  /* ===== 기존 ID 추출 ===== */
  const existingIds = new Set(
    items.map(i => i?.id).filter(Boolean)
  );

  /* ===== MERGE ===== */
  for (const item of bankItems) {

    if (!item) continue;
    if (!isTour(item)) continue;

    const id = item.id || stableId(JSON.stringify(item));
    if (existingIds.has(id)) continue;

    items.push({
      id,
      title: item.title || "",
      thumb: buildTourThumbnail(item),
      link: item.link || item.url || "#",
      priority: item.priority || 0,
      createdAt: item.createdAt || 0
    });

    existingIds.add(id);
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
  writeJson(filePath, snapshot);
}
  
  /* ===== SNAPSHOT ENGINE FULL EXECUTION ===== */

try {

  if (typeof handleHomeSnapshot === "function") {
    handleHomeSnapshot(bank);
  }

  if (typeof handleNetworkSnapshot === "function") {
    handleNetworkSnapshot(bank);
  }
  
  if (typeof handleDistributionSnapshot === "function") {
    handleDistributionSnapshot(bank);
  }

  if (typeof handleSocialSnapshot === "function") {
    handleSocialSnapshot(bank);
  }

  if (typeof handleMediaSnapshot === "function") {
    handleMediaSnapshot(bank);
  }

  if (typeof handleTourSnapshot === "function") {
    handleTourSnapshot(bank);
  }

  enforceSnapshotFileLimit("home", bank.items);
  enforceSnapshotFileLimit("distribution", bank.items);
  enforceSnapshotFileLimit("media", bank.items);
  enforceSnapshotFileLimit("social", bank.items);
  enforceSnapshotFileLimit("network", bank.items);
  enforceSnapshotFileLimit("tour", bank.items);

} catch (e) {
  console.error("Snapshot Engine Execution Error:", e);
}
}

module.exports = { run };

if (require.main === module) {
  run();
}