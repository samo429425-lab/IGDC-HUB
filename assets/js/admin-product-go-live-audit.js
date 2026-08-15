/* IGDC real-product go-live audit admin v1.4.0
 * Authenticated live private-stage audit plus explicit, targeted publication request.
 */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/product-go-live-audit', CONTROL_ENDPOINT='/.netlify/functions/commerce-country-control';
  var $=function(id){return document.getElementById(id);};
  var esc=function(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(value){return String(value==null?'':value).trim();};
  var lastReport=null,acceptedToken='',candidateStore={},selectedCandidateId='',lastSupplierJob=null,lastSupplierScopeData=null,supplierStopRequested=false,supplierResearchLoop=false;
  var TOKEN_KEYS=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token'];

  function scopeContext(){
    var q=new URLSearchParams(location.search);
    var country=text(q.get('country')).toUpperCase();
    var region=text(q.get('region')||'NATIONWIDE').toUpperCase();
    return {country:country==='GLOBAL'?'GLOBAL':(/^[A-Z]{2}$/.test(country)?country:''),region:region||'NATIONWIDE'};
  }
  var ACTIVE_SCOPE=scopeContext();
  function scopeLabel(){return ACTIVE_SCOPE.country?((ACTIVE_SCOPE.country==='GLOBAL'?'전 세계':ACTIVE_SCOPE.country)+' / '+(ACTIVE_SCOPE.region||'NATIONWIDE')):'현재 접속 IP 자동 판정';}
  function mode(){return $('auditMode')&&$('auditMode').value==='production'?'production':'pre-product';}
  function statusClass(value){var v=text(value).toLowerCase();return v==='ok'?'ok':v==='warn'?'warn':v==='fail'||v==='error'?'fail':'info';}
  function setStatus(message,kind){var el=$('status');el.className='small status '+statusClass(kind);el.textContent=message;}
  function number(value){var n=Number(value);return Number.isFinite(n)?n:0;}
  function nowStamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
  function download(name,body,type){var blob=new Blob([body],{type:type||'text/plain;charset=utf-8'});var href=URL.createObjectURL(blob);var a=document.createElement('a');a.href=href;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();setTimeout(function(){try{a.remove();URL.revokeObjectURL(href);}catch(_e){}},0);}

  function jwt(value){var token=text(value);return token.split('.').length===3&&token.length>32?token:'';}
  function parseJson(value){try{return JSON.parse(value);}catch(_e){return null;}}
  function pushToken(value,out,seen,depth){
    if(depth>4||value==null)return;
    if(typeof value==='string'){
      var token=jwt(value);if(token&&!seen[token]){seen[token]=true;out.push(token);return;}
      var parsed=parseJson(value);if(parsed)pushToken(parsed,out,seen,depth+1);return;
    }
    if(Array.isArray(value)){value.forEach(function(item){pushToken(item,out,seen,depth+1);});return;}
    if(typeof value==='object'){
      ['id_token','idToken','access_token','accessToken','token','__raw','raw'].forEach(function(key){pushToken(value[key],out,seen,depth+1);});
    }
  }
  function sameOriginWindows(){
    var values=[],seen=[];
    function add(candidate){try{if(!candidate||seen.indexOf(candidate)>=0)return;void candidate.location.href;seen.push(candidate);values.push(candidate);}catch(_e){}}
    add(window);try{add(window.parent);}catch(_e){}try{add(window.top);}catch(_e){}return values;
  }
  function storageTokens(source,out,seen){
    [source&&source.localStorage,source&&source.sessionStorage].forEach(function(store){if(!store)return;TOKEN_KEYS.forEach(function(key){try{pushToken(store.getItem(key),out,seen,0);}catch(_e){}});});
  }
  async function tokenCandidates(){
    var out=[],seen={},tasks=[];
    function take(fn){tasks.push(Promise.resolve().then(fn).then(function(value){pushToken(value,out,seen,0);}).catch(function(){}));}
    sameOriginWindows().forEach(function(source){
      take(function(){return source.IGDCMemberAuth&&source.IGDCMemberAuth.getIdToken?source.IGDCMemberAuth.getIdToken():'';});
      take(function(){return source.osAuth&&source.osAuth.getIdToken?source.osAuth.getIdToken():'';});
      take(function(){return source.osAuth&&source.osAuth.getIdTokenClaims?source.osAuth.getIdTokenClaims():'';});
      storageTokens(source,out,seen);
    });
    await Promise.all(tasks);return out;
  }
  function requestUrl(){
    var u=new URL(ENDPOINT,location.origin);u.searchParams.set('mode',mode());u.searchParams.set('limit','120');u.searchParams.set('ts',String(Date.now()));
    if(ACTIVE_SCOPE.country){u.searchParams.set('country',ACTIVE_SCOPE.country);u.searchParams.set('region',ACTIVE_SCOPE.region||'NATIONWIDE');}
    return u.pathname+u.search;
  }
  async function fetchWithToken(token,method,body){
    var verb=method||'GET';var headers={Authorization:'Bearer '+token,Accept:'application/json'};var init={method:verb,headers:headers,credentials:'same-origin',cache:'no-store'};
    var url=requestUrl();
    if(verb!=='GET'){headers['Content-Type']='application/json';init.body=JSON.stringify(body||{});url=ENDPOINT;}
    var response=await fetch(url,init);var data=null;try{data=await response.json();}catch(_e){}
    if(!response.ok||!data||data.ok!==true){var error=new Error((data&&data.error)||('HTTP '+response.status));error.status=response.status;error.code=data&&data.code;throw error;}
    return data;
  }
  async function authenticated(method,body){
    if(acceptedToken){try{return await fetchWithToken(acceptedToken,method,body);}catch(error){if(Number(error.status)!==401)throw error;acceptedToken='';}}
    var tokens=await tokenCandidates();var last=null;
    for(var i=0;i<tokens.length;i++){
      try{var result=await fetchWithToken(tokens[i],method,body);acceptedToken=tokens[i];return result;}catch(error){last=error;if(Number(error.status)!==401)throw error;}
    }
    throw last||new Error('관리자 공통 세션을 확인하지 못했습니다. 관리자 화면에서 로그인 상태를 확인해 주세요.');
  }

  function controlScope(){var country=text(ACTIVE_SCOPE.country).toUpperCase(),region=text(ACTIVE_SCOPE.region||'NATIONWIDE').toUpperCase();if(!/^[A-Z]{2}$/.test(country))return null;if(!region||region==='ALL')region='NATIONWIDE';return{country:country,region:region};}
  function updateControlScope(scope){var country=text(scope&&scope.country).toUpperCase(),region=text(scope&&scope.region||'NATIONWIDE').toUpperCase();if(/^[A-Z]{2}$/.test(country)){ACTIVE_SCOPE={country:country,region:region||'NATIONWIDE'};try{sessionStorage.setItem('igdc_admin_country_scope_v1',JSON.stringify({country:country,region:region||'NATIONWIDE',updatedAt:new Date().toISOString(),source:'product-go-live-audit'}));}catch(_e){}}}
  async function controlFetchToken(token,action,method,body){
    var verb=method||'GET',scope=controlScope(),u=new URL(CONTROL_ENDPOINT,location.origin);u.searchParams.set('action',action);if(action!=='geo'&&action!=='session'&&scope){u.searchParams.set('country',scope.country);u.searchParams.set('region',scope.region);}
    var headers={Authorization:'Bearer '+token,Accept:'application/json'},init={method:verb,headers:headers,credentials:'same-origin',cache:'no-store'};
    if(verb!=='GET'){if(!scope)throw new Error('공급업체 관리 국가 범위를 확인하지 못했습니다.');headers['Content-Type']='application/json';init.body=JSON.stringify(Object.assign({action:action,countryCode:scope.country,subdivisionCode:scope.region},body||{}));}
    var response=await fetch(u.pathname+u.search,init),data=null;try{data=await response.json();}catch(_e){}if(!response.ok||!data||data.ok!==true){var error=new Error((data&&data.error)||('HTTP '+response.status));error.status=response.status;error.code=data&&data.code;throw error;}return data;
  }
  async function controlAuthenticated(action,method,body){
    if(acceptedToken){try{return await controlFetchToken(acceptedToken,action,method,body);}catch(error){if(Number(error.status)!==401)throw error;acceptedToken='';}}
    var tokens=await tokenCandidates(),last=null;for(var i=0;i<tokens.length;i++){try{var result=await controlFetchToken(tokens[i],action,method,body);acceptedToken=tokens[i];return result;}catch(error){last=error;if(Number(error.status)!==401)throw error;}}throw last||new Error('관리자 공통 세션을 확인하지 못했습니다.');
  }
  async function ensureSupplierScope(){
    var scope=controlScope();if(scope)return scope;
    if(lastReport&&lastReport.selectedScope)updateControlScope(lastReport.selectedScope);scope=controlScope();if(scope)return scope;
    var geo=await controlAuthenticated('geo','GET');if(geo&&geo.country)updateControlScope({country:geo.country,region:geo.region||'NATIONWIDE'});scope=controlScope();if(!scope)throw new Error('현재 접속 국가 범위를 확인하지 못했습니다. 국가·권역 관리 화면에서 범위를 먼저 선택해 주세요.');return scope;
  }
  function supplierUrl(row){return text(row&&[row.url,row.normalizedSupplierUrl,row.supplierOfficialUrl,row.sourceCandidateUrl].filter(Boolean)[0]);}
  function uniqueSupplierRows(rows){var out=[],seen={};(Array.isArray(rows)?rows:[]).forEach(function(row){var url=supplierUrl(row).toLowerCase();if(!url||seen[url])return;seen[url]=true;out.push(row);});return out;}
  function supplierStateText(job,scopeData){var summary=job&&job.summary||{},effective=scopeData&&scopeData.effective||{},status=text(job&&job.status||'not_started'),labels={not_started:'리서치 시작 전',searching:'새 업체 검색 중',inspecting:'새 업체 증빙 점검 중',ranking:'새 업체 AI 평가 중',complete:'추가 리서치 완료',committed:'신규 업체 원장 등록 완료'};return (labels[status]||status)+' · 설정 목표 '+number(summary.targetTotalCandidates||effective.maxCandidates||0)+' · 기존 보존 '+number(summary.preservedExisting||0)+' · 신규 목표 '+number(summary.newCandidateTarget||0)+' · 신규 확보 '+number(summary.newRanked||0)+' · 현재 활성 '+number(summary.ranked||((job&&job.candidates||[]).length))+(summary.duplicateResearchSkipped===true?' · 기존 업체 중복 리서치 없음':'');}
  function supplierActionButtons(row,state){var url=supplierUrl(row);if(!url)return'-';var encoded=esc(url);if(state==='active')return '<div class="supplier-row-actions"><button data-supplier-action="hold" data-supplier-url="'+encoded+'">보류로 이동</button><button class="danger" data-supplier-action="purge" data-supplier-url="'+encoded+'">URL 영구 제외</button><button class="danger" data-supplier-action="block" data-supplier-url="'+encoded+'">도메인 차단</button></div>';if(state==='holding')return '<div class="supplier-row-actions"><button data-supplier-action="restore" data-supplier-url="'+encoded+'">활성 후보로 복원</button><button data-supplier-action="dismiss" data-supplier-url="'+encoded+'">목록에서 제거</button><button class="danger" data-supplier-action="purge" data-supplier-url="'+encoded+'">URL 영구 제외</button></div>';return '<div class="supplier-row-actions"><button data-supplier-action="unblock" data-supplier-url="'+encoded+'">차단 해제 → 보류</button></div>';}
  function supplierRowsTable(rows,state){rows=uniqueSupplierRows(rows);if(!rows.length)return'<div class="small">해당 목록이 비어 있습니다.</div>';return '<div class="tablewrap"><table><thead><tr><th>업체</th><th>공식 URL</th><th>신뢰·상태</th><th>관리</th></tr></thead><tbody>'+rows.slice(0,250).map(function(row){var evidence=row.evidence||{},trust=number(row.trustScore||row.score||0),status=text(row.queueState||row.status||state),manual=row.manualRegistered===true?' · 직접등록':'';return '<tr><td><strong>'+esc(row.title||row.name||'-')+'</strong><br><span class="small">'+esc(row.supplierType||'-')+manual+'</span></td><td class="mono">'+esc(supplierUrl(row)||'-')+'</td><td>'+esc(status)+'<br><span class="small">신뢰 '+esc(trust)+' · 증빙 '+esc(evidence.supplierReviewEligible===true||row.hardGatePassed===true?'확인':'점검중')+'</span></td><td>'+supplierActionButtons(row,state)+'</td></tr>';}).join('')+'</tbody></table></div>';}
  function renderSupplierManager(job,scopeData){
    lastSupplierJob=job||{},lastSupplierScopeData=scopeData||{};var persisted=uniqueSupplierRows(scopeData&&scopeData.candidates||[]),active=uniqueSupplierRows((job&&job.candidates&&job.candidates.length)?job.candidates:persisted.filter(function(row){return !/hold|suppressed|blocked|rejected|disabled/i.test(text(row.status));})),holding=uniqueSupplierRows(job&&job.holdingCandidates||[]),blocked=uniqueSupplierRows(job&&job.blockedCandidates||[]);
    $('supplierResearchState').textContent=scopeLabel()+' · '+supplierStateText(job,scopeData);var status=text(job&&job.status),newRanked=number(job&&job.summary&&job.summary.newRanked||0);$('supplierCommitBtn').disabled=!(status==='complete'&&newRanked>0);$('supplierResearchPauseBtn').disabled=!supplierResearchLoop;
    $('supplierLists').innerHTML='<details open><summary>활성 책임 공급업체 '+active.length+'개</summary><div class="inside">'+supplierRowsTable(active,'active')+'</div></details><details><summary>보류 업체 '+holding.length+'개</summary><div class="inside">'+supplierRowsTable(holding,'holding')+'</div></details><details><summary>차단·영구 제외 업체 '+blocked.length+'개</summary><div class="inside">'+supplierRowsTable(blocked,'blocked')+'</div></details>';
    Array.prototype.forEach.call($('supplierLists').querySelectorAll('[data-supplier-action]'),function(button){button.addEventListener('click',function(){supplierCandidateAction(button.getAttribute('data-supplier-action'),button.getAttribute('data-supplier-url'));});});
  }
  async function loadSupplierManager(){
    try{await ensureSupplierScope();$('supplierResearchState').textContent=scopeLabel()+' · 공급업체 원장을 읽는 중입니다…';var values=await Promise.all([controlAuthenticated('scope','GET'),controlAuthenticated('research_status','GET')]);renderSupplierManager(values[1]||{},values[0]||{});}catch(error){$('supplierResearchState').textContent='공급업체 관리 읽기 실패: '+text(error&&error.message||error);}
  }
  async function ensureSupplierWorkspace(){var job=lastSupplierJob||{};if(text(job.status)&&text(job.status)!=='not_started')return job;await ensureSupplierScope();job=await controlAuthenticated('research_begin','POST',{restart:true});lastSupplierJob=job;return job;}
  async function supplierCandidateAction(action,url){
    if(!url)return;var destructive=action==='purge'||action==='block'||action==='dismiss';if(destructive&&!window.confirm('선택 업체에 '+(action==='block'?'도메인 차단':action==='purge'?'URL 영구 제외':'목록 제거')+'를 적용하시겠습니까?'))return;
    try{await ensureSupplierWorkspace();$('supplierResearchState').textContent='업체 상태를 변경하는 중입니다…';var job=await controlAuthenticated('research_candidate_action','POST',{decision:action,urls:[url]});renderSupplierManager(job,lastSupplierScopeData||{});}catch(error){$('supplierResearchState').textContent='업체 관리 실패: '+text(error&&error.message||error);}
  }
  async function runSupplierResearch(){
    if(supplierResearchLoop)return;try{await ensureSupplierScope();supplierResearchLoop=true;supplierStopRequested=false;$('supplierResearchBtn').disabled=true;$('supplierResearchPauseBtn').disabled=false;var currentStatus=text(lastSupplierJob&&lastSupplierJob.status),resume=/^(searching|inspecting|ranking)$/.test(currentStatus);var job=await controlAuthenticated('research_begin','POST',resume?{}:{restart:true});
      while(true){lastSupplierJob=job;renderSupplierManager(job,lastSupplierScopeData||{});var status=text(job.status);if(status==='complete'||status==='committed')break;if(supplierStopRequested)break;await new Promise(function(resolve){setTimeout(resolve,250);});job=await controlAuthenticated('research_step','POST',{jobId:job.jobId});}
      if(supplierStopRequested)$('supplierResearchState').textContent=scopeLabel()+' · 리서치를 일시정지했습니다. 저장된 지점에서 다시 이어갈 수 있습니다.';else $('supplierResearchState').textContent=scopeLabel()+' · '+supplierStateText(job,lastSupplierScopeData||{});
    }catch(error){$('supplierResearchState').textContent='추가 업체 리서치 실패: '+text(error&&error.message||error);}finally{supplierResearchLoop=false;$('supplierResearchBtn').disabled=false;$('supplierResearchPauseBtn').disabled=true;}
  }
  async function commitSupplierResearch(){try{var job=lastSupplierJob||{};if(text(job.status)!=='complete'){throw new Error('먼저 추가 업체 리서치를 완료해 주세요.');}$('supplierCommitBtn').disabled=true;var result=await controlAuthenticated('research_commit','POST',{jobId:job.jobId});$('supplierResearchState').textContent=(result.note||('신규 업체 후보 원장 등록 완료 · 신규 '+number(result.newSuppliersCommitted||0)+' · 기존 보존 '+number(result.preservedExistingSuppliers||0)));await loadSupplierManager();}catch(error){$('supplierResearchState').textContent='업체 후보 원장 등록 실패: '+text(error&&error.message||error);}}
  async function registerManualSupplier(event){event.preventDefault();try{await ensureSupplierScope();var name=text($('supplierManualName').value),officialUrl=text($('supplierManualUrl').value),productPageUrl=text($('supplierManualProductUrl').value),supplierType=text($('supplierManualType').value);var job=await controlAuthenticated('supplier_manual_register','POST',{name:name,officialUrl:officialUrl,productPageUrl:productPageUrl,supplierType:supplierType});$('supplierManualForm').reset();$('supplierManualType').value='responsible_seller';renderSupplierManager(job,lastSupplierScopeData||{});$('supplierResearchState').textContent=scopeLabel()+' · 업체를 직접 등록했습니다. 기존 업체와 동일 URL이면 중복 생성하지 않고 갱신합니다.';}catch(error){$('supplierResearchState').textContent='업체 직접 등록 실패: '+text(error&&error.message||error);}}
  function openSupplierCountryManager(){var scope=controlScope();if(!scope){$('supplierResearchState').textContent='국가 범위를 먼저 확인해 주세요.';return;}var target=new URL('/commerce-country-control.html',location.origin);target.searchParams.set('country',scope.country);target.searchParams.set('region',scope.region);target.searchParams.set('returnPath',location.pathname+location.search);location.href=target.pathname+target.search;}

  function card(title,value,small){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num">'+esc(value)+'</div><div class="small">'+esc(small||'')+'</div></article>';}
  function gateLabel(state){return ({not_ready:'준비 전',hold:'보완·설정 필요',ready_for_publication_request:'최종 게재 요청 가능',ready_for_canary:'게재 후 카나리 가능'})[text(state)]||text(state)||'확인 필요';}
  function stageLabel(stage){return ({private_research_queue:'비공개 리서치 대기열',administrator_selection_pending:'관리자 선택 대기',market_evidence_pending:'시장 근거 대기',trust_evidence_pending:'검증 증빙 대기',revenue_route_pending:'수익 경로 대기',slot_assignment_pending:'PSOM 배정 대기',registry_sync_ready:'개방 점검 후보 확정',staged_release_review:'비공개 공급 개방 스테이지',canonical_canary_ready:'카나리 준비'})[text(stage)]||text(stage)||'검토 대기';}
  function reasonLabel(reason){return ({
    'no-real-product-candidate':'실상품 후보 없음',
    'select-production-mode-for-final-publication-request':'최종 게재 요청 전 실상품 운영 모드를 선택해야 함',
    'release-gate-not-armed':'배포 환경의 실상품 공개 게이트가 비활성',
    'publication-build-hook-not-configured':'사이트 게재 빌드 훅 미설정',
    'select-one-audited-candidate-and-confirm-publication':'개방 점검 후보 한 건을 선택하고 최종 확인 필요',
    'private-candidates-awaiting-evidence-revenue-or-psom-approval':'대기열의 시장·증빙·수익·PSOM 승인 미완료',
    'real-products-require-front-readiness':'공개 스냅샷 실상품의 프론트 준비 부족',
    'snapshot-copies-not-synchronized':'공개·함수 스냅샷 복사본 불일치',
    'published-products-ready-for-manual-canary':'게재 상품 수동 카나리 확인 가능'
  })[text(reason)]||text(reason)||'-';}

  function renderSummary(report){
    var s=report.summary||{};
    $('summary').innerHTML=''
      +card('비공개 후보',s.privateStageCandidates||0,'현재 국가·지역 범위')
      +card('개방 점검 후보',s.goLiveAuditCandidates||0,'시장·증빙·수익·PSOM 완료')
      +card('최종 게재 요청 전',s.auditReady||0,'publication_status=audit_ready')
      +card('게재 빌드 요청됨',s.publicationRequested||0,'publication_status=publish_requested')
      +card('공개 스냅샷 실상품',s.realProductCandidates||0,'현재 프론트에서 감지')
      +card('제휴·직접수익 준비',number(s.readyAffiliate)+number(s.readyDirectRevenue),'공개 스냅샷 기준');
  }
  function renderGate(report){
    var gate=report.gate||{},release=report.releaseControl||{},ready=gate.state==='ready_for_publication_request';
    var el=$('gatePanel');el.classList.remove('hidden');
    el.innerHTML='<h2>최종 공개 게이트</h2><div class="notice '+(ready?'okbox':'warnbox')+'"><strong>'+esc(gateLabel(gate.state))+'</strong><br>'+esc(reasonLabel(gate.reason))+'</div>'
      +'<div class="small" style="margin-top:9px">공개 게이트: '+esc(release.armed?'활성':'비활성')+' · 빌드 훅: '+esc(release.hookConfigured?'설정됨':'미설정')+' · 현재 사용자 게재 권한: '+esc(report.session&&report.session.publicationAuthorized?'있음':'없음')+' · 자동 공개: 없음</div>';
  }
  function publicationPill(status){var s=text(status);if(s==='publish_requested')return '<span class="pill requested">게재 빌드 요청됨</span>';if(s==='audit_ready')return '<span class="pill ready">최종 점검 대기</span>';return '<span class="pill">'+esc(s||'-')+'</span>';}
  function renderPrivateCandidates(report){
    var stage=report.pipeline&&report.pipeline.privateCandidateStage||{};
    var rows=Array.isArray(stage.rows)?stage.rows.filter(function(row){return row&&row.auditReady===true;}):[];
    candidateStore={};rows.forEach(function(row){if(row.candidateId)candidateStore[row.candidateId]=row;});
    var panel=$('privateCandidatePanel'),tbody=$('privateCandidateRows');panel.classList.remove('hidden');
    if(!rows.length){tbody.innerHTML='<tr><td colspan="7" class="small">현재 범위에 실상품 공급업체·상품 개방 점검 후보가 없습니다. 상품 후보·중개수익 대기열에서 시장·검증 증빙·수익 경로·PSOM 승인을 먼저 완료해야 합니다.</td></tr>';selectedCandidateId='';updatePublishControls();return;}
    tbody.innerHTML=rows.map(function(row){
      var a=row.assignment||{},r=row.revenue||{},image=row.image?'<img class="candidate-thumb" src="'+esc(row.image)+'" alt="">':'';
      var markets=(row.marketKeys||[]).join(', ')||[a.countryCode,a.regionCode].filter(Boolean).join(' / ')||'-';
      var reasons=(row.reasons||[]).join(', ')||'최종 점검 가능';
      return '<tr><td><input class="candidate-radio" type="radio" name="publicationCandidate" value="'+esc(row.candidateId)+'" '+(selectedCandidateId===row.candidateId?'checked':'')+' aria-label="게재 후보 선택"></td>'
        +'<td>'+image+'<strong>'+esc(row.title||'-')+'</strong><br><span class="small">'+esc(row.priceDisplay||'판매처에서 현재 가격 확인')+' · '+esc(row.supplierName||'-')+'</span><br><span class="small mono">'+esc(row.candidateId||'-')+'</span><div style="clear:both"></div></td>'
        +'<td>'+publicationPill(a.publicationStatus)+'<br><span class="small">'+esc(stageLabel(row.stageStatus))+'<br>다음: '+esc(row.nextGate||'-')+'</span></td>'
        +'<td><strong>'+esc((a.hubKey||'-')+' / '+(a.slotKey||'-'))+'</strong><br><span class="small">우선순위 '+esc(a.priority||0)+'</span></td>'
        +'<td>'+esc(markets)+'</td><td>'+esc(r.type||'-')+'<br><span class="small">'+esc(r.monetizationState||'-')+' · '+esc(r.contractId||'-')+'</span></td><td>'+esc(reasons)+'</td></tr>';
    }).join('');
    Array.prototype.forEach.call(tbody.querySelectorAll('input[name="publicationCandidate"]'),function(input){input.addEventListener('change',function(){selectedCandidateId=input.value;updatePublishControls();});});
    if(selectedCandidateId&&!candidateStore[selectedCandidateId])selectedCandidateId='';
    if(!selectedCandidateId&&rows.length===1){selectedCandidateId=rows[0].candidateId;var only=tbody.querySelector('input[name="publicationCandidate"]');if(only)only.checked=true;}
    updatePublishControls();
  }
  function renderSnapshots(report){
    var rows=(report.snapshots||[]).map(function(s){return '<tr><td>'+esc(s.key)+'</td><td>'+esc(s.totalItems||0)+'</td><td>'+esc(s.realProductCandidates||0)+'</td><td>'+esc(s.copies&&s.copies.synchronized?'동기화':'불일치/없음')+'</td></tr>';}).join('');
    var el=$('snapshotPanel');el.classList.remove('hidden');el.innerHTML='<h2>공개 스냅샷 상태</h2><div class="tablewrap"><table><thead><tr><th>스냅샷</th><th>선택 범위 항목</th><th>실상품 감지</th><th>복사본</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
  function renderPublicCandidates(report){
    var rows=Array.isArray(report.candidateRows)?report.candidateRows:[];var el=$('candidatePanel');el.classList.remove('hidden');
    if(!rows.length){el.innerHTML='<h2>현재 공개 스냅샷 실상품</h2><div class="small">현재 선택 범위의 공개 스냅샷에서는 실상품이 감지되지 않았습니다.</div>';return;}
    el.innerHTML='<h2>현재 공개 스냅샷 실상품</h2><div class="tablewrap"><table><thead><tr><th>상품</th><th>페이지/섹션</th><th>상태</th><th>판매처</th><th>문제</th></tr></thead><tbody>'+rows.map(function(row){return '<tr><td>'+esc(row.title||row.id||'-')+'</td><td>'+esc((row.page||'-')+' / '+(row.section||'-'))+'</td><td>'+esc(row.status||'-')+'</td><td>'+esc(row.sellerHost||'-')+'</td><td>'+esc((row.issues||[]).join(', ')||'-')+'</td></tr>';}).join('')+'</tbody></table></div>';
  }
  function renderRuntime(report){
    var runtime=report.runtime||{},settle=runtime.providerSettlement||{},sw=runtime.supplySwitches||{},release=report.releaseControl||{};var el=$('runtimePanel');el.classList.remove('hidden');
    el.innerHTML='<h2>운영 연결 상태</h2><div class="tablewrap"><table><tbody>'
      +'<tr><th>최종 게재 제어</th><td>공개 게이트 '+esc(release.armed?'활성':'비활성')+' · 빌드 훅 '+esc(release.hookConfigured?'설정됨':'미설정')+'</td></tr>'
      +'<tr><th>제휴·정산</th><td>파트너 '+esc(settle.affiliatePartnerCount||0)+' · 전환 웹훅 '+esc(settle.affiliateConversionWebhookReady?'준비':'미준비')+' · 비PG 정산 '+esc(settle.nonPgSettlementIngestReady?'준비':'미준비')+'</td></tr>'
      +'<tr><th>공급 스위치</th><td>PRODUCT_SUPPLY_ON='+esc(sw.productSupplyOn||'not-configured')+' · DATA_UPLOAD_ON='+esc(sw.dataUploadOn||'not-configured')+' · FRONT_SLOT_AUTO_FILL='+esc(sw.frontSlotAutoFill||'not-configured')+' · PAYMENT_LIVE='+esc(sw.paymentLive||'not-configured')+'</td></tr>'
      +'</tbody></table></div><div class="small">환경변수의 실제 값·토큰·빌드 훅 주소는 표시하지 않습니다.</div>';
  }
  function render(report){
    lastReport=report;if(report&&report.selectedScope)updateControlScope(report.selectedScope);renderSummary(report);renderGate(report);renderPrivateCandidates(report);renderSnapshots(report);renderPublicCandidates(report);renderRuntime(report);
    $('rawOutput').textContent=JSON.stringify(report,null,2);$('downloadJsonBtn').disabled=false;$('downloadHtmlBtn').disabled=false;$('publishPanel').classList.remove('hidden');updatePublishControls();
  }

  function selectedCandidate(){return candidateStore[selectedCandidateId]||null;}
  function updatePublishControls(){
    var report=lastReport||{},row=selectedCandidate(),release=report.releaseControl||{},gate=report.gate||{},assignment=row&&row.assignment||{};
    var confirmed=!!($('publishConfirmCheck')&&$('publishConfirmCheck').checked)&&text($('publishConfirmText')&&$('publishConfirmText').value)==='사이트 게재';
    var ready=mode()==='production'&&gate.state==='ready_for_publication_request'&&release.actionAvailable===true&&report.session&&report.session.publicationAuthorized===true&&!!row&&confirmed;
    $('publishBtn').disabled=!ready;
    if(row){
      $('publishCandidateSummary').className='notice '+(assignment.publicationStatus==='publish_requested'?'warnbox':'okbox');
      $('publishCandidateSummary').innerHTML='<strong>'+esc(row.title||row.candidateId)+'</strong><br>판매시장: '+esc([assignment.countryCode,assignment.regionCode].filter(Boolean).join(' / ')||'-')+' · PSOM: '+esc((assignment.hubKey||'-')+' / '+(assignment.slotKey||'-'))+' · 상태: '+esc(assignment.publicationStatus||'-');
    }else{
      $('publishCandidateSummary').className='notice warnbox';$('publishCandidateSummary').textContent='먼저 위 표에서 상품 한 건을 선택하세요.';
    }
    var reasons=[];
    if(mode()!=='production')reasons.push('실상품 운영 모드 선택 필요');
    if(!row)reasons.push('상품 한 건 선택 필요');
    if(gate.state!=='ready_for_publication_request')reasons.push(reasonLabel(gate.reason));
    if(release.actionAvailable!==true)reasons.push('공개 게이트 또는 빌드 훅 미준비');
    if(!(report.session&&report.session.publicationAuthorized===true))reasons.push('최종 게재 권한 없음');
    if(!confirmed)reasons.push('체크 및 확인 문구 입력 필요');
    $('publishState').textContent=ready?'최종 게재 요청 가능: 클릭 후 한 번 더 확인합니다.':reasons.filter(Boolean).join(' · ');
  }

  async function runAudit(){
    var button=$('runAuditBtn');button.disabled=true;setStatus('비공개 대기열·개방 점검 후보·공개 스냅샷을 읽는 중입니다…','info');
    try{var report=await authenticated('GET');render(report);setStatus('점검 완료 · '+scopeLabel()+' · '+gateLabel(report.gate&&report.gate.state),report.status);}
    catch(error){setStatus('점검 실패: '+text(error&&error.message||error),'fail');}
    finally{button.disabled=false;}
  }
  async function requestPublication(){
    updatePublishControls();if($('publishBtn').disabled)return;
    var row=selectedCandidate(),a=row&&row.assignment||{};
    var message='다음 상품의 사이트 게재 빌드를 요청하시겠습니까?\n\n상품: '+(row.title||row.candidateId)+'\n판매시장: '+([a.countryCode,a.regionCode].filter(Boolean).join(' / ')||'-')+'\nPSOM: '+(a.hubKey||'-')+' / '+(a.slotKey||'-')+'\n\n이 동작은 일반 저장이 아니며, 빌드 안전 게이트를 통과하면 사이트에 반영됩니다.';
    if(!window.confirm(message))return;
    var button=$('publishBtn');button.disabled=true;setStatus('선택 상품의 최종 사이트 게재 빌드를 요청하는 중입니다…','warn');
    try{
      var result=await authenticated('POST',{action:'request_publication',mode:'production',country:ACTIVE_SCOPE.country||'',region:ACTIVE_SCOPE.region||'NATIONWIDE',candidateId:row.candidateId,expectedDigest:row.digest||'',confirmation:'SITE_PUBLISH'});
      setStatus(result.note||'사이트 게재 빌드 요청이 등록됐습니다.','ok');$('publishConfirmCheck').checked=false;$('publishConfirmText').value='';await runAudit();
    }catch(error){setStatus('게재 요청 실패: '+text(error&&error.message||error),'fail');updatePublishControls();}
  }

  function publicTargets(){return [['홈','/home.html'],['유통 허브','/distributionhub.html'],['네트워크','/networkhub.html'],['미디어','/mediahub.html'],['소셜','/socialnetwork.html'],['관광','/tour.html'],['후원','/donation.html'],['검색','/search.html']];}
  function observePage(label,url){
    return new Promise(function(resolve){
      var frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;frame.style.cssText='position:fixed;left:-10000px;top:-10000px;width:1200px;height:900px;visibility:hidden;pointer-events:none;border:0';
      var done=false,timer;function finish(result){if(done)return;done=true;clearTimeout(timer);try{frame.remove();}catch(_e){}resolve(result);}
      frame.addEventListener('load',function(){try{var doc=frame.contentDocument,body=doc&&doc.body,textLen=body?(body.innerText||'').trim().length:0,scripts=doc?doc.scripts.length:0,cards=doc?doc.querySelectorAll('[data-slot],[data-card-id],[data-id],.product-card,.media-card,.item-card,.feed-card,.card').length:0;finish({label:label,url:url,status:textLen>20?'ok':'warn',textLength:textLen,scriptCount:scripts,cardHint:cards});}catch(error){finish({label:label,url:url,status:'fail',error:text(error&&error.message||error)});}});
      timer=setTimeout(function(){finish({label:label,url:url,status:'warn',error:'load-timeout'});},9000);document.body.appendChild(frame);var target=new URL(url,location.origin);target.searchParams.set('igdc_readonly_audit','1');target.searchParams.set('ts',String(Date.now()));frame.src=target.pathname+target.search;
    });
  }
  async function runPageObservation(){
    var button=$('runPageObserveBtn');button.disabled=true;setStatus('대표 페이지를 읽기 전용으로 관찰 중입니다…','info');
    try{var values=await Promise.all(publicTargets().map(function(item){return observePage(item[0],item[1]);}));$('pagePanel').classList.remove('hidden');$('pagePanel').innerHTML='<h2>대표 페이지 로드 관찰</h2><div class="small">실제 상품 클릭이나 결제 검증이 아니라 기본 DOM 생성 여부만 관찰합니다.</div><div class="page-checks">'+values.map(function(r){return '<div class="page-row"><strong class="'+statusClass(r.status)+'">'+esc(r.status)+'</strong> · '+esc(r.label)+'<br><span class="small">'+esc(r.url)+' · 본문 '+esc(r.textLength||0)+'자 · 스크립트 '+esc(r.scriptCount||0)+'개 · 카드 '+esc(r.cardHint||0)+(r.error?' · '+esc(r.error):'')+'</span></div>';}).join('')+'</div>';setStatus('대표 페이지 로드 관찰 완료','ok');}
    catch(error){setStatus('페이지 관찰 실패: '+text(error&&error.message||error),'fail');}finally{button.disabled=false;}
  }
  function htmlSummary(){return '<!doctype html><meta charset="utf-8"><title>IGDC 실상품 공급업체·상품 개방 점검</title><pre>'+esc($('rawOutput').textContent||'')+'</pre>';}
  function returnToQueue(){var q=new URLSearchParams(location.search),back=q.get('returnPath');location.href=back&&back.charAt(0)==='/'?back:'/commerce-candidate-pipeline.html';}
  function goToAdmin(){var q=new URLSearchParams(location.search),target=q.get('adminPath');location.href=target&&target.charAt(0)==='/'?target:'/admin.html';}
  function init(){
    var q=new URLSearchParams(location.search),saved=localStorage.getItem('igdc_product_go_live_audit_mode'),requested=q.get('mode');$('auditMode').value=(requested==='production'||saved==='production')?'production':'pre-product';
    $('auditMode').addEventListener('change',function(){localStorage.setItem('igdc_product_go_live_audit_mode',mode());updatePublishControls();runAudit();});
    $('runAuditBtn').addEventListener('click',runAudit);$('runPageObserveBtn').addEventListener('click',runPageObservation);$('publishBtn').addEventListener('click',requestPublication);
    $('supplierRefreshBtn').addEventListener('click',loadSupplierManager);$('supplierResearchBtn').addEventListener('click',runSupplierResearch);$('supplierResearchPauseBtn').addEventListener('click',function(){supplierStopRequested=true;$('supplierResearchPauseBtn').disabled=true;});$('supplierCommitBtn').addEventListener('click',commitSupplierResearch);$('supplierCountryManagerBtn').addEventListener('click',openSupplierCountryManager);$('supplierManualForm').addEventListener('submit',registerManualSupplier);
    $('publishConfirmCheck').addEventListener('change',updatePublishControls);$('publishConfirmText').addEventListener('input',updatePublishControls);
    $('downloadJsonBtn').addEventListener('click',function(){if(lastReport)download('IGDC_PRODUCT_GO_LIVE_AUDIT_'+nowStamp()+'.json',JSON.stringify(lastReport,null,2),'application/json');});
    $('downloadHtmlBtn').addEventListener('click',function(){if(lastReport)download('IGDC_PRODUCT_GO_LIVE_AUDIT_'+nowStamp()+'.html',htmlSummary(),'text/html;charset=utf-8');});
    $('returnBtn').addEventListener('click',returnToQueue);$('adminBtn').addEventListener('click',goToAdmin);
    document.addEventListener('igdc:member-auth-ready',function(){acceptedToken='';runAudit();});window.addEventListener('pageshow',function(){acceptedToken='';runAudit();});
    setStatus('점검 범위 · '+scopeLabel(),'info');runAudit().then(function(){loadSupplierManager();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
