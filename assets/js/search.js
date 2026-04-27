// IGDC Search.js — FULL SEARCH PIPELINE PATCH
// PATCH: fast balanced vertical tabs v1 + naver-like adaptive media cards + stable display groups + marker-url back bridge
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
    document.getElementById('globalSearchInput');

  if (!isSearchPage && !hasSearchUI) return;

    const input   = document.getElementById('searchInput');
    const btn     = document.getElementById('searchBtn');
    const status  = document.getElementById('searchStatus');
    const results = document.getElementById('searchResults');
        
    if (!input || !btn) return;

    const PAGE_SIZE = 15;
    const BLOCK_SIZE = 10;
    const FETCH_LIMIT = 1000;

    let allItems = [];
    let currentPage = 1;
    let currentBlock = 0;
    let activeType = 'all';
    let lastQuery = '';
    let lastType = 'all';
    const pageImageEnrichCache = new Set();
    const itemImageEnrichCache = new Map();
    const expandedDisplayGroups = new Set();

const params = new URLSearchParams(location.search);
const q0 = (params.get('q') || '').trim();
const from0 = (params.get('from') || '').trim();

const SEARCH_TABS = [
  ['all', '전체'],
  ['image', '이미지'],
  ['news', '뉴스'],
  ['map', '지도'],
  ['knowledge', '지식'],
  ['tour', '관광'],
  ['video', '영상'],
  ['sns', '소셜'],
  ['blog', '블로그'],
  ['cafe', '카페'],
  ['book', '도서'],
  ['shopping', '쇼핑'],
  ['sports', '스포츠'],
  ['finance', '증권'],
  ['webtoon', '웹툰']
];

function normalizeSearchType(v){
  const raw = String(v || '').trim().toLowerCase();
  const allowed = new Set(SEARCH_TABS.map(x => x[0]));
  const alias = { books: 'book', 도서: 'book', 책: 'book', sns: 'sns', social: 'sns' };
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
    }

    @media (max-width: 720px) {
      .maru-search-card-body {
        display: block;
      }
      .maru-card-media {
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

function isSearchBackMarkerUrl() {
  try {
    return (new URLSearchParams(location.search).get('__igdc_back') || '') === '1';
  } catch (e) {
    return false;
  }
}

function cleanSearchBackMarkerUrl() {
  const u = new URL(location.href);
  u.searchParams.delete('__igdc_back');
  return u.pathname + u.search + u.hash;
}

function makeSearchBackMarkerUrl() {
  const u = new URL(location.href);
  u.searchParams.set('__igdc_back', '1');
  return u.pathname + u.search + u.hash;
}

function resolveSearchReturnUrl(state) {
  const s = state || history.state || {};
  const fromState = (s && s.from) ? String(s.from) : '';
  if (fromState) {
    try {
      const u = new URL(fromState, location.origin);
      if (u.origin === location.origin) return u.pathname + u.search + u.hash;
    } catch (e) {}
  }
  return getSafeReturnUrl() || '/home.html';
}

function goSearchReturnUrl(state) {
  const returnUrl = resolveSearchReturnUrl(state);
  location.replace(returnUrl);
}

function buildSearchUrl(q) {
  const u = new URL('/search.html', location.origin);
  u.searchParams.set('q', q);
  if (activeType && activeType !== 'all') {
    u.searchParams.set('type', activeType);
  }

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

  // If the browser has restored the synthetic back marker entry directly,
  // immediately resolve it to the real return page.
  if (isSearchBackMarkerUrl()) {
    goSearchReturnUrl({ from: returnUrl });
    return;
  }

  const state = history.state || {};
  const cleanUrl = cleanSearchBackMarkerUrl();
  const markerUrl = makeSearchBackMarkerUrl();

  // Avoid stacking the bridge repeatedly. Rebuild only if the current entry
  // is not the active bridge entry for the same return target.
  if (state && state.__searchBridgeCurrent && state.from === returnUrl) return;

  // Important:
  // entry 0 is NOT the same URL. It has __igdc_back=1.
  // This makes Chrome's top-left Back arrow traverse to a distinct URL entry,
  // so popstate is reliable without needing a hard reload.
  history.replaceState(
    {
      __searchBridgeInstalled: true,
      __searchBridgeReturn: true,
      q: q0 || '',
      type: activeType || 'all',
      from: returnUrl
    },
    '',
    markerUrl
  );

  history.pushState(
    {
      __searchBridgeInstalled: true,
      __searchBridgeCurrent: true,
      q: q0 || '',
      type: activeType || 'all',
      from: returnUrl
    },
    '',
    cleanUrl
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
      renderPage(currentPage);
    });
  } else if (run && !qp) {
    allItems = [];
    results.innerHTML = '';
    clearPager();
    status.textContent = '';
  }
}

