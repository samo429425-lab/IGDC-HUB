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
const fs = require("fs");
const path = require("path");

const VERSION = "sanmaru-engine-v2.4.1-resident-switch-hub";
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

const globalState = globalThis.__SANMARU_V2_STATE || (globalThis.__SANMARU_V2_STATE = {
  cache: new Map(),
  inflight: new Map(),
  rate: new Map(),
  circuits: Object.create(null),
  memory: new Map(),
  telemetry: [],
  resident: null
});

function ensureResidentState(){
  if(!globalState.resident){
    globalState.resident = {
      ready:false,
      bootedAt:0,
      bootCount:0,
      bootReason:null,
      active:false,
      activatedAt:0,
      activationCount:0,
      lastTouchAt:0,
      sessionId:null,
      warmUntil:0,
      items:[],
      itemMap:new Map(),
      categoryMap:new Map(),
      sourceMap:new Map(),
      queryMap:new Map(),
      routeMap:new Map(),
      providerHealth:new Map(),
      learnedCategoryAliases:Object.create(null),
      lastError:null
    };
  }
  return globalState.resident;
}
ensureResidentState();


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
  "instagram": { type:"public-social-search-route", permission:"public-search-or-platform-api-required", role:"Instagram public discovery route through authorized search channels", enabled:true },
  "facebook": { type:"public-social-search-route", permission:"public-search-or-platform-api-required", role:"Facebook public page/post discovery route through authorized search channels", enabled:true },
  "tiktok": { type:"public-social-search-route", permission:"public-search-or-platform-api-required", role:"TikTok public video discovery route through authorized search channels", enabled:true },
  "x-twitter": { type:"public-social-search-route", permission:"public-search-or-platform-api-required", role:"X/Twitter public discovery route through authorized search channels", enabled:true },
  "threads": { type:"public-social-search-route", permission:"public-search-or-platform-api-required", role:"Threads public discovery route through authorized search channels", enabled:true },
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
  "public-data": {
    type: "public-data-source",
    permission: "public-api-or-authorized-access-required",
    role: "Government, municipality, open data and public institution datasets",
    enabled: true
  },
  "academic": {
    type: "academic-library-and-paper-index",
    permission: "public-api-or-authorized-access-required",
    role: "University libraries, scholarly metadata, journals and academic discovery",
    enabled: true
  },
  "research-paper": {
    type: "research-knowledge-source",
    permission: "public-or-licensed-access-required",
    role: "Papers, preprints, citations, institutional repositories and research metadata",
    enabled: true
  },
  "university-library": {
    type: "library-catalog-source",
    permission: "public-or-licensed-access-required",
    role: "University library catalogs, books, theses and institutional collections",
    enabled: true
  },
  "wiki-knowledge": {
    type: "open-knowledge-source",
    permission: "public-search-or-api-required",
    role: "Wikipedia, encyclopedic and structured public knowledge routes",
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


// -----------------------------------------------------------------------------
// SANMARU GLOBAL RESIDENT HUB
// This layer does not copy the whole world into this function.  It keeps the
// source map, category brain, health map, resident index/cache and learned query
// pools ready so Maru Search can ask Sanmaru first instead of re-opening every
// provider on every keystroke.
// -----------------------------------------------------------------------------
const SANMARU_CANONICAL_CATEGORIES = {
  official:{ label:"공식/권위", weight:98, routes:["official-web","google","naver","bing","searchbank-index","searchbank"] },
  government:{ label:"정부/공공기관", weight:96, routes:["official-web","public-data","google","naver","bing"] },
  public_data:{ label:"공공 데이터", weight:94, routes:["public-data","official-web","google","bing"] },
  map_local:{ label:"지도/주소/지역", weight:92, routes:["naver","google","bing","maru-search-wide-gateway"] },
  tourism:{ label:"관광/지역 홍보", weight:90, routes:["official-web","naver","google","youtube","social-public-web"] },
  news:{ label:"뉴스", weight:88, routes:["naver","google","bing","maru-search-wide-gateway"] },
  knowledge:{ label:"지식/백과", weight:86, routes:["wiki-knowledge","google","naver","bing","searchbank-index"] },
  wiki:{ label:"위키", weight:85, routes:["wiki-knowledge","google","bing"] },
  book:{ label:"도서", weight:82, routes:["naver","google","university-library"] },
  academic:{ label:"학술", weight:80, routes:["academic","research-paper","university-library","google","bing"] },
  research_paper:{ label:"논문/연구", weight:79, routes:["research-paper","academic","university-library","google","bing"] },
  university_library:{ label:"대학 도서관", weight:78, routes:["university-library","academic","research-paper"] },
  image:{ label:"이미지", weight:76, routes:["naver","google","bing","maru-search-wide-gateway"] },
  video:{ label:"영상", weight:75, routes:["youtube","google","naver","social-public-web"] },
  youtube:{ label:"유튜브", weight:74, routes:["youtube","google","maru-search-wide-gateway"] },
  sns:{ label:"SNS", weight:72, routes:["social-public-web","google","bing","youtube"] },
  blog:{ label:"블로그", weight:70, routes:["naver","google","blog-community"] },
  cafe:{ label:"카페", weight:69, routes:["naver","blog-community","google"] },
  community:{ label:"커뮤니티", weight:68, routes:["blog-community","naver","google","bing"] },
  shopping:{ label:"쇼핑", weight:66, routes:["naver","google","bing"] },
  finance:{ label:"금융", weight:64, routes:["google","bing","naver"] },
  sports:{ label:"스포츠", weight:62, routes:["google","bing","naver"] },
  webtoon:{ label:"웹툰", weight:60, routes:["naver","google"] },
  ai_provider:{ label:"AI 정보 공급", weight:58, routes:["ai-gpu"] },
  internal_search_bank:{ label:"내부 기억층", weight:100, routes:["searchbank-index","searchbank"] },
  web:{ label:"웹", weight:40, routes:["google","naver","bing","searchbank-index","searchbank"] }
};

const PROVIDER_CATEGORY_ALIASES = {
  naver:{ web:"web", blog:"blog", cafe:"cafe", news:"news", encyc:"knowledge", kin:"knowledge", book:"book", shop:"shopping", image:"image", local:"map_local", webkr:"web" },
  google:{ web:"web", news:"news", image:"image", video:"video", maps:"map_local", scholar:"academic", books:"book" },
  bing:{ web:"web", news:"news", image:"image", video:"video", academic:"academic" },
  youtube:{ search:"youtube", video:"video", shorts:"video" },
  searchbank:{ memory:"internal_search_bank", snapshot:"internal_search_bank" },
  social:{ instagram:"sns", facebook:"sns", tiktok:"sns", x:"sns", twitter:"sns", threads:"sns", linkedin:"sns" },
  academic:{ paper:"research_paper", research:"research_paper", library:"university_library", journal:"academic", citation:"academic" }
};

const PROVIDER_CAPABILITY_MAP = {
  "searchbank-index": ["internal_search_bank","official","knowledge","web","news","image","video","blog","cafe","community"],
  "searchbank": ["internal_search_bank","official","knowledge","web","news","image","video","blog","cafe","community"],
  "maru-search-wide-gateway": ["web","news","image","video","youtube","map_local","tourism","blog","cafe","community","sns","shopping","book","knowledge"],
  naver: ["web","news","blog","cafe","knowledge","book","shopping","image","map_local","tourism"],
  google: ["web","official","knowledge","wiki","news","image","video","map_local","tourism","academic","research_paper","book","sns"],
  bing: ["web","news","image","video","academic","research_paper","official"],
  youtube: ["youtube","video","sns","tourism"],
  "official-web": ["official","government","public_data","tourism"],
  "social-public-web": ["sns","video","youtube","community"],
  instagram: ["sns","image","tourism"],
  facebook: ["sns","community","news"],
  tiktok: ["sns","video","youtube","tourism"],
  "x-twitter": ["sns","news","community"],
  threads: ["sns","community"],
  "blog-community": ["blog","cafe","community"],
  academic: ["academic","research_paper","university_library"],
  "research-paper": ["research_paper","academic"],
  "university-library": ["university_library","academic","book"],
  "wiki-knowledge": ["wiki","knowledge"]
};

function categoryMapSnapshot(){
  const out = {};
  for(const [id, meta] of Object.entries(SANMARU_CANONICAL_CATEGORIES)){
    out[id] = Object.assign({ id }, meta, { providers: providersForCategory(id) });
  }
  return out;
}

function sourceRegistrySnapshot(){
  const out = mountRegistrySnapshot();
  for(const [name, cats] of Object.entries(PROVIDER_CAPABILITY_MAP)){
    out[name] = Object.assign({}, out[name] || { enabled:true, status:"active-or-ready" }, {
      categories: cats.slice(),
      capabilityCount: cats.length
    });
  }
  return out;
}

function providersForCategory(category){
  const out = [];
  for(const [provider, cats] of Object.entries(PROVIDER_CAPABILITY_MAP)){
    if((cats || []).includes(category)) out.push(provider);
  }
  return out;
}

function classifyQueryCategories(q, explicitType){
  const text = low(q);
  const cats = new Set(["internal_search_bank"]);
  const type = normalizeSearchType(explicitType || "all");
  if(type && type !== "all") cats.add(type === "map" ? "map_local" : type === "tour" ? "tourism" : type);
  if(/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text) || /city|seoul|busan|tokyo|new york|london|paris/.test(text)) cats.add("official"), cats.add("map_local"), cats.add("tourism"), cats.add("news"), cats.add("image");
  if(/시청|구청|군청|도청|정부|공공|공식|기관|청사|주소|위치|official|government|public/.test(text)) cats.add("official"), cats.add("government"), cats.add("public_data"), cats.add("map_local");
  if(/지도|주소|위치|근처|맛집|호텔|교통|지하철|버스|map|near|nearby|local|address/.test(text)) cats.add("map_local"), cats.add("tourism");
  if(/관광|여행|축제|명소|문화|홍보|tour|travel|festival|attraction/.test(text)) cats.add("tourism"), cats.add("image"), cats.add("video"), cats.add("blog");
  if(/뉴스|신문|속보|보도|news|breaking|headline/.test(text)) cats.add("news");
  if(/위키|백과|지식|뜻|의미|wiki|encyclopedia|knowledge|meaning/.test(text)) cats.add("knowledge"), cats.add("wiki");
  if(/논문|연구|학술|저널|인용|대학|도서관|paper|research|scholar|journal|citation|university|library/.test(text)) cats.add("academic"), cats.add("research_paper"), cats.add("university_library");
  if(/책|도서|출판|저자|book|author|isbn/.test(text)) cats.add("book"), cats.add("university_library");
  if(/사진|이미지|포토|갤러리|image|photo|picture|gallery/.test(text)) cats.add("image");
  if(/영상|동영상|유튜브|youtube|video|shorts|reels|vlog/.test(text)) cats.add("video"), cats.add("youtube");
  if(/인스타|페이스북|틱톡|트위터|쓰레드|링크드인|sns|instagram|facebook|tiktok|twitter|x\.com|threads|linkedin/.test(text)) cats.add("sns");
  if(/블로그|후기|리뷰|blog|review/.test(text)) cats.add("blog");
  if(/카페|커뮤니티|게시판|forum|community|cafe/.test(text)) cats.add("cafe"), cats.add("community");
  if(/쇼핑|가격|구매|상품|제품|shopping|price|buy|product/.test(text)) cats.add("shopping");
  if(/주식|금융|환율|crypto|stock|finance|market/.test(text)) cats.add("finance");
  if(/스포츠|축구|야구|농구|sports|football|baseball|basketball/.test(text)) cats.add("sports");
  if(/웹툰|만화|webtoon|comic|manga/.test(text)) cats.add("webtoon");
  cats.add("web");
  return Array.from(cats).filter(Boolean);
}

