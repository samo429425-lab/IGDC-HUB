"use strict";

/**
 * Administrator-only interface for the private commerce candidate staging
 * queue.  It never publishes a Snapshot and it never opens the release key.
 * Direct member listings may be submitted/reviewed here, but must still pass
 * registry sync, market evidence and Canonical validation during a later build.
 */

const CommerceIntake = require("./lib/commerce-candidate-intake.v1");
const CommerceAuth = require("./lib/commerce-candidate-auth.v1");
const SlotStore = require("./lib/global-slot-console-supabase");

const VERSION = "commerce-candidate-review-api-v1.2.1-private-queue-auth-repair";
const READ_ROLES = new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager"]);
const APPROVE_ROLES = new Set(["owner","admin","site_manager","site_manager_director","director"]);
const SUBMIT_ROLES = new Set(["owner","admin","site_manager","site_manager_director","director","commerce_manager","commerce_member"]);

function text(v){return v==null?"":String(v).trim();}
function lower(v){return text(v).toLowerCase().replace(/\s+/g,"_");}
function isObject(v){return !!v&&typeof v==="object"&&!Array.isArray(v);}
function plain(v){return isObject(v)?v:{};}
function safeUrl(v){try{const u=new URL(text(v));return u.protocol==="https:"?u.toString():"";}catch(_e){return "";}}
function json(statusCode, body){return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"GET,POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)};}
function parse(event){try{return event&&event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body):{};}catch(_e){const err=new Error("요청 JSON 형식이 올바르지 않습니다.");err.statusCode=400;throw err;}}
function roles(member){return Array.from(new Set((member&&member.roles||[]).map(lower).filter(Boolean)));}
function requireRole(member, scope){
  const values=roles(member);
  const allowed=scope==="approve"?APPROVE_ROLES:(scope==="submit"?SUBMIT_ROLES:READ_ROLES);
  if(!values.some(role=>allowed.has(role))){
    const err=new Error(scope==="approve"?"커머스 상품 승인 권한이 없습니다.":(scope==="submit"?"커머스 회원 또는 관리자 권한이 필요합니다.":"커머스 후보 대기열은 관리자/운영진 권한에서만 볼 수 있습니다."));
    err.statusCode=403;throw err;
  }
  return values;
}
async function resolveCurrentAdmin(event){
  // Use the queue's own signed Auth0/JWKS verifier. The prior reference to
  // global-slot-console-auth pointed to a module that is not present in the
  // deployed source package, which disconnected this read-only queue endpoint.
  const actor=await CommerceAuth.authenticateCommerceAdmin(event);
  return {memberId:text(actor&&actor.memberId),email:text(actor&&actor.email),name:text(actor&&actor.name),roles:Array.isArray(actor&&actor.roles)?actor.roles:[]};
}
function stage(root){return CommerceIntake.readStage(root)||{schema:"commerce-candidate-staging.snapshot.v1",summary:{considered:0},candidates:[]};}
function summaryDoc(doc){return {version:VERSION,stageVersion:doc.version||null,generatedAt:doc.generatedAt||null,releaseGate:doc.releaseGate||null,summary:doc.summary||{},candidateCount:Array.isArray(doc.candidates)?doc.candidates.length:0};}
function pageMap(hub){const h=lower(hub);return ({home:"home",distribution:"distribution",network:"network",tour:"tour",social:"social"})[h]||"";}

