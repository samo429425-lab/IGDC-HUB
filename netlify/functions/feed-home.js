// feed-home.final.js (SNAPSHOT-BASED HOME FEED - STABLE)
// 기준: front.snapshot.json → HOME sections → automap

import fs from "fs/promises";
import path from "path";

/* ===== PATHS ===== */
const ROOT = process.cwd();
const DATA1 = path.join(ROOT, "data", "front.snapshot.json");
const DATA2 = path.join(ROOT, "functions", "data", "front.snapshot.json");

/* ===== READ SNAPSHOT ===== */
async function readSnapshot(){
  try{
    return JSON.parse(await fs.readFile(DATA1,"utf-8"));
  }catch(e){}

  try{
    return JSON.parse(await fs.readFile(DATA2,"utf-8"));
  }catch(e){}

  return null;
}

/* ===== NORMALIZE ITEM ===== */
function normItem(it){
  if(!it || !it.url) return null;

  return {
    id: it.id || "",
    title: it.title || "",
    summary: it.summary || "",
    description: it.description || "",
    price: it.price || "",
    currency: it.currency || "",
    cta: it.cta || "",
    url: it.url || "",
    image: it.image || "",
    tags: it.tags || [],
    priority: it.priority ?? 9999,
    pin: it.pin === true
  };
}

/* ===== SORT (PIN + PRIORITY) ===== */
function sortItems(arr){

  const pinned = [];
  const normal = [];

  arr.forEach(it=>{
    if(it.pin === true) pinned.push(it);
    else normal.push(it);
  });

  const sortFn = (a,b)=>{
    const pa = a.priority ?? 9999;
    const pb = b.priority ?? 9999;
    return pa - pb;
  };

  pinned.sort(sortFn);
  normal.sort(sortFn);

  return [...pinned, ...normal];
}

/* ===== BUILD HOME PAYLOAD ===== */
function buildSections(snapshot){

  const home = snapshot?.pages?.home?.sections;

  if(!home || typeof home !== "object") return null;

  const KEYS = [
    "home_1","home_2","home_3","home_4","home_5",
    "home_right_top","home_right_middle","home_right_bottom"
  ];

  const sections = [];

  KEYS.forEach(key=>{

    const raw = Array.isArray(home[key]) ? home[key] : [];

    let items = raw.map(normItem).filter(Boolean);

    items = sortItems(items);

    sections.push({
      id: key,
      items
    });

  });

  return sections;
}


/* ===== NETLIFY HANDLER ===== */
export async function handler(){

  const snap = await readSnapshot();

  if(!snap){
    return {
      statusCode:500,
      body: JSON.stringify({ error:"SNAPSHOT_NOT_FOUND" })
    };
  }

  const sections = buildSections(snap);

  if(!sections){
    return {
      statusCode:500,
      body: JSON.stringify({ error:"SNAPSHOT_INVALID" })
    };
  }

  const hasData = sections.some(s=>Array.isArray(s.items) && s.items.length);

  if(!hasData){
    return {
      statusCode:500,
      body: JSON.stringify({ error:"HOME_EMPTY" })
    };
  }

  return {
    statusCode:200,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":"no-store"
    },
    body: JSON.stringify({ sections })
  };
}