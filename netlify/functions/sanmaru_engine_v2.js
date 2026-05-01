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

const VERSION = "sanmaru-engine-v2.3.3-global-resident-library-instant-surface";
const ENGINE_NAME = "sanmaru";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;
const DEFAULT_TIMEOUT_MS = 10500;
const DEEP_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const INFLIGHT_TTL_MS = 30 * 1000;
const RATE_WINDOW_MS = 10 * 1000;
const RATE_MAX = 60;
const MAX_QUERY_LENGTH = 240;
const MIN_FAST_TARGET = 1000;
const DEFAULT_EXTERNAL_TRIGGER_MIN = 0;
const DEFAULT_CANDIDATE_POOL_TARGET = 3000;
const MAX_INDEX_FAST_LIMIT = 2000;
const MAX_SEARCH_BANK_FAST_LIMIT = 2000;
const FAST_VISIBLE_PER_PAGE = 15;
const FAST_FIRST_MIN_RESULTS = 15;

const globalState = globalThis.__SANMARU_V2_STATE || (globalThis.__SANMARU_V2_STATE = {
  cache: new Map(),
  inflight: new Map(),
  rate: new Map(),
  circuits: Object.create(null),
  memory: new Map(),
  telemetry: []
});


const MOUNT_REGISTRY = {
  "searchbank-index": {
    type: "fast-memory",
    permission: "owned",
    role: "Sanmaru fast reusable index layer",
    enabled: true
  },
  "searchbank": {
    type: "operational-memory",
    permission: "owned",
    role: "Sanmaru operating memory / snapshot source",
    enabled: true
  },
  "maru-search-wide-gateway": {
    type: "platform-information-road",
    permission: "owned",
    role: "Maru Search broad gateway mount; preserves the platform body and existing wide search spectrum",
    enabled: true
  },
  "collector": {
    type: "owned-collector",
    permission: "owned",
    role: "Internal collector ridge under Sanmaru",
    enabled: true
  },
  "planetary": {
    type: "federation",
    permission: "owned-or-registered",
    role: "Planetary federation ridge under Sanmaru",
    enabled: true
  },
  "naver": {
    type: "external-search",
    permission: "api-key-required",
    role: "Reserved/active Naver mount; normally routed through Maru Search wide gateway to avoid duplicate API bursts",
    enabled: !!(process.env.NAVER_API_KEY && process.env.NAVER_CLIENT_SECRET)
  },
  "google": {
    type: "external-search",
    permission: "api-key-required",
    role: "Reserved/active Google CSE mount; normally routed through Maru Search wide gateway to avoid duplicate API bursts",
    enabled: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID)
  },
  "bing": {
    type: "external-search",
    permission: "api-key-required",
    role: "Reserved/active Bing mount; normally routed through Maru Search wide gateway to avoid duplicate API bursts",
    enabled: !!process.env.BING_API_KEY
  },
  "youtube": {
    type: "media-search",
    permission: "api-key-required",
    role: "Reserved/active YouTube media mount; normally routed through Maru Search wide gateway to avoid duplicate API bursts",
    enabled: !!process.env.YOUTUBE_API_KEY
  },
  "ai-gpu": {
    type: "analysis-provider",
    permission: "provider-key-or-local-runtime-required",
    role: "AI/GPU classification, dedupe, summarization and promotion decision layer",
    enabled: !!(process.env.OPENAI_API_KEY || process.env.AI_PROVIDER_KEY || process.env.SANMARU_AI_GPU_ENABLED)
  },
  "official-web": {
    type: "open-web-discovery",
    permission: "public-search-or-api-required",
    role: "Official homepage, government, institution and authority discovery through Maru Search controlled gateway",
    enabled: true
  },
  "social-public-web": {
    type: "public-social-discovery",
    permission: "public-search-or-platform-api-required",
    role: "Public YouTube/Instagram/Facebook/TikTok/X/LinkedIn discovery without private scraping",
    enabled: true
  },
  "corporate-homepage": {
    type: "enterprise-public-web-discovery",
    permission: "public-search-or-contract-api-required",
    role: "Company, brand, service homepage and public business profile discovery",
    enabled: true
  },
  "blog-community": {
    type: "blog-community-discovery",
    permission: "public-search-or-api-required",
    role: "Public blog, cafe, forum and community discovery through authorized search channels",
    enabled: true
  },
  "future-authorized-db": {
    type: "reserved-mount-slot",
    permission: "contract-or-public-permission-required",
    role: "Disabled slot for future lawful/authorized DB, server, API or platform channels",
    enabled: false
  }
};

