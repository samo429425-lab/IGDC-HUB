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

let LogosEngineClass = null;
try { LogosEngineClass = require("./maru-logos-engine").LogosEngine; } catch(e) { LogosEngineClass = null; }

const VERSION = "sanmaru-engine-v2.8.4-osai-unified-supply-contract-stable";
const ENGINE_NAME = "sanmaru";

const DEFAULT_LIMIT = 3000;
const DEFAULT_VISIBLE_PER_PAGE = 25;
const MAX_LIMIT = 20000;
const SANMARU_INSTANT_SUPPLY_TARGET = 15000;
const SANMARU_EXTENDED_SUPPLY_TARGET = 20000;
const SEARCH_BANK_FRONT_REAL_FLOOR = 5000;
const SANMARU_MAX_PAGER_PAGES = 499;
const DEFAULT_TIMEOUT_MS = 10500;
const DEEP_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const INFLIGHT_TTL_MS = 30 * 1000;
const RATE_WINDOW_MS = 10 * 1000;
const RATE_MAX = 60;
const MAX_QUERY_LENGTH = 240;
const MIN_FAST_TARGET = 120;
const DEFAULT_EXTERNAL_TRIGGER_MIN = 0;
const DEFAULT_CANDIDATE_POOL_TARGET = SANMARU_INSTANT_SUPPLY_TARGET;
const MAX_INDEX_FAST_LIMIT = 12000;
const MAX_SEARCH_BANK_FAST_LIMIT = 10000;
const globalState = globalThis.__SANMARU_V2_STATE || (globalThis.__SANMARU_V2_STATE = {
  cache: new Map(),
  inflight: new Map(),
  rate: new Map(),
  circuits: Object.create(null),
  memory: new Map(),
  telemetry: [],
  resident: null,
  openingSignals: new Map(),
  securityEvents: [],
  logosEngine: null,
  osaiPolicyCache: null
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
      lastError:null,
      engineIdentity:null,
      lastLifecycleMode:null,
      lastHotRefreshAt:0,
      lastHotRefreshReason:null
    };
  }
  return globalState.resident;
}
ensureResidentState();


let __SANMARU_ENV_JSON_CACHE = undefined;
function sanmaruEnvJsonLookup(key){
  try{
    if(__SANMARU_ENV_JSON_CACHE === undefined){
      __SANMARU_ENV_JSON_CACHE = null;
      const raw = process && process.env ? (process.env.MARU_API_KEYS_JSON || process.env.API_KEYS_JSON || process.env.IGDC_API_KEYS_JSON || '') : '';
      if(raw){
        const trimmed = String(raw).trim();
        const text = (/^eyJ|^ewog|^[A-Za-z0-9+/=]{80,}$/.test(trimmed)) ? Buffer.from(trimmed, 'base64').toString('utf8') : trimmed;
        const parsed = JSON.parse(text);
        if(parsed && typeof parsed === 'object') __SANMARU_ENV_JSON_CACHE = parsed;
      }
    }
    return __SANMARU_ENV_JSON_CACHE && key ? __SANMARU_ENV_JSON_CACHE[key] : '';
  }catch(e){ return ''; }
}
function sanmaruEnvFirst(){
  for(let i=0; i<arguments.length; i++){
    const key = arguments[i];
    const direct = key && process && process.env ? process.env[key] : '';
    if(String(direct == null ? '' : direct).trim()) return direct;
    const jsonVal = sanmaruEnvJsonLookup(key);
    if(String(jsonVal == null ? '' : jsonVal).trim()) return jsonVal;
  }
  return '';
}
function sanmaruEnvHas(){ return !!sanmaruEnvFirst.apply(null, arguments); }


function sanmaruEngineCodeHash(){
  try{
    const file = typeof __filename === "string" ? __filename : "";
    if(file && fs.existsSync(file)){
      return crypto.createHash("sha1").update(fs.readFileSync(file, "utf8")).digest("hex").slice(0, 20);
    }
  }catch(e){}
  return crypto.createHash("sha1").update(String(VERSION)).digest("hex").slice(0, 20);
}

function sanmaruEngineIdentity(){
  return {
    engine: ENGINE_NAME,
    version: VERSION,
    file: "sanmaru_engine_v2.js",
    codeHash: sanmaruEngineCodeHash(),
    lifecycle: "engine-file-upload-reboots-sanmaru; content-data-file-updates-hot-refresh-only"
  };
}

function isExplicitSanmaruEngineUpload(opts){
  opts = opts || {};
  return !!(
    opts.engineUpload || opts.sanmaruEngineUpload || opts.sanmaruEngineReupload ||
    opts.engineUpgrade || opts.versionUpload || opts.codeUpload ||
    truthy(process.env.SANMARU_ENGINE_UPLOAD_REBOOT)
  );
}

function residentEngineCodeChanged(resident, identity){
  resident = resident || {};
  identity = identity || sanmaruEngineIdentity();
  const prev = resident.engineIdentity || {};
  return !!(resident.ready && prev.codeHash && identity.codeHash && prev.codeHash !== identity.codeHash);
}

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
    enabled: !!(sanmaruEnvHas('NAVER_API_KEY','NAVER_CLIENT_ID') && sanmaruEnvHas('NAVER_CLIENT_SECRET','NAVER_API_SECRET'))
  },
  "google": {
    type: "external-search",
    permission: "api-key-required",
    role: "Reserved/active Google CSE mount; normally routed through Maru Search wide gateway to avoid duplicate API bursts",
    enabled: !!(sanmaruEnvHas('GOOGLE_API_KEY','GOOGLE_SEARCH_API_KEY') && sanmaruEnvHas('GOOGLE_CSE_ID','GOOGLE_CX','GOOGLE_SEARCH_ENGINE_ID'))
  },
  "bing": {
    type: "external-search",
    permission: "api-key-required",
    role: "Reserved/active Bing mount; normally routed through Maru Search wide gateway to avoid duplicate API bursts",
    enabled: !!sanmaruEnvHas('BING_API_KEY','BING_SEARCH_API_KEY','AZURE_BING_SEARCH_API_KEY')
  },
  "duckduckgo": { type:"public-search-route", permission:"public-search", role:"DuckDuckGo public search route mount", enabled:true },
  "yahoo": { type:"public-search-route", permission:"public-search", role:"Yahoo public search route mount", enabled:true },
  "baidu": { type:"public-search-route", permission:"public-search", role:"Baidu public search route mount for Chinese web ecosystem discovery", enabled:true },
  "yandex": { type:"public-search-route", permission:"public-search", role:"Yandex public search route mount for Eurasian web ecosystem discovery", enabled:true },
  "youtube": {
    type: "media-search",
    permission: "api-key-required",
    role: "Reserved/active YouTube media mount; normally routed through Maru Search wide gateway to avoid duplicate API bursts",
    enabled: !!sanmaruEnvHas('YOUTUBE_API_KEY','GOOGLE_API_KEY')
  },
  "ai-gpu": {
    type: "analysis-provider",
    permission: "provider-key-or-local-runtime-required",
    role: "AI/GPU classification, dedupe, summarization and promotion decision layer",
    enabled: !!sanmaruEnvHas('OPENAI_API_KEY','AI_PROVIDER_KEY','SANMARU_AI_GPU_ENABLED')
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
    const active = !!meta.enabled;
    out[name] = {
      type: meta.type,
      permission: meta.permission,
      role: meta.role,
      enabled: active,
      openState: active ? "active" : "reserved",
      status: active ? "active-or-ready" : "reserved-or-key-missing",
      mountPolicy: "authorized-public-or-owned-channel-only",
      expansionMode: active ? "mounted" : "opening-signal-wait"
    };
  }
  return out;
}


// -----------------------------------------------------------------------------
// SANMARU GLOBAL RESIDENT HUB
// This layer does not copy the whole world into this function. It keeps the
// source map, category brain, health map, resident index/cache and learned query
// pools ready as the top resident information CPU. Maru Search is mounted as
// Sanmaru's front gateway/body, not as the decision owner.
// -----------------------------------------------------------------------------
const SANMARU_CANONICAL_CATEGORIES = {
  official:{ label:"주요 정보", weight:98, routes:["official-web","google","naver","bing","duckduckgo","yahoo","searchbank-index","searchbank"] },
  government:{ label:"공공기관", weight:96, routes:["official-web","public-data","google","naver","bing"] },
  public_data:{ label:"공공 데이터", weight:94, routes:["public-data","official-web","google","bing"] },
  map_local:{ label:"지도/주소/지역", weight:92, routes:["naver","google","bing","maru-search-wide-gateway"] },
  tourism:{ label:"지도/지역", weight:90, routes:["official-web","naver","google","youtube","social-public-web"] },
  news:{ label:"뉴스", weight:88, routes:["naver","google","bing","maru-search-wide-gateway"] },
  knowledge:{ label:"지식/백과", weight:86, routes:["wiki-knowledge","google","naver","bing","searchbank-index"] },
  wiki:{ label:"위키", weight:85, routes:["wiki-knowledge","google","bing"] },
  site:{ label:"사이트/홈페이지", weight:84, routes:["corporate-homepage","official-web","google","naver","bing","searchbank-index"] },
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
  web:{ label:"웹", weight:40, routes:["google","naver","bing","duckduckgo","yahoo","baidu","yandex","searchbank-index","searchbank"] }
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
  "maru-search-wide-gateway": ["web","site","news","image","video","youtube","map_local","tourism","blog","cafe","community","sns","shopping","book","knowledge"],
  naver: ["web","news","blog","cafe","knowledge","book","shopping","image","map_local","tourism"],
  google: ["web","official","knowledge","wiki","news","image","video","map_local","tourism","academic","research_paper","book","sns"],
  bing: ["web","news","image","video","academic","research_paper","official"],
  duckduckgo: ["web","official","news","knowledge","privacy_web"],
  yahoo: ["web","news","finance","sports"],
  baidu: ["web","news","image","video","knowledge"],
  yandex: ["web","image","video","news","map_local"],
  youtube: ["youtube","video","sns","tourism"],
  "official-web": ["official","government","public_data","site","tourism"],
  "social-public-web": ["sns","video","youtube","community"],
  instagram: ["sns","image","tourism"],
  facebook: ["sns","community","news"],
  tiktok: ["sns","video","youtube","tourism"],
  "x-twitter": ["sns","news","community"],
  threads: ["sns","community"],
  "corporate-homepage": ["site","web","official"],
  "blog-community": ["blog","cafe","community"],
  academic: ["academic","research_paper","university_library"],
  "research-paper": ["research_paper","academic"],
  "university-library": ["university_library","academic","book"],
  "wiki-knowledge": ["wiki","knowledge"]
};

// -----------------------------------------------------------------------------
// SANMARU GEO/IP ROUTE MATRIX
// IP/country is a ranking and supply-priority signal, not a blocking rule.
// If the query explicitly names a country/city/region, query geo wins over IP geo.
// -----------------------------------------------------------------------------
const SANMARU_COUNTRY_PROVIDER_PRIORITY = {
  KR: ["searchbank-index","searchbank","official-web","public-data","naver","google","bing","youtube","social-public-web","blog-community","wiki-knowledge"],
  US: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community","yahoo"],
  JP: ["searchbank-index","searchbank","official-web","public-data","google","bing","yahoo","youtube","social-public-web","wiki-knowledge"],
  CN: ["searchbank-index","searchbank","official-web","public-data","baidu","bing","yahoo","youtube","social-public-web","wiki-knowledge"],
  TW: ["searchbank-index","searchbank","official-web","public-data","google","bing","yahoo","youtube","social-public-web","wiki-knowledge"],
  HK: ["searchbank-index","searchbank","official-web","public-data","google","bing","yahoo","youtube","social-public-web","wiki-knowledge"],
  VN: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","blog-community","wiki-knowledge"],
  ID: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","blog-community","wiki-knowledge"],
  TH: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","blog-community","wiki-knowledge"],
  PH: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","blog-community","wiki-knowledge"],
  IN: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","blog-community","wiki-knowledge"],
  GB: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  DE: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  FR: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  ES: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  PT: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  BR: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  RU: ["searchbank-index","searchbank","official-web","public-data","yandex","google","bing","youtube","social-public-web","wiki-knowledge"],
  TR: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  SA: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge"],
  AE: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge"],
  CA: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  AU: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community"],
  GLOBAL: ["searchbank-index","searchbank","official-web","public-data","google","bing","youtube","social-public-web","wiki-knowledge","blog-community","duckduckgo","yahoo"]
};

const SANMARU_COUNTRY_SEARCH_PROFILE = {
  KR: { label:"Korea local-first", authority:[".go.kr","korea.kr","seoul.go.kr"], local:["naver","official-web","public-data"], news:["naver","google","bing"], commerce:["naver","google"], media:["youtube","naver","google"], language:["ko"] },
  US: { label:"United States local-first", authority:[".gov","usa.gov","state.gov"], local:["google","bing","official-web","public-data"], news:["google","bing","yahoo"], commerce:["google","bing"], media:["youtube","google","bing"], language:["en"] },
  JP: { label:"Japan local-first", authority:["go.jp","city.","pref."], local:["google","bing","yahoo","official-web"], news:["google","bing","yahoo"], commerce:["google","bing"], media:["youtube","google"], language:["ja"] },
  CN: { label:"China local-first", authority:["gov.cn"], local:["baidu","bing","official-web"], news:["baidu","bing"], commerce:["baidu","bing"], media:["baidu","bing"], language:["zh"] },
  VN: { label:"Vietnam local-first", authority:["gov.vn"], local:["google","bing","official-web","public-data"], news:["google","bing"], commerce:["google","bing"], media:["youtube","google"], language:["vi"] },
  GLOBAL: { label:"Global balanced", authority:["official-web","public-data"], local:["google","bing","official-web"], news:["google","bing"], commerce:["google","bing"], media:["youtube","google","bing"], language:[] }
};


// -----------------------------------------------------------------------------
// SANMARU COUNTRY CHARACTERISTIC PROFILE + NAVER/GOOGLE STYLE SEARCH SHAPE
// This policy layer does not reduce result count. It only changes ranking, lane
// emphasis and first-page skeleton so Sanmaru can behave like a globalized
// Naver/Google-style information OS.
// -----------------------------------------------------------------------------
const SANMARU_COUNTRY_CHARACTER_PROFILE = {
  KR: { style:"naver-like-local-category", authorityBias:1.22, localBias:1.18, commerceBias:1.10, mediaBias:1.05, socialBias:1.00, knowledgeBias:1.06, communityBias:1.08, preferredLanes:["authority","local","web","news","blog","media","commerce","knowledge","community","social"] },
  US: { style:"google-bing-authority-commerce", authorityBias:1.12, localBias:1.08, commerceBias:1.18, mediaBias:1.10, socialBias:1.08, knowledgeBias:1.08, communityBias:1.00, preferredLanes:["authority","web","news","local","commerce","media","knowledge","social","blog","community"] },
  JP: { style:"local-authority-media-balanced", authorityBias:1.15, localBias:1.13, commerceBias:1.08, mediaBias:1.08, socialBias:1.04, knowledgeBias:1.08, communityBias:1.02, preferredLanes:["authority","local","web","news","media","commerce","knowledge","blog","social","community"] },
  CN: { style:"public-platform-knowledge", authorityBias:1.18, localBias:1.10, commerceBias:1.12, mediaBias:1.08, socialBias:1.03, knowledgeBias:1.12, communityBias:1.00, preferredLanes:["authority","web","news","knowledge","commerce","media","local","social","blog","community"] },
  VN: { style:"local-authority-commerce-growing", authorityBias:1.18, localBias:1.16, commerceBias:1.12, mediaBias:1.06, socialBias:1.05, knowledgeBias:1.04, communityBias:1.02, preferredLanes:["authority","local","web","news","commerce","blog","media","social","knowledge","community"] },
  ID: { style:"local-social-commerce", authorityBias:1.12, localBias:1.13, commerceBias:1.14, mediaBias:1.08, socialBias:1.10, knowledgeBias:1.03, communityBias:1.04, preferredLanes:["authority","local","web","commerce","social","news","media","blog","knowledge","community"] },
  IN: { style:"public-knowledge-commerce", authorityBias:1.16, localBias:1.10, commerceBias:1.13, mediaBias:1.07, socialBias:1.06, knowledgeBias:1.12, communityBias:1.03, preferredLanes:["authority","web","local","knowledge","news","commerce","media","blog","social","community"] },
  GB: { style:"authority-news-knowledge", authorityBias:1.17, localBias:1.08, commerceBias:1.08, mediaBias:1.06, socialBias:1.04, knowledgeBias:1.12, communityBias:1.00, preferredLanes:["authority","web","news","knowledge","local","media","commerce","blog","social","community"] },
  DE: { style:"authority-industry-knowledge", authorityBias:1.18, localBias:1.09, commerceBias:1.12, mediaBias:1.04, socialBias:1.00, knowledgeBias:1.13, communityBias:1.00, preferredLanes:["authority","web","knowledge","news","commerce","local","media","blog","social","community"] },
  FR: { style:"authority-culture-news", authorityBias:1.17, localBias:1.09, commerceBias:1.07, mediaBias:1.07, socialBias:1.02, knowledgeBias:1.11, communityBias:1.00, preferredLanes:["authority","web","news","knowledge","local","media","commerce","blog","social","community"] },
  RU: { style:"local-yandex-authority", authorityBias:1.16, localBias:1.12, commerceBias:1.07, mediaBias:1.06, socialBias:1.02, knowledgeBias:1.10, communityBias:1.02, preferredLanes:["authority","web","news","local","knowledge","media","commerce","blog","social","community"] },
  GLOBAL: { style:"global-balanced-google-like", authorityBias:1.12, localBias:1.06, commerceBias:1.08, mediaBias:1.07, socialBias:1.04, knowledgeBias:1.08, communityBias:1.02, preferredLanes:["authority","web","news","local","knowledge","media","blog","commerce","social","community"] }
};

const SANMARU_LANE_CATEGORY_MAP = {
  authority:["official","government","public_data"],
  local:["map_local","tourism"],
  web:["web","site"],
  news:["news"],
  blog:["blog"],
  media:["video","youtube","image"],
  commerce:["shopping"],
  knowledge:["knowledge","wiki","book","academic","research_paper","university_library"],
  social:["sns"],
  community:["cafe","community"]
};

function countryCharacterProfileFor(country){
  country = normalizeCountryCode(country) || "GLOBAL";
  return SANMARU_COUNTRY_CHARACTER_PROFILE[country] || SANMARU_COUNTRY_CHARACTER_PROFILE.GLOBAL;
}

function laneForCategory(category){
  category = s(category);
  for(const [lane, cats] of Object.entries(SANMARU_LANE_CATEGORY_MAP)){
    if((cats || []).includes(category)) return lane;
  }
  return "web";
}

function laneBiasForCategory(category, profile){
  profile = profile || SANMARU_COUNTRY_CHARACTER_PROFILE.GLOBAL;
  const lane = laneForCategory(category);
  const map = {
    authority: profile.authorityBias,
    local: profile.localBias,
    commerce: profile.commerceBias,
    media: profile.mediaBias,
    social: profile.socialBias,
    knowledge: profile.knowledgeBias,
    community: profile.communityBias,
    news: Math.max(profile.authorityBias || 1, 1.06),
    blog: Math.max(profile.communityBias || 1, 1.04),
    web: 1
  };
  return Number(map[lane] || 1);
}

function laneBoostForCategory(category, profile){
  return Math.round((laneBiasForCategory(category, profile) - 1) * 40);
}

function buildSearchSkeletonPolicy(q, geo){
  geo = geo || buildGeoRouteContext(q || "", {});
  const profile = geo.characterProfile || countryCharacterProfileFor(geo.effectiveCountry);
  const lanes = Array.isArray(profile.preferredLanes) ? profile.preferredLanes.slice() : SANMARU_COUNTRY_CHARACTER_PROFILE.GLOBAL.preferredLanes.slice();
  return {
    style:"google-naver-hybrid-progressive-render",
    country: geo.effectiveCountry || "GLOBAL",
    explicitCountry: geo.explicitCountry || "",
    firstPaintOrder: lanes,
    topBlocks:["authority-top","search-count-skeleton","category-tabs","page-1-results"],
    pagination:{ initialPage:1, renderMode:"current-page-first", updateMode:"append-and-merge" },
    naverLike:{ categoryLanes:lanes, display:"current-page-window", start:"page-index", sort:"relevance-with-country-profile" },
    googleLike:{ totalResults:"estimate-or-provider-total", count:"current-page-count", startIndex:"page-offset", gl:geo.effectiveCountry, cr:geo.explicitCountry ? geo.explicitCountry : undefined },
    policy:"show-authority-and-current-page-first; keep-full-provider-search-running; never-replace-full-results-with-instant-only"
  };
}

