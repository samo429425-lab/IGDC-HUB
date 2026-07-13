"use strict";

/**
 * Media Candidate Supabase Store v1
 *
 * Thin server-only adapter between Sanmaru/SearchBank media candidates,
 * the administrator review queue, and publishable media.snapshot.json output.
 * It does not modify public static data/*.json files at runtime.
 */
const crypto = require("crypto");

const VERSION = "media-candidate-store-v1.0.0-supabase-snapshot-bridge";
const DEFAULT_TIMEOUT_MS = 12000;
const CANDIDATE_TABLE = process.env.MEDIA_CANDIDATE_TABLE || "media_candidates";
const RELEASE_TABLE = process.env.MEDIA_SNAPSHOT_RELEASE_TABLE || "media_snapshot_releases";
const ALLOWED_SECTIONS = new Set([
  "media-movie",
  "media-drama",
  "media-thriller",
  "media-romance",
  "media-variety",
  "media-documentary",
  "media-animation",
  "media-music",
  "media-shorts"
]);
const SECTION_ALIASES = Object.freeze({
  movie:"media-movie", film:"media-movie", movies:"media-movie", "media-movie":"media-movie",
  drama:"media-drama", series:"media-drama", tv:"media-drama", "media-drama":"media-drama",
  thriller:"media-thriller", mystery:"media-thriller", horror:"media-thriller", sf:"media-thriller", scifi:"media-thriller", "sci-fi":"media-thriller", "media-thriller":"media-thriller",
  romance:"media-romance", melodrama:"media-romance", classicromance:"media-romance", "media-romance":"media-romance",
  variety:"media-variety", entertainment:"media-variety", show:"media-variety", "classic-tv":"media-variety", "media-variety":"media-variety",
  documentary:"media-documentary", docs:"media-documentary", publicrecord:"media-documentary", publicrecords:"media-documentary", "media-documentary":"media-documentary",
  animation:"media-animation", anime:"media-animation", cartoon:"media-animation", "media-animation":"media-animation",
  music:"media-music", concert:"media-music", performance:"media-music", "media-music":"media-music",
  shorts:"media-shorts", short:"media-shorts", shortfilm:"media-shorts", "media-shorts":"media-shorts"
});
const READ_ROLES = new Set(["owner","admin","site_manager","site_manager_director","director","media_manager","commerce_manager"]);
const WRITE_ROLES = new Set(["owner","admin","site_manager_director","director","media_manager"]);

