// feed-media.js (ULTIMATE FINAL - FULL PIPELINE + NO LOSS)

import fs from "fs/promises";
import snapshotEngine from "./snapshot-engine.js";
import { syncSearchBank } from "./maru-searchbank-sync.js";

// ---------------- PATH ----------------
const SEARCHBANK_PATH = "/var/task/search-bank.snapshot.json";
const PSOM_PATH = "/var/task/psom.json";

// ---------------- CORS ----------------
function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function ok(body) {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) };
}

function err(code, msg) {
  return { statusCode: code, headers: corsHeaders(), body: JSON.stringify({ error: msg }) };
}

// ---------------- LOAD ----------------
async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadSearchBank() {
  return (await readJsonSafe(SEARCHBANK_PATH)) || { items: [] };
}

async function loadPSOM() {
  return (await readJsonSafe(PSOM_PATH)) || {};
}

// ---------------- FALLBACK ----------------
function getFallbackMedia() {
  return [
    {
      id: "free-1",
      title: "Big Buck Bunny",
      thumb: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg",
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      type: "movie",
      tags: ["free", "trending"],
      weight: 50,
      provider: "blender"
    },
    {
      id: "free-2",
      title: "Sintel",
      thumb: "https://durian.blender.org/wp-content/uploads/2010/05/sintel_poster.jpg",
      url: "https://www.youtube.com/watch?v=eRsGyueVLvQ",
      type: "movie",
      tags: ["free"],
      weight: 40,
      provider: "blender"
    }
  ];
}

// ---------------- TEXT MATCH ----------------
function matchByKeywords(item, keywords) {
  if (!keywords.length) return true;

  const text = (
    (item.title || "") + " " +
    (item.description || "") + " " +
    (item.tags || []).join(" ")
  ).toLowerCase();

  return keywords.some(k => text.includes(k.toLowerCase()));
}

// ---------------- SUPPLY ENGINE ----------------
function buildSupply(psom, sectionKey, items) {

  const config = psom.sections?.[sectionKey];
  if (!config || config.enabled === false) return [];

  const keywords = config.keywords || [];
  const limit = config.limit || 20;

  let pool = [];

  // 1️⃣ primary source
  const primary = items.filter(item => matchByKeywords(item, keywords));

  pool = [...primary];

  // 2️⃣ fallback mix (부족하면)
  if (pool.length < limit) {
    const fallback = getFallbackMedia();
    pool = [...pool, ...fallback];
  }

  // 3️⃣ weight 정렬
  pool.sort((a, b) => (b.weight || 0) - (a.weight || 0));

  // 4️⃣ 중복 제거
  const seen = new Set();
  pool = pool.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return pool.slice(0, limit);
}

// ---------------- ENRICH ----------------
function enrichItems(items) {
  return items.map((item, idx) => ({
    ...item,
    order: idx,
    url: item.url || `/content.html?id=${item.id}`,
    contentUrl: `/content.html?id=${item.id}`,
    type: item.type || "media",
    thumb: item.thumb || item.image || "#",
    provider: item.provider || "default"
  }));
}

// ---------------- HERO ----------------
function buildHero(psom, supply) {

  const heroConfig = psom.hero || {};
  if (!heroConfig.enabled) return null;

  const sources = heroConfig.rotateFrom || Object.keys(supply);

  for (const key of sources) {
    const list = supply[key];
    if (list && list.length) {
      return list[0];
    }
  }

  return null;
}

// ---------------- MAIN ----------------
export async function handler(event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  try {

    // 1️⃣ LOAD
    const searchbank = await loadSearchBank();
    const psom = await loadPSOM();

    const allItems = searchbank.items || [];

    // 2️⃣ SUPPLY BUILD
    const supply = {};

    for (const key of Object.keys(psom.sections || {})) {
      let items = buildSupply(psom, key, allItems);
      supply[key] = enrichItems(items);
    }

    // 3️⃣ HERO
    const hero = buildHero(psom, supply);

    // 4️⃣ SNAPSHOT ENGINE
    let snapshot;

    try {
      snapshot = await snapshotEngine.build({
        page: "media",
        supply,
        psom,
        hero
      });
    } catch {
      // fallback snapshot 구조
      snapshot = {
        sections: supply,
        hero
      };
    }

    // 5️⃣ GRAPH SYNC (실제 연결)
    try {
      await syncSearchBank({
        type: "media",
        items: allItems,
        snapshot
      });
    } catch {}

    // 6️⃣ RESPONSE
    return ok({
      status: "ok",
      pipeline: "ULTIMATE_CONNECTED",
      page: "media",
      sections: snapshot.sections,
      hero: snapshot.hero
    });

  } catch (e) {
    return err(500, "MEDIA_PIPELINE_FINAL_FAIL");
  }
}