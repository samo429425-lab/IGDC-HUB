"use strict";

/**
 * Media Candidate Supabase Store v1
 *
 * Thin server-only adapter between Sanmaru/SearchBank media candidates,
 * the administrator review queue, and publishable media.snapshot.json output.
 * It does not modify public static data/*.json files at runtime.
 */
const crypto = require("crypto");
const MediaPolicy = require("./media-candidate-policy.v2");

const VERSION = "media-candidate-store-v1.3.1-persistent-front-reserve120-thumb-optional";
const MEDIA_SAMPLE_THUMB = "https://igdcglobal.com/assets/images/media-sample-card.png";
const DEFAULT_TIMEOUT_MS = 12000;
const CANDIDATE_TABLE = process.env.MEDIA_CANDIDATE_TABLE || "media_candidates";
const FRONT_CAPACITY = 100;
const RESERVE_CAPACITY = 120;
const INACTIVE_RESERVE_STATUSES = new Set(["rejected","permanent_blocked","search_excluded","deleted","exclusion_released"]);
const RELEASE_TABLE = process.env.MEDIA_SNAPSHOT_RELEASE_TABLE || "media_snapshot_releases";
const RELEASE_WRITE_COLUMNS = new Set(["release_id","snapshot_hash","snapshot","status","created_by","created_at"]);
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
function reserveCandidateActive(row){
  if(!row || row.candidate_only === false) return false;
  return !INACTIVE_RESERVE_STATUSES.has(lower(row.review_status));
}
async function sectionReserveState(sectionKey){
  const section=normalizeSection(sectionKey);
  if(!section) return {sectionKey:"",count:0,ids:new Set(),capacity:RESERVE_CAPACITY,remaining:0};
  const query="select=id,section_key,review_status,candidate_only&section_key="+encodeEq(section)+"&limit=1000";
  const rows=await selectCandidates(query);
  const active=(Array.isArray(rows)?rows:[]).filter(reserveCandidateActive);
  return {sectionKey:section,count:active.length,ids:new Set(active.map((row)=>text(row&&row.id)).filter(Boolean)),capacity:RESERVE_CAPACITY,remaining:Math.max(0,RESERVE_CAPACITY-active.length)};
}
async function appendCandidatesWithinReserve(rows, capacity){
  const cap=Math.max(1,Math.min(RESERVE_CAPACITY,Number(capacity)||RESERVE_CAPACITY));
  const incoming=Array.isArray(rows)?rows:[];
  const grouped={};
  incoming.forEach((row)=>{const section=normalizeSection(row&&row.section_key);if(section)(grouped[section]||(grouped[section]=[])).push(row);});
  const accepted=[],skippedExisting=[],skippedCapacity=[],states={};
  for(const section of Object.keys(grouped)){
    const query="select=id,section_key,review_status,candidate_only&section_key="+encodeEq(section)+"&limit=1000";
    const existing=await selectCandidates(query);
    const all=Array.isArray(existing)?existing:[];
    const allIds=new Set(all.map((row)=>text(row&&row.id)).filter(Boolean));
    const active=all.filter(reserveCandidateActive);
    let remaining=Math.max(0,cap-active.length);
    for(const row of grouped[section]){
      const id=text(row&&row.id);if(!id)continue;
      if(allIds.has(id)){skippedExisting.push(id);continue;}
      if(remaining<=0){skippedCapacity.push(id);continue;}
      accepted.push(row);allIds.add(id);remaining-=1;
    }
    states[section]={existingActive:active.length,capacity:cap,remainingAfter:remaining};
  }
  const saved=accepted.length?await upsertCandidates(accepted):[];
  return {saved:Array.isArray(saved)?saved:accepted,accepted,skippedExisting,skippedCapacity,states,capacity:cap};
}

