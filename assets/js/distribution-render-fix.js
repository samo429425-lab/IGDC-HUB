
// distribution-render-fix.js (FINAL HARDENED)
// Purpose:
// - NEVER trigger reflow that collapses cards into blocks
// - NO DOM mutation, NO class toggle, NO style reset
// - ONLY passive layout stabilization after paint

(function () {
  'use strict';

  const GRID_SELECTOR = '.thumb-grid';

  function hasCards(grid) {
    return !!grid && grid.querySelector('.thumb-card');
  }

  function stabilize(grid) {
    // read-only operations to force layout settle
    grid.offsetHeight; // force layout flush (read-only)
  }

  function run() {
    document.querySelectorAll(GRID_SELECTOR).forEach(grid => {
      if (!hasCards(grid)) return;
      stabilize(grid);
    });
  }

  // Run AFTER everything else
  window.addEventListener('load', () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  });

  // Optional: re-stabilize on resize (no DOM touch)
  window.addEventListener('resize', () => {
    requestAnimationFrame(run);
  });
})();
