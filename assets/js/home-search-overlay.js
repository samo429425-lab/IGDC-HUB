/**
 * home-search-overlay.js — v1.5
 */

(function () {
  if (window.__HOME_SEARCH_READY__) return;
  window.__HOME_SEARCH_READY__ = true;

  const input = document.getElementById("homeSearchInput");
  const btn = document.getElementById("homeSearchBtn");
  const resultBox = document.getElementById("homeSearchResult");

  async function runSearch(q) {
    if (!q) return;
    resultBox.innerHTML = "<p>Searching...</p>";
    try {
      const res = await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      render(data.items || []);
    } catch {
      resultBox.innerHTML = "<p>Error occurred</p>";
    }
  }

  function render(items) {
    if (!items.length) {
      resultBox.innerHTML = "<p>No results</p>";
      return;
    }
    resultBox.innerHTML = items.map(i => `
      <div class="search-item">
        <strong>[${i.type}]</strong>
        <a href="${i.url}" target="_blank">${i.title}</a>
        <p>${i.summary || ""}</p>
      </div>
    `).join("");
  }

  btn && btn.addEventListener("click", () => runSearch(input.value.trim()));
  input && input.addEventListener("keydown", e => {
    if (e.key === "Enter") runSearch(input.value.trim());
  });
})();
