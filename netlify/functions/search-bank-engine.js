/**
 * search-bank-engine.js — MARU Search Bank Engine (Core v2)
 * ----------------------------------------------------------
 * Netlify Function (CommonJS)
 * Expand-only: keeps API compatible with v1:
 *  - exports.runEngine
 *  - exports.handler (GET)
 *
 * v2 upgrades:
 *  - Geo/Producer aware normalization & filtering (optional fields)
 *  - Safer host-based snapshot fetch
 *  - Better scoring inputs (still delegates to Core.scoreItem)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

let SearchBankSync = null;
try { SearchBankSync = require("./maru-searchbank-sync"); } catch (e) { SearchBankSync = null; }

let CommerceEngine = null;
try { CommerceEngine = require("./maru-commerce-engine"); } catch (e) { CommerceEngine = null; }

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
      const r = await fetch(url, {
        method: "GET",
        headers: { "cache-control":"no-store" }
      });

      if(!r || !r.ok) return { results: [] };

      const data = await r.json().catch(()=>null);

      if(!data) return { results: [] };

      // 🔥 핵심: 구조 강제 통일
      if(Array.isArray(data)) return { results: data };
      if(data.results) return data;
      if(data.items) return { results: data.items };

      return { results: [] };
    }

    const data = await fetchJsonNode(url);
    if(!data) return { results: [] };

    if(Array.isArray(data)) return { results: data };
    if(data.results) return data;
    if(data.items) return { results: data.items };

    return { results: [] };

  }catch(e){
    return { results: [] };
  }
}

function eventBaseUrl(event){
  const host = (event?.headers && (event.headers["x-forwarded-host"] || event.headers["host"])) || "";
  const proto = (event?.headers && event.headers["x-forwarded-proto"]) || "https";
  if(!host) return "";
  return `${proto}://${host}`;
}

async function snapshotProvider(event){
  for(const p of snapshotCandidates()){
    const j = tryReadJsonFile(p);
    if(j && Array.isArray(j.items)) return j;
  }
  const base = eventBaseUrl(event);
  if(base){
    const j = await fetchJson(`${base}/data/search-bank.snapshot.json`);
    if(j && Array.isArray(j.items)) return j;
  }
  return { meta:{ generated_at: nowIso(), source:"search-bank.engine" }, items:[] };
}

// optional live hook (disabled unless env set)
async function liveProvider(event, q, limit){
  if(!truthy(process.env.MARU_BANK_LIVE)) return null;
  const base = eventBaseUrl(event);
  if(!base) return null;
  const j = await fetchJson(`${base}/.netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`);
  if(!j) return null;
  if(Array.isArray(j.items)) return { meta:{ source:"maru-search" }, items:j.items };
  if(j.data && Array.isArray(j.data.items)) return { meta:{ source:"maru-search" }, items:j.data.items };
  if(j.baseResult && Array.isArray(j.baseResult.items)) return { meta:{ source:"maru-search" }, items:j.baseResult.items };
  if(j.baseResult?.data && Array.isArray(j.baseResult.data.items)) return { meta:{ source:"maru-search" }, items:j.baseResult.data.items };
  return null;
}

function pickGeo(raw){
  const g = raw.geo || (raw.extension && raw.extension.geo) || null;
  if(!g || typeof g !== "object") return null;
  const country = s(g.country||"").trim();
  const state = s(g.state||g.province||"").trim();
  const city = s(g.city||"").trim();
  if(!country && !state && !city) return null;
  return { country: country||undefined, state: state||undefined, city: city||undefined };
}

function pickProducer(raw){
  const p = raw.producer || (raw.extension && raw.extension.producer) || null;
  if(!p || typeof p !== "object") return null;
  const id = s(p.id||"").trim();
  const name = s(p.name||"").trim();
  const home = s(p.home||p.url||"").trim();
  const contact = (p.contact && typeof p.contact==="object") ? p.contact : undefined;
  if(!id && !name && !home) return null;
  return { id: id||undefined, name: name||undefined, home: home||undefined, contact };
}

function normalizeItem(raw){
  if(!raw || typeof raw !== "object") return null;
  const url = s(raw.url || raw.link || "");
  const id  = s(raw.id || "") || (url ? stableHash(url) : stableHash(raw.title || JSON.stringify(raw).slice(0,200)));
  const title = s(raw.title || "").trim();
  const summary = s(raw.summary || raw.description || "").trim();
  const channel = low(raw.channel || raw.section || raw.page || "");
  const lang = low(raw.lang || raw.language || "");
  const source = (typeof raw.source === "string") ? raw.source : s(raw.source?.name || raw.provider || domainOf(url) || "").trim();
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
  const geo = pickGeo(raw);
  const producer = pickProducer(raw);
  const quality = (raw.quality && typeof raw.quality === "object") ? raw.quality : undefined;
  const dispute_profile = (raw.dispute_profile && typeof raw.dispute_profile==="object") ? raw.dispute_profile : (raw.extension && raw.extension.dispute_profile) ? raw.extension.dispute_profile : undefined;

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

    // v2 optional
    geo: geo || undefined,
    producer: producer || undefined,
    quality: quality,
    dispute_profile: dispute_profile
  };
}

function computeQualityScore(q, item){
  const base = (Core && Core.scoreItem) ? Core.scoreItem(q, item) : 0;
  let s0 = base;

  // type boosts (legacy)
  if(item.type === "video") s0 += 0.8;
  if(item.type === "image") s0 += 0.6;
  if(item.thumbnail && !/favicon|\.ico$/i.test(item.thumbnail)) s0 += 0.3;
  if(item.media?.preview && (item.media.preview.poster || item.media.preview.mp4 || item.media.preview.webm)) s0 += 0.4;
  if(item.imageSet?.length) s0 += 0.4;

  // source boosts (light)
  const src = low(item.source || "");
  if(src){
    if(/\.(gov|edu|ac)\b/.test(src)) s0 += 0.25;
    if(/(wikipedia|reuters|apnews|bbc|nytimes|wsj|ft)\b/.test(src)) s0 += 0.15;
  }

  // freshness
  const dt = item.published_at ? Date.parse(item.published_at) : NaN;
  if(!Number.isNaN(dt)){
    const ageDays = Math.max(0, (Date.now()-dt)/(1000*60*60*24));
    s0 += Math.max(0, 0.15 - Math.min(0.15, ageDays/3650));
  }

  // explicit quality (optional 0..1)
  const q0 = item.quality;
  if(q0 && typeof q0.trust === "number") s0 += Math.max(-0.4, Math.min(0.8, q0.trust)) * 0.6;
  if(q0 && typeof q0.rank === "number") s0 += Math.max(0, Math.min(0.8, q0.rank)) * 0.5;
  if(q0 && typeof q0.freshness === "number") s0 += Math.max(0, Math.min(0.8, q0.freshness)) * 0.4;

  // dispute penalty
  const dp = item.dispute_profile;
  if(dp && typeof dp.refund_rate === "number") s0 -= Math.min(1, Math.max(0, dp.refund_rate)) * 1.2;
  if(dp && typeof dp.complaint_ratio === "number") s0 -= Math.min(1, Math.max(0, dp.complaint_ratio)) * 1.4;

  return s0;
}

function applyFilters(items, f){
  const q = f.qLower;
  return items.filter(it=>{
    if(!it) return false;

    if(f.type && f.type !== "any" && low(it.type) !== f.type) return false;
    if(f.channel && low(it.channel||"") !== f.channel) return false;
    if(f.lang && low(it.lang||"") !== f.lang) return false;

    // geo filters (optional)
    if(f.country && low(it.geo?.country||"") !== f.country) return false;
    if(f.state && low(it.geo?.state||"") !== f.state) return false;
    if(f.city && low(it.geo?.city||"") !== f.city) return false;

    // producer filters (optional)
    if(f.producer){
      const pid = low(it.producer?.id||"");
      const pn = low(it.producer?.name||"");
      if(!(pid===f.producer || pn.includes(f.producer))) return false;
    }

    if(q){
      const t = low(it.title||"");
      const d = low(it.summary||"");
      const tg = Array.isArray(it.tags) ? it.tags.join(" ").toLowerCase() : "";
      const u = low(it.url||"");
      const g = low([it.geo?.country, it.geo?.state, it.geo?.city].filter(Boolean).join(" "));
      const p = low([it.producer?.id, it.producer?.name].filter(Boolean).join(" "));
      if(!(t.includes(q)||d.includes(q)||tg.includes(q)||u.includes(q)||g.includes(q)||p.includes(q))) return false;
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

function writeSearchBankSnapshots(bank){
  const cwd = process.cwd();

  const targets = [
    path.join(cwd,"data","search-bank.snapshot.json"),
    path.join(cwd,"netlify","functions","data","search-bank.snapshot.json")
  ];

  for(const p of targets){
    try{
      fs.mkdirSync(path.dirname(p), { recursive:true });
      fs.writeFileSync(p, JSON.stringify(bank, null, 2), "utf8");
    }catch(e){}
  }
}

function mergeBankItems(existingItems, incomingItems){
  const byId = new Map();

  for(const it of Array.isArray(existingItems) ? existingItems : []){
    if(!it || !it.id) continue;
    byId.set(it.id, it);
  }

  for(const it of Array.isArray(incomingItems) ? incomingItems : []){
    if(!it || !it.id) continue;

    if(byId.has(it.id)) continue;

    byId.set(it.id, it);
  }

  return Array.from(byId.values());
}

async function runEngine(event, params={}){
  const ip =
  event?.headers?.["x-forwarded-for"] ||
  event?.headers?.["client-ip"] ||
  "unknown";

if(global.SearchBankExtensionCore?.security){
  if(!global.SearchBankExtensionCore.security.check(ip)){
    return {status:"fail",engine:"search-bank",message:"rate_limit"};
  }
}
  const rid = requestId();
  const ts = Date.now();

  const qRaw = s(params.q || params.query || "");
  const qCheck = (Core && Core.validateQuery) ? Core.validateQuery(qRaw) : { ok: !!qRaw.trim(), value: qRaw.trim(), code:"BAD_QUERY" };
  const q = qCheck.ok ? qCheck.value : "";

  const type = low(params.type || "") || "any";
  const channel = low(params.channel || "");
  const lang = low(params.lang || "");

  // v2 geo filters (optional)
  const country = low(params.country || params.geo_country || "");
  const state = low(params.state || params.province || params.geo_state || "");
  const city = low(params.city || params.geo_city || "");
  const producer = low(params.producer || params.producer_id || params.producer_name || "");

  const limit = safeInt(params.limit, 100, 1, 1000);
  const offset = safeInt(params.offset, 0, 0, 100000);

  const allowListMode = truthy(params.list) || (!q && (type!=="any" || channel || lang || country || state || city || producer));
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
    if(it){
      normalized.push(it);

      if(global.SearchBankExtensionCore?.pipeline){
        try{
          global.SearchBankExtensionCore.pipeline(it);
        }catch(e){}
      }
    }
  }

const existing = Array.isArray(bank.items) ? bank.items : [];
const existingIds = new Set(existing.map(i => i.id));

// 👉 신규 데이터만 추출
const newItems = [];
for (const it of normalized) {
  if (!it || !it.id) continue;
  if (!existingIds.has(it.id)) {
    newItems.push(it);
  }
}

// 👉 append (기존 유지)
let combined = existing.concat(newItems);

// 👉 랭킹 기준 정렬 (위치만 변경, 데이터는 그대로)
combined.sort((a, b) => {
const qa = computeQualityScore(q || "", a);
const qb = computeQualityScore(q || "", b);

  if (qb !== qa) return qb - qa;

  const da = a.published_at ? Date.parse(a.published_at) : 0;
  const db = b.published_at ? Date.parse(b.published_at) : 0;

  return db - da;
});

// 👉 최대 50,000 유지
if (combined.length > 50000) {
  combined = combined.slice(0, 50000);
}

bank.items = combined;

 bank.meta = {
  ...(bank.meta || {}),
  generated_at: nowIso(),
  source: "search-bank-engine"
};

writeSearchBankSnapshots(bank);

  const filters = {
    qLower: low(q),
    type, channel, lang,
    country: country || "",
    state: state || "",
    city: city || "",
    producer: producer || ""
  };

  let filtered = dedup(applyFilters(bank.items || [], filters));

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
    filters: {
      type: (type!=="any")?type:undefined,
      channel: channel||undefined,
      lang: lang||undefined,
      country: country||undefined,
      state: state||undefined,
      city: city||undefined,
      producer: producer||undefined,
      limit, offset
    },
    total,
	
	/* ===== SNAPSHOT AUTO PIPELINE ===== */
