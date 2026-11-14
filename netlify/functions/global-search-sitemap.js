"use strict";
// Read-only search sitemap. Do not advertise private or unverified records.
const {buildRegistry}=require("./lib/search-exposure/registry");
const ORIGIN="https://igdcglobal.com",MAX_URLS=45000;
function esc(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function owned(v){
 try{const u=new URL(String(v||""));return u.protocol==="https:"&&u.hostname==="igdcglobal.com"&&!u.username&&!u.password&&!u.hash?u.href:"";}catch(_e){return "";}
}
function lastmod(v){
 if(!v)return "";
 const d=Date.parse(String(v));
 if(!Number.isFinite(d)||d>Date.now()+300000)return "";
 return new Date(d).toISOString();
}
function urlset(targets){
 const rows=['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
 for(const t of targets){
  rows.push("  <url>","    <loc>"+esc(t.url)+"</loc>");
  const stamp=lastmod(t.updatedAt||t.marketVerifiedAt);
  if(stamp)rows.push("    <lastmod>"+stamp+"</lastmod>");
  rows.push("  </url>");
 }
 return rows.concat("</urlset>").join("\n")+"\n";
}
function indexXml(parts){
 const rows=['<?xml version="1.0" encoding="UTF-8"?>','<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
 for(let i=1;i<=parts;i++)rows.push("  <sitemap>","    <loc>"+ORIGIN+"/.netlify/functions/global-search-sitemap?part="+i+"</loc>","  </sitemap>");
 return rows.concat("</sitemapindex>").join("\n")+"\n";
}
exports.handler=async event=>{
 try{
  const reg=buildRegistry(),seen=new Set(),targets=[];
  for(const t of reg.targets){
   const url=owned(t&&t.url);
   if(!url||seen.has(url))continue;
   seen.add(url);targets.push({...t,url});
  }
  const parts=Math.max(1,Math.ceil(targets.length/MAX_URLS));
  const raw=event&&event.queryStringParameters&&event.queryStringParameters.part;
  if(raw!==undefined&&(!/^[1-9]\d{0,5}$/.test(String(raw))||Number(raw)>parts))return{statusCode:404,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"},body:"Sitemap part not found"};
  const part=raw===undefined?0:Number(raw);
  const body=parts>1&&!part?indexXml(parts):urlset(targets.slice(((part||1)-1)*MAX_URLS,(part||1)*MAX_URLS));
  return{statusCode:200,headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public,max-age=900,s-maxage=1800","x-content-type-options":"nosniff","x-igdc-search-registry":reg.hash,"x-igdc-sitemap-parts":String(parts),"x-igdc-country-market-pages":String(reg.marketCommerceCount||0)},body};
 }catch(e){return{statusCode:503,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"},body:"Search sitemap unavailable"};}
};
