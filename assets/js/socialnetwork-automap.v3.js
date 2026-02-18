'use strict';
/**
 * socialnetwork-automap.v4.js
 * A-Standard: HTML-first order, Snapshot/Feed data, NO layout-breaking DOM ops.
 * - 9 platform sections: fill ONLY their own [data-psom-key] containers (in HTML order)
 * - Right panel (10th): delegate to window.__IGDC_RIGHTPANEL_RENDER (HTML owns mobile+desktop rail)
 * - No global [data-psom-key] sweeping beyond the social page containers
 * - No container.innerHTML='' on layout wrappers; ONLY on the exact section grid container
 */

(function(){

  /* ================= CONFIG ================= */
  const FEED_URL = '/.netlify/functions/feed-social?page=socialnetwork';
  const SNAPSHOT_FALLBACK_URL = '/data/social.snapshot.json';
  const TIMEOUT_MS = 12000;

  /* ================= UTILS ================= */
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));

  function withTimeout(promise, ms){
    return Promise.race([
      promise,
      new Promise((_, rej)=> setTimeout(()=> rej(new Error('timeout')), ms))
    ]);
  }

  async function fetchJSON(url){
    const res = await withTimeout(fetch(url, { credentials:'same-origin' }), TIMEOUT_MS);
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  function normalizeItem(it){
    if(!it || typeof it !== 'object') return null;

    const title = (it.title || it.name || '').toString();
    const url   = (it.url || it.link || '#').toString();
    const thumb = (it.thumb || it.image || it.icon || '').toString();

    // keep placeholders but mark them
    const type  = (it.type || '').toString();

    return {
      id: it.id || '',
      type,
      title,
      url,
      thumb
    };
  }

  function makeCard(item){
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener';

    const img = document.createElement('img');
    img.className = 'thumb-media';
    img.loading = 'lazy';
    img.decoding = 'async';
    if(item.thumb) img.src = item.thumb;
    img.alt = item.title || '';

    const t = document.createElement('div');
    t.className = 'thumb-title';
    t.textContent = item.title || '';

    a.appendChild(img);
    a.appendChild(t);
    return a;
  }

  function renderIntoGrid(gridEl, rawItems, limit){
    if(!gridEl) return;

    // IMPORTANT: Only clear the grid element itself (NOT parents/wrappers)
    gridEl.textContent = '';

    const items = [];
    for(const it of (rawItems || [])){
      const n = normalizeItem(it);
      if(!n) continue;
      // If placeholder: keep only when there's nothing else
      items.push(n);
      if(limit && items.length >= limit) break;
    }

    // If all placeholders and no real content, still show placeholders (keeps UX stable)
    const hasReal = items.some(x => x.url && x.url !== '#' && x.type !== 'placeholder');
    const finalItems = hasReal ? items.filter(x => x.url && x.url !== '#' && x.type !== 'placeholder') : items;

    for(const it of finalItems){
      gridEl.appendChild(makeCard(it));
    }
  }

  function getHTMLOrderKeys(){
    // HTML-first: use appearance order of section grids
    return qsa('[data-psom-key]').map(el => (el.getAttribute('data-psom-key')||'').trim()).filter(Boolean);
  }

  function getSectionContainersByKey(){
    const map = {};
    qsa('[data-psom-key]').forEach(el=>{
      const k = (el.getAttribute('data-psom-key')||'').trim();
      if(!k) return;
      // first one wins (prevents accidental duplicates)
      if(!map[k]) map[k] = el;
    });
    return map;
  }

  function extractSectionsFromFeed(payload){
    // feed-social returns: { grid:{ sections:{ id: items[] } } }
    const sections = payload && payload.grid && payload.grid.sections;
    if(sections && typeof sections === 'object') return sections;
    return null;
  }

  function extractSectionsFromSnapshot(payload){
    // snapshot returns: { pages:{ social:{ sections:{ id: items[] } } } }
    const sections = payload && payload.pages && payload.pages.social && payload.pages.social.sections;
    if(sections && typeof sections === 'object') return sections;
    return null;
  }

  function renderRightPanel(rightItems){
    // HTML owns both desktop right rail + mobile 10th section
    if(typeof window.__IGDC_RIGHTPANEL_RENDER === 'function'){
      try{
        window.__IGDC_RIGHTPANEL_RENDER(rightItems || []);
      }catch(e){
        console.warn('[SOCIAL][RIGHT] render failed:', e);
      }
    }
  }

  async function loadSections(){
    // 1) Try feed (preferred)
    try{
      const feed = await fetchJSON(FEED_URL);
      const sections = extractSectionsFromFeed(feed);
      if(sections) return sections;
    }catch(e){
      console.warn('[SOCIAL] feed failed, fallback snapshot:', e && e.message || e);
    }

    // 2) Fallback snapshot
    try{
      const snap = await fetchJSON(SNAPSHOT_FALLBACK_URL);
      const sections = extractSectionsFromSnapshot(snap);
      if(sections) return sections;
    }catch(e){
      console.warn('[SOCIAL] snapshot fallback failed:', e && e.message || e);
    }

    return null;
  }

  async function init(){
    // Guard: only run on socialnetwork.html (rightRail exists)
    if(!qs('#rightRail') && !qs('body')) return;

    const keysInOrder = getHTMLOrderKeys();
    const containers = getSectionContainersByKey();

    const sections = await loadSections();
    if(!sections){
      console.warn('[SOCIAL] No sections data available');
      return;
    }

    // Render in HTML order. Right panel is delegated.
    for(const key of keysInOrder){
      if(key === 'socialnetwork'){
        renderRightPanel(sections[key] || []);
        continue;
      }
      const gridEl = containers[key];
      renderIntoGrid(gridEl, sections[key] || [], 100);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init, { once:true });
  }else{
    init();
  }

})();