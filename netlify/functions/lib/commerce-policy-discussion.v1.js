"use strict";

/*
 * IGDC administrator AI discussion + policy workspace.
 *
 * Canonical policy workspace precedence remains:
 *   country/subdivision administrator decision
 *   > regional administrator decision
 *   > global administrator decision
 *   > automatic market-signal weighting
 *
 * Additional block/section workspaces are discussion notebooks. They can keep
 * operational opinions, problems and improvement ideas without affecting live
 * policy until the administrator explicitly promotes a decision to the canonical
 * policy workspace. Trust/legal/safety/payment/shipping/return/refund/support
 * gates are immutable here and no product publication is performed.
 */

const crypto = require("crypto");
const SlotStore = require("./global-slot-console-supabase");
const MarketSignals = require("./commerce-market-signal-intelligence.v1");

const VERSION = "commerce-policy-discussion-v1.3.0-block-section-workspaces";
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
function slug(value){return lower(value).replace(/[^a-z0-9_-]/g,"").slice(0,96);}
function normalizeCountry(value){const code=text(value).toUpperCase();return /^[A-Z]{2}$/.test(code)?code:"";}
function normalizeRegion(value){return text(value).toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,80)||"NATIONWIDE";}
function categoryWeights(value){const source=plain(value),out={};for(const key of CATEGORY_KEYS)out[key]=Math.round(clamp(source[key],-20,20,0));return out;}
function safeStatus(value){const status=lower(value);return STATUS_VALUES.has(status)?status:"draft";}
function addDays(date,days){return new Date(date.getTime()+Math.max(1,days)*86400000);}
function messageId(){return "m_"+Date.now().toString(36)+"_"+crypto.randomBytes(6).toString("hex");}
function workspaceKey(value){return slug(value)||"policy";}
function isCanonical(scope){return workspaceKey(scope&&scope.workspaceKey)==="policy";}

function responseLanguage(instruction,requested){
  const req=text(requested).toLowerCase();
  const known={"ko":"Korean","ko-kr":"Korean","en":"English","en-us":"English","ja":"Japanese","ja-jp":"Japanese","zh":"Chinese","zh-cn":"Simplified Chinese","zh-tw":"Traditional Chinese","es":"Spanish","es-es":"Spanish","fr":"French","fr-fr":"French","de":"German","de-de":"German","pt":"Portuguese","pt-br":"Brazilian Portuguese","ar":"Arabic","ar-sa":"Arabic","hi":"Hindi","hi-in":"Hindi","id":"Indonesian","id-id":"Indonesian","vi":"Vietnamese","vi-vn":"Vietnamese","th":"Thai","th-th":"Thai"};
  if(req&&req!=="auto"&&known[req])return{code:req,name:known[req]};
  const sample=text(instruction);
  if(/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(sample))return{code:"ko-KR",name:"Korean"};
  if(/[ぁ-んァ-ヶ]/.test(sample))return{code:"ja-JP",name:"Japanese"};
  if(/[\u4e00-\u9fff]/.test(sample))return{code:"zh-CN",name:"Chinese"};
  if(/[\u0600-\u06ff]/.test(sample))return{code:"ar-SA",name:"Arabic"};
  if(/[\u0900-\u097f]/.test(sample))return{code:"hi-IN",name:"Hindi"};
  if(/[\u0e00-\u0e7f]/.test(sample))return{code:"th-TH",name:"Thai"};
  return{code:"en-US",name:"English"};
}

