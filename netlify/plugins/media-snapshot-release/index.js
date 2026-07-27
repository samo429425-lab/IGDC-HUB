"use strict";

const crypto=require("crypto");
const fs=require("fs");
const path=require("path");

const VERSION="igdc-media-snapshot-release-build-plugin-v1.0.0";
const DEFAULT_TABLE="media_snapshot_releases";

function text(value){return value==null?"":String(value).trim();}
function lower(value){return text(value).toLowerCase();}
function firstEnv(names){
  for(const name of names){
    const value=text(process.env[name]);
    if(value)return{name,value};
  }
  return{name:null,value:""};
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return"["+value.map(stableStringify).join(",")+"]";
  return"{"+Object.keys(value).sort().map((key)=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}";
}
function sha256(value){
  return crypto.createHash("sha256").update(typeof value==="string"?value:stableStringify(value)).digest("hex");
}
function releaseArmed(){
  const mode=lower(process.env.MEDIA_RELEASE_MODE);
  const key=text(process.env.MEDIA_RELEASE_KEY);
  return mode==="enabled"&&key.length>=32;
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
  if(!/^https:\/\/[^/]+$/i.test(normalizedUrl)||!text(key.value)){
    throw new Error("media_snapshot_release_storage_not_configured");
  }
  return{
    url:normalizedUrl,key:text(key.value),
    table:text(process.env.MEDIA_SNAPSHOT_RELEASE_TABLE)||DEFAULT_TABLE
  };
}
function safeManagedSlots(snapshot){
  if(!snapshot||snapshot.type!=="media_snapshot"||!snapshot.sections||typeof snapshot.sections!=="object"){
    throw new Error("media_snapshot_release_structure_invalid");
  }
  Object.entries(snapshot.sections).forEach(([sectionKey,section])=>{
    const slots=Array.isArray(section)?section:(section&&Array.isArray(section.slots)?section.slots:[]);
    slots.forEach((slot,index)=>{
      if(!slot||slot.managedBy!=="media-snapshot-publish")return;
      const release=slot.releaseContract||{};
      if(
        slot.candidateOnly!==false||
        slot.seedContent!==false||
        slot.verificationStatus!=="approved_for_snapshot"||
        release.eligible!==true||
        !text(slot.title)||
        !/^https:\/\//i.test(text(slot.thumb))||
        !/^https:\/\//i.test(text(slot.url||slot.video||slot.embedUrl))
      ){
        throw new Error("unsafe_managed_media_slot:"+sectionKey+":"+(index+1));
      }
    });
  });
  return snapshot;
}
function incomingReleaseExpectation(){
  const raw=text(process.env.INCOMING_HOOK_BODY);
  if(!raw)return{};
  try{
    const body=JSON.parse(raw);
    if(body&&body.trigger==="approved-media-snapshot-release"){
      return{releaseId:text(body.releaseId),snapshotHash:text(body.snapshotHash)};
    }
  }catch(_error){}
  return{};
}
async function latestRelease(settings){
  const query=new URLSearchParams();
  query.set("select","release_id,snapshot_hash,snapshot,status,created_at");
  query.set("status","eq.stored");
  query.set("order","created_at.desc");
  query.set("limit","1");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(
      settings.url+"/rest/v1/"+encodeURIComponent(settings.table)+"?"+query.toString(),
      {
        method:"GET",signal:controller.signal,
        headers:{
          apikey:settings.key,
          authorization:"Bearer "+settings.key,
          accept:"application/json"
        }
      }
    );
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(body&&body.message||"media_snapshot_release_http_"+response.status);
    const release=Array.isArray(body)&&body[0];
    if(!release)throw new Error("stored_media_snapshot_release_not_found");
    return release;
  }finally{clearTimeout(timer);}
}
function atomicWrite(file,document){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+".release-"+process.pid+"-"+Date.now()+".tmp";
  try{
    fs.writeFileSync(temporary,JSON.stringify(document,null,2)+"\n",{encoding:"utf8",mode:0o644});
    JSON.parse(fs.readFileSync(temporary,"utf8"));
    fs.renameSync(temporary,file);
  }finally{
    try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch(_error){}
  }
}

module.exports={
  onPreBuild:async({constants,utils})=>{
    if(!releaseArmed()){
      utils.status.show({
        title:"IGDC 미디어 스냅샷",
        summary:"공개 게이트 비활성 — 기존 배포 스냅샷 유지"
      });
      return;
    }
    try{
      const settings=config();
      const release=await latestRelease(settings);
      const snapshot=safeManagedSlots(release.snapshot);
      const actualHash=sha256(snapshot);
      if(actualHash!==text(release.snapshot_hash))throw new Error("media_snapshot_release_hash_mismatch");
      const expected=incomingReleaseExpectation();
      if(expected.releaseId&&expected.releaseId!==text(release.release_id))throw new Error("media_snapshot_release_id_mismatch");
      if(expected.snapshotHash&&expected.snapshotHash!==actualHash)throw new Error("media_snapshot_hook_hash_mismatch");
      const publishRoot=path.resolve(constants.PUBLISH_DIR||process.cwd());
      atomicWrite(path.join(publishRoot,"data","media.snapshot.json"),snapshot);
      atomicWrite(path.join(publishRoot,"netlify","functions","data","media.snapshot.json"),snapshot);
      utils.status.show({
        title:"IGDC 미디어 스냅샷",
        summary:"승인 릴리스 적용 완료",
        text:"release "+text(release.release_id)+" · "+actualHash.slice(0,16)
      });
      console.log("["+VERSION+"] applied release",text(release.release_id),actualHash);
    }catch(error){
      utils.build.failBuild("승인된 미디어 스냅샷을 안전하게 적용하지 못해 배포를 중단했습니다.",{error});
    }
  }
};
