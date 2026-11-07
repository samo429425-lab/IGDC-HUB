"use strict";
/**
 * READ-ONLY IGDC ALL-registry country automation bottleneck report.
 * No product import, PSOM placement, publication, or settings mutation.
 * All storage access stays behind commerce-country-control's admin auth.
 */
const VERSION='igdc-auto-bottleneck-diagnostic.v1.1.0-all-registry-kr-safe';
const SUPPLIER_HUB='country-supplier-staged-auto';
const PRODUCT_HUB='country-product-ai-private-pipeline';
const STAGED_PAGE_SIZE=750;
const MAX_STAGED_PAGES=8; // bounded audit, never silently claim full coverage
const RETRY_WARN_MINUTES=120; // reporting threshold, NOT a scheduler limit
function txt(v){return v==null?'':String(v).trim();}
function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
function arr(v){return Array.isArray(v)?v:[];}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function time(v){const n=Date.parse(txt(v));return Number.isFinite(n)?n:0;}
function safeCode(v){const code=txt(v).toUpperCase();return /^[A-Z]{2}$/.test(code)?code:'';}
function safeRegion(v){const x=txt(v||'NATIONWIDE').toUpperCase();return /^[A-Z0-9_-]{1,36}$/.test(x)?x:'NATIONWIDE';}
function scrub(value){
  // Diagnostics can contain raw upstream error strings; never export credentials,
  // bearer tokens, query keys, cookies, or private URLs to downloaded JSON.
  let s=txt(value).slice(0,600).replace(/[\r\n\t]+/g,' ');
  s=s.replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+/ig,'$1[비공개]');
  s=s.replace(/((?:service[_-]?role[_-]?key|api[_-]?key|token|secret|authorization|apikey|password)\s*[:=]\s*)[^\s,;]+/ig,'$1[비공개]');
  s=s.replace(/https?:\/\/[^\s\"']+/ig,'[외부주소 생략]');
  s=s.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g,'[비공개 API 키]');
  s=s.replace(/\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,'[비공개 세션 토큰]');
  return s;
}
function reasonKo(raw){
 const x=txt(raw).toLowerCase();
 if(/(?:403|access.+custom search|custom search json api|permission_denied|forbidden|api.*disabled|access_denied)/i.test(x))return {code:'search_permission_or_access',message:'검색 서비스 접근 권한 확인 필요',next:'Google 검색 API 권한·결제·사용 설정 및 대체 검색 경로 확인'};
 if(/(?:429|quota|rate.?limit|too many requests)/i.test(x))return {code:'search_quota_or_rate',message:'검색 호출 한도 또는 속도 제한',next:'검색 서비스 호출량·할당량과 재시도 간격 확인'};
 if(/(?:timeout|timed.?out|abort|execution limit|504|gateway timeout)/i.test(x))return {code:'execution_timeout',message:'외부 응답 또는 실행시간 초과',next:'해당 국가의 마지막 진행 위치와 서버 실행시간 확인'};
 if(/(?:404|not_found|not found|product.*url|specific.*url|same_supplier|domain_mismatch)/i.test(x))return {code:'seller_product_link_check',message:'상품 상세주소 또는 공급업체 연결 확인 필요',next:'실제 판매 페이지·해당 국가 판매 조건을 재검토'};
 if(/(?:persistence|persist|db|supabase|rest.*error|postgres|constraint|schema|storage|ledger|save.+failed)/i.test(x))return {code:'storage_or_schema',message:'데이터 저장·구조 오류 가능성',next:'저장 공간 응답 및 필수 열·정합성 확인'};
 if(/(?:checkpoint|revision|conflict|lease|409|manual_job|manual_preserved)/i.test(x))return {code:'checkpoint_or_operator_conflict',message:'작업 진행 기록 충돌 또는 수동 작업 대기',next:'최근 관리자 작업·작업 잠금·재시도 기록 확인'};
 if(/(?:search|source|supplier|candidate|discovery)/i.test(x))return {code:'discovery_or_supplier',message:'검색·공급업체 후보 이관 확인 필요',next:'검색 결과 원천과 실제 비공개 공급업체 저장 여부 비교'};
 return{code:'unclassified',message:'실패 원인 상세 확인 필요',next:'해당 작업의 Netlify 함수 로그와 마지막 오류 문자열 대조'};
}
function lastErrors(rule,kind){
 const rows=arr(rule.errors).slice(-3).map(x=>{
   const e=obj(x),msg=scrub(e.reason||e.error||e.message||x);
   return {at:txt(e.at)||null,stage:txt(e.stage||e.phase)||null,message:msg,classification:reasonKo(msg)};
 });
 return rows;
}
function inspectRow(row,now){
 const rule=obj(row.rule),kind=row.scope_hub===SUPPLIER_HUB?'supplier':'product',errors=lastErrors(rule,kind),
 country=safeCode(row.scope_country||obj(rule.scope).countryCode),region=safeRegion(row.scope_region||obj(rule.scope).subdivisionCode),
 phase=txt(rule.phase)||'unknown',lastResult=txt(rule.lastResult),lastStepAt=txt(rule.lastStepAt||row.updated_at)||null,
 deferred=rule.operatorAutoPause===true;
 const missingLatestError=num(arr(rule.errors).length)>0&&!errors.length;
 return {country,region,kind,phase,lastResult,lastStepAt,ageMinutes:lastStepAt?Math.max(0,Math.round((time(now||new Date().toISOString())-time(lastStepAt))/60000)):null,
   errorCount:arr(rule.errors).length,failures:num(rule.failures),lastErrors:errors,
   manualOnly:rule.manualOnly===true,operatorAutoPause:deferred,protectedJobId:rule.protectedJobId?true:false,
   searchCursor:kind==='supplier'?num(rule.lastProgressiveSearchCursor):null,
   progressiveInspected:kind==='supplier'?num(rule.progressiveInspected):null,
   progressivePersisted:kind==='supplier'?num(rule.progressivePersisted):null,
   progressiveUsableSuppliers:kind==='supplier'?num(rule.progressiveUsableSuppliers):null,
   privatePlaced:kind==='product'?num(rule.placed):null,
   privateReviewRequired:kind==='product'?num(rule.reviewRequired):null,
   pendingPlacement:kind==='product'?arr(rule.pendingPlacementIds).length:null,
   supplierRoundCompleted:kind==='supplier'?num(rule.roundsCompleted):null,
   nextCycleAt:kind==='supplier'?(rule.nextCycleAt||null):null,
   nextRefreshAt:kind==='product'?(rule.nextRefreshAt||null):null,
   source:'gslot_policies_staged_checkpoint',detailMissing:missingLatestError};
}
function checked(report,code){return arr(report).some(x=>x.code===code);}
function addProblem(problems,code,severity,title,scope,detail,next){
 problems.push({code,severity,title,scope:scope||null,detail:txt(detail).slice(0,300),recommendedAction:next});
}
function classifyMarket(country,supplier,product,durableAt,now,problems){
 const scope={country,region:'NATIONWIDE'};
 if(!supplier){addProblem(problems,'supplier_checkpoint_missing','warning','공급업체 자동화 진행 기록 없음',scope,'국가 선택은 유지되지만 자동 검색 진행 기록이 없습니다.','Netlify 공급업체 예약 함수 배포·실행 기록 확인');}
 if(supplier&&supplier.operatorAutoPause){addProblem(problems,'supplier_operator_paused','info','공급업체 자동화 일시정지',scope,'관리자가 지정한 명시적인 일시정지 기록','일시정지 의도가 맞는지 관리자에서 확인');}
 if(supplier&&supplier.phase==='manual_preserved')addProblem(problems,'country_manual_yield','warning','국가 수동 작업 보호 상태',scope,supplier.lastResult,'수동 검색 1회가 장기 차단 사유가 되지 않는지 확인');
 if(!durableAt){addProblem(problems,'no_durable_supplier','warning','상품 조사 시작에 필요한 공급업체 저장 확인 없음',scope,'자동 검색 결과 수와 실제 공급업체 원장은 다른 지표입니다.','검색 결과→업체 검사→원장 저장 단계 점검');}
 if(!product){addProblem(problems,'product_checkpoint_missing','warning','상품 자동화 진행 기록 없음',scope,'선택 국가의 상품 엔진 진행 기록을 찾을 수 없습니다.','상품 예약 실행 및 공급업체 저장 조건 확인');}
 if(product&&product.operatorAutoPause)addProblem(problems,'product_operator_paused','info','상품 자동화 명시적 일시정지',scope,'관리자 일시정지 설정이 활성화되어 있습니다.','기존 상품 고정은 유지하면서 재개 여부 확인');
 if(product&&product.lastResult==='step_failed_checkpoint_preserved'){
   const latest=product.lastErrors[product.lastErrors.length-1];const cls=latest?latest.classification:reasonKo('');
   addProblem(problems,'product_step_failed','error','상품 자동화 단계 반복 실패',scope,latest?latest.message:'오류 횟수만 있고 상세 원인이 없습니다.',cls.next);
 }
 if(supplier&&supplier.lastResult==='supplier_step_failed_checkpoint_preserved'){
   const latest=supplier.lastErrors[supplier.lastErrors.length-1];
   addProblem(problems,'supplier_step_failed','error','공급업체 자동화 단계 실패',scope,latest?latest.message:'상세 오류 기록 없음',latest?latest.classification.next:'Netlify 공급업체 함수 로그 확인');
 }
 if(product&&product.lastStepAt&&time(now)-time(product.lastStepAt)>RETRY_WARN_MINUTES*60000&&product.phase!=='complete'&&!product.operatorAutoPause){
   addProblem(problems,'product_progress_stale','warning','상품 조사 기록이 오래 갱신되지 않음',scope,'마지막 단계 '+product.lastStepAt,'자동 예약 실행 내역·국가별 대기열 확인');
 }
}
async function queryFocus(store,country,region){
 const result={country,region,productCandidateLedger:{checked:false},supplierCandidateLedger:{checked:false},errors:[]};
 async function scan(kind,src,paths){
   const found=new Map();let complete=true,successful=0;
   for(const [countryPath,regionPath] of paths){
     try{
       const filter='source_ref=eq.'+encodeURIComponent(src)+'&source_payload'+countryPath+'=eq.'+encodeURIComponent(country)+'&source_payload'+regionPath+'=eq.'+encodeURIComponent(region);
       const rows=arr(await store.select('gslot_candidates','select=id,official_url,status&'+filter+'&order=id.asc&limit=201'));
       successful++;
       if(rows.length===201)complete=false;
       rows.slice(0,200).forEach(row=>{const id=txt(row.id);if(id)found.set(id,row);});
     }catch(e){complete=false;result.errors.push({part:kind+'Ledger',reason:reasonKo(e.message),message:scrub(e.message)});}
   }
   const items=[...found.values()];
   return{checked:successful>0,rowsObserved:items.length,atLeast:items.length,complete:complete&&successful===paths.length,summary:'비공개 후보 저장 원장 관찰 수(실제 판매승인·공개 수량과 다름)',
     suspectedNonProductLinkCount:kind==='product'?items.filter(row=>{
       try{const u=new URL(txt(row.official_url));return /^(?:calendar|chat|docs|drive)\.google\.com$/i.test(u.hostname)||/(?:\.calendar\.google\.com)$/i.test(u.hostname);}catch(_e){return false;}
     }).length:0,
     suspectedNonProductLinkIds:kind==='product'?items.filter(row=>{try{return /^(?:calendar|chat|docs|drive)\.google\.com$/i.test(new URL(txt(row.official_url)).hostname);}catch(_e){return false;}}).slice(0,10).map(row=>txt(row.id)):[]};
 }
 result.supplierCandidateLedger=await scan('supplier','commerce-country-supplier-discovery',[
   ['->aiAutomation->>country','->aiAutomation->>region'],['->>targetCountry','->>targetRegion']]);
 result.productCandidateLedger=await scan('product','country-product-ranking-review',[
   ['->marketScope->>marketCountry','->marketScope->>marketRegion'],['->countrySupply->>country','->countrySupply->>region']]);
 return result;
}
async function queryMediaRelease(store){
 const url=txt(process.env.MEDIA_SUPABASE_URL||process.env.IGDC_MEDIA_SUPABASE_URL||process.env.GSLOT_SUPABASE_URL||process.env.SUPABASE_URL),
 key=txt(process.env.MEDIA_SUPABASE_SERVICE_ROLE_KEY||process.env.MEDIA_SUPABASE_SECRET_KEY||process.env.IGDC_MEDIA_SUPABASE_SERVICE_ROLE_KEY||process.env.IGDC_MEDIA_SUPABASE_SECRET_KEY||process.env.GSLOT_SUPABASE_SECRET_KEY||process.env.GSLOT_SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY);
 const t=txt(process.env.MEDIA_SNAPSHOT_RELEASE_TABLE||'media_snapshot_releases');
 const table=/^[a-zA-Z_][a-zA-Z0-9_]{0,80}$/.test(t)?t:'media_snapshot_releases';
 try{
   let rows;
   if(/^https:\/\/[^/]+$/i.test(url.replace(/\/+$/,''))&&key){
     // Media may use a separate Supabase project: audit THAT release ledger.
     // No media content is changed, and keys/URLs are never returned.
     const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
     try{
       const endpoint=url.replace(/\/+$/,'')+'/rest/v1/'+encodeURIComponent(table)+'?select=release_id,status,created_at,snapshot_hash&order=created_at.desc&limit=25';
       const response=await fetch(endpoint,{method:'GET',signal:controller.signal,headers:{apikey:key,authorization:'Bearer '+key,accept:'application/json'},cache:'no-store'});
       if(!response.ok)throw new Error('media_release_read_http_'+response.status);
       const data=await response.json();rows=arr(data);
     }finally{clearTimeout(timer);}
   }else rows=arr(await store.select(table,'select=release_id,status,created_at,snapshot_hash&order=created_at.desc&limit=25'));
   const statuses={};rows.forEach(x=>{const k=txt(x.status)||'unknown';statuses[k]=(statuses[k]||0)+1;});
   const latestApplied=rows.find(x=>txt(x.status)==='applied');
   return {checked:true,source:url&&key?'configured_MEDIA_SUPABASE':'GSLOT_SUPABASE_fallback',reviewedRows:rows.length,statuses,
     latestAppliedAt:latestApplied&&txt(latestApplied.created_at)||null,
     latest:rows.slice(0,6).map(row=>({releaseIdPresent:!!txt(row.release_id),status:txt(row.status),createdAt:txt(row.created_at)||null,snapshotHashPresent:!!txt(row.snapshot_hash)})),
     warning:latestApplied?'승인 기록은 존재합니다. 실제 프로덕션 Media Snapshot 반영 여부는 빌드 로그와 대조해야 합니다.':'최근 승인 적용 기록을 찾지 못했습니다. 공개 Snapshot은 변경하지 않았습니다.'};
 }catch(e){return{checked:false,error:reasonKo(e.message).code,detail:scrub(e.message),warning:'미디어 승인 저장소 접근/권한/연결 확인 필요. 기존 콘텐츠·Snapshot은 변경하지 않음'};}
}
function createRunner(deps){
 const store=deps&&deps.store||require('./global-slot-console-supabase'),automation=deps&&deps.automation||require('./commerce-country-automation.v1'),clock=deps&&deps.clock||(()=>new Date().toISOString());
 return async function run(options){
   const started=clock(),state=await automation.configState();
   if(!state.storageAvailable)throw Object.assign(new Error('자동화 설정 저장 공간을 읽지 못했습니다: '+scrub(state.storageError)),{statusCode:503});
   const master=obj(state.master),mode=txt(master.mode);
   const registry=obj(automation.registry()),registryCountries=arr(registry.countries).filter(x=>safeCode(obj(x).code));
   const countryByCode=new Map(registryCountries.map(x=>[safeCode(x.code),x]));
   const savedSelection=[...new Set(arr(master.selectedCountryCodes).map(safeCode).filter(Boolean))];
   const selection=mode==='selected'?savedSelection:[];
   const selectedSet=new Set(selection),knownSelection=selection.filter(code=>countryByCode.has(code));
   const focusCountry=safeCode(obj(options).focusCountry),focusRegion=safeRegion(obj(options).focusRegion);
   const focusAllowed=!!focusCountry&&countryByCode.has(focusCountry);
   const now=clock();
   const result={ok:true,reportType:'igdc-auto-bottleneck-readonly',version:VERSION,generatedAt:started,
     serverBuild:{commit:txt(process.env.COMMIT_REF).slice(0,40)||null,context:txt(process.env.CONTEXT)||null},
     scope:{mode,selectedCountryCount:selection.length,selectedCountryCodes:selection,knownSelectedCount:knownSelection.length,
       coverage:'full_country_registry',registeredCountryCount:registryCountries.length,automationFunctionAvailableCountryCount:registryCountries.filter(x=>x.enabled!==false&&safeCode(x.code)!=='KP').length,
       savedCountryChoicesPreservedOutsideSelectedMode:mode!=='selected'?savedSelection:[],
       focusCountry:focusAllowed?focusCountry:null,focusIsSelected:focusAllowed?selectedSet.has(focusCountry):null,focusRegion,
       note:'등록부에 있는 249개 국가·지역을 동일한 AI 조사 기능으로 점검합니다. 선택 국가 자동화는 선택 범위만 가동하고, IP 식별 가능 여부는 관리자 자동 조사 제외 조건이 아닙니다.'},
     sources:{settings:'gslot_policies master settings',staged:'gslot_policies (supplier/product staged, paginated)',jobDetail:'large historic research payloads deliberately excluded',schedulerExecution:'actual Netlify scheduler logs required'},
     summary:{registeredCountries:registryCountries.length,prioritySelected:selection.length,checkedCountries:0,
       scheduledActiveCountries:0,notSelectedCountries:0,notSchedulableCountries:0,
       supplierCheckpoints:0,productCheckpoints:0,selectedWithDurableSupplierMarker:0,
       productStepFailures:0,supplierStepFailures:0,productWithErrorHistory:0,supplierWithErrorHistory:0,adminPauses:0},
     countries:[],blockers:[],readErrors:[],
     safety:{readOnly:true,frontPublication:false,settingsModified:false,candidateLedgerModified:false,
       manualPinnedPreserved:true,adminCountrySelectionIndependentOfIp:true,noMassHistoricalPayloadRead:true,
       searchBreadthUnchanged:true,noUnselectedCountryAutoActivation:true,krManualLedgerPreserved:true,
       searchAmplification:'only verified published front snapshot after explicit administrator release'}};
   const unknown=selection.filter(code=>!countryByCode.has(code));
   if(unknown.length){result.ok=false;result.readErrors.push({part:'registrySelectionMismatch',message:'선택 목록에 현재 등록부에 없는 국가가 있습니다.',countryCodes:unknown});}
   const countrySettings=new Map(arr(state.settings).filter(x=>txt(x.scopeType)==='country').map(x=>[safeCode(x.countryCode),x]));
   const stagedMap=new Map();let stagedComplete=true,loaded=0;
   try{
     for(let page=0;page<MAX_STAGED_PAGES;page++){
       const rows=arr(await store.select('gslot_policies','select=id,scope_hub,scope_country,scope_region,rule,updated_at&scope_hub=in.('+SUPPLIER_HUB+','+PRODUCT_HUB+')&order=id.asc&limit='+STAGED_PAGE_SIZE+'&offset='+(page*STAGED_PAGE_SIZE)));
       loaded+=rows.length;
       for(const row of rows){
         const item=inspectRow(row,now);if(!item.country||!countryByCode.has(item.country))continue;
         const id=item.country+'|'+item.region+'|'+item.kind,prev=stagedMap.get(id);
         if(!prev||time(item.lastStepAt)>=time(prev.lastStepAt))stagedMap.set(id,item);
       }
       if(rows.length<STAGED_PAGE_SIZE)break;
       if(page===MAX_STAGED_PAGES-1){stagedComplete=false;result.readErrors.push({part:'stagedCheckpoints',message:'진행 기록 조회가 페이지 상한에 도달했습니다. 모든 진행 기록을 읽었다고 단정할 수 없습니다.',loaded});}
     }
   }catch(error){stagedComplete=false;result.readErrors.push({part:'stagedCheckpoints',message:scrub(error.message),classification:reasonKo(error.message),loaded});}
   result.sources.stagedRowsRead=loaded;result.sources.stagedScanComplete=stagedComplete;
   if(!stagedComplete)result.ok=false;
   for(const row of registryCountries){
     const code=safeCode(row.code),registeredSelected=selectedSet.has(code);
     const countrySetting=obj(countrySettings.get(code)),explicitCountryMode=txt(countrySetting.mode);
     const effective=typeof automation.effectiveSetting==='function'?obj(automation.effectiveSetting(state,code,'')):{};
     const selectable=row.enabled!==false&&code!=='KP';
     // In selected mode, only whitelisted markets run. The KR country override
     // alone does NOT enable schedules; do not conflate it with selection.
     const scheduled=selectable&&(mode==='selected'?registeredSelected&&effective.mode==='auto':
       mode==='auto'?effective.mode==='auto':mode==='manual'?safeCode(master.selectedCountryCode)===code&&effective.mode==='auto':false);
     let schedulingReason=scheduled?'active_selected_or_global':!selectable?'registry_disabled_or_policy_unavailable':
       mode==='selected'&&!registeredSelected?'not_selected':mode==='off'?'global_paused':
       effective.mode!=='auto'?'effective_country_setting_not_auto':'different_manual_scope';
     const supplier=stagedMap.get(code+'|NATIONWIDE|supplier')||null;
     const product=stagedMap.get(code+'|NATIONWIDE|product')||null;
     const durableAt=txt(countrySetting.lastDurableSupplierAt)||null;
     const issues=[];
     if(scheduled&&stagedComplete)classifyMarket(code,supplier,product,durableAt,now,issues);
     if(code==='KR'&&mode==='selected'&&!registeredSelected){
       addProblem(issues,'kr_ai_not_scheduled','warning','한국의 AI 자동 조사가 선택 국가 예약에서 빠져 있음',
         {country:'KR',region:'NATIONWIDE'},'한국 개별 설정이 auto여도 선택국가 마스터에 KR이 없으면 예약 자동 실행되지 않습니다.',
         '관리자 전용 「한국 AI 자동 조사 포함」 버튼으로 KR만 현재 선택 목록에 추가. 기존 고정·배정 보호');
     }
     if(scheduled&&effective.mode==='auto'&&(supplier&&(supplier.phase==='manual_preserved'||supplier.phase==='manual_job_preserved')||product&&(product.phase==='manual_preserved'||product.phase==='manual_job_preserved'))){
       addProblem(issues,'manual_auto_handover','warning','예약 자동 조사와 관리자 작업 인계 상태 확인 필요',{country:code,region:'NATIONWIDE'},
         '수동 작업의 보호 상태 때문에 자동 리서치 재개가 늦어질 수 있습니다.',
         '자동화 수동 인계·일시정지 여부를 관리자에서 확인; 고정 상품이나 승인 기록은 변경 금지');
     }
     result.countries.push({country:code,countryNameKo:txt(row.nameKo),regionGroup:txt(row.regionGroup),registered:true,
       registeredSelected,savedInLastSelectedList:savedSelection.includes(code),scheduled,autoRunExpected:scheduled,schedulingReason,registryEnabled:row.enabled!==false,adminResearchIndependentOfVisitorIp:true,
       ipResolvable:row.ipResolvable===true,requiresSubdivision:row.requiresSubdivision===true,
       effectiveCountryMode:txt(effective.mode),countryOverrideMode:explicitCountryMode||null,
       manualControlPreserved:true,readStatus:stagedComplete?'complete':'partial',
       durableSupplierMarkerAt:durableAt,lastSupplierAttemptAt:txt(countrySetting.lastAttemptAt)||null,
       lastSupplierCycleAt:txt(countrySetting.lastRunAt)||null,
       supplier,product,relatedStagedScopes:[...stagedMap.keys()].filter(k=>k.startsWith(code+'|')&& !k.includes('|NATIONWIDE|')).length,
       problems:issues});
     result.blockers.push(...issues);
   }
   result.summary.checkedCountries=result.countries.length;
   result.summary.scheduledActiveCountries=result.countries.filter(x=>x.scheduled).length;
   result.summary.notSelectedCountries=result.countries.filter(x=>x.schedulingReason==='not_selected').length;
   result.summary.notSchedulableCountries=result.countries.filter(x=>x.schedulingReason==='registry_disabled_or_policy_unavailable').length;
   const active=result.countries.filter(x=>x.scheduled);
   result.summary.supplierCheckpoints=active.filter(x=>x.supplier).length;
   result.summary.productCheckpoints=active.filter(x=>x.product).length;
   result.summary.selectedWithDurableSupplierMarker=active.filter(x=>x.durableSupplierMarkerAt).length;
   result.summary.productStepFailures=active.filter(x=>x.product&&x.product.lastResult==='step_failed_checkpoint_preserved').length;
   result.summary.supplierStepFailures=active.filter(x=>x.supplier&&x.supplier.lastResult==='supplier_step_failed_checkpoint_preserved').length;
   result.summary.productWithErrorHistory=active.filter(x=>x.product&&x.product.errorCount>0).length;
   result.summary.supplierWithErrorHistory=active.filter(x=>x.supplier&&x.supplier.errorCount>0).length;
   const latestErrorCodes=active.flatMap(x=>[x.product,x.supplier].filter(Boolean).flatMap(s=>s.lastErrors.slice(-1)).map(e=>e.classification.code));
   result.summary.latestErrorCategoryCount=Object.fromEntries([...new Set(latestErrorCodes)].map(code=>[code,latestErrorCodes.filter(x=>x===code).length]));
   result.summary.adminPauses=active.filter(x=>x.supplier&&x.supplier.operatorAutoPause||x.product&&x.product.operatorAutoPause).length;
   result.summary.issueCount=result.blockers.length;
   result.summary.issueByCode=Object.fromEntries([...new Set(result.blockers.map(x=>x.code))].map(code=>[code,result.blockers.filter(x=>x.code===code).length]));
   result.korea={registered:countryByCode.has('KR'),selected:selectedSet.has('KR'),autoScheduled:!!result.countries.find(x=>x.country==='KR'&&x.scheduled),
     existingManualDataProtected:true,manualCountrySetting:txt(obj(countrySettings.get('KR')).mode)||null,
     actionRequired:mode==='selected'&&!selectedSet.has('KR')?'include_kr_in_selected_reservation':null};
   if(focusAllowed)result.focus=await queryFocus(store,focusCountry,focusRegion);
   result.mediaReleaseProbe=await queryMediaRelease(store);
   result.finishedAt=clock();
   result.instructionsKo=[
     '등록부 249개 전체의 공통 기능을 점검합니다. 선택 모드는 지정된 국가만 실행하며 전 세계 모드는 명시적 운영 중지를 제외한 전체 국가를 실행합니다. 미선택 국가의 미실행을 장애로 계산하지 않습니다.',
     '한국 KR은 선택 예약 목록에 실제 포함된 경우에만 실행됩니다. 개별 국가 auto 설정만으로 실행되지 않습니다.',
     '검증된 비공개 상품은 별도 관리자 승인·공개 Snapshot 이후에만 검색 증폭 엔진으로 전달해야 합니다.',
     '상품·업체 검색 결과는 원장 저장·PSOM 배치와 별도 수치입니다. 불일치는 단계별로 원인을 확인합니다.',
     '실제 Netlify 예약 함수 작동은 Scheduled 배지 및 실행 로그를 확인해야 합니다.',
     '이 진단은 설정·프론트·미디어 Snapshot·상품 고정을 변경하지 않습니다.'
   ];
   return result;
 };
}
module.exports={VERSION,createRunner,run:(options)=>createRunner()(options),reasonKo,scrub,inspectRow};
