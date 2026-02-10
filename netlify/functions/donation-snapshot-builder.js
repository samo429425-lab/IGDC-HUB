"use strict";

const fs = require("fs");
const path = require("path");

function ok(body){
  return {
    statusCode: 200,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*"
    },
    body: JSON.stringify(body, null, 2)
  };
}

function readJSON(p){
  try{
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }catch(e){
    return null;
  }
}

function nowIso(){
  return new Date().toISOString();
}

/* Seed snapshot (fallback) */
function loadSeed(){
  const paths = [
    path.join(process.cwd(), "data", "donation.snapshot.json"),
    path.join(__dirname, "..", "..", "data", "donation.snapshot.json"),
    path.join(__dirname, "donation.snapshot.json")
  ];
  for(const p of paths){
    const j = readJSON(p);
    if(j && Array.isArray(j.items) && Array.isArray(j.sections)) return j;
  }
  return { meta:{ schema:"donation.snapshot.photo.v3" }, sections:[], items:[] };
}

/* Search Bank snapshot */
function loadBank(){
  const paths = [
    path.join(process.cwd(), "data", "search-bank.snapshot.json"),
    path.join(__dirname, "..", "..", "data", "search-bank.snapshot.json"),
    path.join(__dirname, "search-bank.snapshot.json")
  ];
  for(const p of paths){
    const j = readJSON(p);
    if(j && Array.isArray(j.items)) return j;
  }
  return null;
}

/* HTML 기준 섹션 키 (donation.html의 data-psom-key와 1:1) */
const SECTION_KEYS = new Set([
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
  const k = String(it.psom_key || it.section || it.category || "").trim();
  if(SECTION_KEYS.has(k)) return k;

  const blob = (
    String(it.title||"") + " " +
    String(it.summary||it.description||"") + " " +
    String((it.tags||[]).join(" "))
  ).toLowerCase();

  /* Global / News */
  if(/news|global|headline|breaking|disaster|war|crisis|flood|earthquake|typhoon/.test(blob)){
    return "donation-global";
  }

  /* Mission */
  if(/mission|church|gospel|evangel|christ/.test(blob)){
    return "donation-mission";
  }

  /* Education */
  if(/education|school|student|child|youth|scholar/.test(blob)){
    return "donation-education";
  }

  /* Environment */
  if(/environment|climate|forest|ocean|wildlife|carbon/.test(blob)){
    return "donation-environment";
  }

  /* Relief (field) */
  if(/relief|aid|rescue|emergency|shelter|medical/.test(blob)){
    return "donation-relief";
  }

  /* Service */
  if(/service|support|care|welfare|community/.test(blob)){
    return "donation-service";
  }

  /* Default */
  return "donation-ngo";
}

function detectKind(url, type){
  if(String(type).toLowerCase() === "video") return "video";
  if(/youtube|youtu\.be|vimeo/i.test(String(url||""))) return "video";
  return "image";
}

function normalize(it, idx){
  const title = String(it.title||"").trim();
  const summary = String(it.summary||it.description||"").trim();

  const link = String(it.url || it.link || it.href || "").trim();
  const thumb = String(it.thumbnail || it.thumb || it.image || it.og_image || "").trim();

  const psom = pickSection(it);
  const kind = detectKind(link, it.type || it.media_type);

  const type = (psom === "donation-global") ? (kind==="video" ? "video" : "news") : "org";

  return {
    id: it.id || `${psom}-${idx+1}`,
    psom_key: psom,
    category: psom,
    type,
    title,
    summary,
    media:{
      kind,
      thumb: thumb || "/assets/img/placeholder.png",
      src: (kind==="video") ? (link || null) : null,
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

function build(bank, seed){
  const out = {
    meta:{
      schema:"donation.snapshot.photo.v3",
      generated_at: nowIso(),
      producer:"donation-snapshot-builder.v3.html-aligned",
      version: 3
    },
    sections: seed.sections || [],
    items: []
  };

  const src = Array.isArray(bank.items) ? bank.items : [];
  const list = src.filter(x => String(x.channel||"").toLowerCase() === "donation");

  list.forEach((it,i) => out.items.push(normalize(it,i)));

  if(!out.items.length) return seed;
  return out;
}

exports.handler = async function(){
  const seed = loadSeed();
  const bank = loadBank();
  if(!bank) return ok(seed);
  return ok(build(bank, seed));
};
