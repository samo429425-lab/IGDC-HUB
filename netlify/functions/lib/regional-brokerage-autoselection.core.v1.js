"use strict";

/*
 * IGDC/MARU Regional Brokerage Auto-Selection Core v1
 *
 * Deliberately separate from the four core engines.  It consumes Sanmaru
 * discovery output and SearchBank's existing reservoir, then returns only
 * qualifying external-seller referral cards for Distribution Hub.
 *
 * This module never runs for Search.js, Global Insight, Media, Donation,
 * Tourism, or any generic SearchBank query.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const MarketSaleScope = require("./market-sale-scope.v1");

const VERSION = "regional-brokerage-autoselection-core-v1.2.0-market-evidence-integrity";
const MAX_CANDIDATES = 240;
const MAX_PER_SECTION = 100;

const COUNTRY_NAMES = Object.freeze({
  KR:"South Korea", US:"United States", CA:"Canada", JP:"Japan", GB:"United Kingdom", AU:"Australia", DE:"Germany", FR:"France", IT:"Italy", ES:"Spain", NL:"Netherlands", SE:"Sweden", NO:"Norway", FI:"Finland", DK:"Denmark", BR:"Brazil", MX:"Mexico", AR:"Argentina", CL:"Chile", PE:"Peru", CO:"Colombia", IN:"India", ID:"Indonesia", TH:"Thailand", VN:"Vietnam", PH:"Philippines", MY:"Malaysia", SG:"Singapore", TW:"Taiwan", HK:"Hong Kong", CN:"China", AE:"United Arab Emirates", SA:"Saudi Arabia", TR:"Turkey", ZA:"South Africa", NG:"Nigeria", KE:"Kenya", EG:"Egypt", RU:"Russia", UA:"Ukraine", PL:"Poland", PT:"Portugal", NZ:"New Zealand"
});

const COUNTRY_ALIASES = Object.freeze({
  "korea":"KR", "south korea":"KR", "republic of korea":"KR", "대한민국":"KR", "한국":"KR",
  "usa":"US", "u.s.":"US", "united states":"US", "america":"US", "미국":"US",
  "canada":"CA", "캐나다":"CA", "japan":"JP", "일본":"JP", "uk":"GB", "united kingdom":"GB", "britain":"GB", "england":"GB", "영국":"GB",
  "australia":"AU", "austria":"AT", "germany":"DE", "france":"FR", "italy":"IT", "spain":"ES", "netherlands":"NL", "brazil":"BR", "mexico":"MX", "india":"IN", "russia":"RU", "china":"CN", "taiwan":"TW", "vietnam":"VN", "thailand":"TH", "indonesia":"ID", "singapore":"SG", "malaysia":"MY", "philippines":"PH", "turkey":"TR", "saudi arabia":"SA", "united arab emirates":"AE", "south africa":"ZA", "new zealand":"NZ"
});

const LARGE_MARKETPLACE_HOSTS = new Set([
  "amazon.com", "amazon.co.uk", "amazon.de", "amazon.co.jp", "amazon.ca", "amazon.in", "amazon.com.au", "amazon.fr", "amazon.it", "amazon.es", "amazon.com.br", "amazon.com.mx",
  "coupang.com", "ebay.com", "ebay.co.uk", "aliexpress.com", "temu.com", "wish.com", "walmart.com", "etsy.com", "rakuten.co.jp", "mercadolibre.com", "shopee.com", "lazada.com", "taobao.com", "tmall.com", "jd.com", "flipkart.com"
]);
const LARGE_MARKETPLACE_WORDS = /\b(amazon|coupang|ebay|aliexpress|temu|wish|walmart marketplace|etsy|rakuten marketplace|mercado libre|shopee|lazada|taobao|tmall|jd\.com|flipkart)\b/i;
const RISK_WORDS = /\b(phishing|scam|counterfeit|malware|adult|illegal|weapons|gambling|fraud)\b/i;
const RETURN_WORDS = /\b(return(?:s| policy)?|refund(?:s| policy)?|exchange(?:s)?|반품|환불|교환)\b/i;
const SERVICE_WORDS = /\b(customer service|customer support|contact us|support center|고객센터|고객 지원|문의)\b/i;
const SHIPPING_WORDS = /\b(shipping|delivery|ship to|dispatch|배송|배달|출고)\b/i;
const OFFICIAL_WORDS = /\b(official|manufacturer|producer|cooperative|co-op|farmers'? market|wholesale market|brand store|authorized distributor|공식|제조사|생산자|협동조합|농협|축협|수협|공판장|총판|대리점)\b/i;

function text(v){ return v == null ? "" : String(v).trim(); }
function lower(v){ return text(v).toLowerCase(); }
function asArray(v){ if(Array.isArray(v)) return v; if(v == null || v === "") return []; if(typeof v === "string") return v.split(/[|,;\n]/).map(x=>x.trim()).filter(Boolean); return [v]; }
function unique(values){ const seen = new Set(); const out=[]; for(const value of values || []){ const v=text(value); if(v && !seen.has(v)){ seen.add(v); out.push(v); } } return out; }
function safeJsonClone(v){ try{return JSON.parse(JSON.stringify(v));}catch(_e){return v;} }
function safeRead(file, fallback){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_e){return fallback;} }
function first(){ for(const value of arguments){ const v=text(value); if(v) return v; } return ""; }
function truthy(v){ if(v === true) return true; if(v === false || v == null) return false; return ["1","true","yes","on","enabled","verified","approved"].includes(lower(v)); }
function hash(v){ return crypto.createHash("sha256").update(text(v)).digest("hex").slice(0,24); }
function now(){ return new Date().toISOString(); }

function normalizeCountry(v){
  if(v && typeof v === "object") v = v.code || v.countryCode || v.country || v.iso || "";
  const raw = text(v); if(!raw) return "";
  const alias = COUNTRY_ALIASES[lower(raw)]; if(alias) return alias;
  if(/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return "";
}
function normalizeRegion(v, country){
  if(v && typeof v === "object") v = v.code || v.subdivisionCode || v.regionCode || v.state || v.province || v.name || "";
  let raw = text(v).toUpperCase(); if(!raw) return "";
  const cc = normalizeCountry(country);
  raw = raw.replace(/[._/]/g,"-").replace(/\s+/g,"-");
  if(cc && raw.startsWith(cc+"-")) raw=raw.slice(cc.length+1);
  return /^[A-Z0-9-]{2,12}$/.test(raw) ? raw : "";
}
function normalizeCountryList(values){ return unique(asArray(values).map(normalizeCountry).filter(Boolean)); }
function normalizeRegionList(values, country){ return unique(asArray(values).map(v=>normalizeRegion(v,country)).filter(Boolean)); }

function parseGeo(event, params){
  const headers = (event && event.headers) || {};
  const h={}; Object.keys(headers).forEach(k=>h[k.toLowerCase()]=headers[k]);
  let nf={};
  try{ nf=JSON.parse(h["x-nf-geo"] || "{}"); }catch(_e){}
  const country = normalizeCountry(first(nf.country, nf.country_code, h["x-country"], h["cf-ipcountry"], h["x-vercel-ip-country"], h["x-nf-country"], params && params.country, params && params.targetCountry));
  const region = normalizeRegion(first(nf.subdivision, nf.region, nf.state, h["x-region"], h["x-vercel-ip-country-region"], h["x-nf-region"], params && params.region, params && params.targetRegion), country);
  const city = text(first(nf.city, h["x-city"], h["x-nf-city"])).slice(0,80);
  return { country: country || "GLOBAL", region, city, countryName: COUNTRY_NAMES[country] || country || "Global" };
}

function rootCandidates(){
  return unique([
    process.cwd(),
    path.resolve(__dirname,"..","..",".."),
    path.resolve(__dirname,"..","..")
  ]);
}
function findFile(relatives){
  for(const root of rootCandidates()){
    for(const rel of relatives){
      const file=path.join(root,rel);
      try{ if(fs.statSync(file).isFile()) return file; }catch(_e){}
    }
  }
  return null;
}
function canonicalSearchBankItem(item){
  const publication=item && item.canonicalPublication;
  const placement=item && item.placement;
  return !!(publication && publication.status==="published" && publication.releaseId && publication.candidateId && publication.mappingDigest &&
    placement && placement.page==="distribution" && placement.section && Number.isInteger(Number(placement.slot)) && placement.country && placement.region &&
    item && item.ipSlot && item.ipSlot.required===true && item.ipSlot.marketEvidenceDigest);
}
function canonicalSearchBankDocument(doc){
  return !!(doc && doc.meta && doc.meta.schema === "search-bank.snapshot.canonical.v1" && Array.isArray(doc.items));
}
function flattenSnapshot(doc){
  const out=[];
  const push=(x)=>{ if(x && typeof x==="object") out.push(x); };
  if(Array.isArray(doc)) doc.forEach(push);
  if(doc && Array.isArray(doc.items)) doc.items.forEach(push);
  if(doc && Array.isArray(doc.results)) doc.results.forEach(push);
  if(doc && doc.pages && typeof doc.pages==="object") Object.values(doc.pages).forEach(page=>{
    const sections=page && page.sections; if(!sections || typeof sections!=="object") return;
    Object.values(sections).forEach(section=>{ if(Array.isArray(section)) section.forEach(push); else if(section && Array.isArray(section.slots)) section.slots.forEach(push); });
  });
  if(doc && doc.sections && typeof doc.sections==="object") Object.values(doc.sections).forEach(section=>{ if(Array.isArray(section)) section.forEach(push); else if(section && Array.isArray(section.slots)) section.slots.forEach(push); });
  return out;
}
function candidateSources(){
  const files=[];
  const searchBank=findFile(["data/search-bank.snapshot.json","netlify/functions/data/search-bank.snapshot.json","netlify/functions/search-bank.snapshot.json"]);
  if(searchBank) files.push(searchBank);
  const feed=findFile(["data/regional-brokerage-candidates.json","netlify/functions/data/regional-brokerage-candidates.json"]);
  if(feed) files.push(feed);
  const graph=findFile(["data/searchbank/commerce/commerce.graph.json"]);
  if(graph) files.push(graph);
  const result=[];
  for(const file of unique(files)){
    const doc=safeRead(file,{});
    const isSearchBank=/search-bank\.snapshot\.json$/i.test(file);
    const items=isSearchBank
      ? (canonicalSearchBankDocument(doc) ? (doc.items || []).filter(canonicalSearchBankItem) : [])
      : flattenSnapshot(doc).concat(Array.isArray(doc && doc.items)?doc.items:[]);
    result.push({file,items});
  }
  return result;
}
function expandMarketCandidates(items){
  const output=[];
  for(const item of Array.isArray(items)?items:[]){
    const variants=MarketSaleScope.expand(item);
    // Dynamic distribution selection is a public front surface. It must never
    // reconstruct a market from a raw candidate or a visitor request. Only an
    // exact, materialized sale-market envelope can proceed to verification.
    variants.forEach(variant=>output.push(variant.item));
  }
  return output;
}
function loadStoredCandidates(){
  const output=[]; const sources=[];
  for(const source of candidateSources()){
    const expanded=expandMarketCandidates(source.items);
    output.push(...expanded);
    sources.push({file:source.file,count:source.items.length,marketVariants:expanded.length});
  }
  return {items:output,sources};
}
function isPlaceholder(item){
  const textValue=lower([item && item.url,item && item.link && item.link.url,item && item.title,item && item.name,item && item.thumb,item && item.image].filter(Boolean).join(" "));
  return !textValue || /(^|\s)#(\s|$)|placeholder|sample\/|product\s*\d+|item\s*\d+|assets\/sample/.test(textValue);
}
function externalUrl(item){
  const raw=first(item&&item.externalProductUrl,item&&item.productUrl,item&&item.url,item&&item.href,item&&item.link&&item.link.url,item&&item.checkoutUrl);
  if(!raw) return "";
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:" && u.protocol!=="http:") return "";
    if(u.username || u.password || u.port) return "";
    const host=u.hostname.toLowerCase();
    if(!host || host==="localhost" || host.endsWith(".local") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return "";
    return u.toString();
  }catch(_e){ return ""; }
}
function hostOf(url){ try{return new URL(url).hostname.toLowerCase().replace(/^www\./,"");}catch(_e){return "";} }
function isMarketplace(item,url){
  const host=hostOf(url); if(!host) return true;
  for(const bad of LARGE_MARKETPLACE_HOSTS){ if(host===bad || host.endsWith("."+bad)) return true; }
  const body=lower([host,item&&item.title,item&&item.name,item&&item.provider,item&&item.source,item&&item.seller,item&&item.merchant].filter(Boolean).join(" "));
  return LARGE_MARKETPLACE_WORDS.test(body);
}
function signalText(item){
  return [item&&item.title,item&&item.name,item&&item.summary,item&&item.description,item&&item.provider,item&&item.source,item&&item.seller,item&&item.merchant,item&&item.organization&&item.organization.name,item&&item.org&&item.org.name,Array.isArray(item&&item.tags)?item.tags.join(" "):"",JSON.stringify(item&&item.brokerageVerification||{}),JSON.stringify(item&&item.evidence||{})].filter(Boolean).join(" ");
}
function distributionScope(item){
  const seller=item && (item.seller || item.merchant || item.provider || item.organization || item.org) || {};
  const market=item&&item.marketScope&&item.marketScope.marketEvidence||{};
  const country=normalizeCountry(first(item&&item.marketScope&&item.marketScope.marketCountry,item&&item.countrySupply&&item.countrySupply.targetMarket,item&&item.distributionMarketCountry,item&&item.sellerMarketCountry,item&&item.marketCountry,item&&item.country,item&&item.geo&&item.geo.country,item&&item.location&&item.location.country,seller&&seller.country));
  const region=normalizeRegion(first(item&&item.marketScope&&item.marketScope.marketRegion,item&&item.countrySupply&&item.countrySupply.targetRegion,item&&item.distributionMarketRegion,item&&item.sellerRegion,item&&item.region,item&&item.geo&&item.geo.state,item&&item.geo&&item.geo.province,item&&item.location&&item.location.region,seller&&seller.region),country);
  const availabilityCountries=normalizeCountryList(first(item&&item.marketScope&&item.marketScope.marketCountry,item&&item.countrySupply&&item.countrySupply.availabilityCountries,item&&item.availabilityCountries,item&&item.shippingCountries,item&&item.serviceCountries,item&&item.deliveryCountries,item&&item.brokerageVerification&&item.brokerageVerification.availabilityCountries));
  const availabilityRegions=normalizeRegionList(first(market&&market.regions,item&&item.countrySupply&&item.countrySupply.availabilityRegions,item&&item.availabilityRegions,item&&item.shippingRegions,item&&item.serviceRegions,item&&item.deliveryRegions,item&&item.brokerageVerification&&item.brokerageVerification.availabilityRegions),country);
  const national=truthy(market&&market.nationwide)||truthy(item&&item.countrySupply&&item.countrySupply.nationalAvailability)||truthy(item&&item.nationalAvailability)||truthy(item&&item.nationwideShipping)||truthy(item&&item.countrywideService)||truthy(item&&item.brokerageVerification&&item.brokerageVerification.nationalAvailability);
  return {country,region,availabilityCountries,availabilityRegions,national};
}
function evidenceSummary(item){
  const textValue=signalText(item);
  const verification=item&&item.brokerageVerification||{};
  const market=item&&item.marketScope&&item.marketScope.marketEvidence||null;
  const scopedService=(service)=>!!(service&&truthy(service.verified)&&((Array.isArray(service.evidence)&&service.evidence.length)||text(service.evidenceUrl)||text(service.policyUrl)||text(service.url)));
  const scopedSeller=market&&market.sellerResponsibility||{};
  const scopedSellerVerified=!!(market&&truthy(scopedSeller.verified)&&text(scopedSeller.legalEntity)&&text(scopedSeller.supportUrl));
  const verified=market?scopedSellerVerified:(truthy(item&&item.platformVerified)||truthy(item&&item.sellerVerified)||truthy(item&&item.businessVerified)||truthy(item&&item.officialSource)||truthy(item&&item.officialDomain)||truthy(verification.verified));
  const official=verified || (!market && OFFICIAL_WORDS.test(textValue));
  const shipping=market?scopedService(market.shipping):(truthy(item&&item.shippingAvailable)||truthy(item&&item.deliveryAvailable)||truthy(verification.shipping) || SHIPPING_WORDS.test(textValue));
  const returns=market?scopedService(market.returns):(truthy(item&&item.returnPolicyAvailable)||truthy(item&&item.returnsAvailable)||truthy(verification.returns) || RETURN_WORDS.test(textValue));
  const service=market?scopedService(market.support):(truthy(item&&item.customerServiceAvailable)||truthy(item&&item.supportAvailable)||truthy(verification.service) || SERVICE_WORDS.test(textValue));
  const trust=Number(item&&item.sourceTrust||item&&item.trust||item&&item.qualityScore||0);
  const risk=truthy(item&&item.unsafeProductRisk)||truthy(item&&item.illegalSiteRisk)||truthy(item&&item.harmfulContentRisk)||/^(high|critical)$/i.test(text(item&&item.riskLevel))||RISK_WORDS.test(textValue);
  return {verified,official,shipping,returns,service,trust,risk,text:textValue,marketScoped:!!market};
}
function verifyCandidate(item,target){
  const url=externalUrl(item);
  if(!url) return {allowed:false,code:"EXTERNAL_URL_REQUIRED"};
  if(isPlaceholder(item)) return {allowed:false,code:"PLACEHOLDER_REJECTED"};
  if(isMarketplace(item,url)) return {allowed:false,code:"MARKETPLACE_SEPARATE_HUB"};
  const scope=distributionScope(item);
  const evidence=evidenceSummary(item);
  const market=target&&target.country||"GLOBAL";
  if(market==="GLOBAL") return {allowed:false,code:"GEO_UNRESOLVED"};
  const marketValidation=MarketSaleScope.validateMarketScope(item&&item.marketScope, scope.country, scope.region, {maxVerificationAgeDays:30,requireFresh:true});
  if(!marketValidation.ok) return {allowed:false,code:"MARKET_SCOPE_EVIDENCE_INVALID:"+marketValidation.reasons.join(",")};
  if(!item.ipSlot || item.ipSlot.marketEvidenceDigest!==marketValidation.evidenceDigest) return {allowed:false,code:"MARKET_SCOPE_EVIDENCE_DIGEST_MISMATCH"};
  if(evidence.risk) return {allowed:false,code:"RISK_SIGNAL"};
  if(market!=="GLOBAL" && scope.country && scope.country!==market) return {allowed:false,code:"FOREIGN_DISTRIBUTION_MARKET"};
  if(market!=="GLOBAL" && !scope.country && !scope.availabilityCountries.includes(market)) return {allowed:false,code:"DISTRIBUTION_MARKET_UNRESOLVED"};
  if(market!=="GLOBAL" && scope.availabilityCountries.length && !scope.availabilityCountries.includes(market) && scope.country!==market) return {allowed:false,code:"TARGET_AVAILABILITY_MISSING"};
  if(!evidence.verified && !(evidence.official && evidence.shipping && (evidence.returns || evidence.service) && evidence.trust>=0.55)) return {allowed:false,code:"RESPONSIBLE_SELLER_EVIDENCE_INSUFFICIENT"};
  if(!evidence.shipping) return {allowed:false,code:"SHIPPING_EVIDENCE_REQUIRED"};
  if(!(evidence.returns || evidence.service)) return {allowed:false,code:"SERVICE_OR_RETURN_EVIDENCE_REQUIRED"};
  let tier=2;
  const hasRegionalScope = !!scope.region || scope.availabilityRegions.length > 0;
  const regionMatches = !!(target && target.region && (scope.region===target.region || scope.availabilityRegions.includes(target.region)));
  if(regionMatches) tier=0;
  else if(target && target.region && hasRegionalScope && !scope.national) return {allowed:false,code:"OUT_OF_REGION"};
  else if(scope.national || (!hasRegionalScope && (scope.availabilityCountries.includes(market) || scope.country===market))) tier=1;
  else return {allowed:false,code:"REGIONAL_SCOPE_UNRESOLVED"};
  const score=(tier===0?200:100)+(evidence.verified?80:0)+(evidence.official?35:0)+(evidence.shipping?25:0)+(evidence.returns?15:0)+(evidence.service?15:0)+Math.max(0,Math.min(40,evidence.trust*40))+Number(item&&item.priority||item&&item.score||0);
  return {allowed:true,url,host:hostOf(url),tier,score,scope,evidence,code:tier===0?"REGIONAL_ELIGIBLE":"NATIONAL_ELIGIBLE"};
}
function itemId(item,url){ return first(item&&item.id,item&&item.uid,item&&item.productId,item&&item.contentId) || "broker-"+hash(url+"|"+first(item&&item.title,item&&item.name)); }
function managerPriorityItems(){
  const file=findFile(["netlify/functions/data/distribution-priority-listings.json","data/distribution-priority-listings.json"]);
  const doc=file?safeRead(file,{}):{};
  const rows=Array.isArray(doc)?doc:(Array.isArray(doc.items)?doc.items:(Array.isArray(doc.listings)?doc.listings:[]));
  return rows.filter(x=>x&&truthy(x.approved)&&truthy(x.active!==false));
}
function selection(items,target){
  const accepted=[]; const rejected=[]; const seen=new Set();
  const rawAll=expandMarketCandidates(managerPriorityItems().map(x=>Object.assign({},x,{managedPriority:true})).concat(Array.isArray(items)?items:[]));
  // SearchBank can contain thousands of layer/sample records.  Assess real external
  // seller candidates first, otherwise valid entries after the reservoir cannot be reached.
  const preliminaryScore=(item)=>{
    if(!externalUrl(item) || isPlaceholder(item)) return -100000;
    const scope=distributionScope(item); const evidence=evidenceSummary(item);
    let score=0;
    if(item.managedPriority) score+=100000;
    if(scope.country===target.country) score+=20000;
    if(target.region && (scope.region===target.region || scope.availabilityRegions.includes(target.region))) score+=15000;
    if(scope.national) score+=8000;
    if(evidence.verified) score+=6000;
    if(evidence.official) score+=2000;
    if(evidence.shipping) score+=1000;
    if(evidence.returns || evidence.service) score+=700;
    if(/distribution|commerce|product|shop|store|seller|merchant|supplier|market|producer|cooperative|상품|유통|판매|공판장|협동조합/i.test(signalText(item))) score+=400;
    return score+Number(item.priority||item.score||0);
  };
  const all=rawAll.slice().sort((a,b)=> preliminaryScore(b)-preliminaryScore(a));
  for(const item of all.slice(0,MAX_CANDIDATES)){
    const decision=verifyCandidate(item,target);
    const url=decision.url||externalUrl(item);
    const id=itemId(item,url);
    if(!decision.allowed){ rejected.push({id,code:decision.code}); continue; }
    const scope=decision.scope||{};
    if(item.managedPriority){
      const managerCountry=normalizeCountry(first(item.targetMarket,item.country,item.marketCountry));
      const managerRegion=normalizeRegion(first(item.targetRegion,item.region),managerCountry);
      if(managerCountry && target.country!==managerCountry) { rejected.push({id,code:"MANAGER_COUNTRY_OUT_OF_SCOPE"}); continue; }
      if(managerRegion && target.region!==managerRegion) { rejected.push({id,code:"MANAGER_REGION_OUT_OF_SCOPE"}); continue; }
    }
    const sig=decision.host+"|"+lower(first(item.title,item.name));
    if(seen.has(sig)) continue; seen.add(sig);
    accepted.push({item,decision,id,managedPriority:!!item.managedPriority});
  }
  accepted.sort((a,b)=> (Number(b.managedPriority)-Number(a.managedPriority)) || (a.decision.tier-b.decision.tier) || (b.decision.score-a.decision.score) || text(a.item.title).localeCompare(text(b.item.title)));
  return {accepted,rejected,stats:{received:all.length,accepted:accepted.length,rejected:rejected.length,regional:accepted.filter(x=>x.decision.tier===0).length,national:accepted.filter(x=>x.decision.tier===1).length,managed:accepted.filter(x=>x.managedPriority).length}};
}
function sectionKeys(template){
  const sec=template&&template.pages&&template.pages.distribution&&template.pages.distribution.sections;
  return sec&&typeof sec==="object"?Object.keys(sec):[];
}
function sectionFor(entry,keys,index){
  const item=entry.item||{}; const textValue=lower([item.category,item.section,item.psom_key,item.title,item.summary,Array.isArray(item.tags)?item.tags.join(" "):""].join(" "));
  if(entry.managedPriority && keys.includes("distribution-sponsor")) return "distribution-sponsor";
  if(/new|latest|recent|신규|새로운/.test(textValue)&&keys.includes("distribution-new")) return "distribution-new";
  if(/trend|popular|best|인기|추천/.test(textValue)&&keys.includes("distribution-trending")) return "distribution-trending";
  if(/coop|co-op|cooperative|농협|축협|수협|공판장|market|지역/.test(textValue)&&keys.includes("distribution-special")) return "distribution-special";
  const normal=["distribution-recommend","distribution-new","distribution-trending","distribution-special","distribution-others"].filter(k=>keys.includes(k));
  return normal[index%Math.max(1,normal.length)] || keys[0] || "distribution-recommend";
}
function capacity(template,key){ const sec=template&&template.pages&&template.pages.distribution&&template.pages.distribution.sections&&template.pages.distribution.sections[key]; if(Array.isArray(sec)) return Math.max(1,sec.length||MAX_PER_SECTION); if(sec&&Array.isArray(sec.slots)) return Math.max(1,sec.slots.length||MAX_PER_SECTION); return MAX_PER_SECTION; }
function cardFrom(entry,target){
  const item=entry.item||{}; const d=entry.decision||{}; const url=d.url||externalUrl(item);
  return {
    id:entry.id,
    title:first(item.title,item.name,"Verified seller listing"),
    name:first(item.name,item.title),
    summary:first(item.summary,item.description,"External seller checkout, delivery, returns and support are handled by the seller."),
    description:first(item.description,item.summary),
    url,
    externalProductUrl:url,
    thumb:first(item.thumb,item.thumbnail,item.image,item.imageUrl),
    image:first(item.image,item.thumbnail,item.thumb,item.imageUrl),
    price:item.price,
    currency:item.currency,
    cta:first(item.cta,"View seller offer"),
    page:"distribution",
    channel:"distribution",
    category:first(item.category,"product"),
    tags:Array.isArray(item.tags)?item.tags.slice(0,20):undefined,
    provider:first(item.provider,item.seller,item.merchant,item.org&&item.org.name,item.organization&&item.organization.name,d.host),
    seller:first(item.seller,item.merchant,item.org&&item.org.name,item.organization&&item.organization.name,d.host),
    saleMode:"external_brokerage",
    directSale:{enabled:false,policy:"external_seller_checkout_only"},
    commerce:{mode:"external_seller_referral",sellerCheckout:true,inventoryOwner:"external_seller",fulfillmentOwner:"external_seller",returnsOwner:"external_seller"},
    linkRevenue:{enabled:true,mode:"affiliate_lead_ad_traffic",trackId:"rb-"+entry.id,provider:first(item.provider,item.seller,d.host)},
    monetization:{referral:{enabled:true,type:"outbound",trackCode:"rb-"+entry.id,partner:first(item.provider,item.seller,d.host)},trafficChain:{source:"maru",via:"distributionhub",outbound:true,partner:first(item.provider,item.seller,d.host)}},
    countrySupply:{targetMarket:target.country,targetRegion:target.region||null,supplyTier:d.tier===0?"regional":"national",distributionMarketCountry:d.scope&&d.scope.country||null,distributionMarketRegion:d.scope&&d.scope.region||null,availabilityCountries:d.scope&&d.scope.availabilityCountries||[],availabilityRegions:d.scope&&d.scope.availabilityRegions||[],automatedEvidence:true,managedPriority:!!entry.managedPriority,policyVersion:VERSION}
  };
}
function buildSnapshot(template,selected,target,meta){
  const doc=safeJsonClone(template);
  const sections=doc&&doc.pages&&doc.pages.distribution&&doc.pages.distribution.sections;
  if(!sections || typeof sections!=="object") return null;
  const keys=sectionKeys(doc);
  for(const key of keys){ const value=sections[key]; if(Array.isArray(value)) sections[key]=[]; else if(value&&Array.isArray(value.slots)) value.slots=[]; }
  let count=0; const seen=new Set();
  for(let i=0;i<selected.length;i++){
    const entry=selected[i]; const card=cardFrom(entry,target); if(!card || seen.has(card.id)) continue; seen.add(card.id);
    const key=sectionFor(entry,keys,i); const value=sections[key]; const array=Array.isArray(value)?value:(value&&Array.isArray(value.slots)?value.slots:null); if(!array||array.length>=capacity(template,key)) continue;
    card.section=key; card.psom_key=key; card.bind={page:"distribution",section:key,psom_key:key}; array.push(card); count++;
  }
  doc.meta=Object.assign({},doc.meta||{}, {regionalBrokerage:true,generatedAt:now(),targetMarket:target.country,targetRegion:target.region||null,source:"sanmaru-searchbank-regional-brokerage-autoselection",externalSellerOnly:true,directSale:false,cardCount:count,selection:meta||{}});
  return doc;
}

module.exports={VERSION,parseGeo,loadStoredCandidates,expandMarketCandidates,verifyCandidate,selection,buildSnapshot,normalizeCountry,normalizeRegion,COUNTRY_NAMES,externalUrl,isMarketplace};
