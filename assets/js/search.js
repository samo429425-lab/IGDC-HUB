// IGDC Search.js — FULL SEARCH PIPELINE PATCH
// PATCH: Sanmaru route-owned natural flow + page-lazy rendering + balanced vertical tabs
// - collector first
// - collector search pipeline
// - silent error prevention
// - same-tab navigation
// - block pagination

(function () {
  'use strict';

  function ready(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

ready(function () {
  const p = location.pathname || '';
  const isSearchPage =
    p.endsWith('/search.html') ||
    p.endsWith('/search') ||
    p.endsWith('/search/');

  // 🔥 홈에서도 search.js 동작 허용 (핵심 수정)
  const hasSearchUI =
    document.getElementById('searchInput') ||
    document.getElementById('globalSearchInput') ||
    document.getElementById('homeSearchInput');

  if (!isSearchPage && !hasSearchUI) return;

    const input   = document.getElementById('searchInput') || document.getElementById('globalSearchInput') || document.getElementById('homeSearchInput');
    const btn     = document.getElementById('searchBtn') || document.getElementById('globalSearchBtn') || document.getElementById('homeSearchBtn');
    const statusEl = document.getElementById('searchStatus');
    const resultsEl = document.getElementById('searchResults');
    const status  = statusEl || { textContent: '' };
    const results = resultsEl || document.createElement('div');
        
    if (!input || !btn) return;

    const PAGE_SIZE = 25;
    const BLOCK_SIZE = 10;
    const MAX_PAGER_PAGES = 499;
    const INITIAL_PRELOAD_PAGES = 12;
    const INITIAL_PRELOAD_TARGET = PAGE_SIZE * INITIAL_PRELOAD_PAGES;
    const INITIAL_DOM_RENDER_TARGET = INITIAL_PRELOAD_TARGET;
    const INITIAL_PROGRESSIVE_PAGER_PAGES = 12;
    const MAX_PROGRESSIVE_PAGER_PAGES = 180;
    const MIN_SMOOTH_CANDIDATES = 120;
    const MAX_SMOOTH_CANDIDATES = PAGE_SIZE * MAX_PROGRESSIVE_PAGER_PAGES;
    const FETCH_LIMIT = MAX_SMOOTH_CANDIDATES;
    const INTAKE_CONCURRENCY = 3;
    const INTAKE_BURST_DELAY_MS = 50;

    let allItems = [];
    let serverPagedMode = false;
    let serverTotalItems = 0;
    let authoritativeServerTotalItems = 0;
    let progressivePagerPages = INITIAL_PROGRESSIVE_PAGER_PAGES;
    let continuousIntakeSeq = 0;
    let continuousIntakeActive = false;
    const loadedServerPages = new Map();
    let currentPage = 1;
    let currentBlock = 0;
    let activeType = 'all';
    let lastQuery = '';
    let lastType = 'all';
    let lastSearchPayload = null;
    const pageImageEnrichCache = new Set();
    const itemImageEnrichCache = new Map();
    const expandedDisplayGroups = new Set();

    // SANMARU resident switch:
    // The first search signal warms/activates Sanmaru on the server. Later searches
    // should ask Maru Search to use Sanmaru resident supply first, not re-open every
    // provider from the browser flow. This is non-blocking for page navigation.
    const SANMARU_BOOT_URL = '/.netlify/functions/sanmaru_engine_v2';
    let sanmaruBootPromise = null;

    function sanmaruSignalParams(q, type, reason){
      const sp = new URLSearchParams();
      sp.set('action', 'resident-boot');
      sp.set('reason', reason || 'search-ui');
      sp.set('residentSwitch', '1');
      sp.set('warm', '1');
      if (q) sp.set('q', q);
      if (type) sp.set('type', normalizeSearchType(type));
      return sp;
    }

    function bootSanmaruOnce(reason, q, type){
      if (sanmaruBootPromise) return sanmaruBootPromise;
      try {
        const url = SANMARU_BOOT_URL + '?' + sanmaruSignalParams(q || '', type || activeType || 'all', reason || 'search-ui').toString();
        sanmaruBootPromise = fetch(url, {
          method: 'GET',
          cache: 'no-store',
          keepalive: true
        }).catch(() => null);
      } catch(e) {
        sanmaruBootPromise = Promise.resolve(null);
      }
      return sanmaruBootPromise;
    }

    function signalSanmaruSearch(q, type, reason){
      bootSanmaruOnce(reason || 'search-signal', q, type);
    }

const params = new URLSearchParams(location.search);
const q0 = (params.get('q') || '').trim();
const from0 = (params.get('from') || '').trim();

const SEARCH_TABS = [
  ['all', '전체'],
  ['map', '지도'],
  ['knowledge', '지식'],
  ['wiki', '위키'],
  ['site', '사이트'],
  ['book', '도서'],
  ['blog', '블로그'],
  ['cafe', '카페'],
  ['shopping', '쇼핑'],
  ['news', '뉴스'],
  ['image', '이미지'],
  ['video', '영상'],
  ['sns', '소셜'],
  ['tour', '관광'],
  ['public_data', '공공자료'],
  ['academic', '학술'],
  ['sports', '스포츠'],
  ['finance', '증권'],
  ['webtoon', '웹툰']
];

function normalizeSearchType(v){
  const raw = String(v || '').trim().toLowerCase();
  const allowed = new Set(SEARCH_TABS.map(x => x[0]));
  const alias = { books: 'book', 도서: 'book', 책: 'book', sns: 'sns', social: 'sns', public: 'public_data', 공공자료: 'public_data', wiki: 'wiki', 위키: 'wiki', academic: 'academic', 학술: 'academic', site: 'site', 사이트: 'site' };
  return allowed.has(raw) ? raw : (alias[raw] || 'all');
}

function getTypeLabel(type){
  const hit = SEARCH_TABS.find(x => x[0] === normalizeSearchType(type));
  return hit ? hit[1] : '전체';
}


function ensureSearchCardMediaStyle(){
  if (document.getElementById('maru-search-media-style')) return;

  const style = document.createElement('style');
  style.id = 'maru-search-media-style';
  style.textContent = `
    .maru-search-card-body {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      width: 100%;
    }
    .maru-search-card-text {
      min-width: 0;
      flex: 1 1 auto;
    }
    .maru-card-media {
      flex: 0 0 280px;
      width: 280px;
      max-width: 42%;
      margin-top: 0 !important;
      display: grid;
      gap: 7px;
      overflow: hidden;
      align-self: flex-start;
    }
    .maru-card-media img {
      display: block;
      width: 100%;
      height: 168px;
      object-fit: cover;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #eef2f7;
    }
    .maru-card-media[data-count="1"] {
      grid-template-columns: 1fr;
      flex-basis: 280px;
      width: 280px;
    }
    .maru-card-media[data-count="2"] {
      grid-template-columns: 1fr 1fr;
      flex-basis: 310px;
      width: 310px;
    }
    .maru-card-media[data-count="2"] img {
      height: 154px;
    }
    .maru-card-media[data-count="3"] {
      grid-template-columns: 1.35fr 1fr;
      grid-template-rows: 1fr 1fr;
      flex-basis: 330px;
      width: 330px;
    }
    .maru-card-media[data-count="3"] img:first-child {
      grid-row: 1 / span 2;
      height: 206px;
    }
    .maru-card-media[data-count="3"] img:not(:first-child) {
      height: 99px;
    }

    /* Book / webtoon / shopping-like vertical cover cards */
    .maru-card-media[data-kind="poster"] {
      flex-basis: 150px;
      width: 150px;
      max-width: 24%;
    }
    .maru-card-media[data-kind="poster"] img {
      height: 210px;
      object-fit: cover;
    }

    /* News / article-like cards: slightly wide, readable image */
    .maru-card-media[data-kind="article"] {
      flex-basis: 280px;
      width: 280px;
    }

    /* Image/search-gallery style cards */
    .maru-card-media[data-kind="gallery"] {
      flex-basis: 330px;
      width: 330px;
    }

    .maru-display-section {
      margin: 0 0 12px 0;
      padding: 0;
      border: 1px solid #eef2f7;
      border-radius: 14px;
      background: #ffffff;
      overflow: hidden;
    }
    .maru-display-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      background: linear-gradient(180deg, #ffffff, #f8fafc);
    }
    .maru-display-section-title {
      font-size: 14px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.01em;
    }
    .maru-display-section-meta {
      font-size: 12px;
      font-weight: 700;
      color: #64748b;
      white-space: nowrap;
    }
    .maru-display-section-body {
      padding: 8px 10px 10px;
    }
    .maru-display-section-body > .card {
      margin: 8px 0;
    }
    .maru-display-more {
      width: 100%;
      margin: 8px 0 2px;
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
      background: #f8fafc;
      color: #334155;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
    }
    .maru-display-more:hover {
      background: #eef2ff;
      border-color: #c7d2fe;
      color: #3730a3;
    }
    .maru-display-collapsed-card {
      display: none !important;
    }
    .maru-display-section[data-expanded="1"] .maru-display-collapsed-card {
      display: block !important;
    }
    .maru-display-hidden-wrap {
      margin-top: 6px;
    }
    .maru-display-hidden-wrap > .card {
      margin: 8px 0;
    }
    .maru-video-embed-wrap {
      flex: 0 0 360px;
      width: 360px;
      max-width: 46%;
      aspect-ratio: 16 / 9;
      border-radius: 12px;
      overflow: hidden;
      background: #0f172a;
      border: 1px solid #e5e7eb;
      align-self: flex-start;
    }
    .maru-video-embed-wrap iframe,
    .maru-video-embed-wrap video {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: #000;
      object-fit: cover;
    }

    .maru-map-preview {
      flex: 0 0 330px;
      width: 330px;
      max-width: 46%;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e5e7eb;
      background: #eef2f7;
      align-self: flex-start;
    }
    .maru-map-preview iframe {
      display: block;
      width: 100%;
      height: 190px;
      border: 0;
      background: #e5e7eb;
    }
    .maru-map-preview-caption {
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 800;
      color: #334155;
      background: #ffffff;
      border-top: 1px solid #e5e7eb;
    }

    .maru-video-badge {
      display: inline-block;
      margin-top: 6px;
      padding: 3px 7px;
      border-radius: 999px;
      background: #eef2ff;
      color: #4338ca;
      font-size: 11px;
      font-weight: 800;
    }

    .maru-result-preview {
      margin: 10px 0 4px 0;
      border: 1px solid #dbeafe;
      border-radius: 14px;
      background: #ffffff;
      overflow: hidden;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
    }
    .maru-result-preview-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: linear-gradient(180deg, #f8fbff, #eff6ff);
      border-bottom: 1px solid #dbeafe;
    }
    .maru-result-preview-title {
      min-width: 0;
      font-size: 14px;
      font-weight: 900;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .maru-result-preview-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }
    .maru-result-preview-actions a,
    .maru-result-preview-actions button {
      border: 1px solid #bfdbfe;
      border-radius: 999px;
      background: #ffffff;
      color: #1d4ed8;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 900;
      text-decoration: none;
      cursor: pointer;
    }
    .maru-result-preview-body {
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .maru-result-preview-summary {
      font-size: 14px;
      line-height: 1.62;
      color: #334155;
      white-space: normal;
      word-break: keep-all;
    }
    .maru-result-preview-media {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
    }
    .maru-result-preview-media img {
      width: 100%;
      height: 126px;
      object-fit: cover;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
      background: #f8fafc;
    }
    .maru-result-preview-frame {
      width: 100%;
      height: min(66vh, 760px);
      min-height: 420px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      background: #f8fafc;
    }
    .maru-result-preview-note {
      font-size: 12px;
      line-height: 1.5;
      color: #64748b;
    }


    .maru-search-home-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 9px;
      padding: 8px 17px;
      min-height: 38px;
      border-radius: 11px;
      border: 1px solid rgba(255, 166, 146, 0.92);
      background: linear-gradient(180deg, #ffe3da 0%, #ffcabc 100%);
      color: #2389bd;
      font-size: 20px;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -0.02em;
      text-decoration: none;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(244, 140, 120, 0.20);
      vertical-align: middle;
    }
    .maru-search-home-link:hover {
      color: #156b99;
      background: linear-gradient(180deg, #ffd8cf 0%, #ffb9aa 100%);
      text-decoration: none;
      transform: translateY(-1px);
    }
    .maru-search-header-title {
      white-space: nowrap;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      gap: 0;
    }
    @media (max-width: 720px) {
      .maru-search-home-link {
        min-height: 34px;
        padding: 7px 13px;
        font-size: 17px;
      }
    }

    @media (max-width: 720px) {
      .maru-search-card-body {
        display: block;
      }
      .maru-card-media,
      .maru-map-preview {
        width: 100%;
        max-width: 100%;
        margin-top: 10px !important;
      }
      .maru-card-media img {
        height: 190px;
      }
    }
  `;
  document.head.appendChild(style);
}

ensureSearchCardMediaStyle();


function resolveSearchHomeUrl(){
  try {
    const rawFrom = (new URLSearchParams(location.search).get('from') || '').trim();
    if (rawFrom) {
      const u = new URL(rawFrom, location.origin);
      if (u.origin === location.origin) return u.pathname + u.search + u.hash;
    }
  } catch(e) {}
  return '/';
}

function ensureSearchHeaderHomeLink(){
  if (!isSearchPage || document.getElementById('maru-search-home-title-link')) return;
  try {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node){
        const text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (text === 'IGDC Global Search') return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    const node = walker.nextNode();
    if (!node || !node.parentNode) return;

    const wrap = document.createElement('span');
    wrap.className = 'maru-search-header-title';

    const home = document.createElement('a');
    home.id = 'maru-search-home-title-link';
    home.className = 'maru-search-home-link';
    home.href = resolveSearchHomeUrl();
    home.textContent = 'Home';
    home.setAttribute('aria-label', 'Go to Home');

    wrap.appendChild(home);
    wrap.appendChild(document.createTextNode(' Global Search'));
    node.parentNode.replaceChild(wrap, node);
  } catch(e) {}
}

ensureSearchHeaderHomeLink();


const type0 = normalizeSearchType(params.get('type') || 'all');
activeType = type0;

function getSafeReturnUrl() {
  try {
    const from = (new URLSearchParams(location.search).get('from') || '').trim();
    if (!from) return '';
    const u = new URL(from, location.origin);
    if (u.origin !== location.origin) return '';
    return u.pathname + u.search + u.hash;
  } catch (e) {
    return '';
  }
}

function buildSearchUrl(q) {
  const cleanQ = String(q || '').trim();
  signalSanmaruSearch(cleanQ, 'all', 'home-to-search-handoff');

  const u = new URL('/search.html', location.origin);
  u.searchParams.set('q', cleanQ);
  u.searchParams.set('page', '1');
  u.searchParams.set('block', '0');

  // A fresh query from the homepage/search box must not inherit the previous
  // tab such as type=video. Search page tabs may be clicked after the new
  // query loads.
  u.searchParams.delete('type');
  u.searchParams.set('residentFirst', '1');
  u.searchParams.set('sanmaruFirst', '1');
  u.searchParams.set('residentSwitch', '1');
  u.searchParams.set('handoff', '1');

  const currentFrom = getSafeReturnUrl();
  if (currentFrom) {
    u.searchParams.set('from', currentFrom);
  } else if (!isSearchPage) {
    const fallbackFrom = location.pathname + location.search + location.hash;
    u.searchParams.set('from', fallbackFrom);
  }

  return u.pathname + u.search + u.hash;
}

function ensureSearchHistoryBridge() {
  if (!isSearchPage) return;

  const returnUrl = getSafeReturnUrl();
  if (!returnUrl) return;

  const state = history.state || {};
  if (state && state.__searchBridgeInstalled) return;

  history.replaceState(
    {
      ...(state || {}),
      __searchBridgeInstalled: true,
      __searchEntry: true,
      q: q0 || '',
      from: returnUrl
    },
    '',
    location.href
  );

  history.pushState(
    {
      __searchBridgeMarker: true,
      from: returnUrl
    },
    '',
    location.href
  );
}

function syncSearchFromUrl(run = true) {
  const sp = new URLSearchParams(location.search);
  const qp = (sp.get('q') || '').trim();
  const pageParam = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const blockParam = Math.max(0, parseInt(sp.get('block') || '0', 10) || 0);
  activeType = normalizeSearchType(sp.get('type') || 'all');
  updateSearchTabsActive();

  input.value = qp;

  if (run && qp) {
    runSearch(qp, activeType).then(() => {
      currentPage = pageParam;
      currentBlock = blockParam;
      loadServerPageAndRender(currentPage);
    });
  } else if (run && !qp) {
    allItems = [];
    lastSearchPayload = null;
    results.innerHTML = '';
    clearPager();
    status.textContent = '';
  }
}

window.addEventListener('popstate', (e) => {
  if (!isSearchPage) return;

  const state = e.state || {};

  // 1️⃣ 검색 진입 이전 페이지로 복귀
  if (state.__searchEntry && state.from) {
    location.href = state.from;
    return;
  }

  // 2️⃣ URL 기준으로 항상 복원 (state 의존 제거)
  const sp = new URLSearchParams(location.search);

  const page = Math.max(
    1,
    parseInt(sp.get('page') || state.page || '1', 10) || 1
  );

  const block = Math.max(
    0,
    parseInt(sp.get('block') || state.block || '0', 10) || 0
  );

  const q = (sp.get('q') || state.q || '').trim();
  const nextType = normalizeSearchType(sp.get('type') || state.type || 'all');
  activeType = nextType;
  updateSearchTabsActive();

  // 3️⃣ 검색어 동기화
  if (q && input.value !== q) {
    input.value = q;
  }

  // 4️⃣ 데이터 없거나 검색어/탭이 바뀌면 다시 검색
  if (!allItems || !allItems.length || q !== lastQuery || nextType !== lastType) {
    runSearch(q, nextType).then(() => {
      currentPage = page;
      currentBlock = block;
      loadServerPageAndRender(currentPage);
    });
    return;
  }

  // 5️⃣ 바로 페이지 복원
  currentPage = page;
  currentBlock = block;
  loadServerPageAndRender(currentPage);
});

if (q0) {
  input.value = q0;
}

ensureSearchTabs();
bindRelatedSearchSuggest();
updateSearchTabsActive();

if (q0) {
  signalSanmaruSearch(q0, activeType, 'search-page-url-open');
  syncSearchFromUrl(true);
} else {
  bootSanmaruOnce('search-ui-ready', '', activeType);
  status.textContent = '';
}

btn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  const q = input.value.trim();
  if (!q) return;

  if (isSearchPage) {
    const currentQ = (new URLSearchParams(location.search).get('q') || '').trim();

    if (currentQ === q) {
      const nextType = 'all';
      activeType = nextType;
      updateSearchTabsActive();
      const u = new URL(location.href);
      u.searchParams.set('q', q);
      u.searchParams.set('page', '1');
      u.searchParams.set('block', '0');
      u.searchParams.delete('type');
      u.searchParams.set('residentFirst', '1');
      u.searchParams.set('sanmaruFirst', '1');
      u.searchParams.set('residentSwitch', '1');
      history.pushState({ q, type: nextType, page: 1, block: 0 }, '', u.toString());
      runSearch(q, nextType);
      return;
    }

    const nextType = 'all';
    activeType = nextType;
    updateSearchTabsActive();
    signalSanmaruSearch(q, nextType, 'search-page-new-query');

    const u = new URL(location.href);
    u.searchParams.set('q', q);
    u.searchParams.set('page', '1');
    u.searchParams.set('block', '0');
    u.searchParams.delete('type');
    u.searchParams.set('residentFirst', '1');
    u.searchParams.set('sanmaruFirst', '1');
    u.searchParams.set('residentSwitch', '1');

    const safeReturnUrl = getSafeReturnUrl();
    if (safeReturnUrl) {
      u.searchParams.set('from', safeReturnUrl);
    }

    history.pushState({ q, type: nextType, from: safeReturnUrl || '' }, '', u.toString());
    runSearch(q, nextType);
    return;
  }

  try { window.top.location.href = buildSearchUrl(q); } catch(e) { window.location.assign(buildSearchUrl(q)); }
});

input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;

  e.preventDefault();
  e.stopPropagation();

  const q = input.value.trim();
  if (!q) return;

  if (isSearchPage) {
    const currentQ = (new URLSearchParams(location.search).get('q') || '').trim();

    if (currentQ === q) {
      const nextType = 'all';
      activeType = nextType;
      updateSearchTabsActive();
      const u = new URL(location.href);
      u.searchParams.set('q', q);
      u.searchParams.set('page', '1');
      u.searchParams.set('block', '0');
      u.searchParams.delete('type');
      u.searchParams.set('residentFirst', '1');
      u.searchParams.set('sanmaruFirst', '1');
      u.searchParams.set('residentSwitch', '1');
      history.pushState({ q, type: nextType, page: 1, block: 0 }, '', u.toString());
      runSearch(q, nextType);
      return;
    }

    const nextType = 'all';
    activeType = nextType;
    updateSearchTabsActive();
    signalSanmaruSearch(q, nextType, 'search-page-new-query');

    const u = new URL(location.href);
    u.searchParams.set('q', q);
    u.searchParams.set('page', '1');
    u.searchParams.set('block', '0');
    u.searchParams.delete('type');
    u.searchParams.set('residentFirst', '1');
    u.searchParams.set('sanmaruFirst', '1');
    u.searchParams.set('residentSwitch', '1');

    const safeReturnUrl = getSafeReturnUrl();
    if (safeReturnUrl) {
      u.searchParams.set('from', safeReturnUrl);
    }

    history.pushState({ q, type: nextType, from: safeReturnUrl || '' }, '', u.toString());
    runSearch(q, nextType);
    return;
  }

  try { window.top.location.href = buildSearchUrl(q); } catch(e) { window.location.assign(buildSearchUrl(q)); }
});

function unwrap(x){
  if (!x) return {};
  if (x.data && Array.isArray(x.data.items)) return x.data;
  if (x.baseResult && Array.isArray(x.baseResult.items)) return x.baseResult;
  if (x.baseResult && x.baseResult.data && Array.isArray(x.baseResult.data.items)) return x.baseResult.data;
  return x;
}

function normalizeItems(payload){

  if (!payload) return [];

  if (Array.isArray(payload.items)) return payload.items;

  if (payload.data && Array.isArray(payload.data)) return payload.data;

  if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;

  if (Array.isArray(payload.results)) return payload.results;

  if (payload.baseResult && Array.isArray(payload.baseResult.items)) {
    return payload.baseResult.items;
  }

  if (payload.baseResult && payload.baseResult.data && Array.isArray(payload.baseResult.data.items)) {
    return payload.baseResult.data.items;
  }

  const d = unwrap(payload) || {};

  if (Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.results)) return d.results;

  return [];
}


