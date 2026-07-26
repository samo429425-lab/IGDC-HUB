/* IGDC Media Candidate Queue v2.4 - exact exclusion restore and administrator playback diagnostics */
(function(){
  'use strict';

  var END='/.netlify/functions/media-candidate-review';
  var COL='/.netlify/functions/sanmaru-media-collector';
  var ACT='/.netlify/functions/media-candidate-action';
  var PUB='/.netlify/functions/media-snapshot-publish';
  var SECTION_ORDER=['media-movie','media-drama','media-thriller','media-romance','media-variety','media-documentary','media-animation','media-music','media-shorts'];

  var $=function(id){return document.getElementById(id);};
  var text=function(value){return String(value==null?'':value).trim();};
  var lower=function(value){return text(value).toLowerCase();};
  var esc=function(value){
    return text(value).replace(/[&<>"']/g,function(character){
      return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character];
    });
  };

  var rowsCache=[];
  var excludedCache=[];
  var summaryCache={};
  var diagnosticCache=null;
  var notice=$('notice');
  var state=$('state');
  var currentPreview=null;
  var collectorStopRequested=false;
  var collectAllRunning=false;
  var lastRunStats={saved:0,section:''};
  var previewSources=[];
  var previewSourceIndex=0;
  var fullscreenUiTimer=null;

  function token(){
    try{
      return sessionStorage.getItem('igdc.mediaCandidateQueue.adminBearer')||
        localStorage.getItem('igdc.mediaCandidateQueue.adminBearer')||'';
    }catch(_error){return'';}
  }
  function headers(json){
    var result={Accept:'application/json'};
    var bearer=token();
    if(bearer&&bearer.split('.').length===3)result.Authorization='Bearer '+bearer;
    if(json)result['Content-Type']='application/json';
    return result;
  }
  async function get(url){
    var response=await fetch(url,{headers:headers(false),credentials:'same-origin',cache:'no-store'});
    var data=null;
    try{data=await response.json();}catch(_error){}
    if(!response.ok||!data||data.ok!==true){
      var error=new Error(data&&data.message||data&&data.error||'HTTP '+response.status);
      error.status=response.status;throw error;
    }
    return data;
  }
  async function post(url,body){
    var response=await fetch(url,{method:'POST',headers:headers(true),credentials:'same-origin',body:JSON.stringify(body)});
    var data=null;
    try{data=await response.json();}catch(_error){}
    if(!response.ok||!data||data.ok!==true){
      var error=new Error(data&&data.message||data&&data.error||'HTTP '+response.status);
      error.status=response.status;throw error;
    }
    return data;
  }
  function show(message,kind){
    notice.className='notice '+(kind==='warn'?'warn':'');
    notice.textContent=message;
    notice.classList.remove('hidden');
  }
  function hide(){notice.classList.add('hidden');notice.textContent='';}
  function card(title,value,caption){
    return '<article class="card"><h2>'+esc(title)+'</h2><div class="num">'+esc(value)+'</div><div class="small">'+esc(caption||'')+'</div></article>';
  }
  function activeRows(){
    return rowsCache.filter(function(row){
      var status=lower(row.reviewStatus);
      return status!=='search_excluded'&&status!=='exclusion_released'&&status!=='permanent_blocked';
    });
  }
  function exclusionRows(){
    return rowsCache.filter(function(row){
      var status=lower(row.reviewStatus);
      return status==='search_excluded'||status==='exclusion_released'||status==='permanent_blocked';
    });
  }
  function renderSummary(summary){
    summary=summary||summaryCache||{};
    var selected=text($('collectorSection')&&$('collectorSection').value);
    var selectedCount=activeRows().filter(function(row){return text(row.sectionKey)===selected;}).length;
    $('summaryGrid').innerHTML=[
      card('이번 수집',lastRunStats.saved||0,lastRunStats.section||'수집 전'),
      card('선택 섹션',selectedCount,selected||'-'),
      card('전체 대기열',activeRows().length,'검색 제외 제외'),
      card('자동 격리',summary.quarantinedCount||0,'안전·권리·분류 검토'),
      card('승격 가능',summary.promotableCount||0,'이중 확인 완료'),
      card('검색 제외',exclusionRows().length,'해제·복원·차단 구분')
    ].join('');
    $('summaryGrid').classList.remove('hidden');
  }
  function fillSelect(id,values,label){
    var element=$(id),current=element.value;
    element.innerHTML='<option value="">'+esc(label)+'</option>'+values.map(function(value){
      return '<option value="'+esc(value)+'">'+esc(value)+'</option>';
    }).join('');
    if(values.indexOf(current)>=0)element.value=current;
  }
  function setupFilters(summary){
    fillSelect('sectionFilter',Object.keys(summary.bySection||{}).sort(),'전체 섹션');
    fillSelect('riskFilter',Object.keys(summary.byRisk||{}).sort(),'전체 위험도');
    fillSelect('safetyFilter',Object.keys(summary.bySafetyDecision||{}).sort(),'전체 안전판정');
    fillSelect('statusFilter',Object.keys(summary.byVerificationStatus||{}).sort(),'전체 검증상태');
    $('filterPanel').classList.remove('hidden');
  }
  function qualityValue(value){
    var match=text(value).match(/(\d{3,4})p/i);
    return match?Number(match[1]):0;
  }
  function rowRank(row){
    var match=String(row.qualityPriority||'').match(/(\d+)/);
    return Number(row.rankingScore||match&&match[1]||0);
  }
  function visibleRows(){
    var query=lower($('searchInput').value);
    var section=text($('sectionFilter').value);
    var risk=text($('riskFilter').value);
    var safety=text($('safetyFilter').value);
    var status=text($('statusFilter').value);
    var sort=$('sortSelect').value;
    var rows=activeRows().filter(function(row){
      if(section&&text(row.sectionKey)!==section)return false;
      if(risk&&text(row.riskLevel)!==risk)return false;
      if(safety&&text(row.safetyDecision)!==safety)return false;
      if(status&&text(row.verificationStatus)!==status)return false;
      if(!query)return true;
      return[
        row.title,row.provider,row.sectionKey,row.year,row.qualityTarget,row.rankingTier,
        row.ageRating,row.safetyDecision,(row.policyReasons||[]).join(' '),(row.subtitleLanguages||[]).join(' ')
      ].map(text).join(' ').toLowerCase().indexOf(query)>=0;
    });
    rows.sort(function(left,right){
      if(sort==='quality')return qualityValue(right.qualityTarget)-qualityValue(left.qualityTarget)||rowRank(right)-rowRank(left);
      if(sort==='year')return Number(right.year||0)-Number(left.year||0)||rowRank(right)-rowRank(left);
      if(sort==='subtitle')return Number(right.subtitleCount||0)-Number(left.subtitleCount||0)||rowRank(right)-rowRank(left);
      if(sort==='title')return text(left.title).localeCompare(text(right.title));
      return rowRank(right)-rowRank(left)||qualityValue(right.qualityTarget)-qualityValue(left.qualityTarget)||Number(right.year||0)-Number(left.year||0);
    });
    return rows;
  }
  function pill(value,className){return '<span class="pill '+(className||'')+'">'+esc(value||'-')+'</span>';}
  function rowHtml(row,index){
    var id=text(row.contentId||row.id);
    var languages=Array.isArray(row.subtitleLanguages)?row.subtitleLanguages:[];
    var warnings=Array.isArray(row.contentWarnings)?row.contentWarnings:[];
    var reasons=Array.isArray(row.policyReasons)?row.policyReasons:[];
    var safety=lower(row.safetyDecision);
    var safetyClass=safety==='hard_block'?'blocked':safety==='quarantine'?'quarantine':'';
    return '<tr>'+
      '<td class="seq">'+(index+1)+'</td>'+
      '<td><input class="rowcheck" type="checkbox" data-candidate-id="'+esc(id)+'"></td>'+
      '<td>'+pill(row.sectionKey,'section')+'<div class="small">요청 '+esc(row.requestedSection||'-')+' · 분류 '+esc(row.classificationConfidence||0)+'%</div></td>'+
      '<td>'+pill((row.rankingTier||'-')+' '+rowRank(row),'rank')+'<div class="small">'+esc((row.rankingSignals||[]).join(' · '))+'</div></td>'+
      '<td><strong class="candidate-title"><button type="button" class="previewBtn" data-candidate-id="'+esc(id)+'">'+esc(row.title||'(제목 없음)')+'</button></strong><div class="mono small">'+esc(id)+'</div></td>'+
      '<td class="nowrap">'+esc(row.year||'-')+'</td>'+
      '<td>'+esc(row.provider||'-')+'<div class="small">'+esc(row.rights&&row.rights.sourceHint||'')+'</div></td>'+
      '<td>'+esc(row.qualityTarget||'-')+'<div class="small">'+esc(row.durationSeconds?Math.round(row.durationSeconds/60)+'분':'길이 미확인')+'</div></td>'+
      '<td>'+esc(row.subtitleCount||0)+'개<div class="small">'+esc(languages.join(' · '))+'</div></td>'+
      '<td>'+esc(row.ageRating||'-')+' '+pill(row.safetyDecision||'검토 필요',safetyClass)+'<div class="small">'+esc(warnings.concat(reasons).join(' · '))+'</div></td>'+
      '<td>'+esc(row.reviewStatus||'-')+'<div class="small">'+esc(row.verificationStatus||'-')+' · '+esc(row.rights&&row.rights.status||'')+'</div></td>'+
      '</tr>';
  }
  function renderRows(){
    var rows=visibleRows(),group=$('groupBySection').checked,html='',sequence=0;
    if(group){
      var groups={};
      rows.forEach(function(row){
        var key=text(row.sectionKey)||'unknown';
        (groups[key]||(groups[key]=[])).push(row);
      });
      SECTION_ORDER.concat(Object.keys(groups).filter(function(key){return SECTION_ORDER.indexOf(key)<0;}).sort()).forEach(function(key){
        var list=groups[key];
        if(!list||!list.length)return;
        html+='<tr class="group-row"><td colspan="11">'+esc(key)+' · '+list.length+'개</td></tr>';
        list.forEach(function(row){html+=rowHtml(row,sequence++);});
      });
    }else rows.forEach(function(row){html+=rowHtml(row,sequence++);});
    $('candidateRows').innerHTML=html||'<tr><td colspan="11" class="small">조건에 맞는 후보가 없습니다.</td></tr>';
    $('filterState').textContent='표시 '+rows.length+'개 / 후보 '+activeRows().length+'개';
    $('tablePanel').classList.remove('hidden');
    $('selectAllRows').checked=false;
  }
  function exclusionRowHtml(row,index){
    var id=text(row.contentId||row.id),status=lower(row.reviewStatus);
    var label=status==='permanent_blocked'?'영구 차단':status==='exclusion_released'?'이전 제외 해제 기록':'검색 제외';
    var className=status==='permanent_blocked'?'blocked':status==='search_excluded'?'quarantine':'';
    var restore=row.exclusionRestore||{};
    var restoreTarget=restore.exact?
      [restore.originalReviewStatus||'상태 미상',restore.originalSectionKey||row.sectionKey||'섹션 미상',restore.originalPriority||'순위 미상'].join(' · '):
      '이전 기록 · 보류/안전 기본값 복원';
    return '<tr>'+
      '<td class="seq">'+(index+1)+'</td><td><input class="excludedCheck" type="checkbox" data-candidate-id="'+esc(id)+'"></td>'+
      '<td>'+pill(row.sectionKey,'section')+'</td><td>'+pill(label,className)+'</td>'+
      '<td><strong class="candidate-title"><button type="button" class="previewBtn" data-candidate-id="'+esc(id)+'">'+esc(row.title||'(제목 없음)')+'</button></strong><div class="mono small">'+esc(id)+'</div></td>'+
      '<td>'+esc(restoreTarget)+'</td><td>'+esc(row.blockedReason||row.reviewNote||'-')+'</td><td>'+esc(row.provider||'-')+'</td><td class="nowrap">'+esc(restore.excludedAt||row.reviewedAt||'-')+'</td>'+
      '</tr>';
  }
  function renderExclusions(){
    excludedCache=exclusionRows();
    var groups={},html='',sequence=0;
    excludedCache.forEach(function(row){
      var key=text(row.sectionKey)||'unknown';
      (groups[key]||(groups[key]=[])).push(row);
    });
    SECTION_ORDER.concat(Object.keys(groups).filter(function(key){return SECTION_ORDER.indexOf(key)<0;}).sort()).forEach(function(key){
      var list=groups[key];
      if(!list||!list.length)return;
      html+='<tr class="group-row"><td colspan="9">'+esc(key)+' · '+list.length+'개</td></tr>';
      list.forEach(function(row){html+=exclusionRowHtml(row,sequence++);});
    });
    $('excludedRows').innerHTML=html||'<tr><td colspan="9" class="small">검색 제외 기록 또는 영구 차단 항목이 없습니다.</td></tr>';
    var excluded=excludedCache.filter(function(row){return lower(row.reviewStatus)==='search_excluded';}).length;
    var released=excludedCache.filter(function(row){return lower(row.reviewStatus)==='exclusion_released';}).length;
    var blocked=excludedCache.filter(function(row){return lower(row.reviewStatus)==='permanent_blocked';}).length;
    $('exclusionSummary').textContent='검색 제외 '+excluded+'건 · 이전 해제 기록 '+released+'건 · 영구 차단 '+blocked+'건 · 전체 '+excludedCache.length+'건';
    $('exclusionPanel').classList.remove('hidden');
    $('selectAllExcluded').checked=false;
  }
  function selectedIds(selector){
    return Array.from(document.querySelectorAll(selector+':checked')).map(function(element){
      return text(element.dataset.candidateId);
    }).filter(Boolean);
  }
  function currentVisibleIds(){
    return visibleRows().map(function(row){return text(row.contentId||row.id);}).filter(Boolean);
  }
  function download(content,name){
    var blob=new Blob([content],{type:'application/json;charset=utf-8'});
    var anchor=document.createElement('a');
    anchor.href=URL.createObjectURL(blob);anchor.download=name;
    document.body.appendChild(anchor);anchor.click();
    setTimeout(function(){URL.revokeObjectURL(anchor.href);anchor.remove();},300);
  }
  async function refresh(){
    hide();$('refreshBtn').disabled=true;
    try{
      state.textContent='후보 대기열 읽는 중';
      var data=await get(END+'?action=candidates');
      rowsCache=data.candidates||[];
      summaryCache=data.summary||{};
      renderSummary(summaryCache);setupFilters(summaryCache);renderRows();renderExclusions();
      var live=data.sourceMode==='supabase';
      state.textContent=live?'실시간 저장소 연결 정상':'정적 점검본 대체 표시';
      show(
        live?'정책·섹션·랭킹 기준으로 실시간 후보 대기열을 읽었습니다.':'실시간 저장소에 연결하지 못해 정적 점검본을 표시합니다. 이 상태에서는 최신 변경을 확정하지 마십시오.',
        live?'ok':'warn'
      );
    }catch(error){show(error.message,'warn');}
    finally{$('refreshBtn').disabled=false;}
  }
  async function diagnostic(){
    try{
      var data=await get(END+'?action=diagnostic');
      diagnosticCache=data;
      $('diagnosticJson').textContent=JSON.stringify(data,null,2);
      $('diagnosticPanel').classList.remove('hidden');
      $('downloadJsonBtn').disabled=false;
    }catch(error){show(error.message,'warn');}
  }
  function collectorJobKey(section){return'igdc.mediaCollector.job.'+section;}
  function loadCollectorJob(section){
    try{var raw=localStorage.getItem(collectorJobKey(section));return raw?JSON.parse(raw):null;}
    catch(_error){return null;}
  }
  function saveCollectorJob(job){try{localStorage.setItem(collectorJobKey(job.section),JSON.stringify(job));}catch(_error){}}
  function clearCollectorJob(section){try{localStorage.removeItem(collectorJobKey(section));}catch(_error){}}
  function updateCollectorProgress(job){
    var target=Math.max(1,Number(job.target||1));
    var saved=Math.max(0,Number(job.saved||0));
    var percent=Math.min(100,Math.round(saved/target*100));
    $('collectorProgress').classList.remove('hidden');
    $('collectorProgressText').textContent='목표 '+target+'개 · 신규 저장 '+saved+'개 · 검색 '+Number(job.searched||0)+'건 · 정밀검사 '+Number(job.inspected||0)+'건 · 현재 묶음 '+Number(job.batch||0);
    $('collectorRejectText').textContent='제외 '+Number(job.rejected||0)+'건'+(job.lastReason?' · 최근 제외: '+job.lastReason:'');
    $('collectorProgressBar').style.width=percent+'%';
    $('collectorState').textContent=job.paused?'일시정지됨':(saved>=target?'목표 완료':'정밀 수집 중');
  }
  function wait(milliseconds){return new Promise(function(resolve){setTimeout(resolve,milliseconds);});}
  async function collect(admin,wholeRun){
    var section=$('collectorSection').value;
    var target=Number($('collectorLimit').value)||5;
    if(admin){
      var body={
        source:'internet_archive',section:section,target:1,batchSize:1,
        identifier:text($('adminArchiveIdentifier').value),adminException:true,
        overrideReason:text($('adminOverrideReason').value)
      };
      if(!body.identifier||!body.overrideReason){show('관리자 지정 주소와 사유가 필요합니다.','warn');return;}
      $('collectBtn').disabled=true;$('collectAllBtn').disabled=true;$('collectAdminExceptionBtn').disabled=true;
      try{
        $('collectorState').textContent='관리자 지정 후보 정밀검사 중';
        var one=await post(COL,body);
        lastRunStats={saved:Number(one.saved||0),section:section};
        show('관리자 지정 후보 '+Number(one.saved||0)+'건을 저장했습니다.','ok');
        await refresh();
      }catch(error){show(error.message,'warn');}
      finally{$('collectBtn').disabled=false;$('collectAllBtn').disabled=false;$('collectAdminExceptionBtn').disabled=false;}
      return;
    }
    var existing=loadCollectorJob(section),job;
    if(existing&&existing.paused&&Number(existing.saved||0)<Number(existing.target||0)){job=existing;job.paused=false;}
    else{
      job={
        section:section,target:target,batchSize:3,page:1,batch:0,saved:0,searched:0,inspected:0,rejected:0,
        knownIds:rowsCache.map(function(row){return text(row.contentId||row.id);}),paused:false,lastReason:''
      };
    }
    var startSaved=Number(job.saved||0);
    if(!wholeRun)collectorStopRequested=false;
    $('collectBtn').disabled=true;$('collectAllBtn').disabled=true;$('collectAdminExceptionBtn').disabled=true;$('collectorStopBtn').disabled=false;
    updateCollectorProgress(job);
    var maxBatches=Math.min(80,Math.max(12,job.target*8));
    try{
      while(job.saved<job.target&&job.batch<maxBatches&&!collectorStopRequested){
        job.batch+=1;
        var attempts=0,data=null;
        while(attempts<3&&!data){
          attempts+=1;
          try{
            data=await post(COL,{source:'internet_archive',section:job.section,target:job.target,batchSize:job.batchSize,page:job.page,batchMode:true});
          }catch(error){
            if((error.status===502||error.status===503||error.status===504)&&attempts<3){
              $('collectorState').textContent='외부 원본 지연 · '+attempts+'차 재시도';
              await wait(1200*attempts);continue;
            }
            throw error;
          }
        }
        job.page=Number(data.nextPage||job.page+1);
        job.searched+=Number(data.searched||0);job.inspected+=Number(data.searched||0);job.rejected+=Number(data.rejectedCount||0);
        var responseItems=Array.isArray(data.items)?data.items:null;
        var ids=responseItems?responseItems.filter(function(row){
          return text(row.section_key||row.sectionKey)===job.section;
        }).map(function(row){return text(row.id||row.contentId);}):(Array.isArray(data.savedIds)?data.savedIds:[]);
        ids.forEach(function(id){
          id=text(id);
          if(id&&job.knownIds.indexOf(id)<0){job.knownIds.push(id);job.saved+=1;}
        });
        var last=(data.rejected||[]).slice(-1)[0];
        job.lastReason=last&&text(last.reason)||'';
        saveCollectorJob(job);updateCollectorProgress(job);
        if(data.done)break;
        if(job.saved<job.target)await wait(350);
      }
      job.paused=collectorStopRequested||job.saved<job.target;
      saveCollectorJob(job);updateCollectorProgress(job);
      lastRunStats={saved:Math.max(0,job.saved-startSaved),section:job.section};
      if(job.saved>=job.target){
        clearCollectorJob(section);show('목표 '+job.target+'개를 품질 기준으로 누적 저장했습니다.','ok');
      }else if(collectorStopRequested){
        show('수집을 일시정지했습니다. 같은 섹션에서 다시 시작하면 이어서 진행합니다.','ok');
      }else{
        show('탐색 한도 안에서 '+job.saved+'개를 저장했습니다. 저품질 후보로 목표 수량을 강제로 채우지 않았습니다.','ok');
      }
      await refresh();
    }catch(error){
      job.paused=true;saveCollectorJob(job);updateCollectorProgress(job);
      $('collectorState').textContent='수집 일시정지';
      show(error.message+' · 진행 지점은 저장되었습니다.','warn');
    }finally{
      if(!wholeRun){
        $('collectBtn').disabled=false;$('collectAllBtn').disabled=false;$('collectAdminExceptionBtn').disabled=false;$('collectorStopBtn').disabled=true;
        collectorStopRequested=false;
      }
    }
  }
  async function collectAll(){
    if(collectAllRunning)return;
    if(!window.confirm('9개 섹션을 현재 목표 수량으로 순차 수집할까요? 품질 미달 후보로 수량을 강제로 채우지 않습니다.'))return;
    var total=0;
    collectAllRunning=true;collectorStopRequested=false;
    $('collectBtn').disabled=true;$('collectAllBtn').disabled=true;$('collectAdminExceptionBtn').disabled=true;$('collectorStopBtn').disabled=false;
    try{
      for(var index=0;index<SECTION_ORDER.length&&!collectorStopRequested;index+=1){
        $('collectorSection').value=SECTION_ORDER[index];
        $('collectorState').textContent='전체 수집 '+(index+1)+'/9 · '+SECTION_ORDER[index];
        await collect(false,true);
        total+=Number(lastRunStats.saved||0);
      }
      lastRunStats={saved:total,section:'전체 섹션'};
      show(
        collectorStopRequested?'전체 수집을 현재 묶음 뒤 일시정지했습니다.':'전체 섹션 순차 수집을 마쳤습니다. 이번 수집 '+total+'건입니다.',
        collectorStopRequested?'warn':'ok'
      );
    }finally{
      collectAllRunning=false;
      $('collectBtn').disabled=false;$('collectAllBtn').disabled=false;$('collectAdminExceptionBtn').disabled=false;$('collectorStopBtn').disabled=true;
      collectorStopRequested=false;renderSummary(summaryCache);
    }
  }
  async function candidateAction(action,ids){
    if(!ids.length){show('처리할 후보를 선택해 주세요.','warn');return;}
    if(action==='approve'&&(!$('rightsConfirm').checked||!$('contentConfirm').checked)){
      show('승인 전 콘텐츠 안전과 원본 권리를 각각 확인해 주세요.','warn');return;
    }
    var labels={approve:'승인',hold:'보류',reset:'재검토',reject:'반려',block:'영구 차단'};
    var entered=window.prompt((labels[action]||action)+' 검토 메모(승인·반려·차단은 필수)','');
    if(entered===null)return;
    var note=text(entered);
    if((action==='approve'||action==='reject'||action==='block')&&note.length<3){
      show('3자 이상의 검토 메모가 필요합니다.','warn');return;
    }
    try{
      var data=await post(ACT,{
        action:action,ids:ids,note:note,
        confirmRightsSafe:action==='approve'&&$('rightsConfirm').checked,
        confirmContentSafe:action==='approve'&&$('contentConfirm').checked,
        confirmSubtitlesChecked:action==='approve'&&$('subtitleConfirm').checked
      });
      show((labels[action]||action)+' 처리 '+Number(data.updated||0)+'건 완료','ok');
      $('rightsConfirm').checked=false;$('contentConfirm').checked=false;$('subtitleConfirm').checked=false;
      await refresh();
    }catch(error){show(error.message,'warn');}
  }
  async function removeCandidates(ids,allVisible){
    if(!ids.length){show('삭제할 후보가 없습니다.','warn');return;}
    var message=allVisible?
      '현재 필터에 보이는 '+ids.length+'개 후보를 목록에서 모두 삭제할까요? 원본 영상은 삭제되지 않습니다.':
      '선택한 '+ids.length+'개 후보를 목록에서 삭제할까요? 원본 영상은 삭제되지 않습니다.';
    if(!window.confirm(message))return;
    try{
      var data=await post(ACT,{action:'delete',ids:ids,confirmQueueDelete:true});
      show('후보 목록에서 '+Number(data.updated||0)+'건을 검색 제외 목록으로 이동했습니다.','ok');
      await refresh();
    }catch(error){show(error.message,'warn');}
  }
  async function exclusionAction(action,ids){
    if(!ids.length){show('처리할 검색 제외 항목을 선택해 주세요.','warn');return;}
    var labels={
      restore_hold:'보류로 복원·검색 제외 해제',
      restore:'원래 후보 상태·섹션·정렬 위치로 복원',
      permanent_block:'영구 차단',
      forget:'기록 완전 삭제'
    };
    var label=labels[action]||action;
    var outcomes={
      restore_hold:'후보 본문과 점검 이력은 보존되고 보류 대기열로 이동합니다.',
      restore:'검색 제외 직전 상태와 위치 정보가 있으면 그대로 복귀합니다.',
      permanent_block:'다음 수집과 일반·보류 복원이 모두 차단됩니다.',
      forget:'후보와 제외·차단 기록을 완전히 삭제하여 향후 재평가를 허용합니다.'
    };
    if(!window.confirm(label+' 처리할까요?\n\n'+(outcomes[action]||'')))return;
    var body={action:action,ids:ids,note:label};
    if(action==='forget')body.confirmPermanentDelete=true;
    try{
      var data=await post(ACT,body);
      var legacy=Number(data.legacyFallbackCount||0);
      show(label+' 처리 '+Number(data.updated||data.deleted||0)+'건 완료'+(legacy?' · 이전 형식 '+legacy+'건은 안전 기본값으로 복원':''),'ok');
      await refresh();
    }catch(error){show(error.message,'warn');}
  }
  async function publish(store){
    try{
      var data=await post(PUB,{storeRelease:!!store,includeSnapshot:store?'0':'1',includeBlocked:'1'});
      show('승격 가능 '+data.eligibleRows+'건 · 정책 차단 '+Number(data.policyBlockedRows||0)+'건'+(store?' · 릴리스 저장 완료':''),'ok');
      if(!store&&data.snapshot){
        diagnosticCache=data;
        $('diagnosticJson').textContent=JSON.stringify(data,null,2);
        $('diagnosticPanel').classList.remove('hidden');
      }
    }catch(error){show(error.message,'warn');}
  }

  function candidateSources(row){
    var output=[];
    function add(url,label,designated){
      url=text(url);
      var direct=designated||/\.(?:mp4|m4v|webm|ogv|ogg)(?:[?#]|$)/i.test(url);
      if(!direct||!/^https:\/\//i.test(url)||output.some(function(item){return item.url===url;}))return;
      output.push({url:url,label:label||url});
    }
    var candidates=Array.isArray(row.playbackCandidates)?row.playbackCandidates:
      (row.sourceMetadata&&Array.isArray(row.sourceMetadata.playbackCandidates)?row.sourceMetadata.playbackCandidates:[]);
    candidates.forEach(function(candidate){add(candidate&&candidate.url,candidate&&candidate.name,true);});
    add(row.video,'기본 영상',true);
    add(row.embedUrl,'직접 미디어 형식의 임베드 주소',false);
    add(row.url,'직접 미디어 형식의 원본 주소',false);
    return output;
  }
  function safeWebUrl(value){
    value=text(value);
    return /^https:\/\//i.test(value)?value:'';
  }
  function sourceDetail(row,directCount){
    var parts=['직접 재생 원본 '+directCount+'개'];
    if(safeWebUrl(row.embedUrl))parts.push('임베드 주소 있음'+(/\.(?:mp4|m4v|webm|ogv|ogg)(?:[?#]|$)/i.test(row.embedUrl)?' · 직접 재생 후보':' · 내부 영상 조작 불가 형식'));
    else parts.push('임베드 주소 없음');
    if(safeWebUrl(row.url||row.rights&&row.rights.sourceUrl))parts.push('원본 페이지 있음');
    else parts.push('원본 페이지 없음');
    parts.push('썸네일 '+(safeWebUrl(row.thumb)?'있음':'없음'));
    parts.push('자막 '+Number((row.captions||[]).length||0)+'개');
    return parts.join(' · ');
  }
  function playbackErrorText(video,error){
    if(error&&error.name)return error.name+(error.message?' · '+error.message:'');
    var mediaError=video&&video.error;
    if(!mediaError)return'브라우저가 상세 오류를 제공하지 않았습니다.';
    var labels={
      1:'재생 요청이 중단되었습니다.',
      2:'네트워크 오류로 미디어를 가져오지 못했습니다.',
      3:'미디어 디코딩에 실패했습니다.',
      4:'브라우저가 이 주소나 코덱을 지원하지 않습니다.'
    };
    return labels[mediaError.code]||('미디어 오류 코드 '+mediaError.code);
  }
  function attemptPlay(video){
    var promise=video.play();
    if(promise&&promise.catch)promise.catch(function(error){
      setPlaybackState('재생 시작 실패: '+playbackErrorText(video,error),true);
    });
  }
  function setPlaybackState(message,warn){
    var element=$('previewPlaybackState');
    element.textContent=message;element.className='player-status'+(warn?' warn':'');
  }
  function loadPreviewSource(index,autoplay){
    var video=$('previewVideo');
    if(index>=previewSources.length){
      setPlaybackState('브라우저에서 재생 가능한 원본을 찾지 못했습니다. 원본 페이지에서 파일 상태를 확인해 주세요.',true);
      return;
    }
    previewSourceIndex=index;
    video.pause();video.removeAttribute('src');video.load();
    var source=previewSources[index];
    setPlaybackState('재생 원본 확인 중 '+(index+1)+'/'+previewSources.length+' · '+source.label,false);
    video.src=source.url;video.load();
    if(autoplay)attemptPlay(video);
  }
  function syncPlayButton(){
    var video=$('previewVideo');
    $('playToggle').textContent=video.paused?'재생':'일시정지';
    if(document.fullscreenElement===document.querySelector('.player-shell'))showFullscreenUi(video.paused);
  }
  function showFullscreenUi(keepVisible){
    var shell=document.querySelector('.player-shell'),video=$('previewVideo');
    if(!shell||document.fullscreenElement!==shell)return;
    shell.classList.add('controls-visible');clearTimeout(fullscreenUiTimer);
    if(keepVisible||!video||video.paused)return;
    fullscreenUiTimer=setTimeout(function(){
      if(document.fullscreenElement===shell&&!video.paused)shell.classList.remove('controls-visible');
    },3500);
  }
  function formatPlaybackTime(seconds){
    seconds=Number(seconds);
    if(!isFinite(seconds)||seconds<0)seconds=0;
    var hours=Math.floor(seconds/3600);
    var minutes=Math.floor((seconds%3600)/60);
    var remainder=Math.floor(seconds%60);
    return hours>0?
      String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0')+':'+String(remainder).padStart(2,'0'):
      String(minutes).padStart(2,'0')+':'+String(remainder).padStart(2,'0');
  }
  function syncSeekUi(){
    var video=$('previewVideo'),bar=$('seekBar'),duration=Number(video.duration);
    $('currentTimeText').textContent=formatPlaybackTime(video.currentTime);
    $('durationText').textContent=formatPlaybackTime(duration);
    bar.value=isFinite(duration)&&duration>0?
      String(Math.max(0,Math.min(1000,Math.round((video.currentTime/duration)*1000)))):'0';
    bar.disabled=!(isFinite(duration)&&duration>0);
  }
  function openPreview(id){
    var row=rowsCache.find(function(item){return text(item.contentId||item.id)===id;});
    if(!row)return;
    currentPreview=row;previewSources=candidateSources(row);previewSourceIndex=0;
    var video=$('previewVideo');
    video.pause();video.innerHTML='';video.poster=safeWebUrl(row.thumb);
    $('previewTitle').textContent=row.title||'';
    $('previewMeta').textContent=[row.sectionKey,'랭킹 '+rowRank(row),row.qualityTarget,row.year,row.ageRating,row.safetyDecision].filter(Boolean).join(' · ');
    $('previewSourceDetail').textContent=sourceDetail(row,previewSources.length);
    var sourcePage=safeWebUrl(row.url||row.rights&&row.rights.sourceUrl);
    var embedPage=safeWebUrl(row.embedUrl);
    var directPage=safeWebUrl(row.video);
    var sourceUrl=sourcePage||embedPage||directPage;
    $('sourceOpen').href=sourceUrl||'#';
    $('sourceOpen').textContent=sourcePage?'원본 페이지':embedPage?'임베드 주소':directPage?'직접 영상 주소':'외부 주소 없음';
    $('sourceOpen').setAttribute('aria-disabled',sourceUrl?'false':'true');
    var select=$('subtitleSelect');
    select.innerHTML='<option value="">자막 없음</option>';
    var captions=Array.isArray(row.captions)?row.captions:[];
    captions.forEach(function(caption,index){
      var option=document.createElement('option');
      option.value=String(index);option.textContent=(caption.language||'und')+' · '+(caption.label||('자막 '+(index+1)));
      select.appendChild(option);
    });
    $('previewModal').classList.remove('hidden');
    $('playToggle').textContent='재생';$('seekBar').value='0';$('seekBar').disabled=true;
    $('currentTimeText').textContent='00:00';$('durationText').textContent='00:00';
    document.querySelector('.player-shell').classList.remove('controls-visible');
    if(previewSources.length)loadPreviewSource(0,false);
    else if(safeWebUrl(row.embedUrl))setPlaybackState('직접 재생 주소가 없습니다. 임베드 주소는 있으나 이 내부 HTML5 플레이어에서 진행바·±10초 조작을 지원하는 미디어 형식이 아닙니다.',true);
    else if(sourceUrl)setPlaybackState('직접 재생 주소가 없습니다. 원본 페이지에서 실제 파일 제공 여부를 확인해 주세요.',true);
    else setPlaybackState('영상·임베드·원본 페이지 주소가 모두 없어 재생할 수 없습니다.',true);
  }
  function applySubtitle(index){
    var video=$('previewVideo');
    Array.from(video.querySelectorAll('track')).forEach(function(track){track.remove();});
    if(index==='')return;
    var caption=(currentPreview&&currentPreview.captions||[])[Number(index)];
    if(!caption)return;
    var track=document.createElement('track');
    track.kind='subtitles';track.label=caption.label||caption.language||'subtitle';
    track.srclang=caption.language&&caption.language!=='und'?caption.language:'en';
    if(!safeWebUrl(caption.src)){setPlaybackState('선택한 자막 주소가 유효한 HTTPS 주소가 아닙니다.',true);return;}
    track.src=caption.src;track.default=true;video.appendChild(track);
    setTimeout(function(){
      Array.from(video.textTracks||[]).forEach(function(item){item.mode='showing';});
    },150);
  }
  function closePreview(){
    var video=$('previewVideo');
    video.pause();clearTimeout(fullscreenUiTimer);
    if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(function(){});
    document.querySelector('.player-shell').classList.remove('controls-visible');
    video.removeAttribute('src');video.removeAttribute('poster');video.innerHTML='';video.load();
    $('seekBar').value='0';$('seekBar').disabled=true;
    $('currentTimeText').textContent='00:00';$('durationText').textContent='00:00';
    $('previewModal').classList.add('hidden');
    currentPreview=null;previewSources=[];previewSourceIndex=0;
  }
  function previewClick(event){
    var button=event.target.closest('.previewBtn');
    if(button)openPreview(text(button.dataset.candidateId));
  }

  function bind(){
    $('refreshBtn').onclick=refresh;
    $('diagnosticBtn').onclick=diagnostic;
    $('downloadJsonBtn').onclick=function(){
      if(diagnosticCache)download(JSON.stringify(diagnosticCache,null,2)+'\n','igdc-media-candidate-diagnostic.json');
    };
    $('downloadCandidateListBtn').onclick=function(){
      var rows=visibleRows();
      download(JSON.stringify({ok:true,generatedAt:new Date().toISOString(),count:rows.length,rows:rows},null,2)+'\n','igdc-media-candidate-visible-list.json');
    };
    $('returnBtn').onclick=function(){location.href='/admin.html';};
    $('collectBtn').onclick=function(){collect(false,false);};
    $('collectAllBtn').onclick=collectAll;
    $('collectorStopBtn').onclick=function(){
      collectorStopRequested=true;this.disabled=true;$('collectorState').textContent='현재 묶음 후 일시정지';
    };
    $('collectAdminExceptionBtn').onclick=function(){collect(true,false);};
    $('approveBtn').onclick=function(){candidateAction('approve',selectedIds('.rowcheck'));};
    $('holdBtn').onclick=function(){candidateAction('hold',selectedIds('.rowcheck'));};
    $('resetBtn').onclick=function(){candidateAction('reset',selectedIds('.rowcheck'));};
    $('rejectBtn').onclick=function(){candidateAction('reject',selectedIds('.rowcheck'));};
    $('blockBtn').onclick=function(){candidateAction('block',selectedIds('.rowcheck'));};
    $('deleteBtn').onclick=function(){removeCandidates(selectedIds('.rowcheck'),false);};
    $('deleteVisibleBtn').onclick=function(){removeCandidates(currentVisibleIds(),true);};
    $('toggleExclusionBtn').onclick=function(){
      var body=$('exclusionBody'),open=body.classList.contains('hidden');
      body.classList.toggle('hidden',!open);this.textContent=open?'목록 접기':'목록 펼치기';
    };
    $('restoreHoldExcludedBtn').onclick=function(){exclusionAction('restore_hold',selectedIds('.excludedCheck'));};
    $('restoreExcludedBtn').onclick=function(){exclusionAction('restore',selectedIds('.excludedCheck'));};
    $('permanentBlockExcludedBtn').onclick=function(){exclusionAction('permanent_block',selectedIds('.excludedCheck'));};
    $('forgetExcludedBtn').onclick=function(){exclusionAction('forget',selectedIds('.excludedCheck'));};
    $('publishPreviewBtn').onclick=function(){publish(false);};
    $('storeReleaseBtn').onclick=function(){publish(true);};
    $('downloadSnapshotBtn').onclick=async function(){
      try{
        var response=await fetch(PUB+'?download=1',{headers:headers(false),credentials:'same-origin'});
        var body=await response.text();
        if(!response.ok)throw new Error(body||'다운로드 실패');
        download(body,'media.snapshot.generated.json');
      }catch(error){show(error.message,'warn');}
    };

    ['searchInput','sectionFilter','riskFilter','safetyFilter','statusFilter','sortSelect','groupBySection'].forEach(function(id){
      $(id).addEventListener('input',renderRows);$(id).addEventListener('change',renderRows);
    });
    $('collectorSection').addEventListener('change',function(){renderSummary(summaryCache);});
    $('selectAllRows').onchange=function(){
      var checked=this.checked;document.querySelectorAll('.rowcheck').forEach(function(element){element.checked=checked;});
    };
    $('selectAllExcluded').onchange=function(){
      var checked=this.checked;document.querySelectorAll('.excludedCheck').forEach(function(element){element.checked=checked;});
    };
    $('candidateRows').addEventListener('click',previewClick);
    $('excludedRows').addEventListener('click',previewClick);
    $('previewClose').onclick=closePreview;
    $('previewModal').addEventListener('click',function(event){if(event.target===this)closePreview();});
    $('playToggle').onclick=function(){
      var video=$('previewVideo');
      if(video.paused)attemptPlay(video);
      else video.pause();
      syncPlayButton();
    };
    $('previewVideo').onclick=function(){
      if(this.paused)attemptPlay(this);
      else this.pause();
    };
    $('previewVideo').addEventListener('play',syncPlayButton);
    $('previewVideo').addEventListener('pause',syncPlayButton);
    $('previewVideo').addEventListener('ended',syncPlayButton);
    $('back10').onclick=function(){
      var video=$('previewVideo');
      if(!isFinite(Number(video.duration))||Number(video.duration)<=0){setPlaybackState('재생 시간이 확인되지 않아 -10초 이동을 실행할 수 없습니다.',true);return;}
      video.currentTime=Math.max(0,video.currentTime-10);syncSeekUi();showFullscreenUi(video.paused);
    };
    $('forward10').onclick=function(){
      var video=$('previewVideo');
      if(!isFinite(Number(video.duration))||Number(video.duration)<=0){setPlaybackState('재생 시간이 확인되지 않아 +10초 이동을 실행할 수 없습니다.',true);return;}
      video.currentTime=Math.min(video.duration,video.currentTime+10);syncSeekUi();showFullscreenUi(video.paused);
    };
    $('muteToggle').onclick=function(){
      var video=$('previewVideo');video.muted=!video.muted;this.textContent=video.muted?'음소거 해제':'음소거';
    };
    $('fitToggle').onclick=function(){
      var video=$('previewVideo');video.style.objectFit=video.style.objectFit==='cover'?'contain':'cover';this.textContent=video.style.objectFit==='cover'?'맞춤':'채움';
    };
    $('previewVideo').addEventListener('loadedmetadata',function(){
      setPlaybackState('재생 가능 · '+(this.videoWidth||'?')+'×'+(this.videoHeight||'?')+' · '+(isFinite(this.duration)?Math.round(this.duration)+'초':'길이 확인 중'),false);
      syncSeekUi();
    });
    $('previewVideo').addEventListener('durationchange',syncSeekUi);
    $('previewVideo').addEventListener('timeupdate',syncSeekUi);
    $('previewVideo').addEventListener('progress',syncSeekUi);
    $('previewVideo').addEventListener('canplay',function(){
      setPlaybackState('실제 재생 준비 완료 · 원본 '+(previewSourceIndex+1)+'/'+previewSources.length,false);
    });
    $('previewVideo').addEventListener('error',function(){
      if($('previewModal').classList.contains('hidden'))return;
      var next=previewSourceIndex+1;
      if(next<previewSources.length){
        setPlaybackState('현재 원본 재생 실패 · 다음 고화질 원본으로 전환합니다.',true);loadPreviewSource(next,true);
      }else setPlaybackState('모든 직접 재생 원본이 실패했습니다: '+playbackErrorText(this)+ ' 원본 페이지에서 파일·CORS·코덱 상태를 확인해 주세요.',true);
    });
    $('seekBar').addEventListener('input',function(){
      var video=$('previewVideo'),duration=Number(video.duration);
      if(isFinite(duration)&&duration>0){
        video.currentTime=(Number(this.value)/1000)*duration;
        $('currentTimeText').textContent=formatPlaybackTime(video.currentTime);
      }
      showFullscreenUi(true);
    });
    $('seekBar').addEventListener('change',function(){syncSeekUi();showFullscreenUi($('previewVideo').paused);});
    $('subtitleSelect').onchange=function(){applySubtitle(this.value);};
    $('subtitleToggle').onclick=function(){
      var tracks=$('previewVideo').textTracks;
      if(!tracks||!tracks.length)return;
      var visible=tracks[0].mode!=='showing';
      Array.from(tracks).forEach(function(track){track.mode=visible?'showing':'disabled';});
      this.textContent=visible?'자막 끄기':'자막 켜기';
    };
    $('fullscreenBtn').onclick=function(){
      var shell=document.querySelector('.player-shell');
      if(document.fullscreenElement)document.exitFullscreen();
      else if(shell.requestFullscreen)shell.requestFullscreen();
    };
    var shell=document.querySelector('.player-shell');
    shell.addEventListener('pointermove',function(){if(document.fullscreenElement===shell)showFullscreenUi(false);});
    shell.addEventListener('pointerdown',function(){if(document.fullscreenElement===shell)showFullscreenUi(true);});
    document.addEventListener('pointermove',function(event){
      if(document.fullscreenElement!==shell)return;
      if(event.clientY<130||event.clientY>window.innerHeight-220)showFullscreenUi(false);
    });
    shell.addEventListener('touchstart',function(){showFullscreenUi(true);},{passive:true});
    document.addEventListener('fullscreenchange',function(){
      if(document.fullscreenElement===shell){
        shell.classList.add('controls-visible');showFullscreenUi(true);$('fullscreenBtn').textContent='전체화면 종료';
      }else{
        clearTimeout(fullscreenUiTimer);shell.classList.remove('controls-visible');$('fullscreenBtn').textContent='전체화면';
      }
    });
    document.addEventListener('keydown',function(event){
      if(event.key==='Escape'&&!document.fullscreenElement&&!$('previewModal').classList.contains('hidden'))closePreview();
    });
    refresh();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
