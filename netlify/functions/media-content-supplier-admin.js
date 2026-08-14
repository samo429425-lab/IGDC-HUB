"use strict";

/**
 * IGDC Media Content Supplier Admin
 * Dedicated supplier registry for productions/distributors/content licensors.
 * This module never writes SearchBank or front snapshots directly.
 * Supplier research/collection only creates supplier candidates or media candidates;
 * front publication remains the existing administrator approval -> SearchBank pipeline.
 */
const MediaStore=require("./lib/media-candidate-store.v1");
const SharedAdminAuth=require("./lib/global-slot-console-auth");
const MaruSearch=require("./maru-search");

const VERSION="media-content-supplier-admin-v1.2.0-all-supplier-research-and-bulk-control";
const TABLE=process.env.MEDIA_CONTENT_SUPPLIER_TABLE||"media_content_suppliers";
const SUPPLIER_TYPES=new Set(["production","distributor","studio","rights_holder","agency","archive","other"]);
const STATUSES=new Set(["candidate","active","paused","archived"]);
const BLOCKED_CONSUMER_HOSTS=[
  "netflix.com","primevideo.com","amazon.com","disneyplus.com","hulu.com","max.com","hbomax.com",
  "youtube.com","youtu.be","tiktok.com","instagram.com","facebook.com","x.com","twitter.com",
  "vimeo.com","dailymotion.com","twitch.tv","apple.com","tv.apple.com"
];

function plain(v){return MediaStore.plain(v);}
function text(v){return MediaStore.text(v);}
function lower(v){return MediaStore.lower(v);}
function now(){return MediaStore.nowIso();}
function compact(v,n){return MediaStore.compact(v,n);}
function safeUrl(v){return MediaStore.normalizeUrl(v);}
function hostOf(v){return MediaStore.hostOf(v);}
function bool(v){return v===true||v==="true"||v===1||v==="1";}
function array(v){return MediaStore.array(v);}
function supplierId(name,url){return "supplier_"+MediaStore.shortHash({name:lower(name),host:hostOf(url)});}
function normalizeType(v){const x=lower(v);return SUPPLIER_TYPES.has(x)?x:"other";}
function normalizeStatus(v){const x=lower(v);return STATUSES.has(x)?x:"candidate";}
function blockedConsumerHost(host){host=lower(host).replace(/^www\./,"");return BLOCKED_CONSUMER_HOSTS.some((d)=>host===d||host.endsWith("."+d));}
function rest(query){return MediaStore.rest(TABLE,query||"");}
function encodeEq(v){return "eq."+encodeURIComponent(text(v));}

async function actorFor(event,write){
  const actor=await SharedAdminAuth.resolveUser(event);
  SharedAdminAuth.requireCapability(actor,write?"mediaEdit":"mediaRead");
  MediaStore.requireRole(actor,write?"write":"read");
  return actor;
}
async function selectSuppliers(query){return MediaStore.supabase(rest(query||"select=*&order=status.asc,name.asc&limit=1000"),{method:"GET",headers:{Prefer:"count=exact"}});}
async function upsertSuppliers(rows){
  if(!rows.length)return[];
  return MediaStore.supabase(rest("on_conflict=id"),{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(rows)});
}
async function patchSupplier(id,patch){return MediaStore.supabase(rest("id="+encodeEq(id)),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});}
async function deleteSupplier(id){return MediaStore.supabase(rest("id="+encodeEq(id)),{method:"DELETE",headers:{Prefer:"return=representation"}});}

