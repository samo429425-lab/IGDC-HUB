"use strict";
/* IGDC search-only, SQL-free execution receipt. No URL lists, query text,
   user data, provider response bodies, or credentials are persisted. */
const STORE_PREFIX="igdc-search-execution-";
const KEY="latest";
function location(){
  // Preview/branch deploys must not overwrite production execution evidence.
  const context=String(process.env.CONTEXT||"unknown").toLowerCase();
  return STORE_PREFIX+(context==="production"?"production":context.replace(/[^a-z0-9-]/g,"-").slice(0,35));
}
function safeNum(n){const x=Number(n);return Number.isFinite(x)?Math.max(0,Math.trunc(x)):0;}
function summary(report){
  const a=report&&report.submissionSummary||{};
  return{
    run_at:String(report&&report.generatedAt||new Date().toISOString()),
    result_status:String(report&&report.status||"unknown").slice(0,50),
    registry_hash:String(report&&report.registry&&report.registry.hash||"").slice(0,80),
    changed_count:safeNum(report&&report.changedUrls),
    submitted_count:safeNum(a.submitted),
    pending_count:safeNum(a.pending),
    failed_count:safeNum(a.failed),
    partial_count:safeNum(a.partial),
    // A handler invocation can be scheduled or manually triggered. Neither is assumed.
    trigger:"not-independently-verified",
    details:(report&&report.results||[]).filter(x=>x&&x.adapter).slice(0,16).map(x=>({
      engine:String(x.adapter).slice(0,40),
      state:String(x.status||"unknown").slice(0,48),
      count:Number.isFinite(Number(x.count))?safeNum(x.count):null
    }))
  };
}
function openStore(){
  const {getStore}=require("@netlify/blobs");
  return getStore({name:location(),consistency:"strong"});
}
async function bounded(operation){
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("audit-timeout")),3000);})
    ]);
  }finally{clearTimeout(timer);}
}
async function store(report){
  try{
    const record=summary(report);
    await bounded(()=>openStore().setJSON(KEY,record));
    return{state:"stored"};
  }catch(_e){return{state:"storage-unavailable"};}
}
async function readLatest(){
  try{
    const data=await bounded(()=>openStore().get(KEY,{type:"json"}));
    if(!data||typeof data!=="object"||!data.run_at)return{state:"empty",record:null};
    return{state:"available",record:data};
  }catch(_e){return{state:"storage-unavailable",record:null};}
}
module.exports={store,readLatest,_test:{location,summary,safeNum}};
