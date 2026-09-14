"use strict";

/**
 * XML sitemap for published IGDC commerce detail pages.
 * Reads only already-published snapshot items; no private candidate is exposed.
 * Submit the direct function URL to search consoles until/if a vanity route is
 * later added. No _redirects change is required by this patch.
 */

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const SNAPSHOTS=[
  "data/front.snapshot.json",
  "data/networkhub-snapshot.json",
  "data/distribution.snapshot.json",
  "data/tour-snapshot.json",
  "netlify/functions/data/front.snapshot.json",
  "netlify/functions/data/networkhub-snapshot.json",
  "netlify/functions/data/distribution.snapshot.json",
  "netlify/functions/data/tour-snapshot.json"
];

function read(file){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_e){return null;}}
function text(v){return v==null?"":String(v).trim();}
function esc(v){return text(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function idOf(x){return text(x&&(x.id||x.contentId||x.productId||x.itemId||x.uid));}
function isPublished(x){return !!(x&&x.canonicalPublication&&x.canonicalPublication.status==="published") || !!(x&&x.commerceCandidatePublication);}
function add(out,value){if(Array.isArray(value))value.forEach(x=>{if(x&&typeof x==="object")out.push(x);});}
function collect(doc){
  const out=[]; if(!doc||typeof doc!=="object")return out;
  add(out,doc.items); add(out,doc.results); add(out,doc.slots);
  for(const key of ["pages","sections"]){
    const c=doc[key]; if(!c||typeof c!=="object")continue;
    Object.values(c).forEach(page=>{
      const sections=page&&page.sections || (key==="sections"?page:null);
      if(!sections||typeof sections!=="object")return;
      Object.values(sections).forEach(section=>{if(Array.isArray(section))add(out,section);else if(section&&typeof section==="object"){add(out,section.items);add(out,section.results);add(out,section.slots);}});
    });
  }
  return out;
}
function roots(rel){return [path.join(process.cwd(),rel),path.join(__dirname,"..","..",rel),path.join(__dirname,rel.replace(/^netlify\/functions\//,""))];}
function siteOrigin(){
  const raw=text(process.env.URL||process.env.DEPLOY_PRIME_URL||"https://igdcglobal.com").replace(/\/+$/g,"");
  try{const u=new URL(raw);return u.protocol==="https:"?u.origin:"https://igdcglobal.com";}catch(_e){return "https://igdcglobal.com";}
}
function rows(){
  const seenFiles=new Set(),seenIds=new Map();
  for(const rel of SNAPSHOTS)for(const file of roots(rel)){
    if(seenFiles.has(file))continue;seenFiles.add(file);
    for(const item of collect(read(file))){
      const id=idOf(item); if(!id||!isPublished(item))continue;
      const updated=text(item.updatedAt||item.updated_at||item.canonicalPublication&&item.canonicalPublication.publishedAt||item.canonicalPublication&&item.canonicalPublication.generatedAt);
      const current=seenIds.get(id); if(!current||updated>current.updated)seenIds.set(id,{id,updated});
    }
  }
  return Array.from(seenIds.values()).sort((a,b)=>a.id.localeCompare(b.id));
}
function buildXml(origin,items){
  const lines=['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  items.forEach(row=>{lines.push('  <url>');lines.push('    <loc>'+esc(origin+'/content.html?id='+encodeURIComponent(row.id))+'</loc>');if(row.updated&&Number.isFinite(Date.parse(row.updated)))lines.push('    <lastmod>'+esc(new Date(row.updated).toISOString())+'</lastmod>');lines.push('  </url>');});
  lines.push('</urlset>'); return lines.join('\n')+'\n';
}
exports.handler=async()=>{
  const origin=siteOrigin(),items=rows(),xml=buildXml(origin,items),etag='"'+crypto.createHash('sha256').update(xml).digest('hex').slice(0,32)+'"';
  return {statusCode:200,headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public, max-age=3600, s-maxage=3600","etag":etag,"x-igdc-sitemap-items":String(items.length)},body:xml};
};
exports._test={collect,rows,buildXml,siteOrigin};
