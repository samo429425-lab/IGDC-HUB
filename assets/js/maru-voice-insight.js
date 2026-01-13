/**
 * MARU Voice Insight (FULL, STABLE)
 * - Keeps existing structure
 * - Adds conversation-grade STT
 */

(function () {
  'use strict';

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let micEnabled = false;
  let listening = false;

  function initTTS() {
    if (!('speechSynthesis' in window)) return null;
    return window.speechSynthesis;
  }
  const tts = initTTS();

  function initSTT() {
    if (!SpeechRecognition || recognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;

    let maruFinalText = '';

    recognition.onstart = () => {
      listening = true;
    };

    recognition.onspeechstart = () => {
      maruFinalText = '';
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          maruFinalText += event.results[i][0].transcript;
        }
      }
    };

    recognition.onspeechend = () => {
      recognition.stop();
      const text = maruFinalText.trim();
      if (!text) return;
      if (window.MaruAddon && typeof window.MaruAddon.handleVoiceQuery === 'function') {
        window.MaruAddon.handleVoiceQuery(text);
      }
      maruFinalText = '';
    };

    recognition.onend = () => {
      listening = false;
      if (micEnabled) {
        try { recognition.start(); } catch (e) {}
      }
    };
  }

  window.startMaruMic = function () {
    initSTT();
    micEnabled = true;
    try { recognition.start(); } catch (e) {}
  };

  window.stopMaruMic = function () {
    micEnabled = false;
    if (recognition) recognition.stop();
  };

})();