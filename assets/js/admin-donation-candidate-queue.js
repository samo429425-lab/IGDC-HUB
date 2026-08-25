(function(){
  'use strict';

  var ENDPOINT='/.netlify/functions/donation-candidate-admin';
  var rows=[],sections=[],stage='all',selected=new Set(),busy=false,policyBusy=false,policyWorkspace=null,recognition=null;
  var STAGES=[['all','전체'],['research','리서치'],['queue','대기열'],['front_candidate','프론트 후보'],['published','프론트 매칭'],['hold','보류'],['excluded','제외']];

  function $(id){return document.getElementById(id)}
  function text(v){return String(v==null?'':v).trim()}
  function esc(v){return text(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
  function parse(v){try{return JSON.parse(v)}catch(_e){return null}}
  function freshJwt(v){v=text(v);if(!v||v.split('.').length!==3)return false;try{var p=v.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');p+='='.repeat((4-p.length%4)%4);var j=JSON.parse(atob(p));return !j.exp||Number(j.exp)>Date.now()/1000+10}catch(_e){return false}}
  function pushToken(v,out,seen,depth){if(depth>5||v==null)return;if(typeof v==='string'){var t=text(v);if(freshJwt(t)&&!seen[t]){seen[t]=1;out.push(t);return}var j=parse(v);if(j)pushToken(j,out,seen,depth+1);return}if(Array.isArray(v)){v.forEach(function(x){pushToken(x,out,seen,depth+1)});return}if(typeof v==='object'){['id_token','idToken','access_token','accessToken','token','jwt','bearer','authorization','Authorization','__raw','raw'].forEach(function(k){pushToken(v[k],out,seen,depth+1)})}}
  function scan(store,out,seen){if(!store)return;var keys=['igdc.donationCandidateQueue.adminBearer','igdc.socialCandidateQueue.adminBearer','igdc.mediaCandidateQueue.adminBearer','osauth.tokens.v2','osauth.tokens.v1','igdc.auth.tokens','igdc.tokens','igdc_auth_tokens','member_auth_tokens','auth0_tokens','auth0spa','igdc_id_token','id_token','auth0_id_token','igdc_access_token','access_token'];keys.forEach(function(k){try{pushToken(store.getItem(k),out,seen,0)}catch(_e){}});try{for(var i=0;i<Math.min(store.length||0,250);i++){var k=store.key(i)||'';if(/auth0|osauth|igdc|token/i.test(k))pushToken(store.getItem(k),out,seen,0)}}catch(_e){}}
  function bearer(){var out=[],seen={};try{if(window.IGDCMemberAuth&&typeof window.IGDCMemberAuth.getIdToken==='function')pushToken(window.IGDCMemberAuth.getIdToken(),out,seen,0)}catch(_e){}try{if(window.osAuth&&typeof window.osAuth.getIdToken==='function')pushToken(window.osAuth.getIdToken(),out,seen,0)}catch(_e){}try{scan(localStorage,out,seen);scan(sessionStorage,out,seen)}catch(_e){}if(out[0]){try{sessionStorage.setItem('igdc.donationCandidateQueue.adminBearer',out[0]);localStorage.setItem('igdc.donationCandidateQueue.adminBearer',out[0])}catch(_e){}}return out[0]||''}
  async function api(method,body){var h={'Content-Type':'application/json'},t=bearer();if(t)h.Authorization='Bearer '+t;var r=await fetch(ENDPOINT,{method:method,headers:h,cache:'no-store',body:body?JSON.stringify(body):undefined});var raw=await r.text(),j=parse(raw)||{error:raw};if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));return j}

  function setBusy(v,msg){busy=v;document.body.classList.toggle('busy',v);if(msg&&$('state'))$('state').textContent=msg;document.querySelectorAll('.toolbar button,.actionbar button,.section-actions button,.card-actions button').forEach(function(b){b.disabled=v})}
  function setPolicyBusy(v,msg){policyBusy=v;if(msg&&$('policyState'))$('policyState').textContent=msg;document.querySelectorAll('.policy-console button,.policy-console select,.policy-console textarea').forEach(function(el){el.disabled=v})}
  function stageLabel(s){var hit=STAGES.find(function(x){return x[0]===s});return hit?hit[1]:s}
  function sectionLabel(key){var s=sections.find(function(x){return x.key===key});return s?s.label:key}
  function summaryHtml(sum){var st=(sum&&sum.stages)||{};var cards=[['전체',sum&&sum.total||0],['리서치',st.research||0],['대기열',st.queue||0],['프론트 후보',st.front_candidate||0],['프론트 매칭',st.published||0],['보류',st.hold||0],['제외',st.excluded||0]];return cards.map(function(x){return '<div class="stat"><b>'+x[1]+'</b><span>'+esc(x[0])+'</span></div>'}).join('')}
  function renderTabs(){$('stageTabs').innerHTML=STAGES.map(function(x){return '<button type="button" data-stage="'+x[0]+'" class="'+(stage===x[0]?'active':'')+'">'+esc(x[1])+'</button>'}).join('')}
  function card(row){var id=esc(row.id),img=text(row.thumbnail),issues=Array.isArray(row.issues)?row.issues:[];return '<article class="candidate">'+
    '<div class="thumb">'+(img?'<img src="'+esc(img)+'" loading="lazy" alt="" onerror="this.remove()">':'<span class="fallback">'+esc((row.title||'?').slice(0,1))+'</span>')+(row.mediaKind==='video'?'<span class="video-mark">▶ VIDEO</span>':'')+'</div>'+
    '<div class="candidate-body"><label class="check"><input type="checkbox" data-check="'+id+'" '+(selected.has(row.id)?'checked':'')+'> 선택 · '+esc(stageLabel(row.stage))+'</label><div class="candidate-title">'+esc(row.title)+'</div>'+
    '<div class="candidate-meta">관련도 '+Number(row.relevanceScore||0).toFixed(0)+' · '+esc(sectionLabel(row.section))+(issues.length?' · <span class="issue">'+esc(issues.join(', '))+'</span>':'')+'</div><div class="candidate-summary">'+esc(row.summary||'')+'</div>'+
    (row.url?'<a href="'+esc(row.url)+'" target="_blank" rel="noopener">'+esc(row.url)+'</a>':'')+
    '<div class="card-actions"><button data-one="move_to_queue" data-id="'+id+'">대기열</button><button data-one="move_to_front" data-id="'+id+'">프론트 후보</button><button data-one="publish" data-id="'+id+'">프론트 매칭</button><button data-one="hold" data-id="'+id+'">보류</button><button data-one="exclude" data-id="'+id+'" class="danger">제외</button><button data-one="remove" data-id="'+id+'" class="danger">삭제</button><button data-one="restore" data-id="'+id+'">복구</button></div></div></article>'}
  function visibleRowsFor(sec){return rows.filter(function(r){return r.section===sec&&(stage==='all'||r.stage===stage)})}
  function renderSections(){var html='';sections.forEach(function(sec){var list=visibleRowsFor(sec.key);html+='<section class="section"><div class="section-head"><label class="check"><input type="checkbox" data-section-check="'+esc(sec.key)+'"> 전체</label><h2>'+esc(sec.label)+'</h2><span class="badge">'+list.length+' / '+sec.capacity+'</span></div><div class="section-actions"><button data-section-action="research" data-section="'+esc(sec.key)+'">리서치</button><button data-section-action="ai_front_candidates" data-section="'+esc(sec.key)+'">AI 프론트 후보</button><button data-section-action="ai_auto_match" data-section="'+esc(sec.key)+'">프론트페이지 매칭 실행</button><button data-policy-open="'+esc(sec.key)+'">AI 정책 협의</button></div>'+(list.length?'<div class="grid">'+list.map(card).join('')+'</div>':'<div class="empty">현재 선택 단계에 항목이 없습니다.</div>')+'</section>'});$('sections').innerHTML=html;renderTabs()}

  function populateScopes(){
    if(!$('policyScope'))return;
    var current=$('policyScope').value||'all';
    $('policyScope').innerHTML='<option value="all">도네이션 전체</option>'+sections.map(function(s){return '<option value="'+esc(s.key)+'">'+esc(s.label)+'</option>'}).join('');
    if(Array.from($('policyScope').options).some(function(o){return o.value===current}))$('policyScope').value=current;
  }

  async function load(){
    setBusy(true,'도네이션 후보 원장을 불러오는 중…');
    try{
      var j=await api('GET');
      rows=j.items||[];sections=j.sections||[];
      $('summary').innerHTML=summaryHtml(j.summary);
      if(!$('researchSection').options.length)$('researchSection').innerHTML=sections.map(function(s){return '<option value="'+esc(s.key)+'">'+esc(s.label)+'</option>'}).join('');
      populateScopes();
      selected=new Set(Array.from(selected).filter(function(id){return rows.some(function(r){return r.id===id})}));
      renderSections();
      $('state').textContent='도네이션 전용 원장 '+rows.length+'개 · 마지막 조회 '+new Date().toLocaleTimeString();
    }catch(e){$('state').textContent='오류: '+e.message}
    finally{setBusy(false)}
  }

  async function act(action,ids,section){
    if(busy)return;
    var payload={action:action};if(ids)payload.ids=ids;if(section)payload.section=section;
    if(action==='publish'||action==='ai_auto_match'){if(!confirm('선택 범위를 실제 도네이션 프론트 매칭 상태로 확정할까요?'))return}
    setBusy(true,'처리 중…');
    try{await api('POST',payload);selected.clear();await load()}catch(e){$('state').textContent='오류: '+e.message;setBusy(false)}
  }
  async function research(section,all){
    if(busy)return;
    var q=all?'':text($('researchQuery').value);
    setBusy(true,all?'8개 섹션 기본 리서치 중…':'리서치 중…');
    try{await api('POST',{action:'research',section:all?'all':section,query:q,limit:50});await load()}catch(e){$('state').textContent='리서치 오류: '+e.message;setBusy(false)}
  }

  function policyScope(){return text($('policyScope')&&$('policyScope').value)||'all'}
  function policyLanguage(){return text($('policyLanguage')&&$('policyLanguage').value)||'auto'}
  function destinationLabel(v){return v==='front'?'프론트페이지 매칭':v==='front_candidate'?'프론트 후보':'관리페이지 리서치'}
  function renderPolicy(workspace){
    policyWorkspace=workspace||null;
    var messages=(workspace&&workspace.messages)||[],agendas=(workspace&&workspace.agendas)||[];
    if($('policyTranscript'))$('policyTranscript').innerHTML=messages.length?messages.map(function(m){var role=m.role==='assistant'?'assistant':m.role==='user'?'user':'system';var label=role==='assistant'?'AI':role==='user'?'관리자':'시스템';return '<div class="policy-message '+role+'"><b>'+label+'</b> · '+esc(m.content)+'</div>'}).join(''):'<div class="empty">저장된 협의 내용이 없습니다.</div>';
    if($('policyAgendas'))$('policyAgendas').innerHTML=agendas.length?agendas.slice().reverse().map(function(a){
      var terms=(a.includeTerms||[]).slice(0,8).join(', '),avoid=(a.avoidTerms||[]).slice(0,6).join(', ');
      return '<article class="agenda" data-agenda-id="'+esc(a.id)+'"><h3>'+esc(a.title||'AI 정책 안건')+'</h3><div class="meta">'+esc(sectionLabel(a.scope)||a.scope)+' · AI 제안: '+esc(destinationLabel(a.destination))+' · 신뢰 '+Number(a.confidence||0).toFixed(0)+'</div><p>'+esc(a.summary||'')+'</p><code>'+esc(a.researchQuery||'')+'</code>'+(terms?'<p><b>우선:</b> '+esc(terms)+'</p>':'')+(avoid?'<p><b>제외:</b> '+esc(avoid)+'</p>':'')+'<div class="agenda-actions"><button data-policy-execute="admin" data-agenda="'+esc(a.id)+'">관리페이지 리서치 실행</button><button data-policy-execute="front_candidate" data-agenda="'+esc(a.id)+'">프론트 후보 실행</button><button class="good" data-policy-execute="front" data-agenda="'+esc(a.id)+'">프론트페이지 매칭 실행</button><button class="danger" data-policy-delete="'+esc(a.id)+'">안건 삭제</button></div></article>';
    }).join(''):'<div class="empty">AI 협의를 저장하면 안건별 실행 버튼이 생성됩니다.</div>';
  }
  function latestAssistantText(workspace){
    var list=(workspace&&workspace.messages)||[];
    for(var i=list.length-1;i>=0;i--){if(list[i]&&list[i].role==='assistant')return text(list[i].content)}
    return '';
  }
  function speakAnswer(value){
    if(!$('policySpeakAnswer')||!$('policySpeakAnswer').checked||!value||!window.speechSynthesis)return;
    try{window.speechSynthesis.cancel();var utter=new SpeechSynthesisUtterance(value);var lang=policyLanguage();if(lang==='auto')lang=navigator.language||'ko-KR';utter.lang=lang;window.speechSynthesis.speak(utter)}catch(_e){}
  }
  async function loadPolicy(){
    if(policyBusy)return;
    setPolicyBusy(true,'AI 정책 협의 내용을 불러오는 중…');
    try{var j=await api('POST',{action:'policy_workspace',scope:policyScope()});renderPolicy(j.workspace);$('policyState').textContent=(j.storage&&j.storage.available===false)?'정책 저장소 연결 확인 필요: '+text(j.storage.error):'정책 협의 준비 완료 · '+(j.workspace&&j.workspace.scopeLabel||policyScope())}
    catch(e){$('policyState').textContent='정책 협의 조회 오류: '+e.message}
    finally{setPolicyBusy(false)}
  }
  async function discussPolicy(){
    if(policyBusy)return;
    var instruction=text($('policyInstruction').value);if(!instruction){alert('AI와 협의할 내용을 말씀하거나 입력해 주세요.');return}
    stopVoice();
    setPolicyBusy(true,'AI와 도네이션 운영 방향을 협의 중…');
    try{var j=await api('POST',{action:'policy_ai_discuss',scope:policyScope(),instruction:instruction,language:policyLanguage()});renderPolicy(j.workspace);$('policyState').textContent='AI 협의 안건 저장 완료 · 관리자 실행 전에는 프론트에 반영되지 않습니다.';speakAnswer(latestAssistantText(j.workspace))}
    catch(e){$('policyState').textContent='AI 협의 오류: '+e.message}
    finally{setPolicyBusy(false)}
  }
  async function deleteAgenda(id){
    if(policyBusy||!id)return;if(!confirm('이 정책 협의 안건만 삭제할까요?'))return;
    setPolicyBusy(true,'안건 삭제 중…');
    try{var j=await api('POST',{action:'policy_agenda_delete',scope:policyScope(),agendaId:id});renderPolicy(j.workspace);$('policyState').textContent='선택 안건을 삭제했습니다.'}
    catch(e){$('policyState').textContent='안건 삭제 오류: '+e.message}
    finally{setPolicyBusy(false)}
  }
  async function clearPolicy(){
    if(policyBusy)return;if(!confirm('현재 협의 범위의 저장된 안건과 대화 기록을 모두 삭제할까요?'))return;
    setPolicyBusy(true,'협의 기록 삭제 중…');
    try{var j=await api('POST',{action:'policy_workspace_clear',scope:policyScope()});renderPolicy(j.workspace);$('policyState').textContent='현재 범위의 협의 기록을 삭제했습니다.'}
    catch(e){$('policyState').textContent='협의 기록 삭제 오류: '+e.message}
    finally{setPolicyBusy(false)}
  }
  async function executeAgenda(id,destination){
    if(policyBusy||!id)return;
    var message=destination==='front'?'이 안건으로 리서치한 뒤 AI가 선별한 유효 후보를 실제 프론트 매칭 상태로 확정할까요?':destination==='front_candidate'?'이 안건으로 리서치하고 프론트 후보 단계까지 자동 선별할까요?':'이 안건으로 리서치하여 관리페이지 후보 원장에 반영할까요?';
    if(!confirm(message))return;
    setPolicyBusy(true,destination==='front'?'리서치 후 프론트페이지 매칭 실행 중…':'정책 안건 실행 중…');
    try{var j=await api('POST',{action:'policy_execute',scope:policyScope(),agendaId:id,destination:destination,limit:80});var r=j.result||{};$('policyState').textContent='실행 완료 · '+destinationLabel(destination)+' · 리서치 저장 '+Number(r.research&&r.research.savedCount||0)+'개';await load()}
    catch(e){$('policyState').textContent='정책 실행 오류: '+e.message}
    finally{setPolicyBusy(false)}
  }

  function stopVoice(){
    if(recognition){try{recognition.stop()}catch(_e){}recognition=null}
    if($('policyVoiceBtn'))$('policyVoiceBtn').classList.remove('voice-on');
    if($('policyVoiceLive'))$('policyVoiceLive').textContent='음성 대기';
  }
  function startVoice(){
    if(policyBusy)return;
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){$('policyVoiceLive').textContent='이 브라우저는 음성 인식을 지원하지 않습니다.';return}
    stopVoice();
    var rec=new SR();recognition=rec;rec.continuous=true;rec.interimResults=true;var lang=policyLanguage();rec.lang=lang==='auto'?(navigator.language||'ko-KR'):lang;
    rec.onstart=function(){$('policyVoiceBtn').classList.add('voice-on');$('policyVoiceLive').textContent='듣는 중… 편하게 말씀하세요.'};
    rec.onresult=function(ev){var interim='',finals='';for(var i=ev.resultIndex;i<ev.results.length;i++){var t=text(ev.results[i][0]&&ev.results[i][0].transcript);if(ev.results[i].isFinal)finals+=(finals?' ':'')+t;else interim+=(interim?' ':'')+t}if(interim)$('policyVoiceLive').textContent='듣는 중: '+interim;if(finals){var box=$('policyInstruction');box.value=(text(box.value)+(text(box.value)?' ':'')+finals).trim();$('policyVoiceLive').textContent='입력됨: '+finals}};
    rec.onerror=function(ev){$('policyVoiceLive').textContent='음성 인식 오류: '+text(ev&&ev.error);stopVoice()};
    rec.onend=function(){if(recognition===rec){recognition=null;$('policyVoiceBtn').classList.remove('voice-on');$('policyVoiceLive').textContent='음성 대기'}};
    try{rec.start()}catch(e){$('policyVoiceLive').textContent='마이크 시작 오류: '+e.message}
  }

  document.addEventListener('click',function(e){
    var b=e.target.closest('button');if(!b)return;
    if(b.dataset.stage){stage=b.dataset.stage;renderSections();return}
    if(b.dataset.one){act(b.dataset.one,[b.dataset.id]);return}
    if(b.dataset.bulk){var ids=Array.from(selected);if(!ids.length){alert('처리할 후보를 선택해 주세요.');return}act(b.dataset.bulk,ids);return}
    if(b.dataset.sectionAction){if(b.dataset.sectionAction==='research')research(b.dataset.section,false);else act(b.dataset.sectionAction,null,b.dataset.section);return}
    if(b.dataset.policyOpen){$('policyScope').value=b.dataset.policyOpen;$('policyInstruction').focus();loadPolicy();try{$('policyTitle').scrollIntoView({behavior:'smooth',block:'start'})}catch(_e){}return}
    if(b.dataset.policyDelete){deleteAgenda(b.dataset.policyDelete);return}
    if(b.dataset.policyExecute){executeAgenda(b.dataset.agenda,b.dataset.policyExecute);return}
  });
  document.addEventListener('change',function(e){var c=e.target;if(c.matches('[data-check]')){if(c.checked)selected.add(c.dataset.check);else selected.delete(c.dataset.check)}if(c.matches('[data-section-check]')){visibleRowsFor(c.dataset.sectionCheck).forEach(function(r){if(c.checked)selected.add(r.id);else selected.delete(r.id)});renderSections()}});

  $('reloadBtn').onclick=function(){load()};
  $('researchBtn').onclick=function(){research($('researchSection').value,false)};
  $('researchAllBtn').onclick=function(){research('all',true)};
  $('selectAllVisibleBtn').onclick=function(){sections.forEach(function(s){visibleRowsFor(s.key).forEach(function(r){selected.add(r.id)})});renderSections()};
  $('aiFrontBtn').onclick=function(){act('ai_front_candidates',null,'all')};
  $('aiPublishBtn').onclick=function(){act('ai_auto_match',null,'all')};
  $('backBtn').onclick=function(){var p=new URLSearchParams(location.search).get('returnPath')||'/admin.html';location.href=p};
  $('policyScope').onchange=function(){loadPolicy()};
  $('policyDiscussBtn').onclick=discussPolicy;
  $('policyReloadBtn').onclick=loadPolicy;
  $('policyClearBtn').onclick=clearPolicy;
  $('policyVoiceBtn').onclick=startVoice;
  $('policyVoiceStopBtn').onclick=stopVoice;
  window.addEventListener('beforeunload',stopVoice);

  load().then(loadPolicy);
})();
