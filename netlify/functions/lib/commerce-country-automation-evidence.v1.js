"use strict";
/**
 * Evidence-based, read-only explanation for the existing administrator-only
 * 1-15 country-automation diagnostic. Uses checkpoint/job summaries already
 * selected by that diagnostic; never executes searches or writes ledgers.
 * Numbers are OBSERVATIONS, not evidence of successful live web access.
 */
const VERSION='igdc-auto-stage-evidence.v1.3-ten-stage';
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
 const recent=Array.isArray(provider.history)?provider.history:[],counts=o(provider.totals),startGate=o(productState.startGate),manualBlock=o(productState.manualBlock);
 const stage={
  1:{name:'선택국가·권역·IP 독립 실행',state:scheduled?'selected':'not_selected',
    observed:{scheduled,countryCode:t(scope).split('|')[0],countrySource:'administrator_selection',schedulerInvocationVerified:false},source:'autoProductScopes.scopes + Netlify function logs'},
  2:{name:'공급업체 예약 실행·체크포인트',state:!hasSupplier?'no_checkpoint':supplier.operatorPaused?'operator_paused':t(supplier.phase)||'checkpoint_present',
    observed:{phase:t(supplier.phase)||null,paused:supplier.operatorPaused===true,jobOwner:supplierJob.ownerClass||null,
      lastStepAt:supplier.lastStepAt||null,lastProviderAt:provider.at||null,jobAgeMinutes:supplierJobAge,
      nextRetryAt:supplier.nextRetryAt||null,schedulerExecutionId:null},source:'supplier checkpoint + research job; server invocation logs unavailable'},
  3:{name:'국가별 검색 공급업체·응답 진단',state:providerStatus==='ok'&&n(provider.found)>0?'results_observed':providerName?(providerStatus==='empty'?'provider_empty':'provider_'+(providerStatus||'unknown')):'not_observed',
    observed:{lastProvider:providerName||null,status:providerStatus||null,httpStatus:provider.httpStatus||null,
      requestedCountry:provider.latestCountry||null,selectedCountry:t(scope).split('|')[0],
      countryMismatch:!!provider.latestCountry&&provider.latestCountry!==t(scope).split('|')[0],
      lastFound:n(provider.found),latestDetail:provider.latestDetail||null,
      perProviderCounts:counts,latestAttempts:recent,successSteps:n(provider.successes),failureSteps:n(provider.failures),
      jobSearchDone:n(o(supplierJob.search).done),jobSearchTotal:n(o(supplierJob.search).total),lastAttemptAt:provider.at||supplier.lastStepAt||null},
    source:'supplier checkpoint providerHistory/providerTotals, lastProvider + research cursor'},
  4:{name:'업체 후보 검사·공식 판매처 적격성',state:n(gate.ledgerRows)>0?'ledger_inspection_observed':'no_eligible_supplier_evidence',
    observed:{candidateRows:n(gate.ledgerRows),missingSellerUrl:n(gate.missingUsableSellerSource),
      excludedStatus:n(gate.excludedByStatus),excludedOperator:n(gate.excludedByOperator),excludedRisk:n(gate.excludedByRisk),
      lastRejectedNonSeller:n(provider.rejectedNonSeller),lastNovelCandidates:n(provider.novelCandidates),
      searchJobInspectionDone:n(o(supplierJob.inspection).done),searchJobInspectionTotal:n(o(supplierJob.inspection).total)},
    source:'supplier job inspect cursor + private supplier-gate counters'},
  5:{name:'공급업체 비공개 원장 저장·10곳 인수조건',state:n(gate.eligibleSellerSites)>=MIN_SUPPLIERS?'threshold_met':n(gate.ledgerRows)?'below_threshold':'no_usable_supplier',
    observed:{privateSupplierLedgerRows:n(gate.ledgerRows),eligibleDistinctSites:n(gate.eligibleSellerSites),
      requiredDistinctSites:MIN_SUPPLIERS,supplierCheckpointSaved:n(supplierState.privateSaved),
      requiredByProductWorker:n(startGate.required)||MIN_SUPPLIERS,productWorkerFreshLedgerObserved:n(startGate.observed),
      productWorkerVerifiedBy:startGate.verification||null},
    source:'supplier checkpoint supplierGate + product checkpoint supplierStartGate'},
  6:{name:'상품 자동조사 인수·수동작업 보호',state:!hasProduct?'no_checkpoint':t(product.phase)==='manual_job_preserved'?'manual_job_protected':t(product.phase)||'unknown',
    observed:{phase:t(product.phase)||null,lastResult:t(product.lastResult)||null,
      jobStatus:t(productJob.status)||null,jobOwner:productJob.ownerClass||null,jobAgeMinutes:productJobAge,
      pauseMode:runtime.pauseMode||null,runtimePaused:runtime.paused===true,
      manualBlock,jobIdMatchesRuntime:t(runtime.jobId)===t(productJob.jobId),
      supplierMarkerPresent:productState.supplierMarkerPresent===true},
    source:'product checkpoint + product job + job runtime metadata'},
  7:{name:'공급업체 사이트 기반 상품 조사',state:n(productJob.productResults)>0?'historical_or_current_results_observed':'no_results_observed',
    observed:{discoveredInJob:n(productJob.productDiscovery),resultsInJob:n(productJob.productResults),
      inspected:n(o(productJob.inspection).done),inspectionTotal:n(o(productJob.inspection).total),
      jobAgeMinutes:productJobAge,jobOwner:productJob.ownerClass||null},
    source:'private product research job discovery/result/inspection cursors'},
  8:{name:'상품 썸네일·판매 링크 검증',state:'requires_private_candidate_validation',
    observed:{productsObserved:n(productJob.productResults),validatedImageAndLinkCount:null,
      sourceUrlVerifiedCount:null,crossCountryMismatches:null,
      note:'원장 후보별 실제 이미지 URL 및 판매처 연결은 별도 검증 기록 없이는 성공으로 단정하지 않음'},
    source:'private candidate inspection results not included in checkpoint summary'},
  9:{name:'최신·미배치 상품 비공개 원장 기록',state:n(productState.privateStaged)>0?'staged_checkpoint_observed':'no_staged_checkpoint',
    observed:{checkpointCumulative:n(productState.privateStaged),lastStagingDone:n(lastStaging.done),
      blocked:n(lastStaging.blocked),failed:n(lastStaging.failed),reviewRequired:n(lastStaging.reviewRequired),
      remaining:n(lastStaging.remaining),storageAttempts:latestStage.attempted??null,
      storageNewlyCreated:latestStage.created??null,storageUpdated:latestStage.updated??null,
      storageFailed:latestStage.failed??null},
    source:'product checkpoint lastStaging + private product job stageSummary'},
  10:{name:'관리자 검토·22개 섹션·프론트 매핑',state:'operator_review_required',
    observed:{privatePsomPlaced:n(psomState.placed),psomBlocked:n(o(psomState.lastCandidateGate).blocked),
      sections:20,automaticFrontPublication:false,operatorApprovalRequired:true},
    source:'psom checkpoint; Front Match remains administrator-controlled'}
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
  if(provider.latestCountry&&provider.latestCountry!==t(scope).split('|')[0])
   add('search_country_scope_mismatch','blocking','search','검색 엔진에 전달한 국가와 관리자 선택 국가가 서로 다릅니다.',
     {expected:t(scope).split('|')[0],observed:provider.latestCountry},
     ['supplierCheckpoint.lastProvider.targetCountry'],'선택 국가 코드를 검색 요청 국가 필드에 강제 지정하고 재확인');
  if(recent.length&&recent.filter(x=>['rate_limit','http_429','http_403','blocked'].includes(t(x.status))).length>=3)
   add('search_provider_repeated_block','error','search','최근 검색 제공업체 응답이 반복 차단되어 검색 경로가 소진됩니다.',
     {blockedRecent:recent.filter(x=>['rate_limit','http_429','http_403','blocked'].includes(t(x.status))).length,
      attemptsRecorded:recent.length},['supplierCheckpoint.providerHistory'],'외부 검색의 허용 범위·인증·호출 한도·쿨다운을 점검');
  if(n(gate.ledgerRows)>0&&n(gate.eligibleSellerSites)===0){
   add('supplier_rows_without_usable_seller','error','supplier','원장에 업체 후보가 있으나 사용 가능한 공식 판매처는 0개입니다.',
    {ledgerRows:n(gate.ledgerRows),missingSellerUrl:n(gate.missingUsableSellerSource),excludedStatus:n(gate.excludedByStatus),excludedRisk:n(gate.excludedByRisk)},
    ['supplierCheckpoint.supplierGate'],'업체 URL·공식 판매처 여부·검증 제외 사유별 건수를 대조');
  }
  if(n(gate.eligibleSellerSites)<MIN_SUPPLIERS){
   add('product_start_supplier_threshold','blocking','handoff','상품 자동 조사 시작에 필요한 서로 다른 공식 판매처 '+MIN_SUPPLIERS+'개 미달',
    {qualified:n(gate.eligibleSellerSites),required:MIN_SUPPLIERS},['supplierCheckpoint.supplierGate.eligibleSellerSites'],'실제 공식 공급업체 확보 단계 복구. 가짜 후보나 수동 조사 건수를 자동 성과로 계산하지 말 것');
  }
  if(['research_manually_paused_preserved','manual_runtime_checkpoint_mismatch_no_auto_archival'].includes(t(product.lastResult))){
   add('product_auto_blocked_by_preserved_manual_state','blocking','product','상품 자동화가 수동 조사 보호 조건으로 대기 중입니다. 승인과 일치하는 실행 기록 확인이 필요합니다.',
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
 const chosen=findings.some(x=>x.code==='search_country_scope_mismatch')
   ? findings.find(x=>x.code==='search_country_scope_mismatch')
   :(n(gate.eligibleSellerSites)>=MIN_SUPPLIERS&&findings.some(x=>x.code==='product_runtime_takeover_mismatch'))
   ?findings.find(x=>x.code==='product_runtime_takeover_mismatch')
   :(n(gate.eligibleSellerSites)>=MIN_SUPPLIERS&&['research_manually_paused_preserved','manual_runtime_checkpoint_mismatch_no_auto_archival'].includes(t(product.lastResult)))
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
   '검색 제공업체의 최근 16회 상태·HTTP 코드·국가와 합계는 신규 배포 이후에만 기록되며, 원본 URL별 차단 사유는 별도 로그가 필요함',
   '신규 DB INSERT 시도·성공·실패는 stageSummary에 기록된 경우만 표시하고, 없으면 null로 표시'
  ],
  evidenceQuality:{checkpointSummaryPresent:hasSupplier&&hasProduct,liveNetlifyInvocationConfirmed:false,
    perProviderHttpTraceStored:recent.length>0,actualNewDatabaseRowsConfirmed:false}};
}
module.exports={VERSION,analyze};
