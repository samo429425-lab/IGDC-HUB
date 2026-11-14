"use strict";
const crypto=require("crypto");
const {buildRegistry,selectChangedUrls}=require("./lib/search-exposure/registry");
const indexnow=require("./search-adapters/indexnow");
const configurable=require("./search-adapters/configurable-submit");
const SITE="https://igdcglobal.com";
const SITEMAP=SITE+"/sitemap-global.xml";
function parseBody(event){try{const v=JSON.parse(event&&event.body||"{}");return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}catch(_e){return {};}}
function ownedUrl(value){
  try{const u=new URL(String(value||""));return u.protocol==="https:"&&u.hostname==="igdcglobal.com"&&u.username===""&&u.password===""?u.href:"";}catch(_e){return "";}
}
function isAdmin(event){
  const configured=String(process.env.SEARCH_EXPOSURE_ADMIN_TOKEN||"");
  if(!configured)return false;
  const headers=event&&event.headers||{};
  const raw=String(headers.authorization||headers.Authorization||"");
  if(!raw.startsWith("Bearer "))return false;
  const given=Buffer.from(raw.slice(7),"utf8"),expected=Buffer.from(configured,"utf8");
  return given.length===expected.length&&crypto.timingSafeEqual(given,expected);
}
function outcome(adapter,reason){return{adapter,status:"failed",reason:String(reason&&reason.message||reason||"Unknown error").slice(0,250)};}
async function guarded(adapter,operation){
  try{return await operation();}catch(e){return outcome(adapter,e);}
}
async function run(options={}){
  const reg=buildRegistry();
  const force=options.force===true;
  const windowHours=Math.max(1,Math.min(720,Number(options.hours)||96));
  const changed=force?reg.targets.map(x=>x.url).map(ownedUrl).filter(Boolean):selectChangedUrls(reg,{hours:windowHours});
  const deleted=(Array.isArray(options.deletedUrls)?options.deletedUrls:[]).map(ownedUrl).filter(Boolean).slice(0,200);
  const indexNowUrls=[...new Set([...changed,...deleted])];
  const jobs=await Promise.all([
    guarded("indexnow",()=>indexnow.submit(indexNowUrls)),
    guarded("china-search",()=>configurable.submit("china-search","CHINA_SEARCH",indexNowUrls)),
    guarded("regional-search",()=>configurable.submit("regional-search","REGIONAL_SEARCH",indexNowUrls))
  ]);
  const results=[
    jobs[0],
    {adapter:"google",status:"sitemap-managed",sitemap:SITEMAP,note:"Google discovery is sitemap-managed; no generic Google Indexing API or ranking guarantee is assumed."},
    {adapter:"naver",status:"sitemap-managed",sitemap:SITEMAP,note:"Public verified IGDC URLs remain sitemap-managed."},
    {adapter:"yahoo",status:"crawl-managed",sitemap:SITEMAP,note:"No unverified direct-submission API is assumed."},
    jobs[1],jobs[2]
  ];
  const submitted=jobs.filter(x=>x.status==="submitted").length;
  const failed=jobs.filter(x=>x.status==="failed").length;
  const skipped=jobs.filter(x=>["disabled","noop","sitemap-managed"].includes(x.status)).length;
  const status=failed?(submitted?"partial-failure":"submission-failed"):(submitted?"submitted":(indexNowUrls.length?"sitemap-only":"no-changes"));
  return{
    ok:failed===0,status,
    version:"igdc-global-search-exposure-v3.1.0-safe",
    generatedAt:new Date().toISOString(),
    registry:{version:reg.version,hash:reg.hash,counts:reg.counts,total:reg.targets.length,commerce:reg.commerceCount,countryMarketPages:reg.marketCommerceCount,media:reg.mediaCount,countries:Object.keys(reg.countryCounts||{}).length,countryCounts:reg.countryCounts},
    changeWindowHours:force?null:windowHours,changedUrls:indexNowUrls.length,
    submissionSummary:{submitted,failed,skipped,submissionAdapters:jobs.length},
    sitemap:SITEMAP,results
  };
}
exports.handler=async event=>{
  const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex, nofollow"};
  try{
    const q=event&&event.queryStringParameters||{},body=parseBody(event);
    const requestedForce=q.force==="1"||body.force===true;
    const requestedDeletes=Array.isArray(body.deletedUrls)&&body.deletedUrls.length>0;
    const auth=isAdmin(event);
    if((requestedForce||requestedDeletes)&&!auth)return{statusCode:403,headers,body:JSON.stringify({ok:false,error:"Administrator authorization required"})};
    const force=requestedForce&&String(process.env.SEARCH_EXPOSURE_ALLOW_FORCE||"").toLowerCase()==="true"&&auth;
    const report=await run({force,hours:Number(q.hours||body.hours||96),deletedUrls:auth&&requestedDeletes?body.deletedUrls:[]});
    return{statusCode:report.ok?200:502,headers,body:JSON.stringify(report)};
  }catch(e){return{statusCode:500,headers,body:JSON.stringify({ok:false,error:String(e.message||e).slice(0,250)})};}
};
exports.run=run;
