"use strict";
const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
function t(v){return v==null?"":String(v).trim()}
function l(v){return t(v).toLowerCase()}
function o(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{}}
function a(v){return Array.isArray(v)?v:[]}
function json(f){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch(_e){return null}}
function https(v){try{return new URL(t(v)).protocol==="https:"}catch(_e){return false}}

const queue=json(path.join(root,"netlify/functions/data/commerce-candidate-review-queue.v1.json"))||{};
const requested=a(queue.items).filter(x=>{
  const r=o(x&&x.publicationRequest),s=l(o(x&&x.assignment).publicationStatus);
  return r.requested===true||l(r.status)==="publish_requested"||["ready","publish_requested","matched","published"].includes(s);
});

// Ordinary code deploys (including the restored 12:29 baseline) must not require
// a newly materialized SearchBank publication. SearchBank handoff becomes a hard
// build gate only after an explicit administrator Front Match exists.
if(requested.length===0){
  console.log("IGDC SearchBank handoff gate skipped · no administrator Front Match in this build");
  process.exit(0);
}

const structurallyValid=requested.filter(x=>{
  const c=o(x&&x.candidate),r=o(x&&x.publicationRequest),as=o(x&&x.assignment);
  return t(c.id)&&t(c.title||c.name)&&https(c.productUrl||c.externalProductUrl||c.url)&&https(c.imageUrl||c.thumbnailUrl||c.thumbnail||c.image)&&t(r.page||as.page||c.page)&&t(r.section||as.section||c.section)&&t(r.country||as.country)&&t(r.assignmentId||as.id);
});

if(structurallyValid.length!==requested.length){
  const bad=requested.filter(x=>!structurallyValid.includes(x));
  console.error("IGDC SearchBank verification failed: "+bad.length+" administrator-matched products contain structural errors before SearchBank");
  process.exit(86);
}

const files=[
  "data/search-bank.snapshot.json",
  "netlify/functions/data/search-bank.snapshot.json",
  "netlify/functions/search-bank.snapshot.json",
  "search-bank.snapshot.json"
].map(f=>path.join(root,f));
let bank=null,bankFile="";
for(const f of files){
  const d=json(f);
  if(d&&Array.isArray(d.items)){bank=d;bankFile=f;break}
}

if(!bank){
  console.error("IGDC SearchBank verification failed: Front Match exists but no valid search-bank.snapshot.json was materialized");
  process.exit(86);
}

const serialized=JSON.stringify(bank);
const missing=structurallyValid.filter(x=>{
  const id=t(o(x.candidate).id);
  return id&&!serialized.includes(id);
});
const real=a(bank.items).filter(x=>https(x&&(x.productUrl||x.externalProductUrl||x.officialProductUrl||x.url||x.link||x.href))&&!/(sample|placeholder|demo|mock|fixture)/i.test(t(x&&(x.title||x.name)))).length;

if(missing.length){
  console.error("IGDC SearchBank verification failed: "+missing.length+"/"+structurallyValid.length+" administrator-matched products were dropped before SearchBank: "+missing.slice(0,12).map(x=>t(o(x.candidate).id)).join(", "));
  process.exit(86);
}
if(real===0){
  console.error("IGDC SearchBank verification failed: administrator products were requested but SearchBank contains zero real products");
  process.exit(86);
}

console.log("IGDC SearchBank handoff OK · requested="+requested.length+" · structural-valid="+structurallyValid.length+" · searchbank-real="+real+" · file="+path.relative(root,bankFile));
