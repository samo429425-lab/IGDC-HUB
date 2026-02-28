/**
 * feed-social.js — SOCIAL EXCLUSIVE FEED (production)
 * ------------------------------------------------------------
 * Goal:
 *  - Return ONLY Social snapshot sections (no cross-page bleed).
 *  - Payload: { status, version, generated, meta, sections:[{id, items:[...]}] }
 *
 * Source of truth (priority):
 *  1) data/front.snapshot.json  (if it contains pages.social.sections)
 *  2) data/social.snapshot.json (legacy per-page snapshot)
 *
 * Notes:
 *  - Does NOT read search-bank.snapshot.json (prevents random mixing).
 *  - Applies PSOM rules if item.id exists (optional; non-breaking).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_ROOT = path.join(__dirname, "data");
const FRONT_SNAPSHOT_PATH = path.join(DATA_ROOT, "front.snapshot.json");
const SOCIAL_SNAPSHOT_PATH = path.join(DATA_ROOT, "social.snapshot.json");
const PSOM_PATH = path.join(DATA_ROOT, "psom.json");

function safeReadJSON(p){
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch(e){ return null; }
}
function toArr(v){ return Array.isArray(v) ? v : []; }
function pick(obj, keys){
  for (const k of keys){
    const v = obj && obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
function normalizeItem(item, fallback = {}){
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id || fallback.id || null,
    page: item.page || fallback.page || "social",
    section: item.section || fallback.section || null,

    title: pick(item, ["title","name","label","caption"]) || "",
    category: item.category || fallback.category || null,
    type: item.type || fallback.type || "thumbnail",

    url: pick(item, ["url","href","link","path","detailUrl","productUrl"]) || "",
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
    meta: item.meta || fallback.meta || ""
  };
}

function applyPSOM(items, psomRules){
  if (!Array.isArray(items) || !Array.isArray(psomRules)) return items;
  const map = new Map(psomRules.map(r => [r.id, r]));
  return items
    .map(it => {
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

function buildSocialSections(snap){
  const sectionsMap = snap?.pages?.social?.sections;
  if (!sectionsMap || typeof sectionsMap !== "object") return [];

  const preferred = [
    "social-youtube",
    "social-instagram",
    "social-x",
    "social-facebook",
    "social-tiktok",
    "social-threads",
    "social-linkedin",
    "social-pinterest",
    "social-blog",
    "socialnetwork"
  ];

  const keys = [];
  const seen = new Set();

  for (const k of preferred){
    if (sectionsMap[k] !== undefined && !seen.has(k)){
      keys.push(k); seen.add(k);
    }
  }
  for (const k of Object.keys(sectionsMap)){
    if (!seen.has(k)){
      keys.push(k); seen.add(k);
    }
  }

  return keys.map(id => {
    const limit = 100;
    const arr = toArr(sectionsMap[id]).slice(0, limit);
    return {
      id,
      items: arr.map(x => normalizeItem(x, { section: id, page: "social" })).filter(Boolean)
    };
  });
}

exports.handler = async function(event){
  try{
    const qs = (event && event.queryStringParameters) || {};
    const pageQuery = String(qs.page || qs.p || "social").toLowerCase();
    if (pageQuery !== "social" && pageQuery !== "socialnetwork" && pageQuery !== "socials") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ status:"fail", message:"feed-social supports only page=social" })
      };
    }

    const front = safeReadJSON(FRONT_SNAPSHOT_PATH);
    const social = safeReadJSON(SOCIAL_SNAPSHOT_PATH);
    const snap = (front && front.pages && front.pages.social && front.pages.social.sections) ? front
               : (social && social.pages && social.pages.social && social.pages.social.sections) ? social
               : null;

    if (!snap){
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ status:"fail", message:"No social snapshot found (front.snapshot.json or social.snapshot.json)" })
      };
    }

    const psom = safeReadJSON(PSOM_PATH) || [];
    const sectionsRaw = buildSocialSections(snap);
    const sections = sectionsRaw.map(s => ({ id: s.id, items: applyPSOM(s.items, psom) }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({
        status: "ok",
        version: "feed-social.v1.exclusive",
        generated: new Date().toISOString(),
        meta: { page: "social", source: (snap === front ? "front.snapshot.json" : "social.snapshot.json") },
        sections
      })
    };
  }catch(e){
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ status:"fail", message: String((e && e.message) || e) })
    };
  }
};
