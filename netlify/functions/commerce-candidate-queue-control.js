"use strict";

/*
 * Administrator-only cleanup actions for the private product candidate queue.
 * This endpoint never publishes, opens checkout, or changes the public snapshot.
 */

const AdminSession = require("./lib/global-slot-console-auth");
const SlotStore = require("./lib/global-slot-console-supabase");
const ProductPipeline = require("./lib/commerce-product-pipeline-state.v1");
const CommerceAutomation = require("./lib/commerce-country-automation.v1");

const VERSION = "commerce-candidate-queue-control-v1.9.0-staged-admin-withdrawal-marker";
const WRITE_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);
const ACTIONS = new Set(["dismiss","purge","remove_from_list","hold","reject","restore"]);
const MANAGEABLE_PRODUCT_SOURCES = new Set([ProductPipeline.SOURCE_REF,"commerce-candidate-review-api"]);


function text(value){ return value == null ? "" : String(value).trim(); }
function lower(value){ return text(value).toLowerCase().replace(/[\s.]+/g,"_"); }
function plain(value){ return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value){ return Array.isArray(value) ? value : []; }
function json(statusCode,body){ return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)}; }
function parse(event){ try{return event&&event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body):{};}catch(_error){const error=new Error("요청 JSON 형식이 올바르지 않습니다.");error.statusCode=400;throw error;} }
function roles(actor){ return Array.from(new Set((actor&&actor.roles||[]).map(lower).filter(Boolean))); }
function requireWriteRole(actor){ if(!roles(actor).some((role)=>WRITE_ROLES.has(role))){const error=new Error("상품 후보 대기열 정리 권한이 없습니다.");error.statusCode=403;throw error;} }
function candidateIds(value){
  const input=Array.isArray(value)?value:[value],seen=new Set(),out=[];
  for(const raw of input){const id=text(raw);if(!/^[A-Za-z0-9_-]{3,180}$/.test(id)||seen.has(id))continue;seen.add(id);out.push(id);if(out.length>=3000)break;}
  return out;
}
async function readCandidate(id){
  const rows=await SlotStore.select("gslot_candidates","select=id,kind,status,source_ref,official_url,source_payload,owner_note&limit=1&id=eq."+encodeURIComponent(id));
  return Array.isArray(rows)?rows[0]||null:null;
}
async function readAssignments(candidateId){
  try{const rows=await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,updated_at&candidate_id=eq."+encodeURIComponent(candidateId)+"&limit=100");return Array.isArray(rows)?rows:[];}
  catch(_error){return[];}
}
async function releaseSectionAssignment(candidateId){
  try{const rows=await SlotStore.remove("gslot_slot_assignments","candidate_id=eq."+encodeURIComponent(candidateId));return{ok:true,count:Array.isArray(rows)?rows.length:0};}
  catch(error){return{ok:false,error:text(error&&error.message||error)};}
}
function frontStateActive(value){return ["queued","publish_requested","published","matched","active"].includes(lower(value));}
function previousFrontPlacement(payload,assignments){
  const front=plain(payload&&payload.frontPublication),placement=plain(payload&&payload.approvedPlacement||payload&&payload.selectedPlacement||payload&&payload.placement||payload&&payload.primaryPlacement);
  const live=array(assignments).find((row)=>frontStateActive(row&&row.publication_status))||array(assignments)[0]||null;
  const page=text(live&&live.hub_key)||text(placement.page),section=text(live&&live.slot_key)||text(placement.sectionKey||placement.section),country=text(live&&live.country_code)||text(placement.country),region=text(live&&live.region_code)||text(placement.region)||"NATIONWIDE";
  const active=(!!live&&frontStateActive(live.publication_status))||frontStateActive(front.status);
  if(!page||!section)return null;
  return{key:page+"|"+section,page,section,sectionKey:section,country:country||null,region:region||"NATIONWIDE",assignmentId:text(live&&live.id)||text(front.assignmentId)||null,publicationStatus:text(live&&live.publication_status)||text(front.status)||null,frontActive:active,priority:Number(live&&live.priority||placement.priority||0)||0,manualPinned:live&&live.manual_pinned===true||placement.manualPinned===true};
}
function stageFrontWithdrawal(payload,candidateId,prior,actorId,now,reason){
  if(prior)payload.previousApprovedPlacement=Object.assign({},prior,{removedAt:now,removedReason:reason});
  const shouldWithdraw=!!(prior&&prior.frontActive);
  payload.frontPublication=Object.assign({},plain(payload.frontPublication),shouldWithdraw?{
    schema:"igdc-product-front-publication-control.v4",candidateId,operation:"unmatch",status:"unpublish_requested",queued:false,persisted:true,pendingBuild:true,publicSnapshotConfirmed:false,buildVerificationRequired:true,deferredBuild:true,
    reason,page:prior.page,section:prior.sectionKey||prior.section,sectionKey:prior.sectionKey||prior.section,country:prior.country||null,region:prior.region||"NATIONWIDE",assignmentId:prior.assignmentId||null,requestedAt:now,requestedBy:text(actorId)||"administrator"
  }:{
    schema:"igdc-product-front-publication-control.v4",candidateId,operation:"unmatch",status:"unmatched",queued:false,persisted:true,pendingBuild:false,publicSnapshotConfirmed:false,buildVerificationRequired:false,deferredBuild:false,
    reason,requestedAt:now,requestedBy:text(actorId)||"administrator"
  });
  return shouldWithdraw;
}
function candidateManagementBucket(row){
  const payload=plain(row&&row.source_payload),status=lower(row&&row.status),decision=lower(payload.slotDecision),review=lower(plain(payload.review).state),queueAction=lower(plain(payload.queueControl).action);
  if(status==="hold"||decision==="hold"||review==="hold"||queueAction==="hold")return "hold";
  if(["reject","rejected","suppressed","purge","excluded"].includes(status)||["reject","purge"].includes(decision)||["reject","rejected","permanent_excluded"].includes(review)||["reject","purge"].includes(queueAction))return "reject";
  if(status==="removed"||decision==="removed"||["removed_from_list","deleted_from_management"].includes(review)||["remove_from_list","dismiss"].includes(queueAction))return "removed";
  return "active";
}
function candidateAlreadyRestored(row){
  const payload=plain(row&&row.source_payload),queueControl=plain(payload.queueControl);
  return ["approval_pending","research_pending"].includes(lower(row&&row.status))
    && lower(payload.slotDecision)==="undecided"
    && lower(queueControl.action)==="restored"
    && queueControl.hiddenFromCountryQueue!==true
    && queueControl.permanentExcluded!==true;
}
function requireExpectedBucket(row,expectedBucket,action){
  const expected=lower(expectedBucket),actual=candidateManagementBucket(row);
  if(!expected)return actual;
  if(!["hold","reject"].includes(expected)){const error=new Error("invalid_expected_bucket");error.code="invalid_expected_bucket";throw error;}
  if(actual!==expected){
    if(action==="restore" && actual==="active" && candidateAlreadyRestored(row))return actual;
    if(actual==="removed" && ["dismiss","remove_from_list"].includes(action))return actual;
    const error=new Error("candidate_state_mismatch: expected "+expected+", actual "+actual);error.code="candidate_state_mismatch";throw error;
  }
  if(expected==="hold" && !["restore","dismiss","remove_from_list","reject","purge"].includes(action)){const error=new Error("action_not_allowed_for_hold");error.code="action_not_allowed_for_hold";throw error;}
  if(expected==="reject" && !["restore","dismiss","remove_from_list","purge"].includes(action)){const error=new Error("action_not_allowed_for_reject");error.code="action_not_allowed_for_reject";throw error;}
  return actual;
}
async function applyAction(actorId,row,action){
  const id=text(row&&row.id),payload=Object.assign({},plain(row&&row.source_payload)),now=new Date().toISOString();
  const oldAssignments=await readAssignments(id),priorFront=previousFrontPlacement(payload,oldAssignments);
  if(action==="restore"){
    if(candidateAlreadyRestored(row))return{id,action,status:text(row&&row.status)||"approval_pending",restoredToCandidate:true,idempotent:true,assignmentCleanup:{ok:true,count:0}};
    const previousStatus=text(row&&row.status)||"approval_pending",previousBucket=candidateManagementBucket(row),assignmentCleanup=await releaseSectionAssignment(id);
    payload.slotDecision="undecided";
    delete payload.approvedPlacement;delete payload.selectedPlacement;delete payload.placement;delete payload.primaryPlacement;
    delete payload.page;delete payload.channel;delete payload.section;delete payload.psom_key;delete payload.slot;
    payload.queueControl=Object.assign({},plain(payload.queueControl),{schema:"igdc-private-product-queue-control.v1",action:"restored",previousStatus,previousBucket,hiddenFromCountryQueue:false,permanentExcluded:false,rediscoveryAllowed:true,restoredAt:now,restoredBy:text(actorId)||"administrator",decidedAt:now,decidedBy:text(actorId)||"administrator"});
    payload.review=Object.assign({},plain(payload.review),{state:"pending",restoredFrom:previousBucket,decidedAt:now,decidedBy:text(actorId)||"administrator"});
    payload.managementControl={schema:"igdc-product-management-control.v1",source:"administrator_restore",administratorLocked:true,aiReclassificationAllowed:false,decidedAt:now,decidedBy:text(actorId)||"administrator"};
    payload.frontPublication=Object.assign({},plain(payload.frontPublication),{operation:"unmatch",status:"unmatched",queued:false,pendingBuild:false,publicSnapshotConfirmed:false,buildVerificationRequired:false,deferredBuild:false,reason:"administrator_restored_to_candidate_pool",requestedAt:now,requestedBy:text(actorId)||"administrator"});
    payload.decisionAt=now;payload.decisionBy=text(actorId)||"administrator";payload.decisionSource="administrator_restore";payload.publicPublication=false;payload.automaticImport=false;
    await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:"approval_pending",source_payload:payload,owner_note:"관리자가 보류·제외 상품을 전체 상품 후보·배치 관리 목록으로 복원했습니다.",updated_at:now});
    return{id,action,status:"approval_pending",restoredToCandidate:true,previousBucket,assignmentCleanup};
  }
  if(action==="dismiss"){
    /* SAFE DELETE: never physically delete the shared master candidate row from
       a HOLD/REJECT management screen.  The master ledger is also the source for
       the normal candidate/18-section manager.  A physical DELETE here made a
       secondary cleanup action capable of erasing the primary management view.
       Archive only the selected candidate, clear only its slot assignment, and
       keep research/evidence history so the candidate can be rediscovered or
       restored later without affecting unrelated candidates. */
    const assignmentCleanup=await releaseSectionAssignment(id);
    const previousStatus=text(row&&row.status)||"approval_pending";
    const queueControl=Object.assign({},plain(payload.queueControl),{
      schema:"igdc-private-product-queue-control.v1",action:"dismiss",previousStatus,hiddenFromCountryQueue:true,permanentExcluded:false,rediscoveryAllowed:true,decidedAt:now,decidedBy:text(actorId)||"administrator"
    });
    payload.queueControl=queueControl;payload.slotDecision="removed";
    delete payload.approvedPlacement;delete payload.selectedPlacement;delete payload.placement;delete payload.page;delete payload.channel;delete payload.section;delete payload.psom_key;delete payload.slot;
    payload.review=Object.assign({},plain(payload.review),{state:"deleted_from_management",decidedAt:now,decidedBy:text(actorId)||"administrator"});
    stageFrontWithdrawal(payload,id,priorFront,actorId,now,"administrator_management_dismiss");
    await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:"removed",source_payload:payload,owner_note:"관리자가 보류·제외 관리 목록에서 삭제했습니다. 공유 후보 원장은 보존하며 재수집을 허용합니다.",updated_at:now});
    return {id,action,status:"removed",deletedFromManagement:true,masterLedgerPreserved:true,rediscoveryAllowed:true,assignmentCleanup};
  }
  const previousStatus=text(row&&row.status)||"approval_pending";
  const queueControl=Object.assign({},plain(payload.queueControl),{
    schema:"igdc-private-product-queue-control.v1",
    action,
    previousStatus,
    hiddenFromCountryQueue:true,
    permanentExcluded:action==="purge",
    rediscoveryAllowed:action==="dismiss"||action==="remove_from_list",
    permanentExclusionUrl:action==="purge"?text(payload.externalProductUrl||payload.url||row&&row.official_url)||null:plain(payload.queueControl).permanentExclusionUrl||null,
    decidedAt:now,
    decidedBy:text(actorId)||"administrator"
  });
  payload.queueControl=queueControl;
  payload.slotDecision=action==="purge"?"purge":action==="reject"?"reject":action==="remove_from_list"?"removed":"hold";
  if(action==="hold"||action==="reject"||action==="purge"||action==="remove_from_list"){
    delete payload.approvedPlacement; delete payload.selectedPlacement; delete payload.placement;
    delete payload.page; delete payload.channel; delete payload.section; delete payload.psom_key; delete payload.slot;
  }
  payload.review=Object.assign({},plain(payload.review),{
    state:action==="purge"?"permanent_excluded":action==="reject"?"rejected":action==="remove_from_list"?"removed_from_list":"hold",
    decidedAt:now,
    decidedBy:text(actorId)||"administrator"
  });
  const assignmentCleanup=await releaseSectionAssignment(id);
  stageFrontWithdrawal(payload,id,priorFront,actorId,now,"administrator_management_"+action);
  const status=action==="purge"?"suppressed":action==="reject"?"rejected":action==="remove_from_list"?"removed":"hold";
  const note=action==="purge"
    ?"관리자가 이 상품 후보를 보류·제외 관리에서 영구 제외했습니다. 자동 상품 리서치가 같은 후보를 다시 승격하지 않도록 원장 기록을 보존합니다."
    :action==="reject"
      ?"관리자가 이 상품 후보를 현재 후보·배치 목록에서 제외하고 보류·제외 관리로 이동했습니다. 영구 삭제는 수행하지 않았습니다."
      :action==="remove_from_list"
        ?"관리자가 이 상품 후보 원장은 보존하고 현재 후보 관리 목록에서만 제거했습니다. 이후 리서치 재발견은 허용됩니다."
        :"관리자가 이 상품 후보를 보류했습니다. 원장과 기존 검토 기록은 보존합니다.";
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status,source_payload:payload,owner_note:note,updated_at:now});
  return {id,action,status,assignmentCleanup,frontBuildDispatched:false};
}

