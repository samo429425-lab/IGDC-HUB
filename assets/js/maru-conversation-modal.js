
// MARU Conversation Modal - FINAL
(function(){
  const input = document.querySelector('#maruConversationInput');
  const sendBtn = document.querySelector('#maruConversationSend');

  if(!input || !sendBtn) return;

  function updateBtn(){
    sendBtn.textContent = input.value.trim() ? 'SEND' : 'WAIT';
  }

  input.addEventListener('input', updateBtn);
  updateBtn();

  window.MaruConversationUI = {
    getText(){ return input.value.trim(); },
    clear(){
      input.value = '';
      updateBtn();
    }
  };
})();
