"use strict";

/**
 * sanmaru_engine_v2.js
 * ------------------------------------------------------------
 * SANMARU — Virtual Web Ecosystem Integrated Information Bank Engine
 *
 * Role
 * - Top-level head engine above platform search gateways.
 * - Mounts authorized information channels as controlled adapters.
 * - Uses Search Bank / Search Bank Index as fast memory layers.
 * - Controls external API budgets, health, cache, de-duplication and fallback metadata.
 * - Does not bypass permissions, quotas, robots, private databases, or API limits.
 *
 * Security baseline
 * - No dynamic require from user input.
 * - No user-supplied URL fetches; all external URLs are fixed allowlisted endpoints.
 * - Query sanitization, bounded lengths, prompt-injection signal detection.
 * - Per-IP soft rate limit, inflight de-dupe, adapter circuit breakers, source budgets.
 * - Error messages are sanitized; environment secrets are never returned.
 */

const crypto = require("crypto");

const VERSION = "sanmaru-engine-v2.1.0-secure-head-core";
const ENGINE_NAME = "sanmaru";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const DEFAULT_TIMEOUT_MS = 8500;
const DEEP_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const INFLIGHT_TTL_MS = 30 * 1000;
const RATE_WINDOW_MS = 10 * 1000;
const RATE_MAX = 60;
const MAX_QUERY_LENGTH = 240;
const MIN_FAST_TARGET = 80;
const DEFAULT_EXTERNAL_TRIGGER_MIN = 80;

const globalState = globalThis.__SANMARU_V2_STATE || (globalThis.__SANMARU_V2_STATE = {
  cache: new Map(),
  inflight: new Map(),
  rate: new Map(),
  circuits: Object.create(null),
  memory: new Map(),
  telemetry: []
});

function s(v){ return String(v == null ? "" : v); }
function low(v){ return s(v).trim().toLowerCase(); }
function nowMs(){ return Date.now(); }
function nowIso(){ return new Date().toISOString(); }
function truthy(v){
  if(v === true) return true;
  if(v === false || v == null) return false;
  const x = low(v);
  return !!x && !["0","false","no","off","disable","disabled","null","undefined"].includes(x);
}
function clampInt(v, d, min, max){
  const n = parseInt(v, 10);
  const x = Number.isFinite(n) ? n : d;
  return Math.max(min, Math.min(max, x));
}
function stableHash(v){ return crypto.createHash("sha1").update(s(v)).digest("hex").slice(0, 16); }
function safeJsonClone(v){ try{ return JSON.parse(JSON.stringify(v)); }catch(e){ return v; } }
function stripHtml(v){ return s(v).replace(/<[^>]*>/g, ""); }
function compactSpaces(v){ return s(v).replace(/\s+/g, " ").trim(); }
function firstNonEmpty(){
  for(const v of arguments){
    const x = s(v).trim();
    if(x) return x;
  }
  return "";
}
function domainOf(url){ try{ return new URL(s(url)).hostname.replace(/^www\./, ""); }catch(e){ return ""; } }
function responseErrorCode(err){
  const m = s(err && err.message || err).slice(0, 80);
  if(/timeout|abort/i.test(m)) return "timeout";
  if(/rate/i.test(m)) return "rate_limited";
  if(/http/i.test(m)) return m.replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 40) || "http_error";
  return "adapter_error";
}

