
/*! donation-fix.v1.7.placeholder.js
 * - NEVER deletes cards
 * - If no real content → injects "콘텐츠 준비 중입니다"
 * - Auto-replaced when real cards appear
 * - Safe for home / donation / media
 */

(function () {
  'use strict';

  if (window.__DON_FIX_V17__) return;
  window.__DON_FIX_V17__ = true;

  const PLACEHOLDER_HTML = (msg) => `
    <div class="maru-empty" style="
      padding:18px;
      border-radius:12px;
      background:#f7f7f7;
      text-align:center;
      color:#666;
      font-size:14px;
      line-height:1.6;
    ">
      <div style="font-size:20px;margin-bottom:8px;">📦</div>
      <div>${msg || '콘텐츠 준비 중입니다.'}</div>
    </div>
  `;

  function hasRealCard(container) {
    if (!container) return false;
    return !!container.querySelector(
      'a.product-card, .thumb-card, .card, img[src]:not([src^="data:"])'
    );
  }

  function ensurePlaceholder(container, message) {
    if (!container) return;
    if (hasRealCard(container)) {
      const ph = container.querySelector('.maru-empty');
      if (ph) ph.remove();
      return;
    }
    if (!container.querySelector('.maru-empty')) {
      container.insertAdjacentHTML('beforeend', PLACEHOLDER_HTML(message));
    }
  }

  function scan() {
    const targets = document.querySelectorAll(
      '.thumb-grid, .row-grid, .cards-row, .shopping-row, .shop-row, .hot-section, .media-grid'
    );

    targets.forEach(el => {
      const label =
        el.closest('[data-section]')?.getAttribute('data-section') ||
        el.id || '';

      let msg = '콘텐츠 준비 중입니다.';
      if (/donat|기부/i.test(label)) msg = '후원 콘텐츠 준비 중입니다.';
      if (/media/i.test(label)) msg = '미디어 콘텐츠 준비 중입니다.';

      ensurePlaceholder(el, msg);
    });
  }

  function observe() {
    const obs = new MutationObserver(() => {
      clearTimeout(window.__donFixTimer);
      window.__donFixTimer = setTimeout(scan, 120);
    });

    obs.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    scan();
    observe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
