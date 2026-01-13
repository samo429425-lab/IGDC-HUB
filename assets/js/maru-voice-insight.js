/**
 * MARU Voice Insight — STATEFUL FIX (v1.2)
 * -------------------------------------------------
 * POLICY (ChatGPT-like):
 *  - OFF        : mic inactive
 *  - LISTENING  : mic active, waiting (indicator blink)
 *  - SPEAKING   : actual voice detected (indicator solid)
 *
 * RULES:
 *  - Toggle ON  -> LISTENING (never SPEAKING immediately)
 *  - Voice start -> SPEAKING
 *  - Voice end   -> LISTENING
 *  - Toggle OFF  -> OFF
 *
 * NOTE:
 *  - This file ONLY fixes voice state handling.
 *  - No changes to addon, region/country modal, or engine calls.
 */

(function(){
  'use strict';

  if (window.MaruVoice) return;

  const STATE = {
    OFF: 'OFF',
    LISTENING: 'LISTENING',
    SPEAKING: 'SPEAKING'
  };

  let currentState = STATE.OFF;
  let recognition = null;
  let silenceTimer = null;

  const SILENCE_TIMEOUT = 1200; // ms

  function setIndicator(state){
    currentState = state;

    try{
      window.MARU_VOICE_READY = (state !== STATE.OFF);
      window.MARU_VOICE_SPEAKING = (state === STATE.SPEAKING);

      const mic = document.querySelector('.maru-voice-indicator');
      if(!mic) return;

      mic.classList.remove('listening','speaking','off');
      if(state === STATE.LISTENING) mic.classList.add('listening');
      else if(state === STATE.SPEAKING) mic.classList.add('speaking');
      else mic.classList.add('off');
    }catch(_){}
  }

  function initRecognition(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;

    const r = new SR();
    r.lang = 'ko-KR';
    r.continuous = true;
    r.interimResults = false;

    r.onstart = () => {
      setIndicator(STATE.LISTENING);
    };

    r.onspeechstart = () => {
      clearTimeout(silenceTimer);
      setIndicator(STATE.SPEAKING);
    };

    r.onspeechend = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (currentState !== STATE.OFF) {
          setIndicator(STATE.LISTENING);
        }
      }, SILENCE_TIMEOUT);
    };

    r.onresult = (e) => {
      try{
        const last = e.results[e.results.length - 1];
        const text = last[0].transcript.trim();
        if(text && window.MaruAddon && typeof window.MaruAddon.handleVoiceQuery === 'function'){
          window.MaruAddon.handleVoiceQuery(text);
        }
      }catch(_){}
    };

    r.onerror = () => {
      if (currentState !== STATE.OFF) {
        setIndicator(STATE.LISTENING);
      }
    };

    r.onend = () => {
      if (currentState !== STATE.OFF) {
        setIndicator(STATE.LISTENING);
        try { r.start(); } catch(_) {}
      }
    };

    return r;
  }

  function start(){
    if(!recognition) recognition = initRecognition();
    if(!recognition) return;

    try{
      recognition.start();
      setIndicator(STATE.LISTENING);
    }catch(_){}
  }

  function stop(){
    try{
      if(recognition) recognition.stop();
    }catch(_){}
    clearTimeout(silenceTimer);
    setIndicator(STATE.OFF);
  }

  window.MaruVoice = {
    start,
    stop,
    get state(){ return currentState; }
  };

  // === Voice Bridge (Compatibility Layer) ===
  // Region / Country / Addon 에서 호출하는 함수명과 연결

  window.startMaruMic = function () {
    try {
      window.MaruVoice?.start?.();
    } catch (e) {
      console.error('[MaruVoice] start failed', e);
    }
  };

  window.stopMaruMic = function () {
    try {
      window.MaruVoice?.stop?.();
    } catch (e) {
      console.error('[MaruVoice] stop failed', e);
    }
  };

// TTS (Text To Speech)
window.maruVoiceSpeak = function (text) {
  try {
    if (!text) return;

    // 🔊 읽기 시작 → SPEAKING(표시)
    setIndicator(STATE.SPEAKING);

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 1.0;
    u.pitch = 1.0;

    // 🔊 읽기 종료 → LISTENING 복귀(토글 ON 상태일 때만)
    u.onend = () => {
      if (window.MaruVoice?.state !== STATE.OFF) {
        setIndicator(STATE.LISTENING);
      }
    };

    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {
    console.error('[MaruVoice] TTS failed', e);
  }
};


})();