function normalizeSupplier(input,actor,source){
  const row=plain(input),name=compact(row.name||row.title||row.provider||row.organization,200);
  const website=safeUrl(row.website_url||row.websiteUrl||row.url||row.source_url||row.sourceUrl||row.link);
  const host=hostOf(website);
  if(!name){const e=new Error("공급사 이름이 필요합니다.");e.statusCode=400;e.code="supplier_name_required";throw e;}
  if(!website){const e=new Error("공급사의 HTTPS 공식/대표 주소가 필요합니다.");e.statusCode=400;e.code="supplier_https_url_required";throw e;}
  if(blockedConsumerHost(host)){
    const e=new Error("소비자 스트리밍·SNS 플랫폼은 이 공급사 관리대상이 아닙니다: "+host);
    e.statusCode=409;e.code="consumer_platform_not_supplier_registry_target";throw e;
  }
  const stamp=now(),by=compact(actor&&actor.email||actor&&actor.memberId||"admin",200);
  return{
    id:text(row.id)||supplierId(name,website),name,website_url:website,website_host:host,
    supplier_type:normalizeType(row.supplier_type||row.supplierType||row.type),status:normalizeStatus(row.status),
    country:compact(row.country||row.region||"",80),contact_url:safeUrl(row.contact_url||row.contactUrl),
    search_terms:Array.from(new Set(array(row.search_terms||row.searchTerms||row.keywords).map((x)=>compact(x,120)).filter(Boolean))).slice(0,30),
    notes:compact(row.notes||row.note||"",1500),source_mode:compact(source||row.source_mode||row.sourceMode||"manual",80),
    raw:Object.assign({},plain(row.raw),{sourceRecord:row.sourceRecord||null,researchEvidence:row.researchEvidence||null}),
    updated_by:by,updated_at:stamp,created_by:compact(row.created_by||by,200),created_at:text(row.created_at)||stamp
  };
}
function publicSupplier(row){
  return{
    id:text(row.id),name:text(row.name),websiteUrl:text(row.website_url),websiteHost:text(row.website_host),
    supplierType:text(row.supplier_type),status:text(row.status),country:text(row.country),contactUrl:text(row.contact_url),
    searchTerms:Array.isArray(row.search_terms)?row.search_terms:[],notes:text(row.notes),sourceMode:text(row.source_mode),
    updatedAt:text(row.updated_at),createdAt:text(row.created_at),raw:plain(row.raw)
  };
}
function summary(rows){
  const result={total:rows.length,candidate:0,active:0,paused:0,archived:0,byType:{}};
  rows.forEach((row)=>{const st=normalizeStatus(row.status);result[st]=(result[st]||0)+1;const t=normalizeType(row.supplier_type);result.byType[t]=(result.byType[t]||0)+1;});
  return result;
}
function resultUrl(item){
  item=plain(item);
  const link=plain(item.link),entity=plain(item.entity),organization=plain(item.organization);
  return safeUrl(item.officialUrl||item.official_url||item.homepage||item.homepageUrl||item.website||item.websiteUrl||item.canonicalUrl||item.canonical_url||item.sourceUrl||item.source_url||item.pageUrl||item.href||item.url||link.url||link.href||entity.url||organization.url);
}
function resultName(item){
  item=plain(item);const entity=plain(item.entity),organization=plain(item.organization);
  return compact(organization.name||entity.name||item.company||item.organizationName||item.publisher||item.provider||item.sourceName||item.title||item.name,200);
}
function inferSupplierType(item,url,name){
  const raw=plain(item);
  const signal=[name,url,raw.title,raw.summary,raw.description,raw.publisher,raw.provider,raw.sourceName,raw.category,raw.type].filter(Boolean).join(" ").toLowerCase();
  if(/archive|film archive|audiovisual archive|cinematheque|cinémathèque|library collection/.test(signal))return"archive";
  if(/rights holder|rights management|licensor|licensing company|content rights|copyright owner/.test(signal))return"rights_holder";
  if(/international sales|sales agent|sales agency|world sales|sales company/.test(signal))return"agency";
  if(/content distributor|digital distribution|content distribution|distribution platform|aggregator/.test(signal))return"distributor";
  if(/distributor|distribution company|film distribution|television distribution|theatrical distribution|distribution/.test(signal))return"distributor";
  if(/studio|studios/.test(signal))return"studio";
  if(/production|productions|producer|production company|production house/.test(signal))return"production";
  if(/agency|agent|representation/.test(signal))return"agency";
  return"other";
}
function researchCandidates(items,actor,query){
  const seen=new Set(),out=[];
  for(const item of Array.isArray(items)?items:[]){
    const url=resultUrl(item),host=hostOf(url),name=resultName(item);
    if(!url||!host||!name||blockedConsumerHost(host)||seen.has(host))continue;
    seen.add(host);
    try{
      out.push(normalizeSupplier({name,websiteUrl:url,supplierType:"other",status:"candidate",searchTerms:[query],researchEvidence:{title:text(item.title),source:text(item.source||item.provider),url}},actor,"maru-search-research"));
    }catch(_e){}
    if(out.length>=80)break;
  }
  return out;
}
const SUPPLIER_RESEARCH_POLICY=Object.freeze({
  version:"media-supplier-research-policy-v1.2",
  targetTypes:["production","distributor","studio","rights_holder","agency","archive"],
  requiredSignals:["official organization identity","https official/representative website","production/distribution/licensing/rights/archive signal"],
  excludedKinds:["consumer streaming platform","social network","video sharing platform","retail marketplace"],
  queryLanes:[
    {type:"production",query:"film television documentary music production company official website"},
    {type:"production",query:"independent production company producer official website"},
    {type:"distributor",query:"film television distributor distribution company official website"},
    {type:"distributor",query:"digital content distributor aggregator audiovisual distribution official website"},
    {type:"studio",query:"film television animation studio official website"},
    {type:"rights_holder",query:"content licensor rights holder licensing company official website"},
    {type:"agency",query:"international film television sales agent world sales official website"},
    {type:"agency",query:"media rights agency talent content representation official website"},
    {type:"archive",query:"film audiovisual archive cinematheque licensing collection official website"},
    {type:"other",query:"documentary production distribution rights official website"},
    {type:"other",query:"music performance production distribution licensing official website"},
    {type:"other",query:"animation production distribution licensing official website"}
  ]
});
function supplierSignalScore(item,url,name){
  const raw=plain(item),host=hostOf(url);
  const textSignal=[name,raw.title,raw.summary,raw.description,raw.publisher,raw.provider,raw.sourceName,raw.organization&&raw.organization.name,raw.entity&&raw.entity.name,url].filter(Boolean).join(" ").toLowerCase();
  let score=0;
  if(host)score+=2;
  if(/production|productions|producer|studio|studios|distribut|sales agent|world sales|licens|rights holder|rights management|archive|cinematheque|aggregator|films|pictures|television|animation|documentary|media company|entertainment/.test(textSignal))score+=2;
  if(/official|company|corporation|corp\b|ltd\b|limited|inc\b|gmbh|sas\b|sarl\b|plc\b/.test(textSignal))score+=1;
  if(blockedConsumerHost(host))score=-100;
  return score;
}
function researchCandidatesStrict(items,actor,query,laneType){
  const seen=new Set(),out=[];
  for(const item of Array.isArray(items)?items:[]){
    const url=resultUrl(item),host=hostOf(url),name=resultName(item);
    if(!url||!host||!name||blockedConsumerHost(host)||seen.has(host))continue;
    const score=supplierSignalScore(item,url,name);
    if(score<3)continue;
    seen.add(host);
    try{
      const inferred=inferSupplierType(item,url,name);
      const supplierType=inferred!=="other"?inferred:(normalizeType(laneType)!=="other"?normalizeType(laneType):"other");
      out.push(normalizeSupplier({name,websiteUrl:url,supplierType,status:"candidate",searchTerms:[query],researchEvidence:{title:text(item.title),source:text(item.source||item.provider),url,score,inferredType:inferred,queryLaneType:laneType||null,policyVersion:SUPPLIER_RESEARCH_POLICY.version}},actor,"maru-search-research"));
    }catch(_e){}
    if(out.length>=120)break;
  }
  return out;
}
function buildSupplierResearchPlan(body){
  const custom=compact(body.query||"",500),country=compact(body.country||body.region||"",80),requestedType=normalizeType(body.supplierType||body.type||"other");
  const lanes=[];
  if(custom)lanes.push({type:requestedType,query:compact([country,custom,"official website"].filter(Boolean).join(" "),500)});
  for(const lane of SUPPLIER_RESEARCH_POLICY.queryLanes){
    if(body.mode!=="all"&&requestedType!=="other"&&lane.type!==requestedType)continue;
    lanes.push({type:lane.type,query:compact([country,lane.query].filter(Boolean).join(" "),500)});
  }
  const seen=new Set();
  return lanes.filter((lane)=>{const key=lane.type+"|"+lane.query;if(!lane.query||seen.has(key))return false;seen.add(key);return true;}).slice(0,16);
}
async function researchLane(lane,event,perLane){
  try{
    const result=await MaruSearch.runEngine(event||{}, {q:lane.query,limit:perLane,deep:true,external:"deep",useExternalSources:true,type:"all"});
    const items=Array.isArray(result&&result.items)?result.items:Array.isArray(result&&result.results)?result.results:[];
    return{lane,items,meta:{type:lane.type,query:lane.query,searched:items.length,ok:true,source:text(result&&result.source),servedFrom:text(result&&result.served_from),externalMode:result&&result.meta&&result.meta.externalMode||null}};
  }catch(error){
    return{lane,items:[],meta:{type:lane.type,query:lane.query,searched:0,ok:false,error:compact(error&&error.message||error,300)}};
  }
}
async function researchSuppliers(body,actor,event){
  const plan=buildSupplierResearchPlan(body);
  const limit=Math.max(10,Math.min(160,Number(body.limit)||80));
  const perLane=Math.max(8,Math.min(30,Math.ceil(limit/Math.max(1,plan.length))+6));
  const laneResults=[],allCandidates=[];
  for(let i=0;i<plan.length;i+=3){
    const group=await Promise.all(plan.slice(i,i+3).map((lane)=>researchLane(lane,event,perLane)));
    for(const result of group){
      laneResults.push(result.meta);
      allCandidates.push(...researchCandidatesStrict(result.items,actor,result.lane.query,result.lane.type));
    }
  }
  const byHost=new Map();
  for(const row of allCandidates){
    const host=lower(row.website_host);if(!host)continue;
    const existing=byHost.get(host);
    if(!existing){byHost.set(host,row);continue;}
    existing.search_terms=Array.from(new Set([...(existing.search_terms||[]),...(row.search_terms||[])])).slice(0,30);
    if(normalizeType(existing.supplier_type)==="other"&&normalizeType(row.supplier_type)!=="other")existing.supplier_type=row.supplier_type;
  }
  const candidates=Array.from(byHost.values()).slice(0,limit);
  const saved=candidates.length?await upsertSuppliers(candidates):[];
  const byType={};for(const row of candidates){const t=normalizeType(row.supplier_type);byType[t]=(byType[t]||0)+1;}
  return{
    policy:SUPPLIER_RESEARCH_POLICY,mode:body.mode==="all"?"all":"targeted",plan,laneResults,
    searched:laneResults.reduce((n,x)=>n+Number(x.searched||0),0),qualified:candidates.length,saved:Array.isArray(saved)?saved.length:0,byType,
    items:(Array.isArray(saved)?saved:candidates).map(publicSupplier)
  };
}
function matchesSupplier(item,supplier){
  const raw=plain(item),url=resultUrl(raw),host=hostOf(url),supplierHost=lower(supplier&&supplier.website_host).replace(/^www\./,"");
  if(host&&supplierHost&&(host===supplierHost||host.endsWith("."+supplierHost)))return true;
  const supplierName=lower(supplier&&supplier.name).replace(/[^a-z0-9가-힣]+/g," ").trim();
  if(!supplierName)return false;
  const signal=lower([raw.provider,raw.publisher,raw.organization&&raw.organization.name,raw.sourceName,raw.source,raw.title].filter(Boolean).join(" ")).replace(/[^a-z0-9가-힣]+/g," ");
  return signal.includes(supplierName);
}
function candidateFromSearch(item,supplier,section,actor){
  const raw=plain(item),media=plain(raw.media),link=plain(raw.link);
  const sourceUrl=safeUrl(raw.url||raw.sourceUrl||raw.pageUrl||link.url||supplier.website_url);
  const videoUrl=safeUrl(raw.videoUrl||raw.video_url||media.videoUrl||media.url||media.mp4||media.webm);
  const embedUrl=safeUrl(raw.embedUrl||raw.embed_url||media.embedUrl);
  const thumb=safeUrl(raw.thumbnail||raw.thumb||raw.image||media.poster||media.thumbnail);
  return MediaStore.normalizeCandidate({
    section_key:section,title:raw.title||raw.name,provider:supplier.name,source_url:sourceUrl,video_url:videoUrl,embed_url:embedUrl,thumb_url:thumb,
    rights_status:"web_verification_required",priority:"B2",sanmaru_query:"supplier:"+supplier.name,
    notes:"공급사 관리 페이지에서 자동 리서치된 후보. 관리자 권리·재생 검증 전에는 공개 금지.",
    supplierId:supplier.id,supplierName:supplier.name,supplierType:supplier.supplier_type,supplierWebsite:supplier.website_url,
    sourceMetadata:{supplierManaged:true,supplierId:supplier.id,supplierWebsite:supplier.website_url,searchResult:raw}
  },actor);
}
async function collectSupplierContents(body,actor,event){
  const id=text(body.id||body.supplierId),section=MediaStore.normalizeSection(body.section||body.sectionKey);
  if(!id){const e=new Error("공급사를 선택하세요.");e.statusCode=400;e.code="supplier_id_required";throw e;}
  if(!section){const e=new Error("콘텐츠를 보낼 미디어 섹션을 선택하세요.");e.statusCode=400;e.code="supplier_content_section_required";throw e;}
  const rows=await selectSuppliers("select=*&id="+encodeEq(id)+"&limit=1");
  const supplier=Array.isArray(rows)&&rows[0];
  if(!supplier){const e=new Error("공급사를 찾지 못했습니다.");e.statusCode=404;e.code="supplier_not_found";throw e;}
  if(normalizeStatus(supplier.status)!=="active"){const e=new Error("활성 공급사만 콘텐츠를 수집할 수 있습니다.");e.statusCode=409;e.code="supplier_not_active";throw e;}
  const terms=Array.isArray(supplier.search_terms)?supplier.search_terms:[];
  const query=compact(body.query||[supplier.name,supplier.website_host,terms.slice(0,4).join(" "),"video film series official"].filter(Boolean).join(" "),500);
  const limit=Math.max(5,Math.min(80,Number(body.limit)||30));
  const result=await MaruSearch.runEngine(event||{}, {q:query,limit,deep:true,external:"deep",useExternalSources:true,type:"all"});
  const items=Array.isArray(result&&result.items)?result.items:Array.isArray(result&&result.results)?result.results:[];
  const normalized=[];
  for(const item of items){
    if(!matchesSupplier(item,supplier))continue;
    try{
      const candidate=candidateFromSearch(item,supplier,section,actor),validation=MediaStore.validateCandidate(candidate);
      if(validation.ok)normalized.push(candidate);
    }catch(_e){}
    if(normalized.length>=limit)break;
  }
  const saved=normalized.length?await MediaStore.upsertCandidates(normalized):[];
  return{supplier:publicSupplier(supplier),section,query,searched:items.length,qualified:normalized.length,saved:Array.isArray(saved)?saved.length:0,candidateIds:(Array.isArray(saved)?saved:normalized).map((x)=>text(x.id))};
}
async function diagnostic(){
  const rows=await selectSuppliers("select=*&order=status.asc,name.asc&limit=5000");
  return{ok:true,reportType:"igdc-media-content-supplier-diagnostic",version:VERSION,generatedAt:now(),table:TABLE,summary:summary(rows),suppliers:rows.map(publicSupplier),researchPolicy:SUPPLIER_RESEARCH_POLICY,ai:{configured:!!text(process.env.OPENAI_API_KEY||process.env.OPENAI_KEY),note:"공급사 탐색은 Maru Search 다중 검색 + 미디어 전용 공급사 정책 검증을 기본으로 하며, 후보 공개 승인 권한은 갖지 않습니다."},rules:{consumerPlatformsExcluded:BLOCKED_CONSUMER_HOSTS,researchCreatesCandidatesOnly:true,contentCollectionCreatesMediaCandidatesOnly:true,directFrontPublish:false,searchBankDirectWrite:false}};
}

