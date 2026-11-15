'use strict';
// IGDC country automation 1–15: administrator-only, read-only checkpoint audit.
// No seller URLs, raw candidate ledgers, visitor addresses, JWTs or secrets.
// Access is restricted by the existing commerce-country-control session/role gate.
const Automation = require('./commerce-country-automation.v1');
const Store = require('./global-slot-console-supabase');
const VERSION = 'igdc-country-automation-phase01-15-diagnostic.v1';
const HUBS = Object.freeze({
  'country-supplier-staged-auto': 'supplier',
  'country-product-ai-private-pipeline': 'product',
  'country-private-psom-auto': 'psom'
});
const JOB_HUBS = Object.freeze({
  'country-supplier-scheduled-research-job':'supplier',
  'country-product-reference-research-job':'product'
});
const JOB_FIELDS = [
  'id','scope_hub','scope_country','scope_region','updated_at','updated_by',
  'status:rule->>status','jobId:rule->>jobId','manualOnly:rule->manualOnly',
  'searchCursor:rule->>searchCursor','searchTotal:rule->checkpointMeta->searchTotal',
  'inspectCursor:rule->>inspectCursor','inspectTotal:rule->checkpointMeta->inspectTotal',
  'rankCursor:rule->>rankCursor','rankTotal:rule->checkpointMeta->rankTotal',
  'candidateCount:rule->checkpointMeta->candidateCount',
  'resultCount:rule->resultCount','discoveryResultCount:rule->discoveryResultCount',
  'lastError:rule->lastError'
].join(',');
const LIMIT = 200;
const MAX_PAGES = 12;
const FIELDS = [
  'id','scope_hub','scope_country','scope_region','updated_at','enabled',
  'phase:rule->>phase','jobId:rule->>jobId','lastResult:rule->>lastResult',
  'lastStepAt:rule->>lastStepAt','completedAt:rule->>completedAt',
  'nextCycleAt:rule->>nextCycleAt','nextRefreshAt:rule->>nextRefreshAt',
  'nextRetryAt:rule->>nextRetryAt','leaseUntil:rule->>leaseUntil',
  'operatorAutoPause:rule->operatorAutoPause','roundsCompleted:rule->roundsCompleted',
  'providerSuccesses:rule->providerSuccesses','providerFailures:rule->providerFailures',
  'lastProvider:rule->lastProvider','progressivePersisted:rule->progressivePersisted',
  'activeSupplierCount:rule->activeSupplierCount','qualifiedSupplierCount:rule->qualifiedSupplierCount',
  'supplierTarget:rule->supplierTarget','targetReached:rule->targetReached',
  'privateCandidatesStaged:rule->privateCandidatesStaged',
  'lastObservedProductStageToken:rule->>lastObservedProductStageToken',
  'lastSupplierRunAt:rule->>lastSupplierRunAt',
  'placed:rule->placed','reviewRequired:rule->reviewRequired',
  'lastPlacementOutcome:rule->lastPlacementOutcome',
  'lastErrorReason:rule->>lastErrorReason','errors:rule->errors',
  'sectionFill:rule->sectionFill'
].join(',');
const text = v => String(v == null ? '' : v).trim();
const list = v => Array.isArray(v) ? v : [];
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const num = v => Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0);
const time = v => { const n=Date.parse(text(v)); return Number.isFinite(n)?n:0; };
const country = v => text(v).toUpperCase().replace(/[^A-Z]/g, '').slice(0,2);
const region = v => text(v||'NATIONWIDE').toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,80)||'NATIONWIDE';
const key = (c,r) => country(c)+'|'+region(r);
function safeError(value) {
  // No arbitrary raw DB errors or merchant URLs in an admin export that may be shared for investigation.
  const raw=text(value).slice(0,360).replace(/https?:\/\/\S+/gi,'[URL]')
    .replace(/bearer\s+\S+/gi,'Bearer [REDACTED]')
    .replace(/(?:sk|eyJ)[A-Za-z0-9_.-]{24,}/g,'[TOKEN]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[IP]');
  return raw.slice(0,160);
}
function errorType(value) {
  const s=text(value).toLowerCase();
  if(!s)return 'not_reported';
  if(/429|rate.limit|quota/.test(s))return 'provider_quota_or_rate_limit';
  if(/403|permission|access.denied/.test(s))return 'provider_permission';
  if(/not.configured|credentials|api.key/.test(s))return 'provider_configuration';
  if(/timeout|abort|504|502|503|network|fetch.failed|econnreset/.test(s))return 'network_or_timeout';
  if(/conflict|409|revision|lease/.test(s))return 'checkpoint_conflict';
  if(/country.*paused|administrator.*paused|operator.*paused/.test(s))return 'administrator_pause';
  if(/supplier|source/.test(s))return 'supplier_source_gate';
  if(/psom|placement|section/.test(s))return 'private_placement_gate';
  return 'other';
}
function compact(row) {
  const phase=text(row.phase)||'unknown', errors=list(row.errors);
  const last=errors.length ? obj(errors[errors.length-1]) : {};
  const lastError=safeError(last.error||last.reason||last.message||row.lastErrorReason);
  const provider=obj(row.lastProvider), fill=obj(row.sectionFill), placement=obj(row.lastPlacementOutcome);
  return {
    kind:HUBS[row.scope_hub],scope:key(row.scope_country,row.scope_region),
    phase,lastResult:text(row.lastResult).slice(0,150)||null,
    lastStepAt:row.lastStepAt||null,updatedAt:row.updated_at||null,
    completedAt:row.completedAt||null,nextCycleAt:row.nextCycleAt||null,
    nextRefreshAt:row.nextRefreshAt||null,nextRetryAt:row.nextRetryAt||null,
    leaseUntil:row.leaseUntil||null,operatorPaused:row.operatorAutoPause===true,
    roundsCompleted:num(row.roundsCompleted),provider:{name:text(provider.provider).slice(0,28)||null,
      status:text(provider.status).slice(0,70)||null,found:num(provider.count),
      failures:num(row.providerFailures),successes:num(row.providerSuccesses)},
    supplier:{privateSaved:num(row.progressivePersisted),active:num(row.activeSupplierCount),
      policyQualified:num(row.qualifiedSupplierCount),target:num(row.supplierTarget),
      targetReached:row.targetReached===true},
    product:{privateStaged:num(row.privateCandidatesStaged),supplierMarkerPresent:!!text(row.lastSupplierRunAt)},
    psom:{placed:num(row.placed),reviewRequired:num(row.reviewRequired),
      lastOutcome:{requested:num(placement.requested),assigned:num(placement.assigned),
        failed:num(placement.failed),held:num(placement.held),inconclusive:num(placement.inconclusive)},
      observedStageTokenPresent:!!text(row.lastObservedProductStageToken),
      // Only a count comparison; never export durable candidate IDs.
      observedStageToken:text(row.lastObservedProductStageToken).split('|').slice(-1)[0]||null},
    sectionFill:{totalSections:num(fill.totalSections),belowPrivate20:list(fill.under20).length,
      belowPrivate100:list(fill.under100).length,fullTargetComplete:fill.fullTargetComplete===true},
    error:{count:errors.length,lastCategory:errorType(lastError),lastMessage:lastError||null}
  };
}
function compactJob(row) {
  const last=obj(row.lastError),reason=safeError(last.message||last.error);
  return {kind:JOB_HUBS[row.scope_hub],scope:key(row.scope_country,row.scope_region),
    status:text(row.status)||'unknown',updatedAt:row.updated_at||null,
    ownerClass:['scheduled-automation','scheduled-country-product-ai'].includes(text(row.updated_by))?'scheduled':'manual_or_other',
    manualOnly:row.manualOnly===true,
    search:{done:num(row.searchCursor),total:num(row.searchTotal)},
    inspection:{done:num(row.inspectCursor),total:num(row.inspectTotal)},
    ranking:{done:num(row.rankCursor),total:num(row.rankTotal)},
    candidates:num(row.candidateCount),productResults:num(row.resultCount),
    productDiscovery:num(row.discoveryResultCount),
    lastError:reason?{category:errorType(reason),message:reason}:null};
}
function create(deps) {
  const automation=deps&&deps.automation||Automation,store=deps&&deps.store||Store;
  const clock=deps&&deps.clock||(()=>new Date().toISOString());
  async function run() {
    const startedAt=clock(),readErrors=[],scopeRows=[];
    let plan={mode:'unavailable',scopes:[]},state=null;
    try{plan=await automation.autoProductScopes();}catch(e){readErrors.push({component:'selected_scopes',category:errorType(e&&e.message),message:safeError(e&&e.message)});}
    try{state=await automation.configState();if(state.storageAvailable===false)readErrors.push({component:'control_settings',category:'db_unavailable',message:safeError(state.storageError)});}
    catch(e){readErrors.push({component:'control_settings',category:errorType(e&&e.message),message:safeError(e&&e.message)});}
    let complete=true;
    for(let page=0;page<MAX_PAGES;page++){
      try{
        const rows=list(await store.select('gslot_policies','select='+FIELDS+
          '&scope_hub=in.('+Object.keys(HUBS).join(',')+')&order=id.asc&limit='+LIMIT+'&offset='+(page*LIMIT)));
        scopeRows.push(...rows);
        if(rows.length<LIMIT)break;
        if(page===MAX_PAGES-1){complete=false;readErrors.push({component:'checkpoints',category:'page_limit',message:'진행 기록이 조회 상한에 도달했습니다. 일부 국가가 누락될 수 있습니다.'});}
      }catch(e){complete=false;readErrors.push({component:'checkpoints',category:errorType(e&&e.message),message:safeError(e&&e.message)});break;}
    }
    // Detailed search cursor/total counts, but no multi-MB research job arrays.
    let jobScanComplete=true;const jobRows=[];
    for(let page=0;page<MAX_PAGES;page++){
      try{
        const rows=list(await store.select('gslot_policies','select='+JOB_FIELDS+
          '&scope_hub=in.('+Object.keys(JOB_HUBS).join(',')+')&order=id.asc&limit='+LIMIT+'&offset='+(page*LIMIT)));
        jobRows.push(...rows);
        if(rows.length<LIMIT)break;
        if(page===MAX_PAGES-1){jobScanComplete=false;readErrors.push({component:'research_job_progress',category:'page_limit',message:'대형 조사 작업 일부가 조회 상한으로 생략됐습니다.'});}
      }catch(e){jobScanComplete=false;readErrors.push({component:'research_job_progress',category:errorType(e&&e.message),message:safeError(e&&e.message)});break;}
    }
    const jobMap=new Map();
    for(const raw of jobRows){
      if(!JOB_HUBS[raw.scope_hub]||!country(raw.scope_country))continue;
      const job=compactJob(raw),id=job.scope;
      if(!jobMap.has(id))jobMap.set(id,{});
      const previous=jobMap.get(id)[job.kind];
      // Exclude human-owned supplier jobs entirely: keep original protected.
      if(!previous||time(job.updatedAt)>=time(previous.updatedAt))jobMap.get(id)[job.kind]=job;
    }
    const expected=list(plan.scopes).map(s=>key(s.countryCode,s.subdivisionCode));
    const expectedSet=new Set(expected);
    const map=new Map();
    for(const original of scopeRows){
      const kind=HUBS[original.scope_hub];if(!kind||!country(original.scope_country))continue;
      const row=compact(original),id=row.scope;
      if(!map.has(id))map.set(id,{});
      const current=map.get(id)[kind];
      if(!current||time(row.updatedAt)>=time(current.updatedAt))map.get(id)[kind]=row;
    }
    const allKeys=[...new Set([...expected,...map.keys(),...jobMap.keys()])].sort();
    const issues=[],scopes=[];
    const issue=(scope,kind,code,level,detail)=>issues.push({scope,kind,code,level,detail});
    const current=time(clock());
    for(const scope of allKeys){
      const stage=map.get(scope)||{},scheduled=expectedSet.has(scope);
      const supplier=stage.supplier||null,product=stage.product||null,psom=stage.psom||null,jobs=jobMap.get(scope)||{};
      const productSaved=product?product.product.privateStaged:0;
      if(scheduled&&complete){
        if(!supplier)issue(scope,'supplier','supplier_checkpoint_missing','warning','예약 공급업체 조사 진행 기록이 없습니다.');
        if(supplier&&supplier.operatorPaused)issue(scope,'supplier','supplier_operator_paused','info','관리자 중지 상태입니다.');
        if(supplier&&supplier.error.count>0)issue(scope,'supplier','supplier_errors','warning',supplier.error.lastCategory);
        if(supplier&&supplier.phase==='researching'&&!jobs.supplier)
          issue(scope,'supplier','supplier_search_checkpoint_missing','warning','진행 중인 공급업체 조사 커서를 찾지 못했습니다.');
        if(jobs.supplier&&jobs.supplier.lastError)
          issue(scope,'supplier','supplier_search_job_error','warning',jobs.supplier.lastError.category);
        if(supplier&&supplier.lastStepAt&&current-time(supplier.lastStepAt)>45*60000&&
          !supplier.operatorPaused&&time(supplier.nextCycleAt)<current&&time(supplier.nextRetryAt)<current)
          issue(scope,'supplier','supplier_step_stale','warning','마지막 조사가 45분 이상 전이고 다음 실행 대기가 아닙니다. 예약 함수 로그가 필요합니다.');
        if(!product){if(supplier&&supplier.supplier.active>0)issue(scope,'product','product_checkpoint_missing','warning','공급업체는 있으나 상품 조사 진행 기록이 없습니다.');}
        else{
          if(product.operatorPaused)issue(scope,'product','product_operator_paused','info','관리자 중지 상태입니다.');
          if(product.error.count>0)issue(scope,'product','product_errors','warning',product.error.lastCategory);
          if(jobs.product&&jobs.product.lastError)
            issue(scope,'product','product_search_job_error','warning',jobs.product.lastError.category);
          if(product.phase==='manual_job_preserved')issue(scope,'product','manual_product_job_protected','info','관리자 수동 상품 조사 기록이 보호되어 자동 진행이 대기 중입니다.');
          if(supplier&&supplier.supplier.active>0&&product.lastStepAt&&current-time(product.lastStepAt)>70*60000&&
            !product.operatorPaused&&time(product.nextRetryAt)<current&&time(product.nextRefreshAt)<current)
            issue(scope,'product','product_step_stale','warning','상품 조사 기록이 오래 갱신되지 않았습니다.');
        }
        if(productSaved>0&&!psom)issue(scope,'psom','psom_checkpoint_missing','warning','비공개 상품은 저장됐으나 PSOM 진행 기록이 없습니다.');
        if(psom){
          if(psom.error.count>0)issue(scope,'psom','psom_errors','warning',psom.error.lastCategory);
          if(productSaved>0&&psom.psom.placed===0&&time(psom.nextCycleAt)>current)
            issue(scope,'psom','psom_waiting_with_products','info','비공개 후보가 있으나 PSOM 진행 대기 중입니다. 검증 보류일 수도 있습니다.');
        }
      }
      scopes.push({scope,scheduled,researchJobs:{supplier:jobs.supplier||null,product:jobs.product||null},phases:{supplier:supplier&&supplier.phase||'not_started',
        product:product&&product.phase||'not_started',psom:psom&&psom.phase||'not_started'},supplier,product,psom});
    }
    let registryCount=null,registryCodes=[];
    try{const countries=list(obj(automation.registry()).countries);registryCodes=countries.map(row=>country(row.code)).filter(Boolean);registryCount=registryCodes.length;}
    catch(e){readErrors.push({component:'country_registry',category:errorType(e&&e.message),message:safeError(e&&e.message)});}
    const hasSettings=!!state&&state.storageAvailable!==false;
    const isComplete=complete&&jobScanComplete&&hasSettings&&readErrors.length===0;
    const report={
      ok:true,reportType:'igdc-country-automatic-research-phase01-15-diagnostic',version:VERSION,
      generatedAt:clock(),startedAt,coverage:{complete:isComplete,checkpointScanComplete:complete,researchJobScanComplete:jobScanComplete,
        registeredCountries:registryCount,registeredCountryCodes:registryCodes,
        masterMode:text(obj(state&&state.master).mode||plan.mode)||'unknown',
        expectedScheduledScopes:expected.length,observedCheckpointRows:scopeRows.length,observedResearchJobRows:jobRows.length,
        observedScopes:scopes.length,unselectedCheckpoints:scopes.filter(s=>!s.scheduled).length,
        buildCommit:text(process.env.COMMIT_REF).slice(0,40)||null},
      summary:{expectedScheduledScopes:expected.length,
        supplierCheckpoints:scopes.filter(s=>s.supplier).length,scheduledSupplierResearchJobs:scopes.filter(s=>s.researchJobs.supplier).length,productResearchJobs:scopes.filter(s=>s.researchJobs.product).length,
        productCheckpoints:scopes.filter(s=>s.product).length,
        psomCheckpoints:scopes.filter(s=>s.psom).length,
        supplierRowsWithErrors:scopes.filter(s=>s.supplier&&s.supplier.error.count).length,
        productRowsWithErrors:scopes.filter(s=>s.product&&s.product.error.count).length,
        psomRowsWithErrors:scopes.filter(s=>s.psom&&s.psom.error.count).length,
        privateSuppliersSaved:scopes.reduce((n,s)=>n+(s.supplier?s.supplier.supplier.privateSaved:0),0),
        privateProductsStaged:scopes.reduce((n,s)=>n+(s.product?s.product.product.privateStaged:0),0),
        privatePsomPlaced:scopes.reduce((n,s)=>n+(s.psom?s.psom.psom.placed:0),0),
        issueCount:issues.length,
        issueCategories:issues.reduce((m,row)=>(m[row.code]=(m[row.code]||0)+1,m),{})},
      issues,readErrors,scopes,
      interpretation:{
        providerSuccessDoesNotEqualSavedSuppliers:true,privateStagingDoesNotEqualPublishedProduct:true,checkpointCountersAreNotUniqueLedgerTotals:true,
        noScheduledLogsInDatabase:true,
        productionFunctionLogsRequiredForInvocationAndTimeoutConfirmation:true,
        noUnselectedCountryActivation:true,
        suggestedSchedulerLogs:['commerce-country-supplier-research-scheduler','commerce-country-product-ai-scheduler','commerce-country-private-psom-scheduler']
      },
      safety:{readOnly:true,automaticFrontMatch:false,automaticPublication:false,
        candidateLedgerRead:false,merchantUrlsExcluded:true,visitorIpExcluded:true,
        secretsExcluded:true,manualOperatorDecisionsUnchanged:true}
    };
    return report;
  }
  return {run};
}
module.exports={VERSION,HUBS,create,run:()=>create().run()};
