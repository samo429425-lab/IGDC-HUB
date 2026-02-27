import fs from 'fs/promises';
import path from 'path';

const SNAPSHOT = 'networkhub-snapshot.json';

function cors(){
  return {
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,OPTIONS"
  };
}

function ok(o){
  return { statusCode:200, headers:cors(), body:JSON.stringify(o) };
}

async function read(p){
  try{
    return JSON.parse(await fs.readFile(p,'utf8'));
  }catch{ return null; }
}

function paths(){
  const cwd = process.cwd();
  const dir = __dirname || cwd;

  return [
    path.join(cwd,'data',SNAPSHOT),
    path.join(dir,'data',SNAPSHOT),
    path.join(dir,'..','data',SNAPSHOT),
    path.join(dir,'..','..','data',SNAPSHOT)
  ];
}

async function load(){
  for(const p of paths()){
    const j = await read(p);
    if(j) return j;
  }
  return null;
}

export async function handler(e){

  if(e.httpMethod==='OPTIONS')
    return {statusCode:200,headers:cors(),body:''};

  const qs = e.queryStringParameters||{};
  const key = (qs.key||'rightpanel').trim();

  const snap = await load();

  if(!snap?.sections?.rightpanel)
    return ok({ items: [] });

  const sections = {
    rightpanel: snap.sections.rightpanel
  };

  if(key){
    return ok({ items: sections[key]||[] });
  }

  return ok({ sections });
}