function buildRoutePlanForQuery(q, opts){
  opts = opts || {};
  const categories = classifyQueryCategories(q, opts.searchType || opts.type);
  const routes = [];
  const seen = new Set();
  for(const cat of categories){
    const meta = SANMARU_CANONICAL_CATEGORIES[cat] || SANMARU_CANONICAL_CATEGORIES.web;
    for(const provider of (meta.routes || providersForCategory(cat))){
      if(!provider || seen.has(provider)) continue;
      seen.add(provider);
      routes.push({ provider, category:cat, weight:meta.weight || 0, enabled: sourceRegistrySnapshot()[provider] ? sourceRegistrySnapshot()[provider].enabled !== false : true });
    }
  }
  routes.sort((a,b) => (b.weight - a.weight) || a.provider.localeCompare(b.provider));
  return { query:s(q), categories, routes, generatedAt:nowIso(), categoryBrainVersion:VERSION };
}

function residentFileCandidates(){
  const names = ["search-bank.snapshot.json", "search-bank.index.json", "search-bank.promoted.json", "search-bank.ingested.json", "sanmaru.resident.json"];
  const roots = [__dirname, path.join(__dirname, "data"), process.cwd(), path.join(process.cwd(), "data"), "/tmp"];
  const out = [];
  for(const root of roots){
    for(const name of names) out.push(path.join(root, name));
  }
  return Array.from(new Set(out));
}

