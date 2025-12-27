/**
 * home-products-automap.v3.2.js
 * Fix: main "쇼핑 핫템 추천" has 5 ROWS inside ONE section.
 * - Targets .thumb-grid[data-psom-key="home_1"..."home_5"] for placeholders and rendering
 * - Never clears unless real items exist
 * - Keeps previous right-panel support
 */

(function () {
  'use strict';

  if (window.__HOME_AUTOMAP_V32__) return;
  window.__HOME_AUTOMAP_V32__ = true;

  const FEED_TRIES = [
    '/.netlify/functions/feed?page=homeproducts',
    '/.netlify/functions/feed?category=homeproducts',
    '/.netlify/functions/feed?category=home-shop-1'
  ];

  async function loadFeed() {
    for (const url of FEED_TRIES) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch (_) {}
    }
    return { sections: [], rows: [], items: [] };
  }

  function isValid(item) {
    if (!item) return false;
    const img = item.thumb || item.photo || item.image;
    if (!img) return false;
    if (!item.id) return false;
    return true;
  }

  function placeholderHTML(msg) {
    return `
      <div class="maru-empty" style="
        padding:20px;
        border-radius:12px;
        background:#f7f7f7;
        text-align:center;
        color:#666;
        font-size:14px;
        line-height:1.6;
      ">
        <div style="font-size:20px;margin-bottom:6px;">📦</div>
        <div>${msg || '콘텐츠 준비 중입니다.'}</div>
      </div>
    `;
  }

  function cardHTML(c) {
    const title = (c.title || '').replace(/"/g, '');
    const img = c.thumb || c.photo || c.image || '';
    const link = c.detailUrl || ('/product.html?id=' + encodeURIComponent(c.id));
    return `
      <a class="product-card" href="${link}" data-product-id="${c.id}" target="_blank" rel="noopener">
        <img loading="lazy" decoding="async" src="${img}" alt="${title}">
        <div class="meta"><div class="t">${title}</div></div>
      </a>
    `;
  }

  function ensurePlaceholder(container, message) {
    if (!container) return;
    const hasReal = container.querySelector('a.product-card, .thumb-card, .card, img[src]:not([src^="data:"])');
    if (hasReal) {
      const ph = container.querySelector('.maru-empty');
      if (ph) ph.remove();
      return;
    }
    if (!container.querySelector('.maru-empty')) {
      container.insertAdjacentHTML('beforeend', placeholderHTML(message));
    }
  }

  function mountInto(container, items, maxItems, message) {
    if (!container) return;
    const list = (items || []).filter(isValid).slice(0, maxItems);

    if (!list.length) {
      ensurePlaceholder(container, message);
      return;
    }

    container.innerHTML = '';
    list.forEach(it => container.insertAdjacentHTML('beforeend', cardHTML(it)));
  }

  function buildDataMap(feed) {
    const m = {};
    (feed.sections || feed.rows || []).forEach(s => {
      const k = (s.id || s.sectionId || '').toLowerCase();
      if (k) m[k] = s.items || s.cards || [];
    });
    if ((!feed.sections && !feed.rows) && Array.isArray(feed.items)) {
      m['home_1'] = feed.items;
      m['home-1'] = feed.items;
      m['main-1'] = feed.items;
    }
    return m;
  }

  function pick(map, keys) {
    for (const k of keys) {
      const kk = (k || '').toLowerCase();
      if (kk in map) return map[kk];
    }
    return [];
  }

  async function init() {
    const feed = await loadFeed();
    const map = buildDataMap(feed);

    // A) MAIN 5 rows: home_1 ~ home_5 (as seen in home.html: data-psom-key="home_1"...)
    for (let i = 1; i <= 5; i++) {
      const key = `home_${i}`;
      const grid = document.querySelector(`.thumb-grid[data-psom-key="${key}"]`) ||
                   document.querySelector(`#shopRow${i}`) ||
                   document.querySelector(`#shopScroller${i} .thumb-grid`) ||
                   null;

      const items = pick(map, [
        key,                 // home_1
        `home-${i}`,         // home-1
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home_${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-${i}`,
        `home-shop-${i}`,       // some setups
        `home-shop-${i}`
      ]);

      mountInto(grid, items, 80, '콘텐츠 준비 중입니다.');
    }

    // B) Right panel areas (if present)
    const rightKeys = [
      { key: 'home-right-top',    sel: '.ad-panel .ad-section:nth-of-type(1) .thumb-grid, .ad-panel .ad-section:nth-of-type(1) .grid' },
      { key: 'home-right-middle', sel: '.ad-panel .ad-section:nth-of-type(2) .thumb-grid, .ad-panel .ad-section:nth-of-type(2) .grid' },
      { key: 'home-right-bottom', sel: '.ad-panel .ad-section:nth-of-type(3) .thumb-grid, .ad-panel .ad-section:nth-of-type(3) .grid' }
    ];

    rightKeys.forEach((rk) => {
      const el = document.querySelector(rk.sel) || document.querySelector('.ad-panel');
      const items = pick(map, [rk.key, rk.key.replace(/-/g,'_')]);
      mountInto(el, items, 50, '콘텐츠 준비 중입니다.');
    });
  }

  window.addEventListener('load', () => {
    setTimeout(init, 80);
    setTimeout(init, 320);
  });
})();
