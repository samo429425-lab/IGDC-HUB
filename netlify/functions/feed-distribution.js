/**
 * distribution-feed.js — DISTRIBUTION ONLY (v2, SAFE)
 * ------------------------------------------------------------
 * Source of truth: Search Bank snapshot
 *   - /data/search-bank.snapshot.json
 *   - /functions/data/search-bank.snapshot.json
 * Output: distribution.snapshot.v1 JSON (pages.distribution.sections)
 *
 * FAIL-SAFE:
 *  - bank missing/invalid OR bank.items empty -> 500 (never returns empty sections).
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
function safeReadJSON(p) {
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
function bankItemToDist(it, sectionKey, idx){
  const sourceObj = (it && typeof it.source === "object") ? it.source : {};
  const source = pick(sourceObj, ["platform","name"]) || pick(it, ["source","provider","site"]) || "";

  return {
    id: it.id || `dist-${sectionKey}-${idx+1}`,
    title: pick(it, ["title","name","label","caption","text"]) || "Untitled",
    url: pick(it, ["url","href","link","productUrl","checkoutUrl"]) || "#",
    thumb: pick(it, ["thumb","thumbnail","thumbnailUrl","image","image_url","img","cover","poster"]) || "",
    source,
    channel: it.channel || null,
    type: it.type || null,
    priority: idx + 1,
    bank_ref: it.id || null,
    ingested_at: it.ingested_at || null,
  };
}

function buildDistributionSnapshotFromBank(bank){
  const now = new Date().toISOString();
  const items = Array.isArray(bank && bank.items) ? bank.items : [];
  if (!items.length) return { error:true, message:"Bank snapshot has 0 items" };

  // Distribution Hub HTML uses these keys in data-psom-key.
  const SECTION_KEYS = [
    "distribution-recommend",
    "distribution-trending",
    "distribution-new",
    "distribution-special",
    "distribution-others",
    "distribution-sponsor",
    "distribution"
  ];

  function fill(sectionKey, n){
    const out = [];
    for (let i=0; i<n; i++){
      const it = items[i % items.length];
      out.push(bankItemToDist(it, sectionKey, i));
    }
    return out;
  }

  const sections = {};
  for (const k of SECTION_KEYS){
    sections[k] = fill(k, 100);
  }

  const nonEmpty = Object.values(sections).some(arr => Array.isArray(arr) && arr.length);
  if (!nonEmpty) return { error:true, message:"Generated 0 items (blocked)" };

  return {
    meta: {
      snapshot_id: `distribution.snapshot.v1.bank.${now}`,
      generated_at: now,
      source: "search-bank.snapshot.json",
      schema: "distribution.snapshot.v1",
      notes: [
        "Distribution-only snapshot payload",
        "FAIL-SAFE enabled: never returns empty sections on bank failure"
      ]
    },
    pages: {
      distribution: { sections }
    }
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

// ---- NETLIFY HANDLER ------------------------------------------
exports.handler = async function (event) {
  try {
    const { obj: bank, path: bankPath } = readFirstJSON(BANK_SNAPSHOT_CANDIDATES);
    if (!bank) {
      return jsonResponse(500, {
        status: "error",
        message: "Missing or invalid bank snapshot",
        tried: BANK_SNAPSHOT_CANDIDATES,
        first: bankPath
      });
    }

    const snap = buildDistributionSnapshotFromBank(bank);
    if (snap && snap.error){
      return jsonResponse(500, { status:"error", message: snap.message, bank_path: bankPath });
    }

    return jsonResponse(200, snap);
  } catch (e) {
    return jsonResponse(500, { status: "error", message: String(e && e.message ? e.message : e) });
  }
};
