"use strict";

/**
 * Administrator-only interface for the private commerce candidate staging
 * queue.  It never publishes a Snapshot and it never opens the release key.
 * Direct member listings may be submitted/reviewed here, but must still pass
 * registry sync, market evidence and Canonical validation during a later build.
 */

const fs = require("fs");
const path = require("path");
const CommerceIntake = require("./lib/commerce-candidate-intake.v1");
const AdminSession = require("./lib/global-slot-console-auth");
const SlotStore = require("./lib/global-slot-console-supabase");
const MarketSaleScope = require("./lib/market-sale-scope.v1");
const ProductPipeline = require("./lib/commerce-product-pipeline-state.v1");

const VERSION = "commerce-candidate-review-api-v1.10.0-3000-ledger";
const READ_ROLES = new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager"]);
const APPROVE_ROLES = new Set(["owner","admin","site_manager","site_manager_director","director"]);
const SUBMIT_ROLES = new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager","commerce_member"]);
const SLOT_KEYS = Object.freeze({
  home:new Set(["home_1","home_2","home_3","home_4","home_5","home_right_top","home_right_middle","home_right_bottom"]),
  distribution:new Set(["distribution-recommend","distribution-sponsor","distribution-trending","distribution-new","distribution-special","distribution-others","distribution-right"]),
  network:new Set(["network-right"]),
  social:new Set(["rightPanel"]),
  tour:new Set(["tour"])
});
const SLOT_EVIDENCE_RULES = Object.freeze({
  "distribution-trending":["trend","market_demand","verified_demand"],
  "distribution-new":["newness","new_listing","new_product"],
  "distribution-special":["certification","producer_special","special_product"],
  "home_right_bottom":["newness","new_listing","new_product"],
  "tour":["travel_operator","operator_license","tourism_license"]
});

function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase().replace(/\s+/g,"_");}
function bool(v){return v===true||["1","true","yes","on","approved","verified","active","enabled","ready"].includes(lower(v));}
function isObject(v){return !!v&&typeof v==="object"&&!Array.isArray(v);}
function plain(v){return isObject(v)?v:{};}
function safeUrl(v){try{const u=new URL(text(v));return u.protocol==="https:"?u.toString():"";}catch(_e){return "";}}
// Read-only management projections do not need PostgREST exact row counts.
// Avoiding Prefer: count=exact keeps large global ledgers from doing a second
// full count scan for every paged/scoped admin request.
async function lightSelect(table,query){return SlotStore.request(SlotStore.rest(table,query),{method:"GET"});}
function json(statusCode, body){return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"GET,POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)};}
function parse(event){try{return event&&event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body):{};}catch(_e){const err=new Error("요청 JSON 형식이 올바르지 않습니다.");err.statusCode=400;throw err;}}
function roles(member){return Array.from(new Set((member&&member.roles||[]).map(lower).filter(Boolean)));}
function requireRole(member, scope){
  const values=roles(member);
  const allowed=scope==="approve"?APPROVE_ROLES:(scope==="submit"?SUBMIT_ROLES:READ_ROLES);
  if(!values.some(role=>allowed.has(role))){
    const err=new Error(scope==="approve"?"커머스 상품 승인 권한이 없습니다.":(scope==="submit"?"커머스 회원 또는 관리자 권한이 필요합니다.":"커머스 후보 대기열은 관리자/운영진 권한에서만 볼 수 있습니다."));
    err.statusCode=403;throw err;
  }
  return values;
}
async function resolveCurrentAdmin(event){
  // Reuse the exact server-side Auth0/JWKS + role resolver used by the existing
  // administrator console.  This queue has no separate login realm.
  const actor=await AdminSession.resolveUser(event);
  return {memberId:text(actor&&actor.sub),email:text(actor&&actor.email),name:text(actor&&actor.name),roles:Array.isArray(actor&&actor.roles)?actor.roles:[]};
}
async function liveProductResearchQueue(){
  try{
    const rows=await SlotStore.select("gslot_candidates","select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at&source_ref=eq."+encodeURIComponent(ProductPipeline.SOURCE_REF)+"&order=updated_at.desc&limit=2500");
    const candidates=Array.isArray(rows)?rows:[];
    if(!candidates.length)return {ok:true,rows:[],storageError:null};
    const ids=new Set(candidates.map((row)=>text(row&&row.id)).filter(Boolean));
    const settled=await Promise.allSettled([
      SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,updated_at&order=updated_at.desc&limit=10000"),
      SlotStore.select("gslot_candidate_availability","select=candidate_id,country_code,region_code,availability_state,legal_basis,delivery_or_access,updated_at&order=updated_at.desc&limit=10000"),
      SlotStore.select("gslot_candidate_revenue","select=id,candidate_id,revenue_type,status,affiliate_url,provider_name,currency,note,updated_at&order=updated_at.desc&limit=10000"),
      SlotStore.select("gslot_candidate_evidence","select=id,candidate_id,evidence_type,evidence_url,note,verified,created_at&order=created_at.desc&limit=10000")
    ]);
    const relationRows=settled.map((result)=>result.status==="fulfilled"&&Array.isArray(result.value)?result.value:[]);
    const grouped={assignments:new Map(),markets:new Map(),revenues:new Map(),evidence:new Map()};
    function add(map,row){const id=text(row&&row.candidate_id);if(!ids.has(id))return;if(!map.has(id))map.set(id,[]);map.get(id).push(row);}
    relationRows[0].forEach((row)=>add(grouped.assignments,row));
    relationRows[1].forEach((row)=>add(grouped.markets,row));
    relationRows[2].forEach((row)=>add(grouped.revenues,row));
    relationRows[3].forEach((row)=>add(grouped.evidence,row));
    const output=candidates.map((candidate)=>{
      const id=text(candidate&&candidate.id);
      return ProductPipeline.liveQueueRow(candidate,{
        assignments:grouped.assignments.get(id)||[],markets:grouped.markets.get(id)||[],revenues:grouped.revenues.get(id)||[],evidence:grouped.evidence.get(id)||[]
      });
    });
    const relationErrors=settled.map((result,index)=>result.status==="rejected"?{source:["assignments","markets","revenues","evidence"][index],message:text(result.reason&&result.reason.message||result.reason)}:null).filter(Boolean);
    return {ok:relationErrors.length===0,rows:output,storageError:null,relationErrors};
  }catch(error){return {ok:false,rows:[],storageError:text(error&&error.message||error),relationErrors:[]};}
}

