// IGDC Search.js — STEP 1+2 (Additive Only)
// - Skeleton UI for instant feedback
// - Expanded thumbnail bowl (no feature removal)
// NOTE: All existing pipelines preserved. No triggers removed.

document.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.endsWith('/search.html')) return;

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const results = document.getElementById('searchResults');
  if (!input || !btn || !status || !results) return;

  const params = new URLSearchParams(location.search);
  const q0 = (params.get('q') || '').trim();
  if (q0) { input.value = q0; runSearch(q0); }
  else status.textContent = '';

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
    if (x.data && (Array.isArray(x.data.items) || Array.isArray(x.data.results))) return x.data;
    if (x.baseResult && (Array.isArray(x.baseResult.items) || Array.isArray(x.baseResult.results))) return x.baseResult;
    if (x.baseResult && x.baseResult.data && (Array.isArray(x.baseResult.data.items) || Array.isArray(x.baseResult.data.results))) return x.baseResult.data;
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
        if (!r.ok) { lastErr = new Error('HTTP '+r.status); continue; }
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
        <div style="display:flex;gap:12px">
          <div style="width:96px;height:64px;background:#eee;border-radius:6px"></div>
          <div style="flex:1">
            <div style="height:14px;width:60%;background:#eee;margin-bottom:8px"></div>
            <div style="height:12px;width:90%;background:#f0f0f0"></div>
          </div>
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
      const items = d.items || d.results || [];
      results.innerHTML = '';
      if (!items.length) {
        status.textContent = 'No results.';
        return;
      }
      status.textContent = `${items.length} results`;
      items.forEach(render);
    }catch(e){
      console.error(e);
      status.textContent = 'Search error';
    }
  }

  function domainOf(url){
    try{ return new URL(url).hostname.replace(/^www\./,''); }catch(e){ return ''; }
  }

  function faviconOf(url){
    const d = domainOf(url);
    return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : '';
  }

  function detectSourceByUrl(url){
    const u = (url || '').toLowerCase();
    if (u.includes('wikipedia.org')) return { n:'Wikipedia' };
    if (u.includes('youtube.com') || u.includes('youtu.be')) return { n:'YouTube' };
    if (u.includes('google.')) return { n:'Google' };
    if (u.includes('bing.') || u.includes('microsoft.com')) return { n:'Bing/MS' };
    if (u.includes('naver.')) return { n:'NAVER' };
    if (u.includes('reuters.com')) return { n:'Reuters' };
    if (u.includes('nytimes.com')) return { n:'NYTimes' };
    return { n:'Web' };
  }

  function pickThumbnail(it){
    return (
      it.thumbnail ||
      it.image ||
      it.ogImage ||
      (Array.isArray(it.images) ? it.images[0] : null) ||
      it.videoThumbnail ||
      null
    );
  }

  function render(it){
    const url = it.url || it.link || '';
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = url ? 'pointer' : 'default';
    if (url) card.onclick = () => { location.href = url; };

    const thumbSrc = pickThumbnail(it);
    if (thumbSrc){
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = thumbSrc;
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    const body = document.createElement('div');

    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = (it.title || it.name || 'Untitled').trim();

    const d = document.createElement('div');
    d.className = 'desc';
    d.textContent = (it.summary || it.description || it.snippet || '').trim();

    const m = document.createElement('div');
    m.className = 'meta';
    const src = detectSourceByUrl(url);
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = `${src.n}`;

    const favUrl = faviconOf(url);
    if (favUrl) {
      const fav = document.createElement('img');
      fav.className = 'favicon';
      fav.src = favUrl;
      fav.alt = '';
      fav.loading = 'lazy';
      fav.onerror = () => fav.remove();
      m.appendChild(fav);
    }

    m.appendChild(b);
    const dom = document.createElement('span');
    dom.className = 'domain';
    dom.textContent = domainOf(url);
    m.appendChild(dom);

    body.appendChild(t);
    if (d.textContent) body.appendChild(d);
    body.appendChild(m);

    card.appendChild(body);
    results.appendChild(card);
  }
});
