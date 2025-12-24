/**
 * mh-automap.v1.js
 * MediaHub auto-mapping bridge (production-safe)
 * Dependency: thumbnail-loader.compat.min.js
 */

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function run() {
    var grids = document.querySelectorAll('.thumb-grid[data-psom-key]');
    if (!grids || !grids.length) return;

    grids.forEach(function (grid) {
      var key = grid.getAttribute('data-psom-key');
      if (!key) return;

      // prevent duplicate load
      if (grid.dataset.mhLoaded === 'true') return;
      grid.dataset.mhLoaded = 'true';

      // delegate to existing loader
      if (typeof window.loadThumbnails === 'function') {
        window.loadThumbnails(grid, key);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();