"use strict";

/**
 * search-bank-index-engine.js
 * ------------------------------------------------------------
 * Search Bank Index — Sanmaru fast-memory layer
 *
 * Role
 * - Builds a lightweight searchable index from search-bank.snapshot.json.
 * - Answers fast local queries for Sanmaru before external adapters are opened.
 * - Accepts Sanmaru promotion/write-back into a promoted memory layer.
 * - Does not call external APIs and does not bypass permissions.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION = "search-bank-index-engine-v1.0.0-sanmaru-fast-memory";
const ENGINE_NAME = "search-bank-index";
const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 500;
const MAX_INDEX_ITEMS = 50000;
const PROMOTED_LIMIT = 5000;
const MAX_INDEX_TEXT_LENGTH = 1400;
const MAX_COMPACT_TOKEN_LENGTH = 260;
const INDEX_CACHE_TTL_MS = 5 * 60 * 1000;

const state = globalThis.__SEARCH_BANK_INDEX_STATE || (globalThis.__SEARCH_BANK_INDEX_STATE = {
  index: null,
  loadedAt: 0,
  promoted: [],
  promotedLoaded: false
});

function s(v){ return String(v == null ? "" : v); }
function low(v){ return s(v).trim().toLowerCase(); }
function nowMs(){ return Date.now(); }
function nowIso(){ return new Date().toISOString(); }
function stableHash(v){ return crypto.createHash("sha1").update(s(v)).digest("hex").slice(0, 16); }
function clampInt(v, d, min, max){
  const n = parseInt(v, 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : d));
}
function truthy(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  const x = low(v);
  return !!x && !["0","false","no","off","disabled","disable","null","undefined"].includes(x);
}
function unique(arr){ return Array.from(new Set((Array.isArray(arr) ? arr : []).filter(Boolean))); }
function stripHtml(v){ return s(v).replace(/<[^>]*>/g, " "); }
function compactSpaces(v){ return s(v).replace(/\s+/g, " ").trim(); }
function safeJsonParse(text, fallback){ try{ return JSON.parse(text); }catch(e){ return fallback; } }
function safeReadJson(file, fallback){ try{ if(!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8")); }catch(e){ return fallback; } }
function safeWriteJson(file, data){
  try{
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    return true;
  }catch(e){ return false; }
}

function candidatePaths(name){
  return unique([
    path.join(__dirname, name),
    path.join(__dirname, "data", name),
    path.join(process.cwd(), name),
    path.join(process.cwd(), "data", name),
    path.join("/tmp", name)
  ]);
}
function firstExistingPath(name){ return candidatePaths(name).find(p => fs.existsSync(p)) || candidatePaths(name)[0]; }
function snapshotPath(){ return firstExistingPath("search-bank.snapshot.json"); }
function repoIndexPath(){ return firstExistingPath("search-bank.index.json"); }
function tmpIndexPath(){ return path.join(process.env.SANMARU_INDEX_WRITABLE_DIR || "/tmp", "search-bank.index.json"); }
function tmpPromotedPath(){ return path.join(process.env.SANMARU_INDEX_WRITABLE_DIR || "/tmp", "search-bank.promoted.json"); }

function normalizeText(v){
  return stripHtml(v)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/[^\p{L}\p{N}\s가-힣ㄱ-ㅎㅏ-ㅣ_-]/gu, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function compactText(v){ return normalizeText(v).replace(/\s+/g, "").slice(0, MAX_COMPACT_TOKEN_LENGTH); }
function tokensOf(v){
  const normalized = normalizeText(v);
  const base = normalized.split(/\s+/).filter(Boolean);
  const compact = compactText(v);
  const grams = [];
  if(compact.length >= 2){
    for(const n of [2,3,4]){
      for(let i=0; i<=compact.length-n; i++) grams.push(compact.slice(i, i+n));
    }
  }
  return unique(base.concat(grams));
}
function domainOf(url){ try{ return new URL(s(url)).hostname.replace(/^www\./, ""); }catch(e){ return ""; } }
function firstNonEmpty(){
  for(const v of arguments){ const x = s(v).trim(); if(x) return x; }
  return "";
}
function asItems(snapshot){
  if(Array.isArray(snapshot)) return snapshot;
  if(!snapshot || typeof snapshot !== "object") return [];
  if(Array.isArray(snapshot.items)) return snapshot.items;
  if(Array.isArray(snapshot.results)) return snapshot.results;
  if(Array.isArray(snapshot.data)) return snapshot.data;
  if(snapshot.data && Array.isArray(snapshot.data.items)) return snapshot.data.items;
  if(snapshot.snapshot && Array.isArray(snapshot.snapshot.items)) return snapshot.snapshot.items;
  return [];
}
function pickIndexText(item){
  item = item || {};
  return [
    item.title, item.name, item.label,
    item.summary, item.description, item.snippet, item.content,
    item.category, item.type, item.searchCategory, item.displayGroup,
    item.source, item.provider, item.url, item.link,
    Array.isArray(item.tags) ? item.tags.slice(0, 20).join(" ") : "",
    Array.isArray(item.keywords) ? item.keywords.slice(0, 20).join(" ") : ""
  ].filter(Boolean).join(" ").slice(0, MAX_INDEX_TEXT_LENGTH);
}
function buildSynonyms(item, text){
  const t = normalizeText(text);
  const source = normalizeText(firstNonEmpty(item && item.source, item && item.provider));
  const url = normalizeText(firstNonEmpty(item && item.url, item && item.link));
  const out = [];
  const pairs = [
    ["서울", "seoul"], ["부산", "busan"], ["제주", "jeju"], ["한국", "korea"], ["대한민국", "korea"],
    ["관광", "travel"], ["여행", "travel"], ["맛집", "restaurant"], ["호텔", "hotel"], ["축제", "festival"],
    ["영상", "video"], ["동영상", "video"], ["유튜브", "youtube"], ["이미지", "image"], ["사진", "image"],
    ["뉴스", "news"], ["지도", "map"], ["쇼핑", "shopping"], ["도서", "book"], ["책", "book"],
    ["웹툰", "webtoon"], ["금융", "finance"], ["스포츠", "sports"]
  ];
  for(const [a,b] of pairs){
    if(t.includes(a)) out.push(b);
    if(t.includes(b)) out.push(a);
  }
  if(source.includes("youtube") || url.includes("youtube") || url.includes("youtu be")) out.push("youtube", "유튜브", "video", "영상");
  if(source.includes("naver") || url.includes("naver")) out.push("naver", "네이버");
  if(source.includes("google") || url.includes("google")) out.push("google", "구글");
  if(source.includes("bing") || url.includes("bing")) out.push("bing", "빙");
  return unique(out.map(normalizeText));
}
function classify(item, text){
  const t = normalizeText(text);
  const url = normalizeText(firstNonEmpty(item && item.url, item && item.link));
  const source = normalizeText(firstNonEmpty(item && item.source, item && item.provider));
  const type = normalizeText(firstNonEmpty(item && item.searchCategory, item && item.type, item && item.category, item && item.mediaType));

  let searchCategory = "web";
  if(source.includes("youtube") || url.includes("youtube") || url.includes("youtu be") || type === "video" || /영상|동영상|video|youtube|유튜브/.test(t)) searchCategory = "video";
  else if(type === "image" || source.includes("image") || /이미지|사진|photo|image/.test(t)) searchCategory = "image";
  else if(type === "news" || source.includes("news") || /뉴스|신문|속보|news/.test(t)) searchCategory = "news";
  else if(type === "local" || type === "map" || /지도|주소|위치|관광|여행|맛집|hotel|travel|map/.test(t)) searchCategory = "tour";
  else if(type === "shopping" || /쇼핑|구매|가격|상품|shopping|buy|price/.test(t)) searchCategory = "shopping";
  else if(type === "book" || /도서|책|book|author/.test(t)) searchCategory = "book";
  else if(type === "finance" || /금융|주식|증권|환율|finance|stock|market/.test(t)) searchCategory = "finance";
  else if(type === "sports" || /스포츠|축구|야구|농구|sports/.test(t)) searchCategory = "sports";
  else if(type === "webtoon" || /웹툰|만화|comic|manga|webtoon/.test(t)) searchCategory = "webtoon";
  else if(type === "blog" || type === "cafe" || /블로그|카페|커뮤니티|blog|cafe|community/.test(t)) searchCategory = "community";
  else if(type === "knowledge" || /지식|백과|논문|연구|wiki|knowledge|research/.test(t)) searchCategory = "knowledge";

  const displayGroup = ({
    video:"media", image:"media", news:"news", tour:"local_tour", map:"local_tour", local:"local_tour",
    shopping:"shopping", book:"knowledge", knowledge:"knowledge", finance:"finance", sports:"sports", webtoon:"webtoon",
    community:"community", blog:"community", cafe:"community"
  })[searchCategory] || "web";

  return { displayGroup, searchCategory };
}
function sourceTrust(item){
  const source = low(firstNonEmpty(item && item.source, item && item.provider));
  const url = low(firstNonEmpty(item && item.url, item && item.link));
  const d = domainOf(url);
  if(/\.go\.kr$|\.gov$|\.or\.kr$|\.edu$|\.ac\.kr$/.test(d)) return 0.9;
  if(source.includes("search-bank") || source.includes("sanmaru")) return 0.78;
  if(source.includes("naver") || source.includes("google") || source.includes("bing") || source.includes("youtube")) return 0.72;
  return 0.55;
}
function canonicalItem(item, query, fallbackSource){
  item = item || {};
  const url = firstNonEmpty(item.url, item.link, item.href, "#");
  const title = firstNonEmpty(item.title, item.name, item.label, query, "Untitled");
  const summary = firstNonEmpty(item.summary, item.description, item.snippet, item.content, "");
  const image = firstNonEmpty(item.thumbnail, item.thumb, item.image, item.poster, item.cover, item.media && item.media.poster);
  return Object.assign({}, item, {
    id: firstNonEmpty(item.id, stableHash([title, url, fallbackSource].join("|"))),
    title,
    url,
    link: firstNonEmpty(item.link, url),
    summary,
    snippet: firstNonEmpty(item.snippet, summary),
    source: firstNonEmpty(item.source, item.provider, fallbackSource, "search-bank"),
    thumbnail: firstNonEmpty(item.thumbnail, item.thumb, image),
    image: firstNonEmpty(item.image, image)
  });
}
function indexItem(raw, i, source){
  const item = canonicalItem(raw, "", source || "search-bank");
  const indexText = pickIndexText(item);
  const normalizedText = normalizeText(indexText);
  const joinedText = compactText(indexText);
  const toks = tokensOf(indexText);
  const synonyms = buildSynonyms(item, indexText);
  const c = classify(item, indexText);
  const rankHint = Number.isFinite(Number(item.priority)) ? Number(item.priority) : (Number.isFinite(Number(item.rankHint)) ? Number(item.rankHint) : 0);
  return Object.assign({}, item, c, {
    indexId: firstNonEmpty(item.indexId, item.id, stableHash([item.title, item.url, i].join("|"))),
    indexText,
    normalizedText,
    joinedText,
    tokens: unique(toks.concat(synonyms)),
    joinedTokens: unique([joinedText].concat(tokensOf(joinedText))),
    synonyms,
    rankHint,
    sourceTrust: Number.isFinite(Number(item.sourceTrust)) ? Number(item.sourceTrust) : sourceTrust(item),
    indexedAt: nowIso()
  });
}
function buildIndexFromSnapshot(){
  const snap = safeReadJson(snapshotPath(), null);
  const rawItems = asItems(snap).slice(0, MAX_INDEX_ITEMS);
  const items = rawItems.map((x,i) => indexItem(x, i, "search-bank")).filter(Boolean);
  return {
    status:"ok",
    engine: ENGINE_NAME,
    version: VERSION,
    generatedAt: nowIso(),
    source:"search-bank.snapshot.json",
    count: items.length,
    items
  };
}
function loadPromoted(){
  if(state.promotedLoaded) return state.promoted || [];
  state.promotedLoaded = true;
  const saved = safeReadJson(tmpPromotedPath(), []);
  state.promoted = Array.isArray(saved) ? saved.slice(0, PROMOTED_LIMIT) : [];
  return state.promoted;
}
function loadIndex(forceBuild){
  loadPromoted();
  if(!forceBuild && state.index && nowMs() - state.loadedAt < INDEX_CACHE_TTL_MS) return state.index;
  const saved = safeReadJson(tmpIndexPath(), null) || safeReadJson(repoIndexPath(), null);
  if(saved && Array.isArray(saved.items)){
    state.index = saved;
    state.loadedAt = nowMs();
    return state.index;
  }
  state.index = buildIndexFromSnapshot();
  state.loadedAt = nowMs();
  safeWriteJson(tmpIndexPath(), state.index);
  return state.index;
}
function scoreIndexedItem(qInfo, item, type){
  let score = 0;
  const n = item.normalizedText || normalizeText(item.indexText || "");
  const j = item.joinedText || compactText(n);
  const itemTokens = new Set((item.tokens || []).concat(item.synonyms || []));
  if(n.includes(qInfo.normalized)) score += 50;
  if(j && qInfo.joined && j.includes(qInfo.joined)) score += 45;
  for(const t of qInfo.tokens){
    if(!t) continue;
    if(itemTokens.has(t)) score += t.length >= 4 ? 12 : 8;
    else if(n.includes(t)) score += 5;
  }
  for(const t of qInfo.synonyms){ if(itemTokens.has(t) || n.includes(t)) score += 7; }
  if(type && type !== "all" && [item.searchCategory, item.displayGroup, item.type, item.category].map(low).includes(type)) score += 18;
  score += Math.max(0, Math.min(20, Number(item.rankHint || 0)));
  score += Math.max(0, Math.min(10, Number(item.sourceTrust || 0) * 10));
  if(item._promoted) score += 16;
  return score;
}
function queryIndex(params){
  const started = nowMs();
  const q = firstNonEmpty(params && params.q, params && params.query);
  const normalized = normalizeText(q);
  if(!normalized) return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:q, items:[], results:[], meta:{ count:0, reason:"EMPTY_QUERY" } };
  const limit = clampInt(params && params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const type = low(firstNonEmpty(params && (params.type || params.category || params.tab || params.vertical), "all")) || "all";
  const qInfo = { normalized, joined: compactText(q), tokens: tokensOf(q), synonyms: buildSynonyms({}, q) };
  const idx = loadIndex(false);
  const promoted = loadPromoted().map((x,i) => indexItem(Object.assign({}, x, { _promoted:true }), i, "sanmaru-promoted"));
  const pool = promoted.concat(Array.isArray(idx.items) ? idx.items : []);
  const seen = new Set();
  const ranked = [];
  for(const item of pool){
    const sc = scoreIndexedItem(qInfo, item, type);
    if(sc <= 0) continue;
    const sig = firstNonEmpty(item.url, item.link, item.title, item.indexId);
    if(seen.has(sig)) continue;
    seen.add(sig);
    ranked.push(Object.assign({}, item, { sanmaruIndexScore: sc }));
  }
  ranked.sort((a,b) => (b.sanmaruIndexScore || 0) - (a.sanmaruIndexScore || 0));
  const items = ranked.slice(0, limit).map(x => {
    const y = Object.assign({}, x);
    delete y.normalizedText;
    delete y.joinedText;
    return y;
  });
  return {
    status:"ok",
    engine: ENGINE_NAME,
    version: VERSION,
    query:q,
    source: items.length ? "search-bank-index" : null,
    items,
    results:items,
    meta:{
      count:items.length,
      requestedLimit:limit,
      totalIndexed: Array.isArray(idx.items) ? idx.items.length : 0,
      promoted: promoted.length,
      type,
      latency: nowMs() - started,
      fastMemory:true
    }
  };
}
function promote(payload){
  const started = nowMs();
  const incoming = Array.isArray(payload && payload.items) ? payload.items : [];
  const q = firstNonEmpty(payload && payload.q, payload && payload.query);
  const promoted = loadPromoted();
  const merged = [];
  const seen = new Set();
  for(const item of incoming.concat(promoted)){
    if(!item) continue;
    const c = canonicalItem(item, q, "sanmaru-promoted");
    const sig = firstNonEmpty(c.url, c.link, c.title, c.id);
    if(seen.has(sig)) continue;
    seen.add(sig);
    merged.push(Object.assign({}, c, { _promoted:true, promotedAt: nowIso(), promotedQuery:q }));
    if(merged.length >= PROMOTED_LIMIT) break;
  }
  state.promoted = merged;
  state.promotedLoaded = true;
  const persisted = safeWriteJson(tmpPromotedPath(), merged);
  return { status:"ok", engine:ENGINE_NAME, version:VERSION, promoted:incoming.length, totalPromoted:merged.length, persisted, latency: nowMs() - started };
}
function health(){
  const idx = loadIndex(false);
  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    snapshotPath:snapshotPath(),
    indexPath:tmpIndexPath(),
    indexCount:idx && Array.isArray(idx.items) ? idx.items.length : 0,
    promotedCount:loadPromoted().length,
    cacheLoaded:!!state.index,
    generatedAt:nowIso()
  };
}
function ok(body){
  return { statusCode:200, headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store, no-cache, must-revalidate, max-age=0",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"content-type",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
  }, body:JSON.stringify(body) };
}
function parseBody(event){
  try{
    const raw = event && event.body;
    if(!raw) return {};
    const text = event && event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : s(raw);
    return safeJsonParse(text, {});
  }catch(e){ return {}; }
}
async function runEngine(event, params){
  const qs = (event && event.queryStringParameters) || {};
  const merged = Object.assign({}, qs, params || {});
  const action = low(firstNonEmpty(merged.action, merged.mode, merged.fn, "query"));
  if(action === "health") return health();
  if(action === "build" || action === "rebuild"){
    state.index = buildIndexFromSnapshot();
    state.loadedAt = nowMs();
    const persisted = safeWriteJson(tmpIndexPath(), state.index);
    return Object.assign({}, state.index, { persisted, indexPath:tmpIndexPath() });
  }
  if(action === "promote") return promote(merged);
  return queryIndex(merged);
}
async function handler(event){
  if(event && event.httpMethod === "OPTIONS") return ok({ status:"ok" });
  const body = parseBody(event || {});
  const res = await runEngine(event || {}, body);
  return ok(res);
}

module.exports = { version:VERSION, runEngine, handler, query:queryIndex, promote, health, buildIndexFromSnapshot };
exports.version = VERSION;
exports.runEngine = runEngine;
exports.handler = handler;
exports.query = queryIndex;
exports.promote = promote;
exports.health = health;
