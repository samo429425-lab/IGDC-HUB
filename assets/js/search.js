// search.js
// IGDC Unified Search Page Logic (Merged & Final)

(function () {
  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");
  const resultsEl = document.getElementById("results");
  const metaEl = document.getElementById("searchMeta");
  const externalEl = document.getElementById("externalLinks");
  const translateLink = document.getElementById("googleTranslateLink");

  function getQueryParam() {
    const params = new URLSearchParams(window.location.search);
    return params.get("q") || "";
  }

  function setStatus(text) {
    resultsEl.innerHTML = `<div class="status">${text}</div>`;
  }

  function renderItems(items) {
    if (!items || items.length === 0) {
      setStatus("No internal results found.");
      return;
    }
    resultsEl.innerHTML = "";
    items.forEach(item => {
      const div = document.createElement("div");
      div.className = "result-item";
      div.innerHTML = `
        <div class="result-title">${item.title || "Untitled"}</div>
        <div class="result-summary">${item.summary || ""}</div>
      `;
      resultsEl.appendChild(div);
    });
  }

  async function runSearch(q) {
    if (!q) {
      setStatus("Please enter a search term.");
      return;
    }

    metaEl.textContent = `Results for: "${q}"`;
    translateLink.href = "https://translate.google.com/translate?u=" + encodeURIComponent(window.location.href);
    setStatus("Searching...");

    try {
      const res = await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      if (data.status !== "ok" || !Array.isArray(data.items)) {
        throw new Error("Invalid search response");
      }

      renderItems(data.items);

      externalEl.style.display = "block";
      externalEl.innerHTML = `
        <strong>External search:</strong><br/>
        <a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank">Google</a>
        <a href="https://www.bing.com/search?q=${encodeURIComponent(q)}" target="_blank">Bing</a>
        <a href="https://search.naver.com/search.naver?query=${encodeURIComponent(q)}" target="_blank">Naver</a>
      `;
    } catch (e) {
      console.error(e);
      setStatus("Search error occurred.");
    }
  }

  function triggerSearch() {
    const q = input.value.trim();
    if (!q) return;
    window.history.replaceState(null, "", `?q=${encodeURIComponent(q)}`);
    runSearch(q);
  }

  btn.addEventListener("click", triggerSearch);
  input.addEventListener("keydown", e => { if (e.key === "Enter") triggerSearch(); });

  const initialQuery = getQueryParam();
  if (initialQuery) {
    input.value = initialQuery;
    runSearch(initialQuery);
  }
})();
