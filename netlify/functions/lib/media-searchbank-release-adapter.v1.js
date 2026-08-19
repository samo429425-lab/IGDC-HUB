"use strict";

/**
 * Approved Media Release -> SearchBank contract adapter.
 *
 * This module deliberately does not modify SearchBank Engine, Snapshot Engine,
 * Automap, or committed Snapshot templates.  It only prepares a build-local
 * SearchBank media contract and verifies the Snapshot Engine result.
 */
const crypto=require("crypto");
const SearchBankEngine=require("../search-bank-engine.js");

const VERSION="media-searchbank-release-adapter-v1.5.0-thumb-required-front-safe";
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
function sha256(value){
  // Hash the JSON document exactly as it can exist on disk/public HTTP. SearchBank
  // normalization can leave optional properties as `undefined` in memory; JSON.stringify
  // omits those keys. Hashing the pre-serialization object therefore produced a false
  // public mismatch even when the deployed JSON was byte-equivalent in content.
  const canonical=typeof value==="string"?value:JSON.parse(JSON.stringify(value==null?{}:value));
  return crypto.createHash("sha256").update(typeof canonical==="string"?canonical:stableStringify(canonical)).digest("hex");
}
function slotsOf(section){return Array.isArray(section)?section:(section&&Array.isArray(section.slots)?section.slots:[]);}
function managedSlot(slot){return !!(slot&&slot.managedBy===SLOT_OWNER&&plain(slot.releaseContract).eligible===true);}
function slotIdOf(slot){return text(slot&&(slot.contentId||slot.id));}
function blankSlot(slot,index){
  return{slotId:Number(slot&&slot.slotId)||index+1,contentId:null,title:null,thumb:"#",provider:null};
}
function mediaUrl(slot){return text(slot&&(slot.video||slot.embedUrl||slot.url||slot.link));}
function isPlaceholderThumbnail(value){
  const raw=text(value).toLowerCase();
  return !raw||raw==="#"||raw.includes("media-sample-card.png")||raw.includes("placeholder")||raw.includes("placehold.co")||raw.includes("placehold.it");
}
function usableThumbnail(slot){
  const thumb=text(slot&&(slot.thumb||slot.thumbnail||slot.image));
  return /^https:\/\//i.test(thumb)&&!isPlaceholderThumbnail(thumb)?thumb:"";
}

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
    out[sectionKey]=slotsOf(sections[sectionKey]).filter((slot)=>managedSlot(slot)&&!!usableThumbnail(slot)).map(clone);
  });
  return out;
}

function buildEngineTemplate(committedSnapshot){
  const next=clone(committedSnapshot);
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
    releasePipelineStage:"pre_snapshot_engine",
    samplePreservation:"committed-media-snapshot+full-searchbank"
  });
  return next;
}

