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

const VERSION = "media-snapshot-publish-v1.0.1-shared-admin-auth";

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
  const safeLimit=Math.max(1,Math.min(1000,Number(limit)||900));
  return "select=*&review_status=eq.approved&verification_status=eq.approved_for_snapshot&candidate_only=eq.false&seed_content=eq.false&order=section_key.asc,approved_at.desc,title.asc&limit="+safeLimit;
}
exports.handler = async function(event){
  if(event && event.httpMethod === "OPTIONS") return MediaStore.response(204,{});
  try{
    if(!["GET","POST"].includes(event.httpMethod)) return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const params=Object.assign({}, event.queryStringParameters || {}, event.httpMethod === "POST" ? MediaStore.parseBody(event) : {});
    const storeRelease = params.storeRelease === true || params.storeRelease === "true";
    const actor=await actorFor(event, storeRelease);
    const rows=await MediaStore.selectCandidates(queryApproved(params.limit));
    const base=baseSnapshot();
    const snapshot=MediaStore.buildSnapshot(base.doc, Array.isArray(rows)?rows:[], {capacityPerSection: Number(params.capacityPerSection)||90});
    const hash=MediaStore.sha256(snapshot);
    const eligible=Array.isArray(rows)?rows.filter(MediaStore.snapshotEligible).length:0;
    const release={
      release_id:"media_snapshot_"+MediaStore.shortHash({hash,at:MediaStore.nowIso()}),
      snapshot_hash:hash,
      snapshot,
      status: storeRelease ? "stored" : "preview",
      counts:{approvedRows:Array.isArray(rows)?rows.length:0,eligibleRows:eligible,sections:snapshot.meta&&snapshot.meta.filled||{}},
      created_by:MediaStore.compact(actor.email || actor.memberId || "admin",200),
      created_at:MediaStore.nowIso()
    };
    let stored=null;
    if(storeRelease) stored=await MediaStore.insertRelease(release);
    if(params.download === "1" || params.download === true || params.format === "snapshot"){
      return {statusCode:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","content-disposition":"attachment; filename=media.snapshot.generated.json"},body:JSON.stringify(snapshot,null,2)+"\n"};
    }
    return MediaStore.response(200,{ok:true,version:VERSION,baseFile:base.file,hash,approvedRows:Array.isArray(rows)?rows.length:0,eligibleRows:eligible,releaseStored:!!stored,stored,release:params.includeSnapshot === "1" ? release : Object.assign({}, release, {snapshot:undefined}),snapshot:params.includeSnapshot === "1" ? snapshot : undefined});
  }catch(error){
    return MediaStore.response(error.statusCode || 500,{ok:false,version:VERSION,error:error.code||"media_snapshot_publish_failed",message:error.message||String(error)});
  }
};
