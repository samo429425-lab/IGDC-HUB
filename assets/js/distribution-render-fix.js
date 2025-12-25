
// distribution-render-fix.js (SAFE / OPT-IN ONLY)
// Default: DOES NOTHING
// Enable only if window.__ENABLE_RENDER_FIX__ === true

(function () {
  if (!window.__ENABLE_RENDER_FIX__) return;

  const GRIDS = document.querySelectorAll('.thumb-grid');
  if (!GRIDS.length) return;

  // layout read-only stabilization
  requestAnimationFrame(() => {
    GRIDS.forEach(g => {
      if (g.querySelector('.thumb-card')) {
        void g.offsetHeight;
      }
    });
  });
})();
