// maru-site-control-addon-최상_fix-close-inputswap_v4-voicegreen-checkbox.js
// NOTE: Only visual indicator change (checkbox accent-color green when VOICE ON)

(function(){
  'use strict';

  // ===== Existing globals assumed =====
  // VOICE_ENABLED, $$ selector utility, injectExtensionStyle(), etc.

  // ---- inject CSS (append safely) ----
  function injectVoiceGreenStyle(){
    var css = `
    .maru-country-voice-toggle.voice-live input[type="checkbox"]{
      accent-color:#22c55e;
    }`;
    var style = document.createElement('style');
    style.setAttribute('data-maru','voice-green-checkbox');
    style.textContent = css;
    document.head.appendChild(style);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', injectVoiceGreenStyle);
  } else {
    injectVoiceGreenStyle();
  }

  // ---- hook into existing sync (no logic change) ----
  if(typeof window.syncVoiceToggleUi === 'function'){
    var _orig = window.syncVoiceToggleUi;
    window.syncVoiceToggleUi = function(){
      _orig.apply(this, arguments);
      try{
        var btns = document.querySelectorAll('.maru-country-voice-toggle');
        btns.forEach(function(btn){
          btn.classList.toggle('voice-live', !!window.VOICE_ENABLED);
        });
      }catch(e){}
    };
  }
})();