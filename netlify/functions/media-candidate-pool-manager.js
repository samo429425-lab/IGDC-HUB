"use strict";

/**
 * Media candidate pool manager.
 * Media-only control layer: keeps active front candidates + 20 reserves per section,
 * separates newly researched candidates, and can automatically compare/replace
 * already administrator-approved candidates. It never edits SearchBank core files.
 */
const MediaStore=require("./lib/media-candidate-store.v1");
const MediaPolicy=require("./lib/media-candidate-policy.v2");
const SharedAdminAuth=require("./lib/global-slot-console-auth");

const VERSION="media-candidate-pool-manager-v1.3.0-all-sections-100-front";
const MANAGER_SOURCE="media-candidate-pool-manager";
const RESERVE_CAPACITY=20;
const SECTION_CAPACITY=Object.freeze({});
const SECTIONS=Array.from(MediaStore.ALLOWED_SECTIONS);

function text(v){return MediaStore.text(v);}
function lower(v){return MediaStore.lower(v);}
function plain(v){return MediaStore.plain(v);}
function array(v){return MediaStore.array(v);}
function now(){return MediaStore.nowIso();}
function capacity(section){return SECTION_CAPACITY[section]||100;}
function rawOf(row){return plain(row&&row.raw);}
function sourceMeta(row){return plain(rawOf(row).sourceMetadata);}
function poolControl(row){return plain(rawOf(row).poolControl);}
function frontControl(row){return plain(rawOf(row).frontControl);}
function isManagerControl(row){return text(frontControl(row).source)===MANAGER_SOURCE;}
function manualDisabled(row){return frontControl(row).enabled===false&&!isManagerControl(row);}
function frontEnabled(row){return frontControl(row).enabled!==false;}
function sectionOf(row){return MediaStore.normalizeSection(row&&row.section_key||rawOf(row).sectionKey);}
function approvedEligible(row){return MediaPolicy.releaseEligibility(row).ok&&MediaStore.snapshotEligible(row);}
function dateMillis(row){
  const raw=rawOf(row),src=sourceMeta(row);
  for(const value of [raw.publishedAt,src.publicdate,src.date,row&&row.created_at,row&&row.updated_at]){
    const ms=Date.parse(value||"");if(Number.isFinite(ms))return ms;
  }
  return 0;
}
function yearOf(row){
  const raw=rawOf(row),src=sourceMeta(row);
  const y=Number(raw.year||src.year||0);if(y>=1900&&y<=2200)return y;
  const ms=dateMillis(row);return ms?new Date(ms).getUTCFullYear():0;
}
function clamp(v,min,max){v=Number(v);if(!Number.isFinite(v))v=0;return Math.max(min,Math.min(max,v));}
function logScore(v,scale){v=Math.max(0,Number(v)||0);return clamp(Math.log10(v+1)/(scale||6),0,1);}
function qualityHeight(row){
  const raw=rawOf(row),src=sourceMeta(row);return Number(src.height||raw.height||(text(row&&row.quality_hint).match(/(\d{3,4})p/i)||[])[1]||0)||0;
}
function candidateScore(row,publishedSet){
  const raw=rawOf(row),src=sourceMeta(row),probe=plain(raw.playbackProbe||src.playbackProbe),thumb=plain(raw.thumbnailProbe||src.thumbnailProbe);
  const rank=clamp(Number(raw.rankingScore||0),0,120)/120;
  const downloads=logScore(src.downloads||raw.downloads,6);
  const rating=clamp(Number(src.avgRating||raw.avgRating||0)/5,0,1);
  const height=clamp(qualityHeight(row)/2160,0,1);
  const bitrate=clamp(Number(src.bitrateBps||raw.bitrateBps||0)/6000000,0,1);
  const reliability=((probe.ok===true?1:0)+(thumb.ok===true?1:0))/2;
  const confidence=clamp(Number(raw.classificationConfidence||src.classificationConfidence||0)/100,0,1);
  const currentYear=new Date().getUTCFullYear();
  const y=yearOf(row);const freshness=y?clamp(1-Math.max(0,currentYear-y)/12,0,1):0.25;
  const retention=publishedSet&&publishedSet.has(text(row.id))?0.035:0;
  const manualBoost=poolControl(row).forcePromote===true?1.5:0;
  const score=(rank*.26+downloads*.16+rating*.08+height*.10+bitrate*.09+reliability*.12+confidence*.08+freshness*.11+retention+manualBoost)*100;
  return Math.round(score*100)/100;
}
async function actorFor(event,write){
  const actor=await SharedAdminAuth.resolveUser(event);
  SharedAdminAuth.requireCapability(actor,write?"mediaEdit":"mediaRead");
  MediaStore.requireRole(actor,write?"write":"read");
  return actor;
}
async function allRows(){
  const rows=await MediaStore.selectCandidates("select=*&order=updated_at.desc&limit=3000");
  return Array.isArray(rows)?rows:[];
}
async function latestRelease(){
  try{
    const q=new URLSearchParams();q.set("select","release_id,snapshot,status,created_at");q.set("status","in.(stored,applied)");q.set("order","created_at.desc");q.set("limit","1");
    const rows=await MediaStore.supabase(MediaStore.rest(MediaStore.RELEASE_TABLE,q.toString()),{method:"GET"});
    return Array.isArray(rows)&&rows[0]?rows[0]:null;
  }catch(_e){return null;}
}
function releaseIdsBySection(release){
  const out={};SECTIONS.forEach((s)=>out[s]=new Set());
  const sections=plain(release&&release.snapshot&&release.snapshot.sections);
  SECTIONS.forEach((section)=>{
    const obj=sections[section];const slots=Array.isArray(obj)?obj:array(obj&&obj.slots);
    slots.forEach((slot)=>{if(slot&&slot.managedBy==="media-snapshot-publish"&&text(slot.contentId))out[section].add(text(slot.contentId));});
  });
  return out;
}
function compactRow(row,score,bucket,published){
  const raw=rawOf(row),src=sourceMeta(row);
  return{
    id:text(row.id),sectionKey:sectionOf(row),title:text(row.title),provider:text(row.provider||row.source_host),
    reviewStatus:text(row.review_status),verificationStatus:text(row.verification_status),frontEnabled:frontEnabled(row),manualDisabled:manualDisabled(row),
    bucket,score,published:published===true,year:yearOf(row),updatedAt:text(row.updated_at),createdAt:text(row.created_at),
    rankingScore:Number(raw.rankingScore||0)||0,downloads:Number(src.downloads||raw.downloads||0)||0,avgRating:Number(src.avgRating||raw.avgRating||0)||0,
    qualityHeight:qualityHeight(row),thumb:text(row.thumb_url),url:text(row.source_url||row.video_url||row.embed_url),poolControl:poolControl(row)
  };
}
function buildState(rows,release){
  const releaseIds=releaseIdsBySection(release);const sections={};
  for(const section of SECTIONS){
    const sectionRows=rows.filter((r)=>sectionOf(r)===section);
    const publishedSet=releaseIds[section];
    const held=sectionRows.filter((r)=>lower(r&&r.review_status)==="hold").sort((a,b)=>dateMillis(b)-dateMillis(a)).slice(0,120);
    const eligible=sectionRows.filter(approvedEligible);
    // Manager-disabled overflow rows remain part of the ranked pool. Only a true
    // administrator/manual disable removes a candidate from automatic comparison.
    // This prevents overflow candidates from disappearing from diagnostics and lets
    // a later rebalance promote them back into reserve/primary when their score rises.
    const selectable=eligible.filter((r)=>!manualDisabled(r));
    const scored=selectable.map((row)=>({row,score:candidateScore(row,publishedSet)})).sort((a,b)=>b.score-a.score||dateMillis(b.row)-dateMillis(a.row));
    const primaryCap=capacity(section);
    const publishedRows=scored.filter((x)=>publishedSet.has(text(x.row.id)));
    const primary=[];const used=new Set();
    for(const item of publishedRows){if(primary.length>=primaryCap)break;primary.push(item);used.add(text(item.row.id));}
    for(const item of scored){if(primary.length>=primaryCap)break;if(used.has(text(item.row.id)))continue;primary.push(item);used.add(text(item.row.id));}
    const reserve=[];for(const item of scored){if(reserve.length>=RESERVE_CAPACITY)break;if(used.has(text(item.row.id)))continue;reserve.push(item);used.add(text(item.row.id));}
    const overflow=scored.filter((item)=>!used.has(text(item.row.id)));
    const latest=sectionRows.filter((r)=>{
      const status=lower(r&&r.review_status);
      if(["hold","search_excluded","permanent_blocked","rejected"].includes(status))return false;
      return !approvedEligible(r);
    }).sort((a,b)=>dateMillis(b)-dateMillis(a)).slice(0,120);
    sections[section]={
      primaryCapacity:primaryCap,reserveCapacity:RESERVE_CAPACITY,primaryCount:primary.length,reserveCount:reserve.length,latestCount:latest.length,
      publishedCount:publishedSet.size,eligibleCount:eligible.length,totalCount:sectionRows.length,
      primary:primary.map((x)=>compactRow(x.row,x.score,"primary",publishedSet.has(text(x.row.id)))),
      reserve:reserve.map((x)=>compactRow(x.row,x.score,"reserve",publishedSet.has(text(x.row.id)))),
      latest:latest.map((r)=>compactRow(r,candidateScore(r,publishedSet),"latest",false)),
      held:held.map((r)=>compactRow(r,candidateScore(r,publishedSet),"held",false)),
      overflow:overflow.slice(0,40).map((x)=>compactRow(x.row,x.score,"overflow",false))
    };
  }
  return{ok:true,version:VERSION,generatedAt:now(),policy:{primaryDefault:100,musicShortsPrimary:100,reservePerSection:RESERVE_CAPACITY,automaticReplacement:"approved-and-verified-only",manualDisablePreserved:true,lifecycleOwner:"media-candidate-action"},release:{present:!!release,id:text(release&&release.release_id),status:text(release&&release.status),createdAt:text(release&&release.created_at)},sections};
}
function poolRowObject(row,bucket,score,actor,enabled,extra){
  const raw=Object.assign({},rawOf(row));const previous=poolControl(row);const changedAt=now();
  raw.poolControl=Object.assign({},previous,{
    version:VERSION,bucket,score,changedAt,changedBy:text(actor.email||actor.memberId||"admin"),source:MANAGER_SOURCE,
    primaryCapacity:capacity(sectionOf(row)),reserveCapacity:RESERVE_CAPACITY
  },extra||{});
  if(enabled!==undefined){
    const old=frontControl(row);
    raw.frontControl=Object.assign({},old,{enabled:enabled===true,changedAt,changedBy:text(actor.email||actor.memberId||"admin"),source:MANAGER_SOURCE,note:"candidate_pool_"+bucket});
  }
  return Object.assign({},row,{raw,updated_at:changedAt,updated_by:text(actor.email||actor.memberId||"admin")});
}
async function savePoolRows(rows){
  const saved=[];const batchSize=20;
  for(let i=0;i<rows.length;i+=batchSize){
    const batch=rows.slice(i,i+batchSize);const result=await MediaStore.upsertCandidates(batch);
    if(!Array.isArray(result)||result.length!==batch.length){
      const error=new Error("후보 운영 상태 일괄 저장 수량이 일치하지 않습니다.");error.statusCode=502;error.code="media_candidate_pool_upsert_mismatch";throw error;
    }
    saved.push(...result);
  }
  return saved;
}
async function patchPoolRow(row,bucket,score,actor,enabled,extra){
  const prepared=poolRowObject(row,bucket,score,actor,enabled,extra);
  const saved=await MediaStore.upsertCandidates([prepared]);
  return Array.isArray(saved)&&saved[0]||prepared;
}
async function rebalance(rows,release,actor,onlySection){
  const releaseIds=releaseIdsBySection(release);const targets=onlySection?[MediaStore.normalizeSection(onlySection)].filter(Boolean):SECTIONS.slice();
  const result={updated:0,sections:{},skippedManualDisabled:0};
  const prepared=[];
  for(const section of targets){
    const publishedSet=releaseIds[section];
    const eligible=rows.filter((r)=>sectionOf(r)===section&&approvedEligible(r));
    const selectable=eligible.filter((r)=>{if(manualDisabled(r)){result.skippedManualDisabled+=1;return false;}return true;});
    const scored=selectable.map((row)=>({row,score:candidateScore(row,publishedSet)})).sort((a,b)=>b.score-a.score||dateMillis(b.row)-dateMillis(a.row));
    const primaryCap=capacity(section),poolMax=primaryCap+RESERVE_CAPACITY;
    const chosen=scored.slice(0,poolMax);const primary=chosen.slice(0,primaryCap);const reserve=chosen.slice(primaryCap);
    const primaryIds=new Set(primary.map((x)=>text(x.row.id)));const reserveIds=new Set(reserve.map((x)=>text(x.row.id)));const chosenIds=new Set(chosen.map((x)=>text(x.row.id)));
    let sectionUpdated=0;
    for(const item of scored){
      const id=text(item.row.id);const bucket=primaryIds.has(id)?"primary":reserveIds.has(id)?"reserve":"overflow";
      const existing=poolControl(item.row);const existingEnabled=frontEnabled(item.row);const shouldEnable=chosenIds.has(id);
      if(existing.bucket===bucket&&Math.abs(Number(existing.score||0)-item.score)<0.01&&existingEnabled===shouldEnable&&isManagerControl(item.row))continue;
      prepared.push(poolRowObject(item.row,bucket,item.score,actor,shouldEnable,{forcePromote:false,lastAutoRebalanceAt:now()}));sectionUpdated+=1;
    }
    result.sections[section]={primary:primary.length,reserve:reserve.length,overflow:Math.max(0,scored.length-chosen.length),updated:sectionUpdated};
  }
  const settled=await savePoolRows(prepared);result.updated=settled.length;
  return result;
}
async function manualAction(rows,ids,actor,mode){
  const wanted=new Set(array(ids).map(text).filter(Boolean));const selected=rows.filter((r)=>wanted.has(text(r.id)));const items=[];const rejected=[];
  for(const row of selected){
    if(mode==="promote"){
      if(!approvedEligible(row)){rejected.push({id:text(row.id),reason:"administrator_approval_required"});continue;}
      items.push(await patchPoolRow(row,"primary_candidate",candidateScore(row,new Set()),actor,true,{forcePromote:true,manualAction:"promote"}));
    }else if(mode==="auto"){
      const raw=Object.assign({},rawOf(row));delete raw.poolControl;
      if(isManagerControl(row))delete raw.frontControl;
      const saved=await MediaStore.updateCandidates([row.id],{raw,updated_at:now(),updated_by:text(actor.email||actor.memberId||"admin")});items.push(Array.isArray(saved)&&saved[0]||row);
    }
  }
  return{updated:items.length,rejected,items};
}
exports.handler=async function(event){
  if(event&&event.httpMethod==="OPTIONS")return MediaStore.response(204,{});
  try{
    if(!event||!["GET","POST"].includes(event.httpMethod))return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const write=event.httpMethod==="POST";const actor=await actorFor(event,write);const rows=await allRows();const release=await latestRelease();
    if(!write)return MediaStore.response(200,buildState(rows,release));
    const body=MediaStore.parseBody(event),action=lower(body.action);
    if(action==="auto_rebalance"){
      const applied=await rebalance(rows,release,actor,text(body.sectionKey));
      return MediaStore.response(200,Object.assign({ok:true,version:VERSION,action},applied));
    }
    if(["promote","auto"].includes(action)){
      const changed=await manualAction(rows,body.ids,actor,action);
      return MediaStore.response(200,Object.assign({ok:true,version:VERSION,action},changed));
    }
    return MediaStore.response(400,{ok:false,error:"invalid_action",allowed:["auto_rebalance","promote","auto"]});
  }catch(error){
    return MediaStore.response(error.statusCode||500,{ok:false,version:VERSION,error:error.code||"media_candidate_pool_failed",message:error.message||String(error)});
  }
};
