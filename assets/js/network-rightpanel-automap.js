/* network-rightpanel-automap.js (FINAL + FALLBACK) */

(function () {
  'use strict';

  if (window.__NETWORK_RIGHT_AUTOMAP_FINAL__) return;
  window.__NETWORK_RIGHT_AUTOMAP_FINAL__ = true;

  const FEED_URL =
    '/.netlify/functions/feed-network?section=right-network-100';

  const SLOT_LIMIT = 100;

  async function loadFeed() {
    const res = await fetch(FEED_URL + '&_t=' + Date.now(), {
      cache: 'no-store'
    });

    if (!res.ok) throw new Error('Feed load failed');
    return res.json();
  }

  function clearBox(box) {
    while (box.firstChild) box.removeChild(box.firstChild);
  }

  function pick(it, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = it && it[keys[i]];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function pickImg(it) {
    return pick(it, [
      'thumb','image','thumbnail','imageUrl','img','photo','cover'
    ]);
  }

  function pickTitle(it) {
    return pick(it, ['title','name','text','label']);
  }

  function pickUrl(it) {
    return pick(it, ['url','href','link','path']) || '#';
  }

  /* ✅ 샘플 자동 생성 */
  function makeSamples(limit) {

    const list = [];

    for (let i = 1; i <= limit; i++) {

      const n = String(i).padStart(3, '0');

      list.push({
        id: 'net-sample-' + n,
        title: 'Sample ' + i,
        url: '#',
        thumb: '/assets/sample/network/' + n + '.jpg',
        image: '/assets/sample/network/' + n + '.jpg'
      });

    }

    return list;
  }

  function createBox(item) {

    const box = document.createElement('div');
    box.className = 'ad-box';

    const a = document.createElement('a');
    const href = pickUrl(item);

    a.href = href;

    if (href !== '#') {
      a.target = '_blank';
      a.rel = 'noopener';
    }

    const img = document.createElement('img');

    img.src = pickImg(item) || '';
    img.alt = pickTitle(item) || 'thumb';
    img.loading = 'lazy';

    a.appendChild(img);
    box.appendChild(a);

    return box;
  }

  async function run() {

    try {

      const box =
        document.getElementById('rightAutoPanel') ||
        document.getElementById('nh-mobile-rail-list');

      if (!box) return;

      const data = await loadFeed();

      let items = Array.isArray(data?.items)
        ? data.items
        : [];

      /* ✅ 비었으면 샘플 생성 */
      if (items.length === 0) {

        console.warn('[NETWORK] Empty feed → use samples');

        items = makeSamples(SLOT_LIMIT);
      }

      clearBox(box);

      const max = Math.min(items.length, SLOT_LIMIT);

      for (let i = 0; i < max; i++) {
        box.appendChild(createBox(items[i]));
      }

      console.log('[NETWORK] Rendered:', max);

    } catch (e) {

      console.error('[NETWORK] Error:', e);

    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();