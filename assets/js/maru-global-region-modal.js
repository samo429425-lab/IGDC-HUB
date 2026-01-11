/* =========================================================
 * MARU GLOBAL REGION MODAL — FINAL MASTER EDITION (RESTORED)
 * ---------------------------------------------------------
 * ✔ Original upgraded features preserved 100%
 * ✔ Broken DOM / scope order fixed
 * ✔ No feature removed
 * ========================================================= */

(function () {
  'use strict';

  /* ================= STATE ================= */
  let backdrop = null;
  let modal = null;

  /* ================= UTILS ================= */
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function injectStyle() {
    if (document.getElementById('maru-region-style')) return;
    const style = el('style');
    style.id = 'maru-region-style';
    style.textContent = `
      .maru-region-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998}
      .maru-region-modal{position:fixed;inset:4%;background:#fff;border-radius:12px;z-index:99999;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)}
      .maru-region-header{padding:18px 22px;border-bottom:1px solid #e5e5e5;display:grid;grid-template-columns:auto 1fr auto auto;gap:12px;align-items:center}
      .maru-region-body{flex:1;overflow:auto;padding:22px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
      .maru-region-card{border:1px solid #ddd;border-radius:10px;padding:14px;cursor:pointer}
      .maru-region-card:hover{background:#f7f7f7}
      .maru-region-empty{color:#888;font-size:13px}
      .maru-region-issuebar{font-size:13px;color:#444}
      .maru-region-voice-toggle.off{opacity:.5}
      .maru-region-close{border:0;background:#eee;border-radius:6px;padding:6px 10px;cursor:pointer}
    `;
    document.head.appendChild(style);
  }

  function closeAll() {
    try {
      if (typeof window.stopMaruMic === 'function') {
        window.stopMaruMic();
      }
    } catch (e) {}

    if (modal) {
      modal.remove();
      modal = null;
    }
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

  /* ================= OPEN ================= */
  function open(regionId, regionName) {
    if (modal) return;

    injectStyle();

    backdrop = el('div', 'maru-region-backdrop');
    backdrop.addEventListener('click', closeAll);

    modal = el('div', 'maru-region-modal');

    /* ---------- HEADER (복원된 정의) ---------- */
    const header = el('div', 'maru-region-header');

    const title = el(
      'strong',
      null,
      '🌍 MARU GLOBAL INSIGHT — REGION'
    );

    const issueBar = el(
      'div',
      'maru-region-issuebar',
      '<span>세계 주요 이슈</span> ' +
      '<span class="text" data-mode="summary">현재 세계적 중요 이슈 요약 데이터가 준비되지 않았습니다.</span>'
    );

    /* ---------- VOICE (원몸 유지) ---------- */
    let regionVoiceEnabled = false;

    const voiceBtn = el(
      'button',
      'maru-region-voice-toggle off',
      'VOICE OFF'
    );

    voiceBtn.addEventListener('click', () => {
      regionVoiceEnabled = !regionVoiceEnabled;
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
    });

    const closeBtn = el('button', 'maru-region-close', '닫기');
    closeBtn.addEventListener('click', closeAll);

    header.append(title, issueBar, voiceBtn, closeBtn);

    /* ---------- BODY (원몸 유지) ---------- */
    const body = el('div', 'maru-region-body');

    if (Array.isArray(window.REGIONS)) {
      window.REGIONS.forEach(r => {
        const card = el('div', 'maru-region-card');
        card.dataset.region = r.id;
        card.innerHTML = `
          <h3>${r.label}</h3>
          <div class="maru-region-brief">
            <div class="maru-region-empty">아직 올라온 데이터가 없습니다.</div>
          </div>
        `;
        card.addEventListener('click', () => {
          if (typeof window.openMaruGlobalCountryModal === 'function') {
            window.openMaruGlobalCountryModal(r.id);
          }
        });
        body.appendChild(card);
      });
    } else {
      body.innerHTML = '<div class="maru-region-empty">REGIONS 데이터가 없습니다.</div>';
    }

    modal.append(header, body);
    document.body.append(backdrop, modal);
  }

  /* ================= GLOBAL BRIDGE ================= */
  window.openMaruGlobalRegionModal = function (regionId, regionName) {
    window.activeRegionId = regionId || null;
    window.activeCountryCode = null;
    open(regionId, regionName);
  };

// 외부에서 Region 모달을 열기 위한 진입점
window.openMaruGlobalRegion = function () {
  open();
};

})();
