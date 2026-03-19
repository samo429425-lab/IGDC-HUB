// IGDC Search.js — FULL SEARCH PIPELINE PATCH
// - collector first
// - bank fallback + supplement
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
    const FETCH_LIMIT = 1000;

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
        const key =
          (it.url || it.link || '').trim().toLowerCase() ||
          (it.id || '').trim().toLowerCase() ||
          ((it.title || '').trim().toLowerCase() + '|' + (it.source || it.source?.name || '').trim().toLowerCase());

        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }

      return out;
    }

async function fetchSearch(q){

  const url = `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=1000`;

  const r = await fetch(url, { cache: 'no-store' });

  if (!r.ok){
    throw new Error('HTTP ' + r.status);
  }

  const json = await r.json();

  if (!json){
    throw new Error('MARU_EMPTY');
  }

  if (json.status === 'error'){
    throw new Error('MARU_ERROR');
  }

  if (json.status === 'blocked'){
    throw new Error(json.reason || 'BLOCKED');
  }

  return normalizeItems(json);
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

      if (url) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => { window.location.href = url; });
      }

      const body = document.createElement('div');
      body.style.overflow = 'hidden';

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
      risk.textContent = it.riskLabel || 'safe';
      risk.style.fontSize = '11px';
      risk.style.fontWeight = '700';
      risk.style.marginTop = '6px';

      if ((it.riskLabel || '') === '⚠️ high-risk') {
      risk.style.color = 'red';
    } else if ((it.riskLabel || '') === '⚠️ medium-risk') {
      risk.style.color = 'orange';
    } else {
      risk.style.color = 'green';
    }

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

      if (it.mediaCandidate && !it.thumbnail && hasImageSet){
        it.thumbnail = it.imageSet[0];
      }

      const thumbUrl = (it.thumbnail || '').trim();
      const isFaviconLike =
        thumbUrl.includes('google.com/s2/favicons') ||
        thumbUrl.includes('favicon') ||
        thumbUrl.toLowerCase().endsWith('.ico');

      const isRealThumb = !!thumbUrl && !isFaviconLike;

      const hasVideoPreview =
        it.media &&
        ((it.media.type || it.media.kind) === 'video') &&
        it.media.preview &&
        (it.media.preview.mp4 || it.media.preview.webm || it.media.preview.poster);

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
        body.appendChild(thumb);
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

        body.appendChild(gallery);
      }

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

      try {

        const items = await fetchSearch(q);

        let collectorItems = items;

        const merged = dedupeItems([
          ...collectorItems
        ]);

    allItems = merged;

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

(function () {
  function runGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
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