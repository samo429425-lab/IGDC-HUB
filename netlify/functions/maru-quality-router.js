
/**
 * netlify/functions/maru-quality-router.js
 * ------------------------------------------------------------
 * MARU QUALITY ROUTER ENGINE — v7 (Future Search Upgrade)
 * ------------------------------------------------------------
 * Upgraded architecture for large‑scale AI search orchestration
 *
 * Key upgrades
 *  - Engine collection limit separated from return limit
 *  - Large candidate pool (300+)
 *  - Rank processing window
 *  - Future‑scale configuration
 *  - Backward compatibility with existing MARU engines
 */

"use strict";

const VERSION = "v7-future-router";

/* ------------------------------------------------------------
   ENGINE IMPORT
------------------------------------------------------------ */

let Search = null;
let Insight = null;
let Bank = null;

try { Search = require("./maru-search"); } catch(e){}
try { Insight = require("./maru-global-insight-engine"); } catch(e){}
try { Bank = require("./search-bank-engine"); } catch(e){}

/* ------------------------------------------------------------
   MARU FUTURE CONFIG
------------------------------------------------------------ */

const ENGINE_COLLECT_LIMIT = 120;      // results each engine collects
const RANK_PROCESS_LIMIT   = 300;      // max candidates used for ranking
const DEFAULT_RETURN_LIMIT = 40;       // default results returned
const MAX_RETURN_LIMIT     = 120;      // maximum returned to client

const MAX_QUERY_LENGTH = 200;
const MAX_EXPANSIONS   = 5;
const ENGINE_TIMEOUT   = 3000;

/* ------------------------------------------------------------
   UTIL
------------------------------------------------------------ */

function s(x){ return String(x==null?"":x); }

function now(){ return Date.now(); }

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
  }
}

/* ------------------------------------------------------------
   LIMIT CONTROL
------------------------------------------------------------ */

function parseReturnLimit(v){

  let n = parseInt(v || DEFAULT_RETURN_LIMIT);

  if(isNaN(n)) n = DEFAULT_RETURN_LIMIT;

  if(n > MAX_RETURN_LIMIT)
    n = MAX_RETURN_LIMIT;

  return n;
}

/* ------------------------------------------------------------
   QUERY SANITIZATION
------------------------------------------------------------ */

function sanitizeQuery(q){

  q = s(q).replace(/[<>]/g,"");

  if(q.length > MAX_QUERY_LENGTH)
    q = q.slice(0,MAX_QUERY_LENGTH);

  return q.trim();
}

/* ------------------------------------------------------------
   QUERY INTENT CLASSIFICATION
------------------------------------------------------------ */

function classifyIntent(q){

  const query = q.toLowerCase();

  if(/price|buy|product|shop/.test(query)) return "product";
  if(/video|clip|movie|watch|media/.test(query)) return "media";
  if(/analysis|trend|forecast/.test(query)) return "insight";
  if(/who|what|when|where|why/.test(query)) return "entity";

  return "search";
}

/* ------------------------------------------------------------
   QUERY EXPANSION
------------------------------------------------------------ */

function expandQuery(q){

  const expanded = [q];

  const lower = q.toLowerCase();

  if(lower.includes("삼성")) expanded.push("Samsung Electronics");
  if(lower.includes("ai")) expanded.push("artificial intelligence");
  if(lower.includes("주가")) expanded.push("stock price");

  return expanded.slice(0,MAX_EXPANSIONS);
}

/* ------------------------------------------------------------
   ENGINE REGISTRY
------------------------------------------------------------ */

const ENGINE_REGISTRY = {

  search: async (event,params)=>{

    if(!Search || !Search.runEngine) return [];

    try{
      const r = await Search.runEngine(event,params);
      return r.items || [];
    }catch(e){ return [] }

  },

  insight: async (event,params)=>{

    if(!Insight || !Insight.runEngine) return [];

    try{
      const r = await Insight.runEngine(event,params);
      return r.items || [];
    }catch(e){ return [] }

  },

  bank: async (event,params)=>{

    if(!Bank || !Bank.runEngine) return [];

    try{
      const r = await Bank.runEngine(event,params);
      return r.items || [];
    }catch(e){ return [] }

  }

};

/* ------------------------------------------------------------
   ENGINE SELECTION
------------------------------------------------------------ */

