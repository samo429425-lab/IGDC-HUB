"use strict";

/*
 * IGDC Donation administrator AI discussion workspace.
 * Donation-only.  It never writes Distribution/Social/Media ledgers and never
 * publishes by itself.  Administrator confirmation is required by the caller
 * before any front-matching execution.
 */

const crypto = require("crypto");
const SlotStore = require("./global-slot-console-supabase");
const DonationPolicy = require("./donation-research-policy.v1");

const VERSION = "donation-policy-discussion-v1.0.0";
const PREFIX = "igdc_donation_policy_discussion_";
const SCOPE_HUB = "donation-control";
const DEFAULT_MODEL = "gpt-4o-mini";
const DESTINATIONS = new Set(["admin","front_candidate","front"]);

function text(value){ return value == null ? "" : String(value).trim(); }
function lower(value){ return text(value).toLowerCase().replace(/[\s.]+/g,"_"); }
function plain(value){ return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value){ return Array.isArray(value) ? value : []; }
function iso(){ return new Date().toISOString(); }
function clean(value,limit){ return text(value).replace(/\s+/g," ").slice(0,limit||500); }
function cleanList(value,limit,itemLimit){
  const out=[];
  for(const raw of array(value)){
    const item=clean(raw,itemLimit||240);
    if(item && !out.some(v=>v.toLowerCase()===item.toLowerCase())) out.push(item);
    if(out.length >= (limit||20)) break;
  }
  return out;
}
function envFirst(){ for(const name of arguments){ const value=text(process.env[name]); if(value) return value; } return ""; }
function parseJson(value){
  const raw=text(value); if(!raw) return null;
  try{return JSON.parse(raw);}catch(_e){}
  const start=raw.indexOf("{"); const end=raw.lastIndexOf("}");
  if(start>=0 && end>start){ try{return JSON.parse(raw.slice(start,end+1));}catch(_e){} }
  return null;
}
function agendaId(){ return "agenda_"+Date.now().toString(36)+"_"+crypto.randomBytes(5).toString("hex"); }
function messageId(){ return "msg_"+Date.now().toString(36)+"_"+crypto.randomBytes(5).toString("hex"); }
function clamp(value,min,max,fallback){ const n=Number(value); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback; }

