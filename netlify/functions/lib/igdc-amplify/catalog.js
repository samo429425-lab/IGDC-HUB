"use strict";
/**
 * IGDC independent read-only organic discovery adapter.
 * It reads ONLY the canonical front-publication search projection already
 * produced by the ORIGINAL IGDC build. No PSOM, ranking, front or ledger writes.
 * All outward routes stay on igdcglobal.com until a user chooses a seller.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Market = require("../market-sale-scope.v1");
const ORIGIN = "https://igdcglobal.com";
const VERSION = "igdc-independent-amplify-v3.5-safe-1";
const MAX_ITEMS = Math.min(80000, Math.max(1000, Number(process.env.IGDC_AMPLIFY_MAX_ITEMS) || 45000));
const MAX_AGE_DAYS = Math.min(90, Math.max(1, Number(process.env.SEARCH_MARKET_EVIDENCE_MAX_AGE_DAYS) || 30));
const CACHE_MS = 10000;
const SOURCE = "search-exposure.public.json";
let memo = null;

function text(v) { return v == null ? "" : String(v).trim(); }
function clean(v, max=300) { return text(v).replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0,max).trim(); }
function plain(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function uniq(v) { return [...new Set(v.map(x=>clean(x,180)).filter(Boolean))]; }
function validId(v){ const s=text(v);return /^[\p{L}\p{N}_.:@-]{1,200}$/u.test(s) ? s : ""; }
function safeHttps(v) {
  try {
    const url=new URL(text(v));
    if(url.protocol!=="https:" || url.username || url.password || !url.hostname ||
       /^(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(?:com|org|net))$/i.test(url.hostname) ||
       url.hostname.endsWith(".local"))return "";
    url.hash="";
    return url.toString();
  } catch(_e){return "";}
}
function sourceOf(x) {
  const options=[x.externalProductUrl,x.officialProductUrl,x.productPageUrl,x.productUrl,x.product_url,x.productLink,
    x.detailUrl,x.sourceUrl,x.source_url,x.targetUrl,x.target_url,x.displayUrl,x.link,x.href,x.url,
    plain(x.canonicalSource).url,plain(x.canonicalSource).productUrl];
  for(const value of options){
    const url=safeHttps(value);if(!url)continue;
    const h=new URL(url).hostname.toLowerCase();
    if(h!=="igdcglobal.com"&&!h.endsWith(".igdcglobal.com"))return url;
  }
  return "";
}
function verifiedMarkets(x) {
  const out=[];const seen=new Set();
  for(const record of Market.recordsFor(x)) {
    const c=Market.normalizeCountry(record&&record.country);
    if(!c||c==="KP"||seen.has(c))continue;
    const result=Market.validateMarketRecord(record,{requireFresh:true,maxVerificationAgeDays:MAX_AGE_DAYS});
    if(!result.ok)continue;
    seen.add(c);out.push(c);
  }
  return out.sort();
}
function isPublic(x) {
  const c=plain(x.canonicalPublication);
  const status= text(x.status || x.publicationStatus || x.reviewStatus).toLowerCase();
  return c.status==="published" && !!text(c.candidateId) && !!x.commerceCandidatePublication &&
    x.public!==false && x.isPrivate!==true && x.isVisible!==false && x.frontMatched!==false &&
    x.deleted!==true && x.isSample!==true && x.sample!==true && x.placeholder!==true &&
    x.frontSupplyAllowed!==false && !x.blockedReason &&
    !["hold","held","pending","draft","unplaced","excluded","blocked","deleted","rejected"].includes(status);
}
function normalize(x){
  if(!x || typeof x!=="object" || !isPublic(x))return null;
  const id=validId(x.id||x.contentId||x.productId||x.uid||x.sku);
  const title=clean(x.title||x.name||x.productName||x.itemName,180);
  const productName=clean(x.productName||x.itemName||x.displayName||x.name||title,180);
  if(!id||!title||!productName|| /^(?:item|product|sample|dummy|placeholder|상품명 확인 중)$/i.test(productName))return null;
  const source=sourceOf(x), markets=verifiedMarkets(x);
  if(!source||!markets.length)return null;
  const brand=clean(x.brand,110),maker=clean(x.manufacturerName||x.manufacturer,110);
  const seller=clean(plain(x.seller).name||plain(x.supplier).name||plain(x.canonicalSource).name||x.sellerName||x.supplierName,120);
  const model=clean(x.modelName||x.model,110),category=clean(x.productCategory||x.category||x.section||x.psom_key,110);
  const description=clean(x.description||x.summary||x.subtitle,440);
  const names=uniq([productName,title,x.itemName,x.displayName,x.name,x.productName,model]);
  const image=safeHttps(x.image||x.imageUrl||x.displayImage||x.thumb||x.thumbnail||x.thumbnailUrl);
  const country=Market.normalizeCountry(x.country)||markets[0];
  let updatedAt="";
  const ts=text(x.updatedAt||x.updated_at||x.publishedAt||plain(x.canonicalPublication).publishedAt);
  if(Number.isFinite(Date.parse(ts)) && Date.parse(ts) <= Date.now()+300000)updatedAt=new Date(ts).toISOString();
  const priceRaw=Number(x.price), currency=text(x.currency).toUpperCase();
  const price=Number.isFinite(priceRaw)&&priceRaw>0&&/^[A-Z]{3}$/.test(currency)?priceRaw:null;
  const priority=Number.isFinite(Number(x.commercialPriority))?Number(x.commercialPriority):0;
  const score=Number.isFinite(Number(x.rankingScore))?Number(x.rankingScore):0;
  return {id,title,productName,names,brand,maker,seller,model,category,description,image,markets,country,price,currency:price===null?"":currency,
    updatedAt,priority,score,sourcePresent:!!source,
    url:productUrl(id),outbound:`${ORIGIN}/.netlify/functions/affiliate-outbound?id=${encodeURIComponent(id)}`};
}
function productUrl(id,market=""){
  const c=Market.normalizeCountry(market);
  const suffix=c?`&market=${encodeURIComponent(c)}`:"";
  return `${ORIGIN}/.netlify/functions/igdc-amplify-product?id=${encodeURIComponent(id)}${suffix}`;
}
function projectionPaths(){return [path.resolve(__dirname,"../../data",SOURCE),path.resolve(process.cwd(),"netlify/functions/data",SOURCE)];}
function manifestPaths(){return [path.resolve(__dirname,"../../../../data/auto/ip-slot-manifest.json"),path.resolve(process.cwd(),"data/auto/ip-slot-manifest.json")];}
function readJson(file){try{if(fs.statSync(file).isFile())return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_e){}return null;}
function sourceStatus(){
  const doc=projectionPaths().map(readJson).find(Boolean);
  if(!doc||doc.schema!=="igdc-search-exposure-public-v1" || doc.source!=="canonical-ip-slot-release" ||
     !text(doc.canonicalReleaseId) || !Number.isSafeInteger(doc.verifiedSnapshotCount) || doc.verifiedSnapshotCount<1 ||
     !Array.isArray(doc.items) || doc.itemCount!==doc.items.length){
    return {ready:false,reason:"NO_VERIFIED_PUBLIC_FRONT_RELEASE",items:[],releaseId:"",released:0};
  }
  const manifest=manifestPaths().map(readJson).find(Boolean);
  if(manifest&&(manifest.schema!=="canonical-ip-slot-release-manifest-v1" ||
     manifest.canonicalReleaseId!==doc.canonicalReleaseId ||
     (manifest.ipSlotPolicyDigest||null)!==(doc.ipSlotPolicyDigest||null))) {
    return {ready:false,reason:"PUBLIC_RELEASE_MANIFEST_MISMATCH",items:[],releaseId:"",released:0};
  }
  return {ready:true,reason:"VERIFIED_FRONT_RELEASE",items:doc.items,releaseId:text(doc.canonicalReleaseId),released:doc.items.length};
}
function buildCatalog(){
  if(memo&&Date.now()<memo.until)return memo.value;
  const source=sourceStatus(),map=new Map();let skipped=0, eligible=0;
  if(source.ready){
    for(const x of source.items){
      const t=normalize(x); if(!t){skipped++;continue;}eligible++;
      if(map.size>=MAX_ITEMS && !map.has(t.id))continue;
      if(!map.has(t.id))map.set(t.id,t);
    }
  }
  const items=[...map.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const hash=crypto.createHash("sha256").update(JSON.stringify([source.releaseId,items.map(t=>[t.id,t.title,t.updatedAt,t.markets])])).digest("hex");
  const value={version:VERSION,ready:source.ready,reason:source.reason,releaseId:source.releaseId,hash,items,
    counts:{released:source.released,qualified:eligible,indexed:items.length,skipped,overflow:Math.max(0,eligible-items.length)},
    getById(id){return map.get(id)||null;}};
  memo={value,until:Date.now()+CACHE_MS};return value;
}
function norm(v){return clean(v,220).normalize("NFKC").toLocaleLowerCase();}
function compact(v){return norm(v).replace(/[^\p{L}\p{N}]+/gu,"");}
function relevance(t,input){
  const q=norm(input);if(!q)return 1;
  const parts=q.split(/[\s,;|/]+/).filter(Boolean).slice(0,12);
  const names=t.names.map(norm), fields=[...names,norm(t.brand),norm(t.maker),norm(t.model),norm(t.seller),norm(t.category),norm(t.description)];
  const termMatches=(field,word)=>field.includes(word)||(compact(word).length>=2&&compact(field).includes(compact(word)));
  if(!parts.every(part=>fields.some(field=>termMatches(field,part))))return 0;
  let score=0;const cq=compact(q);
  for(const name of names){if(name===q)score=Math.max(score,1000);else if(cq.length>=2&&compact(name)===cq)score=Math.max(score,800);
    else if(name.startsWith(q))score=Math.max(score,420);else if(name.includes(q))score=Math.max(score,300);
    else if(cq.length>=2&&compact(name).includes(cq))score=Math.max(score,200);}
  for(const part of parts){if(names.some(n=>termMatches(n,part)))score+=40;
    if(termMatches(norm(t.model),part))score+=30;
    if(termMatches(norm(t.brand),part)||termMatches(norm(t.maker),part))score+=12;
    if(termMatches(norm(t.seller),part)||termMatches(norm(t.category),part))score+=5;}
  return score||1;
}
function findProducts(catalog,query,country="",limit=20,offset=0){
  const cc=Market.normalizeCountry(country),found=[];
  for(const item of catalog.items){if(cc&&!item.markets.includes(cc))continue;
    const s=relevance(item,query);if(s>0)found.push({item,score:s});}
  found.sort((a,b)=>b.score-a.score||b.item.priority-a.item.priority||b.item.score-a.item.score||a.item.id.localeCompare(b.item.id));
  return {total:found.length,items:found.slice(offset,offset+limit).map(x=>x.item)};
}
module.exports={ORIGIN,VERSION,buildCatalog,productUrl,findProducts,relevance,sourceStatus,normalize,validId,clean,norm,compact,Market};
