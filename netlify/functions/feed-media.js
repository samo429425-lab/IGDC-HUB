/**
 * feed-media.v4.strict.js (PRODUCTION)
 * ------------------------------------------------------------
 * 정본 파이프라인(정이사장님 정의):
 *   Search-Bank(snapshot) -> Feed(정제/필터/매핑) -> (Automap HDMI) -> HTML
 *
 * 목표:
 *  - media.snapshot.json(sections) 기준 'media-*' 키만 허용 (화이트리스트)
 *  - search-bank.snapshot.json의 index.by_section[media-*]만 사용 (오배송 차단)
 *  - 임의 자동분배/채널 후보/전체 items fallback 금지
 *  - 요청: /.netlify/functions/feed-media?key=media-trending -> { key, items }
 *  - 요청: /.netlify/functions/feed-media -> { meta, hero, sections:[{key,items}] }
 */

import fs from "fs/promises";
import path from "path";

const MEDIA_SNAPSHOT_NAME = "media.snapshot.json";
const BANK_SNAPSHOT_NAME  = "search-bank.snapshot.json";

// ---- CORS ----
function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}
function ok(bodyObj){ return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(bodyObj) }; }
function err(statusCode, code, extra = {}){
  return { statusCode, headers: corsHeaders(), body: JSON.stringify({ error: code, ...extra }) };
}

// ---- helpers ----
async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function guessSiteBaseUrl(){
  return (process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || "");
}

async function fetchJson(url){
  try{
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) return null;
    return await res.json();
  }catch{
    return null;
  }
}

function fsCandidatePaths(fileName){
  const cwd = process.cwd();
  const dir = typeof __dirname === "string" ? __dirname : cwd;

  return [
    path.join(cwd, "data", fileName),
    path.join(cwd, "public", "data", fileName),
    path.join(cwd, "dist", "data", fileName),
    path.join(cwd, "netlify", "functions", "data", fileName),
    path.join(cwd, "functions", "data", fileName),

    path.join(dir, "data", fileName),
    path.join(dir, "..", "data", fileName),
    path.join(dir, "..", "..", "data", fileName),

    path.join(cwd, fileName),
  ];
}

async function loadSnapshotFile(fileName){
  for(const p of fsCandidatePaths(fileName)){
    const json = await readJsonIfExists(p);
    if(json) return { json, path: p, source: "fs" };
  }

  // HTTP fallback (deployed)
  const base = guessSiteBaseUrl();
  const urls = [];
  if(base) urls.push(`${base.replace(/\/$/,"")}/data/${fileName}`);
  urls.push(`/data/${fileName}`);

  for(const u of urls){
    const j = await fetchJson(u);
    if(j) return { json: j, path: u, source: "http" };
  }
  return { json: null, path: null, source: "none" };
}

// ---- KEY CANON ----
const KEY_ALIAS = {
  // legacy -> canon
  trending_now: "media-trending",
  latest_movie: "media-movie",
  latest_drama: "media-drama",
  section_1: "media-thriller",
  section_2: "media-romance",
  section_3: "media-variety",
  section_4: "media-documentary",
  section_5: "media-animation",
  section_6: "media-music",
  section_7: "media-shorts",
};

function isMediaKey(k){
  return (typeof k === "string") && k.startsWith("media-");
}
function mapKey(k){
  const raw = (k || "").trim();
  if(!raw) return "";
  if(isMediaKey(raw)) return raw;
  return KEY_ALIAS[raw] || raw;
}

function toArr(v){ return Array.isArray(v) ? v : []; }

function looksLikeMedia(it){
  const url = it?.url || it?.video || it?.media?.url || "";
  const thumb = it?.thumbnail || it?.thumb || it?.image || "";
  return !!(String(url).trim() || String(thumb).trim());
}

function getPublishedAt(it){
  return it?.published_at || it?.publishedAt || it?.created_at || it?.createdAt || null;
}
function getDuration(it){
  if (it?.media && typeof it.media.duration === "number") return it.media.duration;
  if (typeof it?.duration === "number") return it.duration;
  return 0;
}

function normalizeFromBankItem(it) {
  const license = it?.rights?.license || it?.license || "unknown";
  const publishedAt = getPublishedAt(it);
  const url = it?.url || it?.video || it?.media?.url || "";

  return {
    id: it?.id || crypto.randomUUID(),
    title: it?.title || it?.name || "",
    summary: it?.summary || it?.desc || "",
    thumbnail: it?.thumbnail || it?.thumb || it?.image || "",
    poster: it?.poster || it?.thumbnail || it?.thumb || it?.image || "",
    url,
    video: url,
    duration: getDuration(it),
    publishedAt,
    provider: it?.provider || it?.source || it?.channel || "",
    license: { type: license },
    metrics: {
      like: 0,
      recommend: 0,
      click: 0,
      watch: { views: 0, totalSeconds: 0, avgSeconds: 0 },
    },
    tags: Array.isArray(it?.tags) ? it.tags : [],
    genre: it?.genre || it?.category || it?.section || null,
  };
}

