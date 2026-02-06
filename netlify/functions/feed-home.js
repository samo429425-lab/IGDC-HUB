// feed-home.js (HOME FEED - AUTOMAP + PIN SUPPORT)

import fs from "fs/promises";
import path from "path";

/* ===== BANK PATHS ===== */
const DATA_ROOT = path.join(process.cwd(), "data");
const BANK1 = path.join(DATA_ROOT, "search-bank.snapshot.json");
const BANK2 = path.join(process.cwd(), "functions", "data", "search-bank.snapshot.json");

/* ===== READ SEARCH BANK ===== */
async function readBank(){
  try{
    return JSON.parse(await fs.readFile(BANK1,"utf-8"));
  }catch(e){}

  try{
    return JSON.parse(await fs.readFile(BANK2,"utf-8"));
  }catch(e){}

  return null;
}


/* ===== PIN / PRIORITY SORT ===== */
function sortWithPin(items){

  const pinned = [];
  const normal = [];

  items.forEach(it=>{
    if(it && it.pin === true){
      pinned.push(it);
    }else{
      normal.push(it);
    }
  });

  return [...pinned, ...normal];
}


/* ===== HOME SECTION MAPPER ===== */
function buildHomeSections(items){

  const sections = {
    home_1: [],
    home_2: [],
    home_3: [],
    home_4: [],
    home_5: [],

    home_right_top: [],
    home_right_middle: [],
    home_right_bottom: []
  };

  if(!Array.isArray(items)) return sections;

  let mainIndex = 0;
  let rightIndex = 0;

  items.forEach(it=>{

    if(!it || !it.url) return;

    /* MAIN */
    const mainKey = `home_${(mainIndex % 5) + 1}`;
    sections[mainKey].push(it);
    mainIndex++;

    /* RIGHT */
    const rightKeys = [
      'home_right_top',
      'home_right_middle',
      'home_right_bottom'
    ];

    const rk = rightKeys[rightIndex % 3];
    sections[rk].push(it);
    rightIndex++;

  });

  return sections;
}


/* ===== NETLIFY HANDLER ===== */
export async function handler(){

  const bank = await readBank();

  if(!bank || !Array.isArray(bank.items)){
    return {
      statusCode:500,
      body: JSON.stringify({ error:"BANK_INVALID" })
    };
  }

  /* FILTER + PIN SORT */
  let homeItems = bank.items.filter(x=>x && x.url);

  homeItems = sortWithPin(homeItems);

  if(!homeItems.length){
    return {
      statusCode:500,
      body: JSON.stringify({ error:"HOME_EMPTY" })
    };
  }

  /* BUILD AUTOMAP STRUCTURE */
  const sectionMap = buildHomeSections(homeItems);

  const sections = [];

  for(const key in sectionMap){
    sections.push({
      id: key,
      items: sectionMap[key]
    });
  }

  return {
    statusCode:200,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":"no-store"
    },
    body: JSON.stringify({
      sections
    })
  };
}
