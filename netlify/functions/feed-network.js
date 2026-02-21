/**
 * feed-network.v2.js  (NETWORK FEED - CANON)
 * Purpose:
 *  - Build sections for Network Hub from front.snapshot.json
 *  - Provide: /.netlify/functions/feed?page=network compatible output
 *  - Section: right-network-100 (100 slots)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DATA_ROOT = path.join(__dirname, "data");
const FRONT_SNAPSHOT_PATH = path.join(DATA_ROOT, "front.snapshot.json");
const PSOM_PATH = path.join(DATA_ROOT, "psom.json");

// ------------------ Utils ------------------

function safeReadJSON(p){
  try { return JSON.parse(fs.readFileSync(p,"utf-8")); }
  catch { return null; }
}

function toArr(v){ return Array.isArray(v)?v:[]; }

function pick(obj, keys){
  for(const k of keys){
    const v = obj && obj[k];
    if(typeof v==="string" && v.trim()) return v.trim();
  }
  return "";
}

function normalizeItem(item, fallback={}){
  if(!item || typeof item!=="object") return null;

  return {
    id: item.id || fallback.id || null,
    page: "network",
    section: "right-network-100",

    title: pick(item,["title","name","label","caption"])||"",
    url: pick(item,["url","href","link","path","detailUrl"])||"",
    thumb: pick(item,[
      "thumb","image","image_url","img",
      "photo","thumbnail","thumbnailUrl","cover","coverUrl"
    ])||"",

    priority: (typeof item.priority==="number") ? item.priority : null,
    enabled: (item.enabled!==false),
    order: (typeof item.order==="number") ? item.order : 0
  };
}

// ------------------ Builder ------------------

function buildNetworkSections(snap){

  const sectionsMap = snap?.pages?.network?.sections;
  if(!sectionsMap || typeof sectionsMap!=="object") return [];

  const key = "right-network-100";

  const raw = toArr(sectionsMap[key]).slice(0,100);

  return [{
    id: key,
    items: raw
      .map(x=>normalizeItem(x))
      .filter(it=>it && it.url && it.thumb)
  }];
}

// ------------------ Handler ------------------

exports.handler = async function(event){

  try{

    const snap = safeReadJSON(FRONT_SNAPSHOT_PATH) || {};
    const psom = safeReadJSON(PSOM_PATH) || [];

    const sections = buildNetworkSections(snap);

    return {
      statusCode: 200,
      headers: {
        "Content-Type":"application/json; charset=utf-8",
        "Cache-Control":"no-store"
      },
      body: JSON.stringify({
        status: "ok",
        page: "network",
        generated: new Date().toISOString(),
        sections
      })
    };

  }catch(e){

    return {
      statusCode:500,
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        status:"error",
        error: String(e?.message||e)
      })
    };

  }
};
