/* =========================================================
 * MARU SITE CONTROL ADDON
 * ADVANCED BRAIN ENGINE (FINAL)
 * ---------------------------------------------------------
 * Responsibilities:
 *  - Single Brain for Voice / Region / Country / Global
 *  - Snapshot sufficiency judgment
 *  - Conditional AI Global Insight re-run
 *  - Context-aware briefing & expansion
 *
 * Depends on:
 *  - igdc-site-control.js  (data fetch & inject)
 *  - maru-voice-insight.js (STT / TTS only)
 * ========================================================= */

(function () {
  'use strict';

  /* =====================================================
   * SNAPSHOT STATE (Single Source of Truth)
   * ===================================================== */
  const SNAPSHOT = {
    raw: null,
    ts: 0,
    status: 'idle', // idle | ready | empty
    view: {
      critical: {
        regions: {},
        countries: {}
      }
    }
  };

  /* =====================================================
   * SNAPSHOT SETTER (called from site-control)
   * ===================================================== */
  function setSnapshot(snapshot) {
    SNAPSHOT.raw = snapshot || null;
    SNAPSHOT.ts = Date.now();
    SNAPSHOT.status = snapshot ? 'ready' : 'empty';

    SNAPSHOT.view.critical.regions =
      snapshot?.critical?.regions || {};
    SNAPSHOT.view.critical.countries =
      snapshot?.critical?.countries || {};
  }

  /* =====================================================
   * CONTEXT DETECTION
   * ===================================================== */
  function detectContext() {
    if (window.activeCountryCode) {
      return { type: 'country', id: window.activeCountryCode };
    }
    if (window.activeRegionId) {
      return { type: 'region', id: window.activeRegionId };
    }
    return { type: 'global', id: null };
  }

  /* =====================================================
   * SIMPLE TOPIC EXTRACTION (non-AI, keyword only)
   * ===================================================== */
  function extractTopic(text) {
    if (!text) return null;
    const keywords = [
      '교육', '기후', '환경', '경제', '정치',
      '분쟁', '전쟁', '외교', '산업', '에너지'
    ];
    return keywords.find(k => text.includes(k)) || null;
  }

  /* =====================================================
   * SNAPSHOT SUFFICIENCY CHECK
   * ===================================================== */
  function isSnapshotSufficient({ context, topic }) {
    if (!SNAPSHOT.raw) return false;

    if (context.type === 'country') {
      const c = SNAPSHOT.view.critical.countries[context.id];
      if (!c) return false;
      if (topic && !c.detail) return false;
    }

    if (context.type === 'region') {
      const r = SNAPSHOT.view.critical.regions[context.id];
      if (!r) return false;
      if (topic && !r.detail) return false;
    }

    return true;
  }

  /* =====================================================
   * AI GLOBAL INSIGHT RE-RUN (Addon-triggered)
   * ===================================================== */
  async function rerunGlobalInsight() {
    const res = await fetch('/api/maru-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'global-full' })
    });

    const data = await res.json();

    // site-control과 동일한 주입 루트
    if (typeof window.injectMaruGlobalRegionData === 'function') {
      window.injectMaruGlobalRegionData(data);
    }
    if (typeof window.injectMaruGlobalCountryData === 'function') {
      window.injectMaruGlobalCountryData(data);
    }

    setSnapshot(data);
    return data;
  }

  /* =====================================================
   * CRITICAL ISSUE EXPANSION
   * ===================================================== */
  function requestCriticalDetail(type, id) {
    const crit =
      type === 'region'
        ? SNAPSHOT.view.critical.regions[id]
        : SNAPSHOT.view.critical.countries[id];

    if (!crit) return;

    if (typeof hasExpandedLayout === 'function' &&
        hasExpandedLayout(type)) {
      document.dispatchEvent(
        new CustomEvent('maru:expand', {
          detail: { type, id, data: crit }
        })
      );
    }

    if (window.MaruVoice) {
      MaruVoice.play(crit.detail || crit.summary);
    }
  }

  /* =====================================================
   * FREE TOPIC BRIEFING
   * ===================================================== */
  async function requestFreeTopicBriefing({ text, country, region }) {
    const payload = {
      mode: 'voice-free-topic',
      query: text,
      country: country || null,
      region: region || null,
      snapshot: SNAPSHOT.raw
    };

    const res = await fetch('/api/maru-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    const result =
      json.summary ||
      json.briefing ||
      '요청하신 주제에 대한 분석 자료가 아직 충분하지 않습니다.';

    if (country && typeof updateCountryIssueBar === 'function') {
      updateCountryIssueBar(result);
    } else if (region && typeof updateRegionIssueBar === 'function') {
      updateRegionIssueBar(result);
    } else if (typeof updateGlobalIssueBar === 'function') {
      updateGlobalIssueBar(result);
    }

    if (window.MaruVoice) {
      MaruVoice.play(result);
    }
  }

  /* =====================================================
   * VOICE SESSION (MAIN BRAIN LOOP)
   * ===================================================== */
  const VoiceSession = {
    busy: false,

    async handle(text) {
      if (!text) return;

      if (this.busy) {
        MaruVoice?.play('현재 요청을 처리 중입니다.');
        return;
      }

      this.busy = true;

      const context = detectContext();
      const topic = extractTopic(text);

      try {
        if (!isSnapshotSufficient({ context, topic })) {
          MaruVoice?.play(
            '요청하신 내용을 위해 추가 분석을 진행하겠습니다.'
          );
          await rerunGlobalInsight();
        }

        if (text.includes('상세') || text.includes('자세히')) {
          if (context.type !== 'global') {
            requestCriticalDetail(context.type, context.id);
            return;
          }
        }

        await requestFreeTopicBriefing({
          text,
          country: context.type === 'country' ? context.id : null,
          region: context.type === 'region' ? context.id : null
        });

      } catch (e) {
        console.error('[MARU ADDON]', e);
        MaruVoice?.play('요청을 처리하는 중 오류가 발생했습니다.');
      } finally {
        this.busy = false;
      }
    }
  };

window.VoiceSession = VoiceSession;

/* =======================================================
 * VOICE ROUTER (SINGLE ENTRY + ROLE DISPATCH)
 * ======================================================= */

window.MaruAddon = window.MaruAddon || {};

/**
 * 단일 공식 음성 진입점
 * - 외부(STT)는 무조건 여기만 호출
 */
window.MaruAddon.handleVoiceQuery = function (text) {
  if (!text) return;
  VoiceRouter(text);
};

/**
 * 음성 분기 라우터
 * - UI 명령
 * - 자유 질의
 * - 엔진/인사이트
 */
function VoiceRouter(text) {
  const t = text.toLowerCase();

  /* ---------- 1) UI 제어 분기 ---------- */
  if (
    t.includes('입력') ||
    t.includes('문자') ||
    t.includes('타이핑')
  ) {
    // 기존 TEXT INPUT BAR CONTROL 함수 그대로 사용
    if (typeof openTextInputBar === 'function') {
      openTextInputBar();
      return;
    }
  }

  if (
    t.includes('닫아') ||
    t.includes('입력창 닫아')
  ) {
    if (typeof closeTextInputBar === 'function') {
      closeTextInputBar();
      return;
    }
  }

  /* ---------- 2) 자유 질의 분기 ---------- */
  if (
    t.startsWith('질문') ||
    t.startsWith('자유') ||
    t.startsWith('설명')
  ) {
    if (typeof window.MaruFreeQuery === 'function') {
      window.MaruFreeQuery(text);
      return;
    }
  }

  /* ---------- 3) 엔진 / 인사이트 분기 ---------- */

  // 스냅샷 부족 시 레거시 보강 루트
  if (
    typeof isSnapshotSufficient === 'function' &&
    !isSnapshotSufficient({ context: ADDON_STATE?.context })
  ) {
    if (typeof rerunGlobalInsightLegacy === 'function') {
      rerunGlobalInsightLegacy();
      return;
    }
  }

  // 기본 엔진 처리
  if (window.VoiceSession && typeof VoiceSession.handle === 'function') {
    VoiceSession.handle(text);
    return;
  }
}


async function rerunGlobalInsightLegacy() {
  try {
    const res = await fetch('/api/maru-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'global-full',
        context: ADDON_STATE.context
      })
    });

    const data = await res.json();

    if (data && typeof window.setMaruSnapshot === 'function') {
      window.setMaruSnapshot(data);
    }
  } catch (err) {
    console.error('[MARU ADDON] Global insight error:', err);
  }
}

