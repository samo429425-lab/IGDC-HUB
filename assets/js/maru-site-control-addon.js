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
	
	// =====================================================
// [PATCH-STEP1] VOICE SYNC (Region <-> Country) + VoiceMode State
// - 삭제 없음 / 기존 파이프라인 유지
// =====================================================
const PATCH = {
  voiceMode: 'realtime', // 'realtime' | 'final' (표시 방식 옵션)
};

function emitEvent(name, detail){
  try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (_) {}
}

function syncRegionVoiceButtonUI(enabled){
  const btn = document.querySelector('.maru-region-voice-toggle');
  if(!btn) return;
  btn.classList.toggle('off', !enabled);
  btn.textContent = enabled ? 'VOICE ON' : 'VOICE OFF';
}

function syncCountryVoiceHub(enabled){
  // Country 모달은 MaruCountryVoice 허브가 있음(있으면 그걸 동기화)
  // (Country 파일에 존재) :contentReference[oaicite:2]{index=2}
  try{
    if(window.MaruCountryVoice){
      if(enabled && typeof window.MaruCountryVoice.enable === 'function') window.MaruCountryVoice.enable();
      if(!enabled && typeof window.MaruCountryVoice.disable === 'function') window.MaruCountryVoice.disable();
    }
  }catch(_){}
}

function ensureVoiceModeOptionUI(){
  // Region 헤더에 "LIVE/FINAL" 옵션 버튼 1개만 붙임 (토글 옆)
  const header = document.querySelector('.maru-region-header');
  const voiceBtn = document.querySelector('.maru-region-voice-toggle');
  if(!header || !voiceBtn) return;

  let opt = header.querySelector('.maru-voice-mode-opt');
  if(!opt){
    opt = document.createElement('button');
    opt.className = 'maru-voice-mode-opt';
    opt.style.border = '1px solid #d6c7b5';
    opt.style.background = '#fff';
    opt.style.borderRadius = '10px';
    opt.style.padding = '6px 10px';
    opt.style.fontSize = '12px';
    opt.style.cursor = 'pointer';
    opt.style.opacity = '0.9';
    opt.title = '음성 입력 표시 방식 (실시간/확정)';

    // voiceBtn 바로 뒤에 삽입
    voiceBtn.insertAdjacentElement('afterend', opt);

    opt.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      PATCH.voiceMode = (PATCH.voiceMode === 'realtime') ? 'final' : 'realtime';
      opt.textContent = (PATCH.voiceMode === 'realtime') ? 'LIVE' : 'FINAL';
      emitEvent('maru:voice-mode', { mode: PATCH.voiceMode });
    });
  }

  opt.textContent = (PATCH.voiceMode === 'realtime') ? 'LIVE' : 'FINAL';
  // 음성 ON일 때만 보이게(합의)
  opt.style.display = VOICE_ENABLED ? '' : 'none';
}

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

// =====================================================
// [PATCH-3A] Detached Detail Pane helper
// =====================================================
function openDetachedDetail(title, text) {
  try {
    if (
      window.MaruDetachedPane &&
      typeof window.MaruDetachedPane.open === 'function'
    ) {
      window.MaruDetachedPane.open({
        type: 'detail',
        title: String(title || 'DETAIL'),
        text: String(text || '')
      });
      return true;
    }
  } catch (_) {}
  return false;
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
        ttsSpeak('준비된 자료가 없습니다.');
        return;
      }

      // Global summary hook (optional)
      if (req.scope === 'global' && typeof window.renderSummary === 'function') {
        try { window.renderSummary(res.text || ''); } catch (_) {}
      }

// =====================================================
// [PATCH-3B] NO DATA => OPEN DETACHED DETAIL
// =====================================================
try {
  const scope = req && req.scope ? req.scope : 'global';

  const hasIssues =
    !!(res && res.data && res.data.issues && res.data.issues.length);

  const hasVideos =
    !!(res && res.data && res.data.videos && res.data.videos.length);

  const hasText =
    !!(res && res.text && String(res.text).trim().length);

  const needDetail =
    (scope === 'region'  && !hasIssues && !hasText) ||
    (scope === 'country' && !hasIssues && !hasVideos && !hasText) ||
    (req && req.intent === 'expand');

  if (needDetail) {
    const title =
      scope === 'region'
        ? 'REGION DETAIL'
        : scope === 'country'
          ? 'COUNTRY DETAIL'
          : 'DETAIL';

    openDetachedDetail(title, res.text || '상세 응답을 생성 중입니다.');
  }
} catch (_) {}

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

      // Speak
      ttsSpeak(res.text || '');
    }

    // =====================================================
    // 3) PUBLIC API (STABLE)
    // =====================================================
MaruAddon.setVoiceEnabled = function (on) {
  const enabled = !!on;
  if (enabled === VOICE_ENABLED) {
    // UI만 재동기화
    syncRegionVoiceButtonUI(VOICE_ENABLED);
    syncCountryVoiceHub(VOICE_ENABLED);
    ensureVoiceModeOptionUI();
    emitEvent('maru:voice-sync', { enabled: VOICE_ENABLED });
    return;
  }

  VOICE_ENABLED = enabled;

  // Region 모달은 이 플래그를 음성엔진 재시작 조건으로도 씀 :contentReference[oaicite:4]{index=4}
  try { window.MARU_REGION_VOICE_READY = VOICE_ENABLED; } catch (_) {}
  try { window.MARU_COUNTRY_VOICE_READY = VOICE_ENABLED; } catch (_) {}

  // 음성엔진 start/stop (기존 동작 유지)
  try {
    if (VOICE_ENABLED && typeof window.startMaruMic === 'function') window.startMaruMic();
    if (!VOICE_ENABLED && typeof window.stopMaruMic === 'function') window.stopMaruMic();
  } catch (_) {}

  // UI/허브 동기화 (Region <-> Country)
  syncRegionVoiceButtonUI(VOICE_ENABLED);
  syncCountryVoiceHub(VOICE_ENABLED);
  ensureVoiceModeOptionUI();

  emitEvent('maru:voice-sync', { enabled: VOICE_ENABLED });
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

    try { console.log('[MaruAddon] READY'); } catch (_) {}
  }

})();
