
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
  
/* ===== FRONT SNAPSHOT MERGE (feed.js 통합 1차) ===== */

function mergeFrontFromSearchBank(frontSnap, searchbankSnap) {

  if (!frontSnap.pages) frontSnap.pages = {};
  if (!searchbankSnap || !searchbankSnap.pages) return frontSnap;

  for (const [page, pageObj] of Object.entries(searchbankSnap.pages)) {

    if (!frontSnap.pages[page]) {
      frontSnap.pages[page] = { sections: {} };
    }

    const targetSections = frontSnap.pages[page].sections || {};
    const sourceSections = pageObj.sections || {};

    for (const [section, items] of Object.entries(sourceSections)) {

      if (!targetSections[section]) targetSections[section] = [];

      const existing = targetSections[section];
      const map = new Map();

      [...existing, ...(Array.isArray(items) ? items : [])].forEach(item => {
        const key = item && (item.id || stableId(JSON.stringify(item)));
        if (key) map.set(key, item);
      });

      targetSections[section] = Array.from(map.values());
    }

    frontSnap.pages[page].sections = targetSections;
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

/* ===== DISTRIBUTION SNAPSHOT MERGE ===== */

function handleDistributionSnapshot(bank) {

  const fileName = "distribution.snapshot.json";
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

/* ===== SOCIAL SNAPSHOT ENGINE (FINAL) ===== */

function handleSocialSnapshot(bank) {

  const fileName = "social.snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = bank.items || [];

  const sectionKeys = Object.keys(snapshot.sections || {});

  function isSocial(item){
    return (
      item.channel ||
      item.platform ||
      item.source ||
      item.type === "social"
    );
  }

  function detectSection(item){

    const text = (
      item.channel ||
      item.platform ||
      item.source ||
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

  for (const sectionKey of sectionKeys) {

    const existing = snapshot.sections[sectionKey] || [];
    const existingIds = new Set(existing.map(i => i.id));

    let count = existing.length;

    const supply = bankItems.filter(item => {

      if (!isSocial(item)) return false;

      const sec = detectSection(item);

      // 🔴 정확 매칭
      if (sec === sectionKey) return true;

      // 🔴 fallback (all 섹션)
      if (!sec && sectionKey === "all") return true;

      return false;
    });

    for (const item of supply) {

      const id = item.id || stableId(JSON.stringify(item));
      if (existingIds.has(id)) continue;

      const converted = {
        id,

        // 🔴 핵심: 썸네일 그대로 사용
        thumb:
          item.thumbnail ||
          item.thumb ||
          item.image ||
          (item.payload && item.payload.thumbnail) ||
          "/assets/img/placeholder.png",

        title: item.title || item.name || "",
        summary: item.summary || "",

        url: item.url || item.link || "#",

        channel: item.channel || item.platform || "",
        duration: item.duration || "",
        views: item.viewCount || item.views || 0,

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

/* ===== MEDIA SNAPSHOT ENGINE (IGDC REBUILD + FEED INTEGRATION) ===== */

function handleMediaSnapshot(bank) {

  const fileName = "media.snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = bank.items || [];

  const sectionKeys = Object.keys(snapshot.sections || {});

  /* ===== MEDIA FILTER ===== */
  function isMedia(item){
    return (
      item.mediaType ||
      item.type === "media" ||
      item.type === "video" ||
      item.type === "image" ||
      item.type === "article" ||
      item.type === "news"
    );
  }

  /* ===== SECTION DETECT ===== */
  function detectSection(item){

    const text = (
      item.mediaType ||
      item.type ||
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

  /* ===== IGDC THUMBNAIL BUILDER (핵심) ===== */
  function buildIGDCThumbnail(item){

    const title = encodeURIComponent(item.title || "IGDC");
    const url = String(item.url || item.link || "");

    // 🔴 1. 유튜브 → 프레임 기반
    const ytMatch = url.match(/(?:v=|youtu\.be\/)([^&]+)/);
    if (ytMatch) {
      const vid = ytMatch[1];
      return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
    }

    // 🔴 2. 이미지 → 그대로
    if (item.type === "image") {
      return item.url;
    }

    // 🔴 3. 기사/뉴스 → IGDC 생성 썸네일
    if (item.type === "article" || item.type === "news") {
      return `https://dummyimage.com/600x400/111/fff&text=${title}`;
    }

    // 🔴 4. 일반 영상 → IGDC 생성
    if (item.type === "video") {
      return `https://dummyimage.com/600x400/000/fff&text=VIDEO`;
    }

    // 🔴 5. fallback
    return `https://dummyimage.com/600x400/222/fff&text=IGDC`;
  }

  /* ===== MAIN LOOP ===== */
  for (const sectionKey of sectionKeys) {

    const existing = snapshot.sections[sectionKey] || [];
    const existingIds = new Set(existing.map(i => i.id));

    let count = existing.length;

    /* ===== FEED 역할 (여기서 수행됨) ===== */
    const supply = bankItems.filter(item => {

      if (!isMedia(item)) return false;

      const sec = detectSection(item);

      if (sec === sectionKey) return true;
      if (!sec && sectionKey === "all") return true;

      return false;
    });

    for (const item of supply) {

      const id = item.id || stableId(JSON.stringify(item));
      if (existingIds.has(id)) continue;

      /* ===== IGDC 콘텐츠 카드 생성 ===== */
      const converted = {
        id,

        // 🔴 핵심: IGDC 재생성 썸네일
        thumb: buildIGDCThumbnail(item),

        title: item.title || item.name || "",
        summary: item.summary || "",

        url: item.url || item.link || "#",

        mediaType: item.mediaType || item.type || "",
        duration: item.duration || "",
        views: item.viewCount || item.views || 0,

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

/* ===== DONATION SNAPSHOT ENGINE (FEED INTEGRATION) ===== */

function handleDonationSnapshot(bank) {

  const fileName = "donation.snapshot.json";
  const filePath = path.join(ROOT, fileName);

  if (!fs.existsSync(filePath)) return;

  const snapshot = readJson(filePath) || {};
  const bankItems = bank.items || [];

  const sectionKeys = Object.keys(snapshot.sections || {});

  /* ===== DONATION FILTER ===== */
  function isDonation(item){
    return (
      item.type === "donation" ||
      item.category === "donation" ||
      item.ngo ||
      item.charity ||
      item.fundraising
    );
  }

  /* ===== SECTION DETECT ===== */
  function detectSection(item){

    const text = (
      item.category ||
      item.type ||
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

  /* ===== DONATION CARD THUMB ===== */
  function buildDonationThumbnail(item){

    // 1️⃣ 기존 이미지 있으면 사용
    if (item.image || item.thumb || item.thumbnail) {
      return item.image || item.thumb || item.thumbnail;
    }

    const title = encodeURIComponent(item.title || "DONATION");

    // 2️⃣ NGO/기부 카드 생성
    if (item.ngo || item.charity) {
      return `https://dummyimage.com/600x400/2ecc71/ffffff&text=${title}`;
    }

    // 3️⃣ 뉴스형 (글로벌 뉴스 등)
    if (item.type === "article" || item.type === "news") {
      return `https://dummyimage.com/600x400/27ae60/ffffff&text=NEWS`;
    }

    // 4️⃣ fallback
    return `https://dummyimage.com/600x400/16a085/ffffff&text=DONATION`;
  }

  /* ===== MAIN LOOP ===== */
  for (const sectionKey of sectionKeys) {

    const existing = snapshot.sections[sectionKey] || [];
    const existingIds = new Set(existing.map(i => i.id));

    let count = existing.length;

    /* ===== FEED 흡수 ===== */
    const supply = bankItems.filter(item => {

      if (!isDonation(item)) return false;

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

        // 🔴 썸네일 생성
        thumb: buildDonationThumbnail(item),

        title: item.title || item.name || "",
        summary: item.summary || "",

        url: item.url || item.link || "#",

        // 🔴 도네이션 특화 필드
        organization: item.organization || item.ngo || "",
        goal: item.goal || "",
        raised: item.raised || "",
        progress: item.progress || 0,

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

} catch (e) {
  console.error("Snapshot Engine Execution Error:", e);
}


module.exports = { run };

if (require.main === module) {
  run();
}