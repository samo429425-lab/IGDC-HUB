/**
 * snapshot-engine.js — SAFE SNAPSHOT COMPILER (v2)
 * ------------------------------------------------------------
 * Netlify Function. Returns snapshot payloads but NEVER returns empty pages/sections.
 *
 * Query:
 *   /.netlify/functions/snapshot-engine?target=home|distribution|all
 *
 * Source of truth: Search Bank snapshot (tries both)
 *   - /data/search-bank.snapshot.json
 *   - /functions/data/search-bank.snapshot.json
 *
 * Output (canonical):
 *   {
 *     meta: {...},
 *     pages: {
 *        home: { sections: { home_1: [...], ... } },
 *        distribution: { sections: { "distribution-recommend": [...], ... } }
 *     }
 *   }
 *
 * FAIL-SAFE:
 *  - bank missing/invalid OR bank.items empty OR requested page would be empty -> 500.
 *
 * IMPORTANT:
 *  - This function DOES NOT write any snapshot file. It only returns JSON.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const BANK_SNAPSHOT_CANDIDATES = [
  path.join(process.cwd(), "data", "search-bank.snapshot.json"),
  path.join(process.cwd(), "functions", "data", "search-bank.snapshot.json"),
];

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
function normalize(it, sectionKey, idx){
  return {
    id: it.id || `${sectionKey}-${idx+1}`,
    title: toTitle(it),
    url: toUrl(it),
    thumb: toThumb(it) || "",
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

function buildHomePages(bank){
  const items = Array.isArray(bank && bank.items) ? bank.items : [];
  if (!items.length) return { error:true, message:"Bank snapshot has 0 items" };

  const keys = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  function fill(sectionKey, n){
    const out = [];
    for (let i=0;i<n;i++){
      const it = items[i % items.length];
      out.push(normalize(it, sectionKey, i));
    }
    return out;
  }

  const sections = {};
  for (const k of keys){
    const isRight = k.indexOf("home_right_") === 0;
    sections[k] = fill(k, isRight ? 80 : 60);
  }

  const nonEmpty = Object.values(sections).some(arr => Array.isArray(arr) && arr.length);
  if (!nonEmpty) return { error:true, message:"Home page would be empty (blocked)" };

  return { sections };
}

function buildDistributionPages(bank){
  const items = Array.isArray(bank && bank.items) ? bank.items : [];
  if (!items.length) return { error:true, message:"Bank snapshot has 0 items" };

  const keys = [
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
    for (let i=0;i<n;i++){
      const it = items[i % items.length];
      out.push(normalize(it, sectionKey, i));
    }
    return out;
  }

  const sections = {};
  for (const k of keys){
    sections[k] = fill(k, 100);
  }

  const nonEmpty = Object.values(sections).some(arr => Array.isArray(arr) && arr.length);
  if (!nonEmpty) return { error:true, message:"Distribution page would be empty (blocked)" };

  return { sections };
}

exports.handler = async function(event){
  try{
    const qs = (event && event.queryStringParameters) || {};
    const target = String(qs.target || qs.t || "all").toLowerCase();

    const { obj: bank, path: bankPath } = readFirstJSON(BANK_SNAPSHOT_CANDIDATES);
    if (!bank){
      return jsonResponse(500, { status:"error", message:"Missing or invalid bank snapshot", tried: BANK_SNAPSHOT_CANDIDATES, first: bankPath });
    }

    const now = new Date().toISOString();

    const pages = {};
    if (target === "home" || target === "all"){
      const home = buildHomePages(bank);
      if (home.error) return jsonResponse(500, { status:"error", message: home.message, bank_path: bankPath });
      pages.home = home;
    }
    if (target === "distribution" || target === "all"){
      const dist = buildDistributionPages(bank);
      if (dist.error) return jsonResponse(500, { status:"error", message: dist.message, bank_path: bankPath });
      pages.distribution = dist;
    }

    if (!Object.keys(pages).length){
      return jsonResponse(400, { status:"error", message:`Invalid target="${target}" (use home|distribution|all)` });
    }

    const snapshot = {
      meta: {
        snapshot_id: `snapshot-engine.v2.${now}`,
        generated_at: now,
        source: "search-bank.snapshot.json",
        schema: "pages.snapshot.v2.safe",
        bank_path: bankPath,
        notes: [
          "SAFE compiler: never returns empty pages/sections",
          "Does not write any snapshot file (response-only)"
        ]
      },
      pages
    };

    return jsonResponse(200, snapshot);
  }catch(e){
    return jsonResponse(500, { status:"error", message: String(e && e.message ? e.message : e) });
  }
};