function scopedRegionValues(country,regionInput){
  const region=normalizeRegion(regionInput||"NATIONWIDE",country)||"NATIONWIDE";
  return region==="NATIONWIDE"?["NATIONWIDE"]:[region,"NATIONWIDE"];
}
function candidateScopeQuery(basePath,country,region,limit){
  const countryPath=basePath+"->>country",regionPath=basePath+"->>region";
  return "select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at"+
    "&source_ref=eq."+encodeURIComponent(ProductPipeline.SOURCE_REF)+
    "&source_payload->"+countryPath+"=eq."+encodeURIComponent(country)+
    "&source_payload->"+regionPath+"=eq."+encodeURIComponent(region)+
    "&order=updated_at.desc&limit="+Math.max(1,Number(limit)||600);
}
function marketScopeQuery(country,region,limit){
  return "select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at"+
    "&source_ref=eq."+encodeURIComponent(ProductPipeline.SOURCE_REF)+
    "&source_payload->marketScope->>marketCountry=eq."+encodeURIComponent(country)+
    "&source_payload->marketScope->>marketRegion=eq."+encodeURIComponent(region)+
    "&order=updated_at.desc&limit="+Math.max(1,Number(limit)||600);
}
async function fallbackPagedScopeRows(country,region,maxRows){
  const out=[],seen=new Set(),pageSize=150,maxPages=20;
  for(let offset=0,page=0;page<maxPages&&out.length<maxRows;page+=1,offset+=pageSize){
    const rows=await lightSelect("gslot_candidates","select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at&source_ref=eq."+encodeURIComponent(ProductPipeline.SOURCE_REF)+"&order=updated_at.desc&limit="+pageSize+"&offset="+offset);
    const pageRows=Array.isArray(rows)?rows:[];
    for(const row of pageRows){
      const id=text(row&&row.id);if(!id||seen.has(id))continue;
      const payload=plain(row&&row.source_payload);if(!scopeMatch(payload,country,region).matched)continue;
      seen.add(id);out.push(row);if(out.length>=maxRows)break;
    }
    if(pageRows.length<pageSize)break;
  }
  return out;
}
async function scopedProductCandidateRows(countryInput,regionInput,limitInput){
  const country=normalizeCountry(countryInput),region=normalizeRegion(regionInput||"NATIONWIDE",country)||"NATIONWIDE";
  const limit=Math.max(50,Math.min(3000,Number(limitInput)||3000));
  if(!country||country==="GLOBAL")return [];
  const seen=new Map(),regions=scopedRegionValues(country,region);
  // Current product candidates always carry marketScope. Older rows may only
  // carry countrySupply/placement, so use those only when the primary projection
  // did not fill the requested management page.
  const specs=["marketScope","countrySupply","placement"];
  let queryFailed=false;
  for(const spec of specs){
    for(const regionValue of regions){
      if(seen.size>=limit)break;
      try{
        const query=spec==="marketScope"?marketScopeQuery(country,regionValue,limit):candidateScopeQuery(spec,country,regionValue,limit);
        const rows=await lightSelect("gslot_candidates",query);
        for(const row of Array.isArray(rows)?rows:[]){
          const id=text(row&&row.id);if(!id||seen.has(id))continue;
          if(!scopeMatch(plain(row&&row.source_payload),country,region).matched)continue;
          seen.set(id,row);if(seen.size>=limit)break;
        }
      }catch(_error){queryFailed=true;}
    }
    if(seen.size>=limit)break;
  }
  if(!seen.size&&queryFailed){
    try{for(const row of await fallbackPagedScopeRows(country,region,limit)){const id=text(row&&row.id);if(id&&!seen.has(id))seen.set(id,row);}}catch(_fallbackError){}
  }
  return Array.from(seen.values()).sort((a,b)=>text(b&&b.updated_at).localeCompare(text(a&&a.updated_at))).slice(0,limit);
}
function candidateIdBatches(ids,size){const out=[];for(let i=0;i<ids.length;i+=size)out.push(ids.slice(i,i+size));return out;}
async function scopedRelationRows(table,fields,ids,order){
  const rows=[],errors=[];
  for(const batch of candidateIdBatches(ids,100)){
    if(!batch.length)continue;
    const encoded="("+batch.map((id)=>encodeURIComponent(id)).join(",")+")";
    try{
      const found=await lightSelect(table,"select="+fields+"&candidate_id=in."+encoded+(order?"&order="+order:"")+"&limit=2500");
      rows.push(...(Array.isArray(found)?found:[]));
    }catch(error){errors.push(text(error&&error.message||error));}
  }
  return {rows,errors};
}
async function scopedLiveProductResearchQueue(country,region,limit){
  try{
    const candidates=await scopedProductCandidateRows(country,region,limit);
    if(!candidates.length)return {ok:true,rows:[],storageError:null,relationErrors:[]};
    const ids=candidates.map((row)=>text(row&&row.id)).filter(Boolean),settled=await Promise.all([
      scopedRelationRows("gslot_slot_assignments","id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,updated_at",ids,"updated_at.desc"),
      scopedRelationRows("gslot_candidate_availability","candidate_id,country_code,region_code,availability_state,legal_basis,delivery_or_access,updated_at",ids,"updated_at.desc"),
      scopedRelationRows("gslot_candidate_revenue","id,candidate_id,revenue_type,status,affiliate_url,provider_name,currency,note,updated_at",ids,"updated_at.desc"),
      scopedRelationRows("gslot_candidate_evidence","id,candidate_id,evidence_type,evidence_url,note,verified,created_at",ids,"created_at.desc")
    ]);
    const grouped={assignments:new Map(),markets:new Map(),revenues:new Map(),evidence:new Map()};
    function add(map,row){const id=text(row&&row.candidate_id);if(!id)return;if(!map.has(id))map.set(id,[]);map.get(id).push(row);}
    settled[0].rows.forEach((row)=>add(grouped.assignments,row));settled[1].rows.forEach((row)=>add(grouped.markets,row));settled[2].rows.forEach((row)=>add(grouped.revenues,row));settled[3].rows.forEach((row)=>add(grouped.evidence,row));
    const output=candidates.map((candidate)=>{const id=text(candidate&&candidate.id);return ProductPipeline.liveQueueRow(candidate,{assignments:grouped.assignments.get(id)||[],markets:grouped.markets.get(id)||[],revenues:grouped.revenues.get(id)||[],evidence:grouped.evidence.get(id)||[]});});
    const names=["assignments","markets","revenues","evidence"],relationErrors=[];settled.forEach((result,index)=>result.errors.forEach((message)=>relationErrors.push({source:names[index],message})));
    return {ok:relationErrors.length===0,rows:output,storageError:null,relationErrors};
  }catch(error){return {ok:false,rows:[],storageError:text(error&&error.message||error),relationErrors:[]};}
}
async function scopedStage(root,country,region){
  const stored=CommerceIntake.readStage(root)||{schema:"commerce-candidate-staging.snapshot.v1",summary:{considered:0},candidates:[]};
  const storedScoped=filteredStage(stored,country,region),live=await scopedLiveProductResearchQueue(country,region,3000),merged=new Map();
  for(const row of Array.isArray(storedScoped.candidates)?storedScoped.candidates:[])merged.set(text(row&&row.candidateId),row);
  for(const row of live.rows||[])merged.set(text(row&&row.candidateId),row);
  const candidates=Array.from(merged.values()).filter(Boolean),eligible=candidates.filter((row)=>row&&row.releaseEligible===true).length,registrySyncReady=candidates.filter((row)=>text(row&&row.stageStatus)==="registry_sync_ready"||text(row&&row.lifecycle&&row.lifecycle.stage)==="registry_sync_ready").length;
  const liveIds=new Set((live.rows||[]).map((row)=>text(row&&row.candidateId)).filter(Boolean)),storedRows=Array.isArray(storedScoped.candidates)?storedScoped.candidates:[],liveOnly=candidates.filter((row)=>liveIds.has(text(row&&row.candidateId))&&!storedRows.some((item)=>text(item&&item.candidateId)===text(row&&row.candidateId))).length;
  const base=Object.assign({},storedScoped,{candidates,summary:Object.assign({},plain(storedScoped.summary),{considered:candidates.length,eligibleForRelease:eligible,held:candidates.length-eligible,registrySyncReady,goLiveAuditCandidates:registrySyncReady+eligible,liveResearchQueue:live.rows.length,liveResearchQueueOnly:liveOnly,stagedReleaseQueue:storedRows.length}),source:Object.assign({},plain(storedScoped.source),{liveResearchQueueCount:live.rows.length,liveResearchQueueOnlyCount:liveOnly,stagedReleaseQueueCount:storedRows.length,liveQueueStorageAvailable:live.storageError?false:true,liveQueueStorageError:live.storageError||null}),pipeline:{version:ProductPipeline.VERSION,livePrivateResearchQueue:true,privateStagingSnapshot:true,automaticPublication:false,paymentExecution:false,relationErrors:live.relationErrors||[]}});
  return filteredStage(base,country,region);
}