/* ---------- PUBLIC API (SINGLE SOURCE OF TRUTH) ---------- */

window.MaruAddon = {

  /* 🔑 ADDON 시동 */
  activate(context) {
    ADDON_STATE.active = true;
    ADDON_STATE.context = context;

    if (!isSnapshotSufficient({ context })) {
      this.runMaruInsight({ mode: 'global-full' });
    }
  },

  /* 🌍 AI 글로벌 인사이트 수동 재실행 */
  runGlobalInsight() {
    if (!ADDON_STATE.active) return;
    return this.runMaruInsight({ mode: 'global-full' });
  },

  /* 🎙 음성 입력 → 통합 엔진 */
  handleVoiceQuery(text) {
    if (!ADDON_STATE.active) return;
    return this.runMaruInsight({
      mode: 'voice',
      text,
      source: 'voice'
    });
  },

  /* 🚀 단일 통합 호출 허브 */
  runMaruInsight(payload = {}) {
    return fetch('/api/maru-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ai: true,
        source: 'addon',
        context: ADDON_STATE.context || null,
        ...payload
      })
    })
    .then(r => r.json())
    .then(data => {
      this.setSnapshot(data);
      return data;
    });
  },

  /* 📦 외부 snapshot 주입 */
  setSnapshot(data) {
    if (typeof window.setMaruSnapshot === 'function') {
      window.setMaruSnapshot(data);
    }
  },

  /* 🧭 상태 확인 */
  getState() {
    return { ...ADDON_STATE };
  }
};

