"use strict";
/* Dedicated server-authenticated agreement registry. Does not modify Social rightPanel. */
const Store = require("./lib/social-candidate-store.v1");
const Partners = require("./lib/social-promotion-partners.v1");
const Admin = require("./lib/global-slot-console-auth");
const VERSION = "social-promotion-partners-v1.0.0";
const t = Store.text;
function fail(status, code, msg) { const e = new Error(msg || code); e.statusCode=status; e.code=code; throw e; }
function optionalUrl(value) { if (!t(value)) return ""; const url=Partners.validUrl(value); if (!url) fail(400,"invalid_url","HTTPS 주소를 확인하세요.");return url; }
function isoDay(value) {
  if (!t(value)) return null;
  const x=t(value), dt=new Date(x);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || !Number.isFinite(dt.getTime()) || dt.toISOString().slice(0,10)!==x)
    fail(400,"invalid_contract_date","협약 시작·종료일 형식이 올바르지 않습니다.");
  return x;
}
function fields(body) {
  const section = t(body.sectionKey);
  const name = t(body.displayName).slice(0,180);
  if (!name || !Partners.SECTIONS.has(section)) fail(400,"invalid_partner","제휴 명칭과 SNS를 확인하세요.");
  const url=Partners.validUrl(body.channelUrl,section);
  if (!url) fail(400,"invalid_partner_channel","해당 SNS의 공식 HTTPS 채널 주소가 필요합니다.");
  const kind = t(body.partnerKind);
  if (!["influencer","business"].includes(kind)) fail(400,"invalid_partner_kind");
  const status = t(body.cooperationStatus);
  if (!["prospect","negotiating","paused"].includes(status)) fail(400,"invalid_status");
  const signedFrom=isoDay(body.signedFrom),signedUntil=isoDay(body.signedUntil);
  if (signedFrom && signedUntil && signedUntil<signedFrom) fail(400,"invalid_contract_range");
  return { display_name:name, partner_kind:kind, section_key:section, channel_url:url,
    website_url:optionalUrl(body.websiteUrl), promotion_target_url:optionalUrl(body.promotionTargetUrl),
    target_kind:["distribution","media","platform"].includes(t(body.targetKind)) ? t(body.targetKind) : "distribution",
    cooperation_status:status, signed_from:signedFrom, signed_until:signedUntil,
    contract_proof_reference:t(body.contractProofReference).slice(0,240), notes:t(body.notes).slice(0,1000) };
}
async function byId(id) {
  if (!/^[a-f0-9-]{36}$/i.test(t(id))) fail(400,"invalid_partner_id");
  const rows=await Store.supabase(Store.rest(Partners.TABLE,
    "select=*&id=eq."+encodeURIComponent(id)+"&limit=1"),{method:"GET"});
  if (!rows || !rows.length) fail(404,"partner_not_found");
  return rows[0];
}
function counts(rows) {
  const byStatus={},bySection={}; let eligible=0;
  rows.forEach(p=>{ byStatus[p.cooperation_status]=(byStatus[p.cooperation_status]||0)+1;
    bySection[p.section_key]=(bySection[p.section_key]||0)+1;
    if(Partners.active(p)) eligible++; });
  return {total:rows.length,activeVerifiedEligible:eligible,byStatus,bySection,
    truncated:rows.length===500};
}
exports.handler = async function(event) {
  if (event.httpMethod==="OPTIONS") return Store.response(204,{});
  try {
    if (!["GET","POST"].includes(event.httpMethod)) return Store.response(405,{ok:false,error:"method_not_allowed"});
    const actor=await Admin.resolveUser(event);
    Store.requireRole(actor,"read");
    let body={}; if(event.httpMethod==="POST") { Store.requireRole(actor,"write");
      try {if((event.body||"").length>9000) fail(413,"payload_too_large");body=JSON.parse(event.body||"{}");}
      catch(error) { if(error.statusCode)throw error;fail(400,"invalid_json"); } }
    const action=event.httpMethod==="GET"?t(event.queryStringParameters && event.queryStringParameters.action)||"list":t(body.action);
    const now=Store.nowIso(), by=t(actor.email || actor.memberId || actor.sub).slice(0,200);
    if(action==="list" || action==="diagnostic") {
      const rows=await Partners.list();
      const safeRows=(Array.isArray(rows)?rows:[]).map(p=>({id:p.id,displayName:p.display_name,partnerKind:p.partner_kind,
        sectionKey:p.section_key,channelUrl:p.channel_url,websiteUrl:p.website_url,promotionTargetUrl:p.promotion_target_url,
        targetKind:p.target_kind,cooperationStatus:p.cooperation_status,priorityEnabled:p.priority_enabled===true,
        verifiedAt:p.verified_at,verifiedBy:p.verified_by,contractProofReference:p.contract_proof_reference,
        signedFrom:p.signed_from,signedUntil:p.signed_until,notes:p.notes,updatedAt:p.updated_at,createdAt:p.created_at,
        activeEligible:Partners.active(p)}));
      const report={ok:true,version:VERSION,reportType:action==="diagnostic"?"igdc-social-promotion-partner-diagnostic":"igdc-social-partners-list",
        generatedAt:now,readOnly:true,source:Partners.TABLE,summary:counts(Array.isArray(rows)?rows:[]),
        checks:{authenticatedAdmin:true,partnerStoreReachable:true,verifiedPriorityRequiresSignedEvidence:true,
          candidateSafetyReviewStillRequired:true,snsProviderOriginalUiUntouched:true,rightDistributionPanelUntouched:true},
        rows:safeRows};
      if(action==="diagnostic") {
        report.issues=safeRows.filter(p=>p.cooperationStatus==="active" && !p.activeEligible)
          .map(p=>({id:p.id,name:p.displayName,issue:"contract_inactive_or_not_verifiable"}));
      }
      return Store.response(200,report);
    }
    if(action==="save") {
      const payload=fields(body), id=t(body.id);
      let current=null;
      if(id) current=await byId(id);
      if(current && current.cooperation_status==="active" && current.verified_at) {
        // Editing a verified agreement requires a fresh director-level verification.
        payload.priority_enabled=false;payload.verified_at=null;payload.verified_by=null;
      }
      payload.updated_by=by;payload.updated_at=now;
      if(!current) {payload.created_by=by;payload.created_at=now;}
      const path=Store.rest(Partners.TABLE,current?"id=eq."+encodeURIComponent(id):"");
      const result=await Store.supabase(path,{method:current?"PATCH":"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(current?payload:[payload])});
      return Store.response(200,{ok:true,action,saved:(result||[])[0] && (result||[])[0].id || id,verificationRevoked:!!(current && current.verified_at)});
    }
    if(action==="verify") {
      Admin.requireCapability(actor,"policy");
      const current=await byId(body.id);
      if(!["prospect","negotiating","paused","active"].includes(current.cooperation_status))fail(409,"invalid_contract_status");
      if(!current.contract_proof_reference || !current.signed_from) fail(409,"contract_proof_required","증빙 참조번호 및 협약 시작일 등록 후 승인하세요.");
      if(!Partners.validUrl(current.channel_url,current.section_key))fail(409,"invalid_channel");
      const day=now.slice(0,10);
      if(current.signed_until && current.signed_until<day)fail(409,"contract_expired","협약 종료일이 경과했습니다.");
      if(current.signed_from>day)fail(409,"contract_not_started","협약 시작일 전에는 활성화할 수 없습니다.");
      await Store.supabase(Store.rest(Partners.TABLE,"id=eq."+encodeURIComponent(current.id)),{
        method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({
          cooperation_status:"active",priority_enabled:true,verified_by:by,verified_at:now,updated_by:by,updated_at:now})});
      return Store.response(200,{ok:true,action,verified:true,partnerId:current.id});
    }
    if(action==="pause") {
      const current=await byId(body.id);
      await Store.supabase(Store.rest(Partners.TABLE,"id=eq."+encodeURIComponent(current.id)),{
        method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({
          cooperation_status:"paused",priority_enabled:false,verified_at:null,verified_by:null,updated_by:by,updated_at:now})});
      return Store.response(200,{ok:true,action,partnerId:current.id});
    }
    return Store.response(400,{ok:false,error:"invalid_action"});
  }catch(error) {return Store.response(error.statusCode||500,{ok:false,version:VERSION,error:error.code||"social_partner_management_failed",message:error.message||String(error),
    note:error.statusCode===404?"소셜 제휴 관리 SQL 테이블 생성 여부를 확인하세요.":undefined});}
};
