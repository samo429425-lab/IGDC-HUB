
/**
 * feed.js — MARU FUTURE FEED ENGINE (v2.2 SAFE PATCH)
 * ------------------------------------------------------------
 * FIX:
 * - automap(MAIN)은 item.thumb가 없으면 전부 empty 처리됨.
 * - v2.1에서 normalizeItem이 thumb/priority를 버려서 MAIN/RIGHT 모두 비는 현상 발생 가능.
 *
 * 보장:
 * ✔ 기존 동작 유지: { items:[...] }
 * ✔ 추가 동작 유지: { sections:[{id, items:[...]}] }
 * ✔ 다른 엔진 영향 없음 (maru-search / global-insight / core)
 */

"use strict";

const fs = require("fs");
const path = require("path");

let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

const DATA_ROOT = path.join(__dirname, "data");
const FRONT_SNAPSHOT_PATH = path.join(DATA_ROOT, "front.snapshot.json");
const PSOM_PATH = path.join(DATA_ROOT, "psom.json");

function safeReadJSON(p){
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch(e){ return null; }
}

// ✅ thumb/priority 보존
function normalizeItem(item){
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id || null,
    page: item.page || null,
    section: item.section || null,
    title: item.title || item.name || item.label || item.caption || "",
    category: item.category || null,
    type: item.type || "thumbnail",
    url: item.url || item.href || item.link || item.path || "",
    thumb: item.thumb || item.image || item.image_url || item.img || item.photo ||
           item.thumbnail || item.thumbnailUrl || item.cover || item.coverUrl || "",
    priority: (typeof item.priority === "number" ? item.priority : (Number.isFinite(Number(item.priority)) ? Number(item.priority) : null)),
    keywords: item.keywords || [],
    weight: item.weight || 0,
    enabled: item.enabled !== false,
    order: item.order || 0,
    lang: item.lang || [],
    version: item.version || "1.0",
    updated: item.updated || null,
  };
}

function applyPSOM(items, psom){
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

function applyCoreScore(items){
  if (!Core || typeof Core.scoreItem !== "function") return items;
  return items.map(it => ({ ...it, _score: Core.scoreItem(it) }));
}

function compileFeed(){
  const snap = safeReadJSON(FRONT_SNAPSHOT_PATH) || {};
  const psom = safeReadJSON(PSOM_PATH) || [];

  let flatItems = [];
  let sections = [];

  // (A) 기존 flat array 구조
  if (Array.isArray(snap)) {
    flatItems = snap.map(normalizeItem).filter(Boolean);
  }

  // (B) 신규 pages.home.sections 구조 (HOME 우선)
  if (snap.pages && snap.pages.home && snap.pages.home.sections) {
    for (const [id, items] of Object.entries(snap.pages.home.sections)) {
      const norm = (items || []).map(normalizeItem).filter(Boolean);
      sections.push({ id, items: norm });     // ← automap이 여기서 읽음
      flatItems.push(...norm);                // ← 기존 파이프라인 유지용
    }
  }

  // 기존 파이프라인 유지(PSOM/CORE는 flatItems에만 적용)
  flatItems = applyPSOM(flatItems, psom);
  flatItems = applyCoreScore(flatItems);

  flatItems.sort((a,b) => {
    const sa = a._score || 0;
    const sb = b._score || 0;
    if (sb !== sa) return sb - sa;
    if ((b.weight||0) !== (a.weight||0)) return (b.weight||0)-(a.weight||0);
    return (a.order||0) - (b.order||0);
  });

  return {
    status: "ok",
    version: "feed.v2.2-safe",
    generated: new Date().toISOString(),
    count: flatItems.length,
    items: flatItems,
    sections
  };
}

exports.handler = async function(){
  try {
    const data = compileFeed();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status:"fail", message: String(e?.message||e) })
    };
  }
};

exports.compileFeed = compileFeed;
