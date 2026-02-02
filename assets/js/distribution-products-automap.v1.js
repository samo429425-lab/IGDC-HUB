/**
 * distribution-products-automap.v1.js
 * STABLE FIXED – snapshot-first + feed fallback
 *
 * Fixes:
 * 1) Never append after dummies: clears render container before render
 * 2) Never wipe on empty list
 * 3) Right panel support: dist_right / distribution / distribution-right / dist_right key
 * 4) Snapshot-first; feed runs only if snapshot produced nothing
 *
 * Expected HTML:
 *  - main: elements with data-psom-key matching section keys
 *  - right: element with data-psom-key="distribution" OR "dist_right" OR "distribution-right"
 */

(function () {
  'use strict';
  if (window.__DISTRIBUTION_AUTOMAP_FIXED_V1__) return;
  window.__DISTRIBUTION_AUTOMAP_FIXED_V1__ = true;

  const SNAPSHOT_URL = '/data/front.snapshot.json';
  const FEED_URL = '/.netlify/functions/feed?page=distribution';

  // Main keys we care about (supports both naming schemes)
  const MAIN_KEYS = [
    'distribution-recommend',
    'distribution-sponsor',
    'distribution-trending',
    'distribution-new',
    'distribution-special',
    'distribution-others',
    // alt keys (if snapshot uses dist_*)
    'dist_1','dist_2','dist_3','dist_4','dist_5','dist_6'
  ];

  // Map dist_* => distribution-* for rendering into HTML slots (if HTML uses distribution-*)
  const KEY_ALIASES = {
    'dist_1': 'distribution-recommend',
    'dist_2': 'distribution-sponsor',
    'dist_3': 'distribution-trending',
    'dist_4': 'distribution-new',
    'dist_5': 'distribution-special',
    'dist_6': 'distribution-others'
  };

  const RIGHT_KEYS = ['distribution', 'dist_right', 'distribution-right', 'dist_right'];

  function pick(o, keys){
    for (const k of keys){
      const v = o && o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function norm(it){
    it = it || {};
    return {
      title: pick(it, ['title','name','label','caption']) || '',
      thumb: pick(it, ['thumb','image','image_url','thumbnail','cover']) || '',
      url:   pick(it, ['url','link','href','productUrl','checkoutUrl','path','detailUrl']) || '#'
    };
  }

  function resolveTargetsByKey(psomKey){
    // Return all nodes matching the key
    return Array.from(document.querySelectorAll('[data-psom-key="'+psomKey+'"]'));
  }

  function clearAndRender(container, items){
    if (!container) return false;
    if (!Array.isArray(items) || items.length === 0) return false; // IMPORTANT: do not wipe on empty
    container.innerHTML = ''; // remove dummies and previous content

    const frag = document.createDocumentFragment();
    for (const item of items){
      const a = document.createElement('a');
      a.className = 'thumb-card';
      a.href = item.url || '#';

      const imgWrap = document.createElement('div');
      imgWrap.className = 'thumb-img';
      if (item.thumb){
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = item.thumb;
        img.alt = item.title || '';
        imgWrap.appendChild(img);
      }

      const body = document.createElement('div');
      body.className = 'thumb-body';

      const title = document.createElement('div');
      title.className = 'thumb-title';
      title.textContent = item.title || '';

      body.appendChild(title);
      a.appendChild(imgWrap);
      a.appendChild(body);
      frag.appendChild(a);
    }
    container.appendChild(frag);
    return true;
  }

  function render(psomKey, items){
    const nodes = resolveTargetsByKey(psomKey);
    if (!nodes.length) return false;
    let used = false;
    nodes.forEach(el => { if (clearAndRender(el, items)) used = true; });
    return used;
  }

  function renderRight(items){
    // Try multiple possible right targets
    let used = false;
    for (const k of RIGHT_KEYS){
      if (render(k, items)) used = true;
    }
    return used;
  }

  async function loadSnapshot(){
    try{
      const r = await fetch(SNAPSHOT_URL, { cache:'no-store' });
      if (!r.ok) return false;
      const snap = await r.json();
      const sections = snap?.pages?.distribution?.sections;
      if (!sections) return false;

      let used = false;

      // main: render both direct keys and aliases
      for (const key of Object.keys(sections)){
        const list = (sections[key] || []).map(norm);
        // render by exact key
        if (render(key, list)) used = true;

        // render alias (dist_* -> distribution-*)
        const alias = KEY_ALIASES[key];
        if (alias && render(alias, list)) used = true;
      }

      // right: accept multiple snapshot right keys
      const rightList = (sections['dist_right'] || sections['distribution'] || sections['distribution-right'] || []).map(norm);
      if (renderRight(rightList)) used = true;

      return used;
    }catch(e){
      return false;
    }
  }

  async function loadFeed(){
    try{
      const r = await fetch(FEED_URL, { cache:'no-store' });
      if (!r.ok) return false;
      const payload = await r.json();
      if (!Array.isArray(payload.sections)) return false;

      const map = {};
      payload.sections.forEach(s => {
        if (s && s.id && Array.isArray(s.items)) map[s.id] = s.items;
      });

      let used = false;

      // main
      MAIN_KEYS.forEach(k => {
        const list = (map[k] || []).map(norm);
        if (render(k, list)) used = true;
        // render alias reverse if needed
        for (const [src, alias] of Object.entries(KEY_ALIASES)){
          if (k === src && render(alias, list)) used = true;
        }
      });

      // right
      const rightRaw = map['dist_right'] || map['distribution'] || map['distribution-right'] || [];
      if (renderRight((rightRaw || []).map(norm))) used = true;

      return used;
    }catch(e){
      return false;
    }
  }

  async function boot(){
    const snapOK = await loadSnapshot();
    if (!snapOK) await loadFeed();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();