function readJsonSafe(file){
  try{
    if(!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }catch(e){ return null; }
}

function looksLikeResidentItem(x){
  return !!(x && typeof x === "object" && (x.title || x.name || x.label || x.url || x.link || x.href || x.summary || x.description || x.snippet || x.thumbnail || x.image));
}

function extractResidentArrays(obj, out, depth, sourceHint){
  if(!obj || typeof obj !== "object" || depth > 7 || out.length > 250000) return;
  if(Array.isArray(obj)){
    for(const x of obj){
      if(looksLikeResidentItem(x)) out.push(Object.assign({ _residentSourceHint:sourceHint }, x));
      else extractResidentArrays(x, out, depth + 1, sourceHint);
      if(out.length > 250000) break;
    }
    return;
  }
  const direct = ["items","results","data","records","cards","list","rows","contents","sections","searchItems","promoted","ingested"];
  for(const key of direct){
    const v = obj[key];
    if(v) extractResidentArrays(v, out, depth + 1, sourceHint || key);
  }
  if(depth < 4){
    for(const [key, value] of Object.entries(obj)){
      if(!value || key === "meta" || key === "config" || key === "settings") continue;
      if(Array.isArray(value) || (value && typeof value === "object")) extractResidentArrays(value, out, depth + 1, sourceHint || key);
    }
  }
}

function addToMultiMap(map, key, item){
  key = s(key || "unknown").trim() || "unknown";
  if(!map.has(key)) map.set(key, []);
  map.get(key).push(item);
}

function rebuildResidentProviderHealth(reason){
  const resident = ensureResidentState();
  const registry = sourceRegistrySnapshot();
  const now = nowMs();
  if(!resident.providerHealth || !(resident.providerHealth instanceof Map)) resident.providerHealth = new Map();
  for(const [name, meta] of Object.entries(registry)){
    const prev = resident.providerHealth.get(name) || {};
    resident.providerHealth.set(name, Object.assign({}, prev, {
      provider:name,
      alive: meta.enabled !== false,
      enabled: meta.enabled !== false,
      status: meta.enabled === false ? "reserved-or-key-missing" : (prev.status || "active-or-ready"),
      reason: reason || prev.reason || "resident-map",
      capabilityCount: Array.isArray(meta.categories) ? meta.categories.length : (meta.capabilityCount || 0),
      categories: Array.isArray(meta.categories) ? meta.categories.slice() : [],
      lastSeenAt: now
    }));
  }
  return resident.providerHealth;
}

function residentCacheKey(q, opts){
  opts = opts || {};
  return stableHash([normalizeText(q), normalizeSearchType(opts.searchType || opts.type || "all"), opts.lang || "", opts.page || opts.start || ""].join("|"));
}

function rememberResidentQueryCache(q, opts, items){
  const resident = ensureResidentState();
  const list = Array.isArray(items) ? items : [];
  if(!q || !list.length) return null;
  const key = residentCacheKey(q, opts || {});
  const entry = {
    t:nowMs(),
    q,
    searchType: normalizeSearchType((opts && (opts.searchType || opts.type)) || "all"),
    lang: (opts && opts.lang) || "",
    page: (opts && (opts.page || opts.start)) || "",
    items:list
  };
  resident.queryMap.set(key, entry);
  if(opts && (opts.page || opts.start)){
    const noPageKey = residentCacheKey(q, Object.assign({}, opts, { page:'', start:'' }));
    resident.queryMap.set(noPageKey, Object.assign({}, entry, { page:'' }));
  }
  if(resident.queryMap.size > 500){
    const first = resident.queryMap.keys().next().value;
    resident.queryMap.delete(first);
  }
  return key;
}

function touchResidentSwitch(opts){
  opts = opts || {};
  const resident = ensureResidentState();
  if(!resident.ready) ensureResidentBoot({ reason:opts.reason || "resident-switch" });
  const now = nowMs();
  resident.active = true;
  resident.activatedAt = resident.activatedAt || now;
  resident.activationCount = (resident.activationCount || 0) + 1;
  resident.lastTouchAt = now;
  resident.warmUntil = Math.max(resident.warmUntil || 0, now + clampInt(opts.warmMs || process.env.SANMARU_RESIDENT_WARM_MS, 10 * 60 * 1000, 60 * 1000, 60 * 60 * 1000));
  resident.sessionId = resident.sessionId || stableHash([process.pid || "pid", resident.bootedAt || now, Math.random()].join("|"));
  resident.lastSwitchReason = opts.reason || resident.lastSwitchReason || "resident-switch";
  rebuildResidentProviderHealth(opts.reason || "resident-switch");
  return residentBootSnapshot();
}

function providerHealthSnapshot(){
  const resident = ensureResidentState();
  if(!resident.providerHealth || !resident.providerHealth.size) rebuildResidentProviderHealth("snapshot");
  return Array.from(resident.providerHealth.entries()).map(([name, meta]) => Object.assign({ name }, meta)).sort((a,b)=>a.name.localeCompare(b.name));
}

function absorbResidentItems(items, meta){
  const resident = ensureResidentState();
  const input = Array.isArray(items) ? items : [];
  let added = 0;
  for(const raw of input){
    if(!raw || typeof raw !== "object") continue;
    const item = canonicalItem(raw, meta && meta.q, firstNonEmpty(raw.source, raw.provider, raw._residentSourceHint, meta && meta.source, "resident"));
    if(isPlaceholderItem(item)) continue;
    const key = firstNonEmpty(item.url, item.link, item.id, item.title + "|" + item.source).toLowerCase();
    if(!key || resident.itemMap.has(key)) continue;
    resident.itemMap.set(key, item);
    resident.items.push(item);
    addToMultiMap(resident.categoryMap, firstNonEmpty(item.searchCategory, item.type, categoryOfItem(item), "web"), item);
    addToMultiMap(resident.sourceMap, firstNonEmpty(item.source, item.provider, "unknown"), item);
    added++;
  }
  if(meta && meta.q && input.length){
    const canonicalForCache = dedupeItems(input.map(raw => canonicalItem(raw, meta.q, firstNonEmpty(raw && raw.source, raw && raw.provider, raw && raw._residentSourceHint, meta && meta.source, "resident"))));
    const ranked = dedupeItems(
      finalRank(meta.q, canonicalForCache, { q:meta.q, searchType:meta.searchType || "all", intents:classifyQueryCategories(meta.q, meta.searchType) })
        .concat(canonicalForCache)
    ).slice(0, Math.min(MAX_LIMIT, Math.max(1000, canonicalForCache.length)));
    rememberResidentQueryCache(meta.q, meta, ranked);
  }
  return { added, total:resident.items.length };
}

function ensureResidentBoot(opts){
  opts = opts || {};
  const resident = ensureResidentState();
  if(resident.ready && !opts.force) return residentBootSnapshot();
  const started = nowMs();
  try{
    if(opts.force){
      resident.items = [];
      resident.itemMap = new Map();
      resident.categoryMap = new Map();
      resident.sourceMap = new Map();
      resident.queryMap = new Map();
      resident.routeMap = new Map();
      resident.providerHealth = new Map();
    }
    const all = [];
    const files = [];
    for(const file of residentFileCandidates()){
      const data = readJsonSafe(file);
      if(!data) continue;
      const arr = [];
      extractResidentArrays(data, arr, 0, path.basename(file));
      if(arr.length){
        files.push({ file:path.basename(file), count:arr.length });
        all.push(...arr);
      }
    }
    const absorbed = absorbResidentItems(all, { source:"resident-boot" });
    resident.ready = true;
    resident.bootedAt = nowMs();
    resident.bootCount = (resident.bootCount || 0) + 1;
    resident.bootReason = opts.reason || (opts.force ? "force" : "auto");
    resident.lastBootFiles = files;
    resident.lastBootLatency = nowMs() - started;
    resident.lastError = null;
    rebuildResidentProviderHealth(opts.reason || "resident-boot");
    return Object.assign(residentBootSnapshot(), { bootFiles:files, absorbed });
  }catch(e){
    resident.lastError = responseErrorCode(e);
    resident.ready = true;
    resident.bootedAt = nowMs();
    return residentBootSnapshot();
  }
}

function residentBootSnapshot(){
  const resident = ensureResidentState();
  return {
    ready:!!resident.ready,
    bootedAt:resident.bootedAt ? new Date(resident.bootedAt).toISOString() : null,
    bootCount:resident.bootCount || 0,
    bootReason:resident.bootReason || null,
    active:!!resident.active,
    activatedAt:resident.activatedAt ? new Date(resident.activatedAt).toISOString() : null,
    activationCount:resident.activationCount || 0,
    lastTouchAt:resident.lastTouchAt ? new Date(resident.lastTouchAt).toISOString() : null,
    warmUntil:resident.warmUntil ? new Date(resident.warmUntil).toISOString() : null,
    sessionId:resident.sessionId || null,
    itemCount:resident.items ? resident.items.length : 0,
    queryCacheSize:resident.queryMap ? resident.queryMap.size : 0,
    routeCacheSize:resident.routeMap ? resident.routeMap.size : 0,
    providerHealthCount:resident.providerHealth ? resident.providerHealth.size : 0,
    categoryCounts:Array.from((resident.categoryMap || new Map()).entries()).map(([name, arr]) => ({ name, count:arr.length })).sort((a,b)=>b.count-a.count).slice(0,60),
    sourceCounts:Array.from((resident.sourceMap || new Map()).entries()).map(([name, arr]) => ({ name, count:arr.length })).sort((a,b)=>b.count-a.count).slice(0,60),
    lastBootLatency:resident.lastBootLatency || 0,
    lastBootFiles:resident.lastBootFiles || [],
    lastError:resident.lastError || null
  };
}

function residentCandidatesSync(q, opts){
  opts = opts || {};
  const resident = ensureResidentState();
  if(!resident.ready) ensureResidentBoot({ reason:"resident-query" });
  const limit = Math.min(MAX_LIMIT, Math.max(clampInt(opts.limit || opts.candidatePoolTarget, DEFAULT_CANDIDATE_POOL_TARGET, 1, MAX_LIMIT), MIN_FAST_TARGET));
  const searchType = normalizeSearchType(opts.searchType || opts.type || "all");
  const qKey = residentCacheKey(q, Object.assign({}, opts, { searchType }));
  let cached = resident.queryMap && resident.queryMap.get(qKey);
  if((!cached || !Array.isArray(cached.items) || !cached.items.length) && (opts.page || opts.start)){
    const fallbackKey = residentCacheKey(q, Object.assign({}, opts, { searchType, page:'', start:'' }));
    cached = resident.queryMap && resident.queryMap.get(fallbackKey);
  }
  if(cached && Array.isArray(cached.items) && cached.items.length){
    return cached.items.slice(0, limit);
  }
  const route = buildRoutePlanForQuery(q, { searchType });
  const pool = [];
  for(const cat of route.categories){
    const arr = resident.categoryMap && resident.categoryMap.get(cat);
    if(arr && arr.length) pool.push(...arr.slice(0, Math.max(200, Math.ceil(limit / 4))));
  }
  if(pool.length < limit && resident.items && resident.items.length){
    const tokens = tokenize(q);
    const compactQ = normalizeText(q).replace(/\s+/g, "");
    for(const it of resident.items){
      if(pool.length >= limit * 3) break;
      const text = normalizeText(itemText(it));
      const compact = text.replace(/\s+/g, "");
      if(tokens.some(t => text.includes(t)) || (compactQ && compact.includes(compactQ))) pool.push(it);
    }
  }
  const ranked = finalRank(q, pool, { q, searchType, intents:route.categories }).slice(0, limit);
  rememberResidentQueryCache(q, Object.assign({}, opts, { searchType }), ranked);
  return ranked;
}

function residentRoutePlanFor(q, opts){
  const resident = ensureResidentState();
  const plan = buildRoutePlanForQuery(q, opts || {});
  if(resident.routeMap){
    const key = residentCacheKey(q, opts || {});
    resident.routeMap.set(key, { t:nowMs(), q, plan });
    if(resident.routeMap.size > 500){
      const first = resident.routeMap.keys().next().value;
      resident.routeMap.delete(first);
    }
  }
  return plan;
}


function routeProviderSearchUrl(provider, q){
  const enc = encodeURIComponent(q || "");
  const p = s(provider).toLowerCase();
  if(p.includes("naver")) return "https://search.naver.com/search.naver?query=" + enc;
  if(p.includes("youtube")) return "https://www.youtube.com/results?search_query=" + enc;
  if(p.includes("instagram")) return "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:instagram.com");
  if(p.includes("facebook")) return "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:facebook.com");
  if(p.includes("tiktok")) return "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:tiktok.com");
  if(p.includes("twitter") || p.includes("x-")) return "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:x.com OR site:twitter.com");
  if(p.includes("threads")) return "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:threads.net");
  if(p.includes("official") || p.includes("government")) return "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " official government");
  if(p.includes("wiki")) return "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " wikipedia encyclopedia");
  if(p.includes("academic") || p.includes("research")) return "https://scholar.google.com/scholar?q=" + enc;
  return "https://www.google.com/search?q=" + enc;
}

