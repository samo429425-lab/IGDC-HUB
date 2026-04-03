// tour-rightpanel-automap.v5.js (FINAL / ISOLATED)
// - ONLY renders into #rightAutoPanel + #tour-mobile-rail .list
// - NEVER uses global rightpanel renderer (mixing 방지)
// - Snapshot 우선 → feed fallback
// - Always fills 100 slots (missing -> dummy) so "백지" 발생 금지

(function () {
  "use strict";

  if (window.__TOUR_RIGHTPANEL_AUTOMAP_V5__) return;
  window.__TOUR_RIGHTPANEL_AUTOMAP_V5__ = true;

  const HUB = "tour";
  const SNAPSHOT_URL = "/data/tour-snapshot.json";
  const FEED_URL = "/.netlify/functions/feed-tour?limit=100";

  const RIGHT_PANEL_ID = "rightAutoPanel";
  const RIGHT_SLOT_COUNT = 100;

  const MOBILE_RAIL_ID = "tour-mobile-rail";
  const MOBILE_LIST_SEL = "#tour-mobile-rail .list";
  const MOBILE_LIMIT = 30;

  const PLACEHOLDER_IMG = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  const MOBILE_CSS_ID = "tour-mobile-rail-cap-v1";

  function $(sel, root = document) { return root.querySelector(sel); }
  function byId(id) { return document.getElementById(id); }

  function pick(it, keys) {
    for (const k of keys) {
      const v = it && it[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function normalizeItems(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const it of arr) {
      const title = pick(it, ["title", "name", "label"]);
      const thumb = pick(it, ["thumb", "image", "thumbnail", "img", "photo", "cover"]);
      const link = pick(it, ["link", "url", "href"]) || "#";
      const id = pick(it, ["id", "pid", "productId"]);
      if (!title || !thumb) continue;
      out.push({ id, title, thumb, link });
      if (out.length >= RIGHT_SLOT_COUNT) break;
    }
    return out;
  }

  async function fetchJson(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  function disablePsomThumbGrid() {
    const grid = $('.thumb-grid[data-psom-key="tour"]');
    if (!grid) return;
    grid.innerHTML = "";
    grid.style.display = "none";
    grid.setAttribute("data-disabled", "1");
  }

  function ensureMobileCss() {
    if (document.getElementById(MOBILE_CSS_ID)) return;
    const style = document.createElement("style");
    style.id = MOBILE_CSS_ID;
    style.textContent = `
/* Mobile rail cards should look IDENTICAL to right panel cards */
#${MOBILE_RAIL_ID} .list{ display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; }
#${MOBILE_RAIL_ID} .ad-box{ position:relative; flex:0 0 220px; aspect-ratio: 4 / 5; border-radius:8px; overflow:hidden; background:#fff; border:1px solid #d7dce1; scroll-snap-align:start; }
#${MOBILE_RAIL_ID} .ad-box > a{ display:block; width:100%; height:100%; text-decoration:none; color:inherit; position:relative; }
#${MOBILE_RAIL_ID} .ad-box img{ display:block; width:100%; height:100%; object-fit:cover; }
#${MOBILE_RAIL_ID} .ad-box .tour-card-title{
  position:absolute; left:0; right:0; bottom:0;
  padding:6px 10px;
  font-size:14px; line-height:1.15; font-weight:800;
  color:#fff;
  background:linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0));
  text-shadow:0 1px 2px rgba(0,0,0,.55);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
/* portrait: one card per view */
@media (max-width:768px){
  #${MOBILE_RAIL_ID} .ad-box{ flex:0 0 100%; }
}
`;
document.head.appendChild(style);
  }

  function makeDummy(idx) {
    const n = idx + 1;
    return {
      id: "",
      title: `Tour Brand ${n}`,
      thumb: PLACEHOLDER_IMG,
      link: "#"
    };
  }

  function createRightBox(item) {
    const box = document.createElement("div");
    box.className = "ad-box";

    const a = document.createElement("a");
    a.href = item.link || "#";
    if (item.link && item.link !== "#") {
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      a.tabIndex = -1;
      a.setAttribute("aria-hidden", "true");
    }

    const img = document.createElement("img");
    img.src = item.thumb || PLACEHOLDER_IMG;
    img.alt = item.title || "";
    img.loading = "lazy";
    img.decoding = "async";

    const cap = document.createElement("div");
    cap.className = "tour-card-title";
    cap.textContent = item.title || "";

    a.appendChild(img);
    a.appendChild(cap);
    box.appendChild(a);
    return box;
  }

  function renderRightPanel(items) {
    const panel = byId(RIGHT_PANEL_ID);
    if (!panel) return;

    panel.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (let i = 0; i < RIGHT_SLOT_COUNT; i++) {
      const it = items[i] || makeDummy(i);
      frag.appendChild(createRightBox(it));
    }

    panel.appendChild(frag);
  }

  function renderMobileRail(items) {
    const rail = byId(MOBILE_RAIL_ID);
    const list = $(MOBILE_LIST_SEL);
    if (!rail || !list) return;

    if (!items || !items.length) return;

    rail.style.display = "block";
    ensureMobileCss();

    list.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const it of items.slice(0, MOBILE_LIMIT)) {
      const card = createRightBox(it);
      // reuse the exact same markup as right panel (img + tour-card-title overlay)
      card.classList.add("card");
      frag.appendChild(card);
    }

    list.appendChild(frag);
  }

  async function run() {

    // 1) snapshot 우선
    const snap = await fetchJson(SNAPSHOT_URL);
    let items = [];

   // ✅ items 기반 단일 구조
  items = normalizeItems(snap?.items || []);

   // 2) feed fallback 유지
  if (!items.length) {
    const feed = await fetchJson(FEED_URL);
    items = (feed && Array.isArray(feed.items))
    ? normalizeItems(feed.items)
    : [];
}

    renderMobileRail(items);
    renderRightPanel(items);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(run, 0);
  } else {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    window.addEventListener("load", run, { once: true });
  }
})();