"use strict";

/**
 * Build-time bridge: canonical country/IP front snapshots -> compact public
 * search registry bundled with Netlify Functions.
 *
 * Runs AFTER build-regional-brokerage-snapshots.js. It never publishes or
 * re-ranks products. It only copies already-published public cards from the
 * exact-hash canonical release artifacts into a compact read-only registry.
 */
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {execFileSync}=require("child_process");
const MarketSaleScope=require("../netlify/functions/lib/market-sale-scope.v1");

const root=path.resolve(__dirname,"..");
const manifestPath=path.join(root,"data","auto","ip-slot-manifest.json");
const outputPath=path.join(root,"netlify","functions","data","search-exposure.public.json");
const ALLOWED_PAGES=new Set(["home","distribution","network","tour"]);
const ALLOWED_FILES=new Set(["front.snapshot.json","distribution.snapshot.json","networkhub-snapshot.json","tour-snapshot.json"]);
const VERSION="search-exposure-public-registry-build-v1.1.0-market-gated";
const MARKET_EVIDENCE_MAX_AGE_DAYS=Math.max(1,Math.min(90,Number(process.env.SEARCH_MARKET_EVIDENCE_MAX_AGE_DAYS||30)));

function text(v){return v==null?"":String(v).trim();}
function plain(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function clone(v){return JSON.parse(JSON.stringify(v==null?null:v));}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_e){return null;}}
function sha256Bytes(buf){return crypto.createHash("sha256").update(buf).digest("hex");}
function safeLocalPath(publicPath){
  const rel=text(publicPath).replace(/^\/+/,"");
  if(!rel.startsWith("data/auto/")||rel.includes(".."))return "";
  const file=path.resolve(root,rel);
  const auto=path.resolve(root,"data","auto")+path.sep;
  return file.startsWith(auto)?file:"";
}
function cardRows(doc,page){
  const out=[];
  const add=v=>{if(v&&typeof v==="object")out.push(v);};
  const addSections=sections=>{for(const value of Object.values(sections||{})){if(Array.isArray(value))value.forEach(add);else if(value&&Array.isArray(value.slots))value.slots.forEach(add);}};
  if(page==="home")addSections(doc&&doc.pages&&doc.pages.home&&doc.pages.home.sections);
  else if(page==="distribution")addSections(doc&&doc.pages&&doc.pages.distribution&&doc.pages.distribution.sections);
  else {for(const v of Array.isArray(doc&&doc.items)?doc.items:[])add(v);for(const v of Array.isArray(doc&&doc.slots)?doc.slots:[])add(v);}
  return out;
}
function safeId(card){
  const publication=plain(card&&card.canonicalPublication);
  const raw=text(card&&card.id||card&&card.contentId||card&&card.productId||publication.candidateId);
  return /^[\p{L}\p{N}_.:@-]{1,220}$/u.test(raw)?raw:"";
}
function published(card,country){
  if(!card||typeof card!=="object"||card.sample===true||card.isSample===true||card.placeholder===true)return false;
  const publication=plain(card.canonicalPublication);
  if(text(publication.status).toLowerCase()!=="published"||!publication.candidateId)return false;
  if(!(card.commerceCandidatePublication===true||(card.commerceCandidatePublication&&typeof card.commerceCandidatePublication==="object")))return false;
  const url=text(card.externalProductUrl||card.officialProductUrl||card.productUrl||card.productPageUrl||card.detailUrl||card.url||card.link||card.affiliateOutboundUrl||card.externalOutboundUrl);
  if(!url||url==="#"||/example\.(?:com|org|net)/i.test(url))return false;
  const scope=plain(card.marketScope), record=plain(scope.marketEvidence);
  const cc=MarketSaleScope.normalizeCountry(country);
  if(!cc||MarketSaleScope.normalizeCountry(scope.marketCountry)!==cc||MarketSaleScope.normalizeCountry(record.country)!==cc)return false;
  const verdict=MarketSaleScope.validateMarketRecord(record,{maxVerificationAgeDays:MARKET_EVIDENCE_MAX_AGE_DAYS,requireFresh:true});
  if(!verdict.ok)return false;
  if(scope.marketEvidenceDigest&&text(scope.marketEvidenceDigest)!==text(verdict.evidenceDigest))return false;
  return !!safeId(card);
}
function pick(card){
  const keys=[
    "id","contentId","productId","uid","sku","title","name","productName","summary","description","subtitle",
    "brand","model","modelName","category","productCategory","section","psom_key","image","imageUrl","imageOriginalUrl","thumb","thumbnail","thumbnailUrl",
    "price","currency","priority","score","qualityScore","rankingScore","commercialPriority","commercialPriorityClass","managedPriority","manualPinned",
    "externalProductUrl","officialProductUrl","productUrl","product_url","productPageUrl","detailUrl","checkoutUrl","purchaseUrl","orderUrl","productLink","displayUrl",
    "sourceUrl","source_url","targetUrl","target_url","url","href","link","affiliateOutboundUrl","externalOutboundUrl","outboundUrl",
    "canonicalPublication","commerceCandidatePublication","candidateSelection","ranking","valueAssessment","profitabilityAssessment","sectionRevenueOverride",
    "placement","ipSlot","marketScope","countrySupply","marketAvailability","availabilityCountries","availabilityRegions","nationalAvailability","targetCountry","targetRegion","distributionMarketCountry","distributionMarketRegion","sellerMarketCountry",
    "affiliate","extension","linkRevenue","outboundReferral","commerceCandidate","outboundRoute","sellerResponsibility","seller","supplier","supplierName","sellerName","canonicalSource","searchBankContract","sanmaruSearchBankContract","searchBankUnifiedContract"
  ];
  const out={};
  for(const k of keys)if(card&&card[k]!==undefined)out[k]=clone(card[k]);
  const id=safeId(card);out.id=id;
  return out;
}
function routeProjection(card){
  const keys=["country","region","placement","ipSlot","marketScope","countrySupply","affiliate","extension","linkRevenue","outboundReferral","commerceCandidate","outboundRoute","externalProductUrl","officialProductUrl","productUrl","product_url","productPageUrl","detailUrl","url","link","affiliateOutboundUrl","externalOutboundUrl","sellerResponsibility","searchBankContract","sanmaruSearchBankContract","searchBankUnifiedContract","commerceCandidatePublication"];
  const out={};for(const k of keys)if(card&&card[k]!==undefined)out[k]=clone(card[k]);return out;
}
function marketRecord(card,country){
  const scope=plain(card&&card.marketScope), record=plain(scope.marketEvidence);
  if(text(record.country).toUpperCase()===country)return clone(record);
  return null;
}
function mergeRecord(entry,card,country){
  const route=routeProjection(card);
  entry.searchMarkets[country]=route;
  const record=marketRecord(card,country);
  if(record){
    const existing=entry.marketAvailability.markets.find(x=>text(x&&x.country).toUpperCase()===country);
    if(!existing)entry.marketAvailability.markets.push(record);
    else if(Date.parse(text(record.verifiedAt))>Date.parse(text(existing.verifiedAt)))Object.assign(existing,record);
  }
  const p=Number(card&&card.priority), old=Number(entry.priority);
  if(Number.isFinite(p)&&(!Number.isFinite(old)||p>old))entry.priority=p;
  const s=Number(card&&card.score), oldS=Number(entry.score);
  if(Number.isFinite(s)&&(!Number.isFinite(oldS)||s>oldS))entry.score=s;
}
function writeOutput(doc){fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(doc));}