function countBy(rows, selector){
  const out={};
  for(const row of Array.isArray(rows)?rows:[]){
    const key=text(selector(row))||"unknown";
    out[key]=(out[key]||0)+1;
  }
  return Object.keys(out).sort().reduce((result,key)=>{result[key]=out[key];return result;},{});
}
function topReasons(rows){
  const out={};
  for(const row of Array.isArray(rows)?rows:[]){
    for(const reason of Array.isArray(row&&row.reasons)?row.reasons:[]){
      const key=text(reason);if(key)out[key]=(out[key]||0)+1;
    }
  }
  return Object.entries(out).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,80).map(([reason,count])=>({reason,count}));
}
function candidateDigestRows(rows){
  return (Array.isArray(rows)?rows:[]).slice(0,500).map((row)=>({
    candidateId:text(row&&row.candidateId), sourceTier:text(row&&row.sourceTier), origin:text(row&&row.origin),
    stageStatus:text(row&&row.stageStatus), releaseEligible:row&&row.releaseEligible===true,
    placement:plain(row&&row.placement), marketKeys:Array.isArray(row&&row.marketKeys)?row.marketKeys.slice(0,30):[],
    revenue:{type:text(row&&row.revenue&&row.revenue.type),monetizationState:text(row&&row.revenue&&row.revenue.monetizationState),contractId:text(row&&row.revenue&&row.revenue.contractId)},
    review:{state:text(row&&row.review&&row.review.state)}, reasons:Array.isArray(row&&row.reasons)?row.reasons.slice(0,30):[]
  }));
}
function diagnosticDoc(doc, member){
  const stage=doc||{};
  const candidates=Array.isArray(stage.candidates)?stage.candidates:[];
  const summary=plain(stage.summary);
  const gate=plain(stage.releaseGate);
  const source=plain(stage.source);
  const affiliate=plain(stage.affiliateRegistry);
  const held=candidates.filter((row)=>row&&row.releaseEligible!==true);
  const releaseReady=candidates.filter((row)=>row&&row.releaseEligible===true);
  const blockers=[];
  if(Number(source.searchBankCount||summary.receivedSearchBank||0)===0)blockers.push("no_searchbank_commerce_candidate");
  if(candidates.length===0)blockers.push("private_queue_empty");
  if(gate.enabled!==true)blockers.push(text(gate.reason)||"release_gate_disabled");
  if(source.reviewQueueStale===true)blockers.push("admin_review_queue_stale");
  if(affiliate.ok===false)blockers.push("affiliate_registry_invalid");
  return {
    ok:true,
    reportType:"igdc-commerce-candidate-queue-diagnostic",
    version:VERSION,
    generatedAt:new Date().toISOString(),
    mode:gate.enabled===true?"private-review-release-gate-armed":"pre-product-private-review",
    safety:{readOnly:true,writes:false,publicSnapshotPublication:false,externalNavigation:false,providerCalls:false,secretsExcluded:true},
    administrator:{roles:roles(member),access:"validated-private-queue-read"},
    queue:{
      schema:text(stage.schema),stageVersion:text(stage.version),stageGeneratedAt:text(stage.generatedAt),
      totalCandidates:candidates.length,eligibleForRelease:releaseReady.length,held:held.length,
      bySource:countBy(candidates,(row)=>row&&row.sourceTier),
      byStageStatus:countBy(candidates,(row)=>row&&row.stageStatus),
      byRevenueType:countBy(candidates,(row)=>row&&row.revenue&&row.revenue.type),
      byReviewState:countBy(candidates,(row)=>row&&row.review&&row.review.state),
      topBlockingReasons:topReasons(held),
      rows:candidateDigestRows(candidates)
    },
    upstream:{searchBankCommerceInput:Number(source.searchBankCount||summary.receivedSearchBank||0),adminReviewQueueStale:source.reviewQueueStale===true,reviewQueueDigest:text(source.reviewQueueDigest)||null},
    revenueRegistry:{version:text(affiliate.version)||null,valid:affiliate.ok!==false,problems:Array.isArray(affiliate.problems)?affiliate.problems.slice(0,50):[]},
    releaseGate:{enabled:gate.enabled===true,mode:text(gate.mode)||"staging_only",reason:text(gate.reason)||"unknown",keyPresent:gate.keyPresent===true},
    blockingConditions:blockers,
    summary:{considered:Number(summary.considered||candidates.length||0),eligibleForRelease:Number(summary.eligibleForRelease||releaseReady.length||0),releasedToCanonical:Number(summary.releasedToCanonical||0),held:Number(summary.held||held.length||0)}
  };
}
function sessionDoc(member){return {ok:true,version:VERSION,session:{authenticated:true,roles:roles(member),readOnlyQueueAccess:true}};}
function cleanCandidatePayload(body, actor){
  const input=plain(body.candidate); const page=lower(first(input.page,input.channel,input.placement&&input.placement.page)); const section=text(first(input.section,input.psom_key,input.placement&&input.placement.section));
  const result=Object.assign({},input,{
    id:text(input.id)||undefined,
    title:text(input.title),
    url:safeUrl(first(input.url,input.externalProductUrl)),
    image:safeUrl(first(input.image,input.thumb,input.thumbnail)),
    page,channel:page,section,psom_key:section,
    placement:Object.assign({},plain(input.placement),{page,section,slot:text(first(input.slot,input.slotId,input.placement&&input.placement.slot))||undefined}),
    commerceCandidate:Object.assign({},plain(input.commerceCandidate),{sourceTier:"approved_commerce_member",origin:"member-submission",submittedBy:actor.memberId}),
    directCommerceListing:Object.assign({},plain(input.directCommerceListing),{sourceTier:"approved_commerce_member",contractApproved:false,contractStatus:"pending"}),
    commerceReview:{status:"pending",assignmentState:"draft"}
  });
  if(!result.title||!result.url||!result.image||!result.page||!result.section){const err=new Error("제목·HTTPS 상품 URL·HTTPS 이미지·페이지·섹션은 필수입니다.");err.statusCode=400;throw err;}
  return result;
}
function first(){for(const v of arguments){const out=text(v);if(out)return out;}return "";}
async function submit(member, body){
  requireRole(member,"submit");
  const candidate=cleanCandidatePayload(body,member);
  const id="commerce_"+require("crypto").randomBytes(12).toString("hex");
  const rows=await SlotStore.insert("gslot_candidates",{id,kind:"product",title:candidate.title,official_url:candidate.url,status:"approval_pending",source_ref:"commerce-candidate-review-api",thumbnail_url:candidate.image,description:text(candidate.description||candidate.summary)||null,owner_note:"Direct commerce-member submission. Approval and market evidence remain pending.",source_payload:candidate,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),created_by:member.memberId},"return=representation");
  return {ok:true,candidateId:id,status:"approval_pending",row:(rows||[])[0]||null};
}

