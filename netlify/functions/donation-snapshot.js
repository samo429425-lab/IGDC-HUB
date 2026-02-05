
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

function normalizeMedia(it){
  const url=String(it.url||"");
  const thumb=String(it.thumbnail||"");
  const isVideo=/youtube|youtu\.be|vimeo/i.test(url)||it.type==="video";

  return {
    type:isVideo?"video":"image",
    thumb:thumb,
    src:isVideo?url:null
  };
}

function sectionOf(it){
  const t=(it.title||"").toLowerCase();
  if(/news|disaster|crisis|war|earthquake|flood/.test(t)) return "donation-global";
  return "donation-ngo";
}

function build(bank){
  const out={
    meta:{
      schema:"donation.snapshot.photo.v2",
      generated_at:new Date().toISOString(),
      producer:"donation-snapshot.js"
    },
    sections:[
      {psom_key:"donation-global",label:"Global / News"},
      {psom_key:"donation-ngo",label:"NGO / Relief"},
      {psom_key:"donation-mission",label:"Mission"},
      {psom_key:"donation-service",label:"Service"},
      {psom_key:"donation-relief",label:"Disaster / Relief"},
      {psom_key:"donation-education",label:"Education"},
      {psom_key:"donation-environment",label:"Environment"},
      {psom_key:"donation-others",label:"Others"}
    ],
    items:[]
  };

  const src=Array.isArray(bank.items)?bank.items:[];

  for(const it of src){
    if(String(it.channel).toLowerCase()!=="donation") continue;

    const key=sectionOf(it);

    out.items.push({
      id:it.id||key+"-"+out.items.length,
      psom_key:key,
      type:key==="donation-global"?"news":"org",
      title:String(it.title||""),
      subtitle:String(it.summary||""),
      image:String(it.thumbnail||""),
      og_image:null,
      link:String(it.url||""),
      country:null,
      source:it.source?.name||"bank",
      priority:null,
      tags:it.tags||[],
      media:normalizeMedia(it)
    });
  }

  return out;
}

function loadSeed(){
  const p=path.join(process.cwd(),"data","donation.snapshot.json");
  const j=readJSON(p);
  if(j) return j;

  return {
    meta:{schema:"donation.snapshot.photo.v2"},
    sections:[],
    items:[]
  };
}

exports.handler=async function(){
  const bank=loadBank();

  if(bank) return ok(build(bank));

  return ok(loadSeed());
};
