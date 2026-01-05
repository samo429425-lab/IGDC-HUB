/**
 * igdc-diag-admin-bridge.js (FINAL)
 * - 전체 헬스체크 버튼을 실제 진단 엔진에 연결
 * - 차단/alert 없음
 * - 진단 실패해도 UI 동작 유지
 */
(function () {
  'use strict';

  function safeRunAll() {
    if (window.IGDC_DIAG && typeof window.IGDC_DIAG.runAll === 'function') {
      try {
        return window.IGDC_DIAG.runAll();
      } catch (e) {
        console.error('[IGDC][BRIDGE] runAll failed', e);
      }
    } else {
      console.warn('[IGDC][BRIDGE] IGDC_DIAG not ready');
    }
    return null;
  }

  function bind() {
    // 우측 패널 "전체 헬스체크" 버튼
    const btns = document.querySelectorAll(
      '#runAllHealthCheck, .btn-run-all-health, [data-action="run-all-health"]'
    );
    btns.forEach(btn => {
      btn.addEventListener('click', function () {
        safeRunAll();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.IGDC_DIAG_BRIDGE_READY = true;
})();
