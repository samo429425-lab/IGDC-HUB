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

let CountrySupplyPolicy = null;
try { CountrySupplyPolicy = require("./lib/country-supply-policy.core.v1"); } catch (_e) { CountrySupplyPolicy = null; }

const VERSION = "search-bank-index-engine-v2.7.0-country-supply-aware";
const ENGINE_NAME = "search-bank-index";

const DEFAULT_LIMIT = 1000;
const DEFAULT_PER_PAGE = 25;
const MAX_LIMIT = 50000;
const MAX_PER_PAGE = 500;
const MAX_INDEX_ITEMS = 250000;
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
const FRONT_REAL_ITEM_FLOOR = 5000;
const FRONT_REAL_ITEM_SOFT_TARGET = 10000;
const FRONT_RESERVOIR_TARGET = 25000;
const FRONT_RESERVOIR_HARD_LIMIT = 50000;
const FRONT_FUTURE_EXPANSION_TARGET = 50000;
const PUBLIC_QUERY_STRICT_FRONT_BOUNDARY = true;
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
  lastRuntimeStat: null
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

function indexCountryCode(item){
  const value = item && (item.sourceCountry || item.source_country || item.countrySupply && item.countrySupply.sourceCountry || item.geo && item.geo.country || item.country);
  if(!value) return "";
  if(CountrySupplyPolicy && typeof CountrySupplyPolicy.normalizeCountry === "function") return CountrySupplyPolicy.normalizeCountry(value);
  return /^[A-Za-z]{2}$/.test(String(value).trim()) ? String(value).trim().toUpperCase() : "";
}
function resolveIndexCountryPlan(params, items, hub){
  if(!CountrySupplyPolicy || typeof CountrySupplyPolicy.resolveSupplyPlan !== "function") return null;
  try{
    const targetMarket = firstNonEmpty(params && params.targetMarket, params && params.targetCountry, params && params.audienceCountry, params && params.viewerCountry, params && params.country);
    if(!targetMarket) return null;
    const normalized = CountrySupplyPolicy.normalizeCountry ? CountrySupplyPolicy.normalizeCountry(targetMarket) : String(targetMarket).toUpperCase();
    const localCandidateCount = (Array.isArray(items) ? items : []).filter(item => indexCountryCode(item) === normalized && item && item.frontSupplyAllowed !== false && item.searchBankEligible !== false).length;
    return CountrySupplyPolicy.resolveSupplyPlan({ targetMarket:normalized, hub:hub || "default", localCandidateCount });
  }catch(_e){ return null; }
}
function attachIndexCountrySupply(item, plan, hub){
  if(!item || !plan || !CountrySupplyPolicy || typeof CountrySupplyPolicy.evaluateCandidateForTarget !== "function") return item;
  try{
    const current = item.countrySupply && typeof item.countrySupply === "object" ? item.countrySupply : null;
    const record = current && current.targetMarket === plan.targetMarket && current.policyVersion === plan.policyVersion
      ? current
      : CountrySupplyPolicy.evaluateCandidateForTarget(item, { plan, targetMarket:plan.targetMarket, hub:hub || "default", localCandidateCount:plan.localCandidateCount });
    return Object.assign({}, item, {
      countrySupply:record,
      sourceCountry:item.sourceCountry || (record.sourceCountryVerified ? record.sourceCountry : undefined),
      availabilityCountries:Array.isArray(item.availabilityCountries) ? item.availabilityCountries : record.availabilityCountries,
      supplyTier:record.supplyTier || item.supplyTier,
      countryPolicyVersion:record.policyVersion || item.countryPolicyVersion
    });
  }catch(_e){ return item; }
}
function countrySupplyScore(item){
  const record = item && item.countrySupply;
  if(!record) return 0;
  if(record.supplyTier === "same-country") return 34;
  if(/^neighbor-tier-/.test(record.supplyTier || "") && record.wouldAllowFrontSupply) return 12;
  if(record.supplyTier === "global" && record.wouldAllowFrontSupply) return 4;
  return record.wouldAllowFrontSupply === false ? -28 : 0;
}

