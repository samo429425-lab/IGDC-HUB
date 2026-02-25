// network-rightpanel-automap.js (FINAL - SNAPSHOT FIRST MODE)

(function () {
  'use strict';

  if (window.__NETWORK_AUTOMAP_FINAL__) return;
  window.__NETWORK_AUTOMAP_FINAL__ = true;

  const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
  const FEED_URL = '/.netlify/functions/feed-network?limit=100';
  const LIMIT = 100;

  const DESKTOP_ID = 'rightAutoPanel';
  const MOBILE_ID = 'nh-mobile-rail-list';

  function $(id){
    return document.getElementById(id);
  }

  function pick(it, keys){
    for (const k of keys){
      const v = it && it[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function pickUrl(it){
    return pick(it, ['url','link','href']) || '#';
  }

  function pickImg(it){
    return pick(it, ['thumb','image','thumbnail','img','photo','cover']);
  }

  function createBox(i, item){
    const box = document.createElement('div');
    box.className = 'ad-box';

    const a = document.createElement('a');
    const href = pickUrl(item);

    a.href = href;

    if (href !== '#'){
      a.target = '_blank';
      a.rel = 'noopener';
    }

    const img = document.createElement('img');

    img.src = pickImg(item) || '/assets/sample/placeholder.jpg';
    img.alt = item.title || 'thumb';
    img.loading = 'lazy';
    img.decoding = 'async';

    a.appendChild(img);
    box.appendChild(a);

    return box;
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

  async function loadItems(){

    // 1순위: Snapshot
    const snap = await loadSnapshot();

    if (snap && Array.isArray(snap.items) && snap.items.length){
      return snap.items;
    }

    // 2순위: Feed
    const feed = await loadFeed();

    if (feed && Array.isArray(feed.items) && feed.items.length){
      return feed.items;
    }

    return [];
  }

  function ensureDummy(container){
    if (!container) return;
    if (container.children.length > 0) return;

    for (let i=1;i<=LIMIT;i++){
      container.appendChild(createBox(i, {}));
    }
  }

  function render(container, items){

    if (!container) return;

    if (!items || !items.length){
      ensureDummy(container);
      return;
    }

    container.innerHTML = '';

    const max = Math.min(items.length, LIMIT);

    for (let i=0;i<max;i++){
      container.appendChild(createBox(i+1, items[i]));
    }
  }

  async function run(){

    const desktop = $(DESKTOP_ID);
    const mobile = $(MOBILE_ID);

    ensureDummy(desktop);
    ensureDummy(mobile);

    const items = await loadItems();

    render(desktop, items);
    render(mobile, items);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', run, { once:true });
  }else{
    run();
  }

})();