function requireCandidateId(body){
  const id=text(body&&body.candidateId);
  if(!id){const err=new Error("후보 ID가 필요합니다.");err.statusCode=400;throw err;}
  return id;
}
async function patchSourcePayload(candidateId, mutate){
  const rows=await SlotStore.select("gslot_candidates","select=id,source_payload&id=eq."+encodeURIComponent(candidateId)+"&limit=1");
  const row=Array.isArray(rows)&&rows[0];
  if(!row){const err=new Error("커머스 후보를 찾을 수 없습니다.");err.statusCode=404;throw err;}
  const original=plain(row.source_payload); const next=mutate(Object.assign({},original))||original;
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(candidateId),{source_payload:next,updated_at:new Date().toISOString()});
  return next;
}
async function recordMarket(member, body){
  requireRole(member,"approve");
  const id=requireCandidateId(body);const market=plain(body.market);
  const country=text(market.countryCode).toUpperCase();const region=text(market.regionCode).toUpperCase();
  const delivery=text(market.deliveryOrAccess);const basis=text(market.legalBasis);
  if(!/^[A-Z]{2}$/.test(country)||!delivery||!basis){const err=new Error("판매국(ISO 2자리), 배송·접근 근거, 법적/판매 근거가 필요합니다.");err.statusCode=400;throw err;}
  const row={candidate_id:id,country_code:country,region_code:region||null,availability_state:"active",legal_basis:basis.slice(0,4000),delivery_or_access:delivery.slice(0,4000),updated_at:new Date().toISOString(),updated_by:member.memberId};
  const rows=await SlotStore.insert("gslot_candidate_availability",row,"return=representation");
  return {ok:true,candidateId:id,market:(rows||[])[0]||row,note:"시장 근거는 배송·반품·지원·책임 증빙과 함께 Canonical 단계에서 다시 검증됩니다."};
}
async function recordEvidence(member, body){
  requireRole(member,"approve");
  const id=requireCandidateId(body);const evidence=plain(body.evidence);const url=safeUrl(evidence.url);
  const type=text(evidence.type)||"market_sale";const note=text(evidence.note);
  if(!url||!note){const err=new Error("HTTPS 증빙 URL과 증빙 설명이 필요합니다.");err.statusCode=400;throw err;}
  const rows=await SlotStore.insert("gslot_candidate_evidence",{id:"evidence_"+require("crypto").randomBytes(12).toString("hex"),candidate_id:id,evidence_type:type.slice(0,120),evidence_url:url,note:note.slice(0,4000),verified:true,created_at:new Date().toISOString(),created_by:member.memberId},"return=representation");
  return {ok:true,candidateId:id,evidence:(rows||[])[0]||null};
}
async function recordRevenue(member, body){
  requireRole(member,"approve");
  const id=requireCandidateId(body); const revenue=plain(body.revenue); const type=lower(revenue.type); const url=safeUrl(revenue.affiliateUrl||revenue.destinationUrl);
  const allowed=new Set(["affiliate","manual_affiliate","brokerage","referral","external_referral","lead","advertising","sponsor"]);
  if(!allowed.has(type)||!url||!text(revenue.providerName)){const err=new Error("허용된 수익/연결 유형, HTTPS 연결 URL, 제공자명이 필요합니다.");err.statusCode=400;throw err;}
  const checkedAt=text(revenue.policyCheckedAt||revenue.verifiedAt)||new Date().toISOString();
  if(type==="manual_affiliate"){
    const programId=text(revenue.programId); const providerGenerated=bool(revenue.providerGenerated); const manualApproved=bool(revenue.manualLinkApproved); const disclosureReady=bool(revenue.disclosureReady); const policyConfirmed=bool(revenue.policyConfirmed);
    if(!programId||!providerGenerated||!manualApproved||!disclosureReady||!policyConfirmed){const err=new Error("수동 제휴 링크에는 프로그램 ID, 제공자 생성 확인, 운영 승인, 고지 승인, 정책 확인이 모두 필요합니다.");err.statusCode=400;throw err;}
    await patchSourcePayload(id,function(payload){ payload.affiliate=Object.assign({},plain(payload.affiliate),{providerId:text(revenue.providerId||revenue.providerName),programId,approved:true,status:"approved",trackingUrl:url,providerGenerated:true,manualLinkApproved:true,disclosureReady:true,policyStatus:"policy_ok",policyCheckedAt:checkedAt,integrationMode:"manual"}); return payload; });
  } else if(type==="external_referral"){
    if(!bool(revenue.officialDestination)||!bool(revenue.disclosureReady)){const err=new Error("외부 연결형에는 공식 판매처 확인과 표시·고지 승인이 필요합니다.");err.statusCode=400;throw err;}
    await patchSourcePayload(id,function(payload){ payload.outboundReferral=Object.assign({},plain(payload.outboundReferral),{operatorApproved:true,approved:true,status:"approved",officialDestination:true,officialSeller:true,disclosureReady:true,verifiedAt:checkedAt,destinationUrl:url,providerName:text(revenue.providerName)}); return payload; });
  }
  const rows=await SlotStore.insert("gslot_candidate_revenue",{id:"revenue_"+require("crypto").randomBytes(12).toString("hex"),candidate_id:id,revenue_type:type,status:"approved",affiliate_url:url,provider_name:text(revenue.providerName).slice(0,240),currency:text(revenue.currency).slice(0,16)||null,note:text(revenue.note).slice(0,4000)||null,updated_at:new Date().toISOString(),updated_by:member.memberId},"return=representation");
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:"revenue_ready",updated_at:new Date().toISOString()});
  const note=type==="external_referral"?"외부 연결형은 상품별 수익을 확정으로 표시하지 않으며, 공식 판매처·판매시장·고지·Canonical 검증을 통과할 때만 공개 후보가 됩니다.":"수익 계약은 시장별 증빙·배정·Canonical 검증을 통과할 때만 비공개 대기열로 반영됩니다.";
  return {ok:true,candidateId:id,revenue:(rows||[])[0]||null,note};
}