function buildRouteFallbackCards(q, routePlan, opts){
  opts = opts || {};
  const plan = routePlan || buildRoutePlanForQuery(q, opts);
  const routes = Array.isArray(plan && plan.routes) ? plan.routes : [];
  const out = [];
  const seen = new Set();
  for(const r of routes){
    if(out.length >= clampInt(opts.routeCardLimit, 20, 1, 60)) break;
    const provider = s(r && r.provider || "web");
    const category = s(r && r.category || "web");
    const key = (provider + "|" + category).toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    const item = canonicalItem({
      id:"sanmaru-route-" + stableHash([q, provider, category].join("|")),
      title:"[Sanmaru Route] " + q + " · " + provider + " / " + category,
      summary:"산마루 resident hub가 이미 알고 있는 정보원 경로입니다. 실제 원본 데이터는 마루서치 provider refresh 또는 외부 드라이브/API에서 보강됩니다.",
      url:routeProviderSearchUrl(provider, q),
      link:routeProviderSearchUrl(provider, q),
      source:"sanmaru_route_" + provider,
      provider,
      type: category === "youtube" ? "web" : category,
      mediaType:"article",
      searchCategory:category,
      score:0.41,
      sanmaruRouteCard:true,
      routePlanProvider:provider,
      routePlanCategory:category
    }, q, "sanmaru-route");
    out.push(item);
  }
  return out;
}

