// feed-media.js (MEDIA FEED - REBUILT FROM DISTRIBUTION SAMPLE - PRODUCTION)
// 역할:
// 1) media.snapshot.json 로드 (샘플/폴백)
// 2) search-bank.snapshot.json 로드 (실데이터 가능 시 사용)
// 3) 요청: /.netlify/functions/feed-media?key=media-trending -> { items: [...] }
// 4) 요청: /.netlify/functions/feed-media -> { sections: {key:[...] } }

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
    "Cache-Control": "no-store"
  };
}
function ok(bodyObj){ return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(bodyObj) }; }
function err(statusCode, code, extra = {}){
  return { statusCode, headers: corsHeaders(), body: JSON.stringify({ error: code, ...extra }) };
}

// ---- FS read (multi-path) ----
async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fsCandidatePaths(fileName) {
  const cwd = process.cwd();
  const dir = typeof __dirname === "string" ? __dirname : cwd;

  return [
    path.join(cwd, "data", fileName),
    path.join(cwd, "netlify", "functions", "data", fileName),
    path.join(cwd, "functions", "data", fileName),
    path.join(dir, "data", fileName),
    path.join(dir, "..", "data", fileName),
    path.join(dir, "..", "..", "data", fileName)
  ];
}

// ---- HTTP fetch fallback ----
function guessSiteBaseUrl() {
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  );
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

async function loadSnapshotFile(fileName){
  for (const p of fsCandidatePaths(fileName)) {
    const json = await readJsonIfExists(p);
    if (json) return json;
  }

  const base = guessSiteBaseUrl();
  const urls = [];
  if (base) urls.push(`${base.replace(/\/$/, "")}/data/${fileName}`);
  urls.push(`/data/${fileName}`);

  for (const u of urls) {
    const j = await fetchJson(u);
    if (j) return j;
  }
  return null;
}

// ---- extract helpers ----
function toArr(v){ return Array.isArray(v) ? v : []; }

function pickUrl(it){
  return it?.url || it?.href || it?.link || it?.video || it?.watchUrl || "";
}
function pickThumb(it){
  return it?.thumb || it?.thumbnail || it?.image || it?.poster || it?.cover || "";
}
function pickTitle(it){
  return it?.title || it?.name || it?.text || it?.caption || "";
}
function pickProvider(it){
  return it?.provider || it?.source || it?.channel || "";
}

function normalizeItem(it, fallbackId){
  return {
    id: it?.id || fallbackId,
    title: pickTitle(it) || "",
    thumb: pickThumb(it) || "",
    url: pickUrl(it) || "",
    provider: pickProvider(it) || ""
  };
}

function mediaSnapshotSections(mediaSnap){
  // supports: mediaSnap.sections[key].items | .slots | array
  const out = {};
  const secRoot = mediaSnap?.sections && typeof mediaSnap.sections === "object" ? mediaSnap.sections : {};

  for (const [key, sec] of Object.entries(secRoot)) {
    let items = [];
    if (Array.isArray(sec)) {
      items = sec;
    } else if (Array.isArray(sec?.items)) {
      items = sec.items;
    } else if (Array.isArray(sec?.slots)) {
      // slots -> items
      items = sec.slots.map(s => ({
        id: `${key}-${s.slotId}`,
        title: s.title || "",
        thumb: s.thumb || "",
        url: s.url || (s.outbound && (s.outbound.url || s.outbound.href || s.outbound.link)) || "",
        provider: s.provider || ""
      }));
    }
    out[key] = items.map((it, i)=>normalizeItem(it, `${key}-snap-${i+1}`));
  }
  return out;
}

function bankSections(bankSnap){
  // 기대 구조: bankSnap.index.by_section[media-*] -> [id...], bankSnap.items -> [{id,...}]
  const out = {};
  const items = toArr(bankSnap?.items);
  const byId = new Map(items.filter(x=>x && x.id).map(x=>[x.id, x]));
  const bySection = (bankSnap?.index?.by_section && typeof bankSnap.index.by_section === "object") ? bankSnap.index.by_section : {};

  for (const [key, ids] of Object.entries(bySection)) {
    if (typeof key !== "string" || !key.startsWith("media-")) continue;
    const list = toArr(ids)
      .map(id => byId.get(id))
      .filter(Boolean)
      .map((it, i)=>normalizeItem(it, `${key}-bank-${i+1}`));
    out[key] = list;
  }
  return out;
}

export async function handler(event) {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const qs = event.queryStringParameters || {};
  const key = (qs.key || qs.section || "").trim();

  const mediaSnap = await loadSnapshotFile(MEDIA_SNAPSHOT_NAME);
  if (!mediaSnap) {
    return err(500, "MEDIA_SNAPSHOT_NOT_FOUND", { hint: "Put /data/media.snapshot.json in site root." });
  }

  const bankSnap = await loadSnapshotFile(BANK_SNAPSHOT_NAME); // optional

  const snapSections = mediaSnapshotSections(mediaSnap);
  const bankSec = bankSnap ? bankSections(bankSnap) : {};

  // Merge: bank wins if present & non-empty, else snapshot
  const merged = {};
  for (const k of Object.keys(snapSections)) {
    const bankItems = toArr(bankSec[k]);
    merged[k] = (bankItems.length ? bankItems : toArr(snapSections[k]));
  }

  // Section specific request
  if (key) {
    const items = toArr(merged[key]);
    // 운영형: 404 대신 200 empty
    return ok({ key, items });
  }

  return ok({ sections: merged });
}