window.addEventListener('popstate', (e) => {
  if (!isSearchPage) return;

  const state = e.state || {};

  // 1️⃣ 검색 진입 이전 페이지로 복귀
  if (isSearchBackMarkerUrl() || state.__searchBridgeReturn || state.__searchEntry) {
    goSearchReturnUrl(state);
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
      renderPage(currentPage);
    });
    return;
  }

  // 5️⃣ 바로 페이지 복원
  currentPage = page;
  currentBlock = block;
  renderPage(currentPage);
});


window.addEventListener('pageshow', () => {
  if (!isSearchPage) return;
  if (isSearchBackMarkerUrl()) {
    goSearchReturnUrl(history.state || {});
  }
});

if (q0) {
  input.value = q0;
}

ensureSearchTabs();
updateSearchTabsActive();
ensureSearchHistoryBridge();

if (q0) {
  syncSearchFromUrl(true);
} else {
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
      runSearch(q, activeType);
      return;
    }

    const u = new URL(location.href);
    u.searchParams.set('q', q);
    u.searchParams.delete('__igdc_back');
    u.searchParams.set('page', '1');
    u.searchParams.set('block', '0');
    if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
    else u.searchParams.delete('type');

    const safeReturnUrl = getSafeReturnUrl();
    if (safeReturnUrl) {
      u.searchParams.set('from', safeReturnUrl);
    }

    history.pushState({ q, type: activeType, from: safeReturnUrl || '' }, '', u.toString());
    runSearch(q, activeType);
    return;
  }

  window.location.assign(buildSearchUrl(q));
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
      runSearch(q, activeType);
      return;
    }

    const u = new URL(location.href);
    u.searchParams.set('q', q);
    u.searchParams.delete('__igdc_back');
    u.searchParams.set('page', '1');
    u.searchParams.set('block', '0');
    if (activeType && activeType !== 'all') u.searchParams.set('type', activeType);
    else u.searchParams.delete('type');

    const safeReturnUrl = getSafeReturnUrl();
    if (safeReturnUrl) {
      u.searchParams.set('from', safeReturnUrl);
    }

    history.pushState({ q, type: activeType, from: safeReturnUrl || '' }, '', u.toString());
    runSearch(q, activeType);
    return;
  }

  window.location.assign(buildSearchUrl(q));
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