function wantsOperationalFastProbe(params){
  params = params || {};
  const action = low(firstNonEmpty(params.action, params.mode, params.fn));
  return action === "ping" || action === "probe" || action === "fast-health" ||
    (action === "health" && !truthy(params.full) && !truthy(params.deep)) ||
    truthy(params.audit) || truthy(params.probe) || truthy(params.light) || truthy(params.fast);
}
function operationalFastProbe(params){
  const started = nowMs();
  const stat = snapshotStat();
  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    action:"fast-probe",
    role:"front-snapshot-reservoir-index-and-sanmaru-fast-memory-gateway",
    ok:true,
    probeReady:true,
    deep:false,
    noHeavyIndexBuild:true,
    externalCall:false,
    snapshot:{
      exists:!!stat,
      ok:!!stat,
      path:(stat && stat.path) || snapshotPath(),
      size:(stat && stat.size) || 0,
      mtimeMs:(stat && stat.mtimeMs) || null,
      hash:null,
      count:null
    },
    capabilities:{
      frontSupply:true,
      sectionIsolation:true,
      pageIsolation:true,
      compactOutput:true,
      jsonDownload:true,
      fullHealth:"action=health&full=1"
    },
    meta:{
      latency:nowMs() - started,
      note:"Fast operational probe only. Use action=health&full=1 for deeper reservoir counts."
    },
    generatedAt:nowIso()
  };
}
function compactItemForOps(item){
  item = item || {};
  const lp = item.layerPointer || {};
  return {
    id:firstNonEmpty(item.id, item.indexId, item.originalId),
    title:firstNonEmpty(item.title, item.name, item.label),
    page:firstNonEmpty(item.page, lp.page, item.route),
    section:firstNonEmpty(item.section, lp.section, item.psom_key, item.slotKey),
    slotKey:firstNonEmpty(item.slotKey, item.psom_key, lp.slotKey),
    url:firstNonEmpty(item.url, item.link, item.href),
    thumbnail:firstNonEmpty(item.thumbnail, item.thumb, item.image),
    provider:firstNonEmpty(item.provider, item.source),
    realContent:!!item.realContent,
    replaceableSlot:!!item.replaceableSlot,
    routeBucket:item.frontRouteBucket || null,
    requestedPage:item.frontRequestedPage || null,
    requestedSection:item.frontRequestedSection || null
  };
}
function maybeCompactResponse(body, params){
  params = params || {};
  if(!truthy(params.compact) && !truthy(params.summaryOnly)) return body;
  body = body || {};
  const src = Array.isArray(body.items) ? body.items : (Array.isArray(body.results) ? body.results : []);
  const compactItems = src.map(compactItemForOps);
  return Object.assign({}, body, {
    compact:true,
    items:compactItems,
    results:compactItems,
    rawItemFieldsOmitted:true,
    meta:Object.assign({}, body.meta || {}, { compact:true, rawItemFieldsOmitted:true })
  });
}
function safeFilenamePart(v){
  return s(v || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "result";
}
function responseFilename(params, body){
  params = params || {}; body = body || {};
  const action = safeFilenamePart(firstNonEmpty(params.filename, params.name, body.action, params.action, "search-bank-index"));
  const page = safeFilenamePart(firstNonEmpty(params.page, params.route, body.meta && body.meta.requestedPage));
  const section = safeFilenamePart(firstNonEmpty(params.section, params.slot, params.psom_key, body.meta && body.meta.requestedSection));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const middle = [action, page, section].filter(Boolean).join("_");
  return (middle || "search-bank-index") + "_" + stamp + ".json";
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
  const cwd = process.cwd();
  return unique([
    // Function-local candidates
    path.join(__dirname, name),
    path.join(__dirname, "data", name),

    // Repository/static root candidates
    path.join(cwd, name),
    path.join(cwd, "data", name),

    // Netlify included_files candidates. Bundled functions may run from /var/task while
    // included files stay under netlify/functions/**.
    path.join(cwd, "netlify", "functions", name),
    path.join(cwd, "netlify", "functions", "data", name),
    path.join(cwd, "functions", name),
    path.join(cwd, "functions", "data", name),
    path.join(__dirname, "netlify", "functions", name),
    path.join(__dirname, "netlify", "functions", "data", name),

    // Runtime writable fallback
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
function snapshotStat(){
  const file = snapshotPath();
  try{
    if(!file || !fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    return { path:file, mtimeMs: stat.mtimeMs, size: stat.size };
  }catch(e){ return null; }
}

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
function frontRouteKey(v){
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
function frontPageCanonical(v){
  const k = frontRouteKey(v);
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
function frontPageHintFromSection(v){
  const k = frontRouteKey(v);
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
function frontPageHintOfItem(item){
  item = item || {};
  const bind = normalizeBindValue(item.bind);
  const candidates = [
    item.page, bind.page, item.route, bind.route, item.path,
    item.section, item.psom_key, bind.section, bind.key, bind.slot, item.category, item.type,
    Array.isArray(item.tags) ? item.tags.join(" ") : ""
  ];
  for(const c of candidates){
    const direct = frontPageCanonical(c);
    if(direct) return direct;
    const bySection = frontPageHintFromSection(c);
    if(bySection) return bySection;
  }
  return "";
}
function routeValueOf(item){
  item = item || {};
  const bind = normalizeBindValue(item.bind);
  return firstNonEmpty(item.route, item.path, item.page, bind.page, bind.route, frontPageHintOfItem(item), item._sourceHint);
}
function pageValueOf(item){
  item = item || {};
  const bind = normalizeBindValue(item.bind);
  return firstNonEmpty(item.page, bind.page, frontPageHintOfItem(item), item.route, item.path, "");
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

function isFrontSupplyIndexItem(item){
  item = item || {};
  const lp = (item.layerPointer && typeof item.layerPointer === "object") ? item.layerPointer : layerPointerOf(item);
  const layerRole = low(firstNonEmpty(lp.layerRole, item.layerRole));
  const page = firstNonEmpty(lp.page, item.page, item.route, item.path, item.bind && (item.bind.page || item.bind.route));
  const section = firstNonEmpty(lp.section, item.section, item.psom_key, item.category, item.bind && (item.bind.section || item.bind.key));
  const slot = firstNonEmpty(lp.slotKey, item.slotKey, item.slot, item.bind && (item.bind.slotKey || item.bind.slot));
  const sourceText = low([
    item.source, item.provider, item.engine, item._sourceHint, item.indexSource, item.sourceFile,
    lp.source, item.generatedBy, item.storageSource, item.id
  ].filter(Boolean).join(" "));
  const frontRouteText = low([page, section, slot, item.psom_key, item.slotKey].filter(Boolean).join(" "));
  if(layerRole === "front-supply-layer") return true;
  if(/search-bank\.snapshot|snapshot-object|snapshot-array|front-data-ingested|front-supply|slot-supply|automap/.test(sourceText) && (page || section || slot)) return true;
  if(/search-bank|snapshot|front|slot/.test(sourceText) && /home|network|distribution|social|media|tour|literature|academic|donation|front|slot/.test(frontRouteText)) return true;
  return false;
}
function shouldExcludeFrontSupplyForQuery(params){
  params = params || {};
  const includeFrontSupply = truthy(params.frontSupply) || truthy(params.slotSupply) || truthy(params.layerMode) || truthy(params.slotMode) || truthy(params.snapshotLayer) || truthy(params.includeFrontSupply) || truthy(params.includeFrontSlots) || truthy(params.layerOnly) || truthy(params.pointerOnly);
  if(includeFrontSupply) return false;
  return PUBLIC_QUERY_STRICT_FRONT_BOUNDARY;
}
function hasRenderableText(item){
  item = item || {};
  return compactSpaces(stripHtml(firstNonEmpty(item.summary, item.description, item.snippet, item.content, item.text))).length >= 16;
}
function hasRenderableMedia(item){
  item = item || {};
  return !!firstNonEmpty(item.thumbnail, item.thumb, item.image, item.imageUrl, item.cover, Array.isArray(item.imageSet) && item.imageSet[0]);
}
function isRealIndexItem(item){
  item = item || {};
  if(item.isPlaceholder || isPlaceholder(item)) return false;
  const url = firstNonEmpty(item.url, item.link, item.href);
  const hasUrl = !!(url && url !== "#" && !/^javascript:/i.test(url));
  const hasTitle = !!firstNonEmpty(item.title, item.name, item.label);
  return !!(hasTitle && (hasUrl || hasRenderableText(item) || hasRenderableMedia(item)));
}
function frontSupplyQualityScore(item){
  item = item || {};
  let score = 0;
  const lp = item.layerPointer || layerPointerOf(item);
  if(isFrontSupplyIndexItem(item)) score += 80;
  if(isRealIndexItem(item)) score += 60;
  if(hasRenderableText(item)) score += 24;
  if(hasRenderableMedia(item)) score += 18;
  if(firstNonEmpty(lp.page, item.page, item.route)) score += 12;
  if(firstNonEmpty(lp.section, item.section, item.psom_key)) score += 10;
  if(firstNonEmpty(lp.slotKey, item.slotKey, item.slot)) score += 8;
  score += Math.max(0, Math.min(20, Number(item.rankHint || 0)));
  score += Math.max(0, Math.min(20, Number(item.sourceTrust || 0) * 20));
  if(item._promoted) score += 14;
  if(item._ingested) score += 10;
  return score;
}
function frontReservoirQualityScore(item){
  item = item || {};
  const lp = item.layerPointer || layerPointerOf(item);
  const pInfo = placeholderInfo(item);
  let score = frontSupplyQualityScore(item);
  if(isRealIndexItem(item)) score += 120;
  if(isFrontSupplyIndexItem(item)) score += 80;
  if(pInfo.canIndexAsLayerPointer || item.isLayerPointer) score += 42;
  if(pInfo.isPlaceholder) score += 18;
  if(firstNonEmpty(lp.slotKey, item.slotKey, item.slot)) score += 16;
  if(firstNonEmpty(lp.section, item.section, item.psom_key)) score += 14;
  if(firstNonEmpty(lp.page, item.page, item.route)) score += 12;
  const frontText = low([lp.page, lp.section, lp.slotKey, item.page, item.section, item.psom_key, item.type, item.category].filter(Boolean).join(" "));
  if(/academic|literature|arts|humanities|scholar|research|paper|book|문학|학술/.test(frontText)) score += 20;
  if(/distribution|product|commerce|donation|media|social|network|tour|home/.test(frontText)) score += 10;
  return score;
}
function normalizeFrontSupplyItem(item, role){
  const out = stripPrivateIndexFields(item);
  const pInfo = placeholderInfo(item);
  const lp = out.layerPointer || layerPointerOf(out);
  out.frontSupplyRole = role || (isRealIndexItem(item) ? "active-real-content" : "replaceable-front-slot");
  out.frontReservoir = true;
  out.targetConsumer = "front-snapshot";
  out.realContent = isRealIndexItem(item);
  out.replaceableSlot = !!(!out.realContent && (pInfo.isPlaceholder || pInfo.canIndexAsLayerPointer || out.isLayerPointer));
  out.needsHydration = !!out.replaceableSlot;
  out.layerPointer = lp;
  out.storagePolicy = out.realContent ? "front-active-real-content" : "front-reservoir-replaceable-slot-pointer";
  return out;
}

function frontReplacementRoute(seq){
  const routes = [
    { page:"front", section:"home", slot:"home-auto-replacement" },
    { page:"front", section:"distribution", slot:"distribution-auto-replacement" },
    { page:"front", section:"social", slot:"social-auto-replacement" },
    { page:"front", section:"media", slot:"media-auto-replacement" },
    { page:"front", section:"donation", slot:"donation-auto-replacement" },
    { page:"front", section:"network", slot:"network-auto-replacement" },
    { page:"front", section:"tour", slot:"tour-auto-replacement" },
    { page:"front", section:"literature", slot:"literature-auto-replacement" },
    { page:"front", section:"academic", slot:"academic-auto-replacement" }
  ];
  return routes[Math.abs(seq || 0) % routes.length];
}
function frontReplacementQualityScore(item){
  item = item || {};
  let score = 0;
  if(isRealIndexItem(item)) score += 160;
  if(hasRenderableText(item)) score += 34;
  if(hasRenderableMedia(item)) score += 24;
  if(firstNonEmpty(item.url, item.link, item.href)) score += 18;
  if(firstNonEmpty(item.title, item.name, item.label)) score += 14;
  score += Math.max(0, Math.min(40, Number(item.rankHint || 0)));
  score += Math.max(0, Math.min(40, Number(item.sourceTrust || 0) * 40));
  const text = low([item.type, item.category, item.section, item.page, item.route, item.provider, item.source].filter(Boolean).join(" "));
  if(/product|commerce|shop|distribution|donation|media|social|network|tour|local|culture|academic|literature|book|paper|research|문학|학술|상품|기부|미디어|소셜|네트워크|관광/.test(text)) score += 20;
  if(/search|query|provider\s*hint|route\s*hint|fallback/.test(text)) score -= 80;
  if(isPlaceholder(item)) score -= 120;
  return score;
}
function normalizeFrontReplacementItem(item, seq){
  const base = stripPrivateIndexFields(item);
  const route = frontReplacementRoute(seq);
  const currentPointer = base.layerPointer || layerPointerOf(base);
  const out = Object.assign({}, base);
  out.frontSupplyRole = "standby-front-replacement";
  out.frontReservoir = true;
  out.frontAutoReplacement = true;
  out.targetConsumer = "front-snapshot";
  out.realContent = isRealIndexItem(item);
  out.replaceableSlot = false;
  out.needsHydration = false;
  out.layerPointer = {
    layerRole: "front-supply-layer",
    page: firstNonEmpty(currentPointer.page, out.page, route.page),
    section: firstNonEmpty(currentPointer.section, out.section, out.category, route.section),
    slotKey: firstNonEmpty(currentPointer.slotKey, out.slotKey, out.slot, route.slot + "-" + String((seq || 0) + 1)),
    route: firstNonEmpty(currentPointer.route, out.route, route.page),
    source: firstNonEmpty(currentPointer.source, out.source, out.provider, "search-bank-index-auto-replacement"),
    storagePolicy: "front-standby-real-content-replacement",
    directStorage: false,
    externalCall: false
  };
  out.storagePolicy = "front-standby-real-content-replacement";
  out.replacementPolicy = "fill-any-front-shortage-immediately-with-ranked-standby-real-content";
  return out;
}
function addFrontAlias(set, v){
  const k = frontRouteKey(v);
  if(!k) return;
  set.add(k);
  set.add(k.replace(/-/g, "_"));
  set.add(k.replace(/_/g, "-"));
}
const SECTION_ALIAS_PAIRS = [
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
function sectionAliasSet(v){
  const set = new Set();
  const raw = Array.isArray(v) ? v : [v];
  for(const x of raw){
    if(x == null) continue;
    const parts = s(x).split(/[\s,|]+/).filter(Boolean);
    for(const p of parts.length ? parts : [x]) addFrontAlias(set, p);
  }
  let changed = true;
  while(changed){
    changed = false;
    for(const pair of SECTION_ALIAS_PAIRS){
      const a = frontRouteKey(pair[0]);
      const b = frontRouteKey(pair[1]);
      if(set.has(a) && !set.has(b)){ addFrontAlias(set, b); changed = true; }
      if(set.has(b) && !set.has(a)){ addFrontAlias(set, a); changed = true; }
    }
  }
  return set;
}
function pageAliasSet(v){
  const set = new Set();
  const raw = Array.isArray(v) ? v : [v];
  for(const x of raw){
    if(x == null) continue;
    const parts = s(x).split(/[\s,|]+/).filter(Boolean);
    for(const p of parts.length ? parts : [x]){
      const canonical = frontPageCanonical(p) || frontPageHintFromSection(p);
      addFrontAlias(set, canonical || p);
      if(canonical === "home") ["home.html", "index", "front", "web"].forEach(a => addFrontAlias(set, a));
      if(canonical === "networkhub") ["network", "networkhub.html", "market", "network-right"].forEach(a => addFrontAlias(set, a));
      if(canonical === "distributionhub") ["distribution", "distributionhub.html", "commerce", "product"].forEach(a => addFrontAlias(set, a));
      if(canonical === "socialnetwork") ["social", "socialnetwork.html", "sns"].forEach(a => addFrontAlias(set, a));
      if(canonical === "mediahub") ["media", "mediahub.html", "video"].forEach(a => addFrontAlias(set, a));
      if(canonical === "literature_academic") ["literature", "academic", "literature_academic.html"].forEach(a => addFrontAlias(set, a));
    }
  }
  return set;
}
function frontTokenLooksLikeRoute(v){
  const k = frontRouteKey(v);
  if(!k || k.length > 80) return false;
  if(frontPageCanonical(k) || frontPageHintFromSection(k)) return true;
  if(/^home-[0-9]+$|^dist[0-9]+$/.test(k)) return true;
  return SECTION_ALIAS_PAIRS.some(pair => frontRouteKey(pair[0]) === k || frontRouteKey(pair[1]) === k);
}
function requestedFrontTarget(params){
  params = params || {};
  let section = firstNonEmpty(params.section, params.psom_key, params.psomKey, params.slot, params.slotKey, params.targetSection, params.targetSlot, params.key);
  let page = firstNonEmpty(params.page, params.targetPage, params.route, params.hub, params.channel, params.frontPage, params.pageKey);
  const q = firstNonEmpty(params.q, params.query);
  if(!section && !page && frontTokenLooksLikeRoute(q)){
    const fromQPage = frontPageCanonical(q);
    const fromQSectionPage = frontPageHintFromSection(q);
    if(fromQPage && fromQPage === frontRouteKey(q)) page = q;
    else if(fromQSectionPage) section = q;
    else page = q;
  }
  const sectionAliases = sectionAliasSet(section);
  const pageAliases = pageAliasSet(page);
  for(const sec of Array.from(sectionAliases)){
    const inferred = frontPageHintFromSection(sec);
    if(inferred) addFrontAlias(pageAliases, inferred);
  }
  return { page, section, pageAliases, sectionAliases, hasPage:pageAliases.size>0, hasSection:sectionAliases.size>0, hasTarget:pageAliases.size>0 || sectionAliases.size>0 };
}
function frontItemRouteSets(item){
  item = item || {};
  const bind = normalizeBindValue(item.bind);
  const lp = (item.layerPointer && typeof item.layerPointer === "object") ? item.layerPointer : {};
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const sectionValues = [lp.section, lp.slotKey, item.section, item.psom_key, item.slotKey, item.slot, bind.section, bind.key, bind.slot, bind.slotKey, item.category].concat(tags);
  const pageValues = [lp.page, lp.route, item.page, item.route, item.path, bind.page, bind.route, frontPageHintOfItem(item)].concat(tags, sectionValues.map(frontPageHintFromSection));
  return { pageAliases:pageAliasSet(pageValues), sectionAliases:sectionAliasSet(sectionValues) };
}
function setIntersects(a, b){
  if(!a || !b || !a.size || !b.size) return false;
  for(const x of a){ if(b.has(x)) return true; }
  return false;
}
function frontTargetBucket(item, target){
  if(!target || !target.hasTarget) return "global";
  const routes = frontItemRouteSets(item);
  const sectionMatch = target.hasSection && setIntersects(routes.sectionAliases, target.sectionAliases);
  const pageMatch = target.hasPage && setIntersects(routes.pageAliases, target.pageAliases);
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
function frontRouteRank(item, target){
  const bucket = frontTargetBucket(item, target);
  if(bucket === "exact") return 300000;
  if(bucket === "page-fallback") return 200000;
  if(bucket === "global" || bucket === "global-fallback") return 100000;
  return 0;
}
function isSearchProviderHintItem(item){
  item = item || {};
  const text = low([item.title, item.name, item.label, item.summary, item.description, item.type, item.category, item.source, item.provider, item.engine, item.generatedBy, item.url, item.link, item.href].filter(Boolean).join(" "));
  return /provider\s*hint|route\s*hint|search\s*route|검색\s*통로|google_public_search|naver_public_search|bing_public_search|search\.naver\.com|google\.com\/search|bing\.com\/search/.test(text);
}
function buildFrontReplacementPool(allRaw, seen){
  const pool = (Array.isArray(allRaw) ? allRaw : [])
    .filter(item => item && isRealIndexItem(item))
    .filter(item => !isPlaceholder(item))
    .filter(item => !/provider\s*hint|route\s*hint|검색\s*통로|search\s*route/i.test([item.type, item.category, item.title, item.summary, item.description, item.source, item.provider].filter(Boolean).join(" ")))
    .map((item, idx) => Object.assign({}, item, { frontReplacementScore:frontReplacementQualityScore(item), _replacementSeq:idx }))
    .filter(item => {
      const sig = slotDedupeSignature(item);
      return !!sig && !(seen && seen.has(sig));
    })
    .sort((a,b) => (b.frontReplacementScore || 0) - (a.frontReplacementScore || 0) || (a._replacementSeq || 0) - (b._replacementSeq || 0));
  return pool;
}
function buildFrontSupplyPool(params){
  const started = nowMs();
  params = params || {};
  const requestedTarget = firstNonEmpty(params.limit, params.frontSupplyTarget, params.target);
  const actionText = low(firstNonEmpty(params.action, params.mode, params.fn));
  const wantsReservoir = actionText === "reservoir" || truthy(params.reservoir) || truthy(params.includeReservoir) || truthy(params.slotSupply) || truthy(params.frontSupply) || !requestedTarget;
  const defaultTarget = wantsReservoir ? FRONT_RESERVOIR_TARGET : FRONT_REAL_ITEM_FLOOR;
  const target = clampInt(requestedTarget, defaultTarget, 1, FRONT_RESERVOIR_HARD_LIMIT);
  const targetRoute = requestedFrontTarget(params);
  const allowGlobalFallback = !targetRoute.hasTarget || !truthy(params.strictSectionOnly || params.exactOnly || params.noFallback);
  const allowPageFallback = !targetRoute.hasTarget || !truthy(params.strictSectionOnly || params.exactOnly);
  const idx = loadIndex(false);
  ensureRuntime(idx);
  const base = Array.isArray(idx && idx.items) ? idx.items : [];
  const promoted = loadPromoted().map((x,i) => indexItem(Object.assign({}, x, { _promoted:true }), i, "sanmaru-promoted")).filter(Boolean);
  const ingested = loadIngested().map((x,i) => indexItem(Object.assign({}, x, { _ingested:true }), i, "front-data-ingested")).filter(Boolean);
  const allRaw = promoted.concat(ingested).concat(base);
  const countrySupplyPlan = resolveIndexCountryPlan(params, allRaw, targetRoute.page || targetRoute.section || params.channel || "default");
  const countrySupplyEnforced = !!(countrySupplyPlan && countrySupplyPlan.enforcement === "enforce");
  let countryPolicyHeldCount = 0;
  const all = allRaw
    .filter(item => isFrontSupplyIndexItem(item))
    .filter(item => !isSearchProviderHintItem(item))
    .map(item => attachIndexCountrySupply(item, countrySupplyPlan, targetRoute.page || targetRoute.section || params.channel || "default"))
    .filter(item => {
      const held = countrySupplyEnforced && item && item.countrySupply && item.countrySupply.frontSupplyAllowed === false;
      if(held) countryPolicyHeldCount++;
      return !held;
    });
  const exactPool = [];
  const pageFallbackPool = [];
  const globalPool = [];
  for(let i=0; i<all.length; i++){
    const item = all[i];
    const bucket = frontTargetBucket(item, targetRoute);
    const role = isRealIndexItem(item) ? "active-real-content" : "replaceable-front-slot";
    const scored = Object.assign({}, item, { frontSupplyScore:frontReservoirQualityScore(item) + frontRouteRank(item, targetRoute) + countrySupplyScore(item), _frontSeq:i, _frontRole:role, _frontRouteBucket:bucket });
    if(bucket === "exact" || !targetRoute.hasTarget) exactPool.push(scored);
    else if(bucket === "page-fallback") pageFallbackPool.push(scored);
    else globalPool.push(scored);
  }
  const sortFront = (a,b) => {
    const ar = a._frontRole === "active-real-content" ? 1 : 0;
    const br = b._frontRole === "active-real-content" ? 1 : 0;
    return br - ar || (b.frontSupplyScore || 0) - (a.frontSupplyScore || 0) || (a._frontSeq || 0) - (b._frontSeq || 0);
  };
  exactPool.sort(sortFront);
  pageFallbackPool.sort(sortFront);
  globalPool.sort(sortFront);

  const activePool = all
    .filter(item => isRealIndexItem(item))
    .map((item, idx) => Object.assign({}, item, { frontSupplyScore:frontSupplyQualityScore(item) + frontRouteRank(item, targetRoute) + countrySupplyScore(item), _frontSeq:idx, _frontRole:"active-real-content", _frontRouteBucket:frontTargetBucket(item, targetRoute) }))
    .sort(sortFront);
  const reservoirPool = exactPool.concat(allowPageFallback ? pageFallbackPool : []).concat(allowGlobalFallback ? globalPool : []);
  const seen = new Set();
  const items = [];
  const returnedBuckets = { exact:0, pageFallback:0, globalFallback:0, global:0 };
  const addItem = item => {
    if(!item || items.length >= target) return;
    const sig = slotDedupeSignature(item);
    if(!sig || seen.has(sig)) return;
    seen.add(sig);
    const out = normalizeFrontSupplyItem(item, item._frontRole);
    out.frontRouteBucket = item._frontRouteBucket || "global";
    if(targetRoute.hasTarget){
      out.frontRequestedPage = targetRoute.page || null;
      out.frontRequestedSection = targetRoute.section || null;
    }
    delete out._frontSeq;
    delete out._frontRole;
    delete out._frontRouteBucket;
    const bucketKey = out.frontRouteBucket === "page-fallback" ? "pageFallback" : (out.frontRouteBucket === "global-fallback" ? "globalFallback" : out.frontRouteBucket);
    if(returnedBuckets[bucketKey] != null) returnedBuckets[bucketKey]++;
    items.push(out);
  };
  for(const item of reservoirPool) addItem(item);

  const beforeReplacementCount = items.length;
  const replacementPool = buildFrontReplacementPool(all, seen)
    .map((item, idx) => Object.assign({}, item, { _frontRouteBucket:"standby-replacement", _replacementSeq:idx }))
    .filter(item => !targetRoute.hasTarget || allowGlobalFallback);
  let replacementReturnedCount = 0;
  const addReplacement = item => {
    if(!item || items.length >= target) return;
    const sig = slotDedupeSignature(item);
    if(!sig || seen.has(sig)) return;
    seen.add(sig);
    const out = normalizeFrontReplacementItem(item, replacementReturnedCount);
    out.frontRouteBucket = "standby-replacement";
    if(targetRoute.hasTarget){
      out.frontRequestedPage = targetRoute.page || null;
      out.frontRequestedSection = targetRoute.section || null;
    }
    delete out._replacementSeq;
    items.push(out);
    replacementReturnedCount++;
  };
  for(const item of replacementPool){
    if(items.length >= target) break;
    addReplacement(item);
  }

  const realActiveCount = activePool.length;
  const reservoirCandidateCount = reservoirPool.length;
  const exactCandidateCount = exactPool.length;
  const pageFallbackCandidateCount = pageFallbackPool.length;
  const globalFallbackCandidateCount = globalPool.length;
  const replaceableSlotCount = Math.max(0, items.filter(x => x && x.replaceableSlot).length);
  const activeReturnedCount = items.filter(x => x && x.realContent).length;
  const layerPointerReturnedCount = items.filter(x => x && x.isLayerPointer).length;
  const pageCoverage = Object.create(null);
  const sectionCoverage = Object.create(null);
  for(const item of items){
    const lp = item.layerPointer || {};
    const pg = firstNonEmpty(frontPageCanonical(lp.page), frontPageCanonical(item.page), frontPageHintOfItem(item), lp.page, item.page, item.route, "unknown");
    const sec = firstNonEmpty(lp.section, item.section, item.psom_key, "unknown");
    pageCoverage[pg] = (pageCoverage[pg] || 0) + 1;
    sectionCoverage[sec] = (sectionCoverage[sec] || 0) + 1;
  }
  return {
    status:"ok", engine:ENGINE_NAME, version:VERSION, action:"front-supply", source:items.length ? "search-bank-index-front-reservoir" : null, items, results:items,
    meta:{
      count:items.length, target, requestedPage:targetRoute.page || null, requestedSection:targetRoute.section || null,
      targetRouteStrict:targetRoute.hasTarget, allowPageFallback, allowGlobalFallback,
      countrySupplyPolicy: countrySupplyPlan ? { targetMarket:countrySupplyPlan.targetMarket, policyVersion:countrySupplyPlan.policyVersion, enforcement:countrySupplyPlan.enforcement, localCandidateCount:countrySupplyPlan.localCandidateCount, localShortage:countrySupplyPlan.localShortage } : null,
      countrySupplyEnforced, countryPolicyHeldCount,
      exactCandidateCount, pageFallbackCandidateCount, globalFallbackCandidateCount,
      exactReturnedCount:returnedBuckets.exact || 0,
      pageFallbackReturnedCount:returnedBuckets.pageFallback || 0,
      globalFallbackReturnedCount:returnedBuckets.globalFallback || returnedBuckets.global || 0,
      floor:FRONT_REAL_ITEM_FLOOR, softTarget:FRONT_REAL_ITEM_SOFT_TARGET, reservoirTarget:FRONT_RESERVOIR_TARGET,
      hardLimit:FRONT_RESERVOIR_HARD_LIMIT, futureExpansionTarget:FRONT_FUTURE_EXPANSION_TARGET,
      shortage:Math.max(0, target - items.length), shortageBeforeReplacement:Math.max(0, target - beforeReplacementCount),
      autoReplacementEnabled:true, autoReplacementPolicy:"exact-section-first-page-fallback-second-global-fallback-only-on-shortage",
      replacementCandidateCount:replacementPool.length, replacementReturnedCount, shortageFilledByReplacement:replacementReturnedCount,
      realActiveCount, activeReturnedCount, activeFloorShortage:Math.max(0, FRONT_REAL_ITEM_FLOOR - realActiveCount),
      activeSoftShortage:Math.max(0, FRONT_REAL_ITEM_SOFT_TARGET - realActiveCount), reservoirCandidateCount,
      reservoirReturnedCount:items.length, reservoirShortage:Math.max(0, FRONT_RESERVOIR_TARGET - reservoirCandidateCount),
      replaceableSlotCount, layerPointerReturnedCount, standbyReplacementReady:replacementPool.length > 0,
      finalSupplyComplete:items.length >= target, frontRealFloorReady:realActiveCount >= FRONT_REAL_ITEM_FLOOR,
      frontReservoirReady:reservoirCandidateCount >= FRONT_RESERVOIR_TARGET, frontImmediateSupplyReady:items.length >= FRONT_REAL_ITEM_FLOOR,
      pageCoverage, sectionCoverage, frontSupplyOnly:true, placeholderIsolation:true, sectionIsolation:true, pageIsolation:true,
      searchUiSafe:true, externalCall:false, latency:nowMs() - started,
      storagePolicy:"front-reservoir-real-content-plus-replaceable-slot-pointers"
    }
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
  return Object.assign({}, item, c, {
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
  const snapStat = snapshotStat();
  const stat = {
    rawCount: rawItems.length,
    activeCount,
    layerPointerCount,
    hardFiltered,
    totalIndexed: indexed.length,
    layerCoverage,
    sectionCoverage,
    pageCoverage,
    snapshotPath: snapFile,
    snapshotMtime: snapStat ? snapStat.mtimeMs : null,
    snapshotSize: snapStat ? snapStat.size : null,
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
  const snapStat = snapshotStat();
  const snapshotMatches = saved && saved.meta && (!snapStat || (saved.meta.snapshotMtime === snapStat.mtimeMs && saved.meta.snapshotSize === snapStat.size));
  if(!forceBuild && saved && Array.isArray(saved.items) && saved.version === VERSION && snapshotMatches){
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
  const q = firstNonEmpty(params && params.q, params && params.query);
  const normalized = normalizeText(q);
  if(!normalized) return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:q, items:[], results:[], meta:{ count:0, reason:"EMPTY_QUERY" } };

  const requestedLimit = clampInt(params && params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = clampInt(params && params.page, 1, 1, 100000);
  const perPageWasProvided = params && (params.perPage != null || params.pageSize != null || params.size != null);
  const perPage = clampInt(firstNonEmpty(params && params.perPage, params && params.pageSize, params && params.size), DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const offset = clampInt(params && params.offset, perPageWasProvided || page > 1 ? (page - 1) * perPage : 0, 0, 10000000);
  const sliceSize = perPageWasProvided || page > 1 ? perPage : requestedLimit;
  const type = low(firstNonEmpty(params && (params.type || params.category || params.tab || params.vertical), "all")) || "all";
  const includeFacets = truthy(params && (params.facets || params.includeFacets || params.debug));
  const includePlaceholders = truthy(params && (params.includePlaceholders || params.frontSupply || params.layerMode || params.slotMode || params.snapshotLayer));
  const layerOnly = truthy(params && (params.layerOnly || params.pointerOnly));
  const excludeFrontSupply = shouldExcludeFrontSupplyForQuery(params);

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
  let frontSupplyFiltered = 0;
  for(const item of pool){
    if(!item){ continue; }
    const placeholder = !!(item.isPlaceholder || isPlaceholder(item));
    if(excludeFrontSupply && isFrontSupplyIndexItem(item)){ frontSupplyFiltered++; continue; }
    if(placeholder && !includePlaceholders){ placeholderFiltered++; continue; }
    if(layerOnly && !item.isLayerPointer) continue;
    const sc = scoreIndexedItem(qInfo, item, type) + (placeholder && includePlaceholders ? 30 : 0);
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
      excludeFrontSupply,
      publicQueryStrictFrontBoundary:PUBLIC_QUERY_STRICT_FRONT_BOUNDARY,
      promoted: promoted.length,
      ingested: ingested.length,
      type,
      placeholderFiltered,
      frontSupplyFiltered,
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
  const frontPool = buildFrontSupplyPool({ limit:FRONT_REAL_ITEM_FLOOR });
  return {
    status:"ok",
    engine:ENGINE_NAME,
    version:VERSION,
    role:"front-snapshot-reservoir-index-and-sanmaru-fast-memory-gateway",
    snapshotPath:snapshotPath(),
    indexPath:tmpIndexPath(),
    promotedPath:tmpPromotedPath(),
    ingestedPath:tmpIngestedPath(),
    indexCount:idx && Array.isArray(idx.items) ? idx.items.length : 0,
    activeIndexCount:runtime && Number.isFinite(runtime.activeCount) ? runtime.activeCount : 0,
    layerPointerCount:runtime && Number.isFinite(runtime.layerPointerCount) ? runtime.layerPointerCount : 0,
    promotedCount:loadPromoted().length,
    ingestedCount:loadIngested().length,
    frontRealFloor:FRONT_REAL_ITEM_FLOOR,
    frontRealCount:frontPool.meta.realActiveCount,
    frontReturnedCount:frontPool.meta.count,
    frontReservoirTarget:FRONT_RESERVOIR_TARGET,
    frontReservoirCount:frontPool.meta.reservoirCandidateCount,
    frontReservoirShortage:frontPool.meta.reservoirShortage,
    frontRealShortage:frontPool.meta.activeFloorShortage,
    frontImmediateSupplyReady:frontPool.meta.frontImmediateSupplyReady,
    frontRealFloorReady:frontPool.meta.frontRealFloorReady,
    frontReservoirReady:frontPool.meta.frontReservoirReady,
    runtimeTokenCount:runtime && runtime.tokenMap ? runtime.tokenMap.size : 0,
    runtimePageCount:runtime && runtime.pageMap ? runtime.pageMap.size : 0,
    runtimeSectionCount:runtime && runtime.sectionMap ? runtime.sectionMap.size : 0,
    cacheLoaded:!!state.index,
    warmResidentUntil: new Date(nowMs() + RESIDENT_WARM_TTL_MS).toISOString(),
    layerCoverage: stat.layerCoverage || null,
    pageCoverage: stat.pageCoverage || null,
    sectionCoverage: stat.sectionCoverage || null,
    securityPolicy:"admin token required for build/rebuild/promote/ingest/export; query remains read-only",
    rolePolicy:"Search Bank Index keeps the front snapshot reservoir hot for Sanmaru; active real content and replaceable slot pointers are separated; no external API calls are performed",
    generatedAt:nowIso()
  };
}
function ok(body, params){
  params = params || {};
  const headers = {
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store, no-cache, must-revalidate, max-age=0",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"content-type, authorization",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
  };
  if(truthy(params.download) || truthy(params.attachment)){
    headers["Content-Disposition"] = 'attachment; filename="' + responseFilename(params, body) + '"';
    headers["X-Content-Type-Options"] = "nosniff";
  }
  return { statusCode:200, headers, body:JSON.stringify(body, null, truthy(params.pretty) ? 2 : 0) };
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
  if(wantsOperationalFastProbe(merged)) return Object.assign(operationalFastProbe(merged), { security:{ allowed:true, admin:security.admin } });
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
  if(action === "front-supply" || action === "slot-supply" || action === "front-pool" || action === "reservoir" || action === "front-floor") return buildFrontSupplyPool(merged);
  if(action === "stats" || action === "facets"){
    const res = queryIndex(Object.assign({}, merged, { includeFacets:true, limit:1 }));
    return { status:"ok", engine:ENGINE_NAME, version:VERSION, query:res.query, meta:res.meta };
  }
  return queryIndex(merged);
}
async function handler(event){
  if(event && event.httpMethod === "OPTIONS") return ok({ status:"ok" }, {});
  const body = parseBody(event || {});
  const qs = (event && event.queryStringParameters) || {};
  const responseParams = Object.assign({}, qs, body || {});
  const res = maybeCompactResponse(await runEngine(event || {}, body), responseParams);
  return ok(res, responseParams);
}

module.exports = { version:VERSION, runEngine, handler, query:queryIndex, promote, ingest, health, buildIndexFromSnapshot, loadIndex, buildFrontSupplyPool, operationalFastProbe };
exports.version = VERSION;
exports.runEngine = runEngine;
exports.handler = handler;
exports.query = queryIndex;
exports.promote = promote;
exports.ingest = ingest;
exports.health = health;

exports.buildFrontSupplyPool = buildFrontSupplyPool;

exports.operationalFastProbe = operationalFastProbe;