async function stage(root){
  const stored=CommerceIntake.readStage(root)||{schema:"commerce-candidate-staging.snapshot.v1",summary:{considered:0},candidates:[]};
  const live=await liveProductResearchQueue();
  const stagedRows=Array.isArray(stored.candidates)?stored.candidates:[];
  const merged=new Map();
  for(const row of stagedRows)merged.set(text(row&&row.candidateId),row);
  for(const row of live.rows||[])merged.set(text(row&&row.candidateId),row);
  const candidates=Array.from(merged.values()).filter(Boolean);
  const eligible=candidates.filter((row)=>row&&row.releaseEligible===true).length;
  const registrySyncReady=candidates.filter((row)=>text(row&&row.stageStatus)==="registry_sync_ready"||text(row&&row.lifecycle&&row.lifecycle.stage)==="registry_sync_ready").length;
  const liveIds=new Set((live.rows||[]).map((row)=>text(row&&row.candidateId)).filter(Boolean));
  const liveOnly=candidates.filter((row)=>liveIds.has(text(row&&row.candidateId))&&!stagedRows.some((item)=>text(item&&item.candidateId)===text(row&&row.candidateId))).length;
  return Object.assign({},stored,{
    generatedAt:stored.generatedAt||new Date().toISOString(),
    candidates,
    summary:Object.assign({},plain(stored.summary),{considered:candidates.length,eligibleForRelease:eligible,held:candidates.length-eligible,registrySyncReady,goLiveAuditCandidates:registrySyncReady+eligible,liveResearchQueue:live.rows.length,liveResearchQueueOnly:liveOnly,stagedReleaseQueue:stagedRows.length}),
    source:Object.assign({},plain(stored.source),{liveResearchQueueCount:live.rows.length,liveResearchQueueOnlyCount:liveOnly,stagedReleaseQueueCount:stagedRows.length,liveQueueStorageAvailable:live.storageError?false:true,liveQueueStorageError:live.storageError||null}),
    pipeline:{version:ProductPipeline.VERSION,livePrivateResearchQueue:true,privateStagingSnapshot:true,automaticPublication:false,paymentExecution:false,relationErrors:live.relationErrors||[]}
  });
}
function summaryDoc(doc){return {version:VERSION,stageVersion:doc.version||null,generatedAt:doc.generatedAt||null,releaseGate:doc.releaseGate||null,summary:doc.summary||{},pipeline:doc.pipeline||{},candidateCount:Array.isArray(doc.candidates)?doc.candidates.length:0};}
function pageMap(hub){const h=lower(hub);return ({home:"home",distribution:"distribution",network:"network",tour:"tour",social:"social"})[h]||"";}

function normalizeCountry(value){return MarketSaleScope.normalizeCountry(value);}
function normalizeRegion(value,country){return MarketSaleScope.normalizeRegion(value,country);}
function unique(values){return Array.from(new Set((Array.isArray(values)?values:[]).filter(Boolean)));}
function candidateScopes(row){
  const scopes=[];
  function add(countryInput,regionInput){
    const country=normalizeCountry(countryInput);if(!country||country==="GLOBAL")return;
    const region=normalizeRegion(regionInput||"NATIONWIDE",country)||"NATIONWIDE";
    scopes.push({country,region});
  }
  for(const key of Array.isArray(row&&row.marketKeys)?row.marketKeys:[]){
    const value=text(key).toUpperCase();const match=value.match(/^([A-Z]{2})-(.+)$/);if(match)add(match[1],match[2]);
  }
  const placement=plain(row&&row.placement);add(placement.country,placement.region);
  const marketScope=plain(row&&row.marketScope);add(marketScope.marketCountry,marketScope.marketRegion);
  const supply=plain(row&&row.countrySupply);
  const countries=[];
  for(const value of [supply.country,supply.countryCode,supply.targetMarket,row&&row.targetCountry,row&&row.countryCode]){
    const country=normalizeCountry(value);if(country)countries.push(country);
  }
  const regions=[];
  for(const value of [supply.region,supply.regionCode,supply.targetRegion,row&&row.targetRegion])if(text(value))regions.push(value);
  for(const country of countries){
    if(regions.length)for(const region of regions)add(country,region);else add(country,"NATIONWIDE");
  }
  const seen=new Set();return scopes.filter(scope=>{const key=scope.country+"|"+scope.region;if(seen.has(key))return false;seen.add(key);return true;});
}
function scopeMatch(row,countryInput,regionInput){
  const rawCountry=text(countryInput).toUpperCase();const country=normalizeCountry(rawCountry);const requested=text(regionInput).toUpperCase();
  const allScopes=candidateScopes(row);
  if(rawCountry==="UNSCOPED")return {matched:allScopes.length===0,mode:"unscoped",country:"UNSCOPED",region:"ALL"};
  if(rawCountry==="UNRESOLVED")return {matched:false,mode:"unresolved_geo",country:"",region:""};
  if(rawCountry==="GLOBAL")return {matched:true,mode:"all",country:"",region:"ALL"};
  if(!country)return {matched:false,mode:rawCountry?"invalid_country":"unresolved_geo",country:"",region:""};
  const scopes=allScopes.filter(scope=>scope.country===country);
  if(!scopes.length)return {matched:false,mode:"none",country,region:requested||"ALL"};
  if(!requested||requested==="ALL")return {matched:true,mode:"country",country,region:"ALL"};
  const region=normalizeRegion(requested,country)||"NATIONWIDE";
  if(region==="NATIONWIDE")return {matched:scopes.some(scope=>scope.region==="NATIONWIDE"),mode:"nationwide",country,region};
  if(scopes.some(scope=>scope.region===region))return {matched:true,mode:"exact_region",country,region};
  if(scopes.some(scope=>scope.region==="NATIONWIDE"))return {matched:true,mode:"nationwide_fallback",country,region};
  return {matched:false,mode:"none",country,region};
}
function filteredStage(doc,countryInput,regionInput){
  const rawCountry=text(countryInput).toUpperCase();const country=(rawCountry==="UNSCOPED"||rawCountry==="UNRESOLVED"||rawCountry==="GLOBAL")?rawCountry:normalizeCountry(rawCountry);const region=text(regionInput).toUpperCase()||"ALL";
  const source=doc||{};const input=Array.isArray(source.candidates)?source.candidates:[];
  const candidates=input.map(row=>{const match=scopeMatch(row,country,region);return match.matched?Object.assign({},row,{scopeMatch:match}):null;}).filter(Boolean);
  const released=candidates.filter(row=>/released|published/i.test(text(row&&row.stageStatus))).length;
  const eligible=candidates.filter(row=>row&&row.releaseEligible===true).length;
  const registrySyncReady=candidates.filter((row)=>text(row&&row.stageStatus)==="registry_sync_ready"||text(row&&row.lifecycle&&row.lifecycle.stage)==="registry_sync_ready").length;
  const publicationRequested=candidates.filter((row)=>text(row&&row.lifecycle&&row.lifecycle.assignment&&row.lifecycle.assignment.publicationStatus)==="publish_requested").length;
  const liveRows=candidates.filter((row)=>text(row&&row.pipelineSource)==="live_product_research_db");
  const liveResearchQueue=liveRows.length;
  const stagedReleaseQueue=candidates.length-liveResearchQueue;
  const researchPromotionEligible=liveRows.filter((row)=>plain(row&&row.researchReadiness).promotionEligible===true).length;
  const researchNeedsCompletion=liveRows.filter((row)=>plain(row&&row.researchReadiness).queueEligible===true&&plain(row&&row.researchReadiness).promotionEligible!==true).length;
  const proposedSectionCandidates=liveRows.filter((row)=>Array.isArray(row&&row.proposedPlacements)&&row.proposedPlacements.length>0).length;
  const proposedSectionCounts={};
  for(const row of liveRows){for(const placement of Array.isArray(row&&row.proposedPlacements)?row.proposedPlacements:[]){const key=text(placement&&placement.page)+":"+text(placement&&(placement.sectionKey||placement.section));if(key!==":")proposedSectionCounts[key]=(proposedSectionCounts[key]||0)+1;}}
  return Object.assign({},source,{
    selectedScope:{country:(country==="UNRESOLVED"?null:(country==="GLOBAL"?null:(country||null))),region:(country==="UNRESOLVED"?null:(country==="GLOBAL"?"ALL":(country?(region||"ALL"):"ALL"))),source:country==="UNRESOLVED"?"unresolved-ip":(country==="GLOBAL"?"administrator-global":"selected-or-ip"),fallback:country==="UNRESOLVED"?"empty":"exact-region-then-nationwide-within-same-country",crossCountry:false},
    candidates,
    summary:Object.assign({},plain(source.summary),{considered:candidates.length,eligibleForRelease:eligible,releasedToCanonical:released,held:candidates.length-eligible,registrySyncReady,goLiveAuditCandidates:registrySyncReady+eligible,publicationRequested,liveResearchQueue,stagedReleaseQueue,researchPromotionEligible,researchNeedsCompletion,proposedSectionCandidates,proposedSectionCounts}),
    source:Object.assign({},plain(source.source),{liveResearchQueueCount:liveResearchQueue,stagedReleaseQueueCount:stagedReleaseQueue})
  });
}
function safeRows(result){return result&&result.status==="fulfilled"&&Array.isArray(result.value)?result.value:[];}

