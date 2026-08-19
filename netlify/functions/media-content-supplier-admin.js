"use strict";

/**
 * IGDC Media content-supplier registry + automatic public supplier research.
 *
 * Safety contract:
 * - Administrator only.
 * - Research results are stored as `candidate`; never auto-activated or published.
 * - Content collection creates media candidates only; it never grants rights or
 *   releases content to the front.
 * - Uses configured public-search APIs only. No credentials are returned.
 */
const crypto=require("crypto");
const SharedAdminAuth=require("./lib/global-slot-console-auth");
const MediaStore=require("./lib/media-candidate-store.v1");

const VERSION="media-content-supplier-admin-v1.0.1-research-candidate-safe";
const TABLE=MediaStore.text(process.env.MEDIA_CONTENT_SUPPLIER_TABLE)||"media_content_suppliers";
const TYPES=new Set(["production","distributor","studio","rights_holder","agency","archive","other"]);
const STATUSES=new Set(["candidate","active","paused","archived"]);
const TYPE_TERMS={
  production:["film production company","television production company","content production company"],
  distributor:["film distributor","television content distributor","international content distributor"],
  studio:["film studio","television studio","animation studio"],
  rights_holder:["film rights holder","television rights holder","content rights licensing company"],
  agency:["film international sales agency","content licensing agency","film sales company"],
  archive:["film archive","audiovisual archive","public media archive"],
  other:["film production distributor rights company","television content supplier"]
};
const REJECT_HOSTS=[
  "netflix.com","disneyplus.com","primevideo.com","amazon.com","tv.apple.com","youtube.com","youtu.be",
  "hulu.com","peacocktv.com","paramountplus.com","spotify.com","tiktok.com","instagram.com","facebook.com",
  "x.com","twitter.com","pinterest.com","reddit.com","tving.com","wavve.com","coupangplay.com"
];

function text(v){return MediaStore.text(v);}
function lower(v){return MediaStore.lower(v);}
function plain(v){return MediaStore.plain(v);}
function array(v){return MediaStore.array(v);}
function compact(v,n){return MediaStore.compact(v,n);}
function now(){return MediaStore.nowIso();}
function firstEnv(names){for(const name of names){const value=text(process.env[name]);if(value)return{name,value};}return{name:null,value:""};}
function hash(value){return crypto.createHash("sha256").update(text(value)).digest("hex").slice(0,20);}
function safeType(value){const type=lower(value);return TYPES.has(type)?type:"other";}
function safeStatus(value){const status=lower(value);return STATUSES.has(status)?status:"candidate";}
function safeHttps(value){try{const u=new URL(text(value));return u.protocol==="https:"?u.toString():"";}catch(_){return"";}}
function hostOf(value){try{return new URL(text(value)).hostname.toLowerCase().replace(/^www\./,"");}catch(_){return"";}}
function rejectHost(host){host=lower(host);return REJECT_HOSTS.some((blocked)=>host===blocked||host.endsWith("."+blocked));}
function cleanTitle(value){return compact(text(value).replace(/\s*[|–—-]\s*(official|home|website).*$/i,"").replace(/\s+/g," "),180);}
function stripHtml(value){return text(value).replace(/<[^>]*>/g," ").replace(/&(?:amp|quot|apos|lt|gt);/g," ").replace(/\s+/g," ").trim();}
function supplierId(host,name){return"media-supplier-"+hash(host||name);}
function actorName(actor){return compact(actor&&(actor.email||actor.memberId||actor.sub)||"admin",200);}

