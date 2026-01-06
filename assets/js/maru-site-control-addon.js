
/**
 * maru-site-control-addon.js (UPGRADED FINAL v1.1)
 *
 * 목적:
 * - igdc-site-control.js를 전혀 수정하지 않고 MARU 기능 확장
 * - 실제 DOM 구조( btnMaruGlobalInsight ) 1:1 맵핑
 * - 버튼 간섭/중복/미표시 문제 근본 차단
 *
 * 특징:
 * - DOMContentLoaded + MutationObserver 이중 안전장치
 * - idempotent(중복 실행 방지)
 * - 전역 간섭 없음
 */

(function () {
  'use strict';

  if (window.__MARU_SITE_ADDON_LOADED__) return;
  window.__MARU_SITE_ADDON_LOADED__ = true;

  function bindWhenReady() {
    const maruBtn = document.getElementById('btnMaruGlobalInsight');
    if (!maruBtn) return false;

    // 이미 바인딩되었으면 중단
    if (maruBtn.dataset.maruBound === '1') return true;
    maruBtn.dataset.maruBound = '1';

    /* ===============================
     * 1. "실시간 이슈" 버튼 생성 (MARU 전용)
     * =============================== */
    let issueBtn = document.getElementById('btnMaruRealtimeIssue');
    if (!issueBtn) {
      issueBtn = document.createElement('button');
      issueBtn.id = 'btnMaruRealtimeIssue';
      issueBtn.className = maruBtn.className;
      issueBtn.textContent = '실시간 이슈';
      maruBtn.parentNode.insertBefore(issueBtn, maruBtn);
    }

    /* ===============================
     * 2. MARU 버튼 이벤트 연결
     * =============================== */
    function openRegion() {
      if (typeof window.openMaruGlobalRegionModal === 'function') {
        window.openMaruGlobalRegionModal();
      } else {
        console.error('[MARU ADDON] openMaruGlobalRegionModal not found');
        alert('MARU 글로벌 인사이트 모듈이 아직 준비되지 않았습니다.');
      }
    }

    maruBtn.addEventListener('click', openRegion);
    issueBtn.addEventListener('click', openRegion);

    /* ===============================
     * 3. 상단 AI 자동진단 버튼 텍스트 교정
     * =============================== */
    const buttons = document.querySelectorAll('button');
    buttons.forEach(function (b) {
      if (b.textContent && b.textContent.trim() === 'AI 자동 진단 실행') {
        b.textContent = '사이트 상황';
      }
    });

    console.info('[MARU ADDON] bound successfully');
    return true;
  }

  // 1차 시도
  if (!bindWhenReady()) {
    // DOM 동적 생성 대비
    const observer = new MutationObserver(function () {
      if (bindWhenReady()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

})();
