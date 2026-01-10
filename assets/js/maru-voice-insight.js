/* =========================================================
 * MARU VOICE INSIGHT ENGINE (CANONICAL)
 * ---------------------------------------------------------
 * Role:
 *  - STT: receive any voice input (no topic restriction)
 *  - Pass raw text to Addon
 *  - TTS: read exactly what Addon returns
 *
 * Policy:
 *  - NO topic classification here
 *  - NO country/region logic here
 *  - Voice is a pure pipe (input/output)
 * ========================================================= */

(function () {
  'use strict';

// ===============================
// 🎤 STT 시작 함수 (GLOBAL)
// ===============================
window.startMaruMic = function () {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.error('[MARU][VOICE] SpeechRecognition not supported');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'ko-KR';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = function (event) {
    const text = event.results[0][0].transcript;
    console.log('[MARU][VOICE] Heard:', text);

    if (
      window.MaruAddon &&
      typeof window.MaruAddon.handleVoiceQuery === 'function'
    ) {
      window.MaruAddon.handleVoiceQuery(text);
    }
  };

  recognition.onerror = function (e) {
    console.warn('[MARU][VOICE] Mic error', e);
  };

  recognition.start();
};


  /* =======================
   * CONFIG
   * ======================= */
  const DEFAULT_LANG = 'ko-KR';

  /* =======================
   * TTS STATE
   * ======================= */
  let synth = null;
  let speaking = false;
  let currentUtterance = null;

  /* =======================
   * STT STATE
   * ======================= */
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let micEnabled = false;
  let listening = false;
  let lastResultTime = 0;

  /* =======================
   * INIT TTS
   * ======================= */
  function initTTS() {
    if (!('speechSynthesis' in window)) {
      console.warn('[MARU][VOICE] TTS not supported');
      return null;
    }
    return window.speechSynthesis;
  }

  /* =======================
   * INIT STT
   * ======================= */
  function initSTT() {
    if (!SpeechRecognition) {
      console.warn('[MARU][VOICE] STT not supported');
      return;
    }
    if (recognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = DEFAULT_LANG;
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      listening = true;
      console.log('[MARU][VOICE] Mic listening');
    };

    recognition.onend = () => {
      listening = false;
      console.log('[MARU][VOICE] Mic stopped');

      // 자동 재대기 (토글 ON 상태)
      if (micEnabled) {
        setTimeout(() => {
          try {
            recognition.start();
          } catch (e) {}
        }, 700);
      }
    };

    recognition.onerror = (e) => {
      console.warn('[MARU][VOICE] Mic error', e);
      listening = false;
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript.trim();
      const now = Date.now();

      // 중복/노이즈 방지
      if (now - lastResultTime < 800) return;
      lastResultTime = now;

      console.log('[MARU][VOICE] Heard:', text);

      // ❗ 판단하지 않고 그대로 Addon에 전달
      if (window.MaruAddon && typeof MaruAddon.handleVoiceQuery === 'function') {
        MaruAddon.handleVoiceQuery(text);
      } else {
        console.warn('[MARU][VOICE] MaruAddon.handleVoiceQuery not found');
      }
    };
  }

  /* =======================
   * PUBLIC STT API
   * ======================= */
  window.startMaruMic = function () {
    micEnabled = true;
    initSTT();
    if (recognition && !listening) {
      try {
        recognition.start();
      } catch (e) {}
    }
  };

  window.stopMaruMic = function () {
    micEnabled = false;
    if (recognition && listening) {
      recognition.stop();
    }
  };

  /* =======================
   * TTS CORE
   * ======================= */
  function speak(text, opts = {}) {
    if (!synth) synth = initTTS();
    if (!synth || !text) return;

    stop();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang || DEFAULT_LANG;
    u.rate = opts.rate || 0.95;
    u.pitch = opts.pitch || 1.0;
    u.volume = opts.volume || 1.0;

    u.onend = () => {
      speaking = false;
      currentUtterance = null;
    };

    speaking = true;
    currentUtterance = u;
    synth.speak(u);
  }

  function stop() {
    if (synth && synth.speaking) synth.cancel();
    speaking = false;
    currentUtterance = null;
  }

  /* =======================
   * PUBLIC TTS API
   * ======================= */
  window.MaruVoice = {
    /**
     * Addon이 정리한 "최종 텍스트"만 읽는다
     * @param {string|object} payload
     *  - string: 바로 읽기
     *  - { text, lang?, rate?, pitch? }
     */
    play(payload) {
      if (!payload) return;

      if (typeof payload === 'string') {
        speak(payload);
        return;
      }

      if (payload.text) {
        speak(payload.text, payload);
      }
    },

    stop,

    get status() {
      return {
        speaking,
        micEnabled,
        listening
      };
    }
  };

// ▶ Region / Country 음성 토글 → 정식 STT 엔진 브리지
document.addEventListener('change', function (e) {
  if (!e.target) return;

  if (
    e.target.id === 'maruRegionVoiceToggle' ||
    e.target.id === 'maruCountryVoiceToggle'
  ) {
    if (e.target.checked) {
      window.startMaruMic?.();
    } else {
      window.stopMaruMic?.();
    }
  }
});

})();
