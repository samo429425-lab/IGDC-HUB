// feed-home.js (HOME FEED - FRONT.SNAPSHOT DIRECT)
import fs from "fs/promises";
import path from "path";

/* ===== SNAPSHOT PATHS (dual) ===== */
const DATA_ROOT = path.join(process.cwd(), "data");
const SNAP1 = path.join(DATA_ROOT, "front.snapshot.json");
const SNAP2 = path.join(process.cwd(), "functions", "data", "front.snapshot.json");

async function readSnapshot(){
  try{ return JSON.parse(await fs.readFile(SNAP1, "utf-8")); }catch(e){}
  try{ return JSON.parse(await fs.readFile(SNAP2, "utf-8")); }catch(e){}
  return null;
}

/* ===== SORT (pin first, then priority asc) ===== */
function sortItems(arr){
  const items = Array.isArray(arr) ? arr.slice() : [];
  items.sort((a,b)=>{
    const ap = (a && a.pin === true) ? 0 : 1;
    const bp = (b && b.pin === true) ? 0 : 1;
    if (ap !== bp) return ap - bp;

    const apr = (a && typeof a.priority === "number") ? a.priority : 999999;
    const bpr = (b && typeof b.priority === "number") ? b.priority : 999999;
    if (apr !== bpr) return apr - bpr;

    return 0;
  });
  return items;
}

function toSections(pageSections){
  const KEYS = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  return KEYS.map(id => ({
    id,
    items: sortItems(pageSections && pageSections[id])
  }));
}

/* ===== NETLIFY HANDLER ===== */
export async function handler(){
  const snap = await readSnapshot();
  const pageSections = snap && snap.pages && snap.pages.home && snap.pages.home.sections;

  if (!pageSections || typeof pageSections !== "object"){
    return {
      statusCode: 500,
      headers: { "Content-Type":"application/json", "Cache-Control":"no-store" },
      body: JSON.stringify({ error: "SNAPSHOT_INVALID" })
    };
  }

  const sections = toSections(pageSections);
  const anyData = sections.some(s => Array.isArray(s.items) && s.items.length);

  if (!anyData){
    return {
      statusCode: 500,
      headers: { "Content-Type":"application/json", "Cache-Control":"no-store" },
      body: JSON.stringify({ error: "HOME_EMPTY" })
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type":"application/json", "Cache-Control":"no-store" },
    body: JSON.stringify({ sections })
  };
}
