/* =========================================================
   MARU SEARCH – FINAL B (Card UI + View Redirect)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const initialQ = (params.get('q') || '').trim();

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const statusEl = document.getElementById('searchStatus');
  const resultsEl = document.getElementById('searchResults');

  if (!input || !btn || !statusEl || !resultsEl) return;

  if (initialQ) {
    input.value = initialQ;
    runSearch(initialQ);
  } else {
    setStatus('검색어를 입력하세요.');
  }

  btn.addEventListener('click', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    updateQuery(q);
    runSearch(q);
  });

  input.addEventListener('keydown', e => {
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
    const res = await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  async function runSearch(q) {
    setStatus('검색 중입니다…');
    resultsEl.innerHTML = '';
    try {
      const data = await fetchMaru(q);
      const raw = (data.items || data.results || []);
      const items = raw.map(normalize).filter(i => i.url && i.title);

      if (!items.length) {
        setStatus('검색 결과가 없습니다.');
        return;
      }

      setStatus(`${items.length}개의 결과`);
      items.forEach(renderCard);
    } catch (e) {
      setStatus('검색 중 오류가 발생했습니다.');
    }
  }

  function normalize(it) {
    return {
      title: (it.title || '').trim(),
      url: it.url,
      desc: (it.description || it.snippet || '').trim(),
      source: (it.source || it.site || '').trim(),
      thumb: it.thumbnail || it.image || ''
    };
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'search-card';

    card.addEventListener('click', () => {
      window.location.href = `/search-view.html?u=${encodeURIComponent(item.url)}`;
    });

    if (item.thumb) {
      const img = document.createElement('img');
      img.src = item.thumb;
      img.className = 'search-thumb';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    const title = document.createElement('div');
    title.className = 'search-title';
    title.textContent = item.title;
    card.appendChild(title);

    if (item.desc) {
      const desc = document.createElement('div');
      desc.className = 'search-desc';
      desc.textContent = item.desc;
      card.appendChild(desc);
    }

    if (item.source) {
      const meta = document.createElement('div');
      meta.className = 'search-meta';
      meta.textContent = item.source;
      card.appendChild(meta);
    }

    resultsEl.appendChild(card);
  }
});
