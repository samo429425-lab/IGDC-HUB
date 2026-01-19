
/* MARU Conversation Bar (One-line Dock) */
(function(){
  if (window.MaruConversationBar) return;

  let bar, input, sendBtn;
  let context = null;

  function create(){
    bar = document.createElement('div');
    bar.id = 'maru-conversation-bar';
    bar.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'height:60px',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:0 12px',
      'background:#ffffff',
      'border-top:1px solid #ddd',
      'z-index:100010'
    ].join(';');

    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Ask MARU…';
    input.style.cssText = [
      'flex:1',
      'height:36px',
      'font-size:14px',
      'padding:0 10px'
    ].join(';');

    sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = 'height:36px;';

    sendBtn.onclick = send;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') send();
    });

    bar.appendChild(input);
    bar.appendChild(sendBtn);
    document.body.appendChild(bar);
  }

  function send(){
    const text = input.value.trim();
    if (!text) return;
    console.log('[MARU][Conversation]', { text, context });
    // Hook to addon / engine later
    input.value = '';
  }

  window.MaruConversationBar = {
    show(){
      if (!bar) create();
      bar.style.display = 'flex';
      input.focus();
    },
    hide(){
      if (bar) bar.style.display = 'none';
    },
    setContext(ctx){
      context = ctx;
      console.log('[MARU][Context]', ctx);
    }
  };
})();
