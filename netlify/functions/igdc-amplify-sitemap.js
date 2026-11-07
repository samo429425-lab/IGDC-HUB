"use strict";
const {ORIGIN,buildCatalog}=require("./lib/igdc-amplify/catalog");
const PAGE_SIZE=10000;
function xmlEsc(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function urlset(c,part){
 const start=(part-1)*PAGE_SIZE,targets=c.items.slice(start,start+PAGE_SIZE);
 const rows=part===1?[`${ORIGIN}/igdc-amplify-search.html`,`${ORIGIN}/igdc-amplify-maru.html`]:[];
 let s='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
 for(const u of rows)s+=`<url><loc>${xmlEsc(u)}</loc></url>\n`;
 for(const t of targets)s+=`<url><loc>${xmlEsc(t.url)}</loc>${t.updatedAt?`<lastmod>${xmlEsc(t.updatedAt)}</lastmod>`:""}</url>\n`;
 return s+'</urlset>\n';
}
function sitemapIndex(n){let s='<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
 for(let i=1;i<=n;i++)s+=`<sitemap><loc>${ORIGIN}/.netlify/functions/igdc-amplify-sitemap?part=${i}</loc></sitemap>\n`;
 return s+'</sitemapindex>\n';}
exports.handler=async(event)=>{
 const c=buildCatalog(),parts=Math.max(1,Math.ceil(c.items.length/PAGE_SIZE)),raw=String(event&&event.queryStringParameters&&event.queryStringParameters.part||"");
 if(raw&&(!/^\d{1,5}$/.test(raw)||Number(raw)<1||Number(raw)>parts))return {statusCode:404,headers:{"content-type":"text/plain","cache-control":"no-store"},body:"Sitemap part not found"};
 const body=parts>1&&!raw?sitemapIndex(parts):urlset(c,raw?Number(raw):1);
 return{statusCode:200,headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public,max-age=0,s-maxage=30,must-revalidate","x-igdc-amplify-catalog":c.hash},body};
};