try{
  if(SearchBankSync && typeof SearchBankSync.run === "function"){
    await SearchBankSync.run({
      source: "search-bank",
      items: page || [],
      query: q
    });
  }
}catch(e){
  console.error("Snapshot Sync Error:", e.message);
}
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

/* ===============================
SEARCH BANK EXTENSION PART 1
Region / Sector / Entity Graph
================================ */

class SBRegionManager {

  constructor(){
    this.regions = new Map();
  }

  register(id,data){
    if(!id) return;
    this.regions.set(id,{id,...data});
  }

  get(id){
    return this.regions.get(id);
  }

  list(){
    return Array.from(this.regions.values());
  }

}

class SBSectorManager {

  constructor(){
    this.sectors = new Map();
  }

  register(id,data){
    if(!id) return;
    this.sectors.set(id,{id,...data});
  }

  get(id){
    return this.sectors.get(id);
  }

  list(){
    return Array.from(this.sectors.values());
  }

}

class SBEntityManager {

  constructor(){
    this.entities = new Map();
  }

  create(entity){
    const uuid = this.uuid();
    entity.uuid = uuid;
    this.entities.set(uuid,entity);
    return entity;
  }

  get(id){
    return this.entities.get(id);
  }

  list(){
    return Array.from(this.entities.values());
  }

