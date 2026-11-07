"use strict";

const crypto=require("crypto");
const fs=require("fs");
const os=require("os");
const path=require("path");
const Adapter=require("../../functions/lib/media-searchbank-release-adapter.v1");

const VERSION="igdc-media-snapshot-release-build-plugin-v2.9.0-durable-replay-protection";
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
  return control.publicationRequested===true||["publish_all","publish_section","publish_sections","stop_section","stop_sections","stop_all"].includes(action);
}
// Read publication history by small metadata pages, not the most recent 25 large
// snapshot payloads.  Other stored previews must never hide the last approved
// release when a Distribution-only GitHub deployment runs this plugin.
async function latestPublicationForStatus(settings,status){
  const pageSize=150,maxPages=20;
  for(let page=0;page<maxPages;page++){
    const query=new URLSearchParams();
    query.set("select","release_id,status,created_at,release_control:snapshot->meta->releaseControl");
    query.set("status","eq."+status);
    query.set("order","created_at.desc,release_id.desc");
    query.set("limit",String(pageSize));
    query.set("offset",String(page*pageSize));
    const rows=await request(settings,"/rest/v1/"+encodeURIComponent(settings.table)+"?"+query.toString(),{method:"GET"});
    if(!Array.isArray(rows))throw new Error("media_release_history_result_invalid:"+status);
    const match=rows.find(row=>isPublicationRequest({snapshot:{meta:{releaseControl:row.release_control}}}));
    if(match){
      const detail=new URLSearchParams();
      detail.set("select","release_id,snapshot_hash,snapshot,status,created_at,created_by");
      detail.set("release_id","eq."+text(match.release_id));
      detail.set("status","eq."+status);
      detail.set("limit","1");
      const full=await request(settings,"/rest/v1/"+encodeURIComponent(settings.table)+"?"+detail.toString(),{method:"GET"});
      const release=Array.isArray(full)?full[0]:null;
      if(!release||!isPublicationRequest(release))throw new Error("media_release_history_detail_mismatch:"+status);
      return release;
    }
    if(rows.length<pageSize)return null;
  }
  // Truncated history is not evidence of an empty release ledger. Do not
  // silently publish repository seed placeholders in place of real content.
  throw new Error("media_release_publication_history_scan_limit:"+status);
}
async function loadRelease(settings,expected){
  if(expected.releaseId){
    const query=new URLSearchParams();
    query.set("select","release_id,snapshot_hash,snapshot,status,created_at,created_by");
    query.set("release_id","eq."+expected.releaseId);
    query.set("status","in.(stored,applied)");
    query.set("limit","2");
    const rows=await request(settings,"/rest/v1/"+encodeURIComponent(settings.table)+"?"+query.toString(),{method:"GET"});
    const release=Array.isArray(rows)?rows.find(isPublicationRequest):null;
    if(!release)throw new Error("media_release_expected_publication_missing:"+expected.releaseId);
    return release;
  }
  const [stored,applied]=await Promise.all([
    latestPublicationForStatus(settings,"stored"),
    latestPublicationForStatus(settings,"applied")
  ]);
  // Newest verified publication wins. An older stalled `stored` request must
  // not roll a later applied publication back to stale cards.
  if(!stored)return applied;
  if(!applied)return stored;
  const pendingTime=Date.parse(text(stored.created_at)),appliedTime=Date.parse(text(applied.created_at));
  if(!Number.isFinite(pendingTime)||!Number.isFinite(appliedTime))throw new Error("media_release_publication_timestamp_invalid");
  return pendingTime>appliedTime?stored:applied;
}
// A media-only, read-only recovery source if a normal build cannot reach the
// release ledger. Never recover unapproved candidate data or overwrite the
// unrelated SearchBank entries from the current build.
function trustedProductionOrigin(){
  const raw=text(process.env.URL);
  if(!raw)return"";
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||u.port||!u.hostname||
       u.hostname==="localhost"||/^\d+(?:\.\d+){3}$/.test(u.hostname)||u.hostname.includes(":"))return"";
    return u.origin;
  }catch(_error){return"";}
}
async function publicJson(origin,relative){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(origin+relative,{method:"GET",redirect:"error",signal:controller.signal,headers:{accept:"application/json"}});
    if(!response.ok)throw new Error("public_media_recovery_http_"+response.status);
    const size=Number(response.headers&&response.headers.get&&response.headers.get("content-length")||0);
    if(size>16000000)throw new Error("public_media_recovery_payload_too_large");
    const raw=await response.text();
    if(raw.length>16000000)throw new Error("public_media_recovery_payload_too_large");
    return JSON.parse(raw);
  }finally{clearTimeout(timer);}
}
async function restoreApprovedMediaFromProduction(publishRoot){
  const origin=trustedProductionOrigin();
  if(!origin)return{restored:false,reason:"trusted_production_origin_missing"};
  try{
    const [snapshot,liveBank]=await Promise.all([
      publicJson(origin,"/data/media.snapshot.json"),
      publicJson(origin,"/data/search-bank.snapshot.json")
    ]);
    const pipeline=snapshot&&snapshot.meta&&snapshot.meta.releasePipeline||{};
    const releaseId=text(pipeline.releaseId),state=Adapter.sectionState(snapshot);
    if(pipeline.status!=="applied"||!releaseId||state.totalManaged<=0||snapshot.meta.contentReady!==true){
      return{restored:false,reason:"production_has_no_approved_media_release"};
    }
    safeManagedSlots(snapshot);
    const owned=Adapter.ownedItems(liveBank,releaseId);
    const wanted=Adapter.MANUAL_SECTIONS.flatMap(key=>state.sections[key].contentIds.map(id=>key+":"+id)).sort();
    const actual=owned.map(row=>text(row.section||row.psom_key||row.category)+":"+text(row.contentId||row.id)).sort();
    if(owned.length!==state.totalManaged||stableStringify(wanted)!==stableStringify(actual)){
      return{restored:false,reason:"production_media_searchbank_membership_mismatch"};
    }
    const bankFiles=[
      path.join(publishRoot,"data","search-bank.snapshot.json"),
      path.join(publishRoot,"netlify","functions","data","search-bank.snapshot.json"),
      path.join(publishRoot,"netlify","functions","search-bank.snapshot.json")
    ];
    const mediaFiles=[
      path.join(publishRoot,"data","media.snapshot.json"),
      path.join(publishRoot,"netlify","functions","data","media.snapshot.json")
    ];
    const current=readFirst(bankFiles);
    if(!current.file||!Array.isArray(current.doc.items))return{restored:false,reason:"current_searchbank_not_readable"};
    const merged=Object.assign({},current.doc,{
      items:current.doc.items.filter(row=>{
        const contract=row&&row.mediaReleaseContract||{};
        return row&&row.managedBy!==Adapter.OWNER&&contract.owner!==Adapter.OWNER;
      }).concat(owned)
    });
    merged.meta=Object.assign({},merged.meta,{
      mediaReleasePipeline:Object.assign({},liveBank&&liveBank.meta&&liveBank.meta.mediaReleasePipeline||{},
        {recoveredFromLastApprovedProduction:true})
    });
    const recovered=JSON.parse(JSON.stringify(snapshot));
    recovered.meta.releasePipeline=Object.assign({},pipeline,{
      searchBankHash:Adapter.sha256(merged),recoveredFromLastApprovedProduction:true
    });
    // Validation MUST finish before the first build-local write.
    safeManagedSlots(recovered);
    assertMediaTemplate100(recovered);
    // A recovery is a single logical operation even though the build carries
    // several mirrors. Roll back every write if any mirror cannot be updated.
    const targets=bankFiles.map(file=>({file,doc:merged})).concat(mediaFiles.map(file=>({file,doc:recovered})));
    const originals=targets.map(({file})=>({file,bytes:fs.existsSync(file)?fs.readFileSync(file):null}));
    try{
      targets.forEach(({file,doc})=>atomicWrite(file,doc));
    }catch(writeError){
      const rollbackFailures=[];
      for(const original of originals){
        try{
          if(original.bytes===null){if(fs.existsSync(original.file))fs.unlinkSync(original.file);}
          else{fs.mkdirSync(path.dirname(original.file),{recursive:true});fs.writeFileSync(original.file,original.bytes);}
        }catch(rollbackError){rollbackFailures.push(text(rollbackError&&rollbackError.message||rollbackError));}
      }
      if(rollbackFailures.length){
        const fatal=new Error("media_recovery_rollback_failed:"+rollbackFailures.join("|"));fatal.mediaPartialWrite=true;throw fatal;
      }
      throw writeError;
    }
    return{restored:true,releaseId,managedSlots:state.totalManaged};
  }catch(error){
    console.warn("["+VERSION+"] approved production media recovery unavailable:",text(error&&error.message||error));
    return{restored:false,fatal:error&&error.mediaPartialWrite===true,reason:text(error&&error.message||error)};
  }
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
function assertMediaPsomFiles(publishRoot){
  const files=[
    path.join(publishRoot,"data","psom.json"),
    path.join(publishRoot,"netlify","functions","data","psom.json")
  ];
  const reports=[];
  for(const file of files){
    const doc=readJson(file);
    if(!doc){const error=new Error("media_psom_missing:"+file);error.code="media_psom_missing";throw error;}
    reports.push({file,report:Adapter.assertPsomContract(doc)});
  }
  const signatures=reports.map((row)=>row.report.order.join("|"));
  if(new Set(signatures).size!==1){
    const error=new Error("media_psom_duplicate_contract_mismatch");error.code="media_psom_duplicate_contract_mismatch";error.files=files;throw error;
  }
  return reports;
}
function runSnapshotEngineIsolated(publishRoot,bank,template,releaseId){
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),"igdc-media-release-"));
  const originalCwd=process.cwd();
  const sourceFunctions=path.join(publishRoot,"netlify","functions");
  const shadowFunctions=path.join(stage,"netlify","functions");
  const shadowLib=path.join(shadowFunctions,"lib");
  const enginePath=path.join(shadowFunctions,"snapshot-engine.js");
  try{
    // Snapshot Engine writes every existing mirror it can see. Requiring the engine
    // from publishRoot therefore made the former "isolated" check capable of touching
    // the real build output through __dirname/data. Shadow only the engine and its two
    // direct local dependencies so every candidate path stays inside this temp stage.
    fs.mkdirSync(shadowLib,{recursive:true});
    fs.copyFileSync(path.join(sourceFunctions,"snapshot-engine.js"),enginePath);
    fs.copyFileSync(path.join(sourceFunctions,"lib","nonpg-revenue-contract.core.v1.js"),path.join(shadowLib,"nonpg-revenue-contract.core.v1.js"));
    fs.copyFileSync(path.join(sourceFunctions,"lib","public-snapshot-sanitizer.v1.js"),path.join(shadowLib,"public-snapshot-sanitizer.v1.js"));
    atomicWrite(path.join(stage,"data","search-bank.snapshot.json"),bank);
    atomicWrite(path.join(stage,"data","media.snapshot.json"),template);
    process.chdir(stage);
    delete require.cache[require.resolve(enginePath)];
    const engine=require(enginePath),report=engine.run({canonicalReleaseId:releaseId,mediaReleasePipeline:true,targetPage:"media"});
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
    const publishRoot=path.resolve(constants.PUBLISH_DIR||process.cwd());
    async function protectLastPublishedMedia(reason){
      const recovery=await restoreApprovedMediaFromProduction(publishRoot);
      if(recovery.restored){
        utils.status.show({title:"IGDC 미디어 스냅샷",summary:"이전 승인 콘텐츠 연결 보존 (저장소 재조회 필요)",text:"release "+recovery.releaseId+" · "+recovery.managedSlots+"개 · "+reason});
        return true;
      }
      if(recovery.fatal){
        utils.build.failBuild("미디어 승인 스냅샷 복원 중 파일 원상복구가 실패하여 불완전한 배포를 중단했습니다.");
        return true;
      }
      console.warn("["+VERSION+"] media recovery NOT confirmed; GitHub sample may remain in the new deploy. reason="+reason+"; recovery="+recovery.reason);
      return false;
    }
    let settings=null;
    try{
      settings=config();
    }catch(error){
      if(expected.releaseId){
        utils.build.failBuild("미디어 프론트 반영 요청이 있으나 미디어 공급 저장소 설정을 확인할 수 없습니다.",{error});
        return;
      }
      if(await protectLastPublishedMedia("storage_configuration_unavailable"))return;
      utils.status.show({title:"IGDC 미디어 스냅샷",summary:"저장소 설정 없음 — 승인 콘텐츠 복원 여부 확인 필요"});
      return;
    }

    let release=null;
    try{
      release=await loadRelease(settings,expected);
    }catch(error){
      if(expected.releaseId){
        utils.build.failBuild("명시된 미디어 프론트 반영 요청을 읽지 못해 배포를 중단했습니다.",{error});
        return;
      }
      if(await protectLastPublishedMedia("release_lookup_failed"))return;
      utils.status.show({title:"IGDC 미디어 스냅샷",summary:"승인 기록 조회 실패 — 미디어 연결 점검 필요",text:text(error&&error.message||error)});
      return;
    }

    if(!release){
      utils.status.show({title:"IGDC 미디어 스냅샷",summary:"미적용 프론트 공급 요청 없음 — 기존 배포 스냅샷 유지"});
      return;
    }

    try{
      const publishRoot=path.resolve(constants.PUBLISH_DIR||process.cwd());
      const psomReports=assertMediaPsomFiles(publishRoot);
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
      // The fast isolated media stage uses the current 100-slot Media Snapshot
      // as its sample/fallback template. SearchBank seed placeholders are therefore
      // diagnostic only here; missing SearchBank seeds must not abort the deploy.
      try{
        assertSearchBankMediaSamples(currentBank.doc);
      }catch(error){
        if(error&&error.code==="searchbank_media_sample_baseline_missing"){
          console.warn("["+VERSION+"] SearchBank media sample baseline is absent; continuing with Media Snapshot fallback template:",error.problems||[]);
        }else{
          throw error;
        }
      }
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
        text:"release "+text(release.release_id)+" · "+report.output.totalManagedSlots+"개 · PSOM "+psomReports[0].report.order.length+"섹션 · "+final.hash.slice(0,16)
      });
      console.log("["+VERSION+"]",JSON.stringify(report));
    }catch(error){
      // Once a pending publication row has been loaded, remain fail-closed: do not
      // deploy a partially converted SearchBank/Media snapshot.
      utils.build.failBuild("승인 미디어의 SearchBank → Snapshot Engine → Media Snapshot 연결을 검증하지 못해 배포를 중단했습니다.",{error});
    }
  }
};
