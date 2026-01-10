/* =========================================================
 * MARU GLOBAL REGION MODAL
 * FINAL CANONICAL VERSION
 * ========================================================= */

(function () {
  'use strict';

  let regionModalEl = null;

  /* =========================
   * OPEN REGION MODAL
   * ========================= */
  window.openMaruGlobalRegionModal = function (regionId, regionName) {
    // 컨텍스트 세팅 (Addon 인식용)
    window.activeRegionId = regionId;
    window.activeCountryCode = null;

    if (!regionModalEl) {
      regionModalEl = buildRegionModal();
      document.body.appendChild(regionModalEl);
    }

    // 타이틀
    const title = regionModalEl.querySelector('.maru-region-title');
    if (title) title.textContent = `🌐 MARU GLOBAL INSIGHT — ${regionName || regionId}`;

    // 이슈바 초기화
    updateRegionIssueBar('권역별 중요 이슈 요약 대기 중…');

    regionModalEl.classList.add('open');
  };

  /* =========================
   * BUILD MODAL
   * ========================= */
  function buildRegionModal() {
    const modal = document.createElement('div');
    modal.className = 'maru-region-modal';

    modal.innerHTML = `
      <div class="maru-region-header">
        <strong class="maru-region-title"></strong>
        <div class="maru-region-issuebar">
          <span class="text"></span>
        </div>
        <button class="maru-region-close">닫기</button>
      </div>
      <div class="maru-region-body"></div>
    `;

    modal.querySelector('.maru-region-close').onclick = () => {
      modal.classList.remove('open');
      window.activeRegionId = null;
    };

    return modal;
  }

  /* =========================
   * ISSUE BAR UPDATE (Addon callback)
   * ========================= */
  window.updateRegionIssueBar = function (text) {
    const el = document.querySelector('.maru-region-issuebar .text');
    if (el) el.textContent = text;
  };

  /* =========================
   * EXPAND EVENT (DETAIL VIEW)
   * ========================= */
  document.addEventListener('maru:expand', (e) => {
    const { type, id, data } = e.detail;
    if (type !== 'region') return;
    if (id !== window.activeRegionId) return;

    const body = regionModalEl?.querySelector('.maru-region-body');
    if (!body) return;

    body.innerHTML = `
      <h3>상세 분석</h3>
      <p>${data.detail || data.summary || '상세 자료가 없습니다.'}</p>
    `;
  });

})();
