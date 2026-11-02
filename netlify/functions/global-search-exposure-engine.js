"use strict";
const {buildRegistry}=require("./lib/search-exposure/registry");
const indexnow=require("./search-adapters/indexnow");
const configurable=require("./search-adapters/configurable-submit");
async function run(){const reg=buildRegistry();const urls=reg.targets.map(x=>x.url).filter(u=>/^https:\/\/igdcglobal\.com\//i.test(u));const results=[];results.push(await indexnow.submit(urls));results.push({adapter:"google",status:"sitemap-managed",sitemap:"https://igdcglobal.com/sitemap-global.xml",note:"General web pages use sitemap/crawling; no fake generic Indexing API submission."});results.push(await configurable.submit("naver","NAVER_SEARCH",urls));results.push(await configurable.submit("china-search","CHINA_SEARCH",urls));results.push(await configurable.submit("regional-search","REGIONAL_SEARCH",urls));return{ok:true,version:"igdc-global-search-central-v1",generatedAt:new Date().toISOString(),registry:{hash:reg.hash,counts:reg.counts,total:reg.targets.length},sitemap:"https://igdcglobal.com/sitemap-global.xml",results};}
exports.handler=async()=>{try{return{statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},body:JSON.stringify(await run())};}catch(e){return{statusCode:500,headers:{"content-type":"application/json"},body:JSON.stringify({ok:false,error:e.message})};}};
exports.run=run;
