/* IGDC Media Candidate Queue Admin View v1.2.0
 * Controlled media collection -> private candidate queue -> administrator review
 * -> approved snapshot release. No collection result is automatically public.
 */
(function(){
  'use strict';
  var ENDPOINT='/.netlify/functions/media-candidate-review';
  var COLLECTOR='/.netlify/functions/sanmaru-media-collector';
  var ACTION='/.netlify/functions/media-candidate-action';
  var PUBLISH='/.netlify/functions/media-snapshot-publish';
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(v){return String(v==null?'':v).trim();};
  var lower=function(v){return text(v).toLowerCase();};
  var state=$('state'), notice=$('notice'), diagnosticCache=null, rowsCache=[];

  function cls(kind){return kind==='ok'?'ok':kind==='warn'?'warn':'';}
  function show(message,kind){notice.className='notice '+cls(kind);notice.textContent=message;notice.classList.remove('hidden');}
  function hideNotice(){notice.classList.add('hidden');notice.textContent='';}
  function authHeaders(json){
    var headers={Accept:'application/json'};
    if(json)headers['Content-Type']='application/json';
    try{
      var token=sessionStorage.getItem('igdc.mediaCandidateQueue.adminBearer')||localStorage.getItem('igdc.mediaCandidateQueue.adminBearer')||'';
      if(token&&String(token).split('.').length===3)headers.Authorization='Bearer '+token;
    }catch(_e){}
    return headers;
  }
  async function readRequest(action){
    state.textContent='미디어 후보 대기열을 읽는 중입니다.';
    var response=await fetch(ENDPOINT+'?action='+encodeURIComponent(action),{headers:authHeaders(false),credentials:'same-origin',cache:'no-store'});
    var data=null;try{data=await response.json();}catch(_e){}
    if(!response.ok||!data||data.ok!==true){var error=new Error((data&&(data.message||data.error))||('요청 실패: HTTP '+response.status));error.code=data&&data.code;error.status=response.status;throw error;}
    var mode=(data.source&&data.source.candidateSourceMode)||data.mode||'read_only';
    state.textContent='관리 연결 확인: '+mode;
    return data;
  }
  async function postJson(url,body){
    var response=await fetch(url,{method:'POST',headers:authHeaders(true),credentials:'same-origin',cache:'no-store',body:JSON.stringify(body||{})});
    var data=null;try{data=await response.json();}catch(_e){}
    if(!response.ok||!data||data.ok!==true){var error=new Error((data&&(data.message||data.error))||('요청 실패: HTTP '+response.status));error.code=data&&data.error;error.status=response.status;throw error;}
    return data;
  }

  function card(title,value,sub,kind){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num status-'+esc(kind||'info')+'">'+esc(value)+'</div><div class="small">'+esc(sub||'')+'</div></article>';}
  function renderSummary(summary){
    var s=summary||{};
    $('summaryGrid').innerHTML=[
      card('후보 영상',s.candidateCount||0,'2~10번 섹션 후보','info'),
      card('프론트 승격 가능',s.promotableCount||0,'검증 완료 후보만 계산','ok'),
      card('검증 대기',s.verificationRequired||0,'원본·권리·소스 확인 필요','warn'),
      card('최신 섹션 수동후보',s.trendingManualCandidates||0,'0이어야 정상','info'),
      card('공개 스냅샷 영향',s.publicSnapshotMutation||'없음','승인 전 자동 공개 없음','ok')
    ].join('');
    $('summaryGrid').classList.remove('hidden');
  }
  function sortedKeys(map){return Object.keys(map||{}).sort();}
  function fillSelect(id,values,label){var el=$(id);if(!el)return;var current=el.value;el.innerHTML='<option value="">'+esc(label)+'</option>'+values.map(function(v){return '<option value="'+esc(v)+'">'+esc(v)+'</option>';}).join('');if(values.indexOf(current)>=0)el.value=current;}
  function setupFilters(summary){fillSelect('sectionFilter',sortedKeys(summary&&summary.bySection),'전체 섹션');fillSelect('riskFilter',sortedKeys(summary&&summary.byRisk),'전체 위험도');fillSelect('statusFilter',sortedKeys(summary&&summary.byVerificationStatus),'전체 검증상태');$('filterPanel').classList.remove('hidden');}
  function pill(value,kind){return '<span class="pill '+esc(kind||'')+'">'+esc(value||'-')+'</span>';}
  function safeMediaUrl(row){
    var raw=text(row&&(row.video||row.url||(row.rights&&row.rights.sourceUrl)));
    if(!raw||!/^https?:\/\//i.test(raw))return '';
    return raw;
  }
  function hasSource(row){return !!(text(row.url)||text(row.video)||text(row.thumb)||text(row.rights&&row.rights.sourceUrl)||text(row.rights&&row.rights.licenseUrl));}
  function sourceState(row){var parts=[];if(text(row.url)||text(row.video))parts.push('영상URL 후보 있음');if(text(row.thumb))parts.push('썸네일 있음');if(text(row.rights&&row.rights.sourceUrl))parts.push('원출처 있음');if(text(row.rights&&row.rights.licenseUrl))parts.push('라이선스URL 있음');if(!parts.length)parts.push('URL 미검증');return parts.join(' · ');}
  function visibleRows(){
    var q=lower($('searchInput').value),section=text($('sectionFilter').value),risk=text($('riskFilter').value),status=text($('statusFilter').value);
    return rowsCache.filter(function(row){
      if(section&&text(row.sectionKey)!==section)return false;if(risk&&text(row.riskLevel)!==risk)return false;if(status&&text(row.verificationStatus)!==status)return false;if(!q)return true;
      var hay=[row.title,row.provider,row.sectionKey,row.region,row.year,row.qualityTarget,row.riskLevel,row.verificationStatus,row.sanmaruSearchSeed,row.rights&&row.rights.sourceHint,row.rights&&row.rights.candidate].map(text).join(' ').toLowerCase();
      return hay.indexOf(q)>=0;
    });
  }
  function renderRows(){
    var rows=visibleRows();$('filterState').textContent='표시 '+rows.length+'개 / 전체 '+rowsCache.length+'개';
    $('candidateRows').innerHTML=rows.length?rows.map(function(row,index){
      var stateClass=(row.promotable===true)?'safe':(hasSource(row)?'risk':'hold');var id=text(row.contentId||row.id);var previewUrl=safeMediaUrl(row);
      var title=esc(row.title||'(제목 없음)');
      var titleHtml=previewUrl?'<a href="'+esc(previewUrl)+'" target="_blank" rel="noopener noreferrer" title="새 창에서 원본 영상 확인">'+title+'</a>':title;
      var previewHtml=previewUrl?'<a class="candidate-preview" href="'+esc(previewUrl)+'" target="_blank" rel="noopener noreferrer">영상 미리보기</a>':'';
      return '<tr><td class="seq">'+(index+1)+'</td><td><input class="rowcheck" type="checkbox" data-candidate-id="'+esc(id)+'" aria-label="'+esc(row.title||id)+' 선택" /></td>'+ 
        '<td>'+pill(row.sectionKey,'section')+'<div class="small">slot '+esc(row.slotId||'')+'</div></td>'+ 
        '<td><strong class="candidate-title">'+titleHtml+'</strong>'+previewHtml+'<div class="mono small">'+esc(id)+'</div></td>'+ 
        '<td class="nowrap">'+esc(row.year||'-')+'<div class="small">'+esc(row.region||'-')+'</div></td>'+ 
        '<td>'+esc(row.provider||'-')+'<div class="small">'+esc(row.rights&&row.rights.sourceHint||'')+'</div></td>'+ 
        '<td>'+esc(row.qualityTarget||'-')+'<div class="small">'+esc(row.qualityPriority||'')+'</div></td>'+ 
        '<td>'+pill(row.verificationStatus||'verification_required',stateClass)+'<div class="small">'+esc(row.rights&&row.rights.status||'')+' · '+esc(row.riskLevel||'')+'</div></td>'+ 
        '<td class="reason">'+esc(sourceState(row))+'</td>'+ 
        '<td class="seed">'+esc(row.sanmaruSearchSeed||'')+'</td></tr>';
    }).join(''):'<tr><td colspan="10" class="empty">조건에 맞는 미디어 후보가 없습니다.</td></tr>';
    $('tablePanel').classList.remove('hidden');$('selectAllRows').checked=false;
  }
  function selectedIds(){return Array.prototype.slice.call(document.querySelectorAll('.rowcheck:checked')).map(function(el){return text(el.getAttribute('data-candidate-id'));}).filter(Boolean);}
  function renderDiagnostic(data){diagnosticCache=data;$('diagnosticJson').textContent=JSON.stringify(data,null,2);$('diagnosticPanel').classList.remove('hidden');$('downloadJsonBtn').disabled=false;}
  function downloadJson(){if(!diagnosticCache){show('먼저 미디어 점검 JSON을 읽어 주세요.','warn');return;}downloadBlob(JSON.stringify(diagnosticCache,null,2)+'\n','igdc-media-candidate-queue-diagnostic-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json');show('미디어 후보 점검 JSON 파일을 다운로드했습니다.','ok');}
  function downloadCandidateList(){
    var rows=visibleRows();
    var payload={
      ok:true,
      reportType:'igdc-media-candidate-visible-list',
      generatedAt:new Date().toISOString(),
      displayedCount:rows.length,
      totalCandidateCount:rowsCache.length,
      filters:{search:text($('searchInput').value),section:text($('sectionFilter').value),risk:text($('riskFilter').value),verificationStatus:text($('statusFilter').value)},
      rows:rows.map(function(row,index){return Object.assign({sequence:index+1,previewUrl:safeMediaUrl(row)},row);})
    };
    downloadBlob(JSON.stringify(payload,null,2)+'\n','igdc-media-candidate-visible-list-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json');
    show('현재 화면의 영상 후보 목록 JSON을 다운로드했습니다.','ok');
  }
  function downloadBlob(content,name){var blob=new Blob([content],{type:'application/json;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},300);}
  function errorMessage(error){var message=text(error&&error.message);if(Number(error&&error.status)===404)return '필요한 미디어 관리 함수가 아직 배포되지 않았습니다.';if(Number(error&&error.status)===401||Number(error&&error.status)===403)return message||'관리자 인증 또는 변경 권한을 확인해야 합니다.';return message||'요청을 처리하지 못했습니다.';}

  async function refresh(){hideNotice();var button=$('refreshBtn');button.disabled=true;try{var data=await readRequest('candidates');rowsCache=data.candidates||[];renderSummary(data.summary||{});setupFilters(data.summary||{});renderRows();show('미디어 후보 대기열을 읽었습니다. 수집 후보는 승인 전 공개되지 않습니다.','ok');}catch(error){show(errorMessage(error),'warn');}finally{button.disabled=false;}}
  async function diagnostic(){hideNotice();var button=$('diagnosticBtn');button.disabled=true;try{var data=await readRequest('diagnostic');renderDiagnostic(data);if(data.queue&&Array.isArray(data.queue.rows)){rowsCache=data.queue.rows;renderSummary(data.summary||{});setupFilters(data.summary||{});renderRows();}show('미디어 후보 점검 JSON을 읽었습니다.','ok');}catch(error){show(errorMessage(error),'warn');}finally{button.disabled=false;}}
  async function collect(){
    hideNotice();var button=$('collectBtn');button.disabled=true;$('collectorState').textContent='2000년 이후 1080p 원본 후보를 수집 중입니다.';
    try{var data=await postJson(COLLECTOR,{source:'internet_archive',section:$('collectorSection').value,limit:Number($('collectorLimit').value)||12});$('collectorState').textContent='검색 '+data.searched+' · 저장 '+data.saved+' · 제외 '+data.rejectedCount;show('2000년 이후 1080p 이상 원본 전체 영상 후보 '+data.saved+'개를 예비 대기열에 등록했습니다. 자동 공개되지는 않습니다.','ok');await refresh();}
    catch(error){$('collectorState').textContent='수집 실패';show(errorMessage(error),'warn');}finally{button.disabled=false;}
  }
  async function collectAdminException(){
    hideNotice();
    var identifier=text($('adminArchiveIdentifier').value), reason=text($('adminOverrideReason').value);
    if(!identifier){show('관리자가 지정할 Internet Archive 식별자 또는 원본 주소를 입력해 주세요.','warn');return;}
    if(!reason){show('오래된 작품을 예외 지정하는 사유를 입력해 주세요.','warn');return;}
    var button=$('collectAdminExceptionBtn');button.disabled=true;$('collectorState').textContent='관리자 지정 영상을 확인 중입니다.';
    try{
      var data=await postJson(COLLECTOR,{source:'internet_archive',section:$('collectorSection').value,identifier:identifier,adminException:true,overrideReason:reason,limit:1});
      $('collectorState').textContent='관리자 지정 저장 '+data.saved+' · 제외 '+data.rejectedCount;
      if(data.saved>0){$('adminArchiveIdentifier').value='';$('adminOverrideReason').value='';show('관리자 지정 영상을 우선 예비 후보로 등록했습니다. 연도만 예외이며 1080p·전체 영상·권리 검토 기준은 유지됩니다.','ok');await refresh();}
      else{show('지정 영상이 1080p·전체 영상·예고편 제외 기준을 통과하지 못했습니다.','warn');}
    }catch(error){$('collectorState').textContent='관리자 지정 수집 실패';show(errorMessage(error),'warn');}finally{button.disabled=false;}
  }
  async function reviewAction(action){
    var ids=selectedIds();if(!ids.length){show('처리할 후보를 먼저 선택해 주세요.','warn');return;}
    if(action==='approve'&&!$('rightsConfirm').checked){show('승인 전에 원본·권리·재생·자막 확인 체크가 필요합니다.','warn');return;}
    var labels={approve:'승인',hold:'보류',reset:'재검토',reject:'반려',block:'차단'};
    var note=window.prompt(labels[action]+' 사유 또는 확인 메모를 입력해 주세요.','')||'';
    try{var data=await postJson(ACTION,{action:action,ids:ids,note:note,confirmRightsSafe:action==='approve'});show(labels[action]+' 처리 '+data.updated+'건을 완료했습니다.','ok');$('rightsConfirm').checked=false;await refresh();}catch(error){show(errorMessage(error),'warn');}
  }
  async function publishPreview(store){
    var button=store?$('storeReleaseBtn'):$('publishPreviewBtn');button.disabled=true;
    try{var data=await postJson(PUBLISH,{storeRelease:!!store,includeSnapshot:store?'0':'1'});var message='승격 가능 '+data.eligibleRows+'건 · 해시 '+text(data.hash).slice(0,16);if(store)message+=' · 릴리스 저장 완료';show(message,'ok');if(!store&&data.snapshot){diagnosticCache=data;$('diagnosticJson').textContent=JSON.stringify(data,null,2);$('diagnosticPanel').classList.remove('hidden');$('downloadJsonBtn').disabled=false;}}
    catch(error){show(errorMessage(error),'warn');}finally{button.disabled=false;}
  }
  async function downloadSnapshot(){
    var button=$('downloadSnapshotBtn');button.disabled=true;
    try{var response=await fetch(PUBLISH+'?download=1',{headers:authHeaders(false),credentials:'same-origin',cache:'no-store'});var content=await response.text();if(!response.ok)throw Object.assign(new Error(content||('HTTP '+response.status)),{status:response.status});downloadBlob(content,'media.snapshot.generated.json');show('승인된 후보로 생성한 미디어 스냅샷을 다운로드했습니다.','ok');}
    catch(error){show(errorMessage(error),'warn');}finally{button.disabled=false;}
  }
  function returnToAdmin(){var params=new URLSearchParams(window.location.search);var raw=params.get('returnPath')||'/admin.html';if(!/^\//.test(raw))raw='/admin.html';window.location.href=raw;}
  function bind(){
    $('refreshBtn').addEventListener('click',refresh);$('diagnosticBtn').addEventListener('click',diagnostic);$('downloadJsonBtn').addEventListener('click',downloadJson);$('downloadCandidateListBtn').addEventListener('click',downloadCandidateList);$('returnBtn').addEventListener('click',returnToAdmin);
    $('collectBtn').addEventListener('click',collect);$('collectAdminExceptionBtn').addEventListener('click',collectAdminException);$('approveBtn').addEventListener('click',function(){reviewAction('approve');});$('holdBtn').addEventListener('click',function(){reviewAction('hold');});$('resetBtn').addEventListener('click',function(){reviewAction('reset');});$('rejectBtn').addEventListener('click',function(){reviewAction('reject');});$('blockBtn').addEventListener('click',function(){reviewAction('block');});
    $('publishPreviewBtn').addEventListener('click',function(){publishPreview(false);});$('storeReleaseBtn').addEventListener('click',function(){publishPreview(true);});$('downloadSnapshotBtn').addEventListener('click',downloadSnapshot);
    $('selectAllRows').addEventListener('change',function(){var checked=this.checked;Array.prototype.forEach.call(document.querySelectorAll('.rowcheck'),function(el){el.checked=checked;});});
    ['searchInput','sectionFilter','riskFilter','statusFilter'].forEach(function(id){$(id).addEventListener('input',renderRows);$(id).addEventListener('change',renderRows);});
    window.addEventListener('pageshow',refresh);refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