function normalizeSearchPayload(payload){
  const root = unwrap(payload) || payload || {};
  const items = normalizeItems(root);
  const pageItems =
    (root.visiblePagePack && Array.isArray(root.visiblePagePack.pageItems) && root.visiblePagePack.pageItems) ||
    (Array.isArray(root.pageItems) && root.pageItems) ||
    (root.sectionPack && Array.isArray(root.sectionPack.pageItems) && root.sectionPack.pageItems) ||
    [];
  const viewportSections =
    (Array.isArray(root.viewportSections) && root.viewportSections) ||
    (root.sectionPack && Array.isArray(root.sectionPack.viewportSections) && root.sectionPack.viewportSections) ||
    (Array.isArray(root.displaySections) && root.displaySections) ||
    [];
  return { payload: root, items, pageItems, viewportSections };
}

function serverTotalFromPayload(payload, fallbackCount){
  const root = unwrap(payload) || payload || {};
  const meta = root.meta || {};
  const vp = root.visiblePagePack || meta.viewport || (root.sectionPack && root.sectionPack.visiblePagePack) || {};
  const total = Number(
    vp.totalVisibleItems ||
    vp.fullCandidateCount ||
    meta.totalCandidates ||
    meta.fullCandidateCount ||
    meta.totalItems ||
    root.totalCandidates ||
    root.totalItems ||
    fallbackCount ||
    0
  ) || 0;
  const cappedTotal = Math.min(Math.max(total, fallbackCount || 0), MAX_PAGER_PAGES * PAGE_SIZE);
  return cappedTotal;
}

function pageItemsFromPack(pack){
  if(!pack) return [];
  if(Array.isArray(pack.pageItems) && pack.pageItems.length) return pack.pageItems;
  const payload = pack.payload || pack;
  if(payload && payload.visiblePagePack && Array.isArray(payload.visiblePagePack.pageItems) && payload.visiblePagePack.pageItems.length) return payload.visiblePagePack.pageItems;
  if(payload && Array.isArray(payload.pageItems) && payload.pageItems.length) return payload.pageItems;
  return Array.isArray(pack.items) ? pack.items.slice(0, PAGE_SIZE) : [];
}

function preloadPageCountFromItems(items){
  return Math.max(1, Math.ceil((Array.isArray(items) ? items.length : 0) / PAGE_SIZE));
}

function adaptiveSearchTarget(q, type){
  const text = String(q || '').trim().toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const safeType = normalizeSearchType(type || activeType || 'all');
  const broadHints = /(세계|전세계|글로벌|뉴스|영상|이미지|관광|여행|ai|인공지능|기술|시장|경제|정치|스포츠|금융|도서|쇼핑|웹툰|공공|학술|논문|사이트|홈페이지|global|world|news|tour|travel|technology|market|sports|finance|book|shopping|webtoon)/i;
  const narrowHints = /(카페|맛집|식당|주소|전화|위치|지도|병원|약국|학교|교회|상호|주차|near me|cafe|restaurant|address|map)/i;

  // Search.js remains only a receiver/container. This target is the amount of
  // Sanmaru/MaruSearch supply the UI is ready to cache for search pages. It is
  // separate from the 4,500~5,000 Search Bank Snapshot supply used by front pages.
  // Broad searches may keep filling up to 4,500 candidates, while first paint
  // still renders only the current viewport and uses continuous intake for the rest.
  let target = 3200;
  if (safeType === 'all') target = 4500;
  if (safeType !== 'all') target = 2400;
  if (words.length >= 3 || narrowHints.test(text)) target = Math.max(target, 2400);
  if (words.length <= 1 || broadHints.test(text)) target = 4500;
  if (/^(news|image|video|sns|blog|cafe|tour|site|academic|wiki|public_data)$/.test(safeType)) target = Math.max(target, 3000);
  if (/^(map|knowledge|book|shopping|sports|finance|webtoon)$/.test(safeType)) target = Math.max(2200, Math.min(target, 3200));

  return Math.max(INITIAL_PRELOAD_TARGET, Math.min(MAX_SMOOTH_CANDIDATES, target));
}

function firstPaintLimitFor(q, type){
  // Keep the UI first paint light, but ask Sanmaru for the first 12 pages of
  // already-prepared resident candidates. The DOM still renders only the
  // current viewport; the extra candidates keep the initial pager at 10~12 pages
  // and let page navigation feel immediate.
  return Math.min(INITIAL_PRELOAD_TARGET, adaptiveSearchTarget(q, type));
}

function seedLoadedServerPagesFromItems(items, maxItems){
  const list = Array.isArray(items) ? items : [];
  const limit = Math.min(list.length, maxItems || INITIAL_DOM_RENDER_TARGET);
  for(let offset = 0; offset < limit; offset += PAGE_SIZE){
    const pageNo = Math.floor(offset / PAGE_SIZE) + 1;
    const slice = list.slice(offset, offset + PAGE_SIZE);
    if(slice.length) loadedServerPages.set(pageNo, slice);
  }
}

function updateProgressiveTotalFromPayload(payload, fallbackCount, opts){
  const total = serverTotalFromPayload(payload, fallbackCount || 0);
  authoritativeServerTotalItems = Math.max(authoritativeServerTotalItems || 0, total || 0, fallbackCount || 0);
  const minPages = Math.max(INITIAL_PROGRESSIVE_PAGER_PAGES, preloadPageCountFromItems(allItems));
  const wantedPages = Math.max(minPages, Math.ceil((authoritativeServerTotalItems || fallbackCount || 0) / PAGE_SIZE));
  const previousPages = Math.max(progressivePagerPages || 0, Math.ceil((serverTotalItems || 0) / PAGE_SIZE));
  const nextPages = opts && opts.expandAll
    ? Math.min(MAX_PROGRESSIVE_PAGER_PAGES, wantedPages)
    : Math.min(MAX_PROGRESSIVE_PAGER_PAGES, Math.max(minPages, previousPages, Math.min(wantedPages, previousPages + 8 || minPages)));
  progressivePagerPages = Math.max(minPages, nextPages);
  serverTotalItems = Math.max(serverTotalItems || 0, Math.min(authoritativeServerTotalItems || 0, progressivePagerPages * PAGE_SIZE));
  return serverTotalItems;
}

function stopContinuousIntake(){
  continuousIntakeSeq += 1;
  continuousIntakeActive = false;
}

