// feed-home.js (FIXED)
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

export async function handler(){
  const bank = await readBank();

  if(!bank || !Array.isArray(bank.items) || !bank.items.length){
    return { statusCode:500, body: JSON.stringify({error:"BANK_EMPTY"}) };
  }

  const items = bank.items.filter(x=>x && x.section==="home");

  if(!items.length){
    return { statusCode:500, body: JSON.stringify({error:"HOME_EMPTY"}) };
  }

  return {
    statusCode:200,
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ items })
  };
}
