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
const VERSION="regional-brokerage-autoselector-v1.0.4-quality-first-country-provider-intake";
const CACHE_TTL=5*60*1000;
function envInt(name,fallback,min,max){
  const value=Number(process.env[name]);
  return Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;
}
// Quality-first defaults. Optional environment overrides exist, but no setup is required.
const DISCOVERY_TIMEOUT=envInt("IGDC_COUNTRY_DISCOVERY_TIMEOUT_MS",20000,8000,45000);
const PROVIDER_FETCH_TIMEOUT=envInt("IGDC_COUNTRY_PROVIDER_TIMEOUT_MS",20000,8000,45000);
const PAGE_CHECK_TIMEOUT=envInt("IGDC_COUNTRY_PAGE_CHECK_TIMEOUT_MS",8000,3000,20000);
const MAX_LIVE_QUERIES=3;
const MAX_PROVIDER_CALLS=envInt("IGDC_COUNTRY_PROVIDER_CALLS",4,2,6);
const MAX_PAGE_CHECKS=envInt("IGDC_COUNTRY_PAGE_CHECKS",10,4,16);
const CACHE=globalThis.__IGDC_REGIONAL_BROKERAGE_CACHE__||(globalThis.__IGDC_REGIONAL_BROKERAGE_CACHE__=new Map());

function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase();}
function first(){for(const v of arguments){const t=text(v);if(t)return t;}return "";}
function withTimeout(promise,ms){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Object.assign(new Error("timeout"),{code:"TIMEOUT"})),ms);Promise.resolve(promise).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
function cacheKey(geo,mode){return [geo.country,geo.region||"-",mode||"front"].join(":");}
function getCache(key){const row=CACHE.get(key);if(!row||Date.now()-row.at>(row.ttl||CACHE_TTL)){CACHE.delete(key);return null;}return row.value;}
function setCache(key,value){CACHE.set(key,{at:Date.now(),ttl:value&&value.snapshot?CACHE_TTL:90000,value});if(CACHE.size>120){const firstKey=CACHE.keys().next().value;CACHE.delete(firstKey);}return value;}
function extractItems(result){if(!result)return[];if(Array.isArray(result))return result;if(Array.isArray(result.items))return result.items;if(Array.isArray(result.results))return result.results;if(result.data&&Array.isArray(result.data.items))return result.data.items;return[];}