function normalizeScope(value){
  const raw=lower(value||"all").replace(/_/g,"-");
  if(raw==="all" || raw==="donation-all") return "all";
  const section=DonationPolicy.normalizeSection(raw);
  if(!section){ const e=new Error("도네이션 정책 협의 섹션이 올바르지 않습니다."); e.statusCode=400; throw e; }
  return section;
}
function scopeLabel(scope){ return scope==="all" ? "도네이션 전체" : (DonationPolicy.SECTION_LABELS[scope]||scope); }
function workspaceId(scope){ return PREFIX + (scope==="all" ? "all" : scope.replace(/^donation-/,"")); }
function responseLanguage(instruction,requested){
  const req=text(requested).toLowerCase();
  if(req && req!=="auto") return req;
  const sample=text(instruction);
  if(/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(sample)) return "ko-KR";
  if(/[ぁ-んァ-ヶ]/.test(sample)) return "ja-JP";
  if(/[\u4e00-\u9fff]/.test(sample)) return "zh-CN";
  if(/[\u0600-\u06ff]/.test(sample)) return "ar-SA";
  return "en-US";
}
function defaultWorkspace(scope){
  return {
    schema:"igdc-donation-policy-workspace.v1",
    version:VERSION,
    id:workspaceId(scope),
    scope,
    scopeLabel:scopeLabel(scope),
    messages:[],
    agendas:[],
    updatedAt:null,
    updatedBy:null
  };
}
function normalizeAgenda(raw,index,scope){
  const a=plain(raw), destination=DESTINATIONS.has(lower(a.destination))?lower(a.destination):"admin";
  const id=clean(a.id,120)||("legacy_"+index);
  return {
    id,
    scope:normalizeScope(a.scope||scope),
    title:clean(a.title||a.summary||("안건 "+(index+1)),180),
    instruction:clean(a.instruction,5000),
    summary:clean(a.summary,1800),
    researchQuery:clean(a.researchQuery||a.query,1200),
    includeTerms:cleanList(a.includeTerms,30,180),
    avoidTerms:cleanList(a.avoidTerms,30,180),
    preferredKinds:cleanList(a.preferredKinds,12,100),
    destination,
    freshnessHours:Math.round(clamp(a.freshnessHours,0,168,0)),
    confidence:Math.round(clamp(a.confidence,0,100,0)),
    createdAt:text(a.createdAt)||null,
    createdBy:text(a.createdBy)||null,
    provider:text(a.provider)||null,
    model:text(a.model)||null,
    error:text(a.error)||null
  };
}
function workspaceFromRow(row,scope){
  const base=defaultWorkspace(scope), rule=plain(row&&row.rule), stored=plain(rule.donationPolicyWorkspace);
  const messages=array(stored.messages).slice(-80).map((m,i)=>({
    id:clean(m&&m.id,120)||("m_"+i),
    role:["user","assistant","system"].includes(text(m&&m.role))?text(m.role):"system",
    content:clean(m&&m.content,5000),
    createdAt:text(m&&m.createdAt)||null,
    language:text(m&&m.language)||null,
    agendaId:text(m&&m.agendaId)||null
  })).filter(m=>m.content);
  const agendas=array(stored.agendas).slice(-60).map((a,i)=>normalizeAgenda(a,i,scope));
  return Object.assign({},base,stored,{id:text(row&&row.id)||base.id,scope,scopeLabel:scopeLabel(scope),messages,agendas,updatedAt:text(row&&row.updated_at||stored.updatedAt)||null,updatedBy:text(row&&row.updated_by||stored.updatedBy)||null});
}
async function rows(){
  const q="select=id,name,scope_hub,scope_region,enabled,rule,updated_at,updated_by&scope_hub=eq."+encodeURIComponent(SCOPE_HUB)+"&order=updated_at.desc&limit=100";
  const list=await SlotStore.select("gslot_policies",q);
  return array(list).filter(r=>text(r&&r.id).startsWith(PREFIX));
}
async function getWorkspace(scopeValue){
  const scope=normalizeScope(scopeValue), id=workspaceId(scope);
  let list=[],storageAvailable=true,storageError=null;
  try{ list=await rows(); }catch(error){storageAvailable=false;storageError=clean(error&&error.message||error,240);}
  const row=list.find(r=>text(r&&r.id)===id);
  return {ok:true,version:VERSION,storage:{available:storageAvailable,error:storageError},workspace:row?workspaceFromRow(row,scope):defaultWorkspace(scope)};
}
async function persist(actorId,workspaceInput){
  const workspace=plain(workspaceInput),scope=normalizeScope(workspace.scope),id=workspaceId(scope),now=iso();
  const existing=(await rows()).find(r=>text(r&&r.id)===id);
  const normalized=workspaceFromRow({id,rule:{donationPolicyWorkspace:workspace},updated_at:now,updated_by:text(actorId)||"administrator"},scope);
  const row={
    id,
    name:"도네이션 AI 정책 협의 · "+scopeLabel(scope),
    scope_hub:SCOPE_HUB,
    scope_country:null,
    scope_region:scope,
    enabled:false,
    rule:{schema:VERSION,donationPolicyWorkspace:normalized},
    updated_at:now,
    updated_by:text(actorId)||"administrator"
  };
  if(!existing) row.created_at=now;
  const saved=await SlotStore.insert("gslot_policies",row,"resolution=merge-duplicates,return=representation");
  return workspaceFromRow(array(saved)[0]||row,scope);
}

