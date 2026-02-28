// network-rightpanel-automap.js (PRODUCTION v5 - SINGLE PASS, RIGHT PANEL ONLY)
// - NetworkHub: right panel only (desktop right rail + mobile bottom rail)
// - No main sections mapping
// - Never wipes HTML dummy when data is empty
// - Avoids multi-pass overwrite timing issues

(function () {
  'use strict';

  if (window.__NETWORK_AUTOMAP_V5__) return;
  window.__NETWORK_AUTOMAP_V5__ = true;

  const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
  const FEED_URL = '/.netlify/functions/feed-network?key=rightpanel&limit=100';
  const LIMIT = 100;

  const MOBILE_ID = 'nh-mobile-rail-list';

  function $(id){ return document.getElementById(id); }

  function pick(it, keys){
    for (const k of keys){
      const v = it && it[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function pickLink(it){
    // rightpanel-dummy-engine-v2 expects "link"
    return pick(it, ['link','url','href']) || '#';
  }

  function pickThumb(it){
    // rightpanel-dummy-engine-v2 expects "thumb"
    return pick(it, ['thumb','image','thumbnail','img','photo','cover']);
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

  async function loadSnapshot(){
    return await fetchJson(SNAPSHOT_URL + '?_t=' + Date.now());
  }

  async function loadFeed(){
    return await fetchJson(FEED_URL + '&_t=' + Date.now());
  }

  function normalize(items){
    const out = [];
    for (const it of (items || [])){
      const thumb = pickThumb(it);
      if (!thumb) continue;

      out.push({
        id: it.id || it._id || it.trackId || '',
        title: (it.title || it.name || it.label || '').toString(),
        link: pickLink(it),
        thumb
      });

      if (out.length >= LIMIT) break;
    }
    return out;
  }

  function renderMobile(items){
    const list = $(MOBILE_ID);
    if (!list) return;

    // If we have no items, do NOT wipe existing (keep HTML dummy / previous)
    if (!items || !items.length) return;

    // Mobile rail wants up to 15 cards
    const take = items.slice(0, 15);

    list.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const item of take){
      const card = document.createElement('div');
      card.className = 'ad-box';

      const a = document.createElement('a');
      a.href = item.link || '#';
      if (item.link && item.link !== '#'){
        a.target = '_blank';
        a.rel = 'noopener';
      }else{
        a.tabIndex = -1;
        a.setAttribute('aria-hidden','true');
      }

      const img = document.createElement('img');
      img.src = item.thumb;
      img.alt = item.title || '';
      img.loading = 'lazy';
      img.decoding = 'async';

      a.appendChild(img);
      card.appendChild(a);
      frag.appendChild(card);
    }

    list.appendChild(frag);
  }

  function callDesktopHook(items){
    if (typeof window.__IGDC_RIGHTPANEL_RENDER === 'function'){
      window.__IGDC_RIGHTPANEL_RENDER(items);
      return true;
    }
    return false;
  }

  async function waitForHookAndRender(items){
    // Render once when hook becomes available (avoid overwrite loops)
    const deadline = Date.now() + 2500; // 2.5s max
    while (Date.now() < deadline){
      if (callDesktopHook(items)) return true;
      await new Promise(r => setTimeout(r, 120));
    }
    // If hook never appears, we still keep HTML dummy (no wipe)
    return false;
  }

  async function loadItems(){
    // Snapshot first
    const snap = await loadSnapshot();
    if (snap && Array.isArray(snap.items) && snap.items.length){
      return snap.items;
    }

    // Feed fallback
    const fd = await loadFeed();
    if (fd && Array.isArray(fd.items) && fd.items.length){
      return fd.items;
    }

    return [];
  }

  async function run(){
    const raw = await loadItems();
    const items = normalize(raw);

    // 핵심: 비어있으면 HTML을 건드리지 않는다 (더미/기존 유지)
    if (!items.length) return;

    // Desktop right rail via hook (single pass)
    await waitForHookAndRender(items);

    // Mobile bottom rail (direct)
    renderMobile(items);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }

})();
