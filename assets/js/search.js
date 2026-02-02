// IGDC Search.js — QA (Stable Pipeline + Block Pagination) v2
// Fixes:
// 1) Open results in SAME tab (back button works).
// 2) Request up to 1000 items so page blocks beyond 10 pages can exist (◀ ▶ appear when needed).
// - 15 items per page
// - 10-page blocks with ◀ ▶ shifting
// - maru-search compatible: {status, items, results}

(function () {
  'use strict';

  function ready(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    const p = location.pathname || '';
    const isSearchPage = p.endsWith('/search.html') || p.endsWith('/search') || p.endsWith('/search/');
    if (!isSearchPage) {
      if (!document.getElementById('searchInput') || !document.getElementById('searchResults')) return;
    }

    const input   = document.getElementById('searchInput');
    const btn     = document.getElementById('searchBtn');
    const status  = document.getElementById('searchStatus');
    const results = document.getElementById('searchResults');
    if (!input || !btn || !status || !results) return;

    const PAGE_SIZE = 15;
    const BLOCK_SIZE = 10;
    const FETCH_LIMIT = 1000; // ✅ allow more than 10 pages

    let allItems = [];
    let currentPage = 1;
    let currentBlock = 0;

    const params = new URLSearchParams(location.search);
    const q0 = (params.get('q') || '').trim();
    if (q0) {
      input.value = q0;
      runSearch(q0);
    } else {
      status.textContent = '';
    }

    btn.onclick = () => {
      const q = input.value.trim();
      if (!q) return;
      const u = new URL(location.href);
      u.searchParams.set('q', q);
      history.replaceState(null, '', u.toString());
      runSearch(q);
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });

    function unwrap(x){
      if (!x) return x;
      if (x.data && Array.isArray(x.data.items)) return x.data;
      if (x.baseResult && Array.isArray(x.baseResult.items)) return x.baseResult;
      if (x.baseResult && x.baseResult.data && Array.isArray(x.baseResult.data.items)) return x.baseResult.data;
      return x;
    }

    async function fetchMaru(q){
      const urls = [
        `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=${FETCH_LIMIT}`,
        `/netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=${FETCH_LIMIT}`
      ];
      let lastErr;
      for (const u of urls){
        try{
          const r = await fetch(u, { cache: 'no-store' });
          if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
          return await r.json();
        }catch(e){ lastErr = e; }
      }
      throw lastErr;
    }

  async function fetchBank(){
    const urls = [
    '/.netlify/functions/data/search-bank.snapshot.json',
    '/data/search-bank.snapshot.json'
    ];
  for (const u of urls){
    try{
      const r = await fetch(u, { cache: 'no-store' });
      if (!r.ok) continue;
      return await r.json();
    }catch(e){}
  }
  return null;
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

    function renderItem(it){
      const url = it.url || it.link || '';
      const domain = domainOf(url);

      const card = document.createElement('div');
      card.className = 'card';

      // ✅ SAME TAB navigation so browser back works
      if (url) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => { window.location.href = url; });
      }

      const body = document.createElement('div');

      const t = document.createElement('div');
      t.className = 'title';

      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_self'; // ✅
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

      /* IGDC style: rounded-rect + clean light-blue border */
      fav.style.borderRadius = '6px';                 // 라디우스 사각형 유지
      fav.style.background = '#ffffff';
      fav.style.border = '1px solid #d6e4ff';         // 구글 느낌의 아주 연한 블루
      fav.style.boxShadow = '0 0 0 0 rgba(0,0,0,0)';  // 그림자 제거 (깔끔함 우선)
      fav.style.padding = '2px';                      // 아이콘 숨 고르기용 최소 패딩

      fav.onerror = () => fav.remove();


      const span = document.createElement('span');
      span.textContent = domain || (it.source || '');

      l.appendChild(fav);
      l.appendChild(span);

      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = (it.summary || it.description || '').trim();

      body.appendChild(t);
      body.appendChild(l);
      if (d.textContent) body.appendChild(d);

      card.appendChild(body);
	  
/* ===============================
   HYBRID SEARCH CARD RENDER (FINAL)
   - WEB/NEWS: stable card (no oversize)
   - MEDIA: show only when real media exists
   =============================== */

// 0) 카드 크기 안정화 (전체 공통)
card.style.maxHeight = '240px';
card.style.overflow = 'hidden';

// 1) 뉴스/기사 요약 절단 (웹/뉴스 공통)
if (d && d.textContent) {
  d.style.display = '-webkit-box';
  d.style.webkitLineClamp = '3';
  d.style.webkitBoxOrient = 'vertical';
  d.style.overflow = 'hidden';
  d.style.textOverflow = 'ellipsis';
}

// 2) 썸네일이 "진짜 이미지"인지 판별 (favicon/ico 제외)
const thumbUrl = (it.thumbnail || '').trim();
const isFaviconLike =
  thumbUrl.includes('google.com/s2/favicons') ||
  thumbUrl.includes('favicon') ||
  thumbUrl.toLowerCase().endsWith('.ico');

const isRealThumb = !!thumbUrl && !isFaviconLike;

// 3) 미디어 존재 판별 (진짜로 있을 때만 미디어 영역 렌더)
const hasVideoPreview =
  it.media && it.media.type === 'video' &&
  it.media.preview &&
  (it.media.preview.mp4 || it.media.preview.webm || it.media.preview.poster);

const hasImageSet =
  Array.isArray(it.imageSet) && it.imageSet.length > 0;

// 4) 기본은 WEB/NEWS 카드 (텍스트 중심)
//    미디어가 있으면 '보조 미디어'를 카드 안에 추가 (카드 크기 유지)

// 4-1) 보조 썸네일 (우측 작은 썸네일)
if (isRealThumb) {
  const thumb = document.createElement('img');
  thumb.src = thumbUrl;
  thumb.loading = 'lazy';

  thumb.style.maxWidth = '120px';
  thumb.style.maxHeight = '80px';
  thumb.style.objectFit = 'cover';
  thumb.style.float = 'right';
  thumb.style.marginLeft = '8px';
  thumb.style.borderRadius = '4px';

  // 텍스트 영역 안에서 우측 썸네일처럼 동작
  body.appendChild(thumb);
}

// 4-2) 비디오 프리뷰 (있을 때만, 카드 과대확대 금지)
if (hasVideoPreview) {
  const videoWrap = document.createElement('div');
  videoWrap.style.marginTop = '8px';
  videoWrap.style.maxHeight = '120px';
  videoWrap.style.overflow = 'hidden';
  videoWrap.style.borderRadius = '6px';

  const video = document.createElement('video');
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

  // hover play (데스크톱)
  videoWrap.addEventListener('mouseenter', () => {
    video.play().catch(()=>{});
  });
  videoWrap.addEventListener('mouseleave', () => {
    video.pause();
    video.currentTime = 0;
  });

  videoWrap.appendChild(video);
  card.appendChild(videoWrap);
}

// 4-3) 포토뷰(갤러리) (있을 때만, 최대 3장)
if (hasImageSet) {
  const gallery = document.createElement('div');
  gallery.style.display = 'flex';
  gallery.style.gap = '6px';
  gallery.style.marginTop = '8px';
  gallery.style.maxHeight = '90px';
  gallery.style.overflow = 'hidden';

  it.imageSet.slice(0,3).forEach(src => {
    const img = document.createElement('img');
    img.src = src;
    img.loading = 'lazy';
    img.style.width = '33%';
    img.style.maxHeight = '90px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '4px';
    gallery.appendChild(img);
  });

  card.appendChild(gallery);
}


      results.appendChild(card);
    }

    function renderPage(page){
      results.innerHTML = '';
      const start = (page - 1) * PAGE_SIZE;
      const slice = allItems.slice(start, start + PAGE_SIZE);
      slice.forEach(renderItem);
      drawPager();
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
          renderPage(currentPage);
        };
        bar.appendChild(left);
      }

      for (let p = blockStart; p <= blockEnd; p++){
        const b = document.createElement('button');
        b.textContent = String(p);
        b.style.opacity = (p === currentPage) ? '0.6' : '1';
        b.onclick = () => { currentPage = p; renderPage(currentPage); };
        bar.appendChild(b);
      }

      if (blockEnd < pages){
        const right = document.createElement('button');
        right.textContent = '▶';
        right.onclick = () => {
          const maxBlock = Math.floor((pages - 1) / BLOCK_SIZE);
          currentBlock = Math.min(maxBlock, currentBlock + 1);
          currentPage = currentBlock * BLOCK_SIZE + 1;
          renderPage(currentPage);
        };
        bar.appendChild(right);
      }
    }

async function runSearch(q){
  status.textContent = 'Searching…';
  renderSkeleton();
  clearPager();

  try {

    const bank = await fetchBank();
    const bankItems = Array.isArray(bank && bank.items)
      ? bank.items.filter(it =>
          (it.title || '').toLowerCase().includes(q.toLowerCase()) ||
          (it.summary || '').toLowerCase().includes(q.toLowerCase())
        )
      : [];

    if (bankItems.length){
      allItems = bankItems;
    } else {
      const j0 = await fetchMaru(q);
      const d = unwrap(j0) || {};
      const items = d.items || d.results || [];
      allItems = Array.isArray(items) ? items : [];
    }

    status.textContent = `${allItems.length} results`;
    currentBlock = 0;
    currentPage = 1;
    renderPage(currentPage);

  } catch(e){
    console.error(e);
    results.innerHTML = '';
    status.textContent = 'Search error';
  }
}

  });
})();
