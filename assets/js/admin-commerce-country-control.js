/* IGDC Global/Region/Country Commerce Control v3.23.1-admin-section-revenue-priority-order
 * Region -> country -> large-country subdivision controller.
 * Shared administrator session only. AI automation writes only to the private
 * candidate queue. Explicit administrator front matching is routed through the
 * existing go-live audit/build gate; no checkout or payment action exists.
 */
(function(){
  'use strict';
  var REVIEW='/.netlify/functions/commerce-candidate-review';
  var MANAGEMENT_LEDGER='/.netlify/functions/commerce-candidate-management-ledger';
  var CONTROL='/.netlify/functions/commerce-country-control';
  var HOLD_ORIGINAL_LINK='/.netlify/functions/commerce-hold-original-link-inspect';
  var QUEUE_CONTROL='/.netlify/functions/commerce-candidate-queue-control';
  var ADMIN_AUTHORITY='/.netlify/functions/commerce-candidate-admin-authority';
  var SECTION_REVENUE_RANK='/.netlify/functions/commerce-candidate-section-revenue-rank';
  var sectionRevenueView={},sectionRevenueBusy=false,sectionRevenueViewScope='';
  var RUNTIME_DIAGNOSTIC='/.netlify/functions/igdc-runtime-diagnostic';
  var GEO='/api/igdc-country-geo';
  var $=function(id){return document.getElementById(id);};
  var text=function(v){return String(v==null?'':v).trim();};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var stateEl=$('state'),notice=$('notice');
  var acceptedToken='',acceptedSession=null,resolvingSession=null,wired=false;
  var catalog=null,locations=null,geo=null,regions=[],countries=[],settings=[],settingMap={};
  var verifiedReviewUi={hold:{},latest:{}};
  var verifiedReviewDetailsUi={hold:{},latest:{}};
  var unresolvedReviewDetailsUi={hold:{},latest:{}};
  var incompleteReviewUi={};
  var reviewClassSelections={verified:{},incomplete:{}};
  var reviewInventoryBusy=false,reviewInventoryKey="";
  var selectedRegion='',selectedCountry='',selectedSubdivision='NATIONWIDE',regionOnly=true,lastJson=null,lastGlobalJson=null,lastRegionalJson=null,lastCountryJson=null,lastDiagnosticJson=null,lastGlobalControlJson=null,lastProductJson=null,lastProductTransitionAuditJson=null,lastRuntimeDiagnostic=null,lastScopeCache=null,lastScopeAuditJson=null,activeScopeAudit='',selectionSource='initial',lastSignalReport=null,lastCountryPreview=null,researchStopRequested=false,researchLoopActive=false,productStopRequested=false,productLoopActive=false,productPausedForQueue=false,productQueueStageActive=false,productPauseAutoQueue=false,productPausePersistPromise=null,productPauseServerConfirmed=false,signalLoopActive=false,returnRestoreActive=false,returnRestoreRow=null,returnRestoreTimer=null,lastPassiveRestoreAt=0,supplierControlScopeKey='',queueControlScopeKey='',queueCandidateRows=[],queueFocusedCandidateIds=[],queuePage=0,supplierActiveRows=[],supplierHoldingRows=[],supplierBlockedRows=[],productRows=[],latestProductRows=[],latestProductPage=0,latestSelectedProducts={},latestProductRowsComplete=true,latestOverviewLedgerComplete=false,latestOverviewCanonicalById={},latestOverviewFilter="all",latestOverviewSearch="",latestOverviewPage=0,latestOverviewBusy=false,latestOverviewChosenCandidates={},latestOverviewSelected={},latestOverviewPageItems=[],latestOverviewFilteredItems=[],productExclusionSelections={hold:{},reject:{}},latestQueueActionActive=false,latestRefreshActive=false,productPlacementSelections={},candidateSelectedProducts={},candidateGroupPages={},frontSelectedSections={},frontSelectedProducts={},frontSnapshotCounts={},frontSnapshotSource={},frontSnapshotItems={},frontSnapshotMeta={},frontSnapshotLoadedAt=0,frontRestoreAttempted={},candidateBulkActionActive={},productExclusionActionActive=false,supplierActionActive=false,productSectionCleanupActive=false,productRenderEpoch=0,heavyPanelWired=false,productAutomationActive=false,productFrontSyncActive=false,affiliateSettlementProductId="",sessionResumeActive=false,sessionUiResume=null,sessionDataResumeAvailable=false;
  var PRODUCT_PAUSE_AUTO_QUEUE_KEY='igdc_product_pause_auto_queue_v1';
  var MANAGEMENT_PAGE_SIZE=100;
  var LATEST_OVERVIEW_PAGE_SIZE=100; // Latest research overview only; does not change research or server batch sizes.

  var LATEST_MANUAL_ACTION_BATCH=10;
  var PRODUCT_PRIVATE_SECTION_CAPACITY=200;
  var PRODUCT_FRONT_SECTION_CAPACITY=100;
  var FRONT_MATCH_CLIENT_VERSION='20261013-admin-runtime-status-unique-count-v15';

  var PRODUCT_SECTIONS=Object.freeze([
    {key:'home|home_1',page:'home',section:'home_1',label:'홈 · home_1'},{key:'home|home_2',page:'home',section:'home_2',label:'홈 · home_2'},{key:'home|home_3',page:'home',section:'home_3',label:'홈 · home_3'},{key:'home|home_4',page:'home',section:'home_4',label:'홈 · home_4'},{key:'home|home_5',page:'home',section:'home_5',label:'홈 · home_5'},{key:'home|home_6',page:'home',section:'home_6',label:'홈 · Home 6 (웹툰·서적·전자책)'},{key:'home|home_right_top',page:'home',section:'home_right_top',label:'홈 · 우측 상단 (지식·건강·생활)'},{key:'home|home_right_middle',page:'home',section:'home_right_middle',label:'홈 · 우측 중단 (자동차·아웃도어)'},{key:'home|home_right_bottom',page:'home',section:'home_right_bottom',label:'홈 · 우측 하단 (리빙·책방·기타)'},
    {key:'distribution|distribution-recommend',page:'distribution',section:'distribution-recommend',label:'유통 · 오늘의 추천'},{key:'distribution|distribution-trending',page:'distribution',section:'distribution-trending',label:'유통 · 실시간 인기'},{key:'distribution|distribution-sponsor',page:'distribution',section:'distribution-sponsor',label:'유통 · 뷰티'},{key:'distribution|distribution-new',page:'distribution',section:'distribution-new',label:'유통 · 소형가전'},{key:'distribution|distribution-special',page:'distribution',section:'distribution-special',label:'유통 · 의류·패션'},{key:'distribution|distribution-others',page:'distribution',section:'distribution-others',label:'유통 · 생필품·생활'},{key:'distribution|distribution-extra',page:'distribution',section:'distribution-extra',label:'유통 · 기타·아웃도어·식품'},{key:'distribution|distribution-right',page:'distribution',section:'distribution-right',label:'유통 · 브랜드 추천'},
    {key:'network|network-right',page:'network',section:'network-right',label:'네트워크 · 우측'},{key:'social|rightPanel',page:'social',section:'rightPanel',label:'소셜 · 우측'},{key:'tour|tour',page:'tour',section:'tour',label:'투어 · 우측'}
  ]);
  var PRODUCT_SECTION_MAP=PRODUCT_SECTIONS.reduce(function(map,row){map[row.key]=row;return map;},{});
  var REVIEW_RETURN_KEY='igdc.country.control.review.return.v2';
  var REVIEW_SNAPSHOT_KEY='igdc.country.control.review.snapshot.v3';
  var REVIEW_DATA_CACHE_KEY='igdc.country.control.review.data.v1';
  var REVIEW_SNAPSHOT_LEGACY_KEY='igdc.country.control.review.snapshot.v2';
  var TOKEN_KEYS=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token'];

  function show(message,kind){if(kind==='fail'||kind==='warn')pipelineTraceNotice(message,kind);notice.className='notice '+(kind==='ok'?'ok':kind==='warn'?'warn':kind==='fail'?'fail':'');notice.textContent=message;notice.classList.remove('hidden');}
  function hide(){notice.classList.add('hidden');notice.textContent='';}
  function jwt(v){var t=text(v);return t.split('.').length===3&&t.length>32?t:'';}
  function parseJson(v){try{return JSON.parse(v);}catch(_e){return null;}}
  function pushToken(v,out,seen,depth){if(depth>4||v==null)return;if(typeof v==='string'){var t=jwt(v);if(t&&!seen[t]){seen[t]=1;out.push(t);return;}var p=parseJson(v);if(p)pushToken(p,out,seen,depth+1);return;}if(Array.isArray(v)){v.forEach(function(x){pushToken(x,out,seen,depth+1);});return;}if(typeof v==='object'){['id_token','idToken','access_token','accessToken','token','__raw','raw'].forEach(function(k){pushToken(v[k],out,seen,depth+1);});}}
  function sources(){var out=[],seen=[];function add(w){try{if(!w||seen.indexOf(w)>=0)return;void w.location.href;seen.push(w);out.push(w);}catch(_e){}}add(window);try{add(window.parent);}catch(_e){}try{add(window.top);}catch(_e){}return out;}
  async function tokenCandidates(){var out=[],seen={},tasks=[];sources().forEach(function(w){function add(fn){tasks.push(Promise.resolve().then(fn).then(function(v){pushToken(v,out,seen,0);}).catch(function(){}));}add(function(){return w.IGDCMemberAuth&&w.IGDCMemberAuth.getIdToken?w.IGDCMemberAuth.getIdToken():'';});add(function(){return w.osAuth&&w.osAuth.getIdToken?w.osAuth.getIdToken():'';});add(function(){return w.osAuth&&w.osAuth.getIdTokenClaims?w.osAuth.getIdTokenClaims():'';});[w.localStorage,w.sessionStorage].forEach(function(store){if(!store)return;TOKEN_KEYS.forEach(function(k){try{pushToken(store.getItem(k),out,seen,0);}catch(_e){}});});});await Promise.all(tasks);return out;}
  function conciseRequestError(message,status){var raw=text(message),code=Number(status||0);if(!raw)raw=code?'HTTP '+code:'서버 응답이 중단되었습니다.';if(raw.length>700||/<(?:!doctype|html|head|body|script|style)\b/i.test(raw)||/cloudflare|web server is down|error code 52[01]|gateway time-?out/i.test(raw))return(code?'HTTP '+code+' · ':'')+'서버 또는 상위 게이트웨이 응답이 지연·중단되었습니다. 이미 저장된 원장은 유지됩니다.';return raw;}
  function transientResearchRequestError(error){var status=Number(error&&error.status||0),code=text(error&&error.code).toLowerCase(),message=text(error&&error.message).toLowerCase();return status===0||[408,425,429,500,502,503,504,520,521,522,523,524].indexOf(status)>=0||/timeout|time.?out|gateway|temporar|connection|network|fetch/.test(code+' '+message);}
  function productProgressMark(data){var progress=data&&data.progress||{};return[text(data&&data.status),Number(progress.discovery&&progress.discovery.done||0),Number(progress.inspection&&progress.inspection.done||0),Number(progress.privateQueue&&progress.privateQueue.done||0),Number(data&&data.summary&&data.summary.latestResearchProducts||0)].join('|');}

  async function rawRequest(endpoint,action,method,params,body,token,timeoutMs){
    var u=new URL(endpoint,location.origin);u.searchParams.set('action',action);Object.keys(params||{}).forEach(function(k){if(params[k]!=null&&params[k]!=='')u.searchParams.set(k,params[k]);});
    var init={method:method||'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+token}},controller=null,timer=null;
    if(init.method!=='GET'){init.headers['Content-Type']='application/json';init.body=JSON.stringify(Object.assign({action:action},body||{}));}
    if(Number(timeoutMs)>0&&typeof AbortController!=='undefined'){controller=new AbortController();init.signal=controller.signal;timer=setTimeout(function(){try{controller.abort();}catch(_e){}},Number(timeoutMs));}
    try{
      var res=await fetch(u.pathname+u.search,init),data=null;try{data=await res.json();}catch(_e){}
      if(!res.ok||!data||data.ok!==true){var er=new Error(conciseRequestError(data&&data.error||('HTTP '+res.status),res.status));er.status=res.status;er.code=data&&data.code;er.payload=data||null;throw er;}return data;
    }catch(error){
      if(error&&error.name==='AbortError'){var timeoutError=new Error('요청 응답 시간이 초과되었습니다. 이미 저장된 원장은 유지됩니다.');timeoutError.status=504;timeoutError.code='request_timeout';throw timeoutError;}
      if(error&&error.message)error.message=conciseRequestError(error.message,error.status);throw error;
    }finally{if(timer)clearTimeout(timer);}
  }
  async function ensureSession(force){if(!force&&acceptedToken)return acceptedSession;if(resolvingSession)return resolvingSession;resolvingSession=(async function(){stateEl.textContent='관리자 공통 세션을 확인하는 중입니다.';var list=await tokenCandidates();for(var i=0;i<list.length;i++){try{var d=await rawRequest(CONTROL,'session','GET',{},null,list[i]);acceptedToken=list[i];acceptedSession=d;stateEl.textContent='관리자 세션 확인 · '+((d.session&&d.session.roles)||[]).join(', ');return d;}catch(_e){}}acceptedToken='';acceptedSession=null;throw new Error('관리자 페이지의 공통 세션을 확인하지 못했습니다.');})();try{return await resolvingSession;}finally{resolvingSession=null;}}
  // IGDC 249-market transfer/hold/delete diagnostic trail (read-only telemetry).
  // Never stores credentials, Authorization headers, raw API payloads or URLs.
  var pipelineTraceStorageKey='IGDC_PIPELINE_DIAGNOSTIC_V1',pipelineTraceEvents=[];
  try{var pipelineTraceSaved=JSON.parse(sessionStorage.getItem(pipelineTraceStorageKey)||'[]');if(Array.isArray(pipelineTraceSaved))pipelineTraceEvents=pipelineTraceSaved.slice(-180);}catch(_traceStorageError){}
  function pipelineTraceSafe(value){
    return String(value==null?'':value).slice(0,900)
      .replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{8,}\b/g,'[JWT_REDACTED]')
      .replace(/https?:\/\/[^\s"']+/gi,'[URL_REDACTED]')
      .replace(/((?:token|secret|password|apikey|authorization|signature|access_key)\s*[=:]\s*)[^\s&,;]+/gi,'$1[REDACTED]');
  }
  function pipelineTraceProductUrl(value){
    try{var u=new URL(String(value||''));if(!/^https?:$/.test(u.protocol))return'';
      var allowed=new URLSearchParams();['id','pid','sku','item','itemId','productId','product_id','item_id'].forEach(function(k){if(u.searchParams.has(k))allowed.set(k,u.searchParams.get(k).slice(0,90));});
      return (u.origin+u.pathname+(allowed.toString()?'?'+allowed.toString():'')).slice(0,420);
    }catch(_e){return'';}
  }
  function pipelineTraceIdentifiers(value){return(Array.isArray(value)?value:[]).slice(0,100).map(function(v){return pipelineTraceSafe(v).slice(0,180);}).filter(Boolean);}
  function pipelineTraceScope(body,params){
    body=body&&typeof body==='object'?body:{};params=params&&typeof params==='object'?params:{};
    return{countryCode:pipelineTraceSafe(body.countryCode||body.country||params.countryCode||params.country||selectedCountry||'').toUpperCase(),subdivisionCode:pipelineTraceSafe(body.subdivisionCode||body.region||params.subdivisionCode||params.region||selectedSubdivision||'NATIONWIDE').toUpperCase()};
  }
  function pipelineTraceSave(event){
    event=event||{};event.time=new Date().toISOString();
    pipelineTraceEvents.push(event);pipelineTraceEvents=pipelineTraceEvents.slice(-180);
    try{sessionStorage.setItem(pipelineTraceStorageKey,JSON.stringify(pipelineTraceEvents));}catch(_storageFull){}
    pipelineTraceRender();
  }
  function pipelineTracePartial(data){
    if(!data||typeof data!=='object')return{};
    var result=data.candidateAction||data.partialQueue||data.queueControl||data.aiRecovery||data||{},out={};
    ['requested','handled','processed','registered','restored','failed','blocked','skipped','moved','deleted','held','placed','verified','eligible','protectedPreserved'].forEach(function(k){if(typeof result[k]==='number')out[k]=result[k];});
    if(Array.isArray(result.processedIds))out.processedIds=pipelineTraceIdentifiers(result.processedIds);
    var failures=Array.isArray(result.failures)?result.failures:(Array.isArray(data.failures)?data.failures:[]);
    if(failures.length)out.failures=failures.slice(0,80).map(function(v){return{candidateId:pipelineTraceSafe(v&&v.id||v&&v.candidateId||'').slice(0,160),code:pipelineTraceSafe(v&&v.code||'').slice(0,160),error:pipelineTraceSafe(v&&v.error||v&&v.reason||v&&v.message||v).slice(0,700)};});
    if(Array.isArray(result.results))out.results=result.results.slice(0,80).map(function(v){return{candidateId:pipelineTraceSafe(v&&v.id||v&&v.candidateId||'').slice(0,160),status:pipelineTraceSafe(v&&v.status||''),error:pipelineTraceSafe(v&&v.error||''),warning:pipelineTraceSafe(v&&v.warning||'')};});
    if(result.error)out.error=pipelineTraceSafe(result.error);
    if(result.code)out.code=pipelineTraceSafe(result.code);
    return out;
  }
  function pipelineTraceShouldWatch(action,method){
    return String(method||'GET').toUpperCase()!=='GET'||/candidate|research|queue|supplier|product|front|diagnos/i.test(String(action||''));
  }
  async function pipelineTracedRequest(endpoint,action,method,params,body,token,timeoutMs){
    var started=Date.now(),watch=pipelineTraceShouldWatch(action,method),market=pipelineTraceScope(body,params),request={
      endpoint:String(endpoint||'').split('?')[0],action:String(action||''),method:String(method||'GET').toUpperCase(),scope:market,
      candidateIds:pipelineTraceIdentifiers(body&&body.candidateIds),productIds:pipelineTraceIdentifiers(body&&body.productIds),
      requestUrls:Array.isArray(body&&body.urls)?body.urls.slice(0,25).map(pipelineTraceProductUrl).filter(Boolean):[],
      requestCount:Array.isArray(body&&body.urls)?body.urls.length:Array.isArray(body&&body.candidateIds)?body.candidateIds.length:Array.isArray(body&&body.productIds)?body.productIds.length:0,
      decision:pipelineTraceSafe(body&&body.decision||body&&body.operation||'').slice(0,120)
    };
    try{
      var result=await rawRequest(endpoint,action,method,params,body,token,timeoutMs);
      if(watch&&request.method!=='GET'){
        var partial=pipelineTracePartial(result),partialFailed=Number(partial.failed||0)>0||!!(partial.failures&&partial.failures.length)||!!(partial.results&&partial.results.some(function(x){return x.error;}));
        pipelineTraceSave({type:partialFailed?'server_partial_failure':'server_response',success:!partialFailed,durationMs:Date.now()-started,request:request,message:partialFailed?pipelineTraceSafe(partial.failures&&partial.failures[0]&&partial.failures[0].error||'서버 성공 응답 안에 처리 실패 내역 존재'):'',result:partial});
      }
      return result;
    }catch(error){
      if(watch)pipelineTraceSave({type:'server_error',success:false,durationMs:Date.now()-started,request:request,httpStatus:Number(error&&error.status)||null,code:pipelineTraceSafe(error&&error.code||''),message:pipelineTraceSafe(error&&error.message||''),result:pipelineTracePartial(error&&error.payload)});
      throw error;
    }
  }
  function pipelineTraceNotice(message,level){
    var value=pipelineTraceSafe(message).slice(0,700);
    if(!value||!/(이관|삭제|차단|제외|보류|배치|원장|후보|검증|Supabase|실패|오류|scope|등록)/i.test(value))return;
    pipelineTraceSave({type:'ui_notice',success:false,level:level||'warn',scope:pipelineTraceScope(),message:value});
  }
  function pipelineTraceSelectedResearch(){
    try{return latestOverviewSelectedItems().slice(0,400).map(function(x){return{researchId:pipelineTraceSafe(x.id).slice(0,180),candidateId:pipelineTraceSafe(x.candidateId||'').slice(0,180),kind:pipelineTraceSafe(x.kind),productUrl:pipelineTraceProductUrl(x.research&& (x.research.productUrl||x.research.url)),duplicateCount:Number(x.duplicateCount||0),protected:!!x.protected,section:pipelineTraceSafe(x.section||'').slice(0,150),candidateStatus:pipelineTraceSafe(x.candidate&&x.candidate.status||'').slice(0,100)};});}catch(e){return[];}
  }
  function pipelineTraceSnapshot(source){
    var counts={},research=[],sourceRows=[];
    try{sourceRows=latestOverviewRows();sourceRows.forEach(function(row){counts[row.kind]=(counts[row.kind]||0)+1;});}catch(e){}
    var selected=pipelineTraceSelectedResearch(),excluded={};
    try{excluded={holdProducts:productExcludedRows('hold').length,excludedProducts:productExcludedRows('reject').length,supplierHolding:supplierHoldingRows.length,supplierBlocked:supplierBlockedRows.length,selectedHoldProducts:selectedProductExclusionIds('hold').length,selectedExcludedProducts:selectedProductExclusionIds('reject').length};}catch(e){}
    var currentMarket=String(selectedCountry||'').toUpperCase(),scopedEvents=pipelineTraceEvents.filter(function(e){var s=e.request&&e.request.scope||e.scope||{};return !currentMarket||!s.countryCode||String(s.countryCode).toUpperCase()===currentMarket;});
    var latestErrors=scopedEvents.filter(function(x){return x.success===false;}).slice(-35);
    var latestManagement=null;
    if(source==='latest_research'){
      try{
        var fresh=latestInCandidateFresh(),registered=latestResearchCanonicalCandidateRows(),pageSize=MANAGEMENT_PAGE_SIZE;
        latestManagement={schema:'igdc-latest-research-candidate-management-diagnostics.v1',
          countryCode:selectedCountry||null,subdivisionCode:selectedSubdivision||'NATIONWIDE',
          researchComplete:!!latestProductRowsComplete,candidateLedgerComplete:!!latestOverviewLedgerComplete,
          unregistered:fresh.length,registeredPending:registered.length,currentPage:(candidateGroupPages['candidate:latest_research']||0)+1,pageSize:pageSize,
          selectedUnregistered:fresh.filter(function(x){var id=latestProductKey(x.research),s=latestInCandidateSelections[id];return !!(s&&s.scope===scopeKey());}).length,
          withImage:fresh.filter(function(x){return !!researchCardImage(x.research||{});}).length,
          missingImage:fresh.filter(function(x){return !researchCardImage(x.research||{});}).length,
          candidateIds:registered.map(frontCandidateLedgerId).filter(Boolean).slice(0,400),
          unregisteredSamples:fresh.slice(0,400).map(function(x){var r=x.research||{};return{id:latestProductKey(r),title:pipelineTraceSafe(r.productName||r.title).slice(0,150),productUrl:pipelineTraceProductUrl(r.productUrl||r.url),imageUrlPresent:!!researchCardImage(r),inspectionComplete:r.inspectionComplete===true,reviewStatus:pipelineTraceSafe(r.researchStatus||'').slice(0,80)};})};
      }catch(error){latestManagement={ok:false,error:pipelineTraceSafe(error&&error.message||error)};}
    }
    return{schema:'igdc-distribution-pipeline-diagnostics.v1',generatedAt:new Date().toISOString(),source:source||'manual',latestManagement:latestManagement,
      privacy:'Authorization/JWT, query-string URLs, tokens and raw API payloads are not included. Local download only.',
      scope:{countryCode:selectedCountry||null,subdivisionCode:selectedSubdivision||'NATIONWIDE',scopeAuthority:'administrator-selected',detectedIpNotUsed:true},
      dataReadiness:{latestProductRowsComplete:!!latestProductRowsComplete,latestOverviewLedgerComplete:!!latestOverviewLedgerComplete},
      summary:{researchRows:latestProductRows.length,trackedResearchRows:sourceRows.length,candidateProductRows:productRows.filter(function(x){return x&&x.ledgerSource==='candidate';}).length,currentResearchStates:counts,selectedResearchRows:selected.length,excluded:excluded},
      selectedResearch:selected,events:scopedEvents.slice(),recentErrors:latestErrors,
      diagnostics:{criticalErrors:latestErrors.filter(function(e){return /gslot_candidates_status_check|violates check constraint|assigned_or_published_candidate_protected|HTTP 5\d\d|request_timeout/i.test(JSON.stringify(e));}).length,
        handling:'An API ok response is not proof of durable writes; compare result.processedIds and the canonical ledger after refresh.',
        retryPolicy:'Avoid repeated writes for HTTP 429/5xx and published products; inspect per-item errors before retrying.'}};
  }
  function pipelineTraceRender(){
    var textArea=$('pipelineTraceState'),other=$('excludedPipelineTraceState');
    if(!textArea&&!other)return;
    var market=String(selectedCountry||'').toUpperCase(),scoped=pipelineTraceEvents.filter(function(x){var s=x.request&&x.request.scope||x.scope||{};return !market||!s.countryCode||String(s.countryCode).toUpperCase()===market;}),errors=scoped.filter(function(x){return x.success===false;});
    var recent=errors.slice(-1)[0],last=scoped.slice(-1)[0];
    var line='점검 기록 '+scoped.length+'건 · 오류/차단 '+errors.length+'건 · 국가 '+(selectedCountry||'미선택')+'/'+(selectedSubdivision||'NATIONWIDE')+' · '+(last?last.time:'요청 기록 없음');
    if(recent)line+=' · 최근 오류: '+pipelineTraceSafe(recent.message||recent.result&&recent.result.error||recent.code||recent.type).slice(0,200);
    if(textArea)textArea.textContent=line;
    if(other)other.textContent=line;
  }
  function pipelineTraceDownload(source){
    var report=pipelineTraceSnapshot(source),scope=report.scope,stamp=new Date().toISOString().replace(/[:.]/g,'-');
    var blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.download='IGDC_PIPELINE_DIAG_'+String(scope.countryCode||'NONE').replace(/[^A-Z0-9_-]/gi,'')+'_'+String(scope.subdivisionCode).replace(/[^A-Z0-9_-]/gi,'')+'_'+stamp+'.json';link.href=url;
    document.body.appendChild(link);link.click();setTimeout(function(){try{link.remove();URL.revokeObjectURL(url);}catch(_ignore){}},1200);
    var state=$('pipelineTraceDownloadState')||$('excludedManagementOperationStatus');if(state)state.textContent='진단 JSON 저장 완료 · 최근 요청 오류 '+report.recentErrors.length+'건 · 선택 상품 '+report.selectedResearch.length+'건 · 현재 '+(scope.countryCode||'미선택');
  }
  async function pipelineTraceReadOnlyRefresh(){
    if(!selectedCountry){pipelineTraceSave({type:'readiness',success:false,message:'관리 국가 미선택'});return;}
    var freeze=scopeKey(),market={country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'},started=Date.now();
    try{
      await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true,readOnlyLedgerRefresh:true});
      if(scopeKey()!==freeze)throw new Error('점검 중 국가 변경 감지');
      await refreshLatestResearchRows(market.country,market.region,{throwOnFailure:true});
      if(scopeKey()!==freeze)throw new Error('점검 중 국가 변경 감지');
      pipelineTraceSave({type:'read_only_refresh',success:true,durationMs:Date.now()-started,scope:pipelineTraceScope(market),message:'후보 및 리서치 원장 재조회 완료'});
    }catch(error){pipelineTraceSave({type:'read_only_refresh',success:false,durationMs:Date.now()-started,scope:pipelineTraceScope(market),message:pipelineTraceSafe(error&&error.message||error)});}
    pipelineTraceRender();
  }
  function pipelineTraceWire(){
    if(document.documentElement.getAttribute('data-pipeline-trace-wired')==='1')return;
    document.documentElement.setAttribute('data-pipeline-trace-wired','1');
    document.addEventListener('click',function(event){
      var target=event.target&&event.target.closest&&event.target.closest('[data-pipeline-diagnostic]');if(!target)return;
      event.preventDefault();var action=target.getAttribute('data-pipeline-diagnostic');
      if(action==='download-latest')pipelineTraceDownload('latest_research');
      else if(action==='download-excluded')pipelineTraceDownload('excluded_hold_suppliers_products');
      else if(action==='refresh')pipelineTraceReadOnlyRefresh();
      else if(action==='clear'){pipelineTraceEvents=[];try{sessionStorage.removeItem(pipelineTraceStorageKey);}catch(_e){}pipelineTraceRender();}
    });
    window.addEventListener('error',function(e){if(e&&e.error)pipelineTraceSave({type:'javascript_error',success:false,scope:pipelineTraceScope(),message:pipelineTraceSafe(e.error&&e.error.message||e.message)});});
    window.addEventListener('unhandledrejection',function(e){pipelineTraceSave({type:'unhandled_rejection',success:false,scope:pipelineTraceScope(),message:pipelineTraceSafe(e&&e.reason&&e.reason.message||e&&e.reason)});});
    pipelineTraceRender();
  }

  async function api(endpoint,action,method,params,body,timeoutMs){
    await ensureSession(false);
    var scopedParams=Object.assign({},params||{}),scopedBody=body&&typeof body==='object'?Object.assign({},body):body;
    // Once an administrator has selected a country/region, that explicit scope
    // is authoritative for commerce management. The request IP remains only an
    // initial convenience and must never silently replace the selected market.
    if(endpoint===CONTROL){
      var bodyObj=scopedBody&&typeof scopedBody==='object'?scopedBody:{},hasScope=!!(scopedParams.country||scopedParams.countryCode||bodyObj.country||bodyObj.countryCode);
      if(hasScope){
        scopedParams.scopeAuthority='administrator-selected';scopedParams.ignoreRequestGeo='true';
        if(scopedBody&&typeof scopedBody==='object'){scopedBody.scopeAuthority='administrator-selected';scopedBody.ignoreRequestGeo=true;}
      }
    }
    try{return await pipelineTracedRequest(endpoint,action,method||'GET',scopedParams,scopedBody||null,acceptedToken,timeoutMs);}
    catch(e){if(Number(e.status)===401){acceptedToken='';acceptedSession=null;await ensureSession(true);return pipelineTracedRequest(endpoint,action,method||'GET',scopedParams,scopedBody||null,acceptedToken,timeoutMs);}throw e;}
  }

  async function geoData(){
    try{var res=await fetch(GEO,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}}),data=await res.json();if(res.ok&&data&&data.ok===true)return data;}catch(_e){}
    try{return await api(CONTROL,'geo','GET',{});}catch(_e){return{ok:true,resolved:false,country:null,region:null,worldRegion:null,source:'unresolved'};}
  }
  async function staticRegistry(){
    try{
      var docs=await Promise.all([fetch('/data/country-region-registry.v1.json',{cache:'no-store'}),fetch('/data/country-subdivision-registry.v1.json',{cache:'no-store'})]);
      if(!docs[0].ok||!docs[1].ok)throw new Error('registry_http');
      var countryDoc=await docs[0].json(),subDoc=await docs[1].json(),subMap={};
      (subDoc.countries||[]).forEach(function(row){var code=text(row.countryCode).toUpperCase();if(code)subMap[code]=row.subdivisions||[];});
      return{regions:countryDoc.regions||[],countries:(countryDoc.countries||[]).filter(function(row){return text(row.code).toUpperCase()!=='KP';}).map(function(row){var code=text(row.code).toUpperCase();return Object.assign({},row,{code:code,subdivisions:subMap[code]||[]});})};
    }catch(_e){return{regions:[],countries:[]};}
  }

  function settingId(type,opt){opt=opt||{};if(type==='master')return'igdc_country_automation_master';if(type==='region')return'igdc_country_automation_region_'+text(opt.regionGroup).toLowerCase().replace(/[^a-z0-9_-]/g,'');if(type==='country')return'igdc_country_automation_country_'+text(opt.countryCode).toLowerCase();return'igdc_country_automation_subdivision_'+text(opt.countryCode).toLowerCase()+'_'+text(opt.subdivisionCode).toLowerCase().replace(/[^a-z0-9_-]/g,'');}
  function mapSettings(){settingMap={};settings.forEach(function(s){settingMap[s.id]=s;});}
  function country(code){return countries.filter(function(c){return c.code===code;})[0]||null;}
  function region(id){return regions.filter(function(r){return r.id===id;})[0]||null;}
  function statusCountry(code){return locations&&locations.countries&&locations.countries.filter(function(c){return c.code===code;})[0]||{};}
  function setting(type,opt){return settingMap[settingId(type,opt)]||null;}
  function effective(c,sub){
    var chain=[];if(sub&&sub!=='NATIONWIDE')chain.push(setting('subdivision',{countryCode:c,subdivisionCode:sub}));chain.push(setting('country',{countryCode:c}));var cr=country(c);if(cr)chain.push(setting('region',{regionGroup:cr.regionGroup}));chain.push(catalog&&catalog.master);chain=chain.filter(Boolean);var active=chain.filter(function(x){return x.mode&&x.mode!=='inherit';});var pick=active[0]||catalog&&catalog.master||{mode:'off'};return{mode:pick.mode||'off',sourceId:pick.id||'',intervalDays:(active.filter(function(x){return x.intervalDays;})[0]||catalog&&catalog.master||{}).intervalDays||3.5,maxCandidates:(active.filter(function(x){return x.maxCandidates;})[0]||catalog&&catalog.master||{}).maxCandidates||20,chain:chain};}
  function modeText(m){return({auto:'AI 자동',manual:'수동 우선',off:'OFF',inherit:'상속'})[m]||m||'상속';}
  function modeClass(m){return m==='auto'?'on':m==='manual'?'manual':m==='inherit'?'inherit':'off';}
  function trustRating10(score){var n=Math.max(0,Math.min(100,Number(score)||0));if(n>=95)return 10;if(n>=90)return 9;if(n>=82)return 8;if(n>=75)return 7;if(n>=65)return 6;if(n>=55)return 5;if(n>=45)return 4;if(n>=35)return 3;if(n>=20)return 2;return 1;}
  function scopeName(){var c=country(selectedCountry);var sub=selectedSubdivision==='NATIONWIDE'?'전국':selectedSubdivision;var row=c&&Array.isArray(c.subdivisions)?c.subdivisions.filter(function(x){return x.code===selectedSubdivision;})[0]:null;if(row)sub=(row.nameKo||row.nameEn)+' · '+row.code;return(c?(c.nameKo||c.nameEn)+' · '+c.code:'국가 미선택')+' / '+sub;}
  function scopeParams(){return{country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'};}
  function scopeKey(scope){scope=scope||scopeParams();return text(scope.country).toUpperCase()+'|'+(text(scope.region).toUpperCase()||'NATIONWIDE');}
  function scopeSnapshot(source){return{country:selectedCountry,region:selectedSubdivision||'NATIONWIDE',regionGroup:selectedRegion,source:source||selectionSource||'manual-selected',detectedGeo:{country:geo&&geo.country||null,region:geo&&geo.region||null,regionGroup:geo&&geo.worldRegion||null,resolved:!!(geo&&geo.resolved),excluded:!!(geo&&geo.excluded),source:geo&&geo.source||'unresolved'}};}
  function setDownloadEnabled(enabled){$('downloadCurrentJsonBtn').disabled=!enabled;}
  function setButtonEnabled(id,enabled){var el=$(id);if(el)el.disabled=!enabled;}
  function presentJson(data){if(!data)return;lastJson=data;$('jsonOutput').textContent=JSON.stringify(data,null,2);$('jsonPanel').classList.remove('hidden');setDownloadEnabled(true);}
  function keepJsonPanelVisible(message){var panel=$('jsonPanel'),output=$('jsonOutput');if(panel)panel.classList.remove('hidden');if(output&&message!==undefined)output.textContent=message||'';}
  function resetJsonPanelForScope(){lastJson=null;lastDiagnosticJson=null;setDownloadEnabled(false);setButtonEnabled('diagnosticDownloadBtn',false);keepJsonPanelVisible('현재 선택 범위의 통합 점검 JSON을 실행하면 이 영역에 요약이 표시되고 전체 원문 다운로드가 활성화됩니다.');}
  function presentLargeReportSummary(data){
    if(!data)return;lastJson=data;
    var queue=data.queue&&data.queue.summary||{},control=data.control&&data.control.summary||{},scope=data.scope||{},preview={
      ok:data.ok===true,reportType:data.reportType||'igdc-diagnostic',generatedAt:data.generatedAt||null,
      scope:{country:scope.country||null,region:scope.region||'NATIONWIDE'},
      summary:{considered:Number(queue.considered||control.considered||0),eligibleForRelease:Number(queue.eligibleForRelease||0),registrySyncReady:Number(queue.registrySyncReady||0),publicationRequested:Number(queue.publicationRequested||0),releasedToCanonical:Number(queue.releasedToCanonical||0)},
      download:'전체 원문은 통합 JSON 다운로드 버튼으로 내려받습니다.'
    };
    $('jsonOutput').textContent=JSON.stringify(preview,null,2);$('jsonPanel').classList.remove('hidden');setDownloadEnabled(true);
  }
  function rememberReport(kind,data){if(!data)return;if(kind==='global'){lastGlobalJson=data;setButtonEnabled('globalSignalDownloadBtn',true);}else if(kind==='regional'){lastRegionalJson=data;setButtonEnabled('regionalSignalDownloadBtn',true);}else if(kind==='country'){lastCountryJson=data;setButtonEnabled('countryRunDownloadBtn',true);}else if(kind==='diagnostic'){lastDiagnosticJson=data;presentLargeReportSummary(data);setButtonEnabled('diagnosticDownloadBtn',true);}else if(kind==='globalControl'){lastGlobalControlJson=data;presentLargeReportSummary(data);setButtonEnabled('globalControlDownloadBtn',true);}else if(kind==='product'){lastProductJson=data;setButtonEnabled('productResearchDownloadBtn',true);}if(kind==='global'||kind==='regional')setButtonEnabled('downloadSignalJsonBtn',true);}
  function downloadRemembered(kind){var data=kind==='global'?lastGlobalJson:kind==='regional'?lastRegionalJson:kind==='country'?lastCountryJson:kind==='diagnostic'?lastDiagnosticJson:kind==='globalControl'?lastGlobalControlJson:kind==='product'?lastProductJson:lastJson;if(!data){show('해당 범위에서 다운로드할 JSON이 없습니다. 먼저 점검 또는 실행을 완료해 주세요.','warn');return;}lastJson=data;setDownloadEnabled(true);download();}

  function invalidateJson(){verifiedReviewUi={hold:{},latest:{}};verifiedReviewDetailsUi={hold:{},latest:{}};unresolvedReviewDetailsUi={hold:{},latest:{}};incompleteReviewUi={};reviewClassSelections={verified:{},incomplete:{}};reviewInventoryKey="";reviewInventoryBusy=false;closeManagementPanels();closeSupplierControlQueue();supplierControlScopeKey='';closeQueuePanel();queueControlScopeKey='';queueCandidateRows=[];queueFocusedCandidateIds=[];queuePage=0;candidateGroupPages={};latestProductPage=0;supplierActiveRows=[];supplierHoldingRows=[];supplierBlockedRows=[];productRows=[];latestProductRows=[];latestSelectedProducts={};latestProductRowsComplete=true;latestOverviewLedgerComplete=false;latestOverviewCanonicalById={};latestOverviewFilter="all";latestOverviewSearch="";latestOverviewPage=0;latestOverviewBusy=false;latestOverviewChosenCandidates={};latestOverviewSelected={};latestOverviewPageItems=[];latestOverviewFilteredItems=[];productExclusionSelections={hold:{},reject:{}};latestInCandidateSelections={};latestInCandidatePage=0;latestQueueActionActive=false;latestRefreshActive=false;productPlacementSelections={};frontSelectedSections={};frontSelectedProducts={};researchStopRequested=true;productStopRequested=true;productPausedForQueue=false;productPauseServerConfirmed=false;lastCountryJson=null;lastCountryPreview=null;lastProductJson=null;lastProductTransitionAuditJson=null;lastScopeCache=null;lastScopeAuditJson=null;activeScopeAudit='';if($('productTransitionAuditDownloadBtn'))$('productTransitionAuditDownloadBtn').disabled=true;if($('scopeAuditPanel'))$('scopeAuditPanel').classList.add('hidden');setButtonEnabled('countryRunDownloadBtn',false);setButtonEnabled('runNowBtn',false);setButtonEnabled('productResearchDownloadBtn',false);resetJsonPanelForScope();if($('countryResearchProgress'))$('countryResearchProgress').textContent='선택 범위가 바뀌었습니다. 새 범위의 저장 작업 상태를 읽어 주세요.';if($('productResearchState'))$('productResearchState').textContent='선택 범위가 바뀌었습니다. 이 범위의 상품 리서치 상태를 다시 읽어 주세요.';}
  function savedScope(){
    var query=new URLSearchParams(location.search),stored={},queryCountry=text(query.get('country')).toUpperCase();
    try{stored=JSON.parse(sessionStorage.getItem('igdc_admin_country_scope_v1')||'{}')||{};}catch(_e){}
    return{country:text(queryCountry||stored.country).toUpperCase(),region:text(query.get('region')||stored.region||'NATIONWIDE').toUpperCase(),regionGroup:text(stored.regionGroup),source:queryCountry?'query-scope':(stored.country?'session-saved-scope':'')};
  }
  function validSubdivision(c,code){
    if(!c||!code||code==='NATIONWIDE')return'NATIONWIDE';
    var rows=Array.isArray(c.subdivisions)?c.subdivisions:[];
    return rows.some(function(row){return text(row.code).toUpperCase()===code;})?code:'NATIONWIDE';
  }
  function persistScope(){try{sessionStorage.setItem('igdc_admin_country_scope_v1',JSON.stringify({country:selectedCountry,region:selectedSubdivision||'NATIONWIDE',regionGroup:selectedRegion,updatedAt:new Date().toISOString(),source:'country-control-session'}));}catch(_e){}window.IGDC_ADMIN_COUNTRY_SCOPE={country:selectedCountry,region:selectedSubdivision||'NATIONWIDE',regionGroup:selectedRegion};}
  function scopedUrl(path){var u=new URL(path,location.origin);if(selectedCountry)u.searchParams.set('country',selectedCountry);u.searchParams.set('region',selectedSubdivision||'NATIONWIDE');u.searchParams.set('scopeSource','country-control');u.searchParams.set('returnPath',location.pathname+location.search+location.hash);return u.pathname+u.search;}

  function renderMaster(){var m=catalog.master||{mode:'off',intervalDays:3.5};$('masterMode').value=m.mode==='inherit'?'off':m.mode;$('masterInterval').value=String(m.intervalDays||3.5);$('masterState').textContent=m.mode==='auto'?'ON':m.mode==='manual'?'MANUAL':'OFF';$('masterState').className='switchstate '+modeClass(m.mode);}
  function renderOperatingStatus(){
    var st=catalog&&catalog.operatingStatus||{},profile=text(st.profile||'custom');
    var labels={global_auto:'전 세계 자동 운영',global_pause:'전체 자동 중지',custom:'개별 국가·권역 설정 운영'};
    var active=Number(st.autoCountryCount||0),total=Number(st.supportedCountryCount||countries.length||0),perRun=Number(st.scopesPerSchedulerRun||0);
    $('operationStatus').textContent='현재 운영: '+(labels[profile]||profile);
    $('operationStatus').className=profile==='global_auto'?'on':profile==='custom'?'manual':'off';
    $('operationDetail').textContent='자동 국가 '+active+'/'+total+' · 시간당 최대 '+perRun+'개 범위 순환 · 개별 예외 '+Number(st.childOverrides||0)+'개';
  }
  function renderRegions(){
    var html=regions.map(function(r){var s=setting('region',{regionGroup:r.id})||{mode:'inherit',intervalDays:catalog&&catalog.master&&catalog.master.intervalDays||3.5};var count=countries.filter(function(c){return c.regionGroup===r.id;}).length;return'<article class="region-card '+(selectedRegion===r.id?'active':'')+'" data-region="'+esc(r.id)+'"><div class="head"><div><div class="name">'+esc(r.nameKo||r.nameEn||r.id)+'</div><div class="meta">'+esc(count)+'개 국가 · '+esc(r.id)+'</div></div><span class="pill '+(s.mode==='auto'?'good':s.mode==='manual'?'manual':s.mode==='off'?'warn':'info')+'">'+esc(modeText(s.mode))+'</span></div><div class="region-settings"><select aria-label="권역 자동화 모드" data-region-mode="'+esc(r.id)+'"><option value="inherit" '+(s.mode==='inherit'?'selected':'')+'>상위 설정 상속</option><option value="auto" '+(s.mode==='auto'?'selected':'')+'>AI 자동</option><option value="manual" '+(s.mode==='manual'?'selected':'')+'>수동 우선</option><option value="off" '+(s.mode==='off'?'selected':'')+'>OFF</option></select><select aria-label="권역 점검 주기" data-region-interval="'+esc(r.id)+'"><option value="1" '+((s.intervalDays||3.5)===1?'selected':'')+'>1일</option><option value="2" '+(s.intervalDays===2?'selected':'')+'>2일</option><option value="3" '+(s.intervalDays===3?'selected':'')+'>3일</option><option value="3.5" '+(s.intervalDays===3.5?'selected':'')+'>주 2회 (84시간)</option><option value="7" '+(s.intervalDays===7?'selected':'')+'>7일</option><option value="14" '+(s.intervalDays===14?'selected':'')+'>14일</option><option value="30" '+(s.intervalDays===30?'selected':'')+'>30일</option></select></div></article>';}).join('');$('regionGrid').innerHTML=html;
    Array.prototype.forEach.call(document.querySelectorAll('.region-card'),function(card){card.addEventListener('click',function(e){if(e.target&&e.target.tagName==='SELECT')return;selectedRegion=card.getAttribute('data-region');regionOnly=true;var firstCountry=countries.filter(function(c){return c.regionGroup===selectedRegion;})[0];if(firstCountry)selectCountry(firstCountry.code,true,'manual-selected');else renderAll();});});
    Array.prototype.forEach.call(document.querySelectorAll('[data-region-mode]'),function(sel){sel.addEventListener('change',async function(){var id=sel.getAttribute('data-region-mode'),interval=document.querySelector('[data-region-interval="'+id+'"]');try{await saveSetting({scopeType:'region',regionGroup:id,mode:sel.value,intervalDays:Number(interval&&interval.value||3.5),maxCandidates:(setting('region',{regionGroup:id})||{}).maxCandidates||20});show('권역 자동화 설정을 저장했습니다.','ok');}catch(e){show(text(e.message),'fail');}});});Array.prototype.forEach.call(document.querySelectorAll('[data-region-interval]'),function(sel){sel.addEventListener('change',async function(){var id=sel.getAttribute('data-region-interval'),modeEl=document.querySelector('[data-region-mode="'+id+'"]');try{await saveSetting({scopeType:'region',regionGroup:id,mode:modeEl&&modeEl.value||'inherit',intervalDays:Number(sel.value||3.5),maxCandidates:(setting('region',{regionGroup:id})||{}).maxCandidates||20});show('권역 점검 주기를 저장했습니다.','ok');}catch(e){show(text(e.message),'fail');}});});
  }
  function countryStatusPill(c){var st=statusCountry(c.code),ef=effective(c.code,'NATIONWIDE');if(ef.mode==='auto')return'<span class="pill good">AI 자동</span>';if(ef.mode==='manual')return'<span class="pill manual">수동</span>';if(st.candidateCount)return'<span class="pill info">후보 '+esc(st.candidateCount)+'</span>';return'<span class="pill warn">0건</span>';}
  function renderCountries(){var q=text($('countrySearch').value).toLowerCase();var rows=countries.filter(function(c){return(!regionOnly||!selectedRegion||c.regionGroup===selectedRegion)&&(!q||c.code.toLowerCase().indexOf(q)>=0||text(c.nameKo).toLowerCase().indexOf(q)>=0||text(c.nameEn).toLowerCase().indexOf(q)>=0);});$('countryGrid').innerHTML=rows.length?rows.map(function(c){var st=statusCountry(c.code);return'<button type="button" class="country-card '+(c.code===selectedCountry?'active':'')+'" data-country="'+esc(c.code)+'"><strong><span>'+esc(c.nameKo||c.nameEn)+' · '+esc(c.code)+'</span>'+countryStatusPill(c)+'</strong><div class="meta">후보 '+esc(st.candidateCount||0)+' · 승인 전 통과 '+esc(st.releaseEligible||0)+' · 수동 고정 '+esc(st.manualPinnedCount||0)+'<br>'+(c.requiresSubdivision?'주·성·지역 '+esc((c.subdivisions||[]).length)+'개':'국가 단위 관리')+'</div></button>';}).join(''):'<div class="small">조건에 맞는 국가가 없습니다.</div>';Array.prototype.forEach.call(document.querySelectorAll('.country-card'),function(card){card.addEventListener('click',function(){selectCountry(card.getAttribute('data-country'),true,'manual-selected');});});}
  function renderSubdivisions(){var c=country(selectedCountry);if(!c||!c.requiresSubdivision){$('subdivisionPanel').classList.add('hidden');selectedSubdivision='NATIONWIDE';return;}$('subdivisionPanel').classList.remove('hidden');$('subdivisionTitle').textContent='3단계 · '+(c.nameKo||c.nameEn)+' 주·성·지역 선택';var rows=[{code:'NATIONWIDE',nameKo:'전국 범위'}].concat(c.subdivisions||[]);$('subdivisionGrid').innerHTML=rows.map(function(s){var ef=effective(c.code,s.code==='NATIONWIDE'?'':s.code);return'<button type="button" class="subdivision-card '+(selectedSubdivision===s.code?'active':'')+'" data-subdivision="'+esc(s.code)+'"><strong>'+esc(s.nameKo||s.nameEn||s.code)+'</strong><div class="meta">'+esc(s.code)+' · '+esc(modeText(ef.mode))+'</div></button>';}).join('');Array.prototype.forEach.call(document.querySelectorAll('.subdivision-card'),function(card){card.addEventListener('click',function(){var next=card.getAttribute('data-subdivision');if(next!==selectedSubdivision)invalidateJson();selectedSubdivision=next;selectionSource='manual-selected';persistScope();renderSubdivisions();renderScope();loadScope();});});}
  function renderScope(){
    var c=country(selectedCountry),ef=effective(selectedCountry,selectedSubdivision==='NATIONWIDE'?'':selectedSubdivision),specific=selectedSubdivision!=='NATIONWIDE'?setting('subdivision',{countryCode:selectedCountry,subdivisionCode:selectedSubdivision}):setting('country',{countryCode:selectedCountry}),masterMode=catalog&&catalog.master&&catalog.master.mode||'off',scheduleNote=(ef.mode==='auto'&&masterMode!=='auto')?' · 전 세계 예약 중지 상태이므로 정기 자동 실행은 멈춰 있고 수동 검색·실행만 가능합니다.':'';
    $('scopeTitle').textContent=scopeName();
    $('scopeMeta').innerHTML='실효 모드 <strong class="'+modeClass(ef.mode)+'">'+esc(modeText(ef.mode))+'</strong> · 기준 '+esc(ef.sourceId||'기본값')+' · 주기 '+esc(ef.intervalDays)+'일 · 1회 최대 '+esc(ef.maxCandidates)+'개'+esc(scheduleNote);
    $('scopeMode').value=specific&&specific.mode||'inherit';$('scopeInterval').value=String(specific&&specific.intervalDays||ef.intervalDays||3.5);$('maxCandidates').value=String(specific&&specific.maxCandidates||ef.maxCandidates||20);$('expandField').classList.toggle('hidden',!(c&&c.requiresSubdivision&&selectedSubdivision==='NATIONWIDE'));$('expandSubdivisions').value=String(!!(specific&&specific.expandSubdivisions));if($('supplierResearchDirective'))$('supplierResearchDirective').value=text(specific&&specific.researchDirective||ef.researchDirective||'');
    $('scopeLinks').innerHTML=[['queue','상품 후보·중개수익 대기열','비공개 후보 심사·수익·PSOM 승인'],['go_live','실상품 공급업체·상품 개방 점검','공개 직전 최종 감사·게재 요청']].map(function(x){return'<button type="button" class="linkbtn '+(activeScopeAudit===x[0]?'active':'')+'" data-scope-audit="'+esc(x[0])+'"><strong>'+esc(x[1])+'</strong><small>'+esc(x[2])+' · '+esc(scopeName())+'</small></button>';}).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-scope-audit]'),function(b){b.addEventListener('click',function(){openScopeAudit(b.getAttribute('data-scope-audit'),false);});});
    if($('supplierManualScopeLabel'))$('supplierManualScopeLabel').textContent='현재 선택 범위: '+scopeName();
  }
  function renderAll(){renderMaster();renderOperatingStatus();renderRegions();renderCountries();renderSubdivisions();renderScope();var r=region(selectedRegion);$('selectedRegionSignalName').textContent=r?((r.nameKo||r.nameEn||r.id)+' · '+r.id+' 권역의 수요·물류·규제·문화·행사 흐름을 점검합니다.'):'권역을 선택하면 해당 권역의 특별 이슈와 수요 변화를 점검합니다.';persistScope();}
  function selectCountry(code,load,source){var next=text(code).toUpperCase();if(next!==selectedCountry||selectedSubdivision!=='NATIONWIDE')invalidateJson();selectedCountry=next;selectionSource=source||'manual-selected';var c=country(selectedCountry);if(c)selectedRegion=c.regionGroup;selectedSubdivision='NATIONWIDE';persistScope();renderAll();if(load)loadScope();}

  async function saveSetting(input,timeoutMs){var d=await api(CONTROL,'setting_save','POST',{}, {setting:input},timeoutMs);settings=settings.filter(function(x){return x.id!==d.setting.id;});settings.push(d.setting);mapSettings();catalog.settings=settings;if(d.setting.scopeType==='master')catalog.master=d.setting;renderAll();return d.setting;}
  function stat(title,value,small){return'<article class="stat"><h3>'+esc(title)+'</h3><div class="num">'+esc(value)+'</div><div class="small">'+esc(small||'')+'</div></article>';}
  function auditScopeOf(data){var scope=data&&data.scope||data&&data.selectedScope||{};return{country:text(scope.country||selectedCountry).toUpperCase(),region:text(scope.region||selectedSubdivision||'NATIONWIDE').toUpperCase()||'NATIONWIDE',regionGroup:text(scope.regionGroup||selectedRegion)};}
  function auditList(values){var rows=Array.isArray(values)?values.filter(Boolean):[];return rows.length?'<ul>'+rows.map(function(v){return'<li>'+esc(v)+'</li>';}).join('')+'</ul>':'<div class="small">기록된 항목이 없습니다.</div>';}
  function setScopeAuditLoading(kind){activeScopeAudit=kind;$('scopeAuditPanel').classList.remove('hidden');$('scopeAuditTitle').textContent=kind==='go_live'?'실상품 공급업체·상품 개방 점검':'상품 후보·중개수익 대기열';$('scopeAuditScope').textContent=scopeName();if($('scopeAuditOpenBtn'))$('scopeAuditOpenBtn').textContent=kind==='go_live'?'전체 개방 점검 화면 열기':'전체 대기열 관리 화면 열기';$('scopeAuditStatus').textContent='현재 선택 범위의 저장 원장을 읽는 중입니다. 별도 페이지로 이동하거나 검색 작업을 다시 시작하지 않습니다.';$('scopeAuditGrid').innerHTML='';$('scopeAuditDetail').classList.add('hidden');$('scopeAuditRows').classList.add('hidden');setButtonEnabled('scopeAuditDownloadBtn',false);renderScope();}
  function renderScopeAudit(data,kind){
    kind=kind||activeScopeAudit||'queue';lastScopeAuditJson=data;activeScopeAudit=kind;var panel=$('scopeAuditPanel'),scope=auditScopeOf(data);panel.classList.remove('hidden');$('scopeAuditTitle').textContent=kind==='go_live'?'실상품 공급업체·상품 개방 점검':'상품 후보·중개수익 대기열';if($('scopeAuditOpenBtn'))$('scopeAuditOpenBtn').textContent=kind==='go_live'?'전체 개방 점검 화면 열기':'전체 대기열 관리 화면 열기';$('scopeAuditScope').textContent=(scope.country||selectedCountry)+' / '+(scope.region||'NATIONWIDE')+' · 현재 관제 화면 내부 점검';
    var grid='',detail='',rows='';
    if(kind==='queue'){
      var q=data.queue||{},sum=data.summary||{},up=data.upstream||{},gate=data.releaseGate||{},blockers=data.blockingConditions||[];
      grid=stat('비공개 후보',q.totalCandidates||sum.considered||0,'관리자 검토 원장')+stat('개방 점검 후보',q.goLiveAuditCandidates||sum.goLiveAuditCandidates||0,'시장·증빙·수익·PSOM 완료')+stat('게재 요청 상태',q.publicationRequested||sum.publicationRequested||0,'개방 점검 최종 요청')+stat('검토 보류',q.held||sum.held||0,'증빙·계약·승인 누락')+stat('상품 리서치 입력',up.liveProductResearchQueue||0,'비공개 후보 원천')+stat('릴리스 게이트',gate.enabled===true?'ON':'OFF',gate.mode||'staging_only');
      detail='<strong>현재 상태</strong><br>'+(gate.enabled===true?'릴리스 키가 확인됐지만 후보별 검증은 계속 필요합니다.':'비공개 검토 단계입니다. 프런트 슬롯으로 자동 공개하지 않습니다.')+'<br><strong>차단 조건</strong>'+auditList(blockers);
      var list=Array.isArray(q.rows)?q.rows:[];rows=list.length?'<table><thead><tr><th>후보</th><th>상태</th><th>배치</th><th>수익</th><th>차단 사유</th></tr></thead><tbody>'+list.slice(0,100).map(function(r){return'<tr><td><strong>'+esc(r.title||r.id||r.candidateId||'-')+'</strong><br><span class="small mono">'+esc(r.destinationHost||r.sellerHost||'')+'</span></td><td>'+esc(r.status||r.reviewState||'-')+'</td><td>'+esc(r.page||r.section||(r.placement||{}).page||'-')+'</td><td>'+esc(r.revenueType||(r.revenue||{}).type||'-')+'</td><td>'+esc((r.reasons||r.issues||[]).join(', ')||'-')+'</td></tr>';}).join('')+'</tbody></table>':'<div class="scope-audit-empty">현재 범위의 비공개 상품 후보가 없습니다. 공급업체·상품 리서치 결과가 이 원장으로 승인 전달되기 전에는 0건이 정상입니다.</div>';
      $('scopeAuditStatus').textContent='상품 후보·중개수익 대기열을 읽었습니다. 이 점검은 읽기 전용이며 공개·결제·외부 판매처 이동을 실행하지 않습니다.';
    }else{
      var gate2=data.gate||{},summary=data.summary||{},runtime=data.runtime||{},switches=runtime.supplySwitches||{},release=data.releaseControl||{},privateStage=data.pipeline&&data.pipeline.privateCandidateStage||{},blocking=[];if(gate2.reason)blocking.push(gate2.reason);if(data.status&&data.status!=='ok')blocking.push('status: '+data.status);
      grid=stat('공개 준비 상태',gate2.state||'unknown',gate2.reason||'')+stat('개방 점검 후보',privateStage.goLiveAuditCandidates||summary.goLiveAuditCandidates||0,'대기열 승인 완료')+stat('최종 게재 요청 전',privateStage.auditReady||summary.auditReady||0,'별도 확인 필요')+stat('게재 빌드 요청됨',privateStage.publicationRequested||summary.publicationRequested||0,'선택 상품 요청 상태')+stat('공개 스냅샷 실상품',summary.realProductCandidates||0,'현재 사이트 감지')+stat('게재 제어',release.actionAvailable===true?'준비':'보류',(release.armed?'게이트 ON':'게이트 OFF')+' · '+(release.hookConfigured?'훅 설정':'훅 미설정'));
      detail='<strong>현재 단계</strong><br>이 통합 점검은 상태 확인용입니다. 실제 사이트 게재 요청은 전체 실상품 공급업체·상품 개방 점검 화면에서 상품 한 건을 선택하고 별도 확인 문구를 입력해야 실행됩니다.<br><strong>공급 스위치</strong><br><span class="mono">PRODUCT_SUPPLY_ON='+esc(switches.productSupplyOn||'not-configured')+' · DATA_UPLOAD_ON='+esc(switches.dataUploadOn||'not-configured')+' · FRONT_SLOT_AUTO_FILL='+esc(switches.frontSlotAutoFill||'not-configured')+' · PAYMENT_LIVE='+esc(switches.paymentLive||'not-configured')+'</span><br><strong>현재 게이트</strong>'+auditList(blocking);
      var privateRows=Array.isArray(privateStage.rows)?privateStage.rows:[];rows=privateRows.length?'<table><thead><tr><th>상품</th><th>현재 단계</th><th>PSOM</th><th>판매시장</th><th>게재 상태</th><th>확인 사항</th></tr></thead><tbody>'+privateRows.slice(0,100).map(function(r){var a=r.assignment||{};return'<tr><td><strong>'+esc(r.title||r.candidateId||'-')+'</strong><br><span class="small mono">'+esc(r.candidateId||'-')+'</span></td><td>'+esc(r.stageStatus||'-')+'</td><td>'+esc((a.hubKey||'-')+' / '+(a.slotKey||'-'))+'</td><td>'+esc((r.marketKeys||[]).join(', ')||((a.countryCode||'-')+' / '+(a.regionCode||'-')))+'</td><td>'+esc(a.publicationStatus||'-')+'</td><td>'+esc((r.reasons||[]).join(', ')||'최종 점검 가능')+'</td></tr>';}).join('')+'</tbody></table>':'<div class="scope-audit-empty">현재 범위에 개방 점검 후보가 없습니다. 상품 후보 대기열에서 시장·증빙·수익·PSOM 승인을 먼저 완료해야 합니다.</div>';
      $('scopeAuditStatus').textContent='실상품 공급 개방 상태를 읽었습니다. 이 통합 화면은 상태 확인용이며, 최종 사이트 게재는 전체 개방 점검 화면의 별도 위험 표시 버튼에서만 요청합니다.';
    }
    $('scopeAuditGrid').innerHTML=grid;$('scopeAuditDetail').innerHTML=detail;$('scopeAuditDetail').classList.remove('hidden');$('scopeAuditRows').innerHTML=rows;$('scopeAuditRows').classList.remove('hidden');setButtonEnabled('scopeAuditDownloadBtn',true);renderScope();saveReviewSnapshot();
  }
  async function fetchGoLiveAudit(){await ensureSession(false);var u=new URL('/.netlify/functions/product-go-live-audit',location.origin);u.searchParams.set('mode','pre-product');u.searchParams.set('limit','120');u.searchParams.set('country',selectedCountry);u.searchParams.set('region',selectedSubdivision||'NATIONWIDE');u.searchParams.set('ts',String(Date.now()));var headers={Accept:'application/json'};if(acceptedToken)headers.Authorization='Bearer '+acceptedToken;var res=await fetch(u.pathname+u.search,{credentials:'same-origin',cache:'no-store',headers:headers}),data=null;try{data=await res.json();}catch(_e){}if(!res.ok||!data||data.ok!==true){var error=new Error(data&&data.error||('HTTP '+res.status));error.status=res.status;error.payload=data||null;throw error;}data.scope=data.selectedScope||scopeSnapshot('inline-go-live-audit');return data;}
  async function openScopeAudit(kind,refresh){if(!selectedCountry)return;kind=kind==='go_live'?'go_live':'queue';var cached=lastScopeAuditJson&&activeScopeAudit===kind&&scopeKey(auditScopeOf(lastScopeAuditJson))===scopeKey();if(cached&&!refresh){renderScopeAudit(lastScopeAuditJson,kind);$('scopeAuditPanel').scrollIntoView({behavior:'smooth',block:'start'});return;}setScopeAuditLoading(kind);try{var data=kind==='queue'?await api(REVIEW,'diagnostic','GET',scopeParams()):await fetchGoLiveAudit();data.scope=auditScopeOf(data);renderScopeAudit(data,kind);$('scopeAuditPanel').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){lastScopeAuditJson=e&&e.payload||{ok:false,reportType:'igdc-inline-scope-audit-error',generatedAt:new Date().toISOString(),scope:scopeSnapshot('inline-audit-error'),auditKind:kind,error:text(e&&e.message)};$('scopeAuditStatus').textContent='점검 실패: '+(text(e&&e.message)||'알 수 없는 오류')+'. 기존 국가·상품 리서치 상태는 유지됩니다.';$('scopeAuditDetail').innerHTML='<strong>오류 JSON은 다운로드할 수 있습니다.</strong>';$('scopeAuditDetail').classList.remove('hidden');setButtonEnabled('scopeAuditDownloadBtn',true);show(text(e&&e.message)||'선택 범위 점검에 실패했습니다.','fail');}}
  function openFullScopeAudit(){
    if(!selectedCountry)return;
    var path=activeScopeAudit==='go_live'?'/product-go-live-audit.html':'/commerce-candidate-pipeline.html';
    var u=new URL(path,location.origin);u.searchParams.set('country',selectedCountry);u.searchParams.set('region',selectedSubdivision||'NATIONWIDE');u.searchParams.set('source','commerce-country-control');u.searchParams.set('returnPath',location.pathname+location.search);location.href=u.pathname+u.search;
  }
  function closeScopeAudit(){activeScopeAudit='';lastScopeAuditJson=null;$('scopeAuditPanel').classList.add('hidden');renderScope();saveReviewSnapshot();}
  function downloadScopeAudit(){if(!lastScopeAuditJson){show('다운로드할 선택 범위 점검 JSON이 없습니다.','warn');return;}var prefix=activeScopeAudit==='go_live'?'IGDC_PRODUCT_GO_LIVE_AUDIT':'IGDC_COMMERCE_CANDIDATE_QUEUE',stamp=new Date().toISOString().replace(/[:.]/g,'-'),blob=new Blob([JSON.stringify(lastScopeAuditJson,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=prefix+'_'+selectedCountry+'_'+(selectedSubdivision||'NATIONWIDE')+'_'+stamp+'.json';a.style.display='none';document.body.appendChild(a);a.click();setTimeout(function(){try{a.remove();URL.revokeObjectURL(url);}catch(_e){}},1200);show('선택 범위 점검 JSON 다운로드를 시작했습니다.','ok');}
  function renderSummary(sum,scopeData,sourceLabel){
    var s=(sum&&sum.summary)?sum.summary:(sum||{}),ai=(scopeData&&scopeData.candidates)||[];
    $('summaryTitle').textContent=scopeName()+' 현황';if($('summarySource'))$('summarySource').textContent=sourceLabel||'저장 원장 기준';
    $('summaryGrid').innerHTML=stat('검색 수집',s.collected||0,'원천 검색·스냅샷')+stat('리서치 후보',s.researchCandidates!=null?s.researchCandidates:(s.considered||0),'추가 증빙 누적 대상')+stat('증빙 검토 가능',s.evidenceReady!=null?s.evidenceReady:(s.eligibleForRelease||0),'신뢰평가 진입 가능')+stat('신뢰 순위 계산',s.ranked||0,'현재 실행 결과')+stat('검토 보류',s.held||0,'증빙 보완 대상')+stat('비공개 저장 후보',ai.length,'선택 범위 원장');
    $('summaryPanel').classList.remove('hidden');
  }

  function sectionKeyOf(placement){placement=placement||{};var page=text(placement.page||placement.channel),section=text(placement.sectionKey||placement.section||placement.psom_key);return page&&section?page+'|'+section:'';}
  function sectionLabel(key){var row=PRODUCT_SECTION_MAP[key];return row?row.label:(key?key.replace('|',' · '):'미배정');}
  function productDecision(row){return text(row&&row.slotDecision||'undecided').toLowerCase();}
  function productPlacementKey(row){return sectionKeyOf(row&&row.approvedPlacement)||sectionKeyOf(row&&row.selectedPlacement)||sectionKeyOf(row&&row.primaryPlacement)||sectionKeyOf(row&&row.placement)||sectionKeyOf((row&&row.sectionAssignments||[])[0]);}
  function candidatePlacementKey(row){var list=(row&&row.sectionAssignments||[]).filter(function(item){return item&&(item.approvalEligible===true||item.reviewEligible===true);});return sectionKeyOf(row&&row.primaryPlacement)||sectionKeyOf(list[0])||'unassigned';}
  function eligiblePlacements(row){return (Array.isArray(row&&row.sectionAssignments)?row.sectionAssignments:[]).filter(function(item){return item&&item.approvalEligible===true&&PRODUCT_SECTION_MAP[sectionKeyOf(item)];});}
  function productById(id){id=text(id);return productRows.filter(function(row){return text(row&&row.id)===id;})[0]||null;}
  // A research product can keep its original product id while the durable
  // administrator ledger uses gslot_candidates.id. Front Match must always
  // address the durable candidate id; the original id is UI/research identity only.
  function frontCandidateLedgerId(row){return text(row&&row.candidateId||row&&row.id);}
  function frontProductDestinationKey(row){
    var raw=safeExternalUrl(row&&row.productUrl||row&&row.url),id=text(row&&row.candidateId||row&&row.id);
    if(!raw)return'id:'+id;
    try{
      var u=new URL(raw),drop={utm_source:1,utm_medium:1,utm_campaign:1,utm_term:1,utm_content:1,utm_id:1,utm_name:1,fbclid:1,gclid:1,dclid:1,yclid:1,msclkid:1,mc_cid:1,mc_eid:1,ref:1,referrer:1,referer:1,source:1,src:1,campaign:1,campaignid:1,affiliate:1,aff:1,affid:1,aff_id:1,session:1,sid:1,timestamp:1,ts:1,mtn:1,mtnidx:1,mtn_idx:1,track:1,tracking:1,from:1,fromurl:1};
      u.hash='';u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');if((u.protocol==='https:'&&u.port==='443')||(u.protocol==='http:'&&u.port==='80'))u.port='';u.pathname=(u.pathname||'/').replace(/\/{2,}/g,'/');if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');
      var keep=[];u.searchParams.forEach(function(value,key){var k=text(key).toLowerCase();if(!k||drop[k]||k.indexOf('utm_')===0)return;if(!text(value)&&!/(?:product|goods|item|prd|sku|pid|id|no|code)/.test(k))return;keep.push([k,text(value)]);});keep.sort(function(a,b){return a[0]===b[0]?a[1].localeCompare(b[1]):a[0].localeCompare(b[0]);});u.search='';keep.forEach(function(pair){u.searchParams.append(pair[0],pair[1]);});return u.toString();
    }catch(_e){return raw.toLowerCase();}
  }
  function compareFrontDuplicateRows(a,b){
    var al=productManagementLocked(a)?1:0,bl=productManagementLocked(b)?1:0;if(al!==bl)return bl-al;
    var aa=frontPublicationActive(a)?1:0,ba=frontPublicationActive(b)?1:0;if(aa!==ba)return ba-aa;
    return compareSectionRankRows(a,b);
  }
  function dedupePlacedSectionRows(rows){
    var loose=[],groups={};
    (Array.isArray(rows)?rows:[]).forEach(function(row){
      var key=assignedSectionKey(row),placed=productDecision(row)==='slot_candidate'&&!!key;
      if(!placed){loose.push(row);return;}
      var identity=key+'|'+frontProductDestinationKey(row);
      (groups[identity]||(groups[identity]=[])).push(row);
    });
    Object.keys(groups).sort().forEach(function(identity){var group=groups[identity].slice().sort(compareFrontDuplicateRows);if(group.length)loose.push(group[0]);});
    return loose;
  }
  function productSectionCounts(){var counts={};PRODUCT_SECTIONS.forEach(function(row){counts[row.key]=0;});dedupePlacedSectionRows(productRows).filter(function(row){return productDecision(row)==='slot_candidate';}).forEach(function(row){var key=assignedSectionKey(row);if(Object.prototype.hasOwnProperty.call(counts,key))counts[key]+=1;});return counts;}
  function snapshotSectionList(snapshot,page,section){
    var root=snapshot&&snapshot.pages&&snapshot.pages[page]&&snapshot.pages[page].sections||snapshot&&snapshot.sections||{},raw=root&&root[section];
    if(Array.isArray(raw))return raw;
    if(raw&&Array.isArray(raw.slots))return raw.slots;
    if(raw&&Array.isArray(raw.items))return raw.items;
    return[];
  }
  function snapshotTopItems(snapshot){return snapshot&&Array.isArray(snapshot.items)?snapshot.items:[];}
  function countSnapshotSection(snapshot,page,section){return snapshotSectionList(snapshot,page,section).length;}
  function frontSlotCapacity(key){return key==='tour|tour'?200:PRODUCT_FRONT_SECTION_CAPACITY;}
  function frontItemPlaceholder(item){item=item||{};var id=text(item.canonicalPublication&&item.canonicalPublication.candidateId||item.candidateId||item.id||item.uid||item.productId||item.contentId).toLowerCase(),title=text(item.title||item.name).toLowerCase(),url=text(item.externalProductUrl||item.officialProductUrl||item.productUrl||item.product_url||item.productPageUrl||item.detailUrl||item.checkoutUrl||item.purchaseUrl||item.orderUrl||item.productLink||item.displayUrl||item.sourceUrl||item.targetUrl||item.url||item.href||item.link).toLowerCase();if(item.__igdcSeed===true||item.placeholder===true||item.dummy===true)return true;if(!url||url==='#'||/^javascript:/.test(url)||/\/pages\/coming-soon\.html(?:[?#]|$)/i.test(url)||/example\.(com|org|net)/.test(url))return true;return/(^|[-_])(seed|sample|dummy|placeholder)([-_]|$)/.test(id)||/^(other outdoor food item|product item|recommended brand|tour item|sample|placeholder|dummy)\s*\d*$/i.test(title);}
  function setFrontSnapshotSection(key,list,source,meta){if(!Object.prototype.hasOwnProperty.call(PRODUCT_SECTION_MAP,key))return;list=Array.isArray(list)?list:[];frontSnapshotItems[key]=list.slice(0,frontSlotCapacity(key));frontSnapshotCounts[key]=frontSnapshotItems[key].filter(function(item){return!frontItemPlaceholder(item);}).length;frontSnapshotSource[key]=source||'';frontSnapshotMeta[key]=meta||null;}
  function setFrontSnapshotCount(key,count,source){if(!Object.prototype.hasOwnProperty.call(PRODUCT_SECTION_MAP,key))return;count=Math.max(0,Number(count)||0);frontSnapshotCounts[key]=count;frontSnapshotSource[key]=source||'';if(!Array.isArray(frontSnapshotItems[key]))frontSnapshotItems[key]=[];}
  function currentFrontCount(key){return Math.max(0,Number(frontSnapshotCounts[key]||0));}
  function frontCountSourceLabel(key){var source=text(frontSnapshotSource[key]);return source?source:'프론트 스냅샷';}
  function exactSectionDuplicateCount(key){var raw=rawSectionRows(key),unique=sectionRows(key);return Math.max(0,raw.length-unique.length);}
  function sectionOccupancyText(key,candidateCount){var front=currentFrontCount(key),candidate=Math.max(0,Number(candidateCount)||0),duplicates=exactSectionDuplicateCount(key),unique=PRODUCT_SECTION_MAP[key]?sectionRows(key).length:candidate,slots=frontSlotCapacity(key);return'후보 '+candidate+'/'+PRODUCT_PRIVATE_SECTION_CAPACITY+' · 배치 고유 '+unique+'건 · 프론트 '+slots+'슬롯 · 실상품 '+front+'건'+(duplicates?' · 중복 '+duplicates+'건':'');}
  function sectionMismatchMarkup(key,candidateCount){
    // Never compare 200 private placement candidates with the 100 public slots:
    // a front capacity limit is not a publication/identity mismatch.
    // Also do not assert a mismatch when an IP-routed Snapshot was unavailable
    // or belongs to a country other than the administrator's selected market.
    if(!selectedCountry)return '';
    var report=frontLedgerSectionAudit({key:key},productRows,{country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'});
    if(!report.frontSnapshotScopeVerified)return '<div class="small product-front-ledger-warning">프론트 원장 대조 대기 · 선택 국가와 공개 Snapshot의 IP/지역 또는 조회 상태 확인 필요</div>';
    var parts=[];
    if(report.orphanPublicCards.length)parts.push('관리자 배치에 대응하지 않는 공개 카드 '+report.orphanPublicCards.length+'건');
    if(report.missingPublicCandidateId.length)parts.push('상품 URL은 대응하지만 공개 후보 ID가 다른 카드 '+report.missingPublicCandidateId.length+'건');
    if(report.candidateIdUrlConflicts.length)parts.push('상품 ID는 같지만 상세 URL이 다른 카드 '+report.candidateIdUrlConflicts.length+'건');
    if(report.imageConflicts.length)parts.push('관리자·프론트 이미지 불일치 '+report.imageConflicts.length+'건');
    if(report.suspectImages.length)parts.push('대표 이미지 재검토 '+report.suspectImages.length+'건');
    if(report.placementConflicts.length)parts.push('슬롯·섹션 배치 불일치 '+report.placementConflicts.length+'건');
    if(report.duplicatePublicCandidateIds.length)parts.push('프론트 동일 상품 중복 '+report.duplicatePublicCandidateIds.length+'건');
    var duplicates=exactSectionDuplicateCount(key);if(duplicates)parts.push('관리자 배치 동일 URL 중복 '+duplicates+'건');
    if(!parts.length)return '';
    return '<div class="small product-front-ledger-warning">공개 Snapshot 실상품 '+report.publicCards+'건 · '+esc(parts.join(' · '))+' · 읽기 전용 대조 (상품 ID/URL/이미지/섹션/슬롯)</div>';
  }
  async function fetchFrontSnapshotJson(url){try{var res=await fetch(url+(url.indexOf('?')>=0?'&':'?')+'ts='+Date.now(),{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!res.ok)return null;return await res.json();}catch(_e){return null;}}
  async function refreshFrontSnapshotCounts(options){
    options=options||{};
    var selectedKeys=Array.isArray(options.sectionKeys)?options.sectionKeys.filter(function(key){return !!PRODUCT_SECTION_MAP[key];}):null;
    var sections=selectedKeys?PRODUCT_SECTIONS.filter(function(row){return selectedKeys.indexOf(row.key)>=0;}):PRODUCT_SECTIONS;
    var needed={};sections.forEach(function(row){needed[row.page]=true;});
    // Distribution may fall back to the shared front Snapshot. This is a
    // read-only verification of requested sections, never a deployment action.
    var paths=['/data/front.snapshot.json','/data/distribution.snapshot.json','/data/networkhub-snapshot.json','/data/social.snapshot.json','/data/tour-snapshot.json'];
    var required=[!selectedKeys||needed.home||needed.distribution,!selectedKeys||needed.distribution,!selectedKeys||needed.network,!selectedKeys||needed.social,!selectedKeys||needed.tour];
    var docs=await Promise.all(paths.map(function(path,index){return required[index]?fetchFrontSnapshotJson(path):Promise.resolve(null);}));
    var front=docs[0],distribution=docs[1],network=docs[2],social=docs[3],tour=docs[4];
    if(options.frozenScope&&scopeKey()!==options.frozenScope)return null;
    // Never count previously cached cards as a successful fresh readback.
    if(options.skipRender===true&&sections.some(function(section){return !({home:front,distribution:distribution||front,network:network,social:social,tour:tour})[section.page];}))return null;
    if(options.skipRender===true&&docs.every(function(doc){return !doc;}))return null;
    sections.forEach(function(row){frontSnapshotCounts[row.key]=0;frontSnapshotSource[row.key]='';frontSnapshotItems[row.key]=[];frontSnapshotMeta[row.key]=null;});
    sections.filter(function(row){return row.page==='home';}).forEach(function(row){setFrontSnapshotSection(row.key,snapshotSectionList(front,'home',row.section),'홈 프론트 스냅샷',front&&front.meta);});
    sections.filter(function(row){return row.page==='distribution';}).forEach(function(row){var list=snapshotSectionList(distribution,'distribution',row.section),meta=distribution&&distribution.meta;if(!list.length){list=snapshotSectionList(front,'distribution',row.section);meta=front&&front.meta;}setFrontSnapshotSection(row.key,list,'유통 프론트 스냅샷',meta);});
    if(sections.some(function(row){return row.key==='network|network-right';})){var networkList=snapshotSectionList(network,'network','network-right');if(!networkList.length)networkList=snapshotSectionList(network,'','network-right');if(!networkList.length)networkList=snapshotTopItems(network);setFrontSnapshotSection('network|network-right',networkList,'네트워크 프론트 스냅샷',network&&network.meta);}
    if(sections.some(function(row){return row.key==='social|rightPanel';}))setFrontSnapshotSection('social|rightPanel',snapshotSectionList(social,'social','rightPanel'),'소셜 프론트 스냅샷',social&&social.meta);
    if(sections.some(function(row){return row.key==='tour|tour';})){var tourList=snapshotSectionList(tour,'tour','tour');if(!tourList.length)tourList=snapshotSectionList(tour,'','right');if(!tourList.length)tourList=snapshotTopItems(tour);setFrontSnapshotSection('tour|tour',tourList,'투어 프론트 스냅샷',tour&&tour.meta);}
    frontSnapshotLoadedAt=Date.now();
    if(options.skipRender!==true){if($('productSectionList'))renderProductSectionBoard();if($('productCandidatePanel')&&$('productCandidatePanel').open)renderProductCandidateGroups();}
    return frontSnapshotCounts;
  }
  // Display-only integrity audit. A description image is not a representative image.
  // Do not substitute guessed photos or change a stored candidate here.
  function productImageIssue(url){
    var raw=text(url);if(!raw)return'missing_image';
    try{var u=new URL(raw),path=decodeURIComponent(u.pathname).toLowerCase();
      if(u.protocol!=='https:')return'invalid_image_url';
      if(/\/productions\/descriptions\/|\/products?\/descriptions?\/|\/goods?\/descriptions?\/|\/detail[_-]?images?\//.test(path))return'description_image';
      if(/(?:^|[\/_\-.])(?:favicon|logo|logotype|icon|sprite|avatar|profile|banner|placeholder|no[-_]?image|spinner|captcha)(?:[\/_\-.]|$)/.test(path))return'site_asset';
      if(/\.(?:svg|ico|pdf|css|js|json)$/i.test(path))return'non_product_asset';
      return'';
    }catch(_e){return'invalid_image_url';}
  }
  function verifiedProductImageReviewIssue(row){
    if(!row||productDecision(row)!=='slot_candidate')return '';
    var selected=text(row.imageUrl||row.imageOriginalUrl);
    var issue=productImageIssue(selected);
    // Only strong URL-provenance evidence is enough for an image warning.
    // Missing images, transient 403s, prices and stock must not narrow research.
    if(['description_image','site_asset','non_product_asset','invalid_image_url'].indexOf(issue)>=0)return issue;
    // A front/admin image discrepancy is a REVIEW notice, never evidence that
    // either side is correct. Only compare an explicitly verified same-market
    // published snapshot, and never backfill the admin from the front.
    var key=assignedSectionKey(row),market=selectedCountry,region=selectedSubdivision||'NATIONWIDE';
    if(!key||!market||!snapshotScopeMatches(key,market,region))return '';
    var id=frontCandidateLedgerId(row),adminUrl=normalizeAuditUrl(row.productUrl||row.url);
    var hits=(frontSnapshotItems[key]||[]).filter(function(item){
      if(frontItemPlaceholder(item))return false;
      var ids=frontItemIds(item);
      if(id&&ids.indexOf(id)>=0)return true;
      return !ids.length&&!!adminUrl&&adminUrl===normalizeAuditUrl(normalizedFrontUrl(item));
    });
    if(hits.length!==1)return '';
    var frontImage=frontItemImage(hits[0]),adminImage=normalizeAuditImage(selected);
    if(['description_image','site_asset','non_product_asset','invalid_image_url'].indexOf(productImageIssue(frontImage))>=0)return 'front_image_invalid';
    if(adminImage&&normalizeAuditImage(frontImage)&&adminImage!==normalizeAuditImage(frontImage))return 'front_image_mismatch';
    return '';
  }
  function productImageReviewLabel(issue){return {
    description_image:'상세 설명 이미지가 대표사진으로 저장됨',
    site_asset:'사이트 로고·아이콘 등이 상품 대표사진으로 저장됨',
    non_product_asset:'이미지 대신 문서·스크립트 파일이 등록됨',
    invalid_image_url:'대표 이미지 주소 형식이 올바르지 않음',
    front_image_invalid:'프론트 Snapshot에 잘못된 대표 이미지가 게시됨',
    front_image_mismatch:'관리자·프론트 대표 이미지가 달라 확인 필요'
  }[issue]||'대표 이미지 확인 필요';}
  function frontItemImage(item){item=item||{};return text(item.thumb||item.thumbnail||item.thumbnail_url||item.image||item.imageUrl||item.imageOriginalUrl||item.thumbnailUrl);}
  function normalizeAuditImage(url){try{var u=new URL(text(url));if(u.protocol!=='https:')return'';u.hash='';return u.toString();}catch(_e){return'';}}
  function frontItemSlot(item){item=item||{};var p=item.placement||{},v=item.slot!=null?item.slot:(item.slotId!=null?item.slotId:p.slot);return v===undefined||v===null||v===''?'':text(v);}
  function frontItemIds(item){item=item||{};var commerce=item.commerceCandidate||{},publication=item.canonicalPublication||{};return Array.from(new Set([publication.candidateId,publication.candidate_id,item.candidateId,item.candidate_id,commerce.candidateId,commerce.candidate_id,item.id,item.uid,item.productId,item.product_id,item.contentId,item.content_id,item.trackId,item.track_id].map(text).filter(Boolean)));}
  function normalizedFrontUrl(item){item=item||{};return safeExternalUrl(item.externalProductUrl||item.officialProductUrl||item.productUrl||item.product_url||item.productPageUrl||item.detailUrl||item.checkoutUrl||item.purchaseUrl||item.orderUrl||item.displayUrl||item.url||item.href||item.link||item.affiliateOutboundUrl||item.externalOutboundUrl);}
  function restoreIdsForFrontSection(_key){
    // Strict one-way authority: a published/front Snapshot is output-only.
    // It must never seed, restore, or select administrator candidates.
    return [];
  }
  async function restoreTrendingAdminFromFrontOnce(){
    // One-way authority contract: Front snapshots are OUTPUT/monitoring only.
    // They must never rewrite the administrator candidate/placement ledger.
    return {skipped:true,reason:'front_to_admin_reverse_write_disabled'};
  }

  function tourDiningAuxiliaryRow(row){var hay=[row&&row.productName,row&&row.title,row&&row.priorityLabel,row&&row.description,row&&row.summary,row&&row.productUrl,row&&row.url].map(text).join(' ').toLowerCase(),misleading=/(여행용\s*(?:티슈|물티슈|휴지|세면|파우치)|포켓물티슈|캠핑용?\s*(?:물티슈|휴지)|체험팩|travel\s*(?:size|tissue|wipe))/i.test(hay),packaged=/(밀키트|냉동|즉석|가공식품|포장제품|배송상품|세트상품|meal\s*kit|frozen|packaged|grocery)/i.test(hay);return!misleading&&!packaged&&/(맛집|레스토랑|식당|음식점|다이닝|카페|뷔페|브런치|비스트로|그릴|스테이크하우스|펍|restaurant|dining|cafe|café|buffet|brunch|bistro|grill|steakhouse|pub)/i.test(hay);}
  function tourDiningPlacementCount(){return productRows.filter(function(row){return productDecision(row)==='slot_candidate'&&productPlacementKey(row)==='tour|tour'&&tourDiningAuxiliaryRow(row);}).length;}
  function productManagementLocked(row){var control=row&&row.managementControl||{},placement=row&&row.approvedPlacement||{},source=text(control.source||row&&row.decisionSource).toLowerCase();return control.administratorLocked===true||control.aiReclassificationAllowed===false||source==='administrator'||(placement.administratorSelected===true&&placement.aiSelected!==true);}
  function affiliateStage(row){var settlement=row&&row.affiliateSettlement||{},stage=text(settlement.stage||row&&row.affiliateStage).toLowerCase();return['connection_required','referral_verified','online_affiliate_active','formal_partner'].indexOf(stage)>=0?stage:'connection_required';}
  function affiliateStageLabel(stage){return{connection_required:'제휴 연결 필요',referral_verified:'리퍼럴 수익 확인',online_affiliate_active:'온라인 제휴 활성',formal_partner:'정식 파트너'}[stage]||'제휴 연결 필요';}
  function affiliateStageClass(stage){return stage==='formal_partner'?'partner':stage==='online_affiliate_active'?'online':stage==='referral_verified'?'referral':'connection';}
  function affiliateSettlementSummary(row){var settlement=row&&row.affiliateSettlement||{},stage=affiliateStage(row),parts=[];if(settlement.counterparty||settlement.providerName)parts.push(text(settlement.counterparty||settlement.providerName));if(settlement.settlementMode)parts.push(text(settlement.settlementMode));if(settlement.commissionRate!=null)parts.push('수수료 '+Math.round(Number(settlement.commissionRate)*10000)/100+'%');if(settlement.payoutPerTransaction!=null)parts.push('건당 '+text(settlement.payoutPerTransaction)+(settlement.currency?' '+text(settlement.currency):''));var ready=settlement.settlementReady===true?'정산 준비 확인':stage==='connection_required'?'연결 대기':'증빙 보완 필요';return'<div class="affiliate-settlement-summary"><span class="pill affiliate-stage-pill '+affiliateStageClass(stage)+'">'+esc(affiliateStageLabel(stage))+'</span> · '+esc(ready)+(parts.length?'<br>'+esc(parts.join(' · ')):'')+'</div>'; }
  function frontPublicationPending(row){var front=row&&row.frontPublication||{},status=text(front.status).toLowerCase();return front.publicSnapshotConfirmed!==true&&['queued','publish_requested'].indexOf(status)>=0;}
  function frontPublicationLive(row){var front=row&&row.frontPublication||{},status=text(front.status).toLowerCase();return front.publicSnapshotConfirmed===true||['matched','published','active'].indexOf(status)>=0;}
  function frontPublicationActive(row){var status=text(row&&row.frontPublication&&row.frontPublication.status).toLowerCase();return frontPublicationLive(row)||frontPublicationPending(row)||status==='unpublish_requested'||status==='unpublish_failed';}
  function frontPublicationSummary(row){var front=row&&row.frontPublication||{},status=text(front.status).toLowerCase();if(!status)return'<div class="product-front-status">프론트 미매칭 · 최종 적용 전</div>';var labels={queued:'게재 후보 관리목록 등록',publish_requested:'게재 요청됨',matched:'프론트 매칭 확인',published:'프론트 게시 확인',unpublish_requested:'매칭 해제 요청',unmatched:'매칭 해제됨',blocked:'게재 차단',unpublish_failed:'해제 재확인 필요'};return'<div class="product-front-status '+(frontPublicationActive(row)?'active':'')+'">프론트 상태: '+esc(labels[status]||status)+(front.reason?' · '+esc(front.reason):'')+'</div>';}
  function productManagementOptions(row,mode,groupKey,slotAllowed){
    var counts=productSectionCounts(),current=mode==='section'?groupKey:'',recommended=sectionKeyOf(row&&row.primaryPlacement)||candidatePlacementKey(row),selected=productPlacementSelections[row.id]||((current||recommended)&&slotAllowed?'section:'+(current||recommended):'');
    if(selected.indexOf('section:')===0){var selectedKey=selected.slice(8),selectedFull=Number(counts[selectedKey]||0)>=PRODUCT_PRIVATE_SECTION_CAPACITY&&current!==selectedKey;if(!slotAllowed||selectedFull){selected='';delete productPlacementSelections[row.id];}}
    if(selected)productPlacementSelections[row.id]=selected;
    var pages={home:'홈',distribution:'유통',network:'네트워크',social:'소셜',tour:'투어'},groups=[];
    if(slotAllowed)Object.keys(pages).forEach(function(page){var options=PRODUCT_SECTIONS.filter(function(section){return section.page===page;}).map(function(section){var full=Number(counts[section.key]||0)>=PRODUCT_PRIVATE_SECTION_CAPACITY&&current!==section.key,disabled=full,label=section.label+(full?' · 후보·예비 정원 '+PRODUCT_PRIVATE_SECTION_CAPACITY+'개':'');return'<option value="section:'+esc(section.key)+'" '+(selected==='section:'+section.key?'selected ':'')+(disabled?'disabled ':'')+'>'+esc(label)+'</option>';}).join('');groups.push('<optgroup label="'+esc(pages[page])+'">'+options+'</optgroup>');});
    // Invalid seller pages cannot be auto-published or newly slotted; present
    // the actions that really work instead of a dropdown of disabled sections.
    if(!slotAllowed&&selected.indexOf('section:')===0){selected='';delete productPlacementSelections[row.id];}
    var locked=productManagementLocked(row),stage=affiliateStage(row);
    return'<div class="product-placement-box"><div class="product-placement-title">관리 작업 선택'+(slotAllowed?'':' · 상세주소 검증 전에는 섹션 배치 제한')+'</div><div class="product-management-row"><select class="product-management-select" data-product-management-select="'+esc(row.id)+'"><option value="">'+(slotAllowed?'작업을 선택하세요':'보류·제외 등 관리 작업을 선택하세요')+'</option>'+groups.join('')+'<optgroup label="상태 관리"><option value="hold" '+(selected==='hold'?'selected ':'')+'>보류 목록으로 이동</option><option value="reject" '+(selected==='reject'?'selected ':'')+'>연구 제외 목록으로 이동</option><option value="purge" '+(selected==='purge'?'selected ':'')+'>영구 제외·재수집 차단</option><option value="undecided" '+(selected==='undecided'?'selected ':'')+'>미배정 후보로 되돌리기</option><option value="ai_reclassify" '+(selected==='ai_reclassify'?'selected ':'')+'>관리자 고정 해제·AI 재분류 허용</option></optgroup><optgroup label="제휴·수익 정산"><option value="affiliate:connection_required">제휴 연결 필요로 설정</option><option value="affiliate:referral_verified">리퍼럴 수익 확인</option><option value="affiliate:online_affiliate_active">온라인 제휴 활성</option><option value="affiliate:formal_partner">정식 파트너</option></optgroup></select><button type="button" class="product-management-apply" data-product-management-apply="'+esc(row.id)+'" '+(selected?'':'disabled')+'>적용</button></div><div class="product-ai-recommendation">AI 추천: '+esc(recommended&&recommended!=='unassigned'?sectionLabel(recommended):'추가 검증 필요')+' · '+(locked?'관리자 결정 고정':'AI 재분류 가능')+' · 현재 '+esc(affiliateStageLabel(stage))+'</div></div>';
  }
  function automationResultText(result){result=result||{};var parts=['자동 배치 '+Number(result.assigned||0)+'건','검토정보 부족 경고 배치 '+Number(result.pendingEvidenceAssigned||0)+'건','미배정 유지 '+Number(result.unassigned||0)+'건','검증 보류 '+Number(result.held||0)+'건','관리자 결정 보존 '+Number(result.manualPreserved||0)+'건'];if(Number(result.enrichmentAttempted||0)>0)parts.push('상품정보 보강 '+Number(result.enrichmentCompleted||0)+'/'+Number(result.enrichmentAttempted||0)+'건');if(Number(result.enrichmentRemaining||0)>0)parts.push('추가 보강 대기 '+Number(result.enrichmentRemaining||0)+'건');parts.push('정산 준비 '+Number(result.settlementReady||0)+'건');if(result.sectionKey)parts.unshift(sectionLabel(result.sectionKey));return parts.join(' · ');}
  function queueCandidateUrl(c){var card=c&&c.productCard||{},supplier=c&&c.supplier||{},payload=c&&c.source_payload||{};return safeExternalUrl(card.checkoutUrl||c&&c.checkoutUrl||c&&c.externalProductUrl||c&&c.productUrl||c&&c.url||c&&c.officialUrl||payload.externalProductUrl||payload.url||card.supplierUrl||supplier.officialUrl||c&&c.supplierUrl);}
  function queueSupplierUrl(c){var card=c&&c.productCard||{},supplier=c&&c.supplier||{},payload=c&&c.source_payload||{};return safeExternalUrl(card.supplierUrl||supplier.officialUrl||payload.supplier&&payload.supplier.officialUrl||c&&c.supplierUrl);}
  function syncDetailsToggle(details,label){if(label)label.textContent=details&&details.open?'목록 닫기':'목록 펼치기';}
  function clearHeavyPanel(panel){if(!panel)return;productRenderEpoch+=1;if(panel.id==='aiPanel'&&$('aiRows'))$('aiRows').innerHTML='';if(panel.id==='queuePanel'&&$('queueRows'))$('queueRows').innerHTML='';if(panel.id==='latestProductPanel'&&$('latestProductGrid'))$('latestProductGrid').innerHTML='';if(panel.id==='productCandidatePanel'&&$('productGrid'))$('productGrid').innerHTML='';if(panel.id==='excludedLedgerPanel'){if($('supplierHoldRows'))$('supplierHoldRows').innerHTML='';if($('supplierBlockedRows'))$('supplierBlockedRows').innerHTML='';if($('productHoldRows'))$('productHoldRows').innerHTML='';if($('productRejectRows'))$('productRejectRows').innerHTML='';}}
  function closeOtherHeavyPanels(current,keepGroup){Array.prototype.forEach.call(document.querySelectorAll('[data-heavy-panel]'),function(panel){if(panel!==current&&panel.open){panel.open=false;clearHeavyPanel(panel);}});Array.prototype.forEach.call(document.querySelectorAll('details[data-product-group][open]'),function(group){if(group!==keepGroup&&!(current&&current.contains(group))){group.open=false;var grid=group.querySelector('.product-group-grid');if(grid)grid.innerHTML='';}});}
  function wireHeavyPanels(){if(heavyPanelWired)return;heavyPanelWired=true;Array.prototype.forEach.call(document.querySelectorAll('[data-heavy-panel]'),function(panel){panel.addEventListener('toggle',function(){if(panel.open){closeOtherHeavyPanels(panel);if(panel.id==='aiPanel')renderSupplierActiveRows();else if(panel.id==='queuePanel')renderQueueRows();else if(panel.id==='latestProductPanel'){renderLatestProductRows();var total=Number(lastProductJson&&lastProductJson.summary&&lastProductJson.summary.latestResearchProducts||0);if(selectedCountry&&!latestRefreshActive&&(productLoopActive||!latestProductRowsComplete||!latestProductRows.length)){latestRefreshActive=true;refreshLatestResearchRows(selectedCountry,selectedSubdivision||'NATIONWIDE',{state:$('productResearchState'),label:'최신 상품 리서치 목록',preserveOnFailure:true}).catch(function(error){show('최신 상품 목록 새로고침 지연: '+conciseRequestError(error&&error.message,error&&error.status),'warn');}).finally(function(){latestRefreshActive=false;});}}else if(panel.id==='productCandidatePanel')renderProductCandidateGroups();else if(panel.id==='excludedLedgerPanel')renderExcludedLedger();}else clearHeavyPanel(panel);syncManagementToggleLabels();});});}
  function syncManagementToggleLabels(){syncDetailsToggle($('aiPanel'),$('aiToggleLabel'));syncDetailsToggle($('queuePanel'),$('queueToggleLabel'));syncDetailsToggle($('latestProductPanel'),$('latestProductToggleLabel'));syncDetailsToggle($('productCandidatePanel'),$('productCandidateToggleLabel'));syncDetailsToggle($('excludedLedgerPanel'),$('excludedLedgerToggleLabel'));syncSupplierControlToggleLabel();Array.prototype.forEach.call(document.querySelectorAll('[data-detail-toggle-label]'),function(label){syncDetailsToggle(label.closest('details'),label);});}
  function closeManagementPanels(){Array.prototype.forEach.call(document.querySelectorAll('[data-heavy-panel]'),function(panel){panel.open=false;clearHeavyPanel(panel);});Array.prototype.forEach.call(document.querySelectorAll('#productSectionList details[open]'),function(panel){panel.open=false;var grid=panel.querySelector('.product-group-grid');if(grid)grid.innerHTML='';});syncManagementToggleLabels();}
  function renderInBatches(container,rows,renderer,limit){if(!container)return;productRenderEpoch+=1;var token=productRenderEpoch,visible=rows.slice(0,Math.max(0,limit||100)),cursor=0;container.innerHTML='';function step(){if(token!==productRenderEpoch||!container.isConnected)return;var end=Math.min(cursor+20,visible.length),html='';for(;cursor<end;cursor++)html+=renderer(visible[cursor],cursor);container.insertAdjacentHTML('beforeend',html);wireProductImages(container);syncFrontSelectionControls();if(cursor<visible.length){if(window.requestIdleCallback)window.requestIdleCallback(step,{timeout:120});else setTimeout(step,16);}}step();}
  function pageCount(total,size){return Math.max(1,Math.ceil(Math.max(0,Number(total)||0)/Math.max(1,Number(size)||MANAGEMENT_PAGE_SIZE)));}
  function clampPage(page,total,size){return Math.max(0,Math.min(Math.max(0,Number(page)||0),pageCount(total,size)-1));}
  function pagerMarkup(kind,key,page,total,size){size=Math.max(1,Number(size)||MANAGEMENT_PAGE_SIZE);page=clampPage(page,total,size);var pages=pageCount(total,size),start=total?page*size+1:0,end=Math.min(total,(page+1)*size);if(pages<=1)return'<div class="management-pager"><span class="small">'+start+'-'+end+' / '+total+'건</span></div>';return'<div class="management-pager" data-management-pager="'+esc(kind)+'" data-management-pager-key="'+esc(key||'')+'"><button type="button" class="secondary" data-page-delta="-1" '+(page<=0?'disabled':'')+'>이전</button><span class="small">'+(page+1)+' / '+pages+' 페이지 · '+start+'-'+end+' / '+total+'건</span><button type="button" class="secondary" data-page-delta="1" '+(page>=pages-1?'disabled':'')+'>다음</button></div>'; }
  function wireProductImages(root){Array.prototype.forEach.call((root||document).querySelectorAll('[data-product-image]:not([data-image-wired])'),function(img){img.setAttribute('data-image-wired','1');
    // A loaded 16x16 search/navigation icon is still not an actual thumbnail.
    // Reuse the existing alternate-image retry handler; do not invent an image.
    img.addEventListener('load',function(){if(img.naturalWidth>0&&img.naturalHeight>0&&
      (img.naturalWidth<48||img.naturalHeight<48)&&img.naturalWidth*img.naturalHeight<4096){
      img.dispatchEvent(new Event('error'));
    }});
    img.addEventListener('error',function(){
    // Retry a different verified-looking IMAGE URL, never a different product
    // identity. No external proxy and no invented thumbnail are used.
    var alternatives=[];try{alternatives=JSON.parse(img.getAttribute('data-image-alternates')||'[]');}catch(_e){}
    var next=Number(img.getAttribute('data-image-attempt')||0);if(next<alternatives.length){var url=safeExternalImageUrl(alternatives[next]);img.setAttribute('data-image-attempt',String(next+1));if(url&&url!==img.src){img.src=url;return;}}
    img.classList.add('hidden');var parent=img.parentNode,frame=img.closest&&img.closest('.product-image-frame');var fallback=frame&&frame.querySelector('.product-image-missing');if(!fallback&&parent)fallback=parent.nextElementSibling;if(fallback)fallback.classList.remove('hidden');
  });});}
  function queueCandidateId(row){return text(row&&(row.candidateId||row.id));}
  function queueVisibleRows(rows){
    return (Array.isArray(rows)?rows:[]).filter(function(row){var stage=text(row&&row.stageStatus).toLowerCase(),status=text(row&&row.status).toLowerCase();return !['held','hold','rejected','reject','suppressed','deleted','removed'].includes(stage)&&!['held','hold','rejected','reject','suppressed','deleted','removed'].includes(status);});
  }
  function syncQueueToggleLabel(){syncDetailsToggle($('queuePanel'),$('queueToggleLabel'));}
  function closeQueuePanel(){var panel=$('queuePanel');if(panel&&typeof panel.open==='boolean'){panel.open=false;clearHeavyPanel(panel);}syncQueueToggleLabel();}
  function selectedQueueIds(){var body=$('queueRows');if(!body)return[];return Array.prototype.map.call(body.querySelectorAll('[data-queue-select]:checked'),function(input){return text(input.value);}).filter(Boolean);}
  function syncQueueSelectionControls(){
    var body=$('queueRows'),all=$('queueSelectAll'),boxes=body?Array.prototype.slice.call(body.querySelectorAll('[data-queue-select]')):[],selected=boxes.filter(function(box){return box.checked;});
    if(all){all.checked=boxes.length>0&&selected.length===boxes.length;all.indeterminate=selected.length>0&&selected.length<boxes.length;all.disabled=!boxes.length;}
    if($('queueSelectedCount'))$('queueSelectedCount').textContent='선택 '+selected.length+'건';
    if($('queueOpenInProductManagerBtn'))$('queueOpenInProductManagerBtn').disabled=!selected.length;
    if($('queueSelectedAiPlaceBtn'))$('queueSelectedAiPlaceBtn').disabled=!selected.length;
    if($('queueSelectedManualPlaceBtn'))$('queueSelectedManualPlaceBtn').disabled=!selected.length;
    Array.prototype.forEach.call(document.querySelectorAll('[data-queue-bulk]'),function(button){button.disabled=!selected.length;});
  }
  async function openSelectedQueueProductsInManager(){
    var ids=selectedQueueIds();if(!ids.length){show('상품 관리목록에서 확인할 대기열 상품을 선택해 주세요.','warn');return;}
    queueFocusedCandidateIds=ids.slice(0,3000);
    ids.forEach(function(id){candidateSelectedProducts[text(id)]=true;});
    try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(_refreshError){}
    var panel=$('productCandidatePanel');
    if(panel){
      panel.classList.remove('hidden');
      panel.open=true;
      renderProductCandidateGroups();
      var selectedGroup=panel.querySelector('details[data-product-group="queue_selected"]');
      if(selectedGroup){selectedGroup.open=true;var selectedLabel=selectedGroup.querySelector('[data-group-toggle-label]');syncDetailsToggle(selectedGroup,selectedLabel);}
      panel.scrollIntoView({behavior:'smooth',block:'start'});
    }
    syncCandidateSelectionControls('queue_selected');
    saveReviewSnapshot();
    show('선택한 대기열 상품 '+ids.length+'건을 상품 관리목록으로 가져왔습니다. 선택 상태도 유지했으므로 바로 AI 자동배치·수동배치·보류·제외·영구 제외를 실행할 수 있습니다.','ok');
  }
  async function runSelectedQueueAiPlacement(){
    var ids=selectedQueueIds();if(!ids.length){show('AI 자동배치할 상품을 먼저 선택해 주세요.','warn');return;}
    queueFocusedCandidateIds=ids.slice(0,3000);
    try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(_refreshError){}
    ids.forEach(function(id){candidateSelectedProducts[text(id)]=true;});
    var result=await aiPlaceCandidateIds(ids);
    show('선택 상품 '+ids.length+'건 AI 자동배치 · 배치 '+Number(result&&result.processed||0)+'건 · 실패 '+Number(result&&result.failed||0)+'건. 배치 결과는 20개 섹션 배치 예정 상품 목록에서 확인할 수 있습니다.',Number(result&&result.failed||0)?'warn':'ok');
  }
  async function runSelectedQueueManualPlacement(){
    var ids=selectedQueueIds(),placement=text($('queueSelectedManualSection')&&$('queueSelectedManualSection').value);
    if(!ids.length){show('수동 배치할 상품을 먼저 선택해 주세요.','warn');return;}
    if(!PRODUCT_SECTION_MAP[placement]){show('수동 배치할 20개 섹션을 선택해 주세요.','warn');return;}
    try{
      var result=await authorityCandidateAction('slot_candidate',ids,placement,{source:'administrator'});
      await refreshCandidateLedgerProducts({preserveResearchReport:true});
      var confirmed=new Set((result&&result.processedIds||[]).map(text));var verified=ids.filter(function(id){var row=productById(id);return confirmed.has(id)&&row&&productDecision(row)==='slot_candidate'&&assignedSectionKey(row)===placement;});show('수동 이관 요청 '+ids.length+'건 · 목적지 저장 확인 '+verified.length+'건 · 추가 확인 '+(ids.length-verified.length)+'건. 프론트 공개는 아직 실행하지 않았습니다.',verified.length===ids.length?'ok':'warn');
    }catch(error){show(conciseRequestError(error&&error.message,error&&error.status)||'선택 상품 수동배치를 완료하지 못했습니다.','fail');}
  }

  function queueActionMessage(action,count){
    if(action==='dismiss')return '선택 '+count+'건을 현재 대기열에서 삭제합니다. 차단 기록은 남기지 않아 이후 공식 상품 리서치에서 다시 발견될 수 있습니다. 계속하시겠습니까?';
    if(action==='purge')return '선택 '+count+'건을 영구 제외합니다. 후보 원장은 재수집 차단 상태로 보존되며 이후 자동 리서치에서 다시 승격되지 않습니다. 계속하시겠습니까?';
    if(action==='reject')return '선택 '+count+'건을 연구 제외 목록으로 이동합니다. 영구 URL·도메인 차단과는 별도이며, 관리자가 복원하기 전까지 다음 상품 리서치에서 다시 자동 승격하지 않습니다. 계속하시겠습니까?';
    return '선택 '+count+'건을 현재 화면 목록에서만 제거합니다. 원장과 기존 검토 기록은 유지됩니다. 계속하시겠습니까?';
  }
  async function applyQueueAction(action){
    var ids=selectedQueueIds();if(!ids.length){show('처리할 상품 후보를 선택해 주세요.','warn');return;}if(!window.confirm(queueActionMessage(action,ids.length)))return;
    try{
      var data=await api(QUEUE_CONTROL,'bulk_action','POST',{}, {candidateIds:ids,decision:action,countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE'});
      var done=new Set((data.processedIds||[]).map(text));queueCandidateRows=queueCandidateRows.filter(function(row){return !done.has(queueCandidateId(row));});renderQueue(queueCandidateRows);try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(_refreshError){}
      show('선택 '+(data.processed||done.size)+'건의 상품 후보 대기열 정리를 완료했습니다. 실제 원장 삭제·재수집 허용과 영구 제외는 서로 다른 상태로 저장됩니다.','ok');
    }catch(e){show(text(e&&e.message)||'상품 후보 대기열을 정리하지 못했습니다.','fail');}
  }

  function renderQueueRows(){
    var body=$('queueRows');if(!body)return;var total=queueCandidateRows.length;queuePage=clampPage(queuePage,total,MANAGEMENT_PAGE_SIZE);var pageStart=queuePage*MANAGEMENT_PAGE_SIZE,rows=queueCandidateRows.slice(pageStart,pageStart+MANAGEMENT_PAGE_SIZE);
    var html=rows.length?rows.map(function(c,index){var absolute=pageStart+index,p=c.placement||{},r=c.revenue||{},m=c.scopeMatch||{},reasons=Array.isArray(c.reasons)?c.reasons.join(', '):'-',id=queueCandidateId(c),url=queueCandidateUrl(c),supplierUrl=queueSupplierUrl(c),title=text(c.title||c.name||id||'상품 후보'),link=url?externalReviewAnchor(url,title,'queue-primary-link'):'<strong>'+esc(title)+'</strong>',review=url?'<br>'+externalReviewAnchor(url,'상품 원본 열기','queue-review-link'):'',supplier=supplierUrl&&supplierUrl!==url?'<br>'+externalReviewAnchor(supplierUrl,'업체 사이트 열기','queue-review-link'):'';return'<tr data-review-anchor="queue-'+esc(reviewAnchorToken(id||url||title,absolute))+'"><td class="queue-number">'+(absolute+1)+'</td><td class="supplier-select-cell"><input type="checkbox" data-queue-select value="'+esc(id)+'" aria-label="'+esc((absolute+1)+'번 '+title)+' 선택" '+(!id?'disabled':'')+'></td><td>'+link+review+supplier+'<br><span class="mono">'+esc(id||'-')+'</span>'+(url?'<a class="queue-source-url mono" href="'+esc(url)+'" target="_top" data-review-link="1" rel="noreferrer external nofollow" referrerpolicy="no-referrer">'+esc(url)+'</a>':'')+'</td><td>'+esc(m.mode||'-')+'<br>'+esc((m.country||'-')+' / '+(m.region||'-'))+'</td><td>'+(c.releaseEligible?'<span class="pill good">통과</span>':'<span class="pill warn">보류</span>')+'</td><td>'+esc((p.page||'-')+' / '+(p.section||'-'))+'</td><td>'+esc((c.marketKeys||[]).join(', ')||'-')+'</td><td>'+esc(r.type||'-')+' / '+esc(r.monetizationState||'-')+'</td><td>'+esc(reasons)+'</td></tr>';}).join(''):'<tr><td colspan="9" class="small">이 범위의 기존 후보가 없습니다.</td></tr>';
    html+='<tr class="queue-pager-row"><td colspan="9">'+pagerMarkup('queue','',queuePage,total,MANAGEMENT_PAGE_SIZE)+'</td></tr>';body.innerHTML=html;syncQueueSelectionControls();
  }
  function renderQueue(rows){
    var panel=$('queuePanel'),currentScope=scopeKey(),sameScope=queueControlScopeKey===currentScope;queueControlScopeKey=currentScope;queueCandidateRows=queueVisibleRows(rows);if(!sameScope)queuePage=0;queuePage=clampPage(queuePage,queueCandidateRows.length,MANAGEMENT_PAGE_SIZE);
    if(!panel)return;panel.classList.remove('hidden');if(!sameScope)panel.open=false;if($('queueSummary'))$('queueSummary').textContent=queueCandidateRows.length+'건';syncQueueToggleLabel();if(panel.open)renderQueueRows();else if($('queueRows'))$('queueRows').innerHTML='';
  }

  function candidateLedgerFrontStatus(row){var life=row&&row.lifecycle||{},assignment=life.assignment||{},status=text(assignment.publicationStatus||assignment.publication_status).toLowerCase();if(!status||status==='audit_ready')return null;return{schema:'igdc-product-front-publication-control.v1',candidateId:text(row&&row.candidateId),status:status,queued:status==='publish_requested',persisted:true,pendingBuild:false,publicSnapshotConfirmed:false};}
  function candidateLedgerProductRow(row){
    row=row||{};var rr=row.researchReadiness||{},card=(row.productCard&&row.productCard.checkoutUrl)?row.productCard:(rr.productCard||row.productCard||{}),supplier=row.supplier||{},placement=row.placement||{},stage=text(row.stageStatus).toLowerCase(),queueControl=row.queueControl||{},explicit=text(row.slotDecision).toLowerCase(),queueAction=text(queueControl.action).toLowerCase(),page=text(placement.page),section=text(placement.section||placement.sectionKey),key=page&&section?page+'|'+section:'',decision='undecided';
    if(queueControl.permanentExcluded===true||explicit==='purge'||queueAction==='purge')decision='purge';
    else if(['removed','removed_from_list','dismiss','deleted','deleted_from_management'].indexOf(explicit)>=0||['remove_from_list','dismiss'].indexOf(queueAction)>=0||stage==='removed')decision='removed_from_list';
    else if(explicit==='hold'||queueAction==='hold')decision='hold';
    else if(explicit==='reject'||queueAction==='reject')decision='reject';
    else if(explicit==='slot_candidate')decision='slot_candidate';
    // A previously held pipeline stage is historical review metadata. When the
    // durable candidate ledger explicitly says undecided, its current private
    // disposition wins. Otherwise a successfully restored product disappears
    // into Hold instead of the 20-section administrator UNASSIGNED pool.
    else if(explicit==='undecided')decision='undecided';
    else if(stage==='held'||stage==='hold')decision='hold';
    else if(stage==='rejected'||stage==='reject'||stage==='suppressed')decision='reject';
    else if(key&&PRODUCT_SECTION_MAP[key]&&stage!=='administrator_selection_pending')decision='slot_candidate';
    var url=safeExternalUrl(card.checkoutUrl||row.url||row.official_url),image=safeExternalImageUrl(card.image||row.image||row.thumbnail_url),supplierUrl=safeExternalUrl(card.supplierUrl||supplier.officialUrl||supplier.url),front=candidateLedgerFrontStatus(row),ranking=row.ranking||{},management=row.managementControl||{},integrity=row.managementIntegrity||{};
    var imageAsProduct=/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i.test(url),genericTitle=genericOrChallengeResearchTitle(card.title||row.title||'');
    var runtimeValidation=row.runtimeValidation&&typeof row.runtimeValidation==='object'?row.runtimeValidation:{},runtimeState=text(runtimeValidation.state).toLowerCase(),researchStatus=text(row.researchStatus||card.researchStatus||rr.researchStatus||rr.stage||'private_research_queue').toLowerCase(),terminalResearchStatus=/^(?:http_404|http_410|non_html|blocked|unavailable|invalid_product_url|product_page_explicit_invalid_message|product_page_redirected_to_seller_home)$/.test(researchStatus),productPageLive=!!url&&!terminalResearchStatus&&runtimeState!=='dead'&&row.productPageLive!==false&&card.productPageLive!==false;
    var structuralReady=(integrity.structuralReady!==undefined?integrity.structuralReady===true:!!(url&&image&&!imageAsProduct&&!genericTitle))&&!!image&&!genericTitle,assignmentRepairRequired=decision==='slot_candidate'&&(!PRODUCT_SECTION_MAP[key]||row.assignmentRepairRequired===true||!text(((row.lifecycle||{}).assignment||{}).id)),productEvidenceReviewRequired=decision==='slot_candidate'&&!structuralReady;
    var approved=decision==='slot_candidate'&&!assignmentRepairRequired?{page:page,section:section,sectionKey:section,country:selectedCountry,region:selectedSubdivision||'NATIONWIDE',administratorSelected:placement.administratorSelected===true,aiSelected:placement.aiSelected===true,automaticPrivatePlacement:placement.automaticPrivatePlacement===true,publicPublication:false,publicReleaseEvidencePending:row.releaseEligible!==true}:null;
    var reasons=Array.isArray(row.reasons)?row.reasons.slice():[];(Array.isArray(integrity.reasons)?integrity.reasons:[]).forEach(function(reason){if(reasons.indexOf(reason)<0)reasons.push(reason);});
    return{ledgerSource:'candidate',recoverySuggestions:Array.isArray(row.recoverySuggestions)?row.recoverySuggestions.slice(0,5):(Array.isArray((row.review||{}).recoverySuggestions)?row.review.recoverySuggestions.slice(0,5):[]),lastRecoveryCheckedAt:text(row.lastRecoveryCheckedAt||(row.review||{}).lastRecoveryCheckedAt),recoveryReason:text(row.recoveryReason||(row.review||{}).recoveryReason),candidateId:text(row.candidateId),id:text(row.candidateId),productName:text(card.title||row.title||'상품명 확인 중'),title:text(card.title||row.title||'상품명 확인 중'),sourceTitle:text(card.sourceTitle||row.title),productUrl:url,url:url,originalOfficialProductUrl:safeExternalUrl(row.officialProductUrl||row.url),imageUrl:image,imageOriginalUrl:image,price:card.price==null?null:card.price,priceCurrency:text(card.priceCurrency),availability:card.availability==null?null:card.availability,supplierName:text(card.supplierName||supplier.name||row.destinationHost||'판매처 확인 필요'),supplierSiteUrl:supplierUrl,supplierTrustScore:Number(supplier.trustScore||ranking.sellerTrust||0),supplierEvidenceReady:!!(supplier.evidenceReady),researchStatus:researchStatus,runtimeValidation:runtimeValidation,inspectionComplete:!!(url&&image&&structuralReady&&productPageLive),productPageLive:productPageLive,slotDecision:decision,approvedPlacement:approved,primaryPlacement:approved,sectionAssignments:Array.isArray(row.proposedPlacements)?row.proposedPlacements:[],frontPublication:front,releaseEligible:row.releaseEligible===true,marketKeys:Array.isArray(row.marketKeys)?row.marketKeys:[],revenue:row.revenue||{},review:row.review||{},queueControl:queueControl,reasons:reasons,ranking:ranking,rankingScore:Number(ranking.finalScore||ranking.score||row.rankingScore||0),managementControl:Object.keys(management).length?management:{source:'candidate_ledger',administratorLocked:false,aiReclassificationAllowed:true},researchIdentity:text(row.researchIdentity),pipelineSource:text(row.pipelineSource),origin:text(row.origin),commerceCandidate:row.commerceCandidate||{},researchRegistration:row.researchRegistration||{},managementIntegrity:{structuralReady:structuralReady,reasons:Array.isArray(integrity.reasons)?integrity.reasons:[]},assignmentRepairRequired:assignmentRepairRequired,productEvidenceReviewRequired:productEvidenceReviewRequired,imageReviewIssue:productImageIssue(image),ledgerConsistency:row.ledgerConsistency||null,ledgerScopeConflict:row.ledgerScopeConflict===true,decisionSource:text(row.decisionSource),createdAt:text(row.createdAt||row.created_at),updatedAt:text(row.updatedAt||row.updated_at),publicPublication:false,automaticImport:false};
  }
    function candidateLedgerProductData(queueData){var rows=Array.isArray(queueData&&queueData.candidates)?queueData.candidates:[],products=rows.map(candidateLedgerProductRow).filter(function(row){var d=productDecision(row);return d!=='removed_from_list'&&d!=='removed'&&d!=='dismiss';}),summary={privateResearchQueueEligible:products.length,privateResearchQueueStaged:products.length,discovered:products.length,inspected:products.filter(function(row){return row.inspectionComplete===true;}).length,withImage:products.filter(function(row){return!!row.imageUrl;}).length,readyForAdminReview:products.filter(function(row){return!!row.productUrl;}).length,slotCandidates:products.filter(function(row){return productDecision(row)==='slot_candidate';}).length,held:products.filter(function(row){return productDecision(row)==='hold';}).length,rejected:products.filter(function(row){var d=productDecision(row);return d==='reject'||d==='purge';}).length};return{ok:true,candidateLedger:true,reportType:'igdc-candidate-ledger-product-control-snapshot',status:'candidate_ledger',scope:scopeSnapshot(),products:products,summary:summary,progress:{stage:'candidate_ledger',discovery:{done:0,total:0},inspection:{done:summary.inspected,total:products.length},privateQueue:{done:products.length,total:products.length,summary:{eligible:products.length,created:0,updated:0,preserved:products.length,failed:0}},resumable:false},pipeline:{version:'candidate-ledger-control-v2',canonicalSlotDecision:true,removedRowsHidden:true,automaticPrivateResearchStaging:false,automaticPublicPublication:false,nextGate:'administrator_product_selection_and_front_match'}};}

  function candidateLedgerViewActive(){return productRows.some(function(row){return row&&row.ledgerSource==='candidate';});}
  async function refreshCandidateLedgerProducts(options){
    latestOverviewLedgerComplete=false;
    options=options||{};var requested=scopeSnapshot('direct-management-ledger'),requestedKey=scopeKey(requested),all=[],seen={},offset=0,pages=0,pageSize=Math.max(25,Math.min(125,Number(options.pageSize||75))),partialError=null,source='direct_management_ledger';
    while(pages<250){
      if(scopeKey()!==requestedKey)throw new Error('상품 후보 원장 로딩 중 선택 범위가 변경됐습니다.');
      var page=null,lastError=null;
      for(var attempt=0;attempt<3&&!page;attempt++){
        try{var adaptiveSize=attempt===0?pageSize:(attempt===1?Math.max(35,Math.floor(pageSize*0.65)):25);page=await api(MANAGEMENT_LEDGER,'list','GET',{country:requested.country,region:requested.region,offset:offset,limit:adaptiveSize},null,18000);}
        catch(error){lastError=error;if(!transientResearchRequestError(error)||attempt>=2)break;await new Promise(function(resolve){setTimeout(resolve,500*(attempt+1));});}
      }
      if(!page){partialError=lastError||new Error('상품 관리 원장 전용 조회가 중단되었습니다.');break;}
      pages+=1;var rows=Array.isArray(page.candidates)?page.candidates:[];rows.forEach(function(row){var id=text(row&&row.candidateId||row&&row.id);if(!id||seen[id])return;seen[id]=true;all.push(row);});
      var pg=page.pagination||{},hasMore=pg.hasMore===true,next=Number(pg.nextOffset);
      // Preserve the complete visible administrator board while reading all
      // durable pages. A partial first page must NEVER deactivate the 20 sections.
      // Commit the new view only after the final cursor succeeds.
      if(!hasMore)break;if(!Number.isFinite(next)||next<=offset){partialError=new Error('상품 관리 원장 페이지 커서가 반복되었습니다.');break;}offset=next;
    }
    if(pages>=250&&hasMore&&!partialError)partialError=new Error('상품 후보 원장 페이지 제한에 도달해 전체 목록이 아직 완성되지 않았습니다.');
    /* Compatibility fallback only. The ordinary screen no longer depends on the
       large commerce-candidate-review staging/diagnostic path. */
    if(partialError||!all.length){
      try{
        // Legacy fallback is diagnostic only; never use it for publication,
        // deletion readback or to overwrite an already loaded full board.
        if(all.length||productRows.length||options.atomicLedgerRefresh===true)throw new Error('partial_durable_ledger_retained');
        var snap=await api(REVIEW,'management_snapshot','GET',{country:requested.country,region:requested.region,compact:'1',limit:3000},null,30000);
        if(scopeKey()!==requestedKey)throw new Error('상품 후보 원장 호환 복구 중 선택 범위가 변경됐습니다.');
        var fallbackRows=Array.isArray(snap&&snap.candidates)?snap.candidates:[];
        if(fallbackRows.length){all=fallbackRows;partialError=null;source='review_snapshot_fallback';}
      }catch(_fallbackError){}
    }
    if(!all.length&&partialError)throw partialError;
    var directComplete=!partialError&&source==='direct_management_ledger',q={ok:directComplete,candidates:all,pagination:{loadedPages:pages,loadedItems:all.length,complete:directComplete,source:source,partial:!directComplete,error:partialError?text(partialError&&partialError.message):null}};
    var data=candidateLedgerProductData(q);data.candidateRows=q.candidates.slice();data.pipeline=Object.assign({},data.pipeline||{},{directManagementLedger:true,ledgerLoadComplete:directComplete,loadedPages:pages,loadedItems:all.length,source:source,partialError:partialError?text(partialError&&partialError.message):null});
    // Product research may READ this ledger, but must never replace the visible
    // 20-section administrator board with a partial page or research result.
    if(partialError)throw partialError;
    // Keep a read-only ID-index of the entire durable page set, including rows
    // hidden from the ordinary candidate/section board after list removal.
    // This is NOT a rendering source and must only be replaced by a full scan.
    var canonicalById={};q.candidates.forEach(function(row){var id=text(row&&row.candidateId||row&&row.id);if(id)canonicalById[id]=candidateLedgerProductRow(row);});
    latestOverviewCanonicalById=canonicalById;
    latestOverviewLedgerComplete=directComplete;
    if(options.atomicLedgerRefresh===true&&!directComplete)throw new Error('현재 후보 원장 완전 조회 실패');
    if(options.frontSyncPreflight===true){
      // Private complete read only: do not recreate 20 sections, excluded tables,
      // latest research and all thumbnail cards just to prepare Front Match.
      productRows=Array.isArray(data.products)?data.products:[];return data;
    }
    if(options.readOnlyLedgerRefresh!==true){renderQueue(q.candidates);renderProducts(data.products||[]);}
    var currentStatus=text(lastProductJson&&lastProductJson.status),hasResearchState=!!lastProductJson&&currentStatus&&currentStatus!=='candidate_ledger'&&currentStatus!=='not_started',preserve=options.preserveResearchReport===true||(options.preserveResearchReport!==false&&hasResearchState);
    if(preserve){saveReviewSnapshot();if(partialError)throw partialError;return data;}lastProductJson=data;rememberReport('product',data);renderProductProgress(data);saveReviewSnapshot();if(partialError)throw partialError;return data;
  }
  function wireQueueControls(){
    var all=$('queueSelectAll');if(all)all.addEventListener('change',function(){var checked=all.checked,body=$('queueRows');if(body)Array.prototype.forEach.call(body.querySelectorAll('[data-queue-select]'),function(box){box.checked=checked;});syncQueueSelectionControls();});
    var body=$('queueRows');if(body){body.addEventListener('change',function(event){if(event.target&&event.target.matches('[data-queue-select]'))syncQueueSelectionControls();});body.addEventListener('click',function(event){var button=event.target&&event.target.closest?event.target.closest('[data-management-pager=\"queue\"] [data-page-delta]'):null;if(!button)return;event.preventDefault();queuePage=clampPage(queuePage+Number(button.getAttribute('data-page-delta')||0),queueCandidateRows.length,MANAGEMENT_PAGE_SIZE);renderQueueRows();});}
    if($('queueOpenInProductManagerBtn'))$('queueOpenInProductManagerBtn').addEventListener('click',openSelectedQueueProductsInManager);
    if($('queueSelectedAiPlaceBtn'))$('queueSelectedAiPlaceBtn').addEventListener('click',runSelectedQueueAiPlacement);
    if($('queueSelectedManualPlaceBtn'))$('queueSelectedManualPlaceBtn').addEventListener('click',runSelectedQueueManualPlacement);
    Array.prototype.forEach.call(document.querySelectorAll('[data-queue-bulk]'),function(button){button.addEventListener('click',function(){applyQueueAction(button.getAttribute('data-queue-bulk'));});});
  }
  function supplierActionLabel(action){return {keep:'계속 확인·유지',hold:'후보 제외·보류',unpin:'관리자 고정 해제',restore:'본 후보로 복원',dismiss:'목록 삭제·재수집 허용',purge:'URL 영구 제외',block:'도메인 차단',unblock:'차단 해제·보류 이동',remove_from_list:'목록에서만 제거'}[action]||action;}
  function supplierActionMessage(action,count){
    count=Number(count||0);
    if(action==='purge')return '선택 '+count+'건을 현재 목록에서 제거하고 같은 URL이 다시 수집되지 않도록 영구 제외 지문을 남깁니다. 계속하시겠습니까?';
    if(action==='block')return '선택 '+count+'건의 도메인을 차단합니다. 같은 도메인의 다른 후보도 현재 목록에서 빠지고 이후 리서치에서 다시 올라오지 않습니다. 계속하시겠습니까?';
    if(action==='dismiss')return '선택 '+count+'건을 현재 후보 제외 목록에서 삭제합니다. 차단 기록은 남기지 않아 다음 새 검색에서 다시 발견될 수 있습니다. 계속하시겠습니까?';
    if(action==='remove_from_list')return '선택 '+count+'건을 현재 화면 목록에서만 제거합니다. 기존 영구 제외·도메인 차단 기록은 그대로 유지됩니다. 계속하시겠습니까?';
    if(action==='unpin')return '선택 '+count+'건의 관리자 고정을 해제합니다. 현재 본 후보에는 남지만 다음 자동 리서치에서 고정 우선권은 유지되지 않습니다. 계속하시겠습니까?';
    return '';
  }
  function excludedOperationStatus(message,failed){
    var area=$('excludedManagementOperationStatus');
    if(area){area.textContent=message;area.setAttribute('data-failed',failed?'true':'false');}
  }
  async function applySupplierResearchAction(action,urlOrUrls){
    var urls=Array.from(new Set((Array.isArray(urlOrUrls)?urlOrUrls:[urlOrUrls]).map(safeExternalUrl).filter(Boolean)));
    if(!urls.length){show('처리할 공급업체 후보를 선택해 주세요.','warn');return;}
    if(supplierActionActive||!selectedCountry)return;
    var message=supplierActionMessage(action,urls.length);if(message&&!window.confirm(message))return;
    var frozen={country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'},completed=0,processed=0,missing=0,durableFailed=0,failures=[],lastData=null;
    var chunkSize=['purge','block','unblock','restore','dismiss','remove_from_list'].indexOf(action)>=0?1:4;
    supplierActionActive=true;['active','hold','blocked'].forEach(syncSupplierSelection);
    function progress(){
      var message='공급업체 '+supplierActionLabel(action)+' '+completed+'/'+urls.length+'건 · 성공 '+processed+' · 대상 없음 '+missing+' · 실패 '+durableFailed;
      if(stateEl)stateEl.textContent=message;
      if($('supplierHoldSelectedCount'))$('supplierHoldSelectedCount').textContent=message;
    }
    progress();excludedOperationStatus('공급업체 '+supplierActionLabel(action)+' 요청 중 · 선택 URL '+urls.length+'건',false);
    try{
      for(var offset=0;offset<urls.length;offset+=chunkSize){
        if(selectedCountry!==frozen.country||(selectedSubdivision||'NATIONWIDE')!==frozen.region){failures.push('관리 국가·지역 변경으로 중단');break;}
        var chunk=urls.slice(offset,offset+chunkSize),data=null,lastError=null;
        for(var attempt=0;attempt<3&&!data;attempt++){
          try{data=await api(CONTROL,'research_candidate_action','POST',{}, {countryCode:frozen.country,subdivisionCode:frozen.region,urls:chunk,decision:action,scopeAuthority:'administrator-selected',ignoreRequestGeo:true},60000);}
          catch(error){lastError=error;if(!transientResearchRequestError(error)||attempt>=2)break;await new Promise(function(resolve){setTimeout(resolve,700*(attempt+1));});}
        }
        completed+=chunk.length;
        var result=data&&data.candidateAction;
        if(!result){durableFailed+=chunk.length;failures.push(text(lastError&&lastError.message)||'서버에서 처리 결과를 받지 못했습니다.');progress();continue;}
        lastData=data;processed+=Number(result.processed||0);missing+=Number(result.notFound||0);durableFailed+=Number(result.durableFailed||0);
        (result.results||[]).forEach(function(item){if(item&&item.durableError)failures.push(text(item.durableError));else if(item&&item.status==='not_found')failures.push('공급업체 URL 원장 불일치: '+text(item.url).slice(0,110));});
        // A successful decision changes the displayed source list immediately; do not leave the selected row active until the last API page loads.
        var succeededUrls=(result.results||[]).filter(function(item){return item&&item.status!=='not_found'&&item.status!=='durable_failed'&&!item.durableError;}).map(function(item){return text(item.url);});
        if(succeededUrls.length&&['purge','block','remove_from_list','dismiss'].indexOf(action)>=0){
          var changed={};succeededUrls.forEach(function(url){changed[url.toLowerCase()]=true;});
          supplierHoldingRows=supplierHoldingRows.filter(function(row){return !changed[text(row.url||row.sourceCandidateUrl).toLowerCase()]&&(action!=='block'||!succeededUrls.some(function(url){try{return new URL(url).hostname===new URL(row.url||row.sourceCandidateUrl).hostname;}catch(_){return false;}}));});
          renderSupplierExcludedRows();
        }
        progress();
      }
      if(lastData&&selectedCountry===frozen.country&&(selectedSubdivision||'NATIONWIDE')===frozen.region){
        var serverState=lastData;
        try{
          var latestState=await api(CONTROL,'research_status','GET',{country:frozen.country,region:frozen.region},null,20000);
          if(latestState&&latestState.ok!==false&&Array.isArray(latestState.holdingCandidates))serverState=latestState;
          else failures.push('서버 목록 재조회 결과가 완전하지 않습니다.');
        }catch(refreshError){failures.push('서버 목록 재조회 실패: '+text(refreshError&&refreshError.message));}
        lastCountryPreview=serverState;lastCountryJson=serverState;renderResearchProgress(serverState);renderSummary(serverState,{candidates:serverState.candidates||[]},'공급업체 관리 반영');renderAi(serverState.candidates||[],serverState.holdingCandidates||[],serverState.blockedCandidates||[]);rememberReport('country',serverState);saveReviewSnapshot();
      }
      var explanation=action==='purge'?' · 보류 목록에서 제외, 차단 원장은 보존':action==='block'?' · 해당 도메인 보류 목록에서 제외, 차단 원장은 보존':action==='remove_from_list'?' · 재수집 정책은 기존 차단 기록을 따름':'';
      var output='공급업체 '+supplierActionLabel(action)+' · 요청 '+urls.length+'건 · 성공 '+processed+'건 · 대상 없음 '+missing+'건 · 실패 '+durableFailed+'건'+explanation+(failures.length?' · 오류: '+failures.slice(0,2).join(' / '):'');
      var stillVisible=urls.filter(function(url){return ['purge','block','remove_from_list','dismiss'].indexOf(action)>=0&&supplierHoldingRows.some(function(row){return text(row.url||row.sourceCandidateUrl).toLowerCase()===url.toLowerCase();});});if(stillVisible.length){output+=' · 재조회 후 남아 있는 URL '+stillVisible.length+'건';failures.push('supplier_post_write_visible');}
      excludedOperationStatus(output,!!(durableFailed||missing||failures.length));show(output,durableFailed||missing||failures.length?'warn':'ok');if(stateEl)stateEl.textContent=output;
    }catch(error){var message='공급업체 일괄 관리 요청 실패: '+text(error&&error.message);excludedOperationStatus(message,true);show(message,'fail');}
    finally{supplierActionActive=false;['active','hold','blocked'].forEach(syncSupplierSelection);}
  }
  async function registerManualSupplier(){
    if(!selectedCountry){show('먼저 등록할 국가·지역 범위를 선택해 주세요.','warn');return;}
    var name=text($('supplierManualName')&&$('supplierManualName').value),officialUrl=safeExternalUrl($('supplierManualOfficialUrl')&&$('supplierManualOfficialUrl').value),productPageUrl=safeExternalUrl($('supplierManualProductUrl')&&$('supplierManualProductUrl').value),supplierType=text($('supplierManualType')&&$('supplierManualType').value)||'responsible_seller',affiliateStageValue=text($('supplierManualAffiliateStage')&&$('supplierManualAffiliateStage').value)||'connection_required',trackingUrl=safeExternalUrl($('supplierManualTrackingUrl')&&$('supplierManualTrackingUrl').value),programId=text($('supplierManualProgramId')&&$('supplierManualProgramId').value),settlementMode=text($('supplierManualSettlementMode')&&$('supplierManualSettlementMode').value);
    if(!name||!officialUrl){show('업체명과 HTTPS 공식 업체 URL을 입력해 주세요.','warn');return;}
    if(!/^https:\/\//i.test(officialUrl)||(productPageUrl&&!/^https:\/\//i.test(productPageUrl))){show('관리자 직접 등록은 HTTPS 공식 주소만 사용할 수 있습니다.','warn');return;}
    var button=$('supplierManualRegisterBtn');if(button)button.disabled=true;
    try{
      var data=await api(CONTROL,'supplier_manual_register','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',name:name,officialUrl:officialUrl,productPageUrl:productPageUrl||null,supplierType:supplierType,affiliateSettlement:{stage:affiliateStageValue,counterparty:name,trackingUrl:trackingUrl||null,programId:programId||null,settlementMode:settlementMode||null,payoutBasisVerified:affiliateStageValue==='connection_required'?false:true,trackingVerified:!!trackingUrl,officialDestination:true,contractVerified:affiliateStageValue==='formal_partner'}});
      lastCountryPreview=data;lastCountryJson=data;renderResearchProgress(data);renderSummary(data,{candidates:data.candidates||[]},'관리자 직접 업체 등록·검증');renderAi(data.candidates||[],data.holdingCandidates||[],data.blockedCandidates||[]);rememberReport('country',data);var hasCandidates=Array.isArray(data.candidates)&&data.candidates.length>0,complete=data.status==='complete'||data.status==='committed';setButtonEnabled('runNowBtn',hasCandidates&&complete);setButtonEnabled('productResearchBtn',hasCandidates&&complete);setButtonEnabled('countryRunDownloadBtn',true);saveReviewSnapshot();
      if($('supplierManualName'))$('supplierManualName').value='';if($('supplierManualOfficialUrl'))$('supplierManualOfficialUrl').value='';if($('supplierManualProductUrl'))$('supplierManualProductUrl').value='';if($('supplierManualTrackingUrl'))$('supplierManualTrackingUrl').value='';if($('supplierManualProgramId'))$('supplierManualProgramId').value='';if($('supplierManualAffiliateStage'))$('supplierManualAffiliateStage').value='connection_required';if($('supplierManualSettlementMode'))$('supplierManualSettlementMode').value='';
      var result=data&&data.manualRegistration||{},affiliate=result.affiliateSettlement||{};show('관리자 직접 업체를 현재 범위에 등록·고정했습니다. 제휴 단계: '+affiliateStageLabel(affiliate.stage||'connection_required')+'.'+(result.verificationStatus?' 검증 상태: '+result.verificationStatus:'')+' 자동 공개나 상품 반입·정산 실행은 하지 않았습니다.','ok');
    }catch(e){show(text(e.message)||'관리자 직접 업체 등록에 실패했습니다.','fail');}
    finally{if(button)button.disabled=false;}
  }
  function wireSupplierControlButtons(root){
    root=root||document;if(root.getAttribute&&root.getAttribute('data-supplier-control-wired')==='1')return;if(root.setAttribute)root.setAttribute('data-supplier-control-wired','1');
    root.addEventListener('click',function(event){var button=event.target&&event.target.closest?event.target.closest('[data-supplier-control]'):null;if(!button||!root.contains(button))return;applySupplierResearchAction(button.getAttribute('data-supplier-control'),button.getAttribute('data-supplier-url'));});
  }
  function supplierSelectionConfig(kind){
    return {active:{all:'supplierActiveSelectAll',count:'supplierActiveSelectedCount'},hold:{all:'supplierHoldSelectAll',count:'supplierHoldSelectedCount'},blocked:{all:'supplierBlockedSelectAll',count:'supplierBlockedSelectedCount'}}[kind]||{};
  }
  function supplierSelectionBoxes(kind){return Array.prototype.slice.call(document.querySelectorAll('[data-supplier-select="'+kind+'"]'));}
  function supplierSelectedUrls(kind){return supplierSelectionBoxes(kind).filter(function(box){return box.checked;}).map(function(box){return safeExternalUrl(box.value);}).filter(Boolean);}
  function syncSupplierSelection(kind){
    var cfg=supplierSelectionConfig(kind),boxes=supplierSelectionBoxes(kind),selected=boxes.filter(function(box){return box.checked;}),busy=supplierActionActive===true;
    var all=cfg.all&&$(cfg.all),count=cfg.count&&$(cfg.count);if(all){all.checked=boxes.length>0&&selected.length===boxes.length;all.indeterminate=selected.length>0&&selected.length<boxes.length;all.disabled=busy||boxes.length===0;}boxes.forEach(function(box){box.disabled=busy;});if(count)count.textContent=(busy?'처리 중 · ':'선택 ')+selected.length+'건';
    Array.prototype.forEach.call(document.querySelectorAll('[data-supplier-bulk-scope="'+kind+'"]'),function(button){button.disabled=busy||selected.length===0;});
  }
  function wireSupplierSelectionControls(root){
    root=root||document;if(root.getAttribute&&root.getAttribute('data-supplier-selection-wired')==='1')return;if(root.setAttribute)root.setAttribute('data-supplier-selection-wired','1');
    root.addEventListener('change',function(event){var all=event.target&&event.target.getAttribute&&event.target.getAttribute('data-supplier-select-all'),kind=event.target&&event.target.getAttribute&&event.target.getAttribute('data-supplier-select');if(all){supplierSelectionBoxes(all).forEach(function(box){box.checked=event.target.checked;});syncSupplierSelection(all);}else if(kind)syncSupplierSelection(kind);});
    root.addEventListener('click',function(event){var move=event.target&&event.target.closest?event.target.closest('[data-management-pager="supplier_active"] [data-page-delta]'):null;
      if(!move||!root.contains(move))return;event.preventDefault();event.stopPropagation();
      if(supplierActionActive)return;
      supplierActivePage=clampPage(supplierActivePage+Number(move.getAttribute('data-page-delta')||0),supplierActiveRows.length,MANAGEMENT_PAGE_SIZE);
      renderSupplierActiveRows();var heading=$('aiPanel');if(heading&&heading.scrollIntoView)heading.scrollIntoView({block:'start',behavior:'smooth'});
    });
    root.addEventListener('click',function(event){var button=event.target&&event.target.closest?event.target.closest('[data-supplier-bulk]'):null;if(!button||!root.contains(button))return;var kind=button.getAttribute('data-supplier-bulk-scope'),urls=supplierSelectedUrls(kind);if(!urls.length){show('먼저 처리할 후보를 선택해 주세요.','warn');return;}applySupplierResearchAction(button.getAttribute('data-supplier-bulk'),urls);});
  }
  function closeSupplierControlQueue(){var panel=$('supplierControlQueue');if(panel&&typeof panel.open==='boolean')panel.open=false;var outer=$('excludedLedgerPanel');if(outer&&typeof outer.open==='boolean'){outer.open=false;clearHeavyPanel(outer);}syncSupplierControlToggleLabel();syncManagementToggleLabels();}
  function syncSupplierControlToggleLabel(){var panel=$('supplierControlQueue'),label=$('supplierControlActionLabel');if(label)label.textContent=panel&&panel.open?'목록 닫기':'목록 펼치기';}
  function renderSupplierControlQueues(holdingRows,blockedRows){
    var isArchivedSuppression=function(row){var d=text(row&&row.operatorDecision).toLowerCase(),reason=text(row&&row.holdReason).toLowerCase();return d==='purge'||d==='block'||reason==='operator_url_block'||reason==='operator_domain_block';};
    var holding=Array.isArray(holdingRows)?holdingRows:[],blocked=Array.isArray(blockedRows)?blockedRows:[];
    supplierHoldingRows=holding.filter(function(row){return !isArchivedSuppression(row);});
    var mergedBlocked=blocked.concat(holding.filter(isArchivedSuppression)),seenBlocked={};
    supplierBlockedRows=mergedBlocked.filter(function(row){
      var key=text(row&&row.url||row&&row.sourceCandidateUrl).toLowerCase();
      if(!key||seenBlocked[key])return false;seenBlocked[key]=true;return true;
    });var currentScope=scopeKey(),sameScope=supplierControlScopeKey===currentScope;supplierControlScopeKey=currentScope;
    if($('supplierControlToggleLabel'))$('supplierControlToggleLabel').textContent='후보 제외 업체 목록 · 처리 대상 '+supplierHoldingRows.length+'건 (차단 기록 '+supplierBlockedRows.length+'건은 별도 보관)';if(!sameScope&&$('supplierControlQueue'))$('supplierControlQueue').open=false;syncExcludedLedgerCounts();if($('excludedLedgerPanel')&&$('excludedLedgerPanel').open&&$('supplierControlQueue')&&$('supplierControlQueue').open)renderSupplierExcludedRows();
  }

  function renderSupplierExcludedRows(){
    var holdBody=$('supplierHoldRows'),blockBody=$('supplierBlockedRows');if(!holdBody||!blockBody)return;
    holdBody.innerHTML=supplierHoldingRows.length?supplierHoldingRows.map(function(row,index){var url=safeExternalUrl(row.url||row.sourceCandidateUrl),reason=row.holdReason||'추가 확인 필요',title=row.title||row.host||'후보명 확인 필요';return'<tr data-review-anchor="supplier-hold-'+esc(reviewAnchorToken(url||title,index))+'"><td class="supplier-number">'+esc(index+1)+'</td><td class="supplier-select-cell"><input type="checkbox" data-supplier-select="hold" value="'+esc(url)+'" aria-label="후보 제외 업체 '+esc(index+1)+' 선택" '+(url?'':'disabled')+'></td><td>'+(url?externalReviewAnchor(url,title,'supplier-primary-link'):'<strong>'+esc(title)+'</strong>')+'<br><span class="small mono">'+esc(url||'-')+'</span></td><td>'+esc(reason)+'</td><td>'+esc(row.supplierType||'research_reference')+'</td></tr>';}).join(''):'<tr><td colspan="5" class="small">현재 후보 제외 업체 목록이 비어 있습니다.</td></tr>';
    blockBody.innerHTML=supplierBlockedRows.length?supplierBlockedRows.map(function(row,index){var url=safeExternalUrl(row.url||row.sourceCandidateUrl),reason=row.holdReason||'관리자 차단',title=row.title||row.host||'차단 후보';return'<tr data-review-anchor="supplier-blocked-'+esc(reviewAnchorToken(url||title,index))+'"><td class="supplier-number">'+esc(index+1)+'</td><td class="supplier-select-cell"><input type="checkbox" data-supplier-select="blocked" value="'+esc(url)+'" aria-label="차단 업체 '+esc(index+1)+' 선택" '+(url?'':'disabled')+'></td><td>'+(url?externalReviewAnchor(url,title,'supplier-primary-link'):'<strong>'+esc(title)+'</strong>')+'<br><span class="small mono">'+esc(url||'-')+'</span></td><td>'+esc(row.host||'-')+'</td><td>'+esc(reason)+'</td></tr>';}).join(''):'<tr><td colspan="5" class="small">현재 차단된 공급업체 URL·도메인이 없습니다.</td></tr>';
    wireSupplierSelectionControls($('supplierControlQueue'));syncSupplierSelection('hold');syncSupplierSelection('blocked');
  }
  var supplierActivePage=0,supplierActivePageScope="";
  function renderSupplierActiveRows(){
    var body=$('aiRows');if(!body)return;var rows=supplierActiveRows;
    supplierActivePage=clampPage(supplierActivePage,rows.length,MANAGEMENT_PAGE_SIZE);
    var start=supplierActivePage*MANAGEMENT_PAGE_SIZE,visible=rows.slice(start,start+MANAGEMENT_PAGE_SIZE);
    body.innerHTML=visible.length?visible.map(function(c,pageIndex){var index=start+pageIndex;var ai=c.ai||c||{},trust=c.trust||{},supplier=c.supplier||{type:c.supplierType},e=c.evidence||{};function yes(v,label){return'<span class="pill '+(v?'good':'warn')+'">'+esc(label)+' '+(v?'확인':'미확인')+'</span> ';}function listBlock(label,values){values=Array.isArray(values)?values:[];return'<div class="supplier-ai-box"><strong>'+esc(label)+'</strong><div class="small">'+(values.length?values.map(function(x){return'· '+esc(x);}).join('<br>'):'-')+'</div></div>';}var evidence=yes(e.official,'공식')+yes(e.responsibleEntity,'책임주체')+yes(e.directSales,'직판')+yes(e.payment,'결제')+yes(e.shipping,'배송')+yes(e.returns,'반품')+yes(e.refund,'환불')+yes(e.service,'고객지원');var score=Number(ai.trustScore!=null?ai.trustScore:(ai.score!=null?ai.score:(trust.trustScore||0))),rating=Number(ai.rating10||trust.rating10||trustRating10(score)),rank=ai.rank||c.rank||trust.rank||index+1;var recommendation=ai.recommendationLabel||trust.recommendationLabel||ai.recommendation||trust.recommendation||'보류 권고',confidence=Number(ai.assessmentConfidence||trust.assessmentConfidence||0),mode=ai.assessmentMode||trust.assessmentMode||'deterministic_fallback';var sourceLabel=mode==='openai_grounded'?'AI 추천':'규칙기반 임시추천',summary=ai.aiSummary||trust.aiSummary||ai.reason||'',strengths=Array.isArray(ai.strengths)?ai.strengths:(Array.isArray(trust.strengths)?trust.strengths:[]),concerns=Array.isArray(ai.concerns)?ai.concerns:(Array.isArray(trust.concerns)?trust.concerns:[]),nextChecks=Array.isArray(ai.nextChecks)?ai.nextChecks:(Array.isArray(trust.nextChecks)?trust.nextChecks:[]),missing=Array.isArray(c.missingEvidence)?c.missingEvidence:(Array.isArray(ai.missingEvidence)?ai.missingEvidence:[]);var detail='<div class="supplier-ai-head"><strong>'+esc(sourceLabel)+': '+esc(recommendation)+'</strong><span class="pill '+(rating>=8?'good':'warn')+'">신뢰 '+esc(rating)+'/10</span><span class="small">'+esc(score)+'/100 · 순위 '+esc(rank)+(confidence?' · 판단확신 '+esc(confidence)+'%':'')+'</span></div><div class="small supplier-ai-summary">'+esc(summary||'확인 근거를 보완해야 합니다.')+'</div><div class="supplier-ai-grid">'+listBlock('강점',strengths)+listBlock('주의',concerns)+listBlock('다음 확인',nextChecks)+listBlock('누락 증빙',missing)+'</div>';var supplierUrl=safeExternalUrl(c.url||supplier.officialUrl),supplierTitle=text(c.title||c.id||'업체명 확인 필요'),productPageUrl=safeExternalUrl(c.productPageUrl||c.sourceCandidateUrl),manual=c.adminPinned===true||c.manualPinned===true||c.manualRegistered===true;var links=supplierUrl?externalReviewAnchor(supplierUrl,supplierTitle,'supplier-primary-link')+'<br>'+externalReviewAnchor(supplierUrl,'업체·원본 사이트 열기','supplier-review-link')+'<br>'+externalReviewAnchor(supplierUrl,supplierUrl,'supplier-url mono'):'<strong>'+esc(supplierTitle)+'</strong><br><span class="small">확인 가능한 업체 사이트 링크 없음</span>';if(productPageUrl&&productPageUrl!==supplierUrl)links+='<br>'+externalReviewAnchor(productPageUrl,manual?'지정 상품 페이지 열기':'발견 원본 페이지 열기','supplier-review-link');var affiliate=c.affiliateSettlement||{},affiliateStageValue=affiliateStage(c),state='<div class="supplier-meta-block"><strong>'+esc(supplier.type||c.kind||'supplier')+'</strong> <span class="pill info">'+esc(c.status||c.persistence||'research_preview')+'</span> '+(manual?'<span class="pill manual">관리자 직접 등록·고정</span>':'')+' <span class="pill affiliate-stage-pill '+affiliateStageClass(affiliateStageValue)+'">'+esc(affiliateStageLabel(affiliateStageValue))+'</span><div class="small">'+esc((supplier.detectedCountry||c.targetCountry||'-')+' / '+(supplier.detectedRegion||c.targetRegion||'NATIONWIDE'))+' · '+esc(c.updatedAt||c.createdAt||ai.assessedAt||trust.assessedAt||'-')+'</div></div>';var supplierCell='<div class="supplier-card-head"><div>'+links+'</div></div><div class="supplier-evidence-row">'+evidence+'</div><div class="small supplier-responsibility-note">상품 자동 공개 없음 · 선정·검증된 본 후보에서만 별도 상품 리서치 · 거래는 공급업체에서 직접 진행</div>'+state;var checkbox='<input type="checkbox" data-supplier-select="active" value="'+esc(supplierUrl)+'" aria-label="본 후보 '+esc(index+1)+' 선택" '+(supplierUrl?'':'disabled')+'>';return'<tr data-review-anchor="supplier-'+esc((c.id||c.candidateId||supplierTitle).replace(/[^0-9A-Za-z가-힣_-]+/g,'-').slice(0,48))+'"><td class="supplier-number">'+esc(index+1)+'</td><td class="supplier-select-cell">'+checkbox+'</td><td>'+supplierCell+'</td><td>'+detail+'</td></tr>';}).join(''):'<tr><td colspan="4" class="small">현재 본 후보 목록이 비어 있습니다.</td></tr>';
    var pager=$('supplierActivePager');if(pager)pager.innerHTML=pagerMarkup('supplier_active',scopeKey(),supplierActivePage,rows.length,MANAGEMENT_PAGE_SIZE);
    wireSupplierSelectionControls($('aiPanel'));syncSupplierSelection('active');
  }
  function renderAi(rows,holdingRows,blockedRows){
    supplierActiveRows=Array.isArray(rows)?rows:[];supplierHoldingRows=Array.isArray(holdingRows)?holdingRows:[];supplierBlockedRows=Array.isArray(blockedRows)?blockedRows:[];var panel=$('aiPanel'),currentScope=scopeKey(),sameScope=supplierControlScopeKey===currentScope;if(supplierActivePageScope!==currentScope){supplierActivePage=0;supplierActivePageScope=currentScope;}if(panel){panel.classList.remove('hidden');if(!sameScope)panel.open=false;}if($('aiSummary'))$('aiSummary').textContent=supplierActiveRows.length+'건';renderSupplierControlQueues(supplierHoldingRows,supplierBlockedRows);if(panel&&panel.open)renderSupplierActiveRows();else if($('aiRows'))$('aiRows').innerHTML='';if($('supplierManualScopeLabel'))$('supplierManualScopeLabel').textContent='현재 선택 범위: '+scopeName();syncManagementToggleLabels();
  }


  function safeExternalUrl(value){try{var u=new URL(text(value));if((u.protocol!=='https:'&&u.protocol!=='http:')||u.username||u.password||!u.hostname)return'';return u.toString();}catch(_e){return'';}}

  // URL display safety is independent of durable product identity. Do not rewrite
  // the stored URL merely because a seller temporarily denies access.
  function productAccessChallengeUrl(value){
    try{var u=new URL(text(value)),path=u.pathname.toLowerCase();
      return /(?:^|\/)(?:challenge|captcha|access[-_]denied|bot[-_]check|security[-_]check)(?:\/|$)/.test(path)||/\/cdn-cgi\/challenge-platform(?:\/|$)/.test(path)||((u.hostname.toLowerCase()==="verify.trip.com")&&/\/static\/tripverify\.html$/i.test(path));
    }catch(_e){return false;}
  }
  // A seller/home/verification link must never be advertised as an individual
  // product page. Conservative exclusions; uncertain deep URLs stay REVIEWABLE
  // through their original source but are not auto-promoted to the front.
  function productCollectionOrProviderUrl(value){
    var url=safeExternalUrl(value);if(!url)return true;
    try{var u=new URL(url),path=u.pathname.toLowerCase().replace(/\/+$/,'')||'/',host=u.hostname.toLowerCase();
      if(path==='/'||/(?:^|\/)(?:login|signin|signup|register|account|captcha|verify|verification|challenge)(?:\/|$)/.test(path))return true;
      if(/(?:^|\/)(?:category|categories|collections?|catalog|search|results|goods_list|products_list|all-cities|all-hotels|all-activities|host|hosts)(?:\/|$)/.test(path))return true;
      if(/(?:^|\/)(?:hotel|hotels|tour|tours|activity|activities|product|products|goods)(?:\/(?:all|all-cities|all-hotels|search|list|deals|offers|best|featured|index))?$/.test(path))return true;
      // Travel inventory may have a generic landing link with product-looking
      // query parameters. Host directories are not bookable product detail URLs.
      if(/(?:^|\/)hosts?\/[^/]+$/.test(path) || /(?:^|\/)hotels?\/all-[^/]+$/.test(path))return true;
      if(/(?:^|\/)(?:insurance|flight|flights|deals|offers)$/.test(path))return true;
      if(/trip\.com$/.test(host)&&/(?:^|\/)(?:all-cities|all-hotels|hotels?\/all-cities)(?:\/|$)/.test(path))return true;
      return false;
    }catch(_e){return true;}
  }
  function safeProductDetailUrl(value){var url=safeExternalUrl(value);return url&&!productAccessChallengeUrl(url)&&!productCollectionOrProviderUrl(url)?url:'';}
  function safeExternalImageUrl(value){
    var url=safeExternalUrl(value);if(!/^https:\/\//i.test(url))return '';
    try{var u=new URL(url),path=decodeURIComponent(u.pathname).toLowerCase(),asset=(path+' '+u.search).toLowerCase();
      // Merchant search/cart/navigation assets are not product photographs.
      // Applies to every management country, not a Vitatra domain blacklist.
      if(/\.(?:ico|svg|pdf|css|js|json)(?:$|[?#])/i.test(path))return '';
      if(/(?:\/(?:shop_assets|assets|static|common)\/img\/btn\/|\/(?:images?|img)\/(?:btn|buttons|icons)\/|\/(?:common|shop_assets)\/btn\/|(?:^|[\/_\-.])(?:btn[_-](?:h[_-]?sch|keep[_-]?shopping|search|top[_-]?search)|favicon|logo|logotype|sprite|spinner|placeholder|no[_-]?image|site[_-]?header|shopping[_-]?cart|search[_-]?icon)(?:[\/_\-.]|$)|\/category\/overimg\d*\.)/i.test(asset))return '';
      return url;
    }catch(_e){return '';}
  }
  function researchCardImageSources(row){
    var r=row||{},card=r.productCard||{},candidates=[r.imageUrl,r.imageOriginalUrl,r.productImageUrl,r.productImage,r.thumbnailUrl,r.thumbnail_url,r.image,card.imageUrl,card.thumbnailUrl,card.image,card.thumb,r.ogImage,r.ogImageUrl],out=[],seen={};
    if(Array.isArray(r.images))candidates=candidates.concat(r.images.map(function(v){return typeof v==='string'?v:(v&&(v.url||v.src||v.imageUrl));}));
    candidates.forEach(function(v){var url=safeExternalImageUrl(v);if(!url||seen[url])return;try{var u=new URL(url),name=(u.pathname||'').toLowerCase();
      if(/(?:^|[\/_\-.])(?:favicon|logo|logotype|placeholder|no[_-]?image|spinner|loading|icon|sprite|banner|site[_-]?header|profile|avatar)(?:[\/_\-.]|$)/.test(name)||/\.(?:svg|ico|pdf|css|js)(?:$|\?)/.test(name))return;
      if(/(?:captcha|tripverify|challenge-platform)/.test(name))return;
    }catch(_e){return;}seen[url]=true;out.push(url);});return out.slice(0,8);
  }
  function researchCardImage(row){return researchCardImageSources(row)[0]||''; }
  function genericOrChallengeResearchTitle(value){
    var label=text(value).toLowerCase().replace(/\s+/g,' ').trim();
    return !label||/^(?:상품명 확인 중|상품 확인 중|all hotels|all activities|all cities|keep shopping|trip\.com[- ]verification|captcha|verification required|are you human|access denied|쇼핑몰|상품 목록|로그인|회원가입)$/i.test(label)||/(?:^|\s)(?:captcha|robot check|security verification)(?:\s|$)/i.test(label);
  }
  function confirmedRemovedProductEvidence(row){
    var r=row||{},status=text(r.researchStatus||r.verificationStatus).toLowerCase(),risk=r.riskAssessment||{};
    // An image failure, unavailable price, HTTP 403/429, seller bot challenge,
    // and generic seller redirect alone are NOT proof that the product vanished.
    return r.inspectionComplete===true&&(status==='http_404'||status==='http_410'||status==='product_page_explicit_invalid_message')&&
      (r.productPageLive===false||risk.explicitUnavailable===true||status==='http_410');
  }
  function reviewUrlLabel(value){var url=safeExternalUrl(value);if(!url)return '원본 상품 URL 미확보';try{var u=new URL(url);Array.from(u.searchParams.keys()).forEach(function(k){if(/^(?:access[_-]?token|refresh[_-]?token|token|auth|session(?:id)?|sid|signature|sig|api[_-]?key|jwt)$/i.test(k))u.searchParams.set(k,'[redacted]');});return u.toString().slice(0,420);}catch(_e){return '원본 상품 URL 확인 필요';}}

  function safeExternalVideoUrl(value){var url=safeExternalUrl(value);return /^https:\/\//i.test(url)?url:'';}
  function externalReviewAnchor(url,label,className){var safe=safeExternalUrl(url);if(!safe)return'';return'<a href="'+esc(safe)+'" target="_top" class="'+esc(className||'')+'" data-review-link="1" rel="noreferrer external nofollow">'+esc(label)+'</a>';}
  function reviewAnchorToken(value,index){var token=text(value).replace(/[^0-9A-Za-z가-힣_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,72);return token||('row-'+String(Number(index)||0));}
  function reviewDetailPath(target){var out=[],node=target;while(node&&node!==document.body){if(node.tagName==='DETAILS'){var key=node.id||node.getAttribute('data-product-group')||node.getAttribute('data-heavy-panel')||'';if(key)out.unshift(key);}node=node.parentElement;}return out.slice(-12);}
  function reviewDetailElement(key){var wanted=text(key);if(!wanted)return null;var byId=document.getElementById(wanted);if(byId&&byId.tagName==='DETAILS')return byId;var rows=document.querySelectorAll('details');for(var i=0;i<rows.length;i++){if(rows[i].getAttribute('data-product-group')===wanted||rows[i].getAttribute('data-heavy-panel')===wanted)return rows[i];}return null;}
  function reviewAnchorElement(value){var wanted=text(value);if(!wanted)return null;var rows=document.querySelectorAll('[data-review-anchor]');for(var i=0;i<rows.length;i++){if(rows[i].getAttribute('data-review-anchor')===wanted)return rows[i];}return null;}
  function reviewReturnValue(){var row=null;try{row=parseJson(sessionStorage.getItem(REVIEW_RETURN_KEY)||'');}catch(_e){}if(!row||row.path!==(location.pathname+location.search)||Date.now()-Number(row.at||0)>21600000)return null;return row;}
  function compactProductSnapshot(data){if(!data||typeof data!=='object')return null;return{ok:true,reportType:data.reportType||'igdc-country-product-reference-persisted-research',version:data.version||'',jobId:data.jobId||null,jobVersion:data.jobVersion||'',needsRefresh:data.needsRefresh===true,status:data.status||'not_started',startedAt:data.startedAt||null,finishedAt:data.finishedAt||null,updatedAt:data.updatedAt||null,scope:data.scope||scopeSnapshot('review-return-cache'),safety:data.safety||{},progress:data.progress||{},summary:data.summary||{},pipeline:data.pipeline||{},sectionQueues:data.sectionQueues||{},products:Array.isArray(data.products)?data.products.slice(0,600):[],trace:Array.isArray(data.trace)?data.trace.slice(-30):[],errors:Array.isArray(data.errors)?data.errors.slice(-30):[],lastError:data.lastError||null};}
  async function loadProductResearchCompact(country,region){return api(CONTROL,'product_research_status','GET',{country:country,region:region||'NATIONWIDE',compact:'1'});}
  async function loadProductResearchPaged(country,region,options){
    options=options||{};var pageSize=Math.max(50,Math.min(200,Number(options.pageSize||200))),offset=0,pages=0,merged=null,rows=[],latest=[],seen={},latestSeen={},state=options.state||null,maxPages=Math.max(1,Math.min(250,Number(options.maxPages||250))),partialError=null;
    while(pages<maxPages){
      var page=null,pageError=null;
      for(var attempt=0;attempt<3&&!page;attempt++){
        try{page=await api(CONTROL,'product_research_status','GET',{country:country,region:region||'NATIONWIDE',fast:'page:'+offset+':'+pageSize});}
        catch(loadError){pageError=loadError;if(attempt<2)await new Promise(function(resolve){setTimeout(resolve,500*(attempt+1));});}
      }
      if(!page){partialError=pageError;if(!merged)throw pageError||new Error('상품 관리 목록을 분할 로딩하지 못했습니다.');if(state)state.textContent=(options.label||'상품 관리 목록')+' '+rows.length+'건까지 안전 로딩 · 다음 묶음은 일시 중단됐습니다.';break;}
      if(!merged)merged=page;pages+=1;
      var pageRows=Array.isArray(page.products)?page.products:[];
      pageRows.forEach(function(row){var key=text(row&&row.id)||text(row&&row.productUrl)||text(row&&row.url);if(!key||seen[key])return;seen[key]=true;rows.push(row);});
      (Array.isArray(page.latestProducts)?page.latestProducts:[]).forEach(function(row){var key=text(row&&row.id)||text(row&&row.productUrl)||text(row&&row.url);if(!key||latestSeen[key])return;latestSeen[key]=true;latest.push(row);});
      var pg=page.pagination||{},total=Number(pg.total||rows.length);if(state)state.textContent=(options.label||'상품 관리 목록')+' '+rows.length+'/'+total+'건 분할 로딩 · '+pageSize+'건 단위';
      if(pg.hasMore!==true)break;if(pg.nextOffset==null||Number(pg.nextOffset)<=offset){partialError=new Error("상품 관리 페이지 커서가 누락되거나 반복됐습니다.");break;}offset=Number(pg.nextOffset);await new Promise(function(resolve){setTimeout(resolve,180);});
    }
    if(!merged)merged={ok:true,status:'not_started',products:[],latestProducts:[],summary:{},progress:{}};
    merged=Object.assign({},merged,{products:rows,latestProducts:latest,pagination:Object.assign({},merged.pagination||{},{loadedPages:pages,loadedItems:rows.length,complete:!partialError&&(merged.pagination&&merged.pagination.total!=null?rows.length>=Number(merged.pagination.total||0):true),partial:!!partialError,error:partialError?text(partialError&&partialError.message):null})});
    return merged;
  }
  async function loadLatestResearchPaged(country,region,options){
    options=options||{};var pageSize=Math.max(50,Math.min(200,Number(options.pageSize||200))),offset=0,pages=0,rows=[],seen={},state=options.state||null,maxPages=Math.max(1,Math.min(250,Number(options.maxPages||250))),partialError=null,lastPage=null,reachedEnd=false;
    while(pages<maxPages){
      var page=null,pageError=null;
      for(var attempt=0;attempt<3&&!page;attempt++){
        try{page=await api(CONTROL,'product_research_status','GET',{country:country,region:region||'NATIONWIDE',fast:'latest:'+offset+':'+pageSize});}
        catch(loadError){pageError=loadError;if(attempt<2)await new Promise(function(resolve){setTimeout(resolve,450*(attempt+1));});}
      }
      if(!page){partialError=pageError;if(!rows.length&&options.preserveOnFailure!==true)throw pageError||new Error('최신 상품 리서치 목록을 분할 로딩하지 못했습니다.');if(state)state.textContent=(options.label||'최신 상품 리서치 목록')+' '+rows.length+'건까지 안전 로딩 · 다음 묶음 응답은 보류했습니다.';break;}
      lastPage=page;pages+=1;
      var pageRows=Array.isArray(page.latestProducts)?page.latestProducts:[];
      pageRows.forEach(function(row){var key=latestProductKey(row);if(!key||seen[key])return;seen[key]=true;rows.push(row);});
      var pg=page.pagination||{},total=Number(pg.rawTotal==null?pg.total:pg.rawTotal)||0;if(state)state.textContent=(options.label||'최신 상품 리서치 목록')+' 원천 '+total+'건 중 잔여 '+rows.length+'건 확인 중 · '+pageSize+'건 단위';
      if(pg.hasMore!==true){reachedEnd=true;break;}
      if(pg.nextOffset==null){partialError=new Error('최신 목록의 다음 페이지 커서가 누락됐습니다.');break;}
      var next=Number(pg.nextOffset);if(!Number.isFinite(next)||next<=offset){partialError=new Error('최신 목록의 페이지 커서가 반복됐습니다.');break;}offset=next;await new Promise(function(resolve){setTimeout(resolve,180);});
    }
    var truncated=!reachedEnd;return{rows:rows,pages:pages,partial:!!partialError||truncated,error:partialError?text(partialError&&partialError.message):(truncated?"latest_research_page_limit_reached":null),status:lastPage||null,complete:!partialError&&reachedEnd,visibleLoaded:rows.length,rawResearchTotal:Number(lastPage&&lastPage.pagination&&lastPage.pagination.rawTotal||0)};
  }
  async function refreshLatestResearchRows(country,region,options){
    options=options||{};var previous=latestProductRows.slice(),loaded=null;
    try{loaded=await loadLatestResearchPaged(country,region,Object.assign({preserveOnFailure:true},options));}
    catch(error){if(options.throwOnFailure===true)throw error;return{rows:previous,partial:true,error:text(error&&error.message),complete:false};}
    if(scopeKey()!==scopeKey({country:country,region:region||'NATIONWIDE'}))return{rows:previous,partial:true,error:'scope_changed',complete:false};
    if(loaded)latestProductRowsComplete=loaded.complete===true;
    if(loaded&&Array.isArray(loaded.rows)&&(loaded.rows.length||loaded.complete===true||!previous.length))latestProductRows=loaded.rows;
    var status=loaded&&loaded.status||{};lastProductJson=Object.assign({},lastProductJson||{},status,{products:productRows,latestProducts:latestProductRows});
    renderProductProgress(lastProductJson);rememberReport('product',lastProductJson);saveReviewSnapshot();if($('productCandidatePanel')&&$('productCandidatePanel').open)renderLatestResearchCandidateGroup();return Object.assign({},loaded,{rows:latestProductRows});
  }

  function mergeCompactProductStatus(statusData){return Object.assign({},lastProductJson||{},statusData||{},{products:productRows,latestProducts:latestProductRows});}
  function compactCountrySnapshot(data){if(!data||typeof data!=='object')return null;return{ok:true,reportType:data.reportType||'igdc-country-responsible-supplier-persisted-research',version:data.version||'',jobId:data.jobId||null,status:data.status||'not_started',startedAt:data.startedAt||null,finishedAt:data.finishedAt||null,updatedAt:data.updatedAt||null,scope:data.scope||scopeSnapshot('review-return-cache'),progress:data.progress||{},summary:data.summary||{},candidates:Array.isArray(data.candidates)?data.candidates.slice(0,80):[],holdingCandidates:Array.isArray(data.holdingCandidates)?data.holdingCandidates.slice(0,160):[],blockedCandidates:Array.isArray(data.blockedCandidates)?data.blockedCandidates.slice(0,160):[],blockedSupplierKeys:Array.isArray(data.blockedSupplierKeys)?data.blockedSupplierKeys.slice(0,300):[],lastError:data.lastError||null};}
  function compactScopeCache(data){if(!data||typeof data!=='object')return null;return{scope:data.scope||scopeSnapshot('review-return-cache'),scopeData:data.scopeData?{candidates:Array.isArray(data.scopeData.candidates)?data.scopeData.candidates.slice(0,80):[],marketSignals:data.scopeData.marketSignals||{},effective:data.scopeData.effective||{}}:null,summaryData:data.summaryData||null,queueData:data.queueData?{candidates:Array.isArray(data.queueData.candidates)?data.queueData.candidates.slice(0,120):[]}:null,researchData:compactCountrySnapshot(data.researchData),productData:compactProductSnapshot(data.productData)};}
  function openDetailKeys(){return Array.prototype.slice.call(document.querySelectorAll('details[open]')).map(function(el){return el.id||el.getAttribute('data-product-group')||el.getAttribute('data-heavy-panel')||'';}).filter(Boolean).slice(0,80);}
  function sessionMemoryHost(){var rows=sources();for(var i=rows.length-1;i>=0;i--){try{void rows[i].location.href;return rows[i];}catch(_e){}}return window;}
  function sessionMemoryRead(){try{var row=sessionMemoryHost().__IGDC_COUNTRY_CONTROL_RUNTIME_V1__;return row&&row.schema==='igdc-country-control-runtime.v1'&&Date.now()-Number(row.savedAt||0)<=21600000?row:null;}catch(_e){return null;}}
  function sessionMemoryWrite(snapshot){
    try{sessionMemoryHost().__IGDC_COUNTRY_CONTROL_RUNTIME_V1__={schema:'igdc-country-control-runtime.v1',savedAt:Date.now(),path:location.pathname+location.search,scope:snapshot.scope,ui:snapshot,scopeCache:lastScopeCache,country:lastCountryPreview||lastCountryJson||null,product:lastProductJson||null,signal:lastSignalReport||null,auditKind:activeScopeAudit||'',audit:lastScopeAuditJson||null};}catch(_e){}
  }
  function sessionMemoryClear(){try{delete sessionMemoryHost().__IGDC_COUNTRY_CONTROL_RUNTIME_V1__;}catch(_e){}}
  function reviewDataCachePayload(snapshot){
    var scopeCache=compactScopeCache(lastScopeCache);
    if(scopeCache){scopeCache.productData=null;scopeCache.researchData=null;}
    return{schema:'igdc-country-control-review-data.v1',savedAt:Date.now(),path:location.pathname+location.search,scope:snapshot.scope,scopeCache:scopeCache,country:compactCountrySnapshot(lastCountryPreview||lastCountryJson),product:compactProductSnapshot(lastProductJson),signal:lastSignalReport||null,auditKind:activeScopeAudit||'',audit:lastScopeAuditJson||null};
  }
  function saveReviewDataCache(snapshot){
    try{
      var payload=reviewDataCachePayload(snapshot),raw=JSON.stringify(payload);
      if(raw.length>4200000){payload.audit=null;payload.scopeCache=null;raw=JSON.stringify(payload);}
      if(raw.length>4200000){payload.signal=null;payload.country=null;raw=JSON.stringify(payload);}
      if(raw.length<=4200000)sessionStorage.setItem(REVIEW_DATA_CACHE_KEY,raw);
    }catch(_e){}
  }
  function readReviewDataCache(resumeScope){
    var row=null;try{row=parseJson(sessionStorage.getItem(REVIEW_DATA_CACHE_KEY)||'');}catch(_e){}
    if(!row||row.schema!=='igdc-country-control-review-data.v1'||Date.now()-Number(row.savedAt||0)>21600000)return null;
    if(row.path&&row.path!==(location.pathname+location.search))return null;
    if(!row.scope||!resumeScope||scopeKey(row.scope)!==scopeKey(resumeScope))return null;
    return row;
  }
  function saveReviewSnapshot(){
    try{
      var snapshot={schema:'igdc-country-control-ui-state.v8-review-data-cache',path:location.pathname+location.search,scope:scopeSnapshot('session-resume-cache'),savedAt:Date.now(),scrollY:Math.max(0,Math.round(window.scrollY||0)),openDetails:openDetailKeys(),candidateSelectedProducts:candidateSelectedProducts,frontSelectedSections:frontSelectedSections,frontSelectedProducts:frontSelectedProducts,productPlacementSelections:productPlacementSelections,queueFocusedCandidateIds:queueFocusedCandidateIds.slice(0,250),panels:{summary:!$('summaryPanel').classList.contains('hidden'),queue:!$('queuePanel').classList.contains('hidden'),ai:!$('aiPanel').classList.contains('hidden'),product:!$('productResearchPanel').classList.contains('hidden'),json:!$('jsonPanel').classList.contains('hidden')}};
      sessionStorage.setItem(REVIEW_SNAPSHOT_KEY,JSON.stringify(snapshot));
      try{sessionStorage.removeItem(REVIEW_SNAPSHOT_LEGACY_KEY);}catch(_legacyError){}
      saveReviewDataCache(snapshot);
      sessionMemoryWrite(snapshot);
      persistScope();
    }catch(_e){try{persistScope();}catch(_scopeError){}}
  }
  function hydrateReviewSnapshot(){
    var row=returnRestoreRow||reviewReturnValue(),snapshot=null,memory=sessionMemoryRead();
    try{snapshot=parseJson(sessionStorage.getItem(REVIEW_SNAPSHOT_KEY)||sessionStorage.getItem(REVIEW_SNAPSHOT_LEGACY_KEY)||'');}catch(_e){}
    if(!snapshot||Date.now()-Number(snapshot.savedAt||0)>21600000)return false;
    var resumeScope=row||snapshot.scope;
    if(!resumeScope||!snapshot.scope||scopeKey(snapshot.scope)!==scopeKey(resumeScope))return false;
    if(!row&&snapshot.path&&snapshot.path!==(location.pathname+location.search))return false;
    selectedCountry=text(resumeScope.country||snapshot.scope.country).toUpperCase();
    selectedSubdivision=text(resumeScope.region||snapshot.scope.region||'NATIONWIDE').toUpperCase()||'NATIONWIDE';
    selectedRegion=text(resumeScope.regionGroup||snapshot.scope.regionGroup);
    selectionSource='session-resume';
    var detected=snapshot.scope.detectedGeo||{};
    geo={country:detected.country||null,region:detected.region||null,worldRegion:detected.regionGroup||null,resolved:detected.resolved===true,excluded:detected.excluded===true,source:detected.source||'session-resume'};
    if(memory&&memory.scope&&scopeKey(memory.scope)===scopeKey(resumeScope)){
      lastScopeCache=memory.scopeCache||null;lastCountryPreview=memory.country||null;lastCountryJson=memory.country||null;lastProductJson=memory.product||null;lastSignalReport=memory.signal||null;activeScopeAudit=memory.auditKind||'';lastScopeAuditJson=memory.audit||null;
    }else{
      memory=null;
      var persisted=readReviewDataCache(resumeScope);
      if(persisted){
        lastScopeCache=persisted.scopeCache||null;lastCountryPreview=persisted.country||null;lastCountryJson=persisted.country||null;lastProductJson=persisted.product||null;lastSignalReport=persisted.signal||null;activeScopeAudit=persisted.auditKind||'';lastScopeAuditJson=persisted.audit||null;
        memory={persistent:true};
      }
    }
    candidateSelectedProducts=Object.assign({},snapshot.candidateSelectedProducts||{});frontSelectedSections=Object.assign({},snapshot.frontSelectedSections||{});frontSelectedProducts=Object.assign({},snapshot.frontSelectedProducts||{});productPlacementSelections=Object.assign({},snapshot.productPlacementSelections||{});queueFocusedCandidateIds=Array.isArray(snapshot.queueFocusedCandidateIds)?snapshot.queueFocusedCandidateIds.map(text).filter(Boolean).slice(0,250):[];sessionResumeActive=true;sessionUiResume=snapshot;sessionDataResumeAvailable=!!memory;lastPassiveRestoreAt=Date.now();
    return !!selectedCountry;
  }
  function applySessionDataResume(){
    if(!sessionDataResumeAvailable)return false;var hydrated=false,cache=lastScopeCache;
    if(cache&&cache.scopeData){renderAi(cache.scopeData.candidates||[]);renderActiveSignals(cache.scopeData.marketSignals||{});hydrated=true;}
    if(cache&&cache.summaryData){renderSummary(cache.summaryData.summary||cache.summaryData,cache.scopeData||{},'현재 브라우저 세션 복원');hydrated=true;}
    if(cache&&cache.queueData){renderQueue(cache.queueData.candidates||[]);hydrated=true;}
    if(lastCountryPreview){renderResearchProgress(lastCountryPreview);renderAi(lastCountryPreview.candidates||[],lastCountryPreview.holdingCandidates||[],lastCountryPreview.blockedCandidates||[]);setButtonEnabled('countryRunDownloadBtn',true);setButtonEnabled('runNowBtn',lastCountryPreview.status==='complete'||lastCountryPreview.status==='committed');hydrated=true;}
    if(lastProductJson){renderProductProgress(lastProductJson);renderProducts(lastProductJson.products||[]);setButtonEnabled('productResearchDownloadBtn',true);setButtonEnabled('productResearchBtn',true);hydrated=true;}
    if(lastSignalReport){renderSignalReport(lastSignalReport);hydrated=true;}
    if(activeScopeAudit&&lastScopeAuditJson){renderScopeAudit(lastScopeAuditJson,activeScopeAudit);hydrated=true;}
    return hydrated;
  }
  function applySessionUiResume(){
    var snapshot=sessionUiResume;if(!snapshot)return;
    var panels=snapshot.panels||{};
    if(panels.summary&&$('summaryPanel'))$('summaryPanel').classList.remove('hidden');
    if(panels.queue&&$('queuePanel'))$('queuePanel').classList.remove('hidden');
    if(panels.ai&&$('aiPanel'))$('aiPanel').classList.remove('hidden');
    if(panels.product&&$('productResearchPanel'))$('productResearchPanel').classList.remove('hidden');
    if(panels.json&&$('jsonPanel'))$('jsonPanel').classList.remove('hidden');
    var keys=Array.isArray(snapshot.openDetails)?snapshot.openDetails:[];
    keys.forEach(function(key){var el=document.getElementById(key);if(!el){Array.prototype.some.call(document.querySelectorAll('details'),function(row){if(row.getAttribute('data-product-group')===String(key)||row.getAttribute('data-heavy-panel')===String(key)){el=row;return true;}return false;});}if(el&&el.tagName==='DETAILS')el.open=true;});
    if(Number.isFinite(Number(snapshot.scrollY)))setTimeout(function(){window.scrollTo({top:Math.max(0,Number(snapshot.scrollY)||0),left:0,behavior:'auto'});},180);
  }
  function prepareReviewReturn(){var row=reviewReturnValue();if(!row)return null;returnRestoreActive=true;returnRestoreRow=row;if(row.country)selectedCountry=text(row.country).toUpperCase();if(row.region)selectedSubdivision=text(row.region).toUpperCase()||'NATIONWIDE';if(row.regionGroup)selectedRegion=text(row.regionGroup);if(row.source)selectionSource=row.source;return row;}
  function rememberReviewReturn(target){try{var anchor=target&&target.closest?target.closest('[data-review-anchor]'):null,group=target&&target.closest?target.closest('details[data-product-group]'):null,heavy=target&&target.closest?target.closest('[data-heavy-panel]'):null,rect=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():null;saveReviewSnapshot();sessionStorage.setItem(REVIEW_RETURN_KEY,JSON.stringify({path:location.pathname+location.search,scrollY:Math.max(0,Math.round(window.scrollY||0)),anchor:anchor&&anchor.getAttribute('data-review-anchor')||'',anchorOffset:rect?Math.round(window.scrollY-(rect.top+window.scrollY)):0,productGroup:group&&group.getAttribute('data-product-group')||'',productGroupKind:group&&group.getAttribute('data-product-group-kind')||'',heavyPanel:heavy&&heavy.id||'',detailPath:reviewDetailPath(target),country:selectedCountry,region:selectedSubdivision||'NATIONWIDE',regionGroup:selectedRegion,source:selectionSource||'saved-scope',at:Date.now()}));}catch(_e){}}
  function navigateReviewLink(anchor,event){
    var url=safeExternalUrl(anchor&&anchor.href);if(!url)return;
    if(event&&(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button>0))return;
    event&&event.preventDefault();
    rememberReviewReturn(anchor);
    /* Keep a single browser-history hop. When this control runs inside the admin shell,
       navigate the top browsing context straight to the product. Do not first promote
       commerce-country-control.html into the top context; that duplicate intermediate
       page loses the live admin runtime and forces a second Back click. */
    try{var topWindow=window.top||window;if(topWindow!==window&&topWindow.location){topWindow.location.assign(url);return;}}catch(_e){}
    window.location.assign(url);
  }
  function openReviewReturnGroup(row){if(!row)return;var path=Array.isArray(row.detailPath)?row.detailPath:[];path.forEach(function(key){var detail=reviewDetailElement(key);if(detail&&!detail.open)detail.open=true;});var heavy=row.heavyPanel&&$(row.heavyPanel);if(heavy&&typeof heavy.open==='boolean'&&!heavy.open)heavy.open=true;if(row.productGroup){var root=row.productGroupKind==='candidate'?$('productGrid'):$('productSectionList');if(row.productGroupKind==='candidate'&&$('productCandidatePanel')&&!$('productCandidatePanel').open)$('productCandidatePanel').open=true;var group=null;if(root){Array.prototype.some.call(root.querySelectorAll('details[data-product-group]'),function(candidate){if(candidate.getAttribute('data-product-group')===String(row.productGroup)){group=candidate;return true;}return false;});}if(group&&!group.open)group.open=true;}}
  function restoreReviewReturn(){var row=returnRestoreRow||reviewReturnValue();if(!row)return;if(returnRestoreTimer)clearInterval(returnRestoreTimer);returnRestoreActive=true;returnRestoreRow=row;openReviewReturnGroup(row);var started=Date.now(),stable=0,lastTop=-1;returnRestoreTimer=setInterval(function(){openReviewReturnGroup(row);var target=reviewAnchorElement(row.anchor),y=Math.max(0,Number(row.scrollY||0));if(target){var rect=target.getBoundingClientRect(),top=Math.max(0,Math.round(rect.top+window.scrollY+Number(row.anchorOffset||0)));window.scrollTo({top:top,left:0,behavior:'auto'});y=top;}else if(document.documentElement.scrollHeight>=Math.min(y+200,document.documentElement.scrollHeight)){window.scrollTo({top:y,left:0,behavior:'auto'});}var nowTop=Math.round(window.scrollY||0);stable=nowTop===lastTop?stable+1:0;lastTop=nowTop;if((target&&stable>=2)||(Date.now()-started>12000)){clearInterval(returnRestoreTimer);returnRestoreTimer=null;returnRestoreActive=false;returnRestoreRow=null;try{sessionStorage.removeItem(REVIEW_RETURN_KEY);}catch(_e){}}},140);}
  function directVideoUrl(value){var url=safeExternalVideoUrl(value);return /\.(?:mp4|webm|ogv|ogg)(?:$|[?#])/i.test(url)?url:'';}
  function embeddableVideoUrl(value){var url=safeExternalVideoUrl(value);if(!url)return'';try{var u=new URL(url),host=u.hostname.toLowerCase();if(host==='youtu.be'){var id=u.pathname.replace(/^\/+/, '').split('/')[0];return id?'https://www.youtube-nocookie.com/embed/'+encodeURIComponent(id):'';}if(host.endsWith('youtube.com')||host.endsWith('youtube-nocookie.com')){var id2=u.searchParams.get('v');if(!id2&&/\/embed\//.test(u.pathname))id2=u.pathname.split('/embed/')[1].split('/')[0];return id2?'https://www.youtube-nocookie.com/embed/'+encodeURIComponent(id2):'';}if(host==='vimeo.com'||host.endsWith('.vimeo.com')){var m=u.pathname.match(/(?:video\/)?(\d{5,})/);return m?'https://player.vimeo.com/video/'+m[1]:'';}}catch(_e){}return'';}
  function renderProductProgress(data){
    data=data||{status:'not_started',summary:{},progress:{}};var summary=data.summary||{},progress=data.progress||{},discovery=progress.discovery||{},inspection=progress.inspection||{},privateQueue=progress.privateQueue||{},stageSummary=data.pipeline&&data.pipeline.stageSummary||{},pause=data.pause||null;
    var failed=Number(stageSummary.failed||0),staged=Number(summary.privateResearchQueueStaged||0),status=text(data.status||'not_started'),labels={not_started:'아직 상품 리서치를 시작하지 않았습니다.',discovering:'공식 업체 사이트에서 실제 상품 페이지를 찾는 중입니다. 발견된 상품은 검증 전 상태로 바로 표시합니다.',inspecting:'상품 페이지·이미지·가격·재고·영상·원본 링크를 확인하는 중입니다.',staging:'이전 버전의 자동 대기열 단계가 감지되었습니다. 새 정책에 따라 리서치 완료·수동 대기열 대기 상태로 전환합니다.',complete:'상품 리서치를 완료했습니다. 검증 완료 상품은 최신 상품 목록에서 확인한 뒤 현재 조사분 후보 관리목록 등록을 실행할 수 있습니다.',candidate_ledger:'저장된 상품 후보 원장을 기준으로 관리 목록을 불러왔습니다.',cancelled:'상품 리서치가 중단됐습니다.'};
    if(pause&&pause.paused===true){productPausedForQueue=true;productPauseServerConfirmed=true;}else if(pause&&pause.pauseRequested===false){productPausedForQueue=false;productPauseServerConfirmed=false;}if(status==='complete'||status==='cancelled'){productPausedForQueue=false;productPauseServerConfirmed=false;}
    var retryPending=Number(discovery.retryPending||summary.supplierRetryPending||0),deferredSuppliers=Number(discovery.temporarilyDeferred||summary.temporarilyDeferredSuppliers||0),inspectRetry=Number(inspection.retryPending||0);
    if($('productResearchState'))$('productResearchState').textContent=(data.needsRefresh===true?'이전 상품 추출 결과입니다. 카테고리 페이지를 제외하고 실제 상품 상세페이지·썸네일을 다시 조사해야 합니다. · ':'')+(labels[status]||status)+' · 기존 업체 보존 '+Number(summary.skippedKnownSupplierSources==null?Math.max(0,Number(summary.existingSupplierSources||0)-Number(summary.gapSupplierSources||0)):summary.skippedKnownSupplierSources)+' · 보완 재조사 '+Number(summary.gapSuppliersChecked||0)+'/'+Number(summary.gapSupplierSources||0)+' · 신규 업체 조사 '+Number(summary.newSuppliersChecked||0)+'/'+Number(summary.newSupplierSources==null?Math.max(0,Number(discovery.total||0)-Number(summary.previouslyResearchedSuppliers||0)):summary.newSupplierSources)+' · 전체 진행 '+Number(discovery.done||0)+'/'+Number(discovery.total||0)+(retryPending?' · 느린 업체 재시도 '+retryPending+'건':'')+(deferredSuppliers?' · 다음 사이클 재확인 '+deferredSuppliers+'건':'')+(Number(summary.pendingNewSupplierSources||0)?' · 추가 업체 다음 차수 '+Number(summary.pendingNewSupplierSources)+'건':'')+' · 상품 점검 '+Number(inspection.done||0)+'/'+Number(inspection.total||0)+(inspectRetry?' · 느린 상품 재시도 '+inspectRetry+'건':'')+' · 후보 관리목록 등록 '+staged+'/'+Number(privateQueue.total||summary.privateResearchQueueEligible||0)+(failed?' · 등록 실패 '+failed:'');
    if($('latestProductSummary'))$('latestProductSummary').textContent=latestProductRowsComplete&&latestProductRows.length?(latestProductRows.length+'건 · 원천 조사 '+Number(summary.latestResearchProducts||latestProductRows.length)+'건'):(Number(summary.latestResearchProducts||latestProductRows.length)+'건 · 조회 필요');if($('latestProductPanel'))$('latestProductPanel').classList.remove('hidden');
    if(Array.isArray(data.latestProducts)){latestProductRows=data.latestProducts.slice();if($('latestProductPanel')&&$('latestProductPanel').open)renderLatestProductRows();else if($('productCandidatePanel')&&$('productCandidatePanel').open)renderLatestResearchCandidateGroup();syncLatestProductQueueControls();}
    var liveLatestExpected=Number(summary.latestResearchProducts||0),liveLatestPanel=$('latestProductPanel');if(liveLatestPanel&&liveLatestPanel.open&&selectedCountry&&!latestRefreshActive&&productLoopActive&&liveLatestExpected>latestProductRows.length){latestRefreshActive=true;refreshLatestResearchRows(selectedCountry,selectedSubdivision||'NATIONWIDE',{state:null,label:'최신 상품 리서치 목록',preserveOnFailure:true}).catch(function(){}).finally(function(){latestRefreshActive=false;});}
    if($('productResearchStats'))$('productResearchStats').innerHTML=stat('기존 업체 보존',summary.skippedKnownSupplierSources==null?Math.max(0,Number(summary.existingSupplierSources||0)-Number(summary.gapSupplierSources||0)):summary.skippedKnownSupplierSources,'중복 전체 재조사 생략')+stat('보완 재조사',summary.gapSupplierSources||0,Number(summary.gapSuppliersChecked||0)+'/'+Number(summary.gapSupplierSources||0)+' 상품 미발견·일시 지연 업체')+stat('신규 업체 조사',summary.newSupplierSources==null?Math.max(0,Number(discovery.total||0)-Number(summary.previouslyResearchedSuppliers||0)):summary.newSupplierSources,Number(summary.newSuppliersChecked||0)+'/'+Number(summary.newSupplierSources==null?Math.max(0,Number(discovery.total||0)-Number(summary.previouslyResearchedSuppliers||0)):summary.newSupplierSources)+' 신규 리서치')+stat('업체 확인',Number(summary.suppliersChecked||0)+'/'+Number(summary.suppliers||0),'공식 사이트')+stat('최신 상품',summary.latestResearchProducts||latestProductRows.length,'이번 리서치 사이클')+stat('상품 발견',summary.discovered||0,'원본 페이지 후보')+stat('상품 점검',summary.inspected||0,'상세페이지 확인')+stat('이미지 확인',summary.withImage||0,'실제 상품 이미지')+stat('영상 확인',summary.withVideo||0,'직접 재생·원본 영상')+stat('관리자 검토 가능',summary.readyForAdminReview||0,'원본 링크 포함')+stat('대기열 적격',summary.privateResearchQueueEligible||0,'비공개 검토 대상')+stat('후보 관리목록 등록',staged,'자동 공개 없음')+stat('등록 실패',failed,failed?'저장 연결 확인 필요':'정상')+stat('대기열 심사 후보',summary.slotCandidates||0,'관리자 지정')+stat('정산 준비',summary.settlementReadyProducts||0,'추적·지급 조건 확인')+stat('온라인 제휴',summary.onlineAffiliateActive||0,'활성 프로그램')+stat('정식 파트너',summary.formalPartners||0,'계약·승인 확인');
    setButtonEnabled('productResearchDownloadBtn',status!=='not_started');
    if($('productResearchBtn')&&!productLoopActive){$('productResearchBtn').textContent=data.needsRefresh===true?'상품 썸네일 다시 조사':((status==='discovering'||status==='inspecting'||status==='staging')?'상품 조사 계속':'신규·미확인 상품 조사');}
    syncProductQueueStageControls();syncProductAiFinalizeControl();
  }

  function assignedSectionKey(row){
    // A private placement without its matching active database assignment is
    // NOT a publishable 20-section card. Preserve it in the repair pool.
    if(row&&row.ledgerSource==='candidate'&&row.assignmentRepairRequired===true)return '';
    var key=productPlacementKey(row);return PRODUCT_SECTION_MAP[key]?key:'';
  }
  function productResearchComplete(){return !!(lastProductJson&&lastProductJson.status==='complete');}
  function hasFrontMatchablePlacement(){return productRows.some(function(row){return productDecision(row)==='slot_candidate'&&!!assignedSectionKey(row);});}
  function selectedSectionKeys(){return PRODUCT_SECTIONS.map(function(row){return row.key;}).filter(function(key){return frontSelectedSections[key]===true;});}
  function selectedProductIds(sectionKey){return productRows.filter(function(row){return frontSelectedProducts[text(row&&row.id)]===true&&(!sectionKey||assignedSectionKey(row)===sectionKey);}).map(function(row){return text(row.id);}).filter(Boolean);}
  function rawSectionRows(sectionKey){return productRows.filter(function(row){return productDecision(row)==='slot_candidate'&&assignedSectionKey(row)===sectionKey;});}
  function sectionRows(sectionKey){return dedupePlacedSectionRows(rawSectionRows(sectionKey)).filter(function(row){return productDecision(row)==='slot_candidate'&&assignedSectionKey(row)===sectionKey;});}
  function sectionRankScore(row){var ranking=row&&row.ranking||{},value=row&&row.valueAssessment||{},score=Number(row&&row.rankingScore||ranking.finalScore||ranking.score||value.portfolioPriorityScore||0);return Number.isFinite(score)?score:0;}
  function sectionRankTimestamp(row){var stamp=Date.parse(text(row&&row.updatedAt||row&&row.decisionAt||row&&row.createdAt));return Number.isFinite(stamp)?stamp:0;}
  function compareSectionRankRows(a,b){var ka=assignedSectionKey(a),kb=assignedSectionKey(b),ra=sectionRevenuePosition(a,ka),rb=sectionRevenuePosition(b,kb);if(ka===kb&&ra&&rb&&ra!==rb)return ra-rb;var al=productManagementLocked(a)?1:0,bl=productManagementLocked(b)?1:0;if(al!==bl)return bl-al;var score=sectionRankScore(b)-sectionRankScore(a);if(score)return score;var trust=Number(b&&b.supplierTrustScore||0)-Number(a&&a.supplierTrustScore||0);if(trust)return trust;var stamp=sectionRankTimestamp(b)-sectionRankTimestamp(a);if(stamp)return stamp;return text(a&&a.id).localeCompare(text(b&&b.id));}
  function rankedSectionRows(sectionKey){return sectionRows(sectionKey).slice().sort(compareSectionRankRows);}
  function frontTopRowsForSection(sectionKey){return rankedSectionRows(sectionKey).slice(0,frontSlotCapacity(sectionKey));}
  function capFrontReplacementRows(rows,keys){var allowed=new Set((keys||[]).filter(function(key){return!!PRODUCT_SECTION_MAP[key];})),grouped={};(rows||[]).forEach(function(row){var key=assignedSectionKey(row);if(!key||!allowed.has(key))return;(grouped[key]||(grouped[key]=[])).push(row);});var out=[];Object.keys(grouped).forEach(function(key){out=out.concat(grouped[key].sort(compareSectionRankRows).slice(0,frontSlotCapacity(key)));});return out;}
  function syncFrontSelectionControls(){
    var busy=productAutomationActive||productFrontSyncActive||productFrontSyncPreflightActive||frontMatchCommandBusy||frontMatchDeploymentBusy||productSectionCleanupActive,matchBusy=busy,sections=selectedSectionKeys(),placed=productRows.filter(function(row){return productDecision(row)==='slot_candidate'&&!!assignedSectionKey(row);}),active=placed.filter(frontPublicationActive),refreshable=placed;
    if($('selectedSectionCount'))$('selectedSectionCount').textContent='선택 섹션 '+sections.length+'개';
    var master=$('allSectionsSelect');if(master){master.checked=sections.length===PRODUCT_SECTIONS.length;master.indeterminate=sections.length>0&&sections.length<PRODUCT_SECTIONS.length;master.disabled=busy;}
    // Master-board publication controls must also be able to replace a section with
    // an empty real-product set. That is how an administrator intentionally clears
    // stale front data and lets the sample fallback return.
    setButtonEnabled('selectedSectionsMatchBtn',!matchBusy&&sections.length>0);setButtonEnabled('allSectionsMatchBtn',!matchBusy&&!!selectedCountry);setButtonEnabled('selectedSectionsUnmatchBtn',!busy&&sections.some(function(key){return sectionRows(key).some(frontPublicationActive);}));setButtonEnabled('allSectionsUnmatchBtn',!busy&&active.length>0);
    Array.prototype.forEach.call(document.querySelectorAll('[data-section-front-select]'),function(box){box.checked=frontSelectedSections[box.value]===true;box.disabled=busy;});
    Array.prototype.forEach.call(document.querySelectorAll('[data-product-front-select]'),function(box){box.checked=frontSelectedProducts[box.value]===true;box.disabled=busy;});
    // Lock section buttons already rendered on the page without a rerender.
    if(busy)Array.prototype.forEach.call(document.querySelectorAll('[data-section-front-match],[data-section-front-unmatch],[data-selected-products-front]'),function(button){button.disabled=true;});
    PRODUCT_SECTIONS.forEach(function(section){var ids=selectedProductIds(section.key),rows=sectionRows(section.key),all=$('sectionProductSelectAll-'+section.key.replace(/[^a-z0-9_-]/gi,'_')),count=$('sectionProductSelectedCount-'+section.key.replace(/[^a-z0-9_-]/gi,'_'));if(all){all.checked=rows.length>0&&ids.length===rows.length;all.indeterminate=ids.length>0&&ids.length<rows.length;all.disabled=busy||!rows.length;}if(count)count.textContent='선택 상품 '+ids.length+'건';Array.prototype.forEach.call(document.querySelectorAll('[data-selected-products-front="'+section.key+'"]'),function(button){var unmatch=button.getAttribute('data-front-operation')==='unmatch';button.disabled=(unmatch?busy:matchBusy)||!ids.length;});Array.prototype.forEach.call(document.querySelectorAll('[data-section-selected-remove="'+section.key+'"]'),function(button){button.disabled=busy||!ids.length;});});
  }

  function productCardHtml(row,index,mode,groupKey){
    var productUrl=safeProductDetailUrl(row.productUrl||row.url),imageUrl=researchCardImage(row),supplierUrl=safeExternalUrl(row.supplierSiteUrl),videoUrl=safeExternalVideoUrl(row.videoUrl||row.videoContentUrl||row.videoEmbedUrl),title=text(row.productName||row.title||'상품명 확인 필요'),decision=productDecision(row),researchStatus=text(row.researchStatus).toLowerCase(),risk=row.riskAssessment||{},ready=researchStatus==='ready_for_admin_review',actionable=row.inspectionComplete===true||ready||researchStatus==='needs_manual_review'||row.privatePlacementReviewEligible===true,hardInvalid=['http_404','http_410','non_html','blocked','unavailable','invalid_product_url','product_page_explicit_invalid_message','product_page_redirected_to_seller_home'].indexOf(researchStatus)>=0||row.productPageLive===false||risk.explicitUnavailable===true||risk.specificProductUrl===false,slotAllowed=(!!row.id&&!!productUrl&&!!imageUrl&&!genericOrChallengeResearchTitle(title)&&!hardInvalid)||decision==='slot_candidate',price=text(row.price||''),currency=text(row.priceCurrency||''),priceDisplay=price?(currency==='KRW'?price.replace(/\s*KRW\s*/ig,'').replace(/원\s*$/,'')+'원':price+(currency?' '+currency:'')):'판매처에서 현재 가격 확인';
    if(groupKey==='latest_research'&&(hardInvalid||genericOrChallengeResearchTitle(title)))productUrl='';
    var groupImages=researchCardImageSources(row),activeImage=groupImages.length?groupImages[0]:imageUrl,imageAlts=groupImages.slice(1);
    if(genericOrChallengeResearchTitle(title)){activeImage='';imageAlts=[];}
    var image=activeImage?(productUrl?'<a href="'+esc(productUrl)+'" target="_top" data-review-link="1" rel="noreferrer external nofollow" referrerpolicy="no-referrer">':'')+'<img data-product-image="1" '+(imageAlts.length?'data-image-alternates="'+esc(JSON.stringify(imageAlts))+'" ':'')+'src="'+esc(activeImage)+'" alt="'+esc(title)+'" loading="lazy" decoding="async" fetchpriority="low">'+(productUrl?'</a>':'')+'<div class="product-image-missing hidden">상품 이미지 원본을 불러오지 못했습니다 · 상품 URL 확인 필요</div>':'<div class="product-image-missing">상품 이미지 확인 필요 · 이미지 없다고 상품이 없는 것은 아닙니다</div>';
    var revenueRank=mode==='candidate'&&PRODUCT_SECTION_MAP[groupKey]&&sectionRevenueViewScope===scopeKey()?sectionRevenueView[text(row.candidateId||row.id)]:null;
    var rowPinMeta=row.sectionRevenueOverride||(row.source_payload&&row.source_payload.sectionRevenueOverride)||{},pinOverride=(revenueRank&&revenueRank.override)||((rowPinMeta.scopeKey===scopeKey()+'|'+groupKey)?rowPinMeta.mode:'');
    var revenueRankControl=mode==='candidate'&&PRODUCT_SECTION_MAP[groupKey]&&row.id?'<div class="small">'+(revenueRank?'수익 우선 순번 <strong>'+esc(revenueRank.rank)+'위</strong> · '+esc(revenueRank.className||'ORDINARY'):'현재 순위: 미조회')+(pinOverride==='pin_top'?' · 관리자 최상단 고정':(pinOverride==='demote'?' · 관리자 후순위 지정':''))+'</div><button type="button" class="ghost" data-section-revenue-action="'+(pinOverride==='pin_top'?'unpin_top':'pin_top')+'" data-section-revenue-section="'+esc(groupKey)+'" data-section-revenue-id="'+esc(row.candidateId||row.id)+'">'+(pinOverride==='pin_top'?'관리자 최상단 고정 해제':'관리자 최상단 고정')+'</button> '+(pinOverride==='pin_top'?'':'<button type="button" class="ghost" data-section-revenue-action="'+(pinOverride==='demote'?'restore':'demote')+'" data-section-revenue-section="'+esc(groupKey)+'" data-section-revenue-id="'+esc(row.candidateId||row.id)+'">'+(pinOverride==='demote'?'관리자 후순위 해제':'관리자 판단으로 뒤로 보내기')+'</button>'):'';
    var links=[];if(productUrl)links.push(externalReviewAnchor(productUrl,'상품 원본·판매처 열기',''));if(supplierUrl)links.push(externalReviewAnchor(supplierUrl,'업체 사이트 확인',''));var placementHtml='',actions='';
    if(mode==='candidate'||mode==='section'){
      placementHtml=productManagementOptions(row,mode,groupKey,slotAllowed);
      if(row.id&&slotAllowed)actions='<span class="product-verification-note">20개 섹션을 관리자가 직접 지정할 수 있습니다. 검증 중 상품은 비공개 경고 상태로 저장되고 최종 공개 안전 게이트는 그대로 유지됩니다.</span>';else if(row.id&&actionable)actions='<span class="product-verification-note">상품 원본 주소가 확인되면 섹션을 지정할 수 있습니다. 보류·제외·AI 재분류는 지금 처리할 수 있습니다.</span>';else actions='<span class="product-verification-note">상세페이지 검증 중입니다. 원본은 먼저 확인할 수 있습니다.</span>';
      if(mode==='section')placementHtml='<div class="product-status-note">현재 배치 예정: <strong>'+esc(sectionLabel(groupKey))+'</strong><br><span class="small">비공개 배치 예정 · 관리자 지정은 AI보다 우선</span></div>'+placementHtml;
    }
    var priority=text(row.priorityLabel||''),decisionLabel={slot_candidate:'섹션 배치 예정',hold:'보류',reject:'제외',purge:'영구 제외',undecided:'미결정'}[decision]||decision,settlementHtml=affiliateSettlementSummary(row),singleFront='';
    if(mode==='section'&&row.id&&decision==='slot_candidate')singleFront='<button type="button" class="product-section-unmatch-button" data-product-section-release="'+esc(row.id)+'">이 상품 섹션 해제</button><span class="small">이 버튼은 현재 섹션 배치만 해제하며 GitHub/Netlify 프론트 빌드를 실행하지 않습니다.</span>';
    var latestDuplicateCount=mode==='candidate'&&groupKey==='latest_research'?Number(latestResearchDuplicateCounts[text(row.candidateId||row.id)]||0):0;
    var latestDuplicateNote=latestDuplicateCount>1?'<div class="small" data-latest-research-duplicate="'+esc(row.id)+'"><span class="pill warn">동일 상품 총 '+latestDuplicateCount+'건 · 중복 '+(latestDuplicateCount-1)+'건</span> · 같은 URL·상품명으로 등록된 별도 후보 ID는 유지됩니다.</div>':'';
    var frontSelect=mode==='section'&&row.id?'<div class="product-card-front-select"><label class="product-front-select-label"><input type="checkbox" data-product-front-select="1" data-product-front-section="'+esc(groupKey)+'" value="'+esc(row.id)+'" '+(frontSelectedProducts[text(row.id)]===true?'checked ':'')+'> 이 상품 선택</label></div>':'',candidateSelect=mode==='candidate'&&row.id?'<div class="product-card-front-select"><label class="product-front-select-label"><input type="checkbox" data-candidate-select="'+esc(groupKey)+'" value="'+esc(row.id)+'" '+(candidateSelectedProducts[text(row.id)]===true?'checked ':'')+'> 이 후보 선택</label></div>':'',latestKey=latestProductKey(row),latestSelect=mode==='latest'&&latestKey?'<div class="product-card-front-select"><label class="product-front-select-label"><input type="checkbox" data-latest-queue-select="1" value="'+esc(latestKey)+'" '+(latestSelectedProducts[latestKey]===true?'checked ':'')+'> 이 상품 선택</label></div>':'';
    var directDelete=mode==='latest'&&latestKey?'<button type="button" class="secondary" data-latest-delete-one="'+esc(latestKey)+'">이 상품 목록에서 삭제</button> <button type="button" class="danger" data-latest-purge-one="'+esc(latestKey)+'">이 상품 영구 제외</button>':((mode==='candidate'||mode==='section')&&row.id?'<button type="button" class="secondary" data-candidate-delete-one="'+esc(frontCandidateLedgerId(row))+'">이 후보 목록에서 삭제</button>':'');
    if(directDelete)actions+=(actions?' ':'')+directDelete;
    var researchReferenceNote=groupKey==='quality_review'?'<div class="small">검토 사유: '+esc(productImageReviewLabel(verifiedProductImageReviewIssue(row)))+' · 현재 섹션 '+esc(sectionLabel(productPlacementKey(row)))+'</div>':(groupKey==='latest_research'?'<div class="small mono" style="overflow-wrap:anywhere">원본 조사 URL: '+esc(reviewUrlLabel(row.productUrl||row.url||row.originalOfficialProductUrl))+'</div>'+(productUrl?'':'<div class="small">상품 상세 URL 검증 필요 · 업체/목록 페이지는 상품 링크로 연결하지 않습니다.</div>'):'');
    return'<article class="product-card" data-review-anchor="product-'+esc(row.id||productUrl||title)+'">'+candidateSelect+frontSelect+latestSelect+latestDuplicateNote+'<div class="product-image-frame">'+image+'</div><div class="product-body"><strong class="product-title">'+(productUrl?externalReviewAnchor(productUrl,title,'product-title-link'):esc(title))+'</strong><div class="product-price"><strong>'+esc(priceDisplay)+'</strong></div><div class="small">판매·결제·배송 책임 업체: '+esc(row.supplierName||'-')+'</div><div class="small"><span class="pill '+(ready?'good':'warn')+'">'+esc(row.researchStatus||'미확인')+'</span> <span class="pill info">'+esc(decisionLabel)+'</span>'+(mode==='latest'&&verifiedReviewUi.latest[latestKey]==='verified'?' <span class="pill good">정상 검증 완료 · 복귀 대기</span>':'')+(priority?' <span class="pill good">'+esc(priority)+'</span>':'')+(row.productEvidenceReviewRequired===true?' <span class="pill warn">상세상품 확인 필요 · 기존 섹션 보존</span>':'')+(verifiedProductImageReviewIssue(row)?' <span class="pill warn">대표사진 검토: '+esc(productImageReviewLabel(verifiedProductImageReviewIssue(row)))+' · 보류 처리 가능</span>':'')+'</div>'+settlementHtml+frontPublicationSummary(row)+revenueRankControl+placementHtml+'<div class="product-links">'+(links.join('')||'<span class="small">확인 가능한 외부 링크가 없습니다.</span>')+'</div><div class="small mono" style="overflow-wrap:anywhere">'+esc(productUrl||(productAccessChallengeUrl(row.productUrl||row.url)?'접근 제한 인증 주소 격리 · 원본 상세주소 복구 필요':'상품 원본 주소 확인 필요'))+'</div>'+researchReferenceNote+'<div class="product-actions">'+actions+singleFront+'</div></div></article>';
  }
  function productGroupDetails(key,label,rows,kind){
    var count=rows.length,validSection=!!PRODUCT_SECTION_MAP[key],frontCount=validSection?currentFrontCount(key):0,occupancy=count,frontCapacity=frontSlotCapacity(key),capacity=validSection?'<span class="product-section-capacity '+(occupancy>frontCapacity?'warn':'')+'">'+esc(sectionOccupancyText(key,count))+'</span>':'<span class="small">'+count+'건'+(frontCount>0?' · 실상품 '+frontCount+'건':'')+'</span>';
    var controlsBusy=productAutomationActive||productFrontSyncActive||productFrontSyncPreflightActive||frontMatchCommandBusy||frontMatchDeploymentBusy||productSectionCleanupActive,matchBusy=controlsBusy,autoDisabled=controlsBusy||productLoopActive||!productRows.length,autoButton='';
    if(kind==='section'&&validSection)autoButton='<button type="button" class="product-section-ai-button" data-section-ai-auto="'+esc(key)+'" '+(autoDisabled?'disabled':'')+'>이 섹션 AI 자동 배치</button>';
    else if(kind==='candidate'&&validSection)autoButton='<button type="button" class="product-section-ai-button" data-section-ai-auto="'+esc(key)+'" '+(autoDisabled||!count?'disabled':'')+'>이 후보군 AI 자동 배치</button>';
    else if(kind==='candidate'&&key==='assignment_repair')autoButton='<button type="button" class="product-section-ai-button" data-candidate-repair-auto="1" '+(autoDisabled||!count?'disabled':'')+'>실제 배정 누락 전체 복구(정상상품만)</button>';
    else if(kind==='candidate'&&key==='unassigned')autoButton='<button type="button" class="product-section-ai-button" data-section-ai-auto="__all__" '+(autoDisabled||!count?'disabled':'')+'>미배정 AI 자동 배치</button>';
    // The candidate/master board is now the only active 20-section authority.
    // Section selection and front publication controls live here; the legacy
    // productSectionBoard is retained only as a disabled rollback shell.
    var masterSectionControl=(kind==='candidate'||kind==='section')&&validSection;
    var sectionSelect=masterSectionControl?'<label class="section-select-label"><input type="checkbox" data-section-front-select="1" value="'+esc(key)+'" '+(frontSelectedSections[key]===true?'checked ':'')+(controlsBusy?'disabled ':'')+'> 섹션 선택</label>':'';
    var frontButtons=masterSectionControl?'<button type="button" class="product-section-front-button" data-section-front-match="'+esc(key)+'" '+(matchBusy?'disabled':'')+'>이 섹션 프론트 매칭</button><button type="button" class="product-section-unmatch-button" data-section-front-unmatch="'+esc(key)+'" '+(controlsBusy||!rows.some(frontPublicationActive)?'disabled':'')+'>이 섹션 매칭 해제</button>':'';
    var workspaceKey=kind==='section'&&validSection?'section_'+key.replace(/[^a-z0-9_-]/gi,'_'):(kind==='candidate'?'candidate_group_'+key.replace(/[^a-z0-9_-]/gi,'_'):'');
    var policyButton=workspaceKey?'<button type="button" class="ghost policy-workspace-button" data-policy-workspace="'+esc(workspaceKey)+'" data-policy-workspace-label="'+esc(label)+(kind==='candidate'?' 후보 관리 대화':' 섹션 운영 대화')+'" data-policy-scope="country">AI 운영·정책 대화</button>':'';
    var safeKey=key.replace(/[^a-z0-9_-]/gi,'_');
    var candidateToolbar=kind==='candidate'?'<div class="section-product-toolbar candidate-bulk-toolbar"><label class="product-front-select-label"><input id="candidateSelectAll-'+esc(safeKey)+'" type="checkbox" data-candidate-select-all="'+esc(key)+'"> 이 후보군 전체 선택</label><span id="candidateSelectedCount-'+esc(safeKey)+'" class="pill info">선택 후보 0건</span><button type="button" class="product-section-ai-button" data-candidate-bulk="ai" data-candidate-group="'+esc(key)+'" disabled>선택 후보 AI 랭킹 비교·열위 상품 치환 배치</button><select class="product-management-select candidate-target-select" data-candidate-target="'+esc(key)+'"><option value="">PSOM 자동 배치 · 필요 시 수동 섹션 선택</option>'+PRODUCT_SECTIONS.map(function(section){return'<option value="'+esc(section.key)+'">'+esc(section.label)+'</option>';}).join('')+'</select><button type="button" class="product-section-front-button" data-candidate-bulk="place" data-candidate-group="'+esc(key)+'" disabled>선택 후보를 PSOM 기준 20개 섹션 배치 예정으로 이동</button><button type="button" class="secondary" data-candidate-bulk="undecided" data-candidate-group="'+esc(key)+'" disabled>선택 후보 미배정 복원</button><button type="button" class="secondary" data-candidate-bulk="hold" data-candidate-group="'+esc(key)+'" disabled>선택 후보 보류</button><button type="button" class="danger" data-candidate-bulk="reject" data-candidate-group="'+esc(key)+'" disabled>선택 후보 제외</button><button type="button" class="danger" data-candidate-bulk="purge" data-candidate-group="'+esc(key)+'" disabled>선택 후보 영구 제외</button><button type="button" class="secondary" data-candidate-bulk="list_delete" data-candidate-group="'+esc(key)+'" disabled>선택 후보 목록에서만 제거</button><span id="candidateBulkState-'+esc(safeKey)+'" class="candidate-bulk-state small" aria-live="polite">준비</span></div>':'';
    if(kind==='candidate'&&key==='quality_review'){
      candidateToolbar='<div class="section-product-toolbar candidate-bulk-toolbar"><label class="product-front-select-label"><input id="candidateSelectAll-quality_review" type="checkbox" data-candidate-select-all="quality_review"> 검토 대상 전체 선택</label><span id="candidateSelectedCount-quality_review" class="pill info">선택 후보 0건</span><button type="button" class="secondary" data-candidate-bulk="hold" data-candidate-group="quality_review" disabled>선택 상품 보류 목록으로 이동</button><button type="button" class="ghost" data-quality-unmatch="1">선택 상품 프론트 매칭 해제</button><span id="candidateBulkState-quality_review" class="candidate-bulk-state small" aria-live="polite">관리자에서 먼저 보류로 이관하고 원장 저장을 확인합니다. 기존 프론트 상품은 이후 Front Match와 배포 확인으로 반영됩니다. 원장·리서치 기록은 보존합니다.</span></div>';
    }
    var productToolbar=kind==='section'&&validSection?'<div class="section-product-toolbar"><label class="product-front-select-label"><input id="sectionProductSelectAll-'+esc(safeKey)+'" type="checkbox" data-section-products-select-all="'+esc(key)+'"> 이 섹션 상품 전체 선택</label><span id="sectionProductSelectedCount-'+esc(safeKey)+'" class="pill info">선택 상품 0건</span><button type="button" class="product-section-front-button" data-selected-products-front="'+esc(key)+'" data-front-operation="match" disabled>선택 상품 매칭</button><button type="button" class="product-section-unmatch-button" data-selected-products-front="'+esc(key)+'" data-front-operation="unmatch" disabled>선택 상품 매칭 해제</button><button type="button" class="secondary" data-section-selected-remove="'+esc(key)+'" disabled>선택 후보 목록에서 제거</button><button type="button" class="product-section-ai-button" data-section-rank-trim="'+esc(key)+'" '+(controlsBusy||count<=frontCapacity?'disabled':'')+'>AI 랭킹 상위 '+frontCapacity+' 정리</button><button type="button" class="product-section-front-button" data-section-front-match="'+esc(key)+'" '+(matchBusy?'disabled':'')+'>이 섹션 전체 상품 매칭</button><button type="button" class="product-section-unmatch-button" data-section-front-unmatch="'+esc(key)+'" '+(controlsBusy||!rows.some(frontPublicationActive)?'disabled':'')+'>이 섹션 전체 상품 매칭 해제</button></div>':'';
    return'<details class="product-group" data-product-group="'+esc(key)+'" data-product-group-kind="'+esc(kind)+'"><summary><span>'+sectionSelect+' <strong>'+esc(label)+'</strong> '+capacity+'</span><span class="product-group-summary-actions">'+policyButton+autoButton+frontButtons+'<span class="pill info" data-group-toggle-label>목록 펼치기</span></span></summary><div class="product-group-body">'+sectionMismatchMarkup(key,count)+candidateToolbar+productToolbar+'<div class="product-group-grid"></div><div class="product-group-pager"></div></div></details>';
  }
  // Candidate management must keep two views distinct:
  // - an AI/manual placement leaves its former raw/unassigned pool;
  // - the same candidate must remain visible under the assigned Front/section
  //   group so the administrator can reclassify, hold, reject or restore it.
  // Hiding assigned slot candidates here makes them impossible to remove later.
  function candidatePoolRow(row){var decision=productDecision(row);return decision==='undecided'||decision==='slot_candidate';}
  function candidateGroupKey(row){var decision=productDecision(row);
    // Section proposals are not approved placements. All genuinely undecided
    // candidate rows remain in the administrator UNASSIGNED pool.
    if(decision==='undecided'&&row&&row.ledgerSource==='candidate'&&!row.approvedPlacement&&!row.primaryPlacement)return'unassigned';
    return decision==='slot_candidate'?(assignedSectionKey(row)||'assignment_repair'):candidatePlacementKey(row);}
  function sectionRevenuePosition(row,sectionKey){
    var key=text(row&&row.candidateId||row&&row.id),rank=sectionRevenueView[key];
    return sectionRevenueViewScope===scopeKey()&&rank&&rank.sectionKey===sectionKey?Number(rank.rank||0):0;
  }
  function sectionRevenueViewSort(rows,key){
    if(!PRODUCT_SECTION_MAP[key]||sectionRevenueViewScope!==scopeKey())return rows;
    return rows.slice().sort(function(a,b){
      var x=sectionRevenuePosition(a,key),y=sectionRevenuePosition(b,key);
      if(x&&y)return x-y;if(x)return-1;if(y)return 1;return 0;
    });
  }
  // Explicit administrator-only relationship inspection: no implicit placement
  // writes, no AI reselection, and no front publication during either audit mode.
  var sectionLedgerAuditBusy=false,sectionLedgerAuditReport=null;
  var SECTION_LEDGER_AUDIT='/.netlify/functions/commerce-candidate-section-ledger-audit';
  function sectionLedgerAuditStatus(message){var el=$('sectionLedgerAuditState');if(el)el.textContent=message;}
  function sectionLedgerAuditButtons(){
    var locked=sectionLedgerAuditBusy||productAutomationActive||productFrontSyncActive||frontMatchCommandBusy||frontMatchDeploymentBusy;
    ['sectionLedgerAuditSelected','sectionLedgerAuditAll'].forEach(function(id){var el=$(id);if(el)el.disabled=locked;});
    var restore=$('sectionLedgerAuditRepair');if(restore)restore.disabled=locked||!sectionLedgerAuditReport||!sectionLedgerAuditReport.complete||!sectionLedgerAuditReport.repairable.length||scopeKey()!==sectionLedgerAuditReport.scope;
  }
  function sectionLedgerAuditDisplay(report){
    var el=$('sectionLedgerAuditResults');if(!el)return;
    var records=report.items||[],issueCount=records.length;
    var labels={missing_assignment:'관리자 배치만 존재 · 실제 배정 누락',section_mismatch:'관리자 확정 섹션과 실제 배정 충돌',multiple_assignments:'중복 배치 관계',inactive_candidate_assignment:'보류·제외/미배정 상품에 실제 배치가 남음',missing_admin_section:'실제 관계는 있으나 관리자 배치가 없음',cross_market_assignment:'다른 국가 배치와 식별자 공유',unknown_section:'존재하지 않는 섹션',unmanaged_source:'관리 대상 외 기록',missing_candidate:'실제 관계만 존재 · 상품 원장 없음'};
    var rows=records.slice(0,160).map(function(r){var sections=(r.actualKeys||[]).join(', ')||'없음';return '<div style="padding:5px 2px;border-bottom:1px solid #38536b"><strong>'+esc(labels[r.status]||r.status)+'</strong> · '+esc(r.title||r.candidateId)+' <span class="mono">'+esc(r.candidateId)+'</span><div>관리자 '+esc(r.desiredKey||'미확정')+' / 실제 '+esc(sections)+' · '+(r.canRepair?'확정 배치 자동 복구 가능':'관리자 확인 필요')+(r.publicationSyncRequired?' · 프론트 매칭 필요':'')+'</div></div>';}).join('');
    el.innerHTML='<div><strong>점검 '+report.keys.length+'개 섹션 · 오류 상품 '+issueCount+'건 · 자동 복구 가능 '+report.repairable.length+'건 · 관리자 확인 '+(issueCount-report.repairable.length)+'건</strong></div>'+(rows||'<div>이 범위에서 배치 관계 불일치를 발견하지 못했습니다.</div>')+(issueCount>160?'<div>상세 오류 '+(issueCount-160)+'건은 화면에 생략했습니다. 삭제하거나 복구 대상으로 간주하지 않습니다.</div>':'');
  }
  async function runSectionLedgerAudit(mode){
    if(sectionLedgerAuditBusy||productFrontSyncActive||productAutomationActive||frontMatchCommandBusy||frontMatchDeploymentBusy)return;
    var keys=mode==='all'?PRODUCT_SECTIONS.map(function(row){return row.key;}):selectedSectionKeys();
    if(!keys.length){sectionLedgerAuditStatus('점검할 섹션을 체크해 주세요. 전체 점검은 별도 버튼을 누르세요.');return;}
    if(!selectedCountry||selectedCountry==='GLOBAL'){sectionLedgerAuditStatus('점검할 국가·지역을 먼저 선택하세요.');return;}
    sectionLedgerAuditBusy=true;sectionLedgerAuditReport=null;sectionLedgerAuditButtons();
    var scope=scopeKey(),country=selectedCountry,region=selectedSubdivision||'NATIONWIDE',results=[],failed=null;
    try{
      sectionLedgerAuditStatus('원장 전체 페이지의 완전한 조회 상태를 검증하고 있습니다. 이 단계에서는 어떤 상품도 변경하지 않습니다.');
      var ledger=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true,pageSize:125,frontSyncPreflight:true});
      if(scopeKey()!==scope||!latestOverviewLedgerComplete||!ledger||!Array.isArray(ledger.products))throw new Error('전체 후보 원장 불완전 · 점검 중단');
      var candidates=ledger.products;
      for(var i=0;i<keys.length;i++){
        if(scopeKey()!==scope)throw new Error('점검 도중 국가·지역이 변경되었습니다.');
        var key=keys[i];sectionLedgerAuditStatus('배치 정합성 점검 '+(i+1)+'/'+keys.length+' · '+sectionLabel(key));
        var ids=candidates.filter(function(r){return productPlacementKey(r)===key||text(r&&r.ledgerConsistency&&r.ledgerConsistency.payloadSectionKey)===key;}).map(function(r){return frontCandidateLedgerId(r);}).filter(Boolean);
        var page=await api(SECTION_LEDGER_AUDIT,'audit','POST',{}, {action:'audit',countryCode:country,subdivisionCode:region,sectionKey:key,sectionKeys:keys,expectedCandidateIds:ids},60000);
        if(!page||page.ok!==true||!page.result||page.result.sectionKey!==key)throw new Error('섹션 점검 응답이 올바르지 않습니다: '+key);
        results.push(page.result);
      }
      var byId=Object.create(null);results.forEach(function(result){(result.issues||[]).forEach(function(r){var id=text(r.candidateId);if(!id)return;var prev=byId[id];if(!prev||(!r.canRepair&&prev.canRepair))byId[id]=r;});});
      var items=Object.keys(byId).map(function(id){return byId[id];});
      var repairable=items.filter(function(row){return row.canRepair===true;});
      sectionLedgerAuditReport={scope:scope,keys:keys.slice(),mode:mode,complete:true,items:items,repairable:repairable};
      sectionLedgerAuditDisplay(sectionLedgerAuditReport);
      sectionLedgerAuditStatus('점검 완료 · '+keys.length+'개 섹션 · 불일치 상품 '+items.length+'건 · 복구 가능 '+repairable.length+'건. 복구 버튼을 누르기 전에는 DB를 변경하지 않습니다.');
    }catch(error){failed=error;sectionLedgerAuditReport=null;sectionLedgerAuditStatus('점검 중단 · 조회 불완전 또는 오류: '+text(error&&error.message||error)+' · 부분 결과를 복구에 사용하지 않습니다.');}
    finally{sectionLedgerAuditBusy=false;sectionLedgerAuditButtons();if(failed)show('섹션 배치 정합성 점검이 완성되지 않았습니다. 데이터는 변경하지 않았습니다.','warn');}
  }
  async function runSectionLedgerRepair(){
    var report=sectionLedgerAuditReport;if(!report||!report.complete||sectionLedgerAuditBusy||scopeKey()!==report.scope||!report.repairable.length)return;
    if(report.mode==='selected'&&report.keys.join('|')!==selectedSectionKeys().join('|')){sectionLedgerAuditStatus('체크한 섹션이 바뀌었습니다. 복구 전에 선택 섹션 점검을 다시 실행해 주세요.');return;}
    if(!window.confirm('관리자 확정 배치가 명확한 '+report.repairable.length+'건만 실제 배치 원장과 일치시키겠습니까?\n중복·보류·국가 충돌·수동 고정 충돌은 복구하지 않습니다. 프론트 공개는 변경하지 않으며 이후 Front Match가 필요합니다.'))return;
    sectionLedgerAuditBusy=true;sectionLedgerAuditButtons();var fixed=0,errors=[],keys=report.keys.slice(),list=report.repairable.slice(),country=selectedCountry,region=selectedSubdivision||'NATIONWIDE';
    try{
      for(var i=0;i<list.length;i++){
        if(scopeKey()!==report.scope){errors.push('국가/지역 변경으로 중단');break;}
        var row=list[i];sectionLedgerAuditStatus('확정 배치 복구 '+(i+1)+'/'+list.length+' · 저장 직전 재검증 중 · '+text(row.candidateId));
        try{var response=await api(SECTION_LEDGER_AUDIT,'repair','POST',{}, {action:'repair',countryCode:country,subdivisionCode:region,sectionKeys:keys,candidateId:row.candidateId,desiredKey:row.desiredKey,expectedUpdatedAt:row.updatedAt,confirmation:'ADMIN_RECONCILE_CONFIRMED'},60000);if(!response||!response.result||response.result.authorityVerified!==true)throw new Error('실제 배치 원장 저장 검증 실패');fixed++;}
        catch(error){errors.push(text(row.candidateId)+' : '+text(error&&error.message||error));}
      }
      sectionLedgerAuditReport=null;sectionLedgerAuditStatus('복구 실행 완료 · 정상 저장 확인 '+fixed+'/'+list.length+'건 · 추가 확인 '+errors.length+'건'+(errors.length?' · '+errors.slice(0,3).join(' / '):'')+' · Front Match는 아직 실행하지 않았습니다. 다시 점검해 주세요.');
      if(fixed){try{await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true,pageSize:125});}catch(_refreshError){}renderProducts(productRows);}
    }finally{sectionLedgerAuditBusy=false;sectionLedgerAuditButtons();}
  }
  function wireSectionLedgerAuditControls(){
    if($('sectionLedgerAuditSelected'))$('sectionLedgerAuditSelected').addEventListener('click',function(){runSectionLedgerAudit('selected');});
    if($('sectionLedgerAuditAll'))$('sectionLedgerAuditAll').addEventListener('click',function(){runSectionLedgerAudit('all');});
    if($('sectionLedgerAuditRepair'))$('sectionLedgerAuditRepair').addEventListener('click',runSectionLedgerRepair);
  }
  function sectionRevenueTargetKeys(){
    return selectedSectionKeys();
  }
  async function requestSectionRevenueOrder(action,key,candidateId,progress){
    var offset=0,firstItems=null,response=null;
    for(var attempt=0;attempt<300;attempt++){
      response=await api(SECTION_REVENUE_RANK,'ranking','POST',{}, {
        action:action,sectionKeys:[key],candidateId:candidateId||'',countryCode:selectedCountry,
        subdivisionCode:selectedSubdivision||'NATIONWIDE',offset:offset
      },45000);
      if(!response||response.ok===false)throw new Error(text(response&&response.error)||'rank_unavailable');
      if(firstItems===null&&Array.isArray(response.items))firstItems=response.items;
      if(action!=='apply'||!Number(response.remaining||0))break;
      var next=Number(response.nextOffset||0);
      if(next<=offset)throw new Error('수익 순위 저장 위치가 진행되지 않아 중단했습니다: '+key);
      offset=next;
      if(progress)progress(offset,offset+Number(response.remaining||0));
      if(attempt===299)throw new Error('수익 순위 저장 반복 한도 초과: '+key);
    }
    if(firstItems!==null)response.items=firstItems;
    return response;
  }
  async function operateSectionRevenueRanking(action,oneSection,candidateId){
    if(sectionRevenueBusy||!selectedCountry||productFrontSyncActive||productAutomationActive||productLoopActive){show('조사 또는 공개 작업이 끝난 다음 수익 순위를 처리하세요.','warn');return;}
    var keys=oneSection?[oneSection]:sectionRevenueTargetKeys(),isApply=action==='apply';
    if(!keys.length){
      var notice='수익 우선 순위를 계산할 섹션을 먼저 선택하세요. 전체 실행은 20개 전체 선택을 체크하세요.';
      var emptyStatus=$('sectionRevenueRankingState');if(emptyStatus)emptyStatus.textContent=notice;
      show(notice,'warn');return;
    }
    if(isApply&&!window.confirm('선택된 '+keys.length+'개 섹션 안에서만 수익 우선 순번을 저장합니다. 상품 소속 섹션, 후보 원장 승인, 프론트 공개 상태는 변경하지 않습니다.\n\n적용 후 프론트에 반영하려면 기존 Front Match를 별도로 실행해야 합니다. 진행하시겠습니까?'))return;
    if(action==='pin_top'&&!window.confirm('이 상품을 소속 섹션의 최상단에 관리자 지정으로 고정하시겠습니까? 일반 자동 수익 순위 변경에서 제외됩니다.'))return;
    if(action==='unpin_top'&&!window.confirm('관리자 최상단 고정을 해제하고 일반 자동 수익 순위 관리 대상으로 되돌리시겠습니까?'))return;
    if(action==='demote'&&!window.confirm('선택 상품을 소속 섹션의 수익 우선 정렬에서 뒤쪽으로 보내겠습니까? 다른 섹션으로 옮기지 않습니다.'))return;
    sectionRevenueBusy=true;
    var status=$('sectionRevenueRankingState'),completed=0;
    if(status)status.textContent='수익 우선 순위 '+(isApply?'저장':'미리보기')+' 준비 · '+keys.length+'개 섹션';
    try{
      if(['demote','restore','pin_top','unpin_top'].includes(action)){
        await requestSectionRevenueOrder(action,keys[0],candidateId);
        if(status)status.textContent='관리자 개별 조정 저장 완료 · 해당 섹션의 수익 우선 순번을 다시 계산합니다.';
        try{await operateSectionRevenueRankFollowUp(keys[0]);if($('sectionRevenuePinPanel')&&$('sectionRevenuePinPanel').open)await refreshSectionRevenuePins();return;}
        catch(rankError){show('관리자 고정·해제는 저장됐지만 순위 재계산에 실패했습니다. 해당 섹션 순위 적용을 다시 실행하세요: '+text(rankError&&rankError.message),'warn');}
        return;
      }
      var summaries=[],items=[],failedSections=[];
      for(var i=0;i<keys.length;i++){
        var key=keys[i];
        if(status)status.textContent='수익 우선 '+(isApply?'순번 저장':'미리보기')+' · 섹션 '+(i+1)+'/'+keys.length+' · '+sectionLabel(key)+' · 정상 완료 '+completed+'개';
        try{
          // A broken assignment must not abort unrelated sections or be silently ranked.
          // Keep the failed section untouched; the administrator can inspect its
          // candidate/assignment discrepancy and retry after reconciling the ledger.
          var response=await requestSectionRevenueOrder(action,key,'',function(done,total){
            if(status)status.textContent='수익 순위 저장 · 섹션 '+(i+1)+'/'+keys.length+' · '+done+'/'+total+'건';
          });
          (response.sections||[]).forEach(function(entry){summaries.push(entry);});
          (response.items||[]).forEach(function(entry){items.push(entry);});
          completed+=1;
        }catch(sectionError){
          var reason=conciseRequestError(sectionError&&sectionError.message,sectionError&&sectionError.status)||'섹션 원장 재확인 필요';
          failedSections.push({key:key,reason:reason});
          if(status)status.textContent='수익 순위 진행 '+(i+1)+'/'+keys.length+'개 섹션 · 정상 완료 '+completed+'개 · 확인 필요 '+failedSections.length+'개 · '+sectionLabel(key)+' : '+reason;
        }
      }
      var map={};
      items.forEach(function(item){var id=text(item&&item.candidateId);if(id)map[id]=item;});
      sectionRevenueView=map;sectionRevenueViewScope=scopeKey();
      var message='수익 우선 '+(isApply?'순번 저장':'미리보기')+' · '+summaries.length+'개 섹션 · '+items.length+'개 상품 · 관리자 후순위 지정 '+summaries.reduce(function(n,x){return n+Number(x.manualDemoted||0);},0)+'건 · 관리자 최상단 고정 '+summaries.reduce(function(n,x){return n+Number(x.manualTopPinned||0);},0)+'건 · 섹션 이동 0건 · 공개 변경 0건';
      if(failedSections.length){
        var failNote=failedSections.slice(0,5).map(function(x){return sectionLabel(x.key)+' : '+x.reason;}).join(' / ');
        if(failedSections.length>5)failNote+=' 외 '+(failedSections.length-5)+'개 섹션';
        message+=' · 원장 확인 필요 '+failedSections.length+'개 섹션 · '+failNote;
      }
      if(status)status.textContent=message+(isApply?' · 정상 저장 섹션만 별도 Front Match 반영 가능, 불일치 섹션은 수정하지 않았습니다.':' · 미리보기는 저장하지 않았습니다.');
      show(message,failedSections.length?'warn':'ok');renderProducts(productRows);
    }catch(error){
      var msg='수익 순위 작업을 중단했습니다 ('+completed+'/'+keys.length+'개 섹션 완료): '+text(error&&error.message||error);
      if(status)status.textContent=msg;
      show(msg,'fail');
    }finally{sectionRevenueBusy=false;}
  }
  async function operateSectionRevenueRankFollowUp(sectionKey){
    var result=await requestSectionRevenueOrder('apply',sectionKey,'');
    sectionRevenueViewScope=scopeKey();(result.items||[]).forEach(function(item){sectionRevenueView[text(item.candidateId)]=item;});
    renderProducts(productRows);show(sectionLabel(sectionKey)+' 수익 순위 개별 조정 완료 · 다른 섹션·Front Match 변경 없음','ok');
  }
  function openSectionRevenuePins(){
    var panel=$('sectionRevenuePinPanel'),selector=$('sectionRevenuePinSection');if(!panel||!selector)return;
    if(!selector.options.length){PRODUCT_SECTIONS.forEach(function(section){var option=document.createElement('option');option.value=section.key;option.textContent=section.label;selector.appendChild(option);});}
    if(selectedSectionKeys().length===1)selector.value=selectedSectionKeys()[0];
    panel.open=true;refreshSectionRevenuePins();
  }
  async function refreshSectionRevenuePins(){
    var key=text($('sectionRevenuePinSection')&&$('sectionRevenuePinSection').value),target=$('sectionRevenuePinList');if(!key||!PRODUCT_SECTION_MAP[key]||!target)return;
    target.textContent='관리자 최상단 고정 상품 확인 중 · '+sectionLabel(key);
    try{
      var result=await requestSectionRevenueOrder('preview',key,''),ranked=Array.isArray(result.items)?result.items:[],pinned=ranked.filter(function(row){return row.override==='pin_top';});
      ranked.forEach(function(item){sectionRevenueView[text(item.candidateId)]=item;});sectionRevenueViewScope=scopeKey();
      target.innerHTML='<strong>'+esc(sectionLabel(key))+' · 고정 '+pinned.length+'건</strong>'+(pinned.length?'<div class="small">고정 상품은 일반 자동 랭킹 교체에서 우선 보호됩니다. 고정 해제 후에는 일반 상품으로 돌아갑니다.</div>'+pinned.map(function(item){return'<div class="small" style="margin:5px 0">'+esc(item.rank)+'위 · '+esc(item.title||item.candidateId)+' <button type="button" class="ghost" data-section-revenue-action="unpin_top" data-section-revenue-section="'+esc(key)+'" data-section-revenue-id="'+esc(item.candidateId)+'">고정 해제</button></div>';}).join(''):'<div class="small">현재 고정 상품이 없습니다. 아래 섹션 카드에서 상품별 「관리자 최상단 고정」을 선택하세요.</div>');
      renderProducts(productRows);
    }catch(error){target.textContent='고정 목록을 조회하지 못했습니다. '+text(error&&error.message||error);}
  }
  function wireSectionRevenueControls(){
    document.addEventListener('click',function(event){
      var node=event.target&&event.target.closest&&event.target.closest('[data-section-revenue-action]');if(!node)return;
      event.preventDefault();event.stopPropagation();var action=node.getAttribute('data-section-revenue-action'),key=node.getAttribute('data-section-revenue-section')||'',id=node.getAttribute('data-section-revenue-id')||'';
      if(action==='manage-pins'){openSectionRevenuePins();return;}
      if(action==='list-pins'){refreshSectionRevenuePins();return;}
      if(!['preview','apply','demote','restore','pin_top','unpin_top'].includes(action))return;
      operateSectionRevenueRanking(action,key,id);
    });
  }
  function candidateGroupRows(groupKey){
    if(groupKey==='quality_review')return productRows.filter(function(row){return !!verifiedProductImageReviewIssue(row);});
    if(groupKey==='latest_research')return latestResearchCanonicalCandidateRows();
    var rows=productRows.filter(candidatePoolRow);
    if(groupKey==='queue_selected'){
      var focused={};queueFocusedCandidateIds.forEach(function(id){focused[text(id)]=true;});
      return rows.filter(function(row){var candidateId=text(row&&row.candidateId),id=text(row&&row.id);return focused[candidateId]===true||focused[id]===true;});
    }
    return sectionRevenueViewSort(rows.filter(function(row){return candidateGroupKey(row)===groupKey;}),groupKey);
  }
  function selectedCandidateIds(groupKey){var valid={};candidateGroupRows(groupKey).forEach(function(row){valid[text(row.id)]=true;});return Object.keys(candidateSelectedProducts).filter(function(id){return candidateSelectedProducts[id]===true&&valid[id];});}
  function syncCandidateSelectionControls(groupKey){var rows=candidateGroupRows(groupKey),ids=selectedCandidateIds(groupKey),safeKey=groupKey.replace(/[^a-z0-9_-]/gi,'_'),all=$('candidateSelectAll-'+safeKey),count=$('candidateSelectedCount-'+safeKey),busy=productAutomationActive||productFrontSyncActive||candidateBulkActionActive[groupKey]===true,selectedMap={};ids.forEach(function(id){selectedMap[id]=true;});if(all){all.checked=rows.length>0&&ids.length===rows.length;all.indeterminate=ids.length>0&&ids.length<rows.length;all.disabled=busy||!rows.length;}Array.prototype.forEach.call(document.querySelectorAll('[data-candidate-select]'),function(box){if(box.getAttribute('data-candidate-select')===groupKey){box.checked=selectedMap[text(box.value)]===true;box.disabled=busy;}});if(count)count.textContent='선택 후보 '+ids.length+'건';Array.prototype.forEach.call(document.querySelectorAll('[data-candidate-group="'+groupKey+'"]'),function(button){button.disabled=busy||!ids.length;});var target=document.querySelector('[data-candidate-target="'+groupKey+'"]');if(target)target.disabled=busy;}
  function setCandidateBulkState(groupKey,message,kind){var safeKey=text(groupKey).replace(/[^a-z0-9_-]/gi,'_'),el=$('candidateBulkState-'+safeKey);if(!el)return;el.textContent=text(message)||'준비';el.className='candidate-bulk-state small'+(kind?' '+kind:'');}
  // The authority endpoint intentionally returns ok:false for a MIXED batch.
  // Keep its confirmed IDs, isolate refusals, and continue with the remaining
  // batches. A timeout does not prove that a database write failed.
  async function authorityCandidateAction(decision,candidateIds,placementKey,options){
    options=options||{};
    candidateIds=Array.from(new Set((candidateIds||[]).map(text).filter(Boolean)));
    if(!candidateIds.length)return{ok:true,complete:true,requested:0,processed:0,failed:0,processedIds:[],results:[],failures:[]};
    var frozen=scopeKey(),country=selectedCountry,region=selectedSubdivision||'NATIONWIDE',chunkSize=Math.max(1,Math.min(8,Number(options.chunkSize||5))),done={},failedById={},results=[];
    function capture(data,asked){
      if(!data||typeof data!=='object')return false;
      var wanted=new Set(asked),saw=false;
      (Array.isArray(data.processedIds)?data.processedIds:[]).forEach(function(id){id=text(id);if(wanted.has(id)){done[id]=true;delete failedById[id];saw=true;}});
      (Array.isArray(data.results)?data.results:[]).forEach(function(row){var id=text(row&&row.candidateId);if(!wanted.has(id))return;if(row.ok===true||row.ledgerVerified===true){done[id]=true;delete failedById[id];results.push(row);saw=true;}});
      (Array.isArray(data.failures)?data.failures:[]).forEach(function(row){var id=text(row&&row.candidateId||row&&row.id);if(id&&wanted.has(id)&&!done[id]){failedById[id]={candidateId:id,error:text(row.error||row.reason)||'상품별 이관 거부'};saw=true;}});
      return saw;
    }
    function retryable(message){return /timeout|time.?out|gateway|network|temporar|connection|fetch|502|503|504|429/i.test(text(message));}
    async function send(part){
      return api(ADMIN_AUTHORITY,'apply','POST',{}, {countryCode:country,subdivisionCode:region,candidateIds:part,decision:decision,placementKey:placementKey||'',source:options.source||'administrator',reviewReason:options.reviewReason||''},30000);
    }
    for(var offset=0;offset<candidateIds.length;offset+=chunkSize){
      if(scopeKey()!==frozen){candidateIds.slice(offset).forEach(function(id){if(!done[id])failedById[id]={candidateId:id,error:'국가·지역 변경으로 이관 중단'};});break;}
      var chunk=candidateIds.slice(offset,offset+chunkSize),data=null,batchError=null,batchWasParsed=false;
      try{data=await send(chunk);capture(data,chunk);batchWasParsed=true;}
      catch(error){batchError=error;batchWasParsed=capture(error&&error.payload,chunk);}
      // A refusal of one row must never abort other rows. Only retry explicit
      // transient failures; unknown/gateway outcomes are retried one ID at a
      // time so an already-committed row cannot be counted twice.
      var unresolved=chunk.filter(function(id){return !done[id];});
      for(var i=0;i<unresolved.length;i++){
        var id=unresolved[i],itemFailure=failedById[id];
        if(itemFailure&&!retryable(itemFailure.error))continue;
        // A fully parsed per-row refusal is definitive; avoid pointless retries.
        if(batchWasParsed&&itemFailure&&!retryable(itemFailure.error))continue;
        var lastError=batchError,received=false;
        for(var attempt=0;attempt<2&&!received;attempt++){
          if(scopeKey()!==frozen){lastError=new Error('국가·지역 변경으로 중단');break;}
          try{var one=await send([id]);received=capture(one,[id]);if(!received)lastError=new Error('서버 상품별 확정 응답 없음');else if(failedById[id]&&!retryable(failedById[id].error))break;}
          catch(err){lastError=err;received=capture(err&&err.payload,[id]);if(received&&failedById[id]&&!retryable(failedById[id].error))break;if(!transientResearchRequestError(err))break;}
          if(done[id])break;
          if(attempt===0)await new Promise(function(resolve){setTimeout(resolve,400);});
        }
        if(!done[id]&&!failedById[id])failedById[id]={candidateId:id,error:text(lastError&&lastError.message)||'처리 결과 확인 필요'};
      }
      chunk.forEach(function(id){if(!done[id]&&!failedById[id])failedById[id]={candidateId:id,error:text(batchError&&batchError.message)||'서버 저장 결과 미확인'};});
      if(typeof options.onProgress==='function')options.onProgress(Math.min(candidateIds.length,offset+chunk.length),candidateIds.length,Object.keys(failedById).length,Object.keys(done).length);
    }
    var processedIds=candidateIds.filter(function(id){return !!done[id];}),failures=candidateIds.filter(function(id){return !done[id];}).map(function(id){return failedById[id]||{candidateId:id,error:'원장 저장 결과 확인 필요'};});
    return{ok:!failures.length,complete:!failures.length,requested:candidateIds.length,processed:processedIds.length,failed:failures.length,processedIds:processedIds,results:results,failures:failures};
  }
  async function authorityAiPlacements(placements,options){
    options=options||{};placements=Array.isArray(placements)?placements.filter(function(row){return row&&text(row.candidateId)&&PRODUCT_SECTION_MAP[text(row.placementKey)];}):[];
    if(!placements.length)return{ok:true,requested:0,processed:0,failed:0,processedIds:[],results:[],failures:[]};
    var chunkSize=Math.max(1,Math.min(8,Number(options.chunkSize||6))),processed=0,failures=[],results=[],processedIds=[];
    for(var offset=0;offset<placements.length;offset+=chunkSize){
      var chunk=placements.slice(offset,offset+chunkSize),data=null,lastError=null;
      for(var attempt=0;attempt<3&&!data;attempt++){
        try{data=await api(ADMIN_AUTHORITY,'apply','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',placements:chunk,decision:'sync_ai',source:'ai_automation'},30000);}
        catch(error){lastError=error;if(!transientResearchRequestError(error)||attempt>=2)break;await new Promise(function(resolve){setTimeout(resolve,500*(attempt+1));});}
      }
      if(data){processed+=Number(data.processed||0);(data.results||[]).forEach(function(row){results.push(row);});(data.processedIds||[]).forEach(function(id){id=text(id);if(id&&processedIds.indexOf(id)<0)processedIds.push(id);});(data.failures||[]).forEach(function(row){failures.push(row);});}
      else chunk.forEach(function(row){failures.push({candidateId:text(row.candidateId),error:text(lastError&&lastError.message)||'ai_authority_sync_failed'});});
      if(typeof options.onProgress==='function')options.onProgress(Math.min(placements.length,offset+chunk.length),placements.length,failures.length);
    }
    return{ok:failures.length===0,complete:failures.length===0,requested:placements.length,processed:processed,failed:failures.length,processedIds:processedIds,results:results,failures:failures};
  }
  function applyPsomPlacementResultsLocally(results){
    var changed=0;
    (Array.isArray(results)?results:[]).forEach(function(result){
      if(!result||result.assigned!==true)return;
      var id=text(result.candidateId),key=text(result.sectionKey),section=PRODUCT_SECTION_MAP[key],row=productById(id);
      if(!id||!section||!row)return;
      var placement={page:section.page,section:section.section,sectionKey:section.section,country:selectedCountry,region:selectedSubdivision||'NATIONWIDE',administratorSelected:false,aiSelected:true,automaticPrivatePlacement:true,publicPublication:false};
      row.slotDecision='slot_candidate';row.approvedPlacement=placement;row.primaryPlacement=placement;row.placement=placement;
      // The manager has exactly one ACTIVE section per candidate and market.
      // Do not leave old sectionAssignments behind in the rendered card.
      row.sectionAssignments=(Array.isArray(row.sectionAssignments)?row.sectionAssignments:[]).filter(function(item){
        return item&&text(item.country||selectedCountry)!==selectedCountry||item&&text(item.region||selectedSubdivision||'NATIONWIDE')!==(selectedSubdivision||'NATIONWIDE');
      });
      row.sectionAssignments.unshift(Object.assign({reviewEligible:true,valueQualified:true,privateReviewOnly:true},placement));
      row.managementControl=Object.assign({},row.managementControl||{},{source:'ai_psom_bulk',administratorLocked:false,aiReclassificationAllowed:true,automaticPrivatePlacement:true});
      row.review=Object.assign({},row.review||{},{state:'pending',nextGate:'administrator_front_match'});
      productPlacementSelections[id]='section:'+key;changed+=1;
    });
    if(changed)renderProducts(productRows);
    return changed;
  }
  async function aiPlaceCandidateIds(candidateIds,options){
    options=options||{};candidateIds=Array.from(new Set((candidateIds||[]).map(text).filter(Boolean)));
    var preferredSectionKey=PRODUCT_SECTION_MAP[text(options.preferredSectionKey)]?text(options.preferredSectionKey):'';
    var requested=candidateIds.length,chunkSize=Math.max(1,Math.min(8,Number(options.chunkSize||5))),results=[],processedIds=[],counts=productSectionCounts(),frozen=scopeKey(),country=selectedCountry,region=selectedSubdivision||'NATIONWIDE';
    async function send(ids){return api(CONTROL,'product_candidate_psom_place','POST',{}, {countryCode:country,subdivisionCode:region,candidateIds:ids,balanceCounts:counts,preferredSectionKey:preferredSectionKey||null},45000);}
    var outcome={};
    function record(data,asked){
      if(!data||typeof data!=='object')return;
      counts=Object.assign({},counts,data.balanceCounts||{});
      var keys=new Set(asked);
      (Array.isArray(data.results)?data.results:[]).forEach(function(row){var id=text(row&&row.candidateId);if(!id||!keys.has(id)||outcome[id]&&outcome[id].assigned===true)return;outcome[id]=row;});
    }
    for(var offset=0;offset<candidateIds.length;offset+=chunkSize){
      if(scopeKey()!==frozen){candidateIds.slice(offset).forEach(function(id){outcome[id]={candidateId:id,assigned:false,error:'국가·지역 변경으로 작업 중단'};});break;}
      var chunk=candidateIds.slice(offset,offset+chunkSize),batchError=null;
      try{record(await send(chunk),chunk);}catch(error){batchError=error;record(error&&error.payload,chunk);}
      // Missing replies are NOT a confirmed failure. Retry only those IDs,
      // preserving successful placements already reported by the server.
      var outstanding=chunk.filter(function(id){return !outcome[id];});
      for(var j=0;j<outstanding.length;j++){
        var id=outstanding[j],lastError=batchError;
        if(scopeKey()!==frozen){outcome[id]={candidateId:id,assigned:false,error:'국가·지역 변경'};continue;}
        for(var attempt=0;attempt<2&&!outcome[id];attempt++){
          try{record(await send([id]),[id]);}catch(error){lastError=error;record(error&&error.payload,[id]);if(!transientResearchRequestError(error))break;}
          if(!outcome[id]&&attempt===0)await new Promise(function(resolve){setTimeout(resolve,400);});
        }
        if(!outcome[id])outcome[id]={candidateId:id,assigned:false,error:text(lastError&&lastError.message)||'PSOM 배치 저장 미확인'};
      }
      // Never move the cards optimistically on an unverified response. The
      // complete canonical readback below is the only UI commit boundary.
      // This prevents a temporary "copied" card if a DB write times out.

      if(typeof options.onProgress==='function')options.onProgress('analysis',Math.min(candidateIds.length,offset+chunk.length),candidateIds.length,candidateIds.slice(0,offset+chunk.length).filter(function(id){return !outcome[id]||outcome[id].assigned!==true;}).length);
    }
    results=candidateIds.map(function(id){return outcome[id]||{candidateId:id,assigned:false,error:'PSOM 처리 중단'};});
    processedIds=results.filter(function(row){return row.assigned===true;}).map(function(row){return text(row.candidateId);});
    var refreshError=null;
    try{await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});}catch(error){refreshError=error;}
    // A completed move must appear under exactly its new approved section in
    // the durable ledger. Do not clear selections on a stale or partial read.
    if(!refreshError){
      var verifiedIds=processedIds.filter(function(id){var row=productById(id),result=outcome[id];return row&&productDecision(row)==='slot_candidate'&&assignedSectionKey(row)===text(result&&result.sectionKey);});
      processedIds.forEach(function(id){if(verifiedIds.indexOf(id)<0){outcome[id]={candidateId:id,assigned:false,error:'placement_not_confirmed_at_destination'};}});
      processedIds=verifiedIds;
      results=candidateIds.map(function(id){return outcome[id];});
    }else{
      // Network ambiguity: keep the selection until the next successful read.
      processedIds=[];
    }
    var failed=requested-processedIds.length,sectionSummary={};results.forEach(function(row){var key=text(row&&row.sectionKey);if(row&&row.assigned===true&&processedIds.indexOf(text(row.candidateId))>=0&&key)sectionSummary[key]=Number(sectionSummary[key]||0)+1;});
    return{ok:failed===0,requested:requested,validated:requested,processed:processedIds.length,failed:failed,processedIds:processedIds,results:results,balanceCounts:counts,sectionSummary:sectionSummary,mode:'psom_private_pre_front',refreshWarning:refreshError?text(refreshError&&refreshError.message):null};
  }
  // Two-phase AI rank comparison: preview candidates and potential demotions,
  // then apply exactly the administrator-confirmed plan. The server calculates
  // ranks/scopes/locks and checks them AGAIN before writing any private slot.
  async function aiRankedReplaceCandidateIds(candidateIds,options){
    options=options||{};
    var ids=Array.from(new Set((candidateIds||[]).map(text).filter(Boolean))),preferred=PRODUCT_SECTION_MAP[text(options.preferredSectionKey)]?text(options.preferredSectionKey):'',batchSize=8;
    var frozen={country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'},previews=[],failures=[],accepted=[],count={place:0,replace:0,defer:0,preserve:0,quality:0};
    for(var off=0;off<ids.length;off+=batchSize){
      if(selectedCountry!==frozen.country||(selectedSubdivision||'NATIONWIDE')!==frozen.region)throw new Error('AI 비교 분석 중 관리 국가·지역이 변경됐습니다.');
      var chunk=ids.slice(off,off+batchSize),preview=null,previewError=null;
      try{preview=await api(CONTROL,'product_candidate_psom_ranked_replace','POST',{}, {countryCode:frozen.country,subdivisionCode:frozen.region,candidateIds:chunk,preferredSectionKey:preferred||null,previewOnly:true},90000);}
      catch(error){previewError=error;preview=error&&error.payload||null;}
      var previewRows=Array.isArray(preview&&preview.results)?preview.results.slice():[],seenPreview={};
      previewRows.forEach(function(item){if(item&&item.candidateId)seenPreview[text(item.candidateId)]=true;});
      for(var pi=0;pi<chunk.length;pi++){
        var previewId=chunk[pi];if(seenPreview[previewId])continue;
        try{var solo=await api(CONTROL,'product_candidate_psom_ranked_replace','POST',{}, {countryCode:frozen.country,subdivisionCode:frozen.region,candidateIds:[previewId],preferredSectionKey:preferred||null,previewOnly:true},90000),items=Array.isArray(solo&&solo.results)?solo.results:[];
          if(items.length)previewRows.push.apply(previewRows,items);else previewRows.push({candidateId:previewId,action:'defer',error:'preview_result_unconfirmed'});
        }catch(e){previewRows.push({candidateId:previewId,action:'defer',error:text(e&&e.message)||text(previewError&&previewError.message)||'preview_failed'});}
      }
      previewRows.forEach(function(item){
        previews.push(item);
        if(item.action==='replace'||item.action==='place'){accepted.push(item);count[item.action]++;}
        else if(item.error==='product_quality_review_required'){count.quality++;failures.push(item);}
        else {count.defer++;if(item.error)failures.push(item);}
      });
      if(typeof options.onProgress==='function')options.onProgress('preview',Math.min(off+batchSize,ids.length),ids.length,failures.length);
    }
    if(!accepted.length){return{requested:ids.length,processed:0,failed:failures.length,blocked:ids.length,results:previews,processedIds:[],replaced:0,noComparisonImprovement:true};}
    var previewSamples=accepted.filter(function(p){return p.action==='replace';}).slice(0,5).map(function(p){
      var current=productById(p.replacementId),incoming=productById(p.candidateId);
      return '· '+text(incoming&&incoming.productName||p.candidateId).slice(0,28)+' → '+sectionLabel(p.sectionKey)+' / '+text(current&&current.productName||p.replacementId).slice(0,28)+' ('+p.replacementScore+' → '+p.incomingScore+'점)';
    });
    var intro='국가 '+frozen.country+' / '+frozen.region+'\n비공개 미배치 상품 '+ids.length+'건 AI 랭킹 비교 완료\n';
    intro+='빈 후보 슬롯 신규 배치 '+count.place+'건 / 기존 열위 후보 치환 '+count.replace+'건 / 보류·검증 필요 '+count.defer+'건';
    intro+='\n\n공개·관리자 고정 상품은 자동 변경하지 않습니다. 치환되는 기존 후보는 삭제 없이 미배치로 되돌립니다.';
    if(previewSamples.length)intro+='\n\n교체 예정 상품 예시\n'+previewSamples.join('\n');
    intro+='\n\n이 AI 비교 결과를 관리자 원장에 적용하시겠습니까? 프론트 공개는 별도 Front Match로 진행합니다.';
    if(!window.confirm(intro))return {requested:ids.length,processed:0,failed:0,blocked:ids.length,results:previews,cancelled:true,processedIds:[]};
    var processed=0,replaced=0,failed=0,processedIds=[],results=[],partial=0;
    for(var off=0;off<accepted.length;off+=batchSize){
      if(selectedCountry!==frozen.country||(selectedSubdivision||'NATIONWIDE')!==frozen.region)throw new Error('치환 반영 중 관리 국가·지역이 변경됐습니다.');
      var chunk=accepted.slice(off,off+batchSize),plan={};
      chunk.forEach(function(item){plan[item.candidateId]={action:item.action,sectionKey:item.sectionKey,replacementId:item.replacementId||''};});
      var response=null,applyError=null,applyIds=chunk.map(function(item){return item.candidateId;});
      try{response=await api(CONTROL,'product_candidate_psom_ranked_replace','POST',{}, {countryCode:frozen.country,subdivisionCode:frozen.region,candidateIds:applyIds,preferredSectionKey:preferred||null,previewOnly:false,acceptedPlan:plan},90000);}
      catch(error){applyError=error;response=error&&error.payload||null;}
      var appliedRows=Array.isArray(response&&response.results)?response.results.slice():[],appliedMap={};
      appliedRows.forEach(function(item){if(item&&item.candidateId)appliedMap[text(item.candidateId)]=true;});
      for(var ri=0;ri<chunk.length;ri++){
        var one=chunk[ri],id=text(one.candidateId);if(appliedMap[id])continue;
        if(selectedCountry!==frozen.country||(selectedSubdivision||'NATIONWIDE')!==frozen.region){appliedRows.push({candidateId:id,assigned:false,error:'country_scope_changed'});continue;}
        try{var soloPlan={};soloPlan[id]=plan[id];var answer=await api(CONTROL,'product_candidate_psom_ranked_replace','POST',{}, {countryCode:frozen.country,subdivisionCode:frozen.region,candidateIds:[id],preferredSectionKey:preferred||null,previewOnly:false,acceptedPlan:soloPlan},90000),returned=Array.isArray(answer&&answer.results)?answer.results:[];
          appliedRows.push(returned[0]||{candidateId:id,assigned:false,error:'apply_result_unconfirmed'});
        }catch(error){appliedRows.push({candidateId:id,assigned:false,error:text(error&&error.message)||text(applyError&&applyError.message)||'ranked_apply_failed'});}
      }
      appliedRows.forEach(function(item){
        results.push(item);
        if(item.assigned===true){processed++;processedIds.push(item.candidateId);if(item.replacedExisting===true)replaced++;if(item.partial===true)partial++;}
        else failed++;
      });
      if(typeof options.onProgress==='function')options.onProgress('apply',Math.min(off+batchSize,accepted.length),accepted.length,failed);
    }
    var refreshWarning='';try{await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});}catch(e){refreshWarning=text(e&&e.message);}
    return {ok:failed===0&&partial===0,requested:ids.length,processed:processed,replaced:replaced,failed:failed,blocked:ids.length-accepted.length,partial:partial,results:results,processedIds:processedIds,refreshWarning:refreshWarning};
  }

  async function repairMissingCandidatePlacements(candidateIds,options){
    options=options||{};
    var ids=Array.from(new Set((candidateIds||[]).map(text).filter(Boolean))),preferred=text(options.preferredSectionKey||''),done=0,preserved=0,review=0,failed=0,processedIds=[],failures=[];
    var country=selectedCountry,region=selectedSubdivision||'NATIONWIDE';
    for(var offset=0;offset<ids.length;offset+=4){
      if(country!==selectedCountry||(selectedSubdivision||'NATIONWIDE')!==region){failed+=ids.length-offset;failures.push('작업 도중 국가·지역 변경');break;}
      var chunk=ids.slice(offset,offset+4),data=null;
      try{data=await api('/.netlify/functions/commerce-candidate-placement-repair','repair','POST',{}, {countryCode:country,subdivisionCode:region,candidateIds:chunk,preferredSectionKey:preferred},30000);}
      catch(error){failed+=chunk.length;failures.push(conciseRequestError(error&&error.message,error&&error.status));continue;}
      (data&&data.results||[]).forEach(function(item){
        if(item.state==='restored'){done++;processedIds.push(text(item.candidateId));}
        else if(item.state==='preserved'){preserved++;processedIds.push(text(item.candidateId));}
        else if(item.state==='review_required'){review++;failures.push(text(item.reason)||'상품 검증 필요');}
        else{failed++;failures.push(text(item.reason)||'처리 실패');}
      });
      if(typeof options.onProgress==='function')options.onProgress('repair',Math.min(offset+chunk.length,ids.length),ids.length,review+failed);
    }
    var refreshError=null;try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(e){refreshError=text(e&&e.message);}
    return {requested:ids.length,processed:done+preserved,restored:done,preserved:preserved,reviewRequired:review,failed:review+failed,processedIds:processedIds,errors:failures,refreshWarning:refreshError};
  }
  async function releaseCandidateSection(candidateIds){
    candidateIds=Array.from(new Set((candidateIds||[]).map(text).filter(Boolean)));
    if(!candidateIds.length)return{ok:true,requested:0,processed:0,failed:0};
    var result=await authorityCandidateAction('undecided',candidateIds,'',{source:'administrator'});
    try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(_refreshError){}
    return result;
  }
  async function frontUnmatchCandidateIds(candidateIds){
    candidateIds=Array.from(new Set((candidateIds||[]).map(text).filter(Boolean)));
    if(!candidateIds.length)return{ok:true,requested:0,processed:0,failed:0};
    var result=await authorityCandidateAction('front_unmatch',candidateIds,'',{source:'administrator'});
    var finalIds=Array.isArray(result&&result.processedIds)?result.processedIds:candidateIds;
    try{
      await api(CONTROL,'product_front_finalize','POST',{}, {
        countryCode:selectedCountry,
        subdivisionCode:selectedSubdivision||'NATIONWIDE',
        operation:'unmatch',
        confirmation:'SITE_UNPUBLISH',
        candidateIds:finalIds,
        changedCount:finalIds.length,
        ledgerMode:'candidate',
        compactResponse:true
      },90000);
    }catch(error){
      show(conciseRequestError(error&&error.message,error&&error.status)||'선택 상품 프론트 매칭 해제의 최종 빌드 요청을 완료하지 못했습니다.','fail');
      return Object.assign({},result,{finalizeFailed:true});
    }
    try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(_refreshError){}
    return result;
  }

  async function runCandidateBulkAction(groupKey,action){
    var ids=selectedCandidateIds(groupKey);if(!ids.length){setCandidateBulkState(groupKey,'먼저 처리할 후보를 선택해 주세요.','warn');show('먼저 처리할 후보를 선택해 주세요.','warn');return;}
    if(candidateBulkActionActive[groupKey]===true)return;
    var placement='',select=document.querySelector('[data-candidate-target="'+groupKey+'"]');
    if(action==='ai'||action==='place'){placement=text(select&&select.value);if(placement&&!PRODUCT_SECTION_MAP[placement]){setCandidateBulkState(groupKey,'선택한 수동 배치 섹션을 확인해 주세요.','warn');show('선택한 20개 섹션을 확인해 주세요.','warn');return;}}
    if((action==='hold'||action==='reject'||action==='purge'||action==='list_delete')&&!window.confirm('선택한 후보 '+ids.length+'건을 '+(action==='hold'?'보류':action==='purge'?'영구 제외':action==='list_delete'?'현재 후보 관리 목록에서만 제거':'제외')+' 처리합니다. 관리자 원장을 먼저 확정하고 프론트 반영은 별도 프론트 매칭 단계에서 동기화합니다. 계속할까요?'))return;
    candidateBulkActionActive[groupKey]=true;syncCandidateSelectionControls(groupKey);setCandidateBulkState(groupKey,'처리 준비 · 0/'+ids.length+'건','working');
    var succeeded=0,failed=0,confirmedSuccessIds=[];
    try{
      if(action==='ai'){
        var aiResult=groupKey==='assignment_repair'
          ?await repairMissingCandidatePlacements(ids,{onProgress:function(stage,done,total,failCount){setCandidateBulkState(groupKey,'배정 누락 복구 '+done+'/'+total+'건'+(failCount?' · 확인 필요 '+failCount+'건':''),failCount?'warn':'working');}})
          :await aiRankedReplaceCandidateIds(ids,{preferredSectionKey:placement||'',onProgress:function(stage,done,total,failCount){setCandidateBulkState(groupKey,(stage==='preview'?'AI 랭킹·수익 비교':'교체 원장 저장·검증')+' · '+done+'/'+total+'건'+(failCount?' · 보류·오류 '+failCount+'건':''),failCount?'warn':'working');}});
        if(aiResult.cancelled===true){setCandidateBulkState(groupKey,'랭킹 비교 후 관리자 적용 취소','warn');return;}
        succeeded=Number(aiResult&&aiResult.processed||0);failed=Number(aiResult&&aiResult.failed||0);
        var aiDone={};(aiResult&&aiResult.processedIds||[]).forEach(function(id){aiDone[text(id)]=true;});ids.forEach(function(id){if(aiDone[id])delete candidateSelectedProducts[id];});saveReviewSnapshot();
        setCandidateBulkState(groupKey,'AI 랭킹 비교 · 배치 '+succeeded+'건 · 기존 열위 후보 치환 '+Number(aiResult.replaced||0)+'건 · 검증 보류·오류 '+failed+'건'+(aiResult.refreshWarning?' · 원장 재조회 지연':''),failed||aiResult.partial?'warn':'ok');
        show('AI 후보 비교 '+ids.length+'건 · 배치 '+succeeded+'건 · 기존 열위 후보 치환 '+Number(aiResult.replaced||0)+'건 · 미배치 유지 '+Number(aiResult.blocked||0)+'건 · 오류 '+failed+'건. 관리자 확정·공개 상품은 보호됩니다.',failed||aiResult.partial?'warn':'ok');return;
      }
      if(action==='place'&&!placement){
        // A candidate group already represents the PSOM primary destination.
        // Preserve that destination when the administrator clicks the group's
        // PSOM placement button. Rebalancing may only be used from unassigned/
        // repair pools; otherwise multi-fit outdoor/food rows silently drifted
        // from distribution-extra into Home/right-rail sections.
        var psomPreferred=PRODUCT_SECTION_MAP[groupKey]?groupKey:'';
        var psomResult=groupKey==='assignment_repair'
          ?await repairMissingCandidatePlacements(ids,{onProgress:function(stage,done,total,failCount){setCandidateBulkState(groupKey,'배정정보만 복구 '+done+'/'+total+'건'+(failCount?' · 검증 필요 '+failCount+'건':''),failCount?'warn':'working');}})
          :await aiPlaceCandidateIds(ids,{preferredSectionKey:psomPreferred,onProgress:function(stage,done,total,failCount){setCandidateBulkState(groupKey,'PSOM 정책 배치 · '+done+'/'+total+'건'+(failCount?' · 확인 필요 '+failCount+'건':''),failCount?'warn':'working');}});
        succeeded=Number(psomResult&&psomResult.processed||0);failed=Number(psomResult&&psomResult.failed||0);
        var psomDone={};(psomResult&&psomResult.processedIds||[]).forEach(function(id){psomDone[text(id)]=true;});ids.forEach(function(id){if(psomDone[id])delete candidateSelectedProducts[id];});saveReviewSnapshot();
        var psomText='PSOM 기준 섹션 처리 · 성공 '+succeeded+'건 · 추가 확인 '+failed+'건'+(psomResult&&psomResult.errors&&psomResult.errors.length?' · 원인 '+psomResult.errors.slice(0,2).join(' / '):'');setCandidateBulkState(groupKey,psomText,failed?'warn':'ok');show(psomText+'. 프론트 공개는 실행하지 않았으며 실제 프론트 매칭 단계에서 상품 페이지를 다시 검증합니다.',failed?'warn':'ok');return;
      }
      if(action==='place'&&placement&&groupKey==='assignment_repair'){
        var manual=await repairMissingCandidatePlacements(ids,{preferredSectionKey:placement,onProgress:function(stage,done,total,failCount){setCandidateBulkState(groupKey,'관리자 섹션 지정 · '+done+'/'+total+'건'+(failCount?' · 검증 필요 '+failCount+'건':''),failCount?'warn':'working');}});
        var manualMessage='배정정보 복구 · 실제 복구 '+manual.restored+'건 · 기존 배치 보존 '+manual.preserved+'건 · 확인 필요 '+manual.failed+'건';
        setCandidateBulkState(groupKey,manualMessage+(manual.errors.length?' · '+manual.errors.slice(0,2).join(' / '):''),manual.failed?'warn':'ok');
        show(manualMessage+'. 프론트는 변경하지 않았습니다.',manual.failed?'warn':'ok');
        return;
      }
      var selectedRows=candidateGroupRows(groupKey).filter(function(row){return ids.indexOf(text(row&&row.id))>=0;}),ledgerRows=selectedRows.filter(function(row){return row&&row.ledgerSource==='candidate';});
      if(['hold','reject','purge','list_delete','undecided'].indexOf(action)>=0)setCandidateBulkState(groupKey,'관리자 원장 상태를 확정하는 중…','working');
      if(ledgerRows.length===selectedRows.length&&ledgerRows.length){
        var candidateIds=Array.from(new Set(ledgerRows.map(function(row){return text(row.candidateId||row.id);}).filter(Boolean))),decision=action==='place'?'slot_candidate':action==='list_delete'?'remove_from_list':action;
        var bulk;
        // All candidate moves share one verified, scoped authority.
          {
          bulk=await authorityCandidateAction(decision,candidateIds,placement||'',{source:groupKey==='latest_research'?'latest_research_group':'administrator',reviewReason:groupKey==='quality_review'&&decision==='hold'?'representative_image_requires_review':'',chunkSize:5,onProgress:function(done,total,failCount,successCount){
            setCandidateBulkState(groupKey,'국가별 원장 이관 '+done+'/'+total+'건 · 성공 '+successCount+'건 · 실패 '+failCount+'건',failCount?'warn':'working');
            if(groupKey==='latest_research'){
              var remaining=$('latestResearchWaitingCount');
              if(remaining){var original=Number(remaining.getAttribute('data-start-count')||0),confirmed=Number(successCount||0);
                remaining.textContent='이관 대기 '+Math.max(0,original-confirmed)+'건 · 현재 요청에서 원장 확인 '+confirmed+'건 (최종 재조회 진행 전)';}
            }
          }});
        }
        succeeded=Number(bulk&&bulk.processed||0);failed=Number(bulk&&bulk.failed||0);
        confirmedSuccessIds=(bulk&&bulk.processedIds||[]).map(text).filter(Boolean);
        setCandidateBulkState(groupKey,'최종 원장 새로고침 중…',failed?'warn':'working');
        await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
        // A server acknowledgement is not a move until the new canonical
        // destination is read back. Leave failed/unconfirmed rows selected.
        var accepted=[],expectedDecision=decision==='remove_from_list'?'removed_from_list':decision;
        confirmedSuccessIds.forEach(function(id){var row=productById(id)||latestOverviewCanonicalById[id],actual=row&&productDecision(row),where=row&&assignedSectionKey(row);if(row&&actual===expectedDecision&&(expectedDecision!=='slot_candidate'||where===placement)){accepted.push(id);}else{failed+=1;}});
        confirmedSuccessIds=accepted;succeeded=accepted.length;
      }else{
        var lastBulkData=null;
        for(var i=0;i<ids.length;i++){
          try{var itemDecision=action==='place'?'slot_candidate':action==='list_delete'?'remove_from_list':action;var itemData=await api(CONTROL,'product_candidate_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',productId:ids[i],decision:itemDecision,placementKey:placement||''},30000);lastBulkData=itemData;succeeded+=1;}catch(itemError){failed+=1;}
          setCandidateBulkState(groupKey,'호환 원장 처리 '+(i+1)+'/'+ids.length+'건'+(failed?' · 실패 '+failed+'건':''),failed?'warn':'working');
        }
        if(lastBulkData){lastProductJson=lastBulkData;rememberReport('product',lastBulkData);renderProductProgress(lastBulkData);renderProducts(lastBulkData.products||[]);saveReviewSnapshot();}
      }
      // Never clear failed selections. The operator must be able to retry the
      // exact remaining IDs without hunting through the source list.
      confirmedSuccessIds.forEach(function(id){delete candidateSelectedProducts[id];});saveReviewSnapshot();
      var actionLabel=action==='place'?(placement?sectionLabel(placement)+' 섹션으로 수동 배치':'PSOM 기준 자동 배치'):action==='undecided'?'미배정 후보로 복원':action==='hold'?'보류':action==='purge'?'영구 제외':action==='list_delete'?'현재 후보 관리 목록에서만 제거':action==='reject'?'제외':action;
      var failureSample=(bulk&&bulk.failures||[]).slice(0,3).map(function(f){return text(f.candidateId||f.id)+' · '+text(f.error);}).join(' / ');var resultText='요청 '+ids.length+'건 · 성공 '+succeeded+'건 · 실패 '+failed+'건'+(failureSample?' · '+failureSample:'');var pendingFront=(bulk&&bulk.results||[]).some(function(item){return item&&item.frontSyncRequired===true;});setCandidateBulkState(groupKey,resultText+' · '+actionLabel+(pendingFront?' · 프론트 동기화 대기':''),failed?'warn':'ok');if(succeeded)show(resultText+' · '+actionLabel+'했습니다. 관리자 원장은 변경됐습니다.'+(pendingFront?' 기존 프론트 상품은 Front Match 및 배포 확인 후 사라집니다.':' 프론트 공개·해제·결제는 실행하지 않았습니다. 다음 프론트 매칭 단계에서 동기화합니다.'),failed?'warn':'ok');else show(resultText+' · 처리된 항목이 없습니다. 후보 상태·ID 또는 저장 권한을 확인해 주세요.','fail');
    }catch(error){failed=Math.max(failed,ids.length-succeeded);setCandidateBulkState(groupKey,'처리 중단 · 성공 '+succeeded+'건 · 실패 '+failed+'건','fail');show(conciseRequestError(error&&error.message,error&&error.status)||'선택 후보 일괄 처리를 완료하지 못했습니다.','fail');}
    finally{candidateBulkActionActive[groupKey]=false;syncCandidateSelectionControls(groupKey);}
  }

  // Latest research is a 21st MANAGEMENT GROUP inside the known-good candidate board.
  // New research is a VIEW over the same canonical country candidate ledger.
  // Existing research candidates reuse EXACTLY the ordinary unassigned candidate
  // cards, selection state, toolbar, and event handlers. Only never-staged rows
  // have a separate registration control (they have no candidate ID yet).
  var latestInCandidateSelections={},latestInCandidatePage=0,latestInCandidateBusy=false,latestInCandidateMessage='';
  // Never create a second candidate ledger. After a verified initial registration
  // this UI remembers its REAL candidate IDs only for the currently selected
  // country/region, and passes them into the already working candidate manager.
  var latestInCandidateRecentlyRegistered={},latestInCandidateRecentJobs={};
  // The browser index is only a view hint. IDs are ALWAYS revalidated against
  // the current country/region's durable candidate ledger before rendering.
  // This prevents successful staging from disappearing after a page reload
  // when the source research inbox has correctly consumed its original row.
  function latestInCandidateStoredIds(scope){
    var job=text(lastProductJson&&lastProductJson.jobId),out={};
    if(!scope||!job)return out;
    try{var saved=JSON.parse(localStorage.getItem('igdc_latest_registered_'+scope)||'null');
      if(!saved||saved.jobId!==job||Date.now()-Number(saved.savedAt||0)>86400000)return out;
      (Array.isArray(saved.ids)?saved.ids:[]).slice(0,2000).forEach(function(id){id=text(id);if(/^[-_a-zA-Z0-9]{3,180}$/.test(id))out[id]=true;});
    }catch(_error){}return out;
  }
  function latestInCandidateRememberIds(ids,scope){
    var currentJob=text(lastProductJson&&lastProductJson.jobId);
    if(currentJob&&latestInCandidateRecentJobs[scope]!==currentJob){latestInCandidateRecentlyRegistered[scope]={};latestInCandidateRecentJobs[scope]=currentJob;}
    if(!latestInCandidateRecentlyRegistered[scope])latestInCandidateRecentlyRegistered[scope]={};
    (Array.isArray(ids)?ids:[]).forEach(function(id){id=text(id);if(id)latestInCandidateRecentlyRegistered[scope][id]=true;});
    var job=text(lastProductJson&&lastProductJson.jobId);
    if(job){var known=Object.assign({},latestInCandidateStoredIds(scope),latestInCandidateRecentlyRegistered[scope]);
      try{localStorage.setItem('igdc_latest_registered_'+scope,JSON.stringify({jobId:job,savedAt:Date.now(),ids:Object.keys(known).slice(-2000)}));}catch(_error){}
    }
  }

  function latestInCandidateRows(){
    if(!latestProductRowsComplete||!latestOverviewLedgerComplete)return [];
    // This is a WORK INBOX, not a second copy of the canonical candidate ledger.
    // The backend already excludes safely committed research-stage transfers.
    // Also exclude any older cached rows whose verified ledger decision has
    // moved to a destination, without erasing the underlying research audit.
    return latestOverviewRows().filter(function(item){
      if(item.kind==='new'||item.kind==='duplicate')return true; // unresolved: no safe single candidate to mutate
      if(item.kind!=='undecided'||!item.candidate)return false;
      var handoff=item.candidate.managementControl&&item.candidate.managementControl.latestResearchHandoff||{};
      return handoff.completed!==true;
    });
  }
  function latestResearchCanonicalCandidateRows(){
    // The canonical country/region candidate ledger is the ONLY persistent
    // registration authority. Research inbox rows are disposable, job IDs
    // rotate, and browser localStorage can be unavailable; none may decide
    // whether a committed candidate vanishes from this management list.
    var fromResearch={};
    latestInCandidateRows().forEach(function(item){
      if(item.candidateId&&item.candidate)fromResearch[item.candidateId]=true;
      (Array.isArray(item.matches)?item.matches:[]).forEach(function(row){
        if(row&&row.ledgerSource==='candidate'){
          var id=frontCandidateLedgerId(row);if(id)fromResearch[id]=true;
        }
      });
    });
    var scope=scopeKey(),hints=Object.assign({},latestInCandidateStoredIds(scope),latestInCandidateRecentlyRegistered[scope]||{});
    return productRows.filter(function(row){
      if(!row||row.ledgerSource!=='candidate'||productDecision(row)!=='undecided')return false;
      var handoff=row.managementControl&&row.managementControl.latestResearchHandoff||{};
      if(handoff.completed===true||row.queueControl&&['remove_from_list','dismiss'].includes(text(row.queueControl.action).toLowerCase()))return false;
      var registered=row.researchRegistration&&row.researchRegistration.registered===true||handoff.registered===true;
      // Older durable products predate the registration marker. They are still
      // real, scoped research candidates and must survive a page reload.
      var legacyResearch=!!(row.researchIdentity||row.pipelineSource==='live_product_research_db'||
        row.origin==='country-product-ranking-review'||row.commerceCandidate&&row.commerceCandidate.origin==='country-product-ranking-review');
      var id=frontCandidateLedgerId(row);
      return registered||legacyResearch||fromResearch[id]===true||hints[id]===true;
    });
  }
  var latestResearchDuplicateCounts={};
  function latestResearchDuplicateIdentity(row){
    // URL alone is insufficient for ambiguous seller category or listing pages.
    // A title is part of the identity, so unrelated products sharing a generic
    // URL never get conflated or auto-deleted. Query strings are retained.
    var url=productUrlMatchKey(row&&(row.originalOfficialProductUrl||row.productUrl||row.url||row.productDetailUrl)||'');
    var name=text(row&&(row.productName||row.title)||'').replace(/\s+/g,' ').toLowerCase();
    return url&&name?url+'|'+name:'';
  }
  function latestResearchDuplicateStats(rows){
    var buckets={},perId={},groups=0,extra=0;
    (Array.isArray(rows)?rows:[]).forEach(function(row){
      var key=latestResearchDuplicateIdentity(row);
      if(key)(buckets[key]||(buckets[key]=[])).push(row);
    });
    Object.keys(buckets).forEach(function(key){
      var group=buckets[key],ids=Array.from(new Set(group.map(function(row){return frontCandidateLedgerId(row);}).filter(Boolean)));
      if(ids.length<2)return;
      groups+=1;extra+=ids.length-1;
      ids.forEach(function(id){perId[id]=ids.length;});
    });
    return{groups:groups,extra:extra,perId:perId};
  }
  function latestResearchOriginalDuplicateStats(){
    var counts={},groups=0,extra=0;
    latestProductRows.forEach(function(row){var key=latestResearchDuplicateIdentity(row);if(key)counts[key]=(counts[key]||0)+1;});
    Object.keys(counts).forEach(function(key){if(counts[key]>1){groups++;extra+=counts[key]-1;}});
    return{groups:groups,extra:extra};
  }
  function latestInCandidateFresh(){
    return latestInCandidateRows().filter(function(item){return item.kind==='new'&&!item.candidateId;});
  }
  // Unified, single research desk: the two populations have different ID
  // authorities, but one visible grid, one page and one management toolbar.
  var latestResearchUnifiedFilter='all';
  function latestResearchUnifiedEntries(){
    var fresh=latestInCandidateFresh().map(function(item){return{kind:'unregistered',research:item.research,researchId:latestProductKey(item.research)};}),
      registered=latestResearchCanonicalCandidateRows().map(function(row){return{kind:'registered',candidate:row};});
    return latestResearchUnifiedFilter==='unregistered'?fresh:(latestResearchUnifiedFilter==='registered'?registered:fresh.concat(registered));
  }
  function latestResearchFreshCardHtml(item){
    // No candidate ID exists yet. Display a full *review* card, but never
    // manufacture an ID or offer section/approval operations before staging.
    var r=item.research||{},id=item.researchId,title=text(r.productName||r.title||'상품명 확인 필요'),
      original=text(r.productUrl||r.url),url=[r.verifiedDetailPageUrl,r.productUrl,r.productDetailUrl,r.originalOfficialProductUrl,r.url].map(safeProductDetailUrl).filter(Boolean)[0]||'',
      imageSources=researchCardImageSources(r),image=imageSources[0]||'',imageAlts=imageSources.slice(1),supplierUrl=safeExternalUrl(r.supplierSiteUrl||r.supplierOfficialUrl||r.officialSupplierUrl),
      supplier=text(r.supplierName||r.sellerName||r.supplier||r.merchantName||'판매처 확인 필요'),
      scope=scopeKey(),marked=!!(latestInCandidateSelections[id]&&latestInCandidateSelections[id].scope===scope),
      price=text(r.price||r.priceText||''),currency=text(r.priceCurrency||''),
      displayPrice=price?(currency==='KRW'?price.replace(/\s*KRW\s*/ig,'').replace(/원\s*$/,'')+'원':price+(currency?' '+currency:'')):'판매처에서 현재 가격 확인',
      researchState=text(r.researchStatus||r.verificationStatus||'실상품 검증 필요'),
      links=(url?externalReviewAnchor(url,'상품 원본·판매처 열기',''):'')+(supplierUrl?externalReviewAnchor(supplierUrl,'업체 사이트 확인',''):'');
    if(genericOrChallengeResearchTitle(title)||confirmedRemovedProductEvidence(r)){
      url='';links=supplierUrl?externalReviewAnchor(supplierUrl,'업체 사이트 확인',''):'';
      if(genericOrChallengeResearchTitle(title)){image='';imageAlts=[];}
    }
    var img=image?((url?'<a href="'+esc(url)+'" target="_top" data-review-link="1" rel="noreferrer external nofollow" referrerpolicy="no-referrer" aria-label="'+esc(title)+' 상품 페이지 열기">':'')+
      '<img data-product-image="1" '+(imageAlts.length?'data-image-alternates="'+esc(JSON.stringify(imageAlts))+'" ':'')+'src="'+esc(image)+'" alt="'+esc(title)+'" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">'+
      (url?'</a>':'')+'<div class="product-image-missing hidden">이미지 원본을 불러오지 못했습니다 · 추가 검증</div>'):
      '<div class="product-image-missing">상품 이미지 미확보 · 추가 검증 필요</div>';
    return '<article class="product-card" data-review-anchor="research-'+esc(id)+'">'+
      '<div class="product-card-front-select"><label class="product-front-select-label"><input type="checkbox" data-latest-candidate-new-select="'+esc(id)+'" '+(marked?'checked ':'')+(latestInCandidateBusy?'disabled ':'')+'> 이 상품 선택 · 미등록</label></div>'+
      '<div class="product-image-frame">'+img+'</div><div class="product-body">'+
      '<strong class="product-title">'+(url?externalReviewAnchor(url,title,'product-title-link'):esc(title))+'</strong>'+
      '<div class="product-price"><strong>'+esc(displayPrice)+'</strong></div>'+
      '<div class="small">판매·결제·배송 책임 업체: '+esc(supplier)+'</div>'+
      '<div class="small"><span class="pill warn">미등록 · 검증 필요</span> <span class="pill info">'+esc(researchState)+'</span></div>'+
      '<div class="product-placement-box"><div class="product-placement-title">관리 작업 선택</div><div class="product-management-row">'+
      '<select class="product-management-select" data-latest-research-single-choice="'+esc(id)+'" aria-label="'+esc(title)+' 관리 작업"><option value="">작업을 선택하세요</option>'+
      '<option value="move">검증·등록 후 미배치 목록으로 이관</option><option value="register">검증 후 후보 원장 최초 등록</option>'+
      '<option value="delete">현재 리서치 목록에서 제거</option><option value="permanent">영구 제외·재발견 차단</option></select>'+
      '<button type="button" class="product-management-apply" data-latest-research-single-apply="'+esc(id)+'" '+(latestInCandidateBusy?'disabled':'')+'>적용</button></div>'+ 
      '<div class="product-ai-recommendation">원본 상품 검증 전 · 후보 ID 없음 · 프론트 공개 불가</div></div>'+
      '<div class="product-links">'+(links||'<span class="small">검증된 상품 페이지 링크 없음</span>')+'</div>'+
      '<div class="small mono" style="overflow-wrap:anywhere">원본 조사 URL: '+esc(reviewUrlLabel(original||r.productDetailUrl||r.originalOfficialProductUrl))+'</div>'+
      '<div class="small">'+(productAccessChallengeUrl(original)?'접근 제한·인증 페이지 격리 · 상품이 삭제된 증거는 아닙니다':(url?'상품 상세주소 후보 · 실제 상품 여부 검증 필요':'업체·목록 페이지 또는 미확인 주소 · 상품으로 공개하지 않음'))+'</div>'+
      '<div class="product-actions"><span class="product-verification-note">실제 상품을 검증하여 후보 원장에 등록한 뒤 미배치 또는 20개 섹션으로 이동합니다.</span></div></div></article>';
  }
  function syncLatestResearchUnifiedSelection(){
    var mount=$('latestCandidateResearchMount'),pageSelect=mount&&mount.querySelector('[data-latest-research-select-page]');
    if(!mount)return;
    var entries=latestResearchUnifiedEntries(),page=clampPage(candidateGroupPages['candidate:latest_research']||0,entries.length,MANAGEMENT_PAGE_SIZE);
    var visible=entries.slice(page*MANAGEMENT_PAGE_SIZE,(page+1)*MANAGEMENT_PAGE_SIZE),scope=scopeKey();
    var chosen=visible.filter(function(item){return item.kind==='registered'?candidateSelectedProducts[text(item.candidate&&item.candidate.id)]===true:
      !!(latestInCandidateSelections[item.researchId]&&latestInCandidateSelections[item.researchId].scope===scope);});
    if(pageSelect){pageSelect.checked=!!visible.length&&visible.length===chosen.length;pageSelect.indeterminate=!!chosen.length&&chosen.length<visible.length;pageSelect.disabled=!visible.length||latestInCandidateBusy;}
    var selectedNew=latestInCandidateFresh().filter(function(item){var id=latestProductKey(item.research),entry=latestInCandidateSelections[id];return !!(entry&&entry.scope===scope);});
    var counter=mount.querySelector('#latestInCandidateSelected');if(counter)counter.textContent='선택: 미등록 '+selectedNew.length+'건 · 등록 후보 '+selectedCandidateIds('latest_research').length+'건';
    var selectedRegistered=selectedCandidateIds('latest_research').length,canWrite=!latestInCandidateBusy&&!latestQueueActionActive&&!productAutomationActive&&!productFrontSyncActive&&latestProductRowsComplete&&latestOverviewLedgerComplete;
    Array.prototype.forEach.call(mount.querySelectorAll('[data-latest-unified-action]'),function(button){
      var action=button.getAttribute('data-latest-unified-action');
      if(action==='select_missing'){
        var pageNumber=clampPage(candidateGroupPages['candidate:latest_research']||0,entries.length,MANAGEMENT_PAGE_SIZE);
        var pageRows=entries.slice(pageNumber*MANAGEMENT_PAGE_SIZE,(pageNumber+1)*MANAGEMENT_PAGE_SIZE);
        button.disabled=!canWrite||!pageRows.some(function(x){return x.kind==='unregistered'&&confirmedRemovedProductEvidence(x.research);});
      }else button.disabled=!canWrite||(!selectedNew.length&&!selectedRegistered)||((action==='register'||action==='hold'||action==='reject'||action==='prune_confirmed_missing')&&!(action==='register'||action==='prune_confirmed_missing'?selectedNew.length:selectedRegistered));
    });
  }
  function latestResearchSelectedEntries(){
    var scope=scopeKey();return latestResearchUnifiedEntries().filter(function(item){
      if(item.kind==='registered'){var id=text(item.candidate&&item.candidate.id);return !!id&&candidateSelectedProducts[id]===true;}
      var saved=latestInCandidateSelections[item.researchId];return !!(saved&&saved.scope===scope);
    });
  }
  async function latestResearchMoveToUnassigned(entries){
    // Stage never-staged research using the EXISTING official verifier, then
    // persist a handoff marker on the same real candidate IDs (no clones).
    var frozen=scopeKey(),newIds=entries.filter(function(e){return e.kind==='unregistered';}).map(function(e){return e.researchId;}),
      existing=entries.filter(function(e){return e.kind==='registered';}).map(function(e){return frontCandidateLedgerId(e.candidate);}).filter(Boolean),confirmed=[];
    if(newIds.length){
      var stage=await runLatestInCandidateAction('stage',{researchIds:newIds,skipConfirm:true});
      confirmed=Array.isArray(stage&&stage.confirmed)?stage.confirmed:[];
    }
    if(scopeKey()!==frozen)throw new Error('관리 국가·지역이 변경되어 이관을 중지했습니다.');
    var wanted=Array.from(new Set(existing.concat(confirmed))).filter(function(id){
      var row=productById(id);return row&&row.ledgerSource==='candidate'&&productDecision(row)==='undecided'&&!frontPublicationActive(row);
    });
    if(!wanted.length){show('검증되어 등록된 비공개 후보가 없어 미배치 이관을 실행하지 않았습니다.','warn');return;}
    var move=await authorityCandidateAction('undecided',wanted,'',{source:'latest_research_group',chunkSize:5,onProgress:function(done,total,failCount,successCount){var state=$('latestInCandidateStatus');if(state)state.textContent='미배치 이관 '+done+'/'+total+'건 · 확정 '+successCount+'건 · 확인 필요 '+failCount+'건';}});
    await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
    var successful=(move.processedIds||[]).filter(function(id){var row=productById(id),h=row&&row.managementControl&&row.managementControl.latestResearchHandoff||{};
      return row&&productDecision(row)==='undecided'&&h.completed===true&&h.destination==='unassigned';});
    successful.forEach(function(id){delete candidateSelectedProducts[id];});
    if(scopeKey()===frozen){latestResearchUnifiedFilter='all';candidateGroupPages['candidate:latest_research']=0;renderProductCandidateGroups();}
    var msg='미배치 목록 이관 · 요청 '+wanted.length+'건 · 원장 재조회 확인 '+successful.length+'건 · 추가 확인 '+(wanted.length-successful.length)+'건';
    latestInCandidateMessage=msg;show(msg,wanted.length===successful.length?'ok':'warn');
  }
  async function latestResearchBulkAction(action,override){
    if(latestInCandidateBusy||latestQueueActionActive)return;
    if(!selectedCountry||selectedCountry==='GLOBAL'||!latestOverviewLedgerComplete){show('국가·지역의 영구 후보 원장이 완전히 조회된 뒤 작업하세요.','warn');return;}
    var selected=Array.isArray(override)?override:latestResearchSelectedEntries(),frozen=scopeKey();
    if(!latestProductRowsComplete&&selected.some(function(item){return item.kind==='unregistered';})){show('미등록 리서치 원본을 먼저 전체 조회한 뒤 등록하세요. 기존에 등록된 원장 상품은 계속 관리할 수 있습니다.','warn');return;}
    if(action==='select_missing'){
      var entries=latestResearchUnifiedEntries(),pageNumber=clampPage(candidateGroupPages['candidate:latest_research']||0,entries.length,MANAGEMENT_PAGE_SIZE),visible=entries.slice(pageNumber*MANAGEMENT_PAGE_SIZE,(pageNumber+1)*MANAGEMENT_PAGE_SIZE),matched=0;
      visible.forEach(function(item){
        if(item.kind==='registered'){var candidateId=text(item.candidate&&item.candidate.id);if(candidateId)delete candidateSelectedProducts[candidateId];}
        else if(item.researchId){delete latestInCandidateSelections[item.researchId];if(confirmedRemovedProductEvidence(item.research)){latestInCandidateSelections[item.researchId]={scope:frozen,candidateId:''};matched++;}}
      });
      syncLatestResearchUnifiedSelection();show('현재 페이지에서 실상품 삭제가 확인된 미등록 '+matched+'건만 선택했습니다. 삭제 전에 해당 상품의 기록을 확인하십시오.','ok');return;
    }
    if(!selected.length){show('현재 리서치 관리 영역에서 상품을 선택하세요.','warn');return;}
    var fresh=selected.filter(function(x){return x.kind==='unregistered';}),registered=selected.filter(function(x){return x.kind==='registered';}),
      registeredIds=Array.from(new Set(registered.map(function(x){return frontCandidateLedgerId(x.candidate);}).filter(Boolean)));
    if(action==='move'||action==='register'){
      if(action==='move'){
        if(!window.confirm('선택 상품 '+selected.length+'건을 실제 상품 검증·후보 원장 등록 후 미배치 상품 목록으로 이관합니까? 검증 실패 상품은 원래 목록에 남습니다.'))return;
        try{await latestResearchMoveToUnassigned(selected);}catch(err){show('미배치 이관 미완료: '+text(err&&err.message),'warn');}return;
      }
      if(fresh.length)await runLatestInCandidateAction('stage',{researchIds:fresh.map(function(x){return x.researchId;})});
      else show('선택된 미등록 상품이 없습니다. 기존 후보는 미배치 이동 버튼을 사용하세요.','warn');
      return;
    }
    if(action==='prune_confirmed_missing'){
      var verifiedMissing=fresh.filter(function(x){return confirmedRemovedProductEvidence(x.research);});
      if(registered.length||verifiedMissing.length!==selected.length){show('삭제하지 않았습니다. 최근 리서치에서 HTTP 404·410 또는 명시적인 상품 삭제가 확인된 미등록 상품만 정리할 수 있습니다. 이미지 누락·CAPTCHA·403·429·업체 페이지 이동은 삭제 근거가 아닙니다.','warn');return;}
      if(!window.confirm('선택한 미등록 상품 '+verifiedMissing.length+'건의 저장된 실상품 검증 기록에 삭제/존재하지 않음이 명시되어 있습니다. 현재 리서치 작업 목록에서만 제거합니까? 원본 감사 이력은 보존되고 다음 조사에서 다시 발견할 수 있습니다.'))return;
      var ids=verifiedMissing.map(function(x){return x.researchId;});
      var response=await runLatestProductQueueAction('delete','selected',{idsOverride:ids,skipConfirm:true});
      if(response&&response.ok===true){await refreshLatestResearchRows(selectedCountry,selectedSubdivision||'NATIONWIDE',{throwOnFailure:true});renderLatestResearchCandidateGroup();}
      else show('목록 삭제 결과 확인이 필요합니다. 원장 재조회 후 다시 확인하세요.','warn');
      return;
    }
    if(action==='permanent'){
      if(!window.confirm('선택한 '+selected.length+'건에 영구 삭제를 요청합니다.\n\n미등록 상품은 재발견을 차단하는 영구 제외 기록을 남기고 리서치 목록에서 제거합니다. 이미 등록된 후보는 실제 공개/배치 보호 검사를 통과할 때만 후보 원장과 관계를 완전 삭제합니다. 실패한 상품은 보존됩니다. 계속합니까?'))return;
      if(!window.confirm('마지막 확인: 선택 상품을 영구 삭제/영구 제외 처리합니다. 이 작업은 복원되지 않을 수 있습니다. 계속합니까?'))return;
    }else if(!window.confirm('선택 상품 '+selected.length+'건을 '+({hold:'보류',reject:'제외',delete:'현재 목록에서 제거'}[action]||action)+' 처리합니까? 등록 여부에 따라 처리 가능한 상품만 처리합니다.'))return;
    latestInCandidateBusy=true;latestInCandidateMessage='현재 국가 '+frozen+' · 선택 '+selected.length+'건 '+action+' 처리 중';syncLatestResearchUnifiedSelection();
    var success=0,failures=[];
    try{
      if(scopeKey()!==frozen)throw new Error('국가·지역이 변경됐습니다.');
      if(registeredIds.length){
        var protectedIds=registeredIds.filter(function(id){var row=productById(id);return !row||frontPublicationActive(row)||productDecision(row)!=='undecided';});
        protectedIds.forEach(function(id){failures.push(id+' · 공개 또는 원장 상태 보호');});
        var allowed=registeredIds.filter(function(id){return protectedIds.indexOf(id)<0;});
        if(allowed.length){
          if(action==='permanent'){
            // Server's hard-delete accepts ONLY confirmed private HOLD/REJECT;
            // first mark excluded, then remove exact IDs under the full guard.
            for(var i=0;i<allowed.length;i++){
              if(scopeKey()!==frozen)throw new Error('국가·지역 변경으로 남은 영구 삭제를 중단했습니다.');
              var id=allowed[i],step1=await exclusionQueueBulk('',[id],'reject',null,{country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'});
              if(!step1.processedIds||step1.processedIds.indexOf(id)<0){failures.push(id+' · 제외 상태 저장 확인 실패: '+text(step1.failures&&step1.failures[0]&&step1.failures[0].error));continue;}
              var step2=await exclusionQueueBulk('reject',[id],'hard_delete',null,{country:selectedCountry,region:selectedSubdivision||'NATIONWIDE',hardDelete:true,scope:frozen});
              if(step2.processedIds&&step2.processedIds.indexOf(id)>=0){success++;delete candidateSelectedProducts[id];}
              else failures.push(id+' · 공개 해제/실제 원장 검증 차단: '+text(step2.failures&&step2.failures[0]&&step2.failures[0].error));
            }
          }else{
            var op=action==='delete'?'remove_from_list':action,
              result=await exclusionQueueBulk('',allowed,op,null,{country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'});
            success+=(result.processedIds||[]).length;
            (result.processedIds||[]).forEach(function(id){delete candidateSelectedProducts[id];});
            (result.failures||[]).forEach(function(f){failures.push(text(f.id)+' · '+text(f.error));});
          }
        }
      }
      if(fresh.length){
        if(action==='hold'){failures.push('미등록 '+fresh.length+'건 · 먼저 검증·원장 등록 필요');}
        else{
          var requested=fresh.map(function(x){return x.researchId;}),operation=action==='permanent'||action==='reject'?'purge':'delete';
          var out=await runLatestProductQueueAction(operation,'selected',{idsOverride:requested,skipConfirm:true});
          if(out&&out.ok===true){success+=Math.max(0,requested.length-Number(out.failed||0)-Number(out.blocked||0));}
          else failures.push('미등록 원본 처리 결과 미확정 · 리서치 원장 재조회 필요');
          if(out&&out.blocked)failures.push('미등록 상품 '+out.blocked+'건 · 후속 관계 보호로 처리 차단');
        }
      }
      if(scopeKey()!==frozen)throw new Error('국가·지역 변경으로 후속 표시를 중단했습니다.');
      await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
      await refreshLatestResearchRows(selectedCountry,selectedSubdivision||'NATIONWIDE',{throwOnFailure:true});
      latestResearchUnifiedFilter='all';candidateGroupPages['candidate:latest_research']=0;
      latestInCandidateMessage='요청 '+selected.length+'건 · 서버 처리 '+success+'건 · 차단/추가 확인 '+failures.length+'건'+(failures.length?' · '+failures.slice(0,2).join(' / '):'');
      show(latestInCandidateMessage,failures.length?'warn':'ok');
    }catch(err){latestInCandidateMessage='작업 완료 여부 재확인 필요: '+text(err&&err.message);show(latestInCandidateMessage,'warn');}
    finally{latestInCandidateBusy=false;renderProductCandidateGroups();}
  }
  function renderLatestResearchCandidateGroup(){
    var mount=$('latestCandidateResearchMount');if(!mount)return;
    var oldGroup=mount.querySelector('[data-product-group="latest_research"]'),wasOpen=!!(oldGroup&&oldGroup.open),
      registered=latestResearchCanonicalCandidateRows(),all=latestInCandidateRows(),fresh=latestInCandidateFresh(),
      duplicateInfo=latestResearchDuplicateStats(registered),originalDuplicates=latestResearchOriginalDuplicateStats(),
      countryKey=scopeKey(),complete=latestProductRowsComplete&&latestOverviewLedgerComplete;
    var selected=fresh.filter(function(item){var id=latestProductKey(item.research),entry=latestInCandidateSelections[id];return !!(entry&&entry.scope===countryKey);});
    latestResearchDuplicateCounts=duplicateInfo.perId;
    var canonical=productGroupDetails('latest_research','최신 리서치 상품 · 기존 후보 원장 공동 관리 · 총 '+(registered.length+fresh.length)+'건',registered.concat(fresh.map(function(item){return item.research;})),'candidate');
    // Remove the old secondary candidate-only toolbar: one visible action bar
    // serves both unregistered research and candidates with durable IDs.
    canonical=canonical.replace(/<div class="section-product-toolbar candidate-bulk-toolbar">[\s\S]*?<\/div>/,'');
    var controls='<div id="latestInCandidateNew" class="section-product-toolbar latest-research-unified-toolbar" aria-label="최신 리서치 통합 관리" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">'+
      '<label class="product-front-select-label"><input type="checkbox" data-latest-research-select-page="1" '+(latestInCandidateBusy?'disabled ':'')+'> 현재 페이지 전체 선택 (최대 100건)</label>'+
      '<span class="pill info">100개씩 보기</span>'+
      '<label class="small">등록 구분 <select id="latestResearchUnifiedFilter" aria-label="등록 상태 필터"><option value="all"'+(latestResearchUnifiedFilter==='all'?' selected':'')+'>전체 ('+(fresh.length+registered.length)+')</option><option value="unregistered"'+(latestResearchUnifiedFilter==='unregistered'?' selected':'')+'>미등록 ('+fresh.length+')</option><option value="registered"'+(latestResearchUnifiedFilter==='registered'?' selected':'')+'>등록 완료 ('+registered.length+')</option></select></label>'+
      '<span id="latestInCandidateSelected">선택 미등록 '+selected.length+'건</span>'+
      '<button type="button" class="product-section-front-button" data-latest-unified-action="move" disabled>선택 상품 미배치 목록으로 이관</button>'+
      '<button type="button" data-latest-unified-action="register" disabled>선택 미등록 검증·최초 등록</button>'+
      '<button type="button" class="secondary" data-latest-unified-action="hold" disabled>선택 후보 보류</button>'+
      '<button type="button" class="danger" data-latest-unified-action="reject" disabled>선택 후보 제외</button>'+
      '<button type="button" class="secondary" data-latest-unified-action="delete" disabled>선택 상품 목록 삭제</button>'+      '<button type="button" class="secondary" data-latest-unified-action="select_missing" disabled>현재 페이지 검증된 부재만 선택</button>'+      '<button type="button" class="secondary" data-latest-unified-action="prune_confirmed_missing" disabled>선택한 확정 부재 상품 목록 정리</button>'+
      '<button type="button" class="danger" data-latest-unified-action="permanent" disabled>선택 상품 영구 삭제</button>'+
      '<button type="button" data-latest-candidate-new-action="refresh" '+(latestInCandidateBusy?'disabled ':'')+'>리서치·후보 원장 재조회</button>'+
      '<button type="button" data-pipeline-diagnostic="download-latest">점검 JSON 다운로드</button>'+
      '<span id="latestInCandidateStatus" class="small" aria-live="polite">'+esc(latestInCandidateMessage||'국가·지역 원장 연결 준비')+'</span></div>';
    canonical=canonical.replace('<div class="product-group-grid"></div>',controls+'<div class="product-group-grid"></div>');
    mount.innerHTML='<div class="small" style="margin:10px 0">'+(!latestOverviewLedgerComplete?'후보 원장 조회 중 · ':'')+(!latestProductRowsComplete?'최신 리서치 원본 확인 중 · ':'')+'관리 국가·지역 <strong>'+esc(countryKey)+'</strong> · 현재 리서치 원본 '+all.length+'건 · 등록 관리 '+registered.length+'건 · 미등록 '+fresh.length+'건 · 중복 후보 '+duplicateInfo.extra+'건 · 원본 중복 '+originalDuplicates.extra+'건. <strong>하나의 목록·하나의 페이지</strong>에서 확인하고, 등록 후 기존 ID로 미배치/20개 섹션에 이관합니다. 이미지 누락만으로 삭제하지 않습니다. 확정 부재 선택은 저장된 검사 증거가 있는 상품에만 적용합니다.</div>'+canonical;
    var group=mount.querySelector('[data-product-group="latest_research"]');
    wireProductGroupDetails(mount,{latest_research:registered},'candidate');
    if(group&&wasOpen)group.open=true;
    if(!group)return;
    group.addEventListener('change',function(event){
      var target=event.target;if(!target)return;
      if(target.id==='latestResearchUnifiedFilter'){
        latestResearchUnifiedFilter=target.value;candidateGroupPages['candidate:latest_research']=0;renderLatestResearchCandidateGroup();return;
      }
      if(target.hasAttribute('data-latest-research-select-page')){
        var entries=latestResearchUnifiedEntries(),page=clampPage(candidateGroupPages['candidate:latest_research']||0,entries.length,MANAGEMENT_PAGE_SIZE),visible=entries.slice(page*MANAGEMENT_PAGE_SIZE,(page+1)*MANAGEMENT_PAGE_SIZE);
        visible.forEach(function(item){if(item.kind==='registered'){var id=text(item.candidate&&item.candidate.id);if(id)candidateSelectedProducts[id]=target.checked===true;}
          else if(item.researchId){if(target.checked)latestInCandidateSelections[item.researchId]={scope:countryKey,candidateId:''};else delete latestInCandidateSelections[item.researchId];}});
        syncCandidateSelectionControls('latest_research');syncLatestResearchUnifiedSelection();return;
      }
      var id=target.getAttribute('data-latest-candidate-new-select');if(!id)return;
      if(target.checked)latestInCandidateSelections[id]={scope:countryKey,candidateId:''};else delete latestInCandidateSelections[id];
      syncLatestResearchUnifiedSelection();
    });
    group.addEventListener('click',function(event){var btn=event.target.closest('[data-latest-candidate-new-action]');if(!btn)return;
      event.preventDefault();event.stopPropagation();var action=btn.getAttribute('data-latest-candidate-new-action');
      if(action==='clear'){latestInCandidateSelections={};renderLatestResearchCandidateGroup();return;}
      if(action==='refresh'){Promise.all([refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true}),refreshLatestResearchRows(selectedCountry,selectedSubdivision||'NATIONWIDE',{throwOnFailure:true})]).then(renderLatestResearchCandidateGroup).catch(function(error){show('원장 재조회 오류: '+text(error.message),'warn');});return;}
      if(action==='stage'||action==='stage_all')runLatestInCandidateAction(action);
    });
    group.addEventListener('click',function(event){
      var btn=event.target.closest('[data-latest-unified-action],[data-latest-research-single-apply]');if(!btn)return;
      event.preventDefault();event.stopPropagation();
      if(btn.hasAttribute('data-latest-unified-action')){latestResearchBulkAction(btn.getAttribute('data-latest-unified-action'));return;}
      var id=btn.getAttribute('data-latest-research-single-apply'),select=Array.prototype.find.call(group.querySelectorAll('[data-latest-research-single-choice]'),function(x){return x.getAttribute('data-latest-research-single-choice')===id;});
      var action=select&&select.value;if(!action){show('상품의 관리 작업을 선택해 주세요.','warn');return;}
      var item=latestResearchUnifiedEntries().find(function(x){return x.kind==='unregistered'&&x.researchId===id;});
      if(item)latestResearchBulkAction(action,[item]);
    });
    syncCandidateSelectionControls('latest_research');syncLatestResearchUnifiedSelection();
  }
  async function runLatestInCandidateAction(action,options){
    options=options||{};
    if(latestInCandidateBusy||latestQueueActionActive)return;
    if(!selectedCountry||selectedCountry==='GLOBAL'){show('관리할 국가·지역을 먼저 선택하세요.','warn');return;}
    if(!latestProductRowsComplete||!latestOverviewLedgerComplete){show('리서치와 후보 원장 전체 조회가 완료된 뒤 등록하세요.','warn');return;}
    var frozen=scopeKey(),allMode=action==='stage_all';
    var overrideIds=Array.isArray(options.researchIds)?new Set(options.researchIds.map(text)):null;
    var chosen=latestInCandidateFresh().filter(function(item){
      if(overrideIds)return overrideIds.has(latestProductKey(item.research));
      if(allMode)return true;
      var id=latestProductKey(item.research),choice=latestInCandidateSelections[id];
      return !!(choice&&choice.scope===frozen);
    });
    if(!chosen.length){show('현재 국가·지역에서 최초 등록할 미등록 상품이 없습니다.','warn');return;}
    if(!options.skipConfirm&&!window.confirm('선택 국가·지역 '+frozen+' · '+(allMode?'미등록 전체 ':'선택 미등록 ')+chosen.length+'건을 상품별로 검증합니다. 검증된 실상품만 현재 후보 원장에 등록하며, 등록된 상품은 기존 미배치 관리 기능을 그대로 사용합니다. 진행할까요?'))return;
    latestInCandidateBusy=true;
    latestInCandidateMessage='상품 상세 검증·기존 후보 원장 최초 등록 0/'+chosen.length+'건';
    renderLatestResearchCandidateGroup();
    var registeredIds=[],failed=[],held=0,alreadyFound=0,confirmed=[],needsReadback=[];
    try{
      // Existing research-source stage is the only authorized creator of real
      // candidate IDs.  The working candidate manager only accepts those IDs.
      // Process one research product at a time, never invent a local ID.
      for(var i=0;i<chosen.length;i++){
        if(scopeKey()!==frozen)throw new Error('관리 국가·지역 변경으로 나머지 등록을 중단했습니다.');
        var item=chosen[i],researchId=latestProductKey(item.research),staged=null;
        try{
          staged=await runLatestProductQueueAction('stage','selected',{idsOverride:[researchId],skipConfirm:true,deferLedgerReadback:true});
          var returnedIds=Array.isArray(staged&&staged.candidateIds)?staged.candidateIds.map(text).filter(Boolean):[];
          returnedIds.forEach(function(id){if(registeredIds.indexOf(id)<0)registeredIds.push(id);});
          if(!returnedIds.length){
            if(Number(staged&&staged.routedHold||0)>0||Number(staged&&staged.routedReject||0)>0)held++;
            else {failed.push(researchId+' · '+text(staged&&staged.error&&staged.error.message||'상세상품 검증 보류·후보 ID 미발급'));if(staged&&staged.error)needsReadback.push(item);}
          }
        }catch(error){needsReadback.push(item);failed.push(researchId+' · '+text(error&&error.message||'등록 서버 호출 실패'));}
        latestInCandidateMessage='선택 국가 '+frozen+' · 미등록 상품 검증 '+(i+1)+'/'+chosen.length+' · 후보 ID 발급 '+registeredIds.length+'건 · 보류·제외 '+held+'건 · 확인 필요 '+failed.length+'건';
        var state=$('latestInCandidateStatus');if(state)state.textContent=latestInCandidateMessage;
      }
      if(scopeKey()!==frozen)throw new Error('국가·지역이 바뀌어 신규 등록 결과 반영을 중단했습니다.');
      // Server acknowledgement is NOT enough. Read the canonical management
      // ledger and allow operations only on candidates found there.
      var current=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
      if(!(current&&current.pipeline&&current.pipeline.ledgerLoadComplete===true))
        throw new Error('등록 후 실제 후보 원장 전체 재조회가 완료되지 않았습니다.');
      var map={};productRows.filter(function(row){return row&&row.ledgerSource==='candidate';}).forEach(function(row){
        var id=frontCandidateLedgerId(row);if(id)map[id]=row;
      });
      confirmed=registeredIds.filter(function(id){return !!map[id];});
      // A timed-out request can have committed before the client got HTTP 504.
      // Reconcile only exact URL+title identities and only when a SINGLE scoped
      // durable candidate matches. Never retry the write or generate a new ID.
      needsReadback.forEach(function(item){var r=item.research||{},urlKey=productUrlMatchKey(r.productUrl||r.url),wanted=text(r.productName||r.title).trim().toLowerCase();if(!urlKey||!wanted)return;var hits=productRows.filter(function(row){return row&&row.ledgerSource==='candidate'&&productUrlMatchKey(row.productUrl||row.url||row.originalOfficialProductUrl)===urlKey&&text(row.productName||row.title).trim().toLowerCase()===wanted;});if(hits.length!==1)return;var id=frontCandidateLedgerId(hits[0]);if(id&&confirmed.indexOf(id)<0){confirmed.push(id);failed=failed.filter(function(msg){return msg.indexOf(latestProductKey(r)+' · ')!==0;});}});
      if(confirmed.length<registeredIds.length)failed.push('서버가 반환한 후보 '+(registeredIds.length-confirmed.length)+'건을 실제 후보 원장에서 확인하지 못했습니다.');
      // The legacy source stage can stop listing a transferred research row.
      // Retain verified candidate IDs for this *scope* so the new management
      // group still displays them and uses normal candidate bulk actions.
      latestInCandidateRememberIds(confirmed,frozen);if(confirmed.length){latestResearchUnifiedFilter='registered';candidateGroupPages['candidate:latest_research']=0;}
      confirmed.forEach(function(id){candidateSelectedProducts[id]=true;});
      chosen.forEach(function(item){var key=latestProductKey(item.research);if(key&&confirmed.some(function(id){return !!map[id]&&productUrlMatchKey(map[id].productUrl||map[id].url)===productUrlMatchKey(item.research.productUrl||item.research.url);}))delete latestInCandidateSelections[key];});
      var registeredRows=latestResearchCanonicalCandidateRows(),first=registeredRows.findIndex(function(row){return confirmed.indexOf(frontCandidateLedgerId(row))>=0;});
      if(first>=0)candidateGroupPages['candidate:latest_research']=Math.floor(first/MANAGEMENT_PAGE_SIZE);
      latestInCandidateMessage='신규 리서치 검증 '+chosen.length+'건 · 후보 원장 등록 확인 '+confirmed.length+'건 · 보류·제외 '+held+'건 · 추가 확인 '+failed.length+'건'+(failed.length?' · '+failed.slice(0,2).join(' / '):'');
      saveReviewSnapshot();
      renderLatestResearchCandidateGroup();
      var mount=$('latestCandidateResearchMount'),group=mount&&mount.querySelector('[data-product-group="latest_research"]');
      if(group&&confirmed.length){group.open=true;try{group.scrollIntoView({block:'start',behavior:'smooth'});}catch(_e){}}
      show(latestInCandidateMessage+(confirmed.length?' · 등록된 후보를 같은 카드·선택·일괄 배치 기능에서 바로 관리할 수 있습니다.':''),failed.length?'warn':'ok');
      return {confirmed:confirmed,failed:failed};
    }catch(error){latestInCandidateMessage='리서치 최초 등록 중단: '+text(error&&error.message);show(latestInCandidateMessage,'warn');return {confirmed:[],failed:[text(error&&error.message)]};}
    finally{latestInCandidateBusy=false;renderLatestResearchCandidateGroup();}
  }

  // In-memory ID/title/URL search over the already fully loaded canonical
  // candidate ledger. The front's visible slot order is not the admin list order.
  // This lookup is navigation only; it never modifies, copies or publishes rows.
  function ensureManagementProductLookup(){
    var panel=$('productCandidatePanel');if(!panel||panel.querySelector('[data-management-lookup]'))return;
    var wrap=document.createElement('div');wrap.setAttribute('data-management-lookup','1');
    wrap.style.cssText='margin:8px 0 12px;padding:10px;border:1px solid #52728a;border-radius:8px';
    wrap.innerHTML='<label class="small" for="igdc-management-product-lookup">전체 관리자 상품 ID · 제목 · 상세주소 검색 (읽기 전용)</label> '+
      '<input id="igdc-management-product-lookup" type="search" placeholder="상품 ID / 제목 / 상품 상세 URL" style="max-width:540px;width:90%;margin:4px 0" autocomplete="off">'+
      '<div data-management-lookup-results class="small" aria-live="polite"></div>';
    var anchor=$('productGrid');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(wrap,anchor);
    else panel.appendChild(wrap);
    wrap.querySelector('input').addEventListener('input',function(){renderManagementProductLookup(wrap,this.value);});
  }
  function renderManagementProductLookup(wrap,query){
    var out=wrap&&wrap.querySelector('[data-management-lookup-results]');if(!out)return;
    query=text(query).toLowerCase();if(query.length<2){out.textContent='';return;}
    var all=productRows.filter(function(row){return row&&row.ledgerSource==='candidate';});
    var matching=all.filter(function(row){return [row.candidateId,row.id,row.productName,row.title,row.productUrl,row.url].some(function(value){return text(value).toLowerCase().indexOf(query)>=0;});});
    out.innerHTML='조회 '+matching.length+'건 (표시 '+Math.min(12,matching.length)+'건)'+matching.slice(0,12).map(function(row){
      var key=assignedSectionKey(row)|| (row.assignmentRepairRequired?'assignment_repair':candidateGroupKey(row));
      var state=row.assignmentRepairRequired?' · 배치 관계 점검 필요':'';
      return '<div style="margin:5px 0"><strong>'+esc(row.productName||row.title||'상품')+'</strong> · '+esc(sectionLabel(key))+
        esc(state)+'<div class="mono">'+esc(frontCandidateLedgerId(row))+'</div></div>';
    }).join('');
  }
  function renderProductCandidateGroups(){var root=$('productGrid');if(!root)return;ensureManagementProductLookup();var rows=productRows.filter(candidatePoolRow),groups={};PRODUCT_SECTIONS.forEach(function(section){groups[section.key]=[];});rows.forEach(function(row){var key=candidateGroupKey(row);(groups[key]||(groups[key]=[])).push(row);});PRODUCT_SECTIONS.forEach(function(section){groups[section.key]=sectionRevenueViewSort(groups[section.key],section.key);});var keys=[];if(queueFocusedCandidateIds.length){var focused=rows.filter(function(row){var candidate=text(row&&row.candidateId),id=text(row&&row.id);return queueFocusedCandidateIds.indexOf(candidate)>=0||queueFocusedCandidateIds.indexOf(id)>=0;});if(focused.length){groups.queue_selected=focused;keys.push('queue_selected');}}if(!groups.quality_review)groups.quality_review=rows.filter(function(row){return !!verifiedProductImageReviewIssue(row);});keys.push('quality_review');if(!groups.assignment_repair)groups.assignment_repair=[];keys.push('assignment_repair');PRODUCT_SECTIONS.forEach(function(section){keys.push(section.key);});if(!groups.unassigned)groups.unassigned=[];keys.push('unassigned');var labels={queue_selected:'선택한 상품 · 아래 버튼으로 AI 자동배치/수동배치/제외 처리',quality_review:'대표 이미지 검토 필요 · 관리자 보류 이관',assignment_repair:'실제 섹션 배정 누락 · 복구 필요',unassigned:'미배치 상품 목록 · 추가 확인 필요'};root.innerHTML=keys.map(function(key){return productGroupDetails(key,labels[key]||sectionLabel(key),groups[key]||[],'candidate');}).join('');wireProductGroupDetails(root,groups,'candidate');keys.forEach(syncCandidateSelectionControls);renderLatestResearchCandidateGroup();var lookup=$('igdc-management-product-lookup');if(lookup&&text(lookup.value).length>=2)renderManagementProductLookup(lookup.closest('[data-management-lookup]'),lookup.value);}
  function renderProductSectionBoard(){var root=$('productSectionList'),board=$('productSectionBoard');if(!root)return;if(board&&board.getAttribute('aria-disabled')==='true'){root.innerHTML='';return;}var groups={};PRODUCT_SECTIONS.forEach(function(section){groups[section.key]=[];});productRows.filter(function(row){return productDecision(row)==='slot_candidate';}).forEach(function(row){var key=assignedSectionKey(row);if(groups[key])groups[key].push(row);});root.innerHTML=PRODUCT_SECTIONS.map(function(section){return productGroupDetails(section.key,section.label,groups[section.key]||[],'section');}).join('');wireProductGroupDetails(root,groups,'section');}
  function wireProductGroupDetails(root,groups,kind){
    Array.prototype.forEach.call(root.querySelectorAll('details[data-product-group]'),function(panel){
      function draw(){
        var key=panel.getAttribute('data-product-group'),grid=panel.querySelector('.product-group-grid'),pager=panel.querySelector('.product-group-pager'),unified=kind==='candidate'&&key==='latest_research',allRows=unified?latestResearchUnifiedEntries():(groups[key]||[]),stateKey=kind+':'+key,page=clampPage(candidateGroupPages[stateKey]||0,allRows.length,MANAGEMENT_PAGE_SIZE),start=page*MANAGEMENT_PAGE_SIZE,rows=allRows.slice(start,start+MANAGEMENT_PAGE_SIZE);
        candidateGroupPages[stateKey]=page;
        renderInBatches(grid,rows,function(row,index){return unified?(row.kind==='unregistered'?latestResearchFreshCardHtml(row):productCardHtml(row.candidate,start+index,kind,key)):productCardHtml(row,start+index,kind,key);},MANAGEMENT_PAGE_SIZE);
        if(pager){pager.innerHTML=pagerMarkup('product_group',stateKey,page,allRows.length,MANAGEMENT_PAGE_SIZE);var previous=pager.querySelector('[data-page-delta="-1"]'),next=pager.querySelector('[data-page-delta="1"]');function move(delta){candidateGroupPages[stateKey]=clampPage(page+delta,allRows.length,MANAGEMENT_PAGE_SIZE);draw();if(grid)grid.scrollIntoView({behavior:'smooth',block:'nearest'});}if(previous)previous.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();move(-1);});if(next)next.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();move(1);});}
        if(kind==='candidate'){syncCandidateSelectionControls(key);if(unified)syncLatestResearchUnifiedSelection();}else syncFrontSelectionControls();
      }
      panel.addEventListener('toggle',function(){
        var label=panel.querySelector('[data-group-toggle-label]');syncDetailsToggle(panel,label);
        if(panel.open){closeOtherHeavyPanels(kind==='candidate'?$('productCandidatePanel'):null,panel);Array.prototype.forEach.call(document.querySelectorAll('details[data-product-group][open]'),function(other){if(other!==panel){other.open=false;var otherGrid=other.querySelector('.product-group-grid');if(otherGrid)otherGrid.innerHTML='';var otherPager=other.querySelector('.product-group-pager');if(otherPager)otherPager.innerHTML='';}});draw();}
        else{productRenderEpoch+=1;var grid=panel.querySelector('.product-group-grid');if(grid)grid.innerHTML='';var pager=panel.querySelector('.product-group-pager');if(pager)pager.innerHTML='';}
      });
    });
  }
  function productExcludedRows(kind){return productRows.filter(function(row){
    var decision=productDecision(row),id=managementRowId(row);
    if(kind==='verified')return decision==='hold'&&verifiedReviewUi.hold[id]==='verified';
    if(kind==='incomplete')return decision==='hold'&&!!incompleteReviewUi[id];
    return kind==='hold'?decision==='hold':(decision==='reject'||decision==='purge');
  });}
  function selectedProductExclusionIds(kind){
    var selected=productExclusionSelections[kind]||{},valid={};
    productExcludedRows(kind).forEach(function(row){var id=managementRowId(row);if(id)valid[id]=true;});
    return Object.keys(selected).filter(function(id){return selected[id]===true&&valid[id]===true;});
  }
  function setProductExclusionSelection(kind,id,checked){
    if(kind!=='hold'&&kind!=='reject')return;
    id=text(id);if(!id)return;
    if(checked)productExclusionSelections[kind][id]=true;
    else delete productExclusionSelections[kind][id];
  }
  function selectCurrentProductExclusionPage(kind,checked){
    if(kind!=='hold'&&kind!=='reject')return;
    // Only the currently displayed page is affected; explicit selections on
    // other pages stay intact until the operator clears them or changes scope.
    var rows=productExcludedRows(kind),stateKey='excluded:'+kind;
    var page=clampPage(candidateGroupPages[stateKey]||0,rows.length,MANAGEMENT_PAGE_SIZE);
    rows.slice(page*MANAGEMENT_PAGE_SIZE,(page+1)*MANAGEMENT_PAGE_SIZE).forEach(function(row){
      var id=managementRowId(row);if(!id)return;
      if(checked)productExclusionSelections[kind][id]=true;
      else delete productExclusionSelections[kind][id];
    });
    syncProductExclusionSelection(kind);
  }
  function renderProductExcludedTable(kind){
    var allRows=productExcludedRows(kind),body=$(kind==='hold'?'productHoldRows':'productRejectRows');if(!body)return;var stateKey='excluded:'+kind,page=clampPage(candidateGroupPages[stateKey]||0,allRows.length,MANAGEMENT_PAGE_SIZE),start=page*MANAGEMENT_PAGE_SIZE,rows=allRows.slice(start,start+MANAGEMENT_PAGE_SIZE);candidateGroupPages[stateKey]=page;
    body.innerHTML=(rows.length?rows.map(function(row,index){var url=[row.verifiedDetailPageUrl,row.productUrl,row.productDetailUrl,row.originalProductUrl,row.originalUrl,row.url].map(safeProductDetailUrl).filter(Boolean)[0]||'',image=safeExternalImageUrl(row.imageUrl||row.imageOriginalUrl||row.image||row.thumbnailUrl||row.thumbnail_url),title=text(row.productName||row.title||row.id),decision=productDecision(row),status=decision==='purge'?'영구 제외':(decision==='reject'?'제외':'보류'),reviewStatus=kind==='hold'&&verifiedReviewUi.hold[managementRowId(row)],holdVerify=kind==='hold'&&row.id,thumb=image?(url?'<a class="excluded-product-thumb" href="'+esc(url)+'" target="_top" data-review-link="1" rel="noreferrer external nofollow" referrerpolicy="no-referrer">':(kind==='hold'?'<button type="button" class="excluded-product-thumb" style="cursor:pointer;padding:0" data-hold-original-lookup="'+esc(managementRowId(row))+'" aria-label="'+esc(title)+' 이전 원본 상세주소 확인">':'<span class="excluded-product-thumb">'))+'<img loading="lazy" decoding="async" src="'+esc(image)+'" alt="'+esc(title)+'">'+(url?'</a>':kind==='hold'?'</button>':'</span>'):'<div class="excluded-product-thumb missing">이미지 없음</div>',holdNote=holdVerify?'<div class="small">'+(!url?'현재 상품 상세 URL 검증에 실패해 썸네일 직접 이동을 차단했습니다. 상품이 삭제됐다고 단정하지 않으며 먼저 원본 주소를 확인해야 합니다.':'썸네일은 저장된 상품 상세주소를 엽니다. 판매자 사이트가 직접 접근을 거부하면 해당 사이트 내부에서 상품번호를 다시 확인해야 합니다.')+'</div>'+'<button type="button" class="ghost" data-hold-original-lookup="'+esc(managementRowId(row))+'">과거 동일상품 원본주소 확인·열기</button> <a class="queue-review-link" href="/commerce-admin-product-url-rescue.html" target="_blank" rel="noopener">URL 복구 관리</a> <span class="small" data-hold-link-status="'+esc(managementRowId(row))+'" aria-live="polite"></span> '+'<button type="button" class="ghost" data-hold-verify-one="'+esc(row.id)+'">AI 검증만(복귀는 별도)</button>':'',reviewSuggestions=kind==='hold'&&row.review&&Array.isArray(row.review.recoverySuggestions)?row.review.recoverySuggestions:(kind==='hold'&&Array.isArray(row.recoverySuggestions)?row.recoverySuggestions:[]),suggestionNote=reviewSuggestions.length?'<div class="small">상세페이지 확인 대체후보 '+reviewSuggestions.length+'건 · 원상품 동일 여부 별도 확인 · 자동 덮어쓰기 없음</div>'+reviewSuggestions.slice(0,3).map(function(item){return'<div class="small">'+externalReviewAnchor(item.productUrl,'대체후보: '+text(item.productName||'상품 페이지'),'queue-review-link')+'</div>';}).join(''):'',recoveryNote=kind==='hold'&&row.recoveryReason?'<div class="small">'+(row.review&&row.review.qualityHold?'보류 사유: ':'최근 복구: ')+esc(row.recoveryReason)+(row.lastRecoveryCheckedAt?' · '+esc(row.lastRecoveryCheckedAt):'')+'</div>':'';return'<tr data-review-anchor="product-excluded-'+esc(kind)+'-'+esc(reviewAnchorToken(row.id||url||title,start+index))+'"><td class="queue-number">'+(start+index+1)+'</td><td class="supplier-select-cell"><input type="checkbox" data-product-exclusion-select="'+esc(kind)+'" value="'+esc(managementRowId(row))+'" '+(productExclusionSelections[kind]&&productExclusionSelections[kind][managementRowId(row)]===true?'checked ':'')+'aria-label="'+esc(title)+' 선택"></td><td><div class="excluded-product-preview">'+thumb+'<div class="excluded-product-meta">'+(url?externalReviewAnchor(url,title,'queue-primary-link'):'<strong>'+esc(title)+'</strong>')+(url?'<br>'+externalReviewAnchor(url,'상품 원본 열기','queue-review-link'):'')+holdNote+suggestionNote+recoveryNote+(kind==='hold'&&safeProductDetailUrl(row.supplierSiteUrl)&&safeProductDetailUrl(row.supplierSiteUrl)!==url?'<div class="small"><a href="'+esc(safeProductDetailUrl(row.supplierSiteUrl))+'" target="_blank" rel="noopener noreferrer external nofollow">업체 사이트에서 상품번호 확인(상품 상세링크 아님)</a></div>':'')+'<div class="small mono">'+esc(url||(productAccessChallengeUrl(row.productUrl||row.url)?'접근 제한 인증 주소 격리 · 원본 상세주소 복구 필요':row.id||'-'))+'</div></div></div></td><td>'+esc(row.supplierName||'-')+'</td><td><span class="product-exclusion-status '+(decision==='purge'?'permanent':'')+'">'+esc(status)+'</span><br><span class="small">'+esc(row.decisionAt||'-')+'</span></td></tr>';}).join(''):'<tr><td colspan="5" class="small">현재 '+(kind==='hold'?'보류':'제외')+' 상품이 없습니다.</td></tr>')+'<tr><td colspan="5">'+pagerMarkup('excluded',kind,page,allRows.length,MANAGEMENT_PAGE_SIZE)+'</td></tr>';syncProductExclusionSelection(kind);
  }
  function renderHoldReviewClasses(){
    if(!$('holdVerifiedRows')||!$('holdIncompleteRows'))return;
    var types=['verified','incomplete'];
    types.forEach(function(kind){
      var rows=productExcludedRows(kind),body=$(kind==='verified'?'holdVerifiedRows':'holdIncompleteRows'),label=$(kind==='verified'?'holdVerifiedToggle':'holdIncompleteToggle'),sel=reviewClassSelections[kind],pageKey='holdReview:'+kind,page=clampPage(candidateGroupPages[pageKey]||0,rows.length,MANAGEMENT_PAGE_SIZE);
      candidateGroupPages[pageKey]=page;
      if(label)label.textContent=(kind==='verified'?'AI 검증 완료 정상상품':'불완전상품 별도 관리')+' · '+rows.length+'건';
      if(!body)return;
      var segment=rows.slice(page*MANAGEMENT_PAGE_SIZE,(page+1)*MANAGEMENT_PAGE_SIZE);
      body.innerHTML=segment.map(function(row,i){var id=managementRowId(row),meta=kind==='verified'?verifiedReviewDetailsUi.hold[id]||{}:incompleteReviewUi[id]||{},url=kind==='verified'?safeProductDetailUrl(meta.verifiedUrl):safeProductDetailUrl(row.productUrl||row.url||row.originalProductUrl),reasons=Array.isArray(meta.reasons)?meta.reasons.slice(0,3).join(' / '):'',deleted=meta.state==='url_deleted';return '<tr><td>'+(page*MANAGEMENT_PAGE_SIZE+i+1)+'</td><td><input type="checkbox" data-hold-class-check="'+kind+'" value="'+esc(id)+'" '+(sel[id]?'checked':'')+'></td><td><strong>'+esc(text(row.productName||row.title||id))+'</strong><div class="small">'+esc(row.supplierName||'-')+'</div>'+(url&&!deleted?externalReviewAnchor(url,'상품 상세주소 열기','queue-review-link'):'<span class="small">'+(deleted?'원장 URL 삭제 완료':'상세주소 미확인')+'</span>')+'</td><td><span class="small">'+esc(deleted?'관리자 URL 삭제 완료':kind==='verified'?'동일상품 정상 검증':'관리자 불완전 분류')+'</span><div class="small">'+esc(reasons)+'</div></td></tr>';}).join('')||'<tr><td colspan="4" class="small">현재 해당 상품이 없습니다.</td></tr>';
      body.innerHTML+='<tr><td colspan="4">'+pagerMarkup('holdreview',kind,page,rows.length,MANAGEMENT_PAGE_SIZE)+'</td></tr>';
      var count=$(kind==='verified'?'holdVerifiedSelectedCount':'holdIncompleteSelectedCount'),all=$(kind==='verified'?'holdVerifiedSelectAll':'holdIncompleteSelectAll'),selected=rows.filter(function(r){return sel[managementRowId(r)]===true;}).length;
      var pageSelected=segment.filter(function(row){return sel[managementRowId(row)]===true;}).length;
      if(count)count.textContent='선택 '+selected+'건(전체 페이지 합계) · 현재 페이지 '+pageSelected+'/'+segment.length+'건';
      if(all){all.checked=segment.length>0&&pageSelected===segment.length;all.indeterminate=pageSelected>0&&pageSelected<segment.length;all.disabled=reviewInventoryBusy||segment.length===0;}
    });
  }
  async function refreshHoldReviewInventory(){
    if(reviewInventoryBusy||!selectedCountry)return;
    var snapshot={country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'},key=snapshot.country+'|'+snapshot.region,ids=productRows.filter(function(r){return productDecision(r)==='hold';}).map(managementRowId).filter(Boolean);
    reviewInventoryBusy=true;
    try{
      var nextVerified={},nextDetails={},nextIncomplete={},nextUnresolved={};
      for(var n=0;n<ids.length;n+=70){
        if(selectedCountry!==snapshot.country||(selectedSubdivision||'NATIONWIDE')!==snapshot.region)return;
        var data=await api(CONTROL,'product_verified_review','POST',{}, {countryCode:snapshot.country,subdivisionCode:snapshot.region,bucket:'hold',operation:'inventory',ids:ids.slice(n,n+70)},90000);
        (data.results||[]).forEach(function(r){var id=text(r.id);if(r.state==='verified'){nextVerified[id]='verified';nextDetails[id]={verifiedUrl:text(r.verifiedUrl),urlRepaired:r.urlRepaired===true,recoverySource:text(r.recoverySource),reasons:r.reasons||[]};}
          else if(r.state==='incomplete'||r.state==='url_deleted')nextIncomplete[id]={state:r.state,reasons:r.reasons||[],deletedAt:r.deletedAt||null};
          else if(r.state==='invalid'||r.state==='inconclusive')nextUnresolved[id]={state:r.state,reasons:r.reasons||[]};
        });
      }
      if(selectedCountry!==snapshot.country||(selectedSubdivision||'NATIONWIDE')!==snapshot.region)return;
      verifiedReviewUi.hold=nextVerified;verifiedReviewDetailsUi.hold=nextDetails;incompleteReviewUi=nextIncomplete;unresolvedReviewDetailsUi.hold=nextUnresolved;reviewInventoryKey=key;
      renderExcludedLedger();renderHoldReviewClasses();
    }catch(error){show('AI 분류 저장 목록을 불러오지 못했습니다. 원장과 이전 화면을 유지합니다: '+text(error&&error.message),'warn');}
    finally{reviewInventoryBusy=false;}
  }
  function selectedHoldReviewClass(kind){var rows=productExcludedRows(kind),sel=reviewClassSelections[kind];return rows.map(managementRowId).filter(function(id){return sel[id]===true;});}
  async function applyHoldReviewClass(operation){
    if(productVerifiedFlowBusy||reviewInventoryBusy)return;
    var ids=operation==='classify_incomplete'?selectedProductExclusionIds('hold'):selectedHoldReviewClass(operation==='restore'?'verified':'incomplete');
    if(operation==='classify_incomplete')ids=ids.filter(function(id){return ['invalid','inconclusive'].includes(text((unresolvedReviewDetailsUi.hold[id]||{}).state));});
    if(!ids.length){show(operation==='classify_incomplete'?'AI 검증 결과가 확인 불가·부적합인 보류상품을 선택해 주세요.':'해당 목록에서 처리할 상품을 선택해 주세요.','warn');return;}
    var desc={classify_incomplete:'불완전상품 별도 관리 목록으로 옮깁니다. 원장 URL은 그대로 남습니다.',return_hold:'불완전상품 분류를 취소하고 보류 목록으로 돌립니다. URL은 삭제되지 않습니다.',delete_url:'선택한 불완전상품의 원장 상품 상세 URL을 삭제합니다. 배치·프론트 상품은 차단되며 기존 상품 기록은 남습니다.'}[operation];
    if(!window.confirm(desc+'\n선택 '+ids.length+'건 · 국가 '+selectedCountry+' / '+(selectedSubdivision||'NATIONWIDE')))return;
    if(operation==='delete_url'&&!window.confirm('최종 확인: 선택 URL 삭제는 되돌릴 수 없습니다. 검증 증빙과 상품 기록만 보관합니다. 정말 삭제할까요?'))return;
    var scope={country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'},good=0,failed=0,details=[];productVerifiedFlowBusy=true;
    try{
      for(var i=0;i<ids.length;i+=4){
        if(selectedCountry!==scope.country||(selectedSubdivision||'NATIONWIDE')!==scope.region)break;
        try{var data=await api(CONTROL,'product_verified_review','POST',{}, {countryCode:scope.country,subdivisionCode:scope.region,bucket:'hold',operation:operation,ids:ids.slice(i,i+4),confirmation:operation==='delete_url'?'DELETE_INCOMPLETE_URL':undefined},90000);
          (data.results||[]).forEach(function(r){if(['incomplete','pending','url_deleted'].includes(r.state)){good++;delete reviewClassSelections.verified[r.id];delete reviewClassSelections.incomplete[r.id];delete productExclusionSelections.hold[r.id];}else{failed++;details.push(text(r.reason||r.state||'처리 실패'));}});
        }catch(error){failed+=ids.slice(i,i+4).length;details.push(text(error&&error.message));}
      }
      await refreshHoldReviewInventory();
      if(operation==='delete_url')try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(_e){}
      show('불완전상품 처리 · 성공 '+good+'건 · 실패 '+failed+'건'+(details.length?' · '+details.slice(0,2).join(' / '):''),failed?'warn':'ok');
    }finally{productVerifiedFlowBusy=false;renderHoldReviewClasses();}
  }
  async function inspectHoldOriginalProductLink(button){
    var id=text(button&&button.getAttribute('data-hold-original-lookup'));
    if(!id)return;
    var scope={country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'},row=button.closest('tr'),feedback=row&&row.querySelector('[data-hold-link-status]');
    if(button.disabled)return;
    button.disabled=true;
    if(feedback)feedback.textContent='과거 동일상품 상세주소를 확인 중입니다.';
    try{
      var answer=await api(HOLD_ORIGINAL_LINK,'inspect','GET',{country:scope.country,region:scope.region,candidateId:id},null,15000);
      if(selectedCountry!==scope.country||(selectedSubdivision||'NATIONWIDE')!==scope.region){show('국가 선택이 바뀌어 상세주소 이동을 취소했습니다.','warn');return;}
      var original=answer&&answer.found===true?safeProductDetailUrl(answer.originalUrl):'';
      if(!original){var reason='과거 기록에서 동일상품의 원본 상세주소를 확인하지 못했습니다. URL 복구 관리에서 직접 확인해 주세요.';if(feedback)feedback.textContent=reason;show(reason,'warn');return;}
      // This is an exact prior product ID/title match, not evidence that the seller currently grants access.
      rememberReviewReturn(button);
      show('이전 원장에 보관된 동일상품 상세주소로 이동합니다. 판매자 서버가 접근을 거부하면 추가 확인이 필요합니다.','warn');
      try{var topWindow=window.top||window;if(topWindow!==window&&topWindow.location){topWindow.location.assign(original);return;}}catch(_e){}
      window.location.assign(original);
    }catch(error){var message='원본 주소 조회 실패: '+conciseRequestError(error&&error.message,error&&error.status);if(feedback)feedback.textContent=message;show(message,'warn');}
    finally{button.disabled=false;}
  }
  function renderExcludedLedger(){var supplier=$('supplierControlQueue'),hold=$('productHoldQueue'),reject=$('productRejectQueue');if(supplier&&supplier.open)renderSupplierExcludedRows();else{if($('supplierHoldRows'))$('supplierHoldRows').innerHTML='';if($('supplierBlockedRows'))$('supplierBlockedRows').innerHTML='';}if(hold&&hold.open)renderProductExcludedTable('hold');else if($('productHoldRows'))$('productHoldRows').innerHTML='';if(reject&&reject.open)renderProductExcludedTable('reject');else if($('productRejectRows'))$('productRejectRows').innerHTML='';renderHoldReviewClasses();syncExcludedLedgerCounts();}
  function syncExcludedLedgerCounts(){var holdProducts=productExcludedRows('hold').length,rejectProducts=productExcludedRows('reject').length,total=supplierHoldingRows.length+productExcludedRows('verified').length+productExcludedRows('incomplete').length+holdProducts+rejectProducts,panel=$('excludedLedgerPanel');if(panel)panel.classList.remove('hidden');if($('excludedLedgerSummary'))$('excludedLedgerSummary').textContent=total+'건';if($('productHoldToggleLabel'))$('productHoldToggleLabel').textContent='미분류 보류 상품 · '+holdProducts+'건';if($('holdIncompleteToggle'))$('holdIncompleteToggle').textContent='불완전상품 별도 관리 · '+productExcludedRows('incomplete').length+'건';if($('holdVerifiedToggle'))$('holdVerifiedToggle').textContent='AI 검증 완료 정상상품 · '+productExcludedRows('verified').length+'건';if($('productRejectToggleLabel'))$('productRejectToggleLabel').textContent='연구 제외·영구 제외 상품 · '+rejectProducts+'건';}
  function syncProductExclusionSelection(kind){
    var allRows=productExcludedRows(kind),ids=selectedProductExclusionIds(kind),selected={};
    ids.forEach(function(id){selected[id]=true;});
    var boxes=Array.prototype.slice.call(document.querySelectorAll('[data-product-exclusion-select="'+kind+'"]')),
        all=$(kind==='hold'?'productHoldSelectAll':'productRejectSelectAll'),
        count=$(kind==='hold'?'productHoldSelectedCount':'productRejectSelectedCount'),
        busy=productExclusionActionActive===true;
    var stateKey='excluded:'+kind,page=clampPage(candidateGroupPages[stateKey]||0,allRows.length,MANAGEMENT_PAGE_SIZE);
    var visible=allRows.slice(page*MANAGEMENT_PAGE_SIZE,(page+1)*MANAGEMENT_PAGE_SIZE);
    var pageSelected=visible.filter(function(row){return selected[managementRowId(row)]===true;}).length;
    if(all){all.checked=visible.length>0&&pageSelected===visible.length;all.indeterminate=pageSelected>0&&pageSelected<visible.length;all.disabled=busy||visible.length===0;}
    boxes.forEach(function(box){box.checked=selected[text(box.value)]===true;box.disabled=busy;});
    if(count)count.textContent=(busy?'처리 중 · ':'')+'선택 '+ids.length+'건(전체 페이지 합계) · 현재 페이지 '+pageSelected+'/'+visible.length+'건';
    Array.prototype.forEach.call(document.querySelectorAll('[data-product-exclusion-scope="'+kind+'"]'),function(button){button.disabled=busy||ids.length===0;});
  }
  function affiliateSettlementNotice(message,kind){var el=$('affiliateSettlementNotice');if(!el)return;el.className='notice '+(kind==='ok'?'ok':kind==='fail'?'fail':'warn');el.textContent=message;el.classList.remove('hidden');}
  function closeAffiliateSettlementModal(){affiliateSettlementProductId='';var modal=$('affiliateSettlementModal');if(modal)modal.classList.add('hidden');var notice=$('affiliateSettlementNotice');if(notice){notice.classList.add('hidden');notice.textContent='';}}
  function openAffiliateSettlementModal(productId,requestedStage){var row=productById(productId);if(!row)return;affiliateSettlementProductId=productId;var settlement=row.affiliateSettlement||{},stage=requestedStage||affiliateStage(row),modal=$('affiliateSettlementModal');$('affiliateSettlementProduct').textContent=text(row.productName||row.title||productId)+' · '+text(row.supplierName||'판매처 확인 필요');$('affiliateSettlementStage').value=stage;$('affiliateSettlementCounterparty').value=text(settlement.counterparty||settlement.providerName||row.supplierName);$('affiliateSettlementTrackingUrl').value=text(settlement.trackingUrl||settlement.destinationUrl||row.affiliateOutboundUrl);$('affiliateSettlementProgramId').value=text(settlement.contractId||settlement.programId);$('affiliateSettlementMode').value=text(settlement.settlementMode);$('affiliateSettlementCommission').value=settlement.commissionRate!=null?String(Math.round(Number(settlement.commissionRate)*10000)/100):'';$('affiliateSettlementPayout').value=settlement.payoutPerTransaction!=null?String(settlement.payoutPerTransaction):'';$('affiliateSettlementCurrency').value=text(settlement.currency);$('affiliateSettlementSchedule').value=text(settlement.payoutSchedule);$('affiliateSettlementPayoutVerified').checked=settlement.payoutBasisVerified===true;$('affiliateSettlementTrackingVerified').checked=settlement.trackingVerified===true;$('affiliateSettlementDestinationVerified').checked=settlement.officialDestination===true;$('affiliateSettlementContractVerified').checked=settlement.contractVerified===true;if(modal)modal.classList.remove('hidden');}
  async function saveAffiliateSettlement(){var id=affiliateSettlementProductId,row=productById(id);if(!id||!row)return;var stage=text($('affiliateSettlementStage').value),trackingUrl=safeExternalUrl($('affiliateSettlementTrackingUrl').value),counterparty=text($('affiliateSettlementCounterparty').value),programId=text($('affiliateSettlementProgramId').value),settlementMode=text($('affiliateSettlementMode').value),commissionText=text($('affiliateSettlementCommission').value),payoutText=text($('affiliateSettlementPayout').value),payload={stage:stage,counterparty:counterparty,trackingUrl:trackingUrl||null,programId:programId||null,contractId:stage==='formal_partner'?programId||null:null,settlementMode:settlementMode||null,commissionRate:commissionText!==''?Number(commissionText)/100:null,payoutPerTransaction:payoutText!==''?Number(payoutText):null,currency:text($('affiliateSettlementCurrency').value).toUpperCase()||null,payoutSchedule:text($('affiliateSettlementSchedule').value)||null,payoutBasisVerified:$('affiliateSettlementPayoutVerified').checked,trackingVerified:$('affiliateSettlementTrackingVerified').checked,officialDestination:$('affiliateSettlementDestinationVerified').checked,contractVerified:$('affiliateSettlementContractVerified').checked};var button=$('affiliateSettlementSaveBtn');if(button)button.disabled=true;try{if(row&&row.ledgerSource==='candidate'){await api(CONTROL,'product_candidate_ledger_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',candidateId:text(row.candidateId||row.id),decision:'affiliate_settlement',affiliateSettlement:payload});await refreshCandidateLedgerProducts();}else{var data=await api(CONTROL,'product_candidate_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',productId:id,decision:'affiliate_settlement',affiliateSettlement:payload});lastProductJson=data;rememberReport('product',data);renderProductProgress(data);renderProducts(data.products||[]);saveReviewSnapshot();}closeAffiliateSettlementModal();show('상품의 '+affiliateStageLabel(stage)+' 상태와 수익 귀속·정산 조건을 저장했습니다. 실제 지급 실행이나 결제는 수행하지 않았습니다.','ok');}catch(e){affiliateSettlementNotice(text(e&&e.message)||'제휴·정산 상태를 저장하지 못했습니다.','fail');}finally{if(button)button.disabled=false;}}
  async function unmatchRowsBeforeManagementChange(rows){
    rows=(rows||[]).filter(function(row){return row&&frontPublicationActive(row);});
    if(!rows.length)return{ok:true,skipped:true,requested:0,processed:0,failed:0};
    var ledgerIds=Array.from(new Set(rows.filter(function(row){return row.ledgerSource==='candidate';}).map(function(row){return text(row.candidateId||row.id);}).filter(Boolean)));
    var legacyProductIds=Array.from(new Set(rows.filter(function(row){return row.ledgerSource!=='candidate';}).map(function(row){return text(row.id);}).filter(Boolean)));
    var requested=ledgerIds.length+legacyProductIds.length,processed=0,failed=0;
    if(ledgerIds.length){
      var ledgerResult=await frontUnmatchCandidateIds(ledgerIds);
      var ledgerFailed=Number(ledgerResult&&ledgerResult.failed||0)+(ledgerResult&&ledgerResult.finalizeFailed?ledgerIds.length:0);
      if(ledgerFailed){var ledgerError=new Error('프론트 매칭 해제를 완료하지 못한 상품이 있습니다. 관리 상태 변경을 중단했습니다.');ledgerError.code='management_pre_unmatch_failed';throw ledgerError;}
      processed+=ledgerIds.length;
    }
    if(legacyProductIds.length){
      var legacyResult=await api(CONTROL,'product_front_unmatch','POST',{}, {
        countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',mode:'candidates',productIds:legacyProductIds,
        confirmation:'SITE_UNPUBLISH',scopeRefresh:false,compactResponse:true
      },90000);
      var frontResult=legacyResult&&legacyResult.frontSyncResult||{};
      var legacyFailed=Number(frontResult.blocked||0);
      if(legacyFailed){var legacyError=new Error('기존 상품의 프론트 매칭 해제를 완료하지 못했습니다. 관리 상태 변경을 중단했습니다.');legacyError.code='legacy_management_pre_unmatch_failed';throw legacyError;}
      processed+=legacyProductIds.length;
    }
    return{ok:failed===0,requested:requested,processed:processed,failed:failed};
  }
  async function applyProductDecision(productId,decision,placementKey,skipConfirm){var row=productById(productId),title=text(row&&row.productName||row&&row.title||productId);if(decision==='purge'&&row&&frontPublicationActive(row)&&!skipConfirm){if(!window.confirm('이 상품을 영구 제외하고 관리자 원장을 먼저 확정합니다. 현재 프론트 반영은 다음 프론트 동기화 단계에서 안전하게 해제됩니다. 계속할까요?'))return false;skipConfirm=true;}var message={slot_candidate:'선택 상품을 '+sectionLabel(placementKey)+' 섹션의 비공개 배치 예정 목록으로 보내고 관리자 결정으로 고정합니다.',hold:'선택 상품을 보류 목록으로 이동하고 관리자 결정으로 고정합니다.',reject:'선택 상품을 제외 목록으로 이동하고 관리자 결정으로 고정합니다.',purge:'선택 상품을 영구 제외합니다. 같은 원장 후보의 자동 승격을 차단합니다.',undecided:'선택 상품을 미배정 후보 목록으로 복원하고 관리자 결정으로 유지합니다.',ai_reclassify:'관리자 고정을 해제하고 다음 AI 자동화의 재분류 대상으로 돌립니다.'}[decision]||'상품 상태를 변경합니다.';if(!skipConfirm&&(decision==='reject'||decision==='purge')&&!window.confirm(message+'\n\n'+title))return false;try{if(row&&row.ledgerSource==='candidate'){var candidateId=text(row.candidateId||row.id),ledgerResult;if(decision==='ai_reclassify')ledgerResult=await api(CONTROL,'product_candidate_ledger_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',candidateId:candidateId,decision:decision,placementKey:placementKey||''});else ledgerResult=await authorityCandidateAction(decision,[candidateId],placementKey||'',{source:'administrator',reviewReason:decision==='hold'&&verifiedProductImageReviewIssue(row)?'representative_image_requires_review':''});
      if(!ledgerResult||ledgerResult.ok!==true||Number(ledgerResult.failed||0)>0||('processed' in ledgerResult&&Number(ledgerResult.processed||0)!==1)){
        var failedItem=ledgerResult&&ledgerResult.failures&&ledgerResult.failures[0],reason=text(failedItem&&failedItem.error||ledgerResult&&ledgerResult.error)||'서버의 상품 이동 완료가 확인되지 않았습니다.';
        if(reason.indexOf('published_or_unpublish_pending_candidate_protected')>=0)reason='프론트 공개 상태로 인해 이동이 보호되었습니다. 관리자 원장과 공개 상태를 다시 확인하세요.';
        if(reason.indexOf('front_unpublish_pending_complete_before_move')>=0)reason='상품이 공개 해제 처리 중입니다. 관리자 원장 저장 결과를 확인해 주세요.';if(reason.indexOf('published_or_unpublish_pending_candidate_protected')>=0)reason='관리자 이관 요청이 차단됐습니다. 실제 후보 ID, 국가 범위와 관리 권한을 확인해 주세요.';
        throw new Error(reason);
      }
      await refreshCandidateLedgerProducts();var ledgerRows=Array.isArray(ledgerResult&&ledgerResult.results)?ledgerResult.results:[],lp=(ledgerRows[0]&&ledgerRows[0].placement)||(ledgerResult.actionResult&&ledgerResult.actionResult.placement),ledgerMessage=decision==='slot_candidate'?'상품 1건을 '+sectionLabel(sectionKeyOf(lp)||placementKey)+' 섹션 후보로 지정했습니다.':decision==='hold'?'상품 1건을 보류 목록으로 이동했습니다.':decision==='reject'?'상품 1건을 제외 목록으로 이동했습니다.':decision==='purge'?'상품 1건을 영구 제외했습니다.':decision==='ai_reclassify'?'상품 1건의 관리자 고정을 해제하고 AI 재분류 대상으로 돌렸습니다.':'상품 1건을 미배정 후보 목록으로 복원했습니다.';var moved=ledgerRows[0]&&ledgerRows[0].relocation;
      var frontSyncRequired=!!(ledgerRows[0]&&ledgerRows[0].frontSyncRequired);
      show(ledgerMessage+(frontSyncRequired?' 관리자 원장 처리는 완료됐습니다. 기존 프론트는 다음 Front Match 및 배포 확인 후 반영됩니다.':' 자동 공개나 결제는 실행하지 않았습니다.'),'ok');return true;}var data=await api(CONTROL,'product_candidate_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',productId:productId,decision:decision,placementKey:placementKey||''});lastProductJson=data;rememberReport('product',data);renderProductProgress(data);renderProducts(data.products||[]);saveReviewSnapshot();var placement=data.actionResult&&data.actionResult.placement,doneMessage=decision==='slot_candidate'?'상품 1건을 '+sectionLabel(sectionKeyOf(placement)||placementKey)+' 섹션에 관리자 우선으로 지정했습니다.':decision==='hold'?'상품 1건을 보류 목록으로 이동했습니다.':decision==='reject'?'상품 1건을 제외 목록으로 이동했습니다.':decision==='purge'?'상품 1건을 영구 제외했습니다.':decision==='ai_reclassify'?'상품 1건의 관리자 고정을 해제하고 AI 재분류 대상으로 돌렸습니다.':'상품 1건을 미배정 후보 목록으로 복원했습니다.';show(doneMessage+' 자동 공개나 결제는 실행하지 않았습니다.','ok');return true;}catch(e){show(text(e.message)||'상품 판정을 저장하지 못했습니다.','fail');return false;}}
  function expectedExclusionDecision(decision){
    if(decision==='undecided')return'restore';
    return decision;
  }
  function verifyProductExclusionTransition(kind,decision,ids){
    var missing=[],wrong=[],map={};productRows.forEach(function(row){map[managementRowId(row)]=row;});
    (ids||[]).forEach(function(id){
      id=text(id);var row=map[id],d=row?productDecision(row):'';
      if(decision==='dismiss'||decision==='remove_from_list'){
        // The shared gslot master retains a tombstone. A successful delete
        // disappears from ACTIVE/hold/reject lists but remains readable with
        // slotDecision=removed and queueControl.action=dismiss/remove_from_list.
        // Treat the archived state as confirmed, not as a failed deletion.
        if(row&&!['removed','removed_from_list'].includes(d))wrong.push(id);
        return;
      }
      if(decision==='hard_delete'){
        // A complete direct-management ledger scan must contain no deleted ID.
        if(row||latestOverviewCanonicalById[id])wrong.push(id);
        return;
      }
      if(!row){missing.push(id);return;}
      if(decision==='undecided'&&d!=='undecided')wrong.push(id);
      else if(decision==='reject'&&d!=='reject')wrong.push(id);
      else if(decision==='purge'&&d!=='purge')wrong.push(id);
    });
    return{ok:missing.length===0&&wrong.length===0,missing:missing,wrong:wrong,failed:missing.length+wrong.length};
  }
  async function exclusionQueueBulk(kind,ids,decision,onProgress,options){
    options=options||{};
    ids=Array.from(new Set((ids||[]).map(text).filter(Boolean)));var action=expectedExclusionDecision(decision),processed=0,failures=[],processedIds=[];
    for(var offset=0;offset<ids.length;offset+=(options.hardDelete?1:4)){
      if(options.scope&&scopeKey()!==options.scope)throw new Error('국가·지역 변경: 남은 완전 삭제를 중단했습니다.');
      var chunk=ids.slice(offset,offset+(options.hardDelete?1:4)),data=null,lastError=null;
      for(var attempt=0;attempt<3&&!data;attempt++){
        try{
          data=await api(QUEUE_CONTROL,'bulk_action','POST',{},{
            candidateIds:chunk,decision:action,expectedBucket:kind||'',
            countryCode:options.country||selectedCountry,subdivisionCode:options.region||selectedSubdivision||'NATIONWIDE',
            hardDeleteConfirmed:options.hardDelete===true,confirmation:options.hardDelete?'PERMANENT_DELETE_EXCLUDED_CANDIDATES':undefined
          },60000);
        }catch(error){
          lastError=error;
          // A 409 with a per-candidate failure array is a confirmed refusal,
          // not a network retry candidate. Retain the exact reason for each ID.
          var responseFailures=error&&error.payload&&error.payload.failures;
          if(Array.isArray(responseFailures)&&responseFailures.length){
            lastError.exclusionFailures=responseFailures;
            break;
          }
          if(options.hardDelete||!transientResearchRequestError(error)||attempt>=2)break;
          await new Promise(function(resolve){setTimeout(resolve,500*(attempt+1));});
        }
      }
      if(data){
        processed+=Number(data.processed||0);
        (data.processedIds||[]).forEach(function(id){id=text(id);if(id&&processedIds.indexOf(id)<0)processedIds.push(id);});
        (data.failures||[]).forEach(function(row){failures.push(row);});
      }else{
        var detailed=lastError&&lastError.exclusionFailures||[];
        chunk.forEach(function(id){
          var exact=detailed.find(function(entry){return text(entry&&entry.id)===id;});
          failures.push({id:id,error:exact?text(exact.error):text(lastError&&lastError.message)||'queue_control_request_failed',code:exact?text(exact.code):text(lastError&&lastError.code)});
        });
      }
      if(typeof onProgress==='function')onProgress(Math.min(ids.length,offset+chunk.length),ids.length,failures.length);
    }
    return{ok:failures.length===0,requested:ids.length,processed:processed,failed:failures.length,processedIds:processedIds,failures:failures};
  }
  // Private verification-to-placement bridge. Always use the dedicated PSOM
  // operation, never AI full automation / front publication. Existing confirmed
  // placements are protected AGAIN by the server handler.
  async function placeNewlyVerifiedCandidates(candidateIds, label, progressElement, frozenScope){
    var ids=Array.from(new Set((candidateIds||[]).map(text).filter(Boolean))),counts=productSectionCounts(),assigned=0,preserved=0,failed=0,errors=[],requestCountry=frozenScope&&frozenScope.country||selectedCountry,requestSubdivision=frozenScope&&frozenScope.subdivision||selectedSubdivision||'NATIONWIDE';
    for(var off=0;off<ids.length;off+=6){
      if(progressElement)progressElement.textContent=label+' · PSOM 섹션 배치 '+Math.min(off+6,ids.length)+'/'+ids.length+'건';
      try{
        var result=await api(CONTROL,'product_candidate_psom_place','POST',{}, {countryCode:requestCountry,subdivisionCode:requestSubdivision,candidateIds:ids.slice(off,off+6),balanceCounts:counts,scopeAuthority:'administrator-selected',ignoreRequestGeo:true},30000);
        if(result&&result.balanceCounts)counts=result.balanceCounts;
        (result&&result.results||[]).forEach(function(row){if(row.assigned===true){if(row.preservedExisting===true||row.preservedManual===true)preserved+=1;else assigned+=1;}else{failed+=1;errors.push({id:row.candidateId,reason:row.error||'placement_unresolved'});}});
      }catch(error){failed+=ids.slice(off,off+6).length;errors.push({reason:text(error&&error.message)||'psom_request_failed'});}
    }
    return{assigned:assigned,preserved:preserved,failed:failed,errors:errors};
  }
  var productHoldVerifyStopRequested=false;

  // Explicit two-step operator flow. First action only checks and records proof;
  // only the distinct second action can change the PRIVATE candidate ledger.
  var productVerifiedFlowBusy=false;
  async function runTwoStepProductReview(bucket,operation,scopeMode,override){
    if(productVerifiedFlowBusy||!selectedCountry)return;
    var all=(scopeMode==='all'),rows=bucket==='hold'?(operation==='restore'?productExcludedRows('verified'):(operation==='status'?productRows.filter(function(r){return productDecision(r)==='hold';}):productExcludedRows('hold'))):latestVisibleResearchRows(),
        chosen=bucket==='hold'?(operation==='restore'?selectedHoldReviewClass('verified'):selectedProductExclusionIds('hold')):latestSelectedIds(),
        requestedIds=Array.isArray(override)?override:(override&&Array.isArray(override.ids)?override.ids:[]),
        ids=requestedIds.length?requestedIds.slice():(all?rows.map(function(r){return bucket==='hold'?managementRowId(r):latestProductKey(r);}).filter(Boolean):chosen);
    ids=Array.from(new Set(ids.map(text).filter(Boolean)));
    // The restore button without selection means all FRESH verified rows only.
    if(operation==='restore'){
      if(bucket==='hold'&&scopeMode!=='all'&&!ids.length){show('정상 검증 완료 목록에서 복귀할 상품을 선택하거나 모든 페이지 전체 선택을 눌러주세요.','warn');return;}
      var verified=verifiedReviewUi[bucket]||{};
      // Hold retains the operator's two-step proof gate. Latest-list restore
      // delegates fresh/durable product validation to the SERVER before writing.
      if(bucket==='hold'){
        if(!ids.length)ids=rows.map(function(r){return managementRowId(r);}).filter(function(id){return verified[id]==='verified';});
        else ids=ids.filter(function(id){return verified[id]==='verified';});
        if(!ids.length){show('먼저 AI 검증을 실행해 정상 판정된 보류 상품을 확인하세요.','warn');return;}
      }else if(!ids.length){show('복귀할 최신 상품을 선택하세요.','warn');return;}
    }else if(!ids.length){show('먼저 검증할 상품을 선택하세요. 전체 검증은 목록 전체 선택을 누른 뒤 실행할 수 있습니다.','warn');return;}
    if(bucket==='latest'&&all&&!latestProductRowsComplete){show('최신 목록 로딩이 완료되지 않아 전체 검증을 시작하지 않았습니다.','warn');return;}
    if(operation==='restore'&&!(override&&override.skipConfirm===true)&&!window.confirm((bucket==='latest'?'선택한 최신 상품 '+ids.length+'건 중 정상 상세검사 근거가 확인되는 상품만 복귀시킵니다. 근거가 오래되거나 부족하면 실제 상세페이지를 다시 확인하고, 부적합·접근 제한 상품은 등록하지 않습니다.':'정상 검증된 '+ids.length+'건만 복귀시킵니다.')+' 기존 배치와 프론트는 유지합니다. 계속할까요?'))return;
    var freeze={country:selectedCountry,region:selectedSubdivision||'NATIONWIDE'},target=bucket==='hold'?$('productHoldVerifyProgress'):$('latestManualActionState'),
        locationChoice=$(bucket==='hold'?'holdVerifiedPlacement':'latestVerifiedPlacement'),autoPlace=operation==='restore'&&((override&&override.forcePsom===true)||(locationChoice&&locationChoice.value==='psom')),
        totals={verified:0,inconclusive:0,invalid:0,restored:0,alreadyRegistered:0,preserved:0,skipped:0,failed:0},restoreIds=[],eligibleAlreadyIds=[],failures=[],reasonCounts={};
    productVerifiedFlowBusy=true; if(bucket==='hold'){productExclusionActionActive=true;syncProductExclusionSelection('hold');}else{latestQueueActionActive=true;syncLatestProductQueueControls();}
    productHoldVerifyStopRequested=false; if($('productHoldVerifyStopBtn')&&bucket==='hold')$('productHoldVerifyStopBtn').disabled=false;
    try{
      for(var offset=0;offset<ids.length;offset+=(bucket==='hold'&&operation==='verify'?1:4)){
        if(productHoldVerifyStopRequested||selectedCountry!==freeze.country||(selectedSubdivision||'NATIONWIDE')!==freeze.region)break;
        var chunk=ids.slice(offset,offset+(bucket==='hold'&&operation==='verify'?1:4)),response=null;
        if(target)target.textContent=(operation==='verify'?'AI 검증':(operation==='status'?'기존 검증 기록 확인':'정상상품 원장 복귀'))+' '+Math.min(offset+chunk.length,ids.length)+'/'+ids.length+'건 · 정상 '+totals.verified+' · 복귀 '+totals.restored+' · 확인 불가 '+totals.inconclusive+' · 실패 '+totals.failed;
        try{response=await api(CONTROL,'product_verified_review','POST',{}, {countryCode:freeze.country,subdivisionCode:freeze.region,bucket:bucket,operation:operation,ids:chunk,productRefs:bucket==='latest'?latestRefsForRows(latestRowsForIds(chunk)):[]},90000);}
        catch(error){totals.failed+=chunk.length;failures.push(conciseRequestError(error&&error.message,error&&error.status));continue;}
        (response&&response.results||[]).forEach(function(item){
          if(item.state==='verified'){verifiedReviewUi[bucket][item.id]='verified';verifiedReviewDetailsUi[bucket][item.id]={verifiedUrl:text(item.verifiedUrl),urlRepaired:item.urlRepaired===true,recoverySource:text(item.recoverySource),reasons:item.reasons||[]};delete unresolvedReviewDetailsUi[bucket][item.id];totals.verified++;}else if(operation==='status'&&item.state==='pending'){delete verifiedReviewUi[bucket][item.id];delete verifiedReviewDetailsUi[bucket][item.id];if(item.lastState==='invalid'||item.lastState==='inconclusive')unresolvedReviewDetailsUi[bucket][item.id]={state:item.lastState,reasons:item.reasons||[]};else delete unresolvedReviewDetailsUi[bucket][item.id];totals.skipped++;}
          else if(operation==='verify'){delete verifiedReviewUi[bucket][item.id];delete verifiedReviewDetailsUi[bucket][item.id];unresolvedReviewDetailsUi[bucket][item.id]={state:item.state,reasons:item.reasons||[]};if(item.state==='inconclusive')totals.inconclusive++;else if(item.state==='invalid')totals.invalid++;else totals.skipped++;}
          else if(item.state==='restored'){restoreIds.push(text(item.candidateId));delete verifiedReviewUi[bucket][item.id];delete verifiedReviewDetailsUi[bucket][item.id];delete unresolvedReviewDetailsUi[bucket][item.id];totals.restored++;}
          else if(item.state==='already_registered'){totals.alreadyRegistered++;if(item.candidateId)eligibleAlreadyIds.push(text(item.candidateId));}
          else if(item.state==='preserved'){totals.preserved++;if(item.reason)reasonCounts[item.reason]=(reasonCounts[item.reason]||0)+1;}
          else if(item.state==='failed'){totals.failed++;failures.push(text(item.reason));}
          else {totals.skipped++;if(item.reason)reasonCounts[item.reason]=(reasonCounts[item.reason]||0)+1;if(operation==='restore'&&item.reason&&failures.length<8)failures.push(text(item.reason));}
        });
        if(target)target.textContent=(operation==='restore'?'원장 복귀':'검증')+' 처리 '+Math.min(offset+chunk.length,ids.length)+'/'+ids.length+'건 · 신규 미배치 등록 '+totals.restored+' · 기존 등록 '+totals.alreadyRegistered+' · 관리자 결정 유지 '+totals.preserved+' · 별도 확인 '+totals.skipped+' · 검사 불가 '+totals.inconclusive+' · 오류 '+totals.failed;
      }
      if(operation==='restore'&&autoPlace&&(restoreIds.length||eligibleAlreadyIds.length)){
        // Previously registered UNASSIGNED rows are legitimate PSOM candidates,
        // not evidence of an empty staging result. Server guards each ID.
        var placeIds=Array.from(new Set(restoreIds.concat(eligibleAlreadyIds).filter(Boolean)));
        var placed=await placeNewlyVerifiedCandidates(placeIds,'검증 정상상품 PSOM 자동 배치',target,{country:freeze.country,subdivision:freeze.region});
        totals.placed=placed.assigned;totals.placeFailed=placed.failed;
        if(placed.errors&&placed.errors.length)failures.push('PSOM 확인 필요: '+placed.errors.slice(0,3).map(function(e){return text(e&&e.reason);}).filter(Boolean).join(', '));
      }
      var ledgerShown=0,ledgerHidden=0;
      if(operation==='restore'){
        try{
          var ledger=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
          if(ledger&&ledger.pipeline&&ledger.pipeline.ledgerLoadComplete!==true)throw new Error('후보 원장 전체 조회가 완료되지 않았습니다.');
          if(bucket==='latest'){
            var restoredUnique=Array.from(new Set(restoreIds.concat(eligibleAlreadyIds).map(text).filter(Boolean)));
            var visibleIds={};productRows.forEach(function(row){if((autoPlace?(productDecision(row)==='slot_candidate'&&!!assignedSectionKey(row)):(productDecision(row)==='undecided'&&candidateGroupKey(row)==='unassigned')))visibleIds[frontCandidateLedgerId(row)]=true;});
            restoredUnique.forEach(function(id){if(visibleIds[id])ledgerShown++;else ledgerHidden++;});
            // Re-focus the actual durable C candidate IDs (existing or newly
            // inserted) rather than merely keeping a browser-only count. C-stage
            // review/section actions must work on these ledger candidate IDs.
            if(restoredUnique.length){
              queueFocusedCandidateIds=restoredUnique.filter(function(id){return productRows.some(function(row){return frontCandidateLedgerId(row)===id;});}).slice(0,500);
            }
            // Registration and UI visibility are separate facts. Explicitly
            // open the ordinary unassigned pool only AFTER readback success.
            if((ledgerShown>0||queueFocusedCandidateIds.length>0)&&!autoPlace){
              var panel=$('productCandidatePanel');if(panel&&!panel.open)panel.open=true;
              renderProductCandidateGroups();
              var pool=$('productGrid')&&$('productGrid').querySelector('details[data-product-group="unassigned"]');
              if(pool&&!pool.open)pool.open=true;
            }
            if(ledgerHidden)failures.push('후보 원장 조회 '+ledgerHidden+'건이 '+(autoPlace?'배치 섹션':'미배치 목록')+'에서 확인되지 않았습니다. 원장 점검 JSON으로 확인하세요.');
          }
        }catch(e){failures.push('관리자 후보 원장 재조회 실패: '+text(e&&e.message));}
        if(bucket==='latest')try{await refreshLatestResearchRows(freeze.country,freeze.region,{label:'검증 정상상품 원장 복귀',preserveOnFailure:true});}catch(_e){}
      }
      var n=Object.keys(verifiedReviewUi[bucket]).filter(function(id){return verifiedReviewUi[bucket][id]==='verified';}).length;
      var countEl=$(bucket==='hold'?'productHoldVerifiedReviewCount':'latestVerifiedReviewCount');if(countEl)countEl.textContent='정상 검증 '+n+'건 · 복귀 대기';
      var list=bucket==='hold'?null:$('latestVerifiedReviewList'),names={};rows.forEach(function(row){names[bucket==='hold'?managementRowId(row):latestProductKey(row)]=text(row.productName||row.title||'상품');});
      if(list){var pending=Object.keys(verifiedReviewUi[bucket]).filter(function(id){return verifiedReviewUi[bucket][id]==='verified'&&names[id];});list.innerHTML=pending.length?'<details><summary>정상 검증 완료 '+pending.length+'건 · 상품별 결과 확인(복귀 버튼은 별도)</summary>'+pending.map(function(id,i){var detail=verifiedReviewDetailsUi[bucket][id]||{},link=safeProductDetailUrl(detail.verifiedUrl);return '<div class="small">'+(i+1)+'. '+esc(names[id])+' · <span class="pill good">'+(detail.urlRepaired?'동일상품 상세주소 복구 검증':'실상품 정상 검증')+'</span>'+(link?' · '+externalReviewAnchor(link,'검증된 상품 상세페이지 열기','queue-review-link'):'')+(detail.urlRepaired?' · 원장 복귀 시에만 복구 주소 적용':'')+'</div>';}).join('')+'</details>':'<span class="small">정상 검증 완료 항목 없음 · 원장 이동 없음</span>';var unresolved=Object.keys(unresolvedReviewDetailsUi[bucket]).filter(function(id){return names[id]&&verifiedReviewUi[bucket][id]!=='verified';});if(unresolved.length){list.innerHTML+='<details><summary>확인 불가·부적합 '+unresolved.length+'건 · 기존 보류 유지(자동 삭제 없음)</summary>'+unresolved.slice(0,100).map(function(id,i){var d=unresolvedReviewDetailsUi[bucket][id]||{},reasons=(Array.isArray(d.reasons)?d.reasons:[]).map(text).filter(Boolean).slice(0,3);return '<div class="small">'+(i+1)+'. '+esc(names[id])+' · '+esc(d.state==='inconclusive'?'접근 제한·원본 검증 불가':'부적합·상세주소 재확인 필요')+(reasons.length?' · '+esc(reasons.join(' / ')):'')+'</div>';}).join('')+'</details>';}}
      
      var repairedVerified=Object.keys(verifiedReviewDetailsUi[bucket]).filter(function(id){return verifiedReviewUi[bucket][id]==='verified'&&verifiedReviewDetailsUi[bucket][id].urlRepaired===true;}).length;
      var msg=(operation==='verify'?'AI 검증·분류 완료(이동 없음)':(operation==='status'?'검증 기록 불러오기 완료':'정상 검증상품 원장 복귀 완료'))+' · 정상 검증 '+totals.verified+' · 동일상품 URL 복구 검증 '+repairedVerified+' · 신규 미배치 등록 '+totals.restored+' · 기존 등록 '+totals.alreadyRegistered+' · 기존 관리자 결정 유지 '+totals.preserved+' · 불확실 '+totals.inconclusive+' · 오류/부적합 '+totals.invalid+' · 제외 '+totals.skipped+' · 실패 '+totals.failed+(operation==='restore'?(autoPlace?' · PSOM 신규 배치 '+(totals.placed||0)+' · 배치 실패 '+(totals.placeFailed||0):' · 미배치 후보 등록')+(bucket==='latest'?' · '+(autoPlace?'PSOM 배치 화면 확인 ':'미배치 화면 확인 ')+ledgerShown+'건'+(ledgerHidden?' · 미표시 '+ledgerHidden+'건':''):''):' · 원장 상태 유지')+(failures.length?' · '+failures.slice(0,2).join(' / '):'');
      if(operation==='restore'&&bucket==='latest'&&!totals.restored&&!totals.alreadyRegistered&&ids.length)msg+=' · 신규/기존 미배치 0건: 관리자 결정·검증 근거를 확인하세요.';
      if(operation==='restore'&&bucket==='latest'&&Object.keys(reasonCounts).length)msg+=' · 주요 제외 사유 '+Object.keys(reasonCounts).sort(function(a,b){return reasonCounts[b]-reasonCounts[a];}).slice(0,3).map(function(k){return k+' '+reasonCounts[k]+'건';}).join(', ');
      if(target)target.textContent=msg;show(msg,totals.failed||failures.length||ledgerHidden||(operation==='restore'&&bucket==='latest'&&!ledgerShown&&ids.length)?'warn':'ok');
      if(bucket==='hold'){await refreshHoldReviewInventory();renderProductExcludedTable('hold');}else renderLatestProductRows();
      return{requested:ids.length,restored:totals.restored,alreadyRegistered:totals.alreadyRegistered,
        placed:totals.placed||0,invalid:totals.invalid,heldOrSkipped:totals.skipped+totals.inconclusive,
        failed:totals.failed+(totals.placeFailed||0),ledgerShown:ledgerShown,ledgerHidden:ledgerHidden,
        warnings:failures.slice()};
    }finally{productVerifiedFlowBusy=false;if(bucket==='hold'){productExclusionActionActive=false;syncProductExclusionSelection('hold');if($('productHoldVerifyStopBtn'))$('productHoldVerifyStopBtn').disabled=true;}else{latestQueueActionActive=false;syncLatestProductQueueControls();}}
  }

  async function runProductHoldAiVerify(idsOverride,options){
    options=options||{};
    if(productExclusionActionActive||!selectedCountry)return;
    var holdScope={country:selectedCountry,subdivision:selectedSubdivision||'NATIONWIDE'};
    var selected=selectedProductExclusionIds('hold');
    var allRows=productExcludedRows('hold'),forced=Array.isArray(idsOverride)?idsOverride.map(text).filter(Boolean):[],ids=forced.length?forced:(selected.length?selected:allRows.map(managementRowId).filter(Boolean));
    ids=Array.from(new Set(ids));
    if(!ids.length){show('검증할 보류 상품이 없습니다.','warn');return;}
    if(!forced.length&&!selected.length&&!window.confirm('선택된 상품이 없습니다. 보류 상품 '+ids.length+'건 전체를 AI 자동 검증·확인·보완하시겠습니까?'))return;
    productExclusionActionActive=true;syncProductExclusionSelection('hold');syncProductExclusionSelection('reject');
    productHoldVerifyStopRequested=false;
    var button=$('productHoldAiVerifyBtn'),autoButton=$('productHoldVerifyAndPlaceBtn'),stopButton=$('productHoldVerifyStopBtn'),progress=$('productHoldVerifyProgress');
    if(button)button.disabled=true;if(autoButton)autoButton.disabled=true;
    if(stopButton)stopButton.disabled=false;
    if(progress){progress.textContent='일괄 검증 시작 · 0/'+ids.length+'건';progress.setAttribute('role','status');}
    var total={requested:ids.length,restored:0,rejected:0,keptHold:0,repaired:0,failed:0},failures=[],verifiedRestoredIds=[];
    var processedCount=0,cancelled=false;
    try{
      // Supplier discovery and detailed URL verification can be slow. One held
      // candidate per function request avoids multi-item Netlify timeouts.
      for(var offset=0;offset<ids.length;offset+=1){
        if(productHoldVerifyStopRequested||selectedCountry!==holdScope.country||(selectedSubdivision||'NATIONWIDE')!==holdScope.subdivision){cancelled=true;break;}
        var chunk=ids.slice(offset,offset+1),data=null,started=Date.now();
        var updatePending=function(){
          if(progress)progress.textContent='상품 '+(offset+1)+'/'+ids.length+'건 검증 중 · 요청 경과 '+Math.floor((Date.now()-started)/1000)+'초 · 정상 복귀 '+total.restored+'건 · 실패 '+total.failed+'건';
        };
        updatePending();
        var ticker=setInterval(updatePending,1000),requestError=null;
        try{data=await api(CONTROL,'product_candidate_hold_verify','POST',{}, {countryCode:holdScope.country,subdivisionCode:holdScope.subdivision,candidateIds:chunk,scopeAuthority:'administrator-selected',ignoreRequestGeo:true},90000);}
        catch(error){requestError=error;}
        finally{clearInterval(ticker);}
        processedCount+=chunk.length;
        if(requestError){chunk.forEach(function(id){failures.push({id:id,error:conciseRequestError(requestError&&requestError.message,requestError&&requestError.status)||'hold_verify_request_failed'});});total.failed+=chunk.length;}
        else{
          total.restored+=Number(data&&data.restored||0);total.rejected+=Number(data&&data.rejected||0);total.keptHold+=Number(data&&data.keptHold||0);total.repaired+=Number(data&&data.repaired||0);total.failed+=Number(data&&data.failed||0);failures=failures.concat(data&&data.failures||[]);
          (data&&data.results||[]).forEach(function(row){if(row&&['restored','repaired_same_product'].indexOf(row.action)>=0&&row.candidateId)verifiedRestoredIds.push(text(row.candidateId));});
        }
        var count=$('productHoldSelectedCount');if(count)count.textContent='AI 검증 '+processedCount+'/'+ids.length+'건 · 복귀 '+total.restored+'건 · 보류 '+total.keptHold+'건 · 실패 '+total.failed+'건';
        if(progress)progress.textContent='완료 '+processedCount+'/'+ids.length+'건 · 정상 복귀 '+total.restored+'건 · 보류 유지 '+total.keptHold+'건 · 실패 '+total.failed+'건'+(requestError?' · 최근 오류: '+conciseRequestError(requestError.message,requestError.status):'');
      }
      var placement={assigned:0,preserved:0,failed:0};
      if(options.autoPlace===true&&!cancelled&&verifiedRestoredIds.length)placement=await placeNewlyVerifiedCandidates(verifiedRestoredIds,'보류에서 정상 복귀',$('productHoldSelectedCount'),holdScope);
      try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}
      catch(refreshError){failures.push({error:'화면 새로고침 실패: '+text(refreshError&&refreshError.message)});}
      var finalMessage=(cancelled?'중단 또는 국가 범위 변경 · 남은 검증/배치는 수행하지 않았습니다 · ':'보류상품 일괄 검증 완료 · ')+'처리 '+processedCount+'/'+ids.length+'건 · 원장 복귀 '+total.restored+'건(동일상품 URL 복구 '+total.repaired+'건) · 보류 유지 '+total.keptHold+'건 · 실패 '+total.failed+'건'+(options.autoPlace===true?' · PSOM 신규 배치 '+placement.assigned+'건 · 기존 배치 보존 '+placement.preserved+'건 · 배치 실패 '+placement.failed+'건':'')+(failures.length?' · 오류 예시 '+failures.slice(0,2).map(function(f){return text(f&&f.error||'처리 실패');}).join(' / '):'');
      if(progress)progress.textContent=finalMessage;
      show(finalMessage,(total.failed||placement.failed||cancelled)?'warn':'ok');
    }catch(error){
      var message='보류상품 일괄 검증 중단 · '+processedCount+'/'+ids.length+'건 처리 · '+conciseRequestError(error&&error.message,error&&error.status);
      if(progress)progress.textContent=message;
      show(message,'fail');
    }finally{productExclusionActionActive=false;if(button)button.disabled=false;if(autoButton)autoButton.disabled=false;if(stopButton)stopButton.disabled=true;renderExcludedLedger();syncProductExclusionSelection('hold');syncProductExclusionSelection('reject');}
  }
  async function removeSinglePrivateCandidate(candidateId){
    candidateId=text(candidateId);if(!candidateId||productExclusionActionActive||productFrontSyncActive)return;
    var row=productRows.find(function(item){return frontCandidateLedgerId(item)===candidateId;});
    if(!row){show('삭제할 후보가 현재 관리 원장에 없습니다. 원장을 다시 조회해 주세요.','warn');return;}
    // The actual assignment relation, not a possibly stale browser publication
    // marker, is the server-side deletion authority. Ask again if a cached
    // marker suggests public; the server refuses currently published records.
    var cachedPublic=frontPublicationActive(row);
    if(!window.confirm('이 후보를 현재 상품 후보·배치 관리 목록에서 삭제하시겠습니까?\n\n비공개 배정 관계는 함께 해제하며 조사 이력은 보존합니다.'+(cachedPublic?'\n\n주의: 공개 이력이 표시되어 있습니다. 현재 실제 공개 중이면 서버가 삭제를 차단합니다.':'')))return;
    productExclusionActionActive=true;
    try{
      var result=await exclusionQueueBulk('',[candidateId],'dismiss');
      if(Number(result&&result.processed||0)!==1)throw new Error(text(result&&result.failures&&result.failures[0]&&result.failures[0].error)||'candidate_delete_not_confirmed');
      try{await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});}
      catch(refreshError){show('삭제 저장은 확인됐습니다. 전체 후보 원장 새로고침은 지연 중입니다: '+text(refreshError&&refreshError.message),'warn');return;}
      if(productRows.some(function(item){return frontCandidateLedgerId(item)===candidateId&&['undecided','slot_candidate','hold','reject'].indexOf(productDecision(item))>=0;}))throw new Error('candidate_still_present_after_delete');
      show('후보 1건을 현재 관리 목록에서 삭제했습니다. 다음 리서치에서 재수집할 수 있습니다.','ok');
    }catch(error){show('후보 삭제 실패: '+conciseRequestError(error&&error.message,error&&error.status),'fail');}
    finally{productExclusionActionActive=false;renderProducts(productRows);}
  }
  async function applyProductExclusionBulk(kind,decision){
    if(productExclusionActionActive)return;var ids=selectedProductExclusionIds(kind);if(!ids.length){show('처리할 상품을 선택해 주세요.','warn');return;}
    var labels={reject:'제외 관리로 이동',purge:'영구 제외',dismiss:'관리목록 삭제·재수집 허용',remove_from_list:'현재 관리 목록에서만 제거',hard_delete:'Supabase 원장 완전 삭제',undecided:'전체 상품 후보·배치 관리 목록으로 복원'},serverAction=decision==='undecided'?'restore':decision;
    if(['reject','purge','dismiss','remove_from_list'].indexOf(decision)>=0&&!window.confirm('선택 '+ids.length+'건을 '+(labels[decision]||decision)+' 처리하시겠습니까?'+(decision==='dismiss'?'\n\n공유 후보 원장과 검토 증빙은 보존하며 다음 공식 리서치에서 다시 발견될 수 있습니다.':decision==='purge'?'\n\n재수집 차단 기록은 유지됩니다.':'')))return;
    if(decision==='hard_delete'){
      if(kind!=='reject'&&kind!=='hold'){show('완전 삭제는 보류·제외 상품 목록에서만 실행할 수 있습니다.','warn');return;}
      if(ids.length>100){show('원장 완전 삭제는 안전을 위해 한 번에 최대 100건만 선택해 주세요.','warn');return;}
      if(!window.confirm('주의: 선택 '+ids.length+'건의 후보 원장 및 해당 후보 ID에 연결된 배치·가용성·수익·증빙 관계를 실제 삭제합니다. 복구할 수 없습니다. 프론트 공개·승인 상품은 서버에서 거부합니다.\n\n이전에 설정된 재수집 차단 정책은 별도 연구 런타임에 남을 수 있습니다. 계속합니까?'))return;
    }
    var frozenScope=scopeKey(),country=selectedCountry,region=selectedSubdivision||'NATIONWIDE';
    productExclusionActionActive=true;syncProductExclusionSelection('hold');syncProductExclusionSelection('reject');excludedOperationStatus('보류·제외 상품 '+(labels[decision]||decision)+' · '+ids.length+'건 처리 중',false);
    var selectedRows=ids.map(productById).filter(Boolean),processed=0,failures=[];
    try{
      var bulkResult;
      // The scoped queue endpoint supports direct hard deletion from both
      // confirmed HOLD and REJECT buckets. Do not mutate HOLD -> REJECT merely
      // to delete it: that extra write could strand an item on failure.
      bulkResult=await exclusionQueueBulk(kind,ids,decision,function(done,total,failCount){
        var count=$(kind==='hold'?'productHoldSelectedCount':'productRejectSelectedCount');
        if(count)count.textContent='처리 '+done+'/'+total+'건 · 실패 '+failCount;
      },{country:country,region:region,scope:frozenScope,hardDelete:decision==='hard_delete'});
      processed=Number(bulkResult&&bulkResult.processed||0);failures=(bulkResult&&bulkResult.failures||[]).slice();
      var refreshed=null,refreshError=null;
      if(scopeKey()!==frozenScope)throw new Error('국가·지역이 변경되었습니다. 결과를 기존 범위에 적용하지 않습니다.');
      try{
        refreshed=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
        if(!(refreshed&&refreshed.pipeline&&refreshed.pipeline.ledgerLoadComplete===true&&refreshed.pipeline.source==='direct_management_ledger'))
          throw new Error('전체 후보 원장 재조회가 아직 완료되지 않았습니다.');
      }catch(error){refreshError=error;}
      if(!refreshError){
        var transition=verifyProductExclusionTransition(kind,decision,ids);
        if(decision==='hard_delete'){
          // A full fresh ledger proves whether the selected ID still exists,
          // even when a previous request committed but the HTTP reply was lost.
          var absent=ids.filter(function(id){return !latestOverviewCanonicalById[id];});
          var confirmedAbsent=new Set(absent);
          failures=failures.filter(function(f){return !confirmedAbsent.has(text(f&&f.id));});
          processed=absent.length;
        }
        if(!transition.ok)transition.wrong.concat(transition.missing).forEach(function(id){
          if(!failures.some(function(f){return text(f&&f.id)===id;}))failures.push({id:id,error:'post_write_state_not_confirmed'});
        });
      }else if(processed>0&&decision!=='hard_delete'){
        // Queue-control explicitly read back every committed candidate ID. A
        // subsequent 1000+ row board reload may time out; it must not make a
        // genuinely committed operator DELETE/RESTORE look like a no-op.
        // Update only IDs the server confirmed, never a failed/unknown ID.
        var persistedIds=new Set((bulkResult.processedIds||[]).map(text).filter(Boolean));
        var nextRows=productRows.filter(function(row){
          var id=managementRowId(row);
          return !(persistedIds.has(id)&&(decision==='dismiss'||decision==='remove_from_list'));
        }).map(function(row){
          if(!persistedIds.has(managementRowId(row)))return row;
          var next=Object.assign({},row),queue=Object.assign({},row.queueControl||{});
          if(decision==='reject'){next.slotDecision='reject';queue.action='reject';}
          else if(decision==='purge'){next.slotDecision='purge';queue.action='purge';queue.permanentExcluded=true;}
          else if(decision==='undecided'){next.slotDecision='undecided';next.approvedPlacement=null;next.primaryPlacement=null;queue.action='restored';queue.hiddenFromCountryQueue=false;queue.permanentExcluded=false;}
          next.queueControl=queue;return next;
        });
        renderProducts(nextRows);
      }
      var suffix=decision==='hard_delete'?' · 실제 원장·관련 관계 삭제(재수집 차단 정책은 별도)' :decision==='undecided'?' · 전체 상품 후보·배치 관리 목록의 미배정 후보로 복원':decision==='reject'?' · 제외 상품 목록으로 이동':decision==='purge'?' · 영구 제외·재수집 차단 저장':decision==='dismiss'?' · 현재 관리 목록 삭제·재수집 허용':decision==='remove_from_list'?' · 현재 관리 목록에서만 제거':'';
      var notice='요청 '+ids.length+'건 · '+(decision==='hard_delete'&&!refreshError?'원장 삭제 재조회 확인 ':'서버 저장 확인 ')+processed+'건 · 실패 '+failures.length+'건'+suffix;
      if(refreshError)notice+=decision==='hard_delete'?' · 전체 원장 재검증 실패(완료 확정 아님, 새로고침 필요)':' · 전체 원장 새로고침 지연(저장 성공 건만 화면 반영, 다음 새로고침에서 재검증)';
      if(failures.length)notice+=' · '+failures.slice(0,2).map(function(f){return '['+text(f&&f.id).slice(0,42)+'] '+text(f&&f.error||'처리 실패');}).join(' / ');
      show(notice,failures.length||refreshError?'warn':'ok');
      excludedOperationStatus(notice,!!(failures.length||refreshError));
      if(decision==='hard_delete'&&!failures.length&&!refreshError)ids.forEach(function(id){delete productExclusionSelections[kind][id];});
    }catch(error){var message='상품 관리 작업 미완료: '+(text(error&&error.message)||'선택 상품 일괄 처리 실패');excludedOperationStatus(message,true);show(message,'fail');}
    finally{productExclusionActionActive=false;renderExcludedLedger();syncProductExclusionSelection('hold');syncProductExclusionSelection('reject');}
  }
  function sectionCleanupPlan(keys){var topRows=[],reserveRows=[],warnings=[],sectionSummary=[];(keys||[]).forEach(function(key){if(!PRODUCT_SECTION_MAP[key])return;var rows=rankedSectionRows(key),locked=rows.filter(productManagementLocked),limit=frontSlotCapacity(key),top=rows.slice(0,limit),reserve=rows.slice(limit);topRows=topRows.concat(top);reserveRows=reserveRows.concat(reserve);sectionSummary.push({key:key,total:rows.length,front:top.length,reserve:reserve.length,locked:locked.length,capacity:limit});if(locked.length>limit)warnings.push(sectionLabel(key)+' 관리자 수동 고정 '+locked.length+'건 · 프론트 한도 '+limit+'건');});return{topRows:topRows,reserveRows:reserveRows,warnings:warnings,sectionSummary:sectionSummary};}
  // All 20 section controls must use the same canonical, scoped administrator
  // authority as HOLD/REJECT/RESTORE. The excluded-queue endpoint is for items
  // ALREADY in HOLD/REJECT, and rejects active published section candidates.
  async function canonicalRemoveCandidateRows(rows){
    rows=(rows||[]).filter(Boolean);
    if(!rows.length)return{processed:0,failed:0,processedIds:[],failures:[]};
    var ledger=rows.filter(function(row){return row.ledgerSource==='candidate';});
    var legacy=rows.filter(function(row){return row.ledgerSource!=='candidate';});
    var processedIds=[],failed=0,failures=[],frontSyncRequired=false;
    var ledgerIds=Array.from(new Set(ledger.map(function(row){return text(row.candidateId||row.id);}).filter(Boolean)));
    if(ledgerIds.length){
      var result=await authorityCandidateAction('remove_from_list',ledgerIds,'',{source:'administrator',chunkSize:5});
      processedIds=processedIds.concat(result&&result.processedIds||[]);
      failed+=Number(result&&result.failed||0);
      failures=failures.concat(result&&result.failures||[]);
      frontSyncRequired=(result&&result.results||[]).some(function(item){return item&&item.frontSyncRequired===true;});
    }
    for(var i=0;i<legacy.length;i++){
      try{
        await api(CONTROL,'product_candidate_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',productId:text(legacy[i].id),decision:'remove_from_list'},45000);
        processedIds.push(text(legacy[i].id));
      }catch(error){failed+=1;failures.push({id:text(legacy[i].id),error:text(error&&error.message)||'legacy_remove_failed'});}
    }
    await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
    return{processed:processedIds.length,processedIds:processedIds,failed:failed,failures:failures,frontSyncRequired:frontSyncRequired};
  }
  async function removeSelectedSectionCandidates(sectionKey){
    if(productSectionCleanupActive)return;
    var ids=selectedProductIds(sectionKey),wanted={};ids.forEach(function(id){wanted[id]=true;});
    var rows=sectionRows(sectionKey).filter(function(row){return wanted[text(row.id)]===true;});
    if(!rows.length){show('현재 섹션에서 제거할 상품을 먼저 선택해 주세요.','warn');return;}
    if(!window.confirm(sectionLabel(sectionKey)+'에서 선택 상품 '+rows.length+'건을 현재 후보 관리 목록에서 제거하시겠습니까? 공유 원장과 증빙은 보존되고 재수집은 허용됩니다. 프론트는 이후 Front Match에서 동기화됩니다.'))return;
    productSectionCleanupActive=true;renderProducts(productRows);
    try{
      var result=await canonicalRemoveCandidateRows(rows);
      // Retain selections for failed IDs so the operator can retry accurately.
      (result.processedIds||[]).forEach(function(id){delete frontSelectedProducts[text(id)];});
      show(sectionLabel(sectionKey)+' 선택 제거 · 성공 '+Number(result.processed||0)+'건 · 실패 '+Number(result.failed||0)+'건'+(result.frontSyncRequired?' · 기존 프론트 상품은 Front Match 동기화 후 해제됩니다.':''),result.failed?'warn':'ok');
    }catch(error){show(text(error&&error.message)||'선택 상품을 후보 목록에서 제거하지 못했습니다.','fail');}
    finally{productSectionCleanupActive=false;renderProducts(productRows);syncFrontSelectionControls();}
  }
  async function trimSectionsByRanking(sectionKeys){if(productSectionCleanupActive)return;var keys=Array.from(new Set((sectionKeys||[]).filter(function(key){return!!PRODUCT_SECTION_MAP[key];}))),plan=sectionCleanupPlan(keys);if(!keys.length){show('정리할 20개 섹션이 없습니다.','warn');return;}productSectionCleanupActive=true;try{keys.forEach(function(key){sectionRows(key).forEach(function(row){delete frontSelectedProducts[text(row&&row.id)];});});plan.topRows.forEach(function(row){var id=text(row&&row.id);if(id)frontSelectedProducts[id]=true;});var total=plan.sectionSummary.reduce(function(sum,row){return sum+Number(row.total||0);},0),front=plan.sectionSummary.reduce(function(sum,row){return sum+Number(row.front||0);},0),reserve=plan.sectionSummary.reduce(function(sum,row){return sum+Number(row.reserve||0);},0),msg='AI 랭킹 상위 '+PRODUCT_FRONT_SECTION_CAPACITY+' 준비 완료 · 대상 '+keys.length+'개 섹션 · 프론트 우선 '+front+'건 · 예비 유지 '+reserve+'건 · 전체 상품 후보 배치 관리 원장/20개 섹션 배치 변경 0건';if(total===0)msg='선택 범위에 배치 예정 상품이 없습니다. 관리자 원장은 변경하지 않았습니다.';if(plan.warnings.length)msg+=' · 확인: '+plan.warnings.join(' / ');show(msg,plan.warnings.length?'warn':'ok');}catch(error){show(text(error&&error.message)||'AI 랭킹 상위 100 준비를 완료하지 못했습니다.','fail');}finally{productSectionCleanupActive=false;renderProducts(productRows);syncFrontSelectionControls();}}
  function trimSectionByRanking(sectionKey){return trimSectionsByRanking([sectionKey]);}
  function trimAllSectionsByRanking(){return trimSectionsByRanking(PRODUCT_SECTIONS.map(function(row){return row.key;}));}
  function latestProductKey(row){return text(row&&row.id||row&&row.productIdentity||row&&row.productUrl||row&&row.url);}
  // All remaining latest research records are visible here, not only the 3
  // records which do not have a matching candidate ledger URL. Do not change
  // latestVisibleResearchRows(): legacy verification/transfer buttons continue
  // to operate on truly unregistered records only.
  function latestOverviewRows(){
    var byUrl={};
    productRows.forEach(function(row){
      if(!row||row.ledgerSource!=='candidate')return;
      var key=productUrlMatchKey(row.productUrl||row.url||row.originalOfficialProductUrl);
      if(key)(byUrl[key]||(byUrl[key]=[])).push(row);
    });
    return latestProductRows.map(function(research,index){
      var key=productUrlMatchKey(research.productUrl||research.url),matches=key&&byUrl[key]||[],chosen=latestOverviewChosenCandidates[latestProductKey(research)],candidate=matches.length===1?matches[0]:(chosen?matches.filter(function(row){return frontCandidateLedgerId(row)===chosen;})[0]||null:null),decision=candidate?productDecision(candidate):'new',section=candidate?assignedSectionKey(candidate):'',kind=matches.length>1&&!candidate?'duplicate':(!candidate?'new':(['undecided','slot_candidate','hold','reject','purge','removed'].indexOf(decision)>=0?decision:'other'));
      var reviewNote=unresolvedReviewDetailsUi.latest[latestProductKey(research)]||null;
      return{research:research,index:index,id:latestProductKey(research),candidate:candidate,candidateId:candidate?frontCandidateLedgerId(candidate):'',matches:matches,kind:kind,section:section,duplicateCount:matches.length,protected:!!(candidate&&frontPublicationActive(candidate)),reviewNote:reviewNote};
    });
  }
  function latestOverviewSelectAllowed(item){
    // Candidate mutations always target durable IDs. Brand-new research records
    // may be selected ONLY for the verified research->candidate transfer path.
    // Never synthesize candidate IDs or auto-select ambiguous duplicate URLs.
    return !!(item&&!item.protected&&item.kind!=='removed'&&item.kind!=='duplicate'&&
      ((item.kind==='new'&&!item.candidateId)||(item.candidateId&&item.candidate)));
  }
  function latestOverviewSelectedItems(){
    var wanted=scopeKey(),current=latestOverviewRows(),out=[];
    current.forEach(function(item){
      var choice=latestOverviewSelected[item.index];
      if(choice&&choice.scope===wanted&&choice.researchId===item.id&&choice.candidateId===item.candidateId&&latestOverviewSelectAllowed(item))out.push(item);
      else if(choice)delete latestOverviewSelected[item.index];
    });
    return out;
  }
  function syncLatestOverviewBulkControls(){
    var selected=latestOverviewSelectedItems(),count=$('latestOverviewSelectedCount'),selectAll=$('latestOverviewSelectPage'),move=$('latestOverviewBulkMove'),remove=$('latestOverviewBulkDelete'),clear=$('latestOverviewClearSelection'),selectFiltered=$('latestOverviewSelectFiltered'),purge=$('latestOverviewBulkPurge'),ai=$('latestOverviewBulkAiPlace');
    var busy=latestOverviewBusy||latestQueueActionActive||productVerifiedFlowBusy||!latestProductRowsComplete||!latestOverviewLedgerComplete;
    if(count)count.textContent='선택 '+selected.length+'건 (다른 페이지 선택 유지)';
    if(selectAll){var selectable=latestOverviewPageItems.filter(latestOverviewSelectAllowed),marked=selectable.filter(function(item){return !!latestOverviewSelected[item.index];}).length;
      selectAll.checked=!!selectable.length&&marked===selectable.length;selectAll.indeterminate=marked>0&&marked<selectable.length;selectAll.disabled=busy||!selectable.length;}
    if(selectFiltered){var possible=latestOverviewFilteredItems.filter(latestOverviewSelectAllowed),selectedFiltered=possible.filter(function(item){var c=latestOverviewSelected[item.index];return !!(c&&c.scope===scopeKey()&&c.researchId===item.id&&c.candidateId===item.candidateId);}).length;selectFiltered.checked=possible.length>0&&selectedFiltered===possible.length;selectFiltered.indeterminate=selectedFiltered>0&&selectedFiltered<possible.length;selectFiltered.disabled=busy||!possible.length;}
    var candidateSelection=selected.filter(function(item){return !!item.candidateId;});
    var aiEligible=selected.some(function(item){return item.kind==='new'||
      (item.kind==='undecided'&&item.candidate&&!frontPublicationActive(item.candidate));});
    if(purge)purge.disabled=busy||!selected.length;
    // 'undecided' is already in the candidate ledger; button opens that board
    // rather than silently disabling the action with selected products.
    if(move)move.disabled=busy||!selected.length;
    if(ai)ai.disabled=busy||!aiEligible;
    if(remove)remove.disabled=busy||!selected.length;
    if(clear)clear.disabled=latestOverviewBusy||!selected.length;
  }
  function latestOverviewKindLabel(item){
    if(item.kind==='slot_candidate')return item.section?'섹션 배치 · '+sectionLabel(item.section):'배치 정보 확인';
    return{new:item.reviewNote?'검증 보류 · 최신 리서치에 유지':'미등록 · 이관 가능',undecided:'미배치 후보',hold:'보류 상품',reject:'일반 제외',purge:'영구 제외',removed:'이미 목록 삭제',duplicate:'중복 원장 확인 필요',other:'기타 보관'}[item.kind]||'상태 확인';
  }
  function wireLatestOverview(){
    var root=$('latestResearchOverview');if(!root||root.getAttribute('data-wired')==='1')return;
    root.setAttribute('data-wired','1');
    root.addEventListener('change',function(event){
      var check=event.target&&event.target.closest&&event.target.closest('[data-latest-overview-select]');
      if(check){var i=Number(check.getAttribute('data-latest-overview-select')),item=latestOverviewPageItems.filter(function(row){return row.index===i;})[0];
        if(item&&latestOverviewSelectAllowed(item)){
          if(check.checked)latestOverviewSelected[i]={scope:scopeKey(),researchId:item.id,candidateId:item.candidateId};
          else delete latestOverviewSelected[i];
          syncLatestOverviewBulkControls();
        }return;}
      var select=event.target&&event.target.closest&&event.target.closest('[data-latest-overview-choose]');if(!select)return;
      var index=Number(select.getAttribute('data-latest-overview-choose')),item=latestOverviewRows().filter(function(x){return x.index===index;})[0];if(!item)return;
      if(select.value)latestOverviewChosenCandidates[item.id]=select.value;else delete latestOverviewChosenCandidates[item.id];
      renderLatestResearchOverview();
    });
    root.addEventListener('click',function(event){
      var button=event.target&&event.target.closest&&event.target.closest('[data-latest-overview-action]');if(!button||!root.contains(button))return;
      var operation=button.getAttribute('data-latest-overview-action'),index=Number(button.getAttribute('data-latest-overview-index'));
      if(!Number.isInteger(index)||index<0)return;
      runLatestOverviewAction(operation,index);
    });
    var filter=$('latestOverviewFilter'),search=$('latestOverviewSearch'),prev=$('latestOverviewPrev'),next=$('latestOverviewNext'),reload=$('latestOverviewReload');
    var selectPage=$('latestOverviewSelectPage'),clear=$('latestOverviewClearSelection'),move=$('latestOverviewBulkMove'),remove=$('latestOverviewBulkDelete'),purge=$('latestOverviewBulkPurge'),ai=$('latestOverviewBulkAiPlace'),selectFiltered=$('latestOverviewSelectFiltered');
    if(selectFiltered)selectFiltered.addEventListener('change',function(){latestOverviewFilteredItems.filter(latestOverviewSelectAllowed).forEach(function(item){if(selectFiltered.checked)latestOverviewSelected[item.index]={scope:scopeKey(),researchId:item.id,candidateId:item.candidateId};else delete latestOverviewSelected[item.index];});renderLatestResearchOverview();});
    if(purge)purge.addEventListener('click',function(){runLatestOverviewMixedRemoval('purge');});
    if(selectPage)selectPage.addEventListener('change',function(){
      latestOverviewPageItems.filter(latestOverviewSelectAllowed).forEach(function(item){
        if(selectPage.checked)latestOverviewSelected[item.index]={scope:scopeKey(),researchId:item.id,candidateId:item.candidateId};
        else delete latestOverviewSelected[item.index];
      });renderLatestResearchOverview();
    });
    if(clear)clear.addEventListener('click',function(){latestOverviewSelected={};renderLatestResearchOverview();});
    if(move)move.addEventListener('click',runLatestOverviewMove);
    if(ai)ai.addEventListener('click',runLatestOverviewAiPlace);
    var followUp=$('latestOverviewOpenHold');if(followUp)followUp.addEventListener('click',function(){var panel=$('excludedLedgerPanel');if(!panel)return;panel.open=true;renderExcludedLedger();var hold=$('productHoldQueue');if(hold)hold.open=true;try{panel.scrollIntoView({behavior:'smooth',block:'start'});}catch(_e){} });
    if(remove)remove.addEventListener('click',function(){runLatestOverviewMixedRemoval('delete');});
    if(filter)filter.addEventListener('change',function(){latestOverviewFilter=filter.value;latestOverviewPage=0;renderLatestResearchOverview();});
    if(search)search.addEventListener('input',function(){latestOverviewSearch=search.value;latestOverviewPage=0;renderLatestResearchOverview();});
    if(prev)prev.addEventListener('click',function(){latestOverviewPage=Math.max(0,latestOverviewPage-1);renderLatestResearchOverview();});
    if(next)next.addEventListener('click',function(){latestOverviewPage+=1;renderLatestResearchOverview();});
    if(reload)reload.addEventListener('click',async function(){if(latestOverviewBusy)return;reload.disabled=true;try{await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});await refreshLatestResearchRows(selectedCountry,selectedSubdivision||'NATIONWIDE',{throwOnFailure:true});renderLatestResearchOverview();show('원장과 조사 기록을 다시 조회했습니다.','ok');}catch(error){show('원장 재조회 실패: '+text(error&&error.message),'warn');}finally{reload.disabled=false;}});
  }
  function renderLatestResearchOverview(){
    var root=$('latestResearchOverview'),body=$('latestOverviewRows');if(!root||!body)return;
    wireLatestOverview();
    var items=latestOverviewRows(),counts={new:0,undecided:0,slot_candidate:0,hold:0,reject:0,purge:0,duplicate:0,removed:0,other:0};
    items.forEach(function(item){counts[item.kind]=(counts[item.kind]||0)+1;});
    var summary=$('latestOverviewSummary');if(summary)summary.textContent='원본 조회 '+items.length+'건 · 삭제 기록 '+counts.removed+'건 · 섹션 배치 '+counts.slot_candidate+' · 미배치 '+counts.undecided+' · 보류 '+counts.hold+' · 제외 '+(counts.reject+counts.purge)+' · 미등록 '+counts.new+(counts.duplicate?' · 중복 '+counts.duplicate:'')+(latestOverviewLedgerComplete?'':' · 후보 원장 재조회 필요');
    var selected=latestOverviewFilter||'all',keyword=text(latestOverviewSearch).toLowerCase(),filtered=items.filter(function(item){
      if(selected==='all'&&item.kind==='removed')return false;
      if(selected!=='all'&&(selected==='excluded'?['purge','reject'].indexOf(item.kind)<0:(selected==='duplicate'?item.duplicateCount<=1:item.kind!==selected)))return false;
      if(keyword&&[item.research.productName,item.research.title,item.research.productUrl,item.research.url,item.candidateId,item.section].map(text).join(' ').toLowerCase().indexOf(keyword)<0)return false;
      return true;
    });
    var limit=LATEST_OVERVIEW_PAGE_SIZE,maxPage=Math.max(0,Math.ceil(filtered.length/limit)-1);latestOverviewPage=Math.min(Math.max(0,latestOverviewPage),maxPage);
    var pageItems=filtered.slice(latestOverviewPage*limit,(latestOverviewPage+1)*limit),busy=latestOverviewBusy||latestQueueActionActive||productVerifiedFlowBusy||!latestProductRowsComplete||!latestOverviewLedgerComplete;
    latestOverviewPageItems=pageItems;latestOverviewFilteredItems=filtered;
    var filterEl=$('latestOverviewFilter'),searchEl=$('latestOverviewSearch');if(filterEl&&filterEl.value!==selected)filterEl.value=selected;if(searchEl&&searchEl.value!==latestOverviewSearch)searchEl.value=latestOverviewSearch;
    body.innerHTML=pageItems.map(function(item,cardIndex){
      var row=item.research,title=text(row.productName||row.title)||'상품명 미확인',url=safeProductDetailUrl(row.productUrl||row.url),image=researchCardImage(row),status=latestOverviewKindLabel(item),disabled=busy||item.kind==='removed'||(item.duplicateCount>1&&!item.candidate),blocked=item.protected,actionDisabled=disabled||blocked,at=item.index;
      var thumb=image?'<img src="'+esc(image)+'" alt="'+esc(title)+'" loading="'+(cardIndex<4?'eager':'lazy')+'" decoding="async" referrerpolicy="no-referrer">':'<span class="latest-overview-no-image">사진 없음</span>';
      // Use the current browser tab, not a separate tab without a Back history.
      // target=_top is required when the country manager is inside /admin iframe.
      var thumbLink=url?'<a class="latest-overview-thumb-link" href="'+esc(url)+'" target="_top" rel="noreferrer external nofollow" title="현재 탭에서 상세페이지 열기 · 브라우저 뒤로가기로 관리자 복귀" aria-label="'+esc(title)+' 상세페이지 열기">'+thumb+'</a>':thumb;
      var checked=!!(latestOverviewSelected[at]&&latestOverviewSelected[at].scope===scopeKey()&&latestOverviewSelected[at].researchId===item.id&&latestOverviewSelected[at].candidateId===item.candidateId&&latestOverviewSelectAllowed(item));
      var mark='<label class="latest-overview-check"><input type="checkbox" data-latest-overview-select="'+at+'" '+(checked?'checked ':'')+(!latestOverviewSelectAllowed(item)||busy?'disabled ':'')+'><span>이 상품 선택</span></label>';
      var link=url?'<a href="'+esc(url)+'" target="_top" rel="noreferrer external nofollow">'+esc(title)+'</a>':'<strong>'+esc(title)+'</strong>';
      var restoreText=item.kind==='new'?'검증 후 미배치 이관':'미배치로 이동',canRestore=item.kind!=='undecided'&&item.kind!=='other'&&item.kind!=='duplicate'&&item.kind!=='removed';
      var why=blocked?'프론트 공개·해제 대기 중인 상품은 먼저 Front Match에서 해제하세요.':item.duplicateCount>1&&!item.candidate?'동일 URL 후보 ID가 중복되어 있습니다. 아래 목록에서 관리할 원장 ID를 직접 선택하세요.':(!latestOverviewLedgerComplete?'후보 원장 전체 조회 후 조작할 수 있습니다.':'');
      var buttons='<div class="latest-overview-actions">'+
        (canRestore?'<button type="button" data-latest-overview-action="restore" data-latest-overview-index="'+at+'" '+(actionDisabled?'disabled ':'')+'> '+restoreText+'</button>':'')+
        (item.candidate&&['slot_candidate','undecided','hold','reject'].indexOf(item.kind)>=0?'<button type="button" class="ghost" data-latest-overview-action="view" data-latest-overview-index="'+at+'">현재 위치 보기</button>':'')+
        '<button type="button" class="secondary" data-latest-overview-action="delete" data-latest-overview-index="'+at+'" '+(actionDisabled?'disabled ':'')+'>목록 삭제</button>'+
        (['purge','removed'].includes(item.kind)?'':'<button type="button" class="ghost" data-latest-overview-action="purge" data-latest-overview-index="'+at+'" '+(actionDisabled?'disabled ':'')+'>영구 제외</button>')+'</div>';
      var choose=item.duplicateCount>1?'<label class="small">중복 후보 '+item.duplicateCount+'건 중 작업 대상 <select data-latest-overview-choose="'+at+'"><option value="">후보 ID를 선택하세요</option>'+item.matches.map(function(match){var id=frontCandidateLedgerId(match),label=productDecision(match)+' / '+(assignedSectionKey(match)||'미배치')+' / '+id;return'<option value="'+esc(id)+'" '+(item.candidateId===id?'selected':'')+'>'+esc(label)+'</option>';}).join('')+'</select></label>':'';
      var price=text(row.priceDisplay||row.displayPrice||row.price||item.candidate&&item.candidate.price||''),currency=text(row.priceCurrency||row.currency||item.candidate&&item.candidate.priceCurrency||''),seller=text(row.supplierName||row.sellerName||item.candidate&&item.candidate.supplierName||'');
      var meta='<span class="latest-overview-meta">'+(price?'가격 '+esc(price)+(currency?' '+esc(currency):''):'가격: 판매처 확인')+(seller?' · '+esc(seller):'')+'</span>';
      return'<article class="latest-overview-row" data-latest-overview-row="'+at+'"><div class="latest-overview-thumb">'+thumbLink+'</div><div class="latest-overview-info">'+mark+link+meta+'<span class="latest-overview-url" title="'+esc(url||text(row.productUrl||row.url)||'')+'">'+esc(url||text(row.productUrl||row.url)||'상품 주소 없음')+'</span><span class="latest-overview-status" data-status="'+esc(item.kind)+'">'+esc(status)+(blocked?' · 프론트 보호':'')+'</span>'+choose+(why?'<span class="small">'+esc(why)+'</span>':'')+'</div>'+buttons+'</article>';
    }).join('')||'<div class="small" style="padding:12px">해당 조건의 상품이 없습니다.</div>';
    var pageState=$('latestOverviewPageState');if(pageState)pageState.textContent=filtered.length+'건 중 '+(filtered.length?latestOverviewPage*limit+1:0)+'–'+Math.min(filtered.length,(latestOverviewPage+1)*limit)+'건 · '+(latestOverviewPage+1)+'/'+(maxPage+1)+'페이지 · 페이지당 최대 '+limit+'건';
    Array.prototype.forEach.call(body.querySelectorAll('.latest-overview-thumb img'),function(img){img.addEventListener('error',function(){var holder=img.parentNode;if(holder&&holder.tagName==='A')holder=holder.parentNode;if(holder){img.classList.add('hidden');if(!holder.querySelector('.latest-overview-no-image')){var note=document.createElement('span');note.className='latest-overview-no-image';note.textContent='이미지 링크 검증 필요';holder.appendChild(note);}}},{once:true});});
    var prev=$('latestOverviewPrev'),next=$('latestOverviewNext');    if(prev)prev.disabled=latestOverviewPage<=0;if(next)next.disabled=latestOverviewPage>=maxPage;
    syncLatestOverviewBulkControls();
  }
  function latestOverviewOpenCandidateBoard(ids){
    var matched=Array.from(new Set((ids||[]).map(text).filter(Boolean))).filter(function(id){
      return productRows.some(function(row){return frontCandidateLedgerId(row)===id;});
    });
    if(!matched.length)return;
    queueFocusedCandidateIds=matched.slice(0,500);
    var panel=$('productCandidatePanel');if(panel)panel.open=true;
    renderProductCandidateGroups();
    var pool=$('productGrid')&&$('productGrid').querySelector('details[data-product-group="unassigned"]');
    if(pool)pool.open=true;
    // A transfer verification must actually bring the operator to the working
    // candidate manager. Merely opening a hidden block looked like a no-op.
    try{if(panel&&typeof panel.scrollIntoView==='function')panel.scrollIntoView({behavior:'smooth',block:'start'});}catch(_scrollError){}
  }
  async function runLatestOverviewMove(itemsOverride){
    show('상단 간편 관리 기능은 사용 중지했습니다. 아래 전체 상품 후보·배치 관리 목록의 최신 리서치 전용 섹션에서 진행하세요.','warn');return;
    if(latestOverviewBusy||latestQueueActionActive||productVerifiedFlowBusy||productAutomationActive)return;
    if(!latestProductRowsComplete||!latestOverviewLedgerComplete){show('리서치·후보 원장 전체 조회 후 이관할 수 있습니다.','warn');return;}
    var selected=Array.isArray(itemsOverride)?itemsOverride:latestOverviewSelectedItems(),originalScope=scopeKey(),scope=scopeSnapshot();
    if(!selected.length){show('이관할 상품을 선택하세요.','warn');return;}
    // Snapshot each ID before any refresh: research-row array indices and UI selections
    // are not authoritative after a successful write.
    var fresh=selected.filter(function(x){return x.kind==='new'&&!x.candidateId;}),
      present=selected.filter(function(x){return x.kind==='undecided'&&!!x.candidateId;}),
      moving=selected.filter(function(x){return !!x.candidateId&&['slot_candidate','hold','reject','purge'].indexOf(x.kind)>=0&&!x.protected;}),
      protectedRows=selected.filter(function(x){return !!x.protected;}),
      unknown=selected.filter(function(x){return fresh.indexOf(x)<0&&present.indexOf(x)<0&&moving.indexOf(x)<0&&protectedRows.indexOf(x)<0;});
    if(!window.confirm('선택 '+selected.length+'건: 이미 후보 원장 미배치 '+present.length+'건(변경 불필요), 신규 실상품 검증·이관 '+fresh.length+'건, 다른 비공개 상태에서 미배치 이동 '+moving.length+'건, 공개 보호 '+protectedRows.length+'건, 중복/확인 필요 '+unknown.length+'건입니다.\n\n2건 이하씩 순차 처리하며 실제 원장에서 확인합니다. 공개 상품은 변경하지 않습니다. 계속할까요?'))return;
    var progress=$('latestOverviewOperationStatus'),errors=[],movedIds=[],newCandidateIds=[],alreadyIds=present.map(function(x){return x.candidateId;});
    // Hold the overview controls while performing the authority mutations;
    // the stage function has its own independent busy flag and progress updates.
    try{
      // Use exact candidate IDs, and the same authority endpoint used by the
      // known-good '전체 상품 후보 배치 관리 목록' for section->unassigned moves.
      if(moving.length){
        var moveIds=Array.from(new Set(moving.map(function(x){return x.candidateId;})));
        var moved=await authorityCandidateAction('undecided',moveIds,'',{source:'administrator',chunkSize:2,onProgress:function(done,total,failed){if(progress)progress.textContent='기존 후보 미배치 이동 '+done+'/'+total+' · 실패 '+failed;}});
        movedIds=(moved.processedIds||[]).map(text).filter(Boolean);
        (moved.failures||[]).forEach(function(x){errors.push(text(x.candidateId||x.id)+' · '+text(x.error));});
        if(movedIds.length<moveIds.length&&!moved.failures.length)errors.push('미배치 이동 '+(moveIds.length-movedIds.length)+'건은 서버 완료 ID가 확인되지 않았습니다.');
      }
      if(scopeKey()!==originalScope)throw new Error('국가·지역이 변경되어 나머지 이관을 중단했습니다.');
      if(fresh.length){
        // The latest research inbox is not the C candidate ledger. Use the
        // verified source->candidate stage API, never the queue-control restore
        // API (which requires a preexisting candidate ID).
        for(var pos=0;pos<fresh.length;pos+=2){
          if(scopeKey()!==originalScope)throw new Error('국가·지역 변경으로 신규 이관을 중단했습니다.');
          var group=fresh.slice(pos,pos+2),ids=group.map(function(x){return x.id;});
          if(progress)progress.textContent='신규 실상품 검증·후보 이관 '+Math.min(pos+group.length,fresh.length)+'/'+fresh.length+'건 · 2건 단위';
          var staged=await runLatestProductQueueAction('stage','selected',{idsOverride:ids,skipConfirm:true});
          (staged&&staged.candidateIds||[]).forEach(function(id){id=text(id);if(id&&newCandidateIds.indexOf(id)<0)newCandidateIds.push(id);});
          if(!staged||staged.ok===false||Number(staged.failed||0)||Number(staged.blocked||0)){
            errors.push('신규 '+ids.join(', ')+' · '+text(staged&&staged.error&&staged.error.message||'상세페이지 검증 보류 또는 원장 저장 미확인'));
          }
        }
      }
      if(scopeKey()!==originalScope)throw new Error('국가·지역이 변경되어 원장 조회를 중단했습니다.');
      var latest=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
      if(!latest||!latest.pipeline||latest.pipeline.ledgerLoadComplete!==true)throw new Error('전체 후보 원장 재조회 완료 여부를 확인하지 못했습니다.');
      var ledgerMap={};productRows.forEach(function(row){var id=frontCandidateLedgerId(row);if(id)ledgerMap[id]=row;});
      var kept=alreadyIds.filter(function(id){return ledgerMap[id]&&productDecision(ledgerMap[id])==='undecided';}),
        confirmedMoves=movedIds.filter(function(id){return ledgerMap[id]&&productDecision(ledgerMap[id])==='undecided';}),
        confirmedNew=newCandidateIds.filter(function(id){return ledgerMap[id]&&productDecision(ledgerMap[id])==='undecided';});
      if(confirmedMoves.length<movedIds.length)errors.push('기존 후보 '+(movedIds.length-confirmedMoves.length)+'건은 원장 미배치 상태 확인 필요');
      if(confirmedNew.length<newCandidateIds.length)errors.push('신규 후보 '+(newCandidateIds.length-confirmedNew.length)+'건은 원장 미배치 상태 확인 필요');
      var successful=Array.from(new Set(kept.concat(confirmedMoves,confirmedNew)));
      if(successful.length)latestOverviewOpenCandidateBoard(successful);
      var msg='후보 관리 원장 재확인 · 이미 미배치 '+kept.length+'/'+present.length+' · 기존 후보 이동 '+confirmedMoves.length+'/'+moving.length+' · 신규 등록 '+confirmedNew.length+'/'+fresh.length+' · 공개 보호 '+protectedRows.length+' · 중복/확인 필요 '+unknown.length;
      if(errors.length)msg+=' · 실패 사유 '+errors.slice(0,5).join(' / ');
      if(progress)progress.textContent=msg;
      show(msg,errors.length?'warn':'ok');
      return{ok:!errors.length,already:kept.length,moved:confirmedMoves.length,created:confirmedNew.length,protected:protectedRows.length,errors:errors};
    }catch(error){var msg='후보 원장 이관·검증 중단: '+text(error&&error.message);if(progress)progress.textContent=msg;show(msg,'warn');return{ok:false,error:msg,errors:errors};}
    finally{renderLatestProductRows();}
  }
  async function runLatestOverviewAiPlace(){
    show('상단 간편 관리 기능은 사용 중지했습니다. 아래 후보 관리 목록의 최신 리서치 전용 섹션에서 진행하세요.','warn');return;
    if(latestOverviewBusy||latestQueueActionActive||productVerifiedFlowBusy||productAutomationActive)return;
    if(!latestProductRowsComplete||!latestOverviewLedgerComplete){show('리서치·후보 원장 전체 조회 완료 후 AI 자동 이관·배치를 시작하세요.','warn');return;}
    var selected=latestOverviewSelectedItems(),fresh=selected.filter(function(x){return x.kind==='new'&&!x.candidateId;}),
      pending=selected.filter(function(x){return x.kind==='undecided'&&x.candidate&&!x.protected;}),
      skipped=selected.length-fresh.length-pending.length,frozen=scopeKey(),errors=[];
    if(!fresh.length&&!pending.length){show('AI 자동배치 가능 대상이 없습니다. 신규 또는 미배치 상품을 선택하세요.','warn');return;}
    if(!window.confirm('신규 '+fresh.length+'건은 상품 상세주소 검증→후보 등록→AI 검증·섹션 배치, 기존 미배치 '+pending.length+'건은 재검증→섹션 배치를 순차 실행합니다.\n\n기존 섹션 배치/공개/보류·제외 '+skipped+'건은 변경하지 않습니다. 프론트 공개는 별도 단계입니다. 계속할까요?'))return;
    var progress=$('latestOverviewOperationStatus'),registered=[],confirmedNew=0,placed=0,held=0,inconclusive=0;
    try{
      var candidateIds=Array.from(new Set(pending.map(function(x){return x.candidateId;}).filter(Boolean)));
      for(var pos=0;pos<fresh.length;pos+=2){
        if(scopeKey()!==frozen)throw new Error('국가·지역 변경으로 AI 작업을 중단했습니다.');
        var chunk=fresh.slice(pos,pos+2),stage=await runLatestProductQueueAction('stage','selected',{idsOverride:chunk.map(function(x){return x.id;}),skipConfirm:true});
        (stage&&stage.candidateIds||[]).forEach(function(id){id=text(id);if(id&&registered.indexOf(id)<0)registered.push(id);});
        if(!stage||stage.ok===false||Number(stage.failed||0)||Number(stage.blocked||0))errors.push('신규 실상품 '+chunk.map(function(x){return x.id;}).join(', ')+' · 검증 보류/원장 이관 실패: '+text(stage&&stage.error&&stage.error.message||'상세페이지 판정 확인 필요'));
        if(progress)progress.textContent='신규 상품 후보 원장 검증 '+Math.min(pos+chunk.length,fresh.length)+'/'+fresh.length+' · 신규 등록 ID '+registered.length;
      }
      if(scopeKey()!==frozen)throw new Error('국가·지역 변경으로 AI 작업을 중단했습니다.');
      var ledger=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
      if(!ledger||!ledger.pipeline||ledger.pipeline.ledgerLoadComplete!==true)throw new Error('후보 원장 전체 재조회에 실패했습니다. AI 배치를 중단합니다.');
      var byId={};productRows.forEach(function(row){byId[frontCandidateLedgerId(row)]=row;});
      confirmedNew=registered.filter(function(id){return byId[id]&&productDecision(byId[id])==='undecided';}).length;
      if(confirmedNew<registered.length)errors.push('신규 후보 '+(registered.length-confirmedNew)+'건은 미배치 원장 재조회가 안 되어 AI 배치에서 제외했습니다.');
      var placementIds=Array.from(new Set(candidateIds.concat(registered))).filter(function(id){return byId[id]&&productDecision(byId[id])==='undecided'&&!frontPublicationActive(byId[id]);});
      var count=productSectionCounts();
      // One candidate at a time; never allow a failed item to block all later
      // items or cause the previous successful items to be repeated.
      for(var i=0;i<placementIds.length;i++){
        if(scopeKey()!==frozen)throw new Error('국가·지역 변경으로 AI 작업을 중단했습니다.');
        var id=placementIds[i];
        try{
          var result=await api(CONTROL,'product_candidate_verified_psom_place','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',candidateIds:[id],balanceCounts:count,scopeAuthority:'administrator-selected',ignoreRequestGeo:true},90000);
          if(!result||!Array.isArray(result.results)||!result.results.length)throw new Error('서버 상품 판정 없음');
          if(result.balanceCounts)count=result.balanceCounts;
          var entry=result.results.find(function(x){return text(x.candidateId)===id;})||result.results[0];
          if(entry.assigned===true)placed++;
          else if(entry.held===true)held++;
          else if(entry.inconclusive===true)inconclusive++;
          else errors.push(id+' · '+text(entry.reason||entry.error||'배치 미확인'));
        }catch(error){errors.push(id+' · '+conciseRequestError(error&&error.message,error&&error.status));}
        if(progress)progress.textContent='실상품 AI 재검증·20개 섹션 배치 '+(i+1)+'/'+placementIds.length+' · 성공 '+placed+' · 보류 '+held+' · 확인대기 '+inconclusive+' · 오류 '+errors.length;
      }
      if(scopeKey()!==frozen)throw new Error('국가·지역 변경으로 결과 조회를 중단했습니다.');
      var refreshed=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
      if(!refreshed||!refreshed.pipeline||refreshed.pipeline.ledgerLoadComplete!==true)throw new Error('AI 배치 후 원장을 전부 읽지 못했습니다. 결과 확정 보류');
      var finalById={};productRows.forEach(function(row){finalById[frontCandidateLedgerId(row)]=row;});
      var confirmed=placementIds.filter(function(id){var row=finalById[id];return row&&productDecision(row)==='slot_candidate'&&!!assignedSectionKey(row);});
      if(confirmed.length<placed)errors.push('AI 응답과 원장 배치 건수가 다릅니다. '+confirmed.length+'/'+placed+' 재확인');
      var msg='AI 상품 검증·섹션 자동배치 · 신규 원장 등록 확인 '+confirmedNew+'/'+fresh.length+'건 · 배치 원장 확인 '+confirmed.length+'/'+placementIds.length+'건 · 보류 '+held+' · 추가 확인 '+inconclusive+' · 기존 배치/보호 보존 '+skipped+'건';
      if(errors.length)msg+=' · 실패/추가 확인 '+errors.slice(0,5).join(' / ');
      if(progress)progress.textContent=msg;show(msg,errors.length?'warn':'ok');
      return{registered:confirmedNew,assigned:confirmed.length,held:held,inconclusive:inconclusive,errors:errors};
    }catch(error){var msg='AI 이관·배치 처리 중단: '+text(error&&error.message);if(progress)progress.textContent=msg;show(msg,'warn');return{registered:confirmedNew,assigned:placed,error:msg};}
    finally{renderLatestProductRows();}
  }
  async function runLatestOverviewMixedRemoval(action){
    if(latestOverviewBusy||latestQueueActionActive||productVerifiedFlowBusy)return;
    if(!latestProductRowsComplete||!latestOverviewLedgerComplete){show('리서치와 후보 원장의 완전한 조회 후 삭제할 수 있습니다. 새로고침을 실행하세요.','warn');return;}
    var selected=latestOverviewSelectedItems();
    var newRows=selected.filter(function(item){return item.kind==='new'&&!item.candidateId;});
    var persisted=selected.filter(function(item){return !!item.candidateId;});
    if(!selected.length){show('삭제/영구 제외할 상품을 먼저 선택해 주세요.','warn');return;}
    var frozen=scopeKey(),country=selectedCountry,region=selectedSubdivision||'NATIONWIDE';
    var label=action==='purge'?'영구 제외(재수집 차단)':'목록 삭제(재수집 허용)';
    if(!window.confirm('선택 상품 '+selected.length+'건의 '+label+' 작업을 실행하시겠습니까?\n' +
      '리서치 원본만 존재하는 '+newRows.length+'건은 리서치 작업 원장에, 기존 후보 '+persisted.length+'건은 실제 후보 ID에 처리합니다.\n' +
      '프론트 공개·공개 해제 대기 상품은 변경하지 않습니다.'))return;
    var processed=0,failed=0,notes=[];
    // Read-only original search results remain immutable; the research-job
    // exclusion tombstone is the authoritative latest-list removal marker.
    if(persisted.length){
      var ledger=await runLatestOverviewBulk(action,persisted,{skipConfirm:true});
      processed+=Number(ledger&&ledger.processed||0);
      failed+=Number(ledger&&ledger.failed!=null?ledger.failed:persisted.length);
      if(ledger&&ledger.error)notes.push(text(ledger.error));
    }
    if(scopeKey()!==frozen){show('국가·지역 변경으로 다른 상품 삭제를 중단했습니다.','warn');return;}
    if(newRows.length){
      var ids=newRows.map(function(item){return item.id;});
      var source=await runLatestProductQueueAction(action==='purge'?'purge':'delete','selected',{
        idsOverride:ids,skipConfirm:true});
      if(scopeKey()!==frozen){show('국가·지역 변경으로 저장 확인을 중단했습니다.','warn');return;}
      // This source queue reports handled/failed/blocked separately; a
      // product merely selected on screen is never counted as deleted.
      processed+=Number(source&&source.handled||0);
      failed+=Number(source&&source.failed||0)+Number(source&&source.blocked||0);
      if(!source||source.ok===false){
        if(!source)failed+=newRows.length;
        else if(!source.handled&&!source.failed&&!source.blocked)failed+=newRows.length;
        notes.push(text(source&&source.error&&source.error.message||'리서치 원장 작업 미확인'));
      }
      try{
        await refreshLatestResearchRows(country,region,{throwOnFailure:true});
        var live=new Set(latestProductRows.map(latestProductKey));
        var remaining=ids.filter(function(id){return live.has(id);});
        if(remaining.length){failed+=remaining.length;notes.push('리서치 목록 재조회 후 '+remaining.length+'건이 여전히 표시됨');}
      }catch(error){notes.push('원본 리서치 재조회 실패: '+text(error&&error.message));failed+=1;}
    }
    if(scopeKey()!==frozen)return;
    var report=label+' · 요청 '+selected.length+'건 · 서버 처리 '+processed+'건 · 확인 필요 '+failed+'건'+(notes.length?' · '+notes.slice(0,3).join(' / '):'');
    var area=$('latestOverviewOperationStatus');if(area)area.textContent=report;
    show(report,failed||notes.length?'warn':'ok');
    renderLatestProductRows();
  }

  async function runLatestOverviewBulk(action,chosenOverride,options){
    options=options||{};
    if(latestOverviewBusy||latestQueueActionActive||productVerifiedFlowBusy)return;
    if(!latestProductRowsComplete||!latestOverviewLedgerComplete){show('원본 리서치와 후보 원장의 전체 조회가 끝나야 일괄 작업할 수 있습니다.','warn');return;}
    var chosen=Array.isArray(chosenOverride)?chosenOverride:latestOverviewSelectedItems(),eligible=chosen.filter(function(item){return !!item.candidateId&&(action!=='restore'||(['hold','reject','purge'].indexOf(item.kind)<0));});
    var seen={},unique=[];eligible.forEach(function(item){if(!seen[item.candidateId]){seen[item.candidateId]=true;unique.push(item);}});
    if(!unique.length){show(action==='restore'?'미배치로 옮길 상품을 선택해 주세요.':'목록에서 삭제할 상품을 선택해 주세요.','warn');return;}
    var label=action==='restore'?'미배치로 이동':action==='purge'?'영구 제외':'목록 삭제',frozenScope=scopeKey(),country=selectedCountry,region=selectedSubdivision||'NATIONWIDE';
    // Revalidate the selected durable IDs against the latest complete snapshot.
    // Scope changes and already-public items are never submitted to the write API.
    unique=unique.filter(function(item){return !!latestOverviewCanonicalById[item.candidateId]&&!frontPublicationActive(latestOverviewCanonicalById[item.candidateId]);});
    if(!unique.length){show('현재 원장에서 변경 가능한 상품이 없습니다. 원장을 새로고침하세요.','warn');return;}
    var ids=unique.map(function(item){return item.candidateId;});
    if(options.skipConfirm!==true&&!window.confirm('선택 후보 '+ids.length+'건 '+label+'를 실행하시겠습니까?\n\n프론트 공개 상품은 보호되며, 삭제 시 원본 리서치 이력은 유지되고 재수집은 허용됩니다.'))return;
    latestOverviewBusy=true;renderLatestResearchOverview();
    var state=$('latestOverviewOperationStatus'),success={},failures=[],warnings=[];
    try{
      for(var start=0;start<ids.length;start+=8){
        if(scopeKey()!==frozenScope)throw new Error('국가·지역 변경 감지. 나머지 작업을 중단했습니다.');
        var batch=ids.slice(start,start+8);if(state)state.textContent=label+' 처리 '+Math.min(ids.length,start+batch.length)+'/'+ids.length;
        try{
          var result=await api(QUEUE_CONTROL,'bulk_action','POST',{}, {candidateIds:batch,decision:action==='restore'?'restore':action==='purge'?'purge':'dismiss',countryCode:country,subdivisionCode:region},60000);
          (result.processedIds||[]).forEach(function(id){success[text(id)]=true;});
          (result.failures||[]).forEach(function(row){failures.push(text(row.id)+' · '+text(row.error));});
          (result.results||[]).forEach(function(row){if(row.warning)warnings.push(text(row.id)+' · '+text(row.warning));});
          batch.forEach(function(id){if(!success[id]&&!(result.failures||[]).some(function(row){return text(row.id)===id;}))failures.push(id+' · 처리 확인 불가');});
        }catch(error){batch.forEach(function(id){failures.push(id+' · '+conciseRequestError(error&&error.message,error&&error.status));});}
      }
      if(scopeKey()!==frozenScope)throw new Error('국가·지역 변경 후 결과를 반영하지 않았습니다.');
      var readError='';
      try{await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});await refreshLatestResearchRows(country,region,{throwOnFailure:true});}
      catch(error){readError=text(error&&error.message)||'원장 재조회 실패';}
      // A write acknowledgment alone is not proof of the requested final state.
      // Reconcile only against the freshly read canonical candidate ledger.
      var confirmed={};
      if(!readError){var ledgerById=latestOverviewCanonicalById;
        Object.keys(success).forEach(function(id){var row=ledgerById[id],decision=row&&productDecision(row),expected=action==='restore'?'undecided':action==='purge'?'purge':'removed';
          if(row&&(decision===expected||(expected==='removed'&&decision==='removed_from_list')))confirmed[id]=true;else failures.push(id+' · 재조회 상태 불일치 ('+(decision||'원장에 없음')+')');
        });
        unique.forEach(function(item){if(confirmed[item.candidateId])delete latestOverviewSelected[item.index];});
      }
      var processed=Object.keys(confirmed).length,report=label+' · 원장 재확인 '+processed+'/'+ids.length+'건'+(readError?' · 서버 응답 '+Object.keys(success).length+'건, 검증 보류':'')+(failures.length?' · 실패/불일치 '+failures.length+'건':'')+(warnings.length?' · 조사이력 확인 '+warnings.length+'건':'')+(readError?' · 재조회 지연: '+readError:'');
      if(state)state.textContent=report+(failures.length?' · '+failures.slice(0,3).join(' / '):'');
      show(report,failures.length||warnings.length||readError?'warn':'ok');
      return{processed:processed,requested:ids.length,failed:failures.length+(readError?1:0),readError:readError};
    }catch(error){if(state)state.textContent='일괄 작업 중단 · '+text(error&&error.message);show('일괄 작업 중단: '+text(error&&error.message),'fail');return{processed:0,requested:ids.length,failed:ids.length,error:text(error&&error.message)};}
    finally{latestOverviewBusy=false;renderLatestProductRows();}
  }
  async function runLatestOverviewAction(action,index){
    if(latestOverviewBusy||latestQueueActionActive||productVerifiedFlowBusy)return;
    var item=latestOverviewRows().filter(function(x){return x.index===index;})[0];if(!item)return;
    if(action==='view'){
      if(!item.candidate)return;
      var panel,groupKey='';
      if(item.kind==='hold'||item.kind==='reject'){panel=$('excludedLedgerPanel');groupKey=item.kind==='hold'?'productHoldQueue':'productRejectQueue';}
      else{panel=$('productCandidatePanel');queueFocusedCandidateIds=[item.candidateId];groupKey='queue_selected';}
      if(!panel){show('현재 상품의 관리 섹션을 찾지 못했습니다.','warn');return;}
      panel.open=true;if(panel.id==='productCandidatePanel')renderProductCandidateGroups();else renderExcludedLedger();
      var target=groupKey==='productHoldQueue'||groupKey==='productRejectQueue'?$(groupKey):Array.prototype.filter.call(panel.querySelectorAll('details[data-product-group]'),function(x){return x.getAttribute('data-product-group')===groupKey;})[0];
      if(target){target.open=true;try{target.scrollIntoView({block:'start',behavior:'smooth'});}catch(_e){}}return;
    }
    if(!latestProductRowsComplete||!latestOverviewLedgerComplete){show('원본 조사·후보 원장 전체 조회가 끝나야 변경할 수 있습니다. 먼저 원장 새로고침을 실행하세요.','warn');return;}
    if(item.duplicateCount>1&&!item.candidate){show('중복 상품 URL입니다. 관리할 실제 후보 ID를 선택한 뒤 실행하세요.','warn');return;}
    if(item.protected){show('프론트 공개 또는 공개 해제 대기 상품입니다. Front Match에서 먼저 공개를 해제한 뒤 관리해 주세요.','warn');return;}
    var title=text(item.research.productName||item.research.title||item.id),message=action==='restore'?'이 상품을 미배치 후보 목록으로 이동하시겠습니까? 기존 섹션 배치가 있으면 해제하며 프론트 공개는 하지 않습니다.':action==='delete'?'이 상품을 관리 목록에서 삭제하시겠습니까? 연구 이력은 보존하고 다시 조사할 수 있습니다.':'이 상품을 영구 제외하고 같은 상품의 자동 재등록을 차단하시겠습니까?';
    if(!window.confirm(title+'\n\n'+message))return;
    // A genuinely new research row uses the existing verified research->C
    // transfer. Linked rows use their actual persisted candidate ID; never
    // derive a fresh ID from the research URL and accidentally duplicate it.
    if(action==='restore')return runLatestOverviewMove([item]);
    var frozen=scopeKey(),country=selectedCountry,region=selectedSubdivision||'NATIONWIDE';
    latestOverviewBusy=true;renderLatestResearchOverview();var state=$('latestOverviewOperationStatus');if(state)state.textContent='상품 처리 중 · '+title;
    try{
      var result=null;
      if(item.candidate){
        var decision=action==='restore'?'restore':action==='delete'?'dismiss':'purge';
        result=await api(QUEUE_CONTROL,'bulk_action','POST',{}, {candidateIds:[item.candidateId],decision:decision,countryCode:country,subdivisionCode:region},45000);
        if(Number(result&&result.processed||0)!==1||result.failures&&result.failures.length)throw new Error('후보 원장 수정이 확인되지 않았습니다: '+text(result.failures&&result.failures[0]&&result.failures[0].error));
      }else{
        var operation=action==='delete'?'delete':'purge';
        var liveJobId=await currentResearchJobIdForWrite(country,region);
        result=await api(CONTROL,'product_research_stage_current','POST',{}, {countryCode:country,subdivisionCode:region,jobId:liveJobId,source:'latest_list_manual',operation:operation,productIds:[item.id],productRefs:latestRefsForRows([item.research])},45000);
        if(!result||result.ok===false||Number(result.partialQueue&&result.partialQueue.failed||0)>0||Number(result.partialQueue&&result.partialQueue.handled||0)<1)throw new Error('원본 조사 기록 변경을 확인하지 못했습니다.');
      }
      if(scopeKey()!==frozen)throw new Error('처리 중 국가·지역이 바뀌었습니다. 원장을 다시 조회하세요.');
      var readError='';
      try{await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});await refreshLatestResearchRows(country,region,{throwOnFailure:true});}
      catch(error){readError=text(error&&error.message)||'requery_failed';}
      if(readError){if(state)state.textContent='저장 성공 · 재조회 지연: '+readError;show('상품 처리 저장은 성공했으나 재조회가 지연됐습니다. 같은 버튼을 반복 누르지 말고 원장을 새로고침해 주세요.','warn');}
      else{var verified=true;if(item.candidateId){var reread=latestOverviewCanonicalById[item.candidateId],actual=reread&&productDecision(reread),expected=action==='restore'?'undecided':action==='delete'?'removed':'purge';verified=!!reread&&(actual===expected||(expected==='removed'&&actual==='removed_from_list'));}
        if(!verified){if(state)state.textContent='서버 응답 수신 · 원장 상태 불일치 · '+title;show('서버 응답 후 원장을 재조회했지만 요청한 최종 상태가 확인되지 않았습니다. 중복 실행 전에 원장 상태를 확인하세요.','warn');}
        else{if(state)state.textContent='저장·원장 검증 완료 · '+title;show(action==='restore'?'미배치 후보로 이동했습니다.':action==='delete'?'관리 목록에서 삭제했습니다. 재수집은 허용됩니다.':'영구 제외했습니다.','ok');}}
    }catch(error){if(state)state.textContent='처리 실패 · '+text(error&&error.message);show('상품 작업 실패: '+text(error&&error.message),'fail');}
    finally{latestOverviewBusy=false;renderLatestProductRows();}
  }
  function latestVisibleResearchRows(){
    // Derive the hand-off from the durable C-stage ledger, never from a click
    // response or browser-only flag. This stays correct after a page reload.
    var accepted={};productRows.forEach(function(row){
      if(!row||row.ledgerSource!=='candidate')return;
      var decision=productDecision(row),queue=row.queueControl||{},review=row.review||{};
      // Only the RESEARCH INBOX is new. A candidate already present in the
      // durable candidate/hold/reject boards has a destination and must not
      // be re-staged during an explicit latest-list transfer.
      if(['undecided','slot_candidate','hold','reject','purge'].indexOf(decision)<0)return;
      [row.originalOfficialProductUrl,row.productUrl,row.url].forEach(function(value){
        var key=productUrlMatchKey(value);if(key)accepted[key]=true;
      });
    });
    return latestProductRows.filter(function(row){return accepted[productUrlMatchKey(row&&row.productUrl||row&&row.url)]!==true;});
  }
  function latestSelectedIds(){var valid={};latestVisibleResearchRows().forEach(function(row){var id=latestProductKey(row);if(id)valid[id]=true;});return Object.keys(latestSelectedProducts).filter(function(id){return latestSelectedProducts[id]===true&&valid[id];});}
  function latestProductRef(row){var id=latestProductKey(row),index=Number(row&&row.researchResultIndex);return id&&Number.isFinite(index)&&index>=0?{id:id,resultIndex:Math.floor(index)}:null;}
  function latestRowsForIds(ids){var wanted={};(ids||[]).forEach(function(id){wanted[text(id)]=true;});return latestProductRows.filter(function(row){return wanted[latestProductKey(row)]===true;});}
  function latestRefsForRows(rows){return (rows||[]).map(latestProductRef).filter(Boolean);}
  function latestTransferAliases(row){return Array.from(new Set([latestProductKey(row),text(row&&row.productIdentity),text(row&&row.productUrl),text(row&&row.url)].map(text).filter(Boolean)));}
  function markLatestTransferredRows(rows,keys,target){var wanted={};(Array.isArray(keys)?keys:[]).map(text).filter(Boolean).forEach(function(key){wanted[key]=true;});if(!Object.keys(wanted).length)return 0;var added=0;(rows||[]).forEach(function(row){var aliases=latestTransferAliases(row),matched=aliases.some(function(key){return wanted[key]===true;});if(!matched)return;var id=latestProductKey(row);if(id&&target[id]!==true){target[id]=true;added+=1;}});return added;}

  function ensureLatestProductQueueControls(){
    var grid=$('latestProductGrid');if(!grid||!grid.parentNode)return;
    var toolbar=$('latestProductQueueToolbar');
    if(!toolbar){toolbar=document.createElement('div');toolbar.id='latestProductQueueToolbar';toolbar.className='section-product-toolbar candidate-bulk-toolbar';toolbar.innerHTML='<label class="product-front-select-label"><input id="latestProductSelectAll" type="checkbox"> 미등록 목록 전체 선택(모든 페이지)</label><span id="latestProductSelectedCount" class="pill info">선택 상품 0건</span><button id="latestSelectedQueueStageBtn" type="button" class="product-section-front-button" disabled>선택 검증 정상상품 원장 복귀</button><button id="latestSelectedAiBtn" type="button" class="product-section-ai-button" disabled>선택 상품 AI 검증만</button><button id="latestSelectedVerifiedPsomBtn" type="button" class="product-section-ai-button" disabled>선택 정상상품 PSOM 자동 섹션 배치</button><button id="latestAllQueueStageBtn" type="button" class="secondary" disabled>미등록 정상상품 전체 원장 복귀</button><button id="latestAllAiBtn" type="button" class="product-section-ai-button" disabled>미등록 상품 전체 AI 검증만</button><button id="latestAllVerifiedPsomBtn" type="button" class="product-section-ai-button" disabled>미등록 정상상품 PSOM 자동 섹션 배치</button><label class="small">복귀 위치 <select id="latestVerifiedPlacement"><option value="unassigned">미배치 후보(기본)</option><option value="psom">PSOM 자동 섹션 배치</option></select></label><span id="latestVerifiedReviewCount" class="small">정상 검증 0건</span><button type="button" class="ghost" id="latestVerifiedReviewReloadBtn">이전 검증 결과 불러오기</button><div id="latestVerifiedReviewList" class="small"></div><button id="latestExactDuplicateBtn" type="button" class="ghost">동일 상세 URL 중복 확인·JSON</button><span id="latestDuplicateState" class="small"></span><button id="latestSelectedQueueUnmatchBtn" type="button" class="product-section-unmatch-button" disabled>선택 상품 후보 등록 해제</button><button id="latestSelectedQueueDeleteBtn" type="button" class="secondary" disabled>선택 상품 목록 삭제·재수집 허용</button><button id="latestSelectedPermanentExcludeBtn" type="button" class="danger" disabled>선택 상품 영구 제외</button><span id="latestManualActionState" class="small" aria-live="polite"></span><span id="latestLedgerLinkSummary" class="small" aria-live="polite"></span>';grid.parentNode.insertBefore(toolbar,grid);}
  }
  function syncLatestProductQueueControls(){
    ensureLatestProductQueueControls();var ids=latestSelectedIds(),all=$('latestProductSelectAll'),count=$('latestProductSelectedCount'),hardBusy=latestQueueActionActive||productQueueStageActive||productAutomationActive||productFrontSyncActive,allStageBusy=hardBusy,hasRows=latestVisibleResearchRows().length>0;
    /* "최신 상품 전체" means every row that is already visible in the current
       latest-research list, not every product that may be discovered later in the
       still-running research job.  The server receives those rows as an explicit
       selection, so they are safe to register/validate while research continues.
       The separate "현재 조사분 후보 관리목록 등록" control remains the only
       whole-job action that requires completion or a durable pause checkpoint. */
    if(all){all.checked=hasRows&&ids.length===latestVisibleResearchRows().length;all.indeterminate=ids.length>0&&ids.length<latestVisibleResearchRows().length;all.disabled=hardBusy||!hasRows||!latestProductRowsComplete;all.title=latestProductRowsComplete?'현재 로드된 최신 상품 목록의 모든 페이지에 적용합니다.':'목록 로딩이 일부 완료되지 않았습니다. 목록을 다시 불러온 뒤 전체 선택하세요.';}
    if(count)count.textContent='선택 '+ids.length+' / 이관 전 '+latestVisibleResearchRows().length+'건(모든 페이지)'+(latestProductRowsComplete?'':' · 목록 로딩 미완료');var reviewedLatest=latestProductRows.filter(function(row){return verifiedReviewUi.latest[latestProductKey(row)]==='verified';}).length;if($('latestVerifiedReviewCount'))$('latestVerifiedReviewCount').textContent='정상 검증 '+reviewedLatest+'건 · 별도 복귀 가능';
    if($('latestSelectedQueueStageBtn'))$('latestSelectedQueueStageBtn').disabled=hardBusy||!ids.length;
    if($('latestAllQueueStageBtn'))$('latestAllQueueStageBtn').disabled=allStageBusy||!hasRows||!latestProductRowsComplete;
    if($('latestSelectedAiBtn'))$('latestSelectedAiBtn').disabled=hardBusy||!ids.length;
    if($('latestAllAiBtn'))$('latestAllAiBtn').disabled=allStageBusy||!hasRows||!latestProductRowsComplete;if($('latestSelectedVerifiedPsomBtn'))$('latestSelectedVerifiedPsomBtn').disabled=hardBusy||!ids.length;if($('latestAllVerifiedPsomBtn'))$('latestAllVerifiedPsomBtn').disabled=allStageBusy||!hasRows||!latestProductRowsComplete;
    if($('latestSelectedQueueUnmatchBtn'))$('latestSelectedQueueUnmatchBtn').disabled=hardBusy||!ids.length;
    if($('latestSelectedQueueDeleteBtn'))$('latestSelectedQueueDeleteBtn').disabled=hardBusy||!ids.length;if($('latestSelectedPermanentExcludeBtn'))$('latestSelectedPermanentExcludeBtn').disabled=hardBusy||!ids.length;
    Array.prototype.forEach.call(document.querySelectorAll('[data-latest-queue-select]'),function(box){box.checked=latestSelectedProducts[box.value]===true;box.disabled=hardBusy;});
  }
  async function currentResearchJobIdForWrite(countryCode,subdivisionCode){
    // The visible research grid may outlive its compact report when an AI
    // research cycle rotates. Never reuse a cached prior job ID in a write.
    var snapshot=await loadProductResearchCompact(countryCode,subdivisionCode);
    var id=text(snapshot&&snapshot.jobId);
    if(!id||snapshot&&snapshot.status==='not_started')throw new Error('현재 국가·지역의 공식 리서치 작업 ID를 재조회하지 못했습니다. 리서치 원장을 새로고침하세요.');
    return id;
  }

  async function runLatestProductQueueAction(operation,scopeMode,options){
    options=options||{};
    if(!selectedCountry||latestQueueActionActive)return;
    var unmatch=operation==='unmatch',deleting=operation==='delete',purging=operation==='purge',selectedIds=Array.isArray(options.idsOverride)?options.idsOverride.map(text).filter(Boolean):latestSelectedIds(),visibleKeys=new Set(latestVisibleResearchRows().map(latestProductKey).filter(Boolean)),selectedRows=latestRowsForIds(selectedIds).filter(function(row){return visibleKeys.has(latestProductKey(row));}),allMode=scopeMode==='all',ids=allMode?latestVisibleResearchRows().map(latestProductKey).filter(Boolean):selectedRows.map(latestProductKey);
    ids=Array.from(new Set(ids));
    if(!allMode&&!ids.length){show('먼저 최신 상품을 선택해 주세요.','warn');return;}
    if(allMode&&!latestProductRowsComplete){show('최신 상품 목록을 모두 불러오지 못했습니다. 전체 일괄 처리 전에 최신 목록을 다시 로드해 주세요.','warn');return;}
    if(allMode&&!latestProductRows.length&&Number(lastProductJson&&lastProductJson.summary&&lastProductJson.summary.latestResearchProducts||0)<=0){show('현재 리서치 사이클의 최신 상품이 없습니다.','warn');return;}
    if((unmatch||deleting||purging)&&allMode){show((purging?'영구 제외':deleting?'목록 삭제':'후보 등록 해제')+'는 보호를 위해 선택 상품에만 사용할 수 있습니다.','warn');return;}
    if(unmatch&&options.skipConfirm!==true&&!window.confirm('선택 상품 '+ids.length+'건의 비공개 후보 등록만 해제합니다. 최신 리서치 목록과 리서치 진행상태는 그대로 유지합니다. 계속할까요?'))return;
    if(deleting&&options.skipConfirm!==true&&!window.confirm('선택 상품 '+ids.length+'건을 현재 최신 상품 리서치 목록에서 삭제합니다. 영구 제외가 아니므로 다음 상품 리서치에서 다시 발견될 수 있습니다. 계속할까요?'))return;if(purging&&options.skipConfirm!==true&&!window.confirm('선택 상품 '+ids.length+'건을 영구 제외합니다. 동일 상품은 다음 공식 상품 리서치에서도 자동 재등록되지 않도록 차단 기록을 남깁니다. 계속할까요?'))return;
    latestQueueActionActive=true;syncLatestProductQueueControls();var totalHandled=0,totalFailed=0,totalBlocked=0,totalEligible=0,totalRoutedHold=0,totalRoutedReject=0,totalProtected=0,blockedReasonSamples=[],deletedUiKeys={},transferredUiKeys={},candidateUiKeys={},holdUiKeys={},rejectUiKeys={},protectedUiKeys={},state=$('productQueueStageState'),manualState=$('latestManualActionState'),requestedScope=scopeSnapshot(),requestedKey=scopeKey(requestedScope);
    try{
      var liveJobId=await currentResearchJobIdForWrite(requestedScope.country,requestedScope.region);
      if(unmatch||deleting||purging){
        for(var off=0;off<selectedRows.length;off+=LATEST_MANUAL_ACTION_BATCH){
          if(scopeKey()!==requestedKey)throw new Error('대기열 작업 중 선택 범위가 변경됐습니다.');
          var rowsChunk=selectedRows.slice(off,off+LATEST_MANUAL_ACTION_BATCH),chunkIds=rowsChunk.map(latestProductKey).filter(Boolean),chunkRefs=latestRefsForRows(rowsChunk),progressText=(purging?'최신 상품 영구 제외 ':deleting?'최신 상품 목록 삭제 ':'최신 상품 후보 등록 해제 ')+Math.min(off+rowsChunk.length,selectedRows.length)+'/'+selectedRows.length+'건';
          if(state)state.textContent=progressText;if(manualState)manualState.textContent=progressText+' · 10건 단위 안전 처리';
          var result=await api(CONTROL,'product_research_stage_current','POST',{}, {countryCode:requestedScope.country,subdivisionCode:requestedScope.region,jobId:liveJobId,source:'latest_list_manual',operation:purging?'purge':(deleting?'delete':'unmatch'),productIds:chunkIds,productRefs:chunkRefs},20000),part=result&&result.partialQueue||{};
          totalHandled+=Number(part.handled||0);totalFailed+=Number(part.failed||0);totalBlocked+=Number(part.blocked||0);totalEligible+=Number(part.eligible||0);totalRoutedHold+=Number(part.routedHold||0);totalRoutedReject+=Number(part.routedReject||0);totalProtected+=Number(part.protectedPreserved||0);
          if((deleting||purging)&&result&&result.ok!==false){var confirmedKeys=Array.isArray(part.deletedKeys)?part.deletedKeys.map(text).filter(Boolean):[];if(confirmedKeys.length){var confirmedMap={};confirmedKeys.forEach(function(key){confirmedMap[key]=true;});rowsChunk.forEach(function(row){var key=latestProductKey(row);if(key&&confirmedMap[key])deletedUiKeys[key]=true;});}else if(Number(part.deleted||0)>=rowsChunk.length){chunkIds.forEach(function(id){deletedUiKeys[id]=true;});}}
          await new Promise(function(resolve){setTimeout(resolve,120);});
        }
      }else{
        /* Latest-list registration must use the exact rows visible to the
           administrator.  The old whole-list path relied on a durable scan
           cursor; once that cursor reached the end, newly eligible rows could
           remain visible while every later click reported handled=0.  Treat
           both selected and whole-list registration as explicit safe windows.
           Selected rows are re-inspected in four-row batches before candidate registration. */
        var stageRows=allMode?latestVisibleResearchRows().slice():selectedRows.slice(),stageLabel=allMode?'최신 상품 이관 대상 전체':'선택 상품',stagedCandidateIds={};
        for(var start=0;start<stageRows.length;start+=1){
          /* Keep explicit registration at one research product per request.
             A request may inspect a live external product page; one product
             limits the amount of work per server invocation. */
          var selectedChunkRows=stageRows.slice(start,start+1),selectedChunkIds=selectedChunkRows.map(latestProductKey).filter(Boolean),selectedChunkRefs=latestRefsForRows(selectedChunkRows),selectedPass=0,selectedStalled=0,selectedRemaining=null,selectedFinalPart={};
          while(selectedPass<24){
            if(scopeKey()!==requestedKey)throw new Error('대기열 작업 중 선택 범위가 변경됐습니다.');
            if(state)state.textContent=stageLabel+' 후보 관리목록 등록 · '+Math.min(start+selectedChunkRows.length,stageRows.length)+'/'+stageRows.length+'건 · 1건 단위 재검증·저장';
            var selectedResult=await api(CONTROL,'product_research_stage_current','POST',{}, {countryCode:requestedScope.country,subdivisionCode:requestedScope.region,jobId:liveJobId,source:'latest_list_manual',operation:'stage',productIds:selectedChunkIds,productRefs:selectedChunkRefs,reinspectSelected:true},30000),selectedPart=selectedResult&&selectedResult.partialQueue||{};
            if(selectedPart.migration===true){if(state)state.textContent='기존 대용량 상품 원장을 국가·지역 분할 원장으로 안전 전환 중 · '+Number(selectedPart.migrated||0)+'/'+Number(selectedPart.migrationTotal||0)+'건';selectedPass+=1;await new Promise(function(resolve){setTimeout(resolve,180);});continue;}
            selectedFinalPart=selectedPart;markLatestTransferredRows(selectedChunkRows,selectedPart.transferredKeys,transferredUiKeys);markLatestTransferredRows(selectedChunkRows,selectedPart.candidateTransferredKeys,candidateUiKeys);markLatestTransferredRows(selectedChunkRows,selectedPart.holdTransferredKeys,holdUiKeys);markLatestTransferredRows(selectedChunkRows,selectedPart.rejectTransferredKeys,rejectUiKeys);markLatestTransferredRows(selectedChunkRows,selectedPart.protectedTransferredKeys,protectedUiKeys);(Array.isArray(selectedPart.blockedReasons)?selectedPart.blockedReasons:[]).forEach(function(reason){var labels=[];if(reason&&reason.inspectionComplete!==true)labels.push('상세페이지 재검증 미완료');(Array.isArray(reason&&reason.blockers)?reason.blockers:[]).concat(Array.isArray(reason&&reason.reviewGaps)?reason.reviewGaps:[]).map(text).filter(Boolean).slice(0,2).forEach(function(code){labels.push(code);});var label=labels.join('/');if(label&&blockedReasonSamples.indexOf(label)<0&&blockedReasonSamples.length<3)blockedReasonSamples.push(label);});(Array.isArray(selectedPart.candidateIds)?selectedPart.candidateIds:[]).forEach(function(id){id=text(id);if(id)stagedCandidateIds[id]=true;});
            var selectedRemain=Number(selectedPart.remaining||0);if(selectedPart.complete===true||selectedRemain<=0)break;
            if(selectedRemaining!=null&&selectedRemain>=selectedRemaining&&Number(selectedPart.handled||0)<=0)selectedStalled+=1;else selectedStalled=0;
            if(selectedStalled>=3)throw new Error(stageLabel+' 후보 관리목록 등록이 반복 정체되어 저장 상태를 유지한 채 중단했습니다.');
            selectedRemaining=selectedRemain;selectedPass+=1;await new Promise(function(resolve){setTimeout(resolve,160);});
          }
          if(selectedPass>=24)throw new Error(stageLabel+' 대기열 안전 반복 한도에 도달했습니다.');
          totalFailed+=Number(selectedFinalPart.failed||0);totalBlocked+=Number(selectedFinalPart.blocked||0);totalEligible+=Number(selectedFinalPart.eligible||0);
        }
        totalHandled=Object.keys(candidateUiKeys).length;totalRoutedHold=Object.keys(holdUiKeys).length;totalRoutedReject=Object.keys(rejectUiKeys).length;totalProtected=Object.keys(protectedUiKeys).length;
      }
      var isStageTransfer=!unmatch&&!deleting&&!purging,latestUiRemoval=(deleting||purging)?deletedUiKeys:{},ledgerRefreshOk=true,ledgerRefreshError=null;
      /* A successful server write must become visible in the destination ledger
         before the source inbox is removed from the operator's screen. The old
         order hid hundreds of latest rows first and then silently swallowed a
         candidate-ledger timeout, which looked exactly like data loss. */
      var deferLedgerReadback=isStageTransfer&&options.deferLedgerReadback===true;
      if(isStageTransfer&&!deferLedgerReadback){
        try{
          var registeredLedger=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});
          if(!registeredLedger||!registeredLedger.pipeline||registeredLedger.pipeline.ledgerLoadComplete!==true||registeredLedger.pipeline.source!=='direct_management_ledger')throw new Error('현재 전체 후보 원장을 끝까지 읽지 못했습니다.');
          var confirmedIds=new Set(productRows.map(frontCandidateLedgerId).filter(Boolean));
          var missingTransferred=Object.keys(stagedCandidateIds||{}).filter(function(id){return !confirmedIds.has(id);});
          if(missingTransferred.length)throw new Error('이관 후보 '+missingTransferred.length+'건의 DB 읽기 재확인이 실패했습니다. 소스 목록을 숨기지 않습니다.');
        }catch(_ledgerError){ledgerRefreshOk=false;ledgerRefreshError=_ledgerError;}
      }
      if(isStageTransfer&&ledgerRefreshOk&&!deferLedgerReadback)latestUiRemoval=transferredUiKeys;
      if(Object.keys(latestUiRemoval).length){latestProductRows=latestProductRows.filter(function(row){return latestUiRemoval[latestProductKey(row)]!==true;});Object.keys(latestUiRemoval).forEach(function(id){delete latestSelectedProducts[id];});latestProductPage=clampPage(latestProductPage,latestProductRows.length,MANAGEMENT_PAGE_SIZE);renderLatestProductRows();}
      if(!deferLedgerReadback)try{var saved=await loadProductResearchCompact(requestedScope.country,requestedScope.region);if(saved&&saved.status&&saved.status!=='not_started'){lastProductJson=mergeCompactProductStatus(saved);renderProductProgress(lastProductJson);rememberReport('product',lastProductJson);saveReviewSnapshot();}}catch(_statusError){}
      if(!deferLedgerReadback&&(!isStageTransfer||ledgerRefreshOk)){try{await refreshLatestResearchRows(requestedScope.country,requestedScope.region,{state:state,label:'최신 상품 리서치 목록'});}catch(_latestRefreshError){}}
      if(!isStageTransfer){try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(_ledgerError2){}}
      if(isStageTransfer&&!ledgerRefreshOk&&!deferLedgerReadback){var ledgerDelay='후보 원장 저장은 서버에서 처리됐지만 전체 상품 후보·배치 관리 목록 새로고침이 지연되었습니다. 최신 상품 목록은 이 화면에서 제거하지 않았습니다. 범위 새로고침으로 다시 확인해 주세요.';if(state)state.textContent=ledgerDelay;if(manualState)manualState.textContent=ledgerDelay;show(ledgerDelay+(ledgerRefreshError&&ledgerRefreshError.message?' · '+conciseRequestError(ledgerRefreshError.message,ledgerRefreshError.status):''),'warn');}
      lastScopeAuditJson=null;if(!deferLedgerReadback&&activeScopeAudit==='queue'){try{var queueAudit=await api(REVIEW,'diagnostic','GET',scopeParams());queueAudit.scope=auditScopeOf(queueAudit);renderScopeAudit(queueAudit,'queue');}catch(_queueAuditRefreshError){}}
      if(unmatch||deleting||purging)selectedIds.forEach(function(id){delete latestSelectedProducts[id];});syncLatestProductQueueControls();
      var routedTotal=totalRoutedHold+totalRoutedReject,finalText=(purging?'최신 상품 영구 제외':(deleting?'최신 상품 목록 삭제':(unmatch?'최신 상품 후보 등록 해제':'최신 상품 후보 관리목록 등록')))+' 완료 · '+(allMode?'현재 최신 목록 전체 '+ids.length+'건':'선택 '+ids.length+'건')+' · 후보 관리목록 '+totalHandled+'건'+(totalRoutedHold?' · 보류 이관 '+totalRoutedHold+'건':'')+(totalRoutedReject?' · 제외 이관 '+totalRoutedReject+'건':'')+(totalProtected?' · 기존 판정 보존 '+totalProtected+'건':'')+(totalBlocked?' · 미처리 '+totalBlocked+'건':'')+(totalFailed?' · 실패 '+totalFailed+'건':'');if(blockedReasonSamples.length)finalText+=' · 검증 사유 '+blockedReasonSamples.join(', ');if(!deferLedgerReadback&&(!isStageTransfer||ledgerRefreshOk)){if(state)state.textContent=finalText;if(manualState)manualState.textContent=finalText;}
      var finalMessage=purging?'선택 상품을 영구 제외했습니다. 같은 상품은 이후 자동 리서치에서 다시 후보로 승격하지 않습니다.':deleting?'선택 상품을 현재 최신 리서치 목록에서 삭제했습니다.':unmatch?'선택 상품의 후보 등록을 해제했습니다.':(totalHandled||routedTotal||totalProtected)?('최신 상품 처리 완료 · 전체 상품 후보·배치 관리 목록 '+totalHandled+'건'+(totalRoutedHold?' · 보류 목록 '+totalRoutedHold+'건':'')+(totalRoutedReject?' · 제외 목록 '+totalRoutedReject+'건':'')+(totalProtected?' · 기존 관리자 판정 보존 '+totalProtected+'건':'')):totalBlocked?'선택 상품 '+totalBlocked+'건은 재검증 후에도 자동 분류하지 못했습니다.':'선택 상품 후보 등록 결과 반영된 항목이 없습니다.';if(totalBlocked&&deleting)finalMessage+=' · 후속 배치·공개·관리자 고정 '+totalBlocked+'건은 그대로 보존했습니다.';if(blockedReasonSamples.length)finalMessage+=' · 검증 사유: '+blockedReasonSamples.join(', ');if(!deferLedgerReadback&&(!isStageTransfer||ledgerRefreshOk))show(finalMessage,(totalFailed||totalBlocked)?'warn':'ok');return{ok:totalFailed===0&&(!isStageTransfer||ledgerRefreshOk),handled:totalHandled,failed:totalFailed,blocked:totalBlocked,eligible:totalEligible,routedHold:totalRoutedHold,routedReject:totalRoutedReject,protectedPreserved:totalProtected,candidateIds:typeof stagedCandidateIds==='object'?Object.keys(stagedCandidateIds):[],ledgerVisible:!deferLedgerReadback&&(!isStageTransfer||ledgerRefreshOk)};
    }catch(e){var failText='최신 상품 수동 작업 중단: '+conciseRequestError(e&&e.message,e&&e.status);if(state)state.textContent=failText;if(manualState)manualState.textContent=failText;show(conciseRequestError(e&&e.message,e&&e.status),'warn');return{ok:false,error:e};}
    finally{latestQueueActionActive=false;if(!options.deferLedgerReadback)renderLatestProductRows();syncLatestProductQueueControls();if(typeof window.requestAnimationFrame==='function')window.requestAnimationFrame(function(){syncLatestProductQueueControls();});else setTimeout(syncLatestProductQueueControls,0);}
  }
  function productUrlMatchKey(value){var url=safeExternalUrl(value);if(!url)return'';try{var u=new URL(url);u.hash='';u.hostname=u.hostname.toLowerCase();if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');return u.toString();}catch(_e){return url.replace(/#.*$/,'').replace(/\/+$/,'');}}
  function candidateIdsForLatestRows(rows){var wanted={};(rows||[]).forEach(function(row){var key=productUrlMatchKey(row&&row.productUrl||row&&row.url);if(key)wanted[key]=true;});return Array.from(new Set(productRows.filter(function(row){return row&&row.ledgerSource==='candidate'&&productDecision(row)==='undecided'&&wanted[productUrlMatchKey(row.productUrl||row.url)]===true;}).map(function(row){return text(row.candidateId||row.id);}).filter(Boolean)));}
  async function runLatestAi(scopeMode){
    if(!selectedCountry||latestQueueActionActive||productAutomationActive||productVerifiedFlowBusy)return;
    // Explicit operator PSOM placement uses the exact same verified A/B -> C
    // registration and allows pre-existing verified UNASSIGNED candidates.
    // It never calls the legacy stage path or AI full automation.
    return runTwoStepProductReview('latest','restore',scopeMode,{forcePsom:true});
  }
  async function runLatestSelectedAi(){return runLatestAi('selected');}
  async function runLatestAllAi(){return runLatestAi('all');}

  function renderLatestProductRows(){
    var root=$('latestProductGrid');if(!root||root.hidden){renderLatestResearchCandidateGroup();if($('latestProductSummary'))$('latestProductSummary').textContent='리서치 '+latestProductRows.length+'건 · 후보 관리 목록 하단에서 확인';return;}ensureLatestProductQueueControls();renderLatestResearchOverview();renderLatestResearchCandidateGroup();
    var history=Array.isArray(latestProductRows)?latestProductRows:[],rows=latestVisibleResearchRows(),valid={};rows.forEach(function(row){var id=latestProductKey(row);if(id)valid[id]=true;});
    // Research history remains immutable. Display its registration state using
    // the CURRENT private candidate ledger; do not remove the research record.
    var ledgerByUrl={};productRows.forEach(function(row){if(row&&row.ledgerSource==='candidate'){
      var key=productUrlMatchKey(row.productUrl||row.url);if(key)ledgerByUrl[key]=row;
    }});
    var linked=0,unassigned=0,placed=0,preserved=0;
    rows.forEach(function(row){var key=productUrlMatchKey(row.productUrl||row.url),found=ledgerByUrl[key];if(!found)return;linked++;
      if(productDecision(found)==='undecided'&&candidateGroupKey(found)==='unassigned')unassigned++;
      else if(productDecision(found)==='slot_candidate')placed++;
      else preserved++;
    });
    if($('latestLedgerLinkSummary'))$('latestLedgerLinkSummary').textContent='현재 후보 원장 조회 기준 · 등록 확인 '+linked+'건 · 미배치 '+unassigned+'건 · 섹션 배치 '+placed+'건 · 기타/보류 '+preserved+'건 · 이관 전 확인 대상 '+rows.length+'건 · 전체 연구 기록 '+history.length+'건은 별도 보존됩니다.';Object.keys(latestSelectedProducts).forEach(function(id){if(!valid[id])delete latestSelectedProducts[id];});
    if($('latestProductSummary'))$('latestProductSummary').textContent='전체 '+history.length+'건 · 미등록 '+rows.length+'건 · 위치·삭제 관리 가능';
    if(!rows.length){root.innerHTML='<div class="small">현재 미이관 최신 상품이 없습니다. 이관된 상품은 미배치 후보 또는 확정 섹션에서 확인할 수 있으며 원본 조사 기록은 보존됩니다.</div>';syncLatestProductQueueControls();return;}
    latestProductPage=clampPage(latestProductPage,rows.length,MANAGEMENT_PAGE_SIZE);var startIndex=latestProductPage*MANAGEMENT_PAGE_SIZE,pageRows=rows.slice(startIndex,startIndex+MANAGEMENT_PAGE_SIZE);root.innerHTML=pageRows.map(function(row,index){return productCardHtml(row,startIndex+index,'latest','latest');}).join('')+pagerMarkup('latest','',latestProductPage,rows.length,MANAGEMENT_PAGE_SIZE);wireProductImages(root);syncLatestProductQueueControls();
  }


  function captureOpenProductGroup(){var panel=document.querySelector('details[data-product-group][open]');return panel?{key:text(panel.getAttribute('data-product-group')),kind:text(panel.getAttribute('data-product-group-kind')),scrollY:window.scrollY}:null;}
  function restoreOpenProductGroup(state){if(!state||!state.key)return;var panels=Array.prototype.slice.call(document.querySelectorAll('details[data-product-group]')),panel=panels.filter(function(item){return text(item.getAttribute('data-product-group'))===state.key&&text(item.getAttribute('data-product-group-kind'))===state.kind;})[0];if(!panel)return;panel.open=true;setTimeout(function(){try{window.scrollTo(0,Number(state.scrollY||0));}catch(_e){}},0);}
  var deferredFocusedProductRender=null;
  document.addEventListener('focusout',function(event){
    if(!event.target||!event.target.matches||!event.target.matches('[data-product-management-select]'))return;
    setTimeout(function(){
      if(!deferredFocusedProductRender||document.activeElement&&document.activeElement.matches&&document.activeElement.matches('[data-product-management-select]'))return;
      var next=deferredFocusedProductRender;deferredFocusedProductRender=null;
      if(next.scope===scopeKey())renderProducts(next.rows);
    },40);
  },true);
  function renderProducts(rows){
    var focused=document.activeElement;
    if(focused&&focused.matches&&focused.matches('[data-product-management-select]')){
      deferredFocusedProductRender={scope:scopeKey(),rows:Array.isArray(rows)?rows.slice():[]};
      return;
    }
    var openGroup=captureOpenProductGroup(),nextRows=Array.isArray(rows)?rows:[],validProductIds={};nextRows.forEach(function(row){if(row&&row.id&&assignedSectionKey(row))validProductIds[text(row.id)]=true;});Object.keys(frontSelectedProducts).forEach(function(id){if(!validProductIds[id])delete frontSelectedProducts[id];});Object.keys(frontSelectedSections).forEach(function(key){if(!PRODUCT_SECTION_MAP[key])delete frontSelectedSections[key];});
    productRows=Array.isArray(rows)?rows:[];var controlsReady=!!lastProductJson&&productRows.length>0&&!productLoopActive;setButtonEnabled('productAiAutoBtn',controlsReady&&!productAutomationActive&&!productFrontSyncActive);var undecided=productRows.filter(function(row){return productDecision(row)==='undecided';}).length,slotRows=productRows.filter(function(row){return productDecision(row)==='slot_candidate';}),assigned=slotRows.filter(function(row){return!!assignedSectionKey(row);}).length,repair=slotRows.length-assigned,held=productRows.filter(function(row){return productDecision(row)==='hold';}).length,rejected=productRows.filter(function(row){var d=productDecision(row);return d==='reject'||d==='purge';}).length,candidateTotal=undecided+slotRows.length;if($('productCandidateSummary'))$('productCandidateSummary').textContent=candidateTotal+'건';if($('productSectionSummary'))$('productSectionSummary').textContent='실제 배치 예정 '+assigned+'건 / 최대 1,800건';if($('productDecisionStats'))$('productDecisionStats').innerHTML=[['미결정 후보',undecided],['실제 섹션 배치 예정',assigned],['배정정보 복구 필요',repair],['대표 이미지 검토 필요',slotRows.filter(function(row){return !!verifiedProductImageReviewIssue(row);}).length],['보류',held],['제외·영구 제외',rejected]].map(function(item){return'<div class="product-decision-stat"><span class="small">'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>';}).join('');syncExcludedLedgerCounts();renderProductSectionBoard();if($('productCandidatePanel')&&$('productCandidatePanel').open)renderProductCandidateGroups();else if($('productGrid'))$('productGrid').innerHTML='';if($('excludedLedgerPanel')&&$('excludedLedgerPanel').open)renderExcludedLedger();if($('latestProductPanel')&&$('latestProductPanel').open)renderLatestResearchOverview();syncManagementToggleLabels();syncFrontSelectionControls();syncProductAiFinalizeControl();restoreOpenProductGroup(openGroup);
  }

  function transitionAuditMetric(label,value,note,kind){return'<div class="product-transition-audit-item"><span class="small">'+esc(label)+'</span><strong>'+esc(value)+'</strong><span class="small">'+esc(note||'')+'</span>'+(kind?'<span class="pill '+esc(kind)+'">'+esc(kind==='good'?'정상':'확인')+'</span>':'')+'</div>';}
  // Read-only comparison. This Edge snapshot is chosen by visitor IP, not by
  // the administrator's selector. Only compare it when its verified metadata
  // explicitly matches the selected market. Never treat failed reads as zero.
  function snapshotScopeMatches(sectionKey,country,region){
    var meta=frontSnapshotMeta[sectionKey]||{},target=text(meta.targetMarket||meta.targetCountry).toUpperCase(),targetRegion=text(meta.targetRegion||'NATIONWIDE').toUpperCase();
    return ((meta.ipSlotSnapshot===true&&meta.geoMatched===true)||meta.regionalBrokerageSnapshot===true)&&target===country.toUpperCase()&&(targetRegion===region.toUpperCase()||(targetRegion==='NATIONWIDE'&&region.toUpperCase()!=='NATIONWIDE'));
  }
  function frontLedgerSectionAudit(section,products,requested){
    var key=section.key,raw=Array.isArray(frontSnapshotItems[key])?frontSnapshotItems[key]:[],front=raw.filter(function(item){return !frontItemPlaceholder(item);}),meta=frontSnapshotMeta[key]||{},scopeVerified=snapshotScopeMatches(key,requested.country,requested.region);
    var result={sectionKey:key,frontSnapshotScopeVerified:scopeVerified,source:frontSnapshotSource[key]||'',targetCountry:text(meta.targetMarket||meta.targetCountry),targetRegion:text(meta.targetRegion),canonicalReleaseId:text(meta.canonicalReleaseId),publicCards:front.length,matched:0,orphanPublicCards:[],missingPublicCandidateId:[],candidateIdUrlConflicts:[],imageConflicts:[],suspectImages:[],placementConflicts:[],duplicatePublicCandidateIds:[],unmatchedPublicationRequests:[]};
    if(!scopeVerified){result.reason='snapshot_not_verified_for_selected_country_region';return result;}
    var candidates=products.filter(function(row){return productDecision(row)==='slot_candidate'&&!row.assignmentRepairRequired&&assignedSectionKey(row)===key;}),byId={},byUrl={};
    candidates.forEach(function(row){var id=frontCandidateLedgerId(row),url=normalizeAuditUrl(row.productUrl||row.url);if(id)byId[id]=row;if(url)(byUrl[url]||(byUrl[url]=[])).push(row);});
    var matched=new Set(),publishedIds=new Set(),publishedSlots=new Set();
    front.forEach(function(item){
      var ids=frontItemIds(item),url=normalizeAuditUrl(normalizedFrontUrl(item)),owner=null;
      for(var i=0;i<ids.length;i++){if(byId[ids[i]]){owner=byId[ids[i]];break;}}
      var rawImage=frontItemImage(item),image=normalizeAuditImage(rawImage),imageIssue=productImageIssue(rawImage);
      if(imageIssue)result.suspectImages.push({candidateIds:ids,title:text(item.title||item.name),imageUrl:rawImage,issue:imageIssue,source:'front'});
      var placement=item.placement||{},expectedPage=key.split('|')[0],expectedSection=key.split('|').slice(1).join('|'),slot=frontItemSlot(item),positionKey=expectedSection+'|'+slot;
      if(placement.page&&placement.page!==expectedPage||placement.section&&placement.section!==expectedSection||placement.country&&text(placement.country).toUpperCase()!==text(requested.country).toUpperCase()||placement.region&&text(placement.region).toUpperCase()!==text(requested.region).toUpperCase())result.placementConflicts.push({candidateIds:ids,frontPlacement:placement,expectedSection:key,reason:'scoped_placement_mismatch'});
      if(slot){if(publishedSlots.has(positionKey))result.placementConflicts.push({candidateIds:ids,slot:slot,reason:'duplicate_public_slot'});publishedSlots.add(positionKey);}
      if(owner){
        var id=frontCandidateLedgerId(owner);matched.add(id);result.matched++;
        if(publishedIds.has(id))result.duplicatePublicCandidateIds.push({candidateId:id,slot:slot});publishedIds.add(id);
        var adminPlace=owner.approvedPlacement||owner.primaryPlacement||owner.placement||{},adminAssignment=owner.lifecycle&&owner.lifecycle.assignment||{},adminSlot=text(adminPlace.slot||adminAssignment.slot||'');
        if(adminSlot&&slot&&adminSlot!==slot)result.placementConflicts.push({candidateIds:[id],expectedSlot:adminSlot,frontSlot:slot,reason:'administrator_front_slot_mismatch'});
        var expected=normalizeAuditUrl(owner.productUrl||owner.url);if(expected&&url&&expected!==url)result.candidateIdUrlConflicts.push({candidateId:id,frontUrl:url,adminUrl:expected});
        var adminImageRaw=text(owner.imageUrl||owner.imageOriginalUrl),adminImage=normalizeAuditImage(adminImageRaw),adminIssue=productImageIssue(adminImageRaw);
        if(adminIssue)result.suspectImages.push({candidateIds:[id],title:text(owner.productName||owner.title),imageUrl:adminImageRaw,issue:adminIssue,source:'administrator'});
        if(adminImage&&image&&adminImage!==image)result.imageConflicts.push({candidateId:id,frontImage:image,adminImage:adminImage});
        return;
      }
      if(url&&byUrl[url]&&byUrl[url].length){result.missingPublicCandidateId.push({frontIds:ids,url:url,matchingAdministratorIds:byUrl[url].map(frontCandidateLedgerId)});return;}
      result.orphanPublicCards.push({frontIds:ids,url:url,title:text(item.title||item.name),imageUrl:rawImage,slot:slot});
    });
    // Publish requests may be deferred for board capacity, review, or pending deploy:
    // do not equate every request with a guaranteed live slot.
    result.unmatchedPublicationRequests=candidates.filter(function(row){return row.frontPublication&&['published','matched','active'].indexOf(text(row.frontPublication.status).toLowerCase())>=0&&!matched.has(frontCandidateLedgerId(row));}).map(function(row){return{candidateId:frontCandidateLedgerId(row),title:text(row.productName||row.title)};});
    return result;
  }
  function normalizeAuditUrl(value){try{var u=new URL(text(value));if(u.protocol!=='https:'&&u.protocol!=='http:')return'';u.hash='';u.pathname=u.pathname.replace(/\/+$/,'')||'/';return u.toString();}catch(_e){return'';}}
  async function downloadCandidateLedgerAudit(){
    if(!selectedCountry){show('점검할 국가·지역을 먼저 선택해 주세요.','warn');return;}
    var button=$('productCandidateLedgerAuditDownloadBtn'),requested=scopeSnapshot('candidate-ledger-export'),frozenScope=scopeKey(requested);
    if(button)button.disabled=true;
    try{
      var ledger=await refreshCandidateLedgerProducts({preserveResearchReport:true});
      if(scopeKey()!==frozenScope)throw new Error('조회 도중 국가·지역이 변경되어 점검 파일 생성을 중단했습니다.');
      if(!(ledger&&ledger.pipeline&&ledger.pipeline.ledgerLoadComplete===true))throw new Error('원장 전체 페이지 조회가 완료되지 않았습니다. 불완전한 JSON 저장을 차단했습니다.');
      var rows=Array.isArray(ledger.candidateRows)?ledger.candidateRows:[],products=Array.isArray(ledger.products)?ledger.products:[];
      await refreshFrontSnapshotCounts({skipRender:true,frozenScope:frozenScope});
      if(scopeKey()!==frozenScope)throw new Error('프론트 공개 데이터 검증 중 선택 범위가 변경됐습니다.');
      var statusCount={};products.forEach(function(row){var key=productDecision(row)||'unresolved';statusCount[key]=(statusCount[key]||0)+1;});
      var report={ok:true,reportType:'igdc-candidate-placement-ledger-audit',generatedAt:new Date().toISOString(),scope:requested,source:ledger.pipeline.source,loadedPages:ledger.pipeline.loadedPages,loadedRows:rows.length,complete:true,summary:{productCount:products.length,statusCounts:statusCount,imageMissing:products.filter(function(row){return !safeExternalImageUrl(row.imageUrl||row.imageOriginalUrl);}).length,imageSuspect:products.filter(function(row){return !!productImageIssue(row.imageUrl||row.imageOriginalUrl);}).length,imageReviewPending:products.filter(function(row){return !!verifiedProductImageReviewIssue(row);}).length,titleSuspect:products.filter(function(row){return /^(?:keep\s*shopping|re[- ]?order|shop\s*now|add\s*to\s*cart|product\s*information)$/i.test(text(row.productName||row.title));}).length,assigned:products.filter(function(row){return productDecision(row)==='slot_candidate';}).length,frontRequested:products.filter(function(row){return row.frontPublication&&row.frontPublication.status==='publish_requested';}).length,assignmentRepairRequired:products.filter(function(row){return row.assignmentRepairRequired===true;}).length,sourceScopeConflicts:products.filter(function(row){return row.ledgerScopeConflict===true;}).length},relationConsistency:{schema:'igdc-management-ledger-assignment-audit.v1',readonly:true,bySection:PRODUCT_SECTIONS.map(function(section){var assigned=products.filter(function(row){return productDecision(row)==='slot_candidate'&&productPlacementKey(row)===section.key;});return{sectionKey:section.key,selected:assigned.length,activeAssigned:assigned.filter(function(row){return !row.assignmentRepairRequired;}).length,needsRepair:assigned.filter(function(row){return row.assignmentRepairRequired===true;}).map(function(row){return{candidateId:frontCandidateLedgerId(row),title:text(row.productName||row.title),issues:row.ledgerConsistency&&row.ledgerConsistency.issues||[]};})};})},frontSnapshotConsistency:{schema:'igdc-product-front-ledger-comparison.v1',readonly:true,note:'IP에 의해 선택된 공개 Snapshot을 읽기 전용으로 비교합니다. IP/선택국가 불일치 또는 Snapshot 접근 실패 시 비교하지 않습니다.',sections:PRODUCT_SECTIONS.map(function(section){return frontLedgerSectionAudit(section,products,requested);})},candidates:rows,products:products};
      var stamp=new Date().toISOString().replace(/[:.]/g,'-'),name='IGDC_PRODUCT_CANDIDATE_LEDGER_AUDIT_'+requested.country+'_'+requested.region+'_'+stamp+'.json',blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json;charset=utf-8'}),href=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=href;anchor.download=name;document.body.appendChild(anchor);anchor.click();setTimeout(function(){try{anchor.remove();URL.revokeObjectURL(href);}catch(_e){}},1500);
      show('현재 상품 후보·배치 원장 '+rows.length+'건을 읽기 전용 JSON으로 저장했습니다.','ok');
    }catch(error){show('후보·배치 원장 점검 JSON 다운로드 중단: '+text(error&&error.message),'warn');}
    finally{if(button)button.disabled=false;}
  }
  function downloadProductTransitionAudit(){if(!lastProductTransitionAuditJson){show('먼저 대기열·배치 전환 검증을 실행해 주세요.','warn');return;}try{var stamp=new Date().toISOString().replace(/[:.]/g,'-'),scope=lastProductTransitionAuditJson.scope||scopeSnapshot(),name='IGDC_PRODUCT_TRANSITION_AUDIT_'+text(scope.country||selectedCountry).toUpperCase()+'_'+text(scope.region||selectedSubdivision||'NATIONWIDE').toUpperCase()+'_'+stamp+'.json',blob=new Blob([JSON.stringify(lastProductTransitionAuditJson,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();setTimeout(function(){try{a.remove();URL.revokeObjectURL(url);}catch(_e){}},1200);show('읽기 전용 전환 검증 JSON 다운로드를 시작했습니다.','ok');}catch(e){show('검증 JSON 파일을 만들지 못했습니다: '+text(e&&e.message),'fail');}}
  async function runProductTransitionAudit(options){
    options=options||{};if(!selectedCountry)return null;var button=$('productTransitionAuditBtn'),download=$('productTransitionAuditDownloadBtn'),state=$('productTransitionAuditState'),grid=$('productTransitionAuditGrid'),requested=scopeSnapshot(),requestedKey=scopeKey(requested);if(button)button.disabled=true;if(download)download.disabled=true;if(state&&!options.silent){state.className='product-transition-audit-state';state.textContent='현재 리서치 상태·최신 상품·비공개 후보 원장을 다시 읽어 대기열→후보→20개 섹션 연결을 교차 검증 중입니다.';}
    try{
      var status=await loadProductResearchCompact(requested.country,requested.region);if(scopeKey()!==requestedKey)throw new Error('검증 중 선택 범위가 변경됐습니다.');if(status&&status.status&&status.status!=='not_started'){lastProductJson=mergeCompactProductStatus(status);renderProductProgress(lastProductJson);rememberReport('product',lastProductJson);}
      await refreshCandidateLedgerProducts({preserveResearchReport:true});if(scopeKey()!==requestedKey)throw new Error('검증 중 선택 범위가 변경됐습니다.');
      var expectedLatest=Number(status&&status.summary&&status.summary.latestResearchProducts||0);if(expectedLatest>0&&(latestProductRows.length<expectedLatest||!latestProductRows.length)){await refreshLatestResearchRows(requested.country,requested.region,{state:options.silent?null:state,label:'전환 검증 최신 상품',preserveOnFailure:true});}
      var latestUrls={};latestProductRows.forEach(function(row){var key=productUrlMatchKey(row&&row.productUrl||row&&row.url);if(key)latestUrls[key]=true;});
      var total=productRows.length,undecided=0,assigned=0,repair=0,held=0,rejected=0,currentLinked=0;productRows.forEach(function(row){var decision=productDecision(row),key=assignedSectionKey(row),urlKey=productUrlMatchKey(row.productUrl||row.url);if(urlKey&&latestUrls[urlKey])currentLinked+=1;if(decision==='undecided')undecided+=1;else if(decision==='slot_candidate'){if(key)assigned+=1;else repair+=1;}else if(decision==='hold')held+=1;else if(decision==='reject'||decision==='purge')rejected+=1;});
      var summary=status&&status.summary||{},partial=status&&status.pipeline&&status.pipeline.partialQueue||{},eligible=Number(summary.privateResearchQueueEligible||partial.eligible||0),staged=Number(summary.privateResearchQueueStaged||partial.done||0),active=undecided+assigned+repair,excluded=held+rejected,classified=active+excluded,linkGap=Math.max(0,staged-currentLinked),classificationGap=Math.max(0,total-classified),issues=[];if(linkGap>0)issues.push('이번 등록 '+staged+'건 중 최신 리서치와 연결 확인되지 않은 '+linkGap+'건');if(classificationGap>0)issues.push('후보 상태 미분류 '+classificationGap+'건');if(repair>0)issues.push('20개 섹션 배정정보 복구 필요 '+repair+'건');
      var phase=text(status&&status.status),phaseReady=phase==='complete'||(status&&status.pause&&status.pause.paused===true),auditOk=linkGap===0&&classificationGap===0,latestDeleted=Number(status&&status.pipeline&&status.pipeline.latestResearchDeleted||0),removedFromList=productRows.filter(function(row){return text(row&&row.queueControl&&row.queueControl.action).toLowerCase()==='remove_from_list'||text(row&&row.review&&row.review.state).toLowerCase()==='removed_from_list';}).length,frontPrepared=productRows.filter(function(row){var s=text(row&&row.frontPublication&&row.frontPublication.status).toLowerCase();return s==='queued'||s==='publish_requested';}).length,frontLive=productRows.filter(function(row){var s=text(row&&row.frontPublication&&row.frontPublication.status).toLowerCase();return s==='matched'||s==='published'||s==='active';}).length,frontPendingBuild=productRows.filter(function(row){return row&&row.frontPublication&&row.frontPublication.pendingBuild===true;}).length,bridge=window.IGDCCommerceManagementBridge||{},readOnlyCleanupState={latestResearchDeleted:latestDeleted,candidateRemovedFromList:removedFromList,frontPrepared:frontPrepared,frontLive:frontLive,frontPendingBuild:frontPendingBuild,aiExecutionBridgeReady:typeof bridge.preview==='function'&&typeof bridge.execute==='function',perProductSectionReleaseDispatchesBuild:false,observedAt:new Date().toISOString()};
      if(grid)grid.innerHTML=transitionAuditMetric('최신 상품',latestProductRows.length,'이번 리서치 목록','info')+transitionAuditMetric('대기열 적격',eligible,'검증 완료 기준','info')+transitionAuditMetric('이번 후보 관리목록 등록',staged,'현재 리서치 실행 원장',staged&&linkGap===0?'good':'info')+transitionAuditMetric('리서치↔대기열 연결',currentLinked,staged?'등록 '+staged+'건과 교차 확인':'등록 전 상태',linkGap===0?'good':'warn')+transitionAuditMetric('후보 관리 목록',active,'미배정·배치·복구 포함','info')+transitionAuditMetric('보류·제외',excluded,'후보 원장에는 보존','info')+transitionAuditMetric('20개 섹션 배치',assigned,'프론트 매칭 전 단계',repair===0?'good':'info')+transitionAuditMetric('배정정보 복구',repair,'AI/수동 재배치 대상',repair===0?'good':'warn')+transitionAuditMetric('읽기 전용 정리 상태',latestDeleted,'리서치 삭제 '+latestDeleted+' · 후보 목록 제거 '+removedFromList+' · AI 실행 '+(readOnlyCleanupState.aiExecutionBridgeReady?'연결':'미연결'),readOnlyCleanupState.aiExecutionBridgeReady?'good':'warn');
      if(state){state.className='product-transition-audit-state '+(auditOk?'complete':'warn');state.textContent=(auditOk?'전환 원장 교차검증 정상':'전환 원장 확인 필요')+' · 후보 원장 전체 '+total+'건 = 관리 '+active+'건 + 보류·제외 '+excluded+'건'+(staged?' · 이번 리서치 후보 관리목록 등록 '+staged+'건 중 최신 리서치 연결 '+currentLinked+'건':'')+(issues.length?' · '+issues.join(' · '):'')+(phaseReady?' · 리서치 전환 게이트 사용 가능':' · 리서치가 아직 진행 상태이므로 완료 또는 서버 일시정지 후 추가 등록 가능');}
      lastProductTransitionAuditJson={ok:auditOk,reportType:'igdc-product-transition-audit-readonly',schema:'igdc-product-transition-audit-readonly.v1',scope:requested,status:phase,phaseReady:phaseReady,latest:latestProductRows.length,eligible:eligible,staged:staged,currentLinked:currentLinked,total:total,active:active,excluded:excluded,assigned:assigned,repair:repair,issues:issues,readOnlyCleanupState:readOnlyCleanupState,safety:{readOnly:true,frontPublication:false,githubNetlifyBuild:false,paymentExecution:false}};
      if(lastProductJson){lastProductJson.pipeline=Object.assign({},lastProductJson.pipeline||{},{transitionAuditReadOnly:readOnlyCleanupState});rememberReport('product',lastProductJson);}if(download)download.disabled=false;return lastProductTransitionAuditJson;
    }catch(e){lastProductTransitionAuditJson=null;if(state){state.className='product-transition-audit-state warn';state.textContent='대기열·배치 전환 검증 실패: '+conciseRequestError(e&&e.message,e&&e.status)+' · 기존 원장은 변경하지 않았습니다.';}if(!options.silent)show(conciseRequestError(e&&e.message,e&&e.status),'warn');return{ok:false,error:e};}
    finally{if(button)button.disabled=false;if(download)download.disabled=!lastProductTransitionAuditJson;syncLatestProductQueueControls();}
  }

  function productAiDraft(data){return data&&data.aiAutomationDraft&&typeof data.aiAutomationDraft==='object'?data.aiAutomationDraft:{};}
  function ensureProductAiFinalizeControl(){
    var ai=$('productAiAutoBtn');if(!ai||!ai.parentNode)return;var actions=ai.parentNode,button=$('productAiFinalizeBtn');
    if(!button){button=document.createElement('button');button.id='productAiFinalizeBtn';button.type='button';button.className='secondary';button.disabled=true;button.textContent='AI 정리 최종 완료';actions.insertBefore(button,ai.nextSibling);}
  }
  function syncProductAiFinalizeControl(){
    ensureProductAiFinalizeControl();var button=$('productAiFinalizeBtn'),draft=productAiDraft(lastProductJson),pending=Number(draft.pendingItems||0),ready=!!text(draft.runToken)&&pending>0;
    if(button){button.disabled=productAutomationActive||productFrontSyncActive||!selectedCountry||!ready;button.textContent=ready?'AI 정리 최종 완료 ('+pending+'건)':'AI 정리 최종 완료';}
  }
  async function finalizeProductAiDraft(options){
    options=options||{};var internal=options.internal===true;if(!selectedCountry||(!internal&&productAutomationActive))return{ok:false,reason:'busy'};var draft=productAiDraft(lastProductJson),runToken=text(options.aiRunToken||draft.runToken),remaining=Number(draft.pendingItems||0);
    if(!runToken||remaining<=0){if(!internal)show('최종 완료할 AI 임시 정리 결과가 없습니다.','warn');syncProductAiFinalizeControl();return{ok:false,reason:'empty',remaining:0};}
    if(!internal&&!window.confirm('정상 완료된 AI 임시 정리 '+remaining+'건을 상품 후보·20개 섹션 배치 원장에 최종 확정하시겠습니까?\n\n미완료·오류 이후 상품은 건드리지 않습니다. 프론트 공개·결제는 실행하지 않습니다.'))return{ok:false,reason:'cancelled',remaining:remaining};
    var owns=!internal,state=$('productAiAutomationState'),synced=0,failed=0,passes=0,previous=remaining+1;if(owns)productAutomationActive=true;syncProductAiFinalizeControl();
    try{
      while(remaining>0&&failed===0&&passes<200){passes+=1;if(state){state.className='product-auto-state running';state.textContent='AI 임시 정리 최종 확정 · 남은 '+remaining+'건';}var data=await api(CONTROL,'product_ai_automation','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',mode:'queue_sync',batchSize:10,aiRunToken:runToken});var result=data&&data.aiAutomationResult||{};synced+=Number(result.queueSynced||0);failed+=Number(result.queueSyncFailed||0);remaining=Number(result.queueSyncRemaining||0);lastProductJson=Object.assign({},lastProductJson||{},data,{products:productRows});rememberReport('product',lastProductJson);renderProductProgress(lastProductJson);saveReviewSnapshot();if(remaining>=previous&&Number(result.queueSynced||0)<=0)break;previous=remaining;}
      try{var refreshed=await loadProductResearchCompact(selectedCountry,selectedSubdivision||'NATIONWIDE');if(refreshed&&refreshed.status){lastProductJson=mergeCompactProductStatus(refreshed);rememberReport('product',lastProductJson);renderProductProgress(lastProductJson);saveReviewSnapshot();}}catch(_refreshError){}
      var finalDraft=productAiDraft(lastProductJson),partial=Number(finalDraft.completedItems||0)<Number(finalDraft.targetItems||0);if(state){state.className='product-auto-state '+(failed||remaining?'warn':'complete');state.textContent=(failed||remaining?'AI 최종 확정 일부 완료':(partial?'오류 직전 완료분 최종 확정':'AI 정리 최종 완료'))+' · 확정 '+synced+'건'+(remaining?' · 남음 '+remaining+'건':'')+(failed?' · 실패 '+failed+'건':'')+(partial?' · 미처리분은 그대로 대기':'');}
      if(!internal)show((partial?'정상 완료된 임시 정리분까지만':'AI 임시 정리 결과를')+' 최종 확정했습니다. 프론트 공개는 실행하지 않았습니다.',failed||remaining?'warn':'ok');return{ok:failed===0&&remaining===0,synced:synced,failed:failed,remaining:remaining,partial:partial};
    }catch(e){if(state){state.className='product-auto-state warn';state.textContent='AI 최종 확정 중단 · 직전 정상 확정분은 보존됩니다.';}if(!internal)show(text(e&&e.message)||'AI 최종 확정이 중단됐습니다.','fail');return{ok:false,error:e,synced:synced,failed:failed,remaining:remaining};}
    finally{if(owns)productAutomationActive=false;syncProductAiFinalizeControl();if(owns)renderProducts(productRows);}
  }

  function transientCandidateBatchError(error){var status=Number(error&&error.status)||0;return !status||[408,425,429,500,502,503,504,521,522,523,524].indexOf(status)>=0;}
  async function runAllCandidateSmartAutoPlacement(){
    if(productAutomationActive||productFrontSyncActive||productSectionCleanupActive)return;
    if(!selectedCountry){show('먼저 국가·지역 범위를 선택해 주세요.','warn');return;}
    try{await refreshCandidateLedgerProducts({preserveResearchReport:true});}catch(_e){}
    var targets=productRows.filter(function(row){
      if(!row||row.ledgerSource!=='candidate')return false;
      var decision=productDecision(row);
      if(['hold','reject','purge','removed'].indexOf(decision)>=0)return false;
      if(productManagementLocked(row))return false;
      return decision==='undecided';
    }).map(function(row){return text(row.candidateId||row.id);}).filter(Boolean);
    targets=Array.from(new Set(targets));
    if(!targets.length){show('AI가 새로 배치할 미배정 상품이 없습니다. 기존 배치와 관리자 결정은 그대로 보존됩니다.','warn');return;}
    if(!window.confirm('전체 상품 후보·배치 관리 목록의 신규 미배정 상품 '+targets.length+'건만 품목 의미에 맞게 추가 분류·배치합니다. 기존에 배치된 상품은 재검증·재배치하지 않습니다.\n\n여행·호텔·티켓·예약은 투어 우측, 자동차·아웃도어는 홈 우측 중단, 가구·리빙은 홈 우측 하단, 식품은 홈 2/유통 식품, 뷰티는 홈 1/유통 뷰티, 의류·소형가전은 홈 3 및 전용 유통 섹션, 생필품은 홈 4/유통 생활로 배치합니다.\n\n이미 배치된 상품(수동·AI 모두)과 보류·제외·영구 제외는 변경하지 않습니다.'))return;
    var button=$('productCandidateSmartAutoPlaceBtn');if(button)button.disabled=true;
    try{
      await runCandidateLedgerAiRecovery(targets,{label:'전체 후보 카테고리 자동 배치',confirm:false});
    }finally{if(button)button.disabled=false;}
  }

  async function runCandidateLedgerAiRecovery(targetIds,options){
    options=options||{};var targets=Array.from(new Set((targetIds||[]).map(text).filter(Boolean)));if(!targets.length){show('현재 범위에 재검증·자동 배치할 상품 후보가 없습니다.','warn');return{ok:false,reason:'empty'};}
    if(options.confirm!==false&&!window.confirm('상품 후보 '+targets.length+'건을 다시 검증하고 살아 있는 상품만 섹션 후보로 재정렬하시겠습니까? 최근 정상 검증 기록은 재사용하고 오래되었거나 미확인인 상품만 실제 상세페이지를 다시 확인합니다.\n\n삭제·잘못된 접근·판매처 홈 리다이렉트 상품은 후보에서 보류하고, 정상 예비상품을 다시 배치합니다. 이 단계에서는 프론트 공개·결제를 실행하지 않습니다.'))return{ok:false,reason:'cancelled'};
    productAutomationActive=true;var ledgerState=$('productAiAutomationState'),assignedTotal=0,unassignedTotal=0,invalidTotal=0,inconclusiveTotal=0,changedTotal=0,revalidatedTotal=0,preservedTotal=0,balanceCounts=productSectionCounts(),tourDiningCount=tourDiningPlacementCount(),failedBatches=[];
    if(ledgerState){ledgerState.className='product-auto-state running';ledgerState.textContent=(options.label||'상품 후보')+' '+targets.length+'건을 10건씩 최근 검증 재사용·필요 항목 재검증·자동 배치 중입니다.';}
    try{
      for(var off=0;off<targets.length;off+=10){
        var batch=targets.slice(off,off+10),part=null,lastError=null;
        if(ledgerState)ledgerState.textContent='후보 실제 페이지 재검증·엄격 카테고리 배치 '+Math.min(off+batch.length,targets.length)+'/'+targets.length+'건';
        for(var attempt=0;attempt<3&&!part;attempt++){
          try{part=await api(CONTROL,'product_candidate_ai_recover','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',candidateIds:batch,balanceCounts:balanceCounts,tourDiningAutomaticCount:tourDiningCount},35000);}
          catch(e){lastError=e;if(!transientCandidateBatchError(e)||attempt>=2)break;if(ledgerState)ledgerState.textContent='후보 재검증 '+Math.min(off+batch.length,targets.length)+'/'+targets.length+'건 · 일시 응답 지연으로 '+(attempt+2)+'회차 재확인 중';await new Promise(function(resolve){setTimeout(resolve,700*(attempt+1));});}
        }
        if(!part){failedBatches.push({offset:off,candidateIds:batch.slice(),message:text(lastError&&lastError.message)||'batch_failed'});if(ledgerState)ledgerState.textContent='후보 재검증 '+Math.min(off+batch.length,targets.length)+'/'+targets.length+'건 · 실패 묶음 '+failedBatches.length+'개 기록 · 다음 묶음 계속';continue;}
        if(part.balanceCounts)balanceCounts=part.balanceCounts;if(part.tourDiningAutomaticCount!=null)tourDiningCount=Number(part.tourDiningAutomaticCount||0);assignedTotal+=Number(part.assigned||0);unassignedTotal+=Number(part.unassigned||0);invalidTotal+=Number(part.invalid||0);inconclusiveTotal+=Number(part.inconclusive||0);changedTotal+=Number(part.changedSection||0);revalidatedTotal+=Number(part.revalidated||0);preservedTotal+=Number(part.preserved||0);
      }
      await refreshCandidateLedgerProducts({preserveResearchReport:true});
      try{var researchState=await loadProductResearchCompact(selectedCountry,selectedSubdivision||'NATIONWIDE');if(researchState&&researchState.status&&researchState.status!=='not_started'){lastProductJson=mergeCompactProductStatus(researchState);rememberReport('product',lastProductJson);renderProductProgress(lastProductJson);saveReviewSnapshot();}}catch(_researchStateError){}
      var hasWarn=failedBatches.length||invalidTotal||inconclusiveTotal;if(ledgerState){ledgerState.className='product-auto-state '+(hasWarn?'warn':'complete');ledgerState.textContent='후보 갱신 '+(failedBatches.length?'부분 완료':'완료')+' · 재검증 '+revalidatedTotal+'건 · 정상 배치 '+assignedTotal+'건 · 카테고리 엄격 재분류 '+changedTotal+'건 · 삭제/불량 '+invalidTotal+'건 · 일시 확인보류 '+inconclusiveTotal+'건 · 관리자 고정 유지 '+preservedTotal+'건'+(failedBatches.length?' · 실패 묶음 '+failedBatches.length+'개는 다음 실행에서 재시도 가능':'');}
      show('실제 상품 페이지 '+revalidatedTotal+'건을 다시 확인했습니다.'+(failedBatches.length?' 일시 오류 묶음 '+failedBatches.length+'개는 건너뛰고 나머지 묶음을 계속 처리했으며, 해당 후보는 원장에 그대로 남아 다음 실행에서 재시도할 수 있습니다.':'')+' 프론트 공개·결제는 실행하지 않았습니다.',hasWarn?'warn':'ok');
      return{ok:failedBatches.length===0,revalidated:revalidatedTotal,assigned:assignedTotal,invalid:invalidTotal,inconclusive:inconclusiveTotal,failedBatches:failedBatches};
    }finally{productAutomationActive=false;renderProducts(productRows);syncLatestProductQueueControls();}
  }

  async function runProductAiAutomation(mode,sectionKey,productIds,options){
    options=options||{};
    if(!selectedCountry||productAutomationActive)return;
    // The full-auto workflow includes the durable research-to-candidate handoff.
    // A product without a canonical ID must never be silently skipped or
    // assigned by a synthesized browser-side ID. Stop if server readback fails.
    if(mode==='all'&&!productLoopActive&&!productQueueStageActive&&lastProductJson&&
      (text(lastProductJson.status).toLowerCase()==='complete'||!!(lastProductJson.pause&&lastProductJson.pause.paused===true))&&
      (latestInCandidateFresh().length>0||Number(lastProductJson.summary&&lastProductJson.summary.privateResearchQueueEligible||0)>Number(lastProductJson.summary&&lastProductJson.summary.privateResearchQueueStaged||0))){
      var stagedResearch=await stageCurrentResearchQueue({automatic:true});
      if(!stagedResearch){show('리서치 후보 원장 등록이 확인되지 않아 AI 배치를 시작하지 않았습니다. 재조회 후 등록을 확인하세요.','warn');return;}
    }
    if(!lastProductJson||!productRows.length){show('AI 자동 배치할 등록 후보가 없습니다. 미등록 리서치 상품은 먼저 검증·원장 등록해야 합니다.','warn');return;}
    var candidateLedgerMode=candidateLedgerViewActive(),pendingDraft=productAiDraft(lastProductJson);
    if(!candidateLedgerMode&&mode==='all'){
      /* The durable candidate ledger is the correct source for the top-level
         green AI automation button.  A page restored from chunked research
         results can otherwise call the legacy job.products path, which is
         intentionally empty for chunked_v1 jobs and returns 409. */
      try{await refreshCandidateLedgerProducts({preserveResearchReport:true});candidateLedgerMode=candidateLedgerViewActive();}catch(_candidateLedgerRefreshError){}
    }
    if(!candidateLedgerMode&&Number(pendingDraft.pendingItems||0)>0){show('이전에 정상 완료된 AI 임시 정리 '+Number(pendingDraft.pendingItems||0)+'건이 최종 확정 대기 중입니다. 먼저 `AI 정리 최종 완료`를 눌러 확정한 뒤 다음 정리를 시작해 주세요.','warn');syncProductAiFinalizeControl();return;}
    if(candidateLedgerMode){
      var selectedModeLedger=mode==='products',selectedLedgerIds=Array.isArray(productIds)?productIds.map(text).filter(Boolean):[],targets=productRows.filter(function(row){if(row.ledgerSource!=='candidate')return false;if(selectedModeLedger&&selectedLedgerIds.indexOf(text(row.id))<0)return false;var decision=productDecision(row);if(decision==='reject'||decision==='purge')return false;if(mode==='repair')return decision==='slot_candidate'&&!assignedSectionKey(row);if(mode==='section')return assignedSectionKey(row)===sectionKey||candidatePlacementKey(row)===sectionKey;if(mode==='all')return decision==='undecided'&&!productManagementLocked(row);return decision==='undecided'||decision==='slot_candidate'||decision==='hold';}).map(function(row){return text(row.candidateId||row.id);}).filter(Boolean);
      await runCandidateLedgerAiRecovery(targets,{label:selectedModeLedger?'선택 상품':'상품 후보',confirm:options.skipConfirm!==true});return;
    }
    var sectionMode=mode==='section',repairMode=mode==='repair',selectedMode=mode==='products',selectedIds=Array.isArray(productIds)?productIds.map(text).filter(Boolean):[],label=sectionMode?sectionLabel(sectionKey):(repairMode?'배정정보 복구 필요 후보':(selectedMode?'선택 후보 '+selectedIds.length+'건':'현재 국가 전체 20개 섹션'));
    if(selectedMode&&!selectedIds.length){show('AI 자동 배치할 후보를 선택해 주세요.','warn');return;}
    var selectedRowMap={};productRows.forEach(function(row){selectedRowMap[text(row&&row.id)]=row;});
    var selectedAllUndecided=selectedMode&&selectedIds.length>0&&selectedIds.every(function(id){var row=selectedRowMap[id];return !!row&&productDecision(row)==='undecided'&&!productManagementLocked(row);});
    var batchPlacement=!sectionMode&&!repairMode&&(!selectedMode||selectedAllUndecided),batchTargets=batchPlacement?(selectedMode?selectedIds:productRows.filter(function(row){return productDecision(row)==='undecided'&&!productManagementLocked(row);}).map(function(row){return text(row.id);}).filter(Boolean)):[];
    if(batchPlacement&&!batchTargets.length){show('현재 미배정 후보 중 AI 자동 배치할 상품이 없습니다.','warn');return;}
    var message=sectionMode?label+'의 관리자 고정 상품은 보존하고, 해당 섹션에 적합한 비공개 후보를 최대한 다시 정렬·보충합니다.':repairMode?'배정정보가 비어 있거나 잘못된 후보만 다시 분석하여, 판단 가능한 상품을 20개 섹션의 비공개 배치 예정 목록으로 복구합니다. 미배정 후보·보류·제외·관리자 수동 지정은 바꾸지 않습니다.':selectedMode?label+'만 저장된 조사 결과를 기준으로 AI 자동 배치합니다. 선택하지 않은 후보와 관리자 수동 지정은 바꾸지 않습니다.':label+'과 미배정·추가 확인 필요 목록을 전부 분석합니다. 상품 URL·이미지·판매처가 정상인 후보는 공개 전 경고 상태로라도 품목 정책에 맞는 섹션에 최대한 자동 배치합니다.';
    if(options.skipConfirm!==true&&!window.confirm(message+'\n\n보류·제외·영구 제외와 관리자 수동 지정은 덮어쓰지 않으며 사이트 공개·상품 수입·결제는 실행하지 않습니다.'))return;
    productAutomationActive=true;
    var top=$('productAiAutoBtn'),state=$('productAiAutomationState');
    if(top)top.disabled=true;
    Array.prototype.forEach.call(document.querySelectorAll('[data-section-ai-auto]'),function(button){button.disabled=true;});
    if(state){state.className='product-auto-state running';state.textContent=label+' AI 자동 정리를 진행하고 있습니다.';}
    try{
      var data=null,result={},queueSyncedTotal=0,queueFailedTotal=0,queueRemaining=0,autoFinalizeDraft=false,aiRunToken='',temporaryCompleted=0;
      if(batchPlacement){
        var batchSize=10,assignedTotal=0,pendingTotal=0,heldTotal=0,changedTotal=0,manualPreserved=0;autoFinalizeDraft=!selectedMode&&mode==='all';aiRunToken='ai_draft_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
        for(var off=0;off<batchTargets.length;off+=batchSize){
          var batch=batchTargets.slice(off,off+batchSize);
          if(state){state.className='product-auto-state running';state.textContent=label+' 정책 임시 정리 '+Math.min(off+batch.length,batchTargets.length)+'/'+batchTargets.length+'건 · 10건 단위 체크포인트 저장';}
          data=await api(CONTROL,'product_ai_automation','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',mode:'placement_batch',productIds:batch,batchSize:batchSize,deferQueueSync:true,aiRunToken:aiRunToken,targetTotal:batchTargets.length,draftMode:autoFinalizeDraft?'automatic':'manual',automaticFinalize:autoFinalizeDraft});
          var partResult=data&&data.aiAutomationResult||{};
          assignedTotal+=Number(partResult.assigned||0);pendingTotal+=Number(partResult.pendingEvidenceAssigned||0);heldTotal+=Number(partResult.held||0);changedTotal+=Number(partResult.changed||0);manualPreserved=Math.max(manualPreserved,Number(partResult.manualPreserved||0));queueRemaining=Number(partResult.temporaryPendingItems||partResult.queueSyncRemaining||0);temporaryCompleted=Number(partResult.temporaryCompletedItems||temporaryCompleted+batch.length);
          lastProductJson=Object.assign({},lastProductJson||{},data,{products:productRows});renderProductProgress(lastProductJson);rememberReport('product',lastProductJson);saveReviewSnapshot();syncProductAiFinalizeControl();
        }
        if(autoFinalizeDraft){
          if(state){state.className='product-auto-state running';state.textContent=label+' 임시 정리 '+temporaryCompleted+'건 완료 · 최종 확정을 마지막에 1회 진행합니다.';}
          var finalized=await finalizeProductAiDraft({internal:true,aiRunToken:aiRunToken});queueSyncedTotal=Number(finalized.synced||0);queueFailedTotal=Number(finalized.failed||0);queueRemaining=Number(finalized.remaining||0);
        }else if(state){state.className='product-auto-state complete';state.textContent=label+' 임시 정리 '+temporaryCompleted+'건 완료 · 후보 원장 최종 반영 전입니다. `AI 정리 최종 완료`를 누르면 한 번에 마무리합니다.';}
        var refreshed=await loadProductResearchPaged(selectedCountry,selectedSubdivision||'NATIONWIDE',{state:state,label:'AI 정리 후 관리 목록'});lastProductJson=refreshed;rememberReport('product',refreshed);renderProductProgress(refreshed);renderProducts(refreshed.products||[]);saveReviewSnapshot();syncProductAiFinalizeControl();
        var sm=refreshed.summary||{},globalUnassigned=Math.max(0,Number(sm.discovered||productRows.length)-Number(sm.slotCandidates||0)-Number(sm.held||0)-Number(sm.rejected||0)-Number(sm.permanentExcluded||0));
        result={assigned:assignedTotal,pendingEvidenceAssigned:pendingTotal,unassigned:globalUnassigned,held:heldTotal,manualPreserved:manualPreserved,changed:changedTotal,settlementReady:Number(sm.settlementReadyProducts||0),queueSynced:queueSyncedTotal,queueSyncFailed:queueFailedTotal,queueSyncRemaining:queueRemaining,temporaryCompletedItems:temporaryCompleted,temporary:!autoFinalizeDraft};
      }else{
        var pass=0,maxPasses=(sectionMode||repairMode||selectedMode)?1:10,previousRemaining=-1;
        do{
          pass+=1;if(state){state.className='product-auto-state running';state.textContent=label+' AI 자동 정리 '+pass+'단계 진행 중';}
          data=await api(CONTROL,'product_ai_automation','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',mode:sectionMode?'section':(repairMode?'repair':(selectedMode?'products':'placement')),sectionKey:sectionMode?sectionKey:'',productIds:selectedMode?selectedIds:[],compactResponse:true});
          lastProductJson=Object.assign({},lastProductJson||{},data,{products:productRows,latestProducts:latestProductRows});rememberReport('product',lastProductJson);renderProductProgress(lastProductJson);saveReviewSnapshot();result=data.aiAutomationResult||{};
          var remaining=Number(result.enrichmentRemaining||0),attempted=Number(result.enrichmentAttempted||0);if(sectionMode||repairMode||selectedMode||remaining<=0||attempted<=0||pass>=maxPasses||remaining===previousRemaining)break;previousRemaining=remaining;
        }while(true);
        queueRemaining=Number(result.queueSyncRemaining||result.queueSyncDeferred||0);queueSyncedTotal=Number(result.queueSynced||0);queueFailedTotal=Number(result.queueSyncFailed||0);var queuePass2=0,queuePrevious2=queueRemaining;
        while(queueRemaining>0&&queueFailedTotal===0&&queuePass2<80){queuePass2+=1;if(state){state.className='product-auto-state running';state.textContent=label+' 배치 결과를 프론트 후보 원장에 소량 연결 중 · 남은 '+queueRemaining+'건';}var queueData2=await api(CONTROL,'product_ai_automation','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',mode:'queue_sync',batchSize:10});var queueResult2=queueData2.aiAutomationResult||{};queueSyncedTotal+=Number(queueResult2.queueSynced||0);queueFailedTotal+=Number(queueResult2.queueSyncFailed||0);queueRemaining=Number(queueResult2.queueSyncRemaining||0);if(queueRemaining>=queuePrevious2&&Number(queueResult2.queueSynced||0)<=0)break;queuePrevious2=queueRemaining;}
        if(queuePass2>0){try{var refreshed2=await loadProductResearchPaged(selectedCountry,selectedSubdivision||'NATIONWIDE',{state:state,label:'AI 배치 후 관리 목록'});lastProductJson=refreshed2;rememberReport('product',refreshed2);renderProductProgress(refreshed2);renderProducts(refreshed2.products||[]);saveReviewSnapshot();}catch(_refreshError){}}
        result.queueSynced=queueSyncedTotal;result.queueSyncFailed=queueFailedTotal;result.queueSyncRemaining=queueRemaining;
      }
      if(result.temporary===true){if(state){state.className='product-auto-state complete';state.textContent='AI 임시 정리 '+Number(result.temporaryCompletedItems||0)+'건 완료 · 최종 확정 대기 '+queueRemaining+'건 · `AI 정리 최종 완료`를 누르면 정상 완료분만 확정합니다.';}show('10건 단위 AI 임시 정리를 완료했습니다. 아직 후보 원장 최종 확정 전이며 `AI 정리 최종 완료` 버튼으로 한 번에 마무리할 수 있습니다.','ok');}
      else{if(state){state.className='product-auto-state '+(queueFailedTotal||queueRemaining?'warn':'complete');state.textContent=automationResultText(result)+(queueSyncedTotal?' · 프론트 후보 연결 '+queueSyncedTotal+'건':'')+(queueRemaining?' · 후보 연결 대기 '+queueRemaining+'건':'')+(queueFailedTotal?' · 연결 재시도 필요 '+queueFailedTotal+'건':'')+' · 자동 공개·상품 수입·결제 없음';}show(automationResultText(result)+(queueSyncedTotal?' · 프론트 후보 '+queueSyncedTotal+'건 연결':'')+(queueRemaining?' · 남은 후보 연결 '+queueRemaining+'건은 `AI 정리 최종 완료`로 이어서 확정할 수 있습니다.':'')+'으로 정리했습니다. 잘못 분류된 항목만 카드 드롭다운으로 수정하면 관리자 결정이 AI보다 우선 고정됩니다.',queueFailedTotal||queueRemaining?'warn':'ok');}
    }catch(e){
      try{var savedAi=await loadProductResearchCompact(selectedCountry,selectedSubdivision||'NATIONWIDE');lastProductJson=mergeCompactProductStatus(savedAi);rememberReport('product',lastProductJson);renderProductProgress(lastProductJson);saveReviewSnapshot();}catch(_aiStatusError){}
      var draftNow=productAiDraft(lastProductJson),savedPending=Number(draftNow.pendingItems||0),finalizedOnError=null;
      // A failed batch is never grounds to auto-finalize a partially obsolete draft.
      // Operator must inspect the current ledger and confirm the remaining batch separately.
      if(state){state.className='product-auto-state warn';state.textContent='AI 자동 정리 중단: '+(text(e&&e.message)||'알 수 없는 오류')+(' · 정상 완료된 임시 저장은 보존 · 자동 최종 확정은 중단')+' · 실패 묶음부터 재개 가능';}
      show((text(e&&e.message)||'AI 자동 정리에 실패했습니다.')+(' 정상 완료된 10건 단위 임시 저장은 유지되지만 오류 직후 자동 확정하지 않습니다. 기존 배치 원장 확인 후 별도로 완료하세요.')+' 실패한 묶음부터 재개할 수 있습니다.','fail');
    }finally{
      productAutomationActive=false;renderProducts(productRows);if(top)top.disabled=!(lastProductJson&&productRows.length);
    }
  }

  function pendingFrontManagementChanges(mode,sectionKey,productId,selection){
    var selectedSections=mode==='sections'?(Array.isArray(selection)?selection:[]):[],selectedProducts=mode==='candidates'?(Array.isArray(selection)?selection:[]):[],selectedProductMap={};
    selectedProducts.forEach(function(id){selectedProductMap[text(id)]=true;});
    var changes=[];
    productRows.forEach(function(row){
      var id=text(row&&row.id),candidateId=text(row&&row.candidateId||row&&row.id),currentKey=productPlacementKey(row),currentDecision=productDecision(row),value=text(productPlacementSelections[id]);
      if(!id||!value||value.indexOf('affiliate:')===0)return;
      var desiredDecision=value.indexOf('section:')===0?'slot_candidate':value,desiredKey=desiredDecision==='slot_candidate'?value.slice(8):'';
      var actuallyChanged=desiredDecision==='slot_candidate'?(currentDecision!=='slot_candidate'||desiredKey!==currentKey):(desiredDecision!==currentDecision||currentKey!=='');
      if(!actuallyChanged)return;
      var include=mode==='all';
      if(mode==='section')include=currentKey===sectionKey||desiredKey===sectionKey;
      else if(mode==='sections')include=selectedSections.indexOf(currentKey)>=0||selectedSections.indexOf(desiredKey)>=0;
      else if(mode==='candidate')include=id===text(productId)||candidateId===text(productId);
      else if(mode==='candidates')include=selectedProductMap[id]===true||selectedProductMap[candidateId]===true;
      if(!include)return;
      if(['slot_candidate','hold','reject','undecided','ai_reclassify'].indexOf(desiredDecision)<0)return;
      changes.push({id:id,candidateId:candidateId,row:row,decision:desiredDecision,placementKey:desiredKey,oldSectionKey:currentKey,newSectionKey:desiredKey});
    });
    return changes;
  }
  async function persistFrontManagementChanges(changes,state,label){
    changes=Array.isArray(changes)?changes:[];
    if(!changes.length)return{changedCount:0,changedCandidateIds:[],movedCandidateIds:[],releasedCandidateIds:[]};
    var groups={},changed=[],moved=[],released=[];
    changes.forEach(function(change){
      var key=change.decision+'|'+(change.placementKey||'');
      if(!groups[key])groups[key]={decision:change.decision,placementKey:change.placementKey||'',rows:[]};
      groups[key].rows.push(change);
    });
    var keys=Object.keys(groups);
    for(var g=0;g<keys.length;g++){
      var group=groups[keys[g]],ledgerRows=group.rows.filter(function(change){return change.row&&change.row.ledgerSource==='candidate';}),legacyRows=group.rows.filter(function(change){return !change.row||change.row.ledgerSource!=='candidate';});
      for(var off=0;off<ledgerRows.length;off+=20){
        var chunk=ledgerRows.slice(off,off+20),candidateIds=chunk.map(function(change){return text(change.candidateId);}).filter(Boolean);
        if(state)state.textContent=label+' · 관리자 변경사항 '+Math.min(off+chunk.length,ledgerRows.length)+'/'+ledgerRows.length+'건 원장 저장 중';
        var result=await api(CONTROL,'product_candidate_ledger_bulk_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',candidateIds:candidateIds,decision:group.decision,placementKey:group.placementKey||''},45000);
        if(Number(result&&result.failed||0)>0){var error=new Error('관리자 변경사항 '+Number(result.failed||0)+'건 저장 실패');error.status=409;throw error;}
        chunk.forEach(function(change){changed.push(change.candidateId);if(change.decision==='slot_candidate')moved.push(change.candidateId);else released.push(change.candidateId);});
      }
      for(var i=0;i<legacyRows.length;i++){
        var change=legacyRows[i];
        await api(CONTROL,'product_candidate_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',productId:change.id,decision:group.decision,placementKey:group.placementKey||''},45000);
        changed.push(change.candidateId);if(change.decision==='slot_candidate')moved.push(change.candidateId);else released.push(change.candidateId);
      }
    }
    await refreshCandidateLedgerProducts({preserveResearchReport:true});
    changes.forEach(function(change){delete productPlacementSelections[change.id];});
    saveReviewSnapshot();
    return{changedCount:changes.length,changedCandidateIds:Array.from(new Set(changed.filter(Boolean))),movedCandidateIds:Array.from(new Set(moved.filter(Boolean))),releasedCandidateIds:Array.from(new Set(released.filter(Boolean)))};
  }
  function reflectFrontSyncAcknowledgments(aggregate,unmatch,frozenScope){
    if(scopeKey()!==frozenScope)return 0;
    var accepted={};
    (Array.isArray(aggregate&&aggregate.items)?aggregate.items:[]).forEach(function(item){
      if(item&&item.persisted===true&&item.candidateId)accepted[text(item.candidateId)]=true;
    });
    if(!unmatch)(aggregate&&aggregate.persistedCandidateIds||[]).forEach(function(id){if(id)accepted[text(id)]=true;});
    var changed=0;
    productRows.forEach(function(row){
      var id=frontCandidateLedgerId(row);if(!id||!accepted[id])return;
      var previous=row.frontPublication||{},requestedStatus=unmatch?'unpublish_requested':'publish_requested';
      // This marker represents a confirmed write request, not a finished build.
      row.frontPublication=Object.assign({},previous,{status:requestedStatus,
        operation:unmatch?'unmatch':'match',publicSnapshotConfirmed:false,
        pendingBuild:true,clientReadback:'server_persisted',country:selectedCountry,
        region:selectedSubdivision||'NATIONWIDE'});
      changed++;
    });
    return changed;
  }
  var frontMatchSnapshotCheckEpoch=0;
  function startAutomaticFrontSnapshotCheck(frozenScope,acceptedIds,unmatch,state,originalLabel,requestedKeys,expectedSections){
    var token=++frontMatchSnapshotCheckEpoch,ids=Array.from(new Set((acceptedIds||[]).map(text).filter(Boolean)));
    var attempt=0,maxAttempts=16;
    function unlockDeployment(){
      if(token!==frontMatchSnapshotCheckEpoch)return;
      frontMatchDeploymentBusy=false;
      renderProducts(productRows);syncFrontSelectionControls();
    }
    async function check(){
      if(token!==frontMatchSnapshotCheckEpoch||scopeKey()!==frozenScope){unlockDeployment();return;}
      attempt++;
      try{
        // Read only front JSON documents, not the 1,600-row candidate ledger.
        var freshReadback=await refreshFrontSnapshotCounts({skipRender:true,frozenScope:frozenScope,sectionKeys:requestedKeys});
        if(!freshReadback)throw new Error('공개 Snapshot의 최신 조회를 확인하지 못했습니다.');
        if(token!==frontMatchSnapshotCheckEpoch||scopeKey()!==frozenScope){unlockDeployment();return;}
        var publishedIds={};PRODUCT_SECTIONS.filter(function(section){return !requestedKeys||requestedKeys.indexOf(section.key)>=0;}).forEach(function(section){
          (frontSnapshotItems[section.key]||[]).forEach(function(item){
            if(frontItemPlaceholder(item))return;
            frontItemIds(item).forEach(function(id){publishedIds[section.key+'|'+id]=true;});
          });
        });
        if(!ids.length){
          if(state)state.textContent=originalLabel+' · 스냅샷 자동 새로고침 완료 · 추가 버튼 조작 불필요';
          renderProducts(productRows);
          unlockDeployment();return;
        }
        var verified=0,matched={};ids.forEach(function(id){
          var expected=expectedSections&&expectedSections[id],inSnapshot=!!expected&&(publishedIds[expected+'|'+id]===true||publishedIds[expected+'|gslot-'+id]===true);
          // Absence alone does not prove successful unpublishing: old snapshots
          // may not contain an IGDC candidate identifier at all.
          if(!unmatch&&inSnapshot){matched[id]=true;verified++;}
        });
        // Never reinterpret a missing/legacy candidate identifier as proof of
        // a changed live page. Only positive matching ID evidence upgrades status.
        if(!unmatch&&verified){productRows.forEach(function(row){
          var id=frontCandidateLedgerId(row);if(!matched[id]||!row.frontPublication)return;
          row.frontPublication=Object.assign({},row.frontPublication,{status:'matched',
            publicSnapshotConfirmed:true,pendingBuild:false,clientReadback:'front_snapshot'});
        });}
        if(verified){renderProducts(productRows);}
        if(unmatch){
          if(state)state.textContent=originalLabel+' · 매칭 해제 서버 저장 확인됨 · 프론트 상태 자동 조회 완료 (배포 완료 여부는 비동기)';
          unlockDeployment();return;
        }
        if(verified===ids.length){
          if(state){state.className='front-sync-state complete';state.textContent=originalLabel+' · 프론트 스냅샷 자동 확인 '+verified+'/'+ids.length+'건 · 추가 새로고침 불필요';}
          unlockDeployment();return;
        }
        if(attempt>=maxAttempts){
          // Build may take longer or static snapshots may omit candidate IDs.
          // Keep the server-confirmed publication request, not a false 'done'.
          if(state)state.textContent=originalLabel+' · 자동 확인 '+verified+'/'+ids.length+'건 · 나머지는 배포/스냅샷 확인 대기 (추가 버튼 조작 불필요)';
          unlockDeployment();return;
        }
      }catch(error){
        if(attempt>=maxAttempts){if(state)state.textContent=originalLabel+' · 공개 요청 저장 확인됨 · 자동 스냅샷 조회 지연: '+text(error&&error.message);unlockDeployment();return;}
      }
      setTimeout(check,attempt===1?12000:20000);
    }
    // Automatic, read-only verification belongs to the same button action;
    // it never creates a second administrator command or writes candidates.
    check();
  }
  // Synchronously lock EVERY front command before costly ledger/DOM work.
  function frontMatchImmediateLockV2(){
    var selector='#productFrontMatchBtn,#productFrontUnmatchBtn,#selectedSectionsMatchBtn,#allSectionsMatchBtn,#selectedSectionsUnmatchBtn,#allSectionsUnmatchBtn,[data-section-front-match],[data-section-front-unmatch],[data-selected-products-front]';
    Array.prototype.forEach.call(document.querySelectorAll(selector),function(button){button.disabled=true;});
    var state=$('productFrontSyncState');
    if(state){state.className='front-sync-state running';state.textContent='프론트 매칭 준비 중 · 모든 프론트 매칭 버튼 잠금';}
  }
  async function readSelectedSectionFrontBoard(keys,country,region,frozenScope){
    if(!Array.isArray(keys)||!keys.length||keys.length>4||keys.some(function(key){return !PRODUCT_SECTION_MAP[key];}))throw new Error('선택 섹션 범위를 확인하지 못했습니다.');
    var response=await api(MANAGEMENT_LEDGER,'list','GET',{
      country:country,region:region,mode:'section_front_match',sectionKeys:keys.join(',')
    },null,60000);
    if(scopeKey()!==frozenScope)throw new Error('조회 중 선택 국가·지역이 바뀌었습니다.');
    var verification=response&&response.verification;
    if(!response||response.ok!==true||!verification||verification.complete!==true||verification.source!=='direct_section_assignment_and_payload'
      ||verification.requestedSections!==keys.length||!Array.isArray(verification.sectionKeys)
      ||verification.sectionKeys.some(function(key,index){return key!==keys[index];})
      ||!Array.isArray(response.candidates)||response.candidates.length!==Number(verification.matchedCandidates))throw new Error('선택 섹션 원장 조회가 불완전합니다.');
    // Verify that each section's expected placement AND all cross-section
    // relations are present; an orphan/mismatch takes the original full path.
    var local=candidateLedgerProductData({ok:true,candidates:response.candidates});
    var rows=Array.isArray(local&&local.products)?local.products:[];
    if(rows.length!==response.candidates.length)throw new Error('선택 섹션 후보 변환이 불완전합니다.');
    if(response.candidates.some(function(item){return item&&item.assignmentRepairRequired===true
      ||(item&&item.ledgerConsistency&&item.ledgerConsistency.consistent===false);}))throw new Error('선택 섹션에 배치 관계 점검 대상이 있습니다.');
    var idSet={};rows.forEach(function(row){var id=frontCandidateLedgerId(row);if(id)idSet[id]=true;});
    // A scoped optimization is allowed ONLY after the ordinary board has
    // already completed a durable full read.  Compare both directions and
    // revisions: newly moved/removed/edited rows trigger the original scan.
    if(!latestOverviewLedgerComplete||!Array.isArray(productRows))throw new Error('기준 관리자 전체 원장이 확인되지 않았습니다.');
    var localById={};productRows.forEach(function(row){
      var key=assignedSectionKey(row),id=frontCandidateLedgerId(row);
      if(keys.indexOf(key)>=0&&productDecision(row)==='slot_candidate'&&id)localById[id]=row;
    });
    var serverById={};rows.forEach(function(row){
      var key=assignedSectionKey(row),id=frontCandidateLedgerId(row);
      if(keys.indexOf(key)>=0&&productDecision(row)==='slot_candidate'&&id)serverById[id]=row;
    });
    var existing=Object.keys(localById),current=Object.keys(serverById);
    if(existing.length!==current.length||existing.some(function(id){
      var local=localById[id],remote=serverById[id];
      return !remote||!text(local.updatedAt)||!text(remote.updatedAt)||text(local.updatedAt)!==text(remote.updatedAt)
        ||text(local.productUrl||local.url)!==text(remote.productUrl||remote.url)
        ||text(local.imageUrl)!==text(remote.imageUrl)
        ||text(local.productName||local.title)!==text(remote.productName||remote.title)
        ||assignedSectionKey(local)!==assignedSectionKey(remote);
    })||current.some(function(id){return !localById[id];}))
      throw new Error('관리자 화면과 선택 섹션의 최신 원장 내용이 달라 전체 원장으로 교차확인합니다.');
    return {rows:rows,verification:verification};
  }
  var productFrontSyncPreflightActive=false;
  var frontMatchCommandBusy=false,frontMatchDeploymentBusy=false;
  async function runProductFrontSync(operation,mode,sectionKey,productId,selection){
    if(!selectedCountry||frontMatchCommandBusy||frontMatchDeploymentBusy||productFrontSyncActive||productFrontSyncPreflightActive)return;
    frontMatchCommandBusy=true;
    // Set disabled properties within the click event itself.  Yield one
    // browser paint opportunity before scanning the 249-market ledger.
    frontMatchImmediateLockV2();
    await new Promise(function(resolve){setTimeout(resolve,20);});
    syncFrontSelectionControls();
    try{return await runProductFrontSyncCore(operation,mode,sectionKey,productId,selection);}
    finally{frontMatchCommandBusy=false;if(!frontMatchDeploymentBusy)renderProducts(productRows);syncFrontSelectionControls();}
  }
  async function runProductFrontSyncCore(operation,mode,sectionKey,productId,selection){
    if(!selectedCountry||productFrontSyncActive||productFrontSyncPreflightActive)return;
    // Supersede any passive readback started by an older button click.
    frontMatchSnapshotCheckEpoch++;
    var frontMatchScope=scopeKey(),frontMatchCountry=selectedCountry,frontMatchRegion=selectedSubdivision||'NATIONWIDE',frontMatchState=$('productFrontSyncState');
    productFrontSyncPreflightActive=true;
    if(frontMatchState){frontMatchState.className='front-sync-state running';frontMatchState.textContent='선택 범위의 원장 정합성을 확인 중입니다. 프론트 공개 요청은 아직 시작되지 않았습니다.';}
    // Publish exactly the administrator board that is already visible.  Reloading
    // all 600+ management rows before every Front Match made the command wait on
    // multiple paged reads and could prevent it from ever reaching finalize/Build
    // Hook.  Only recover from the server when the board is actually empty or was
    // previously marked partial.
    var scopeKeys=mode==='section'?[sectionKey]:(mode==='sections'?(Array.isArray(selection)?Array.from(new Set(selection)):[]):[]);
    var useSectionScope=operation==='match'&&latestOverviewLedgerComplete===true&&(mode==='section'||mode==='sections')&&scopeKeys.length>0&&scopeKeys.length<=4&&scopeKeys.every(function(key){return !!PRODUCT_SECTION_MAP[key];});
    var currentLedger=null,matchingBoardRows=null,scopedPreflightUsed=false;
    try{
      if(useSectionScope){
        try{
          var scoped=await readSelectedSectionFrontBoard(scopeKeys,frontMatchCountry,frontMatchRegion,frontMatchScope);
          if(scoped.rows.some(function(row){return productDecision(row)==='slot_candidate'&&scopeKeys.indexOf(assignedSectionKey(row))>=0;})){matchingBoardRows=scoped.rows;scopedPreflightUsed=true;
            if(frontMatchState)frontMatchState.textContent='선택 섹션 '+scopeKeys.length+'개 · 배치·후보 원장 교차검증 완료 · '+matchingBoardRows.length+'건';}
          // An empty scope MUST retain the original complete-board read and
          // server-side zero-assignment cleanup safeguard.
        }catch(scopedError){
          if(frontMatchState)frontMatchState.textContent='선택 섹션 검증 보류 · 전체 원장으로 안전하게 교차확인합니다: '+text(scopedError&&scopedError.message);
        }
      }
      if(!scopedPreflightUsed){
        currentLedger=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true,pageSize:125,frontSyncPreflight:true});
        if(!currentLedger||!currentLedger.pipeline||currentLedger.pipeline.ledgerLoadComplete!==true||currentLedger.pipeline.source!=='direct_management_ledger')throw new Error('원장 전체 조회가 완료되지 않았습니다. 오래된 화면으로 프론트를 치환하지 않습니다.');
        matchingBoardRows=productRows.slice();
      }
    }catch(error){show(conciseRequestError(error&&error.message,error&&error.status)||'현재 상품 후보·배치 관리 원장을 읽지 못해 Front Match를 중단했습니다.','fail');return;}
    finally{productFrontSyncPreflightActive=false;}
    if(scopeKey()!==frontMatchScope){show('국가·지역이 변경되었습니다. 프론트 매칭을 중단했습니다.','warn');return;}
    // Keep every administrator scope independent. A single section, selected
    // sections, selected products and all 20 sections resolve their own exact
    // target set here; only the final durable write/build machinery is shared.
    // Do not normalize section/all into another UI scope: that previously made
    // the controls behave as one chained action instead of separate commands.
    var unmatch=operation==='unmatch',sectionMode=mode==='section',sectionsMode=mode==='sections',candidateMode=mode==='candidate',candidatesMode=mode==='candidates',selectedSections=sectionsMode?(Array.isArray(selection)?selection:[]):[],selectedProducts=candidatesMode?(Array.isArray(selection)?selection:[]):[],selectedProduct=candidateMode?productById(productId):null,label=candidateMode?(text(selectedProduct&&selectedProduct.productName||selectedProduct&&selectedProduct.title||productId)+' · 상품 1건'):(candidatesMode?'선택 상품 '+selectedProducts.length+'건':(sectionsMode?(selectedSections.length===1?sectionLabel(selectedSections[0]):'선택 섹션 '+selectedSections.length+'개'):(sectionMode?sectionLabel(sectionKey):'20개 전체 섹션'))),confirmation=unmatch?'SITE_UNPUBLISH':'SITE_PUBLISH';
    if(sectionsMode&&!selectedSections.length){show('매칭할 섹션을 먼저 선택해 주세요.','warn');return;}if(candidatesMode&&!selectedProducts.length){show('매칭할 상품을 먼저 선택해 주세요.','warn');return;}
    var replacementRun=!unmatch&&(mode==='all'||sectionMode||sectionsMode),pendingManagement=[],selectedProductMap={};selectedProducts.forEach(function(id){selectedProductMap[text(id)]=true;});
    // Canonical publication is destination-unique inside one market section.
    // Use the same deterministic view for Front Match so duplicate candidate IDs
    // for one seller product can never inflate the admin count or be published twice.
    var authoritativeBoardRows=dedupePlacedSectionRows(matchingBoardRows.slice()),authoritativeBoardById={};
    authoritativeBoardRows.forEach(function(row){
      var id=frontCandidateLedgerId(row),key=assignedSectionKey(row);
      if(!id||!PRODUCT_SECTION_MAP[key])return;
      authoritativeBoardById[id]={schema:'igdc-admin-front-board-item.v2',authoritative:true,candidateId:id,sectionKey:key,title:text(row&&row.productName||row&&row.title),productUrl:text(row&&row.productUrl||row&&row.url),imageUrl:text(row&&row.imageUrl||row&&row.imageOriginalUrl),supplierName:text(row&&row.supplierName),supplierUrl:text(row&&row.supplierSiteUrl),price:row&&row.price!=null?row.price:null,priceCurrency:text(row&&row.priceCurrency),availability:row&&row.availability!=null?row.availability:null,priority:sectionRevenuePosition(row,key)?Number(sectionRevenueView[id].priority):null};
    });
    var targetRows=authoritativeBoardRows.filter(function(row){
      var key=assignedSectionKey(row),id=text(row&&row.id),placed=productDecision(row)==='slot_candidate'&&!!key;
      // The 20-section board owns only rows that still have a valid placement.
      // Match and unmatch are publication controls, not assignment controls:
      // matching requires a placed row; unmatching requires that same placed
      // row to have an active/pending publication marker.
      if(!key)return false;
      // Matching may also repair a row whose durable publication marker is
      // already live/pending.  Scope selection is still exact because a valid
      // assigned section key is required above.
      var eligible=unmatch?(placed&&frontPublicationActive(row)):(placed||frontPublicationLive(row));
      if(!eligible)return false;
      if(candidateMode)return id===text(productId);
      if(candidatesMode)return selectedProductMap[id]===true;
      if(sectionMode)return key===sectionKey;
      if(sectionsMode)return selectedSections.indexOf(key)>=0;
      return true;
    });
    if(replacementRun&&!unmatch){
      var replacementScopeKeys=mode==='all'?PRODUCT_SECTIONS.map(function(section){return section.key;}):(sectionMode?[sectionKey]:selectedSections.slice());
      // Re-read current, country-scoped order so a page reload cannot revert an
      // administrator's saved revenue order when choosing the first 100 cards.
      try{
        var rankNotice=$('productFrontSyncState');
        if(rankNotice){rankNotice.className='front-sync-state running';rankNotice.textContent='현재 관리자 확정 섹션 원장으로 프론트 매칭 준비 중 · 수익 순위 조회';}
        var verifiedOrder=await api(SECTION_REVENUE_RANK,'ranking','POST',{}, {action:'preview',countryCode:frontMatchCountry,subdivisionCode:frontMatchRegion,sectionKeys:replacementScopeKeys},12000);
        if(!verifiedOrder||verifiedOrder.ok===false)throw new Error(text(verifiedOrder&&verifiedOrder.error)||'rank_unavailable');
        sectionRevenueView={};(verifiedOrder.items||[]).forEach(function(item){sectionRevenueView[text(item.candidateId)]=item;});sectionRevenueViewScope=scopeKey();
      }catch(rankError){
        // Revenue order is an optional read-only preflight. An unavailable or
        // inconsistent ranking service must not block an explicit publication
        // request built from the CURRENT administrator-confirmed section board.
        // Do not write any ranking values or adjust placement on failure.
        sectionRevenueView={};sectionRevenueViewScope='';
        var rankNotice=$('productFrontSyncState');
        if(rankNotice){rankNotice.className='front-sync-state warn';rankNotice.textContent='수익 순위 재조회가 지연되어 기존 관리자 확정 배치 순서를 보존한 채 Front Match를 계속합니다. 순위 원장은 변경하지 않습니다. '+text(rankError&&rankError.message);}
      }
      targetRows=capFrontReplacementRows(targetRows,replacementScopeKeys);
      targetRows.forEach(function(row){var id=frontCandidateLedgerId(row),order=sectionRevenueView[id];if(authoritativeBoardById[id]&&order&&order.sectionKey===assignedSectionKey(row))authoritativeBoardById[id].priority=Number(order.priority||0);});
    }
    // Server relations (candidate, assignment, publication, SearchBank/Snapshot)
    // are keyed by gslot candidate id, not by the research/original product id.
    var targetIds=Array.from(new Set(targetRows.map(frontCandidateLedgerId).filter(Boolean)));
    if(!targetIds.length&&!replacementRun){show(unmatch?'선택 범위에 매칭 해제할 상품이 없습니다.':'현재 선택 범위에 매칭할 상품이 없습니다.','warn');return;}
    // An administrator can intentionally clear every real-product slot in a
    // fully loaded section. Keep this explicit; a failed/partial ledger read
    // must never masquerade as an empty board and wipe public merchandise.
    var verifiedEmptyReplacement=replacementRun&&targetIds.length===0;
    if(verifiedEmptyReplacement){
      if(!currentLedger||!currentLedger.pipeline||currentLedger.pipeline.ledgerLoadComplete!==true||currentLedger.pipeline.source!=='direct_management_ledger'){
        show('관리자 전체 원장을 검증하지 못해 빈 섹션 프론트 매칭을 중단합니다.','fail');return;
      }
      var emptyScopeLabel=sectionMode?sectionLabel(sectionKey):(sectionsMode?'선택 '+selectedSections.length+'개 섹션':'20개 전체 섹션');
      if(!window.confirm(emptyScopeLabel+'에 실제 배치된 상품이 0건입니다.\n\n기존 공개 Snapshot도 이 빈 관리자 배치에 맞춰 다시 생성하고, 해당 상품 슬롯은 샘플 카드로 표시합니다. 진행하시겠습니까?'))return;
    }
    var explanation=unmatch?label+'의 기존 프론트 매칭 해제를 요청합니다.':label+'을 현재 전체 상품 후보·배치 관리 목록의 상태로 치환합니다. 선택 범위의 기존 프론트 공개 원장은 현재 관리자 배치 목록과 비교해 오래된 항목을 공개 해제하고, 현재 배치된 상품만 공개 대상으로 다시 확정합니다. 관리자 후보·배치 원장 자체는 절대 수정하지 않으며 빈 슬롯은 기존 샘플 fallback 정책을 유지합니다.';
    if(unmatch&&!window.confirm(explanation+'\n\n현재 공개 중인 상품의 매칭을 해제하시겠습니까?'))return;
    productFrontSyncActive=true;
    var state=$('productFrontSyncState'),batchSize=8,maxConcurrent=2,requestTimeout=75000,aggregate={requested:0,queued:0,persisted:0,pendingBuild:0,blocked:0,revalidated:0,remoteChecked:0,freshReused:0,invalid:0,inconclusive:0,withdrawn:0,changedSection:0,items:[],persistedCandidateIds:[],changedCandidateIds:[],preparation:{requested:0,prepared:0,blocked:0},batchErrors:[]},publishPersistedMap={},changedMap={},completed=0,managementCommit={changedCount:0,changedCandidateIds:[],movedCandidateIds:[],releasedCandidateIds:[]};
    if(state){state.className='front-sync-state running';state.textContent=label+' '+(unmatch?'매칭 해제':'프론트 실상품 매칭')+' · '+(verifiedEmptyReplacement?'빈 섹션의 공개 Snapshot을 재구성합니다.':targetIds.length+'건을 처리합니다. 최근 정상 검증은 재사용하고 필요한 상품만 다시 확인합니다.');}
    syncFrontSelectionControls();
    try{
      // CRITICAL AUTHORITY RULE: Front Match is publish-only.
      // It must never save, infer, repair, or rewrite administrator management choices.
      // Any manual change in the 20-section board must be committed by that board's own
      // explicit management control before this publication command is allowed to consume it.
      var action=unmatch?'product_front_unmatch':'product_front_match',batches=[];
      for(var offset=0;offset<targetIds.length;offset+=batchSize)batches.push({offset:offset,ids:targetIds.slice(offset,offset+batchSize)});
      var nextBatch=0;
      async function requestFrontBatch(batch){
        var lastError=null;
        for(var attempt=0;attempt<2;attempt++){
          try{var boardItems=batch.map(function(id){return authoritativeBoardById[id]||null;}).filter(Boolean);return await api(CONTROL,action,'POST',{}, {countryCode:frontMatchCountry,subdivisionCode:frontMatchRegion,mode:'candidates',candidateIds:batch,ledgerMode:'candidate',confirmation:confirmation,deferRelease:true,scopeRefresh:false,compactResponse:true,reuseFreshValidation:true,freshValidationMinutes:720,authoritativeBoardSnapshot:true,authoritativeBoardItems:boardItems},requestTimeout);}
          catch(error){lastError=error;if(!isGatewayDelay(error)||attempt>0)throw error;if(state){state.className='front-sync-state running';state.textContent=label+' · 일시적인 게이트웨이 지연을 감지했습니다. 저장 원장을 버리지 않고 같은 묶음을 1회 재확인합니다.';}await new Promise(function(resolve){setTimeout(resolve,1200);});}
        }
        throw lastError||new Error('front_batch_failed');
      }
      async function processBatch(batchInfo){
        if(scopeKey()!==frontMatchScope)throw new Error('국가·지역 변경으로 프론트 매칭 중단');
        var batch=batchInfo.ids;
        try{
          var part=await requestFrontBatch(batch);
          var r=part.frontSyncResult||{},p=r.preparation||{},refresh=r.refresh||{};
          aggregate.requested+=Number(r.requested||p.requested||batch.length);aggregate.queued+=Number(r.queued||0);aggregate.persisted+=Number(r.persisted||0);aggregate.pendingBuild+=Number(r.pendingBuild||0);aggregate.blocked+=Number(r.blocked||p.blocked||0);aggregate.revalidated+=Number(refresh.revalidated||0);aggregate.remoteChecked+=Number(refresh.remoteChecked||0);aggregate.freshReused+=Number(refresh.freshReused||0);aggregate.invalid+=Number(refresh.invalid||0);aggregate.inconclusive+=Number(refresh.inconclusive||0);aggregate.withdrawn+=Number(refresh.withdrawn||refresh.withdrawRequested||0);aggregate.changedSection+=Number(refresh.changedSection||0);aggregate.items=aggregate.items.concat(Array.isArray(r.items)?r.items:[]);aggregate.preparation.requested+=Number(p.requested||0);aggregate.preparation.prepared+=Number(p.prepared||0);aggregate.preparation.blocked+=Number(p.blocked||0);aggregate.release=r.release||aggregate.release;
          (Array.isArray(r.items)?r.items:[]).forEach(function(item){var id=text(item&&item.candidateId),status=text(item&&item.status).toLowerCase();if(!id||!item||item.persisted!==true)return;changedMap[id]=true;if(!unmatch&&status==='publish_requested')publishPersistedMap[id]=true;});
          // The preparation ledger is the durable authority.  Do not let a
          // compact/repair response omit the final build simply because its
          // item array used a different status label.
          (Array.isArray(p.preparedCandidateIds)?p.preparedCandidateIds:[]).forEach(function(id){id=text(id);if(!id)return;changedMap[id]=true;if(!unmatch)publishPersistedMap[id]=true;});
          (Array.isArray(refresh.withdrawCandidateIds)?refresh.withdrawCandidateIds:[]).forEach(function(id){id=text(id);if(id)changedMap[id]=true;});
        }catch(batchFailure){
          aggregate.batchErrors.push({offset:batchInfo.offset,candidateIds:batch.slice(),message:text(batchFailure&&batchFailure.message)||'batch_failed'});aggregate.blocked+=batch.length;aggregate.items.push.apply(aggregate.items,batch.map(function(id){return{candidateId:id,status:'batch_failed',queued:false,persisted:false,reason:text(batchFailure&&batchFailure.message)||'batch_failed'};}));
        }finally{
          completed+=batch.length;
          if(state){state.className='front-sync-state running';state.textContent=label+' · '+Math.min(completed,targetIds.length)+'/'+targetIds.length+'건 저장 처리 · 최근 검증 재사용 '+aggregate.freshReused+'건 · 실제 재확인 '+aggregate.remoteChecked+'건 · 오류 묶음 '+aggregate.batchErrors.length+'건';}
        }
      }
      async function worker(){while(true){var index=nextBatch++;if(index>=batches.length)return;await processBatch(batches[index]);}}
      var workers=[];for(var w=0;w<Math.min(maxConcurrent,batches.length);w++)workers.push(worker());await Promise.all(workers);

      aggregate.persistedCandidateIds=Object.keys(publishPersistedMap);aggregate.changedCandidateIds=Array.from(new Set(Object.keys(changedMap).concat(managementCommit.changedCandidateIds||[])));
      // Finalize uses the same complete administrator-board snapshot read at click time.
      // A failed batch cannot authorize removal of published products missing
      // from that partial result. Finalize successfully prepared rows only,
      // without any scope-wide replacement cleanup, on partial failure.
      var replacementAllowed=replacementRun&&aggregate.batchErrors.length===0&&aggregate.blocked===0;
      var needsFinalize=aggregate.persistedCandidateIds.length>0||aggregate.changedCandidateIds.length>0||aggregate.withdrawn>0||Number(managementCommit.changedCount||0)>0||replacementAllowed;
      if(needsFinalize){
        if(scopeKey()!==frontMatchScope)throw new Error('국가·지역 변경으로 프론트 최종 배포를 중단했습니다.');
        try{
          if(state){state.className='front-sync-state running';state.textContent=label+' · 원장 저장 완료 · 전체 변경분 스냅샷 갱신을 마지막에 1회 요청 중';}
          var finalizeOperation=unmatch?'unmatch':(aggregate.persistedCandidateIds.length?'match':'refresh'),finalizeIds=Array.from(new Set((aggregate.persistedCandidateIds.length?aggregate.persistedCandidateIds:aggregate.changedCandidateIds).concat(managementCommit.changedCandidateIds||[])));
          var replacementSectionKeys=replacementAllowed?(mode==='all'?PRODUCT_SECTIONS.map(function(section){return section.key;}):(sectionMode?[sectionKey]:selectedSections.slice())):[];
          var replacementRows=replacementAllowed?capFrontReplacementRows(authoritativeBoardRows.filter(function(row){var key=assignedSectionKey(row);return productDecision(row)==='slot_candidate'&&!!key&&(mode==='all'||replacementSectionKeys.indexOf(key)>=0);}),replacementSectionKeys):[];
          var replacementCandidateIds=replacementRows.map(frontCandidateLedgerId).filter(Boolean);
          replacementCandidateIds=Array.from(new Set(replacementCandidateIds));
          var finalized=await api(CONTROL,'product_front_finalize','POST',{}, {countryCode:frontMatchCountry,subdivisionCode:frontMatchRegion,operation:finalizeOperation,confirmation:unmatch?'SITE_UNPUBLISH':'SITE_PUBLISH',candidateIds:finalizeIds,changedCount:Math.max(aggregate.changedCandidateIds.length,aggregate.withdrawn,aggregate.persistedCandidateIds.length),ledgerMode:'candidate',compactResponse:true,publicationReplacement:replacementAllowed,authoritativeReplacement:replacementAllowed,explicitReplacementCleanup:replacementAllowed,replacementSectionKeys:replacementSectionKeys,replacementCandidateIds:replacementCandidateIds,allowVerifiedEmptyReplacement:verifiedEmptyReplacement&&replacementAllowed},90000);
          var finalResult=finalized.frontSyncResult||{},finalRelease=finalResult.release||{};aggregate.finalize=finalResult;aggregate.release=finalRelease;if(finalRelease.queued===true){aggregate.queued=1;aggregate.pendingBuild=0;}else{aggregate.queued=0;aggregate.pendingBuild=Math.max(1,Number(finalResult.pendingBuild||aggregate.changedCandidateIds.length||aggregate.persistedCandidateIds.length||1));}
        }catch(finalizeFailure){var finalizeMessage=text(finalizeFailure&&finalizeFailure.message)||'finalize_failed';aggregate.queued=0;aggregate.pendingBuild=Math.max(1,aggregate.pendingBuild||aggregate.changedCandidateIds.length||aggregate.persistedCandidateIds.length||1);aggregate.batchErrors.push({offset:'finalize',candidateIds:aggregate.changedCandidateIds.slice(),message:finalizeMessage});if(state){state.className='front-sync-state warn';state.textContent=label+' · 최종 스냅샷 빌드 호출 전 중단: '+finalizeMessage;}}
      }
      // One click is the whole operation. Reflect only successful per-ID
      // persistence acknowledgments in the existing in-memory board. Then
      // check static front snapshots automatically without a full second
      // candidate scan or any manual refresh button.
      if(scopeKey()!==frontMatchScope)throw new Error('국가·지역 변경으로 결과 반영 중단');
      var autoReadbackCount=reflectFrontSyncAcknowledgments(aggregate,unmatch,frontMatchScope);
      var autoReadbackIds=unmatch?
        (aggregate.items||[]).filter(function(item){return item&&item.persisted===true;}).map(function(item){return text(item.candidateId);}):
        aggregate.persistedCandidateIds.slice();
      var result=aggregate,requested=Number(result.requested||0),prepared=Number(result.preparation&&result.preparation.prepared||0),queued=Number(result.queued||0),persisted=Number(result.persisted||0),pendingBuild=Number(result.pendingBuild||0),blocked=Number(result.blocked||0),reasonCounts={};
      (Array.isArray(result.items)?result.items:[]).forEach(function(item){if(!item||item.queued===true||item.persisted===true)return;var reason=text(item.reason)||text(item.status)||'blocked';reasonCounts[reason]=(reasonCounts[reason]||0)+1;});
      var topReasons=Object.keys(reasonCounts).sort(function(a,b){return reasonCounts[b]-reasonCounts[a];}).slice(0,3).map(function(reason){return reason+' '+reasonCounts[reason]+'건';}),reasonText=topReasons.length?' · 주요 차단: '+topReasons.join(' / '):'',batchErrorCount=result.batchErrors.length;
      var detail=' · 검증 재사용 '+Number(result.freshReused||0)+'건 · 실제 재확인 '+Number(result.remoteChecked||0)+'건 · 삭제/불량 '+Number(result.invalid||0)+'건 · 일시 확인보류 '+Number(result.inconclusive||0)+'건 · 기존 매칭 제거 '+Number(result.withdrawn||0)+'건 · 공개원장 준비 '+prepared+'건 · 원장 변경 '+result.changedCandidateIds.length+'건'+(queued?' · 최종 스냅샷 빌드 호출 1회':'')+(pendingBuild?' · 다음 배포 대기 '+pendingBuild+'건':'');
      if(state){state.className='front-sync-state '+(batchErrorCount||blocked||pendingBuild||queued?'warn':'complete');state.textContent=label+' · 요청 '+requested+'/'+targetIds.length+'건 · 원장 변경 '+result.changedCandidateIds.length+'건 · 빌드 호출 '+queued+'건 · 차단 '+blocked+'건'+detail+reasonText+(batchErrorCount?' · 묶음 오류 '+batchErrorCount+'건(나머지는 계속 처리됨)':'')+' · 관리자 화면 자동 갱신 '+autoReadbackCount+'건'+(queued?' · 프론트 빌드 자동 확인 중':'');}
      var message=(unmatch?'프론트 매칭 해제 요청':'프론트 실상품 갱신 요청')+' '+requested+'/'+targetIds.length+'건 처리 · 검증 재사용 '+Number(result.freshReused||0)+'건 · 실제 재확인 '+Number(result.remoteChecked||0)+'건 · 삭제/불량 '+Number(result.invalid||0)+'건 · 기존 매칭 제거 '+Number(result.withdrawn||0)+'건 · 원장 변경 '+result.changedCandidateIds.length+'건.';
      if(queued)message+=' 전체 변경분의 스냅샷 빌드 요청이 수락됐으며, 실제 공개 상태는 자동으로 확인합니다. 별도 원장 새로고침은 필요하지 않습니다.';if(pendingBuild)message+=' 다음 정상 배포 대기 '+pendingBuild+'건.';if(blocked)message+=' 안전 게이트/묶음 차단 '+blocked+'건.'+reasonText;if(batchErrorCount)message+=' 묶음 오류 '+batchErrorCount+'건은 기록했으며 다른 상품 처리는 중단하지 않았습니다.';show(message,batchErrorCount||blocked||pendingBuild||queued?'warn':'ok');
      if(queued){
        frontMatchDeploymentBusy=true;syncFrontSelectionControls();
        // Passive checking occurs after the current command has completed;
        // no second button, no second candidate write, no second ledger scan.
        var checkSections=mode==='section'?[sectionKey]:(mode==='sections'?selectedSections.slice():(mode==='all'?null:null));
        var expectedReadbackSections={};autoReadbackIds.forEach(function(id){if(authoritativeBoardById[id])expectedReadbackSections[id]=authoritativeBoardById[id].sectionKey;});
        startAutomaticFrontSnapshotCheck(frontMatchScope,autoReadbackIds,unmatch,state,label,checkSections,expectedReadbackSections);
      }
    }catch(error){
      var frontFailure=conciseRequestError(error&&error.message,error&&error.status)||'프론트 매칭 처리 중단';
      if(state){state.className='front-sync-state warn';state.textContent='프론트 매칭 중단 · '+frontFailure;}
      show(frontFailure,'fail');
    }finally{productFrontSyncActive=false;renderProducts(productRows);syncFrontSelectionControls();}
  }

  function readProductPauseAutoQueue(){try{return localStorage.getItem(PRODUCT_PAUSE_AUTO_QUEUE_KEY)==='1';}catch(_e){return false;}}
  function saveProductPauseAutoQueue(value){productPauseAutoQueue=value===true;try{localStorage.setItem(PRODUCT_PAUSE_AUTO_QUEUE_KEY,productPauseAutoQueue?'1':'0');}catch(_e){}syncProductQueueStageControls();}
  function ensureProductQueueStageControls(){
    var ai=$('productAiAutoBtn');if(!ai||!ai.parentNode)return;
    var actions=ai.parentNode,manual=$('productQueueStageCurrentBtn'),auto=$('productQueueAutoBtn');
    if(!manual){manual=document.createElement('button');manual.id='productQueueStageCurrentBtn';manual.type='button';manual.className='secondary';manual.disabled=true;manual.textContent='현재 조사분 후보 관리목록 등록';actions.insertBefore(manual,ai);}
    if(!auto){auto=document.createElement('button');auto.id='productQueueAutoBtn';auto.type='button';auto.className='ghost';auto.textContent='일시정지 자동 대기열: OFF';actions.insertBefore(auto,ai);}
    if(!$('productQueueStageState')){var state=document.createElement('div');state.id='productQueueStageState';state.className='product-auto-state';state.textContent='리서치 완료 후 또는 서버 일시정지 확인 후 현재 조사분 후보 관리목록 등록 버튼이 활성화됩니다. 리서치와 대기열 저장은 서로 분리되어 동시에 DB를 쓰지 않습니다.';var anchor=$('productAiAutomationState');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(state,anchor);else actions.parentNode.insertBefore(state,actions.nextSibling);}
    productPauseAutoQueue=readProductPauseAutoQueue();
  }
  function currentResearchQueueEligible(data){data=data||lastProductJson||{};return Number(data.summary&&data.summary.privateResearchQueueEligible||data.pipeline&&data.pipeline.partialQueue&&data.pipeline.partialQueue.eligible||0);}
  function currentResearchQueueInspected(data){data=data||lastProductJson||{};return Number(data.summary&&data.summary.inspected||0);}
  function syncProductQueueStageControls(){
    var manual=$('productQueueStageCurrentBtn'),auto=$('productQueueAutoBtn'),state=$('productQueueStageState'),pauseButton=$('productResearchPauseBtn'),status=text(lastProductJson&&lastProductJson.status),eligible=currentResearchQueueEligible(lastProductJson),inspected=currentResearchQueueInspected(lastProductJson),stageSummary=lastProductJson&&lastProductJson.pipeline&&lastProductJson.pipeline.stageSummary||{},failed=Number(stageSummary.failed||0),readyState=(productPausedForQueue&&productPauseServerConfirmed)||status==='complete',resumable=['discovering','inspecting','staging'].indexOf(status)>=0;
    if(manual)manual.disabled=productQueueStageActive||productLoopActive||!selectedCountry||!readyState||Math.max(eligible,inspected)<=0;if(pauseButton)pauseButton.disabled=!selectedCountry||productQueueStageActive||!resumable||(productPausedForQueue&&productPauseServerConfirmed);
    if(auto){auto.disabled=productQueueStageActive||!selectedCountry;auto.textContent='일시정지 자동 대기열: '+(productPauseAutoQueue?'ON':'OFF');}
    if(state&&!productQueueStageActive){state.textContent=status==='complete'?'리서치 완료 · 검증 완료 상품 '+Math.max(eligible,inspected)+'건 · 현재 조사분 후보 관리목록 등록 버튼으로 비공개 대기열에 등록할 수 있습니다.':(productPausedForQueue&&productPauseServerConfirmed?'서버 일시정지 확인 완료 · 현재까지 검증 완료 상품 '+Math.max(eligible,inspected)+'건 · '+(productPauseAutoQueue?'자동 후보 관리목록 등록 ON':'현재 조사분 수동 등록 가능'):'리서치 진행 중 · 후보 관리목록 등록은 완료 또는 서버 일시정지 확인 뒤 활성화됩니다.');}
  }
  function productPauseCheckpoint(){var row=lastProductJson||{};return{jobId:row.jobId||null,status:row.status||'not_started',startedAt:row.startedAt||null,finishedAt:row.finishedAt||null,updatedAt:row.updatedAt||null,scope:scopeSnapshot('product-pause'),progress:row.progress||{},summary:row.summary||{},pipeline:row.pipeline||{},lastError:row.lastError||null};}
  async function requestProductPause(){
    if(!selectedCountry||productStopRequested)return productPauseServerConfirmed;var requested=scopeSnapshot(),button=$('productResearchPauseBtn');productStopRequested=true;productPausedForQueue=true;productPauseServerConfirmed=false;if(button)button.disabled=true;syncProductQueueStageControls();if($('productResearchState'))$('productResearchState').textContent='상품 조사 일시정지 요청을 별도 실행 원장에 저장하고 현재 처리 중인 한 묶음의 안전 종료를 기다리는 중입니다.';
    var saved=false,lastError=null;
    for(var attempt=0;attempt<3&&!saved;attempt++){
      try{var result=await api(CONTROL,'product_research_pause_control','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,jobId:lastProductJson&&lastProductJson.jobId||'',mode:'pause',automaticQueue:productPauseAutoQueue,checkpoint:productPauseCheckpoint()},8000);if(result&&result.pause&&result.pause.paused===true){lastProductJson=Object.assign({},lastProductJson||{},{pause:result.pause});productPauseServerConfirmed=true;saved=true;}}
      catch(e){lastError=e;if(attempt<2)await new Promise(function(resolve){setTimeout(resolve,400+attempt*500);});}
    }
    if(saved){show('일시정지 요청을 별도 실행 원장에 저장했습니다. 현재 처리 중인 묶음까지만 정리한 뒤 '+(productPauseAutoQueue?'검증 완료분을 자동 후보 관리목록 등록합니다.':'수동 후보 관리목록 등록 버튼을 활성화합니다.'),'warn');}
    else{show((text(lastError&&lastError.message)||'일시정지 제어 요청 응답이 지연됐습니다.')+' 브라우저의 중단 요청은 유지하고, 현재 묶음이 끝난 뒤 서버의 일시정지 저장을 다시 확인합니다.','warn');}
    syncProductQueueStageControls();return saved;
  }
  async function confirmProductPauseAfterLoop(requested){
    if(!productStopRequested)return true;if(productPauseServerConfirmed)return true;var checkpoint=productPauseCheckpoint(),jobId=lastProductJson&&lastProductJson.jobId||'';
    for(var attempt=0;attempt<3;attempt++){
      try{var result=await api(CONTROL,'product_research_pause_control','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,jobId:jobId,mode:'pause',automaticQueue:productPauseAutoQueue,checkpoint:checkpoint},8000);if(result&&result.pause&&result.pause.paused===true){productPauseServerConfirmed=true;productPausedForQueue=true;lastProductJson=Object.assign({},lastProductJson||{},{pause:result.pause});return true;}}
      catch(_pauseConfirmError){}
      try{var saved=await loadProductResearchCompact(requested.country,requested.region);if(saved&&saved.pause&&saved.pause.paused===true){lastProductJson=mergeCompactProductStatus(saved);productPauseServerConfirmed=true;productPausedForQueue=true;return true;}}catch(_pauseStatusError){}
      if(attempt<2)await new Promise(function(resolve){setTimeout(resolve,600*(attempt+1));});
    }
    productPauseServerConfirmed=false;return false;
  }
  async function stageCurrentResearchQueue(options){
    options=options||{};if(!selectedCountry||productQueueStageActive)return null;
    var requested=options.requested||scopeSnapshot(),requestedKey=scopeKey(requested),state=$('productQueueStageState'),automatic=options.automatic===true,lastResult=null,totalAttempted=0,totalHandled=0,totalFailed=0,previousRemaining=null,stalled=0,maxPasses=320;
    productQueueStageActive=true;var stageCandidateIds={};syncProductQueueStageControls();
    if(state)state.textContent=(automatic?'일시정지 자동 후보 관리목록 등록':'현재 조사분 수동 후보 관리목록 등록')+'을 시작합니다. 상품 점검이 완료된 항목만 10건 단위로 안전 등록합니다.';
    try{
      for(var pass=0;pass<maxPasses;pass++){
        if(scopeKey()!==requestedKey)throw new Error('후보 관리목록 등록 중 선택 범위가 변경됐습니다.');
        var result=null,requestError=null;
        for(var attempt=0;attempt<3&&!result;attempt++){
          try{result=await api(CONTROL,'product_research_stage_current','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,source:automatic?'pause_auto':'administrator_manual'},20000);}
          catch(e){requestError=e;var status=Number(e&&e.status||0);if([502,504,521,524].indexOf(status)>=0){throw new Error('서버 응답 지연('+status+') · 저장 성공 여부가 불확실하여 자동 재등록을 중단했습니다. 원장 재조회 후 남은 후보만 다시 실행하세요.');}if(attempt<2)await new Promise(function(resolve){setTimeout(resolve,600*(attempt+1));});}
        }
        if(!result)throw requestError||new Error('현재 조사분 후보 관리목록 등록 요청이 중단됐습니다.');
        var part=result&&result.partialQueue||{};lastResult=result;(Array.isArray(part.candidateIds)?part.candidateIds:[]).forEach(function(id){id=text(id);if(id)stageCandidateIds[id]=true;});
        if(part.migration===true){
          if(state)state.textContent='기존 대용량 상품 원장을 국가·지역 분할 원장으로 안전 전환 중 · '+Number(part.migrated||0)+'/'+Number(part.migrationTotal||0)+'건 · 리서치 진행점과 기존 후보 원장은 유지됩니다.';
          previousRemaining=null;stalled=0;await new Promise(function(resolve){setTimeout(resolve,180);});continue;
        }
        totalAttempted+=Number(part.attempted||0);totalHandled+=Number(part.handled||0);totalFailed+=Number(part.failed||0);
        var remaining=Number(part.remaining||0);if(state)state.textContent=(automatic?'자동':'수동')+' 후보 관리목록 등록 · 처리 '+Number(part.done||0)+'/'+Number(part.eligible||0)+' · 남음 '+remaining+(Number(part.failed||0)?' · 이번 등록 실패 '+Number(part.failed||0):'');
        if(part.complete===true||remaining<=0)break;
        if(previousRemaining!=null&&remaining>=previousRemaining&&Number(part.handled||0)<=0)stalled+=1;else stalled=0;previousRemaining=remaining;
        if(stalled>=4)throw new Error('후보 관리목록 등록이 반복 정체되어 저장된 체크포인트를 유지한 채 안전 중단했습니다.');
        if(Number(part.attempted||0)<=0){await new Promise(function(resolve){setTimeout(resolve,220);});continue;}
        await new Promise(function(resolve){setTimeout(resolve,180);});
      }
      if(lastResult&&lastResult.partialQueue&&lastResult.partialQueue.complete!==true&&Number(lastResult.partialQueue.remaining||0)>0)throw new Error('대기열 안전 반복 한도에 도달했습니다. 현재 저장 지점부터 다시 실행할 수 있습니다.');
      try{var saved=await loadProductResearchCompact(requested.country,requested.region);if(saved&&saved.status&&saved.status!=='not_started'){lastProductJson=mergeCompactProductStatus(saved);renderProductProgress(lastProductJson);rememberReport('product',lastProductJson);saveReviewSnapshot();}}catch(_statusError){}
      try{if(Number(lastProductJson&&lastProductJson.summary&&lastProductJson.summary.latestResearchProducts||0)>0)await refreshLatestResearchRows(requested.country,requested.region,{state:state,label:'최신 상품 리서치 목록'});}catch(_latestRefreshError){}
      var ledgerReadback=null;try{ledgerReadback=await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});}catch(ledgerError){throw new Error('후보 등록 서버 응답 후 원장 재조회 실패: '+text(ledgerError&&ledgerError.message));}
      if(!(ledgerReadback&&ledgerReadback.pipeline&&ledgerReadback.pipeline.ledgerLoadComplete===true))throw new Error('후보 등록 후 전체 원장 조회 미완료 · 등록 성공으로 확정하지 않았습니다.');
      var confirmedStageIds=Object.keys(stageCandidateIds).filter(function(id){return productRows.some(function(row){return row&&row.ledgerSource==='candidate'&&frontCandidateLedgerId(row)===id&&productDecision(row)==='undecided';});});
      latestInCandidateRememberIds(confirmedStageIds,requestedKey);
      renderLatestResearchCandidateGroup();
      lastScopeAuditJson=null;
      if(activeScopeAudit==='queue'){try{var queueAudit=await api(REVIEW,'diagnostic','GET',scopeParams());queueAudit.scope=auditScopeOf(queueAudit);renderScopeAudit(queueAudit,'queue');}catch(_queueAuditRefreshError){}}
      if(state){var remainingFinal=Number(lastResult&&lastResult.partialQueue&&lastResult.partialQueue.remaining||0);state.textContent=(automatic?'일시정지 자동':'현재 조사분 수동')+' 후보 관리목록 등록 '+(remainingFinal?'부분 완료':'완료')+' · 이번 요청 '+totalAttempted+'건 · 반영 '+totalHandled+'건'+(totalFailed?' · 실패 '+totalFailed+'건':'')+(remainingFinal?' · 남음 '+remainingFinal+'건':'');}
      var newlyStored=confirmedStageIds.length;
      show('선택 국가·지역 '+requestedKey+' · 실제 후보 원장 저장 확인 '+newlyStored+'건 · 이번 처리 '+totalHandled+'건.'+(newlyStored===0?' 이미 저장된 상품이거나 검증·이미지·상세URL 확인 대기입니다.':'' )+(totalFailed?' 실패 '+totalFailed+'건은 다음 등록에서 재시도할 수 있습니다.':''),totalFailed||!newlyStored?'warn':'ok');
      return lastResult;
    }catch(e){if(state)state.textContent='현재 조사분 후보 관리목록 등록 중단: '+conciseRequestError(e&&e.message,e&&e.status);show(conciseRequestError(e&&e.message,e&&e.status),'warn');return null;}
    finally{productQueueStageActive=false;syncProductQueueStageControls();}
  }

  async function runProductResearch(options){
    options=options||{};if(!selectedCountry||productLoopActive)return;
    var requested=scopeSnapshot(),requestedKey=scopeKey(requested);
    if(lastProductJson&&text(lastProductJson.status)==='candidate_ledger'){
      try{var savedResearch=await loadProductResearchCompact(requested.country,requested.region);if(savedResearch&&['discovering','inspecting','staging'].indexOf(text(savedResearch.status))>=0&&savedResearch.progress&&savedResearch.progress.resumable===true){lastProductJson=mergeCompactProductStatus(savedResearch);renderProductProgress(lastProductJson);rememberReport('product',lastProductJson);saveReviewSnapshot();}}catch(_savedResearchError){}
    }
    var serverPaused=!!(lastProductJson&&lastProductJson.pause&&lastProductJson.pause.paused===true),serverResumable=!!(lastProductJson&&lastProductJson.progress&&lastProductJson.progress.resumable===true),resumePaused=(productPausedForQueue===true||serverPaused||serverResumable)&&lastProductJson&&['discovering','inspecting','staging'].indexOf(text(lastProductJson.status))>=0,hasPriorResearch=!!(lastProductJson&&lastProductJson.status&&lastProductJson.status!=='not_started');
    if(hasPriorResearch&&!resumePaused&&!options.automatic&&!window.confirm('기존 상품과 관리자 판정은 그대로 보존합니다. 이미 정상 조사된 업체는 중복 전체 재조사하지 않고, 새로 등록된 업체와 이전에 상품을 찾지 못했거나 일시 지연된 업체만 보완 조사합니다. 계속하시겠습니까?'))return;
    hide();productStopRequested=false;productLoopActive=true;if(!resumePaused){productPausedForQueue=false;productPauseServerConfirmed=false;}var button=$('productResearchBtn');button.disabled=true;button.textContent='신규·미확인 상품 조사 진행 중';setButtonEnabled('productResearchPauseBtn',true);if($('productResearchState'))$('productResearchState').textContent=(options.automatic?'공급업체 검증 완료 후 신규·미확인 상품 조사를 자동으로 시작했습니다. ':'')+'관리자가 선택한 '+requested.country+' 범위를 현재 접속 IP와 무관하게 조사합니다. 이미 정상 조사된 업체는 기존 결과를 보존하고 중복 전체 재조사를 하지 않습니다. 새로 등록된 업체와 이전에 상품을 찾지 못했거나 일시 지연된 업체만 다시 조사하며, 동일 상품은 중복 생성하지 않고 신규 상품만 후보 원장에 추가합니다.';
    var researchFailureText='',pauseAutoStageAfterLoop=false;
    try{
      var data;
      if(resumePaused){
        // Refresh the CURRENT supplier ledger before resuming old discovery.
        // A supplier added while the previous job was paused would otherwise
        // never enter this cycle until a second manual start.
        if($('productResearchState'))$('productResearchState').textContent='기존 상품 조사 재개 전에 신규 공급업체 원장을 대조합니다.';
        var supplierRefresh=await api(CONTROL,'product_research_begin','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,refreshSources:true,refreshExisting:true,fullRescan:false,compact:true,scopeAuthority:'administrator-selected',ignoreRequestGeo:true},20000);
        if(supplierRefresh&&(text(supplierRefresh.jobId)!==text(lastProductJson&&lastProductJson.jobId)||supplierRefresh.status==='complete')){
          // Another operator may have finished the paused job while this page
          // kept an older checkpoint. Use the CURRENT server job, never resume
          // or overwrite a job with an obsolete job ID.
          data=supplierRefresh;productPausedForQueue=false;productPauseServerConfirmed=false;
        }else{
          // Resume is a durable server transition. Do not continue a paused job
          // until the small runtime control row confirms resume.
          await api(CONTROL,'product_research_pause_control','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,jobId:text(supplierRefresh&&supplierRefresh.jobId)||text(lastProductJson&&lastProductJson.jobId),mode:'resume',scopeAuthority:'administrator-selected',ignoreRequestGeo:true},8000);
          data=await loadProductResearchCompact(requested.country,requested.region);productPausedForQueue=false;productPauseServerConfirmed=false;
          if($('productResearchState'))$('productResearchState').textContent='서버에 저장된 상품 리서치를 저장된 진행 지점부터 계속합니다. 이미 대기열에 등록한 상품은 중복 생성하지 않습니다.';
        }
      }else{
        var baselineData=await refreshCandidateLedgerProducts({preserveResearchReport:true,readOnlyLedgerRefresh:true}),baselineCount=Array.isArray(baselineData&&baselineData.products)?baselineData.products.length:productRows.length;
        if($('productResearchState'))$('productResearchState').textContent='1차 · 저장된 상품 후보 원장 '+baselineCount+'건 유지 완료 · 2차 · 현재 책임 공급업체 비공개 후보 전체의 공식 상품 리서치를 시작합니다. 기존 업체도 재확인하고 신규 업체는 별도 집계합니다.';
        data=await api(CONTROL,'product_research_begin','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,restart:true,retryStaging:false,refreshSources:true,refreshExisting:true,fullRescan:false,compact:true,candidateLedgerBaseline:true,candidateLedgerBaselineCount:baselineCount,scopeAuthority:'administrator-selected',ignoreRequestGeo:true},20000);
      }
      while(true){
        if(scopeKey()!==requestedKey){productStopRequested=true;show('상품 조사 중 선택 범위가 바뀌어 화면 진행을 중단했습니다. 서버 작업은 원래 범위에서 재개할 수 있습니다.','warn');break;}
        if(data&&data.compact===true){lastProductJson=Object.assign({},lastProductJson||{},data,{products:productRows});}
        else{lastProductJson=data;rememberReport('product',data);saveReviewSnapshot();}
        renderProductProgress(lastProductJson);
        if(data.status==='complete'){
          productPausedForQueue=false;productPauseServerConfirmed=false;
          // The completed research cycle is the durable review checkpoint.
          // Do not auto-call product_research_begin here: it archives the just-
          // finished 400+ rows and starts a fresh empty job, making those rows
          // disappear from the latest-results UI before explicit registration.
          // A later operator-initiated research run can include subsequent new
          // suppliers; the current results remain available for review/staging.
          if(data.compact===true){data=await loadProductResearchPaged(requested.country,requested.region,{state:$('productResearchState'),label:'완료 상품 관리 목록'});lastProductJson=data;try{var completedLatest=await loadLatestResearchPaged(requested.country,requested.region,{state:$('productResearchState'),label:'완료 최신 상품 목록',preserveOnFailure:true});if(completedLatest&&Array.isArray(completedLatest.rows)&&(completedLatest.rows.length||completedLatest.complete===true))latestProductRows=completedLatest.rows;}catch(_latestCompleteError){}lastProductJson=Object.assign({},data,{products:productRows,latestProducts:latestProductRows});renderProductProgress(lastProductJson);rememberReport('product',lastProductJson);saveReviewSnapshot();data=lastProductJson;}
          var completedProducts=Array.isArray(data.products)?data.products:productRows,queueEligible=Number(data.summary&&data.summary.privateResearchQueueEligible||0);
          show(completedProducts.length?'상품 리서치를 완료했습니다. 최신 상품 목록을 확인한 뒤 현재 조사분 후보 관리목록 등록 버튼을 누르면 검증 완료 상품 '+queueEligible+'건을 비공개 후보·중개수익 대기열로 순차 등록합니다.':'상품 리서치는 끝났지만 확인 가능한 실제 상품 목록을 만들지 못했습니다. 업체 공식 사이트와 JSON 경로를 점검하세요.',completedProducts.length?'ok':'warn');
          try{await refreshCandidateLedgerProducts({preserveResearchReport:true,atomicLedgerRefresh:true});}catch(_ledgerRefreshError){}
          break;
        }
        if(productStopRequested){productPausedForQueue=true;pauseAutoStageAfterLoop=productPauseAutoQueue===true;show('상품 조사를 일시정지했습니다. 지금까지의 결과는 관리 DB에 보존됐습니다.'+(productPauseAutoQueue?' 현재 처리 중인 요청이 끝난 뒤 검증 완료 상품을 자동으로 비공개 대기열에 등록합니다.':' 현재 조사분 후보 관리목록 등록 버튼으로 수동 등록할 수 있습니다.'),'warn');syncProductQueueStageControls();break;}
        await new Promise(function(resolve){setTimeout(resolve,300);});
        var stepError=null,stepCompleted=false,consecutiveGatewayFailures=0;
        while(!stepCompleted&&consecutiveGatewayFailures<3){
          var beforeMark=productProgressMark(lastProductJson||data);
          try{data=await api(CONTROL,'product_research_step','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,jobId:data.jobId,compact:true,scopeAuthority:'administrator-selected',ignoreRequestGeo:true},20000);stepCompleted=true;}
          catch(requestError){
            stepError=requestError;var resumed=null;
            try{resumed=await loadProductResearchCompact(requested.country,requested.region);if(resumed&&resumed.status!=='not_started'){var afterMark=productProgressMark(resumed);lastProductJson=mergeCompactProductStatus(resumed);renderProductProgress(lastProductJson);rememberReport('product',lastProductJson);saveReviewSnapshot();if(afterMark!==beforeMark||resumed.status==='complete'){data=resumed;stepCompleted=true;break;}}}catch(_resumeError){}
            if(productStopRequested||(resumed&&resumed.pause&&resumed.pause.paused===true)){productPausedForQueue=true;if(resumed&&resumed.pause&&resumed.pause.paused===true)productPauseServerConfirmed=true;data=resumed||lastProductJson||data;stepCompleted=true;break;}
            if(!transientResearchRequestError(requestError))break;
            consecutiveGatewayFailures+=1;
            if(consecutiveGatewayFailures>=3){
              if($('productResearchState'))$('productResearchState').textContent='연속된 502/504/521·네트워크 지연을 감지했습니다. 무거운 요청 재시도를 중단하고 현재 체크포인트를 안전 일시정지로 전환합니다.';
              productPausePersistPromise=requestProductPause();try{await productPausePersistPromise;}catch(_safePauseError){}productPausePersistPromise=null;pauseAutoStageAfterLoop=productPauseAutoQueue===true;data=resumed||lastProductJson||data;stepCompleted=true;break;
            }
            if($('productResearchState'))$('productResearchState').textContent='일시적인 조사 응답 지연을 감지했습니다. 저장된 체크포인트를 확인했습니다. '+consecutiveGatewayFailures+'/3 · 잠시 뒤 다음 묶음을 재시도합니다.';
            await new Promise(function(resolve){setTimeout(resolve,900*consecutiveGatewayFailures);});
          }
        }
        if(!stepCompleted)throw stepError||new Error('상품 조사 단계를 안전 재시도했지만 완료하지 못했습니다.');
      }
    }
    catch(e){
      var recovered=false,saved=null;
      try{saved=await loadProductResearchCompact(requested.country,requested.region);if(saved&&saved.status&&saved.status!=='not_started'){lastProductJson=mergeCompactProductStatus(saved);renderProductProgress(lastProductJson);setButtonEnabled('productResearchDownloadBtn',true);saveReviewSnapshot();recovered=true;}}catch(_statusError){}
      var pauseRecovered=productStopRequested===true||!!(saved&&saved.pause&&saved.pause.paused===true);
      if(pauseRecovered){productPausedForQueue=true;if(saved&&saved.pause&&saved.pause.paused===true)productPauseServerConfirmed=true;pauseAutoStageAfterLoop=productPauseAutoQueue===true;if($('productResearchState'))$('productResearchState').textContent='일시정지 요청을 감지했습니다. 502/504/521 응답이 있었더라도 현재 묶음 종료 후 서버 저장 상태를 재확인합니다.';show('상품 조사 중단 요청을 복구했습니다. 서버 일시정지 저장이 확인된 뒤 '+(productPauseAutoQueue?'검증 완료분을 자동 후보 관리목록 등록합니다.':'현재 조사분 후보 관리목록 등록 버튼을 활성화합니다.'),'warn');}
      else{researchFailureText=(conciseRequestError(e&&e.message,e&&e.status)||'상품 리서치 요청이 중단됐습니다.')+(recovered?' · 서버에 저장된 진행 상태를 복구했습니다.':' · 기존 상품 후보 원장은 그대로 유지됐으며 공급업체 리서치 시작 단계에서 중단됐습니다.');if($('productResearchState'))$('productResearchState').textContent=researchFailureText;show(researchFailureText,'fail');}
    }
    finally{
      if(productPausePersistPromise){try{await productPausePersistPromise;}catch(_pausePersistError){}}
      productPausePersistPromise=null;
      if(productStopRequested&&!productPauseServerConfirmed){var pauseConfirmed=await confirmProductPauseAfterLoop(requested);if(!pauseConfirmed){productPausedForQueue=false;if($('productResearchState'))$('productResearchState').textContent='상품 조사 중단 요청은 유지됐지만 서버 일시정지 원장 저장 확인이 지연되고 있습니다. 후보 관리목록 등록은 중복 작업 방지를 위해 잠시 잠금 상태입니다. 상태 새로고침 후 다시 확인하세요.';show('서버 일시정지 저장을 아직 확인하지 못해 후보 관리목록 등록을 안전 잠금했습니다. 기존 조사 원장은 삭제하지 않습니다.','warn');}}
      productLoopActive=false;button.disabled=false;setButtonEnabled('productResearchPauseBtn',false);
      if((productPausedForQueue&&productPauseServerConfirmed)||text(lastProductJson&&lastProductJson.status)==='complete'){try{await refreshLatestResearchRows(requested.country,requested.region,{state:$('productResearchState'),label:'최신 상품 리서치 목록',preserveOnFailure:true});}catch(_latestPauseRefreshError){}}
      if(!researchFailureText&&productPauseServerConfirmed)renderProductProgress(lastProductJson||{});else if(!researchFailureText&&$('productResearchState')&&productPausedForQueue)$('productResearchState').textContent='상품 조사가 안전하게 일시정지됐습니다. 서버에 저장된 진행점부터 계속할 수 있습니다.';else if(researchFailureText&&$('productResearchState'))$('productResearchState').textContent=researchFailureText;renderProducts(productRows);syncProductQueueStageControls();
      // Queue registration starts only after the research loop has released its
      // active flag AND the durable pause row is confirmed, so the two workloads
      // never contend for the same function/DB after a gateway timeout.
      if(productPausedForQueue&&productPauseServerConfirmed&&pauseAutoStageAfterLoop)await stageCurrentResearchQueue({automatic:true,requested:requested});
    }
  }

  var SIGNAL_LABELS={local_products:'지역 생산품·협동조합',manufacturer_brands:'제조사·브랜드 상품',food_household_essentials:'식품·식료품·생활필수품',beauty_personal_care:'뷰티·개인용품',fashion:'의류·신발·가방',electronics_accessories:'전자제품·액세서리',home_appliances_living:'가전·주방·가구·생활',baby_family_education:'유아·가족·교육',agriculture_fishery_forestry:'농·수·임산물',travel_local_services:'여행·지역 서비스'};
  function renderActiveSignals(status){
    var effective=status&&status.effective||{},sources=Array.isArray(effective.sourcePlans)?effective.sourcePlans:[],weights=effective.categoryWeights||{},active=effective.active===true;
    var top=Object.keys(SIGNAL_LABELS).map(function(key){return{key:key,weight:Number(weights[key])||0};}).sort(function(a,b){return b.weight-a.weight;}).filter(function(row){return row.weight!==0;}).slice(0,3);
    var sourceText=sources.length?sources.map(function(row){return(row.type==='global'?'세계':'권역')+' · 유효 '+esc(row.validUntil||'-')+' · 감쇠 '+esc(row.decay==null?'-':row.decay);}).join(' / '):'적용된 세계·권역 AI 가중치 없음';
    $('activeSignalState').innerHTML=(active?'<span class="pill good">AI 방향 반영 중</span> ':'<span class="pill info">기본 순환</span> ')+sourceText+(top.length?'<br>우선 탐색: '+top.map(function(row){return esc(SIGNAL_LABELS[row.key])+' '+(row.weight>0?'+':'')+esc(row.weight)+'%';}).join(' · '):'');
  }
  function renderSignalReport(data){
    data=data||{};lastSignalReport=data;var scope=data.scope||{},regional=scope.type==='regional',weights=data.categoryWeights||{},signals=Array.isArray(data.signals)?data.signals:[],ai=data.ai||{},evidence=data.evidence||{},apply=data.apply||{},policy=data.policy||{};
    $('signalTitle').textContent=regional?'권역 AI 점검 결과 · '+(scope.regionNameKo||scope.regionNameEn||scope.regionGroup):'전 세계 흐름 AI 점검 결과';
    $('signalOverview').textContent=text(data.overview)||'AI 판단 요약이 없습니다.';
    $('signalMeta').innerHTML='AI '+esc(ai.provider||'-')+' · 확신도 '+esc(ai.confidence||0)+'% · 근거 '+esc(evidence.count||0)+'건 · 적용 기준 '+esc(apply.eligible?'충족':'미충족')+'<br>유효 권고 '+esc(apply.validUntil||'-')+' · 신뢰 게이트 변경 없음 · 상품 자동 반입 없음';
    $('signalWeights').innerHTML=Object.keys(SIGNAL_LABELS).map(function(key){var value=Number(weights[key])||0,cls=value>0?'weight-up':value<0?'weight-down':'weight-zero';return'<div class="weight-row"><span>'+esc(SIGNAL_LABELS[key])+'</span><span class="'+cls+'">'+(value>0?'+':'')+esc(value)+'%</span></div>';}).join('');
    $('signalEvents').innerHTML=signals.length?signals.map(function(row){var audiences=Array.isArray(row.audiences)?row.audiences.join(', '):'',risks=Array.isArray(row.risks)?row.risks.join(', '):'';return'<article class="signal-row"><strong>'+esc(row.title||row.type||'신호')+'</strong> <span class="pill '+(Number(row.confidence)>=75?'good':'info')+'">확신 '+esc(row.confidence||0)+'%</span><div class="small">'+esc(row.geography||'')+(row.horizon?' · '+esc(row.horizon):'')+'<br>'+esc(row.summary||'')+(audiences?'<br>대상층: '+esc(audiences):'')+(risks?'<br>주의: '+esc(risks):'')+'</div></article>';}).join(''):'<div class="small">근거가 충분한 주요 신호가 없습니다.</div>';
    var confidenceMinimum=Number(policy.confidenceMinimum||60),evidenceMinimum=Number(policy.evidenceMinimum||3),nonZero=Object.keys(weights).filter(function(key){return Number(weights[key])!==0;}).length,expired=!!(apply.validUntil&&Date.parse(apply.validUntil)<=Date.now()),reasons=[];
    if(ai.provider!=='openai')reasons.push('OpenAI 구조화 분석 미완료');
    if(Number(ai.confidence||0)<confidenceMinimum)reasons.push('AI 확신도 '+Number(ai.confidence||0)+'% / 최소 '+confidenceMinimum+'%');
    if(Number(evidence.count||0)<evidenceMinimum)reasons.push('확인 근거 '+Number(evidence.count||0)+'건 / 최소 '+evidenceMinimum+'건');
    if(!signals.length)reasons.push('근거에 연결된 유효 신호 없음');
    if(!nonZero)reasons.push('변경할 품목군 비중 없음');
    if(expired)reasons.push('권고 유효기간 만료');
    var eligible=apply.eligible===true&&!expired,reasonsFromServer=Array.isArray(apply.blockingReasons)?apply.blockingReasons:[];if(reasonsFromServer.length)reasons=reasonsFromServer;
    $('applySignalBtn').disabled=!eligible;$('applySignalBtn').title=eligible?'관리자가 확인한 AI 권고를 품목군 탐색 비중에만 반영합니다.':'안전 잠금: '+(reasons.join(' · ')||text(apply.reason)||'적용 기준 미충족');
    var state=$('signalApplyState');if(state){state.className='signal-apply-state '+(eligible?'ready':'blocked');state.textContent=eligible?'운영 반영 가능: 근거·확신도·유효 신호·비중 변화 기준을 통과했습니다. 관리자 확인 후 반영할 수 있습니다.':'운영 반영 안전 잠금: '+(reasons.join(' · ')||text(apply.reason)||'적용 기준을 통과하지 못했습니다.')+' JSON 다운로드와 수동 검토는 계속 가능합니다.';}
    $('signalPanel').classList.remove('hidden');
    rememberReport(data&&data.reportType==='igdc-regional-market-signal-check'?'regional':'global',data);
  }
  function signalProgressElement(type){return $(type==='regional'?'regionalSignalProgress':'globalSignalProgress');}
  function rememberSignalJob(type,data){if(!data)return;var regional=type==='regional';if(regional){lastRegionalJson=data;setButtonEnabled('regionalSignalDownloadBtn',true);}else{lastGlobalJson=data;setButtonEnabled('globalSignalDownloadBtn',true);}setButtonEnabled('downloadSignalJsonBtn',true);}
  function renderSignalJobProgress(type,data){
    data=data||{};var p=data.progress||{},collection=p.collection||{},analysis=p.analysis||{},status=text(data.status||'not_started'),labels={not_started:'시작 전',collecting:'근거를 출처별로 수집 중',analyzing:'수집 근거 AI 분석 중',complete:'AI 점검 완료'},el=signalProgressElement(type),message=(labels[status]||status)+' · 근거 수집 '+Number(collection.done||0)+'/'+Number(collection.total||0)+' · AI 분석 '+Number(analysis.done||0)+'/'+Number(analysis.total||1);
    if(data.evidence)message+=' · 확인 근거 '+Number(data.evidence.count||0)+'건';if(data.lastError)message+=' · 최근 오류 '+text(data.lastError.message||data.lastError);
    if(el)el.textContent=message;
    $('signalPanel').classList.remove('hidden');$('signalTitle').textContent=type==='regional'?'권역 AI 단계별 점검 · '+(data.scope&&data.scope.regionNameKo||data.scope&&data.scope.regionNameEn||selectedRegion):'전 세계 흐름 AI 단계별 점검';$('signalOverview').textContent=status==='complete'?'분석 결과를 정리했습니다.':message;$('signalMeta').textContent='각 검색 경로와 AI 분석을 별도 요청으로 저장합니다. 중간에 중단되어도 같은 버튼으로 이어서 진행합니다.';
  }
  async function runMarketSignal(type){
    var regional=type==='regional',btn=regional?$('regionalSignalBtn'):$('globalSignalBtn'),regionAtStart=selectedRegion;if(regional&&!regionAtStart){show('먼저 권역을 선택해 주세요.','warn');return;}if(signalLoopActive)return;hide();signalLoopActive=true;btn.disabled=true;var originalText=btn.textContent,params={scopeType:regional?'regional':'global',regionGroup:regional?regionAtStart:null};
    try{
      var existing=regional?lastRegionalJson:lastGlobalJson,restart=!!(existing&&existing.status==='complete'&&existing.report);if(restart&&!window.confirm((regional?'선택 권역':'전 세계')+' AI 점검을 새로 시작하시겠습니까? 이전 결과는 관리 DB에 보존됩니다.'))return;
      var data=await api(CONTROL,'signal_research_begin','POST',{},Object.assign({},params,{restart:restart}));
      while(true){
        if(regional&&selectedRegion!==regionAtStart){show('점검 중 선택 권역이 바뀌어 화면 진행을 중단했습니다. 원래 권역 작업은 저장돼 있습니다.','warn');break;}
        rememberSignalJob(type,data);renderSignalJobProgress(type,data);var pr=data.progress&&data.progress.collection||{};btn.textContent=(regional?'권역':'세계')+' 점검 '+Number(pr.done||0)+'/'+Number(pr.total||0);
        if(data.status==='complete'){var report=data.report||data;renderSignalReport(report);rememberReport(type,report);show((regional?'권역 상황':'전 세계 흐름')+' AI 점검을 완료했습니다. JSON 다운로드가 활성화됐습니다.',report.apply&&report.apply.eligible?'ok':'warn');break;}
        await new Promise(function(resolve){setTimeout(resolve,450);});data=await api(CONTROL,'signal_research_step','POST',{},params);
      }
    }catch(e){
      try{var saved=await api(CONTROL,'signal_research_status','GET',{scopeType:regional?'regional':'global',regionGroup:regional?regionAtStart:''});rememberSignalJob(type,saved);renderSignalJobProgress(type,saved);if(saved.status==='complete'&&saved.report){renderSignalReport(saved.report);rememberReport(type,saved.report);}}catch(_statusError){}
      show((text(e.message)||'세계·권역 AI 점검 요청이 중단됐습니다.')+' 완료된 근거 수집 단계는 관리 DB에 보존됐습니다. 같은 버튼으로 이어서 진행하세요.','fail');
    }finally{signalLoopActive=false;btn.disabled=false;btn.textContent=originalText;}
  }
  async function applyMarketSignal(){
    if(!lastSignalReport)return;var scope=lastSignalReport.scope||{};if(scope.type==='regional'&&scope.regionGroup!==selectedRegion){show('현재 선택 권역과 점검 결과 권역이 다릅니다. 해당 권역을 다시 선택해 점검해 주세요.','warn');return;}$('applySignalBtn').disabled=true;
    try{var data=await api(CONTROL,'market_signal_apply','POST',{}, {report:lastSignalReport});show('AI 세계·권역 권고를 품목군 탐색 비중에 반영했습니다. 신뢰도·업체 승인·상품 공개 조건은 변경하지 않았습니다.','ok');var status=await api(CONTROL,'signal_status','GET',{regionGroup:selectedRegion});renderActiveSignals(status);presentJson({reportType:lastSignalReport.reportType,scope:lastSignalReport.scope,generatedAt:new Date().toISOString(),appliedResult:data,sourceReport:lastSignalReport});}catch(e){$('applySignalBtn').disabled=!(lastSignalReport.apply&&lastSignalReport.apply.eligible);show(text(e.message)||'AI 권고 반영에 실패했습니다.','fail');}
  }

  function setPresetButtons(disabled){['globalAutoModeBtn','globalPauseBtn','selectedCountryAutoBtn','selectedCountryAutoStopBtn'].forEach(function(id){var el=$(id);if(el)el.disabled=!!disabled;});}
  async function applyOperatingPreset(preset){
    if(preset==='global_auto'&&!window.confirm('지원되는 전 세계 국가의 책임 공급업체 자동 조사 주기를 주 2회(84시간)로 통일합니다. 기존 권역·국가·지역 예외 설정은 상속으로 정리됩니다. 상품 자동 배치·프론트 공개는 별도 검증 대상입니다. 계속하시겠습니까?'))return;
    if(preset==='global_pause'&&!window.confirm('전체 예약 자동화를 중지합니다. 기존 후보와 점검 기록은 보존됩니다. 계속하시겠습니까?'))return;
    if(preset==='country_auto'||preset==='country_pause'){
      if(!selectedCountry||selectedCountry==='GLOBAL'){show('먼저 국가를 선택하세요. 선택한 국가·지역에만 예약 자동화를 적용합니다.','warn');return;}
      if(!window.confirm(selectedCountry+' / '+(selectedSubdivision||'NATIONWIDE')+' 범위 예약 자동화를 '+(preset==='country_auto'?'시작':'중지')+'하시겠습니까? 수동 고정 상품은 변경하지 않습니다.'))return;
    }
    hide();setPresetButtons(true);
    try{
      var data=await api(CONTROL,'operating_preset_apply','POST',{}, {preset:preset,scope:{countryCode:selectedCountry||'',subdivisionCode:selectedSubdivision||'NATIONWIDE'}});
      presentJson(data);
      await reloadData(false);
      var messages={global_auto:'지원되는 전 세계 국가의 책임 공급업체 자동 조사를 주 2회(84시간)로 설정했습니다. 시간당 순환 처리되며 기존 후보와 관리자 기록은 보존됩니다. 상품 자동 배치·게재는 별도 검증 대상입니다.',global_pause:'전체 예약 자동화를 중지했습니다. 기존 후보·점검 기록과 국가별 세부 설정은 보존됩니다.',country_auto:'선택 국가·지역의 책임 공급업체 예약 자동화를 시작했습니다. 상품 자동 배치·프론트 게재는 별도 검증을 통과해야 합니다.',country_pause:'선택 국가·지역 예약 자동화를 중지했습니다. 원장·관리자 고정은 유지됩니다.'};
      show(messages[preset]||'운영 설정을 반영했습니다.','ok');
    }catch(e){show(text(e.message)||'운영 전환 설정을 반영하지 못했습니다.','fail');}
    finally{setPresetButtons(false);}
  }

  function renderResearchProgress(data){
    if(!data)return;var p=data.progress||{},s=p.search||{},i=p.inspection||{},r=p.ranking||{},status=text(data.status||'not_started'),labels={not_started:'시작 전',searching:'검색 경로 조사',inspecting:'업체 페이지 증빙 조사',ranking:'AI 신뢰 평가',complete:'검색·증빙·AI 평가 완료',committed:'비공개 후보 원장 실행 완료'};
    if($('countryResearchProgress')){var sm=data.summary||{},preserved=Number(sm.preservedExisting||0),newTarget=Number(sm.newCandidateTarget||0),newRanked=Number(sm.newRanked||0),targetTotal=Number(sm.targetTotalCandidates||0);$('countryResearchProgress').textContent=(labels[status]||status)+' · 검색 '+Number(s.done||0)+'/'+Number(s.total||0)+' · 증빙 '+Number(i.done||0)+'/'+Number(i.total||0)+' · AI 평가 '+Number(r.done||0)+'/'+Number(r.total||0)+' · 기존 보존 '+preserved+(targetTotal?' · 목표 '+targetTotal:'')+(targetTotal?' · 신규 목표 '+newTarget+' · 신규 확보 '+newRanked:'')+' · 최종 후보 '+Number(sm.ranked||0)+(sm.duplicateResearchSkipped===true?' · 기존 업체 중복 리서치 없음':'')+(data.lastError?' · 최근 오류: '+text(data.lastError.message):'');}
    var complete=status==='complete'||status==='committed';setButtonEnabled('runNowBtn',complete&&Array.isArray(data.candidates)&&data.candidates.length>0);if($('previewRunBtn'))$('previewRunBtn').textContent=researchLoopActive?('정상 진행 중 · '+(labels[status]||status)):complete?'새 책임 공급업체 검색':(p.resumable?'책임 공급업체 검색 계속':'책임 공급업체 단계별 검색');
  }
  function isGatewayDelay(error){var status=Number(error&&error.status)||0;return status===502||status===503||status===504;}
  async function readScopePart(label,endpoint,action,params,fallback){
    var lastError=null;
    for(var attempt=0;attempt<2;attempt++){
      try{return{ok:true,label:label,data:await api(endpoint,action,'GET',params||{})};}
      catch(error){lastError=error;if(!isGatewayDelay(error)||attempt>0)break;await new Promise(function(resolve){setTimeout(resolve,900);});}
    }
    return{ok:false,label:label,data:fallback,error:lastError};
  }
  async function loadScope(reason){
    if(!selectedCountry)return;var passive=reason==='restore-passive';if(!passive)hide();$('refreshScopeBtn').disabled=true;
    var requested=scopeParams(),requestedKey=scopeKey(requested),failures=[];
    var cachedScope=lastScopeCache&&lastScopeCache.scope||{},sameCachedScope=lastScopeCache&&scopeKey(cachedScope)===requestedKey;
    var cachedScopeData=sameCachedScope&&lastScopeCache.scopeData||null,cachedQueueData=sameCachedScope&&lastScopeCache.queueData||null,cachedResearchData=sameCachedScope&&lastScopeCache.researchData||null;
    var scopeFallback=cachedScopeData||{ok:true,country:country(requested.country),effective:effective(requested.country,requested.region==='NATIONWIDE'?'':requested.region),marketSignals:{},candidates:[]};
    var researchFallback=cachedResearchData||{ok:true,status:'not_started',candidates:[],summary:{},progress:{}};
    var cachedProductData=sameCachedScope&&lastScopeCache.productData||null;
    var directProductScope=lastProductJson&&lastProductJson.scope||{},cachedProductScope=cachedProductData&&cachedProductData.scope||{};
    var preservedProductData=text(directProductScope.country).toUpperCase()===requested.country&&text(directProductScope.region||'NATIONWIDE').toUpperCase()===requested.region?lastProductJson:(text(cachedProductScope.country).toUpperCase()===requested.country&&text(cachedProductScope.region||'NATIONWIDE').toUpperCase()===requested.region?cachedProductData:null);
    var productFallback=preservedProductData||{ok:true,status:'not_started',products:[],summary:{},progress:{}};
    try{
      var scopePart=await readScopePart('국가 책임 공급업체 원장',CONTROL,'scope',requested,scopeFallback);if(scopeKey()!==requestedKey)return;
      var scopeData=scopePart.data||scopeFallback;if(!scopePart.ok)failures.push(scopePart);
      renderAi(scopeData.candidates||[]);renderActiveSignals(scopeData.marketSignals||{});

      /* Large product candidate ledgers are loaded in small resilient pages below.
         Keep scope boot lightweight so slow networks never block the whole admin page. */
      var queueFallback=cachedQueueData||{ok:true,summary:{},candidates:[]},queueData=queueFallback;
      renderSummary(queueData&&queueData.summary||{},scopeData,'저장 원장 기준');if(queueData&&Array.isArray(queueData.candidates)&&queueData.candidates.length)renderQueue(queueData.candidates);

      var researchPart=await readScopePart('책임 공급업체 리서치',CONTROL,'research_status',requested,researchFallback);if(scopeKey()!==requestedKey)return;
      if(!researchPart.ok)failures.push(researchPart);var researchData=researchPart.data||researchFallback;renderResearchProgress(researchData);
      if((researchData.status==='complete'||researchData.status==='committed')&&((Array.isArray(researchData.candidates)&&researchData.candidates.length)||(Array.isArray(researchData.holdingCandidates)&&researchData.holdingCandidates.length)||(Array.isArray(researchData.blockedCandidates)&&researchData.blockedCandidates.length))){lastCountryPreview=researchData;lastCountryJson=researchData;setButtonEnabled('countryRunDownloadBtn',true);renderSummary(researchData,{candidates:researchData.candidates||[]},'완료된 단계별 검색 결과');}
      renderAi(researchData.candidates||[],researchData.holdingCandidates||[],researchData.blockedCandidates||[]);

      /* Product cards come from the private candidate ledger, while research control
         state comes from the separate compact product job. Load the ledger in
         bounded pages so latency is independent of country size and link speed. */
      var productData=candidateLedgerProductData(queueData||{candidates:[]});
      try{productData=await refreshCandidateLedgerProducts({preserveResearchReport:true,pageSize:100});queueData={ok:true,candidates:Array.isArray(productData&&productData.candidateRows)?productData.candidateRows:[]};refreshHoldReviewInventory().catch(function(){});}
      catch(ledgerError){failures.push({ok:false,label:'상품 후보 원장',data:queueFallback,error:ledgerError});if(cachedQueueData&&Array.isArray(cachedQueueData.candidates))renderQueue(cachedQueueData.candidates);}
      var productStatusFallback=preservedProductData&&text(preservedProductData.status)!=='candidate_ledger'?preservedProductData:{ok:true,status:'not_started',scope:{country:requested.country,region:requested.region},summary:{},progress:{}};
      var productStatusPart=await readScopePart('상품 리서치 실행 상태',CONTROL,'product_research_status',{country:requested.country,region:requested.region,compact:'1'},productStatusFallback);if(scopeKey()!==requestedKey)return;if(!productStatusPart.ok)failures.push(productStatusPart);var productStatus=productStatusPart.data||productStatusFallback;
      if(productStatus&&productStatus.status&&productStatus.status!=='not_started')lastProductJson=Object.assign({},productStatus,{products:productRows,latestProducts:latestProductRows});else lastProductJson=productData;renderProductProgress(lastProductJson);setButtonEnabled('productResearchBtn',researchData.status==='complete'||researchData.status==='committed'||productData.products.length>0||text(lastProductJson.status)!=='not_started');if(productData.products.length||text(lastProductJson.status)!=='not_started')setButtonEnabled('productResearchDownloadBtn',true);
      lastScopeCache={scope:requested,scopeData:scopeData,summaryData:queueData&&queueData.summary||sameCachedScope&&lastScopeCache.summaryData||{},queueData:queueData||queueFallback,researchData:researchData,productData:lastProductJson};
      saveReviewSnapshot();
      // A fresh tab must read the original research inbox independently of a
      // registration/AI click. Durable registered rows are already visible
      // from the scoped candidate ledger, even when this read is delayed.
      latestProductRowsComplete=false;
      refreshLatestResearchRows(requested.country,requested.region,{label:'자동 최신 리서치 원본 조회',preserveOnFailure:true})
        .then(function(){if(scopeKey()===requestedKey)renderLatestResearchCandidateGroup();})
        .catch(function(error){if(scopeKey()===requestedKey){latestInCandidateMessage='저장된 후보 원장은 유지 · 최신 리서치 원본 조회 지연: '+conciseRequestError(error&&error.message,error&&error.status);renderLatestResearchCandidateGroup();}});


      if(failures.length){
        var delayed=failures.map(function(row){return row.label;}).join(' · '),prefix=reason==='ip'?'현재 접속 IP 범위 적용은 정상입니다. ':' ';
        if(!passive)show(prefix+'일부 상세 원장 응답이 지연되었습니다: '+delayed+'. 같은 범위의 마지막 정상 원장과 버튼 상태는 그대로 보존했습니다. 범위 읽기로 지연된 부분만 다시 확인할 수 있습니다.','warn');
      }else if(!passive)show(scopeName()+' 범위를 읽었습니다.','ok');
      restoreReviewReturn();
    }catch(e){if(scopeKey()===requestedKey)show((reason==='ip'?'현재 접속 IP 범위는 적용됐지만 상세 원장을 읽는 중 오류가 발생했습니다: ':'범위를 읽는 중 오류가 발생했습니다: ')+(text(e.message)||'알 수 없는 오류'),'fail');}
    finally{$('refreshScopeBtn').disabled=false;}
  }
  function selectedSupplierResearchRounds(){
    var el=$('supplierResearchRounds'),n=Number(el&&el.value||1);
    return Math.max(1,Math.min(5,Math.round(n)||1));
  }
  async function runAutomation(dry){
    if(researchLoopActive){show('이미 책임 공급업체 검색 요청이 진행 중입니다.','warn');return;}
    if(!selectedCountry){show('검색할 국가·지역을 먼저 선택해 주세요.','warn');return;}
    if(dry!==true){show('먼저 책임 공급업체 단계별 검색을 완료한 뒤 공급업체 후보 원장 등록을 눌러 주세요.','warn');return;}
    // Show an acknowledgement in the same browser event turn, even when the
    // policy save, auth refresh, or server research_begin takes a long time.
    var btn=$('previewRunBtn'),progress=$('countryResearchProgress'),autoProductAfter=false;
    var requested=null,requestedKey='',restart=false,activePhase='관리자 검색 요청 접수',lastVerifiedProgress='';
    researchStopRequested=false;researchLoopActive=true;
    if(btn){btn.disabled=true;btn.textContent='검색 시작 처리 중';}
    setButtonEnabled('researchPauseBtn',true);setButtonEnabled('runNowBtn',false);
    function researchPhase(label){
      activePhase=label;
      if(progress)progress.textContent=lastVerifiedProgress?('업체 리서치 · '+label+' · '+lastVerifiedProgress):('업체 리서치 · '+label+' · 검색/증빙/AI 평가 수치는 서버에서 실제 작업을 시작한 후 갱신됩니다.');
      if(btn)btn.textContent='처리 중 · '+label;
    }
    researchPhase('관리자 검색 요청 접수');
    try{
      requested=scopeSnapshot();requestedKey=scopeKey(requested);
      var displayedStatus=text(lastCountryPreview&&lastCountryPreview.status||lastScopeCache&&lastScopeCache.researchData&&lastScopeCache.researchData.status).toLowerCase();
      restart=['complete','committed'].includes(displayedStatus);
      if(restart&&!window.confirm('현재 완료된 검색 결과는 관리 DB에 보존되어 있습니다. 같은 국가 범위에서 새 리서치를 시작하시겠습니까?')){
        if(progress)progress.textContent='관리자가 신규 검색을 취소했습니다. 기존 검색·증빙·AI 평가 수치는 변경되지 않았습니다.';
        return;
      }
      researchPhase('검색 준비 및 관리자 범위 확인');
      closeManagementPanels();closeSupplierControlQueue();hide();
      // The operator may type a directive and immediately start research.
      // Persist it to the selected country's own setting before creating the
      // server job; otherwise the plan silently uses stale/no instructions.
      var directive=text($('supplierResearchDirective')&&$('supplierResearchDirective').value).slice(0,1200);
      var currentSetting=requested.region==='NATIONWIDE'?setting('country',{countryCode:requested.country}):setting('subdivision',{countryCode:requested.country,subdivisionCode:requested.region});
      if(directive!==text(currentSetting&&currentSetting.researchDirective)){
        researchPhase('업체·제조사 AI 지정 조건 저장 요청 중');
        await saveSetting({scopeType:requested.region==='NATIONWIDE'?'country':'subdivision',countryCode:requested.country,subdivisionCode:requested.region,mode:$('scopeMode').value,intervalDays:Number($('scopeInterval').value),maxCandidates:Number($('maxCandidates').value),expandSubdivisions:$('expandSubdivisions').value==='true',researchDirective:directive},20000);
        researchPhase('AI 지정 조건 저장 완료');
        if(scopeKey()!==requestedKey){show('조건 저장 중 국가·지역이 바뀌었습니다. 검색을 다시 실행해 주세요.','warn');return;}
      }
      researchPhase('서버 책임 공급업체 작업 생성 요청 중');
      var data=await api(CONTROL,'research_begin','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,restart:restart,forceNewRun:restart,newRunToken:restart?('admin-'+Date.now()+'-'+Math.random().toString(36).slice(2)):null,researchRounds:selectedSupplierResearchRounds(),scopeAuthority:'administrator-selected',ignoreRequestGeo:true},60000);
      while(true){
        if(scopeKey()!==requestedKey){researchStopRequested=true;show('검색 중 선택 범위가 바뀌어 화면 진행을 중단했습니다. 서버에 저장된 작업은 해당 범위에서 다시 이어갈 수 있습니다.','warn');break;}
        if(!data.scope)data.scope=requested;else{data.scope.source=requested.source;data.scope.detectedGeo=requested.detectedGeo;}lastCountryPreview=data;rememberReport('country',data);renderResearchProgress(data);lastVerifiedProgress=progress?progress.textContent:'';renderSummary(data,{candidates:data.candidates||[]},'단계별 리서치 진행');if((Array.isArray(data.candidates)&&data.candidates.length)||(Array.isArray(data.holdingCandidates)&&data.holdingCandidates.length)||(Array.isArray(data.blockedCandidates)&&data.blockedCandidates.length))renderAi(data.candidates||[],data.holdingCandidates||[],data.blockedCandidates||[]);saveReviewSnapshot();
        if(data.status==='complete'||data.status==='committed'){var hasCandidates=Array.isArray(data.candidates)&&data.candidates.length>0;setButtonEnabled('runNowBtn',hasCandidates);setButtonEnabled('productResearchBtn',hasCandidates);if(hasCandidates&&(Number(data.summary&&data.summary.newRanked||0)>0||!lastProductJson||lastProductJson.status==='not_started')){autoProductAfter=true;if($('productResearchState'))$('productResearchState').textContent='공급업체 리서치를 완료했습니다. 실제 상품 이미지·상품명·원본 링크 리서치를 자동으로 이어서 시작합니다.';}show(hasCandidates?'모든 계획 검색·업체 증빙·AI 신뢰 평가를 완료했습니다. 이어서 실제 상품 이미지·원본 링크 리서치를 시작합니다.':'단계별 리서치는 완료됐지만 실행할 책임 공급업체 후보가 없습니다. JSON의 검색 경로와 제외 근거를 확인해 주세요.',hasCandidates?'ok':'warn');break;}
        if(researchStopRequested){show('진행을 일시정지했습니다. 지금까지의 검색·증빙 결과는 관리 DB에 보존됐으며 같은 버튼으로 이어서 진행합니다.','warn');break;}
        await new Promise(function(resolve){setTimeout(resolve,250);});researchPhase('서버 검색·증빙·AI 평가 다음 단계 요청 중');data=await api(CONTROL,'research_step','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,jobId:data.jobId,scopeAuthority:'administrator-selected',ignoreRequestGeo:true},80000);
      }
    }catch(e){
      var failedPhase=activePhase,reason=text(e&&e.message)||'알 수 없는 오류';
      // The user must see the original failing phase immediately, instead of
      // waiting indefinitely for a second status read or showing stale counts.
      if(progress)progress.textContent='업체 리서치 시작 실패 · 중단 단계: '+failedPhase+' · 사유: '+reason+' · 기존 후보 원장은 변경하지 않았습니다.';
      show('업체 검색 중단 단계: '+failedPhase+' · '+reason,'fail');
      if(requested&&requested.country){
        try{
          var saved=await api(CONTROL,'research_status','GET',{country:requested.country,region:requested.region},null,12000);
          if(saved&&saved.jobId){lastCountryPreview=saved;rememberReport('country',saved);}
        }catch(_statusError){}
      }
      if(progress)progress.textContent='업체 리서치 시작 실패 · 중단 단계: '+failedPhase+' · 사유: '+reason+' · 기존 후보 원장은 유지됩니다.';
    }finally{
      researchLoopActive=false;
      if(btn){btn.disabled=false;btn.textContent='새 책임 공급업체 검색';}
      setButtonEnabled('researchPauseBtn',false);
    }
    if(autoProductAfter)setTimeout(function(){runProductResearch({automatic:true});},120);
  }
  async function commitCountryPreview(){
    if(!selectedCountry)return;
    if(!lastCountryPreview||!Array.isArray(lastCountryPreview.candidates)||!lastCountryPreview.candidates.length){show('등록할 공급업체 검색 결과가 없습니다. 먼저 책임 공급업체 검색을 완료해 주세요.','warn');setButtonEnabled('runNowBtn',false);return;}
    var requested=scopeSnapshot(),requestedKey=scopeKey(requested),previewScope=lastCountryPreview.scope||{};
    if(text(previewScope.country).toUpperCase()!==text(requested.country).toUpperCase()||(text(previewScope.region||'NATIONWIDE').toUpperCase()!==text(requested.region||'NATIONWIDE').toUpperCase())){invalidateJson();show('현재 선택 범위와 검색 결과 범위가 달라 실행을 중단했습니다. 다시 검색해 주세요.','warn');return;}
    hide();var btn=$('runNowBtn');btn.disabled=true;$('previewRunBtn').disabled=true;
    try{
      var data=lastCountryPreview.jobId?await api(CONTROL,'research_commit','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,jobId:lastCountryPreview.jobId}):await api(CONTROL,'commit_preview','POST',{}, {countryCode:requested.country,subdivisionCode:requested.region,candidates:lastCountryPreview.candidates,sourceRunId:lastCountryPreview.runId||null,sourceStartedAt:lastCountryPreview.startedAt||null});
      if(scopeKey()!==requestedKey){invalidateJson();show('원장 등록 중 선택 범위가 바뀌어 결과를 폐기했습니다. 현재 범위를 다시 읽어 주세요.','warn');return;}
      if(!data.scope)data.scope=requested;else{data.scope.source=requested.source;data.scope.detectedGeo=requested.detectedGeo;}
      var holdingRows=Array.isArray(lastCountryPreview&&lastCountryPreview.holdingCandidates)?lastCountryPreview.holdingCandidates:[],blockedRows=Array.isArray(lastCountryPreview&&lastCountryPreview.blockedCandidates)?lastCountryPreview.blockedCandidates:[];
      lastCountryPreview=null;rememberReport('country',data);renderSummary(data,{candidates:data.candidates||[]},'공급업체 후보 원장 등록 완료');renderAi(data.candidates||[],holdingRows,blockedRows);
      var refreshedAfterCommit=false;
      try{await reloadData(false);await loadScope('commit-refresh');refreshedAfterCommit=true;}catch(_reloadError){}
      if(!refreshedAfterCommit){renderSummary(data,{candidates:data.candidates||[]},'공급업체 후보 원장 등록 완료');renderAi(data.candidates||[],holdingRows,blockedRows);}
      presentJson(data);
      show('검색 결과를 비공개 책임 공급업체 후보 원장에 등록했습니다. 상품 리서치·대기열 심사·사이트 게재는 실행하지 않았습니다.',data.ok?'ok':'warn');
    }catch(e){
      var failure=e&&e.payload&&typeof e.payload==='object'?e.payload:{ok:false,reportType:'igdc-country-responsible-supplier-preview-commit-error',generatedAt:new Date().toISOString(),scope:requested,error:text(e&&e.message),code:text(e&&e.code)};
      rememberReport('country',failure);show(text(e&&e.message)||'공급업체 후보 원장 등록에 실패했습니다. 오류 JSON을 내려받아 확인할 수 있습니다.','fail');
      setButtonEnabled('runNowBtn',!!(lastCountryPreview&&lastCountryPreview.candidates&&lastCountryPreview.candidates.length));
    }finally{$('previewRunBtn').disabled=false;}
  }

  async function runtimeDiagnostic(){
    var button=$('runtimeDiagnosticBtn'),downloadButton=$('runtimeDiagnosticDownloadBtn'),status=$('runtimeDiagnosticState');if(button)button.disabled=true;if(downloadButton)downloadButton.disabled=true;if(status)status.textContent='Netlify 런타임·관리 DB 응답 시간을 점검 중입니다.';
    try{
      var data=await api(RUNTIME_DIAGNOSTIC,'probe','GET',{country:selectedCountry||'',region:selectedSubdivision||'NATIONWIDE'},null,30000);
      lastRuntimeDiagnostic=data;lastJson=data;setDownloadEnabled(true);if(downloadButton)downloadButton.disabled=false;if($('jsonOutput'))$('jsonOutput').textContent=JSON.stringify(data,null,2);if($('jsonPanel'))$('jsonPanel').classList.remove('hidden');
      var probes=Array.isArray(data.probes)?data.probes:[],slow=probes.filter(function(row){return row&&row.ok!==true||Number(row&&row.ms||0)>5000;});
      if(status)status.textContent='Netlify 런타임 점검 완료 · 배포 '+text(data.deploy&&data.deploy.commitRef||'-').slice(0,10)+' · DB/후보경로 점검 '+probes.length+'개 · 지연/오류 '+slow.length+'개';
      show(slow.length?'Netlify/관리 DB 점검에서 지연 또는 오류 '+slow.length+'개를 확인했습니다. 런타임 점검 다운로드 버튼으로 JSON을 내려받아 전달해 주세요.':'Netlify 런타임과 관리 DB·후보 원장 조회 경로가 정상 응답했습니다. 런타임 점검 다운로드 버튼으로 JSON을 바로 받을 수 있습니다.',slow.length?'warn':'ok');
    }catch(error){lastRuntimeDiagnostic=null;if(status)status.textContent='Netlify 런타임 점검 실패 · '+conciseRequestError(error&&error.message,error&&error.status);show(status?status.textContent:'Netlify 런타임 점검에 실패했습니다.','fail');}
    finally{if(button)button.disabled=false;}
  }
  function downloadRuntimeDiagnostic(){
    if(!lastRuntimeDiagnostic){show('먼저 Netlify·DB 런타임 점검을 실행해 주세요.','warn');return;}
    try{var stamp=new Date().toISOString().replace(/[:.]/g,'-'),scope=lastRuntimeDiagnostic.scope||{},name='IGDC_NETLIFY_RUNTIME_DIAGNOSTIC_'+text(scope.country||selectedCountry||'GLOBAL').toUpperCase()+'_'+text(scope.region||selectedSubdivision||'NATIONWIDE').toUpperCase()+'_'+stamp+'.json',blob=new Blob([JSON.stringify(lastRuntimeDiagnostic,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();setTimeout(function(){try{a.remove();URL.revokeObjectURL(url);}catch(_e){}},1200);show('Netlify·DB 런타임 점검 JSON 다운로드를 시작했습니다.','ok');}catch(error){show('런타임 점검 JSON 파일을 만들지 못했습니다: '+text(error&&error.message),'fail');}
  }

  async function globalControlDiagnostic(){
    hide();var button=$('globalSituationBtn');if(button)button.disabled=true;
    try{var data=await api(CONTROL,'global_control_diagnostic','GET',{});rememberReport('globalControl',data);show('전 세계 자동화 관제 상태, 예약 범위, 공급업체·상품 리서치 작업과 오류 상태를 점검했습니다.','ok');}
    catch(e){show(text(e.message)||'전체 관제 상황 점검에 실패했습니다.','fail');}
    finally{if(button)button.disabled=false;}
  }
  async function diagnostic(){
    hide();var diagnosticButtons=[$('diagnosticBtn'),$('runCurrentDiagnosticBtn')].filter(Boolean);diagnosticButtons.forEach(function(button){button.disabled=true;});var requested=scopeSnapshot(),requestedKey=scopeKey(requested),p={country:requested.country,region:requested.region};
    try{
      var all=[],$state=stateEl;function step(label){if($state)$state.textContent='통합 점검 준비 · '+label;return new Promise(function(resolve){requestAnimationFrame(function(){setTimeout(resolve,0);});});}
      await step('운영 제어');all[0]=await api(CONTROL,'diagnostic','GET',{});if(scopeKey()!==requestedKey)return;
      await step('상품 후보 대기열');all[1]=await api(REVIEW,'diagnostic','GET',p);if(scopeKey()!==requestedKey)return;
      await step('선택 국가·지역');all[2]=await api(CONTROL,'scope','GET',p);if(scopeKey()!==requestedKey)return;
      await step('시장 신호');all[3]=await api(CONTROL,'signal_status','GET',{regionGroup:requested.regionGroup});
      if(scopeKey()!==requestedKey){invalidateJson();show('점검 중 선택 범위가 바뀌어 이전 결과를 폐기했습니다. 현재 범위에서 다시 점검해 주세요.','warn');return;}
      var report={ok:true,reportType:'igdc-integrated-commerce-control-diagnostic',generatedAt:new Date().toISOString(),scope:requested,control:all[0],queue:all[1],automationScope:all[2],marketSignals:all[3]};rememberReport('diagnostic',report);saveReviewSnapshot();show('통합 점검 JSON을 생성했습니다. 전체 원문은 다운로드 버튼으로 바로 내려받을 수 있습니다.','ok');
    }
    catch(e){var failure=e&&e.payload&&typeof e.payload==='object'?e.payload:{ok:false,reportType:'igdc-integrated-commerce-control-diagnostic-error',generatedAt:new Date().toISOString(),scope:requested,error:text(e&&e.message),code:text(e&&e.code)};rememberReport('diagnostic',failure);show(text(e&&e.message)||'통합 점검에 실패했습니다. 오류 JSON을 내려받을 수 있습니다.','fail');}
    finally{diagnosticButtons.forEach(function(button){button.disabled=false;});}
  }
  function reportScope(data){var s=data&&data.scope||{};return{country:text(s.country).toUpperCase(),region:text(s.region||'NATIONWIDE').toUpperCase()||'NATIONWIDE'};}
  function download(){
    if(!lastJson){var raw=text($('jsonOutput').textContent),parsed=parseJson(raw);if(parsed)lastJson=parsed;}
    if(!lastJson){show('다운로드할 점검·실행 JSON이 없습니다. 먼저 점검 또는 실행을 완료해 주세요.','warn');return;}
    var type=text(lastJson.reportType),scope=lastJson.scope||{},stamp=new Date().toISOString().replace(/[:.]/g,'-'),name='';
    if(type==='igdc-global-automation-control-diagnostic')name='IGDC_GLOBAL_AUTOMATION_CONTROL_'+stamp+'.json';
    else if(type==='igdc-global-market-signal-persisted-research')name='IGDC_GLOBAL_MARKET_SIGNAL_PROGRESS_'+stamp+'.json';
    else if(type==='igdc-regional-market-signal-persisted-research')name='IGDC_REGION_MARKET_SIGNAL_PROGRESS_'+text(scope.regionGroup).toUpperCase()+'_'+stamp+'.json';
    else if(type==='igdc-country-product-reference-persisted-research'||type==='igdc-country-product-reference-research-status')name='IGDC_PRODUCT_RESEARCH_'+text(scope.country).toUpperCase()+'_'+text(scope.region||'NATIONWIDE').toUpperCase()+'_'+stamp+'.json';
    else if(type==='igdc-global-market-signal-check')name='IGDC_GLOBAL_MARKET_SIGNAL_'+stamp+'.json';
    else if(type==='igdc-regional-market-signal-check'){if(scope.regionGroup!==selectedRegion){show('선택 권역과 점검 JSON 권역이 달라 다운로드를 중단했습니다.','warn');return;}name='IGDC_REGION_MARKET_SIGNAL_'+text(scope.regionGroup).toUpperCase()+'_'+stamp+'.json';}
    else if(type==='igdc-country-automation-operating-preset')name='IGDC_AUTOMATION_PRESET_'+text(lastJson.preset).toUpperCase()+'_'+stamp+'.json';
    else{var report=reportScope(lastJson);if(!report.country||scopeKey(report)!==scopeKey()){invalidateJson();show('선택 범위와 점검 JSON 범위가 달라 이전 결과를 폐기했습니다. 현재 범위에서 다시 점검해 주세요.','warn');return;}name='IGDC_COUNTRY_REGION_CONTROL_'+report.country+'_'+report.region+'_'+stamp+'.json';}
    try{var compact=lastJson&&lastJson.reportType==='igdc-integrated-commerce-control-diagnostic',raw=JSON.stringify(lastJson,null,compact?0:2)+'\n',blob=new Blob([raw],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();setTimeout(function(){try{a.remove();URL.revokeObjectURL(url);}catch(_e){}},1500);show('전체 JSON 다운로드를 시작했습니다.','ok');}catch(e){show('JSON 파일을 만들지 못했습니다: '+text(e.message),'fail');}
  }
  async function reloadData(loadSelected,preserveUi){if(!preserveUi)closeQueuePanel();queueControlScopeKey='';hide();$('reloadBtn').disabled=true;try{await ensureSession(false);var catalogData=await api(CONTROL,'catalog','GET',{}),fallback=await staticRegistry();catalog=catalogData||{};try{locations=await api(REVIEW,'locations','GET',{});}catch(_locationError){locations={countries:[]};}if(!(sessionResumeActive&&geo&&geo.country))geo=await geoData();regions=(catalog.registry&&catalog.registry.regions)||fallback.regions||[];countries=(catalog.countries&&catalog.countries.length?catalog.countries:fallback.countries)||[];settings=catalog.settings||[];if(!catalog.registry)catalog.registry={};catalog.registry.regions=regions;catalog.countries=countries;mapSettings();if(geo&&geo.country){var geoCountry=country(geo.country);if(geoCountry)geo.worldRegion=geoCountry.regionGroup;}if(!regions.length||!countries.length)throw new Error('전 세계 국가 레지스트리를 불러오지 못했습니다. 자동화 모드와 무관한 구성 오류입니다.');var detected=geo&&geo.resolved?(geo.country+(geo.region?' / '+geo.region:'')):(geo&&geo.excluded?'제외 국가 IP':'IP 국가 미확인');$('detectedScope').textContent='현재 접속 IP: '+detected;if(!selectedCountry){var restored=savedScope(),restoredCountry=country(restored.country),geoCountry=geo&&geo.country&&country(geo.country);selectedCountry=restoredCountry?restoredCountry.code:(geoCountry?geoCountry.code:(country('KR')?'KR':(countries[0]&&countries[0].code||'')));selectionSource=restoredCountry?(restored.source||'saved-scope'):(geoCountry?'ip-detected':'default-country');var c=country(selectedCountry);selectedRegion=c&&c.regionGroup||geo&&geo.worldRegion||restored.regionGroup||regions[0]&&regions[0].id||'';var preferredRegion=restoredCountry?restored.region:(geo&&geo.country===selectedCountry&&geo.region?geo.region:'NATIONWIDE');selectedSubdivision=validSubdivision(c,preferredRegion||'NATIONWIDE');}renderAll();if(loadSelected!==false)await loadScope();}catch(e){show(text(e.message)||'관제 데이터를 불러오지 못했습니다.','fail');}finally{$('reloadBtn').disabled=false;}}
  function managementSanitizeKey(value){return text(value).replace(/[^a-z0-9_-]/gi,'_');}
  function managementSectionKeyFromWorkspace(workspaceKey,prefix){var suffix=text(workspaceKey).slice(prefix.length);for(var i=0;i<PRODUCT_SECTIONS.length;i++){if(managementSanitizeKey(PRODUCT_SECTIONS[i].key)===suffix)return PRODUCT_SECTIONS[i].key;}return'';}
  function managementCandidateGroupKeyFromWorkspace(workspaceKey){var suffix=text(workspaceKey).slice('candidate_group_'.length),keys=['queue_selected','assignment_repair','unassigned'].concat(PRODUCT_SECTIONS.map(function(row){return row.key;}));for(var i=0;i<keys.length;i++){if(managementSanitizeKey(keys[i])===suffix)return keys[i];}return'';}
  function managementWorkspaceRows(workspaceKey){
    var key=text(workspaceKey);
    if(key==='latest_product_research')return latestProductRows.slice();
    if(key==='whole_product_queue')return queueCandidateRows.slice();
    if(key==='product_candidate_management')return productRows.filter(candidatePoolRow);
    if(key==='distribution_20_sections')return productRows.filter(function(row){return productDecision(row)==='slot_candidate';});
    if(key==='excluded_ledger_management')return productRows.filter(function(row){var d=productDecision(row);return d==='hold'||d==='reject'||d==='purge';});
    if(key.indexOf('candidate_group_')===0){var group=managementCandidateGroupKeyFromWorkspace(key);return group?candidateGroupRows(group):[];}
    if(key.indexOf('section_')===0){var section=managementSectionKeyFromWorkspace(key,'section_');return section?sectionRows(section):[];}
    if(key==='product_research_control')return productRows.slice();
    return[];
  }
  function managementRowId(row){return text(row&&(row.candidateId||row.id||row.productIdentity||row.productUrl||row.url));}
  function managementRowUrl(row){return safeExternalUrl(row&&(row.productUrl||row.url||row.checkoutUrl||row.official_url));}
  function managementRowImage(row){return safeExternalImageUrl(row&&(row.imageUrl||row.imageOriginalUrl||row.image||row.thumbnailUrl||row.thumbnail_url));}
  function managementDocumentLink(url){var value=text(url).toLowerCase();return /\.(pdf|docx?|xlsx?|pptx?|zip)(?:[?#]|$)/.test(value)||/(?:^|\/)(?:report|reports|document|documents|download|downloads|repository|publication|publications)(?:\/|$)/.test(value);}
  function managementSelectedIds(workspaceKey,rows){
    var key=text(workspaceKey),ids=[];
    if(key==='latest_product_research')ids=latestSelectedIds();
    else if(key==='whole_product_queue')ids=selectedQueueIds();
    else if(key==='excluded_ledger_management')ids=Array.prototype.slice.call(document.querySelectorAll('[data-product-exclusion-select]:checked')).map(function(box){return text(box.value);});
    else if(key.indexOf('candidate_group_')===0){var group=managementCandidateGroupKeyFromWorkspace(key);ids=group?selectedCandidateIds(group):[];}
    else if(key.indexOf('section_')===0){var section=managementSectionKeyFromWorkspace(key,'section_');ids=section?selectedProductIds(section):[];}
    else if(key==='product_candidate_management')ids=Object.keys(candidateSelectedProducts).filter(function(id){return candidateSelectedProducts[id]===true;});
    else if(key==='distribution_20_sections')ids=Object.keys(frontSelectedProducts).filter(function(id){return frontSelectedProducts[id]===true;});
    var valid={};rows.forEach(function(row){var id=managementRowId(row);if(id)valid[id]=true;});return Array.from(new Set(ids.filter(function(id){return valid[id];})));
  }
  function managementFilterRows(workspaceKey,rows,filter,query){
    filter=text(filter).toLowerCase();query=text(query).toLowerCase();if(filter==='all')return rows.slice();if(filter==='selected'){var selected=new Set(managementSelectedIds(workspaceKey,rows));return rows.filter(function(row){return selected.has(managementRowId(row));});}
    if(filter==='missing_thumbnail')return rows.filter(function(row){return !managementRowImage(row);});
    if(filter==='missing_url')return rows.filter(function(row){return !text(row&&(row.productUrl||row.url||row.checkoutUrl||row.official_url));});
    if(filter==='invalid_url')return rows.filter(function(row){return !!text(row&&(row.productUrl||row.url||row.checkoutUrl||row.official_url))&&!managementRowUrl(row);});
    if(filter==='document_link')return rows.filter(function(row){var raw=text(row&&(row.productUrl||row.url||row.checkoutUrl||row.official_url));return !!raw&&managementDocumentLink(raw);});
    if(filter==='duplicate_url'){var counts={};rows.forEach(function(row){var key=productUrlMatchKey(managementRowUrl(row));if(key)counts[key]=(counts[key]||0)+1;});var kept={};return rows.filter(function(row){var key=productUrlMatchKey(managementRowUrl(row));if(!key||counts[key]<2)return false;if(!kept[key]){kept[key]=true;return false;}return true;});}
    if(filter==='title_contains'&&query)return rows.filter(function(row){return text(row&&(row.productName||row.title||row.sourceTitle)).toLowerCase().indexOf(query)>=0;});
    if(filter==='url_contains'&&query)return rows.filter(function(row){return text(row&&(row.productUrl||row.url||row.checkoutUrl||row.official_url)).toLowerCase().indexOf(query)>=0;});
    if(filter==='supplier_contains'&&query)return rows.filter(function(row){return text(row&&(row.supplierName||row.providerName||row.supplier&&row.supplier.name)).toLowerCase().indexOf(query)>=0;});
    return[];
  }
  function managementOperationAllowed(workspaceKey,operation){
    var key=text(workspaceKey),op=text(operation).toLowerCase();
    if(['queue_register','latest_delete','queue_unmatch'].indexOf(op)>=0)return key==='latest_product_research';
    if(op==='remove_from_list')return key==='whole_product_queue'||key==='product_candidate_management'||key==='distribution_20_sections'||key.indexOf('candidate_group_')===0||key.indexOf('section_')===0||key==='product_research_control';
    if(op==='purge')return key==='excluded_ledger_management';
    if(op==='ai_place')return key==='latest_product_research'||key==='product_candidate_management'||key==='distribution_20_sections'||key.indexOf('candidate_group_')===0||key.indexOf('section_')===0||key==='product_research_control';
    if(['hold','reject','restore'].indexOf(op)>=0)return key==='product_candidate_management'||key==='distribution_20_sections'||key==='excluded_ledger_management'||key.indexOf('candidate_group_')===0||key.indexOf('section_')===0||key==='product_research_control';
    return false;
  }
  function managementContext(workspaceKey){
    var rows=managementWorkspaceRows(workspaceKey),selected=managementSelectedIds(workspaceKey,rows),urls={},duplicates=0;rows.forEach(function(row){var key=productUrlMatchKey(managementRowUrl(row));if(key)urls[key]=(urls[key]||0)+1;});Object.keys(urls).forEach(function(key){if(urls[key]>1)duplicates+=urls[key]-1;});
    return{workspaceKey:text(workspaceKey),countryCode:selectedCountry||null,subdivisionCode:selectedSubdivision||'NATIONWIDE',total:rows.length,selected:selected.length,missingThumbnail:managementFilterRows(workspaceKey,rows,'missing_thumbnail').length,missingUrl:managementFilterRows(workspaceKey,rows,'missing_url').length,invalidUrl:managementFilterRows(workspaceKey,rows,'invalid_url').length,documentLink:managementFilterRows(workspaceKey,rows,'document_link').length,duplicateUrl:duplicates,frontPublicationAllowed:false,maxCandidatePool:3000,pageSize:MANAGEMENT_PAGE_SIZE};
  }
  function previewManagementActions(workspaceKey,actions){
    var rows=managementWorkspaceRows(workspaceKey),claimed={},preview=[],totalTargets=0;
    (Array.isArray(actions)?actions:[]).forEach(function(action,index){var op=text(action&&action.operation).toLowerCase(),filter=text(action&&action.filter||'selected').toLowerCase();if(!managementOperationAllowed(workspaceKey,op))return;var targets=managementFilterRows(workspaceKey,rows,filter,text(action&&action.query)),ids=[];targets.forEach(function(row){var id=managementRowId(row);if(!id||claimed[id])return;claimed[id]=true;ids.push(id);});if(!ids.length)return;preview.push({index:index,operation:op,filter:filter,sectionKey:text(action&&action.sectionKey),query:text(action&&action.query),note:text(action&&action.note),targetIds:ids,count:ids.length});totalTargets+=ids.length;});
    return{ok:true,workspaceKey:text(workspaceKey),scope:{countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE'},actions:preview,totalTargets:totalTargets,publicPublication:false,generatedAt:new Date().toISOString()};
  }
  function localRestoreCandidateRow(row){
    if(!row)return row;
    row.slotDecision='undecided';row.approvedPlacement=null;row.selectedPlacement=null;row.primaryPlacement=null;row.placement=null;
    row.queueControl=Object.assign({},row.queueControl||{},{action:'restored',hiddenFromCountryQueue:false,permanentExcluded:false,rediscoveryAllowed:true});
    row.review=Object.assign({},row.review||{},{state:'pending'});
    row.managementControl=Object.assign({},row.managementControl||{},{source:'administrator_restore',administratorLocked:true,aiReclassificationAllowed:false});
    row.frontPublication=Object.assign({},row.frontPublication||{},{operation:'unmatch',status:'unmatched',queued:false,pendingBuild:false,publicSnapshotConfirmed:false});
    return row;
  }
  function applyLocalCandidateRestore(ids){var wanted={};(ids||[]).forEach(function(id){id=text(id);if(id)wanted[id]=true;});if(!Object.keys(wanted).length)return;productRows.forEach(function(row){var id=managementRowId(row);if(wanted[id])localRestoreCandidateRow(row);});renderProducts(productRows.slice());}
  async function restoreLedgerCandidateRows(rows){
    var groups={hold:[],reject:[],other:[]};(rows||[]).forEach(function(row){var d=productDecision(row),id=text(row&&row.candidateId||row&&row.id);if(!id)return;if(d==='hold')groups.hold.push(id);else if(d==='reject'||d==='purge')groups.reject.push(id);else groups.other.push(id);});
    var processed=0,failed=0,failures=[],processedIds=[];
    for(var gi=0;gi<2;gi++){var bucket=gi===0?'hold':'reject',list=groups[bucket];for(var off=0;off<list.length;off+=100){var chunk=list.slice(off,off+100);try{var result=await api(QUEUE_CONTROL,'bulk_action','POST',{}, {candidateIds:chunk,decision:'restore',expectedBucket:bucket,countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE'},45000),done=Array.isArray(result&&result.processedIds)?result.processedIds:[];processed+=Number(result&&result.processed||done.length||0);failed+=Number(result&&result.failures&&result.failures.length||0);done.forEach(function(id){id=text(id);if(id&&processedIds.indexOf(id)<0)processedIds.push(id);});(result&&result.failures||[]).slice(0,20).forEach(function(f){failures.push(f);});}catch(error){failed+=chunk.length;failures.push({error:text(error&&error.message)||'restore_failed'});}}}
    for(var oi=0;oi<groups.other.length;oi+=100){var otherChunk=groups.other.slice(oi,oi+100);try{var otherResult=await authorityCandidateAction('undecided',otherChunk,'',{source:'administrator_restore'}),otherDone=Array.isArray(otherResult&&otherResult.processedIds)?otherResult.processedIds:[];processed+=Number(otherResult&&otherResult.processed||otherDone.length||0);failed+=Number(otherResult&&otherResult.failed||otherResult&&otherResult.failures&&otherResult.failures.length||0);otherDone.forEach(function(id){id=text(id);if(id&&processedIds.indexOf(id)<0)processedIds.push(id);});(otherResult&&otherResult.failures||[]).slice(0,20).forEach(function(f){failures.push(f);});}catch(error){failed+=otherChunk.length;failures.push({error:text(error&&error.message)||'restore_failed'});}}
    return{processed:processed,failed:failed,failures:failures,processedIds:processedIds};
  }
  function verifyCandidateRestore(ids){var missing=[],wrong=[],map={};productRows.forEach(function(row){map[managementRowId(row)]=row;});(ids||[]).forEach(function(id){id=text(id);var row=map[id];if(!row){missing.push(id);return;}if(productDecision(row)!=='undecided')wrong.push(id);});return{ok:missing.length===0&&wrong.length===0,missing:missing,wrong:wrong,failed:missing.length+wrong.length};}
  async function managementCandidateBulk(ids,decision,placementKey){
    var wanted=new Set((ids||[]).map(text)),rows=productRows.filter(function(row){return wanted.has(managementRowId(row));}),ledger=rows.filter(function(row){return row.ledgerSource==='candidate';}),legacy=rows.filter(function(row){return row.ledgerSource!=='candidate';}),processed=0,failed=0,failures=[],processedIds=[],restoreResult=null;
    if(decision==='undecided'&&ledger.length){
      restoreResult=await restoreLedgerCandidateRows(ledger);processed+=Number(restoreResult.processed||0);failed+=Number(restoreResult.failed||0);failures=failures.concat(restoreResult.failures||[]);processedIds=processedIds.concat(restoreResult.processedIds||[]);if(processedIds.length)applyLocalCandidateRestore(processedIds);
    }else{
      for(var off=0;off<ledger.length;off+=100){var chunk=ledger.slice(off,off+100).map(function(row){return text(row.candidateId||row.id);}).filter(Boolean);try{var source=decision==='dismiss'?'administrator_delete_rediscovery':'administrator',result=await authorityCandidateAction(decision,chunk,placementKey||'',{source:source}),done=Array.isArray(result&&result.processedIds)?result.processedIds:[];processed+=Number(result&&result.processed||0);failed+=Number(result&&result.failed||result&&result.failures&&result.failures.length||0);done.forEach(function(id){id=text(id);if(id&&processedIds.indexOf(id)<0)processedIds.push(id);});(result&&result.failures||[]).slice(0,20).forEach(function(f){failures.push(f);});}catch(error){failed+=chunk.length;failures.push({error:text(error&&error.message)||'bulk_failed'});}}
    }
    var last=null;for(var i=0;i<legacy.length;i++){try{last=await api(CONTROL,'product_candidate_action','POST',{}, {countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE',productId:text(legacy[i].id),decision:decision,placementKey:placementKey||''},45000);processed+=1;processedIds.push(text(legacy[i].id));}catch(error){failed+=1;failures.push({id:text(legacy[i].id),error:text(error&&error.message)||'item_failed'});}}
    if(last){lastProductJson=last;rememberReport('product',last);renderProductProgress(last);renderProducts(last.products||[]);}
    if(ledger.length)await refreshCandidateLedgerProducts({preserveResearchReport:true});
    if(decision==='undecided'&&processedIds.length){var verification=verifyCandidateRestore(processedIds);if(!verification.ok){var verificationFailed=verification.failed;processed=Math.max(0,processed-verificationFailed);failed+=verificationFailed;verification.missing.forEach(function(id){failures.push({id:id,error:'restore_verification_missing'});});verification.wrong.forEach(function(id){failures.push({id:id,error:'restore_verification_state_mismatch'});});}}
    saveReviewSnapshot();return{processed:processed,failed:failed,failures:failures,processedIds:processedIds};
  }

  async function executeManagementPreview(preview){
    if(!preview||!Array.isArray(preview.actions)||!preview.actions.length)return{ok:false,processed:0,failed:0,summary:'실행할 관리 작업이 없습니다.'};var processed=0,failed=0,details=[];
    for(var i=0;i<preview.actions.length;i++){var action=preview.actions[i],ids=action.targetIds||[],result=null;try{
      if(action.operation==='queue_register'||action.operation==='latest_delete'||action.operation==='queue_unmatch'){Object.keys(latestSelectedProducts).forEach(function(id){delete latestSelectedProducts[id];});ids.forEach(function(id){latestSelectedProducts[id]=true;});result=await runLatestProductQueueAction(action.operation==='queue_register'?'stage':action.operation==='latest_delete'?'delete':'unmatch','selected',{skipConfirm:true});processed+=Number(result&&result.handled||0);failed+=Number(result&&result.failed||0);}
      else if(action.operation==='ai_place'){if(preview.workspaceKey==='latest_product_research'){Object.keys(latestSelectedProducts).forEach(function(id){delete latestSelectedProducts[id];});ids.forEach(function(id){latestSelectedProducts[id]=true;});var stage=await runLatestProductQueueAction('stage','selected',{skipConfirm:true});var candidateIds=candidateIdsForLatestRows(latestRowsForIds(ids));if(candidateIds.length)await runProductAiAutomation('products','',candidateIds,{skipConfirm:true});processed+=candidateIds.length;failed+=Math.max(0,ids.length-candidateIds.length)+Number(stage&&stage.failed||0);}else{await runProductAiAutomation('products','',ids,{skipConfirm:true});processed+=ids.length;}}
      else if(action.operation==='remove_from_list'){
        if(preview.workspaceKey==='whole_product_queue'){for(var q=0;q<ids.length;q+=100){var qids=ids.slice(q,q+100),qd=await api(QUEUE_CONTROL,'bulk_action','POST',{}, {candidateIds:qids,decision:'remove_from_list',countryCode:selectedCountry,subdivisionCode:selectedSubdivision||'NATIONWIDE'});processed+=Number(qd&&qd.processed||0);failed+=Number(qd&&qd.failures&&qd.failures.length||0);}await refreshCandidateLedgerProducts({preserveResearchReport:true});}
        else{result=await managementCandidateBulk(ids,'remove_from_list','');processed+=Number(result.processed||0);failed+=Number(result.failed||0);}
      }
      else{var decision=action.operation==='restore'?'undecided':action.operation;result=await managementCandidateBulk(ids,decision,action.sectionKey||'');processed+=Number(result.processed||0);failed+=Number(result.failed||0);}
      details.push({operation:action.operation,requested:ids.length,ok:true});
    }catch(error){failed+=ids.length;details.push({operation:action.operation,requested:ids.length,ok:false,error:text(error&&error.message)||'execution_failed'});}}
    renderQueue(queueCandidateRows);renderProducts(productRows);return{ok:failed===0,processed:processed,failed:failed,details:details,summary:'AI 승인 관리 실행 · 요청 대상 '+preview.totalTargets+'건 · 처리 '+processed+'건 · 실패 '+failed+'건 · 프론트 공개·GitHub/Netlify 빌드 없음'};
  }
  window.IGDCCommerceManagementBridge={getContext:function(workspaceKey){return managementContext(workspaceKey);},preview:function(workspaceKey,actions){return previewManagementActions(workspaceKey,actions);},execute:function(preview){return executeManagementPreview(preview);}};

  function wireExcludedManagementCapture(){
    if(document.documentElement.getAttribute('data-excluded-management-capture')==='1')return;
    document.documentElement.setAttribute('data-excluded-management-capture','1');
    document.addEventListener('change',function(event){
      var target=event.target;if(!target||!target.getAttribute)return;
      var supplierAll=target.getAttribute('data-supplier-select-all'),supplierKind=target.getAttribute('data-supplier-select');
      if(supplierAll){supplierSelectionBoxes(supplierAll).forEach(function(box){box.checked=target.checked;});syncSupplierSelection(supplierAll);return;}
      if(supplierKind){syncSupplierSelection(supplierKind);return;}
      var productAll=target.getAttribute('data-product-exclusion-select-all'),productKind=target.getAttribute('data-product-exclusion-select');
      if(productAll){selectCurrentProductExclusionPage(productAll,target.checked);return;}
      if(productKind){setProductExclusionSelection(productKind,target.value,target.checked);syncProductExclusionSelection(productKind);return;}
    },true);
    document.addEventListener('click',function(event){
      var supplierButton=event.target&&event.target.closest?event.target.closest('[data-supplier-bulk]'):null;
      if(supplierButton){
        event.preventDefault();event.stopImmediatePropagation();
        var supplierScope=supplierButton.getAttribute('data-supplier-bulk-scope'),urls=supplierSelectedUrls(supplierScope);
        if(!urls.length){show('먼저 처리할 후보를 선택해 주세요.','warn');syncSupplierSelection(supplierScope);return;}
        applySupplierResearchAction(supplierButton.getAttribute('data-supplier-bulk'),urls);return;
      }
      var productButton=event.target&&event.target.closest?event.target.closest('[data-product-exclusion-bulk]'):null;
      if(productButton){
        event.preventDefault();event.stopImmediatePropagation();
        applyProductExclusionBulk(productButton.getAttribute('data-product-exclusion-scope'),productButton.getAttribute('data-product-exclusion-bulk'));
      }
    },true);
  }

  function wireSupplierResearchStart(){
    var btn=$('previewRunBtn');
    if(!btn||btn.getAttribute('data-igdc-supplier-search-wired')==='1')return;
    btn.setAttribute('data-igdc-supplier-search-wired','1');
    btn.addEventListener('click',function(event){event.preventDefault();runAutomation(true);});
  }
  function wire(){if(wired)return;wired=true;pipelineTraceWire();wireExcludedManagementCapture();document.addEventListener('click',function(event){var cell=event.target&&event.target.closest?event.target.closest('.supplier-select-cell'):null;if(!cell||event.target&&event.target.closest&&event.target.closest('input[type="checkbox"],a,button,label,select,textarea'))return;var box=cell.querySelector('input[type="checkbox"]:not(:disabled)');if(!box)return;event.preventDefault();box.click();});document.addEventListener('click',function(event){var target=event.target&&event.target.closest?event.target.closest('a[data-review-link]'):null;if(target)navigateReviewLink(target,event);},true);window.addEventListener('pageshow',function(event){if(event.persisted===true){hydrateReviewSnapshot();restoreReviewReturn();}});window.addEventListener('pagehide',saveReviewSnapshot);document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')saveReviewSnapshot();});document.addEventListener('click',function(event){var link=event.target&&event.target.closest?event.target.closest('a[href]'):null;if(!link)return;try{var target=new URL(link.href,location.href);if(target.origin===location.origin)saveReviewSnapshot();}catch(_e){}},true);document.addEventListener('keydown',function(event){if(event.key==='Escape'&&$('affiliateSettlementModal')&&!$('affiliateSettlementModal').classList.contains('hidden'))closeAffiliateSettlementModal();});if($('runtimeDiagnosticBtn'))$('runtimeDiagnosticBtn').addEventListener('click',runtimeDiagnostic);if($('runtimeDiagnosticDownloadBtn'))$('runtimeDiagnosticDownloadBtn').addEventListener('click',downloadRuntimeDiagnostic);if($('globalSituationBtn'))$('globalSituationBtn').addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();globalControlDiagnostic();},true);$('globalAutoModeBtn').addEventListener('click',function(){applyOperatingPreset('global_auto');});if($('selectedCountryAutoBtn'))$('selectedCountryAutoBtn').addEventListener('click',function(){applyOperatingPreset('country_auto');});if($('selectedCountryAutoStopBtn'))$('selectedCountryAutoStopBtn').addEventListener('click',function(){applyOperatingPreset('country_pause');});$('globalPauseBtn').addEventListener('click',function(){applyOperatingPreset('global_pause');});$('saveMasterBtn').addEventListener('click',async function(){try{await saveSetting({scopeType:'master',mode:$('masterMode').value,intervalDays:Number($('masterInterval').value),maxCandidates:20});show('전체 마스터 설정을 저장했습니다.','ok');}catch(e){show(text(e.message),'fail');}});$('saveScopeBtn').addEventListener('click',async function(){if(!selectedCountry)return;var type=selectedSubdivision==='NATIONWIDE'?'country':'subdivision';try{await saveSetting({scopeType:type,countryCode:selectedCountry,subdivisionCode:selectedSubdivision,mode:$('scopeMode').value,intervalDays:Number($('scopeInterval').value),maxCandidates:Number($('maxCandidates').value),expandSubdivisions:$('expandSubdivisions').value==='true',researchDirective:text($('supplierResearchDirective')&&$('supplierResearchDirective').value).slice(0,1200)});show('선택 범위 설정을 저장했습니다.','ok');}catch(e){show(text(e.message),'fail');}});$('useGeoBtn').addEventListener('click',function(){if(!geo||!geo.resolved){show('현재 배포 요청에서 지원되는 국가 IP를 확인하지 못했습니다.','warn');return;}invalidateJson();selectedCountry=geo.country;selectionSource='ip-detected';var c=country(selectedCountry);selectedSubdivision=validSubdivision(c,geo.region||'NATIONWIDE');selectedRegion=geo.worldRegion||c&&c.regionGroup||'';renderAll();show('현재 접속 IP 범위를 적용했습니다. 상세 원장을 순차적으로 읽습니다.','ok');loadScope('ip');});$('reloadBtn').addEventListener('click',function(){sessionResumeActive=false;geo=null;reloadData(true);});$('refreshScopeBtn').addEventListener('click',function(){loadScope('manual');});wireSupplierResearchStart();if($('researchPauseBtn'))$('researchPauseBtn').addEventListener('click',function(){researchStopRequested=true;$('researchPauseBtn').disabled=true;});$('runNowBtn').addEventListener('click',commitCountryPreview);$('diagnosticBtn').addEventListener('click',diagnostic);$('globalSignalBtn').addEventListener('click',function(){runMarketSignal('global');});$('regionalSignalBtn').addEventListener('click',function(){runMarketSignal('regional');});$('applySignalBtn').addEventListener('click',applyMarketSignal);$('countryCheckJumpBtn').addEventListener('click',function(){$('countryCheckPanel').scrollIntoView({behavior:'smooth',block:'start'});});$('downloadCurrentJsonBtn').addEventListener('click',download);if($('globalSignalDownloadBtn'))$('globalSignalDownloadBtn').addEventListener('click',function(){downloadRemembered('global');});if($('regionalSignalDownloadBtn'))$('regionalSignalDownloadBtn').addEventListener('click',function(){downloadRemembered('regional');});if($('downloadSignalJsonBtn'))$('downloadSignalJsonBtn').addEventListener('click',function(){downloadRemembered(lastSignalReport&&lastSignalReport.scope&&lastSignalReport.scope.type==='regional'?'regional':'global');});if($('countryRunDownloadBtn'))$('countryRunDownloadBtn').addEventListener('click',function(){downloadRemembered('country');});if($('diagnosticDownloadBtn'))$('diagnosticDownloadBtn').addEventListener('click',function(){downloadRemembered('diagnostic');});if($('globalControlDownloadBtn'))$('globalControlDownloadBtn').addEventListener('click',function(){downloadRemembered('globalControl');});if($('supplierManualRegisterBtn'))$('supplierManualRegisterBtn').addEventListener('click',registerManualSupplier);wireQueueControls();wireSupplierSelectionControls($('aiPanel'));wireSupplierSelectionControls($('supplierControlQueue'));if($('supplierControlQueue'))$('supplierControlQueue').addEventListener('toggle',syncSupplierControlToggleLabel);ensureProductQueueStageControls();syncProductQueueStageControls();ensureProductAiFinalizeControl();syncProductAiFinalizeControl();ensureLatestProductQueueControls();syncLatestProductQueueControls();if($('latestProductSelectAll'))$('latestProductSelectAll').addEventListener('change',function(){var checked=this.checked;if(!latestProductRowsComplete){this.checked=false;show('최신 목록의 모든 페이지를 불러온 뒤 전체 선택해 주세요.','warn');return;}latestVisibleResearchRows().forEach(function(row){var id=latestProductKey(row);if(id){if(checked)latestSelectedProducts[id]=true;else delete latestSelectedProducts[id];}});syncLatestProductQueueControls();});if($('latestSelectedQueueStageBtn'))$('latestSelectedQueueStageBtn').addEventListener('click',function(){runTwoStepProductReview('latest','restore','selected');});if($('latestSelectedAiBtn'))$('latestSelectedAiBtn').addEventListener('click',function(){runTwoStepProductReview('latest','verify','selected');});if($('latestVerifiedReviewReloadBtn'))$('latestVerifiedReviewReloadBtn').addEventListener('click',function(){runTwoStepProductReview('latest','status','all');});if($('latestAllQueueStageBtn'))$('latestAllQueueStageBtn').addEventListener('click',function(){runTwoStepProductReview('latest','restore','all');});if($('latestAllAiBtn'))$('latestAllAiBtn').addEventListener('click',function(){runTwoStepProductReview('latest','verify','all');});if($('latestSelectedVerifiedPsomBtn'))$('latestSelectedVerifiedPsomBtn').addEventListener('click',runLatestSelectedAi);if($('latestAllVerifiedPsomBtn'))$('latestAllVerifiedPsomBtn').addEventListener('click',runLatestAllAi);if($('latestSelectedQueueUnmatchBtn'))$('latestSelectedQueueUnmatchBtn').addEventListener('click',function(){runLatestProductQueueAction('unmatch','selected');});if($('latestSelectedQueueDeleteBtn'))$('latestSelectedQueueDeleteBtn').addEventListener('click',function(){runLatestProductQueueAction('delete','selected');});if($('latestSelectedPermanentExcludeBtn'))$('latestSelectedPermanentExcludeBtn').addEventListener('click',function(){runLatestProductQueueAction('purge','selected');});if($('latestExactDuplicateBtn'))$('latestExactDuplicateBtn').addEventListener('click',function(){var indexed={},duplicate=[];latestProductRows.forEach(function(r){var key=productUrlMatchKey(r.productUrl||r.url);if(!key)return;if(indexed[key])duplicate.push({url:key,name:text(r.productName||r.title),firstName:indexed[key],reason:'identical_detail_url'});else indexed[key]=text(r.productName||r.title);});var state=$('latestDuplicateState');if(state)state.textContent='동일 상세 URL 중복 '+duplicate.length+'건 · 이름/이미지만 같은 상품은 제외하지 않습니다.';if(!duplicate.length)return;try{var blob=new Blob([JSON.stringify({scope:scopeSnapshot(),checkedAt:new Date().toISOString(),duplicates:duplicate},null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='IGDC_LATEST_EXACT_DUPLICATES_'+text(selectedCountry)+'_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(a);a.click();setTimeout(function(){a.remove();URL.revokeObjectURL(url);},1200);}catch(e){show('중복 JSON 다운로드 실패: '+text(e&&e.message),'warn');}});if($('latestProductPanel'))$('latestProductPanel').addEventListener('change',function(event){var box=event.target&&event.target.closest?event.target.closest('[data-latest-queue-select]'):null;if(!box)return;latestSelectedProducts[box.value]=box.checked;syncLatestProductQueueControls();});if($('latestProductPanel'))$('latestProductPanel').addEventListener('click',function(event){var direct=event.target&&event.target.closest?event.target.closest('[data-latest-delete-one],[data-latest-purge-one]'):null;if(direct){event.preventDefault();event.stopPropagation();var deleting=direct.hasAttribute('data-latest-delete-one'),id=direct.getAttribute(deleting?'data-latest-delete-one':'data-latest-purge-one');runLatestProductQueueAction(deleting?'delete':'purge','selected',{idsOverride:[id]});return;}var button=event.target&&event.target.closest?event.target.closest('[data-management-pager=\"latest\"] [data-page-delta]'):null;if(!button)return;event.preventDefault();latestProductPage=clampPage(latestProductPage+Number(button.getAttribute('data-page-delta')||0),latestVisibleResearchRows().length,MANAGEMENT_PAGE_SIZE);renderLatestProductRows();});if($('productHoldAiVerifyBtn'))$('productHoldAiVerifyBtn').addEventListener('click',function(){runTwoStepProductReview('hold','verify','selected');});if($('productHoldReviewReloadBtn'))$('productHoldReviewReloadBtn').addEventListener('click',refreshHoldReviewInventory);if($('productHoldVerifyAndPlaceBtn'))$('productHoldVerifyAndPlaceBtn').addEventListener('click',function(){runTwoStepProductReview('hold','restore','selected');});if($('productResearchBtn'))$('productResearchBtn').addEventListener('click',runProductResearch);if($('productResearchPauseBtn'))$('productResearchPauseBtn').addEventListener('click',function(){productPausePersistPromise=requestProductPause();});if($('productQueueStageCurrentBtn'))$('productQueueStageCurrentBtn').addEventListener('click',function(){stageCurrentResearchQueue({automatic:false});});if($('productQueueAutoBtn'))$('productQueueAutoBtn').addEventListener('click',function(){saveProductPauseAutoQueue(!productPauseAutoQueue);if(productPauseAutoQueue&&productPausedForQueue&&!productLoopActive)stageCurrentResearchQueue({automatic:true});});if($('productResearchDownloadBtn'))$('productResearchDownloadBtn').addEventListener('click',function(){downloadRemembered('product');});if($('productCandidateLedgerAuditDownloadBtn'))$('productCandidateLedgerAuditDownloadBtn').addEventListener('click',downloadCandidateLedgerAudit);if($('productTransitionAuditBtn'))$('productTransitionAuditBtn').addEventListener('click',function(){runProductTransitionAudit({silent:false});});if($('productTransitionAuditDownloadBtn'))$('productTransitionAuditDownloadBtn').addEventListener('click',downloadProductTransitionAudit);if($('productAiAutoBtn'))$('productAiAutoBtn').addEventListener('click',function(){runProductAiAutomation('all','');});if($('productCandidateSmartAutoPlaceBtn'))$('productCandidateSmartAutoPlaceBtn').addEventListener('click',runAllCandidateSmartAutoPlacement);if($('productAiFinalizeBtn'))$('productAiFinalizeBtn').addEventListener('click',function(){finalizeProductAiDraft({internal:false});});if($('productFrontMatchBtn'))$('productFrontMatchBtn').addEventListener('click',function(){runProductFrontSync('match','all','');});if($('productFrontUnmatchBtn'))$('productFrontUnmatchBtn').addEventListener('click',function(){runProductFrontSync('unmatch','all','');});if($('affiliateSettlementCloseBtn'))$('affiliateSettlementCloseBtn').addEventListener('click',closeAffiliateSettlementModal);if($('affiliateSettlementCancelBtn'))$('affiliateSettlementCancelBtn').addEventListener('click',closeAffiliateSettlementModal);if($('affiliateSettlementSaveBtn'))$('affiliateSettlementSaveBtn').addEventListener('click',saveAffiliateSettlement);if($('affiliateSettlementModal'))$('affiliateSettlementModal').addEventListener('click',function(event){if(event.target===$('affiliateSettlementModal'))closeAffiliateSettlementModal();});if($('scopeAuditRefreshBtn'))$('scopeAuditRefreshBtn').addEventListener('click',function(){openScopeAudit(activeScopeAudit||'queue',true);});if($('scopeAuditOpenBtn'))$('scopeAuditOpenBtn').addEventListener('click',openFullScopeAudit);if($('scopeAuditDownloadBtn'))$('scopeAuditDownloadBtn').addEventListener('click',downloadScopeAudit);if($('scopeAuditCloseBtn'))$('scopeAuditCloseBtn').addEventListener('click',closeScopeAudit);$('returnBtn').addEventListener('click',function(){var q=new URLSearchParams(location.search),p=q.get('returnPath');location.href=p&&p.charAt(0)==='/'?p:'/admin.html';});$('countrySearch').addEventListener('input',renderCountries);$('clearSearchBtn').addEventListener('click',function(){$('countrySearch').value='';renderCountries();});$('showRegionBtn').addEventListener('click',function(){regionOnly=!regionOnly;$('showRegionBtn').textContent=regionOnly?'현재 권역만':'전 세계 전체';renderCountries();});wireHeavyPanels();var productPanel=$('productResearchPanel');if(productPanel){productPanel.addEventListener('click',function(event){var sectionAuto=event.target&&event.target.closest?event.target.closest('[data-section-ai-auto]'):null;if(sectionAuto){event.preventDefault();event.stopPropagation();var aiKey=sectionAuto.getAttribute('data-section-ai-auto');runProductAiAutomation(aiKey==='__all__'?'all':'section',aiKey==='__all__'?'':aiKey);return;}var productSectionRelease=event.target&&event.target.closest?event.target.closest('[data-product-section-release]'):null;if(productSectionRelease){event.preventDefault();event.stopPropagation();var releaseId=productSectionRelease.getAttribute('data-product-section-release');if(window.confirm('이 상품을 현재 20개 섹션 배치 예정 목록에서 해제하고 미배정 후보로 돌리시겠습니까?\n\n관리자 원장과 배치 원장을 함께 해제합니다. 프론트 공개 빌드는 별도 프론트 매칭에서 실행합니다.'))releaseCandidateSection([releaseId]).then(function(result){show('상품 섹션 해제 · 성공 '+Number(result&&result.processed||0)+'건 · 실패 '+Number(result&&result.failed||0)+'건',Number(result&&result.failed||0)?'warn':'ok');}).catch(function(error){show(conciseRequestError(error&&error.message,error&&error.status)||'상품 섹션 해제를 완료하지 못했습니다.','fail');});return;}var sectionSelectedRemove=event.target&&event.target.closest?event.target.closest('[data-section-selected-remove]'):null;if(sectionSelectedRemove){event.preventDefault();event.stopPropagation();removeSelectedSectionCandidates(sectionSelectedRemove.getAttribute('data-section-selected-remove'));return;}var sectionRankTrim=event.target&&event.target.closest?event.target.closest('[data-section-rank-trim]'):null;if(sectionRankTrim){event.preventDefault();event.stopPropagation();trimSectionByRanking(sectionRankTrim.getAttribute('data-section-rank-trim'));return;}var sectionFrontMatch=event.target&&event.target.closest?event.target.closest('[data-section-front-match]'):null;if(sectionFrontMatch){event.preventDefault();event.stopPropagation();runProductFrontSync('match','section',sectionFrontMatch.getAttribute('data-section-front-match'));return;}var sectionFrontUnmatch=event.target&&event.target.closest?event.target.closest('[data-section-front-unmatch]'):null;if(sectionFrontUnmatch){event.preventDefault();event.stopPropagation();runProductFrontSync('unmatch','section',sectionFrontUnmatch.getAttribute('data-section-front-unmatch'));return;}var apply=event.target&&event.target.closest?event.target.closest('[data-product-management-apply]'):null;if(apply){var id=apply.getAttribute('data-product-management-apply'),card=apply.closest('.product-card'),selection=card&&card.querySelector('[data-product-management-select]'),value=selection?selection.value:(productPlacementSelections[id]||'');if(value)productPlacementSelections[id]=value;if(value.indexOf('affiliate:')===0){openAffiliateSettlementModal(id,value.slice(10));return;}var decision=value.indexOf('section:')===0?'slot_candidate':value,key=decision==='slot_candidate'?value.slice(8):'';if(!decision){show('관리 작업을 먼저 선택해 주세요.','warn');return;}applyProductDecision(id,decision,key);return;}var candidateDelete=event.target&&event.target.closest?event.target.closest('[data-candidate-delete-one]'):null;if(candidateDelete){event.preventDefault();event.stopPropagation();removeSinglePrivateCandidate(candidateDelete.getAttribute('data-candidate-delete-one'));return;}var action=event.target&&event.target.closest?event.target.closest('[data-product-action]'):null;if(action){applyProductDecision(action.getAttribute('data-product-id'),action.getAttribute('data-product-action'),productPlacementSelections[action.getAttribute('data-product-id')]||'');}});productPanel.addEventListener('change',function(event){var classSelect=event.target&&event.target.getAttribute&&event.target.getAttribute('data-hold-class-check'),classAll=event.target&&event.target.getAttribute&&event.target.getAttribute('data-hold-class-all');if(classAll){var reviewRows=productExcludedRows(classAll),reviewKey='holdReview:'+classAll,reviewPage=clampPage(candidateGroupPages[reviewKey]||0,reviewRows.length,MANAGEMENT_PAGE_SIZE);reviewRows.slice(reviewPage*MANAGEMENT_PAGE_SIZE,(reviewPage+1)*MANAGEMENT_PAGE_SIZE).forEach(function(r){var id=managementRowId(r);if(event.target.checked)reviewClassSelections[classAll][id]=true;else delete reviewClassSelections[classAll][id];});renderHoldReviewClasses();return;}if(classSelect){reviewClassSelections[classSelect][text(event.target.value)]=event.target.checked;renderHoldReviewClasses();return;}var management=event.target&&event.target.getAttribute&&event.target.getAttribute('data-product-management-select');if(management){productPlacementSelections[management]=event.target.value;var card=event.target.closest('.product-card'),button=card&&card.querySelector('[data-product-management-apply]');if(button)button.disabled=!event.target.value;return;}var kind=event.target&&event.target.getAttribute&&event.target.getAttribute('data-product-exclusion-select'),all=event.target&&event.target.getAttribute&&event.target.getAttribute('data-product-exclusion-select-all');if(all){selectCurrentProductExclusionPage(all,event.target.checked);}else if(kind){setProductExclusionSelection(kind,event.target.value,event.target.checked);syncProductExclusionSelection(kind);}});productPanel.addEventListener('click',function(event){var verifiedRestoreBtn=event.target&&event.target.closest?event.target.closest('#productHoldVerifiedRestoreBtn'):null;if(verifiedRestoreBtn){event.preventDefault();event.stopPropagation();runTwoStepProductReview('hold','restore','selected');return;}var classAction=event.target&&event.target.closest?event.target.closest('[data-hold-review-action]'):null;if(classAction){event.preventDefault();event.stopPropagation();applyHoldReviewClass(classAction.getAttribute('data-hold-review-action'));return;}var originalLookup=event.target&&event.target.closest?event.target.closest('[data-hold-original-lookup]'):null;if(originalLookup){event.preventDefault();event.stopPropagation();inspectHoldOriginalProductLink(originalLookup);return;}var verifyStopButton=event.target&&event.target.closest?event.target.closest('#productHoldVerifyStopBtn'):null;if(verifyStopButton){event.preventDefault();event.stopPropagation();productHoldVerifyStopRequested=true;var progress=$('productHoldVerifyProgress');if(progress)progress.textContent='현재 상품 검증 요청이 끝나면 중단합니다.';return;}var verifyOne=event.target&&event.target.closest?event.target.closest('[data-hold-verify-one]'):null;if(verifyOne){event.preventDefault();event.stopPropagation();var verifyId=text(verifyOne.getAttribute('data-hold-verify-one'));if(verifyId)runTwoStepProductReview('hold','verify','selected',[verifyId]);return;}var classPager=event.target&&event.target.closest?event.target.closest('[data-management-pager="holdreview"] [data-page-delta]'):null;if(classPager){event.preventDefault();var wrapClass=classPager.closest('[data-management-pager="holdreview"]'),classKind=wrapClass.getAttribute('data-management-pager-key'),pg='holdReview:'+classKind;candidateGroupPages[pg]=clampPage((candidateGroupPages[pg]||0)+Number(classPager.getAttribute('data-page-delta')||0),productExcludedRows(classKind).length,MANAGEMENT_PAGE_SIZE);renderHoldReviewClasses();return;}var pager=event.target&&event.target.closest?event.target.closest('[data-management-pager="excluded"] [data-page-delta]'):null;if(pager){event.preventDefault();var wrap=pager.closest('[data-management-pager="excluded"]'),kind=wrap&&wrap.getAttribute('data-management-pager-key'),rows=productExcludedRows(kind),stateKey='excluded:'+kind;candidateGroupPages[stateKey]=clampPage((candidateGroupPages[stateKey]||0)+Number(pager.getAttribute('data-page-delta')||0),rows.length,MANAGEMENT_PAGE_SIZE);renderProductExcludedTable(kind);return;}var button=event.target&&event.target.closest?event.target.closest('[data-product-exclusion-bulk]'):null;if(button)applyProductExclusionBulk(button.getAttribute('data-product-exclusion-scope'),button.getAttribute('data-product-exclusion-bulk'));});Array.prototype.forEach.call(productPanel.querySelectorAll('#supplierControlQueue,#productHoldQueue,#productRejectQueue'),function(details){details.addEventListener('toggle',function(){var label=details.querySelector('[data-detail-toggle-label]');if(label)syncDetailsToggle(details,label);if(details.open&&$('excludedLedgerPanel')&&$('excludedLedgerPanel').open){if(details.id==='supplierControlQueue')renderSupplierExcludedRows();else if(details.id==='productHoldQueue')renderProductExcludedTable('hold');else renderProductExcludedTable('reject');}else if(!details.open){var body=details.querySelector('tbody');if(body)body.innerHTML='';}});});}}
  function wireCandidateBulkControls(){
    var panel=$('productResearchPanel');if(!panel)return;
    panel.addEventListener('pointerdown',function(event){var target=event.target;if(!target||!target.getAttribute)return;if(target.getAttribute('data-candidate-select-all')){if(target.indeterminate)target.setAttribute('data-clear-indeterminate','1');else target.removeAttribute('data-clear-indeterminate');}});
    panel.addEventListener('change',function(event){var target=event.target;if(!target||!target.getAttribute)return;var groupKey=target.getAttribute('data-candidate-select');if(groupKey){candidateSelectedProducts[target.value]=target.checked===true;syncCandidateSelectionControls(groupKey);if(groupKey==='latest_research')syncLatestResearchUnifiedSelection();saveReviewSnapshot();return;}groupKey=target.getAttribute('data-candidate-select-all');if(groupKey){var checked=target.getAttribute('data-clear-indeterminate')==='1'?false:target.checked===true;target.removeAttribute('data-clear-indeterminate');candidateGroupRows(groupKey).forEach(function(row){var id=text(row.id);if(checked)candidateSelectedProducts[id]=true;else delete candidateSelectedProducts[id];});syncCandidateSelectionControls(groupKey);saveReviewSnapshot();}});
    panel.addEventListener('click',function(event){var qualityUnmatch=event.target&&event.target.closest?event.target.closest('[data-quality-unmatch]'):null;if(qualityUnmatch){event.preventDefault();event.stopPropagation();var qualityIds=selectedCandidateIds('quality_review');if(!qualityIds.length){show('먼저 대표 이미지 검토 상품을 선택해 주세요.','warn');return;}runProductFrontSync('unmatch','candidates','','',qualityIds);return;}var repair=event.target&&event.target.closest?event.target.closest('[data-candidate-repair-auto]'):null;if(repair){event.preventDefault();event.stopPropagation();var groupRows=candidateGroupRows('assignment_repair'),repairIds=groupRows.map(function(row){return text(row&&row.candidateId||row&&row.id);}).filter(Boolean);if(!repairIds.length){show('복구할 배정정보 누락 상품이 없습니다.','warn');return;}repairMissingCandidatePlacements(repairIds,{onProgress:function(_stage,done,total,errors){setCandidateBulkState('assignment_repair','배정정보 복구 '+done+'/'+total+'건 · 추가 확인 '+errors+'건',errors?'warn':'working');}}).then(function(result){var msg='배정정보 복구 '+result.restored+'건 · 기존 배치 보존 '+result.preserved+'건 · 검증 필요 '+result.failed+'건';setCandidateBulkState('assignment_repair',msg+(result.errors.length?' · '+result.errors.slice(0,2).join(' / '):''),result.failed?'warn':'ok');show(msg,result.failed?'warn':'ok');}).catch(function(e){show(conciseRequestError(e&&e.message,e&&e.status),'fail');});return;}var button=event.target&&event.target.closest?event.target.closest('[data-candidate-bulk]'):null;if(!button)return;event.preventDefault();event.stopPropagation();runCandidateBulkAction(button.getAttribute('data-candidate-group'),button.getAttribute('data-candidate-bulk'));});
  }
  function wireFrontSelectionControls(){
    if($('allSectionsSelect'))$('allSectionsSelect').addEventListener('change',function(){var checked=$('allSectionsSelect').checked===true;PRODUCT_SECTIONS.forEach(function(section){frontSelectedSections[section.key]=checked;});syncFrontSelectionControls();saveReviewSnapshot();});
    if($('selectedSectionsMatchBtn'))$('selectedSectionsMatchBtn').addEventListener('click',function(){runProductFrontSync('match','sections','','',selectedSectionKeys());});
    if($('allSectionsMatchBtn'))$('allSectionsMatchBtn').addEventListener('click',function(){runProductFrontSync('match','all','','');});if($('allSectionsRankTrimBtn'))$('allSectionsRankTrimBtn').addEventListener('click',trimAllSectionsByRanking);
    if($('selectedSectionsUnmatchBtn'))$('selectedSectionsUnmatchBtn').addEventListener('click',function(){runProductFrontSync('unmatch','sections','','',selectedSectionKeys());});
    if($('allSectionsUnmatchBtn'))$('allSectionsUnmatchBtn').addEventListener('click',function(){runProductFrontSync('unmatch','all','','');});
    var panel=$('productResearchPanel');if(!panel)return;
    panel.addEventListener('click',function(event){var selected=event.target&&event.target.closest?event.target.closest('[data-selected-products-front]'):null;if(!selected)return;event.preventDefault();event.stopPropagation();var sectionKey=selected.getAttribute('data-selected-products-front'),operation=selected.getAttribute('data-front-operation')==='unmatch'?'unmatch':'match',ids=selectedProductIds(sectionKey);runProductFrontSync(operation,'candidates','','',ids);});
    panel.addEventListener('change',function(event){var target=event.target;if(!target||!target.getAttribute)return;if(target.hasAttribute('data-section-front-select')){frontSelectedSections[target.value]=target.checked===true;syncFrontSelectionControls();saveReviewSnapshot();return;}if(target.hasAttribute('data-product-front-select')){frontSelectedProducts[target.value]=target.checked===true;syncFrontSelectionControls();saveReviewSnapshot();return;}var sectionKey=target.getAttribute('data-section-products-select-all');if(sectionKey){sectionRows(sectionKey).forEach(function(row){frontSelectedProducts[text(row.id)]=target.checked===true;});syncFrontSelectionControls();saveReviewSnapshot();}});
  }
  async function boot(){
    try{document.documentElement.setAttribute('data-igdc-frontmatch-version',FRONT_MATCH_CLIENT_VERSION);}catch(_e){}
    prepareReviewReturn();wireSupplierResearchStart();try{wire();}catch(wireError){show('관리자 부가기능 연결 중 오류가 발견됐습니다: '+text(wireError&&wireError.message)+' · 업체 검색 버튼은 별도로 연결했습니다.','fail');}wireCandidateBulkControls();wireFrontSelectionControls();wireSectionRevenueControls();wireSectionLedgerAuditControls();if($('runCurrentDiagnosticBtn'))$('runCurrentDiagnosticBtn').addEventListener('click',diagnostic);keepJsonPanelVisible('통합 점검 JSON을 실행하면 이 영역에 요약이 표시되고 전체 원문 다운로드가 활성화됩니다.');
    var restored=hydrateReviewSnapshot();restoreReviewReturn();
    await reloadData(false,restored);
    await refreshFrontSnapshotCounts();
    var dataRestored=restored&&applySessionDataResume();
    // Session cache restores only the operator's view immediately. The current
    // administrator ledger must always be read afterward so stale browser state
    // can never replace today's candidate/section authority.
    await loadScope(dataRestored?'session-refresh':(restored?'session-resume':'initial'));
    /* Front snapshots are read-only monitoring data. Never reverse-write them
       into the administrator ledger during boot or any later refresh. */
    if(restored){sessionResumeActive=true;applySessionUiResume();restoreReviewReturn();stateEl.textContent=dataRestored?'관리 작업 범위·원장·화면 위치를 현재 브라우저 세션에서 즉시 복원했습니다. 실제 프론트는 방문자의 접속 IP로 계속 라우팅됩니다.':'관리 범위를 복원하고 최신 원장을 읽었습니다. 실제 프론트는 방문자의 접속 IP로 계속 라우팅됩니다.';saveReviewSnapshot();}
  }
  document.addEventListener('igdc:member-auth-ready',function(){acceptedToken='';acceptedSession=null;if(sessionResumeActive||returnRestoreActive||Date.now()-lastPassiveRestoreAt<15000){ensureSession(false).catch(function(){});return;}reloadData(false).then(function(){loadScope('auth-refresh');});});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
