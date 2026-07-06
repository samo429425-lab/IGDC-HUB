/* IGDC Commerce Candidate Pipeline Admin View v1.2.0
 * Private staging viewer + read-only commerce queue diagnostic.
 * It never exposes a release key, invokes a provider, opens a seller link,
 * or publishes a Snapshot from the browser. */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/commerce-candidate-review';
  var SITE_ISSUER='https://login.igdcglobal.com/';
  var DEFAULT_SPA_AUDIENCE='4JeT1FdyDZaN7nEODVsKe2Sx8kKMWagj';
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(v){return String(v==null?'':v).trim();};
  var state=$('state'), notice=$('notice'), diagnosticCache=null;

  function cls(kind){return kind==='ok'?'ok':kind==='warn'?'warn':'';}
  function show(message,kind){notice.className='notice '+cls(kind);notice.textContent=message;notice.classList.remove('hidden');}
  function hideNotice(){notice.classList.add('hidden');notice.textContent='';}
  function parseJson(value){try{return JSON.parse(value);}catch(_e){return null;}}
  function decodeJwt(token){try{var parts=String(token||'').split('.');if(parts.length!==3)return null;var raw=parts[1].replace(/-/g,'+').replace(/_/g,'/');while(raw.length%4)raw+='=';return JSON.parse(window.atob(raw));}catch(_e){return null;}}
  function audienceList(){var list=[DEFAULT_SPA_AUDIENCE];try{if(window.IGDC_AUTH_SESSION&&window.IGDC_AUTH_SESSION.clientId)list.unshift(String(window.IGDC_AUTH_SESSION.clientId));}catch(_e){}return list.filter(function(v,i,a){return v&&a.indexOf(v)===i;});}
  function validPortalToken(token){var payload=decodeJwt(token);if(!payload||!payload.sub||!payload.exp||Number(payload.exp)*1000<=Date.now()+15000)return null;if(String(payload.iss||'')!==SITE_ISSUER)return null;var aud=Array.isArray(payload.aud)?payload.aud.map(String):[String(payload.aud||'')];if(!audienceList().some(function(value){return aud.indexOf(value)>=0;}))return null;return payload;}
  function storageToken(storage){try{var rec=parseJson(storage.getItem('osauth.tokens.v2')||'');if(rec&&typeof rec==='object'&&validPortalToken(rec.id_token))return rec.id_token;}catch(_e){}return '';}
  function preferredToken(){
    var candidates=[];
    try{if(window.osAuth&&typeof window.osAuth.getIdToken==='function')candidates.push(window.osAuth.getIdToken());}catch(_e){}
    try{candidates.push(storageToken(window.localStorage),storageToken(window.sessionStorage));}catch(_e){}
    try{candidates.push(window.IGDCMemberAuth&&window.IGDCMemberAuth.getIdToken?window.IGDCMemberAuth.getIdToken():'');}catch(_e){}
    try{candidates.push(window.localStorage.getItem('igdc_id_token'),window.localStorage.getItem('id_token'),window.sessionStorage.getItem('igdc_id_token'),window.sessionStorage.getItem('id_token'));}catch(_e){}
    for(var i=0;i<candidates.length;i++)if(validPortalToken(candidates[i]))return candidates[i];
    return '';
  }
  function token(){return preferredToken();}
  function rolesFromPayload(payload){var keys=['https://igdcglobal.com/roles','https://os.auth/roles','roles','role','permissions'],out=[];keys.forEach(function(key){var v=payload&&payload[key];if(Array.isArray(v))out=out.concat(v);else if(typeof v==='string')out=out.concat(v.split(','));});return out.map(function(v){return text(v).toLowerCase().replace(/\s+/g,'_');}).filter(function(v,i,a){return v&&a.indexOf(v)===i;});}
  function roles(){return rolesFromPayload(decodeJwt(token())||{});}
  function authenticated(){return !!token();}
  function updateAuth(){var ok=authenticated(),r=roles();state.textContent=ok?'대기열 관리자 세션 확인: '+(r.join(', ')||'역할 정보 없음'):'대기열용 관리자 세션이 필요합니다.';$('loginBtn').textContent=ok?'세션 다시 확인':'관리자 로그인';}
  function authErrorMessage(error){var code=text(error&&error.code),msg=text(error&&error.message);if(code==='member_token_invalid'||/Invalid member session/i.test(msg))return '현재 페이지의 대기열용 관리자 세션이 일치하지 않습니다. 관리자 로그인을 다시 실행한 뒤 재시도해 주세요.';if(code==='member_token_expired')return '관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.';return msg||'대기열 요청을 처리하지 못했습니다.';}
  async function api(action){var t=token();if(!t){var err=new Error('대기열용 관리자 세션이 필요합니다.');err.code='login';throw err;}var res=await fetch(ENDPOINT+'?action='+encodeURIComponent(action),{headers:{Authorization:'Bearer '+t,Accept:'application/json'},credentials:'same-origin',cache:'no-store'});var data=null;try{data=await res.json();}catch(_e){}if(!res.ok||!data||data.ok!==true){var e=new Error((data&&data.error)||('요청 실패: HTTP '+res.status));e.code=data&&data.code;throw e;}return data;}
  function labelTier(v){var x=text(v);return x==='approved_commerce_member'?'직접등록 승인':x==='managed_sponsor'?'관리 스폰서':x==='external_brokerage'?'외부중개/연결':x||'미분류';}
  function tierClass(v){return v==='approved_commerce_member'?'direct':v==='managed_sponsor'?'sponsor':'external';}
  function statusPill(c){return c.releaseEligible?'<span class="pill release">발행 전 통과</span>':'<span class="pill hold">검토/차단</span>';}
  function number(v){var n=Number(v);return Number.isFinite(n)?n:0;}
  function gridCard(title,value,small){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num">'+esc(value)+'</div><div class="small">'+esc(small||'')+'</div></article>';}
  function renderSummary(summary){var s=summary.summary||{};var g=$('summaryGrid');g.innerHTML=''+gridCard('검토 후보',s.considered||0,'SearchBank·관리자 대기열 결합')+gridCard('발행 전 통과',s.eligibleForRelease||0,'공개 키는 별도 배포 환경에서만')+gridCard('현재 정식 발행',s.releasedToCanonical||0,'현재 실행 기준 Canonical 전달 수')+gridCard('검토 보류',s.held||0,'증빙·수익·승인 누락 포함');g.classList.remove('hidden');var gate=summary.releaseGate||{};var panel=$('policyPanel');var release=gate.enabled===true;panel.innerHTML='<h2>공개 전 안전 상태</h2><div class="notice '+(release?'ok':'warn')+'"><strong>'+esc(release?'발행 키가 배포 환경에서 확인됨':'현재는 비공개 대기열 상태')+'</strong><br>'+esc(release?'그래도 각 후보는 Canonical·IP·판매시장 검증을 다시 통과해야 합니다.':'현재 후보는 관리자 검토와 증빙 수집 단계에만 남으며, 프론트 상품 슬롯으로 자동 공개되지 않습니다.')+'</div><div class="small" style="margin-top:9px">릴리스 키 값과 비밀정보는 이 화면에 표시하지 않습니다. stage: '+esc(summary.generatedAt||'아직 생성되지 않음')+'</div>';panel.classList.remove('hidden');}
  function renderRows(candidates){var tbody=$('candidateRows');var list=Array.isArray(candidates)?candidates:[];if(!list.length){tbody.innerHTML='<tr><td colspan="9" class="empty">현재 표시할 비공개 후보가 없습니다. 기존 샘플·미검증 후보는 정상적으로 대기열에서 제외됩니다.</td></tr>';$('tablePanel').classList.remove('hidden');return;}tbody.innerHTML=list.map(function(c){var p=c.placement||{},r=c.revenue||{},v=c.review||{},rank=c.ranking||{};var reasons=Array.isArray(c.reasons)&&c.reasons.length?c.reasons.join('\n'):'-';return '<tr><td><strong class="mono">'+esc(c.candidateId||'-')+'</strong><br><span class="small">host: '+esc(c.destinationHost||'-')+'</span></td><td><span class="pill '+tierClass(c.sourceTier)+'">'+esc(labelTier(c.sourceTier))+'</span></td><td>'+statusPill(c)+'</td><td><span class="mono">'+esc((p.page||'-')+' / '+(p.section||'-')+(p.slot?' / '+p.slot:''))+'</span></td><td>'+esc((c.marketKeys||[]).join(', ')||'-')+'</td><td>'+esc(c.essentialClass||'-')+'</td><td><span class="mono">'+esc(r.type||'-')+'</span><br><span class="small">상태: '+esc(r.monetizationState||'-')+' · 계약: '+esc(r.contractId||'-')+' · 검토: '+esc(v.state||'-')+'</span><br><span class="small">경로: '+esc(r.outboundRoute&&r.outboundRoute.mode||'-')+'</span></td><td><strong>'+esc(number(rank.finalScore).toFixed(2))+'</strong><br><span class="small">생활 '+esc(rank.essentiality||0)+' · 신뢰 '+esc(rank.sellerTrust||0)+' · 수익 '+esc(rank.revenueCertainty||0)+'</span></td><td class="reason">'+esc(reasons).replace(/\n/g,'<br>')+'</td></tr>';}).join('');$('tablePanel').classList.remove('hidden');}
  function renderDiagnostic(doc){diagnosticCache=doc||null;var panel=$('diagnosticPanel'),pre=$('diagnosticJson');pre.textContent=JSON.stringify(doc||{},null,2);panel.classList.remove('hidden');$('copyDiagnosticBtn').disabled=!diagnosticCache;}
  async function refresh(){updateAuth();hideNotice();var button=$('refreshBtn');button.disabled=true;try{if(!authenticated()){show('대기열용 관리자 세션이 필요합니다. 관리자 로그인 후 비공개 후보를 조회합니다.','warn');return;}var both=await Promise.all([api('session'),api('summary'),api('candidates')]);renderSummary(both[1].summary||{});renderRows(both[2].candidates||[]);show('비공개 상품 후보 대기열을 새로 읽었습니다. 이 동작은 공개 발행·외부 판매처 이동·결제를 실행하지 않습니다.','ok');}catch(error){show(authErrorMessage(error),'warn');}finally{button.disabled=false;updateAuth();}}
  async function diagnostic(){updateAuth();hideNotice();var button=$('diagnosticBtn');button.disabled=true;try{if(!authenticated()){show('대기열용 관리자 세션이 필요합니다.','warn');return;}var data=await api('diagnostic');renderDiagnostic(data);show('상품 후보·중개수익 전용 점검 JSON을 읽었습니다. 이 동작은 읽기 전용입니다.','ok');}catch(error){show(authErrorMessage(error),'warn');}finally{button.disabled=false;updateAuth();}}
  async function copyDiagnostic(){if(!diagnosticCache)return;var raw=JSON.stringify(diagnosticCache,null,2);try{if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(raw);show('점검 JSON을 클립보드에 복사했습니다.','ok');return;}}catch(_e){}var area=document.createElement('textarea');area.value=raw;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();try{document.execCommand('copy');show('점검 JSON을 클립보드에 복사했습니다.','ok');}catch(_e){show('브라우저가 클립보드 복사를 허용하지 않았습니다. JSON 창에서 직접 복사해 주세요.','warn');}finally{area.remove();}}
  function login(){if(authenticated()){refresh();return;}try{if(window.IGDCMemberAuth&&window.IGDCMemberAuth.beginLogin){window.IGDCMemberAuth.beginLogin();return;}if(typeof window.osLogin==='function'){window.osLogin();return;}}catch(_e){}show('현재 페이지에서 관리자 로그인 연결을 시작하지 못했습니다. 사이트 상단의 로그아웃 후 다시 로그인해 주세요.','warn');}
  function back(){var q=new URLSearchParams(location.search);var p=q.get('returnPath');location.href=p&&p.charAt(0)==='/'?p:'/admin.html';}
  function init(){$('refreshBtn').addEventListener('click',refresh);$('diagnosticBtn').addEventListener('click',diagnostic);$('copyDiagnosticBtn').addEventListener('click',copyDiagnostic);$('loginBtn').addEventListener('click',login);$('returnBtn').addEventListener('click',back);document.addEventListener('igdc:member-auth-ready',function(){updateAuth();if(authenticated())refresh();});updateAuth();if(authenticated())refresh();else show('이 페이지는 관리자·운영진의 비공개 후보 검토 및 점검 JSON 열람용입니다. 관리자 로그인 후 읽을 수 있습니다.','warn');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
