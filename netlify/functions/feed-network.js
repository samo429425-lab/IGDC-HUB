/**
 * feed-network.js (v3) - NetworkHub FINAL
 *
 * SearchBank → Snapshot(write) → Snapshot reuse → Dummy(last)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const TARGET_PAGE = "network";
const TARGET_PSOM_KEY = "right-network-100";
const SNAP_PATH = path.join(__dirname, "..", "..", "data", "networkhub-snapshot.json");

function readJSON(p){
  try{
    if (fs.existsSync(p)){
      return JSON.parse(fs.readFileSync(p,"utf-8"));
    }
  }catch(_){}
  return null;
}

function writeJSON(p, obj){
  try{
    fs.mkdirSync(path.dirname(p), { recursive:true });
    fs.writeFileSync(p, JSON.stringify(obj,null,2),"utf-8");
    return true;
  }catch(_){
    return false;
  }
}

function pick(o, keys){
  for(const k of keys){
    const v=o&&o[k];
    if(typeof v==="string"&&v.trim()) return v.trim();
  }
  return "";
}

function normalize(it){
  if(!it||typeof it!=="object") return null;

  const url =
    pick(it,["url","link","href","path"]) ||
    pick(it?.detail,["url","link","href","path"]);

  const thumb =
    pick(it,["thumb","thumbnail","image","cover","coverUrl","thumbnailUrl"]) ||
    pick(it?.media,["thumb","thumbnail","image","cover","coverUrl","thumbnailUrl"]) ||
    pick(it?.preview,["thumb","thumbnail","image","cover","coverUrl","thumbnailUrl"]);

  if(!url||!thumb) return null;

  return {
    id: it.id||it._id||it.trackId||"",
    title: pick(it,["title","name","label"])||"",
    url, thumb
  };
}

function extract(bank){
  const out=[];

  const route=`${TARGET_PAGE}.${TARGET_PSOM_KEY}`;
  const idx=bank?.index?.by_page_section?.[route];

  if(Array.isArray(idx)&&idx.length){
    const map=new Map();
    if(Array.isArray(bank.items)){
      for(const it of bank.items) if(it?.id) map.set(it.id,it);
    }
    for(const id of idx){
      const it=map.get(id);
      const n=normalize(it);
      if(n) out.push(n);
    }
    return out;
  }

  if(Array.isArray(bank.items)){
    for(const it of bank.items){
      const b=it?.bind||{};
      if(String(b.page).toLowerCase()!=="network") continue;
      if(!String(b.psom_key||"").includes("right-network-100")) continue;

      const n=normalize(it);
      if(n) out.push(n);
    }
  }

  return out;
}

function makeDummy(n){
  const out=[];
  for(let i=1;i<=n;i++){
    out.push({
      id:`dummy-${i}`,
      title:`Loading ${i}`,
      url:"#",
      thumb:`data:image/svg+xml;charset=UTF-8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='100%' height='100%' fill='#eee'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#999'>${i}</text></svg>`
    });
  }
  return out;
}

exports.handler = async function(event){

  const q=event.queryStringParameters||{};
  const limit=Math.min(100,parseInt(q.limit||"100",10)||100);

  let source="search-bank";
  let items=[];

  /* 1. SearchBank */
  const sb=
    readJSON(path.join(__dirname,"..","..","data","search-bank.snapshot.json"))||
    readJSON(path.join(__dirname,"..","..","search-bank.snapshot.json"))||
    {};

  items=extract(sb).slice(0,limit);

  /* 2. Write Snapshot */
  if(items.length){
    writeJSON(SNAP_PATH,{
      updated:new Date().toISOString(),
      count:items.length,
      items
    });
  }

  /* 3. Snapshot Fallback */
  if(!items.length){
    const snap=readJSON(SNAP_PATH)||{};
    if(Array.isArray(snap.items)){
      items=snap.items.slice(0,limit);
      source="networkhub-snapshot";
    }
  }

  /* 4. Dummy Last */
  if(!items.length){
    items=makeDummy(limit);
    source="dummy";
  }

  return {
    statusCode:200,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":"no-store"
    },
    body:JSON.stringify({
      status:"ok",
      source,
      count:items.length,
      items
    })
  };
};
