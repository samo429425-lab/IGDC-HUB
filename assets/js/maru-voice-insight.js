/* =========================================================
 * MARU VOICE INSIGHT ENGINE (v1.0 – ELITE GRADE)
 * Purpose:
 *  - Unified, single-file voice engine for all MARU insights
 *  - Supports level (region/country) + depth (1 summary / 2 deep)
 *  - Designed for high-stakes briefing quality (gov / intel / ops style)
 *
 * Architecture:
 *  - Text generation: delegated to MARU AI endpoint
 *  - Voice synthesis: Web Speech API (Phase 1)
 *  - Future-ready: OpenAI TTS drop-in replacement
 *
 * Public API:
 *   MaruVoice.play({ level, region, country?, depth })
 *   MaruVoice.stop()
 * ========================================================= */

(function () {
  'use strict';

  /* ================= CONFIG ================= */
  const AI_BRIEFING_ENDPOINT = '/api/ai-diagnose'; 
  // future: /api/maru-global-insight

  const DEFAULT_LANG = 'ko-KR';
  const MAX_SENTENCES = 6; // briefing discipline

  /* ================= STATE ================= */
  let synth = null;
  let currentUtterance = null;
  let isSpeaking = false;

  /* ================= INIT ================= */
  function initSynth() {
    if (!('speechSynthesis' in window)) {
      console.warn('[MARU][VOICE] Web Speech API not supported');
      return null;
    }
    return window.speechSynthesis;
  }

  /* ================= CORE ================= */
  async function generateBriefing(context) {
    const payload = {
      ...context,
      style: 'strategic-briefing',
      maxSentences: MAX_SENTENCES,
      realtime: true
    };

    const res = await fetch(AI_BRIEFING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error('AI briefing fetch failed');
    }

    const json = await res.json();
    return json?.briefing || '현재 유의미한 인사이트를 생성하지 못했습니다.';
  }

  function speak(text, opts = {}) {
    if (!synth) synth = initSynth();
    if (!synth) return;

    stop();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang || DEFAULT_LANG;
    u.rate = opts.rate || 0.95;
    u.pitch = opts.pitch || 1.0;
    u.volume = opts.volume || 1.0;

    u.onend = () => {
      isSpeaking = false;
      currentUtterance = null;
    };

    currentUtterance = u;
    isSpeaking = true;
    synth.speak(u);
  }

  function stop() {
    if (synth && synth.speaking) {
      synth.cancel();
    }
    isSpeaking = false;
    currentUtterance = null;
  }

  /* ================= PUBLIC API ================= */
  async function play(context) {
    /*
      context example:
      {
        level: 'region',
        region: 'asia',
        depth: 1 | 2,
        country?: 'thailand'
      }
    */
    try {
      const briefingText = await generateBriefing(context);
      speak(briefingText);
    } catch (e) {
      console.error('[MARU][VOICE] play failed', e);
    }
  }

  window.MaruVoice = {
    play,
    stop,
    get status() {
      return { speaking: isSpeaking };
    }
  };

})();