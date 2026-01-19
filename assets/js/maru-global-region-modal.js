
/* MARU Region → Conversation Context */
(function(){
  const _open = window.openMaruGlobalRegionModal;
  if (typeof _open !== 'function') return;

  window.openMaruGlobalRegionModal = function(regionId, ...args){
    const res = _open.apply(this, [regionId, ...args]);
    if (window.MaruConversationBar){
      MaruConversationBar.show();
      MaruConversationBar.setContext({ level:'region', id: regionId });
    }
    return res;
  };
})();
