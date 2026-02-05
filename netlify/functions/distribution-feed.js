/**
 * distribution-feed.js — DISTRIBUTION ONLY (v1)
 * ------------------------------------------------------------
 * Source of truth: data/search-bank.snapshot.json
 * Output: distribution.snapshot.v1 JSON (pages.distribution.sections)
 *
 * NOTE:
 * - This function returns a distribution-only snapshot payload.
 * - It does NOT read or depend on front.snapshot.json (Home).
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---- PATHS -----------------------------------------------------
const DATA_ROOT = path.join(__dirname, "data");
const BANK_SNAPSHOT_PATH = path.join(DATA_ROOT, "search-bank.snapshot.json");

// ---- UTIL ------------------------------------------------------
function safeReadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch (e) { return null; }
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
  const source = pick(sourceObj, ["platform","name"]) || "";

  return {
    id: it.id || `dist-${sectionKey}-${idx+1}`,
    title: pick(it, ["title","name","label"]) || "Untitled",
    url: pick(it, ["url","href","link"]) || "#",
    thumb: pick(it, ["thumbnail","thumb","image","img","cover","poster"]) || "",
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

  // Fill each section by cycling bank items (seed-safe).
  function fill(sectionKey, n){
    const out = [];
    if (!items.length) return out;
    for (let i = 0; i < n; i++){
      const it = items[i % items.length];
      out.push(bankItemToDist(it, sectionKey, i));
    }
    return out;
  }

  const sections = {};
  for (const k of SECTION_KEYS){
    sections[k] = fill(k, k === "distribution" ? 20 : 12);
  }

  return {
    meta: {
      snapshot_id: `distribution.snapshot.v1.bank.${now}`,
      generated_at: now,
      source: "search-bank.snapshot.json",
      schema: "distribution.snapshot.v1"
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
    const bank = safeReadJSON(BANK_SNAPSHOT_PATH);
    if (!bank) {
      return jsonResponse(500, {
        status: "error",
        message: "Missing or invalid bank snapshot",
        path: BANK_SNAPSHOT_PATH
      });
    }

    const snap = buildDistributionSnapshotFromBank(bank);
    return jsonResponse(200, snap);
  } catch (e) {
    return jsonResponse(500, { status: "error", message: String(e && e.message ? e.message : e) });
  }
};
