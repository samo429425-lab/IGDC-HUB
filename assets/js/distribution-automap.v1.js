(function () {
  'use strict';

  // ===== Rendering Policy (STABLE) =====
  const RENDER_POLICY = { initial: 6, batch: 8 };

  function isAllowed(x) {
    if (!x) return false;
    const ban = [/도박|베팅|카지노|토토/i, /성인|19\+|porn|sex/i, /범죄|마약|총기/i, /스캠|피싱|사기|scam/i];
    const t = [x.title, x.brand, x.desc, x.url].filter(Boolean).join(' ');
    if (ban.some(rx => rx.test(t))) return false;
    return !!(x.id && (x.thumb || x.photo) && (x.detailUrl || x.url));
  }

  const DETAIL = x => x.detailUrl || ('/product.html?id=' + encodeURIComponent(x.id));

  function cardHTML(x) {
    const title = (x.title || '').replace(/"/g, '');
    const price = x.price ? `<div class="thumb-price">${x.price}</div>` : '';
    return `<a class="thumb-card product-card" href="${DETAIL(x)}" data-product-id="${x.id}" data-title="${title}" rel="noopener">
      <img class="thumb-img" loading="lazy" decoding="async" src="${x.thumb || x.photo}" alt="${title}">
      <div class="thumb-body">
        <div class="thumb-title">${title}</div>
        <div class="thumb-meta">${price}<span class="thumb-tag">${x.tag || ''}</span></div>
      </div>
    </a>`;
  }

  async function loadFeed() {
    const urls = [
      '/assets/data/distribution_feed.json',
      '/.netlify/functions/feed?page=distributionhub',
      '/assets/hero/psom.json'
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: 'no-cache' });
        if (r.ok) return await r.json();
      } catch (_) {}
    }
    return { sections: [] };
  }

  function mountGrid(container, items) {
    const list = (items || []).filter(isAllowed).slice(0, 100);
    const grid =
      container.querySelector('.thumb-list,.thumb-scroller,.thumb-row,.cards-row') || container;

    // STABLE: never clear innerHTML (prevents desktop flicker)
    if (grid.dataset.mounted === '1') return;
    grid.dataset.mounted = '1';

    const B0 = RENDER_POLICY.initial;
    const B = RENDER_POLICY.batch;
    let i = 0;
    const push = it => grid.insertAdjacentHTML('beforeend', cardHTML(it));

    for (; i < Math.min(B0, list.length); i++) push(list[i]);

    if ('IntersectionObserver' in window && grid.lastElementChild) {
      const io = new IntersectionObserver(
        ents => {
          ents.forEach(ent => {
            if (!ent.isIntersecting) return;
            io.unobserve(ent.target);
            const s = i;
            const e = Math.min(i + B, list.length);
            for (let k = s; k < e; k++) push(list[k]);
            i = e;
            if (i < list.length) io.observe(grid.lastElementChild);
          });
        },
        { rootMargin: '800px 0px' }
      );
      io.observe(grid.lastElementChild);
    }
  }

  async function init() {
    const data = await loadFeed();
    const sections = data.sections || [];
    sections.forEach(sec => {
      const el = document.querySelector(`[data-psom-key="${sec.key}"]`);
      if (!el) return;
      mountGrid(el, sec.items || []);
    });
    document.dispatchEvent(new CustomEvent('thumbs:ready', { bubbles: true }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();