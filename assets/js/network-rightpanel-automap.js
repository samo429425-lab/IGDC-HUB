/* network-rightpanel-automap.js (RESET FINAL)
 * 목적: Network Hub 우측패널/모바일레일에 "받은 데이터만" 꽂기
 * 원칙:
 *  - Feed items 0개면: 기존 HTML 절대 건드리지 않음
 *  - Dummy/샘플 생성 절대 없음
 *  - 타겟: #rightAutoPanel (데스크탑), #nh-mobile-rail-list (모바일)
 */

(function () {
  'use strict';

  if (window.__NETWORK_RIGHT_AUTOMAP_RESET__) return;
  window.__NETWORK_RIGHT_AUTOMAP_RESET__ = true;

  // ✅ 중요: feed-network는 limit 기반으로 호출 (section 불필요)
  const FEED_URL = '/.netlify/functions/feed-network?limit=100';
  const SLOT_LIMIT = 100;

  function $(id) { return document.getElementById(id); }

  function pick(it, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = it && it[keys[i]];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function pickUrl(it)  { return pick(it, ['url','href','link','path']); }
  function pickImg(it)  { return pick(it, ['thumb','image','thumbnail','imageUrl','img','photo','cover','coverUrl']); }
  function pickTitle(it){ return pick(it, ['title','name','text','label']); }

  async function loadFeed() {
    const res = await fetch(FEED_URL + '&_t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Feed load failed: ' + res.status);
    return res.json();
  }

  function clearBox(box) {
    while (box.firstChild) box.removeChild(box.firstChild);
  }

  // ✅ 기존 우측패널(더미/광고) 구조 호환: .ad-box > a > img
  function createAdBox(item) {
    const box = document.createElement('div');
    box.className = 'ad-box';

    const a = document.createElement('a');
    const href = pickUrl(item) || '#';
    a.href = href;
    if (href && href !== '#') {
      a.target = '_blank';
      a.rel = 'noopener';
    } else {
      a.tabIndex = -1;
      a.setAttribute('aria-hidden', 'true');
    }

    const img = document.createElement('img');
    const src = pickImg(item);
    img.src = src || '';
    img.alt = pickTitle(item) || 'thumb';
    img.loading = 'lazy';
    img.decoding = 'async';

    a.appendChild(img);
    box.appendChild(a);

    return box;
  }

  function renderInto(target, items) {
    if (!target) return;

    // ✅ 0개면 HTML 유지 (절대 clear 하지 않음)
    if (!items || items.length === 0) {
      console.warn('[NETWORK-AUTOMAP] Empty items → keep HTML:', target.id || target.className);
      return;
    }

    clearBox(target);

    const max = Math.min(items.length, SLOT_LIMIT);
    for (let i = 0; i < max; i++) {
      target.appendChild(createAdBox(items[i]));
    }

    console.log('[NETWORK-AUTOMAP] Rendered', max, 'into', target.id || target.className);
  }

  async function run() {
    try {
      const right = $('rightAutoPanel');
      const mobile = $('nh-mobile-rail-list');

      if (!right && !mobile) {
        console.error('[NETWORK-AUTOMAP] Target not found: rightAutoPanel / nh-mobile-rail-list');
        return;
      }

      const data = await loadFeed();
      const items = Array.isArray(data && data.items) ? data.items : [];

      // ✅ 유효 아이템만 (이미지 없는 건 제외)
      const filtered = [];
      for (let i = 0; i < items.length; i++) {
        if (pickImg(items[i])) filtered.push(items[i]);
        if (filtered.length >= SLOT_LIMIT) break;
      }

      console.log('[NETWORK-AUTOMAP] Feed items:', items.length, 'usable:', filtered.length);

      renderInto(right, filtered);
      renderInto(mobile, filtered);

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
