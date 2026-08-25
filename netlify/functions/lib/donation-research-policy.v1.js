"use strict";

/*
 * Donation Research Policy v1
 * Donation-only semantic routing helper.  It is intentionally permissive at
 * research time and strict only at the public-matching boundary.
 */

const VERSION = "donation-research-policy-v1.1.0-admin-directed-research";

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
  "donation-ngo":80,
  "donation-mission":80,
  "donation-service":80,
  "donation-relief":80,
  "donation-education":80,
  "donation-environment":80,
  "donation-others":80
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
      "latest humanitarian disaster earthquake flood wildfire conflict refugee hunger children health climate emergency video field report",
      "breaking earthquake flood wildfire famine refugee civilian aid humanitarian response video official news",
      "humanitarian crisis environment climate disaster relief children water sanitation health education current video"
    ],
    semanticHints:[
      "humanitarian","crisis","disaster","earthquake","flood","wildfire","drought","famine","hunger","food insecurity",
      "refugee","displacement","displaced","civilian","conflict","war","children","child","orphan","health","hospital",
      "education","school","water","sanitation","climate","environment","emergency","relief","aid","response","field report",
      "video","footage","broadcast","report","update","breaking","latest"
    ],
    preferredKinds:["video","broadcast","article","feed_item"],
    videoPreferred:true,
    freshnessHours:48
  },
  "donation-ngo": {
    category:"ngo",
    researchTerms:[
      "KOICA United Nations UNDP UNICEF international development aid NGO official website",
      "Good Neighbors international NGO humanitarian development poverty official organization",
      "international NGO public aid agency nonprofit humanitarian development global official website"
    ],
    semanticHints:[
      "ngo","nonprofit","non-profit","charity","foundation","association","humanitarian","development","international",
      "united nations","un agency","public aid","development agency","official organization","poverty","food security","global aid",
      "koica","good neighbors","undp","unicef","unhcr"
    ],
    preferredKinds:["organization","institution","official_site"]
  },
  "donation-mission": {
    category:"mission",
    researchTerms:[
      "Lausanne Movement PAUA Pan Asia Africa Universities Association Protestant evangelical mission official",
      "Campus Crusade for Christ CCC InterVarsity IVF Child Evangelism Fellowship mission official",
      "Protestant evangelical Christian mission organization campus ministry Bible mission official local country"
    ],
    semanticHints:[
      "protestant","evangelical","christian mission","missions","mission agency","gospel","evangelism","missionary","campus ministry",
      "bible translation","medical mission","church mission","lausanne","paua","campus crusade","ccc","intervarsity","ivf","child evangelism fellowship"
    ],
    excludedHints:["catholic","roman catholic","orthodox church","mosque","islamic mission","temple","hindu mission","new religious movement","cult"],
    preferredKinds:["organization","institution","official_site"],
    ipLocalized:true
  },
  "donation-service": {
    category:"service",
    researchTerms:[
      "Christian volunteer service organization community medical housing clean water official website",
      "Habitat for Humanity Christian volunteer community service official organization",
      "faith based volunteer service medical housing wells community development organization official"
    ],
    semanticHints:[
      "volunteer","service","community","medical","health","housing","habitat","well","clean water","water project","community development",
      "welfare","support","shelter","volunteer corps","service organization","faith based"
    ],
    preferredKinds:["organization","institution","official_site"]
  },
  "donation-relief": {
    category:"relief",
    researchTerms:[
      "World Vision Food for the Hungry Samaritan's Purse humanitarian relief official website",
      "Christian relief disaster emergency hunger refugee organization official",
      "emergency relief famine food security disaster response refugee aid official organization"
    ],
    semanticHints:[
      "relief","disaster","emergency","humanitarian","rescue","famine","hunger","food aid","food security","refugee","displacement",
      "earthquake","flood","war relief","disaster response","world vision","food for the hungry","samaritan's purse"
    ],
    preferredKinds:["organization","institution","official_site"]
  },
  "donation-education": {
    category:"education",
    researchTerms:[
      "4/14 Window Christian education children youth mission official organization",
      "Christian education mission university children literacy scholarship training official",
      "international Christian education nonprofit school youth student campus training official"
    ],
    semanticHints:[
      "education","school","student","youth","child","children","scholarship","university","college","training","literacy","campus","teacher","learning",
      "4/14 window","four fourteen window","christian education"
    ],
    preferredKinds:["organization","institution","official_site"]
  },
  "donation-environment": {
    category:"environment",
    researchTerms:[
      "A Rocha Christian environmental conservation creation care official organization",
      "Plant With Purpose Christian reforestation poverty environment official organization",
      "Christian environmental stewardship conservation reforestation clean water biodiversity official"
    ],
    semanticHints:[
      "environment","creation care","stewardship","climate","forest","reforestation","tree planting","ocean","wildlife","conservation","biodiversity",
      "sustainability","clean water","a rocha","plant with purpose"
    ],
    excludedHints:["political campaign","party campaign","election campaign","partisan"],
    preferredKinds:["organization","institution","official_site"]
  },
  "donation-others": {
    category:"others",
    researchTerms:[
      "Christian nonprofit vulnerable people disability anti trafficking prison ministry official organization",
      "faith based nonprofit legal aid human rights persecution family support official organization",
      "international Christian charity vulnerable community disability justice elderly widow orphan official"
    ],
    semanticHints:[
      "justice","legal aid","prison","prisoner","trafficking","disability","vulnerable","human rights","persecution","family support","elderly","widow","orphan","faith based","christian nonprofit"
    ],
    preferredKinds:["organization","institution","official_site"]
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
function policyFor(value){
  const section = normalizeSection(value) || "donation-ngo";
  return Object.assign({ section, label:SECTION_LABELS[section] || section, researchTerms:[], semanticHints:[], excludedHints:[], preferredKinds:["organization","institution","campaign","article"] }, POLICY[section] || {});
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
  const r=plain(record), media=plain(r.media), link=plain(r.link), org=plain(r.org), donation=plain(r.donation);
  return unique([r.video,r.videoUrl,r.embedUrl,media.src,media.url,media.embedUrl,r.url,link.url,org.homepage,donation.checkout_url]);
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
  const policy=policyFor(sectionValue); const custom=text(customQuery);
  if(custom) return unique([custom].concat(policy.researchTerms.slice(0,2)));
  return policy.researchTerms.slice();
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
  const urls=candidateUrls(record).filter(u=>/^https:\/\//i.test(u));
  if(!urls.length) return false;
  const title=text(record.title||record.name||plain(record.org).name);
  if(!title) return false;
  if(section==="donation-global"){
    // Research is permissive, but publication requires at least one semantic
    // humanitarian signal.  Video is preferred later in ranking; it is not by
    // itself proof of relevance.  This remains label-agnostic because the match
    // scans title/summary/tags/source/URL metadata, not an exact `news` field.
    const blob=recordText(record), policy=policyFor(section);
    const genericMediaHints=new Set(["video","footage","broadcast","report","update","field report"]);
    const humanitarianHints=(policy.semanticHints||[]).filter(h=>!genericMediaHints.has(lower(h)));
    return countHints(blob,humanitarianHints)>0;
  }
  return sectionRelevance(record,section)>-10;
}
function youtubeThumbnail(record){
  for(const u of candidateUrls(record)){
    const id=youtubeId(u); if(id) return "https://i.ytimg.com/vi/"+encodeURIComponent(id)+"/hqdefault.jpg";
  }
  return "";
}

module.exports={
  VERSION,SECTIONS,SECTION_CAPACITY,SECTION_LABELS,POLICY,normalizeSection,categoryForSection,policyFor,recordText,looksLikeVideo,youtubeId,youtubeThumbnail,
  missionExcluded,sectionRelevance,inferSection,queryTerms,isPlaceholder,usablePublicCandidate,candidateUrls
};
