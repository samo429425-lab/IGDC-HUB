
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_ROOT = path.join(process.cwd(), "data");
const SNAPSHOT_PATH = path.join(DATA_ROOT, "social.snapshot.json");
const BANK_PATH = path.join(DATA_ROOT, "search-bank.snapshot.json");

function safeReadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p,"utf-8")); }
  catch(e){ return null; }
}

function pick(obj, keys){
  for(const k of keys){
    const v = obj && obj[k];
    if(typeof v==="string" && v.trim()) return v.trim();
  }
  return "";
}

function normalize(item, page, section){
  return {
    id: item.id || null,
    page,
    section,
    title: pick(item,["title","name","label","caption"]),
    url: pick(item,["url","href","link","path","detailUrl","productUrl"]),
    thumb: pick(item,["thumb","image","img","thumbnail","cover","poster"]),
    priority: item.priority ?? null,
    type: item.type || "thumbnail",
    source: item.source || null
  };
}

function compileFromSnapshot(snap, pageName){
  const out=[];
  const sections = snap?.pages?.[pageName]?.sections || {};

  for(const [sid,arr] of Object.entries(sections)){
    if(!Array.isArray(arr)) continue;

    for(const it of arr){
      out.push(normalize(it,pageName,sid));
    }
  }
  return out;
}

function compileFromBank(bank, pageName){
  const out=[];
  const items = Array.isArray(bank?.items)?bank.items:[];

  for(const it of items){
    if(it.page && it.page!==pageName) continue;

    out.push(normalize(it,pageName,it.section||null));
  }

  return out;
}

exports.handler = async function(){
  try{

    const snap = safeReadJSON(SNAPSHOT_PATH) || {};
    const bank = safeReadJSON(BANK_PATH) || {};

    let items = compileFromSnapshot(snap,"social");

    // supplement from bank if missing
    if(items.length===0){
      items = compileFromBank(bank,"social");
    }

    return {
      statusCode:200,
      headers:{
        "Content-Type":"application/json; charset=utf-8",
        "Cache-Control":"no-store"
      },
      body:JSON.stringify({
        status:"ok",
        page:"social",
        count:items.length,
        generated:new Date().toISOString(),
        items
      })
    };

  }catch(e){
    return {
      statusCode:500,
      body:JSON.stringify({
        status:"fail",
        message:String(e&&e.message||e)
      })
    };
  }
};
