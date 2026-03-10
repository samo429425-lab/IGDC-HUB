"use strict";

/*
MARU Planetary Search Engine v100
------------------------------------------------------------
Upgrade path layers
v20  - base normalize / guard
v40  - multi source orchestration
v50  - trust ranking
v70  - semantic intent layer
v80  - adaptive routing / media / geo aware
v100 - autonomous federated orchestration

Design goals
- Keep Netlify compatibility
- Keep Collector compatibility
- Keep Search Bridge compatibility
- Keep UI compatibility
- Defense-first, not block-first
- Minimum 5 retry attempts before isolation/fallback
*/

let Planetary = null;
let Bank = null;
let Core = null;
let Resilience = null;
let Knowledge = null;

try { Planetary = require("./planetary-data-connector"); } catch(e){}
try { Bank = require("./search-bank-engine"); } catch(e){}
try { Core = require("./core"); } catch(e){}
try { Resilience = require("./maru-resilience-engine"); } catch(e){}
try { Knowledge = require("./maru-knowledge-graph-engine"); } catch(e){}

const VERSION = "maru-search-v100-autonomous-defense";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;
const MAX_QUERY_LENGTH = 260;

const ENGINE_TIMEOUT = 9000;
const MAX_RETRY = 5;
const CIRCUIT_THRESHOLD = 10;
const CIRCUIT_COOLDOWN = 30000;

const CACHE = new Map();
const CACHE_TTL = 45000;

const CIRCUIT = {
  planetary: { failures: 0, lastFail: 0 },
  bank: { failures: 0, lastFail: 0 }
};

/* --------------------------------------------------
UTIL
-------------------------------------------------- */

function s(x){ return String(x == null ? "" : x); }
function low(x){ return s(x).toLowerCase(); }
function now(){ return Date.now(); }

