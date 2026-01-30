/* =========================================================
 * MARU Site Control Addon — FIXED (v7.0)
 * ---------------------------------------------------------
 * Goals (per 운영 규칙):
 * 1) Addon is the ONLY owner of voice + conversation routing.
 * 2) Voice toggle is SINGLE state, mirrored across Region/Country.
 * 3) Region/Country modal open/close MUST NOT auto-disable voice.
 * 4) Extension Window (확장창) is DEFAULT OPEN:
 *    - Opens on Voice ON, Voice/Text input, and after engine response.
 *    - It may be temporarily hidden ONLY when Region/Country dashboard has data.
 * 5) Minimal regressions: keep existing global buttons (AI 글로벌 인사이트 / 실시간 이슈) working.
 * ========================================================= */

(function () {
  'use strict';

  // ---------- Idempotent hard replace ----------
  try { if (window.MaruAddon && window.MaruAddon.__MARU_ADDON_VER__) { /* allow overwrite */ } } catch(_) {}

  // ---------- STATE ----------
  let VOICE_ENABLED = false;          // single source of truth
  let MEDIA_PLAYING = false;          // block TTS when media playing
  let INPUT_MODE = 'realtime';        // 'realtime' | 'confirm' (kept for compatibility)
  const ENGINE_DEBOUNCE_DELAY = 250;
  let ENGINE_DEBOUNCE_TIMER = null;

  const STATE = {
    lastRequest: null,
    lastResponse: null,
    commandHistory: []
  };

  // ---------- UTIL ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  function safe(fn){ try { fn && fn(); } catch(_){} }

  function normalizeContext(ctx){
    if (!ctx || typeof ctx !== 'object') return null;
    if (!ctx.level) return null;
    return { level: ctx.level, id: (ctx.id != null ? ctx.id : null) };
  }
  function getBestContext(){
    const g = normalizeContext(window.__MARU_CONTEXT__);
    if (g) return g;
    if (window.activeCountryName) return { level:'country', id: window.activeCountryName };
    if (window.activeRegionId) return { level:'region', id: window.activeRegionId };
    return { level:'global', id: null };
  }

  // ---------- EXTENSION WINDOW (DEFAULT OPEN) ----------
  const EXT = {
    backdrop: null,
    modal: null,
    body: null,
    title: null,
    visible: false
  };

  function injectExtensionStyle(){
    if (document.getElementById('maru-ext-style')) return;
    const st = document.createElement('style');
    st.id = 'maru-ext-style';
    st.textContent = `
      .maru-ext-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:200000;display:none}
      .maru-ext-modal{
        position:fixed;
        left:6%; right:6%;
        top:6%;
        bottom:18%; /* leave room for conversation dock/voice bar */
        background:#ffffff;
        border-radius:22px;
        box-shadow:0 40px 90px rgba(0,0,0,.45);
        z-index:200001;
        display:flex; flex-direction:column;
        overflow:hidden;
      }
      .maru-ext-header{
        display:flex; align-items:center; gap:10px;
        padding:14px 18px;
        border-bottom:1px solid #eee;
      }
      .maru-ext-header strong{font-size:16px;color:#1f3a5f;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .maru-ext-close{border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}
      .maru-ext-body{flex:1;overflow:auto;padding:16px 18px;font-size:14px;line-height:1.7;color:#000;white-space:pre-wrap}
      .maru-ext-hidden{display:none !important}
      .maru-ext-msg{margin:0 0 10px}
      .maru-ext-msg .role{font-weight:700;margin-right:6px;color:#1f3a5f}
      .maru-ext-msg.user .role{color:#6b3a1f}
      .maru-ext-sep{height:1px;background:#f0f0f0;margin:12px 0}
    `;
    document.head.appendChild(st);
  }

  function ensureExtension(){
    injectExtensionStyle();
    if (EXT.backdrop && EXT.modal) return;

    EXT.backdrop = document.createElement('div');
    EXT.backdrop.className = 'maru-ext-backdrop';

    EXT.modal = document.createElement('div');
    EXT.modal.className = 'maru-ext-modal';

    const header = document.createElement('div');
    header.className = 'maru-ext-header';

    EXT.title = document.createElement('strong');
    EXT.title.textContent = 'MARU 확장창';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'maru-ext-close';
    closeBtn.textContent = '숨김';
    closeBtn.addEventListener('click', function(e){
      e.preventDefault();
      hideExtension(true);
    });

    header.appendChild(EXT.title);
    header.appendChild(closeBtn);

    EXT.body = document.createElement('div');
    EXT.body.className = 'maru-ext-body';
    EXT.body.textContent = '';

    EXT.modal.appendChild(header);
    EXT.modal.appendChild(EXT.body);

    document.body.appendChild(EXT.backdrop);
    document.body.appendChild(EXT.modal);

    // click backdrop -> keep open (default), but allow hide if user clicked close only
    EXT.backdrop.addEventListener('click', function(){ /* no-op */ });
  }

  function showExtension(){
    ensureExtension();
    EXT.backdrop.style.display = 'block';
    EXT.modal.classList.remove('maru-ext-hidden');
    EXT.visible = true;
  }

  function hideExtension(userInitiated){
    // Even if user hides, auto-open rules will reopen on input/voice-on
    if (!EXT.modal) return;
    EXT.backdrop.style.display = 'none';
    EXT.modal.classList.add('maru-ext-hidden');
    EXT.visible = false;
    if (userInitiated) { /* keep silent */ }
  }

  function clearExtension(){
    ensureExtension();
    EXT.body.textContent = '';
  }

  function appendExt(role, text){
    if (!text) return;
    ensureExtension();
    const wrap = document.createElement('div');
    wrap.className = 'maru-ext-msg ' + (role === 'user' ? 'user' : 'assistant');
    const r = document.createElement('span');
    r.className = 'role';
    r.textContent = (role === 'user') ? 'USER:' : 'MARU:';
    const t = document.createElement('span');
    t.className = 'text';
    t.textContent = String(text);
    wrap.appendChild(r);
    wrap.appendChild(t);
    EXT.body.appendChild(wrap);
    EXT.body.scrollTop = EXT.body.scrollHeight;
  }

  // Hide extension only when dashboard has meaningful data
  function isPlaceholderText(t){
    if (!t) return true;
    return /(분석\s*중|준비\s*중|불러오는\s*중|데이터가\s*없|없습니다)/.test(t);
  }

  function dashboardHasData(){
    // If a region modal is open and at least one region card has non-placeholder summary => data exists
    const rModal = $('.maru-region-modal');
    if (rModal) {
      const briefs = $$('.maru-region-brief', rModal);
      for (const b of briefs) {
        const tx = (b.textContent || '').trim();
        if (tx && !isPlaceholderText(tx)) return true;
      }
      return false;
    }

    const cModal = $('.maru-country-modal');
    if (cModal) {
      const briefs = $$('.maru-country-brief', cModal);
      for (const b of briefs) {
        const tx = (b.textContent || '').trim();
        if (tx && !isPlaceholderText(tx)) return true;
      }
      return false;
    }

    return false;
  }

  function reconcileExtensionVisibility(){
    // Default OPEN
    if (!EXT.modal) return;
    if (dashboardHasData()) {
      // temporarily hide
      hideExtension(false);
    } else {
      showExtension();
    }
  }

  // ---------- VOICE ----------
  function syncVoiceToggleUi(){
    const btns = $$('.maru-region-voice-toggle, .maru-country-voice-toggle');
    btns.forEach(btn => {
      btn.classList.toggle('on', VOICE_ENABLED);
      btn.classList.toggle('off', !VOICE_ENABLED);
      // Keep existing label if present; else set
      const hasKorean = /음성/.test(btn.textContent || '');
      if (!hasKorean) {
        btn.textContent = VOICE_ENABLED ? '🎙 음성 ON' : '🎙 음성 OFF';
      } else {
        // normalize only if empty
        if (!btn.textContent.trim()) btn.textContent = VOICE_ENABLED ? '🎙 음성 ON' : '🎙 음성 OFF';
      }
      btn.style.opacity = VOICE_ENABLED ? '1' : '.45';
    });
    window.__MARU_VOICE_TOGGLE__ = VOICE_ENABLED;
  }

  function startMic(){
    safe(() => { if (typeof window.startMaruMic === 'function') window.startMaruMic(); });
  }
  function stopMic(){
    safe(() => { if (typeof window.stopMaruMic === 'function') window.stopMaruMic(); });
  }

  function setVoiceEnabled(on, reason){
    VOICE_ENABLED = !!on;

    if (VOICE_ENABLED) startMic();
    else stopMic();

    syncVoiceToggleUi();

    // Default open extension on voice ON/OFF, because it is the primary response window.
    showExtension();
    reconcileExtensionVisibility();
  }

  function ttsSpeak(text){
    if (!text) return;
    if (!VOICE_ENABLED) return;
    if (MEDIA_PLAYING) return;
    if (typeof window.maruVoiceSpeak !== 'function') return;
    safe(() => window.maruVoiceSpeak(String(text)));
  }

  // ---------- INPUT MODE (kept) ----------
  function setInputMode(mode){
    INPUT_MODE = (mode === 'confirm') ? 'confirm' : 'realtime';
  }

  // ---------- ENGINE ----------
  function detectIntent(text){
    const t = String(text || '');
    if (/영상/.test(t)) return 'video';
    if (/(자세|상세|구체|심층|디테일|더\s*자세)/.test(t)) return 'expand';
    if (/이슈/.test(t)) return 'realtime';
    return 'summary';
  }

  function normalizeRequest(input, text, context){
    const ctx = normalizeContext(context) || getBestContext();

    let scope = 'global';
    let target = null;
    if (ctx.level === 'region') { scope = 'region'; target = ctx.id || null; }
    else if (ctx.level === 'country') { scope = 'country'; target = ctx.id || null; }

    return {
      source: 'user',
      input,
      text,
      scope,
      target,
      intent: detectIntent(text),
      voiceWanted: (input === 'voice')
    };
  }

  function callInsightEngine(req){
    return fetch('/.netlify/functions/maru-global-insight', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        text: req.text,
        scope: req.scope,
        depth: req.intent
      })
    }).then(r => r.json());
  }

  function dispatch(req){
    STATE.lastRequest = req;
    STATE.commandHistory.push({ role:'user', text: req.text });

    if (ENGINE_DEBOUNCE_TIMER) clearTimeout(ENGINE_DEBOUNCE_TIMER);
    ENGINE_DEBOUNCE_TIMER = setTimeout(() => {
      callInsightEngine(req)
        .then(raw => {
          const res = normalizeEngineResponse(raw);
          STATE.lastResponse = res;
          STATE.commandHistory.push({ role:'assistant', text: res.text || '' });
          routeResponse(req, res);
        })
        .catch(err => {
          appendExt('assistant', '엔진 호출 실패');
          ttsSpeak('엔진 호출 실패');
          console.error('[MaruAddon] engine error', err);
        });
    }, ENGINE_DEBOUNCE_DELAY);
  }

  function normalizeEngineResponse(raw){
    const d = (raw && raw.data && typeof raw.data === 'object') ? raw.data : {};
    return {
      ok: raw && (raw.ok === true || raw.status === 'ok' || raw.status === 'OK'),
      text: raw?.text ?? raw?.summary ?? raw?.message ?? '',
      mode: raw?.mode ?? raw?.depth ?? 'summary',
      data: {
        ...d,
        issues: d?.issues ?? null,
        videos: Array.isArray(d?.videos) ? d.videos : []
      },
      raw
    };
  }

  function routeResponse(req, res){
    // Always open and show extension window for responses.
    showExtension();

    // Render to extension window (primary)
    const headline = res.text || '응답이 없습니다.';
    appendExt('assistant', headline);

    // Distribute to dashboards if available (non-blocking)
    if (req.scope === 'global') {
      safe(() => {
        if (typeof window.renderSummary === 'function') window.renderSummary(headline);
      });
      safe(() => {
        if (typeof window.injectMaruGlobalRegionData === 'function') {
          window.injectMaruGlobalRegionData(res.data?.regions || res.data || []);
        }
      });
      safe(() => {
        if (typeof window.injectMaruGlobalCountryData === 'function') {
          window.injectMaruGlobalCountryData(res.data?.countries || res.data || []);
        }
      });
    }

    if (req.scope === 'region') {
      safe(() => {
        if (typeof window.injectRegionContextResult === 'function') {
          window.injectRegionContextResult(req.target, {
            summary: headline,
            issues: res.data?.issues || null,
            raw: res
          });
        }
      });
    }

    if (req.scope === 'country') {
      safe(() => {
        if (typeof window.injectCountryContextResult === 'function') {
          window.injectCountryContextResult(req.target, {
            summary: headline,
            issues: res.data?.issues || null,
            videos: res.data?.videos || null,
            raw: res
          });
        }
      });

      // Videos injection if present
      if (Array.isArray(res.data?.videos) && typeof window.injectMaruCountryVideos === 'function') {
        safe(() => window.injectMaruCountryVideos({ country: req.target, videos: res.data.videos }));
      }
    }

    // Speak (primary)
    if (VOICE_ENABLED) {
      ttsSpeak(headline);
    }

    // After distributing, decide whether to temporarily hide extension
    reconcileExtensionVisibility();
  }

  // ---------- PUBLIC API ----------
  const MaruAddon = {
    __MARU_ADDON_VER__: 'v7.0-fixed',
    // buttons
    bootstrapGlobalInsight: function(){
      showExtension();
      clearExtension();
      appendExt('assistant', '글로벌 인사이트 수집을 시작합니다.');
      dispatch({
        source:'panel',
        input:'system',
        text:'글로벌 인사이트 전체 수집',
        scope:'global',
        target:null,
        intent:'summary',
        voiceWanted: VOICE_ENABLED
      });
    },
    requestInsight: function(){
      showExtension();
      appendExt('assistant', '실시간 글로벌 이슈를 수집합니다.');
      dispatch({
        source:'panel',
        input:'system',
        text:'실시간 글로벌 이슈',
        scope:'global',
        target:null,
        intent:'realtime',
        voiceWanted: VOICE_ENABLED
      });
    },

    // voice/text inbound
    previewVoice: function(text){
      // preview does not dispatch; it only reflects typing if confirm mode
      if (!text) return;
      if (INPUT_MODE === 'confirm') {
        showExtension();
        appendExt('assistant', '입력(미확정): ' + String(text));
      }
    },
    handleTextQuery: function(payload, context){
      const text = (typeof payload === 'string') ? payload : (payload && payload.text) || '';
      const ctx = (payload && payload.context) || context || null;
      const raw = String(text || '').trim();
      if (!raw) return;

      showExtension();
      appendExt('user', raw);

      const req = normalizeRequest('text', raw, ctx);
      dispatch(req);
    },
    handleVoiceQuery: function(payload, context){
      const text = (typeof payload === 'string') ? payload : (payload && payload.text) || '';
      const ctx = (payload && payload.context) || context || null;
      const raw = String(text || '').trim();
      if (!raw) return;

      showExtension();
      appendExt('user', raw);

      const req = normalizeRequest('voice', raw, ctx);
      dispatch(req);
    },

    // voice control
    setVoiceEnabled: function(on){ setVoiceEnabled(!!on, 'api'); },
    isVoiceEnabled: function(){ return VOICE_ENABLED; },

    // media control
    setMediaState: function(kind, on){
      if (kind === 'video' || kind === 'music' || kind === 'narration') {
        MEDIA_PLAYING = !!on;
      }
    },
    setMediaPlaying: function(on){ MEDIA_PLAYING = !!on; },

    // input mode (compat)
    setInputDisplayMode: setInputMode,
    getInputDisplayMode: function(){ return INPUT_MODE; }
  };

  window.MaruAddon = MaruAddon;

  // ---------- UI BINDINGS ----------
  function bindGlobalButtons(){
    // Keep existing button ids or label-based search
    const runBtn = document.getElementById('btnMaruGlobalInsight') ||
      $$('button').find(b => (b.textContent || '').includes('AI 글로벌 인사이트'));
    if (runBtn && !runBtn.dataset.maruBound) {
      runBtn.dataset.maruBound = '1';
      runBtn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        MaruAddon.bootstrapGlobalInsight();
      }, true);
    }

    const issueBtn = document.getElementById('btnMaruRealtimeIssue') ||
      $$('button').find(b => (b.textContent || '').includes('실시간') && (b.textContent || '').includes('이슈'));
    if (issueBtn && !issueBtn.dataset.maruBound) {
      issueBtn.dataset.maruBound = '1';
      issueBtn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        MaruAddon.requestInsight();
      }, true);
    }
  }

  // Single delegated toggle handler (Region + Country)
  document.addEventListener('click', function(e){
    const t = e.target;
    if (!t) return;
    const btn = t.closest && t.closest('.maru-region-voice-toggle, .maru-country-voice-toggle');
    if (!btn) return;
    e.preventDefault();
    setVoiceEnabled(!VOICE_ENABLED, 'ui');
  }, true);

  // DO NOT auto-disable voice on modal close/open; only reconcile extension visibility
  document.addEventListener('click', function(e){
    const t = e.target;
    if (!t) return;

    const isClose = t.closest && t.closest('.maru-region-close, .maru-country-close');
    const isBackdrop = t.classList && (t.classList.contains('maru-region-backdrop') || t.classList.contains('maru-country-backdrop'));

    if (isClose || isBackdrop) {
      // Keep voice state intact.
      // Ensure extension is visible when dashboards disappear.
      setTimeout(reconcileExtensionVisibility, 50);
    }
  }, true);

  // Keep extension visible by default when modals are not showing data
  const obs = new MutationObserver(function(){
    bindGlobalButtons();
    syncVoiceToggleUi();
    reconcileExtensionVisibility();
  });
  obs.observe(document.body, { childList:true, subtree:true });

  // Init
  bindGlobalButtons();
  syncVoiceToggleUi();
  showExtension(); // default open
  reconcileExtensionVisibility();

})();