function normalizeScope(input){
  const raw=plain(input),scopeType=lower(raw.scopeType||raw.type||"global");
  if(!["global","regional","country"].includes(scopeType)){const error=new Error("정책 협의 범위가 올바르지 않습니다.");error.statusCode=400;throw error;}
  const regionGroup=scopeType==="global"?null:slug(raw.regionGroup);
  const countryCode=scopeType==="country"?normalizeCountry(raw.countryCode||raw.country):null;
  const subdivisionCode=scopeType==="country"?normalizeRegion(raw.subdivisionCode||raw.regionCode||raw.region||"NATIONWIDE"):null;
  if(scopeType==="regional"&&!regionGroup){const error=new Error("권역 정책 협의를 위한 권역 코드가 필요합니다.");error.statusCode=400;throw error;}
  if(scopeType==="country"&&(!countryCode||countryCode==="KP")){const error=new Error("국가 정책 협의를 위한 지원 국가 코드가 필요합니다.");error.statusCode=400;throw error;}
  return{scopeType,regionGroup:regionGroup||null,countryCode:countryCode||null,subdivisionCode:subdivisionCode||null,
    scopeLabel:clean(raw.scopeLabel||raw.label,180)||null,workspaceKey:workspaceKey(raw.workspaceKey||raw.topicKey||"policy"),workspaceLabel:clean(raw.workspaceLabel||raw.topicLabel,180)||null};
}
function policyId(scopeInput){
  const scope=normalizeScope(scopeInput),base=scope.scopeType==="global"?PREFIX+"global":scope.scopeType==="regional"?PREFIX+"region_"+slug(scope.regionGroup):PREFIX+"country_"+scope.countryCode.toLowerCase()+"_"+lower(scope.subdivisionCode||"NATIONWIDE").replace(/[^a-z0-9_-]/g,"");
  return isCanonical(scope)?base:base+"__workspace_"+workspaceKey(scope.workspaceKey);
}
function defaultWorkspace(scopeInput){
  const scope=normalizeScope(scopeInput);
  return{schema:"igdc-policy-discussion-workspace.v2",version:VERSION,id:policyId(scope),scope,workspaceKey:scope.workspaceKey,workspaceLabel:scope.workspaceLabel||null,workspaceMode:isCanonical(scope)?"policy":"discussion",
    status:"draft",administratorInstruction:"",finalDecision:"",categoryWeights:categoryWeights({}),priorityDirections:[],avoidDirections:[],manualPriorityTargets:[],manualBlockedTargets:[],
    validityDays:scope.scopeType==="global"?30:scope.scopeType==="regional"?21:30,validFrom:null,validUntil:null,messages:[],latestProposal:null,updatedAt:null,updatedBy:null,promotedFrom:null};
}
function normalizeMessage(message,index){
  const role=["user","assistant","system"].includes(text(message&&message.role))?text(message.role):"system",content=clean(message&&message.content,4000),createdAt=text(message&&message.createdAt)||null;
  if(!content)return null;
  const id=clean(message&&message.id,120)||("legacy_"+String(index)+"_"+crypto.createHash("sha1").update(role+"|"+content+"|"+(createdAt||"")).digest("hex").slice(0,14));
  return{id,role,content,createdAt,language:text(message&&message.language)||null};
}
function workspaceFromRow(row,scopeInput){
  const scope=normalizeScope(scopeInput),rule=plain(row&&row.rule),stored=plain(rule.policyWorkspace),base=defaultWorkspace(scope),messages=array(stored.messages).slice(-80).map(normalizeMessage).filter(Boolean);
  const mergedScope=normalizeScope(Object.assign({},scope,plain(stored.scope),{workspaceKey:scope.workspaceKey,workspaceLabel:scope.workspaceLabel||plain(stored.scope).workspaceLabel||stored.workspaceLabel}));
  return Object.assign({},base,stored,{id:text(row&&row.id)||base.id,scope:mergedScope,workspaceKey:mergedScope.workspaceKey,workspaceLabel:mergedScope.workspaceLabel||stored.workspaceLabel||null,workspaceMode:isCanonical(mergedScope)?"policy":"discussion",status:safeStatus(stored.status),
    administratorInstruction:clean(stored.administratorInstruction,5000),finalDecision:clean(stored.finalDecision,5000),categoryWeights:categoryWeights(stored.categoryWeights),priorityDirections:cleanList(stored.priorityDirections,20,240),avoidDirections:cleanList(stored.avoidDirections,20,240),manualPriorityTargets:cleanList(stored.manualPriorityTargets,50,260),manualBlockedTargets:cleanList(stored.manualBlockedTargets,50,260),
    validityDays:Math.round(clamp(stored.validityDays,1,180,base.validityDays)),messages,latestProposal:plain(stored.latestProposal),validFrom:text(stored.validFrom)||null,validUntil:text(stored.validUntil)||null,updatedAt:text(row&&row.updated_at||stored.updatedAt)||null,updatedBy:text(row&&row.updated_by||stored.updatedBy)||null});
}
async function policyRows(){const rows=await SlotStore.select("gslot_policies","select=id,name,scope_hub,scope_country,scope_region,enabled,rule,updated_at,updated_by&scope_hub=eq.country-commerce-control&order=updated_at.desc&limit=1500");return array(rows).filter((row)=>text(row&&row.id).startsWith(PREFIX));}
async function getWorkspace(input){
  const scope=normalizeScope(input),id=policyId(scope);let rows=[],storageAvailable=true,storageError=null;try{rows=await policyRows();}catch(error){storageAvailable=false;storageError=clean(error&&error.message||error,240);}
  const row=rows.find((item)=>text(item&&item.id)===id),workspace=row?workspaceFromRow(row,scope):defaultWorkspace(scope);
  return{ok:true,version:VERSION,storage:{available:storageAvailable,error:storageError},workspace,policy:{canonical:isCanonical(scope),workspaceMode:workspace.workspaceMode,precedence:["country_manual","regional_manual","global_manual","automatic_ai"],trustGateImmutable:true,automaticPublication:false}};
}
async function persistWorkspace(actorId,workspaceInput){
  const workspace=plain(workspaceInput),scope=normalizeScope(workspace.scope),id=policyId(scope),now=iso(),rows=await policyRows(),existing=rows.find((row)=>text(row&&row.id)===id),normalized=workspaceFromRow({id,rule:{policyWorkspace:workspace},updated_at:now,updated_by:text(actorId)||"administrator"},scope);
  const baseName=scope.scopeType==="global"?"전 세계 관리자":scope.scopeType==="regional"?"권역 관리자":"국가·지역 관리자",topic=isCanonical(scope)?"정책 협의":((scope.workspaceLabel||scope.workspaceKey)+" 운영 대화");
  const row={id,name:baseName+" · "+topic,scope_hub:"country-commerce-control",scope_country:scope.countryCode,scope_region:scope.scopeType==="regional"?scope.regionGroup:scope.subdivisionCode,enabled:isCanonical(scope)&&normalized.status==="active",rule:{schema:VERSION,policyWorkspace:normalized},updated_at:now,updated_by:text(actorId)||"administrator"};if(!existing)row.created_at=now;
  const saved=await SlotStore.insert("gslot_policies",row,"resolution=merge-duplicates,return=representation");return workspaceFromRow(array(saved)[0]||row,scope);
}
function proposalFromParsed(parsed,scope){const raw=plain(parsed),weights=categoryWeights(raw.categoryWeights),validityDefault=scope.scopeType==="global"?30:scope.scopeType==="regional"?21:30;return{summary:clean(raw.summary,1400),objectives:cleanList(raw.objectives,15,300),categoryWeights:weights,priorityDirections:cleanList(raw.priorityDirections,20,300),avoidDirections:cleanList(raw.avoidDirections,20,300),manualPriorityTargets:scope.scopeType==="country"?cleanList(raw.manualPriorityTargets,50,300):[],manualBlockedTargets:scope.scopeType==="country"?cleanList(raw.manualBlockedTargets,50,300):[],executionPlan:cleanList(raw.executionPlan,20,360),risks:cleanList(raw.risks,20,340),evidenceNeeded:cleanList(raw.evidenceNeeded,20,340),validityDays:Math.round(clamp(raw.validityDays,1,180,validityDefault)),confidence:Math.round(clamp(raw.confidence,0,100,0)),safety:{trustGateChanged:false,supplierApproval:false,productImport:false,publicPublication:false,administratorDecisionRequired:true}};}
function fallbackSummary(language){
  const code=lower(language&&language.code).replace(/_/g,"-"),map={
    "ko-kr":"AI 협의를 완료하지 못했습니다. 관리자 입력은 초안으로 보존하고 자동 운영에는 반영하지 않습니다.",
    "en-us":"The AI discussion could not be completed. The administrator input was preserved as a draft and was not applied to automation.",
    "ja-jp":"AIとの協議を完了できませんでした。管理者の入力は下書きとして保存され、自動運用には反映されません。",
    "zh-cn":"AI 对话未能完成。管理员输入已作为草稿保存，不会应用到自动运营。",
    "zh-tw":"AI 對話未能完成。管理員輸入已作為草稿保存，不會套用到自動營運。",
    "es-es":"No se pudo completar la conversación con la IA. La entrada del administrador se guardó como borrador y no se aplicó a la operación automática.",
    "fr-fr":"La discussion avec l’IA n’a pas pu être terminée. La saisie de l’administrateur a été conservée comme brouillon et n’a pas été appliquée à l’automatisation.",
    "de-de":"Die KI-Abstimmung konnte nicht abgeschlossen werden. Die Administratoreingabe wurde als Entwurf gespeichert und nicht auf den automatischen Betrieb angewendet.",
    "pt-br":"A conversa com a IA não pôde ser concluída. A entrada do administrador foi salva como rascunho e não foi aplicada à operação automática.",
    "ar-sa":"تعذر إكمال الحوار مع الذكاء الاصطناعي. تم حفظ إدخال المسؤول كمسودة ولم يتم تطبيقه على التشغيل التلقائي.",
    "hi-in":"AI संवाद पूरा नहीं हो सका। व्यवस्थापक का इनपुट मसौदे के रूप में सुरक्षित किया गया है और स्वचालित संचालन पर लागू नहीं किया गया है।",
    "id-id":"Diskusi AI tidak dapat diselesaikan. Masukan administrator disimpan sebagai draf dan tidak diterapkan pada operasi otomatis.",
    "vi-vn":"Không thể hoàn tất cuộc trao đổi với AI. Nội dung của quản trị viên đã được lưu dưới dạng bản nháp và chưa được áp dụng vào vận hành tự động.",
    "th-th":"ไม่สามารถดำเนินการสนทนากับ AI ให้เสร็จสมบูรณ์ได้ ข้อมูลของผู้ดูแลระบบถูกบันทึกเป็นฉบับร่างและยังไม่ถูกนำไปใช้กับการทำงานอัตโนมัติ"
  };return map[code]||map["en-us"];
}
function fallbackProposal(scope,error,language){return{summary:fallbackSummary(language),objectives:[],categoryWeights:categoryWeights({}),priorityDirections:[],avoidDirections:[],manualPriorityTargets:[],manualBlockedTargets:[],executionPlan:[],risks:[clean(error,240)||"AI_POLICY_DISCUSSION_FAILED"],evidenceNeeded:[],validityDays:scope.scopeType==="global"?30:scope.scopeType==="regional"?21:30,confidence:0,safety:{trustGateChanged:false,supplierApproval:false,productImport:false,publicPublication:false,administratorDecisionRequired:true}};}
async function aiProposal(scope,workspace,instruction,context,requestedLanguage){
  const language=responseLanguage(instruction,requestedLanguage),key=envFirst("OPENAI_API_KEY","OPENAI_KEY");if(!key)return{provider:"unavailable",model:null,error:"OPENAI_API_KEY_missing",language,proposal:fallbackProposal(scope,"OPENAI_API_KEY_missing",language)};
  const model=envFirst("IGDC_POLICY_DISCUSSION_MODEL","IGDC_COUNTRY_AUTOMATION_MODEL","OPENAI_MODEL")||DEFAULT_MODEL,controller=typeof AbortController!=="undefined"?new AbortController():null,timer=controller?setTimeout(()=>controller.abort(),45000):null;
  try{
    const recent=array(workspace.messages).slice(-12).map((m)=>({role:m.role,content:m.content}));
    const response=await fetch((envFirst("OPENAI_BASE_URL")||"https://api.openai.com/v1").replace(/\/+$/g,"")+"/chat/completions",{method:"POST",signal:controller?controller.signal:undefined,headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({model,temperature:0.15,response_format:{type:"json_object"},messages:[
      {role:"system",content:"You are the IGDC administrator AI operations and policy discussion assistant. The workspace may be a general site-operations notebook, a product-research block, a candidate-management block, or one specific distribution section. You may discuss operational problems, UX, research quality, supplier/product handling, placement, admin workflow and policy. Do not assume every discussion is a policy change. Clearly separate operational suggestions from policy candidates. Administrator decisions outrank normal automation. Never weaken legal, safety, supplier identity, direct-sales, payment, shipping, returns, refunds, after-sales, customer-support, sanctions, recall, fraud or copyright gates. Never claim verification without evidence. Never publish or import products. IMPORTANT LANGUAGE RULE: every natural-language string in the JSON response MUST be written in "+language.name+", matching the administrator's input language. Return JSON only with: summary, objectives[], categoryWeights using only supplied category keys and integer -20..20, priorityDirections[], avoidDirections[], manualPriorityTargets[] and manualBlockedTargets[] only for country scope, executionPlan[], risks[], evidenceNeeded[], validityDays, confidence."},
      {role:"user",content:JSON.stringify({responseLanguage:language,scope,workspace:{key:workspace.workspaceKey,label:workspace.workspaceLabel,mode:workspace.workspaceMode},categories:CATEGORY_KEYS,categoryLabels:CATEGORY_LABELS,administratorInstruction:instruction,recentConversation:recent,existingDecision:workspace.finalDecision||null,existingProposal:workspace.latestProposal||null,savedSignalContext:context||null,precedence:["country administrator manual control","regional administrator policy","global administrator policy","automatic AI"]})}
    ]})});
    const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(clean(body&&body.error&&body.error.message||"OpenAI HTTP "+response.status,240));const parsed=parseJson(body&&body.choices&&body.choices[0]&&body.choices[0].message&&body.choices[0].message.content);if(!parsed)throw new Error("policy_discussion_json_invalid");return{provider:"openai",model,error:null,language,proposal:proposalFromParsed(parsed,scope)};
  }catch(error){return{provider:"fallback",model,error:clean(error&&error.message||error,240),language,proposal:fallbackProposal(scope,error&&error.message||error,language)};}finally{if(timer)clearTimeout(timer);}
}
async function discuss(actorId,input){
  const raw=plain(input),scope=normalizeScope(raw.scope||raw),current=await getWorkspace(scope),workspace=current.workspace,instruction=clean(raw.instruction||raw.administratorInstruction,5000);if(!instruction){const error=new Error("AI와 협의할 운영 의견·질문 또는 정책 지시를 입력해 주세요.");error.statusCode=400;throw error;}
  let signalContext=null;try{signalContext=await MarketSignals.signalStatus(scope.scopeType==="global"?"":scope.regionGroup);}catch(error){signalContext={ok:false,error:clean(error&&error.message||error,240)};}
  const ai=await aiProposal(scope,workspace,instruction,signalContext,raw.language||raw.responseLanguage),now=iso(),messages=array(workspace.messages).slice(-76);messages.push({id:messageId(),role:"user",content:instruction,createdAt:now,language:ai.language.code});messages.push({id:messageId(),role:"assistant",content:ai.proposal.summary||"AI 검토 결과를 작성했습니다.",createdAt:iso(),language:ai.language.code});
  const next=Object.assign({},workspace,{scope,status:workspace.status||"draft",administratorInstruction:instruction,messages,latestProposal:Object.assign({},ai.proposal,{provider:ai.provider,model:ai.model,error:ai.error||null,language:ai.language,generatedAt:iso()}),updatedAt:iso(),updatedBy:text(actorId)||"administrator"});const saved=await persistWorkspace(actorId,next);
  return{ok:true,version:VERSION,workspace:saved,ai:{provider:ai.provider,model:ai.model,error:ai.error||null,language:ai.language,proposal:ai.proposal},safety:ai.proposal.safety};
}
async function saveDecision(actorId,input){
  const raw=plain(input),scope=normalizeScope(raw.scope||raw),current=await getWorkspace(scope),workspace=current.workspace,status=safeStatus(raw.status||workspace.status),validityDays=Math.round(clamp(raw.validityDays,1,180,workspace.validityDays||30)),now=new Date(),finalDecision=clean(raw.finalDecision,5000);if(status==="active"&&!finalDecision){const error=new Error("활성 정책으로 저장하려면 관리자가 확정한 결정 내용을 입력해야 합니다.");error.statusCode=400;throw error;}
  const proposal=plain(raw.latestProposal||workspace.latestProposal),weights=categoryWeights(raw.categoryWeights||proposal.categoryWeights||workspace.categoryWeights),next=Object.assign({},workspace,{scope,status,administratorInstruction:clean(raw.administratorInstruction||workspace.administratorInstruction,5000),finalDecision,categoryWeights:weights,priorityDirections:cleanList(raw.priorityDirections||proposal.priorityDirections||workspace.priorityDirections,20,260),avoidDirections:cleanList(raw.avoidDirections||proposal.avoidDirections||workspace.avoidDirections,20,260),manualPriorityTargets:scope.scopeType==="country"?cleanList(raw.manualPriorityTargets||proposal.manualPriorityTargets||workspace.manualPriorityTargets,50,260):[],manualBlockedTargets:scope.scopeType==="country"?cleanList(raw.manualBlockedTargets||proposal.manualBlockedTargets||workspace.manualBlockedTargets,50,260):[],validityDays,validFrom:status==="active"?now.toISOString():workspace.validFrom,validUntil:status==="active"?addDays(now,validityDays).toISOString():workspace.validUntil,updatedAt:iso(),updatedBy:text(actorId)||"administrator"});
  const saved=await persistWorkspace(actorId,next);return{ok:true,version:VERSION,workspace:saved,safety:{administratorPrecedence:true,canonicalPolicy:isCanonical(scope),trustGateChanged:false,supplierApproval:false,productImport:false,publicPublication:false}};
}
async function deleteMessages(actorId,input){
  const raw=plain(input),scope=normalizeScope(raw.scope||raw),current=await getWorkspace(scope),workspace=current.workspace,ids=new Set(array(raw.messageIds).map(text).filter(Boolean));if(!ids.size&&raw.all!==true){const error=new Error("삭제할 대화 기록을 선택하세요.");error.statusCode=400;throw error;}
  const before=array(workspace.messages),messages=raw.all===true?[]:before.filter((m)=>!ids.has(text(m&&m.id))),next=Object.assign({},workspace,{messages,updatedAt:iso(),updatedBy:text(actorId)||"administrator"}),saved=await persistWorkspace(actorId,next);return{ok:true,version:VERSION,deleted:Math.max(0,before.length-messages.length),workspace:saved};
}
async function clearDecision(actorId,input){
  const scope=normalizeScope(plain(input).scope||input),current=await getWorkspace(scope),workspace=current.workspace,next=Object.assign({},workspace,{status:"draft",finalDecision:"",categoryWeights:categoryWeights({}),priorityDirections:[],avoidDirections:[],manualPriorityTargets:[],manualBlockedTargets:[],validFrom:null,validUntil:null,updatedAt:iso(),updatedBy:text(actorId)||"administrator"}),saved=await persistWorkspace(actorId,next);return{ok:true,version:VERSION,workspace:saved,cleared:true};
}
async function deleteWorkspace(actorId,input){
  const scope=normalizeScope(plain(input).scope||input),id=policyId(scope);await SlotStore.remove("gslot_policies","id=eq."+encodeURIComponent(id));return{ok:true,version:VERSION,deleted:true,id,workspace:defaultWorkspace(scope)};
}
async function promoteToPolicy(actorId,input){
  const raw=plain(input),sourceScope=normalizeScope(raw.scope||raw);if(isCanonical(sourceScope)){return saveDecision(actorId,Object.assign({},raw,{scope:sourceScope,status:raw.status||"draft"}));}
  const source=(await getWorkspace(sourceScope)).workspace,canonicalScope=normalizeScope(Object.assign({},sourceScope,{workspaceKey:"policy",workspaceLabel:null})),current=(await getWorkspace(canonicalScope)).workspace,proposal=plain(source.latestProposal),decision=clean(raw.finalDecision||source.finalDecision||proposal.summary||source.administratorInstruction,5000);if(!decision){const error=new Error("정책 초안으로 반영할 대화·결정 내용이 없습니다.");error.statusCode=400;throw error;}
  const note={id:messageId(),role:"system",content:"운영 대화 작업공간 ["+(source.workspaceLabel||source.workspaceKey)+"]의 관리자 결정이 정책 초안으로 반영되었습니다.",createdAt:iso(),language:"ko-KR"};
  const next=Object.assign({},current,{scope:canonicalScope,status:safeStatus(raw.status||"draft"),administratorInstruction:source.administratorInstruction||current.administratorInstruction,finalDecision:decision,categoryWeights:categoryWeights(source.categoryWeights||proposal.categoryWeights||current.categoryWeights),priorityDirections:cleanList(source.priorityDirections||proposal.priorityDirections||current.priorityDirections,20,260),avoidDirections:cleanList(source.avoidDirections||proposal.avoidDirections||current.avoidDirections,20,260),manualPriorityTargets:canonicalScope.scopeType==="country"?cleanList(source.manualPriorityTargets||proposal.manualPriorityTargets||current.manualPriorityTargets,50,260):[],manualBlockedTargets:canonicalScope.scopeType==="country"?cleanList(source.manualBlockedTargets||proposal.manualBlockedTargets||current.manualBlockedTargets,50,260):[],messages:array(current.messages).slice(-77).concat([note]),promotedFrom:{workspaceKey:source.workspaceKey,workspaceLabel:source.workspaceLabel,workspaceId:source.id,promotedAt:iso()},updatedAt:iso(),updatedBy:text(actorId)||"administrator"});const saved=await persistWorkspace(actorId,next);return{ok:true,version:VERSION,sourceWorkspace:source,workspace:saved,promoted:true,canonicalScope};
}
function activeWorkspace(workspace){if(!workspace||workspace.status!=="active")return null;const until=Date.parse(text(workspace.validUntil));if(Number.isFinite(until)&&until<=Date.now())return null;return workspace;}
function overlayWeights(base,workspace){const out=Object.assign({},categoryWeights(base));if(!workspace)return out;const source=categoryWeights(workspace.categoryWeights);for(const key of CATEGORY_KEYS){if(Number(source[key])!==0)out[key]=source[key];}return out;}
function uniqueConcat(){const out=[];for(const list of arguments){for(const item of array(list)){const cleanItem=clean(item,260);if(cleanItem&&!out.some((row)=>row.toLowerCase()===cleanItem.toLowerCase()))out.push(cleanItem);}}return out;}
async function effectivePolicy(input){
  const scope=normalizeScope(Object.assign({scopeType:"country",workspaceKey:"policy"},input||{},{workspaceKey:"policy"})),rows=await policyRows(),globalScope=normalizeScope({scopeType:"global",workspaceKey:"policy"}),regionalScope=scope.regionGroup?normalizeScope({scopeType:"regional",regionGroup:scope.regionGroup,workspaceKey:"policy"}):null,countryScope=scope.countryCode?scope:null,find=(target)=>target&&rows.find((row)=>text(row&&row.id)===policyId(target));
  const global=activeWorkspace(find(globalScope)?workspaceFromRow(find(globalScope),globalScope):null),regional=activeWorkspace(regionalScope&&find(regionalScope)?workspaceFromRow(find(regionalScope),regionalScope):null),country=activeWorkspace(countryScope&&find(countryScope)?workspaceFromRow(find(countryScope),countryScope):null);let weights=categoryWeights({});weights=overlayWeights(weights,global);weights=overlayWeights(weights,regional);weights=overlayWeights(weights,country);
  const sources=[global&&{type:"global",id:global.id,validUntil:global.validUntil},regional&&{type:"regional",id:regional.id,validUntil:regional.validUntil},country&&{type:"country",id:country.id,validUntil:country.validUntil}].filter(Boolean);
  return{ok:true,version:VERSION,active:sources.length>0,scope,categoryWeights:weights,priorityDirections:uniqueConcat(country&&country.priorityDirections,regional&&regional.priorityDirections,global&&global.priorityDirections),avoidDirections:uniqueConcat(country&&country.avoidDirections,regional&&regional.avoidDirections,global&&global.avoidDirections),manualPriorityTargets:uniqueConcat(country&&country.manualPriorityTargets),manualBlockedTargets:uniqueConcat(country&&country.manualBlockedTargets),finalDecision:clean(country&&country.finalDecision||regional&&regional.finalDecision||global&&global.finalDecision,3000),sources,precedence:["country_manual","regional_manual","global_manual","automatic_ai"],safety:{trustGateImmutable:true,administratorPrecedence:true,automaticSupplierApproval:false,automaticProductImport:false,automaticPublication:false}};
}
function mergeWithAutomaticWeights(automaticWeights,policy){const out=categoryWeights(automaticWeights),manual=plain(policy&&policy.categoryWeights);for(const key of CATEGORY_KEYS){if(Number(manual[key])!==0)out[key]=Math.round(clamp(manual[key],-20,20,0));}return out;}

module.exports={VERSION,CATEGORY_KEYS,CATEGORY_LABELS,normalizeScope,getWorkspace,discuss,saveDecision,deleteMessages,clearDecision,deleteWorkspace,promoteToPolicy,effectivePolicy,mergeWithAutomaticWeights};
