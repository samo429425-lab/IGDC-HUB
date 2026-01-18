/* =========================================================
 * MARU GLOBAL REGION MODAL — FINAL MASTER EDITION (UPGRADED, RESTORED)
 * ---------------------------------------------------------
 * Restored:
 *  - Proper open() scope (was broken by top-level refs to header/title/modal)
 * Preserved (from upgraded original):
 *  - 7 Regions incl. Eurasia
 *  - Region cards -> Country modal
 *  - Issue bar + external updater hook (updateRegionIssueBar)
 *  - Voice toggle (manual) + Voice bridge (read / detail / critical)
 *  - Voice-only Detail Briefing Overlay (NO button conflict)
 *  - Input bar slot (hidden)
 *  - Addon expand event bridge (maru:expand)
 *  - Legacy open entry: window.openMaruGlobalRegion()
 *  - Site-control entry: window.openMaruGlobalRegionModal(...)
 * ========================================================= */

(function () {
  'use strict';

  /* ================= REGIONS ================= */
  const REGIONS = [
    { id: 'asia', label: 'Wide Asia' },
    { id: 'europe', label: 'Europe' },
    { id: 'eurasia', label: 'Eurasia / Central Asia & Russia' },
    { id: 'north_america', label: 'North America' },
    { id: 'south_america', label: 'Central & South America' },
    { id: 'middle_east', label: 'Middle East' },
    { id: 'africa', label: 'Africa' }
  ];

/* =========================================================
 * ADDON → REGION MODAL DATA INJECTORS
 * ========================================================= */

// 1) 1차 글로벌 인사이트 결과 주입 (전체 Region 요약)
window.injectMaruGlobalRegionData = function (regions) {
  if (!Array.isArray(regions)) return;

  regions.forEach(r => {
    // Region 카드 요약 텍스트 주입
    const brief = document.querySelector(
      `.maru-region-card[data-region="${r.id}"] .maru-region-brief`
    );
    if (brief && r.summary) {
      brief.textContent = r.summary;
    }

    // Issue Bar 갱신 (현재 열려 있는 Region만)
    if (window.activeRegionId === r.id && r.issues && window.updateRegionIssueBar) {
      window.updateRegionIssueBar(r.issues);
    }
  });
};

// 2) 특정 Region 컨텍스트 질의 응답 주입 (대화/보이스 결과)
window.injectRegionContextResult = function (regionId, result) {
  if (!regionId || !result) return;
  if (window.activeRegionId && regionId !== window.activeRegionId) return;

  // 요약 갱신
  if (result.summary) {
    const brief = document.querySelector(
      `.maru-region-card[data-region="${regionId}"] .maru-region-brief`
    );
    if (brief) brief.textContent = result.summary;
  }

  // 이슈 갱신
  if (result.issues && window.updateRegionIssueBar) {
    window.updateRegionIssueBar(result.issues);
  }
};

 /* ================= STATE ================= */
let backdrop = null;
let modal = null;
let detailOverlay = null;

/*
 * 음성 상태는 단일 기준(MaruAddon)만 사용
 * - 레기온/컨트리 독립 상태 제거
 * - UI는 항상 Addon 상태를 반영
 */
const isVoiceEnabled = () =>
  window.MaruAddon && typeof window.MaruAddon.isVoiceEnabled === 'function'
    ? window.MaruAddon.isVoiceEnabled()
    : false;

/*
 * 레기온 UI용 READY 플래그 (표시/동기화 목적)
 * 실제 음성 ON/OFF 판단은 절대 여기서 하지 않음
 */
let regionVoiceReady = false;

  /* ================= UTIL ================= */
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ================= STYLE ================= */
  function injectStyle() {
    if (document.getElementById('maru-region-style')) return;
    const style = el('style');
    style.id = 'maru-region-style';
    style.textContent = `
      .maru-region-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998}
      .maru-region-modal{position:fixed;inset:4%;background:#fffaf4;border-radius:20px;z-index:99999;box-shadow:0 30px 80px rgba(0,0,0,.4);display:flex;flex-direction:column;overflow:hidden}
      .maru-region-header{padding:18px 22px;border-bottom:1px solid #eee;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:14px}
      .maru-region-header strong{font-size:18px;color:#1f3a5f}
      .maru-region-voice-toggle{border:1px solid #d6c7b5;background:#fff;border-radius:10px;padding:6px 10px;font-size:12px;cursor:pointer}
      .maru-region-voice-toggle.off{opacity:.45}
      .maru-region-issuebar{display:flex;align-items:center;gap:8px;background:#fff1f4;border:1px solid #e2c6cf;border-radius:10px;padding:6px 10px;font-size:12px;white-space:nowrap;overflow:hidden}
      .maru-region-close{border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}
      .maru-region-body{flex:1;overflow:auto;padding:18px;display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
      @media(max-width:900px){.maru-region-body{grid-template-columns:1fr}}
      .maru-region-card{border:1px solid #e6d9c9;border-radius:18px;padding:18px;background:#fff3f6;cursor:pointer;display:flex;flex-direction:column;min-height:280px}
      .maru-region-card:hover{background:#ffe9ef}
      .maru-region-card h3{margin:0 0 10px;font-size:16px;color:#1f3a5f}
      .maru-region-brief{flex:1;font-size:13px;line-height:1.6;color:#000;white-space:pre-line}
      .maru-region-empty{font-size:12px;color:#777;font-style:italic}
      /* ===== DETAIL OVERLAY ===== */
      .maru-region-detail{position:fixed;inset:8%;background:#ffffff;border-radius:22px;z-index:100000;box-shadow:0 40px 90px rgba(0,0,0,.45);padding:28px;overflow:auto}
      .maru-region-detail h2{margin:0 0 14px;font-size:20px;color:#1f3a5f}
      .maru-region-detail p{font-size:14px;line-height:1.8;color:#000}
      .maru-region-detail-close{position:absolute;top:18px;right:18px;border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}

      /* ================= INPUT BAR ================= */
      .maru-input-bar{position:sticky;bottom:0;width:100%;padding:6px 10px;background:#fff9f4;border-top:1px solid #e6dcd3;box-sizing:border-box;z-index:5}
      .maru-input-bar.hidden{display:none}
      .maru-input-text{width:100%;height:30px;padding:4px 10px;font-size:12px;line-height:1.2;border-radius:6px;border:1px solid #ccc;outline:none;box-sizing:border-box}
      @media (max-width:640px){.maru-input-text{height:32px;font-size:13px}}
    `;
    document.head.appendChild(style);
  }

  /* ================= CORE ================= */
  function closeAll() {
    try {
      if (typeof window.stopMaruMic === 'function') window.stopMaruMic();
    } catch (e) {}

    if (detailOverlay) detailOverlay.remove();
    if (modal) modal.remove();
    if (backdrop) backdrop.remove();

    detailOverlay = null;
    modal = null;
    backdrop = null;

    window.MARU_REGION_VOICE_READY = false;
  }

  function openDetail(regionId) {
    if (detailOverlay) detailOverlay.remove();

    const card = document.querySelector(`.maru-region-card[data-region="${regionId}"] .maru-region-brief`);
    const text = card ? card.textContent.trim() : '아직 상세 브리핑 데이터가 없습니다.';

    detailOverlay = el('div', 'maru-region-detail');
    detailOverlay.innerHTML =
      `<button class="maru-region-detail-close">닫기</button>` +
      `<h2>${String(regionId || '').toUpperCase()} — 상세 브리핑</h2>` +
      `<p>${text}</p>`;

    detailOverlay.querySelector('button').addEventListener('click', () => detailOverlay.remove());
    document.body.appendChild(detailOverlay);
    return text;
  }

  function open(regionId, regionName) {
    if (modal) return;

    injectStyle();

    // Ready flag for downstream integrations
    backdrop = el('div', 'maru-region-backdrop');
    backdrop.addEventListener('click', closeAll);

    modal = el('div', 'maru-region-modal');

    // ---------- HEADER ----------

const header = el('div', 'maru-region-header');

// 제목
const title = el('strong', null, '🌍 MARU GLOBAL INSIGHT — REGION');

// 이슈 바
const issueBar = el(
  'div',
  'maru-region-issuebar',
  '<span>세계 주요 이슈</span><span class="text" data-mode="summary">현재 세계적 중요 이슈 요약 데이터가 준비되지 않았습니다.</span>'
);

// 음성 토글
const voiceToggle = el('label', 'maru-region-voice-toggle');
voiceToggle.innerHTML = `
  <input type="checkbox" id="maruRegionVoiceToggle" />
  <span>음성</span>
`;

const regionVoiceCheckbox = voiceToggle.querySelector('#maruRegionVoiceToggle');

// 초기 상태: Addon 기준
const initialVoice =
  window.MaruAddon && typeof window.MaruAddon.isVoiceEnabled === 'function'
    ? window.MaruAddon.isVoiceEnabled()
    : false;

regionVoiceCheckbox.checked = initialVoice;
window.MARU_REGION_VOICE_READY = initialVoice;

// 닫기 버튼
const closeBtn = el('button', 'maru-region-close', '닫기');
closeBtn.addEventListener('click', closeAll);

// 👉 여기서 한 번에 붙임 (중요)
header.append(title, issueBar, voiceToggle, closeBtn);


    const title = el('strong', null, '🌍 MARU GLOBAL INSIGHT — REGION');

    const issueBar = el(
      'div',
      'maru-region-issuebar',
      '<span>세계 주요 이슈</span><span class="text" data-mode="summary">현재 세계적 중요 이슈 요약 데이터가 준비되지 않았습니다.</span>'
    );


    const closeBtn = el('button', 'maru-region-close', '닫기');
    closeBtn.addEventListener('click', closeAll);

    // ---------- BODY ----------
    const body = el('div', 'maru-region-body');

    REGIONS.forEach(r => {
      const card = el('div', 'maru-region-card');
      card.dataset.region = r.id;
      card.innerHTML =
        `<h3>${r.label}</h3>` +
        `<div class="maru-region-brief"><div class="maru-region-empty">아직 올라온 데이터가 없습니다.</div></div>`;

      card.addEventListener('click', () => {
        // click region card → country modal
        if (typeof window.openMaruGlobalCountryModal === 'function') {
          window.openMaruGlobalCountryModal(r.id);
        }
      });

      body.appendChild(card);
    });

    modal.append(header, body);
   document.body.append(backdrop, modal);
   const convoSlot = el('div', 'maru-conversation-slot');
   modal.appendChild(convoSlot);

// === Conversation mount (FINAL — modal-anchored) ===
if (window.MaruConversationModal) {
  try {
    // Anchor to modal (position:fixed) so container's absolute-bottom is inside modal
    window.MaruConversationModal.ensureReady?.(modal);
    window.MaruConversationModal.setVoiceMode?.(false); // show by default
    window.MaruConversationModal.showInput?.();
    window.MaruConversationModal.setContext?.({ level: 'region', id: regionId });
  } catch (e) {
    console.warn('[MARU][REGION] Conversation mount failed', e);
  }
}

/* ===== CONVERSATION INPUT VISIBILITY (REGION FINAL) ===== */

// 초기 진입 시: 음성 상태 기준으로 입력창 표시/숨김
(function syncConversationInputOnOpen() {
  const voiceOn =
    window.MaruAddon && typeof window.MaruAddon.isVoiceEnabled === 'function'
      ? window.MaruAddon.isVoiceEnabled()
      : false;

  if (!voiceOn) {
    window.MaruConversationModal?.showInput?.();
  } else {
    window.MaruConversationModal?.hideInput?.();
  }
})();

// 음성 ON 상태에서도 "문자 입력창 띄워줘" 요청 시 강제 표시
window.forceShowConversationInput = function () {
  window.MaruConversationModal?.showInput?.();
};

// Context set (preserve original intent) — 반드시 open(regionId) 안
window.activeRegionId = regionId || window.activeRegionId || null;
window.activeCountryCode = null;

// Optional: activate addon AFTER mount (safe) — open(regionId) 안
try {
  if (window.MaruAddon && typeof window.MaruAddon.activate === 'function') {
    window.MaruAddon.activate({ type: 'region', id: window.activeRegionId });
  }
} catch (e) {
  // swallow to avoid killing modal open
}

} // ← open(regionId, regionName) 닫기 (여기 딱 1번)

/* ================= PUBLIC ================= */
// site-control calls this
window.openMaruGlobalRegionModal = function (regionId, regionName) {
  window.activeRegionId = regionId || null;
  window.activeCountryCode = null;
  open(regionId, regionName);
};

  /* ================= VOICE BRIDGE ================= */
  window.MaruRegionVoice = {
    readRegion: function (regionId) {

      // Addon preferred (original upgraded behavior)
      if (window.MaruAddon && typeof window.MaruAddon.handleVoiceQuery === 'function') {
        window.MaruAddon.handleVoiceQuery('이 권역에 대해 설명해줘');
        return null;
      }

      const card = document.querySelector(`.maru-region-card[data-region="${regionId}"] .maru-region-brief`);
      return card ? card.textContent.trim()
        : '해당 권역에 대한 요약 분석 자료가 아직 준비되지 않았습니다.';
    },

    readRegionDetail: function (regionId) {

      if (window.MaruAddon && typeof window.MaruAddon.handleVoiceQuery === 'function') {
        window.MaruAddon.handleVoiceQuery('이 권역에 대해 자세히 설명해줘');
        return null;
      }

      // fallback overlay
      return openDetail(regionId);
    },

    readCritical: function () {

      if (window.MaruAddon && typeof window.MaruAddon.handleVoiceQuery === 'function') {
        window.MaruAddon.handleVoiceQuery('이 권역의 주요 이슈를 설명해줘');
        return null;
      }

      const t = document.querySelector('.maru-region-issuebar .text');
      return t ? t.textContent.trim()
        : '현재 권역 차원의 중요 이슈는 확인되지 않고 있습니다.';
    }
  };

  // Addon → issue bar update hook (original)
  window.updateRegionIssueBar = function (text) {
    const t = document.querySelector('.maru-region-issuebar .text');
    if (t) t.textContent = text;
  };

  // Addon → expand event bridge (original)
  document.addEventListener('maru:expand', function (e) {
    if (!e || !e.detail) return;
    if (e.detail.type !== 'region') return;
    if (e.detail.id !== window.activeRegionId) return;

    openDetail(e.detail.id);
  });

  // Legacy: direct entry used elsewhere (original "last call")
  window.openMaruGlobalRegion = function () {
    open(window.activeRegionId || null);
  };

})();
