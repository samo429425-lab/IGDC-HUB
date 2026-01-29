/**
 * home-products-automap.v2.RIGHT-CARDS-ONLY.js
 * Right panel card-only renderer (PSOM strict)
 */

(function () {
  'use strict';

  function getSnapshot() {
    return window.__FRONT_SNAPSHOT__ || window.frontSnapshot || null;
  }

  function renderCards(container, items) {
    if (!Array.isArray(items)) return;
    container.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.innerHTML = `
        <a href="${item.url || '#'}">
          <img src="${item.image || ''}" alt="${item.title || ''}">
          <div class="thumb-title">${item.title || ''}</div>
        </a>
      `;
      container.appendChild(card);
    });
  }

  function initRightPanels() {
    const snapshot = getSnapshot();
    if (!snapshot || !snapshot.sections) return;

    document.querySelectorAll('.thumb-grid[data-psom-key]').forEach(container => {
      const key = container.dataset.psomKey;
      const section = snapshot.sections[key];
      if (!section || !Array.isArray(section.items)) return;
      renderCards(container, section.items);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRightPanels);
  } else {
    initRightPanels();
  }
})();