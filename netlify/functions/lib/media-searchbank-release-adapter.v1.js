"use strict";

/**
 * Approved Media Release -> SearchBank contract adapter.
 *
 * This module deliberately does not modify SearchBank Engine, Snapshot Engine,
 * Automap, or committed Snapshot templates.  It only prepares a build-local
 * SearchBank media contract and verifies the Snapshot Engine result.
 */
const crypto=require("crypto");

const VERSION="media-searchbank-release-adapter-v1.0.0";
const OWNER="media-release-searchbank-adapter";
const SLOT_OWNER="media-snapshot-publish";
const MANUAL_SECTIONS=Object.freeze([
  "media-movie","media-drama","media-thriller","media-romance","media-variety",
  "media-documentary","media-animation","media-music","media-shorts"
]);

function text(value){return value==null?"":String(value).trim();}
function plain(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function clone(value){return JSON.parse(JSON.stringify(value==null?{}:value));}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return"["+value.map(stableStringify).join(",")+"]";
  return"{"+Object.keys(value).sort().map((key)=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}";
}
function sha256(value){return crypto.createHash("sha256").update(typeof value==="string"?value:stableStringify(value)).digest("hex");}
function slotsOf(section){return Array.isArray(section)?section:(section&&Array.isArray(section.slots)?section.slots:[]);}
function managedSlot(slot){return !!(slot&&slot.managedBy===SLOT_OWNER&&plain(slot.releaseContract).eligible===true);}
function slotIdOf(slot){return text(slot&&(slot.contentId||slot.id));}
function blankSlot(slot,index){
  return{slotId:Number(slot&&slot.slotId)||index+1,contentId:null,title:null,thumb:"#",provider:null};
}
function mediaUrl(slot){return text(slot&&(slot.video||slot.embedUrl||slot.url||slot.link));}

function releaseInfo(release){
  const snapshot=plain(release&&release.snapshot);
  const control=plain(plain(snapshot.meta).releaseControl);
  const pipeline=plain(plain(snapshot.meta).releasePipeline);
  return{
    releaseId:text(release&&release.release_id),
    requestHash:text(pipeline.requestHash)||text(release&&release.snapshot_hash),
    action:text(control.action)||"legacy_release",
    sectionKey:text(control.sectionKey)||null,
    requestedAt:text(control.requestedAt)||text(release&&release.created_at)||null,
    requestedBy:text(control.requestedBy)||text(release&&release.created_by)||null
  };
}

function desiredBySection(snapshot){
  const sections=plain(snapshot&&snapshot.sections),out={};
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    out[sectionKey]=slotsOf(sections[sectionKey]).filter(managedSlot).map(clone);
  });
  return out;
}

function buildEngineTemplate(releaseSnapshot){
  const next=clone(releaseSnapshot);
  next.sections=Object.assign({},plain(next.sections));
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    const source=next.sections[sectionKey];
    const section=Array.isArray(source)?{key:sectionKey,title:sectionKey,slots:source}:Object.assign({},plain(source));
    section.key=section.key||sectionKey;
    section.slots=slotsOf(source).map((slot,index)=>managedSlot(slot)?blankSlot(slot,index):clone(slot));
    next.sections[sectionKey]=section;
  });
  next.meta=Object.assign({},plain(next.meta),{
    generatedBy:"snapshot-engine-media-release-stage",
    releasePipelineStage:"pre_snapshot_engine"
  });
  return next;
}

