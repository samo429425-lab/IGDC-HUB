/**
 * PATCHED: MARU GLOBAL COUNTRY MODAL (Conversation + Voice Gate)
 * - 토글 OFF 상태 음성 자동 실행 차단
 * - Conversation 입력창 mount
 */
(function(){
  'use strict';

  const prevOpen = window.openMaruGlobalCountryModal || window.openMaruGlobalCountry;

  function patchedOpen(){
    const res = prevOpen && prevOpen.apply(this, arguments);

    try{
      const modal = document.querySelector('.maru-country-modal');
      if(modal && window.MaruConversationModal){
        MaruConversationModal.mountTo(modal);
        MaruConversationModal.setContext({ level:'country' });
        MaruConversationModal.setVoiceMode(window.MARU_COUNTRY_VOICE_READY === true);
      }
    }catch(_){}

    return res;
  }

  if(window.openMaruGlobalCountryModal){
    window.openMaruGlobalCountryModal = patchedOpen;
  }else if(window.openMaruGlobalCountry){
    window.openMaruGlobalCountry = patchedOpen;
  }

  // TTS gate
  const origSpeak = window.maruVoiceSpeak;
  window.maruVoiceSpeak = function(text){
    if(window.MARU_COUNTRY_VOICE_READY !== true) return;
    return origSpeak && origSpeak(text);
  };
})();