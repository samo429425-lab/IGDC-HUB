/* =========================================================
   IGDC / MARU SEARCH
   search.js  (v1.0 – Stable)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';

  const input = document.getElementById('searchInput');
  const button = document.getElementById('searchBtn');
  const resultArea = document.getElementById('searchResults');
  const statusArea = document.getElementById('searchStatus');

  if (input) input.value = query;

  if (query) {
    runSearch(query);
  }

  if (button) {
    button.addEventListener('click', () => {
      const q = input.value.trim();
      if (!q) return;
      redirectSearch(q);
    });
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;
        redirectSearch(q);
      }
    });
  }

  function redirectSearch(q) {
    window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
  }

  async function runSearch(q) {
    setStatus('검색 중입니다…');

    try {
      const res = await fetch(`/netlify/functions/maru-search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Search API error');

      const data = await res.json();
      renderResults(data?.results || []);
    } catch (err) {
      console.error(err);
      setStatus('검색 중 오류가 발생했습니다.');
    }
  }

  function renderResults(results) {
    resultArea.innerHTML = '';

    if (!results || results.length === 0) {
      setStatus('검색 결과가 없습니다.');
      return;
    }

    setStatus(`${results.length}개의 결과를 찾았습니다.`);

    results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'search-result-item';

      const title = document.createElement('a');
      title.textContent = item.title || '제목 없음';
      title.href = item.url || '#';

      if (item.external) {
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
      }

      const desc = document.createElement('div');
      desc.className = 'search-result-desc';
      desc.textContent = item.description || '';

      card.appendChild(title);
      card.appendChild(desc);
      resultArea.appendChild(card);
    });
  }

  function setStatus(text) {
    if (statusArea) statusArea.textContent = text;
  }
});
