/* IGDC Media AI Policy Dialog v1.0.0
 * Admin policy conversation layer. Policies guide candidate research/curation only.
 * They never write SearchBank/Snapshot/front directly.
 */
(function(){
  'use strict';
  if(window.__IGDC_MEDIA_AI_DIALOG__)return;
  window.__IGDC_MEDIA_AI_DIALOG__=true;

  var ENDPOINT='/.netlify/functions/media-ai-dialog';
  var STORE_KEY='igdc.mediaAiPolicies.v1';
  var CHAT_KEY='igdc.mediaAiChats.v1';
  var SECTION_LABELS={
    'media-trending':'지금 뜨는 콘텐츠','media-movie':'영화','media-drama':'드라마·TV',
    'media-thriller':'스릴러·미스터리','media-romance':'로맨스','media-variety':'버라이어티·토크',
    'media-documentary':'다큐멘터리','media-animation':'애니메이션','media-music':'음악·공연','media-shorts':'쇼츠·단편'
  };
  function text(v){return v==null?'':String(v).trim();}
  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'')||fallback;}catch(_e){return fallback;}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(_e){}}
  function policyId(scope,section){return text(scope||'global')+':'+text(section||'GLOBAL');}
  function policies(){return readJson(STORE_KEY,{});}
  function chats(){return readJson(CHAT_KEY,{});}
  function mergePolicy(a,b){
    a=a&&typeof a==='object'?a:{};b=b&&typeof b==='object'?b:{};
    var out=Object.assign({},a,b);
    ['includeTopics','excludeTopics','preferredContentTraits','blockedContentTraits','notes'].forEach(function(k){
      out[k]=Array.from(new Set([].concat(a[k]||[],b[k]||[]).map(text).filter(Boolean)));
    });
    return out;
  }
  function policyFor(sectionKey,purpose){
    var all=policies(),out=all[policyId('global','')]||{};
    out=mergePolicy(out,all[policyId('sections','')]||{});
    if(sectionKey)out=mergePolicy(out,all[policyId('section',sectionKey)]||{});
    if(purpose)out=mergePolicy(out,all[policyId(purpose,sectionKey)]||all[policyId(purpose,'')]||{});
    out.sectionKey=sectionKey||out.sectionKey||'';
    out.scopeType=purpose||(sectionKey?'section':'global');
    return Object.keys(out).length?out:null;
  }
  function authToken(){
    var direct='';
    try{direct=localStorage.getItem('igdc.mediaCandidateQueue.adminBearer')||sessionStorage.getItem('igdc.mediaCandidateQueue.adminBearer')||'';}catch(_e){}
    if(direct)return direct;
    var keys=['osauth.tokens.v2','osauth.tokens.v1','igdc.tokens','igdc_auth_tokens','auth0_tokens'];
    for(var si=0;si<2;si++){
      var store;try{store=si===0?localStorage:sessionStorage;}catch(_e){continue;}
      for(var i=0;i<keys.length;i++){
        var raw='';try{raw=store.getItem(keys[i])||'';}catch(_e){}
        if(!raw)continue;
        try{var obj=JSON.parse(raw);var tok=obj.access_token||obj.accessToken||obj.id_token||obj.idToken||'';if(tok)return tok;}catch(_e){if(raw.split('.').length===3)return raw;}
      }
    }
    return '';
  }
  async function callAI(body){
    var h={'Content-Type':'application/json','Accept':'application/json'},t=authToken();if(t)h.Authorization='Bearer '+t;
    var r=await fetch(ENDPOINT,{method:'POST',headers:h,credentials:'same-origin',body:JSON.stringify(body)});
    var d={};try{d=await r.json();}catch(_e){}
    if(!r.ok||d.ok!==true)throw new Error(d.message||d.error||('HTTP '+r.status));
    return d;
  }
  function injectStyle(){
    if(document.getElementById('igdc-media-ai-dialog-css'))return;
    var st=document.createElement('style');st.id='igdc-media-ai-dialog-css';
    st.textContent='.media-ai-talk-btn{border-color:#7dd3fc!important;background:#103a5a!important;color:#e0f2fe!important}.media-ai-modal{position:fixed;inset:0;z-index:2147483600;background:rgba(2,6,23,.78);display:none;align-items:center;justify-content:center;padding:16px}.media-ai-modal.open{display:flex}.media-ai-box{width:min(920px,96vw);max-height:92vh;background:#0f172a;border:1px solid #334155;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45)}.media-ai-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#111827;border-bottom:1px solid #334155}.media-ai-head strong{flex:1}.media-ai-transcript{min-height:220px;max-height:48vh;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:9px}.media-ai-msg{padding:9px 11px;border-radius:10px;white-space:pre-wrap;line-height:1.45}.media-ai-msg.user{background:#172554}.media-ai-msg.assistant{background:#13342e}.media-ai-msg.system{background:#3b2f16}.media-ai-compose{padding:12px;border-top:1px solid #334155;display:grid;grid-template-columns:1fr auto;gap:8px}.media-ai-compose textarea{width:100%;min-height:84px;resize:vertical;background:#020617;color:#e5eefb;border:1px solid #475569;border-radius:9px;padding:10px}.media-ai-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center;padding:0 12px 12px}.media-ai-policy{margin:0 12px 12px;padding:10px;background:#020617;border:1px solid #334155;border-radius:9px;max-height:180px;overflow:auto;white-space:pre-wrap;font-size:12px}.media-ai-mic.live{background:#9f1239!important}.media-ai-scope-note{font-size:12px;color:#94a3b8}';
    (document.head||document.documentElement).appendChild(st);
  }
  var current={scopeType:'global',sectionKey:'',label:'미디어 전체',draft:null,lastReply:''},recognition=null;
  function closeDialog(){var m=document.getElementById('mediaAiModal');if(m)m.classList.remove('open');stopListening();}
  function ensureModal(){
    injectStyle();var m=document.getElementById('mediaAiModal');if(m)return m;
    m=document.createElement('div');m.id='mediaAiModal';m.className='media-ai-modal';
    m.innerHTML='<div class="media-ai-box" role="dialog" aria-modal="true"><div class="media-ai-head"><strong id="mediaAiTitle">AI 정책 대화</strong><span id="mediaAiScope" class="media-ai-scope-note"></span><button type="button" id="mediaAiClose" class="secondary">닫기</button></div><div id="mediaAiTranscript" class="media-ai-transcript"></div><div id="mediaAiPolicyPreview" class="media-ai-policy">현재 정책 없음</div><div class="media-ai-compose"><textarea id="mediaAiInput" placeholder="콘텐츠 수집·공급사·품질·후보 교체·섹션 운영 정책을 말하거나 입력하세요."></textarea><button type="button" id="mediaAiSend">보내기</button></div><div class="media-ai-actions"><button type="button" id="mediaAiMic" class="media-ai-mic">🎙 음성 입력</button><button type="button" id="mediaAiSpeak">🔊 답변 읽기</button><button type="button" id="mediaAiApply" class="publish">정책 적용</button><button type="button" id="mediaAiClear" class="secondary">대화 지우기</button><span id="mediaAiState" class="state">대기</span></div></div>';
    document.body.appendChild(m);
    document.getElementById('mediaAiClose').onclick=closeDialog;
    m.addEventListener('click',function(e){if(e.target===m)closeDialog();});
    document.getElementById('mediaAiSend').onclick=sendCurrent;
    document.getElementById('mediaAiApply').onclick=applyDraft;
    document.getElementById('mediaAiClear').onclick=clearCurrent;
    document.getElementById('mediaAiMic').onclick=toggleListening;
    document.getElementById('mediaAiSpeak').onclick=speakLast;
    return m;
  }
  function contextFor(scopeType,sectionKey){
    var root=null;
    if(scopeType==='supplier')root=document.getElementById('supplierPanel');
    if(scopeType==='collector')root=document.getElementById('collectorState')&&document.getElementById('collectorState').closest('section');
    if(scopeType==='pool')root=document.getElementById('candidatePoolPanel');
    if((scopeType==='section'||scopeType==='sections')&&sectionKey)root=document.querySelector('.candidate-section[data-section-key="'+sectionKey.replace(/"/g,'')+'"]');
    if(!root&&scopeType==='sections')root=document.getElementById('tablePanel');
    if(!root)root=document.body;
    var snippets=Array.from(root.querySelectorAll('.candidate-card,.small,.state,.pill,.supplier-table tr,.pool-table tr')).slice(0,60).map(function(el){return text(el.textContent).replace(/\s+/g,' ').slice(0,260);}).filter(Boolean);
    return{scopeType:scopeType,sectionKey:sectionKey||null,visibleContext:snippets,capturedAt:new Date().toISOString()};
  }
  function appendMsg(role,msg){var box=document.getElementById('mediaAiTranscript'),d=document.createElement('div');d.className='media-ai-msg '+role;d.textContent=msg;box.appendChild(d);box.scrollTop=box.scrollHeight;}
  function renderChat(){
    var box=document.getElementById('mediaAiTranscript');box.innerHTML='';
    var key=policyId(current.scopeType,current.sectionKey),history=chats()[key]||[];history.forEach(function(x){appendMsg(x.role,x.text);});
    var p=policies()[key]||policyFor(current.sectionKey,current.scopeType);document.getElementById('mediaAiPolicyPreview').textContent=p?JSON.stringify(p,null,2):'현재 정책 없음';
  }
  function openDialog(scopeType,sectionKey,label){
    current={scopeType:scopeType||'global',sectionKey:sectionKey||'',label:label||'미디어',draft:null,lastReply:''};
    var m=ensureModal();document.getElementById('mediaAiTitle').textContent='AI 정책 대화 · '+current.label;document.getElementById('mediaAiScope').textContent=current.scopeType+(current.sectionKey?' · '+current.sectionKey:'');document.getElementById('mediaAiInput').value='';document.getElementById('mediaAiState').textContent='대기';renderChat();m.classList.add('open');setTimeout(function(){try{document.getElementById('mediaAiInput').focus();}catch(_e){}},0);
  }
  async function sendCurrent(){
    var input=document.getElementById('mediaAiInput'),message=text(input.value);if(!message)return;
    var key=policyId(current.scopeType,current.sectionKey),all=chats(),history=(all[key]||[]).slice(-12);appendMsg('user',message);history.push({role:'user',text:message});all[key]=history;writeJson(CHAT_KEY,all);input.value='';
    var st=document.getElementById('mediaAiState');st.textContent='AI 협의 중';
    try{var d=await callAI({scopeType:current.scopeType,sectionKey:current.sectionKey,message:message,history:history,context:contextFor(current.scopeType,current.sectionKey)});current.draft=d.policyDraft||null;current.lastReply=text(d.reply);appendMsg('assistant',current.lastReply);all=chats();history=(all[key]||[]);history.push({role:'assistant',text:current.lastReply});all[key]=history.slice(-24);writeJson(CHAT_KEY,all);document.getElementById('mediaAiPolicyPreview').textContent=current.draft?JSON.stringify(current.draft,null,2):'정책 초안 없음';st.textContent=d.provider==='configured_ai'?'AI 정책 초안 완료':'로컬 정책 초안 · AI API 미연결';}
    catch(e){appendMsg('system','오류: '+(e.message||e));st.textContent='대화 실패';}
  }
  function applyDraft(){if(!current.draft){document.getElementById('mediaAiState').textContent='적용할 정책 초안이 없습니다';return;}var all=policies(),key=policyId(current.scopeType,current.sectionKey);current.draft.appliedAt=new Date().toISOString();all[key]=current.draft;writeJson(STORE_KEY,all);document.getElementById('mediaAiPolicyPreview').textContent=JSON.stringify(current.draft,null,2);document.getElementById('mediaAiState').textContent='정책 적용됨';window.dispatchEvent(new CustomEvent('igdc:media-ai-policy-applied',{detail:{key:key,policy:current.draft}}));}
  function clearCurrent(){var key=policyId(current.scopeType,current.sectionKey),all=chats();delete all[key];writeJson(CHAT_KEY,all);current.draft=null;renderChat();document.getElementById('mediaAiState').textContent='대화 지움';}
  function SpeechRecognitionCtor(){return window.SpeechRecognition||window.webkitSpeechRecognition||null;}
  function stopListening(){try{if(recognition)recognition.stop();}catch(_e){}recognition=null;var b=document.getElementById('mediaAiMic');if(b)b.classList.remove('live');}
  function toggleListening(){if(recognition){stopListening();return;}var C=SpeechRecognitionCtor();if(!C){document.getElementById('mediaAiState').textContent='이 브라우저는 음성 입력을 지원하지 않습니다';return;}recognition=new C();recognition.lang='ko-KR';recognition.interimResults=true;recognition.continuous=false;var b=document.getElementById('mediaAiMic'),input=document.getElementById('mediaAiInput'),base=text(input.value);b.classList.add('live');recognition.onresult=function(e){var fin='',inter='';for(var i=e.resultIndex;i<e.results.length;i++){var t=e.results[i][0].transcript;if(e.results[i].isFinal)fin+=t;else inter+=t;}input.value=[base,fin||inter].filter(Boolean).join(base?' ':'');};recognition.onerror=function(){document.getElementById('mediaAiState').textContent='음성 입력 오류';stopListening();};recognition.onend=function(){recognition=null;b.classList.remove('live');};recognition.start();document.getElementById('mediaAiState').textContent='듣는 중';}
  function speakLast(){if(!current.lastReply||!window.speechSynthesis)return;try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(current.lastReply);u.lang='ko-KR';speechSynthesis.speak(u);}catch(_e){}}
  function installButtons(){document.querySelectorAll('[data-media-ai-scope]').forEach(function(btn){if(btn.__igdcMediaAiBound)return;btn.__igdcMediaAiBound=true;btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openDialog(text(btn.dataset.mediaAiScope)||'global',text(btn.dataset.mediaAiSection)||'',text(btn.dataset.mediaAiLabel)||'미디어 정책');});});}
  function install(){ensureModal();installButtons();}
  window.IGDCMediaAI={policyFor:policyFor,policyEnvelope:function(section,purpose){return policyFor(section,purpose);},allPolicies:policies,openDialog:openDialog,closeDialog:closeDialog};
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){var m=document.getElementById('mediaAiModal');if(m&&m.classList.contains('open')){e.preventDefault();e.stopPropagation();closeDialog();}}},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  try{new MutationObserver(installButtons).observe(document.documentElement,{childList:true,subtree:true});}catch(_e){}
})();
