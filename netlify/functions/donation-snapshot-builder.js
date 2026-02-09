
"use strict";

const fs = require("fs");
const path = require("path");

function ok(body){
  return {
    statusCode:200,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*"
    },
    body:JSON.stringify(body,null,2)
  };
}

function readJSON(p){
  try{
    return JSON.parse(fs.readFileSync(p,"utf-8"));
  }catch(e){
    return null;
  }
}

function nowIso(){
  return new Date().toISOString();
}

function loadSeed(){
  const paths=[
    path.join(process.cwd(),"data","donation.snapshot.json"),
    path.join(__dirname,"..","..","data","donation.snapshot.json"),
    path.join(__dirname,"donation.snapshot.json")
  ];

  for(const p of paths){
    const j=readJSON(p);
    if(j && j.items) return j;
  }

  return {meta:{schema:"donation.snapshot.photo.v3"},sections:[],items:[]};
}

function loadBank(){
  const paths=[
    path.join(process.cwd(),"data","search-bank.snapshot.json"),
    path.join(__dirname,"..","..","data","search-bank.snapshot.json"),
    path.join(__dirname,"search-bank.snapshot.json")
  ];

  for(const p of paths){
    const j=readJSON(p);
    if(j && j.items) return j;
  }

  return null;
}

const SECTION_KEYS=new Set([
  "donation-global",
  "donation-ngo",
  "donation-mission",
  "donation-service",
  "donation-relief",
  "donation-education",
  "donation-environment",
  "donation-others"
]);

function pickSection(it){
  const k=String(it.psom_key||it.section||it.category||"").trim();
  if(SECTION_KEYS.has(k)) return k;

  const blob=(String(it.title||"")+" "+String(it.summary||"")+" "+String((it.tags||[]).join(" "))).toLowerCase();

  if(/news|global|disaster|war|crisis|flood|earthquake/.test(blob)) return "donation-global";
  if(/mission|church|gospel/.test(blob)) return "donation-mission";
  if(/education|child|school|youth/.test(blob)) return "donation-education";
  if(/environment|climate|forest|ocean/.test(blob)) return "donation-environment";
  if(/relief|aid|rescue|emergency/.test(blob)) return "donation-relief";

  return "donation-ngo";
}

function detectKind(url,type){
  if(String(type).toLowerCase()==="video") return "video";
  if(/youtube|youtu\.be|vimeo/i.test(String(url||""))) return "video";
  return "image";
}

function normalize(it,idx){
  const title=String(it.title||"").trim();
  const summary=String(it.summary||it.description||"").trim();

  const link=String(it.url||it.link||"").trim();
  const thumb=String(it.thumbnail||it.thumb||it.image||it.og_image||"").trim();

  const psom=pickSection(it);
  const kind=detectKind(link,it.type||it.media_type);

  const baseType=(psom==="donation-global")?"news":"org";
  const type=(kind==="video"&&psom==="donation-global")?"video":baseType;

  return {
    id:it.id||psom+"-"+(idx+1),
    psom_key:psom,
    category:psom,
    type:type,
    title:title,
    summary:summary,
    media:{
      kind:kind,
      thumb:thumb||"/assets/img/placeholder.png",
      src:kind==="video"?(link||null):null,
      ratio:null
    },
    link:{
      url:link||"#",
      target:"_blank"
    },
    meta:{
      country:it.country||null,
      language:it.language||null,
      source:it.source?.name||it.source||"bank",
      verified:Boolean(it.verified),
      updated_at:nowIso()
    },
    image:thumb||"/assets/img/placeholder.png",
    og_image:it.og_image||null,
    tags:Array.isArray(it.tags)?it.tags:[]
  };
}

function build(bank,seed){
  const out={
    meta:{
      schema:"donation.snapshot.photo.v3",
      generated_at:nowIso(),
      producer:"donation-snapshot-builder.js",
      version:3
    },
    sections:seed.sections||[],
    items:[]
  };

  const src=Array.isArray(bank.items)?bank.items:[];
  const list=src.filter(x=>String(x.channel||"").toLowerCase()==="donation");

  list.forEach((it,i)=>out.items.push(normalize(it,i)));

  if(!out.items.length) return seed;

  return out;
}

exports.handler=async function(){
  const seed=loadSeed();
  const bank=loadBank();

  if(!bank) return ok(seed);

  return ok(build(bank,seed));
};