function sectionGuidance(scope){
  const all={
    "donation-global":"24~48시간 내 전 세계 지진·홍수·산불·전쟁피해·난민·기아·아동·보건·교육·기후·환경 등 지원 필요 이슈. 영상 우선, 실제 인도주의 의미가 있어야 함.",
    "donation-ngo":"국제적·범국가적 공익기관/NGO/국제개발·구호기관. KOICA, UN 계열, Good Neighbors 같은 유형을 연구 앵커로 사용할 수 있으나 공식 출처를 확인.",
    "donation-mission":"개신교/복음주의 기반의 국제·국가별 선교기관. Lausanne, PAUA, CCC, IVF/InterVarsity, Child Evangelism Fellowship 같은 유형. 접속 국가/IP를 지역화 힌트로 사용. 가톨릭·정교회·이슬람·사이비/이단성 단체 제외.",
    "donation-service":"기독교 기반 또는 공익성이 분명한 봉사·의료·주거·지역사회·자원봉사 기관. 공식 홈페이지와 대표 이미지/OG 썸네일 우선.",
    "donation-relief":"World Vision, Food for the Hungry, Samaritan's Purse 같은 재난·기아·난민·긴급구호 유형. 공식 기관 링크·대표 썸네일 우선.",
    "donation-education":"기독교 교육·아동·청소년·문해·대학·훈련 및 4/14 Window 같은 교육운동 유형. 공식 출처 우선.",
    "donation-environment":"A Rocha, Plant With Purpose 같은 기독교적 창조보전·산림·물·환경봉사 유형. 정당·선거·당파 캠페인 제외.",
    "donation-others":"위 7개에 정확히 들어가지 않는 기독교 기반 공익 NGO/비영리 기관. 인권·장애·교정·인신매매 방지·취약계층 지원 등."
  };
  if(scope==="all") return all;
  return {[scope]:all[scope]||""};
}
function fallbackProposal(scope,instruction,error){
  const policy=scope==="all"?null:DonationPolicy.policyFor(scope);
  return {
    title:scopeLabel(scope)+" 운영 안건",
    summary:"AI 응답을 완료하지 못해 관리자 지시를 그대로 리서치 안건으로 보존했습니다.",
    researchQuery:clean(instruction,1200),
    includeTerms:policy?cleanList(policy.semanticHints||[],12,100):[],
    avoidTerms:policy?cleanList(policy.excludedHints||[],12,100):[],
    preferredKinds:policy?cleanList(policy.preferredKinds||[],8,80):[],
    destination:"admin",
    freshnessHours:scope==="donation-global"?48:0,
    confidence:0,
    error:clean(error,240)||"AI_POLICY_DISCUSSION_UNAVAILABLE"
  };
}
function normalizeProposal(parsed,scope,instruction){
  const raw=plain(parsed),destination=DESTINATIONS.has(lower(raw.destination))?lower(raw.destination):"admin",policy=scope==="all"?null:DonationPolicy.policyFor(scope);
  return {
    title:clean(raw.title||scopeLabel(scope)+" 운영 안건",180),
    summary:clean(raw.summary,1800),
    researchQuery:clean(raw.researchQuery||raw.query||instruction,1200),
    includeTerms:cleanList(raw.includeTerms,30,180),
    avoidTerms:cleanList(raw.avoidTerms,30,180),
    preferredKinds:cleanList(raw.preferredKinds||(policy&&policy.preferredKinds)||[],12,100),
    destination,
    freshnessHours:Math.round(clamp(raw.freshnessHours,0,168,scope==="donation-global"?48:0)),
    confidence:Math.round(clamp(raw.confidence,0,100,0)),
    error:null
  };
}
async function aiProposal(scope,workspace,instruction,requestedLanguage){
  const language=responseLanguage(instruction,requestedLanguage),key=envFirst("OPENAI_API_KEY","OPENAI_KEY");
  if(!key) return {provider:"unavailable",model:null,language,proposal:fallbackProposal(scope,instruction,"OPENAI_API_KEY_missing")};
  const model=envFirst("IGDC_DONATION_POLICY_MODEL","IGDC_POLICY_DISCUSSION_MODEL","OPENAI_MODEL")||DEFAULT_MODEL;
  const controller=typeof AbortController!=="undefined"?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),45000):null;
  try{
    const recent=array(workspace.messages).slice(-12).map(m=>({role:m.role,content:m.content}));
    const payload={scope,scopeLabel:scopeLabel(scope),sectionGuidance:sectionGuidance(scope),administratorInstruction:instruction,recentConversation:recent,sectionPolicy:scope==="all"?null:DonationPolicy.policyFor(scope)};
    const response=await fetch((envFirst("OPENAI_BASE_URL")||"https://api.openai.com/v1").replace(/\/+$/g,"")+"/chat/completions",{
      method:"POST",signal:controller?controller.signal:undefined,
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},
      body:JSON.stringify({model,temperature:0.15,response_format:{type:"json_object"},messages:[
        {role:"system",content:"You are the IGDC Donation administrator AI policy discussion assistant. Work only on Donation. Do not modify or mix Distribution, Social, Media, Network, Tour, Home, shared snapshots, or shared UI. The administrator is deciding research and front-matching direction for eight Donation sections. Prefer official organization websites and their official OG/representative thumbnails; for global news prefer current humanitarian/disaster/environment videos. For mission content use Protestant/evangelical organizations and exclude Catholic, Orthodox, Islamic, cult/new-religious-movement content. Do not claim verification without evidence. Never publish automatically. Return JSON only with: title, summary, researchQuery, includeTerms[], avoidTerms[], preferredKinds[], destination(one of admin,front_candidate,front), freshnessHours, confidence. destination is only a recommendation; the browser asks the administrator before execution. All natural-language strings must use the administrator language: "+language+"."},
        {role:"user",content:JSON.stringify(payload)}
      ]})
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(clean(body&&body.error&&body.error.message||("OpenAI HTTP "+response.status),240));
    const parsed=parseJson(body&&body.choices&&body.choices[0]&&body.choices[0].message&&body.choices[0].message.content);
    if(!parsed) throw new Error("donation_policy_json_invalid");
    return {provider:"openai",model,language,proposal:normalizeProposal(parsed,scope,instruction)};
  }catch(error){
    return {provider:"fallback",model,language,proposal:fallbackProposal(scope,instruction,error&&error.message||error)};
  }finally{ if(timer) clearTimeout(timer); }
}

