"use strict";

const crypto=require("crypto");
const fs=require("fs");
const os=require("os");
const path=require("path");
const Adapter=require("../../functions/lib/media-searchbank-release-adapter.v1");

const VERSION="igdc-media-snapshot-release-build-plugin-v2.6.0-persistent-fast-media-stage";
const DEFAULT_TABLE="media_snapshot_releases";

function text(value){return value==null?"":String(value).trim();}
function lower(value){return text(value).toLowerCase();}
function firstEnv(names){
  for(const name of names){const value=text(process.env[name]);if(value)return{name,value};}
  return{name:null,value:""};
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return"["+value.map(stableStringify).join(",")+"]";
  return"{"+Object.keys(value).sort().map((key)=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}";
}
function sha256(value){return crypto.createHash("sha256").update(typeof value==="string"?value:stableStringify(value)).digest("hex");}
function hookAuthorization(){
  const raw=text(process.env.INCOMING_HOOK_BODY);if(!raw)return false;
  try{
    const body=JSON.parse(raw);
    return !!(body&&body.trigger==="approved-media-snapshot-release"&&text(body.releaseId)&&text(body.snapshotHash));
  }catch(_error){return false;}
}
function releaseArmed(){
  const mode=lower(process.env.MEDIA_RELEASE_MODE),key=text(process.env.MEDIA_RELEASE_KEY);
  return (mode==="enabled"&&key.length>=32)||hookAuthorization();
}
function config(){
  const url=firstEnv(["MEDIA_SUPABASE_URL","IGDC_MEDIA_SUPABASE_URL","GSLOT_SUPABASE_URL","SUPABASE_URL"]);
  const key=firstEnv([
    "MEDIA_SUPABASE_SERVICE_ROLE_KEY","MEDIA_SUPABASE_SECRET_KEY",
    "IGDC_MEDIA_SUPABASE_SERVICE_ROLE_KEY","IGDC_MEDIA_SUPABASE_SECRET_KEY",
    "GSLOT_SUPABASE_SECRET_KEY","GSLOT_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_KEY"
  ]);
  const normalizedUrl=text(url.value).replace(/\/+$/g,"");
  if(!/^https:\/\/[^/]+$/i.test(normalizedUrl)||!text(key.value))throw new Error("media_snapshot_release_storage_not_configured");
  return{url:normalizedUrl,key:text(key.value),table:text(process.env.MEDIA_SNAPSHOT_RELEASE_TABLE)||DEFAULT_TABLE};
}
function safeManagedSlots(snapshot){
  if(!snapshot||snapshot.type!=="media_snapshot"||!snapshot.sections||typeof snapshot.sections!=="object")throw new Error("media_snapshot_release_structure_invalid");
  Object.entries(snapshot.sections).forEach(([sectionKey,section])=>{
    Adapter.slotsOf(section).forEach((slot,index)=>{
      if(!slot||slot.managedBy!==Adapter.SLOT_OWNER)return;
      const release=slot.releaseContract||{};
      if(slot.candidateOnly!==false||slot.seedContent!==false||slot.verificationStatus!=="approved_for_snapshot"||release.eligible!==true||!text(slot.title)||!/^https:\/\//i.test(text(slot.thumb))||!/^https:\/\//i.test(text(slot.url||slot.video||slot.embedUrl))){
        throw new Error("unsafe_managed_media_slot:"+sectionKey+":"+(index+1));
      }
    });
  });
  return snapshot;
}
function incomingReleaseExpectation(){
  const raw=text(process.env.INCOMING_HOOK_BODY);if(!raw)return{};
  try{const body=JSON.parse(raw);if(body&&body.trigger==="approved-media-snapshot-release")return{releaseId:text(body.releaseId),snapshotHash:text(body.snapshotHash)};}catch(_error){}
  return{};
}
async function request(settings,resource,init){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(settings.url+resource,Object.assign({},init||{}, {
      signal:controller.signal,
      headers:Object.assign({apikey:settings.key,authorization:"Bearer "+settings.key,"content-type":"application/json",accept:"application/json"},init&&init.headers||{})
    }));
    const raw=await response.text();let body=null;try{body=raw?JSON.parse(raw):null;}catch(_error){body=raw||null;}
    if(!response.ok)throw new Error(body&&body.message||"media_snapshot_release_http_"+response.status);
    return body;
  }finally{clearTimeout(timer);}
}
function isPublicationRequest(release){
  const control=release&&release.snapshot&&release.snapshot.meta&&release.snapshot.meta.releaseControl||{};
  const action=text(control.action);
  return control.publicationRequested===true||["publish_all","publish_section","stop_section","stop_all"].includes(action);
}
async function loadRelease(settings,expected){
  const query=new URLSearchParams();
  query.set("select","release_id,snapshot_hash,snapshot,status,created_at,created_by");
  if(expected.releaseId){
    query.set("release_id","eq."+expected.releaseId);
    query.set("status","in.(stored,applied)");
    query.set("limit","2");
  }else{
    // A stored publication request has priority. If none is pending, the latest
    // applied publication is re-applied to the build output so later GitHub
    // deploys cannot silently revert the public SearchBank/Media snapshots.
    query.set("status","in.(stored,applied)");
    query.set("order","created_at.desc");
    query.set("limit","25");
  }
  const body=await request(settings,"/rest/v1/"+encodeURIComponent(settings.table)+"?"+query.toString(),{method:"GET"});
  const rows=(Array.isArray(body)?body:[]).filter(isPublicationRequest);
  return rows.find((row)=>lower(row&&row.status)==="stored")
    || rows.find((row)=>lower(row&&row.status)==="applied")
    || null;
}
async function markApplied(settings,release,snapshot,hash){
  const query="release_id=eq."+encodeURIComponent(text(release.release_id));
  const body=await request(settings,"/rest/v1/"+encodeURIComponent(settings.table)+"?"+query,{
    method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({snapshot_hash:hash,snapshot,status:"applied"})
  });
  if(!Array.isArray(body)||!body.length)throw new Error("media_snapshot_release_applied_audit_not_saved");
  return body[0];
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(_error){return null;}}
function readFirst(files){for(const file of files){const doc=readJson(file);if(doc)return{file,doc};}return{file:"",doc:{items:[]}};}
function atomicWrite(file,document){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+".release-"+process.pid+"-"+Date.now()+".tmp";
  try{fs.writeFileSync(temporary,JSON.stringify(document,null,2)+"\n",{encoding:"utf8",mode:0o644});JSON.parse(fs.readFileSync(temporary,"utf8"));fs.renameSync(temporary,file);}
  finally{try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch(_error){}}
}
function mediaSectionKey(item){
  const raw=text(item&&(item.psom_key||item.section||item.category||item.bind&&item.bind.section||item.bind&&item.bind.psom_key)).toLowerCase();
  const aliases={movie:"media-movie",film:"media-movie",drama:"media-drama",series:"media-drama",thriller:"media-thriller",mystery:"media-thriller",romance:"media-romance",variety:"media-variety",entertainment:"media-variety",documentary:"media-documentary",animation:"media-animation",anime:"media-animation",music:"media-music",shorts:"media-shorts",short:"media-shorts"};
  return raw.indexOf("media-")===0?raw:(aliases[raw]||"");
}
function assertSearchBankMediaSamples(bank){
  const counts=Object.fromEntries(Adapter.MANUAL_SECTIONS.map((key)=>[key,0]));
  (Array.isArray(bank&&bank.items)?bank.items:[]).forEach((item)=>{
    const key=mediaSectionKey(item);
    if(!Object.prototype.hasOwnProperty.call(counts,key))return;
    const source=item&&item.source&&typeof item.source==="object"?text(item.source.name).toLowerCase():text(item&&item.source).toLowerCase();
    const summary=text(item&&item.summary).toLowerCase();
    const placeholder=item&&item.extension&&item.extension.placeholder;
    if(source==="seed"||summary.indexOf("seed placeholder")===0||placeholder)counts[key]+=1;
  });
  const problems=Object.entries(counts).filter(([,count])=>count<100).map(([key,count])=>key+":"+count);
  if(problems.length){
    const error=new Error("searchbank_media_sample_baseline_missing:"+problems.join(","));
    error.code="searchbank_media_sample_baseline_missing";
    error.problems=problems;
    throw error;
  }
  return counts;
}
function assertMediaTemplate100(snapshot){
  const sections=snapshot&&snapshot.sections&&typeof snapshot.sections==="object"?snapshot.sections:{};
  const problems=[];
  Adapter.MANUAL_SECTIONS.forEach((key)=>{
    const section=sections[key];
    const slots=Array.isArray(section)?section:(section&&Array.isArray(section.slots)?section.slots:[]);
    if(slots.length!==100)problems.push(key+":"+slots.length);
  });
  if(problems.length){
    const error=new Error("media_snapshot_template_capacity_invalid:"+problems.join(","));
    error.code="media_snapshot_template_capacity_invalid";
    error.problems=problems;
    throw error;
  }
}
function runSnapshotEngineIsolated(publishRoot,bank,template,releaseId){
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),"igdc-media-release-"));
  const originalCwd=process.cwd(),enginePath=path.join(publishRoot,"netlify","functions","snapshot-engine.js");
  try{
    atomicWrite(path.join(stage,"data","search-bank.snapshot.json"),bank);
    atomicWrite(path.join(stage,"data","media.snapshot.json"),template);
    process.chdir(stage);
    delete require.cache[require.resolve(enginePath)];
    const engine=require(enginePath),report=engine.run({canonicalReleaseId:releaseId,mediaReleasePipeline:true});
    if(!report||report.ok!==true||!Array.isArray(report.completedHandlers)||!report.completedHandlers.includes("media"))throw new Error("snapshot_engine_media_handler_not_completed");
    const snapshot=readJson(path.join(stage,"data","media.snapshot.json"));
    if(!snapshot)throw new Error("snapshot_engine_media_output_missing");
    return{snapshot,report};
  }finally{
    process.chdir(originalCwd);
    try{delete require.cache[require.resolve(enginePath)];}catch(_error){}
    try{fs.rmSync(stage,{recursive:true,force:true});}catch(_error){}
  }
}