async function decide(member, body){
  requireRole(member,"approve");
  const id=text(body.candidateId);const decision=lower(body.decision);if(!id||!["approved","hold","rejected"].includes(decision)){const err=new Error("후보 ID와 approved/hold/rejected 판정이 필요합니다.");err.statusCode=400;throw err;}
  if(decision!=="approved"){
    await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:decision==="rejected"?"suppressed":"hold",owner_note:text(body.note).slice(0,3000)||null,updated_at:new Date().toISOString()});
    return {ok:true,candidateId:id,status:decision};
  }
  const assignment=plain(body.assignment);const hub=lower(assignment.hubKey);const page=pageMap(hub);const section=text(assignment.slotKey);const country=text(assignment.countryCode).toUpperCase();
  if(!page||!section||!/^[A-Z]{2}$/.test(country)){const err=new Error("승인에는 허브·PSOM 슬롯 키·ISO 2자리 판매국이 필요합니다.");err.statusCode=400;throw err;}
  // Approval alone does not make a candidate public. Registry sync will export
  // it only when availability, revenue right and evidence records exist.
  await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(id),{status:"enrollable",owner_note:text(body.note).slice(0,3000)||null,updated_at:new Date().toISOString()});
  const assignmentId="assignment_"+require("crypto").randomBytes(12).toString("hex");
  const rows=await SlotStore.insert("gslot_slot_assignments",{id:assignmentId,candidate_id:id,hub_key:hub,country_code:country,region_code:text(assignment.regionCode).toUpperCase()||null,slot_key:section,priority:Math.max(-1000000,Math.min(1000000,Number(assignment.priority)||0)),state:assignment.pinned===true?"pinned":"approved",publication_status:"ready",manual_pinned:assignment.pinned===true,decision_note:text(body.note).slice(0,3000)||null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),updated_by:member.memberId},"return=representation");
  return {ok:true,candidateId:id,status:"enrollable",assignment:(rows||[])[0]||null,note:"승인 배정만 완료되었습니다. 시장별 배송·반품·지원·책임 근거와 승인된 수익 계약이 등록된 뒤에만 다음 빌드의 비공개 대기열에 반영됩니다. 공개 발행 키는 별도로 필요합니다."};
}