function searchBankItem(slot,sectionKey,info,index){
  const id=slotIdOf(slot);
  const url=mediaUrl(slot);
  const releaseContract=plain(slot.releaseContract);
  return{
    id,contentId:id,
    title:text(slot.title),summary:text(slot.summary),description:text(slot.description),
    url,link:url,videoUrl:text(slot.video)||url,embedUrl:text(slot.embedUrl),
    thumb:text(slot.thumb),thumbnail:text(slot.thumb),image:text(slot.thumb),
    provider:text(slot.provider),
    type:"video",mediaType:"video",page:"media",channel:"media",category:sectionKey,psom_key:sectionKey,
    bind:{page:"media",section:sectionKey,psom_key:sectionKey},
    priority:Number(slot.rankingScore||slot.priority||0),rankingScore:Number(slot.rankingScore||0),
    realContent:true,verified:true,officialSource:true,
    searchBankEligible:true,snapshotEligible:true,frontSupplyAllowed:true,
    candidateOnly:false,seedContent:false,riskLevel:"low",blocked:false,blockedReason:"",
    verificationStatus:"approved_for_snapshot",reviewStatus:"approved",
    managedBy:OWNER,
    mediaReleaseContract:{
      adapterVersion:VERSION,owner:OWNER,slotOwner:SLOT_OWNER,
      releaseId:info.releaseId,requestHash:info.requestHash,sectionKey,sourceSlotId:Number(slot.slotId)||index+1,
      action:info.action,eligible:true
    },
    releaseContract:clone(releaseContract),
    rights:clone(slot.rights),captions:clone(slot.captions||[]),subtitleLanguages:clone(slot.subtitleLanguages||[]),
    durationSeconds:Number(slot.durationSeconds||0)||null,year:Number(slot.year||0)||null,
    requestedSection:text(slot.requestedSection),classifiedSection:text(slot.classifiedSection)||sectionKey,
    sourceMediaSlot:clone(slot)
  };
}

function isOwnedSearchBankItem(item){
  const contract=plain(item&&item.mediaReleaseContract);
  return item&&item.managedBy===OWNER||contract.owner===OWNER||contract.adapterVersion===VERSION;
}

function buildSearchBankDocument(existingBank,release){
  const info=releaseInfo(release),snapshot=plain(release&&release.snapshot);
  if(!info.releaseId||!info.requestHash)throw new Error("media_release_identity_missing");
  const desired=desiredBySection(snapshot),items=[];
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    desired[sectionKey].forEach((slot,index)=>{
      const id=slotIdOf(slot),url=mediaUrl(slot);
      if(!id||!text(slot.title)||!/^https:\/\//i.test(text(slot.thumb))||!/^https:\/\//i.test(url)){
        throw new Error("media_release_slot_contract_invalid:"+sectionKey+":"+(index+1));
      }
      items.push(searchBankItem(slot,sectionKey,info,index));
    });
  });
  const bank=clone(existingBank),existing=Array.isArray(bank.items)?bank.items:[];
  bank.items=existing.filter((item)=>!isOwnedSearchBankItem(item)).concat(items);
  bank.meta=Object.assign({},plain(bank.meta),{
    mediaReleasePipeline:{
      version:VERSION,owner:OWNER,releaseId:info.releaseId,requestHash:info.requestHash,
      action:info.action,sectionKey:info.sectionKey,generatedAt:new Date().toISOString(),
      mediaItemCount:items.length,sections:Object.fromEntries(MANUAL_SECTIONS.map((key)=>[key,desired[key].length]))
    }
  });
  return{bank,mediaItems:items,info,desired,hash:sha256(bank)};
}

function ownedItems(bank,releaseId){
  return(Array.isArray(bank&&bank.items)?bank.items:[]).filter((item)=>{
    if(!isOwnedSearchBankItem(item))return false;
    return!releaseId||text(plain(item.mediaReleaseContract).releaseId)===text(releaseId);
  });
}

function sectionState(snapshot){
  const sections=plain(snapshot&&snapshot.sections),out={};let total=0;
  MANUAL_SECTIONS.forEach((key)=>{
    const slots=slotsOf(sections[key]),managed=slots.filter(managedSlot);
    const ids=managed.map(slotIdOf).filter(Boolean);
    out[key]={slotCount:slots.length,managedCount:managed.length,contentIds:ids};
    total+=managed.length;
  });
  return{totalManaged:total,sections:out};
}

