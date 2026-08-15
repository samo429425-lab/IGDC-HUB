// home-products-automap.v2.js
// HOME AUTOMAP — FULL RESTORE + SNAPSHOT FIRST + FEED FALLBACK
// Goals:
// 1) Keep existing DOM behavior for MAIN and RIGHT panel.
// 2) Read the public front.snapshot.json first as the normal operating source.
// 3) Keep the current feed contract only as a fallback when the Snapshot is unavailable.
// 4) Preserve empty-state i18n, priority sorting, incremental rendering, and right-panel safety.
// 5) Keep exactly 100 slot cards per Home section/right panel; never collapse the slot array.

(function () {
  'use strict';

  if (window.__HOME_PRODUCTS_AUTOMAP_V2__) return;
  window.__HOME_PRODUCTS_AUTOMAP_V2__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';
  // The Edge function resolves this path to an approved same-country snapshot.
  // Do not try a legacy root fallback because that would bypass the IP gate.
  const SNAPSHOT_CANDIDATES = [ '/data/front.snapshot.json' ];

  const KEYS_MAIN = ['home_1', 'home_2', 'home_3', 'home_4', 'home_5'];
  const KEYS_RIGHT = ['home_right_top', 'home_right_middle', 'home_right_bottom'];
  const ALL_KEYS = KEYS_MAIN.concat(KEYS_RIGHT);

  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 20;
  const RIGHT_LIMIT = 100;
  const RIGHT_BATCH = 100;

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


  function isBadUrl(url) {
    const u = String(url || '').trim();
    return !u || u === '#' || /^javascript:/i.test(u) || /^about:blank$/i.test(u);
  }

  function isExampleUrl(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    try {
      const parsed = new URL(u, window.location.origin);
      return /(^|\.)example\.(com|org|net)$/i.test(parsed.hostname);
    } catch (e) {
      return /example\.(com|org|net)/i.test(u);
    }
  }

  function pad3(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '001';
    return String(Math.floor(x)).padStart(3, '0');
  }

  function numberFromUrl(url) {
    try {
      const parsed = new URL(String(url || ''), window.location.origin);
      const last = (parsed.pathname.split('/').filter(Boolean).pop() || '');
      const m = last.match(/(\d+)/);
      return m ? Number(m[1]) : null;
    } catch (e) {
      const m = String(url || '').match(/(\d+)(?!.*\d)/);
      return m ? Number(m[1]) : null;
    }
  }

  function makeStableContentId(src, fb, page, section, url, priority, order) {
    const explicit = pick(src, ['id', 'contentId', 'productId', 'itemId', 'sku', 'code', 'pid']) || pick(fb, ['id', 'contentId', 'productId', 'itemId', 'sku', 'code', 'pid']);
    if (explicit) return explicit;
    const base = section || page || 'home';
    const n = priority || order || numberFromUrl(url) || 1;
    return base + '-' + pad3(n);
  }

  function contentHref(id) {
    return id ? ('/content.html?id=' + encodeURIComponent(id)) : '';
  }

  function resolveSlotHref(item) {
    if (!item) return '';
    const outbound = item && (item.affiliateOutboundUrl || item.externalOutboundUrl || item.outboundUrl || '');
    if (outbound && !isBadUrl(outbound) && !isExampleUrl(outbound)) return outbound;
    if (item.id) return contentHref(item.id);
    const url = item.url || '';
    if (isBadUrl(url) || isExampleUrl(url)) return '';
    return url;
  }

  function applyAnchorDestination(a, item) {
    const href = resolveSlotHref(item);
    a.removeAttribute('target');
    a.removeAttribute('rel');

    if (!href) {
      a.href = '#';
      a.tabIndex = -1;
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('data-igdc-disabled', '1');
      a.addEventListener('click', function (ev) { ev.preventDefault(); }, { passive: false });
      return;
    }

    a.href = href;
    if (item && item.id) a.setAttribute('data-igdc-content-id', item.id);
    if (item && item.sourceUrl) a.setAttribute('data-igdc-source-url', item.sourceUrl);
    if (item && item.affiliateOutboundUrl) a.setAttribute('data-affiliate-outbound', '1');
    if (item && item.externalOutboundUrl) a.setAttribute('data-external-outbound', '1');

    if (isExternal(href)) {
      a.target = '_top';
      a.rel = 'noopener';
      a.setAttribute('data-igdc-external', 'top');
    }
  }

  function safeNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeItem(it, fallback) {
    const src = it || {};
    const fb = fallback || {};

    const page = src.page || fb.page || 'home';
    const section = src.section || fb.section || null;
    const sourceUrl = pick(src, ['affiliateOutboundUrl', 'affiliate_outbound_url', 'externalOutboundUrl', 'external_outbound_url', 'checkoutUrl', 'paymentUrl', 'productUrl', 'purchaseUrl', 'orderUrl', 'url', 'href', 'link', 'path', 'detailUrl', 'contentUrl', 'pageUrl']) || '#';
    const priority = (typeof src.priority === 'number')
      ? src.priority
      : (Number.isFinite(Number(src.priority)) ? Number(src.priority) : safeNumber(fb.priority, null));
    const order = safeNumber(src.order, safeNumber(fb.order, 0));
    const id = makeStableContentId(src, fb, page, section, sourceUrl, priority, order);

    return {
      id,
      title: pick(src, ['title', 'name', 'label', 'caption']) || 'Item',
      thumb: pick(src, ['thumb', 'image', 'image_url', 'img', 'photo', 'thumbnail', 'thumbnailUrl', 'cover', 'coverUrl']),
      url: sourceUrl,
      sourceUrl,
      affiliateOutboundUrl: pick(src, ['affiliateOutboundUrl', 'affiliate_outbound_url']),
      externalOutboundUrl: pick(src, ['externalOutboundUrl', 'external_outbound_url']),
      priority,
      weight: safeNumber(src.weight, safeNumber(fb.weight, 0)),
      order,
      enabled: src.enabled !== false && fb.enabled !== false,
      lang: Array.isArray(src.lang) ? src.lang : (Array.isArray(fb.lang) ? fb.lang : []),
      page,
      section
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
    applyAnchorDestination(a, item);
    if (item && item.__igdcFallbackSlot) {
      a.setAttribute('data-igdc-slot-placeholder', '1');
      a.setAttribute('aria-hidden', 'true');
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
    cap.style.position = 'absolute';
    cap.style.left = '0';
    cap.style.right = '0';
    cap.style.bottom = '0';
    cap.style.boxSizing = 'border-box';
    cap.style.padding = '6px 8px';
    cap.style.fontWeight = '700';
    cap.style.fontSize = '14px';
    cap.style.color = '#222';
    cap.style.textAlign = 'center';
    cap.style.whiteSpace = 'normal';
    cap.style.overflow = 'hidden';
    cap.style.overflowWrap = 'anywhere';
    cap.style.wordBreak = 'break-word';
    cap.style.lineHeight = '1.35';
    cap.style.display = '-webkit-box';
    cap.style.webkitBoxOrient = 'vertical';
    cap.style.webkitLineClamp = '2';

    a.style.position = 'relative';
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
    applyAnchorDestination(a, item);
    if (item && item.__igdcFallbackSlot) {
      a.setAttribute('data-igdc-slot-placeholder', '1');
      a.setAttribute('aria-hidden', 'true');
    }

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = item.thumb || '';
    img.alt = '';

    const showFallbackLabel = function () {
      if (a.querySelector('.home-right-sample-label')) return;
      img.style.display = 'none';

      const label = document.createElement('div');
      label.className = 'home-right-sample-label';
      label.textContent = item.title || '';
      label.style.width = '100%';
      label.style.height = '100%';
      label.style.boxSizing = 'border-box';
      label.style.padding = '8px';
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.justifyContent = 'center';
      label.style.textAlign = 'center';
      label.style.whiteSpace = 'normal';
      label.style.overflowWrap = 'anywhere';
      label.style.wordBreak = 'break-word';
      label.style.lineHeight = '1.35';
      label.style.color = '#004080';
      label.style.fontWeight = '600';
      label.style.overflow = 'hidden';
      a.appendChild(label);
    };

    img.addEventListener('error', showFallbackLabel, { once: true });
    a.appendChild(img);

    // Snapshot seed cards use the known transparent sample GIF.
    // Render their names as normal centered fallback content instead of browser ALT text.
    if (/^data:image\/gif;base64,R0lGODlhAQABAAAAACw=/i.test(String(item.thumb || ''))) {
      showFallbackLabel();
    }

    return a;
  }

  function makeFallbackSlotItem(key, index, isRight) {
    const slotNo = index + 1;
    return {
      id: key + '-slot-' + pad3(slotNo),
      title: '',
      thumb: '',
      url: '#',
      sourceUrl: '#',
      affiliateOutboundUrl: '',
      externalOutboundUrl: '',
      priority: slotNo,
      weight: 0,
      order: slotNo,
      enabled: true,
      lang: [],
      page: 'home',
      section: key,
      __igdcFallbackSlot: true,
      __igdcRight: !!isRight
    };
  }

  function ensureExactSlotCount(items, key, isRight) {
    const limit = isRight ? RIGHT_LIMIT : MAIN_LIMIT;
    const out = toArray(items).slice(0, limit);
    while (out.length < limit) {
      out.push(makeFallbackSlotItem(key, out.length, isRight));
    }
    return out;
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
      // Snapshot Engine already publishes the authoritative slot order.
      // Preserve that order exactly so real products stay in slots 1,2,3...
      // instead of being re-ranked to the end by front-side weight/order sorting.
      out[key] = toArray(sectionsMap[key]).map((item) =>
        normalizeItem(item, { page: 'home', section: key })
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
    const batch = isRight ? RIGHT_BATCH : MAIN_BATCH;
    const end = Math.min(offset + batch, limit, items.length);
    const frag = document.createDocumentFragment();

    for (let i = offset; i < end; i++) {
      const it = items[i];
      frag.appendChild(isRight ? buildRightCard(it) : buildMainCard(it));
    }

    target.list.appendChild(frag);
    offset = end;
  }

  target.list.innerHTML = '';

  // 초기 렌더링은 화면 크기와 관계없이 한 묶음만 실행한다.
  renderMore();

  const scroller = target.scroller;
  if (!scroller) return;

  scroller.addEventListener('scroll', function () {

    if (offset >= items.length || offset >= limit) return;

    const rightUsesHorizontalScroll = isRight && (scroller.scrollWidth > scroller.clientWidth + 1);
    const nearEnd = isRight
      ? (rightUsesHorizontalScroll
          ? (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 20)
          : (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 20))
      : (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 20);

    if (nearEnd) renderMore();

  }, { passive: true });
}

  function renderSlot(key, rawItems, preserveSnapshotOrder) {
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
    const normalized = toArray(rawItems)
      .map((item) => normalizeItem(item, { page: 'home', section: key }))
      .filter(Boolean);

    // Snapshot order is authoritative. Never discard a published slot merely
    // because its thumbnail is temporarily blank; that would collapse the
    // 100-slot contract and shift every following card. Legacy/feed input may
    // still use the historical sort, but both sources are padded/truncated to
    // exactly 100 slots per section.
    const ordered = preserveSnapshotOrder ? normalized : sortItems(normalized);
    const list = ensureExactSlotCount(ordered, key, isRight);

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
    // Home product and right-panel slots are IP scoped. A generic feed is not
    // a safe fallback because it has no request-time country/region proof.
    return await loadFromSnapshot();
  }


  function installHomeNewsTopNavigation() {
    if (window.__IGDC_HOME_NEWS_TOP_NAV_INSTALLED__) return;
    window.__IGDC_HOME_NEWS_TOP_NAV_INSTALLED__ = true;
    document.addEventListener('click', function (ev) {
      const target = ev.target;
      const a = target && target.closest && target.closest('.news-section a.news-btn[href^="http"], a.news-btn[data-igdc-external="top"][href^="http"]');
      if (!a) return;
      const href = a.href;
      if (!href) return;
      ev.preventDefault();
      try {
        (window.top || window).location.assign(href);
      } catch (e) {
        window.location.href = href;
      }
    }, true);
  }

  async function boot() {
    try {
      const loaded = await loadSections();
      const sections = loaded.sections || Object.create(null);

      const preserveSnapshotOrder = loaded.source === 'snapshot';

      for (const key of KEYS_MAIN) {
        renderSlot(key, resolveSectionItems(sections, key), preserveSnapshotOrder);
      }

      for (const key of KEYS_RIGHT) {
        renderSlot(key, resolveSectionItems(sections, key), preserveSnapshotOrder);
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

  installHomeNewsTopNavigation();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      installHomeNewsTopNavigation();
      boot();
    });
  } else {
    boot();
  }
})();


/* ------------------------------------------------------------------
 * MARU Revenue AutoHook Loader
 * Added by revenue tracking patch.
 *
 * Purpose:
 * - Load /assets/js/maru-revenue-tracker.js
 * - Then load /assets/js/maru-revenue-autohook.js
 * - Do not change this automap's original rendering pipeline.
 * ------------------------------------------------------------------ */
(function loadMaruRevenueAutoHookForAutomap(){
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function installIfReady(){
    try {
      if (
        window.MaruRevenueAutoHook &&
        typeof window.MaruRevenueAutoHook.install === "function"
      ) {
        window.MaruRevenueAutoHook.install({
          service: "front-automap"
        });
      }
    } catch (e) {
      console.warn("[MARU Revenue] autohook install skipped:", e);
    }
  }

  function loadScriptOnce(src, id, globalName, done){
    var existing = document.getElementById(id);

    if (window[globalName]) {
      if (typeof done === "function") done();
      return;
    }

    if (existing) {
      existing.addEventListener("load", function(){
        if (typeof done === "function") done();
      }, { once:true });
      existing.addEventListener("error", function(){
        console.warn("[MARU Revenue] failed to load:", src);
      }, { once:true });
      return;
    }

    var script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    script.onload = function(){
      if (typeof done === "function") done();
    };
    script.onerror = function(){
      console.warn("[MARU Revenue] failed to load:", src);
    };

    (document.head || document.documentElement).appendChild(script);
  }

  if (window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__) {
    installIfReady();
    return;
  }

  window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__ = true;

  loadScriptOnce(
    "/assets/js/maru-revenue-tracker.js",
    "maruRevenueTrackerScript",
    "MaruRevenueTracker",
    function(){
      loadScriptOnce(
        "/assets/js/maru-revenue-autohook.js",
        "maruRevenueAutoHookScript",
        "MaruRevenueAutoHook",
        installIfReady
      );
    }
  );
})();
