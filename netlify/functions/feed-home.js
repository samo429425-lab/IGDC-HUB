/**
 * feed.js — HOME FEED (v2, SAFE)
 * ------------------------------------------------------------
 * Purpose:
 *  - Provide Home Products automap payload (payload.sections[]).
 *  - Source of truth: Search Bank snapshot (data/search-bank.snapshot.json).
 *  - FAIL-SAFE: if bank missing/invalid OR would generate empty -> return 500 (never "0 sections").
 *
 * Notes:
 *  - This function DOES NOT write any snapshot file. It only returns JSON.
 *  - Bank snapshot is expected to exist in BOTH places in your repo:
 *      1) /data/search-bank.snapshot.json
 *      2) /functions/data/search-bank.snapshot.json
 *    (We try both, in that order.)
 */
"use strict";

const fs = require("fs");
const path = require("path");

// ---- PATHS (try both) ------------------------------------------
const BANK_SNAPSHOT_CANDIDATES = [
  path.join(process.cwd(), "data", "search-bank.snapshot.json"),
  path.join(process.cwd(), "functions", "data", "search-bank.snapshot.json"),
];

// ---- UTIL ------------------------------------------------------
function safeReadJSON(p){
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch (e) { return null; }
}
function readFirstJSON(paths){
  for (const p of paths){
    const obj = safeReadJSON(p);
    if (obj) return { obj, path: p };
  }
  return { obj: null, path: paths[0] || "" };
}
function pick(obj, keys){
  for (const k of keys){
    const v = obj && obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
function toThumb(it){
  return pick(it, ["thumb","thumbnail","thumbnailUrl","image","image_url","img","photo","cover","coverUrl","poster"]);
}
function toUrl(it){
  return pick(it, ["checkoutUrl","productUrl","url","href","link","path","detailUrl"]) || "#";
}
function toTitle(it){
  return pick(it, ["title","name","label","caption","text"]) || "Item";
}
function sourceName(it){
  const s = (it && typeof it.source === "object") ? it.source : {};
  return pick(s, ["platform","name"]) || pick(it, ["source","provider","site"]) || "";
}
function bankItemToHome(it, sectionKey, idx){
  return {
    id: it.id || `home-${sectionKey}-${idx+1}`,
    title: toTitle(it),
    url: toUrl(it),
    thumb: toThumb(it) || "", // Home MAIN may require thumb; RIGHT can be empty but try
    source: sourceName(it),
    channel: it.channel || null,
    type: it.type || null,
    priority: idx + 1,
    bank_ref: it.id || null,
    ingested_at: it.ingested_at || null,
  };
}
function jsonResponse(statusCode, obj){
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(obj, null, 2)
  };
}

// ---- BUILDERS ---------------------------------------------------
function buildHomePayloadFromBank(bank){
  const now = new Date().toISOString();
  const items = Array.isArray(bank && bank.items) ? bank.items : [];

  // Home HTML / automap keys
  const SECTION_KEYS = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  // If bank empty, this is a hard failure (do NOT return empty sections).
  if (!items.length){
    return { error: true, message: "Bank snapshot has 0 items" };
  }

  // Fill each section by cycling bank items (seed-safe).
  function fill(sectionKey, n){
    const out = [];
    for (let i=0; i<n; i++){
      const it = items[i % items.length];
      out.push(bankItemToHome(it, sectionKey, i));
    }
    return out;
  }

  // Reasonable defaults:
  // - MAIN shows larger cards: 60 items is plenty (incremental load handles more)
  // - RIGHT panel: 80 items max
  const sections = SECTION_KEYS.map(id => {
    const isRight = id.indexOf("home_right_") === 0;
    const n = isRight ? 80 : 60;
    return { id, items: fill(id, n) };
  });

  // Fail-safe: if something went wrong and sections are empty, fail.
  const nonEmpty = sections.some(s => Array.isArray(s.items) && s.items.length);
  if (!nonEmpty){
    return { error: true, message: "Generated 0 items (blocked)" };
  }

  return {
    meta: {
      snapshot_id: `home.feed.v2.bank.${now}`,
      generated_at: now,
      source: "search-bank.snapshot.json",
      schema: "home.feed.v2",
      notes: [
        "Home feed payload for home-products-automap.v2.js",
        "FAIL-SAFE enabled: never returns empty sections on bank failure"
      ]
    },
    sections
  };
}

// ---- NETLIFY HANDLER -------------------------------------------
exports.handler = async function(event){
  try{
    const qs = (event && event.queryStringParameters) || {};
    const page = String(qs.page || qs.p || "").toLowerCase();

    // Only serve the endpoint used by home-products-automap
    if (page && page !== "homeproducts"){
      return jsonResponse(400, { status:"error", message:`Unsupported page="${page}" (expected "homeproducts")` });
    }

    const { obj: bank, path: bankPath } = readFirstJSON(BANK_SNAPSHOT_CANDIDATES);
    if (!bank){
      return jsonResponse(500, { status:"error", message:"Missing or invalid bank snapshot", tried: BANK_SNAPSHOT_CANDIDATES, first: bankPath });
    }

    const payload = buildHomePayloadFromBank(bank);
    if (payload && payload.error){
      return jsonResponse(500, { status:"error", message: payload.message, bank_path: bankPath });
    }

    return jsonResponse(200, payload);
  }catch(e){
    return jsonResponse(500, { status:"error", message: String(e && e.message ? e.message : e) });
  }
};