exports.handler=async function(event){
  if(event&&event.httpMethod==="OPTIONS")return MediaStore.response(204,{});
  try{
    if(!["GET","POST"].includes(event.httpMethod))return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const body=event.httpMethod==="POST"?MediaStore.parseBody(event):Object.assign({},event.queryStringParameters||{});
    const action=lower(body.action||"list"),write=event.httpMethod==="POST"&&action!=="diagnostic";
    const actor=await actorFor(event,write);
    if(action==="list"){
      const rows=await selectSuppliers("select=*&order=status.asc,name.asc&limit=2000");
      return MediaStore.response(200,{ok:true,version:VERSION,summary:summary(rows),suppliers:rows.map(publicSupplier)});
    }
    if(action==="diagnostic")return MediaStore.response(200,await diagnostic());
    if(action==="add"||action==="update"){
      const row=normalizeSupplier(body.supplier||body,actor,action==="add"?"manual":"manual-update");
      const saved=await upsertSuppliers([row]);
      return MediaStore.response(200,{ok:true,version:VERSION,action,updated:Array.isArray(saved)?saved.length:0,suppliers:(saved||[]).map(publicSupplier)});
    }
    if(action==="research")return MediaStore.response(200,Object.assign({ok:true,version:VERSION,action},await researchSuppliers(body,actor,event)));
    if(action==="collect_contents")return MediaStore.response(200,Object.assign({ok:true,version:VERSION,action},await collectSupplierContents(body,actor,event)));
    if(action==="bulk_status"){
      const ids=Array.from(new Set(array(body.ids).map(text).filter(Boolean))).slice(0,500);
      const requested=lower(body.status);
      const status=({active:"active",activate:"active",paused:"paused",pause:"paused",archived:"archived",archive:"archived",candidate:"candidate",restore:"candidate"})[requested];
      if(!ids.length)return MediaStore.response(400,{ok:false,error:"supplier_ids_required"});
      if(!status)return MediaStore.response(400,{ok:false,error:"supplier_bulk_status_invalid"});
      let updated=0;
      for(let i=0;i<ids.length;i+=25){
        const batch=ids.slice(i,i+25);
        const query="id=in.("+batch.map((id)=>encodeURIComponent(id)).join(",")+")";
        const saved=await MediaStore.supabase(rest(query),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status,updated_by:compact(actor.email||actor.memberId||"admin",200),updated_at:now()})});
        updated+=Array.isArray(saved)?saved.length:0;
      }
      return MediaStore.response(200,{ok:true,version:VERSION,action,status,requested:ids.length,updated});
    }
    if(["activate","pause","archive","restore"].includes(action)){
      const id=text(body.id||body.supplierId);if(!id)return MediaStore.response(400,{ok:false,error:"supplier_id_required"});
      const status={activate:"active",pause:"paused",archive:"archived",restore:"candidate"}[action];
      const saved=await patchSupplier(id,{status,updated_by:compact(actor.email||actor.memberId||"admin",200),updated_at:now()});
      return MediaStore.response(200,{ok:true,version:VERSION,action,updated:Array.isArray(saved)?saved.length:0,suppliers:(saved||[]).map(publicSupplier)});
    }
    if(action==="delete"){
      if(!bool(body.confirmDelete))return MediaStore.response(400,{ok:false,error:"supplier_delete_confirmation_required",message:"공급사 기록 완전 삭제 확인값이 필요합니다."});
      const removed=await deleteSupplier(body.id||body.supplierId);
      return MediaStore.response(200,{ok:true,version:VERSION,action,deleted:Array.isArray(removed)?removed.length:0});
    }
    return MediaStore.response(400,{ok:false,error:"supplier_action_invalid"});
  }catch(error){
    return MediaStore.response(error.statusCode||500,{ok:false,version:VERSION,error:error.code||"media_content_supplier_admin_failed",message:error.message||String(error)});
  }
};

exports._test={normalizeSupplier,researchCandidates,researchCandidatesStrict,buildSupplierResearchPlan,supplierSignalScore,inferSupplierType,resultUrl,resultName,blockedConsumerHost,summary,matchesSupplier,candidateFromSearch,SUPPLIER_RESEARCH_POLICY};
