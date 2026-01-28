
/* ================= IGDC Search.js — RICH CARDS CANONICAL v2 =================
 * GUARANTEES:
 * 1) NO result limiting (no slice/pageSize)
 * 2) NO source pruning (all multi-source fan-out preserved)
 * 3) NO pipeline changes (engine/bridge/snapshot/feed untouched)
 * 4) ADAPTER-ONLY: accepts every known result shape, never deletes fields
 * ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.endsWith('/search.html')) return;

  const input =
    document.getElementById('searchInput') ||
    document.getElementById('q');

  const btn =
    document.getElementById('searchBtn');

  const status =
    document.getElementById('searchStatus') ||
    document.getElementById('status');

  const results =
    document.getElementById('searchResults') ||
    document.getElementById('results');

  if (!input || !btn || !status || !results) return;

  let __ALL_ITEMS__ = [];

  /* ---------- ADAPTERS (non-destructive) ---------- */
  function unwrapResponse(x){
    if (!x) return {};
    if (Array.isArray(x.items) || Array.isArray(x.results)) return x;
    if (x.data && (Array.isArray(x.data.items) || Array.isArray(x.data.results))) return x.data;
    if (x.baseResult) {
      if (Array.isArray(x.baseResult.items) || Array.isArray(x.baseResult.results)) return x.baseResult;
      if (x.baseResult.data) return x.baseResult.data;
    }
    return x;
  }

  async function fetchMaru(q){
    const endpoints = [
      '/.netlify/functions/maru-search',
      '/netlify/functions/maru-search'
    ];
    let lastErr;
    for (const ep of endpoints){
      try{
        const r = await fetch(`${ep}?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        if (!r.ok) { lastErr = new Error(r.status); continue; }
        return await r.json();
      }catch(e){ lastErr = e; }
    }
    throw lastErr;
  }

  /* ---------- HELPERS ---------- */
  function domainOf(url){
    try { return new URL(url).hostname.replace(/^www\./,''); }
    catch(e){ return ''; }
  }

  function faviconOf(url){
    const d = domainOf(url);
    return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : '';
  }

  function sourceBadge(url){
    const u = (url || '').toLowerCase();
    if (u.includes('wikipedia.org')) return { t:'Wikipedia', i:'📘' };
    if (u.includes('youtube.com') || u.includes('youtu.be')) return { t:'YouTube', i:'▶️' };
    if (u.includes('naver.')) return { t:'NAVER', i:'🟢' };
    if (u.includes('google.')) return { t:'Google', i:'🔵' };
    if (u.includes('bing.') || u.includes('microsoft.')) return { t:'Bing/MS', i:'🟦' };
    if (u.includes('reuters.') || u.includes('nytimes.') || u.includes('bbc.')) return { t:'News', i:'📰' };
    return { t:'Web', i:'🌐' };
  }

  /* ---------- RENDER ---------- */
  function clear(){
    results.innerHTML = '';
  }

  function renderAll(items){
    clear();
    status.textContent = items.length ? `${items.length} results` : 'No results';
    items.forEach(renderCard);
  }

  function renderCard(it){
    const url = it.url || it.link || it.href || '';
    const card = document.createElement('div');
    card.className = 'card';

    const thumb = it.thumbnail || it.image || it.ogImage || it.previewImage;
    if (thumb){
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = thumb;
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    const body = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = it.title || it.name || 'Untitled';

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = it.summary || it.description || it.snippet || '';

    const meta = document.createElement('div');
    meta.className = 'meta';

    const fav = document.createElement('img');
    fav.className = 'favicon';
    const f = faviconOf(url);
    if (f){ fav.src = f; fav.loading = 'lazy'; } else fav.style.display='none';

    const badge = document.createElement('span');
    const sb = sourceBadge(url);
    badge.className = 'badge';
    badge.textContent = `${sb.i} ${sb.t}`;

    const dom = document.createElement('span');
    dom.className = 'domain';
    dom.textContent = domainOf(url);

    meta.appendChild(fav);
    meta.appendChild(badge);
    meta.appendChild(dom);

    const actions = document.createElement('div');
    actions.className = 'actions';
    if (url){
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Open';
      actions.appendChild(a);
    }

    body.appendChild(title);
    if (desc.textContent) body.appendChild(desc);
    body.appendChild(meta);
    body.appendChild(actions);

    card.appendChild(body);
    results.appendChild(card);
  }

  /* ---------- SEARCH FLOW ---------- */
  async function run(q){
    status.textContent = 'Searching…';
    clear();
    try{
      const raw = await fetchMaru(q);
      const data = unwrapResponse(raw) || {};
      const items = data.items || data.results || [];
      __ALL_ITEMS__ = items.map(x => ({ ...x })); // copy, no filter
      renderAll(__ALL_ITEMS__);
    }catch(e){
      console.error(e);
      status.textContent = 'Search error';
    }
  }

  /* ---------- INIT ---------- */
  const p = new URLSearchParams(location.search);
  const q0 = (p.get('q') || '').trim();
  if (q0){ input.value = q0; run(q0); }

  btn.onclick = () => {
    const q = input.value.trim();
    if (!q) return;
    const u = new URL(location.href);
    u.searchParams.set('q', q);
    history.pushState(null, '', u.toString());
    run(q);
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click();
  });
});
