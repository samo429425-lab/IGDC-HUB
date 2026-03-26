
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
  donation: "donation.snapshot.json"
};

const LIMIT_MAP = {
  home: 740,
  distribution: 700,
  donation: 800,
  media: 500,
  social: 1000,
  network: 80,
  tour: 80,
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

    const sectionKey =
      item?.bind?.section ||
      item?.psom_key ||
      item?.category;

    if (!sectionKey) continue;
    if (!homeSections[sectionKey]) continue;

    const existing = homeSections[sectionKey];
    const id = item.id || JSON.stringify(item);

    if (existing.find(i => i.id === id)) continue;

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

/* ===== NETWORK SNAPSHOT MERGE ===== */

function handleNetworkSnapshot(bank) {

  const fileName = "networkhub-snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = bank.items || [];

  const sectionKeys = Object.keys(snapshot.sections || {});

  for (const sectionKey of sectionKeys) {

    const existing = snapshot.sections[sectionKey] || [];
    const existingIds = new Set(existing.map(i => i.id));
    let count = existing.length;

    const supply = bankItems.filter(item => {
      const sec = item.psom_key || item.category;
      return sec === sectionKey;
    });

    for (const item of supply) {

      if (existingIds.has(item.id)) continue;

      const id = item.id || stableId(JSON.stringify(item));

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

  const sections = snapshot.pages.distribution.sections;

  const SECTION_KEYS = [
    "distribution-recommend",
    "distribution-new",
    "distribution-trending",
    "distribution-special",
    "distribution-sponsor",
    "distribution-others",
    "distribution-right"
  ];

  SECTION_KEYS.forEach(key => {
    if (!Array.isArray(sections[key])) sections[key] = [];
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

    // 1) PSOM 우선
    if (item.psom_key && sections[item.psom_key]) {
      pushUnique(item.psom_key, [raw]);
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
    return item && (item.sponsor === true || item.priority >= 0.8 || item.score >= 0.8);
  });

  pushUnique("distribution-right", rightPool, 80);

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
  const bankItems = bank.items || [];

  // 🔥 pages 구조 보장
  if (!snapshot.pages) snapshot.pages = {};
  if (!snapshot.pages.media) snapshot.pages.media = { sections: {} };
  if (!snapshot.pages.media.sections) snapshot.pages.media.sections = {};

  const sections = snapshot.pages.media.sections;
  const sectionKeys = Object.keys(sections);

  // 🔥 전체 영상 풀
  const videoPool = bankItems.filter(item => {
    return (
      item.type === "video" ||
      item.mediaType === "video" ||
      item.videoUrl ||
      (item.url && item.url.includes("youtu")) ||
      (item.url && item.url.includes("vimeo"))
    );
  });

  // 🔥 최신 정렬
  videoPool.sort((a, b) => {
    return (b.timestamp || b.date || 0) - (a.timestamp || a.date || 0);
  });

  for (const sectionKey of sectionKeys) {

    const existing = sections[sectionKey] || [];
    const existingIds = new Set(existing.map(i => i.id));

    // =========================
    // 🔥 1️⃣ MAIN (최신 섹션)
    // =========================
    if (sectionKey === "main") {

      const supply = videoPool.slice(0, 30);

      for (const item of supply) {

        const id = item.id || stableId(JSON.stringify(item));
        if (existingIds.has(id)) continue;

        const videoUrl =
          item.videoUrl ||
          item.url ||
          item.link ||
          "#";

        const thumb =
          item.thumbnail ||
          item.thumb ||
          item.image ||
          (videoUrl.includes("youtu")
            ? `https://img.youtube.com/vi/${extractYouTubeId(videoUrl)}/hqdefault.jpg`
            : "/assets/img/placeholder.png");

        existing.push({
          id,
          title: item.title || item.name || "Untitled",
          summary: item.summary || "",
          url: videoUrl,
          thumb,
          priority: item.priority || item.score || 0
        });

        existingIds.add(id);
      }

      sections[sectionKey] = existing;
      continue;
    }

    // =========================
    // 🔥 2️⃣ 일반 섹션 (카테고리별)
    // =========================
    const supply = videoPool.filter(item => {

      const sec =
        item?.bind?.section ||
        item?.psom_key ||
        item?.category;

      return sec === sectionKey;
    });

    for (const item of supply) {

      const id = item.id || stableId(JSON.stringify(item));
      if (existingIds.has(id)) continue;

      const videoUrl =
        item.videoUrl ||
        item.url ||
        item.link ||
        "#";

      const thumb =
        item.thumbnail ||
        item.thumb ||
        item.image ||
        (videoUrl.includes("youtu")
          ? `https://img.youtube.com/vi/${extractYouTubeId(videoUrl)}/hqdefault.jpg`
          : "/assets/img/placeholder.png");

      existing.push({
        id,
        title: item.title || item.name || "Untitled",
        summary: item.summary || "",
        url: videoUrl,
        thumb,
        priority: item.priority || item.score || 0
      });

      existingIds.add(id);
    }

    sections[sectionKey] = existing;
  }

  snapshot.pages.media.sections = sections;

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
  const bankItems = bank.items || [];

  const sectionKeys = Object.keys(snapshot.sections || {});

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

  /* ===== SECTION DETECT ===== */
  function detectSection(item){

    const text = (
      item.region ||
      item.location ||
      item.category ||
      item.title ||
      ""
    ).toLowerCase();

    for (const key of sectionKeys) {
      if (text.includes(key.toLowerCase())) {
        return key;
      }
    }

    return null;
  }

  /* ===== TOUR CARD THUMB ===== */
  function buildTourThumbnail(item){

    // 1. 이미지 있으면 그대로
    if (item.image || item.thumb || item.thumbnail) {
      return item.image || item.thumb || item.thumbnail;
    }

    const title = encodeURIComponent(item.title || "TOUR");

    // 2. 지역 기반 썸네일 생성
    if (item.location || item.region) {
      return `https://dummyimage.com/600x400/0a3d62/ffffff&text=${title}`;
    }

    // 3. fallback
    return `https://dummyimage.com/600x400/1e3799/ffffff&text=TOUR`;
  }

  /* ===== MAIN LOOP ===== */
  for (const sectionKey of sectionKeys) {

    const existing = snapshot.sections[sectionKey] || [];
    const existingIds = new Set(existing.map(i => i.id));

    let count = existing.length;

    /* ===== FEED 흡수 ===== */
    const supply = bankItems.filter(item => {

      if (!isTour(item)) return false;

      const sec = detectSection(item);

      if (sec === sectionKey) return true;
      if (!sec && sectionKey === "all") return true;

      return false;
    });

    for (const item of supply) {

      const id = item.id || stableId(JSON.stringify(item));
      if (existingIds.has(id)) continue;

      const converted = {
        id,

        // 🔴 투어 카드 이미지
        thumb: buildTourThumbnail(item),

        title: item.title || item.name || "",
        summary: item.summary || "",

        url: item.url || item.link || "#",

        location: item.location || item.region || "",
        price: item.price || "",
        rating: item.rating || 0,

        priority: item.priority || item.score || 0
      };

      existing.push(converted);
      existingIds.add(id);
      count++;
    }

    snapshot.sections[sectionKey] = existing;
  }

  writeJson(filePath, snapshot);
}

function handleDonationSnapshot(bank) {

  const fileName = "donation.snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = bank.items || [];

  // 구조 보장
  if (!snapshot.pages) snapshot.pages = {};
  if (!snapshot.pages.donation) snapshot.pages.donation = { sections: {} };
  if (!snapshot.pages.donation.sections) snapshot.pages.donation.sections = {};

  const sections = snapshot.pages.donation.sections;

  // =========================
  // 🔥 공통 유틸
  // =========================

  function normalizeItem(item) {
    return {
      id: item.id || stableId(JSON.stringify(item)),
      title: item.title || item.name || "Untitled",
      summary: item.summary || "",
      url: item.url || item.link || "#",
      thumb:
        item.thumbnail ||
        item.image ||
        "/assets/img/placeholder.png",
      priority: item.priority || item.score || 0,

      // 🔥 도네이션 확장 필드
      orgName: item.orgName || item.source || "",
      donationType: item.donationType || "general",
      region: item.region || "",
      urgencyLevel: item.urgencyLevel || "mid",
      verified: item.verified || false
    };
  }

  function pushUnique(sectionKey, items) {
    if (!sections[sectionKey]) sections[sectionKey] = [];

    const existing = sections[sectionKey];
    const existingIds = new Set(existing.map(i => i.id));

    for (const item of items) {
      const normalized = normalizeItem(item);
      if (existingIds.has(normalized.id)) continue;

      existing.push(normalized);
      existingIds.add(normalized.id);
    }
  }

  function textOf(item) {
    return ((item.title || "") + " " + (item.summary || "")).toLowerCase();
  }

  // =========================
  // 🔥 1️⃣ GLOBAL NEWS
  // =========================

  const newsPool = bankItems.filter(item => {
    const text = textOf(item);

    const keywords = [
      "earthquake","tsunami","flood","wildfire",
      "disaster","emergency","relief","aid",
      "famine","refugee","war","conflict",
      "crisis","climate","pandemic","outbreak",
      "humanitarian","ngo","charity","donation",
      "지진","홍수","산불","재난","구호",
      "기근","난민","전쟁","분쟁","위기",
      "기후","전염병","기부","봉사"
    ];

    const isGlobal = keywords.some(k => text.includes(k));

    const isNews =
      item.type === "news" ||
      item.mediaType === "article";

    return isGlobal && isNews;
  });

  newsPool.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));

  pushUnique("global-news", newsPool.slice(0, 30));

  // =========================
  // 🔥 2️⃣ EMERGENCY (긴급 구호)
  // =========================

  const emergencyPool = bankItems.filter(item => {
    const text = textOf(item);

    return (
      text.includes("emergency") ||
      text.includes("urgent") ||
      text.includes("relief") ||
      text.includes("긴급") ||
      text.includes("구호")
    );
  });

  pushUnique("emergency", emergencyPool.slice(0, 40));

  // =========================
  // 🔥 3️⃣ CAMPAIGN
  // =========================

  const campaignPool = bankItems.filter(item => {
    const text = textOf(item);

    return (
      text.includes("campaign") ||
      text.includes("fundraising") ||
      text.includes("모금") ||
      text.includes("캠페인")
    );
  });

  pushUnique("campaign", campaignPool.slice(0, 40));

  // =========================
  // 🔥 4️⃣ NGO / 기관
  // =========================

  const ngoPool = bankItems.filter(item => {
    const text = textOf(item);

    return (
      text.includes("ngo") ||
      text.includes("foundation") ||
      text.includes("charity") ||
      text.includes("비영리") ||
      text.includes("재단")
    );
  });

  pushUnique("ngo", ngoPool.slice(0, 40));

  // =========================
  // 🔥 기존 정적 링크 보호
  // =========================
  // 👉 이미 snapshot에 있는 기관/링크 절대 삭제 안 됨

  snapshot.pages.donation.sections = sections;

  writeJson(filePath, snapshot);
}

  /* collector items 저장 */
  if(payload && Array.isArray(payload.items)){
    for(const item of payload.items){
      bank.items.push(item);
    }
    writeJson(bankPath, bank);
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

  if (typeof handleDonationSnapshot === "function") {
    handleDonationSnapshot(bank);
  }

  enforceSnapshotFileLimit("home", bank.items);
  enforceSnapshotFileLimit("distribution", bank.items);
  enforceSnapshotFileLimit("donation", bank.items);
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