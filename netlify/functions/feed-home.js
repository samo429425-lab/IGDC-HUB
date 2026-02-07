const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ================================
// Normalize V2 (충돌 없는 표준화 엔진)
// ================================

function normalizeItemV2(item = {}) {
  if (!item || typeof item !== "object") return null;

  // 링크만 최소 필수
  const link =
    item.link ||
    item.url ||
    item.href ||
    item.permalink ||
    "";

  if (!link) return null; // 이것만 필터 기준

  return {
    // 기본 ID
    id:
      item.id ||
      item._id ||
      item.uuid ||
      crypto.randomUUID(),

    // 제목 자동 매핑
    title:
      item.title ||
      item.name ||
      item.subject ||
      item.label ||
      "",

    // 이미지 자동 매핑
    thumb:
      item.thumb ||
      item.image ||
      item.img ||
      item.thumbnail ||
      item.cover ||
      "",

    // 링크
    link,

    // 가격 (상품 대응)
    price:
      item.price ||
      item.cost ||
      item.amount ||
      null,

    // 출처
    source:
      item.source ||
      item.site ||
      item.provider ||
      "snapshot",

    // 타입/카테고리
    type:
      item.type ||
      item.category ||
      item.kind ||
      "general",

    // 기타 메타
    meta: item.meta || {},

    // 원본 백업 (디버그용)
    _raw: item
  };
}


function normalizeItemsV2(arr = []) {
  if (!Array.isArray(arr)) return [];

  return arr
    .map(normalizeItemV2)
    .filter(Boolean);
}

/**
 * feed.js (HOME compiler - fixed mapping)
 * - Handles: ?page=homeproducts
 * - Reads: netlify/functions/data/front.snapshot.json
 * - Compiles sections into keys expected by home automap:
 *   home_1..home_5, home_right_top/middle/bottom
 *
 * NOTE:
 * - Other pages: returns {} (non-breaking for HOME-only phase).
 * - If you have an existing multi-page feed.js, merge ONLY the homeproducts branch.
 */

const SNAPSHOT_PATH = path.join(__dirname, "data", "front.snapshot.json");

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return {}; }
}

function toArr(v){ return Array.isArray(v) ? v : []; }


// Map snapshot section ids (meta.category) -> home keys (data-psom-key)
const ID_MAP = {
  "home-shop-1": "home_1",
  "home-shop-2": "home_2",
  "home-shop-3": "home_3",
  "home-shop-4": "home_4",
  "home-shop-5": "home_5",
  "home-right-top": "home_right_top",
  "home-right-middle": "home_right_middle",
  "home-right-bottom": "home_right_bottom"
};

function compileHome(snapshot){

  const out = {
    home_1: [], home_2: [], home_3: [], home_4: [], home_5: [],
    home_right_top: [], home_right_middle: [], home_right_bottom: []
  };

  // ✅ 실제 snapshot 구조 기준
  const secs = Array.isArray(snapshot.sections)
    ? snapshot.sections
    : [];

  for (const sec of secs){

    const sid = String(
      sec.id || sec.sectionId || ""
    ).trim();

    if (!sid) continue;

    if (out[sid] !== undefined){

      const items =
        sec.items ||
        sec.cards ||
        [];

      out[sid] = normalizeItemsV2(items);
    }
  }

  const keys = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  return keys.map(k => ({
    id: k,
    items: out[k]
  }));
}


exports.handler = async function(event){
  const qs = event.queryStringParameters || {};
  const page = String(qs.page || "").toLowerCase();

  if (page === "homeproducts"){
    const snapshot = readJsonSafe(SNAPSHOT_PATH);
    const sections = compileHome(snapshot);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        meta: { page: "homeproducts", source: "front.snapshot.json", compiled: true },
        sections
      })
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({})
  };
};