async function fetchSearch(q, type = activeType){
  const safeType = normalizeSearchType(type);
  const url = `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=${FETCH_LIMIT}&type=${encodeURIComponent(safeType)}&tab=${encodeURIComponent(safeType)}`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return [];

    const json = await r.json();
    if (!json) return [];
    if (json.status === 'error') return [];
    if (json.status === 'blocked') return [];

    return normalizeItems(json);
  } catch (e) {
    console.error('fetchSearch failed:', e);
    return [];
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

      const safeReturnUrl = getSafeReturnUrl();
      if (safeReturnUrl) {
        u.searchParams.set('from', safeReturnUrl);
      }

      history.pushState({ q, type: activeType, page: 1, block: 0, from: safeReturnUrl || '' }, '', u.toString());
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
        'captcha'
      ];

      if(hardBad.some(k => s.includes(k))) return true;
      if(/\.(ico)(\?|#|$)/i.test(s)) return true;
      if(/\.(svg)(\?|#|$)/i.test(s) && /(logo|symbol|icon|emblem|brand|ci|bi)/i.test(s)) return true;

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

    function isMeaningfulImageForItemClient(imageUrl, it){
      const s = String(imageUrl || '').trim();
      if(!s) return false;
      if(!/^https?:\/\//i.test(s) && !s.startsWith('/')) return false;
      if(isHardRejectImageUrlClient(s)) return false;
      return true;
    }


    function collectNaturalImages(it){
      const sourceText = String((it && it.source) || '').toLowerCase();
      const raw = []
        .concat(it && it.thumbnail ? [it.thumbnail] : [])
        .concat(it && it.thumb ? [it.thumb] : [])
        .concat(it && it.image ? [it.image] : [])
        .concat(Array.isArray(it && it.imageSet) ? it.imageSet : []);

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

        let key = s.split('#')[0].toLowerCase();
        try {
          const u = new URL(s, location.origin);
          key = (u.origin + u.pathname).toLowerCase();
        } catch(e) {}

        if (seen.has(key)) return;

        seen.add(key);
        out.push(s);
      });

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


    function displayGroupOfItem(it){
      return String((it && it.displayGroup) || '').trim() || inferDisplayGroupClient(it);
    }

    function inferDisplayGroupClient(it){
      const source = String((it && it.source) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const summary = String((it && (it.summary || it.description)) || '').toLowerCase();
      const url = String((it && (it.url || it.link)) || '').toLowerCase();
      const host = domainOf(url).toLowerCase();
      const text = `${source} ${type} ${mediaType} ${title} ${summary} ${host}`;

      if (source.includes('news') || type === 'news' || text.includes('뉴스') || text.includes('속보') || text.includes('latest') || text.includes('breaking')) return 'news';
      if (mediaType === 'image' || type === 'image' || mediaType === 'video' || type === 'video' || source.includes('image') || source.includes('youtube')) return 'media';
      if (source.includes('local') || source.includes('map') || text.includes('관광') || text.includes('여행') || text.includes('지도') || text.includes('맛집') || text.includes('공원') || text.includes('landmark') || text.includes('tour')) return 'local_tour';
      if (source.includes('blog') || source.includes('cafe') || text.includes('블로그') || text.includes('카페')) return 'community';
      if (host.includes('instagram.') || host.includes('facebook.') || host.includes('tiktok.') || host.includes('x.com') || host.includes('twitter.') || source.includes('sns') || source.includes('social')) return 'social';
      if (source.includes('encyc') || source.includes('kin') || source.includes('book') || text.includes('지식') || text.includes('도서') || text.includes('책 ')) return 'knowledge';
      if (host.includes('.go.kr') || host.endsWith('.gov') || host.includes('.gov.') || host.includes('korea.kr')) return 'authority';
      return 'web';
    }

    function displayGroupLabel(group, sample){
      const fallback = sample && sample.displayGroupLabel;
      const labels = {
        authority: '공식/권위',
        news: '뉴스',
        local_tour: '지도/관광/지역',
        media: '이미지/영상',
        social: '소셜',
        community: '블로그/카페/커뮤니티',
        knowledge: '지식/도서',
        shopping: '쇼핑',
        sports: '스포츠',
        finance: '금융',
        webtoon: '웹툰',
        web: '웹'
      };
      return fallback || labels[group] || '웹';
    }

    function displayGroupPreviewLimit(group, sample){
      const n = parseInt(sample && sample.displayGroupPreviewLimit, 10);
      if (n > 0) return n;

      const limits = {
        authority: 3,
        news: 4,
        local_tour: 4,
        media: 4,
        social: 3,
        community: 3,
        knowledge: 3,
        shopping: 3,
        sports: 3,
        finance: 3,
        webtoon: 3,
        web: 15
      };
      return limits[group] || 3;
    }

    function shouldUseDisplayGroups(slice){
      if (!Array.isArray(slice) || !slice.length) return false;
      if (normalizeSearchType(activeType) !== 'all') return false;
      return slice.some(it => it && (it.displayGroup || it.displayGroupLabel));
    }

    function groupSliceForDisplay(slice){
      const order = ['authority','news','local_tour','media','social','community','knowledge','shopping','sports','finance','webtoon','web'];
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

    function renderGroupedSlice(slice, page){
      const groups = groupSliceForDisplay(slice);
      groups.forEach(groupInfo => {
        const section = document.createElement('section');
        section.className = 'maru-display-section';
        section.dataset.group = groupInfo.group;

        const head = document.createElement('div');
        head.className = 'maru-display-section-head';

        const title = document.createElement('div');
        title.className = 'maru-display-section-title';
        title.textContent = groupInfo.label;

        const meta = document.createElement('div');
        meta.className = 'maru-display-section-meta';
        meta.textContent = `${groupInfo.items.length}개`;

        head.appendChild(title);
        head.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'maru-display-section-body';

        const stateKey = `${lastQuery || input.value || ''}::${activeType || 'all'}::${page}::${groupInfo.group}`;
        const expanded = expandedDisplayGroups.has(stateKey);
        const limit = Math.max(1, groupInfo.previewLimit || 3);

        groupInfo.items.forEach((it, idx) => {
          const card = renderItem(it, body);
          if (!expanded && idx >= limit) {
            card.style.display = 'none';
            card.dataset.maruCollapsed = '1';
          }
        });

        const hiddenCount = Math.max(0, groupInfo.items.length - limit);
        if (hiddenCount > 0) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'maru-display-more';
          more.textContent = expanded ? '접기' : `${groupInfo.label} ${hiddenCount}개 더보기`;
          more.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const willExpand = !expandedDisplayGroups.has(stateKey);
            if (willExpand) expandedDisplayGroups.add(stateKey);
            else expandedDisplayGroups.delete(stateKey);

            Array.from(body.querySelectorAll('[data-maru-collapsed="1"]')).forEach(card => {
              card.style.display = willExpand ? '' : 'none';
            });
            more.textContent = willExpand ? '접기' : `${groupInfo.label} ${hiddenCount}개 더보기`;
          });
          body.appendChild(more);
        }

        section.appendChild(head);
        section.appendChild(body);
        results.appendChild(section);
      });
    }


    function renderItem(it, mountTarget){
      const url = it.url || it.link || '';
      const domain = domainOf(url);

      const card = document.createElement('div');
      card.className = 'card';

      if (url) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => { window.location.href = url; });
      }

      const body = document.createElement('div');
      body.className = 'maru-search-card-body';
      body.style.overflow = 'visible';

      const textCol = document.createElement('div');
      textCol.className = 'maru-search-card-text';

      const t = document.createElement('div');
      t.className = 'title';

      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_self';
        a.rel = 'noopener';
        a.textContent = (it.title || '').trim() || '(no title)';
        a.style.color = 'inherit';
        a.style.textDecoration = 'none';
        t.appendChild(a);
      } else {
        t.textContent = (it.title || '').trim() || '(no title)';
      }

      const l = document.createElement('div');
      l.className = 'link';

      const fav = document.createElement('img');
      fav.src = faviconOf(url);
      fav.style.width = '23px';
      fav.style.height = '23px';
      fav.style.verticalAlign = 'middle';
      fav.style.marginRight = '10px';
      fav.style.borderRadius = '6px';
      fav.style.background = '#ffffff';
      fav.style.border = '1px solid #d6e4ff';
      fav.style.boxShadow = '0 0 0 0 rgba(0,0,0,0)';
      fav.style.padding = '2px';
      fav.onerror = () => fav.remove();

      const span = document.createElement('span');
      span.textContent = domain || (it.source?.name || it.source || '');

      l.appendChild(fav);
      l.appendChild(span);

      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = (it.summary || it.description || '').trim();

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

      textCol.appendChild(risk);
      textCol.appendChild(l);
      if (d.textContent) textCol.appendChild(d);

      if (d && d.textContent) {
        d.style.display = '-webkit-box';
        d.style.webkitLineClamp = '3';
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

      if (isRealThumb) {
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

      if (hasVideoPreview) {
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


    function renderPage(page, skipEnrich = false){
      results.innerHTML = '';
      const start = (page - 1) * PAGE_SIZE;
      const slice = allItems.slice(start, start + PAGE_SIZE);

      if (shouldUseDisplayGroups(slice)) {
        renderGroupedSlice(slice, page);
      } else {
        slice.forEach(it => renderItem(it));
      }

      drawPager();

      if(!skipEnrich){
        enrichRenderedPageImages(page, slice, start);
      }
    }

function updateSearchPageHistory(page, block) {
  if (!isSearchPage) return;

  const u = new URL(location.href);
  u.searchParams.delete('__igdc_back');
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
  const pages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  if (pages <= 1) { clearPager(); return; }

  const bar = ensurePager();
  bar.innerHTML = '';

  const blockStart = currentBlock * BLOCK_SIZE + 1;
  const blockEnd = Math.min(blockStart + BLOCK_SIZE - 1, pages);

  if (blockStart > 1){
    const left = document.createElement('button');
    left.textContent = '◀';
    left.onclick = () => {
      currentBlock = Math.max(0, currentBlock - 1);
      currentPage = currentBlock * BLOCK_SIZE + 1;
      updateSearchPageHistory(currentPage, currentBlock);
      renderPage(currentPage);
    };
    bar.appendChild(left);
  }

  for (let p = blockStart; p <= blockEnd; p++){
    const b = document.createElement('button');
    b.textContent = String(p);
    b.style.opacity = (p === currentPage) ? '0.6' : '1';
    b.onclick = () => {
      currentPage = p;
      currentBlock = Math.floor((p - 1) / BLOCK_SIZE);
      updateSearchPageHistory(currentPage, currentBlock);
      renderPage(currentPage);
    };
    bar.appendChild(b);
  }

  if (blockEnd < pages){
    const right = document.createElement('button');
    right.textContent = '▶';
    right.onclick = () => {
      const maxBlock = Math.floor((pages - 1) / BLOCK_SIZE);
      currentBlock = Math.min(maxBlock, currentBlock + 1);
      currentPage = currentBlock * BLOCK_SIZE + 1;
      updateSearchPageHistory(currentPage, currentBlock);
      renderPage(currentPage);
    };
    bar.appendChild(right);
  }
}

async function runSearch(q, type = activeType){
  const qq = (q || '').trim();
  activeType = normalizeSearchType(type);
  updateSearchTabsActive();
  if (!qq){
    allItems = [];
    results.innerHTML = '';
    clearPager();
    status.textContent = '';
    return;
  }

  status.textContent = `Searching ${getTypeLabel(activeType)} for "${qq}"...`;
  renderSkeleton();
  clearPager();

  try {
    const items = await fetchSearch(qq, activeType);
    allItems = dedupeItems([...(items || [])]);

    pageImageEnrichCache.clear();
    itemImageEnrichCache.clear();
    expandedDisplayGroups.clear();

    currentBlock = 0;
    currentPage = 1;
    lastQuery = qq;
    lastType = activeType;

    if (!allItems.length) {
      results.innerHTML = '';
      status.textContent = `No results for "${qq}"`;
      return;
    }

    renderPage(1);
    status.textContent = `${allItems.length} results for "${qq}" · ${getTypeLabel(activeType)}`;

  } catch(e){
    console.error(e);
    allItems = [];
    results.innerHTML = '';
    clearPager();
    status.textContent = `No results for "${qq}"`;
  }
}
  });
})();

(function () {
  function runGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    if (!input) return;

    const q = input.value.trim();
    if (!q) return;

    const u = new URL('/search.html', location.origin);
    u.searchParams.set('q', q);
    u.searchParams.set('from', location.pathname + location.search + location.hash);

    window.location.href = u.pathname + u.search + u.hash;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('globalSearchBtn');
    const input = document.getElementById('globalSearchInput');

    if (btn) btn.addEventListener('click', runGlobalSearch);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') runGlobalSearch();
      });
    }
  });
})();

