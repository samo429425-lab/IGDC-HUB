// distribution-render-fix.js
// 역할: feed.js가 이미 렌더한 결과를 건드리지 않는다.
// 금지: innerHTML 초기화, 재렌더 루프, setTimeout rerender
// 기능: 레이아웃 안정화용 최소 가드만 수행

(function () {
  try {
    const grids = document.querySelectorAll('.thumb-grid[data-psom-key]');
    if (!grids || grids.length === 0) return;

    grids.forEach(g => {
      g.dataset.rendered = 'true';
    });

    const evt = new CustomEvent('thumbs:ready', { bubbles: true });
    document.dispatchEvent(evt);
  } catch (e) {
    // noop
  }
})();
