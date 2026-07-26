/* IGDC Social Candidate Queue Admin View v1.3.0
 * Section-scoped SearchBank intake, numbered bulk review, reversible search
 * exclusion, permanent blocking, and sample-preserving snapshot previews.
 */
(function(){
  'use strict';

  var REVIEW_ENDPOINT='/.netlify/functions/social-candidate-review';
  var LIVE_COLLECT_ENDPOINT='/.netlify/functions/sanmaru-social-live-collector';
  var ACTION_ENDPOINT='/.netlify/functions/social-candidate-action';
  var ROTATION_ENDPOINT='/.netlify/functions/social-rotation-selector';
  var PUBLISH_ENDPOINT='/.netlify/functions/social-snapshot-publish';
  var SECTION_DEFS=[
    {key:'social-youtube',label:'YouTube',platform:'youtube'},
    {key:'social-instagram',label:'Instagram',platform:'instagram'},
    {key:'social-tiktok',label:'TikTok',platform:'tiktok'},
    {key:'social-facebook',label:'Facebook',platform:'facebook'},
    {key:'social-wechat',label:'WeChat',platform:'wechat'},
    {key:'social-weibo',label:'Weibo',platform:'weibo'},
    {key:'social-pinterest',label:'Pinterest',platform:'pinterest'},
    {key:'social-reddit',label:'Reddit',platform:'reddit'},
    {key:'social-twitter',label:'X · Twitter',platform:'twitter'}
  ];
  var SECTION_ORDER=SECTION_DEFS.map(function(row){return row.key;});
  var $=function(id){return document.getElementById(id);};
  var text=function(value){return String(value==null?'':value).trim();};
  var lower=function(value){return text(value).toLowerCase();};
  var esc=function(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];});};
  var state=$('state');
  var notice=$('notice');
  var diagnosticCache=null;
  var rowsCache=[];
  var rotationCache=null;
  var publishCache=null;

  function cls(kind){return kind==='ok'?'ok':kind==='warn'?'warn':'';}
  function show(message,kind){notice.className='notice '+cls(kind);notice.textContent=message;notice.classList.remove('hidden');}
  function hideNotice(){notice.classList.add('hidden');notice.textContent='';}
  function authHeaders(json){
    var headers={Accept:'application/json'};
    if(json)headers['Content-Type']='application/json';
    try{
      var token=sessionStorage.getItem('igdc.socialCandidateQueue.adminBearer')||localStorage.getItem('igdc.socialCandidateQueue.adminBearer')||'';
      if(token&&String(token).split('.').length===3)headers.Authorization='Bearer '+token;
    }catch(_error){}
    return headers;
  }
  async function getJson(url){
    var response=await fetch(url,{headers:authHeaders(false),credentials:'same-origin',cache:'no-store'});
    var data=null;
    try{data=await response.json();}catch(_error){}
    if(!response.ok||!data||data.ok!==true){
      var error=new Error((data&&data.message)||(data&&data.error)||('요청 실패: HTTP '+response.status));
      error.code=data&&data.code;
      error.status=response.status;
      throw error;
    }
    return data;
  }
  async function postJson(url,body){
    var response=await fetch(url,{method:'POST',headers:authHeaders(true),credentials:'same-origin',cache:'no-store',body:JSON.stringify(body||{})});
    var data=null;
    try{data=await response.json();}catch(_error){}
    if(!response.ok||!data||data.ok!==true){
      var error=new Error((data&&data.message)||(data&&data.error)||('요청 실패: HTTP '+response.status));
      error.code=data&&data.code;
      error.status=response.status;
      throw error;
    }
    return data;
  }
  async function request(action){
    state.textContent='소셜 후보 대기열을 읽는 중입니다.';
    var data=await getJson(REVIEW_ENDPOINT+'?action='+encodeURIComponent(action));
    var mode=(data.source&&data.source.candidateSourceMode)||data.mode||'read_only';
    state.textContent='연결 확인: '+mode;
    return data;
  }
  function errorMessage(error){
    var message=text(error&&error.message);
    if(Number(error&&error.status)===404)return '필요한 Netlify 함수 또는 후보 데이터가 아직 배포되지 않았습니다.';
    if(Number(error&&error.status)===500)return message||'함수 내부 오류입니다. 후보 저장소와 배포 파일을 확인해야 합니다.';
    return message||'요청을 처리하지 못했습니다.';
  }
  function sectionLabel(key){
    var found=SECTION_DEFS.find(function(row){return row.key===key;});
    return found?found.label:key;
  }
  function sectionIndex(key){
    var index=SECTION_ORDER.indexOf(text(key));
    return index<0?999:index;
  }
  function isExcluded(row){
    var status=lower(row&&row.reviewStatus);
    return status==='search_excluded'||status==='permanent_blocked'||status==='blocked';
  }
  function isPermanentBlocked(row){
    var status=lower(row&&row.reviewStatus);
    return status==='permanent_blocked'||status==='blocked';
  }
  function activeRows(){return rowsCache.filter(function(row){return !isExcluded(row);});}
  function exclusionRows(){return rowsCache.filter(isExcluded);}
  function card(title,value,sub,kind){
    return '<article class="card"><h2>'+esc(title)+'</h2><div class="num status-'+esc(kind||'info')+'">'+esc(value)+'</div><div class="small">'+esc(sub||'')+'</div></article>';
  }
  function renderSummary(summary){
    var s=summary||{};
    var r=s.rotationPolicy||{};
    var activeCount=s.activeCandidateCount;
    if(activeCount==null)activeCount=activeRows().length;
    var excluded=s.searchExcludedCount;
    if(excluded==null)excluded=exclusionRows().filter(function(row){return !isPermanentBlocked(row);}).length;
    var blocked=s.permanentBlockedCount;
    if(blocked==null)blocked=exclusionRows().filter(isPermanentBlocked).length;
    $('summaryGrid').innerHTML=[
      card('활성 후보',activeCount,'검토·배치 대상','info'),
      card('프론트 승격 가능',s.promotableCount||0,'승인+검증+공개 접근 후보','ok'),
      card('검증 대기',s.verificationRequired||0,'웹/공개성/위험도 확인 필요','warn'),
      card('검색 제외',excluded,'접힌 제외 목록에 보관','warn'),
      card('영구 차단',blocked,'재검색 반입 차단','fail'),
      card('섹션별 후보 풀',r.targetPerSection||300,'공개 슬롯 '+(r.publicSlotsPerSection||100)+'개','info')
    ].join('');
    $('summaryGrid').classList.remove('hidden');
  }
  function fillFixedSelectors(){
    var options=SECTION_DEFS.map(function(row){
      return '<option value="'+esc(row.key)+'">'+esc(row.label)+' · '+esc(row.key)+'</option>';
    }).join('');
    $('collectorSection').innerHTML=options;
    $('sectionFilter').innerHTML='<option value="">전체 섹션</option>'+options;
    $('platformFilter').innerHTML='<option value="">전체 플랫폼</option>'+SECTION_DEFS.map(function(row){
      return '<option value="'+esc(row.platform)+'">'+esc(row.label)+'</option>';
    }).join('');
  }
  function sortedKeys(map){return Object.keys(map||{}).filter(Boolean).sort();}
  function fillDynamicSelect(id,values,label){
    var element=$(id);
    if(!element)return;
    var current=element.value;
    element.innerHTML='<option value="">'+esc(label)+'</option>'+values.map(function(value){return '<option value="'+esc(value)+'">'+esc(value)+'</option>';}).join('');
    if(values.indexOf(current)>=0)element.value=current;
  }
  function setupFilters(summary){
    fillDynamicSelect('riskFilter',sortedKeys(summary&&summary.byRisk),'전체 위험도');
    fillDynamicSelect('reviewFilter',sortedKeys(summary&&summary.byReview).filter(function(status){
      return status!=='search_excluded'&&status!=='permanent_blocked'&&status!=='blocked';
    }),'전체 검토상태');
    $('filterPanel').classList.remove('hidden');
  }
  function pill(value,kind){return '<span class="pill '+esc(kind||'')+'">'+esc(value||'-')+'</span>';}
  function statusClass(row){
    if(row.promotable===true)return 'safe';
    if(isPermanentBlocked(row))return 'block';
    if(row.reviewStatus==='approved')return 'safe';
    if(row.reviewStatus==='hold'||row.reviewStatus==='replacement_requested'||row.reviewStatus==='search_excluded')return 'hold';
    return 'risk';
  }
  function accessText(row){
    var parts=[row.publicAccess?'공개 접근':'공개성 확인 필요'];
    if(row.loginRequired)parts.push('로그인 장벽');
    if(row.displayMode)parts.push(row.displayMode);
    if(row.accessStatus)parts.push(row.accessStatus);
    return parts.join(' · ');
  }
  function policyText(row){
    var parts=['외부권한: 플랫폼 제어'];
    if(row.premiumBenefitPlatformControlled)parts.push('프리미엄 혜택 플랫폼 의존');
    parts.push(row.maruMembershipOverridesExternalAds?'MARU 외부광고 제어':'MARU 외부광고 제어 없음');
    return parts.join(' · ');
  }
  function rowScore(row){
    return Number(row.rotationScore||0)*2+Number(row.revenueScore||0)*1.6+Number(row.qualityScore||0)*1.4+Number(row.engagementScore||0)*1.1+Number(row.trustScore||0)+Number(row.safetyScore||0)+Number(row.localeScore||0)*0.7;
  }
  function visibleRows(){
    var q=lower($('searchInput').value);
    var section=text($('sectionFilter').value);
    var platform=text($('platformFilter').value);
    var risk=text($('riskFilter').value);
    var review=text($('reviewFilter').value);
    return activeRows().filter(function(row){
      if(section&&text(row.sectionKey)!==section)return false;
      if(platform&&text(row.platform)!==platform)return false;
      if(risk&&text(row.riskLevel)!==risk)return false;
      if(review&&text(row.reviewStatus)!==review)return false;
      if(!q)return true;
      var hay=[row.title,row.creatorName,row.creatorHandle,row.platform,row.sectionKey,row.sourceUrl,row.language,row.region,row.displayMode,row.accessStatus,row.riskLevel,row.reviewStatus,row.verificationStatus].map(text).join(' ').toLowerCase();
      return hay.indexOf(q)>=0;
    }).sort(function(a,b){
      var sectionDifference=sectionIndex(a.sectionKey)-sectionIndex(b.sectionKey);
      if(sectionDifference)return sectionDifference;
      var scoreDifference=rowScore(b)-rowScore(a);
      if(scoreDifference)return scoreDifference;
      return text(a.title).localeCompare(text(b.title));
    });
  }
  function candidateRowHtml(row,sequence){
    var id=text(row.id);
    return '<tr>'+
      '<td class="seq">'+sequence+'</td>'+
      '<td><input class="rowcheck" type="checkbox" data-candidate-id="'+esc(id)+'" aria-label="'+esc(row.title||id)+' 선택" /></td>'+
      '<td>'+pill(sectionLabel(row.sectionKey),'section')+'<div style="margin-top:4px">'+pill(row.platform,'platform')+'</div><div class="small">'+esc(row.language||'und')+' · '+esc(row.region||'-')+'</div></td>'+
      '<td><strong class="candidate-title"><button type="button" class="sourceBtn" data-candidate-id="'+esc(id)+'">'+esc(row.title||'(제목 없음)')+'</button></strong><div class="mono small">'+esc(id)+'</div><div class="small">'+esc(row.description||'')+'</div></td>'+
      '<td>'+esc(row.creatorName||'-')+'<div class="mono small">'+esc(row.creatorHandle||'')+'</div></td>'+
      '<td>'+esc(accessText(row))+'</td>'+
      '<td><div class="score"><span>안전 '+esc(row.safetyScore||0)+'</span><span>품질 '+esc(row.qualityScore||0)+'</span><span>참여 '+esc(row.engagementScore||0)+'</span><span>수익 '+esc(row.revenueScore||0)+'</span><span>지역 '+esc(row.localeScore||0)+'</span><span>회전 '+esc(row.rotationScore||0)+'</span></div></td>'+
      '<td>'+pill(row.reviewStatus||'pending',statusClass(row))+'<div class="small">'+esc(row.verificationStatus||'')+' · '+esc(row.riskLevel||'')+'</div><div class="small">승격 '+(row.promotable?'가능':'불가')+'</div></td>'+
      '<td class="reason">'+esc(policyText(row))+'</td>'+
      '<td class="url mono">'+(row.sourceUrl?'<a href="'+esc(row.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(row.sourceUrl)+'</a>':'-')+'<div class="small">embed: '+esc(row.embedUrl||'-')+'</div></td>'+
    '</tr>';
  }
  function renderRows(){
    var rows=visibleRows();
    $('filterState').textContent='표시 '+rows.length+'개 / 활성 후보 '+activeRows().length+'개 / 제외·차단 '+exclusionRows().length+'개';
    var html='';
    var sequence=0;
    SECTION_ORDER.forEach(function(sectionKey){
      var sectionRows=rows.filter(function(row){return text(row.sectionKey)===sectionKey;});
      if(!sectionRows.length)return;
      html+='<tr class="group-row"><td colspan="10">'+esc(sectionLabel(sectionKey))+' · '+sectionRows.length+'개</td></tr>';
      sectionRows.forEach(function(row){sequence+=1;html+=candidateRowHtml(row,sequence);});
    });
    var unknown=rows.filter(function(row){return SECTION_ORDER.indexOf(text(row.sectionKey))<0;});
    if(unknown.length){
      html+='<tr class="group-row"><td colspan="10">기타 · '+unknown.length+'개</td></tr>';
      unknown.forEach(function(row){sequence+=1;html+=candidateRowHtml(row,sequence);});
    }
    $('candidateRows').innerHTML=html||'<tr><td colspan="10" class="empty">조건에 맞는 소셜 후보가 없습니다. 실제 후보가 들어오기 전에는 기존 샘플 슬롯이 그대로 유지됩니다.</td></tr>';
    $('selectAllRows').checked=false;
    $('tablePanel').classList.remove('hidden');
  }
  function exclusionRowHtml(row,sequence){
    var id=text(row.id);
    var permanent=isPermanentBlocked(row);
    return '<tr>'+
      '<td class="seq">'+sequence+'</td>'+
      '<td><input class="excludedCheck" type="checkbox" data-candidate-id="'+esc(id)+'" aria-label="'+esc(row.title||id)+' 선택" /></td>'+
      '<td>'+pill(sectionLabel(row.sectionKey),'section')+'</td>'+
      '<td>'+pill(permanent?'영구 차단':'검색 제외',permanent?'block':'hold')+'</td>'+
      '<td><strong class="candidate-title"><button type="button" class="sourceBtn" data-candidate-id="'+esc(id)+'">'+esc(row.title||'(제목 없음)')+'</button></strong><div class="mono small">'+esc(id)+'</div></td>'+
      '<td>'+esc(row.blockedReason||row.reviewNote||'-')+'</td>'+
      '<td>'+esc(row.platform||'-')+'</td>'+
      '<td class="nowrap">'+esc(row.reviewedAt||row.updatedAt||row.createdAt||'-')+'</td>'+
    '</tr>';
  }
  function renderExclusions(){
    var rows=exclusionRows().slice().sort(function(a,b){
      var sectionDifference=sectionIndex(a.sectionKey)-sectionIndex(b.sectionKey);
      if(sectionDifference)return sectionDifference;
      return text(a.title).localeCompare(text(b.title));
    });
    var html='';
    var sequence=0;
    SECTION_ORDER.forEach(function(sectionKey){
      var sectionRows=rows.filter(function(row){return text(row.sectionKey)===sectionKey;});
      if(!sectionRows.length)return;
      html+='<tr class="group-row"><td colspan="8">'+esc(sectionLabel(sectionKey))+' · '+sectionRows.length+'개</td></tr>';
      sectionRows.forEach(function(row){sequence+=1;html+=exclusionRowHtml(row,sequence);});
    });
    $('excludedRows').innerHTML=html||'<tr><td colspan="8" class="empty">검색 제외 또는 영구 차단 항목이 없습니다.</td></tr>';
    var permanent=rows.filter(isPermanentBlocked).length;
    $('exclusionSummary').textContent='검색 제외 '+(rows.length-permanent)+'건 · 영구 차단 '+permanent+'건 · 전체 '+rows.length+'건';
    $('selectAllExcluded').checked=false;
    $('exclusionPanel').classList.remove('hidden');
  }
  function renderDiagnostic(data){
    diagnosticCache=data;
    $('diagnosticJson').textContent=JSON.stringify(data,null,2);
    $('diagnosticPanel').classList.remove('hidden');
    $('downloadJsonBtn').disabled=false;
  }
  function downloadBlob(name,value){
    var body=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';
    var blob=new Blob([body],{type:'application/json;charset=utf-8'});
    var anchor=document.createElement('a');
    anchor.href=URL.createObjectURL(blob);
    anchor.download=name;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function(){URL.revokeObjectURL(anchor.href);anchor.remove();},300);
  }
  function selectedIds(selector){
    return Array.from(document.querySelectorAll(selector+':checked')).map(function(element){return text(element.dataset.candidateId);}).filter(Boolean);
  }
  function currentVisibleIds(){return visibleRows().map(function(row){return text(row.id);}).filter(Boolean);}
  function openSource(id){
    var row=rowsCache.find(function(item){return text(item.id)===id;});
    var url=text(row&&row.sourceUrl);
    if(!/^https:\/\//i.test(url)){show('이 후보에는 열 수 있는 HTTPS 원본 주소가 없습니다.','warn');return;}
    var opened=window.open(url,'_blank','noopener,noreferrer');
    if(opened)opened.opener=null;
  }
  async function refresh(){
    hideNotice();
    $('refreshBtn').disabled=true;
    try{
      var data=await request('candidates');
      rowsCache=(data.queue&&data.queue.rows)||data.candidates||[];
      renderSummary(data.summary||{});
      setupFilters(data.summary||{});
      renderRows();
      renderExclusions();
      show('소셜 후보 대기열을 읽었습니다. 제외 항목은 접힌 목록에 보관되고 샘플 슬롯은 승인 발행 전까지 유지됩니다.','ok');
    }catch(error){show(errorMessage(error),'warn');}
    finally{$('refreshBtn').disabled=false;}
  }
  async function diagnostic(){
    hideNotice();
    $('diagnosticBtn').disabled=true;
    try{
      var data=await request('diagnostic');
      renderDiagnostic(data);
      if(data.queue&&Array.isArray(data.queue.rows)){
        rowsCache=data.queue.rows;
        renderSummary(data.summary||{});
        setupFilters(data.summary||{});
        renderRows();
        renderExclusions();
      }
      show('소셜 후보 점검 JSON을 읽었습니다.','ok');
    }catch(error){show(errorMessage(error),'warn');}
    finally{$('diagnosticBtn').disabled=false;}
  }
  async function importSection(sectionKey,dryRun,silent){
    var target=Math.max(1,Math.min(300,Number($('collectorLimit').value)||100));
    $('collectorState').textContent=sectionLabel(sectionKey)+' '+(dryRun?'실검색 점검 중':'실콘텐츠 찾는 중');
    var data=await postJson(LIVE_COLLECT_ENDPOINT,{
      action:'collect_live',
      dryRun:!!dryRun,
      sectionKey:sectionKey,
      limit:target,
      queryPasses:target>=300?6:(target>=200?5:4)
    });
    if(!silent)renderDiagnostic(data);
    return data;
  }
  async function collectSelected(dryRun){
    hideNotice();
    var button=dryRun?$('collectDryRunBtn'):$('collectSectionBtn');
    var sectionKey=text($('collectorSection').value);
    button.disabled=true;
    try{
      var data=await importSection(sectionKey,dryRun,false);
      var accepted=Number(data.accepted||0);
      var saved=Number(data.saved||0);
      var skipped=Number(data.excludedSkipped||0);
      var searched=Number(data.liveCollection&&data.liveCollection.searchedRows||0);
      var direct=Number(data.liveCollection&&data.liveCollection.directCandidates||0);
      var message=sectionLabel(sectionKey)+' '+(dryRun?'실검색 점검':'실콘텐츠 수집')+' 완료: 검색 '+searched+'개, 직접 콘텐츠 '+direct+'개, 후보 '+accepted+'개, 저장 '+saved+'개, 제외 상태 보존 '+skipped+'개.';
      if(!dryRun)await refresh();
      show(message,direct?'ok':'warn');
    }catch(error){show(errorMessage(error),'warn');}
    finally{button.disabled=false;$('collectorState').textContent='수집 대기';}
  }
  async function collectAll(){
    if(!confirm('9개 SNS 섹션의 실제 공개 콘텐츠를 순차 검색할까요? 시간이 걸릴 수 있으며, 제외·영구 차단 항목은 다시 반입하지 않습니다.'))return;
    hideNotice();
    $('collectAllBtn').disabled=true;
    $('collectSectionBtn').disabled=true;
    $('collectDryRunBtn').disabled=true;
    var savedTotal=0;
    var acceptedTotal=0;
    var skippedTotal=0;
    var searchedTotal=0;
    var directTotal=0;
    try{
      for(var index=0;index<SECTION_ORDER.length;index+=1){
        $('collectorState').textContent=(index+1)+'/'+SECTION_ORDER.length+' · '+sectionLabel(SECTION_ORDER[index]);
        var data=await importSection(SECTION_ORDER[index],false,true);
        savedTotal+=Number(data.saved||0);
        acceptedTotal+=Number(data.accepted||0);
        skippedTotal+=Number(data.excludedSkipped||0);
        searchedTotal+=Number(data.liveCollection&&data.liveCollection.searchedRows||0);
        directTotal+=Number(data.liveCollection&&data.liveCollection.directCandidates||0);
      }
      await refresh();
      show('전체 섹션 실검색 완료: 검색 '+searchedTotal+'개, 직접 콘텐츠 '+directTotal+'개, 후보 '+acceptedTotal+'개, 저장 '+savedTotal+'개, 제외 상태 보존 '+skippedTotal+'개.',directTotal?'ok':'warn');
    }catch(error){show(errorMessage(error),'warn');}
    finally{
      $('collectAllBtn').disabled=false;
      $('collectSectionBtn').disabled=false;
      $('collectDryRunBtn').disabled=false;
      $('collectorState').textContent='수집 대기';
    }
  }
  async function runAction(action,ids){
    if(!ids.length){show('처리할 후보를 먼저 선택해 주세요.','warn');return;}
    var labels={approve:'승인',hold:'보류',reset:'재검토',reject:'반려',permanent_block:'영구 차단'};
    if(action==='approve'&&!$('socialConfirm').checked){show('승인 전 외부 플랫폼 권한·광고·로그인 정책 확인 체크가 필요합니다.','warn');return;}
    var label=labels[action]||action;
    var note=prompt(label+' 처리 메모를 입력하세요. 비워도 됩니다.','')||'';
    if(!confirm('선택한 '+ids.length+'개 후보를 '+label+' 처리할까요?'))return;
    hideNotice();
    state.textContent='후보 상태를 변경하는 중입니다.';
    try{
      var data=await postJson(ACTION_ENDPOINT,{action:action,ids:ids,note:note,confirmSocialSafe:action==='approve'});
      $('socialConfirm').checked=false;
      await refresh();
      show(label+' 처리 '+Number(data.updated||0)+'건 완료','ok');
    }catch(error){show(errorMessage(error),'warn');}
  }
  async function moveToExclusion(ids,allVisible){
    if(!ids.length){show('제외 목록으로 이동할 후보가 없습니다.','warn');return;}
    var message=allVisible?'현재 필터에 보이는 '+ids.length+'개 후보를 검색 제외 목록으로 이동할까요?':'선택한 '+ids.length+'개 후보를 검색 제외 목록으로 이동할까요?';
    if(!confirm(message))return;
    var note=prompt('제외 사유를 입력하세요.','후보 목록에서 제외')||'후보 목록에서 제외';
    try{
      var data=await postJson(ACTION_ENDPOINT,{action:'delete',ids:ids,note:note,confirmQueueDelete:true});
      await refresh();
      show('후보 목록에서 '+Number(data.updated||0)+'건을 검색 제외 목록으로 이동했습니다.','ok');
    }catch(error){show(errorMessage(error),'warn');}
  }
  async function exclusionAction(action,ids){
    if(!ids.length){show('처리할 제외 항목을 먼저 선택해 주세요.','warn');return;}
    var labels={restore:'복원',permanent_block:'영구 차단',forget:'기록 완전 삭제'};
    var label=labels[action]||action;
    if(!confirm('선택한 '+ids.length+'개 항목을 '+label+' 처리할까요?'))return;
    var body={action:action,ids:ids,note:label};
    if(action==='forget')body.confirmPermanentDelete=true;
    try{
      var data=await postJson(ACTION_ENDPOINT,body);
      await refresh();
      show(label+' 처리 '+Number(data.updated||data.deleted||0)+'건 완료','ok');
    }catch(error){show(errorMessage(error),'warn');}
  }
  async function previewRotation(){
    hideNotice();
    $('rotationBtn').disabled=true;
    state.textContent='승인 후보 로테이션을 계산하는 중입니다.';
    try{
      var data=await getJson(ROTATION_ENDPOINT);
      rotationCache=data;
      renderDiagnostic(data);
      show('로테이션 미리보기를 계산했습니다. social.snapshot.json은 수정하지 않았습니다.','ok');
    }catch(error){show(errorMessage(error),'warn');}
    finally{$('rotationBtn').disabled=false;}
  }
  async function previewSnapshot(){
    hideNotice();
    $('publishPreviewBtn').disabled=true;
    state.textContent='공개 스냅샷 미리보기를 생성하는 중입니다.';
    try{
      var data=await getJson(PUBLISH_ENDPOINT+'?includeSnapshot=0');
      publishCache=data;
      renderDiagnostic(data);
      show('social.snapshot.json 미리보기를 생성했습니다. 런타임 파일 쓰기는 하지 않았습니다.','ok');
    }catch(error){show(errorMessage(error),'warn');}
    finally{$('publishPreviewBtn').disabled=false;}
  }
  async function downloadSnapshot(){
    hideNotice();
    state.textContent='생성된 social.snapshot.json을 다운로드하는 중입니다.';
    try{
      var response=await fetch(PUBLISH_ENDPOINT+'?download=1',{headers:authHeaders(false),credentials:'same-origin',cache:'no-store'});
      var body=await response.text();
      if(!response.ok)throw new Error(body||('HTTP '+response.status));
      downloadBlob('social.snapshot.generated.json',body);
      show('생성된 social.snapshot.json을 다운로드했습니다. 실제 배포 파일 교체는 별도 확인 후 진행하세요.','ok');
    }catch(error){show(errorMessage(error),'warn');}
  }
  function returnToAdmin(){
    var params=new URLSearchParams(window.location.search);
    var raw=params.get('returnPath')||'/admin.html';
    if(!/^\//.test(raw))raw='/admin.html';
    window.location.href=raw;
  }
  function bind(){
    fillFixedSelectors();
    $('refreshBtn').onclick=refresh;
    $('collectDryRunBtn').onclick=function(){collectSelected(true);};
    $('collectSectionBtn').onclick=function(){collectSelected(false);};
    $('collectAllBtn').onclick=collectAll;
    $('diagnosticBtn').onclick=diagnostic;
    $('downloadJsonBtn').onclick=function(){
      if(!diagnosticCache){show('먼저 소셜 점검 JSON을 읽어 주세요.','warn');return;}
      downloadBlob('igdc-social-candidate-queue-diagnostic-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json',diagnosticCache);
    };
    $('downloadCandidateListBtn').onclick=function(){
      var rows=visibleRows();
      downloadBlob('igdc-social-candidate-visible-list.json',{ok:true,generatedAt:new Date().toISOString(),count:rows.length,rows:rows});
    };
    $('rotationBtn').onclick=previewRotation;
    $('publishPreviewBtn').onclick=previewSnapshot;
    $('snapshotDownloadBtn').onclick=downloadSnapshot;
    $('returnBtn').onclick=returnToAdmin;
    $('approveBtn').onclick=function(){runAction('approve',selectedIds('.rowcheck'));};
    $('holdBtn').onclick=function(){runAction('hold',selectedIds('.rowcheck'));};
    $('resetBtn').onclick=function(){runAction('reset',selectedIds('.rowcheck'));};
    $('rejectBtn').onclick=function(){runAction('reject',selectedIds('.rowcheck'));};
    $('blockBtn').onclick=function(){runAction('permanent_block',selectedIds('.rowcheck'));};
    $('deleteBtn').onclick=function(){moveToExclusion(selectedIds('.rowcheck'),false);};
    $('deleteVisibleBtn').onclick=function(){moveToExclusion(currentVisibleIds(),true);};
    $('toggleExclusionBtn').onclick=function(){
      var body=$('exclusionBody');
      var open=body.classList.contains('hidden');
      body.classList.toggle('hidden',!open);
      this.textContent=open?'목록 접기':'목록 펼치기';
    };
    $('restoreExcludedBtn').onclick=function(){exclusionAction('restore',selectedIds('.excludedCheck'));};
    $('permanentBlockExcludedBtn').onclick=function(){exclusionAction('permanent_block',selectedIds('.excludedCheck'));};
    $('forgetExcludedBtn').onclick=function(){exclusionAction('forget',selectedIds('.excludedCheck'));};
    ['searchInput','sectionFilter','platformFilter','riskFilter','reviewFilter'].forEach(function(id){
      $(id).addEventListener('input',renderRows);
      $(id).addEventListener('change',renderRows);
    });
    $('selectAllRows').onchange=function(){
      var checked=this.checked;
      document.querySelectorAll('.rowcheck').forEach(function(element){element.checked=checked;});
    };
    $('selectAllExcluded').onchange=function(){
      var checked=this.checked;
      document.querySelectorAll('.excludedCheck').forEach(function(element){element.checked=checked;});
    };
    $('candidateRows').addEventListener('click',function(event){
      var button=event.target.closest('.sourceBtn');
      if(button)openSource(text(button.dataset.candidateId));
    });
    $('excludedRows').addEventListener('click',function(event){
      var button=event.target.closest('.sourceBtn');
      if(button)openSource(text(button.dataset.candidateId));
    });
    window.addEventListener('pageshow',function(event){if(event.persisted)refresh();});
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
