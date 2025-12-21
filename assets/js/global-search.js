// assets/js/global-search.js
// Global search handler for Maru Platform

(function () {
  function runSearch() {
    const input = document.getElementById('globalSearchInput');
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('globalSearchBtn');
    const input = document.getElementById('globalSearchInput');

    if (btn) btn.addEventListener('click', runSearch);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') runSearch();
      });
    }
  });
})();
