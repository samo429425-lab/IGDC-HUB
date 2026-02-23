/* network-rightpanel-automap.FINAL.js */
/* Network Hub Right Panel - Feed Driven / No Dummy / No Auto Generate */

(function () {
  'use strict';

  if (window.__NETWORK_RIGHT_AUTOMAP_FINAL__) return;
  window.__NETWORK_RIGHT_AUTOMAP_FINAL__ = true;

  const FEED_URL = '/.netlify/functions/feed-network?section=network-right';
  const SLOT_LIMIT = 100;

  async function loadFeed() {
    const res = await fetch(FEED_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Feed load failed');
    return res.json();
  }

  function clearBox(box) {
    while (box.firstChild) box.removeChild(box.firstChild);
  }

  function pickImage(item) {
    return item?.thumb || item?.image || item?.thumbnail || item?.imageUrl || '';
  }

  function pickTitle(item) {
    return item?.title || item?.name || item?.text || '';
  }

  function pickMeta(item) {
    return item?.meta || item?.subtitle || item?.summary || '';
  }

  function pickUrl(item) {
    return item?.url || item?.href || item?.link || '#';
  }

  function esc(u) {
    return String(u || '').replace(/'/g, '%27');
  }

  function createCard(item) {

    const card = document.createElement('div');
    card.className = 'thumb-card';

    const img = document.createElement('div');
    img.className = 'thumb-img';

    const src = pickImage(item);
    if (src) {
      img.style.backgroundImage = "url('" + esc(src) + "')";
      img.style.backgroundSize = 'cover';
      img.style.backgroundPosition = 'center';
    }

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = pickTitle(item);

    const meta = document.createElement('div');
    meta.className = 'thumb-meta';
    meta.textContent = pickMeta(item);

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(meta);

    const href = pickUrl(item);
    if (href && href !== '#') {
      card.addEventListener('click', function () {
        location.href = href;
      });
      card.style.cursor = 'pointer';
    }

    return card;
  }

  async function run() {

    try {

      const box = document.querySelector('[data-psom-key="network-right"]');
      if (!box) return;

      const data = await loadFeed();
      const items = Array.isArray(data?.items) ? data.items : [];

      // If feed empty → keep existing HTML
      if (items.length === 0) {
        console.log('[NETWORK-AUTOMAP] Empty feed. Keep HTML.');
        return;
      }

      // Replace only when data exists
      clearBox(box);

      items.slice(0, SLOT_LIMIT).forEach(item => {
        box.appendChild(createCard(item));
      });

      console.log('[NETWORK-AUTOMAP] Rendered', items.length, 'items');

    } catch (e) {
      console.error('[NETWORK-AUTOMAP] Error:', e);
    }

  }

  run();

})();