async function auth(event,write){
  const actor=await SharedAdminAuth.resolveUser(event);
  MediaStore.requireRole(actor,write?"write":"read");
  return actor;
}
function normalizeRow(row){
  row=plain(row);
  return{
    id:text(row.id),name:text(row.name),supplierType:safeType(row.supplier_type||row.supplierType),country:text(row.country),
    websiteUrl:text(row.website_url||row.websiteUrl),websiteHost:text(row.website_host||row.websiteHost),
    searchTerms:array(row.search_terms||row.searchTerms).map(text).filter(Boolean),notes:text(row.notes),status:safeStatus(row.status),
    source:text(row.source),research:plain(row.research),createdAt:text(row.created_at||row.createdAt),updatedAt:text(row.updated_at||row.updatedAt),
    createdBy:text(row.created_by||row.createdBy),updatedBy:text(row.updated_by||row.updatedBy)
  };
}
function dbRow(input,actor,source){
  const row=plain(input),name=compact(row.name,180),website=safeHttps(row.websiteUrl||row.website_url),host=hostOf(website);
  if(!name){const e=new Error("supplier_name_required");e.statusCode=400;e.code="supplier_name_required";throw e;}
  const t=now();
  return{
    id:text(row.id)||supplierId(host,name),name,supplier_type:safeType(row.supplierType||row.supplier_type),country:compact(row.country,100),
    website_url:website||null,website_host:host||null,search_terms:array(row.searchTerms||row.search_terms).map((v)=>compact(v,180)).filter(Boolean).slice(0,20),
    notes:compact(row.notes,1200),status:safeStatus(row.status),source:compact(source||row.source||"manual",80),research:plain(row.research),
    created_at:text(row.createdAt||row.created_at)||t,updated_at:t,created_by:text(row.createdBy||row.created_by)||actorName(actor),updated_by:actorName(actor)
  };
}
async function selectSuppliers(query){return MediaStore.supabase(MediaStore.rest(TABLE,query||"select=*&order=updated_at.desc&limit=1000"),{method:"GET",headers:{Prefer:"count=exact"}});}
async function upsertSuppliers(rows){if(!rows.length)return[];return MediaStore.supabase(MediaStore.rest(TABLE,"on_conflict=id"),{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(rows)});}
async function patchSuppliers(ids,patch){const list=[...new Set(array(ids).map(text).filter(Boolean))];if(!list.length)return[];return MediaStore.supabase(MediaStore.rest(TABLE,"id="+MediaStore.encodeIn(list)),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});}
async function deleteSuppliers(ids){const list=[...new Set(array(ids).map(text).filter(Boolean))];if(!list.length)return[];return MediaStore.supabase(MediaStore.rest(TABLE,"id="+MediaStore.encodeIn(list)),{method:"DELETE",headers:{Prefer:"return=representation"}});}

function searchConfig(){
  const googleKey=firstEnv(["GOOGLE_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_CUSTOM_SEARCH_API_KEY","GOOGLE_CLOUD_API_KEY"]);
  const googleCx=firstEnv(["GOOGLE_CSE_ID","GOOGLE_CX","GOOGLE_SEARCH_ENGINE_ID","GOOGLE_CUSTOM_SEARCH_ENGINE_ID","GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID"]);
  const bing=firstEnv(["BING_API_KEY","BING_SEARCH_API_KEY","AZURE_BING_SEARCH_API_KEY","AZURE_BING_SEARCH_KEY","BING_SUBSCRIPTION_KEY"]);
  const naverId=firstEnv(["NAVER_API_KEY","NAVER_CLIENT_ID","NAVER_SEARCH_CLIENT_ID","NAVER_OPENAPI_CLIENT_ID"]);
  const naverSecret=firstEnv(["NAVER_CLIENT_SECRET","NAVER_API_SECRET","NAVER_SEARCH_CLIENT_SECRET","NAVER_OPENAPI_CLIENT_SECRET"]);
  return{
    google:{ready:!!(googleKey.value&&googleCx.value),key:googleKey.value,cx:googleCx.value},
    bing:{ready:!!bing.value,key:bing.value},naver:{ready:!!(naverId.value&&naverSecret.value),id:naverId.value,secret:naverSecret.value}
  };
}
async function fetchJson(url,init,timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1500,Math.min(10000,Number(timeoutMs)||5500)));
  try{const res=await fetch(url,Object.assign({},init||{},{signal:controller.signal}));const raw=await res.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch(_){data=null;}if(!res.ok)throw new Error("search_http_"+res.status);return data||{};}finally{clearTimeout(timer);}
}
function extractGoogle(item){
  const page=plain(plain(item).pagemap),images=array(page.cse_image).concat(array(page.cse_thumbnail));
  return{title:cleanTitle(item&&item.title),url:safeHttps(item&&item.link),snippet:stripHtml(item&&item.snippet),thumbnail:safeHttps(images[0]&&images[0].src),source:"google_cse"};
}
function extractBing(item){return{title:cleanTitle(item&&item.name),url:safeHttps(item&&item.url),snippet:stripHtml(item&&item.snippet),thumbnail:"",source:"bing"};}
function extractNaver(item){return{title:cleanTitle(stripHtml(item&&item.title)),url:safeHttps(item&&(item.link||item.originallink)),snippet:stripHtml(item&&item.description),thumbnail:"",source:"naver"};}
async function searchGoogle(query,limit,cfg){if(!cfg.ready)return[];const u="https://www.googleapis.com/customsearch/v1?key="+encodeURIComponent(cfg.key)+"&cx="+encodeURIComponent(cfg.cx)+"&num="+Math.min(10,Math.max(1,limit))+"&q="+encodeURIComponent(query);const d=await fetchJson(u,{},6000);return array(d.items).map(extractGoogle).filter((x)=>x.url);}
async function searchBing(query,limit,cfg){if(!cfg.ready)return[];const u="https://api.bing.microsoft.com/v7.0/search?responseFilter=Webpages&count="+Math.min(25,Math.max(1,limit))+"&q="+encodeURIComponent(query);const d=await fetchJson(u,{headers:{"Ocp-Apim-Subscription-Key":cfg.key}},6000);return array(plain(d.webPages).value).map(extractBing).filter((x)=>x.url);}
async function searchNaver(query,limit,cfg){if(!cfg.ready)return[];const u="https://openapi.naver.com/v1/search/webkr.json?display="+Math.min(100,Math.max(1,limit))+"&query="+encodeURIComponent(query);const d=await fetchJson(u,{headers:{"X-Naver-Client-Id":cfg.id,"X-Naver-Client-Secret":cfg.secret}},6000);return array(d.items).map(extractNaver).filter((x)=>x.url);}

