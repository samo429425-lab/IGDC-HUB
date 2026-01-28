
/**
 * feed.js — MARU FUTURE FEED ENGINE (v2.0)
 * ------------------------------------------------------------
 * ROLE:
 * - Unified feed compiler for MARU Platform
 * - Primary inputs:
 *    1) front.snapshot.json
 *    2) page-level JSONs (future extension)
 *    3) psom.json (priority / weighting / enable control)
 * - Secondary linkage:
 *    - core.js (validation / scoring hooks)
 *    - maru-global-insight-engine (indirect caller)
 *
 * PRINCIPLES:
 * - No dependency on snapshot.internal.v1.json
 * - Forward-compatible, non-breaking
 * - Expand-only architecture
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---- CORE ENGINE HOOK (optional, safe-load) -----------------
let Core = null;
try {
  Core = require("./core");
} catch (e) {
  Core = null;
}

// ---- PATH RESOLUTION ----------------------------------------
const DATA_ROOT = path.join(__dirname, "data");

const FRONT_SNAPSHOT_PATH = path.join(DATA_ROOT, "front.snapshot.json");
const PSOM_PATH = path.join(DATA_ROOT, "psom.json");

// ---- UTIL ---------------------------------------------------
function safeReadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    return null;
  }
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id,
    page: item.page,
    section: item.section,
    title: item.title,
    category: item.category,
    type: item.type || "thumbnail",
    url: item.url,
    keywords: item.keywords || [],
    weight: item.weight || 0,
    enabled: item.enabled !== false,
    order: item.order || 0,
    lang: item.lang || [],
    version: item.version || "1.0",
    updated: item.updated || null,
  };
}

// ---- PSOM APPLICATION ---------------------------------------
function applyPSOM(items, psom) {
  if (!Array.isArray(items) || !Array.isArray(psom)) return items;

  const map = new Map(psom.map(p => [p.id, p]));

  return items
    .map(it => {
      const rule = map.get(it.id);
      if (!rule) return it;

      return {
        ...it,
        weight: rule.weight ?? it.weight,
        enabled: rule.enabled ?? it.enabled,
        order: rule.order ?? it.order,
        lang: rule.lang ?? it.lang,
      };
    })
    .filter(it => it.enabled !== false);
}

// ---- CORE SCORING (OPTIONAL) --------------------------------
function applyCoreScore(items) {
  if (!Core || typeof Core.scoreItem !== "function") return items;
  return items.map(it => ({
    ...it,
    _score: Core.scoreItem(it),
  }));
}

// ---- MAIN COMPILER ------------------------------------------
function compileFeed() {
  const frontSnapshot = safeReadJSON(FRONT_SNAPSHOT_PATH) || [];
  const psom = safeReadJSON(PSOM_PATH) || [];

  let items = Array.isArray(frontSnapshot)
    ? frontSnapshot.map(normalizeItem).filter(Boolean)
    : [];

  items = applyPSOM(items, psom);
  items = applyCoreScore(items);

  // Sort priority: score > weight > order
  items.sort((a, b) => {
    const sa = a._score || 0;
    const sb = b._score || 0;
    if (sb !== sa) return sb - sa;
    if ((b.weight || 0) !== (a.weight || 0)) return (b.weight || 0) - (a.weight || 0);
    return (a.order || 0) - (b.order || 0);
  });

  return {
    status: "ok",
    version: "feed.v2",
    generated: new Date().toISOString(),
    count: items.length,
    items,
  };
}

// ---- NETLIFY HANDLER ----------------------------------------
exports.handler = async function () {
  try {
    const data = compileFeed();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: "fail", message: e.message }),
    };
  }
};

// ---- INTERNAL CALL (ENGINE / INSIGHT) -----------------------
exports.compileFeed = compileFeed;
