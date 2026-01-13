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

  /* ================= STATE ================= */
  let backdrop = null;
  let modal = null;
  let detailOverlay = null;
  let voiceEnabled = false;     // global gate for voice-bridge reads
  let regionVoiceEnabled = false; // UI toggle state

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

    regionVoiceEnabled = false;
    voiceEnabled = false;
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
    window.MARU_REGION_VOICE_READY = true;

    backdrop = el('div', 'maru-region-backdrop');
    backdrop.addEventListener('click', closeAll);

    modal = el('div', 'maru-region-modal');

    // ---------- HEADER ----------
    const header = el('div', 'maru-region-header');
    const title = el('strong', null, '🌍 MARU GLOBAL INSIGHT — REGION');

    const issueBar = el(
      'div',
      'maru-region-issuebar',
      '<span>세계 주요 이슈</span><span class="text" data-mode="summary">현재 세계적 중요 이슈 요약 데이터가 준비되지 않았습니다.</span>'
    );

    // VOICE toggle (manual)
    const voiceBtn = el('button', 'maru-region-voice-toggle off', 'VOICE OFF');

    function setVoice(on) {
      regionVoiceEnabled = !!on;
      voiceEnabled = !!on;

      voiceBtn.classList.toggle('off', !regionVoiceEnabled);
      voiceBtn.textContent = regionVoiceEnabled ? 'VOICE ON' : 'VOICE OFF';

      if (regionVoiceEnabled) {
        if (typeof window.startMaruMic === 'function') {
          window.startMaruMic();
        }
      } else {
        if (typeof window.stopMaruMic === 'function') {
          window.stopMaruMic();
        }
      }
    }

    voiceBtn.addEventListener('click', () => setVoice(!regionVoiceEnabled));

    const closeBtn = el('button', 'maru-region-close', '닫기');
    closeBtn.addEventListener('click', closeAll);

    header.append(title, issueBar, voiceBtn, closeBtn);

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

    /* ---------- INPUT BAR SLOT ---------- */
    const inputBar = document.createElement('div');
    inputBar.className = 'maru-input-bar hidden';
    inputBar.innerHTML = `
      <input
        type="text"
        class="maru-input-text"
        placeholder="질문을 입력하세요… (Enter)"
      />
    `;
    modal.appendChild(inputBar);

    document.body.append(backdrop, modal);

    // Context set (preserve original intent)
    window.activeRegionId = regionId || window.activeRegionId || null;
    window.activeCountryCode = null;

    // Optional: activate addon AFTER mount (safe)
    try {
      if (window.MaruAddon && typeof window.MaruAddon.activate === 'function') {
        window.MaruAddon.activate({ type: 'region', id: window.activeRegionId });
      }
    } catch (e) {
      // swallow to avoid killing modal open
    }
  }

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
      if (!voiceEnabled) return null;

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
      if (!voiceEnabled) return null;

      if (window.MaruAddon && typeof window.MaruAddon.handleVoiceQuery === 'function') {
        window.MaruAddon.handleVoiceQuery('이 권역에 대해 자세히 설명해줘');
        return null;
      }

      // fallback overlay
      return openDetail(regionId);
    },

    readCritical: function () {
      if (!voiceEnabled) return null;

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
