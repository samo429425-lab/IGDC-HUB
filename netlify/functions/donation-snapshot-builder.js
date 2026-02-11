"use strict";

const fs = require("fs");
const path = require("path");

/* =========================
   Response Helper
========================= */
function ok(body){
  return {
    statusCode: 200,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*"
    },
    body: JSON.stringify(body,null,2)
  };
}

/* =========================
   Utils
========================= */
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

/* =========================
   Load Seed Snapshot
========================= */
function loadSeed(){

  const paths = [
    path.join(process.cwd(),"data","donation.snapshot.json"),
    path.join(__dirname,"..","..","data","donation.snapshot.json"),
    path.join(__dirname,"donation.snapshot.json")
  ];

  for(const p of paths){
    const j = readJSON(p);
    if(j && j.items && j.sections) return j;
  }

  return {
    meta:{ schema:"donation.snapshot.photo.v3" },
    sections:[],
    items:[]
  };
}

/* =========================
   Load Search Bank
========================= */
function loadBank(){

  const paths = [
    path.join(process.cwd(),"data","search-bank.snapshot.json"),
    path.join(__dirname,"..","..","data","search-bank.snapshot.json"),
    path.join(__dirname,"search-bank.snapshot.json")
  ];

  for(const p of paths){
    const j = readJSON(p);
    if(j && Array.isArray(j.items)) return j;
  }

  return null;
}

/* =========================
   HTML 기준 PSOM Keys
========================= */
const SECTION_KEYS = [
  "donation-ngo",
  "donation-mission",
  "donation-service",
  "donation-education",
  "donation-environment",
  "donation-others"
];

/* =========================
   Section Resolver
========================= */
function resolveSection(it){

  const k = String(
    it.psom_key ||
    it.section ||
    it.category ||
    ""
  ).trim();

  if(SECTION_KEYS.includes(k)) return k;

  const blob = (
    String(it.title||"") + " " +
    String(it.summary||it.description||"") + " " +
    String((it.tags||[]).join(" "))
  ).toLowerCase();

  if(/mission|church|gospel|evangel/.test(blob)) return "donation-mission";
  if(/school|child|youth|student|education/.test(blob)) return "donation-education";
  if(/environment|climate|forest|ocean|wild/.test(blob)) return "donation-environment";
  if(/service|medical|care|support|welfare/.test(blob)) return "donation-service";

  return "donation-ngo";
}

/* =========================
   Media Detect
========================= */
function detectMedia(url,type){

  if(String(type).toLowerCase()==="video") return "video";

  if(/youtube|youtu\.be|vimeo/i.test(String(url||""))){
    return "video";
  }

  return "image";
}

/* =========================
   Normalize Bank Item
========================= */
function normalize(it,idx){

  const title = String(it.title||"").trim();
  const summary = String(it.summary||it.description||"").trim();

  const link = String(
    it.url||it.link||it.href||""
  ).trim();

  const thumb = String(
    it.thumbnail||
    it.thumb||
    it.image||
    it.og_image||
    ""
  ).trim();

  const psom = resolveSection(it);
  const kind = detectMedia(link,it.type||it.media_type);

  return {
    id: it.id || `${psom}-${idx+1}`,

    psom_key: psom,
    category: psom,
    type: "org",

    title,
    summary,

    media:{
      kind,
      thumb: thumb || "/assets/img/placeholder.png",
      src: kind==="video" ? (link||null) : null,
      ratio: null
    },

    link:{
      url: link || "#",
      target: "_blank"
    },

    meta:{
      country: it.country || null,
      language: it.language || null,
      source: it.source?.name || it.source || "bank",
      verified: Boolean(it.verified),
      updated_at: nowIso()
    },

    image: thumb || "/assets/img/placeholder.png",
    og_image: it.og_image || null,

    tags: Array.isArray(it.tags) ? it.tags : []
  };
}

/* =========================
   Build Snapshot
========================= */
function build(bank,seed){

  const out = {
    meta:{
      schema:"donation.snapshot.photo.v3",
      generated_at: nowIso(),
      producer:"donation-snapshot-builder.v3",
      version:3
    },
    sections: seed.sections || [],
    items:[]
  };

  const src = Array.isArray(bank.items) ? bank.items : [];

  /* donation channel only */
  const list = src.filter(x =>
    String(x.channel||"").toLowerCase()==="donation"
  );

  list.forEach((it,i)=>{
    out.items.push(normalize(it,i));
  });

  if(!out.items.length){
    return seed;
  }

  return out;
}

/* =========================
   Netlify Handler
========================= */
exports.handler = async function(){

  const seed = loadSeed();
  const bank = loadBank();

  if(!bank){
    return ok(seed);
  }

  return ok(build(bank,seed));
};
