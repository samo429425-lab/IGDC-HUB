// IGDC Search.js — PASS THROUGH FINAL
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const results = document.getElementById('searchResults');
  if (!input || !btn || !status || !results) return;

  const params = new URLSearchParams(location.search);
  const q0 = params.get('q');
  if (q0) { input.value = q0; runSearch(q0); }

  btn.onclick = () => {
    const q = input.value.trim();
    if (!q) return;
    const u = new URL(location.href);
    u.searchParams.set('q', q);
    history.replaceState(null, '', u.toString());
    runSearch(q);
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

  async function runSearch(q){
    status.textContent = 'Searching…';
    results.innerHTML = '';
    try{
      const r = await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`, { cache:'no-store' });
      const j = await r.json();
      const d = j.data || j.baseResult || j;
      const items = d.items || d.results || [];
      if (!items.length){ status.textContent='No results.'; return; }
      status.textContent = `${items.length} results`;
      items.forEach(render);
    }catch(e){
      console.error(e);
      status.textContent='Search error';
    }
  }

  function render(it){
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = 'pointer';
    if (it.url) {
      card.onclick = () => {
        location.href = `/search-view.html?u=${encodeURIComponent(it.url)}`;
      };
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
    t.textContent = it.title || it.name || 'Untitled';

    const d = document.createElement('div');
    d.className = 'desc';
    d.textContent = it.summary || it.description || it.snippet || '';

    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = it.source || '';

    body.appendChild(t);
    if (d.textContent) body.appendChild(d);
    if (m.textContent) body.appendChild(m);

    card.appendChild(body);
    results.appendChild(card);
  }
});
