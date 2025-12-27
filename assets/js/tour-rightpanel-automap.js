/**
 * tour-rightpanel-automap.js
 * Right panel auto mapping (PSOM-based)
 * Safe standalone loader
 */

(function () {
  if (typeof document === "undefined") return;

  const PANEL_SELECTOR = ".ad-panel";
  const MAX_ITEMS = 12;

  function createCard(item) {
    const a = document.createElement("a");
    a.className = "ad-box";
    a.href = item.url || "#";
    a.target = "_blank";
    a.rel = "noopener";

    const img = document.createElement("img");
    img.src = item.thumbnail || "";
    img.alt = item.title || "";
    img.loading = "lazy";

    a.appendChild(img);
    return a;
  }

  async function loadJSON(key) {
    try {
      const res = await fetch(`/.netlify/functions/feed?key=${encodeURIComponent(key)}&limit=120`, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function run() {
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return;

    if (panel.dataset.bound === "true") return;
    panel.dataset.bound = "true";

    const CANDIDATE_KEYS = [
      "social-instagram",
      "social-youtube",
      "social-tiktok",
      "media-video",
      "media-travel",
      "distribution-travel"
    ];

    let collected = [];

    for (const key of CANDIDATE_KEYS) {
      const json = await loadJSON(key);
      if (json && Array.isArray(json.items)) {
        collected = collected.concat(json.items);
      }
      if (collected.length >= MAX_ITEMS) break;
    }

    if (!collected.length) return;

    panel.innerHTML = "";
    collected.slice(0, MAX_ITEMS).forEach(item => {
      panel.appendChild(createCard(item));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