let REGISTRY_CACHE=null;
function readJsonCandidates(names){
  for(const name of names){
    for(const file of [path.join(process.cwd(),"data",name),path.join(__dirname,"..","..","data",name),path.join(__dirname,"data",name)]){
      try{if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_e){}
    }
  }
  return null;
}
function countryRegistry(){
  if(REGISTRY_CACHE)return REGISTRY_CACHE;
  const countries=readJsonCandidates(["country-region-registry.v1.json"])||{regions:[],countries:[],policy:{}};
  const subdivisions=readJsonCandidates(["country-subdivision-registry.v1.json"])||{countries:[]};
  const subdivisionMap=new Map();
  for(const row of Array.isArray(subdivisions.countries)?subdivisions.countries:[]){
    const code=normalizeCountry(row&&row.countryCode);if(!code)continue;
    subdivisionMap.set(code,(Array.isArray(row.subdivisions)?row.subdivisions:[]).map((item)=>({
      code:normalizeRegion(item&&item.code,code),isoCode:text(item&&item.isoCode),nameKo:text(item&&item.nameKo)||text(item&&item.nameEn)||text(item&&item.code),nameEn:text(item&&item.nameEn)||text(item&&item.nameKo)||text(item&&item.code),type:text(item&&item.type)||text(row&&row.subdivisionType)
    })).filter((item)=>item.code));
  }
  REGISTRY_CACHE={
    schema:text(countries.schema),version:text(countries.version),policy:plain(countries.policy),
    regions:Array.isArray(countries.regions)?countries.regions:[],
    countries:(Array.isArray(countries.countries)?countries.countries:[]).filter((row)=>normalizeCountry(row&&row.code)&&normalizeCountry(row&&row.code)!=="KP"),
    subdivisionMap
  };
  return REGISTRY_CACHE;
}
async function locationStatus(doc){
  const registry=countryRegistry();
  const allowedCountryCodes=new Set(registry.countries.map((row)=>normalizeCountry(row&&row.code)).filter(Boolean));
  const settled=await Promise.allSettled([
    lightSelect("gslot_countries","select=code,name,region_code,enabled,legal_source_id,updated_at&order=code.asc&limit=1000"),
    lightSelect("gslot_candidate_availability","select=candidate_id,country_code,region_code,availability_state,updated_at&order=updated_at.desc&limit=5000"),
    lightSelect("gslot_slot_assignments","select=candidate_id,country_code,region_code,state,publication_status,manual_pinned,updated_at&order=updated_at.desc&limit=5000")
  ]);
  const countryRows=safeRows(settled[0]),availability=safeRows(settled[1]),assignments=safeRows(settled[2]);
  const map=new Map();
  function ensure(codeInput,seed){
    const code=normalizeCountry(codeInput);if(!code||code==="KP"||!allowedCountryCodes.has(code))return null;
    if(!map.has(code))map.set(code,{code,nameKo:code,nameEn:code,worldRegion:null,enabled:true,requiresSubdivision:false,subdivisionType:null,subdivisions:[],observedRegions:new Set(),candidateIds:new Set(),eligibleIds:new Set(),heldIds:new Set(),availabilityIds:new Set(),assignmentIds:new Set(),manualPinnedIds:new Set(),lastUpdated:""});
    const entry=map.get(code),src=plain(seed);
    if(text(src.nameKo))entry.nameKo=text(src.nameKo);if(text(src.nameEn))entry.nameEn=text(src.nameEn);
    if(text(src.name)&&entry.nameKo===code)entry.nameKo=text(src.name);
    if(text(src.regionGroup||src.worldRegion||src.region_code))entry.worldRegion=text(src.regionGroup||src.worldRegion||src.region_code);
    if(src.enabled===false)entry.enabled=false;
    if(src.requiresSubdivision===true)entry.requiresSubdivision=true;
    if(text(src.subdivisionType))entry.subdivisionType=text(src.subdivisionType);
    return entry;
  }
  function touch(entry,stamp){const value=text(stamp);if(entry&&value&&value>entry.lastUpdated)entry.lastUpdated=value;}
  for(const row of registry.countries){
    const entry=ensure(row.code,row);
    if(entry){entry.subdivisions=(registry.subdivisionMap.get(entry.code)||[]).slice();}
  }
  for(const row of countryRows){const entry=ensure(row.code,{nameKo:row.name,nameEn:row.name,regionGroup:row.region_code,enabled:row.enabled});touch(entry,row.updated_at);}
  for(const row of Array.isArray(doc&&doc.candidates)?doc.candidates:[]){
    const id=text(row&&row.candidateId)||text(row&&row.id)||"unknown";
    for(const scope of candidateScopes(row)){const entry=ensure(scope.country,{});if(!entry)continue;entry.candidateIds.add(id);if(row&&row.releaseEligible===true)entry.eligibleIds.add(id);else entry.heldIds.add(id);if(scope.region&&scope.region!=="NATIONWIDE")entry.observedRegions.add(scope.region);}
  }
  for(const row of availability){const entry=ensure(row.country_code,{});if(!entry)continue;entry.availabilityIds.add(text(row.candidate_id));const region=normalizeRegion(row.region_code||"NATIONWIDE",entry.code);if(region&&region!=="NATIONWIDE")entry.observedRegions.add(region);touch(entry,row.updated_at);}
  for(const row of assignments){const entry=ensure(row.country_code,{});if(!entry)continue;entry.assignmentIds.add(text(row.candidate_id));if(row.manual_pinned===true)entry.manualPinnedIds.add(text(row.candidate_id));const region=normalizeRegion(row.region_code||"NATIONWIDE",entry.code);if(region&&region!=="NATIONWIDE")entry.observedRegions.add(region);touch(entry,row.updated_at);}
  const unscoped=(Array.isArray(doc&&doc.candidates)?doc.candidates:[]).filter((row)=>candidateScopes(row).length===0);
  const countries=Array.from(map.values()).map((entry)=>({
    code:entry.code,name:entry.nameKo,nameKo:entry.nameKo,nameEn:entry.nameEn,worldRegion:entry.worldRegion,enabled:entry.enabled,requiresSubdivision:entry.requiresSubdivision,subdivisionType:entry.subdivisionType,
    candidateCount:new Set(Array.from(entry.candidateIds).concat(Array.from(entry.availabilityIds),Array.from(entry.assignmentIds))).size,releaseEligible:entry.eligibleIds.size,held:entry.heldIds.size,availabilityCount:entry.availabilityIds.size,assignmentCount:entry.assignmentIds.size,manualPinnedCount:entry.manualPinnedIds.size,
    regions:Array.from(new Set(entry.subdivisions.map((row)=>row.code).concat(Array.from(entry.observedRegions)))).sort(),subdivisions:entry.subdivisions,lastUpdated:entry.lastUpdated||null,
    aiState:"inherit",status:entry.candidateIds.size?"candidate_data":((entry.availabilityIds.size||entry.assignmentIds.size)?"registry_only":"ready_empty")
  })).sort((a,b)=>{const ao=(registry.regions.find((r)=>r.id===a.worldRegion)||{}).order||999;const bo=(registry.regions.find((r)=>r.id===b.worldRegion)||{}).order||999;return ao-bo||a.nameKo.localeCompare(b.nameKo,"ko")||a.code.localeCompare(b.code);});
  if(unscoped.length)countries.unshift({code:"UNSCOPED",name:"국가 미지정 후보",nameKo:"국가 미지정 후보",nameEn:"Unscoped candidates",worldRegion:null,enabled:true,requiresSubdivision:false,candidateCount:unscoped.length,releaseEligible:unscoped.filter((row)=>row&&row.releaseEligible===true).length,held:unscoped.filter((row)=>row&&row.releaseEligible!==true).length,availabilityCount:0,assignmentCount:0,manualPinnedCount:0,regions:[],subdivisions:[],lastUpdated:null,aiState:"manual",status:"unscoped_requires_assignment"});
  return {ok:true,version:VERSION,mode:"country-region-ip-control",registry:{schema:registry.schema,version:registry.version,countryCount:countries.filter((row)=>row.code!=="UNSCOPED").length,regions:registry.regions,excludedCountryCodes:["KP"]},countries,database:{countriesAvailable:settled[0].status==="fulfilled",availabilityAvailable:settled[1].status==="fulfilled",assignmentsAvailable:settled[2].status==="fulfilled"},policy:{countryRequired:true,regionOptional:true,regionFallback:"same-country-nationwide",crossCountryFallback:false,unresolvedGeo:"empty",unscopedCandidates:"hold-until-country-assigned",manualPinnedPrecedence:true}};
}