async function updateCandidates(ids, patch){
  const list=Array.from(new Set(array(ids).map(text).filter(Boolean)));
  if(!list.length) return [];
  return supabase(rest(CANDIDATE_TABLE,"id="+encodeIn(list)), {method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch||{})});
}
async function deleteCandidates(ids){
  const list=Array.from(new Set(array(ids).map(text).filter(Boolean)));
  if(!list.length) return [];
  return supabase(rest(CANDIDATE_TABLE,"id="+encodeIn(list)), {method:"DELETE",headers:{Prefer:"return=representation"}});
}
function releaseStorageContract(){return {ok:true,table:RELEASE_TABLE,writeColumns:Array.from(RELEASE_WRITE_COLUMNS),durable:true,source:"supabase"};}
async function insertRelease(row){const clean={};for(const key of RELEASE_WRITE_COLUMNS){if(row&&row[key]!==undefined)clean[key]=row[key];}return supabase(rest(RELEASE_TABLE), {method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([clean])});}
async function selectReleaseById(releaseId){const id=text(releaseId);if(!id)return null;const rows=await supabase(rest(RELEASE_TABLE,"select=release_id,snapshot_hash,snapshot,status,created_by,created_at&release_id="+encodeEq(id)+"&limit=1"),{method:"GET"});return Array.isArray(rows)&&rows[0]?rows[0]:null;}
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
  const policyAssessment=MediaPolicy.assessCandidate(row, {adminException:row.adminException===true || row.sourceMetadata && row.sourceMetadata.adminException===true});
  const reviewStatus=policyAssessment.reviewStatus;
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
    allowed_use: rightsStatus === "public_rights_signal_found" ? "rights_evidence_review_required" : "verification_required",
    verification_status: reviewStatus === "permanent_blocked" ? "permanent_blocked" : "web_verification_required",
    review_status: reviewStatus,
    risk_level: policyAssessment.riskLevel,
    priority: compact(row.priority || row.rank || "B2", 30),
    candidate_only: true,
    seed_content: true,
    sanmaru_query: compact(row.sanmaru_query || row.sanmaruSearchSeed || row.searchSeed || row.query, 500),
    notes: compact(row.notes || row.note || row.reason || "", 1000),
    raw: Object.assign({}, row, {policyAssessment}),
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
  const urls=[row.source_url,row.video_url,row.embed_url].map(normalizeUrl).filter(Boolean);
  return MediaPolicy.releaseEligibility(row).ok && !!row.title && urls.length>0;
}
function slotImage(slot){return text(slot&&(slot.thumb||slot.thumbnail||slot.image||slot.poster));}
function slotUrl(slot){return text(slot&&(slot.url||slot.link||slot.video||slot.embedUrl));}
function slotLooksLikeSample(slot){
  if(!slot || typeof slot!=="object")return true;
  if(slot.sample===true||slot.isSample===true||slot.placeholder===true||slot.replaceableSlot===true||slot.candidateOnly===true||slot.seedContent===true)return true;
  if(slot.managedBy==="media-snapshot-publish")return false;
  const title=text(slot.title||slot.name),image=slotImage(slot).toLowerCase(),url=slotUrl(slot).toLowerCase();
  if(!title&&(!url||url==="#"||url.startsWith("javascript:")))return true;
  if(image.includes("/assets/sample/")||image.includes("placeholder"))return true;
  if(/^media\s+(?:item|slot)\s+\d+$/i.test(title))return true;
  return slot.managedBy!=="media-snapshot-publish"&&!MediaPolicy.publicReleaseAllowed(slot);
}
function sampleFallbackFor(slot,index){
  const current=plain(slot);
  if(current.fallbackSample&&typeof current.fallbackSample==="object")return Object.assign({},current.fallbackSample,{slotId:Number(current.slotId)||Number(current.fallbackSample.slotId)||index+1});
  if(slotLooksLikeSample(current))return Object.assign({},current,{slotId:Number(current.slotId)||index+1});
  return {slotId:Number(current.slotId)||index+1,contentId:null,title:null,thumb:"#",provider:null,placeholder:true};
}
function scoreSignals(value){
  const row=plain(value),raw=plain(row.raw),source=plain(raw.sourceMetadata);
  const rank=Number(raw.rankingScore||row.rankingScore||row.ranking_score||((text(row.priority).match(/(\d+(?:\.\d+)?)/)||[])[1])||0);
  const height=Number(source.height||raw.height||((text(row.quality_hint||row.quality).match(/(\d{3,4})p/i)||[])[1])||0);
  const year=Number(raw.year||source.year||row.year||0),downloads=Number(source.downloads||raw.downloads||0),latency=Number(plain(raw.playbackProbe||source.playbackProbe).latencyMs||0);
  const score=rank+Math.min(10,Math.max(0,(height-720)/144))+(year>=2024?5:year>=2020?3:year>=2015?1:0)+Math.min(4,Math.log10(Math.max(1,downloads)))-(latency>3000?3:latency>1800?1:0);
  return {rank,height,year,downloads,latency,score};
}
function shouldReplacePublishedSlot(existing,row){
  if(!existing||existing.managedBy!=="media-snapshot-publish")return false;
  const oldS=scoreSignals(existing),newS=scoreSignals(row);
  if(newS.score>=oldS.score+8)return true;
  if(newS.year>=oldS.year+2&&newS.height>=Math.max(1080,oldS.height)&&newS.rank>=oldS.rank-2)return true;
  return false;
}