module.exports={
  onPostBuild:async({constants,utils})=>{
    try{Adapter.assertSearchBankCoreApi();}
    catch(error){utils.build.failBuild("미디어 SearchBank 연결 어댑터와 공통 SearchBank Engine의 공개 API가 맞지 않습니다.",{error});return;}
    const expected=incomingReleaseExpectation();
    let settings=null;
    try{
      settings=config();
    }catch(error){
      if(expected.releaseId){
        utils.build.failBuild("미디어 프론트 반영 요청이 있으나 미디어 공급 저장소 설정을 확인할 수 없습니다.",{error});
        return;
      }
      console.warn("["+VERSION+"] media release storage unavailable; keeping current snapshots:",error&&error.message||error);
      utils.status.show({title:"IGDC 미디어 스냅샷",summary:"미디어 공급 저장소 미설정 — 기존 배포 스냅샷 유지"});
      return;
    }

    let release=null;
    try{
      // The durable DB row is the authoritative trigger. Build-hook request bodies are
      // not required to appear as build environment variables. A normal build simply
      // sees no stored publication request and leaves the existing snapshots intact.
      release=await loadRelease(settings,expected);
    }catch(error){
      if(expected.releaseId){
        utils.build.failBuild("명시된 미디어 프론트 반영 요청을 읽지 못해 배포를 중단했습니다.",{error});
        return;
      }
      // Do not take down an unrelated site deployment because the media control DB is
      // temporarily unreachable. The stored request remains pending and a later build
      // can retry it; no SearchBank/Media snapshot is modified in this branch.
      console.warn("["+VERSION+"] pending media release lookup failed; keeping current snapshots:",error&&error.message||error);
      utils.status.show({title:"IGDC 미디어 스냅샷",summary:"미디어 공급 요청 조회 실패 — 기존 배포 스냅샷 유지",text:text(error&&error.message||error)});
      return;
    }

    if(!release){
      utils.status.show({title:"IGDC 미디어 스냅샷",summary:"미적용 프론트 공급 요청 없음 — 기존 배포 스냅샷 유지"});
      return;
    }

    try{
      const publishRoot=path.resolve(constants.PUBLISH_DIR||process.cwd());
      safeManagedSlots(release.snapshot);
      const requestHash=sha256(release.snapshot);
      if(requestHash!==text(release.snapshot_hash))throw new Error("media_snapshot_release_hash_mismatch");
      if(expected.releaseId&&expected.releaseId!==text(release.release_id))throw new Error("media_snapshot_release_id_mismatch");
      // A repeated/delayed hook may point to the pre-engine stored hash while an
      // already-applied row contains the final engine output hash. Enforce the
      // incoming hash only for a still-pending stored request.
      if(lower(release.status)==="stored"&&expected.snapshotHash&&expected.snapshotHash!==requestHash)throw new Error("media_snapshot_hook_hash_mismatch");

      const bankFiles=[
        path.join(publishRoot,"data","search-bank.snapshot.json"),
        path.join(publishRoot,"netlify","functions","data","search-bank.snapshot.json"),
        path.join(publishRoot,"netlify","functions","search-bank.snapshot.json")
      ];
      const mediaFiles=[
        path.join(publishRoot,"data","media.snapshot.json"),
        path.join(publishRoot,"netlify","functions","data","media.snapshot.json")
      ];
      const currentBank=readFirst(bankFiles);
      const currentMedia=readFirst(mediaFiles);
      assertSearchBankMediaSamples(currentBank.doc);
      assertMediaTemplate100(currentMedia.doc);

      const contract=Adapter.buildSearchBankDocument(currentBank.doc,release);
      const owned=Adapter.ownedItems(contract.bank,release.release_id);
      // Fast isolated media pass: the committed Media Snapshot already carries
      // all replaceable sample slots. Snapshot Engine only needs the approved
      // real media candidates here; feeding the entire multi-thousand-item bank
      // made the old front publication pass unnecessarily slow and janky.
      const stageBank={
        meta:{source:"approved-media-release-searchbank-stage",mediaReleasePipeline:contract.bank.meta&&contract.bank.meta.mediaReleasePipeline},
        items:owned
      };
      const template=Adapter.buildEngineTemplate(currentMedia.doc);
      const engine=runSnapshotEngineIsolated(publishRoot,stageBank,template,release.release_id);
      const final=Adapter.decorateEngineSnapshot(engine.snapshot,release,engine.report,contract.hash);
      safeManagedSlots(final.snapshot);

      bankFiles.forEach((file)=>atomicWrite(file,contract.bank));
      [
        path.join(publishRoot,"data","media.snapshot.json"),
        path.join(publishRoot,"netlify","functions","data","media.snapshot.json")
      ].forEach((file)=>atomicWrite(file,final.snapshot));
      const wasStored=lower(release.status)==="stored";
      if(wasStored)await markApplied(settings,release,final.snapshot,final.hash);

      const report=Adapter.buildPipelineReport({
        release:Object.assign({},release,{snapshot:final.snapshot,snapshot_hash:final.hash}),
        snapshot:final.snapshot,searchBank:contract.bank,searchBankHash:contract.hash,outputHash:final.hash
      });
      utils.status.show({
        title:"IGDC 미디어 공개 파이프라인",
        summary:wasStored?"SearchBank → Snapshot Engine → Media Snapshot 신규 반영 완료":"기존 승인 프론트 매칭 재배포 유지 완료",
        text:"release "+text(release.release_id)+" · "+report.output.totalManagedSlots+"개 · "+final.hash.slice(0,16)
      });
      console.log("["+VERSION+"]",JSON.stringify(report));
    }catch(error){
      // Once a pending publication row has been loaded, remain fail-closed: do not
      // deploy a partially converted SearchBank/Media snapshot.
      utils.build.failBuild("승인 미디어의 SearchBank → Snapshot Engine → Media Snapshot 연결을 검증하지 못해 배포를 중단했습니다.",{error});
    }
  }
};
