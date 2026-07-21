"use strict";

/**
 * Sanmaru Media Collector v1
 *
 * Collects full-length, rights-reviewable public media candidates from approved
 * public archives and stores them only in the private Supabase candidate queue.
 * It never writes data/media.snapshot.json and never publishes to the Media Hub.
 */
const MediaStore = require("./lib/media-candidate-store.v1");
const SharedAdminAuth = require("./lib/global-slot-console-auth");

const VERSION = "sanmaru-media-collector-v1.1.0-modern-1080-admin-exception";
const IA_SEARCH = "https://archive.org/advancedsearch.php";
const IA_METADATA = "https://archive.org/metadata/";
const MAX_RESULTS = 30;
const DEFAULT_RESULTS = 12;
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_MIN_YEAR = 2000;
const MIN_VIDEO_HEIGHT = 1080;
const MIN_VIDEO_WIDTH = 1920;
const EXCLUDED_TITLE = /\b(trailer|teaser|promo|preview|clip|excerpt|sample|highlight|commercial|advertisement|featurette|behind\s+the\s+scenes)\b/i;
const VIDEO_EXT = /\.(mp4|webm|ogv|m4v)$/i;
const SUBTITLE_EXT = /\.(vtt|srt|ass|ssa)$/i;
const SAFE_LICENSE = /(public\s*domain|creativecommons\.org\/publicdomain|creativecommons\.org\/licenses\/(by|by-sa|by-nd)\/|cc0)/i;
const SOURCE_POLICIES = Object.freeze({
  internet_archive: {
    label: "Internet Archive",
    host: "archive.org",
    enabled: true
  }
});
const SECTION_QUERIES = Object.freeze({
  "media-movie": '(mediatype:movies) AND (collection:feature_films OR collection:prelinger) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-drama": '(mediatype:movies) AND (collection:classic_tv OR collection:television) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-thriller": '(mediatype:movies) AND (subject:(thriller OR mystery OR suspense OR horror OR science\ fiction)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-romance": '(mediatype:movies) AND (subject:(romance OR romantic OR melodrama)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-variety": '(mediatype:movies) AND (subject:(variety OR entertainment OR television\ program)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-documentary": '(mediatype:movies) AND (collection:documentary_films OR subject:documentary OR collection:prelinger) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-animation": '(mediatype:movies) AND (subject:(animation OR animated OR cartoon)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-music": '(mediatype:movies) AND (subject:(concert OR performance OR music)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-shorts": '(mediatype:movies) AND (subject:(short\ film OR shortfilm)) NOT title:(trailer OR teaser OR clip OR preview)'
});

function headers(extra){
  return Object.assign({"accept":"application/json","user-agent":"IGDC-MARU-MediaCollector/1.0 (+https://igdc.info)"}, extra || {});
}
async function fetchJson(url){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), REQUEST_TIMEOUT_MS);
  try{
    const response = await fetch(url,{headers:headers(),signal:controller.signal,redirect:"follow"});
    if(!response.ok){const error=new Error("외부 미디어 원장 HTTP "+response.status);error.statusCode=502;error.code="media_collector_source_http_error";throw error;}
    return await response.json();
  }catch(error){
    if(error && error.name === "AbortError"){error.statusCode=504;error.code="media_collector_source_timeout";}
    throw error;
  }finally{clearTimeout(timer);}
}
function internalAuthorized(event){
  const expected=MediaStore.text(process.env.MEDIA_COLLECTOR_SECRET || process.env.MEDIA_CANDIDATE_SYNC_SECRET || process.env.SANMARU_INTERNAL_TOKEN || process.env.IGDC_INTERNAL_TOKEN);
  if(!expected)return false;
  const h=event&&event.headers||{};
  const got=MediaStore.text(h["x-igdc-internal-token"]||h["X-IGDC-Internal-Token"]||h["x-sanmaru-token"]||h["X-Sanmaru-Token"]);
  return !!got && got===expected;
}
async function actorFor(event){
  if(internalAuthorized(event))return{memberId:"sanmaru-media-collector",email:"sanmaru-media-collector",roles:["media_manager"],mode:"internal"};
  const actor=await SharedAdminAuth.resolveUser(event);
  SharedAdminAuth.requireCapability(actor,"mediaEdit");
  return Object.assign({},actor,{mode:"admin"});
}
function number(value,fallback,min,max){
  const parsed=Number(value);
  const safe=Number.isFinite(parsed)?parsed:fallback;
  return Math.max(min,Math.min(max,Math.floor(safe)));
}
function array(value){return Array.isArray(value)?value:(value==null?[]:[value]);}
function stringList(value){return array(value).map(MediaStore.text).filter(Boolean);}
function durationSeconds(value){
  if(typeof value === "number" && Number.isFinite(value))return value;
  const raw=MediaStore.text(value);
  if(!raw)return 0;
  if(/^\d+(?:\.\d+)?$/.test(raw))return Number(raw)||0;
  const parts=raw.split(":").map(Number);
  if(parts.some((v)=>!Number.isFinite(v)))return 0;
  if(parts.length===3)return parts[0]*3600+parts[1]*60+parts[2];
  if(parts.length===2)return parts[0]*60+parts[1];
  return 0;
}
function fullLengthMinimum(section){
  if(section==="media-shorts")return 180;
  if(section==="media-music")return 600;
  return 1200;
}
function safeIdentifier(value){return MediaStore.text(value).replace(/[^A-Za-z0-9_.-]/g,"");}
function videoDimensions(file){
  const width=Number(file&&file.width||0), height=Number(file&&file.height||0);
  return {width,height,meets1080:(height>=MIN_VIDEO_HEIGHT)||(width>=MIN_VIDEO_WIDTH && height>=1000)};
}
function originalFile(files,section){
  const min=fullLengthMinimum(section);
  const candidates=array(files).filter((file)=>{
    const name=MediaStore.text(file&&file.name);
    const source=MediaStore.lower(file&&file.source);
    if(!VIDEO_EXT.test(name)||EXCLUDED_TITLE.test(name))return false;
    if(source && source!=="original" && source!=="derivative")return false;
    const size=Number(file&&file.size||0);
    if(size<5*1024*1024)return false;
    return videoDimensions(file).meets1080;
  }).sort((a,b)=>{
    const ao=MediaStore.lower(a&&a.source)==="original"?1:0, bo=MediaStore.lower(b&&b.source)==="original"?1:0;
    if(ao!==bo)return bo-ao;
    const ad=videoDimensions(a), bd=videoDimensions(b);
    if(ad.height!==bd.height)return bd.height-ad.height;
    if(ad.width!==bd.width)return bd.width-ad.width;
    return Number(b&&b.size||0)-Number(a&&a.size||0);
  });
  const selected=candidates.find((file)=>durationSeconds(file&&file.length)>=min) || candidates[0] || null;
  if(!selected)return null;
  const duration=durationSeconds(selected.length);
  if(duration && duration<min)return null;
  return selected;
}
function normalizedYear(value){
  const raw=Array.isArray(value)?value[0]:value;
  const match=MediaStore.text(raw).match(/(?:18|19|20|21)\d{2}/);
  return match?Number(match[0]):0;
}
function subtitleTracks(identifier,files){
  return array(files).filter((file)=>SUBTITLE_EXT.test(MediaStore.text(file&&file.name))).slice(0,30).map((file)=>({
    src:"https://archive.org/download/"+encodeURIComponent(identifier)+"/"+encodeURIComponent(file.name),
    label:MediaStore.text(file.title||file.name),
    language:MediaStore.text(file.language||file.lang||"")
  }));
}
function licenseEvidence(metadata){
  const fields=[metadata&&metadata.licenseurl,metadata&&metadata.rights,metadata&&metadata.usage,metadata&&metadata.description].map(MediaStore.text).filter(Boolean);
  const joined=fields.join(" ");
  return {
    safeSignal:SAFE_LICENSE.test(joined),
    licenseUrl:MediaStore.normalizeUrl(metadata&&metadata.licenseurl),
    rightsText:MediaStore.compact(metadata&&metadata.rights||metadata&&metadata.usage||"",500)
  };
}
function sectionFromInput(value){
  const section=MediaStore.normalizeSection(value);
  if(!section || !SECTION_QUERIES[section]){const error=new Error("수집할 2~10번 미디어 섹션이 올바르지 않습니다.");error.statusCode=400;error.code="media_collector_section_required";throw error;}
  return section;
}
function searchUrl(section,limit,page){
  const params=new URLSearchParams();
  params.set("q","("+SECTION_QUERIES[section]+") AND year:["+DEFAULT_MIN_YEAR+" TO 9999]");
  ["identifier","title","creator","year","description","subject","collection","licenseurl","rights","downloads","date","language"].forEach((field)=>params.append("fl[]",field));
  params.append("sort[]","downloads desc");
  params.append("sort[]","date desc");
  params.set("rows",String(limit));
  params.set("page",String(page));
  params.set("output","json");
  return IA_SEARCH+"?"+params.toString();
}
async function mapLimit(items,limit,worker){
  const results=new Array(items.length);let cursor=0;
  async function run(){while(cursor<items.length){const index=cursor++;try{results[index]=await worker(items[index],index);}catch(error){results[index]={error};}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
  return results;
}
async function inspectInternetArchive(doc,section,options){
  options=options||{};
  const identifier=safeIdentifier(doc&&doc.identifier);
  if(!identifier)return{rejected:"identifier_missing"};
  const title=MediaStore.compact(doc&&doc.title,240);
  if(!title || EXCLUDED_TITLE.test(title))return{rejected:"trailer_teaser_clip_excluded",identifier,title};
  const detail=await fetchJson(IA_METADATA+encodeURIComponent(identifier));
  const metadata=detail&&detail.metadata||{};
  const year=normalizedYear(metadata.year||doc.year||metadata.date||doc.date);
  if(!options.adminException && (!year || year<DEFAULT_MIN_YEAR))return{rejected:year?"release_year_before_2000":"release_year_unknown",identifier,title,year:year||null};
  const finalTitle=MediaStore.compact(metadata.title||title,240);
  if(!finalTitle || EXCLUDED_TITLE.test(finalTitle))return{rejected:"trailer_teaser_clip_excluded",identifier,title:finalTitle};
  const video=originalFile(detail&&detail.files,section);
  if(!video)return{rejected:"full_length_1080p_video_file_not_found",identifier,title:finalTitle,year:year||null};
  const evidence=licenseEvidence(metadata);
  const sourceUrl="https://archive.org/details/"+encodeURIComponent(identifier);
  const videoUrl="https://archive.org/download/"+encodeURIComponent(identifier)+"/"+encodeURIComponent(video.name);
  const captions=subtitleTracks(identifier,detail&&detail.files);
  const height=Number(video.height||0), width=Number(video.width||0);
  const quality=height?String(height)+"p":(width>=MIN_VIDEO_WIDTH?"1080p":"below-1080p");
  const candidate={
    id:"ia:"+identifier,
    contentId:"ia:"+identifier,
    section_key:section,
    title:finalTitle,
    provider:"Internet Archive",
    source_url:sourceUrl,
    video_url:videoUrl,
    thumb_url:"https://archive.org/services/img/"+encodeURIComponent(identifier),
    quality_hint:quality,
    rights_status:evidence.safeSignal?"public_rights_signal_found":"web_verification_required",
    allowed_use:evidence.safeSignal?"rights_evidence_review_required":"verification_required",
    verification_status:"web_verification_required",
    review_status:"pending",
    risk_level:evidence.safeSignal?"rights_review":"unverified",
    priority:options.adminException?"ADMIN_EXCEPTION_A1":(evidence.safeSignal?"A2":"B2"),
    candidateOnly:true,
    seedContent:true,
    sanmaru_query:SECTION_QUERIES[section],
    notes:options.adminException?("Administrator-designated historical exception. Reason: "+MediaStore.compact(options.overrideReason||"administrator selected",500)+". 1080p/full-length/rights review still required."):"Modern 1080p full-length archive candidate. Trailer/teaser/clip excluded. Administrator must verify title, source file, rights evidence, playback and subtitles before approval.",
    year:year||metadata.year||doc.year||null,
    language:stringList(metadata.language||doc.language),
    durationSeconds:durationSeconds(video.length),
    captions,
    rights:{
      status:evidence.safeSignal?"public_rights_signal_found":"web_verification_required",
      sourceUrl,
      licenseUrl:evidence.licenseUrl,
      sourceHint:"archive.org metadata",
      candidate:evidence.rightsText||"Public-domain/CC evidence requires administrator verification"
    },
    sourceMetadata:{identifier,adminException:!!options.adminException,overrideReason:MediaStore.compact(options.overrideReason||"",500),minimumYear:DEFAULT_MIN_YEAR,minimumHeight:MIN_VIDEO_HEIGHT,collection:stringList(metadata.collection||doc.collection),subject:stringList(metadata.subject||doc.subject),creator:stringList(metadata.creator||doc.creator),videoFile:video.name,videoFormat:video.format||null,videoSize:Number(video.size||0),width:width||null,height:height||null,subtitleCount:captions.length}
  };
  return{candidate};
}
async function collectInternetArchive(section,limit,page,options){
  options=options||{};
  let docs=[];
  if(options.identifier){
    docs=[{identifier:options.identifier,title:options.identifier}];
  }else{
    const search=await fetchJson(searchUrl(section,limit,page));
    docs=search&&search.response&&Array.isArray(search.response.docs)?search.response.docs:[];
  }
  const inspected=await mapLimit(docs,3,(doc)=>inspectInternetArchive(doc,section,options));
  const candidates=[],rejected=[];
  inspected.forEach((entry,index)=>{
    if(entry&&entry.candidate)candidates.push(entry.candidate);
    else rejected.push({index,identifier:entry&&entry.identifier||docs[index]&&docs[index].identifier||null,title:entry&&entry.title||docs[index]&&docs[index].title||null,reason:entry&&entry.rejected||entry&&entry.error&&entry.error.code||"inspection_failed"});
  });
  return{searched:docs.length,candidates,rejected};
}
exports.handler=async function(event){
  if(event&&event.httpMethod==="OPTIONS")return MediaStore.response(204,{});
  try{
    if(event.httpMethod==="GET"){
      return MediaStore.response(200,{ok:true,version:VERSION,mode:"ready",sources:SOURCE_POLICIES,sections:Object.keys(SECTION_QUERIES),maxResults:MAX_RESULTS,policy:{candidateOnly:true,autoPublish:false,trailerExcluded:true,fullLengthRequired:true,rightsReviewRequired:true,minimumYear:DEFAULT_MIN_YEAR,minimumHeight:MIN_VIDEO_HEIGHT,adminHistoricalException:true}});
    }
    if(event.httpMethod!=="POST")return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const actor=await actorFor(event);
    const body=MediaStore.parseBody(event);
    const source=MediaStore.lower(body.source||"internet_archive");
    if(!SOURCE_POLICIES[source]||SOURCE_POLICIES[source].enabled!==true)return MediaStore.response(400,{ok:false,error:"unsupported_media_source",allowed:Object.keys(SOURCE_POLICIES)});
    const section=sectionFromInput(body.section||body.sectionKey);
    const limit=number(body.limit,DEFAULT_RESULTS,1,MAX_RESULTS);
    const page=number(body.page,1,1,1000);
    const rawIdentifier=MediaStore.text(body.identifier||body.archiveIdentifier||body.sourceUrl);
    const identifier=rawIdentifier?(safeIdentifier(rawIdentifier.match(/archive\.org\/(?:details|download)\/([^/?#]+)/i)?.[1]||rawIdentifier)):"";
    const adminException=body.adminException===true||body.adminException==="true";
    const overrideReason=MediaStore.compact(body.overrideReason||body.reason||"",500);
    if(adminException){
      if(actor.mode!=="admin"){const error=new Error("관리자 지정 예외 수집은 관리자 로그인에서만 실행할 수 있습니다.");error.statusCode=403;error.code="admin_exception_requires_admin";throw error;}
      if(!identifier){const error=new Error("관리자 지정 예외 수집에는 Internet Archive 식별자 또는 원본 주소가 필요합니다.");error.statusCode=400;error.code="admin_exception_identifier_required";throw error;}
      if(!overrideReason){const error=new Error("관리자 지정 예외 사유를 입력해야 합니다.");error.statusCode=400;error.code="admin_exception_reason_required";throw error;}
    }
    const collected=await collectInternetArchive(section,adminException?1:limit,page,{identifier:adminException?identifier:"",adminException,overrideReason});
    const normalized=[],validationRejected=[];
    collected.candidates.forEach((candidate,index)=>{
      const row=MediaStore.normalizeCandidate(candidate,actor);
      const check=MediaStore.validateCandidate(row);
      if(check.ok)normalized.push(row);else validationRejected.push({index,id:row.id,title:row.title,reasons:check.reasons});
    });
    const saved=await MediaStore.upsertCandidates(normalized);
    return MediaStore.response(200,{ok:true,version:VERSION,source,section,page,requested:limit,searched:collected.searched,accepted:normalized.length,saved:Array.isArray(saved)?saved.length:normalized.length,rejectedCount:collected.rejected.length+validationRejected.length,rejected:collected.rejected.concat(validationRejected),policy:{candidateOnly:true,seedContent:true,autoPublish:false,trailerExcluded:true,fullLengthRequired:true,rightsReviewRequired:true,minimumYear:DEFAULT_MIN_YEAR,minimumHeight:MIN_VIDEO_HEIGHT,adminException:adminException},items:saved});
  }catch(error){
    return MediaStore.response(error.statusCode||500,{ok:false,version:VERSION,error:error.code||"sanmaru_media_collector_failed",message:error.message||String(error)});
  }
};
