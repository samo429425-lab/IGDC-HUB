/* IGDC Commerce Candidate Pipeline Admin View v1.2.1
 * Private staging viewer + read-only commerce queue diagnostic.
 * Browser code never contains an Auth0 client identifier, client secret, API key,
 * or release key. Candidate session tokens are validated by the server before
 * any private queue request is accepted. */
(function(){
  'use strict';

  var ENDPOINT='/.netlify/functions/commerce-candidate-review';
  var TOKEN_RECORD_KEYS=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens','auth0spa'];
  var TOKEN_PLAIN_KEYS=['igdc_id_token','id_token','auth0_id_token'];
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(v){return String(v==null?'':v).trim();};
  var state=$('state'), notice=$('notice'), diagnosticCache=null, selectedToken='';

  function cls(kind){return kind==='ok'?'ok':kind==='warn'?'warn':'';}
  function show(message,kind){notice.className='notice '+cls(kind);notice.textContent=message;notice.classList.remove('hidden');}
  function hideNotice(){notice.classList.add('hidden');notice.textContent='';}
  function parseJson(value){try{return JSON.parse(value);}catch(_e){return null;}}
  function decodeJwt(token){
    try{
      var parts=String(token||'').split('.');
      if(parts.length!==3)return null;
      var raw=parts[1].replace(/-/g,'+').replace(/_/g,'/');
      while(raw.length%4)raw+='=';
      return JSON.parse(window.atob(raw));
    }catch(_e){return null;}
  }
  function usableToken(token){
    var value=text(token), payload=decodeJwt(value);
    if(!value||!payload||!payload.sub||!payload.exp)return '';
    if(Number(payload.exp)*1000<=Date.now()+15000)return '';
    if(!/^https:\/\//i.test(text(payload.iss)))return '';
    return value;
  }
  function addToken(list,value){
    var token=usableToken(value);
    if(token&&list.indexOf(token)<0)list.push(token);
  }
  function appendRecordTokens(list,record){
    if(!record||typeof record!=='object')return;
    ['id_token','idToken','__raw','raw'].forEach(function(key){addToken(list,record[key]);});
  }
  function storageTokens(storage,list){
    if(!storage)return;
    TOKEN_RECORD_KEYS.forEach(function(key){
      try{appendRecordTokens(list,parseJson(storage.getItem(key)||''));}catch(_e){}
    });
    TOKEN_PLAIN_KEYS.forEach(function(key){
      try{addToken(list,storage.getItem(key));}catch(_e){}
    });
  }
  function candidateTokens(){
    var list=[];
    try{
      if(window.osAuth&&typeof window.osAuth.getIdToken==='function'){
        addToken(list,window.osAuth.getIdToken());
      }
    }catch(_e){}
    try{storageTokens(window.localStorage,list);}catch(_e){}
    try{storageTokens(window.sessionStorage,list);}catch(_e){}
    try{
      if(window.IGDCMemberAuth&&typeof window.IGDCMemberAuth.getIdToken==='function'){
        addToken(list,window.IGDCMemberAuth.getIdToken());
      }
    }catch(_e){}
    return list;
  }
  function rolesFromPayload(payload){
    var keys=['https://igdcglobal.com/roles','https://os.auth/roles','roles','role','permissions'],out=[];
    keys.forEach(function(key){
      var value=payload&&payload[key];
      if(Array.isArray(value))out=out.concat(value);
      else if(typeof value==='string')out=out.concat(value.split(','));
    });
    return out.map(function(value){return text(value).toLowerCase().replace(/\s+/g,'_');})
      .filter(function(value,index,all){return value&&all.indexOf(value)===index;});
  }
  function currentToken(){
    return selectedToken||candidateTokens()[0]||'';
  }
  function roles(){return rolesFromPayload(decodeJwt(currentToken())||{});}
  function hasCandidateSession(){return !!currentToken();}
  function updateAuth(){
    var active=!!selectedToken, candidate=hasCandidateSession(), r=roles();
    if(active)state.textContent='대기열 관리자 세션 확인: '+(r.join(', ')||'역할 정보 없음');
    else if(candidate)state.textContent='대기열용 관리자 세션 후보 감지: 서버 검증 대기';
    else state.textContent='대기열용 관리자 로그인이 필요합니다.';
    $('loginBtn').textContent=active?'세션 다시 확인':'관리자 로그인';
  }
  function responseError(data,status){
    var error=new Error((data&&data.error)||('요청 실패: HTTP '+status));
    error.code=data&&data.code;
    return error;
  }
  async function rawRequest(action,token){
    var response=await fetch(ENDPOINT+'?action='+encodeURIComponent(action),{
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      credentials:'same-origin',
      cache:'no-store'
    });
    var data=null;
    try{data=await response.json();}catch(_e){}
    return {ok:response.ok&&data&&data.ok===true,response:response,data:data,error:response.ok&&data&&data.ok===true?null:responseError(data,response.status)};
  }
  async function resolveValidatedToken(){
    if(selectedToken){
      var current=await rawRequest('session',selectedToken);
      if(current.ok)return selectedToken;
      selectedToken='';
    }
    var candidates=candidateTokens(),lastError=null;
    for(var index=0;index<candidates.length;index++){
      var checked=await rawRequest('session',candidates[index]);
      if(checked.ok){
        selectedToken=candidates[index];
        return selectedToken;
      }
      lastError=checked.error||lastError;
    }
    throw lastError||new Error('대기열용 관리자 세션이 필요합니다.');
  }
  async function api(action){
    var token=await resolveValidatedToken();
    var result=await rawRequest(action,token);
    if(result.ok)return result.data;
    if(result.error&&(/^member_token_/.test(text(result.error.code))||/Invalid member session/i.test(text(result.error.message)))){
      selectedToken='';
      token=await resolveValidatedToken();
      result=await rawRequest(action,token);
      if(result.ok)return result.data;
    }
    throw result.error||new Error('대기열 요청을 처리하지 못했습니다.');
  }
  function authErrorMessage(error){
    var code=text(error&&error.code),message=text(error&&error.message);
    if(code==='member_login_required')return '대기열용 관리자 로그인이 필요합니다.';
    if(code==='member_token_expired')return '관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.';
    if(/^member_token_/.test(code)||/Invalid member session/i.test(message)){
      return '현재 브라우저의 로그인 토큰이 대기열 서버 검증과 일치하지 않습니다. 사이트 상단에서 로그아웃한 뒤 관리자 계정으로 다시 로그인해 주세요.';
    }
    if(code==='commerce_auth_not_configured')return '대기열 인증 서버 설정이 준비되지 않았습니다. 관리자 인증 환경 설정을 확인해 주세요.';
    return message||'대기열 요청을 처리하지 못했습니다.';
  }
  function labelTier(v){var x=text(v);return x==='approved_commerce_member'?'직접등록 승인':x==='managed_sponsor'?'관리 스폰서':x==='external_brokerage'?'외부중개/연결':x||'미분류';}
  function tierClass(v){return v==='approved_commerce_member'?'direct':v==='managed_sponsor'?'sponsor':'external';}
  function statusPill(c){return c.releaseEligible?'<span class="pill release">발행 전 통과</span>':'<span class="pill hold">검토/차단</span>';}
  function number(v){var n=Number(v);return Number.isFinite(n)?n:0;}
  function gridCard(title,value,small){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num">'+esc(value)+'</div><div class="small">'+esc(small||'')+'</div></article>';}
  function renderSummary(summary){
    var s=summary.summary||{},g=$('summaryGrid');
    g.innerHTML=''+gridCard('검토 후보',s.considered||0,'SearchBank·관리자 대기열 결합')+
      gridCard('발행 전 통과',s.eligibleForRelease||0,'공개 키는 별도 배포 환경에서만')+
      gridCard('현재 정식 발행',s.releasedToCanonical||0,'현재 실행 기준 Canonical 전달 수')+
      gridCard('검토 보류',s.held||0,'증빙·수익·승인 누락 포함');
    g.classList.remove('hidden');
    var gate=summary.releaseGate||{},panel=$('policyPanel'),release=gate.enabled===true;
    panel.innerHTML='<h2>공개 전 안전 상태</h2><div class="notice '+(release?'ok':'warn')+'"><strong>'+
      esc(release?'발행 키가 배포 환경에서 확인됨':'현재는 비공개 대기열 상태')+
      '</strong><br>'+esc(release?'그래도 각 후보는 Canonical·IP·판매시장 검증을 다시 통과해야 합니다.':
      '현재 후보는 관리자 검토와 증빙 수집 단계에만 남으며, 프론트 상품 슬롯으로 자동 공개되지 않습니다.')+
      '</div><div class="small" style="margin-top:9px">릴리스 키 값과 비밀정보는 이 화면에 표시하지 않습니다. stage: '+
      esc(summary.generatedAt||'아직 생성되지 않음')+'</div>';
    panel.classList.remove('hidden');
  }
  function renderRows(candidates){
    var tbody=$('candidateRows'),list=Array.isArray(candidates)?candidates:[];
    if(!list.length){
      tbody.innerHTML='<tr><td colspan="9" class="empty">현재 표시할 비공개 후보가 없습니다. 기존 샘플·미검증 후보는 정상적으로 대기열에서 제외됩니다.</td></tr>';
      $('tablePanel').classList.remove('hidden');
      return;
    }
    tbody.innerHTML=list.map(function(c){
      var p=c.placement||{},r=c.revenue||{},v=c.review||{},rank=c.ranking||{};
      var reasons=Array.isArray(c.reasons)&&c.reasons.length?c.reasons.join('\n'):'-';
      return '<tr><td><strong class="mono">'+esc(c.candidateId||'-')+'</strong><br><span class="small">host: '+esc(c.destinationHost||'-')+
        '</span></td><td><span class="pill '+tierClass(c.sourceTier)+'">'+esc(labelTier(c.sourceTier))+'</span></td><td>'+
        statusPill(c)+'</td><td><span class="mono">'+esc((p.page||'-')+' / '+(p.section||'-')+(p.slot?' / '+p.slot:''))+
        '</span></td><td>'+esc((c.marketKeys||[]).join(', ')||'-')+'</td><td>'+esc(c.essentialClass||'-')+
        '</td><td><span class="mono">'+esc(r.type||'-')+'</span><br><span class="small">상태: '+esc(r.monetizationState||'-')+
        ' · 계약: '+esc(r.contractId||'-')+' · 검토: '+esc(v.state||'-')+'</span><br><span class="small">경로: '+
        esc(r.outboundRoute&&r.outboundRoute.mode||'-')+'</span></td><td><strong>'+esc(number(rank.finalScore).toFixed(2))+
        '</strong><br><span class="small">생활 '+esc(rank.essentiality||0)+' · 신뢰 '+esc(rank.sellerTrust||0)+' · 수익 '+
        esc(rank.revenueCertainty||0)+'</span></td><td class="reason">'+esc(reasons).replace(/\n/g,'<br>')+'</td></tr>';
    }).join('');
    $('tablePanel').classList.remove('hidden');
  }
  function renderDiagnostic(doc){
    diagnosticCache=doc||null;
    $('diagnosticJson').textContent=JSON.stringify(doc||{},null,2);
    $('diagnosticPanel').classList.remove('hidden');
    $('copyDiagnosticBtn').disabled=!diagnosticCache;
  }
  async function refresh(){
    updateAuth();hideNotice();
    var button=$('refreshBtn');button.disabled=true;
    try{
      await api('session');
      updateAuth();
      var both=await Promise.all([api('summary'),api('candidates')]);
      renderSummary(both[0].summary||{});
      renderRows(both[1].candidates||[]);
      show('비공개 상품 후보 대기열을 새로 읽었습니다. 이 동작은 공개 발행·외부 판매처 이동·결제를 실행하지 않습니다.','ok');
    }catch(error){
      show(authErrorMessage(error),'warn');
    }finally{
      button.disabled=false;updateAuth();
    }
  }
  async function diagnostic(){
    updateAuth();hideNotice();
    var button=$('diagnosticBtn');button.disabled=true;
    try{
      var data=await api('diagnostic');
      renderDiagnostic(data);
      show('상품 후보·중개수익 전용 점검 JSON을 읽었습니다. 이 동작은 읽기 전용입니다.','ok');
    }catch(error){
      show(authErrorMessage(error),'warn');
    }finally{
      button.disabled=false;updateAuth();
    }
  }
  async function copyDiagnostic(){
    if(!diagnosticCache)return;
    var raw=JSON.stringify(diagnosticCache,null,2);
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        await navigator.clipboard.writeText(raw);
        show('점검 JSON을 클립보드에 복사했습니다.','ok');
        return;
      }
    }catch(_e){}
    var area=document.createElement('textarea');
    area.value=raw;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();
    try{document.execCommand('copy');show('점검 JSON을 클립보드에 복사했습니다.','ok');}
    catch(_e){show('브라우저가 클립보드 복사를 허용하지 않았습니다. JSON 창에서 직접 복사해 주세요.','warn');}
    finally{area.remove();}
  }
  function login(){
    selectedToken='';
    try{
      if(window.IGDCMemberAuth&&window.IGDCMemberAuth.beginLogin){
        window.IGDCMemberAuth.beginLogin();
        return;
      }
      if(typeof window.osLogin==='function'){
        window.osLogin();
        return;
      }
    }catch(_e){}
    show('현재 페이지에서 관리자 로그인 연결을 시작하지 못했습니다. 사이트 상단의 로그아웃 후 다시 로그인해 주세요.','warn');
  }
  function back(){
    var q=new URLSearchParams(location.search),p=q.get('returnPath');
    location.href=p&&p.charAt(0)==='/'?p:'/admin.html';
  }
  function init(){
    $('refreshBtn').addEventListener('click',refresh);
    $('diagnosticBtn').addEventListener('click',diagnostic);
    $('copyDiagnosticBtn').addEventListener('click',copyDiagnostic);
    $('loginBtn').addEventListener('click',login);
    $('returnBtn').addEventListener('click',back);
    document.addEventListener('igdc:member-auth-ready',function(){selectedToken='';updateAuth();if(hasCandidateSession())refresh();});
    updateAuth();
    if(hasCandidateSession())refresh();
    else show('이 페이지는 관리자·운영진의 비공개 후보 검토 및 점검 JSON 열람용입니다. 관리자 로그인 후 읽을 수 있습니다.','warn');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();