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

const VERSION = "media-candidate-store-v1.7.0-hero-backdrop-pass-through";
const DEFAULT_TIMEOUT_MS = 12000;
const CANDIDATE_TABLE = process.env.MEDIA_CANDIDATE_TABLE || "media_candidates";
const RELEASE_TABLE = process.env.MEDIA_SNAPSHOT_RELEASE_TABLE || "media_snapshot_releases";
const RELEASE_WRITE_COLUMNS = Object.freeze(["release_id","snapshot_hash","snapshot","status","created_at","created_by"]);
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
async function deleteCandidates(ids){
  const list=Array.from(new Set(array(ids).map(text).filter(Boolean)));
  if(!list.length) return [];
  return supabase(rest(CANDIDATE_TABLE,"id="+encodeIn(list)), {method:"DELETE",headers:{Prefer:"return=representation"}});
}
function canonicalReleaseRow(row){
  const source=plain(row);
  const output={};
  for(const key of RELEASE_WRITE_COLUMNS){
    if(source[key]!==undefined)output[key]=source[key];
  }
  return output;
}
async function insertRelease(row){
  const payload=canonicalReleaseRow(row);
  // Snapshot payloads can be hundreds of KB. Do not request the same JSON back from
  // PostgREST after INSERT; the caller performs an authoritative select-by-id check.
  await supabase(rest(RELEASE_TABLE), {method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify([payload])});
  return {inserted:true,release_id:text(payload.release_id),snapshot_hash:text(payload.snapshot_hash)};
}
async function selectReleaseById(releaseId){
  const id=text(releaseId);
  if(!id)return null;
  const query=new URLSearchParams();
  query.set("select",RELEASE_WRITE_COLUMNS.join(","));
  query.set("release_id",encodeEq(id));
  query.set("limit","1");
  const body=await supabase(rest(RELEASE_TABLE,query.toString()),{method:"GET"});
  return Array.isArray(body)&&body[0]?body[0]:null;
}
function releaseStorageContract(){
  const cfg=config();
  return{version:VERSION,table:cfg.releaseTable,writeColumns:RELEASE_WRITE_COLUMNS.slice(),urlSource:cfg.urlSource,keySource:cfg.keySource};
}
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
function isPlaceholderThumbnail(value){
  const raw=text(value);
  if(!raw)return true;
  const normalized=lower(raw);
  if(normalized==="#")return true;
  if(normalized.includes("media-sample-card.png"))return true;
  if(normalized.includes("placeholder"))return true;
  if(normalized.includes("placehold.co")||normalized.includes("placehold.it"))return true;
  return false;
}
function usableThumbnailUrl(value){
  const url=normalizeUrl(value);
  if(!url||isPlaceholderThumbnail(url))return "";
  return /^https:\/\//i.test(url)?url:"";
}

