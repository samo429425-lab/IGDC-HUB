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

      try{
        const j0 = await fetchMaru(q);
        const d = unwrap(j0) || {};

        if (d && d.status && d.status !== 'ok') {
          results.innerHTML = '';
          status.textContent = d.message || 'Search error';
          return;
        }

        const items = d.items || d.results || [];
        allItems = Array.isArray(items) ? items : [];

        results.innerHTML = '';
        if (!allItems.length){
          status.textContent = 'No results.';
          return;
        }

        status.textContent = `${allItems.length} results`;
        currentBlock = 0;
        currentPage = 1;
        renderPage(currentPage);
      }catch(e){
        console.error(e);
        results.innerHTML = '';
        status.textContent = 'Search error';
      }
    }
  });
})();
