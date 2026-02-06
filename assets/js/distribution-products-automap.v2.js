/**
 * distribution-products-automap.direct.js (DIRECT KEY MAPPING)
 * -------------------------------------------------
 * FINAL DIRECT VERSION
 * - No extract functions
 * - No normalization
 * - No reuse
 * - Direct: key -> snapshot.sections[key]
 * - All sections = 30
 */

(function () {
  'use strict';

  const SNAPSHOT_URL = '/data/distribution.snapshot.json';
  const LIMIT = 30;

  function qsAll(sel) {
    return Array.from(document.querySelectorAll(sel));
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function safe(v) {
    return String(v || '').replace(/[<>]/g, '');
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && typeof obj[k] === 'string' && obj[k].trim()) {
        return obj[k].trim();
      }
    }
    return '';
  }

  function normalize(item) {
    if (!item || typeof item !== 'object') return null;

    return {
      title: pick(item, ['title', 'name', 'label', 'text']) || 'Untitled',
      url: pick(item, ['url', 'link', 'href']) || '#',
      thumb: pick(item, ['image', 'thumb', 'thumbnail', 'img', 'cover', 'poster'])
    };
  }

  function makeCard(n) {
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = n.url;
    a.target = '_blank';
    a.rel = 'noopener';

    if (n.thumb) {
      const img = document.createElement('img');
      img.className = 'thumb-img';
      img.src = n.thumb;
      img.alt = safe(n.title);
      a.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'thumb-img';
      a.appendChild(ph);
    }

    const t = document.createElement('div');
    t.className = 'thumb-title';
    t.textContent = safe(n.title);

    a.appendChild(t);

    return a;
  }

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Snapshot load failed');
    return await res.json();
  }

  async function init() {

    const targets = qsAll('[data-psom-key]');

    if (!targets.length) return;

    const snapshot = await loadSnapshot();

    if (
      !snapshot ||
      !snapshot.pages ||
      !snapshot.pages.distribution ||
      !snapshot.pages.distribution.sections
    ) {
      console.error('[AUTOMAP] Invalid snapshot structure');
      return;
    }

    const sections = snapshot.pages.distribution.sections;

    // === DIRECT MAPPING ONLY ===
    for (const wrap of targets) {

      const key = wrap.getAttribute('data-psom-key');

      if (!key) continue;

      const list =
        wrap.classList.contains('thumb-list')
          ? wrap
          : wrap.querySelector('.thumb-list, .card-list');

      if (!list) continue;

      const items = sections[key]; // <-- DIRECT LOOKUP

      if (!Array.isArray(items) || !items.length) continue;

      const norm = items
        .map(normalize)
        .filter(Boolean)
        .slice(0, LIMIT);

      if (!norm.length) continue;

      clear(list);

      for (const n of norm) {
        list.appendChild(makeCard(n));
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
