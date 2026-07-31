"use strict";

const MediaStore=require("./lib/media-candidate-store.v1");
const MediaPolicy=require("./lib/media-candidate-policy.v2");
const SharedAdminAuth=require("./lib/global-slot-console-auth");

const VERSION="sanmaru-media-collector-v2.6.0-balanced-global-region-discovery";
const IA_SEARCH="https://archive.org/advancedsearch.php";
const IA_METADATA="https://archive.org/metadata/";
const DEFAULT_RESULTS=5;
const MAX_RESULTS=20;
const DEFAULT_BATCH_SIZE=3;
const MAX_BATCH_SIZE=5;
const REQUEST_TIMEOUT_MS=9000;
const PLAYBACK_PROBE_TIMEOUT_MS=7000;
const MAX_PLAYBACK_START_MS=5000;
const DEFAULT_MIN_YEAR=2000;
const MIN_VIDEO_HEIGHT=1080;
const MIN_VIDEO_BITRATE_BPS=1500000;
const MIN_RANK_SCORE=72;
const MIN_DOWNLOADS=250;
const MIN_CLASSIFICATION_CONFIDENCE=72;
const MIN_RECENT_RIGHTS_CLASSIFICATION_CONFIDENCE=82;
const RECENT_WINDOW_YEARS=8;
const RECENT_UNVERIFIED_REVIEW_WINDOW_YEARS=3;
const MIN_RIGHTS_REVIEW_RANK_SCORE=50;
const VIDEO_EXT=/\.(mp4|webm|ogv|m4v)$/i;
const SUBTITLE_EXT=/\.(vtt|srt|ass|ssa)$/i;
const EXCLUDED_TITLE=/\b(trailer|teaser|promo|preview|clip|excerpt|sample|highlight|commercial|advertisement|featurette|behind\s+the\s+scenes)\b/i;
const EXCLUDED_CONTEXT=/\b(home\s+movie|camera\s+test|screen\s+test|test\s+footage|raw\s+footage|fan\s+edit|fan\s+film|gameplay|walkthrough|advertisement|commercial)\b/i;
const UNRELIABLE_UPLOAD_CONTEXT=/\b(?:camrip|hdcam|telesync|dvdrip|bdrip|br\s*rip|blu\s*ray\s*rip|webrip|web[- .]?dl|yify|yts(?:\.mx)?|torrent|warez|full\s+rips?|screen\s+recording|deleted\s+video)\b/i;
const RESERVED_RIGHTS_CONTEXT=/\ball\s+rights\s+reserved\b|版权所有|版權所有/i;
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
const SECTION_LONGFORM_QUERIES=Object.freeze({
  "media-movie":'(mediatype:movies) AND (collection:(feature_films OR opensource_movies) OR subject:("feature film" OR "full movie" OR cinema OR "motion picture") OR title:("full movie" OR "full film" OR 电影 OR 電影)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-drama":'(mediatype:movies) AND (subject:(drama OR "television series" OR "tv series" OR "web series") OR title:(episode OR season OR 电视剧 OR 電視劇 OR 剧集 OR 劇集)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-thriller":'(mediatype:movies) AND (subject:(thriller OR mystery OR suspense OR horror OR "science fiction" OR crime) OR title:(悬疑 OR 懸疑 OR 惊悚 OR 驚悚)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-romance":'(mediatype:movies) AND (subject:(romance OR romantic OR melodrama OR "love story") OR title:(爱情 OR 愛情 OR 言情)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-variety":'(mediatype:movies) AND (subject:(variety OR entertainment OR "talk show" OR "television program") OR title:(综艺 OR 綜藝 OR 脱口秀 OR 脫口秀)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-documentary":'(mediatype:movies) AND (subject:(documentary OR nonfiction OR "investigative report") OR collection:documentary_films OR title:(纪录片 OR 紀錄片)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-animation":'(mediatype:movies) AND (subject:(animation OR animated OR cartoon OR anime) OR title:(动画 OR 動畫 OR 动漫 OR 動漫)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-music":'(mediatype:movies) AND (subject:(concert OR performance OR music OR recital OR orchestra) OR title:(演唱会 OR 演唱會 OR 音乐会 OR 音樂會)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-shorts":'(mediatype:movies) AND (subject:("short film" OR shortfilm OR "short subject") OR title:(短片 OR 微电影 OR 微電影)) NOT title:(trailer OR teaser OR clip OR preview)'
});
const SECTION_CHINESE_QUERIES=Object.freeze({
  "media-movie":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh) OR subject:("Chinese film" OR "Chinese cinema" OR "Mandarin film" OR "Hong Kong cinema")) AND (subject:("feature film" OR cinema OR "motion picture") OR title:(电影 OR 電影 OR "full movie")) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-drama":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh) OR subject:("Chinese drama" OR "Mandarin drama")) AND (subject:(drama OR "television series" OR "web series") OR title:(episode OR 电视剧 OR 電視劇 OR 剧集 OR 劇集)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-thriller":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh)) AND (subject:(thriller OR mystery OR suspense OR crime) OR title:(悬疑 OR 懸疑 OR 惊悚 OR 驚悚)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-romance":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh)) AND (subject:(romance OR melodrama OR "love story") OR title:(爱情 OR 愛情 OR 言情)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-variety":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh)) AND (subject:(variety OR entertainment OR "talk show") OR title:(综艺 OR 綜藝 OR 脱口秀 OR 脫口秀)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-documentary":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh)) AND (subject:(documentary OR nonfiction) OR title:(纪录片 OR 紀錄片)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-animation":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh)) AND (subject:(animation OR anime OR cartoon) OR title:(动画 OR 動畫 OR 动漫 OR 動漫)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-music":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh)) AND (subject:(concert OR performance OR music) OR title:(演唱会 OR 演唱會 OR 音乐会 OR 音樂會)) NOT title:(trailer OR teaser OR clip OR preview)',
  "media-shorts":'(mediatype:movies) AND (language:(chi OR zho OR Chinese OR zh)) AND (subject:("short film" OR shortfilm) OR title:(短片 OR 微电影 OR 微電影)) NOT title:(trailer OR teaser OR clip OR preview)'
});
const REGION_FILTERS=Object.freeze({
  southeast_asia:'language:(ind OR Indonesian OR tha OR Thai OR vie OR Vietnamese OR tgl OR Tagalog OR fil OR Filipino OR may OR Malay OR bur OR Burmese OR khm OR Khmer) OR subject:(Indonesia OR Thailand OR Vietnam OR Philippines OR Malaysia OR Singapore OR Myanmar OR Cambodia OR Laos OR "Southeast Asia") OR coverage:(Indonesia OR Thailand OR Vietnam OR Philippines OR Malaysia OR Singapore OR Myanmar OR Cambodia OR Laos)',
  europe:'language:(fre OR fra OR French OR ger OR deu OR German OR ita OR Italian OR dut OR nld OR Dutch OR pol OR Polish OR swe OR Swedish OR nor OR Norwegian OR dan OR Danish OR fin OR Finnish OR rus OR Russian OR tur OR Turkish) OR subject:(Europe OR European OR France OR Germany OR Italy OR Netherlands OR Poland OR Sweden OR Norway OR Denmark OR Finland OR Russia OR Turkey) OR coverage:(Europe OR France OR Germany OR Italy OR Netherlands OR Poland OR Sweden OR Norway OR Denmark OR Finland OR Russia OR Turkey)',
  latin_america:'subject:("Latin America" OR "Latin American" OR Mexico OR Argentina OR Brazil OR Colombia OR Chile OR Peru OR Venezuela OR Ecuador OR Uruguay OR Paraguay OR Bolivia OR Cuba) OR coverage:("Latin America" OR Mexico OR Argentina OR Brazil OR Colombia OR Chile OR Peru OR Venezuela OR Ecuador OR Uruguay OR Paraguay OR Bolivia OR Cuba) OR title:(pelicula OR película OR novela OR capitulo OR capítulo OR filme OR episodio OR episódio)',
  north_america:'subject:("North America" OR "United States" OR USA OR American OR Canada OR Canadian OR Mexico) OR coverage:("North America" OR "United States" OR USA OR Canada OR Mexico) OR collection:(feature_films OR classic_tv)',
  global_multilingual:'language:(chi OR zho OR Chinese OR jpn OR Japanese OR kor OR Korean OR spa OR Spanish OR por OR Portuguese OR fre OR French OR ger OR German OR ita OR Italian OR rus OR Russian OR ara OR Arabic OR ind OR Indonesian OR tha OR Thai OR vie OR Vietnamese OR tgl OR Tagalog OR may OR Malay)'
});
const DISCOVERY_CYCLE_LENGTH=12;
function regionalQuery(section,region){return"("+SECTION_LONGFORM_QUERIES[section]+") AND ("+REGION_FILTERS[region]+")";}

