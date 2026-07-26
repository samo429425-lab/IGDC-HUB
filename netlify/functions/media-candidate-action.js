"use strict";

/**
 * Guarded administrator transitions for Supabase media candidates.
 * Queue deletion changes only the search record; provider media is untouched.
 */
const MediaStore = require("./lib/media-candidate-store.v1");
const MediaPolicy = require("./lib/media-candidate-policy.v2");
const SharedAdminAuth = require("./lib/global-slot-console-auth");

const VERSION = "media-candidate-action-v1.5.0-exclusion-state-restore";
const ACTIONS = new Set([
  "approve","hold","block","reject","reset","delete",
  "restore_hold","release_exclusion","restore","permanent_block","forget"
]);
const EXCLUSION_RECORD_VERSION = "media-candidate-exclusion-v1";

async function actorFor(event){
  const actor=await SharedAdminAuth.resolveUser(event);
  SharedAdminAuth.requireCapability(actor,"mediaEdit");
  MediaStore.requireRole(actor,"write");
  return actor;
}
function idsFrom(body){
  const values=body.ids||body.candidateIds||body.id||body.candidateId||[];
  return Array.from(new Set(MediaStore.array(values).map(MediaStore.text).filter(Boolean))).slice(0,1000);
}
function audit(actor,body){
  return {
    now:MediaStore.nowIso(),
    by:MediaStore.compact(actor.email||actor.memberId||"admin",200),
    note:MediaStore.compact(body.note||body.reason||"",1000)
  };
}
async function loadRows(ids){
  const list=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const chunk=ids.slice(offset,offset+100);
    const rows=await MediaStore.selectCandidates("select=*&id="+MediaStore.encodeIn(chunk)+"&limit="+chunk.length);
    if(Array.isArray(rows))list.push(...rows);
  }
  if(list.length!==ids.length){
    const found=new Set(list.map((row)=>MediaStore.text(row&&row.id)));
    const error=new Error("후보를 찾지 못했습니다: "+ids.filter((id)=>!found.has(id)).join(", "));
    error.statusCode=404;error.code="media_candidate_not_found";throw error;
  }
  return list;
}
async function updateMany(ids,patch){
  const updated=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const rows=await MediaStore.updateCandidates(ids.slice(offset,offset+100),patch);
    if(Array.isArray(rows))updated.push(...rows);
  }
  return updated;
}
async function deleteMany(ids){
  const deleted=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const rows=await MediaStore.deleteCandidates(ids.slice(offset,offset+100));
    if(Array.isArray(rows))deleted.push(...rows);
  }
  return deleted;
}
function statusOf(row){return MediaStore.lower(row&&row.review_status);}
function nullable(value){return value===undefined?null:value;}
function exclusionRecord(row,info){
  return {
    version:EXCLUSION_RECORD_VERSION,
    excludedAt:info.now,
    excludedBy:info.by,
    exclusionReason:info.note||"moved_from_candidate_queue",
    previous:{
      reviewStatus:nullable(row.review_status),
      verificationStatus:nullable(row.verification_status),
      sectionKey:nullable(row.section_key),
      priority:nullable(row.priority),
      riskLevel:nullable(row.risk_level),
      candidateOnly:nullable(row.candidate_only),
      seedContent:nullable(row.seed_content),
      rightsStatus:nullable(row.rights_status),
      allowedUse:nullable(row.allowed_use),
      approvedAt:nullable(row.approved_at),
      blockedReason:nullable(row.blocked_reason),
      reviewNote:nullable(row.review_note),
      reviewedBy:nullable(row.reviewed_by),
      reviewedAt:nullable(row.reviewed_at),
      createdAt:nullable(row.created_at),
      collectedAt:nullable(row.collected_at),
      updatedAt:nullable(row.updated_at)
    }
  };
}
function appendHistory(raw,event){
  const history=Array.isArray(raw.reviewHistory)?raw.reviewHistory.slice(-99):[];
  history.push(event);
  raw.reviewHistory=history;
  return raw;
}
function rawWithHistory(row,info,action,detail){
  const raw=Object.assign({},MediaStore.plain(row&&row.raw));
  appendHistory(raw,Object.assign({
    action,
    at:info.now,
    by:info.by,
    note:info.note,
    fromReviewStatus:nullable(row&&row.review_status),
    fromVerificationStatus:nullable(row&&row.verification_status),
    fromSectionKey:nullable(row&&row.section_key),
    fromPriority:nullable(row&&row.priority)
  },detail||{}));
  return raw;
}
function exclusionOf(row){
  const record=MediaStore.plain(MediaStore.plain(row&&row.raw).queueExclusion);
  return record.version===EXCLUSION_RECORD_VERSION?record:{};
}
function deletePatch(row,body,actor){
  const info=audit(actor,body);
  const raw=rawWithHistory(row,info,"search_excluded",{
    toReviewStatus:"search_excluded",
    toVerificationStatus:"search_excluded"
  });
  raw.queueExclusion=exclusionRecord(row,info);
  return {
    review_status:"search_excluded",
    verification_status:"search_excluded",
    blocked_reason:info.note||"moved_from_candidate_queue",
    review_note:info.note,
    reviewed_by:info.by,
    reviewed_at:info.now,
    updated_by:info.by,
    updated_at:info.now,
    candidate_only:true,
    seed_content:true,
    approved_at:null,
    raw
  };
}
function legacyRestoreState(row){
  const raw=MediaStore.plain(row&&row.raw);
  return {
    reviewStatus:MediaStore.lower(raw.review_status||raw.reviewStatus)||"pending",
    verificationStatus:MediaStore.lower(raw.verification_status||raw.verificationStatus)||"web_verification_required",
    sectionKey:MediaStore.normalizeSection(row&&row.section_key||raw.section_key||raw.sectionKey),
    priority:row&&row.priority||raw.priority||"B2",
    riskLevel:row&&row.risk_level||raw.risk_level||raw.riskLevel||"unverified",
    candidateOnly:raw.candidateOnly===false||raw.candidate_only===false?false:true,
    seedContent:raw.seedContent===false||raw.seed_content===false?false:true,
    rightsStatus:row&&row.rights_status||raw.rights_status||raw.rightsStatus||"web_verification_required",
    allowedUse:row&&row.allowed_use||raw.allowed_use||raw.allowedUse||"verification_required",
    approvedAt:null,
    blockedReason:null,
    reviewNote:null,
    reviewedBy:null,
    reviewedAt:null
  };
}
function restorePatch(row,body,actor,toHold){
  const info=audit(actor,body);
  const record=exclusionOf(row);
  const exact=Object.keys(record).length>0;
  const previous=exact?MediaStore.plain(record.previous):legacyRestoreState(row);
  const raw=rawWithHistory(row,info,toHold?"restore_hold":"restore_original",{
    exactOriginalState:exact,
    toReviewStatus:toHold?"hold":previous.reviewStatus,
    toVerificationStatus:toHold?"hold":previous.verificationStatus,
    toSectionKey:previous.sectionKey,
    toPriority:previous.priority
  });
  delete raw.queueExclusion;
  const common={
    section_key:MediaStore.normalizeSection(previous.sectionKey||row.section_key),
    priority:previous.priority||row.priority||"B2",
    review_note:toHold?(info.note||"search_exclusion_released_to_hold"):nullable(previous.reviewNote),
    reviewed_by:toHold?info.by:nullable(previous.reviewedBy),
    reviewed_at:toHold?info.now:nullable(previous.reviewedAt),
    updated_by:info.by,
    updated_at:info.now,
    raw
  };
  if(toHold)return Object.assign(common,{
    review_status:"hold",
    verification_status:"hold",
    risk_level:previous.riskLevel||row.risk_level||"unverified",
    candidate_only:true,
    seed_content:true,
    rights_status:previous.rightsStatus||row.rights_status||"web_verification_required",
    allowed_use:previous.allowedUse||row.allowed_use||"verification_required",
    approved_at:null,
    blocked_reason:null
  });
  return Object.assign(common,{
    review_status:previous.reviewStatus||"pending",
    verification_status:previous.verificationStatus||"web_verification_required",
    risk_level:previous.riskLevel||row.risk_level||"unverified",
    candidate_only:previous.candidateOnly===false?false:true,
    seed_content:previous.seedContent===false?false:true,
    rights_status:previous.rightsStatus||row.rights_status||"web_verification_required",
    allowed_use:previous.allowedUse||row.allowed_use||"verification_required",
    approved_at:nullable(previous.approvedAt),
    blocked_reason:nullable(previous.blockedReason)
  });
}
async function updateRowsIndividually(rows,patcher){
  const updated=[];
  for(const row of rows){
    const saved=await MediaStore.updateCandidates([row.id],patcher(row));
    if(Array.isArray(saved))updated.push(...saved);
  }
  return updated;
}
function requireNote(action,note){
  if(["approve","reject","block","permanent_block"].includes(action)&&MediaStore.text(note).length<3){
    const error=new Error("이 작업은 3자 이상의 관리자 검토 메모가 필요합니다.");
    error.statusCode=400;error.code="administrator_review_note_required";throw error;
  }
}
function validateTransitions(action,rows){
  const invalid=[];
  rows.forEach((row)=>{
    const status=statusOf(row);
    let ok=true;
    if(action==="approve")ok=["pending","hold","safety_quarantine","rights_quarantine","classification_quarantine","quality_quarantine"].includes(status);
    else if(action==="restore")ok=["search_excluded","exclusion_released"].includes(status);
    else if(action==="restore_hold"||action==="release_exclusion")ok=["search_excluded","exclusion_released"].includes(status);
    else if(action==="forget")ok=["search_excluded","exclusion_released","permanent_blocked"].includes(status);
    else if(action==="reset")ok=!["search_excluded","exclusion_released","permanent_blocked"].includes(status);
    else if(action==="hold"||action==="reject"||action==="delete")ok=!["search_excluded","exclusion_released","permanent_blocked"].includes(status);
    if(!ok)invalid.push(MediaStore.text(row.id)+":"+status);
  });
  if(invalid.length){
    const error=new Error("현재 상태에서 허용되지 않는 전환입니다: "+invalid.join(", "));
    error.statusCode=409;error.code="media_candidate_transition_forbidden";throw error;
  }
}
function patchFor(action,body,actor){
  const info=audit(actor,body),now=info.now,by=info.by,note=info.note;
  if(action==="hold")return {review_status:"hold",verification_status:"hold",review_note:note,reviewed_by:by,reviewed_at:now,updated_by:by,updated_at:now};
  if(action==="reject")return {review_status:"rejected",verification_status:"rejected",blocked_reason:note||"rejected_by_admin",review_note:note,reviewed_by:by,reviewed_at:now,updated_by:by,updated_at:now,candidate_only:true,seed_content:true,approved_at:null};
  if(action==="reset")return {review_status:"pending",verification_status:"web_verification_required",review_note:note,reviewed_by:by,reviewed_at:now,updated_by:by,updated_at:now,candidate_only:true,seed_content:true,approved_at:null,blocked_reason:null};
  if(action==="block"||action==="permanent_block")return {review_status:"permanent_blocked",verification_status:"permanent_blocked",rights_status:"blocked",allowed_use:"blocked",blocked_reason:note||"permanent_blocked_by_admin",review_note:note,reviewed_by:by,reviewed_at:now,updated_by:by,updated_at:now,candidate_only:true,seed_content:true,approved_at:null};
  return {};
}
async function approveRows(rows,body,actor){
  if(body.confirmRightsSafe!==true&&body.confirmRightsSafe!=="true"){
    const error=new Error("승인에는 원본 권리 확인이 필요합니다.");
    error.statusCode=400;error.code="rights_confirmation_required";throw error;
  }
  if(body.confirmContentSafe!==true&&body.confirmContentSafe!=="true"){
    const error=new Error("승인에는 실제 재생을 통한 콘텐츠 안전 확인이 필요합니다.");
    error.statusCode=400;error.code="content_safety_confirmation_required";throw error;
  }
  const info=audit(actor,body),blocked=[];
  rows.forEach((row)=>{
    const safety=MediaPolicy.assessSafety(row);
    if(safety.decision==="hard_block")blocked.push({id:row.id,reasons:safety.reasons});
  });
  if(blocked.length){
    const error=new Error("명백한 금지 콘텐츠 신호가 있는 후보는 승인할 수 없습니다.");
    error.statusCode=409;error.code="prohibited_content_cannot_be_approved";error.blocked=blocked;throw error;
  }
  const updated=[];
  for(const row of rows){
    const raw=Object.assign({},MediaStore.plain(row.raw));
    raw.policyAssessment=MediaPolicy.assessCandidate(row);
    raw.administratorReview={
      contentSafe:true,
      rightsSafe:true,
      playbackChecked:true,
      subtitleChecked:body.confirmSubtitlesChecked===true||body.confirmSubtitlesChecked==="true",
      note:info.note,
      reviewedBy:info.by,
      reviewedAt:info.now,
      previousReviewStatus:statusOf(row)
    };
    const saved=await MediaStore.updateCandidates([row.id],{
      review_status:"approved",
      verification_status:"approved_for_snapshot",
      rights_status:"rights_verified_by_admin",
      allowed_use:"approved_for_snapshot",
      candidate_only:false,
      seed_content:false,
      raw,
      review_note:info.note,
      reviewed_by:info.by,
      reviewed_at:info.now,
      approved_at:info.now,
      updated_by:info.by,
      updated_at:info.now,
      blocked_reason:null
    });
    if(Array.isArray(saved))updated.push(...saved);
  }
  return updated;
}

