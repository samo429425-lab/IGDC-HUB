// IGDC Search.js — FINAL A+ (NON-DESTRUCTIVE PATCH)
// Fix: external link click opens in new tab (no iframe/embed)
// All existing logic preserved

document.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.endsWith('/search.html')) return;

  const input = document.getElementById('searchInput') || document.getElementById('q');
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus') || document.getElementById('status');
  const results = document.getElementById('searchResults') || document.getElementById('results');
  if (!input || !btn || !status || !results) return;

  // ===== Same-page detail view (NO external navigation) =====
  let __LAST_ITEMS__ = [];
  let __IN_DETAIL__ = false;

  function renderList(items){
    __IN_DETAIL__ = false;
    results.innerHTML = '';
    status.textContent = items.length ? `${items.length} results` : 'No results.';
    items.forEach(render);
  }

  function showDetail(it){
    __IN_DETAIL__ = true;
    results.innerHTML = '';
    status.textContent = 'Result detail';

    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.style.cursor = 'default';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = (it.title || it.name || 'Untitled').trim();

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = (it.summary || it.description || it.snippet || '').trim();

    const url = it.url || it.link || '';
    const link = document.createElement('a');
    link.href = url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = url ? 'Open original in new tab' : '';
    link.style.display = url ? 'inline-block' : 'none';
    link.style.marginTop = '10px';
    link.style.fontSize = '14px';

    wrap.appendChild(title);
    if (desc.textContent) wrap.appendChild(desc);
    wrap.appendChild(link);
    results.appendChild(wrap);
  }

  window.addEventListener('popstate', () => {
    const st = history.state;
    if (st && st.view === 'detail' && st.url) {
      const found = (__LAST_ITEMS__ || []).find(x => (x.url || x.link) === st.url);
      if (found) showDetail(found);
      else if (__LAST_ITEMS__.length) renderList(__LAST_ITEMS__);
    } else if (__LAST_ITEMS__.length) {
      renderList(__LAST_ITEMS__);
    }
  });
  // ===== /Same-page detail view =====

  const params = new URLSearchParams(location.search);
  const q0 = (params.get('q') || '').trim();
  if (q0) { input.value = q0; runSearch(q0); }
  else status.textContent = '';

  btn.onclick = () => {
    const q = input.value.trim();
    if (!q) return;
    const u = new URL(location.href);
    u.searchParams.set('q', q);
    history.pushState(null, '', u.toString());
    runSearch(q);
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

  function unwrap(x){
    if (!x) return x;
    if (x.data && (Array.isArray(x.data.items) || Array.isArray(x.data.results))) return x.data;
    if (x.baseResult && (Array.isArray(x.baseResult.items) || Array.isArray(x.baseResult.results))) return x.baseResult;
    if (x.baseResult && x.baseResult.data && (Array.isArray(x.baseResult.data.items) || Array.isArray(x.baseResult.data.results))) return x.baseResult.data;
    return x;
  }

  async function fetchMaru(q){
    const urls = [
      `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`,
      `/netlify/functions/maru-search?q=${encodeURIComponent(q)}`
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

  async function runSearch(q){
    status.textContent = 'Searching…';
    results.innerHTML = '';
    try{
      const j0 = await fetchMaru(q);
      const d = unwrap(j0) || {};
      const items = d.items || d.results || [];
      __LAST_ITEMS__ = items.map(x => ({...x}));
      if (!__LAST_ITEMS__.length) { status.textContent = 'No results.'; return; }
      renderList(__LAST_ITEMS__);
      }catch(e){
      console.error(e);
      status.textContent = 'Search error';
    }
  }

  function detectSourceByUrl(url){
    const u = (url || '').toLowerCase();
    if (u.includes('wikipedia.org')) return { n:'Wikipedia', i:'📘' };
    if (u.includes('youtube.com') || u.includes('youtu.be')) return { n:'YouTube', i:'▶️' };
    if (u.includes('google.')) return { n:'Google', i:'🔵' };
    if (u.includes('bing.') || u.includes('microsoft.com')) return { n:'Bing/MS', i:'🟦' };
    if (u.includes('naver.')) return { n:'NAVER', i:'🟢' };
    if (u.includes('reuters.com')) return { n:'Reuters', i:'📰' };
    if (u.includes('nytimes.com')) return { n:'NYTimes', i:'📰' };
    return { n:'Web', i:'🌐' };
  }

  function render(it){
    const url = it.url || it.link || '';
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = url ? 'pointer' : 'default';

    // 🔴 FIX: open external link directly (new tab)
    if (url) {
      card.onclick = () => { window.location.href = url; };
    }

    if (it.thumbnail || it.image){
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = it.thumbnail || it.image;
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
    b.textContent = `${src.i} ${src.n}`;
    m.appendChild(b);

    body.appendChild(t);
    if (d.textContent) body.appendChild(d);
    body.appendChild(m);

    card.appendChild(body);
    results.appendChild(card);
  }
});