function sleepIntake(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startContinuousIntake(q, type, seq){
  if(!q || runSearch._seq !== seq) return;
  const token = ++continuousIntakeSeq;
  continuousIntakeActive = true;
  const target = adaptiveSearchTarget(q, type);
  authoritativeServerTotalItems = Math.max(authoritativeServerTotalItems || 0, target);
  updateProgressiveTotalFromPayload(lastSearchPayload || {}, Math.max(target, allItems.length || 0));

  let nextPage = Math.max(2, preloadPageCountFromItems(allItems) + 1);
  const maxPages = Math.min(MAX_PROGRESSIVE_PAGER_PAGES, Math.max(INITIAL_PROGRESSIVE_PAGER_PAGES, Math.ceil(target / PAGE_SIZE)));

  async function worker(){
    while(continuousIntakeActive && continuousIntakeSeq === token && runSearch._seq === seq && nextPage <= maxPages){
      const page = nextPage++;
      if(loadedServerPages.has(page)) continue;
      try{
        const pack = await fetchSearch(q, type, page);
        if(!continuousIntakeActive || continuousIntakeSeq !== token || runSearch._seq !== seq) return;
        const pageSlice = dedupeItems(filterSearchResultItems(pageItemsFromPack(pack))).slice(0, PAGE_SIZE);
        if(pageSlice.length){
          loadedServerPages.set(page, pageSlice);
          allItems = mergeItemsPreferDisplayRichness(allItems, pageSlice);
          lastSearchPayload = pack && pack.payload || lastSearchPayload;
          updateProgressiveTotalFromPayload(pack && pack.payload, allItems.length);
          if(page === currentPage) renderPage(page, true);
          else drawPager();
          status.textContent = `${serverTotalItems || allItems.length} results for "${q}" · ${getTypeLabel(type)} · receiving...`;
        }
      }catch(e){
        console.warn('continuous intake page skipped:', page, e);
      }
      await sleepIntake(INTAKE_BURST_DELAY_MS);
    }
  }

  for(let i = 0; i < INTAKE_CONCURRENCY; i++) worker();
}

    function safeText(v){
      return String(v || '').toLowerCase();
    }

    function matchesBankItem(it, q){
      const qq = safeText(q);
      const haystack = [
        it.title,
        it.summary,
        it.description,
        it.url,
        it.link,
        it.channel,
        it.section,
        it.lang,
        it.source?.name,
        it.source?.platform,
        it.bind?.page,
        it.bind?.section,
        it.bind?.psom_key,
        Array.isArray(it.tags) ? it.tags.join(' ') : '',
        it.producer?.name,
        it.geo?.country,
        it.geo?.state,
        it.geo?.city
      ].map(safeText).join(' ');
      return haystack.includes(qq);
    }

   function dedupeItems(items){
  const out = [];
  const seen = new Set();

  for (const it of Array.isArray(items) ? items : []) {
    const rawUrl = String(it?.url || it?.link || '').trim();
    const normUrl = rawUrl.toLowerCase();

    const isPlaceholderUrl =
      !rawUrl ||
      rawUrl === '#' ||
      rawUrl === '/' ||
      normUrl === 'javascript:void(0)' ||
      normUrl.startsWith('javascript:');

    const key = (
      !isPlaceholderUrl
        ? rawUrl
        : (String(it?.id || '').trim() ||
           ((String(it?.title || '').trim()) + '|' + String(it?.source?.name || it?.source || '').trim()))
    ).toLowerCase();

    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }

  return out;
}

function searchDisplayKeyForItem(it){
  if(!it) return '';
  const rawUrl = String(it.url || it.link || it.openUrl || '').trim();
  const normUrl = rawUrl.toLowerCase();
  const isPlaceholderUrl =
    !rawUrl ||
    rawUrl === '#' ||
    rawUrl === '/' ||
    normUrl === 'javascript:void(0)' ||
    normUrl.startsWith('javascript:');

  if(!isPlaceholderUrl) return normUrl;
  return String(
    it.id || it.indexId || it.originalId ||
    ((String(it.title || it.name || '').trim()) + '|' + String((it.source && (it.source.name || it.source.platform)) || it.source || it.provider || '').trim())
  ).toLowerCase();
}

function displayRichnessScore(it){
  if(!it || typeof it !== 'object') return 0;
  let score = 0;
  const card = (it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
  const media = (it.media && typeof it.media === 'object') ? it.media : {};
  const preview = (media.preview && typeof media.preview === 'object') ? media.preview : {};
  const summaryText = [
    card.summary, card.description, card.body, card.text,
    it.displaySummary, it.summary, it.snippet, it.description, it.contentSnippet,
    it.excerpt, it.abstract, it.text, it.content, it.metaDescription, it.ogDescription
  ].map(v => String(v || '').trim()).filter(Boolean).join(' ');
  if(summaryText.length >= 18) score += Math.min(40, Math.floor(summaryText.length / 12));
  if(card && Object.keys(card).length) score += 18;
  if(card.showMapPreview || it.__maruAllowMapPreview || it.mapQuery || it.placeInfo) score += 20;
  if(card.thumbnail || card.image || (Array.isArray(card.imageSet) && card.imageSet.length)) score += 25;
  if(it.thumbnail || it.thumb || it.image || it.ogImage || it.og_image || (Array.isArray(it.imageSet) && it.imageSet.length)) score += 20;
  if(preview.thumbnail || preview.image || preview.poster || preview.mp4 || preview.webm) score += 18;
  if(it.videoId || it.videoUrl || it.embedUrl || /youtube|youtu\.be|ytimg/i.test(String([it.url, it.link, it.thumbnail, it.image].join(' ')))) score += 14;
  return score;
}

function mergeItemsPreferDisplayRichness(baseItems, incomingItems){
  const out = [];
  const pos = new Map();
  function addOrMerge(it){
    if(!it) return;
    const key = searchDisplayKeyForItem(it);
    if(!key) return;
    if(!pos.has(key)){
      pos.set(key, out.length);
      out.push(it);
      return;
    }
    const idx = pos.get(key);
    const prev = out[idx];
    const merged = Object.assign({}, prev || {}, it || {});
    const prevScore = displayRichnessScore(prev);
    const nextScore = displayRichnessScore(it);
    out[idx] = nextScore >= prevScore ? merged : Object.assign({}, it || {}, prev || {});
  }
  (Array.isArray(baseItems) ? baseItems : []).forEach(addOrMerge);
  (Array.isArray(incomingItems) ? incomingItems : []).forEach(addOrMerge);
  return out;
}

async function fetchSearch(q, type = activeType, page = 1){
  const safeType = normalizeSearchType(type);
  signalSanmaruSearch(q, safeType, 'maru-search-fetch');

  const pageNo = Math.max(1, Number(page) || 1);
  const fullCandidateTarget = adaptiveSearchTarget(q, safeType);
  const firstWindowTarget = firstPaintLimitFor(q, safeType);
  const responseLimit = pageNo <= 1
    ? firstWindowTarget
    : Math.min(fullCandidateTarget, Math.max(firstWindowTarget, pageNo * PAGE_SIZE + PAGE_SIZE));

  const sp = new URLSearchParams();
  sp.set('q', q);
  // First paint must be a 300-card window, not a 3,000~4,500-card wait.
  // The full target is still passed separately so Maru/Sanmaru can keep filling
  // the faucet behind the visible page.
  sp.set('limit', String(responseLimit));
  sp.set('candidatePoolTarget', String(fullCandidateTarget));
  sp.set('fullCandidateTarget', String(fullCandidateTarget));
  sp.set('firstPaintLimit', String(firstWindowTarget));
  sp.set('initialResponseWindow', String(firstWindowTarget));
  sp.set('type', safeType);
  sp.set('tab', safeType);
  sp.set('perPage', String(PAGE_SIZE));
  sp.set('visibleCardsPerPage', String(PAGE_SIZE));
  sp.set('page', String(pageNo));
  sp.set('visiblePage', String(pageNo));
  sp.set('pageWindowOnly', '1');
  sp.set('fastFirstPaint', '1');
  sp.set('responseWindow', '1');
  sp.set('residentFirst', '1');
  sp.set('sanmaruFirst', '1');
  sp.set('routeOwner', 'sanmaru');
  sp.set('naturalFlow', '1');
  sp.set('smoothIntake', '1');
  sp.set('noBlockingWide', '1');
  sp.set('residentSwitch', '1');
  sp.set('activateResident', '1');
  sp.set('handoff', isSearchPage ? 'search-html' : 'home');
  const url = `/.netlify/functions/maru-search?${sp.toString()}`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { items: [], payload: null, pageItems: [], viewportSections: [] };

    const json = await r.json();
    if (!json) return { items: [], payload: null, pageItems: [], viewportSections: [] };
    if (json.status === 'error') return { items: [], payload: json, pageItems: [], viewportSections: [] };
    if (json.status === 'blocked') return { items: [], payload: json, pageItems: [], viewportSections: [] };

    return normalizeSearchPayload(json);
  } catch (e) {
    console.error('fetchSearch failed:', e);
    return { items: [], payload: null, pageItems: [], viewportSections: [] };
  }
}

async function fetchInstantSearchPack(q, type = activeType){
  const safeType = normalizeSearchType(type);
  const sp = new URLSearchParams();
  sp.set('action', 'instant-supply');
  sp.set('q', q);
  sp.set('query', q);
  sp.set('type', safeType);
  sp.set('tab', safeType);
  sp.set('limit', String(firstPaintLimitFor(q, safeType)));
  sp.set('firstPaintLimit', String(firstPaintLimitFor(q, safeType)));
  sp.set('candidatePool', String(firstPaintLimitFor(q, safeType)));
  sp.set('candidatePoolTarget', String(firstPaintLimitFor(q, safeType)));
  sp.set('fullCandidateTarget', String(adaptiveSearchTarget(q, safeType)));
  sp.set('fastFirstPaint', '1');
  sp.set('responseWindow', '1');
  sp.set('initialPreloadPages', String(INITIAL_PRELOAD_PAGES));
  sp.set('initialPreloadTarget', String(INITIAL_PRELOAD_TARGET));
  sp.set('perPage', String(PAGE_SIZE));
  sp.set('visibleCardsPerPage', String(PAGE_SIZE));
  sp.set('providerPassthrough', '1');
  sp.set('residentFirst', '1');
  sp.set('sanmaruFirst', '1');
  sp.set('reason', 'search-ui-first-paint');

  try {
    const r = await fetch(`${SANMARU_BOOT_URL}?${sp.toString()}`, { cache: 'no-store' });
    if (!r.ok) return { items: [], payload: null, pageItems: [], viewportSections: [] };
    const json = await r.json();
    if (!json || json.status === 'error' || json.status === 'blocked') return { items: [], payload: json || null, pageItems: [], viewportSections: [] };
    return normalizeSearchPayload(json);
  } catch (e) {
    console.warn('fetchInstantSearchPack failed:', e);
    return { items: [], payload: null, pageItems: [], viewportSections: [] };
  }
}

    function renderSkeleton(count = 6){
      results.innerHTML = '';
      for (let i = 0; i < count; i++){
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div style="padding:12px 0">
            <div style="height:14px;width:60%;background:#eee;margin-bottom:6px"></div>
            <div style="height:11px;width:40%;background:#f0f0f0;margin-bottom:6px"></div>
            <div style="height:12px;width:90%;background:#f5f5f5"></div>
          </div>
        `;
        results.appendChild(card);
      }
    }




    function isLikelySearchInputElement(el){
      if(!el || !el.tagName || String(el.tagName).toLowerCase() !== 'input') return false;
      const id = String(el.id || '').toLowerCase();
      const name = String(el.name || '').toLowerCase();
      const cls = String(el.className || '').toLowerCase();
      const ph = String(el.getAttribute('placeholder') || '').toLowerCase();
      const role = String(el.getAttribute('role') || '').toLowerCase();
      const type = String(el.type || '').toLowerCase();
      return el === input || id.includes('search') || name.includes('search') || cls.includes('search') || ph.includes('검색') || ph.includes('search') || role === 'searchbox' || type === 'search';
    }

    function runGlobalSearch(){
      const anchor = activeSuggestInput || input;
      const q = (anchor && anchor.value ? anchor.value : input.value || '').trim();
      if(!q) return;
      if(anchor && anchor !== input) input.value = q;
      if(isSearchPage){
        const nextType = 'all';
        activeType = nextType;
        updateSearchTabsActive();
        const u = new URL(location.href);
        u.searchParams.set('q', q);
        u.searchParams.set('page', '1');
        u.searchParams.set('block', '0');
        u.searchParams.delete('type');
        u.searchParams.set('residentFirst', '1');
        u.searchParams.set('sanmaruFirst', '1');
        u.searchParams.set('residentSwitch', '1');
        const safeReturnUrl = getSafeReturnUrl();
        if(safeReturnUrl) u.searchParams.set('from', safeReturnUrl);
        history.pushState({ q, type: nextType, from: safeReturnUrl || '' }, '', u.toString());
        runSearch(q, nextType);
      } else {
        try { window.top.location.href = buildSearchUrl(q); } catch(e) { window.location.assign(buildSearchUrl(q)); }
      }
    }

    function ensureRelatedSearchSuggestStyle(){
      if(document.getElementById('maru-related-search-style')) return;
      const style = document.createElement('style');
      style.id = 'maru-related-search-style';
      style.textContent = `
        #maru-related-suggest-box {
          position: fixed;
          z-index: 9999;
          display: none;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16);
          padding: 8px;
          max-height: 420px;
          overflow-y: auto;
        }
        #maru-related-suggest-box[data-open="1"] { display: block; }
        .maru-related-suggest-row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 12px;
          border: 0;
          border-radius: 10px;
          background: transparent;
          color: #111827;
          cursor: pointer;
          text-align: left;
          font-size: 14px;
          font-weight: 700;
        }
        .maru-related-suggest-row:hover,
        .maru-related-suggest-row:focus { background: #f3f4f6; outline: none; }
        .maru-related-suggest-icon {
          flex: 0 0 auto;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 13px;
        }
        .maru-related-suggest-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .maru-related-suggest-caption {
          padding: 7px 12px 5px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }
      `;
      document.head.appendChild(style);
    }

    function ensureRelatedSuggestBox(){
      ensureRelatedSearchSuggestStyle();
      let box = document.getElementById('maru-related-suggest-box');
      if(box) return box;
      box = document.createElement('div');
      box.id = 'maru-related-suggest-box';
      box.setAttribute('role', 'listbox');
      document.body.appendChild(box);
      return box;
    }

    let activeSuggestInput = input;

    function positionRelatedSuggestBox(targetInput){
      const box = ensureRelatedSuggestBox();
      const anchor = targetInput || activeSuggestInput || input;
      if(!anchor || !box) return;
      const r = anchor.getBoundingClientRect();
      box.style.left = Math.max(8, r.left) + 'px';
      box.style.top = (r.bottom + 6) + 'px';
      box.style.width = Math.max(280, r.width) + 'px';
    }

    function relatedSearchTermsFor(q){
      const base = String(q || '').trim().replace(/\s+/g, ' ');
      if(!base) return [];
      const lower = base.toLowerCase();
      const broadPlace = /서울|부산|대구|인천|광주|대전|울산|제주|대한민국|한국|뉴욕|도쿄|오사카|파리|런던|베트남|하노이|호치민|seoul|busan|korea|new york|tokyo|paris|london|vietnam/.test(lower);
      const foodOrLocal = /카페|맛집|식당|시장|호텔|숙소|관광|여행|축제|공원|박물관|cafe|restaurant|hotel|market|travel|tour/.test(lower);
      const mediaIntent = /영상|영화|드라마|음악|유튜브|쇼츠|sns|video|movie|youtube|shorts/.test(lower);
      let suffixes;
      if(mediaIntent){
        suffixes = ['유튜브', '쇼츠', '영상', '뉴스', '인스타그램', '틱톡', '블로그', '이미지', '리뷰', '추천'];
      }else if(foodOrLocal || broadPlace){
        suffixes = ['지도', '날씨', '맛집', '카페', '볼만한 곳', '관광', '여행 코스', '축제', '호텔', '교통', '뉴스', '블로그', '유튜브', '이미지'];
      }else{
        suffixes = ['뜻', '뉴스', '이미지', '영상', '블로그', '리뷰', '가격', '방법', '추천', '비교', '공식', '위키'];
      }
      const out = [];
      const seen = new Set();
      suffixes.forEach(s => {
        const term = `${base} ${s}`.trim();
        const key = term.toLowerCase();
        if(key !== lower && !seen.has(key)){
          seen.add(key); out.push(term);
        }
      });
      return out.slice(0, 12);
    }

    function hideRelatedSuggestBox(){
      const box = document.getElementById('maru-related-suggest-box');
      if(box) box.dataset.open = '0';
    }

    function showRelatedSuggestBox(targetInput){
      const anchor = targetInput || activeSuggestInput || input;
      activeSuggestInput = anchor || input;
      const q = anchor ? anchor.value.trim() : '';
      const terms = relatedSearchTermsFor(q);
      const box = ensureRelatedSuggestBox();
      if(!q || !terms.length){ hideRelatedSuggestBox(); return; }
      box.innerHTML = '';
      const cap = document.createElement('div');
      cap.className = 'maru-related-suggest-caption';
      cap.textContent = '연관 검색어';
      box.appendChild(cap);
      terms.forEach(term => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'maru-related-suggest-row';
        row.setAttribute('role', 'option');
        const icon = document.createElement('span');
        icon.className = 'maru-related-suggest-icon';
        icon.textContent = '⌕';
        const text = document.createElement('span');
        text.className = 'maru-related-suggest-text';
        text.textContent = term;
        row.appendChild(icon);
        row.appendChild(text);
        row.addEventListener('mousedown', e => e.preventDefault());
        row.addEventListener('click', () => {
          const anchor = activeSuggestInput || input;
          if(anchor) anchor.value = term;
          if(anchor && anchor !== input) input.value = term;
          hideRelatedSuggestBox();
          runGlobalSearch();
        });
        box.appendChild(row);
      });
      positionRelatedSuggestBox(anchor);
      box.dataset.open = '1';
    }

    function bindRelatedSearchSuggest(){
      const selector = [
        '#searchInput',
        '#globalSearchInput',
        '#homeSearchInput',
        '#mainSearchInput',
        '#heroSearchInput',
        'input[type="search"]',
        'input[data-search-input]',
        'input[name*="search" i]',
        'input[id*="search" i]',
        'input[class*="search" i]',
        'input[placeholder*="검색" i]',
        'input[placeholder*="search" i]'
      ].join(',');

      const targets = Array.from(new Set([input].concat(Array.from(document.querySelectorAll(selector))).filter(Boolean)))
        .filter(isLikelySearchInputElement);

      targets.forEach(target => {
        if(target.__maruRelatedSuggestBound) return;
        target.__maruRelatedSuggestBound = true;
        target.addEventListener('input', () => { activeSuggestInput = target; showRelatedSuggestBox(target); });
        target.addEventListener('focus', () => { activeSuggestInput = target; showRelatedSuggestBox(target); });
        target.addEventListener('blur', () => setTimeout(hideRelatedSuggestBox, 160));
        target.addEventListener('keydown', e => {
          if(e.key === 'Escape') hideRelatedSuggestBox();
          if(e.key === 'Enter') {
            activeSuggestInput = target;
            hideRelatedSuggestBox();
          }
        });
      });

      if(!bindRelatedSearchSuggest.__windowBound){
        bindRelatedSearchSuggest.__windowBound = true;
        window.addEventListener('resize', () => positionRelatedSuggestBox(activeSuggestInput));
        window.addEventListener('scroll', () => positionRelatedSuggestBox(activeSuggestInput), true);
        document.addEventListener('input', e => {
          const target = e.target;
          if(!isLikelySearchInputElement(target)) return;
          activeSuggestInput = target;
          showRelatedSuggestBox(target);
        }, true);
        document.addEventListener('focusin', e => {
          const target = e.target;
          if(!isLikelySearchInputElement(target)) return;
          activeSuggestInput = target;
          showRelatedSuggestBox(target);
          bindRelatedSearchSuggest();
        });
        try {
          const mo = new MutationObserver(() => bindRelatedSearchSuggest());
          mo.observe(document.body, { childList: true, subtree: true });
        } catch(e) {}
        setTimeout(bindRelatedSearchSuggest, 500);
        setTimeout(bindRelatedSearchSuggest, 1500);
      }
    }

    function ensureSearchTabs(){
      if (!isSearchPage) return null;
      let bar = document.getElementById('maru-search-tabs');
      if (bar) return bar;

      bar = document.createElement('div');
      bar.id = 'maru-search-tabs';
      bar.style.display = 'flex';
      bar.style.alignItems = 'center';
      bar.style.gap = '8px';
      bar.style.overflowX = 'auto';
      bar.style.whiteSpace = 'nowrap';
      bar.style.padding = '10px 24px 8px';
      bar.style.borderBottom = '1px solid #eef2f7';
      bar.style.background = '#fff';
      bar.style.position = 'sticky';
      bar.style.top = '65px';
      bar.style.zIndex = '90';

      SEARCH_TABS.forEach(([type, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.type = type;
        b.textContent = label;
        b.style.padding = '8px 13px';
        b.style.borderRadius = '999px';
        b.style.border = '1px solid #e5e7eb';
        b.style.background = '#f8fafc';
        b.style.color = '#111827';
        b.style.fontSize = '14px';
        b.style.fontWeight = '600';
        b.style.cursor = 'pointer';
        b.onclick = () => switchSearchType(type);
        bar.appendChild(b);
      });

      status.parentNode.insertBefore(bar, status);
      return bar;
    }

    function updateSearchTabsActive(){
      const bar = document.getElementById('maru-search-tabs');
      if (!bar) return;
      const type = normalizeSearchType(activeType);
      Array.from(bar.querySelectorAll('button[data-type]')).forEach(btn => {
        const on = btn.dataset.type === type;
        btn.style.background = on ? '#4f46e5' : '#f8fafc';
        btn.style.color = on ? '#fff' : '#111827';
        btn.style.borderColor = on ? '#4f46e5' : '#e5e7eb';
      });
    }

    function switchSearchType(type){
      activeType = normalizeSearchType(type);
      updateSearchTabsActive();

      const q = input.value.trim() || (new URLSearchParams(location.search).get('q') || '').trim();
      if (!q) return;

      const u = new URL(location.href);
      u.searchParams.set('q', q);
      u.searchParams.set('page', '1');
      u.searchParams.set('block', '0');
      if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
      else u.searchParams.delete('type');

      history.pushState({ q, type: activeType, page: 1, block: 0 }, '', u.toString());
      runSearch(q, activeType);
    }

    function clearPager(){
      const bar = document.getElementById('maru-page-controls');
      if (bar) bar.remove();
    }

    function ensurePager(){
      let bar = document.getElementById('maru-page-controls');
      if (!bar){
        bar = document.createElement('div');
        bar.id = 'maru-page-controls';
        bar.style.display = 'flex';
        bar.style.alignItems = 'center';
        bar.style.justifyContent = 'center';
        bar.style.gap = '6px';
        bar.style.margin = '8px 0 14px';
        status.parentNode.insertBefore(bar, status.nextSibling);
      }
      return bar;
    }

    function domainOf(url){
      try { return new URL(url).hostname.replace(/^www\./,''); }
      catch(e){ return ''; }
    }

    function faviconOf(url){
      const d = domainOf(url);
      return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : '';
    }


    function isHardRejectImageUrlClient(imageUrl){
      const s = String(imageUrl || '').toLowerCase();
      if(!s) return true;

      const hardBad = [
        'google.com/s2/favicons',
        'favicon',
        'apple-touch-icon',
        '.ico',
        'placeholder',
        'noimage',
        'no_image',
        'no-img',
        'default-image',
        'default_img',
        'sprite',
        'spacer',
        'blank.gif',
        'blank.png',
        'transparent',
        '1x1',
        'pixel',
        'tracking',
        'analytics',
        'captcha',
        'staticmap',
        'maps.googleapis.com',
        'map.naver.com',
        'naver_map',
        '/maps/',
        '/map/',
        'map_tile',
        'tile.openstreetmap',
        'banner',
        'placard',
        'adserver',
        'doubleclick',
        'advertisement',
        'promo-banner'
      ];

      if(hardBad.some(k => s.includes(k))) return true;
      if(/\.(ico)(\?|#|$)/i.test(s)) return true;
      if(/\.(svg)(\?|#|$)/i.test(s) && /(logo|symbol|icon|emblem|brand|ci|bi)/i.test(s)) return true;

      // Brand/logo images must not be promoted as large media snapshots.
      // Keep the small favicon in the link row, but reject logos from card media.
      const logoLike = /(^|[\/_\-.])(logo|logotype|brand|symbol|emblem|ci|bi)([\/_\-.]|$)/i.test(s) ||
        /(naver|google|youtube|tiktok|facebook|instagram|twitter|x)[^?#]*(logo|brand|symbol|favicon)/i.test(s);
      if(logoLike) return true;

      return false;
    }

    function isLikelyMeaninglessImageUrlClient(imageUrl){
      // Conservative filter: reject only clear non-content images.
      // Do not reject provider thumbnails just because their URL contains
      // brand/banner/thumb/small, since many real news/tour/company images do.
      return isHardRejectImageUrlClient(imageUrl);
    }

    function isGenericGovOfficialItemClient(it){
      // Official/government pages often have valid representative images.
      // Do not block them on the client; maru-search already filters hard rejects.
      return false;
    }

    function isMapImageUrlClient(imageUrl){
      const s = String(imageUrl || '').toLowerCase();
      return /staticmap|maps\.googleapis|google\.com\/maps|map\.naver\.com|naver_map|\/maps\/|\/map\/|map_tile|tile\.openstreetmap/.test(s);
    }

    function isProviderLogoOrBannerImageClient(imageUrl, it){
      const s = String(imageUrl || '').toLowerCase();
      const host = (() => { try { return new URL(s, location.origin).hostname.toLowerCase(); } catch(e){ return ''; } })();
      const titleSummary = String([it && it.title, it && it.summary, it && it.description].filter(Boolean).join(' ')).toLowerCase();
      if(/google\.com\/s2\/favicons|favicon|apple-touch-icon|logo|logotype|brandmark|symbol|emblem|\/ci[\/_-]|\/bi[\/_-]/i.test(s)) return true;
      if(/(naver|google|youtube|facebook|instagram|tiktok|twitter|x)[^?#]*(logo|favicon|brand|symbol|icon)/i.test(s)) return true;
      if(/banner|placard|adserver|doubleclick|advertisement|promo-banner|popup/i.test(s)) return true;
      if(/banner|placard|현수막|배너|광고/.test(titleSummary) && !/news|article|photo|image|youtube|ytimg|sns|instagram|tiktok/i.test(host + ' ' + s)) return true;
      return false;
    }

    function isMeaningfulImageForItemClient(imageUrl, it){
      const s = String(imageUrl || '').trim();
      if(!s) return false;
      if(!/^https?:\/\//i.test(s) && !s.startsWith('/')) return false;
      if(isHardRejectImageUrlClient(s)) return false;
      if(isMapImageUrlClient(s)) return false;
      if(isProviderLogoOrBannerImageClient(s, it)) return false;
      return true;
    }


    function extractYouTubeIdQuickClient(v){
      const raw = String(v || '').trim();
      if (!raw) return '';
      const m =
        raw.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
        raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
        raw.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/) ||
        raw.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/) ||
        raw.match(/(?:i\.ytimg\.com|img\.youtube\.com)\/vi\/([A-Za-z0-9_-]{11})/);
      return m ? String(m[1] || '').trim() : '';
    }

    function isYoutubeLikeItemClient(it){
      const hay = [
        it && it.source,
        it && it.type,
        it && it.mediaType,
        it && it.url,
        it && it.link,
        it && it.videoUrl,
        it && it.watchUrl,
        it && it.embedUrl,
        it && it.thumbnail,
        it && it.thumb,
        it && it.image,
        Array.isArray(it && it.imageSet) ? it.imageSet.join(' ') : ''
      ].join(' ').toLowerCase();
      return hay.includes('youtube') || hay.includes('youtu.be') || hay.includes('ytimg.com') || hay.includes('img.youtube.com');
    }

    function preferredYoutubeThumbClient(it){
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const candidates = [
        displayCard.videoId,
        displayCard.videoUrl,
        displayCard.watchUrl,
        displayCard.embedUrl,
        displayCard.thumbnail,
        displayCard.image,
        it && it.videoId,
        it && it.url,
        it && it.link,
        it && it.videoUrl,
        it && it.watchUrl,
        it && it.embedUrl,
        it && it.thumbnail,
        it && it.thumb,
        it && it.image
      ]
        .concat(Array.isArray(displayCard.imageSet) ? displayCard.imageSet : [])
        .concat(Array.isArray(it && it.imageSet) ? it.imageSet : []);

      for (const v of candidates) {
        const id = String(v || '').length === 11 && /^[A-Za-z0-9_-]{11}$/.test(String(v || ''))
          ? String(v)
          : extractYouTubeIdQuickClient(v);
        if (id) return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
      }
      return '';
    }

    function collectNaturalImages(it){
      const sourceText = String((it && it.source) || '').toLowerCase();
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const data = (it && it.data && typeof it.data === 'object') ? it.data : {};
      const media = (it && it.media && typeof it.media === 'object') ? it.media : {};
      const preview = (media && media.preview && typeof media.preview === 'object') ? media.preview : {};

      const raw = []
        .concat(displayCard.thumbnail ? [displayCard.thumbnail] : [])
        .concat(displayCard.image ? [displayCard.image] : [])
        .concat(Array.isArray(displayCard.imageSet) ? displayCard.imageSet : [])
        .concat(displayCard.preview && displayCard.preview.thumbnail ? [displayCard.preview.thumbnail] : [])
        .concat(displayCard.preview && displayCard.preview.image ? [displayCard.preview.image] : [])
        .concat(it && it.thumbnail ? [it.thumbnail] : [])
        .concat(it && it.thumb ? [it.thumb] : [])
        .concat(it && it.image ? [it.image] : [])
        .concat(it && it.poster ? [it.poster] : [])
        .concat(it && it.cover ? [it.cover] : [])
        .concat(it && it.og_image ? [it.og_image] : [])
        .concat(it && it.ogImage ? [it.ogImage] : [])
        .concat(payload.thumbnail ? [payload.thumbnail] : [])
        .concat(payload.thumb ? [payload.thumb] : [])
        .concat(payload.image ? [payload.image] : [])
        .concat(payload.image_url ? [payload.image_url] : [])
        .concat(payload.og_image ? [payload.og_image] : [])
        .concat(payload.ogImage ? [payload.ogImage] : [])
        .concat(payload.poster ? [payload.poster] : [])
        .concat(payload.cover ? [payload.cover] : [])
        .concat(data.thumbnail ? [data.thumbnail] : [])
        .concat(data.thumb ? [data.thumb] : [])
        .concat(data.image ? [data.image] : [])
        .concat(data.og_image ? [data.og_image] : [])
        .concat(data.poster ? [data.poster] : [])
        .concat(preview.poster ? [preview.poster] : [])
        .concat(preview.thumbnail ? [preview.thumbnail] : [])
        .concat(preview.image ? [preview.image] : [])
        .concat(Array.isArray(it && it.imageSet) ? it.imageSet : [])
        .concat(Array.isArray(payload.imageSet) ? payload.imageSet : [])
        .concat(Array.isArray(data.imageSet) ? data.imageSet : []);

      const out = [];
      const seen = new Set();

      raw.forEach(v => {
        const s = String(v || '').trim();
        if (!s) return;

        const low = s.toLowerCase();
        const isFaviconLike =
          low.includes('google.com/s2/favicons') ||
          low.includes('favicon') ||
          low.endsWith('.ico');

        if (isFaviconLike) return;
        if (!/^https?:\/\//i.test(s) && !s.startsWith('/')) return;
        if (!isMeaningfulImageForItemClient(s, it)) return;

        // Provider logos and brand icons are source markers, not thumbnails.
        // They must never be promoted into the visual card area.
        const providerLogoLike = /(google|naver|youtube|facebook|instagram|tiktok|twitter|x)[^?#]*(logo|favicon|brand|symbol|icon)/i.test(low) ||
          /(logo|favicon|brandmark|symbol|emblem|ci|bi)[^?#]*\.(png|jpg|jpeg|webp|svg)(\?|#|$)/i.test(low);
        if (providerLogoLike) return;

        let key = s.split('#')[0].toLowerCase();
        try {
          const u = new URL(s, location.origin);
          key = (u.origin + u.pathname).toLowerCase();
        } catch(e) {}

        if (seen.has(key)) return;

        seen.add(key);
        out.push(s);
      });

      // YouTube result cards should expose a representative thumbnail when a
      // full player is not appropriate or when the provider did not include an image.
      if (isYoutubeLikeItemClient(it)) {
        const best = preferredYoutubeThumbClient(it) || out[0] || '';
        return best ? [best] : [];
      }

      // Naver image API item is one image result; thumbnail/original often look duplicated.
      if (sourceText.includes('naver_image') && out.length > 1) {
        return out.slice(0, 1);
      }

      return out.slice(0, 3);
    }

    function classifyVisualKindClient(it){
      const source = String((it && it.source) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const summary = String((it && (it.summary || it.description)) || '').toLowerCase();
      const text = `${source} ${type} ${mediaType} ${title} ${summary}`;

      if (
        source.includes('book') ||
        type === 'book' ||
        text.includes('도서') ||
        text.includes('책 ') ||
        text.includes('웹툰') ||
        text.includes('만화') ||
        text.includes('shopping') ||
        text.includes('쇼핑')
      ) {
        return 'poster';
      }

      if (
        source.includes('image') ||
        mediaType === 'image' ||
        type === 'image'
      ) {
        return 'gallery';
      }

      return 'article';
    }


    function normalizeDisplayGroupClient(group){
      const raw = String(group || '').trim();
      const map = {
        official_authority: 'authority',
        official: 'authority',
        gov: 'authority',
        government: 'authority',
        public: 'public_data',
        public_data: 'public_data',
        opendata: 'public_data',
        open_data: 'public_data',
        knowledge_wiki: 'knowledge',
        wiki: 'wiki',
        encyclopedia: 'knowledge',
        academic: 'academic',
        scholar: 'academic',
        research: 'academic',
        paper: 'academic',
        map_local_tour: 'local_tour',
        local: 'local_tour',
        map: 'local_tour',
        tour: 'local_tour',
        video_vlog: 'video',
        video: 'video',
        youtube: 'video',
        image_gallery: 'image',
        image: 'image',
        photo: 'image',
        blog_review: 'blog',
        blog: 'blog',
        cafe: 'cafe',
        forum: 'community',
        community: 'community',
        community_sns: 'social',
        sns: 'social',
        social: 'social',
        shopping_product: 'shopping',
        shopping: 'shopping',
        commerce: 'shopping',
        product: 'shopping',
        sports: 'sports',
        finance: 'finance',
        stock: 'finance',
        webtoon: 'webtoon',
        company_web: 'site',
        corporate_homepage: 'site',
        business_site: 'site',
        official_site: 'site',
        homepage: 'site',
        website: 'site',
        site: 'site',
        company: 'site',
        corporate: 'site',
        business: 'site',
        general_web: 'web'
      };
      return map[raw] || raw;
    }

    function displayGroupOfItem(it){
      const rawGroup = String((it && (it.displayGroup || it.displayGroupLabel || it.group)) || '').trim();
      const normalized = normalizeDisplayGroupClient(rawGroup);
      const inferred = inferDisplayGroupClient(it);

      // Keep server groups when they are already precise, but allow broad groups
      // such as web/media/knowledge/community to split into richer portal lanes.
      if(!rawGroup) return inferred;
      const broadGroups = new Set(['web','general_web','media','knowledge','community','social']);
      if(broadGroups.has(normalized) && inferred && inferred !== normalized && inferred !== 'web') return inferred;
      return normalized || inferred || 'web';
    }

    function isHomepageLikeUrlClient(url){
      try {
        const u = new URL(String(url || ''), location.origin);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();
        const path = String(u.pathname || '/').replace(/\/+$/,'/');
        const parts = path.split('/').filter(Boolean);
        if(!host || !/\./.test(host)) return false;
        if(parts.length === 0) return true;
        if(parts.length === 1 && /^(home|main|company|about|intro|kr|ko|en|index)$/i.test(parts[0])) return true;
        return false;
      } catch(e) { return false; }
    }

    function isKnownNonSiteHostClient(host){
      host = String(host || '').toLowerCase();
      return /(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|x\.com|twitter\.com|naver\.com|daum\.net|google\.com|google\.co|bing\.com|wikipedia\.org|namu\.wiki)$/i.test(host) ||
        /(news|blog|cafe|shopping|shop|book|maps|map|finance|sports|webtoon)/i.test(host);
    }

    function inferDisplayGroupClient(it){
      const source = String((it && it.source) || '').toLowerCase();
      const provider = String((it && (it.provider || it.channel)) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const category = String((it && it.category) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const summary = String((it && (it.summary || it.snippet || it.description || it.contentSnippet || it.excerpt || it.abstract)) || '').toLowerCase();
      const url = String((it && (it.url || it.link)) || '').toLowerCase();
      const host = domainOf(url).toLowerCase();
      const text = `${source} ${provider} ${type} ${category} ${mediaType} ${title} ${summary} ${host}`;

      if (/(shopping\.naver|shopping|coupang|gmarket|11st|auction|amazon|aliexpress|temu|shop|store|mall)/i.test(host + ' ' + url)) return 'shopping';
      if (/(sports\.naver|espn|fifa|kbo|kfa|nba|mlb|uefa|sports|score|league)/i.test(host + ' ' + url + ' ' + text)) return 'sports';
      if (/(finance\.naver|finance\.yahoo|investing|tradingview|marketwatch|bloomberg|reuters|stock|finance|securities|증권|주식|환율|코스피|나스닥)/i.test(host + ' ' + url + ' ' + text)) return 'finance';
      if (/(comic\.naver|webtoon|kakao.*webtoon|comic|manga|웹툰|만화)/i.test(host + ' ' + url + ' ' + text)) return 'webtoon';

      if (host.includes('.go.kr') || host.endsWith('.gov') || host.includes('.gov.') || host.includes('korea.kr')) return 'authority';
      if (source.includes('public') || provider.includes('public') || type === 'public_data' || category === 'public_data' || text.includes('공공데이터') || text.includes('공공 데이터') || text.includes('데이터포털') || text.includes('open data') || host.includes('data.go.kr')) return 'public_data';
      if (source.includes('local') || source.includes('map') || type === 'map' || type === 'local' || mediaType === 'map' || category === 'map' || text.includes('관광') || text.includes('여행') || text.includes('지도') || text.includes('주소') || text.includes('위치') || text.includes('맛집') || text.includes('공원') || text.includes('landmark') || text.includes('tour')) return 'local_tour';
      if (host.includes('wikipedia.org') || host.includes('namu.wiki') || source.includes('wiki') || type === 'wiki' || text.includes('위키')) return 'wiki';
      if (source.includes('scholar') || source.includes('academic') || source.includes('paper') || source.includes('research') || source.includes('library') || type === 'academic' || type === 'paper' || type === 'research' || category === 'academic' || text.includes('학술') || text.includes('논문') || text.includes('연구') || text.includes('journal') || text.includes('citation') || text.includes('thesis') || host.includes('scholar.google') || host.includes('riss.kr') || host.includes('dbpia.co.kr') || host.includes('kci.go.kr')) return 'academic';
      if (source.includes('encyc') || source.includes('kin') || type === 'knowledge' || category === 'knowledge' || text.includes('지식') || text.includes('백과') || text.includes('사전')) return 'knowledge';
      if (source.includes('corporate') || source.includes('homepage') || source.includes('business') || source.includes('company') || type === 'site' || type === 'homepage' || type === 'business' || category === 'site' || text.includes('홈페이지') || text.includes('공식사이트') || text.includes('공식 사이트') || text.includes('기업') || text.includes('회사') || text.includes('business') || text.includes('company') || text.includes('corporate')) return 'site';
      if (isHomepageLikeUrlClient(url) && !isKnownNonSiteHostClient(host) && !source.includes('news')) return 'site';
      if (source.includes('book') || type === 'book' || category === 'book' || text.includes('도서') || text.includes('책 ') || text.includes('isbn') || host.includes('book.naver') || host.includes('books.google')) return 'book';
      if (source.includes('news') || type === 'news' || category === 'news' || text.includes('뉴스') || text.includes('속보') || text.includes('latest') || text.includes('breaking')) return 'news';
      if (source.includes('blog') || type === 'blog' || category === 'blog' || host.includes('blog.') || text.includes('블로그')) return 'blog';
      if (source.includes('cafe') || type === 'cafe' || category === 'cafe' || host.includes('cafe.') || text.includes('카페')) return 'cafe';
      if (source.includes('forum') || type === 'community' || category === 'community' || text.includes('커뮤니티') || text.includes('forum') || text.includes('게시판')) return 'community';
      if (source.includes('shopping') || source.includes('shop') || source.includes('commerce') || type === 'shopping' || type === 'product' || category === 'shopping' || text.includes('쇼핑') || text.includes('상품') || text.includes('구매') || text.includes('가격') || host.includes('shopping.')) return 'shopping';
      if (source.includes('sports') || type === 'sports' || category === 'sports' || text.includes('스포츠') || text.includes('축구') || text.includes('야구') || text.includes('농구') || text.includes('배구')) return 'sports';
      if (source.includes('finance') || type === 'finance' || category === 'finance' || text.includes('금융') || text.includes('증권') || text.includes('주식') || text.includes('환율') || text.includes('코스피') || text.includes('나스닥')) return 'finance';
      if (source.includes('webtoon') || type === 'webtoon' || category === 'webtoon' || text.includes('웹툰') || text.includes('만화') || text.includes('comic') || text.includes('manga')) return 'webtoon';
      if (mediaType === 'image' || type === 'image' || category === 'image' || source.includes('image') || text.includes('이미지') || text.includes('사진')) return 'image';
      if (mediaType === 'video' || type === 'video' || category === 'video' || source.includes('youtube') || source.includes('video') || host.includes('youtube.com') || host.includes('youtu.be') || text.includes('영상') || text.includes('유튜브')) return 'video';
      if (host.includes('instagram.') || host.includes('facebook.') || host.includes('tiktok.') || host.includes('x.com') || host.includes('twitter.') || source.includes('sns') || source.includes('social') || type === 'sns' || category === 'sns') return 'social';
      return 'web';
    }

    function displayGroupLabel(group, sample){
      const labels = {
        authority: '주요 정보',
        public_data: '공공자료',
        local_tour: '지도/지역',
        knowledge: '지식/백과',
        wiki: '위키',
        academic: '학술/논문',
        site: '사이트/홈페이지',
        book: '도서',
        news: '뉴스',
        blog: '블로그',
        cafe: '카페',
        community: '커뮤니티',
        image: '이미지',
        video: '영상',
        media: '이미지/영상',
        social: 'SNS',
        shopping: '쇼핑',
        sports: '스포츠',
        finance: '금융',
        webtoon: '웹툰',
        web: '일반 웹 결과'
      };
      return labels[group] || '일반 웹 결과';
    }

    function displayGroupPreviewLimit(group, sample){
      const n = parseInt(sample && sample.displayGroupPreviewLimit, 10);
      if (n > 0) return n;

      const limits = {
        authority: 3,
        public_data: 2,
        local_tour: 2,
        knowledge: 3,
        wiki: 3,
        academic: 4,
        site: 5,
        book: 4,
        news: 5,
        blog: 5,
        cafe: 5,
        community: 5,
        image: 5,
        video: 5,
        media: 5,
        social: 4,
        shopping: 5,
        sports: 4,
        finance: 4,
        webtoon: 4,
        web: 18
      };
      return limits[group] || 6;
    }

    function shouldUseDisplayGroups(slice){
      if (!Array.isArray(slice) || !slice.length) return false;
      if (normalizeSearchType(activeType) !== 'all') return false;
      return slice.some(it => it && (it.displayGroup || it.displayGroupLabel));
    }

    function groupSliceForDisplay(slice){
      const order = ['authority','local_tour','knowledge','wiki','site','book','blog','cafe','shopping','news','image','video','media','social','public_data','academic','community','sports','finance','webtoon','web'];
      const orderIndex = new Map(order.map((g, i) => [g, i]));
      const groups = new Map();

      (Array.isArray(slice) ? slice : []).forEach((it, idx) => {
        const group = displayGroupOfItem(it);
        if (!groups.has(group)) {
          groups.set(group, {
            group,
            label: displayGroupLabel(group, it),
            previewLimit: displayGroupPreviewLimit(group, it),
            items: [],
            firstIndex: idx
          });
        }
        groups.get(group).items.push(it);
      });

      return Array.from(groups.values()).sort((a, b) => {
        const ao = orderIndex.has(a.group) ? orderIndex.get(a.group) : 999;
        const bo = orderIndex.has(b.group) ? orderIndex.get(b.group) : 999;
        return (ao - bo) || (a.firstIndex - b.firstIndex);
      });
    }

    function sourceKeyForDisplayGroupItem(it){
      const url = String((it && (it.url || it.link || it.openUrl)) || '').trim();
      const host = domainOf(url).toLowerCase();
      const source = String((it && (it.source || it.provider || it.channel)) || '').toLowerCase();
      if(host) return host.replace(/^www\./, '');
      return source || String((it && it.title) || '').slice(0, 40).toLowerCase();
    }

    function diversifyGroupPreviewItems(group, items){
      const list = Array.isArray(items) ? items.slice() : [];
      if(!list.length) return list;
      const verticals = new Set(['news','blog','cafe','community','social','image','video','media']);
      if(!verticals.has(group)) return list;

      const firstBySource = [];
      const rest = [];
      const seen = new Set();
      list.forEach(it => {
        const key = sourceKeyForDisplayGroupItem(it);
        if(key && !seen.has(key)) {
          seen.add(key);
          firstBySource.push(it);
        } else {
          rest.push(it);
        }
      });
      return firstBySource.concat(rest);
    }

    function buildFrontViewportGroups(source, maxSlots){
      if(!Array.isArray(source) || !source.length) return [];
      const slotLimit = Math.max(1, parseInt(maxSlots, 10) || PAGE_SIZE);

      // Front viewport policy:
      // - each section exposes only representative cards;
      // - hidden overflow is stored behind the section button;
      // - hidden overflow NEVER counts in the 25 visible slots;
      // - do not refill empty slots with hidden news/blog/SNS overflow.
      const visibleCaps = {
        authority: 3,
        public_data: 2,
        local_tour: 2,
        knowledge: 3,
        wiki: 3,
        site: 5,
        book: 4,
        news: 5,
        community: 5,
        media: 5,
        social: 4,
        shopping: 4,
        sports: 3,
        finance: 3,
        webtoon: 3,
        web: 8
      };

      const groups = groupSliceForDisplay(source).map(g => {
        const items = diversifyGroupPreviewItems(g.group, g.items || []);
        return Object.assign({}, g, { items });
      });

      const out = [];
      let remaining = slotLimit;
      groups.forEach(g => {
        if(remaining <= 0 || !g || !Array.isArray(g.items) || !g.items.length) return;
        const baseCap = visibleCaps[g.group] || displayGroupPreviewLimit(g.group, g.items[0]) || 5;
        const visibleCount = Math.max(0, Math.min(baseCap, g.items.length, remaining));
        if(!visibleCount) return;
        out.push(Object.assign({}, g, {
          previewLimit: visibleCount,
          previewItems: g.items.slice(0, visibleCount),
          hiddenItems: g.items.slice(visibleCount),
          slotAwareViewport: true,
          displaySlotCount: visibleCount,
          sourceTotal: g.items.length
        }));
        remaining -= visibleCount;
      });

      return out;
    }

    function decorateDisplayItemForRender(it, groupInfo, index, hidden){
      const copy = Object.assign({}, it || {});
      const group = groupInfo && groupInfo.group ? groupInfo.group : displayGroupOfItem(copy);
      copy.__maruDisplayGroup = group;
      copy.__maruGroupPreviewIndex = Math.max(0, parseInt(index, 10) || 0);
      copy.__maruGroupHidden = !!hidden;

      // Only top-ranked map/local cards get live map preview + place info.
      // Later local results remain normal cards with summary text, preventing
      // long map iframes from flooding the search pages.
      copy.__maruAllowMapPreview = group === 'local_tour' && !hidden && copy.__maruGroupPreviewIndex < 3;
      return copy;
    }

    function renderGroupedSlice(slice, page){
      const groups = (Array.isArray(slice) && slice.length && slice[0] && Array.isArray(slice[0].items) && slice[0].group) ? slice : groupSliceForDisplay(slice);
      groups.forEach(groupInfo => {
        groupInfo.items = diversifyGroupPreviewItems(groupInfo.group, groupInfo.items);

        const section = document.createElement('section');
        section.className = 'maru-display-section';
        section.dataset.group = groupInfo.group;
        section.dataset.expanded = '0';

        const head = document.createElement('div');
        head.className = 'maru-display-section-head';

        const title = document.createElement('div');
        title.className = 'maru-display-section-title';
        const cleanGroupLabel = displayGroupLabel(groupInfo.group, groupInfo.items && groupInfo.items[0]);
        title.textContent = cleanGroupLabel;
        groupInfo.label = cleanGroupLabel;

        const meta = document.createElement('div');
        meta.className = 'maru-display-section-meta';
        const sourceTotal = parseInt(groupInfo.sourceTotal, 10) || Math.max.apply(null, groupInfo.items.map(x => parseInt(x && x.displayGroupSourceTotal, 10) || 0).concat([groupInfo.items.length]));
        const visibleCountForMeta = Array.isArray(groupInfo.previewItems) ? groupInfo.previewItems.length : groupInfo.items.length;
        meta.textContent = sourceTotal > visibleCountForMeta ? `${visibleCountForMeta}/${sourceTotal}개` : `${visibleCountForMeta}개`;

        head.appendChild(title);
        head.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'maru-display-section-body';

        const previewLimit = Math.max(1, parseInt(groupInfo.previewLimit, 10) || displayGroupPreviewLimit(groupInfo.group, groupInfo.items[0]));
        const previewItems = Array.isArray(groupInfo.previewItems) ? groupInfo.previewItems : groupInfo.items.slice(0, previewLimit);
        let hiddenItems = Array.isArray(groupInfo.hiddenItems) ? groupInfo.hiddenItems : null;
        if(!hiddenItems && normalizeSearchType(activeType) === 'all'){
          const fullGroup = diversifyGroupPreviewItems(groupInfo.group, groupSliceForDisplay(allItems).find(g => g.group === groupInfo.group)?.items || []);
          const visibleKeys = new Set(previewItems.map(it => String((it && (it.url || it.link || it.openUrl || it.id || it.title)) || '').toLowerCase()).filter(Boolean));
          const groupCap = Math.max(displayGroupPreviewLimit(groupInfo.group, fullGroup[0]), displayGroupModuleTotalCap(groupInfo.group));
          hiddenItems = fullGroup.slice(displayGroupPreviewLimit(groupInfo.group, fullGroup[0]), groupCap).filter(it => {
            const key = String((it && (it.url || it.link || it.openUrl || it.id || it.title)) || '').toLowerCase();
            return !key || !visibleKeys.has(key);
          });
        }
        hiddenItems = Array.isArray(hiddenItems) ? hiddenItems : groupInfo.items.slice(previewItems.length);
        let hiddenMounted = false;
        let hiddenWrap = null;

        previewItems.forEach((it, idx) => renderItem(decorateDisplayItemForRender(it, groupInfo, idx, false), body));

        section.appendChild(head);
        section.appendChild(body);

        if (hiddenItems.length) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'maru-display-more';
          const hiddenCount = hiddenItems.length;
          const label = groupInfo.label || '이 섹션';
          more.textContent = `${label} 전체 보기 ▾ (${hiddenCount}개)`;
          more.addEventListener('click', () => {
            const open = section.dataset.expanded === '1';
            if(open){
              section.dataset.expanded = '0';
              if(hiddenWrap) hiddenWrap.style.display = 'none';
              more.textContent = `${label} 전체 보기 ▾ (${hiddenCount}개)`;
              return;
            }

            section.dataset.expanded = '1';
            if(!hiddenMounted){
              hiddenWrap = document.createElement('div');
              hiddenWrap.className = 'maru-display-hidden-wrap';
              hiddenItems.slice(0, displayGroupModuleTotalCap(groupInfo.group)).forEach((it, idx) => renderItem(decorateDisplayItemForRender(it, groupInfo, idx, true), hiddenWrap));
              body.appendChild(hiddenWrap);
              hiddenMounted = true;
            }
            if(hiddenWrap) hiddenWrap.style.display = '';
            more.textContent = `${label} 접기 ▴`;
          });
          section.appendChild(more);
        }

        results.appendChild(section);
      });
    }


    function setRevenueDataset(el, key, value){
      if (!el || value === undefined || value === null || value === '') return;
      try { el.dataset[key] = String(value); } catch(e) {}
    }

    function inferSearchRevenueLine(it){
      const text = String([
        it && it.revenueLine,
        it && it.revenue_line,
        it && it.type,
        it && it.mediaType,
        it && it.category,
        it && it.source,
        it && it.url,
        it && it.title
      ].filter(Boolean).join(' ')).toLowerCase();

      if (text.includes('ad') || text.includes('sponsor') || text.includes('banner')) return 'display_ad';
      if (text.includes('shopping') || text.includes('shop') || text.includes('product') || text.includes('commerce') || text.includes('affiliate') || text.includes('상품') || text.includes('구매')) return 'product_affiliate';
      if (text.includes('video') || text.includes('media') || text.includes('youtube') || text.includes('image') || text.includes('영상')) return 'media_engagement';
      if (text.includes('tour') || text.includes('travel') || text.includes('관광') || text.includes('여행')) return 'tour_commission';
      if (text.includes('donation') || text.includes('donate') || text.includes('후원') || text.includes('기부')) return 'donation_intent';
      return 'search_click';
    }

    function applySearchRevenueDataset(card, it, url){
      if (!card || !it) return;

      const itemId =
        it.id ||
        it.itemId ||
        it.contentId ||
        it.productId ||
        it.slotId ||
        it.trackId ||
        url ||
        it.title ||
        '';

      setRevenueDataset(card, 'maruRevenue', '1');
      setRevenueDataset(card, 'itemId', itemId);
      setRevenueDataset(card, 'contentId', it.contentId || it.content_id || '');
      setRevenueDataset(card, 'productId', it.productId || it.product_id || it.sku || '');
      setRevenueDataset(card, 'slotId', it.slotId || it.slot_id || '');
      setRevenueDataset(card, 'trackId', it.trackId || it.track_id || '');
      setRevenueDataset(card, 'campaignId', it.campaignId || it.campaign_id || '');
      setRevenueDataset(card, 'providerId', it.providerId || it.provider_id || it.provider || it.source?.name || it.source || '');
      setRevenueDataset(card, 'sellerId', it.sellerId || it.seller_id || it.seller || '');
      setRevenueDataset(card, 'title', it.title || '');
      setRevenueDataset(card, 'url', url || it.url || it.link || '');
      setRevenueDataset(card, 'itemType', it.type || it.itemType || '');
      setRevenueDataset(card, 'mediaType', it.mediaType || '');
      setRevenueDataset(card, 'category', it.category || activeType || 'search');
      setRevenueDataset(card, 'page', 'search');
      setRevenueDataset(card, 'section', activeType || 'all');
      setRevenueDataset(card, 'revenueLine', it.revenueLine || it.revenue_line || inferSearchRevenueLine(it));
      setRevenueDataset(card, 'snapshotSource', it.snapshotSource || it._snapshotSource || '');
      setRevenueDataset(card, 'snapshotRecordId', it.snapshotRecordId || it.snapshot_record_id || '');
      setRevenueDataset(card, 'price', it.price || it.amount || '');
      setRevenueDataset(card, 'currency', it.currency || it.ccy || '');
    }


    function extractYouTubeIdFromUrl(url){
      const raw = String(url || '').trim();
      if (!raw) return '';

      try {
        const u = new URL(raw, location.origin);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();

        if (host === 'youtu.be') {
          return (u.pathname.split('/').filter(Boolean)[0] || '').trim();
        }

        if (host.includes('youtube.com')) {
          if (u.searchParams.get('v')) return u.searchParams.get('v').trim();

          const parts = u.pathname.split('/').filter(Boolean);
          const embedIdx = parts.indexOf('embed');
          if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1].trim();

          const shortsIdx = parts.indexOf('shorts');
          if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1].trim();

          const liveIdx = parts.indexOf('live');
          if (liveIdx >= 0 && parts[liveIdx + 1]) return parts[liveIdx + 1].trim();
        }

        if (host === 'img.youtube.com' || host === 'i.ytimg.com') {
          const parts = u.pathname.split('/').filter(Boolean);
          const viIdx = parts.indexOf('vi');
          if (viIdx >= 0 && parts[viIdx + 1]) return parts[viIdx + 1].trim();
        }
      } catch(e) {}

      const m =
        raw.match(/[?&]v=([A-Za-z0-9_-]+)/) ||
        raw.match(/youtu\.be\/([A-Za-z0-9_-]+)/) ||
        raw.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/) ||
        raw.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/) ||
        raw.match(/img\.youtube\.com\/vi\/([A-Za-z0-9_-]+)/);

      return m ? String(m[1] || '').trim() : '';
    }

    function isValidYouTubeId(id){
      return /^[A-Za-z0-9_-]{11}$/.test(String(id || '').trim());
    }

    function isYouTubeUrl(url){
      const s = String(url || '').toLowerCase();
      return s.includes('youtube.com') || s.includes('youtu.be') || s.includes('ytimg.com') || s.includes('img.youtube.com');
    }

    function looksLikeGeneratedMediaPlaceholderToken(v){
      const s = String(v || '').toLowerCase();
      return /media(movie|drama|thriller|romance|variety|documentary|animation|music|shorts)?0*\d+/i.test(s) ||
             /movie\s*slot\s*\d+/i.test(s) ||
             /drama\s*slot\s*\d+/i.test(s) ||
             /media\s*slot\s*\d+/i.test(s);
    }

    function isSeedPlaceholderItem(it){
      if (!it || typeof it !== 'object') return false;

      const sourceName = String(it.source?.name || it.source || '').toLowerCase();
      const title = String(it.title || it.name || '').toLowerCase();
      const summary = String(it.summary || it.description || '').toLowerCase();
      const url = String(it.url || it.link || it.videoUrl || '').toLowerCase();
      const thumb = String(it.thumbnail || it.thumb || it.image || '').toLowerCase();

      const hasPlaceholderObject =
        !!(it.extension && it.extension.placeholder) ||
        !!(it.placeholder === true) ||
        !!(it.isPlaceholder === true);

      return (
        sourceName === 'seed' ||
        hasPlaceholderObject ||
        summary.includes('seed placeholder') ||
        summary.includes('replace with ranked media content') ||
        looksLikeGeneratedMediaPlaceholderToken(title) ||
        looksLikeGeneratedMediaPlaceholderToken(url) ||
        looksLikeGeneratedMediaPlaceholderToken(thumb)
      );
    }

    function hasInvalidYouTubeVideoUrl(it){
      const urls = [
        it && it.url,
        it && it.link,
        it && it.videoUrl,
        it && it.media && it.media.url,
        it && it.media && it.media.videoUrl,
        it && it.thumbnail,
        it && it.thumb,
        it && it.image
      ].filter(Boolean);

      return urls.some(u => {
        const s = String(u || '');
        if (!isYouTubeUrl(s)) return false;
        const id = extractYouTubeIdFromUrl(s);
        return !isValidYouTubeId(id);
      });
    }

    function shouldRejectSearchResultItem(it){
      if (!it) return true;
      if (isSeedPlaceholderItem(it)) return true;
      if (hasInvalidYouTubeVideoUrl(it)) return true;
      return false;
    }

    function filterSearchResultItems(items){
      return (Array.isArray(items) ? items : []).filter(it => !shouldRejectSearchResultItem(it));
    }

    function getDirectVideoUrl(it){
      const urls = [
        it && it.videoUrl,
        it && it.media && it.media.videoUrl,
        it && it.media && it.media.url,
        it && it.media && it.media.src,
        it && it.media && it.media.preview && it.media.preview.mp4,
        it && it.media && it.media.preview && it.media.preview.webm,
        it && it.url,
        it && it.link
      ].filter(Boolean);

      for (const u of urls) {
        const s = String(u || '').trim();
        if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(s)) return s;
      }

      return '';
    }

    function getPlayableMediaInfo(it, url){
      const candidates = [
        url,
        it && it.url,
        it && it.link,
        it && it.videoUrl,
        it && it.media && it.media.url,
        it && it.media && it.media.videoUrl
      ].filter(Boolean);

      for (const u of candidates) {
        const s = String(u || '').trim();
        if (isYouTubeUrl(s)) {
          const id = extractYouTubeIdFromUrl(s);
          if (isValidYouTubeId(id)) {
            return {
              kind: 'youtube',
              id,
              embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
              originalUrl: s
            };
          }
        }
      }

      const direct = getDirectVideoUrl(it);
      if (direct) {
        return {
          kind: 'direct',
          src: direct,
          mime: /\.webm(\?|#|$)/i.test(direct) ? 'video/webm' : /\.ogg(\?|#|$)/i.test(direct) ? 'video/ogg' : 'video/mp4'
        };
      }

      return null;
    }

    function isPureMapItemClient(it){
      const source = String((it && it.source) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();
      const category = String((it && it.category) || '').toLowerCase();
      const visualKind = String((it && it.visualKind) || '').toLowerCase();
      const url = String((it && (it.url || it.link)) || '').toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const group = displayGroupOfItem(it);

      // Do not let a generic web/news result become a thumbnail-like map card
      // just because its title contains words such as 지도/교통지도. Map preview
      // is allowed only for the map tab or for true map provider records.
      if (normalizeSearchType(activeType) === 'map') return true;
      if (source.includes('google_maps') || source.includes('naver_map')) return true;
      if (/google\.com\/maps|map\.naver\.com|\/maps\/search/.test(url)) return true;
      if ((type === 'map' || mediaType === 'map' || category === 'map') && group === 'local_tour' && !source.includes('news')) return true;
      if (visualKind === 'map' && group === 'local_tour' && !source.includes('news') && !title.includes('뉴스')) return true;
      return false;
    }

    function isMapLikeItemClient(it){
      return isPureMapItemClient(it);
    }

    function firstExistingValueClient(obj, keys){
      if(!obj || typeof obj !== 'object') return '';
      for(const key of keys){
        const v = obj[key];
        if(v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return '';
    }

    function placeInfoForItemClient(it){
      const p = (it && it.placeInfo && typeof it.placeInfo === 'object') ? it.placeInfo : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const address = firstExistingValueClient(p, ['address','roadAddress','jibunAddress','addr']) || firstExistingValueClient(it, ['address','roadAddress','jibunAddress','addr']) || firstExistingValueClient(payload, ['address','roadAddress','jibunAddress','addr']);
      const phone = firstExistingValueClient(p, ['phone','telephone','tel','contact']) || firstExistingValueClient(it, ['phone','telephone','tel','contact']) || firstExistingValueClient(payload, ['phone','telephone','tel','contact']);
      const hours = firstExistingValueClient(p, ['hours','openingHours','businessHours','openStatus']) || firstExistingValueClient(it, ['hours','openingHours','businessHours','openStatus']) || firstExistingValueClient(payload, ['hours','openingHours','businessHours','openStatus']);
      const homepage = firstExistingValueClient(p, ['homepage','website','officialUrl','url']) || firstExistingValueClient(it, ['homepage','website','officialUrl']);
      const title = String((it && it.title) || '').replace(/^\[[^\]]+\]\s*/, '').trim();
      const query = firstExistingValueClient(p, ['mapQuery','query','name']) || firstExistingValueClient(it, ['mapQuery','placeName','name']) || title || lastQuery || input.value || '';
      return { address, phone, hours, homepage, query };
    }

    function mapQueryForItemClient(it){
      const info = placeInfoForItemClient(it);
      const title = String((it && it.title) || '').replace(/^\[[^\]]+\]\s*/, '').replace(/[-–—].*$/, '').trim();
      const summary = String((it && (it.summary || it.description)) || '').trim();
      return (info.address ? `${title || info.query} ${info.address}` : (info.query || title || summary || lastQuery || input.value || '')).slice(0, 160);
    }

    function renderPlaceInfoClient(it, mapQuery){
      const info = placeInfoForItemClient(it);
      const hasInfo = !!(info.address || info.phone || info.hours || info.homepage);
      const wrap = document.createElement('div');
      wrap.className = 'maru-place-info';

      if(hasInfo){
        if(info.address){
          const row = document.createElement('div');
          row.className = 'maru-place-info-row';
          row.textContent = '주소: ' + info.address;
          wrap.appendChild(row);
        }
        if(info.phone){
          const row = document.createElement('div');
          row.className = 'maru-place-info-row';
          row.textContent = '전화: ' + info.phone;
          wrap.appendChild(row);
        }
        if(info.hours){
          const row = document.createElement('div');
          row.className = 'maru-place-info-row';
          row.textContent = '시간: ' + info.hours;
          wrap.appendChild(row);
        }
      } else {
        const row = document.createElement('div');
        row.className = 'maru-place-info-row';
        row.textContent = '장소 정보: 지도 보기에서 주소·길찾기·주변 정보를 확인할 수 있습니다.';
        wrap.appendChild(row);
      }

      const actions = document.createElement('div');
      actions.className = 'maru-place-actions';

      const google = document.createElement('a');
      google.href = 'https://www.google.com/maps/search/' + encodeURIComponent(mapQuery || info.query || '');
      google.target = '_blank';
      google.rel = 'noopener';
      google.textContent = 'Google 지도';
      actions.appendChild(google);

      const naver = document.createElement('a');
      naver.href = 'https://map.naver.com/p/search/' + encodeURIComponent(mapQuery || info.query || '');
      naver.target = '_blank';
      naver.rel = 'noopener';
      naver.textContent = 'Naver 지도';
      actions.appendChild(naver);

      if(info.homepage){
        const home = document.createElement('a');
        home.href = info.homepage;
        home.target = '_blank';
        home.rel = 'noopener';
        home.textContent = '홈페이지';
        actions.appendChild(home);
      }

      wrap.appendChild(actions);
      return wrap;
    }

    function renderMapPreviewClient(it){
      if(!isMapLikeItemClient(it)) return null;
      const q = mapQueryForItemClient(it);
      if(!q) return null;
      const wrap = document.createElement('div');
      wrap.className = 'maru-map-preview';
      const iframe = document.createElement('iframe');
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer-when-downgrade';
      iframe.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed';
      iframe.title = q + ' map';
      iframe.onerror = () => wrap.remove();
      wrap.appendChild(iframe);
      const cap = document.createElement('div');
      cap.className = 'maru-map-preview-caption';
      cap.textContent = q;
      wrap.appendChild(cap);
      wrap.appendChild(renderPlaceInfoClient(it, q));
      return wrap;
    }

    function renderPlayableMedia(mediaInfo, it){
      if (!mediaInfo) return null;

      const wrap = document.createElement('div');
      wrap.className = 'maru-video-embed-wrap';

      if (mediaInfo.kind === 'youtube') {
        const iframe = document.createElement('iframe');
        iframe.src = mediaInfo.embedUrl;
        iframe.loading = 'lazy';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        iframe.title = (it && it.title) ? String(it.title).slice(0, 120) : 'YouTube video';
        wrap.appendChild(iframe);
        return wrap;
      }

      if (mediaInfo.kind === 'direct') {
        const video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        if (it && (it.poster || it.thumbnail || it.thumb || it.image)) {
          video.poster = it.poster || it.thumbnail || it.thumb || it.image;
        }

        const source = document.createElement('source');
        source.src = mediaInfo.src;
        source.type = mediaInfo.mime || 'video/mp4';
        video.appendChild(source);
        wrap.appendChild(video);
        return wrap;
      }

      return null;
    }


    function compactCardTextClient(v){
      if(v === undefined || v === null) return '';
      if(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'){
        return String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if(Array.isArray(v)){
        return v.map(compactCardTextClient).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      }
      if(typeof v === 'object'){
        return compactCardTextClient([
          v.summary, v.snippet, v.description, v.contentSnippet, v.content, v.text,
          v.abstract, v.excerpt, v.intro, v.body, v.caption
        ]);
      }
      return '';
    }

    function descriptionForItemClient(it){
      const displayCard = (it && it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const payload = (it && it.payload && typeof it.payload === 'object') ? it.payload : {};
      const data = (it && it.data && typeof it.data === 'object') ? it.data : {};
      const media = (it && it.media && typeof it.media === 'object') ? it.media : {};
      const preview = (media && media.preview && typeof media.preview === 'object') ? media.preview : {};
      const candidates = [
        displayCard.summary,
        displayCard.description,
        displayCard.body,
        displayCard.text,
        displayCard.snippet,
        it && it.displaySummary,
        it && it.summary,
        it && it.snippet,
        it && it.description,
        it && it.contentSnippet,
        it && it.excerpt,
        it && it.abstract,
        it && it.content,
        it && it.text,
        payload.summary,
        payload.snippet,
        payload.description,
        payload.contentSnippet,
        payload.excerpt,
        payload.abstract,
        payload.content,
        payload.text,
        data.summary,
        data.snippet,
        data.description,
        data.contentSnippet,
        data.excerpt,
        data.abstract,
        data.content,
        data.text,
        it && it.desc,
        it && it.metaDescription,
        it && it.ogDescription,
        it && it.lead,
        it && it.subtitle,
        it && it.bodyText,
        payload.desc,
        payload.metaDescription,
        payload.ogDescription,
        payload.lead,
        payload.subtitle,
        payload.bodyText,
        data.desc,
        data.metaDescription,
        data.ogDescription,
        data.lead,
        data.subtitle,
        data.bodyText,
        preview.summary,
        preview.description,
        preview.caption
      ];
      for(const v of candidates){
        const text = compactCardTextClient(v);
        if(text) return text.slice(0, 360);
      }
      return '';
    }

    function shouldRenderMapPreviewForItemClient(it){
      if(!it) return false;
      const displayCard = (it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      if(displayCard.showMapPreview === true && isMapLikeItemClient(it)) return true;
      if(it.__maruAllowMapPreview === true && isMapLikeItemClient(it)) return true;
      const t = normalizeSearchType(activeType);
      if((t === 'map' || t === 'tour') && isMapLikeItemClient(it)) return true;
      return false;
    }

    function isSearchEngineLandingUrlClient(url){
      const raw = String(url || '').trim();
      if(!raw) return false;
      try {
        const u = new URL(raw, location.origin);
        const h = u.hostname.replace(/^www\./, '').toLowerCase();
        const path = u.pathname.toLowerCase();
        if(h === 'google.com' && (path === '/search' || path === '/webhp' || path === '/')) return u.searchParams.has('q');
        if(h.endsWith('google.com') && path === '/search') return true;
        if(h === 'bing.com' && path.startsWith('/search')) return true;
        if(h === 'search.naver.com' && path.includes('/search.naver')) return true;
        if(h === 'naver.com' && path.includes('/search')) return true;
        if(h === 'duckduckgo.com' && (path === '/' || path.includes('/html'))) return u.searchParams.has('q');
        if(h === 'search.yahoo.com' && path.includes('/search')) return true;
        if(h === 'yandex.com' && path.includes('/search')) return true;
        if(h === 'baidu.com' && (path === '/s' || path.includes('/search'))) return true;
      } catch(e) {}
      return false;
    }

    function resolveResultOpenUrlClient(it){
      it = it && typeof it === 'object' ? it : {};
      const displayCard = (it.displayCard && typeof it.displayCard === 'object') ? it.displayCard : {};
      const payload = (it.payload && typeof it.payload === 'object') ? it.payload : {};
      const data = (it.data && typeof it.data === 'object') ? it.data : {};
      const candidates = [
        displayCard.originalUrl, displayCard.targetUrl, displayCard.canonicalUrl, displayCard.sourceUrl, displayCard.url, displayCard.link,
        it.originalUrl, it.targetUrl, it.canonicalUrl, it.sourceUrl, it.realUrl, it.contentUrl, it.url, it.link, it.href,
        payload.originalUrl, payload.targetUrl, payload.canonicalUrl, payload.sourceUrl, payload.realUrl, payload.contentUrl, payload.url, payload.link, payload.href,
        data.originalUrl, data.targetUrl, data.canonicalUrl, data.sourceUrl, data.realUrl, data.contentUrl, data.url, data.link, data.href
      ];
      let searchProviderUrl = '';
      for(const v of candidates){
        const x = String(v || '').trim();
        if(!x || x === '#') continue;
        if(isSearchEngineLandingUrlClient(x)){ if(!searchProviderUrl) searchProviderUrl = x; continue; }
        if(/^https?:\/\//i.test(x) || x.startsWith('/')) return { url:x, blockedProviderUrl:searchProviderUrl };
      }
      return { url:'', blockedProviderUrl:searchProviderUrl };
    }

    function removeOpenResultPreviewsClient(except){
      document.querySelectorAll('.maru-result-preview').forEach(node => {
        if(node !== except) node.remove();
      });
    }

    function toggleResultPreviewClient(card, it){
      if(!card) return;
      drawPager();
      const existing = card.querySelector(':scope > .maru-result-preview');
      if(existing){ existing.remove(); drawPager(); return; }
      removeOpenResultPreviewsClient(null);

      const open = resolveResultOpenUrlClient(it);
      const openUrl = open && open.url ? open.url : '';
      const title = String((it && it.title) || '').trim() || '(no title)';
      const desc = descriptionForItemClient(it);
      const images = collectNaturalImages(it).slice(0, 4);

      const wrap = document.createElement('div');
      wrap.className = 'maru-result-preview';
      wrap.addEventListener('click', e => e.stopPropagation());

      const head = document.createElement('div');
      head.className = 'maru-result-preview-head';
      const ht = document.createElement('div');
      ht.className = 'maru-result-preview-title';
      ht.textContent = title;
      head.appendChild(ht);

      const actions = document.createElement('div');
      actions.className = 'maru-result-preview-actions';
      if(openUrl){
        const out = document.createElement('a');
        out.href = openUrl;
        out.target = '_blank';
        out.rel = 'noopener noreferrer';
        out.textContent = '원문 새 탭';
        actions.appendChild(out);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '닫기';
      close.addEventListener('click', () => wrap.remove());
      actions.appendChild(close);
      head.appendChild(actions);
      wrap.appendChild(head);

      const body = document.createElement('div');
      body.className = 'maru-result-preview-body';
      if(desc){
        const summary = document.createElement('div');
        summary.className = 'maru-result-preview-summary';
        summary.textContent = desc;
        body.appendChild(summary);
      }
      if(images.length){
        const media = document.createElement('div');
        media.className = 'maru-result-preview-media';
        images.forEach(src => {
          const img = document.createElement('img');
          img.src = src;
          img.loading = 'lazy';
          img.alt = '';
          img.onerror = () => img.remove();
          media.appendChild(img);
        });
        body.appendChild(media);
      }
      const note = document.createElement('div');
      note.className = 'maru-result-preview-note';
      note.textContent = openUrl
        ? '현재 검색 화면은 유지합니다. 원문은 새 탭으로만 열고, 카드에는 검색 요약과 사용 가능한 이미지/영상만 표시합니다.'
        : (open && open.blockedProviderUrl ? '검색엔진의 메인 검색 결과 페이지로 이동하지 않도록 이 카드 안에서 요약만 표시합니다.' : '열 수 있는 원문 URL이 없어 검색 카드 요약만 표시합니다.');
      body.appendChild(note);
      wrap.appendChild(body);
      card.appendChild(wrap);
      drawPager();
    }

    function renderItem(it, mountTarget){
      const openInfo = resolveResultOpenUrlClient(it);
      const url = (openInfo && openInfo.url) || it.url || it.link || '';
      const openUrl = (openInfo && openInfo.url) || '';
      const domain = domainOf(openUrl || url);

      const card = document.createElement('div');
      card.className = 'card';
      applySearchRevenueDataset(card, it, openUrl || url);

      const playableMedia = getPlayableMediaInfo(it, openUrl || url);

      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('button, iframe, video, .maru-video-embed-wrap, .maru-card-media, .maru-result-preview')) return;
        if (e.target && e.target.closest && e.target.closest('a')) return;
        toggleResultPreviewClient(card, it);
      });

      const body = document.createElement('div');
      body.className = 'maru-search-card-body';
      body.style.overflow = 'visible';

      const textCol = document.createElement('div');
      textCol.className = 'maru-search-card-text';

      const t = document.createElement('div');
      t.className = 'title';

      if (openUrl || url) {
        const a = document.createElement('a');
        a.href = openUrl || '#';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = (it.title || '').trim() || '(no title)';
        a.style.color = 'inherit';
        a.style.textDecoration = 'none';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          toggleResultPreviewClient(card, it);
        });
        t.appendChild(a);
      } else {
        t.textContent = (it.title || '').trim() || '(no title)';
      }

      const l = document.createElement('div');
      l.className = 'link';

      const fav = document.createElement('img');
      fav.src = faviconOf(url);
      fav.style.width = '16px';
      fav.style.height = '16px';
      fav.style.verticalAlign = 'middle';
      fav.style.marginRight = '10px';
      fav.style.borderRadius = '4px';
      fav.style.background = '#ffffff';
      fav.style.border = '1px solid #d6e4ff';
      fav.style.boxShadow = '0 0 0 0 rgba(0,0,0,0)';
      fav.style.padding = '1px';
      fav.onerror = () => fav.remove();

      const span = document.createElement('span');
      span.textContent = domain || (it.source?.name || it.source || '');

      l.appendChild(fav);
      l.appendChild(span);

      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = descriptionForItemClient(it);

  textCol.appendChild(t);

const risk = document.createElement('div');
risk.style.fontSize = '11px';
risk.style.fontWeight = '700';
risk.style.marginTop = '6px';

if (it.riskLabel === '⚠️ high-risk') {
  risk.textContent = it.riskLabel;
  risk.style.color = 'red';
  textCol.appendChild(risk);

} else if (it.riskLabel === '⚠️ medium-risk') {
  risk.textContent = it.riskLabel;
  risk.style.color = 'orange';
  textCol.appendChild(risk);

}
// 그 외는 아예 표시 안 함 (safe 제거)

      if (risk.textContent) textCol.appendChild(risk);
      textCol.appendChild(l);
      if (d.textContent) textCol.appendChild(d);

      if (d && d.textContent) {
        d.style.display = '-webkit-box';
        const cardLineClamp = it && it.displayCard && parseInt(it.displayCard.lineClamp, 10);
        d.style.webkitLineClamp = String(cardLineClamp > 0 ? Math.min(6, cardLineClamp) : 4);
        d.style.webkitBoxOrient = 'vertical';
        d.style.overflow = 'hidden';
        d.style.textOverflow = 'ellipsis';
      }

      const hasImageSet = Array.isArray(it.imageSet) && it.imageSet.length > 0;

      const naturalImages = collectNaturalImages(it);
      const isRealThumb = naturalImages.length > 0;

      const hasVideoPreview =
        it.media &&
        ((it.media.type || it.media.kind) === 'video') &&
        it.media.preview &&
        (it.media.preview.mp4 || it.media.preview.webm || it.media.preview.poster);

      body.appendChild(textCol);

      const playableMediaNode = renderPlayableMedia(playableMedia, it);
      if (playableMediaNode) {
        const badge = document.createElement('div');
        badge.className = 'maru-video-badge';
        badge.textContent = playableMedia.kind === 'youtube' ? '영상 재생' : '동영상';
        textCol.appendChild(badge);
        body.appendChild(playableMediaNode);
      }

      const mapPreviewNode = (!playableMediaNode && shouldRenderMapPreviewForItemClient(it)) ? renderMapPreviewClient(it) : null;
      if (mapPreviewNode) {
        body.appendChild(mapPreviewNode);
      }

      if (!playableMediaNode && isRealThumb) {
        const mediaWrap = document.createElement('div');
        mediaWrap.className = 'maru-card-media';
        const mediaCount = Math.min(naturalImages.length, 3);
        const mediaKind = classifyVisualKindClient(it);
        mediaWrap.dataset.count = String(mediaCount);
        mediaWrap.dataset.kind = mediaKind;
        body.dataset.mediaCount = String(mediaCount);
        body.dataset.mediaKind = mediaKind;
        body.style.minHeight =
          mediaKind === 'poster' ? '220px' :
          mediaCount >= 3 ? '214px' :
          mediaCount === 2 ? '164px' :
          '176px';

        naturalImages.forEach((src) => {
          const img = document.createElement('img');
          img.src = src;
          img.loading = 'lazy';
          img.alt = '';
          img.onerror = () => img.remove();
          mediaWrap.appendChild(img);
        });

        body.appendChild(mediaWrap);
      }

      if (hasVideoPreview && !playableMediaNode && !isYoutubeLikeItemClient(it)) {
        const videoWrap = document.createElement('div');
        videoWrap.style.marginTop = '8px';
        videoWrap.style.maxHeight = '120px';
        videoWrap.style.overflow = 'hidden';
        videoWrap.style.borderRadius = '6px';

        const video = document.createElement('video');
        const hasPlayableSource = !!(it.media.preview.mp4 || it.media.preview.webm);

        if (!hasPlayableSource) {
          video.controls = false;
        }

        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'none';
        video.style.width = '100%';
        video.style.maxHeight = '120px';
        video.style.objectFit = 'cover';

        if (it.media.preview.poster) video.poster = it.media.preview.poster;

        if (it.media.preview.webm) {
          const s = document.createElement('source');
          s.src = it.media.preview.webm;
          s.type = 'video/webm';
          video.appendChild(s);
        }
        if (it.media.preview.mp4) {
          const s = document.createElement('source');
          s.src = it.media.preview.mp4;
          s.type = 'video/mp4';
          video.appendChild(s);
        }

        videoWrap.addEventListener('mouseenter', () => {
          if (hasPlayableSource) video.play().catch(()=>{});
        });
        videoWrap.addEventListener('mouseleave', () => {
          video.pause();
          video.currentTime = 0;
        });

        videoWrap.appendChild(video);
        body.appendChild(videoWrap);
      }

      // Natural media policy:
      // Do not render a separate imageSet gallery here.
      // The card uses one natural thumbnail when the result itself has one.
      // This prevents duplicate images and keeps card height natural.

      card.appendChild(body);
      (mountTarget || results).appendChild(card);
      return card;
    }


    function itemStableKey(it){
      return String(
        (it && (it.id || it.url || it.link || it.title)) || ''
      ).trim().toLowerCase();
    }

    function mergeEnrichedItems(baseItems, enrichedItems){
      const byKey = new Map();

      (Array.isArray(enrichedItems) ? enrichedItems : []).forEach(it => {
        const key = itemStableKey(it);
        if(key) byKey.set(key, it);
      });

      return (Array.isArray(baseItems) ? baseItems : []).map(it => {
        const key = itemStableKey(it);
        const hit = key ? byKey.get(key) : null;
        if(!hit) return it;

        const imgs = collectNaturalImages(hit);
        if(!imgs.length) return it;

        const merged = {
          ...it,
          thumbnail: hit.thumbnail || imgs[0] || it.thumbnail || '',
          thumb: hit.thumb || imgs[0] || it.thumb || '',
          image: hit.image || imgs[0] || it.image || '',
          imageSet: imgs
        };

        itemImageEnrichCache.set(key, merged);
        return merged;
      });
    }

    async function enrichRenderedPageImages(page, slice, startIndex){
      const q = (input.value || '').trim();
      if(!q || !Array.isArray(slice) || !slice.length) return;

      const cacheKey = [q, activeType || 'all', page].join('::');
      if(pageImageEnrichCache.has(cacheKey)) return;
      pageImageEnrichCache.add(cacheKey);

      const candidates = slice
        .map((it, idx) => ({ it, idx }))
        .filter(x => {
          const key = itemStableKey(x.it);
          if(key && itemImageEnrichCache.has(key)) return false;
          if(collectNaturalImages(x.it).length) return false;
          const url = String((x.it && (x.it.url || x.it.link)) || '').trim();
          return /^https?:\/\//i.test(url);
        })
        .slice(0, PAGE_SIZE);

      if(!candidates.length) return;

      try{
        const url =
          `/.netlify/functions/maru-search?action=enrich-images&q=${encodeURIComponent(q)}&type=${encodeURIComponent(activeType || 'all')}`;

        const res = await fetch(url, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q,
            type: activeType || 'all',
            items: candidates.map(x => x.it)
          })
        });

        if(!res.ok) return;

        const json = await res.json();
        const enriched = normalizeItems(json);
        if(!enriched.length) return;

        const updatedCandidates = mergeEnrichedItems(candidates.map(x => x.it), enriched);
        let changed = false;

        updatedCandidates.forEach((item, i) => {
          const globalIdx = startIndex + candidates[i].idx;
          if(globalIdx >= 0 && globalIdx < allItems.length && collectNaturalImages(item).length){
            allItems[globalIdx] = item;
            changed = true;
          }
        });

        if(changed && page === currentPage){
          renderPage(page, true);
        }
      }catch(e){
        console.warn('page image enrichment skipped:', e);
      }
    }



    function stateKeyForGroup(page, group){
      return `${lastQuery || input.value || ''}::${activeType || 'all'}::${page}::${group}`;
    }

    function isDisplayGroupModule(x){
      return !!(x && x.__maruDisplayGroupModule === true && x.group && Array.isArray(x.items));
    }

    function displayItemKey(it){
      return String((it && (it.url || it.link || it.openUrl || it.id || it.title)) || '').toLowerCase();
    }

    function makePlainWebItem(it){
      const copy = Object.assign({}, it || {});
      delete copy.displayGroup;
      delete copy.displayGroupLabel;
      delete copy.displayGroupVisibleIndex;
      delete copy.displayGroupSourceTotal;
      delete copy.displayGroupCollapsedCount;
      copy.generalWebContinuation = true;
      copy.visibleViewportCard = true;
      return copy;
    }

    function displayGroupModuleTotalCap(group){
      // Keep each category useful but bounded. Extra items are not deleted; they
      // continue as ordinary web/list results after the category portal blocks.
      const caps = {
        authority: 8,
        public_data: 8,
        local_tour: 8,
        knowledge: 3,
        wiki: 3,
        academic: 15,
        site: 15,
        book: 15,
        news: 15,
        blog: 15,
        cafe: 15,
        community: 15,
        image: 15,
        video: 15,
        media: 15,
        social: 15,
        shopping: 15,
        sports: 15,
        finance: 15,
        webtoon: 15
      };
      return caps[group] || 30;
    }

    function buildPortalPageModel(){
      const sourceItems = Array.isArray(allItems) ? allItems : [];
      const empty = { categoryPages: [], webItems: [], pageCount: 0, virtualCount: 0 };
      if(!sourceItems.length || normalizeSearchType(activeType) !== 'all') return empty;

      const grouped = groupSliceForDisplay(sourceItems).map(g => Object.assign({}, g, {
        items: diversifyGroupPreviewItems(g.group, g.items || [])
      }));
      const byGroup = new Map(grouped.map(g => [g.group, g]));
      const categoryOrder = ['authority','local_tour','knowledge','wiki','site','book','blog','cafe','shopping','news','image','video','media','social','public_data','academic','community','sports','finance','webtoon'];
      const categoryOverflowItems = [];
      const categoryPages = [];
      let page = [];
      let pageWeight = 0;

      function pushCategoryModule(g){
        if(!g || !Array.isArray(g.items) || !g.items.length) return;
        const previewLimit = Math.max(1, displayGroupPreviewLimit(g.group, g.items[0]));
        const moduleCap = Math.max(previewLimit, displayGroupModuleTotalCap(g.group));
        const moduleItems = g.items.slice(0, moduleCap);
        const previewItems = moduleItems.slice(0, previewLimit);
        const hiddenItems = moduleItems.slice(previewItems.length);
        const overflowItems = g.items.slice(moduleCap).map(makePlainWebItem);
        if(overflowItems.length) categoryOverflowItems.push(...overflowItems);
        const weight = Math.max(1, previewItems.length);
        const categoryPageTarget = PAGE_SIZE;
        if(page.length && pageWeight + weight > categoryPageTarget){
          categoryPages.push(page);
          page = [];
          pageWeight = 0;
        }
        page.push({
          __maruDisplayGroupModule: true,
          group: g.group,
          label: displayGroupLabel(g.group, g.items[0]),
          previewLimit,
          previewItems,
          hiddenItems,
          sourceTotal: moduleItems.length,
          overflowAsWebCount: overflowItems.length,
          items: previewItems,
          firstIndex: g.firstIndex || 0
        });
        pageWeight += weight;
      }

      categoryOrder.forEach(group => pushCategoryModule(byGroup.get(group)));
      if(page.length) categoryPages.push(page);

      const ordered = new Set(categoryOrder.concat(['web']));
      const nonPortalItems = [];
      grouped.forEach(g => {
        if(!ordered.has(g.group) && Array.isArray(g.items)) nonPortalItems.push(...g.items.map(makePlainWebItem));
      });
      const webGroup = byGroup.get('web');
      const webItems = categoryOverflowItems
        .concat(nonPortalItems)
        .concat((webGroup && Array.isArray(webGroup.items) ? webGroup.items : []).map(makePlainWebItem));
      function categoryModuleWeight(mod){
        return Math.max(1, Array.isArray(mod && mod.previewItems) ? mod.previewItems.length : 1);
      }
      function categoryPageWeight(modules){
        return (Array.isArray(modules) ? modules : []).reduce((sum, mod) => sum + categoryModuleWeight(mod), 0);
      }
      let filledWebBeforePlainPages = 0;
      const categoryFillCounts = categoryPages.map((modules, idx) => {
        // General web/plain results must not be inserted between category modules.
        // They may only start after the final category page has rendered, so the
        // category board keeps its intended order: knowledge/wiki/site/book/blog/cafe/news/etc.
        if(idx !== categoryPages.length - 1) return 0;
        const fill = Math.min(
          Math.max(0, webItems.length - filledWebBeforePlainPages),
          Math.max(0, PAGE_SIZE - categoryPageWeight(modules))
        );
        filledWebBeforePlainPages += fill;
        return fill;
      });
      const remainingWebCount = Math.max(0, webItems.length - filledWebBeforePlainPages);
      const pageCount = categoryPages.length + Math.max(0, Math.ceil(remainingWebCount / PAGE_SIZE));
      return {
        categoryPages,
        categoryFillCounts,
        filledWebBeforePlainPages,
        webItems,
        pageCount,
        virtualCount: (categoryPages.length * PAGE_SIZE) + remainingWebCount
      };
    }

    function buildClientVisibleStream(page){
      const sourceItems = Array.isArray(allItems) ? allItems : [];
      if (!sourceItems.length) return [];
      if (normalizeSearchType(activeType) !== 'all') return sourceItems.slice();

      const model = buildPortalPageModel();
      if(model.pageCount){
        const categoryPageCount = model.categoryPages.length;
        const pageNo = Math.max(1, parseInt(page, 10) || 1);
        if(pageNo <= categoryPageCount) {
          const modules = model.categoryPages[pageNo - 1] || [];
          const fillStart = (model.categoryFillCounts || []).slice(0, pageNo - 1).reduce((sum, n) => sum + (Number(n) || 0), 0);
          const fillCount = Number((model.categoryFillCounts || [])[pageNo - 1]) || 0;
          return modules.concat((model.webItems || []).slice(fillStart, fillStart + fillCount));
        }
        const webPage = pageNo - categoryPageCount;
        const start = Math.max(0, (model.filledWebBeforePlainPages || 0) + ((webPage - 1) * PAGE_SIZE));
        return model.webItems.slice(start, start + PAGE_SIZE);
      }

      return sourceItems.slice();
    }

    function visibleItemsForPage(page){
      const start = (page - 1) * PAGE_SIZE;

      // In the all tab, never let a raw server page full of one vertical
      // such as news occupy the viewport. Rebuild a balanced visible stream
      // from the accumulated pool so collapsed/overflow items do not consume
      // the 25 visible slots.
      if (normalizeSearchType(activeType) === 'all') {
        return buildClientVisibleStream(page);
      }

      if(serverPagedMode && loadedServerPages.has(page)){
        return loadedServerPages.get(page).slice(0, PAGE_SIZE);
      }
      const stream = buildClientVisibleStream(page);
      return stream.slice(start, start + PAGE_SIZE);
    }

    function visibleItemCountForPager(){
      // In the all tab the pager must count the client visible stream, not the
      // raw server total. Collapsed category overflow remains behind 더보기 and
      // must not consume page slots.
      if (normalizeSearchType(activeType) === 'all') {
        const model = buildPortalPageModel();
        const portalCount = model && model.virtualCount ? model.virtualCount : buildClientVisibleStream(currentPage || 1).length;
        const preloadFloor = lastQuery ? Math.min(INITIAL_PRELOAD_TARGET, Math.max(allItems.length || 0, portalCount || 0)) : 0;
        return Math.max(portalCount, allItems.length || 0, preloadFloor);
      }
      if(serverPagedMode && serverTotalItems > 0) return serverTotalItems;
      return buildClientVisibleStream(currentPage || 1).length;
    }

    function frontPageSectionSource(){
      if(normalizeSearchType(activeType) !== 'all') return null;
      const source = Array.isArray(allItems) ? allItems : [];
      if(!source.length) return null;
      // First page is a Naver/Google-like category board. It uses the received
      // pool, but each vertical renders only its preview count until the user
      // opens that section. This prevents news/blog/SNS from occupying hundreds
      // of cards in the main flow.
      return source.slice(0, Math.min(source.length, 600));
    }

    function renderPage(page, skipEnrich = false){
      if(serverPagedMode && !loadedServerPages.has(page)){
        const preloadedPageCount = preloadPageCountFromItems(allItems);
        if(page > preloadedPageCount && !renderPage._serverWindowLoading){
          renderPage._serverWindowLoading = true;
          loadServerPageAndRender(page).finally(() => { renderPage._serverWindowLoading = false; });
          return;
        }
      }
      results.innerHTML = '';
      const slice = visibleItemsForPage(page);
      const start = (page - 1) * PAGE_SIZE;

      // Render the already-balanced visible stream. Do not rebuild page 1 from a
      // raw source slice, because a raw slice may contain only news/logo/map cards
      // and then hidden overflow still blocks the following categories from moving up.
      if (slice.some(isDisplayGroupModule)) {
        slice.forEach(entry => {
          if(isDisplayGroupModule(entry)) renderGroupedSlice([entry], page);
          else renderItem(entry);
        });
      } else if (shouldUseDisplayGroups(slice)) {
        renderGroupedSlice(slice, page);
      } else {
        slice.forEach(it => renderItem(it));
      }

      drawPager();

      if(!skipEnrich){
        enrichRenderedPageImages(page, slice, start);
      }
    }


    async function loadServerPageAndRender(page){
      if(!serverPagedMode){
        renderPage(page);
        return;
      }
      if(loadedServerPages.has(page)){
        renderPage(page);
        return;
      }
      const preloadedPageCount = preloadPageCountFromItems(allItems);
      if(page <= preloadedPageCount){
        renderPage(page);
        return;
      }
      const q = (lastQuery || input.value || '').trim();
      if(!q){
        renderPage(page);
        return;
      }
      status.textContent = `Loading page ${page} for "${q}"...`;
      try{
        const pack = await fetchSearch(q, activeType, page);
        const pageSlice = dedupeItems(filterSearchResultItems(pageItemsFromPack(pack)));
        if(pageSlice.length){
          loadedServerPages.set(page, pageSlice.slice(0, PAGE_SIZE));
          allItems = mergeItemsPreferDisplayRichness(allItems, pageSlice);
          const total = serverTotalFromPayload(pack && pack.payload, serverTotalItems || pageSlice.length);
          serverTotalItems = Math.max(serverTotalItems || 0, total || 0, INITIAL_PRELOAD_TARGET);
        } else if(serverTotalItems > ((page - 1) * PAGE_SIZE)){
          // Do not silently render a blank page when the pager says that page exists.
          // Keep the loading state visible and let the user retry by clicking the page again.
          status.textContent = `Page ${page} data is being supplied for "${q}"...`;
        }
      }catch(e){
        console.warn('server page fetch skipped:', e);
      }
      if(loadedServerPages.has(page) || page <= preloadPageCountFromItems(allItems)){
        renderPage(page);
        status.textContent = `${serverTotalItems || visibleItemCountForPager()} results for "${q}" · ${getTypeLabel(activeType)}`;
      }
    }

function updateSearchPageHistory(page, block) {
  if (!isSearchPage) return;

  const u = new URL(location.href);
  u.searchParams.set('page', String(page));
  u.searchParams.set('block', String(block));
  if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
  else u.searchParams.delete('type');

  const currentPageParam = (new URLSearchParams(location.search).get('page') || '1').trim();
  const currentBlockParam = (new URLSearchParams(location.search).get('block') || '0').trim();

  if (currentPageParam === String(page) && currentBlockParam === String(block)) return;

  const safeReturnUrl = getSafeReturnUrl();
  if (safeReturnUrl) {
    u.searchParams.set('from', safeReturnUrl);
  }

  history.pushState(
    {
      ...(history.state || {}),
      page,
      block,
      q: (new URLSearchParams(location.search).get('q') || '').trim(),
      type: activeType,
      from: safeReturnUrl || ''
    },
    '',
    u.toString()
  );
}

function drawPager(){
  const pages = Math.min(MAX_PAGER_PAGES, Math.max(1, Math.ceil(visibleItemCountForPager() / PAGE_SIZE)));
  if (pages <= 1) { clearPager(); return; }

  const bar = ensurePager();
  bar.innerHTML = '';
  bar.setAttribute('aria-label', '검색 결과 페이지');

  const stylePagerButton = (button, on) => {
    button.type = 'button';
    button.style.minWidth = '34px';
    button.style.height = '32px';
    button.style.borderRadius = '9px';
    button.style.border = '1px solid ' + (on ? '#1e3a8a' : '#cbd5e1');
    button.style.background = on ? '#1e3a8a' : '#ffffff';
    button.style.color = on ? '#ffffff' : '#1e293b';
    button.style.fontWeight = '900';
    button.style.cursor = 'pointer';
  };

  const blockStart = currentBlock * BLOCK_SIZE + 1;
  const blockEnd = Math.min(blockStart + BLOCK_SIZE - 1, pages);

  if (blockStart > 1){
    const left = document.createElement('button');
    left.textContent = '◀';
    stylePagerButton(left, false);
    left.onclick = () => {
      currentBlock = Math.max(0, currentBlock - 1);
      currentPage = currentBlock * BLOCK_SIZE + 1;
      updateSearchPageHistory(currentPage, currentBlock);
      loadServerPageAndRender(currentPage);
    };
    bar.appendChild(left);
  }

  for (let p = blockStart; p <= blockEnd; p++){
    const b = document.createElement('button');
    b.textContent = String(p);
    stylePagerButton(b, p === currentPage);
    b.onclick = () => {
      currentPage = p;
      currentBlock = Math.floor((p - 1) / BLOCK_SIZE);
      updateSearchPageHistory(currentPage, currentBlock);
      loadServerPageAndRender(currentPage);
    };
    bar.appendChild(b);
  }

  if (blockEnd < pages){
    const right = document.createElement('button');
    right.textContent = '▶';
    stylePagerButton(right, false);
    right.onclick = () => {
      const maxBlock = Math.floor((pages - 1) / BLOCK_SIZE);
      currentBlock = Math.min(maxBlock, currentBlock + 1);
      currentPage = currentBlock * BLOCK_SIZE + 1;
      updateSearchPageHistory(currentPage, currentBlock);
      loadServerPageAndRender(currentPage);
    };
    bar.appendChild(right);
  }
}

async function runSearch(q, type = activeType){
  const qq = (q || '').trim();
  activeType = normalizeSearchType(type);
  updateSearchTabsActive();
  stopContinuousIntake();

  if (!qq){
    allItems = [];
    serverPagedMode = false;
    serverTotalItems = 0;
    authoritativeServerTotalItems = 0;
    progressivePagerPages = INITIAL_PROGRESSIVE_PAGER_PAGES;
    loadedServerPages.clear();
    results.innerHTML = '';
    clearPager();
    status.textContent = '';
    return;
  }

  runSearch._seq = (runSearch._seq || 0) + 1;
  const seq = runSearch._seq;
  const target = Math.max(INITIAL_PRELOAD_TARGET, adaptiveSearchTarget(qq, activeType));

  allItems = [];
  serverPagedMode = true;
  authoritativeServerTotalItems = Math.max(target, INITIAL_PRELOAD_TARGET);
  progressivePagerPages = Math.min(
    MAX_PROGRESSIVE_PAGER_PAGES,
    Math.max(INITIAL_PROGRESSIVE_PAGER_PAGES, Math.ceil(Math.min(target, MAX_SMOOTH_CANDIDATES) / PAGE_SIZE))
  );
  serverTotalItems = Math.max(INITIAL_PRELOAD_TARGET, progressivePagerPages * PAGE_SIZE);
  loadedServerPages.clear();

  signalSanmaruSearch(qq, activeType, 'run-search');
  status.textContent = `Receiving ${getTypeLabel(activeType)} supply for "${qq}"...`;
  renderSkeleton();

  currentBlock = 0;
  currentPage = 1;
  // Page navigation is part of the fixed search header. Show it immediately
  // from the progressive target instead of waiting for the first network pack.
  drawPager();
  lastQuery = qq;
  lastType = activeType;
  pageImageEnrichCache.clear();
  itemImageEnrichCache.clear();
  expandedDisplayGroups.clear();

  let firstPaintDone = false;
  let intakeStarted = false;
  let intakeTimer = null;

  function startIntakeOnce(reason){
    if(intakeStarted || runSearch._seq !== seq) return;
    intakeStarted = true;
    if(intakeTimer) clearTimeout(intakeTimer);
    startContinuousIntake(qq, activeType, seq);
    status.textContent = `${serverTotalItems || allItems.length || INITIAL_PRELOAD_TARGET} results for "${qq}" · ${getTypeLabel(activeType)} · receiving...`;
  }

  function applySupplyPack(pack, sourceName){
    if(runSearch._seq !== seq || !pack) return 0;
    const normalized = normalizeSearchPayload(pack && pack.payload ? pack.payload : pack);
    const payload = normalized.payload || (pack && pack.payload) || pack || null;
    lastSearchPayload = payload || lastSearchPayload;

    const rawItems = Array.isArray(pack)
      ? pack
      : dedupeItems(filterSearchResultItems((pack && pack.items) || normalized.items || []));
    const pageItems = dedupeItems(filterSearchResultItems(pageItemsFromPack(pack)));
    const incoming = rawItems && rawItems.length ? rawItems : pageItems;
    if(!incoming || !incoming.length) return 0;

    // Cache the supply window immediately. Rendering still shows only the current
    // viewport, but pages 2~12 are already in memory when the user clicks them.
    const initialWindow = Math.min(
      MAX_SMOOTH_CANDIDATES,
      Math.max(INITIAL_PRELOAD_TARGET, incoming.length)
    );
    const windowItems = incoming.slice(0, initialWindow);
    allItems = mergeItemsPreferDisplayRichness(allItems, windowItems).slice(0, MAX_SMOOTH_CANDIDATES);
    seedLoadedServerPagesFromItems(allItems, Math.min(allItems.length, Math.max(INITIAL_PRELOAD_TARGET, windowItems.length)));
    if(pageItems.length) loadedServerPages.set(1, pageItems.slice(0, PAGE_SIZE));

    updateProgressiveTotalFromPayload(payload, Math.max(target, allItems.length, INITIAL_PRELOAD_TARGET), { expandAll:true });
    serverTotalItems = Math.max(serverTotalItems || 0, target, allItems.length, INITIAL_PRELOAD_TARGET);
    progressivePagerPages = Math.max(progressivePagerPages || 0, INITIAL_PROGRESSIVE_PAGER_PAGES, Math.ceil(Math.min(serverTotalItems, MAX_SMOOTH_CANDIDATES) / PAGE_SIZE));

    if(!firstPaintDone && allItems.length){
      firstPaintDone = true;
      renderPage(1);
    }else if(firstPaintDone && currentPage === 1){
      renderPage(1, true);
    }else if(firstPaintDone){
      drawPager();
    }
    status.textContent = `${serverTotalItems || allItems.length} results for "${qq}" · ${getTypeLabel(activeType)} · receiving...`;
    if(!intakeStarted && allItems.length >= 250){
      setTimeout(() => startIntakeOnce('receiver-250-open-pipe'), 0);
    }
    return incoming.length;
  }

  function wrapSupply(promise, kind){
    return promise.then(pack => ({ kind, pack })).catch(error => ({ kind, error }));
  }

  const instantPromise = wrapSupply(fetchInstantSearchPack(qq, activeType), 'sanmaru-instant');
  const maruWindowPromise = wrapSupply(fetchSearch(qq, activeType, 1), 'maru-search-window');

  try{
    const first = await Promise.race([instantPromise, maruWindowPromise]);
    if(runSearch._seq !== seq) return;

    const firstCount = first && !first.error ? applySupplyPack(first.pack, first.kind) : 0;
    if(!firstCount){
      const second = first && first.kind === 'sanmaru-instant' ? await maruWindowPromise : await instantPromise;
      if(runSearch._seq !== seq) return;
      if(second && !second.error) applySupplyPack(second.pack, second.kind);
    }

    if(!firstPaintDone){
      results.innerHTML = '';
      status.textContent = `No quick results for "${qq}" · receiving...`;
    }

    // Do not wait for Sanmaru/MaruSearch to finish all lanes. Start the faucet
    // shortly after first paint, but let the page-1 300-window seed pages 1~12
    // first when it arrives quickly.
    intakeTimer = setTimeout(() => startIntakeOnce('first-paint-timer'), 50);

    maruWindowPromise.then(res => {
      if(runSearch._seq !== seq || !res || res.error) return;
      applySupplyPack(res.pack, res.kind);
      startIntakeOnce('maru-page1-window-ready');
    });
    instantPromise.then(res => {
      if(runSearch._seq !== seq || !res || res.error) return;
      applySupplyPack(res.pack, res.kind);
    });
  }catch(e){
    console.error(e);
    const fallbackPack = await fetchSearch(qq, activeType, 1);
    if (runSearch._seq !== seq) return;
    applySupplyPack(fallbackPack, 'fallback-maru-search');
    if(!firstPaintDone){
      results.innerHTML = '';
      clearPager();
      status.textContent = `No results for "${qq}"`;
    }
    startIntakeOnce('fallback');
  }
}


  });
})();



/* ------------------------------------------------------------------
 * MARU Search Revenue Hook Loader
 * Added by revenue tracking patch.
 *
 * Purpose:
 * - Load /assets/js/maru-revenue-tracker.js
 * - Load /assets/js/maru-revenue-autohook.js
 * - Bind search submit/result impression/click events.
 * ------------------------------------------------------------------ */
(function loadMaruSearchRevenueHooks(){
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function loadScriptOnce(src, id, globalName, done){
    if (window[globalName]) {
      if (typeof done === "function") done();
      return;
    }

    var existing = document.getElementById(id);
    if (existing) {
      existing.addEventListener("load", function(){
        if (typeof done === "function") done();
      }, { once:true });
      existing.addEventListener("error", function(){
        console.warn("[MARU Search Revenue] failed to load:", src);
      }, { once:true });
      return;
    }

    var s = document.createElement("script");
    s.id = id;
    s.src = src;
    s.async = false;
    s.onload = function(){
      if (typeof done === "function") done();
    };
    s.onerror = function(){
      console.warn("[MARU Search Revenue] failed to load:", src);
    };

    (document.head || document.documentElement).appendChild(s);
  }

  function bindSearchRevenue(){
    try {
      if (
        window.MaruRevenueTracker &&
        typeof window.MaruRevenueTracker.bindSearch === "function" &&
        !window.__MARU_SEARCH_REVENUE_BIND_DONE__
      ) {
        window.__MARU_SEARCH_REVENUE_BIND_DONE__ = true;
        window.MaruRevenueTracker.bindSearch("#searchInput", "#searchResults", {
          pageType: "search",
          service: "search.js",
          buttonSelector: "#searchBtn"
        });
      }

      if (
        window.MaruRevenueAutoHook &&
        typeof window.MaruRevenueAutoHook.install === "function"
      ) {
        window.MaruRevenueAutoHook.install({
          service: "search.js",
          observeRootSelector: "#searchResults"
        });
      }
    } catch (e) {
      console.warn("[MARU Search Revenue] hook skipped:", e);
    }
  }

  function boot(){
    loadScriptOnce(
      "/assets/js/maru-revenue-tracker.js",
      "maruRevenueTrackerScript",
      "MaruRevenueTracker",
      function(){
        loadScriptOnce(
          "/assets/js/maru-revenue-autohook.js",
          "maruRevenueAutoHookScript",
          "MaruRevenueAutoHook",
          bindSearchRevenue
        );
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  } else {
    boot();
  }
})();
