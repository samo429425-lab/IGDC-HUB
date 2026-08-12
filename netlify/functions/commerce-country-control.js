"use strict";

const AdminSession = require("./lib/global-slot-console-auth");
const Automation = require("./lib/commerce-country-automation.v1");
const MarketSignals = require("./lib/commerce-market-signal-intelligence.v1");
const PolicyDiscussion = require("./lib/commerce-policy-discussion.v1");
const ProductGoLiveAudit = require("./product-go-live-audit");
const CandidateReview = require("./commerce-candidate-review");

const READ_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director","commerce_manager"]);
const WRITE_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);

function text(value){return value==null?"":String(value).trim();}
function lower(value){return text(value).toLowerCase().replace(/[\s.]+/g,"_");}
function json(statusCode,body){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"GET,POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)};}
function parse(event){try{return event&&event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body):{};}catch(_e){const error=new Error("요청 JSON 형식이 올바르지 않습니다.");error.statusCode=400;throw error;}}
function roleList(actor){return Array.from(new Set((actor&&actor.roles||[]).map(lower).filter(Boolean)));}
function requireRole(actor,write){const allowed=write?WRITE_ROLES:READ_ROLES;const roles=roleList(actor);if(!roles.some((role)=>allowed.has(role))){const error=new Error(write?"국가·지역 자동화 설정 권한이 없습니다.":"국가·지역 책임 공급업체 관제는 관리자·운영진만 사용할 수 있습니다.");error.statusCode=403;throw error;}return roles;}
function plain(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
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
  const input=plain(raw),scopeType=lower(input.scopeType||input.type||"global");
  if(scopeType==="global")return{scopeType:"global",scopeLabel:"전 세계 통합"};
  if(scopeType==="regional"){
    const regionGroup=text(input.regionGroup),region=Automation.regionRow(regionGroup);if(!region){const error=new Error("선택 권역을 찾을 수 없습니다.");error.statusCode=400;throw error;}
    return{scopeType:"regional",regionGroup,scopeLabel:(region.nameKo||region.nameEn||regionGroup)+" 권역"};
  }
  if(scopeType==="country"){
    const countryCode=text(input.countryCode||input.country).toUpperCase(),country=Automation.countryRow(countryCode);if(!country){const error=new Error("지원되는 국가 정책 범위를 찾을 수 없습니다.");error.statusCode=400;throw error;}
    const subdivisionCode=text(input.subdivisionCode||input.regionCode||input.region||"NATIONWIDE").toUpperCase()||"NATIONWIDE";
    if(subdivisionCode!=="NATIONWIDE"){const valid=Array.isArray(country.subdivisions)&&country.subdivisions.some((item)=>text(item&&item.code).toUpperCase()===subdivisionCode);if(!valid){const error=new Error("선택 국가의 공식 주·성·지역 정책 범위를 찾을 수 없습니다.");error.statusCode=400;throw error;}}
    return{scopeType:"country",regionGroup:country.regionGroup,countryCode,subdivisionCode,scopeLabel:(country.nameKo||country.nameEn||countryCode)+" · "+countryCode+" / "+(subdivisionCode==="NATIONWIDE"?"전국":subdivisionCode)};
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
    const actor=await AdminSession.resolveUser(event);const write=method!=="GET"||["run_now","research_begin","research_step","research_commit","supplier_manual_register","product_research_begin","product_research_step","product_candidate_action","product_candidate_ledger_action","product_candidate_ai_recover","product_ai_automation","product_front_match","product_front_unmatch","product_front_finalize","commit_preview","setting_save","candidate_action","research_candidate_action","operating_preset_apply"].includes(action);requireRole(actor,write);
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
    if(action==="product_candidate_action")return json(200,await Automation.productCandidateAction(actorId,body));
    if(action==="product_candidate_ledger_action")return json(200,await Automation.productCandidateLedgerAction(actorId,body));
    if(action==="product_candidate_ai_recover")return json(200,await Automation.productCandidateAiRecover(actorId,body));
    if(action==="product_ai_automation")return json(200,await Automation.productAiAutomation(actorId,body));
    if(action==="product_front_finalize"){
      const operation=lower(body.operation)==="unmatch"?"unmatch":"match";
      const scope=ProductGoLiveAudit.selectedScope(body.countryCode,body.subdivisionCode||"NATIONWIDE");
      const result=await ProductGoLiveAudit.dispatchFrontRefresh(event,actor,{mode:"production",confirmation:text(body.confirmation),operation,candidateCount:Number(body.candidateCount||0)},scope);
      return json(200,{ok:true,frontSyncResult:result});
    }
    if(action==="product_front_match"||action==="product_front_unmatch"){
      const operation=action==="product_front_unmatch"?"unmatch":"match";
      const request=Object.assign({},body,{operation});
      const deferRelease=body.deferRelease===true;
      const candidateLedgerMode=lower(request.ledgerMode)==="candidate";
      const loadedJob=candidateLedgerMode?null:await Automation.loadProductResearchJob(request);
      const plan=await Automation.productFrontSyncTargets(request,loadedJob);
      const scope=ProductGoLiveAudit.selectedScope(plan.scope.country,plan.scope.region);
      let batchResult;
      if(!plan.targets.length){
        batchResult={ok:true,status:"empty",action:operation==="match"?"request_publication_batch":"request_unpublication_batch",requested:0,queued:0,blocked:0,items:[],release:{queued:false,reason:"no_selected_products"}};
      }else if(operation==="match"){
        /* Front Apply is the second safety checkpoint. Revalidate the actual
           external product detail pages first, remove stale/dead published
           assignments, then rebuild the target plan from the refreshed ledger.
           A missing replacement is intentionally left empty so the existing
           front Snapshot sample fallback remains authoritative. */
        const refresh=await Automation.revalidateProductFrontTargets(actorId,request,plan.targets);
        const withdrawAssignments=Array.isArray(refresh&&refresh.withdrawAssignments)?refresh.withdrawAssignments:[];
        let withdrawal={ok:true,status:"empty",requested:0,queued:0,persisted:0,pendingBuild:0,blocked:0,items:[],release:{queued:false,reason:"no_stale_public_assignments"}};
        if(withdrawAssignments.length){
          withdrawal=await ProductGoLiveAudit.requestUnpublicationAssignments(event,actor,{mode:"production",confirmation:"SITE_UNPUBLISH",assignments:withdrawAssignments,deferRelease},scope);
        }
        const refreshedPlan=await Automation.productFrontSyncTargets(request,loadedJob);
        const preparation=refreshedPlan.targets.length?await Automation.prepareProductFrontTargets(actorId,request,refreshedPlan.targets,loadedJob):{ok:true,requested:0,prepared:0,blocked:0,preparedCandidateIds:[],items:[],writeTrace:{mode:"runtime_refresh_no_live_targets"}};
        const preparedIds=Array.isArray(preparation&&preparation.preparedCandidateIds)?preparation.preparedCandidateIds:[];
        const preparationBlocked=(Array.isArray(preparation&&preparation.items)?preparation.items:[]).filter((item)=>item&&item.status==="blocked");
        let publishResult={ok:true,status:"empty",action:"request_publication_batch",requested:0,queued:0,persisted:0,pendingBuild:0,blocked:0,items:[],release:{queued:false,reason:preparedIds.length?"publication_not_requested":"no_front_ready_products"}};
        if(preparedIds.length){
          const liveDoc=await CandidateReview.stage(process.cwd());
          publishResult=await ProductGoLiveAudit.requestPublicationBatch(event,actor,{mode:"production",confirmation:text(body.confirmation),candidateIds:preparedIds,preparedByFrontLifecycle:true,deferRelease},scope,liveDoc);
        }
        const publishItems=Array.isArray(publishResult&&publishResult.items)?publishResult.items:[];
        const items=preparationBlocked.concat(publishItems);
        const queued=Number(publishResult&&publishResult.queued||0)+Number(withdrawal&&withdrawal.queued||0);
        const persisted=Number(publishResult&&publishResult.persisted||0)+Number(withdrawal&&withdrawal.persisted||0);
        const pendingBuild=Number(publishResult&&publishResult.pendingBuild||0)+Number(withdrawal&&withdrawal.pendingBuild||0);
        const blocked=Number(publishResult&&publishResult.blocked||0)+Number(withdrawal&&withdrawal.blocked||0)+preparationBlocked.length;
        const withdrawn=(Array.isArray(withdrawal&&withdrawal.items)?withdrawal.items:[]).filter((item)=>item&&(item.status==="unpublish_requested"||item.status==="unmatched")).length;
        const status=queued?(blocked?"partial":"queued"):(pendingBuild?(blocked?"partial":"pending_build"):(blocked?"blocked":(withdrawn?"refreshed_to_fallback":"empty")));
        batchResult=Object.assign({},publishResult,{requested:plan.targets.length,queued,persisted,pendingBuild,blocked,items,preparation,refresh:Object.assign({},refresh,{withdrawRequested:withdrawAssignments.length,withdrawn,withdrawal}),status,release:publishResult&&publishResult.release&&publishResult.release.queued?publishResult.release:withdrawal.release||publishResult.release});
      }else{
        batchResult=await ProductGoLiveAudit.requestUnpublicationBatch(event,actor,{mode:"production",confirmation:text(body.confirmation),candidateIds:plan.targets.map((row)=>row.candidateId),deferRelease},scope);
      }
      return json(200,await Automation.recordProductFrontSync(actorId,request,batchResult,loadedJob));
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
    if(action==="run_now")return json(200,await Automation.runScope({event,countryCode:body.countryCode,subdivisionCode:body.subdivisionCode||body.regionCode||"NATIONWIDE",actorId,trigger:"administrator-supplier-discovery",force:body.force===true,dryRun:body.dryRun===true}));
    if(action==="commit_preview")return json(200,await Automation.commitPreviewCandidates(actorId,body));
    if(action==="candidate_action")return json(200,await Automation.candidateAction(actorId,body));
    if(action==="research_candidate_action")return json(200,await Automation.researchCandidateAction(actorId,body));
    return json(404,{ok:false,error:"지원하지 않는 국가·지역 관제 요청입니다."});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:text(error&&error.code)||null});}
};