function readGeoObject(value){
  const raw=text(value);if(!raw)return {};
  for(const candidate of [raw,(()=>{try{return decodeURIComponent(raw);}catch(_e){return "";}})()]){try{const parsed=JSON.parse(candidate);if(isObject(parsed))return parsed;}catch(_e){}}
  return {};
}
function geoProbe(event){
  const headers={};for(const [key,value] of Object.entries(event&&event.headers||{}))headers[String(key).toLowerCase()]=value;
  const geo=Object.assign({},plain(event&&event.geo),readGeoObject(headers["x-nf-geo"]));const countryObject=plain(geo.country);const subdivision=plain(geo.subdivision);
  const rawDetected=text(first(countryObject.code,countryObject.alpha2,typeof geo.country==="string"?geo.country:"",geo.countryCode,geo.country_code,headers["cf-ipcountry"],headers["x-country"],headers["x-vercel-ip-country"],headers["x-nf-country"])).toUpperCase();
  const detected=normalizeCountry(rawDetected);const excluded=detected==="KP";
  const registry=countryRegistry();const row=!excluded&&registry.countries.find((item)=>normalizeCountry(item&&item.code)===detected);const country=row?detected:"";
  const region=country?normalizeRegion(first(subdivision.code,subdivision.iso_code,typeof geo.subdivision==="string"?geo.subdivision:"",geo.subdivisionCode,geo.regionCode,geo.stateCode,geo.provinceCode,geo.region,geo.state,headers["x-region"],headers["x-nf-subdivision"],headers["x-nf-region"],headers["x-vercel-ip-country-region"]),country):"";
  return {ok:true,version:VERSION,country:country||null,region:region||null,worldRegion:row&&row.regionGroup||null,resolved:!!country,excluded,detectedCountry:detected||rawDetected||null,scope:country+(region?"-"+region:""),policy:{exactRegionFirst:true,nationwideFallbackWithinSameCountry:true,crossCountryFallback:false,unresolvedGeo:"empty",excludedCountryCodes:["KP"]}};
}

