
/**
 * home-products-automap.v3.js
 * Safe version: prevents layout collapse when no data
 * - If no items: keep DOM + show placeholder
 * - If items exist: clear and render
 */

(function () {
  'use strict';

  if (window.__HOME_AUTOMAP_V3__) return;
  window.__HOME_AUTOMAP_V3__ = true;

  const FEED_TRIES = [
    '/.netlify/functions/feed?page=homeproducts',
    '/.netlify/functions/feed?category=homeproducts',
    '/.netlify/functions/feed?category=home-shop-1'
  ];

  async function loadFeed() {
    for (const url of FEED_TRIES) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    return { sections: [], rows: [], items: [] };
  }

  function isValid(item) {
    if (!item) return false;
    const thumb = item.thumb || item.photo || item.image;
    if (!thumb) return false;
    if (!item.id) return false;

    const bad = /도박|베팅|카지노|토토|성인|19\+|porn|sex|마약|총기|scam/i;
    const txt = [item.title, item.desc, item.url].join(' ');
    if (bad.test(txt)) return false;

    return true;
  }

  function placeholderHTML(msg) {
    return `
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
  }

  function cardHTML(c) {
    const title = (c.title || '').replace(/"/g, '');
    const img = c.thumb || c.photo || c.image || '';
    const link = c.detailUrl || ('/product.html?id=' + encodeURIComponent(c.id));

    return `
      <a class="product-card" href="${link}" data-product-id="${c.id}" target="_blank" rel="noopener">
        <img loading="lazy" decoding="async" src="${img}" alt="${title}">
        <div class="meta">
          <div class="t">${title}</div>
        </div>
      </a>
    `;
  }

  function mountSection(sectionEl, items, maxItems, message) {
    const grid =
      sectionEl.querySelector('.shopping-hot-item, .hot-today, .shopping-row, .shop-row, .grid, .row-grid')
      || sectionEl;

    const list = (items || []).filter(isValid).slice(0, maxItems);

    if (!list.length) {
      if (!grid.querySelector('.maru-empty')) {
        grid.insertAdjacentHTML('beforeend', placeholderHTML(message));
      }
      return;
    }

    grid.innerHTML = '';

    list.forEach(it => {
      grid.insertAdjacentHTML('beforeend', cardHTML(it));
    });
  }

  function findMainSections() {
    const ids = ['section-1','section-2','section-3','section-4','section-5'];
    const found = ids
      .map(id => document.getElementById(id))
      .filter(Boolean)
      .map((el,i)=>({ el, key:'main-'+(i+1) }));

    if (found.length) return found;

    const fallback = Array.from(document.querySelectorAll(
      '.shopping-section, .shopping-row, .shop-row, .hot-section'
    )).slice(0,5);

    return fallback.map((el,i)=>({ el, key:'main-'+(i+1) }));
  }

  function findRightPanels() {
    const base = document.querySelector('.ad-panel');
    if (!base) return [];
    const subs = Array.from(base.querySelectorAll('.ad-section'));
    return subs.slice(0,3).map((el,i)=>({ el, key:'right-'+(i+1) }));
  }

  async function init() {
    const feed = await loadFeed();

    const sections = [];
    const main = findMainSections();
    const right = findRightPanels();

    main.forEach(x => sections.push(x));
    right.forEach(x => sections.push(x));

    const dataMap = {};

    (feed.sections || feed.rows || []).forEach(s => {
      const k = (s.id || s.sectionId || '').toLowerCase();
      if (k) dataMap[k] = s.items || s.cards || [];
    });

    if ((!feed.sections && !feed.rows) && Array.isArray(feed.items)) {
      dataMap['main-1'] = feed.items;
    }

    sections.forEach((slot, idx) => {
      const key = slot.key.toLowerCase();
      const items =
        dataMap[key] ||
        dataMap['main-' + (idx + 1)] ||
        [];

      mountSection(
        slot.el,
        items,
        idx < 5 ? 100 : 50,
        idx < 5 ? '상품 준비 중입니다.' : '콘텐츠 준비 중입니다.'
      );
    });
  }

  window.addEventListener('load', () => {
    setTimeout(init, 50);
    setTimeout(init, 300);
  });
})();
