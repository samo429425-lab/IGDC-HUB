// search.js — v3.1 (IGDC Unified Search Page)
(function () {
  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");
  const resultsEl = document.getElementById("results");
  const metaEl = document.getElementById("searchMeta");
  const externalEl = document.getElementById("externalLinks");
  const translateLink = document.getElementById("googleTranslateLink");

  function qp() {
    const params = new URLSearchParams(window.location.search);
    return params.get("q") || "";
  }

  function setStatus(text) {
    resultsEl.innerHTML = `<div class="status">${text}</div>`;
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function render(items) {
    if (!Array.isArray(items) || items.length === 0) {
      setStatus("No internal results found.");
      return;
    }
    resultsEl.innerHTML = "";
    items.forEach((item) => {
      const div = document.createElement("div");
      div.className = "result-item";
      const title = esc(item.title || "Untitled");
      const summary = esc(item.summary || "");
      const url = item.url ? String(item.url) : "";
      const linkHtml = url
        ? `<a class="result-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
        : `<div class="result-title">${title}</div>`;

      div.innerHTML = `${linkHtml}<div class="result-summary">${summary}</div>`;
      resultsEl.appendChild(div);
    });
  }

  async function runSearch(q) {
    if (!q) {
      setStatus("Please enter a search term.");
      return;
    }

    if (metaEl) metaEl.textContent = `Results for: "${q}"`;
    if (translateLink) {
      translateLink.href =
        "https://translate.google.com/translate?u=" +
        encodeURIComponent(window.location.href);
    }

    setStatus("Searching...");

    try {
      const res = await fetch(
        `/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("HTTP error");
      const data = await res.json();

      if (!data || data.status !== "ok" || !Array.isArray(data.items)) {
        throw new Error("Invalid schema");
      }

      render(data.items);

      if (externalEl) {
        externalEl.style.display = "block";
        externalEl.innerHTML = `
          <strong>External search:</strong><br/>
          <a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank">Google</a>
          <a href="https://www.bing.com/search?q=${encodeURIComponent(q)}" target="_blank">Bing</a>
          <a href="https://search.naver.com/search.naver?query=${encodeURIComponent(q)}" target="_blank">Naver</a>
        `;
      }
    } catch (e) {
      console.error(e);
      setStatus("Search error occurred.");
    }
  }

  function trigger() {
    const q = (input && input.value ? input.value : "").trim();
    if (!q) return;
    window.history.replaceState(null, "", `?q=${encodeURIComponent(q)}`);
    runSearch(q);
  }

  if (btn) btn.addEventListener("click", trigger);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        trigger();
      }
    });
  }

  const initial = qp();
  if (input && initial) input.value = initial;
  if (initial) runSearch(initial);
})();