function countBy(rows, selector){
  const out={};
  for(const row of Array.isArray(rows)?rows:[]){
    const key=text(selector(row))||"unknown";
    out[key]=(out[key]||0)+1;
  }
  return Object.keys(out).sort().reduce((result,key)=>{result[key]=out[key];return result;},{});
}
function topReasons(rows){
  const out={};
  for(const row of Array.isArray(rows)?rows:[]){
    for(const reason of Array.isArray(row&&row.reasons)?row.reasons:[]){
      const key=text(reason);if(key)out[key]=(out[key]||0)+1;
    }
  }
  return Object.entries(out).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,80).map(([reason,count])=>({reason,count}));
}
function candidateDigestRows(rows){
  return (Array.isArray(rows)?rows:[]).slice(0,500).map((row)=>({
    candidateId:text(row&&row.candidateId), title:text(row&&row.title), sourceTier:text(row&&row.sourceTier), origin:text(row&&row.origin),
    stageStatus:text(row&&row.stageStatus), releaseEligible:row&&row.releaseEligible===true,
    productCard:{title:text(row&&row.productCard&&row.productCard.title),priceDisplay:text(row&&row.productCard&&row.productCard.priceDisplay),supplierName:text(row&&row.productCard&&row.productCard.supplierName),checkoutMode:text(row&&row.productCard&&row.productCard.checkoutMode)},
    placement:plain(row&&row.placement), proposedPlacements:Array.isArray(row&&row.proposedPlacements)?row.proposedPlacements.slice(0,20):[], researchReadiness:plain(row&&row.researchReadiness), marketKeys:Array.isArray(row&&row.marketKeys)?row.marketKeys.slice(0,30):[],
    revenue:{type:text(row&&row.revenue&&row.revenue.type),monetizationState:text(row&&row.revenue&&row.revenue.monetizationState),contractId:text(row&&row.revenue&&row.revenue.contractId)},
    review:{state:text(row&&row.review&&row.review.state),nextGate:text(row&&row.review&&row.review.nextGate)}, reasons:Array.isArray(row&&row.reasons)?row.reasons.slice(0,30):[]
  }));
}
function diagnosticDoc(doc, member){
  const stage=doc||{};
  const candidates=Array.isArray(stage.candidates)?stage.candidates:[];
  const summary=plain(stage.summary);
  const gate=plain(stage.releaseGate);
  const source=plain(stage.source);
  const affiliate=plain(stage.affiliateRegistry);
  const held=candidates.filter((row)=>row&&row.releaseEligible!==true);
  const releaseReady=candidates.filter((row)=>row&&row.releaseEligible===true);
  const blockers=[];
  const liveResearchCount=Number(source.liveResearchQueueCount||summary.liveResearchQueue||0);
  const stagedReleaseCount=Number(source.stagedReleaseQueueCount||summary.stagedReleaseQueue||0);
  if(Number(source.searchBankCount||summary.receivedSearchBank||0)===0&&liveResearchCount===0)blockers.push("no_searchbank_or_product_research_candidate");
  if(candidates.length===0)blockers.push("private_queue_empty");
  else if(liveResearchCount>0&&stagedReleaseCount===0)blockers.push("awaiting_administrator_evidence_revenue_and_assignment");
  if(gate.enabled!==true)blockers.push(text(gate.reason)||"release_gate_disabled");
  if(source.reviewQueueStale===true)blockers.push("admin_review_queue_stale");
  if(affiliate.ok===false)blockers.push("affiliate_registry_invalid");
  return {
    ok:true,
    reportType:"igdc-commerce-candidate-queue-diagnostic",
    version:VERSION,
    generatedAt:new Date().toISOString(),
    mode:gate.enabled===true?"private-review-release-gate-armed":"pre-product-private-review",
    safety:{readOnly:true,writes:false,publicSnapshotPublication:false,externalNavigation:false,providerCalls:false,secretsExcluded:true},
    selectedScope:plain(stage.selectedScope),
    ipPolicy:{countryRequired:true,regionOptional:true,exactRegionThenNationwide:true,crossCountryFallback:false,unresolvedGeo:"empty"},
    administrator:{roles:roles(member),access:"validated-private-queue-read"},
    queue:{
      schema:text(stage.schema),stageVersion:text(stage.version),stageGeneratedAt:text(stage.generatedAt),
      totalCandidates:candidates.length,eligibleForRelease:releaseReady.length,held:held.length,
      registrySyncReady:Number(summary.registrySyncReady||0),goLiveAuditCandidates:Number(summary.goLiveAuditCandidates||0),publicationRequested:Number(summary.publicationRequested||0),
      liveResearchQueue:liveResearchCount,stagedReleaseQueue:stagedReleaseCount,
      bySource:countBy(candidates,(row)=>row&&row.sourceTier),
      byStageStatus:countBy(candidates,(row)=>row&&row.stageStatus),
      byRevenueType:countBy(candidates,(row)=>row&&row.revenue&&row.revenue.type),
      byReviewState:countBy(candidates,(row)=>row&&row.review&&row.review.state),
      topBlockingReasons:topReasons(held),
      rows:candidateDigestRows(candidates)
    },
    upstream:{searchBankCommerceInput:Number(source.searchBankCount||summary.receivedSearchBank||0),liveProductResearchQueue:liveResearchCount,stagedReleaseQueue:stagedReleaseCount,adminReviewQueueStale:source.reviewQueueStale===true,reviewQueueDigest:text(source.reviewQueueDigest)||null,storageAvailable:source.liveQueueStorageAvailable!==false,storageError:text(source.liveQueueStorageError)||null},
    pipeline:{version:text(stage.pipeline&&stage.pipeline.version)||ProductPipeline.VERSION,automaticResearchQueue:true,administratorSelectionRequired:true,marketEvidenceRequired:true,verifiedEvidenceRequired:true,revenueRouteRequired:true,slotAssignmentRequired:true,goLiveAuditRequired:true,explicitPublicationRequestRequired:true,registrySyncRequired:true,canonicalCanaryRequired:true,automaticPublication:false,paymentExecution:false},
    revenueRegistry:{version:text(affiliate.version)||null,valid:affiliate.ok!==false,problems:Array.isArray(affiliate.problems)?affiliate.problems.slice(0,50):[]},
    releaseGate:{enabled:gate.enabled===true,mode:text(gate.mode)||"staging_only",reason:text(gate.reason)||"unknown",keyPresent:gate.keyPresent===true},
    blockingConditions:blockers,
    summary:{considered:Number(summary.considered||candidates.length||0),eligibleForRelease:Number(summary.eligibleForRelease||releaseReady.length||0),registrySyncReady:Number(summary.registrySyncReady||0),goLiveAuditCandidates:Number(summary.goLiveAuditCandidates||0),publicationRequested:Number(summary.publicationRequested||0),releasedToCanonical:Number(summary.releasedToCanonical||0),held:Number(summary.held||held.length||0)}
  };
}
function sessionDoc(member){return {ok:true,version:VERSION,session:{authenticated:true,roles:roles(member),readOnlyQueueAccess:true}};}
function cleanCandidatePayload(body, actor){
  const input=plain(body.candidate); const page=lower(first(input.page,input.channel,input.placement&&input.placement.page)); const section=text(first(input.section,input.psom_key,input.placement&&input.placement.section));
  const result=Object.assign({},input,{
    id:text(input.id)||undefined,
    title:text(input.title),
    url:safeUrl(first(input.url,input.externalProductUrl)),
    image:safeUrl(first(input.image,input.thumb,input.thumbnail)),
    page,channel:page,section,psom_key:section,
    placement:Object.assign({},plain(input.placement),{page,section,slot:text(first(input.slot,input.slotId,input.placement&&input.placement.slot))||undefined}),
    commerceCandidate:Object.assign({},plain(input.commerceCandidate),{sourceTier:"approved_commerce_member",origin:"member-submission",submittedBy:actor.memberId}),
    directCommerceListing:Object.assign({},plain(input.directCommerceListing),{sourceTier:"approved_commerce_member",contractApproved:false,contractStatus:"pending"}),
    commerceReview:{status:"pending",assignmentState:"draft"}
  });
  if(!result.title||!result.url||!result.image||!result.page||!result.section){const err=new Error("제목·HTTPS 상품 URL·HTTPS 이미지·페이지·섹션은 필수입니다.");err.statusCode=400;throw err;}
  return result;
}
function first(){for(const v of arguments){const out=text(v);if(out)return out;}return "";}
async function submit(member, body){
  requireRole(member,"submit");
  const candidate=cleanCandidatePayload(body,member);
  const id="commerce_"+require("crypto").randomBytes(12).toString("hex");
  const rows=await SlotStore.insert("gslot_candidates",{id,kind:"product",title:candidate.title,official_url:candidate.url,status:"approval_pending",source_ref:"commerce-candidate-review-api",thumbnail_url:candidate.image,description:text(candidate.description||candidate.summary)||null,owner_note:"Direct commerce-member submission. Approval and market evidence remain pending.",source_payload:candidate,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),created_by:member.memberId},"return=representation");
  return {ok:true,candidateId:id,status:"approval_pending",row:(rows||[])[0]||null};
}

function requireCandidateId(body){
  const id=text(body&&body.candidateId);
  if(!id){const err=new Error("후보 ID가 필요합니다.");err.statusCode=400;throw err;}
  return id;
}
async function patchSourcePayload(candidateId, mutate){
  const rows=await SlotStore.select("gslot_candidates","select=id,source_payload&id=eq."+encodeURIComponent(candidateId)+"&limit=1");
  const row=Array.isArray(rows)&&rows[0];
  if(!row){const err=new Error("커머스 후보를 찾을 수 없습니다.");err.statusCode=404;throw err;}
  const original=plain(row.source_payload); const next=mutate(Object.assign({},original))||original;
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(candidateId),{source_payload:next,updated_at:new Date().toISOString()});
  return next;
}
async function candidateLifecycle(candidateId){
  const id=text(candidateId);
  const settled=await Promise.all([
    SlotStore.select("gslot_candidates","select=id,kind,title,status,source_ref,source_payload&id=eq."+encodeURIComponent(id)+"&limit=1"),
    SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,updated_at&candidate_id=eq."+encodeURIComponent(id)+"&order=updated_at.desc&limit=100"),
    SlotStore.select("gslot_candidate_availability","select=candidate_id,country_code,region_code,availability_state,legal_basis,delivery_or_access,updated_at&candidate_id=eq."+encodeURIComponent(id)+"&order=updated_at.desc&limit=100"),
    SlotStore.select("gslot_candidate_revenue","select=id,candidate_id,revenue_type,status,affiliate_url,provider_name,currency,note,updated_at&candidate_id=eq."+encodeURIComponent(id)+"&order=updated_at.desc&limit=100"),
    SlotStore.select("gslot_candidate_evidence","select=id,candidate_id,evidence_type,evidence_url,note,verified,created_at&candidate_id=eq."+encodeURIComponent(id)+"&order=created_at.desc&limit=100")
  ]);
  const candidate=Array.isArray(settled[0])&&settled[0][0];
  if(!candidate){const err=new Error("커머스 후보를 찾을 수 없습니다.");err.statusCode=404;throw err;}
  const relations={assignments:Array.isArray(settled[1])?settled[1]:[],markets:Array.isArray(settled[2])?settled[2]:[],revenues:Array.isArray(settled[3])?settled[3]:[],evidence:Array.isArray(settled[4])?settled[4]:[]};
  return {candidate,relations,lifecycle:ProductPipeline.registryState(candidate,relations)};
}
function requireLifecycleStage(state, allowed, message){
  const stage=text(state&&state.lifecycle&&state.lifecycle.stage);
  if(!allowed.includes(stage)){const err=new Error(message+" 현재 단계: "+(stage||"확인 불가")+".");err.statusCode=409;err.code="PIPELINE_STAGE_ORDER";throw err;}
  return state;
}
async function selectProductCandidate(member, body){
  requireRole(member,"approve");
  const id=requireCandidateId(body);
  const rows=await SlotStore.select("gslot_candidates","select=id,kind,status,source_ref,source_payload&id=eq."+encodeURIComponent(id)+"&limit=1");
  const row=Array.isArray(rows)&&rows[0];
  if(!row||lower(row.kind)!=="product"){const err=new Error("상품 후보를 찾을 수 없습니다.");err.statusCode=404;throw err;}
  const source=plain(row.source_payload), readiness=ProductPipeline.researchReadiness(source), risk=plain(source.riskAssessment);
  if(readiness.promotionEligible!==true || risk.gatePassed!==true){
    const gaps=[].concat(readiness.blockers||[],readiness.reviewGaps||[],risk.blockers||[]).filter(Boolean);
    const err=new Error("이 상품은 비공개 대기열에서 확인할 수 있지만 아직 승인 절차로 승격할 수 없습니다. 보완 사항: "+(Array.from(new Set(gaps)).join(", ")||"상품·공급업체 검증 미완료"));err.statusCode=409;err.code="PRODUCT_REVIEW_GAPS";throw err;
  }
  const now=new Date().toISOString();
  const payload=await patchSourcePayload(id,function(source){
    source.slotDecision="slot_candidate";
    source.pipeline=Object.assign({},plain(source.pipeline),{stage:"administrator_selection_pending",nextGate:"market_evidence_and_revenue_route",selectedAt:now,selectedBy:member.memberId});
    source.review=Object.assign({},plain(source.review),{state:"pending",selectedAt:now,selectedBy:member.memberId});
    return source;
  });
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:"approval_pending",updated_at:now});
  return {ok:true,candidateId:id,status:"approval_pending",pipeline:plain(payload.pipeline),note:"상품 후보 선택만 완료했습니다. 시장·배송 근거, 검증 증빙, 수익 경로, PSOM 배정을 차례로 완료해야 원장 동기화 대상이 됩니다."};
}

