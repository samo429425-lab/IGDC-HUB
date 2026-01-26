/* MARU Voice Insight — FINAL STABLE (v1.1)
 * - interimResults enabled for realtime typing
 * - interim transcript -> MaruAddon.previewVoice(text, context)
 * - final transcript -> MaruAddon.handleVoiceQuery(text, context)
 */
(function () {
  'use strict';
  if (window.MaruVoice) return;

  const STATE = { OFF:'OFF', LISTENING:'LISTENING', SPEAKING:'SPEAKING' };
  let currentState = STATE.OFF;
  let recognition = null;
  let silenceTimer = null;
  const SILENCE_TIMEOUT = 1200;

  function getCurrentMaruContext(){
    // prefer dock/context
    if (window.MaruConversationDock && typeof window.MaruConversationDock.getContext === 'function') {
      return window.MaruConversationDock.getContext();
    }
    if (window.MaruConversationModal && typeof window.MaruConversationModal.getContext === 'function') {
      return window.MaruConversationModal.getContext();
    }
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
    r.lang='ko-KR';
    r.continuous=true;
    r.interimResults=true;

    r.onstart=()=>setState(STATE.LISTENING);
    r.onspeechstart=()=>{ clearTimeout(silenceTimer); setState(STATE.SPEAKING); };
    r.onspeechend=()=>{
      clearTimeout(silenceTimer);
      silenceTimer=setTimeout(()=>{ if(currentState!==STATE.OFF) setState(STATE.LISTENING); }, SILENCE_TIMEOUT);
    };

    r.onresult = (e) => {
      try {
        const context = getCurrentMaruContext();
        // iterate results
        let interim = '';
        let finals = [];
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const t = (res && res[0] && res[0].transcript) ? res[0].transcript.trim() : '';
          if (!t) continue;
          if (res.isFinal) finals.push(t);
          else interim = t;
        }

        if (interim && window.MaruAddon?.previewVoice) {
          window.MaruAddon.previewVoice(interim, context);
        }

        if (finals.length && window.MaruAddon?.handleVoiceQuery) {
          const text = finals.join(' ').trim();
          if (text) window.MaruAddon.handleVoiceQuery(text, context);
        }
      } catch (_) {}
    };

    r.onerror = () => { if(currentState!==STATE.OFF) setState(STATE.LISTENING); };

    r.onend = () => {
      if (
        currentState !== STATE.OFF &&
        window.MaruAddon?.isVoiceEnabled?.() &&
        window.__MARU_VOICE_TOGGLE__ !== false
      ) {
        try { r.start(); } catch (_) {}
        setState(STATE.LISTENING);
      }
    };

    return r;
  }

  function start(){
    if(!recognition) recognition = initRecognition();
    try{
      recognition?.start();
      setState(STATE.LISTENING);
    }catch(_){}
  }

  function stop(){
    try{ recognition?.stop(); }catch(_){}
    clearTimeout(silenceTimer);
    setState(STATE.OFF);
  }

  window.MaruVoice = { start, stop, get state(){ return currentState; } };
  window.startMaruMic = ()=>window.MaruVoice.start();
  window.stopMaruMic  = ()=>window.MaruVoice.stop();

  window.maruVoiceSpeak = function(text){
    if(!text) return;
    setState(STATE.SPEAKING);
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'ko-KR';
    u.onend = ()=>{ if(currentState!==STATE.OFF) setState(STATE.LISTENING); };
    try { speechSynthesis.speak(u); } catch(_) {}
  };
})();