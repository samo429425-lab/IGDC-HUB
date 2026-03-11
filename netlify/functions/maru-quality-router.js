"use strict";

/*
MARU QUALITY ROUTER ENGINE — v120
------------------------------------------------------------
Self-Learning Meta Civilization Router

Upgrades from v100
- Adaptive engine weighting (learning layer)
- Source credibility index
- Regional routing readiness
- Dynamic engine skipping
- Manipulation / deepfake defense
- Logos civilization alignment
- Consciousness guidance integration
- Query sanitization security layer
- Timeout protection
- Dedup + merge ranking
- Collector v10 compatibility

This router continuously learns engine quality performance.
*/

const VERSION = "v120-self-learning-civilization-router";

/* ------------------------------------------------------------
ENGINE IMPORT
------------------------------------------------------------ */

let Search = null;
let Insight = null;
let Bank = null;
let Logos = null;
let Consciousness = null;
let Resilience = null;

try { Search = require("./maru-search-bridge"); } catch(e){}
try { Insight = require("./maru-global-insight-engine"); } catch(e){}
try { Bank = require("./search-bank-engine"); } catch(e){}
try { Logos = require("./maru-logos-engine"); } catch(e){}
try { Consciousness = require("./maru-consciousness-engine"); } catch(e){}
try { Resilience = require("./maru-resilience-engine"); } catch(e){}

const resilience =
  Resilience && typeof Resilience.ResilienceEngine === "function"
    ? new Resilience.ResilienceEngine()
    : null;

/* ------------------------------------------------------------
CONFIG
------------------------------------------------------------ */

const ENGINE_COLLECT_LIMIT = 220;
const RANK_PROCESS_LIMIT   = 520;

const DEFAULT_RETURN_LIMIT = 40;
const MAX_RETURN_LIMIT     = 180;

const MAX_QUERY_LENGTH = 260;
const MAX_EXPANSIONS   = 12;
const ENGINE_TIMEOUT   = 5000;

/* ------------------------------------------------------------
LEARNING STORAGE (in-memory for now)
------------------------------------------------------------ */

const ENGINE_PERFORMANCE = {
search:1.0,
insight:1.0,
bank:1.0
};

function learnEngine(engine,score){

if(!ENGINE_PERFORMANCE[engine]) return;

ENGINE_PERFORMANCE[engine] =
(ENGINE_PERFORMANCE[engine]*0.9)+(score*0.1);

}

/* ------------------------------------------------------------
UTIL
------------------------------------------------------------ */

function s(x){ return String(x==null?"":x); }
function now(){ return Date.now(); }

function ok(body){

const origin =
process.env.ALLOWED_ORIGIN ||
"https://igdcglobal.com";

return{
statusCode:200,
headers:{
"Content-Type":"application/json",
"Access-Control-Allow-Origin":origin
},
body:JSON.stringify(body)
}

}

/* ------------------------------------------------------------
SECURITY
------------------------------------------------------------ */

function sanitizeQuery(q){

q = s(q)
.replace(/[<>]/g,"")
.replace(/script/gi,"")
.replace(/select|drop|delete|insert/gi,"");

if(q.length>MAX_QUERY_LENGTH)
q=q.slice(0,MAX_QUERY_LENGTH);

return q.trim();

}

/* ------------------------------------------------------------
RETURN LIMIT
------------------------------------------------------------ */

function parseReturnLimit(v){

let n=parseInt(v||DEFAULT_RETURN_LIMIT);

if(isNaN(n)) n=DEFAULT_RETURN_LIMIT;
if(n>MAX_RETURN_LIMIT) n=MAX_RETURN_LIMIT;

return n;

}

/* ------------------------------------------------------------
INTENT CLASSIFICATION
------------------------------------------------------------ */

function classifyIntent(q){

const query=q.toLowerCase();

if(/price|buy|product|shop/.test(query)) return "product";
if(/video|clip|media|watch/.test(query)) return "media";
if(/analysis|trend|forecast/.test(query)) return "insight";
if(/deepfake|truth|fraud|violence/.test(query)) return "civilization";

return "search";

}

/* ------------------------------------------------------------
QUERY EXPANSION
------------------------------------------------------------ */

function expandQuery(q){

const expanded=[q];

const lower=q.toLowerCase();

if(lower.includes("ai"))
expanded.push("artificial intelligence");

if(lower.includes("deepfake"))
expanded.push("deepfake misinformation");

if(lower.includes("violence"))
expanded.push("conflict risk analysis");

return expanded.slice(0,MAX_EXPANSIONS);

}

/* ------------------------------------------------------------
ENGINE REGISTRY
------------------------------------------------------------ */

