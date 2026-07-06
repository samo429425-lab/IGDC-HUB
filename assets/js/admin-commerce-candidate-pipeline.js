/* IGDC Commerce Candidate Pipeline Admin View v1.3.0
 * Private staging viewer + read-only commerce queue diagnostic.
 * It reuses the existing administrator session.  No second commerce login,
 * provider call, seller navigation, publication, payment, or browser secret.
 */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/commerce-candidate-review';
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(v){return String(v==null?'':v).trim();};
  var state=$('state'), notice=$('notice'), diagnosticCache=null, acceptedToken='', acceptedSession=null, resolvingSession=null;
  var TOKEN_KEYS=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token'];

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
  async function request(action,token){
    var response=await fetch(ENDPOINT+'?action='+encodeURIComponent(action),{headers:{Authorization:'Bearer '+token,Accept:'application/json'},credentials:'same-origin',cache:'no-store'});
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
          state.textContent='관리자 공통 세션 확인: '+sessionLabel(data);
          return data;
        }catch(_e){}
      }
      acceptedToken='';acceptedSession=null;
      throw new Error('관리자 페이지의 공통 세션을 확인하지 못했습니다. 이 화면은 별도 로그인 없이 관리자 화면의 기존 세션만 사용합니다.');
    })();
    try{return await resolvingSession;}finally{resolvingSession=null;}
  }
  async function api(action){
    await ensureSession(false);
    try{return await request(action,acceptedToken);}catch(error){
      if(Number(error&&error.status)===401){acceptedToken='';acceptedSession=null;await ensureSession(true);return request(action,acceptedToken);}
      throw error;
    }}
  function authErrorMessage(error){
    var message=text(error&&error.message);
    if(Number(error&&error.status)===401||/session|token|로그인/i.test(message))return '관리자 공통 세션을 아직 찾지 못했습니다. 이 화면은 상위 사이트의 기존 관리자 세션을 자동 승계하며, 별도 로그인은 필요하지 않습니다.';
    return message||'대기열 요청을 처리하지 못했습니다.';
  }
  function labelTier(v){var x=text(v);return x==='approved_commerce_member'?'직접등록 승인':x==='managed_sponsor'?'관리 스폰서':x==='external_brokerage'?'외부중개/연결':x||'미분류';}
  function tierClass(v){return v==='approved_commerce_member'?'direct':v==='managed_sponsor'?'sponsor':'external';}
  function statusPill(c){return c.releaseEligible?'<span class="pill release">발행 전 통과</span>':'<span class="pill hold">검토/차단</span>';}
  function number(v){var n=Number(v);return Number.isFinite(n)?n:0;}
  function gridCard(title,value,small){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num">'+esc(value)+'</div><div class="small">'+esc(small||'')+'</div></article>';}
  function renderSummary(summary){var s=summary.summary||{};var g=$('summaryGrid');g.innerHTML=''+gridCard('검토 후보',s.considered||0,'SearchBank·관리자 대기열 결합')+gridCard('발행 전 통과',s.eligibleForRelease||0,'공개 키는 별도 배포 환경에서만')+gridCard('현재 정식 발행',s.releasedToCanonical||0,'현재 실행 기준 Canonical 전달 수')+gridCard('검토 보류',s.held||0,'증빙·수익·승인 누락 포함');g.classList.remove('hidden');var gate=summary.releaseGate||{};var panel=$('policyPanel');var release=gate.enabled===true;panel.innerHTML='<h2>공개 전 안전 상태</h2><div class="notice '+(release?'ok':'warn')+'"><strong>'+esc(release?'발행 키가 배포 환경에서 확인됨':'현재는 비공개 대기열 상태')+'</strong><br>'+esc(release?'그래도 각 후보는 Canonical·IP·판매시장 검증을 다시 통과해야 합니다.':'현재 후보는 관리자 검토와 증빙 수집 단계에만 남으며, 프론트 상품 슬롯으로 자동 공개되지 않습니다.')+'</div><div class="small" style="margin-top:9px">릴리스 키 값과 비밀정보는 이 화면에 표시하지 않습니다. stage: '+esc(summary.generatedAt||'아직 생성되지 않음')+'</div>';panel.classList.remove('hidden');}
  function renderRows(candidates){var tbody=$('candidateRows');var list=Array.isArray(candidates)?candidates:[];if(!list.length){tbody.innerHTML='<tr><td colspan="9" class="empty">현재 표시할 비공개 후보가 없습니다. 기존 샘플·미검증 후보는 정상적으로 대기열에서 제외됩니다.</td></tr>';$('tablePanel').classList.remove('hidden');return;}tbody.innerHTML=list.map(function(c){var p=c.placement||{},r=c.revenue||{},v=c.review||{},rank=c.ranking||{};var reasons=Array.isArray(c.reasons)&&c.reasons.length?c.reasons.join('\n'):'-';return '<tr><td><strong class="mono">'+esc(c.candidateId||'-')+'</strong><br><span class="small">host: '+esc(c.destinationHost||'-')+'</span></td><td><span class="pill '+tierClass(c.sourceTier)+'">'+esc(labelTier(c.sourceTier))+'</span></td><td>'+statusPill(c)+'</td><td><span class="mono">'+esc((p.page||'-')+' / '+(p.section||'-')+(p.slot?' / '+p.slot:''))+'</span></td><td>'+esc((c.marketKeys||[]).join(', ')||'-')+'</td><td>'+esc(c.essentialClass||'-')+'</td><td><span class="mono">'+esc(r.type||'-')+'</span><br><span class="small">상태: '+esc(r.monetizationState||'-')+' · 계약: '+esc(r.contractId||'-')+' · 검토: '+esc(v.state||'-')+'</span><br><span class="small">경로: '+esc(r.outboundRoute&&r.outboundRoute.mode||'-')+'</span></td><td><strong>'+esc(number(rank.finalScore).toFixed(2))+'</strong><br><span class="small">생활 '+esc(rank.essentiality||0)+' · 신뢰 '+esc(rank.sellerTrust||0)+' · 수익 '+esc(rank.revenueCertainty||0)+'</span></td><td class="reason">'+esc(reasons).replace(/\n/g,'<br>')+'</td></tr>';}).join('');$('tablePanel').classList.remove('hidden');}
  function renderDiagnostic(doc){diagnosticCache=doc||null;var panel=$('diagnosticPanel'),pre=$('diagnosticJson');pre.textContent=JSON.stringify(doc||{},null,2);panel.classList.remove('hidden');$('copyDiagnosticBtn').disabled=!diagnosticCache;}
  async function refresh(){hideNotice();var button=$('refreshBtn');button.disabled=true;try{await ensureSession(false);var both=await Promise.all([api('summary'),api('candidates')]);renderSummary(both[0].summary||{});renderRows(both[1].candidates||[]);show('비공개 상품 후보 대기열을 새로 읽었습니다. 이 동작은 공개 발행·외부 판매처 이동·결제를 실행하지 않습니다.','ok');}catch(error){show(authErrorMessage(error),'warn');}finally{button.disabled=false;}}
  async function diagnostic(){hideNotice();var button=$('diagnosticBtn');button.disabled=true;try{await ensureSession(false);var data=await api('diagnostic');renderDiagnostic(data);show('상품 후보·중개수익 전용 점검 JSON을 읽었습니다. 이 동작은 읽기 전용입니다.','ok');}catch(error){show(authErrorMessage(error),'warn');}finally{button.disabled=false;}}
  async function copyDiagnostic(){if(!diagnosticCache)return;var raw=JSON.stringify(diagnosticCache,null,2);try{if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(raw);show('점검 JSON을 클립보드에 복사했습니다.','ok');return;}}catch(_e){}var area=document.createElement('textarea');area.value=raw;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();try{document.execCommand('copy');show('점검 JSON을 클립보드에 복사했습니다.','ok');}catch(_e){show('브라우저가 클립보드 복사를 허용하지 않았습니다. JSON 창에서 직접 복사해 주세요.','warn');}finally{area.remove();}}
  function back(){var q=new URLSearchParams(location.search);var p=q.get('returnPath');location.href=p&&p.charAt(0)==='/'?p:'/admin.html';}
  function init(){
    $('refreshBtn').addEventListener('click',refresh);$('diagnosticBtn').addEventListener('click',diagnostic);$('copyDiagnosticBtn').addEventListener('click',copyDiagnostic);$('returnBtn').addEventListener('click',back);
    document.addEventListener('igdc:member-auth-ready',function(){acceptedToken='';acceptedSession=null;refresh();});
    window.addEventListener('pageshow',function(){acceptedToken='';acceptedSession=null;refresh();});
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
