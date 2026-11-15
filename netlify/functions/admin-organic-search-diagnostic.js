"use strict";
/* IGDC / MARU administrator-only, read-only organic search diagnostics.
   Never submits indexing requests, changes rankings, or reads secrets into output. */
const AdminSession=require("./lib/global-slot-console-auth");
const {buildRegistry}=require("./lib/search-exposure/registry");
const ENGINE=require("./global-search-exposure-engine");
const ORIGIN="https://igdcglobal.com";
const PLAY="https://play.google.com/store/apps/details?id=com.maru.mediaplayer";
const VERSION="igdc-maru-organic-search-admin-diagnostic-v1.0.0";
const CHECKS=[
 ["platform-home","IGDC Global Platform","/home.html","platform"],
 ["platform-en","IGDC Global Platform (English)","/igdc-amplify-platform-en.html","platform"],
 ["platform-zh","IGDC Global Platform (Chinese)","/igdc-amplify-platform-zh.html","platform"],
 ["maru-windows","MARU Media Player Windows","/maru-download.html","maru"],
 ["maru-android","MARU Media Player Android","/maru-android.html","maru"],
 ["maru-en","MARU Media Player (English)","/igdc-amplify-maru-en.html","maru"],
 ["maru-ar","MARU Media Player (Arabic)","/igdc-amplify-maru-ar.html","maru"],
 ["robots","Search crawler access","/robots.txt","technical"],
 ["sitemap","Search sitemap","/sitemap.xml","technical"],
 ["dynamic-sitemap","Verified search sitemap","/sitemap-global.xml","technical"]
];
const json=(statusCode,body)=>({statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","x-robots-tag":"noindex, nofollow"},body:JSON.stringify(body)});
function simpleError(e){return String(e&&e.message||e||"Unknown failure").slice(0,130);}
function urlFor(path){return ORIGIN+path;}
function cleanText(html){
 return String(html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
}
async function probe(id,label,path,group){
 const url=urlFor(path),started=Date.now();
 try{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),4500);
  let response,body="";
  try{
   response=await fetch(url,{method:"GET",headers:{"accept":"text/html,application/xml,text/plain;q=0.8","user-agent":"IGDC-ReadOnly-Diagnostic/1.0"},redirect:"follow",signal:controller.signal,cache:"no-store"});
   if(response.body&&typeof response.body.getReader==="function"){
    const reader=response.body.getReader();let chunks=0;
    while(chunks<100000){
     const part=await reader.read();if(part.done)break;
     body+=new TextDecoder().decode(part.value,{stream:true});
     chunks+=part.value.length;
    }
    if(chunks>=100000)await reader.cancel().catch(()=>{});
   }else body=(await response.text()).slice(0,100000);
  }finally{clearTimeout(timeout);}
  const statusCode=response.status,ctype=String(response.headers.get("content-type")||"").toLowerCase();
  const html=/\.html$/i.test(path),xml=/\.xml$/i.test(path),robots=path==="/robots.txt";
  const title=(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";
  const canonical=(body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)||[])[1]||"";
  const hasNoindex=html&&(/<meta[^>]+(?:name=["']robots["'][^>]+content=["'][^"']*noindex|content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots)/i.test(body)||/noindex/i.test(String(response.headers.get("x-robots-tag")||"")));
  const correctType=html?ctype.includes("html"):(xml?ctype.includes("xml"):(robots?ctype.includes("text"):true));
  const hasMarker=html?/<html\b/i.test(body):(xml?/<(?:urlset|sitemapindex)\b/i.test(body):(robots?/user-agent:/i.test(body):true));
  const pageHasPlay=body.includes("play.google.com/store/apps/details?id=com.maru.mediaplayer");
  const status=response.ok&&correctType&&hasMarker&&!hasNoindex?"reachable":"needs-review";
  return{id,label,group,url,status,httpStatus:statusCode,elapsedMs:Date.now()-started,
   contentType:ctype.split(";")[0],title:cleanText(title).slice(0,120)||null,canonical:canonical||null,
   hasNoindex,hasPlayLink:html?pageHasPlay:null,htmlOrSitemapRecognized:hasMarker,
   checks:{httpOk:response.ok,contentTypeOk:correctType,markerPresent:hasMarker,indexableHint:!hasNoindex},
   note:!response.ok?"The origin returned a non-success status":!correctType||!hasMarker?"Unexpected response content":hasNoindex?"Noindex signal detected":"Reachability is not proof of search ranking"};
 }catch(e){
  return{id,label,group,url,status:"unverified",httpStatus:null,elapsedMs:Date.now()-started,error:simpleError(e),
   note:"Live probe inconclusive; hosting, network policy, or timeout may be responsible"};
 }
}
async function indexNowKeyCheck(){
 const key=String(process.env.INDEXNOW_KEY||"").trim();
 if(!key)return{configured:false,verification:"not-configured",reason:"INDEXNOW_KEY is not configured"};
 if(!/^[a-zA-Z0-9-]{8,128}$/.test(key))return{configured:true,verification:"invalid-format"};
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3500);
  let resp,body="";
  try{resp=await fetch(ORIGIN+"/"+encodeURIComponent(key)+".txt",{method:"GET",signal:controller.signal,cache:"no-store"});body=(await resp.text()).slice(0,300);}
  finally{clearTimeout(timer);}
  return{configured:true,verification:resp.ok&&body.trim()===key?"confirmed":"not-confirmed",httpStatus:resp.status};
 }catch(e){return{configured:true,verification:"unverified",error:simpleError(e)};}
}
function channels(indexnow){
 const enabled=Boolean(indexnow.configured),verified=indexnow.verification==="confirmed";
 const configuredBaidu=Boolean(process.env.BAIDU_SITE_TOKEN);
 return[
  {name:"Google",method:"sitemap + Search Console",configured:true,submissionVerified:false,rankObserved:false,note:"Google indexation, impressions and rank require Search Console"},
  {name:"Bing",method:"IndexNow + sitemap",configured:enabled,keyVerified:verified,submissionVerified:false,rankObserved:false,note:"IndexNow receipt is not search ranking"},
  {name:"Naver",method:"Naver IndexNow + sitemap",configured:enabled,keyVerified:verified,submissionVerified:false,rankObserved:false,note:"Search Advisor registration and indexing are separately verified"},
  {name:"Daum",method:"crawler / site registration",configured:null,submissionVerified:false,rankObserved:false,note:"External site-owner registration cannot be inferred"},
  {name:"Yahoo",method:"crawler / Bing ecosystem",configured:null,submissionVerified:false,rankObserved:false,note:"No independent direct submission assumed"},
  {name:"Baidu",method:"verified site token + Baidu API",configured:configuredBaidu,submissionVerified:false,rankObserved:false,note:"Requires Baidu webmaster account and submitted-URL evidence"},
  {name:"Yandex",method:"sitemap / webmaster",configured:null,submissionVerified:false,rankObserved:false,note:"Webmaster ownership and indexing unverified"},
  {name:"DuckDuckGo",method:"crawler discovery",configured:null,submissionVerified:false,rankObserved:false,note:"No universal search-ranking submission API"},
  {name:"Google Play",method:"Play Console store performance",configured:true,submissionVerified:null,rankObserved:false,note:"Store search visits, clicks and terms require Play Console export"},
  {name:"Bilibili",method:"content platform, not generic web engine",configured:null,submissionVerified:null,rankObserved:false,note:"Platform search requires an authorized published content presence"}
 ];
}
async function diagnostic(){
 const now=new Date().toISOString();
 const [probes,key]=await Promise.all([Promise.all(CHECKS.map(row=>probe(...row))),indexNowKeyCheck()]);
 let registry;
 try{
  const r=buildRegistry();
  const selected=(r.targets||[]).filter(x=>["maru-android","maru-windows","home"].includes(x.id)).map(x=>({id:x.id,url:x.url,updatedAt:x.updatedAt||null}));
  registry={available:true,version:r.version,hash:r.hash,counts:r.counts||{},total:r.targets.length,selected};
 }catch(e){registry={available:false,error:simpleError(e)};}
 const failed=probes.filter(x=>x.status==="needs-review");
 const unknown=probes.filter(x=>x.status==="unverified");
 const pageStatus=failed.length?"needs-review":unknown.length?"incomplete":"reachable-checks-passed";
 return{schema:VERSION,generatedAt:now,readOnly:true,
  purpose:"IGDC Global Platform and MARU Media Player organic search health and evidence",
  scope:["IGDC Global Platform","MARU Windows","MARU Android / Google Play"],
  overview:{status:pageStatus,probesTotal:probes.length,reachable:probes.filter(x=>x.status==="reachable").length,needsReview:failed.length,unverified:unknown.length},
  engine:{moduleLoaded:typeof ENGINE.run==="function",configuredDailySchedule:"17 3 * * * (UTC; repository config, not live Netlify confirmation)",lastScheduledExecution:null,lastSubmissionReceipt:null,notes:"Netlify run logs or persisted receipts are not connected. This diagnostic never invokes search submission."},
  registry,robotsAndSitemaps:probes.filter(x=>x.group==="technical"),
  targets:probes.filter(x=>x.group!=="technical"),
  indexNowKey:indexnowSafe(key),
  channels:channels(key),
  googlePlay:{packageName:"com.maru.mediaplayer",listingUrl:PLAY,listingLinkPresent:probes.some(x=>x.id==="maru-android"&&x.hasPlayLink===true),searchVisits:null,storeClicks:null,ctr:null,searchTerms:null,rank:null,source:"Play Console export required"},
  searchPerformance:{webSearchImpressions:null,webSearchClicks:null,averagePosition:null,source:"Search Console / webmaster exports required"},
  guidance:["Confirmed crawlability is not proof of indexing or ranking","Google Play ranking cannot be inferred from website URLs","Use authorized Console CSV reports for real traffic and search-term results","No automatic clicks, fabricated searches, forced submissions or writes occur"]
 };
}
function indexnowSafe(key){return{configured:key.configured,verification:key.verification,httpStatus:key.httpStatus||null,reason:key.reason||null,error:key.error||null};}
exports.handler=async(event)=>{
 if(String(event&&event.httpMethod||"GET").toUpperCase()!=="GET")return json(405,{ok:false,error:"Read-only GET only"});
 try{
  const actor=await AdminSession.resolveUser(event),cap=AdminSession.capability(actor);
  if(!(cap&& (cap.read||cap.mediaRead||cap.owner)))return json(403,{ok:false,error:"Administrator read capability required"});
  return json(200,{ok:true,report:await diagnostic()});
 }catch(e){const status=[401,403,503].includes(Number(e&&e.statusCode))?e.statusCode:500;return json(status,{ok:false,error:status===500?"Diagnostic unavailable":simpleError(e),code:e&&e.code||null});}
};
exports._test={diagnostic,probe,indexNowKeyCheck,channels};