  uuid(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
      const r=Math.random()*16|0;
      const v=c==='x'?r:(r&0x3|0x8);
      return v.toString(16);
    });
  }

}

class SBKnowledgeGraph {

  constructor(){
    this.links = new Map();
  }

  link(a,b,type){
    const id = a+"_"+type+"_"+b;
    this.links.set(id,{a,b,type,t:Date.now()});
  }

  get(id){
    const r = [];
    for(const e of this.links.values()){
      if(e.a===id || e.b===id) r.push(e);
    }
    return r;
  }

}

global.SearchBankExtensionCore = {
  regions:new SBRegionManager(),
  sectors:new SBSectorManager(),
  entities:new SBEntityManager(),
  graph:new SBKnowledgeGraph()
};

/* ===============================
SEARCH BANK EXTENSION PART 2
Global Region System
================================ */

global.SearchBankExtensionCore.worldRegions = {

  northAmerica:["USA","Canada","Mexico"],
  southAmerica:["Brazil","Argentina","Chile","Peru"],

  westEurope:["Germany","France","UK","Italy","Spain"],
  eastEurope:["Poland","Ukraine","Romania","Russia"],

  westAsia:["Turkey","Saudi","UAE","Israel","Iran"],

  southAsia:["India","Pakistan","Bangladesh","SriLanka"],

  southeastAsia:["Thailand","Vietnam","Indonesia","Malaysia","Philippines"],

  farEastAsia:["Korea","Japan","China","Taiwan","Mongolia"],

  africa:["Nigeria","Egypt","Kenya","Ethiopia","SouthAfrica"],

  oceania:["Australia","NewZealand","PapuaNewGuinea","Fiji"]

};

