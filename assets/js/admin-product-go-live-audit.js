/* IGDC real-product go-live audit admin v1.3.0
 * Authenticated live private-stage audit plus explicit, targeted publication request.
 */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/product-go-live-audit';
  var $=function(id){return document.getElementById(id);};
  var esc=function(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(value){return String(value==null?'':value).trim();};
  var lastReport=null,acceptedToken='',candidateStore={},selectedCandidateId='';
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
    if(!rows.length){tbody.innerHTML='<tr><td colspan="7" class="small">현재 범위에 실상품 공급 개방 점검 후보가 없습니다. 상품 후보·중개수익 대기열에서 시장·검증 증빙·수익 경로·PSOM 승인을 먼저 완료해야 합니다.</td></tr>';selectedCandidateId='';updatePublishControls();return;}
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
    lastReport=report;renderSummary(report);renderGate(report);renderPrivateCandidates(report);renderSnapshots(report);renderPublicCandidates(report);renderRuntime(report);
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
  function htmlSummary(){return '<!doctype html><meta charset="utf-8"><title>IGDC 실상품 공급 개방 점검</title><pre>'+esc($('rawOutput').textContent||'')+'</pre>';}
  function returnToQueue(){var q=new URLSearchParams(location.search),back=q.get('returnPath');location.href=back&&back.charAt(0)==='/'?back:'/commerce-candidate-pipeline.html';}
  function init(){
    var q=new URLSearchParams(location.search),saved=localStorage.getItem('igdc_product_go_live_audit_mode'),requested=q.get('mode');$('auditMode').value=(requested==='production'||saved==='production')?'production':'pre-product';
    $('auditMode').addEventListener('change',function(){localStorage.setItem('igdc_product_go_live_audit_mode',mode());updatePublishControls();runAudit();});
    $('runAuditBtn').addEventListener('click',runAudit);$('runPageObserveBtn').addEventListener('click',runPageObservation);$('publishBtn').addEventListener('click',requestPublication);
    $('publishConfirmCheck').addEventListener('change',updatePublishControls);$('publishConfirmText').addEventListener('input',updatePublishControls);
    $('downloadJsonBtn').addEventListener('click',function(){if(lastReport)download('IGDC_PRODUCT_GO_LIVE_AUDIT_'+nowStamp()+'.json',JSON.stringify(lastReport,null,2),'application/json');});
    $('downloadHtmlBtn').addEventListener('click',function(){if(lastReport)download('IGDC_PRODUCT_GO_LIVE_AUDIT_'+nowStamp()+'.html',htmlSummary(),'text/html;charset=utf-8');});
    $('returnBtn').addEventListener('click',returnToQueue);
    document.addEventListener('igdc:member-auth-ready',function(){acceptedToken='';runAudit();});window.addEventListener('pageshow',function(){acceptedToken='';runAudit();});
    setStatus('점검 범위 · '+scopeLabel(),'info');runAudit();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
