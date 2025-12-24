// distribution-render-fix.js
// 목적: distribution 페이지에서 썸네일 통파일 렌더링 현상 방지
// 방식: 렌더링 완료 전 숨김 → load 이후 표시 (HTML/CSS 수정 없음)

(function () {
  try {
    // distribution 페이지 전체에서 thumb-grid만 대상
    const grids = document.querySelectorAll('.thumb-grid');
    if (!grids || grids.length === 0) return;

    // 최초 숨김
    grids.forEach(g => {
      g.style.visibility = 'hidden';
    });

    // 모든 리소스 로드 후 한 프레임 뒤 표시
    window.addEventListener('load', () => {
      requestAnimationFrame(() => {
        grids.forEach(g => {
          g.style.visibility = 'visible';
        });
      });
    });
  } catch (e) {
    // fail-safe: 오류 나도 화면은 복구
    const grids = document.querySelectorAll('.thumb-grid');
    grids.forEach(g => {
      g.style.visibility = 'visible';
    });
  }
})();