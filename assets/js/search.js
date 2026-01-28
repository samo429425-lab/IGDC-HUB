/* =========================================================
   MARU SEARCH – FINAL A (v6.0)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const initialQ = (params.get('q') || '').trim();

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const statusEl = document.getElementById('searchStatus');
  const resultsEl = document.getElementById('searchResults');

  if (!input || !btn || !statusEl || !resultsEl) {
    console.error('[MARU SEARCH] required DOM ids missing');
    return;
  }

  if (initialQ) {
    input.value = initialQ;
    runSearch(initialQ);
  } else {
    setStatus('검색어를 입력하세요.');
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    updateQuery(q);
    runSearch(q);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn.click();
    }
  });

  function updateQuery(q) {
    const url = new URL(window.location.href);
    url.searchParams.set('q', q);
    history.replaceState(null, '', url.toString());
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function fetchMaru(q) {
    const urls = [
      `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`,
      `/netlify/functions/maru-search?q=${encodeURIComponent(q)}`
    ];

    let lastErr;
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status);
          continue;
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  async function runSearch(q) {
    setStatus('검색 중입니다…');
    resultsEl.innerHTML = '';

    try {
      const data = await fetchMaru(q);

      if (data && data.status === 'error') {
        setStatus(data.message || '검색 엔진 오류');
        console.error('[MARU SEARCH ENGINE]', data);
        return;
      }

      const raw =
        (Array.isArray(data?.items) && data.items) ||
        (Array.isArray(data?.results) && data.results) ||
        [];

      const items = raw.map(normalize).filter(i => i.url || i.title);

      if (items.length === 0) {
        setStatus('검색 결과가 없습니다.');
        return;
      }

      setStatus(`${items.length}개의 결과`);
      items.forEach(renderCard);

    } catch (e) {
      console.error('[MARU SEARCH JS ERROR]', e);
      setStatus('검색 중 오류가 발생했습니다.');
    }
  }

  function normalize(it) {
    return {
      title: (it.title || it.name || '').trim() || '제목 없음',
      url: (it.url || it.link || '').trim(),
      desc: (it.description || it.snippet || '').trim(),
      thumb: (it.thumbnail || it.image || '').trim(),
      source: (it.source || it.site || '').trim()
    };
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'search-card';

    const link = document.createElement('a');
    link.className = 'search-card-link';
    link.href = item.url || '#';
    link.target = '_self';
    link.rel = 'noopener';

    if (item.thumb) {
      const img = document.createElement('img');
      img.className = 'search-thumb';
      img.src = item.thumb;
      img.alt = item.title;
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      link.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'search-body';

    const title = document.createElement('div');
    title.className = 'search-title';
    title.textContent = item.title;

    body.appendChild(title);

    if (item.desc) {
      const d = document.createElement('div');
      d.className = 'search-desc';
      d.textContent = item.desc;
      body.appendChild(d);
    }

    if (item.source) {
      const s = document.createElement('div');
      s.className = 'search-meta';
      s.textContent = item.source;
      body.appendChild(s);
    }

    link.appendChild(body);
    card.appendChild(link);
    resultsEl.appendChild(card);
  }
});
