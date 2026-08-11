// tour-automap.js (PRODUCTION v6 - internal content page routing + thumb-grid hard disable)
// - Right panel/mobile rail product slots open IGDC internal /content.html?id=...
// - Legacy .thumb-grid[data-psom-key="tour"] is disabled so it cannot push the index/slots
// - Main external tour .link-btn anchors use top navigation so browser Back returns to IGDC
// - Revenue autohook loader is preserved

(function () {
  "use strict";

  if (window.__TOUR_RIGHTPANEL_AUTOMAP_V6__) return;
  window.__TOUR_RIGHTPANEL_AUTOMAP_V6__ = true;

  const HUB = "tour";
  const SNAPSHOT_URL = "/data/tour-snapshot.json";
  const FEED_URL = ""; // No non-IP fallback for the tour offer rail.

  const RIGHT_PANEL_ID = "rightAutoPanel";
  const RIGHT_SLOT_COUNT = 100;

  const MOBILE_RAIL_ID = "tour-mobile-rail";
  const MOBILE_LIST_SEL = "#tour-mobile-rail .list";
  const MOBILE_LIMIT = 30;

  const MOBILE_CSS_ID = "tour-mobile-rail-cap-v2";

  function $(sel, root = document) { return root.querySelector(sel); }
  function byId(id) { return document.getElementById(id); }

  function pick(it, keys) {
    for (const k of keys) {
      const v = it && it[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return "";
  }

  function pickId(it){ return pick(it, ["id", "contentId", "productId", "itemId", "sku", "code", "pid"]); }
  function pickDirectProductUrl(it){ return specificProductUrl(pick(it, ["externalProductUrl", "officialProductUrl", "productUrl", "productPageUrl", "detailUrl", "checkoutUrl", "purchaseUrl", "orderUrl", "productLink"])); }
  function pickLegacyProductUrl(it){
    for (const key of ["affiliateOutboundUrl", "affiliate_outbound_url", "externalOutboundUrl", "external_outbound_url", "contentUrl", "pageUrl", "link", "url", "href"]) {
      const url = specificProductUrl(it && it[key]);
      if (url) return url;
    }
    return "";
  }
  function pickLink(it){ return pickDirectProductUrl(it) || pickLegacyProductUrl(it) || "#"; }

  function isExternal(url){ return /^https?:\/\//i.test(String(url || "")); }
  function isBadUrl(url){
    const u = String(url || "").trim();
    return !u || u === "#" || /^javascript:/i.test(u) || /^about:blank$/i.test(u);
  }
  function isExampleUrl(url){
    const u = String(url || "").trim();
    if (!u) return false;
    try { return /(^|\.)example\.(com|org|net)$/i.test(new URL(u, window.location.origin).hostname); }
    catch(e){ return /example\.(com|org|net)/i.test(u); }
  }
  function specificProductUrl(value){
    const raw = String(value || "").trim();
    if (isBadUrl(raw) || isExampleUrl(raw)) return "";
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:") return "";
      if ((!u.pathname || u.pathname === "/") && !u.search && !u.hash) return "";
      return u.toString();
    } catch(e){ return ""; }
  }
  function contentHref(id){ return id ? ("/content.html?id=" + encodeURIComponent(id)) : ""; }
  function resolveItemHref(item){
    const direct = pickDirectProductUrl(item);
    if (direct && !isBadUrl(direct) && !isExampleUrl(direct)) return direct;
    const outbound = specificProductUrl(item && (item.affiliateOutboundUrl || item.externalOutboundUrl || ''));
    if (outbound) return outbound;
    const link = specificProductUrl(item && item.link);
    if (link) return link;
    if (item && item.id) return contentHref(item.id);
    return "";
  }

  function normalizeItems(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const it of arr) {
      const title = pick(it, ["title", "name", "label", "caption"]);
      const thumb = pick(it, ["thumb", "image", "thumbnail", "img", "photo", "cover", "coverUrl", "thumbnailUrl"]);
      const link = pickLink(it);
      const id = pickId(it);
      if (!title || !thumb) continue;
      const directProductUrl = pickDirectProductUrl(it);
      out.push({ id, title, thumb, link, sourceUrl: link, productUrl: directProductUrl, externalProductUrl: pick(it,["externalProductUrl"]) || directProductUrl, detailUrl: pick(it,["detailUrl"]) || directProductUrl, checkoutUrl: pick(it,["checkoutUrl"]) || directProductUrl, affiliateOutboundUrl: pick(it, ["affiliateOutboundUrl","affiliate_outbound_url"]), externalOutboundUrl: pick(it, ["externalOutboundUrl","external_outbound_url"]) });
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
    const grids = document.querySelectorAll('.thumb-grid[data-psom-key="tour"]');
    grids.forEach(function(grid){
      grid.innerHTML = "";
      grid.style.display = "none";
      grid.setAttribute("data-psom-mode", "disabled");
      grid.setAttribute("data-disabled", "1");
      grid.setAttribute("aria-hidden", "true");
    });
  }

  function installExternalTopNavigation(){
    if (window.__IGDC_TOUR_TOP_NAV_INSTALLED__) return;
    window.__IGDC_TOUR_TOP_NAV_INSTALLED__ = true;
    document.addEventListener('click', function(ev){
      const a = ev.target && ev.target.closest && ev.target.closest('a.link-btn[href^="http"], a[data-igdc-external="top"][href^="http"]');
      if (!a) return;
      const href = a.href;
      if (!href) return;
      ev.preventDefault();
      try { (window.top || window).location.assign(href); }
      catch(e){ window.location.href = href; }
    }, true);
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
@media (max-width:768px){
  #${MOBILE_RAIL_ID} .ad-box{ flex:0 0 100%; }
}
`;
    document.head.appendChild(style);
  }


  function applyAnchor(a, item){
    const href = resolveItemHref(item);
    a.removeAttribute('target');
    a.removeAttribute('rel');
    if (!href){
      a.href = '#';
      a.tabIndex = -1;
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('data-igdc-disabled', '1');
      a.addEventListener('click', function(ev){ ev.preventDefault(); }, { passive:false });
      return;
    }
    a.href = href;
    if (item && item.id) a.setAttribute('data-igdc-content-id', item.id);
    if (item && item.sourceUrl) a.setAttribute('data-igdc-source-url', item.sourceUrl);
    if (item && item.affiliateOutboundUrl) a.setAttribute('data-affiliate-outbound','1');
    if (item && item.externalOutboundUrl) a.setAttribute('data-external-outbound','1');
    if (isExternal(href)){
      a.target = '_top';
      a.rel = 'noopener';
      a.setAttribute('data-igdc-external','top');
    }
  }

  function createRightBox(item) {
    const box = document.createElement("div");
    box.className = "ad-box";

    const a = document.createElement("a");
    applyAnchor(a, item);

    const img = document.createElement("img");
    img.src = item.thumb;
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
    if (!items || !items.length) return;
    const frag = document.createDocumentFragment();
    for (const it of items.slice(0, RIGHT_SLOT_COUNT)) frag.appendChild(createRightBox(it));
    panel.appendChild(frag);
  }

  function renderMobileRail(items) {
    const rail = byId(MOBILE_RAIL_ID);
    const list = $(MOBILE_LIST_SEL);
    if (!rail || !list) return;

    if (!items || !items.length) { list.innerHTML = ""; rail.style.display = "none"; return; }

    rail.style.display = "block";
    ensureMobileCss();

    list.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const it of items.slice(0, MOBILE_LIMIT)) {
      const card = createRightBox(it);
      card.classList.add("card");
      frag.appendChild(card);
    }

    list.appendChild(frag);
  }

  async function run() {
    disablePsomThumbGrid();
    installExternalTopNavigation();

    const snap = await fetchJson(SNAPSHOT_URL);
    let items = [];

    items = normalizeItems((snap && (snap.items || snap.slots)) || []);

    // No generic feed fallback: only the Edge-routed canonical IP snapshot is
    // allowed to populate the tour right panel and mobile rail.
    disablePsomThumbGrid();
    renderMobileRail(items);
    renderRightPanel(items);
  }

  disablePsomThumbGrid();

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(run, 0);
  } else {
    installExternalTopNavigation();
    document.addEventListener("DOMContentLoaded", run, { once: true });
    window.addEventListener("load", run, { once: true });
  }
})();

/* ------------------------------------------------------------------
 * MARU Revenue AutoHook Loader
 * Added by revenue tracking patch.
 *
 * Purpose:
 * - Load /assets/js/maru-revenue-tracker.js
 * - Then load /assets/js/maru-revenue-autohook.js
 * - Do not change this automap's original rendering pipeline.
 * ------------------------------------------------------------------ */
(function loadMaruRevenueAutoHookForAutomap(){
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function installIfReady(){
    try {
      if (
        window.MaruRevenueAutoHook &&
        typeof window.MaruRevenueAutoHook.install === "function"
      ) {
        window.MaruRevenueAutoHook.install({
          service: "front-automap"
        });
      }
    } catch (e) {
      console.warn("[MARU Revenue] autohook install skipped:", e);
    }
  }

  function loadScriptOnce(src, id, globalName, done){
    var existing = document.getElementById(id);

    if (window[globalName]) {
      if (typeof done === "function") done();
      return;
    }

    if (existing) {
      existing.addEventListener("load", function(){
        if (typeof done === "function") done();
      }, { once:true });
      existing.addEventListener("error", function(){
        console.warn("[MARU Revenue] failed to load:", src);
      }, { once:true });
      return;
    }

    var script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    script.onload = function(){
      if (typeof done === "function") done();
    };
    script.onerror = function(){
      console.warn("[MARU Revenue] failed to load:", src);
    };

    (document.head || document.documentElement).appendChild(script);
  }

  if (window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__) {
    installIfReady();
    return;
  }

  window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__ = true;

  loadScriptOnce(
    "/assets/js/maru-revenue-tracker.js",
    "maruRevenueTrackerScript",
    "MaruRevenueTracker",
    function(){
      loadScriptOnce(
        "/assets/js/maru-revenue-autohook.js",
        "maruRevenueAutoHookScript",
        "MaruRevenueAutoHook",
        installIfReady
      );
    }
  );
})();
