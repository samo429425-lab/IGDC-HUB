"use strict";

/*
 * Donation Research Policy v1
 * Donation-only semantic routing helper.  It is intentionally permissive at
 * research time and strict only at the public-matching boundary.
 */

const VERSION = "donation-research-policy-v1.3.1-homepage-first-official-content-fallback";

let RESEARCH_FRAME = null;
try { RESEARCH_FRAME = require("../data/donation.research-frame.v1.json"); } catch (_error) { RESEARCH_FRAME = null; }

const SECTIONS = Object.freeze([
  "donation-global",
  "donation-ngo",
  "donation-mission",
  "donation-service",
  "donation-relief",
  "donation-education",
  "donation-environment",
  "donation-others"
]);

const SECTION_CAPACITY = Object.freeze({
  "donation-global":100,
  "donation-ngo":100,
  "donation-mission":100,
  "donation-service":100,
  "donation-relief":100,
  "donation-education":100,
  "donation-environment":100,
  "donation-others":100
});

const SECTION_LABELS = Object.freeze({
  "donation-global":"글로벌 뉴스",
  "donation-ngo":"NGO",
  "donation-mission":"선교",
  "donation-service":"봉사",
  "donation-relief":"구호",
  "donation-education":"교육",
  "donation-environment":"환경",
  "donation-others":"기타"
});

const ALIASES = Object.freeze({
  global:"donation-global", "global-news":"donation-global", global_news:"donation-global", news:"donation-global",
  ngo:"donation-ngo", nonprofit:"donation-ngo", charity:"donation-ngo",
  mission:"donation-mission", missions:"donation-mission", ministry:"donation-mission",
  service:"donation-service", volunteer:"donation-service", volunteering:"donation-service",
  relief:"donation-relief", humanitarian:"donation-relief", emergency:"donation-relief",
  education:"donation-education", school:"donation-education", university:"donation-education",
  environment:"donation-environment", climate:"donation-environment", conservation:"donation-environment",
  others:"donation-others", other:"donation-others", etc:"donation-others"
});

