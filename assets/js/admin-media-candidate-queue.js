/* IGDC Media Candidate Queue Admin View v1.0.0
 * Read-only media candidate verifier. It reuses the administrator session,
 * reads the private media candidate snapshot through a Netlify function, and
 * never promotes candidates to the public media snapshot.
 */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/media-candidate-review';
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(v){return String(v==null?'':v).trim();};
  var lower=function(v){return text(v).toLowerCase();};
  var state=$('state'), notice=$('notice'), diagnosticCache=null, acceptedToken='', acceptedSession=null, resolvingSession=null, rowsCache=[];
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
    function add(candidate){try{if(!candidate||seen.indexOf(candidate)>=0)return;void candidate.location.href;seen.push(candidate);values.push(candidate);}catch(_e){}}
    add(window);try{add(window.parent);}catch(_e){}try{add(window.top);}catch(_e){}return values;
  }
  async function tokenCandidates(){
    var out=[],seen={},tasks=[],sources=sameOriginWindows();
    function from(fn){tasks.push(Promise.resolve().then(fn).then(function(value){pushToken(value,out,seen,0);}).catch(function(){}));}
    for(var i=0;i<sources.length;i++)(function(source){
      from(function(){return source.IGDCMemberAuth&&source.IGDCMemberAuth.getIdToken?source.IGDCMemberAuth.getIdToken():'';});
      from(function(){if(!source.osAuth)return '';if(typeof source.osAuth.getIdTokenClaims==='function')return source.osAuth.getIdTokenClaims();return '';});
      from(function(){return source.osAuth&&source.osAuth.getIdToken?source.osAuth.getIdToken():'';});
      ownStorageTokens(source,out,seen);
    })(sources[i]);
    await Promise.all(tasks);return out;
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
        try{var data=await request('session',candidates[i]);acceptedToken=candidates[i];acceptedSession=data;state.textContent='관리자 공통 세션 확인: '+sessionLabel(data);return data;}catch(_e){}
      }
      acceptedToken='';acceptedSession=null;
      throw new Error('관리자 페이지의 공통 세션을 확인하지 못했습니다. 이 화면은 별도 로그인 없이 관리자 화면의 기존 세션만 사용합니다.');
    })();
    try{return await resolvingSession;}finally{resolvingSession=null;}
  }
  async function api(action){await ensureSession(false);return request(action,acceptedToken);}

  function card(title,value,sub,kind){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num status-'+esc(kind||'info')+'">'+esc(value)+'</div><div class="small">'+esc(sub||'')+'</div></article>';}
  function renderSummary(summary){
    var s=summary||{};
    $('summaryGrid').innerHTML=[
      card('후보 영상',s.candidateCount||0,'2~10번 섹션 후보','info'),
      card('프론트 승격 가능',s.promotableCount||0,'현재 검증 완료만 계산','ok'),
      card('검증 대기',s.verificationRequired||0,'웹/권리/소스 확인 필요','warn'),
      card('최신 섹션 수동후보',s.trendingManualCandidates||0,'0이어야 정상','info'),
      card('공개 스냅샷 영향',s.publicSnapshotMutation||'없음','읽기 전용 대기열','ok')
    ].join('');
    $('summaryGrid').classList.remove('hidden');
  }
  function sortedKeys(map){return Object.keys(map||{}).sort();}
  function fillSelect(id, values, label){
    var el=$(id); if(!el)return;
    var current=el.value;
    el.innerHTML='<option value="">'+esc(label)+'</option>'+values.map(function(v){return '<option value="'+esc(v)+'">'+esc(v)+'</option>';}).join('');
    if(values.indexOf(current)>=0)el.value=current;
  }
  function setupFilters(summary){
    fillSelect('sectionFilter', sortedKeys(summary&&summary.bySection), '전체 섹션');
    fillSelect('riskFilter', sortedKeys(summary&&summary.byRisk), '전체 위험도');
    fillSelect('statusFilter', sortedKeys(summary&&summary.byVerificationStatus), '전체 검증상태');
    $('filterPanel').classList.remove('hidden');
  }
  function pill(value,kind){return '<span class="pill '+esc(kind||'')+'">'+esc(value||'-')+'</span>';}
  function hasSource(row){return !!(text(row.url)||text(row.video)||text(row.thumb)||text(row.rights&&row.rights.sourceUrl)||text(row.rights&&row.rights.licenseUrl));}
  function sourceState(row){
    var parts=[];
    if(text(row.url)||text(row.video))parts.push('영상URL 후보 있음');
    if(text(row.thumb))parts.push('썸네일 있음');
    if(text(row.rights&&row.rights.sourceUrl))parts.push('원출처 있음');
    if(text(row.rights&&row.rights.licenseUrl))parts.push('라이선스URL 있음');
    if(!parts.length)parts.push('URL 미검증');
    return parts.join(' · ');
  }
  function visibleRows(){
    var q=lower($('searchInput').value), section=text($('sectionFilter').value), risk=text($('riskFilter').value), status=text($('statusFilter').value);
    return rowsCache.filter(function(row){
      if(section&&text(row.sectionKey)!==section)return false;
      if(risk&&text(row.riskLevel)!==risk)return false;
      if(status&&text(row.verificationStatus)!==status)return false;
      if(!q)return true;
      var hay=[row.title,row.provider,row.sectionKey,row.region,row.year,row.qualityTarget,row.riskLevel,row.verificationStatus,row.sanmaruSearchSeed,row.rights&&row.rights.sourceHint,row.rights&&row.rights.candidate].map(text).join(' ').toLowerCase();
      return hay.indexOf(q)>=0;
    });
  }
  function renderRows(){
    var rows=visibleRows();
    $('filterState').textContent='표시 '+rows.length+'개 / 전체 '+rowsCache.length+'개';
    $('candidateRows').innerHTML=rows.length?rows.map(function(row){
      var stateClass=(row.promotable===true)?'safe':(hasSource(row)?'risk':'hold');
      return '<tr>'+
        '<td>'+pill(row.sectionKey,'section')+'<div class="small">slot '+esc(row.slotId||'')+'</div></td>'+
        '<td><strong>'+esc(row.title||'(제목 없음)')+'</strong><div class="mono small">'+esc(row.contentId||row.id||'')+'</div></td>'+
        '<td class="nowrap">'+esc(row.year||'-')+'<div class="small">'+esc(row.region||'-')+'</div></td>'+
        '<td>'+esc(row.provider||'-')+'<div class="small">'+esc(row.rights&&row.rights.sourceHint||'')+'</div></td>'+
        '<td>'+esc(row.qualityTarget||'-')+'<div class="small">'+esc(row.qualityPriority||'')+'</div></td>'+
        '<td>'+pill(row.verificationStatus||'verification_required',stateClass)+'<div class="small">'+esc(row.rights&&row.rights.status||'')+' · '+esc(row.riskLevel||'')+'</div></td>'+
        '<td class="reason">'+esc(sourceState(row))+'</td>'+
        '<td class="seed">'+esc(row.sanmaruSearchSeed||'')+'</td>'+
      '</tr>';
    }).join(''):'<tr><td colspan="8" class="empty">조건에 맞는 미디어 후보가 없습니다.</td></tr>';
    $('tablePanel').classList.remove('hidden');
  }
  function renderDiagnostic(data){
    diagnosticCache=data;
    $('diagnosticJson').textContent=JSON.stringify(data,null,2);
    $('diagnosticPanel').classList.remove('hidden');
    $('downloadJsonBtn').disabled=false;
  }
  function downloadJson(){
    if(!diagnosticCache)return;
    var blob=new Blob([JSON.stringify(diagnosticCache,null,2)],{type:'application/json;charset=utf-8'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='igdc-media-candidate-queue-diagnostic-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json';
    document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},300);
    show('미디어 후보 점검 JSON 파일을 다운로드했습니다.','ok');
  }
  function authErrorMessage(error){
    if(error&&error.status===401)return '관리자 로그인이 필요합니다. 관리자 화면에서 로그인 후 다시 열어주세요.';
    if(error&&error.status===403)return '미디어 후보 대기열 조회 권한이 없습니다.';
    return (error&&error.message)||'요청을 처리하지 못했습니다.';
  }
  async function refresh(){
    hideNotice();var button=$('refreshBtn');button.disabled=true;
    try{await ensureSession(false);var data=await api('candidates');rowsCache=data.candidates||[];renderSummary(data.summary||{});setupFilters(data.summary||{});renderRows();show('미디어 후보 대기열을 읽었습니다. 이 동작은 공개 발행·외부 재생·결제를 실행하지 않습니다.','ok');}
    catch(error){show(authErrorMessage(error),'warn');}
    finally{button.disabled=false;}
  }
  async function diagnostic(){
    hideNotice();var button=$('diagnosticBtn');button.disabled=true;
    try{await ensureSession(false);var data=await api('diagnostic');renderDiagnostic(data);if(data.queue&&Array.isArray(data.queue.rows)){rowsCache=data.queue.rows;renderSummary(data.summary||{});setupFilters(data.summary||{});renderRows();}show('미디어 후보 점검 JSON을 읽었습니다.','ok');}
    catch(error){show(authErrorMessage(error),'warn');}
    finally{button.disabled=false;}
  }
  function returnToAdmin(){
    var params=new URLSearchParams(window.location.search);var raw=params.get('returnPath')||'/admin.html';
    if(!/^\//.test(raw))raw='/admin.html';window.location.href=raw;
  }
  function bind(){
    $('refreshBtn').addEventListener('click',refresh);
    $('diagnosticBtn').addEventListener('click',diagnostic);
    $('downloadJsonBtn').addEventListener('click',downloadJson);
    $('returnBtn').addEventListener('click',returnToAdmin);
    ['searchInput','sectionFilter','riskFilter','statusFilter'].forEach(function(id){$(id).addEventListener('input',renderRows);$(id).addEventListener('change',renderRows);});
    ensureSession(false).then(refresh).catch(function(error){show(authErrorMessage(error),'warn');state.textContent='관리자 세션 확인 실패';});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
