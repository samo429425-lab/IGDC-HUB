/**
 * mediahub-automap.v4.js (SAFE)
 * ------------------------------------------------------------
 * Fixes vs v3:
 *  - Aligns with mediahub.html keys (media-trending ... media-shorts + media-hero)
 *  - Supports snapshot sections as OBJECT (v5 slots) OR ARRAY (legacy)
 *  - feed-media handler now supports ?key=<psomKey> returning {key,items}
 *  - Keeps DOM if no data; replaces only placeholder anchors data-placeholder="true"
 */
(function () {
  'use strict';
  if (window.__MEDIAHUB_AUTOMAP_V4_SAFE__) return;
  window.__MEDIAHUB_AUTOMAP_V4_SAFE__ = true;

  const W = window;
  const D = document;

  function q(sel, root) { return (root || D).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }

  // HARD scope guard
  function hasMediaSlots(){
    try { return !!D.querySelector('.thumb-line[data-psom-key]'); } catch(e){ return false; }
  }
  if (!hasMediaSlots()) return;

  const SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/data/media.snapshot.v5.slots.json',
    '/data/media.snapshot.v4.ott.full.json',
  ];

  async function fetchJson(url){
    const r = await fetch(url, { cache: 'no-store' });
    if(!r.ok) throw new Error('HTTP '+r.status+' for '+url);
    return await r.json();
  }

  async function loadSnapshot(){
    for (let i=0;i<SNAPSHOT_URLS.length;i++){
      const url = SNAPSHOT_URLS[i];
      try { return await fetchJson(url); } catch(e){ /* continue */ }
    }
    return null;
  }

  function normalizeSectionMap(snapshot){
    const map = {};
    if(!snapshot) return map;

    // object sections (v5 slots)
    if(snapshot.sections && !Array.isArray(snapshot.sections) && typeof snapshot.sections === 'object'){
      Object.keys(snapshot.sections).forEach((k)=>{ map[k] = snapshot.sections[k] || {}; });
      return map;
    }

    // array sections (legacy)
    if(Array.isArray(snapshot.sections)){
      snapshot.sections.forEach((s)=>{ if(s && s.key) map[s.key] = s; });
    }
    return map;
  }

  function slotsToItems(section){
    const slots = section && Array.isArray(section.slots) ? section.slots : [];
    return slots.map((slot)=>({
      id: slot.contentId || null,
      title: slot.title || '',
      thumbnail: slot.thumb || '',
      video: slot.video || '',
      url: slot.url || slot.video || '',
      provider: slot.provider || '',
      metrics: slot.metrics || null,
      payment: slot.payment || null,
      outbound: slot.outbound || null,
    }));
  }

  function extractItems(section){
    if(!section) return [];
    if(Array.isArray(section.items)) return section.items;
    if(Array.isArray(section.slots)) return slotsToItems(section);
    return [];
  }

  async function loadFeedSection(key){
    // primary: feed-media supports key -> {key,items}
    const primary = `/.netlify/functions/feed-media?key=${encodeURIComponent(key)}&limit=500`;
    const legacy  = `/.netlify/functions/media-feed?key=${encodeURIComponent(key)}&limit=500`;

    async function tryUrl(url){
      const r = await fetch(url, { cache: 'no-store' });
      if(!r.ok) return null;
      const data = await r.json();
      if(data && Array.isArray(data.items)) return data.items;
      if(data && Array.isArray(data.sections)){
        const found = data.sections.find(s=>s && s.key === key);
        if(found && Array.isArray(found.items)) return found.items;
      }
      return null;
    }

    return (await tryUrl(primary)) || (await tryUrl(legacy)) || [];
  }

  function ensureAnchorTemplate(line){
    // find placeholder anchors
    const ph = qa('a[data-placeholder="true"]', line);
    if(ph.length) return ph;

    // if no placeholder, mark existing anchors as placeholders (only if they look like dummy)
    const anchors = qa('a', line);
    anchors.forEach((a)=>{
      if(!a.hasAttribute('data-placeholder')){
        a.setAttribute('data-placeholder','true');
      }
    });
    return qa('a[data-placeholder="true"]', line);
  }

  function fillAnchor(a, item){
    // Minimal compatible fields across sources
    const title = item.title || item.name || '';
    const thumb = item.thumbnail || item.thumb || item.image || '';
    const url = item.url || item.video || item.link || '#';

    a.href = url || '#';
    a.target = '_blank';
    a.rel = 'noopener';

    if(item.provider) a.dataset.provider = item.provider;
    if(item.metrics)  a.dataset.metrics = JSON.stringify(item.metrics);
    if(item.payment)  a.dataset.payment = JSON.stringify(item.payment);

    // image element
    let img = q('img', a);
    if(!img){
      img = D.createElement('img');
      a.appendChild(img);
    }
    img.alt = title || '';
    img.loading = 'lazy';
    img.src = thumb || img.src || '';

    // title element
    let t = q('.thumb-title', a);
    if(!t){
      t = D.createElement('div');
      t.className = 'thumb-title';
      a.appendChild(t);
    }
    t.textContent = title;

    // mark filled
    a.removeAttribute('data-placeholder');
  }

  function applyToThumbLine(line, items){
    if(!Array.isArray(items) || items.length === 0) return;

    const placeholders = ensureAnchorTemplate(line);
    if(placeholders.length === 0) return;

    const n = Math.min(placeholders.length, items.length);
    for(let i=0;i<n;i++){
      fillAnchor(placeholders[i], items[i]);
    }
  }

  function applyHero(snapshot, sectionMap){
    const heroRoot = q('#hero[data-psom-key="media-hero"]');
    if(!heroRoot) return;

    // candidates
    let heroItems = [];
    if(snapshot && snapshot.hero && Array.isArray(snapshot.hero.items)) heroItems = snapshot.hero.items.slice();
    if(heroItems.length === 0){
      const rotateFrom = (snapshot && snapshot.hero && snapshot.hero.rotateFrom) || ['media-trending','media-movie','media-drama'];
      rotateFrom.forEach((k)=>{ heroItems = heroItems.concat(extractItems(sectionMap[k])); });
    }
    heroItems = heroItems.filter(Boolean).slice(0, 10);
    if(heroItems.length === 0) return;

    // build DOM once
    heroRoot.innerHTML = '';
    const a = D.createElement('a');
    a.className = 'hero-card';
    a.style.display = 'block';
    a.style.position = 'relative';
    a.style.width = '100%';
    a.style.height = '100%';
    a.target = '_blank';
    a.rel = 'noopener';
    heroRoot.appendChild(a);

    const img = D.createElement('img');
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    a.appendChild(img);

    const overlay = D.createElement('div');
    overlay.className = 'hero-overlay';
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.padding = '12px';
    overlay.style.background = 'linear-gradient(transparent, rgba(0,0,0,.7))';
    overlay.style.color = '#fff';
    overlay.style.fontWeight = '700';
    overlay.style.fontSize = '18px';
    overlay.style.pointerEvents = 'none';
    a.appendChild(overlay);

    let idx = 0;
    function setHero(i){
      const it = heroItems[i] || {};
      const title = it.title || it.name || '';
      const thumb = it.thumbnail || it.thumb || it.image || '';
      const url = it.url || it.video || it.link || '#';
      a.href = url || '#';
      img.src = thumb || img.src || '';
      overlay.textContent = title;

      if(it.provider) a.dataset.provider = it.provider;
      if(it.metrics)  a.dataset.metrics = JSON.stringify(it.metrics);
      if(it.payment)  a.dataset.payment = JSON.stringify(it.payment);
    }
    setHero(idx);

    const intervalMs = ((snapshot && snapshot.hero && snapshot.hero.intervalSec) ? snapshot.hero.intervalSec : 12) * 1000;
    if(W.__mediaHeroTimer) clearInterval(W.__mediaHeroTimer);
    W.__mediaHeroTimer = setInterval(()=>{ idx = (idx+1) % heroItems.length; setHero(idx); }, intervalMs);
  }

  async function main(){
    const snapshot = await loadSnapshot();
    const sectionMap = normalizeSectionMap(snapshot);

    // Apply hero from snapshot (or derived)
    try { applyHero(snapshot, sectionMap); } catch(e){ /* ignore */ }

    const lines = qa('.thumb-line[data-psom-key]');
    for(const line of lines){
      const key = line.getAttribute('data-psom-key');
      if(!key) continue;
      if(key === 'media-hero') continue; // already applied

      // prefer local snapshot items/slots (placeholders), then feed
      let items = extractItems(sectionMap[key]);
      if(!items || items.length === 0){
        try { items = await loadFeedSection(key); } catch(e){ items = []; }
      }

      applyToThumbLine(line, items);
    }
  }

  if (D.readyState === 'loading') {
    D.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
