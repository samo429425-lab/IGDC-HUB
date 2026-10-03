"use strict";

const AdminSession = require("./lib/global-slot-console-auth");
const Automation = require("./lib/commerce-country-automation.v1");
const MarketSignals = require("./lib/commerce-market-signal-intelligence.v1");
const PolicyDiscussion = require("./lib/commerce-policy-discussion.v1");
const ProductGoLiveAudit = require("./product-go-live-audit");
const CandidateReview = require("./commerce-candidate-review");
const SlotStore = require("./lib/global-slot-console-supabase");
const MarketSaleScope = require("./lib/market-sale-scope.v1");

const READ_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director","commerce_manager"]);
const WRITE_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);

function text(value){return value==null?"":String(value).trim();}
function lower(value){return text(value).toLowerCase().replace(/[\s.]+/g,"_");}
function json(statusCode,body){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"GET,POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)};}
function parse(event){try{return event&&event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body):{};}catch(_e){const error=new Error("요청 JSON 형식이 올바르지 않습니다.");error.statusCode=400;throw error;}}
function roleList(actor){return Array.from(new Set((actor&&actor.roles||[]).map(lower).filter(Boolean)));}
function requireRole(actor,write){const allowed=write?WRITE_ROLES:READ_ROLES;const roles=roleList(actor);if(!roles.some((role)=>allowed.has(role))){const error=new Error(write?"국가·지역 자동화 설정 권한이 없습니다.":"국가·지역 책임 공급업체 관제는 관리자·운영진만 사용할 수 있습니다.");error.statusCode=403;throw error;}return roles;}
function plain(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
async function authoritativeReplacementEligibility(body,candidateIdsInput){
  const requested=Array.from(new Set((Array.isArray(candidateIdsInput)?candidateIdsInput:[]).map(text).filter(Boolean))).slice(0,1800),eligible=[],blocked=[];
  for(let offset=0;offset<requested.length;offset+=400){
    const chunk=requested.slice(offset,offset+400);
    const plan=await Automation.productFrontSyncTargets(Object.assign({},plain(body),{operation:"match",mode:"candidates",candidateIds:chunk,ledgerMode:"candidate"}),null);
    const allowed=new Set((Array.isArray(plan&&plan.targets)?plan.targets:[]).map((row)=>text(row&&row.candidateId)).filter(Boolean));
    for(const id of chunk){if(allowed.has(id))eligible.push(id);else blocked.push(id);}
  }
  return{requested,eligible:Array.from(new Set(eligible)),blocked:Array.from(new Set(blocked))};
}

const ADMIN_GUARD_FIELDS = ["slotDecision","approvedPlacement","selectedPlacement","placement","primaryPlacement","page","channel","section","psom_key","slot","managementControl","queueControl","decisionAt","decisionBy","decisionSource"];
function array(value){return Array.isArray(value)?value:[];}
function clone(value){return value&&typeof value==="object"?JSON.parse(JSON.stringify(value)):value;}
function scopedAssignment(row,scope){
  if(!row||text(row.country_code).toUpperCase()!==text(scope.country).toUpperCase())return false;
  const region=MarketSaleScope.normalizeRegion(text(row.region_code||"NATIONWIDE"),scope.country)||"NATIONWIDE";
  return region===scope.region;
}
async function captureAdminPlacementGuard(candidateIds,scope){
  const ids=Array.from(new Set(array(candidateIds).map(text).filter(Boolean))).slice(0,2000);
  const snapshots=new Map();
  for(let off=0;off<ids.length;off+=300){
    const chunk=ids.slice(off,off+300),filter=chunk.map(id=>encodeURIComponent(id)).join(",");
    const rows=array(await SlotStore.select("gslot_candidates","select=id,status,source_payload&id=in.("+filter+")&limit=300"));
    const assigns=array(await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,created_at,updated_at,updated_by&candidate_id=in.("+filter+")&limit=3000"));
    for(const row of rows){
      const payload=plain(row.source_payload),admin={};
      for(const key of ADMIN_GUARD_FIELDS)if(Object.prototype.hasOwnProperty.call(payload,key))admin[key]=clone(payload[key]);
      snapshots.set(text(row.id),{candidateId:text(row.id),status:text(row.status),admin,assignments:assigns.filter(a=>text(a.candidate_id)===text(row.id)&&scopedAssignment(a,scope)).map(clone)});
    }
  }
  return snapshots;
}
async function restoreAdminPlacementGuard(snapshots,scope){
  const restored=[],failures=[];
  for(const snap of snapshots.values()){
    try{
      const rows=array(await SlotStore.select("gslot_candidates","select=id,status,source_payload&id=eq."+encodeURIComponent(snap.candidateId)+"&limit=1"));
      const row=plain(rows[0]);if(!Object.keys(row).length)continue;
      const payload=Object.assign({},plain(row.source_payload));
      for(const key of ADMIN_GUARD_FIELDS){
        if(Object.prototype.hasOwnProperty.call(snap.admin,key))payload[key]=clone(snap.admin[key]);
        else delete payload[key];
      }
      await SlotStore.update("gslot_candidates","id=eq."+encodeURIComponent(snap.candidateId),{status:snap.status,source_payload:payload,updated_at:new Date().toISOString()});
      const current=array(await SlotStore.select("gslot_slot_assignments","select=id,candidate_id,hub_key,country_code,region_code,slot_key,state,publication_status,manual_pinned,priority,created_at,updated_at,updated_by&candidate_id=eq."+encodeURIComponent(snap.candidateId)+"&limit=100"));
      const byId=new Map(current.filter(a=>scopedAssignment(a,scope)).map(a=>[text(a.id),a]));
      for(const before of snap.assignments){
        const now=byId.get(text(before.id));
        const structuralChanged=!now||text(now.hub_key)!==text(before.hub_key)||text(now.slot_key)!==text(before.slot_key)||text(now.state)!==text(before.state)||Boolean(now.manual_pinned)!==Boolean(before.manual_pinned);
        if(structuralChanged){
          const replacement=Object.assign({},before,{publication_status:now?now.publication_status:before.publication_status,updated_at:new Date().toISOString()});
          await SlotStore.insert("gslot_slot_assignments",replacement,"resolution=merge-duplicates,return=representation");
        }
      }
      restored.push(snap.candidateId);
    }catch(error){failures.push({candidateId:snap.candidateId,error:text(error&&error.message)||"admin_guard_restore_failed"});}
  }
  return{ok:failures.length===0,restored,failures};
}

async function frontPublicationWithdrawAssignmentsOnly(assignments,actorId){
  const rows=array(assignments),results=[];
  for(const item of rows){
    const assignmentId=text(item&&item.assignmentId);
    if(!assignmentId)continue;
    try{
      await SlotStore.update("gslot_slot_assignments","id=eq."+encodeURIComponent(assignmentId),{publication_status:"not_ready",updated_at:new Date().toISOString(),updated_by:text(actorId)||"administrator"});
      results.push({candidateId:text(item&&item.candidateId),assignmentId,status:"unpublish_requested",persisted:true,pendingBuild:true,reason:text(item&&item.reason)||"front_runtime_unavailable"});
    }catch(error){results.push({candidateId:text(item&&item.candidateId),assignmentId,status:"unpublish_failed",persisted:false,pendingBuild:false,reason:text(error&&error.message)||"assignment_unpublish_failed"});}
  }
  return{ok:true,items:results,requested:rows.length,persisted:results.filter(r=>r.persisted===true).length,candidateLedgerReadOnly:true};
}

function readGeoObject(value){const raw=text(value);if(!raw)return{};for(const candidate of [raw,(()=>{try{return decodeURIComponent(raw);}catch(_e){return"";}})()]){try{const parsed=JSON.parse(candidate);if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return parsed;}catch(_e){}}return{};}
function normalizeGeo(event){
  const headers={};for(const [key,value] of Object.entries(event&&event.headers||{}))headers[String(key).toLowerCase()]=value;
  const geo=Object.assign({},plain(event&&event.geo),readGeoObject(headers["x-nf-geo"])),countryObject=plain(geo.country),subdivision=plain(geo.subdivision);
  const rawCountry=text(countryObject.code||countryObject.alpha2||(typeof geo.country==="string"?geo.country:"")||geo.countryCode||geo.country_code||headers["cf-ipcountry"]||headers["x-country"]||headers["x-vercel-ip-country"]||headers["x-nf-country"]).toUpperCase();
  const excluded=rawCountry==="KP";
  const detected=excluded?null:Automation.countryRow(rawCountry);
  const country=detected?detected.code:"";
  const rawRegion=subdivision.code||subdivision.iso_code||(typeof geo.subdivision==="string"?geo.subdivision:"")||geo.subdivisionCode||geo.regionCode||geo.stateCode||geo.provinceCode||geo.region||geo.state||headers["x-region"]||headers["x-nf-subdivision"]||headers["x-nf-region"]||headers["x-vercel-ip-country-region"]||"";
  let region="";
  if(country){const MarketSaleScope=require("./lib/market-sale-scope.v1");region=MarketSaleScope.normalizeRegion(rawRegion,country);}
  return {ok:true,version:Automation.VERSION,country:country||null,region:region||null,worldRegion:detected&&detected.regionGroup||null,resolved:!!country,excluded:excluded,detectedCountry:rawCountry||null,policy:{exactRegionFirst:true,nationwideFallbackWithinSameCountry:true,crossCountryFallback:false,unresolvedGeo:"empty",manualPinnedPrecedence:true,trustBeforeRevenue:true,revenueTieBreakOnly:true}};
}

function policyScopeFromInput(raw){
  const input=plain(raw),scopeType=lower(input.scopeType||input.type||"global"),workspaceKey=text(input.workspaceKey||input.topicKey||"policy"),workspaceLabel=text(input.workspaceLabel||input.topicLabel||"");
  if(scopeType==="global")return{scopeType:"global",scopeLabel:"전 세계 통합",workspaceKey,workspaceLabel};
  if(scopeType==="regional"){
    const regionGroup=text(input.regionGroup),region=Automation.regionRow(regionGroup);if(!region){const error=new Error("선택 권역을 찾을 수 없습니다.");error.statusCode=400;throw error;}
    return{scopeType:"regional",regionGroup,scopeLabel:(region.nameKo||region.nameEn||regionGroup)+" 권역",workspaceKey,workspaceLabel};
  }
  if(scopeType==="country"){
    const countryCode=text(input.countryCode||input.country).toUpperCase(),country=Automation.countryRow(countryCode);if(!country){const error=new Error("지원되는 국가 정책 범위를 찾을 수 없습니다.");error.statusCode=400;throw error;}
    const subdivisionCode=text(input.subdivisionCode||input.regionCode||input.region||"NATIONWIDE").toUpperCase()||"NATIONWIDE";
    if(subdivisionCode!=="NATIONWIDE"){const valid=Array.isArray(country.subdivisions)&&country.subdivisions.some((item)=>text(item&&item.code).toUpperCase()===subdivisionCode);if(!valid){const error=new Error("선택 국가의 공식 주·성·지역 정책 범위를 찾을 수 없습니다.");error.statusCode=400;throw error;}}
    return{scopeType:"country",regionGroup:country.regionGroup,countryCode,subdivisionCode,scopeLabel:(country.nameKo||country.nameEn||countryCode)+" · "+countryCode+" / "+(subdivisionCode==="NATIONWIDE"?"전국":subdivisionCode),workspaceKey,workspaceLabel};
  }
  const error=new Error("정책 협의 범위가 올바르지 않습니다.");error.statusCode=400;throw error;
}

function catalog(state){
  const reg=Automation.registry();
  return {ok:true,version:Automation.VERSION,trustPolicy:Automation.TRUST_POLICY,marketSignalPolicy:MarketSignals.POLICY,policyDiscussionVersion:PolicyDiscussion.VERSION,registry:{schema:reg.schema,version:reg.version,regions:reg.regions,excludedCountryCodes:["KP"],countryCount:reg.countries.length},countries:reg.countries.map((country)=>({
    code:country.code,nameKo:country.nameKo,nameEn:country.nameEn,regionGroup:country.regionGroup,enabled:country.enabled!==false,requiresSubdivision:country.requiresSubdivision===true,subdivisionType:country.subdivisionType||null,subdivisions:country.subdivisions||[],effective:Automation.effectiveSetting(state,country.code,"")
  })),settings:state.settings,storage:{available:state.storageAvailable,error:state.storageError||null},master:state.master,operatingStatus:Automation.operatingStatus(state)};
}

exports.handler=async function(event){
  try{
    const method=String(event&&event.httpMethod||"GET").toUpperCase();if(method==="OPTIONS")return json(204,{});
    const body=method==="GET"?{}:parse(event),query=event&&event.queryStringParameters||{},action=lower(query.action||body.action||"catalog");
    const actor=await AdminSession.resolveUser(event);const write=method!=="GET"||["run_now","research_begin","research_step","research_commit","supplier_manual_register","product_research_begin","product_research_step","product_research_pause_control","product_research_stage_current","product_candidate_action","product_candidate_ledger_action","product_candidate_ledger_bulk_action","product_candidate_ai_recover","product_candidate_hold_verify","product_candidate_psom_place","product_ai_automation","product_front_match","product_front_unmatch","product_front_finalize","commit_preview","setting_save","candidate_action","research_candidate_action","operating_preset_apply"].includes(action);requireRole(actor,write);
    const actorId=text(actor&&actor.sub);
    if(action==="session")return json(200,{ok:true,version:Automation.VERSION,trustPolicy:Automation.TRUST_POLICY,session:{authenticated:true,roles:roleList(actor),write:roleList(actor).some((role)=>WRITE_ROLES.has(role))}});
    if(action==="geo")return json(200,normalizeGeo(event));
    if(action==="trust_policy")return json(200,{ok:true,version:Automation.VERSION,trustPolicy:Automation.TRUST_POLICY,marketSignalPolicy:MarketSignals.POLICY});
    const state=await Automation.configState();
    if(action==="catalog")return json(200,catalog(state));
    if(action==="diagnostic")return json(200,Automation.diagnostic(state));
    if(action==="global_control_diagnostic")return json(200,await Automation.globalControlDiagnostic());
    if(action==="signal_status"){
      const regionGroup=text(query.regionGroup||body.regionGroup);
      if(regionGroup&&!Automation.regionRow(regionGroup)){const error=new Error("권역을 찾을 수 없습니다.");error.statusCode=400;throw error;}
      return json(200,await MarketSignals.signalStatus(regionGroup));
    }
    if(action==="signal_research_status"){
      const scopeType=lower(query.scopeType||body.scopeType||"global"),regionGroup=text(query.regionGroup||body.regionGroup);
      if(scopeType==="regional"&&!Automation.regionRow(regionGroup)){const error=new Error("권역을 찾을 수 없습니다.");error.statusCode=400;throw error;}
      return json(200,await MarketSignals.signalJobStatus({scopeType,regionGroup}));
    }
    if(action==="policy_workspace"){
      const scope=policyScopeFromInput(Object.assign({},query,body));
      return json(200,await PolicyDiscussion.getWorkspace(scope));
    }
    if(action==="policy_effective"){
      const scope=policyScopeFromInput(Object.assign({scopeType:"country"},query,body));
      return json(200,await PolicyDiscussion.effectivePolicy(scope));
    }
    if(action==="research_status")return json(200,await Automation.researchJobStatus({countryCode:query.country||body.countryCode,subdivisionCode:query.region||body.subdivisionCode||body.regionCode||"NATIONWIDE"}));
    if(action==="product_research_status")return json(200,await Automation.productResearchJobStatus({countryCode:query.country||body.countryCode,subdivisionCode:query.region||body.subdivisionCode||body.regionCode||"NATIONWIDE",fast:query.fast||body.fast||false,compact:query.compact||body.compact||false}));
    if(action==="scope"){
      const countryCode=text(query.country||body.countryCode).toUpperCase(),region=text(query.region||body.subdivisionCode||body.regionCode||"NATIONWIDE").toUpperCase()||"NATIONWIDE";
      const country=Automation.countryRow(countryCode);
      if(!country){const error=new Error("지원되는 국가 범위를 찾을 수 없습니다.");error.statusCode=400;throw error;}
      if(region!=="NATIONWIDE"){
        const valid=Array.isArray(country.subdivisions)&&country.subdivisions.some((item)=>text(item&&item.code).toUpperCase()===region);
        if(!valid){const error=new Error("선택 국가의 공식 주·성·지역 범위를 찾을 수 없습니다.");error.statusCode=400;throw error;}
      }
      return json(200,{ok:true,version:Automation.VERSION,trustPolicy:Automation.TRUST_POLICY,marketSignalPolicy:MarketSignals.POLICY,country,effective:Automation.effectiveSetting(state,countryCode,region==="NATIONWIDE"?"":region),marketSignals:await MarketSignals.signalStatus(country.regionGroup),candidates:await Automation.listAutomationCandidates(countryCode,region)});
    }
    if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
    if(action==="research_begin")return json(200,await Automation.beginResearchJob(actorId,body,event));
    if(action==="research_step")return json(200,await Automation.advanceResearchJob(actorId,body,event));
    if(action==="research_commit")return json(200,await Automation.commitResearchJob(actorId,body));
    if(action==="supplier_manual_register")return json(200,await Automation.manualSupplierRegister(actorId,body));
    if(action==="product_research_begin")return json(200,await Automation.beginProductResearchJob(actorId,body));
    if(action==="product_research_step")return json(200,await Automation.advanceProductResearchJob(actorId,body));
    if(action==="product_research_pause_control")return json(200,await Automation.productResearchPauseControl(actorId,body));
    if(action==="product_research_stage_current")return json(200,await Automation.stageCurrentProductResearchQueue(actorId,body));
    if(action==="product_candidate_action")return json(200,await Automation.productCandidateAction(actorId,body));
    if(action==="product_candidate_ledger_action")return json(200,await Automation.productCandidateLedgerAction(actorId,body));
    if(action==="product_candidate_ledger_bulk_action")return json(200,await Automation.productCandidateLedgerBulkAction(actorId,body));
    if(action==="product_candidate_ai_recover")return json(200,await Automation.productCandidateAiRecover(actorId,body));
    if(action==="product_candidate_hold_verify")return json(200,await Automation.productCandidateHoldVerify(actorId,body));
    if(action==="product_candidate_psom_place")return json(200,await Automation.productCandidatePsomPlace(actorId,body));
    if(action==="product_ai_automation")return json(200,await Automation.productAiAutomation(actorId,body));
    if(action==="product_front_finalize"){
      const requestedOperation=lower(body.operation)==="unmatch"?"unmatch":(lower(body.operation)==="refresh"?"refresh":"match");
      const requestedCandidateIds=Array.from(new Set((Array.isArray(body.candidateIds)?body.candidateIds:[]).map(text).filter(Boolean))).slice(0,1800);
      // publicationReplacement is intentionally NOT an administrator-placement replacement.
      // It only makes the selected front publication scope mirror the current master board.
      // gslot_candidates and assignment hub/slot/state/manual_pinned remain read-only here.
      const publicationReplacement=body.publicationReplacement===true;
      const requestedReplacementCandidateIds=Array.from(new Set((Array.isArray(body.replacementCandidateIds)?body.replacementCandidateIds:[]).map(text).filter(Boolean))).slice(0,3000);
      const candidateIds=requestedCandidateIds;
      const scope=ProductGoLiveAudit.selectedScope(text(body.countryCode||body.country).toUpperCase(),text(body.subdivisionCode||body.regionCode||body.region||"NATIONWIDE").toUpperCase());
      let replacementPlan=null,replacementUnpublish=null;
      if(publicationReplacement){
        replacementPlan=await Automation.productFrontReplacementPlan(Object.assign({},body,{authoritativeReplacement:true,explicitReplacementCleanup:true,replacementCandidateIds:requestedReplacementCandidateIds}));
        const staleAssignments=Array.isArray(replacementPlan&&replacementPlan.withdrawAssignments)?replacementPlan.withdrawAssignments:[];
        if(staleAssignments.length){
          // Publication-only stale cleanup: only publication_status is changed.
          // Never call candidate marker cleanup and never alter administrator placement fields.
          replacementUnpublish=await frontPublicationWithdrawAssignmentsOnly(staleAssignments,actorId);
          const failed=(Array.isArray(replacementUnpublish&&replacementUnpublish.items)?replacementUnpublish.items:[]).filter((item)=>item&&item.status==="unpublish_failed");
          if(failed.length){const error=new Error("현재 관리자 배치 목록으로 프론트를 치환하는 중 기존 공개 상품 "+failed.length+"건의 공개 해제 상태를 저장하지 못했습니다. 관리자 배치는 보존됐으며 다시 실행해 주세요.");error.statusCode=409;error.code="publication_replacement_unpublish_failed";throw error;}
        }
      }
      const effectiveOperation=requestedOperation==="unmatch"?"unmatch":(candidateIds.length?"match":"refresh");
      if(effectiveOperation==="match"&&candidateIds.length){
        const liveDoc={candidates:[]};
        const finalizeResult=await ProductGoLiveAudit.requestPublicationBatch(event,actor,{mode:"production",confirmation:"SITE_PUBLISH",candidateIds,preparedByFrontLifecycle:true},scope,liveDoc);
        const recorded=await Automation.recordProductFrontSync(actorId,Object.assign({},body,{operation:"match",mode:"candidates",candidateIds,ledgerMode:"candidate",compactResponse:true}),finalizeResult,null);
        if(recorded&&recorded.frontSyncResult)recorded.frontSyncResult.replacement={publicationOnly:publicationReplacement,administratorPlacementReadOnly:true,plan:replacementPlan,unpublication:replacementUnpublish,desiredCandidateIds:requestedReplacementCandidateIds};
        const guardRestore={ok:true,restored:[],failures:[],skipped:true,reason:"front_candidate_ledger_read_only"};if(recorded&&recorded.frontSyncResult)recorded.frontSyncResult.adminPlacementGuard=guardRestore;
        return json(200,recorded);
      }
      const staleIds=Array.from(new Set((replacementPlan&&replacementPlan.staleCandidateIds||[]).map(text).filter(Boolean))),refreshIds=Array.from(new Set(candidateIds.concat(requestedCandidateIds,staleIds))).slice(0,1800);
      const refreshUnpublish=requestedOperation==="unmatch"||(publicationReplacement&&candidateIds.length===0&&staleIds.length>0);
      const refreshResult=await ProductGoLiveAudit.dispatchFrontRefresh(event,actor,{mode:"production",operation:refreshUnpublish?"unmatch":"refresh",confirmation:refreshUnpublish?"SITE_UNPUBLISH":"SITE_PUBLISH",candidateId:refreshIds[0]||null,candidateIds:refreshIds,candidateCount:Math.max(1,Number(body.changedCount)||refreshIds.length||1)},scope);
      const recorded=await Automation.recordProductFrontSync(actorId,Object.assign({},body,{operation:requestedOperation==="unmatch"?"unmatch":"match",mode:"candidates",candidateIds:refreshIds,ledgerMode:"candidate",compactResponse:true}),refreshResult,null);
      if(recorded&&recorded.frontSyncResult)recorded.frontSyncResult.replacement={publicationOnly:publicationReplacement,administratorPlacementReadOnly:true,plan:replacementPlan,unpublication:replacementUnpublish,desiredCandidateIds:requestedReplacementCandidateIds};
      const guardRestore={ok:true,restored:[],failures:[],skipped:true,reason:"front_candidate_ledger_read_only"};if(recorded&&recorded.frontSyncResult)recorded.frontSyncResult.adminPlacementGuard=guardRestore;
      return json(200,recorded);
    }
    if(action==="product_front_match"||action==="product_front_unmatch"){
      const operation=action==="product_front_unmatch"?"unmatch":"match";
      const request=Object.assign({},body,{operation});
      const candidateLedgerMode=lower(request.ledgerMode)==="candidate";
      const loadedJob=candidateLedgerMode?null:await Automation.loadProductResearchJob(request);
      let plan=await Automation.productFrontSyncTargets(request,loadedJob);
      const scope=ProductGoLiveAudit.selectedScope(plan.scope.country,plan.scope.region);
      const initialGuardIds=Array.from(new Set((Array.isArray(plan.targets)?plan.targets:[]).map((row)=>text(row&&row.candidateId)).filter(Boolean)));
      const adminGuard=new Map();
      let batchResult, refresh=null, repairUnpublish=null;
      if(!plan.targets.length){
        batchResult={ok:true,status:"empty",action:operation==="match"?"request_publication_batch":"request_unpublication_batch",requested:0,queued:0,persisted:0,pendingBuild:0,blocked:0,items:[],release:{queued:false,reason:"no_selected_products"}};
      }else if(operation==="match"){
        // The front-match button is also the runtime maintenance pass.  Recheck
        // selected rows and, on a full-scope run, every currently published row.
        // Dead/redirected products are durably withdrawn first; valid rows keep
        // their assignment and are then prepared through the canonical four
        // relation ledgers.  All dispatches are deferred to one final build.
        refresh=await Automation.revalidateProductFrontTargets(actorId,request,plan.targets,{includePublishedScope:request.scopeRefresh===true});
        const withdrawAssignments=Array.isArray(refresh&&refresh.withdrawAssignments)?refresh.withdrawAssignments:[];
        if(withdrawAssignments.length){
          repairUnpublish=await frontPublicationWithdrawAssignmentsOnly(withdrawAssignments,actorId);
        }
        refresh=Object.assign({},refresh,{withdrawn:withdrawAssignments.length,withdrawRequested:withdrawAssignments.length,withdrawPersisted:Array.isArray(repairUnpublish&&repairUnpublish.items)?repairUnpublish.items.filter((item)=>item&&item.persisted===true).length:0});
        // Front validation is diagnostic/publication-only. It must never rewrite
        // the administrator's 20-section board. Re-read the same administrator
        // authority after validation, then filter only hard-invalid rows from
        // THIS publication attempt while leaving their placement untouched.
        plan=await Automation.productFrontSyncTargets(request,loadedJob);
        const hardInvalidIds=new Set((Array.isArray(refresh&&refresh.results)?refresh.results:[]).filter((item)=>item&&item.invalid===true).map((item)=>String(item.candidateId||"").trim()).filter(Boolean));
        if(hardInvalidIds.size){
          plan=Object.assign({},plan,{targets:(Array.isArray(plan.targets)?plan.targets:[]).filter((row)=>!hardInvalidIds.has(String(row&&row.candidateId||"").trim())),publicationBlockedCandidateIds:Array.from(hardInvalidIds)});
        }
        const preparation=await Automation.prepareProductFrontTargets(actorId,request,plan.targets,loadedJob);
        const preparedIds=Array.isArray(preparation&&preparation.preparedCandidateIds)?preparation.preparedCandidateIds:[];
        const preparationBlocked=(Array.isArray(preparation&&preparation.items)?preparation.items:[]).filter((item)=>item&&item.status==="blocked");
        const repairItems=Array.isArray(repairUnpublish&&repairUnpublish.items)?repairUnpublish.items:[];
        if(!preparedIds.length){
          const items=repairItems.concat(preparationBlocked);
          const persisted=items.filter((item)=>item&&item.persisted===true).length;
          const blocked=items.filter((item)=>item&&(item.status==="blocked"||item.status==="unpublish_failed")).length;
          batchResult={ok:true,status:persisted?"pending_finalize":(blocked?"blocked":"empty"),action:"prepare_publication_batch",requested:plan.targets.length,queued:0,persisted,pendingBuild:persisted,blocked,items,release:{queued:false,reason:persisted?"deferred_single_build_finalize":"no_front_ready_products"},preparation,refresh,repairUnpublish};
        }else if(request.deferRelease===true){
          const preparedItems=Array.isArray(preparation&&preparation.items)?preparation.items:[];
          const items=repairItems.concat(preparationBlocked,preparedItems.filter((item)=>item&&item.status!=="blocked"));
          const persisted=items.filter((item)=>item&&item.persisted===true).length;
          const blocked=items.filter((item)=>item&&(item.status==="blocked"||item.status==="unpublish_failed")).length;
          batchResult={ok:true,status:persisted?(blocked?"partial":"pending_finalize"):(blocked?"blocked":"empty"),action:"prepare_publication_batch",requested:plan.targets.length,queued:0,persisted,pendingBuild:persisted,blocked,items,preparation,refresh,repairUnpublish,release:{queued:false,reason:"deferred_single_build_finalize"},automaticPublication:false,publicSnapshotConfirmed:false,buildVerificationRequired:true};
        }else{
          const liveDoc=await CandidateReview.stage(process.cwd());
          const publishResult=await ProductGoLiveAudit.requestPublicationBatch(event,actor,{mode:"production",confirmation:text(body.confirmation),candidateIds:preparedIds,preparedByFrontLifecycle:true},scope,liveDoc);
          const publishItems=Array.isArray(publishResult&&publishResult.items)?publishResult.items:[];
          const items=repairItems.concat(preparationBlocked,publishItems);
          const queued=items.filter((item)=>item&&item.queued===true).length;
          const persisted=items.filter((item)=>item&&item.persisted===true).length;
          const pendingBuild=items.filter((item)=>item&&item.pendingBuild===true).length;
          const blocked=items.filter((item)=>item&&(item.status==="blocked"||item.status==="unpublish_failed")).length;
          batchResult=Object.assign({},publishResult,{requested:plan.targets.length,queued,persisted,pendingBuild,blocked,items,preparation,refresh,repairUnpublish,status:queued?(blocked?"partial":"queued"):(pendingBuild?(blocked?"partial":"pending_build"):(blocked?"blocked":"empty"))});
        }
      }else{
        batchResult=await ProductGoLiveAudit.requestUnpublicationBatch(event,actor,{mode:"production",confirmation:text(body.confirmation),candidateIds:plan.targets.map((row)=>row.candidateId),deferRelease:request.deferRelease===true},scope);
      }
      const recorded=await Automation.recordProductFrontSync(actorId,request,Object.assign({},batchResult,{refresh:refresh||batchResult.refresh||null,repairUnpublish:repairUnpublish||batchResult.repairUnpublish||null}),loadedJob);
      const guardRestore={ok:true,restored:[],failures:[],skipped:true,reason:"front_candidate_ledger_read_only"};if(recorded&&recorded.frontSyncResult)recorded.frontSyncResult.adminPlacementGuard=guardRestore;
      return json(200,recorded);
    }
    if(action==="setting_save")return json(200,{ok:true,version:Automation.VERSION,setting:await Automation.saveSetting(actorId,body.setting||body)});
    if(action==="operating_preset_apply")return json(200,await Automation.applyOperatingPreset(actorId,body.preset));
    if(action==="signal_research_begin"||action==="signal_research_step"){
      const scopeType=lower(body.scopeType||"global"),regionGroup=text(body.regionGroup),region=scopeType==="regional"?Automation.regionRow(regionGroup):null;
      if(scopeType==="regional"&&!region){const error=new Error("선택 권역을 찾을 수 없습니다.");error.statusCode=400;throw error;}
      const options={event,scopeType,regionGroup,regionNameKo:region&&region.nameKo,regionNameEn:region&&region.nameEn,countryCodes:region?Automation.registry().countries.filter((row)=>row.regionGroup===regionGroup).map((row)=>row.code):[],restart:body.restart===true};
      return json(200,action==="signal_research_begin"?await MarketSignals.beginSignalJob(actorId,options):await MarketSignals.advanceSignalJob(actorId,options));
    }
    if(action==="global_signal_check")return json(200,await MarketSignals.beginSignalJob(actorId,{scopeType:"global",restart:body.restart===true}));
    if(action==="regional_signal_check"){
      const regionGroup=text(body.regionGroup),region=Automation.regionRow(regionGroup);if(!region){const error=new Error("선택 권역을 찾을 수 없습니다.");error.statusCode=400;throw error;}
      const countryCodes=Automation.registry().countries.filter((row)=>row.regionGroup===regionGroup).map((row)=>row.code);
      return json(200,await MarketSignals.beginSignalJob(actorId,{scopeType:"regional",regionGroup,regionNameKo:region.nameKo,regionNameEn:region.nameEn,countryCodes,restart:body.restart===true}));
    }
    if(action==="market_signal_apply"){
      const report=plain(body.report||body);if(report&&report.scope&&report.scope.type==="regional"&&!Automation.regionRow(report.scope.regionGroup)){const error=new Error("점검 결과의 권역을 찾을 수 없습니다.");error.statusCode=400;throw error;}
      return json(200,await MarketSignals.applySignalPlan(actorId,report));
    }
    if(action==="policy_ai_discuss"){
      const scope=policyScopeFromInput(body.scope||body);
      return json(200,await PolicyDiscussion.discuss(actorId,Object.assign({},body,{scope})));
    }
    if(action==="policy_decision_save"){
      const scope=policyScopeFromInput(body.scope||body);
      return json(200,await PolicyDiscussion.saveDecision(actorId,Object.assign({},body,{scope})));
    }
    if(action==="policy_messages_delete"){
      const scope=policyScopeFromInput(body.scope||body);
      return json(200,await PolicyDiscussion.deleteMessages(actorId,Object.assign({},body,{scope})));
    }
    if(action==="policy_decision_clear"){
      const scope=policyScopeFromInput(body.scope||body);
      return json(200,await PolicyDiscussion.clearDecision(actorId,{scope}));
    }
    if(action==="policy_workspace_delete"){
      const scope=policyScopeFromInput(body.scope||body);
      return json(200,await PolicyDiscussion.deleteWorkspace(actorId,{scope}));
    }
    if(action==="policy_promote"){
      const scope=policyScopeFromInput(body.scope||body);
      return json(200,await PolicyDiscussion.promoteToPolicy(actorId,Object.assign({},body,{scope})));
    }
    if(action==="policy_execution_log"){
      const scope=policyScopeFromInput(body.scope||body);
      return json(200,await PolicyDiscussion.appendExecutionLog(actorId,Object.assign({},body,{scope})));
    }
    if(action==="run_now")return json(200,await Automation.runScope({event,countryCode:body.countryCode,subdivisionCode:body.subdivisionCode||body.regionCode||"NATIONWIDE",actorId,trigger:"administrator-supplier-discovery",force:body.force===true,dryRun:body.dryRun===true}));
    if(action==="commit_preview")return json(200,await Automation.commitPreviewCandidates(actorId,body));
    if(action==="candidate_action")return json(200,await Automation.candidateAction(actorId,body));
    if(action==="research_candidate_action")return json(200,await Automation.researchCandidateAction(actorId,body));
    return json(404,{ok:false,error:"지원하지 않는 국가·지역 관제 요청입니다."});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:text(error&&error.code)||null});}
};