exports.handler=async function(event){
  try{
    const method=String(event&&event.httpMethod||"GET").toUpperCase();
    if(method==="OPTIONS")return json(204,{});
    if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
    const body=parse(event),action=lower(body.decision||body.action),ids=candidateIds(body.candidateIds||body.candidateId),expectedBucket=lower(body.expectedBucket);
    if(!ACTIONS.has(action)){const error=new Error("지원하지 않는 상품 후보 대기열 작업입니다.");error.statusCode=400;throw error;}
    if(!ids.length){const error=new Error("처리할 상품 후보를 선택해 주세요.");error.statusCode=400;throw error;}
    const actor=await AdminSession.resolveUser(event);requireWriteRole(actor);const actorId=text(actor&&actor.sub);
    const processed=[],failures=[];
    for(let offset=0;offset<ids.length;offset+=8){
      const chunk=ids.slice(offset,offset+8);
      const settled=await Promise.allSettled(chunk.map(async(id)=>{
        const row=await readCandidate(id);
        if(!row)throw Object.assign(new Error("candidate_not_found"),{candidateId:id});
        if(lower(row&&row.kind)!=="product"||!MANAGEABLE_PRODUCT_SOURCES.has(text(row.source_ref)))throw Object.assign(new Error("unsupported_candidate_source"),{candidateId:id});
        requireExpectedBucket(row,expectedBucket,action);
        const applied=await applyAction(actorId,row,action);
        // Keep the latest research view aligned with every management decision,
        // not only permanent exclusion. Otherwise hold/reject/list-removal rows
        // can be reloaded from the research job and appear to "come back".
        applied.researchVisibility=await CommerceAutomation.syncCandidateManagementResearchVisibilityByInput(actorId,body,id,action==="restore"?"undecided":action);
        return applied;
      }));
      settled.forEach((entry,index)=>{const id=chunk[index];if(entry.status==="fulfilled")processed.push(entry.value);else failures.push({id,error:text(entry.reason&&entry.reason.message||entry.reason)});});
    }
    if(!processed.length){const error=new Error("선택 항목을 처리하지 못했습니다. 최신 대기열을 다시 불러와 주세요.");error.statusCode=409;error.failures=failures;throw error;}
    return json(200,{ok:true,version:VERSION,decision:action,requested:ids.length,processed:processed.length,processedIds:processed.map((row)=>row.id),results:processed,failures,publicPublication:false,paymentExecution:false});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:text(error&&error.code)||null,failures:error&&error.failures||undefined});}
};
