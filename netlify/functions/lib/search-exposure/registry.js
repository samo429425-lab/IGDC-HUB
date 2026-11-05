"use strict";

/**
 * IGDC public search registry v3.
 *
 * Read-only downstream registry for public search exposure.
 * It NEVER publishes, approves, ranks, or fabricates commerce candidates.
 *
 * Global order inherits the existing IGDC commercial priority + ranking.
 * Country search surfaces are created only from fresh, validated market-sale
 * evidence already produced by the IGDC country/region supply pipeline.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ProfitabilityGate = require("../commerce-profitability-gate.v1");
const MarketSaleScope = require("../market-sale-scope.v1");

const ORIGIN = (process.env.URL || process.env.DEPLOY_PRIME_URL || "https://igdcglobal.com").replace(/\/+$/, "");
const VERSION = "igdc-public-search-registry-v3.0.0-country-aware";
const MARKET_EVIDENCE_MAX_AGE_DAYS = Math.max(1, Math.min(90, Number(process.env.SEARCH_MARKET_EVIDENCE_MAX_AGE_DAYS || 30)));

const COMMERCE_SNAPSHOTS = Object.freeze([
  "netlify/functions/data/search-exposure.public.json",
  "netlify/functions/data/search-bank.snapshot.json",
  "netlify/functions/search-bank.snapshot.json",
  "data/search-bank.snapshot.json",
  "netlify/functions/data/distribution.snapshot.json",
  "netlify/functions/data/networkhub-snapshot.json",
  "netlify/functions/data/tour-snapshot.json",
  "netlify/functions/data/front.snapshot.json"
]);
const MEDIA_SNAPSHOTS = Object.freeze([
  "netlify/functions/data/search-bank.snapshot.json",
  "netlify/functions/search-bank.snapshot.json",
  "data/search-bank.snapshot.json",
  "netlify/functions/data/media.snapshot.json"
]);

const HUB_TARGETS = Object.freeze([
  ["home", "IGDC Global Platform | MARU Platform", "/home", 100],
  ["distribution", "IGDC Global Distribution Hub", "/distributionhub", 98],
  ["network", "IGDC Global Network Hub", "/networkhub", 92],
  ["media", "IGDC Global Media Hub", "/mediahub", 92],
  ["tour", "IGDC Global Travel & Tour", "/tour", 90],
  ["donation", "IGDC Global Donation", "/donation", 75],
  ["maru-windows", "MARU Media Player for Windows", "/maru-download.html", 96],
  ["support", "IGDC Help & Download Center", "/support.html", 70],
  ["maru-android", "MARU Media Player for Android", "/maru-android.html", 96]
]);

function text(v){ return v == null ? "" : String(v).trim(); }
function low(v){ return text(v).toLowerCase(); }
function plain(v){ return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function array(v){ return Array.isArray(v) ? v : []; }
function num(v, fallback=0){ const n=Number(v); return Number.isFinite(n) ? n : fallback; }
function uniq(values){ return [...new Set((values||[]).map(text).filter(Boolean))]; }
function abs(p){ try { return new URL(p, ORIGIN).href; } catch(_e){ return ""; } }
function clean(v,max=420){ return text(v).replace(/<[^>]*>/g," ").replace(/\s+/g," ").slice(0,max).trim(); }
function validHttps(v){
  try {
    const u=new URL(text(v),ORIGIN);
    if(u.protocol!=="https:") return "";
    if(/^(?:example\.(?:com|org|net)|localhost)$/i.test(u.hostname)) return "";
    return u.href;
  } catch(_e){ return ""; }
}
function validImage(v){
  const u=validHttps(v);
  if(!u || /placeholder|sample|spacer|no[-_]?image|transparent|blank|dummy|default-product/i.test(u)) return "";
  return u;
}
function genericTitle(v){
  const s=low(v);
  return !s || /^(?:product|item|details?|상품|제품|상품명 확인 중)$/.test(s) || /(?:^|\s)(?:sample|dummy|placeholder|test)\s*\d*$/i.test(s);
}
function placeholder(x){
  if(!x || typeof x!=="object") return true;
  if(x.isSample===true || x.sample===true || x.placeholder===true || x.replaceableSlot===true || x.seedContent===true) return true;
  const title=text(x.title||x.name||x.productName);
  const image=text(x.image||x.thumb||x.thumbnail||x.imageUrl);
  return genericTitle(title) || /placeholder|sample-card|\/sample\//i.test(image);
}
function blocked(x){
  const status=low(x && (x.status||x.publicationStatus||x.reviewStatus));
  return !!(x && (x.deleted===true || x.public===false || x.isPrivate===true || x.blocked===true || x.blockedReason || ["blocked","hold","held","excluded","draft","pending","unplaced","rejected","deleted"].includes(status)));
}
function commercePublished(x){
  if(!x || typeof x!=="object" || placeholder(x) || blocked(x)) return false;
  const cp=plain(x.canonicalPublication);
  if(low(cp.status)!=="published") return false;
  const ccp=x.commerceCandidatePublication;
  if(!(ccp===true || (ccp && typeof ccp==="object"))) return false;
  if(x.frontSupplyAllowed===false || x.snapshotEligible===false || x.searchBankEligible===false) return false;
  return true;
}
function mediaPublished(x){
  if(!x || typeof x!=="object" || placeholder(x) || blocked(x)) return false;
  if(x.frontSupplyAllowed!==true || x.searchBankEligible===false || x.snapshotEligible===false) return false;
  const contract=plain(x.mediaReleaseContract), release=plain(x.releaseContract);
  const released=contract.eligible===true || release.eligible===true || release.approved===true || x.realContent===true;
  const verified=x.verified===true || x.officialSource===true || low(x.verificationStatus)==="approved_for_snapshot";
  return released && verified;
}
function idOf(x){ return text(x && (x.id||x.contentId||x.productId||x.itemId||x.uid||x.sku||x.slotId)); }
function updatedOf(x){
  return text(x && (x.updatedAt||x.updated_at||x.publishedAt||plain(x.canonicalPublication).publishedAt||plain(x.mediaReleaseContract).releasedAt||plain(x.releaseContract).releasedAt));
}
function rankingScoreOf(x){
  const ccp=plain(x&&x.commerceCandidatePublication), selection=plain(x&&x.candidateSelection), ranking=plain(x&&x.ranking), value=plain(x&&x.valueAssessment);
  return num(ccp.rankingScore, num(selection.rankingScore, num(ranking.finalScore, num(ranking.score, num(x&&x.rankingScore, num(value.portfolioPriorityScore, num(x&&x.priority,0)))))));
}
function commercialClassOf(x){
  const selection=plain(x&&x.candidateSelection), gate=plain(x&&x.profitabilityAssessment), ccp=plain(x&&x.commerceCandidatePublication), revenue=plain(ccp.revenue);
  return text(x&&x.commercialPriorityClass || selection.commercialPriorityClass || gate.commercialClass || revenue.commercialClass || "ORDINARY").toUpperCase();
}
function commercialPriorityOf(x){
  const explicit=num(x&&x.commercialPriority, NaN);
  if(Number.isFinite(explicit)) return explicit;
  const cls=commercialClassOf(x);
  return Number(ProfitabilityGate.PRIORITY[cls] || ProfitabilityGate.PRIORITY.ORDINARY || 40);
}
function pinnedOf(x){ return low(plain(x&&x.sectionRevenueOverride).mode)==="pin_top" || x&&x.manualPinned===true; }

function rootCandidates(rel){
  return uniq([
    path.join(process.cwd(),rel),
    path.join(__dirname,"..","..","..",rel.replace(/^netlify\/functions\//,"")),
    path.join(__dirname,"..","..",rel.replace(/^netlify\/functions\//,""))
  ]);
}
function readJson(rel){
  for(const file of rootCandidates(rel)){
    try { if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,"utf8")); } catch(_e){}
  }
  return null;
}
function collectObjects(doc, predicate){
  const out=[], seen=new WeakSet();
  function visit(v,depth){
    if(!v || typeof v!=="object" || depth>14 || seen.has(v)) return;
    seen.add(v);
    if(Array.isArray(v)){ for(const x of v) visit(x,depth+1); return; }
    if(predicate(v)){ out.push(v); return; }
    for(const [key,val] of Object.entries(v)){
      if(!val || typeof val!=="object") continue;
      if(depth<6 || Array.isArray(val) || ["pages","sections","slots","items","results","products","cards","content"].includes(key)) visit(val,depth+1);
    }
  }
  visit(doc,0);
  return out;
}
function sourceUrlOf(x){
  return validHttps(x.externalProductUrl||x.productPageUrl||x.productDetailUrl||x.detailUrl||x.productUrl||x.originalProductUrl||x.url||x.href);
}
function sellerOf(x){
  const src=plain(x.canonicalSource), supplier=plain(x.supplier), seller=plain(x.seller);
  return clean(src.name||seller.name||supplier.name||x.supplierName||x.sellerName,120);
}

let countryCatalogCache=null;
function countryCatalog(){
  if(countryCatalogCache) return countryCatalogCache;
  const doc=readJson("netlify/functions/data/country-region-registry.v1.json") || {};
  const map={};
  for(const row of array(doc.countries)){
    const code=MarketSaleScope.normalizeCountry(row&&row.code);
    if(!code) continue;
    map[code]={code,nameEn:clean(row.nameEn||code,80),nameKo:clean(row.nameKo||row.nameEn||code,80),enabled:row.enabled!==false,ipResolvable:row.ipResolvable!==false,regionGroup:text(row.regionGroup)};
  }
  countryCatalogCache=map;
  return map;
}
function marketName(country,lang="en"){
  const row=countryCatalog()[MarketSaleScope.normalizeCountry(country)]||{};
  return lang==="ko"?(row.nameKo||row.nameEn||country):(row.nameEn||row.nameKo||country);
}
function marketUrl(id,country){
  const cc=MarketSaleScope.normalizeCountry(country);
  return cc?abs(`/product/${encodeURIComponent(id)}/${cc}`):"";
}
function verifiedMarketsOf(x){
  const catalog=countryCatalog();
  const byCountry=new Map();
  for(const record of MarketSaleScope.recordsFor(x)){
    const cc=MarketSaleScope.normalizeCountry(record&&record.country);
    if(!cc || cc==="KP") continue;
    const catalogRow=catalog[cc];
    if(catalogRow && catalogRow.enabled===false) continue;
    const verdict=MarketSaleScope.validateMarketRecord(record,{maxVerificationAgeDays:MARKET_EVIDENCE_MAX_AGE_DAYS,requireFresh:true});
    if(!verdict.ok) continue;
    const normalized={
      country:cc,
      nameEn:marketName(cc,"en"),
      nameKo:marketName(cc,"ko"),
      regions:uniq(array(record.regions).map(v=>MarketSaleScope.normalizeRegion(v,cc)).filter(Boolean)),
      nationwide:record.nationwide===true,
      verifiedAt:text(record.verifiedAt),
      evidenceDigest:text(verdict.evidenceDigest||record.evidenceDigest)
    };
    const old=byCountry.get(cc);
    if(!old || Date.parse(normalized.verifiedAt)>Date.parse(old.verifiedAt||0)) byCountry.set(cc,normalized);
  }
  return [...byCountry.values()].sort((a,b)=>a.country.localeCompare(b.country));
}
function normalizeCommerceItem(x){
  if(!commercePublished(x)) return null;
  const id=idOf(x), title=clean(x.title||x.productName||x.name,180), sourceUrl=sourceUrlOf(x);
  if(!id || id.length>220 || !/^[\p{L}\p{N}_.:@-]+$/u.test(id) || !title || !sourceUrl) return null;
  const image=validImage(x.image||x.imageUrl||x.displayImage||x.thumb||x.thumbnail||x.thumbnailUrl);
  const brand=clean(x.brand||plain(x.product).brand||plain(x.detail).brand,100);
  const model=clean(x.model||x.modelName||plain(x.product).model,120);
  const category=clean(x.productCategory||x.category||x.section||x.psom_key||plain(x.placement).section,120);
  const description=clean(x.description||x.summary||x.subtitle||plain(x.detail).description,500);
  const priceRaw=Number(x.price), currency=text(x.currency).toUpperCase();
  const price=Number.isFinite(priceRaw)&&priceRaw>0&&/^[A-Z]{3}$/.test(currency)?priceRaw:null;
  const country=MarketSaleScope.normalizeCountry(x.country||plain(x.placement).country||plain(x.ipSlot).marketCountry||plain(x.marketScope).marketCountry);
  const region=MarketSaleScope.normalizeRegion(x.region||plain(x.placement).region||plain(x.marketScope).marketRegion,country);
  const seller=sellerOf(x), markets=verifiedMarketsOf(x);
  if(!markets.length) return null;
  return {
    kind:"commerce", id, title, description, image, brand, model, category, seller,
    country, region, markets, eligibleMarkets:markets.map(m=>m.country),
    price, currency:price===null?"":currency, sourceUrl,
    url:abs(`/product/${encodeURIComponent(id)}`),
    outboundUrl:abs(`/.netlify/functions/affiliate-outbound?id=${encodeURIComponent(id)}`),
    searchUrl:abs(`/search.html?q=${encodeURIComponent(title)}`),
    updatedAt:updatedOf(x),
    commercialClass:commercialClassOf(x),
    commercialPriority:commercialPriorityOf(x),
    rankingScore:rankingScoreOf(x),
    pinned:pinnedOf(x),
    keywords:uniq([title,brand,model,category,seller,country,region,...markets.map(m=>m.nameEn),...markets.map(m=>m.nameKo)]),
    fingerprint:text(plain(x.canonicalPublication).candidateFingerprint||plain(x.canonicalPublication).sourceDigest||plain(x.canonicalPublication).evidenceDigest)
  };
}
function normalizeMediaItem(x){
  if(!mediaPublished(x)) return null;
  const id=idOf(x), title=clean(x.title||x.name,180), sourceUrl=validHttps(x.videoUrl||x.video||x.embedUrl||x.url||x.link||x.canonicalUrl);
  if(!id || !/^[\p{L}\p{N}_.:@-]+$/u.test(id) || !title || !sourceUrl) return null;
  const image=validImage(x.image||x.thumb||x.thumbnail||plain(x.media).preview&&plain(x.media).preview.poster);
  const provider=clean(typeof x.provider==="object"?(x.provider.name||x.provider.platform):x.provider,100);
  const category=clean(x.category||x.section||x.psom_key||x.classifiedSection,100);
  return {kind:"media",id,title,description:clean(x.description||x.summary,500),image,provider,category,sourceUrl,url:abs(`/media-content/${encodeURIComponent(id)}`),updatedAt:updatedOf(x),rankingScore:num(x.rankingScore,num(x.priority,0)),commercialPriority:0,pinned:false,keywords:uniq([title,provider,category,"media","video"])};
}
function compareTargets(a,b){
  if(!!a.pinned!==!!b.pinned) return a.pinned?-1:1;
  return num(b.commercialPriority)-num(a.commercialPriority) || num(b.rankingScore)-num(a.rankingScore) || num(b.priority)-num(a.priority) || text(a.title).localeCompare(text(b.title));
}
function qualityTolerance(a,b){
  const max=Math.max(Math.abs(num(a&&a.rankingScore)),Math.abs(num(b&&b.rankingScore)));
  if(max<=1.5) return 0.05;
  if(max<=10) return 0.5;
  return 2;
}
function hasMarket(item,country){
  const cc=MarketSaleScope.normalizeCountry(country);
  return !!cc && array(item&&item.eligibleMarkets).includes(cc);
}
function compareForCountry(a,b,country){
  if(!!a.pinned!==!!b.pinned) return a.pinned?-1:1;
  const cp=num(b.commercialPriority)-num(a.commercialPriority);
  if(cp) return cp;
  const ra=num(a.rankingScore), rb=num(b.rankingScore), diff=rb-ra;
  if(Math.abs(diff)>qualityTolerance(a,b)) return diff;
  const ma=hasMarket(a,country), mb=hasMarket(b,country);
  if(ma!==mb) return ma?-1:1;
  return diff || num(b.priority)-num(a.priority) || text(a.title).localeCompare(text(b.title));
}
function mergeMarkets(a,b){
  const m=new Map();
  for(const x of [...array(a),...array(b)]) if(x&&x.country){ const old=m.get(x.country); if(!old || Date.parse(x.verifiedAt||0)>Date.parse(old.verifiedAt||0)) m.set(x.country,x); }
  return [...m.values()].sort((x,y)=>x.country.localeCompare(y.country));
}
function dedupe(items){
  const byId=new Map();
  for(const item of items){
    if(!item) continue;
    const key=`${item.kind}:${item.id}`;
    const existing=byId.get(key);
    if(item.kind==="commerce" && existing){
      const preferred=compareTargets(item,existing)<0?item:existing;
      const merged=Object.assign({},preferred);
      merged.markets=mergeMarkets(existing.markets,item.markets);
      merged.eligibleMarkets=merged.markets.map(m=>m.country);
      merged.keywords=uniq([...(existing.keywords||[]),...(item.keywords||[]),...merged.markets.map(m=>m.nameEn),...merged.markets.map(m=>m.nameKo)]);
      if(item.updatedAt && (!merged.updatedAt || item.updatedAt>merged.updatedAt)) merged.updatedAt=item.updatedAt;
      byId.set(key,merged);
    } else if(!existing || compareTargets(item,existing)<0 || (item.updatedAt&&item.updatedAt>existing.updatedAt)) byId.set(key,item);
  }
  const sourceSeen=new Set();
  return [...byId.values()].sort(compareTargets).filter(item=>{
    if(item.kind!=="commerce") return true;
    const k=low(item.sourceUrl);
    if(!k || sourceSeen.has(k)) return false;
    sourceSeen.add(k); return true;
  });
}
function commerceTargets(){
  const rows=[];
  for(const rel of COMMERCE_SNAPSHOTS){
    const doc=readJson(rel); if(!doc) continue;
    for(const x of collectObjects(doc,v=>!!(v.canonicalPublication||v.commerceCandidatePublication))) rows.push(normalizeCommerceItem(x));
  }
  return dedupe(rows).filter(Boolean).slice(0,45000);
}
function mediaTargets(){
  const rows=[];
  for(const rel of MEDIA_SNAPSHOTS){
    const doc=readJson(rel); if(!doc) continue;
    for(const x of collectObjects(doc,v=>v&&typeof v==="object"&&(v.mediaReleaseContract||v.releaseContract||v.realContent===true||v.frontSupplyAllowed===true))) rows.push(normalizeMediaItem(x));
  }
  return dedupe(rows).filter(Boolean).slice(0,10000);
}
function marketCommerceTargets(commerce){
  const out=[];
  for(const item of commerce){
    for(const market of array(item.markets)){
      out.push(Object.assign({},item,{
        kind:"commerce-market",
        parentKind:"commerce",
        marketCountry:market.country,
        marketNameEn:market.nameEn,
        marketNameKo:market.nameKo,
        marketRegions:market.regions,
        marketNationwide:market.nationwide,
        marketVerifiedAt:market.verifiedAt,
        marketEvidenceDigest:market.evidenceDigest,
        url:marketUrl(item.id,market.country),
        searchUrl:abs(`/search.html?q=${encodeURIComponent(item.title)}&country=${encodeURIComponent(market.country)}`),
        keywords:uniq([...(item.keywords||[]),market.country,market.nameEn,market.nameKo])
      }));
    }
  }
  return out.sort((a,b)=>a.marketCountry.localeCompare(b.marketCountry)||compareTargets(a,b));
}
function hubTargets(){
  return HUB_TARGETS.map(([id,title,route,priority])=>({kind:id.startsWith("maru-")?"software":"hub",id,title,url:abs(route),priority,commercialPriority:0,rankingScore:priority,updatedAt:"",keywords:uniq([title,"IGDC Global","IGDC Platform","MARU Platform"])}));
}
function buildRegistry(){
  const commerce=commerceTargets(), marketCommerce=marketCommerceTargets(commerce), media=mediaTargets(), hubs=hubTargets();
  const targets=[...commerce,...marketCommerce,...media,...hubs].sort(compareTargets);
  const hash=crypto.createHash("sha256").update(JSON.stringify(targets.map(x=>[x.kind,x.id,x.marketCountry||"",x.title,x.url,x.updatedAt,x.commercialPriority,x.rankingScore,x.fingerprint||"",x.marketEvidenceDigest||""]))).digest("hex");
  const countryCounts={};
  for(const t of marketCommerce) countryCounts[t.marketCountry]=(countryCounts[t.marketCountry]||0)+1;
  return {
    version:VERSION, generatedAt:new Date().toISOString(), hash, targets,
    counts:targets.reduce((m,x)=>(m[x.kind]=(m[x.kind]||0)+1,m),{}),
    countryCounts,
    commerceCount:commerce.length,
    marketCommerceCount:marketCommerce.length,
    mediaCount:media.length,
    hubCount:hubs.length
  };
}
function commerceForCountry(registry,country){
  const cc=MarketSaleScope.normalizeCountry(country);
  if(!cc) return [];
  return array(registry&&registry.targets).filter(t=>t.kind==="commerce"&&hasMarket(t,cc)).sort((a,b)=>compareForCountry(a,b,cc));
}
function selectChangedUrls(registry, options={}){
  const now=Number(options.now||Date.now()), hours=Math.max(1,Math.min(24*30,num(options.hours,96))), cutoff=now-hours*3600000;
  const urls=[];
  for(const t of array(registry&&registry.targets)){
    if(!/^https:\/\/igdcglobal\.com\//i.test(t.url)) continue;
    const ts=Date.parse(text(t.updatedAt||t.marketVerifiedAt));
    if(Number.isFinite(ts)&&ts>=cutoff) urls.push(t.url);
  }
  return uniq(urls);
}

module.exports={VERSION,ORIGIN,MARKET_EVIDENCE_MAX_AGE_DAYS,buildRegistry,commercePublished,mediaPublished,normalizeCommerceItem,normalizeMediaItem,compareTargets,compareForCountry,commerceForCountry,hasMarket,marketUrl,marketName,selectChangedUrls};
