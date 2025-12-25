
// distribution-render-fix.js (FIXED)
// YES: Keep file
// YES: Modify behavior
// NO: Do not re-render or clear DOM

(function () {
  const CONTAINER_SELECTOR = '.thumb-grid';

  function hasCards() {
    const container = document.querySelector(CONTAINER_SELECTOR);
    return !!(container && container.children.length > 0);
  }

  function applyFix() {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    // layout-only fix (no DOM mutation)
    container.style.willChange = 'transform';
  }

  // Initial load: do nothing if cards already exist
  document.addEventListener('DOMContentLoaded', () => {
    if (hasCards()) return;
  });

  // Only respond to actual layout changes
  window.addEventListener('resize', () => {
    if (!hasCards()) return;
    applyFix();
  });

  window.addEventListener('orientationchange', () => {
    if (!hasCards()) return;
    applyFix();
  });
})();
