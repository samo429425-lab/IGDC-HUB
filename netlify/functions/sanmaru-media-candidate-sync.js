"use strict";

/**
 * Sanmaru/SearchBank -> Supabase media candidate intake.
 * Thin adapter only: no public front snapshot write, no playback, no payment/revenue execution.
 */
const MediaStore = require("./lib/media-candidate-store.v1");
const AdminAuth = require("./lib/commerce-candidate-auth.v1");

const VERSION = "sanmaru-media-candidate-sync-v1.0.0-supabase-intake";

function internalAuthorized(event){
  const expected = MediaStore.text(process.env.MEDIA_CANDIDATE_SYNC_SECRET || process.env.SANMARU_INTERNAL_TOKEN || process.env.IGDC_INTERNAL_TOKEN);
  if(!expected) return false;
  const h = event && event.headers || {};
  const got = MediaStore.text(h["x-igdc-internal-token"] || h["X-IGDC-Internal-Token"] || h["x-sanmaru-token"] || h["X-Sanmaru-Token"]);
  return got && got === expected;
}
async function actorFor(event){
  if(internalAuthorized(event)) return {memberId:"sanmaru-internal", email:"sanmaru-internal", roles:["media_manager"], mode:"internal"};
  const actor = await AdminAuth.authenticateCommerceAdmin(event);
  MediaStore.requireRole(actor, "write");
  return Object.assign({}, actor, {mode:"admin"});
}
function candidatesFromBody(body){
  const raw = body.candidates || body.items || body.rows || body.results || body.mediaCandidates || body.data || [];
  return Array.isArray(raw) ? raw : [raw];
}
exports.handler = async function(event){
  if(event && event.httpMethod === "OPTIONS") return MediaStore.response(204, {});
  try{
    if(event.httpMethod === "GET"){
      MediaStore.config();
      return MediaStore.response(200,{ok:true,version:VERSION,store:MediaStore.VERSION,table:MediaStore.CANDIDATE_TABLE,mode:"ready",note:"POST candidates to sync. Section 1/media-trending is intentionally excluded."});
    }
    if(event.httpMethod !== "POST") return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const actor = await actorFor(event);
    const body = MediaStore.parseBody(event);
    const incoming = candidatesFromBody(body);
    const normalized=[];
    const rejected=[];
    incoming.forEach((item,index)=>{
      const row = MediaStore.normalizeCandidate(item, actor);
      const check = MediaStore.validateCandidate(row);
      if(check.ok) normalized.push(row);
      else rejected.push({index,id:row.id,title:row.title,section:row.section_key,reasons:check.reasons});
    });
    const saved = await MediaStore.upsertCandidates(normalized);
    return MediaStore.response(200,{ok:true,version:VERSION,actor:{mode:actor.mode,email:actor.email||null,memberId:actor.memberId||null},received:incoming.length,saved:Array.isArray(saved)?saved.length:normalized.length,rejectedCount:rejected.length,rejected,items:saved});
  }catch(error){
    return MediaStore.response(error.statusCode || 500,{ok:false,version:VERSION,error:error.code||"sanmaru_media_candidate_sync_failed",message:error.message||String(error)});
  }
};
