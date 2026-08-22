/* IGDC Social AI Policy Dialog v1.1.0
 * Admin-only conversation/policy layer. Never writes SearchBank/Snapshot/front.
 */
(function () {
  "use strict";
  if (window.__IGDC_SOCIAL_AI_DIALOG__) return;
  window.__IGDC_SOCIAL_AI_DIALOG__ = true;

  var ENDPOINT = "/.netlify/functions/social-ai-dialog";
  var STORE_KEY = "igdc.socialAiPolicies.v1";
  var CHAT_KEY = "igdc.socialAiChats.v1";
  var SECTION_LABELS = {
    "social-youtube":"YouTube", "social-instagram":"Instagram", "social-tiktok":"TikTok",
    "social-facebook":"Facebook", "social-wechat":"WeChat", "social-weibo":"Weibo",
    "social-pinterest":"Pinterest", "social-reddit":"Reddit", "social-twitter":"X · Twitter"
  };
  function text(v){ return v == null ? "" : String(v).trim(); }
  function readJson(key, fallback){ try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch(_e){ return fallback; } }
  function writeJson(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch(_e){} }
  function policyId(scopeType, sectionKey){ return text(scopeType || "global") + ":" + text(sectionKey || "GLOBAL"); }
  function policies(){ return readJson(STORE_KEY, {}); }
  function chats(){ return readJson(CHAT_KEY, {}); }
  function mergePolicy(a,b){
    a=a&&typeof a==="object"?a:{}; b=b&&typeof b==="object"?b:{};
    var out=Object.assign({},a,b);
    ["includeTopics","excludeTopics","preferredCreatorTraits","blockedCreatorTraits","notes"].forEach(function(k){
      out[k]=Array.from(new Set([].concat(a[k]||[],b[k]||[]).map(text).filter(Boolean)));
    });
    return out;
  }
  function policyFor(sectionKey, purpose){
    var all=policies(), out=all[policyId("global","")] || {};
    if (sectionKey) out=mergePolicy(out, all[policyId("section",sectionKey)] || {});
    if (purpose) out=mergePolicy(out, all[policyId(purpose,sectionKey)] || all[policyId(purpose,"")] || {});
    out.sectionKey=sectionKey || out.sectionKey || "";
    out.scopeType=purpose || (sectionKey ? "section" : "global");
    return Object.keys(out).length ? out : null;
  }
  window.IGDCSocialAI = {
    policyFor: policyFor,
    policyEnvelope: function(sectionKey,purpose){ return policyFor(sectionKey,purpose); },
    policyBundle: function(sectionKey,purposes){
      var out=policyFor(sectionKey,"")||{};
      (Array.isArray(purposes)?purposes:[purposes]).filter(Boolean).forEach(function(purpose){
        out=mergePolicy(out,policyFor(sectionKey,purpose)||{});
      });
      out.sectionKey=sectionKey||out.sectionKey||"";
      out.scopeType="combined";
      return Object.keys(out).length?out:null;
    },
    allPolicies: policies
  };

  function authToken(){
    var direct="";
    try { direct=localStorage.getItem("igdc.socialCandidateQueue.adminBearer") || sessionStorage.getItem("igdc.socialCandidateQueue.adminBearer") || ""; } catch(_e){}
    if (direct) return direct;
    var keys=["osauth.tokens.v2","osauth.tokens.v1","igdc.tokens","igdc_auth_tokens","auth0_tokens","auth0spa"];
    for (var si=0;si<2;si++){
      var store; try { store=si===0?localStorage:sessionStorage; } catch(_e){ continue; }
      for(var i=0;i<keys.length;i++){
        var raw=""; try { raw=store.getItem(keys[i])||""; } catch(_e){}
        if(!raw) continue;
        try {
          var obj=JSON.parse(raw), token=text(obj.id_token||obj.idToken||obj.access_token||obj.accessToken||obj.token);
          if(token) return token;
        } catch(_e){}
      }
    }
    return "";
  }
  async function callAI(payload){
    var h={"Content-Type":"application/json","Accept":"application/json"}, t=authToken();
    if(t) h.Authorization="Bearer "+t;
    var r=await fetch(ENDPOINT,{method:"POST",headers:h,credentials:"same-origin",cache:"no-store",body:JSON.stringify(payload)});
    var d={}; try { d=await r.json(); } catch(_e){}
    if(!r.ok || !d || d.ok!==true) throw new Error((d&&(d.message||d.error))||("HTTP "+r.status));
    return d;
  }
  function ensureCss(){
    if(document.getElementById("igdc-social-ai-dialog-css")) return;
    var st=document.createElement("style"); st.id="igdc-social-ai-dialog-css";
    st.textContent=".social-ai-talk-btn{border-color:#7dd3fc!important;background:#103a5a!important;color:#e0f2fe!important}.social-ai-modal{position:fixed;inset:0;z-index:2147483600;background:rgba(2,6,23,.76);display:none;align-items:center;justify-content:center;padding:16px}.social-ai-modal.open{display:flex}.social-ai-box{width:min(900px,96vw);max-height:92vh;background:#0f172a;border:1px solid #334155;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45)}.social-ai-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#111827;border-bottom:1px solid #334155}.social-ai-head strong{flex:1}.social-ai-close{background:#334155!important}.social-ai-transcript{min-height:220px;max-height:48vh;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:9px}.social-ai-msg{padding:9px 11px;border-radius:10px;white-space:pre-wrap;line-height:1.45}.social-ai-msg.user{background:#172554}.social-ai-msg.assistant{background:#13342e}.social-ai-msg.system{background:#3b2f16}.social-ai-compose{padding:12px;border-top:1px solid #334155;display:grid;grid-template-columns:1fr auto;gap:8px}.social-ai-compose textarea{width:100%;min-height:80px;resize:vertical;background:#020617;color:#e5eefb;border:1px solid #475569;border-radius:9px;padding:10px}.social-ai-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center;padding:0 12px 12px}.social-ai-policy{margin:0 12px 12px;padding:10px;background:#020617;border:1px solid #334155;border-radius:9px;max-height:180px;overflow:auto;white-space:pre-wrap;font-size:12px}.social-ai-mic.live{background:#9f1239!important}.social-ai-scope-note{font-size:12px;color:#94a3b8}.social-ai-inline{margin-left:6px}";
    document.head.appendChild(st);
  }
  function ensureModal(){
    var m=document.getElementById("socialAiPolicyModal"); if(m) return m;
    ensureCss();
    m=document.createElement("div"); m.id="socialAiPolicyModal"; m.className="social-ai-modal";
    m.innerHTML='<div class="social-ai-box" role="dialog" aria-modal="true"><div class="social-ai-head"><strong id="socialAiTitle">AI 정책 대화</strong><span id="socialAiScope" class="social-ai-scope-note"></span><button type="button" id="socialAiClose" class="social-ai-close">닫기</button></div><div id="socialAiTranscript" class="social-ai-transcript"></div><div id="socialAiPolicyPreview" class="social-ai-policy">현재 정책 없음</div><div class="social-ai-compose"><textarea id="socialAiInput" placeholder="수집·제외·보강·인플루언서 운영 방향을 말하거나 입력하세요."></textarea><button type="button" id="socialAiSend">보내기</button></div><div class="social-ai-actions"><button type="button" id="socialAiMic" class="social-ai-mic">🎙 음성 입력</button><button type="button" id="socialAiSpeak">🔊 답변 읽기</button><button type="button" id="socialAiApply" class="publish">정책 적용</button><button type="button" id="socialAiClear" class="secondary">대화 지우기</button><span id="socialAiState" class="state">대기</span></div></div>';
    document.body.appendChild(m);
    function closeModal(){ m.classList.remove("open"); stopListening(); }
    document.getElementById("socialAiClose").onclick=closeModal;
    m.addEventListener("click",function(e){ if(e.target===m) closeModal(); });
    if(!m.__igdcEscBound){
      m.__igdcEscBound=true;
      document.addEventListener("keydown",function(e){
        if(e.key==="Escape" && m.classList.contains("open")){
          e.preventDefault();
          closeModal();
        }
      },true);
    }
    document.getElementById("socialAiSend").onclick=sendCurrent;
    document.getElementById("socialAiApply").onclick=applyDraft;
    document.getElementById("socialAiClear").onclick=clearCurrent;
    document.getElementById("socialAiMic").onclick=toggleListening;
    document.getElementById("socialAiSpeak").onclick=speakLast;
    return m;
  }
  var current={scopeType:"global",sectionKey:"",label:"전체 Social",draft:null,lastReply:""}, recognition=null;
  function contextFor(scopeType, sectionKey){
    var root=null;
    if(scopeType==="content" && sectionKey) root=document.querySelector('#waitingAccordion [data-section="'+CSS.escape(sectionKey)+'"]');
    if(scopeType==="influencer" && sectionKey) root=document.querySelector('#sectionAccordion [data-section="'+CSS.escape(sectionKey)+'"]');
    if(!root && scopeType==="collector") root=document.querySelector("#collectorState") && document.querySelector("#collectorState").closest("section");
    if(!root && scopeType==="content") root=document.getElementById("waitingPanel") || document.getElementById("replacementPanel");
    if(!root && scopeType==="influencer") root=document.getElementById("tablePanel");
    if(!root) root=document.getElementById("aiAutomationPanel") || document.body;
    var snippets=Array.from(root.querySelectorAll(".candidate-card,.content-ops-card,.small,.state")).slice(0,55).map(function(el){return text(el.textContent).replace(/\s+/g," ").slice(0,240);}).filter(Boolean);
    return { scopeType:scopeType, sectionKey:sectionKey||null, visibleContext:snippets, capturedAt:new Date().toISOString() };
  }
  function appendMsg(role,msg){
    var box=document.getElementById("socialAiTranscript"), d=document.createElement("div"); d.className="social-ai-msg "+role; d.textContent=msg; box.appendChild(d); box.scrollTop=box.scrollHeight;
  }
  function renderChat(){
    var box=document.getElementById("socialAiTranscript"); box.innerHTML="";
    var key=policyId(current.scopeType,current.sectionKey), history=chats()[key]||[];
    history.forEach(function(x){appendMsg(x.role,x.text);});
    var p=policies()[key]||policyFor(current.sectionKey,current.scopeType);
    document.getElementById("socialAiPolicyPreview").textContent=p?JSON.stringify(p,null,2):"현재 정책 없음";
  }
  function openDialog(scopeType,sectionKey,label){
    current={scopeType:scopeType||"global",sectionKey:sectionKey||"",label:label||"Social",draft:null,lastReply:""};
    var m=ensureModal(); document.getElementById("socialAiTitle").textContent="AI 정책 대화 · "+current.label;
    document.getElementById("socialAiScope").textContent=current.scopeType+(current.sectionKey?" · "+current.sectionKey:"");
    document.getElementById("socialAiInput").value=""; document.getElementById("socialAiState").textContent="대기"; renderChat(); m.classList.add("open");
  }
  window.IGDCSocialAI.openDialog=openDialog;
  async function sendCurrent(){
    var input=document.getElementById("socialAiInput"), message=text(input.value); if(!message) return;
    var key=policyId(current.scopeType,current.sectionKey), all=chats(), history=(all[key]||[]).slice(-12);
    appendMsg("user",message); history.push({role:"user",text:message}); all[key]=history; writeJson(CHAT_KEY,all); input.value="";
    var st=document.getElementById("socialAiState"); st.textContent="AI 협의 중";
    try{
      var d=await callAI({scopeType:current.scopeType,sectionKey:current.sectionKey,message:message,history:history,context:contextFor(current.scopeType,current.sectionKey)});
      current.draft=d.policyDraft||null; current.lastReply=text(d.reply); appendMsg("assistant",current.lastReply);
      all=chats(); history=(all[key]||[]); history.push({role:"assistant",text:current.lastReply}); all[key]=history.slice(-24); writeJson(CHAT_KEY,all);
      document.getElementById("socialAiPolicyPreview").textContent=current.draft?JSON.stringify(current.draft,null,2):"정책 초안 없음";
      st.textContent=d.provider==="configured_ai"?"AI 정책 초안 완료":"로컬 정책 초안 · AI API 미연결";
    }catch(e){ appendMsg("system","오류: "+(e.message||e)); st.textContent="대화 실패"; }
  }
  function applyDraft(){
    if(!current.draft){ document.getElementById("socialAiState").textContent="적용할 정책 초안이 없습니다"; return; }
    var all=policies(), key=policyId(current.scopeType,current.sectionKey);
    current.draft.appliedAt=new Date().toISOString(); all[key]=current.draft; writeJson(STORE_KEY,all);
    document.getElementById("socialAiPolicyPreview").textContent=JSON.stringify(current.draft,null,2); document.getElementById("socialAiState").textContent="정책 적용됨";
    window.dispatchEvent(new CustomEvent("igdc:social-ai-policy-applied",{detail:{key:key,policy:current.draft}}));
  }
  function clearCurrent(){
    var key=policyId(current.scopeType,current.sectionKey), all=chats(); delete all[key]; writeJson(CHAT_KEY,all); current.draft=null; renderChat(); document.getElementById("socialAiState").textContent="대화 지움";
  }
  function SpeechRecognitionCtor(){ return window.SpeechRecognition||window.webkitSpeechRecognition||null; }
  function stopListening(){ try{ if(recognition) recognition.stop(); }catch(_e){} recognition=null; var b=document.getElementById("socialAiMic"); if(b)b.classList.remove("live"); }
  function toggleListening(){
    if(recognition){stopListening();return;} var C=SpeechRecognitionCtor(); if(!C){document.getElementById("socialAiState").textContent="이 브라우저는 음성 입력을 지원하지 않습니다";return;}
    recognition=new C(); recognition.lang="ko-KR"; recognition.interimResults=true; recognition.continuous=false;
    var b=document.getElementById("socialAiMic"), input=document.getElementById("socialAiInput"), base=text(input.value); b.classList.add("live");
    recognition.onresult=function(e){var finalText="",interim="";for(var i=e.resultIndex;i<e.results.length;i++){var t=e.results[i][0].transcript;if(e.results[i].isFinal)finalText+=t;else interim+=t;}input.value=[base,finalText||interim].filter(Boolean).join(base?" ":"");};
    recognition.onerror=function(){document.getElementById("socialAiState").textContent="음성 입력 오류";stopListening();}; recognition.onend=function(){recognition=null;b.classList.remove("live");}; recognition.start(); document.getElementById("socialAiState").textContent="듣는 중";
  }
  function speakLast(){ if(!current.lastReply||!window.speechSynthesis)return; try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(current.lastReply);u.lang="ko-KR";speechSynthesis.speak(u);}catch(_e){} }
  function makeButton(label,scopeType,sectionKey,display){
    var b=document.createElement("button"); b.type="button"; b.className="social-ai-talk-btn social-ai-inline"; b.textContent=label||"AI 정책 대화"; b.dataset.socialAiScope=scopeType; b.dataset.socialAiSection=sectionKey||""; b.onclick=function(e){e.preventDefault();e.stopPropagation();openDialog(scopeType,sectionKey,display||SECTION_LABELS[sectionKey]||"Social");}; return b;
  }
  function addAfter(target,id,scopeType,sectionKey,label){ if(!target||document.getElementById(id))return; var b=makeButton("AI 정책 대화",scopeType,sectionKey,label);b.id=id;target.insertAdjacentElement("afterend",b); }
  function installStaticButtons(){
    /* Main panel buttons are placed explicitly in the HTML so they stay on the requested title rows. */
    addAfter(document.getElementById("aiAutoBtn"),"socialAiInfluencerTalkBtn","influencer","","인플루언서 등록부 전체 정책");
    document.querySelectorAll("[data-social-ai-open]").forEach(function(btn){
      if(btn.__igdcAiBound) return;
      btn.__igdcAiBound=true;
      btn.addEventListener("click",function(e){
        e.preventDefault();
        e.stopPropagation();
        openDialog(
          btn.getAttribute("data-social-ai-scope")||"global",
          btn.getAttribute("data-social-ai-section")||"",
          btn.getAttribute("data-social-ai-label")||"Social"
        );
      });
    });
  }
  function installSectionButtons(){
    document.querySelectorAll("[data-waiting-ai]").forEach(function(target){var key=target.getAttribute("data-waiting-ai");if(!key||target.parentNode.querySelector('[data-ai-dialog-content="'+key+'"]'))return;var b=makeButton("AI 정책 대화","content",key,(SECTION_LABELS[key]||key)+" 콘텐츠");b.dataset.aiDialogContent=key;target.insertAdjacentElement("afterend",b);});
    document.querySelectorAll("[data-section-ai]").forEach(function(target){var key=target.getAttribute("data-section-ai");if(!key||target.parentNode.querySelector('[data-ai-dialog-influencer="'+key+'"]'))return;var b=makeButton("AI 정책 대화","influencer",key,(SECTION_LABELS[key]||key)+" 인플루언서");b.dataset.aiDialogInfluencer=key;target.insertAdjacentElement("afterend",b);});
    document.querySelectorAll("[data-final-toggle],[data-waiting-toggle]").forEach(function(toggle){var key=toggle.getAttribute("data-final-toggle")||toggle.getAttribute("data-waiting-toggle");if(!key)return;var row=toggle.closest(".section-toggle-row");if(!row||row.querySelector('[data-ai-dialog-section="'+key+'"]'))return;var b=makeButton("AI 협의","section",key,(SECTION_LABELS[key]||key)+" 섹션");b.dataset.aiDialogSection=key;row.appendChild(b);});
  }
  function install(){ ensureModal(); installStaticButtons(); installSectionButtons(); }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
  try{new MutationObserver(function(){installStaticButtons();installSectionButtons();}).observe(document.documentElement,{childList:true,subtree:true});}catch(_e){}
})();
