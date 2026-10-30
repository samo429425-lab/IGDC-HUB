"use strict";
/**
 * IGDC Organic Public Catalog v2
 * Read-only, deploy-snapshot-based, public-only SEO renderer.
 * No unpublished candidate, SearchBank mutation, fabricated product, traffic simulation,
 * forced ranking or outbound crawling. Routes are served through this Netlify function.
 */
const crypto = require('crypto');
const BASE = 'https://igdcglobal.com';
const ENDPOINT = BASE + '/.netlify/functions/igdc-organic-catalog';

// Literal requires allow Netlify/esbuild to bundle ONLY these public snapshot assets
// for this function. This does not touch netlify.toml or the platform core.
function loadDocuments(){
  return [
    () => require('./data/distribution.snapshot.json'),
    () => require('./data/networkhub-snapshot.json'),
    () => require('./data/front.snapshot.json'),
    () => require('./data/tour-snapshot.json')
  ].map(f=>{try{return f()}catch(_){return null}}).filter(Boolean);
}
const t=x=>x==null?'':String(x).trim();
const html=x=>t(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const xml=x=>html(x).replace(/&#39;/g,'&apos;');
function httpsUrl(v){try{let u=new URL(t(v),BASE);if(u.protocol!=='https:')return null;if(['example.com','example.org','example.net','localhost'].includes(u.hostname.toLowerCase()))return null;return u;}catch(_){return null}}
function validImage(v){
  const u=httpsUrl(v);if(!u)return null;
  if(/(?:placeholder|sample|spacer|no[-_]?image|transparent|blank|dummy|default-product)/i.test(u.pathname))return null;
  if(u.href.startsWith('data:'))return null;
  return u.href;
}
function clean(v,max=240){return t(v).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,max).trim()}
function published(x){
  if(!x||typeof x!=='object')return false;
  const a=x.canonicalPublication,b=x.commerceCandidatePublication;
  const status=t(a&&a.status||b&&typeof b==='object'&&b.status).toLowerCase();
  const publicState=t(x.publicationStatus||x.status||'').toLowerCase();
  if(x.public===false||x.isPrivate===true||x.deleted===true||['blocked','hold','held','excluded','draft','pending','unplaced','rejected','deleted'].includes(publicState))return false;
  return status==='published' || (b===true&&publicState==='published');
}
function product(x){
  if(!published(x))return null;
  const id=t(x.id||x.contentId||x.productId||x.itemId||x.uid);
  const title=clean(x.title||x.productName||x.name,180);
  if(!id||id.length>200||!/^[\p{L}\p{N}_.:@-]+$/u.test(id)||!title||/(?:^|\s)(?:product|item|sample|dummy|placeholder|test)\s*\d+/i.test(title)||/^(?:상품|제품|상품명 확인 중|product|item|details?)$/i.test(title))return null;
  const url=httpsUrl(x.productDetailUrl||x.detailUrl||x.originalProductUrl||x.url||x.href);
  const image=validImage(x.image||x.thumb||x.thumbnail||x.imageUrl);
  // A public item needs a real, resolvable seller detail destination and image.
  if(!url||!image||url.pathname==='/'||url.hash==='#')return null;
  if(/\/(?:search|category|categories|collections|campaign|events?|list|browse)\/?$/i.test(url.pathname))return null;
  const updated=clean(x.updatedAt||x.updated_at||(x.canonicalPublication&&x.canonicalPublication.publishedAt)||'',80);
  const desc=clean(x.description||x.summary||x.subtitle||'',360);
  const price=Number(x.price);
  const currency=t(x.currency).toUpperCase();
  return {id,title,url:url.href,image,updated:/^\d{4}-\d\d-\d\d/.test(updated)&&Number.isFinite(Date.parse(updated))?new Date(updated).toISOString().slice(0,10):'',description:desc,price:Number.isFinite(price)&&price>0&&/^[A-Z]{3}$/.test(currency)?price:null,currency};
}
function collect(doc){
  const out=[], visited=new WeakSet();
  function visit(v,d){
    if(!v||typeof v!=='object'||d>13||visited.has(v))return;
    visited.add(v);
    if(Array.isArray(v)){for(const x of v)visit(x,d+1);return}
    if(v.canonicalPublication||v.commerceCandidatePublication){const p=product(v);if(p)out.push(p);return}
    // recurse through structural collection fields only; avoid private ledgers
    for(const key of ['pages','sections','items','slots','results','products','cards','content'])if(v[key]&&typeof v[key]==='object')visit(v[key],d+1);
    // page/section IDs are arbitrary; nested maps need enumeration
    if(d<=8)for(const [key,val] of Object.entries(v)){
      if(['pages','sections','items','slots','results','products','cards','content'].includes(key))continue;
      if(val&&typeof val==='object' && (d<4||Array.isArray(val)))visit(val,d+1);
    }
  }
  visit(doc,0);return out;
}
function allProducts(docs=loadDocuments()){
  const map=new Map(),urls=new Set();
  for(const doc of docs)for(const p of collect(doc)){
    const existing=map.get(p.id);
    if(!existing||(p.updated&&p.updated>existing.updated))map.set(p.id,p);
  }
  return [...map.values()].sort((a,b)=>a.title.localeCompare(b.title)).filter(p=>{
    if(urls.has(p.url))return false;urls.add(p.url);return true;
  }).slice(0,45000);
}
function productHref(id){return ENDPOINT+'?mode=product&id='+encodeURIComponent(id)}
function page(title,desc,canonical,body,ld){
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+html(title)+'</title><meta name="description" content="'+html(desc)+'"><meta name="robots" content="index,follow,max-image-preview:large">'+
    '<link rel="canonical" href="'+html(canonical)+'"><meta property="og:type" content="website"><meta property="og:title" content="'+html(title)+'"><meta property="og:description" content="'+html(desc)+'">'+
    (ld?'<script type="application/ld+json">'+JSON.stringify(ld).replace(/</g,'\\u003c')+'</script>':'')+
    '<style>body{font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif;line-height:1.7;color:#172c40;background:#f5f8fb;margin:0}main{max-width:850px;margin:24px auto;padding:24px;background:white;border-radius:12px}img{max-width:100%;max-height:370px;object-fit:contain}a{color:#14569c}li{margin:8px 0}small{color:#516273}</style></head><body><main>'+body+'</main></body></html>';
}
function renderProduct(p){
  const canonical=productHref(p.id);
  const desc=p.description||p.title+' — IGDC에서 공개된 상품 정보와 판매처 상세페이지를 확인하세요.';
  const ld={'@context':'https://schema.org','@type':'Product','name':p.title,'image':[p.image],'description':desc,'url':canonical};
  if(p.price!==null)ld.offers={'@type':'Offer','price':String(p.price),'priceCurrency':p.currency,'url':p.url};
  return page(p.title+' | IGDC 상품 정보',desc,canonical,
    '<p><a href="https://igdcglobal.com/distributionhub.html">IGDC 유통 허브</a></p><h1>'+html(p.title)+'</h1>'+ 
    '<p><img src="'+html(p.image)+'" alt="'+html(p.title)+'" loading="lazy"></p>'+ 
    (p.description?'<p>'+html(p.description)+'</p>':'')+(p.price!==null?'<p>'+html(p.price+' '+p.currency)+'</p>':'')+
    '<p><a href="'+html(p.url)+'" rel="noopener noreferrer nofollow sponsored">실제 상품 상세정보 확인</a></p><small>외부 판매처에서 가격·재고·구매 조건을 확인하세요.</small>',ld);
}
function sitemap(products){
 const lines=['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
 for(const p of products){lines.push('<url><loc>'+xml(productHref(p.id))+'</loc>'+(p.updated?'<lastmod>'+p.updated+'</lastmod>':'')+'</url>')}
 lines.push('</urlset>');return lines.join('\n')+'\n';
}
function response(code,body,type,opts={}){
 const headers={'content-type':type,'cache-control':opts.cache||'public, max-age=300, s-maxage=3600','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'};
 if(opts.noindex)headers['x-robots-tag']='noindex, nofollow';
 if(type.startsWith('text/html'))headers['content-security-policy']="default-src 'none'; img-src https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
 return {statusCode:code,headers,body};
}
async function handler(event){
 if(event.httpMethod&&event.httpMethod!=='GET'&&event.httpMethod!=='HEAD')return response(405,'GET only','text/plain; charset=utf-8',{noindex:true});
 const q=event.queryStringParameters||{},mode=t(q.mode||'health').toLowerCase();
 const products=allProducts();
 if(mode==='sitemap')return response(200,sitemap(products),'application/xml; charset=utf-8',{noindex:products.length===0});
 if(mode==='health')return response(200,JSON.stringify({ok:true,source:'public-deploy-snapshots',publishedProducts:products.length,updateModel:'on-deploy',crawlable:products.length>0}), 'application/json; charset=utf-8',{noindex:true});
 if(mode==='product'){
   const id=t(q.id);const p=products.find(x=>x.id===id);
   if(!p)return response(404,'Product not published','text/plain; charset=utf-8',{noindex:true});
   return response(200,renderProduct(p),'text/html; charset=utf-8');
 }
 if(mode==='listing'){
   if(!products.length)return response(200,'<html><head><meta name="robots" content="noindex"></head><body><p>No public products yet.</p></body></html>','text/html; charset=utf-8',{noindex:true});
   const items=products.slice(0,400).map(x=>'<li><a href="'+html(productHref(x.id))+'">'+html(x.title)+'</a></li>').join('');
   return response(200,page('IGDC 공개 상품 | 유통 플랫폼','IGDC가 실제 공개한 상품 상세정보 목록',ENDPOINT+'?mode=listing','<h1>IGDC 공개 상품</h1><p>실제 공개된 상품의 상세 정보로 연결됩니다.</p><ul>'+items+'</ul>'),'text/html; charset=utf-8');
 }
 return response(404,'Unknown mode','text/plain; charset=utf-8',{noindex:true});
}
exports.handler=handler;
exports._test={product,published,collect,allProducts,productHref,sitemap,renderProduct,loadDocuments};
