/* =========================================================
 * MARU Site Control Addon — INTEGRATED FIX (v6.3)
 * ---------------------------------------------------------
 * Fixes:
 * - Voice toggle UI sync (Region <-> Country)
 * - Voice default: answers are spoken when VOICE is ON
 * - Input display option: Realtime / Confirm (selection, not toggle)
 * - Detached Pane auto-open rules:
 *     (1) missing item (not in Region/Country list) -> open pane + answer
 *     (2) detailed query (상세/자세/구체/더) -> open pane + answer
 *     (3) existing item + no data -> speak "없습니다" (NO pane)
 * - Self-contained: ensures MaruDetachedPane + MaruConversationDock exist
 * ========================================================= */

(function () {
  'use strict';

  // =====================================================
  // 0) SAFE EXPORT STUB
  // =====================================================
  const MaruAddon = (window.MaruAddon && typeof window.MaruAddon === 'object') ? window.MaruAddon : {};
  const noop = function () {};

  MaruAddon.handleTextQuery = MaruAddon.handleTextQuery || noop;
  MaruAddon.handleVoiceQuery = MaruAddon.handleVoiceQuery || noop;
  MaruAddon.previewVoice = MaruAddon.previewVoice || noop;     // typing only (interim)
  MaruAddon.setVoiceEnabled = MaruAddon.setVoiceEnabled || noop;
  MaruAddon.isVoiceEnabled = MaruAddon.isVoiceEnabled || function () { return false; };
  MaruAddon.setInputDisplayMode = MaruAddon.setInputDisplayMode || noop;
  MaruAddon.getInputDisplayMode = MaruAddon.getInputDisplayMode || function(){ return 'realtime'; };
  MaruAddon.setMediaState = MaruAddon.setMediaState || noop;
  MaruAddon.setMediaPlaying = MaruAddon.setMediaPlaying || noop;
  MaruAddon.bootstrapGlobalInsight = MaruAddon.bootstrapGlobalInsight || noop;
  MaruAddon.requestInsight = MaruAddon.requestInsight || noop;

  window.MaruAddon = MaruAddon;

  // =====================================================
  // 1) BOOT
  // =====================================================
  function safeBoot() {
    try { initAddon(); }
    catch (e) { try { console.error('[MaruAddon] BOOT FAILED', e); } catch (_) {} }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot);
  else safeBoot();

  // =====================================================
  // 2) IMPLEMENTATION
  // =====================================================
  function initAddon() {
    if (MaruAddon.__READY__) return;
    MaruAddon.__READY__ = true;

    // ------------------------------
    // 2.1 State
    // ------------------------------
    let VOICE_ENABLED = false;                 // actual voice service flag
    let ACTIVE_VOICE_SCOPE = null;          // null | 'region' | 'country' (prevents cross-modal voice conflicts)
    let INPUT_MODE = 'realtime';              // 'realtime' | 'confirm'
    const MEDIA_STATE = { video: false, music: false, narration: false };

    const STATE = {
      lastRequest: null,
      lastResponse: null,
      commandHistory: [],
      videoPool: { country: null, list: [] }
    };

    let ENGINE_DEBOUNCE_TIMER = null;
    const ENGINE_DEBOUNCE_DELAY = 250;

    // ------------------------------
    // 2.2 Ensure Detached Pane + Conversation Dock
    // ------------------------------
    ensureDetachedPane();
    ensureConversationDock();

    // ------------------------------
    // 2.3 Helpers
    // ------------------------------
    function setMediaState(kind, on) {
      if (!kind) return;
      MEDIA_STATE[kind] = !!on;
    }
    MaruAddon.setMediaState = setMediaState;
    MaruAddon.setMediaPlaying = function(on){ setMediaState('video', !!on); };

    function ttsSpeak(text) {
      if (!text) return;
      if (!VOICE_ENABLED) return;
      if (MEDIA_STATE.video) return;
      if (typeof window.maruVoiceSpeak !== 'function') return;
      try { window.maruVoiceSpeak(String(text)); } catch (_) {}
    }

    function normalizeContext(ctx) {
      if (!ctx || typeof ctx !== 'object') return null;
      if (!ctx.level) return null;
      return { level: ctx.level, id: (ctx.id != null ? ctx.id : null) };
    }

    function getBestContext() {
      const g = normalizeContext(window.__MARU_CONTEXT__);
      if (g) return g;
      if (window.activeCountryName) return { level: 'country', id: window.activeCountryName };
      if (window.activeRegionId) return { level: 'region', id: window.activeRegionId };
      return null;
    }

    function detectIntent(text) {
      const t = String(text || '').toLowerCase();
      // detail keywords
      if (/(상세|자세|구체|심층|디테일|더\s*자세)/.test(text)) return 'detail';
      if (t.includes('영상')) return 'video';
      if (t.includes('이슈')) return 'realtime';
      return 'summary';
    }

    function isDetailQuery(text){
      return detectIntent(text) === 'detail';
    }

    // ------------------------------
    // 2.4 Item existence / data checks (DOM-based)
    // ------------------------------
    function getOpenModalKind(){
      const hasCountry = !!document.querySelector('.maru-country-modal');
      const hasRegion = !!document.querySelector('.maru-region-modal');
      if (hasCountry) return 'country';
      if (hasRegion) return 'region';
      return null;
    }
// ------------------------------
// 2.4.0 Voice scope gate (prevents Region/Country voice conflict)
// ------------------------------
function updateActiveVoiceScope(trigger){
  const kind = getOpenModalKind();
  const next = (kind === 'country' || kind === 'region') ? kind : null;

  // If scope is leaving an active modal, force voice OFF to avoid stale mic restart
  if (ACTIVE_VOICE_SCOPE && !next && VOICE_ENABLED) {
    setVoiceEnabled(false, 'modal_closed');
  }

  ACTIVE_VOICE_SCOPE = next;

  // When a modal opens while voice is already ON, ensure mic + dock are ready
  if (ACTIVE_VOICE_SCOPE && VOICE_ENABLED) {
    try { window.MaruConversationDock && window.MaruConversationDock.show && window.MaruConversationDock.show(); } catch(_) {}
    try { if (typeof window.startMaruMic === 'function') window.startMaruMic(); } catch(_) {}
  }
}

function voiceScopeAllows(ctx){
  if (!ACTIVE_VOICE_SCOPE) return true;
  if (!ctx || !ctx.level) return false;
  return ctx.level === ACTIVE_VOICE_SCOPE;
}


    function getCountryItemsFromDom(){
      const cards = Array.prototype.slice.call(document.querySelectorAll('.maru-country-card[data-country]'));
      const set = new Set();
      cards.forEach(c => {
        const raw = (c.getAttribute('data-country') || '').trim();
        if (!raw) return;
        set.add(raw);
        // add korean-only token before space or '('
        const k = raw.split('(')[0].trim();
        if (k) set.add(k);
      });
      return set;
    }

    function getRegionItemsFromDom(){
      // Region cards hold data-region ids; we map common Korean aliases
      const set = new Set();
      const cards = Array.prototype.slice.call(document.querySelectorAll('.maru-region-card[data-region]'));
      cards.forEach(c => {
        const id = (c.getAttribute('data-region') || '').trim();
        if (id) set.add(id);
      });
      // common aliases
      [
        ['유럽','europe'], ['아시아','asia'], ['중동','middle_east'], ['아프리카','africa'],
        ['북미','north_america'], ['남미','south_america'], ['중남미','south_america'],
        ['유라시아','eurasia'], ['러시아','eurasia'], ['중앙아시아','eurasia']
      ].forEach(pair => { set.add(pair[0]); set.add(pair[1]); });
      return set;
    }

    function findMentionedCountry(text){
      const items = getCountryItemsFromDom();
      if (!items.size) return null;
      const q = String(text||'');
      // greedy match: any korean country token in list
      for (const it of items) {
        if (!it) continue;
        if (it.length < 2) continue;
        if (q.includes(it)) return it;
      }
      return null;
    }

    function findMentionedRegion(text){
      const q = String(text||'');
      const map = [
        ['유럽','europe'], ['아시아','asia'], ['중동','middle_east'], ['아프리카','africa'],
        ['북미','north_america'], ['남미','south_america'], ['중남미','south_america'],
        ['유라시아','eurasia'], ['러시아','eurasia'], ['중앙아시아','eurasia'],
        ['europe','europe'], ['asia','asia'], ['africa','africa'], ['middle east','middle_east'],
        ['north america','north_america'], ['south america','south_america'], ['eurasia','eurasia']
      ];
      for (const [k,id] of map) {
        if (q.toLowerCase().includes(String(k).toLowerCase())) return id;
      }
      return null;
    }

    function hasDataForCountry(countryKey){
      if (!countryKey) return false;
      const cards = Array.prototype.slice.call(document.querySelectorAll('.maru-country-card[data-country]'));
      for (const c of cards) {
        const raw = (c.getAttribute('data-country') || '').trim();
        const k = raw.split('(')[0].trim();
        if (raw === countryKey || k === countryKey) {
          const brief = c.querySelector('.maru-country-brief');
          const t = (brief && brief.textContent) ? brief.textContent.trim() : '';
          if (!t) return false;
          // treat placeholder as no data
          if (/(분석\s*중|준비\s*중|불러오는\s*중)/.test(t)) return false;
          return true;
        }
      }
      return false;
    }

    function hasDataForRegion(regionId){
      if (!regionId) return false;
      const card = document.querySelector('.maru-region-card[data-region="'+regionId+'"]');
      if (!card) return false;
      const brief = card.querySelector('.maru-region-brief');
      const t = (brief && brief.textContent) ? brief.textContent.trim() : '';
      if (!t) return false;
      if (/(분석\s*중|준비\s*중|불러오는\s*중)/.test(t)) return false;
      return true;
    }

    // ------------------------------
    // 2.5 Input display mode selector UI (Realtime/Confirm)
    // ------------------------------
    function installInputModeSelector(){
      // region header
      const rh = document.querySelector('.maru-region-header');
      const ch = document.querySelector('.maru-country-header');
      [rh, ch].forEach(h => {
        if (!h) return;
        if (h.querySelector('[data-maru-inputmode]')) return;

        const wrap = document.createElement('div');
        wrap.setAttribute('data-maru-inputmode','1');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;';

        const label = document.createElement('span');
        label.textContent = '입력 표시:';
        label.style.cssText = 'color:#6e5a32;font-weight:600;';

        const opt1 = document.createElement('label');
        opt1.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
        const r1 = document.createElement('input');
        r1.type = 'radio'; r1.name = 'maru-inputmode'; r1.value = 'realtime';
        const t1 = document.createElement('span'); t1.textContent = '실시간';

        const opt2 = document.createElement('label');
        opt2.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
        const r2 = document.createElement('input');
        r2.type = 'radio'; r2.name = 'maru-inputmode'; r2.value = 'confirm';
        const t2 = document.createElement('span'); t2.textContent = '확정';

        opt1.appendChild(r1); opt1.appendChild(t1);
        opt2.appendChild(r2); opt2.appendChild(t2);
        wrap.appendChild(label);
        wrap.appendChild(opt1);
        wrap.appendChild(opt2);

        // insert near voice toggle (after toggle if exists)
        const vt = h.querySelector('.maru-region-voice-toggle, .maru-country-voice-toggle');
        if (vt && vt.parentNode) vt.parentNode.insertBefore(wrap, vt.nextSibling);
        else h.appendChild(wrap);

        function syncRadios(){
          r1.checked = (INPUT_MODE === 'realtime');
          r2.checked = (INPUT_MODE === 'confirm');
          // only active when voice is enabled
          r1.disabled = !VOICE_ENABLED;
          r2.disabled = !VOICE_ENABLED;
          wrap.style.opacity = VOICE_ENABLED ? '1' : '.45';
        }
        r1.addEventListener('change', function(){ if (r1.checked) setInputMode('realtime'); });
        r2.addEventListener('change', function(){ if (r2.checked) setInputMode('confirm'); });
        syncRadios();
        // store
        wrap.__syncRadios = syncRadios;
      });
    }

    function syncInputModeUi(){
      const blocks = Array.prototype.slice.call(document.querySelectorAll('[data-maru-inputmode]'));
      blocks.forEach(b => { try { b.__syncRadios && b.__syncRadios(); } catch(_){} });
    }

    function setInputMode(mode){
      INPUT_MODE = (mode === 'confirm') ? 'confirm' : 'realtime';
      syncInputModeUi();
    }

    MaruAddon.setInputDisplayMode = setInputMode;
    MaruAddon.getInputDisplayMode = function(){ return INPUT_MODE; };

    // ------------------------------
    // 2.6 Voice toggle UI sync + handlers
    // ------------------------------
    function setVoiceEnabled(on, reason){
      VOICE_ENABLED = !!on;

      if (VOICE_ENABLED) {
        try { if (typeof window.startMaruMic === 'function') window.startMaruMic(); } catch(_) {}
      } else {
        try { if (typeof window.stopMaruMic === 'function') window.stopMaruMic(); } catch(_) {}
      }

      // show dock whenever voice ON (for typing/confirm)
      try {
        window.MaruConversationDock && window.MaruConversationDock.show && window.MaruConversationDock.show();
      } catch(_) {}

      syncVoiceToggleUi();
    updateActiveVoiceScope('init');
      syncInputModeUi();
    }

    MaruAddon.setVoiceEnabled = setVoiceEnabled;
    MaruAddon.isVoiceEnabled = function(){ return VOICE_ENABLED; };

    function syncVoiceToggleUi(){
      // Region + Country toggles are mirrored
      const btns = Array.prototype.slice.call(document.querySelectorAll('.maru-region-voice-toggle, .maru-country-voice-toggle'));
      btns.forEach(btn => {
        btn.classList.toggle('off', !VOICE_ENABLED);
        // keep text compact
        try {
          const base = btn.textContent.replace(/\s+/g,' ').trim();
          // preserve original language if any
          if (/voice/i.test(base) || /음성/.test(base)) {
            // do nothing
          }
        } catch(_) {}
      });
      // expose for other scripts
      window.__MARU_VOICE_TOGGLE__ = VOICE_ENABLED;
    }

    // Click delegation for voice toggles
    document.addEventListener('click', function(e){
      const t = e.target;
      if (!t) return;
      const btn = t.closest && t.closest('.maru-region-voice-toggle, .maru-country-voice-toggle');
      if (!btn) return;
      e.preventDefault();
      setVoiceEnabled(!VOICE_ENABLED, 'ui');
    }, true);

    // Region modal close: must force voice off
    // We hook by capturing clicks on known close buttons
    document.addEventListener('click', function(e){
      const t = e.target;
      if (!t) return;
      const btn = t.closest && t.closest('.maru-region-close');
      if (!btn) return;
      // region close -> voice off + ui sync
      setVoiceEnabled(false, 'region_close');
      setInputMode('realtime');
    }, true);


// Country modal close: must force voice off (prevents mic auto-restart on close)
document.addEventListener('click', function(e){
  const t = e.target;
  if (!t) return;
  const btn = t.closest && t.closest('.maru-country-close');
  if (!btn) return;
  setVoiceEnabled(false, 'country_close');
  setInputMode('realtime');
  updateActiveVoiceScope('country_close');
}, true);

// Backdrop click (region/country) can close modals — force voice off safely
document.addEventListener('click', function(e){
  const t = e.target;
  if (!t) return;
  if (t.classList && (t.classList.contains('maru-country-backdrop') || t.classList.contains('maru-region-backdrop'))) {
    setVoiceEnabled(false, 'backdrop_close');
    setInputMode('realtime');
    updateActiveVoiceScope('backdrop_close');
  }
}, true);
    // Install close button positioning: ensure it sits right of voice toggle
    function normalizeHeaderButtons(){
      // Region
      const rh = document.querySelector('.maru-region-header');
      if (rh) {
        const close = rh.querySelector('.maru-region-close');
        const toggle = rh.querySelector('.maru-region-voice-toggle');
        if (close && toggle && close.parentNode === rh) {
          // header is grid; ensure close after toggle
          try {
            if (toggle.nextSibling !== close) {
              rh.insertBefore(close, toggle.nextSibling);
            }
          } catch(_) {}
        }
      }
      // Country
      const ch = document.querySelector('.maru-country-header');
      if (ch) {
        const close = ch.querySelector('.maru-country-close');
        const toggle = ch.querySelector('.maru-country-voice-toggle');
        if (close && toggle && close.parentNode === ch) {
          try {
            if (toggle.nextSibling !== close) {
              ch.insertBefore(close, toggle.nextSibling);
            }
          } catch(_) {}
        }
      }
    }

    // Observe DOM changes (modals open/close)
    const mo = new MutationObserver(function(){
      try{
        installInputModeSelector();
        normalizeHeaderButtons();
        syncVoiceToggleUi();
        updateActiveVoiceScope('mutation');
      }catch(_){}
    });
    try { mo.observe(document.documentElement, { childList:true, subtree:true }); } catch(_) {}

    // initial
    installInputModeSelector();
    normalizeHeaderButtons();
    syncVoiceToggleUi();

    // ------------------------------
    // 2.7 Conversation Dock integration
    // ------------------------------
    function setTypingText(text){
      if (!text) return;
      try {
        window.MaruConversationDock && window.MaruConversationDock.setText && window.MaruConversationDock.setText(text);
      } catch(_) {}
    }
    function appendTypingText(text){
      if (!text) return;
      try {
        window.MaruConversationDock && window.MaruConversationDock.appendText && window.MaruConversationDock.appendText(text);
      } catch(_) {}
    }

    MaruAddon.previewVoice = function(text, context){
      if (!VOICE_ENABLED) return;

      const ctx = normalizeContext(context) || getBestContext() || null;
      if (!voiceScopeAllows(ctx)) return;

      // Realtime typing should always be visible in the input box (ChatGPT-like)
      // Confirm mode: still show the live transcript so user can edit before Send
      setTypingText(text);
    };

    // ------------------------------
    // 2.8 Command normalize / dispatch
    // ------------------------------
    function normalizeCommand({ input, text, context }) {
      const raw = String(text || '').trim();
      if (!raw) return null;

      const ctx = normalizeContext(context) || getBestContext() || null;

      let scope = 'global';
      let target = null;
      if (ctx && ctx.level === 'region') { scope = 'region'; target = ctx.id || null; }
      if (ctx && ctx.level === 'country') { scope = 'country'; target = ctx.id || null; }

      return {
        source: 'user',
        input: input || 'text',
        text: raw,
        scope,
        target,
        intent: detectIntent(raw),
        voiceWanted: (input === 'voice')
      };
    }

    function callInsightEngine(req) {
      return fetch('/.netlify/functions/maru-global-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: req.text,
          scope: req.scope,
          depth: req.intent
        })
      }).then(function (r) { return r.json(); });
    }

    function normalizeEngineResponse(raw) {
      const ok = !!(raw && (raw.ok !== false));
      const text = (raw && (raw.text || raw.answer || raw.message)) ? String(raw.text || raw.answer || raw.message) : '';
      const data = (raw && raw.data) ? raw.data : raw;
      return { ok, text, data, raw };
    }

    function openDetailPane(title, text){
      ensureDetachedPane();
      try {
        window.MaruDetachedPane.open({ type:'detail', title: title || 'MARU', text: text || '' });
      } catch (_) {}
    }

    function shouldOpenPane(req){
      // Rule:
      // - Missing item (not in list) -> pane
      // - Detail query -> pane
      // - Existing item + no data -> NO pane
      const q = req.text || '';
      const detail = isDetailQuery(q);

      const kind = getOpenModalKind();
      if (kind === 'country') {
        const mentioned = findMentionedCountry(q);
        if (!mentioned) return true;          // missing item
        if (detail) return true;              // detail request
        // existing item
        return false;
      }
      if (kind === 'region') {
        const mentioned = findMentionedRegion(q);
        // Only treat as "existing item" when a region keyword is explicitly mentioned.
        // This prevents generic questions (with req.target set) from being misclassified as existing.
        if (!mentioned) return true;          // missing item / other topic -> pane
        if (detail) return true;              // detail request -> pane
        return false;                         // existing region summary -> no pane
      }
      // No modal: any global question -> pane (acts as search window)
      return true;
    }

    function existingItemButNoData(req){
      const q = req.text || '';
      const kind = getOpenModalKind();

      if (kind === 'country') {
        const mentioned = findMentionedCountry(q);
        if (!mentioned) return false; // missing item handled elsewhere
        if (isDetailQuery(q)) return false;
        // existing item: check data
        // if target exists but brief is placeholder -> no data
        const has = hasDataForCountry(mentioned);
        return !has;
      }

      if (kind === 'region') {
        const regionId = findMentionedRegion(q) || req.target;
        if (!regionId) return false;
        if (isDetailQuery(q)) return false;
        const has = hasDataForRegion(regionId);
        return !has;
      }

      return false;
    }

    function buildNoDataMessage(req){
      const q = req.text || '';
      const kind = getOpenModalKind();

      if (kind === 'country') {
        const mentioned = findMentionedCountry(q);
        const name = (mentioned || req.target || '해당 국가');
        return name + '에 대한 데이터가 없습니다.';
      }
      if (kind === 'region') {
        const regionId = findMentionedRegion(q) || req.target;
        const labelMap = {
          europe:'유럽', asia:'아시아', eurasia:'유라시아', north_america:'북미', south_america:'남미', middle_east:'중동', africa:'아프리카'
        };
        const nm = labelMap[regionId] || '해당 권역';
        return nm + '에 대한 데이터가 없습니다.';
      }
      return '준비된 자료가 없습니다.';
    }

    function routeResponse(req, res, openedPane) {
      // Injectors (keep all existing hooks)
      if (req.scope === 'global') {
        if (typeof window.injectMaruGlobalRegionData === 'function') {
          try { window.injectMaruGlobalRegionData(res.data && res.data.regions ? res.data.regions : (res.data || [])); } catch (_) {}
        }
        if (typeof window.injectMaruGlobalCountryData === 'function') {
          try { window.injectMaruGlobalCountryData(res.data && res.data.countries ? res.data.countries : (res.data || [])); } catch (_) {}
        }
      }

      if (req.scope === 'region' && typeof window.injectRegionContextResult === 'function') {
        try {
          window.injectRegionContextResult(req.target, {
            summary: res.text || '',
            issues: (res.data && res.data.issues) ? res.data.issues : null,
            raw: res.raw
          });
        } catch (_) {}
      }

      if (req.scope === 'country' && typeof window.injectCountryContextResult === 'function') {
        try {
          window.injectCountryContextResult(req.target, {
            summary: res.text || '',
            issues: (res.data && res.data.issues) ? res.data.issues : null,
            videos: (res.data && res.data.videos) ? res.data.videos : null,
            raw: res.raw
          });
        } catch (_) {}
      }

      // Videos hook
      if (req.scope === 'country' && res.data && Array.isArray(res.data.videos) && typeof window.injectMaruCountryVideos === 'function') {
        try {
          STATE.videoPool.country = req.target;
          STATE.videoPool.list = res.data.videos;
          window.injectMaruCountryVideos({ country: req.target, videos: res.data.videos });
        } catch (_) {}
      }

      // Detached pane content
      if (openedPane) {
        const title = (req.scope === 'country' ? ('Country: ' + (req.target || '')) :
                      (req.scope === 'region' ? ('Region: ' + (req.target || '')) : 'Global'));
        openDetailPane(title, res.text || '');
      }

      // Speak always when voice is ON
      ttsSpeak(res.text || '');
    }

    function dispatchCommand(req) {
      if (!req || !req.text) return;
      STATE.lastRequest = req;
      STATE.commandHistory.push({ role: 'user', text: req.text });

      // Rule: if existing item but no data (and not detail) -> speak "없습니다", no engine call
      if (existingItemButNoData(req)) {
        const msg = buildNoDataMessage(req);
        // show message in pane? 규칙상 X
        ttsSpeak(msg);
        return;
      }

      const openPane = shouldOpenPane(req);

      if (ENGINE_DEBOUNCE_TIMER) clearTimeout(ENGINE_DEBOUNCE_TIMER);
      ENGINE_DEBOUNCE_TIMER = setTimeout(function () {
        callInsightEngine(req)
          .then(function (raw) {
            const res = normalizeEngineResponse(raw);
            STATE.lastResponse = res;
            STATE.commandHistory.push({ role: 'assistant', text: res.text || '' });

            // If engine failed: speak fallback + if pane rule says open -> open pane with fallback
            if (!res.ok) {
              const fb = (openPane ? (res.text || '준비된 자료가 없습니다.') : buildNoDataMessage(req));
              if (openPane) openDetailPane('MARU', fb);
              ttsSpeak(fb);
              return;
            }

            routeResponse(req, res, openPane);
          })
          .catch(function (err) {
            try { console.error('[MaruAddon] engine error', err); } catch (_) {}
            const fb = '현재 엔진 응답을 가져오지 못했습니다.';
            if (openPane) openDetailPane('MARU', fb);
            ttsSpeak(fb);
          });
      }, ENGINE_DEBOUNCE_DELAY);
    }

    // ------------------------------
    // 2.9 Public APIs (text / voice)
    // ------------------------------
    function routeInbound({ input, text, context }) {
      const cmd = normalizeCommand({ input, text, context });
      if (!cmd) return;

      // always keep global context updated for other scripts
      const ctx = normalizeContext(context) || getBestContext();
      if (ctx) window.__MARU_CONTEXT__ = ctx;

      dispatchCommand(cmd);
    }

    MaruAddon.handleTextQuery = function (payload, context = {}) {
      if (payload && typeof payload === 'object') return routeInbound({ input:'text', text: payload.text || '', context: payload.context || null });
      return routeInbound({ input:'text', text: payload || '', context });
    };

    MaruAddon.handleVoiceQuery = function (payload, context = {}) {
      if (!VOICE_ENABLED) return;

      let text = '';
      let ctx = context;

      if (payload && typeof payload === 'object') {
        text = payload.text || '';
        ctx = payload.context || null;
      } else {
        text = payload || '';
      }

      text = String(text || '').trim();
      if (!text) return;

      // Resolve context + apply voice scope gate (prevents Region/Country conflict)
      const resolvedCtx = normalizeContext(ctx) || getBestContext() || null;
      if (!voiceScopeAllows(resolvedCtx)) return;
      // show typing always
      if (resolvedCtx) window.__MARU_CONTEXT__ = resolvedCtx;
      setTypingText(text);

      // mode
      if (INPUT_MODE === 'confirm') {
        // Do NOT auto-dispatch. User confirms with Send.
        // Dock 'Send' already routes to handleTextQuery.
        return;
      }

      // realtime: auto dispatch
      routeInbound({ input:'voice', text, context: resolvedCtx });
    };

    // ------------------------------
    // 2.10 Site-control hooks (optional)
    // ------------------------------
    MaruAddon.bootstrapGlobalInsight = function(){
      routeInbound({ input:'system', text:'글로벌 인사이트 전체 수집', context: { level:'global', id:null }});
    };
    MaruAddon.requestInsight = function(){
      routeInbound({ input:'system', text:'실시간 글로벌 이슈', context: { level:'global', id:null }});
    };

    // Expose minimal diagnostics
    MaruAddon.__state = STATE;
  }

  // =====================================================
  // 3) INLINE: Detached Pane (only if missing)
  // =====================================================
  function ensureDetachedPane() {
    if (window.MaruDetachedPane) return;

    let zIndexBase = 3000;

    function createPane(opts){
      const title = (opts && opts.title) ? opts.title : '';
      const text = (opts && opts.text) ? opts.text : '';
      const pane = document.createElement('div');
      pane.className = 'maru-detached-pane';
      pane.style.cssText = 'position:fixed;left:120px;top:120px;width:min(900px,92vw);max-height:80vh;background:#fff;border:1px solid #ddd;border-radius:14px;box-shadow:0 22px 70px rgba(0,0,0,.25);z-index:'+ (zIndexBase++) +';overflow:hidden;display:flex;flex-direction:column;';
      pane.innerHTML = ''
        + '<div class="maru-pane-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee;background:#fafafa;">'
        +   '<span class="maru-pane-title" style="font-weight:800;color:#1f3a5f;">'+ escapeHtml(title) +'</span>'
        +   '<button class="maru-pane-close" style="border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 10px;cursor:pointer;">✕</button>'
        + '</div>'
        + '<div class="maru-pane-body" style="padding:12px 14px;overflow:auto;font-size:13px;line-height:1.6;"></div>';

      const body = pane.querySelector('.maru-pane-body');
      body.innerHTML = '<div class="maru-pane-text" style="white-space:pre-wrap;">'+ escapeHtml(text) +'</div>';

      document.body.appendChild(pane);
      bindClose(pane);
      makeDraggable(pane);
      return pane;
    }

    function bindClose(pane){
      const btn = pane.querySelector('.maru-pane-close');
      if (!btn) return;
      btn.onclick = function(){
        try { window.MaruAddon && window.MaruAddon.setMediaState && window.MaruAddon.setMediaState('video', false); } catch(_) {}
        pane.remove();
      };
    }

    function makeDraggable(pane){
      const header = pane.querySelector('.maru-pane-header');
      if (!header) return;
      let startX=0,startY=0,startLeft=0,startTop=0, dragging=false;
      header.addEventListener('pointerdown', function(e){
        dragging = true;
        pane.style.zIndex = zIndexBase++;
        startX = e.clientX; startY = e.clientY;
        const rect = pane.getBoundingClientRect();
        startLeft = rect.left; startTop = rect.top;
        header.setPointerCapture(e.pointerId);
      });
      header.addEventListener('pointermove', function(e){
        if (!dragging) return;
        pane.style.left = (startLeft + (e.clientX - startX)) + 'px';
        pane.style.top  = (startTop  + (e.clientY - startY)) + 'px';
      });
      header.addEventListener('pointerup', function(e){
        dragging = false;
        try { header.releasePointerCapture(e.pointerId); } catch(_) {}
      });
    }

    function escapeHtml(str){
      return String(str || '').replace(/[&<>"']/g, function(s){
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]) || s;
      });
    }

    window.MaruDetachedPane = {
      open: function(opts){
        const o = opts || {};
        // only detail needed for now
        createPane({ title: o.title || 'MARU', text: o.text || '' });
      }
    };
  }

  // =====================================================
  // 4) INLINE: Conversation Dock (only if missing)
  // =====================================================
  function ensureConversationDock(){
    if (window.MaruConversationDock) return;

    let bar=null, input=null, sendBtn=null;
    let _ctx=null;

    function ensure(){
      if (bar) return;

      bar = document.createElement('div');
      bar.id = 'maru-conversation-dock';
      bar.style.cssText = [
        'position:fixed',
        'left:50%',
        'transform:translateX(-50%)',
        'bottom:12px',
        'width:min(920px,92vw)',
        'height:64px',
        'display:none',
        'align-items:center',
        'gap:10px',
        'padding:0 12px',
        'background:#ffffff',
        'border:1px solid #ddd',
        'border-radius:18px',
        'box-sizing:border-box',
        'z-index:200500',
        'box-shadow:0 18px 50px rgba(0,0,0,.22)'
      ].join(';');

      input = document.createElement('input');
      input.type='text';
      input.placeholder='Ask MARU…';
      input.autocomplete='off';
      input.style.cssText = 'flex:1;height:40px;padding:0 10px;font-size:14px;border:1px solid #ccc;border-radius:12px;outline:none;box-sizing:border-box;';
      input.addEventListener('keydown', function(e){
        if (e.key === 'Enter') send();
      });

      sendBtn = document.createElement('button');
      sendBtn.type='button';
      sendBtn.textContent='Send';
      sendBtn.style.cssText = 'height:40px;padding:0 14px;border:none;border-radius:12px;background:#1f3a5f;color:#fff;cursor:pointer;font-weight:700;';
      sendBtn.addEventListener('click', send);

      bar.appendChild(input);
      bar.appendChild(sendBtn);
      document.body.appendChild(bar);
    }

    function normalizeContext(ctx){
      if (!ctx || typeof ctx !== 'object') return null;
      if (!ctx.level) return null;
      return { level: ctx.level, id: (ctx.id != null) ? ctx.id : null };
    }

    function bestContext(){
      const g = normalizeContext(window.__MARU_CONTEXT__);
      if (g) return g;
      if (window.activeCountryName) return { level:'country', id: window.activeCountryName };
      if (window.activeRegionId) return { level:'region', id: window.activeRegionId };
      return null;
    }

    function send(){
      ensure();
      const text = (input.value || '').trim();
      if (!text) return;
      const ctx = _ctx || bestContext();
      window.__MARU_CONTEXT__ = ctx;
      try { window.MaruAddon && window.MaruAddon.handleTextQuery && window.MaruAddon.handleTextQuery(text, ctx); } catch(_) {}
      input.value = '';
    }

    window.MaruConversationDock = {
      show: function(){ ensure(); bar.style.display='flex'; },
      hide: function(){ if(!bar) return; bar.style.display='none'; },
      setContext: function(ctx){ _ctx = normalizeContext(ctx) || bestContext(); window.__MARU_CONTEXT__ = _ctx; },
      getContext: function(){ return _ctx || bestContext(); },
      setText: function(t){ ensure(); input.value = String(t||''); },
      appendText: function(t){ ensure(); input.value = String(input.value||'') + String(t||''); },
      focus: function(){ ensure(); try{ input.focus(); }catch(_){} }
    };
  }

})();