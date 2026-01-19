/* =========================================================
 * MARU Conversation Dock — FINAL (Body Fixed)
 * ---------------------------------------------------------
 * Goal:
 * - Always-visible text input dock that follows Region/Country modals
 * - Does NOT live inside modal/backdrop (prevents z-index/stacking issues)
 * - Routes text → MaruAddon.handleTextQuery({text, context})
 * - Context is updated by Region/Country and also self-heals by DOM observation
 * ========================================================= */

(function(){
  'use strict';

  if (window.MaruConversationDock) return;

  let bar = null;
  let input = null;
  let sendBtn = null;
  let _ctx = null;

  function ensureBar(){
    if (bar) return;

    bar = document.createElement('div');
    bar.id = 'maru-conversation-dock';
    bar.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'height:58px',
      'display:none',
      'align-items:center',
      'gap:10px',
      'padding:0 12px',
      'background:#ffffff',
      'border-top:1px solid #ddd',
      'box-sizing:border-box',
      // must be higher than region modal (99999) and country modal (100001)
      'z-index:100200'
    ].join(';');

    input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = 'Ask MARU…';
    input.style.cssText = [
      'flex:1',
      'height:36px',
      'padding:0 10px',
      'font-size:14px',
      'border:1px solid #ccc',
      'border-radius:8px',
      'outline:none',
      'box-sizing:border-box'
    ].join(';');

    sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = [
      'height:36px',
      'padding:0 14px',
      'border:none',
      'border-radius:8px',
      'background:#1f3a5f',
      'color:#fff',
      'cursor:pointer'
    ].join(';');

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function(e){
      if (e.key === 'Enter') send();
    });

    bar.appendChild(input);
    bar.appendChild(sendBtn);
    document.body.appendChild(bar);
  }

  function normalizeContext(ctx){
    if (!ctx || typeof ctx !== 'object') return null;
    if (!ctx.level) return null;
    return {
      level: ctx.level,
      id: (ctx.id != null) ? ctx.id : null
    };
  }

  function getBestContext(){
    // 1) Conversation modal context (if exists)
    try {
      if (window.MaruConversationModal && typeof window.MaruConversationModal.getContext === 'function') {
        const c = window.MaruConversationModal.getContext();
        const nc = normalizeContext(c);
        if (nc) return nc;
      }
    } catch (_) {}

    // 2) Global shared context
    const g = normalizeContext(window.__MARU_CONTEXT__);
    if (g) return g;

    // 3) Fallback to global active ids
    if (window.activeCountryName) return { level: 'country', id: window.activeCountryName };
    if (window.activeRegionId) return { level: 'region', id: window.activeRegionId };

    return null;
  }

  function setContext(ctx){
    _ctx = normalizeContext(ctx) || getBestContext();
    window.__MARU_CONTEXT__ = _ctx;
  }

  function show(){
    ensureBar();
    bar.style.display = 'flex';
  }

  function hide(){
    if (!bar) return;
    bar.style.display = 'none';
  }

  function focus(){
    ensureBar();
    try { input.focus(); } catch (_) {}
  }

  function clear(){
    if (!input) return;
    input.value = '';
  }

  function send(){
    ensureBar();
    const text = (input.value || '').trim();
    if (!text) return;

    const ctx = _ctx || getBestContext();
    setContext(ctx);

    try {
      if (window.MaruAddon && typeof window.MaruAddon.handleTextQuery === 'function') {
        window.MaruAddon.handleTextQuery({ text, context: ctx || null });
      } else {
        console.log('[MARU][DockText]', { text, context: ctx || null });
      }
    } catch (e) {
      console.warn('[MARU][Dock] send failed', e);
    }

    clear();
  }

  // Self-heal: show/hide based on modal presence (NO timers)
  function syncByDom(){
    const hasRegion = !!document.querySelector('.maru-region-modal');
    const hasCountry = !!document.querySelector('.maru-country-modal');
    if (hasRegion || hasCountry) {
      show();
      setContext(getBestContext());
    } else {
      hide();
    }
  }

  function initObserver(){
    try {
      const mo = new MutationObserver(function(){
        syncByDom();
      });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  // Public API
  window.MaruConversationDock = {
    show,
    hide,
    focus,
    clear,
    send,
    setContext,
    getContext: function(){ return _ctx || getBestContext(); }
  };

  // Initial boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      syncByDom();
      initObserver();
    });
  } else {
    syncByDom();
    initObserver();
  }
})();
