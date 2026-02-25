/**
 * mediahub-automap.v3.mobilefix.js (CLEAN / NON-DESTRUCTIVE)
 * ------------------------------------------------------------
 * 규칙:
 *  - data-psom-key="media-*" (media-hero 제외) 라인만 처리
 *  - 우선순위: feed-media?key=...  -> snapshot(/data/media.snapshot*.json)
 *  - 데이터 없으면 HTML 더미(placeholder) 유지 (파괴/삭제 금지)
 *  - 각 섹션 카드 수: 50 고정(HTML/오토맵 동기화)
 */
(function(){
  'use strict';
  if (window.__MEDIAHUB_AUTOMAP_V3_CLEAN__) return;
  window.__MEDIAHUB_AUTOMAP_V3_CLEAN__ = true;

  const D = document;

  const LIMIT = 50;

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

  function q(sel, root){ return (root||D).querySelector(sel); }
  function qa(sel, root){ return Array.prototype.slice.call((root||D).querySelectorAll(sel)); }

  function isMediaKey(k){
    return (typeof k === 'string') && k.indexOf('media-') === 0 && k !== 'media-hero';
  }
  function canonKey(k){
    if(!k) return '';
    if(k.indexOf('media-') === 0) return k;
    return KEY_ALIAS[k] || k;
  }

  async function fetchJson(url){
    const r = await fetch(url, { cache: 'no-store' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
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
      Object.keys(snapshot.sections).forEach((k)=>{
        map[canonKey(k)] = snapshot.sections[k] || {};
      });
      return map;
    }

    // array sections
    if(Array.isArray(snapshot.sections)){
      snapshot.sections.forEach((s)=>{
        if(!s) return;
        map[canonKey(s.key || '')] = s;
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
      url: slot.url || slot.video || '',
      video: slot.video || '',
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
      if(data && Array.isArray(data.sections)){
        const found = data.sections.find(s => s && canonKey(s.key) === key);
        if(found && Array.isArray(found.items)) return found.items;
      }
    }catch(e){ /* ignore */ }
    return [];
  }

  function makePlaceholder(){
    const a = D.createElement('a');
    a.className = 'card media-card';
    a.setAttribute('data-placeholder','true');
    a.href = 'javascript:void(0)';
    const thumb = D.createElement('div');
    thumb.className = 'thumb ph';
    const meta = D.createElement('div');
    meta.className = 'meta';
    meta.textContent = 'Coming Soon';
    a.appendChild(thumb);
    a.appendChild(meta);
    return a;
  }

  function getContainer(line){
    // MediaHub HTML commonly has: .thumb-line > .scroll-wrapper > .scroll-content
    return q('.scroll-content', line) || line;
  }

  function ensurePlaceholders(line){
    const key = canonKey(line.getAttribute('data-psom-key') || '');
    if(!isMediaKey(key)) return [];

    const container = getContainer(line);

    // Collect placeholders
    let ph = qa('a[data-placeholder="true"]', container);

    // If HTML has anchors but not marked, mark empty ones
    if(ph.length === 0){
      const anchors = qa('a.card', container);
      anchors.forEach((a)=>{
        const hasImg = !!q('img', a);
        const hasText = (a.textContent || '').trim().length > 0;
        if(!hasImg && !hasText){
          a.setAttribute('data-placeholder','true');
        }
      });
      ph = qa('a[data-placeholder="true"]', container);
    }

    // Create placeholders up to LIMIT
    if(ph.length < LIMIT){
      const frag = D.createDocumentFragment();
      for(let i=ph.length; i<LIMIT; i++){
        frag.appendChild(makePlaceholder());
      }
      container.appendChild(frag);
      ph = qa('a[data-placeholder="true"]', container);
    }

    // Hard cap: if more than LIMIT placeholders, keep only first LIMIT for filling
    if(ph.length > LIMIT) ph = ph.slice(0, LIMIT);
    return ph;
  }

  function fillAnchor(a, item){
    const title = item?.title || item?.name || '';
    const thumb = item?.thumbnail || item?.thumb || item?.image || '';
    const url = item?.url || item?.video || item?.link || '#';

    a.href = url || '#';
    a.target = '_blank';
    a.rel = 'noopener';

    if(item?.provider) a.dataset.provider = item.provider;
    if(item?.metrics)  a.dataset.metrics = JSON.stringify(item.metrics);
    if(item?.payment)  a.dataset.payment = JSON.stringify(item.payment);

    let thumbBox = q('.thumb', a);
    if(!thumbBox){
      thumbBox = D.createElement('div');
      thumbBox.className = 'thumb';
      a.insertBefore(thumbBox, a.firstChild);
    }

    // Ensure image exists (keeps Netflix/YT ratio controlled by CSS on .card/.thumb)
    let img = q('img', thumbBox);
    if(!img){
      img = D.createElement('img');
      thumbBox.appendChild(img);
    }
    img.alt = title || '';
    img.loading = 'lazy';
    if(thumb) img.src = thumb;

    let metaBox = q('.meta', a);
    if(!metaBox){
      metaBox = D.createElement('div');
      metaBox.className = 'meta';
      a.appendChild(metaBox);
    }
    metaBox.textContent = title;

    a.removeAttribute('data-placeholder');
  }

  function applyLine(line, items){
    if(!Array.isArray(items) || items.length === 0) return; // keep dummy
    const ph = ensurePlaceholders(line);
    if(ph.length === 0) return;
    const n = Math.min(LIMIT, ph.length, items.length);
    for(let i=0;i<n;i++){
      fillAnchor(ph[i], items[i]);
    }
  }

  async function main(){
    const lines = qa('.thumb-line[data-psom-key]');
    if(lines.length === 0) return;

    // Ensure placeholders first (so layout is stable even before data arrives)
    lines.forEach(ensurePlaceholders);

    const snapshot = await loadSnapshotAny();
    const sectionMap = normalizeSectionMap(snapshot);

    for(const line of lines){
      const key = canonKey(line.getAttribute('data-psom-key') || '');
      if(!isMediaKey(key)) continue;

      let items = await loadFeedItems(key);
      if(!items || items.length === 0){
        items = extractItems(sectionMap[key]);
      }
      applyLine(line, items);
    }
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', main);
  else main();
})();