function headers(){return{"accept":"application/json","user-agent":"IGDC-MARU-MediaCollector/2.4 (+https://igdc.info)"};}
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
  const raw=MediaStore.text(value);
  if(/^\d+(?:\.\d+)?$/.test(raw))return Number(raw);
  const parts=raw.split(":").map(Number);
  if(parts.some((item)=>!Number.isFinite(item)))return Number(value)||0;
  return parts.length===3?parts[0]*3600+parts[1]*60+parts[2]:parts.length===2?parts[0]*60+parts[1]:Number(value)||0;
}
function minDuration(section){
  if(section==="media-shorts")return 120;
  if(section==="media-music")return 600;
  if(section==="media-movie"||section==="media-thriller"||section==="media-romance")return 2400;
  if(section==="media-drama"||section==="media-documentary")return 1200;
  if(section==="media-variety")return 900;
  if(section==="media-animation")return 180;
  return 120;
}
function maxDuration(section){
  return section==="media-shorts"?1200:Infinity;
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
function bitrateFloor(file){
  const height=dims(file).height;
  if(height>=2160)return 4500000;
  if(height>=1440)return 2500000;
  return MIN_VIDEO_BITRATE_BPS;
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
  const maximum=maxDuration(section);
  return arr(files).map((file)=>{
    const name=MediaStore.text(file&&file.name),source=MediaStore.lower(file&&file.source);
    if(!VIDEO_EXT.test(name)||EXCLUDED_TITLE.test(name))return null;
    if(source&&source!=="original"&&source!=="derivative")return null;
    const size=Number(file&&file.size||0);
    if(size<20*1024*1024)return null;
    if(!dims(file).ok)return null;
    const seconds=duration(file&&file.length);
    if(!seconds||seconds<minimum||seconds>maximum)return null;
    const bitrateBps=Math.round(size*8/seconds);
    const requiredBitrateBps=bitrateFloor(file);
    if(bitrateBps<requiredBitrateBps)return null;
    return Object.assign({},file,{_durationSeconds:seconds,_bitrateBps:bitrateBps,_requiredBitrateBps:requiredBitrateBps});
  }).filter(Boolean).sort((a,b)=>{
    const bitrate=Number(b&&b._bitrateBps||0)-Number(a&&a._bitrateBps||0);
    if(Math.abs(bitrate)>=500000)return bitrate;
    const preferred=videoPreference(b&&b.name)-videoPreference(a&&a.name);
    if(preferred)return preferred;
    const original=(MediaStore.lower(b&&b.source)==="original"?1:0)-(MediaStore.lower(a&&a.source)==="original"?1:0);
    if(original)return original;
    const left=dims(a),right=dims(b);
    return right.height-left.height||right.width-left.width||Number(b&&b.size||0)-Number(a&&a.size||0);
  });
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
  return[meta.title,meta.subject,meta.collection,meta.mediatype,doc&&doc.title,doc&&doc.subject,doc&&doc.collection]
    .flatMap(list).join(" ").toLowerCase().replace(/[_-]+/g," ");
}
function classify(meta,doc,requested,seconds){
  const value=classificationText(meta,doc);
  let section=requested,confidence=74;
  if(/(?:^|\b)(animation|animated|cartoon|anime|stop motion)(?:\b|$)|动画|動畫|动漫|動漫/.test(value)){section="media-animation";confidence=94;}
  else if(/concert|recital|live performance|music video|orchestra|symphony|opera|musical performance|演唱会|演唱會|音乐会|音樂會/.test(value)){section="media-music";confidence=92;}
  else if(/short film|shortfilm|short subject|短片|微电影|微電影/.test(value)){section="media-shorts";confidence=92;}
  else if(/documentary|nonfiction|oral history|investigative report|nature film|纪录片|紀錄片/.test(value)){section="media-documentary";confidence=90;}
  else if(/talk show|variety show|entertainment show|panel show|game show|classic tv|television program|综艺|綜藝|脱口秀|脫口秀/.test(value)){section="media-variety";confidence=88;}
  else if(seconds>0&&seconds<=1200){section="media-shorts";confidence=84;}
  else if(/romance|romantic|melodrama|love story|爱情|愛情|言情/.test(value)){section="media-romance";confidence=84;}
  else if(/thriller|mystery|suspense|horror|science fiction|sci-fi|crime film|悬疑|懸疑|惊悚|驚悚/.test(value)){section="media-thriller";confidence=84;}
  else if(/television series|tv series|television episode|web series|episode\s*\d+|season\s*\d+|drama series|soap opera|\bdrama\b|电视剧|電視劇|剧集|劇集/.test(value)){section="media-drama";confidence=88;}
  else if(/feature films?|motion picture|full movie|cinema|电影|電影/.test(value)){section="media-movie";confidence=84;}
  return{section,confidence};
}
async function probeAsset(url,kind){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),PLAYBACK_PROBE_TIMEOUT_MS);
  const started=Date.now();
  try{
    const response=await fetch(url,{
      method:"GET",redirect:"follow",signal:controller.signal,
      headers:Object.assign({},headers(),{range:kind==="image"?"bytes=0-4095":"bytes=0-65535"})
    });
    const latencyMs=Date.now()-started;
    const contentType=MediaStore.lower(response.headers&&response.headers.get&&response.headers.get("content-type"));
    let bytesRead=0;
    if(response.body&&typeof response.body.getReader==="function"){
      const reader=response.body.getReader();
      const chunk=await reader.read();
      bytesRead=chunk&&chunk.value&&chunk.value.byteLength||0;
      try{await reader.cancel();}catch(_error){}
    }
    const statusOk=response.ok||response.status===206;
    const typeOk=kind==="image"?
      /^image\//.test(contentType):
      (/^(video|audio)\//.test(contentType)||/octet-stream|binary/.test(contentType)||VIDEO_EXT.test(new URL(url).pathname));
    const ok=statusOk&&typeOk&&bytesRead>0&&latencyMs<=MAX_PLAYBACK_START_MS;
    return{
      present:true,ok,status:response.status,latencyMs,bytesRead,contentType,
      finalUrl:MediaStore.normalizeUrl(response.url||url),
      reason:!statusOk?"source_http_"+response.status:!typeOk?"unexpected_content_type":!bytesRead?"empty_probe_body":latencyMs>MAX_PLAYBACK_START_MS?"playback_start_too_slow":""
    };
  }catch(error){
    return{
      present:true,ok:false,status:0,latencyMs:Date.now()-started,bytesRead:0,contentType:"",
      finalUrl:MediaStore.normalizeUrl(url),
      reason:error&&error.name==="AbortError"?"probe_timeout":MediaStore.compact(error&&error.message||"probe_failed",180)
    };
  }finally{clearTimeout(timer);}
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
  if(input.bitrateBps>=5000000){score+=10;signals.push("고비트레이트");}
  else if(input.bitrateBps>=2500000){score+=7;signals.push("안정적 비트레이트");}
  else if(input.bitrateBps>=MIN_VIDEO_BITRATE_BPS){score+=4;signals.push("기본 비트레이트 통과");}
  if(input.playbackLatencyMs>0&&input.playbackLatencyMs<=1500){score+=8;signals.push("빠른 재생 응답");}
  else if(input.playbackLatencyMs<=3000){score+=5;signals.push("재생 응답 통과");}
  else if(input.playbackLatencyMs<=MAX_PLAYBACK_START_MS){score+=2;signals.push("재생 응답 허용");}
  const languages=[...new Set(input.captions.map((caption)=>caption.language).filter((language)=>language&&language!=="und"))];
  if(languages.length){score+=Math.min(8,languages.length*2);signals.push("자막 "+languages.length+"개 언어");}
  if(languages.some((language)=>["ko","en","zh","es"].includes(language)))score+=4;
  score+=Math.min(8,Math.max(0,input.classificationConfidence-50)/6);
  score=Math.round(score);
  return{score,tier:score>=90?"S":score>=78?"A":score>=68?"B":"C",signals,subtitleLanguages:languages};
}
function discoveryPlan(section,page){
  const plans=[
    {lane:"recent",region:"global",query:SECTION_QUERIES[section],sort:["publicdate desc","downloads desc"]},
    {lane:"chinese_recent",region:"greater_china",query:SECTION_CHINESE_QUERIES[section],sort:["publicdate desc","downloads desc"]},
    {lane:"southeast_asia",region:"southeast_asia",query:regionalQuery(section,"southeast_asia"),sort:["publicdate desc","downloads desc"]},
    {lane:"europe",region:"europe",query:regionalQuery(section,"europe"),sort:["publicdate desc","downloads desc"]},
    {lane:"latin_america",region:"latin_america",query:regionalQuery(section,"latin_america"),sort:["publicdate desc","downloads desc"]},
    {lane:"north_america",region:"north_america",query:regionalQuery(section,"north_america"),sort:["publicdate desc","downloads desc"]},
    {lane:"recent_rights",region:"global",query:"("+SECTION_LONGFORM_QUERIES[section]+") AND (licenseurl:* OR rights:*)",sort:["publicdate desc","downloads desc"]},
    {lane:"longform",region:"global",query:SECTION_LONGFORM_QUERIES[section],sort:["year desc","downloads desc"]},
    {lane:"popular",region:"global",query:SECTION_QUERIES[section],sort:["downloads desc","publicdate desc"]},
    {lane:"rated",region:"global",query:SECTION_QUERIES[section],sort:["avg_rating desc","publicdate desc"]},
    {lane:"chinese_rights",region:"greater_china",query:"("+SECTION_CHINESE_QUERIES[section]+") AND (licenseurl:* OR rights:*)",sort:["year desc","downloads desc"]},
    {lane:"global_multilingual_rights",region:"global_multilingual",query:"("+regionalQuery(section,"global_multilingual")+") AND (licenseurl:* OR rights:*)",sort:["year desc","downloads desc"]}
  ];
  const index=(Math.max(1,Number(page)||1)-1)%plans.length;
  return Object.assign({sourcePage:Math.floor((Math.max(1,Number(page)||1)-1)/plans.length)+1},plans[index]);
}
function discoveryLane(page,section){return discoveryPlan(section||"media-movie",page).lane;}
function searchUrl(section,rows,page){
  const params=new URLSearchParams();
  const plan=discoveryPlan(section,page);
  params.set("q","("+plan.query+") AND year:["+DEFAULT_MIN_YEAR+" TO 9999]");
  ["identifier","title","creator","year","description","subject","collection","coverage","licenseurl","rights","downloads","date","publicdate","language","avg_rating","num_reviews"].forEach((field)=>params.append("fl[]",field));
  plan.sort.forEach((sort)=>params.append("sort[]",sort));
  params.set("rows",String(rows));
  params.set("page",String(plan.sourcePage));
  params.set("output","json");
  return IA_SEARCH+"?"+params.toString();
}
function recentRightsCandidate(input){
  const currentYear=new Date().getUTCFullYear();
  return Number(input.year)>=currentYear-RECENT_WINDOW_YEARS&&
    input.rightsSafe===true&&
    Number(input.classificationConfidence)>=MIN_RECENT_RIGHTS_CLASSIFICATION_CONFIDENCE;
}
function recentQualityRightsReviewCandidate(input){
  const currentYear=new Date().getUTCFullYear();
  const section=MediaStore.text(input.section);
  return input.rightsSafe!==true&&
    ["media-movie","media-drama"].includes(section)&&
    ["recent","longform","chinese_recent","southeast_asia","europe","latin_america","north_america"].includes(MediaStore.text(input.discoveryLane))&&
    Number(input.year)>=currentYear-RECENT_UNVERIFIED_REVIEW_WINDOW_YEARS&&
    Number(input.classificationConfidence)>=84&&
    Number(input.height)>=MIN_VIDEO_HEIGHT&&
    Number(input.bitrateBps)>=Number(input.requiredBitrateBps||MIN_VIDEO_BITRATE_BPS)&&
    Number(input.durationSeconds)>=minDuration(section);
}
function popularityAccepted(input){
  if(Number(input.downloads)>=MIN_DOWNLOADS)return{ok:true,reason:"minimum_downloads"};
  if(Number(input.rating)>=4.2&&Number(input.reviews)>=5)return{ok:true,reason:"rated"};
  if(recentRightsCandidate(input))return{ok:true,reason:"recent_structured_rights"};
  if(recentQualityRightsReviewCandidate(input))return{ok:true,reason:"recent_quality_rights_review"};
  return{ok:false,reason:"popularity_signal_below_threshold"};
}
async function inspect(doc,requested,options){
  const id=safeId(doc&&doc.identifier);
  if(!id)return{rejected:"identifier_missing"};
  const initialTitle=MediaStore.compact(doc&&doc.title,240);
  if(!initialTitle||EXCLUDED_TITLE.test(initialTitle))return{rejected:"trailer_teaser_clip_excluded",identifier:id,title:initialTitle};
  const details=await fetchJson(IA_METADATA+encodeURIComponent(id));
  const meta=details&&details.metadata||{};
  const title=MediaStore.compact(meta.title||initialTitle,240);
  if(EXCLUDED_CONTEXT.test(combined(meta,doc))){
    return{rejected:"low_value_or_nonprogram_video_context",identifier:id,title};
  }
  if(UNRELIABLE_UPLOAD_CONTEXT.test(combined(meta,doc))){
    return{rejected:"unreliable_or_piracy_upload_signal",identifier:id,title};
  }
  if(RESERVED_RIGHTS_CONTEXT.test([meta.rights,meta.usage,doc&&doc.rights].flatMap(list).join(" "))){
    return{rejected:"explicit_all_rights_reserved",identifier:id,title};
  }
  const year=yearOf([meta.year,doc.year,meta.date,doc.date,title].flatMap(list).join(" "));
  if(!options.adminException&&(!year||year<DEFAULT_MIN_YEAR)){
    return{rejected:year?"release_year_before_2000":"release_year_unknown",identifier:id,title,year};
  }
  const safe=safety(meta,doc);
  if(safe.blocked)return{rejected:"prohibited_content_hard_block",policyReasons:safe.assessment.reasons,identifier:id,title,year};
  const broadVideos=chooseVideos(details&&details.files,"");
  const broadVideo=broadVideos.slice().sort((left,right)=>duration(right&&right.length)-duration(left&&left.length))[0];
  if(!broadVideo)return{rejected:"reliable_1080p_video_file_not_found",identifier:id,title,year};
  const seconds=duration(broadVideo.length);
  const classification=classify(meta,doc,requested,seconds);
  if(!options.adminException&&classification.confidence<MIN_CLASSIFICATION_CONFIDENCE){
    return{rejected:"classification_confidence_below_threshold",identifier:id,title,year,classification};
  }
  const videos=chooseVideos(details&&details.files,classification.section).slice(0,5);
  const video=videos[0];
  if(!video){
    return{rejected:"section_duration_or_bitrate_requirement_not_met",identifier:id,title,year,classification};
  }
  const selectedSeconds=duration(video.length);
  const evidence=rights(meta);
  const captions=subtitles(id,details&&details.files);
  const dimensions=dims(video);
  const downloads=Number(doc.downloads||meta.downloads||0);
  const rating=Number(doc.avg_rating||meta.avg_rating||0);
  const reviews=Number(doc.num_reviews||meta.num_reviews||0);
  const popularity=popularityAccepted({
    year,downloads,rating,reviews,rightsSafe:evidence.safe,
    classificationConfidence:classification.confidence,
    section:classification.section,discoveryLane:options.discoveryLane,
    height:dimensions.height,bitrateBps:Number(video._bitrateBps||0),
    requiredBitrateBps:Number(video._requiredBitrateBps||MIN_VIDEO_BITRATE_BPS),
    durationSeconds:selectedSeconds
  });
  if(!options.adminException&&!popularity.ok){
    return{rejected:popularity.reason,identifier:id,title,year,downloads,rating,reviews};
  }
  const sourceUrl="https://archive.org/details/"+encodeURIComponent(id);
  const videoUrl="https://archive.org/download/"+encodeURIComponent(id)+"/"+encodeURIComponent(video.name);
  const providerThumbUrl="https://archive.org/services/img/"+encodeURIComponent(id);
  const probeResults=await Promise.all([probeAsset(videoUrl,"video"),probeAsset(providerThumbUrl,"image")]);
  const playbackProbe=probeResults[0],thumbnailProbe=probeResults[1];
  if(!options.adminException&&!playbackProbe.ok){
    return{
      rejected:playbackProbe.reason||"playback_probe_failed",identifier:id,title,year,
      playbackProbe
    };
  }
  const bitrateBps=Number(video._bitrateBps||0);
  const ranking=scoreCandidate({
    year,height:dimensions.height,downloads,rating,reviews,bitrateBps,
    playbackLatencyMs:Number(playbackProbe.latencyMs||0),
    rightsSafe:evidence.safe,captions,classificationConfidence:classification.confidence,
    adminException:options.adminException
  });
  const minimumAcceptedRank=popularity.reason==="recent_quality_rights_review"?MIN_RIGHTS_REVIEW_RANK_SCORE:MIN_RANK_SCORE;
  if(!options.adminException&&ranking.score<minimumAcceptedRank){
    return{rejected:"ranking_score_below_threshold",identifier:id,title,year,score:ranking.score,minimumAcceptedRank};
  }
  const playbackCandidates=videos.map((file)=>({
    url:"https://archive.org/download/"+encodeURIComponent(id)+"/"+encodeURIComponent(file.name),
    name:MediaStore.text(file.name),width:dims(file).width,height:dims(file).height,
    format:MediaStore.text(file.format||file.name.split(".").pop()||""),
    durationSeconds:duration(file.length),bitrateBps:Number(file._bitrateBps||0)
  }));
  const candidate={
    id:"ia:"+id,contentId:"ia:"+id,section_key:classification.section,title,
    provider:"Internet Archive",source_url:sourceUrl,video_url:videoUrl,
    thumb_url:thumbnailProbe.ok?providerThumbUrl:"",
    quality_hint:dimensions.height+"p",
    rights_status:evidence.safe?"public_rights_signal_found":"web_verification_required",
    allowed_use:evidence.safe?"rights_evidence_review_required":"verification_required",
    verification_status:"web_verification_required",review_status:"pending",
    risk_level:evidence.safe?"rights_review":"unverified",
    priority:(options.adminException?"ADMIN_EXCEPTION_":"")+ranking.tier+"-"+ranking.score,
    candidateOnly:true,seedContent:true,sanmaru_query:MediaStore.compact(options.discoveryQuery||SECTION_QUERIES[requested],500),
    notes:"1080p+ candidate only. Publication is disabled until administrator content and rights verification.",
    year:year||null,region:options.discoveryRegion||"global",publishedAt:MediaStore.text(meta.publicdate||doc.publicdate||meta.date||doc.date)||null,
    language:list(meta.language||doc.language),durationSeconds:selectedSeconds,captions,
    rankingScore:ranking.score,rankingTier:ranking.tier,rankingSignals:ranking.signals,
    discoveryLane:options.discoveryLane,discoveryRegion:options.discoveryRegion||"global",popularityQualification:popularity.reason,
    subtitleLanguages:ranking.subtitleLanguages,subtitleCount:captions.length,
    ageRating:safe.ageRating,contentWarnings:safe.warnings,
    classificationConfidence:classification.confidence,requestedSection:requested,
    classifiedSection:classification.section,safetyDecision:safe.quarantine?"quarantine":"allow",
    bitrateBps,playbackProbe,thumbnailProbe,
    mediaReliability:{
      playbackVerified:playbackProbe.ok===true,
      playbackStartMs:Number(playbackProbe.latencyMs||0),
      thumbnailVerified:thumbnailProbe.ok===true,
      popularityVerified:downloads>=MIN_DOWNLOADS||(rating>=4.2&&reviews>=5),
      classificationVerified:classification.confidence>=MIN_CLASSIFICATION_CONFIDENCE,
      checkedAt:new Date().toISOString()
    },
    rights:{
      status:evidence.safe?"public_rights_signal_found":"web_verification_required",
      sourceUrl,licenseUrl:evidence.licenseUrl,sourceHint:"archive.org structured metadata",
      candidate:evidence.text||"Rights evidence requires administrator verification"
    },
    sourceMetadata:{
      identifier:id,playbackCandidates,downloads,
      avgRating:rating,numReviews:reviews,
      year,publicdate:MediaStore.text(meta.publicdate||doc.publicdate),date:MediaStore.text(meta.date||doc.date),
      creator:list(meta.creator||doc.creator),collection:list(meta.collection||doc.collection),coverage:list(meta.coverage||doc.coverage),
      subject:list(meta.subject||doc.subject),licenseurl:MediaStore.text(meta.licenseurl||doc.licenseurl),
      rights:MediaStore.compact(meta.rights||doc.rights||"",500),videoFile:video.name,
      width:dimensions.width,height:dimensions.height,durationSeconds:selectedSeconds,bitrateBps,
      requiredBitrateBps:Number(video._requiredBitrateBps||MIN_VIDEO_BITRATE_BPS),
      subtitleCount:captions.length,classificationConfidence:classification.confidence,
      requestedSection:requested,classifiedSection:classification.section,
      discoveryLane:options.discoveryLane,discoveryRegion:options.discoveryRegion||"global",
      playbackProbe,thumbnailProbe,
      mediaReliability:{
        playbackVerified:playbackProbe.ok===true,
        playbackStartMs:Number(playbackProbe.latencyMs||0),
        thumbnailVerified:thumbnailProbe.ok===true,
        popularityVerified:downloads>=MIN_DOWNLOADS||(rating>=4.2&&reviews>=5),
        classificationVerified:classification.confidence>=MIN_CLASSIFICATION_CONFIDENCE
      },
      adminException:!!options.adminException,
      overrideReason:MediaStore.compact(options.overrideReason||"",500)
    }
  };
  candidate.policyAssessment=MediaPolicy.assessCandidate(candidate,{adminException:!!options.adminException});
  candidate.review_status=candidate.policyAssessment.reviewStatus;
  candidate.risk_level=candidate.policyAssessment.riskLevel;
  if(popularity.reason==="recent_quality_rights_review"){
    candidate.review_status="rights_quarantine";
    candidate.risk_level="rights_risk";
    candidate.policyAssessment=Object.assign({},candidate.policyAssessment,{
      decision:"quarantine",reviewStatus:"rights_quarantine",riskLevel:"rights_risk",
      reasons:Array.from(new Set((candidate.policyAssessment.reasons||[]).concat(["recent_content_rights_verification_required"])))
    });
  }
  candidate.aiReview={
    status:candidate.policyAssessment.safety.ai.present?"signal_received":"optional_signal_not_received",
    policy:"AI may quarantine but cannot permanently block or publish without administrator review.",
    input:{title,provider:"Internet Archive",thumbnail:candidate.thumb_url,requestedSection:requested,classifiedSection:classification.section}
  };
  return{candidate};
}
async function existingCandidateIdSet(){
  const ids=new Set(),pageSize=1000;
  for(let offset=0;offset<100000;offset+=pageSize){
    const rows=await MediaStore.selectCandidates("select=id,review_status&order=id.asc&limit="+pageSize+"&offset="+offset);
    const pageRows=Array.isArray(rows)?rows:[];
    pageRows.forEach((row)=>{const id=MediaStore.text(row&&row.id);if(id)ids.add(id);});
    if(pageRows.length<pageSize)return ids;
  }
  const error=new Error("기존 후보 목록이 안전 점검 상한을 초과했습니다.");
  error.statusCode=503;error.code="media_existing_candidate_scan_limit";throw error;
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
        minimumBitrateBps:MIN_VIDEO_BITRATE_BPS,maximumPlaybackStartMs:MAX_PLAYBACK_START_MS,
        minimumDownloads:MIN_DOWNLOADS,minimumClassificationConfidence:MIN_CLASSIFICATION_CONFIDENCE,
        minimumRecentRightsClassificationConfidence:MIN_RECENT_RIGHTS_CLASSIFICATION_CONFIDENCE,
        recentWindowYears:RECENT_WINDOW_YEARS,recentStructuredRightsPopularityException:true,
        recentUnverifiedReviewWindowYears:RECENT_UNVERIFIED_REVIEW_WINDOW_YEARS,
        recentQualityRightsQuarantine:true,minimumRightsReviewRankingScore:MIN_RIGHTS_REVIEW_RANK_SCORE,
        minimumRankingScore:MIN_RANK_SCORE,defaultTarget:DEFAULT_RESULTS,
        defaultBatchSize:DEFAULT_BATCH_SIZE,maxBatchSize:MAX_BATCH_SIZE,
        autoPublish:false,sectionReclassification:"strong-signal quarantine",
        unsafeFiltering:"hard-block plus administrator quarantine",
        romanceAllowed:true,balancedDiscovery:true,multilingualLongformDiscovery:true,batchedCumulative:true
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
    const plan=discoveryPlan(section,page);
    if(identifier){docs=[{identifier,title:identifier}];totalFound=1;}
    else{
      const search=await fetchJson(searchUrl(section,batchSize,page));
      docs=search&&search.response&&Array.isArray(search.response.docs)?search.response.docs:[];
      totalFound=Number(search&&search.response&&search.response.numFound||0);
    }
    const existingIds=await existingCandidateIdSet();
    const docsForInspection=docs.filter((doc)=>!existingIds.has("ia:"+safeId(doc&&doc.identifier)));
    const skippedExisting=docs.length-docsForInspection.length;
    const inspected=await mapLimit(docsForInspection,2,(doc)=>inspect(doc,section,{
      adminException,overrideReason,
      discoveryLane:identifier?"administrator_identifier":plan.lane,
      discoveryRegion:identifier?"administrator":plan.region,
      discoveryQuery:identifier?"identifier:"+identifier:plan.query
    }));
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
      if(candidate.popularityQualification==="recent_quality_rights_review"){
        row.review_status="rights_quarantine";
        row.risk_level="rights_risk";
        row.verification_status="web_verification_required";
        row.raw=Object.assign({},row.raw,{
          policyAssessment:Object.assign({},row.raw&&row.raw.policyAssessment||{},{
            decision:"quarantine",reviewStatus:"rights_quarantine",riskLevel:"rights_risk",
            reasons:Array.from(new Set((((row.raw&&row.raw.policyAssessment||{}).reasons)||[]).concat(["recent_content_rights_verification_required"])))
          })
        });
      }
      const validation=MediaStore.validateCandidate(row);
      if(validation.ok)normalized.push(row);
      else validationRejected.push({id:row.id,title:row.title,reasons:validation.reasons});
    });
    const saved=await MediaStore.upsertCandidates(normalized);
    const savedRows=Array.isArray(saved)?saved:normalized;
    const nextPage=identifier?page:page+1;
    const exhausted=!!identifier;
    return MediaStore.response(200,{
      ok:true,version:VERSION,mode:identifier?"administrator_exception":"batched_cumulative",
      section,target,batchSize,page,nextPage,
      discoveryLane:identifier?"administrator_identifier":plan.lane,
      discoveryRegion:identifier?"administrator":plan.region,
      discoveryCycleLength:DISCOVERY_CYCLE_LENGTH,
      done:exhausted,searched:docs.length,totalFound,qualified:accepted.length,
      accepted:normalized.length,saved:savedRows.length,
      savedIds:savedRows.map((row)=>MediaStore.text(row&&row.id)).filter(Boolean),
      rejectedCount:rejected.length+validationRejected.length+skippedExisting,
      rejected:rejected.concat(validationRejected).concat(skippedExisting?[{reason:"existing_candidate_not_reentered_or_overwritten",count:skippedExisting}]:[]),
      policy:{
        version:MediaPolicy.VERSION,minimumYear:DEFAULT_MIN_YEAR,minimumHeight:MIN_VIDEO_HEIGHT,
        minimumBitrateBps:MIN_VIDEO_BITRATE_BPS,maximumPlaybackStartMs:MAX_PLAYBACK_START_MS,
        minimumDownloads:MIN_DOWNLOADS,minimumClassificationConfidence:MIN_CLASSIFICATION_CONFIDENCE,
        minimumRecentRightsClassificationConfidence:MIN_RECENT_RIGHTS_CLASSIFICATION_CONFIDENCE,
        recentWindowYears:RECENT_WINDOW_YEARS,recentStructuredRightsPopularityException:true,
        recentUnverifiedReviewWindowYears:RECENT_UNVERIFIED_REVIEW_WINDOW_YEARS,
        recentQualityRightsQuarantine:true,minimumRightsReviewRankingScore:MIN_RIGHTS_REVIEW_RANK_SCORE,
        minimumRankingScore:MIN_RANK_SCORE,autoPublish:false,
        sectionReclassification:"strong-signal quarantine",
        unsafeFiltering:"hard-block plus administrator quarantine",
        romanceAllowed:true,balancedDiscovery:true,multilingualLongformDiscovery:true,
        balancedRegionalDiscovery:true,discoveryCycleLength:DISCOVERY_CYCLE_LENGTH,
        regions:["greater_china","southeast_asia","europe","latin_america","north_america","global_multilingual"],
        adminException,batchedCumulative:true
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
