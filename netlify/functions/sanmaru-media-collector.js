"use strict";

const MediaStore=require("./lib/media-candidate-store.v1");
const MediaPolicy=require("./lib/media-candidate-policy.v2");
const SharedAdminAuth=require("./lib/global-slot-console-auth");

const VERSION="sanmaru-media-collector-v2.2.0-policy-quarantine-balanced-discovery";
const IA_SEARCH="https://archive.org/advancedsearch.php";
const IA_METADATA="https://archive.org/metadata/";
const DEFAULT_RESULTS=5;
const MAX_RESULTS=20;
const DEFAULT_BATCH_SIZE=3;
const MAX_BATCH_SIZE=5;
const REQUEST_TIMEOUT_MS=9000;
const DEFAULT_MIN_YEAR=2000;
const MIN_VIDEO_HEIGHT=1080;
const MIN_RANK_SCORE=58;
const VIDEO_EXT=/\.(mp4|webm|ogv|m4v)$/i;
const SUBTITLE_EXT=/\.(vtt|srt|ass|ssa)$/i;
const EXCLUDED_TITLE=/\b(trailer|teaser|promo|preview|clip|excerpt|sample|highlight|commercial|advertisement|featurette|behind\s+the\s+scenes)\b/i;
const ACTION_CONTEXT=/(action|martial\s+arts|superhero|war\s+film|spy|adventure|crime\s+drama)/i;
const VIOLENCE_CONTEXT=/(violence|violent|blood|fight|weapon|gun|murder|horror|terror)/i;