function mountRegistrySnapshot(){
  const out = {};
  for(const [name, meta] of Object.entries(MOUNT_REGISTRY)){
    out[name] = {
      type: meta.type,
      permission: meta.permission,
      role: meta.role,
      enabled: !!meta.enabled,
      status: meta.enabled ? "active-or-ready" : "reserved-or-key-missing"
    };
  }
  return out;
}

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

  if(type === "tour" || source.includes("tour")) return "tour";
  if(type === "official" || source.includes("official") || source.includes("public_surface")) return "official";
  if(type === "map" || type === "local" || source.includes("map")) return "map";
  if(type === "shopping" || type === "product" || source.includes("shopping") || source.includes("shop")) return "shopping";
  if(type === "sns" || source.includes("instagram") || source.includes("facebook") || source.includes("tiktok") || source.includes("twitter") || source.includes("x_twitter") || source.includes("sns") || source.includes("social")) return "sns";
  if(type === "video" || source.includes("youtube") || source.includes("video")) return "video";
  if(type === "blog" || source.includes("blog")) return "blog";
  if(type === "cafe" || source.includes("cafe")) return "cafe";
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

  if(category === "video" && !out.instantSurface && /youtube|youtu\.be/.test(low(url)) && !isRealYouTubeVideoUrl(url)) {
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
  if(item.instantSurface){
    const src = low(item.source);
    score += 10;
    if(src.includes("official")) score += 3.2;
    else if(src.includes("public")) score += 3.0;
    else if(src.includes("map")) score += 2.6;
    else if(src.includes("tour")) score += 2.4;
    else if(src.includes("knowledge")) score += 2.2;
    else if(src.includes("news")) score += 2.0;
    else if(src.includes("image")) score += 1.8;
    else if(src.includes("youtube")) score += 1.7;
    else if(src.includes("blog")) score += 1.5;
    else if(src.includes("cafe")) score += 1.4;
    else if(src.includes("instagram") || src.includes("facebook") || src.includes("tiktok")) score += 1.3;
    else if(src.includes("shopping")) score += 1.2;
  }
  if(cat === "official") score += 2.2;
  if(cat === "map" || cat === "tour") score += 1.9;
  if(cat === "knowledge") score += 1.5;
  if(cat === "news") score += 1.4;
  if(cat === "video" || cat === "image") score += 1.1;
  if(cat === "blog" || cat === "cafe" || cat === "sns") score += 0.9;
  if(source.includes("placeholder")) score -= 8;
  return score;
}

function instantSurfacePriority(it){
  if(!it || !it.instantSurface) return 0;
  const src = low(it.source);
  if(src.includes("official")) return 120;
  if(src.includes("public")) return 118;
  if(src.includes("google_maps")) return 116;
  if(src.includes("naver_map")) return 114;
  if(src.includes("tour")) return 112;
  if(src.includes("knowledge")) return 110;
  if(src.includes("news")) return 108;
  if(src.includes("image")) return 106;
  if(src.includes("youtube")) return 104;
  if(src.includes("blog")) return 102;
  if(src.includes("cafe")) return 100;
  if(src.includes("instagram")) return 98;
  if(src.includes("facebook")) return 96;
  if(src.includes("tiktok")) return 94;
  if(src.includes("shopping")) return 92;
  return 80;
}

function finalRank(query, items, ctx){
  const ranked = dedupeItems((Array.isArray(items) ? items : []).map(x => canonicalItem(x, query, x && x.source)))
    .map((it, idx) => Object.assign({}, it, { sanmaruScore: scoreItem(query, it, ctx), _sanmaruSeq: idx, _instantSurfacePriority: instantSurfacePriority(it) }));
  ranked.sort((a,b) =>
    ((b._instantSurfacePriority || 0) - (a._instantSurfacePriority || 0)) ||
    ((b.sanmaruScore || 0) - (a.sanmaruScore || 0)) ||
    ((b.sourceTrust || 0) - (a.sourceTrust || 0)) ||
    ((a._sanmaruSeq || 0) - (b._sanmaruSeq || 0))
  );
  return ranked;
}

function countFacet(items, picker, max){
  const map = Object.create(null);
  for(const it of Array.isArray(items) ? items : []){
    const key = s(picker(it) || "unknown").trim() || "unknown";
    map[key] = (map[key] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a,b) => b[1] - a[1])
    .slice(0, max || 30)
    .map(([name,count]) => ({ name, count }));
}

function sourceDiversity(items){
  return countFacet(items, it => firstNonEmpty(it && it.source, it && it.provider, "unknown"), 40);
}

function categoryDiversity(items){
  return countFacet(items, it => firstNonEmpty(it && it.searchCategory, it && it.type, it && it.category, categoryOfItem(it)), 30);
}

