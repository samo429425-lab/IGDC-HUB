"use strict";

/*
 * Donation Candidate Admin v1
 * Private, administrator-only staging pipeline:
 * research -> section queue -> front candidate -> published.
 *
 * Persistence is isolated by source_ref inside the existing gslot_candidates
 * ledger. It never edits SearchBank snapshot JSON files directly. Final matching
 * asks the existing SearchBank Engine to run its own normal write/sync pipeline.
 */

const crypto = require("crypto");
const AdminAuth = require("./lib/global-slot-console-auth");
const Store = require("./lib/global-slot-console-supabase");
const Policy = require("./lib/donation-research-policy.v1");
const PolicyDiscussion = require("./lib/donation-policy-discussion.v1");
let SearchBank = null;
try { SearchBank = require("./search-bank-engine"); } catch (_error) { SearchBank = null; }

const VERSION = "donation-candidate-admin-v1.6.0-official-homepage-preview-cleanup";
const SOURCE_REF = "donation-candidate-admin-v1";
const READ_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director","donation_manager","social_manager","media_manager","commerce_manager"]);
const WRITE_ROLES = new Set(["owner","admin","super_admin","site_manager_director","director","donation_manager"]);
const CAPACITY = Policy.SECTION_CAPACITY;
const STAGES = new Set(["research","queue","front_candidate","published","hold","excluded"]);

