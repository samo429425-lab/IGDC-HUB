/**
 * distribution-products-automap.v2.clean.js
 * CLEAN / STABLE / SNAPSHOT-FIRST
 *
 * DESIGN PRINCIPLES
 * 1) Snapshot is the single source of truth
 * 2) Iterate sections dynamically (no hard-coded keys)
 * 3) data-psom-key in HTML must match snapshot section key
 * 4) No feed / no thumbnail-loader dependency here
 *
 * EXPECTED SNAPSHOT PATH
 * front.snapshot.json
 *   pages.distribution.sections.{sectionKey} = [items]
 */

(function () {
  'use strict';

  if (window.__DIST_AUTOMAP_V2_CLEAN__) return;
  window.__DIST_AUTOMAP_V2_CLEAN__ = true;

  const SNAPSHOT_URL = '/data/front.snapshot.json';

  function norm(item) {
    return {
      title: item.title || '',
      thumb: item.thumb || '',
      url: item.url || '#',
      priority: item.priority || 0
    };
  }

  function render(sectionKey, items) {
    const el = document.querySelector('[data-psom-key="' + sectionKey + '"]');
    if (!el || !items || !items.length) return false;

    el.innerHTML = '';
    items.forEach(it => {
      const a = document.createElement('a');
      a.className = 'card product-card';
      a.href = it.url || '#';

      const img = document.createElement('img');
      img.src = it.thumb;
      img.alt = it.title;

      const title = document.createElement('div');
      title.className = 'meta';
      title.textContent = it.title;

      a.appendChild(img);
      a.appendChild(title);
      el.appendChild(a);
    });
    return true;
  }

  async function run() {
    let snap;
    try {
      const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
      if (!res.ok) return;
      snap = await res.json();
    } catch (e) {
      return;
    }

    const sections =
      snap &&
      snap.pages &&
      snap.pages.distribution &&
      snap.pages.distribution.sections;

    if (!sections) return;

    Object.entries(sections).forEach(([key, list]) => {
      const items = (list || []).map(norm);
      render(key, items);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();