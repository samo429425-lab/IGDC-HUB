/* =========================================================
   IGDC / MARU SEARCH
   search.js  (Standalone v2.1)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') || '';

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const results = document.getElementById('searchResults');

  if (input && q) input.value = q;

  async function runSearch(keyword) {
    if (!status || !results) return;

    status.textContent = '검색 중...';
    results.innerHTML = '';

    try {
      const res = await fetch(
        `/.netlify/functions/maru-search?q=${encodeURIComponent(keyword)}`
      );

      if (!res.ok) throw new Error('Netlify Function Error');

      const data = await res.json();
      const list = data.results || [];

      if (list.length === 0) {
        status.textContent = '검색 결과가 없습니다.';
        return;
      }

      status.textContent = `${list.length}건의 결과`;

      list.forEach(item => {
        const wrap = document.createElement('div');
        wrap.className = 'search-item';

        const a = document.createElement('a');
        a.textContent = item.title || '제목 없음';
        a.href = item.url || '#';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';

        const p = document.createElement('p');
        p.textContent = item.description || '';

        wrap.appendChild(a);
        wrap.appendChild(p);
        results.appendChild(wrap);
      });

    } catch (err) {
      console.error(err);
      status.textContent = '검색 중 오류가 발생했습니다.';
    }
  }

  if (q) runSearch(q);

  if (btn && input) {
    btn.addEventListener('click', () => {
      const keyword = input.value.trim();
      if (!keyword) return;
      window.location.search = `?q=${encodeURIComponent(keyword)}`;
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });
  }
});
