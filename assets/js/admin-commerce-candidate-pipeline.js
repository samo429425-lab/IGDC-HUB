/* IGDC Commerce Candidate Pipeline Admin View v1.8.1
 * Ordered private research/staging workflow and commerce queue diagnostic.
 * It reuses the existing administrator session.  No second commerce login,
 * provider call, seller navigation, publication, payment, or browser secret.
 */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/commerce-candidate-review';
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(v){return String(v==null?'':v).trim();};
  var state=$('state'), notice=$('notice'), diagnosticCache=null, dashboardCache=null, acceptedToken='', acceptedSession=null, resolvingSession=null, candidateStore={}, selectedCandidateId='', refreshPromise=null, lastRefreshAt=0;
  var TOKEN_KEYS=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token'];

  function scopeContext(){
    var q=new URLSearchParams(location.search);
    var country=text(q.get('country')).toUpperCase();
    var region=text(q.get('region')||'ALL').toUpperCase();
    return {country:country==='GLOBAL'?'GLOBAL':(/^[A-Z]{2}$/.test(country)?country:''),region:region||'ALL',source:country?'selected':'request-ip'};
  }
  var ACTIVE_SCOPE=scopeContext();
  function updateScope(scope){
    if(!scope)return;
    if(scope.country&&/^[A-Z]{2}$/.test(String(scope.country))){ACTIVE_SCOPE={country:String(scope.country).toUpperCase(),region:String(scope.region||'NATIONWIDE').toUpperCase(),source:scope.source||'resolved'};try{localStorage.setItem('igdc_admin_country_scope_v1',JSON.stringify({country:ACTIVE_SCOPE.country,region:ACTIVE_SCOPE.region,updatedAt:new Date().toISOString(),source:'commerce-candidate-pipeline'}));}catch(_e){}}
    else if(scope.source==='unresolved-ip')ACTIVE_SCOPE={country:'',region:'',source:'unresolved-ip'};
  }
  function scopeLabel(){return ACTIVE_SCOPE.country?((ACTIVE_SCOPE.country==='GLOBAL'?'전 세계':ACTIVE_SCOPE.country)+' / '+(ACTIVE_SCOPE.region||'ALL')):(ACTIVE_SCOPE.source==='unresolved-ip'?'IP 범위 미확인':'현재 접속 IP 자동 판정');}

  function cls(kind){return kind==='ok'?'ok':kind==='warn'?'warn':'';}
  function show(message,kind){notice.className='notice '+cls(kind);notice.textContent=message;notice.classList.remove('hidden');}
  function hideNotice(){notice.classList.add('hidden');notice.textContent='';}
  function jwt(value){var token=text(value);return token.split('.').length===3&&token.length>32?token:'';}
  function parseJson(value){try{return JSON.parse(value);}catch(_e){return null;}}
  function pushToken(value,out,seen,depth){
    if(depth>4||value==null)return;
    if(typeof value==='string'){
      var token=jwt(value);if(token&&!seen[token]){seen[token]=true;out.push(token);return;}
      var parsed=parseJson(value);if(parsed)pushToken(parsed,out,seen,depth+1);
      return;
    }
    if(Array.isArray(value)){value.forEach(function(item){pushToken(item,out,seen,depth+1);});return;}
    if(typeof value==='object'){
      ['id_token','idToken','access_token','accessToken','token','__raw','raw'].forEach(function(key){pushToken(value[key],out,seen,depth+1);});
    }
  }
  function ownStorageTokens(source,out,seen){
    [source&&source.localStorage,source&&source.sessionStorage].forEach(function(store){
      if(!store)return;
      TOKEN_KEYS.forEach(function(key){try{pushToken(store.getItem(key),out,seen,0);}catch(_e){}});
    });
  }
  function sameOriginWindows(){
    var values=[],seen=[];
    function add(candidate){
      try{
        if(!candidate||seen.indexOf(candidate)>=0)return;
        // Touching location verifies that the candidate is same-origin before
        // any session object is inspected. Cross-origin parents are ignored.
        void candidate.location.href;
        seen.push(candidate);values.push(candidate);
      }catch(_e){}
    }
    add(window);
    try{add(window.parent);}catch(_e){}
    try{add(window.top);}catch(_e){}
    return values;
  }
  async function tokenCandidates(){
    var out=[],seen={},tasks=[];
    function from(fn){
      tasks.push(Promise.resolve().then(fn).then(function(value){pushToken(value,out,seen,0);}).catch(function(){}));
    }
    var sources=sameOriginWindows();
    for(var i=0;i<sources.length;i++){
      (function(source){
        from(function(){return source.IGDCMemberAuth&&source.IGDCMemberAuth.getIdToken?source.IGDCMemberAuth.getIdToken():'';});
        from(function(){
          if(!source.osAuth)return '';
          if(typeof source.osAuth.getIdTokenClaims==='function')return source.osAuth.getIdTokenClaims();
          return '';
        });
        from(function(){return source.osAuth&&source.osAuth.getIdToken?source.osAuth.getIdToken():'';});
        ownStorageTokens(source,out,seen);
      })(sources[i]);
    }
    // Auth0 adapters can return promises. All candidate reads must finish before
    // the server-side common-session probe begins.
    await Promise.all(tasks);
    return out;
  }
  async function request(action,token,method,body){
    var u=new URL(ENDPOINT,location.origin);u.searchParams.set('action',action);if(action!=='session'&&ACTIVE_SCOPE.country){u.searchParams.set('country',ACTIVE_SCOPE.country);u.searchParams.set('region',ACTIVE_SCOPE.region||'ALL');}
    var verb=method||'GET',headers={Authorization:'Bearer '+token,Accept:'application/json'},init={method:verb,headers:headers,credentials:'same-origin',cache:'no-store'};
    if(verb!=='GET'){headers['Content-Type']='application/json';init.body=JSON.stringify(Object.assign({action:action},body||{}));}
    var response=await fetch(u.pathname+u.search,init);
    var data=null;try{data=await response.json();}catch(_e){}
    if(!response.ok||!data||data.ok!==true){var error=new Error((data&&data.error)||('요청 실패: HTTP '+response.status));error.code=data&&data.code;error.status=response.status;throw error;}
    return data;
  }
  function sessionLabel(data){var roles=(data&&data.session&&data.session.roles)||[];return roles.length?roles.join(', '):'관리자';}
  async function ensureSession(force){
    if(!force&&acceptedToken)return acceptedSession;
    if(resolvingSession)return resolvingSession;
    resolvingSession=(async function(){
      state.textContent='관리자 공통 세션을 확인하는 중입니다.';
      var candidates=await tokenCandidates();
      for(var i=0;i<candidates.length;i++){
        try{
          var data=await request('session',candidates[i]);
          acceptedToken=candidates[i];acceptedSession=data;
          state.textContent='관리자 공통 세션 확인: '+sessionLabel(data)+(ACTIVE_SCOPE.country?' · 범위 '+ACTIVE_SCOPE.country+' / '+(ACTIVE_SCOPE.region||'ALL'):'');
          return data;
        }catch(_e){}
      }
      acceptedToken='';acceptedSession=null;
      throw new Error('관리자 페이지의 공통 세션을 확인하지 못했습니다. 이 화면은 별도 로그인 없이 관리자 화면의 기존 세션만 사용합니다.');
    })();
    try{return await resolvingSession;}finally{resolvingSession=null;}
  }
  async function api(action,method,body){
    await ensureSession(false);
    try{return await request(action,acceptedToken,method||'GET',body||null);}catch(error){
      if(Number(error&&error.status)===401){acceptedToken='';acceptedSession=null;await ensureSession(true);return request(action,acceptedToken,method||'GET',body||null);}
      throw error;
    }}
  function authErrorMessage(error){
    var message=text(error&&error.message);
    if(Number(error&&error.status)===401||/session|token|로그인/i.test(message))return '관리자 공통 세션을 아직 찾지 못했습니다. 이 화면은 상위 사이트의 기존 관리자 세션을 자동 승계하며, 별도 로그인은 필요하지 않습니다.';
    return message||'대기열 요청을 처리하지 못했습니다.';
  }
  function labelTier(v){var x=text(v);return x==='approved_commerce_member'?'직접등록 승인':x==='managed_sponsor'?'관리 스폰서':x==='external_brokerage'?'외부중개/연결':x==='risk_ranked_official_supplier_product'?'공식 공급처 상품 리서치':x||'미분류';}
  function tierClass(v){return v==='approved_commerce_member'?'direct':v==='managed_sponsor'?'sponsor':'external';}
  function stageLabel(v){var x=text(v);return ({private_research_queue:'비공개 리서치 대기열',research_review_ready:'승인 검토 가능',research_discovered:'리서치 발견',administrator_selection_pending:'관리자 상품 선택',market_evidence_pending:'시장·배송 근거',trust_evidence_pending:'검증 증빙',revenue_route_pending:'수익 경로',slot_assignment_pending:'PSOM 배정',registry_sync_ready:'개방 점검 후보 확정',staged_release_review:'공급 개방 점검',canonical_canary_ready:'수동 카나리 준비',held:'보류',rejected:'제외'})[x]||x||'검토 대기';}
  function statusPill(c){return c.releaseEligible?'<span class="pill release">발행 전 통과</span>':'<span class="pill hold">'+esc(stageLabel(c.stageStatus))+'</span>';}
  function number(v){var n=Number(v);return Number.isFinite(n)?n:0;}
  function gridCard(title,value,small){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num">'+esc(value)+'</div><div class="small">'+esc(small||'')+'</div></article>';}
  function renderSummary(summary){
    var s=summary.summary||{};var g=$('summaryGrid');
    g.innerHTML=''
      +gridCard('전체 비공개 후보',s.considered||0,'상품 리서치·정식 스테이징 결합')
      +gridCard('상품 리서치 대기열',s.liveResearchQueue||0,'보완 필요 '+number(s.researchNeedsCompletion)+'건')
      +gridCard('승인 절차 진행 가능',s.researchPromotionEligible||0,'상품·공급업체 위험 게이트 통과')
      +gridCard('개방 점검 후보 확정',s.registrySyncReady||0,'시장·증빙·수익·PSOM 승인 완료')
      +gridCard('공급 개방 스테이지',s.stagedReleaseQueue||0,'비공개 후보 인테이크 완료')
      +gridCard('발행 전 통과',s.eligibleForRelease||0,'최종 게재 요청은 개방 점검에서만');
    g.classList.remove('hidden');
    var gate=summary.releaseGate||{};var panel=$('policyPanel');var release=gate.enabled===true;
    panel.innerHTML='<h2>공개 전 안전 상태</h2><div class="notice '+(release?'ok':'warn')+'"><strong>'+esc(release?'발행 키가 배포 환경에서 확인됨':'현재는 비공개 대기열 상태')+'</strong><br>'+esc(release?'그래도 각 후보는 실상품 공급 개방 점검과 Canonical·IP·판매시장 검증을 다시 통과해야 합니다.':'상품 리서치 후보는 이곳에서 검토하고, 관리자 선택→시장 근거→검증 증빙→수익 경로→PSOM 승인까지 끝난 후보만 실상품 공급 개방 점검으로 이동합니다.')+'</div><div class="small" style="margin-top:9px">이 대기열에는 사이트 게재 기능이 없습니다. 섹션 제안 후보: '+esc(number(s.proposedSectionCandidates))+'건 · 개방 점검 후보: '+esc(number(s.registrySyncReady))+'건 · stage: '+esc(summary.generatedAt||'아직 생성되지 않음')+'</div>';
    panel.classList.remove('hidden');
  }
  function proposalHtml(c,p){
    var proposals=Array.isArray(c&&c.proposedPlacements)?c.proposedPlacements:[];
    if(!proposals.length&&p&&(p.page||p.section))proposals=[{page:p.page,section:p.section,approvalEligible:c&&c.releaseEligible===true}];
    if(!proposals.length)return '<span class="small">추천 배정 없음</span>';
    return proposals.slice(0,8).map(function(row){
      var page=text(row&&row.page)||'-',section=text(row&&(row.sectionKey||row.section))||'-';
      var ok=row&&row.approvalEligible===true;
      var gaps=Array.isArray(row&&row.evidenceGaps)?row.evidenceGaps:[];
      return '<div class="placement-line"><span class="pill '+(ok?'release':'hold')+'">'+esc(page+' / '+section)+'</span>'+(gaps.length?'<span class="small"> 보완: '+esc(gaps.join(', '))+'</span>':'')+'</div>';
    }).join('');
  }
  function reviewLink(url,label){
    var value=text(url);
    if(!/^https:\/\//i.test(value))return '';
    return '<a class="review-link" href="'+esc(value)+'" target="_blank" rel="noopener">'+esc(label)+'</a>';
  }
  function readinessReasons(c){
    var ready=c&&c.researchReadiness||{};
    var rows=[];
    [['차단',ready.blockers],['확인 필요',ready.reviewGaps],['참고',ready.warnings],['현재 상태',c&&c.reasons]].forEach(function(pair){
      var list=Array.isArray(pair[1])?pair[1]:[];
      list.forEach(function(value){rows.push(pair[0]+': '+text(value));});
    });
    return rows.length?rows.join('\n'):'-';
  }
  function renderRows(candidates){
    var tbody=$('candidateRows'),list=Array.isArray(candidates)?candidates:[];candidateStore={};
    list.forEach(function(row){if(row&&row.candidateId)candidateStore[row.candidateId]=row;});
    if(!list.length){tbody.innerHTML='<tr><td colspan="10" class="empty">현재 표시할 비공개 후보가 없습니다. 상품 상세 URL과 공급업체 식별이 가능한 리서치 후보는 정보 보완 상태라도 이 대기열에 먼저 나타나야 합니다.</td></tr>';$('tablePanel').classList.remove('hidden');$('candidateActionPanel').classList.add('hidden');return;}
    tbody.innerHTML=list.map(function(c){
      var p=c.placement||{},r=c.revenue||{},v=c.review||{},rank=c.ranking||{},card=c.productCard||{},supplier=c.supplier||{},ready=c.researchReadiness||{};
      var reasons=readinessReasons(c);
      var image=card.image?'<img src="'+esc(card.image)+'" alt="" style="width:70px;height:70px;object-fit:cover;border-radius:8px;float:left;margin:0 9px 6px 0">':'';
      var links=[reviewLink(card.checkoutUrl,'상품 페이지'),reviewLink(card.supplierUrl||supplier.officialUrl,'공급업체 사이트'),reviewLink(card.image,'이미지 원본')].filter(Boolean).join(' · ');
      var readiness=ready.promotionEligible===true?'<span class="pill release">승인 진행 가능</span>':'<span class="pill hold">정보 보완 필요</span>';
      return '<tr><td>'+image+'<strong>'+esc(card.title||c.title||'-')+'</strong><br><span class="small">'+esc(card.priceDisplay||'판매처에서 현재 가격 확인')+' · '+esc(card.supplierName||supplier.name||'-')+'</span>'+(links?'<br><span class="small">'+links+'</span>':'')+'<br><span class="small mono">'+esc(c.candidateId||'-')+'</span><div style="clear:both"></div></td><td><span class="pill '+tierClass(c.sourceTier)+'">'+esc(labelTier(c.sourceTier))+'</span></td><td>'+statusPill(c)+'<br>'+readiness+'<br><span class="small">다음: '+esc(v.nextGate||ready.nextGate||'-')+'</span></td><td>'+proposalHtml(c,p)+'</td><td>'+esc((c.marketKeys||[]).join(', ')||'-')+'</td><td>'+esc(c.essentialClass||'-')+'</td><td><span class="mono">'+esc(r.type||'-')+'</span><br><span class="small">상태: '+esc(r.monetizationState||'-')+' · 계약: '+esc(r.contractId||'-')+' · 검토: '+esc(v.state||'-')+'</span><br><span class="small">결제: 외부 판매처</span></td><td><strong>'+esc(number(rank.finalScore).toFixed(2))+'</strong><br><span class="small">생활 '+esc(rank.essentiality||0)+' · 신뢰 '+esc(rank.sellerTrust||0)+' · 수익 '+esc(rank.revenueCertainty||0)+'</span></td><td class="reason">'+esc(reasons).replace(/\n/g,'<br>')+'</td><td><button type="button" class="manage-btn" data-manage-candidate="'+esc(c.candidateId||'')+'">다음 단계 관리</button></td></tr>';
    }).join('');
    $('tablePanel').classList.remove('hidden');
    Array.prototype.forEach.call(tbody.querySelectorAll('[data-manage-candidate]'),function(button){button.addEventListener('click',function(){selectCandidate(button.getAttribute('data-manage-candidate'));});});
    if(selectedCandidateId&&candidateStore[selectedCandidateId])selectCandidate(selectedCandidateId);
  }
  function setValue(id,value){var el=$(id);if(el)el.value=value==null?'':String(value);}
  function selectedCandidate(){return candidateStore[selectedCandidateId]||null;}
  function selectCandidate(id){
    var row=candidateStore[id];if(!row)return;selectedCandidateId=id;
    var p=row.placement||{},card=row.productCard||{},review=row.review||{},ready=row.researchReadiness||{};
    $('candidateActionPanel').classList.remove('hidden');
    var gaps=[].concat(Array.isArray(ready.blockers)?ready.blockers:[],Array.isArray(ready.reviewGaps)?ready.reviewGaps:[]);
    var auditReady=text(row.stageStatus)==='registry_sync_ready'||text(row.lifecycle&&row.lifecycle.stage)==='registry_sync_ready';
    $('selectedCandidateMeta').className='notice '+(auditReady?'ok':'');
    $('selectedCandidateMeta').innerHTML='<strong>'+esc(card.title||row.title||id)+'</strong><br>현재 단계: '+esc(stageLabel(row.stageStatus))+' · 다음 게이트: '+esc(review.nextGate||ready.nextGate||'-')+(auditReady?'<br><strong>시장·증빙·수익·PSOM 승인이 완료되어 실상품 공급 개방 점검 대상으로 확정됐습니다. 사이트 게재는 아직 실행되지 않았습니다.</strong>':'')+'<br><span class="small">추천 배정: '+esc((Array.isArray(row.proposedPlacements)?row.proposedPlacements:[]).map(function(x){return text(x.page)+'/'+text(x.sectionKey||x.section);}).filter(Boolean).join(', ')||'없음')+'</span>'+(gaps.length?'<br><span class="small">승인 전 보완: '+esc(gaps.join(', '))+'</span>':'')+'<br><span class="small">외부 판매처 결제 구조이며, 이 관리 작업은 IGDC 공개·결제·배송 책임을 생성하지 않습니다.</span>';
    $('selectProductBtn').disabled=ready.promotionEligible!==true;
    $('selectProductBtn').title=ready.promotionEligible===true?'관리자 승인 절차를 시작합니다.':'상품명·이미지·공급업체·위험 검증을 먼저 보완해야 합니다.';
    setValue('marketCountry',p.country||ACTIVE_SCOPE.country||'');setValue('marketRegion',p.region||ACTIVE_SCOPE.region||'NATIONWIDE');
    setValue('assignCountry',p.country||ACTIVE_SCOPE.country||'');setValue('assignRegion',p.region||ACTIVE_SCOPE.region||'NATIONWIDE');setValue('assignHub',p.page||'distribution');setValue('assignSlot',p.section||p.slot||'');
    $('candidateActionPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function runWrite(action,body,success){
    if(!selectedCandidateId){show('먼저 관리할 상품 후보를 선택해 주세요.','warn');return null;}
    var payload=Object.assign({candidateId:selectedCandidateId},body||{});
    try{var result=await api(action,'POST',payload);show(success||'관리 작업을 저장했습니다.','ok');await refresh();return result;}catch(error){show(authErrorMessage(error),'warn');return null;}
  }
  function formText(id){return text($(id)&&$(id).value);}
  function formBool(id){return !!($(id)&&$(id).checked);}
  function wireCandidateActions(){
    $('selectProductBtn').addEventListener('click',function(){runWrite('select_product',{},'상품을 검토 후보로 선택했습니다. 다음으로 판매시장·배송 근거를 등록하세요.');});
    $('holdProductBtn').addEventListener('click',function(){runWrite('decide',{decision:'hold',note:'관리자 보류'},'상품 후보를 보류했습니다.');});
    $('rejectProductBtn').addEventListener('click',function(){if(window.confirm('이 상품 후보를 제외하시겠습니까?'))runWrite('decide',{decision:'rejected',note:'관리자 제외'},'상품 후보를 제외했습니다.');});
    $('marketForm').addEventListener('submit',function(event){event.preventDefault();runWrite('record_market',{market:{countryCode:formText('marketCountry').toUpperCase(),regionCode:formText('marketRegion').toUpperCase(),deliveryOrAccess:formText('marketDelivery'),legalBasis:formText('marketBasis')}},'판매시장·배송·반품·지원 근거를 저장했습니다.');});
    $('evidenceForm').addEventListener('submit',function(event){event.preventDefault();runWrite('record_evidence',{evidence:{type:formText('evidenceType'),url:formText('evidenceUrl'),note:formText('evidenceNote')}},'검증 증빙을 저장했습니다.');});
    $('revenueForm').addEventListener('submit',function(event){event.preventDefault();var type=formText('revenueType');runWrite('record_revenue',{revenue:{type:type,providerName:formText('revenueProvider'),destinationUrl:formText('revenueUrl'),affiliateUrl:formText('revenueUrl'),programId:formText('revenueProgram'),contractId:formText('revenueProgram'),settlementMode:formText('revenueSettlement'),disclosureReady:formBool('revenueDisclosure'),officialDestination:formBool('revenueOfficial'),providerGenerated:formBool('revenueProviderGenerated'),manualLinkApproved:formBool('revenueManualApproved'),policyConfirmed:formBool('revenuePolicy'),payoutBasisVerified:formBool('revenuePayout'),note:formText('revenueNote')}},'수익·외부 연결 경로를 저장했습니다.');});
    $('assignmentForm').addEventListener('submit',function(event){event.preventDefault();runWrite('decide',{decision:'approved',note:formText('assignNote'),assignment:{hubKey:formText('assignHub'),slotKey:formText('assignSlot'),countryCode:formText('assignCountry').toUpperCase(),regionCode:formText('assignRegion').toUpperCase(),priority:Number(formText('assignPriority')||0),pinned:false}},'PSOM 승인을 저장했습니다. 이 후보는 실상품 공급 개방 점검 대상입니다. 사이트 게재는 아직 실행되지 않았습니다.');});
  }

  function renderDiagnostic(doc){diagnosticCache=doc||null;var panel=$('diagnosticPanel'),pre=$('diagnosticJson');pre.textContent=JSON.stringify(doc||{},null,2);panel.classList.remove('hidden');$('downloadDiagnosticBtn').disabled=!diagnosticCache;}
  async function refresh(force){
    if(refreshPromise)return refreshPromise;
    if(!force&&Date.now()-lastRefreshAt<2500&&dashboardCache)return dashboardCache;
    hideNotice();var button=$('refreshBtn');button.disabled=true;
    refreshPromise=(async function(){
      try{
        await ensureSession(false);
        var data=await api('dashboard');dashboardCache=data||{};diagnosticCache=data&&data.diagnostic||null;lastRefreshAt=Date.now();
        updateScope(data.scope);state.textContent='관리자 공통 세션 확인 · 범위 '+scopeLabel();renderSummary(data.summary||{});renderRows(data.candidates||[]);
        show(scopeLabel()+' 비공개 상품 후보 대기열을 한 번의 통합 조회로 새로 읽었습니다. 이 동작은 공개 발행·외부 판매처 이동·결제를 실행하지 않습니다.','ok');
        return data;
      }catch(error){show(authErrorMessage(error),'warn');throw error;}
      finally{button.disabled=false;refreshPromise=null;}
    })();
    return refreshPromise;
  }
  async function diagnostic(){
    hideNotice();var button=$('diagnosticBtn');button.disabled=true;
    try{
      if(!diagnosticCache){var data=await refresh(true);diagnosticCache=data&&data.diagnostic||null;}
      if(!diagnosticCache)throw new Error('후보·수익 점검 JSON을 만들지 못했습니다.');
      renderDiagnostic(diagnosticCache);show('현재 통합 조회에 포함된 상품 후보·중개수익 점검 JSON을 표시했습니다. 추가 중복 조회는 실행하지 않았습니다.','ok');
    }catch(error){show(authErrorMessage(error),'warn');}
    finally{button.disabled=false;}
  }
  function safeFilePart(value){return text(value).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'commerce-candidate-queue';}
  function jsonFileName(doc){
    var type=safeFilePart(doc&&doc.reportType||'commerce-candidate-queue-diagnostic');
    var stamp=new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').replace('Z','Z');
    return 'igdc-'+type+'_'+stamp+'.json';
  }
  function downloadDiagnostic(){
    if(!diagnosticCache){show('먼저 후보·수익 점검 JSON을 읽어 주세요.','warn');return;}
    var raw=JSON.stringify(diagnosticCache,null,2)+'\n';
    var blob=new Blob([raw],{type:'application/json;charset=utf-8'});
    var href=URL.createObjectURL(blob);
    var link=document.createElement('a');
    link.href=href;
    link.download=jsonFileName(diagnosticCache);
    link.style.display='none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(function(){try{link.remove();URL.revokeObjectURL(href);}catch(_e){}},0);
    show('상품 후보·중개수익 점검 JSON 파일을 다운로드했습니다.','ok');
  }
  function goLiveAudit(){
    var target=new URL('/product-go-live-audit.html',location.origin);
    if(ACTIVE_SCOPE.country){target.searchParams.set('country',ACTIVE_SCOPE.country);target.searchParams.set('region',ACTIVE_SCOPE.region||'NATIONWIDE');}
    target.searchParams.set('source','commerce-candidate-pipeline');
    target.searchParams.set('returnPath',location.pathname+location.search);
    location.href=target.pathname+target.search;
  }
  function back(){var q=new URLSearchParams(location.search);var p=q.get('returnPath');location.href=p&&p.charAt(0)==='/'?p:'/admin.html';}
  function init(){
    $('refreshBtn').addEventListener('click',function(){refresh(true).catch(function(){});});$('diagnosticBtn').addEventListener('click',diagnostic);$('downloadDiagnosticBtn').addEventListener('click',downloadDiagnostic);$('goLiveAuditBtn').addEventListener('click',goLiveAudit);$('returnBtn').addEventListener('click',back);wireCandidateActions();
    document.addEventListener('igdc:member-auth-ready',function(){acceptedToken='';acceptedSession=null;if(Date.now()-lastRefreshAt>3000)refresh(false).catch(function(){});});
    window.addEventListener('pageshow',function(event){if(event.persisted===true){acceptedToken='';acceptedSession=null;refresh(false).catch(function(){});}});
    refresh(true).catch(function(){});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
