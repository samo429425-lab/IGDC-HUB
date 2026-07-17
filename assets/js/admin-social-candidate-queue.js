/* IGDC Social Candidate Queue Admin View v1.2.0
 * Reads social candidates, applies review actions, previews approved rotation,
 * and downloads generated social.snapshot.json. It never mutates public static
 * social.snapshot.json at runtime and never removes sample slots without approved candidates.
 */
(function(){
  'use strict';
  var REVIEW_ENDPOINT='/.netlify/functions/social-candidate-review';
  var TRIGGER_ENDPOINT='/.netlify/functions/sanmaru-social-pipeline-trigger';
  var ACTION_ENDPOINT='/.netlify/functions/social-candidate-action';
  var ROTATION_ENDPOINT='/.netlify/functions/social-rotation-selector';
  var PUBLISH_ENDPOINT='/.netlify/functions/social-snapshot-publish';
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var text=function(v){return String(v==null?'':v).trim();};
  var lower=function(v){return text(v).toLowerCase();};
  var state=$('state'), notice=$('notice'), diagnosticCache=null, rowsCache=[], rotationCache=null, publishCache=null;

  function cls(kind){return kind==='ok'?'ok':kind==='warn'?'warn':'';}
  function show(message,kind){notice.className='notice '+cls(kind);notice.textContent=message;notice.classList.remove('hidden');}
  function hideNotice(){notice.classList.add('hidden');notice.textContent='';}
  function authHeaders(json){
    var headers={Accept:'application/json'};
    if(json)headers['Content-Type']='application/json';
    try{
      var token=sessionStorage.getItem('igdc.socialCandidateQueue.adminBearer')||localStorage.getItem('igdc.socialCandidateQueue.adminBearer')||'';
      if(token&&String(token).split('.').length===3)headers.Authorization='Bearer '+token;
    }catch(_e){}
    return headers;
  }
  async function getJson(url){
    var response=await fetch(url,{headers:authHeaders(false),credentials:'same-origin',cache:'no-store'});
    var data=null;try{data=await response.json();}catch(_e){}
    if(!response.ok||!data||data.ok!==true){var error=new Error((data&&data.message)||(data&&data.error)||('요청 실패: HTTP '+response.status));error.code=data&&data.code;error.status=response.status;throw error;}
    return data;
  }
  async function postJson(url,body){
    var response=await fetch(url,{method:'POST',headers:authHeaders(true),credentials:'same-origin',cache:'no-store',body:JSON.stringify(body||{})});
    var data=null;try{data=await response.json();}catch(_e){}
    if(!response.ok||!data||data.ok!==true){var error=new Error((data&&data.message)||(data&&data.error)||('요청 실패: HTTP '+response.status));error.code=data&&data.code;error.status=response.status;throw error;}
    return data;
  }
  async function request(action){
    state.textContent='소셜 후보 대기열을 읽는 중입니다.';
    var data=await getJson(REVIEW_ENDPOINT+'?action='+encodeURIComponent(action));
    var mode=(data.source&&data.source.candidateSourceMode)||data.mode||'read_only';
    state.textContent='연결 확인: '+mode;
    return data;
  }
  function card(title,value,sub,kind){return '<article class="card"><h2>'+esc(title)+'</h2><div class="num status-'+esc(kind||'info')+'">'+esc(value)+'</div><div class="small">'+esc(sub||'')+'</div></article>';}
  function renderSummary(summary){
    var s=summary||{}, r=s.rotationPolicy||{};
    $('summaryGrid').innerHTML=[
      card('후보 콘텐츠',s.candidateCount||0,'social_candidates 저장 후보','info'),
      card('프론트 승격 가능',s.promotableCount||0,'승인+검증+공개 접근 후보','ok'),
      card('검증 대기',s.verificationRequired||0,'웹/공개성/위험도 확인 필요','warn'),
      card('섹션별 목표 풀',r.targetPerSection||300,'허용 '+(r.minPerSection||250)+'~'+(r.maxPerSection||350)+'개','info'),
      card('공개 슬롯',r.publicSlotsPerSection||100,'승인 후보 중 로테이션 선정','info')
    ].join('');
    $('summaryGrid').classList.remove('hidden');
  }
  function sortedKeys(map){return Object.keys(map||{}).sort();}
  function fillSelect(id, values, label){
    var el=$(id);if(!el)return;var current=el.value;
    el.innerHTML='<option value="">'+esc(label)+'</option>'+values.map(function(v){return '<option value="'+esc(v)+'">'+esc(v)+'</option>';}).join('');
    if(values.indexOf(current)>=0)el.value=current;
  }
  function setupFilters(summary){
    fillSelect('sectionFilter', sortedKeys(summary&&summary.bySection), '전체 섹션');
    fillSelect('platformFilter', sortedKeys(summary&&summary.byPlatform), '전체 플랫폼');
    fillSelect('riskFilter', sortedKeys(summary&&summary.byRisk), '전체 위험도');
    fillSelect('reviewFilter', sortedKeys(summary&&summary.byReview), '전체 검토상태');
    $('filterPanel').classList.remove('hidden');
  }
  function pill(value,kind){return '<span class="pill '+esc(kind||'')+'">'+esc(value||'-')+'</span>';}
  function statusClass(row){
    if(row.promotable===true)return 'safe';
    if(row.riskLevel==='blocked'||row.reviewStatus==='blocked')return 'block';
    if(row.reviewStatus==='approved')return 'safe';
    if(row.reviewStatus==='hold'||row.reviewStatus==='replacement_requested')return 'hold';
    return 'risk';
  }
  function accessText(row){
    var parts=[];parts.push(row.publicAccess?'공개 접근':'공개성 확인 필요');
    if(row.loginRequired)parts.push('로그인 장벽');
    if(row.displayMode)parts.push(row.displayMode);
    if(row.accessStatus)parts.push(row.accessStatus);
    return parts.join(' · ');
  }
  function policyText(row){
    var parts=['외부권한: 플랫폼 제어'];
    if(row.premiumBenefitPlatformControlled)parts.push('프리미엄 혜택 플랫폼 의존');
    if(row.maruMembershipOverridesExternalAds)parts.push('MARU 외부광고 제어'); else parts.push('MARU 외부광고 제어 없음');
    return parts.join(' · ');
  }
  function visibleRows(){
    var q=lower($('searchInput').value), section=text($('sectionFilter').value), platform=text($('platformFilter').value), risk=text($('riskFilter').value), review=text($('reviewFilter').value);
    return rowsCache.filter(function(row){
      if(section&&text(row.sectionKey)!==section)return false;
      if(platform&&text(row.platform)!==platform)return false;
      if(risk&&text(row.riskLevel)!==risk)return false;
      if(review&&text(row.reviewStatus)!==review)return false;
      if(!q)return true;
      var hay=[row.title,row.creatorName,row.creatorHandle,row.platform,row.sectionKey,row.sourceUrl,row.language,row.region,row.displayMode,row.accessStatus,row.riskLevel,row.reviewStatus,row.verificationStatus].map(text).join(' ').toLowerCase();
      return hay.indexOf(q)>=0;
    });
  }
  function actionButtons(row){
    var id=esc(row.id||'');
    return '<div class="actions">'+
      '<button data-action="approve" data-id="'+id+'">승인</button>'+
      '<button data-action="hold" data-id="'+id+'">보류</button>'+
      '<button data-action="reject" data-id="'+id+'">부적합</button>'+
      '<button data-action="block" data-id="'+id+'">차단</button>'+
      '<button data-action="restore" data-id="'+id+'">복원</button>'+
      '<button data-action="request_replacement" data-id="'+id+'">대체요청</button>'+
    '</div>';
  }
  function renderRows(){
    var rows=visibleRows();
    $('filterState').textContent='표시 '+rows.length+'개 / 전체 '+rowsCache.length+'개';
    $('candidateRows').innerHTML=rows.length?rows.map(function(row){
      return '<tr>'+
        '<td>'+pill(row.sectionKey,'section')+'<div style="margin-top:4px">'+pill(row.platform,'platform')+'</div><div class="small">'+esc(row.language||'und')+' · '+esc(row.region||'-')+'</div></td>'+ 
        '<td><strong>'+esc(row.title||'(제목 없음)')+'</strong><div class="mono small">'+esc(row.id||'')+'</div><div class="small">'+esc(row.description||'')+'</div></td>'+ 
        '<td>'+esc(row.creatorName||'-')+'<div class="mono small">'+esc(row.creatorHandle||'')+'</div></td>'+ 
        '<td>'+esc(accessText(row))+'</td>'+ 
        '<td><div class="score"><span>안전 '+esc(row.safetyScore||0)+'</span><span>품질 '+esc(row.qualityScore||0)+'</span><span>참여 '+esc(row.engagementScore||0)+'</span><span>수익 '+esc(row.revenueScore||0)+'</span><span>지역 '+esc(row.localeScore||0)+'</span><span>회전 '+esc(row.rotationScore||0)+'</span></div></td>'+ 
        '<td>'+pill(row.reviewStatus||'pending',statusClass(row))+'<div class="small">'+esc(row.verificationStatus||'')+' · '+esc(row.riskLevel||'')+'</div><div class="small">승격 '+(row.promotable?'가능':'불가')+'</div></td>'+ 
        '<td class="reason">'+esc(policyText(row))+'</td>'+ 
        '<td class="url mono">'+(row.sourceUrl?'<a href="'+esc(row.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(row.sourceUrl)+'</a>':'-')+'<div class="small">embed: '+esc(row.embedUrl||'-')+'</div></td>'+ 
        '<td>'+actionButtons(row)+'</td>'+ 
      '</tr>';
    }).join(''):'<tr><td colspan="9" class="empty">조건에 맞는 소셜 후보가 없습니다. 실제 후보가 들어오기 전에는 기존 샘플 슬롯이 그대로 유지되는 것이 정상입니다.</td></tr>';
    $('tablePanel').classList.remove('hidden');
  }
  function renderDiagnostic(data){
    diagnosticCache=data;$('diagnosticJson').textContent=JSON.stringify(data,null,2);$('diagnosticPanel').classList.remove('hidden');$('downloadJsonBtn').disabled=false;
  }
  function downloadBlob(name,obj){
    var blob=new Blob([typeof obj==='string'?obj:JSON.stringify(obj,null,2)+'\n'],{type:'application/json;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},300);
  }
  function downloadJson(){
    if(!diagnosticCache){show('먼저 소셜 점검 JSON을 읽어 주세요.','warn');return;}
    downloadBlob('igdc-social-candidate-queue-diagnostic-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json',diagnosticCache);
    show('소셜 후보 점검 JSON 파일을 다운로드했습니다.','ok');
  }
  function errorMessage(error){
    var message=text(error&&error.message);
    if(Number(error&&error.status)===404)return '필요한 Netlify 함수가 아직 배포되지 않았습니다.';
    if(Number(error&&error.status)===500)return message||'함수 내부 오류입니다. 후보 JSON 위치 또는 Supabase 설정을 확인해야 합니다.';
    return message||'요청을 처리하지 못했습니다.';
  }
  async function refresh(){hideNotice();var button=$('refreshBtn');button.disabled=true;try{var data=await request('candidates');rowsCache=(data.queue&&data.queue.rows)||data.candidates||[];renderSummary(data.summary||{});setupFilters(data.summary||{});renderRows();show('소셜 후보 대기열을 읽었습니다. 샘플 슬롯은 승인 후보가 발행될 때만 치환됩니다.','ok');}catch(error){show(errorMessage(error),'warn');}finally{button.disabled=false;}}
  async function diagnostic(){hideNotice();var button=$('diagnosticBtn');button.disabled=true;try{var data=await request('diagnostic');renderDiagnostic(data);if(data.queue&&Array.isArray(data.queue.rows)){rowsCache=data.queue.rows;renderSummary(data.summary||{});setupFilters(data.summary||{});renderRows();}show('소셜 후보 점검 JSON을 읽었습니다.','ok');}catch(error){show(errorMessage(error),'warn');}finally{button.disabled=false;}}
  async function triggerSearchBankImport(dryRun){
    hideNotice();
    var button=dryRun?$('triggerDryRunBtn'):$('triggerImportBtn');
    if(button)button.disabled=true;
    state.textContent=dryRun?'SearchBank 후보 연결을 점검하는 중입니다.':'SearchBank 후보를 social_candidates로 가져오는 중입니다.';
    try{
      var data=await postJson(TRIGGER_ENDPOINT,{action:dryRun?'dry_run':'import_searchbank',dryRun:!!dryRun,limit:5000});
      renderDiagnostic(data);
      var accepted=Number(data.accepted||0), saved=Number(data.saved||0), rejected=Number(data.rejectedCount||0), ignored=Number(data.ignoredCount||0);
      if(dryRun){
        show('SearchBank 연결 점검 완료: 수입 가능 '+accepted+'개, 보존/미수입 '+ignored+'개, 제외 '+rejected+'개. 저장은 하지 않았습니다.','ok');
      }else{
        show('SearchBank 후보 가져오기 완료: 저장 '+saved+'개, 보존/미수입 '+ignored+'개, 제외 '+rejected+'개. public social.snapshot은 변경하지 않았습니다.','ok');
        await refresh();
      }
    }catch(error){show(errorMessage(error),'warn');}
    finally{if(button)button.disabled=false;}
  }
  async function runAction(action,id){
    if(!id)return;
    var note='';
    if(action==='approve'){
      if(!confirm('이 후보를 소셜 공개 스냅샷 승격 가능 상태로 승인할까요? 외부 플랫폼 광고/프리미엄 권한은 MARU가 제어하지 않습니다.'))return;
      note=prompt('승인 메모를 입력하세요. 비워도 됩니다.','')||'';
    }else if(action==='block'||action==='reject'||action==='hold'||action==='request_replacement'){
      note=prompt('처리 사유를 입력하세요.','')||'';
    }
    hideNotice();state.textContent='후보 상태를 변경하는 중입니다.';
    try{var data=await postJson(ACTION_ENDPOINT,{action:action,ids:[id],note:note,confirmSocialSafe:action==='approve'});show('처리 완료: '+action+' / '+(data.updated||0)+'개','ok');await refresh();}
    catch(error){show(errorMessage(error),'warn');}
  }
  async function previewRotation(){
    hideNotice();var button=$('rotationBtn');button.disabled=true;state.textContent='승인 후보 로테이션을 계산하는 중입니다.';
    try{var data=await getJson(ROTATION_ENDPOINT);rotationCache=data;renderDiagnostic(data);show('로테이션 미리보기를 계산했습니다. 이 동작은 social.snapshot.json을 수정하지 않습니다.','ok');}
    catch(error){show(errorMessage(error),'warn');}
    finally{button.disabled=false;}
  }
  async function previewSnapshot(){
    hideNotice();var button=$('publishPreviewBtn');button.disabled=true;state.textContent='공개 스냅샷 미리보기를 생성하는 중입니다.';
    try{var data=await getJson(PUBLISH_ENDPOINT+'?includeSnapshot=0');publishCache=data;renderDiagnostic(data);show('social.snapshot.json 미리보기를 생성했습니다. 런타임 파일 쓰기는 하지 않았습니다.','ok');}
    catch(error){show(errorMessage(error),'warn');}
    finally{button.disabled=false;}
  }
  async function downloadSnapshot(){
    hideNotice();state.textContent='생성된 social.snapshot.json을 다운로드하는 중입니다.';
    try{
      var response=await fetch(PUBLISH_ENDPOINT+'?download=1',{headers:authHeaders(false),credentials:'same-origin',cache:'no-store'});
      var textBody=await response.text();
      if(!response.ok)throw new Error(textBody||('HTTP '+response.status));
      downloadBlob('social.snapshot.generated.json',textBody);
      show('생성된 social.snapshot.json을 다운로드했습니다. 실제 배포 파일 교체는 별도 확인 후 진행하세요.','ok');
    }catch(error){show(errorMessage(error),'warn');}
  }
  function returnToAdmin(){var params=new URLSearchParams(window.location.search);var raw=params.get('returnPath')||'/admin.html';if(!/^\//.test(raw))raw='/admin.html';window.location.href=raw;}
  function bind(){
    $('refreshBtn').addEventListener('click',refresh);
    $('triggerDryRunBtn').addEventListener('click',function(){triggerSearchBankImport(true);});
    $('triggerImportBtn').addEventListener('click',function(){
      if(!confirm('SearchBank snapshot에서 실소셜 후보만 social_candidates로 가져올까요? 기존 샘플 슬롯과 public social.snapshot.json은 변경하지 않습니다.'))return;
      triggerSearchBankImport(false);
    });
    $('diagnosticBtn').addEventListener('click',diagnostic);
    $('downloadJsonBtn').addEventListener('click',downloadJson);
    $('rotationBtn').addEventListener('click',previewRotation);
    $('publishPreviewBtn').addEventListener('click',previewSnapshot);
    $('snapshotDownloadBtn').addEventListener('click',downloadSnapshot);
    $('returnBtn').addEventListener('click',returnToAdmin);
    $('candidateRows').addEventListener('click',function(event){var btn=event.target&&event.target.closest&&event.target.closest('button[data-action]');if(!btn)return;runAction(btn.getAttribute('data-action'),btn.getAttribute('data-id'));});
    ['searchInput','sectionFilter','platformFilter','riskFilter','reviewFilter'].forEach(function(id){$(id).addEventListener('input',renderRows);$(id).addEventListener('change',renderRows);});
    window.addEventListener('pageshow',refresh);refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
