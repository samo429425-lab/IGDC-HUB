/* IGDC Media Candidate Queue v3.0 - section accordion, thumbnail cards and quality diagnostics */
(function(){
  'use strict';

  var END='/.netlify/functions/media-candidate-review';
  var COL='/.netlify/functions/sanmaru-media-collector';
  var ACT='/.netlify/functions/media-candidate-action';
  var AUTO='/.netlify/functions/media-candidate-auto-curate';
  var PUB='/.netlify/functions/media-snapshot-publish';
  var THUMB='/.netlify/functions/media-candidate-thumbnail';
  var SECTION_ORDER=['media-trending','media-movie','media-drama','media-thriller','media-romance','media-variety','media-documentary','media-animation','media-music','media-shorts'];
  var SECTION_LABELS={
    'media-trending':'지금 뜨는 콘텐츠','media-movie':'영화','media-drama':'드라마·TV',
    'media-thriller':'스릴러·미스터리','media-romance':'로맨스','media-variety':'버라이어티·토크',
    'media-documentary':'다큐멘터리','media-animation':'애니메이션','media-music':'음악·공연','media-shorts':'쇼츠·단편'
  };
  var SECTION_CAPACITY={'media-music':50,'media-shorts':50};

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
  var openSectionKey='';
  var selectedBySection={};

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
  function sortRows(rows){
    var sort=$('sortSelect').value;
    return rows.slice().sort(function(left,right){
      if(sort==='quality')return qualityValue(right.qualityTarget)-qualityValue(left.qualityTarget)||rowRank(right)-rowRank(left);
      if(sort==='year')return Number(right.year||0)-Number(left.year||0)||rowRank(right)-rowRank(left);
      if(sort==='subtitle')return Number(right.subtitleCount||0)-Number(left.subtitleCount||0)||rowRank(right)-rowRank(left);
      if(sort==='title')return text(left.title).localeCompare(text(right.title));
      return rowRank(right)-rowRank(left)||qualityValue(right.qualityTarget)-qualityValue(left.qualityTarget)||Number(right.year||0)-Number(left.year||0);
    });
  }
  function visibleRows(){
    var query=lower($('searchInput').value);
    var risk=text($('riskFilter').value);
    var safety=text($('safetyFilter').value);
    var status=text($('statusFilter').value);
    var rows=activeRows().filter(function(row){
      if(risk&&text(row.riskLevel)!==risk)return false;
      if(safety&&text(row.safetyDecision)!==safety)return false;
      if(status&&text(row.verificationStatus)!==status)return false;
      if(!query)return true;
      return[
        row.title,row.provider,row.sectionKey,row.year,row.qualityTarget,row.rankingTier,
        row.ageRating,row.safetyDecision,(row.policyReasons||[]).join(' '),(row.subtitleLanguages||[]).join(' ')
      ].map(text).join(' ').toLowerCase().indexOf(query)>=0;
    });
    return sortRows(rows);
  }
  function pill(value,className){return '<span class="pill '+(className||'')+'">'+esc(value||'-')+'</span>';}
  function sectionRows(key,rows){
    if(key!=='media-trending')return rows.filter(function(row){return text(row.sectionKey)===key;});
    var sources=new Set(['media-movie','media-drama','media-variety','media-music']);
    return rows.filter(function(row){return sources.has(text(row.sectionKey));}).sort(function(left,right){
      var leftScore=rowRank(left)+(Number(left.year||0)>=2024?8:0);
      var rightScore=rowRank(right)+(Number(right.year||0)>=2024?8:0);
      return rightScore-leftScore;
    }).slice(0,50);
  }
  function durationLabel(seconds){
    seconds=Number(seconds);
    if(!isFinite(seconds)||seconds<=0)return'길이 미확인';
    if(seconds<3600)return Math.round(seconds/60)+'분';
    return Math.floor(seconds/3600)+'시간 '+Math.round((seconds%3600)/60)+'분';
  }
  function candidateCardHtml(row,sectionKey,readOnly){
    var id=text(row.contentId||row.id);
    var languages=Array.isArray(row.subtitleLanguages)?row.subtitleLanguages:[];
    var warnings=Array.isArray(row.contentWarnings)?row.contentWarnings:[];
    var reasons=Array.isArray(row.policyReasons)?row.policyReasons:[];
    var safety=lower(row.safetyDecision);
    var safetyClass=safety==='hard_block'?'blocked':safety==='quarantine'?'quarantine':'';
    var selected=selectedBySection[sectionKey]&&selectedBySection[sectionKey].has(id);
    var probe=row.playbackProbe||{};
    var latency=Number(probe.latencyMs||0);
    var thumb=safeWebUrl(row.thumb);
    return '<article class="candidate-card'+(selected?' selected':'')+'" data-candidate-id="'+esc(id)+'">'+
      (readOnly?'':'<input class="candidate-card-check" type="checkbox" data-section-key="'+esc(sectionKey)+'" data-candidate-id="'+esc(id)+'" '+(selected?'checked':'')+' aria-label="후보 선택">')+
      '<button type="button" class="candidate-thumb-button previewBtn" data-candidate-id="'+esc(id)+'">'+
        (thumb?'<img class="candidate-thumb-image" src="'+esc(thumb)+'" alt="'+esc(row.title||'후보 썸네일')+'" loading="lazy">':'<span class="candidate-thumb-fallback">썸네일 생성 필요</span>')+
        '<span class="candidate-duration">'+esc(durationLabel(row.durationSeconds))+'</span>'+
      '</button>'+
      '<div class="candidate-card-body">'+
        '<div class="candidate-card-title">'+esc(row.title||'(제목 없음)')+'</div>'+
        '<div class="candidate-card-meta">'+pill(row.qualityTarget||'화질 미확인','rank')+pill((row.rankingTier||'-')+' '+rowRank(row),'rank')+pill(row.safetyDecision||'검토 필요',safetyClass)+'</div>'+
        '<div class="candidate-card-detail">'+esc(row.provider||'-')+' · '+esc(row.year||'연도 미확인')+' · 자막 '+esc(row.subtitleCount||0)+'개<br>'+
        '분류 '+esc(row.classificationConfidence||0)+'% · '+esc(row.reviewStatus||'-')+
        (latency?' · 응답 '+esc(latency)+'ms':' · 응답속도 미확인')+
        (languages.length?'<br>자막 '+esc(languages.join(' · ')):'')+
        (warnings.length||reasons.length?'<br>'+esc(warnings.concat(reasons).slice(0,3).join(' · ')):'')+
        '</div>'+
        '<div class="candidate-card-footer"><button type="button" class="previewBtn" data-candidate-id="'+esc(id)+'">점검 재생</button>'+
        (!thumb&&!readOnly?'<button type="button" class="secondary thumbnailGenerateBtn" data-candidate-id="'+esc(id)+'">썸네일 생성</button>':'')+
        '</div>'+
      '</div></article>';
  }
  function sectionBodyHtml(key,list){
    var readOnly=key==='media-trending';
    var controls=readOnly?
      '<div class="read-only-note">지금 뜨는 콘텐츠는 영화·드라마·버라이어티·음악 후보의 최신성·랭킹을 자동 조합한 점검용 미리보기입니다. 수동 고정이나 일괄 상태 변경은 하지 않습니다.</div>':
      '<div class="section-actionbar" data-section-key="'+esc(key)+'">'+
        '<button type="button" class="secondary sectionSelectAllBtn">전체 선택</button><button type="button" class="secondary sectionClearSelectionBtn">선택 해제</button>'+
        '<button type="button" class="sectionActionBtn" data-action="approve">선택 승인</button><button type="button" class="sectionActionBtn" data-action="hold">선택 보류</button><button type="button" class="sectionActionBtn" data-action="reset">선택 재검토</button>'+
        '<button type="button" class="danger sectionActionBtn" data-action="reject">선택 반려</button><button type="button" class="danger sectionActionBtn" data-action="block">선택 영구 차단</button><button type="button" class="danger sectionActionBtn" data-action="delete">선택 삭제→검색 제외</button>'+
        '<input class="section-note" placeholder="관리 메모(선택, 승인 시 필수)" maxlength="1000">'+
        '<div class="section-confirmations"><label><input class="sectionContentConfirm" type="checkbox"> 실제 재생·콘텐츠 안전 확인</label><label><input class="sectionRightsConfirm" type="checkbox"> 원본·권리 확인</label><label><input class="sectionSubtitleConfirm" type="checkbox"> 자막 확인</label></div>'+
      '</div>';
    return controls+(list.length?'<div class="candidate-card-grid">'+list.map(function(row){return candidateCardHtml(row,key,readOnly);}).join('')+'</div>':'<div class="empty-section">현재 조건에 맞는 후보가 없습니다.</div>');
  }
  function renderRows(){
    var rows=visibleRows();
    var html=SECTION_ORDER.map(function(key){
      var list=sectionRows(key,rows);
      var open=key===openSectionKey;
      var capacity=key==='media-trending'?50:(SECTION_CAPACITY[key]||100);
      return '<section class="candidate-section'+(open?' open':'')+'" data-section-key="'+esc(key)+'">'+
        '<button type="button" class="section-toggle" data-section-key="'+esc(key)+'" aria-expanded="'+(open?'true':'false')+'"><span class="section-toggle-main"><span class="section-toggle-title">'+esc(SECTION_LABELS[key]||key)+'</span><span class="section-count">'+list.length+' / '+capacity+'</span></span><span class="section-chevron">⌄</span></button>'+
        (open?'<div class="section-body">'+sectionBodyHtml(key,list)+'</div>':'')+
      '</section>';
    }).join('');
    $('sectionAccordion').innerHTML=html;
    $('filterState').textContent='검색 조건 일치 '+rows.length+'개 / 전체 활성 후보 '+activeRows().length+'개 · 펼친 섹션만 썸네일 로드';
    $('candidateCapacityState').textContent='일반 100개 · 음악/쇼츠 50개 · 전체 최대 900개';
    $('tablePanel').classList.remove('hidden');
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
      var available=new Set(rowsCache.map(function(row){return text(row.contentId||row.id);}));
      Object.keys(selectedBySection).forEach(function(key){
        selectedBySection[key]=new Set(Array.from(selectedBySection[key]||[]).filter(function(id){return available.has(id);}));
      });
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
      if(typeof $('diagnosticPanel').scrollIntoView==='function')$('diagnosticPanel').scrollIntoView({behavior:'smooth',block:'start'});
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
    var collectionSections=SECTION_ORDER.filter(function(key){return key!=='media-trending';});
    var total=0;
    collectAllRunning=true;collectorStopRequested=false;
    $('collectBtn').disabled=true;$('collectAllBtn').disabled=true;$('collectAdminExceptionBtn').disabled=true;$('collectorStopBtn').disabled=false;
    try{
      for(var index=0;index<collectionSections.length&&!collectorStopRequested;index+=1){
        $('collectorSection').value=collectionSections[index];
        $('collectorState').textContent='전체 수집 '+(index+1)+'/9 · '+collectionSections[index];
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
  async function candidateAction(action,ids,sectionElement){
    if(!ids.length){show('처리할 후보를 선택해 주세요.','warn');return;}
    var noteInput=sectionElement&&sectionElement.querySelector('.section-note');
    var note=text(noteInput&&noteInput.value);
    var rightsConfirm=sectionElement&&sectionElement.querySelector('.sectionRightsConfirm');
    var contentConfirm=sectionElement&&sectionElement.querySelector('.sectionContentConfirm');
    var subtitleConfirm=sectionElement&&sectionElement.querySelector('.sectionSubtitleConfirm');
    if(action==='approve'&&(!rightsConfirm||!rightsConfirm.checked||!contentConfirm||!contentConfirm.checked)){
      show('승인 전 콘텐츠 안전과 원본 권리를 각각 확인해 주세요.','warn');return;
    }
    if(action==='approve'&&note.length<3){
      show('공개 승인에는 3자 이상의 검토 메모가 필요합니다.','warn');return;
    }
    var labels={approve:'승인',hold:'보류',reset:'재검토',reject:'반려',block:'영구 차단'};
    if((action==='reject'||action==='block')&&!window.confirm((labels[action]||action)+' 처리할까요? 관리 메모는 선택사항입니다.'))return;
    try{
      var data=await post(ACT,{
        action:action,ids:ids,note:note,
        confirmRightsSafe:action==='approve'&&rightsConfirm.checked,
        confirmContentSafe:action==='approve'&&contentConfirm.checked,
        confirmSubtitlesChecked:action==='approve'&&subtitleConfirm&&subtitleConfirm.checked
      });
      show((labels[action]||action)+' 처리 '+Number(data.updated||0)+'건 완료','ok');
      var sectionKey=sectionElement&&sectionElement.dataset.sectionKey;
      if(sectionKey)selectedBySection[sectionKey]=new Set();
      await refresh();
    }catch(error){show(error.message,'warn');}
  }
  async function removeCandidates(ids,note,sectionKey){
    if(!ids.length){show('삭제할 후보가 없습니다.','warn');return;}
    var message='선택한 '+ids.length+'개 후보를 이 섹션의 목록에서 삭제해 검색 제외로 이동할까요? 원본 영상은 삭제되지 않습니다.';
    if(!window.confirm(message))return;
    try{
      var data=await post(ACT,{action:'delete',ids:ids,note:text(note),confirmQueueDelete:true});
      show('후보 목록에서 '+Number(data.updated||0)+'건을 검색 제외 목록으로 이동했습니다.','ok');
      if(sectionKey)selectedBySection[sectionKey]=new Set();
      await refresh();
    }catch(error){show(error.message,'warn');}
  }
  function exportAllCandidates(){
    var active=sortRows(activeRows());
    var sections={};
    SECTION_ORDER.forEach(function(key){
      var list=sectionRows(key,active);
      sections[key]={
        label:SECTION_LABELS[key]||key,
        automatic:key==='media-trending',
        capacity:key==='media-trending'?50:(SECTION_CAPACITY[key]||100),
        count:list.length,
        items:list
      };
    });
    var excluded=exclusionRows();
    download(JSON.stringify({
      ok:true,
      reportType:'igdc-media-candidate-all-sections',
      generatedAt:new Date().toISOString(),
      activeCandidateCount:active.length,
      excludedRecordCount:excluded.length,
      sectionOrder:SECTION_ORDER,
      sections:sections,
      searchExclusionAndPermanentBlocks:excluded
    },null,2)+'\n','igdc-media-candidate-all-10-sections.json');
  }
  function captureFrameDataUrl(row){
    return new Promise(function(resolve,reject){
      var sources=candidateSources(row);
      if(!sources.length){reject(new Error('직접 재생 주소가 없어 영상 프레임을 만들 수 없습니다.'));return;}
      var video=document.createElement('video');
      var sourceIndex=0,finished=false,drawn=false;
      var timer=setTimeout(function(){finishError(new Error('영상 프레임 준비 시간이 15초를 초과했습니다.'));},15000);
      function cleanup(){clearTimeout(timer);try{video.pause();video.removeAttribute('src');video.load();video.remove();}catch(_error){}}
      function finishError(error){if(finished)return;finished=true;cleanup();reject(error);}
      function draw(){
        if(finished||drawn||!video.videoWidth||!video.videoHeight)return;
        drawn=true;
        try{
          var width=640,height=360,canvas=document.createElement('canvas'),context=canvas.getContext('2d');
          canvas.width=width;canvas.height=height;
          context.fillStyle='#000';context.fillRect(0,0,width,height);
          var ratio=Math.min(width/(video.videoWidth||width),height/(video.videoHeight||height));
          var drawWidth=(video.videoWidth||width)*ratio,drawHeight=(video.videoHeight||height)*ratio;
          context.drawImage(video,(width-drawWidth)/2,(height-drawHeight)/2,drawWidth,drawHeight);
          var dataUrl=canvas.toDataURL('image/jpeg',0.84);
          finished=true;cleanup();resolve(dataUrl);
        }catch(error){finishError(new Error('브라우저 보안 또는 코덱 문제로 프레임을 캡처하지 못했습니다: '+error.message));}
      }
      function loadSource(){
        if(sourceIndex>=sources.length){
          finishError(new Error('모든 직접 재생 원본에서 썸네일 프레임을 만들지 못했습니다.'));
          return;
        }
        drawn=false;
        video.pause();video.removeAttribute('src');video.load();
        video.src=sources[sourceIndex].url;video.load();
      }
      video.crossOrigin='anonymous';video.muted=true;video.playsInline=true;video.preload='auto';
      video.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';
      video.onerror=function(){sourceIndex+=1;loadSource();};
      video.onloadedmetadata=function(){
        var duration=Number(video.duration),target=isFinite(duration)&&duration>2?Math.min(Math.max(duration*.12,3),Math.min(45,duration-1)):0;
        if(target>0){video.currentTime=target;}else draw();
      };
      video.onseeked=draw;video.onloadeddata=draw;video.oncanplay=draw;
      document.body.appendChild(video);loadSource();
    });
  }
  async function generateThumbnail(id,button){
    var row=rowsCache.find(function(item){return text(item.contentId||item.id)===id;});
    if(!row)return;
    button.disabled=true;
    try{
      show('원본 썸네일과 영상 프레임을 확인하고 있습니다.','ok');
      var resolved=await post(THUMB,{action:'resolve',id:id});
      if(resolved.thumbUrl){show('원본 제공 썸네일을 후보에 연결했습니다.','ok');await refresh();return;}
      var dataUrl=await captureFrameDataUrl(row);
      var stored=await post(THUMB,{action:'store_capture',id:id,dataUrl:dataUrl});
      show(stored.thumbUrl?'영상 프레임 썸네일을 생성해 저장했습니다.':'썸네일 생성 결과를 저장하지 못했습니다.',stored.thumbUrl?'ok':'warn');
      await refresh();
    }catch(error){show(error.message,'warn');}
    finally{button.disabled=false;}
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
  async function autoCurateAll(){
    if(!window.confirm('현재 대기열의 미승인 후보를 AI로 다시 분류·품질 점검할까요?\n\nAI는 섹션 정리와 격리 신호만 적용하며 승인·공개·영구 차단은 실행하지 않습니다.'))return;
    var button=$('autoCurateBtn'),frontButton=$('publishFrontBtn');
    button.disabled=true;frontButton.disabled=true;
    var cursor=0,batches=0,total={scanned:0,processed:0,updated:0,moved:0,quarantined:0};
    try{
      while(batches<100){
        batches+=1;
        $('collectorState').textContent='AI 후보 정리 '+batches+'차 처리 중';
        var data=await post(AUTO,{cursor:cursor,batchSize:15});
        ['scanned','processed','updated','moved','quarantined'].forEach(function(key){
          total[key]+=Number(data[key]||0);
        });
        $('collectorState').textContent='AI 정리 · 점검 '+total.scanned+' · 적용 '+total.updated+' · 섹션 이동 '+total.moved+' · 격리 '+total.quarantined;
        if(data.done)break;
        var next=Number(data.nextCursor);
        if(!isFinite(next)||next<=cursor)throw new Error('AI 후보 정리 진행 위치가 갱신되지 않았습니다.');
        cursor=next;
        await wait(120);
      }
      if(batches>=100)throw new Error('AI 후보 정리가 안전 처리 한도에서 중지되었습니다.');
      await refresh();
      show('AI 전자동 후보 정리 완료 · 점검 '+total.scanned+'건 · 적용 '+total.updated+'건 · 섹션 이동 '+total.moved+'건 · 관리자 격리 '+total.quarantined+'건','ok');
    }catch(error){
      show('AI 전자동 후보 정리 중지: '+error.message,'warn');
    }finally{
      button.disabled=false;frontButton.disabled=false;
    }
  }
  function frontPublishReason(value){
    return({
      release_gate_not_armed:'프론트 공개 게이트가 활성화되지 않았습니다.',
      build_hook_not_configured:'Netlify 미디어 배포 훅이 설정되지 않았습니다.',
      build_hook_invalid:'Netlify 미디어 배포 훅 주소가 올바르지 않습니다.',
      build_hook_timeout:'Netlify 배포 요청 시간이 초과되었습니다.',
      build_hook_request_failed:'Netlify 배포 요청에 실패했습니다.'
    })[text(value)]||text(value)||'프론트 배포가 시작되지 않았습니다.';
  }
  async function publishFront(){
    if(!window.confirm('승인·권리확인·공개검증을 모두 통과한 후보만 새 미디어 스냅샷으로 만들고 프론트 배포를 실행할까요?\n\n후보·시드·미검증·격리 항목은 공개되지 않습니다.'))return;
    var button=$('publishFrontBtn'),autoButton=$('autoCurateBtn');
    button.disabled=true;autoButton.disabled=true;
    try{
      button.textContent='프론트 반영 요청 중';
      var data=await post(PUB,{storeRelease:true,publishFront:true,includeSnapshot:'0',includeBlocked:'1'});
      var dispatch=data.frontPublication||{};
      if(data.releaseStored===true&&dispatch.queued===true){
        show('프론트 미디어 허브 반영 배포를 시작했습니다. 공개 가능 '+Number(data.eligibleRows||0)+'건 · 정책 차단 '+Number(data.policyBlockedRows||0)+'건','ok');
      }else{
        show('공개 스냅샷 릴리스는 저장됐지만 프론트 배포는 시작되지 않았습니다: '+frontPublishReason(dispatch.reason),'warn');
      }
    }catch(error){
      show('프론트 미디어 허브 반영 실패: '+error.message,'warn');
    }finally{
      button.textContent='프론트 미디어 허브 반영 실행';
      button.disabled=false;autoButton.disabled=false;
    }
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
    $('downloadAllCandidateListBtn').onclick=exportAllCandidates;
    $('returnBtn').onclick=function(){location.href='/admin.html';};
    $('collectBtn').onclick=function(){collect(false,false);};
    $('collectAllBtn').onclick=collectAll;
    $('autoCurateBtn').onclick=autoCurateAll;
    $('publishFrontBtn').onclick=publishFront;
    $('collectorStopBtn').onclick=function(){
      collectorStopRequested=true;this.disabled=true;$('collectorState').textContent='현재 묶음 후 일시정지';
    };
    $('collectAdminExceptionBtn').onclick=function(){collect(true,false);};
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

    ['searchInput','riskFilter','safetyFilter','statusFilter','sortSelect'].forEach(function(id){
      $(id).addEventListener('input',renderRows);$(id).addEventListener('change',renderRows);
    });
    $('collectorSection').addEventListener('change',function(){renderSummary(summaryCache);});
    $('selectAllExcluded').onchange=function(){
      var checked=this.checked;document.querySelectorAll('.excludedCheck').forEach(function(element){element.checked=checked;});
    };
    $('sectionAccordion').addEventListener('click',function(event){
      var toggle=event.target.closest('.section-toggle');
      if(toggle){
        var key=text(toggle.dataset.sectionKey);
        openSectionKey=openSectionKey===key?'':key;
        renderRows();
        return;
      }
      var preview=event.target.closest('.previewBtn');
      if(preview){openPreview(text(preview.dataset.candidateId));return;}
      var thumbnail=event.target.closest('.thumbnailGenerateBtn');
      if(thumbnail){generateThumbnail(text(thumbnail.dataset.candidateId),thumbnail);return;}
      var section=event.target.closest('.candidate-section');
      if(!section)return;
      var sectionKey=text(section.dataset.sectionKey);
      var selected=selectedBySection[sectionKey]||(selectedBySection[sectionKey]=new Set());
      if(event.target.closest('.sectionSelectAllBtn')){
        sectionRows(sectionKey,visibleRows()).forEach(function(row){selected.add(text(row.contentId||row.id));});
        renderRows();return;
      }
      if(event.target.closest('.sectionClearSelectionBtn')){selected.clear();renderRows();return;}
      var actionButton=event.target.closest('.sectionActionBtn');
      if(actionButton){
        var action=text(actionButton.dataset.action);
        var ids=Array.from(selected);
        var noteInput=section.querySelector('.section-note');
        if(action==='delete')removeCandidates(ids,text(noteInput&&noteInput.value),sectionKey);
        else candidateAction(action,ids,section);
      }
    });
    $('sectionAccordion').addEventListener('change',function(event){
      var checkbox=event.target.closest('.candidate-card-check');
      if(!checkbox)return;
      var sectionKey=text(checkbox.dataset.sectionKey),id=text(checkbox.dataset.candidateId);
      var selected=selectedBySection[sectionKey]||(selectedBySection[sectionKey]=new Set());
      if(checkbox.checked)selected.add(id);else selected.delete(id);
      var cardElement=checkbox.closest('.candidate-card');
      if(cardElement)cardElement.classList.toggle('selected',checkbox.checked);
    });
    $('sectionAccordion').addEventListener('error',function(event){
      if(!event.target.classList||!event.target.classList.contains('candidate-thumb-image'))return;
      var parent=event.target.parentNode;
      if(parent){
        var cardElement=event.target.closest('.candidate-card'),id=cardElement&&text(cardElement.dataset.candidateId);
        event.target.remove();
        var fallback=document.createElement('span');fallback.className='candidate-thumb-fallback';fallback.textContent='썸네일 불러오기 실패';
        parent.insertBefore(fallback,parent.firstChild);
        var footer=cardElement&&cardElement.querySelector('.candidate-card-footer');
        if(footer&&id&&!footer.querySelector('.thumbnailGenerateBtn')){
          var button=document.createElement('button');
          button.type='button';button.className='secondary thumbnailGenerateBtn';
          button.dataset.candidateId=id;button.textContent='썸네일 다시 만들기';footer.appendChild(button);
        }
      }
    },true);
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
