/* =========================================================
 * MARU Conversation Overlay Dock — FINAL (Modal-Aware)
 * ---------------------------------------------------------
 * - Rendered as a body-level overlay (Addon-owned)
 * - Visually attaches to the active Region/Country modal (no card clipping)
 * - Adds bottom padding to modal scroll area equal to overlay height
 * - Text routes to: MaruAddon.handleTextQuery(...)
 * ========================================================= */

(function(){
  'use strict';

  // Idempotent
  if (window.MaruConversationDock) return;

  var bar = null;
  var input = null;
  var sendBtn = null;
  var _ctx = null;
  var _activeModal = null;
  var _lastModalKey = '';
  var _raf = 0;
  var _paddingAppliedTo = null;
  var _paddingPrev = null;

  var DOCK_HEIGHT = 58;
  var DOCK_GAP = 10; // visual gap from modal edge

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function ensureBar(){
    if (bar) return;

    bar = document.createElement('div');
    bar.id = 'maru-conversation-dock';
    bar.style.cssText = [
      'position:fixed',
      'height:'+DOCK_HEIGHT+'px',
      'display:none',
      'align-items:center',
      'gap:10px',
      'padding:0 12px',
      'background:#ffffff',
      'border:1px solid #ddd',
      'border-radius:12px',
      'box-sizing:border-box',
      // higher than region modal (99999) and country modal (100001)
      'z-index:100200',
      // safe-area
      'padding-bottom:calc(0px + env(safe-area-inset-bottom))'
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
      'border-radius:10px',
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
      'border-radius:10px',
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
    return { level: ctx.level, id: (ctx.id != null) ? ctx.id : null };
  }

  function getBestContext(){
    // 1) explicit global context
    var g = normalizeContext(window.__MARU_CONTEXT__);
    if (g) return g;

    // 2) fallbacks
    if (window.activeCountryName) return { level: 'country', id: window.activeCountryName };
    if (window.activeRegionId) return { level: 'region', id: window.activeRegionId };

    return null;
  }

  function setContext(ctx){
    _ctx = normalizeContext(ctx) || getBestContext();
    window.__MARU_CONTEXT__ = _ctx;
  }

  function getContext(){
    return _ctx || getBestContext();
  }

  function show(){
    ensureBar();
    bar.style.display = 'flex';
    scheduleLayout();
  }

  function hide(){
    if (!bar) return;
    bar.style.display = 'none';
    detachPadding();
    _activeModal = null;
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
    var text = (input.value || '').trim();
    if (!text) return;

    var ctx = getContext();
    setContext(ctx);

    try {
      if (window.MaruAddon && typeof window.MaruAddon.handleTextQuery === 'function') {
        // Prefer object payload
        window.MaruAddon.handleTextQuery({ text: text, context: ctx || null });
      } else if (window.MaruAddon && typeof window.MaruAddon.handleVoiceQuery === 'function') {
        // Fallback: some builds route all through handleVoiceQuery
        window.MaruAddon.handleVoiceQuery({ text: text, context: ctx || null });
      } else {
        console.log('[MARU][DockText]', { text: text, context: ctx || null });
      }
    } catch (e) {
      console.warn('[MARU][Dock] send failed', e);
    }

    clear();
  }

  function findActiveModal(){
    // Prefer country if both exist
    var c = document.querySelector('.maru-country-modal');
    if (c) return c;
    var r = document.querySelector('.maru-region-modal');
    if (r) return r;
    return null;
  }

  function getModalKey(modal){
    if (!modal) return '';
    if (modal.classList.contains('maru-country-modal')) return 'country';
    if (modal.classList.contains('maru-region-modal')) return 'region';
    return 'modal';
  }

  function applyPadding(modal){
    if (!modal) return;

    var scrollEl = modal.querySelector('.maru-country-body') || modal.querySelector('.maru-region-body') || null;
    if (!scrollEl) return;

    // If switching modals, restore old padding first
    if (_paddingAppliedTo && _paddingAppliedTo !== scrollEl) detachPadding();

    if (_paddingAppliedTo !== scrollEl) {
      _paddingAppliedTo = scrollEl;
      _paddingPrev = {
        paddingBottom: scrollEl.style.paddingBottom || ''
      };
    }

    // Ensure content never gets hidden behind the overlay
    scrollEl.style.paddingBottom = (DOCK_HEIGHT + DOCK_GAP + 20) + 'px';
  }

  function detachPadding(){
    if (!_paddingAppliedTo) return;
    try {
      _paddingAppliedTo.style.paddingBottom = (_paddingPrev && _paddingPrev.paddingBottom != null) ? _paddingPrev.paddingBottom : '';
    } catch (_) {}
    _paddingAppliedTo = null;
    _paddingPrev = null;
  }

  function layoutToModal(modal){
    if (!bar || !modal) return;

    var rect = modal.getBoundingClientRect();
    // If modal is offscreen (shouldn't, but guard)
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    // Compute a dock box that sits on the modal bottom edge (overlay)
    var margin = 8;
    var left = rect.left + margin;
    var width = rect.width - (margin * 2);
    width = Math.max(240, width);

    // Clamp within viewport
    left = clamp(left, 6, Math.max(6, window.innerWidth - width - 6));
    var bottomOffset = (window.innerHeight - rect.bottom) + DOCK_GAP;
    bottomOffset = Math.max(DOCK_GAP, bottomOffset);

    bar.style.left = left + 'px';
    bar.style.right = 'auto';
    bar.style.width = width + 'px';
    bar.style.bottom = 'calc(' + bottomOffset + 'px + env(safe-area-inset-bottom))';
  }

  function scheduleLayout(){
    if (_raf) return;
    _raf = window.requestAnimationFrame(function(){
      _raf = 0;
      sync();
    });
  }

  function sync(){
    var modal = findActiveModal();
    var key = getModalKey(modal);

    // Only react on transitions
    var modalKey = key + ':' + (modal ? '1' : '0');
    if (modalKey !== _lastModalKey) {
      _lastModalKey = modalKey;
      if (!modal) {
        hide();
        return;
      }
      // show when modal appears
      show();
      setContext(getBestContext());
    }

    if (!modal) return;
    _activeModal = modal;

    applyPadding(modal);
    layoutToModal(modal);
  }

  function initObserver(){
    try {
      var mo = new MutationObserver(function(){
        scheduleLayout();
      });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  function initWindowHooks(){
    window.addEventListener('resize', scheduleLayout);
    window.addEventListener('orientationchange', scheduleLayout);
    window.addEventListener('scroll', scheduleLayout, true);
  }

  // Public API
  window.MaruConversationDock = {
    show: show,
    hide: hide,
    focus: focus,
    clear: clear,
    send: send,
    setContext: setContext,
    getContext: getContext,
    // Useful for debugging
    _sync: scheduleLayout
  };

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      ensureBar();
      initObserver();
      initWindowHooks();
      scheduleLayout();
    });
  } else {
    ensureBar();
    initObserver();
    initWindowHooks();
    scheduleLayout();
  }
})();