function decorateEngineSnapshot(engineSnapshot,release,engineReport,searchBankHash){
  const next=clone(engineSnapshot),info=releaseInfo(release),desired=desiredBySection(release.snapshot);
  next.sections=Object.assign({},plain(next.sections));
  const problems=[];
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    const source=next.sections[sectionKey];
    const section=Array.isArray(source)?{key:sectionKey,title:sectionKey,slots:source}:Object.assign({},plain(source));
    const trusted=new Map(desired[sectionKey].map((slot)=>[slotIdOf(slot),slot]));
    const found=new Set();
    section.slots=slotsOf(source).map((slot)=>{
      const id=slotIdOf(slot),original=trusted.get(id);
      if(!original)return slot;
      found.add(id);
      return Object.assign({},slot,clone(original),{
        slotId:Number(slot&&slot.slotId)||Number(original.slotId)||null,
        managedBy:SLOT_OWNER,
        releaseContract:Object.assign({},plain(original.releaseContract),{eligible:true})
      });
    });
    trusted.forEach((slot,id)=>{if(!found.has(id))problems.push("snapshot_engine_missing_media:"+sectionKey+":"+id);});
    const expectedPositions=desired[sectionKey].map((slot)=>[slotIdOf(slot),Number(slot.slotId)||null]);
    const actualPositions=section.slots.filter(managedSlot).map((slot)=>[slotIdOf(slot),Number(slot.slotId)||null]);
    if(stableStringify(expectedPositions)!==stableStringify(actualPositions))problems.push("snapshot_engine_slot_order_mismatch:"+sectionKey);
    next.sections[sectionKey]=section;
  });
  if(problems.length){const error=new Error(problems.join(","));error.code="media_snapshot_engine_verification_failed";error.problems=problems;throw error;}
  const state=sectionState(next);
  next.meta=Object.assign({},plain(next.meta),{
    generatedAt:new Date().toISOString(),generatedBy:"snapshot-engine+media-release-adapter",
    filled:Object.fromEntries(MANUAL_SECTIONS.map((key)=>[key,state.sections[key].managedCount])),
    releasePipeline:{
      version:VERSION,status:"applied",releaseId:info.releaseId,requestHash:info.requestHash,
      action:info.action,sectionKey:info.sectionKey,requestedAt:info.requestedAt,requestedBy:info.requestedBy,
      searchBankHash,searchBankMediaCount:state.totalManaged,
      snapshotEngineVersion:text(engineReport&&engineReport.version),
      snapshotEngineScope:"isolated_media_only",
      snapshotEngineCompletedHandlers:Array.isArray(engineReport&&engineReport.completedHandlers)&&engineReport.completedHandlers.includes("media")?["media"]:[],
      pipelineLayers:["approved_release","searchbank_contract","snapshot_engine","media_snapshot","automap_front"],
      appliedAt:new Date().toISOString(),sections:Object.fromEntries(MANUAL_SECTIONS.map((key)=>[key,state.sections[key].managedCount]))
    }
  });
  return{snapshot:next,state,hash:sha256(next),info};
}

function buildPipelineReport(input){
  const release=plain(input&&input.release),snapshot=plain(input&&input.snapshot||release.snapshot);
  const info=releaseInfo(Object.assign({},release,{snapshot}));
  const state=sectionState(snapshot),pipeline=plain(plain(snapshot.meta).releasePipeline);
  const bank=plain(input&&input.searchBank),mediaItems=ownedItems(bank,info.releaseId);
  return{
    ok:true,reportType:"igdc-media-release-pipeline",version:VERSION,generatedAt:new Date().toISOString(),
    release:{releaseId:info.releaseId,status:text(release.status),requestHash:info.requestHash,action:info.action,sectionKey:info.sectionKey},
    searchBank:{contractVersion:VERSION,mediaItemCount:mediaItems.length,hash:input&&input.searchBankHash||null},
    snapshotEngine:{applied:pipeline.status==="applied",version:text(pipeline.snapshotEngineVersion),completedHandlers:pipeline.snapshotEngineCompletedHandlers||[]},
    output:{hash:input&&input.outputHash||sha256(snapshot),totalManagedSlots:state.totalManaged,sections:state.sections}
  };
}

module.exports={
  VERSION,OWNER,SLOT_OWNER,MANUAL_SECTIONS,text,plain,clone,sha256,slotsOf,managedSlot,slotIdOf,
  releaseInfo,desiredBySection,buildEngineTemplate,buildSearchBankDocument,ownedItems,sectionState,
  decorateEngineSnapshot,buildPipelineReport
};