function thumbnailMeta(row){
  const raw=plain(row&&row.raw),source=plain(raw.sourceMetadata);
  const generation=plain(source.thumbnailGeneration||raw.thumbnailGeneration);
  const probe=plain(generation.probe||source.thumbnailProbe||raw.thumbnailProbe);
  const width=Number(raw.thumbnailWidth||source.thumbnailWidth||generation.width||probe.width||0)||0;
  const height=Number(raw.thumbnailHeight||source.thumbnailHeight||generation.height||probe.height||0)||0;
  const known=width>0&&height>0;
  const frontReady=(generation.frontReady===true||probe.frontReady===true||raw.thumbnailReady===true)||(known&&width>=320&&height>=180);
  const frameCapture=lower(generation.mode)==="administrator_video_frame";
  const sourceWidth=Number(generation.sourceWidth||0)||0,sourceHeight=Number(generation.sourceHeight||0)||0;
  const edgeMean=Number(generation.edgeMean||0)||0,edgeP90=Number(generation.edgeP90||0)||0;
  const captureSharp=generation.sharp===true||edgeMean>=4.8||edgeP90>=15;
  // Legacy administrator captures could be 1280x720 canvases made from SD video.
  // Such rows remain valid card thumbnails but must never be advertised as Hero HD.
  const frameHeroReady=!frameCapture||(sourceWidth>=1280&&sourceHeight>=720&&captureSharp);
  const heroReady=frameHeroReady&&((generation.heroReady===true||probe.heroReady===true)||(known&&width>=1280&&height>=720));
  return{width,height,known,frontReady,heroReady,probe,generation,sourceWidth,sourceHeight,captureSharp};
}
function snapshotEligible(row){
  const urls=[row.source_url,row.video_url,row.embed_url].map(normalizeUrl).filter(Boolean);
  const thumbnail=usableThumbnailUrl(row&&row.thumb_url),meta=thumbnailMeta(row);
  const dimensionsOk=!meta.known||meta.frontReady;
  return MediaPolicy.releaseEligibility(row).ok && !!row.title && urls.length>0 && !!thumbnail && dimensionsOk;
}
function publicSlot(row, slotId, defaults){
  const base=plain(defaults);
  const raw=plain(row.raw);
  const source=plain(raw.sourceMetadata);
  const policy=MediaPolicy.releaseEligibility(row);
  const thumbMeta=thumbnailMeta(row),thumbUrl=usableThumbnailUrl(row.thumb_url);
  const heroCandidates=[
    raw.heroImage,raw.heroImageUrl,raw.heroThumbnail,raw.heroThumb,raw.backdrop,raw.backdropUrl,raw.backdropImage,
    raw.highResThumbnail,raw.thumbnailHD,raw.hdThumbnail,raw.maxresThumbnail,raw.image1920,raw.image1280,
    source.heroImage,source.heroImageUrl,source.heroThumbnail,source.heroThumb,source.backdrop,source.backdropUrl,source.backdropImage,
    source.highResThumbnail,source.thumbnailHD,source.hdThumbnail,source.maxresThumbnail,source.image1920,source.image1280
  ];
  const alternateHeroUrl=heroCandidates.map(usableThumbnailUrl).find(Boolean)||"";
  const alternateHeroWidth=Number(raw.heroWidth||raw.backdropWidth||source.heroWidth||source.backdropWidth||0)||0;
  const alternateHeroHeight=Number(raw.heroHeight||raw.backdropHeight||source.heroHeight||source.backdropHeight||0)||0;
  const heroGeneration=plain(raw.heroThumbnailGeneration||source.heroThumbnailGeneration||thumbMeta.generation);
  const heroSourceWidth=Number(heroGeneration.sourceWidth||0)||0,heroSourceHeight=Number(heroGeneration.sourceHeight||0)||0;
  const heroEdgeMean=Number(heroGeneration.edgeMean||0)||0,heroEdgeP90=Number(heroGeneration.edgeP90||0)||0;
  const heroSharpVerified=lower(heroGeneration.mode)==="administrator_video_frame"&&heroSourceWidth>=1280&&heroSourceHeight>=720&&(heroGeneration.sharp===true||heroEdgeMean>=4.8||heroEdgeP90>=15);
  // A separately captured, source-HD + sharp-verified Hero frame outranks the card
  // thumbnail even when the card image itself happens to be 1280x720.
  const useAlternateHero=!!alternateHeroUrl&&(heroSharpVerified||!thumbMeta.heroReady);
  const heroUrl=useAlternateHero?alternateHeroUrl:(thumbMeta.heroReady?thumbUrl:alternateHeroUrl);
  const heroWidth=useAlternateHero?alternateHeroWidth:(thumbMeta.heroReady?thumbMeta.width:alternateHeroWidth);
  const heroHeight=useAlternateHero?alternateHeroHeight:(thumbMeta.heroReady?thumbMeta.height:alternateHeroHeight);
  const heroKnown=heroWidth>0&&heroHeight>0;
  const heroReady=!!heroUrl&&heroKnown&&heroWidth>=1280&&heroHeight>=720;
  const sourceUrl=normalizeUrl(row.source_url || row.embed_url || row.video_url);
  const videoUrl=normalizeUrl(row.video_url);
  const embedUrl=normalizeUrl(row.embed_url);
  const captions=array(raw.captions).filter((track)=>plain(track).src).map((track)=>({
    src:normalizeUrl(track.src),
    label:compact(track.label || track.language || "subtitle",160),
    language:compact(track.language || "und",20)
  })).filter((track)=>track.src);
  return Object.assign({}, base, {
    slotId: Number(slotId)||base.slotId||1,
    contentId: text(row.id),
    id: text(row.id),
    title: text(row.title),
    thumb: thumbUrl,
    thumbnail: thumbUrl,
    image: thumbUrl,
    thumbnailWidth:thumbMeta.width||null,
    thumbnailHeight:thumbMeta.height||null,
    thumbnailReady:thumbMeta.known?thumbMeta.frontReady:true,
    thumbnailStatus:thumbMeta.known?(thumbMeta.frontReady?"verified":"below_front_floor"):"verified_url",
    heroImage:heroUrl||undefined,
    heroWidth:heroWidth||null,
    heroHeight:heroHeight||null,
    heroThumbnailReady:heroUrl?(heroKnown?heroReady:null):false,
    heroSharpVerified:heroSharpVerified||undefined,
    heroSourceWidth:heroSourceWidth||null,
    heroSourceHeight:heroSourceHeight||null,
    heroEdgeMean:heroEdgeMean||null,
    heroEdgeP90:heroEdgeP90||null,
    provider: text(row.provider || row.source_host),
    url: sourceUrl,
    link: sourceUrl,
    video: videoUrl || undefined,
    embedUrl: embedUrl || undefined,
    quality: text(row.quality_hint),
    year: Number(raw.year || source.year || 0) || null,
    publishedAt: text(raw.publishedAt || source.publishedAt || source.publicdate || source.date) || null,
    durationSeconds: Number(raw.durationSeconds || source.durationSeconds || 0) || null,
    captions,
    subtitleLanguages:array(raw.subtitleLanguages).map(text).filter(Boolean),
    ageRating:text(raw.ageRating || "전체"),
    contentWarnings:array(raw.contentWarnings).map(text).filter(Boolean),
    requestedSection:text(raw.requestedSection || source.requestedSection),
    classifiedSection:text(raw.classifiedSection || source.classifiedSection || row.section_key),
    rankingScore:Number(raw.rankingScore || source.rankingScore || 0),
    rankingTier:text(raw.rankingTier || source.rankingTier || row.priority),
    views:Number(raw.views || raw.viewCount || source.views || source.downloads || raw.downloads || 0)||0,
    rating:Number(raw.rating || source.rating || source.avgRating || 0)||0,
    reviewCount:Number(raw.reviewCount || raw.reviews || source.numReviews || source.reviews || 0)||0,
    playbackReady:plain(raw.playbackProbe||source.playbackProbe).ok===true,
    playbackLatencyMs:Number(plain(raw.playbackProbe||source.playbackProbe).latencyMs||0)||0,
    playbackStatus:plain(raw.playbackProbe||source.playbackProbe).ok===true?"verified":(plain(raw.playbackProbe||source.playbackProbe).present===true?"unverified":"unknown"),
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
function isReplaceableMediaSlot(slot){
  const s=plain(slot),raw=plain(s.raw),source=plain(s.source),ext=plain(s.extension);
  const placeholder=plain(ext.placeholder);
  const title=text(s.title||s.name),summary=text(s.summary||s.description);
  const url=normalizeUrl(s.url||s.link||s.video||s.videoUrl||s.embedUrl);
  const thumb=text(s.thumb||s.thumbnail||s.image||s.poster);
  if(s.managedBy==="media-snapshot-publish")return true;
  if(s.sample===true||s.isSample===true||s.placeholder===true||s.replaceableSlot===true)return true;
  if(Object.keys(placeholder).length>0)return true;
  if(lower(source.name)==="seed"||lower(raw.source)==="seed")return true;
  if(/^seed placeholder\b/i.test(summary))return true;
  if(/^(movie|drama|thriller|mystery|romance|variety|documentary|animation|music|shorts?)\s+slot\s+\d+$/i.test(title))return true;
  if(!title&&!url)return true;
  if(!title&&(thumb==="#"||!thumb||/placeholder/i.test(thumb)))return true;
  return false;
}
function blankMediaSlot(slot,index){
  return{slotId:Number(slot&&slot.slotId)||index+1,contentId:null,title:null,thumb:"#",provider:null};
}
function buildSnapshot(baseSnapshot, rows, opts){
  const base=plain(baseSnapshot);
  const sections=Object.assign({}, plain(base.sections));
  const groups=groupsBySection(rows.filter(snapshotEligible));
  const filled={};

  Object.keys(groups).forEach((sectionKey)=>{
    const current=sections[sectionKey];
    const sectionObj=Array.isArray(current)?{title:sectionKey,slots:current,key:sectionKey}:plain(current);
    const sourceSlots=Array.isArray(sectionObj.slots)?sectionObj.slots.slice():[];
    const requestedCapacity=Number(opts && opts.capacityPerSection);
    const capacity=Math.max(1,Math.min(100,Number.isFinite(requestedCapacity)&&requestedCapacity>0?requestedCapacity:100));

    const previousManagedIndex=new Map();
    sourceSlots.slice(0,capacity).forEach((slot,index)=>{
      if(slot&&slot.managedBy==="media-snapshot-publish"&&text(slot.contentId||slot.id)){
        previousManagedIndex.set(text(slot.contentId||slot.id),index);
      }
    });

    const next=[];
    for(let i=0;i<capacity;i++){
      const slot=plain(sourceSlots[i]);
      next.push(slot.managedBy==="media-snapshot-publish"?blankMediaSlot(slot,i):Object.assign({},slot,{slotId:Number(slot.slotId)||i+1}));
    }

    const desired=groups[sectionKey].slice(0,capacity);
    const placed=new Set();

    desired.forEach((row)=>{
      const id=text(row&&row.id),index=previousManagedIndex.get(id);
      if(index===undefined||index<0||index>=next.length)return;
      next[index]=publicSlot(row,index+1,next[index]);
      placed.add(id);
    });

    let cursor=0;
    desired.forEach((row)=>{
      const id=text(row&&row.id);
      if(placed.has(id))return;
      while(cursor<next.length&&!isReplaceableMediaSlot(next[cursor]))cursor+=1;
      if(cursor<next.length){
        next[cursor]=publicSlot(row,cursor+1,next[cursor]);
        placed.add(id);
        cursor+=1;
      }
    });

    sections[sectionKey]=Object.assign({},sectionObj,{key:sectionKey,slots:next});
    filled[sectionKey]=next.filter((slot)=>slot&&slot.managedBy==="media-snapshot-publish"&&MediaPolicy.publicReleaseAllowed(slot)).length;
  });

  return Object.assign({},base,{
    version:"media.snapshot.generated.supabase.v2.sample-preserving",
    type:"media_snapshot",
    sections,
    meta:Object.assign({},plain(base.meta),{
      generatedAt:nowIso(),
      generatedBy:"media-snapshot-publish",
      source:"supabase.media_candidates",
      section1Policy:"media-trending is automatic; manual sections keep their committed 100-slot sample/real layout.",
      releasePolicy:MediaPolicy.VERSION,
      capacities:{default:100},
      samplePolicy:"preserve-seed-and-external; replace-only-blank-seed-or-previous-managed",
      thumbnailPolicy:"approved real content requires a verified non-placeholder HTTPS thumbnail; known dimensions below 320x180 are blocked and 1280x720+ is marked hero-ready",
      filled
    })
  });
}
module.exports={
  VERSION, CANDIDATE_TABLE, RELEASE_TABLE, RELEASE_WRITE_COLUMNS, ALLOWED_SECTIONS,
  text, lower, compact, bool, plain, array, nowIso, sha256, shortHash, normalizeUrl, hostOf, normalizeSection, roleList, requireRole,
  response, parseBody, config, supabase, rest, encodeEq, encodeIn, selectCandidates, upsertCandidates, updateCandidates, deleteCandidates, canonicalReleaseRow, insertRelease, selectReleaseById, releaseStorageContract,
  normalizeCandidate, validateCandidate, isPlaceholderThumbnail, usableThumbnailUrl, thumbnailMeta, snapshotEligible, publicSlot, buildSnapshot, MediaPolicy
};