function sortByPublishedDesc(items){
  return items.sort((a,b)=>{
    const pa = Date.parse(getPublishedAt(a) || "") || 0;
    const pb = Date.parse(getPublishedAt(b) || "") || 0;
    return pb - pa;
  });
}

// ---- BUILD ----
export async function buildMediaFeed() {
  // 1) load media snapshot canon
  const mediaSnap = await loadSnapshotFile(MEDIA_SNAPSHOT_NAME);
  const media = mediaSnap.json || {};
  const canonKeys = Object.keys(media?.sections || {}).map(k=>String(k)).filter(isMediaKey);
  const CANON_SET = new Set(canonKeys);

  // fallback (should not happen; keep safe)
  if(canonKeys.length === 0){
    ["media-trending","media-movie","media-drama","media-thriller","media-romance","media-variety","media-documentary","media-animation","media-music","media-shorts"]
      .forEach(k=>CANON_SET.add(k));
  }
  const finalKeys = Array.from(CANON_SET);

  // 2) load bank snapshot
  const bankSnap = await loadSnapshotFile(BANK_SNAPSHOT_NAME);
  const bank = bankSnap.json || {};
  const itemList = toArr(bank?.items);
  const itemById = new Map(itemList.filter(x=>x && x.id).map(x=>[x.id, x]));
  const bySection = (bank?.index?.by_section && typeof bank.index.by_section === "object") ? bank.index.by_section : {};

  // 3) buckets (STRICT)
  const buckets = {};
  finalKeys.forEach(k => { buckets[k] = []; });

  // 4) fill by_section (allow alias keys, but must map into canon)
  for(const [rawKey, idsRaw] of Object.entries(bySection)){
    const k = mapKey(rawKey);
    if(!CANON_SET.has(k)) continue;

    const ids = toArr(idsRaw);
    for(const id of ids){
      const it = itemById.get(id);
      if(!it) continue;
      if(!looksLikeMedia(it)) continue;
      buckets[k].push(normalizeFromBankItem(it));
    }
  }

  // 5) sort each bucket by published desc (best effort)
  for(const k of finalKeys){
    buckets[k] = sortByPublishedDesc(buckets[k]);
  }

  // 6) hero: rotateFrom in media snapshot if present (must be canon)
  const rotateFrom = toArr(media?.hero?.rotateFrom).map(mapKey).filter(k=>CANON_SET.has(k));
  const heroKeys = rotateFrom.length ? rotateFrom : ["media-trending","media-movie","media-drama"].filter(k=>CANON_SET.has(k));
  const heroItems = heroKeys.flatMap(k=>buckets[k]).slice(0, 10);

  // 7) sections output
  const sections = finalKeys.map((key)=>({
    key,
    title: media?.sections?.[key]?.title || key,
    items: buckets[key] || [],
  }));

  return {
    meta: {
      type: "media-feed",
      version: "v4.strict",
      generatedAt: new Date().toISOString(),
      source: "search-bank.snapshot.json",
      paths: {
        mediaSnapshot: mediaSnap.path,
        mediaSnapshotSource: mediaSnap.source,
        bankSnapshot: bankSnap.path,
        bankSnapshotSource: bankSnap.source,
      },
      counts: {
        bankItems: itemList.length,
        totalMediaItems: sections.reduce((a,s)=>a+(s.items?.length||0),0),
      }
    },
    hero: {
      source: "media.snapshot.json",
      rotateFrom: heroKeys,
      intervalSec: (typeof media?.hero?.intervalSec === "number" ? media.hero.intervalSec : 12),
      items: heroItems,
    },
    sections,
    // internal: for quick lookup
    _canonKeys: finalKeys,
  };
}

// ---- NETLIFY HANDLER ----
export const handler = async (event = {}) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  try{
    const qs = event.queryStringParameters || {};
    const rawKey = (qs.key || qs.section || "").trim();
    const key = mapKey(rawKey);

    const feed = await buildMediaFeed();
    const canon = new Set(toArr(feed?._canonKeys));
    delete feed._canonKeys;

    // section request
    if(rawKey){
      if(!canon.has(key)){
        return ok({ key, items: [] });
      }
      const sec = toArr(feed.sections).find(s => s && s.key === key);
      return ok({ key, items: toArr(sec?.items) });
    }

    return ok(feed);
  }catch(e){
    return err(500, "FEED_MEDIA_FAIL", { message: String(e?.message || e) });
  }
};
