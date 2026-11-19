"use strict";
/**
 * Evidence-based, read-only explanation for the existing administrator-only
 * 1-15 country-automation diagnostic. Uses checkpoint/job summaries already
 * selected by that diagnostic; never executes searches or writes ledgers.
 * Numbers are OBSERVATIONS, not evidence of successful live web access.
 */
const VERSION='igdc-auto-stage-evidence.v1.2';
const MIN_SUPPLIERS=require('./commerce-country-auto-research-policy.v1').INITIAL_SUPPLIER_SITES;
function o(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
function n(v){return Number.isFinite(Number(v))?Math.max(0,Number(v)):0;}
function t(v){return v==null?'':String(v).trim();}
function when(v){const x=Date.parse(t(v));return Number.isFinite(x)?x:0;}
function sample(code,level,stage,description,observed,paths,action){
 return {code,level,stage,description,observed,sourcePaths:paths,action};
}
function analyze(scope,scheduled,checkpoints,jobs,clock){
 const hasSupplier=!!checkpoints.supplier,hasProduct=!!checkpoints.product;
 const supplier=o(checkpoints.supplier),product=o(checkpoints.product),psom=o(checkpoints.psom);
 const supplierJob=o(jobs.supplier),productJob=o(jobs.product);
 const gate=o(o(supplier.supplier).privateLedgerGate),provider=o(supplier.provider);
 const productState=o(product.product),supplierState=o(supplier.supplier),psomState=o(psom.psom);
 const latestStage=o(productJob.storage),lastStaging=o(productState.lastStaging),runtime=o(o(jobs.runtime).runtime);
 const now=when(clock),providerAt=provider.at||null;
 const providerName=t(provider.name),providerStatus=t(provider.status).toLowerCase();
 const findings=[];
 function add(){findings.push(sample(...arguments));}
 const supplierJobAge=supplierJob.updatedAt&&now?Math.max(0,Math.round((now-when(supplierJob.updatedAt))/60000)):null;
 const productJobAge=productJob.updatedAt&&now?Math.max(0,Math.round((now-when(productJob.updatedAt))/60000)):null;
 const stage={
  1:{name:'국가 자동화 대상',state:scheduled?'enabled':'not_selected',observed:{scheduled},source:'autoProductScopes/scopes'},
  2:{name:'외부 공급업체 검색',state:providerStatus==='ok'&&n(provider.found)>0?'results_observed':providerName?(providerStatus==='empty'?'empty':'provider_result_'+(providerStatus||'unknown')):'not_observed',
    observed:{provider:providerName||null,status:providerStatus||null,foundLastStep:n(provider.found),rawReturned:n(provider.rawReturned),nonSellerRejected:n(provider.rejectedNonSeller),novelCandidates:n(provider.novelCandidates),duplicatesSkipped:n(provider.duplicatesSkipped),successSteps:n(provider.successes),failureSteps:n(provider.failures),jobSearchDone:n(o(supplierJob.search).done),jobSearchTotal:n(o(supplierJob.search).total),lastAttemptAt:provider.at||supplier.lastStepAt||null,
      recentProviderErrors:o(supplier.error).recent||[],lastErrorCategory:o(supplier.error).lastCategory||null},source:'supplierCheckpoint.lastProvider + supplierResearchJob.search'},
  3:{name:'책임 공급업체 저장 및 적격 사이트 확인',state:n(gate.eligibleSellerSites)>=MIN_SUPPLIERS?'threshold_met':n(gate.ledgerRows)?'ledger_rows_but_below_threshold':'no_usable_supplier',
    observed:{ledgerRows:n(gate.ledgerRows),eligibleSellerSites:n(gate.eligibleSellerSites),requiredDistinctSellerSites:MIN_SUPPLIERS,missingSellerUrl:n(gate.missingUsableSellerSource),excludedStatus:n(gate.excludedByStatus),excludedOperator:n(gate.excludedByOperator),excludedRisk:n(gate.excludedByRisk),autoCheckpointPersisted:n(supplierState.privateSaved)},source:'supplierCheckpoint.supplierGate + supplierCheckpoint.progressivePersisted'},
  4:{name:'상품 자동 조사 시작과 작업 소유권',state:!hasProduct?'no_checkpoint':t(product.lastResult)==='research_manually_paused_preserved'?'manual_pause_preserved':productJob.ownerClass==='manual_or_other'?'non_scheduled_job_observed':t(product.phase)||'checkpoint_without_job',
    observed:{phase:t(product.phase)||null,lastResult:t(product.lastResult)||null,jobStatus:t(productJob.status)||null,jobOwner:productJob.ownerClass||null,jobAgeMinutes:productJobAge,supplierMarkerPresent:productState.supplierMarkerPresent===true,
      pauseMode:runtime.pauseMode||null,runtimePaused:runtime.paused===true,jobIdMatchesRuntime:t(runtime.jobId)===t(productJob.jobId)},source:'productCheckpoint.phase/lastResult + productResearchJob.updated_by'},
  5:{name:'상품 조사 결과 검증',state:n(productJob.productResults)>0?'past_results_observed':'no_product_results_observed',
    observed:{discoveredInJob:n(productJob.productDiscovery),resultsInJob:n(productJob.productResults),jobAgeMinutes:productJobAge,jobOwner:productJob.ownerClass||null},source:'productResearchJob.discoveryResultCount/resultCount'},
  6:{name:'최신·미배치 비공개 후보 원장 기록',state:n(productState.privateStaged)>0?'checkpoint_staged_not_proof_of_new_write':'no_checkpoint_staging',
    observed:{stagedCheckpointCumulative:n(productState.privateStaged),lastStagingDone:n(lastStaging.done),lastStagingBlocked:n(lastStaging.blocked),lastStagingFailed:n(lastStaging.failed),lastStagingSkipped:n(lastStaging.skipped),
      lastStagingReviewRequired:n(lastStaging.reviewRequired),lastStagingRemaining:n(lastStaging.remaining),lastStagingScanCursor:n(lastStaging.scanCursor),
      storageAttempts:latestStage.attempted??null,storageNewlyCreated:latestStage.created??null,storageUpdated:latestStage.updated??null,storageFailed:latestStage.failed??null},source:'productCheckpoint.lastStagingSummary + productResearchJob.stageSummary (when present)'},
  7:{name:'섹션 배치·프론트 매칭(관리자 결정)',state:'not_required_for_research_candidate',observed:{privatePsomPlaced:n(psomState.placed)},source:'psomCheckpoint.placed',note:'20개 섹션 배치와 프론트 공개는 자동 조사 후보 기록의 선행 조건이 아님'}
 };
 if(!scheduled){add('country_not_scheduled','info','schedule','해당 국가는 현재 예약 자동 실행 대상이 아닙니다.',{},['autoProductScopes.scopes'],'국가 선택·전체 자동화 설정 확인');}
 else {
  if(!hasSupplier) add('supplier_checkpoint_absent','error','supplier','국가 자동 공급업체 체크포인트가 없습니다.',{},['gslot_policies.country-supplier-staged-auto'],'공급업체 예약 함수의 최신 배포 및 함수 로그 조회');
  if(providerName&&(providerStatus==='empty'||n(provider.found)===0)&&n(provider.failures)>0){
   add('search_provider_no_productive_output','error','search','검색 제공업체 결과 0건과 실패 누적이 함께 관찰됩니다.',
    {provider:providerName,status:providerStatus||null,lastFound:n(provider.found),failures:n(provider.failures),successes:n(provider.successes)},
    ['supplierCheckpoint.lastProvider','supplierCheckpoint.providerFailures','supplierResearchJob.search'],
    '검색 제공업체의 마지막 HTTP 상태·실제 검색 응답 개수와 Netlify 로그를 확인');
  }else if(providerName&&n(provider.found)===0){
   add('search_latest_step_empty','warning','search','마지막 검색 단계에서 신규 업체 후보가 관찰되지 않았습니다.',{provider:providerName,status:providerStatus},['supplierCheckpoint.lastProvider'],'해당 제공업체의 원본 응답과 검색 질의 확인');
  }
  if(n(gate.ledgerRows)>0&&n(gate.eligibleSellerSites)===0){
   add('supplier_rows_without_usable_seller','error','supplier','원장에 업체 후보가 있으나 사용 가능한 공식 판매처는 0개입니다.',
    {ledgerRows:n(gate.ledgerRows),missingSellerUrl:n(gate.missingUsableSellerSource),excludedStatus:n(gate.excludedByStatus),excludedRisk:n(gate.excludedByRisk)},
    ['supplierCheckpoint.supplierGate'],'업체 URL·공식 판매처 여부·검증 제외 사유별 건수를 대조');
  }
  if(n(gate.eligibleSellerSites)<MIN_SUPPLIERS){
   add('product_start_supplier_threshold','blocking','handoff','상품 자동 조사 시작에 필요한 서로 다른 공식 판매처 '+MIN_SUPPLIERS+'개 미달',
    {qualified:n(gate.eligibleSellerSites),required:MIN_SUPPLIERS},['supplierCheckpoint.supplierGate.eligibleSellerSites'],'실제 공식 공급업체 확보 단계 복구. 가짜 후보나 수동 조사 건수를 자동 성과로 계산하지 말 것');
  }
  if(t(product.lastResult)==='research_manually_paused_preserved'){
   add('product_auto_blocked_by_preserved_manual_state','blocking','product','상품 자동화 체크포인트가 과거 수동 조사 보존 조건으로 중단되었습니다.',
    {lastResult:product.lastResult,jobOwner:productJob.ownerClass||null,jobUpdatedAt:productJob.updatedAt||null,pauseMode:runtime.pauseMode||null,runtimePaused:runtime.paused===true,jobIdMatchesRuntime:t(runtime.jobId)===t(productJob.jobId)},
    ['productCheckpoint.lastResult','productResearchJob.updated_by'],'수동 작업 보존·자동 전환 허용 설정·pauseMode를 원장과 코드에서 교차 확인');
  }
  if(n(productJob.productResults)>0&&productJobAge!==null&&productJobAge>60){
   add('product_result_is_historical','warning','product','상품 결과 수량은 과거 작업에 속하며 현재 신규 등록 증거가 아닙니다.',
    {productResults:n(productJob.productResults),jobUpdatedAt:productJob.updatedAt,ageMinutes:productJobAge},
    ['productResearchJob.updated_at','productResearchJob.resultCount'],'이번 예약 실행에서 새로 생성한 상품·저장 결과와 분리해 판정');
  }
  if(n(productJob.productResults)>0&&n(productState.privateStaged)===0){
   add('product_results_without_private_staging','warning','storage','상품 조사 작업 결과는 있으나 현재 자동 비공개 원장 저장 체크포인트가 0입니다.',
    {jobResults:n(productJob.productResults),staged:n(productState.privateStaged)},
    ['productResearchJob.resultCount','productCheckpoint.privateCandidatesStaged'],'상품 출처 검증 제외·중복 판정·실제 저장 시도/생성 건수 확인');
  }
  if(n(o(psomState.lastCandidateGate).blocked)>0&&n(o(psomState.lastCandidateGate).eligible)===0){
   add('psom_candidates_all_blocked','info','placement','PSOM 심사에서 대상 후보가 모두 보류됐습니다. 자동 상품 발견 성공의 증거가 아닙니다.',
    {blocked:n(o(psomState.lastCandidateGate).blocked),reasonCounts:o(o(psomState.lastCandidateGate).reasonCounts)},
    ['psomCheckpoint.lastScanSummary'],'비공개 후보 URL·사업자 연결·섹션 근거 확인(원본 자료 보존)');
  }
 }
 if(t(o(product.error).lastMessage).includes('PAUSED_MANUAL_RESEARCH_REQUIRES_SAVED_TAKEOVER'))
   add('product_runtime_takeover_mismatch','blocking','product','상품 자동 조사 전환 조건과 저장된 수동/자동 일시정지 상태가 충돌합니다.',
     {pauseMode:runtime.pauseMode||null,runtimePaused:runtime.paused===true,jobIdMatchesRuntime:t(runtime.jobId)===t(productJob.jobId),error:t(o(product.error).lastMessage).slice(0,120)},
     ['productCheckpoint.errors','productResearchRuntime.pauseMode','productResearchRuntime.jobId'],
     '관리자 자동 전환 허용 상태, runtime pauseMode, 작업 ID를 대조해 수동 작업 보존 후 새 자동 주기를 시작');
 const blocking=findings.filter(x=>x.level==='blocking'||x.level==='error');
 const chosen=(n(gate.eligibleSellerSites)>=MIN_SUPPLIERS&&findings.some(x=>x.code==='product_runtime_takeover_mismatch'))
   ?findings.find(x=>x.code==='product_runtime_takeover_mismatch')
   :(n(gate.eligibleSellerSites)>=MIN_SUPPLIERS&&t(product.lastResult)==='research_manually_paused_preserved')
   ?findings.find(x=>x.code==='product_auto_blocked_by_preserved_manual_state')
   :(n(gate.eligibleSellerSites)<MIN_SUPPLIERS&&n(provider.failures)>0)
    ?findings.find(x=>x.code==='search_provider_no_productive_output')
    :null;
 const first=chosen||blocking[0]||findings.find(x=>x.level==='warning')||null;
 return {scope,scheduled,observedAt:clock,firstActionableBlocker:first?first.code:null,
  stages:Object.values(stage),findings,
  provenance:{supplierResearchJobOwner:supplierJob.ownerClass||null,productResearchJobOwner:productJob.ownerClass||null,
    lastSupplierJobAt:supplierJob.updatedAt||null,lastProductJobAt:productJob.updatedAt||null,
    supplierSavedTotalMayIncludeHumanRecords:true,manualVersusAutomaticNewlyCreatedNotProvenByAggregateLedger:true},
  missingEvidence:[
   '실제 예약 함수 호출 성공/실행시간/Netlify requestId는 서버 함수 로그가 필요함',
   '검색 제공업체의 개별 질의·HTTP 응답·반환 URL별 차단 사유는 현재 체크포인트 집계만으로 재구성 불가',
   '신규 DB INSERT 시도·성공·실패는 stageSummary에 기록된 경우만 표시하고, 없으면 null로 표시'
  ],
  evidenceQuality:{checkpointSummaryPresent:hasSupplier&&hasProduct,liveNetlifyInvocationConfirmed:false,
    perProviderHttpTraceStored:false,actualNewDatabaseRowsConfirmed:false}};
}
module.exports={VERSION,analyze};
