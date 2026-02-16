/* NETWORK AUTOMAP v1.0 - entry point (HTML loads ONLY this) */
(function(){
  'use strict';

  const HUB = 'network';
  const SNAPSHOT_URL = '/data/network-snapshot.json';
  const FEED_SRC = '/assets/js/feed-network.v1.js';
  const SLOT_COUNT = 100;

  function $(sel, root=document){ return root.querySelector(sel); }
  function ensureScript(src){
    return new Promise((resolve, reject) => {
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
    const grid = $('.thumb-grid[data-psom-key="network"]');
    if(!grid) return;
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
    if(window.__IGDC_NETWORK_AUTOMAP_DONE__) return;
    window.__IGDC_NETWORK_AUTOMAP_DONE__ = true;

    const panel = document.getElementById('rightAutoPanel');
    if(!panel){
      console.warn('[NETWORK AUTOMAP] missing #rightAutoPanel');
      return;
    }

    disablePsomThumbGrid();
    const slots = buildSlots(panel);

    const mobileList = document.getElementById('nh-mobile-rail-list');
    await ensureScript(FEED_SRC);

    if(!window.IGDC_FEED_NETWORK || typeof window.IGDC_FEED_NETWORK.fill !== 'function'){
      throw new Error('[NETWORK AUTOMAP] IGDC_FEED_NETWORK.fill not found');
    }

    await window.IGDC_FEED_NETWORK.fill({
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