function searchBankItem(slot,sectionKey,info,index){
  const id=slotIdOf(slot);
  const url=mediaUrl(slot);
  const releaseContract=plain(slot.releaseContract);
  const thumb=usableThumbnail(slot);
  return{
    id,contentId:id,
    title:text(slot.title),summary:text(slot.summary),description:text(slot.description),
    url,link:url,videoUrl:text(slot.video)||url,embedUrl:text(slot.embedUrl),
    thumb,thumbnail:thumb,image:thumb,
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
    media:{
      kind:"video",
      duration:Number(slot.durationSeconds||0)||null,
      preview:{poster:thumb,start:0,duration:5},
      videoUrl:text(slot.video)||url,
      embedUrl:text(slot.embedUrl)||null
    },
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


function assertSearchBankCoreApi(){
  const required=[
    "resolveSlotPolicy","resolveOperationalPolicy","normalizeItem","applySlotContract",
    "enforceFrontSectionContract","applyUnifiedSupplyContract","validateBankItem","policyAcceptsItem"
  ];
  const missing=required.filter((name)=>typeof SearchBankEngine[name]!=="function");
  if(missing.length){
    const error=new Error("media_searchbank_core_api_missing:"+missing.join(","));
    error.code="media_searchbank_core_api_missing";error.missing=missing;throw error;
  }
  return{engineVersion:text(SearchBankEngine.SEARCH_BANK_ENGINE_VERSION),contractVersion:text(SearchBankEngine.SEARCH_BANK_CONTRACT_VERSION)};
}

function buildSearchBankDocument(existingBank,release){
  const coreApi=assertSearchBankCoreApi();
  const info=releaseInfo(release),snapshot=plain(release&&release.snapshot);
  if(!info.releaseId||!info.requestHash)throw new Error("media_release_identity_missing");
  const desired=desiredBySection(snapshot),items=[];
  MANUAL_SECTIONS.forEach((sectionKey)=>{
    desired[sectionKey].forEach((slot,index)=>{
      const id=slotIdOf(slot),url=mediaUrl(slot);
      if(!id||!text(slot.title)||!/^https:\/\//i.test(url)||!usableThumbnail(slot)){
        throw new Error("media_release_slot_contract_invalid:"+sectionKey+":"+(index+1));
      }
      items.push(searchBankItem(slot,sectionKey,info,index));
    });
  });
  // Media-only bridge: use the existing public SearchBank core API without modifying the shared engine.
  // The adapter normalizes and validates approved media through the core contract/policy functions,
  // then returns only accepted items to the build-local SearchBank snapshot stage.
  const accepted=[];
  const rejected=[];
  items.forEach((raw)=>{
    const sectionKey=text(raw.section||raw.psom_key||raw.category);
    const params={
      channel:"media",page:"media",section:sectionKey,psom_key:sectionKey,
      frontSupply:true,snapshotWrite:true,strictFrontSection:true,
      external:"off",noExternal:true
    };
    const ctx={params};
    ctx.slotContext=SearchBankEngine.resolveSlotPolicy(params,{});
    ctx.operationalPolicy=SearchBankEngine.resolveOperationalPolicy(ctx,[]);
    let item=SearchBankEngine.normalizeItem(raw,ctx);
    if(!item){rejected.push({id:text(raw.id),section:sectionKey,issues:["normalize_failed"]});return;}
    item=SearchBankEngine.applySlotContract(item,ctx);
    item=SearchBankEngine.enforceFrontSectionContract(item,{section:sectionKey,psom_key:sectionKey,strictFrontSection:true});
    item=SearchBankEngine.applyUnifiedSupplyContract(item,ctx);
    const validation=SearchBankEngine.validateBankItem(item);
    const policyOk=SearchBankEngine.policyAcceptsItem(item,ctx);
    const issues=Array.isArray(validation&&validation.issues)?validation.issues.slice():[];
    if(!policyOk)issues.push("searchbank_policy_rejected");
    if(validation&&validation.ok&&policyOk)accepted.push(item);
    else rejected.push({id:text(item.id||raw.id),section:sectionKey,issues:[...new Set(issues)]});
  });
  const enginePass={
    version:text(SearchBankEngine.SEARCH_BANK_ENGINE_VERSION),
    contractVersion:text(SearchBankEngine.SEARCH_BANK_CONTRACT_VERSION),
    accepted,rejected
  };
  if(items.length&&accepted.length!==items.length){
    const error=new Error("media_release_searchbank_contract_rejected:"+rejected.length);
    error.code="media_release_searchbank_policy_rejected";
    error.rejected=rejected;
    throw error;
  }
  const bank=clone(existingBank),existing=Array.isArray(bank.items)?bank.items:[];
  bank.items=existing.filter((item)=>!isOwnedSearchBankItem(item)).concat(accepted);
  bank.meta=Object.assign({},plain(bank.meta),{
    mediaReleasePipeline:{
      version:VERSION,owner:OWNER,releaseId:info.releaseId,requestHash:info.requestHash,
      action:info.action,sectionKey:info.sectionKey,generatedAt:new Date().toISOString(),
      searchBankEngineVersion:text(enginePass&&enginePass.version)||coreApi.engineVersion,
      searchBankEngineAccepted:accepted.length,searchBankEngineRejected:rejected.length,
      mediaItemCount:accepted.length,thumbnailPolicy:"real managed media requires a non-placeholder HTTPS thumbnail",sections:Object.fromEntries(MANUAL_SECTIONS.map((key)=>[key,accepted.filter((item)=>text(item.section||item.psom_key||item.category)===key).length]))
    }
  });
  return{bank,mediaItems:accepted,rejected,enginePass,info,desired,hash:sha256(bank)};
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
    // Snapshot Engine / PSOM may legitimately reorder approved real content inside a
    // section (ranking, sample replacement, capacity policy).  The media bridge must
    // verify membership, not freeze the upstream slot number/order.  Enforce that the
    // exact approved content-id set survives in the same section with no duplicates.
    const expectedIds=desired[sectionKey].map(slotIdOf).filter(Boolean).sort();
    const actualIds=section.slots.filter(managedSlot).map(slotIdOf).filter(Boolean).sort();
    if(stableStringify(expectedIds)!==stableStringify(actualIds))problems.push("snapshot_engine_section_membership_mismatch:"+sectionKey);
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
  releaseInfo,desiredBySection,assertSearchBankCoreApi,buildEngineTemplate,buildSearchBankDocument,ownedItems,sectionState,
  decorateEngineSnapshot,buildPipelineReport
};
