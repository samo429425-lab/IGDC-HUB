/* MARU Conversation Modal — FINAL STABLE */
(function () {
  'use strict';
  if (window.MaruConversationModal) return;

  let container,inputWrap,inputEl,sendBtn;
  let mounted=false;
  let voiceMode=false;
  let context=null;

  function createUI(){
    container=document.createElement('div');
    container.className='maru-conversation-container';
    container.style.cssText='position:absolute;left:0;right:0;bottom:0;padding:12px;background:#fff;border-top:1px solid #ddd;z-index:10';
    inputWrap=document.createElement('div');
    inputWrap.style.display='flex'; inputWrap.style.gap='8px';
    inputEl=document.createElement('input');
    inputEl.type='text'; inputEl.placeholder='질문을 입력하세요';
    inputEl.style.cssText='flex:1;padding:10px;border:1px solid #ccc;border-radius:6px;font-size:14px';
    sendBtn=document.createElement('button');
    sendBtn.textContent='전송';
    sendBtn.style.cssText='padding:10px 14px;border:none;background:#1f3a5f;color:#fff;border-radius:6px;cursor:pointer;font-size:13px';
    inputWrap.appendChild(inputEl); inputWrap.appendChild(sendBtn);
    container.appendChild(inputWrap);
    sendBtn.onclick=submitText;
    inputEl.onkeydown=e=>{ if(e.key==='Enter') submitText(); };
  }

  function submitText(){
    const text=inputEl.value.trim();
    if(!text) return;
    inputEl.value='';
    if(window.MaruAddon?.handleTextQuery){
      window.MaruAddon.handleTextQuery({text, context});

    }
  }

  function mountTo(target){
    if(!container) createUI();
    target.appendChild(container);
    mounted=true;
    applyVisibility();
  }


  function showInput(){ inputWrap.style.display='flex'; }
  function hideInput(){ inputWrap.style.display='none'; }
  
  function setVoiceMode(on){ voiceMode=!!on; applyVisibility(); }
  function setContext(ctx){ context=ctx||null; }

  function getContext(){ return context; }
  function applyVisibility(){
    if(!inputWrap) return;
    // voiceMode=true면 숨김, false면 표시
    inputWrap.style.display = voiceMode ? 'none' : 'flex';
  }

 window.MaruConversationModal={
  mountTo,
  ensureReady,
  showInput,
  hideInput,
  setVoiceMode,
  setContext,
  getContext
};

  function ensureReady(target){
    if(!container) createUI();
    if(target && (!mounted || container.parentNode!==target)){
      if(container.parentNode) container.parentNode.removeChild(container);
      target.appendChild(container);
      mounted=true;
    }
    applyVisibility();
  }

})();