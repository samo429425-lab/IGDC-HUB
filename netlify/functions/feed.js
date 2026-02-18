/**
 * feed.js — SINGLE SNAPSHOT CANON (v3.0)
 * ------------------------------------------------------------
 * CANON:
 *  - ONLY uses data/front.snapshot.json as the source of truth.
 *  - NO snapshot.internal.v1.json dependency (fully removed).
 *
 * COMPAT / NON-BREAKING GUARANTEES:
 *  - Keeps original "flat feed" output: { status, version, generated, count, items }
 *  - Adds/keeps automap-friendly output: { sections:[{id, items:[...]}] } when page query is used
 *  - Keeps PSOM application (enable/weight/order/lang) where item.id exists
 *  - Keeps Core hooks (safe-load) without crashing if Core.scoreItem signature differs
 *
 * NOTES:
 *  - For home automap: call /.netlify/functions/feed?page=homeproducts
 *    -> returns sections for: home_1..home_5 + home_right_top/middle/bottom
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---- CORE ENGINE HOOK (optional, safe-load) -----------------
let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

// ---- PATH RESOLUTION ----------------------------------------
const DATA_ROOT = path.join(__dirname, "data");
const FRONT_SNAPSHOT_PATH = path.join(DATA_ROOT, "front.snapshot.json");
const PSOM_PATH = path.join(DATA_ROOT, "psom.json");

// ---- UTIL ---------------------------------------------------
function safeReadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch (e) { return null; }
}

function toArr(v){ return Array.isArray(v) ? v : []; }

function pick(obj, keys){
  for (const k of keys){
    const v = obj && obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// Normalize for FEED flat stream (keep thumb/priority so other consumers can use it)
function normalizeItem(item, fallback = {}) {
  if (!item || typeof item !== "object") return null;

  return {
    // canonical identity (optional for automap seed cards)
    id: item.id || fallback.id || null,
    page: item.page || fallback.page || null,
    section: item.section || fallback.section || null,

    title: pick(item, ["title","name","label","caption"]) || "",
    category: item.category || fallback.category || null,
    type: item.type || fallback.type || "thumbnail",

    url: pick(item, ["url","href","link","path","detailUrl","productUrl","checkoutUrl"]) || "",
    thumb: pick(item, ["thumb","image","image_url","img","photo","thumbnail","thumbnailUrl","cover","coverUrl"]) || "",

    priority: (typeof item.priority === "number"
      ? item.priority
      : (Number.isFinite(Number(item.priority)) ? Number(item.priority) : null)),

    keywords: Array.isArray(item.keywords) ? item.keywords : (Array.isArray(fallback.keywords) ? fallback.keywords : []),
    weight: (typeof item.weight === "number" ? item.weight : (typeof fallback.weight === "number" ? fallback.weight : 0)),
    enabled: (item.enabled !== false) && (fallback.enabled !== false),
    order: (typeof item.order === "number" ? item.order : (typeof fallback.order === "number" ? fallback.order : 0)),
    lang: Array.isArray(item.lang) ? item.lang : (Array.isArray(fallback.lang) ? fallback.lang : []),
    version: item.version || fallback.version || "1.0",
    updated: item.updated || fallback.updated || null,
  };
}

// ---- PSOM APPLICATION ---------------------------------------
function applyPSOM(items, psom) {
  if (!Array.isArray(items) || !Array.isArray(psom)) return items;

  const map = new Map(psom.map(p => [p.id, p]));

  return items
    .map(it => {
      // If item has no id, PSOM can't target it. Keep as-is.
      if (!it || !it.id) return it;

      const rule = map.get(it.id);
      if (!rule) return it;

      return {
        ...it,
        weight: (rule.weight ?? it.weight),
        enabled: (rule.enabled ?? it.enabled),
        order: (rule.order ?? it.order),
        lang: (rule.lang ?? it.lang),
      };
    })
    .filter(it => it && it.enabled !== false);
}

// ---- CORE SCORING (OPTIONAL / SAFE) -------------------------
function safeCoreScoreItem(it){
  if (!Core || typeof Core.scoreItem !== "function") return 0;

  // Support both signatures:
  //  A) scoreItem(item)
  //  B) scoreItem(query, item)  (core.js in repo)
  try {
    const v = Core.scoreItem(it);
    return Number.isFinite(Number(v)) ? Number(v) : 0;
  } catch (e) {
    try {
      const v2 = Core.scoreItem("", it);
      return Number.isFinite(Number(v2)) ? Number(v2) : 0;
    } catch (e2) {
      return 0;
    }
  }
}

function applyCoreScore(items) {
  if (!Core || typeof Core.scoreItem !== "function") return items;
  return items.map(it => ({ ...it, _score: safeCoreScoreItem(it) }));
}

// ---- SECTIONS BUILDERS --------------------------------------
function buildHomeSectionsFromPagesSnapshot(snap){
  const sectionsMap = snap?.pages?.home?.sections;
  if (!sectionsMap || typeof sectionsMap !== "object") return null;

  const keys = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  return keys.map(id => ({
    id,
    items: toArr(sectionsMap[id]).map(x => normalizeItem(x, { section: id, page: "home" })).filter(Boolean)
  }));
}


function buildDistributionSectionsFromPagesSnapshot(snap){
  const sectionsMap = snap?.pages?.distribution?.sections;
  if (!sectionsMap || typeof sectionsMap !== "object") return null;

  // 6 main sections (100 each) + 1 right panel (80)
  const keys = ["dist_1","dist_2","dist_3","dist_4","dist_5","dist_6","dist_right"];

  return keys.map(id => {
    const limit = (id === "dist_right") ? 80 : 100;
    const arr = toArr(sectionsMap[id]).slice(0, limit);
    return {
      id,
      items: arr.map(x => normalizeItem(x, { section: id, page: "distribution" })).filter(Boolean)
    };
  });
}


// Placeholder for future expansion (distribution/social/media/...)
function buildSectionsForPageQuery(pageQuery, snap){
  const p = String(pageQuery || "").toLowerCase();
  if (p === "homeproducts") return buildHomeSectionsFromPagesSnapshot(snap);
  if (p === "distribution") return buildDistributionSectionsFromPagesSnapshot(snap);
  return null; // expand-only
}

// ---- MAIN COMPILER ------------------------------------------
function compileFlatItems(snap, psom) {
  let items = [];

  // canonical object snapshot (pages.*.*)
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    // optional flat list under snap.items (expand-only)
    if (Array.isArray(snap.items)) {
      items.push(...snap.items.map(x => normalizeItem(x)).filter(Boolean));
    }

    // pages -> sections -> items
    const pages = (snap.pages && typeof snap.pages === "object") ? snap.pages : null;
    if (pages) {
	if (pageQuery && pageName !== pageQuery) continue;
      for (const [pageName, pageObj] of Object.entries(pages)) {
        const sections = (pageObj && pageObj.sections && typeof pageObj.sections === "object") ? pageObj.sections : null;
        if (!sections) continue;

        for (const [sectionId, arr] of Object.entries(sections)) {
          const norm = toArr(arr).map(x => normalizeItem(x, { page: pageName, section: sectionId })).filter(Boolean);
          items.push(...norm);
        }
      }
    }
  }

  // legacy snapshot as array
  if (Array.isArray(snap)) {
    items = snap.map(x => normalizeItem(x)).filter(Boolean);
  }

  items = applyPSOM(items, psom);
  items = applyCoreScore(items);

  // Sort priority: score > weight > order > priority
  items.sort((a, b) => {
    const sa = a._score || 0;
    const sb = b._score || 0;
    if (sb !== sa) return sb - sa;
    if ((b.weight || 0) !== (a.weight || 0)) return (b.weight || 0) - (a.weight || 0);
    if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
    const pa = (a.priority == null ? 999999 : a.priority);
    const pb = (b.priority == null ? 999999 : b.priority);
    return pa - pb;
  });

  return items;
}

// ---- NETLIFY HANDLER ----------------------------------------
exports.handler = async function (event) {
  try {
    const qs = (event && event.queryStringParameters) || {};
    const pageQuery = qs.page || qs.p || "";

    const snap = safeReadJSON(FRONT_SNAPSHOT_PATH) || {};
    const psom = safeReadJSON(PSOM_PATH) || [];

    const items = compileFlatItems(snap, psom);

    // sections only when page query is provided & supported
    const sections = pageQuery ? (buildSectionsForPageQuery(pageQuery, snap) || []) : [];

    const body = {
      status: "ok",
      version: "feed.v3.single-snapshot",
      generated: new Date().toISOString(),
      count: items.length,
      items
    };

    if (pageQuery) {
      body.meta = { page: String(pageQuery), source: "front.snapshot.json" };
      body.sections = sections;
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(body)
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: "fail", message: String((e && e.message) || e) })
    };
  }
};

// ---- INTERNAL CALL (ENGINE / INSIGHT) -----------------------
exports.compileFeed = function(){
  const snap = safeReadJSON(FRONT_SNAPSHOT_PATH) || {};
  const psom = safeReadJSON(PSOM_PATH) || [];
  const items = compileFlatItems(snap, psom);
  return {
    status: "ok",
    version: "feed.v3.single-snapshot",
    generated: new Date().toISOString(),
    count: items.length,
    items
  };
};
