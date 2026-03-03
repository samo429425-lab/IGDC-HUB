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
#${MOBILE_RAIL_ID} .card{ position:relative; }
#${MOBILE_RAIL_ID} .card a{ display:block; width:100%; height:100%; }
#${MOBILE_RAIL_ID} .card img{ display:block; width:100%; height:100%; object-fit:cover; }
#${MOBILE_RAIL_ID} .cap{
  position:absolute; left:0; right:0; bottom:0;
  padding:6px 10px;
  font-weight:800; font-size:.92rem; line-height:1.15;
  color:#fff;
  background:linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0));
  text-shadow:0 1px 2px rgba(0,0,0,.55);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
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
      const card = document.createElement("div");
      card.className = "card";

      const a = document.createElement("a");
      a.href = it.link || "#";
      if (it.link && it.link !== "#") {
        a.target = "_blank";
        a.rel = "noopener";
      } else {
        a.tabIndex = -1;
        a.setAttribute("aria-hidden", "true");
      }

      const img = document.createElement("img");
      img.src = it.thumb || PLACEHOLDER_IMG;
      img.alt = it.title || "";
      img.loading = "lazy";
      img.decoding = "async";

      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = it.title || "";

      a.appendChild(img);
      card.appendChild(a);
      card.appendChild(cap);
      frag.appendChild(card);
    }

    list.appendChild(frag);
  }
  function lockRightPanel() {
    const panel = byId(RIGHT_PANEL_ID);
    if (!panel) return;

    const allowed = (node) => {
      if (node.nodeType === 3) return false; // text node -> remove
      if (node.nodeType !== 1) return false;
      // allow our generated boxes only
      if (node.classList && node.classList.contains("ad-box")) return true;
      return false;
    };

    // initial cleanup
    Array.from(panel.childNodes).forEach(n => { if (!allowed(n)) panel.removeChild(n); });

    // observe and clean future injections
    if (panel.__tourLockObserver) return;
    const obs = new MutationObserver(() => {
      Array.from(panel.childNodes).forEach(n => { if (!allowed(n)) panel.removeChild(n); });
    });
    obs.observe(panel, { childList: true });
    panel.__tourLockObserver = obs;
  }


  async function run() {
    disablePsomThumbGrid();

    // ✅ FEED ONLY (남의 스냅샷 혼입 차단)
    const feed = await fetchJson(FEED_URL);
    const items = normalizeItems(feed && feed.items ? feed.items : []);

    // 렌더 (항상 100칸 유지 - 부족분 더미)
    renderRightPanel(items);
    ensureMobileCss();
    renderMobileRail(items);

    // 🔒 Right panel lockdown: 외부 스크립트가 텍스트 리스트를 끼워넣으면 즉시 제거
    lockRightPanel();
  }
 === "complete" || document.readyState === "interactive") {
    setTimeout(run, 0);
  } else {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    window.addEventListener("load", run, { once: true });
  }
})();