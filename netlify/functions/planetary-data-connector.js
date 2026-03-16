"use strict";

/*
MARU Planetary Data Connector — v100
------------------------------------------------------------
Planetary Intelligence Connector

Upgrade policy
- v50 반환 구조 최대 보존
- Search / Router / Collector / Insight / Search Bridge 호환 유지
- External source gateway + adaptive routing + federation layer
- Security / timeout / resilience / reputation learning 확장
- 기존 adapter(query) 방식 유지
- 추가로 adapter(query, context) 허용

Primary compatibility goals
- connect(event, params) 유지
- registerSourceAdapter(name, adapter, meta) 유지
- registerSource(name, meta) 유지
- results[].source / region / type / sourceTrust / timestamp / data 유지
- Search Engine가 기대하는 res.results 구조 유지
*/

let Core = null;
let Resilience = null;

try { Core = require("./core"); } catch(e){}
try { Resilience = require("./maru-resilience-engine"); } catch(e){}

const VERSION = "planetary-data-hub-v100";

/* ------------------------------------------------------------
BASE CONFIG
------------------------------------------------------------ */

const SOURCE_ADAPTERS = {};
const SOURCE_REGISTRY = {};
const SOURCE_STATS = {};
const SOURCE_REPUTATION = {};
const WHITELIST = new Set();

const TELEMETRY = [];
const TELEMETRY_MAX = 5000;

const FEDERATION_NODES = {};

let LAST_CALL = 0;

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 300;
const MAX_QUERY_LENGTH = 200;
const MIN_CALL_INTERVAL = 60;
const DEFAULT_TIMEOUT = 8000;
const MAX_PARALLEL_SOURCES = 20;

/* ------------------------------------------------------------
UTIL
------------------------------------------------------------ */

function now(){
  return Date.now();
}

function nowIso(){
  if(Core && typeof Core.nowIso === "function") return Core.nowIso();
  return new Date().toISOString();
}

