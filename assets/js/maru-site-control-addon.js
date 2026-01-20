/* =========================================================
 * MARU Site Control Addon — FINAL STABLE
 * Version: 6.1
 * ---------------------------------------------------------
 * - window.MaruAddon is ALWAYS defined (never undefined)
 * - Boots after DOM ready (prevents early crashes)
 * - Text + Voice share one pipeline
 * - Routes engine responses into existing injectors
 * - TTS reads responses when VOICE is enabled
 * ========================================================= */

(function () {
  'use strict';

  // =====================================================
  // 0) ALWAYS EXPORT A SAFE STUB FIRST
  // =====================================================
  const MaruAddon = (window.MaruAddon && typeof window.MaruAddon === 'object') ? window.MaruAddon : {};

  // No-op defaults so callers never crash
  const noop = function () {};
  MaruAddon.handleTextQuery = MaruAddon.handleTextQuery || noop;
  MaruAddon.handleVoiceQuery = MaruAddon.handleVoiceQuery || noop;
  MaruAddon.setVoiceEnabled = MaruAddon.setVoiceEnabled || noop;
  MaruAddon.isVoiceEnabled = MaruAddon.isVoiceEnabled || function () { return false; };
  MaruAddon.setMediaPlaying = MaruAddon.setMediaPlaying || noop;
  MaruAddon.setMediaState = MaruAddon.setMediaState || noop;
  MaruAddon.bootstrapGlobalInsight = MaruAddon.bootstrapGlobalInsight || noop;
  MaruAddon.requestInsight = MaruAddon.requestInsight || noop;

  window.MaruAddon = MaruAddon;

  // =====================================================
  // 1) BOOT GATE
  // =====================================================
  function safeBoot() {
    try {
      initAddon();
    } catch (e) {
      try { console.error('[MaruAddon] BOOT FAILED', e); } catch (_) {}
      // keep stub exported
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeBoot);
  } else {
    safeBoot();
  }

  // =====================================================
  // 2) IMPLEMENTATION
  // =====================================================
  function initAddon() {
    // Prevent double-init
    if (MaruAddon.__READY__) return;
    MaruAddon.__READY__ = true;

    let VOICE_ENABLED = false;
    const MEDIA_STATE = { video: false, music: false, narration: false };

    const STATE = {
      lastRequest: null,
      lastResponse: null,
      commandHistory: [],
      videoPool: { country: null, list: [] }
    };

    let ENGINE_DEBOUNCE_TIMER = null;
    const ENGINE_DEBOUNCE_DELAY = 350;

    function ttsSpeak(text) {
      if (!text) return;
      if (!VOICE_ENABLED) return;
      if (MEDIA_STATE.video) return;
      if (typeof window.maruVoiceSpeak !== 'function') return;
      try { window.maruVoiceSpeak(String(text)); } catch (_) {}
    }

    function detectIntent(text) {
      const t = String(text || '').toLowerCase();
      if (t.includes('영상')) return 'video';
      if (t.includes('자세히') || t.includes('상세')) return 'expand';
      if (t.includes('이슈')) return 'realtime';
      return 'summary';
    }

    function shouldOpenDetailPane(req) {
      if (!req) return false;
      // Voice inputs should always surface responses in the detail pane
      if (req.input === 'voice') return true;
      // Explicit expand/detail requests
      if (req.intent === 'expand') return true;
      const t = String(req.text || '');
      // Heuristic: analytical / conversational prompts should go to detail pane
      return /(왜|어떻게|전반|전체|상황|전망|분석|비교|영향|리스크|기회|추세|배경|원인|정리|설명|경제|정치|사회|기술|외교|전쟁|금리|환율|물가|실업|성장)/.test(t);
    }

    function openDetailPane(title, text) {
      const t = String(title || 'MARU DETAIL');
      const body = String(text || '');
      try {
        if (window.MaruDetachedPane && typeof window.MaruDetachedPane.open === 'function') {
          window.MaruDetachedPane.open({ type: 'detail', title: t, text: body });
          return;
        }
      } catch (_) {}
      try {
        if (typeof window.openMaruDetailOverlay === 'function') {
          window.openMaruDetailOverlay({ title: t, text: body });
          return;
        }
      } catch (_) {}
    }

    function normalizeContext(ctx) {
      if (!ctx || typeof ctx !== 'object') return null;
      if (!ctx.level) return null;
      return { level: ctx.level, id: (ctx.id != null ? ctx.id : null) };
    }

    function normalizeCommand({ input, text, context }) {
      const raw = String(text || '').trim();
      if (!raw) return null;

      const ctx = normalizeContext(context) || normalizeContext(window.__MARU_CONTEXT__) || null;

      let scope = 'global';
      let target = null;
      if (ctx && ctx.level === 'region') { scope = 'region'; target = ctx.id || null; }
      if (ctx && ctx.level === 'country') { scope = 'country'; target = ctx.id || null; }

      const req = {
        source: 'user',
        input: input || 'text',
        text: raw,
        scope,
        target,
        intent: detectIntent(raw),
        voiceWanted: (input === 'voice'),
        openDetail: false
      };
      req.openDetail = shouldOpenDetailPane(req);
      return req;
    }

    function dispatchCommand(req) {
      if (!req || !req.text) return;
      STATE.lastRequest = req;
      STATE.commandHistory.push({ role: 'user', text: req.text });

      if (ENGINE_DEBOUNCE_TIMER) clearTimeout(ENGINE_DEBOUNCE_TIMER);
      ENGINE_DEBOUNCE_TIMER = setTimeout(function () {
        callInsightEngine(req)
          .then(function (raw) {
            const res = normalizeEngineResponse(raw);
            STATE.lastResponse = res;
            STATE.commandHistory.push({ role: 'assistant', text: res.text || '' });
            routeResponse(req, res);
          })
          .catch(function (err) {
            try { console.error('[MaruAddon] engine error', err); } catch (_) {}
            // Always give a minimal audible response if voice is on
            ttsSpeak('현재 엔진 응답을 받을 수 없습니다.');
          });
      }, ENGINE_DEBOUNCE_DELAY);
    }

    function normalizeEngineResponse(raw) {
      const ok = !!(raw && raw.ok === true);
      const text = (raw && (raw.text || raw.summary)) ? String(raw.text || raw.summary) : '';
      const mode = (raw && raw.mode) ? String(raw.mode) : 'summary';
      const data = (raw && raw.data) ? raw.data : {};
      return { ok, text, mode, data, raw: raw || null };
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

    function routeResponse(req, res) {
      // Even if ok=false, we still speak a minimal response when voice is on
      if (!res || !res.ok) {
        const msg = '준비된 자료가 없습니다.';
        // If the query is conversational (or voice), surface it in detail pane
        if (req && req.openDetail) {
          try {
            openDetailPane('MARU DETAIL', 'Q: ' + (req.text || '') + '\n\nA: ' + msg);
          } catch (_) {}
        }
        ttsSpeak(msg);
        return;
      }

      // Global summary hook (optional)
      if (req.scope === 'global' && typeof window.renderSummary === 'function') {
        try { window.renderSummary(res.text || ''); } catch (_) {}
      }

      // Injectors
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
            raw: res
          });
        } catch (_) {}
      }

      if (req.scope === 'country' && typeof window.injectCountryContextResult === 'function') {
        try {
          window.injectCountryContextResult(req.target, {
            summary: res.text || '',
            issues: (res.data && res.data.issues) ? res.data.issues : null,
            videos: (res.data && res.data.videos) ? res.data.videos : null,
            raw: res
          });
        } catch (_) {}
      }

      // Videos
      if (req.scope === 'country' && res.data && Array.isArray(res.data.videos) && typeof window.injectMaruCountryVideos === 'function') {
        try {
          STATE.videoPool.country = req.target;
          STATE.videoPool.list = res.data.videos;
          window.injectMaruCountryVideos({ country: req.target, videos: res.data.videos });
        } catch (_) {}
      }

      // Detail pane: show conversational/analytical responses (voice default)
      if (req && req.openDetail) {
        try {
          const title = (req.scope === 'country')
            ? ('COUNTRY DETAIL — ' + (req.target || ''))
            : (req.scope === 'region')
              ? ('REGION DETAIL — ' + (req.target || ''))
              : 'GLOBAL DETAIL';
          const body = 'Q: ' + (req.text || '') + '\n\nA: ' + (res.text || '');
          openDetailPane(title, body);
        } catch (_) {}
      }

      // Speak
      ttsSpeak(res.text || '');
    }

    // =====================================================
    // 3) PUBLIC API (STABLE)
    // =====================================================
    MaruAddon.setVoiceEnabled = function (on) {
      VOICE_ENABLED = !!on;
      // Start/stop recognition if available
      try {
        if (VOICE_ENABLED && typeof window.startMaruMic === 'function') window.startMaruMic();
        if (!VOICE_ENABLED && typeof window.stopMaruMic === 'function') window.stopMaruMic();
      } catch (_) {}
    };

    MaruAddon.isVoiceEnabled = function () { return VOICE_ENABLED; };

    MaruAddon.setMediaPlaying = function (on) { MEDIA_STATE.video = !!on; };

    MaruAddon.setMediaState = function (type, on) {
      if (!Object.prototype.hasOwnProperty.call(MEDIA_STATE, type)) return;
      MEDIA_STATE[type] = !!on;
    };

    MaruAddon.handleTextQuery = function (payload, context) {
      const text = (payload && typeof payload === 'object') ? (payload.text || '') : (payload || '');
      const ctx = (payload && typeof payload === 'object') ? payload.context : context;
      const req = normalizeCommand({ input: 'text', text: text, context: ctx });
      if (!req) return;
      dispatchCommand(req);
    };

    MaruAddon.handleVoiceQuery = function (payload, context) {
      const text = (payload && typeof payload === 'object') ? (payload.text || '') : (payload || '');
      const ctx = (payload && typeof payload === 'object') ? payload.context : context;
      const req = normalizeCommand({ input: 'voice', text: text, context: ctx });
      if (!req) return;
      dispatchCommand(req);
    };

    MaruAddon.bootstrapGlobalInsight = function () {
      dispatchCommand({ source: 'panel', input: 'system', text: '글로벌 인사이트 전체 수집', scope: 'global', target: null, intent: 'summary', voiceWanted: VOICE_ENABLED });
    };

    MaruAddon.requestInsight = function () {
      dispatchCommand({ source: 'panel', input: 'system', text: '실시간 글로벌 이슈', scope: 'global', target: null, intent: 'realtime', voiceWanted: VOICE_ENABLED });
    };

    // Optional external hook
    MaruAddon.openDetailPane = function (title, text) {
      try { openDetailPane(title, text); } catch (_) {}
    };

    try { console.log('[MaruAddon] READY'); } catch (_) {}
  }

})();