async function recordMarket(member, body){
  requireRole(member,"approve");
  const id=requireCandidateId(body);const market=plain(body.market);
  requireLifecycleStage(await candidateLifecycle(id),["administrator_selection_pending","market_evidence_pending","trust_evidence_pending","revenue_route_pending","slot_assignment_pending"],"관리자 상품 선택을 먼저 완료해야 시장 근거를 기록할 수 있습니다.");
  const country=text(market.countryCode).toUpperCase();const region=text(market.regionCode).toUpperCase();
  const delivery=text(market.deliveryOrAccess);const basis=text(market.legalBasis);
  if(!/^[A-Z]{2}$/.test(country)||!delivery||!basis){const err=new Error("판매국(ISO 2자리), 배송·접근 근거, 법적/판매 근거가 필요합니다.");err.statusCode=400;throw err;}
  const row={candidate_id:id,country_code:country,region_code:region||"NATIONWIDE",availability_state:"active",legal_basis:basis.slice(0,4000),delivery_or_access:delivery.slice(0,4000),updated_at:new Date().toISOString(),updated_by:member.memberId};
  const rows=await SlotStore.insert("gslot_candidate_availability",row,"return=representation");
  return {ok:true,candidateId:id,market:(rows||[])[0]||row,note:"시장 근거는 배송·반품·지원·책임 증빙과 함께 Canonical 단계에서 다시 검증됩니다."};
}
async function recordEvidence(member, body){
  requireRole(member,"approve");
  const id=requireCandidateId(body);const evidence=plain(body.evidence);const url=safeUrl(evidence.url);
  requireLifecycleStage(await candidateLifecycle(id),["trust_evidence_pending","revenue_route_pending","slot_assignment_pending"],"활성 판매시장·배송·반품 근거를 먼저 등록해야 검증 증빙을 기록할 수 있습니다.");
  const type=text(evidence.type)||"market_sale";const note=text(evidence.note);
  if(!url||!note){const err=new Error("HTTPS 증빙 URL과 증빙 설명이 필요합니다.");err.statusCode=400;throw err;}
  const rows=await SlotStore.insert("gslot_candidate_evidence",{id:"evidence_"+require("crypto").randomBytes(12).toString("hex"),candidate_id:id,evidence_type:type.slice(0,120),evidence_url:url,note:note.slice(0,4000),verified:true,created_at:new Date().toISOString(),created_by:member.memberId},"return=representation");
  return {ok:true,candidateId:id,evidence:(rows||[])[0]||null};
}
async function recordRevenue(member, body){
  requireRole(member,"approve");
  const id=requireCandidateId(body), revenue=plain(body.revenue), type=lower(revenue.type), url=safeUrl(revenue.affiliateUrl||revenue.destinationUrl);
  requireLifecycleStage(await candidateLifecycle(id),["revenue_route_pending","slot_assignment_pending"],"활성 판매시장과 검증 증빙을 먼저 완료해야 수익 경로를 승인할 수 있습니다.");
  const allowed=new Set(["affiliate","manual_affiliate","brokerage","referral","external_referral","lead","advertising","sponsor"]);
  const providerName=text(revenue.providerName), checkedAt=text(revenue.policyCheckedAt||revenue.verifiedAt)||new Date().toISOString();
  const disclosureReady=bool(revenue.disclosureReady), policyConfirmed=bool(revenue.policyConfirmed), providerGenerated=bool(revenue.providerGenerated);
  const payoutBasisVerified=bool(revenue.payoutBasisVerified), settlementMode=lower(revenue.settlementMode), contractId=text(revenue.contractId||revenue.programId);
  if(!allowed.has(type)||!url||!providerName){const err=new Error("허용된 수익/연결 유형, HTTPS 연결 URL, 제공자명이 필요합니다.");err.statusCode=400;throw err;}
  if(type==="affiliate"||type==="manual_affiliate"){
    const programId=text(revenue.programId||revenue.contractId), manualApproved=bool(revenue.manualLinkApproved);
    if(!programId||!providerGenerated||!disclosureReady||!policyConfirmed||(type==="manual_affiliate"&&!manualApproved)){const err=new Error("제휴 경로에는 프로그램 ID, 제공자 생성 링크, 표시·고지 승인, 정책 확인이 필요하며 수동 제휴는 운영 승인도 필요합니다.");err.statusCode=400;throw err;}
    await patchSourcePayload(id,function(payload){payload.affiliate=Object.assign({},plain(payload.affiliate),{providerId:text(revenue.providerId||providerName),programId,approved:true,status:"approved",trackingUrl:url,providerGenerated:true,manualLinkApproved:type==="manual_affiliate"?true:manualApproved,disclosureReady:true,policyStatus:"policy_ok",policyCheckedAt:checkedAt,integrationMode:type==="manual_affiliate"?"manual":"provider_program"});return payload;});
  }else if(type==="external_referral"){
    if(!bool(revenue.officialDestination)||!disclosureReady){const err=new Error("외부 연결형에는 공식 판매처 확인과 표시·고지 승인이 필요합니다.");err.statusCode=400;throw err;}
    await patchSourcePayload(id,function(payload){payload.outboundReferral=Object.assign({},plain(payload.outboundReferral),{operatorApproved:true,approved:true,status:"approved",officialDestination:true,officialSeller:true,disclosureReady:true,verifiedAt:checkedAt,destinationUrl:url,providerName});return payload;});
  }else{
    if(!contractId||!disclosureReady||!payoutBasisVerified||!settlementMode){const err=new Error("직접 광고·중개·추천·리드·스폰서 경로에는 계약 ID, 표시·고지 승인, 지급 근거 확인, 정산 방식이 모두 필요합니다.");err.statusCode=400;throw err;}
    await patchSourcePayload(id,function(payload){
      payload.brokerageContract=Object.assign({},plain(payload.brokerageContract),{id:contractId,type,providerName,counterparty:providerName,approved:true,status:"approved",destinationUrl:url,disclosureReady:true,payoutBasisVerified:true,settlementMode,policyStatus:policyConfirmed?"policy_ok":"contract_verified",policyCheckedAt:checkedAt,currency:text(revenue.currency)||null,note:text(revenue.note)||null});
      if(type==="sponsor") payload.sponsorship=Object.assign({},plain(payload.sponsorship),{active:true,enabled:true,required:true,mode:"sponsored",disclosed:true,verified:true,sponsorName:providerName,provider:providerName,contractId,disclosureSource:"administrator_approved_sponsor_revenue"});
      return payload;
    });
  }
  const rows=await SlotStore.insert("gslot_candidate_revenue",{id:"revenue_"+require("crypto").randomBytes(12).toString("hex"),candidate_id:id,revenue_type:type,status:"approved",affiliate_url:url,provider_name:providerName.slice(0,240),currency:text(revenue.currency).slice(0,16)||null,note:text(revenue.note).slice(0,4000)||null,updated_at:new Date().toISOString(),updated_by:member.memberId},"return=representation");
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:"revenue_ready",updated_at:new Date().toISOString()});
  const note=type==="external_referral"?"외부 연결형은 상품별 수익을 확정으로 표시하지 않으며, 공식 판매처·판매시장·고지·Canonical 검증을 통과할 때만 공개 후보가 됩니다.":"승인 수익 경로를 저장했습니다. 시장 근거·검증 증빙·PSOM 배정과 원장 동기화가 끝나야 공급 개방 점검으로 넘어갑니다.";
  return {ok:true,candidateId:id,revenue:(rows||[])[0]||null,note};
}

