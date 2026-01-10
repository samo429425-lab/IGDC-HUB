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

  /* =====================================================
   * PUBLIC API (STABLE)
   * ===================================================== */
  window.MaruAddon = {
    setSnapshot,
    handleVoiceQuery(text) {
      VoiceSession.handle(text);
    },
    criticalDetail: requestCriticalDetail,
    get snapshot() {
      return SNAPSHOT.raw;
    },
    get status() {
      return SNAPSHOT.status;
    },
    get ts() {
      return SNAPSHOT.ts;
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

})();
