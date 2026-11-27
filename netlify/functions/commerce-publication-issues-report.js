"use strict";
/** Read-only administrator report: global 20-section published-product health. */
const Auth = require("./lib/global-slot-console-auth");
const Store = require("./lib/global-slot-console-supabase");
const VERSION = "commerce-publication-issues-report-v1.0.0";
const STATE_ID = "igdc_global_product_maintenance_state_v2";
const QUEUE_HUB = "global-product-maintenance-replacement";
const SECTION_KEYS = [
 "home|home_1","home|home_2","home|home_7","home|home_3","home|home_4","home|home_5","home|home_6",
 "home|home_right_top","home|home_right_middle","home|home_right_bottom",
 "distribution|distribution-recommend","distribution|distribution-trending",
 "distribution|distribution-sponsor","distribution|distribution-special","distribution|distribution-footwear","distribution|distribution-new", "distribution|distribution-others","distribution|distribution-extra","distribution|distribution-right",
 "network|network-right","social|rightPanel","tour|tour"
];
const SECTION_NAMES = ["홈 1","홈 2","홈 3","홈 4","홈 5","홈 6","홈 우측 상단","홈 우측 중단","홈 우측 하단",
"유통 오늘의 추천","유통 실시간 인기","유통 뷰티","유통 소형가전","유통 의류·패션","유통 생필품·생활","유통 기타·아웃도어·식품","유통 브랜드 추천","네트워크 우측","소셜 우측","투어 우측"];
const ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director","commerce_manager"]);
const text = (v) => String(v == null ? "" : v).trim();
const obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const arr = (v) => Array.isArray(v) ? v : [];
function reply(code,data) { return {statusCode:code,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"GET,OPTIONS"},body:code===204?"":JSON.stringify(data)}; }
function section(page,sectionKey){
 const key=text(page)+"|"+text(sectionKey),index=SECTION_KEYS.indexOf(key);
 return {key,sectionNumber:index<0?null:index+1,sectionName:index<0?"확인 필요":SECTION_NAMES[index],knownSection:index>=0};
}
function item(input,issueType){
 const row=obj(input),place=section(row.page||row.hubKey||row.hub_key||"distribution",row.sectionKey||row.slot_key);
 return Object.assign({issueType,issueStatus:issueType==="inconclusive"?"재검증 필요":issueType==="unresolved"?"대체 후보 없음":"대체 후보 검토 대기",
  candidateId:text(row.candidateId),assignmentId:text(row.assignmentId)||null,
  title:text(row.originalTitle||row.title)||null,replacementTitle:text(row.title)||null,productUrl:text(row.productUrl||row.previousProductUrl)||null,
  replacementProductUrl:text(row.replacementProductUrl)||null,country:text(row.country)||null,region:text(row.region)||null,
  reason:text(row.recoveryReason)||null,reasons:arr(row.reasons).map(text).slice(0,12),
  recordedAt:text(row.checkedAt||row.updatedAt||row.queuedAt)||null},place);
}
async function report(){
 const stateRows=await Store.select("gslot_policies","select=id,rule,updated_at&id=eq."+encodeURIComponent(STATE_ID)+"&limit=1");
 const stateRow=arr(stateRows)[0]||null,state=obj(stateRow&&stateRow.rule);
 const queueRows=await Store.select("gslot_policies","select=id,rule,updated_at&scope_hub=eq."+encodeURIComponent(QUEUE_HUB)+"&enabled=eq.true&order=updated_at.asc,id.asc&limit=1000");
 if(!Array.isArray(queueRows))throw new Error("maintenance_queue_read_incomplete");
 const byKey=new Map();
 for(const row of queueRows){const rule=obj(row.rule);if(!text(rule.candidateId))continue;const issue=item(Object.assign({},rule,{updatedAt:row.updated_at}),"replacement_pending");byKey.set("queue:"+issue.candidateId+":"+issue.sectionKey,issue);}
 for(const row of arr(state.lastUnresolvedSample)){
  const issue=item(row,"unresolved");if(issue.candidateId)byKey.set("unresolved:"+issue.candidateId+":"+issue.sectionKey,issue);
 }
 for(const row of arr(state.lastInconclusiveSample)){
  const issue=item(row,"inconclusive");if(issue.candidateId)byKey.set("inconclusive:"+issue.candidateId+":"+issue.sectionKey,issue);
 }
 const issues=Array.from(byKey.values()).sort((a,b)=>(a.sectionNumber||999)-(b.sectionNumber||999)||(a.country||"").localeCompare(b.country||"")||a.candidateId.localeCompare(b.candidateId));
 const sections=SECTION_KEYS.map((key,index)=>({sectionNumber:index+1,sectionKey:key,sectionName:SECTION_NAMES[index],issueCount:issues.filter(i=>i.key===key).length}));
 return {ok:true,reportType:"igdc-distribution-publication-issues",version:VERSION,generatedAt:new Date().toISOString(),
  scope:"249_country_configured_global_research;_20_administrator_sections",readOnly:true,automaticDeployment:false,administratorFrontMatchRequired:true,
  source:{policyTable:"gslot_policies",stateId:STATE_ID,queueHub:QUEUE_HUB,storageStateFound:!!stateRow,
   lastScanAt:text(state.lastLivenessPassAt)||null,lastFullCycleAt:text(state.lastScanCompletedAt)||null,scanCursor:text(state.scanCursor)||null,
   lastScanStats:obj(state.lastLivenessPass),queueReadLimit:1000,queueReadTruncated:queueRows.length===1000,
   sampleLimitPerCategory:100,inspectionCoverage:"순차 점검 · 최근 기록/대기열만 표시 · 전체 상품 실시간 전수검사 아님"},
  summary:{issues:issues.length,replacementsPending:issues.filter(i=>i.issueType==="replacement_pending").length,
   unresolved:issues.filter(i=>i.issueType==="unresolved").length,inconclusive:issues.filter(i=>i.issueType==="inconclusive").length},
  sections,issues};
}
exports.handler=async(event)=>{
 if(event&&event.httpMethod==="OPTIONS")return reply(204,{});
 if(!event||event.httpMethod!=="GET")return reply(405,{ok:false,error:"method_not_allowed"});
 try{
  const actor=await Auth.resolveUser(event),roles=arr(actor&&actor.roles).map(v=>text(v).toLowerCase().replace(/[\s.]+/g,"_"));
  if(!roles.some(role=>ROLES.has(role)))return reply(403,{ok:false,error:"distribution_issues_forbidden"});
  return reply(200,await report());
 }catch(error){return reply(error&&error.statusCode||503,{ok:false,version:VERSION,error:text(error&&error.code)||"maintenance_issue_read_failed",message:text(error&&error.message)||"점검 원장 조회 실패",readOnly:true});}
};
exports._test={section,item,report};
