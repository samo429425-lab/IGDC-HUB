/* IGDC Media Candidate Queue Admin View v1.0.3
 * Read-only media candidate verifier. This page does not create a second login
 * and does not block on client-side token handoff. The server function returns
 * only safe read-only candidate diagnostics and never mutates public snapshots.
 */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/media-candidate-review';
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(v){return String(v==null?'':v).trim();};
  var lower=function(v){return text(v).toLowerCase();};
  var state=$('state'), notice=$('notice'), diagnosticCache=null, rowsCache=[];

  function cls(kind){return kind==='ok'?'ok':kind==='warn'?'warn':'';}
  function show(message,kind){notice.className='notice '+cls(kind);notice.textContent=message;notice.classList.remove('hidden');}
  function hideNotice(){notice.classList.add('hidden');notice.textContent='';}
  function authHeaders(){
    var headers={Accept:'application/json'};
    try{
      var token=sessionStorage.getItem('igdc.mediaCandidateQueue.adminBearer')||localStorage.getItem('igdc.mediaCandidateQueue.adminBearer')||'';
      if(token&&String(token).split('.').length===3)headers.Authorization='Bearer '+token;
    }catch(_e){}
    return headers;
  }
  async function request(action){
    state.textContent='미디어 후보 대기열을 읽는 중입니다.';
    var response=await fetch(ENDPOINT+'?action='+encodeURIComponent(action),{headers:authHeaders(),credentials:'same-origin',cache:'no-store'});
    var data=null;try{data=await response.json();}catch(_e){}
    if(!response.ok||!data||data.ok!==true){var error=new Error((data&&data.error)||('요청 실패: HTTP '+response.status));error.code=data&&data.code;error.status=response.status;throw error;}
    var mode=(data.source&&data.source.candidateSourceMode)||data.mode||'read_only';
    state.textContent='읽기 전용 연결 확인: '+mode;
    return data;
  }

  function card(title,value,sub,kind){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num status-'+esc(kind||'info')+'">'+esc(value)+'</div><div class="small">'+esc(sub||'')+'</div></article>';}
  function renderSummary(summary){
    var s=summary||{};
    $('summaryGrid').innerHTML=[
      card('후보 영상',s.candidateCount||0,'2~10번 섹션 후보','info'),
      card('프론트 승격 가능',s.promotableCount||0,'검증 완료 후보만 계산','ok'),
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
    if(!diagnosticCache){show('먼저 미디어 점검 JSON을 읽어 주세요.','warn');return;}
    var blob=new Blob([JSON.stringify(diagnosticCache,null,2)+'\n'],{type:'application/json;charset=utf-8'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='igdc-media-candidate-queue-diagnostic-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json';
    document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},300);
    show('미디어 후보 점검 JSON 파일을 다운로드했습니다.','ok');
  }
  function errorMessage(error){
    var message=text(error&&error.message);
    if(Number(error&&error.status)===404)return 'media-candidate-review 함수가 아직 배포되지 않았습니다.';
    if(Number(error&&error.status)===500)return message||'함수 내부 오류입니다. 후보 JSON 위치 또는 Supabase 설정을 확인해야 합니다.';
    return message||'요청을 처리하지 못했습니다.';
  }
  async function refresh(){
    hideNotice();var button=$('refreshBtn');button.disabled=true;
    try{var data=await request('candidates');rowsCache=data.candidates||[];renderSummary(data.summary||{});setupFilters(data.summary||{});renderRows();show('미디어 후보 대기열을 읽었습니다. 이 동작은 공개 발행·외부 재생·결제를 실행하지 않습니다.','ok');}
    catch(error){show(errorMessage(error),'warn');}
    finally{button.disabled=false;}
  }
  async function diagnostic(){
    hideNotice();var button=$('diagnosticBtn');button.disabled=true;
    try{var data=await request('diagnostic');renderDiagnostic(data);if(data.queue&&Array.isArray(data.queue.rows)){rowsCache=data.queue.rows;renderSummary(data.summary||{});setupFilters(data.summary||{});renderRows();}show('미디어 후보 점검 JSON을 읽었습니다.','ok');}
    catch(error){show(errorMessage(error),'warn');}
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
    window.addEventListener('pageshow',refresh);
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
