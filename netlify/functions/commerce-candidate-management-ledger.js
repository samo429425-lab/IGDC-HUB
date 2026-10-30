"use strict";

/*
 * Lightweight administrator product-management ledger reader.
 * Purpose: keep the ordinary admin list independent from the large diagnostic /
 * staging / relation-hydration paths. Read-only; never publishes or mutates DB.
 */
const AdminSession=require("./lib/global-slot-console-auth");
const SlotStore=require("./lib/global-slot-console-supabase");
const MarketSaleScope=require("./lib/market-sale-scope.v1");
const ProductPipeline=require("./lib/commerce-product-pipeline-state.v1");

const VERSION="commerce-candidate-management-ledger-v1.5.0-readonly-scope-assignment-integrity";
const READ_ROLES=new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager"]);
// The ranking engine and administrator-placement authority accept both sources.
// A candidate in either source must remain findable on the ordinary board.
const PRODUCT_SOURCE_REF=ProductPipeline.SOURCE_REF;
const PRODUCT_SOURCE_REFS=[PRODUCT_SOURCE_REF,"commerce-candidate-review-api"];
function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase().replace(/\s+/g,"_");}
function plain(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function array(v){return Array.isArray(v)?v:[];}
function json(statusCode,body){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff"},body:JSON.stringify(body)};}
function roles(actor){return Array.from(new Set(array(actor&&actor.roles).map(lower).filter(Boolean)));}
function normalizeCountry(v){return MarketSaleScope.normalizeCountry(v);}
function normalizeRegion(v,c){return MarketSaleScope.normalizeRegion(v,c);}
function candidateScopes(payloadInput){
  const payload=plain(payloadInput),scopes=[];
  function add(c,r){c=normalizeCountry(c);if(!c||c==="GLOBAL")return;r=normalizeRegion(r||"NATIONWIDE",c)||"NATIONWIDE";scopes.push({country:c,region:r});}
  for(const key of array(payload.marketKeys)){const m=text(key).toUpperCase().match(/^([A-Z]{2})-(.+)$/);if(m)add(m[1],m[2]);}
  const ms=plain(payload.marketScope);add(ms.marketCountry,ms.marketRegion);
  const cs=plain(payload.countrySupply);add(cs.country||cs.countryCode||cs.targetMarket,cs.region||cs.regionCode||cs.targetRegion);
  const p=plain(payload.approvedPlacement||payload.selectedPlacement||payload.primaryPlacement||payload.placement);add(p.country||p.countryCode,p.region||p.regionCode);
  add(payload.targetCountry||payload.countryCode,payload.targetRegion||payload.regionCode);
  const seen=new Set();return scopes.filter(s=>{const k=s.country+"|"+s.region;if(seen.has(k))return false;seen.add(k);return true;});
}
function scopeMatch(payload,countryInput,regionInput){
  const country=normalizeCountry(countryInput),requested=normalizeRegion(regionInput||"NATIONWIDE",country)||"NATIONWIDE";
  if(!country||country==="GLOBAL")return false;
  const scopes=candidateScopes(payload).filter(s=>s.country===country);
  if(requested==="NATIONWIDE")return scopes.some(s=>s.region==="NATIONWIDE");
  return scopes.some(s=>s.region===requested||s.region==="NATIONWIDE");
}
// The same country/region relation is used for both publication status and
// administrator placement. Never display an unrelated market assignment as the
// selected country's slot. An empty relation stays visible for manual repair.
function relationMatches(row,country,region){
  const c=normalizeCountry(row&&row.country_code),r=normalizeRegion(row&&row.region_code||"NATIONWIDE",c)||"NATIONWIDE";
  return c===country&&(r===region||(region!=="NATIONWIDE"&&r==="NATIONWIDE"));
}
function relationKey(row){return text(row&&row.hub_key)+"|"+text(row&&row.slot_key);}
function payloadPlacementKey(payload){
  const placement=plain(payload.approvedPlacement||payload.selectedPlacement||payload.placement||payload.primaryPlacement);
  return (text(placement.page||placement.channel)&&text(placement.sectionKey||placement.section))?text(placement.page||placement.channel)+"|"+text(placement.sectionKey||placement.section):"";
}
function compact(candidate,assignmentRowsInput,country,region){
  const payload=plain(candidate&&candidate.source_payload),assignmentRows=array(assignmentRowsInput),live=ProductPipeline.liveQueueRow(candidate,{assignments:assignmentRows,markets:[],revenues:[],evidence:[]});
  live.officialProductUrl=text(candidate.official_url)||text(payload.externalProductUrl)||text(payload.productUrl);
  live.queueControl=plain(payload.queueControl);live.slotDecision=text(payload.slotDecision);live.recoverySuggestions=array(plain(payload.review).recoverySuggestions).slice(0,5);live.recoveryReason=text(plain(payload.review).recoveryReason);live.lastRecoveryCheckedAt=text(plain(payload.review).lastRecoveryCheckedAt);live.managementControl=plain(payload.managementControl);live.decisionSource=text(payload.decisionSource);
  live.createdAt=text(candidate&&candidate.created_at);live.updatedAt=text(candidate&&candidate.updated_at);
  const placement=plain(payload.approvedPlacement||payload.selectedPlacement||payload.placement),front=plain(payload.frontPublication||payload.publication||payload.frontSync);
  if(Object.keys(placement).length){live.placement=Object.assign({},plain(live.placement),placement,{page:text(placement.page),section:text(placement.section||placement.sectionKey),sectionKey:text(placement.sectionKey||placement.section),slot:text(placement.slot),country:text(placement.country||plain(payload.marketScope).marketCountry),region:text(placement.region||plain(payload.marketScope).marketRegion)});}
  // A legacy payload front marker is historical metadata, not a live
  // assignment. Do NOT manufacture a publish_requested lifecycle from it:
  // two exported KR records carried that marker without an active relation.
  live.ledgerLegacyPublicationStatus=text(front.status||front.publicationStatus||front.publication_status);
  const active=assignmentRows.filter(row=>["approved","pinned"].includes(lower(row&&row.state)));
  const published=active.filter(row=>["audit_ready","ready","publish_requested","queued","matched","published","active"].includes(lower(row&&row.publication_status)));
  const activeKeys=Array.from(new Set(active.map(relationKey).filter(Boolean)));
  const payloadKey=payloadPlacementKey(payload),slotCandidate=lower(payload.slotDecision)==="slot_candidate";
  // The lifecycle helper previously omitted approved/unpublished relations.
  // They are still durable assignments, so expose their actual ID and slot
  // instead of quietly replacing them with a stale payload Front Match marker.
  if(active.length){
    const primary=active.find(row=>relationKey(row)===payloadKey)||active[0];
    const related={id:text(primary.id),hubKey:text(primary.hub_key),slotKey:text(primary.slot_key),countryCode:text(primary.country_code),regionCode:text(primary.region_code),state:text(primary.state),publicationStatus:text(primary.publication_status),priority:Number(primary.priority||0)};
    live.lifecycle=Object.assign({},plain(live.lifecycle),{assignment:related});
  }
  const issues=[];
  if(slotCandidate&&!active.length)issues.push("placement_without_active_assignment");
  // not_ready means the administrator has not Front Matched this product yet;
  // it is NOT a missing placement, and must not be sent to the repair pool.
  if(activeKeys.length>1)issues.push("multiple_active_section_assignments");
  if(slotCandidate&&payloadKey&&activeKeys.length&&!activeKeys.includes(payloadKey))issues.push("placement_relation_section_mismatch");
  if(!slotCandidate&&active.length)issues.push("assignment_without_slot_candidate_decision");
  live.ledgerConsistency={schema:"igdc-administrator-product-relation-consistency.v1",country,region,sourceRef:text(candidate.source_ref),payloadSectionKey:payloadKey,assignmentSectionKeys:activeKeys,activeAssignmentCount:active.length,publicationReadyCount:published.length,issues,consistent:issues.length===0};
  live.assignmentRepairRequired=issues.length>0;
  live.managementProjection="direct_source_ref";return live;
}
async function selectPage(query){return SlotStore.request(SlotStore.rest("gslot_candidates",query),{method:"GET"});}
exports.handler=async function(event){
  const started=Date.now();
  try{
    if(String(event&&event.httpMethod||"GET").toUpperCase()==="OPTIONS")return json(204,{});
    if(String(event&&event.httpMethod||"GET").toUpperCase()!=="GET")return json(405,{ok:false,error:"method_not_allowed"});
    const actor=await AdminSession.resolveUser(event);if(!roles(actor).some(r=>READ_ROLES.has(r)))return json(403,{ok:false,error:"administrator_required"});
    const q=event.queryStringParameters||{},country=normalizeCountry(q.country),region=normalizeRegion(q.region||"NATIONWIDE",country)||"NATIONWIDE";
    if(!country||country==="GLOBAL")return json(200,{ok:true,version:VERSION,scope:{country:country||null,region},candidates:[],pagination:{returned:0,hasMore:false,nextOffset:null}});
    const limit=Math.max(25,Math.min(125,Number(q.limit||q.pageSize)||75)),offset=Math.max(0,Number(q.offset)||0);
    const fields="id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at";
    // Cursor walks *all* durable product candidates, including older payload
    // layouts, even when a newer marketScope record exists in the same scope.
    // The offset is a RAW scan cursor, not a filtered-result offset; therefore
    // empty matched pages still advertise a continuation and never drop rows.
    // Bound each request, not the number of records in the complete ledger.
    const batchSize=150,maxBatchesPerRequest=6;
    let rows=[],scanOffset=offset,rawDone=false,scanned=0;
    for(let page=0;page<maxBatchesPerRequest&&rows.length<limit;page++){
      const sourceFilter="in.("+PRODUCT_SOURCE_REFS.map(encodeURIComponent).join(",")+")";
      const query="select="+fields+"&source_ref="+sourceFilter+"&order=id.asc&limit="+batchSize+"&offset="+scanOffset;
      const raw=array(await selectPage(query));
      // A valid assignment is a second, durable proof that this candidate is
      // managed in the selected market.  Older candidate payloads can lack
      // marketKeys/marketScope even though their KR/NATIONWIDE assignment still
      // exists.  Never hide such a card before the administrator can repair it.
      const mismatched=raw.filter(row=>!scopeMatch(plain(row.source_payload),country,region));
      const assignmentMatched=new Set();
      for(let i=0;i<mismatched.length;i+=75){
        const ids=mismatched.slice(i,i+75).map(row=>text(row.id)).filter(Boolean);
        if(!ids.length)continue;
        const assignmentQuery="select=candidate_id,country_code,region_code,hub_key,slot_key,state,publication_status"+
          "&candidate_id=in.("+ids.map(encodeURIComponent).join(",")+")"+
          "&country_code=eq."+encodeURIComponent(country)+"&region_code=eq."+encodeURIComponent(region)+"&limit=5000";
        const assignments=array(await SlotStore.select("gslot_slot_assignments",assignmentQuery));
        for(const assigned of assignments){
          if(["approved","pinned"].includes(lower(assigned.state)) || ["ready","published","publish_requested"].includes(lower(assigned.publication_status))){
            assignmentMatched.add(text(assigned.candidate_id));
          }
        }
      }
      let consumed=0;
      for(const row of raw){
        consumed+=1;
        if(scopeMatch(plain(row.source_payload),country,region)||assignmentMatched.has(text(row.id)))rows.push(row);
        if(rows.length>=limit)break;
      }
      scanOffset+=consumed;scanned+=consumed;
      if(raw.length<batchSize){rawDone=consumed===raw.length;break;}
      if(consumed<raw.length)break;
    }
    const mode="scoped_durable_scan_v2";
    const hasMore=!rawDone;
    // Hydrate only the publication relation needed by the ordinary management
    // screen.  This keeps the page lightweight while making match/unmatch state
    // reflect gslot_slot_assignments.publication_status instead of stale payload
    // annotations.
    const ids=rows.map(row=>text(row&&row.id)).filter(Boolean),assignmentByCandidate=new Map();
    if(ids.length){
      for(let start=0;start<ids.length;start+=80){
        const chunk=ids.slice(start,start+80),filter=chunk.map(id=>encodeURIComponent(id)).join(",");
        const rel=array(await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,created_at,updated_at&candidate_id=in.("+filter+")&order=updated_at.desc&limit=5000"));
        for(const row of rel){
          const id=text(row&&row.candidate_id);if(!id)continue;
          if(!assignmentByCandidate.has(id))assignmentByCandidate.set(id,[]);
          assignmentByCandidate.get(id).push(row);
        }
      }
    }
    const candidates=rows.map(row=>{
      const matchingRelations=(assignmentByCandidate.get(text(row&&row.id))||[]).filter(relation=>relationMatches(relation,country,region));
      const record=compact(row,matchingRelations,country,region);
      // Keep assignment-only scope evidence visible for administrator repair.
      if(!scopeMatch(plain(row.source_payload),country,region)){
        record.ledgerScopeSource="assignment";
        record.ledgerScopeConflict=true;
      }
      return record;
    });
    return json(200,{ok:true,version:VERSION,sourceRef:PRODUCT_SOURCE_REF,sourceRefs:PRODUCT_SOURCE_REFS,scope:{country,region},candidates,pagination:{offset,limit,returned:candidates.length,hasMore,nextOffset:hasMore?scanOffset:null,mode,scanned,scanOffset},runtime:{totalMs:Date.now()-started},publicationAuthority:"gslot_slot_assignments.publication_status",safety:{readOnly:true,mutatesDatabase:false}});
  }catch(error){return json(Number(error&&error.statusCode)||500,{ok:false,version:VERSION,error:text(error&&error.message||error),runtime:{totalMs:Date.now()-started}});}
};
