/* network-rightpanel-automap.js (FINAL FIX) */
/* 목적: feed ↔ snapshot 키 불일치 해결 버전 */

(function () {
  'use strict';

  if (window.__NETWORK_RIGHT_AUTOMAP_FINAL__) return;
  window.__NETWORK_RIGHT_AUTOMAP_FINAL__ = true;

  // ✅ 피드가 읽는 section에 맞춤 (중요)
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

  function pickImage(it) {
    return pick(it, [
      'thumb',
      'image',
      'thumbnail',
      'imageUrl',
      'img',
      'photo',
      'cover'
    ]);
  }

  function pickTitle(it) {
    return pick(it, ['title', 'name', 'text', 'label']);
  }

  function pickUrl(it) {
    return pick(it, ['url', 'href', 'link', 'path']) || '#';
  }

  function createCard(item) {
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

    img.src = pickImage(item) || '';
    img.alt = pickTitle(item) || 'thumb';
    img.loading = 'lazy';
    img.decoding = 'async';

    a.appendChild(img);
    box.appendChild(a);

    return box;
  }

  async function run() {
    try {
      // ✅ HTML 타겟 정확히 맞춤
      const box =
        document.getElementById('rightAutoPanel') ||
        document.getElementById('nh-mobile-rail-list');

      if (!box) {
        console.error('[NETWORK-AUTOMAP] Target not found');
        return;
      }

      const data = await loadFeed();

      const items = Array.isArray(data?.items)
        ? data.items
        : [];

      // ✅ 데이터 없으면 건드리지 않음
      if (items.length === 0) {
        console.warn('[NETWORK-AUTOMAP] Empty feed');
        return;
      }

      clearBox(box);

      const max = Math.min(items.length, SLOT_LIMIT);

      for (let i = 0; i < max; i++) {
        box.appendChild(createCard(items[i]));
      }

      console.log('[NETWORK-AUTOMAP] Rendered:', max);

    } catch (e) {
      console.error('[NETWORK-AUTOMAP] Error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();