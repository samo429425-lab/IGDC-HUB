"use strict";
// IGDC / MARU organic discovery v4. No click, rank, traffic or index claims.
const crypto=require("crypto");
const {buildRegistry,selectChangedUrls}=require("./lib/search-exposure/registry");
const indexnow=require("./search-adapters/indexnow");
const configurable=require("./search-adapters/configurable-submit");
const baidu=require("./search-adapters/baidu");
const ledger=require("./lib/igdc-search-exposure-run-ledger");
const SITE="https://igdcglobal.com",SITEMAP=SITE+"/sitemap-global.xml";
function bodyOf(event){try{const x=JSON.parse(event&&event.body||"{}");return x&&typeof x==="object"&&!Array.isArray(x)?x:{};}catch(_e){return {};}}
function ownedUrl(value){
 try{const u=new URL(String(value||""));return u.protocol==="https:"&&u.hostname==="igdcglobal.com"&&!u.username&&!u.password&&!u.hash?u.href:"";}catch(_e){return "";}
}
function admin(event){
 const secret=String(process.env.SEARCH_EXPOSURE_ADMIN_TOKEN||"");
 if(!secret)return false;
 const headers=event&&event.headers||{};
 const raw=String(headers.authorization||headers.Authorization||"");
 if(!raw.startsWith("Bearer "))return false;
 const lhs=Buffer.from(raw.slice(7)),rhs=Buffer.from(secret);
 return lhs.length===rhs.length&&crypto.timingSafeEqual(lhs,rhs);
}
function safeError(e){return String(e&&e.message||e||"Adapter error").slice(0,160);}
async function guard(name,fn){
 try{
  const value=await fn();
  if(!value||typeof value!=="object"||typeof value.status!=="string")return{adapter:name,status:"failed",reason:"Adapter did not return a status"};
  return value;
 }catch(e){return{adapter:name,status:"failed",reason:safeError(e)};}
}
const SKIP=new Set(["disabled","noop","sitemap-managed","crawl-managed"]);
function summary(jobs){
 const submitted=jobs.filter(x=>x.status==="submitted").length;
 const partial=jobs.filter(x=>x.status==="partial-failure").length;
  const pending=jobs.filter(x=>x.status==="pending-verification").length;
  const failed=jobs.filter(x=>x.status==="failed").length;
 const skipped=jobs.filter(x=>SKIP.has(x.status)).length;
  return{submitted,pending,partial,failed,skipped,submissionAdapters:jobs.length};
}

