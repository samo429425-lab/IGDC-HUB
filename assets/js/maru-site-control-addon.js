
/**
 * maru-site-control-addon.js
 * MARU Global Insight 전용 애드온
 *
 * 원칙:
 * - igdc-site-control.js 절대 침범 ❌
 * - 레이아웃/스크롤/패널 상태 건드리지 않음 ❌
 * - 오직 MARU 글로벌 인사이트 카드 클릭만 처리 ⭕
 */

(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    const maruCard = document.querySelector(
      '.igdc-sc-card[data-role="maru-global"]'
    );

    if (!maruCard) {
      console.warn('[MARU ADDON] maru-global card not found');
      return;
    }

    maruCard.addEventListener('click', function () {
      if (typeof window.openMaruGlobalRegionModal === 'function') {
        window.openMaruGlobalRegionModal();
      } else {
        console.error('[MARU ADDON] openMaruGlobalRegionModal is undefined');
        alert('MARU 글로벌 인사이트 모듈이 아직 준비되지 않았습니다.');
      }
    });
  });

})();
