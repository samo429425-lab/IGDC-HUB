
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

  /* collector items 저장 */
  if(payload && Array.isArray(payload.items)){
    for(const item of payload.items){
      bank.items.push(item);
    }
    writeJson(bankPath, bank);
  }

  const pages = Object.keys(SNAPSHOT_FILES);

  for (const page of pages) {

    const snapshot = loadSnapshot(page);
    if (!snapshot) continue;

 const bankItems = bank.items || [];

// 👉 snapshot section 목록
const sectionKeys = Object.keys(snapshot.sections || {});

// 👉 section별 slot-fill
for (const sectionKey of sectionKeys) {

  const slotLimit = getSlotLimit(snapshot, sectionKey);

  const existing = snapshot.sections[sectionKey] || [];
  const existingIds = new Set(existing.map(i => i.id));

  let count = existing.length;

  // 👉 해당 section에 맞는 데이터만 공급
  const supply = bankItems.filter(item => {
    const sec = resolveSection(item, sectionKey);
    return sec === sectionKey;
  });

  for (const item of supply) {

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
}

// 👉 저장
const filePath = path.join(ROOT, SNAPSHOT_FILES[page]);
writeJson(filePath, snapshot);

  } // ← for (const page of pages)

  console.log("Snapshot Engine vNext completed successfully.");
}

module.exports = { run };

if (require.main === module) {
  run();
}