async function discuss(actorId,input){
  const raw=plain(input),scope=normalizeScope(raw.scope||raw.section||"all"),instruction=clean(raw.instruction||raw.message,5000);
  if(!instruction){const e=new Error("AI와 협의할 운영 의견·질문 또는 정책 지시를 입력해 주세요.");e.statusCode=400;throw e;}
  const current=(await getWorkspace(scope)).workspace,ai=await aiProposal(scope,current,instruction,raw.language),id=agendaId(),now=iso();
  const agenda=normalizeAgenda(Object.assign({},ai.proposal,{id,scope,instruction,createdAt:now,createdBy:text(actorId)||"administrator",provider:ai.provider,model:ai.model,error:ai.proposal.error||null}),current.agendas.length,scope);
  const messages=array(current.messages).slice(-76);
  messages.push({id:messageId(),role:"user",content:instruction,createdAt:now,language:ai.language,agendaId:id});
  messages.push({id:messageId(),role:"assistant",content:agenda.summary||agenda.title,createdAt:iso(),language:ai.language,agendaId:id});
  const next=Object.assign({},current,{messages,agendas:array(current.agendas).slice(-59).concat([agenda]),updatedAt:iso(),updatedBy:text(actorId)||"administrator"});
  const saved=await persist(actorId,next);
  return {ok:true,version:VERSION,workspace:saved,agenda,ai:{provider:ai.provider,model:ai.model,error:agenda.error||null,language:ai.language}};
}
async function deleteAgenda(actorId,input){
  const raw=plain(input),scope=normalizeScope(raw.scope||raw.section||"all"),id=text(raw.agendaId||raw.id);
  if(!id){const e=new Error("삭제할 안건을 선택해 주세요.");e.statusCode=400;throw e;}
  const current=(await getWorkspace(scope)).workspace,before=array(current.agendas),agendas=before.filter(a=>text(a&&a.id)!==id),messages=array(current.messages).filter(m=>text(m&&m.agendaId)!==id);
  const saved=await persist(actorId,Object.assign({},current,{agendas,messages,updatedAt:iso(),updatedBy:text(actorId)||"administrator"}));
  return {ok:true,version:VERSION,deleted:before.length-agendas.length,workspace:saved};
}
async function clearWorkspace(actorId,input){
  const scope=normalizeScope(plain(input).scope||plain(input).section||"all"),current=(await getWorkspace(scope)).workspace;
  const saved=await persist(actorId,Object.assign({},current,{messages:[],agendas:[],updatedAt:iso(),updatedBy:text(actorId)||"administrator"}));
  return {ok:true,version:VERSION,cleared:true,workspace:saved};
}
async function getAgenda(scopeValue,id){
  const scope=normalizeScope(scopeValue),workspace=(await getWorkspace(scope)).workspace,agenda=array(workspace.agendas).find(a=>text(a&&a.id)===text(id));
  if(!agenda){const e=new Error("선택한 AI 정책 안건을 찾을 수 없습니다.");e.statusCode=404;throw e;}
  return agenda;
}
function executionQuery(agenda){
  const a=plain(agenda),parts=[clean(a.researchQuery,1200)];
  if(array(a.includeTerms).length) parts.push(array(a.includeTerms).slice(0,12).join(" "));
  if(array(a.avoidTerms).length) parts.push(array(a.avoidTerms).slice(0,10).map(v=>"-"+clean(v,80).replace(/\s+/g," ")).join(" "));
  return clean(parts.filter(Boolean).join(" "),1800);
}

module.exports={VERSION,normalizeScope,scopeLabel,getWorkspace,discuss,deleteAgenda,clearWorkspace,getAgenda,executionQuery};