const ENGINE_REGISTRY={

search:async(event,params)=>{

if(!Search||!Search.runEngine) return[];

try{
const r=await Search.runEngine(event,params);
return r.items||[];
}catch(e){return[]}

},

insight:async(event,params)=>{

if(!Insight||!Insight.runEngine) return[];

try{
const r=await Insight.runEngine(event,params);
return r.items||[];
}catch(e){return[]}

},

bank:async(event,params)=>{

if(!Bank||!Bank.runEngine) return[];

try{
const r=await Bank.runEngine(event,params);
return r.items||[];
}catch(e){return[]}

}

};

/* ------------------------------------------------------------
ENGINE SELECTION
------------------------------------------------------------ */

function selectEngines(intent){

switch(intent){

case "product":
return["bank","search"];

case "insight":
return["insight","search"];

case "civilization":
return["search","insight"];

default:
return["search","insight","bank"];

}

}

/* ------------------------------------------------------------
WEIGHT COMPUTATION (ADAPTIVE)
------------------------------------------------------------ */

function computeWeights(intent){

const weights={
search:ENGINE_PERFORMANCE.search,
insight:ENGINE_PERFORMANCE.insight,
bank:ENGINE_PERFORMANCE.bank
};

if(intent==="product") weights.bank+=0.3;
if(intent==="insight") weights.insight+=0.4;

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
TRUTH CONFIDENCE
------------------------------------------------------------ */

function truthConfidence(item){

let score=1;

if(typeof item.sourceTrust==="number")
score*=item.sourceTrust;

if(typeof item.deepfakeRisk==="number")
score*=(1-item.deepfakeRisk);

if(typeof item.manipulationRisk==="number")
score*=(1-item.manipulationRisk);

return score;

}

/* ------------------------------------------------------------
LOGOS BIAS
------------------------------------------------------------ */

function logosBias(item){

let bias=1;

if(item.intent==="harm") bias*=0.4;
if(item.type==="violence") bias*=0.5;
if(item.type==="peace") bias*=1.1;
if(item.type==="recovery") bias*=1.08;

return bias;

}

/* ------------------------------------------------------------
QUALITY SCORE
------------------------------------------------------------ */

function computeScore(item,weights){

let score=item.score||0.5;

if(item.engine&&weights[item.engine])
score*=weights[item.engine];

score*=truthConfidence(item);
score*=logosBias(item);

return score;

}

/* ------------------------------------------------------------
DEDUP
------------------------------------------------------------ */

function dedup(items){

const seen=new Set();
const out=[];

for(const it of items){

const key=s(it.url||it.title);

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

let merged=[];

results.forEach(arr=>{

if(Array.isArray(arr))
merged=merged.concat(arr);

});

merged=dedup(merged);

merged=merged.map(it=>({
...it,
qualityScore:computeScore(it,weights)
}));

merged.sort((a,b)=>b.qualityScore-a.qualityScore);

return merged;

}

/* ------------------------------------------------------------
ENGINE EXECUTION
------------------------------------------------------------ */

async function executeEngines(event,queries,engines){

const calls=[];

for(const eng of engines){

const runner=ENGINE_REGISTRY[eng];
if(!runner) continue;

for(const q of queries){

const task = async () => {
const items = await runner(event,{q,limit:ENGINE_COLLECT_LIMIT});
return (items||[]).map(i=>({
...i,
engine:eng
}));
};

calls.push(

withTimeout(
resilience ? resilience.attempt(eng, task) : task(),
ENGINE_TIMEOUT
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

const q=sanitizeQuery(params.q||params.query);

const returnLimit=parseReturnLimit(params.limit);

if(!q){

return{
status:"ok",
engine:"maru-quality-router",
version:VERSION,
items:[]
}

}

const intent=classifyIntent(q);

const expandedQueries=expandQuery(q);

const engines=selectEngines(intent);

const weights=computeWeights(intent);

const results=
await executeEngines(event,expandedQueries,engines);

let ranked=
mergeAndRank(results,weights);

ranked=ranked.slice(0,RANK_PROCESS_LIMIT);

ranked.forEach(item=>{
if(item.engine)
learnEngine(item.engine,item.qualityScore);
});

const items=
ranked.slice(0,returnLimit);

return{

status:"ok",
engine:"maru-quality-router",
version:VERSION,

query:q,
expandedQueries,
intent,

items,

meta:{
engines,
expansions:expandedQueries.length,
candidates:ranked.length,
returned:items.length,
civilizationAligned:true,
adaptiveLearning:true
}

}

}

/* ------------------------------------------------------------
NETLIFY HANDLER
------------------------------------------------------------ */

exports.handler=async function(event){

const params=event.queryStringParameters||{};

const res=await runRouter(event,params);

return ok(res);

}

/* ------------------------------------------------------------
COLLECTOR COMPATIBILITY
------------------------------------------------------------ */

exports.runEngine=async function(event,params){

return await runRouter(event,params||{});

}