function publicSlot(row, slotId, defaults){
  const base=plain(defaults);
  const raw=plain(row.raw);
  const source=plain(raw.sourceMetadata);
  const policy=MediaPolicy.releaseEligibility(row);
  const sourceUrl=normalizeUrl(row.source_url || row.embed_url || row.video_url);
  const videoUrl=normalizeUrl(row.video_url);
  const embedUrl=normalizeUrl(row.embed_url);
  const captions=array(raw.captions).filter((track)=>plain(track).src).map((track)=>({
    src:normalizeUrl(track.src),
    label:compact(track.label || track.language || "subtitle",160),
    language:compact(track.language || "und",20)
  })).filter((track)=>track.src);
  const fallbackSample=sampleFallbackFor(base,(Number(slotId)||1)-1);
  return Object.assign({}, base, {
    slotId: Number(slotId)||base.slotId||1,
    fallbackSample,
    contentId: text(row.id),
    id: text(row.id),
    title: text(row.title),
    thumb: normalizeUrl(row.thumb_url) || MEDIA_SAMPLE_THUMB,
    provider: text(row.provider || row.source_host),
    url: sourceUrl,
    link: sourceUrl,
    video: videoUrl || undefined,
    embedUrl: embedUrl || undefined,
    quality: text(row.quality_hint),
    year: Number(raw.year || source.year || 0) || null,
    publishedAt: text(raw.publishedAt || source.publicdate || source.date) || null,
    durationSeconds: Number(raw.durationSeconds || source.durationSeconds || 0) || null,
    captions,
    subtitleLanguages:array(raw.subtitleLanguages).map(text).filter(Boolean),
    ageRating:text(raw.ageRating || "전체"),
    contentWarnings:array(raw.contentWarnings).map(text).filter(Boolean),
    requestedSection:text(raw.requestedSection || source.requestedSection),
    classifiedSection:text(raw.classifiedSection || source.classifiedSection || row.section_key),
    rankingScore:Number(raw.rankingScore || 0),
    rankingTier:text(raw.rankingTier || row.priority),
    rights: {
      status: text(row.rights_status),
      allowedUse: text(row.allowed_use),
      verifiedAt: text(row.reviewed_at || row.updated_at || nowIso()),
      sourceUrl: sourceUrl,
      provider: text(row.provider || row.source_host),
      platformTermsRequired: true,
      copyrightCheckRequired: false
    },
    candidateOnly: false,
    seedContent: false,
    sample: false,
    isSample: false,
    placeholder: false,
    replaceableSlot: false,
    source: {name:text(row.provider || row.source_host),platform:text(raw.platform || source.platform)},
    extension: undefined,
    verificationStatus: "approved_for_snapshot",
    managedBy:"media-snapshot-publish",
    releaseContract:{
      policy:MediaPolicy.VERSION,
      eligible:policy.ok,
      safetyDecision:policy.safety.decision === "quarantine" ? "administrator_approved" : policy.safety.decision,
      rightsStatus:text(row.rights_status),
      allowedUse:text(row.allowed_use),
      reviewedAt:text(row.reviewed_at || row.updated_at),
      reviewedBy:text(row.reviewed_by || row.updated_by)
    },
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
    const ar=plain(a&&a.raw),br=plain(b&&b.raw);
    const as=plain(ar.sourceMetadata),bs=plain(br.sourceMetadata);
    const apriority=Number((text(a&&a.priority).match(/(\d+(?:\.\d+)?)/)||[])[1]||0);
    const bpriority=Number((text(b&&b.priority).match(/(\d+(?:\.\d+)?)/)||[])[1]||0);
    const amanual=/^999/.test(text(a&&a.priority)),bmanual=/^999/.test(text(b&&b.priority));
    if(amanual!==bmanual)return bmanual?1:-1;
    const arank=Number(ar.rankingScore||a&&a.ranking_score||apriority||0);
    const brank=Number(br.rankingScore||b&&b.ranking_score||bpriority||0);
    if(arank!==brank)return brank-arank;
    const aheight=Number(as.height||ar.height||(text(a&&a.quality_hint).match(/(\d{3,4})p/i)||[])[1]||0);
    const bheight=Number(bs.height||br.height||(text(b&&b.quality_hint).match(/(\d{3,4})p/i)||[])[1]||0);
    if(aheight!==bheight)return bheight-aheight;
    const abitrate=Number(as.bitrateBps||ar.bitrateBps||0);
    const bbitrate=Number(bs.bitrateBps||br.bitrateBps||0);
    if(abitrate!==bbitrate)return bbitrate-abitrate;
    const alatency=Number(plain(ar.playbackProbe||as.playbackProbe).latencyMs||Number.MAX_SAFE_INTEGER);
    const blatency=Number(plain(br.playbackProbe||bs.playbackProbe).latencyMs||Number.MAX_SAFE_INTEGER);
    if(alatency!==blatency)return alatency-blatency;
    const ayear=Number(ar.year||as.year||0),byear=Number(br.year||bs.year||0);
    if(ayear!==byear)return byear-ayear;
    const ap=text(a.approved_at || a.reviewed_at || a.updated_at); const bp=text(b.approved_at || b.reviewed_at || b.updated_at);
    if(ap!==bp) return ap<bp?1:-1;
    return text(a.title).localeCompare(text(b.title));
  }));
  return out;
}
function buildSnapshot(baseSnapshot, rows, opts){
  const base=plain(baseSnapshot),sections=Object.assign({},plain(base.sections));
  const groups=groupsBySection((Array.isArray(rows)?rows:[]).filter(snapshotEligible));
  const filled={},replacementLog={};
  Object.keys(groups).forEach((sectionKey)=>{
    const current=sections[sectionKey];
    const sectionObj=Array.isArray(current)?{title:sectionKey,slots:current,key:sectionKey}:plain(current);
    const sourceSlots=Array.isArray(sectionObj.slots)?sectionObj.slots.slice():[];
    const requestedCapacity=Number(opts&&opts.capacityPerSection);
    const capacity=Math.max(1,Math.min(FRONT_CAPACITY,Number.isFinite(requestedCapacity)&&requestedCapacity>0?requestedCapacity:FRONT_CAPACITY));
    const next=[];
    for(let i=0;i<capacity;i++){
      const original=plain(sourceSlots[i]),fallback=sampleFallbackFor(original,i);
      if(original.managedBy==="media-snapshot-publish"&&MediaPolicy.publicReleaseAllowed(original))next.push(Object.assign({},original,{slotId:i+1,fallbackSample:fallback}));
      else if(text(original.title)&&!slotLooksLikeSample(original)&&MediaPolicy.publicReleaseAllowed(original))next.push(Object.assign({},original,{slotId:i+1,fallbackSample:fallback}));
      else next.push(Object.assign({},fallback,{slotId:i+1}));
    }
    const candidateRows=groups[sectionKey].slice(),byId=new Map(candidateRows.map((row)=>[text(row&&row.id),row])),used=new Set();
    for(let i=0;i<next.length;i++){
      const slot=next[i],id=text(slot&&slot.contentId||slot&&slot.id);
      if(slot&&slot.managedBy==="media-snapshot-publish"&&id&&byId.has(id)){next[i]=publicSlot(byId.get(id),i+1,slot);used.add(id);}
    }
    for(const row of candidateRows){
      const id=text(row&&row.id);if(!id||used.has(id))continue;
      const index=next.findIndex((slot)=>slotLooksLikeSample(slot));if(index<0)break;
      next[index]=publicSlot(row,index+1,next[index]);used.add(id);
    }
    const replaced=[];
    for(const row of candidateRows){
      const id=text(row&&row.id);if(!id||used.has(id))continue;
      let replaceIndex=-1,lowestScore=Infinity;
      for(let i=0;i<next.length;i++){
        const slot=next[i];if(!slot||slot.managedBy!=="media-snapshot-publish")continue;
        const sc=scoreSignals(slot).score;if(sc<lowestScore&&shouldReplacePublishedSlot(slot,row)){lowestScore=sc;replaceIndex=i;}
      }
      if(replaceIndex>=0){const previous=next[replaceIndex];next[replaceIndex]=publicSlot(row,replaceIndex+1,previous);used.add(id);replaced.push({slotId:replaceIndex+1,from:text(previous.contentId||previous.id),to:id,reason:"quality_recency_policy"});}
    }
    sections[sectionKey]=Object.assign({},sectionObj,{key:sectionKey,slots:next});
    filled[sectionKey]=next.filter((slot)=>slot&&slot.managedBy==="media-snapshot-publish"&&MediaPolicy.publicReleaseAllowed(slot)).length;
    replacementLog[sectionKey]=replaced;
  });
  return Object.assign({},base,{version:"media.snapshot.generated.supabase.v2",type:"media_snapshot",sections,meta:Object.assign({},plain(base.meta),{
    generatedAt:nowIso(),generatedBy:"media-snapshot-publish",source:"supabase.media_candidates",
    section1Policy:"media-trending is automatic; manual sections retain current matches until a verified quality/recency replacement wins.",releasePolicy:MediaPolicy.VERSION,
    capacities:{default:FRONT_CAPACITY,frontPerSection:FRONT_CAPACITY,candidateReserveMax:RESERVE_CAPACITY},persistencePolicy:"preserve_existing_front_then_fill_samples_then_quality_recency_replace",replacementLog,filled
  })});
}

module.exports={
  VERSION, CANDIDATE_TABLE, RELEASE_TABLE, RELEASE_WRITE_COLUMNS, ALLOWED_SECTIONS, FRONT_CAPACITY, RESERVE_CAPACITY,
  text, lower, compact, bool, plain, array, nowIso, sha256, shortHash, normalizeUrl, hostOf, normalizeSection, roleList, requireRole,
  response, parseBody, config, supabase, rest, encodeEq, encodeIn, selectCandidates, upsertCandidates, appendCandidatesWithinReserve, sectionReserveState, updateCandidates, deleteCandidates, insertRelease, selectReleaseById, releaseStorageContract,
  normalizeCandidate, validateCandidate, snapshotEligible, publicSlot, buildSnapshot, scoreSignals, shouldReplacePublishedSlot, sampleFallbackFor, slotLooksLikeSample, MediaPolicy
};
