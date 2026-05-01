"use strict";

/*
MARU AI ADAPTER HUB
------------------------------------------------------------
Unified AI Adapter Layer

Functions
- source discovery
- content classification
- quality filtering
- auto mapping
- SANMARU future bridge

Designed for
planetary-data-connector
*/

const VERSION = "maru-ai-adapter-hub-v1";

/* --------------------------------------------------
UTIL
-------------------------------------------------- */

function s(x){ return String(x == null ? "" : x); }

function low(x){ return s(x).toLowerCase(); }

function now(){ return Date.now(); }

function clone(obj){
 try{
  return JSON.parse(JSON.stringify(obj));
 }catch(e){
  return obj;
 }
}

/* --------------------------------------------------
AI SOURCE DISCOVERY
-------------------------------------------------- */

async function discover(query,context){

 try{

  const q = s(query?.q || query?.query || "");

  if(!q) return [];

  // future: rss/api crawler
  return [];

 }catch(e){
  return [];
 }

}

/* --------------------------------------------------
AI CONTENT CLASSIFIER
-------------------------------------------------- */

async function classify(query,context){

 try{

  const q = low(query?.q || query?.query || "");

  let type = "general";

  if(/video|media|clip/.test(q)) type = "media";
  else if(/news|headline|breaking/.test(q)) type = "news";
  else if(/science|research|paper/.test(q)) type = "science";
  else if(/map|geo|city|country/.test(q)) type = "geo";
  else if(/price|buy|market|product/.test(q)) type = "commerce";

  return [{
   type,
   source:"ai-classifier",
   timestamp:now()
  }];

 }catch(e){
  return [];
 }

}

/* --------------------------------------------------
AI QUALITY FILTER
-------------------------------------------------- */

async function quality(query,context){

 try{

  const items = Array.isArray(context?.items)
   ? context.items
   : [];

  const clean = items.filter(it => {

   if(!it) return false;

   if(it.deepfakeRisk > 0.9) return false;

   if(it.manipulationRisk > 0.9) return false;

   return true;

  });

  return clean;

 }catch(e){
  return [];
 }

}

/* --------------------------------------------------
AI AUTOMAP
-------------------------------------------------- */

async function automap(query,context){

 try{

  const items = Array.isArray(context?.items)
   ? context.items
   : [];

  const mapped = items.map(it => {

   return {
    ...clone(it),
    slot: "auto",
    mappedBy: "ai-automap",
    timestamp: now()
   };

  });

  return mapped;

 }catch(e){
  return [];
 }

}

/* --------------------------------------------------
SANMARU FUTURE ENGINE
-------------------------------------------------- */

async function sanmaru(query,context){

 try{

  const Sanmaru = require("./sanmaru_engine_v2");

  if(Sanmaru && typeof Sanmaru.runSanmaru === "function"){
   const res = await Sanmaru.runSanmaru(query, {
    ...(context || {}),
    from: "ai-adapters",
    source: "ai-adapters",
    noAiSanmaru: true
   });

   if(res && Array.isArray(res.items)) return res.items;
   if(res && Array.isArray(res.results)) return res.results;
  }

  return [];

 }catch(e){
  return [];
 }

}

/* --------------------------------------------------
EXPORT
-------------------------------------------------- */

module.exports = {

 version: VERSION,

 discover,
 classify,
 quality,
 automap,
 sanmaru

};