exports.buildDiagnostic=diagnosticDoc;
exports.handler=async function(event){
  try{
    if(String(event&&event.httpMethod||"GET").toUpperCase()==="OPTIONS")return json(204,{});
    const method=String(event&&event.httpMethod||"GET").toUpperCase();
    const member=await resolveCurrentAdmin(event);
    const body=method==="GET"?{}:parse(event);const action=lower((event.queryStringParameters||{}).action||body.action||"summary");
    if(method==="GET"){
      requireRole(member,"read");const doc=stage(process.cwd());
      if(action==="session")return json(200,sessionDoc(member));
      if(action==="summary")return json(200,{ok:true,summary:summaryDoc(doc)});
      if(action==="candidates")return json(200,{ok:true,summary:summaryDoc(doc),candidates:(doc.candidates||[]).slice(0,500)});
      if(action==="diagnostic")return json(200,diagnosticDoc(doc,member));
      return json(404,{ok:false,error:"지원하지 않는 조회 요청입니다."});
    }
    if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
    if(action==="submit")return json(200,await submit(member,body));
    if(action==="decide")return json(200,await decide(member,body));
    if(action==="record_market")return json(200,await recordMarket(member,body));
    if(action==="record_evidence")return json(200,await recordEvidence(member,body));
    if(action==="record_revenue")return json(200,await recordRevenue(member,body));
    return json(404,{ok:false,error:"지원하지 않는 관리 요청입니다."});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:error&&error.code||null});}
};
