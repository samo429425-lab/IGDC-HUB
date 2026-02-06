// netlify/functions/feed-home.js  (HOME FEED - SNAPSHOT ONLY, PATH-STABLE)
// ✅ Reads: netlify/functions/data/front.snapshot.json (primary)
// ✅ Fallbacks: <repo>/data/front.snapshot.json (secondary)
// ✅ Output: { sections:[{id, items:[...]}] }  (automap compatible)
// ❌ No search-bank direct read

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* ===== DIR (ESM-safe) ===== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===== SNAPSHOT PATHS ===== */
// 1) Netlify functions packaged file (recommended)
const SNAP1 = path.join(__dirname, "data", "front.snapshot.json");
// 2) Repo root /data (local/alt build)
const SNAP2 = path.join(__dirname, "..", "..", "data", "front.snapshot.json");

async function readJSON(p){
  try{
    const s = await fs.readFile(p, "utf-8");
    return JSON.parse(s);
  }catch(e){
    return null;
  }
}

async function readSnapshot(){
  return (await readJSON(SNAP1)) || (await readJSON(SNAP2));
}

/* ===== NORMALIZE ITEM (automap-friendly) ===== */
function normItem(it){
  if(!it || typeof it !== "object") return null;

  const url = typeof it.url === "string" ? it.url.trim() : "";
  if(!url) return null;

  const image =
    (typeof it.thumb === "string" && it.thumb.trim()) ? it.thumb.trim()
    : (typeof it.image === "string" && it.image.trim()) ? it.image.trim()
    : (typeof it.img === "string" && it.img.trim()) ? it.img.trim()
    : "";

  const title =
    (typeof it.title === "string" && it.title.trim()) ? it.title.trim()
    : (typeof it.name === "string" && it.name.trim()) ? it.name.trim()
    : "";

  const summary =
    (typeof it.summary === "string" && it.summary.trim()) ? it.summary.trim()
    : (typeof it.desc === "string" && it.desc.trim()) ? it.desc.trim()
    : (typeof it.description === "string" && it.description.trim()) ? it.description.trim()
    : "";

  const priority = (it.priority == null) ? 999999 : Number(it.priority);
  const pin = it.pin === true;

  const tags = Array.isArray(it.tags) ? it.tags : (Array.isArray(it.tag) ? it.tag : []);

  // Provide both thumb + image for downstream compatibility
  return {
    id: (it.id || it._id || "") + "",
    title,
    summary,
    description: (typeof it.description === "string" ? it.description : ""),
    price: (it.price == null ? "" : (it.price + "")),
    currency: (it.currency == null ? "" : (it.currency + "")),
    cta: (it.cta == null ? "" : (it.cta + "")),
    url,
    thumb: image,
    image,
    tags,
    priority: Number.isFinite(priority) ? priority : 999999,
    pin
  };
}

/* ===== SORT (pin first, then priority asc) ===== */
function sortItems(items){
  const pinned = [];
  const normal = [];
  for (const it of items){
    if(it && it.pin === true) pinned.push(it);
    else normal.push(it);
  }
  const byPr = (a,b) => {
    const pa = (a && a.priority != null) ? a.priority : 999999;
    const pb = (b && b.priority != null) ? b.priority : 999999;
    return pa - pb;
  };
  pinned.sort(byPr);
  normal.sort(byPr);
  return pinned.concat(normal);
}

/* ===== BUILD SECTIONS FROM SNAPSHOT ===== */
function buildSections(snapshot){
  const homeSections = snapshot?.pages?.home?.sections;
  if(!homeSections || typeof homeSections !== "object") return null;

  const KEYS = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  const sections = [];
  for (const key of KEYS){
    const raw = Array.isArray(homeSections[key]) ? homeSections[key] : [];
    const items = sortItems(raw.map(normItem).filter(Boolean));
    sections.push({ id: key, items });
  }
  return sections;
}

/* ===== NETLIFY HANDLER ===== */
export async function handler(){
  const snap = await readSnapshot();

  if(!snap){
    return {
      statusCode: 500,
      headers: { "Content-Type":"application/json", "Cache-Control":"no-store" },
      body: JSON.stringify({ error: "SNAPSHOT_NOT_FOUND", tried: [SNAP1, SNAP2] })
    };
  }

  const sections = buildSections(snap);
  if(!sections){
    return {
      statusCode: 500,
      headers: { "Content-Type":"application/json", "Cache-Control":"no-store" },
      body: JSON.stringify({ error: "SNAPSHOT_INVALID" })
    };
  }

  const hasData = sections.some(s => Array.isArray(s.items) && s.items.length);
  if(!hasData){
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