function safeInt(v, d, min, max){
  if(Core && typeof Core.safeInt === "function"){
    return Core.safeInt(v, d, min, max);
  }
  const n = Number(v);
  if(!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sanitize(q){
  return s(q || "")
    .replace(/[<>;$`]/g,"")
    .replace(/script/gi,"")
    .replace(/process\.env/gi,"")
    .replace(/drop\s+table/gi,"")
    .replace(/rm\s+-rf/gi,"")
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
}

function detectPromptInjection(q){
  const t = low(q);
  const patterns = [
    "ignore previous instruction",
    "ignore previous instructions",
    "system prompt",
    "developer message",
    "override rules",
    "<script",
    "process.env",
    "drop table",
    "rm -rf"
  ];
  return patterns.some(p => t.includes(p));
}

function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

function getCache(key){
  const hit = CACHE.get(key);
  if(!hit) return null;
  if(now() - hit.time > CACHE_TTL){
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value){
  CACHE.set(key, { time: now(), value });
}

function circuitOpen(name){
  const c = CIRCUIT[name];
  if(!c) return false;
  if(c.failures < CIRCUIT_THRESHOLD) return false;
  if(now() - c.lastFail > CIRCUIT_COOLDOWN){
    c.failures = 0;
    return false;
  }
  return true;
}

function circuitFail(name){
  const c = CIRCUIT[name];
  if(!c) return;
  c.failures += 1;
  c.lastFail = now();
}

function circuitSuccess(name){
  const c = CIRCUIT[name];
  if(!c) return;
  if(c.failures > 0) c.failures -= 1;
}

/* --------------------------------------------------
v20 BASE NORMALIZE / DEFENSE
-------------------------------------------------- */

function validateQuery(q){
  if(Core && typeof Core.validateQuery === "function"){
    const v = Core.validateQuery(q);
    if(v && typeof v === "object"){
      return v;
    }
  }
  const qq = sanitize(q);
  if(!qq) return { ok:false, code:"BAD_QUERY", value:"" };
  return { ok:true, value:qq };
}

function parseParams(params = {}){
  const rawQ = params.q || params.query || "";
  const v = validateQuery(rawQ);
  const q = v.ok ? sanitize(v.value) : sanitize(rawQ);

  return {
    q,
    query: q,
    limit: safeInt(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    region: params.region || null,
    mode: s(params.mode || "search").trim() || "search",
    intent: params.intent || null,
    scope: params.scope || null,
    target: params.target || null
  };
}

function normalizePlanetaryResults(res){
  if(!res || typeof res !== "object") return [];

  if(Array.isArray(res.items)){
    return res.items.filter(Boolean).map(normalizeItem);
  }

  if(Array.isArray(res.results)){
    const out = [];
    for(const r of res.results){
      if(!r) continue;

      if(Array.isArray(r.items)){
        for(const it of r.items){
          const x = normalizeItem(it);
          if(x) out.push(x);
        }
        continue;
      }

      const data = Array.isArray(r.data) ? r.data : [r.data];
      for(const it of data){
        const x = normalizeItem({
          ...it,
          source: r.source || it?.source,
          sourceTrust: r.sourceTrust ?? it?.sourceTrust,
          timestamp: r.timestamp || it?.timestamp
        });
        if(x) out.push(x);
      }
    }
    return out;
  }

  return [];
}

function normalizeBankResults(res){
  if(!res || typeof res !== "object") return [];
  const src = Array.isArray(res.items) ? res.items : [];
  return src.filter(Boolean).map(normalizeItem);
}

function normalizeItem(it){
  if(!it || typeof it !== "object") return null;

  const url = s(it.url || it.link || it.href || "").trim();
  const title = s(it.title || it.name || "").trim();
  const summary = s(it.summary || it.description || it.snippet || "").trim();

  return {
    title,
    summary,
    url,
    source: s(it.source || "unknown").trim() || "unknown",
    mediaType: s(it.mediaType || it.type || "web").trim() || "web",
    score: typeof it.score === "number" ? it.score : 0.5,

    sourceTrust: typeof it.sourceTrust === "number" ? it.sourceTrust : 0.5,
    deepfakeRisk: typeof it.deepfakeRisk === "number" ? it.deepfakeRisk : 0,
    manipulationRisk: typeof it.manipulationRisk === "number" ? it.manipulationRisk : 0,

    timestamp: it.timestamp || now(),
    thumbnail: s(it.thumbnail || it.thumb || "").trim(),
    imageSet: Array.isArray(it.imageSet) ? it.imageSet.slice(0, 8) : undefined,
    media: (it.media && typeof it.media === "object") ? it.media : undefined,
    payload: it.payload && typeof it.payload === "object" ? it.payload : it
  };
}

/* --------------------------------------------------
v40 MULTI SOURCE ORCHESTRATION
-------------------------------------------------- */

function makeResilienceEngine(){
  if(!Resilience || typeof Resilience.ResilienceEngine !== "function") return null;
  try{
    return new Resilience.ResilienceEngine();
  }catch(e){
    return null;
  }
}

const resilience = makeResilienceEngine();

async function resilientCall(name, fn){
  let lastError = null;

  if(circuitOpen(name)){
    throw new Error(name + "_circuit_open");
  }

  for(let i = 0; i < MAX_RETRY; i++){
    try{
      let result;
      if(resilience && typeof resilience.attempt === "function"){
        // attempt 내부 maxRetry가 따로 있더라도, search 정책은 외부 fallback 기준으로 5회만 봄
        result = await withTimeout(fn(), ENGINE_TIMEOUT);
      }else{
        result = await withTimeout(fn(), ENGINE_TIMEOUT);
      }
      circuitSuccess(name);
      return result;
    }catch(e){
      lastError = e;
      circuitFail(name);
    }
  }

  throw lastError || new Error(name + "_failed");
}

async function callPlanetary(event, params){
  if(!Planetary || typeof Planetary.connect !== "function"){
    return { status:"fail", items:[], error:"PLANETARY_UNAVAILABLE" };
  }

  const key = "planetary:" + JSON.stringify([params.q, params.limit, params.region, params.mode]);
  const cached = getCache(key);
  if(cached) return cached;

  try{
    const res = await resilientCall("planetary", async () => {
      return await Planetary.connect(event, {
        q: params.q,
        query: params.q,
        limit: params.limit,
        region: params.region,
        mode: params.mode,
        intent: params.intent,
        scope: params.scope,
        target: params.target
      });
    });

    const out = {
      status:"ok",
      items: normalizePlanetaryResults(res),
      raw: res
    };
    setCache(key, out);
    return out;
  }catch(e){
    return {
      status:"fail",
      items:[],
      raw:null,
      error: s(e && e.message ? e.message : e)
    };
  }
}

async function callBank(event, params){
  if(!Bank || typeof Bank.runEngine !== "function"){
    return { status:"fail", items:[], error:"BANK_UNAVAILABLE" };
  }

  const key = "bank:" + JSON.stringify([params.q, params.limit, params.region, params.mode]);
  const cached = getCache(key);
  if(cached) return cached;

  try{
    const res = await resilientCall("bank", async () => {
      return await Bank.runEngine(event || {}, {
        q: params.q,
        query: params.q,
        limit: params.limit,
        region: params.region,
        mode: params.mode
      });
    });

    const out = {
      status:"ok",
      items: normalizeBankResults(res),
      raw: res
    };
    setCache(key, out);
    return out;
  }catch(e){
    return {
      status:"fail",
      items:[],
      raw:null,
      error: s(e && e.message ? e.message : e)
    };
  }
}

/* --------------------------------------------------
v50 TRUST RANKING
-------------------------------------------------- */

function truthConfidence(item){
  let score = 1;
  if(typeof item.sourceTrust === "number") score *= item.sourceTrust;
  if(typeof item.deepfakeRisk === "number") score *= (1 - item.deepfakeRisk);
  if(typeof item.manipulationRisk === "number") score *= (1 - item.manipulationRisk);
  return score;
}

function trustFilter(items){
  return (items || []).filter(it => truthConfidence(it) >= 0.15);
}

/* --------------------------------------------------
v70 SEMANTIC / INTENT LAYER
-------------------------------------------------- */

function classifyIntent(q){
  const t = low(q);

  if(/video|watch|clip|media|stream/.test(t)) return "media";
  if(/price|buy|product|shop|market/.test(t)) return "commerce";
  if(/news|headline|breaking|current/.test(t)) return "news";
  if(/science|research|paper|study|nasa|space/.test(t)) return "science";
  if(/city|country|region|map|local|geo/.test(t)) return "geo";
  if(/why|how|meaning|analysis|trend|forecast/.test(t)) return "analysis";

  return "general";
}

function semanticSignals(q){
  const t = low(q);
  const out = [];

  if(t.includes("video") || t.includes("media")) out.push("media");
  if(t.includes("news")) out.push("news");
  if(t.includes("science") || t.includes("research")) out.push("science");
  if(t.includes("local") || t.includes("region")) out.push("geo");
  if(t.includes("analysis") || t.includes("forecast")) out.push("analysis");

  return out;
}

/* --------------------------------------------------
v80 ADAPTIVE ROUTING
-------------------------------------------------- */

function sourcePlan(params){
  const intent = classifyIntent(params.q);
  const signals = semanticSignals(params.q);

  const plan = {
    intent,
    signals,
    usePlanetary: true,
    useBank: true
  };

  if(intent === "media"){
    plan.usePlanetary = true;
    plan.useBank = true;
  }else if(intent === "science" || intent === "news" || intent === "geo"){
    plan.usePlanetary = true;
    plan.useBank = true;
  }else if(intent === "commerce"){
    plan.usePlanetary = true;
    plan.useBank = true;
  }

  return plan;
}

/* --------------------------------------------------
v100 AUTONOMOUS FEDERATED SEARCH
-------------------------------------------------- */

function knowledgeBoost(item, q){
  if(!Knowledge) return 0;

  // 안전하게 가볍게만 사용
  try{
    const title = low(item.title || "");
    const qq = low(q || "");
    if(title && qq && title.includes(qq)) return 0.08;
  }catch(e){}

  return 0;
}

function computeScore(item, q, intent){
  let score = typeof item.score === "number" ? item.score : 0.5;

  score *= truthConfidence(item);

  const title = low(item.title || "");
  const summary = low(item.summary || "");
  const query = low(q || "");

  if(query && title.includes(query)) score += 0.45;
  if(query && summary.includes(query)) score += 0.20;

  if(intent === "media" && (item.mediaType === "video" || item.media?.kind === "video")) score += 0.35;
  if(intent === "news" && /news|reuters|bbc|ap/.test(low(item.source))) score += 0.15;
  if(intent === "science" && /gov|edu|ac|nasa|arxiv/.test(low(item.source))) score += 0.18;
  if(intent === "geo" && /gov|map|city|region/.test(low(item.source))) score += 0.12;

  if(item.thumbnail) score += 0.05;
  if(item.imageSet && item.imageSet.length) score += 0.08;

  score += knowledgeBoost(item, q);

  return score;
}

function dedup(items){
  const out = [];
  const seen = new Set();

  for(const it of items || []){
    const key = low(it.url || (it.title + "|" + it.source));
    if(!key) continue;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }

  return out;
}

function rankItems(items, q, intent){
  const merged = dedup(trustFilter(items)).map(it => ({
    ...it,
    qualityScore: computeScore(it, q, intent)
  }));

  merged.sort((a,b) => {
    if(b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });

  return merged;
}

function buildMeta(params, plan, planetaryRes, bankRes, ranked){
  return {
    intent: plan.intent,
    signals: plan.signals,
    planetary_ok: planetaryRes.status === "ok",
    bank_ok: bankRes.status === "ok",
    planetary_count: planetaryRes.items.length,
    bank_count: bankRes.items.length,
    ranked_count: ranked.length,
    retry_policy: MAX_RETRY,
    defense_first: true,
    circuits: {
      planetary: { ...CIRCUIT.planetary },
      bank: { ...CIRCUIT.bank }
    }
  };
}

/* --------------------------------------------------
MAIN ENGINE
-------------------------------------------------- */

async function runEngine(event, params = {}){
  const p = parseParams(params);

  if(!p.q){
    return {
      status:"ok",
      engine:"maru-search",
      version:VERSION,
      items:[],
      results:[]
    };
  }

  if(detectPromptInjection(p.q)){
    // 즉시 block 대신 안전한 빈 응답 + 메타
    return {
      status:"ok",
      engine:"maru-search",
      version:VERSION,
      query:p.q,
      items:[],
      results:[],
      meta:{
        defense_first:true,
        protected:true,
        reason:"prompt_injection_guard"
      }
    };
  }

  const plan = sourcePlan(p);

  const [planetaryRes, bankRes] = await Promise.all([
    plan.usePlanetary ? callPlanetary(event, p) : Promise.resolve({ status:"skip", items:[] }),
    plan.useBank ? callBank(event, p) : Promise.resolve({ status:"skip", items:[] })
  ]);

  let allItems = [];
  allItems = allItems.concat(planetaryRes.items || []);
  allItems = allItems.concat(bankRes.items || []);

  // defense-first fallback
  if(!allItems.length){
    if(planetaryRes.status !== "ok" && bankRes.status !== "ok"){
      return {
        status:"ok",
        engine:"maru-search",
        version:VERSION,
        query:p.q,
        items:[],
        results:[],
        meta: buildMeta(p, plan, planetaryRes, bankRes, [])
      };
    }
  }

  const ranked = rankItems(allItems, p.q, plan.intent).slice(0, p.limit);

  return {
    status:"ok",
    engine:"maru-search",
    version:VERSION,

    query:p.q,
    mode:p.mode,

    items: ranked,
    results: ranked,

    meta: buildMeta(p, plan, planetaryRes, bankRes, ranked),

    data: {
      planetary: planetaryRes.raw || null,
      bank: bankRes.raw || null
    }
  };
}

/* --------------------------------------------------
SEARCH BRIDGE COMPATIBILITY
-------------------------------------------------- */

async function maruSearchDispatcher(payload = {}){
  const query = s(payload.q || payload.query || "").trim();
  if(!query){
    return { ok:false, error:"INVALID_PAYLOAD" };
  }

  const event = {
    queryStringParameters: {
      q: query,
      limit: payload.limit,
      mode: payload.mode,
      region: payload.context?.region,
      intent: payload.context?.intent,
      scope: payload.context?.scope,
      target: payload.context?.target
    },
    headers: payload.headers || {}
  };

  return await runEngine(event, event.queryStringParameters || {});
}

/* --------------------------------------------------
NETLIFY HANDLER
-------------------------------------------------- */

exports.runEngine = runEngine;
exports.maruSearchDispatcher = maruSearchDispatcher;

exports.handler = async function(event){
  try{
    const params = event?.queryStringParameters || {};
    const res = await runEngine(event || {}, params);

    const origin =
      process.env.ALLOWED_ORIGIN ||
      "https://igdcglobal.com";

    return {
      statusCode:200,
      headers:{
        "Content-Type":"application/json",
        "Access-Control-Allow-Origin":origin,
        "Cache-Control":"no-store"
      },
      body:JSON.stringify(res)
    };
  }catch(e){
    const origin =
      process.env.ALLOWED_ORIGIN ||
      "https://igdcglobal.com";

    return {
      statusCode:200,
      headers:{
        "Content-Type":"application/json",
        "Access-Control-Allow-Origin":origin,
        "Cache-Control":"no-store"
      },
      body:JSON.stringify({
        status:"ok",
        engine:"maru-search",
        version:VERSION,
        items:[],
        results:[],
        meta:{
          protected:true,
          reason:s(e && e.message ? e.message : e)
        }
      })
    };
  }
};