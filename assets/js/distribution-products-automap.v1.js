// distribution-products-automap.final.js
// PURPOSE:
// - Distribution hub auto-mapping (snapshot-first)
// - Remove dummy cards before render
// - Separate main sections vs right panel
// - NO global scan / NO fallback explosion

(function () {
  'use strict';

  const SNAPSHOT_URL = '/assets/data/front.snapshot.json';

  function qsAll(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function clearContainer(container) {
    if (!container) return;
    qsAll('.dummy, .placeholder', container).forEach(el => el.remove());
    container.innerHTML = '';
  }

  function renderCards(container, items) {
    if (!container || !items || !items.length) return;

    clearContainer(container);

    items.forEach(item => {
      const card = document.createElement('a');
      card.className = 'dist-card';
      card.href = item.url || '#';
      card.innerHTML = `
        <div class="thumb">
          <img src="${item.thumb || 'data:image/gif;base64,R0lGODlhAQABAAAAACw='}" alt="">
        </div>
        <div class="title">${item.title || ''}</div>
      `;
      container.appendChild(card);
    });
  }

  async function boot() {
    let snapshot;

    try {
      const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
      snapshot = await res.json();
    } catch (e) {
      console.warn('[distribution automap] snapshot load failed');
      return;
    }

    const sections = snapshot?.pages?.distribution?.sections;
    if (!sections) return;

    Object.keys(sections).forEach(key => {
      if (key === 'dist_right') return;

      const container = document.querySelector(`[data-psom-key="${key}"]`);
      if (!container) return;

      renderCards(container, sections[key]);
    });

    if (sections.dist_right) {
      const rightContainer = document.querySelector('[data-psom-key="dist_right"]');
      renderCards(rightContainer, sections.dist_right);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