/* =========================================================
 * REGION MODAL — VOICE / ADDON FULL INTEGRATION BLOCK
 * (APPEND ONCE, DO NOT SPLIT)
 * ========================================================= */

/* ---------------------------------------------------------
 * 1) 레기온 컨텍스트 세터
 *    - 레기온 모달이 열릴 때 반드시 호출되어야 함
 *    - Addon이 음성 질문의 기준을 판단하는 핵심 상태값
 * --------------------------------------------------------- */
window.setActiveRegionContext = function(regionId){
  window.activeRegionId = regionId;
  window.activeCountryCode = null;
};


/* ---------------------------------------------------------
 * 2) 레기온 모달 OPEN 트리거 브리지
 *    - 기존 igdc-site-control / 요약카드 트리거 유지
 *    - 모달이 열릴 때 컨텍스트를 자동으로 세팅
 * --------------------------------------------------------- */
(function(){
  const _openRegionModal = window.openRegionModal;

  window.openRegionModal = function(regionId, regionName){
    // 🔴 핵심: 모달이 열리는 순간 컨텍스트 확정
    window.setActiveRegionContext(regionId);

    // 기존 동작 유지
    if (typeof _openRegionModal === 'function') {
      _openRegionModal(regionId, regionName);
    }
  };
})();


/* ---------------------------------------------------------
 * 3) Addon → 레기온 상단 이슈바 업데이트 콜백
 *    - 음성 요약 / AI 재요청 결과 표시
 * --------------------------------------------------------- */
window.updateRegionIssueBar = function(text){
  const el = document.querySelector('.maru-region-issuebar .text');
  if(el){
    el.textContent = text;
  }
};


/* ---------------------------------------------------------
 * 4) 상세 설명 확장 이벤트 수신
 *    - "자세히 설명해줘" 대응
 * --------------------------------------------------------- */