function selectEngines(intent){

  switch(intent){

    case "product":
      return ["bank","search"];

    case "insight":
      return ["insight","search"];

    default:
      return ["search","insight"];

  }

}

/* ------------------------------------------------------------
   ENGINE WEIGHTS
------------------------------------------------------------ */

const BASE_WEIGHTS = {
  search: 1.0,
  insight: 1.0,
  bank: 1.0
};

function computeWeights(intent){

  const weights = {...BASE_WEIGHTS};

  if(intent === "insight") weights.insight += 0.4;
  if(intent === "product") weights.bank += 0.4;

  return weights;
}

/* ------------------------------------------------------------
   TIMEOUT PROTECTION
------------------------------------------------------------ */

function withTimeout(promise,ms){

  return Promise.race([
    promise,
    new Promise((_,reject)=>
      setTimeout(()=>reject("timeout"),ms)
    )
  ]);

}

/* ------------------------------------------------------------
   QUALITY SCORE
------------------------------------------------------------ */

function computeScore(item,weights){

  let score = item.score || 0;

  if(item.source) score += 0.1;

  if(item.mediaType === "video") score += 0.15;
  if(item.mediaType === "image") score += 0.05;

  if(item.engine && weights[item.engine])
    score *= weights[item.engine];

  if(item.timestamp){

    const age = now() - item.timestamp;

    if(age < 86400000) score += 0.1;

  }

  return score;

}

/* ------------------------------------------------------------
   DEDUP
------------------------------------------------------------ */

function dedup(items){

  const seen = new Set();
  const out  = [];

  for(const it of items){

    const key = s(it.url || it.title);

    if(!key) continue;
    if(seen.has(key)) continue;

    seen.add(key);
    out.push(it);

  }

  return out;

}

/* ------------------------------------------------------------
   MERGE + RANK
------------------------------------------------------------ */

function mergeAndRank(results,weights){

  let merged = [];

  results.forEach(arr=>{
    if(Array.isArray(arr))
      merged = merged.concat(arr);
  });

  merged = dedup(merged);

  merged = merged.map(it=>({
    ...it,
    qualityScore: computeScore(it,weights)
  }));

  merged.sort((a,b)=>b.qualityScore - a.qualityScore);

  return merged;

}

/* ------------------------------------------------------------
   ENGINE EXECUTION
------------------------------------------------------------ */

async function executeEngines(event,queries,engines){

  const calls = [];

  for(const eng of engines){

    const runner = ENGINE_REGISTRY[eng];

    if(!runner) continue;

    for(const q of queries){

      calls.push(

        withTimeout(
          runner(event,{q,limit:ENGINE_COLLECT_LIMIT}),
          ENGINE_TIMEOUT
        ).then(items=>

          (items || []).map(i=>({
            ...i,
            engine: eng
          }))

        ).catch(()=>[])

      );

    }

  }

  return Promise.all(calls);

}

/* ------------------------------------------------------------
   ROUTER CORE
------------------------------------------------------------ */

async function runRouter(event,params){

  const q = sanitizeQuery(params.q || params.query);

  const returnLimit = parseReturnLimit(params.limit);

  if(!q){

    return {
      status:"ok",
      engine:"maru-quality-router",
      version:VERSION,
      items:[]
    }

  }

  const intent = classifyIntent(q);

  const expandedQueries = expandQuery(q);

  const engines = selectEngines(intent);

  const weights = computeWeights(intent);

  const results =
    await executeEngines(event,expandedQueries,engines);

  let ranked =
    mergeAndRank(results,weights);

  ranked = ranked.slice(0,RANK_PROCESS_LIMIT);

  const items =
    ranked.slice(0,returnLimit);

  return {

    status:"ok",
    engine:"maru-quality-router",
    version:VERSION,

    query:q,
    expandedQueries,
    intent,

    items,

    meta:{
      engines,
      expansions: expandedQueries.length,
      candidates: ranked.length,
      returned: items.length
    }

  }

}

/* ------------------------------------------------------------
   NETLIFY HANDLER
------------------------------------------------------------ */

exports.handler = async function(event){

  const params = event.queryStringParameters || {};

  const res = await runRouter(event,params);

  return ok(res);

}

/* ------------------------------------------------------------
   COLLECTOR COMPATIBILITY
------------------------------------------------------------ */

exports.runEngine = async function(event,params){

  return await runRouter(event,params || {});

}
