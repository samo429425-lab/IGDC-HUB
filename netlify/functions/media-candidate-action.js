"use strict";

/**
 * Guarded administrator transitions for Supabase media candidates.
 * Queue deletion changes only the search record; provider media is untouched.
 */
const MediaStore = require("./lib/media-candidate-store.v1");
const MediaPolicy = require("./lib/media-candidate-policy.v2");
const SharedAdminAuth = require("./lib/global-slot-console-auth");

const VERSION = "media-candidate-action-v1.10.0-canonical-lifecycle";
const ACTIONS = new Set([
  "approve","approve_all","hold","block","reject","reset","delete","front_enable","front_disable",
  "restore_hold","release_exclusion","restore","resume","permanent_block","forget"
]);
const EXCLUSION_RECORD_VERSION = "media-candidate-exclusion-v1";

const APPROVABLE_REVIEW_STATUSES = Object.freeze([
  "pending","hold","safety_quarantine","rights_quarantine","classification_quarantine","quality_quarantine"
]);
async function loadAllApprovableRows(){
  const query="select=*&review_status=in.("+APPROVABLE_REVIEW_STATUSES.join(",")+")&order=section_key.asc,updated_at.desc&limit=10000";
  const rows=await MediaStore.selectCandidates(query);
  return Array.isArray(rows)?rows:[];
}

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
  if((action==="approve"||action==="approve_all")&&MediaStore.text(note).length<3){
    const error=new Error("공개 승인에는 3자 이상의 관리자 검토 메모가 필요합니다.");
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
    else if(action==="forget")ok=true;
    else if(action==="resume")ok=status==="hold";
    else if(action==="front_enable"||action==="front_disable")ok=status==="approved";
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
function holdPatch(row,body,actor){
  const info=audit(actor,body);
  const raw=rawWithHistory(row,info,"hold",{toReviewStatus:"hold",toVerificationStatus:"hold"});
  const existing=MediaStore.plain(raw.candidateHoldRestore);
  if(statusOf(row)!=="hold" || !Object.keys(existing).length){
    raw.candidateHoldRestore={
      version:"media-candidate-hold-restore-v1",
      heldAt:info.now,heldBy:info.by,
      previous:{
        reviewStatus:nullable(row.review_status),verificationStatus:nullable(row.verification_status),
        candidateOnly:nullable(row.candidate_only),seedContent:nullable(row.seed_content),
        rightsStatus:nullable(row.rights_status),allowedUse:nullable(row.allowed_use),approvedAt:nullable(row.approved_at),
        blockedReason:nullable(row.blocked_reason),reviewNote:nullable(row.review_note),reviewedBy:nullable(row.reviewed_by),reviewedAt:nullable(row.reviewed_at)
      }
    };
  }
  return {review_status:"hold",verification_status:"hold",review_note:info.note,reviewed_by:info.by,reviewed_at:info.now,updated_by:info.by,updated_at:info.now,candidate_only:true,seed_content:true,approved_at:null,raw};
}
function holdRestoreSource(row){
  const raw=MediaStore.plain(row&&row.raw);
  const exact=MediaStore.plain(raw.candidateHoldRestore);
  if(Object.keys(exact).length)return {exact:true,previous:MediaStore.plain(exact.previous)};
  const legacy=MediaStore.plain(raw.poolLifecycle);
  if(MediaStore.lower(legacy.state)==="hold")return {exact:true,legacy:true,previous:{
    reviewStatus:legacy.previousReviewStatus,verificationStatus:legacy.previousVerificationStatus,
    candidateOnly:legacy.previousCandidateOnly,seedContent:legacy.previousSeedContent,
    rightsStatus:legacy.previousRightsStatus,allowedUse:legacy.previousAllowedUse,approvedAt:legacy.previousApprovedAt,
    blockedReason:legacy.previousBlockedReason
  }};
  return {exact:false,previous:{reviewStatus:"pending",verificationStatus:"web_verification_required",candidateOnly:true,seedContent:true,approvedAt:null,blockedReason:null}};
}
function resumeHoldPatch(row,body,actor){
  const info=audit(actor,body),source=holdRestoreSource(row),previous=MediaStore.plain(source.previous);
  const raw=rawWithHistory(row,info,"resume_hold",{exactOriginalState:source.exact,toReviewStatus:previous.reviewStatus||"pending",toVerificationStatus:previous.verificationStatus||"web_verification_required"});
  delete raw.candidateHoldRestore;
  if(source.legacy){delete raw.poolLifecycle;}
  const reviewStatus=MediaStore.lower(previous.reviewStatus)||"pending";
  const verificationStatus=MediaStore.lower(previous.verificationStatus)||"web_verification_required";
  const wasApproved=reviewStatus==="approved"&&verificationStatus==="approved_for_snapshot";
  return {
    review_status:reviewStatus,verification_status:verificationStatus,
    candidate_only:previous.candidateOnly===false?false:!wasApproved,
    seed_content:previous.seedContent===false?false:!wasApproved,
    rights_status:previous.rightsStatus||row.rights_status,
    allowed_use:previous.allowedUse||row.allowed_use,
    approved_at:wasApproved?(previous.approvedAt||info.now):null,
    blocked_reason:nullable(previous.blockedReason),
    review_note:source.exact?nullable(previous.reviewNote):null,
    reviewed_by:source.exact?nullable(previous.reviewedBy):null,
    reviewed_at:source.exact?nullable(previous.reviewedAt):null,
    updated_by:info.by,updated_at:info.now,raw
  };
}
function frontControlPatch(row,body,actor,enabled){
  const info=audit(actor,body);
  const raw=Object.assign({},MediaStore.plain(row&&row.raw));
  const previous=MediaStore.plain(raw.frontControl);
  raw.frontControl={
    enabled:enabled===true,
    changedAt:info.now,
    changedBy:info.by,
    note:info.note|| (enabled?"front_content_enabled":"front_content_disabled"),
    previousEnabled:previous.enabled!==false
  };
  appendHistory(raw,{
    action:enabled?"front_enable":"front_disable",at:info.now,by:info.by,note:info.note,
    frontEnabled:enabled===true,reviewStatus:statusOf(row),verificationStatus:MediaStore.text(row&&row.verification_status)
  });
  return{raw,updated_by:info.by,updated_at:info.now};
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

  // A full approval can contain 100+ candidates. Do not PATCH every row separately:
  // that turns one administrator action into hundreds of network round-trips and can
  // time out before the approval state is durable. Reuse the rows already loaded from
  // Supabase, preserve every table field, change only the media approval columns/raw
  // audit payload, then upsert in small batches.
  const prepared=rows.map((row)=>{
    const raw=Object.assign({},MediaStore.plain(row&&row.raw));
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
    return Object.assign({},row,{
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
  });

  const updated=[];
  const failures=[];
  const batchSize=20;
  for(let offset=0;offset<prepared.length;offset+=batchSize){
    const batch=prepared.slice(offset,offset+batchSize);
    try{
      const saved=await MediaStore.upsertCandidates(batch);
      if(!Array.isArray(saved)||saved.length!==batch.length){
        failures.push({offset,requested:batch.length,saved:Array.isArray(saved)?saved.length:0,error:"approval_batch_return_count_mismatch"});
      }
      if(Array.isArray(saved))updated.push(...saved);
    }catch(error){
      failures.push({offset,requested:batch.length,saved:0,error:MediaStore.compact(error&&error.message||error,300)});
    }
  }
  if(failures.length){
    const error=new Error("일부 후보 승인 저장에 실패했습니다: "+failures.length+"개 묶음");
    error.statusCode=502;error.code="media_candidate_bulk_approval_partial_failure";
    error.updated=updated.length;error.failures=failures.slice(0,50);throw error;
  }

  // Do not trust only the mutation response. Re-read the exact IDs and prove that the
  // publication gate columns survived persistence before the UI is allowed to proceed.
  const ids=prepared.map((row)=>MediaStore.text(row&&row.id)).filter(Boolean);
  const verified=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const part=ids.slice(offset,offset+100);
    const query="select=id,review_status,verification_status,candidate_only,seed_content,rights_status,allowed_use,approved_at&"+
      "id="+MediaStore.encodeIn(part)+"&review_status=eq.approved&verification_status=eq.approved_for_snapshot&candidate_only=eq.false&seed_content=eq.false&limit=200";
    const rows2=await MediaStore.selectCandidates(query);
    if(Array.isArray(rows2))verified.push(...rows2);
  }
  if(verified.length!==ids.length){
    const verifiedIds=new Set(verified.map((row)=>MediaStore.text(row&&row.id)));
    const missing=ids.filter((id)=>!verifiedIds.has(id));
    const error=new Error("최종 승인 저장 후 재조회 검증이 일치하지 않습니다. 승인 "+ids.length+"건 중 "+verified.length+"건만 확정되었습니다.");
    error.statusCode=502;error.code="media_candidate_approval_persistence_mismatch";
    error.updated=updated.length;error.verified=verified.length;error.missing=missing.slice(0,100);throw error;
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
    requireNote(action,body.note||body.reason);
    if(action==="approve_all"){
      if(body.confirmRightsSafe!==true&&body.confirmRightsSafe!=="true")return MediaStore.response(400,{ok:false,error:"rights_confirmation_required",message:"전체 최종 승인에는 원본 권리 확인이 필요합니다."});
      if(body.confirmContentSafe!==true&&body.confirmContentSafe!=="true")return MediaStore.response(400,{ok:false,error:"content_safety_confirmation_required",message:"전체 최종 승인에는 실제 콘텐츠 안전 확인이 필요합니다."});
      const reviewable=await loadAllApprovableRows();
      const blocked=[];
      const safe=[];
      reviewable.forEach((row)=>{
        const assessment=MediaPolicy.assessSafety(row);
        if(assessment.decision==="hard_block")blocked.push({id:MediaStore.text(row&&row.id),reasons:assessment.reasons});
        else safe.push(row);
      });
      const updated=safe.length?await approveRows(safe,body,actor):[];
      return MediaStore.response(200,{
        ok:true,version:VERSION,action,requested:reviewable.length,updated:updated.length,
        skippedHardBlocked:blocked.length,blocked,items:updated,sourceMediaDeleted:false,recollectAllowed:false,
        publicationGate:MediaPolicy.VERSION,bulkScope:"all_reviewable_sections"
      });
    }
    if(!ids.length)return MediaStore.response(400,{ok:false,error:"candidate_ids_required"});
    const rows=await loadRows(ids);
    validateTransitions(action,rows);
    if(action==="delete"&&(body.confirmQueueDelete!==true&&body.confirmQueueDelete!=="true")){
      return MediaStore.response(400,{ok:false,error:"queue_delete_confirmation_required",message:"검색 제외 목록 이동 확인값이 필요합니다."});
    }
    if(action==="forget"){
      if(body.confirmPermanentDelete!==true&&body.confirmPermanentDelete!=="true"){
        return MediaStore.response(400,{ok:false,error:"permanent_delete_confirmation_required",message:"후보/기록 삭제 확인값이 필요합니다. 삭제 후에는 이후 리서치에서 다시 발견될 수 있습니다."});
      }
      const deleted=await deleteMany(ids);
      return MediaStore.response(200,{ok:true,version:VERSION,action,requested:ids.length,deleted:Array.isArray(deleted)?deleted.length:0,items:deleted,sourceMediaDeleted:false,recollectAllowed:true});
    }
    if(action==="approve"){
      const updated=await approveRows(rows,body,actor);
      return MediaStore.response(200,{ok:true,version:VERSION,action,requested:ids.length,updated:updated.length,items:updated,sourceMediaDeleted:false,recollectAllowed:false,publicationGate:MediaPolicy.VERSION});
    }
    if(action==="hold"){
      const updated=await updateRowsIndividually(rows,(row)=>holdPatch(row,body,actor));
      return MediaStore.response(200,{ok:true,version:VERSION,action,requested:ids.length,updated:updated.length,items:updated,holdRestorable:true,recollectAllowed:false});
    }
    if(action==="resume"){
      const updated=await updateRowsIndividually(rows,(row)=>resumeHoldPatch(row,body,actor));
      return MediaStore.response(200,{ok:true,version:VERSION,action,requested:ids.length,updated:updated.length,items:updated,resumedFromHold:true,recollectAllowed:false});
    }
    if(action==="front_enable"||action==="front_disable"){
      const enabled=action==="front_enable",updated=await updateRowsIndividually(rows,(row)=>frontControlPatch(row,body,actor,enabled));
      return MediaStore.response(200,{ok:true,version:VERSION,action,requested:ids.length,updated:updated.length,items:updated,frontEnabled:enabled,approvalPreserved:true});
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