function buildCategoryLanePlan(q, categories, geo){
  geo = geo || buildGeoRouteContext(q || "", {});
  const profile = geo.characterProfile || countryCharacterProfileFor(geo.effectiveCountry);
  const requested = new Set(Array.isArray(categories) ? categories : []);
  const lanes = [];
  for(const lane of (profile.preferredLanes || SANMARU_COUNTRY_CHARACTER_PROFILE.GLOBAL.preferredLanes)){
    const cats = (SANMARU_LANE_CATEGORY_MAP[lane] || []).filter(c => requested.size === 0 || requested.has(c) || lane === "authority" || lane === "web");
    lanes.push({
      lane,
      categories: cats.length ? cats : (SANMARU_LANE_CATEGORY_MAP[lane] || []).slice(0, 3),
      bias: laneBiasForCategory((SANMARU_LANE_CATEGORY_MAP[lane] || ["web"])[0], profile),
      role: lane === "authority" ? "top-trust-block" : (lane === "web" ? "main-results" : "category-section"),
      renderPolicy: lane === "authority" ? "top-fixed-if-available" : "progressive-section"
    });
  }
  return lanes;
}

const SANMARU_QUERY_GEO_ALIASES = [
  [/대한민국|한국|서울|부산|인천|대구|대전|광주|울산|세종|제주|경기|강원|충청|전라|경상|korea|seoul|busan|incheon|daegu|daejeon|gwangju|ulsan|jeju/i, "KR"],
  [/미국|usa|united states|america|new york|los angeles|washington|california|texas|florida/i, "US"],
  [/일본|japan|tokyo|osaka|kyoto|hokkaido/i, "JP"],
  [/중국|china|beijing|shanghai|guangzhou|shenzhen/i, "CN"],
  [/대만|taiwan|taipei/i, "TW"],
  [/홍콩|hong kong/i, "HK"],
  [/베트남|vietnam|hanoi|ho chi minh|danang/i, "VN"],
  [/인도|india|delhi|mumbai|bangalore/i, "IN"],
  [/인도네시아|indonesia|jakarta|bali/i, "ID"],
  [/태국|thailand|bangkok/i, "TH"],
  [/필리핀|philippines|manila/i, "PH"],
  [/영국|uk|united kingdom|britain|london/i, "GB"],
  [/독일|germany|berlin|munich/i, "DE"],
  [/프랑스|france|paris/i, "FR"],
  [/스페인|spain|madrid|barcelona/i, "ES"],
  [/브라질|brazil|sao paulo|rio/i, "BR"],
  [/러시아|russia|moscow/i, "RU"],
  [/튀르키예|터키|turkey|istanbul|ankara/i, "TR"],
  [/호주|australia|sydney|melbourne/i, "AU"],
  [/캐나다|canada|toronto|vancouver|ottawa/i, "CA"]
];

function normalizeCountryCode(v){
  const x = s(v).trim().toUpperCase();
  if(!x) return "";
  const alias = { USA:"US", UK:"GB", KOR:"KR", ROK:"KR", JPN:"JP", CHN:"CN", VNM:"VN", DEU:"DE", FRA:"FR", ESP:"ES", BRA:"BR", RUS:"RU", TUR:"TR", ARE:"AE", SAU:"SA", AUS:"AU", CAN:"CA" };
  return alias[x] || x.slice(0, 2);
}

function countryFromLang(lang){
  const l = low(lang);
  if(l.startsWith("ko")) return "KR";
  if(l.startsWith("ja")) return "JP";
  if(l.startsWith("zh")) return "CN";
  if(l.startsWith("vi")) return "VN";
  if(l.startsWith("id")) return "ID";
  if(l.startsWith("th")) return "TH";
  if(l.startsWith("hi")) return "IN";
  if(l.startsWith("de")) return "DE";
  if(l.startsWith("fr")) return "FR";
  if(l.startsWith("es")) return "ES";
  if(l.startsWith("pt-br")) return "BR";
  if(l.startsWith("pt")) return "PT";
  if(l.startsWith("ru")) return "RU";
  if(l.startsWith("tr")) return "TR";
  if(l.startsWith("en-gb")) return "GB";
  if(l.startsWith("en-au")) return "AU";
  if(l.startsWith("en-ca")) return "CA";
  if(l.startsWith("en")) return "US";
  return "";
}

function detectExplicitCountryFromQuery(q){
  const text = s(q);
  for(const [rx, code] of SANMARU_QUERY_GEO_ALIASES){
    try{ if(rx.test(text)) return code; }catch(e){}
  }
  return "";
}

function buildGeoRouteContext(q, opts){
  opts = opts || {};
  const forced = normalizeCountryCode(firstNonEmpty(opts.country, opts.region, opts.geo, opts.ipCountry, opts.runtimeRegion));
  const fromLang = normalizeCountryCode(countryFromLang(firstNonEmpty(opts.lang, opts.uiLang, opts.locale)));
  const explicit = normalizeCountryCode(firstNonEmpty(opts.queryCountry, detectExplicitCountryFromQuery(q)));
  const ipCountry = normalizeCountryCode(firstNonEmpty(opts.ipCountry, opts.runtimeRegion, forced, fromLang, "GLOBAL"));
  const effectiveCountry = explicit || forced || ipCountry || "GLOBAL";
  const profile = SANMARU_COUNTRY_SEARCH_PROFILE[effectiveCountry] || SANMARU_COUNTRY_SEARCH_PROFILE.GLOBAL;
  return {
    ipCountry: ipCountry || "GLOBAL",
    explicitCountry: explicit || "",
    effectiveCountry,
    prioritySource: explicit ? "query-explicit-geo" : (forced ? "ip-or-forced-country" : (fromLang ? "language-country" : "global-default")),
    profileLabel: profile.label,
    characterProfile: countryCharacterProfileFor(effectiveCountry),
    providerPriority: (SANMARU_COUNTRY_PROVIDER_PRIORITY[effectiveCountry] || SANMARU_COUNTRY_PROVIDER_PRIORITY.GLOBAL || []).slice(),
    lanePriority: {
      authority: ["official-web","public-data"].concat(profile.local || []),
      local: (profile.local || []).slice(),
      news: (profile.news || []).slice(),
      commerce: (profile.commerce || []).slice(),
      media: (profile.media || []).slice(),
      language: (profile.language || []).slice(),
      preferred: (countryCharacterProfileFor(effectiveCountry).preferredLanes || []).slice()
    },
    policy:"ip-country-is-ranking-signal; explicit-query-geo-wins; never-block-global-results"
  };
}

function geoProviderBoost(provider, category, geo){
  provider = s(provider);
  category = s(category);
  geo = geo || buildGeoRouteContext("", {});
  const order = geo.providerPriority || [];
  const idx = order.indexOf(provider);
  let boost = idx >= 0 ? Math.max(2, 24 - idx * 2) : 0;
  if((category === "official" || category === "government" || category === "public_data" || category === "map_local") && (provider === "official-web" || provider === "public-data")) boost += 18;
  if(geo.effectiveCountry === "KR" && provider === "naver") boost += 16;
  if((geo.effectiveCountry === "US" || geo.effectiveCountry === "GB" || geo.effectiveCountry === "CA" || geo.effectiveCountry === "AU") && (provider === "google" || provider === "bing")) boost += 12;
  if(geo.effectiveCountry === "CN" && provider === "baidu") boost += 18;
  if(geo.effectiveCountry === "RU" && provider === "yandex") boost += 14;

  // Country characteristic profile adjusts ranking only. It never blocks global results.
  boost += laneBoostForCategory(category, geo.characterProfile || countryCharacterProfileFor(geo.effectiveCountry));
  return boost;
}

function applyGeoPriorityToRoutes(routes, geo){
  return (Array.isArray(routes) ? routes : []).map(r => {
    const boost = geoProviderBoost(r.provider, r.category, geo);
    return Object.assign({}, r, {
      geoBoost: boost,
      effectiveWeight: (Number(r.weight) || 0) + boost,
      geoCountry: geo && geo.effectiveCountry,
      geoPrioritySource: geo && geo.prioritySource
    });
  }).sort((a,b) => ((b.effectiveWeight || b.weight || 0) - (a.effectiveWeight || a.weight || 0)) || s(a.provider).localeCompare(s(b.provider)));
}

function geoIpRouteMatrixSnapshot(q, opts){
  const geo = buildGeoRouteContext(q || "", opts || {});
  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    geoRoute:geo,
    countryProfiles:Object.keys(SANMARU_COUNTRY_PROVIDER_PRIORITY),
    countryCharacterProfiles:Object.keys(SANMARU_COUNTRY_CHARACTER_PROFILE),
    categoryLanePlan:buildCategoryLanePlan(q || "", [], geo),
    searchSkeleton:buildSearchSkeletonPolicy(q || "", geo),
    policy:"country-ip-prioritizes-lanes-without-blocking-global-results; country-character-profile-adjusts-ranking-only"
  };
}


// -----------------------------------------------------------------------------
// SANMARU PROVIDER LANE OS POLICY (non-invasive)
// This is a policy/diagnostic layer only. It does not replace existing adapters,
// exports, handler shape, resident maps, Search Bank bridge, or Maru Search flow.
// The goal is to keep Sanmaru as the global pipeline OS: route/health/trust/mount
// manager first, direct crawler only where an authorized provider lane is open.
// -----------------------------------------------------------------------------
const SANMARU_SUPPORTED_LANGUAGE_MATRIX = [
  "ko","en","zh","zht","ja","es","fr","de","ru","pt","it","ar","vi","th","id",
  "hi","tr","fa","bn","ur","sw","ta","hu","ms","nl","pl","sv","tl","uk","uz"
];

const SANMARU_PROVIDER_LANE_POLICY = {
  role:"global-information-pipeline-os",
  maruSearchRole:"gate-opener-and-delivery-road",
  dataStoragePolicy:"lightweight-resident-cache-index-route-map-only",
  directSearchPolicy:"provider-native-api-or-authorized-public-route-only",
  responsePolicy:"resident-first-provider-lane-open-when-not-explicitly-blocked",
  futureMountPolicy:"reserved-mount-promotes-to-active-when-key-permission-contract-or-runtime-opens",
  defaultRanking:["official","government","public_data","knowledge","wiki","news","map_local","tourism","shopping","sns","blog","cafe","community","image","video","web"],
  pipelineStates:["active","reserved","blocked","discovery","future"]
};