// Record genuine source commit times, never build time, as page lastmod.
function writeMaruPageManifest(){
  const pages={};
  for(const [id,filename] of [["maru-windows","maru-download.html"],["maru-android","maru-android.html"]]){
    try{
      const working=execFileSync("git",["hash-object","--",filename],{cwd:root,encoding:"utf8",timeout:2000,stdio:["ignore","pipe","ignore"]}).trim();
      const committed=execFileSync("git",["rev-parse",`HEAD:${filename}`],{cwd:root,encoding:"utf8",timeout:2000,stdio:["ignore","pipe","ignore"]}).trim();
      if(!working || working!==committed) continue;
      const raw=execFileSync("git",["log","-1","--format=%cI","--",filename],{cwd:root,encoding:"utf8",timeout:2000,stdio:["ignore","pipe","ignore"]}).trim();
      const stamp=Date.parse(raw);
      if(raw&&Number.isFinite(stamp)&&stamp<=Date.now()+300000) pages[id]=new Date(stamp).toISOString();
    }catch(_e){ /* No Git history: no invented lastmod. */ }
  }
  const filename=path.join(root,"netlify","functions","data","search-exposure-maru-pages.json");
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  fs.writeFileSync(filename,JSON.stringify({schema:"igdc-maru-search-page-changes-v1",pages})+"\n");
}

