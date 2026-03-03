// socialnetwork-automap.v3.js (PRODUCTION)
// 목적: social.snapshot.json -> (SNS 9섹션 + 우측패널/모바일레일) 1:1 정확 매핑
// 핵심: 'socialnetwork' 키는 HTML에 2곳 존재(우측패널/모바일레일)하므로, 뷰포트에 따라 1곳만 렌더링

(function () {
  'use strict';

  if (window.__SOCIALNETWORK_AUTOMAP_V3__) return;
  window.__SOCIALNETWORK_AUTOMAP_V3__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';

  const LIMIT_MAIN = 100;
  const LIMIT_RIGHT = 80;

  // ---- 정확 타겟 (HTML 구조 기반) ----
  // 1) 메인 9섹션: data-psom-key 1개씩
  // 2) RIGHT/MOBILE: 둘 다 data-psom-key="socialnetwork" 이므로, CSS/viewport 기준으로 1곳만 선택 렌더링
  const MAIN_SECTIONS = [
    { key: 'social-instagram', selector: '[data-psom-key="social-instagram"]', limit: LIMIT_MAIN },
    { key: 'social-youtube', selector: '[data-psom-key="social-youtube"]', limit: LIMIT_MAIN },
    { key: 'social-twitter', selector: '[data-psom-key="social-twitter"]', limit: LIMIT_MAIN },
    { key: 'social-facebook', selector: '[data-psom-key="social-facebook"]', limit: LIMIT_MAIN },
    { key: 'social-tiktok', selector: '[data-psom-key="social-tiktok"]', limit: LIMIT_MAIN },
    { key: 'social-threads', selector: '[data-psom-key="social-threads"]', limit: LIMIT_MAIN },
    { key: 'social-telegram', selector: '[data-psom-key="social-telegram"]', limit: LIMIT_MAIN },
    { key: 'social-discord', selector: '[data-psom-key="social-discord"]', limit: LIMIT_MAIN },
    { key: 'social-community', selector: '[data-psom-key="social-community"]', limit: LIMIT_MAIN }
  ];

  // 우측패널 'socialnetwork' 슬롯: #rightAutoPanel 바로 다음 thumb-grid
  const RIGHT_TARGET_SELECTOR = '#rightAutoPanel + .thumb-grid.thumb-scroller[data-psom-key="socialnetwork"]';

  // 모바일 레일 'socialnetwork' 슬롯: #rpMobileGrid
  const MOBILE_TARGET_SELECTOR = '#rpMobileGrid.thumb-grid.thumb-scroller[data-psom-key="socialnetwork"]';

  const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  // 같은 노드 중복렌더 방지
  const RENDERED_NODES = new WeakSet();

  function clear(el) {
    if (!el || RENDERED_NODES.has(el)) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function escText(s) {
    try { return String(s ?? ''); } catch { return ''; }
  }

  function escUrl(u) {
    try { return String(u ?? '').replace(/'/g, '%27'); } catch { return ''; }
  }

  function pickImage(item) {
    return (item && (item.thumb || item.image || item.thumbnail || item.imageUrl || item.thumbnailUrl || '')) || '';
  }

  function pickTitle(item) {
    return (item && (item.title || item.name || item.text || '')) || '';
  }

  function pickMeta(item) {
    return (item && (item.meta || item.subtitle || item.summary || '')) || '';
  }

  function pickUrl(item) {
    return (item && (item.url || item.href || item.link || '')) || '';
  }

  function makeDummy(prefix, idx) {
    const n = idx + 1;
    return {
      title: prefix + ' ' + n,
      meta: '',
      thumb: PLACEHOLDER_IMG,
      url: '#'
    };
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'thumb-card';

    const img = document.createElement('div');
    img.className = 'thumb-img';
    const src = pickImage(item);
    const useSrc = src || PLACEHOLDER_IMG;

    img.style.backgroundImage = "url('" + escUrl(useSrc) + "')";
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = escText(pickTitle(item));

    const meta = document.createElement('div');
    meta.className = 'thumb-meta';
    meta.textContent = escText(pickMeta(item));

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(meta);

    const href = pickUrl(item);
    if (href && href !== '#') {
      card.addEventListener('click', function () { location.href = href; });
      card.style.cursor = 'pointer';
    }

    return card;
  }

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Snapshot load failed: ' + res.status);
    return res.json();
  }

  function getSections(snapshot) {
    return (snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections) ||
           (snapshot && snapshot.sections) ||
           null;
  }

  function renderBox(box, items, limit, dummyPrefix) {
    if (!box || RENDERED_NODES.has(box)) return;

    const arr = Array.isArray(items) ? items.slice(0, limit) : [];
    while (arr.length < limit) arr.push(makeDummy(dummyPrefix, arr.length));

    clear(box);
    arr.forEach(it => box.appendChild(createCard(it)));
    RENDERED_NODES.add(box);
  }

  function isMobile() {
    // HTML/CSS 기준(<=1024px)과 동일
    return window.matchMedia && window.matchMedia('(max-width:1024px)').matches;
  }

  function renderStrict(sections) {
    // 1) 메인 9섹션: 무조건 렌더
    MAIN_SECTIONS.forEach(cfg => {
      const box = document.querySelector(cfg.selector);
      if (!box) return;
      renderBox(box, sections && sections[cfg.key], cfg.limit, cfg.key);
    });

    // 2) 우측패널/모바일레일: 반드시 1곳만 렌더
    const key = 'socialnetwork';
    const limit = LIMIT_RIGHT;

    const rightBox = document.querySelector(RIGHT_TARGET_SELECTOR);
    const mobileBox = document.querySelector(MOBILE_TARGET_SELECTOR);

    if (isMobile()) {
      // 모바일에서는 모바일 레일만 렌더
      if (mobileBox) renderBox(mobileBox, sections && sections[key], limit, key);
    } else {
      // 데스크탑/태블릿에서는 우측패널만 렌더
      if (rightBox) renderBox(rightBox, sections && sections[key], limit, key);
    }
  }

  async function run() {
    try {
      const snapshot = await loadSnapshot();
      const sections = getSections(snapshot);
      if (!sections) return;

      renderStrict(sections);

      // 리사이즈로 레이아웃 전환 시(모바일<->데스크탑) 우측/모바일 타겟 재렌더 필요
      // => 한 번만 리스너 연결, 전환 시 해당 1곳만 새로 렌더
      let lastMobile = isMobile();
      window.addEventListener('resize', function () {
        const nowMobile = isMobile();
        if (nowMobile === lastMobile) return;
        lastMobile = nowMobile;

        // 전환 시, 두 타겟 모두 렌더 상태 해제 후 다시 렌더 (메인 섹션은 유지)
        const rb = document.querySelector(RIGHT_TARGET_SELECTOR);
        const mb = document.querySelector(MOBILE_TARGET_SELECTOR);
        if (rb) { RENDERED_NODES.delete?.(rb); while (rb.firstChild) rb.removeChild(rb.firstChild); }
        if (mb) { RENDERED_NODES.delete?.(mb); while (mb.firstChild) mb.removeChild(mb.firstChild); }

        renderStrict(sections);
      }, { passive: true });

      console.log('[AUTOMAP] socialnetwork v3 mapping loaded');
    } catch (e) {
      console.error('[AUTOMAP] socialnetwork v3 error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

})();
