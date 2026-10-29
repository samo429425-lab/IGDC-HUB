"use strict";

const crypto = require("crypto");
const AdminSession = require("./lib/global-slot-console-auth");
const SlotStore = require("./lib/global-slot-console-supabase");
const MarketSaleScope = require("./lib/market-sale-scope.v1");

const VERSION = "commerce-candidate-admin-authority-v1.6.0-canonical-candidate-assignment-consistency";
const WRITE_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);
const ALLOWED_SOURCE_REFS = new Set(["country-product-ranking-review","commerce-candidate-review-api"]);
const SECTION_KEYS = new Set([
  "home|home_1","home|home_2","home|home_3","home|home_4","home|home_5","home|home_6","home|home_right_top","home|home_right_middle","home|home_right_bottom",
  "distribution|distribution-recommend","distribution|distribution-trending","distribution|distribution-sponsor","distribution|distribution-new","distribution|distribution-special","distribution|distribution-others","distribution|distribution-extra","distribution|distribution-right",
  "network|network-right","social|rightPanel","tour|tour"
]);

function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase().replace(/[\s.]+/g,"_");}
function plain(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{};}
function array(v){return Array.isArray(v)?v:[];}
function json(statusCode,body){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)};}
function parse(event){try{return event&&event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body):{};}catch(_e){const error=new Error("요청 JSON 형식이 올바르지 않습니다.");error.statusCode=400;throw error;}}
function sha(value){return crypto.createHash("sha256").update(String(value)).digest("hex");}
function requireWrite(actor){const roles=array(actor&&actor.roles).map(lower);if(!roles.some(role=>WRITE_ROLES.has(role))){const error=new Error("상품 배치 관리자 권한이 없습니다.");error.statusCode=403;throw error;}return roles;}
function scopeFrom(input){
  const country=MarketSaleScope.normalizeCountry(text(input&&input.countryCode||input&&input.country).toUpperCase());
  if(!country){const error=new Error("국가 범위를 확인하세요.");error.statusCode=400;throw error;}
  const requestedRegion=text(input&&input.subdivisionCode||input&&input.regionCode||input&&input.region||"NATIONWIDE");
  const region=MarketSaleScope.normalizeRegion(requestedRegion,country);
  if(!region){const error=new Error("선택한 국가의 지역 코드가 올바르지 않습니다.");error.statusCode=400;throw error;}
  return{country,region};
}
function placementKey(value){const key=text(value);return SECTION_KEYS.has(key)?key:"";}
function splitKey(key){const i=key.indexOf("|");return i>0?{page:key.slice(0,i),section:key.slice(i+1)}:null;}
function assignmentId(candidateId,scope,key){return "admin-place-"+sha(candidateId+"|"+scope.country+"|"+scope.region+"|"+key).slice(0,32);}
function sameScope(row,scope){
  if(text(row&&row.country_code).toUpperCase()!==scope.country)return false;
  const region=MarketSaleScope.normalizeRegion(text(row&&row.region_code||"NATIONWIDE"),scope.country)||"NATIONWIDE";
  return region===scope.region;
}
async function candidateRow(candidateId){
  const rows=await SlotStore.select("gslot_candidates","select=id,title,official_url,status,source_ref,thumbnail_url,source_payload,created_at,updated_at&id=eq."+encodeURIComponent(candidateId)+"&limit=1");
  return plain(array(rows)[0]);
}
async function assignments(candidateId){
  return array(await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,created_at,updated_at,updated_by&candidate_id=eq."+encodeURIComponent(candidateId)+"&limit=100"));
}
async function removeScopeAssignments(rows,scope){
  let removed=0;
  for(const row of array(rows)){
    if(!sameScope(row,scope)||!text(row&&row.id))continue;
    await SlotStore.remove("gslot_slot_assignments","id=eq."+encodeURIComponent(text(row.id)));
    removed+=1;
  }
  return removed;
}
async function upsertAssignment(candidateId,scope,key,actor,source,oldRows){
  const split=splitKey(key),now=new Date().toISOString();
  if(!split)throw Object.assign(new Error("20개 섹션 배치 키가 올바르지 않습니다."),{statusCode:400});
  const old=array(oldRows).find(row=>sameScope(row,scope)&&text(row.hub_key)===split.page&&text(row.slot_key)===split.section);
  const row={
    id:assignmentId(candidateId,scope,key),candidate_id:candidateId,hub_key:split.page,country_code:scope.country,region_code:scope.region,
    slot_key:split.section,priority:Number(old&&old.priority||0)||0,state:"approved",publication_status:"audit_ready",
    manual_pinned:source==="administrator",created_at:text(old&&old.created_at)||now,updated_at:now,updated_by:actor
  };
  await SlotStore.insert("gslot_slot_assignments",row,"resolution=merge-duplicates,return=representation");
  return row;
}
function currentPlacement(payload,scope,oldRows){
  const p=plain(payload.approvedPlacement||payload.selectedPlacement||payload.placement||payload.primaryPlacement);
  if(text(p.page)&&text(p.sectionKey||p.section))return Object.assign({},p,{country:scope.country,region:scope.region});
  const old=array(oldRows).find(row=>sameScope(row,scope)&&text(row.hub_key)&&text(row.slot_key));
  if(!old)return null;
  return{key:text(old.hub_key)+"|"+text(old.slot_key),page:text(old.hub_key),section:text(old.slot_key),sectionKey:text(old.slot_key),country:scope.country,region:scope.region};
}
function candidateScopeMatches(row, scope){
  // Candidate metadata can contain legacy placement snapshots. A conflicting
  // country/subdivision MUST stop the write rather than using the first field.
  const payload=plain(row&&row.source_payload),market=plain(payload.marketScope),
    supply=plain(payload.countrySupply),placement=plain(payload.approvedPlacement),
    primary=plain(payload.primaryPlacement);
  const countries=[market.marketCountry,supply.country,supply.countryCode,placement.country,primary.country,payload.countryCode]
    .map(v=>text(v).toUpperCase()).filter(Boolean);
  const regions=[market.marketRegion,supply.region,supply.regionCode,placement.region,primary.region,payload.regionCode]
    .map(v=>text(v).toUpperCase()).filter(Boolean);
  if(!countries.length||countries.some(c=>MarketSaleScope.normalizeCountry(c)!==scope.country))return false;
  if(!regions.length)return scope.region==='NATIONWIDE';
  return regions.every(region=>MarketSaleScope.normalizeRegion(region,scope.country)===scope.region);
}

function publiclyProtected(payload,relations){
  const status=lower(plain(payload.frontPublication).status);
  if(["queued","publish_requested","published","matched","active","unpublish_requested","unpublish_failed"].includes(status))return true;
  if(payload.publicPublication===true)return true;
  return array(relations).some(row=>["publish_requested","published","matched","active","unpublish_requested","unpublish_failed"].includes(lower(row&&row.publication_status)));
}
async function verifyAuthorityWrite(candidateId,scope,expected,expectedSectionKey){
  const row=await candidateRow(candidateId),payload=plain(row.source_payload),decision=lower(payload.slotDecision);
  if(!text(row.id)||!candidateScopeMatches(row,scope)||decision!==expected){
    throw Object.assign(new Error("candidate_ledger_write_not_confirmed:"+candidateId+":"+decision),{statusCode:409});
  }
  const relations=(await assignments(candidateId)).filter(item=>sameScope(item,scope)),keys=relations.map(item=>text(item.hub_key)+"|"+text(item.slot_key));
  if(expectedSectionKey){
    const chosen=plain(payload.approvedPlacement),key=text(chosen.key||((chosen.page||"")+"|"+(chosen.sectionKey||chosen.section||"")));
    if(key!==expectedSectionKey||keys.length!==1||keys[0]!==expectedSectionKey){
      throw Object.assign(new Error("candidate_assignment_mismatch:"+candidateId+":"+keys.join(",")),{statusCode:409});
    }
  }else if(expected!=="front_unmatch"&&relations.length){
    throw Object.assign(new Error("candidate_assignment_not_removed:"+candidateId),{statusCode:409});
  }
  return {candidateId,decision,sectionKey:expectedSectionKey||null,assignmentCount:relations.length,verified:true};
}
async function applyOne(actor,candidateId,scope,decision,key,source,verifiedMetadata){
  const row=await candidateRow(candidateId);
  if(!Object.keys(row).length)throw Object.assign(new Error("선택 상품 후보 원장을 찾을 수 없습니다."),{statusCode:404});
  if(!ALLOWED_SOURCE_REFS.has(text(row.source_ref)))throw Object.assign(new Error("이 상품 후보는 관리자 배치 원장 대상이 아닙니다."),{statusCode:409});
  if(!candidateScopeMatches(row,scope))throw Object.assign(new Error("candidate_outside_selected_country_region"),{statusCode:403});
  const oldRows=await assignments(candidateId),oldPayload=Object.assign({},plain(row.source_payload)),payload=Object.assign({},oldPayload),now=new Date().toISOString();
  if(oldRows.length>=100)throw Object.assign(new Error('candidate_assignment_scan_limit'),{statusCode:409});
  // This authority writes the candidate master as well as relations. Refuse
  // shared candidate IDs with assignments from another country/subdivision.
  if(oldRows.some(assignment=>!sameScope(assignment,scope))){
    throw Object.assign(new Error('candidate_has_other_market_assignment_no_cross_scope_mutation'),{statusCode:409});
  }
  const actorId=text(actor&&actor.sub)||"administrator",prior=currentPlacement(payload,scope,oldRows);
  let status=text(row.status)||"approval_pending",effective=decision,assignment=null;
  const oldQueue=plain(oldPayload.queueControl),oldDecision=lower(oldPayload.slotDecision);
  // A manual section-to-section relocation is a distinct administrative act.
  // Other mutations (including automatic reclassification) remain protected.
  // The old public snapshot must be reconciled by Front Match; it must not be
  // represented as already changed merely because the private ledger moved.
  const sourceKey=text(prior&&prior.key)||((prior&&prior.page&&prior.sectionKey)?text(prior.page)+"|"+text(prior.sectionKey):"");
  const targetKey=placementKey(key);
  const frontStatus=lower(plain(oldPayload.frontPublication).status);
  const isManualSectionMove=decision==="slot_candidate"&&source==="administrator"&&
    !!sourceKey&&!!targetKey&&sourceKey!==targetKey&&
    oldRows.some(item=>sameScope(item,scope)&&text(item.hub_key)+"|"+text(item.slot_key)===sourceKey);
  const pendingUnpublish=["unpublish_requested","unpublish_failed"].includes(frontStatus);
  const liveProtected=publiclyProtected(oldPayload,oldRows);
  if(decision!=="front_unmatch"&&liveProtected&&(!isManualSectionMove||pendingUnpublish)){
    throw Object.assign(new Error(pendingUnpublish?"front_unpublish_pending_complete_before_move":"published_or_unpublish_pending_candidate_protected"),{statusCode:409});
  }

  if((decision==="slot_candidate"||decision==="sync_ai")&&(oldQueue.permanentExcluded===true||oldDecision==="purge"||lower(row.status)==="suppressed"&&lower(oldQueue.action)==="purge")){
    throw Object.assign(new Error("영구 제외된 상품은 배치할 수 없습니다. 먼저 제외 목록에서 후보로 복원해 주세요."),{statusCode:409,code:"candidate_permanently_excluded"});
  }

  if(decision==="slot_candidate"||decision==="sync_ai"){
    const target=placementKey(key||text(plain(payload.approvedPlacement||payload.placement).key)||((text(plain(payload.approvedPlacement||payload.placement).page)&&text(plain(payload.approvedPlacement||payload.placement).sectionKey||plain(payload.approvedPlacement||payload.placement).section))?text(plain(payload.approvedPlacement||payload.placement).page)+"|"+text(plain(payload.approvedPlacement||payload.placement).sectionKey||plain(payload.approvedPlacement||payload.placement).section):""));
    if(!target)throw Object.assign(new Error("배치할 20개 섹션을 확인하세요."),{statusCode:400});
    const split=splitKey(target),ai=(decision==="sync_ai"||source==="ai_automation");
    // Record the previous section before changing the private assignment. The
    // public output is still unchanged until the next verified Front Match.
    if(isManualSectionMove){
      payload.previousApprovedPlacement=Object.assign({},plain(prior),{
        key:sourceKey,country:scope.country,region:scope.region,
        removedAt:now,removedReason:"administrator_section_relocation",
        frontWasPublished:liveProtected
      });
      payload.sectionRelocation={schema:"igdc-section-relocation.v1",
        previousKey:sourceKey,targetKey:target,country:scope.country,region:scope.region,
        requestedAt:now,requestedBy:actorId,
        frontSyncRequired:liveProtected,frontSyncConfirmed:false};
    }
    // Reuse the existing ID, but never retain a second section assignment.
    // This remains a private-ledger move; frontend publication is a separate gate.
    await removeScopeAssignments(oldRows,scope);
    assignment=await upsertAssignment(candidateId,scope,target,actorId,ai?"ai_automation":"administrator",oldRows);
    payload.slotDecision="slot_candidate";
    payload.approvedPlacement={key:target,page:split.page,section:split.section,sectionKey:split.section,country:scope.country,region:scope.region,administratorSelected:!ai,aiSelected:ai,proposalOnly:false,publicPublication:false,selectedAt:now,selectedBy:actorId,selectionSource:ai?"ai_automation":"administrator"};
    payload.placement=Object.assign({},payload.approvedPlacement);
    payload.managementControl=Object.assign({},plain(oldPayload.managementControl),{schema:"igdc-product-management-control.v1",source:ai?"ai_automation":"administrator",administratorLocked:!ai,aiReclassificationAllowed:ai,decidedAt:now,decidedBy:actorId});
    payload.queueControl=Object.assign({},plain(payload.queueControl),{hiddenFromCountryQueue:false,permanentExcluded:false,action:ai?"ai_section_selected":"section_selected",restoredAt:now,restoredBy:actorId});
    payload.frontPublication=Object.assign({},plain(payload.frontPublication),{schema:"igdc-product-front-publication-control.v4",candidateId,operation:"match",status:"ready",queued:false,persisted:true,pendingBuild:false,publicSnapshotConfirmed:false,buildVerificationRequired:true,authority:"administrator_candidate_ledger",assignmentId:assignment.id,sectionKey:target,country:scope.country,region:scope.region,preparedAt:now,preparedBy:actorId,previousSectionKey:isManualSectionMove?sourceKey:null,relocationPendingFrontSync:isManualSectionMove&&liveProtected});
    // Keep the DB lifecycle status unchanged; only the private workflow decision changes.
    if(source==="ai_automation"&&verifiedMetadata){
      const category=text(verifiedMetadata.category).slice(0,80),tags=array(verifiedMetadata.categoryTags).map(text).filter(Boolean).slice(0,20);
      if(category){payload.productCategory=category;payload.productCategoryTags=tags;
        payload.productRanking=Object.assign({},plain(payload.productRanking),{category,categoryTags:tags});}
      payload.review=Object.assign({},plain(payload.review),{nextGate:"administrator_front_match",psomPlacementAt:now,psomPlacementBy:actorId,psomPolicyReason:text(verifiedMetadata.reason).slice(0,200)});
    }
    effective="slot_candidate";
  } else if(decision==="front_unmatch"){
    if(prior)payload.previousApprovedPlacement=Object.assign({},prior,{removedAt:now,removedReason:"administrator_front_unmatch"});
    for(const old of oldRows){
      if(!sameScope(old,scope)||!text(old.id))continue;
      await SlotStore.update("gslot_slot_assignments","id=eq."+encodeURIComponent(text(old.id)),{publication_status:"not_ready",updated_at:now,updated_by:actorId});
    }
    payload.frontPublication=Object.assign({},plain(payload.frontPublication),{schema:"igdc-product-front-publication-control.v4",candidateId,operation:"unmatch",status:"unpublish_requested",queued:false,persisted:true,pendingBuild:true,publicSnapshotConfirmed:false,buildVerificationRequired:true,reason:"administrator_selected_product_unmatch",page:prior&&prior.page||null,section:prior&&prior.sectionKey||prior&&prior.section||null,sectionKey:prior&&prior.sectionKey||prior&&prior.section||null,country:scope.country,region:scope.region,requestedAt:now,requestedBy:actorId});
    effective=lower(payload.slotDecision||"slot_candidate")||"slot_candidate";
  } else {
    if(prior)payload.previousApprovedPlacement=Object.assign({},prior,{removedAt:now,removedReason:"administrator_"+decision});
    await removeScopeAssignments(oldRows,scope);
    delete payload.approvedPlacement;delete payload.selectedPlacement;delete payload.placement;delete payload.primaryPlacement;
    if(decision==="hold"){payload.slotDecision="hold";effective="hold";}
    else if(decision==="dismiss"){payload.slotDecision="removed";effective="removed";}
    else if(decision==="remove_from_list"){payload.slotDecision="removed_from_list";effective="removed_from_list";}
    else if(decision==="reject"){payload.slotDecision="reject";effective="reject";}
    else if(decision==="purge"){payload.slotDecision="purge";effective="purge";}
    else {payload.slotDecision="undecided";effective="undecided";}
    payload.queueControl=Object.assign({},plain(payload.queueControl),{
      schema:"igdc-private-product-queue-control.v1",
      action:decision==="dismiss"?"dismiss":(decision==="remove_from_list"?"remove_from_list":effective),
      hiddenFromCountryQueue:["hold","reject","purge","removed","removed_from_list"].includes(effective),
      permanentExcluded:effective==="purge",
      rediscoveryAllowed:effective!=="purge",
      decidedAt:now,decidedBy:actorId
    });
    payload.managementControl=Object.assign({},plain(oldPayload.managementControl),{schema:"igdc-product-management-control.v1",source:"administrator",administratorLocked:true,aiReclassificationAllowed:false,decidedAt:now,decidedBy:actorId});
    // These rows passed the public-protection guard: they were NOT published.
    // Mark private placement as unmatched, never unpublish_requested (which
    // makes later verified-PSOM re-placement incorrectly look public/locked).
    payload.frontPublication=Object.assign({},plain(payload.frontPublication),{schema:"igdc-product-front-publication-control.v4",candidateId,operation:"unmatch",status:"unmatched",queued:false,persisted:true,pendingBuild:false,publicSnapshotConfirmed:false,buildVerificationRequired:false,reason:"administrator_private_section_release",page:prior&&prior.page||null,section:prior&&prior.sectionKey||prior&&prior.section||null,sectionKey:prior&&prior.sectionKey||prior&&prior.section||null,country:scope.country,region:scope.region,requestedAt:now,requestedBy:actorId});
  }

  // A research candidate already exists in the canonical master. The explicit
  // administrator handoff to UNASSIGNED is a durable move of the worklist,
  // not a cloned candidate. Scope is verified above, and the normal 20-section
  // manager continues to read this SAME candidate ID.
  if(effective==="undecided" && (source==="latest_research_group"||source==="administrator")){
    payload.managementControl=Object.assign({},plain(payload.managementControl),{
      latestResearchHandoff:{completed:true,destination:"unassigned",country:scope.country,region:scope.region,completedAt:now,completedBy:actorId}
    });
  }
  payload.decisionAt=now;payload.decisionBy=actorId;payload.decisionSource=source==="ai_automation"?"ai_automation":"administrator_candidate_authority";payload.publicPublication=false;payload.automaticImport=false;
  const reviewState=decision==="dismiss"?"deleted_from_management":(decision==="remove_from_list"?"removed_from_list":(effective==="slot_candidate"?"pending":effective));
  payload.review=Object.assign({},plain(payload.review),{state:reviewState,decidedAt:now,decidedBy:actorId});
  // Existing row.status already satisfies the database CHECK. It must not be
  // rewritten with queue-control terms such as research_pending/hold/suppressed.
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(candidateId),{source_payload:payload,updated_at:now});
  const verified=await verifyAuthorityWrite(candidateId,scope,effective, effective==="slot_candidate"?placementKey(payload.approvedPlacement&&payload.approvedPlacement.key):null);
  if(effective==="undecided"&&(source==="latest_research_group"||source==="administrator")){
    const saved=await candidateRow(candidateId),handoff=plain(plain(plain(saved.source_payload).managementControl).latestResearchHandoff);
    if(handoff.completed!==true||handoff.destination!=="unassigned"||handoff.country!==scope.country||handoff.region!==scope.region){
      throw Object.assign(new Error("latest_research_handoff_not_confirmed:"+candidateId),{statusCode:409});
    }
  }
  return{candidateId,decision,effectiveDecision:effective,placement:payload.approvedPlacement||null,status,assignmentId:assignment&&assignment.id||null,ok:true,ledgerVerified:verified.verified,assignmentCount:verified.assignmentCount,relocation:payload.sectionRelocation||null,frontSyncRequired:!!(payload.sectionRelocation&&payload.sectionRelocation.frontSyncRequired)};
}