function text(value){ return value == null ? "" : String(value).trim(); }
function lower(value){ return text(value).toLowerCase().replace(/[\s.]+/g,"_"); }
function plain(value){ return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value){ return Array.isArray(value) ? value : (value == null ? [] : [value]); }
function nowIso(){ return new Date().toISOString(); }
function sha(value){ return crypto.createHash("sha256").update(String(value||"")).digest("hex"); }
function json(statusCode,body){ return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"GET,POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)}; }
function parse(event){ try{return event&&event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body):{};}catch(_error){const error=new Error("요청 JSON 형식이 올바르지 않습니다.");error.statusCode=400;throw error;} }
function roleList(actor){ return Array.from(new Set(array(actor&&actor.roles).map(lower).filter(Boolean))); }
function requireRole(actor,write){ const allow=write?WRITE_ROLES:READ_ROLES;if(!roleList(actor).some(r=>allow.has(r))){const e=new Error(write?"도네이션 후보 변경 권한이 없습니다.":"도네이션 후보 조회 권한이 없습니다.");e.statusCode=403;throw e;} }
function limitText(value,max){ const v=text(value); return v.length>max?v.slice(0,max):v; }
function safeHttps(value){ const v=text(value); if(!/^https:\/\//i.test(v)) return ""; try{const u=new URL(v);return u.protocol==="https:"?u.toString():"";}catch(_e){return "";} }
function sourceName(item){ const s=plain(item&&item.source); return limitText(s.name||item&&item.source_name||item&&item.sourceAdapter||item&&item.source_adapter||item&&item.collector&&item.collector.engine||"SearchBank",160); }

const homepagePreviewCache=new Map();
function decodeHtml(value){
  return text(value)
    .replace(/&#x([0-9a-f]+);/gi,function(_m,h){try{return String.fromCodePoint(parseInt(h,16));}catch(_e){return _m;}})
    .replace(/&#(\d+);/g,function(_m,d){try{return String.fromCodePoint(parseInt(d,10));}catch(_e){return _m;}})
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ').trim();
}
function stripTags(value){ return decodeHtml(text(value).replace(/<[^>]*>/g,' ')); }
function attrValue(tag,name){ const m=text(tag).match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(["\\\'])([\\s\\S]*?)\\1','i')); return m?decodeHtml(m[2]):''; }
function homepageMeta(html){
  const meta=Object.create(null), tags=text(html).match(/<meta\b[^>]*>/gi)||[];
  tags.forEach(function(tag){const key=(attrValue(tag,'property')||attrValue(tag,'name')||attrValue(tag,'itemprop')).toLowerCase(),content=attrValue(tag,'content');if(key&&content&&!meta[key])meta[key]=content;});
  return meta;
}
function firstMeta(meta,keys){ for(const key of keys){const v=text(meta&&meta[key]);if(v)return v;} return ''; }
function resolveHttps(base,value){
  try{const u=new URL(text(value),base);return u.protocol==='https:'?u.toString():'';}catch(_e){return '';}
}
function publicPreviewHost(homepage){
  try{
    const u=new URL(homepage),host=u.hostname.toLowerCase();
    if(host==='localhost'||host.endsWith('.local')||host==='0.0.0.0'||host==='::1')return false;
    if(/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host))return false;
    const m=host.match(/^172\.(\d+)\./);if(m&&Number(m[1])>=16&&Number(m[1])<=31)return false;
    return true;
  }catch(_e){return false;}
}
function homepageTitle(html,meta){
  const og=firstMeta(meta,['og:title','twitter:title']);if(og)return stripTags(og);
  const m=text(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);return m?stripTags(m[1]):'';
}
function homepageDescription(meta){ return stripTags(firstMeta(meta,['og:description','twitter:description','description'])); }
function homepageImage(html,meta,base){
  const direct=firstMeta(meta,['og:image:secure_url','og:image','twitter:image','twitter:image:src','thumbnailurl','thumbnail','image']);
  let out=resolveHttps(base,direct);if(out)return out;
  const links=text(html).match(/<link\b[^>]*>/gi)||[];
  for(const tag of links){
    const rel=lower(attrValue(tag,'rel')); if(!/(?:apple-touch-icon|icon|image_src)/.test(rel))continue;
    out=resolveHttps(base,attrValue(tag,'href'));if(out)return out;
  }
  const imgs=text(html).match(/<img\b[^>]*>/gi)||[];
  for(const tag of imgs){
    const marker=lower([attrValue(tag,'id'),attrValue(tag,'class'),attrValue(tag,'alt')].join(' '));
    if(!/(?:logo|brand|header)/.test(marker))continue;
    out=resolveHttps(base,attrValue(tag,'src')||attrValue(tag,'data-src')||attrValue(tag,'data-lazy-src'));if(out)return out;
  }
  return '';
}
async function fetchHomepagePreview(homepage,timeoutMs){
  const canonical=safeHttps(Policy.canonicalOrganizationHomepageUrl?Policy.canonicalOrganizationHomepageUrl(homepage):homepage);
  if(!canonical||!publicPreviewHost(canonical))return {homepage:canonical||'',title:'',description:'',image:'',resolved:false};
  if(homepagePreviewCache.has(canonical))return homepagePreviewCache.get(canonical);
  const promise=(async function(){
    const controller=typeof AbortController==='function'?new AbortController():null;
    const previewTimeout=Math.max(650,Math.min(1800,Number(timeoutMs)||1400));
    const timer=controller?setTimeout(function(){try{controller.abort();}catch(_e){}},previewTimeout):null;
    try{
      const res=await fetch(canonical,{method:'GET',redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36','accept':'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2','accept-language':'en-US,en;q=0.8'},signal:controller?controller.signal:undefined});
      if(!res||!res.ok)return {homepage:canonical,title:'',description:'',image:'',resolved:false,status:res&&res.status||0};
      const ctype=lower(res.headers&&res.headers.get&&res.headers.get('content-type'));if(ctype&&ctype.indexOf('html')<0)return {homepage:canonical,title:'',description:'',image:'',resolved:false,status:res.status};
      let html=await res.text();if(html.length>650000)html=html.slice(0,650000);
      const finalHome=safeHttps(Policy.canonicalOrganizationHomepageUrl?Policy.canonicalOrganizationHomepageUrl(res.url||canonical):canonical)||canonical;
      const meta=homepageMeta(html),image=homepageImage(html,meta,res.url||finalHome);
      return {homepage:finalHome,title:limitText(homepageTitle(html,meta),300),description:limitText(homepageDescription(meta),1800),image:safeHttps(image),resolved:!!image,status:res.status};
    }catch(error){return {homepage:canonical,title:'',description:'',image:'',resolved:false,error:text(error&&error.name||error)};}
    finally{if(timer)clearTimeout(timer);}
  })();
  homepagePreviewCache.set(canonical,promise);
  return promise;
}
async function mapLimit(items,limit,worker){
  const list=Array.isArray(items)?items:[],out=new Array(list.length);let cursor=0;
  async function run(){for(;;){const i=cursor++;if(i>=list.length)return;out[i]=await worker(list[i],i);}}
  await Promise.all(Array.from({length:Math.max(1,Math.min(Number(limit)||1,list.length||1))},run));return out;
}
function researchQuery(section,customQuery){
  const sec=Policy.normalizeSection(section)||'donation-ngo',frame=Policy.researchFrameFor?Policy.researchFrameFor(sec):{},custom=text(customQuery);
  if(custom)return custom+(sec==='donation-global'?' latest humanitarian disaster video':' official website homepage');
  const names=(frame.anchors||[]).map(function(a){return text(a&&a.name);}).filter(Boolean).slice(0,7);
  const anchorQuery=names.map(function(name){return '"'+name.replace(/"/g,'')+'"';}).join(' OR ');
  /* One bounded SearchBank call per lane: OR the known organization anchors so
     the web/video provider can return distinct official entities without the old
     six sequential calls that caused serverless inactivity timeouts. */
  if(sec==='donation-global')return [anchorQuery,text(frame.primaryQuery),'latest official humanitarian video'].filter(Boolean).join(' ');
  return [anchorQuery,text(frame.primaryQuery),'official website homepage'].filter(Boolean).join(' ')||Policy.SECTION_LABELS[sec]||'donation';
}
function policyVisibleCandidate(candidate,section){
  const sec=Policy.normalizeSection(section)||Policy.inferSection(candidate||{},section);
  if(!sec)return false;
  try{return Policy.usablePublicCandidate(candidate||{},sec);}catch(_e){return false;}
}
async function purgePolicyViolations(){
  const rows=await readRows(),bad=[];
  for(const row of rows){const view=rowView(row);if(!policyVisibleCandidate(view.candidate,view.section))bad.push(view.id);}
  let removed=0;
  for(let i=0;i<bad.length;i+=75){
    const ids=bad.slice(i,i+75).filter(function(id){return /^[A-Za-z0-9_-]+$/.test(id);});if(!ids.length)continue;
    const q='source_ref=eq.'+encodeURIComponent(SOURCE_REF)+'&id=in.('+ids.map(encodeURIComponent).join(',')+')';
    const result=await Store.remove('gslot_candidates',q);removed+=Array.isArray(result)?result.length:ids.length;
  }
  return {examined:rows.length,violations:bad.length,removed};
}
function isSearchLandingUrl(value){
  const u=safeHttps(value); if(!u) return true;
  try{
    const parsed=new URL(u), host=parsed.hostname.toLowerCase().replace(/^www\./,""), path=parsed.pathname.toLowerCase();
    if((host==="google.com"||host.endsWith(".google.com"))&&(path==="/search"||path.startsWith("/maps/search"))) return true;
    if((host==="bing.com"||host.endsWith(".bing.com"))&&path.startsWith("/search")) return true;
    if(host==="search.yahoo.com"||host.endsWith(".search.yahoo.com")) return true;
    if(host==="duckduckgo.com"||host.endsWith(".duckduckgo.com")) return true;
    if(host==="search.naver.com"||host.endsWith(".search.naver.com")) return true;
    if((host==="map.naver.com"||host.endsWith(".map.naver.com"))&&path.startsWith("/p/search")) return true;
    if((host==="yandex.com"||host.endsWith(".yandex.com"))&&path.startsWith("/search")) return true;
    if((host==="youtube.com"||host.endsWith(".youtube.com"))&&(path==="/results"||parsed.searchParams.has("search_query"))) return true;
    return false;
  }catch(_e){ return true; }
}
function candidateUrl(item,section){
  const raw=plain(item), source=plain(raw.source);
  const sourceType=lower(raw.sourceType||raw.source_type||source.type||source.sourceType||"");
  const provider=lower(raw.provider||raw.source_adapter||raw.sourceAdapter||source.name||"");
  if(sourceType==="search_link"||sourceType==="search-link"||/(?:^|_)(?:search_link|discovery|public_search|passthrough|provider_lane)(?:_|$)/.test(provider)) return "";
  if(Policy.candidateUrlForSection){
    return safeHttps(Policy.candidateUrlForSection(raw,section));
  }
  for(const value of Policy.candidateUrls(raw)){
    const u=safeHttps(value); if(u&&!isSearchLandingUrl(u)) return u;
  }
  return "";
}
function candidateThumb(item,section){
  if(Policy.representativeImageForSection){
    const u=safeHttps(Policy.representativeImageForSection(item,section));
    if(u) return u;
  }
  const r=plain(item), media=plain(r.media);
  const values=[media.thumb,media.image,r.thumbnail,r.thumb,r.image,r.og_image,r.logo,r.logo_url,Policy.youtubeThumbnail(r)];
  for(const value of values){ const u=safeHttps(value); if(u && !/placeholder|sample/i.test(u)) return u; }
  return "";
}
function sectionOf(item,fallback){ return Policy.normalizeSection(item&& (item.psom_key||item.section||item.bind&&item.bind.section)) || Policy.normalizeSection(fallback) || Policy.inferSection(item,fallback); }
function stageOfPayload(payload){ const q=plain(payload&&payload.donationQueue); const stage=lower(q.stage); return STAGES.has(stage)?stage:"research"; }
function idFor(section,url,title){ return "donation_"+sha([section,url,text(title).toLowerCase()].join("|")).slice(0,28); }
function statusForStage(stage){ if(stage==="hold") return "hold"; if(stage==="excluded") return "suppressed"; if(stage==="front_candidate"||stage==="published") return "enrollable"; return "approval_pending"; }
function normalizeCandidate(item,section,query){
  const raw=plain(item), org=plain(raw.org), media=plain(raw.media), source=plain(raw.source);
  const resolved=sectionOf(raw,section), url=candidateUrl(raw,resolved), title=limitText(raw.title||raw.name||org.name||url,300), thumb=candidateThumb(raw,resolved);
  const rawIsVideo=Policy.looksLikeVideo(raw), isVideo=resolved==="donation-global"&&rawIsVideo, relevance=Policy.sectionRelevance(raw,resolved);
  const homepage=safeHttps(Policy.organizationHomepageUrl?Policy.organizationHomepageUrl(raw):"");
  const homepageFirst=resolved!=="donation-global"&&!!homepage;
  const publishedAt=raw.published_at||raw.publishedAt||raw.datePublished||null;
  let freshnessBonus=0;
  if(resolved==="donation-global"&&publishedAt){
    const ts=Date.parse(publishedAt);
    if(Number.isFinite(ts)){
      const ageHours=Math.max(0,(Date.now()-ts)/3600000);
      freshnessBonus=ageHours<=24?100:ageHours<=48?70:ageHours<=72?30:ageHours<=168?5:-40;
    }
  }
  const frontRank=relevance+(thumb?20:0)+(resolved==="donation-global"&&isVideo?50:0)+(homepageFirst?90:0)+freshnessBonus;
  const id=idFor(resolved,url,title);
  const candidate={
    id,title,
    summary:limitText(raw.summary||raw.description||raw.about||"",1800),
    url,
    thumbnail:thumb,
    channel:"donation",page:"donation",section:resolved,psom_key:resolved,
    category:Policy.categoryForSection(resolved),
    type:isVideo?"video":"organization",
    media:{kind:isVideo?"video":"image",src:isVideo?url:null,thumb:thumb||null,ratio:isVideo?"16:9":"1:1"},
    org:{name:limitText(org.name||raw.name||title,300)||null,legal_name:limitText(org.legal_name||raw.legal_name||"",300)||null,homepage:(resolved==="donation-global"?safeHttps(org.homepage||raw.homepage||raw.website):homepage)||null,country:text(org.country||raw.country)||null},
    source:{name:sourceName(raw),url:safeHttps(source.url||raw.sourceUrl||raw.source_url||url)||url,authority:Number(source.authority||raw.authority||0)||0},
    published_at:publishedAt,
    rank:{score:Math.round(frontRank*100)/100},
    tags:Array.isArray(raw.tags)?raw.tags.slice(0,30):[],
    searchBankId:text(raw.id||raw.uid||raw.indexId||raw.originalId)||null,
    searchBankContract:plain(raw.searchBankContract||raw.sanmaruSearchBankContract),
    verify:plain(raw.verify),
    frontSupplyAllowed:raw.frontSupplyAllowed===true||plain(raw.searchBankContract).frontSupplyAllowed===true,
    snapshotEligible:raw.snapshotEligible===true||plain(raw.searchBankContract).snapshotEligible===true,
    link:plain(raw.link),
    sitePreview:plain(raw.sitePreview||raw.site_preview)
  };
  const issues=[];
  if(!url) issues.push("https_url_missing");
  if(!thumb) issues.push("thumbnail_missing");
  if(resolved==="donation-mission"&&Policy.missionExcluded(raw)) issues.push("mission_policy_excluded");
  if(Policy.isPlaceholder(raw)) issues.push("placeholder_or_seed");
  if(resolved==="donation-global"&&!isVideo) issues.push("video_not_detected");
  if(resolved!=="donation-global"&&!homepage) issues.push("official_homepage_missing");
  if(resolved!=="donation-global"&&homepage&&!thumb) issues.push("homepage_preview_missing");
  if(resolved!=="donation-global"&&!url) issues.push("organization_destination_missing");
  return {id,candidate,queue:{schema:"igdc-donation-candidate-queue.v1",section:resolved,stage:"research",researchQuery:limitText(query,600),discoveredAt:nowIso(),updatedAt:nowIso(),relevanceScore:relevance,issues,mediaKind:isVideo?"video":"link",sourceSearchBankId:candidate.searchBankId||null}};
}
function rowView(row){
  const payload=plain(row&&row.source_payload), q=plain(payload.donationQueue), c=plain(payload.candidate);
  return {
    id:text(row&&row.id),title:text(row&&row.title||c.title),url:text(row&&row.official_url||c.url),thumbnail:text(row&&row.thumbnail_url||c.thumbnail),summary:text(row&&row.description||c.summary),
    section:Policy.normalizeSection(q.section||c.section||c.psom_key)||"donation-ngo",stage:stageOfPayload(payload),status:text(row&&row.status),relevanceScore:Number(q.relevanceScore||0)||0,issues:Array.isArray(q.issues)?q.issues:[],mediaKind:text(q.mediaKind||c.media&&c.media.kind)||"link",researchQuery:text(q.researchQuery),updatedAt:text(row&&row.updated_at||q.updatedAt),candidate:c
  };
}
async function readRows(){
  const query="select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at&source_ref=eq."+encodeURIComponent(SOURCE_REF)+"&order=updated_at.desc&limit=3000";
  const rows=await Store.select("gslot_candidates",query); return Array.isArray(rows)?rows:[];
}
async function rowById(id){
  const rows=await Store.select("gslot_candidates","select=id,kind,title,official_url,status,source_ref,thumbnail_url,description,owner_note,source_payload,created_at,updated_at&id=eq."+encodeURIComponent(id)+"&source_ref=eq."+encodeURIComponent(SOURCE_REF)+"&limit=1");
  return Array.isArray(rows)?rows[0]||null:null;
}
async function upsertRows(rows){
  if(!rows.length) return [];
  return Store.request(Store.rest("gslot_candidates","on_conflict=id"),{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(rows)});
}
function researchParams(section,query,limit){
  const q=text(query)||researchQuery(section,'');
  const frame=Policy.researchFrameFor ? Policy.researchFrameFor(section) : {};
  const global=section==="donation-global";
  const params={q,query:q,channel:"donation",page:"donation",section,psom_key:section,action:"front-supply",autoFill:"1",external:"force",useExternalSources:"1",limit:String(Math.max(10,Math.min(120,Number(limit)||50))),writeMode:"readonly",mode:"preview",geoPreference:"ip-preferred",adapterAllowList:"donation",sourceTimeoutMs:"3200",discoveryOnly:"1",preserveExactResearchQuery:"1",exactResearchQuery:q,maruSearchType:global?"video":"web",type:global?"video":"web"};
  if(global){params.mediaPreference="video";params.noMedia="0";params.freshnessHours=String(Number(frame.freshnessHours)||48);}
  else{params.noMedia="1";params.mediaPreference="web";}
  if(section==="donation-mission"||frame.localizeByIp===true){params.localizeByIp="1";params.geoPreference="ip-preferred";}
  return params;
}
function serverSearchBankToken(){
  return text(process.env.SANMARU_ADMIN_TOKEN||process.env.MARU_ADMIN_TOKEN||process.env.ADMIN_TOKEN||"");
}
function searchBankWriteParams(section,query,limit){
  const params=researchParams(section,query,limit);
  params.writeMode="write";
  params.mode="write";
  params.allowWrite="1";
  params.writeSnapshot="1";
  params.snapshotWrite="1";
  params.syncSearchBank="1";
  const token=serverSearchBankToken();
  if(token) params.adminToken=token;
  return params;
}
async function applyResearchFrameToSearchBank(event,section,customQuery,limit){
  if(!SearchBank||typeof SearchBank.runEngine!=="function") return {ok:false,error:"searchbank_engine_unavailable",reports:[]};
  const sections=section==="all"?Policy.SECTIONS:[Policy.normalizeSection(section)].filter(Boolean);
  const reports=[];
  for(const sec of sections){
    const terms=Policy.queryTerms(sec,customQuery&&sections.length===1?customQuery:"");
    const queries=terms.slice(0, section==="all"?2:4);
    const detail=[];
    for(const q of queries){
      try{
        const result=await SearchBank.runEngine(event,searchBankWriteParams(sec,q,limit||100));
        const meta=plain(result&&result.meta);
        const persistence=plain(meta.snapshot_persistence);
        detail.push({query:q,items:Array.isArray(result&&result.items)?result.items.length:0,writeAllowed:meta.write_allowed===true,snapshotPersisted:Number(persistence.success_count||0)>0,persistence, syncEnabled:meta.sync_enabled===true,servedFrom:text(result&&result.served_from),adapters:Array.isArray(meta.adapters)?meta.adapters.map(a=>({name:text(a&&a.name),count:Number(a&&a.count||0),ok:a&&a.ok!==false})):[]});
      }catch(error){detail.push({query:q,items:0,writeAllowed:false,syncEnabled:false,error:text(error&&error.message||error)});}
    }
    reports.push({section:sec,queries:detail,writeAllowed:detail.some(x=>x.writeAllowed),snapshotPersisted:detail.some(x=>x.snapshotPersisted),items:detail.reduce((n,x)=>n+Number(x.items||0),0)});
  }
  return {ok:reports.some(r=>r.writeAllowed),snapshotPersisted:reports.some(r=>r.snapshotPersisted),directSnapshotEdit:false,durableCandidateLedger:"gslot_candidates/source_ref=donation-candidate-admin-v1",route:"Donation research frame -> SearchBank Engine -> SearchBank snapshot -> existing Donation Builder",reports};
}
function approvedCandidateForSearchBank(view){
  const c=JSON.parse(JSON.stringify(plain(view&&view.candidate)));
  const section=Policy.normalizeSection(view&&view.section||c.section||c.psom_key)||"donation-ngo";
  const url=safeHttps((Policy.candidateUrlForSection&&Policy.candidateUrlForSection(c,section))||view&&view.url||c.url||plain(c.link).url||plain(c.org).homepage);
  const thumb=safeHttps((Policy.representativeImageForSection&&Policy.representativeImageForSection(c,section))||view&&view.thumbnail||c.thumbnail||plain(c.media).thumb||c.image);
  c.id=text(c.id||view&&view.id)||idFor(section,url,c.title||view&&view.title);
  c.uid=text(c.uid||c.id);
  c.title=limitText(c.title||view&&view.title||plain(c.org).name||url,300);
  c.summary=limitText(c.summary||view&&view.summary||"",1800);
  c.url=url;
  c.thumbnail=thumb||c.thumbnail||null;
  c.thumb=thumb||c.thumb||null;
  c.image=thumb||c.image||null;
  c.channel="donation"; c.page="donation"; c.section=section; c.psom_key=section;
  c.bind=Object.assign({},plain(c.bind),{page:"donation",channel:"donation",section,psom_key:section,route:"donation."+section});
  const homepage=safeHttps(Policy.organizationHomepageUrl?Policy.organizationHomepageUrl(c):"");
  c.link=Object.assign({},plain(c.link),{mode:section==="donation-global"?"global-news-video":"org-homepage",url,target:"_blank"});
  c.org=Object.assign({},plain(c.org),{name:limitText(plain(c.org).name||c.title,300)||null,homepage:section==="donation-global"?(safeHttps(plain(c.org).homepage)||null):(homepage||null)});
  c.media=Object.assign({},plain(c.media),{kind:section==="donation-global"?(plain(c.media).kind||"video"):"image",thumb:thumb||plain(c.media).thumb||null});
  if(section!=="donation-global"){
    /* Institution lanes are official-homepage shortcut cards only. */
    c.type="organization";
    c.media.src=null;
    c.media.embed_url=null;
  }
  c.donation=Object.assign({},plain(c.donation),{enabled:plain(c.donation).enabled===true,external:plain(c.donation).external!==false});
  c.frontApproved=true;
  c.frontSupplyAllowed=true; c.searchBankEligible=true; c.snapshotEligible=true; c.indexEligible=true;
  c.adminApproved=true;
  c.source_adapter="donation-admin";
  c.donationQueue=Object.assign({},plain(c.donationQueue),{section,stage:"published",updatedAt:nowIso()});
  return c;
}

async function publishExactCandidatesToSearchBank(event,ids,limit){
  if(!SearchBank||typeof SearchBank.ingestApprovedItems!=="function") return {ok:false,error:"searchbank_exact_ingest_unavailable",reports:[]};
  const bySection=new Map();
  for(const id of Array.from(new Set((ids||[]).map(text).filter(Boolean))).slice(0,300)){
    const row=await rowById(id);
    if(!row) continue;
    const view=rowView(row);
    if(view.stage!=="published") continue;
    if(!Policy.usablePublicCandidate(view.candidate,view.section)) continue;
    const candidate=approvedCandidateForSearchBank(view);
    if(!candidate.url||!candidate.media||!candidate.media.thumb) continue;
    if(!bySection.has(view.section)) bySection.set(view.section,[]);
    bySection.get(view.section).push(candidate);
  }
  const reports=[];
  const token=serverSearchBankToken();
  for(const [section,items] of bySection.entries()){
    try{
      const result=await SearchBank.ingestApprovedItems(event,items,{section,limit:limit||CAPACITY[section]||100,adminToken:token,query:"admin approved donation candidates"});
      const meta=plain(result&&result.meta), persistence=plain(meta.snapshot_persistence);
      reports.push({section,count:items.length,ok:result&&result.status==="ok",writeAllowed:meta.write_allowed===true,snapshotPersisted:Number(persistence.success_count||0)>0,persistence,approvedIngestCount:Number(meta.approved_ingest_count||0)});
    }catch(error){
      reports.push({section,count:items.length,ok:false,writeAllowed:false,snapshotPersisted:false,error:text(error&&error.message||error)});
    }
  }
  return {ok:reports.length>0&&reports.every(r=>r.ok),snapshotPersisted:reports.some(r=>r.snapshotPersisted),exactSelectedCandidates:true,directSnapshotEdit:false,route:"Admin selected candidate -> SearchBank Engine exact ingest -> SearchBank snapshot -> Donation Builder -> Donation Automap",reports};
}

async function publishedIdsForScope(section){
  const scope=lower(section)==="all" ? "all" : (Policy.normalizeSection(section)||"");
  const rows=(await readRows()).map(rowView).filter(v=>v.stage==="published");
  return rows.filter(v=>scope==="all"||v.section===scope).map(v=>v.id);
}

async function sectionsForIds(ids){
  const out=new Set();
  for(const id of (ids||[]).slice(0,300)){
    const row=await rowById(id);
    if(!row) continue;
    const v=rowView(row); if(v.section) out.add(v.section);
  }
  return Array.from(out);
}
async function performResearch(event,section,customQuery,limit){
  if(!SearchBank||typeof SearchBank.runEngine!=="function"){const e=new Error("SearchBank Engine을 불러오지 못했습니다.");e.statusCode=503;throw e;}
  const sections=section==="all"?Policy.SECTIONS:[Policy.normalizeSection(section)].filter(Boolean);
  if(!sections.length){const e=new Error("도네이션 섹션을 선택해 주세요.");e.statusCode=400;throw e;}

  /* Purge old PDF/report/article/video fallbacks before new research.  GET also
     hides any remaining stale rows immediately, so the administrator never has
     to manually clear policy-violating cards. */
  const cleanup=await purgePolicyViolations();
  const existing=await readRows(), existingMap=new Map(existing.map(r=>[text(r.id),r]));

  async function researchOne(sec){
    const query=researchQuery(sec,sections.length===1?customQuery:'');
    const started=Date.now();let result;
    try{result=await SearchBank.runEngine(event,researchParams(sec,query,Math.min(60,Number(limit)||50)));}
    catch(error){return {section:sec,query,queries:[query],accepted:0,engineItems:0,officialHomepageCount:0,globalVideoCount:0,previewResolved:0,skippedPolicy:0,skippedSearchLanding:0,durationMs:Date.now()-started,error:text(error&&error.message||error),writes:[]};}
    const items=Array.isArray(result&&result.items)?result.items:[];
    const meta=plain(result&&result.meta),writes=[],seen=new Set();
    let skippedPolicy=0,skippedSearchLanding=0,officialHomepageCount=0,globalVideoCount=0,previewResolved=0,skippedExcluded=0;

    if(sec==="donation-global"){
      for(const item of items){
        if(Policy.isPlaceholder(item))continue;
        const url=Policy.candidateUrlForSection?Policy.candidateUrlForSection(item,sec):candidateUrl(item,sec);
        if(!url){if(Policy.candidateUrls(item||{}).some(function(u){return Policy.isSearchLandingUrl&&Policy.isSearchLandingUrl(u);}))skippedSearchLanding++;else skippedPolicy++;continue;}
        const norm=normalizeCandidate(item,sec,query);
        if(!norm.candidate.url||!Policy.looksLikeVideo(item)||!norm.candidate.thumbnail){skippedPolicy++;continue;}
        if(!policyVisibleCandidate(norm.candidate,sec)){skippedPolicy++;continue;}
        if(seen.has(norm.id))continue;seen.add(norm.id);globalVideoCount++;
        const previous=existingMap.get(norm.id),previousPayload=plain(previous&&previous.source_payload),previousStage=stageOfPayload(previousPayload);
        if(previousStage==="excluded"){skippedExcluded++;continue;}
        const previousQueue=plain(previousPayload.donationQueue),previousCandidate=plain(previousPayload.candidate),stage=previous?previousStage:"research";
        const queue=Object.assign({},norm.queue,previousQueue,{section:sec,stage,updatedAt:nowIso(),relevanceScore:Math.max(Number(previousQueue.relevanceScore||0),Number(norm.queue.relevanceScore||0)),issues:Array.from(new Set([...(previousQueue.issues||[]),...(norm.queue.issues||[])]))});
        const candidate=Object.assign({},norm.candidate,previousCandidate);candidate.section=sec;candidate.psom_key=sec;candidate.channel="donation";candidate.page="donation";
        writes.push({id:norm.id,kind:"donation",title:candidate.title,official_url:candidate.url,status:statusForStage(stage),source_ref:SOURCE_REF,thumbnail_url:candidate.thumbnail||null,description:candidate.summary||null,owner_note:"Donation Global News video candidate.",source_payload:{schema:"igdc-donation-candidate.v1",candidate,donationQueue:queue},updated_at:nowIso(),created_at:previous&&previous.created_at||nowIso()});
      }
    }else{
      /* Convert every acceptable result to the institution's HTTPS origin first.
         Deep articles, reports and PDF/document URLs may help discover a domain,
         but they are never stored as the card destination. */
      const byHomepage=new Map();
      for(const item of items){
        if(Policy.isPlaceholder(item))continue;
        const homepage=Policy.organizationHomepageUrl?Policy.organizationHomepageUrl(item):"";
        if(!homepage){if(Policy.candidateUrls(item||{}).some(function(u){return Policy.isSearchLandingUrl&&Policy.isSearchLandingUrl(u);}))skippedSearchLanding++;else skippedPolicy++;continue;}
        if(Policy.sectionIdentityEligible&&!Policy.sectionIdentityEligible(item,sec)){skippedPolicy++;continue;}
        const key=homepage.toLowerCase(),score=Number(Policy.sectionRelevance?Policy.sectionRelevance(item,sec):0)||0,anchor=Policy.matchedResearchAnchorName?Policy.matchedResearchAnchorName(item,sec):"";
        const current=byHomepage.get(key);if(!current||score+(anchor?100:0)>current.score)byHomepage.set(key,{item,homepage,score:score+(anchor?100:0),anchor});
      }
      const roots=Array.from(byHomepage.values()).sort(function(a,b){return b.score-a.score;}).slice(0,sections.length>1?10:24);
      const enriched=await mapLimit(roots,sections.length>1?5:6,async function(entry){
        const preview=await fetchHomepagePreview(entry.homepage,sections.length>1?900:1400);
        const image=safeHttps(preview.image||candidateThumb(entry.item,sec));
        if(!image)return null;
        const raw=plain(entry.item),org=Object.assign({},plain(raw.org),{homepage:preview.homepage||entry.homepage,name:entry.anchor||plain(raw.org).name||raw.name||preview.title||raw.title});
        const media=Object.assign({},plain(raw.media),{kind:"image",src:null,thumb:image,image});
        return Object.assign({},raw,{
          title:limitText(entry.anchor||org.name||preview.title||raw.title||entry.homepage,300),
          summary:limitText(preview.description||raw.summary||raw.description||raw.about||"",1800),
          url:preview.homepage||entry.homepage,homepage:preview.homepage||entry.homepage,website:preview.homepage||entry.homepage,official_url:preview.homepage||entry.homepage,
          thumbnail:image,thumb:image,image,og_image:image,site_preview_image:image,
          org,media,link:Object.assign({},plain(raw.link),{mode:"org-homepage",url:preview.homepage||entry.homepage,target:"_blank"}),
          sitePreview:{resolved:true,kind:"homepage-meta",homepage:preview.homepage||entry.homepage,image,title:preview.title||null,capturedAt:nowIso()},
          sourcePageUrl:safeHttps(raw.url||plain(raw.link).url||plain(raw.source).url)||null
        });
      });
      for(const item of enriched.filter(Boolean)){
        const norm=normalizeCandidate(item,sec,query);
        if(!norm.candidate.url||!norm.candidate.thumbnail||!policyVisibleCandidate(norm.candidate,sec)){skippedPolicy++;continue;}
        if(seen.has(norm.id))continue;seen.add(norm.id);officialHomepageCount++;previewResolved++;
        const previous=existingMap.get(norm.id),previousPayload=plain(previous&&previous.source_payload),previousStage=stageOfPayload(previousPayload);
        if(previousStage==="excluded"){skippedExcluded++;continue;}
        const previousQueue=plain(previousPayload.donationQueue),previousCandidate=plain(previousPayload.candidate),stage=previous?previousStage:"research";
        const queue=Object.assign({},norm.queue,previousQueue,{section:sec,stage,updatedAt:nowIso(),relevanceScore:Math.max(Number(previousQueue.relevanceScore||0),Number(norm.queue.relevanceScore||0)),issues:Array.from(new Set([...(previousQueue.issues||[]),...(norm.queue.issues||[])]))});
        const candidate=Object.assign({},norm.candidate,previousCandidate);candidate.section=sec;candidate.psom_key=sec;candidate.channel="donation";candidate.page="donation";
        /* A current official-homepage preview outranks stale document/video data
           that may exist on an older row with the same id. */
        candidate.url=norm.candidate.url;candidate.thumbnail=norm.candidate.thumbnail;candidate.org=norm.candidate.org;candidate.media=norm.candidate.media;candidate.link=norm.candidate.link||item.link;candidate.sitePreview=item.sitePreview;
        writes.push({id:norm.id,kind:"donation",title:candidate.title,official_url:candidate.url,status:statusForStage(stage),source_ref:SOURCE_REF,thumbnail_url:candidate.thumbnail||null,description:candidate.summary||null,owner_note:"Official organization homepage + homepage representative preview.",source_payload:{schema:"igdc-donation-candidate.v1",candidate,donationQueue:queue},updated_at:nowIso(),created_at:previous&&previous.created_at||nowIso()});
      }
    }
    return {section:sec,query,queries:[query],accepted:writes.length,skippedExcluded,skippedSearchLanding,skippedPolicy,officialHomepageCount,globalVideoCount,previewResolved,engineItems:items.length,durationMs:Date.now()-started,writes,adapters:Array.isArray(meta.adapters)?meta.adapters.map(a=>({name:text(a&&a.name),count:Number(a&&a.count||0),ok:a&&a.ok!==false,error:text(a&&a.error)||null})):[]};
  }

  const sectionResults=[];const concurrency=section==="all"?8:1;
  for(let i=0;i<sections.length;i+=concurrency){const batch=sections.slice(i,i+concurrency);sectionResults.push(...await Promise.all(batch.map(researchOne)));}
  const writes=[];sectionResults.forEach(function(r){writes.push(...(r.writes||[]));delete r.writes;});
  const dedup=new Map();writes.forEach(function(r){dedup.set(r.id,r);});
  const saved=await upsertRows(Array.from(dedup.values()));
  return {reports:sectionResults,savedCount:Array.isArray(saved)?saved.length:dedup.size,cleanup};
}
async function updateStage(ids,stage,actor,note){
  if(!STAGES.has(stage)){const e=new Error("지원하지 않는 단계입니다.");e.statusCode=400;throw e;}
  const results=[];
  for(const id of ids.slice(0,300)){
    const row=await rowById(id); if(!row) continue;
    const payload=plain(row.source_payload), q=plain(payload.donationQueue), c=plain(payload.candidate), section=Policy.normalizeSection(q.section||c.section)||"donation-ngo";
    if(stage==="published"&&!Policy.usablePublicCandidate(c,section)) {results.push({id,ok:false,error:"public_candidate_not_ready"});continue;}
    if(stage==="published"&&section==="donation-mission"&&Policy.missionExcluded(c)){results.push({id,ok:false,error:"mission_policy_excluded"});continue;}
    const nextQ=Object.assign({},q,{section,stage,updatedAt:nowIso(),decidedAt:nowIso(),decidedBy:text(actor&&actor.sub),decisionNote:limitText(note,1500)});
    c.section=section;c.psom_key=section;c.channel="donation";c.page="donation";c.frontApproved=stage==="published";
    if(stage==="published"){c.frontSupplyAllowed=true;c.searchBankEligible=true;c.snapshotEligible=true;c.indexEligible=true;c.adminApproved=true;c.source_adapter="donation-admin";}
    await Store.update("gslot_candidates","id=eq."+encodeURIComponent(id)+"&source_ref=eq."+encodeURIComponent(SOURCE_REF),{status:statusForStage(stage),source_payload:Object.assign({},payload,{candidate:c,donationQueue:nextQ}),owner_note:limitText(note,2000)||row.owner_note||null,updated_at:nowIso()});
    results.push({id,ok:true,stage});
  }
  return results;
}
async function removeRows(ids){
  const out=[]; for(const id of ids.slice(0,300)){try{await Store.remove("gslot_candidates","id=eq."+encodeURIComponent(id)+"&source_ref=eq."+encodeURIComponent(SOURCE_REF));out.push({id,ok:true});}catch(error){out.push({id,ok:false,error:text(error&&error.message||error)});}} return out;
}
function rankForAuto(view){
  let score=Number(view.relevanceScore||0);
  if(view.url&&/^https:\/\//i.test(view.url)) score+=30;
  if(view.thumbnail&&/^https:\/\//i.test(view.thumbnail)) score+=15;
  if(view.mediaKind==="video"&&view.section==="donation-global") score+=25;
  if(view.section==="donation-global"){
    const published = Date.parse(view.candidate&&view.candidate.published_at||"");
    if(Number.isFinite(published)){
      const ageHours = Math.max(0,(Date.now()-published)/3600000);
      if(ageHours<=24) score+=45;
      else if(ageHours<=48) score+=30;
      else if(ageHours<=72) score+=12;
      else if(ageHours>168) score-=30;
    }
  }
  if(view.section!=="donation-global"){
    const homepage=Policy.organizationHomepageUrl?Policy.organizationHomepageUrl(view.candidate||{}):"";
    if(homepage) score+=100;
    else if(view.url) score+=5;
  }
  if((view.issues||[]).includes("mission_policy_excluded")) score-=1000;
  if((view.issues||[]).includes("placeholder_or_seed")) score-=1000;
  return score;
}
async function autoStage(section,targetStage,actor){
  const rows=(await readRows()).map(rowView).filter(v=>v.stage!=="excluded"&&v.stage!=="hold");
  const sections=section==="all"?Policy.SECTIONS:[Policy.normalizeSection(section)].filter(Boolean); const selected=[];
  for(const sec of sections){
    const cap=CAPACITY[sec]||100;
    const eligible=rows.filter(v=>v.section===sec&&v.stage!=="published").sort((a,b)=>rankForAuto(b)-rankForAuto(a)||String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for(const v of eligible){
      if(selected.filter(x=>x.section===sec).length>=cap) break;
      // AI may advance only candidates that are already safe for the front:
      // official HTTPS destination + representative thumbnail + section policy.
      // Manual review stages remain available for incomplete research records.
      if((targetStage==="front_candidate"||targetStage==="published")&&!Policy.usablePublicCandidate(v.candidate,sec)) continue;
      if(sec==="donation-mission"&&Policy.missionExcluded(v.candidate)) continue;
      selected.push(v);
    }
  }
  const selectedIds=selected.map(v=>v.id);
  const results=await updateStage(selectedIds,targetStage,actor,"AI 자동 선별");
  return {selected:selected.length,selectedIds,results};
}
async function executePolicyAgenda(event,body,actor){
  const scope=PolicyDiscussion.normalizeScope(body.scope||body.section||"all");
  const agenda=await PolicyDiscussion.getAgenda(scope,body.agendaId);
  const destination=lower(body.destination||agenda.destination||"admin");
  if(!["admin","front_candidate","front"].includes(destination)){const e=new Error("정책 실행 대상이 올바르지 않습니다.");e.statusCode=400;throw e;}
  const query=PolicyDiscussion.executionQuery(agenda);
  const research=await performResearch(event,scope,query,body.limit||100);
  let stageResult=null;
  if(destination==="front_candidate") stageResult=await autoStage(scope,"front_candidate",actor);
  let searchBank=null;
  if(destination==="front"){
    stageResult=await autoStage(scope,"published",actor);
    searchBank=await publishExactCandidatesToSearchBank(event,stageResult.selectedIds||[],body.limit||100);
  }
  return {scope,agendaId:agenda.id,destination,query,research,stageResult,searchBank,publicPublication:destination==="front"};
}
async function runScheduledGlobalNewsRefresh(event,options){
  const opt=plain(options),limit=Math.max(10,Math.min(60,Number(opt.limit)||50));
  Store.config();
  const startedAt=nowIso();
  const research=await performResearch(event||{},"donation-global","",limit);
  const accepted=(research.reports||[]).reduce((n,r)=>n+Number(r&&r.accepted||0),0);
  if(!accepted){
    return {ok:true,version:VERSION,scope:"donation-global",schedule:"Mon/Wed/Fri",startedAt,finishedAt:nowIso(),research,published:0,searchBank:null,note:"no_new_global_video_candidates"};
  }
  const actor={sub:"donation-global-news-scheduler",roles:["super_admin"]};
  const stageResult=await autoStage("donation-global","published",actor);
  const searchBank=await publishExactCandidatesToSearchBank(event||{},stageResult.selectedIds||[],limit);
  return {ok:true,version:VERSION,scope:"donation-global",schedule:"Mon/Wed/Fri",startedAt,finishedAt:nowIso(),research,published:Number(stageResult.selected||0),stageResult,searchBank};
}

function summary(rows){
  const out={total:rows.length,stages:{},sections:{}};
  Policy.SECTIONS.forEach(sec=>out.sections[sec]={total:0,research:0,queue:0,front_candidate:0,published:0,hold:0,excluded:0,capacity:CAPACITY[sec]||100});
  rows.forEach(v=>{out.stages[v.stage]=(out.stages[v.stage]||0)+1;const s=out.sections[v.section]||(out.sections[v.section]={total:0});s.total=(s.total||0)+1;s[v.stage]=(s[v.stage]||0)+1;}); return out;
}

exports.handler=async function(event){
  try{
    const method=text(event&&event.httpMethod||"GET").toUpperCase(); if(method==="OPTIONS")return json(204,{});
    const actor=await AdminAuth.resolveUser(event); requireRole(actor,method!=="GET");
    let storeConfigError=null;
    try{ Store.config(); }catch(error){ storeConfigError=text(error&&error.message||error)||"donation_candidate_store_unavailable"; }
    if(method==="GET"){
      let rows=[],storageError=storeConfigError;
      if(!storageError){
        try{
          const allRows=(await readRows()).map(rowView);
          rows=allRows.filter(function(v){return policyVisibleCandidate(v.candidate,v.section);});
          rows.policyHiddenCount=allRows.length-rows.length;
        }
        catch(error){ storageError=text(error&&error.message||error)||"donation_candidate_store_read_failed"; }
      }
      return json(200,{
        ok:true,version:VERSION,sourceRef:SOURCE_REF,
        sections:Policy.SECTIONS.map(k=>({key:k,label:Policy.SECTION_LABELS[k],capacity:CAPACITY[k]||100,researchFrame:Policy.researchFrameFor?Policy.researchFrameFor(k):null})),
        summary:summary(rows),items:rows,publicPublication:false,
        policyCleanup:{hiddenInvalid:Number(rows&&rows.policyHiddenCount||0)},
        storage:{available:!storageError,error:storageError||null,degraded:!!storageError}
      });
    }
    if(storeConfigError){const e=new Error(storeConfigError);e.statusCode=503;throw e;}
    if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
    const body=parse(event),action=lower(body.action||body.decision);
    if(action==="policy_workspace"){
      const scope=PolicyDiscussion.normalizeScope(body.scope||body.section||"all");
      return json(200,await PolicyDiscussion.getWorkspace(scope));
    }
    if(action==="policy_ai_discuss"){
      return json(200,await PolicyDiscussion.discuss(text(actor&&actor.sub),body));
    }
    if(action==="policy_agenda_delete"){
      return json(200,await PolicyDiscussion.deleteAgenda(text(actor&&actor.sub),body));
    }
    if(action==="policy_workspace_clear"){
      return json(200,await PolicyDiscussion.clearWorkspace(text(actor&&actor.sub),body));
    }
    if(action==="policy_execute"){
      const result=await executePolicyAgenda(event,body,actor);
      return json(200,{ok:true,version:VERSION,action,result,publicPublication:result.publicPublication===true});
    }
    if(action==="research"){
      const section=Policy.normalizeSection(body.section)|| (lower(body.section)==="all"?"all":"");
      const result=await performResearch(event,section,text(body.query),body.limit); return json(200,{ok:true,version:VERSION,action,result,publicPublication:false});
    }
    const ids=Array.from(new Set(array(body.ids||body.candidateIds||body.id||body.candidateId).map(text).filter(Boolean)));
    if(action==="remove") return json(200,{ok:true,version:VERSION,action,results:await removeRows(ids),publicPublication:false});
    const stageMap={move_to_queue:"queue",queue:"queue",front_candidate:"front_candidate",move_to_front:"front_candidate",publish:"published",published:"published",hold:"hold",exclude:"excluded",restore:"queue",research_stage:"research"};
    if(stageMap[action]){
      if(!ids.length){const e=new Error("처리할 후보를 선택해 주세요.");e.statusCode=400;throw e;}
      const results=await updateStage(ids,stageMap[action],actor,text(body.note));
      let searchBank=null;
      if(stageMap[action]==="published"){
        const publishedIds=results.filter(r=>r&&r.ok&&r.stage==="published").map(r=>r.id);
        searchBank=await publishExactCandidatesToSearchBank(event,publishedIds,body.limit||100);
      }
      return json(200,{ok:true,version:VERSION,action,stage:stageMap[action],results,searchBank,publicPublication:stageMap[action]==="published"});
    }
    if(action==="ai_front_candidates"||action==="ai_auto_match"){
      const section=lower(body.section)==="all"?"all":Policy.normalizeSection(body.section||"all")||"all";
      const target=action==="ai_auto_match"?"published":"front_candidate";
      const result=await autoStage(section,target,actor);
      const searchBank=target==="published"?await publishExactCandidatesToSearchBank(event,result.selectedIds||[],body.limit||100):null;
      return json(200,{ok:true,version:VERSION,action,targetStage:target,result,searchBank,publicPublication:target==="published"});
    }
    if(action==="reconcile_published"){
      const section=lower(body.section)==="all"?"all":Policy.normalizeSection(body.section||"all")||"all";
      const publishedIds=await publishedIdsForScope(section);
      const searchBank=await publishExactCandidatesToSearchBank(event,publishedIds,body.limit||100);
      return json(200,{ok:true,version:VERSION,action,section,publishedCount:publishedIds.length,searchBank,publicPublication:true});
    }
    if(action==="searchbank_apply"){
      const section=lower(body.section)==="all"?"all":Policy.normalizeSection(body.section||"all")||"all";
      const searchBank=await applyResearchFrameToSearchBank(event,section,text(body.query),body.limit||100);
      return json(200,{ok:true,version:VERSION,action,searchBank,publicPublication:false});
    }
    return json(400,{ok:false,error:"unsupported_action"});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:text(error&&error.code)||null,version:VERSION});}
};

exports.SOURCE_REF=SOURCE_REF;
exports.CAPACITY=CAPACITY;
exports.normalizeCandidate=normalizeCandidate;
exports.runScheduledGlobalNewsRefresh=runScheduledGlobalNewsRefresh;
