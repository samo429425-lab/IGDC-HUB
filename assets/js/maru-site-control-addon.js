/* =========================================================
 * MARU Site Control Addon
 * Version: 5.0 (Voice/Conversation Final Mapping)
 *
 * 목표:
 * - 보이스(STT) + 컨버세이션(텍스트) 입력 완전 수용
 * - VOICE 토글에 따른 문자입력창 표시 규칙 준수
 * - Region/Country 컨텍스트에 따라 정확한 injector로 주입
 * - 영상 목록(3~4) → 클릭/음성 선택 → 확대 재생(컨트리 UI 재사용)
 *
 * 규칙:
 * - 항상 풀 파일
 * - Region/Country/IGDC UI 로직을 가로채지 않음
 * ========================================================= */

(function () {
  'use strict';

  /* =====================================================
   * 1. STATE
   * ===================================================== */

  let VOICE_ENABLED = false;
  let MEDIA_PLAYING = false;

  const STATE = {
    lastRequest: null,
    lastResponse: null,
    commandHistory: [],
    videoPool: {
      country: null,     // active country name
      list: []           // [{title, thumbnail, src, ...}]
    }
  };

let ENGINE_DEBOUNCE_TIMER = null;
const ENGINE_DEBOUNCE_DELAY = 400; // ms (권장 300~500)

  /* =====================================================
   * 2. PUBLIC API
   * ===================================================== */

  const MaruAddon = {};

  // IGDC: AI 글로벌 인사이트 실행
  MaruAddon.bootstrapGlobalInsight = function () {
    dispatchCommand({
      source: 'panel',
      input: 'system',
      text: '글로벌 인사이트 전체 수집',
      scope: 'global',
      target: null,
      intent: 'summary',
      voiceWanted: VOICE_ENABLED
    });
  };

  // IGDC: 실시간 이슈
  MaruAddon.requestInsight = function (opts = {}) {
    dispatchCommand({
      source: opts.source || 'panel',
      input: 'system',
      text: '실시간 글로벌 이슈',
      scope: 'global',
      target: null,
      intent: 'realtime',
      voiceWanted: VOICE_ENABLED
    });
  };

  // 텍스트 입력
MaruAddon.handleTextQuery = function (payload, context = {}) {
  // payload: {text, context} or text(string)
  if (payload && typeof payload === 'object') {
    return routeInbound({ input: 'text', text: payload.text || '', context: payload.context || null });
  }
  return routeInbound({ input: 'text', text: payload || '', context });
};
  // 음성 입력
MaruAddon.handleVoiceQuery = function (payload, context = {}) {
  if (payload && typeof payload === 'object') {
    return routeInbound({ input: 'voice', text: payload.text || '', context: payload.context || null });
  }
  return routeInbound({ input: 'voice', text: payload || '', context });
};


  /* =====================================================
   * 3. SINGLE VOICE CONTROL + TEXT INPUT RULES
   * ===================================================== */

  MaruAddon.setVoiceEnabled = function (on) {
    const enabled = !!on;
    if (enabled === VOICE_ENABLED) {
      // UI 동기화만 한번 더
      syncConversationInputVisibility();
      return;
    }

    VOICE_ENABLED = enabled;

    if (VOICE_ENABLED) {
      if (typeof window.startMaruMic === 'function') window.startMaruMic();
    } else {
      if (typeof window.stopMaruMic === 'function') window.stopMaruMic();
    }

    syncConversationInputVisibility();
  };

  MaruAddon.isVoiceEnabled = function () {
    return VOICE_ENABLED;
  };

// 영상 재생 상태 제어 (UX 충돌 방지)
MaruAddon.setMediaPlaying = function (on) {
  MEDIA_PLAYING = !!on;
};

  // 규칙:
  // - VOICE OFF => 입력창 반드시 보이기
  // - VOICE ON  => 숨겨도 됨(기본 숨김)
  function syncConversationInputVisibility() {
    if (!window.MaruConversationModal) return;

    if (VOICE_ENABLED) {
      // 기본: 음성 ON이면 입력 숨김 가능
      MaruConversationModal.setVoiceMode(true);  // 내부적으로 inputWrap 숨김
      MaruConversationModal.hideInput();
    } else {
      // 음성 OFF이면 입력 반드시 표시
      MaruConversationModal.setVoiceMode(false);
      MaruConversationModal.showInput();
    }
  }

  // 음성 ON 상태에서도 “문자창 띄워줘”로 강제 표시
  function forceShowTextInput() {
    if (!window.MaruConversationModal) return;
    MaruConversationModal.setVoiceMode(false);
    MaruConversationModal.showInput();
  }

  // 음성 ON 상태에서도 “문자창 숨겨줘”로 숨김
  function forceHideTextInput() {
    if (!window.MaruConversationModal) return;
    MaruConversationModal.setVoiceMode(true);
    MaruConversationModal.hideInput();
  }

  /* =====================================================
   * 4. INBOUND ROUTER (command / control)
   * ===================================================== */

  function routeInbound({ input, text, context }) {
    const raw = (text || '').trim();
    if (!raw) return;

    // 1) UI 제어 음성 명령 (엔진 호출 없이 즉시 처리)
    const uiCtl = detectUiControl(raw);
    if (uiCtl === 'showText') {
      forceShowTextInput();
      // 음성 ON이면, 확인 멘트만 읽기(선택)
      if (VOICE_ENABLED && typeof window.maruVoiceSpeak === 'function') {
        window.maruVoiceSpeak('문자 입력창을 열었습니다.');
      }
      return;
    }
    if (uiCtl === 'hideText') {
      forceHideTextInput();
      if (VOICE_ENABLED && typeof window.maruVoiceSpeak === 'function') {
        window.maruVoiceSpeak('문자 입력창을 숨겼습니다.');
      }
      return;
    }

    // 2) 영상 선택 명령 (A/1/첫번째 등) → 컨트리 영상 카드 클릭으로 처리
    const videoPick = parseVideoPick(raw);
    if (videoPick != null) {
      const ok = tryOpenCountryVideoByIndex(videoPick);
      if (ok) {
        if (VOICE_ENABLED && typeof window.maruVoiceSpeak === 'function') {
          window.maruVoiceSpeak(`${videoPick + 1}번 영상을 실행합니다.`);
        }
        return;
      }
      // 열기 실패 시에는 엔진 호출로 fallback
    }

    // 3) 일반/명령형 요청 → 엔진 파이프라인
    dispatchCommand(normalizeCommand({ input, text: raw, context }));
  }

  // “문자창 띄워줘/열어줘/보여줘” 등
  function detectUiControl(text) {
    const t = text.toLowerCase().replace(/\s+/g, '');
    if (t.includes('문자창') || t.includes('입력창') || t.includes('텍스트창')) {
      if (t.includes('띄워') || t.includes('열어') || t.includes('보여')) return 'showText';
      if (t.includes('닫아') || t.includes('숨겨') || t.includes('가려')) return 'hideText';
    }
    return null;
  }

  // “A번 영상”, “1번 영상”, “첫번째 영상” 등 → 0-based index
  function parseVideoPick(text) {
    const t = (text || '').trim();
    if (!t) return null;
    if (!/영상/.test(t)) return null;

    // A/B/C/D
    const mAlpha = t.match(/\b([A-Da-d])\b/);
    if (mAlpha) {
      const c = mAlpha[1].toUpperCase().charCodeAt(0) - 65;
      if (c >= 0 && c <= 3) return c;
    }

    // 1~4
    const mNum = t.match(/([1-4])\s*번/);
    if (mNum) {
      const idx = parseInt(mNum[1], 10) - 1;
      if (idx >= 0 && idx <= 3) return idx;
    }

    // “첫번째/두번째/세번째/네번째”
    if (t.includes('첫')) return 0;
    if (t.includes('두')) return 1;
    if (t.includes('세')) return 2;
    if (t.includes('네')) return 3;

    return null;
  }

  // 컨트리 모달에 이미 렌더된 카드(.maru-country-video-card)를 클릭 트리거
function tryOpenCountryVideoByIndex(idx) {
  if (typeof window.openMaruCountryVideoByIndex === 'function') {
    return window.openMaruCountryVideoByIndex(idx) === true;
  }
  return false;
}


  /* =====================================================
   * 5. COMMAND NORMALIZER
   * ===================================================== */

  function normalizeCommand({ input, text, context = {} }) {
    // 보이스 파일은 ConversationModal.getContext()를 넘김
    // 컨텍스트는 { level:'region'|'country', id: ... } 형태가 기준
    let scope = 'global';
    let target = null;

    if (context && context.level === 'region') {
      scope = 'region';
      target = context.id || null;
    } else if (context && context.level === 'country') {
      scope = 'country';
      target = context.id || null;
    }

    return {
      source: 'user',
      input,
      text,
      scope,
      target,
      intent: detectIntent(text),
      voiceWanted: (input === 'voice') ? true : false
    };
  }

  // intent는 엔진 depth로 매핑됨: summary | detail(expand) | realtime | video
  function detectIntent(text = '') {
    const t = text.toLowerCase();

    if (t.includes('영상')) return 'video';
    if (t.includes('자세히') || t.includes('상세')) return 'expand';
    if (t.includes('이슈')) return 'realtime';
    return 'summary';
  }

  /* =====================================================
   * 6. ENGINE PIPELINE
   * ===================================================== */
function normalizeEngineResponse(raw) {
  return {
    ok: raw?.ok === true,

    text:
      raw?.text ??
      raw?.summary ??
      '',

    mode:
      raw?.mode ??
      'summary',

    data: {
      issues:
        raw?.data?.issues ?? null,

      videos:
        Array.isArray(raw?.data?.videos)
          ? raw.data.videos
          : []
    }
  };
}

function dispatchCommand(req) {
  STATE.lastRequest = req;
  STATE.commandHistory.push({ role: 'user', text: req.text });

  // 🔹 Netlify Function 호출 디바운스
  if (ENGINE_DEBOUNCE_TIMER) {
    clearTimeout(ENGINE_DEBOUNCE_TIMER);
  }

  ENGINE_DEBOUNCE_TIMER = setTimeout(() => {
    callInsightEngine(req)
.then(raw => {
  const res = normalizeEngineResponse(raw);

  STATE.lastResponse = res;
  STATE.commandHistory.push({ role: 'assistant', text: res.text || '' });
  routeResponse(req, res);
})

      .catch(err => console.error('[MaruAddon]', err));
  }, ENGINE_DEBOUNCE_DELAY);
}


  function callInsightEngine(req) {
    return fetch('/.netlify/functions/maru-global-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: req.text,
        scope: req.scope,
        depth: req.intent // summary | expand | realtime | video
      })
    }).then(r => r.json());
  }

  /* =====================================================
   * 7. RESPONSE ROUTER (PERFECT MAPPING)
   * ===================================================== */

  function routeResponse(req, res) {
    if (!res || res.ok !== true) return;

    // 7-1) 요약 카드(항상)
    if (req.scope === 'global' && typeof window.renderSummary === 'function') {
      window.renderSummary(res.text || '');
    }

    // 7-2) 글로벌 실행 결과를 레기온/컨트리 준비 섹션으로 뿌리기
    // (엔진이 배열을 내려주면 그대로 주입됨)
    if (req.scope === 'global') {
      if (typeof window.injectMaruGlobalRegionData === 'function') {
        window.injectMaruGlobalRegionData(res.data?.regions || res.data || []);
      }
      if (typeof window.injectMaruGlobalCountryData === 'function') {
        window.injectMaruGlobalCountryData(res.data?.countries || res.data || []);
      }
    }

    // 7-3) 레기온 요청 응답 → 레기온 injector에 “정확한 shape”로 주입
    if (req.scope === 'region' && typeof window.injectRegionContextResult === 'function') {
      window.injectRegionContextResult(req.target, {
        summary: res.text || '',
        issues: res.data?.issues || null,
        raw: res
      });
    }

    // 7-4) 컨트리 요청 응답 → 컨트리 injector에 “정확한 shape”로 주입
    if (req.scope === 'country' && typeof window.injectCountryContextResult === 'function') {
      window.injectCountryContextResult(req.target, {
        summary: res.text || '',
        issues: res.data?.issues || null,
        videos: res.data?.videos || null,
        raw: res
      });
    }

    // 7-5) 영상 목록 주입(컨트리 전용 UI 공유)
    // 엔진이 videos를 내려주면: 컨트리 모달의 injectMaruCountryVideos가 리스트(3~4) 렌더
    if (req.scope === 'country' && Array.isArray(res.data?.videos) && typeof window.injectMaruCountryVideos === 'function') {
      STATE.videoPool.country = req.target;
      STATE.videoPool.list = res.data.videos;

      window.injectMaruCountryVideos({
        country: req.target,
        videos: res.data.videos
      });
    }

    // 7-6) 영상 intent일 때: 리스트가 이미 있으면 선택 오픈(음성/문자)
    if (req.intent === 'video') {

      const idx = parseVideoPick(req.text);
      const openIdx = (idx != null) ? idx : 0;
      const ok = tryOpenCountryVideoByIndex(openIdx);
      if (!ok) {
        // 2) 카드가 없다면, 엔진 데이터 기반으로 overlay 훅이 있으면 호출(옵션)
        if (typeof window.openMaruVideoOverlay === 'function' && STATE.videoPool.list.length > 0) {
          const v = STATE.videoPool.list[openIdx] || STATE.videoPool.list[0];
          if (v) window.openMaruVideoOverlay(v);
        }
      }

      // 토글 ON이면 영상 오픈/선택 안내를 음성으로 읽어줌(“영상 음성” 자체는 player가 재생)
      if (VOICE_ENABLED && typeof window.maruVoiceSpeak === 'function') {
        window.maruVoiceSpeak('요청하신 영상을 실행합니다.');
      }
    }

    // 7-7) 상세(expand) 오버레이
    if (res.mode === 'expand' && typeof window.openMaruDetailOverlay === 'function') {
      window.openMaruDetailOverlay({
        text: res.text || '',
        scope: res.scope || req.scope,
        conversation: STATE.commandHistory.slice(-6),
        raw: res
      });
    }

    // 7-8) 음성 읽기(요청이 어떤 것이든, 토글 ON이면 읽어줌)
    // - 보이스 요청은 반드시 읽기
    // - 텍스트 요청도 토글 ON이면 읽기 가능
   if (VOICE_ENABLED && !MEDIA_PLAYING && typeof window.maruVoiceSpeak === 'function') {
      // 엔진이 speech를 주면 speech 우선, 없으면 text
      const say = (res.speech || res.text || '').trim();
      if (say) {
        // UI 제어 응답(문자창 열기/닫기)은 위에서 이미 처리했으므로 여기선 엔진 응답만
        window.maruVoiceSpeak(say);
      }
    }
  }

  /* =====================================================
   * 8. EXPORT
   * ===================================================== */

  window.MaruAddon = MaruAddon;

})();
