/* network-rightpanel-automap.js (FINAL STABLE)
 * 기준:
 * - HTML: #rightAutoPanel / #nh-mobile-rail-list
 * - Feed: { items: [...] }
 * - 0개면 기존 HTML 유지 (절대 비우지 않음)
 */

(function () {
  'use strict';

  if (window.__NETWORK_RIGHT_AUTOMAP_OK__) return;
  window.__NETWORK_RIGHT_AUTOMAP_OK__ = true;

  // ✅ 피드 주소 (고정)
  const FEED_URL = '/.netlify/functions/feed-network?limit=100';

  const SLOT_LIMIT = 100;

  // ------------------------------

  function getTarget() {
    return (
      document.getElementById('rightAutoPanel') ||
      document.getElementById('nh-mobile-rail-list')
    );
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
      'image',
      'thumb',
      'thumbnail',
      'imageUrl',
      'img',
      'photo',
      'cover'
    ]);
  }

  function pickTitle(it) {
    return pick(it, ['title', 'name', 'text']);
  }

  function pickUrl(it) {
    return pick(it, ['url', 'href', 'link']) || '#';
  }

  async function loadFeed() {
    const res = await fetch(FEED_URL + '&_t=' + Date.now(), {
      cache: 'no-store'
    });

    if (!res.ok) throw new Error('Feed error: ' + res.status);

    return res.json();
  }

  function clearBox(box) {
    while (box.firstChild) box.removeChild(box.firstChild);
  }

  // ------------------------------

  function createCard(item) {

    const wrap = document.createElement('div');
    wrap.className = 'ad-box';

    const a = document.createElement('a');
    const href = pickUrl(item);

    a.href = href;

    if (href !== '#') {
      a.target = '_blank';
      a.rel = 'noopener';
    }

    const img = document.createElement('img');

    img.src = pickImg(item) || '/assets/sample/placeholder.jpg';
    img.alt = pickTitle(item) || 'thumb';

    img.loading = 'lazy';
    img.decoding = 'async';

    a.appendChild(img);
    wrap.appendChild(a);

    return wrap;
  }

  // ------------------------------

  async function run() {

    try {

      const box = getTarget();

      if (!box) {
        console.error('[NETWORK-AUTOMAP] target not found');
        return;
      }

      const data = await loadFeed();

      let items = Array.isArray(data?.items)
        ? data.items
        : [];

      console.log('[NETWORK-AUTOMAP] feed items:', items.length);

      // ✅ 0개면: 기존 HTML 유지 (안 지움)
      if (items.length === 0) {
        console.warn('[NETWORK-AUTOMAP] empty → keep HTML');
        return;
      }

      // ✅ 정상일 때만 교체
      clearBox(box);

      const max = Math.min(items.length, SLOT_LIMIT);

      for (let i = 0; i < max; i++) {
        box.appendChild(createCard(items[i]));
      }

      console.log('[NETWORK-AUTOMAP] rendered:', max);

    } catch (e) {

      console.error('[NETWORK-AUTOMAP] error:', e);

    }
  }

  // ------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();