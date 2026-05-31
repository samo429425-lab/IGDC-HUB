"use strict";

/*
MARU CENTRAL COLLECTOR v150
--------------------------------------------------
Upgrade layers
v20   security guard
v40   multi-source orchestration
v60   trust validation
v80   adaptive routing
v100  planetary federation
v120  semantic collector
v150  autonomous collector + AI integration
--------------------------------------------------
FULL PATCH VERSION
- 기능 축소 없음
- module shape 호환
- null/crash 방지
*/

const Resilience = require("./maru-resilience-engine");

const Intelligence = require("./maru-intelligence-engine");
const Civilization = require("./maru-civilization-intelligence-engine");
const Cognitive = require("./maru-cognitive-engine");
const Consciousness = require("./maru-consciousness-engine");
const Logos = require("./maru-logos-engine");
const Evolution = require("./maru-autonomous-evolution-engine");

/* ===== 여기 추가 ===== */

const ENGINE_TIMEOUT = 4000;

async function withTimeout(promise, ms){
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("engine_timeout"));
    }, ms);

    promise
      .then(v => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(e => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

const VERSION = "collector-v150";

const MAX_QUERY_LENGTH = 260;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;

const CACHE = new Map();
const CACHE_TTL = 60000;

const RATE_LIMIT = new Map();
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 10;

const CIRCUIT = {};
const TELEMETRY = [];

const MAX_RETRY = 5;

/* --------------------------------------------------
SECURITY LAYER
-------------------------------------------------- */

function sanitizeQuery(q){
  q = String(q || "")
    .replace(/[<>;$`]/g,"")
    .replace(/script/gi,"")
    .replace(/process\.env/gi,"")
    .replace(/rm\s+-rf/gi,"")
    .trim();

  if(q.length > MAX_QUERY_LENGTH){
    q = q.slice(0,MAX_QUERY_LENGTH);
  }
  return q;
}

function detectPromptInjection(q){
  const t = String(q || "").toLowerCase();
  const patterns = [
    "ignore previous instruction",
    "ignore previous instructions",
    "system prompt",
    "<script",
    "rm -rf",
    "drop table",
    "process.env",
    "developer message",
    "override rules"
  ];
  return patterns.some(p => t.includes(p));
}

/* --------------------------------------------------
RATE LIMIT
-------------------------------------------------- */

function rateLimit(ip){
  const now = Date.now();

  if(!RATE_LIMIT.has(ip)){
    RATE_LIMIT.set(ip, []);
  }

  const list = RATE_LIMIT.get(ip).filter(t => now - t < RATE_LIMIT_WINDOW);

  if(list.length >= RATE_LIMIT_MAX){
    return false;
  }

  list.push(now);
  RATE_LIMIT.set(ip, list);

  return true;
}

/* --------------------------------------------------
CACHE
-------------------------------------------------- */
function cacheKey(q, params){
  const mode = params?.mode || "search";
  const engine = params?.engine || "search";
  const limit = params?.limit || DEFAULT_LIMIT;
  return `${q}|${mode}|${engine}|${limit}`;
}

function getCache(q, params){
  const key = cacheKey(q, params);
  const entry = CACHE.get(key);
  if(!entry) return null;

  if(Date.now() - entry.time > CACHE_TTL){
    CACHE.delete(key);
    return null;
  }

  return entry.data;
}

function setCache(q, params, data){
  const key = cacheKey(q, params);
  CACHE.set(key, { data, time: Date.now() });
}

/* --------------------------------------------------
TRUST SCORING
-------------------------------------------------- */

function trustScore(item){
  const text = JSON.stringify(item || {}).toLowerCase();

  if(text.includes("nasa") || text.includes(".gov") || text.includes('"gov"')) return 0.95;
  if(text.includes("wikipedia")) return 0.8;
  if(text.includes(".edu") || text.includes('"edu"')) return 0.85;

  return 0.5;
}

function applyTrust(items){
  return (items || []).map(it => ({
    ...it,
    trust: typeof it?.trust === "number" ? it.trust : trustScore(it)
  }));
}

/* --------------------------------------------------
CIRCUIT BREAKER
-------------------------------------------------- */

function circuitCheck(name){
  const entry = CIRCUIT[name];
  if(!entry) return true;

  if(entry.failures < 5) return true;

  if(Date.now() - entry.lastFail > 30000){
    entry.failures = 0;
    return true;
  }

  return false;
}

function circuitFail(name){
  if(!CIRCUIT[name]){
    CIRCUIT[name] = { failures:0, lastFail:0 };
  }

  CIRCUIT[name].failures++;
  CIRCUIT[name].lastFail = Date.now();
}

/* --------------------------------------------------
AI ENGINE DECISION
-------------------------------------------------- */

function decideEngines(query){
  const q = String(query || "").toLowerCase();

  const engines = ["intelligence"];

  if(q.includes("history") || q.includes("civilization")){
    engines.push("civilization");
  }

  if(q.includes("meaning") || q.includes("understand")){
    engines.push("cognitive");
  }

  if(q.includes("ethic") || q.includes("good") || q.includes("evil")){
    engines.push("logos");
  }

  if(q.includes("future") || q.includes("evolve")){
    engines.push("evolution");
  }

  engines.push("consciousness");

  return engines;
}

/* --------------------------------------------------
MODULE SHAPE HELPERS
-------------------------------------------------- */

function asArray(v){
  return Array.isArray(v) ? v : [];
}

function normalizeEngineItems(v){
  if(Array.isArray(v)) return v;
  if(v && Array.isArray(v.items)) return v.items;
  if(v && Array.isArray(v.results)) return v.results;
  if(v && v.data && Array.isArray(v.data.items)) return v.data.items;
  if(v && v.baseResult && Array.isArray(v.baseResult.items)) return v.baseResult.items;
  if(v && v.baseResult && v.baseResult.data && Array.isArray(v.baseResult.data.items)) return v.baseResult.data.items;
  return [];
}

function createIntelligenceEngine(mod){
  if(!mod) return null;

  if(typeof mod === "function"){
    try{
      const instance = new mod();
      if(instance && typeof instance.process === "function") return instance;
    }catch(e){}
  }

  if(mod && typeof mod.process === "function"){
    return {
      process(data){
        return mod.process(data);
      }
    };
  }

  if(mod && typeof mod.IntelligenceEngine === "function"){
    try{
      const instance = new mod.IntelligenceEngine();
      if(instance && typeof instance.process === "function") return instance;
    }catch(e){}
  }

  return null;
}

function resolveRunEngine(mod){
  if(!mod) return null;

  if(typeof mod.runEngine === "function") return mod.runEngine.bind(mod);

  if(typeof mod === "function"){
    try{
      const instance = new mod();
      if(instance && typeof instance.runEngine === "function"){
        return instance.runEngine.bind(instance);
      }
    }catch(e){}
  }

  if(mod && typeof mod.handler === "function"){
    return async function(event, params){
      const res = await mod.handler({
        queryStringParameters: params || {},
        headers: event?.headers || {}
      });
      if(res && typeof res === "object" && typeof res.body === "string"){
        try{
          return JSON.parse(res.body);
        }catch(e){
          return {};
        }
      }
      return res || {};
    };
  }

  return null;
}

function createResilienceAdapter(mod){
  const adapter = {
    guard(items){
      return items || [];
    }
  };

  if(!mod) return adapter;

  if(typeof mod.guard === "function"){
    return {
      guard(items){
        try{
          return mod.guard(items || []);
        }catch(e){
          return items || [];
        }
      }
    };
  }

  if(typeof mod.ResilienceEngine === "function"){
    try{
      const instance = new mod.ResilienceEngine();

      if(instance && typeof instance.verify === "function"){
        return {
          async verify(items){
            try{
              const out = await instance.verify(items || []);
              return out || items || [];
            }catch(e){
              return items || [];
            }
          },
          guard(items){
            return items || [];
          }
        };
      }

      if(instance && typeof instance.attempt === "function"){
        return {
          guard(items){
            return items || [];
          }
        };
      }
    }catch(e){}
  }

  return adapter;
}

const intelligenceEngine = createIntelligenceEngine(Intelligence);
const civilizationRunner = resolveRunEngine(Civilization);
const cognitiveRunner = resolveRunEngine(Cognitive);
const consciousnessRunner = resolveRunEngine(Consciousness);
const logosRunner = resolveRunEngine(Logos);
const evolutionRunner = resolveRunEngine(Evolution);
const resilienceAdapter = createResilienceAdapter(Resilience);

/* --------------------------------------------------
DYNAMIC ENGINE CHAIN
-------------------------------------------------- */

async function runDynamicEngines(query, items){
  const plan = decideEngines(query);

  TELEMETRY.push({
    time: Date.now(),
    query,
    engines: plan
  });

  if(TELEMETRY.length > 2000){
    TELEMETRY.shift();
  }

  let data = items;

  for(const name of plan){

    if(!circuitCheck(name)) continue;

    try{

      if(name === "intelligence" && intelligenceEngine && typeof intelligenceEngine.process === "function"){
        const out = intelligenceEngine.process(data);
        data = normalizeEngineItems(out).length ? normalizeEngineItems(out) : (out || data);
        data = Array.isArray(data) ? data : normalizeEngineItems(data);
      }

      if(name === "civilization" && civilizationRunner){
        await civilizationRunner(null, { items:data, query });
      }

      if(name === "cognitive" && cognitiveRunner){
        await cognitiveRunner(null, { query, items:data });
      }

      if(name === "consciousness" && consciousnessRunner){
        await consciousnessRunner(null, { query, items:data });
      }

      if(name === "logos" && logosRunner){
        await logosRunner(null, { query, items:data });
      }

      if(name === "evolution" && evolutionRunner){
        await evolutionRunner(null, { query, items:data });
      }

    }catch(e){
      circuitFail(name);
    }
  }

  return asArray(data);
}

/* --------------------------------------------------
COLLECTOR CORE (FINAL FIXED)
-------------------------------------------------- */

function parseLimit(v){
  let n = parseInt(v || DEFAULT_LIMIT, 10);
  if(isNaN(n)) n = DEFAULT_LIMIT;
  if(n < 1) n = 1;
  if(n > MAX_LIMIT) n = MAX_LIMIT;
  return n;
}

async function runCollector(event){
  const ip = event?.headers?.["x-forwarded-for"] || "unknown";

  if(!rateLimit(ip)){
    return { status:"blocked", reason:"rate_limit" };
  }

  const params = event?.queryStringParameters || {};

  const rawQuery = params.q || params.query || "";
  const q = sanitizeQuery(rawQuery);
  const limit = parseLimit(params.limit);

  if(!q){
    return {
      status:"ok",
      engine:"central-collector",
      version:VERSION,
      items:[]
    };
  }

  if(detectPromptInjection(q)){
    return { status:"blocked", reason:"prompt_injection" };
  }

  const cached = getCache(q, params);
  if(cached) return cached;

  /* ===== maru-search direct call ===== */

  let baseResult = {};

  try{
    const MaruSearch = require("./maru-search");

    const suppressMaruBase = truthy(params.noMaruSearch) || truthy(params.skipMaruSearch) || truthy(params.noSanmaru) || truthy(params.skipSanmaru) || String(params.from || params.source || "").toLowerCase() === "sanmaru";
    if(suppressMaruBase){ throw new Error("maru_search_suppressed_by_sanmaru_guard"); }

    if(MaruSearch && typeof MaruSearch.runEngine === "function"){
      baseResult = await withTimeout(
        MaruSearch.runEngine(event,{
          q,
          query:q,
          limit,
          mode: params.mode || "search",
          engine: params.engine || "search"
        }),
        ENGINE_TIMEOUT
      ) || {};
    }

  }catch(e){
    baseResult = {};
  }

  let items =
    baseResult.items ||
    baseResult.results ||
    baseResult.data?.items ||
    baseResult.baseResult?.items ||
    baseResult.baseResult?.data?.items ||
    [];

  items = asArray(items).slice(0, limit);

  /* AI engine chain */
  items = await runDynamicEngines(q, items);

  /* media hint */
  items = asArray(items).map(x => ({ ...x, mediaCandidate:true }));

  /* trust scoring */
  items = applyTrust(items);

  /* resilience guard */
  if(resilienceAdapter && typeof resilienceAdapter.verify === "function"){
    try{
      items = await resilienceAdapter.verify(items || []);
    }catch(e){}
  }

  items =
    resilienceAdapter && typeof resilienceAdapter.guard === "function"
      ? resilienceAdapter.guard(items || [])
      : (items || []);

  const safeItems = asArray(items).slice(0, limit);
  
  // ===== SEARCH-BANK PIPELINE CONNECT =====
  try{
    if(global.SearchBankExtensionCore && typeof global.SearchBankExtensionCore.pipeline === "function"){
      for(const item of safeItems){
        try{
          global.SearchBankExtensionCore.pipeline(item);
        }catch(e){}
      }
    }
  }catch(e){}

  const result = {
    status:"ok",
    engine:"central-collector",
    version:VERSION,
    query:q,
    router:baseResult?.engine || "maru-search",
    routerVersion:baseResult?.version || "unknown",
    items:safeItems,
    meta:{
      count:safeItems.length,
      engines:"AI-chain",
      retry:MAX_RETRY
    }
  };

  setCache(q, params, result);
  
  /* SNAPSHOT WRITE PIPELINE */
try{
  const Snapshot = require("./snapshot-engine");
  if(Snapshot && typeof Snapshot.run === "function"){
    await Snapshot.run(result);
  }
}catch(e){}

return result;
  
  /* SNAPSHOT WRITE PIPELINE */
try{
  const Snapshot = require("./snapshot-engine");

  const items = result?.items || result?.results || [];

  if(
    Snapshot &&
    typeof Snapshot.run === "function" &&
    Array.isArray(items)
  ){
    await Snapshot.run({
      section:"search",
      items: items,
      meta:{
        source:"collector",
        engine:VERSION,
        timestamp:Date.now()
      }
    });
  }

}catch(e){
  console.error("snapshot_write_fail", e?.message);
}

  return result;
}

/* --------------------------------------------------
HTTP RESPONSE
-------------------------------------------------- */

function ok(body){
  const origin =
    process.env.ALLOWED_ORIGIN ||
    "https://igdcglobal.com";

  return {
    statusCode:200,
    headers:{
      "Content-Type":"application/json",
      "Access-Control-Allow-Origin":origin
    },
    body:JSON.stringify(body)
  };
}

/* --------------------------------------------------
NETLIFY HANDLER
-------------------------------------------------- */

exports.handler = async function(event){
  try{
    const result = await runCollector(event);
    return ok(result);
  }catch(err){
    return ok({
      status:"error",
      engine:"central-collector",
      version:VERSION
    });
  }
};

exports.runEngine = async function(event, params){
  return await runCollector({
    queryStringParameters: params || {},
    headers: event?.headers || {}
  });
};