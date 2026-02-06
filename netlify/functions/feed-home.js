const fs = require("fs");
const path = require("path");

/**
 * feed.js (HOME compiler - fixed mapping)
 * - Handles: ?page=homeproducts
 * - Reads: netlify/functions/data/snapshot.internal.v1.json
 * - Compiles sections into keys expected by home automap:
 *   home_1..home_5, home_right_top/middle/bottom
 *
 * NOTE:
 * - Other pages: returns {} (non-breaking for HOME-only phase).
 * - If you have an existing multi-page feed.js, merge ONLY the homeproducts branch.
 */

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return {}; }
}

function toArr(v){ return Array.isArray(v) ? v : []; }

function normalizeItems(sec){
  if (!sec) return [];
  if (Array.isArray(sec.items)) return sec.items;
  if (Array.isArray(sec.cards)) return sec.cards;
  return [];
}

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

  const sectionsMap = snapshot?.pages?.home?.sections || {};

  for (const [key, arr] of Object.entries(sectionsMap)) {
    if (out[key] !== undefined) {
      out[key] = toArr(arr);
    }
  }

const keys = [
  "home_1","home_2","home_3","home_4","home_5",
  "home_right_top","home_right_middle","home_right_bottom"
];

  return keys.map(k => ({ id: k, items: toArr(out[k]) }));
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
        meta: { page: "homeproducts", source: "snapshot.internal.v1", compiled: true },
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
