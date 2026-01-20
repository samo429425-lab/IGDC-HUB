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
    try {
      if (window.MaruConversationDock && typeof window.MaruConversationDock.getContext === 'function') {
        const c = window.MaruConversationDock.getContext();
        if (c) return c;
      }
    } catch (_) {}
    try {
      if (window.MaruConversationModal && typeof window.MaruConversationModal.getContext === 'function') {
        const c = window.MaruConversationModal.getContext();
        if (c) return c;
      }
    } catch (_) {}
    return window.__MARU_CONTEXT__ || null;
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
    r.lang='ko-KR'; r.continuous=true; r.interimResults=true;
    r.onstart=()=>setState(STATE.LISTENING);
    r.onspeechstart=()=>{clearTimeout(silenceTimer); setState(STATE.SPEAKING);};
    r.onspeechend=()=>{
      clearTimeout(silenceTimer);
      silenceTimer=setTimeout(()=>{ if(currentState!==STATE.OFF) setState(STATE.LISTENING);},SILENCE_TIMEOUT);
    };
    r.onresult=e=>{
      try {
        // Build transcript from the latest result
        const last = e.results[e.results.length-1];
        const transcript = String(last[0].transcript || '').trim();
        if (!transcript) return;

        // Show voice transcript in the text input (ChatGPT-style)
        if (window.MaruConversationUI && typeof window.MaruConversationUI.setInputText === 'function') {
          window.MaruConversationUI.setInputText(transcript);
        }

        // Only dispatch to engine on FINAL result
        if (last.isFinal && window.MaruAddon && typeof window.MaruAddon.handleVoiceQuery === 'function') {
          const context = getCurrentMaruContext();
          window.MaruAddon.handleVoiceQuery({ text: transcript, context: context });
          // After dispatch, clear input back to WAIT
          if (window.MaruConversationUI && typeof window.MaruConversationUI.clearInput === 'function') {
            window.MaruConversationUI.clearInput();
          }
        }
      } catch (_) {}
    };
    r.onerror=()=>{ if(currentState!==STATE.OFF) setState(STATE.LISTENING); };
    r.onend = () => {
      if (currentState !== STATE.OFF && window.MaruAddon?.isVoiceEnabled?.()) {
        try { r.start(); } catch (_) {}
        setState(STATE.LISTENING);
      }
    };

    return r;
  }

function start(){
  // Start is called only from explicit user-gesture (voice toggle).
  // Do not block start by additional global flags; Addon controls when to call.

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