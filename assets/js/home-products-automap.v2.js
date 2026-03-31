// home-products-automap.v2.js
// HOME AUTOMAP — FULL RESTORE + FEED FIRST + SNAPSHOT FALLBACK
// Goals:
// 1) Keep existing DOM behavior for MAIN and RIGHT panel.
// 2) Keep current feed contract working as-is.
// 3) Add direct front.snapshot.json fallback so the home page does not collapse when feed is missing.
// 4) Preserve empty-state i18n, priority sorting, incremental rendering, and right-panel safety.

(function () {
  'use strict';

  if (window.__HOME_PRODUCTS_AUTOMAP_V2__) return;
  window.__HOME_PRODUCTS_AUTOMAP_V2__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';
  const SNAPSHOT_CANDIDATES = [
    '/data/front.snapshot.json',
    '/front.snapshot.json'
  ];

  const KEYS_MAIN = ['home_1', 'home_2', 'home_3', 'home_4', 'home_5'];
  const KEYS_RIGHT = ['home_right_top', 'home_right_middle', 'home_right_bottom'];
  const ALL_KEYS = KEYS_MAIN.concat(KEYS_RIGHT);

  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 7;
  const RIGHT_LIMIT = 80;
  const RIGHT_BATCH = 5;

  const EMPTY_I18N = {
    de: 'Inhalte werden vorbereitet.',
    en: 'Content is being prepared.',
    es: 'El contenido está en preparación.',
    fr: 'Contenu en cours de préparation.',
    id: 'Konten sedang disiapkan.',
    ja: 'コンテンツ準備中です。',
    ko: '콘텐츠 준비 중입니다.',
    pt: 'Conteúdo em preparação.',
    ru: 'Контент готовится.',
    th: 'กำลังเตรียมเนื้อหาอยู่',
    tr: 'İçerik hazırlanıyor.',
    vi: 'Nội dung đang được chuẩn bị.',
    zh: '内容正在准备中。'
  };

  const SUPPORTED_12 = new Set([
    'de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'pt', 'ru', 'th', 'tr', 'vi', 'zh'
  ]);

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function pick(obj, keys) {
    for (const k of keys) {
      const v = obj && obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function toArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }

  function getLangCode() {
    try {
      const raw = String(
        (window.localStorage && localStorage.getItem('igdc_lang')) ||
        (document.documentElement && document.documentElement.getAttribute('lang')) ||
        (navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) ||
        'en'
      ).trim().toLowerCase();
      const base = raw.split('-')[0];
      if (SUPPORTED_12.has(base)) return base;
      if (base === 'ko') return 'ko';
      return 'en';
    } catch (e) {
      return 'en';
    }
  }

  function emptyText() {
    return EMPTY_I18N[getLangCode()] || EMPTY_I18N.en;
  }

  function isExternal(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  function safeNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeItem(it, fallback) {
    const src = it || {};
    const fb = fallback || {};

    return {
      id: src.id || fb.id || null,
      title: pick(src, ['title', 'name', 'label', 'caption']) || 'Item',
      thumb: pick(src, ['thumb', 'image', 'image_url', 'img', 'photo', 'thumbnail', 'thumbnailUrl', 'cover', 'coverUrl']),
      url: pick(src, ['checkoutUrl', 'productUrl', 'url', 'href', 'link', 'path', 'detailUrl']) || '#',
      priority: (typeof src.priority === 'number')
        ? src.priority
        : (Number.isFinite(Number(src.priority)) ? Number(src.priority) : safeNumber(fb.priority, null)),
      weight: safeNumber(src.weight, safeNumber(fb.weight, 0)),
      order: safeNumber(src.order, safeNumber(fb.order, 0)),
      enabled: src.enabled !== false && fb.enabled !== false,
      lang: Array.isArray(src.lang) ? src.lang : (Array.isArray(fb.lang) ? fb.lang : []),
      page: src.page || fb.page || 'home',
      section: src.section || fb.section || null
    };
  }

  function sortItems(items) {
    return toArray(items)
      .filter(Boolean)
      .filter((item) => item.enabled !== false)
      .sort((a, b) => {
        const wa = safeNumber(a.weight, 0);
        const wb = safeNumber(b.weight, 0);
        if (wb !== wa) return wb - wa;

        const oa = safeNumber(a.order, 0);
        const ob = safeNumber(b.order, 0);
        if (oa !== ob) return oa - ob;

        const pa = (a.priority == null ? 999999 : a.priority);
        const pb = (b.priority == null ? 999999 : b.priority);
        if (pa !== pb) return pa - pb;

        return String(a.title || '').localeCompare(String(b.title || ''));
      });
  }

  function resolveTargets(psomEl, key) {
    const isRight = key.indexOf('home_right_') === 0;

    if (isRight) {
      const section = psomEl.closest('.ad-section');
      const scrollA = section && (section.querySelector('.ad-scroll') || section);
      const listA = section && section.querySelector('.ad-list');
      if (listA) {
        return { isRight: true, mode: 'ad-section', section, scroller: scrollA, list: listA, psomEl };
      }

      const panel = psomEl.closest('.right-panel') || psomEl.closest('.ad-panel') || null;
      const scrollB = psomEl.closest('.ad-scroll') || panel || null;
      const listB = psomEl;
      return { isRight: true, mode: 'direct', section: panel, scroller: scrollB, list: listB, psomEl };
    }

    const scroller = psomEl.closest('.shop-scroller');
    const row = scroller && scroller.querySelector('.shop-row');
    return { isRight: false, mode: 'shop', section: scroller, scroller, list: row, psomEl };
  }

  function clearEmptyStyles(el) {
    if (!el) return;
    el.textContent = '';
    el.style.padding = '';
    el.style.background = '';
    el.style.borderRadius = '';
    el.style.color = '';
    el.style.textAlign = '';
    el.style.fontSize = '';
    el.style.lineHeight = '';
    el.style.minHeight = '';
  }

  function showEmpty(target) {
    const psomIsList = (target.psomEl === target.list);

    if (target.isRight && target.mode === 'direct') {
      return;
    }

    target.psomEl.style.display = 'block';
    target.psomEl.textContent = emptyText();
    target.psomEl.style.padding = '12px';
    target.psomEl.style.borderRadius = '12px';
    target.psomEl.style.background = '#f7f7f7';
    target.psomEl.style.color = '#666';
    target.psomEl.style.textAlign = 'center';
    target.psomEl.style.fontSize = '14px';
    target.psomEl.style.lineHeight = '1.6';
    target.psomEl.style.minHeight = '44px';

    if (target.scroller) {
      if (!target.isRight) {
        target.scroller.style.display = 'none';
      } else if (target.mode === 'ad-section') {
        if (!psomIsList) target.scroller.style.display = 'none';
      }
    }
  }

  function showData(target) {
    const psomIsList = (target.psomEl === target.list);

    if (!psomIsList) {
      target.psomEl.style.display = 'none';
    } else {
      target.psomEl.style.display = '';
      clearEmptyStyles(target.psomEl);
    }

    if (target.scroller) {
      target.scroller.style.display = '';
    }
  }

  function buildMainCard(item) {
    const a = document.createElement('a');
    a.className = 'shop-card';
    a.href = item.url || '#';
    if (isExternal(item.url)) {
      a.target = '_blank';
      a.rel = 'noopener';
    }

    if (item.thumb) {
      a.style.backgroundImage = 'url("' + escAttr(item.thumb) + '")';
      a.style.backgroundPosition = 'center';
      a.style.backgroundSize = 'cover';
      a.style.backgroundRepeat = 'no-repeat';
    }

    const cap = document.createElement('div');
    cap.className = 'shop-card-cap';
    cap.textContent = item.title || '';
    cap.style.alignSelf = 'end';
    cap.style.width = '100%';
    cap.style.background = 'rgba(255,255,255,.88)';
    cap.style.padding = '6px 8px';
    cap.style.fontWeight = '700';
    cap.style.fontSize = '14px';
    cap.style.color = '#222';
    cap.style.whiteSpace = 'nowrap';
    cap.style.overflow = 'hidden';
    cap.style.textOverflow = 'ellipsis';

    a.style.display = 'grid';
    a.style.gridTemplateRows = '1fr auto';
    a.style.alignItems = 'stretch';
    a.style.justifyItems = 'stretch';
    a.appendChild(cap);

    return a;
  }

  function buildRightCard(item) {
    const a = document.createElement('a');
    a.className = 'ad-box news-btn';
    a.href = item.url || '#';
    if (isExternal(item.url)) {
      a.target = '_blank';
      a.rel = 'noopener';
    }

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = item.thumb || '';
    img.alt = item.title || '';
    a.appendChild(img);

    return a;
  }

  function indexSectionsFromFeed(payload) {
    const map = Object.create(null);
    if (!payload || !Array.isArray(payload.sections)) return map;

    for (const s of payload.sections) {
      const id = String((s && (s.id || s.sectionId)) || '').trim();
      if (!id) continue;
      map[id] = toArray(s.items || s.cards);
    }

    return map;
  }

  function buildSectionsFromSnapshot(snapshot) {
    const sectionsMap = snapshot && snapshot.pages && snapshot.pages.home && snapshot.pages.home.sections;
    const out = Object.create(null);

    if (!sectionsMap || typeof sectionsMap !== 'object') {
      return out;
    }

    for (const key of ALL_KEYS) {
      out[key] = sortItems(
        toArray(sectionsMap[key]).map((item) => normalizeItem(item, { page: 'home', section: key }))
      );
    }

    return out;
  }

  function normalizeFeedSectionsMap(feedMap) {
    const out = Object.create(null);

    for (const key of ALL_KEYS) {
      const raw = feedMap[key] || [];
      out[key] = sortItems(
        toArray(raw).map((item) => normalizeItem(item, { page: 'home', section: key }))
      );
    }

    return out;
  }

  function legacyKey(key) {
    if (key.startsWith('home_right_')) return key.replace('home_right_', 'home-right-');
    return key.replace('home_', 'home-shop-');
  }

  function resolveSectionItems(sectionMap, key) {
    if (!sectionMap) return [];
    const alt = key.replace(/_/g, '-');
    return sectionMap[key] || sectionMap[alt] || sectionMap[legacyKey(key)] || [];
  }

function bindIncremental(target, items) {

  const isRight = target.isRight;
  const limit = isRight ? RIGHT_LIMIT : MAIN_LIMIT;

  let offset = 0;

  function renderMore() {
    const end = Math.min(offset + 20, limit, items.length); // 🔥 강제 확장
    const frag = document.createDocumentFragment();

    for (let i = offset; i < end; i++) {
      const it = items[i];
      frag.appendChild(isRight ? buildRightCard(it) : buildMainCard(it));
    }

    target.list.appendChild(frag);
    offset = end;
  }

  target.list.innerHTML = '';

  // 🔥 핵심: 초기 한번에 많이 뿌림
  renderMore();
  renderMore();  // 2번 실행 → 최소 10~40개 확보

  // 🔥 모바일 대응: 강제 전체 렌더
  if (window.innerWidth <= 768) {
    while (offset < items.length && offset < limit) {
      renderMore();
    }
    return;
  }

  const scroller = target.scroller;
  if (!scroller) return;

  scroller.addEventListener('scroll', function () {

    if (offset >= items.length || offset >= limit) return;

    const nearEnd = isRight
      ? (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 20)
      : (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 20);

    if (nearEnd) renderMore();

  }, { passive: true });
}

  function renderSlot(key, rawItems) {
    const psomEl = qs('[data-psom-key="' + key + '"]');
    if (!psomEl) return;

    const target = resolveTargets(psomEl, key);
    if (!target.list) return;

    if (target.isRight && target.scroller) {
      try {
        target.scroller.style.overflowY = 'auto';
        target.scroller.style.webkitOverflowScrolling = 'touch';
        target.scroller.style.touchAction = 'pan-y';
      } catch (e) {}
    }

    const isRight = target.isRight;
    const list = sortItems(
      toArray(rawItems)
        .map((item) => normalizeItem(item, { page: 'home', section: key }))
        .filter((x) => {
          if (!x) return false;
          if (isRight) return true;
          return !!x.thumb;
        })
    );

    if (!list.length) {
      showEmpty(target);
      return;
    }

    if (target.isRight) {
      target.list.innerHTML = '';
    }

    showData(target);
    bindIncremental(target, list);
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' @ ' + url);
    }
    return await res.json();
  }

  async function loadFromFeed() {
    const payload = await fetchJSON(FEED_URL);
    const sectionMap = normalizeFeedSectionsMap(indexSectionsFromFeed(payload));
    return { source: 'feed', sections: sectionMap };
  }

  async function loadFromSnapshot() {
    let lastErr = null;

    for (const url of SNAPSHOT_CANDIDATES) {
      try {
        const snapshot = await fetchJSON(url);
        const sections = buildSectionsFromSnapshot(snapshot);
        return { source: 'snapshot', sections };
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error('SNAPSHOT_LOAD_FAILED');
  }

  async function loadSections() {
    try {
      return await loadFromFeed();
    } catch (feedErr) {
      try {
        return await loadFromSnapshot();
      } catch (snapshotErr) {
        throw new Error(
          'HOME_AUTOMAP_LOAD_FAILED :: ' +
          String((feedErr && feedErr.message) || feedErr) + ' :: ' +
          String((snapshotErr && snapshotErr.message) || snapshotErr)
        );
      }
    }
  }

  async function boot() {
    try {
      const loaded = await loadSections();
      const sections = loaded.sections || Object.create(null);

      for (const key of KEYS_MAIN) {
        renderSlot(key, resolveSectionItems(sections, key));
      }

      for (const key of KEYS_RIGHT) {
        renderSlot(key, resolveSectionItems(sections, key));
      }

      window.__HOME_PRODUCTS_AUTOMAP_V2_SOURCE__ = loaded.source;
    } catch (e) {
      for (const key of ALL_KEYS) {
        const psomEl = qs('[data-psom-key="' + key + '"]');
        if (!psomEl) continue;
        const target = resolveTargets(psomEl, key);
        showEmpty(target);
      }
      try {
        console.error('[HOME AUTOMAP V2] Error:', e);
      } catch (_) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();