function keywordScore(type,title,snippet,host){
  const body=(title+" "+snippet+" "+host).toLowerCase();let score=0;
  const common=["production","producer","studio","distribut","rights","licens","sales","entertainment","media","film","television","tv","archive","animation"];
  common.forEach((word)=>{if(body.includes(word))score+=1;});
  const special={production:["production","producer"],distributor:["distribut"],studio:["studio"],rights_holder:["rights","licens"],agency:["sales","agency","licens"],archive:["archive","museum","library"]}[type]||[];
  special.forEach((word)=>{if(body.includes(word))score+=2;});
  if(/\.(org|co|com|net|tv|film)$/i.test(host))score+=1;
  return score;
}
function classifyType(candidate,fallback){
  const body=(text(candidate.title)+" "+text(candidate.snippet)).toLowerCase();
  if(/archive|film institute|cinemathe|library/.test(body))return"archive";
  if(/rights holder|rights management|licens/.test(body))return"rights_holder";
  if(/international sales|sales agency|sales company/.test(body))return"agency";
  if(/distribut/.test(body))return"distributor";
  if(/studio/.test(body))return"studio";
  if(/production|producer/.test(body))return"production";
  return safeType(fallback);
}
function qualify(candidate,laneType){
  const host=hostOf(candidate.url);if(!host||rejectHost(host))return null;
  const type=classifyType(candidate,laneType),score=keywordScore(type,text(candidate.title),text(candidate.snippet),host);
  if(score<2)return null;
  const name=cleanTitle(candidate.title)||host.split(".")[0];
  return Object.assign({},candidate,{host,name,supplierType:type,qualificationScore:score});
}
function laneQueries(mode,body){
  const country=compact(body.country,100),custom=compact(body.query,220),requested=safeType(body.supplierType);
  const types=mode==="all"?["production","distributor","studio","rights_holder","agency","archive"]:[requested];
  return types.map((type)=>{
    const term=custom||TYPE_TERMS[type][0];
    return{type,query:[country,term,"official"].filter(Boolean).join(" ")};
  });
}
async function runSearchLane(lane,limit,cfg){
  const jobs=[
    ["googleCse",cfg.google.ready,()=>searchGoogle(lane.query,Math.min(10,limit),cfg.google)],
    ["bing",cfg.bing.ready,()=>searchBing(lane.query,Math.min(15,limit),cfg.bing)],
    ["naver",cfg.naver.ready,()=>searchNaver(lane.query,Math.min(20,limit),cfg.naver)]
  ];
  const runs=await Promise.all(jobs.map(async([name,ready,fn])=>{
    if(!ready)return{source:name,configured:false,ok:false,count:0,items:[]};
    try{const items=await fn();return{source:name,configured:true,ok:true,count:items.length,items};}
    catch(error){return{source:name,configured:true,ok:false,count:0,error:text(error&&error.message),items:[]};}
  }));
  return{
    results:runs.flatMap((run)=>run.items||[]),
    sources:runs.map(({items,...source})=>source)
  };
}
async function research(body,actor){
  const mode=lower(body.mode)==="all"?"all":"targeted",limit=Math.max(1,Math.min(160,Number(body.limit)||60)),cfg=searchConfig(),lanes=laneQueries(mode,body);
  const discovered=[],laneResults=[];
  const laneLimit=Math.max(8,Math.ceil(limit/Math.max(1,lanes.length)));
  const laneRuns=await Promise.all(lanes.map(async(lane)=>({lane,run:await runSearchLane(lane,laneLimit,cfg)})));
  for(const entry of laneRuns){
    const lane=entry.lane,run=entry.run;
    discovered.push(...run.results.map((item)=>Object.assign({},item,{laneType:lane.type,laneQuery:lane.query})));
    laneResults.push({type:lane.type,query:lane.query,ok:run.sources.some((s)=>s.ok),searched:run.results.length,sources:run.sources});
  }
  const byHost=new Map();
  discovered.forEach((item)=>{const q=qualify(item,item.laneType);if(!q)return;const old=byHost.get(q.host);if(!old||q.qualificationScore>old.qualificationScore)byHost.set(q.host,q);});
  const qualified=Array.from(byHost.values()).sort((a,b)=>b.qualificationScore-a.qualificationScore).slice(0,limit);
  const rows=qualified.map((q)=>dbRow({
    id:supplierId(q.host,q.name),name:q.name,supplierType:q.supplierType,country:compact(body.country,100),websiteUrl:q.url,
    searchTerms:[q.laneQuery],status:"candidate",notes:"자동 공급사 리서치 후보. 활성화 전 운영자 확인 필요.",
    research:{version:VERSION,query:q.laneQuery,searchSource:q.source,snippet:compact(q.snippet,700),qualificationScore:q.qualificationScore,researchedAt:now()}
  },actor,"automatic_public_search"));
  const saved=rows.length?await upsertSuppliers(rows):[];
  const byType={};rows.forEach((r)=>{byType[r.supplier_type]=(byType[r.supplier_type]||0)+1;});
  const searchSources={
    googleCse:{configured:cfg.google.ready},
    naver:{configured:cfg.naver.ready},
    bing:{configured:cfg.bing.ready}
  };
  const configured=Object.values(searchSources).filter((source)=>source.configured===true).length;
  const diagnosis=!configured?"public_search_api_not_configured":qualified.length?"candidate_suppliers_saved":discovered.length?"no_qualified_supplier":"all_research_lanes_returned_zero_results";
  return{mode,laneResults,searched:discovered.length,qualified:qualified.length,saved:Array.isArray(saved)?saved.length:rows.length,byType,searchSources,diagnosis};
}

