// tour-automap.js (PRODUCTION v7.2 - Home-pattern exact product routing + frame-safe right rail)
// - Right panel/mobile rail cards use the same internal /content.html?id=... route as Home cards
// - Only actual product/booking-detail destinations are eligible for the Tour right rail
// - Live Tour cards without an explicit id receive the exact same deterministic id as content-engine.js
// - Hosts that explicitly refuse IGDC framing are removed before they can open a dead grey page
// - Legacy .thumb-grid[data-psom-key="tour"] is disabled so it cannot push the index/slots
// - Main external tour .link-btn anchors open in the IGDC contained viewer; dynamic outbound rail links keep legacy top navigation
// - Revenue autohook loader is preserved

(function () {
  "use strict";

  if (window.__TOUR_RIGHTPANEL_AUTOMAP_V72__) return;
  window.__TOUR_RIGHTPANEL_AUTOMAP_V72__ = true;

  const HUB = "tour";
  const SNAPSHOT_URL = "/data/tour-snapshot.json?view=front";
  const FEED_URL = ""; // No non-IP fallback for the tour offer rail.

  const RIGHT_PANEL_ID = "rightAutoPanel";
  const RIGHT_SLOT_COUNT = 100;
  const RENDER_BATCH = 12;
  const FIRST_VIEW_EAGER = 6;
  const SOURCE_SCAN_LIMIT = RIGHT_SLOT_COUNT + 40;

  const MOBILE_RAIL_ID = "tour-mobile-rail";
  const MOBILE_LIST_SEL = "#tour-mobile-rail .list";
  const MOBILE_LIMIT = 100;

  const MOBILE_CSS_ID = "tour-mobile-rail-cap-v2";

  const CONTAINED_VIEWER_SRC = '/assets/js/igdc-contained-external-viewer.js?v=20260914-network-tour-stable-v8';
  const CONTAINED_VIEWER_SCRIPT_ID = 'igdc-contained-viewer-loader-network-tour-v8';
  const CONTAINED_THEME_ID = 'igdc-contained-toolbar-network-tour-theme-v6';

  function ensureContainedToolbarTheme(){
    if (document.getElementById(CONTAINED_THEME_ID)) return;
    const style = document.createElement('style');
    style.id = CONTAINED_THEME_ID;
    style.textContent = `
#igdc-contained-external-viewer .igdc-contained-bar{
  background:#cce89a !important;
  color:#16365c !important;
  border-bottom-color:#9dbd69 !important;
}
#igdc-contained-external-viewer .igdc-contained-back{
  background:#eff8df !important;
  color:#16365c !important;
  border-color:#94b861 !important;
}
#igdc-contained-external-viewer .igdc-contained-back:hover{
  background:#c3df86 !important;
  border-color:#7fa34f !important;
}
#igdc-contained-external-viewer .igdc-contained-back:active{
  background:#b7d679 !important;
}
#igdc-contained-external-viewer .igdc-contained-title{
  color:#16365c !important;
}
#igdc-contained-external-viewer .igdc-contained-host{
  color:#355b78 !important;
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureContainedViewer(){
    ensureContainedToolbarTheme();
    if (window.IGDCContainedViewer && Number(window.IGDCContainedViewer.version || 0) >= 8 && typeof window.IGDCContainedViewer.open === 'function') {
      return Promise.resolve(window.IGDCContainedViewer);
    }
    if (window.__IGDC_NETWORK_TOUR_VIEWER_V8_PROMISE__) return window.__IGDC_NETWORK_TOUR_VIEWER_V8_PROMISE__;

    window.__IGDC_NETWORK_TOUR_VIEWER_V8_PROMISE__ = new Promise(function(resolve, reject){
      let script = document.getElementById(CONTAINED_VIEWER_SCRIPT_ID);
      const finish = function(){
        if (window.IGDCContainedViewer && Number(window.IGDCContainedViewer.version || 0) >= 8 && typeof window.IGDCContainedViewer.open === 'function') {
          ensureContainedToolbarTheme();
          resolve(window.IGDCContainedViewer);
        } else {
          reject(new Error('IGDC contained viewer unavailable'));
        }
      };
      if (script) {
        if (script.dataset.loaded === '1') { finish(); return; }
        script.addEventListener('load', finish, { once:true });
        script.addEventListener('error', function(){ reject(new Error('IGDC contained viewer load failed')); }, { once:true });
        return;
      }
      script = document.createElement('script');
      script.id = CONTAINED_VIEWER_SCRIPT_ID;
      script.src = CONTAINED_VIEWER_SRC;
      script.async = true;
      script.dataset.igdcContainedViewer = '1';
      script.addEventListener('load', function(){ script.dataset.loaded = '1'; finish(); }, { once:true });
      script.addEventListener('error', function(){ reject(new Error('IGDC contained viewer load failed')); }, { once:true });
      (document.head || document.documentElement).appendChild(script);
    }).catch(function(err){
      window.__IGDC_NETWORK_TOUR_VIEWER_V8_PROMISE__ = null;
      throw err;
    });

    return window.__IGDC_NETWORK_TOUR_VIEWER_V8_PROMISE__;
  }


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

  const PRODUCT_ID_QUERY_KEYS = new Set([
    "goodsno","goods_no","goodsid","goods_id","productno","product_no","productid","product_id",
    "itemno","item_no","itemid","item_id","prdno","prd_no","sku","skuid","code","idx","no",
    "hotelid","hotel_id","roomid","room_id","activityid","activity_id","tourid","tour_id",
    "ticketid","ticket_id","packageid","package_id","bookingid","booking_id","offerid","offer_id"
  ]);

  function pad3(n){
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return "001";
    return String(Math.floor(x)).padStart(3, "0");
  }

  function numberFromUrl(url){
    try {
      const parsed = new URL(String(url || ""), window.location.origin);
      const last = (parsed.pathname.split("/").filter(Boolean).pop() || "");
      const m = last.match(/(\d+)/);
      return m ? Number(m[1]) : null;
    } catch(e) {
      const m = String(url || "").match(/(\d+)(?!.*\d)/);
      return m ? Number(m[1]) : null;
    }
  }

  // IMPORTANT: keep generated ids byte-for-byte compatible with
  // content-engine.js stableIdForItem().  In particular, the engine derives
  // the numeric fallback from item.url -> item.link -> item.href, not from an
  // affiliate alias.  Using a different URL here can resolve the clicked card
  // to a different snapshot item.
  function stableTourContentId(it, collection, index){
    const explicit = pickId(it);
    if (explicit) return explicit;
    const base = collection || "items";
    const stableUrl = pick(it, ["url", "link", "href"]);
    const n = Number(it && (it.priority || it.order || it.rank)) || numberFromUrl(stableUrl) || (Number(index) + 1) || 1;
    return base + "-" + pad3(n);
  }

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

  function isSpecificTourDestination(value){
    const raw = String(value || "").trim();
    if (isBadUrl(raw) || isExampleUrl(raw)) return false;
    try {
      const url = new URL(raw, window.location.origin);
      if (!/^https?:$/i.test(url.protocol) || !url.hostname) return false;
      const path = decodeURIComponent(url.pathname || "/").replace(/\/+$/, "") || "/";
      const lowPath = path.toLowerCase();
      const queryHasProductId = Array.from(url.searchParams.entries()).some(function(pair){
        return PRODUCT_ID_QUERY_KEYS.has(String(pair[0] || "").toLowerCase()) && String(pair[1] || "").trim();
      });
      if (queryHasProductId) return true;
      if (path === "/") return false;
      if (/(?:^|\/)(?:search|category|categories|catalog|collection|collections|best|event|events|home|main|travel|shop|store|list)(?:\/|$)/i.test(lowPath)) return false;
      if (/\/(?:products?|items?|goods|detail|offers?|activities|activity|attractions?|experiences?|tours?|tickets?|hotels?|resorts?|rooms?|stays?|cruises?|packages?|properties?|restaurants?|dining|reservation|car-rental|cars)\/[^/?#]{2,}/i.test(lowPath)) return true;
      if (/\/(?:dp\/prod|i\/item|goods\/view|product\/detail|hotel-detail|hotel-information)\/[^/?#]{1,}/i.test(lowPath)) return true;
      const last = path.split("/").filter(Boolean).pop() || "";
      return /\d{3,}/.test(last);
    } catch(e) { return false; }
  }

  function nestedTourDestination(it){
    const rr = it && it.researchReadiness && typeof it.researchReadiness === "object" ? it.researchReadiness : null;
    const sources = [
      it && it.productCard,
      rr && rr.productCard,
      it && it.directCommerceListing,
      it && it.brokerageContract
    ];
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      const value = pick(source, ["checkoutUrl","paymentUrl","purchaseUrl","orderUrl","externalProductUrl","officialProductUrl","productUrl","productPageUrl","detailUrl","destinationUrl","url","href","link"]);
      if (isSpecificTourDestination(value)) return value;
    }
    return "";
  }

  function pickProductDestination(it){
    if (!it || typeof it !== "object") return "";
    const directKeys = [
      "checkoutUrl","paymentUrl","purchaseUrl","orderUrl",
      "externalProductUrl","officialProductUrl","productUrl","product_url","productPageUrl","detailUrl","productLink","displayUrl",
      "affiliateOutboundUrl","affiliate_outbound_url","externalOutboundUrl","external_outbound_url"
    ];
    for (const key of directKeys) {
      const value = pick(it, [key]);
      if (isSpecificTourDestination(value)) return value;
    }
    const nested = nestedTourDestination(it);
    if (nested) return nested;
    for (const key of ["url","href","link","contentUrl","pageUrl"]) {
      const value = pick(it, [key]);
      if (isSpecificTourDestination(value)) return value;
    }
    return "";
  }
  function contentHref(id){ return id ? ("/content.html?id=" + encodeURIComponent(id)) : ""; }
  function resolveItemHref(item){
    // Match Home exactly: the visible card always enters the IGDC content route
    // first.  content-engine.js then replaces that frame with the verified Tour
    // product destination, preserving one-step browser Back.
    return item && item.id ? contentHref(item.id) : "";
  }

  function normalizeItems(raw, collection) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (let index = 0; index < arr.length; index++) {
      const it = arr[index];
      const title = pick(it, ["title", "name", "label", "caption"]);
      const thumb = pick(it, ["thumb", "image", "thumbnail", "img", "photo", "cover", "coverUrl", "thumbnailUrl"]);
      const sourceUrl = pickProductDestination(it);
      const id = stableTourContentId(it, collection, index);
      // The Tour rail is a transaction/detail surface.  Do not publish a card
      // whose only destination is a provider homepage, search page or category.
      if (!title || !thumb || !sourceUrl || !id) continue;
      out.push({
        id, title, thumb, link: contentHref(id), sourceUrl,
        affiliateOutboundUrl: pick(it, ["affiliateOutboundUrl","affiliate_outbound_url"]),
        externalOutboundUrl: pick(it, ["externalOutboundUrl","external_outbound_url"])
      });
      if (out.length >= SOURCE_SCAN_LIMIT) break;
    }
    return out;
  }

  async function fetchJson(url) {
    try {
      const r = await fetch(url, { cache: "no-store", priority: "high" });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  let initialSnapshotPromise = null;
  function getInitialSnapshotPromise(){
    if(!initialSnapshotPromise) initialSnapshotPromise = fetchJson(SNAPSHOT_URL);
    return initialSnapshotPromise;
  }

  function disablePsomThumbGrid() {
    const grids = document.querySelectorAll('.thumb-grid[data-psom-key="tour"]');
    grids.forEach(function(grid){
      grid.innerHTML = "";
      grid.style.display = "none";
      grid.dataset.mounted = "1";
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
      if (a.matches('a.link-btn[href^="http"]')) {
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
        const label = String(a.textContent || '').replace(/\s+/g, ' ').trim();
        ensureContainedViewer().then(function(viewer){
          viewer.open(href, { label: label, kind: 'tour' });
        }).catch(function(err){
          console.warn('[IGDC][Tour] contained viewer load failed:', err && err.message ? err.message : err);
        });
        return;
      }
      try { (window.top || window).location.assign(href); }
      catch(e){ window.location.href = href; }
    }, true);
  }

  const FRAME_CHECK_ENDPOINT = "/.netlify/functions/tour-page-proxy?action=frame-check&url=";
  const FRAME_CACHE_PREFIX = "igdc:tour:frame-host:v2:";
  const frameCheckPromises = new Map();
  const blockedFrameHosts = new Set();
  let renderedItems = [];

  function destinationHost(value){
    try { return new URL(String(value || ""), window.location.origin).hostname.toLowerCase(); }
    catch(e) { return ""; }
  }

  function readFrameHostCache(host){
    if (!host) return null;
    try {
      const raw = sessionStorage.getItem(FRAME_CACHE_PREFIX + host);
      if (!raw) return null;
      const row = JSON.parse(raw);
      if (!row || Date.now() - Number(row.at || 0) > 6 * 60 * 60 * 1000) return null;
      return row.allowed === true;
    } catch(e) { return null; }
  }

  function writeFrameHostCache(host, allowed){
    if (!host) return;
    try { sessionStorage.setItem(FRAME_CACHE_PREFIX + host, JSON.stringify({ at:Date.now(), allowed:allowed === true })); } catch(e) {}
  }

  function frameAllowedInsideIgdc(url){
    if (!isExternal(url)) return Promise.resolve(true);
    const host = destinationHost(url);
    if (!host) return Promise.resolve(false);
    const cached = readFrameHostCache(host);
    if (cached !== null) return Promise.resolve(cached);
    if (frameCheckPromises.has(host)) return frameCheckPromises.get(host);

    const promise = fetch(FRAME_CHECK_ENDPOINT + encodeURIComponent(url), { cache:"no-store", credentials:"same-origin" })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        // Only an explicit X-Frame-Options/CSP denial is grounds to remove a
        // card.  A probe timeout is unknown, not a rejection.
        const allowed = !(data && data.ok === true && data.directAllowed === false);
        writeFrameHostCache(host, allowed);
        if (!allowed) blockedFrameHosts.add(host);
        return allowed;
      })
      .catch(function(){
        // Network probe failure must not misclassify a legitimate seller.
        return true;
      })
      .finally(function(){ frameCheckPromises.delete(host); });

    frameCheckPromises.set(host, promise);
    return promise;
  }

  function filteredRenderableItems(items){
    return (items || []).filter(function(item){
      const host = destinationHost(item && item.sourceUrl);
      return !host || !blockedFrameHosts.has(host);
    }).slice(0, RIGHT_SLOT_COUNT);
  }

  function rerenderAfterFrameGate(){
    const safe = filteredRenderableItems(renderedItems);
    renderMobileRail(safe);
    renderRightPanel(safe);
  }

  async function preflightFrameHosts(items){
    const firstByHost = new Map();
    (items || []).forEach(function(item){
      const host = destinationHost(item && item.sourceUrl);
      if (host && !firstByHost.has(host)) firstByHost.set(host, item.sourceUrl);
    });
    const urls = Array.from(firstByHost.values());
    if (!urls.length) return;
    let cursor = 0;
    async function worker(){
      while(cursor < urls.length){
        const index = cursor++;
        await frameAllowedInsideIgdc(urls[index]);
      }
    }
    const workers = [];
    const workerCount = Math.min(3, urls.length);
    for(let i=0;i<workerCount;i++) workers.push(worker());
    await Promise.all(workers);
    rerenderAfterFrameGate();
  }

  function deferFramePreflight(items){
    const task = function(){ preflightFrameHosts(items); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(task, { timeout: 1800 });
    else setTimeout(task, 500);
  }

  function gateCardNavigation(ev, item, href){
    const sourceUrl = item && item.sourceUrl;
    if (!sourceUrl || !isExternal(sourceUrl)) return;
    ev.preventDefault();
    frameAllowedInsideIgdc(sourceUrl).then(function(allowed){
      if (!allowed) {
        const host = destinationHost(sourceUrl);
        if (host) blockedFrameHosts.add(host);
        rerenderAfterFrameGate();
        return;
      }
      window.location.assign(href);
    });
  }

  function ensureMobileCss() {
    if (document.getElementById(MOBILE_CSS_ID)) return;
    const style = document.createElement("style");
    style.id = MOBILE_CSS_ID;
    style.textContent = `
/* Mobile rail cards should look IDENTICAL to right panel cards */
#${MOBILE_RAIL_ID} .list{ display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch; }
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
    a.removeAttribute('data-igdc-external');
    a.removeAttribute('data-affiliate-outbound');
    a.removeAttribute('data-external-outbound');
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
    // Right-rail cards intentionally stay on the same Home-style IGDC route.
    // The external seller URL is used only for eligibility/frame-safety checks;
    // content-engine owns the actual seller hand-off.
    if (item && item.affiliateOutboundUrl) a.setAttribute('data-affiliate-outbound','1');
    if (item && item.externalOutboundUrl) a.setAttribute('data-external-outbound','1');
    if (item && item.sourceUrl) {
      a.addEventListener('click', function(ev){ gateCardNavigation(ev, item, href); }, { passive:false });
    }
  }

  function createRightBox(item, index) {
    const box = document.createElement("div");
    box.className = "ad-box";

    const a = document.createElement("a");
    applyAnchor(a, item);

    const img = document.createElement("img");
    img.src = item.thumb;
    img.alt = item.title || "";
    const eager = Number(index) >= 0 && Number(index) < FIRST_VIEW_EAGER;
    img.loading = eager ? "eager" : "lazy";
    img.decoding = "async";
    if (eager) { try { img.fetchPriority = "high"; } catch (_e) {} }

    const cap = document.createElement("div");
    cap.className = "tour-card-title";
    cap.textContent = item.title || "";

    a.appendChild(img);
    a.appendChild(cap);
    box.appendChild(a);
    return box;
  }

  const railRenderJobs = new WeakMap();

  function renderRailBatch(container, items, limit, mobile) {
    if (!container) return;
    const list = (items || []).slice(0, limit);
    container.innerHTML = "";
    if (!list.length) return;
    const job = { container: container, items: list, offset: 0, mobile: mobile, observer: null };
    railRenderJobs.set(container, job);

    function armObserver(current){
      if (!current || !('IntersectionObserver' in window) || current.offset >= current.items.length) return;
      if (current.observer) current.observer.disconnect();
      const last = current.container.lastElementChild;
      if (!last) return;
      current.observer = new IntersectionObserver(function(entries){
        if (!entries.some(function(entry){ return entry.isIntersecting; })) return;
        current.observer.disconnect();
        more(current);
      }, { root:null, rootMargin:'600px', threshold:0.01 });
      current.observer.observe(last);
    }

    function more(current){
      if (!current || railRenderJobs.get(container) !== current) return;
      const end = Math.min(current.offset + RENDER_BATCH, current.items.length);
      const frag = document.createDocumentFragment();
      for (let i=current.offset;i<end;i++) {
        const card = createRightBox(current.items[i], i);
        if (current.mobile) card.classList.add("card");
        frag.appendChild(card);
      }
      current.container.appendChild(frag);
      current.offset = end;
      armObserver(current);
    }
    more(job);

    if (container.dataset.igdcTourBatchBound === "1") return;
    container.dataset.igdcTourBatchBound = "1";
    container.addEventListener("scroll", function(){
      const current = railRenderJobs.get(container);
      if (!current || current.offset >= current.items.length) return;
      const horizontal = container.scrollWidth > container.clientWidth + 2;
      const nearEnd = horizontal
        ? container.scrollLeft + container.clientWidth >= container.scrollWidth - 60
        : container.scrollTop + container.clientHeight >= container.scrollHeight - 60;
      if (nearEnd) more(current);
    }, { passive:true });
  }

  function renderRightPanel(items) {
    const panel = byId(RIGHT_PANEL_ID);
    if (!panel) return;
    renderRailBatch(panel, items, RIGHT_SLOT_COUNT, false);
  }

  function renderMobileRail(items) {
    const rail = byId(MOBILE_RAIL_ID);
    const list = $(MOBILE_LIST_SEL);
    if (!rail || !list) return;
    if (!items || !items.length) { list.innerHTML = ""; rail.style.display = "none"; return; }
    rail.style.display = "block";
    ensureMobileCss();
    renderRailBatch(list, items, MOBILE_LIMIT, true);
  }

  async function run() {
    disablePsomThumbGrid();
    installExternalTopNavigation();

    const snap = await getInitialSnapshotPromise();
    let items = [];

    // Match content-engine.js collection context exactly so a generated id in
    // the card resolves to the same Tour snapshot item on /content.html.
    const rawItems = snap && Array.isArray(snap.items) && snap.items.length ? snap.items : null;
    const collection = rawItems ? "items" : "slots";
    items = normalizeItems(rawItems || ((snap && snap.slots) || []), collection);

    // No generic feed fallback: only the Edge-routed canonical IP snapshot is
    // allowed to populate the tour right panel and mobile rail.
    disablePsomThumbGrid();
    renderedItems = items;
    const visible = filteredRenderableItems(items);
    renderMobileRail(visible);
    renderRightPanel(visible);
    deferFramePreflight(items);
  }

  disablePsomThumbGrid();
  // Start snapshot I/O immediately and prevent DOM/load from duplicating the same request.
  getInitialSnapshotPromise().catch(function(){ initialSnapshotPromise = null; });
  let bootStarted = false;
  function bootOnce(){ if (bootStarted) return; bootStarted = true; run(); }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(bootOnce, 0);
  } else {
    installExternalTopNavigation();
    document.addEventListener("DOMContentLoaded", bootOnce, { once: true });
    window.addEventListener("load", bootOnce, { once: true });
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