function searchAreaExpansionMode(ctx){
  const raw = ctx.raw || {};
  const mode = low(firstNonEmpty(ctx.expansion, ctx.searchExpansion, raw.expansion, raw.searchExpansion, raw.searchArea, raw.area, raw.scope));
  if(["wide","global","library","full","max","world"].includes(mode)) return mode;
  if(ctx.deep) return "deep";
  if((ctx.candidatePoolTarget || 0) > (ctx.limit || 0)) return "wide";
  return "balanced";
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

function sanmaruInstantLibraryCards(ctx){
  const q = s(ctx && ctx.q).trim();
  if(!q) return [];
  const enc = encodeURIComponent(q);
  const seed = [
    { title:'[Official] ' + q + ' 공식 홈페이지 / 대표 사이트', url:'https://www.google.com/search?q=' + encodeURIComponent(q + ' 공식 홈페이지 official site'), source:'sanmaru_official_surface', type:'official', mediaType:'article', summary:q + ' 공식 홈페이지·대표 사이트 검색', score:0.82 },
    { title:'[Public] ' + q + ' 공공기관 / 정부 / 지자체', url:'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:go.kr OR site:gov OR 공공기관 OR 지자체'), source:'sanmaru_public_surface', type:'official', mediaType:'article', summary:q + ' 정부·공공기관·지자체 공식 정보 검색', score:0.81 },
    { title:'[Address] ' + q + ' 주소 / 지도 / 길찾기', url:'https://www.google.com/maps/search/' + enc, source:'sanmaru_google_maps_surface', type:'map', mediaType:'map', summary:q + ' 주소·지도·길찾기 검색', score:0.80 },
    { title:'[Naver Map] ' + q + ' 지도 / 지역 정보', url:'https://map.naver.com/p/search/' + enc, source:'sanmaru_naver_map_surface', type:'map', mediaType:'map', summary:q + ' 네이버 지도·지역 정보 검색', score:0.79 },
    { title:'[Tour] ' + q + ' 관광 / 명소 / 공식 홍보', url:'https://www.google.com/search?q=' + encodeURIComponent(q + ' 관광 명소 공식 홍보 여행 사진'), source:'sanmaru_tour_surface', type:'tour', mediaType:'article', summary:q + ' 관광·명소·공식 홍보 자료 검색', score:0.78 },
    { title:'[Wiki] ' + q + ' 위키 / 백과 / 지식', url:'https://www.google.com/search?q=' + encodeURIComponent(q + ' wikipedia encyclopedia wiki 지식백과'), source:'sanmaru_knowledge_surface', type:'knowledge', mediaType:'article', summary:q + ' 위키·백과·지식 검색', score:0.77 },
    { title:'[News] ' + q + ' - Naver News', url:'https://search.naver.com/search.naver?where=news&query=' + enc, source:'sanmaru_naver_news_surface', type:'news', mediaType:'article', summary:q + ' 네이버 뉴스 검색', score:0.76 },
    { title:'[Image] ' + q + ' 이미지 / 포토 / 갤러리', url:'https://search.naver.com/search.naver?where=image&query=' + enc, source:'sanmaru_image_surface', type:'image', mediaType:'image', summary:q + ' 이미지·사진·갤러리 검색', score:0.75 },
    { title:'[Video] ' + q + ' - YouTube', url:'https://www.youtube.com/results?search_query=' + enc, source:'sanmaru_youtube_surface', type:'video', mediaType:'video', summary:q + ' 유튜브 영상·공식 채널·브이로그 검색', score:0.74 },
    { title:'[Blog] ' + q + ' - Naver Blog', url:'https://search.naver.com/search.naver?where=blog&query=' + enc, source:'sanmaru_blog_surface', type:'blog', mediaType:'article', summary:q + ' 네이버 블로그·후기 검색', score:0.73 },
    { title:'[Cafe] ' + q + ' - Naver Cafe / 커뮤니티', url:'https://search.naver.com/search.naver?where=article&query=' + enc, source:'sanmaru_cafe_surface', type:'cafe', mediaType:'article', summary:q + ' 네이버 카페·커뮤니티 검색', score:0.72 },
    { title:'[Shopping] ' + q + ' 상품 / 가격 / 구매 정보', url:'https://search.shopping.naver.com/search/all?query=' + enc, source:'sanmaru_shopping_surface', type:'shopping', mediaType:'product', summary:q + ' 쇼핑·가격·상품 검색', score:0.71 },
    { title:'[SNS] ' + q + ' - Instagram', url:'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:instagram.com'), source:'sanmaru_instagram_surface', type:'sns', mediaType:'article', summary:q + ' 인스타그램 공개 게시물 검색', score:0.70 },
    { title:'[SNS] ' + q + ' - Facebook', url:'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:facebook.com'), source:'sanmaru_facebook_surface', type:'sns', mediaType:'article', summary:q + ' 페이스북 공개 페이지 검색', score:0.69 },
    { title:'[SNS] ' + q + ' - TikTok', url:'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:tiktok.com'), source:'sanmaru_tiktok_surface', type:'sns', mediaType:'video', summary:q + ' 틱톡 공개 영상 검색', score:0.68 }
  ];
  return seed.map(x => {
    const item = canonicalItem(Object.assign({}, x, { instantSurface:true }), q, x.source);
    item.instantSurface = true;
    item.lazyMount = { enabled:true, source:x.source, type:x.type, q, action:'provider-or-section-expand' };
    item.mediaSnapshotPolicy = 'real-provider-thumbnail-first-og-image-later-no-logo-ad-slogan';
    return item;
  });
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
      limit: Math.min(ctx.candidatePoolTarget || ctx.limit || DEFAULT_LIMIT, MAX_INDEX_FAST_LIMIT),
      type: ctx.searchType === "all" ? "" : ctx.searchType,
      lang: ctx.lang,
      from: "sanmaru",
      noExternal: "1",
      skipSanmaru: "1"
    };
    let res = null;
    if(typeof mod.runEngine === "function") res = await withTimeout(mod.runEngine(ctx.event || {}, params), ctx.deep ? 1800 : 1300);
    else if(typeof mod.query === "function") res = await withTimeout(mod.query(ctx.q, params), ctx.deep ? 1800 : 1300);
    else if(typeof mod.handler === "function"){
      const h = await withTimeout(mod.handler({ httpMethod:"GET", headers:(ctx.event && ctx.event.headers) || {}, queryStringParameters: params }), ctx.deep ? 1800 : 1300);
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
      limit: Math.min(ctx.candidatePoolTarget || ctx.limit || DEFAULT_LIMIT, MAX_SEARCH_BANK_FAST_LIMIT),
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
    const raw = ctx.raw || {};
    const disabledByRequest = truthy(raw["skip" + name]) || truthy(raw["disable" + name]) || truthy(raw["no" + name]);
    if(disabledByRequest){
      return { trace: adapterResult(name, "disabled-by-request", started, []), items: [] };
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
  { name:"naver-web", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "webkr.json", "naver", "web", ctx.deep ? 100 : 100, 1) },
  { name:"naver-news", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "news.json", "naver_news", "news", ctx.deep ? 100 : 80, 1) },
  { name:"naver-blog", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "blog.json", "naver_blog", "blog", ctx.deep ? 100 : 60, 1) },
  { name:"naver-cafe", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "cafearticle.json", "naver_cafe", "cafe", ctx.deep ? 100 : 60, 1) },
  { name:"naver-local", timeoutMs:3000, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "local.json", "naver_local", "local", 5, 1) },
  { name:"naver-book", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "book.json", "naver_book", "book", ctx.deep ? 100 : 60, 1) },
  { name:"naver-kin", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "kin.json", "naver_kin", "knowledge", ctx.deep ? 100 : 60, 1) },
  { name:"naver-encyc", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "encyc.json", "naver_encyc", "knowledge", ctx.deep ? 100 : 60, 1) },
  { name:"naver-shop", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "shop.json", "naver_shop", "shopping", ctx.deep ? 100 : 60, 1) },
  { name:"naver-doc", timeoutMs:3200, match:ctx => ctx.externalAllowed, access:ctx => naverGeneric(ctx, "doc.json", "naver_doc", "knowledge", ctx.deep ? 100 : 60, 1) },
  { name:"naver-image", timeoutMs:3200, match:ctx => ctx.externalAllowed && !ctx.noMedia, access:ctx => naverImage(ctx) },
  { name:"google-web", timeoutMs:3400, match:ctx => ctx.externalAllowed, access:ctx => googleWeb(ctx) },
  { name:"google-image", timeoutMs:3400, match:ctx => ctx.externalAllowed && !ctx.noMedia, access:ctx => googleImage(ctx) },
  { name:"bing-web", timeoutMs:3400, match:ctx => ctx.externalAllowed, access:ctx => bingWeb(ctx) },
  { name:"youtube", timeoutMs:3800, match:ctx => ctx.externalAllowed && !ctx.noMedia, access:ctx => youtube(ctx) },
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
  if(!ctx.directExternalAllowed){
    return [];
  }
  const selected = [];
  for(const adapter of ADAPTERS){
    try{
      if(adapter.match(ctx)) selected.push(adapter);
    }catch(e){}
  }
  return selected;
}