function normalizedEvidenceTypes(relations){
  return (relations&&Array.isArray(relations.evidence)?relations.evidence:[]).filter((row)=>row&&row.verified===true).map((row)=>lower(row.evidence_type));
}
function validateAssignmentPolicy(state, hub, section){
  const page=pageMap(hub), allowed=SLOT_KEYS[page];
  if(!page||!allowed||!allowed.has(section)){const err=new Error("실제 PSOM에 등록된 허브·섹션 키가 아닙니다.");err.statusCode=400;err.code="INVALID_PSOM_SECTION";throw err;}
  const types=normalizedEvidenceTypes(state&&state.relations);
  const required=SLOT_EVIDENCE_RULES[section]||[];
  if(required.length&&!required.some((needle)=>types.some((type)=>type.includes(needle)))){
    const err=new Error("선택한 섹션에는 전용 검증 증빙이 필요합니다. 필요한 증빙 유형: "+required.join(", "));err.statusCode=409;err.code="SECTION_EVIDENCE_REQUIRED";throw err;
  }
  // distribution-sponsor is selectable in normal product mode.
  // A verified sponsor revenue record activates sponsorship metadata separately.
  return page;
}

async function decide(member, body){
  requireRole(member,"approve");
  const id=text(body.candidateId);const decision=lower(body.decision);if(!id||!["approved","hold","rejected"].includes(decision)){const err=new Error("후보 ID와 approved/hold/rejected 판정이 필요합니다.");err.statusCode=400;throw err;}
  if(decision!=="approved"){
    const now=new Date().toISOString();
    await patchSourcePayload(id,function(payload){payload.slotDecision=decision==="rejected"?"reject":"hold";payload.review=Object.assign({},plain(payload.review),{state:decision,decidedAt:now,decidedBy:member.memberId});return payload;});
    await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:decision==="rejected"?"suppressed":"hold",owner_note:text(body.note).slice(0,3000)||null,updated_at:now});
    return {ok:true,candidateId:id,status:decision};
  }
  const lifecycleState=requireLifecycleStage(await candidateLifecycle(id),["slot_assignment_pending"],"시장·검증 증빙·승인 수익 경로를 먼저 완료해야 PSOM 배정을 승인할 수 있습니다.");
  const assignment=plain(body.assignment);const hub=lower(assignment.hubKey);const section=text(assignment.slotKey);const country=text(assignment.countryCode).toUpperCase();
  const page=validateAssignmentPolicy(lifecycleState,hub,section);
  if(!section||!/^[A-Z]{2}$/.test(country)){const err=new Error("승인에는 허브·PSOM 슬롯 키·ISO 2자리 판매국이 필요합니다.");err.statusCode=400;throw err;}
  // Approval alone does not make a candidate public. Registry sync will export
  // it only when availability, revenue right and evidence records exist.
  const approvedAt=new Date().toISOString();
  await patchSourcePayload(id,function(payload){payload.slotDecision="slot_candidate";payload.review=Object.assign({},plain(payload.review),{state:"approved",decidedAt:approvedAt,decidedBy:member.memberId});payload.pipeline=Object.assign({},plain(payload.pipeline),{stage:"registry_sync_ready",nextGate:"go_live_audit_and_explicit_publication_request"});return payload;});
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:"enrollable",owner_note:text(body.note).slice(0,3000)||null,updated_at:approvedAt});
  const assignmentId="assignment_"+require("crypto").randomBytes(12).toString("hex");
  const rows=await SlotStore.insert("gslot_slot_assignments",{id:assignmentId,candidate_id:id,hub_key:hub,country_code:country,region_code:text(assignment.regionCode).toUpperCase()||"NATIONWIDE",slot_key:section,priority:Math.max(-1000000,Math.min(1000000,Number(assignment.priority)||0)),state:assignment.pinned===true?"pinned":"approved",publication_status:"audit_ready",manual_pinned:assignment.pinned===true,decision_note:text(body.note).slice(0,3000)||null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),updated_by:member.memberId},"return=representation");
  return {ok:true,candidateId:id,status:"enrollable",assignment:(rows||[])[0]||null,note:"시장·검증 증빙·수익 경로·PSOM 승인이 완료되어 실상품 공급 개방 점검 대상으로 확정됐습니다. 아직 원장 동기화나 사이트 게재는 실행되지 않으며, 개방 점검에서 별도의 최종 게재 요청이 필요합니다."};
}

exports.buildDiagnostic=diagnosticDoc;
exports.candidateLifecycle=candidateLifecycle;
exports.stage=stage;
exports.handler=async function(event){
  try{
    if(String(event&&event.httpMethod||"GET").toUpperCase()==="OPTIONS")return json(204,{});
    const method=String(event&&event.httpMethod||"GET").toUpperCase();
    const member=await resolveCurrentAdmin(event);
    const body=method==="GET"?{}:parse(event);const action=lower((event.queryStringParameters||{}).action||body.action||"summary");
    if(method==="GET"){
      requireRole(member,"read");const query=event.queryStringParameters||{};
      // Session/geo/location boot reads must never hydrate the global private
      // product queue. The previous handler built the entire 2,500-row live stage
      // before even checking the action, which made every admin page susceptible
      // to 502/504 once one country accumulated a large research ledger.
      if(action==="session")return json(200,sessionDoc(member));
      if(action==="geo")return json(200,geoProbe(event));
      if(action==="locations")return json(200,await locationStatus({candidates:[]}));
      const probe=geoProbe(event);const requested=text(query.country).toUpperCase();
      const scopeCountry=requested||(probe.resolved?probe.country:"UNRESOLVED");
      const scopeRegion=text(query.region)||(probe.resolved?(probe.region||"NATIONWIDE"):"");
      const doc=await scopedStage(process.cwd(),scopeCountry,scopeRegion);
      if(action==="dashboard"){
        const summary=summaryDoc(doc),response={ok:true,scope:doc.selectedScope,summary,candidates:(doc.candidates||[]).slice(0,3000)};
        if(!["1","true","yes"].includes(lower(query.compact)))response.diagnostic=diagnosticDoc(doc,member);
        return json(200,response);
      }
      if(action==="summary")return json(200,{ok:true,scope:doc.selectedScope,summary:summaryDoc(doc)});
      if(action==="candidates")return json(200,{ok:true,scope:doc.selectedScope,summary:summaryDoc(doc),candidates:(doc.candidates||[]).slice(0,3000)});
      if(action==="diagnostic")return json(200,diagnosticDoc(doc,member));
      return json(404,{ok:false,error:"지원하지 않는 조회 요청입니다."});
    }
    if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
    if(action==="submit")return json(200,await submit(member,body));
    if(action==="select_product")return json(200,await selectProductCandidate(member,body));
    if(action==="decide")return json(200,await decide(member,body));
    if(action==="record_market")return json(200,await recordMarket(member,body));
    if(action==="record_evidence")return json(200,await recordEvidence(member,body));
    if(action==="record_revenue")return json(200,await recordRevenue(member,body));
    return json(404,{ok:false,error:"지원하지 않는 관리 요청입니다."});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:error&&error.code||null});}
};
