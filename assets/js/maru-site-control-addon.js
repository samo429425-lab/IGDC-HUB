/* 
 MARU Site Control Addon - Stable v1
 기준:
 - 기존 기능 100% 유지
 - 음성 토글 단일 상태 동기화
 - 레기온 CLOSE 시 전역 음성 OFF
 - 확장창 정식 hook 구조
*/

(function () {
  'use strict';

  if (!window.MaruAddon) window.MaruAddon = {};

  const AddonState = {
    voiceEnabled: false,
    regionOpen: false,
    countryOpen: false
  };

  function setVoiceState(on) {
    AddonState.voiceEnabled = !!on;
    try {
      window.dispatchEvent(new CustomEvent('maru:voice-sync', {
        detail: { enabled: AddonState.voiceEnabled }
      }));
    } catch (_) {}
  }

  function stopVoiceIfNeeded() {
    if (!AddonState.regionOpen) {
      setVoiceState(false);
      if (window.stopMaruMic) window.stopMaruMic();
    }
  }

  window.addEventListener('maru:region-open', function () {
    AddonState.regionOpen = true;
  });

  window.addEventListener('maru:region-close', function () {
    AddonState.regionOpen = false;
    stopVoiceIfNeeded();
  });

  window.addEventListener('maru:country-open', function () {
    AddonState.countryOpen = true;
  });

  window.addEventListener('maru:country-close', function () {
    AddonState.countryOpen = false;
  });

  window.MaruAddon.setVoiceEnabled = function (on) {
    setVoiceState(on);
  };

  window.MaruAddon.isVoiceEnabled = function () {
    return AddonState.voiceEnabled;
  };

  window.MaruAddon.requestInsight = function () {
    if (typeof dispatchCommand === 'function') {
      dispatchCommand({
        source: 'panel',
        input: 'system',
        text: '실시간 글로벌 이슈',
        scope: 'global',
        target: null,
        intent: 'realtime',
        voiceWanted: AddonState.voiceEnabled
      });
    }
  };

  // 확장창 출력 hook (출력 전용)
  window.addEventListener('maru:insight-response', function (e) {
    const res = e.detail || {};
    if (res && res.expand === true) {
      try {
        window.openMaruExpandModal && window.openMaruExpandModal(res);
      } catch (_) {}
    }
  });

  try { console.log('[MaruAddon] STABLE READY'); } catch (_) {}

})();