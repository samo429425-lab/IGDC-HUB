/* =========================================================
   IGDC / MARU SEARCH
   search.js  (v2.0 – No Redirect / Standalone)
   =========================================================
   역할:
   - search.html 전용
   - 페이지 이동 없음
   - URL ?q= 파라미터 읽어서 검색 실행
   - 버튼/엔터 = 재검색(fetch만)
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get('q') || '';

  const input = document.getElementById('searchInput');
  const button = document.getElementById('searchBtn');
  const resultArea = document.getElementById('searchResults');
  const statusArea = document.getElementById('searchStatus');

  if (!input || !button || !resultArea || !statusArea) {
    console.error('[MARU SEARCH] 필수 DOM 요소 누락');
    return;
  }

  input.value = initialQuery;

  if (initialQuery) {
    runSearch(initialQuery);
  } else {
    setStatus('검색어를 입력하세요.');
  }

  button.addEventListener('click', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    runSearch(q);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      runSearch(q);
    }
  });

  async function runSearch(q) {
    setStatus('검색 중입니다…');
    resultArea.innerHTML = '';

    try {
      const res = await fetch(
        `/netlify/functions/maru-search?q=${encodeURIComponent(q)}`
      );

      if (!res.ok) throw new Error('Search API Error');

      const data = await res.json();
      renderResults(data?.results || []);
    } catch (err) {
      console.error('[MARU SEARCH ERROR]', err);
      setStatus('검색 중 오류가 발생했습니다.');
    }
  }

  function renderResults(results) {
    resultArea.innerHTML = '';

    if (!Array.isArray(results) || results.length === 0) {
      setStatus('검색 결과가 없습니다.');
      return;
    }

    setStatus(`${results.length}개의 검색 결과`);

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
    statusArea.textContent = text;
  }
});
