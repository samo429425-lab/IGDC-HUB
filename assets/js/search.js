// IGDC Search.js — STEP 1+2+3 (Additive Only)
// STEP 1: Skeleton UI (instant feedback)
// STEP 2: Expanded thumbnail bowl
// STEP 3: Card type branching (video / image / text)
// NOTE: All existing triggers, pipelines, and behaviors are preserved.

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
          <div style="width:120px;height:72px;background:#eee;border-radius:6px"></div>
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
    if (u.includes('youtube.com') || u.includes('youtu.be')) return { n:'YouTube', type:'video' };
    if (u.includes('vimeo.com')) return { n:'Vimeo', type:'video' };
    if (u.includes('wikipedia.org')) return { n:'Wikipedia', type:'image' };
    return { n:'Web', type:'text' };
  }

  function pickThumbnail(it){
    return (
      it.videoThumbnail ||
      it.thumbnail ||
      it.image ||
      it.ogImage ||
      (Array.isArray(it.images) ? it.images[0] : null) ||
      null
    );
  }

  function detectCardType(it, url){
    if (it.video || it.videos || it.videoThumbnail) return 'video';
    const src = detectSourceByUrl(url);
    if (src.type === 'video') return 'video';
    if (pickThumbnail(it)) return 'image';
    return 'text';
  }

  function render(it){
    const url = it.url || it.link || '';
    const cardType = detectCardType(it, url);

    const card = document.createElement('div');
    card.className = `card card-${cardType}`;
    card.style.cursor = url ? 'pointer' : 'default';
    if (url) card.onclick = () => { location.href = url; };

    // Media block (video/image)
    if (cardType !== 'text'){
      const thumbSrc = pickThumbnail(it);
      if (thumbSrc){
        const mediaWrap = document.createElement('div');
        mediaWrap.className = `media media-${cardType}`;

        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = thumbSrc;
        img.onerror = () => img.remove();

        mediaWrap.appendChild(img);

        if (cardType === 'video'){
          const play = document.createElement('div');
          play.textContent = '▶';
          play.style.position = 'absolute';
          play.style.left = '50%';
          play.style.top = '50%';
          play.style.transform = 'translate(-50%, -50%)';
          play.style.fontSize = '28px';
          play.style.color = '#fff';
          play.style.textShadow = '0 2px 6px rgba(0,0,0,0.6)';
          mediaWrap.style.position = 'relative';
          mediaWrap.appendChild(play);
        }

        card.appendChild(mediaWrap);
      }
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
    b.textContent = src.n;

    const favUrl = faviconOf(url);
    if (favUrl){
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