const SECTION_QUERIES=Object.freeze({
  "media-movie":'(mediatype:movies) AND (collection:feature_films OR subject:(feature film OR cinema)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-drama":'(mediatype:movies) AND (subject:(drama OR television series OR tv series)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-thriller":'(mediatype:movies) AND (subject:(thriller OR mystery OR suspense OR horror OR science fiction)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-romance":'(mediatype:movies) AND (subject:(romance OR romantic OR melodrama)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-variety":'(mediatype:movies) AND (subject:(variety OR entertainment OR talk show OR television program)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-documentary":'(mediatype:movies) AND (subject:documentary OR collection:documentary_films) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-animation":'(mediatype:movies) AND (subject:(animation OR animated OR cartoon OR anime)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-music":'(mediatype:movies) AND (subject:(concert OR performance OR music OR recital)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-shorts":'(mediatype:movies) AND (subject:(short film OR shortfilm)) NOT title:(trailer OR teaser OR clip OR preview)'
});

function headers(){return{"accept":"application/json","user-agent":"IGDC-MARU-MediaCollector/2.2 (+https://igdc.info)"};}
async function fetchJson(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(url,{headers:headers(),signal:controller.signal,redirect:"follow"});
    if(!response.ok){
      const error=new Error("외부 미디어 원장 HTTP "+response.status);
      error.statusCode=502;error.code="media_collector_source_http_error";throw error;
    }
    return await response.json();
  }catch(error){
    if(error&&error.name==="AbortError"){error.statusCode=504;error.code="media_collector_source_timeout";}
    throw error;
  }finally{clearTimeout(timer);}
}
function internalAuthorized(event){
  const expected=MediaStore.text(process.env.MEDIA_COLLECTOR_SECRET||process.env.MEDIA_CANDIDATE_SYNC_SECRET||process.env.SANMARU_INTERNAL_TOKEN||process.env.IGDC_INTERNAL_TOKEN);
  if(!expected)return false;
  const headersMap=event&&event.headers||{};
  return MediaStore.text(headersMap["x-igdc-internal-token"]||headersMap["X-IGDC-Internal-Token"])===expected;
}
async function actorFor(event){
  if(internalAuthorized(event))return{memberId:"sanmaru-media-collector",email:"sanmaru-media-collector",roles:["media_manager"],mode:"internal"};
  const actor=await SharedAdminAuth.resolveUser(event);
  SharedAdminAuth.requireCapability(actor,"mediaEdit");
  return Object.assign({},actor,{mode:"admin"});
}
const arr=(value)=>Array.isArray(value)?value:(value==null?[]:[value]);
const list=(value)=>arr(value).map(MediaStore.text).filter(Boolean);
function num(value,fallback,min,max){
  value=Number(value);
  value=Number.isFinite(value)?value:fallback;
  return Math.max(min,Math.min(max,Math.floor(value)));
}
function duration(value){
  if(typeof value==="number"&&Number.isFinite(value))return value;
  const parts=MediaStore.text(value).split(":").map(Number);
  if(parts.some((item)=>!Number.isFinite(item)))return Number(value)||0;
  return parts.length===3?parts[0]*3600+parts[1]*60+parts[2]:parts.length===2?parts[0]*60+parts[1]:0;
}
function minDuration(section){
  if(section==="media-shorts")return 180;
  if(section==="media-music")return 600;
  return 1200;
}
function yearOf(value){
  const match=MediaStore.text(Array.isArray(value)?value[0]:value).match(/(?:18|19|20|21)\d{2}/);
  return match?Number(match[0]):0;
}
function safeId(value){return MediaStore.text(value).replace(/[^A-Za-z0-9_.-]/g,"");}
function dims(file){
  const width=Number(file&&file.width||0),height=Number(file&&file.height||0);
  return{width,height,ok:height>=MIN_VIDEO_HEIGHT};
}
function videoPreference(name){
  const value=MediaStore.lower(name);
  if(/\.mp4$/.test(value))return 4;
  if(/\.m4v$/.test(value))return 3;
  if(/\.webm$/.test(value))return 2;
  if(/\.ogv$/.test(value))return 1;
  return 0;
}
function chooseVideos(files,section){
  const minimum=minDuration(section);
  return arr(files).filter((file)=>{
    const name=MediaStore.text(file&&file.name),source=MediaStore.lower(file&&file.source);
    if(!VIDEO_EXT.test(name)||EXCLUDED_TITLE.test(name))return false;
    if(source&&source!=="original"&&source!=="derivative")return false;
    if(Number(file&&file.size||0)<5*1024*1024)return false;
    if(!dims(file).ok)return false;
    const seconds=duration(file&&file.length);
    return !seconds||seconds>=minimum;
  }).sort((a,b)=>{
    const preferred=videoPreference(b&&b.name)-videoPreference(a&&a.name);
    if(preferred)return preferred;
    const original=(MediaStore.lower(b&&b.source)==="original"?1:0)-(MediaStore.lower(a&&a.source)==="original"?1:0);
    if(original)return original;
    const left=dims(a),right=dims(b);
    return right.height-left.height||right.width-left.width||Number(b&&b.size||0)-Number(a&&a.size||0);
  }).slice(0,5);
}

const LANG_MAP={ko:"ko",kor:"ko",korean:"ko",en:"en",eng:"en",english:"en",zh:"zh",chi:"zh",zho:"zh",chinese:"zh",ja:"ja",jpn:"ja",japanese:"ja",es:"es",spa:"es",spanish:"es",fr:"fr",fre:"fr",fra:"fr",de:"de",ger:"de",deu:"de",pt:"pt",por:"pt",ru:"ru",rus:"ru",ar:"ar",ara:"ar"};
function langFromFile(file){
  const explicit=MediaStore.lower(file&&(file.language||file.lang));
  if(LANG_MAP[explicit])return LANG_MAP[explicit];
  const name=MediaStore.lower(file&&file.name);
  for(const key of Object.keys(LANG_MAP)){
    if(new RegExp("(?:^|[._ -])"+key+"(?:[._ -]|$)","i").test(name))return LANG_MAP[key];
  }
  return"und";
}
function subtitles(id,files){
  return arr(files).filter((file)=>SUBTITLE_EXT.test(MediaStore.text(file&&file.name))).slice(0,30).map((file)=>({
    src:"https://archive.org/download/"+encodeURIComponent(id)+"/"+encodeURIComponent(file.name),
    label:MediaStore.text(file.title||file.name),
    language:langFromFile(file)
  }));
}
function combined(meta,doc){
  return[meta.title,meta.description,meta.subject,meta.collection,meta.creator,doc&&doc.title,doc&&doc.description,doc&&doc.subject,doc&&doc.collection].flatMap(list).join(" ");
}
function classificationText(meta,doc){
  return[meta.title,meta.subject,meta.collection,meta.mediatype,doc&&doc.title,doc&&doc.subject,doc&&doc.collection].flatMap(list).join(" ").toLowerCase();
}
function classify(meta,doc,requested,seconds){
  const value=classificationText(meta,doc);
  let section=requested,confidence=55;
  if(/(?:^|\b)(animation|animated|cartoon|anime|stop motion)(?:\b|$)/.test(value)){section="media-animation";confidence=94;}
  else if(/television series|tv series|episode|season\s*\d+|drama series/.test(value)){section="media-drama";confidence=88;}
  else if(/documentary|nonfiction|public lecture|oral history|archive footage/.test(value)){section="media-documentary";confidence=88;}
  else if(/concert|recital|live performance|music video|orchestra|symphony|opera/.test(value)){section="media-music";confidence=86;}
  else if(/short film|shortfilm/.test(value)||(seconds>0&&seconds<1200)){section="media-shorts";confidence=82;}
  else if(/romance|romantic|melodrama/.test(value)){section="media-romance";confidence=78;}
  else if(/thriller|mystery|suspense|horror|science fiction|sci-fi/.test(value)){section="media-thriller";confidence=78;}
  else if(/talk show|variety|entertainment show|panel discussion/.test(value)){section="media-variety";confidence=76;}
  else if(/feature film|movie|cinema/.test(value)){section="media-movie";confidence=72;}
  return{section,confidence};
}
function rights(meta){
  const assessment=MediaPolicy.assessRights(meta);
  return{
    safe:assessment.evidenceFound&&assessment.decision!=="quarantine",
    licenseUrl:MediaStore.normalizeUrl(meta.licenseurl),
    text:MediaStore.compact(meta.rights||meta.usage||"",500),
    assessment
  };
}
function safety(meta,doc){
  const assessment=MediaPolicy.assessSafety(Object.assign({},meta,{raw:doc}));
  const warnings=assessment.warnings.slice();
  if(VIOLENCE_CONTEXT.test(combined(meta,doc))&&warnings.indexOf("폭력성")<0)warnings.push("폭력성");
  return{
    blocked:assessment.decision==="hard_block",
    quarantine:assessment.decision==="quarantine",
    reason:assessment.reasons[0]||"",
    ageRating:assessment.ageRating||(ACTION_CONTEXT.test(combined(meta,doc))?"15+":"전체"),
    warnings,
    assessment
  };
}
function scoreCandidate(input){
  let score=0;
  const signals=[];
  if(input.height>=2160){score+=34;signals.push("4K");}
  else if(input.height>=1440){score+=27;signals.push("2K");}
  else{score+=20;signals.push("1080p");}
  if(input.year>=2020){score+=24;signals.push("2020+");}
  else if(input.year>=2010){score+=18;signals.push("2010+");}
  else if(input.year>=2000){score+=10;signals.push("2000+");}
  else if(input.adminException){score+=4;signals.push("관리자 역사자료 예외");}
  const popularity=Math.min(20,Math.max(0,Math.log10(Math.max(1,input.downloads))*4));
  score+=popularity;
  if(popularity>=12)signals.push("높은 이용량");
  if(Number(input.rating)>=4){score+=6;signals.push("높은 평점");}
  score+=Math.min(4,Number(input.reviews||0));
  if(input.rightsSafe){score+=20;signals.push("구조화 권리 근거");}
  else score-=8;
  const languages=[...new Set(input.captions.map((caption)=>caption.language).filter((language)=>language&&language!=="und"))];
  if(languages.length){score+=Math.min(8,languages.length*2);signals.push("자막 "+languages.length+"개 언어");}
  if(languages.some((language)=>["ko","en","zh","es"].includes(language)))score+=4;
  score+=Math.min(8,Math.max(0,input.classificationConfidence-50)/6);
  score=Math.round(score);
  return{score,tier:score>=90?"S":score>=78?"A":score>=68?"B":"C",signals,subtitleLanguages:languages};
}
function discoveryLane(page){return["recent","popular","rated"][(Math.max(1,Number(page)||1)-1)%3];}
function searchUrl(section,rows,page){
  const params=new URLSearchParams();
  const lane=discoveryLane(page);
  const sourcePage=Math.floor((Math.max(1,Number(page)||1)-1)/3)+1;
  params.set("q","("+SECTION_QUERIES[section]+") AND year:["+DEFAULT_MIN_YEAR+" TO 9999]");
  ["identifier","title","creator","year","description","subject","collection","licenseurl","rights","downloads","date","publicdate","language","avg_rating","num_reviews"].forEach((field)=>params.append("fl[]",field));
  if(lane==="recent"){params.append("sort[]","publicdate desc");params.append("sort[]","downloads desc");}
  else if(lane==="rated"){params.append("sort[]","avg_rating desc");params.append("sort[]","publicdate desc");}
  else{params.append("sort[]","downloads desc");params.append("sort[]","publicdate desc");}
  params.set("rows",String(rows));
  params.set("page",String(sourcePage));
  params.set("output","json");
  return IA_SEARCH+"?"+params.toString();
}
async function inspect(doc,requested,options){
  const id=safeId(doc&&doc.identifier);
  if(!id)return{rejected:"identifier_missing"};
  const initialTitle=MediaStore.compact(doc&&doc.title,240);
  if(!initialTitle||EXCLUDED_TITLE.test(initialTitle))return{rejected:"trailer_teaser_clip_excluded",identifier:id,title:initialTitle};
  const details=await fetchJson(IA_METADATA+encodeURIComponent(id));
  const meta=details&&details.metadata||{};
  const title=MediaStore.compact(meta.title||initialTitle,240);
  const year=yearOf([meta.year,doc.year,meta.date,doc.date,title].flatMap(list).join(" "));
  if(!options.adminException&&(!year||year<DEFAULT_MIN_YEAR)){
    return{rejected:year?"release_year_before_2000":"release_year_unknown",identifier:id,title,year};
  }
  const safe=safety(meta,doc);
  if(safe.blocked)return{rejected:"prohibited_content_hard_block",policyReasons:safe.assessment.reasons,identifier:id,title,year};
  const videos=chooseVideos(details&&details.files,requested);
  const video=videos[0];
  if(!video)return{rejected:"full_length_1080p_video_file_not_found",identifier:id,title,year};
  const seconds=duration(video.length);
  const classification=classify(meta,doc,requested,seconds);
  const evidence=rights(meta);
  const captions=subtitles(id,details&&details.files);
  const dimensions=dims(video);
  const ranking=scoreCandidate({
    year,height:dimensions.height,downloads:Number(doc.downloads||meta.downloads||0),
    rating:Number(doc.avg_rating||meta.avg_rating||0),reviews:Number(doc.num_reviews||meta.num_reviews||0),
    rightsSafe:evidence.safe,captions,classificationConfidence:classification.confidence,
    adminException:options.adminException
  });
  if(!options.adminException&&ranking.score<MIN_RANK_SCORE){
    return{rejected:"ranking_score_below_threshold",identifier:id,title,year,score:ranking.score};
  }
  const sourceUrl="https://archive.org/details/"+encodeURIComponent(id);
  const videoUrl="https://archive.org/download/"+encodeURIComponent(id)+"/"+encodeURIComponent(video.name);
  const playbackCandidates=videos.map((file)=>({
    url:"https://archive.org/download/"+encodeURIComponent(id)+"/"+encodeURIComponent(file.name),
    name:MediaStore.text(file.name),width:dims(file).width,height:dims(file).height,
    format:MediaStore.text(file.format||file.name.split(".").pop()||""),
    durationSeconds:duration(file.length)
  }));
  const candidate={
    id:"ia:"+id,contentId:"ia:"+id,section_key:classification.section,title,
    provider:"Internet Archive",source_url:sourceUrl,video_url:videoUrl,
    thumb_url:"https://archive.org/services/img/"+encodeURIComponent(id),
    quality_hint:dimensions.height+"p",
    rights_status:evidence.safe?"public_rights_signal_found":"web_verification_required",
    allowed_use:evidence.safe?"rights_evidence_review_required":"verification_required",
    verification_status:"web_verification_required",review_status:"pending",
    risk_level:evidence.safe?"rights_review":"unverified",
    priority:(options.adminException?"ADMIN_EXCEPTION_":"")+ranking.tier+"-"+ranking.score,
    candidateOnly:true,seedContent:true,sanmaru_query:SECTION_QUERIES[requested],
    notes:"1080p+ candidate only. Publication is disabled until administrator content and rights verification.",
    year:year||null,publishedAt:MediaStore.text(meta.publicdate||doc.publicdate||meta.date||doc.date)||null,
    language:list(meta.language||doc.language),durationSeconds:seconds,captions,
    rankingScore:ranking.score,rankingTier:ranking.tier,rankingSignals:ranking.signals,
    subtitleLanguages:ranking.subtitleLanguages,subtitleCount:captions.length,
    ageRating:safe.ageRating,contentWarnings:safe.warnings,
    classificationConfidence:classification.confidence,requestedSection:requested,
    classifiedSection:classification.section,safetyDecision:safe.quarantine?"quarantine":"allow",
    rights:{
      status:evidence.safe?"public_rights_signal_found":"web_verification_required",
      sourceUrl,licenseUrl:evidence.licenseUrl,sourceHint:"archive.org structured metadata",
      candidate:evidence.text||"Rights evidence requires administrator verification"
    },
    sourceMetadata:{
      identifier:id,playbackCandidates,downloads:Number(doc.downloads||meta.downloads||0),
      avgRating:Number(doc.avg_rating||meta.avg_rating||0),numReviews:Number(doc.num_reviews||meta.num_reviews||0),
      year,publicdate:MediaStore.text(meta.publicdate||doc.publicdate),date:MediaStore.text(meta.date||doc.date),
      creator:list(meta.creator||doc.creator),collection:list(meta.collection||doc.collection),
      subject:list(meta.subject||doc.subject),licenseurl:MediaStore.text(meta.licenseurl||doc.licenseurl),
      rights:MediaStore.compact(meta.rights||doc.rights||"",500),videoFile:video.name,
      width:dimensions.width,height:dimensions.height,durationSeconds:seconds,
      subtitleCount:captions.length,classificationConfidence:classification.confidence,
      requestedSection:requested,classifiedSection:classification.section,
      adminException:!!options.adminException,
      overrideReason:MediaStore.compact(options.overrideReason||"",500)
    }
  };
  candidate.policyAssessment=MediaPolicy.assessCandidate(candidate,{adminException:!!options.adminException});
  candidate.review_status=candidate.policyAssessment.reviewStatus;
  candidate.risk_level=candidate.policyAssessment.riskLevel;
  candidate.aiReview={
    status:candidate.policyAssessment.safety.ai.present?"signal_received":"optional_signal_not_received",
    policy:"AI may quarantine but cannot permanently block or publish without administrator review.",
    input:{title,provider:"Internet Archive",thumbnail:candidate.thumb_url,requestedSection:requested,classifiedSection:classification.section}
  };
  return{candidate};
}
async function exclusionIdSet(){
  const ids=new Set(),pageSize=1000;
  for(let offset=0;offset<100000;offset+=pageSize){
    const rows=await MediaStore.selectCandidates("select=id,review_status&review_status=in.(search_excluded,permanent_blocked,approved)&limit="+pageSize+"&offset="+offset);
    const pageRows=Array.isArray(rows)?rows:[];
    pageRows.forEach((row)=>{const id=MediaStore.text(row&&row.id);if(id)ids.add(id);});
    if(pageRows.length<pageSize)return ids;
  }
  const error=new Error("검색 제외·승인 목록이 안전 점검 상한을 초과했습니다.");
  error.statusCode=503;error.code="media_exclusion_scan_limit";throw error;
}
function diversityKey(candidate){
  const source=candidate&&candidate.sourceMetadata||{};
  const creator=list(source.creator)[0],collection=list(source.collection)[0];
  const title=MediaStore.lower(candidate&&candidate.title).replace(/\b(?:season|episode|part|vol(?:ume)?)\s*\d+\b/g,"").slice(0,80);
  return MediaStore.lower(creator||collection||title||candidate&&candidate.id);
}
function diversitySelect(candidates,limit){
  const selected=[],seen=new Set();
  for(const candidate of candidates){
    const key=diversityKey(candidate);
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    selected.push(candidate);
    if(selected.length>=limit)break;
  }
  if(selected.length<limit){
    for(const candidate of candidates){
      if(selected.includes(candidate))continue;
      selected.push(candidate);
      if(selected.length>=limit)break;
    }
  }
  return selected;
}
async function mapLimit(items,limit,worker){
  const output=new Array(items.length);
  let cursor=0;
  async function run(){
    while(cursor<items.length){
      const index=cursor++;
      try{output[index]=await worker(items[index],index);}
      catch(error){output[index]={error};}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
  return output;
}
function sectionFrom(value){
  const section=MediaStore.normalizeSection(value);
  if(!section||!SECTION_QUERIES[section]){
    const error=new Error("수집할 미디어 섹션이 올바르지 않습니다.");
    error.statusCode=400;error.code="media_collector_section_required";throw error;
  }
  return section;
}

exports.handler=async function(event){
  if(event&&event.httpMethod==="OPTIONS")return MediaStore.response(204,{});
  try{
    if(event.httpMethod==="GET")return MediaStore.response(200,{
      ok:true,version:VERSION,sections:Object.keys(SECTION_QUERIES),
      policy:{
        version:MediaPolicy.VERSION,minimumYear:DEFAULT_MIN_YEAR,minimumHeight:MIN_VIDEO_HEIGHT,
        minimumRankingScore:MIN_RANK_SCORE,defaultTarget:DEFAULT_RESULTS,
        defaultBatchSize:DEFAULT_BATCH_SIZE,maxBatchSize:MAX_BATCH_SIZE,
        autoPublish:false,sectionReclassification:"strong-signal quarantine",
        unsafeFiltering:"hard-block plus administrator quarantine",
        romanceAllowed:true,balancedDiscovery:true,batchedCumulative:true
      }
    });
    if(event.httpMethod!=="POST")return MediaStore.response(405,{ok:false,error:"method_not_allowed"});
    const actor=await actorFor(event);
    const body=MediaStore.parseBody(event);
    const section=sectionFrom(body.section||body.sectionKey);
    const target=num(body.target||body.limit,DEFAULT_RESULTS,1,MAX_RESULTS);
    const batchSize=num(body.batchSize,DEFAULT_BATCH_SIZE,1,MAX_BATCH_SIZE);
    const page=num(body.page,1,1,5000);
    const rawIdentifier=MediaStore.text(body.identifier||body.archiveIdentifier||body.sourceUrl);
    const identifier=rawIdentifier?safeId((rawIdentifier.match(/archive\.org\/(?:details|download)\/([^/?#]+)/i)||[])[1]||rawIdentifier):"";
    const adminException=body.adminException===true||body.adminException==="true";
    const overrideReason=MediaStore.compact(body.overrideReason||body.reason||"",500);
    if(adminException&&(!identifier||!overrideReason)){
      const error=new Error("관리자 예외 수집에는 식별자와 사유가 필요합니다.");
      error.statusCode=400;error.code="admin_exception_input_required";throw error;
    }
    let docs,totalFound=0;
    if(identifier){docs=[{identifier,title:identifier}];totalFound=1;}
    else{
      const search=await fetchJson(searchUrl(section,batchSize,page));
      docs=search&&search.response&&Array.isArray(search.response.docs)?search.response.docs:[];
      totalFound=Number(search&&search.response&&search.response.numFound||0);
    }
    const excludedIds=await exclusionIdSet();
    const docsForInspection=docs.filter((doc)=>!excludedIds.has("ia:"+safeId(doc&&doc.identifier)));
    const skippedExcluded=docs.length-docsForInspection.length;
    const inspected=await mapLimit(docsForInspection,2,(doc)=>inspect(doc,section,{adminException,overrideReason}));
    const accepted=[],rejected=[];
    inspected.forEach((entry,index)=>{
      if(entry&&entry.candidate)accepted.push(entry.candidate);
      else rejected.push({
        identifier:entry&&entry.identifier||docsForInspection[index]&&docsForInspection[index].identifier||null,
        title:entry&&entry.title||docsForInspection[index]&&docsForInspection[index].title||null,
        reason:entry&&entry.rejected||entry&&entry.error&&entry.error.code||"inspection_failed",
        score:entry&&entry.score,policyReasons:entry&&entry.policyReasons||[]
      });
    });
    accepted.sort((a,b)=>Number(b.rankingScore||0)-Number(a.rankingScore||0));
    const selected=diversitySelect(accepted,adminException?1:batchSize);
    const normalized=[],validationRejected=[];
    selected.forEach((candidate)=>{
      const row=MediaStore.normalizeCandidate(candidate,actor);
      const validation=MediaStore.validateCandidate(row);
      if(validation.ok)normalized.push(row);
      else validationRejected.push({id:row.id,title:row.title,reasons:validation.reasons});
    });
    const saved=await MediaStore.upsertCandidates(normalized);
    const savedRows=Array.isArray(saved)?saved:normalized;
    const nextPage=identifier?page:page+1;
    const exhausted=identifier||docs.length<batchSize;
    return MediaStore.response(200,{
      ok:true,version:VERSION,mode:identifier?"administrator_exception":"batched_cumulative",
      section,target,batchSize,page,nextPage,
      discoveryLane:identifier?"administrator_identifier":discoveryLane(page),
      done:exhausted,searched:docs.length,totalFound,qualified:accepted.length,
      accepted:normalized.length,saved:savedRows.length,
      savedIds:savedRows.map((row)=>MediaStore.text(row&&row.id)).filter(Boolean),
      rejectedCount:rejected.length+validationRejected.length+skippedExcluded,
      rejected:rejected.concat(validationRejected).concat(skippedExcluded?[{reason:"search_excluded_permanent_blocked_or_already_approved",count:skippedExcluded}]:[]),
      policy:{
        version:MediaPolicy.VERSION,minimumYear:DEFAULT_MIN_YEAR,minimumHeight:MIN_VIDEO_HEIGHT,
        minimumRankingScore:MIN_RANK_SCORE,autoPublish:false,
        sectionReclassification:"strong-signal quarantine",
        unsafeFiltering:"hard-block plus administrator quarantine",
        romanceAllowed:true,balancedDiscovery:true,adminException,batchedCumulative:true
      },
      items:savedRows
    });
  }catch(error){
    return MediaStore.response(error.statusCode||500,{
      ok:false,version:VERSION,error:error.code||"sanmaru_media_collector_failed",
      message:error.message||String(error),
      retryable:[502,503,504].includes(Number(error.statusCode||0))
    });
  }
};
