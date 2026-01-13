/**
 * MARU Conversation Modal (FULL, STABLE)
 * --------------------------------------
 * 역할:
 * - 문자 입력 UI 제공 (AI / Addon / Engine 공통)
 * - 음성 모드와 문자 모드 명확 분리
 *
 * 정책:
 * - voiceMode = false (기본): 문자 입력창 항상 표시
 * - voiceMode = true  : 문자 입력창 숨김
 * - 외부에서 show / hide / setVoiceMode 제어 가능
 */

(function () {
  'use strict';

  if (window.MaruConversationModal) return;

  let container = null;
  let inputWrap = null;
  let inputEl = null;
  let sendBtn = null;

  let mounted = false;
  let voiceMode = false;
  let context = null;

  function createUI() {
    container = document.createElement('div');
    container.className = 'maru-conversation-container';
    container.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 12px;
      background: #fff;
      border-top: 1px solid #ddd;
      z-index: 10;
    `;

    inputWrap = document.createElement('div');
    inputWrap.style.display = 'flex';
    inputWrap.style.gap = '8px';

    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = '질문을 입력하세요';
    inputEl.style.cssText = `
      flex: 1;
      padding: 10px;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-size: 14px;
    `;

    sendBtn = document.createElement('button');
    sendBtn.textContent = '전송';
    sendBtn.style.cssText = `
      padding: 10px 14px;
      border: none;
      background: #1f3a5f;
      color: #fff;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    `;

    inputWrap.appendChild(inputEl);
    inputWrap.appendChild(sendBtn);
    container.appendChild(inputWrap);

    sendBtn.addEventListener('click', submitText);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitText();
    });
  }

  function submitText() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';

    if (window.MaruAddon && typeof window.MaruAddon.handleTextQuery === 'function') {
      window.MaruAddon.handleTextQuery(text, context);
    }
  }

  function mountTo(target) {
    if (!container) createUI();
    if (mounted) return;

    target.appendChild(container);
    mounted = true;

    applyVisibility();
  }

  function applyVisibility() {
    if (!inputWrap) return;
    inputWrap.style.display = voiceMode ? 'none' : 'flex';
  }

  function showInput() {
    voiceMode = false;
    applyVisibility();
  }

  function hideInput() {
    voiceMode = true;
    applyVisibility();
  }

  function setVoiceMode(on) {
    voiceMode = !!on;
    applyVisibility();
  }

  function setContext(ctx) {
    context = ctx || null;
  }

  // expose
  window.MaruConversationModal = {
    mountTo,
    showInput,
    hideInput,
    setVoiceMode,
    setContext
  };

})();
