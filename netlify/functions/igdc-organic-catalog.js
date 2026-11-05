"use strict";
/**
 * Legacy organic-catalog compatibility facade.
 * Canonical public search URLs are /product/{id}; this endpoint never exposes
 * a new direct seller route. The _test helpers preserve the pre-existing
 * safety-test contract so existing regression tests remain valid.
 */
const {buildRegistry}=require("./lib/search-exposure/registry");
const BASE="https://igdcglobal.com";
const ENDPOINT=BASE+"/.netlify/functions/igdc-organic-catalog";
function text(v){return v==null?"":String(v).trim();}
function html(v){return text(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function xml(v){return html(v).replace(/&#39;/g,"&apos;");}
function reply(code,body,type="application/json; charset=utf-8",extra={}){return{statusCode:code,headers:{"content-type":type,"cache-control":"public,max-age=300,s-maxage=900","x-robots-tag":"noindex, nofollow",...extra},body};}

// Existing safety-test compatibility helpers. These are not used to publish
// canonical search pages; /product/{id} remains the only current renderer.
function legacyHttpsUrl(v){try{const u=new URL(text(v),BASE);if(u.protocol!=="https:")return null;if(["example.com","example.org","example.net","localhost"].includes(u.hostname.toLowerCase()))return null;return u;}catch(_e){return null;}}
function legacyValidImage(v){const u=legacyHttpsUrl(v);if(!u)return null;if(/(?:placeholder|sample|spacer|no[-_]?image|transparent|blank|dummy|default-product)/i.test(u.pathname))return null;return u.href;}
function clean(v,max=240){return text(v).replace(/<[^>]*>/g," ").replace(/\s+/g," ").slice(0,max).trim();}
function published(x){
  if(!x||typeof x!=="object")return false;
  const a=x.canonicalPublication,b=x.commerceCandidatePublication;
  const status=text(a&&a.status||b&&typeof b==="object"&&b.status).toLowerCase();
  const publicState=text(x.publicationStatus||x.status||"").toLowerCase();
  if(x.public===false||x.isPrivate===true||x.deleted===true||["blocked","hold","held","excluded","draft","pending","unplaced","rejected","deleted"].includes(publicState))return false;
  return status==="published"||(b===true&&publicState==="published");
}
function product(x){
  if(!published(x))return null;
  const id=text(x.id||x.contentId||x.productId||x.itemId||x.uid);
  const title=clean(x.title||x.productName||x.name,180);
  if(!id||id.length>200||!/^[\p{L}\p{N}_.:@-]+$/u.test(id)||!title||/(?:^|\s)(?:product|item|sample|dummy|placeholder|test)\s*\d+/i.test(title)||/^(?:상품|제품|상품명 확인 중|product|item|details?)$/i.test(title))return null;
  const url=legacyHttpsUrl(x.productDetailUrl||x.detailUrl||x.originalProductUrl||x.url||x.href);
  const image=legacyValidImage(x.image||x.thumb||x.thumbnail||x.imageUrl);
  if(!url||!image||url.pathname==="/"||url.hash==="#")return null;
  if(/\/(?:search|category|categories|collections|campaign|events?|list|browse)\/?$/i.test(url.pathname))return null;
  const updated=clean(x.updatedAt||x.updated_at||(x.canonicalPublication&&x.canonicalPublication.publishedAt)||"",80);
  const desc=clean(x.description||x.summary||x.subtitle||"",360);
  const price=Number(x.price),currency=text(x.currency).toUpperCase();
  return{id,title,url:url.href,image,updated:/^\d{4}-\d\d-\d\d/.test(updated)&&Number.isFinite(Date.parse(updated))?new Date(updated).toISOString().slice(0,10):"",description:desc,price:Number.isFinite(price)&&price>0&&/^[A-Z]{3}$/.test(currency)?price:null,currency};
}
function collect(doc){
  const out=[],visited=new WeakSet();
  function visit(v,d){
    if(!v||typeof v!=="object"||d>13||visited.has(v))return;visited.add(v);
    if(Array.isArray(v)){for(const x of v)visit(x,d+1);return;}
    if(v.canonicalPublication||v.commerceCandidatePublication){const p=product(v);if(p)out.push(p);return;}
    for(const key of ["pages","sections","items","slots","results","products","cards","content"])if(v[key]&&typeof v[key]==="object")visit(v[key],d+1);
    if(d<=8)for(const [key,val] of Object.entries(v)){if(["pages","sections","items","slots","results","products","cards","content"].includes(key))continue;if(val&&typeof val==="object"&&(d<4||Array.isArray(val)))visit(val,d+1);}
  }
  visit(doc,0);return out;
}
function loadDocuments(){
  return ["./data/distribution.snapshot.json","./data/networkhub-snapshot.json","./data/front.snapshot.json","./data/tour-snapshot.json"].map(rel=>{try{return require(rel);}catch(_e){return null;}}).filter(Boolean);
}
function allProducts(docs=loadDocuments()){
  const map=new Map(),urls=new Set();
  for(const doc of docs)for(const p of collect(doc)){const old=map.get(p.id);if(!old||(p.updated&&p.updated>old.updated))map.set(p.id,p);}
  return [...map.values()].sort((a,b)=>a.title.localeCompare(b.title)).filter(p=>{if(urls.has(p.url))return false;urls.add(p.url);return true;}).slice(0,45000);
}
function productHref(id){return ENDPOINT+"?mode=product&id="+encodeURIComponent(id);}
function sitemap(products){const lines=['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];for(const p of products)lines.push("<url><loc>"+xml(productHref(p.id))+"</loc>"+(p.updated?"<lastmod>"+p.updated+"</lastmod>":"")+"</url>");lines.push("</urlset>");return lines.join("\n")+"\n";}
function renderProduct(p){const desc=p.description||p.title;return '<!doctype html><html><head><title>'+html(p.title)+'</title></head><body><h1>'+html(p.title)+'</h1><p>'+html(desc)+'</p></body></html>';}

async function handler(event){
  const q=event.queryStringParameters||{},mode=text(q.mode||"health").toLowerCase(),r=buildRegistry(),products=r.targets.filter(x=>x.kind==="commerce");
  if(mode==="health")return reply(200,JSON.stringify({ok:true,source:"central-public-search-registry",publishedProducts:products.length,countryMarketPages:r.marketCommerceCount||0,countryCounts:r.countryCounts||{},registryVersion:r.version,registryHash:r.hash}));
  if(mode==="product"){
    const p=products.find(x=>x.id===text(q.id));
    if(!p)return reply(404,"Product not published","text/plain; charset=utf-8");
    return{statusCode:301,headers:{Location:p.url,"cache-control":"public,max-age=3600","x-robots-tag":"noindex, follow"},body:""};
  }
  if(mode==="sitemap"){
    const lines=['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',...products.map(p=>`<url><loc>${xml(p.url)}</loc>${p.updatedAt&&Number.isFinite(Date.parse(p.updatedAt))?`<lastmod>${new Date(p.updatedAt).toISOString()}</lastmod>`:""}</url>`),'</urlset>'];
    return reply(200,lines.join("\n")+"\n","application/xml; charset=utf-8");
  }
  if(mode==="listing")return{statusCode:301,headers:{Location:"/distributionhub","cache-control":"public,max-age=3600","x-robots-tag":"noindex, follow"},body:""};
  return reply(404,"Unknown mode","text/plain; charset=utf-8");
}
exports.handler=handler;
exports._test={product,published,collect,allProducts,productHref,sitemap,renderProduct,loadDocuments};