async function callMaruSearchWideGateway(ctx){
  const started = nowMs();
  try{
    const raw = ctx.raw || {};
    if(truthy(raw.skipMaruSearch) || truthy(raw.noMaruSearch) || truthy(raw.disableMaruSearch)){
      return { trace: adapterResult("maru-search-wide-gateway", "disabled-by-request", started, []), items: [] };
    }
    let mod = null;
    try{ mod = require("./maru-search"); }catch(e){ mod = null; }
    if(!mod) return { trace: adapterResult("maru-search-wide-gateway", "unavailable", started, []), items: [] };

    const payload = {
      q: ctx.q,
      query: ctx.q,
      limit: Math.min(ctx.candidatePoolTarget || ctx.limit || DEFAULT_LIMIT, MAX_LIMIT),
      candidatePool: Math.min(ctx.candidatePoolTarget || ctx.limit || DEFAULT_LIMIT, MAX_LIMIT),
      searchExpansion: searchAreaExpansionMode(ctx),
      expansion: searchAreaExpansionMode(ctx),
      page: ctx.page || 1,
      perPage: ctx.perPage || 15,
      start: ctx.start || 1,
      type: ctx.searchType,
      category: ctx.searchType,
      lang: ctx.lang,
      deep: ctx.deep ? "1" : "0",
      external: ctx.externalAllowed ? "force" : "off",
      noExternal: ctx.externalAllowed ? "0" : "1",
      disableExternal: ctx.externalAllowed ? "0" : "1",
      noMedia: ctx.noMedia ? "1" : "0",
      noAnalytics: "1",
      noRevenue: "1",
      noSanmaru: "1",
      skipSanmaru: "1",
      disableSanmaru: "1",
      legacyOnly: "1",
      __sanmaruLegacy: "1",
      __fromSanmaru: "1"
    };

    let res = null;
    if(typeof mod.runLegacySearch === "function"){
      res = await withTimeout(mod.runLegacySearch(ctx.event || {}, payload), ctx.deep ? 9000 : 6500);
    }else if(typeof mod.runEngine === "function"){
      res = await withTimeout(mod.runEngine(ctx.event || {}, payload), ctx.deep ? 9000 : 6500);
    }else{
      return { trace: adapterResult("maru-search-wide-gateway", "no-compatible-export", started, []), items: [] };
    }

    const items = normalizeItemsFromResponse(res).map(x => canonicalItem(x, ctx.q, "maru-search-wide-gateway"));
    return {
      trace: adapterResult("maru-search-wide-gateway", items.length ? "ok" : "empty", started, items, {
        role: "platform-information-road-preserved",
        externalMode: payload.external,
        sourceMeta: res && res.meta ? {
          totalCandidates: res.meta.totalCandidates,
          externalGatewayUsed: res.meta.externalGatewayUsed,
          traceCount: Array.isArray(res.meta.trace) ? res.meta.trace.length : undefined
        } : undefined
      }),
      items
    };
  }catch(e){
    return { trace: adapterResult("maru-search-wide-gateway", responseErrorCode(e), started, [], { error: responseErrorCode(e) }), items: [] };
  }
}

