/**
 * MARU Conversation Modal
 * - Unified conversation UI for Region / Country / Free topics
 * - Text input always anchored to bottom of Region/Country modal
 * - Voice toggle aware (show/hide text input)
 * - Receives voice input events and renders message log
 */

(function () {
  'use strict';

  if (window.MaruConversationModal) return;

  const STATE = {
    visible: false,
    voiceOn: false,
    context: null
  };

  let container, logArea, inputArea, textInput, sendBtn;

  function createUI() {
    container = document.createElement('div');
    container.id = 'maru-conversation-modal';
    container.style.cssText = `
      position: relative;
      width: 100%;
      border-top: 1px solid #ddd;
      background: #fff;
      display: none;
      box-sizing: border-box;
    `;

    logArea = document.createElement('div');
    logArea.style.cssText = `
      padding: 12px;
      max-height: 220px;
      overflow-y: auto;
      font-size: 14px;
    `;

    inputArea = document.createElement('div');
    inputArea.style.cssText = `
      position: sticky;
      bottom: 0;
      display: flex;
      gap: 8px;
      padding: 10px;
      border-top: 1px solid #eee;
      background: #fafafa;
    `;

    textInput = document.createElement('textarea');
    textInput.placeholder = '질문을 입력하세요…';
    textInput.rows = 2;
    textInput.style.cssText = `
      flex: 1;
      resize: none;
      padding: 6px;
      font-size: 14px;
    `;

    sendBtn = document.createElement('button');
    sendBtn.textContent = '전송';
    sendBtn.style.cssText = `
      padding: 6px 12px;
      cursor: pointer;
    `;

    sendBtn.addEventListener('click', () => {
      const text = textInput.value.trim();
      if (!text) return;
      appendMessage('user', text);
      textInput.value = '';
      dispatchQuery(text);
    });

    inputArea.appendChild(textInput);
    inputArea.appendChild(sendBtn);

    container.appendChild(logArea);
    container.appendChild(inputArea);
  }

  function mount(targetEl) {
    if (!container) createUI();
    if (!targetEl || container.parentNode === targetEl) return;
    targetEl.appendChild(container);
  }

  function show() {
    if (!container) return;
    container.style.display = 'block';
    STATE.visible = true;
  }

  function hide() {
    if (!container) return;
    container.style.display = 'none';
    STATE.visible = false;
  }

  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.style.marginBottom = '8px';
    div.textContent = (role === 'user' ? '▶ ' : '◀ ') + text;
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
  }

  function dispatchQuery(text) {
    if (window.MaruAddon && typeof window.MaruAddon.handleTextQuery === 'function') {
      window.MaruAddon.handleTextQuery({
        text,
        context: STATE.context
      });
    }
  }

  window.addEventListener('maru:voice:input', (e) => {
    const text = e.detail.text;
    appendMessage('user', text);
    dispatchQuery(text);
  });

  window.MaruConversationModal = {
    mountTo(targetEl) {
      mount(targetEl);
      show();
    },
    setContext(ctx) {
      STATE.context = ctx;
    },
    setVoice(on) {
      STATE.voiceOn = on;
      inputArea.style.display = on ? 'none' : 'flex';
      if (!on) show();
    },
    show,
    hide,
    appendAssistant(text) {
      appendMessage('assistant', text);
    }
  };

})();
