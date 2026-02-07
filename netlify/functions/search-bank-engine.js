/**
 * search-bank-engine.js — MARU Search Bank Engine (Core v1)
 * ----------------------------------------------------------
 * Netlify Function (CommonJS)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

// ---------- small utils ----------
function nowIso(){ return (Core && Core.nowIso) ? Core.nowIso() : new Date().toISOString(); }
function requestId(){ return (Core && Core.requestId) ? Core.requestId() : crypto.randomBytes(12).toString("hex"); }
function safeInt(n,d,min,max){ return (Core && Core.safeInt) ? Core.safeInt(n,d,min,max) : Math.min(max, Math.max(min, Math.trunc(Number.isFinite(Number(n))?Number(n):d))); }
function s(x){ return x==null? "" : String(x); }
function low(x){ return s(x).trim().toLowerCase(); }
function truthy(x){ return !!x && x !== "0" && x !== "false" && x !== "no"; }
function stableHash(v){ return crypto.createHash("sha1").update(String(v||"")).digest("hex").slice(0,16); }
function domainOf(url){ try{ return new URL(url).hostname.replace(/^www\./,""); }catch(e){ return ""; } }

function tryReadJsonFile(p){
  try{ return JSON.parse(fs.readFileSync(p,"utf8")); }catch(e){ return null; }
}

function snapshotCandidates(){
  const cwd = process.cwd();
  return [
    path.join(cwd,"data","search-bank.snapshot.json"),
    path.join(cwd,"netlify","functions","data","search-bank.snapshot.json"),
    path.join(cwd,"functions","data","search-bank.snapshot.json"),
    path.join(__dirname,"data","search-bank.snapshot.json"),
    path.join(__dirname,"search-bank.snapshot.json"),
  ];
}

function fetchJsonNode(url){
  return new Promise((resolve) => {
    try{
      const u = new URL(url);
      const lib = (u.protocol === "http:") ? http : https;

      const req = lib.request(
        u,
        { method: "GET", headers: { "cache-control": "no-store" } },
        (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return resolve(null);
          }
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try { resolve(JSON.parse(data)); }
            catch(e){ resolve(null); }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.end();
    }catch(e){
      resolve(null);
    }
  });
}

async function fetchJson(url){
  try{
    if (typeof fetch === "function") {
      const r = await fetch(url, { headers: { "cache-control":"no-store" }});
      if(!r.ok) return null;
      return await r.json();
    }
    return await fetchJsonNode(url);
  }catch(e){
    return null;
  }
}


async function snapshotProvider(event){
  for(const p of snapshotCandidates()){
    const j = tryReadJsonFile(p);
    if(j && Array.isArray(j.items)) return j;
  }
  const host = (event?.headers && (event.headers["x-forwarded-host"] || event.headers["host"])) || "";
  const proto = (event?.headers && event.headers["x-forwarded-proto"]) || "https";
  if(host){
    const j = await fetchJson(`${proto}://${host}/data/search-bank.snapshot.json`);
    if(j && Array.isArray(j.items)) return j;
  }
  return { meta:{ generated_at: nowIso(), source:"search-bank-engine" }, items:[] };
}

// optional live hook (disabled unless env set)
async function liveProvider(event, q, limit){
  if(!truthy(process.env.MARU_BANK_LIVE)) return null;
  const host = (event?.headers && (event.headers["x-forwarded-host"] || event.headers["host"])) || "";
  const proto = (event?.headers && event.headers["x-forwarded-proto"]) || "https";
  if(!host) return null;
  const j = await fetchJson(`${proto}://${host}/.netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`);
  if(!j) return null;
  if(Array.isArray(j.items)) return { meta:{ source:"maru-search" }, items:j.items };
  if(j.data && Array.isArray(j.data.items)) return { meta:{ source:"maru-search" }, items:j.data.items };
  if(j.baseResult && Array.isArray(j.baseResult.items)) return { meta:{ source:"maru-search" }, items:j.baseResult.items };
  if(j.baseResult?.data && Array.isArray(j.baseResult.data.items)) return { meta:{ source:"maru-search" }, items:j.baseResult.data.items };
  return null;
}

function normalizeItem(raw){
  if(!raw || typeof raw !== "object") return null;
  const url = s(raw.url || raw.link || "");
  const id  = s(raw.id || "") || (url ? stableHash(url) : stableHash(raw.title || JSON.stringify(raw).slice(0,200)));
  const title = s(raw.title || "").trim();
  const summary = s(raw.summary || raw.description || "").trim();
  const channel = low(raw.channel || raw.section || raw.page || "");
  const lang = low(raw.lang || raw.language || "");
  const source = s(raw.source || raw.provider || domainOf(url) || "").trim();
  const thumbnail = s(raw.thumbnail || "");
  const media = (raw.media && typeof raw.media === "object") ? raw.media : null;
  const imageSet = Array.isArray(raw.imageSet) ? raw.imageSet.filter(Boolean) : null;

  let type = low(raw.type || "");
  if(!type){
    const mk = low(media?.kind || media?.type || "");
    if(mk === "video") type = "video";
    else if(mk === "audio") type = "audio";
    else if(imageSet && imageSet.length) type = "image";
    else if(thumbnail && !/favicon|\.ico$/i.test(thumbnail)) type = "image";
    else type = "article";
  }

  const tags = Array.isArray(raw.tags) ? raw.tags.slice(0,30).map(String) : [];

  return {
    id, type,
    channel: channel || undefined,
    lang: lang || undefined,
    title, summary,
    url: url || undefined,
    source: source || undefined,
    thumbnail: thumbnail || undefined,
    imageSet: (imageSet && imageSet.length) ? imageSet.slice(0,20) : undefined,
    media: media || undefined,
    tags: tags.length ? tags : undefined,
    published_at: raw.published_at || raw.publishedAt || raw.date || undefined,
    ingested_at: raw.ingested_at || raw.ingestedAt || undefined,
  };
}

function computeQualityScore(q, item){
  const base = (Core && Core.scoreItem) ? Core.scoreItem(q, item) : 0;
  let s0 = base;
  if(item.type === "video") s0 += 0.8;
  if(item.type === "image") s0 += 0.6;
  if(item.thumbnail && !/favicon|\.ico$/i.test(item.thumbnail)) s0 += 0.3;
  if(item.media?.preview && (item.media.preview.poster || item.media.preview.mp4 || item.media.preview.webm)) s0 += 0.4;
  if(item.imageSet?.length) s0 += 0.4;

  const src = low(item.source || "");
  if(src){
    if(/\.(gov|edu|ac)\b/.test(src)) s0 += 0.25;
    if(/(wikipedia|reuters|apnews|bbc|nytimes|wsj|ft)\b/.test(src)) s0 += 0.15;
  }

  const dt = item.published_at ? Date.parse(item.published_at) : NaN;
  if(!Number.isNaN(dt)){
    const ageDays = Math.max(0, (Date.now()-dt)/(1000*60*60*24));
    s0 += Math.max(0, 0.15 - Math.min(0.15, ageDays/3650));
  }
  return s0;
}

function applyFilters(items, f){
  const q = f.qLower;
  return items.filter(it=>{
    if(!it) return false;
    if(f.type && f.type !== "any" && low(it.type) !== f.type) return false;
    if(f.channel && low(it.channel||"") !== f.channel) return false;
    if(f.lang && low(it.lang||"") !== f.lang) return false;
    if(q){
      const t = low(it.title||"");
      const d = low(it.summary||"");
      const tg = Array.isArray(it.tags) ? it.tags.join(" ").toLowerCase() : "";
      const u = low(it.url||"");
      if(!(t.includes(q)||d.includes(q)||tg.includes(q)||u.includes(q))) return false;
    }
    return true;
  });
}

function dedup(items){
  const seen = new Set();
  const out = [];
  for(const it of items){
    const key = (it.url && low(it.url)) || (it.id && low(it.id)) || "";
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function runEngine(event, params={}){
  const rid = requestId();
  const ts = Date.now();

  const qRaw = s(params.q || params.query || "");
  const qCheck = (Core && Core.validateQuery) ? Core.validateQuery(qRaw) : { ok: !!qRaw.trim(), value: qRaw.trim(), code:"BAD_QUERY" };
  const q = qCheck.ok ? qCheck.value : "";

  const type = low(params.type || "") || "any";
  const channel = low(params.channel || "");
  const lang = low(params.lang || "");

  const limit = safeInt(params.limit, 100, 1, 1000);
  const offset = safeInt(params.offset, 0, 0, 100000);

  const allowListMode = truthy(params.list) || (!q && (type!=="any" || channel || lang));
  if(!q && !allowListMode){
    return { status:"fail", engine:"search-bank", request_id: rid, timestamp: ts, message: qCheck.code || "EMPTY_QUERY" };
  }

  const served = (Core && Core.tieredFetch)
    ? await Core.tieredFetch({
        liveProvider: async ()=> await liveProvider(event, q||"", limit),
        cacheProvider: null,
        snapshotProvider: async ()=> await snapshotProvider(event),
      })
    : { served_from:"snapshot", data: await snapshotProvider(event) };

  const bank = served.data || { items:[] };
  const rawItems = Array.isArray(bank.items) ? bank.items : [];
  const normalized = [];
  for(const r of rawItems){
    const it = normalizeItem(r);
    if(it) normalized.push(it);
  }

  const filters = { qLower: low(q), type, channel, lang };
  let filtered = dedup(applyFilters(normalized, filters));

  const qForScore = q || "";
  const scored = filtered.map(it=> ({...it, qualityScore: computeQualityScore(qForScore, it)}));
  scored.sort((a,b)=>{
    if(b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    const da = a.published_at ? Date.parse(a.published_at) : NaN;
    const db = b.published_at ? Date.parse(b.published_at) : NaN;
    if(!Number.isNaN(db) && !Number.isNaN(da) && db !== da) return db - da;
    return low(a.title).localeCompare(low(b.title));
  });

  const total = scored.length;
  const page = scored.slice(offset, offset+limit);

  return {
    status:"ok",
    engine:"search-bank",
    served_from: served.served_from || "snapshot",
    request_id: rid,
    timestamp: ts,
    query: q,
    filters: { type: (type!=="any")?type:undefined, channel: channel||undefined, lang: lang||undefined, limit, offset },
    total,
    items: page,
    meta: { bank_meta: bank.meta || undefined, generated_at: nowIso() }
  };
}

exports.runEngine = runEngine;

exports.handler = async function(event){
  try{
    const method = (event.httpMethod || "GET").toUpperCase();
    if(method === "GET"){
      const params = event.queryStringParameters || {};
      const res = await runEngine(event, params);
      return { statusCode: 200, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" }, body: JSON.stringify(res) };
    }
    if(method === "POST"){
      return { statusCode: 501, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" }, body: JSON.stringify({ status:"fail", engine:"search-bank", message:"INGEST_NOT_ENABLED" }) };
    }
    return { statusCode: 405, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" }, body: JSON.stringify({ status:"fail", message:"METHOD_NOT_ALLOWED" }) };
  }catch(e){
    return { statusCode: 500, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" }, body: JSON.stringify({ status:"fail", message: e?.message || "ENGINE_ERROR" }) };
  }
};