const POLICY = Object.freeze({
  "donation-global": {
    category:"global",
    researchTerms:[
      "humanitarian crisis disaster conflict displacement hunger children climate emergency video",
      "earthquake flood wildfire famine refugee civilian aid field report video",
      "humanitarian response children health education water sanitation climate impact footage"
    ],
    semanticHints:[
      "humanitarian","crisis","disaster","earthquake","flood","wildfire","drought","famine","hunger","food insecurity",
      "refugee","displacement","displaced","civilian","conflict","war","children","child","orphan","health","hospital",
      "education","school","water","sanitation","climate","environment","emergency","relief","aid","response","field report",
      "video","footage","broadcast","report","update"
    ],
    preferredKinds:["video","article","feed_item"],
    videoPreferred:true
  },
  "donation-ngo": {
    category:"ngo",
    researchTerms:[
      "international NGO nonprofit humanitarian development official organization",
      "UN agency international humanitarian organization charity development official",
      "global nonprofit aid development organization official website"
    ],
    semanticHints:["ngo","nonprofit","non-profit","charity","foundation","association","humanitarian","development","international","united nations","un agency","aid organization"]
  },
  "donation-mission": {
    category:"mission",
    researchTerms:[
      "Protestant evangelical Christian mission organization international official",
      "evangelical mission agency missions ministry Protestant official",
      "Christian medical mission campus mission Bible mission Protestant organization"
    ],
    semanticHints:["protestant","evangelical","christian mission","missions","mission agency","gospel","evangelism","missionary","campus ministry","bible translation","medical mission","church mission"],
    excludedHints:["catholic","roman catholic","orthodox church","mosque","islamic mission","temple","hindu mission","new religious movement","cult"]
  },
  "donation-service": {
    category:"service",
    researchTerms:[
      "Christian volunteer service organization housing wells medical community official",
      "faith based volunteer humanitarian service organization official",
      "volunteer medical housing clean water community development organization"
    ],
    semanticHints:["volunteer","service","community","medical","health","housing","habitat","well","clean water","water project","community development","welfare","support","shelter"]
  },
  "donation-relief": {
    category:"relief",
    researchTerms:[
      "humanitarian relief disaster emergency hunger refugee organization official",
      "Christian relief organization disaster response food aid refugee official",
      "emergency relief famine food security disaster response organization"
    ],
    semanticHints:["relief","disaster","emergency","humanitarian","rescue","famine","hunger","food aid","food security","refugee","displacement","earthquake","flood","war relief","disaster response"]
  },
  "donation-education": {
    category:"education",
    researchTerms:[
      "Christian education mission university children literacy organization official",
      "international education nonprofit school youth student training official",
      "campus ministry education literacy university mission organization"
    ],
    semanticHints:["education","school","student","youth","child","children","scholarship","university","college","training","literacy","campus","teacher","learning"]
  },
  "donation-environment": {
    category:"environment",
    researchTerms:[
      "Christian environmental stewardship conservation reforestation organization official",
      "faith based creation care climate conservation tree planting nonprofit",
      "Christian conservation reforestation biodiversity clean water stewardship organization"
    ],
    semanticHints:["environment","creation care","stewardship","climate","forest","reforestation","tree planting","ocean","wildlife","conservation","biodiversity","sustainability","clean water"],
    excludedHints:["political campaign","party campaign","election campaign","partisan"]
  },
  "donation-others": {
    category:"others",
    researchTerms:[
      "Christian nonprofit vulnerable people justice prison disability official organization",
      "faith based nonprofit legal aid human rights trafficking prison ministry official",
      "international charity vulnerable community disability justice organization official"
    ],
    semanticHints:["justice","legal aid","prison","prisoner","trafficking","disability","vulnerable","human rights","persecution","family support","elderly","widow","orphan"]
  }
});

function text(value){ return value == null ? "" : String(value).trim(); }
function lower(value){ return text(value).toLowerCase().replace(/\s+/g," "); }
function plain(value){ return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value){ return Array.isArray(value) ? value : (value == null || value === "" ? [] : [value]); }
function unique(values){ return Array.from(new Set(values.map(text).filter(Boolean))); }

