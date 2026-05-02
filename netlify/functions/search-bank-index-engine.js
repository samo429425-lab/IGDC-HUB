"use strict";

/**
 * search-bank-index-engine.js
 * ------------------------------------------------------------
 * Search Bank Index — Sanmaru fast-memory / front-data index layer
 *
 * Role
 * - Builds a searchable index from search-bank.snapshot.json and nested front data.
 * - Answers fast local queries for Sanmaru before external mounts are opened.
 * - Accepts Sanmaru promotion/write-back and front data ingestion.
 * - Supports large candidate pools, pagination, grouping diagnostics, and placeholder filtering.
 * - Does not call external APIs and does not bypass permissions.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION = "search-bank-index-engine-v2.0.1-query-spacing-category-memory";
const ENGINE_NAME = "search-bank-index";

const DEFAULT_LIMIT = 1000;
const DEFAULT_PER_PAGE = 15;
const MAX_LIMIT = 8000;
const MAX_PER_PAGE = 200;
const MAX_INDEX_ITEMS = 200000;
const PROMOTED_LIMIT = 25000;
const INGESTED_LIMIT = 100000;
const MAX_INDEX_TEXT_LENGTH = 2400;
const MAX_COMPACT_TOKEN_LENGTH = 420;
const INDEX_CACHE_TTL_MS = 3 * 60 * 1000;
const RUNTIME_CACHE_TTL_MS = 3 * 60 * 1000;

const state = globalThis.__SEARCH_BANK_INDEX_STATE || (globalThis.__SEARCH_BANK_INDEX_STATE = {
  index: null,
  loadedAt: 0,
  runtime: null,
  runtimeBuiltAt: 0,
  promoted: [],
  promotedLoaded: false,
  ingested: [],
  ingestedLoaded: false
});

function s(v){ return String(v == null ? "" : v); }
function low(v){ return s(v).trim().toLowerCase(); }
function nowMs(){ return Date.now(); }
function nowIso(){ return new Date().toISOString(); }
function stableHash(v){ return crypto.createHash("sha1").update(s(v)).digest("hex").slice(0, 20); }
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
function stripHtml(v){ return s(v).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "); }
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
function parseMaybeJson(v, fallback){
  if(Array.isArray(v) || (v && typeof v === "object")) return v;
  const text = s(v).trim();
  if(!text) return fallback;
  if((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) return safeJsonParse(text, fallback);
  return fallback;
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
function writableDir(){ return process.env.SANMARU_INDEX_WRITABLE_DIR || "/tmp"; }
function snapshotPath(){ return firstExistingPath("search-bank.snapshot.json"); }
function repoIndexPath(){ return firstExistingPath("search-bank.index.json"); }
function tmpIndexPath(){ return path.join(writableDir(), "search-bank.index.json"); }
function tmpPromotedPath(){ return path.join(writableDir(), "search-bank.promoted.json"); }
function tmpIngestedPath(){ return path.join(writableDir(), "search-bank.ingested.json"); }

function normalizeText(v){
  return stripHtml(v)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
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
    for(const n of [2,3,4,5]){
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
function normalizeUrl(url){
  const raw = firstNonEmpty(url, "");
  if(!raw || raw === "#") return "";
  try{
    const u = new URL(raw);
    u.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"].forEach(k => u.searchParams.delete(k));
    return u.toString();
  }catch(e){ return raw; }
}

function extractArraysFromObject(obj, depth, out, sourceHint){
  if(!obj || typeof obj !== "object" || depth > 6 || out.length >= MAX_INDEX_ITEMS) return;

  if(Array.isArray(obj)){
    for(const x of obj){
      if(out.length >= MAX_INDEX_ITEMS) break;
      if(x && typeof x === "object"){
        if(looksLikeItem(x)) out.push(withSourceHint(x, sourceHint));
        else extractArraysFromObject(x, depth + 1, out, sourceHint);
      }
    }
    return;
  }

  const directKeys = ["items", "results", "data", "records", "cards", "list", "rows", "contents", "searchItems", "sections"];
  for(const key of directKeys){
    const v = obj[key];
    if(Array.isArray(v)) extractArraysFromObject(v, depth + 1, out, sourceHint || key);
    else if(v && typeof v === "object") extractArraysFromObject(v, depth + 1, out, sourceHint || key);
    if(out.length >= MAX_INDEX_ITEMS) return;
  }

  const route = firstNonEmpty(obj.route, obj.path, obj.slug, obj.page, obj.pageId, obj.lang, obj.locale);
  for(const [key, value] of Object.entries(obj)){
    if(out.length >= MAX_INDEX_ITEMS) break;
    if(!value || key === "meta" || key === "config" || key === "settings") continue;
    if(Array.isArray(value)) extractArraysFromObject(value, depth + 1, out, route || sourceHint || key);
    else if(value && typeof value === "object" && depth < 4) extractArraysFromObject(value, depth + 1, out, route || sourceHint || key);
  }
}
function looksLikeItem(x){
  if(!x || typeof x !== "object") return false;
  return !!(x.title || x.name || x.label || x.url || x.link || x.href || x.summary || x.description || x.snippet || x.content || x.thumbnail || x.image);
}
function withSourceHint(item, hint){
  if(!hint) return item;
  return Object.assign({ _sourceHint: hint }, item);
}
function asItems(snapshot){
  const out = [];
  if(Array.isArray(snapshot)) extractArraysFromObject(snapshot, 0, out, "snapshot-array");
  else if(snapshot && typeof snapshot === "object") extractArraysFromObject(snapshot, 0, out, "snapshot-object");
  return out.slice(0, MAX_INDEX_ITEMS);
}

function pickIndexText(item){
  item = item || {};
  const payload = item.payload && typeof item.payload === "object" ? item.payload : {};
  const nested = item.data && typeof item.data === "object" ? item.data : {};
  return [
    item.title, item.name, item.label, item.heading,
    item.summary, item.description, item.snippet, item.content, item.text,
    item.category, item.type, item.searchCategory, item.displayGroup, item.displayGroupLabel,
    item.source, item.provider, item.url, item.link, item.href,
    item.lang, item.locale, item.route, item.path, item.page, item._sourceHint,
    payload.title, payload.summary, payload.description, payload.url,
    nested.title, nested.summary, nested.description, nested.url,
    Array.isArray(item.tags) ? item.tags.slice(0, 60).join(" ") : "",
    Array.isArray(item.keywords) ? item.keywords.slice(0, 60).join(" ") : "",
    Array.isArray(item.synonyms) ? item.synonyms.slice(0, 60).join(" ") : ""
  ].filter(Boolean).join(" ").slice(0, MAX_INDEX_TEXT_LENGTH);
}
function buildSynonyms(item, text){
  const t = normalizeText(text);
  const source = normalizeText(firstNonEmpty(item && item.source, item && item.provider));
  const url = normalizeText(firstNonEmpty(item && item.url, item && item.link, item && item.href));
  const out = [];
  const pairs = [
    ["서울", "seoul"], ["부산", "busan"], ["제주", "jeju"], ["인천", "incheon"], ["대구", "daegu"], ["광주", "gwangju"], ["대전", "daejeon"], ["울산", "ulsan"],
    ["한국", "korea"], ["대한민국", "korea"], ["일본", "japan"], ["중국", "china"], ["미국", "usa"],
    ["관광", "travel"], ["여행", "travel"], ["맛집", "restaurant"], ["음식", "food"], ["호텔", "hotel"], ["숙박", "hotel"], ["축제", "festival"],
    ["영상", "video"], ["동영상", "video"], ["유튜브", "youtube"], ["이미지", "image"], ["사진", "image"], ["뉴스", "news"], ["지도", "map"],
    ["쇼핑", "shopping"], ["상품", "product"], ["가격", "price"], ["도서", "book"], ["책", "book"], ["웹툰", "webtoon"],
    ["금융", "finance"], ["주식", "stock"], ["스포츠", "sports"], ["블로그", "blog"], ["카페", "cafe"], ["커뮤니티", "community"],
    ["지식", "knowledge"], ["백과", "encyclopedia"], ["논문", "paper"], ["연구", "research"], ["AI", "artificial intelligence"], ["인공지능", "ai"]
  ];
  for(const [a,b] of pairs){
    if(t.includes(normalizeText(a))) out.push(b);
    if(t.includes(normalizeText(b))) out.push(a);
  }
  if(source.includes("youtube") || url.includes("youtube") || url.includes("youtu be") || url.includes("youtu.be")) out.push("youtube", "유튜브", "video", "영상", "동영상");
  if(source.includes("naver") || url.includes("naver")) out.push("naver", "네이버", "blog", "cafe", "kin");
  if(source.includes("google") || url.includes("google")) out.push("google", "구글");
  if(source.includes("bing") || url.includes("bing")) out.push("bing", "빙");
  return unique(out.map(normalizeText));
}
function classify(item, text){
  const t = normalizeText(text);
  const url = normalizeText(firstNonEmpty(item && item.url, item && item.link, item && item.href));
  const source = normalizeText(firstNonEmpty(item && item.source, item && item.provider));
  const type = normalizeText(firstNonEmpty(item && item.searchCategory, item && item.type, item && item.category, item && item.mediaType));
  const d = domainOf(firstNonEmpty(item && item.url, item && item.link, item && item.href));

  let searchCategory = "web";
  if(source.includes("youtube") || url.includes("youtube") || url.includes("youtu.be") || type === "video" || /영상|동영상|video|youtube|유튜브/.test(t)) searchCategory = "video";
  else if(type === "image" || source.includes("image") || /이미지|사진|photo|image|thumbnail/.test(t)) searchCategory = "image";
  else if(type === "news" || source.includes("news") || /뉴스|신문|속보|news|press/.test(t)) searchCategory = "news";
  else if(type === "local" || type === "map" || /지도|주소|위치|관광|여행|맛집|hotel|travel|map|local|place/.test(t)) searchCategory = "tour";
  else if(type === "shopping" || /쇼핑|구매|가격|상품|shopping|buy|price|product|commerce/.test(t)) searchCategory = "shopping";
  else if(type === "book" || /도서|책|book|author|isbn/.test(t)) searchCategory = "book";
  else if(type === "finance" || /금융|주식|증권|환율|finance|stock|market|crypto/.test(t)) searchCategory = "finance";
  else if(type === "sports" || /스포츠|축구|야구|농구|sports|score/.test(t)) searchCategory = "sports";
  else if(type === "webtoon" || /웹툰|만화|comic|manga|webtoon/.test(t)) searchCategory = "webtoon";
  else if(type === "blog" || type === "cafe" || source.includes("blog") || source.includes("cafe") || /블로그|카페|커뮤니티|blog|cafe|community|forum/.test(t)) searchCategory = "community";
  else if(type === "knowledge" || /지식|백과|논문|연구|wiki|knowledge|research|paper|encyclopedia/.test(t)) searchCategory = "knowledge";
  else if(/\.go\.kr$|\.gov$|\.or\.kr$|\.edu$|\.ac\.kr$/.test(d)) searchCategory = "official";

  const displayGroup = ({
    official:"official", video:"media", image:"media", news:"news", tour:"local_tour", map:"local_tour", local:"local_tour",
    shopping:"shopping", book:"knowledge", knowledge:"knowledge", finance:"finance", sports:"sports", webtoon:"webtoon",
    community:"community", blog:"community", cafe:"community"
  })[searchCategory] || "web";

  const label = ({
    official:"공식/권위", media:"이미지/영상", news:"뉴스", local_tour:"지도/관광/지역", shopping:"쇼핑", knowledge:"지식/도서",
    finance:"금융", sports:"스포츠", webtoon:"웹툰", community:"블로그/카페/커뮤니티", web:"웹"
  })[displayGroup] || "웹";

  return { displayGroup, displayGroupLabel: label, searchCategory };
}
function sourceTrust(item){
  const source = low(firstNonEmpty(item && item.source, item && item.provider));
  const url = low(firstNonEmpty(item && item.url, item && item.link, item && item.href));
  const d = domainOf(url);
  if(/\.go\.kr$|\.gov$|\.or\.kr$|\.edu$|\.ac\.kr$/.test(d)) return 0.92;
  if(source.includes("search-bank") || source.includes("sanmaru")) return 0.80;
  if(source.includes("naver") || source.includes("google") || source.includes("bing") || source.includes("youtube")) return 0.74;
  if(url && url !== "#") return 0.60;
  return 0.48;
}
function isPlaceholder(item){
  const text = normalizeText([item && item.title, item && item.name, item && item.label, item && item.summary, item && item.description, item && item.url, item && item.source, item && item.id].filter(Boolean).join(" "));
  const url = firstNonEmpty(item && item.url, item && item.link, item && item.href);
  if(!text) return true;
  if(text.length < 2) return true;
  if(/seed\s*placeholder|placeholder|movie\s*slot|media\s*movie\s*0|mediamovie0|dummy|sample\s*item|test\s*item|lorem\s*ipsum|untitled/.test(text)) return true;
  if((!url || url === "#") && !firstNonEmpty(item && item.title, item && item.name, item && item.summary, item && item.description)) return true;
  return false;
}
function canonicalItem(item, query, fallbackSource){
  item = item || {};
  const url = normalizeUrl(firstNonEmpty(item.url, item.link, item.href, ""));
  const title = firstNonEmpty(item.title, item.name, item.label, item.heading, query, "Untitled");
  const summary = firstNonEmpty(item.summary, item.description, item.snippet, item.content, item.text, "");
  const image = firstNonEmpty(item.thumbnail, item.thumb, item.image, item.poster, item.cover, item.media && item.media.poster);
  const source = firstNonEmpty(item.source, item.provider, fallbackSource, item._sourceHint, "search-bank");
  const idBase = firstNonEmpty(item.id, item.indexId, url, title + "|" + source);
  return Object.assign({}, item, {
    id: stableHash(idBase),
    originalId: firstNonEmpty(item.id, item.indexId),
    title,
    url: url || firstNonEmpty(item.url, item.link, item.href, "#"),
    link: firstNonEmpty(item.link, url || item.url || "#"),
    summary,
    snippet: firstNonEmpty(item.snippet, summary),
    source,
    provider: firstNonEmpty(item.provider, source),
    thumbnail: firstNonEmpty(item.thumbnail, item.thumb, image),
    image: firstNonEmpty(item.image, image),
    route: firstNonEmpty(item.route, item.path, item.page, item._sourceHint),
    lang: firstNonEmpty(item.lang, item.locale)
  });
}
function indexItem(raw, i, source){
  const item = canonicalItem(raw, "", source || "search-bank");
  if(isPlaceholder(item)) return null;
  const indexText = pickIndexText(item);
  const normalizedText = normalizeText(indexText);
  if(!normalizedText) return null;
  const joinedText = compactText(indexText);
  const toks = tokensOf(indexText);
  const synonyms = buildSynonyms(item, indexText);
  const c = classify(item, indexText);
  const rankHint = Number.isFinite(Number(item.priority)) ? Number(item.priority) : (Number.isFinite(Number(item.rankHint)) ? Number(item.rankHint) : 0);
  return Object.assign({}, item, c, {
    indexId: firstNonEmpty(item.indexId, item.id, stableHash([item.title, item.url, item.source, i].join("|"))),
    indexText,
    normalizedText,
    joinedText,
    tokens: unique(toks.concat(synonyms)).slice(0, 320),
    joinedTokens: unique([joinedText].concat(tokensOf(joinedText))).slice(0, 120),
    synonyms,
    rankHint,
    sourceTrust: Number.isFinite(Number(item.sourceTrust)) ? Number(item.sourceTrust) : sourceTrust(item),
    indexedAt: nowIso()
  });
}
function buildIndexFromSnapshot(){
  const snap = safeReadJson(snapshotPath(), null);
  const rawItems = asItems(snap).slice(0, MAX_INDEX_ITEMS);
  const indexed = [];
  const seen = new Set();
  let placeholderFiltered = 0;
  for(let i=0; i<rawItems.length; i++){
    const item = indexItem(rawItems[i], i, "search-bank");
    if(!item){ placeholderFiltered++; continue; }
    const sig = low(firstNonEmpty(item.url, item.link, item.title, item.indexId));
    if(!sig || seen.has(sig)) continue;
    seen.add(sig);
    indexed.push(item);
  }
  return {
    status:"ok",
    engine: ENGINE_NAME,
    version: VERSION,
    generatedAt: nowIso(),
    source:"search-bank.snapshot.json",
    rawCount: rawItems.length,
    placeholderFiltered,
    count: indexed.length,
    items:indexed
  };
}
function loadPromoted(){
  if(state.promotedLoaded) return state.promoted || [];
  state.promotedLoaded = true;
  const saved = safeReadJson(tmpPromotedPath(), []);
  state.promoted = Array.isArray(saved) ? saved.slice(0, PROMOTED_LIMIT) : [];
  return state.promoted;
}
function loadIngested(){
  if(state.ingestedLoaded) return state.ingested || [];
  state.ingestedLoaded = true;
  const saved = safeReadJson(tmpIngestedPath(), []);
  state.ingested = Array.isArray(saved) ? saved.slice(0, INGESTED_LIMIT) : [];
  return state.ingested;
}
function loadIndex(forceBuild){
  loadPromoted();
  loadIngested();
  if(!forceBuild && state.index && nowMs() - state.loadedAt < INDEX_CACHE_TTL_MS) return state.index;
  const saved = safeReadJson(tmpIndexPath(), null) || safeReadJson(repoIndexPath(), null);
  if(!forceBuild && saved && Array.isArray(saved.items)){
    state.index = saved;
    state.loadedAt = nowMs();
    return state.index;
  }
  state.index = buildIndexFromSnapshot();
  state.loadedAt = nowMs();
  safeWriteJson(tmpIndexPath(), state.index);
  state.runtime = null;
  return state.index;
}
function ensureRuntime(idx){
  if(state.runtime && nowMs() - state.runtimeBuiltAt < RUNTIME_CACHE_TTL_MS) return state.runtime;
  const tokenMap = new Map();
  const categoryMap = new Map();
  const groupMap = new Map();
  const sourceMap = new Map();
  const items = Array.isArray(idx && idx.items) ? idx.items : [];
  for(let i=0; i<items.length; i++){
    const item = items[i];
    const tokens = unique((item.tokens || []).concat(item.synonyms || [], item.joinedText ? [item.joinedText] : []));
    for(const token of tokens.slice(0, 220)){
      if(!token || token.length > 80) continue;
      if(!tokenMap.has(token)) tokenMap.set(token, []);
      tokenMap.get(token).push(i);
    }
    for(const [map, key] of [[categoryMap, item.searchCategory], [groupMap, item.displayGroup], [sourceMap, item.source]]){
      const k = low(key);
      if(!k) continue;
      if(!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    }
  }
  state.runtime = { tokenMap, categoryMap, groupMap, sourceMap, count: items.length };
  state.runtimeBuiltAt = nowMs();
  return state.runtime;
}
function scoreIndexedItem(qInfo, item, type){
  let score = 0;
  const n = item.normalizedText || normalizeText(item.indexText || "");
  const j = item.joinedText || compactText(n);
  const itemTokens = new Set((item.tokens || []).concat(item.synonyms || []));
  if(n === qInfo.normalized) score += 90;
  if(n.includes(qInfo.normalized)) score += 55;
  if(j && qInfo.joined && j.includes(qInfo.joined)) score += 48;
  if(low(item.title).includes(qInfo.normalized)) score += 35;
  for(const t of qInfo.tokens){
    if(!t) continue;
    if(itemTokens.has(t)) score += t.length >= 4 ? 14 : 9;
    else if(n.includes(t)) score += t.length >= 4 ? 7 : 4;
  }
  for(const t of qInfo.synonyms){ if(itemTokens.has(t) || n.includes(t)) score += 8; }
  if(type && type !== "all" && [item.searchCategory, item.displayGroup, item.type, item.category].map(low).includes(type)) score += 24;
  score += Math.max(0, Math.min(30, Number(item.rankHint || 0)));
  score += Math.max(0, Math.min(12, Number(item.sourceTrust || 0) * 12));
  if(item._promoted) score += 28;
  if(item._ingested) score += 12;
  return score;
}
function collectCandidateIndexes(qInfo, idx, runtime, type){
  const candidates = new Set();
  const addList = list => { for(const x of (list || [])){ candidates.add(x); if(candidates.size >= MAX_LIMIT * 3) break; } };
  for(const token of qInfo.tokens.concat(qInfo.synonyms, qInfo.joined ? [qInfo.joined] : [])){
    if(!token) continue;
    addList(runtime.tokenMap.get(token));
  }
  if(type && type !== "all"){
    addList(runtime.categoryMap.get(type));
    addList(runtime.groupMap.get(type));
  }
  if(candidates.size < 200){
    const items = Array.isArray(idx.items) ? idx.items : [];
    for(let i=0; i<items.length; i++){
      if(candidates.size >= Math.min(items.length, MAX_LIMIT * 3)) break;
      const n = items[i].normalizedText || "";
      const j = items[i].joinedText || "";
      if(n.includes(qInfo.normalized) || (qInfo.joined && j.includes(qInfo.joined))) candidates.add(i);
    }
  }
  return Array.from(candidates);
}
function stripPrivateIndexFields(item){
  const y = Object.assign({}, item);
  delete y.normalizedText;
  delete y.joinedText;
  delete y.tokens;
  delete y.joinedTokens;
  return y;
}
function facetCounts(items){
  const groups = {}, categories = {}, sources = {};
  for(const item of items || []){
    const g = item.displayGroup || "web";
    const c = item.searchCategory || "web";
    const so = item.source || "unknown";
    groups[g] = (groups[g] || 0) + 1;
    categories[c] = (categories[c] || 0) + 1;
    sources[so] = (sources[so] || 0) + 1;
  }
  return { groups, categories, sources };
}
function queryIndex(params){
  const started = nowMs();
  const q = firstNonEmpty(params && params.q, params && params.query);
  const queryVariants = queryTextVariants(q);
  const normalized = normalizeText(queryVariants.join(" "));
  if(!normalized) return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:q, items:[], results:[], meta:{ count:0, reason:"EMPTY_QUERY" } };

  const requestedLimit = clampInt(params && params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = clampInt(params && params.page, 1, 1, 100000);
  const perPageWasProvided = params && (params.perPage != null || params.pageSize != null || params.size != null);
  const perPage = clampInt(firstNonEmpty(params && params.perPage, params && params.pageSize, params && params.size), DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const offset = clampInt(params && params.offset, perPageWasProvided || page > 1 ? (page - 1) * perPage : 0, 0, 10000000);
  const sliceSize = perPageWasProvided || page > 1 ? perPage : requestedLimit;
  const type = low(firstNonEmpty(params && (params.type || params.category || params.tab || params.vertical), "all")) || "all";
  const includeFacets = truthy(params && (params.facets || params.includeFacets || params.debug));

  const qInfo = { normalized, joined: compactText(q), tokens: tokensOf(q), synonyms: buildSynonyms({}, q) };
  const idx = loadIndex(false);
  const runtime = ensureRuntime(idx);

  const promoted = loadPromoted().map((x,i) => indexItem(Object.assign({}, x, { _promoted:true }), i, "sanmaru-promoted")).filter(Boolean);
  const ingested = loadIngested().map((x,i) => indexItem(Object.assign({}, x, { _ingested:true }), i, "front-data-ingested")).filter(Boolean);
  const base = Array.isArray(idx.items) ? idx.items : [];
  const candidateIndexes = collectCandidateIndexes(qInfo, idx, runtime, type);
  const pool = promoted.concat(ingested).concat(candidateIndexes.map(i => base[i]).filter(Boolean));

  const seen = new Set();
  const ranked = [];
  let placeholderFiltered = 0;
  for(const item of pool){
    if(!item || isPlaceholder(item)){ placeholderFiltered++; continue; }
    const sc = scoreIndexedItem(qInfo, item, type);
    if(sc <= 0) continue;
    const sig = low(firstNonEmpty(normalizeUrl(item.url), normalizeUrl(item.link), item.title, item.indexId));
    if(seen.has(sig)) continue;
    seen.add(sig);
    ranked.push(Object.assign({}, item, { sanmaruIndexScore: sc }));
  }
  ranked.sort((a,b) => (b.sanmaruIndexScore || 0) - (a.sanmaruIndexScore || 0));

  const totalMatches = ranked.length;
  const pageItems = ranked.slice(offset, offset + sliceSize).map(stripPrivateIndexFields);
  const facets = includeFacets ? facetCounts(ranked) : undefined;
  const nextOffset = offset + pageItems.length;
  const hasMore = nextOffset < totalMatches;

  return {
    status:"ok",
    engine: ENGINE_NAME,
    version: VERSION,
    query:q,
    source: pageItems.length ? "search-bank-index" : null,
    items: pageItems,
    results: pageItems,
    meta:{
      count:pageItems.length,
      requestedLimit,
      queryVariants,
      page,
      perPage: perPageWasProvided || page > 1 ? perPage : null,
      offset,
      nextOffset: hasMore ? nextOffset : null,
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ offset:nextOffset, q, type })).toString("base64") : null,
      hasMore,
      totalMatches,
      totalPages: perPageWasProvided || page > 1 ? Math.ceil(totalMatches / perPage) : null,
      totalIndexed: base.length,
      promoted: promoted.length,
      ingested: ingested.length,
      type,
      placeholderFiltered,
      candidatePool: pool.length,
      latency: nowMs() - started,
      fastMemory:true,
      facets
    }
  };
}
function upsertMemory(payload, kind){
  const started = nowMs();
  let incoming = [];
  if(Array.isArray(payload && payload.items)) incoming = payload.items;
  else if(Array.isArray(payload && payload.results)) incoming = payload.results;
  else if(payload && payload.item) incoming = [payload.item];
  else {
    const parsedItems = parseMaybeJson(payload && firstNonEmpty(payload.items, payload.results, payload.item), null);
    if(Array.isArray(parsedItems)) incoming = parsedItems;
    else if(parsedItems && typeof parsedItems === "object") incoming = [parsedItems];
  }

  const q = firstNonEmpty(payload && payload.q, payload && payload.query);
  const targetLimit = kind === "promoted" ? PROMOTED_LIMIT : INGESTED_LIMIT;
  const current = kind === "promoted" ? loadPromoted() : loadIngested();
  const merged = [];
  const seen = new Set();

  for(const item of incoming.concat(current)){
    if(!item) continue;
    const c = canonicalItem(item, q, kind === "promoted" ? "sanmaru-promoted" : "front-data-ingested");
    if(isPlaceholder(c)) continue;
    const sig = low(firstNonEmpty(normalizeUrl(c.url), normalizeUrl(c.link), c.title, c.id));
    if(seen.has(sig)) continue;
    seen.add(sig);
    merged.push(Object.assign({}, c, kind === "promoted" ? { _promoted:true, promotedAt: nowIso(), promotedQuery:q } : { _ingested:true, ingestedAt: nowIso(), ingestedQuery:q }));
    if(merged.length >= targetLimit) break;
  }

  let persisted = false;
  if(kind === "promoted"){
    state.promoted = merged;
    state.promotedLoaded = true;
    persisted = safeWriteJson(tmpPromotedPath(), merged);
  }else{
    state.ingested = merged;
    state.ingestedLoaded = true;
    persisted = safeWriteJson(tmpIngestedPath(), merged);
  }
  return { status:"ok", engine:ENGINE_NAME, version:VERSION, action:kind === "promoted" ? "promote" : "ingest", received:incoming.length, total:merged.length, persisted, latency: nowMs() - started };
}
function promote(payload){ return upsertMemory(payload, "promoted"); }
function ingest(payload){ return upsertMemory(payload, "ingested"); }
function health(){
  const idx = loadIndex(false);
  const runtime = ensureRuntime(idx);
  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    role:"sanmaru-fast-memory-and-front-data-index",
    snapshotPath:snapshotPath(),
    indexPath:tmpIndexPath(),
    promotedPath:tmpPromotedPath(),
    ingestedPath:tmpIngestedPath(),
    indexCount:idx && Array.isArray(idx.items) ? idx.items.length : 0,
    promotedCount:loadPromoted().length,
    ingestedCount:loadIngested().length,
    runtimeTokenCount:runtime && runtime.tokenMap ? runtime.tokenMap.size : 0,
    cacheLoaded:!!state.index,
    generatedAt:nowIso()
  };
}
function ok(body){
  return { statusCode:200, headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store, no-cache, must-revalidate, max-age=0",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"content-type, authorization",
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
function parseCursorIntoParams(params){
  const cursor = firstNonEmpty(params && params.cursor);
  if(!cursor) return params || {};
  try{
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    return Object.assign({}, params || {}, { offset: parsed.offset || params.offset, q: params.q || parsed.q, query: params.query || parsed.q, type: params.type || parsed.type });
  }catch(e){ return params || {}; }
}
async function runEngine(event, params){
  const qs = (event && event.queryStringParameters) || {};
  const merged = parseCursorIntoParams(Object.assign({}, qs, params || {}));
  const action = low(firstNonEmpty(merged.action, merged.mode, merged.fn, "query"));
  if(action === "health") return health();
  if(action === "build" || action === "rebuild"){
    state.index = buildIndexFromSnapshot();
    state.loadedAt = nowMs();
    state.runtime = null;
    const persisted = safeWriteJson(tmpIndexPath(), state.index);
    const includeItems = truthy(merged.includeItems || merged.items);
    return includeItems ? Object.assign({}, state.index, { persisted, indexPath:tmpIndexPath() }) : {
      status:"ok", engine:ENGINE_NAME, version:VERSION, action:"build", persisted, indexPath:tmpIndexPath(), count:state.index.count, rawCount:state.index.rawCount, placeholderFiltered:state.index.placeholderFiltered, generatedAt:state.index.generatedAt
    };
  }
  if(action === "promote") return promote(merged);
  if(action === "ingest" || action === "upsert" || action === "hydrate") return ingest(merged);
  if(action === "stats" || action === "facets"){
    const res = queryIndex(Object.assign({}, merged, { includeFacets:true, limit:1 }));
    return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:res.query, meta:res.meta };
  }
  return queryIndex(merged);
}
async function handler(event){
  if(event && event.httpMethod === "OPTIONS") return ok({ status:"ok" });
  const body = parseBody(event || {});
  const res = await runEngine(event || {}, body);
  return ok(res);
}

module.exports = { version:VERSION, runEngine, handler, query:queryIndex, promote, ingest, health, buildIndexFromSnapshot };
exports.version = VERSION;
exports.runEngine = runEngine;
exports.handler = handler;
exports.query = queryIndex;
exports.promote = promote;
exports.ingest = ingest;
exports.health = health;