function youtubeThumb(url){const m=text(url).match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,20})/i);return m?"https://i.ytimg.com/vi/"+encodeURIComponent(m[1])+"/hqdefault.jpg":"";}
function playablePublicResult(item){const u=text(item&&item.url);return /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/|vimeo\.com\/|archive\.org\/|\.(?:mp4|webm|m4v)(?:[?#]|$))/i.test(u);}
async function collectContents(body,actor){
  const id=text(body.id),section=MediaStore.normalizeSection(body.section)||"media-movie",limit=Math.max(1,Math.min(50,Number(body.limit)||30));
  const rows=await selectSuppliers("select=*&id="+MediaStore.encodeEq(id)+"&limit=1"),supplier=normalizeRow(rows&&rows[0]);
  if(!supplier.id){const e=new Error("supplier_not_found");e.statusCode=404;e.code="supplier_not_found";throw e;}
  const cfg=searchConfig(),host=supplier.websiteHost||hostOf(supplier.websiteUrl),query=[supplier.name,"official video film drama series",host].filter(Boolean).join(" ");
  const lane=await runSearchLane({type:supplier.supplierType,query},limit,cfg),usable=lane.results.filter(playablePublicResult).slice(0,limit);
  const candidates=[];
  usable.forEach((item)=>{
    const thumb=safeHttps(item.thumbnail)||youtubeThumb(item.url);
    const raw={
      id:"supplier-media-"+hash(supplier.id+"|"+item.url),title:item.title||supplier.name,provider:supplier.name,source_url:item.url,video_url:/\.(mp4|webm|m4v)(?:[?#]|$)/i.test(item.url)?item.url:"",thumb_url:thumb,
      section_key:section,review_status:"pending",verification_status:"web_verification_required",rights_status:"candidate_only",allowed_use:"verification_required",candidate_only:true,seed_content:true,
      notes:"공급사 자동 리서치에서 수집한 공개 후보. 재생·권리·공급 관계를 운영자가 확인한 뒤 승인해야 합니다.",
      raw:{supplierResearch:{supplierId:supplier.id,supplierName:supplier.name,supplierWebsite:supplier.websiteUrl,searchQuery:query,searchSource:item.source,collectedAt:now()},sourceMetadata:{requestedSection:section,thumbnailCandidate:thumb}}
    };
    const normalized=MediaStore.normalizeCandidate(raw,actor),valid=MediaStore.validateCandidate(normalized);if(valid.ok)candidates.push(normalized);
  });
  const saved=candidates.length?await MediaStore.upsertCandidates(candidates):[];
  return{supplier,query,searched:lane.results.length,qualified:usable.length,saved:Array.isArray(saved)?saved.length:candidates.length,items:(saved||candidates).map((r)=>({id:text(r.id),title:text(r.title),sectionKey:text(r.section_key),thumb:text(r.thumb_url)})),searchSources:lane.sources,publication:"candidate_only"};
}

async function listAction(){const rows=await selectSuppliers("select=*&order=updated_at.desc&limit=1000");return{suppliers:array(rows).map(normalizeRow)};}
async function diagnostic(){
  const rows=array(await selectSuppliers("select=*&order=updated_at.desc&limit=1000")),cfg=searchConfig(),summary={total:rows.length,active:0,candidate:0,paused:0,archived:0,byType:{}};
  rows.forEach((row)=>{const status=safeStatus(row.status),type=safeType(row.supplier_type);summary[status]=(summary[status]||0)+1;summary.byType[type]=(summary.byType[type]||0)+1;});
  return{summary,searchSources:{googleCse:{configured:cfg.google.ready},naver:{configured:cfg.naver.ready},bing:{configured:cfg.bing.ready}},table:TABLE,policy:{researchSaveStatus:"candidate",contentCollection:"candidate_only",autoPublish:false}};
}

exports.handler=async function(event){
  if(event&&event.httpMethod==="OPTIONS")return MediaStore.response(204,{});
  try{
    const method=text(event&&event.httpMethod||"GET").toUpperCase(),body=method==="POST"?MediaStore.parseBody(event):{};
    const query=event&&event.queryStringParameters||{};const action=lower(body.action||query.action||"list");
    const write=method!=="GET";const actor=await auth(event,write);
    if(method==="GET"){
      if(action==="diagnostic")return MediaStore.response(200,Object.assign({ok:true,version:VERSION},await diagnostic()));
      return MediaStore.response(200,Object.assign({ok:true,version:VERSION},await listAction()));
    }
    if(method!=="POST")return MediaStore.response(405,{ok:false,version:VERSION,error:"method_not_allowed"});
    if(action==="add"){
      const saved=await upsertSuppliers([dbRow(body.supplier,actor,"manual")]);
      return MediaStore.response(200,{ok:true,version:VERSION,saved:Array.isArray(saved)?saved.length:1,suppliers:array(saved).map(normalizeRow)});
    }
    if(action==="research")return MediaStore.response(200,Object.assign({ok:true,version:VERSION},await research(body,actor)));
    if(action==="collect_contents")return MediaStore.response(200,Object.assign({ok:true,version:VERSION},await collectContents(body,actor)));
    if(action==="bulk_status"){
      const status=safeStatus(body.status),ids=array(body.ids).map(text).filter(Boolean);const saved=await patchSuppliers(ids,{status,updated_at:now(),updated_by:actorName(actor)});
      return MediaStore.response(200,{ok:true,version:VERSION,updated:array(saved).length,status});
    }
    if(["activate","pause","archive","restore"].includes(action)){
      const id=text(body.id);if(!id)return MediaStore.response(400,{ok:false,version:VERSION,error:"supplier_id_required"});
      const status={activate:"active",pause:"paused",archive:"archived",restore:"candidate"}[action];const saved=await patchSuppliers([id],{status,updated_at:now(),updated_by:actorName(actor)});
      return MediaStore.response(200,{ok:true,version:VERSION,updated:array(saved).length,supplier:normalizeRow(saved&&saved[0])});
    }
    if(action==="delete"){
      if(body.confirmDelete!==true)return MediaStore.response(400,{ok:false,version:VERSION,error:"supplier_delete_confirmation_required"});
      const deleted=await deleteSuppliers([text(body.id)]);return MediaStore.response(200,{ok:true,version:VERSION,deleted:array(deleted).length});
    }
    return MediaStore.response(400,{ok:false,version:VERSION,error:"invalid_action"});
  }catch(error){return MediaStore.response(error.statusCode||500,{ok:false,version:VERSION,error:error.code||"media_supplier_admin_failed",message:text(error&&error.message||error)});}
};
