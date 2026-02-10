// distribution-products-automap.v2.js (LOCKED MAPPING - PRODUCTION, SLOT-FIRST)
// - 1:1 section mapping ONLY (no auto merge)
// - Reads snapshot from /data/distribution.snapshot.json
// - Supports BOTH snapshot shapes:
//     A) { sections: { ... } }
//     B) { pages: { distribution: { sections: { ... }}}}
// - SLOT-FIRST rendering (HOME style):
//     * Always renders fixed slots (main: 100, right: 80)
//     * If snapshot has fewer items, fills remaining slots with safe placeholders
//
// NOTE: Card DOM structure matches distributionhub.html's thumb-autofill-js
//       (.thumb-card > .thumb-img + .thumb-title + .thumb-meta)

(function () {
  'use strict';
  if (window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V2__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V2__ = true;

  const SNAPSHOT_URL = '/data/distribution.snapshot.json';

  const LIMIT_MAIN = 100;
  const LIMIT_RIGHT = 80;

  // 6 MAIN + 1 RIGHT  (PSOM/HTML aligned)
  const SECTION_MAP = [
    { key: 'distribution-recommend', selector: '[data-psom-key="distribution-recommend"]', limit: LIMIT_MAIN },
    { key: 'distribution-new',       selector: '[data-psom-key="distribution-new"]',       limit: LIMIT_MAIN },
    { key: 'distribution-trending',  selector: '[data-psom-key="distribution-trending"]',  limit: LIMIT_MAIN },
    { key: 'distribution-special',   selector: '[data-psom-key="distribution-special"]',   limit: LIMIT_MAIN },
    { key: 'distribution-sponsor',   selector: '[data-psom-key="distribution-sponsor"]',   limit: LIMIT_MAIN },
    { key: 'distribution-others',    selector: '[data-psom-key="distribution-others"]',    limit: LIMIT_MAIN },
    { key: 'distribution-right',     selector: '[data-psom-key="distribution-right"]',     limit: LIMIT_RIGHT }
  ];

  // 1x1 transparent gif (safe placeholder, no asset dependency)
  const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function escUrl(u) {
    try { return String(u || '').replace(/'/g, '%27'); } catch { return ''; }
  }

  function pickImage(item) {
    return (item && (item.thumb || item.image || item.thumbnail || item.imageUrl || item.thumbnailUrl || '')) || '';
  }

  function pickTitle(item) {
    return (item && (item.title || item.name || item.text || '')) || '';
  }

  function pickMeta(item) {
    return (item && (item.meta || item.subtitle || item.summary || '')) || '';
  }

  function pickUrl(item) {
    return (item && (item.url || item.href || item.link || '#')) || '#';
  }

  function makeDummy(cfg, idx) {
    const n = idx + 1;
    return {
      title: (cfg.key || 'distribution') + ' Product ' + n,
      meta: '',
      thumb: PLACEHOLDER_IMG,
      url: '#'
    };
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'thumb-card';

    const img = document.createElement('div');
    img.className = 'thumb-img';
    const src = pickImage(item);
    const useSrc = src || PLACEHOLDER_IMG;

    img.style.backgroundImage = "url('" + escUrl(useSrc) + "')";
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = pickTitle(item) || 'Product';

    const meta = document.createElement('div');
    meta.className = 'thumb-meta';
    meta.textContent = pickMeta(item);

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(meta);

    const href = pickUrl(item);
    if (href && href !== '#') {
      card.addEventListener('click', function(){ location.href = href; });
      card.style.cursor = 'pointer';
    }

    return card;
  }

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Snapshot load failed: ' + res.status);
    return res.json();
  }

  function getSections(snapshot) {
    return (snapshot && (snapshot.pages && snapshot.pages.distribution && snapshot.pages.distribution.sections)) ||
           (snapshot && snapshot.sections) ||
           null;
  }

  function renderSlotFirst(sections) {
    SECTION_MAP.forEach(cfg => {
      const box = document.querySelector(cfg.selector);
      if (!box) return;

      const raw = sections && sections[cfg.key];
      const arr = Array.isArray(raw) ? raw : [];
      const limit = cfg.limit || LIMIT_MAIN;

      const list = arr.slice(0, limit);

      // HOME-style: always fill to fixed slot count
      while (list.length < limit) list.push(makeDummy(cfg, list.length));

      clear(box);
      list.forEach(item => box.appendChild(createCard(item)));
    });
  }

  function renderAllPlaceholders() {
    renderSlotFirst(null);
  }

  (async function run(){
    try {
      const snapshot = await loadSnapshot();
      const sections = getSections(snapshot);

      if (!sections) {
        console.error('[AUTOMAP] Invalid snapshot structure (need snapshot.pages.distribution.sections OR snapshot.sections) — using placeholders');
        renderAllPlaceholders();
        return;
      }

      renderSlotFirst(sections);
      console.log('[AUTOMAP] Slot-first locked mapping loaded');
    } catch (e) {
      console.error('[AUTOMAP] Error (using placeholders):', e);
      renderAllPlaceholders();
    }
  })();
})();
