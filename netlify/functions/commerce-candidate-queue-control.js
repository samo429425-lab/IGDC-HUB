"use strict";

/*
 * Administrator-only cleanup actions for the private product candidate queue.
 * This endpoint never publishes, opens checkout, or changes the public snapshot.
 */

const AdminSession = require("./lib/global-slot-console-auth");
const SlotStore = require("./lib/global-slot-console-supabase");
const ProductPipeline = require("./lib/commerce-product-pipeline-state.v1");

const VERSION = "commerce-candidate-queue-control-v1.5.0-safe-isolated-bucket-guard";
const WRITE_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);
const ACTIONS = new Set(["dismiss","purge","remove_from_list","hold","reject"]);


function text(value){ return value == null ? "" : String(value).trim(); }
function lower(value){ return text(value).toLowerCase().replace(/[\s.]+/g,"_"); }
function plain(value){ return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
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
  const rows=await SlotStore.select("gslot_candidates","select=id,status,source_ref,source_payload,owner_note&limit=1&id=eq."+encodeURIComponent(id));
  return Array.isArray(rows)?rows[0]||null:null;
}
async function releaseSectionAssignment(candidateId){
  try{const rows=await SlotStore.remove("gslot_slot_assignments","candidate_id=eq."+encodeURIComponent(candidateId));return{ok:true,count:Array.isArray(rows)?rows.length:0};}
  catch(error){return{ok:false,error:text(error&&error.message||error)};}
}
function candidateManagementBucket(row){
  const payload=plain(row&&row.source_payload),status=lower(row&&row.status),decision=lower(payload.slotDecision),review=lower(plain(payload.review).state),queueAction=lower(plain(payload.queueControl).action);
  if(status==="hold"||decision==="hold"||review==="hold"||queueAction==="hold")return "hold";
  if(["reject","rejected","suppressed","purge","excluded"].includes(status)||["reject","purge"].includes(decision)||["reject","rejected","permanent_excluded"].includes(review)||["reject","purge"].includes(queueAction))return "reject";
  if(status==="removed"||decision==="removed"||["removed_from_list","deleted_from_management"].includes(review)||["remove_from_list","dismiss"].includes(queueAction))return "removed";
  return "active";
}
function requireExpectedBucket(row,expectedBucket,action){
  const expected=lower(expectedBucket),actual=candidateManagementBucket(row);
  if(!expected)return actual;
  if(!["hold","reject"].includes(expected)){const error=new Error("invalid_expected_bucket");error.code="invalid_expected_bucket";throw error;}
  if(actual!==expected){
    if(actual==="removed" && ["dismiss","remove_from_list"].includes(action))return actual;
    const error=new Error("candidate_state_mismatch: expected "+expected+", actual "+actual);error.code="candidate_state_mismatch";throw error;
  }
  if(expected==="hold" && !["dismiss","remove_from_list","reject"].includes(action)){const error=new Error("action_not_allowed_for_hold");error.code="action_not_allowed_for_hold";throw error;}
  if(expected==="reject" && !["dismiss","remove_from_list","purge"].includes(action)){const error=new Error("action_not_allowed_for_reject");error.code="action_not_allowed_for_reject";throw error;}
  return actual;
}
async function applyAction(actorId,row,action){
  const id=text(row&&row.id),payload=Object.assign({},plain(row&&row.source_payload)),now=new Date().toISOString();
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
    payload.frontPublication=Object.assign({},plain(payload.frontPublication),{operation:"unmatch",status:"deferred_section_release",queued:false,pendingBuild:true,publicSnapshotConfirmed:false,buildVerificationRequired:true,deferredBuild:true,requestedAt:now,requestedBy:text(actorId)||"administrator"});
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
  payload.frontPublication=Object.assign({},plain(payload.frontPublication),{operation:"unmatch",status:"deferred_section_release",queued:false,pendingBuild:true,publicSnapshotConfirmed:false,buildVerificationRequired:true,deferredBuild:true,requestedAt:now,requestedBy:text(actorId)||"administrator"});
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
        if(text(row.source_ref)!==ProductPipeline.SOURCE_REF)throw Object.assign(new Error("unsupported_candidate_source"),{candidateId:id});
        requireExpectedBucket(row,expectedBucket,action);
        return await applyAction(actorId,row,action);
      }));
      settled.forEach((entry,index)=>{const id=chunk[index];if(entry.status==="fulfilled")processed.push(entry.value);else failures.push({id,error:text(entry.reason&&entry.reason.message||entry.reason)});});
    }
    if(!processed.length){const error=new Error("선택 항목을 처리하지 못했습니다. 최신 대기열을 다시 불러와 주세요.");error.statusCode=409;error.failures=failures;throw error;}
    return json(200,{ok:true,version:VERSION,decision:action,requested:ids.length,processed:processed.length,processedIds:processed.map((row)=>row.id),results:processed,failures,publicPublication:false,paymentExecution:false});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:text(error&&error.code)||null,failures:error&&error.failures||undefined});}
};
