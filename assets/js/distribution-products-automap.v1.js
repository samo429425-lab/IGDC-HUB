/**
 * distribution-products-automap.v2.js
 * SNAPSHOT-FIRST AUTOMAP (HOME-COMPATIBLE)
 *
 * Behavior:
 * 1) Render from front.snapshot.json (Distribution sections)
 * 2) When real feed data arrives, overwrite snapshot content
 * 3) Preserve existing DOM / CSS (do NOT rebuild card skeleton)
 *
 * Differences vs Home:
 * - MAIN sections: 6
 * - RIGHT panel: single section
 */

(function () {
  'use strict';
  if (window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V2__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V2__ = true;

  const SNAPSHOT_URL = '/data/front.snapshot.json';
  const FEED_URL = '/.netlify/functions/feed?page=distribution';

  const MAIN_KEYS = [
    'distribution-recommend',
    'distribution-sponsor',
    'distribution-trending',
    'distribution-new',
    'distribution-special',
    'distribution-others'
  ];
  const RIGHT_KEY = 'distribution-right';

  const MAIN_LIMIT = 100;
  const RIGHT_LIMIT = 80;

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  async function fetchJSON(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      if (!r.ok) return null;
      return await r.json();
    }catch(e){ return null; }
  }

  function norm(it){
    it = it || {};
    return {
      title: it.title || it.name || it.label || '',
      thumb: it.thumb || it.image || it.image_url || '',
      url: it.url || it.link || '#'
    };
  }

  function fillCards(container, items, limit){
    if (!container || !items || !items.length) return false;
    const cards = qsa('.thumb-card', container);
    let applied = 0;

    for (let i=0; i<cards.length && applied<limit; i++){
      const item = items[i];
      if (!item) break;
      const it = norm(item);
      const card = cards[i];

      const link = qs('a', card) || card;
      const img = qs('img', card);
      const title = qs('.thumb-title, .card-title, .title', card);

      if (link) link.href = it.url || '#';
      if (img && it.thumb) img.src = it.thumb;
      if (title && it.title) title.textContent = it.title;

      card.style.display = '';
      applied++;
    }
    return applied > 0;
  }

  async function applySnapshot(){
    const snap = await fetchJSON(SNAPSHOT_URL);
    if (!snap || !snap.pages || !snap.pages.distribution) return;

    const sections = snap.pages.distribution.sections || {};

    MAIN_KEYS.forEach(key => {
      const el = qs('[data-psom-key="'+key+'"]');
      if (!el) return;
      const items = sections[key] || [];
      fillCards(el, items, MAIN_LIMIT);
    });

    const rightEl = qs('[data-psom-key="'+RIGHT_KEY+'"]');
    if (rightEl){
      fillCards(rightEl, sections[RIGHT_KEY] || [], RIGHT_LIMIT);
    }
  }

  async function applyFeed(){
    const feed = await fetchJSON(FEED_URL);
    if (!feed || !Array.isArray(feed.sections)) return;

    const map = {};
    feed.sections.forEach(s => {
      if (s && s.id && Array.isArray(s.items)) map[s.id] = s.items;
    });

    MAIN_KEYS.forEach(key => {
      const el = qs('[data-psom-key="'+key+'"]');
      if (!el) return;
      const items = map[key] || map[key.replace(/-/g,'_')] || [];
      if (items.length) fillCards(el, items, MAIN_LIMIT);
    });

    const rightEl = qs('[data-psom-key="'+RIGHT_KEY+'"]');
    if (rightEl){
      const items = map[RIGHT_KEY] || map['distribution'] || map['dist_right'] || [];
      if (items.length) fillCards(rightEl, items, RIGHT_LIMIT);
    }
  }

  async function boot(){
    await applySnapshot();
    await applyFeed();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
