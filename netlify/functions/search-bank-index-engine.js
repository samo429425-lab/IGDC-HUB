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

const VERSION = "search-bank-index-engine-v2.3.0-real-front-reservoir";
const ENGINE_NAME = "search-bank-index";

const DEFAULT_LIMIT = 1000;
const DEFAULT_PER_PAGE = 25;
const MAX_LIMIT = 15000;
const MAX_PER_PAGE = 200;
const MAX_INDEX_ITEMS = 200000;
const PROMOTED_LIMIT = 25000;
const INGESTED_LIMIT = 100000;
const MAX_INDEX_TEXT_LENGTH = 2400;
const MAX_COMPACT_TOKEN_LENGTH = 420;
const INDEX_CACHE_TTL_MS = 3 * 60 * 1000;
const RUNTIME_CACHE_TTL_MS = 3 * 60 * 1000;
const RESIDENT_WARM_TTL_MS = 30 * 60 * 1000;
const PLACEHOLDER_QUERY_PENALTY = -38;
const LAYER_POINTER_TRUST = 0.24;
const ACTIVE_POINTER_TRUST = 0.56;
const FRONT_SUPPLY_TARGET = 5000;
const SANMARU_SUPPLY_CAPACITY_TARGET = 15000;
const REAL_ITEM_MIN_SCORE = 35;
const TRUSTED_REAL_ITEM_SCORE = 70;
const MAX_TOKEN_GRAMS = 80;
const MAX_COMPACT_INDEX_LENGTH = 96;