document.addEventListener('maru:expand', function(e){
  if(!e || !e.detail) return;
  if(e.detail.type !== 'region') return;
  if(e.detail.id !== window.activeRegionId) return;

  const body = document.querySelector('.maru-region-body');
  if(!body) return;

  const data = e.detail.data || {};
  const text = data.detail || data.summary || '상세 분석 자료가 없습니다.';

  body.innerHTML = `
    <div class="maru-region-detail">
      <p>${text}</p>
    </div>
  `;

  
  /* =======================================================
 * LLM FREE QUERY ENGINE (Target-Scoped Conversation)
 * ===================================================== */
(function () {

  const LLM_ENDPOINT = '/.netlify/functions/maru-llm'; // 서버리스 LLM 엔드포인트
  const MAX_CONTEXT_LEN = 6;

  let conversationMemory = [];

  function getActiveTarget() {
    if (window.expandedCountry) {
      return {
        type: 'country',
        id: window.expandedCountry,
        label: window.activeCountryName || window.expandedCountry
      };
    }
    if (window.activeRegionId) {
      return {
        type: 'region',
        id: window.activeRegionId,
        label: window.activeRegionId
      };
    }
    return null;
  }

  function buildSystemPrompt(target) {
    return `
You are a world-class geopolitical, economic, social, and environmental analyst.
Your scope is strictly limited to the following target:

TYPE: ${target.type.toUpperCase()}
TARGET: ${target.label}

You must:
- Stay within the target scope
- Provide concise but deep analysis
- Avoid speculation beyond reasonable inference
- Structure answers clearly
- Be suitable for voice narration
`;
  }

  async function queryLLM(prompt, target) {
    const payload = {
      system: buildSystemPrompt(target),
      messages: conversationMemory.slice(-MAX_CONTEXT_LEN),
      user: prompt
    };

    const res = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('LLM request failed');
    const data = await res.json();
    return data.text;
  }

  async function handleFreeQuery(text) {
    const target = getActiveTarget();
    if (!target) return;

    conversationMemory.push({ role: 'user', content: text });

    // 1️⃣ 스냅샷 우선 확인
    let snapshotText = null;
    try {
      if (target.type === 'region' && SNAPSHOT?.view?.regions?.[target.id]) {
        snapshotText = SNAPSHOT.view.regions[target.id].detail;
      }
      if (target.type === 'country' && SNAPSHOT?.view?.countries?.[target.id]) {
        snapshotText = SNAPSHOT.view.countries[target.id].detail;
      }
    } catch (e) {}

    let answer;
    if (snapshotText && snapshotText.length > 200) {
      answer = snapshotText;
    } else {
      // 2️⃣ LLM 자유 질의
      answer = await queryLLM(text, target);
    }

    conversationMemory.push({ role: 'assistant', content: answer });

    // 3️⃣ UI 반영
    document.dispatchEvent(new CustomEvent('maru:expand', {
      detail: {
        type: target.type,
        id: target.id,
        data: { detail: answer }
      }
    }));

    // 4️⃣ 음성 출력
    if (window.MaruVoice && typeof MaruVoice.play === 'function') {
      MaruVoice.play({
        level: target.type,
        id: target.id,
        depth: 3,
        text: answer
      });
    }
  }

window.MaruFreeQuery = handleFreeQuery;

/* =======================================================
 * TEXT INPUT BAR CONTROL (VOICE COMMAND)
 * ===================================================== */
(function () {

  function openTextInputBar() {
    const bar = document.querySelector('.maru-input-bar');
    if (!bar) return;

    bar.classList.remove('hidden');
    const input = bar.querySelector('input');
    if (input) input.focus();
  }

  function closeTextInputBar() {
    const bar = document.querySelector('.maru-input-bar');
    if (!bar) return;

    bar.classList.add('hidden');
  }


  MaruAddon.handleVoiceInput = function (text) {
    if (!text) return;

    // 🔊 입력창 열기 명령
    if (
      text.includes('입력창 열어') ||
      text.includes('문자로 질문') ||
      text.includes('타이핑')
    ) {
      openTextInputBar();
      return;
    }

    // 🔊 입력창 닫기 명령
    if (
      text.includes('입력창 닫아') ||
      text.includes('그만 입력')
    ) {
      closeTextInputBar();
      return;
    }

    // 기존 로직 유지

  };

/* =======================================================
 * LLM FALLBACK BRIDGE (SNAPSHOT → MARU SEARCH)
 * ===================================================== */
(function () {

  async function requestLLMFallback(query, context) {
    if (!query) return;

    // context: { type: 'region' | 'country', id: 'asia' | 'kr' ... }
    const payload = {
      query,
      context: context || {},
      source: 'maru-addon'
    };

    try {
      // maru-search는 전역 fetch 엔진으로 가정
      const res = await fetch('/.netlify/functions/maru-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!data || !data.text) return;

      // 1) 화면 반영 (확대 영역 or body)
      if (context?.type === 'region') {
        document.dispatchEvent(new CustomEvent('maru:expand', {
          detail: {
            type: 'region',
            id: context.id,
            data: { detail: data.text }
          }
        }));
      }

      if (context?.type === 'country') {
        document.dispatchEvent(new CustomEvent('maru:expand', {
          detail: {
            type: 'country',
            id: context.id,
            data: { detail: data.text }
          }
        }));
      }

      // 2) 음성 읽기
      if (window.MaruVoice) {
        MaruVoice.play({
          level: context?.type || 'global',
          id: context?.id || null,
          depth: 3,
          text: data.text
        });
      }

    } catch (err) {
      console.warn('[MaruAddon] LLM fallback failed', err);
    }
  }

  /* 기존 음성 핸들러 확장 */

  MaruAddon.handleVoiceInput = function (text) {
    if (!text) return;


    // snapshot에서 못 찾았을 경우 → LLM fallback
    requestLLMFallback(text, {
      type: window.activeRegionId ? 'region'
           : window.activeCountryId ? 'country'
           : 'global',
      id: window.activeRegionId || window.activeCountryId || null
    });
  };


})();