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

const VERSION = "donation-candidate-admin-v1.3.1-publish-ready-auto-stage";
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
function candidateUrl(item){
  for(const value of Policy.candidateUrls(item||{})){
    const u=safeHttps(value); if(u) return u;
  }
  return "";
}
function candidateThumb(item){
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
  const resolved=sectionOf(raw,section), url=candidateUrl(raw), title=limitText(raw.title||raw.name||org.name||url,300), thumb=candidateThumb(raw);
  const isVideo=Policy.looksLikeVideo(raw), relevance=Policy.sectionRelevance(raw,resolved);
  const publishedAt=raw.published_at||raw.publishedAt||raw.datePublished||null;
  let freshnessBonus=0;
  if(resolved==="donation-global"&&publishedAt){
    const ts=Date.parse(publishedAt);
    if(Number.isFinite(ts)){
      const ageHours=Math.max(0,(Date.now()-ts)/3600000);
      freshnessBonus=ageHours<=24?100:ageHours<=48?70:ageHours<=72?30:ageHours<=168?5:-40;
    }
  }
  const frontRank=relevance+(thumb?20:0)+(resolved==="donation-global"&&isVideo?50:0)+freshnessBonus;
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
    org:{name:limitText(org.name||raw.name||title,300)||null,legal_name:limitText(org.legal_name||raw.legal_name||"",300)||null,homepage:(!isVideo?url:safeHttps(org.homepage||raw.homepage||raw.website))||null,country:text(org.country||raw.country)||null},
    source:{name:sourceName(raw),url:safeHttps(source.url||raw.sourceUrl||raw.source_url||url)||url,authority:Number(source.authority||raw.authority||0)||0},
    published_at:publishedAt,
    rank:{score:Math.round(frontRank*100)/100},
    tags:Array.isArray(raw.tags)?raw.tags.slice(0,30):[],
    searchBankId:text(raw.id||raw.uid||raw.indexId||raw.originalId)||null,
    searchBankContract:plain(raw.searchBankContract||raw.sanmaruSearchBankContract),
    verify:plain(raw.verify),
    frontSupplyAllowed:raw.frontSupplyAllowed===true||plain(raw.searchBankContract).frontSupplyAllowed===true,
    snapshotEligible:raw.snapshotEligible===true||plain(raw.searchBankContract).snapshotEligible===true
  };
  const issues=[];
  if(!url) issues.push("https_url_missing");
  if(!thumb) issues.push("thumbnail_missing");
  if(resolved==="donation-mission"&&Policy.missionExcluded(raw)) issues.push("mission_policy_excluded");
  if(Policy.isPlaceholder(raw)) issues.push("placeholder_or_seed");
  if(resolved==="donation-global"&&!isVideo) issues.push("video_not_detected");
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
  const q=text(query)||Policy.queryTerms(section)[0]||Policy.SECTION_LABELS[section]||"donation";
  const frame=Policy.researchFrameFor ? Policy.researchFrameFor(section) : {};
  const params={q,query:q,channel:"donation",page:"donation",section,psom_key:section,action:"front-supply",autoFill:"1",external:"force",useExternalSources:"1",limit:String(Math.max(10,Math.min(120,Number(limit)||50))),writeMode:"readonly",mode:"preview",geoPreference:"ip-preferred"};
  if(section==="donation-global"||Number(frame.freshnessHours)>0){params.freshnessHours=String(Number(frame.freshnessHours)||48);}
  if(section==="donation-global"||frame.preferVideo===true){params.mediaPreference="video";}
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
        const result=await SearchBank.runEngine(event,searchBankWriteParams(sec,q,limit||80));
        const meta=plain(result&&result.meta);
        const persistence=plain(meta.snapshot_persistence);
        detail.push({query:q,items:Array.isArray(result&&result.items)?result.items.length:0,writeAllowed:meta.write_allowed===true,snapshotPersisted:Number(persistence.success_count||0)>0,persistence, syncEnabled:meta.sync_enabled===true,servedFrom:text(result&&result.served_from),adapters:Array.isArray(meta.adapters)?meta.adapters.map(a=>({name:text(a&&a.name),count:Number(a&&a.count||0),ok:a&&a.ok!==false})):[]});
      }catch(error){detail.push({query:q,items:0,writeAllowed:false,syncEnabled:false,error:text(error&&error.message||error)});}
    }
    reports.push({section:sec,queries:detail,writeAllowed:detail.some(x=>x.writeAllowed),snapshotPersisted:detail.some(x=>x.snapshotPersisted),items:detail.reduce((n,x)=>n+Number(x.items||0),0)});
  }
  return {ok:reports.some(r=>r.writeAllowed),snapshotPersisted:reports.some(r=>r.snapshotPersisted),directSnapshotEdit:false,durableCandidateLedger:"gslot_candidates/source_ref=donation-candidate-admin-v1",route:"Donation research frame -> SearchBank Engine -> SearchBank snapshot -> existing Donation Builder",reports};
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
  const existing=await readRows(), existingMap=new Map(existing.map(r=>[text(r.id),r]));
  const writes=[], reports=[];
  for(const sec of sections){
    const baseTerms=Policy.queryTerms(sec);
    const queries=customQuery
      ? (sections.length===1 ? Array.from(new Set([text(customQuery)].concat(baseTerms.slice(0,2)).filter(Boolean))) : [text([baseTerms[0]||"",customQuery].filter(Boolean).join(" "))])
      : baseTerms.slice(0, section==="all"?2:6);
    const seen=new Set(); let accepted=0, skippedExcluded=0;
    for(const q of queries){
      const result=await SearchBank.runEngine(event,researchParams(sec,q,limit));
      const items=Array.isArray(result&&result.items)?result.items:[];
      for(const item of items){
        const norm=normalizeCandidate(item,sec,q);
        if(!norm.candidate.url||seen.has(norm.id)||Policy.isPlaceholder(item)) continue;
        seen.add(norm.id);
        const previous=existingMap.get(norm.id), previousPayload=plain(previous&&previous.source_payload), previousStage=stageOfPayload(previousPayload);
        if(previousStage==="excluded"){skippedExcluded++;continue;}
        const previousQueue=plain(previousPayload.donationQueue), previousCandidate=plain(previousPayload.candidate);
        const stage=previous?previousStage:"research";
        const queue=Object.assign({},norm.queue,previousQueue,{section:sec,stage,updatedAt:nowIso(),relevanceScore:Math.max(Number(previousQueue.relevanceScore||0),Number(norm.queue.relevanceScore||0)),issues:Array.from(new Set([...(previousQueue.issues||[]),...(norm.queue.issues||[])]))});
        const candidate=Object.assign({},norm.candidate,previousCandidate); // preserve admin-corrected fields
        candidate.section=sec;candidate.psom_key=sec;candidate.channel="donation";candidate.page="donation";
        writes.push({id:norm.id,kind:"donation",title:candidate.title,official_url:candidate.url,status:statusForStage(stage),source_ref:SOURCE_REF,thumbnail_url:candidate.thumbnail||null,description:candidate.summary||null,owner_note:"Donation-only private candidate; no public publication without final front matching.",source_payload:{schema:"igdc-donation-candidate.v1",candidate,donationQueue:queue},updated_at:nowIso(),created_at:previous&&previous.created_at||nowIso()});
        accepted++;
      }
    }
    reports.push({section:sec,queries,accepted,skippedExcluded});
  }
  const dedup=new Map();writes.forEach(r=>dedup.set(r.id,r));
  const saved=await upsertRows(Array.from(dedup.values()));
  return {reports,savedCount:Array.isArray(saved)?saved.length:dedup.size};
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
  if((view.issues||[]).includes("mission_policy_excluded")) score-=1000;
  if((view.issues||[]).includes("placeholder_or_seed")) score-=1000;
  return score;
}
async function autoStage(section,targetStage,actor){
  const rows=(await readRows()).map(rowView).filter(v=>v.stage!=="excluded"&&v.stage!=="hold");
  const sections=section==="all"?Policy.SECTIONS:[Policy.normalizeSection(section)].filter(Boolean); const selected=[];
  for(const sec of sections){
    const cap=CAPACITY[sec]||80;
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
  const results=await updateStage(selected.map(v=>v.id),targetStage,actor,"AI 자동 선별");
  return {selected:selected.length,results};
}
async function executePolicyAgenda(event,body,actor){
  const scope=PolicyDiscussion.normalizeScope(body.scope||body.section||"all");
  const agenda=await PolicyDiscussion.getAgenda(scope,body.agendaId);
  const destination=lower(body.destination||agenda.destination||"admin");
  if(!["admin","front_candidate","front"].includes(destination)){const e=new Error("정책 실행 대상이 올바르지 않습니다.");e.statusCode=400;throw e;}
  const query=PolicyDiscussion.executionQuery(agenda);
  const research=await performResearch(event,scope,query,body.limit||80);
  let stageResult=null;
  if(destination==="front_candidate") stageResult=await autoStage(scope,"front_candidate",actor);
  let searchBank=null;
  if(destination==="front"){
    stageResult=await autoStage(scope,"published",actor);
    searchBank=await applyResearchFrameToSearchBank(event,scope,query,body.limit||80);
  }
  return {scope,agendaId:agenda.id,destination,query,research,stageResult,searchBank,publicPublication:destination==="front"};
}
function summary(rows){
  const out={total:rows.length,stages:{},sections:{}};
  Policy.SECTIONS.forEach(sec=>out.sections[sec]={total:0,research:0,queue:0,front_candidate:0,published:0,hold:0,excluded:0,capacity:CAPACITY[sec]||80});
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
        try{ rows=(await readRows()).map(rowView); }
        catch(error){ storageError=text(error&&error.message||error)||"donation_candidate_store_read_failed"; }
      }
      return json(200,{
        ok:true,version:VERSION,sourceRef:SOURCE_REF,
        sections:Policy.SECTIONS.map(k=>({key:k,label:Policy.SECTION_LABELS[k],capacity:CAPACITY[k]||80,researchFrame:Policy.researchFrameFor?Policy.researchFrameFor(k):null})),
        summary:summary(rows),items:rows,publicPublication:false,
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
        const affected=await sectionsForIds(ids);
        const reports=[];
        for(const sec of affected){reports.push(await applyResearchFrameToSearchBank(event,sec,"",body.limit||80));}
        searchBank={ok:reports.some(r=>r&&r.ok),reports};
      }
      return json(200,{ok:true,version:VERSION,action,stage:stageMap[action],results,searchBank,publicPublication:stageMap[action]==="published"});
    }
    if(action==="ai_front_candidates"||action==="ai_auto_match"){
      const section=lower(body.section)==="all"?"all":Policy.normalizeSection(body.section||"all")||"all";
      const target=action==="ai_auto_match"?"published":"front_candidate";
      const result=await autoStage(section,target,actor);
      const searchBank=target==="published"?await applyResearchFrameToSearchBank(event,section,"",body.limit||80):null;
      return json(200,{ok:true,version:VERSION,action,targetStage:target,result,searchBank,publicPublication:target==="published"});
    }
    if(action==="searchbank_apply"){
      const section=lower(body.section)==="all"?"all":Policy.normalizeSection(body.section||"all")||"all";
      const searchBank=await applyResearchFrameToSearchBank(event,section,text(body.query),body.limit||80);
      return json(200,{ok:true,version:VERSION,action,searchBank,publicPublication:false});
    }
    return json(400,{ok:false,error:"unsupported_action"});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:text(error&&error.code)||null,version:VERSION});}
};

exports.SOURCE_REF=SOURCE_REF;
exports.CAPACITY=CAPACITY;
exports.normalizeCandidate=normalizeCandidate;