const state = globalThis.__SEARCH_BANK_INDEX_STATE || (globalThis.__SEARCH_BANK_INDEX_STATE = {
  index: null,
  loadedAt: 0,
  runtime: null,
  runtimeBuiltAt: 0,
  promoted: [],
  promotedLoaded: false,
  ingested: [],
  ingestedLoaded: false,
  lastSnapshotStat: null,
  lastRuntimeStat: null,
  supplyPools: null,
  supplyPoolsBuiltAt: 0
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


function requestHeaders(event){ return (event && event.headers) || {}; }
function requestMethod(event){ return s(event && event.httpMethod || "GET").toUpperCase(); }
function firstNonEmpty(){
  for(const v of arguments){ const x = s(v).trim(); if(x) return x; }
  return "";
}
function requestToken(event, params){
  const h = requestHeaders(event);
  const auth = firstNonEmpty(h.authorization, h.Authorization);
  const bearer = auth && /^Bearer\s+(.+)$/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  return firstNonEmpty(params && (params.adminToken || params.token || params.sanmaruAdminToken || params.maruAdminToken), h["x-sanmaru-admin-token"], h["X-Sanmaru-Admin-Token"], bearer);
}
function adminTokenExpected(){ return firstNonEmpty(process.env.SANMARU_ADMIN_TOKEN, process.env.MARU_ADMIN_TOKEN, process.env.ADMIN_TOKEN); }
function isAuthorizedAdmin(event, params){
  const expected = adminTokenExpected();
  if(!expected) return false;
  const got = requestToken(event, params || {});
  if(!got) return false;
  try{
    const a = Buffer.from(s(got)); const b = Buffer.from(s(expected));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }catch(e){ return false; }
}
function protectedIndexAction(action){ return ["build","rebuild","promote","ingest","upsert","hydrate","export","download","archive","zip","dump","source-dump"].includes(low(action)); }
function guardIndexRequest(event, params, action){
  if(event && event.__sanmaruInternal === true) return { allowed:true, admin:true, internal:true };
  const text = low([action, params && params.format, params && params.download, params && params.export, params && params.archive, params && params.zip, params && params.path].join(" "));
  const suspicious = /source[-_ ]?dump|download|archive|zip|tar|backup|\.env|secret|token|private[_-]?key|process\.env/.test(text);
  if((protectedIndexAction(action) || suspicious) && !isAuthorizedAdmin(event, params || {})){
    return { allowed:false, status:"blocked", reason:suspicious ? "suspicious-source-or-secret-access" : "admin-token-required", safeMode:"fail-closed-read-only" };
  }
  return { allowed:true, admin:isAuthorizedAdmin(event, params || {}) };
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
  const base = normalized.split(/\s+/).filter(Boolean).slice(0, 120);
  const compact = compactText(v).slice(0, MAX_COMPACT_INDEX_LENGTH);
  const grams = [];
  if(compact.length >= 2){
    for(const n of [2,3,4]){
      for(let i=0; i<=compact.length-n; i++){
        grams.push(compact.slice(i, i+n));
        if(grams.length >= MAX_TOKEN_GRAMS) break;
      }
      if(grams.length >= MAX_TOKEN_GRAMS) break;
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

function slotDedupeSignature(item){
  item = item || {};
  const sigUrl = normalizeUrl(firstNonEmpty(item.url, item.link));
  if(sigUrl) return low(sigUrl);
  return low(firstNonEmpty(
    item.originalId,
    item.indexId,
    item.id,
    [
      item.title, item.name, item.source, item.provider, item.searchCategory, item.displayGroup,
      item.route, item.page, item.section, item.lang, item.locale, item.image, item.thumbnail, item.summary
    ].filter(Boolean).join("|")
  ));
}

function normalizeSourceValue(v){
  if(v == null) return "";
  if(typeof v === "string" || typeof v === "number" || typeof v === "boolean") return s(v).trim();
  if(Array.isArray(v)) return v.map(normalizeSourceValue).filter(Boolean).join(" ");
  if(typeof v === "object"){
    return firstNonEmpty(v.name, v.provider, v.engine, v.platform, v.type, v.id, v.key, v.label, v.url, v.href, v.source);
  }
  return s(v).trim();
}
function normalizeBindValue(v){
  return (v && typeof v === "object") ? v : {};
}
function routeValueOf(item){
  item = item || {};
  const bind = normalizeBindValue(item.bind);
  return firstNonEmpty(item.route, item.path, item.page, bind.page, bind.route, item._sourceHint);
}
function pageValueOf(item){
  item = item || {};
  const bind = normalizeBindValue(item.bind);
  return firstNonEmpty(item.page, bind.page, item.route, item.path, "");
}
function sectionValueOf(item){
  item = item || {};
  const bind = normalizeBindValue(item.bind);
  return firstNonEmpty(item.section, item.psom_key, bind.section, bind.key, bind.slot, item.category, item._sourceHint);
}
function slotKeyOf(item){
  item = item || {};
  const bind = normalizeBindValue(item.bind);
  return firstNonEmpty(item.slotKey, item.slot, item.psom_key, bind.slotKey, bind.slot, bind.section, item.section, item.id);
}
function layerRoleOf(item){
  item = item || {};
  const text = normalizeText([item.page, item.section, item.psom_key, item.category, item.type, item.route, item._sourceHint, item.id].filter(Boolean).join(" "));
  if(/global\s*insight|insight/.test(text)) return "global-insight-layer";
  if(/search|query/.test(text)) return "search-layer";
  if(/home|network|distribution|social|media|tour|literature|academic|donation|front|slot/.test(text)) return "front-supply-layer";
  return "general-information-layer";
}
function layerPointerOf(item){
  item = item || {};
  const page = pageValueOf(item);
  const section = sectionValueOf(item);
  const slotKey = slotKeyOf(item);
  const route = routeValueOf(item);
  const sourceName = normalizeSourceValue(firstNonEmpty(item.source, item.provider, item.engine, item._sourceHint));
  return {
    layerRole: layerRoleOf(item),
    page: page || null,
    section: section || null,
    slotKey: slotKey || null,
    route: route || null,
    source: sourceName || null,
    storagePolicy: "index-pointer-and-hot-memory-only",
    directStorage: false,
    externalCall: false
  };
}
function placeholderInfo(item){
  item = item || {};
  const text = normalizeText([item.title, item.name, item.label, item.summary, item.description, item.url, normalizeSourceValue(item.source), item.id].filter(Boolean).join(" "));
  const url = firstNonEmpty(item.url, item.link, item.href);
  const explicitSeed = /seed\s*placeholder|placeholder|movie\s*slot|media\s*movie\s*0|mediamovie0|dummy|sample\s*item|test\s*item|lorem\s*ipsum|untitled/.test(text);
  const emptyShell = (!text || text.length < 2 || ((!url || url === "#") && !firstNonEmpty(item.title, item.name, item.summary, item.description)));
  const frontSlot = !!firstNonEmpty(item.section, item.psom_key, item.page, item.route, item._sourceHint, item.bind && (item.bind.section || item.bind.page || item.bind.slot));
  return {
    isPlaceholder: !!(explicitSeed || emptyShell),
    explicitSeed,
    emptyShell,
    frontSlot,
    canIndexAsLayerPointer: !!((explicitSeed || emptyShell) && frontSlot),
    reason: explicitSeed ? "seed-placeholder" : (emptyShell ? "empty-shell" : "active-item")
  };
}
function isIndexableLayerPointer(item){
  const info = placeholderInfo(item);
  return !!info.canIndexAsLayerPointer;
}
function extractArraysFromObject(obj, depth, out, sourceHint, seen){
  if(!obj || typeof obj !== "object" || depth > 8 || out.length >= MAX_INDEX_ITEMS) return;
  seen = seen || new WeakSet();
  if(seen.has(obj)) return;
  seen.add(obj);

  if(Array.isArray(obj)){
    for(const x of obj){
      if(out.length >= MAX_INDEX_ITEMS) break;
      if(x && typeof x === "object"){
        if(looksLikeItem(x)) out.push(withSourceHint(x, sourceHint));
        else extractArraysFromObject(x, depth + 1, out, sourceHint, seen);
      }
    }
    return;
  }

  const directKeys = ["items", "results", "data", "records", "cards", "list", "rows", "contents", "searchItems", "sections"];
  const consumed = new Set();
  for(const key of directKeys){
    const v = obj[key];
    if(v == null) continue;
    consumed.add(key);
    if(Array.isArray(v)) extractArraysFromObject(v, depth + 1, out, sourceHint || key, seen);
    else if(v && typeof v === "object") extractArraysFromObject(v, depth + 1, out, sourceHint || key, seen);
    if(out.length >= MAX_INDEX_ITEMS) return;
  }

  const route = firstNonEmpty(obj.route, obj.path, obj.slug, obj.page, obj.pageId, obj.lang, obj.locale);
  for(const [key, value] of Object.entries(obj)){
    if(out.length >= MAX_INDEX_ITEMS) break;
    if(consumed.has(key)) continue;
    if(!value || key === "meta" || key === "config" || key === "settings") continue;
    if(Array.isArray(value)) extractArraysFromObject(value, depth + 1, out, route || sourceHint || key, seen);
    else if(value && typeof value === "object" && depth < 5) extractArraysFromObject(value, depth + 1, out, route || sourceHint || key, seen);
  }
}
function looksLikeItem(x){
  if(!x || typeof x !== "object") return false;
  return !!(x.title || x.name || x.label || x.url || x.link || x.href || x.summary || x.description || x.snippet || x.content || x.thumbnail || x.image || x.section || x.psom_key || x.page || x.bind);
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
    normalizeSourceValue(item.source), normalizeSourceValue(item.provider), item.url, item.link, item.href,
    item.lang, item.locale, item.route, item.path, item.page, item.section, item.psom_key, item.slot, item.slotKey, item._sourceHint,
    item.bind && item.bind.page, item.bind && item.bind.section, item.bind && item.bind.slot, item.bind && item.bind.key,
    payload.title, payload.summary, payload.description, payload.url,
    nested.title, nested.summary, nested.description, nested.url,
    Array.isArray(item.tags) ? item.tags.slice(0, 60).join(" ") : "",
    Array.isArray(item.keywords) ? item.keywords.slice(0, 60).join(" ") : "",
    Array.isArray(item.synonyms) ? item.synonyms.slice(0, 60).join(" ") : ""
  ].filter(Boolean).join(" ").slice(0, MAX_INDEX_TEXT_LENGTH);
}
function buildSynonyms(item, text){
  const t = normalizeText(text);
  const source = normalizeText(firstNonEmpty(normalizeSourceValue(item && item.source), normalizeSourceValue(item && item.provider)));
  const url = normalizeText(firstNonEmpty(item && item.url, item && item.link, item && item.href));
  const out = [];
  const pairs = [
    ["서울", "seoul"], ["부산", "busan"], ["제주", "jeju"], ["인천", "incheon"], ["대구", "daegu"], ["광주", "gwangju"], ["대전", "daejeon"], ["울산", "ulsan"],
    ["한국", "korea"], ["대한민국", "korea"], ["일본", "japan"], ["중국", "china"], ["미국", "usa"],
    ["관광", "travel"], ["여행", "travel"], ["맛집", "restaurant"], ["음식", "food"], ["호텔", "hotel"], ["숙박", "hotel"], ["축제", "festival"],
    ["영상", "video"], ["동영상", "video"], ["유튜브", "youtube"], ["이미지", "image"], ["사진", "image"], ["뉴스", "news"], ["지도", "map"],
    ["쇼핑", "shopping"], ["상품", "product"], ["가격", "price"], ["도서", "book"], ["책", "book"], ["웹툰", "webtoon"],
    ["금융", "finance"], ["주식", "stock"], ["스포츠", "sports"], ["블로그", "blog"], ["카페", "cafe"], ["커뮤니티", "community"],
    ["지식", "knowledge"], ["백과", "encyclopedia"], ["논문", "paper"], ["연구", "research"], ["AI", "artificial intelligence"], ["인공지능", "ai"],
    ["후원", "donation"], ["기부", "donation"], ["선교", "mission"], ["봉사", "volunteer"], ["구호", "relief"],
    ["프론트", "front"], ["홈", "home"], ["슬롯", "slot"], ["배포", "distribution"], ["미디어", "media"], ["소셜", "social"], ["네트워크", "network"]
  ];
  for(const [a,b] of pairs){
    if(t.includes(normalizeText(a))) out.push(b);
    if(t.includes(normalizeText(b))) out.push(a);
  }
  if(source.includes("youtube") || url.includes("youtube") || url.includes("youtu be") || url.includes("youtu.be")) out.push("youtube", "유튜브", "video", "영상", "동영상");
  if(source.includes("naver") || url.includes("naver")) out.push("naver", "네이버", "blog", "cafe", "kin");
  if(source.includes("google") || url.includes("google")) out.push("google", "구글");
  if(source.includes("bing") || url.includes("bing")) out.push("bing", "빙");
  if(/tour|tourism|travel|trip|local tour|local_tour/.test(t)) out.push("관광", "여행", "tour", "tourism", "travel", "지역");
  if(/distribution|commerce|shopping|shop|product|market/.test(t)) out.push("상품", "쇼핑", "commerce", "shopping", "product", "market");
  if(/media|movie|video|youtube|film|drama|shorts/.test(t)) out.push("미디어", "영상", "동영상", "video", "media", "youtube");
  if(/donation|ngo|mission|volunteer|relief/.test(t)) out.push("후원", "기부", "ngo", "donation", "mission", "volunteer");
  if(/network|social|sns|community/.test(t)) out.push("네트워크", "소셜", "sns", "community", "network");
  if(/insight|global insight|analysis/.test(t)) out.push("인사이트", "분석", "global insight", "insight", "analysis");
  if(/home|front|slot/.test(t)) out.push("홈", "프론트", "front", "home", "slot");
  return unique(out.map(normalizeText));
}
function classify(item, text){
  const t = normalizeText(text);
  const url = normalizeText(firstNonEmpty(item && item.url, item && item.link, item && item.href));
  const source = normalizeText(firstNonEmpty(normalizeSourceValue(item && item.source), normalizeSourceValue(item && item.provider)));
  const type = normalizeText(firstNonEmpty(item && item.searchCategory, item && item.type, item && item.category, item && item.mediaType));
  const d = domainOf(firstNonEmpty(item && item.url, item && item.link, item && item.href));

  let searchCategory = "web";
  if(source.includes("youtube") || url.includes("youtube") || url.includes("youtu.be") || type === "video" || /영상|동영상|video|youtube|유튜브/.test(t)) searchCategory = "video";
  else if(type === "image" || source.includes("image") || /이미지|사진|photo|image|thumbnail/.test(t)) searchCategory = "image";
  else if(type === "news" || source.includes("news") || /뉴스|신문|속보|news|press/.test(t)) searchCategory = "news";
  else if(type === "local" || type === "map" || /지도|주소|위치|관광|여행|맛집|hotel|travel|tour|tourism|map|local|place/.test(t)) searchCategory = "tour";
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
  const source = low(firstNonEmpty(normalizeSourceValue(item && item.source), normalizeSourceValue(item && item.provider)));
  const url = low(firstNonEmpty(item && item.url, item && item.link, item && item.href));
  const d = domainOf(url);
  if(/\.go\.kr$|\.gov$|\.or\.kr$|\.edu$|\.ac\.kr$/.test(d)) return 0.92;
  if(source.includes("search-bank") || source.includes("sanmaru")) return 0.80;
  if(source.includes("naver") || source.includes("google") || source.includes("bing") || source.includes("youtube")) return 0.74;
  if(url && url !== "#") return 0.60;
  return 0.48;
}
function isPlaceholder(item){
  return placeholderInfo(item).isPlaceholder;
}
function canonicalItem(item, query, fallbackSource){
  item = item || {};
  const url = normalizeUrl(firstNonEmpty(item.url, item.link, item.href, ""));
  const title = firstNonEmpty(item.title, item.name, item.label, item.heading, query, "Untitled");
  const summary = firstNonEmpty(item.summary, item.description, item.snippet, item.content, item.text, "");
  const image = firstNonEmpty(item.thumbnail, item.thumb, item.image, item.poster, item.cover, item.media && item.media.poster);
  const source = firstNonEmpty(normalizeSourceValue(item.source), normalizeSourceValue(item.provider), fallbackSource, item._sourceHint, "search-bank");
  const identityUrl = normalizeUrl(firstNonEmpty(item.url, item.link, item.href, url));
  const idBase = firstNonEmpty(
    item.id,
    item.indexId,
    identityUrl,
    [title, source, item.route, item.path, item.page, item.section, item.lang, image, summary].filter(Boolean).join("|")
  );
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
    route: routeValueOf(item),
    page: firstNonEmpty(item.page, item.bind && item.bind.page, pageValueOf(item)),
    section: firstNonEmpty(item.section, item.psom_key, item.bind && item.bind.section, sectionValueOf(item)),
    psom_key: firstNonEmpty(item.psom_key, item.section, item.bind && item.bind.section),
    slotKey: slotKeyOf(item),
    lang: firstNonEmpty(item.lang, item.locale),
    layerPointer: layerPointerOf(item)
  });
}

function valueTextForRealness(item){
  item = item || {};
  const p = item.payload && typeof item.payload === "object" ? item.payload : {};
  const d = item.data && typeof item.data === "object" ? item.data : {};
  return compactSpaces([
    item.summary, item.description, item.snippet, item.content, item.text, item.excerpt, item.abstract,
    p.summary, p.description, p.snippet, p.content, p.text, p.excerpt, p.abstract,
    d.summary, d.description, d.snippet, d.content, d.text, d.excerpt, d.abstract
  ].filter(Boolean).join(" "));
}
function mediaCandidatesOf(item){
  item = item || {};
  const p = item.payload && typeof item.payload === "object" ? item.payload : {};
  const d = item.data && typeof item.data === "object" ? item.data : {};
  const media = item.media && typeof item.media === "object" ? item.media : {};
  const preview = media.preview && typeof media.preview === "object" ? media.preview : {};
  return unique([
    item.thumbnail, item.thumb, item.image, item.imageUrl, item.image_url, item.og_image, item.ogImage,
    item.originalImage, item.fullImage, item.imageOriginal, item.viewerImage, item.openImageUrl, item.contentUrl, item.cardImage,
    p.thumbnail, p.thumb, p.image, p.imageUrl, p.image_url, p.og_image, p.ogImage, p.originalImage, p.fullImage, p.imageOriginal, p.viewerImage, p.openImageUrl, p.contentUrl, p.cardImage,
    d.thumbnail, d.thumb, d.image, d.imageUrl, d.image_url, d.og_image, d.ogImage, d.originalImage, d.fullImage, d.imageOriginal, d.viewerImage, d.openImageUrl, d.contentUrl, d.cardImage,
    preview.thumbnail, preview.image, preview.poster, media.poster,
    ...(Array.isArray(item.imageSet) ? item.imageSet : []),
    ...(Array.isArray(p.imageSet) ? p.imageSet : []),
    ...(Array.isArray(d.imageSet) ? d.imageSet : [])
  ].map(x => s(x).trim()).filter(Boolean));
}
function isContentImageUrl(url){
  const u = s(url).trim();
  if(!u) return false;
  const lowUrl = u.toLowerCase();
  if(!/^https?:\/\//i.test(u) && !u.startsWith("/")) return false;
  if(/google\.com\/s2\/favicons|favicon|apple-touch-icon|\.ico(\?|#|$)|sprite|spacer|blank|transparent|1x1|pixel|tracking|captcha|placeholder|noimage|no-image|no_img|default_logo|site_logo|profile_default/i.test(lowUrl)) return false;
  if(/(^|[\/_\-.])(logo|logotype|brand|symbol|emblem|ci|bi|banner|placard|adserver|advertisement|promo)([\/_\-.]|$)/i.test(lowUrl)) return false;
  if(/staticmap|maps\.googleapis|map\.naver\.com|tile\.openstreetmap|\/maps?\/|map_tile/i.test(lowUrl)) return false;
  return /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(lowUrl) || /ytimg\.com|img\.youtube\.com|search\.pstatic\.net|kakaocdn|cloudfront|twimg|fbcdn|instagram|googleusercontent|gstatic/i.test(lowUrl);
}
function realMediaSet(item){
  return mediaCandidatesOf(item).filter(isContentImageUrl).slice(0, 6);
}
function isRouteOrOpeningCard(item){
  item = item || {};
  const text = normalizeText([
    item.title, item.summary, item.source, item.provider, item.id, item.url, item.routePlanProvider,
    item.sanmaruRouteCard ? "sanmaru route" : "", item.sanmaruOpeningCard ? "sanmaru opening" : "",
    item.providerRouteCard ? "provider route" : "", item.providerHint ? "provider hint" : ""
  ].filter(Boolean).join(" "));
  return !!(
    item.sanmaruRouteCard || item.sanmaruOpeningCard || item.providerRouteCard || item.providerHint ||
    /\bsanmaru\s+(route|opening)\b|route\s*card|opening\s*card|provider\s*route|검색\s*경로|정보원\s*경로|열린\s*정보\s*통로/.test(text)
  );
}
function supplyLanesOf(item){
  item = item || {};
  const lp = item.layerPointer || layerPointerOf(item);
  const text = normalizeText([item.page, item.section, item.psom_key, item.category, item.type, item.searchCategory, item.displayGroup, item.source, item.provider, lp.layerRole].filter(Boolean).join(" "));
  const lanes = new Set(["search"]);
  if(/home|front|slot|network|distribution|social|media|tour|literature|academic|donation|commerce|product|content/.test(text)) lanes.add("front");
  if(/shopping|commerce|product|market|상품|쇼핑/.test(text)) lanes.add("commerce"), lanes.add("front");
  if(/image|photo|video|youtube|media|영상|이미지|사진/.test(text)) lanes.add("media"), lanes.add("front");
  if(/map|local|tour|travel|region|address|지도|지역|관광|여행/.test(text)) lanes.add("region"), lanes.add("front");
  if(/insight|analysis|global insight|인사이트|분석/.test(text)) lanes.add("insight");
  return Array.from(lanes);
}
function realItemQuality(item, pInfo){
  item = item || {};
  pInfo = pInfo || placeholderInfo(item);
  if(pInfo.isPlaceholder || isRouteOrOpeningCard(item)) return 0;
  const url = firstNonEmpty(item.url, item.link, item.href);
  const title = firstNonEmpty(item.title, item.name, item.label);
  const body = valueTextForRealness(item);
  const media = realMediaSet(item);
  let score = 0;
  if(title && title.length >= 2) score += 14;
  if(url && url !== "#") score += 16;
  if(body.length >= 24) score += 28;
  else if(body.length >= 10) score += 14;
  if(media.length) score += 18;
  if(media.length >= 2) score += 6;
  score += Math.round(sourceTrust(item) * 18);
  const lanes = supplyLanesOf(item);
  if(lanes.includes("front")) score += 8;
  if(lanes.includes("media") || lanes.includes("commerce") || lanes.includes("region")) score += 5;
  return Math.max(0, Math.min(120, score));
}
function decorateSupplyFields(item, pInfo){
  const media = realMediaSet(item);
  const score = realItemQuality(item, pInfo);
  const lanes = supplyLanesOf(item);
  const body = valueTextForRealness(item);
  return Object.assign({}, item, {
    realItem: score >= REAL_ITEM_MIN_SCORE,
    supplyReady: score >= REAL_ITEM_MIN_SCORE,
    supplyQualityScore: score,
    supplyTrustScore: sourceTrust(item),
    supplyLanes: lanes,
    frontSupplyEligible: lanes.includes("front") && score >= REAL_ITEM_MIN_SCORE,
    searchSupplyEligible: lanes.includes("search") && score >= REAL_ITEM_MIN_SCORE,
    mediaSupplyEligible: lanes.includes("media") && score >= REAL_ITEM_MIN_SCORE,
    commerceSupplyEligible: lanes.includes("commerce") && score >= REAL_ITEM_MIN_SCORE,
    regionSupplyEligible: lanes.includes("region") && score >= REAL_ITEM_MIN_SCORE,
    hasRealSummary: body.length >= 10,
    hasRealMedia: media.length > 0,
    imageSet: media.length ? media : item.imageSet,
    thumbnail: firstNonEmpty(item.thumbnail, item.thumb, media[0]),
    image: firstNonEmpty(item.image, media[0]),
    supplyPolicy: "real-item-first-trust-ranked-no-route-opening-as-content"
  });
}

function indexItem(raw, i, source){
  const item = canonicalItem(raw, "", source || "search-bank");
  const pInfo = placeholderInfo(item);
  if(pInfo.isPlaceholder && !pInfo.canIndexAsLayerPointer) return null;
  const indexText = pickIndexText(item);
  const normalizedText = normalizeText(indexText);
  if(!normalizedText) return null;
  const joinedText = compactText(indexText);
  const toks = tokensOf(indexText);
  const synonyms = buildSynonyms(item, indexText);
  const c = classify(item, indexText);
  const rankHint = Number.isFinite(Number(item.priority)) ? Number(item.priority) : (Number.isFinite(Number(item.rankHint)) ? Number(item.rankHint) : 0);
  const pointer = layerPointerOf(item);
  const trust = Number.isFinite(Number(item.sourceTrust))
    ? Number(item.sourceTrust)
    : (pInfo.isPlaceholder ? LAYER_POINTER_TRUST : sourceTrust(item));
  const supplyDecorated = decorateSupplyFields(item, pInfo);
  return Object.assign({}, item, c, supplyDecorated, {
    indexId: firstNonEmpty(item.indexId, item.id, stableHash([item.title, item.url, item.source, i].join("|"))),
    indexText,
    normalizedText,
    joinedText,
    tokens: unique(toks.concat(synonyms, [pointer.layerRole, pointer.page, pointer.section, pointer.slotKey, pointer.route].filter(Boolean).map(normalizeText))).slice(0, 420),
    joinedTokens: unique([joinedText].concat(tokensOf(joinedText))).slice(0, 160),
    synonyms,
    rankHint: pInfo.isPlaceholder ? Math.min(rankHint, 0) : rankHint,
    sourceTrust: trust,
    isPlaceholder: !!pInfo.isPlaceholder,
    placeholderReason: pInfo.reason,
    isLayerPointer: !!pInfo.canIndexAsLayerPointer,
    layerPointer: pointer,
    indexQuality: pInfo.isPlaceholder ? "layer-pointer" : (trust >= ACTIVE_POINTER_TRUST ? "active-trusted" : "active"),
    supplyQuality: supplyDecorated.supplyReady ? (trust >= ACTIVE_POINTER_TRUST ? "real-trusted" : "real-active") : (pInfo.isPlaceholder ? "layer-pointer" : "thin"),
    externalCall:false,
    storagePolicy:"fast-memory-index-pointer-only",
    indexedAt: nowIso()
  });
}
function buildIndexFromSnapshot(){
  const snapFile = snapshotPath();
  const snap = safeReadJson(snapFile, null);
  const rawItems = asItems(snap).slice(0, MAX_INDEX_ITEMS);
  const indexed = [];
  const seen = new Set();
  let hardFiltered = 0;
  let layerPointerCount = 0;
  let activeCount = 0;
  const layerCoverage = Object.create(null);
  const sectionCoverage = Object.create(null);
  const pageCoverage = Object.create(null);

  for(let i=0; i<rawItems.length; i++){
    const item = indexItem(rawItems[i], i, "search-bank");
    if(!item){ hardFiltered++; continue; }
    const sig = slotDedupeSignature(item);
    if(!sig || seen.has(sig)) continue;
    seen.add(sig);
    if(item.isLayerPointer) layerPointerCount++; else activeCount++;
    const lp = item.layerPointer || {};
    const lr = lp.layerRole || "general-information-layer";
    const sec = lp.section || item.section || "unknown";
    const pg = lp.page || item.page || "unknown";
    layerCoverage[lr] = (layerCoverage[lr] || 0) + 1;
    sectionCoverage[sec] = (sectionCoverage[sec] || 0) + 1;
    pageCoverage[pg] = (pageCoverage[pg] || 0) + 1;
    indexed.push(item);
  }
  indexed.sort((a,b) =>
    (Number(b.supplyQualityScore || 0) - Number(a.supplyQualityScore || 0)) ||
    (Number(b.sourceTrust || 0) - Number(a.sourceTrust || 0))
  );
  const realItemCount = indexed.filter(x => x && x.realItem).length;
  const frontEligibleCount = indexed.filter(x => x && x.frontSupplyEligible).length;
  const mediaEligibleCount = indexed.filter(x => x && x.mediaSupplyEligible).length;
  const commerceEligibleCount = indexed.filter(x => x && x.commerceSupplyEligible).length;
  const regionEligibleCount = indexed.filter(x => x && x.regionSupplyEligible).length;

  const stat = {
    rawCount: rawItems.length,
    realItemCount,
    frontEligibleCount,
    mediaEligibleCount,
    commerceEligibleCount,
    regionEligibleCount,
    frontSupplyTarget: FRONT_SUPPLY_TARGET,
    sanmaruSupplyCapacityTarget: SANMARU_SUPPLY_CAPACITY_TARGET,
    activeCount,
    layerPointerCount,
    hardFiltered,
    totalIndexed: indexed.length,
    layerCoverage,
    sectionCoverage,
    pageCoverage,
    snapshotPath: snapFile,
    generatedAt: nowIso(),
    residentPolicy:"globalThis hot memory + snapshot hydrate + index pointer layer; no external API calls"
  };
  state.lastSnapshotStat = stat;
  return {
    status:"ok",
    engine: ENGINE_NAME,
    version: VERSION,
    generatedAt: stat.generatedAt,
    source:"search-bank.snapshot.json",
    rawCount: stat.rawCount,
    placeholderFiltered: hardFiltered,
    layerPointerCount,
    activeCount,
    realItemCount,
    frontEligibleCount,
    count: indexed.length,
    items:indexed,
    meta:stat
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
  if(!forceBuild && saved && Array.isArray(saved.items) && saved.version === VERSION){
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
  const pageMap = new Map();
  const sectionMap = new Map();
  const layerRoleMap = new Map();
  const slotMap = new Map();
  const items = Array.isArray(idx && idx.items) ? idx.items : [];
  let activeCount = 0;
  let layerPointerCount = 0;
  for(let i=0; i<items.length; i++){
    const item = items[i];
    if(item && item.isLayerPointer) layerPointerCount++; else activeCount++;
    const tokens = unique((item.tokens || []).concat(item.synonyms || [], item.joinedText ? [item.joinedText] : []));
    for(const token of tokens.slice(0, 260)){
      if(!token || token.length > 100) continue;
      if(!tokenMap.has(token)) tokenMap.set(token, []);
      tokenMap.get(token).push(i);
    }
    const lp = item.layerPointer || {};
    for(const [map, key] of [
      [categoryMap, item.searchCategory], [groupMap, item.displayGroup], [sourceMap, item.source],
      [pageMap, lp.page || item.page], [sectionMap, lp.section || item.section || item.psom_key],
      [layerRoleMap, lp.layerRole], [slotMap, lp.slotKey || item.slotKey]
    ]){
      const k = low(key);
      if(!k) continue;
      if(!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    }
  }
  state.runtime = { tokenMap, categoryMap, groupMap, sourceMap, pageMap, sectionMap, layerRoleMap, slotMap, count: items.length, activeCount, layerPointerCount };
  state.runtimeBuiltAt = nowMs();
  state.lastRuntimeStat = { count:items.length, activeCount, layerPointerCount, tokenCount:tokenMap.size, pageCount:pageMap.size, sectionCount:sectionMap.size, layerRoleCount:layerRoleMap.size, builtAt:nowIso() };
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
  if(item.isLayerPointer || item.isPlaceholder) score += PLACEHOLDER_QUERY_PENALTY;
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
    addList(runtime.pageMap && runtime.pageMap.get(type));
    addList(runtime.sectionMap && runtime.sectionMap.get(type));
    addList(runtime.layerRoleMap && runtime.layerRoleMap.get(type));
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

function buildSupplyPools(idx){
  const source = Array.isArray(idx && idx.items) ? idx.items : [];
  const real = source
    .filter(x => x && x.realItem && !x.isPlaceholder && !x.isLayerPointer && !isRouteOrOpeningCard(x))
    .sort((a,b) =>
      (Number(b.supplyQualityScore || 0) - Number(a.supplyQualityScore || 0)) ||
      (Number(b.sourceTrust || 0) - Number(a.sourceTrust || 0))
    );
  const byLane = lane => real.filter(x => Array.isArray(x.supplyLanes) && x.supplyLanes.includes(lane));
  const pools = {
    generatedAt: nowIso(),
    front: byLane("front").slice(0, Math.max(FRONT_SUPPLY_TARGET, 6000)),
    search: byLane("search").slice(0, SANMARU_SUPPLY_CAPACITY_TARGET),
    media: byLane("media").slice(0, 5000),
    commerce: byLane("commerce").slice(0, 5000),
    region: byLane("region").slice(0, 5000),
    insight: byLane("insight").slice(0, 3000),
    allReal: real.slice(0, SANMARU_SUPPLY_CAPACITY_TARGET),
    policy: {
      frontSupplyTarget: FRONT_SUPPLY_TARGET,
      sanmaruSupplyCapacityTarget: SANMARU_SUPPLY_CAPACITY_TARGET,
      ranking: "supplyQualityScore-sourceTrust-realSummary-realMedia-frontSlot",
      exclude: "placeholder-route-opening-provider-hint"
    }
  };
  state.supplyPools = pools;
  state.supplyPoolsBuiltAt = nowMs();
  return pools;
}
function ensureSupplyPools(idx){
  if(state.supplyPools && nowMs() - state.supplyPoolsBuiltAt < RUNTIME_CACHE_TTL_MS) return state.supplyPools;
  return buildSupplyPools(idx || loadIndex(false));
}
function supplyPoolName(params){
  const mode = low(firstNonEmpty(params && (params.supplyMode || params.pool || params.action || params.mode), ""));
  if(mode.includes("media")) return "media";
  if(mode.includes("commerce") || mode.includes("product")) return "commerce";
  if(mode.includes("region") || mode.includes("local") || mode.includes("map")) return "region";
  if(mode.includes("insight")) return "insight";
  if(mode.includes("front") || mode.includes("slot") || mode.includes("content") || truthy(params && params.frontSupply)) return "front";
  return "search";
}
function querySupplyPool(params){
  params = params || {};
  const started = params.__startedAt || nowMs();
  const idx = loadIndex(false);
  const pools = ensureSupplyPools(idx);
  const poolName = supplyPoolName(params);
  const q = firstNonEmpty(params.q, params.query);
  const qInfo = q ? { normalized: normalizeText(q), joined: compactText(q), tokens: tokensOf(q), synonyms: buildSynonyms({}, q) } : null;
  const requestedLimit = clampInt(params.limit, poolName === "front" ? FRONT_SUPPLY_TARGET : DEFAULT_LIMIT, 1, poolName === "front" ? Math.max(FRONT_SUPPLY_TARGET, MAX_LIMIT) : MAX_LIMIT);
  const page = clampInt(params.page, 1, 1, 100000);
  const perPageWasProvided = params.perPage != null || params.pageSize != null || params.size != null;
  const perPage = clampInt(firstNonEmpty(params.perPage, params.pageSize, params.size), DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const offset = clampInt(params.offset, perPageWasProvided || page > 1 ? (page - 1) * perPage : 0, 0, 10000000);
  let list = Array.isArray(pools[poolName]) ? pools[poolName].slice() : [];
  if(qInfo && qInfo.normalized){
    list = list.map(x => Object.assign({}, x, { sanmaruIndexScore: scoreIndexedItem(qInfo, x, low(params.type || params.category || "all")) + Number(x.supplyQualityScore || 0) }))
      .filter(x => (x.sanmaruIndexScore || 0) > 0)
      .sort((a,b) => (b.sanmaruIndexScore || 0) - (a.sanmaruIndexScore || 0));
    if(list.length < Math.min(100, requestedLimit)){
      const seen = new Set(list.map(slotDedupeSignature));
      const extra = (pools.allReal || []).filter(x => !seen.has(slotDedupeSignature(x))).slice(0, requestedLimit);
      list = list.concat(extra);
    }
  }
  const totalMatches = list.length;
  const sliceSize = perPageWasProvided || page > 1 ? perPage : requestedLimit;
  const items = list.slice(offset, offset + sliceSize).map(stripPrivateIndexFields);
  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    action:"supply-pool",
    supplyMode:poolName,
    query:q,
    source:items.length ? "search-bank-index-real-supply-pool" : null,
    items,
    results:items,
    meta:{
      count:items.length,
      totalMatches,
      totalReal:pools.allReal ? pools.allReal.length : 0,
      frontSupplyCount:pools.front ? pools.front.length : 0,
      frontSupplyTarget:FRONT_SUPPLY_TARGET,
      sanmaruSupplyCapacityTarget:SANMARU_SUPPLY_CAPACITY_TARGET,
      page,
      perPage: perPageWasProvided || page > 1 ? perPage : null,
      offset,
      realOnly:true,
      ranking:"trust-and-real-content-first",
      latency: nowMs() - started
    }
  };
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
  const groups = {}, categories = {}, sources = {}, pages = {}, sections = {}, layers = {}, quality = {};
  for(const item of items || []){
    const g = item.displayGroup || "web";
    const c = item.searchCategory || "web";
    const so = item.source || "unknown";
    const lp = item.layerPointer || {};
    const pg = lp.page || item.page || "unknown";
    const sec = lp.section || item.section || item.psom_key || "unknown";
    const lr = lp.layerRole || "general-information-layer";
    const q = item.indexQuality || (item.isLayerPointer ? "layer-pointer" : "active");
    groups[g] = (groups[g] || 0) + 1;
    categories[c] = (categories[c] || 0) + 1;
    sources[so] = (sources[so] || 0) + 1;
    pages[pg] = (pages[pg] || 0) + 1;
    sections[sec] = (sections[sec] || 0) + 1;
    layers[lr] = (layers[lr] || 0) + 1;
    quality[q] = (quality[q] || 0) + 1;
  }
  return { groups, categories, sources, pages, sections, layers, quality };
}
function queryIndex(params){
  const started = nowMs();
  params = params || {};
  params.__startedAt = started;
  const q = firstNonEmpty(params && params.q, params && params.query);
  const normalized = normalizeText(q);
  const wantsSupplyPool = /front|slot|content|media|commerce|product|region|local|insight|supply/.test(low(firstNonEmpty(params && (params.supplyMode || params.action || params.mode), ""))) || truthy(params && (params.frontSupply || params.realSupply || params.searchSupply));
  if(!normalized && wantsSupplyPool) return querySupplyPool(params);
  if(!normalized) return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:q, items:[], results:[], meta:{ count:0, reason:"EMPTY_QUERY" } };

  const requestedLimit = clampInt(params && params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = clampInt(params && params.page, 1, 1, 100000);
  const perPageWasProvided = params && (params.perPage != null || params.pageSize != null || params.size != null);
  const perPage = clampInt(firstNonEmpty(params && params.perPage, params && params.pageSize, params && params.size), DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const offset = clampInt(params && params.offset, perPageWasProvided || page > 1 ? (page - 1) * perPage : 0, 0, 10000000);
  const sliceSize = perPageWasProvided || page > 1 ? perPage : requestedLimit;
  const type = low(firstNonEmpty(params && (params.type || params.category || params.tab || params.vertical), "all")) || "all";
  const includeFacets = truthy(params && (params.facets || params.includeFacets || params.debug));
  const supplyMode = low(firstNonEmpty(params && (params.supplyMode || params.action || params.mode), ""));
  const realOnly = truthy(params && (params.realOnly || params.realSupply || params.frontSupply || params.searchSupply)) || /front|slot|content|media|commerce|product|region|local|insight|supply/.test(supplyMode);
  const includePlaceholders = !realOnly && truthy(params && (params.includePlaceholders || params.layerMode || params.slotMode || params.snapshotLayer));
  const layerOnly = truthy(params && (params.layerOnly || params.pointerOnly));

  if(realOnly && /front|slot|content|media|commerce|product|region|local|insight|supply/.test(supplyMode)) return querySupplyPool(params);

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
    if(!item){ continue; }
    const placeholder = !!(item.isPlaceholder || isPlaceholder(item));
    if(placeholder && !includePlaceholders){ placeholderFiltered++; continue; }
    if(realOnly && (!item.realItem || isRouteOrOpeningCard(item))){ placeholderFiltered++; continue; }
    if(layerOnly && !item.isLayerPointer) continue;
    const sc = scoreIndexedItem(qInfo, item, type) + (placeholder && includePlaceholders ? 30 : 0) + Math.round(Number(item.supplyQualityScore || 0) / 4);
    if(sc <= 0) continue;
    const sig = slotDedupeSignature(item);
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
      page,
      perPage: perPageWasProvided || page > 1 ? perPage : null,
      offset,
      nextOffset: hasMore ? nextOffset : null,
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ offset:nextOffset, q, type })).toString("base64") : null,
      hasMore,
      totalMatches,
      totalPages: perPageWasProvided || page > 1 ? Math.ceil(totalMatches / perPage) : null,
      totalIndexed: base.length,
      activeIndexed: runtime.activeCount,
      layerPointerIndexed: runtime.layerPointerCount,
      includePlaceholders,
      layerOnly,
      realOnly,
      frontSupplyTarget: FRONT_SUPPLY_TARGET,
      sanmaruSupplyCapacityTarget: SANMARU_SUPPLY_CAPACITY_TARGET,
      promoted: promoted.length,
      ingested: ingested.length,
      type,
      placeholderFiltered,
      candidatePool: pool.length,
      latency: nowMs() - started,
      fastMemory:true,
      residentWarm:true,
      externalCall:false,
      storagePolicy:"fast-memory-index-pointer-only",
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
    const sig = slotDedupeSignature(c);
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
  const stat = state.lastSnapshotStat || (idx && idx.meta) || {};
  const pools = ensureSupplyPools(idx);
  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    role:"sanmaru-resident-fast-memory-layer-and-global-information-bank-index",
    snapshotPath:snapshotPath(),
    indexPath:tmpIndexPath(),
    promotedPath:tmpPromotedPath(),
    ingestedPath:tmpIngestedPath(),
    indexCount:idx && Array.isArray(idx.items) ? idx.items.length : 0,
    activeIndexCount:runtime && Number.isFinite(runtime.activeCount) ? runtime.activeCount : 0,
    layerPointerCount:runtime && Number.isFinite(runtime.layerPointerCount) ? runtime.layerPointerCount : 0,
    realItemCount:pools && pools.allReal ? pools.allReal.length : 0,
    frontSupplyCount:pools && pools.front ? pools.front.length : 0,
    frontSupplyTarget:FRONT_SUPPLY_TARGET,
    sanmaruSupplyCapacityTarget:SANMARU_SUPPLY_CAPACITY_TARGET,
    promotedCount:loadPromoted().length,
    ingestedCount:loadIngested().length,
    runtimeTokenCount:runtime && runtime.tokenMap ? runtime.tokenMap.size : 0,
    runtimePageCount:runtime && runtime.pageMap ? runtime.pageMap.size : 0,
    runtimeSectionCount:runtime && runtime.sectionMap ? runtime.sectionMap.size : 0,
    cacheLoaded:!!state.index,
    warmResidentUntil: new Date(nowMs() + RESIDENT_WARM_TTL_MS).toISOString(),
    layerCoverage: stat.layerCoverage || null,
    pageCoverage: stat.pageCoverage || null,
    sectionCoverage: stat.sectionCoverage || null,
    securityPolicy:"admin token required for build/rebuild/promote/ingest/export; query remains read-only",
    rolePolicy:"Sanmaru resident fast-memory/index-pointer layer; no external API calls; direct web storage is not performed",
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
  const security = guardIndexRequest(event || {}, merged, action);
  if(!security.allowed) return { status:"blocked", engine:ENGINE_NAME, version:VERSION, action, items:[], results:[], meta:{ count:0, security } };
  if(action === "health") return Object.assign(health(), { security:{ allowed:true, admin:security.admin } });
  if(action === "build" || action === "rebuild"){
    state.index = buildIndexFromSnapshot();
    state.loadedAt = nowMs();
    state.runtime = null;
    const persisted = safeWriteJson(tmpIndexPath(), state.index);
    const includeItems = truthy(merged.includeItems || merged.items);
    return includeItems ? Object.assign({}, state.index, { persisted, indexPath:tmpIndexPath() }) : {
      status:"ok", engine:ENGINE_NAME, version:VERSION, action:"build", persisted, indexPath:tmpIndexPath(), count:state.index.count, activeCount:state.index.activeCount, layerPointerCount:state.index.layerPointerCount, rawCount:state.index.rawCount, placeholderFiltered:state.index.placeholderFiltered, generatedAt:state.index.generatedAt
    };
  }
  if(action === "promote") return promote(merged);
  if(action === "ingest" || action === "upsert" || action === "hydrate") return ingest(merged);
  if(action === "front-supply" || action === "slot-supply" || action === "content-supply" || action === "media-supply" || action === "commerce-supply" || action === "region-supply" || action === "insight-supply" || action === "supply-pool") return querySupplyPool(Object.assign({}, merged, { action }));
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

module.exports = { version:VERSION, runEngine, handler, query:queryIndex, promote, ingest, health, buildIndexFromSnapshot, loadIndex, querySupplyPool, ensureSupplyPools };
exports.version = VERSION;
exports.runEngine = runEngine;
exports.handler = handler;
exports.query = queryIndex;
exports.promote = promote;
exports.ingest = ingest;
exports.health = health;
exports.querySupplyPool = querySupplyPool;
exports.ensureSupplyPools = ensureSupplyPools;
