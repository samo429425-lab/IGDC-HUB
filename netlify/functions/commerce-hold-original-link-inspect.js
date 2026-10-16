"use strict";
/**
 * Read-only, administrator-only lookup of a previously recorded exact product URL.
 * Does not crawl, bypass seller protections, mutate candidate/placement or publish.
 */
const Auth = require("./lib/global-slot-console-auth");
const Store = require("./lib/global-slot-console-supabase");
const Ranking = require("./lib/commerce-product-ranking.v1");
const Historical = require("./lib/igdc-original-product-url-evidence-20261013-all-safe.json");
const ROLES = new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager"]);
const SOURCE_REF = "country-product-ranking-review";
const txt = v => v == null ? "" : String(v).trim();
const plain = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const norm = v => txt(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const respond = (code, payload) => ({statusCode:code,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff"},body:JSON.stringify(payload)});
function proofUrl(value){
  try {
    const u = new URL(txt(value));
    if(u.protocol!=="https:" || u.username || u.password || !u.hostname)return "";
    if(/(?:^|\/)(?:challenge|captcha|access[-_]denied|bot[-_]check|security[-_]check)(?:\/|$)/i.test(u.pathname))return "";
    const url = u.toString();
    return Ranking.isSpecificProductUrl(url) && Ranking.productIdFromUrl(url) ? url : "";
  }catch(_e){return "";}
}
function scopeMatches(row,country,region){
  const p=plain(row.source_payload),scope=plain(p.marketScope),placement=plain(p.approvedPlacement||p.selectedPlacement||p.placement);
  const c=txt(scope.marketCountry||p.countryCode||p.targetCountry||placement.country).toUpperCase();
  const r=txt(scope.marketRegion||p.targetRegion||placement.region||"NATIONWIDE").toUpperCase();
  if(c!==country)return false;
  return region==="NATIONWIDE" ? r==="NATIONWIDE" : r===region||r==="NATIONWIDE";
}
function inspect(row){
  const record=plain(plain(Historical).entries)[txt(row.id)],p=plain(row.source_payload),url=proofUrl(record&&record.url);
  const name=txt(row.title||p.productName||p.title),recordName=txt(record&&record.name);
  if(!url || !norm(name) || norm(name)!==norm(recordName))return {found:false,reason:"exact_candidate_original_url_proof_unavailable"};
  return {found:true,originalUrl:url,source:"2026-10-13-exact-candidate-id-and-title",productName:name,liveVerified:false,warning:"이전 원장 상세주소입니다. 판매자 서버의 현재 접속 허용 여부는 확인되지 않았습니다."};
}
exports.handler=async event=>{
  try{
    if(txt(event&&event.httpMethod).toUpperCase()==="OPTIONS")return respond(204,{});
    if(txt(event&&event.httpMethod).toUpperCase()!=="GET")return respond(405,{ok:false,error:"read_only_get_required"});
    const actor=await Auth.resolveUser(event);
    if(!Array.isArray(actor&&actor.roles)||!actor.roles.some(role=>ROLES.has(txt(role).toLowerCase())))return respond(403,{ok:false,error:"administrator_required"});
    const q=plain(event&&event.queryStringParameters),id=txt(q.candidateId),country=txt(q.country).toUpperCase(),region=txt(q.region||"NATIONWIDE").toUpperCase();
    if(!/^country_product_[0-9a-f]{24}$/i.test(id)||!/^[A-Z]{2}$/.test(country)||!/^[A-Z0-9_-]{3,60}$/.test(region))return respond(400,{ok:false,error:"invalid_candidate_or_scope"});
    const rows=await Store.select("gslot_candidates","select=id,title,source_ref,source_payload&id=eq."+encodeURIComponent(id)+"&limit=1");
    const row=Array.isArray(rows)?rows[0]:null;
    if(!row||txt(row.source_ref)!==SOURCE_REF||!scopeMatches(row,country,region))return respond(200,{ok:true,found:false,reason:"candidate_missing_or_out_of_scope",readOnly:true});
    return respond(200,Object.assign({ok:true,candidateId:id,readOnly:true,dispositionUnchanged:true,frontMatch:false},inspect(row)));
  }catch(error){return respond(500,{ok:false,error:txt(error&&error.message)||"original_lookup_failed"});}
};
exports._test={proofUrl,scopeMatches,inspect};
