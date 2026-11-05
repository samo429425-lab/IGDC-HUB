"use strict";
const {buildRegistry,selectChangedUrls}=require("./lib/search-exposure/registry");
const indexnow=require("./search-adapters/indexnow");
const configurable=require("./search-adapters/configurable-submit");
function parseBody(event){try{return JSON.parse(event&&event.body||"{}");}catch(_e){return{};}}
async function run(options={}){
  const reg=buildRegistry();
  const force=options.force===true;
  const changed=force?reg.targets.map(x=>x.url).filter(u=>/^https:\/\/igdcglobal\.com\//i.test(u)):selectChangedUrls(reg,{hours:options.hours||96});
  const deleted=(options.deletedUrls||[]).filter(u=>/^https:\/\/igdcglobal\.com\//i.test(String(u||"")));
  const indexNowUrls=[...new Set([...changed,...deleted])];
  const results=[];
  results.push(await indexnow.submit(indexNowUrls));
  results.push({adapter:"google",status:"sitemap-managed",sitemap:"https://igdcglobal.com/sitemap-global.xml",note:"Public IGDC product and verified country-market URLs are crawlable and sitemap-managed. No generic Google Indexing API is assumed."});
  results.push({adapter:"naver",status:"sitemap-managed",sitemap:"https://igdcglobal.com/sitemap-global.xml",note:"Public IGDC URLs use crawler discovery, robots rules and sitemap. Country market pages are generated only from verified market-sale evidence."});
  results.push({adapter:"yahoo",status:"crawl-managed",sitemap:"https://igdcglobal.com/sitemap-global.xml",note:"No unverified direct-submission API is assumed."});
  results.push(await configurable.submit("china-search","CHINA_SEARCH",indexNowUrls));
  results.push(await configurable.submit("regional-search","REGIONAL_SEARCH",indexNowUrls));
  return{ok:true,version:"igdc-global-search-exposure-v3.0.0-country-aware",generatedAt:new Date().toISOString(),registry:{version:reg.version,hash:reg.hash,counts:reg.counts,total:reg.targets.length,commerce:reg.commerceCount,countryMarketPages:reg.marketCommerceCount,media:reg.mediaCount,countries:Object.keys(reg.countryCounts||{}).length,countryCounts:reg.countryCounts},changeWindowHours:force?null:Number(options.hours||96),changedUrls:indexNowUrls.length,sitemap:"https://igdcglobal.com/sitemap-global.xml",results};
}
exports.handler=async(event)=>{try{const q=event&&event.queryStringParameters||{},body=parseBody(event);const force=(q.force==="1"||body.force===true)&&String(process.env.SEARCH_EXPOSURE_ALLOW_FORCE||"").toLowerCase()==="true";return{statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex, nofollow"},body:JSON.stringify(await run({force,hours:Number(q.hours||body.hours||96),deletedUrls:Array.isArray(body.deletedUrls)?body.deletedUrls:[]}))};}catch(e){return{statusCode:500,headers:{"content-type":"application/json","x-robots-tag":"noindex, nofollow"},body:JSON.stringify({ok:false,error:e.message})};}};
exports.run=run;
