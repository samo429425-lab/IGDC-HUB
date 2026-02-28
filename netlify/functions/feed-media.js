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

  /* ===== Mobile UX Fixes (drag + ratio + sizing) ===== */
  (function(){
    // 1) Inject CSS override to guarantee horizontal scroll + 16:9 thumbs + sane card widths on mobile
    if(!D.getElementById('igdc-media-automap-mobile-fix-style')){
      const st = D.createElement('style');
      st.id = 'igdc-media-automap-mobile-fix-style';
      st.textContent = `
        .thumb-line[data-psom-key^="media-"]{
          overflow-x:auto !important;
          overflow-y:hidden !important;
          -webkit-overflow-scrolling:touch;
          touch-action:pan-x;
        }
        .thumb-line[data-psom-key^="media-"] > a.card,
        .thumb-line[data-psom-key^="media-"] > a.media-card,
        .thumb-line[data-psom-key^="media-"] > a.card.media-card{
          flex:0 0 320px !important;
          max-width:320px !important;
        }
        @media (max-width:768px){
          .thumb-line[data-psom-key^="media-"] > a.card,
          .thumb-line[data-psom-key^="media-"] > a.media-card,
          .thumb-line[data-psom-key^="media-"] > a.card.media-card{
            flex:0 0 84vw !important;
            max-width:84vw !important;
          }
        }
        @media (max-width:768px) and (orientation:landscape){
          .thumb-line[data-psom-key^="media-"] > a.card,
          .thumb-line[data-psom-key^="media-"] > a.media-card,
          .thumb-line[data-psom-key^="media-"] > a.card.media-card{
            flex:0 0 320px !important;
            max-width:320px !important;
          }
        }
        /* Netflix/YouTube-like 16:9 thumbnail box */
        .thumb-line[data-psom-key^="media-"] a .thumb{
          position:relative !important;
          width:100% !important;
          height:auto !important;
          padding-top:56.25% !important;
          overflow:hidden !important;
        }
        .thumb-line[data-psom-key^="media-"] a .thumb img{
          position:absolute !important;
          inset:0 !important;
          width:100% !important;
          height:100% !important;
          object-fit:cover !important;
          display:block !important;
        }
      `;
      D.head.appendChild(st);
    }

    // 2) Prevent the page-level "section pager" swipe handler (if any) from stealing row swipes
    const stop = (e)=>{ try{ e.stopPropagation(); }catch(_){ } };
    function bindStop(el){
      if(!el || el.__igdcStopPagerBound) return;
      el.__igdcStopPagerBound = true;
      el.addEventListener('touchstart', stop, {passive:true});
      el.addEventListener('touchmove', stop, {passive:true});
      el.addEventListener('pointerdown', stop, {passive:true});
      el.addEventListener('mousedown', stop);
    }
    function scan(){
      qa('.thumb-line[data-psom-key^="media-"]', D).forEach(bindStop);
      qa('.thumb-line[data-psom-key="media-hero"]', D).forEach(bindStop);
    }
    if(D.readyState === 'loading'){
      D.addEventListener('DOMContentLoaded', ()=>{ scan(); setTimeout(scan, 300); setTimeout(scan, 900); });
    }else{
      scan(); setTimeout(scan, 300); setTimeout(scan, 900);
    }
  })();

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
    const key = (line && line.getAttribute) ? (line.getAttribute('data-psom-key') || '') : '';
    const need = (key && key.startsWith('media-') && key !== 'media-hero') ? 50 : 0;

    // choose card container: if wrapper exists, placeholders are inside .scroll-content
    const container = q(':scope > .scroll-content', line) || line;

    // placeholder anchors first
    let ph = qa('a[data-placeholder="true"]', container);
    // if no placeholders, mark empty anchors as placeholders
    if(ph.length === 0){
      const anchors = qa('a', container);
      anchors.forEach((a)=>{
        const hasImg = !!q('img', a);
        const hasText = (a.textContent || '').trim().length > 0;
        if(!hasImg && !hasText){
          a.setAttribute('data-placeholder','true');
        }
      });
      ph = qa('a[data-placeholder="true"]', container);
    }

    // if still short, create placeholders up to need
    if(need && ph.length < need){
      const add = need - ph.length;
      for(let i=0;i<add;i++){
        const a = D.createElement('a');
        a.className = 'card media-card';
        a.setAttribute('data-placeholder','true');
        a.href = 'javascript:void(0)';
        const t = D.createElement('div'); t.className='thumb ph';
        const m = D.createElement('div'); m.className='meta'; m.textContent='Coming Soon';
        a.appendChild(t); a.appendChild(m);
        // append into container
        container.appendChild(a);
      }
      ph = qa('a[data-placeholder="true"]', container);
    }

    return ph;
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
