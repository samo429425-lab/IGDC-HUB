"use strict";

/*
 * Distribution Hub automatic seller/product collector.
 * - Reads SearchBank reservoir first.
 * - When a country/region does not have enough verified candidates, asks the
 *   existing Sanmaru engine to search its authorised provider lanes.
 * - Performs bounded public-page evidence inspection before publication.
 * - Returns an in-memory snapshot; never rewrites SearchBank, Snapshot Engine,
 *   or generic search output from a visitor request.
 */

const Core=require("./lib/regional-brokerage-autoselection.core.v1");
const VERSION="regional-brokerage-autoselector-v1.0.0";
const CACHE_TTL=5*60*1000;
const RESPONSE_TIMEOUT=8200;
const DISCOVERY_TIMEOUT=6200;
const MAX_LIVE_QUERIES=3;
const MAX_PAGE_CHECKS=8;
const CACHE=globalThis.__IGDC_REGIONAL_BROKERAGE_CACHE__||(globalThis.__IGDC_REGIONAL_BROKERAGE_CACHE__=new Map());

function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase();}
function first(){for(const v of arguments){const t=text(v);if(t)return t;}return "";}
function withTimeout(promise,ms){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Object.assign(new Error("timeout"),{code:"TIMEOUT"})),ms);Promise.resolve(promise).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
function cacheKey(geo){return [geo.country,geo.region||"-"].join(":");}
function getCache(key){const row=CACHE.get(key);if(!row||Date.now()-row.at>(row.ttl||CACHE_TTL)){CACHE.delete(key);return null;}return row.value;}
function setCache(key,value){CACHE.set(key,{at:Date.now(),ttl:value&&value.snapshot?CACHE_TTL:90000,value});if(CACHE.size>120){const firstKey=CACHE.keys().next().value;CACHE.delete(firstKey);}return value;}
function extractItems(result){if(!result)return[];if(Array.isArray(result))return result;if(Array.isArray(result.items))return result.items;if(Array.isArray(result.results))return result.results;if(result.data&&Array.isArray(result.data.items))return result.data.items;return[];}

function discoveryQueries(geo){
  const locality=[geo.region,geo.countryName].filter(Boolean).join(" ");
  return [
    `${locality} official producer cooperative online store shipping returns`,
    `${locality} official manufacturer brand store local delivery customer service`,
    `${locality} agricultural cooperative wholesale market official online shopping`
  ].slice(0,MAX_LIVE_QUERIES);
}
async function runSanmaruDiscovery(event,geo){
  let Sanmaru=null;try{Sanmaru=require("./sanmaru_engine_v2");}catch(_e){}
  if(!Sanmaru||typeof Sanmaru.runEngine!=="function")return{items:[],trace:[{source:"sanmaru",status:"unavailable"}]};
  const tasks=discoveryQueries(geo).map(async q=>{
    try{
      const result=await withTimeout(Sanmaru.runEngine(event||{}, {
        q,query:q,country:geo.country,region:geo.region||undefined,limit:18,candidatePool:36,
        type:"site",external:"force",directExternal:"1",noMedia:"1",deep:"0",
        from:"regional-brokerage-autoselector",source:"regional-brokerage-autoselector",
        regionalBrokerageSupply:"1",noAnalytics:"1",noRevenue:"1",readOnly:"1",noWrite:"1",noSync:"1",writeMode:"readonly"
      }),DISCOVERY_TIMEOUT);
      return {q,items:extractItems(result),status:"ok"};
    }catch(e){return{q,items:[],status:lower(e&&e.code||e&&e.message||"error")};}
  });
  const settled=await Promise.all(tasks);
  return {items:settled.flatMap(x=>x.items||[]),trace:settled.map(x=>({query:x.q,status:x.status,count:(x.items||[]).length}))};
}

