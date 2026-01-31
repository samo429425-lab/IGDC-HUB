
/**
 * distribution-products-automap.v5.js
 * FINAL – HOME ENGINE CLONE (SAFE OVERWRITE)
 *
 * RULES:
 * 1) Snapshot / feed 연결 성공 시에만 기존 더미 DOM 제거
 * 2) 연결 실패 시 HTML 더미 그대로 유지
 * 3) distributionhub.html 구조 그대로 사용 (HTML 수정 없음)
 *
 * SOURCE PRIORITY:
 *  - front.snapshot.json  (1차)
 *  - feed?page=distribution (2차 덮어쓰기)
 */

(function () {
  'use strict';
  if (window.__DISTRIBUTION_AUTOMAP_V5__) return;
  window.__DISTRIBUTION_AUTOMAP_V5__ = true;

  const SNAPSHOT_URL = '/data/front.snapshot.json';
  const FEED_URL = '/.netlify/functions/feed?page=distribution';

  // PSOM keys
  const MAIN_KEYS = [
    'distribution-recommend',
    'distribution-sponsor',
    'distribution-trending',
    'distribution-new',
    'distribution-special',
    'distribution-others'
  ];
  const RIGHT_KEY = 'distribution';

  function qs(sel, root){ return (root||document).querySelector(sel); }

  function pick(o, keys){
    for (const k of keys){
      if (o && typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
    }
    return '';
  }

  function norm(it){
    return {
      title: pick(it, ['title','name','label','caption']) || '',
      thumb: pick(it, ['thumb','image','image_url','thumbnail','cover']),
      url:   pick(it, ['url','link','href','productUrl']) || '#'
    };
  }

  function resolveContainer(psomEl){
    // distributionhub.html: data-psom-key is on .thumb-scroller
    return psomEl;
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
  const nodes = document.querySelectorAll('[data-psom-key="'+psomKey+'"]');
  if (!nodes.length || !items) return false;

  nodes.forEach(el => {
    const container = el; // distributionhub: thumb-scroller 자체
    if (!container) return;

    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.forEach(it => frag.appendChild(buildCard(it)));
    container.appendChild(frag);
  });

  return true;
}


  async function loadSnapshot(){
    try{
      const r = await fetch(SNAPSHOT_URL, { cache:'no-store' });
      if (!r.ok) return false;
      const snap = await r.json();
      const sections = snap?.pages?.distribution?.sections;
      if (!sections) return false;

      let used = false;
      MAIN_KEYS.forEach(k => {
        const list = (sections[k]||[]).map(norm);
        if (render(k, list)) used = true;
      });

      // right panel (compat: distribution / distribution-right)
      const rightList =
        (sections[RIGHT_KEY] ||
         sections['distribution-right'] ||
         []).map(norm);

      if (render(RIGHT_KEY, rightList)) used = true;

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
      MAIN_KEYS.forEach(k => {
        const list = (map[k]||[]).map(norm);
        if (render(k, list)) used = true;
      });

      const rightList =
        map[RIGHT_KEY] || map['dist_right'] || map['distribution-right'];
      if (rightList && render(RIGHT_KEY, rightList.map(norm))) used = true;

      return used;
    }catch(e){
      return false;
    }
  }

  async function boot(){
    const snapOK = await loadSnapshot();
    if (snapOK) await loadFeed();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
