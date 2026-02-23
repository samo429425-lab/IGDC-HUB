/**
 * mediahub-automap.v5.js (SAFE)
 * ------------------------------------------------------------
 * Fix 목표:
 *  - mediahub.html의 data-psom-key(=media-*) 기준으로만 동작
 *  - 우선순위: feed-media?key=...  -> snapshot(/data/media.snapshot*.json)
 *  - snapshot 키가 구버전(trending_now 등)이어도 자동 매핑
 *  - 데이터 없으면 HTML 더미 유지(파괴 금지)
 */
(function(){
  'use strict';
  if (window.__MEDIAHUB_AUTOMAP_V5__) return;
  window.__MEDIAHUB_AUTOMAP_V5__ = true;

  const D = document;
  const W = window;

  function q(sel, root){ return (root||D).querySelector(sel); }
  function qa(sel, root){ return Array.prototype.slice.call((root||D).querySelectorAll(sel)); }

  // HARD guard: only run where media slots exist
  if (!q('.thumb-line[data-psom-key]')) return;

  const SNAPSHOT_URLS = [
    '/data/media.snapshot.v6.keys.json',
    '/data/media.snapshot.json',
    '/data/media.snapshot.v5.slots.json',
    '/data/media.snapshot.v4.ott.full.json',
  ];

  const KEY_ALIAS = {
    'trending_now': 'media-trending',
    'latest_movie': 'media-movie',
    'latest_drama': 'media-drama',
    'section_1': 'media-thriller',
    'section_2': 'media-romance',
    'section_3': 'media-variety',
    'section_4': 'media-documentary',
    'section_5': 'media-animation',
    'section_6': 'media-music',
    'section_7': 'media-shorts',
  };

  async function fetchJson(url){
    const r = await fetch(url, { cache:'no-store' });
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  }

  async function loadSnapshotAny(){
    for(const url of SNAPSHOT_URLS){
      try { return await fetchJson(url); } catch(e){ /* continue */ }
    }
    return null;
  }

  function normalizeSectionMap(snapshot){
    const map = {};
    if(!snapshot) return map;

    // object sections
    if(snapshot.sections && !Array.isArray(snapshot.sections) && typeof snapshot.sections === 'object'){
      for(const k of Object.keys(snapshot.sections)){
        const sec = snapshot.sections[k] || {};
        const nk = (k.startsWith('media-') ? k : (KEY_ALIAS[k] || k));
        map[nk] = sec;
      }
      return map;
    }

    // array sections
    if(Array.isArray(snapshot.sections)){
      snapshot.sections.forEach((s)=>{
        if(!s) return;
        const k = s.key || '';
        const nk = (k.startsWith('media-') ? k : (KEY_ALIAS[k] || k));
        map[nk] = s;
      });
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

  async function loadFeedItems(key){
    const url = `/.netlify/functions/feed-media?key=${encodeURIComponent(key)}&limit=500`;
    try{
      const data = await fetchJson(url);
      if(data && Array.isArray(data.items)) return data.items;
      // fallback: full snapshot response
      if(data && Array.isArray(data.sections)){
        const found = data.sections.find(s=>s && s.key === key);
        if(found && Array.isArray(found.items)) return found.items;
      }
    }catch(e){ /* ignore */ }
    return [];
  }

  function ensureAnchors(line){
    // placeholder anchors first
    let ph = qa('a[data-placeholder="true"]', line);
    if(ph.length) return ph;

    // if no placeholders, mark only anchors that look empty as placeholders
    const anchors = qa('a', line);
    anchors.forEach((a)=>{
      const hasImg = !!q('img', a);
      const hasText = (a.textContent || '').trim().length > 0;
      if(!hasImg && !hasText){
        a.setAttribute('data-placeholder','true');
      }
    });
    ph = qa('a[data-placeholder="true"]', line);
    // as last resort: create placeholders equal to needed slot count if none exist
    if(ph.length === 0){
      // do nothing (non-destructive)
    }
    return ph;
  }

  function fillAnchor(a, item){
    const title = item.title || item.name || '';
    const thumb = item.thumbnail || item.thumb || item.image || '';
    const url = item.url || item.video || item.link || '#';

    a.href = url || '#';
    a.target = '_blank';
    a.rel = 'noopener';

    if(item.provider) a.dataset.provider = item.provider;
    if(item.metrics)  a.dataset.metrics = JSON.stringify(item.metrics);
    if(item.payment)  a.dataset.payment = JSON.stringify(item.payment);

    // Prefer existing placeholder/card structure: .thumb (image box) + .meta (title)
    let thumbBox = q('.thumb', a);
    let metaBox = q('.meta', a) || q('.thumb-title', a);

    // Image handling
    if(thumbBox){
      // Use <img> inside thumbBox when possible
      let img = q('img', thumbBox);
      if(!img){
        img = D.createElement('img');
        thumbBox.appendChild(img);
      }
      img.alt = title || '';
      img.loading = 'lazy';
      if(thumb) img.src = thumb;
    }else{
      // Fallback: ensure an <img> exists directly under anchor
      let img = q('img', a);
      if(!img){
        img = D.createElement('img');
        a.appendChild(img);
      }
      img.alt = title || '';
      img.loading = 'lazy';
      if(thumb) img.src = thumb;
    }

    // Title handling
    if(!metaBox){
      metaBox = D.createElement('div');
      metaBox.className = 'meta';
      a.appendChild(metaBox);
    }
    metaBox.textContent = title;

    a.removeAttribute('data-placeholder');
  }

  function applyLine(line, items){
    if(!Array.isArray(items) || items.length === 0) return;
    const ph = ensureAnchors(line);
    if(ph.length === 0) return;
    const n = Math.min(ph.length, items.length);
    for(let i=0;i<n;i++) fillAnchor(ph[i], items[i]);
  }

  function applyHero(snapshot, sectionMap){
    const heroRoot = q('#hero[data-psom-key="media-hero"]');
    if(!heroRoot) return;

    // candidates from snapshot.hero.items or rotateFrom sections
    let heroItems = [];
    if(snapshot && snapshot.hero && Array.isArray(snapshot.hero.items)) heroItems = snapshot.hero.items.slice();
    if(heroItems.length === 0){
      const rotateFrom = (snapshot && snapshot.hero && snapshot.hero.rotateFrom) || ['media-trending','media-movie','media-drama'];
      rotateFrom.forEach((k)=>{ heroItems = heroItems.concat(extractItems(sectionMap[k])); });
    }
    heroItems = heroItems.filter(Boolean).slice(0, 10);
    if(heroItems.length === 0) return;

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
      if(thumb) img.src = thumb;
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
    const snapshot = await loadSnapshotAny();
    const sectionMap = normalizeSectionMap(snapshot);

    // hero first
    try { applyHero(snapshot, sectionMap); } catch(e){}

    const lines = qa('.thumb-line[data-psom-key]');
    for(const line of lines){
      const key = line.getAttribute('data-psom-key');
      if(!key || key === 'media-hero') continue;

      // feed first
      let items = await loadFeedItems(key);
      if(!items || items.length === 0){
        items = extractItems(sectionMap[key]);
      }
      applyLine(line, items);
    }
  }

  // DOM ready
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', main);
  else main();
})();
