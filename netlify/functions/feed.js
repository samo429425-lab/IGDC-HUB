/**
 * netlify/functions/feed.js — HOME+RIGHT (8 sections) SNAPSHOT-FIRST
 * - Reads ./data/snapshot.internal.v1.json
 * - page=homeproducts -> returns {sections:[{id,items}...]} for 8 keys
 * - category=<id> -> returns {items:[...]} for that key
 * - Never returns secrets; cache disabled for debugging.
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_PATH = path.join(__dirname, "data", "snapshot.internal.v1.json");

function readJsonSafe(p){
  try{ if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,"utf-8")); }catch(_){}
  return null;
}

function toArr(x){ return Array.isArray(x) ? x : []; }

function variants(id){
  const k = String(id||"").toLowerCase();
  const s = new Set([k, k.replace(/_/g,'-'), k.replace(/-/g,'_')]);
  return s;
}

function getSection(snapshot, id){
  const vars = variants(id);
  if(!snapshot) return [];
  // sections[] preferred
  if(Array.isArray(snapshot.sections)){
    for(const sec of snapshot.sections){
      const sid = String((sec && (sec.id || sec.sectionId) || "")).toLowerCase();
      if(!sid) continue;
      if(vars.has(sid)){
        return toArr(sec.items).concat(toArr(sec.cards));
      }
    }
  }
  // legacy flat
  if(Array.isArray(snapshot.items)) return snapshot.items;
  // legacy keyed
  for (const v of vars){
    if (Array.isArray(snapshot[v])) return snapshot[v];
  }
  return [];
}

function json(res){
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(res)
  };
}

exports.handler = async function(event){
  const qs = event.queryStringParameters || {};
  const page = String(qs.page||"").trim().toLowerCase();
  const category = String(qs.category||"").trim();

  const snapshot = readJsonSafe(SNAPSHOT_PATH);

  if(page === "homeproducts"){
    const keys = ["home_1","home_2","home_3","home_4","home_5","home_right_top","home_right_middle","home_right_bottom"];
    const sections = keys.map(id => ({ id, items: getSection(snapshot, id) }));
    return json({ meta:{ page:"homeproducts", source:"snapshot" }, sections });
  }

  if(category){
    const items = getSection(snapshot, category);
    return json({ meta:{ category, source:"snapshot", empty: !items.length }, items });
  }

  return json({ meta:{ ok:true }, items: [] });
};