global.SearchBankExtensionCore.getRegionByCountry = function(country){

  for(const r in this.worldRegions){
    if(this.worldRegions[r].includes(country)){
      return r;
    }
  }

  return null;

};

/* ===============================
SEARCH BANK EXTENSION PART 3
AI Query Router
================================ */

global.SearchBankExtensionCore.aiQuery = function(q){

  q = (q || "").toLowerCase();
  const res = [];

  for(const e of this.entities.list()){
    const t = JSON.stringify(e).toLowerCase();
    if(t.includes(q)) res.push(e);
  }

  return res;

};

/* ===============================
SEARCH BANK EXTENSION PART 4
Security Layer
================================ */

global.SearchBankExtensionCore.security = {

  req:new Map(),

  check(ip){

    const now = Date.now();
    const t = this.req.get(ip) || [];

    t.push(now);

    const filtered = t.filter(v=>now-v<60000);

    this.req.set(ip,filtered);

    if(filtered.length>200) return false;

    return true;

  }

};

/* ===============================
SEARCH BANK EXTENSION PART 5
Self Healing Layer
================================ */

global.SearchBankExtensionCore.recovery = {

  sources:[],

  register(fn){
    this.sources.push(fn);
  },

  async tryRecover(){

    for(const f of this.sources){

      try{
        await f();
      }catch(e){}

    }

  }

};

