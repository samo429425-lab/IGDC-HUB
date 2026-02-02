/**
 * /assets/js/distribution-products-automap.v2.1to1.js
 * DISTRIBUTION AUTOMAP – STRICT 1:1 SECTION MAPPING
 *
 * Rules (HARD):
 * 1) Reads ONLY: front.snapshot.json -> pages.distribution.sections
 * 2) Each section key renders ONLY its own items (no merge, no reuse)
 * 3) No access to pages.home, no Object.values, no flat, no cache reuse
 * 4) If items exist -> clear dummy and replace
 * 5) If items empty/undefined -> do NOTHING (keep dummy)
 * 6) Right panel rendered separately
 */

(function () {
  'use strict';
  if (window.__DIST_AUTOMAP_V21__) return;
  window.__DIST_AUTOMAP_V21__ = true;

  const SNAPSHOT_URL = '/data/front.snapshot.json';

  // === HTML section keys (must match data-psom-key exactly) ===
  const MAIN_SECTION_KEYS = [
    'distribution-recommend',
    'distribution-sponsor',
    'distribution-trending',
    'distribution-new',
    'distribution-special',
    'distribution-others'
  ];

  const RIGHT_HTML_KEY = 'distribution';
  const RIGHT_SNAPSHOT_KEYS = ['dist_right', 'distribution', 'distribution-right'];

  // ---------- utils ----------
  function pick(o, keys){
    for (const k of keys){
      const v = o && o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function normalize(item){
    item = item || {};
    return {
      title: pick(item, ['title','name','label','caption']),
      thumb: pick(item, ['thumb','image','image_url','thumbnail','cover']),
      url:   pick(item, ['url','link','href','productUrl','detailUrl','path']) || '#'
    };
  }

  function buildCard(it){
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = it.url;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'thumb-img';
    if (it.thumb){
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = it.thumb;
      img.alt = it.title || '';
      imgWrap.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'thumb-body';
    const t = document.createElement('div');
    t.className = 'thumb-title';
    t.textContent = it.title || '';
    body.appendChild(t);

    a.appendChild(imgWrap);
    a.appendChild(body);
    return a;
  }

  function renderSection(htmlKey, items){
    if (!Array.isArray(items) || items.length === 0) return false;

    const nodes = document.querySelectorAll('[data-psom-key="'+htmlKey+'"]');
    if (!nodes.length) return false;

    nodes.forEach(el => {
      // clear dummy & previous
      el.innerHTML = '';
      const frag = document.createDocumentFragment();
      items.forEach(it => frag.appendChild(buildCard(it)));
      el.appendChild(frag);
    });
    return true;
  }

  function getRightItems(sections){
    for (const k of RIGHT_SNAPSHOT_KEYS){
      const arr = sections[k];
      if (Array.isArray(arr) && arr.length) return arr;
    }
    return [];
  }

  async function boot(){
    let snap;
    try{
      const r = await fetch(SNAPSHOT_URL, { cache:'no-store' });
      if (!r.ok) return;
      snap = await r.json();
    }catch(e){ return; }

    // === STRICT: distribution only ===
    const sections = snap?.pages?.distribution?.sections;
    if (!sections) return;

    // MAIN: strict 1:1
    MAIN_SECTION_KEYS.forEach(key => {
      const raw = sections[key];
      if (!Array.isArray(raw) || raw.length === 0) return;
      const items = raw.map(normalize); // NEW array per section
      renderSection(key, items);
    });

    // RIGHT: separate
    const rightRaw = getRightItems(sections);
    if (rightRaw.length){
      const items = rightRaw.map(normalize);
      renderSection(RIGHT_HTML_KEY, items);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();