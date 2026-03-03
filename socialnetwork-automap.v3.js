
/* =========================================================
   socialnetwork-automap.v3.PROD2.js  (Distribution-standard)
   - 목적: social.snapshot.json(또는 feed-social)에서 슬롯을 받아
           HTML의 정확한 위치(9개 메인 Row + 우측패널)에 렌더
   - 원칙: 1) 섹션/타겟 외 삽입 금지  2) 우측패널/메인 혼동 금지
          3) 스냅샷 실데이터가 없으면 스냅샷 샘플 슬롯 그대로 렌더
========================================================= */
(function () {
  "use strict";

  // ---- Config (long-term stable) ----
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

  const MAIN_KEY_ORDER = [
    "social-youtube",
    "social-instagram",
    "social-tiktok",
    "social-facebook",
    "social-discord",
    "social-community",
    "social-threads",
    "social-telegram",
    "social-twitter",
  ];

  // Row targets are hard-wired in socialnetwork.html (rowGrid1..9)
  const ROW_TARGET_IDS = [
    "rowGrid1",
    "rowGrid2",
    "rowGrid3",
    "rowGrid4",
    "rowGrid5",
    "rowGrid6",
    "rowGrid7",
    "rowGrid8",
    "rowGrid9",
  ];

  const RIGHT_PANEL_KEY = "socialnetwork";
  const RIGHT_PANEL_LIMIT = 100;
  const MAIN_ROW_LIMIT = 50;

  // Cache: keep right-panel items to re-render after resize (dummy bootstrap may rebuild)
  let __RIGHT_ITEMS_CACHE = [];
  let __RIGHT_RESIZE_HOOKED = false;

  // ---- Utils ----
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function safeStr(v, fallback = "") {
    return (typeof v === "string" && v.trim()) ? v.trim() : fallback;
  }

  function pickImage(it) {
    return safeStr(it?.thumbnail) ||
           safeStr(it?.thumb) ||
           safeStr(it?.image) ||
           safeStr(it?.img) ||
           safeStr(it?.photo) ||
           "";
  }

  function pickTitle(it) {
    return safeStr(it?.title) ||
           safeStr(it?.name) ||
           safeStr(it?.label) ||
           safeStr(it?.platform) ||
           safeStr(it?.provider) ||
           "Loading...";
  }

  function pickUrl(it) {
    return safeStr(it?.url) ||
           safeStr(it?.link) ||
           safeStr(it?.href) ||
           "#";
  }

  function pickDesc(it, rowIndex) {
    const d = safeStr(it?.subtitle) || safeStr(it?.desc) || safeStr(it?.meta) || "";
    if (d) return d;
    if (Number.isFinite(rowIndex)) return `Row ${rowIndex} · Snapshot`;
    return "Snapshot";
  }

  function createSocialCard(it, rowIndex) {
    // IMPORTANT: matches socialnetwork.html preview card structure (Open button included)
    const a = document.createElement("a");
    a.className = "card";
    const url = pickUrl(it);
    if (url && url !== "#") {
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else {
      a.href = "javascript:void(0)";
    }

    const img = pickImage(it);
    const emoji = safeStr(it?.emoji) || "";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (img) {
      thumb.style.backgroundImage = `url("${img}")`;
    }
    // keep emoji as fallback if provided
    if (emoji) {
      thumb.style.display = "flex";
      thumb.style.alignItems = "center";
      thumb.style.justifyContent = "center";
      thumb.style.fontSize = "42px";
      thumb.textContent = emoji;
    }

    const body = document.createElement("div");
    body.className = "body";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = pickTitle(it);

    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = pickDesc(it, rowIndex);

    const cta = document.createElement("span");
    cta.className = "cta";
    cta.textContent = "Open";

    body.appendChild(title);
    body.appendChild(desc);
    body.appendChild(cta);

    a.appendChild(thumb);
    a.appendChild(body);
    return a;
  }

  function renderIntoContainer(container, items, opts) {
    if (!container) return;
    const limit = opts?.limit ?? 50;
    const rowIndex = opts?.rowIndex;

    container.innerHTML = "";
    const list = Array.isArray(items) ? items.slice(0, limit) : [];
    for (const it of list) {
      container.appendChild(createSocialCard(it, rowIndex));
    }
  }

  async function tryFetchJson(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return await res.json();
  }

  async function loadSnapshot() {
    // 1) direct snapshot URL candidates
    for (const url of SNAPSHOT_URL_CANDIDATES) {
      try {
        const j = await tryFetchJson(url, { cache: "no-store" });
        if (j && j.pages && j.pages.social && j.pages.social.sections) return j;
      } catch (_) {}
    }
    // 2) feed fallback
    for (const url of FEED_FALLBACK_URLS) {
      try {
        const j = await tryFetchJson(url, { cache: "no-store" });
        // feed-social can return {snapshot:...} or snapshot directly
        const snap = j?.snapshot || j;
        if (snap && snap.pages && snap.pages.social && snap.pages.social.sections) return snap;
      } catch (_) {}
    }
    throw new Error("social snapshot not reachable (snapshot url + feed fallback 모두 실패)");
  }

  function getSections(snapshot) {
    return snapshot?.pages?.social?.sections || {};
  }

  function renderMainRows(sections) {
    for (let i = 0; i < MAIN_KEY_ORDER.length; i++) {
      const key = MAIN_KEY_ORDER[i];
      const rowId = ROW_TARGET_IDS[i];

      // IMPORTANT:
      // Do NOT render into #rowGridX itself (it contains scroller structure).
      // Render ONLY into the inner .thumb-grid[data-psom-key="<key>"].
      let gridEl = null;
      const rowEl = document.getElementById(rowId);
      if (rowEl) {
        gridEl = rowEl.querySelector(`.thumb-grid.thumb-scroller[data-psom-key="${key}"]`) ||
                 rowEl.querySelector(`.thumb-grid[data-psom-key="${key}"]`);
      }
      if (!gridEl) {
        // fallback: global lookup (still keyed)
        gridEl = document.querySelector(`.thumb-grid[data-psom-key="${key}"]`);
      }
      if (!gridEl) continue;

      const items = sections[key] || [];
      renderIntoContainer(gridEl, items, { limit: MAIN_ROW_LIMIT, rowIndex: i + 1 });
    }
  }

  function renderRightPanel(sections) {
    const itemsAll = Array.isArray(sections[RIGHT_PANEL_KEY]) ? sections[RIGHT_PANEL_KEY] : [];
    const items = itemsAll.slice(0, RIGHT_PANEL_LIMIT);

    // keep cache for resize re-render
    __RIGHT_ITEMS_CACHE = items;

    // (A) Desktop right panel container:
    // Use the page's bootstrap renderer if present to match the 'ad-box' layout.
    if (typeof window.__IGDC_RIGHTPANEL_RENDER === "function") {
      // Normalize to {link} (bootstrap uses item.link)
      const normalized = items.map((it) => ({
        link: it?.link || it?.url || it?.href || "#",
        title: it?.title || it?.name || it?.label || "Item",
      }));
      window.__IGDC_RIGHTPANEL_RENDER(normalized);
    } else {
      // Fallback: render directly (still limited)
      const rightAutoPanel = document.getElementById("rightAutoPanel");
      if (rightAutoPanel) renderIntoContainer(rightAutoPanel, items, { limit: RIGHT_PANEL_LIMIT, rowIndex: null });
    }

    // (B) Mobile/Scroller right rail container (data-psom-key="socialnetwork")
    const rightScroller =
      document.getElementById("rpMobileGrid") ||
      document.querySelector('.thumb-grid.thumb-scroller[data-psom-key="socialnetwork"]') ||
      document.querySelector('.thumb-grid[data-psom-key="socialnetwork"]');

    if (rightScroller) {
      renderIntoContainer(rightScroller, items, { limit: RIGHT_PANEL_LIMIT, rowIndex: null });
    }
  }

  async function boot() {
    try {
      const snapshot = await loadSnapshot();
      const sections = getSections(snapshot);

      // Guard: keys must exist; otherwise do nothing (avoid wrong injection)
      // Only render if at least one main key exists OR right panel key exists
      const hasAny =
        MAIN_KEY_ORDER.some(k => Array.isArray(sections[k])) ||
        Array.isArray(sections[RIGHT_PANEL_KEY]);

      if (!hasAny) return;

      renderMainRows(sections);
      renderRightPanel(sections);

      // Re-render right panel after resize because the dummy bootstrap rebuilds the panel on resize.
      if (!__RIGHT_RESIZE_HOOKED) {
        __RIGHT_RESIZE_HOOKED = true;
        window.addEventListener("resize", () => {
          if (!__RIGHT_ITEMS_CACHE || __RIGHT_ITEMS_CACHE.length === 0) return;
          if (typeof window.__IGDC_RIGHTPANEL_RENDER !== "function") return;
          // Let the dummy bootstrap finish rebuilding first.
          setTimeout(() => {
            const normalized = __RIGHT_ITEMS_CACHE.map((it) => ({
              link: it?.link || it?.url || it?.href || "#",
              title: it?.title || it?.name || it?.label || "Item",
            }));
            window.__IGDC_RIGHTPANEL_RENDER(normalized);
          }, 0);
        });
      }

    } catch (err) {
      console.warn("[socialnetwork-automap] failed:", err);
    }
  }

  // run after DOM + preview rows
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(boot, 0);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
  }
})();
