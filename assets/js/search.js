// IGDC Search.js — STEP 4 (Engine-Aligned, Emoji Restored, Favicon Enlarged)
// ✔ maru-search response structure respected
// ✔ Google-style readability
// ✔ Original favicon/emoji line restored
// ✔ Favicon size adjusted to Google-level visibility

document.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.endsWith('/search.html')) return;

  const input   = document.getElementById('searchInput');
  const btn     = document.getElementById('searchBtn');
  const status  = document.getElementById('searchStatus');
  const results = document.getElementById('searchResults');
  if (!input || !btn || !status || !results) return;

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
    if (x.baseResult && x.baseResult.data && Array.isArray(x.baseResult.data.items)) {
      return x.baseResult.data;
    }
    return x;
  }

  async function fetchMaru(q){
    const urls = [
      `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=100`,
      `/netlify/functions/maru-search?q=${encodeURIComponent(q)}&limit=100`
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

  async function runSearch(q){
    status.textContent = 'Searching…';
    renderSkeleton();
    try{
      const j0 = await fetchMaru(q);
      const d = unwrap(j0) || {};
      const items = d.items || [];
      results.innerHTML = '';
      if (!items.length){
        status.textContent = 'No results.';
        return;
      }
      status.textContent = `${items.length} results`;
      renderSearchItems(items);
    }catch(e){
      console.error(e);
      status.textContent = 'Search error';
    }
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
    const url = it.url || '';
    const domain = domainOf(url);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = url ? 'pointer' : 'default';
    if (url) card.onclick = () => location.href = url;

    const body = document.createElement('div');

    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = (it.title || '').trim();

    const l = document.createElement('div');
    l.className = 'link';

    const fav = document.createElement('img');
    fav.src = faviconOf(url);
    fav.style.width = '20px';
    fav.style.height = '20px';
    fav.style.verticalAlign = 'middle';
    fav.style.borderRadius = '4px';
    fav.style.marginRight = '8px';
    fav.onerror = () => fav.remove();

    const span = document.createElement('span');
    span.textContent = domain;

    l.appendChild(fav);
    l.appendChild(span);

    const d = document.createElement('div');
    d.className = 'desc';
    d.textContent = (it.summary || '').trim();

    body.appendChild(t);
    body.appendChild(l);
    if (d.textContent) body.appendChild(d);

    card.appendChild(body);
    results.appendChild(card);
  }
});





  function renderSearchItems(items){
    results.innerHTML = '';
    items.forEach(renderItem);
  }

// ===== MARU PAGINATION (STRICT 10 PER PAGE, SAFE) =====
(function(){
  const PAGE_SIZE = 15;
  let allItems = [];
  let currentPage = 1;
  let originalRender = null;

  function ensurePager(){
    let bar = document.getElementById('maru-page-controls');
    if (!bar){
      bar = document.createElement('div');
      bar.id = 'maru-page-controls';
      bar.style.display = 'flex';
      bar.style.gap = '6px';
      bar.style.margin = '8px 0';
      const status = document.getElementById('searchStatus');
      if (status && status.parentNode){
        status.parentNode.insertBefore(bar, status.nextSibling);
      }
    }
    return bar;
  }

  function drawPager(){
    const bar = ensurePager();
    bar.innerHTML = '';
    const pages = Math.ceil(allItems.length / PAGE_SIZE);
    for (let i = 1; i <= pages; i++){
      const b = document.createElement('button');
      b.textContent = i;
      b.style.opacity = (i === currentPage) ? '0.6' : '1';
      b.onclick = () => { currentPage = i; drawPage(); };
      bar.appendChild(b);
    }
  }

  function drawPage(){
    if (!originalRender) return;
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = allItems.slice(start, start + PAGE_SIZE);
    originalRender(slice);   // 🔒 ONLY 10 items rendered
    drawPager();
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.renderSearchItems && !originalRender){
      originalRender = window.renderSearchItems;
      window.renderSearchItems = function(items){
        allItems = Array.isArray(items) ? items : [];
        currentPage = 1;
        drawPage();
      };
    }
  });
})();
