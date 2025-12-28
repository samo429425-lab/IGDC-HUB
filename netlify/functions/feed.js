/*
 * HOME PRODUCTS branch-only patch for existing feed.js
 * Paste this block INSIDE exports.handler(event) right after:
 *   const qs = event.queryStringParameters || {};
 * and after you compute `page` (or equivalent).
 *
 * Requires: Node 18+ (fetch optional), uses snapshot file:
 *   netlify/functions/data/snapshot.internal.v1.json
 */

// ---- BEGIN HOME BRANCH PATCH ----
const fs = require("fs");
const path = require("path");
const __SNAPSHOT_PATH__ = path.join(__dirname, "data", "snapshot.internal.v1.json");

function __readJsonSafe__(p) {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (_) {}
  return null;
}
function __toArr__(x){ return Array.isArray(x) ? x : []; }
function __variants__(id){
  const k = String(id||"").toLowerCase();
  return new Set([k, k.replace(/_/g,'-'), k.replace(/-/g,'_')]);
}
function __getSection__(snapshot, id){
  const vars = __variants__(id);
  if(!snapshot) return [];
  if(Array.isArray(snapshot.sections)){
    for(const sec of snapshot.sections){
      const sid = String((sec && (sec.id || sec.sectionId) || "")).toLowerCase();
      if(!sid) continue;
      if(vars.has(sid)){
        return __toArr__(sec.items).concat(__toArr__(sec.cards));
      }
    }
  }
  if(Array.isArray(snapshot.items)) return snapshot.items;
  for (const v of vars){
    if (Array.isArray(snapshot[v])) return snapshot[v];
  }
  return [];
}

// Inside handler(event):
// const page = String(qs.page||"").trim().toLowerCase();
if (page === "homeproducts") {
  const snapshot = __readJsonSafe__(__SNAPSHOT_PATH__);
  const keys = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];
  const sections = keys.map(id => ({ id, items: __getSection__(snapshot, id) }));
  return {
    statusCode: 200,
    headers: { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" },
    body: JSON.stringify({ meta:{ page:"homeproducts", source:"snapshot" }, sections })
  };
}
// ---- END HOME BRANCH PATCH ----
