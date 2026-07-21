"use strict";

/*
 * IGDC administrator policy discussion and manual-priority workspace.
 *
 * Scope precedence:
 *   country/subdivision administrator decision
 *   > regional administrator decision
 *   > global administrator decision
 *   > automatic market-signal weighting
 *
 * This module stores policy discussion and final administrator decisions only.
 * It cannot weaken supplier trust, legal, safety, payment, shipping, return,
 * refund, or customer-support gates and cannot publish products.
 */

const SlotStore = require("./global-slot-console-supabase");
const MarketSignals = require("./commerce-market-signal-intelligence.v1");

const VERSION = "commerce-policy-discussion-v1.0.0";
const PREFIX = "igdc_policy_discussion_";
const DEFAULT_MODEL = "gpt-4o-mini";
const CATEGORY_KEYS = MarketSignals.CATEGORY_KEYS || [];
const CATEGORY_LABELS = MarketSignals.CATEGORY_LABELS || {};
const STATUS_VALUES = new Set(["draft", "active", "paused"]);

function text(value){return value==null?"":String(value).trim();}
function lower(value){return text(value).toLowerCase().replace(/[\s.]+/g,"_");}
function plain(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function array(value){return Array.isArray(value)?value:[];}
function clamp(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function iso(){return new Date().toISOString();}
function envFirst(){for(const name of arguments){const value=text(process.env[name]);if(value)return value;}return "";}
function clean(value,limit){return text(value).replace(/\s+/g," ").slice(0,limit||500);}
function cleanList(value,limit,itemLimit){const out=[];for(const raw of array(value)){const item=clean(raw,itemLimit||180);if(item&&!out.includes(item))out.push(item);if(out.length>=(limit||20))break;}return out;}
function parseJson(value){const raw=text(value);if(!raw)return null;try{return JSON.parse(raw);}catch(_e){}const start=raw.indexOf("{");const end=raw.lastIndexOf("}");if(start>=0&&end>start){try{return JSON.parse(raw.slice(start,end+1));}catch(_e){}}return null;}
function slug(value){return lower(value).replace(/[^a-z0-9_-]/g,"").slice(0,80);}
function normalizeCountry(value){const code=text(value).toUpperCase();return /^[A-Z]{2}$/.test(code)?code:"";}
function normalizeRegion(value){return text(value).toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,80)||"NATIONWIDE";}
function categoryWeights(value){const source=plain(value),out={};for(const key of CATEGORY_KEYS)out[key]=Math.round(clamp(source[key],-20,20,0));return out;}
function safeStatus(value){const status=lower(value);return STATUS_VALUES.has(status)?status:"draft";}
function addDays(date,days){return new Date(date.getTime()+Math.max(1,days)*86400000);}

function normalizeScope(input){
  const raw=plain(input),scopeType=lower(raw.scopeType||raw.type||"global");
  if(!["global","regional","country"].includes(scopeType)){const error=new Error("정책 협의 범위가 올바르지 않습니다.");error.statusCode=400;throw error;}
  const regionGroup=scopeType==="global"?null:slug(raw.regionGroup);
  const countryCode=scopeType==="country"?normalizeCountry(raw.countryCode||raw.country):null;
  const subdivisionCode=scopeType==="country"?normalizeRegion(raw.subdivisionCode||raw.regionCode||raw.region||"NATIONWIDE"):null;
  if(scopeType==="regional"&&!regionGroup){const error=new Error("권역 정책 협의를 위한 권역 코드가 필요합니다.");error.statusCode=400;throw error;}
  if(scopeType==="country"&&(!countryCode||countryCode==="KP")){const error=new Error("국가 정책 협의를 위한 지원 국가 코드가 필요합니다.");error.statusCode=400;throw error;}
  return{scopeType,regionGroup:regionGroup||null,countryCode:countryCode||null,subdivisionCode:subdivisionCode||null,
    scopeLabel:clean(raw.scopeLabel||raw.label,180)||null};
}
function policyId(scope){
  if(scope.scopeType==="global")return PREFIX+"global";
  if(scope.scopeType==="regional")return PREFIX+"region_"+slug(scope.regionGroup);
  return PREFIX+"country_"+scope.countryCode.toLowerCase()+"_"+lower(scope.subdivisionCode||"NATIONWIDE").replace(/[^a-z0-9_-]/g,"");
}
function defaultWorkspace(scope){
  return{
    schema:"igdc-policy-discussion-workspace.v1",version:VERSION,id:policyId(scope),scope,
    status:"draft",administratorInstruction:"",finalDecision:"",categoryWeights:categoryWeights({}),
    priorityDirections:[],avoidDirections:[],manualPriorityTargets:[],manualBlockedTargets:[],
    validityDays:scope.scopeType==="global"?30:scope.scopeType==="regional"?21:30,
    validFrom:null,validUntil:null,messages:[],latestProposal:null,updatedAt:null,updatedBy:null
  };
}
function workspaceFromRow(row,scope){
  const rule=plain(row&&row.rule),stored=plain(rule.policyWorkspace),base=defaultWorkspace(scope);
  const messages=array(stored.messages).slice(-30).map((message)=>({role:["user","assistant","system"].includes(text(message&&message.role))?text(message.role):"system",content:clean(message&&message.content,4000),createdAt:text(message&&message.createdAt)||null})).filter((message)=>message.content);
  return Object.assign({},base,stored,{
    id:text(row&&row.id)||base.id,scope:Object.assign({},scope,plain(stored.scope)),status:safeStatus(stored.status),
    administratorInstruction:clean(stored.administratorInstruction,5000),finalDecision:clean(stored.finalDecision,5000),
    categoryWeights:categoryWeights(stored.categoryWeights),priorityDirections:cleanList(stored.priorityDirections,20,240),avoidDirections:cleanList(stored.avoidDirections,20,240),
    manualPriorityTargets:cleanList(stored.manualPriorityTargets,50,260),manualBlockedTargets:cleanList(stored.manualBlockedTargets,50,260),
    validityDays:Math.round(clamp(stored.validityDays,1,180,base.validityDays)),messages,latestProposal:plain(stored.latestProposal),
    validFrom:text(stored.validFrom)||null,validUntil:text(stored.validUntil)||null,updatedAt:text(row&&row.updated_at||stored.updatedAt)||null,updatedBy:text(row&&row.updated_by||stored.updatedBy)||null
  });
}
async function policyRows(){
  const rows=await SlotStore.select("gslot_policies","select=id,name,scope_hub,scope_country,scope_region,enabled,rule,updated_at,updated_by&scope_hub=eq.country-commerce-control&order=updated_at.desc&limit=1000");
  return array(rows).filter((row)=>text(row&&row.id).startsWith(PREFIX));
}
async function getWorkspace(input){
  const scope=normalizeScope(input),id=policyId(scope);let rows=[],storageAvailable=true,storageError=null;
  try{rows=await policyRows();}catch(error){storageAvailable=false;storageError=clean(error&&error.message||error,240);}
  const row=rows.find((item)=>text(item&&item.id)===id),workspace=row?workspaceFromRow(row,scope):defaultWorkspace(scope);
  return{ok:true,version:VERSION,storage:{available:storageAvailable,error:storageError},workspace,policy:{precedence:["country_manual","regional_manual","global_manual","automatic_ai"],trustGateImmutable:true,automaticPublication:false}};
}
async function persistWorkspace(actorId,workspace){
  const scope=normalizeScope(workspace.scope),id=policyId(scope),now=iso(),rows=await policyRows(),existing=rows.find((row)=>text(row&&row.id)===id);
  const normalized=workspaceFromRow({id,rule:{policyWorkspace:workspace},updated_at:now,updated_by:text(actorId)||"administrator"},scope);
  const row={id,name:scope.scopeType==="global"?"전 세계 관리자 정책 협의":scope.scopeType==="regional"?"권역 관리자 정책 협의":"국가·지역 관리자 정책·수동 통제",scope_hub:"country-commerce-control",scope_country:scope.countryCode,scope_region:scope.scopeType==="regional"?scope.regionGroup:scope.subdivisionCode,enabled:normalized.status==="active",rule:{schema:VERSION,policyWorkspace:normalized},updated_at:now,updated_by:text(actorId)||"administrator"};
  if(!existing)row.created_at=now;
  const saved=await SlotStore.insert("gslot_policies",row,"resolution=merge-duplicates,return=representation");
  return workspaceFromRow(array(saved)[0]||row,scope);
}
function proposalFromParsed(parsed,scope){
  const raw=plain(parsed),weights=categoryWeights(raw.categoryWeights),validityDefault=scope.scopeType==="global"?30:scope.scopeType==="regional"?21:30;
  return{
    summary:clean(raw.summary,1000),objectives:cleanList(raw.objectives,12,260),categoryWeights:weights,
    priorityDirections:cleanList(raw.priorityDirections,15,260),avoidDirections:cleanList(raw.avoidDirections,15,260),
    manualPriorityTargets:scope.scopeType==="country"?cleanList(raw.manualPriorityTargets,40,260):[],
    manualBlockedTargets:scope.scopeType==="country"?cleanList(raw.manualBlockedTargets,40,260):[],
    executionPlan:cleanList(raw.executionPlan,15,320),risks:cleanList(raw.risks,15,300),evidenceNeeded:cleanList(raw.evidenceNeeded,15,300),
    validityDays:Math.round(clamp(raw.validityDays,1,180,validityDefault)),confidence:Math.round(clamp(raw.confidence,0,100,0)),
    safety:{trustGateChanged:false,supplierApproval:false,productImport:false,publicPublication:false,administratorDecisionRequired:true}
  };
}
function fallbackProposal(scope,error){return{summary:"AI 정책 협의를 완료하지 못했습니다. 관리자 지시를 초안으로 보존하고 자동 운영에는 반영하지 않습니다.",objectives:[],categoryWeights:categoryWeights({}),priorityDirections:[],avoidDirections:[],manualPriorityTargets:[],manualBlockedTargets:[],executionPlan:[],risks:[clean(error,240)||"AI_POLICY_DISCUSSION_FAILED"],evidenceNeeded:["관리자 검토와 최신 세계·권역·국가 근거 확인"],validityDays:scope.scopeType==="global"?30:scope.scopeType==="regional"?21:30,confidence:0,safety:{trustGateChanged:false,supplierApproval:false,productImport:false,publicPublication:false,administratorDecisionRequired:true}};}
async function aiProposal(scope,workspace,instruction,context){
  const key=envFirst("OPENAI_API_KEY","OPENAI_KEY");if(!key)return{provider:"unavailable",model:null,error:"OPENAI_API_KEY_missing",proposal:fallbackProposal(scope,"OPENAI_API_KEY_missing")};
  const model=envFirst("IGDC_POLICY_DISCUSSION_MODEL","IGDC_COUNTRY_AUTOMATION_MODEL","OPENAI_MODEL")||DEFAULT_MODEL;
  const controller=typeof AbortController!=="undefined"?new AbortController():null;const timer=controller?setTimeout(()=>controller.abort(),45000):null;
  try{
    const response=await fetch((envFirst("OPENAI_BASE_URL")||"https://api.openai.com/v1").replace(/\/+$/g,"")+"/chat/completions",{method:"POST",signal:controller?controller.signal:undefined,headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({model,temperature:0.1,response_format:{type:"json_object"},messages:[
      {role:"system",content:"You are the IGDC policy planning assistant. Discuss and structure administrator policy for a distribution-service intermediary. Scope may be global, regional, or country. Administrator decisions outrank normal automation. Country manual supplier/product priorities and blocks outrank regional/global policy. Never weaken legal, safety, supplier identity, direct-sales, payment, shipping, returns, refunds, after-sales, customer-support, sanctions, recall, fraud, or copyright gates. Never claim a supplier or product is verified without evidence. Never publish or import products. Use only the provided saved signal context and administrator instruction; label assumptions and list evidence needed. Return JSON only with: summary, objectives[], categoryWeights using only supplied category keys and integer -20..20, priorityDirections[], avoidDirections[], manualPriorityTargets[] and manualBlockedTargets[] only for country scope, executionPlan[], risks[], evidenceNeeded[], validityDays, confidence."},
      {role:"user",content:JSON.stringify({scope,categories:CATEGORY_KEYS,categoryLabels:CATEGORY_LABELS,administratorInstruction:instruction,existingDecision:workspace.finalDecision||null,existingProposal:workspace.latestProposal||null,savedSignalContext:context||null,precedence:["country administrator manual control","regional administrator policy","global administrator policy","automatic AI"]})}
    ]})});
    const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(clean(body&&body.error&&body.error.message||"OpenAI HTTP "+response.status,240));
    const parsed=parseJson(body&&body.choices&&body.choices[0]&&body.choices[0].message&&body.choices[0].message.content);if(!parsed)throw new Error("policy_discussion_json_invalid");
    return{provider:"openai",model,error:null,proposal:proposalFromParsed(parsed,scope)};
  }catch(error){return{provider:"fallback",model,error:clean(error&&error.message||error,240),proposal:fallbackProposal(scope,error&&error.message||error)};}
  finally{if(timer)clearTimeout(timer);}
}
async function discuss(actorId,input){
  const raw=plain(input),scope=normalizeScope(raw.scope||raw),current=await getWorkspace(scope),workspace=current.workspace,instruction=clean(raw.instruction||raw.administratorInstruction,5000);
  if(!instruction){const error=new Error("AI와 협의할 정책 지시 또는 질문을 입력해 주세요.");error.statusCode=400;throw error;}
  let signalContext=null;try{signalContext=await MarketSignals.signalStatus(scope.scopeType==="global"?"":scope.regionGroup);}catch(error){signalContext={ok:false,error:clean(error&&error.message||error,240)};}
  const ai=await aiProposal(scope,workspace,instruction,signalContext),now=iso(),messages=array(workspace.messages).slice(-26);
  messages.push({role:"user",content:instruction,createdAt:now});
  messages.push({role:"assistant",content:ai.proposal.summary||"정책안을 작성했습니다.",createdAt:iso()});
  const next=Object.assign({},workspace,{scope,status:workspace.status||"draft",administratorInstruction:instruction,messages,latestProposal:Object.assign({},ai.proposal,{provider:ai.provider,model:ai.model,error:ai.error||null,generatedAt:iso()}),updatedAt:iso(),updatedBy:text(actorId)||"administrator"});
  const saved=await persistWorkspace(actorId,next);
  return{ok:true,version:VERSION,workspace:saved,ai:{provider:ai.provider,model:ai.model,error:ai.error||null,proposal:ai.proposal},safety:ai.proposal.safety};
}
async function saveDecision(actorId,input){
  const raw=plain(input),scope=normalizeScope(raw.scope||raw),current=await getWorkspace(scope),workspace=current.workspace,status=safeStatus(raw.status||workspace.status),validityDays=Math.round(clamp(raw.validityDays,1,180,workspace.validityDays||30)),now=new Date();
  const finalDecision=clean(raw.finalDecision,5000);if(status==="active"&&!finalDecision){const error=new Error("활성 정책으로 저장하려면 관리자가 확정한 결정 내용을 입력해야 합니다.");error.statusCode=400;throw error;}
  const proposal=plain(raw.latestProposal||workspace.latestProposal),weights=categoryWeights(raw.categoryWeights||proposal.categoryWeights||workspace.categoryWeights);
  const next=Object.assign({},workspace,{scope,status,administratorInstruction:clean(raw.administratorInstruction||workspace.administratorInstruction,5000),finalDecision,categoryWeights:weights,
    priorityDirections:cleanList(raw.priorityDirections||proposal.priorityDirections||workspace.priorityDirections,20,260),avoidDirections:cleanList(raw.avoidDirections||proposal.avoidDirections||workspace.avoidDirections,20,260),
    manualPriorityTargets:scope.scopeType==="country"?cleanList(raw.manualPriorityTargets||proposal.manualPriorityTargets||workspace.manualPriorityTargets,50,260):[],
    manualBlockedTargets:scope.scopeType==="country"?cleanList(raw.manualBlockedTargets||proposal.manualBlockedTargets||workspace.manualBlockedTargets,50,260):[],
    validityDays,validFrom:status==="active"?now.toISOString():workspace.validFrom,validUntil:status==="active"?addDays(now,validityDays).toISOString():workspace.validUntil,
    updatedAt:iso(),updatedBy:text(actorId)||"administrator"});
  const saved=await persistWorkspace(actorId,next);
  return{ok:true,version:VERSION,workspace:saved,safety:{administratorPrecedence:true,trustGateChanged:false,supplierApproval:false,productImport:false,publicPublication:false}};
}
function activeWorkspace(workspace){
  if(!workspace||workspace.status!=="active")return null;const until=Date.parse(text(workspace.validUntil));if(Number.isFinite(until)&&until<=Date.now())return null;return workspace;
}
function overlayWeights(base,workspace){const out=Object.assign({},categoryWeights(base));if(!workspace)return out;const source=categoryWeights(workspace.categoryWeights);for(const key of CATEGORY_KEYS){if(Number(source[key])!==0)out[key]=source[key];}return out;}
function uniqueConcat(){const out=[];for(const list of arguments){for(const item of array(list)){const cleanItem=clean(item,260);if(cleanItem&&!out.some((row)=>row.toLowerCase()===cleanItem.toLowerCase()))out.push(cleanItem);}}return out;}
async function effectivePolicy(input){
  const scope=normalizeScope(Object.assign({scopeType:"country"},input||{})),rows=await policyRows();
  const globalScope=normalizeScope({scopeType:"global"}),regionalScope=scope.regionGroup?normalizeScope({scopeType:"regional",regionGroup:scope.regionGroup}):null,countryScope=scope.countryCode?scope:null;
  const find=(target)=>target&&rows.find((row)=>text(row&&row.id)===policyId(target));
  const global=activeWorkspace(find(globalScope)?workspaceFromRow(find(globalScope),globalScope):null),regional=activeWorkspace(regionalScope&&find(regionalScope)?workspaceFromRow(find(regionalScope),regionalScope):null),country=activeWorkspace(countryScope&&find(countryScope)?workspaceFromRow(find(countryScope),countryScope):null);
  let weights=categoryWeights({});weights=overlayWeights(weights,global);weights=overlayWeights(weights,regional);weights=overlayWeights(weights,country);
  const sources=[global&&{type:"global",id:global.id,validUntil:global.validUntil},regional&&{type:"regional",id:regional.id,validUntil:regional.validUntil},country&&{type:"country",id:country.id,validUntil:country.validUntil}].filter(Boolean);
  return{ok:true,version:VERSION,active:sources.length>0,scope,categoryWeights:weights,priorityDirections:uniqueConcat(country&&country.priorityDirections,regional&&regional.priorityDirections,global&&global.priorityDirections),avoidDirections:uniqueConcat(country&&country.avoidDirections,regional&&regional.avoidDirections,global&&global.avoidDirections),manualPriorityTargets:uniqueConcat(country&&country.manualPriorityTargets),manualBlockedTargets:uniqueConcat(country&&country.manualBlockedTargets),finalDecision:clean(country&&country.finalDecision||regional&&regional.finalDecision||global&&global.finalDecision,3000),sources,precedence:["country_manual","regional_manual","global_manual","automatic_ai"],safety:{trustGateImmutable:true,administratorPrecedence:true,automaticSupplierApproval:false,automaticProductImport:false,automaticPublication:false}};
}
function mergeWithAutomaticWeights(automaticWeights,policy){
  const out=categoryWeights(automaticWeights),manual=plain(policy&&policy.categoryWeights);for(const key of CATEGORY_KEYS){if(Number(manual[key])!==0)out[key]=Math.round(clamp(manual[key],-20,20,0));}return out;
}

module.exports={VERSION,CATEGORY_KEYS,CATEGORY_LABELS,normalizeScope,getWorkspace,discuss,saveDecision,effectivePolicy,mergeWithAutomaticWeights};
