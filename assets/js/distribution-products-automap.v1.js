/**
 * /assets/js/distribution-products-automap.v1.js
 * DISTRIBUTION AUTOMAP – STABLE (snapshot-first)
 *
 * Guarantees:
 * - Reads ONLY: front.snapshot.json -> pages.distribution.sections
 * - Renders ONLY to containers that match data-psom-key in distributionhub.html
 * - If a section has items: clears existing dummy DOM and replaces with cards
 * - If a section has NO items: leaves dummy DOM untouched
 * - Right panel: snapshot keys (distribution | dist_right | distribution-right) -> HTML key "distribution"
 */

(function () {
  'use strict';
  if (window.__DIST_AUTOMAP_V1_STABLE__) return;
  window.__DIST_AUTOMAP_V1_STABLE__ = true;

  const SNAPSHOT_URL = '/data/front.snapshot.json';

  const MAIN_KEYS = [
    'distribution-recommend',
    'distribution-sponsor',
    'distribution-trending',
    'distribution-new',
    'distribution-special',
    'distribution-others'
  ];

  const RIGHT_HTML_KEY = 'distribution';
  const RIGHT_SNAPSHOT_KEYS = ['distribution', 'dist_right', 'distribution-right'];

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
      url:   pick(it, ['url','link','href','productUrl','detailUrl','path']) || '#'
    };
  }

  function buildCard(item){
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
    return a;
  }

  function render(psomKey, items){
    if (!Array.isArray(items) || items.length === 0) return false;

    const nodes = document.querySelectorAll('[data-psom-key="'+psomKey+'"]');
    if (!nodes.length) return false;

    nodes.forEach(el => {
      // IMPORTANT: replace (remove dummies)
      el.innerHTML = '';
      const frag = document.createDocumentFragment();
      items.forEach(it => frag.appendChild(buildCard(it)));
      el.appendChild(frag);
    });

    return true;
  }

  function getRightItems(sections){
    for (const k of RIGHT_SNAPSHOT_KEYS){
      const v = sections && sections[k];
      if (Array.isArray(v) && v.length) return v;
    }
    return [];
  }

  async function boot(){
    let snap;
    try{
      const r = await fetch(SNAPSHOT_URL, { cache:'no-store' });
      if (!r.ok) return;
      snap = await r.json();
    }catch(e){
      return;
    }

    // ✅ FIX: distribution ONLY (never home)
    const sections = snap && snap.pages && snap.pages.distribution && snap.pages.distribution.sections;
    if (!sections) return;

    // main sections (HTML uses distribution-*)
    MAIN_KEYS.forEach(k => {
      const items = (sections[k] || []).map(norm);
      render(k, items);
    });

    // right panel
    const rightItems = getRightItems(sections).map(norm);
    render(RIGHT_HTML_KEY, rightItems);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();