function supplyResidentSync(input, opts){
  opts = opts || {};
  const q = typeof input === "string" ? input : firstNonEmpty(input && input.q, input && input.query, opts.q, opts.query);
  const clean = sanitizeQuery(q);
  const activation = touchResidentSwitch({ reason:opts.reason || opts.from || "resident-supply", q:clean.value || q, warmMs:opts.warmMs });
  if(!clean.ok) return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:clean.value, items:[], results:[], meta:{ count:0, reason:clean.code, resident:residentBootSnapshot(), residentSwitch:activation } };

  const routePlan = residentRoutePlanFor(clean.value, opts);
  const residentItems = residentCandidatesSync(clean.value, opts).map(x => canonicalItem(x, clean.value, x && x.source));
  const minVisible = clampInt(firstNonEmpty(opts.visibleNeed, opts.perPage, opts.visibleCardsPerPage), 15, 1, 100);
  const residentState = ensureResidentState();
  let routeFallbackCards = [];
  let items = residentItems;
  if(items.length < minVisible && residentState.items && residentState.items.length > 0 && opts.allowRouteCards !== false && opts.noRouteCards !== true){
    routeFallbackCards = buildRouteFallbackCards(clean.value, routePlan, opts);
    items = dedupeItems(items.concat(routeFallbackCards)).slice(0, Math.max(minVisible, items.length));
  }
  const cacheKey = rememberResidentQueryCache(clean.value, opts, items) || residentCacheKey(clean.value, opts);

  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    query:clean.value,
    source:items.length ? "sanmaru-resident" : null,
    items,
    results:items,
    routePlan,
    meta:{
      count:items.length,
      realResidentCount:residentItems.length,
      routeFallbackCount:routeFallbackCards.length,
      cacheKey,
      resident:residentBootSnapshot(),
      residentSwitch:activation,
      routePlan,
      providerHealth:providerHealthSnapshot(),
      sourceRegistryReady:true,
      categoryBrainReady:true,
      providerCapabilityReady:true,
      mode:"resident-switch-supply-sync",
      doesNotCallExternal:true,
      note:"Sanmaru is acting as resident routing/index/category/cache hub. Supply does not open external providers; Maru Search may refresh only missing parts."
    }
  };
}


