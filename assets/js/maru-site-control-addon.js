
// MARU Site Control Addon - FINAL
(function(){
  function isConversational(q){
    return !/(region|country|국가|권역)/i.test(q);
  }

  function openDetail(query){
    if(window.openMaruDetailPane){
      window.openMaruDetailPane(query);
    }
  }

  window.MaruAddon = {
    handleQuery(query, meta){
      const conversational = meta?.source === 'voice' || isConversational(query);
      if(conversational){
        openDetail(query);
      }
      if(window.maruVoiceSpeak){
        window.maruVoiceSpeak('요청을 처리 중입니다.');
      }
    }
  };
})();
