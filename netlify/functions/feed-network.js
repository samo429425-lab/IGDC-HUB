// feed-network.js (FINAL - SNAPSHOT COMPATIBLE)

import fs from 'fs/promises';
import path from 'path';

const SNAPSHOT_NAME = 'networkhub-snapshot.json';
const LIMIT_DEFAULT = 100;

// ---------------- CORS ----------------
function cors(){
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function ok(body){
  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify(body)
  };
}

// ---------------- FS ----------------
async function readJson(p){
  try{
    const raw = await fs.readFile(p,'utf-8');
    return JSON.parse(raw);
  }catch{
    return null;
  }
}

function fsPaths(){
  const cwd = process.cwd();
  const dir = typeof __dirname === 'string' ? __dirname : cwd;

  return [
    path.join(cwd,'data',SNAPSHOT_NAME),
    path.join(dir,'data',SNAPSHOT_NAME),
    path.join(dir,'..','data',SNAPSHOT_NAME),
    path.join(dir,'..','..','data',SNAPSHOT_NAME)
  ];
}

async function loadSnapshot(){

  for (const p of fsPaths()){
    const j = await readJson(p);
    if (j) return j;
  }

  return null;
}

// ---------------- HANDLER ----------------
export async function handler(event){

  if (event.httpMethod === 'OPTIONS'){
    return { statusCode:200, headers:cors(), body:'' };
  }

  const qs = event.queryStringParameters || {};
  const limit = Math.min(parseInt(qs.limit||LIMIT_DEFAULT,10) || LIMIT_DEFAULT, 200);

  const snap = await loadSnapshot();

  let items = [];

  if (snap && Array.isArray(snap.items)){
    items = snap.items;
  }

  return ok({
    source: 'network-snapshot',
    count: items.length,
    items: items.slice(0, limit)
  });
}
