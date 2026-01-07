/* =========================================================
 * MARU GLOBAL REGION MODAL — LARGE BRIEFING LAYOUT
 * 목적: 6개 권역을 '뉴스 브리핑 패널'로 크게 표시
 * - 선택 UI 아님
 * - 더미 텍스트 없음
 * - 트리거 / 로직 / 엔진 연계는 기존 유지
 * ========================================================= */
(function () {
  'use strict';

  const REGIONS = [
    { id: 'asia', label: '아시아' },
    { id: 'europe', label: '유럽' },
    { id: 'north_america', label: '북미' },
    { id: 'south_america', label: '남미' },
    { id: 'middle_east', label: '중동' },
    { id: 'africa', label: '아프리카' }
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
      .maru-region-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998}
      .maru-region-modal{
        position:fixed;inset:4%;
        background:#fffaf4; /* soft ivory */
        border-radius:18px;
        z-index:99999;
        box-shadow:0 20px 60px rgba(0,0,0,.35);
        display:flex;flex-direction:column;overflow:hidden
      }
      .maru-region-header{
        padding:18px 22px;border-bottom:1px solid #eee;
        display:flex;justify-content:space-between;align-items:center
      }
      .maru-region-header strong{font-size:18px}
      .maru-region-close{border:1px solid #ddd;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}
      .maru-region-body{
        flex:1;overflow:auto;padding:18px;
        display:grid;grid-template-columns:repeat(2,1fr);gap:18px
      }
      .maru-region-card{
        border:1px solid #e6d9c9;
        border-radius:16px;
        padding:18px;
        min-height:260px;
        cursor:pointer;
        display:flex;
        flex-direction:column;
        background:#fff3f6; /* soft cherry blossom */
      }
      .maru-region-card:hover{
        background:#ffe9ef;
        border-color:#d8b4c4
      }
      .maru-region-card h3{margin:0 0 10px;font-size:16px}
      .maru-region-brief{
        flex:1;font-size:13px;line-height:1.6;color:#444;
        white-space:pre-line
      }
      @media (max-width:900px){
        .maru-region-body{grid-template-columns:1fr}
      }
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
      <strong>🌍 MARU GLOBAL INSIGHT — REGION BRIEFING</strong>
      <button class="maru-region-close" type="button">닫기</button>
    `);
    header.querySelector('.maru-region-close').addEventListener('click', close);

    const body = el('div', 'maru-region-body');

    body.innerHTML = REGIONS.map(r => `
      <div class="maru-region-card" data-region="${r.id}">
        <h3>${r.label}</h3>
        <div class="maru-region-brief"></div>
      </div>
    `).join('');

    body.addEventListener('click', function (e) {
      const card = e.target.closest('.maru-region-card');
      if (!card) return;
      const regionId = card.getAttribute('data-region');
      if (typeof window.openMaruGlobalCountryModal === 'function') {
        window.openMaruGlobalCountryModal(regionId);
      }
    });

    modal.appendChild(header);
    modal.appendChild(body);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
  }

  window.openMaruGlobalRegionModal = open;
})();
