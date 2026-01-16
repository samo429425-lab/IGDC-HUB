/* MARU Voice Insight — FINAL STABLE */
(function () {
  'use strict';
  if (window.MaruVoice) return;

  const STATE = { OFF:'OFF', LISTENING:'LISTENING', SPEAKING:'SPEAKING' };
  let currentState = STATE.OFF;
  let recognition = null;
  let silenceTimer = null;
  const SILENCE_TIMEOUT = 1200;
  
  // === MARU Context Helper ===
function getCurrentMaruContext(){
  if (
    window.MaruConversationModal &&
    typeof window.MaruConversationModal.getContext === 'function'
  ) {
    return window.MaruConversationModal.getContext();
  }
  return null;
}


  function setState(state){
    currentState = state;
    window.MARU_VOICE_STATE = state;
    window.MARU_VOICE_READY = (state !== STATE.OFF);
    window.MARU_VOICE_SPEAKING = (state === STATE.SPEAKING);
  }

  function initRecognition(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;
    const r = new SR();
    r.lang='ko-KR'; r.continuous=true; r.interimResults=false;
    r.onstart=()=>setState(STATE.LISTENING);
    r.onspeechstart=()=>{clearTimeout(silenceTimer); setState(STATE.SPEAKING);};
    r.onspeechend=()=>{
      clearTimeout(silenceTimer);
      silenceTimer=setTimeout(()=>{ if(currentState!==STATE.OFF) setState(STATE.LISTENING);},SILENCE_TIMEOUT);
    };
    r.onresult=e=>{
      const last=e.results[e.results.length-1];
      const text=last[0].transcript.trim();
      if(text && window.MaruAddon?.handleVoiceQuery){
      const context = getCurrentMaruContext();
      window.MaruAddon.handleVoiceQuery(text, context);
    }

    };
    r.onerror=()=>{ if(currentState!==STATE.OFF) setState(STATE.LISTENING); };
r.onend = () => {
  if (
    currentState !== STATE.OFF &&
    window.MaruAddon?.isVoiceEnabled?.() &&
    window.MARU_REGION_VOICE_READY !== false
  ) {
    try { r.start(); } catch (_) {}
    setState(STATE.LISTENING);
  }
};

    return r;
  }

function start(){
  // 음성 OFF 상태라도 상태 동기화는 반드시 수행
if (
  window.MaruAddon &&
  MaruAddon.isVoiceEnabled &&
  !MaruAddon.isVoiceEnabled()
) {
  setState(STATE.OFF);
  return;
}

// REGION READY가 false여도 음성 상태는 초기화한다
if (window.MARU_REGION_VOICE_READY === false) {
  setState(STATE.OFF);
  return;
}


  if(!recognition) recognition = initRecognition();
  try{
    recognition?.start();
    setState(STATE.LISTENING);
  }catch(_){}
}

  function stop(){ try{recognition?.stop();}catch(_){} clearTimeout(silenceTimer); setState(STATE.OFF); }

  window.MaruVoice={ start, stop, get state(){return currentState;} };
  window.startMaruMic=()=>window.MaruVoice.start();
  window.stopMaruMic=()=>window.MaruVoice.stop();

  window.maruVoiceSpeak=function(text){
    if(!text) return;
    setState(STATE.SPEAKING);
    const u=new SpeechSynthesisUtterance(text);
    u.lang='ko-KR';
    u.onend=()=>{ if(currentState!==STATE.OFF) setState(STATE.LISTENING); };
    speechSynthesis.speak(u);
  };
})();