/* ===============================
SEARCH BANK EXTENSION PART 6
Global Entity Index Engine
================================ */

global.SearchBankExtensionCore.globalIndex = {

  entities:new Map(),

  generateID(region,sector,name){

    const r=(region||"global").toLowerCase().replace(/\s/g,"");
    const s=(sector||"general").toLowerCase().replace(/\s/g,"");
    const n=(name||"entity").toLowerCase().replace(/\s/g,"");

    const uid=Math.random().toString(36).substring(2,8);

    return r+"_"+s+"_"+n+"_"+uid;

  },

  register(entity){

    if(!entity) return null;

    const key = (entity.url || entity.name || JSON.stringify(entity)).toLowerCase();
    const id = crypto.createHash("sha1").update(key).digest("hex").slice(0,16);

    entity.globalId = id;

    this.entities.set(id,entity);

    return entity;

  },

  get(id){
    return this.entities.get(id);
  },

  search(q){

    q = (q||"").toLowerCase();
    const res=[];

    for(const e of this.entities.values()){

      const t=JSON.stringify(e).toLowerCase();

      if(t.includes(q)) res.push(e);

    }

    return res;

  },

  list(){
    return Array.from(this.entities.values());
  }

};

/* ===============================
SEARCH BANK EXTENSION PART 7-9
Router + Graph Bridge + Semantic Search
================================ */

(function(){

  const root = typeof global!=="undefined"?global:window;
  const core = root.SearchBankExtensionCore;

  if(!core) return;

  /* PART 7 */

  core.regionRouter = {

    route(entity){

      if(!entity) return null;

      const region = entity.region || "global";
      const sector = entity.sector || "general";

      if(!core.regions.get(region)){
        core.regions.register(region,{name:region});
      }

      if(!core.sectors.get(sector)){
        core.sectors.register(sector,{name:sector});
      }

      return {region,sector};

    },

    mapCountry(country){

      if(!core.worldRegions) return null;

      for(const r in core.worldRegions){
        if(core.worldRegions[r].includes(country)){
          return r;
        }
      }

      return null;

    }

  };

  /* PART 8 */

  core.graphBridge = {

    linkEntity(entity){

      if(!entity) return;

      const id = entity.globalId || entity.uuid;

      if(!id) return;

      if(entity.region){
        core.graph.link(id,entity.region,"region");
      }

      if(entity.sector){
        core.graph.link(id,entity.sector,"sector");
      }

      if(entity.country){

        const region = core.regionRouter.mapCountry(entity.country);

        if(region){
          core.graph.link(id,region,"region");
        }

      }

    },

    queryRelations(id){
      return core.graph.get(id);
    }

  };

  /* PART 9 */

  core.semanticSearch = function(query){

    query = (query || "").toLowerCase();
    const results = [];

    for(const e of core.globalIndex.list()){

      const text = JSON.stringify(e).toLowerCase();

      if(text.includes(query)){
        results.push(e);
        continue;
      }

      const links = core.graph.get(e.globalId || e.uuid);

      if(links){
        for(const l of links){
          if(JSON.stringify(l).toLowerCase().includes(query)){
            results.push(e);
            break;
          }
        }
      }
    }

    return results;

  };

})();

