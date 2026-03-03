
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
      const rowEl = document.getElementById(rowId);
      if (!rowEl) continue;

      const items = sections[key];
      // 메인 Row는 기존 preview를 완전히 교체 (운영형)
      renderIntoContainer(rowEl, items, { limit: MAIN_ROW_LIMIT, rowIndex: i + 1 });
    }
  }

  function renderRightPanel(sections) {
    const items = sections[RIGHT_PANEL_KEY] || [];

    // (A) Desktop right panel container
    const rightAutoPanel = document.getElementById("rightAutoPanel");
    if (rightAutoPanel) {
      renderIntoContainer(rightAutoPanel, items, { limit: RIGHT_PANEL_LIMIT, rowIndex: null });
    }

    // (B) Mobile/Scroller right rail container (data-psom-key="socialnetwork")
    const rightScroller = document.querySelector('.thumb-grid.thumb-scroller[data-psom-key="socialnetwork"]');
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
