/**
 * MARU Voice Insight (FULL, STABLE)
 * - Keeps existing structure
 * - Corrected STT state logic
 *   · idle: indicator blink
 *   · speaking: indicator solid
 *   · no auto-restart loop
 */

(function () {
  'use strict';

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let micEnabled = false;
  let speaking = false;

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

    // === idle (armed) ===
    recognition.onstart = () => {
      speaking = false;
    };

    // === speaking ===
    recognition.onspeechstart = () => {
      speaking = true;
      maruFinalText = '';
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          maruFinalText += event.results[i][0].transcript;
        }
      }
    };

    // === speech end → back to idle ===
    recognition.onspeechend = () => {
      speaking = false;
      const text = maruFinalText.trim();
      maruFinalText = '';

      if (!text) return;

      // deliver to addon
      if (
        window.MaruAddon &&
        typeof window.MaruAddon.handleVoiceQuery === 'function'
      ) {
        window.MaruAddon.handleVoiceQuery(text);
      }
    };

    // === hard stop, NO auto-restart ===
    recognition.onend = () => {
      speaking = false;
    };

    recognition.onerror = () => {
      speaking = false;
    };
  }

  // === public control ===
  window.startMaruMic = function () {
    initSTT();
    micEnabled = true;
    try { recognition.start(); } catch (e) {}
  };

  window.stopMaruMic = function () {
    micEnabled = false;
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
    }
  };

  // === optional debug ===
  window.__maruVoiceState = function () {
    return { micEnabled, speaking };
  };

})();