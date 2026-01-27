
/**
 * assets/js/search.js
 * MARU Search UI Controller v1.0
 * - Renders clickable results
 * - Opens links in new tab
 * - Handles empty / error states
 */

'use strict';

(function () {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';
  const container = document.getElementById('search-results');
  const input = document.getElementById('search-input');
  const form = document.getElementById('search-form');

  if (input) input.value = query;

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
    });
  }

  async function runSearch(q) {
    if (!q) {
      renderEmpty('검색어를 입력하세요.');
      return;
    }

    try {
      const res = await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      const items = data.items || data.results || [];
      if (!items.length) {
        renderEmpty('검색 결과가 없습니다.');
        return;
      }

      renderItems(items);
    } catch (err) {
      renderEmpty('검색 중 오류가 발생했습니다.');
    }
  }

  function renderItems(items) {
    container.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'search-item';

      const title = document.createElement('a');
      title.href = item.url || item.link || '#';
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
      title.textContent = item.title || '(제목 없음)';
      title.className = 'search-title';

      const snippet = document.createElement('p');
      snippet.className = 'search-snippet';
      snippet.textContent = item.summary || item.snippet || '';

      card.appendChild(title);
      card.appendChild(snippet);
      container.appendChild(card);
    });
  }

  function renderEmpty(msg) {
    container.innerHTML = `<div class="search-empty">${msg}</div>`;
  }

  runSearch(query);
})();