/* ===============================
SEARCH BANK EXTENSION PART 10-12
Planetary Router + Snapshot Sync + AI Learning Index
================================ */

(function(){

const root=typeof global!=="undefined"?global:window;
const core=root.SearchBankExtensionCore;
if(!core) return;

/* ===============================
PART 10
Planetary Data Router
================================ */

core.planetaryRouter={
  route(entity){
    if(!entity) return null;
    let region=entity.region;
    const sector=entity.sector||"general";
    if(!region && entity.country) region=core.regionRouter.mapCountry(entity.country);
    if(!region) region="global";
    if(!core.regions.get(region)) core.regions.register(region,{name:region});
    if(!core.sectors.get(sector)) core.sectors.register(sector,{name:sector});
    return{region,sector,key:region+"."+sector};
  }
};

/* ===============================
PART 11
Snapshot Sync Layer
================================ */

core.snapshotSync={
  snapshots:new Map(),

  push(entity){
    if(!entity) return null;
    const route=core.planetaryRouter.route(entity);
    if(!route) return null;
    const key=route.key;
    if(!this.snapshots.has(key)){
      this.snapshots.set(key,{region:route.region,sector:route.sector,items:[]});
    }
    const bucket=this.snapshots.get(key);
    bucket.items.push({...entity,t:Date.now()});

    const limit=Date.now()-(1000*60*60*24*60);
    bucket.items=bucket.items.filter(x=>x.t>limit);

    return bucket;
  },

  get(region,sector){
    const key=region+"."+sector;
    return this.snapshots.get(key);
  },

  list(){
    return Array.from(this.snapshots.values());
  }
};

/* ===============================
PART 12
AI Learning Index
================================ */

core.aiLearning={
  relations:new Map(),

  learn(entity){
    if(!entity) return;
    const id=entity.globalId||entity.uuid;
    if(!id) return;
    const tokens=[];
    if(entity.name) tokens.push(entity.name);
    if(entity.sector) tokens.push(entity.sector);
    if(entity.region) tokens.push(entity.region);
    if(entity.country) tokens.push(entity.country);
    for(const t of tokens){
      const k=t.toLowerCase();
      if(!this.relations.has(k)) this.relations.set(k,new Set());
      this.relations.get(k).add(id);
    }
  },

  query(q){
    q=(q||"").toLowerCase();
    const set=this.relations.get(q);
    if(!set) return[];
    const res=[];
    for(const id of set){
      const e=core.globalIndex.get(id);
      if(e) res.push(e);
    }
    return res;
  }
};

global.SearchBankExtensionCore.queryIndex = {

  map:new Map(),

  add(item){

    const tokens = [];

    if(item.title) tokens.push(item.title);
    if(item.summary) tokens.push(item.summary);
    if(item.tags) tokens.push(...item.tags);

    for(const t of tokens){
      const k = String(t).toLowerCase();
      if(!this.map.has(k)) this.map.set(k,[]);
      this.map.get(k).push(item);
    }
  },

  search(q){

    q = (q||"").toLowerCase();

    const res = [];
    for(const [k,v] of this.map){
      if(k.includes(q)) res.push(...v);
    }

    return res;
  }

};

/* ===============================
AUTO PIPELINE
================================ */

core.pipeline=function(entity){
  if(!entity) return;
  const e=core.globalIndex.register(entity);
  if(!e) return;
  core.graphBridge.linkEntity(e);
  core.aiLearning.learn(e);
  core.snapshotSync.push(e);
  core.queryIndex.add(e);
  return e;
};

})();