function rememberResidentMemory(ctx, items, reason){
  try{
    const key = stableHash([ctx && ctx.q, ctx && ctx.searchType, ctx && ctx.lang || '', reason || 'memory'].join('|'));
    globalState.memory.set(key, {
      t: nowMs(),
      q: ctx && ctx.q,
      searchType: ctx && ctx.searchType,
      lang: ctx && ctx.lang || null,
      reason: reason || 'resident-library',
      count: Array.isArray(items) ? items.length : 0,
      items: (Array.isArray(items) ? items : []).slice(0, 500)
    });
    while(globalState.memory.size > 800){
      const first = globalState.memory.keys().next().value;
      globalState.memory.delete(first);
    }
  }catch(e){}
}

function residentLibraryStatus(){
  return {
    enabled: true,
    mode: 'resident-global-information-library',
    memorySize: globalState.memory ? globalState.memory.size : 0,
    cacheSize: globalState.cache ? globalState.cache.size : 0,
    inflightSize: globalState.inflight ? globalState.inflight.size : 0,
    visiblePageBudget: FAST_VISIBLE_PER_PAGE,
    principle: 'load-fast-memory-first-then-minimize-external-api-calls'
  };
}

async function warmResidentLibrary(event, raw){
  const started = nowMs();
  const report = { searchBankIndex:null, searchBank:null };
  try{
    let mod = null;
    try{ mod = require('./search-bank-index-engine'); }catch(e){ mod = null; }
    if(mod && typeof mod.health === 'function') report.searchBankIndex = await withTimeout(Promise.resolve(mod.health()), 2500);
    else if(mod && typeof mod.runEngine === 'function') report.searchBankIndex = await withTimeout(mod.runEngine(event || {}, { action:'health' }), 2500);
  }catch(e){ report.searchBankIndex = { status:responseErrorCode(e) }; }
  try{
    let bank = null;
    try{ bank = require('./search-bank-engine'); }catch(e){ bank = null; }
    if(bank && typeof bank.health === 'function') report.searchBank = await withTimeout(Promise.resolve(bank.health()), 2000);
    else report.searchBank = { status: bank ? 'available' : 'unavailable' };
  }catch(e){ report.searchBank = { status:responseErrorCode(e) }; }
  globalState.library = { t: nowMs(), report };
  return { status:'ok', engine:ENGINE_NAME, version:VERSION, action:'warmup', residentLibrary:residentLibraryStatus(), report, elapsedMs:nowMs() - started };
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
  const lang = firstNonEmpty(ctx.lang, ctx.uiLang, ctx.locale, raw.lang, raw.uiLang, raw.locale, qs.lang, qs.uiLang, qs.locale);
  const expansionRaw = low(firstNonEmpty(ctx.expansion, ctx.searchExpansion, raw.expansion, raw.searchExpansion, qs.expansion, qs.searchExpansion, ""));
  const wideExpansion = ["wide","global","library","full","max","world"].includes(expansionRaw);
  const deep = truthy(ctx.deep || raw.deep || qs.deep) || externalRaw === "deep" || wideExpansion;
  const externalForced = ["1","true","yes","on","force","live","deep"].includes(externalRaw) || truthy(ctx.useExternal || raw.useExternal || qs.useExternal || ctx.useLive || raw.useLive || qs.useLive);

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
    page: clampInt(firstNonEmpty(ctx.page, raw.page, qs.page), 1, 1, 100000),
    perPage: clampInt(firstNonEmpty(ctx.perPage, raw.perPage, qs.perPage), 15, 1, 200),
    start: clampInt(firstNonEmpty(ctx.start, raw.start, qs.start), 1, 1, 1000000),
    candidatePoolTarget: clampInt(firstNonEmpty(ctx.candidatePool, raw.candidatePool, qs.candidatePool, ctx.candidatePoolTarget, raw.candidatePoolTarget, qs.candidatePoolTarget, wideExpansion ? DEFAULT_CANDIDATE_POOL_TARGET : "", ctx.limit, raw.limit, qs.limit), DEFAULT_CANDIDATE_POOL_TARGET, 1, MAX_LIMIT),
    expansion: expansionRaw || (wideExpansion ? "wide" : "balanced"),
    directExternalAllowed: truthy(ctx.directExternal || raw.directExternal || qs.directExternal || ctx.sanmaruDirectExternal || raw.sanmaruDirectExternal || qs.sanmaruDirectExternal || process.env.SANMARU_DIRECT_EXTERNAL),
    fastFirst: !truthy(ctx.fullSearch || raw.fullSearch || qs.fullSearch || ctx.waitForMounts || raw.waitForMounts || qs.waitForMounts || ctx.disableFastFirst || raw.disableFastFirst || qs.disableFastFirst || ctx.noFastFirst || raw.noFastFirst || qs.noFastFirst),
    requestId: firstNonEmpty(ctx.requestId, stableHash([clean.value, nowMs(), Math.random()].join("|")))
  });
}