function sanitizeQuery(raw){
  let q = s(raw).normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if(!q) return { ok:false, code:"EMPTY_QUERY", value:"" };
  q = q.replace(/[<>`$\\]/g, " ");
  q = compactSpaces(q);
  if(q.length > MAX_QUERY_LENGTH) q = q.slice(0, MAX_QUERY_LENGTH).trim();

  const probe = low(q);
  const injectionSignals = [
    "ignore previous instruction",
    "ignore previous instructions",
    "system prompt",
    "developer message",
    "process.env",
    "drop table",
    "rm -rf",
    "<script",
    "override rules",
    "bypass policy"
  ];

  return {
    ok: true,
    code: null,
    value: q,
    risk: injectionSignals.some(x => probe.includes(x)) ? "prompt_injection_signal" : null
  };
}

function clientIp(event){
  const h = (event && event.headers) || {};
  return firstNonEmpty(h["x-forwarded-for"], h["client-ip"], h["x-real-ip"], "unknown").split(",")[0].trim() || "unknown";
}

function rateLimitOk(ip){
  const key = ip || "unknown";
  const now = nowMs();
  const arr = (globalState.rate.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if(arr.length >= RATE_MAX) {
    globalState.rate.set(key, arr);
    return false;
  }
  arr.push(now);
  globalState.rate.set(key, arr);
  return true;
}

function normalizeSearchType(v){
  const raw = low(v);
  const alias = {
    "": "all", all:"all", total:"all", web:"web", general:"web",
    image:"image", images:"image", img:"image", photo:"image",
    news:"news", map:"map", maps:"map", local:"map", place:"map",
    knowledge:"knowledge", know:"knowledge", encyclopedia:"knowledge", wiki:"knowledge",
    tour:"tour", travel:"tour", tourism:"tour",
    video:"video", youtube:"video", media:"video",
    sns:"sns", social:"sns", blog:"blog", cafe:"cafe", community:"cafe",
    shopping:"shopping", shop:"shopping", commerce:"shopping",
    sports:"sports", sport:"sports", finance:"finance", stock:"finance", market:"finance",
    book:"book", books:"book", 도서:"book", 책:"book",
    webtoon:"webtoon", cartoon:"webtoon"
  };
  return alias[raw] || "all";
}

function detectRuntimeRegion(event, lang, q){
  const headers = (event && event.headers) || {};
  const queryText = s(q);
  const forcedCountry = s(event && event.queryStringParameters && (event.queryStringParameters.country || event.queryStringParameters.region)).toUpperCase();
  if(forcedCountry) return forcedCountry;
  const xfCountry = s(headers["x-country"] || headers["cf-ipcountry"] || headers["x-vercel-ip-country"]).toUpperCase();
  if(xfCountry) return xfCountry;
  const l = low(lang || headers["accept-language"] || headers["Accept-Language"] || "");
  if(l.startsWith("ko") || /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(queryText)) return "KR";
  if(l.startsWith("ja") || /[ぁ-ゟ゠-ヿ]/.test(queryText)) return "JP";
  if(l.startsWith("zh") || /[一-龥]/.test(queryText)) return "CN";
  if(l.startsWith("en")) return "US";
  return "GLOBAL";
}

function detectIntent(q, searchType){
  const t = low(q);
  const type = normalizeSearchType(searchType);
  const hits = new Set([type]);
  if(/뉴스|신문|속보|news|headline|breaking/.test(t)) hits.add("news");
  if(/이미지|사진|그림|image|photo|picture|gallery/.test(t)) hits.add("image");
  if(/영상|동영상|유튜브|youtube|video|shorts|reels/.test(t)) hits.add("video");
  if(/지도|위치|주소|맛집|카페|여행|관광|map|near|nearby|travel|tour|restaurant|cafe/.test(t)) hits.add("tour");
  if(/책|도서|저자|출판|book|author|ebook/.test(t)) hits.add("book");
  if(/쇼핑|가격|구매|상품|shopping|price|buy|product/.test(t)) hits.add("shopping");
  if(/주식|증권|금융|환율|stock|finance|market|crypto/.test(t)) hits.add("finance");
  if(/스포츠|축구|야구|농구|sports|football|baseball|basketball/.test(t)) hits.add("sports");
  if(/웹툰|만화|comic|manga|webtoon/.test(t)) hits.add("webtoon");
  if(/지식|뜻|의미|백과|논문|연구|knowledge|meaning|research|paper|wiki/.test(t)) hits.add("knowledge");
  return Array.from(hits).filter(Boolean);
}

function displayGroupForCategory(cat){
  const map = {
    official:"authority",
    authority:"authority",
    news:"news",
    map:"local_tour",
    local:"local_tour",
    tour:"local_tour",
    image:"media",
    video:"media",
    media:"media",
    sns:"social",
    social:"social",
    blog:"community",
    cafe:"community",
    community:"community",
    knowledge:"knowledge",
    book:"knowledge",
    shopping:"shopping",
    product:"shopping",
    sports:"sports",
    finance:"finance",
    webtoon:"webtoon",
    web:"web"
  };
  return map[cat] || "web";
}

function categoryOfItem(item){
  const it = item || {};
  const source = low(firstNonEmpty(it.source, it.provider, it.sourceType, it.payload && it.payload.source));
  const type = low(firstNonEmpty(it.searchCategory, it.type, it.mediaType, it.category));
  const url = low(firstNonEmpty(it.url, it.link));
  const text = low([it.title, it.summary, it.snippet, it.description, source, url].join(" "));

  if(source.includes("youtube") || type === "video" || url.includes("youtube.com/watch") || url.includes("youtu.be/")) return "video";
  if(source.includes("image") || type === "image") return "image";
  if(source.includes("news") || type === "news") return "news";
  if(source.includes("local") || type === "map" || type === "local" || /map|지도|주소|위치/.test(text)) return "map";
  if(type === "book" || source.includes("book")) return "book";
  if(type === "shopping" || type === "product" || source.includes("shopping")) return "shopping";
  if(type === "finance" || source.includes("finance")) return "finance";
  if(type === "sports" || source.includes("sports")) return "sports";
  if(type === "webtoon" || /웹툰|webtoon|comic|manga/.test(text)) return "webtoon";
  if(type === "blog" || source.includes("blog")) return "blog";
  if(type === "cafe" || source.includes("cafe") || source.includes("forum")) return "cafe";
  if(type === "knowledge" || source.includes("encyc") || source.includes("wiki")) return "knowledge";
  if(/\.gov\b|\.go\.kr\b|\.edu\b|wikipedia\.org|britannica\.com/.test(url)) return "official";
  return "web";
}

function sourceTrust(source){
  const x = low(source);
  if(x.includes("search-bank-index")) return 0.84;
  if(x.includes("search-bank")) return 0.78;
  if(x.includes("naver_news") || x.includes("google_news")) return 0.74;
  if(x.includes("naver") || x.includes("google") || x.includes("bing")) return 0.68;
  if(x.includes("youtube")) return 0.62;
  if(x.includes("collector")) return 0.66;
  if(x.includes("planetary")) return 0.64;
  return 0.5;
}

function itemText(item){
  const it = item || {};
  return [it.title, it.summary, it.snippet, it.description, it.url, it.link, it.source, it.provider, Array.isArray(it.tags) ? it.tags.join(" ") : ""].map(s).join(" ");
}

function normalizeText(v){
  return low(stripHtml(v)).normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/[^\p{L}\p{N}\s._:/-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenize(v){
  const n = normalizeText(v);
  const parts = n.split(/\s+/).filter(Boolean);
  const joined = n.replace(/\s+/g, "");
  const out = [];
  for(const p of parts){
    if(p.length >= 2) out.push(p);
  }
  if(joined && joined.length >= 2 && !out.includes(joined)) out.push(joined);
  return Array.from(new Set(out)).slice(0, 80);
}

function compactImages(arr){
  const out = [];
  const seen = new Set();
  (Array.isArray(arr) ? arr : []).forEach(v => {
    const x = s(v).trim();
    if(!/^https?:\/\//i.test(x)) return;
    const key = x.toLowerCase();
    if(seen.has(key)) return;
    seen.add(key);
    out.push(x);
  });
  return out.slice(0, 6);
}

function isRealYouTubeVideoUrl(url){
  const u = s(url);
  const m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return !!(m && m[1]);
}

function isPlaceholderItem(it){
  const text = low(itemText(it));
  const url = low(firstNonEmpty(it && it.url, it && it.link));
  if(!text && !url) return true;
  if(/seed placeholder|movie slot|mediamovie0|placeholder/.test(text)) return true;
  if(url === "#" || url === "/" || url.startsWith("javascript:")) return true;
  return false;
}

function canonicalItem(raw, query, adapterName){
  const it = (raw && typeof raw === "object") ? raw : {};
  const source = firstNonEmpty(it.source, it.provider, it.sourceType, adapterName, "sanmaru");
  const url = firstNonEmpty(it.url, it.link, it.href);
  const title = compactSpaces(stripHtml(firstNonEmpty(it.title, it.name, url, "(no title)"))).slice(0, 260);
  const summary = compactSpaces(stripHtml(firstNonEmpty(it.summary, it.snippet, it.description, it.content))).slice(0, 600);
  const thumb = firstNonEmpty(it.thumbnail, it.thumb, it.image, it.imageUrl, it.cover);
  const images = compactImages([thumb].concat(Array.isArray(it.imageSet) ? it.imageSet : [], Array.isArray(it.images) ? it.images : []));
  const category = categoryOfItem(Object.assign({}, it, { source }));
  const text = [title, summary, url, source, itemText(it)].join(" ");
  const tokens = tokenize(text);
  const trust = typeof it.sourceTrust === "number" ? it.sourceTrust : sourceTrust(source);
  const baseScore = Number.isFinite(Number(it.sanmaruScore)) ? Number(it.sanmaruScore) : (Number.isFinite(Number(it.score)) ? Number(it.score) : 0);

  const out = Object.assign({}, it, {
    id: firstNonEmpty(it.id, stableHash([source, url, title].join("|"))),
    title,
    url,
    link: url,
    snippet: summary,
    summary,
    type: it.type || category,
    mediaType: it.mediaType || (category === "video" ? "video" : (category === "image" ? "image" : (category === "news" ? "article" : it.mediaType))),
    source,
    provider: it.provider || source,
    thumbnail: images[0] || "",
    thumb: images[0] || "",
    image: images[0] || "",
    imageSet: images,
    searchCategory: category,
    displayGroup: it.displayGroup || displayGroupForCategory(category),
    displayGroupPreviewLimit: it.displayGroupPreviewLimit || (displayGroupForCategory(category) === "media" ? 4 : 3),
    sourceTrust: trust,
    sanmaruScore: baseScore,
    indexText: compactSpaces(text).slice(0, 1200),
    normalizedText: normalizeText(text).slice(0, 1200),
    tokens,
    joinedTokens: Array.from(new Set(tokens.map(x => x.replace(/\s+/g, "")).filter(Boolean))).slice(0, 80),
    synonyms: Array.isArray(it.synonyms) ? it.synonyms.slice(0, 30) : [],
    sanmaru: Object.assign({}, it.sanmaru || {}, { touched: true, engine: VERSION })
  });

  if(category === "video" && /youtube|youtu\.be/.test(low(url)) && !isRealYouTubeVideoUrl(url)) {
    out._sanmaruRejectedReason = "invalid_youtube_video_id";
  }
  return out;
}

function dedupeItems(items){
  const seen = new Set();
  const out = [];
  for(const raw of Array.isArray(items) ? items : []){
    if(!raw || typeof raw !== "object") continue;
    if(isPlaceholderItem(raw)) continue;
    if(raw._sanmaruRejectedReason) continue;
    const key = low(firstNonEmpty(raw.url, raw.link, raw.id, raw.title));
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function scoreItem(query, item, ctx){
  const qn = normalizeText(query);
  const joinedQ = qn.replace(/\s+/g, "");
  const text = item.normalizedText || normalizeText(itemText(item));
  const joined = text.replace(/\s+/g, "");
  const source = low(item.source);
  const cat = categoryOfItem(item);
  let score = Number.isFinite(Number(item.sanmaruScore)) ? Number(item.sanmaruScore) : 0;
  if(qn && text.includes(qn)) score += 4;
  if(joinedQ && joined.includes(joinedQ)) score += 3;
  if(qn && normalizeText(item.title).includes(qn)) score += 5;
  score += (item.sourceTrust || sourceTrust(source)) * 5;
  if(source.includes("search-bank-index")) score += 2.5;
  if(source.includes("search-bank")) score += 1.8;
  if(cat === normalizeSearchType(ctx.searchType)) score += 2;
  if(ctx.intents && ctx.intents.includes(cat)) score += 1.5;
  if(item.thumbnail) score += 0.8;
  if(cat === "official") score += 1.4;
  if(cat === "news") score += 1.2;
  if(source.includes("placeholder")) score -= 8;
  return score;
}

function finalRank(query, items, ctx){
  const ranked = dedupeItems((Array.isArray(items) ? items : []).map(x => canonicalItem(x, query, x && x.source)))
    .map((it, idx) => Object.assign({}, it, { sanmaruScore: scoreItem(query, it, ctx), _sanmaruSeq: idx }));
  ranked.sort((a,b) =>
    ((b.sanmaruScore || 0) - (a.sanmaruScore || 0)) ||
    ((b.sourceTrust || 0) - (a.sourceTrust || 0)) ||
    ((a._sanmaruSeq || 0) - (b._sanmaruSeq || 0))
  );
  return ranked;
}

function withTimeout(promise, ms){
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), Math.max(250, ms || 1000)); })
  ]).finally(() => clearTimeout(timer));
}

async function fetchJsonAllowlisted(url, options, timeoutMs){
  const u = new URL(url);
  const allowed = [
    "openapi.naver.com",
    "www.googleapis.com",
    "api.bing.microsoft.com"
  ];
  if(!allowed.includes(u.hostname)) throw new Error("blocked_host");

  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), Math.max(500, timeoutMs || 3000)) : null;
  try{
    const res = await fetch(url, Object.assign({}, options || {}, { signal: ctrl ? ctrl.signal : undefined }));
    if(!res || !res.ok) throw new Error("HTTP_" + (res && res.status));
    return await res.json();
  }finally{
    if(timer) clearTimeout(timer);
  }
}

function circuit(name){
  return globalState.circuits[name] || (globalState.circuits[name] = { failures:0, openedAt:0, lastStatus:"unknown" });
}
function circuitAllows(name){
  const c = circuit(name);
  if(c.failures < 5) return true;
  if(nowMs() - c.openedAt > 60 * 1000){ c.failures = 0; c.openedAt = 0; c.lastStatus = "half_open"; return true; }
  return false;
}
function circuitOk(name){ const c = circuit(name); c.failures = 0; c.openedAt = 0; c.lastStatus = "ok"; }
function circuitFail(name, status){ const c = circuit(name); c.failures += 1; c.openedAt = nowMs(); c.lastStatus = status || "fail"; }

function normalizeItemsFromResponse(res){
  if(!res) return [];
  if(Array.isArray(res)) return res;
  if(Array.isArray(res.items)) return res.items;
  if(Array.isArray(res.results)) return res.results;
  if(res.data && Array.isArray(res.data.items)) return res.data.items;
  if(res.data && Array.isArray(res.data.results)) return res.data.results;
  if(res.baseResult && Array.isArray(res.baseResult.items)) return res.baseResult.items;
  if(res.baseResult && res.baseResult.data && Array.isArray(res.baseResult.data.items)) return res.baseResult.data.items;
  return [];
}

function adapterResult(name, status, started, items, extra){
  return Object.assign({
    name,
    status,
    count: Array.isArray(items) ? items.length : 0,
    latency: nowMs() - started
  }, extra || {});
}

async function callSearchBankIndex(ctx){
  const started = nowMs();
  try{
    let mod = null;
    try{ mod = require("./search-bank-index-engine"); }catch(e){ mod = null; }
    if(!mod) return { trace: adapterResult("searchbank-index", "unavailable", started, []), items: [] };
    const params = {
      action: "query",
      q: ctx.q,
      query: ctx.q,
      limit: Math.min(ctx.limit, 300),
      type: ctx.searchType === "all" ? "" : ctx.searchType,
      lang: ctx.lang,
      from: "sanmaru",
      noExternal: "1",
      skipSanmaru: "1"
    };
    let res = null;
    if(typeof mod.runEngine === "function") res = await withTimeout(mod.runEngine(ctx.event || {}, params), 900);
    else if(typeof mod.query === "function") res = await withTimeout(mod.query(ctx.q, params), 900);
    else if(typeof mod.handler === "function"){
      const h = await withTimeout(mod.handler({ httpMethod:"GET", headers:(ctx.event && ctx.event.headers) || {}, queryStringParameters: params }), 900);
      res = h && typeof h.body === "string" ? JSON.parse(h.body || "{}") : h;
    }
    const items = normalizeItemsFromResponse(res).map(x => canonicalItem(x, ctx.q, "search-bank-index"));
    return { trace: adapterResult("searchbank-index", items.length ? "ok" : "empty", started, items), items };
  }catch(e){
    return { trace: adapterResult("searchbank-index", responseErrorCode(e), started, [], { error: responseErrorCode(e) }), items: [] };
  }
}

async function callSearchBank(ctx){
  const started = nowMs();
  try{
    let mod = null;
    try{ mod = require("./search-bank-engine"); }catch(e){ mod = null; }
    if(!mod) return { trace: adapterResult("searchbank", "unavailable", started, []), items: [] };
    const params = {
      q: ctx.q,
      query: ctx.q,
      limit: Math.min(ctx.limit, 500),
      type: ctx.searchType === "all" ? "" : ctx.searchType,
      lang: ctx.lang,
      from: "sanmaru",
      source: "sanmaru",
      external: "off",
      noExternal: "1",
      disableExternal: "1",
      skipMaruSearch: "1",
      noMaruSearch: "1",
      skipSanmaru: "1",
      noSanmaru: "1",
      skipCollector: "1",
      skipPlanetary: "1",
      noAnalytics: "1",
      noRevenue: "1"
    };
    let res = null;
    if(typeof mod.runEngine === "function") res = await withTimeout(mod.runEngine(ctx.event || {}, params), 2200);
    else if(typeof mod.handler === "function"){
      const h = await withTimeout(mod.handler({ httpMethod:"GET", headers:(ctx.event && ctx.event.headers) || {}, queryStringParameters: params }), 2200);
      res = h && typeof h.body === "string" ? JSON.parse(h.body || "{}") : h;
    }
    const items = normalizeItemsFromResponse(res).map(x => canonicalItem(x, ctx.q, "search-bank"));
    return { trace: adapterResult("searchbank", items.length ? "ok" : "empty", started, items), items };
  }catch(e){
    return { trace: adapterResult("searchbank", responseErrorCode(e), started, [], { error: responseErrorCode(e) }), items: [] };
  }
}

async function naverGeneric(ctx, endpoint, source, type, display, start){
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if(!id || !secret) return null;
  const url = "https://openapi.naver.com/v1/search/" + endpoint +
    "?query=" + encodeURIComponent(ctx.q) +
    "&display=" + Math.max(1, Math.min(display || 30, endpoint === "local.json" ? 5 : 100)) +
    "&start=" + Math.max(1, start || 1) +
    ((endpoint === "blog.json" || endpoint === "cafearticle.json" || endpoint === "kin.json") ? "&sort=sim" : "");
  const data = await fetchJsonAllowlisted(url, { headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret } }, 3000);
  return (Array.isArray(data.items) ? data.items : []).map(it => {
    const title = stripHtml(it.title || ctx.q);
    const desc = stripHtml(it.description || it.summary || "");
    const link = firstNonEmpty(it.link, it.originallink, it.url);
    const address = [it.category, it.roadAddress || it.address].filter(Boolean).join(" · ");
    const thumb = firstNonEmpty(it.thumbnail, it.image);
    return canonicalItem({
      title,
      url: link,
      link,
      summary: address ? (desc ? desc + " · " + address : address) : desc,
      snippet: address ? (desc ? desc + " · " + address : address) : desc,
      type,
      mediaType: type === "news" ? "article" : (type === "local" ? "map" : type),
      source,
      thumbnail: thumb,
      image: thumb,
      payload: { source, endpoint, category: it.category, address: it.address, roadAddress: it.roadAddress, pubDate: it.pubDate, postdate: it.postdate, publisher: it.publisher, author: it.author, isbn: it.isbn }
    }, ctx.q, source);
  });
}

async function naverImage(ctx){
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if(!id || !secret) return null;
  const url = "https://openapi.naver.com/v1/search/image.json?query=" + encodeURIComponent(ctx.q) + "&display=" + Math.min(ctx.deep ? 60 : 30, 100) + "&start=1&sort=sim";
  const data = await fetchJsonAllowlisted(url, { headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret } }, 3000);
  return (Array.isArray(data.items) ? data.items : []).map(it => {
    const img = firstNonEmpty(it.link, it.thumbnail);
    const context = firstNonEmpty(it.originallink, img);
    return canonicalItem({ title: stripHtml(it.title || ctx.q), url: context, link: context, type:"image", mediaType:"image", source:"naver_image", thumbnail: img, image: img, imageSet: [img, it.thumbnail].filter(Boolean), payload:{ source:"naver_image", contextLink:context } }, ctx.q, "naver_image");
  });
}

async function googleWeb(ctx){
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if(!key || !cx) return null;
  const url = "https://www.googleapis.com/customsearch/v1?key=" + encodeURIComponent(key) + "&cx=" + encodeURIComponent(cx) + "&q=" + encodeURIComponent(ctx.q) + "&num=" + Math.min(ctx.deep ? 10 : 6, 10) + "&start=1&gl=us";
  const data = await fetchJsonAllowlisted(url, null, 3200);
  return (Array.isArray(data.items) ? data.items : []).map(it => {
    const pagemap = it.pagemap || {};
    const cseThumb = Array.isArray(pagemap.cse_thumbnail) ? pagemap.cse_thumbnail[0] : null;
    const cseImg = Array.isArray(pagemap.cse_image) ? pagemap.cse_image[0] : null;
    const img = firstNonEmpty(cseImg && cseImg.src, cseThumb && cseThumb.src);
    return canonicalItem({ title: it.title, url: it.link, link: it.link, summary: it.snippet, snippet: it.snippet, type:"web", source:"google", thumbnail: img, image: img, payload:{ source:"google" } }, ctx.q, "google");
  });
}

async function googleImage(ctx){
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if(!key || !cx) return null;
  const url = "https://www.googleapis.com/customsearch/v1?key=" + encodeURIComponent(key) + "&cx=" + encodeURIComponent(cx) + "&q=" + encodeURIComponent(ctx.q) + "&searchType=image&num=" + Math.min(ctx.deep ? 10 : 6, 10) + "&start=1";
  const data = await fetchJsonAllowlisted(url, null, 3200);
  return (Array.isArray(data.items) ? data.items : []).map(it => {
    const context = it.image && it.image.contextLink ? it.image.contextLink : it.link;
    return canonicalItem({ title: it.title, url: context, link: context, summary: it.snippet, snippet: it.snippet, type:"image", mediaType:"image", source:"google_image", thumbnail: it.link, image: it.link, imageSet:[it.link], payload:{ source:"google_image", contextLink:context } }, ctx.q, "google_image");
  });
}

async function bingWeb(ctx){
  const key = process.env.BING_API_KEY;
  if(!key) return null;
  const url = "https://api.bing.microsoft.com/v7.0/search?q=" + encodeURIComponent(ctx.q) + "&count=" + Math.min(ctx.deep ? 40 : 20, 50) + "&offset=0";
  const data = await fetchJsonAllowlisted(url, { headers: { "Ocp-Apim-Subscription-Key": key } }, 3200);
  return ((data.webPages && data.webPages.value) || []).map(it => canonicalItem({ title: it.name, url: it.url, link: it.url, summary: it.snippet, snippet: it.snippet, type:"web", source:"bing" }, ctx.q, "bing"));
}

async function youtube(ctx){
  const key = process.env.YOUTUBE_API_KEY;
  if(!key) return null;
  const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=" + Math.min(ctx.deep ? 35 : 18, 50) + "&q=" + encodeURIComponent(ctx.q) + "&key=" + encodeURIComponent(key);
  const data = await fetchJsonAllowlisted(url, null, 3600);
  return (Array.isArray(data.items) ? data.items : []).map(it => {
    const videoId = it.id && it.id.videoId;
    if(!/^[A-Za-z0-9_-]{11}$/.test(s(videoId))) return null;
    const sn = it.snippet || {};
    const thumbs = sn.thumbnails || {};
    const thumb = firstNonEmpty(thumbs.high && thumbs.high.url, thumbs.medium && thumbs.medium.url, thumbs.default && thumbs.default.url);
    const url = "https://www.youtube.com/watch?v=" + videoId;
    return canonicalItem({ title: sn.title, url, link: url, summary: sn.description, snippet: sn.description, type:"video", mediaType:"video", source:"youtube", thumbnail: thumb, image: thumb, media:{ type:"video", videoId, preview:{ poster:thumb } }, payload:{ source:"youtube", videoId } }, ctx.q, "youtube");
  }).filter(Boolean);
}

async function callOptionalModuleAdapter(ctx, name, modulePath, runParams, timeoutMs){
  const started = nowMs();
  try{
    if(!truthy(ctx.raw && (ctx.raw["use" + name] || ctx.raw[name] || ctx.raw["enable" + name])) && !truthy(process.env["SANMARU_ENABLE_" + name.toUpperCase()])){
      return { trace: adapterResult(name, "disabled", started, []), items: [] };
    }
    let mod = null;
    try{ mod = require(modulePath); }catch(e){ mod = null; }
    if(!mod) return { trace: adapterResult(name, "unavailable", started, []), items: [] };
    const params = Object.assign({}, runParams || {}, {
      q: ctx.q,
      query: ctx.q,
      limit: Math.min(ctx.limit, 120),
      type: ctx.searchType,
      from: "sanmaru",
      source: "sanmaru",
      noMaruSearch: "1",
      skipMaruSearch: "1",
      noSanmaru: "1",
      skipSanmaru: "1",
      noAnalytics: "1",
      noRevenue: "1"
    });
    let res = null;
    if(typeof mod.runEngine === "function") res = await withTimeout(mod.runEngine(ctx.event || {}, params), timeoutMs || 2500);
    else if(typeof mod.connect === "function") res = await withTimeout(mod.connect(ctx.event || {}, params), timeoutMs || 2500);
    else if(typeof mod.handler === "function"){
      const h = await withTimeout(mod.handler({ httpMethod:"GET", headers:(ctx.event && ctx.event.headers) || {}, queryStringParameters: params }), timeoutMs || 2500);
      res = h && typeof h.body === "string" ? JSON.parse(h.body || "{}") : h;
    }
    const items = normalizeItemsFromResponse(res).map(x => canonicalItem(x, ctx.q, name));
    return { trace: adapterResult(name, items.length ? "ok" : "empty", started, items), items };
  }catch(e){
    return { trace: adapterResult(name, responseErrorCode(e), started, [], { error: responseErrorCode(e) }), items: [] };
  }
}

const ADAPTERS = [
  { name:"naver-web", timeoutMs:3200, match:ctx => ctx.externalAllowed && (ctx.region === "KR" || ctx.externalForced || ctx.needExternal), access:ctx => naverGeneric(ctx, "webkr.json", "naver", "web", ctx.deep ? 100 : 60, 1) },
  { name:"naver-news", timeoutMs:3200, match:ctx => ctx.externalAllowed && (ctx.intents.includes("news") || ctx.externalForced || ctx.needExternal), access:ctx => naverGeneric(ctx, "news.json", "naver_news", "news", ctx.deep ? 80 : 40, 1) },
  { name:"naver-blog", timeoutMs:3200, match:ctx => ctx.externalAllowed && (ctx.intents.includes("blog") || ctx.intents.includes("tour") || ctx.intents.includes("cafe") || ctx.externalForced), access:ctx => naverGeneric(ctx, "blog.json", "naver_blog", "blog", ctx.deep ? 60 : 30, 1) },
  { name:"naver-cafe", timeoutMs:3200, match:ctx => ctx.externalAllowed && (ctx.intents.includes("cafe") || ctx.intents.includes("tour") || ctx.externalForced), access:ctx => naverGeneric(ctx, "cafearticle.json", "naver_cafe", "cafe", ctx.deep ? 60 : 30, 1) },
  { name:"naver-local", timeoutMs:3000, match:ctx => ctx.externalAllowed && (ctx.intents.includes("map") || ctx.intents.includes("tour") || ctx.externalForced), access:ctx => naverGeneric(ctx, "local.json", "naver_local", "local", 5, 1) },
  { name:"naver-book", timeoutMs:3200, match:ctx => ctx.externalAllowed && (ctx.intents.includes("book") || ctx.externalForced), access:ctx => naverGeneric(ctx, "book.json", "naver_book", "book", ctx.deep ? 80 : 40, 1) },
  { name:"naver-image", timeoutMs:3200, match:ctx => ctx.externalAllowed && !ctx.noMedia && (ctx.intents.includes("image") || ctx.intents.includes("tour") || ctx.intents.includes("video") || ctx.externalForced || ctx.needExternal), access:ctx => naverImage(ctx) },
  { name:"google-web", timeoutMs:3400, match:ctx => ctx.externalAllowed && (ctx.region !== "KR" || ctx.externalForced || ctx.needExternal || ctx.intents.includes("knowledge") || ctx.intents.includes("news")), access:ctx => googleWeb(ctx) },
  { name:"google-image", timeoutMs:3400, match:ctx => ctx.externalAllowed && !ctx.noMedia && (ctx.intents.includes("image") || ctx.externalForced || ctx.needExternal), access:ctx => googleImage(ctx) },
  { name:"bing-web", timeoutMs:3400, match:ctx => ctx.externalAllowed && (ctx.externalForced || ctx.needExternal || ctx.region !== "KR"), access:ctx => bingWeb(ctx) },
  { name:"youtube", timeoutMs:3800, match:ctx => ctx.externalAllowed && !ctx.noMedia && (ctx.intents.includes("video") || ctx.intents.includes("sns") || ctx.externalForced), access:ctx => youtube(ctx) },
];

async function executeAdapter(adapter, ctx){
  const started = nowMs();
  const name = adapter.name;
  if(!circuitAllows(name)) return { trace: adapterResult(name, "circuit_open", started, []), items: [] };
  try{
    const raw = await withTimeout(adapter.access(ctx), adapter.timeoutMs || 2500);
    const items = (Array.isArray(raw) ? raw : normalizeItemsFromResponse(raw)).map(x => canonicalItem(x, ctx.q, name));
    circuitOk(name);
    return { trace: adapterResult(name, items.length ? "ok" : "empty", started, items), items };
  }catch(e){
    const code = responseErrorCode(e);
    circuitFail(name, code);
    return { trace: adapterResult(name, code, started, [], { error: code }), items: [] };
  }
}

function selectAdapters(ctx){
  const selected = [];
  for(const adapter of ADAPTERS){
    try{
      if(adapter.match(ctx)) selected.push(adapter);
    }catch(e){}
  }
  const cap = ctx.deep ? 12 : 8;
  return selected.slice(0, cap);
}

async function maybePromote(ctx, items, meta){
  const started = nowMs();
  try{
    const candidates = (Array.isArray(items) ? items : [])
      .filter(it => (it.sanmaruScore || 0) >= 7 && (it.sourceTrust || 0) >= 0.6)
      .slice(0, 80);
    if(!candidates.length) return { used:false, status:"skipped-no-candidates", count:0, latency: nowMs() - started };

    // Always keep a safe in-memory layer even before the persistent index engine exists.
    const memKey = stableHash([ctx.q, ctx.searchType, ctx.lang || ""].join("|"));
    globalState.memory.set(memKey, { t: nowMs(), q: ctx.q, items: candidates });
    if(globalState.memory.size > 500){
      const first = globalState.memory.keys().next().value;
      globalState.memory.delete(first);
    }

    let mod = null;
    try{ mod = require("./search-bank-index-engine"); }catch(e){ mod = null; }
    if(!mod) return { used:true, status:"memory-only-index-unavailable", count:candidates.length, latency: nowMs() - started };

    const payload = {
      action:"promote",
      q: ctx.q,
      query: ctx.q,
      type: ctx.searchType === "all" ? "" : ctx.searchType,
      lang: ctx.lang,
      from:"sanmaru",
      source:"sanmaru",
      items: candidates,
      meta: { sanmaruVersion: VERSION, reason:"score-trust-promotion" }
    };

    let res = null;
    if(typeof mod.runEngine === "function") res = await withTimeout(mod.runEngine(ctx.event || {}, payload), 1000);
    else if(typeof mod.promote === "function") res = await withTimeout(mod.promote(payload), 1000);
    return { used:true, status:"ok", count:candidates.length, latency: nowMs() - started, indexStatus: s(res && res.status || "unknown") };
  }catch(e){
    return { used:true, status:responseErrorCode(e), count:0, latency: nowMs() - started };
  }
}

function parseCtx(input, maybeCtx){
  const ctx = Object.assign({}, maybeCtx || {});
  if(typeof input === "string") ctx.q = input;
  else if(input && typeof input === "object") Object.assign(ctx, input);

  const raw = ctx.raw || ctx.params || {};
  const event = ctx.event || {};
  const qs = (event && event.queryStringParameters) || {};
  const qRaw = firstNonEmpty(ctx.q, ctx.query, raw.q, raw.query, qs.q, qs.query);
  const clean = sanitizeQuery(qRaw);

  const searchType = normalizeSearchType(firstNonEmpty(ctx.type, ctx.searchType, raw.type, raw.category, raw.tab, raw.vertical, qs.type, qs.category, qs.tab, qs.vertical, "all"));
  const limit = clampInt(firstNonEmpty(ctx.limit, raw.limit, qs.limit), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const externalRaw = low(firstNonEmpty(ctx.external, raw.external, qs.external, "auto"));
  const externalOff = externalRaw === "off" || externalRaw === "0" || externalRaw === "false" || truthy(ctx.noExternal || raw.noExternal || qs.noExternal || ctx.disableExternal || raw.disableExternal || qs.disableExternal);
  const deep = truthy(ctx.deep || raw.deep || qs.deep) || externalRaw === "deep";
  const externalForced = ["1","true","yes","on","force","live","deep"].includes(externalRaw) || truthy(ctx.useExternal || raw.useExternal || qs.useExternal || ctx.useLive || raw.useLive || qs.useLive);
  const lang = firstNonEmpty(ctx.lang, ctx.uiLang, ctx.locale, raw.lang, raw.uiLang, raw.locale, qs.lang, qs.uiLang, qs.locale);

  return Object.assign(ctx, {
    event,
    raw: Object.assign({}, qs, raw),
    q: clean.value,
    query: clean.value,
    queryOk: clean.ok,
    queryCode: clean.code,
    queryRisk: clean.risk,
    limit,
    searchType,
    lang,
    deep,
    noMedia: truthy(ctx.noMedia || raw.noMedia || qs.noMedia || ctx.disableMedia || raw.disableMedia || qs.disableMedia),
    externalOff,
    externalForced,
    externalAllowed: !externalOff,
    timeoutMs: clampInt(ctx.timeoutMs || raw.timeoutMs || qs.timeoutMs, deep ? DEEP_TIMEOUT_MS : DEFAULT_TIMEOUT_MS, 1500, deep ? 15000 : 12000),
    region: detectRuntimeRegion(event, lang, clean.value),
    requestId: firstNonEmpty(ctx.requestId, stableHash([clean.value, nowMs(), Math.random()].join("|")))
  });
}

async function runSanmaru(input, maybeCtx){
  const ctx = parseCtx(input, maybeCtx);
  const engineStarted = nowMs();

  if(!ctx.queryOk){
    return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:ctx.q, items:[], results:[], meta:{ count:0, reason:ctx.queryCode || "BAD_QUERY", secure:true } };
  }

  const ip = clientIp(ctx.event);
  if(!rateLimitOk(ip)){
    return { status:"blocked", engine:ENGINE_NAME, version:VERSION, query:ctx.q, items:[], results:[], meta:{ count:0, reason:"rate_limit", secure:true } };
  }

  globalState.cache = globalState.cache || new Map();
  globalState.inflight = globalState.inflight || new Map();

  const cacheKey = stableHash([ctx.q, ctx.limit, ctx.searchType, ctx.lang || "", ctx.deep ? "deep" : "normal", ctx.externalOff ? "off" : (ctx.externalForced ? "force" : "auto"), ctx.noMedia ? "nomedia" : "media"].join("|"));
  const cached = globalState.cache.get(cacheKey);
  if(cached && nowMs() - cached.t < CACHE_TTL_MS){
    return Object.assign({}, safeJsonClone(cached.v), { meta: Object.assign({}, cached.v.meta || {}, { cache:{ hit:true, key:cacheKey } }) });
  }

  const inflight = globalState.inflight.get(cacheKey);
  if(inflight && nowMs() - inflight.t < INFLIGHT_TTL_MS) return await inflight.p;

  const work = (async () => {
    const trace = [];
    const items = [];
    const intents = detectIntent(ctx.q, ctx.searchType);
    ctx.intents = intents;

    const indexRes = await callSearchBankIndex(ctx);
    trace.push(indexRes.trace);
    items.push(...indexRes.items);

    const bankRes = await callSearchBank(ctx);
    trace.push(bankRes.trace);
    items.push(...bankRes.items);

    const fastCount = dedupeItems(items).length;
    const forcedOrDeep = !!ctx.externalForced || !!ctx.deep;
    ctx.needExternal = ctx.externalAllowed && (forcedOrDeep || ctx.searchType !== "all" || fastCount < DEFAULT_EXTERNAL_TRIGGER_MIN);

    const selected = selectAdapters(ctx);
    if(ctx.externalAllowed && selected.length){
      const settled = await Promise.allSettled(selected.map(a => executeAdapter(a, ctx)));
      for(const r of settled){
        const value = r && r.status === "fulfilled" ? r.value : null;
        if(value){ trace.push(value.trace); items.push(...value.items); }
      }
    }else{
      trace.push({ name:"external-adapters", status:ctx.externalAllowed ? "skipped-fast-memory-enough" : "blocked-by-request", count:0 });
    }

    const collectorRes = await callOptionalModuleAdapter(ctx, "collector", "./collector", { useCollector:"1" }, 2200);
    trace.push(collectorRes.trace);
    items.push(...collectorRes.items);

    const planetaryRes = await callOptionalModuleAdapter(ctx, "planetary", "./planetary-data-connector", { usePlanetary:true, federation:"on" }, 2400);
    trace.push(planetaryRes.trace);
    items.push(...planetaryRes.items);

    let ranked = finalRank(ctx.q, items, ctx);
    const finalTarget = Math.min(ctx.limit, Math.max(ctx.limit, MIN_FAST_TARGET));
    ranked = ranked.slice(0, finalTarget).map(it => {
      const copy = Object.assign({}, it);
      delete copy._sanmaruSeq;
      delete copy._sanmaruRejectedReason;
      return copy;
    });

    const promotion = await maybePromote(ctx, ranked, { trace });

    const result = {
      status:"ok",
      engine:ENGINE_NAME,
      version:VERSION,
      query:ctx.q,
      source: ranked.length ? "sanmaru" : null,
      items: ranked,
      results: ranked,
      meta:{
        count: ranked.length,
        requestedLimit: ctx.limit,
        totalCandidates: items.length,
        deduped: Math.max(0, items.length - dedupeItems(items).length),
        elapsedMs: nowMs() - engineStarted,
        region: ctx.region,
        lang: ctx.lang || null,
        searchType: ctx.searchType,
        intents,
        queryRisk: ctx.queryRisk || null,
        secure: true,
        role: "virtual-web-ecosystem-integrated-information-bank-engine",
        cache:{ hit:false, key:cacheKey },
        searchBankIndex:{ used:true, status:indexRes.trace.status, count:indexRes.trace.count, latency:indexRes.trace.latency },
        searchBank:{ used:true, status:bankRes.trace.status, count:bankRes.trace.count, latency:bankRes.trace.latency },
        external:{
          allowed: ctx.externalAllowed,
          forced: ctx.externalForced,
          deep: ctx.deep,
          selected: selected.map(x => x.name),
          trace: trace.filter(x => x && !["searchbank-index","searchbank"].includes(x.name))
        },
        promotion,
        health: healthSnapshot(),
        trace
      }
    };

    globalState.cache.set(cacheKey, { t: nowMs(), v: result });
    return result;
  })();

  globalState.inflight.set(cacheKey, { t: nowMs(), p: work });
  try{ return await withTimeout(work, ctx.timeoutMs); }
  catch(e){
    return {
      status:"error",
      engine:ENGINE_NAME,
      version:VERSION,
      query:ctx.q,
      items:[],
      results:[],
      meta:{
        count:0,
        elapsedMs: nowMs() - engineStarted,
        secure:true,
        error: responseErrorCode(e),
        fallbackRecommended: true,
        health: healthSnapshot()
      }
    };
  }finally{
    globalState.inflight.delete(cacheKey);
  }
}

function healthSnapshot(){
  const circuits = {};
  for(const [k,v] of Object.entries(globalState.circuits || {})){
    circuits[k] = { failures:v.failures || 0, lastStatus:v.lastStatus || "unknown", open: (v.failures || 0) >= 5 };
  }
  return {
    engine: ENGINE_NAME,
    version: VERSION,
    status: "ok",
    cacheSize: globalState.cache ? globalState.cache.size : 0,
    memorySize: globalState.memory ? globalState.memory.size : 0,
    circuits,
    adapters: ["searchbank-index","searchbank"].concat(ADAPTERS.map(x => x.name), ["collector","planetary"]),
    generatedAt: nowIso()
  };
}

function ok(body){
  return {
    statusCode: 200,
    headers: {
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store, no-cache, must-revalidate, max-age=0",
      "Pragma":"no-cache",
      "Expires":"0",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Headers":"content-type",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function parseBody(event){
  try{
    const raw = event && event.body;
    if(!raw) return {};
    const text = event && event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : s(raw);
    if(!text.trim()) return {};
    return JSON.parse(text);
  }catch(e){ return {}; }
}

async function handler(event){
  if(event && event.httpMethod === "OPTIONS") return ok({ status:"ok" });
  const qs = (event && event.queryStringParameters) || {};
  const body = parseBody(event || {});
  const merged = Object.assign({}, qs, body);
  const action = low(firstNonEmpty(merged.action, merged.mode, merged.fn));

  if(action === "health") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, health:healthSnapshot() });

  const res = await runSanmaru({
    event: event || {},
    raw: merged,
    q: firstNonEmpty(merged.q, merged.query),
    limit: merged.limit,
    type: firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical),
    lang: firstNonEmpty(merged.lang, merged.uiLang, merged.locale),
    deep: merged.deep,
    external: merged.external,
    noExternal: merged.noExternal,
    disableExternal: merged.disableExternal,
    noMedia: merged.noMedia,
    disableMedia: merged.disableMedia
  });
  return ok(res);
}

async function runEngine(event, params){
  return await runSanmaru({ event: event || {}, raw: params || {}, q: firstNonEmpty(params && params.q, params && params.query), limit: params && params.limit, type: params && (params.type || params.category || params.tab || params.vertical), lang: params && (params.lang || params.uiLang || params.locale), deep: params && params.deep, external: params && params.external, noExternal: params && params.noExternal, disableExternal: params && params.disableExternal, noMedia: params && params.noMedia, disableMedia: params && params.disableMedia });
}

module.exports = {
  version: VERSION,
  runSanmaru,
  runEngine,
  handler,
  health: healthSnapshot,
  sanitizeQuery,
  canonicalItem,
  finalRank,
  detectIntent
};

exports.version = VERSION;
exports.runSanmaru = runSanmaru;
exports.runEngine = runEngine;
exports.handler = handler;
exports.health = healthSnapshot;
