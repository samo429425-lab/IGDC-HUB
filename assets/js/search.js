/* =========================================================
   IGDC / MARU SEARCH ENGINE
   search.js  (FINAL – Advanced v4)
   ---------------------------------------------------------
   Features:
   1) Card entire area clickable
   2) Thumbnail / image support (auto fallback)
   3) Source / type indicator
   4) Description (snippet) rendering
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const results = document.getElementById('searchResults');

  if (input && q) input.value = q;

  if (btn) {
    btn.addEventListener('click', () => {
      const keyword = input.value.trim();
      if (!keyword) return;
      location.search = `?q=${encodeURIComponent(keyword)}`;
    });
  }

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });
  }

  if (!q) return;
  runSearch(q);

  async function runSearch(keyword) {
    status.textContent = '검색 중...';
    results.innerHTML = '';

    try {
      const res = await fetch(`/netlify/functions/maru-search?q=${encodeURIComponent(keyword)}`);
      if (!res.ok) throw new Error('API ERROR');

      const data = await res.json();
      const list = data.results || [];

      if (list.length === 0) {
        status.textContent = '검색 결과가 없습니다.';
        return;
      }

      status.textContent = `${list.length}건의 결과`;

      list.forEach(item => {
        const card = document.createElement('div');
        card.className = 'search-card';

        // ----- clickable link wrapper -----
        const link = document.createElement('a');
        link.href = item.url || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'search-card-link';

        // ----- thumbnail -----
        const thumb = document.createElement('div');
        thumb.className = 'search-thumb';

        if (item.image || item.thumbnail) {
          const img = document.createElement('img');
          img.src = item.image || item.thumbnail;
          img.alt = item.title || '';
          thumb.appendChild(img);
        } else {
          const placeholder = document.createElement('div');
          placeholder.className = 'search-thumb-placeholder';
          placeholder.textContent = item.source || 'WEB';
          thumb.appendChild(placeholder);
        }

        // ----- content -----
        const body = document.createElement('div');
        body.className = 'search-body';

        const title = document.createElement('div');
        title.className = 'search-title';
        title.textContent = item.title || '제목 없음';

        const desc = document.createElement('div');
        desc.className = 'search-desc';
        desc.textContent = item.description || item.snippet || '';

        const meta = document.createElement('div');
        meta.className = 'search-meta';
        meta.textContent = item.source || item.type || '';

        body.appendChild(title);
        if (desc.textContent) body.appendChild(desc);
        if (meta.textContent) body.appendChild(meta);

        link.appendChild(thumb);
        link.appendChild(body);
        card.appendChild(link);
        results.appendChild(card);
      });

    } catch (e) {
      console.error(e);
      status.textContent = '검색 중 오류가 발생했습니다.';
    }
  }
});
