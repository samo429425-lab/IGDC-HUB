/*
  IGDC Social Network AutoMap (v3.PROD2)
  - Reads /data/social.snapshot.json (placeholder_cards)
  - Renders 9 main sections into existing .thumb-grid[data-psom-key]
  - Renders RIGHT panel into #rightAutoPanel using .card markup (so CSS + mobile rail work)
  - On resize, re-renders AFTER the page's dummy right-panel bootstrap runs
*/

(function(){
  'use strict';
/**
 * socialnetwork-automap.v3.PROD3.js
 * - Desktop right panel (#rightAutoPanel): renders 100 "ad-box" slots (keeps original ad-panel layout).
 * - Mobile 10th section (#rpMobileGrid): renders same 100 items as "thumb-card" for touch drag.
 * - Main 9 sections: renders into each [data-psom-key] thumb-grid, preserving per-grid slot count.
 * - Always renders BOTH desktop and mobile targets, so resize restores correctly.
 */

(function(){
  'use strict';

  const SNAPSHOT_CANDIDATES = [
    '/data/social.snapshot.json',
    '/data/snapshot/social.snapshot.json',
    '/data/snapshots/social.snapshot.json',
    '/social.snapshot.json'
  ];

  const FEED_CANDIDATES = [
    '/.netlify/functions/feed-social',
    '/api/feed-social'
  ];

  const PAGE_KEY = 'social';

  const RIGHT_PANEL_KEY = 'socialnetwork';   // right panel / mobile 10th section uses this key
  const RIGHT_PANEL_COUNT = 100;

  const FALLBACK_CARD = {
    title: 'Loading...',
    subtitle: '',
    image: '',
    url: '#'
  };

  function $(sel, root=document){ return root.querySelector(sel); }
  function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  function safeText(v){ return (v==null?'':String(v)); }

  function normalizeItem(raw){
    if(!raw || typeof raw!=='object') return {...FALLBACK_CARD};
    return {
      title: safeText(raw.title || raw.name || raw.label || raw.platform || raw.brand || 'Loading...'),
      subtitle: safeText(raw.subtitle || raw.desc || raw.description || raw.category || ''),
      image: safeText(raw.image || raw.img || raw.thumbnail || raw.thumb || ''),
      url: safeText(raw.url || raw.href || raw.link || raw.target || '#')
    };
  }

  async function fetchJson(url){
    const r = await fetch(url, { cache: 'no-store' });
    if(!r.ok) throw new Error('HTTP '+r.status+' @ '+url);
    return await r.json();
  }

  async function loadSnapshot(){
    // 1) try snapshot files
    for(const u of SNAPSHOT_CANDIDATES){
      try{
        const j = await fetchJson(u);
        if(j && j.pages && j.pages[PAGE_KEY] && j.pages[PAGE_KEY].sections) return j;
      }catch(_e){}
    }
    // 2) try feed (if it returns snapshot-like shape)
    for(const u of FEED_CANDIDATES){
      try{
        const j = await fetchJson(u);
        if(j && j.pages && j.pages[PAGE_KEY] && j.pages[PAGE_KEY].sections) return j;
      }catch(_e){}
    }
    throw new Error('No social snapshot/feed found');
  }

  function getSectionItems(snapshot, key){
    const secs = snapshot?.pages?.[PAGE_KEY]?.sections;
    const arr = secs?.[key];
    if(Array.isArray(arr)) return arr.map(normalizeItem);
    if(arr && Array.isArray(arr.items)) return arr.items.map(normalizeItem);
    return [];
  }

  function buildThumbCard(item, label){
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener';

    const img = document.createElement('img');
    img.alt = item.title || '';
    if(item.image){
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = item.image;
    }else{
      // keep empty image space consistent
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    }

    const body = document.createElement('div');
    body.className = 'thumb-body';

    const t = document.createElement('div');
    t.className = 'thumb-title';
    t.textContent = item.title || 'Loading...';

    const s = document.createElement('div');
    s.className = 'thumb-sub';
    s.textContent = item.subtitle || (label ? label : '');

    body.appendChild(t);
    body.appendChild(s);
    a.appendChild(img);
    a.appendChild(body);
    return a;
  }

  function ensureAdBoxes(panelEl, count){
    if(!panelEl) return;
    const boxes = panelEl.querySelectorAll('.ad-box');
    const need = count - boxes.length;
    if(need <= 0) return;
    for(let i=0;i<need;i++){
      const b = document.createElement('div');
      b.className = 'ad-box';
      const inner = document.createElement('div');
      inner.textContent = 'Loading...';
      b.appendChild(inner);
      panelEl.appendChild(b);
    }
  }

  function fillAdBoxes(panelEl, items, count){
    if(!panelEl) return;
    ensureAdBoxes(panelEl, count);

    const boxes = Array.from(panelEl.querySelectorAll('.ad-box')).slice(0, count);
    for(let i=0;i<count;i++){
      const it = items[i] || FALLBACK_CARD;
      const item = normalizeItem(it);

      const box = boxes[i];
      box.innerHTML = ''; // keep wrapper, replace content only

      const a = document.createElement('a');
      a.href = item.url || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.display = 'block';
      a.style.width = '100%';
      a.style.height = '100%';
      a.style.textDecoration = 'none';
      a.style.color = 'inherit';

      // If image exists, show a minimal top thumbnail strip without breaking fixed height:
      if(item.image){
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = item.title || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.width = '100%';
        img.style.height = '88px';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '10px';
        img.style.display = 'block';
        a.appendChild(img);
      }

      const txt = document.createElement('div');
      txt.textContent = item.title || 'Loading...';
      txt.style.padding = item.image ? '8px 10px 0' : '0 10px';
      txt.style.fontWeight = '700';
      txt.style.fontSize = '13px';
      txt.style.lineHeight = '1.25';
      txt.style.wordBreak = 'break-word';

      const sub = document.createElement('div');
      sub.textContent = item.subtitle || '';
      sub.style.padding = '4px 10px 0';
      sub.style.fontSize = '12px';
      sub.style.opacity = '0.85';
      sub.style.lineHeight = '1.2';

      a.appendChild(txt);
      if(item.subtitle) a.appendChild(sub);

      box.appendChild(a);
    }
  }

  function renderThumbGrid(gridEl, items, label){
    if(!gridEl) return;
    // preserve slot count from existing HTML if present
    const existing = gridEl.querySelectorAll('.thumb-card');
    const desired = existing.length > 0 ? existing.length : 12;

    gridEl.innerHTML = '';
    for(let i=0;i<desired;i++){
      const item = items[i] ? normalizeItem(items[i]) : {...FALLBACK_CARD};
      gridEl.appendChild(buildThumbCard(item, label));
    }
  }

  function renderMobileRightGrid(gridEl, items){
    if(!gridEl) return;
    gridEl.innerHTML = '';
    for(let i=0;i<RIGHT_PANEL_COUNT;i++){
      const item = items[i] ? normalizeItem(items[i]) : {...FALLBACK_CARD};
      gridEl.appendChild(buildThumbCard(item, ''));
    }
  }

  let _snapshotCache = null;
  let _renderTimer = null;

  async function ensureSnapshot(){
    if(_snapshotCache) return _snapshotCache;
    _snapshotCache = await loadSnapshot();
    return _snapshotCache;
  }

  async function renderAll(){
    const snap = await ensureSnapshot();

    // 1) main 9 sections
    const grids = $all('.thumb-grid[data-psom-key]');
    grids.forEach(grid=>{
      const key = grid.getAttribute('data-psom-key');
      if(!key) return;
      if(key === RIGHT_PANEL_KEY) return; // handled separately
      const items = getSectionItems(snap, key);
      renderThumbGrid(grid, items, '');
    });

    // 2) desktop right panel (popular items)
    const rightItems = getSectionItems(snap, RIGHT_PANEL_KEY);
    fillAdBoxes($('#rightAutoPanel'), rightItems, RIGHT_PANEL_COUNT);

    // 3) mobile 10th section
    renderMobileRightGrid($('#rpMobileGrid'), rightItems);
  }

  function debounceRender(){
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(()=>{ renderAll().catch(console.error); }, 160);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    renderAll().catch(console.error);
    window.addEventListener('resize', debounceRender, { passive:true });
  });

})();
