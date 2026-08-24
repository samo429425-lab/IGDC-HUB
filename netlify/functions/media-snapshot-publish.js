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
const MediaReleaseAdapter = require("./lib/media-searchbank-release-adapter.v1");

const VERSION = "media-snapshot-publish-v1.13.0-content-ready-section-safe";
const MANUAL_SECTIONS=Array.from(MediaStore.ALLOWED_SECTIONS);
const STATUS_SECTIONS=["media-trending"].concat(MANUAL_SECTIONS);

function componentStatus(){
  let storage=null;
  try{storage=MediaStore.releaseStorageContract();}catch(error){storage={ok:false,error:MediaStore.text(error&&error.message||error)};}
  let core=null;
  try{core=MediaReleaseAdapter.assertSearchBankCoreApi();}catch(error){core={ok:false,error:MediaStore.text(error&&error.message||error)};}
  return{
    publishVersion:VERSION,storeVersion:MediaStore.VERSION,adapterVersion:MediaReleaseAdapter.VERSION,
    dispatchVersion:MediaReleaseDispatch.VERSION,searchBankCore:core,releaseStorage:storage
  };
}

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
function frontContentEnabled(row){
  const raw=MediaStore.plain(row&&row.raw),control=MediaStore.plain(raw.frontControl);
  return control.enabled!==false;
}
function sectionSlots(section){return Array.isArray(section)?section:(section&&Array.isArray(section.slots)?section.slots:[]);}
function blankSlot(slot,index){
  return{slotId:Number(slot&&slot.slotId)||index+1,contentId:null,title:null,thumb:"#",provider:null,placeholder:true};
}
function cleanBaseSnapshot(snapshot){
  const next=clone(snapshot);
  next.sections=Object.assign({},next.sections||{});
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    const original=next.sections[sectionKey];
    const objectSection=Array.isArray(original)?{key:sectionKey,title:sectionKey,slots:original}:Object.assign({},original||{key:sectionKey,title:sectionKey});
    const slots=sectionSlots(original).map((slot,index)=>{
      if(slot&&slot.managedBy==="media-snapshot-publish"){
        return slot.fallbackSample&&typeof slot.fallbackSample==="object"?Object.assign(clone(slot.fallbackSample),{slotId:Number(slot.slotId)||index+1}):blankSlot(slot,index);
      }
      return clone(slot);
    });
    objectSection.slots=slots;
    next.sections[sectionKey]=objectSection;
  });
  return next;
}
function attachCommittedFallbacks(snapshot, committedBase){
  const next=clone(snapshot),base=clone(committedBase);
  next.sections=Object.assign({},next.sections||{});
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    const current=next.sections[sectionKey];
    const baseSlots=sectionSlots(base.sections&&base.sections[sectionKey]);
    const objectSection=Array.isArray(current)?{key:sectionKey,title:sectionKey,slots:current}:Object.assign({},current||{key:sectionKey,title:sectionKey});
    const slots=sectionSlots(current).slice();
    const capacity=Math.max(MediaStore.FRONT_CAPACITY,slots.length,baseSlots.length);
    while(slots.length<capacity)slots.push({slotId:slots.length+1,contentId:null,title:null,thumb:"#",provider:null,placeholder:true});
    objectSection.slots=slots.slice(0,MediaStore.FRONT_CAPACITY).map((slot,index)=>{
      const out=Object.assign({},slot,{slotId:index+1});
      if(out.managedBy==="media-snapshot-publish"&&!out.fallbackSample){
        out.fallbackSample=MediaStore.sampleFallbackFor(baseSlots[index]||{},index);
      }
      return out;
    });
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
function stampReleaseControl(snapshot, action, sectionKey, sectionKeys, actor, publicationRequested){
  const next=clone(snapshot),counts=managedCounts(next);
  const contentReady=counts.total>0;
  next.meta=Object.assign({},next.meta||{}, {
    generatedAt:MediaStore.nowIso(),
    generatedBy:"media-snapshot-publish",
    validated:true,crossChecked:true,pipelineReady:true,contentReady,sampleOnly:!contentReady,ready:contentReady,
    filled:counts.sections,
    supplyState:{contentReady,sampleOnly:!contentReady,totalManagedSlots:counts.total,manualSections:MANUAL_SECTIONS.length,frontVisiblePerSection:50,snapshotCapacityPerSection:MediaStore.FRONT_CAPACITY||100},
    releaseControl:{
      action,sectionKey:sectionKey||null,sectionKeys:Array.isArray(sectionKeys)?sectionKeys:[],
      requestedAt:MediaStore.nowIso(),
      requestedBy:MediaStore.compact(actor&&actor.email||actor&&actor.memberId||"admin",200),
      publicationRequested:publicationRequested===true
    }
  });
  next.hero=Object.assign({},plain(next.hero),{
    enabled:true,
    source:["media-movie","media-drama"],
    rotateFrom:["media-movie","media-drama"]
  });
  return next;
}
async function latestStoredRelease(){
  const query=new URLSearchParams();
  query.set("select","release_id,snapshot_hash,snapshot,status,created_at,created_by");
  query.set("status","in.(stored,applied)");
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
  const pipeline=snapshot.meta&&snapshot.meta.releasePipeline||{};
  return{
    ok:true,version:VERSION,hasRelease:true,contentReady:counts.total>0,sampleOnly:counts.total===0,
    releaseId:MediaStore.text(release.release_id),createdAt:MediaStore.text(release.created_at),
    releaseStatus:MediaStore.text(release.status)||"stored",
    action:MediaStore.text(control.action)||"legacy_release",sectionKey:MediaStore.text(control.sectionKey)||null,sectionKeys:Array.isArray(control.sectionKeys)?control.sectionKeys:[],
    totalManagedSlots:counts.total,sections:counts.sections,
    pipelineApplied:pipeline.status==="applied",
    pipelineVersion:MediaStore.text(pipeline.version)||null,
    appliedAt:MediaStore.text(pipeline.appliedAt)||null
  };
}
function eligibleCounts(rows){
  const sections=Object.fromEntries(MANUAL_SECTIONS.map((key)=>[key,{approved:0,eligible:0,frontDisabled:0,blocked:0}]));
  (Array.isArray(rows)?rows:[]).forEach((row)=>{
    const key=MediaStore.normalizeSection(row&&row.section_key);if(!sections[key])return;
    sections[key].approved+=1;
    if(!frontContentEnabled(row)){sections[key].frontDisabled+=1;return;}
    if(MediaStore.snapshotEligible(row))sections[key].eligible+=1;else sections[key].blocked+=1;
  });
  return sections;
}
function publicOrigin(){
  for(const raw of [process.env.URL,process.env.DEPLOY_PRIME_URL]){
    try{const url=new URL(MediaStore.text(raw));if(url.protocol==="https:")return url.origin;}catch(_error){}
  }
  return"";
}
async function fetchPublicJson(origin,pathName){
  if(!origin)return{checked:false,ok:false,reason:"public_origin_unavailable",document:null};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(origin+pathName+(pathName.includes("?")?"&":"?")+"pipeline_probe="+Date.now(),{signal:controller.signal,headers:{accept:"application/json","cache-control":"no-cache"}});
    if(!response.ok)return{checked:true,ok:false,reason:"public_http_"+response.status,document:null};
    const document=await response.json();return{checked:true,ok:true,reason:null,document};
  }catch(error){return{checked:true,ok:false,reason:/abort/i.test(String(error&&error.name||error))?"public_probe_timeout":"public_probe_failed",document:null};}
  finally{clearTimeout(timer);}
}
async function pipelineStatusDocument(release,rows,probePublic){
  const candidateSections=eligibleCounts(rows),releaseSnapshot=release&&release.snapshot||{};
  const releaseState=MediaReleaseAdapter.sectionState(releaseSnapshot),pipeline=releaseSnapshot&&releaseSnapshot.meta&&releaseSnapshot.meta.releasePipeline||{};
  let publicMedia={checked:false,ok:false,reason:"probe_not_requested",document:null};
  let publicBank={checked:false,ok:false,reason:"probe_not_requested",document:null};
  if(probePublic){
    const origin=publicOrigin();
    [publicMedia,publicBank]=await Promise.all([
      fetchPublicJson(origin,"/data/media.snapshot.json"),
      fetchPublicJson(origin,"/data/search-bank.snapshot.json")
    ]);
  }
  const publicState=publicMedia.document?MediaReleaseAdapter.sectionState(publicMedia.document):{totalManaged:0,sections:{}};
  const publicPipeline=publicMedia.document&&publicMedia.document.meta&&publicMedia.document.meta.releasePipeline||{};
  const publicBankItems=publicBank.document?MediaReleaseAdapter.ownedItems(publicBank.document,release&&release.release_id):[];
  const sections={};
  MANUAL_SECTIONS.forEach((key)=>{
    sections[key]={
      approvedCandidates:candidateSections[key].approved,
      eligibleCandidates:candidateSections[key].eligible,
      frontDisabledCandidates:candidateSections[key].frontDisabled,
      policyBlockedCandidates:candidateSections[key].blocked,
      releaseManagedSlots:releaseState.sections[key].managedCount,
      releaseContentIds:releaseState.sections[key].contentIds,
      publicManagedSlots:publicState.sections[key]?publicState.sections[key].managedCount:null,
      publicContentIds:publicState.sections[key]?publicState.sections[key].contentIds:[]
    };
  });
  const trendingSources=["media-movie","media-drama","media-variety","media-music"];
  const publicTrendingSlots=publicMedia.document?MediaReleaseAdapter.slotsOf(publicMedia.document.sections&&publicMedia.document.sections["media-trending"]):[];
  sections["media-trending"]={
    automatic:true,manualPublicationAllowed:false,sourceSections:trendingSources,
    approvedSourceCandidates:trendingSources.reduce((sum,key)=>sum+candidateSections[key].approved,0),
    eligibleSourceCandidates:trendingSources.reduce((sum,key)=>sum+candidateSections[key].eligible,0),
    releaseManagedSlots:0,releaseContentIds:[],
    publicSlotCount:publicMedia.ok?publicTrendingSlots.length:null,
    publicManagedSlots:0,publicContentIds:[]
  };
  const releaseId=MediaStore.text(release&&release.release_id),releaseApplied=pipeline.status==="applied";
  const publicReleaseMatches=publicMedia.ok===true&&MediaStore.text(publicPipeline.releaseId)===releaseId;
  const publicSectionsMatch=publicMedia.ok===true&&MANUAL_SECTIONS.every((key)=>{
    const expected=releaseState.sections[key],actual=publicState.sections[key];
    return actual&&JSON.stringify(expected.contentIds)===JSON.stringify(actual.contentIds);
  });
  const publicBankHash=publicBank.ok?MediaReleaseAdapter.sha256(publicBank.document):null;
  const publicBankMatches=publicBank.ok===true&&MediaStore.text(pipeline.searchBankHash)===publicBankHash;
  const publicMatches=publicReleaseMatches&&publicSectionsMatch&&publicBankMatches;
  const publicationTrigger=typeof MediaReleaseDispatch.configurationStatus==="function"?MediaReleaseDispatch.configurationStatus():{version:MediaReleaseDispatch.VERSION||null};
  const approvedRows=Array.isArray(rows)?rows.length:0;
  const eligibleRows=MANUAL_SECTIONS.reduce((sum,key)=>sum+Number(candidateSections[key]&&candidateSections[key].eligible||0),0);
  const frontDisabledRows=MANUAL_SECTIONS.reduce((sum,key)=>sum+Number(candidateSections[key]&&candidateSections[key].frontDisabled||0),0);
  const policyBlockedRows=MANUAL_SECTIONS.reduce((sum,key)=>sum+Number(candidateSections[key]&&candidateSections[key].blocked||0),0);
  const searchBankApplied=releaseApplied&&!!MediaStore.text(pipeline.searchBankHash);
  const snapshotEngineApplied=releaseApplied&&Array.isArray(pipeline.snapshotEngineCompletedHandlers)&&pipeline.snapshotEngineCompletedHandlers.includes("media");
  let firstFailureStage=null,failureReason=null,nextAction=null;
  if(approvedRows===0){firstFailureStage="candidate_approval";failureReason="최종 승인 후보가 0건입니다.";nextAction="관리자 승인 상태를 확인하십시오.";}
  else if(eligibleRows===0){firstFailureStage="candidate_eligibility";failureReason="승인 후보는 있으나 frontEnabled·권리·검증 정책을 통과한 후보가 0건입니다.";nextAction="섹션별 frontDisabled/policyBlocked 수와 탈락 사유를 확인하십시오.";}
  else if(!release){firstFailureStage="release_storage";failureReason="SearchBank 전달용 미디어 release가 저장되지 않았습니다.";nextAction="프론트 미디어 허브 반영 실행 후 release 저장 결과를 확인하십시오.";}
  else if(releaseState.totalManaged===0){firstFailureStage="release_snapshot_generation";failureReason="적격 후보는 있으나 release 스냅샷 관리 슬롯이 0건입니다.";nextAction="섹션 용량·스냅샷 생성 정책을 확인하십시오.";}
  else if(!searchBankApplied){firstFailureStage="searchbank_entry";failureReason="release는 존재하지만 SearchBank 적용 기록이 없습니다.";nextAction="미디어 Build Plugin과 SearchBank 어댑터 진입 로그를 확인하십시오.";}
  else if(!snapshotEngineApplied){firstFailureStage="snapshot_engine";failureReason="SearchBank 적용 후 Snapshot Engine media 핸들러 완료 기록이 없습니다.";nextAction="Snapshot Engine media 처리 로그를 확인하십시오.";}
  else if(probePublic&&publicBank.ok!==true){firstFailureStage="public_searchbank_probe";failureReason="공개 search-bank.snapshot.json을 읽지 못했습니다: "+MediaStore.text(publicBank.reason);nextAction="실제 배포 URL과 공개 data 경로를 확인하십시오.";}
  else if(probePublic&&!publicBankMatches){firstFailureStage="public_searchbank_deploy";failureReason="빌드 내부 SearchBank 해시/미디어 항목과 공개 search-bank.snapshot.json이 일치하지 않습니다.";nextAction="Build Hook 대상 사이트와 Netlify publish 경계에서 data/search-bank.snapshot.json 반영 여부를 확인하십시오.";}
  else if(probePublic&&publicMedia.ok!==true){firstFailureStage="public_media_probe";failureReason="공개 media.snapshot.json을 읽지 못했습니다: "+MediaStore.text(publicMedia.reason);nextAction="실제 배포 URL과 공개 data 경로를 확인하십시오.";}
  else if(probePublic&&(!publicReleaseMatches||!publicSectionsMatch)){firstFailureStage="public_media_deploy";failureReason="공개 media.snapshot.json의 release 또는 섹션 콘텐츠가 빌드 결과와 일치하지 않습니다.";nextAction="Netlify 배포 완료 후 공개 media snapshot 치환 여부를 확인하십시오.";}
  return{
    ok:true,reportType:"igdc-media-front-pipeline-status",version:VERSION,adapterVersion:MediaReleaseAdapter.VERSION,components:componentStatus(),generatedAt:MediaStore.nowIso(),
    pipelineComplete:releaseApplied&&(!probePublic||publicMatches),contentReady:releaseState.totalManaged>0,sampleOnly:releaseState.totalManaged===0,firstFailureStage,failureReason,nextAction,publicOrigin:probePublic?publicOrigin():null,
    stages:{
      releaseStorage:Object.assign({readable:true,latestReleasePresent:!!release,contract:"media-release-row-v1-canonical-columns-only"},componentStatus().releaseStorage||{}),
      candidates:{source:"supabase.media_candidates",approvedRows,eligibleRows,frontDisabledRows,policyBlockedRows,sections:candidateSections},
      release:{present:!!release,releaseId,status:MediaStore.text(release&&release.status)||null,requestHash:MediaStore.text(pipeline.requestHash||release&&release.snapshot_hash)||null,outputHash:MediaStore.text(release&&release.snapshot_hash)||null,action:MediaStore.text(releaseSnapshot&&releaseSnapshot.meta&&releaseSnapshot.meta.releaseControl&&releaseSnapshot.meta.releaseControl.action)||null,totalManagedSlots:releaseState.totalManaged,publicationTrigger},
      searchBank:{applied:searchBankApplied,hash:MediaStore.text(pipeline.searchBankHash)||null,releaseMediaItemCount:Number(pipeline.searchBankMediaCount||0),publicProbeChecked:publicBank.checked,publicProbeOk:publicBank.ok,publicProbeReason:publicBank.reason,publicHash:publicBankHash,publicHashMatches:publicBank.checked?publicBankMatches:null,publicReleaseMediaItemCount:publicBank.ok?publicBankItems.length:null},
      snapshotEngine:{applied:snapshotEngineApplied,version:MediaStore.text(pipeline.snapshotEngineVersion)||null,completedHandlers:Array.isArray(pipeline.snapshotEngineCompletedHandlers)?pipeline.snapshotEngineCompletedHandlers:[],appliedAt:MediaStore.text(pipeline.appliedAt)||null},
      publicMediaSnapshot:{checked:publicMedia.checked,ok:publicMedia.ok,reason:publicMedia.reason,releaseId:MediaStore.text(publicPipeline.releaseId)||null,releaseIdMatches:publicMedia.checked?publicReleaseMatches:null,sectionContentIdsMatch:publicMedia.checked?publicSectionsMatch:null,totalManagedSlots:publicMedia.ok?publicState.totalManaged:null}
    },
    sectionOrder:STATUS_SECTIONS,sections
  };
}
exports.buildPipelineStatusDocument=pipelineStatusDocument;
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
    if(params.pipelineStatus === "1" || params.pipelineStatus === 1 || params.pipelineStatus === true){
      const release=await latestStoredRelease();
      const rows=await MediaStore.selectCandidates(queryApproved(params.limit));
      const probePublic=params.probePublic === "1" || params.probePublic === 1 || params.probePublic === true;
      return MediaStore.response(200,await pipelineStatusDocument(release,rows,probePublic));
    }
    const frontAction=MediaStore.text(params.frontAction)||(publishFront?"publish_all":"preview_all");
    const sectionKey=MediaStore.normalizeSection(params.sectionKey);
    const rawSectionKeys=Array.isArray(params.sectionKeys)?params.sectionKeys:MediaStore.text(params.sectionKeys).split(",").filter(Boolean);
    const sectionKeys=Array.from(new Set(rawSectionKeys.map((key)=>MediaStore.normalizeSection(key)).filter((key)=>MANUAL_SECTIONS.includes(key))));
    const sectionAction=frontAction==="publish_section"||frontAction==="stop_section";
    const batchSectionAction=frontAction==="publish_sections"||frontAction==="stop_sections";
    if(sectionAction&&!sectionKey){
      const error=new Error("섹션별 프론트 작업에는 올바른 미디어 섹션 키가 필요합니다.");
      error.statusCode=400;error.code="media_release_section_required";throw error;
    }
    if(batchSectionAction&&!sectionKeys.length){
      const error=new Error("복수 섹션 프론트 작업에는 하나 이상의 올바른 미디어 섹션 키가 필요합니다.");
      error.statusCode=400;error.code="media_release_sections_required";throw error;
    }
    if(!["preview_all","publish_all","publish_section","publish_sections","stop_section","stop_sections","stop_all"].includes(frontAction)){
      const error=new Error("지원하지 않는 프론트 공개 작업입니다.");
      error.statusCode=400;error.code="media_release_action_invalid";throw error;
    }
    const needsCandidates=!frontAction.startsWith("stop_");
    const allApprovedRows=needsCandidates?await MediaStore.selectCandidates(queryApproved(params.limit)):[];
    const scopeKeys=sectionAction?[sectionKey]:(batchSectionAction?sectionKeys:[]);
    const scopedApprovedRows=scopeKeys.length?allApprovedRows.filter((row)=>scopeKeys.includes(MediaStore.normalizeSection(row&&row.section_key))):allApprovedRows;
    const rows=scopedApprovedRows.filter(frontContentEnabled);
    const frontDisabledRows=scopedApprovedRows.filter((row)=>!frontContentEnabled(row));
    const base=baseSnapshot();
    const cleanBase=cleanBaseSnapshot(base.doc);
    const previous=(publishFront||storeRelease)?await latestStoredRelease():null;
    const persistentBase=previous&&previous.snapshot?attachCommittedFallbacks(previous.snapshot,cleanBase):cleanBase;
    let snapshot;
    const buildOptions=Number(params.capacityPerSection)>0?{capacityPerSection:Number(params.capacityPerSection)}:{};
    if(frontAction==="stop_all"){
      snapshot=cleanBase;
    }else if(frontAction==="stop_section"||frontAction==="stop_sections"){
      const keys=frontAction==="stop_section"?[sectionKey]:sectionKeys;
      snapshot=clone(persistentBase);
      snapshot.sections=Object.assign({},snapshot.sections||{});
      keys.forEach((key)=>{snapshot.sections[key]=clone(cleanBase.sections&&cleanBase.sections[key]||{key,title:key,slots:[]});});
    }else if(frontAction==="publish_section"||frontAction==="publish_sections"){
      const keys=frontAction==="publish_section"?[sectionKey]:sectionKeys;
      const generated=MediaStore.buildSnapshot(persistentBase,Array.isArray(rows)?rows:[],buildOptions);
      snapshot=clone(persistentBase);
      snapshot.sections=Object.assign({},snapshot.sections||{});
      keys.forEach((key)=>{snapshot.sections[key]=clone(generated.sections&&generated.sections[key]||cleanBase.sections[key]);});
    }else{
      snapshot=MediaStore.buildSnapshot(persistentBase,Array.isArray(rows)?rows:[],buildOptions);
    }
    snapshot=stampReleaseControl(snapshot,frontAction,sectionKey,batchSectionAction?sectionKeys:[],actor,publishFront);
    // Hash exactly the JSON document that will be persisted. JSON persistence drops
    // undefined-valued properties; hashing the pre-serialization object makes the
    // build-time integrity check fail even though the release itself is valid.
    snapshot=JSON.parse(JSON.stringify(snapshot));
    // Use the same serialized-JSON hash contract as the SearchBank release adapter.
    // Supabase/public JSON cannot preserve `undefined` object properties.
    const hash=MediaReleaseAdapter.sha256(snapshot);
    const eligible=Array.isArray(rows)?rows.filter(MediaStore.snapshotEligible).length:0;
    const blocked=Array.isArray(rows)?rows.filter((row)=>!MediaStore.snapshotEligible(row)).map((row)=>({id:MediaStore.text(row&&row.id),reasons:MediaStore.MediaPolicy.releaseEligibility(row).reasons})):[]; 
    const allowEmptySection=params.allowEmptySection===true||params.allowEmptySection==="true";
    if(publishFront&&needsCandidates&&eligible===0&&!allowEmptySection){
      const error=new Error("프론트에 반영할 승인·권리확인·공개검증 완료 후보가 없습니다.");
      error.statusCode=409;error.code="no_verified_promotable_media";throw error;
    }
    if(publishFront&&needsCandidates&&!allowEmptySection&&(frontAction==="publish_section"||frontAction==="publish_sections")){
      const targets=frontAction==="publish_section"?[sectionKey]:sectionKeys;
      const eligibleBySection=Object.fromEntries(targets.map((key)=>[key,rows.filter((row)=>MediaStore.normalizeSection(row&&row.section_key)===key&&MediaStore.snapshotEligible(row)).length]));
      const emptyTargets=targets.filter((key)=>eligibleBySection[key]===0);
      if(emptyTargets.length){
        const error=new Error("대상 섹션에 프론트 반영 가능한 승인 콘텐츠가 없습니다: "+emptyTargets.join(", "));
        error.statusCode=409;error.code="media_release_target_section_empty";error.sections=emptyTargets;throw error;
      }
    }
    const release={
      release_id:"media_snapshot_"+MediaStore.shortHash({hash,at:MediaStore.nowIso()}),
      snapshot_hash:hash,
      snapshot,
      status: storeRelease ? "stored" : "preview",
      policyVersion:MediaStore.MediaPolicy.VERSION,
      counts:{approvedRows:Array.isArray(scopedApprovedRows)?scopedApprovedRows.length:0,eligibleRows:eligible,frontDisabledRows:frontDisabledRows.length,policyBlockedRows:blocked.length,sections:snapshot.meta&&snapshot.meta.filled||{},frontAction,sectionKey:sectionKey||null,sectionKeys:batchSectionAction?sectionKeys:[]},
      created_by:MediaStore.compact(actor.email || actor.memberId || "admin",200),
      created_at:MediaStore.nowIso()
    };
    let stored=null;
    if(storeRelease){
      try{
        const inserted=await MediaStore.insertRelease(release);
        const confirmed=await MediaStore.selectReleaseById(release.release_id);
        if(!confirmed||MediaStore.text(confirmed.release_id)!==release.release_id||MediaStore.text(confirmed.snapshot_hash)!==hash||MediaStore.text(confirmed.status)!=="stored"){
          const verifyError=new Error("미디어 프론트 공급 요청 저장 후 재조회 검증에 실패했습니다.");
          verifyError.statusCode=502;verifyError.code="media_release_store_verify_failed";throw verifyError;
        }
        stored={insertedRows:inserted&&inserted.inserted===true?1:(Array.isArray(inserted)?inserted.length:0),verified:true,releaseId:release.release_id,status:confirmed.status,snapshotHash:confirmed.snapshot_hash,table:MediaStore.RELEASE_TABLE,writeColumns:Array.from(MediaStore.RELEASE_WRITE_COLUMNS||[]),storeVersion:MediaStore.VERSION};
      }catch(storageError){
        const error=new Error("승인 콘텐츠는 준비됐지만 미디어 프론트 공급 요청을 release 저장소에 기록하지 못했습니다: "+MediaStore.text(storageError&&storageError.message||storageError));
        error.statusCode=storageError&&storageError.statusCode||502;
        error.code="media_release_storage_failed";
        throw error;
      }
    }
    let frontPublication=null;
    if(publishFront){
      frontPublication=await MediaReleaseDispatch.dispatch({
        releaseId:release.release_id,
        snapshotHash:hash,
        actorId:actor.email||actor.memberId,
        explicitAdminAuthorization:true
      });
      if(!frontPublication||frontPublication.ok!==true||frontPublication.queued!==true){
        const error=new Error("프론트 반영 배포가 실제로 시작되지 않았습니다: "+MediaStore.text(frontPublication&&frontPublication.reason||"build_hook_not_queued"));
        error.statusCode=503;
        error.code="media_front_publication_not_queued";
        throw error;
      }
    }
    if(params.download === "1" || params.download === true || params.format === "snapshot"){
      return {statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","content-disposition":"attachment; filename=media.snapshot.generated.json"},body:JSON.stringify(snapshot,null,2)+"\n"};
    }
    return MediaStore.response(200,{
      ok:true,version:VERSION,policyVersion:MediaStore.MediaPolicy.VERSION,components:componentStatus(),
      baseFile:base.file,hash,approvedRows:Array.isArray(scopedApprovedRows)?scopedApprovedRows.length:0,
      eligibleRows:eligible,frontDisabledRows:frontDisabledRows.length,policyBlockedRows:blocked.length,
      frontAction,sectionKey:sectionKey||null,sectionKeys:batchSectionAction?sectionKeys:[],frontState:statusPayload(Object.assign({},release,{snapshot})),
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