function safeHttpUrl(raw){
  try{const u=new URL(raw);if(u.protocol!=="https:"&&u.protocol!=="http:")return null;const host=u.hostname.toLowerCase();if(!host||host==="localhost"||host.endsWith(".local")||/^\d{1,3}(\.\d{1,3}){3}$/.test(host)||host.includes(":"))return null;return u;}catch(_e){return null;}
}
function htmlTextScore(value){const t=String(value||"");return{shipping:/\b(shipping|delivery|ship to|dispatch|배송|배달|출고)\b/i.test(t),returns:/\b(return(?:s| policy)?|refund(?:s| policy)?|exchange(?:s)?|반품|환불|교환)\b/i.test(t),service:/\b(customer service|customer support|contact us|support center|고객센터|고객 지원|문의)\b/i.test(t),official:/\b(official|manufacturer|producer|cooperative|brand store|authorized distributor|공식|제조사|생산자|협동조합|농협|축협|수협|공판장|총판)\b/i.test(t)};}
function flattenJsonLd(value,out){if(!value)return;if(Array.isArray(value)){value.forEach(v=>flattenJsonLd(v,out));return;}if(typeof value!=="object")return;out.push(value);if(Array.isArray(value["@graph"]))flattenJsonLd(value["@graph"],out);}
function jsonLdEvidence(html,geo){
  const nodes=[];const rx=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=rx.exec(html))){try{flattenJsonLd(JSON.parse(m[1]),nodes);}catch(_e){}}
  let org=false,product=false,matchCountry=false,matchRegion=false,detectedCountry="",detectedRegion="";
  for(const node of nodes){
    const type=Array.isArray(node["@type"])?node["@type"].join(" "):String(node["@type"]||"");
    if(/Organization|LocalBusiness|Store|Farm|WholesaleStore|OnlineStore|Corporation/i.test(type))org=true;
    if(/Product|Offer|ItemList/i.test(type))product=true;
    const address=node.address||{};
    const country=Core.normalizeCountry(address.addressCountry||node.areaServed||node.countryOfOrigin||"");
    const region=Core.normalizeRegion(address.addressRegion||node.areaServedRegion||"",country||geo.country);
    if(country){detectedCountry=detectedCountry||country;if(geo.country&&country===geo.country)matchCountry=true;}
    if(region){detectedRegion=detectedRegion||region;if(geo.region&&region===geo.region)matchRegion=true;}
  }
  return{org,product,matchCountry,matchRegion,country:detectedCountry,region:detectedRegion};
}
async function inspectCandidate(item,geo){
  const url=Core.externalUrl(item);if(!url)return item;
  const u=safeHttpUrl(url);if(!u)return item;
  try{
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1900);
    const response=await fetch(u.toString(),{redirect:"follow",signal:controller.signal,headers:{"user-agent":"IGDC-MARU-BrokerageVerifier/1.0 (+https://igdc.example)"}});clearTimeout(timer);
    if(!response.ok)return item;
    const finalUrl=safeHttpUrl(response.url||u.toString());if(!finalUrl)return item;
    const type=String(response.headers.get("content-type")||"");if(!/text\/html|application\/xhtml\+xml/i.test(type))return item;
    const length=Number(response.headers.get("content-length")||0);if(length>550000)return item;
    const html=(await response.text()).slice(0,550000);
    const words=htmlTextScore(html);const ld=jsonLdEvidence(html,geo);
    const evidence=Object.assign({},item.brokerageVerification||{}, { automated:true, inspectedAt:new Date().toISOString(), official:words.official||ld.org, shipping:words.shipping, returns:words.returns, service:words.service, jsonLdOrganization:ld.org, jsonLdProduct:ld.product, inspectedUrl:finalUrl.toString() });
    // Do not infer a seller's legal distribution market merely from the visitor's IP.
    // Only retain a live candidate when its source already carries a market scope,
    // or the official page exposes country/region metadata through JSON-LD.
    const detectedCountry=ld.country||Core.normalizeCountry(item.distributionMarketCountry||item.sellerMarketCountry||item.marketCountry||item.country||item.geo&&item.geo.country);
    const detectedRegion=ld.region||Core.normalizeRegion(item.distributionMarketRegion||item.sellerRegion||item.region||item.geo&&item.geo.state,detectedCountry);
    const scope=Object.assign({},item,{
      distributionMarketCountry:detectedCountry||undefined,
      distributionMarketRegion:detectedRegion||undefined,
      availabilityCountries:item.availabilityCountries||item.shippingCountries||(detectedCountry?[detectedCountry]:undefined),
      availabilityRegions:item.availabilityRegions||item.shippingRegions||(detectedRegion?[detectedRegion]:undefined),
      nationalAvailability:item.nationalAvailability===true||(!detectedRegion&&detectedCountry===geo.country&&ld.matchCountry)
    });
    return Object.assign({},scope,{url:finalUrl.toString(),officialSource:item.officialSource||evidence.official,sellerVerified:item.sellerVerified||false,brokerageVerification:evidence,shippingAvailable:item.shippingAvailable||evidence.shipping,returnPolicyAvailable:item.returnPolicyAvailable||evidence.returns,customerServiceAvailable:item.customerServiceAvailable||evidence.service,sourceTrust:Math.max(Number(item.sourceTrust||0), evidence.official&&evidence.shipping&&(evidence.returns||evidence.service)&&detectedCountry?0.65:0)});
  }catch(_e){return item;}
}
async function inspectLive(items,geo){
  const unique=[];const seen=new Set();
  for(const item of items||[]){const url=Core.externalUrl(item);if(!url||seen.has(url))continue;seen.add(url);unique.push(item);if(unique.length>=MAX_PAGE_CHECKS)break;}
  const settled=await Promise.all(unique.map(item=>inspectCandidate(item,geo)));
  return settled;
}

