"use strict";

/**
 * Administrator action endpoint for media candidates stored in Supabase.
 * Actions update review state only. They do not publish to data/media.snapshot.json.
 */
const MediaStore = require("./lib/media-candidate-store.v1");
const AdminAuth = require("./lib/commerce-candidate-auth.v1");

const VERSION = "media-candidate-action-v1.0.0-supabase-review";
const ACTIONS = new Set(["approve","hold","block","reject","reset"]);

async function actorFor(event){
  const actor = await AdminAuth.authenticateCommerceAdmin(event);
  MediaStore.requireRole(actor,"write");
  return actor;
}
function idsFrom(body){
  const values = body.ids || body.candidateIds || body.id || body.candidateId || [];
  return Array.from(new Set(MediaStore.array(values).map(MediaStore.text).filter(Boolean))).slice(0,500);
}
function patchFor(action, body, actor){
  const now=MediaStore.nowIso();
  const by=MediaStore.compact(actor.email || actor.memberId || "admin",200);
  const note=MediaStore.compact(body.note || body.reason || "",1000);
  if(action==="approve"){
    if(body.confirmRightsSafe !== true && body.confirmRightsSafe !== "true"){
      const error=new Error("승인은 confirmRightsSafe=true 확인값이 필요합니다.");
      error.statusCode=400;error.code="rights_confirmation_required";throw error;
    }
    return {review_status:"approved",verification_status:"approved_for_snapshot",candidate_only:false,seed_content:false,review_note:note,reviewed_by:by,reviewed_at:now,approved_at:now,updated_by:by,updated_at:now};
  }
  if(action==="hold") return {review_status:"hold",verification_status:"hold",review_note:note,reviewed_by:by,reviewed_at:now,updated_by:by,updated_at:now};
  if(action==="block") return {review_status:"blocked",verification_status:"blocked",blocked_reason:note || "blocked_by_admin",review_note:note,reviewed_by:by,reviewed_at:now,updated_by:by,updated_at:now,candidate_only:true,seed_content:true};
  if(action==="reject") return {review_status:"rejected",verification_status:"rejected",blocked_reason:note || "rejected_by_admin",review_note:note,reviewed_by:by,reviewed_at:now,updated_by:by,updated_at:now,candidate_only:true,seed_content:true};
  return {review_status:"pending",verification_status:"web_verification_required",review_note:note,reviewed_by:by,reviewed_at:now,updated_by:by,updated_at:now,candidate_only:true,seed_content:true,approved_at:null,blocked_reason:null};
}
exports.handler = async function(event){
  if(event && event.httpMethod === "OPTIONS") return MediaStore.response(204,{});
  try{
    if(event.httpMethod !== "POST") return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const actor=await actorFor(event);
    const body=MediaStore.parseBody(event);
    const action=MediaStore.lower(body.action);
    if(!ACTIONS.has(action)) return MediaStore.response(400,{ok:false,error:"invalid_action",allowed:Array.from(ACTIONS)});
    const ids=idsFrom(body);
    if(!ids.length) return MediaStore.response(400,{ok:false,error:"candidate_ids_required"});
    const patch=patchFor(action,body,actor);
    const updated=await MediaStore.updateCandidates(ids,patch);
    return MediaStore.response(200,{ok:true,version:VERSION,action,requested:ids.length,updated:Array.isArray(updated)?updated.length:0,items:updated});
  }catch(error){
    return MediaStore.response(error.statusCode || 500,{ok:false,version:VERSION,error:error.code||"media_candidate_action_failed",message:error.message||String(error)});
  }
};
