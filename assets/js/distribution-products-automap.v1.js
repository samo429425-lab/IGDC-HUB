/**
 * distribution-products-automap.FINAL.js
 * -------------------------------------------------
 * SNAPSHOT-ONLY Auto Mapping Engine (FINAL)
 *
 * - Data source: /data/front.snapshot.json
 * - No feed.js dependency
 * - No list fallback
 * - No append behavior
 * - Strict 1:1 mapping between HTML sections and snapshot keys
 * - Safe for future realtime feed integration (snapshot update only)
 */

(function () {
  'use strict';

  const SNAPSHOT_URL = '/data/front.snapshot.json';

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function clear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function createCard(item) {
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = item.url || '#';

    const img = document.createElement('img');
    img.src = item.image || '';
    img.alt = item.title || '';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = item.title || '';

    a.appendChild(img);
    a.appendChild(title);
    return a;
  }

  function renderSection(sectionEl, items) {
    if (!sectionEl || !Array.isArray(items) || items.length === 0) return;
    clear(sectionEl);
    items.forEach(item => {
      sectionEl.appendChild(createCard(item));
    });
  }

  function renderDistribution(snapshot) {
    if (!snapshot || !snapshot.pages || !snapshot.pages.distribution) return;
    const dist = snapshot.pages.distribution;

    (dist.sections || []).forEach(sec => {
      const sectionEl = qs(`[data-psom-key="${sec.key}"]`);
      renderSection(sectionEl, sec.items || []);
    });

    if (dist.rightPanel && Array.isArray(dist.rightPanel.items)) {
      const rightEl = qs('[data-psom-key="distribution-right"]');
      renderSection(rightEl, dist.rightPanel.items);
    }
  }

  function boot() {
    fetch(SNAPSHOT_URL, { cache: 'no-store' })
      .then(r => r.json())
      .then(renderDistribution)
      .catch(err => console.warn('[distribution automap] snapshot error:', err));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();