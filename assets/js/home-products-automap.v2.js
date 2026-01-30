
/**
 * home-products-automap.v2.merged.js
 * ------------------------------------------------------------
 * MERGED FINAL VERSION
 *
 * GOAL
 *  - Preserve ORIGINAL main-page automap behavior (home_1 ~ home_5) 100%
 *  - Add RIGHT panel support (home_right_top/middle/bottom)
 *  - Single file, no external controller, no pipeline override
 *
 * RULE
 *  - MAIN code path is copied AS-IS from the original working automap
 *  - RIGHT panel logic is strictly scoped and appended
 */

(function () {
  'use strict';
  if (window.__HOME_PRODUCTS_AUTOMAP_V2_MERGED__) return;
  window.__HOME_PRODUCTS_AUTOMAP_V2_MERGED__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';

  const KEYS_MAIN  = ['home_1','home_2','home_3','home_4','home_5'];
  const KEYS_RIGHT = ['home_right_top','home_right_middle','home_right_bottom'];

  /* ============================================================
   *  MAIN AUTOMAP  (ORIGINAL – DO NOT TOUCH LOGIC)
   * ============================================================ */

  function qs(sel, root){ return (root||document).querySelector(sel); }

  function normMain(it){
    it = it || {};
    return {
      title: it.title || it.name || '',
      thumb: it.thumb || it.image || '',
      url: it.url || '#'
    };
  }

  function buildMainCard(item){
    const a = document.createElement('a');
    a.className = 'shop-card';
    a.href = item.url || '#';
    if (item.thumb){
      a.style.backgroundImage = 'url(\"'+item.thumb.replace(/\"/g,'')+'\")';
      a.style.backgroundSize = 'cover';
      a.style.backgroundPosition = 'center';
    }
    const cap = document.createElement('div');
    cap.className = 'shop-card-cap';
    cap.textContent = item.title || '';
    a.appendChild(cap);
    return a;
  }

  function renderMain(key, items){
    const psomEl = qs('[data-psom-key="'+key+'"]');
    if (!psomEl) return;

    const scroller = psomEl.closest('.shop-scroller');
    const row = scroller && scroller.querySelector('.shop-row');
    if (!row) return;

    row.innerHTML = '';
    items.map(normMain).forEach(it => row.appendChild(buildMainCard(it)));
  }

  /* ============================================================
   *  RIGHT PANEL ADDITION  (SAFE / ISOLATED)
   * ============================================================ */

  function normRight(it){
    if (!it) return null;
    return {
      title: it.title || '',
      thumb: it.thumb || '',
      url: it.url || '#',
      priority: typeof it.priority === 'number' ? it.priority : 999999
    };
  }

  function buildRightCard(item){
    const a = document.createElement('a');
    a.className = 'ad-box news-btn';
    a.href = item.url || '#';
    a.target = '_blank';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = item.thumb || '';
    img.alt = item.title || '';
    a.appendChild(img);
    return a;
  }

  function renderRight(key, items){
    const psomEl = qs('[data-psom-key="'+key+'"]');
    if (!psomEl) return;

    const list = psomEl.classList.contains('ad-list')
      ? psomEl
      : psomEl.querySelector('.ad-list');
    if (!list) return;

    list.innerHTML = '';
    items.map(normRight).filter(Boolean)
      .sort((a,b)=>a.priority-b.priority)
      .forEach(it => list.appendChild(buildRightCard(it)));
  }

  /* ============================================================
   *  BOOT
   * ============================================================ */

  async function load(){
    const r = await fetch(FEED_URL,{cache:'no-store'});
    if (!r.ok) return;
    const data = await r.json();
    if (!data || !Array.isArray(data.sections)) return;

    // MAIN (AS-IS)
    KEYS_MAIN.forEach(k=>{
      const sec = data.sections.find(s=>s.id===k);
      if (sec && Array.isArray(sec.items)) renderMain(k, sec.items);
    });

    // RIGHT (NEW)
    KEYS_RIGHT.forEach(k=>{
      const sec = data.sections.find(s=>s.id===k);
      if (sec && Array.isArray(sec.items)) renderRight(k, sec.items);
    });
  }

  if (document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', load, {once:true});
  } else {
    load();
  }
})();
