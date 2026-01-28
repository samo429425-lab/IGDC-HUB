// IGDC Search.js — FINAL A+ (safe, no filter, correct source labels, robust unwrap)
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
      if (!items.length) { status.textContent = 'No results.'; return; }
      status.textContent = `${items.length} results`;
      items.forEach(render);
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
    if (url) card.onclick = () => location.href = `/search-view.html?q=${encodeURIComponent(input.value.trim())}&u=${encodeURIComponent(url)}`;

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