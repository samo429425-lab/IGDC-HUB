"use strict";

/**
 * Builds a publishable media.snapshot.json from approved Supabase candidates.
 * It does not write runtime files. Use download=1 to receive JSON, or storeRelease=true
 * to save a release copy in Supabase for deployment/build tooling.
 */
const fs = require("fs");
const path = require("path");
const MediaStore = require("./lib/media-candidate-store.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");
const MediaReleaseDispatch = require("./lib/media-release-dispatch.v1");

const VERSION = "media-snapshot-publish-v1.3.0-section-release-stop-control";
const MANUAL_SECTIONS=Array.from(MediaStore.ALLOWED_SECTIONS);

async function actorFor(event, storeRelease){
  const actor = await SharedAdminAuth.resolveUser(event);
  SharedAdminAuth.requireCapability(actor, storeRelease ? "approve" : "mediaRead");
  return actor;
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_e){return null;}}
function baseSnapshot(){
  const root=process.cwd();
  const files=[
    path.join(root,"data","media.snapshot.json"),
    path.join(root,"netlify","functions","data","media.snapshot.json"),
    path.join(__dirname,"data","media.snapshot.json")
  ];
  for(const file of files){const doc=readJson(file);if(doc)return {file,doc};}
  const sections={"media-trending":[]};
  Array.from(MediaStore.ALLOWED_SECTIONS).forEach((key)=>{sections[key]={key,title:key,slots:[]};});
  return {file:"generated-empty",doc:{version:"media.snapshot.empty",type:"media_snapshot",sections,meta:{}}};
}
function queryApproved(limit){
  const safeLimit=Math.max(1,Math.min(2000,Number(limit)||1800));
  return "select=*&review_status=eq.approved&verification_status=eq.approved_for_snapshot&candidate_only=eq.false&seed_content=eq.false&order=section_key.asc,approved_at.desc,title.asc&limit="+safeLimit;
}
function clone(value){return JSON.parse(JSON.stringify(value==null?{}:value));}
function sectionSlots(section){return Array.isArray(section)?section:(section&&Array.isArray(section.slots)?section.slots:[]);}
function blankSlot(slot,index){
  return{slotId:Number(slot&&slot.slotId)||index+1,contentId:null,title:null,thumb:"#",provider:null};
}
function cleanBaseSnapshot(snapshot){
  const next=clone(snapshot);
  next.sections=Object.assign({},next.sections||{});
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    const original=next.sections[sectionKey];
    const objectSection=Array.isArray(original)?{key:sectionKey,title:sectionKey,slots:original}:Object.assign({},original||{key:sectionKey,title:sectionKey});
    const slots=sectionSlots(original).map((slot,index)=>slot&&slot.managedBy==="media-snapshot-publish"?blankSlot(slot,index):clone(slot));
    objectSection.slots=slots;
    next.sections[sectionKey]=objectSection;
  });
  return next;
}
function managedCounts(snapshot){
  const sections={};let total=0;
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    const count=sectionSlots(snapshot&&snapshot.sections&&snapshot.sections[sectionKey]).filter((slot)=>slot&&slot.managedBy==="media-snapshot-publish"&&MediaStore.MediaPolicy.publicReleaseAllowed(slot)).length;
    sections[sectionKey]=count;total+=count;
  });
  return{sections,total};
}
function stampReleaseControl(snapshot, action, sectionKey, actor){
  const next=clone(snapshot),counts=managedCounts(next);
  next.meta=Object.assign({},next.meta||{}, {
    generatedAt:MediaStore.nowIso(),
    generatedBy:"media-snapshot-publish",
    filled:counts.sections,
    releaseControl:{
      action,sectionKey:sectionKey||null,
      requestedAt:MediaStore.nowIso(),
      requestedBy:MediaStore.compact(actor&&actor.email||actor&&actor.memberId||"admin",200)
    }
  });
  return next;
}
async function latestStoredRelease(){
  const query=new URLSearchParams();
  query.set("select","release_id,snapshot_hash,snapshot,status,created_at,created_by");
  query.set("status","eq.stored");
  query.set("order","created_at.desc");
  query.set("limit","1");
  const rows=await MediaStore.supabase(MediaStore.rest(MediaStore.RELEASE_TABLE,query.toString()),{method:"GET"});
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}
function statusPayload(release){
  if(!release)return{ok:true,version:VERSION,hasRelease:false,totalManagedSlots:0,sections:Object.fromEntries(MANUAL_SECTIONS.map((key)=>[key,0]))};
  const snapshot=release.snapshot&&typeof release.snapshot==="object"?release.snapshot:{};
  const counts=managedCounts(snapshot);
  const control=snapshot.meta&&snapshot.meta.releaseControl||{};
  return{
    ok:true,version:VERSION,hasRelease:true,
    releaseId:MediaStore.text(release.release_id),createdAt:MediaStore.text(release.created_at),
    action:MediaStore.text(control.action)||"legacy_release",sectionKey:MediaStore.text(control.sectionKey)||null,
    totalManagedSlots:counts.total,sections:counts.sections
  };
}
exports.handler = async function(event){
  if(event && event.httpMethod === "OPTIONS") return MediaStore.response(204,{});
  try{
    if(!["GET","POST"].includes(event.httpMethod)) return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const params=Object.assign({}, event.queryStringParameters || {}, event.httpMethod === "POST" ? MediaStore.parseBody(event) : {});
    const publishFront = params.publishFront === true || params.publishFront === "true";
    const storeRelease = publishFront || params.storeRelease === true || params.storeRelease === "true";
    const actor=await actorFor(event, storeRelease);
    if(params.frontStatus === "1" || params.frontStatus === 1 || params.frontStatus === true){
      return MediaStore.response(200,statusPayload(await latestStoredRelease()));
    }
    const frontAction=MediaStore.text(params.frontAction)||(publishFront?"publish_all":"preview_all");
    const sectionKey=MediaStore.normalizeSection(params.sectionKey);
    const sectionAction=frontAction==="publish_section"||frontAction==="stop_section";
    if(sectionAction&&!sectionKey){
      const error=new Error("섹션별 프론트 작업에는 올바른 미디어 섹션 키가 필요합니다.");
      error.statusCode=400;error.code="media_release_section_required";throw error;
    }
    if(!["preview_all","publish_all","publish_section","stop_section","stop_all"].includes(frontAction)){
      const error=new Error("지원하지 않는 프론트 공개 작업입니다.");
      error.statusCode=400;error.code="media_release_action_invalid";throw error;
    }
    const needsCandidates=!frontAction.startsWith("stop_");
    const allRows=needsCandidates?await MediaStore.selectCandidates(queryApproved(params.limit)):[];
    const rows=sectionKey?allRows.filter((row)=>MediaStore.normalizeSection(row&&row.section_key)===sectionKey):allRows;
    const base=baseSnapshot();
    const cleanBase=cleanBaseSnapshot(base.doc);
    const previous=publishFront?await latestStoredRelease():null;
    let snapshot;
    const buildOptions=Number(params.capacityPerSection)>0?{capacityPerSection:Number(params.capacityPerSection)}:{};
    if(frontAction==="stop_all"){
      snapshot=cleanBase;
    }else if(frontAction==="stop_section"){
      snapshot=clone(previous&&previous.snapshot||cleanBase);
      snapshot.sections=Object.assign({},snapshot.sections||{});
      snapshot.sections[sectionKey]=clone(cleanBase.sections&&cleanBase.sections[sectionKey]||{key:sectionKey,title:sectionKey,slots:[]});
    }else if(frontAction==="publish_section"){
      const generated=MediaStore.buildSnapshot(cleanBase,Array.isArray(rows)?rows:[],buildOptions);
      snapshot=clone(previous&&previous.snapshot||cleanBase);
      snapshot.sections=Object.assign({},snapshot.sections||{});
      snapshot.sections[sectionKey]=clone(generated.sections&&generated.sections[sectionKey]||cleanBase.sections[sectionKey]);
    }else{
      snapshot=MediaStore.buildSnapshot(cleanBase,Array.isArray(rows)?rows:[],buildOptions);
    }
    snapshot=stampReleaseControl(snapshot,frontAction,sectionKey,actor);
    const hash=MediaStore.sha256(snapshot);
    const eligible=Array.isArray(rows)?rows.filter(MediaStore.snapshotEligible).length:0;
    const blocked=Array.isArray(rows)?rows.filter((row)=>!MediaStore.snapshotEligible(row)).map((row)=>({id:MediaStore.text(row&&row.id),reasons:MediaStore.MediaPolicy.releaseEligibility(row).reasons})):[]; 
    if(publishFront&&needsCandidates&&eligible===0){
      const error=new Error("프론트에 반영할 승인·권리확인·공개검증 완료 후보가 없습니다.");
      error.statusCode=409;error.code="no_verified_promotable_media";throw error;
    }
    const release={
      release_id:"media_snapshot_"+MediaStore.shortHash({hash,at:MediaStore.nowIso()}),
      snapshot_hash:hash,
      snapshot,
      status: storeRelease ? "stored" : "preview",
      policyVersion:MediaStore.MediaPolicy.VERSION,
      counts:{approvedRows:Array.isArray(rows)?rows.length:0,eligibleRows:eligible,policyBlockedRows:blocked.length,sections:snapshot.meta&&snapshot.meta.filled||{},frontAction,sectionKey:sectionKey||null},
      created_by:MediaStore.compact(actor.email || actor.memberId || "admin",200),
      created_at:MediaStore.nowIso()
    };
    let stored=null;
    if(storeRelease) stored=await MediaStore.insertRelease(release);
    let frontPublication=null;
    if(publishFront){
      frontPublication=await MediaReleaseDispatch.dispatch({
        releaseId:release.release_id,
        snapshotHash:hash,
        actorId:actor.email||actor.memberId
      });
    }
    if(params.download === "1" || params.download === true || params.format === "snapshot"){
      return {statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","content-disposition":"attachment; filename=media.snapshot.generated.json"},body:JSON.stringify(snapshot,null,2)+"\n"};
    }
    return MediaStore.response(200,{
      ok:true,version:VERSION,policyVersion:MediaStore.MediaPolicy.VERSION,
      baseFile:base.file,hash,approvedRows:Array.isArray(rows)?rows.length:0,
      eligibleRows:eligible,policyBlockedRows:blocked.length,
      frontAction,sectionKey:sectionKey||null,frontState:statusPayload(Object.assign({},release,{snapshot})),
      blocked:params.includeBlocked==="1"?blocked:undefined,
      releaseStored:!!stored,stored,
      frontPublicationRequested:publishFront,
      frontPublication,
      release:params.includeSnapshot === "1" ? release : Object.assign({}, release, {snapshot:undefined}),
      snapshot:params.includeSnapshot === "1" ? snapshot : undefined
    });
  }catch(error){
    return MediaStore.response(error.statusCode || 500,{ok:false,version:VERSION,error:error.code||"media_snapshot_publish_failed",message:error.message||String(error)});
  }
};