function sanmaruProviderLaneSnapshot(){
  const registry = sourceRegistrySnapshot();
  const active=[]; const reserved=[]; const discovery=[]; const blocked=[];
  for(const [name, meta] of Object.entries(registry || {})){
    const row = { provider:name, enabled:meta.enabled !== false, status:meta.status || (meta.enabled === false ? "reserved" : "active"), categories:meta.categories || [], role:meta.role || meta.roleInSanmaru || "mounted-information-source" };
    if(row.enabled) active.push(row);
    else reserved.push(row);
  }
  for(const name of ["local-supplier","regional-cooperative","fishery-cooperative","small-factory","small-merchant","municipal-open-data","licensed-db","gpu-ai-worker"]){
    if(!registry[name]) discovery.push({ provider:name, enabled:false, status:"discovery-or-future-mount", categories:[], role:"future autonomous extension lane" });
  }
  return {
    policy:SANMARU_PROVIDER_LANE_POLICY,
    languages:SANMARU_SUPPORTED_LANGUAGE_MATRIX.slice(),
    active,
    reserved,
    blocked,
    discovery,
    generatedAt:nowIso()
  };
}


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
    out[name] = Object.assign({}, out[name] || { enabled:true, status:"active-or-ready", openState:"active" }, {
      categories: cats.slice(),
      capabilityCount: cats.length,
      roleInSanmaru: name === "maru-search-wide-gateway" ? "front-information-road" : (name === "searchbank-index" ? "fast-memory-layer" : "mounted-information-source")
    });
  }
  const opening = openingSignalsSnapshot();
  for(const sig of opening){
    if(sig && sig.provider && out[sig.provider]) out[sig.provider].openingSignal = sig;
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
  const geoRoute = buildGeoRouteContext(q, opts);
  const routes = [];
  const seen = new Set();
  const registry = sourceRegistrySnapshot();
  for(const cat of categories){
    const meta = SANMARU_CANONICAL_CATEGORIES[cat] || SANMARU_CANONICAL_CATEGORIES.web;
    for(const provider of (meta.routes || providersForCategory(cat))){
      if(!provider || seen.has(provider)) continue;
      seen.add(provider);
      routes.push({
        provider,
        category:cat,
        weight:meta.weight || 0,
        enabled: registry[provider] ? registry[provider].enabled !== false : true
      });
    }
  }
  const geoRoutes = applyGeoPriorityToRoutes(routes, geoRoute);
  return {
    query:s(q),
    categories,
    routes:geoRoutes,
    geoRoute,
    categoryLanePlan:buildCategoryLanePlan(q, categories, geoRoute),
    searchSkeleton:buildSearchSkeletonPolicy(q, geoRoute),
    generatedAt:nowIso(),
    categoryBrainVersion:VERSION,
    routingPrinciple:"country-ip-priority-with-query-geo-override-global-results-not-blocked; country-character-profile-ranks-lanes; google-naver-style-progressive-skeleton"
  };
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


// Sanmaru OSAI supply-chain discernment layer -------------------------------
// This layer does not replace SearchBank/trustFilter/payment checks. It reads
// the existing function-data trust/payment/profile files, applies a consistent
// Sanmaru-level verdict, and keeps safe abundance: block known-dangerous inputs,
// but keep safe/placeholder front slots available for replacement/hydration.
const SANMARU_OSAI_DISCERNMENT_VERSION = "osai-supply-chain-discernment-v2.3-country-policy-evidence";
const SANMARU_SAFE_SUPPLY_EXPANSION_ORDER = Object.freeze([
  "local-city", "local-province", "same-country", "neighbor-region", "global-official", "global-trusted"
]);

function sanmaruFunctionPath(){
  return path.join.apply(path, [__dirname].concat(Array.from(arguments).filter(Boolean)));
}
function sanmaruDataJson(name, fallback){
  return readJsonSafe(sanmaruFunctionPath("data", name)) || fallback;
}
function sanmaruRequireOptional(rel){
  try{ return require(rel); }catch(e){ return null; }
}
function sanmaruOsaiPolicyResources(){
  const cached = globalState.osaiPolicyCache;
  if(cached && cached.loadedAt && nowMs() - cached.loadedAt < 5 * 60 * 1000) return cached;
  const trustCore = sanmaruRequireOptional("./lib/trustFilter.core.v1");
  const commerceTrust = sanmaruRequireOptional("./lib/trustFilter.v1");
  const payConfig = sanmaruRequireOptional("./data/pay-config") || {};
  const out = {
    loadedAt: nowMs(),
    allowlist: sanmaruDataJson("trust.allowlist.json", { domains:[], sources:[] }),
    blocklist: sanmaruDataJson("trust.blocklist.json", { domains:[], tlds:[], patterns:[], categories:[], keywords:[], sources:[] }),
    platformProfile: sanmaruDataJson("igdc.platform.profile.json", {}),
    payConfig,
    trustCore,
    commerceTrust,
    countrySupplyCore: sanmaruRequireOptional("./lib/country-supply-policy.core.v1"),
    sources:[
      "netlify/functions/data/country-policy.json",
      "netlify/functions/lib/country-supply-policy.core.v1.js",
      "netlify/functions/data/trust.allowlist.json",
      "netlify/functions/data/trust.blocklist.json",
      "netlify/functions/lib/trustFilter.core.v1.js",
      "netlify/functions/lib/trustFilter.v1.js",
      "netlify/functions/data/pay-config.js",
      "netlify/functions/data/igdc.platform.profile.json"
    ]
  };
  globalState.osaiPolicyCache = out;
  return out;
}
function sanmaruOsaiArray(v){ return Array.isArray(v) ? v : []; }
function sanmaruOsaiUrlOf(item){ return firstNonEmpty(item && item.url, item && item.link, item && item.href, item && item.detail && item.detail.detailUrl, item && item.producer && item.producer.home); }
function sanmaruOsaiHostOf(url){ try{ return new URL(s(url)).hostname.toLowerCase().replace(/^www\./, ""); }catch(e){ return ""; } }
function sanmaruOsaiTldOf(host){ const parts = low(host).split(".").filter(Boolean); return parts.length ? parts[parts.length - 1] : ""; }
function sanmaruOsaiDomainMatch(host, domains){
  host = low(host).replace(/^www\./, "");
  return sanmaruOsaiArray(domains).some(d => {
    const dom = low(d).replace(/^www\./, "");
    return !!dom && (host === dom || host.endsWith("." + dom));
  });
}
function sanmaruOsaiPatternHits(text, patterns){
  const hits = [];
  const body = s(text);
  const lbody = low(body);
  for(const ptn of sanmaruOsaiArray(patterns)){
    if(!ptn) continue;
    try{ if(new RegExp(s(ptn), "i").test(body)) hits.push(s(ptn)); }
    catch(e){ if(lbody.includes(low(ptn))) hits.push(s(ptn)); }
  }
  return hits.slice(0, 20);
}
function sanmaruOsaiTextOf(item){
  item = item || {};
  return [
    item.title, item.name, item.label, item.summary, item.snippet, item.description, item.content,
    item.type, item.category, item.searchCategory, item.displayGroup, item.source, item.provider,
    item.url, item.link, item.href, item.section, item.psom_key, item.page, item.route,
    item.producer && item.producer.name, item.producer && item.producer.id, item.producer && item.producer.home,
    item.org && item.org.name, item.entity && item.entity.name, item.entity && item.entity.type,
    item.sector && item.sector.major, item.sector && item.sector.minor, item.sector && item.sector.product_type,
    Array.isArray(item.tags) ? item.tags.join(" ") : ""
  ].filter(Boolean).join(" ");
}
function sanmaruClassifySupplyCategory(item){
  const text = normalizeText(sanmaruOsaiTextOf(item));
  const url = low(sanmaruOsaiUrlOf(item));
  const host = sanmaruOsaiHostOf(url);
  const categories = new Set();
  if(/농업|농산|농협|농가|농장|쌀|과일|채소|agri|farm|farmer|\bproduce\b|crop|grain|vegetable|fruit/.test(text)) categories.add("agriculture");
  if(/수산|수협|어업|어민|해산물|seafood|fishery|fisheries|fishing|aquaculture/.test(text)) categories.add("fishery");
  if(/임업|산림|목재|목공|forestry|forest|timber|wood/.test(text)) categories.add("forestry");
  if(/공산품|제조|제조업|공장|산업재|industrial|manufacturer|manufacturing|factory|industrial goods/.test(text)) categories.add("industrial_goods");
  if(/식품|먹거리|가공식품|식자재|food|grocery|ingredient|beverage/.test(text)) categories.add("food");
  if(/협동조합|조합|농협|수협|축협|cooperative|coop|co-op/.test(text)) categories.add("cooperative");
  if(/회사|기업|법인|상사|corp|company|corporation|enterprise|business/.test(text)) categories.add("company");
  if(/기관|협회|재단|연맹|association|foundation|institute|institution|university|college/.test(text)) categories.add("institution");
  if(/정부|공공|공식|시청|도청|군청|구청|부처|government|ministry|public data|open data|official/.test(text) || /\.gov$|\.go\.kr$|\.gob\.|\.go\.jp$|\.gov\./.test(host)) categories.add("government");
  if(/공공데이터|오픈데이터|open data|public data|data portal|dataportal/.test(text)) categories.add("public_data");
  if(/상품|쇼핑|구매|주문|결제|product|commerce|shopping|order|checkout/.test(text)) categories.add("commerce");
  if(/기부|후원|ngo|mission|charity|donation|relief/.test(text)) categories.add("donation");
  if(!categories.size) categories.add("general_information");
  return Array.from(categories);
}
function sanmaruIsMarketplaceHost(host){
  return /(^|\.)(coupang\.com|amazon\.|gmarket\.co\.kr|auction\.co\.kr|11st\.co\.kr|ssg\.com|ebay\.com|etsy\.com|aliexpress\.com|alibaba\.com|taobao\.com|tmall\.com|jd\.com|shopee\.|lazada\.|tokopedia\.com|smartstore\.naver\.com|shopping\.google\.com)$/i.test(host || "");
}
function sanmaruPaymentOrderReadiness(item, resources){
  item = item || {};
  const directSale = item.directSale && typeof item.directSale === "object" ? item.directSale : {};
  const ext = item.extension && typeof item.extension === "object" ? item.extension : {};
  const extPayment = ext.payment && typeof ext.payment === "object" ? ext.payment : {};
  const extStock = ext.stock && typeof ext.stock === "object" ? ext.stock : {};
  const commerce = item.commerce && typeof item.commerce === "object" ? item.commerce : {};
  const shipping = item.shipping && typeof item.shipping === "object" ? item.shipping : {};
  const detail = item.detail && typeof item.detail === "object" ? item.detail : {};
  const pay = resources && resources.payConfig || {};
  const features = pay.features || {};
  const policy = pay.policy || {};
  const platformPaymentRailReady = !!(pay.enabled !== false && !pay.maintenance && features.commerce !== false && features.pgExecution !== false);
  const rawPrice = firstNonEmpty(item.price, directSale.price, commerce.price, ext.price);
  const priceNumber = Number(String(rawPrice).replace(/[^0-9.\-]/g, ""));
  const hasPrice = rawPrice !== "" && Number.isFinite(priceNumber) && priceNumber > 0;
  const hasCurrency = !!firstNonEmpty(item.currency, directSale.currency, commerce.currency, ext.currency, policy.defaultCurrency);
  const checkoutUrl = firstNonEmpty(extPayment.checkout_url, extPayment.checkoutUrl, item.checkoutUrl, directSale.checkoutUrl, item.paymentUrl, commerce.checkoutUrl);
  const orderApi = firstNonEmpty(extPayment.order_api, extPayment.orderApi, item.orderApi, directSale.orderApi, commerce.orderApi);
  const pgProvider = firstNonEmpty(directSale.pgProvider, item.pgProvider, extPayment.provider, extPayment.pgProvider, policy.pgProvider);
  const inventoryValue = firstNonEmpty(directSale.inventory, directSale.stock, item.inventory, item.stock, extStock.qty, extStock.quantity, commerce.inventory);
  const hasInventorySignal = inventoryValue !== "" || extStock.mode === "unknown" || directSale.inventory != null || item.inventory != null || commerce.unitsSold != null;
  const inventoryReady = !!(inventoryValue === "unknown" || extStock.mode === "unknown" || Number(inventoryValue) > 0 || directSale.inventory === null || item.inventory === null);
  const deliveryReady = !!(shipping.country || shipping.address1 || shipping.changeable || item.deliveryReady || commerce.deliveryReady || /배송|delivery|shipping|pickup|수령/.test(normalizeText(sanmaruOsaiTextOf(item))));
  const policyReady = !!(detail.tracking || item.termsUrl || item.privacyUrl || item.refundPolicy || item.returnPolicy || /환불|반품|약관|개인정보|refund|return|terms|privacy/.test(normalizeText(sanmaruOsaiTextOf(item))));
  const orderable = directSale.orderable === true || item.orderable === true || !!orderApi || commerce.orderable === true || directSale.enabled === true;
  const paymentReady = !!(checkoutUrl || pgProvider || (directSale.enabled === true && platformPaymentRailReady));
  const productLike = !!(hasPrice || directSale.enabled === true || orderable || /product|commerce|shopping|order|checkout|상품|구매|주문|결제/.test(normalizeText(sanmaruOsaiTextOf(item))));
  let readinessScore = 0;
  if(platformPaymentRailReady) readinessScore += 10;
  if(hasPrice) readinessScore += 16;
  if(hasCurrency) readinessScore += 10;
  if(checkoutUrl) readinessScore += 18;
  if(orderApi) readinessScore += 18;
  if(pgProvider) readinessScore += 14;
  if(orderable) readinessScore += 12;
  if(inventoryReady || hasInventorySignal) readinessScore += 8;
  if(deliveryReady) readinessScore += 8;
  if(policyReady) readinessScore += 6;
  readinessScore = Math.max(0, Math.min(100, readinessScore));
  const paymentReadyStrict = !!(paymentReady && (checkoutUrl || pgProvider || platformPaymentRailReady));
  const orderReady = !!(orderable && (paymentReadyStrict || orderApi) && (!productLike || (hasPrice && hasCurrency)));
  return {
    platformPaymentRailReady,
    paymentReady: paymentReadyStrict,
    paymentReadyLoose: paymentReady,
    orderReady,
    orderReadyLoose: !!(orderable || paymentReady && hasPrice && hasCurrency),
    hasPrice,
    hasCurrency,
    checkoutUrlPresent: !!checkoutUrl,
    orderApiPresent: !!orderApi,
    pgProvider: pgProvider || null,
    inventoryReady,
    hasInventorySignal,
    deliveryReady,
    policyReady,
    productLike,
    readinessScore,
    readinessTier: readinessScore >= 80 ? "A" : readinessScore >= 60 ? "B" : readinessScore >= 40 ? "C" : "D",
    evidence:{
      hasPrice, hasCurrency, checkoutUrlPresent:!!checkoutUrl, orderApiPresent:!!orderApi, pgProvider:pgProvider || null,
      inventoryReady, deliveryReady, policyReady, platformPaymentRailReady
    },
    payConfigSource: "netlify/functions/data/pay-config.js"
  };
}

function sanmaruSupplyIntentOf(item){
  const text = normalizeText(sanmaruOsaiTextOf(item));
  const cats = sanmaruClassifySupplyCategory(item);
  return !!(cats.some(c => ["agriculture","fishery","forestry","industrial_goods","food","cooperative","company","commerce"].includes(c)) || /상품|구매|주문|결제|생산자|공급|직거래|product|commerce|shopping|order|checkout|producer|supplier|manufacturer/.test(text));
}
function sanmaruProducerTypeOf(item, categories){
  const text = normalizeText(sanmaruOsaiTextOf(item));
  categories = categories || sanmaruClassifySupplyCategory(item);
  if(categories.includes("government") || /정부|공공|지자체|부처|government|ministry|public/.test(text)) return "public_institution";
  if(categories.includes("cooperative") || /농협|수협|축협|협동조합|cooperative|co-op|coop/.test(text)) return "cooperative";
  if(categories.includes("agriculture") || /농가|농장|farm|farmer|producer/.test(text)) return "agricultural_producer";
  if(categories.includes("fishery") || /어민|수산|fishery|fisheries|seafood/.test(text)) return "fishery_producer";
  if(categories.includes("forestry") || /임업|산림|forest|timber/.test(text)) return "forestry_producer";
  if(categories.includes("industrial_goods") || /제조|공장|manufacturer|factory/.test(text)) return "manufacturer";
  if(categories.includes("company") || /회사|기업|corp|company/.test(text)) return "verified_company_candidate";
  if(categories.includes("institution")) return "institution";
  return "general_source";
}
function sanmaruBuildSupplyExpansionPlan(item, opts){
  opts = opts || {};
  item = item || {};
  const geo = item.geo && typeof item.geo === "object" ? item.geo : {};
  const countryCore = sanmaruRequireOptional("./lib/country-supply-policy.core.v1");
  const requestedCountry = firstNonEmpty(opts.targetMarket, opts.targetCountry, opts.audienceCountry, opts.country, geo.country, item.country, "GLOBAL");
  const region = firstNonEmpty(opts.region, geo.region, geo.state, item.region, "");
  const city = firstNonEmpty(opts.city, geo.city, item.city, "");
  const categories = sanmaruClassifySupplyCategory(item);
  let policyPlan = null;
  if(countryCore && typeof countryCore.resolveSupplyPlan === "function"){
    try{
      policyPlan = countryCore.resolveSupplyPlan({
        targetMarket:requestedCountry,
        hub:firstNonEmpty(opts.hub, opts.channel, opts.page, item.channel, item.page, item.route),
        localCandidateCount:opts.localCandidateCount
      });
    }catch(_e){ policyPlan = null; }
  }
  const normalizedCountry = policyPlan && policyPlan.targetMarket || requestedCountry;
  const ladder = [
    { level:"local-city", country:normalizedCountry, region:region || null, city:city || null, priority:1 },
    { level:"local-province", country:normalizedCountry, region:region || null, city:null, priority:2 },
    { level:"same-country", country:normalizedCountry, region:null, city:null, priority:3 }
  ];
  const fallbackTiers = policyPlan && Array.isArray(policyPlan.fallbackTiers) ? policyPlan.fallbackTiers : [];
  for(let i=0;i<fallbackTiers.length;i++){
    const tier = fallbackTiers[i] || {};
    if(!Array.isArray(tier.countries) || !tier.countries.length) continue;
    ladder.push({ level:"neighbor-region", countries:tier.countries.slice(), country:normalizedCountry, region:null, city:null, priority:4 + i, policyReason:tier.reason || "approved-neighbor-market" });
  }
  if(!policyPlan || policyPlan.globalFallbackNeeded){
    ladder.push({ level:"global-official", country:"GLOBAL", officialOnly:true, priority:4 + fallbackTiers.length });
    ladder.push({ level:"global-trusted", country:"GLOBAL", trustedOnly:true, priority:5 + fallbackTiers.length });
  }
  return {
    mode:"safe-abundance-ladder",
    principle:"filter-danger-expand-safe-supply",
    start:{ country:normalizedCountry, region:region || null, city:city || null },
    targetMarket:normalizedCountry,
    categoryHints:categories,
    ladder,
    countryPolicy:policyPlan ? {
      version:policyPlan.policyVersion,
      enforcement:policyPlan.enforcement,
      localSources:policyPlan.localSources,
      fallbackTiers:policyPlan.fallbackTiers,
      localShortage:policyPlan.localShortage,
      minimumLocalCandidates:policyPlan.minimumLocalCandidates
    } : { version:null, enforcement:"audit", localSources:[normalizedCountry], fallbackTiers:[] },
    targetPolicy:"keep-supply-abundant-after-risk-filtering",
    shortageFallback:"expand-only-to-policy-approved-neighbor-markets-before-global-official"
  };
}
function sanmaruBuildSearchBankUnifiedContract(item, d){
  item = item || {}; d = d || {};
  const source = d.source || {}; const supply = d.supply || {}; const payment = d.payment || {}; const eligibility = d.eligibility || {}; const safety = d.safety || {};
  return {
    contractVersion:"sanmaru-searchbank-supply-contract-v1.1",
    sourceEngine:ENGINE_NAME,
    sourceVersion:VERSION,
    candidateId:firstNonEmpty(item.id, item.indexId, item.originalId, stableHash([item.title, source.url, source.host].join("|"))),
    page:firstNonEmpty(item.page, item.route, item.layerPointer && item.layerPointer.page),
    section:firstNonEmpty(item.section, item.psom_key, item.slotKey, item.layerPointer && item.layerPointer.section),
    supplyCategory:supply.supplyCategory || [],
    countrySupply:supply.countrySupply || null,
    sourceCountry:supply.countrySupply && supply.countrySupply.sourceCountryVerified && supply.countrySupply.sourceCountry || firstNonEmpty(item.sourceCountry, item.source_country, item.sourceGeo && item.sourceGeo.country, item.geo && item.geo.country, item.country) || null,
    targetMarket:supply.countrySupply && supply.countrySupply.targetMarket || firstNonEmpty(item.targetMarket, item.targetCountry, item.marketCountry) || null,
    availabilityCountries:supply.countrySupply && supply.countrySupply.availabilityCountries || item.availabilityCountries || item.allowedCountries || null,
    supplyTier:supply.countrySupply && supply.countrySupply.supplyTier || item.supplyTier || null,
    countryPolicyVersion:supply.countrySupply && supply.countrySupply.policyVersion || item.countryPolicyVersion || null,
    sourceTrustScore:d.trustScore || 0,
    trustTier:d.trustTier || "C",
    riskLevel:d.riskLevel || "low",
    blocked:!!d.blocked,
    blockedReason:d.blockedReason || null,
    officialSource:!!(source.officialSource),
    institutionVerified:!!(source.institutionVerified),
    producerVerified:!!(supply.producerVerified),
    producerType:supply.producerType || "general_source",
    directProducerChannel:!!(supply.directProducerChannel),
    intermediaryRisk:supply.intermediaryRisk || "low",
    paymentReady:!!payment.paymentReady,
    orderReady:!!payment.orderReady,
    paymentReadinessScore:payment.readinessScore || 0,
    supplyChainReady:!!supply.supplyChainReady,
    harmfulContentRisk:safety.harmfulContentRisk || "low",
    illegalSiteRisk:safety.illegalSiteRisk || "low",
    unsafeProductRisk:safety.unsafeProductRisk || "low",
    frontSupplyAllowed:!!eligibility.frontSupplyAllowed,
    searchBankEligible:!!eligibility.searchBankEligible,
    snapshotEligible:!!eligibility.snapshotEligible,
    indexEligible:!!eligibility.indexEligible,
    contractAction: d.blocked ? "block" : (eligibility.snapshotEligible ? "accept-for-snapshot" : (eligibility.searchBankEligible ? "hold-for-searchbank-review" : "hold-for-review")),
    storagePolicy:d.blocked ? "do-not-route-dangerous-source" : "route-safe-candidate-with-evidence-meta"
  };
}
function sanmaruEvaluateOsaiSupplyDiscernment(item, opts){
  opts = opts || {};
  item = item || {};
  const resources = sanmaruOsaiPolicyResources();
  const text = sanmaruOsaiTextOf(item);
  const textNorm = normalizeText(text);
  const url = sanmaruOsaiUrlOf(item);
  const isHttp = /^https?:\/\//i.test(s(url));
  const host = sanmaruOsaiHostOf(url);
  const tld = sanmaruOsaiTldOf(host);
  const placeholderLike = !!(isPlaceholderItem(item) || item.isLayerPointer || item.replaceableSlot || isPlaceholderUrlValue(url) || /seed placeholder|replaceable-front-slot|placeholder/i.test(text));
  const block = resources.blocklist || {};
  const allow = resources.allowlist || {};
  const hardBlockReasons = [];
  const warningReasons = [];
  const trustEvidence = [];
  const safetyEvidence = [];
  const paymentEvidence = [];
  const producerEvidence = [];
  const officialEvidence = [];
  const supplyCategory = sanmaruClassifySupplyCategory(item);
  const supplyIntent = sanmaruSupplyIntentOf(item);

  if(host && sanmaruOsaiDomainMatch(host, block.domains)){ hardBlockReasons.push("BLOCKLIST_DOMAIN"); safetyEvidence.push("domain-in-blocklist"); }
  if(tld && sanmaruOsaiArray(block.tlds).map(low).includes(tld)){ hardBlockReasons.push("BLOCKLIST_TLD"); safetyEvidence.push("tld-in-blocklist"); }
  const patternHits = sanmaruOsaiPatternHits(text, block.patterns).concat(sanmaruOsaiPatternHits(text, block.keywords));
  if(patternHits.length){ hardBlockReasons.push("BLOCKLIST_PATTERN"); safetyEvidence.push("blocklist-pattern-hit"); }
  if(item.fake === true){ hardBlockReasons.push("ITEM_FAKE"); safetyEvidence.push("item-fake-flag"); }
  if(item.scam === true){ hardBlockReasons.push("ITEM_SCAM"); safetyEvidence.push("item-scam-flag"); }
  if(host && /^xn--/.test(host)){ hardBlockReasons.push("DOMAIN_PUNYCODE_BLOCK"); safetyEvidence.push("punycode-domain"); }

  let coreScore = null;
  if(isHttp && resources.trustCore && typeof resources.trustCore.evaluateTrust === "function"){
    try{
      const core = resources.trustCore.evaluateTrust(Object.assign({ title:firstNonEmpty(item.title, item.name, host || "candidate") }, item, { url }), { country:opts.country, strictCountry:false });
      if(core && Number.isFinite(Number(core.score))) coreScore = Number(core.score);
      if(core && core.ok === false){
        const fatal = sanmaruOsaiArray(core.reasons).filter(r => /BLOCKLIST|ITEM_FAKE|ITEM_SCAM|URL_INVALID|CURRENCY_INVALID/.test(s(r)));
        hardBlockReasons.push(...fatal);
        if(fatal.length) safetyEvidence.push("trust-core-fatal:" + fatal.slice(0, 3).join(","));
        if(!fatal.length) warningReasons.push(...sanmaruOsaiArray(core.reasons));
      }else if(core && core.trusted){ warningReasons.push("TRUST_CORE_ALLOWLISTED"); trustEvidence.push("trust-core-allowlisted"); }
    }catch(e){ warningReasons.push("TRUST_CORE_UNAVAILABLE"); }
  }

  let commerceScore = null;
  if(isHttp && resources.commerceTrust && typeof resources.commerceTrust.evaluateCandidate === "function"){
    try{
      const commerce = resources.commerceTrust.evaluateCandidate({ url, title:item.title, image:firstNonEmpty(item.image, item.thumbnail, item.thumb), price:item.price, currency:item.currency }, { allowlist:allow, blocklist:block, minScore:35 });
      if(commerce && Number.isFinite(Number(commerce.score))) commerceScore = Number(commerce.score);
      if(commerce && sanmaruOsaiArray(commerce.reasons).some(r => /BLOCKLIST|PUNYCODE/.test(s(r)))){
        const fatal = commerce.reasons.filter(r => /BLOCKLIST|PUNYCODE/.test(s(r)));
        hardBlockReasons.push(...fatal);
        safetyEvidence.push("commerce-trust-fatal:" + fatal.slice(0, 3).join(","));
      }else if(commerce && commerce.ok === false) warningReasons.push("COMMERCE_READINESS_LOW");
      if(commerce && commerce.ok === true) trustEvidence.push("commerce-trust-ok");
    }catch(e){ warningReasons.push("COMMERCE_TRUST_UNAVAILABLE"); }
  }

  const allowedDomain = !!(host && sanmaruOsaiDomainMatch(host, allow.domains));
  if(allowedDomain) trustEvidence.push("allowlist-domain");
  const officialHostSignal = /\.gov$|\.gov\.|\.go\.kr$|\.go\.jp$|\.go\.vn$|\.gob\.|\.or\.kr$|\.ac\.kr$|\.edu$|\.edu\.|korea\.kr$/i.test(host);
  const officialTextSignal = /공식|정부|공공|기관|공공데이터|official|government|ministry|public data|open data|authority|municipality/.test(textNorm);
  const officialSource = !!(allowedDomain || officialHostSignal || officialTextSignal);
  if(officialSource) officialEvidence.push(allowedDomain ? "allowlist-official" : (officialHostSignal ? "official-host" : "official-text"));
  const institutionVerified = !!(officialSource || /기관|협회|재단|연맹|대학|연구소|institute|institution|association|foundation|university|college|cooperative federation/.test(textNorm));
  if(institutionVerified) officialEvidence.push("institution-signal");
  const producerVerified = !!(item.producer && (item.producer.id || item.producer.name || item.producer.home) || /생산자|직거래|산지|농협|수협|축협|협동조합|제조사|제조업체|manufacturer|producer|farm|fishery|factory|cooperative|direct producer|supplier/.test(textNorm));
  if(producerVerified) producerEvidence.push(item.producer ? "producer-object" : "producer-text-signal");
  const producerType = sanmaruProducerTypeOf(item, supplyCategory);
  const marketplaceHost = sanmaruIsMarketplaceHost(host);
  const marketplaceText = /중개|마켓플레이스|오픈마켓|affiliate|제휴|distributor|reseller|marketplace|platform seller/.test(textNorm);
  const intermediaryRisk = marketplaceHost || marketplaceText ? (producerVerified || officialSource ? "medium" : "high") : "low";
  if(intermediaryRisk !== "low") producerEvidence.push("intermediary-risk:" + intermediaryRisk);
  const directProducerChannel = !!(producerVerified && intermediaryRisk !== "high");
  if(directProducerChannel) producerEvidence.push("direct-producer-channel");
  const payment = sanmaruPaymentOrderReadiness(item, resources);
  if(payment.paymentReady) paymentEvidence.push("payment-ready");
  if(payment.orderReady) paymentEvidence.push("order-ready");
  if(payment.deliveryReady) paymentEvidence.push("delivery-ready");
  if(payment.policyReady) paymentEvidence.push("commerce-policy-ready");

  const unsafeProductKeyword = /도박|성인|마약|무기|위조|불법|불법약물|사행|gambling|casino|drug|weapon|counterfeit|adult|porn|steroid|explosive/.test(textNorm);
  if(unsafeProductKeyword && (supplyIntent || opts.mode === "front-supply" || opts.frontSupply || opts.slotSupply)){
    hardBlockReasons.push("UNSAFE_PRODUCT_SIGNAL");
    safetyEvidence.push("unsafe-product-keyword");
  }
  const unsafeProductRisk = hardBlockReasons.includes("UNSAFE_PRODUCT_SIGNAL") || patternHits.length ? "blocked" : (unsafeProductKeyword ? "high" : "low");
  const illegalSiteRisk = hardBlockReasons.some(r => /BLOCKLIST|PUNYCODE/.test(r)) ? "blocked" : "low";
  const harmfulContentSignal = /폭력|테러|성인|도박|피싱|scam|phishing|malware|terror|adult|casino/.test(textNorm);
  const harmfulContentRisk = hardBlockReasons.length ? "blocked" : (harmfulContentSignal ? "medium" : "low");
  if(harmfulContentSignal) safetyEvidence.push("harmful-content-signal");

  const supplyExpansionPlan = sanmaruBuildSupplyExpansionPlan(item, opts);
  let countrySupply = null;
  if(resources.countrySupplyCore && typeof resources.countrySupplyCore.evaluateCandidateForTarget === "function"){
    try{
      countrySupply = resources.countrySupplyCore.evaluateCandidateForTarget(item, {
        targetMarket:supplyExpansionPlan.targetMarket,
        hub:firstNonEmpty(opts.hub, opts.channel, opts.page, item.channel, item.page, item.route),
        localCandidateCount:opts.localCandidateCount
      });
    }catch(_e){ countrySupply = null; }
  }
  const baseTrust = 45;
  const trustScore = Math.max(0, Math.min(100,
    baseTrust + (allowedDomain ? 18 : 0) + (officialSource ? 18 : 0) + (institutionVerified ? 8 : 0) +
    (producerVerified ? 10 : 0) + (directProducerChannel ? 8 : 0) + (payment.paymentReady ? 5 : 0) +
    (payment.orderReady ? 8 : 0) + (payment.deliveryReady ? 3 : 0) + (payment.policyReady ? 3 : 0) +
    (coreScore != null ? Math.max(-10, Math.min(12, Math.round(coreScore / 10))) : 0) +
    (commerceScore != null ? Math.max(-8, Math.min(10, Math.round(commerceScore / 12))) : 0) -
    (intermediaryRisk === "high" ? 15 : intermediaryRisk === "medium" ? 6 : 0) - (hardBlockReasons.length ? 100 : 0)
  ));
  const trustTier = hardBlockReasons.length ? "blocked" : (trustScore >= 88 ? "A+" : trustScore >= 76 ? "A" : trustScore >= 62 ? "B" : trustScore >= 48 ? "C" : "D");
  const supplyChainReady = !!(!hardBlockReasons.length && (officialSource || institutionVerified || producerVerified || directProducerChannel || payment.orderReady || supplyCategory.some(x => !["general_information"].includes(x))));
  const riskLevel = hardBlockReasons.length ? "blocked" : (unsafeProductRisk === "high" || harmfulContentRisk === "medium" || intermediaryRisk === "high" && !officialSource ? "medium" : (warningReasons.length ? "low" : "low"));
  const frontSupplyAllowed = !hardBlockReasons.length;
  const searchBankEligible = !hardBlockReasons.length && (placeholderLike || trustScore >= 45 || supplyChainReady);
  const snapshotEligible = !hardBlockReasons.length && (placeholderLike || trustScore >= 48 || officialSource || supplyChainReady);
  const indexEligible = !hardBlockReasons.length && (placeholderLike || trustScore >= 40 || supplyChainReady);
  const evidence = {
    trust:Array.from(new Set(trustEvidence)).slice(0, 12),
    safety:Array.from(new Set(safetyEvidence)).slice(0, 12),
    payment:Array.from(new Set(paymentEvidence)).slice(0, 12),
    producer:Array.from(new Set(producerEvidence)).slice(0, 12),
    official:Array.from(new Set(officialEvidence)).slice(0, 12),
    warnings:Array.from(new Set(warningReasons)).slice(0, 12)
  };
  const provisional = {
    version:SANMARU_OSAI_DISCERNMENT_VERSION,
    ok:!hardBlockReasons.length,
    blocked:!!hardBlockReasons.length,
    blockedReason:hardBlockReasons.length ? Array.from(new Set(hardBlockReasons)).join("|") : null,
    riskLevel,
    trustTier,
    trustScore,
    source:{ url:url || null, host:host || null, allowedDomain, officialSource, institutionVerified, officialEvidence:evidence.official },
    supply:{ supplyCategory, producerVerified, producerType, directProducerChannel, intermediaryRisk, supplyChainReady, localFirstExpansion:true, expansionOrder:SANMARU_SAFE_SUPPLY_EXPANSION_ORDER, expansionPlan:supplyExpansionPlan, countrySupply },
    payment,
    safety:{ illegalSiteRisk, harmfulContentRisk, unsafeProductRisk, patternHits:patternHits.slice(0, 10), warningReasons:evidence.warnings, safetyEvidence:evidence.safety },
    eligibility:{ frontSupplyAllowed, searchBankEligible, snapshotEligible, indexEligible, placeholderLike, abundancePreserved:true },
    evidence,
    policySources:resources.sources
  };
  provisional.searchBankContract = sanmaruBuildSearchBankUnifiedContract(item, provisional);
  return provisional;
}
function sanmaruAttachDiscernment(item, opts){
  const d = sanmaruEvaluateOsaiSupplyDiscernment(item, opts || {});
  const out = Object.assign({}, item);
  out.osaiDiscernment = d;
  out.sanmaruTrust = { tier:d.trustTier, score:d.trustScore, riskLevel:d.riskLevel, blocked:d.blocked, blockedReason:d.blockedReason };
  out.supplyChain = Object.assign({}, out.supplyChain || {}, d.supply, { paymentReady:d.payment.paymentReady, orderReady:d.payment.orderReady, officialSource:d.source.officialSource, institutionVerified:d.source.institutionVerified });
  if(d.supply && d.supply.countrySupply){
    out.countrySupply = d.supply.countrySupply;
    if(d.supply.countrySupply.sourceCountryVerified) out.sourceCountry = out.sourceCountry || d.supply.countrySupply.sourceCountry || undefined;
    // countrySupply.targetMarket is request-contextual and must not overwrite a
    // candidate's intrinsic market metadata in the shared SearchBank pool.
    out.availabilityCountries = out.availabilityCountries || d.supply.countrySupply.availabilityCountries || undefined;
    out.supplyTier = d.supply.countrySupply.supplyTier || out.supplyTier;
    out.countryPolicyVersion = d.supply.countrySupply.policyVersion || out.countryPolicyVersion;
  }
  out.trustTier = d.trustTier;
  out.riskLevel = d.riskLevel;
  out.blockedReason = d.blockedReason;
  out.officialSource = d.source.officialSource;
  out.institutionVerified = d.source.institutionVerified;
  out.producerVerified = d.supply.producerVerified;
  out.directProducerChannel = d.supply.directProducerChannel;
  out.intermediaryRisk = d.supply.intermediaryRisk;
  out.paymentReady = d.payment.paymentReady;
  out.orderReady = d.payment.orderReady;
  out.supplyChainReady = d.supply.supplyChainReady;
  out.frontSupplyAllowed = d.eligibility.frontSupplyAllowed;
  out.searchBankEligible = d.eligibility.searchBankEligible;
  out.snapshotEligible = d.eligibility.snapshotEligible;
  out.indexEligible = d.eligibility.indexEligible;
  out.sanmaruEvidence = d.evidence;
  out.sanmaruSearchBankContract = d.searchBankContract;
  out.producerType = d.supply.producerType;
  out.paymentReadinessScore = d.payment.readinessScore;
  out.paymentReadinessTier = d.payment.readinessTier;
  out.safeSupplyExpansion = d.supply.expansionPlan;
  if(d.blocked) out.sanmaruBlocked = true;
  return out;
}
function sanmaruScreenSupplyItems(items, opts){
  opts = opts || {};
  const started = nowMs();
  const out = [];
  const blocked = [];
  const riskCounts = Object.create(null);
  const categoryCounts = Object.create(null);
  const tierCounts = Object.create(null);
  for(const raw of (Array.isArray(items) ? items : [])){
    if(!raw || typeof raw !== "object") continue;
    const item = sanmaruAttachDiscernment(raw, opts);
    const d = item.osaiDiscernment || {};
    riskCounts[d.riskLevel || "unknown"] = (riskCounts[d.riskLevel || "unknown"] || 0) + 1;
    tierCounts[d.trustTier || "unknown"] = (tierCounts[d.trustTier || "unknown"] || 0) + 1;
    for(const cat of sanmaruOsaiArray(d.supply && d.supply.supplyCategory)) categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    if(d.blocked && !truthy(opts.includeBlocked)){
      blocked.push({ id:item.id || null, title:item.title || null, blockedReason:d.blockedReason, riskLevel:d.riskLevel });
      continue;
    }
    out.push(item);
  }
  return {
    items:out,
    meta:{
      version:SANMARU_OSAI_DISCERNMENT_VERSION,
      inputCount:Array.isArray(items) ? items.length : 0,
      outputCount:out.length,
      blockedCount:blocked.length,
      blockedPreview:blocked.slice(0, 8),
      riskCounts, trustTierCounts:tierCounts, supplyCategoryCounts:categoryCounts,
      searchBankEligibleCount:out.filter(x => x && x.searchBankEligible).length,
      snapshotEligibleCount:out.filter(x => x && x.snapshotEligible).length,
      indexEligibleCount:out.filter(x => x && x.indexEligible).length,
      paymentReadyCount:out.filter(x => x && x.paymentReady).length,
      orderReadyCount:out.filter(x => x && x.orderReady).length,
      directProducerChannelCount:out.filter(x => x && x.directProducerChannel).length,
      contractVersion:"sanmaru-searchbank-supply-contract-v1.1",
      evidenceEnabled:true,
      preservesAbundance:true,
      riskGateBeforeExpansion:true,
      expansionOrder:SANMARU_SAFE_SUPPLY_EXPANSION_ORDER,
      policy:"block-known-dangerous-expand-safe-supply-unify-sanmaru-searchbank-trust-contract",
      elapsedMs:nowMs() - started
    }
  };
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
  if(resident.queryMap.size > 2000){
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
    const key = residentStableItemKey(item);
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
  const identity = sanmaruEngineIdentity();
  const codeChanged = residentEngineCodeChanged(resident, identity);
  const explicitEngineUpload = isExplicitSanmaruEngineUpload(opts);

  // 핵심 정책:
  // - 산마루 엔진 파일 자체가 새로 올라오거나 코드 fingerprint가 바뀐 경우에만 resident를 논리 재부팅한다.
  // - 관리자 권한은 민감 action 허용 조건일 뿐, 그 자체로 산마루 resident를 초기화하지 않는다.
  // - 콘텐츠, 프론트, snapshot, promoted, ingested, Search Bank Index 변경은 hot refresh/absorb로 처리한다.
  const forceEngineReboot = !!(opts.force && (codeChanged || explicitEngineUpload));
  const hotRefreshOnly = !!(opts.force && !forceEngineReboot);

  if(resident.ready && !forceEngineReboot){
    if(hotRefreshOnly){
      resident.lastDeniedForceBootAt = nowMs();
      resident.lastDeniedForceBootReason = opts.reason || "data-content-hot-refresh-no-engine-reboot";
      resident.lastHotRefreshAt = nowMs();
      resident.lastHotRefreshReason = opts.reason || "hot-refresh";
      resident.lastLifecycleMode = "hot-refresh-no-engine-reboot";
      rebuildResidentProviderHealth(opts.reason || "hot-refresh-no-engine-reboot");
    }
    resident.engineIdentity = resident.engineIdentity || identity;
    return residentBootSnapshot();
  }

  const started = nowMs();
  try{
    if(forceEngineReboot){
      resident.items = [];
      resident.itemMap = new Map();
      resident.categoryMap = new Map();
      resident.sourceMap = new Map();
      resident.queryMap = new Map();
      resident.routeMap = new Map();
      resident.providerHealth = new Map();
      resident.lastLifecycleMode = codeChanged ? "engine-code-fingerprint-changed-reboot" : "explicit-sanmaru-engine-upload-reboot";
    }else{
      resident.lastLifecycleMode = resident.ready ? "resident-restore" : "cold-start-resident-restore";
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
    resident.bootReason = opts.reason || (forceEngineReboot ? "sanmaru-engine-file-upload" : "resident-restore");
    resident.engineLifecyclePolicy = "sanmaru-engine-file-upload-reboot-only-data-content-hot-refresh-otherwise";
    resident.engineIdentity = identity;
    resident.lastBootFiles = files;
    resident.lastBootLatency = nowMs() - started;
    resident.lastError = null;
    rebuildResidentProviderHealth(opts.reason || "resident-boot");
    return Object.assign(residentBootSnapshot(), { bootFiles:files, absorbed, engineIdentity:identity });
  }catch(e){
    resident.lastError = responseErrorCode(e);
    resident.ready = true;
    resident.bootedAt = nowMs();
    resident.engineIdentity = identity;
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
    lastError:resident.lastError || null,
    engineIdentity: resident.engineIdentity || sanmaruEngineIdentity(),
    currentEngineIdentity: sanmaruEngineIdentity(),
    lastLifecycleMode: resident.lastLifecycleMode || null,
    lastHotRefreshAt:resident.lastHotRefreshAt ? new Date(resident.lastHotRefreshAt).toISOString() : null,
    lastHotRefreshReason:resident.lastHotRefreshReason || null,
    engineLifecycle: "sanmaru-engine-file-upload-reboot-only-data-content-hot-refresh-otherwise",
    lifecyclePolicyApplied:true,
    deniedForceBootAt:resident.lastDeniedForceBootAt ? new Date(resident.lastDeniedForceBootAt).toISOString() : null,
    deniedForceBootReason:resident.lastDeniedForceBootReason || null,
    topRole: "global-web-ecosystem-information-cpu",
    maruRole: "mounted-gateway-body",
    dataUpdateMode: "hot-ingest-index-refresh-no-engine-reboot",
    openingSignals: openingSignalsSnapshot(),
    logosGuard: logosEvaluate([{ type:"resident_status", intent:"stewardship", truthConfidence:0.95, recoveryOpportunity:true }], "resident-status"),
    securityEvents:(globalState.securityEvents || []).slice(-10)
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
  const route = buildRoutePlanForQuery(q, { searchType, lang:opts.lang, country:firstNonEmpty(opts.country, opts.region, opts.geo, opts.ipCountry, opts.runtimeRegion) });
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
  if(p.includes("duckduckgo")) return "https://duckduckgo.com/?q=" + enc;
  if(p.includes("yahoo")) return "https://search.yahoo.com/search?p=" + enc;
  if(p.includes("baidu")) return "https://www.baidu.com/s?wd=" + enc;
  if(p.includes("yandex")) return "https://yandex.com/search/?text=" + enc;
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
      summary:"산마루 최상위 정보 레이어가 이미 알고 있는 정보원 경로입니다. 마루서치는 이 경로를 프론트로 공급하는 게이트웨이이며, 부족분은 열린 provider/API에서 보강됩니다.",
      url:routeProviderSearchUrl(provider, [q, category].filter(Boolean).join(" ")),
      link:routeProviderSearchUrl(provider, [q, category].filter(Boolean).join(" ")),
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


function buildOpeningFallbackCards(q, opts){
  opts = opts || {};
  const enc = encodeURIComponent(q || "");
  const specs = [
    ["google_web", "Google Web", "https://www.google.com/search?q=" + enc, "web"],
    ["wikipedia", "Wikipedia / Encyclopedia", "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " wikipedia encyclopedia"), "knowledge"],
    ["namu_wiki", "Namu Wiki / Korean Knowledge", "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " 나무위키 백과"), "knowledge"],
    ["naver_encyclopedia", "Naver 지식백과", "https://search.naver.com/search.naver?where=kdic&query=" + enc, "knowledge"],
    ["google_news", "Google News", "https://news.google.com/search?q=" + enc, "news"],
    ["google_image", "Google Images", "https://www.google.com/search?tbm=isch&q=" + enc, "image"],
    ["youtube", "YouTube", "https://www.youtube.com/results?search_query=" + enc, "video"],
    ["naver_web", "Naver", "https://search.naver.com/search.naver?query=" + enc, "web"],
    ["naver_news", "Naver News", "https://search.naver.com/search.naver?where=news&query=" + enc, "news"],
    ["naver_blog", "Naver Blog", "https://search.naver.com/search.naver?where=blog&query=" + enc, "blog"],
    ["duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q=" + enc, "web"],
    ["yahoo", "Yahoo", "https://search.yahoo.com/search?p=" + enc, "web"],
    ["baidu", "Baidu", "https://www.baidu.com/s?wd=" + enc, "web"],
    ["yandex", "Yandex", "https://yandex.com/search/?text=" + enc, "web"],
    ["instagram", "Instagram public route", "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:instagram.com"), "sns"],
    ["facebook", "Facebook public route", "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:facebook.com"), "sns"],
    ["tiktok", "TikTok public route", "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:tiktok.com"), "sns"],
    ["x_twitter", "X/Twitter public route", "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:x.com OR site:twitter.com"), "sns"],
    ["threads", "Threads public route", "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " site:threads.net"), "sns"],
    ["scholar", "Academic / research", "https://scholar.google.com/scholar?q=" + enc, "academic"],
    ["public_data", "Public data", "https://www.google.com/search?q=" + encodeURIComponent((q || "") + " public data government dataset"), "public_data"]
  ];
  return specs.slice(0, clampInt(opts.openingCardLimit, 15, 1, 30)).map(spec => canonicalItem({
    id:"sanmaru-opening-" + stableHash([q, spec[0]].join("|")),
    title:"[Sanmaru Opening] " + q + " · " + spec[1],
    summary:"산마루가 관리하는 열린 정보 통로입니다. 실제 provider/API가 열려 있으면 resident refresh가 결과를 흡수합니다.",
    url:spec[2], link:spec[2], source:"sanmaru_opening_" + spec[0], provider:spec[0], type:spec[3], searchCategory:spec[3], mediaType: spec[3] === "video" ? "video" : "article", score:0.39, sanmaruOpeningCard:true
  }, q, "sanmaru-opening"));
}

function supplyResidentSync(input, opts){
  opts = opts || {};
  const q = typeof input === "string" ? input : firstNonEmpty(input && input.q, input && input.query, opts.q, opts.query);
  const clean = sanitizeQuery(q);
  const activation = touchResidentSwitch({ reason:opts.reason || opts.from || "resident-supply", q:clean.value || q, warmMs:opts.warmMs });
  if(!clean.ok) return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:clean.value, items:[], results:[], meta:{ count:0, reason:clean.code, resident:residentBootSnapshot(), residentSwitch:activation } };

  const routePlan = residentRoutePlanFor(clean.value, opts);
  const searchTypeForCache = normalizeSearchType(opts.searchType || opts.type || "all");
  const exactCacheKey = residentCacheKey(clean.value, Object.assign({}, opts, { searchType:searchTypeForCache }));
  const noPageCacheKey = residentCacheKey(clean.value, Object.assign({}, opts, { searchType:searchTypeForCache, page:'', start:'' }));
  const residentStateForCache = ensureResidentState();
  const exactCacheEntry = residentStateForCache.queryMap && (residentStateForCache.queryMap.get(exactCacheKey) || residentStateForCache.queryMap.get(noPageCacheKey));
  const queryCacheHit = !!(exactCacheEntry && Array.isArray(exactCacheEntry.items) && exactCacheEntry.items.length);
  const queryCacheCount = queryCacheHit ? exactCacheEntry.items.length : 0;
  const supplyTarget = supplyTargetOf(opts, SANMARU_INSTANT_SUPPLY_TARGET);
  const frontSupplyMode = truthy(opts.frontSupply || opts.slotSupply || opts.contentSupply || opts.snapshotSupply || opts.searchbankSupply || opts.includeFrontSupply || opts.includeFrontSlots);
  const residentItems = residentCandidatesSync(clean.value, Object.assign({}, opts, { candidatePoolTarget:supplyTarget, limit:supplyTarget }))
    .map(x => canonicalItem(x, clean.value, x && x.source));
  const minVisible = clampInt(firstNonEmpty(opts.visibleNeed, opts.perPage, opts.visibleCardsPerPage), DEFAULT_VISIBLE_PER_PAGE, 1, 100);
  let indexItems = [];
  let indexMeta = { status:"not-called" };
  try{
    let IndexEngine = null;
    try { IndexEngine = require("./search-bank-index-engine"); } catch(e) { IndexEngine = null; }
    if(IndexEngine && typeof IndexEngine.query === "function"){
      const indexRes = IndexEngine.query({
        q: clean.value,
        query: clean.value,
        type: normalizeSearchType(opts.searchType || opts.type || "all"),
        limit: Math.max(minVisible, Math.min(MAX_INDEX_FAST_LIMIT, supplyTarget)),
        frontSupply: frontSupplyMode ? "1" : "0",
        includeFrontSupply: frontSupplyMode ? "1" : "0"
      });
      indexItems = normalizeItemsFromResponse(indexRes).map(x => canonicalItem(x, clean.value, "search-bank-index"));
      indexMeta = { status: indexItems.length ? "ok" : "empty", count:indexItems.length, engine:indexRes && indexRes.engine, latency:indexRes && indexRes.meta && indexRes.meta.latency, frontSupplyMode };
    }else{
      indexMeta = { status:"unavailable" };
    }
  }catch(e){
    indexMeta = { status:responseErrorCode(e) };
  }
  let routeFallbackCards = [];
  let openingFallbackCards = [];
  let providerHints = [];
  let rawItems = dedupeItems(residentItems.concat(indexItems));
  let items = finalRank(clean.value, rawItems.filter(it => isRealResultItem(it, { frontSupply:frontSupplyMode })), {
    q:clean.value,
    searchType:searchTypeForCache,
    intents:routePlan.categories || [],
    frontSupply:frontSupplyMode
  }).slice(0, supplyTarget);

  // Route/opening cards are provider road hints only. They must not be mixed into
  // public result cards or front-slot data.
  if(opts.allowRouteCards !== false && opts.noRouteCards !== true){
    routeFallbackCards = buildRouteFallbackCards(clean.value, routePlan, Object.assign({}, opts, { routeCardLimit: clampInt(opts.routeCardLimit, 28, 1, 60) }));
  }
  if(opts.allowOpeningCards !== false && opts.noOpeningCards !== true){
    openingFallbackCards = buildOpeningFallbackCards(clean.value, Object.assign({}, opts, { openingCardLimit: clampInt(opts.openingCardLimit, 24, 1, 40) }));
  }
  providerHints = dedupeItems(routeFallbackCards.concat(openingFallbackCards));

  const fullCandidateItems = items.slice(0, supplyTarget);
  const requestedPage = clampInt(firstNonEmpty(opts.page, opts.p, opts.visiblePage, opts.sectionPage), 1, 1, 100000);
  const perPage = clampInt(firstNonEmpty(opts.perPage, opts.pageSize, opts.visibleCardsPerPage, opts.visibleLimit), DEFAULT_VISIBLE_PER_PAGE, 1, 100);
  const firstResponseWindow = Math.max(perPage, Math.min(
    Math.max(
      perPage * 12,
      clampInt(firstNonEmpty(opts.firstPaintLimit, opts.initialRenderTarget, opts.initialPreloadTarget, opts.limit, opts.candidatePoolTarget), perPage * 12, perPage, MAX_LIMIT)
    ),
    MAX_LIMIT
  ));
  const offset = (requestedPage - 1) * perPage;
  const responseItems = requestedPage <= 1
    ? fullCandidateItems.slice(0, Math.min(fullCandidateItems.length, firstResponseWindow))
    : fullCandidateItems.slice(offset, offset + perPage);
  items = responseItems.length ? responseItems : fullCandidateItems.slice(0, Math.min(fullCandidateItems.length, minVisible));
  const totalCandidates = fullCandidateItems.length;
  const totalPages = totalCandidates ? Math.min(SANMARU_MAX_PAGER_PAGES, Math.max(1, Math.ceil(totalCandidates / perPage))) : 0;
  const cacheKey = queryCacheHit ? (exactCacheKey || noPageCacheKey) : (rememberResidentQueryCache(clean.value, opts, fullCandidateItems) || residentCacheKey(clean.value, opts));

  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    query:clean.value,
    source:items.length ? "sanmaru-resident" : null,
    items,
    results:items,
    providerHints,
    routePlan,
    meta:{
      count:items.length,
      totalCandidates,
      fullCandidateCount:totalCandidates,
      supplyTarget,
      instantSupplyCapacityTarget:SANMARU_INSTANT_SUPPLY_TARGET,
      extendedSupplyCapacityTarget:SANMARU_EXTENDED_SUPPLY_TARGET,
      responseWindowCount:items.length,
      page:requestedPage,
      perPage,
      totalPages,
      pagedCandidatePool:true,
      maxPagerPages:SANMARU_MAX_PAGER_PAGES,
      realResidentCount:residentItems.length,
      searchBankIndex:indexMeta,
      routeFallbackCount:routeFallbackCards.length,
      openingFallbackCount:openingFallbackCards.length,
      providerHintCount:providerHints.length,
      frontSupplyMode,
      supplyReadiness:{ target:supplyTarget, available:totalCandidates, shortage:Math.max(0, supplyTarget - totalCandidates), realItemsOnly:true, providerHintsExcludedFromItems:true },
      queryCacheHit,
      cachedQueryHit:queryCacheHit,
      fromQueryCache:queryCacheHit,
      queryCacheCount,
      cacheKey,
      resident:residentBootSnapshot(),
      residentSwitch:activation,
      routePlan,
      providerHealth:providerHealthSnapshot(),
      sourceRegistryReady:true,
      categoryBrainReady:true,
      providerCapabilityReady:true,
      mode:"resident-switch-instant-supply-os",
      visibleCardsPerPage:perPage,
      lifecyclePolicy:"engine-code-upload-only-reboot-hot-data-refresh-otherwise",
      doesNotCallExternal:true,
      supplyContract:{
        owner:"sanmaru-global-web-information-cpu",
        maruRole:"mounted-gateway-ui-body",
        itemResults:"real-resident-index-candidate-pool-only",
        viewport:"page-sized-current-render-window",
        perPage,
        noProviderRescanWhenBroadQueryCacheCovered:true,
        noProviderRescanWhenViewportCovered:false,
        expansion:"ranked-real-items-plus-separated-provider-hints"
      },
      logosGuard: logosEvaluate(logosSignalsForQuery(clean.value, { queryRisk:null }), "resident-supply"),
      openingSignals: openingSignalsSnapshot(),
      note:"Sanmaru owns routing/provider-health/category/index/cache as the top information CPU. Maru Search is the mounted gateway/body. Provider re-scan is skipped only when Sanmaru already has a broad query cache; thin route/index cards never suppress Google/Naver/SNS/category expansion."
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
    skipPlanetary:"1",
    forceWide:"1",
    waitProviders:"1",
    deepRefresh:"1",
    disableInstantSupply:"1"
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


function getLogosEngine(){
  if(!globalState.logosEngine && LogosEngineClass){
    try { globalState.logosEngine = new LogosEngineClass(); } catch(e) { globalState.logosEngine = null; }
  }
  return globalState.logosEngine;
}

function logosEvaluate(signals, reason){
  const list = Array.isArray(signals) ? signals : [];
  const engine = getLogosEngine();
  if(!engine || !list.length){
    return { enabled: !!engine, version: engine ? "maru-logos-engine" : "unavailable", direction:"neutral", ethicalScore:1, reason:reason || "no-signals" };
  }
  try{
    const res = engine.run(list);
    return {
      enabled:true,
      version:res && res.version,
      direction:res && res.strategy && res.strategy.direction || "neutral",
      ethicalScore:res && res.strategy && res.strategy.ethicalScore,
      narrativeVector:res && res.strategy && res.strategy.narrativeVector,
      reason:reason || "logos-guard"
    };
  }catch(e){
    return { enabled:false, direction:"neutral", ethicalScore:1, reason:"logos-error", error:responseErrorCode(e) };
  }
}

function logosSignalsForQuery(q, ctx){
  const text = low(q);
  const signals = [{ type:"information_request", intent:"search", truthConfidence:0.9, recoveryOpportunity:true }];
  if(ctx && ctx.queryRisk) signals.push({ type:"manipulation", manipulationRisk:true, truthConfidence:0.35 });
  if(/폭력|테러|자살|해킹|malware|exploit|credential|token|secret|bypass|침투|탈취/.test(text)){
    signals.push({ type:"conflict", intent:"harm", manipulationRisk:true, lifeImpact:-1, truthConfidence:0.45 });
  }
  return signals;
}

function requestHeaders(event){ return (event && event.headers) || {}; }
function requestMethod(event){ return s(event && event.httpMethod || "GET").toUpperCase(); }
function requestToken(event, params){
  const h = requestHeaders(event);
  const auth = firstNonEmpty(h.authorization, h.Authorization);
  const bearer = auth && /^Bearer\s+(.+)$/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  return firstNonEmpty(
    params && (params.adminToken || params.token || params.sanmaruAdminToken || params.maruAdminToken),
    h["x-sanmaru-admin-token"], h["X-Sanmaru-Admin-Token"], h["x-maru-admin-token"], h["X-Maru-Admin-Token"],
    bearer
  );
}
function adminTokenExpected(){ return firstNonEmpty(process.env.SANMARU_ADMIN_TOKEN, process.env.MARU_ADMIN_TOKEN, process.env.ADMIN_TOKEN); }
function isAuthorizedAdmin(event, params){
  const expected = adminTokenExpected();
  if(!expected) return false;
  const got = requestToken(event, params);
  if(!got) return false;
  try{
    const a = Buffer.from(s(got));
    const b = Buffer.from(s(expected));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }catch(e){ return false; }
}
function adminRequiredAction(action){
  return ["resident-rebuild","rebuild-resident","deep-refresh","resident-refresh","promote","ingest","upsert","hydrate","build","rebuild","export","download","archive","zip","source-dump","dump"].includes(low(action));
}
function suspiciousRequestReason(event, params, action){
  const joined = low([action, params && params.action, params && params.mode, params && params.fn, params && params.format, params && params.download, params && params.export, params && params.archive, params && params.zip, params && params.source, params && params.path].join(" "));
  if(/source[-_ ]?dump|download|archive|zip|tar|backup|\.env|secret|token|private[_-]?key|process\.env/.test(joined)) return "suspicious-source-or-secret-access";
  if(requestMethod(event) === "POST" && adminRequiredAction(action) && !isAuthorizedAdmin(event, params)) return "admin-token-required";
  if(adminRequiredAction(action) && !isAuthorizedAdmin(event, params)) return "admin-token-required";
  return "";
}
function recordSecurityEvent(event, params, action, reason){
  const entry = { t:nowIso(), action:action || "", reason:reason || "", ip:clientIp(event), ua:firstNonEmpty(requestHeaders(event)["user-agent"], requestHeaders(event)["User-Agent"]).slice(0,120) };
  globalState.securityEvents = globalState.securityEvents || [];
  globalState.securityEvents.push(entry);
  if(globalState.securityEvents.length > 200) globalState.securityEvents.shift();
  return entry;
}
function guardRequest(event, params, action){
  const reason = suspiciousRequestReason(event, params || {}, action || "");
  if(!reason) return { allowed:true, reason:"ok", admin:isAuthorizedAdmin(event, params || {}) };
  const eventLog = recordSecurityEvent(event, params || {}, action || "", reason);
  return { allowed:false, status:"blocked", reason, admin:false, event:eventLog, safeMode:"fail-closed-read-only" };
}

function openingSignalsSnapshot(){
  const signals = [];
  function add(provider, state, reason, extra){ signals.push(Object.assign({ provider, state, reason }, extra || {})); }
  const googleKey = sanmaruEnvHas('GOOGLE_API_KEY','GOOGLE_SEARCH_API_KEY');
  const googleCx = sanmaruEnvHas('GOOGLE_CSE_ID','GOOGLE_CX','GOOGLE_SEARCH_ENGINE_ID');
  const naverKey = sanmaruEnvHas('NAVER_API_KEY','NAVER_CLIENT_ID');
  const naverSecret = sanmaruEnvHas('NAVER_CLIENT_SECRET','NAVER_API_SECRET');
  add("google", googleKey && googleCx ? "active" : "reserved", googleKey ? (googleCx ? "key-and-cse-present" : "cse-missing") : "key-missing", { keyPresent:googleKey, csePresent:googleCx });
  add("naver", naverKey && naverSecret ? "active" : "reserved", naverKey ? (naverSecret ? "key-and-secret-present" : "secret-missing") : "key-missing", { keyPresent:naverKey, secretPresent:naverSecret });
  add("bing", sanmaruEnvHas('BING_API_KEY','BING_SEARCH_API_KEY','AZURE_BING_SEARCH_API_KEY') ? "active" : "reserved", sanmaruEnvHas('BING_API_KEY','BING_SEARCH_API_KEY','AZURE_BING_SEARCH_API_KEY') ? "key-present" : "key-missing");
  add("youtube", sanmaruEnvHas('YOUTUBE_API_KEY') ? "active" : "reserved", sanmaruEnvHas('YOUTUBE_API_KEY') ? "key-present" : "key-missing-or-using-public-route");
  add("ai-gpu", sanmaruEnvHas('OPENAI_API_KEY','AI_PROVIDER_KEY','SANMARU_AI_GPU_ENABLED') ? "active" : "reserved", "provider-env-signal");
  for(const file of residentFileCandidates()){
    try{ if(fs.existsSync(file)) add("resident-file", "active", path.basename(file), { path:path.basename(file) }); }catch(e){}
  }
  return signals;
}

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
  const qs = (event && event.queryStringParameters) || {};
  const forcedCountry = normalizeCountryCode(firstNonEmpty(qs.country, qs.region, qs.geo));
  if(forcedCountry) return forcedCountry;
  const headerCountry = normalizeCountryCode(firstNonEmpty(
    headers["x-country"], headers["X-Country"],
    headers["cf-ipcountry"], headers["CF-IPCountry"],
    headers["x-vercel-ip-country"], headers["X-Vercel-IP-Country"],
    headers["cloudfront-viewer-country"], headers["CloudFront-Viewer-Country"],
    headers["x-appengine-country"], headers["X-AppEngine-Country"],
    headers["x-geo-country"], headers["X-Geo-Country"],
    headers["x-client-country"], headers["X-Client-Country"],
    headers["x-forwarded-country"], headers["X-Forwarded-Country"]
  ));
  if(headerCountry) return headerCountry;
  const explicit = detectExplicitCountryFromQuery(queryText);
  if(explicit) return explicit;
  const l = low(lang || headers["accept-language"] || headers["Accept-Language"] || "");
  return countryFromLang(l) || "GLOBAL";
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
    site:"site",
    homepage:"site",
    company:"site",
    corporate:"site",
    business:"site",
    image:"media",
    video:"media",
    media:"media",
    sns:"social",
    social:"social",
    blog:"community",
    cafe:"community",
    community:"community",
    knowledge:"knowledge",
    book:"book",
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

  if(/\.gov\b|\.go\.kr\b|\.edu\b|korea\.kr/.test(url)) return "official";
  if(source.includes("local") || type === "map" || type === "local" || /map|지도|주소|위치/.test(text)) return "map";
  if(type === "knowledge" || source.includes("encyc") || source.includes("wiki") || /wikipedia\.org|namu\.wiki|britannica\.com/.test(url)) return "knowledge";
  if(type === "site" || type === "homepage" || type === "business" || source.includes("homepage") || source.includes("corporate") || source.includes("company") || source.includes("business") || /홈페이지|공식사이트|공식 사이트|기업|회사|corporate|company|business/.test(text)) return "site";
  if(type === "book" || source.includes("book") || /도서|책|isbn|book/.test(text)) return "book";
  if(source.includes("news") || type === "news") return "news";
  if(type === "blog" || source.includes("blog")) return "blog";
  if(type === "cafe" || source.includes("cafe") || source.includes("forum")) return "cafe";
  if(type === "shopping" || type === "product" || source.includes("shopping") || /쇼핑|상품|구매|가격/.test(text)) return "shopping";
  if(type === "finance" || source.includes("finance") || /금융|증권|주식|환율/.test(text)) return "finance";
  if(type === "sports" || source.includes("sports") || /스포츠|축구|야구|농구/.test(text)) return "sports";
  if(type === "webtoon" || /웹툰|webtoon|comic|manga/.test(text)) return "webtoon";
  if(source.includes("youtube") || type === "video" || url.includes("youtube.com/watch") || url.includes("youtu.be/")) return "video";
  if(source.includes("image") || type === "image") return "image";
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

function isPlaceholderUrlValue(url){
  const u = low(url);
  return !u || u === "#" || u === "/" || u === "javascript:void(0)" || u.startsWith("javascript:");
}

function hasRealSlotContent(it){
  if(!it || typeof it !== "object") return false;
  return !!firstNonEmpty(
    it.title, it.name, it.label, it.heading,
    it.summary, it.snippet, it.description, it.content, it.text,
    it.thumbnail, it.thumb, it.image, it.imageUrl, it.cover,
    it.page, it.section, it.route, it.path, it.psom_key,
    it.bind && it.bind.page, it.bind && it.bind.section
  );
}

function residentStableItemKey(it){
  const realUrl = !isPlaceholderUrlValue(firstNonEmpty(it && it.url, it && it.link))
    ? firstNonEmpty(it && it.url, it && it.link)
    : "";
  return low(firstNonEmpty(
    realUrl,
    it && it.id,
    it && it.indexId,
    [
      it && it.title,
      it && it.source,
      it && it.provider,
      it && it.page,
      it && it.section,
      it && it.route,
      it && it.lang,
      it && it.thumbnail,
      it && it.image,
      it && it.summary
    ].filter(Boolean).join("|")
  ));
}

function isPlaceholderItem(it){
  const text = low(itemText(it));
  const url = low(firstNonEmpty(it && it.url, it && it.link));
  if(!text && !url) return true;
  if(/seed placeholder|movie slot|mediamovie0|dummy item|sample item|test item|lorem ipsum/.test(text)) return true;
  // Search Bank / Snapshot slot data often uses url:"#" while still carrying
  // real front-page content. Do not drop those slots just because the URL is a
  // placeholder. Only reject placeholder URLs when there is no real slot content.
  if(isPlaceholderUrlValue(url) && !hasRealSlotContent(it)) return true;
  return false;
}

function isFrontSupplyLikeItem(it){
  it = it || {};
  const bind = it.bind && typeof it.bind === "object" ? it.bind : {};
  const lp = it.layerPointer && typeof it.layerPointer === "object" ? it.layerPointer : {};
  const layerRole = low(firstNonEmpty(lp.layerRole, it.layerRole));
  const page = firstNonEmpty(lp.page, it.page, it.route, it.path, bind.page, bind.route);
  const section = firstNonEmpty(lp.section, it.section, it.psom_key, bind.section, bind.key);
  const slot = firstNonEmpty(lp.slotKey, it.slotKey, it.slot, bind.slotKey, bind.slot);
  const sourceText = low([
    it.source, it.provider, it.engine, it._sourceHint, it.indexSource, it.sourceFile,
    lp.source, it.generatedBy, it.storageSource, it.id
  ].filter(Boolean).join(" "));
  const frontText = low([page, section, slot, it.psom_key, it.slotKey].filter(Boolean).join(" "));
  if(layerRole === "front-supply-layer") return true;
  if(/search-bank\.snapshot|snapshot-object|snapshot-array|front-data-ingested|front-supply|slot-supply|automap/.test(sourceText) && (page || section || slot)) return true;
  if(/search-bank|snapshot|front|slot/.test(sourceText) && /home|network|distribution|social|media|tour|literature|academic|donation|front|slot/.test(frontText)) return true;
  return false;
}

function isRoadHintItem(it){
  it = it || {};
  const src = low(firstNonEmpty(it.source, it.provider, it.generatedBy, it.sourceType));
  return !!(
    it.sanmaruRouteCard || it.sanmaruOpeningCard || it.passthrough ||
    /sanmaru-route|sanmaru-opening|provider-passthrough|provider-page-window|provider-window/.test(src)
  );
}

function hasRenderableSummary(it){
  it = it || {};
  return compactSpaces(stripHtml(firstNonEmpty(it.summary, it.snippet, it.description, it.content, it.text))).length >= 16;
}

function hasRenderableMedia(it){
  it = it || {};
  return !!firstNonEmpty(it.thumbnail, it.thumb, it.image, it.imageUrl, it.cover, Array.isArray(it.imageSet) && it.imageSet[0]);
}

function isRealResultItem(it, opts){
  opts = opts || {};
  if(!it || typeof it !== "object") return false;
  if(isRoadHintItem(it)) return false;
  const frontLike = isFrontSupplyLikeItem(it);
  if(frontLike && !opts.frontSupply) return false;
  if(isPlaceholderItem(it) && !(opts.frontSupply && hasRealSlotContent(it))) return false;
  const title = compactSpaces(stripHtml(firstNonEmpty(it.title, it.name, it.label)));
  const url = firstNonEmpty(it.url, it.link, it.href);
  const hasUrl = !isPlaceholderUrlValue(url);
  const hasBody = hasRenderableSummary(it);
  const hasMedia = hasRenderableMedia(it);
  if(!title && !hasUrl) return false;
  if(opts.frontSupply) return !!(title || hasBody || hasMedia || hasRealSlotContent(it));
  return !!(hasUrl || hasBody || hasMedia);
}

function supplyTargetOf(opts, fallback){
  opts = opts || {};
  return clampInt(
    firstNonEmpty(opts.candidatePoolTarget, opts.supplyTarget, opts.instantSupplyTarget, opts.maxSupply, opts.limit),
    fallback || SANMARU_INSTANT_SUPPLY_TARGET,
    MIN_FAST_TARGET,
    MAX_LIMIT
  );
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
    displayGroupPreviewLimit: it.displayGroupPreviewLimit || ({ authority:3, local_tour:2, knowledge:4, site:5, book:4, news:5, community:5, media:5, social:4, shopping:4, sports:3, finance:3, webtoon:3 }[displayGroupForCategory(category)] || 5),
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
    const key = residentStableItemKey(raw);
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
      perPage: ctx.perPage || DEFAULT_VISIBLE_PER_PAGE,
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
    if(typeof mod.runEngine === "function") res = await withTimeout(mod.runEngine(Object.assign({}, ctx.event || {}, { __sanmaruInternal:true }), payload), 1000);
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
    publicSearch: truthy(ctx.publicSearch || raw.publicSearch || qs.publicSearch),
    openPipe: truthy(ctx.openPipe || raw.openPipe || qs.openPipe || ctx.streamFullWindow || raw.streamFullWindow || qs.streamFullWindow || ctx.naturalFlow || raw.naturalFlow || qs.naturalFlow),
    noRouteCards: truthy(ctx.noRouteCards || raw.noRouteCards || qs.noRouteCards),
    noOpeningCards: truthy(ctx.noOpeningCards || raw.noOpeningCards || qs.noOpeningCards),
    externalOff,
    externalForced,
    externalAllowed: !externalOff,
    timeoutMs: clampInt(ctx.timeoutMs || raw.timeoutMs || qs.timeoutMs, deep ? DEEP_TIMEOUT_MS : DEFAULT_TIMEOUT_MS, 1500, deep ? 15000 : 12000),
    region: detectRuntimeRegion(event, lang, clean.value),
    page: clampInt(firstNonEmpty(ctx.page, raw.page, qs.page), 1, 1, 100000),
    perPage: clampInt(firstNonEmpty(ctx.perPage, raw.perPage, qs.perPage), DEFAULT_VISIBLE_PER_PAGE, 1, 200),
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

  const logosGuard = logosEvaluate(logosSignalsForQuery(ctx.q, ctx), "runSanmaru");
  if(ctx.queryRisk && logosGuard && logosGuard.direction === "risk_containment"){
    return { status:"blocked", engine:ENGINE_NAME, version:VERSION, query:ctx.q, items:[], results:[], meta:{ count:0, reason:"logos-risk-containment", secure:true, logosGuard } };
  }

  const ip = clientIp(ctx.event);
  if(!rateLimitOk(ip)){
    return { status:"blocked", engine:ENGINE_NAME, version:VERSION, query:ctx.q, items:[], results:[], meta:{ count:0, reason:"rate_limit", secure:true } };
  }

  globalState.cache = globalState.cache || new Map();
  globalState.inflight = globalState.inflight || new Map();

  const instantSupplyDisabled = truthy(ctx.disableInstantSupply || ctx.raw.disableInstantSupply || ctx.raw.noInstantSupply || ctx.raw.noInstant || ctx.raw.waitProviders || ctx.raw.waitExternal || ctx.raw.forceWide || ctx.raw.forceProviderRefresh || ctx.raw.deepRefresh || ctx.raw.live);
  const sanmaruInstantSupply = !instantSupplyDisabled && !ctx.deep && !ctx.externalForced;

  if(sanmaruInstantSupply){
    ensureResidentBoot({ reason:"runSanmaru-instant-supply" });
    const supplied = supplyResidentSync({ q:ctx.q, query:ctx.q }, {
      reason:"runSanmaru-default-instant-supply",
      limit:ctx.limit,
      candidatePoolTarget:ctx.candidatePoolTarget,
      searchType:ctx.searchType,
      type:ctx.searchType,
      lang:ctx.lang,
      page:ctx.page,
      perPage:ctx.perPage,
      visibleNeed:ctx.perPage || DEFAULT_VISIBLE_PER_PAGE,
      allowRouteCards:!(ctx.noRouteCards || ctx.publicSearch || ctx.openPipe),
      allowOpeningCards:!(ctx.noOpeningCards || ctx.publicSearch || ctx.openPipe)
    });
    let instantItems = Array.isArray(supplied && supplied.items) ? supplied.items : [];
    const finalTarget = Math.min(MAX_LIMIT, Math.max(ctx.limit, ctx.candidatePoolTarget || 0, MIN_FAST_TARGET));
    instantItems = finalRank(ctx.q, instantItems, ctx).slice(0, finalTarget).map(it => {
      const copy = Object.assign({}, it);
      delete copy._sanmaruSeq;
      delete copy._sanmaruRejectedReason;
      return copy;
    });
    const result = Object.assign({}, supplied, {
      source: instantItems.length ? "sanmaru-instant-supply" : null,
      items: instantItems,
      results: instantItems,
      meta: Object.assign({}, supplied.meta || {}, {
        count: instantItems.length,
        requestedLimit: ctx.limit,
        finalTarget,
        elapsedMs: nowMs() - engineStarted,
        defaultInstantSupply:true,
        mode:"sanmaru-instant-resident-index-supply",
        searchExecutionOwner:"sanmaru",
        maruSearchRole:"gateway-body-render-only",
        doesNotCallExternal:true,
        directExternalAdaptersEnabled:false,
        routePlan: supplied.routePlan || buildRoutePlanForQuery(ctx.q, { searchType:ctx.searchType, lang:ctx.lang, country:ctx.region, runtimeRegion:ctx.region }),
        logosGuard,
        health: healthSnapshot(),
        cache:{ hit:false, key:null, policy:"instant-supply-before-wide-refresh" },
        external:{ allowed:false, forced:false, deep:false, selected:[], trace:[] },
        trace:[].concat((supplied.meta && supplied.meta.trace) || [], [{
          name:"sanmaru-instant-supply",
          status: instantItems.length ? "ok" : "empty",
          count: instantItems.length,
          mode:"resident-index-route-map-no-provider-wait",
          principle:"query-response-is-served-by-sanmaru-immediately; wide provider refresh is explicit/background-only"
        }])
      })
    });
    return result;
  }

  const cacheKey = stableHash([ctx.q, ctx.limit, ctx.candidatePoolTarget || "", ctx.page || 1, ctx.perPage || DEFAULT_VISIBLE_PER_PAGE, ctx.searchType, ctx.lang || "", searchAreaExpansionMode(ctx), ctx.deep ? "deep" : "normal", ctx.externalOff ? "off" : (ctx.externalForced ? "force" : "auto"), ctx.noMedia ? "nomedia" : "media"].join("|"));
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
    const routePlan = buildRoutePlanForQuery(ctx.q, { searchType:ctx.searchType, lang:ctx.lang, country:ctx.region, runtimeRegion:ctx.region });
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
        routePlan: ctx.routePlan || buildRoutePlanForQuery(ctx.q, { searchType:ctx.searchType, lang:ctx.lang, country:ctx.region, runtimeRegion:ctx.region }),
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
        logosGuard,
        openingSignals: openingSignalsSnapshot(),
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
          routePlan: buildRoutePlanForQuery(ctx.q, { searchType:ctx.searchType, lang:ctx.lang, country:ctx.region, runtimeRegion:ctx.region }),
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
    openingSignals: openingSignalsSnapshot(),
    logosGuard: logosEvaluate([{ type:"health", intent:"stewardship", truthConfidence:0.95, recoveryOpportunity:true }], "health"),
    securityEvents:(globalState.securityEvents || []).slice(-20),
    lifecyclePolicy:"sanmaru-engine-file-upload-reboot-only; other file/data/content changes use hot refresh/index rebuild",
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


// Sanmaru OSAI front-gateway helpers -------------------------------------------------
// These helpers keep Sanmaru's broad global information OS role intact while making
// front-slot supply deterministic: IndexEngine exact section first, same page second,
// global/resident fallback only when explicitly needed by shortage.
function sanmaruFrontRouteKey(v){
  let x = low(v);
  if(!x) return "";
  x = x.replace(/^https?:\/\/[^/]+/i, "");
  x = x.replace(/[?#].*$/g, "");
  x = x.replace(/\.html?$/i, "");
  x = x.replace(/^\/+|\/+$/g, "");
  x = x.replace(/\s+/g, "-");
  x = x.replace(/_/g, "-");
  return x;
}
function sanmaruAddAlias(set, v){
  const k = sanmaruFrontRouteKey(v);
  if(!k) return;
  set.add(k);
  set.add(k.replace(/-/g, "_"));
  set.add(k.replace(/_/g, "-"));
}
function sanmaruFrontPageCanonical(v){
  const k = sanmaruFrontRouteKey(v);
  if(!k || k === "snapshot-object" || k === "snapshot-array" || k === "items" || k === "results") return "";
  if(k === "index" || k === "main" || k === "front" || k === "web" || k === "home" || /^home(?:-|$)/.test(k)) return "home";
  if(k === "networkhub" || k === "network-hub" || /^network(?:-|$)/.test(k) || /market|rightpanel|right-panel/.test(k)) return "networkhub";
  if(k === "distributionhub" || k === "distribution-hub" || /^distribution(?:-|$)/.test(k) || /^dist[0-9]+$/.test(k) || /commerce|product|shopping|shop/.test(k)) return "distributionhub";
  if(k === "socialnetwork" || k === "social-network" || /^social(?:-|$)/.test(k) || /sns|youtube|instagram|tiktok|facebook|wechat|weibo|pinterest|reddit|twitter|x-com/.test(k)) return "socialnetwork";
  if(k === "mediahub" || k === "media-hub" || /^media(?:-|$)/.test(k) || /movie|drama|thriller|romance|variety|documentary|animation|music|shorts|video/.test(k)) return "mediahub";
  if(k === "tour" || /^tour(?:-|$)/.test(k) || /travel|tourism|hotel|trip|local-tour/.test(k)) return "tour";
  if(k === "donation" || /^donation(?:-|$)/.test(k) || /ngo|mission|service|relief|education|environment/.test(k)) return "donation";
  if(k === "literature-academic" || k === "literature_academic" || /^academic(?:-|$)/.test(k) || /^literature(?:-|$)/.test(k) || /culture|arts|humanities|scholar|research|paper|book/.test(k)) return "literature_academic";
  return k;
}
function sanmaruFrontPageHintFromSection(v){
  const k = sanmaruFrontRouteKey(v);
  if(!k) return "";
  if(/^home(?:-|$)|^home-right/.test(k)) return "home";
  if(/^network(?:-|$)|rightpanel|right-panel/.test(k)) return "networkhub";
  if(/^distribution(?:-|$)|^dist[0-9]+$/.test(k)) return "distributionhub";
  if(/^social(?:-|$)/.test(k)) return "socialnetwork";
  if(/^media(?:-|$)|movie|drama|thriller|romance|variety|documentary|animation|music|shorts/.test(k)) return "mediahub";
  if(/^tour(?:-|$)/.test(k)) return "tour";
  if(/^donation(?:-|$)|ngo|mission|service|relief|education|environment/.test(k)) return "donation";
  if(/^academic(?:-|$)|^literature(?:-|$)|arts|humanities/.test(k)) return "literature_academic";
  return "";
}
const SANMARU_FRONT_SECTION_ALIAS_PAIRS = [
  ["dist1", "distribution-recommend"], ["dist2", "distribution-sponsor"],
  ["dist3", "distribution-trending"], ["dist4", "distribution-new"],
  ["dist5", "distribution-special"], ["dist6", "distribution-others"], ["dist7", "distribution-right"],
  ["rightpanel", "rightPanel"], ["right-panel", "rightPanel"],
  ["maru-channel", "social-maru"], ["youtube", "social-youtube"], ["instagram", "social-instagram"],
  ["tiktok", "social-tiktok"], ["facebook", "social-facebook"], ["wechat", "social-wechat"],
  ["weibo", "social-weibo"], ["pinterest", "social-pinterest"], ["reddit", "social-reddit"],
  ["twitter", "social-twitter"], ["x", "social-twitter"], ["movie", "media-movie"],
  ["drama", "media-drama"], ["thriller", "media-thriller"], ["romance", "media-romance"],
  ["variety", "media-variety"], ["documentary", "media-documentary"], ["animation", "media-animation"],
  ["music", "media-music"], ["shorts", "media-shorts"]
];
function sanmaruSectionAliasSet(v){
  const set = new Set();
  const raw = Array.isArray(v) ? v : [v];
  for(const x of raw){
    if(x == null) continue;
    const parts = s(x).split(/[\s,|]+/).filter(Boolean);
    for(const p of parts.length ? parts : [x]) sanmaruAddAlias(set, p);
  }
  let changed = true;
  while(changed){
    changed = false;
    for(const pair of SANMARU_FRONT_SECTION_ALIAS_PAIRS){
      const a = sanmaruFrontRouteKey(pair[0]);
      const b = sanmaruFrontRouteKey(pair[1]);
      if(set.has(a) && !set.has(b)){ sanmaruAddAlias(set, b); changed = true; }
      if(set.has(b) && !set.has(a)){ sanmaruAddAlias(set, a); changed = true; }
    }
  }
  return set;
}
function sanmaruPageAliasSet(v){
  const set = new Set();
  const raw = Array.isArray(v) ? v : [v];
  for(const x of raw){
    if(x == null) continue;
    const parts = s(x).split(/[\s,|]+/).filter(Boolean);
    for(const p of parts.length ? parts : [x]){
      const canonical = sanmaruFrontPageCanonical(p) || sanmaruFrontPageHintFromSection(p);
      sanmaruAddAlias(set, canonical || p);
      if(canonical === "home") ["home.html", "index", "front", "web"].forEach(a => sanmaruAddAlias(set, a));
      if(canonical === "networkhub") ["network", "networkhub.html", "market", "network-right"].forEach(a => sanmaruAddAlias(set, a));
      if(canonical === "distributionhub") ["distribution", "distributionhub.html", "commerce", "product"].forEach(a => sanmaruAddAlias(set, a));
      if(canonical === "socialnetwork") ["social", "socialnetwork.html", "sns"].forEach(a => sanmaruAddAlias(set, a));
      if(canonical === "mediahub") ["media", "mediahub.html", "video"].forEach(a => sanmaruAddAlias(set, a));
      if(canonical === "literature_academic") ["literature", "academic", "literature_academic.html"].forEach(a => sanmaruAddAlias(set, a));
    }
  }
  return set;
}
function sanmaruSetIntersects(a, b){
  if(!a || !b || !a.size || !b.size) return false;
  for(const x of a){ if(b.has(x)) return true; }
  return false;
}
function sanmaruFrontTarget(opts){
  opts = opts || {};
  const section = firstNonEmpty(opts.section, opts.psom_key, opts.psomKey, opts.slot, opts.slotKey, opts.targetSection, opts.targetSlot, opts.key, opts.category);
  const page = firstNonEmpty(opts.page, opts.targetPage, opts.route, opts.hub, opts.channel, opts.frontPage, opts.pageKey);
  const sectionAliases = sanmaruSectionAliasSet(section);
  const pageAliases = sanmaruPageAliasSet(page);
  for(const sec of Array.from(sectionAliases)){
    const inferred = sanmaruFrontPageHintFromSection(sec);
    if(inferred) sanmaruAddAlias(pageAliases, inferred);
  }
  return { page, section, pageAliases, sectionAliases, hasPage:pageAliases.size>0, hasSection:sectionAliases.size>0, hasTarget:pageAliases.size>0 || sectionAliases.size>0 };
}
function sanmaruFrontItemRouteSets(item){
  item = item || {};
  const bind = item.bind && typeof item.bind === "object" ? item.bind : {};
  const lp = item.layerPointer && typeof item.layerPointer === "object" ? item.layerPointer : {};
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const sectionValues = [lp.section, lp.slotKey, item.section, item.psom_key, item.slotKey, item.slot, bind.section, bind.key, bind.slot, bind.slotKey, item.category].concat(tags);
  const pageValues = [lp.page, lp.route, item.page, item.route, item.path, bind.page, bind.route].concat(tags, sectionValues.map(sanmaruFrontPageHintFromSection));
  return { pageAliases:sanmaruPageAliasSet(pageValues), sectionAliases:sanmaruSectionAliasSet(sectionValues) };
}
function sanmaruFrontTargetBucket(item, target){
  if(!target || !target.hasTarget) return "global";
  const routes = sanmaruFrontItemRouteSets(item);
  const sectionMatch = target.hasSection && sanmaruSetIntersects(routes.sectionAliases, target.sectionAliases);
  const pageMatch = target.hasPage && sanmaruSetIntersects(routes.pageAliases, target.pageAliases);
  if(target.hasSection){
    if(sectionMatch) return "exact";
    if(pageMatch) return "page-fallback";
    return "global-fallback";
  }
  if(target.hasPage){
    if(pageMatch) return "exact";
    return "global-fallback";
  }
  return "global";
}
function sanmaruNormalizeIndexFrontItems(res, q, target){
  return normalizeItemsFromResponse(res).map(x => {
    const item = canonicalItem(x, q, firstNonEmpty(x && x.source, x && x.provider, "search-bank-index"));
    item.frontRouteBucket = firstNonEmpty(item.frontRouteBucket, sanmaruFrontTargetBucket(item, target));
    item.sanmaruFrontGateway = true;
    item.sanmaruOsaiRouted = true;
    return item;
  });
}
function sanmaruFrontFallbackPartition(items, target){
  const exact = [], pageFallback = [], globalFallback = [];
  for(const item of (Array.isArray(items) ? items : [])){
    const bucket = sanmaruFrontTargetBucket(item, target);
    const copy = Object.assign({}, item, { frontRouteBucket: firstNonEmpty(item && item.frontRouteBucket, bucket), sanmaruFrontGatewayFallback:true });
    if(bucket === "exact" || !target || !target.hasTarget) exact.push(copy);
    else if(bucket === "page-fallback") pageFallback.push(copy);
    else globalFallback.push(copy);
  }
  return { exact, pageFallback, globalFallback };
}
function sanmaruCallIndexFrontSupply(q, opts, target, requestedLimit){
  const started = nowMs();
  try{
    let IndexEngine = null;
    try { IndexEngine = require("./search-bank-index-engine"); } catch(e) { IndexEngine = null; }
    if(!IndexEngine) return { status:"unavailable", items:[], meta:{ latency:nowMs()-started } };
    const params = {
      action:"front-supply",
      q:q,
      query:q,
      page:firstNonEmpty(opts.page, opts.targetPage, opts.route, opts.hub, opts.channel, target && target.page),
      section:firstNonEmpty(opts.section, opts.slot, opts.psom_key, opts.psomKey, opts.slotKey, opts.targetSection, target && target.section),
      psom_key:firstNonEmpty(opts.psom_key, opts.psomKey, opts.section, opts.slot, opts.slotKey),
      slot:firstNonEmpty(opts.slot, opts.slotKey, opts.section, opts.psom_key),
      limit:requestedLimit,
      frontSupply:"1",
      slotSupply:"1",
      includeFrontSupply:"1",
      from:"sanmaru",
      noExternal:"1",
      skipSanmaru:"1"
    };
    let res = null;
    if(typeof IndexEngine.buildFrontSupplyPool === "function") res = IndexEngine.buildFrontSupplyPool(params);
    else if(typeof IndexEngine.query === "function") res = IndexEngine.query(Object.assign({}, params, { q:firstNonEmpty(params.section, params.page, q) }));
    else return { status:"no-compatible-export", items:[], meta:{ latency:nowMs()-started } };
    const items = sanmaruNormalizeIndexFrontItems(res, q, target);
    return { status:items.length ? "ok" : "empty", items, raw:res, meta:Object.assign({ latency:nowMs()-started }, res && res.meta || {}) };
  }catch(e){
    return { status:responseErrorCode(e), items:[], meta:{ latency:nowMs()-started, error:responseErrorCode(e) } };
  }
}
function sanmaruFrontDirectAccessProfile(opts){
  opts = opts || {};
  return {
    role:"top-integrated-information-osai-front-gateway",
    osaiRole:"global-web-db-public-data-producer-supply-network-direct-access-os",
    preservesGlobalOsMode:true,
    frontSupplyModeSeparated:true,
    directAccessReady:true,
    externalCall:false,
    providerWait:false,
    futureProviderClasses:["official-web","public-data","government","institution","producer-channel","cooperative","agriculture","fishery","forestry","industrial-goods","food","ai-gpu-analysis"],
    discernmentPolicy:{
      officialSource:true,
      producerVerificationReady:true,
      intermediaryRiskClassificationReady:true,
      trustFilterReady:true,
      regionIpCountryRoutingReady:true,
      searchBankRoutingReady:true,
      harmfulContentFilterReady:true,
      unsafeProductFilterReady:true,
      paymentOrderReadinessReady:true,
      safeAbundanceExpansionReady:true
    }
  };
}




function sanmaruKoreaLocalAuthorityCards(query, country){
  const q = s(query || '').trim();
  if(!q) return [];
  const rows = [
    ['서울','서울특별시청 공식 홈페이지','https://www.seoul.go.kr','official',1.090],
    ['서울','서울 열린데이터광장','https://data.seoul.go.kr','official',1.084],
    ['서울','서울관광재단 / Visit Seoul','https://english.visitseoul.net','local',1.078],
    ['부산','부산광역시청 공식 홈페이지','https://www.busan.go.kr','official',1.090],
    ['부산','부산 공공데이터 포털','https://www.busan.go.kr/data','official',1.084],
    ['부산','부산관광공사 / Visit Busan','https://www.visitbusan.net','local',1.078],
    ['대구','대구광역시청 공식 홈페이지','https://www.daegu.go.kr','official',1.090],
    ['대구','대구 공공데이터 / 행정정보','https://www.daegu.go.kr/index.do?menu_id=00936532','official',1.084],
    ['대구','대구문화예술진흥원 관광 정보','https://tour.daegu.go.kr','local',1.078],
    ['인천','인천광역시청 공식 홈페이지','https://www.incheon.go.kr','official',1.090],
    ['광주','광주광역시청 공식 홈페이지','https://www.gwangju.go.kr','official',1.090],
    ['대전','대전광역시청 공식 홈페이지','https://www.daejeon.go.kr','official',1.090],
    ['울산','울산광역시청 공식 홈페이지','https://www.ulsan.go.kr','official',1.090],
    ['세종','세종특별자치시 공식 홈페이지','https://www.sejong.go.kr','official',1.090],
    ['제주','제주특별자치도청 공식 홈페이지','https://www.jeju.go.kr','official',1.090]
  ];
  return rows.filter(r => q.indexOf(r[0]) >= 0).map((r, idx) => ({
    id:'sanmaru-local-authority-' + stableHash([q,r[0],r[1]].join('|')),
    title:r[1],
    summary:'',
    description:'',
    url:r[2], link:r[2],
    source:r[1], provider:'local-authority',
    type:r[3], mediaType:'article', category:r[3], lane:r[3],
    country:country || 'KR', generatedBy:'sanmaru-local-authority-first-rank', sourceType:'official-authority',
    sanmaruFirstPaint:true, passthrough:false, placeholder:false,
    score:30 + r[4] - idx * 0.0001,
    _finalScore:30 + r[4] - idx * 0.0001,
    _authorityScore:30 + r[4] - idx * 0.0001,
    searchCategory:r[3],
    _category:r[3],
    tags:['official','authority','public',r[0]].filter(Boolean)
  }));
}

// -----------------------------------------------------------------------------
// SANMARU PROVIDER PASSTHROUGH FIRST-PAINT LAYER
// These cards are immediate provider lanes, not final search results. They let
// the UI paint Google/Naver/Bing/YouTube/SNS/Wiki roads instantly while the full
// Maru Search + Sanmaru OS expansion continues in parallel.
// -----------------------------------------------------------------------------
function sanmaruProviderPassthroughCards(q, opts){
  opts = opts || {};
  q = firstNonEmpty(q, opts.q, opts.query);
  const query = s(q).trim();
  if(!query) return [];
  const enc = encodeURIComponent(query);
  const country = firstNonEmpty(opts.country, opts.region, opts.geo, opts.runtimeRegion, "GLOBAL");
  const type = s(firstNonEmpty(opts.searchType, opts.type, opts.category, opts.tab, opts.vertical, "all")).toLowerCase();
  const perPageForNeed = clampInt(firstNonEmpty(opts.perPage, opts.pageSize, opts.visibleCardsPerPage, opts.visibleLimit), DEFAULT_VISIBLE_PER_PAGE, 1, 100);
  const requestedPageForNeed = clampInt(firstNonEmpty(opts.page, opts.p, opts.start, 1), 1, 1, SANMARU_MAX_PAGER_PAGES);
  const requestedNeed = clampInt(Math.max(firstNonEmpty(opts.need, opts.target, opts.limit, opts.candidatePoolTarget, 300), requestedPageForNeed * perPageForNeed, perPageForNeed * 12), 300, 1, MAX_LIMIT);

  const rows = [
    ["provider-google-web", "Google 통합 검색", (page)=>"https://www.google.com/search?q=" + enc + "&start=" + Math.max(0, (page - 1) * 10), "google", "web", 0.997],
    ["provider-naver-all", "Naver 통합 검색", (page)=>"https://search.naver.com/search.naver?query=" + enc + "&start=" + Math.max(1, ((page - 1) * 10) + 1), "naver", "web", 0.996],
    ["provider-wikipedia", "Wikipedia / 백과", (page)=>"https://www.google.com/search?q=" + encodeURIComponent(query + " wikipedia encyclopedia") + "&start=" + Math.max(0, (page - 1) * 10), "wikipedia", "knowledge", 0.995],
    ["provider-namuwiki", "나무위키 / 지식", (page)=>"https://www.google.com/search?q=" + encodeURIComponent(query + " 나무위키 백과") + "&start=" + Math.max(0, (page - 1) * 10), "namuwiki", "knowledge", 0.994],
    ["provider-naver-encyclopedia", "네이버 지식백과", (page)=>"https://search.naver.com/search.naver?where=kdic&query=" + enc + "&start=" + Math.max(1, ((page - 1) * 10) + 1), "naver-encyclopedia", "knowledge", 0.993],
    ["provider-wikidata", "Wikidata / 구조화 지식", (page)=>"https://www.google.com/search?q=" + encodeURIComponent(query + " wikidata knowledge graph") + "&start=" + Math.max(0, (page - 1) * 10), "wikidata", "knowledge", 0.9925],
    ["provider-google-news", "Google 뉴스", (page)=>"https://news.google.com/search?q=" + enc + "&maru_page=" + page, "google-news", "news", 0.992],
    ["provider-google-video", "Google 영상", (page)=>"https://www.google.com/search?tbm=vid&q=" + enc + "&start=" + Math.max(0, (page - 1) * 10), "google-video", "video", 0.986],
    ["provider-google-image", "Google 이미지", (page)=>"https://www.google.com/search?tbm=isch&q=" + enc + "&maru_page=" + page, "google-image", "image", 0.982],
    ["provider-google-maps", "Google Maps / 지도", (page)=>"https://www.google.com/maps/search/" + enc + "?maru_page=" + page, "google-maps", "local", 0.981],
    ["provider-naver-map", "Naver Map / 지도", (page)=>"https://map.naver.com/p/search/" + enc + "?maru_page=" + page, "naver-map", "local", 0.981],
    ["provider-local-photo", "지역 사진 / 스냅샷", (page)=>"https://www.google.com/search?tbm=isch&q=" + enc + "&maru_page=" + page, "local-photo", "image", 0.980],
    ["provider-local-video", "지역 영상 / 리뷰", (page)=>"https://www.youtube.com/results?search_query=" + enc + "&maru_page=" + page, "local-video", "video", 0.979],
    ["provider-naver-news", "Naver 뉴스", (page)=>"https://search.naver.com/search.naver?where=news&query=" + enc + "&start=" + Math.max(1, ((page - 1) * 10) + 1), "naver-news", "news", 0.991],
    ["provider-naver-blog", "Naver 블로그", (page)=>"https://search.naver.com/search.naver?where=blog&query=" + enc + "&start=" + Math.max(1, ((page - 1) * 10) + 1), "naver-blog", "blog", 0.989],
    ["provider-naver-cafe", "Naver 카페", (page)=>"https://search.naver.com/search.naver?where=article&query=" + enc + "&start=" + Math.max(1, ((page - 1) * 10) + 1), "naver-cafe", "community", 0.984],
    ["provider-bing-web", "Bing 통합 검색", (page)=>"https://www.bing.com/search?q=" + enc + "&first=" + Math.max(1, ((page - 1) * 10) + 1), "bing", "web", 0.990],
    ["provider-youtube", "YouTube 영상", (page)=>"https://www.youtube.com/results?search_query=" + enc + "&maru_page=" + page, "youtube", "video", 0.987],
    ["provider-instagram", "Instagram 공개 검색", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:instagram.com " + query) + "&start=" + Math.max(0, (page - 1) * 10), "instagram", "sns", 0.968],
    ["provider-facebook", "Facebook 공개 검색", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:facebook.com " + query) + "&start=" + Math.max(0, (page - 1) * 10), "facebook", "sns", 0.966],
    ["provider-x-twitter", "X/Twitter 공개 검색", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("(site:x.com OR site:twitter.com) " + query) + "&start=" + Math.max(0, (page - 1) * 10), "x-twitter", "sns", 0.965],
    ["provider-tiktok", "TikTok 공개 검색", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:tiktok.com " + query) + "&start=" + Math.max(0, (page - 1) * 10), "tiktok", "sns", 0.964],
    ["provider-public-data", "공공 데이터 / 공식 자료", (page)=>"https://www.google.com/search?q=" + encodeURIComponent(query + " public data government official dataset 공공데이터 공식") + "&start=" + Math.max(0, (page - 1) * 10), "public-data", "official", 0.980]
  ];



  const maruQualityRows = [
    ["provider-yonhap", "연합뉴스 지역뉴스", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:yna.co.kr " + query) + "&start=" + Math.max(0, (page - 1) * 10), "yonhap", "news", 0.944],
    ["provider-kbs", "KBS 뉴스", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:kbs.co.kr/news " + query) + "&start=" + Math.max(0, (page - 1) * 10), "kbs", "news", 0.940],
    ["provider-mbc", "MBC 뉴스", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:imnews.imbc.com " + query) + "&start=" + Math.max(0, (page - 1) * 10), "mbc", "news", 0.936],
    ["provider-sbs", "SBS 뉴스", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:news.sbs.co.kr " + query) + "&start=" + Math.max(0, (page - 1) * 10), "sbs", "news", 0.934],
    ["provider-ytn", "YTN 뉴스", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:ytn.co.kr " + query) + "&start=" + Math.max(0, (page - 1) * 10), "ytn", "news", 0.932],
    ["provider-jtbc", "JTBC 뉴스", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:news.jtbc.co.kr " + query) + "&start=" + Math.max(0, (page - 1) * 10), "jtbc", "news", 0.930],
    ["provider-tvchosun", "TV조선 뉴스", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:news.tvchosun.com " + query) + "&start=" + Math.max(0, (page - 1) * 10), "tvchosun", "news", 0.928],
    ["provider-joongang", "중앙일보", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:joongang.co.kr " + query) + "&start=" + Math.max(0, (page - 1) * 10), "joongang", "news", 0.925],
    ["provider-chosun", "조선일보", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:chosun.com " + query) + "&start=" + Math.max(0, (page - 1) * 10), "chosun", "news", 0.924],
    ["provider-donga", "동아일보", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:donga.com " + query) + "&start=" + Math.max(0, (page - 1) * 10), "donga", "news", 0.923],
    ["provider-public-data-kr", "공공데이터포털", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:data.go.kr " + query) + "&start=" + Math.max(0, (page - 1) * 10), "public-data-kr", "official", 0.952],
    ["provider-korea-policy", "대한민국 정책브리핑", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:korea.kr " + query) + "&start=" + Math.max(0, (page - 1) * 10), "korea-policy", "official", 0.946],
    ["provider-visitkorea", "한국관광공사 관광정보", (page)=>"https://www.google.com/search?q=" + encodeURIComponent("site:visitkorea.or.kr " + query) + "&start=" + Math.max(0, (page - 1) * 10), "visitkorea", "local", 0.948],
    ["provider-naver-blog-local", "네이버 블로그 후기", (page)=>"https://search.naver.com/search.naver?where=blog&query=" + enc + "&start=" + Math.max(1, ((page - 1) * 10) + 1), "naver-blog", "blog", 0.914],
    ["provider-youtube-local", "YouTube 현장 영상", (page)=>"https://www.youtube.com/results?search_query=" + enc, "youtube", "video", 0.918]
  ];
  rows.push.apply(rows, maruQualityRows);
  const maruTopicLabels = ["공식정보","최신소식","정책·행정","관광·문화","교통·지도","지역경제","행사·축제","현장후기","영상자료","커뮤니티"];

  const typeRank = {
    all: new Set(["web","official","news","blog","video","image","local","knowledge","sns","community"]),
    web: new Set(["web","official","knowledge"]),
    news: new Set(["news","official","web"]),
    blog: new Set(["blog","web","community"]),
    cafe: new Set(["community","blog","web"]),
    community: new Set(["community","blog","sns","web"]),
    video: new Set(["video","sns","web"]),
    youtube: new Set(["video","sns","web"]),
    image: new Set(["image","web"]),
    sns: new Set(["sns","video","web"]),
    knowledge: new Set(["knowledge","official","web"]),
    map: new Set(["local","official","web","image","video","news"]),
    tour: new Set(["local","official","web","video","blog","image"]),
    shopping: new Set(["web","blog","community"])
  };
  const preferred = typeRank[type] || typeRank.all;
  const out = sanmaruKoreaLocalAuthorityCards(query, country);
  let round = 1;
  while(out.length < requestedNeed && round <= SANMARU_MAX_PAGER_PAGES){
    for(let idx = 0; idx < rows.length && out.length < requestedNeed; idx++){
      const r = rows[idx];
      const lane = r[4];
      const boost = preferred.has(lane) ? 0.08 : 0;
      const url = typeof r[2] === "function" ? r[2](round) : r[2];
      const topicLabel = maruTopicLabels[(round - 1) % maruTopicLabels.length];
      const cleanTitle = query + " · " + r[1] + (round > 1 ? " · " + topicLabel : "");
      // Provider-passthrough cards are fast roads, not page bodies.
      // Do not inject 안내문 as card content; preserve real snippets only when providers return them.
      const cleanSummary = "";
      out.push({
        id: "sanmaru-pass-" + stableHash([query, r[0], country, round].join("|")),
        title: cleanTitle,
        summary: cleanSummary,
        description: cleanSummary,
        url, link: url,
        source: r[3],
        provider: r[3],
        type: lane,
        mediaType: lane === "video" ? "video" : (lane === "image" ? "image" : "article"),
        category: lane,
        lane,
        country,
        generatedBy: "sanmaru-provider-passthrough-paged-window",
        sourceType: "provider-page-window",
        sanmaruFirstPaint: round === 1,
        passthrough: true,
        placeholder: false,
        score: r[5] + boost - (round * 0.0001) - (idx * 0.00001),
        tags: ["provider-window", lane, r[3], country].filter(Boolean),
        payload: { providerLane:r[3], providerUrl:url, country, pageWindow:round, firstPaint:round === 1 }
      });
    }
    round++;
  }
  return out.sort((a,b) => (b.score - a.score));
}

// -----------------------------------------------------------------------------
// SANMARU INSTANT OS SUPPLY LAYER
// This is a non-blocking first-supply package. It never replaces the full Maru
// Search provider pass; it gives the front/search/gateway enough structured
// authority/resident/route data to render immediately while wide providers keep
// working through Maru Search or later refresh.
// -----------------------------------------------------------------------------
function buildSanmaruInstantOsPackage(q, opts){
  opts = opts || {};
  q = firstNonEmpty(q, opts.q, opts.query);
  const started = nowMs();
  ensureResidentBoot({ reason: opts.reason || "instant-os-supply" });

  const lang = firstNonEmpty(opts.lang, opts.uiLang, opts.locale);
  const searchType = firstNonEmpty(opts.searchType, opts.type, opts.category, opts.tab, opts.vertical, "all");
  const country = firstNonEmpty(opts.country, opts.region, opts.geo, opts.runtimeRegion);
  const effectiveCountry = firstNonEmpty(country, "GLOBAL");

  const supplied = supplyResidentSync({ q, query:q }, {
    reason: opts.reason || "instant-os-supply",
    limit: firstNonEmpty(opts.limit, DEFAULT_LIMIT),
    candidatePoolTarget: firstNonEmpty(opts.candidatePool, opts.candidatePoolTarget, SANMARU_INSTANT_SUPPLY_TARGET),
    searchType,
    type: searchType,
    lang,
    page: firstNonEmpty(opts.page, opts.p, opts.start, 1),
    perPage: firstNonEmpty(opts.perPage, opts.pageSize, opts.visibleCardsPerPage, opts.visibleLimit, DEFAULT_VISIBLE_PER_PAGE),
    visibleNeed: firstNonEmpty(opts.perPage, opts.pageSize, opts.visibleCardsPerPage, opts.visibleLimit, DEFAULT_VISIBLE_PER_PAGE),
    allowRouteCards: true,
    allowOpeningCards: true,
    frontSupply: truthy(opts.frontSupply || opts.slotSupply || opts.contentSupply || opts.snapshotSupply || opts.searchbankSupply || opts.includeFrontSupply || opts.includeFrontSlots),
    country: effectiveCountry
  });

  let items = Array.isArray(supplied && supplied.items) ? supplied.items.slice() : [];
  const providerPassthroughItems = sanmaruProviderPassthroughCards(q, Object.assign({}, opts, { country: effectiveCountry, searchType }));
  const providerHints = dedupeItems([].concat(
    Array.isArray(supplied && supplied.providerHints) ? supplied.providerHints : [],
    providerPassthroughItems
  ));
  // Provider passthrough cards are first-paint roads only. They stay in
  // providerHints and never become public result items.
  const ctx = {
    q,
    searchType,
    type: searchType,
    lang,
    region: effectiveCountry,
    candidatePoolTarget: clampInt(firstNonEmpty(opts.candidatePool, opts.candidatePoolTarget), SANMARU_INSTANT_SUPPLY_TARGET, 1, MAX_LIMIT),
    limit: clampInt(firstNonEmpty(opts.limit), DEFAULT_LIMIT, 1, MAX_LIMIT)
  };
  const finalTarget = Math.min(MAX_LIMIT, Math.max(ctx.limit, ctx.candidatePoolTarget || 0, MIN_FAST_TARGET));
  items = finalRank(q, items, ctx).slice(0, finalTarget).map(it => {
    const copy = Object.assign({}, it);
    delete copy._sanmaruSeq;
    delete copy._sanmaruRejectedReason;
    return copy;
  });
  const osaiDiscernmentPack = sanmaruScreenSupplyItems(items, { mode:"instant-os", q, searchType, country:effectiveCountry, target:finalTarget, preserveAbundance:true });
  items = osaiDiscernmentPack.items;

  const geoRoute = (typeof buildGeoRouteContext === "function")
    ? buildGeoRouteContext(q, { lang, country: effectiveCountry })
    : { effectiveCountry, country: effectiveCountry };
  const cats = classifyQueryCategories(q, searchType);
  const routePlan = buildRoutePlanForQuery(q, { searchType, type:searchType, lang, country:effectiveCountry, runtimeRegion:effectiveCountry });
  const categoryLanePlan = (typeof buildCategoryLanePlan === "function")
    ? buildCategoryLanePlan(q, cats, geoRoute)
    : { lanes: cats };
  const searchSkeleton = (typeof buildSearchSkeletonPolicy === "function")
    ? buildSearchSkeletonPolicy(q, geoRoute)
    : { style:"google-naver-hybrid-progressive-render", pagination:{ initialPage:1, renderMode:"current-page-first" } };

  const perPage = clampInt(firstNonEmpty(opts.perPage, opts.pageSize, opts.visibleCardsPerPage, opts.visibleLimit), DEFAULT_VISIBLE_PER_PAGE, 1, 100);
  const requestedPage = clampInt(firstNonEmpty(opts.page, opts.p, opts.start, 1), 1, 1, 100000);
  const reportedTotalCandidates = Math.max(
    Number(supplied && supplied.meta && (supplied.meta.totalCandidates || supplied.meta.fullCandidateCount)) || 0,
    items.length
  );
  const reportedTotalPages = reportedTotalCandidates
    ? Math.min(SANMARU_MAX_PAGER_PAGES, Math.max(1, Math.ceil(reportedTotalCandidates / perPage)))
    : 0;
  const pageItems = items.slice((requestedPage - 1) * perPage, requestedPage * perPage);
  // Sanmaru is the prepared information OS/data-bank layer. For search UI
  // handoff it must not cut the supply down to only the visible page. Return the
  // requested first preload window (normally 300 = 12 pages × 25) immediately;
  // search.js will render page 1 first and cache the rest.
  const requestedFirstWindow = clampInt(
    firstNonEmpty(opts.firstPaintLimit, opts.initialRenderTarget, opts.initialPreloadTarget, opts.limit),
    Math.max(perPage * 12, 300),
    perPage,
    MAX_LIMIT
  );
  const firstPaintLimit = Math.max(perPage, Math.min(requestedFirstWindow, finalTarget, MAX_LIMIT));
  const responseItems = requestedPage === 1
    ? items.slice(0, firstPaintLimit)
    : pageItems.slice(0, perPage);
  const visiblePagePack = {
    page: requestedPage,
    perPage,
    visibleCardsPerPage: perPage,
    visibleCount: pageItems.length,
    pageItems,
    totalItems: reportedTotalCandidates,
    totalVisibleItems: reportedTotalCandidates,
    totalCandidates: reportedTotalCandidates,
    fullCandidateCount: reportedTotalCandidates,
    totalPages: reportedTotalPages,
    hasNextPage: requestedPage < reportedTotalPages,
    nextPage: requestedPage < reportedTotalPages ? requestedPage + 1 : null,
    responseMode: "instant-preload-window-cache-first-page-render"
  };

  return {
    status: "ok",
    engine: ENGINE_NAME,
    version: VERSION,
    action: "instant-os-supply",
    query: q,
    source: responseItems.length ? "sanmaru-instant-os" : "sanmaru-instant-os-empty",
    items: responseItems,
    results: responseItems,
    providerHints,
    pageItems,
    visiblePagePack,
    totalCandidates: reportedTotalCandidates,
    fullCandidateCount: reportedTotalCandidates,
    totalItems: reportedTotalCandidates,
    totalPages: reportedTotalPages,
    geoRoute,
    routePlan,
    categoryLanePlan,
    searchSkeleton,
    providerLayer: {
      mode: "provider-lane-map-only-no-provider-wait",
      providerHealth: providerHealthSnapshot(),
      sourceRegistry: sourceRegistrySnapshot(),
      mountRegistry: mountRegistrySnapshot()
    },
    meta: Object.assign({}, supplied && supplied.meta || {}, {
      count: responseItems.length,
      totalCandidates: reportedTotalCandidates,
      fullCandidateCount: reportedTotalCandidates,
      totalItems: reportedTotalCandidates,
      supplyTarget: ctx.candidatePoolTarget,
      instantSupplyCapacityTarget: SANMARU_INSTANT_SUPPLY_TARGET,
      extendedSupplyCapacityTarget: SANMARU_EXTENDED_SUPPLY_TARGET,
      totalPages: reportedTotalPages,
      page: requestedPage,
      perPage,
      visibleCount: pageItems.length,
      responseWindowCount: responseItems.length,
      initialResponseWindow: responseItems.length,
      providerPassthroughCount: providerPassthroughItems.length,
      providerHintCount: providerHints.length,
      providerHintsExcludedFromItems:true,
      osaiSupplyDiscernment: osaiDiscernmentPack.meta,
      safeSupplyExpansion:{ localFirst:true, expansionOrder:SANMARU_SAFE_SUPPLY_EXPANSION_ORDER, abundanceTarget:ctx.candidatePoolTarget, filterDoesNotShrinkSafeSupply:true },
      elapsedMs: nowMs() - started,
      instantSupply: true,
      responseMode: "first-preload-supply-package",
      doesNotBlockOnProviders: true,
      doesNotReplaceFullSearch: true,
      fullSearchPolicy: "maru-search-wide-provider-pass-continues-or-can-be-called-after-first-render",
      searchExecutionOwner: "sanmaru-global-information-os",
      maruSearchRole: "gateway-body-and-render-channel",
      coreRole: "normalize-bus-only",
      principle: "resident-cache-snapshot-authority-route-first; live-provider-refresh-after-first-render",
      lanes: Array.isArray(categoryLanePlan && categoryLanePlan.lanes) ? categoryLanePlan.lanes : undefined,
      trace: [].concat((supplied && supplied.meta && supplied.meta.trace) || [], [{
        name: "sanmaru-instant-os-supply",
        status: responseItems.length ? "ok" : "empty",
        count: responseItems.length,
        providerPassthroughCount: providerPassthroughItems.length,
      providerHintCount: providerHints.length,
      providerHintsExcludedFromItems:true,
        mode: "real-resident-index-supply-plus-separated-provider-hints",
        currentPageFirst: true,
        keepFullProviderSearchRunning: true
      }])
    })
  };
}

function buildSanmaruFrontSupplyPackage(q, opts){
  const started = nowMs();
  opts = opts || {};
  const target = sanmaruFrontTarget(opts);
  const query = firstNonEmpty(q, opts.q, opts.query, target.section, target.page, "front");
  const requestedLimit = clampInt(firstNonEmpty(opts.limit, opts.frontSupplyTarget, opts.candidatePool, opts.candidatePoolTarget), SEARCH_BANK_FRONT_REAL_FLOOR, 1, MAX_LIMIT);
  const targetCount = Math.min(requestedLimit, MAX_LIMIT);

  // Front-slot supply must be deterministic. Sanmaru's global resident/provider OS
  // remains available for normal search, but front-slot data uses SearchBank Index
  // exact section/page routing first so resident/global candidates cannot pollute a
  // requested slot.
  const indexPack = sanmaruCallIndexFrontSupply(query, opts, target, targetCount);
  let selected = Array.isArray(indexPack.items) ? indexPack.items.slice(0, targetCount) : [];
  let fallbackPack = null;
  let residentFallbackReturnedCount = 0;
  let fallbackPartition = { exact:[], pageFallback:[], globalFallback:[] };

  if(selected.length < targetCount){
    fallbackPack = buildSanmaruInstantOsPackage(query, Object.assign({}, opts, {
      reason: opts.reason || "front-slot-supply-resident-fallback",
      frontSupply: true,
      slotSupply: true,
      includeFrontSupply: true,
      candidatePoolTarget: targetCount,
      limit: targetCount,
      allowRouteCards: false,
      allowOpeningCards: false,
      noRouteCards: true,
      noOpeningCards: true
    }));
    fallbackPartition = sanmaruFrontFallbackPartition(fallbackPack && fallbackPack.items, target);
    const fallbackOrdered = fallbackPartition.exact.concat(fallbackPartition.pageFallback, fallbackPartition.globalFallback);
    const merged = dedupeItems(selected.concat(fallbackOrdered));
    selected = merged.slice(0, targetCount);
    residentFallbackReturnedCount = Math.max(0, selected.length - (indexPack.items ? indexPack.items.length : 0));
  }

  const osaiDiscernmentPack = sanmaruScreenSupplyItems(selected, { mode:"front-supply", q:query, page:target.page, section:target.section, country:opts.country, target:targetCount, preserveAbundance:true });
  selected = osaiDiscernmentPack.items;

  const exactReturned = selected.filter(item => sanmaruFrontTargetBucket(item, target) === "exact" || !target.hasTarget).length;
  const pageFallbackReturned = selected.filter(item => sanmaruFrontTargetBucket(item, target) === "page-fallback").length;
  const globalFallbackReturned = selected.filter(item => sanmaruFrontTargetBucket(item, target) === "global-fallback").length;
  const providerHints = fallbackPack && Array.isArray(fallbackPack.providerHints) ? fallbackPack.providerHints : [];
  const geoRoute = buildGeoRouteContext(query, { lang:firstNonEmpty(opts.lang, opts.uiLang, opts.locale), country:firstNonEmpty(opts.country, opts.region, opts.geo) });
  const routePlan = buildRoutePlanForQuery(query, { searchType:firstNonEmpty(opts.type, opts.category, opts.tab, opts.vertical), lang:firstNonEmpty(opts.lang, opts.uiLang, opts.locale), country:firstNonEmpty(opts.country, opts.region, opts.geo) });

  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    action:"front-supply",
    query,
    source:selected.length ? "sanmaru-front-slot-index-gateway" : "sanmaru-front-slot-empty",
    items:selected,
    results:selected,
    providerHints,
    geoRoute,
    routePlan,
    meta:{
      count:selected.length,
      target:targetCount,
      requestedLimit,
      requestedPage:target.page || null,
      requestedSection:target.section || null,
      frontSupply:true,
      slotSupply:true,
      frontSupplyMode:true,
      policy:"front-slot-index-first-section-isolated-osai-preserved",
      supplyOrder:"searchbank-index-exact-first-page-fallback-second-resident-only-on-shortage",
      searchBankIndex:{
        status:indexPack.status,
        version:indexPack.raw && indexPack.raw.version,
        count:indexPack.items ? indexPack.items.length : 0,
        exactCandidateCount:indexPack.meta && indexPack.meta.exactCandidateCount,
        pageFallbackCandidateCount:indexPack.meta && indexPack.meta.pageFallbackCandidateCount,
        globalFallbackCandidateCount:indexPack.meta && indexPack.meta.globalFallbackCandidateCount,
        exactReturnedCount:indexPack.meta && indexPack.meta.exactReturnedCount,
        pageFallbackReturnedCount:indexPack.meta && indexPack.meta.pageFallbackReturnedCount,
        globalFallbackReturnedCount:indexPack.meta && indexPack.meta.globalFallbackReturnedCount,
        latency:indexPack.meta && indexPack.meta.latency
      },
      indexGatewayUsed:indexPack.status === "ok",
      indexReturnedCount:indexPack.items ? indexPack.items.length : 0,
      exactReturnedCount:exactReturned,
      pageFallbackReturnedCount:pageFallbackReturned,
      globalFallbackReturnedCount:globalFallbackReturned,
      residentFallbackUsed:!!fallbackPack,
      residentFallbackReturnedCount,
      residentFallbackCandidateCount:fallbackPack && fallbackPack.meta ? fallbackPack.meta.totalCandidates || fallbackPack.meta.fullCandidateCount || 0 : 0,
      sectionIsolation: target.hasSection ? pageFallbackReturned === 0 && globalFallbackReturned === 0 : true,
      pageIsolation: target.hasPage ? globalFallbackReturned === 0 : true,
      providerHintsExcludedFromItems:true,
      noProviderCardsInFrontItems:true,
      doesNotCallExternal:true,
      directExternalAdaptersEnabled:false,
      osaiSupplyDiscernment:osaiDiscernmentPack.meta,
      safeSupplyExpansion:{ localFirst:true, expansionOrder:SANMARU_SAFE_SUPPLY_EXPANSION_ORDER, abundanceTarget:targetCount, filterDoesNotShrinkSafeSupply:true },
      unifiedTrustContract:{ preservesSearchBankChecks:true, preservesTrustFilterChecks:true, preservesPaymentPermissionChecks:true, removesDuplicateLogic:false, contractVersion:"sanmaru-searchbank-supply-contract-v1.1", evidenceEnabled:true, contractFields:["trustTier","riskLevel","blockedReason","officialSource","institutionVerified","producerVerified","producerType","directProducerChannel","intermediaryRisk","paymentReady","orderReady","paymentReadinessScore","deliveryReady","policyReady","supplyChainReady","frontSupplyAllowed","searchBankEligible","snapshotEligible","indexEligible","searchBankContract","sanmaruEvidence"] },
      osaiDirectAccess:sanmaruFrontDirectAccessProfile(opts),
      resident: residentBootSnapshot(),
      providerHealth: providerHealthSnapshot(),
      sourceRegistryReady:true,
      categoryBrainReady:true,
      routePlan,
      elapsedMs:nowMs() - started,
      trace:[
        { name:"searchbank-index-front-gateway", status:indexPack.status, count:indexPack.items ? indexPack.items.length : 0, latency:indexPack.meta && indexPack.meta.latency },
        { name:"sanmaru-resident-front-fallback", status:fallbackPack ? "shortage-fallback-used" : "not-needed", count:residentFallbackReturnedCount }
      ],
      note:"Sanmaru remains the top global information OS/OSAI. This front-supply path is deliberately isolated so SearchBank Index section/page routing is honored before any resident/global fallback."
    }
  };
}


async function handler(event){
  if(event && event.httpMethod === "OPTIONS") return ok({ status:"ok" });
  const qs = (event && event.queryStringParameters) || {};
  const body = parseBody(event || {});
  const merged = Object.assign({}, qs, body);
  const action = low(firstNonEmpty(merged.action, merged.mode, merged.fn));
  const security = guardRequest(event || {}, merged, action);
  if(!security.allowed){
    return ok({ status:"blocked", engine:ENGINE_NAME, version:VERSION, action, message:"protected Sanmaru action", security, resident:residentBootSnapshot() });
  }

  if(action === "health") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, health:healthSnapshot(), resident:residentBootSnapshot(), security:{ allowed:true, admin:security.admin } });
  if(action === "resident-boot" || action === "boot" || action === "mount-library") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"resident-boot", resident:touchResidentSwitch({ reason:firstNonEmpty(merged.reason, "manual-boot-switch"), q:firstNonEmpty(merged.q, merged.query) }) });
  if(action === "resident-activate" || action === "resident-switch" || action === "warm-ping" || action === "warm") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"resident-switch", resident:touchResidentSwitch({ reason:firstNonEmpty(merged.reason, action), q:firstNonEmpty(merged.q, merged.query) }) });
  if(action === "resident-rebuild" || action === "rebuild-resident") { const rebuilt = ensureResidentBoot({ force:true, admin:security.admin, engineUpgrade:truthy(merged.engineUpgrade || merged.upgrade || merged.versionUpload), engineUpload:truthy(merged.engineUpload || merged.sanmaruEngineUpload || merged.sanmaruEngineReupload || merged.codeUpload), reason:"manual-rebuild" }); return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"resident-rebuild", resident:touchResidentSwitch({ reason:"manual-rebuild-switch" }), rebuilt, lifecycleNote:"admin permission does not reset Sanmaru by itself; only Sanmaru engine file upload/code fingerprint change performs engine reboot" }); }
  if(action === "resident-status") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"resident-status", resident:touchResidentSwitch({ reason:"resident-status" }), health:healthSnapshot(), providerHealth:providerHealthSnapshot() });
  if(action === "provider-health") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"provider-health", providerHealth:providerHealthSnapshot(), resident:residentBootSnapshot() });
  if(action === "source-registry") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"source-registry", sources:sourceRegistrySnapshot(), openingSignals:openingSignalsSnapshot(), resident:residentBootSnapshot() });
  if(action === "category-map" || action === "category-brain") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"category-map", categories:categoryMapSnapshot(), aliases:PROVIDER_CATEGORY_ALIASES, capabilities:PROVIDER_CAPABILITY_MAP, logosGuard:logosEvaluate([{ type:"category_brain", intent:"stewardship", truthConfidence:0.95 }], "category-map"), resident:residentBootSnapshot() });
  if(action === "osai-policy" || action === "supply-discernment-policy") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"osai-policy", discernmentVersion:SANMARU_OSAI_DISCERNMENT_VERSION, resources:sanmaruOsaiPolicyResources().sources, expansionOrder:SANMARU_SAFE_SUPPLY_EXPANSION_ORDER, contractFields:["trustTier","riskLevel","blockedReason","officialSource","institutionVerified","producerVerified","producerType","directProducerChannel","intermediaryRisk","paymentReady","orderReady","paymentReadinessScore","deliveryReady","policyReady","supplyChainReady","frontSupplyAllowed","searchBankEligible","snapshotEligible","indexEligible","sanmaruEvidence","sanmaruSearchBankContract"], contractVersion:"sanmaru-searchbank-supply-contract-v1.1", policy:"preserve-existing-searchbank-trust-payment-checks-and-add-sanmaru-osai-discernment-meta" });
  if(action === "instant-supply" || action === "instant-search" || action === "instant-os" || action === "first-supply" || action === "authority-top" || action === "provider-layer") {
    const qx = firstNonEmpty(merged.q, merged.query);
    const country = firstNonEmpty(merged.country, merged.region, merged.geo, detectRuntimeRegion(event || {}, firstNonEmpty(merged.lang, merged.uiLang, merged.locale), qx));
    return ok(buildSanmaruInstantOsPackage(qx, Object.assign({}, merged, { country, reason:action || "instant-os" })));
  }
  if(action === "front-supply" || action === "slot-supply" || action === "content-supply" || action === "snapshot-supply" || action === "searchbank-supply" || action === "insight-supply" || action === "global-insight" || action === "issue-supply") {
    const qx = firstNonEmpty(merged.q, merged.query, merged.section, merged.slot, merged.page, merged.targetPage, action);
    const country = firstNonEmpty(merged.country, merged.region, merged.geo, detectRuntimeRegion(event || {}, firstNonEmpty(merged.lang, merged.uiLang, merged.locale), qx));
    return ok(buildSanmaruFrontSupplyPackage(qx, Object.assign({}, merged, { country, reason:action })));
  }
  if(action === "geo-route" || action === "ip-route" || action === "country-route") return ok(Object.assign({ action:"geo-route" }, geoIpRouteMatrixSnapshot(firstNonEmpty(merged.q, merged.query), { lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale), country:firstNonEmpty(merged.country, merged.region, merged.geo, detectRuntimeRegion(event || {}, firstNonEmpty(merged.lang, merged.uiLang, merged.locale), firstNonEmpty(merged.q, merged.query))) }), { resident:touchResidentSwitch({ reason:"geo-route", q:firstNonEmpty(merged.q, merged.query) }) }));
  if(action === "route-plan") return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action:"route-plan", routePlan:residentRoutePlanFor(firstNonEmpty(merged.q, merged.query), { searchType:firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical), lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale), country:firstNonEmpty(merged.country, merged.region, merged.geo, detectRuntimeRegion(event || {}, firstNonEmpty(merged.lang, merged.uiLang, merged.locale), firstNonEmpty(merged.q, merged.query))) }), resident:touchResidentSwitch({ reason:"route-plan", q:firstNonEmpty(merged.q, merged.query) }) });
  if(action === "search-skeleton" || action === "category-lanes" || action === "naver-google-style") {
    const qx = firstNonEmpty(merged.q, merged.query);
    const geo = buildGeoRouteContext(qx, { lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale), country:firstNonEmpty(merged.country, merged.region, merged.geo, detectRuntimeRegion(event || {}, firstNonEmpty(merged.lang, merged.uiLang, merged.locale), qx)) });
    const cats = classifyQueryCategories(qx, firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical));
    return ok({ status:"ok", engine:ENGINE_NAME, version:VERSION, action, geoRoute:geo, categoryLanePlan:buildCategoryLanePlan(qx, cats, geo), searchSkeleton:buildSearchSkeletonPolicy(qx, geo), resident:touchResidentSwitch({ reason:action, q:qx }) });
  }
  if(action === "supply" || action === "resident-supply") return ok(supplyResidentSync({ q:firstNonEmpty(merged.q, merged.query) }, { reason:"api-supply", limit:firstNonEmpty(merged.limit, merged.candidatePool, merged.candidatePoolTarget), candidatePoolTarget:firstNonEmpty(merged.candidatePool, merged.candidatePoolTarget), searchType:firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical), lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale), page:firstNonEmpty(merged.page, merged.p, merged.start), country:firstNonEmpty(merged.country, merged.region, merged.geo, detectRuntimeRegion(event || {}, firstNonEmpty(merged.lang, merged.uiLang, merged.locale), firstNonEmpty(merged.q, merged.query))) }));
  if(action === "supply-category" || action === "resident-supply-category") return ok(supplyCategorySync({ q:firstNonEmpty(merged.q, merged.query), category:firstNonEmpty(merged.category, merged.type) }, { reason:"api-supply-category", category:firstNonEmpty(merged.category, merged.type), limit:firstNonEmpty(merged.limit, merged.candidatePool, merged.candidatePoolTarget), candidatePoolTarget:firstNonEmpty(merged.candidatePool, merged.candidatePoolTarget), searchType:firstNonEmpty(merged.type, merged.category, merged.tab, merged.vertical), lang:firstNonEmpty(merged.lang, merged.uiLang, merged.locale), page:firstNonEmpty(merged.page, merged.p, merged.start), country:firstNonEmpty(merged.country, merged.region, merged.geo, detectRuntimeRegion(event || {}, firstNonEmpty(merged.lang, merged.uiLang, merged.locale), firstNonEmpty(merged.q, merged.query))) }));
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
  const action = low(firstNonEmpty(params && (params.action || params.mode || params.fn), event && event.queryStringParameters && (event.queryStringParameters.action || event.queryStringParameters.mode || event.queryStringParameters.fn)));
  if(action === "front-supply" || action === "slot-supply" || action === "content-supply" || action === "snapshot-supply" || action === "searchbank-supply"){
    const merged = Object.assign({}, event && event.queryStringParameters || {}, params || {});
    return buildSanmaruFrontSupplyPackage(firstNonEmpty(merged.q, merged.query, merged.section, merged.slot, merged.page, merged.targetPage, action), merged);
  }
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
  geoIpRouteMatrix: geoIpRouteMatrixSnapshot,
  ensureResidentBoot,
  residentBootSnapshot,
  providerHealthSnapshot,
  sanmaruProviderLaneSnapshot,
  touchResidentSwitch,
  supplyResidentSync,
  supplyCategorySync,
  triggerDeepRefresh,
  absorbResidentItems,
  buildSanmaruInstantOsPackage,
  buildSanmaruFrontSupplyPackage,
  sanmaruEvaluateOsaiSupplyDiscernment,
  sanmaruBuildSearchBankUnifiedContract,
  sanmaruBuildSupplyExpansionPlan
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
exports.geoIpRouteMatrix = geoIpRouteMatrixSnapshot;
exports.ensureResidentBoot = ensureResidentBoot;
exports.residentBootSnapshot = residentBootSnapshot;
exports.providerHealthSnapshot = providerHealthSnapshot;
exports.sanmaruProviderLaneSnapshot = sanmaruProviderLaneSnapshot;
exports.touchResidentSwitch = touchResidentSwitch;
exports.supplyResidentSync = supplyResidentSync;
exports.supplyCategorySync = supplyCategorySync;
exports.triggerDeepRefresh = triggerDeepRefresh;
exports.absorbResidentItems = absorbResidentItems;
exports.buildSanmaruInstantOsPackage = buildSanmaruInstantOsPackage;
exports.buildSanmaruFrontSupplyPackage = buildSanmaruFrontSupplyPackage;
exports.sanmaruEvaluateOsaiSupplyDiscernment = sanmaruEvaluateOsaiSupplyDiscernment;
try { ensureResidentBoot({ reason:"module-load" }); } catch(e) {}
