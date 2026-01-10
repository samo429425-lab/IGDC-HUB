/* =========================================================
 * MARU GLOBAL COUNTRY MODAL
 * FINAL CANONICAL VERSION
 * ========================================================= */

(function () {
  'use strict';

  let countryModalEl = null;

  /* =========================
   * OPEN COUNTRY MODAL
   * ========================= */
  window.openMaruGlobalCountryModal = function (countryCode, countryName) {
    // 컨텍스트 세팅 (Addon 인식용)
    window.activeCountryCode = countryCode;

    if (!countryModalEl) {
      countryModalEl = buildCountryModal();
      document.body.appendChild(countryModalEl);
    }

    const title = countryModalEl.querySelector('.maru-country-title');
    if (title) title.textContent = `🌐 MARU GLOBAL INSIGHT — ${countryName || countryCode}`;

    updateCountryIssueBar('국가별 중요 이슈 요약 대기 중…');

    countryModalEl.classList.add('open');
  };

  /* =========================
   * BUILD MODAL
   * ========================= */
  function buildCountryModal() {
    const modal = document.createElement('div');
    modal.className = 'maru-country-modal';

    modal.innerHTML = `
      <div class="maru-country-header">
        <strong class="maru-country-title"></strong>
        <div class="maru-country-issuebar">
          <span class="text"></span>
        </div>
        <button class="maru-country-close">닫기</button>
      </div>
      <div class="maru-country-body"></div>
    `;

    modal.querySelector('.maru-country-close').onclick = () => {
      modal.classList.remove('open');
      window.activeCountryCode = null;
    };

    return modal;
  }

  /* =========================
   * ISSUE BAR UPDATE (Addon callback)
   * ========================= */
  window.updateCountryIssueBar = function (text) {
    const el = document.querySelector('.maru-country-issuebar .text');
    if (el) el.textContent = text;
  };

  /* =========================
   * EXPAND EVENT (DETAIL VIEW)
   * ========================= */
  document.addEventListener('maru:expand', (e) => {
    const { type, id, data } = e.detail;
    if (type !== 'country') return;
    if (id !== window.activeCountryCode) return;

    const body = countryModalEl?.querySelector('.maru-country-body');
    if (!body) return;

    body.innerHTML = `
      <h3>상세 분석</h3>
      <p>${data.detail || data.summary || '상세 자료가 없습니다.'}</p>
    `;
  });

})();