function stableOffset(value,size){
  let hash=0;for(const ch of String(value||""))hash=((hash<<5)-hash+ch.charCodeAt(0))|0;
  return size?Math.abs(hash)%size:0;
}
function discoveryQueries(geo){
  const locality=[geo.region,geo.countryName].filter(Boolean).join(" ");
  const themes=[
    "official producer cooperative online store shipping returns",
    "official manufacturer brand store local delivery customer service",
    "agricultural fishery forestry cooperative wholesale market official online shopping",
    "official food grocery household essentials local seller delivery returns",
    "official personal care beauty everyday products local store customer support",
    "official basic apparel shoes bags local brand store shipping returns",
    "official small electronics accessories authorized distributor delivery warranty support",
    "official home appliance kitchen household brand store delivery returns",
    "official family education baby child products local seller shipping support",
    "official tourism travel products local provider booking support refund policy"
  ];
  const day=Math.floor(Date.now()/86400000);
  const offset=stableOffset([geo.country,geo.region||"NATIONWIDE",day].join("|"),themes.length);
  const out=[];
  for(let i=0;i<MAX_LIVE_QUERIES;i++)out.push(`${locality} ${themes[(offset+i)%themes.length]}`);
  return out;
}
function envFirst(){
  for(const name of arguments){const value=text(process.env[name]);if(value)return value;}
  return "";
}
function stripHtml(value){return text(value).replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim();}
function providerErrorCode(error){
  const code=lower(error&&error.code||error&&error.name||error&&error.message||"provider_error");
  if(/abort|timeout/.test(code))return "timeout";
  const http=code.match(/http[_-]?(\d{3})/);if(http)return "http_"+http[1];
  return code.slice(0,80)||"provider_error";
}
function retryableProviderError(error){
  const code=lower(error&&error.code||error&&error.name||error&&error.message||"");
  return /abort|timeout|http[_-]?(408|409|425|429|5\d\d)/.test(code);
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function fetchJson(url,options,timeoutMs){
  const wait=Math.max(3000,timeoutMs||PROVIDER_FETCH_TIMEOUT);
  let lastError=null;
  for(let attempt=0;attempt<2;attempt+=1){
    const controller=typeof AbortController!=="undefined"?new AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),wait):null;
    try{
      const response=await fetch(url,Object.assign({},options||{},{signal:controller?controller.signal:undefined}));
      if(!response||!response.ok){const error=new Error("HTTP_"+(response&&response.status||0));error.code="HTTP_"+(response&&response.status||0);throw error;}
      return await response.json();
    }catch(error){
      lastError=error;
      if(attempt===0&&retryableProviderError(error)){await delay(500);continue;}
      throw error;
    }finally{if(timer)clearTimeout(timer);}
  }
  throw lastError||new Error("provider_error");
}
function googleKeys(){return{key:envFirst("GOOGLE_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_CUSTOM_SEARCH_API_KEY","GOOGLE_CLOUD_API_KEY"),cx:envFirst("GOOGLE_CSE_ID","GOOGLE_CX","GOOGLE_SEARCH_ENGINE_ID","GOOGLE_CUSTOM_SEARCH_ENGINE_ID","GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID")};}
function naverKeys(){return{id:envFirst("NAVER_API_KEY","NAVER_CLIENT_ID","NAVER_SEARCH_CLIENT_ID","NAVER_OPENAPI_CLIENT_ID"),secret:envFirst("NAVER_CLIENT_SECRET","NAVER_API_SECRET","NAVER_SEARCH_CLIENT_SECRET","NAVER_OPENAPI_CLIENT_SECRET")};}
async function googleCountrySearch(query,geo,limit){
  const keys=googleKeys();if(!keys.key||!keys.cx)return{provider:"google",query,status:"not_configured",items:[]};
  const params=new URLSearchParams({key:keys.key,cx:keys.cx,q:query,num:String(Math.max(1,Math.min(10,limit||10))),start:"1",safe:"active",filter:"1"});
  if(/^[A-Z]{2}$/.test(geo.country||"")){params.set("gl",geo.country.toLowerCase());params.set("cr","country"+geo.country);}
  params.set("hl",geo.country==="KR"?"ko":"en");
  try{
    const data=await fetchJson("https://www.googleapis.com/customsearch/v1?"+params.toString(),null,PROVIDER_FETCH_TIMEOUT);
    const items=(Array.isArray(data.items)?data.items:[]).map(row=>{
      const map=row&&row.pagemap||{};const thumb=first(map.cse_image&&map.cse_image[0]&&map.cse_image[0].src,map.cse_thumbnail&&map.cse_thumbnail[0]&&map.cse_thumbnail[0].src);
      return{title:stripHtml(row&&row.title),url:text(row&&row.link),link:text(row&&row.link),summary:stripHtml(row&&row.snippet),snippet:stripHtml(row&&row.snippet),source:"google_country_discovery",provider:"google",type:"web",thumbnail:thumb,image:thumb,payload:{source:"google",country:geo.country,query}};
    }).filter(row=>row.title&&row.url);
    return{provider:"google",query,status:items.length?"ok":"empty",items};
  }catch(error){return{provider:"google",query,status:providerErrorCode(error),items:[]};}
}
async function naverCountrySearch(query,geo,limit){
  const keys=naverKeys();if(!keys.id||!keys.secret)return{provider:"naver",query,status:"not_configured",items:[]};
  const params=new URLSearchParams({query,display:String(Math.max(1,Math.min(100,limit||20))),start:"1"});
  try{
    const data=await fetchJson("https://openapi.naver.com/v1/search/webkr.json?"+params.toString(),{headers:{"X-Naver-Client-Id":keys.id,"X-Naver-Client-Secret":keys.secret}},PROVIDER_FETCH_TIMEOUT);
    const items=(Array.isArray(data.items)?data.items:[]).map(row=>({title:stripHtml(row&&row.title),url:text(row&&row.link),link:text(row&&row.link),summary:stripHtml(row&&row.description),snippet:stripHtml(row&&row.description),source:"naver_country_discovery",provider:"naver",type:"web",payload:{source:"naver",country:geo.country,query}})).filter(row=>row.title&&row.url);
    return{provider:"naver",query,status:items.length?"ok":"empty",items};
  }catch(error){return{provider:"naver",query,status:providerErrorCode(error),items:[]};}
}
async function runDirectProviderDiscovery(geo,targetLimit){
  const queries=discoveryQueries(geo);const tasks=[];const limit=Math.max(1,Math.min(50,Number(targetLimit||20)||20));
  function add(task){if(tasks.length<MAX_PROVIDER_CALLS)tasks.push(task);}
  if(geo.country==="KR"){
    add(naverCountrySearch(queries[0],geo,Math.min(20,limit)));
    add(googleCountrySearch(queries[0],geo,Math.min(10,limit)));
    if(limit>10){
      add(naverCountrySearch(queries[1]||queries[0],geo,Math.min(20,limit)));
      add(googleCountrySearch(queries[2]||queries[1]||queries[0],geo,Math.min(10,limit)));
    }
  }else{
    add(googleCountrySearch(queries[0],geo,Math.min(10,limit)));
    if(limit>10)add(googleCountrySearch(queries[1]||queries[0],geo,Math.min(10,limit)));
    if(limit>20)add(googleCountrySearch(queries[2]||queries[0],geo,Math.min(10,limit)));
  }
  if(!tasks.length)return{items:[],trace:[{source:"country-provider",status:"not_configured",count:0,timeoutMs:PROVIDER_FETCH_TIMEOUT}]};
  const settled=await Promise.all(tasks);
  return{items:settled.flatMap(row=>row.items||[]),trace:settled.map(row=>({source:row.provider,query:row.query,status:row.status,count:(row.items||[]).length,timeoutMs:PROVIDER_FETCH_TIMEOUT}))};
}
async function runSanmaruDiscovery(event,geo,targetLimit){
  let Sanmaru=null;try{Sanmaru=require("./sanmaru_engine_v2");}catch(_e){}
  const providerPromise=runDirectProviderDiscovery(geo,targetLimit);
  if(!Sanmaru||typeof Sanmaru.runEngine!=="function"){
    const provider=await providerPromise;
    return{items:provider.items,trace:[{source:"sanmaru",status:"unavailable",count:0}].concat(provider.trace)};
  }
  const tasks=discoveryQueries(geo).map(async q=>{
    try{
      const result=await withTimeout(Sanmaru.runEngine(event||{}, {
        q,query:q,country:geo.country,region:geo.region||undefined,limit:18,candidatePool:36,
        type:"site",external:"off",directExternal:"0",noExternal:"1",noMedia:"1",deep:"0",timeoutMs:Math.max(8000,DISCOVERY_TIMEOUT-1500),
        skipMaruSearch:"1",noMaruSearch:"1",skipCollector:"1",noCollector:"1",skipPlanetary:"1",noPlanetary:"1",
        from:"regional-brokerage-autoselector",source:"regional-brokerage-autoselector",
        regionalBrokerageSupply:"1",noAnalytics:"1",noRevenue:"1",readOnly:"1",noWrite:"1",noSync:"1",writeMode:"readonly"
      }),DISCOVERY_TIMEOUT);
      const items=extractItems(result);
      return {q,items,status:items.length?"ok":"empty"};
    }catch(e){return{q,items:[],status:providerErrorCode(e)};}
  });
  const [settled,provider]=await Promise.all([Promise.all(tasks),providerPromise]);
  return {items:settled.flatMap(x=>x.items||[]).concat(provider.items||[]),trace:settled.map(x=>({source:"sanmaru",query:x.q,status:x.status,count:(x.items||[]).length,timeoutMs:DISCOVERY_TIMEOUT})).concat(provider.trace||[])};
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
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),PAGE_CHECK_TIMEOUT);
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
function privateReviewPool(rawItems,inspectedItems,geo,limit){
  const inspected=new Map();
  for(const item of inspectedItems||[]){const url=Core.externalUrl(item);if(url)inspected.set(url,item);}
  const out=[];const seen=new Set();
  for(const raw of rawItems||[]){
    const url=Core.externalUrl(raw);if(!url||seen.has(url)||Core.isMarketplace(raw,url))continue;
    const item=inspected.get(url)||raw;
    const title=first(item&&item.title,item&&item.name,item&&item.label);if(!title)continue;
    const sourceText=lower([item&&item.source,item&&item.provider,item&&item.sourceType,item&&item.generatedBy].filter(Boolean).join(" "));
    if(/sanmaru-route|sanmaru-opening|provider-page-window|provider-window|search-route-hint/.test(sourceText))continue;
    seen.add(url);
    out.push(Object.assign({},item,{
      igdcPrivateReviewOnly:true,
      igdcCollectionStage:"country-discovery-unverified-market",
      igdcCollectionScope:{country:geo.country,region:geo.region||"NATIONWIDE",collectedAt:new Date().toISOString()},
      brokerageVerification:Object.assign({},item&&item.brokerageVerification||{},{privateQueueOnly:true,publicEligible:false})
    }));
    if(out.length>=limit)break;
  }
  return out;
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
  const requested=params||{};
  const explicitCountry=Core.normalizeCountry(requested.country||requested.targetCountry);
  const geo=explicitCountry?{country:explicitCountry,region:Core.normalizeRegion(requested.region||requested.targetRegion,explicitCountry),city:"",countryName:Core.COUNTRY_NAMES[explicitCountry]||explicitCountry}:Core.parseGeo(event,requested);
  const privateCollection=requested.privateCollection===true||String(requested.privateCollection||"").toLowerCase()==="true";
  const privateLimit=Math.max(1,Math.min(50,Number(requested.privateLimit||requested.maxCandidates||20)||20));
  const key=cacheKey(geo,privateCollection?"private":"front");const cached=getCache(key);if(cached)return Object.assign({},cached,{meta:Object.assign({},cached.meta||{},{cache:"hit"})});
  const started=Date.now();const stored=Core.loadStoredCandidates();let selected=Core.selection(stored.items,geo);let discovery={items:[],trace:[]},checked=[],privateReviewItems=[];
  if((privateCollection||selected.accepted.length<6)&&geo.country!=="GLOBAL"){
    discovery=await runSanmaruDiscovery(event,geo,privateLimit);
    checked=await inspectLive(discovery.items,geo);
    selected=Core.selection(stored.items.concat(checked),geo);
    if(privateCollection)privateReviewItems=privateReviewPool(discovery.items,checked,geo,privateLimit);
  }
  const template=templateSnapshot();const snapshot=selected.accepted.length&&template?Core.buildSnapshot(template,selected.accepted,geo,{storedSources:stored.sources,discovery:discovery.trace,stats:selected.stats,elapsedMs:Date.now()-started}):null;
  const result={status:"ok",engine:"regional-brokerage-autoselector",version:VERSION,geo:{country:geo.country,region:geo.region||null,precision:geo.region?"coarse-region":"country",source:explicitCountry?"explicit-scope":"request-ip"},items:selected.accepted.map(x=>x.item),privateReviewItems,snapshot,meta:{cache:"miss",selection:selected.stats,rejections:selected.rejected.slice(0,80),discovery:discovery.trace,privateReview:{enabled:privateCollection,raw:discovery.items.length,inspected:checked.length,count:privateReviewItems.length,publicPublication:false},elapsedMs:Date.now()-started,hasSnapshot:!!snapshot}};
  return setCache(key,result);
}

module.exports={VERSION,runSelection};
