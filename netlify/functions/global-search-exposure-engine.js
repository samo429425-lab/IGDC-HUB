"use strict";
// IGDC / MARU organic discovery v4. No click, rank, traffic or index claims.
const crypto=require("crypto");
const {buildRegistry,selectChangedUrls}=require("./lib/search-exposure/registry");
const indexnow=require("./search-adapters/indexnow");
const configurable=require("./search-adapters/configurable-submit");
const baidu=require("./search-adapters/baidu");
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
 const failed=jobs.filter(x=>x.status==="failed").length;
 const skipped=jobs.filter(x=>SKIP.has(x.status)).length;
 return{submitted,partial,failed,skipped,submissionAdapters:jobs.length};
}
async function run(options={}){
 const reg=buildRegistry();
 const force=options.force===true;
 const n=Number(options.hours);
 const hours=Number.isFinite(n)?Math.max(1,Math.min(720,n)):96;
 const changed=force?reg.targets.map(x=>ownedUrl(x.url)).filter(Boolean):selectChangedUrls(reg,{hours}).map(ownedUrl).filter(Boolean);
 const deleted=(Array.isArray(options.deletedUrls)?options.deletedUrls:[]).map(ownedUrl).filter(Boolean).slice(0,200);
 const urls=[...new Set([...changed,...deleted])];
 // Run concurrently to fit Netlify scheduled-function timeout; each has its own bounded transport.
 const jobs=await Promise.all([
  guard("indexnow",()=>indexnow.submit(urls)),
  guard("china-search",()=>configurable.submit("china-search","CHINA_SEARCH",urls)),
  guard("regional-search",()=>configurable.submit("regional-search","REGIONAL_SEARCH",urls)),
  guard("baidu",()=>baidu.submit(urls))
 ]);
 const audit=summary(jobs);
 const errors=audit.failed+audit.partial;
 const status=errors?(audit.submitted||audit.partial?"partial-failure":"submission-failed"):
             audit.submitted?"submitted":urls.length?"sitemap-only":"no-changes";
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
  changeWindowHours:force?null:hours,changedUrls:urls.length,submissionSummary:audit,sitemap:SITEMAP,results};
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
  const report=await run({force,hours:isAuthorized?Number(q.hours||b.hours||96):96,deletedUrls:deletions&&isAuthorized?b.deletedUrls:[]});
  return{statusCode:report.ok?200:502,headers,body:JSON.stringify(report)};
 }catch(e){return{statusCode:500,headers,body:JSON.stringify({ok:false,error:safeError(e)})};}
};
exports.run=run;
