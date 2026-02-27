// network-rightpanel-automap.js (PRODUCTION v4 - USES __IGDC_RIGHTPANEL_RENDER HOOK)

(function () {
  'use strict';

  if (window.__NETWORK_AUTOMAP_V4__) return;
  window.__NETWORK_AUTOMAP_V4__ = true;

  const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
  const FEED_URL = '/.netlify/functions/feed-network?limit=100';
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

    // If we have no items, do NOT wipe existing (keep dummy / previous)
    if (!items || !items.length) return;

    list.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const item of items){
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

  function renderDesktopViaHook(items){
    // rightpanel-dummy-engine-v2 provides this hook
    if (typeof window.__IGDC_RIGHTPANEL_RENDER === 'function'){
      window.__IGDC_RIGHTPANEL_RENDER(items);
      return true;
    }
    return false;
  }

  async function loadItems(){
    // Snapshot first (정이사장님 설계)
    const snap = await loadSnapshot();
    if (snap && Array.isArray(snap.items) && snap.items.length){
      return snap.items;
    }

    // Feed fallback (보조 심부름꾼)
    const fd = await loadFeed();
    if (fd && Array.isArray(fd.items) && fd.items.length){
      return fd.items;
    }

    return [];
  }

  function buildFallback(){
    const out=[];
    for(let i=1;i<=LIMIT;i++){
      out.push({id:'fallback-'+i,title:'Sample '+i,link:'#',thumb:'/assets/sample/placeholder.jpg'});
    }
    return out;
  }

  async function runOnce(){
    const raw = await loadItems();
    let items = normalize(raw);

    // If everything is empty, render internal fallback to avoid 'title-only' blank.
    if (!items.length){
      items = buildFallback();
    }

    renderDesktopViaHook(items);
    renderMobile(items);
  }

  async function runWithRetry(){
    // Some pages load other scripts late; retry a few times
    for (let i=0;i<5;i++){
      await runOnce();
      // If hook exists and panel likely rendered, we can stop
      if (typeof window.__IGDC_RIGHTPANEL_RENDER === 'function'){
        // wait a tick for DOM
        await new Promise(r=>setTimeout(r, 250));
      } else {
        await new Promise(r=>setTimeout(r, 250));
      }
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', runWithRetry, { once:true });
  } else {
    runWithRetry();
  }

})();