
/* MARU Country → Conversation Context */
(function(){
  const _open = window.openMaruGlobalCountryModal;
  if (typeof _open !== 'function') return;

  window.openMaruGlobalCountryModal = function(countryId, ...args){
    const res = _open.apply(this, [countryId, ...args]);
    if (window.MaruConversationBar){
      MaruConversationBar.show();
      MaruConversationBar.setContext({ level:'country', id: countryId });
    }
    return res;
  };
})();