function supplyCategorySync(input, opts){
  opts = opts || {};
  const q = typeof input === "string" ? input : firstNonEmpty(input && input.q, input && input.query, opts.q, opts.query);
  const category = firstNonEmpty(opts.category, opts.type, input && input.category, input && input.type);
  const searchType = category ? normalizeSearchType(category) : normalizeSearchType(opts.searchType || opts.type || "all");
  return supplyResidentSync({ q }, Object.assign({}, opts, { searchType, type:searchType, reason:opts.reason || "supply-category" }));
}

function triggerDeepRefresh(input, opts){
  opts = opts || {};
  const q = typeof input === "string" ? input : firstNonEmpty(input && input.q, input && input.query, opts.q, opts.query);
  const clean = sanitizeQuery(q);
  if(!clean.ok) return { accepted:false, reason:clean.code, query:clean.value, resident:residentBootSnapshot() };
  const key = residentCacheKey(clean.value, opts);
  const inflightKey = "deep-refresh:" + key;
  const existing = globalState.inflight && globalState.inflight.get(inflightKey);
  if(existing && existing.expires > nowMs()) return { accepted:true, deduped:true, query:clean.value, cacheKey:key, resident:residentBootSnapshot() };

  touchResidentSwitch({ reason:opts.reason || "deep-refresh-signal", q:clean.value });
  const task = Promise.resolve().then(() => runSanmaru(clean.value, Object.assign({}, opts, {
    q:clean.value,
    query:clean.value,
    source:"sanmaru-deep-refresh",
    from:opts.from || "resident-switch",
    noMaruSearch:"1",
    skipMaruSearch:"1",
    noCollector: opts.allowCollector ? undefined : "1",
    skipCollector: opts.allowCollector ? undefined : "1",
    noPlanetary:"1",
    skipPlanetary:"1"
  }))).then(res => {
    const items = Array.isArray(res && res.items) ? res.items : (Array.isArray(res && res.results) ? res.results : []);
    absorbResidentItems(items, { q:clean.value, searchType:opts.searchType || opts.type || "all", lang:opts.lang || "", source:"deep-refresh" });
    return items.length;
  }).catch(e => {
    const resident = ensureResidentState();
    resident.lastError = responseErrorCode(e);
    return 0;
  }).finally(() => {
    try { globalState.inflight.delete(inflightKey); } catch(e) {}
  });

  if(globalState.inflight) globalState.inflight.set(inflightKey, { promise:task, t:nowMs(), expires:nowMs() + INFLIGHT_TTL_MS });
  return { accepted:true, deduped:false, query:clean.value, cacheKey:key, routePlan:residentRoutePlanFor(clean.value, opts), resident:residentBootSnapshot() };
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

  const cacheKey = stableHash([ctx.q, ctx.limit, ctx.candidatePoolTarget || "", ctx.page || 1, ctx.perPage || 15, ctx.searchType, ctx.lang || "", searchAreaExpansionMode(ctx), ctx.deep ? "deep" : "normal", ctx.externalOff ? "off" : (ctx.externalForced ? "force" : "auto"), ctx.noMedia ? "nomedia" : "media"].join("|"));
  const cached = globalState.cache.get(cacheKey);
  if(cached && nowMs() - cached.t < CACHE_TTL_MS){
    return Object.assign({}, safeJsonClone(cached.v), { meta: Object.assign({}, cached.v.meta || {}, { cache:{ hit:true, key:cacheKey } }) });
  }

  const inflight = globalState.inflight.get(cacheKey);
  if(inflight && nowMs() - inflight.t < INFLIGHT_TTL_MS) return await inflight.p;

  const work = (async () => {
    ensureResidentBoot({ reason:"runSanmaru" });
    const trace = [];
    const items = [];
    const routePlan = buildRoutePlanForQuery(ctx.q, { searchType:ctx.searchType, lang:ctx.lang });
    const residentFirst = residentCandidatesSync(ctx.q, { limit:ctx.candidatePoolTarget || ctx.limit, candidatePoolTarget:ctx.candidatePoolTarget, searchType:ctx.searchType, lang:ctx.lang });
    if(residentFirst.length){
      items.push(...residentFirst);
      trace.push(adapterResult("sanmaru-resident-library", "ok", engineStarted, residentFirst, { mode:"resident-first-no-external", routeCategories:routePlan.categories }));
    }else{
      trace.push(adapterResult("sanmaru-resident-library", "empty", engineStarted, [], { mode:"resident-first-no-external", routeCategories:routePlan.categories }));
    }
    const intents = Array.from(new Set([].concat(detectIntent(ctx.q, ctx.searchType), routePlan.categories)));
    ctx.intents = intents;
    ctx.routePlan = routePlan;

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

    const fastCount = dedupeItems(items).length;
    ctx.needExternal = ctx.externalAllowed;

    const selected = selectAdapters(ctx);
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

    const residentAbsorb = absorbResidentItems(ranked, { q:ctx.q, searchType:ctx.searchType, lang:ctx.lang, source:"sanmaru-ranked" });
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
        resident: residentBootSnapshot(),
        routePlan: ctx.routePlan || buildRoutePlanForQuery(ctx.q, { searchType:ctx.searchType, lang:ctx.lang }),
        residentAbsorb,
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

    globalState.cache.set(cacheKey, { t: nowMs(), v: result });
    return result;
  })();

  globalState.inflight.set(cacheKey, { t: nowMs(), p: work });
  try{ return await withTimeout(work, ctx.timeoutMs); }
  catch(e){
    const fallbackItems = residentCandidatesSync(ctx.q, { limit:ctx.candidatePoolTarget || ctx.limit, candidatePoolTarget:ctx.candidatePoolTarget, searchType:ctx.searchType, lang:ctx.lang });
    if(fallbackItems.length){
      const rankedFallback = finalRank(ctx.q, fallbackItems, ctx).slice(0, Math.min(MAX_LIMIT, Math.max(ctx.limit, ctx.candidatePoolTarget || 0, MIN_FAST_TARGET)));
      return {
        status:"ok",
        engine:ENGINE_NAME,
        version:VERSION,
        query:ctx.q,
        source:"sanmaru-resident-timeout-fallback",
        items:rankedFallback,
        results:rankedFallback,
        meta:{
          count:rankedFallback.length,
          elapsedMs: nowMs() - engineStarted,
          secure:true,
          timeoutGuard:true,
          originalError: responseErrorCode(e),
          resident: residentBootSnapshot(),
          routePlan: buildRoutePlanForQuery(ctx.q, { searchType:ctx.searchType, lang:ctx.lang }),
          health: healthSnapshot()
        }
      };
    }
    return {
      status:"ok",
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
        timeoutGuard:true,
        resident: residentBootSnapshot(),
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
    mountRegistry: mountRegistrySnapshot(),
    adapters: ["searchbank-index","searchbank","maru-search-wide-gateway"].concat(ADAPTERS.map(x => x.name), ["collector","planetary","ai-gpu"]),
    resident: residentBootSnapshot(),
    categoryBrainReady: true,
    sourceRegistryCount: Object.keys(sourceRegistrySnapshot()).length,
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

  if(action === "health") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, health:healthSnapshot(), resident:residentBootSnapshot() });
  if(action === "resident-boot" || action === "boot" || action === "mount-library") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"resident-boot", resident:touchResidentSwitch({ reason:firstNonEmpty(merged.reason, "manual-boot-switch"), q:firstNonEmpty(merged.q, merged.query) }) });
  if(action === "resident-activate" || action === "resident-switch" || action === "warm-ping" || action === "warm") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"resident-switch", resident:touchResidentSwitch({ reason:firstNonEmpty(merged.reason, action), q:firstNonEmpty(merged.q, merged.query) }) });
  if(action === "resident-rebuild" || action === "rebuild-resident") { const rebuilt = ensureResidentBoot({ force:true, reason:"manual-rebuild" }); return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"resident-rebuild", resident:touchResidentSwitch({ reason:"manual-rebuild-switch" }), rebuilt }); }
  if(action === "resident-status") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"resident-status", resident:touchResidentSwitch({ reason:"resident-status" }), health:healthSnapshot(), providerHealth:providerHealthSnapshot() });
  if(action === "provider-health") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"provider-health", providerHealth:providerHealthSnapshot(), resident:residentBootSnapshot() });
  if(action === "source-registry") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"source-registry", sources:sourceRegistrySnapshot(), resident:residentBootSnapshot() });
  if(action === "category-map" || action === "category-brain") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"category-map", categories:categoryMapSnapshot(), aliases:PROVIDER_CATEGORY_ALIASES, capabilities:PROVIDER_CAPABILITY_MAP, resident:residentBootSnapshot() });
  if(action === "route-plan") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"route-plan", routePlan:residentRoutePlanFor(firstNonEmpty(merged.q, merged.query), { searchType:firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical), lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale) }), resident:touchResidentSwitch({ reason:"route-plan", q:firstNonEmpty(merged.q, merged.query) }) });
  if(action === "supply" || action === "resident-supply") return ok(supplyResidentSync({ q:firstNonEmpty(merged.q, merged.query) }, { reason:"api-supply", limit:firstNonEmpty(merged.limit, merged.candidatePool, merged.candidatePoolTarget), candidatePoolTarget:firstNonEmpty(merged.candidatePool, merged.candidatePoolTarget), searchType:firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical), lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale), page:firstNonEmpty(merged.page, merged.p, merged.start) }));
  if(action === "supply-category" || action === "resident-supply-category") return ok(supplyCategorySync({ q:firstNonEmpty(merged.q, merged.query), category:firstNonEmpty(merged.category, merged.type) }, { reason:"api-supply-category", category:firstNonEmpty(merged.category, merged.type), limit:firstNonEmpty(merged.limit, merged.candidatePool, merged.candidatePoolTarget), candidatePoolTarget:firstNonEmpty(merged.candidatePool, merged.candidatePoolTarget), searchType:firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical), lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale), page:firstNonEmpty(merged.page, merged.p, merged.start) }));
  if(action === "deep-refresh" || action === "resident-refresh") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"deep-refresh", refresh:triggerDeepRefresh({ q:firstNonEmpty(merged.q, merged.query) }, { reason:"api-deep-refresh", searchType:firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical), lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale), limit:firstNonEmpty(merged.limit, merged.candidatePool, merged.candidatePoolTarget) }) });

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
  sourceRegistry: sourceRegistrySnapshot,
  categoryMap: categoryMapSnapshot,
  buildRoutePlanForQuery,
  ensureResidentBoot,
  residentBootSnapshot,
  providerHealthSnapshot,
  touchResidentSwitch,
  supplyResidentSync,
  supplyCategorySync,
  triggerDeepRefresh,
  absorbResidentItems
};

exports.version = VERSION;
exports.runSanmaru = runSanmaru;
exports.runEngine = runEngine;
exports.handler = handler;
exports.health = healthSnapshot;
exports.mountRegistry = mountRegistrySnapshot;
exports.sourceRegistry = sourceRegistrySnapshot;
exports.categoryMap = categoryMapSnapshot;
exports.buildRoutePlanForQuery = buildRoutePlanForQuery;
exports.ensureResidentBoot = ensureResidentBoot;
exports.residentBootSnapshot = residentBootSnapshot;
exports.providerHealthSnapshot = providerHealthSnapshot;
exports.touchResidentSwitch = touchResidentSwitch;
exports.supplyResidentSync = supplyResidentSync;
exports.supplyCategorySync = supplyCategorySync;
exports.triggerDeepRefresh = triggerDeepRefresh;
exports.absorbResidentItems = absorbResidentItems;
try { ensureResidentBoot({ reason:"module-load" }); } catch(e) {}