exports.handler=async function(event){
  try{
    const method=String(event&&event.httpMethod||"POST").toUpperCase();
    if(method==="OPTIONS")return json(204,{});
    if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
    const actor=await AdminSession.resolveUser(event);requireWrite(actor);
    const body=parse(event),scope=scopeFrom(body),decision=lower(body.decision),source=lower(body.source||"administrator");
    let requests=[];
    if(decision==="sync_ai"){
      requests=array(body.placements).map(item=>({candidateId:text(item&&item.candidateId),placementKey:placementKey(item&&item.placementKey)})).filter(item=>item.candidateId&&item.placementKey).slice(0,3000);
    }else{
      const ids=Array.from(new Set(array(body.candidateIds).concat([body.candidateId]).map(text).filter(Boolean))).slice(0,3000);
      requests=ids.map(candidateId=>({candidateId,placementKey:placementKey(body.placementKey)}));
    }
    if(!requests.length)throw Object.assign(new Error("처리할 상품 후보를 선택하세요."),{statusCode:400});
    const allowed=new Set(["slot_candidate","sync_ai","undecided","hold","reject","purge","dismiss","remove_from_list","front_unmatch"]);
    if(!allowed.has(decision))throw Object.assign(new Error("지원하지 않는 관리자 상품 작업입니다."),{statusCode:400});

    const results=[],failures=[];
    for(let offset=0;offset<requests.length;offset+=8){
      const chunk=requests.slice(offset,offset+8);
      const settled=await Promise.allSettled(chunk.map(req=>applyOne(actor,req.candidateId,scope,decision,req.placementKey,source)));
      settled.forEach((entry,index)=>{
        const req=chunk[index];
        if(entry.status==="fulfilled")results.push(entry.value);
        else failures.push({candidateId:req.candidateId,error:text(entry.reason&&entry.reason.message||entry.reason)});
      });
    }
    return json(200,{ok:failures.length===0,version:VERSION,complete:failures.length===0,requested:requests.length,processed:results.length,failed:failures.length,processedIds:results.map(r=>r.candidateId),results,failures,scope,publicPublication:false,paymentExecution:false});
  }catch(error){
    return json(Number(error&&error.statusCode)||500,{ok:false,version:VERSION,error:text(error&&error.message)||"candidate_admin_authority_failed"});
  }
};

// Server-internal bridge for already-verified PSOM placements. The public handler
// cannot call this function directly; /commerce-country-control authorizes the
// administrator and verifies exact product evidence before invoking it.
exports.applyVerifiedPsomPlacement=async function(actorId,candidateId,inputScope,sectionKey,metadata){
  const scope=scopeFrom({countryCode:inputScope&&inputScope.country,subdivisionCode:inputScope&&inputScope.region});
  if(!placementKey(sectionKey))throw Object.assign(new Error("invalid_psom_section"),{statusCode:400});
  return applyOne({sub:text(actorId)||"administrator"},text(candidateId),scope,"sync_ai",sectionKey,"ai_automation",plain(metadata));
};
