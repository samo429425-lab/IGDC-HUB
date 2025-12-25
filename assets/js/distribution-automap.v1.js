
// distribution-automap.v1.js (FINAL LOCKED)
// Rules:
// 1. Section-based mapping only
// 2. Real cards only once
// 3. Skeleton removed immediately after real cards
// 4. NEVER reflow / clear / reorder

(function () {
  'use strict';

  const SELECTOR = '.thumb-grid[data-psom-key]';

  function hasRealCard(section) {
    return !!section.querySelector('.thumb-card:not(.skeleton)');
  }

  function removeSkeleton(section) {
    section.querySelectorAll('.thumb-card.skeleton').forEach(el => el.remove());
  }

  function createCards(section, items) {
    const frag = document.createDocumentFragment();

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.innerHTML = `
        <img class="thumb-img" src="${item.thumbnail || ''}" alt="">
        <div class="thumb-body">
          <div class="thumb-title">${item.title || ''}</div>
        </div>
      `;
      frag.appendChild(card);
    });

    section.appendChild(frag);
  }

  function mapSection(section) {
    if (hasRealCard(section)) return;

    const key = section.dataset.psomKey;
    if (!key) return;
    if (!window.FeedAPI || typeof window.FeedAPI.get !== 'function') return;

    window.FeedAPI.get({ key })
      .then(res => {
        if (!res || !Array.isArray(res.items) || !res.items.length) return;

        createCards(section, res.items);
        removeSkeleton(section);
      })
      .catch(() => {});
  }

  function init() {
    document.querySelectorAll(SELECTOR).forEach(mapSection);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
