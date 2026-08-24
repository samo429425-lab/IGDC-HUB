"use strict";

/*
 * Administrator-only cleanup actions for the private product candidate queue.
 * This endpoint never publishes, opens checkout, or changes the public snapshot.
 */

const AdminSession = require("./lib/global-slot-console-auth");
const SlotStore = require("./lib/global-slot-console-supabase");
const ProductPipeline = require("./lib/commerce-product-pipeline-state.v1");

const VERSION = "commerce-candidate-queue-control-v1.1.1-3000-admin-list-cleanup";
const WRITE_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);
const ACTIONS = new Set(["dismiss","purge","remove_from_list","hold","reject"]);
const RELATION_TABLES = Object.freeze([
  "gslot_slot_assignments",
  "gslot_candidate_availability",
  "gslot_candidate_revenue",
  "gslot_candidate_evidence"
]);

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
async function deleteRelations(candidateId){
  const results=[];
  for(const table of RELATION_TABLES){
    try{const rows=await SlotStore.remove(table,"candidate_id=eq."+encodeURIComponent(candidateId));results.push({table,ok:true,count:Array.isArray(rows)?rows.length:0});}
    catch(error){results.push({table,ok:false,error:text(error&&error.message||error)});}
  }
  return results;
}
async function releaseSectionAssignment(candidateId){
  try{const rows=await SlotStore.remove("gslot_slot_assignments","candidate_id=eq."+encodeURIComponent(candidateId));return{ok:true,count:Array.isArray(rows)?rows.length:0};}
  catch(error){return{ok:false,error:text(error&&error.message||error)};}
}
async function applyAction(actorId,row,action){
  const id=text(row&&row.id),payload=Object.assign({},plain(row&&row.source_payload)),now=new Date().toISOString();
  if(action==="dismiss"){
    const relations=await deleteRelations(id);
    await SlotStore.remove("gslot_candidates","id=eq."+encodeURIComponent(id));
    return {id,action,status:"deleted_research_allowed",relations};
  }
  const previousStatus=text(row&&row.status)||"approval_pending";
  const queueControl=Object.assign({},plain(payload.queueControl),{
    schema:"igdc-private-product-queue-control.v1",
    action,
    previousStatus,
    hiddenFromCountryQueue:true,
    permanentExcluded:action==="purge",
    rediscoveryAllowed:action==="dismiss",
    decidedAt:now,
    decidedBy:text(actorId)||"administrator"
  });
  payload.queueControl=queueControl;
  payload.review=Object.assign({},plain(payload.review),{
    state:action==="purge"?"permanent_excluded":action==="reject"?"rejected":action==="remove_from_list"?"removed_from_list":"hold",
    decidedAt:now,
    decidedBy:text(actorId)||"administrator"
  });
  const assignmentCleanup=await releaseSectionAssignment(id);
  payload.frontPublication=Object.assign({},plain(payload.frontPublication),{operation:"unmatch",status:"deferred_section_release",queued:false,pendingBuild:true,publicSnapshotConfirmed:false,buildVerificationRequired:true,deferredBuild:true,requestedAt:now,requestedBy:text(actorId)||"administrator"});
  const status=action==="purge"?"suppressed":action==="reject"?"reject":"hold";
  const note=action==="purge"
    ?"관리자가 이 상품 후보를 보류·제외 관리에서 영구 제외했습니다. 자동 상품 리서치가 같은 후보를 다시 승격하지 않도록 원장 기록을 보존합니다."
    :action==="reject"
      ?"관리자가 이 상품 후보를 현재 후보·배치 목록에서 제외하고 보류·제외 관리로 이동했습니다. 영구 삭제는 수행하지 않았습니다."
      :"관리자가 이 상품 후보를 현재 국가 관제 목록에서 숨기거나 보류했습니다. 원장과 기존 검토 기록은 보존합니다.";
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status,source_payload:payload,owner_note:note,updated_at:now});
  return {id,action,status,assignmentCleanup,frontBuildDispatched:false};
}

exports.handler=async function(event){
  try{
    const method=String(event&&event.httpMethod||"GET").toUpperCase();
    if(method==="OPTIONS")return json(204,{});
    if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
    const body=parse(event),action=lower(body.decision||body.action),ids=candidateIds(body.candidateIds||body.candidateId);
    if(!ACTIONS.has(action)){const error=new Error("지원하지 않는 상품 후보 대기열 작업입니다.");error.statusCode=400;throw error;}
    if(!ids.length){const error=new Error("처리할 상품 후보를 선택해 주세요.");error.statusCode=400;throw error;}
    const actor=await AdminSession.resolveUser(event);requireWriteRole(actor);const actorId=text(actor&&actor.sub);
    const processed=[],failures=[];
    for(const id of ids){
      try{
        const row=await readCandidate(id);
        if(!row){failures.push({id,error:"candidate_not_found"});continue;}
        if(text(row.source_ref)!==ProductPipeline.SOURCE_REF){failures.push({id,error:"unsupported_candidate_source"});continue;}
        processed.push(await applyAction(actorId,row,action));
      }catch(error){failures.push({id,error:text(error&&error.message||error)});}
    }
    if(!processed.length){const error=new Error("선택 항목을 처리하지 못했습니다. 최신 대기열을 다시 불러와 주세요.");error.statusCode=409;error.failures=failures;throw error;}
    return json(200,{ok:true,version:VERSION,decision:action,requested:ids.length,processed:processed.length,processedIds:processed.map((row)=>row.id),results:processed,failures,publicPublication:false,paymentExecution:false});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:text(error&&error.code)||null,failures:error&&error.failures||undefined});}
};
