"use strict";

const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
function t(v){return v==null?"":String(v).trim()}
function l(v){return t(v).toLowerCase()}
function o(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{}}
function a(v){return Array.isArray(v)?v:[]}
function json(f){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch(_e){return null}}
function https(v){try{return new URL(t(v)).protocol==="https:"}catch(_e){return false}}
function baseId(v){return t(v).split("::")[0]}
const NONPUBLIC=new Set(["blocked_structural","deferred_duplicate_product","deferred_section_capacity"]);

const queue=json(path.join(root,"netlify/functions/data/commerce-candidate-review-queue.v1.json"))||{};
const all=a(queue.items);
const requested=all.filter(x=>{
  const r=o(x&&x.publicationRequest),as=o(x&&x.assignment);
  const status=l(r.status||as.publicationStatus);
  if(NONPUBLIC.has(status))return false;
  return r.requested===true||status==="publish_requested"||status==="matched"||status==="published"||status==="active";
});

if(requested.length===0){
  const held=all.filter(x=>NONPUBLIC.has(l(o(x&&x.publicationRequest).status||o(x&&x.assignment).publicationStatus))).length;
  console.log("IGDC SearchBank handoff gate skipped · no normalized administrator publication request · held="+held);
  process.exit(0);
}

const structurallyValid=requested.filter(x=>{
  const c=o(x&&x.candidate),r=o(x&&x.publicationRequest),as=o(x&&x.assignment);
  return t(c.id)&&t(c.title||c.name)&&https(c.productUrl||c.externalProductUrl||c.url)&&https(c.imageUrl||c.thumbnailUrl||c.thumbnail||c.image)&&t(r.page||as.page||c.page)&&t(r.section||as.section||c.section)&&t(r.country||as.country)&&t(r.assignmentId||as.id);
});
if(structurallyValid.length!==requested.length){
  const bad=requested.filter(x=>!structurallyValid.includes(x));
  console.error("IGDC SearchBank verification failed: normalized publication queue still contains "+bad.length+" structural error(s) · sample="+bad.slice(0,8).map(x=>t(o(x.candidate).id)).join(","));
  process.exit(86);
}

const files=[
  "data/search-bank.snapshot.json",
  "netlify/functions/data/search-bank.snapshot.json",
  "netlify/functions/search-bank.snapshot.json",
  "search-bank.snapshot.json"
].map(f=>path.join(root,f));
let bank=null,bankFile="";
for(const f of files){const d=json(f);if(d&&Array.isArray(d.items)){bank=d;bankFile=f;break}}
if(!bank){
  console.error("IGDC SearchBank verification failed: normalized Front Match exists but no valid search-bank.snapshot.json was materialized");
  process.exit(86);
}

const bankIds=new Set();
for(const item of a(bank.items)){
  const publication=o(item&&item.canonicalPublication);
  for(const value of [publication.candidateId,item&&item.candidateId,item&&item.id,item&&item.productId,item&&item.contentId]){
    const id=baseId(value);if(id)bankIds.add(id);
  }
}
const missing=structurallyValid.filter(x=>{const id=baseId(o(x&&x.candidate).id);return id&&!bankIds.has(id)});
const real=a(bank.items).filter(x=>https(x&&(x.productUrl||x.externalProductUrl||x.officialProductUrl||x.url||x.link||x.href))&&!/(sample|placeholder|demo|mock|fixture)/i.test(t(x&&(x.title||x.name)))).length;
const held=all.filter(x=>NONPUBLIC.has(l(o(x&&x.publicationRequest).status||o(x&&x.assignment).publicationStatus)));
const heldCounts={};
for(const x of held){const s=l(o(x&&x.publicationRequest).status||o(x&&x.assignment).publicationStatus)||"unknown";heldCounts[s]=(heldCounts[s]||0)+1;}

if(missing.length){
  console.error("IGDC SearchBank verification failed: true normalized identity loss "+missing.length+"/"+structurallyValid.length+" · sample="+missing.slice(0,12).map(x=>baseId(o(x.candidate).id)).join(","));
  process.exit(86);
}
if(real===0){
  console.error("IGDC SearchBank verification failed: normalized administrator products were requested but SearchBank contains zero real products");
  process.exit(86);
}

console.log("IGDC SearchBank handoff OK · normalized-requested="+requested.length+" · structural-valid="+structurallyValid.length+" · held="+held.length+" "+JSON.stringify(heldCounts)+" · searchbank-real="+real+" · file="+path.relative(root,bankFile));