exports.handler=async function(event){
  if(event&&event.httpMethod==="OPTIONS")return MediaStore.response(204,{});
  try{
    if(event.httpMethod!=="POST")return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const actor=await actorFor(event);
    const body=MediaStore.parseBody(event);
    const action=MediaStore.lower(body.action);
    if(!ACTIONS.has(action))return MediaStore.response(400,{ok:false,error:"invalid_action",allowed:Array.from(ACTIONS)});
    const ids=idsFrom(body);
    if(!ids.length)return MediaStore.response(400,{ok:false,error:"candidate_ids_required"});
    const rows=await loadRows(ids);
    validateTransitions(action,rows);
    requireNote(action,body.note||body.reason);
    if(action==="delete"&&(body.confirmQueueDelete!==true&&body.confirmQueueDelete!=="true")){
      return MediaStore.response(400,{ok:false,error:"queue_delete_confirmation_required",message:"검색 제외 목록 이동 확인값이 필요합니다."});
    }
    if(action==="forget"){
      if(body.confirmPermanentDelete!==true&&body.confirmPermanentDelete!=="true"){
        return MediaStore.response(400,{ok:false,error:"permanent_delete_confirmation_required",message:"검색 제외 기록 완전 삭제 확인값이 필요합니다."});
      }
      const deleted=await deleteMany(ids);
      return MediaStore.response(200,{ok:true,version:VERSION,action,requested:ids.length,deleted:Array.isArray(deleted)?deleted.length:0,items:deleted,sourceMediaDeleted:false,recollectAllowed:true});
    }
    if(action==="approve"){
      const updated=await approveRows(rows,body,actor);
      return MediaStore.response(200,{ok:true,version:VERSION,action,requested:ids.length,updated:updated.length,items:updated,sourceMediaDeleted:false,recollectAllowed:false,publicationGate:MediaPolicy.VERSION});
    }
    let updated,legacyFallbackCount=0;
    if(action==="delete"){
      updated=await updateRowsIndividually(rows,(row)=>deletePatch(row,body,actor));
    }else if(action==="restore"||action==="restore_hold"||action==="release_exclusion"){
      legacyFallbackCount=rows.filter((row)=>!Object.keys(exclusionOf(row)).length).length;
      updated=await updateRowsIndividually(rows,(row)=>restorePatch(row,body,actor,action!=="restore"));
    }else{
      const patch=patchFor(action,body,actor);
      updated=await updateMany(ids,patch);
    }
    return MediaStore.response(200,{
      ok:true,version:VERSION,action,requested:ids.length,
      updated:Array.isArray(updated)?updated.length:0,items:updated,
      sourceMediaDeleted:false,recollectAllowed:false,
      restoredToQueue:action==="restore",movedToSearchExclusion:action==="delete",
      restoredToHold:action==="restore_hold"||action==="release_exclusion",
      restoredOriginalState:action==="restore",
      legacyFallbackCount,
      permanentBlocked:action==="block"||action==="permanent_block"
    });
  }catch(error){
    return MediaStore.response(error.statusCode||500,{ok:false,version:VERSION,error:error.code||"media_candidate_action_failed",message:error.message||String(error),blocked:error.blocked||undefined});
  }
};
