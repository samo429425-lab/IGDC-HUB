// distribution-render-fix-desktop-v2.js
// 데스크탑 전용 강제 안정화:
// 1) thumb-grid 숨김
// 2) 이미지 로드 완료 대기
// 3) 강제 reflow 후 표시

(function () {
  try {
    // 모바일 제외
    if (window.matchMedia('(max-width: 768px)').matches) return;

    const grids = document.querySelectorAll('.thumb-grid');
    if (!grids.length) return;

    grids.forEach(g => {
      g.style.visibility = 'hidden';
    });

    function imagesLoaded(container) {
      const imgs = Array.from(container.querySelectorAll('img'));
      if (imgs.length === 0) return Promise.resolve();
      return Promise.all(imgs.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(res => {
          img.addEventListener('load', res, { once: true });
          img.addEventListener('error', res, { once: true });
        });
      }));
    }

    window.addEventListener('load', async () => {
      for (const g of grids) {
        await imagesLoaded(g);
        // 강제 reflow
        void g.offsetHeight;
        g.style.visibility = 'visible';
      }
    });
  } catch (e) {
    const grids = document.querySelectorAll('.thumb-grid');
    grids.forEach(g => {
      g.style.visibility = 'visible';
    });
  }
})();