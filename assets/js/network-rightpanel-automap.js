// network-rightpanel-automap.js (PRODUCTION v6 - internal content page routing + top external main links)
// - Right panel product slots open IGDC internal /content.html?id=...
// - Placeholder/# links are disabled unless an item id exists
// - Main hub external .link-btn anchors use top navigation so browser Back returns to IGDC
// - Desktop/mobile rail rendering and revenue autohook are preserved

(function () {
  'use strict';

  if (window.__NETWORK_AUTOMAP_V6__) return;
  window.__NETWORK_AUTOMAP_V6__ = true;

  const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
  const FEED_URL = ''; // IP-scoped network market slots never fall back to a generic feed.
  const LIMIT = 100;

  const MOBILE_ID = 'nh-mobile-rail-list';
  const MOBILE_CSS_ID = 'nh-mobile-rail-fix-v2';

  function $(id){ return document.getElementById(id); }

  function pick(it, keys){
    for (const k of keys){
      const v = it && it[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
    return '';
  }

  function pickId(it){ return pick(it, ['id','contentId','productId','itemId','sku','code','pid']); }
  function pickLink(it){ return pick(it, ['affiliateOutboundUrl','affiliate_outbound_url','externalOutboundUrl','external_outbound_url','contentUrl','pageUrl','detailUrl','checkoutUrl','paymentUrl','productUrl','purchaseUrl','orderUrl','link','url','href']) || '#'; }
  function pickThumb(it){ return pick(it, ['thumb','image','thumbnail','img','photo','cover','coverUrl','thumbnailUrl']); }
  function pickTitle(it){ return pick(it, ['title','name','label','caption']); }

  function isExternal(url){ return /^https?:\/\//i.test(String(url || '')); }
  function isBadUrl(url){
    const u = String(url || '').trim();
    return !u || u === '#' || /^javascript:/i.test(u) || /^about:blank$/i.test(u);
  }
  function isExampleUrl(url){
    const u = String(url || '').trim();
    if (!u) return false;
    try { return /(^|\.)example\.(com|org|net)$/i.test(new URL(u, window.location.origin).hostname); }
    catch(e){ return /example\.(com|org|net)/i.test(u); }
  }
  function contentHref(id){ return id ? ('/content.html?id=' + encodeURIComponent(id)) : ''; }
  function resolveItemHref(item){
    // Prefer the IGDC content detail whenever this is an indexed product.  The
    // seller URL is exposed from that page, not as the card's first navigation.
    if (item && item.id) return contentHref(item.id);
    const outbound = item && (item.affiliateOutboundUrl || item.externalOutboundUrl || '');
    if (outbound && !isBadUrl(outbound) && !isExampleUrl(outbound)) return outbound;
    const link = item && item.link;
    if (isBadUrl(link) || isExampleUrl(link)) return '';
    return link || '';
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
      a.setAttribute('aria-disabled','true');
      a.setAttribute('data-igdc-disabled','1');
      a.addEventListener('click', function(ev){ ev.preventDefault(); }, { passive:false });
      return;
    }
    a.href = href;
    if (item && item.id) a.setAttribute('data-igdc-content-id', item.id);
    if (item && item.sourceUrl) a.setAttribute('data-igdc-source-url', item.sourceUrl);
    if (isExternal(href)){
      if (item && item.affiliateOutboundUrl) a.setAttribute('data-affiliate-outbound','1');
      if (item && item.externalOutboundUrl) a.setAttribute('data-external-outbound','1');
      a.target = '_top';
      a.rel = 'noopener';
      a.setAttribute('data-igdc-external','top');
    }
  }

  function installExternalTopNavigation(){
    if (window.__IGDC_NETWORK_TOP_NAV_INSTALLED__) return;
    window.__IGDC_NETWORK_TOP_NAV_INSTALLED__ = true;
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

  function ensureMobileCss(){
    if (document.getElementById(MOBILE_CSS_ID)) return;
    const style = document.createElement('style');
    style.id = MOBILE_CSS_ID;
    style.textContent = `
/* network mobile rail fix (production) */
#nh-mobile-rail .card{ position:relative; }
#nh-mobile-rail .card a{ display:block; width:100%; height:100%; }
#nh-mobile-rail .card img{ display:block; width:100%; height:100%; object-fit:cover; }
#nh-mobile-rail .cap{
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

  async function fetchJson(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      if (!r.ok) return null;
      return await r.json();
    }catch{
      return null;
    }
  }

  function normalizeItems(raw){
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const it of arr){
      const thumb = pickThumb(it);
      const title = pickTitle(it);
      if (!thumb || !title) continue;
      out.push({
        id: pickId(it),
        title,
        thumb,
        link: pickLink(it),
        sourceUrl: pickLink(it),
        affiliateOutboundUrl: pick(it, ['affiliateOutboundUrl','affiliate_outbound_url']),
        externalOutboundUrl: pick(it, ['externalOutboundUrl','external_outbound_url'])
      });
      if (out.length >= LIMIT) break;
    }
    return out;
  }

  function createCard(item, mobile){
    const card = document.createElement('div');
    card.className = mobile ? 'card' : 'ad-box';

    const a = document.createElement('a');
    applyAnchor(a, item);

    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = item.title || '';
    img.loading = 'lazy';
    img.decoding = 'async';

    a.appendChild(img);
    card.appendChild(a);

    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = item.title || '';
    card.appendChild(cap);

    return card;
  }

  function disablePsomThumbGrid(){
    document.querySelectorAll('.thumb-grid[data-psom-key="network-right"]').forEach(function(grid){
      grid.innerHTML = '';
      grid.style.display = 'none';
      grid.setAttribute('data-psom-mode', 'disabled');
      grid.setAttribute('data-disabled', '1');
      grid.setAttribute('aria-hidden', 'true');
    });
  }

  function renderMobile(items){
    const list = $(MOBILE_ID);
    if (!list) return;
    if (!items || !items.length) { list.innerHTML = ''; return; }

    ensureMobileCss();
    list.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const item of items){
      frag.appendChild(createCard(item, true));
    }
    list.appendChild(frag);
  }

  function renderDesktopDirect(items){
    const panel = document.getElementById('rightAutoPanel');
    if (!panel) return;
    if (!items || !items.length) { panel.innerHTML = ''; return; }

    panel.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const item of items){
      frag.appendChild(createCard(item, false));
    }
    panel.appendChild(frag);
  }

  async function run(){
    disablePsomThumbGrid();
    installExternalTopNavigation();
    const snap = await fetchJson(SNAPSHOT_URL);

    let items = snap && Array.isArray(snap.items)
      ? normalizeItems(snap.items)
      : [];

    // No generic feed fallback: it has no canonical country/region scope.
    renderMobile(items);
    renderDesktopDirect(items);
  }

  disablePsomThumbGrid();

  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(run, 0);
  } else {
    installExternalTopNavigation();
    document.addEventListener('DOMContentLoaded', run, { once:true });
    window.addEventListener('load', run, { once:true });
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
