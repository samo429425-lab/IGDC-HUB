// feed-distribution.js (FIXED)
import fs from "fs/promises";
import path from "path";

const DATA_ROOT = path.join(process.cwd(), "data");
const BANK1 = path.join(DATA_ROOT, "search-bank.snapshot.json");
const BANK2 = path.join(process.cwd(), "functions", "data", "search-bank.snapshot.json");

async function readBank(){
  try{ return JSON.parse(await fs.readFile(BANK1,"utf-8")); }catch(e){}
  try{ return JSON.parse(await fs.readFile(BANK2,"utf-8")); }catch(e){}
  return null;
}

function groupBySection(items){
  const map = {};
  items.forEach(it=>{
    const k = it.section || it.sectionKey || it.category;
    if(!k) return;
    if(!map[k]) map[k]=[];
    map[k].push(it);
  });
  return map;
}

export async function handler(event){
  const qs = event.queryStringParameters || {};
  const key = qs.key || qs.section;

  const bank = await readBank();

  if(!bank || !Array.isArray(bank.items) || !bank.items.length){
    return { statusCode:500, body: JSON.stringify({error:"BANK_EMPTY"}) };
  }

  const groups = groupBySection(bank.items);

  if(key){
    const items = groups[key] || [];

    if(!items.length){
      return { statusCode:500, body: JSON.stringify({error:"SECTION_EMPTY"}) };
    }

    return {
      statusCode:200,
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ items })
    };
  }

  return {
    statusCode:200,
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ sections: groups })
  };
}