function clampInt(v, d, min, max){
  if(Core && typeof Core.safeInt === "function"){
    return Core.safeInt(v, d, min, max);
  }
  const n = Number(v);
  if(!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function safeClone(obj){
  try{
    return JSON.parse(JSON.stringify(obj));
  }catch(e){
    return null;
  }
}

function s(x){
  return String(x == null ? "" : x);
}

function low(x){
  return s(x).trim().toLowerCase();
}

function stableArray(arr){
  return Array.isArray(arr) ? arr : [];
}

function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

function logTelemetry(entry){
  TELEMETRY.push({
    time: now(),
    ...entry
  });
  if(TELEMETRY.length > TELEMETRY_MAX){
    TELEMETRY.shift();
  }
}

/* ------------------------------------------------------------
QUERY / SECURITY
------------------------------------------------------------ */

function sanitizeQuery(q){
  return JSON.stringify(q || {})
    .replace(/[<>;$`]/g,"")
    .replace(/script/gi,"")
    .replace(/process\.env/gi,"")
    .replace(/drop\s+table/gi,"")
    .replace(/rm\s+-rf/gi,"");
}

function normalizeParams(event, params = {}){
  const qp = event?.queryStringParameters || {};
  const merged = { ...qp, ...(params || {}) };

  const rawQuery = s(merged.q || merged.query || "").trim();
  const validated =
    Core && typeof Core.validateQuery === "function"
      ? Core.validateQuery(rawQuery)
      : { ok: !!rawQuery, value: rawQuery, code: rawQuery ? null : "BAD_QUERY" };

  let q = validated.ok ? s(validated.value).trim() : rawQuery;
  q = q.replace(/[<>;$`]/g,"").slice(0, MAX_QUERY_LENGTH);

  return {
    q,
    query: q,
    limit: clampInt(merged.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    region: merged.region || null,
    route: merged.route || merged.channel || merged.scope || null,
    intent: merged.intent || null,
    mode: merged.mode || null,
    type: merged.type || null,
    source: merged.source || null,
    federation: merged.federation !== "off",
    raw: merged,
    queryValid: !!validated.ok,
    queryCode: validated.code || null
  };
}


/* ------------------------------------------------------------
REGISTRY / FEDERATION
------------------------------------------------------------ */

function ensureStats(name){
  if(!SOURCE_STATS[name]){
    SOURCE_STATS[name] = {
      calls: 0,
      ok: 0,
      fail: 0,
      timeout: 0,
      blocked: 0,
      skipped: 0,
      totalDuration: 0,
      lastDuration: 0,
      lastStatus: "unknown",
      updatedAt: 0
    };
  }
  return SOURCE_STATS[name];
}

function ensureReputation(name){
  if(!SOURCE_REPUTATION[name]){
    SOURCE_REPUTATION[name] = {
      credibility: 0.5,
      consistency: 0.5,
      freshness: 0.5,
      availability: 0.5
    };
  }
  return SOURCE_REPUTATION[name];
}

function registerSource(name, meta = {}){
  SOURCE_REGISTRY[name] = {
    name,
    type: meta.type || "unknown",
    region: meta.region || "global",
    credibility: typeof meta.credibility === "number" ? meta.credibility : 0.5,
    institution: meta.institution || null,
    route: meta.route || null,
    tags: Array.isArray(meta.tags) ? meta.tags.slice(0, 20) : [],
    priority: typeof meta.priority === "number" ? meta.priority : 0.5,
    discovery: !!meta.discovery,
    federationNode: meta.federationNode || null
  };

  ensureStats(name);
  ensureReputation(name);
}

function registerFederationNode(name, meta = {}){
  FEDERATION_NODES[name] = {
    name,
    region: meta.region || "global",
    type: meta.type || "generic",
    priority: typeof meta.priority === "number" ? meta.priority : 0.5,
    tags: Array.isArray(meta.tags) ? meta.tags.slice(0,20) : []
  };
}

function registerSourceAdapter(name, adapter, meta = {}){
  SOURCE_ADAPTERS[name] = adapter;
  WHITELIST.add(name);
  registerSource(name, meta);

  if(meta.federationNode){
    registerFederationNode(meta.federationNode, {
      region: meta.region || "global",
      type: meta.type || "generic",
      priority: typeof meta.priority === "number" ? meta.priority : 0.5,
      tags: meta.tags || []
    });
  }
}

/* ------------------------------------------------------------
TRUST / REPUTATION
------------------------------------------------------------ */

function computeTrust(source){
  const meta = SOURCE_REGISTRY[source];
  if(!meta) return 0.5;

  let score = meta.credibility;

  if(meta.type === "government") score += 0.2;
  if(meta.type === "science") score += 0.2;
  if(meta.type === "research") score += 0.15;

  const stats = SOURCE_STATS[source];
  const rep = SOURCE_REPUTATION[source];

  if(stats && stats.calls >= 3){
    const failRatio = stats.fail / Math.max(1, stats.calls);
    const timeoutRatio = stats.timeout / Math.max(1, stats.calls);
    score -= Math.min(0.25, failRatio * 0.25);
    score -= Math.min(0.15, timeoutRatio * 0.15);
  }

  if(rep){
    score += (rep.consistency - 0.5) * 0.20;
    score += (rep.freshness - 0.5) * 0.10;
    score += (rep.availability - 0.5) * 0.15;
  }

  if(score > 1) score = 1;
  if(score < 0.05) score = 0.05;

  return score;
}

function learnSource(source, result){
  const rep = ensureReputation(source);

  if(result.status === "ok"){
    rep.availability = Math.min(1, rep.availability * 0.9 + 0.1 * 1);
    rep.consistency = Math.min(1, rep.consistency * 0.92 + 0.08 * 0.9);

    if(typeof result.itemCount === "number"){
      const freshSignal = result.itemCount > 0 ? 0.8 : 0.45;
      rep.freshness = Math.min(1, rep.freshness * 0.92 + 0.08 * freshSignal);
    }
  }else{
    rep.availability = Math.max(0.05, rep.availability * 0.92);
    rep.consistency = Math.max(0.05, rep.consistency * 0.95);
  }
}

/* ------------------------------------------------------------
ROUTING / SOURCE SELECTION
------------------------------------------------------------ */

function regionMatch(sourceRegion, queryRegion){
  if(!queryRegion) return true;
  if(sourceRegion === "global") return true;
  return sourceRegion === queryRegion;
}

function classifyQuery(q){
  const t = low(q);

  if(/video|clip|watch|stream|media/.test(t)) return "media";
  if(/news|headline|breaking|reuters|bbc/.test(t)) return "news";
  if(/science|research|paper|study|nasa|space/.test(t)) return "science";
  if(/map|geo|city|country|region/.test(t)) return "geo";
  if(/shop|buy|price|product|market/.test(t)) return "commerce";
  return "general";
}

function scoreSourceForQuery(name, params){
  const meta = SOURCE_REGISTRY[name] || {};
  const qType = classifyQuery(params.q);
  let score = typeof meta.priority === "number" ? meta.priority : 0.5;

  if(meta.route && params.route && low(meta.route) === low(params.route)) score += 0.30;
  if(meta.type && qType === "science" && meta.type === "science") score += 0.35;
  if(meta.type && qType === "news" && meta.type === "news") score += 0.35;
  if(meta.type && qType === "geo" && (meta.type === "government" || meta.type === "geo")) score += 0.30;
  if(meta.type && qType === "media" && (meta.type === "media" || meta.type === "news")) score += 0.25;

  if(regionMatch(meta.region, params.region)) score += 0.10;

  score += computeTrust(name) * 0.35;

  const stats = SOURCE_STATS[name];
  if(stats && stats.calls > 0){
    const okRatio = stats.ok / Math.max(1, stats.calls);
    score += okRatio * 0.15;
  }

  return score;
}

function selectSources(params){
  const names = Array.from(WHITELIST);

  const filtered = names.filter(name => {
    const meta = SOURCE_REGISTRY[name] || {};

    if(params.source && low(params.source) !== low(name)) return false;
    if(!regionMatch(meta.region, params.region)) return false;

    const isAI = meta.type === "ai";
    if(isAI && params.mode !== "intelligence" && params.ai !== "true") return false;

    return true;
  });

  filtered.sort((a,b) => scoreSourceForQuery(b, params) - scoreSourceForQuery(a, params));

  return filtered.slice(0, Math.min(filtered.length, MAX_PARALLEL_SOURCES));
}

/* ------------------------------------------------------------
ADAPTER INPUT / OUTPUT
------------------------------------------------------------ */

function buildAdapterContext(event, params, sourceName){
  const meta = SOURCE_REGISTRY[sourceName] || {};
  return {
    event: event || {},
    source: sourceName,
    sourceMeta: safeClone(meta),
    q: params.q,
    query: params.q,
    region: params.region,
    limit: params.limit,
    route: params.route,
    intent: params.intent,
    mode: params.mode,
    type: params.type,
    federation: params.federation,
    raw: safeClone(params.raw || {})
  };
}

function normalizeAdapterData(data){
  if(data == null) return [];
  if(Array.isArray(data)) return data;
  if(Array.isArray(data.items)) return data.items;
  if(Array.isArray(data.results)) return data.results;
  if(Array.isArray(data.data)) return data.data;
  if(data.data && Array.isArray(data.data.items)) return data.data.items;
  return [data];
}

function canonicalizeItem(item, sourceName, meta){
  if(!item || typeof item !== "object") return null;

  return {
    title: item.title || item.name || "",
    summary: item.summary || item.description || item.snippet || "",
    url: item.url || item.link || item.href || "",
    source: item.source || sourceName || "unknown",
    mediaType: item.mediaType || item.type || "web",
    score: typeof item.score === "number" ? item.score : 0.5,

    sourceTrust: typeof item.sourceTrust === "number" ? item.sourceTrust : computeTrust(sourceName),
    deepfakeRisk: typeof item.deepfakeRisk === "number" ? item.deepfakeRisk : 0,
    manipulationRisk: typeof item.manipulationRisk === "number" ? item.manipulationRisk : 0,

    timestamp: item.timestamp || now(),

    payload: {
      ...item,
      _planetary: {
        source: sourceName,
        region: meta?.region || "global",
        type: meta?.type || "unknown",
        route: meta?.route || null
      }
    }
  };
}

function canonicalizeAdapterData(data, sourceName, meta){
  const list = normalizeAdapterData(data);
  const out = [];
  for(const item of list){
    const x = canonicalizeItem(item, sourceName, meta);
    if(x) out.push(x);
  }
  return out;
}

function dedupCanonicalItems(items){
  const seen = new Set();
  const out = [];
  for(const item of items || []){
    const key = low(item.url || item.title || JSON.stringify(item));
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/* ------------------------------------------------------------
RESILIENCE
------------------------------------------------------------ */

function getResilienceEngine(){
  if(!Resilience) return null;
  if(typeof Resilience.ResilienceEngine !== "function") return null;
  try{
    return new Resilience.ResilienceEngine();
  }catch(e){
    return null;
  }
}

const RESILIENCE_ENGINE = getResilienceEngine();

/* ------------------------------------------------------------
ADAPTER EXECUTION
------------------------------------------------------------ */

async function executeAdapter(name, adapter, event, params){

  const meta = SOURCE_REGISTRY[name] || {};
  const stats = ensureStats(name);
  const started = now();

  const adapterQuery = {
    q: params.q,
    query: params.q,
    region: params.region,
    limit: params.limit,
    route: params.route,
    intent: params.intent,
    mode: params.mode,
    type: params.type
  };

  const context = buildAdapterContext(event, params, name);

  const runner = async () => {
    return await withTimeout(
      Promise.resolve(adapter(adapterQuery, context)),
      DEFAULT_TIMEOUT
    );
  };

  try{

    let data;

    if(RESILIENCE_ENGINE && typeof RESILIENCE_ENGINE.attempt === "function"){
      data = await RESILIENCE_ENGINE.attempt(name, runner);
    }else{
      data = await runner();
    }

    const duration = now() - started;
    const items = canonicalizeAdapterData(data, name, meta);

    stats.calls += 1;
    stats.ok += 1;
    stats.lastDuration = duration;
    stats.totalDuration += duration;
    stats.lastStatus = "ok";
    stats.updatedAt = now();

    learnSource(name,{
      status:"ok",
      itemCount:items.length
    });

    return {
      source:name,
      region:meta.region,
      type:meta.type,
      sourceTrust:computeTrust(name),
      timestamp:now(),
      duration,
      data,
      items
    };

  }catch(e){

    const duration = now() - started;
    const code = s(e && e.message ? e.message : e);

    stats.calls += 1;
    stats.lastDuration = duration;
    stats.totalDuration += duration;
    stats.lastStatus = code === "timeout" ? "timeout" : "fail";
    stats.updatedAt = now();

    if(code === "timeout") stats.timeout += 1;
    else stats.fail += 1;

    learnSource(name,{
      status:code === "timeout" ? "timeout" : "fail",
      itemCount:0
    });

    logTelemetry({
      source:name,
      status:stats.lastStatus,
      error:code
    });

    return {
      source:name,
      region:meta.region,
      type:meta.type,
      sourceTrust:computeTrust(name),
      timestamp:now(),
      duration,
      error:code,
      data:[],
      items:[]
    };

  }

}

/* ------------------------------------------------------------
FEDERATION LAYER
------------------------------------------------------------ */

function autoDiscoverSources(params){
  const discovered = [];

  const qType = classifyQuery(params.q);

  if(qType === "science"){
    discovered.push({ hint: "science_cluster", type: "science", region: params.region || "global" });
  }
  if(qType === "news"){
    discovered.push({ hint: "news_cluster", type: "news", region: params.region || "global" });
  }
  if(qType === "geo"){
    discovered.push({ hint: "geo_cluster", type: "geo", region: params.region || "global" });
  }
  if(qType === "media"){
    discovered.push({ hint: "media_cluster", type: "media", region: params.region || "global" });
  }

  return discovered;
}

/* ------------------------------------------------------------
CONNECT SOURCES
------------------------------------------------------------ */

async function connect(event, params = {}){
  if(params && params.usePlanetary === false){
  return {
    status: "skipped",
    engine: "planetary-data-connector",
    version: VERSION,
    reason: "not_requested",
    results: [],
    items: [],
    meta: {
      generated_at: nowIso()
    }
  };
}	
  const normalized = normalizeParams(event, params);

  const selectedSources = selectSources(normalized);
  const results = [];

  const tasks = selectedSources.map(async name=>{
  const adapter = SOURCE_ADAPTERS[name];
  if(!adapter) return null;
  return await executeAdapter(name, adapter, event, normalized);
});

const executed = await Promise.all(tasks);

for(const r of executed){
  if(r) results.push(r);
}

  // aggregate canonical items for advanced consumers
  let aggregatedItems = [];
  for(const r of results){
    if(Array.isArray(r.items)){
      aggregatedItems = aggregatedItems.concat(r.items);
    }
  }
  aggregatedItems = dedupCanonicalItems(aggregatedItems).slice(0, normalized.limit);

  return {
    status: "ok",
    engine: "planetary-data-connector",
    version: VERSION,
    query: normalized.q,
    sources: WHITELIST.size,

    // v50-compatible payload
    results,

    // v100 extension payload
    items: aggregatedItems,

    meta: {
      region: normalized.region || undefined,
      route: normalized.route || undefined,
      intent: normalized.intent || undefined,
      mode: normalized.mode || undefined,
      type: normalized.type || undefined,
      limit: normalized.limit,
      selected_sources: selectedSources,
      discovery: normalized.federation ? autoDiscoverSources(normalized) : [],
      federation_nodes: Object.keys(FEDERATION_NODES).length,
      telemetry_size: TELEMETRY.length,
      stats: safeClone(SOURCE_STATS),
      reputation: safeClone(SOURCE_REPUTATION),
      generated_at: nowIso()
    }
  };
}

/* ------------------------------------------------------------
EXPORT
------------------------------------------------------------ */

module.exports = {
  connect,
  registerSourceAdapter,
  registerSource,

  // backward-safe extras
  computeTrust,
  regionMatch,
  sanitizeQuery,
  normalizeParams,
  canonicalizeAdapterData,
  registerFederationNode
};


/* =========================================================
AI SOURCE DISCOVERY
========================================================= */

let AI = null;
try { AI = require("./ai-adapters"); } catch(e){}

if(AI){
  if(typeof AI.discover === "function"){
    registerSourceAdapter(
     "ai-discovery",
     async (query,context)=>{
      return await AI.discover(query,context);
     },
     {type:"ai",region:"global",priority:0.9,discovery:true}
    );
  }

  if(typeof AI.classify === "function"){
    registerSourceAdapter(
     "ai-classifier",
     async (query,context)=>{
      return await AI.classify(query,context);
     },
     {type:"ai",region:"global",priority:0.9}
    );
  }

  if(typeof AI.quality === "function"){
    registerSourceAdapter(
     "ai-quality",
     async (query,context)=>{
      return await AI.quality(query,context);
     },
     {type:"ai",region:"global",priority:0.9}
    );
  }

  if(typeof AI.automap === "function"){
    registerSourceAdapter(
     "ai-automap",
     async (query,context)=>{
      return await AI.automap(query,context);
     },
     {type:"ai",region:"global",priority:0.9}
    );
  }

  if(typeof AI.sanmaru === "function"){
    registerSourceAdapter(
     "sanmaru",
     async (query,context)=>{
      return await AI.sanmaru(query,context);
     },
     {type:"ai",region:"global",priority:1}
    );
  }
}