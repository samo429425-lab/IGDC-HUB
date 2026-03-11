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
*/

const Router = require("./maru-quality-router");
const Planetary = require("./planetary-data-connector");
const Resilience = require("./maru-resilience-engine");

const Intelligence = require("./maru-intelligence-engine");
const Civilization = require("./maru-civilization-intelligence-engine");
const Cognitive = require("./maru-cognitive-engine");
const Consciousness = require("./maru-consciousness-engine");
const Logos = require("./maru-logos-engine");
const Evolution = require("./maru-autonomous-evolution-engine");

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
  const t = q.toLowerCase();
  const patterns = [
    "ignore previous instruction",
    "system prompt",
    "<script",
    "rm -rf",
    "drop table",
    "process.env"
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
  RATE_LIMIT.set(ip,list);

  return true;
}

/* --------------------------------------------------
CACHE
-------------------------------------------------- */

function getCache(q){
  const entry = CACHE.get(q);
  if(!entry) return null;

  if(Date.now() - entry.time > CACHE_TTL){
    CACHE.delete(q);
    return null;
  }

  return entry.data;
}

function setCache(q,data){
  CACHE.set(q,{data,time:Date.now()});
}

/* --------------------------------------------------
TRUST SCORING
-------------------------------------------------- */

function trustScore(item){
  const text = JSON.stringify(item).toLowerCase();

  if(text.includes("nasa") || text.includes("gov")) return 0.95;
  if(text.includes("wikipedia")) return 0.8;
  if(text.includes("edu")) return 0.85;

  return 0.5;
}

function applyTrust(items){
  return (items || []).map(it => ({
    ...it,
    trust:trustScore(it)
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
    CIRCUIT[name] = {failures:0,lastFail:0};
  }

  CIRCUIT[name].failures++;
  CIRCUIT[name].lastFail = Date.now();
}

/* --------------------------------------------------
AI ENGINE DECISION
-------------------------------------------------- */

function decideEngines(query){

  const q = query.toLowerCase();

  const engines = ["intelligence"];

  if(q.includes("history") || q.includes("civilization"))
    engines.push("civilization");

  if(q.includes("meaning") || q.includes("understand"))
    engines.push("cognitive");

  if(q.includes("ethic") || q.includes("good") || q.includes("evil"))
    engines.push("logos");

  if(q.includes("future") || q.includes("evolve"))
    engines.push("evolution");

  engines.push("consciousness");

  return engines;
}

/* --------------------------------------------------
DYNAMIC ENGINE CHAIN
-------------------------------------------------- */

async function runDynamicEngines(query,items){

  const plan = decideEngines(query);

  TELEMETRY.push({
    time:Date.now(),
    query,
    engines:plan
  });

  let data = items;

  for(const name of plan){

    if(!circuitCheck(name)) continue;

    try{

      if(name === "intelligence"){
        const engine = new Intelligence();
        data = engine.process(data);
      }

      if(name === "civilization"){
        await Civilization.runEngine(null,{items:data});
      }

      if(name === "cognitive"){
        await Cognitive.runEngine(null,{query});
      }

      if(name === "consciousness"){
        await Consciousness.runEngine(null,{query});
      }

      if(name === "logos"){
        await Logos.runEngine(null,{query});
      }

      if(name === "evolution"){
        await Evolution.runEngine(null,{query});
      }

    }catch(e){
      circuitFail(name);
    }
  }

  return data;
}

/* --------------------------------------------------
RETRY LAYER
-------------------------------------------------- */

async function retryPlanetary(event,q){

  let lastError;

  for(let i=0;i<MAX_RETRY;i++){

    try{
      return await Planetary.connect(event,{q});
    }catch(e){
      lastError = e;
    }

  }

  return null;
}

/* --------------------------------------------------
COLLECTOR CORE
-------------------------------------------------- */

function parseLimit(v){
  let n = parseInt(v || DEFAULT_LIMIT);
  if(isNaN(n)) n = DEFAULT_LIMIT;
  if(n > MAX_LIMIT) n = MAX_LIMIT;
  return n;
}

async function runCollector(event){

  const ip = event.headers?.["x-forwarded-for"] || "unknown";

  if(!rateLimit(ip)){
    return {status:"blocked",reason:"rate_limit"};
  }

  const params = event.queryStringParameters || {};

  const rawQuery = params.q || params.query || "";

  const q = sanitizeQuery(rawQuery);

  const limit = parseLimit(params.limit);

  if(!q){
    return {status:"ok",engine:"central-collector",version:VERSION,items:[]};
  }

  if(detectPromptInjection(q)){
    return {status:"blocked",reason:"prompt_injection"};
  }

  const cached = getCache(q);

  if(cached) return cached;

  /* planetary federation */
  await retryPlanetary(event,q);

  /* router */

  const routerResult = await Router.runEngine(event,{q,limit});

  let items = routerResult.items || [];

  /* AI engine chain */

  items = await runDynamicEngines(q,items);
  items = items.map(x=>({...x,mediaCandidate:true}));

  /* trust scoring */

  items = applyTrust(items);

  /* resilience guard */

  const safeItems = Resilience.guard(items || []);
  await require("./snapshot-engine").run({section:"collector",items:safeItems});

  const result = {
    status:"ok",
    engine:"central-collector",
    version:VERSION,
    query:q,
    router:routerResult.engine,
    routerVersion:routerResult.version,
    items:safeItems,
    meta:{
      count:safeItems.length,
      engines:"AI-chain",
      retry:MAX_RETRY
    }
  };

  setCache(q,result);

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

exports.runEngine = async function(event,params){

  return await runCollector({
    queryStringParameters: params || {},
    headers: event?.headers || {}
  });

};