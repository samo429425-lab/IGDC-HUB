/* =========================================================
 * MARU GLOBAL REGION MODAL (v1.1 – ADMIN ONLY) — FIXED
 * 1차 팝업: 권역 선택
 * - 선택 시 2차(국가) 팝업: openMaruGlobalCountryModal(regionId)
 * - 보이스: MaruVoice.play({level:'region', region, depth:1}) (존재 시)
 * ========================================================= */
(function () {
  'use strict';

  const REGIONS = [
    { id: 'asia',          label: '아시아' },
    { id: 'europe',        label: '유럽' },
    { id: 'north_america', label: '북미' },
    { id: 'south_america', label: '남미' },
    { id: 'middle_east',   label: '중동' },
    { id: 'africa',        label: '아프리카' },
  ];

  let backdrop = null;
  let modal = null;

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
      .maru-region-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99998}
      .maru-region-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        width:min(720px,92vw);max-height:85vh;overflow:auto;background:#fff;border-radius:14px;
        z-index:99999;box-shadow:0 12px 36px rgba(0,0,0,.25)}
      .maru-region-header{padding:14px 18px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
      .maru-region-body{padding:16px 18px;display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
      .maru-region-btn{padding:12px 12px;border:1px solid #ddd;border-radius:12px;background:#fff;cursor:pointer;font-size:14px;text-align:left}
      .maru-region-btn:hover{background:#fafafa}
      .maru-region-close{border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 10px;cursor:pointer}
      @media (max-width:520px){.maru-region-body{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function close() {
    if (modal) modal.remove();
    if (backdrop) backdrop.remove();
    modal = backdrop = null;
  }

  function open() {
    if (modal) return;
    injectStyle();

    backdrop = el('div', 'maru-region-backdrop');
    backdrop.addEventListener('click', close);

    modal = el('div', 'maru-region-modal');

    const header = el('div', 'maru-region-header', `
      <strong>🌍 MARU GLOBAL INSIGHT — 권역 선택</strong>
      <button class="maru-region-close" type="button">닫기</button>
    `);

    header.querySelector('.maru-region-close').addEventListener('click', close);

    const body = el('div', 'maru-region-body');
    body.innerHTML = REGIONS.map(r => `
      <button class="maru-region-btn" type="button" data-region="${r.id}">
        <div style="font-weight:700">${r.label}</div>
        <div style="font-size:12px;opacity:.75;margin-top:2px">권역 요약 → 국가 상세</div>
      </button>
    `).join('');

    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-region]');
      if (!btn) return;
      const region = btn.getAttribute('data-region');
      close();

      // Voice summary (optional)
      if (window.MaruVoice && typeof window.MaruVoice.play === 'function') {
        try { window.MaruVoice.play({ level: 'region', region, depth: 1 }); } catch (_) {}
      }

      // Open 2nd modal (country)
      if (typeof window.openMaruGlobalCountryModal === 'function') {
        window.openMaruGlobalCountryModal(region);
      } else {
        alert('Country modal 호출 함수를 찾지 못했습니다: openMaruGlobalCountryModal');
      }
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    modal.appendChild(header);
    modal.appendChild(body);
  }

  // expose
  window.openMaruGlobalRegionModal = open;
})();