function main(){
  writeMaruPageManifest();
  const manifest=readJson(manifestPath);
  if(!manifest||manifest.schema!=="canonical-ip-slot-release-manifest-v1"||!manifest.canonicalReleaseId){
    writeOutput({schema:"igdc-search-exposure-public-v1",version:VERSION,generatedAt:new Date().toISOString(),source:"no-canonical-ip-manifest",canonicalReleaseId:null,ipSlotPolicyDigest:null,verifiedSnapshotCount:0,scannedCardCount:0,publishedCardCount:0,itemCount:0,items:[]});
    process.stdout.write("IGDC Search Exposure Registry · no canonical IP manifest · items=0\n");
    return;
  }
  const products=new Map();let verifiedSnapshots=0,scannedCards=0,publishedCards=0;
  for(const row of Array.isArray(manifest.snapshots)?manifest.snapshots:[]){
    const page=text(row&&row.page), fileName=text(row&&row.file), country=text(row&&row.country).toUpperCase();
    if(!ALLOWED_PAGES.has(page)||!ALLOWED_FILES.has(fileName)||!/^[A-Z]{2}$/.test(country))continue;
    const file=safeLocalPath(row.path);if(!file||path.basename(file)!==fileName||!fs.existsSync(file))continue;
    const bytes=fs.readFileSync(file), expected=text(row.sha256).toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(expected)||sha256Bytes(bytes)!==expected)throw new Error("SEARCH_EXPOSURE_SCOPED_HASH_MISMATCH:"+text(row.path));
    const doc=JSON.parse(bytes.toString("utf8"));verifiedSnapshots++;
    for(const card of cardRows(doc,page)){
      scannedCards++;if(!published(card,country))continue;publishedCards++;
      const id=safeId(card);let entry=products.get(id);
      if(!entry){entry=pick(card);entry.searchMarkets={};entry.marketAvailability={markets:[]};products.set(id,entry);}
      mergeRecord(entry,card,country);
    }
  }
  const items=[...products.values()].sort((a,b)=>text(a.id).localeCompare(text(b.id)));
  const payload={schema:"igdc-search-exposure-public-v1",version:VERSION,generatedAt:new Date().toISOString(),source:"canonical-ip-slot-release",canonicalReleaseId:manifest.canonicalReleaseId,ipSlotPolicyDigest:manifest.ipSlotPolicyDigest||null,verifiedSnapshotCount:verifiedSnapshots,scannedCardCount:scannedCards,publishedCardCount:publishedCards,itemCount:items.length,items};
  writeOutput(payload);
  process.stdout.write(`IGDC Search Exposure Registry · release=${manifest.canonicalReleaseId} · snapshots=${verifiedSnapshots} · publishedCards=${publishedCards} · products=${items.length}\n`);
}
main();
