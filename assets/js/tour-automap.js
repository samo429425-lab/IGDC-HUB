/* TOUR AUTOMAP v1.0 - entry point (HTML loads ONLY this) */
(function(){
  'use strict';

  const HUB = 'tour';
  const SNAPSHOT_URL = '/data/tour-snapshot.json';
  const FEED_SRC = '/.netlify/functions/feed-tour.v1.js';
  const SLOT_COUNT = 100;

  function $(sel, root=document){ return root.querySelector(sel); }
  function ensureScript(src){
    return new Promise((resolve, reject) => {
      // already loaded?
      const existing = Array.from(document.scripts).find(s => (s.getAttribute('src')||'') === src);
      if(existing){ 
        if(existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve(), { once:true });
        existing.addEventListener('error', () => reject(new Error('script load error: ' + src)), { once:true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.loaded = '0';
      s.onload = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = () => reject(new Error('script load error: ' + src));
      document.head.appendChild(s);
    });
  }

  function disablePsomThumbGrid(){
    const grid = $('.thumb-grid[data-psom-key="tour"]');
    if(!grid) return;
    // prevent other engines from injecting into this grid
    grid.innerHTML = '';
    grid.style.display = 'none';
    grid.setAttribute('data-disabled','1');
  }

  function buildSlots(panel){
    panel.innerHTML = '';
    const slots = [];
    for(let i=0;i<SLOT_COUNT;i++){
      const box = document.createElement('div');
      box.className = 'ad-box';
      box.setAttribute('data-slot', String(i+1));
      slots.push(box);
      panel.appendChild(box);
    }
    return slots;
  }

  async function run(){
    if(window.__IGDC_TOUR_AUTOMAP_DONE__) return;
    window.__IGDC_TOUR_AUTOMAP_DONE__ = true;

    const panel = document.getElementById('rightAutoPanel');
    if(!panel){
      console.warn('[TOUR AUTOMAP] missing #rightAutoPanel');
      return;
    }

    disablePsomThumbGrid();
    const slots = buildSlots(panel);

    const mobileList = $('#tour-mobile-rail .list');
    await ensureScript(FEED_SRC);

    if(!window.IGDC_FEED_TOUR || typeof window.IGDC_FEED_TOUR.fill !== 'function'){
      throw new Error('[TOUR AUTOMAP] IGDC_FEED_TOUR.fill not found');
    }

    await window.IGDC_FEED_TOUR.fill({
      hubKey: HUB,
      snapshotUrl: SNAPSHOT_URL,
      slots,
      mobileListEl: mobileList,
      mobileLimit: 30
    });
  }

  window.addEventListener('load', () => {
    run().catch(err => console.error(err));
  });
})();
