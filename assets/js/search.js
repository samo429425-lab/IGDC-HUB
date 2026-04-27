// IGDC Search.js — FULL SEARCH PIPELINE PATCH
// PATCH: natural media card height v6 + tabs + meaningful-image-filter
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
  ['sns', 'SNS'],
  ['blog', '블로그'],
  ['cafe', '카페'],
  ['shopping', '쇼핑'],
  ['sports', '스포츠'],
  ['finance', '증권'],
  ['webtoon', '웹툰']
];

function normalizeSearchType(v){
  const raw = String(v || '').trim().toLowerCase();
  const allowed = new Set(SEARCH_TABS.map(x => x[0]));
  return allowed.has(raw) ? raw : 'all';
}

function getTypeLabel(type){
  const hit = SEARCH_TABS.find(x => x[0] === normalizeSearchType(type));
  return hit ? hit[1] : '전체';
}

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
      renderPage(currentPage);
    });
    return;
  }

  // 5️⃣ 바로 페이지 복원
  currentPage = page;
  currentBlock = block;
  renderPage(currentPage);
});

if (q0) {
  input.value = q0;
}

ensureSearchTabs();
updateSearchTabsActive();

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


    function isLikelyMeaninglessImageUrlClient(imageUrl){
      const s = String(imageUrl || '').toLowerCase();
      if(!s) return true;

      const bad = [
        'favicon', 'logo', 'symbol', 'emblem', 'slogan', 'brand',
        '/ci', '_ci', '-ci', '/bi', '_bi', '-bi',
        'placeholder', 'noimage', 'no_image', 'default-image', 'default_img',
        'sprite', 'button', 'btn_', '/btn', 'sns_logo', 'kakao', 'facebook',
        'header_logo', 'footer_logo'
      ];

      if(bad.some(k => s.includes(k))) return true;
      if(/\.(svg|ico)(\?|#|$)/i.test(s)) return true;

      return false;
    }

    function isGenericGovOfficialItemClient(it){
      const url = String((it && (it.url || it.link)) || '').toLowerCase();
      const host = domainOf(url).toLowerCase();
      const title = String((it && it.title) || '').toLowerCase();
      const summary = String((it && (it.summary || it.description)) || '').toLowerCase();
      const text = `${title} ${summary} ${url}`;

      const isGov =
        host.includes('.go.kr') ||
        host.endsWith('.gov') ||
        host.includes('.gov.') ||
        host.includes('gov.uk') ||
        host.includes('go.jp') ||
        host.includes('gov.cn');

      if(!isGov) return false;

      const meaningfulTerms = [
        '관광', '여행', '명소', '야경', '축제', '행사', '문화', '공연',
        '갤러리', '사진', '포토', '한컷', '리포트', '스토리', '영상',
        'tour', 'travel', 'visit', 'photo', 'gallery', 'festival', 'culture',
        'landmark', 'attraction', 'story', 'video'
      ];

      return !meaningfulTerms.some(k => text.includes(k));
    }

    function isMeaningfulImageForItemClient(imageUrl, it){
      const s = String(imageUrl || '').trim();
      if(!s) return false;

      const source = String((it && it.source) || '').toLowerCase();
      const type = String((it && it.type) || '').toLowerCase();
      const mediaType = String((it && it.mediaType) || '').toLowerCase();

      const isMediaResult =
        source.includes('image') ||
        source.includes('youtube') ||
        type === 'image' ||
        type === 'video' ||
        mediaType === 'image' ||
        mediaType === 'video';

      if(isLikelyMeaninglessImageUrlClient(s) && !isMediaResult) return false;
      if(isGenericGovOfficialItemClient(it) && !isMediaResult) return false;

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

    function renderItem(it){
      const url = it.url || it.link || '';
      const domain = domainOf(url);

      const card = document.createElement('div');
      card.className = 'card';

      if (url) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => { window.location.href = url; });
      }

      const body = document.createElement('div');
      body.style.overflow = 'visible';

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

  body.appendChild(t);

const risk = document.createElement('div');
risk.style.fontSize = '11px';
risk.style.fontWeight = '700';
risk.style.marginTop = '6px';

if (it.riskLabel === '⚠️ high-risk') {
  risk.textContent = it.riskLabel;
  risk.style.color = 'red';
  body.appendChild(risk);

} else if (it.riskLabel === '⚠️ medium-risk') {
  risk.textContent = it.riskLabel;
  risk.style.color = 'orange';
  body.appendChild(risk);

}
// 그 외는 아예 표시 안 함 (safe 제거)

      body.appendChild(risk);
      body.appendChild(l);
      if (d.textContent) body.appendChild(d);

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

      if (isRealThumb) {
        const mediaWrap = document.createElement('div');
        mediaWrap.className = 'maru-card-media';
        mediaWrap.style.marginTop = '10px';
        mediaWrap.style.display = 'grid';
        mediaWrap.style.gap = '6px';
        mediaWrap.style.gridTemplateColumns =
          naturalImages.length >= 3 ? '1.4fr 1fr 1fr' :
          naturalImages.length === 2 ? '1fr 1fr' :
          '1fr';
        mediaWrap.style.width = '100%';
        mediaWrap.style.maxWidth = naturalImages.length === 1 ? '420px' : '760px';
        mediaWrap.style.overflow = 'hidden';

        naturalImages.forEach((src) => {
          const img = document.createElement('img');
          img.src = src;
          img.loading = 'lazy';
          img.alt = '';
          img.style.display = 'block';
          img.style.width = '100%';
          img.style.height = naturalImages.length === 1 ? '150px' : '135px';
          img.style.objectFit = 'cover';
          img.style.borderRadius = '8px';
          img.style.background = '#f8fafc';
          img.style.border = '1px solid #eef2f7';
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
      results.appendChild(card);
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
      slice.forEach(renderItem);
      drawPager();

      if(!skipEnrich){
        enrichRenderedPageImages(page, slice, start);
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

