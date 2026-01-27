
/**
 * home-search-overlay.js (FINAL)
 * 홈 검색 → /search.html?q=검색어 로 즉시 이동
 */
(function () {
  'use strict';
  const input = document.querySelector('input[type="search"]');
  const button = document.querySelector('button');

  function go() {
    const q = input && input.value ? input.value.trim() : '';
    if (!q) return;
    window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
  }

  if (button) button.addEventListener('click', go);
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    });
  }
})();
