'use strict';

/*
MARU SEARCH — REBUILT CORE + EXTENSION
Core = original search behavior (restored)
Extension = Q-layer engines (collector / bank / planetary / insight)
*/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// optional engines
let Collector = null;
let Planetary = null;
let SearchBank = null;

try { Collector = require("./collector"); } catch(e){}
try { Planetary = require("./planetary-data-connector"); } catch(e){}
try { SearchBank = require("./search-bank-engine"); } catch(e){}

// -------------------- CORE (원래 기능 복원) --------------------

function s(x){ return String(x==null?"":x); }
function low(x){ return s(x).toLowerCase(); }

function hash(v){
  return crypto.createHash("sha1").update(String(v||"")).digest("hex").slice(0,16);
}

// snapshot 로드 (기존 방식 유지)
function loadSnapshot(){
  try{
    const p = path.join(process.cwd(),"data","search-bank.snapshot.json");
    const j = JSON.parse(fs.readFileSync(p,"utf8"));
    return Array.isArray(j.items) ? j.items : [];
  }catch(e){
    return [];
  }
}

// 기존 maru-search 필터 (복원)
function baseSearch(query, items){
  const q = low(query);
  return items.filter(it=>{
    const t = low(it.title||"");
    const d = low(it.summary||"");
    const u = low(it.url||"");
    return t.includes(q)||d.includes(q)||u.includes(q);
  });
}

// -------------------- EXTENSION --------------------

async function runCollector(query){
  if(!Collector || typeof Collector.run !== "function") return [];
  try{
    return await Collector.run({q:query});
  }catch(e){ return []; }
}

async function runPlanetary(items){
  if(!Planetary || typeof Planetary.process !== "function") return items;
  try{
    return await Planetary.process(items);
  }catch(e){ return items; }
}

async function syncBank(items){
  if(!SearchBank || typeof SearchBank.runEngine !== "function") return;
  try{
    await SearchBank.runEngine({}, {list:true, items});
  }catch(e){}
}

// -------------------- NORMALIZE --------------------

function normalize(items){
  return (items||[]).map(it=>({
    id: it.id || hash(it.url||it.title),
    title: it.title||"",
    summary: it.summary||"",
    url: it.url||"",
    source: it.source||"",
    type: it.type||"article"
  }));
}

function dedup(items){
  const m = new Map();
  for(const it of items){
    const k = low(it.url||it.id);
    if(!m.has(k)) m.set(k,it);
  }
  return Array.from(m.values());
}

// -------------------- MAIN --------------------

async function runEngine(event={}, params={}){

  const query = s(params.q||"").trim();
  const limit = Number(params.limit||50);

  if(!query){
    return {status:"ok",items:[]};
  }

  // 1️⃣ 기존 snapshot 기반 검색 (핵심 복원)
  const snapshot = loadSnapshot();
  let results = baseSearch(query, snapshot);

  // 2️⃣ collector 확장
  const collector = await runCollector(query);

  results = [...results, ...collector];

  // 3️⃣ planetary 확장
  results = await runPlanetary(results);

  // 4️⃣ normalize + dedup
  results = normalize(results);
  results = dedup(results);

  // 5️⃣ limit
  results = results.slice(0,limit);

  // 6️⃣ bank sync
  await syncBank(results);

  return {
    status:"ok",
    engine:"maru-search",
    count:results.length,
    items:results
  };
}

// -------------------- NETLIFY --------------------

exports.handler = async function(event){
  const params = event.queryStringParameters||{};
  const res = await runEngine(event,params);

  return {
    statusCode:200,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":"no-store"
    },
    body: JSON.stringify(res)
  };
};

exports.runEngine = runEngine;