function normalizeSection(value){
  const raw = lower(value).replace(/\s+/g,"-");
  if(SECTIONS.includes(raw)) return raw;
  const compact = raw.replace(/^donation[-_]?/,"").replace(/_/g,"-");
  return ALIASES[compact] || (ALIASES[raw] || "");
}
function categoryForSection(value){
  const section = normalizeSection(value);
  return section && POLICY[section] ? POLICY[section].category : "ngo";
}
function researchFrameFor(value){
  const section = normalizeSection(value) || "donation-ngo";
  const sections = plain(RESEARCH_FRAME && RESEARCH_FRAME.sections);
  const frame = plain(sections[section]);
  return {
    section,
    primaryQuery:text(frame.primaryQuery),
    freshnessHours:Number(frame.freshnessHours||0)||0,
    preferVideo:frame.preferVideo===true,
    localizeByIp:frame.localizeByIp===true,
    anchors:Array.isArray(frame.anchors) ? frame.anchors.map(a=>({name:text(a&&a.name),query:text(a&&a.query)})).filter(a=>a.name||a.query) : []
  };
}
function policyFor(value){
  const section = normalizeSection(value) || "donation-ngo";
  const frame = researchFrameFor(section);
  return Object.assign({ section, label:SECTION_LABELS[section] || section, researchTerms:[], semanticHints:[], excludedHints:[], preferredKinds:["organization","institution","campaign","article"] }, POLICY[section] || {}, { researchFrame:frame });
}
function recordText(record){
  const r=plain(record), source=plain(r.source), org=plain(r.org), entity=plain(r.entity), media=plain(r.media), collector=plain(r.collector);
  return lower([
    r.title,r.name,r.summary,r.description,r.about,r.content,r.category,r.semantic_category,r.type,r.mediaType,r.section,r.psom_key,
    org.name,org.legal_name,org.homepage,entity.type,entity.subtype,media.kind,media.type,media.url,media.src,
    source.name,source.platform,source.url,collector.query,r.url,r.link && r.link.url,
    ...array(r.tags),...array(r.keywords),...array(r.topics)
  ].filter(Boolean).join(" "));
}
function countHints(blob,hints){
  let score=0;
  for(const hint of hints||[]){ if(hint && blob.includes(lower(hint))) score += hint.includes(" ") ? 2 : 1; }
  return score;
}
function youtubeId(value){
  const raw=text(value); if(!raw) return "";
  try{
    const u=new URL(raw, "https://igdc.invalid"); const host=u.hostname.replace(/^www\./,"").toLowerCase();
    if(host==="youtu.be") return (u.pathname.split("/").filter(Boolean)[0]||"").slice(0,40);
    if(host.endsWith("youtube.com")){
      if(u.searchParams.get("v")) return text(u.searchParams.get("v")).slice(0,40);
      const parts=u.pathname.split("/").filter(Boolean); if(["shorts","embed","live"].includes(parts[0])) return text(parts[1]).slice(0,40);
    }
  }catch(_e){}
  return "";
}
function candidateUrls(record){
  const r=plain(record), media=plain(r.media), link=plain(r.link), org=plain(r.org), donation=plain(r.donation), source=plain(r.source);
  return unique([
    r.video,r.videoUrl,r.embedUrl,media.src,media.url,media.embedUrl,
    org.homepage,org.website,r.homepage,r.website,r.official_url,r.officialUrl,r.organizationUrl,r.siteUrl,
    link.url,r.url,r.pageUrl,r.page_url,r.sourcePageUrl,r.source_page_url,source.url,donation.checkout_url
  ]);
}
function httpsUrl(value){
  const raw=text(value); if(!/^https:\/\//i.test(raw)) return "";
  try{ const u=new URL(raw); return u.protocol==="https:" ? u.toString() : ""; }catch(_e){ return ""; }
}
function urlHost(value){
  const raw=httpsUrl(value); if(!raw) return "";
  try{ return new URL(raw).hostname.toLowerCase().replace(/^www\./,""); }catch(_e){ return ""; }
}
function isSearchLandingUrl(value){
  const raw=httpsUrl(value); if(!raw) return true;
  try{
    const u=new URL(raw), host=u.hostname.toLowerCase().replace(/^www\./,""), path=u.pathname.toLowerCase();
    if((host==="google.com"||host.endsWith(".google.com"))&&(path==="/search"||path.startsWith("/maps/search"))) return true;
    if((host==="bing.com"||host.endsWith(".bing.com"))&&path.startsWith("/search")) return true;
    if(host==="search.yahoo.com"||host.endsWith(".search.yahoo.com")) return true;
    if(host==="duckduckgo.com"||host.endsWith(".duckduckgo.com")) return true;
    if(host==="search.naver.com"||host.endsWith(".search.naver.com")) return true;
    if((host==="map.naver.com"||host.endsWith(".map.naver.com"))&&path.startsWith("/p/search")) return true;
    if((host==="yandex.com"||host.endsWith(".yandex.com"))&&path.startsWith("/search")) return true;
    if((host==="youtube.com"||host.endsWith(".youtube.com"))&&(path==="/results"||u.searchParams.has("search_query"))) return true;
    return false;
  }catch(_e){ return true; }
}
function isVideoUrl(value){
  const raw=httpsUrl(value); if(!raw) return false;
  const host=urlHost(raw);
  if(host==="youtu.be"||host==="youtube.com"||host.endsWith(".youtube.com")||host==="vimeo.com"||host.endsWith(".vimeo.com")) return true;
  try{ return /\.(?:mp4|webm|m3u8|mov)(?:$|[?#])/i.test(new URL(raw).pathname); }catch(_e){ return false; }
}
function isSocialUrl(value){
  const host=urlHost(value); if(!host) return false;
  return /^(?:m\.)?(?:facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|threads\.net|reddit\.com|pinterest\.com|weibo\.com)$/.test(host) ||
    /\.(?:facebook\.com|instagram\.com|tiktok\.com|twitter\.com|reddit\.com|pinterest\.com|weibo\.com)$/.test(host);
}
function isDirectMediaAssetUrl(value){
  const raw=httpsUrl(value); if(!raw) return false;
  try{ return /\.(?:jpg|jpeg|png|gif|webp|svg|avif|mp4|webm|mov|m3u8|mp3|wav)(?:$|[?#])/i.test(new URL(raw).pathname); }catch(_e){ return false; }
}
function organizationWebsiteUrls(record){
  const r=plain(record), media=plain(r.media), link=plain(r.link), org=plain(r.org), source=plain(r.source), entity=plain(r.entity);
  return unique([
    org.homepage,org.website,entity.homepage,entity.website,
    r.homepage,r.website,r.official_url,r.officialUrl,r.organizationUrl,r.organization_url,r.siteUrl,r.site_url,
    link.url,r.url,r.pageUrl,r.page_url,r.sourcePageUrl,r.source_page_url,r.contextLink,r.originalPageUrl,r.original_page_url,
    source.url,
    /* Some SearchBank result shapes store the destination under media.pageUrl, never use media.src as a website. */
    media.pageUrl,media.page_url
  ]);
}
function isOrganizationWebsiteUrl(value){
  const raw=httpsUrl(value); if(!raw) return false;
  if(isSearchLandingUrl(raw)||isVideoUrl(raw)||isSocialUrl(raw)||isDirectMediaAssetUrl(raw)) return false;
  return true;
}
function organizationHomepageUrl(record){
  for(const value of organizationWebsiteUrls(record)){
    const u=httpsUrl(value); if(u&&isOrganizationWebsiteUrl(u)) return u;
  }
  return "";
}
function candidateUrlForSection(record, sectionValue){
  const section=normalizeSection(sectionValue)||inferSection(record);
  if(section==="donation-global"){
    for(const value of candidateUrls(record)){
      const u=httpsUrl(value); if(u&&!isSearchLandingUrl(u)&&!isDirectMediaAssetUrl(u)) return u;
    }
    return "";
  }
  /* The seven organization lanes are HOMEPAGE-FIRST, not video-blocked.
     Always choose a real organization/institution webpage when one is present.
     Only when no such webpage can be resolved do we keep an official video,
     social/channel, or other HTTPS content page as a lower-priority fallback. */
  const homepage=organizationHomepageUrl(record);
  if(homepage) return homepage;
  for(const value of candidateUrls(record)){
    const u=httpsUrl(value);
    if(u&&!isSearchLandingUrl(u)&&!isDirectMediaAssetUrl(u)) return u;
  }
  return "";
}
function hasVideoDestination(record){
  const r=plain(record), media=plain(r.media), link=plain(r.link);
  const kind=lower(r.type||r.mediaType||media.kind||media.type);
  if(["video","clip","broadcast","stream"].includes(kind)) return true;
  return unique([r.video,r.videoUrl,r.embedUrl,media.src,media.url,media.embedUrl,r.url,link.url]).some(isVideoUrl);
}
function representativeImageForSection(record, sectionValue){
  const r=plain(record), media=plain(r.media), org=plain(r.org), section=normalizeSection(sectionValue)||inferSection(record);
  const websiteValues=[
    r.og_image,r.ogImage,r.twitter_image,r.twitterImage,r.thumbnail,r.thumb,r.image,
    media.image,media.thumb,media.poster,org.logo,org.logo_url,r.logo,r.logo_url
  ];
  const mediaValues=[media.thumb,media.image,media.poster,r.thumbnail,r.thumb,r.image,r.og_image,r.ogImage,r.logo,r.logo_url,youtubeThumbnail(r)];
  const hasHomepage=section!=="donation-global"&&!!organizationHomepageUrl(r);
  const values=section==="donation-global"?mediaValues:(hasHomepage?websiteValues:websiteValues.concat(mediaValues));
  for(const value of values){
    const u=httpsUrl(value); if(!u||/placeholder|sample/i.test(u)) continue;
    /* When a normal homepage exists, keep its representative image/logo ahead
       of video thumbnails.  If no homepage exists, an official video/channel
       thumbnail is a valid fallback instead of discarding the organization. */
    if(hasHomepage&&/(?:i\.ytimg\.com|img\.youtube\.com)\//i.test(u)) continue;
    return u;
  }
  return "";
}
function looksLikeVideo(record){
  const r=plain(record), media=plain(r.media), entity=plain(r.entity);
  const kind=lower(r.type||r.mediaType||media.kind||media.type||entity.type);
  if(["video","clip","broadcast","stream"].includes(kind)) return true;
  if(candidateUrls(r).some(u=>youtubeId(u) || /vimeo\.com|\.mp4(?:$|\?)|\.webm(?:$|\?)/i.test(u))) return true;
  return /\b(video|footage|broadcast|clip|watch|live report)\b/.test(recordText(r));
}
function excludedHintMatch(blob, hint){
  const value=lower(blob), token=lower(hint);
  if(!value || !token) return false;
  // Exclusion terms must match words/phrases, not substrings.  For example,
  // the word `cult` must never reject a legitimate `cross-cultural` mission.
  const escaped=token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");
  try { return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`,"i").test(value); }
  catch(_e){ return value===token; }
}
function missionExcluded(record){
  const blob=recordText(record), policy=POLICY["donation-mission"];
  return (policy.excludedHints||[]).some(h=>excludedHintMatch(blob,h));
}
function sectionRelevance(record, sectionValue){
  const section=normalizeSection(sectionValue) || normalizeSection(record && (record.psom_key||record.section||record.bind&&record.bind.section)) || "donation-ngo";
  const policy=policyFor(section), blob=recordText(record);
  const semanticMatches=countHints(blob,policy.semanticHints);
  let score=semanticMatches*8;
  const explicit=normalizeSection(record && (record.psom_key||record.section||record.bind&&record.bind.section));
  // The requested/front section is routing metadata, not proof that the content
  // is relevant.  Keep a small tie-breaker for global news and a stronger one
  // for curated organization lanes.  This prevents an unrelated video from
  // passing the global lane merely because SearchBank queried that lane.
  if(explicit===section) score += section==="donation-global" ? 2 : 24;
  if(section==="donation-global" && semanticMatches>0 && looksLikeVideo(record)) score+=18;
  if(section!=="donation-global" && organizationHomepageUrl(record)) score+=32;
  if(section==="donation-mission" && missionExcluded(record)) score-=100;
  if((policy.excludedHints||[]).some(h=>excludedHintMatch(blob,h))) score-=40;
  const source=plain(record&&record.source); const authority=Number(source.authority||record&&record.authority||0);
  if(Number.isFinite(authority)) score += Math.max(0,Math.min(1,authority))*12;
  return Math.round(score*100)/100;
}
function inferSection(record, fallback){
  const explicit=normalizeSection(record && (record.psom_key||record.section||record.ui_section||record.bind&&record.bind.section||record.psom_mapping&&record.psom_mapping.section));
  if(explicit) return explicit;
  const hint=normalizeSection(record && (record.category||record.semantic_category||record.type_category));
  if(hint) return hint;
  let best=normalizeSection(fallback)||"donation-ngo", bestScore=0;
  for(const section of SECTIONS){
    const score=sectionRelevance(record,section);
    if(score>bestScore){best=section;bestScore=score;}
  }
  return best;
}
function queryTerms(sectionValue, customQuery){
  const policy=policyFor(sectionValue), frame=policy.researchFrame||researchFrameFor(sectionValue), custom=text(customQuery);
  const frameTerms=[];
  if(frame.primaryQuery) frameTerms.push(frame.primaryQuery);
  (frame.anchors||[]).forEach(a=>{ if(a.query) frameTerms.push(a.query); });
  const base=unique(frameTerms.concat(policy.researchTerms||[]));
  if(custom) return unique([custom].concat(base));
  return base;
}
function researchAnchors(sectionValue){
  return researchFrameFor(sectionValue).anchors.slice();
}
function isPlaceholder(record){
  const r=plain(record), blob=recordText(r), urls=candidateUrls(r);
  const image=text(r.thumbnail||r.thumb||r.image||plain(r.media).thumb);
  if(/\b(seed placeholder|placeholder|sample item|donation partner \d+|global donation news \d+)\b/.test(blob)) return true;
  if(urls.length && urls.every(u=>u==="#"||u==="/"||/placeholder|sample|example\.com/i.test(u))) return true;
  if(!urls.length && /\b(seed|sample|placeholder)\b/.test(blob)) return true;
  if(image && /placeholder|sample-card/i.test(image) && /\b(seed|sample|partner \d+)\b/.test(blob)) return true;
  return false;
}
function usablePublicCandidate(record, sectionValue){
  if(!record || isPlaceholder(record)) return false;
  const section=normalizeSection(sectionValue)||inferSection(record);
  if(section==="donation-mission" && missionExcluded(record)) return false;
  const destination=candidateUrlForSection(record,section);
  if(!destination) return false;
  const representativeImage=representativeImageForSection(record,section);
  if(!representativeImage) return false;
  const title=text(record.title||record.name||plain(record.org).name);
  if(!title) return false;
  if(section==="donation-global"){
    // Global News is the one video lane: require both an actual video destination
    // and a humanitarian/disaster/environment relevance signal.
    if(!looksLikeVideo(record)) return false;
    const blob=recordText(record), policy=policyFor(section);
    const genericMediaHints=new Set(["video","footage","broadcast","report","update","field report"]);
    const humanitarianHints=(policy.semanticHints||[]).filter(h=>!genericMediaHints.has(lower(h)));
    return countHints(blob,humanitarianHints)>0;
  }
  /* The seven organization lanes are homepage-first.  A missing homepage does
     not hard-block an otherwise relevant official video/channel/content page;
     it simply ranks behind candidates that have a resolvable homepage. */
  if(isSearchLandingUrl(destination)||isDirectMediaAssetUrl(destination)) return false;
  return sectionRelevance(record,section)>-10;
}
function youtubeThumbnail(record){
  for(const u of candidateUrls(record)){
    const id=youtubeId(u); if(id) return "https://i.ytimg.com/vi/"+encodeURIComponent(id)+"/hqdefault.jpg";
  }
  return "";
}

module.exports={
  VERSION,SECTIONS,SECTION_CAPACITY,SECTION_LABELS,POLICY,normalizeSection,categoryForSection,policyFor,researchFrameFor,researchAnchors,recordText,looksLikeVideo,youtubeId,youtubeThumbnail,
  missionExcluded,sectionRelevance,inferSection,queryTerms,isPlaceholder,usablePublicCandidate,candidateUrls,
  organizationWebsiteUrls,organizationHomepageUrl,isSearchLandingUrl,isVideoUrl,isSocialUrl,isDirectMediaAssetUrl,isOrganizationWebsiteUrl,candidateUrlForSection,hasVideoDestination,representativeImageForSection
};
