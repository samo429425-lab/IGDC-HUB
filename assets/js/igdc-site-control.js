
/**
 * igdc-site-control.js (PATCHED)
 * 역할 분리 완료 버전
 */

(function () {
  'use strict';

  function qsa(sel, el) {
    return Array.from((el || document).querySelectorAll(sel));
  }

  function on(el, ev, fn) {
    if (el) el.addEventListener(ev, fn);
  }

  function initSiteControlCards() {
    const cards = qsa('.igdc-sc-card');

    cards.forEach(card => {
      const role = card.dataset.role;

      on(card, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (role === 'site-ai') {
          if (typeof window.openSelfCheckModal === 'function') {
            window.openSelfCheckModal();
          }
          return;
        }

        if (role === 'maru-global') {
          if (typeof window.openMaruGlobalRegionModal === 'function') {
            window.openMaruGlobalRegionModal();
          } else {
            alert('MARU 글로벌 인사이트 모듈이 아직 로드되지 않았습니다.');
          }
          return;
        }
      });
    });
  }

  function normalizeButtonLabels() {
    qsa('.igdc-sc-card[data-role="site-ai"] .btn-primary').forEach(btn => {
      btn.textContent = '사이트 상황';
    });
    qsa('.igdc-sc-card[data-role="site-ai"] .btn-secondary').forEach(btn => {
      btn.textContent = 'AI 자동 진단 실행';
    });

    qsa('.igdc-sc-card[data-role="maru-global"] .btn-primary').forEach(btn => {
      btn.textContent = '실시간 글로벌 이슈';
    });
    qsa('.igdc-sc-card[data-role="maru-global"] .btn-secondary').forEach(btn => {
      btn.textContent = 'AI 글로벌 인사이트 실행';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initSiteControlCards();
    normalizeButtonLabels();
  });

})();