async function runSanmaru(input, maybeCtx){
  const ctx = parseCtx(input, maybeCtx);
  ctx.fastFirst = !!(ctx.fastFirst && !ctx.deep && !ctx.externalForced && !ctx.directExternalAllowed);
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

  const cacheKey = stableHash([ctx.q, ctx.limit, ctx.candidatePoolTarget || "", ctx.page || 1, ctx.perPage || 15, ctx.searchType, ctx.lang || "", searchAreaExpansionMode(ctx), ctx.deep ? "deep" : "normal", ctx.externalOff ? "off" : (ctx.externalForced ? "force" : "auto"), ctx.noMedia ? "nomedia" : "media"].join("|"));
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

    const fastSettled = await Promise.allSettled([
      callSearchBankIndex(ctx),
      callSearchBank(ctx)
    ]);

    const indexRes = fastSettled[0] && fastSettled[0].status === "fulfilled"
      ? fastSettled[0].value
      : { trace: adapterResult("searchbank-index", "error", engineStarted, []), items: [] };
    const bankRes = fastSettled[1] && fastSettled[1].status === "fulfilled"
      ? fastSettled[1].value
      : { trace: adapterResult("searchbank", "error", engineStarted, []), items: [] };

    trace.push(indexRes.trace);
    trace.push(bankRes.trace);
    items.push(...indexRes.items, ...bankRes.items);

    const instantCards = sanmaruInstantLibraryCards(ctx);
    if(ctx.fastFirst && instantCards.length){
      items.push(...instantCards);
      trace.push(adapterResult('sanmaru-instant-global-surface', 'ok', engineStarted, instantCards, {
        visibleBudget: FAST_VISIBLE_PER_PAGE,
        principle: 'resident-library-supplies-first-page-now-provider-mounts-later',
        includes: ['official','public','address','wiki','news','tour','image','youtube','blog','cafe','sns','shopping']
      }));
    }

    const fastCount = dedupeItems(items).length;
    ctx.needExternal = ctx.externalAllowed;

    const selected = selectAdapters(ctx);

    if(ctx.fastFirst && !ctx.externalForced && fastCount >= Math.min(ctx.perPage || FAST_VISIBLE_PER_PAGE, FAST_FIRST_MIN_RESULTS)){
      trace.push({
        name:"sanmaru-resident-library",
        status:"fast-first-ready",
        count:fastCount,
        mode:"return-fast-memory-before-heavy-mounts",
        principle:"computer-is-already-on-library-map-supplies-visible-page-immediately"
      });

      let ranked = finalRank(ctx.q, items, ctx);
      const finalTarget = Math.min(MAX_LIMIT, Math.max(ctx.limit, ctx.candidatePoolTarget || 0, MIN_FAST_TARGET));
      ranked = ranked.slice(0, finalTarget).map(it => {
        const copy = Object.assign({}, it);
        delete copy._sanmaruSeq;
        delete copy._sanmaruRejectedReason;
        return copy;
      });
      rememberResidentMemory(ctx, ranked, "fast-first-query");
      maybePromote(ctx, ranked, { trace }).catch(() => null);

      const result = {
        status:"ok",
        engine:ENGINE_NAME,
        version:VERSION,
        query:ctx.q,
        source: ranked.length ? "sanmaru-fast-memory" : null,
        items: ranked,
        results: ranked,
        meta:{
          count: ranked.length,
          requestedLimit: ctx.limit,
          totalCandidates: items.length,
          deduped: Math.max(0, items.length - dedupeItems(items).length),
          sourceDiversity: sourceDiversity(ranked),
          categoryDiversity: categoryDiversity(ranked),
          searchAreaExpansion: {
            mode: searchAreaExpansionMode(ctx),
            candidatePoolTarget: ctx.candidatePoolTarget,
            finalTarget,
            page: ctx.page,
            perPage: ctx.perPage,
            hasMore: ranked.length >= finalTarget,
            principle: "fast-memory-first-visible-page-now-heavy-mounts-on-demand"
          },
          elapsedMs: nowMs() - engineStarted,
          region: ctx.region,
          lang: ctx.lang || null,
          searchType: ctx.searchType,
          intents,
          queryRisk: ctx.queryRisk || null,
          secure: true,
          role: "global-virtual-information-library-mount-engine",
          platformRole: "Sanmaru is the resident global information library; Maru Search is the platform information road/gateway",
          residentLibrary: residentLibraryStatus(),
          fastFirst: true,
          firstVisiblePageReady: true,
          visibleCardsPerPage: FAST_VISIBLE_PER_PAGE,
        instantGlobalSurface: instantCards.length,
        firstVisiblePagePolicy: 'supply-visible-list-immediately-heavy-mounts-deferred',
        mediaSnapshotPolicy: 'provider-thumbnails-and-own-page-og-images-first-no-logo-ad-slogan',
          instantGlobalSurface: instantCards.length,
          firstVisiblePagePolicy: 'supply-visible-list-immediately-heavy-mounts-deferred',
          mediaSnapshotPolicy: 'provider-thumbnails-and-own-page-og-images-first-no-logo-ad-slogan',
          mountRegistry: mountRegistrySnapshot(),
          cache:{ hit:false, key:cacheKey },
          searchBankIndex:{ used:true, status:indexRes.trace.status, count:indexRes.trace.count, latency:indexRes.trace.latency },
          searchBank:{ used:true, status:bankRes.trace.status, count:bankRes.trace.count, latency:bankRes.trace.latency },
          external:{
            allowed: ctx.externalAllowed,
            forced: ctx.externalForced,
            deep: ctx.deep,
            selected: selected.map(x => x.name),
            deferred:true,
            reason:"fast-first-memory-satisfied-visible-page",
            directExternalAdaptersEnabled: !!ctx.directExternalAllowed,
            trace: []
          },
          promotion:{ used:true, status:"deferred-fast-first", count:0 },
          health: healthSnapshot(),
          trace
        }
      };

      globalState.cache.set(cacheKey, { t: nowMs(), v: result });
      return result;
    }

    const mountTasks = [];

    if(ctx.externalAllowed && selected.length){
      for(const adapter of selected) mountTasks.push(executeAdapter(adapter, ctx));
    }else{
      trace.push({
        name:"direct-external-adapters",
        status: ctx.externalAllowed
          ? (ctx.directExternalAllowed ? "no-selected-adapters" : "covered-by-maru-search-wide-gateway")
          : "blocked-by-request",
        count:0,
        mode:"single-controlled-platform-gateway-by-default"
      });
    }

    mountTasks.push(callMaruSearchWideGateway(ctx));
    mountTasks.push(callOptionalModuleAdapter(ctx, "collector", "./collector", { useCollector:"1" }, ctx.deep ? 4200 : 3000));
    mountTasks.push(callOptionalModuleAdapter(ctx, "planetary", "./planetary-data-connector", { usePlanetary:true, federation:"on" }, ctx.deep ? 4600 : 3200));

    const settled = await Promise.allSettled(mountTasks);
    for(const r of settled){
      const value = r && r.status === "fulfilled" ? r.value : null;
      if(value){ trace.push(value.trace); items.push(...value.items); }
    }

    trace.push({
      name:"sanmaru-mount-layer",
      status:"candidate-pool-expanded",
      count:dedupeItems(items).length,
      fastMemoryCount:fastCount,
      directExternal:!!ctx.directExternalAllowed,
      principle:"mount-authorized-channels-and-expand-never-replace"
    });

    let ranked = finalRank(ctx.q, items, ctx);
    const finalTarget = Math.min(MAX_LIMIT, Math.max(ctx.limit, ctx.candidatePoolTarget || 0, MIN_FAST_TARGET));
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
        sourceDiversity: sourceDiversity(ranked),
        categoryDiversity: categoryDiversity(ranked),
        searchAreaExpansion: {
          mode: searchAreaExpansionMode(ctx),
          candidatePoolTarget: ctx.candidatePoolTarget,
          finalTarget,
          page: ctx.page,
          perPage: ctx.perPage,
          hasMore: ranked.length >= finalTarget,
          principle: "expand-search-area-with-authorized-mounts-never-reduce-platform-spectrum"
        },
        elapsedMs: nowMs() - engineStarted,
        region: ctx.region,
        lang: ctx.lang || null,
        searchType: ctx.searchType,
        intents,
        queryRisk: ctx.queryRisk || null,
        secure: true,
        role: "global-virtual-information-library-mount-engine",
        platformRole: "Sanmaru is the authorized global information library mount layer; Maru Search is the platform information road/gateway",
        residentLibrary: residentLibraryStatus(),
        fastFirst: !!ctx.fastFirst,
        visibleCardsPerPage: FAST_VISIBLE_PER_PAGE,
        mountRegistry: mountRegistrySnapshot(),
        cache:{ hit:false, key:cacheKey },
        searchBankIndex:{ used:true, status:indexRes.trace.status, count:indexRes.trace.count, latency:indexRes.trace.latency },
        searchBank:{ used:true, status:bankRes.trace.status, count:bankRes.trace.count, latency:bankRes.trace.latency },
        external:{
          allowed: ctx.externalAllowed,
          forced: ctx.externalForced,
          deep: ctx.deep,
          selected: selected.map(x => x.name),
          directExternalAdaptersEnabled: !!ctx.directExternalAllowed,
          trace: trace.filter(x => x && !["searchbank-index","searchbank"].includes(x.name))
        },
        promotion,
        health: healthSnapshot(),
        trace
      }
    };

    rememberResidentMemory(ctx, ranked, "full-query");
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
    residentLibrary: residentLibraryStatus(),
    circuits,
    mountRegistry: mountRegistrySnapshot(),
    adapters: ["searchbank-index","searchbank","maru-search-wide-gateway"].concat(ADAPTERS.map(x => x.name), ["collector","planetary","ai-gpu"]),
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
  if(action === "warmup" || action === "boot" || action === "mount-library") return ok(await warmResidentLibrary(event || {}, merged));

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
    disableMedia: merged.disableMedia,
    candidatePool: firstNonEmpty(merged.candidatePool, merged.candidatePoolTarget),
    expansion: firstNonEmpty(merged.expansion, merged.searchExpansion),
    directExternal: merged.directExternal
  });
  return ok(res);
}

async function runEngine(event, params){
  return await runSanmaru({ event: event || {}, raw: params || {}, q: firstNonEmpty(params && params.q, params && params.query), limit: params && params.limit, type: params && (params.type || params.category || params.tab || params.vertical), lang: params && (params.lang || params.uiLang || params.locale), deep: params && params.deep, external: params && params.external, noExternal: params && params.noExternal, disableExternal: params && params.disableExternal, noMedia: params && params.noMedia, disableMedia: params && params.disableMedia, candidatePool: params && (params.candidatePool || params.candidatePoolTarget), expansion: params && (params.expansion || params.searchExpansion), directExternal: params && params.directExternal });
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
  detectIntent,
  mountRegistry: mountRegistrySnapshot,
  sanmaruInstantLibraryCards
};

exports.version = VERSION;
exports.runSanmaru = runSanmaru;
exports.runEngine = runEngine;
exports.handler = handler;
exports.health = healthSnapshot;
exports.mountRegistry = mountRegistrySnapshot;
exports.sanmaruInstantLibraryCards = sanmaruInstantLibraryCards;