function templateSnapshot(){
  const stored=Core.loadStoredCandidates();
  const templateSource=stored.sources.find(s=>/distribution\.snapshot\.json$/i.test(s.file));
  if(templateSource){try{return JSON.parse(require("fs").readFileSync(templateSource.file,"utf8"));}catch(_e){}}
  const fs=require("fs"),path=require("path");
  for(const root of [process.cwd(),path.resolve(__dirname,"..","..")]){const file=path.join(root,"data","distribution.snapshot.json");try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_e){}}
  return null;
}
async function runSelection(event,params){
  const geo=Core.parseGeo(event,params||{});const key=cacheKey(geo);const cached=getCache(key);if(cached)return Object.assign({},cached,{meta:Object.assign({},cached.meta||{},{cache:"hit"})});
  const started=Date.now();const stored=Core.loadStoredCandidates();let selected=Core.selection(stored.items,geo);let discovery={items:[],trace:[]};
  if(selected.accepted.length<6 && geo.country!=="GLOBAL"){
    discovery=await runSanmaruDiscovery(event,geo);
    const checked=await inspectLive(discovery.items,geo);
    selected=Core.selection(stored.items.concat(checked),geo);
  }
  const template=templateSnapshot();const snapshot=selected.accepted.length&&template?Core.buildSnapshot(template,selected.accepted,geo,{storedSources:stored.sources,discovery:discovery.trace,stats:selected.stats,elapsedMs:Date.now()-started}):null;
  const result={status:"ok",engine:"regional-brokerage-autoselector",version:VERSION,geo:{country:geo.country,region:geo.region||null,precision:geo.region?"coarse-region":"country"},items:selected.accepted.map(x=>x.item),snapshot,meta:{cache:"miss",selection:selected.stats,rejections:selected.rejected.slice(0,80),discovery:discovery.trace,elapsedMs:Date.now()-started,hasSnapshot:!!snapshot}};
  return setCache(key,result);
}

module.exports={VERSION,runSelection};
