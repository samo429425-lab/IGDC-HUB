/* =========================================================
 * MARU GLOBAL REGION MODAL — FINAL MASTER EDITION (UPGRADED)
 * ---------------------------------------------------------
 * Added:
 *  - 7th Region: Eurasia (Central Asia & Russia)
 *  - Voice-only Detail Briefing Overlay (NO button conflict)
 *
 * Rules:
 *  - Click region card → Country Modal
 *  - Voice "read" → read visible brief
 *  - Voice "detail" → open DETAIL overlay + detailed voice
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
  let voiceEnabled = true;

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
    `;
    document.head.appendChild(style);
  }

  /* ================= CORE ================= */
  function closeAll() {
    if (detailOverlay) detailOverlay.remove();
    if (modal) modal.remove();
    if (backdrop) backdrop.remove();
    detailOverlay = modal = backdrop = null;
    window.MARU_REGION_VOICE_READY = false;
  }

  function openDetail(regionId) {
    if (detailOverlay) detailOverlay.remove();
    const card = document.querySelector(`.maru-region-card[data-region="${regionId}"] .maru-region-brief`);
    const text = card ? card.textContent.trim() : '아직 상세 브리핑 데이터가 없습니다.';

    detailOverlay = el('div', 'maru-region-detail');
    detailOverlay.innerHTML = `<button class="maru-region-detail-close">닫기</button><h2>${regionId.toUpperCase()} — 상세 브리핑</h2><p>${text}</p>`;
    detailOverlay.querySelector('button').addEventListener('click', () => detailOverlay.remove());
    document.body.appendChild(detailOverlay);
    return text;
  }

  function open() {
    if (modal) return;
    injectStyle();
    window.MARU_REGION_VOICE_READY = true;

    backdrop = el('div', 'maru-region-backdrop');
    backdrop.addEventListener('click', closeAll);

    modal = el('div', 'maru-region-modal');

    const header = el('div', 'maru-region-header');
    const title = el('strong', null, '🌍 MARU GLOBAL INSIGHT — REGION');
    const issueBar = el('div', 'maru-region-issuebar', '<span>중요 이슈</span><span class="text">현재 중요 이슈 없음</span>');

    const voiceBtn = el('button', 'maru-region-voice-toggle', 'VOICE ON');
    voiceBtn.addEventListener('click', () => {
      voiceEnabled = !voiceEnabled;
      voiceBtn.classList.toggle('off', !voiceEnabled);
      voiceBtn.textContent = voiceEnabled ? 'VOICE ON' : 'VOICE OFF';
    });

    const closeBtn = el('button', 'maru-region-close', '닫기');
    closeBtn.addEventListener('click', closeAll);

    header.append(title, issueBar, voiceBtn, closeBtn);

    const body = el('div', 'maru-region-body');

    REGIONS.forEach(r => {
      const card = el('div', 'maru-region-card');
      card.dataset.region = r.id;
      card.innerHTML = `<h3>${r.label}</h3><div class="maru-region-brief"><div class="maru-region-empty">아직 올라온 데이터가 없습니다.</div></div>`;
      card.addEventListener('click', () => {
        if (typeof window.openMaruGlobalCountryModal === 'function') {
          window.openMaruGlobalCountryModal(r.id);
        }
      });
      body.appendChild(card);
    });

    modal.append(header, body);
    document.body.append(backdrop, modal);
  }

  /* ================= PUBLIC ================= */
  window.openMaruGlobalRegionModal = open;

  /* ================= VOICE BRIDGE ================= */
  window.MaruRegionVoice = {
    readRegion: function (regionId) {
      if (!voiceEnabled) return null;
      const card = document.querySelector(`.maru-region-card[data-region="${regionId}"] .maru-region-brief`);
      return card ? card.textContent.trim() : null;
    },
    readRegionDetail: function (regionId) {
      if (!voiceEnabled) return null;
      return openDetail(regionId);
    },
    readCritical: function () {
      if (!voiceEnabled) return null;
      const el = document.querySelector('.maru-region-issuebar .text');
      return el ? el.textContent.trim() : null;
    }
  };

})();
