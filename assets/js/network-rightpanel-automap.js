// network-rightpanel-automap.js (FINAL - compatible with rightpanel-dummy-engine-v2)
// 목표: 디스트리뷰션과 동일 운영 철학
// 1) snapshot(/data/networkhub-snapshot.json) 우선
// 2) 없으면 샘플 100개 즉시 생성
// 3) 기존 rightpanel-dummy-engine-v2 훅(__IGDC_RIGHTPANEL_RENDER) 사용 (더미→실데이터 전환)
// 4) 모바일 레일(nh-mobile-rail-list)은 별도 렌더

(function () {
  'use strict';

  if (window.__NH_RIGHT_AUTOMAP_FINAL__) return;
  window.__NH_RIGHT_AUTOMAP_FINAL__ = true;

  const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
  const LIMIT = 100;

  const DESKTOP_PANEL_ID = 'rightAutoPanel';
  const MOBILE_LIST_ID = 'nh-mobile-rail-list';

  const PLACEHOLDER = '/assets/sample/placeholder.jpg';

  function $(id) { return document.getElementById(id); }

  function pick(it, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = it && it[keys[i]];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function normalizeItem(it, idx) {
    // snapshot/feed 형태가 뭐든 이 3개 키로 통일
    const thumb = pick(it, ['thumb','image','thumbnail','imageUrl','img','photo','cover']) || PLACEHOLDER;
    const link  = pick(it, ['link','url','href']) || '#';
    const id    = pick(it, ['id','productId','pid']) || String(idx + 1);
    return { id, thumb, link };
  }

  function makeSample(idx) {
    return { id: 'S' + (idx + 1), thumb: PLACEHOLDER, link: '#' };
  }

  function buildList(raw) {
    const list = Array.isArray(raw) ? raw.slice(0, LIMIT).map(normalizeItem) : [];
    while (list.length < LIMIT) list.push(makeSample(list.length));
    return list;
  }

  async function loadSnapshotItems() {
    try {
      const r = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
      if (!r.ok) return [];
      const j = await r.json();
      // 지원: {items:[...]} / {data:{items:[...]}}
      const items =
        (j && Array.isArray(j.items) ? j.items : null) ||
        (j && j.data && Array.isArray(j.data.items) ? j.data.items : null) ||
        [];
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  }

  function renderMobile(list) {
    const box = $(MOBILE_LIST_ID);
    if (!box) return;

    // items 없으면(=샘플이든 실데이터든) 무조건 채움
    while (box.firstChild) box.removeChild(box.firstChild);

    for (let i = 0; i < list.length; i++) {
      const it = list[i];

      const card = document.createElement('div');
      card.className = 'ad-box';

      const a = document.createElement('a');
      a.href = it.link || '#';
      if (a.href !== '#') { a.target = '_blank'; a.rel = 'noopener'; }

      const img = document.createElement('img');
      img.src = it.thumb || PLACEHOLDER;
      img.loading = 'lazy';
      img.decoding = 'async';
      a.appendChild(img);

      card.appendChild(a);
      box.appendChild(card);
    }
  }

  function renderDesktopViaHook(list) {
    // 기존 엔진 훅이 있으면 그걸로 렌더(더미 관리 포함)
    if (typeof window.__IGDC_RIGHTPANEL_RENDER === 'function') {
      window.__IGDC_RIGHTPANEL_RENDER(list);
      return true;
    }
    return false;
  }

  function renderDesktopFallback(list) {
    const panel = $(DESKTOP_PANEL_ID);
    if (!panel) return;

    while (panel.firstChild) panel.removeChild(panel.firstChild);

    for (let i = 0; i < list.length; i++) {
      const it = list[i];

      const card = document.createElement('div');
      card.className = 'ad-box';

      const a = document.createElement('a');
      a.href = it.link || '#';
      a.setAttribute('data-product-id', it.id || '');
      if (a.href !== '#') { a.target = '_blank'; a.rel = 'noopener'; }

      const img = document.createElement('img');
      img.src = it.thumb || PLACEHOLDER;
      img.loading = 'lazy';
      img.decoding = 'async';

      a.appendChild(img);
      card.appendChild(a);
      panel.appendChild(card);
    }
  }

  async function run() {
    const raw = await loadSnapshotItems();
    const list = buildList(raw);

    // 데스크탑: 훅 우선(=기존 더미 엔진과 100% 호환)
    const ok = renderDesktopViaHook(list);
    if (!ok) renderDesktopFallback(list);

    // 모바일: 별도 리스트 렌더
    renderMobile(list);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();