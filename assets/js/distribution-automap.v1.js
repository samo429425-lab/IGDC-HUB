/**
 * distribution-products-automap.FINAL.v2.js
 * -------------------------------------------------
 * SNAPSHOT-ONLY Auto Mapping Engine (FINAL v2)
 *
 * Principles:
 * - Data source: /data/front.snapshot.json
 * - Section 1:1 mapping via data-psom-key
 * - Render ONLY into real card containers (.thumb-list or .card-list)
 * - Dummy cards are hidden on success, restored on failure
 * - No feed.js, no list fallback, no append mixing
 * - Future-ready: realtime = snapshot update only
 */

(function () {
  'use strict';

  const SNAPSHOT_URL = '/data/front.snapshot.json';
  const CARD_LIST_SELECTORS = ['.thumb-list', '.card-list'];

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function findListEl(wrapper) {
    if (!wrapper) return null;
    // If wrapper itself is the list (many pages put data-psom-key directly on .thumb-list)
    for (const sel of CARD_LIST_SELECTORS) {
      if (wrapper.matches && wrapper.matches(sel)) return wrapper;
    }
    for (const sel of CARD_LIST_SELECTORS) {
      const el = wrapper.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function hide(el) {
    if (el) el.style.display = 'none';
  }

  function show(el) {
    if (el) el.style.display = '';
  }

  function clear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function createCard(item) {
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = item.url || item.href || item.detailUrl || '#';
    a.target = item.target || '_self';

    const img = document.createElement('img');
    img.src = item.image || item.thumb || item.thumbnail || item.photo || item.img || '';
    img.alt = item.title || '';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = item.title || '';

    a.appendChild(img);
    a.appendChild(title);
    return a;
  }

  function renderSection(wrapper, items) {
    if (!wrapper) return;

    const listEl = findListEl(wrapper);
    if (!listEl) return;

    const dummyNodes = Array.from(listEl.children);

    if (Array.isArray(items) && items.length > 0) {
      dummyNodes.forEach(hide);
      clear(listEl);
      items.forEach(item => listEl.appendChild(createCard(item)));
    } else {
      clear(listEl);
      dummyNodes.forEach(node => {
        show(node);
        listEl.appendChild(node);
      });
    }
  }

  function renderDistribution(snapshot) {
    if (!snapshot || !snapshot.pages || !snapshot.pages.distribution) return;

    const dist = snapshot.pages.distribution;

    (function(){
      const secs = dist.sections;
      // Support both formats:
      //  A) array: [{ key, items }]
      //  B) object: { "psom-key": [items...] }
      if (Array.isArray(secs)) {
        secs.forEach(sec => {
          const wrapper = qs(`[data-psom-key="${sec.key}"]`);
          renderSection(wrapper, sec.items || []);
        });
      } else if (secs && typeof secs === 'object') {
        Object.entries(secs).forEach(([key, items]) => {
          const wrapper = qs(`[data-psom-key="${key}"]`);
          renderSection(wrapper, Array.isArray(items) ? items : []);
        });
      }
    })();

    if (dist.rightPanel && Array.isArray(dist.rightPanel.items)) {
      const rightWrapper = qs('[data-psom-key="distribution-right"]');
      renderSection(rightWrapper, dist.rightPanel.items);
    }
  }

  function boot() {
    fetch(SNAPSHOT_URL, { cache: 'no-store' })
      .then(r => r.json())
      .then(renderDistribution)
      .catch(() => {
        // network failure: keep dummy visible
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();