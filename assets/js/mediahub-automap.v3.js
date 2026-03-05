/**
 * mediahub-automap.v3.js (PRODUCTION SAFE / SINGLE VERSION)
 * ------------------------------------------------------------
 * 목적:
 *  - MediaHub 메인 10섹션(data-psom-key="media-*")에 "미디어 콘텐츠"를 슬롯-우선(slot-first)으로 꽂는다.
 *  - 우선순위: /.netlify/functions/feed-media?key=... -> /data/media.snapshot*.json fallback
 *  - 데이터 없으면 HTML 더미(placeholder) 유지 (파괴/삭제 금지)
 *  - 모든 섹션 카드 수: 50 고정(부족하면 placeholder 추가)
 *  - 우측 패널 없음(처리하지 않음)
 *  - Hero는 snapshot.hero.rotateFrom 순서로 1개 썸네일을 골라 img src에 적용(가능한 경우)
 */
(function () {
  'use strict';

  if (window.__MEDIAHUB_AUTOMAP_V3_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V3_PROD__ = true;

  const D = document;

  const LIMIT = 50;

  const SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/data/media.snapshot.v6.keys.json',
    '/data/media.snapshot.v5.slots.json',
    '/data/media.snapshot.v4.ott.full.json'
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
 'media-trending': 'trending_now',
 'media-movie': 'latest_movie',
 'media-drama': 'latest_drama',
 'media-thriller': 'section_1',
 'media-romance': 'section_2',
 'media-variety': 'section_3',
 'media-documentary': 'section_4',
 'media-animation': 'section_5',
 'media-music': 'section_6',
 'media-shorts': 'section_7'
};

  function q(sel, root){ return (root||D).querySelector(sel); }
  function qa(sel, root){ return Array.prototype.slice.call((root||D).querySelectorAll(sel)); }

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
    for (const url of SNAPSHOT_URLS){
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
      title: slot.title || '',
      thumbnail: slot.thumb || '',
      url: slot.url || slot.video || '',
      video: slot.video || '',
      provider: slot.provider || ''
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
    // Some pages wrap cards in .scroll-content. If not, cards are directly inside .thumb-line.
    return q('.scroll-content', line) || line;
  }

  function ensurePlaceholders(line){
    const container = getContainer(line);

    // collect existing placeholders (preferred)
    let ph = qa('a[data-placeholder="true"]', container);

    // mark empty anchors as placeholders (non-destructive)
    if(ph.length === 0){
      const anchors = qa('a.card', container);
      anchors.forEach((a)=>{
        const hasImg = !!q('img', a);
        const hasText = (a.textContent || '').trim().length > 0;
        if(!hasImg && !hasText) a.setAttribute('data-placeholder','true');
      });
      ph = qa('a[data-placeholder="true"]', container);
    }

    // add up to LIMIT
    if(ph.length < LIMIT){
      const frag = D.createDocumentFragment();
      for(let i=ph.length;i<LIMIT;i++){
        frag.appendChild(makePlaceholder());
      }
      container.appendChild(frag);
      ph = qa('a[data-placeholder="true"]', container);
    }

    // if too many, keep first LIMIT as fill targets
    if(ph.length > LIMIT) ph = ph.slice(0, LIMIT);

    return ph;
  }

  function fillAnchor(a, item){
    const title = (item && (item.title || item.name || item.text || '')) || '';
    const thumb = (item && (item.thumbnail || item.thumb || item.image || item.imageUrl || item.thumbnailUrl || '')) || '';
    const url = (item && (item.url || item.video || item.link || item.href || '#')) || '#';

    a.href = url || '#';
    a.target = '_blank';
    a.rel = 'noopener';

    if(item && item.provider) a.dataset.provider = item.provider;

    let thumbBox = q('.thumb', a);
    if(!thumbBox){
      thumbBox = D.createElement('div');
      thumbBox.className = 'thumb';
      a.insertBefore(thumbBox, a.firstChild);
    }

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
    const n = Math.min(LIMIT, ph.length, items.length);
    for(let i=0;i<n;i++){
      fillAnchor(ph[i], items[i]);
    }
  }

  async function applyHero(heroRotateKeys, sectionMap){
    const heroImg = q('.hero img');
    if(!heroImg) return;

    const keys = Array.isArray(heroRotateKeys) ? heroRotateKeys.map(canonKey) : [];
    if(keys.length === 0) return;

    // try feed first (fast best-effort)
    for(const k of keys){
      const items = await loadFeedItems(k);
      const first = items && items[0];
      const thumb = first && (first.thumbnail || first.thumb || first.image || first.imageUrl || first.thumbnailUrl || '');
      if(thumb){
        heroImg.src = thumb;
        return;
      }
    }

    // fallback snapshot
    for(const k of keys){
      const items = extractItems(sectionMap[k]);
      const first = items && items[0];
      const thumb = first && (first.thumbnail || first.thumb || first.image || first.imageUrl || first.thumbnailUrl || '');
      if(thumb){
        heroImg.src = thumb;
        return;
      }
    }
  }

  async function main(){
    const lines = qa('.thumb-line[data-psom-key]');
    if(lines.length === 0) return;

    // stabilize layout first
    lines.forEach(ensurePlaceholders);

    const snapshot = await loadSnapshotAny();
    const sectionMap = normalizeSectionMap(snapshot);

    // hero
    const heroRotateFrom = snapshot && snapshot.hero && (snapshot.hero.rotateFrom || snapshot.hero.source);
    await applyHero(heroRotateFrom, sectionMap);

    // sections
    for(const line of lines){
      const key = canonKey(line.getAttribute('data-psom-key') || '');
      if(!key || key.indexOf('media-') !== 0) continue;

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
