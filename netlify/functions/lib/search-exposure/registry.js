"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ORIGIN = (process.env.URL || process.env.DEPLOY_PRIME_URL || "https://igdcglobal.com").replace(/\/+$/, "");
const SNAPSHOTS = {
  commerce: ["netlify/functions/data/distribution.snapshot.json", "netlify/functions/data/front.snapshot.json"],
  media: ["netlify/functions/data/media.snapshot.json"]
};
function txt(v){return v==null?"":String(v).trim();}
function abs(p){try{return new URL(p,ORIGIN).href;}catch(_){return "";}}
function read(rel){for(const f of [path.join(process.cwd(),rel),path.join(__dirname,"..","..",rel.replace(/^netlify\/functions\//,""))]){try{return JSON.parse(fs.readFileSync(f,"utf8"));}catch(_){}}return null;}
function arr(v){if(Array.isArray(v)) return v; if(v&&typeof v==="object") return v.slots||v.items||v.results||[]; return [];}
function walk(doc, cb){
  if(!doc||typeof doc!=="object") return;
  if(doc.sections&&typeof doc.sections==="object") for(const [k,v] of Object.entries(doc.sections)) cb(k,arr(v),"");
  if(doc.pages&&typeof doc.pages==="object") for(const [page,p] of Object.entries(doc.pages||{})) for(const [k,v] of Object.entries((p&&p.sections)||{})) cb(k,arr(v),page);
}
function external(u){return /^https?:\/\//i.test(txt(u)) && !/(example\.com|localhost|placeholder|mediamovie\d+|mediadrama\d+)/i.test(txt(u));}
function placeholder(x){return !!(x&&(x.isSample===true||x.sample===true||x.placeholder===true||x.replaceableSlot===true||/placeholder|sample-card/i.test(txt(x.thumb||x.image||x.thumbnail))));}
function blocked(x){return !!(x&&(x.blockedReason||x.riskLevel==="blocked"||x.status==="blocked"||x.status==="rejected"));}
function published(x){
  if(!x||typeof x!=="object"||placeholder(x)||blocked(x)) return false;
  const cp=x.canonicalPublication||{};
  if(cp.status) return cp.status==="published";
  if(x.frontSupplyAllowed===false||x.snapshotEligible===false||x.searchBankEligible===false) return false;
  return x.realProduct===true||x.published===true||x.status==="published"||x.live===true||x.frontSupplyAllowed===true;
}
function idOf(x){return txt(x.id||x.contentId||x.productId||x.itemId||x.uid||x.sku||x.slotId);}
function updated(x){return txt(x.updatedAt||x.updated_at||x.publishedAt||(x.canonicalPublication&&(x.canonicalPublication.publishedAt||x.canonicalPublication.generatedAt)));}
function brandTargets(){
  const base=[
    {kind:"brand",id:"igdc-global-platform",title:"IGDC Global Platform | MARU Platform",url:abs("/home"),priority:100,keywords:["IGDC Global","IGDC Platform","IGDC Global Platform","MARU Platform","마루 플랫폼","MARU","마루"]},
    {kind:"software",id:"maru-windows",title:"MARU Media Player for Windows",url:abs("/support.html"),priority:95,keywords:["MARU Media Player","media player","video player","audio player","subtitle player","multilingual media player","Windows media player"]}
  ];
  if(process.env.MARU_ANDROID_PLAY_URL) base.push({kind:"software",id:"maru-android",title:"MARU Media Player for Android",url:process.env.MARU_ANDROID_PLAY_URL,priority:95,keywords:["MARU Media Player Android","Android media player","video player","audio player","subtitle player","multilingual media player"]});
  return base;
}
function commerceTargets(){
  const out=new Map();
  for(const rel of SNAPSHOTS.commerce){const d=read(rel);walk(d,(section,items,page)=>{for(const x of items){if(!published(x)) continue;const id=idOf(x);const source=txt(x.url||x.canonicalUrl||x.sourceUrl||(x.detail&&x.detail.detailUrl));const title=txt(x.title||x.name||x.productName);if(!id||!title||!external(source)) continue;out.set(id,{kind:"commerce",id,title,section,page:page||"distribution",sourceUrl:source,url:abs(`/product/${encodeURIComponent(id)}`),priority:Number(x.priority||50),updatedAt:updated(x),keywords:[title,txt(x.brand),txt(x.model||x.modelName),txt(x.category||section)].filter(Boolean)});}});}
  return [...out.values()];
}
function mediaTargets(){
  const out=new Map();
  for(const rel of SNAPSHOTS.media){const d=read(rel);walk(d,(section,items)=>{for(const x of items){if(!published(x)) continue;const id=idOf(x);const source=txt(x.url||x.video||x.canonicalUrl);const title=txt(x.title||x.name);if(!id||!title||!external(source)) continue;const provider=txt(x.provider&& (x.provider.name||x.provider.platform)||x.providerId);out.set(id,{kind:"media",id,title,section,sourceUrl:source,url:abs(`/media-content/${encodeURIComponent(id)}`),priority:Number(x.priority||45),updatedAt:updated(x),keywords:[title,provider,section,"video","media"].filter(Boolean)});}});}
  return [...out.values()];
}
function buildRegistry(){const targets=[...brandTargets(),...commerceTargets(),...mediaTargets()].sort((a,b)=>(b.priority||0)-(a.priority||0));const hash=crypto.createHash("sha256").update(JSON.stringify(targets.map(x=>[x.kind,x.id,x.title,x.url,x.updatedAt||""]))).digest("hex");return{version:"igdc-search-registry-central-v1",generatedAt:new Date().toISOString(),hash,targets,counts:targets.reduce((m,x)=>(m[x.kind]=(m[x.kind]||0)+1,m),{})};}
module.exports={ORIGIN,buildRegistry,published};
