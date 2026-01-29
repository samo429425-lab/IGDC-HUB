
/* =========================================================
 * MARU SITE CONTROL ADDON - VOICE FIRST (SAFE FIX)
 * Purpose:
 *  - Voice(TTS) ALWAYS responds (independent of extension pane)
 *  - Region/Country content is read when present
 *  - Extension pane is intentionally decoupled/disabled
 * ======================================================= */
(function () {
  'use strict';

  window.__MARU_VOICE_ENABLED__ = true;

  function speak(text) {
    if (!text) return;
    if (window.maruVoiceSpeak) {
      window.maruVoiceSpeak(text);
    }
  }

  function regionText() {
    try {
      return window.readRegionActive?.() || '';
    } catch (e) { return ''; }
  }

  function countryText() {
    try {
      return window.readCountryActive?.() || '';
    } catch (e) { return ''; }
  }

  window.MaruAddon = window.MaruAddon || {};

  MaruAddon.setVoiceEnabled = function (on) {
    window.__MARU_VOICE_ENABLED__ = !!on;
  };

  MaruAddon.respond = function (payload = {}) {
    if (!window.__MARU_VOICE_ENABLED__) return;

    const c = countryText();
    if (c) {
      speak(c);
      return;
    }

    const r = regionText();
    if (r) {
      speak(r);
      return;
    }

    const answer =
      payload.answer ||
      payload.text ||
      '준비된 자료가 없습니다.';

    speak(answer);
  };

  MaruAddon.onTextConfirm = function (text) {
    MaruAddon.respond({ text });
  };

  MaruAddon.onVoiceFinal = function (text) {
    MaruAddon.respond({ text });
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.openRegionModal?.();
  });
})();
