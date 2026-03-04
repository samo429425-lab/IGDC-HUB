/* =========================================================
   socialnetwork-automap.v4.js  (A안 / KEY-LOCKED RENDER)
   - 목표:
     1) 9개 섹션은 각 섹션의 data-psom-key 컨테이너에만 렌더
     2) 우측 패널은 #rightAutoPanel(Desktop) + #rpMobileGrid(Mobile)만 렌더
     3) resize 더미 build()가 덮어써도 즉시 실데이터로 복구 (MutationObserver + debounce)
   ========================================================= */
(function () {
  "use strict";

  // ---- Snapshot sources (same policy as v3) ----
  const SNAPSHOT_URL_CANDIDATES = [
    "/data/social.snapshot.json",
    "/social.snapshot.json",
    "/snapshots/social.snapshot.json",
  ];
  const FEED_FALLBACK_URLS = [
    "/.netlify/functions/feed-social",
    "/.netlify/functions/feed_social",
    "/api/feed-social",
  ];

  // ---- Section keys & row mapping (socialnetwork.html 고정) ----
  const MAIN_ROWS = [
    { rowId: "rowGrid1", key: "social-youtube" },
    { rowId: "rowGrid2", key: "social-instagram" },
    { rowId: "rowGrid3", key: "social-tiktok" },
    { rowId: "rowGrid4", key: "social-facebook" },
    { rowId: "rowGrid5", key: "social-discord" },
    { rowId: "rowGrid6", key: "social-community" },
    { rowId: "rowGrid7", key: "social-threads" },
    { rowId: "rowGrid8", key: "social-telegram" },
    { rowId: "rowGrid9", key: "social-twitter" },
  ];

  const RIGHT_PANEL_KEY = "socialnetwork";
  const MAIN_ROW_LIMIT = 50;
  const RIGHT_PANEL_LIMIT = 100;

  // ---- DOM helpers ----
  function $(sel, root) { return (root || document).querySelector(sel); }
  function safeStr(v, fallback = "") {
    return (typeof v === "string" && v.trim()) ? v.trim() : fallback;
  }

  // ---- Card builder (main rows + mobile rail) ----
  function createSocialCard(item, rowIndex) {
    const it = item || {};
    const link = safeStr(it.link, "#");
    const title = safeStr(it.title, "Loading...");
    const desc = safeStr(it.desc, "");
    const thumbUrl = safeStr(it.thumb, "");

    const a = document.createElement("a");
    a.className = "social-card";
    a.href = link;
    a.rel = "noopener";
    a.target = "_blank";
    if (rowIndex) a.dataset.row = String(rowIndex);

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (thumbUrl) {
      thumb.style.backgroundImage = `url("${thumbUrl}")`;
      thumb.style.backgroundSize = "cover";
      thumb.style.backgroundPosition = "center";
    }

    const body = document.createElement("div");
    body.className = "body";

    const h = document.createElement("div");
    h.className = "title";
    h.textContent = title;

    const d = document.createElement("div");
    d.className = "desc";
    d.textContent = desc;

    const cta = document.createElement("div");
    cta.className = "cta";
    cta.textContent = "Open";

    body.appendChild(h);
    if (desc) body.appendChild(d);
    body.appendChild(cta);

    a.appendChild(thumb);
    a.appendChild(body);
    return a;
  }

  function renderCardsInto(container, items, opts) {
    if (!container) return;
    const limit = opts?.limit ?? 50;
    const rowIndex = opts?.rowIndex ?? null;
    container.innerHTML = "";

    const list = Array.isArray(items) ? items.slice(0, limit) : [];
    for (const it of list) container.appendChild(createSocialCard(it, rowIndex));
  }

  // ---- Right panel renderer (use HTML dummy's official API if present) ----
  function renderRightPanelDesktop(items) {
    const panel = document.getElementById("rightAutoPanel");
    if (!panel) return;

    // Prefer the page's built-in renderer to preserve structure/height rules.
    if (typeof window.__IGDC_RIGHTPANEL_RENDER === "function") {
      const list = Array.isArray(items) ? items.slice(0, RIGHT_PANEL_LIMIT) : [];
      // Feed expects {link:...}; keep minimal to avoid layout drift
      const mapped = list.map(it => ({ link: safeStr(it?.link, "#") }));
      window.__IGDC_RIGHTPANEL_RENDER(mapped);
      return;
    }

    // Fallback: minimal ad-box list
    panel.innerHTML = "";
    const list = Array.isArray(items) ? items.slice(0, RIGHT_PANEL_LIMIT) : [];
    for (const it of list) {
      const box = document.createElement("div");
      box.className = "ad-box";
      box.innerHTML = `<a href="${safeStr(it?.link, "#")}" target="_blank" rel="noopener">Item</a>`;
      panel.appendChild(box);
    }
  }

  function renderRightPanelMobile(items) {
    const mobileGrid = document.getElementById("rpMobileGrid")
      || $('.thumb-grid.thumb-scroller[data-psom-key="socialnetwork"]');
    if (!mobileGrid) return;

    // Mobile rail is a thumb-grid scroller: render cards
    renderCardsInto(mobileGrid, items, { limit: RIGHT_PANEL_LIMIT, rowIndex: null });
  }

  // ---- KEY-LOCKED main rows: 반드시 rowGrid 안의 thumb-grid[data-psom-key="..."]에만 렌더 ----
  function renderMainRows(sections) {
    for (let i = 0; i < MAIN_ROWS.length; i++) {
      const row = MAIN_ROWS[i];
      const rowEl = document.getElementById(row.rowId);
      if (!rowEl) continue;

      // Strict target: inside rowGridX, the thumb-grid thumb-scroller with exact key
      const target = rowEl.querySelector(`.thumb-grid.thumb-scroller[data-psom-key="${row.key}"]`)
        || rowEl.querySelector(`.thumb-grid[data-psom-key="${row.key}"]`);
      if (!target) continue;

      const items = sections?.[row.key];
      renderCardsInto(target, items, { limit: MAIN_ROW_LIMIT, rowIndex: i + 1 });
    }
  }

  // ---- Snapshot loader ----
  async function tryFetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return await res.json();
  }

  async function loadSnapshot() {
    for (const url of SNAPSHOT_URL_CANDIDATES) {
      try {
        const j = await tryFetchJson(url);
        if (j && j.pages && j.pages.social && j.pages.social.sections) return j;
      } catch (_) {}
    }
    for (const url of FEED_FALLBACK_URLS) {
      try {
        const j = await tryFetchJson(url);
        const snap = j?.snapshot || j;
        if (snap && snap.pages && snap.pages.social && snap.pages.social.sections) return snap;
      } catch (_) {}
    }
    throw new Error("social snapshot not reachable");
  }

  function getSections(snapshot) {
    return snapshot?.pages?.social?.sections || {};
  }

  // ---- Re-render control (avoid dummy overwrite) ----
  let _sectionsCache = null;
  let _resizeTimer = null;

  function rerenderAll() {
    if (!_sectionsCache) return;
    renderMainRows(_sectionsCache);
    const rpItems = _sectionsCache[RIGHT_PANEL_KEY] || [];
    renderRightPanelDesktop(rpItems);
    renderRightPanelMobile(rpItems);
  }

  function installRightPanelObserver() {
    const panel = document.getElementById("rightAutoPanel");
    if (!panel || typeof MutationObserver === "undefined") return;

    // If dummy rebuild inserts dummy cards, we re-render immediately
    const obs = new MutationObserver(() => {
      // Detect dummy state quickly (data-dummy=1 exists)
      if (panel.querySelector('[data-dummy="1"]')) {
        // Debounce micro-burst
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(rerenderAll, 50);
      }
    });
    obs.observe(panel, { childList: true, subtree: true });
  }

  function installResizeRerender() {
    window.addEventListener("resize", () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(rerenderAll, 120);
    }, { passive: true });
  }

  // ---- Page guard: run only if socialnetwork page skeleton exists ----
  function isSocialNetworkPage() {
    return !!document.getElementById("rowGrid1") && !!document.getElementById("rightAutoPanel");
  }

  async function boot() {
    if (!isSocialNetworkPage()) return;

    try {
      const snapshot = await loadSnapshot();
      const sections = getSections(snapshot);

      // Guard: must have at least one target array
      const hasAnyMain = MAIN_ROWS.some(r => Array.isArray(sections?.[r.key]));
      const hasRight = Array.isArray(sections?.[RIGHT_PANEL_KEY]);
      if (!hasAnyMain && !hasRight) return;

      _sectionsCache = sections;

      rerenderAll();
      installRightPanelObserver();
      installResizeRerender();

    } catch (err) {
      console.warn("[socialnetwork-automap.v4] failed:", err);
    }
  }

  // DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
