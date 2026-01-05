
/**
 * igdc-diag-admin-bridge.js (SAFE VERSION)
 * - 운영 환경 안전 패치
 * - 진단 모듈(IGDC_DIAG) 미존재/실패 시에도
 *   어드민 기능을 절대 차단하지 않음
 * - 진단은 선택적(optional) 보조 기능
 */

(function () {
  'use strict';

  function log(msg, data) {
    try {
      console.warn('[IGDC-DIAG-BRIDGE]', msg, data || '');
    } catch (e) {}
  }

  function runDiagnosticSafely() {
    if (window.IGDC_DIAG && typeof window.IGDC_DIAG.runAll === 'function') {
      try {
        return window.IGDC_DIAG.runAll();
      } catch (e) {
        log('Diagnostic execution failed', e);
      }
    } else {
      log('IGDC_DIAG not loaded – diagnostic skipped');
    }
    return null;
  }

  function bindAdminButtons() {
    const selectors = [
      '[data-action="run-diagnostic"]',
      '.btn-run-diagnostic',
      '#runDiagnostic'
    ];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(btn => {
        btn.addEventListener('click', function () {
          runDiagnosticSafely();
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAdminButtons);
  } else {
    bindAdminButtons();
  }

  window.IGDC_DIAG_BRIDGE_READY = true;
})();