function text(value){return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f\u200b\u200c\u200d\ufeff]/g," ").trim();}
function lower(value){return text(value).toLowerCase().replace(/\s+/g,"_");}
function compact(value,max){const v=text(value).replace(/\s+/g," ");return v.length>(max||500)?v.slice(0,max||500):v;}
function bool(value){if(value===true)return true;if(value===false||value==null)return false;return /^(1|true|yes|on)$/i.test(text(value));}
function plain(value){return value && typeof value === "object" && !Array.isArray(value) ? value : {};}
function array(value){return Array.isArray(value)?value:(value==null?[]:[value]);}
function nowIso(){return new Date().toISOString();}
function stableStringify(value){
  if(value==null || typeof value!=="object") return JSON.stringify(value);
  if(Array.isArray(value)) return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map((key)=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}";
}
function sha256(value){return crypto.createHash("sha256").update(typeof value==="string"?value:stableStringify(value)).digest("hex");}
function shortHash(value){return sha256(value).slice(0,20);}
function normalizeUrl(value){
  const raw=text(value);
  if(!raw) return "";
  try{const url=new URL(raw);if(url.protocol!=="https:")return "";url.hash="";return url.toString();}catch(_e){return "";}
}
function hostOf(value){try{return new URL(value).hostname.toLowerCase().replace(/^www\./,"");}catch(_e){return "";}}
function normalizeSection(value){
  const raw=text(value);
  if(!raw) return "";
  if(ALLOWED_SECTIONS.has(raw)) return raw;
  const key=raw.toLowerCase().replace(/[\s_]+/g,"-").replace(/[^a-z0-9-]/g,"");
  return SECTION_ALIASES[key] || SECTION_ALIASES[key.replace(/-/g,"")] || "";
}
function roleList(member){return Array.from(new Set(array(member && member.roles).map(lower).filter(Boolean)));}
function requireRole(member, mode){
  const allowed = mode === "write" ? WRITE_ROLES : READ_ROLES;
  const roles = roleList(member);
  if(!roles.some((role)=>allowed.has(role))){
    const error=new Error(mode === "write" ? "미디어 후보 변경 권한이 없습니다." : "미디어 후보 조회 권한이 없습니다.");
    error.statusCode=403;error.code="media_candidate_forbidden";throw error;
  }
  return roles;
}
function jsonHeaders(extra){return Object.assign({
  "content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store, max-age=0",
  "x-content-type-options":"nosniff",
  "access-control-allow-headers":"Content-Type, Authorization, X-IGDC-Internal-Token",
  "access-control-allow-methods":"GET,POST,OPTIONS"
}, extra||{});}
function response(statusCode, body, headers){return{statusCode,headers:jsonHeaders(headers),body:statusCode===204?"":JSON.stringify(body)};}
function parseBody(event){
  const raw=event && event.body || "";
  if(!raw) return {};
  try{return JSON.parse(event.isBase64Encoded?Buffer.from(raw,"base64").toString("utf8"):raw);}catch(_e){const error=new Error("요청 JSON이 올바르지 않습니다.");error.statusCode=400;error.code="invalid_json_body";throw error;}
}
function firstEnv(names){for(const name of names){const value=text(process.env[name]);if(value)return{name,value};}return{name:null,value:""};}
function config(){
  const urlRec=firstEnv(["MEDIA_SUPABASE_URL","IGDC_MEDIA_SUPABASE_URL","GSLOT_SUPABASE_URL","SUPABASE_URL"]);
  const keyRec=firstEnv(["MEDIA_SUPABASE_SERVICE_ROLE_KEY","MEDIA_SUPABASE_SECRET_KEY","IGDC_MEDIA_SUPABASE_SERVICE_ROLE_KEY","IGDC_MEDIA_SUPABASE_SECRET_KEY","GSLOT_SUPABASE_SECRET_KEY","GSLOT_SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_KEY"]);
  const url=text(urlRec.value).replace(/\/+$/g,"");
  const key=text(keyRec.value);
  if(!/^https:\/\/[^/]+$/i.test(url) || !key){const error=new Error("미디어 후보 Supabase 연결 환경변수가 없습니다. MEDIA_SUPABASE_URL/MEDIA_SUPABASE_SERVICE_ROLE_KEY 또는 기존 GSLOT/SUPABASE 서버 키를 설정하세요.");error.statusCode=503;error.code="media_supabase_config_missing";throw error;}
  return {url,key,urlSource:urlRec.name,keySource:keyRec.name,candidateTable:CANDIDATE_TABLE,releaseTable:RELEASE_TABLE};
}
async function supabase(path, init){
  const cfg=config();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(), Math.max(2000, Math.min(30000, Number(process.env.MEDIA_SUPABASE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)||DEFAULT_TIMEOUT_MS)));
  const headers=Object.assign({}, init && init.headers || {}, {apikey:cfg.key,Authorization:"Bearer "+cfg.key,"content-type":"application/json"});
  try{
    const res=await fetch(cfg.url+path, Object.assign({}, init||{}, {headers, signal:controller.signal}));
    const raw=await res.text();
    let body=null;try{body=raw?JSON.parse(raw):null;}catch(_e){body=raw||null;}
    if(!res.ok){const error=new Error((body&&body.message)||(body&&body.error_description)||(body&&body.error)||raw||("Supabase HTTP "+res.status));error.statusCode=res.status;error.code=res.status===404?"media_supabase_table_missing":"media_supabase_http_error";error.supabaseBody=body;throw error;}
    return body;
  }catch(error){if(error && error.name==="AbortError"){error.statusCode=504;error.code="media_supabase_timeout";}throw error;} finally{clearTimeout(timer);}
}
function rest(table, query){return "/rest/v1/"+encodeURIComponent(table)+(query?"?"+query:"");}
function encodeEq(value){return "eq."+encodeURIComponent(text(value));}
function encodeIn(values){return "in.("+values.map((v)=>JSON.stringify(text(v))).join(",")+")";}
async function selectCandidates(query){return supabase(rest(CANDIDATE_TABLE, query || "select=*"), {method:"GET",headers:{Prefer:"count=exact"}});}
async function upsertCandidates(rows){
  if(!rows.length) return [];
  return supabase(rest(CANDIDATE_TABLE,"on_conflict=id"), {method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(rows)});
}
async function updateCandidates(ids, patch){
  const list=Array.from(new Set(array(ids).map(text).filter(Boolean)));
  if(!list.length) return [];
  return supabase(rest(CANDIDATE_TABLE,"id="+encodeIn(list)), {method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch||{})});
}
async function insertRelease(row){return supabase(rest(RELEASE_TABLE), {method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([row])});}
function normalizeCandidate(input, actor){
  const row=plain(input);
  const section=normalizeSection(row.section_key || row.sectionKey || row.section || row.targetSection || row.category);
  const title=compact(row.title || row.name || row.contentTitle, 240);
  const provider=compact(row.provider || row.sourceProvider || row.channel || row.publisher || row.source, 160);
  const sourceUrl=normalizeUrl(row.source_url || row.sourceUrl || row.url || row.pageUrl || row.link || row.href);
  const videoUrl=normalizeUrl(row.video_url || row.videoUrl || row.fileUrl || row.mediaUrl || row.downloadUrl);
  const embedUrl=normalizeUrl(row.embed_url || row.embedUrl || row.embed || row.iframeUrl);
  const thumbUrl=normalizeUrl(row.thumb_url || row.thumbUrl || row.thumbnail || row.thumbnailUrl || row.poster || row.image);
  const host=hostOf(sourceUrl || videoUrl || embedUrl || thumbUrl);
  const idRaw=text(row.id || row.contentId || row.candidateId) || "media_"+shortHash({section,title,provider,sourceUrl,videoUrl,embedUrl});
  const id=idRaw.toLowerCase().replace(/[^a-z0-9_.:-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,96) || "media_"+shortHash({title,provider,sourceUrl});
  const rightsStatus=lower(row.rights_status || row.rightsStatus || row.license || row.rights && row.rights.status) || "web_verification_required";
  const verificationStatus=lower(row.verification_status || row.verificationStatus) || "web_verification_required";
  const reviewStatus=lower(row.review_status || row.reviewStatus) || "pending";
  return {
    id,
    section_key: section,
    title,
    provider,
    source_url: sourceUrl,
    video_url: videoUrl,
    embed_url: embedUrl,
    thumb_url: thumbUrl,
    source_host: host,
    quality_hint: compact(row.quality_hint || row.qualityHint || row.quality || row.resolution, 80),
    rights_status: rightsStatus,
    allowed_use: lower(row.allowed_use || row.allowedUse) || "verification_required",
    verification_status: verificationStatus,
    review_status: reviewStatus,
    risk_level: lower(row.risk_level || row.riskLevel) || "unverified",
    priority: compact(row.priority || row.rank || "B2", 30),
    candidate_only: row.candidateOnly === undefined ? true : bool(row.candidateOnly),
    seed_content: row.seedContent === undefined ? true : bool(row.seedContent),
    sanmaru_query: compact(row.sanmaru_query || row.sanmaruSearchSeed || row.searchSeed || row.query, 500),
    notes: compact(row.notes || row.note || row.reason || "", 1000),
    raw: row,
    created_by: compact(actor && (actor.email || actor.memberId) || "sanmaru", 200),
    updated_by: compact(actor && (actor.email || actor.memberId) || "sanmaru", 200),
    updated_at: nowIso()
  };
}
function validateCandidate(row){
  const reasons=[];
  if(!ALLOWED_SECTIONS.has(row.section_key)) reasons.push("section_2_to_10_required");
  if(!row.title) reasons.push("title_required");
  if(!row.provider && !row.source_host) reasons.push("provider_or_source_required");
  if(!row.source_url && !row.video_url && !row.embed_url) reasons.push("source_or_play_url_required");
  return {ok:reasons.length===0,reasons};
}
function snapshotEligible(row){
  const review=lower(row.review_status);
  const verify=lower(row.verification_status);
  const rights=lower(row.rights_status);
  const allowed=lower(row.allowed_use);
  const urls=[row.source_url,row.video_url,row.embed_url].map(normalizeUrl).filter(Boolean);
  const thumb=normalizeUrl(row.thumb_url);
  const blocked = row.candidate_only === true || row.seed_content === true || /pending|verification_required|web_verification_required|candidate|hold|blocked|rejected/.test(review+" "+verify+" "+rights+" "+allowed);
  return review === "approved" && verify === "approved_for_snapshot" && !blocked && !!row.title && !!thumb && urls.length>0;
}
function publicSlot(row, slotId, defaults){
  const base=plain(defaults);
  const sourceUrl=normalizeUrl(row.source_url || row.embed_url || row.video_url);
  const videoUrl=normalizeUrl(row.video_url);
  const embedUrl=normalizeUrl(row.embed_url);
  return Object.assign({}, base, {
    slotId: Number(slotId)||base.slotId||1,
    contentId: text(row.id),
    id: text(row.id),
    title: text(row.title),
    thumb: normalizeUrl(row.thumb_url),
    provider: text(row.provider || row.source_host),
    url: sourceUrl,
    link: sourceUrl,
    video: videoUrl || undefined,
    embedUrl: embedUrl || undefined,
    quality: text(row.quality_hint),
    rights: {
      status: text(row.rights_status || "approved"),
      allowedUse: text(row.allowed_use || "embed-only"),
      verifiedAt: text(row.reviewed_at || row.updated_at || nowIso()),
      sourceUrl: sourceUrl,
      provider: text(row.provider || row.source_host),
      platformTermsRequired: true,
      copyrightCheckRequired: false
    },
    candidateOnly: false,
    seedContent: false,
    verificationStatus: "approved_for_snapshot",
    outbound: Object.assign({}, plain(base.outbound), {enabled:true, track:true}),
    payment: {enabled:false, type:"none", price:null, currency:"USD", pg:null, productId:null},
    revenue: {ads:true, affiliate:false, provider:false, directSale:false}
  });
}
function groupsBySection(rows){
  const out={};
  Array.from(ALLOWED_SECTIONS).forEach((section)=>{out[section]=[];});
  rows.forEach((row)=>{const section=normalizeSection(row.section_key);if(section)out[section].push(row);});
  Object.keys(out).forEach((section)=>out[section].sort((a,b)=>{
    const ap=text(a.approved_at || a.reviewed_at || a.updated_at); const bp=text(b.approved_at || b.reviewed_at || b.updated_at);
    if(ap!==bp) return ap<bp?1:-1;
    return text(a.title).localeCompare(text(b.title));
  }));
  return out;
}
function buildSnapshot(baseSnapshot, rows, opts){
  const base=plain(baseSnapshot);
  const sections=plain(base.sections);
  const groups=groupsBySection(rows.filter(snapshotEligible));
  const filled={};
  Object.keys(groups).forEach((sectionKey)=>{
    const current=sections[sectionKey];
    const sectionObj=Array.isArray(current)?{title:sectionKey,slots:current,key:sectionKey}:plain(current);
    const slots=Array.isArray(sectionObj.slots)?sectionObj.slots.slice():[];
    const capacity=Math.max(slots.length, Number(opts && opts.capacityPerSection)||90);
    const next=[];
    for(let i=0;i<capacity;i++) next.push(slots[i] ? Object.assign({}, slots[i]) : {slotId:i+1, contentId:null, title:null, thumb:"#", provider:null});
    groups[sectionKey].slice(0,capacity).forEach((row,index)=>{next[index]=publicSlot(row,index+1,next[index]);});
    sections[sectionKey]=Object.assign({}, sectionObj, {key:sectionKey, slots:next});
    filled[sectionKey]=Math.min(groups[sectionKey].length,capacity);
  });
  return Object.assign({}, base, {
    version:"media.snapshot.generated.supabase.v1",
    type:"media_snapshot",
    sections,
    meta:Object.assign({}, plain(base.meta), {
      generatedAt:nowIso(),
      generatedBy:"media-snapshot-publish",
      source:"supabase.media_candidates",
      section1Policy:"media-trending is not manually seeded; only sections 2-10 are filled here.",
      filled
    })
  });
}
module.exports={
  VERSION, CANDIDATE_TABLE, RELEASE_TABLE, ALLOWED_SECTIONS,
  text, lower, compact, bool, plain, array, nowIso, sha256, shortHash, normalizeUrl, hostOf, normalizeSection, roleList, requireRole,
  response, parseBody, config, supabase, rest, encodeEq, encodeIn, selectCandidates, upsertCandidates, updateCandidates, insertRelease,
  normalizeCandidate, validateCandidate, snapshotEligible, publicSlot, buildSnapshot
};