const SUBMISSION_ADAPTERS=["indexnow","china-search","regional-search","baidu"];
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
function revision(url,item,isDeleted){
 return sha(JSON.stringify(isDeleted?[url,"deleted"]:[
 url,item&&item.updatedAt||"",item&&item.marketVerifiedAt||"",
 item&&item.fingerprint||"",item&&item.marketEvidenceDigest||"",
 item&&item.title||"",item&&item.keywords||[]]));
}
function makePlan(reg,urls,deleted,checkpoint,force){
 const targets=new Map((reg.targets||[]).map(item=>[ownedUrl(item.url),item]));
 const deletedSet=new Set(deleted);
 const revisions=new Map(urls.map(url=>[url,revision(url,targets.get(url),deletedSet.has(url))]));
 const reliable=checkpoint.state==="empty"||checkpoint.state==="available";
 const entries=checkpoint.entries||{};
 const selected=SUBMISSION_ADAPTERS.map(name=>urls.filter(url=>
  force||!reliable||deletedSet.has(url)||!(entries[name]&&entries[name][sha(url)]&&entries[name][sha(url)].revision===revisions.get(url))));
 return{reliable,selected,revisions};
}
function acknowledged(checkpoint,plan,jobs){
 if(!plan.reliable)return null;
 const entries=checkpoint.entries||{};
 let updated=false,count=0;
 SUBMISSION_ADAPTERS.forEach((name,i)=>{
  // HTTP 202 means a search engine accepted a key-verification request;
  // it is a receipt, NOT evidence of actual indexing or rank.
  if(!jobs[i]||!["submitted","pending-verification"].includes(jobs[i].status)||!plan.selected[i].length)return;
  const previous=entries[name]||{},block={...previous};
  for(const url of plan.selected[i]){block[sha(url)]={revision:plan.revisions.get(url),at:Date.now()};count++;}
  entries[name]=block;updated=true;
 });
 return updated?{entries,count}:null;
}
async function run(options={}){
 const reg=buildRegistry();
 const force=options.force===true;
 const n=Number(options.hours);
 const hours=Number.isFinite(n)?Math.max(1,Math.min(720,n)):96;
 const checkpoint=force?{state:"force",entries:{}}:await ledger.readCheckpoints(options.event);
 const changed=force?reg.targets.map(x=>ownedUrl(x.url)).filter(Boolean):selectChangedUrls(reg,{hours}).map(ownedUrl).filter(Boolean);
 const deleted=(Array.isArray(options.deletedUrls)?options.deletedUrls:[]).map(ownedUrl).filter(Boolean).slice(0,200);
 // New or altered approved public URLs must not be lost when their published/updated
 // timestamp was not refreshed. Use durable per-URL revision receipts, never crawl private candidates.
 // This is deliberately a bounded scheduled backlog, not synthetic search traffic.
 const canCheck=checkpoint.state==="available"||checkpoint.state==="empty";
 const hasIndexNow=Boolean(String(process.env.INDEXNOW_KEY||"").trim());
 const ack=checkpoint.entries&&checkpoint.entries.indexnow||{};
 const freshCandidates=(!force&&canCheck&&hasIndexNow)?(reg.targets||[])
  .map(t=>({t,url:ownedUrl(t.url)})).filter(x=>x.url)
  .filter(x=>!(ack[sha(x.url)]&&ack[sha(x.url)].revision===revision(x.url,x.t,false)))
  .sort((a,b)=>{
   const pa=a.t.kind==="software"?0:a.t.kind==="hub"?1:a.t.kind==="commerce"?2:a.t.kind==="commerce-market"?3:4;
   const pb=b.t.kind==="software"?0:b.t.kind==="hub"?1:b.t.kind==="commerce"?2:b.t.kind==="commerce-market"?3:4;
   return pa-pb||a.url.localeCompare(b.url);
  }).map(x=>x.url):[];
 const batchLimit=force?10000:300;
 // Prioritize not-yet-acknowledged URLs so large backlogs progress across daily runs.
 const urls=[...new Set([...deleted,...freshCandidates,...changed])].slice(0,batchLimit);
 const plan=makePlan(reg,urls,deleted,checkpoint,force);
 const jobs=await Promise.all([
  guard("indexnow",()=>indexnow.submit(plan.selected[0])),
  guard("china-search",()=>configurable.submit("china-search","CHINA_SEARCH",plan.selected[1])),
  guard("regional-search",()=>configurable.submit("regional-search","REGIONAL_SEARCH",plan.selected[2])),
  guard("baidu",()=>baidu.submit(plan.selected[3]))
 ]);
 const accepted=acknowledged(checkpoint,plan,jobs);
 const checkpointSaved=accepted?await ledger.storeCheckpoints(accepted.entries,options.event):null;
 const duplicatesSkipped=plan.selected.reduce((total,v)=>total+urls.length-v.length,0);
 const audit=summary(jobs);
 const errors=audit.failed+audit.partial;
 const status=errors?(audit.submitted||audit.partial?"partial-failure":"submission-failed"):
             audit.submitted?"submitted":audit.pending?"pending-verification":urls.length?"sitemap-only":"no-changes";
 const results=[
  jobs[0],
  {adapter:"google",status:"sitemap-managed",sitemap:SITEMAP,note:"Crawl discovery only; Google generic Indexing API is not used"},
  {adapter:"naver",status:"sitemap-managed",sitemap:SITEMAP,note:"IndexNow receipt in indexnow.providers when configured; otherwise sitemap and Search Advisor"},
  {adapter:"daum",status:"sitemap-managed",sitemap:SITEMAP,note:"Daum Search Registration is an external owner action, not a generic submission API"},
  {adapter:"yahoo",status:"crawl-managed",sitemap:SITEMAP,note:"Yahoo search commonly uses Bing discovery, not an independent push API"},
  jobs[1],jobs[2],jobs[3],
  {adapter:"bilibili",status:"not-a-web-search-engine",note:"Bilibili platform discovery requires an authorized content presence; no automated uploads or ranking simulation"}
 ];
 return{ok:errors===0,status,version:"igdc-global-search-exposure-v4.0.0-marusearch",
  generatedAt:new Date().toISOString(),
  registry:{version:reg.version,hash:reg.hash,counts:reg.counts,total:reg.targets.length,commerce:reg.commerceCount,countryMarketPages:reg.marketCommerceCount,media:reg.mediaCount,countries:Object.keys(reg.countryCounts||{}).length,countryCounts:reg.countryCounts},
  changeWindowHours:force?null:hours,changedUrls:urls.length,submissionSummary:audit,
  discovery:{unacknowledgedCandidates:freshCandidates.length,batchLimit,usedUnacknowledged:Math.min(freshCandidates.length,urls.length),note:"Submission receipt is not search indexing or search rank"},
  deduplication:{checkpointState:checkpoint.state,duplicatesSkipped,acknowledgedRevisions:accepted?accepted.count:0,
    checkpointWrite:checkpointSaved?checkpointSaved.state:"no-write",storesUrls:false},
  sitemap:SITEMAP,results};
}
exports.handler=async event=>{
 const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex, nofollow"};
 try{
  const q=event&&event.queryStringParameters||{},b=bodyOf(event),isAuthorized=admin(event);
  const forceRequested=q.force==="1"||b.force===true;
  const deletions=Array.isArray(b.deletedUrls)&&b.deletedUrls.length>0;
  const hoursRequested=q.hours!==undefined||b.hours!==undefined;
  if((forceRequested||deletions||hoursRequested)&&!isAuthorized)return{statusCode:403,headers,body:JSON.stringify({ok:false,error:"Administrator authorization required"})};
  const force=forceRequested&&String(process.env.SEARCH_EXPOSURE_ALLOW_FORCE||"").toLowerCase()==="true";
  if(forceRequested&&!force)return{statusCode:403,headers,body:JSON.stringify({ok:false,error:"Force submission is not enabled"})};
  const report=await run({force,hours:isAuthorized?Number(q.hours||b.hours||96):96,deletedUrls:deletions&&isAuthorized?b.deletedUrls:[],event});
  // Persist sanitized execution evidence, never blocking a search submission.
  const recorded=await ledger.store(report,event);
  report.executionAudit={storage:recorded.state,stored:recorded.state==="stored"};
  try{console.info("[IGDC_SEARCH_EXPOSURE_RUN]",JSON.stringify({
   generatedAt:report.generatedAt,status:report.status,changedUrls:report.changedUrls,
   submitted:report.submissionSummary.submitted,partial:report.submissionSummary.partial,
   failed:report.submissionSummary.failed,skipped:report.submissionSummary.skipped,
   registryHash:report.registry.hash,auditStorage:recorded.state
  }));}catch(_e){}
  return{statusCode:report.ok?200:502,headers,body:JSON.stringify(report)};
 }catch(e){return{statusCode:500,headers,body:JSON.stringify({ok:false,error:safeError(e)})};}
};
exports.run=run;
