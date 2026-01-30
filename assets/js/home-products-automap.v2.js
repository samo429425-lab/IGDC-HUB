
/**
 * home-right-panel.controller.js  (FIXED – RIGHT PANEL ONLY)
 * ------------------------------------------------------------
 * FIX:
 *  - HARD scope to `.right-panel` container
 *  - Never queries or mutates anything outside right panel
 *  - Main sections (home_1 ~ home_5) are completely untouched
 */

(function () {
  'use strict';

  if (window.__HOME_RIGHT_PANEL_CONTROLLER_FIXED__) return;
  window.__HOME_RIGHT_PANEL_CONTROLLER_FIXED__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';
  const RIGHT_KEYS = ['home_right_top','home_right_middle','home_right_bottom'];
  const LIMIT = 50;

  function qs(sel, root){ return (root||document).querySelector(sel); }

  function safeFetch(url, timeout=2000){
    return new Promise((resolve)=>{
      const ac=new AbortController();
      const t=setTimeout(()=>{ try{ac.abort()}catch(_){ } resolve(null); }, timeout);
      fetch(url,{cache:'no-store',signal:ac.signal})
        .then(r=>r&&r.ok?r.json():null)
        .then(j=>{ clearTimeout(t); resolve(j); })
        .catch(()=>{ clearTimeout(t); resolve(null); });
    });
  }

  function normalize(it){
    if(!it) return null;
    return {
      title: it.title||'',
      thumb: it.thumb||'',
      url: it.url||'#',
      priority: typeof it.priority==='number'?it.priority:999999
    };
  }

  function buildCard(item){
    const a=document.createElement('a');
    a.className='ad-box news-btn';
    a.href=item.url; a.target='_blank';
    const img=document.createElement('img');
    img.loading='lazy'; img.decoding='async';
    img.alt=item.title; img.src=item.thumb;
    a.appendChild(img);
    return a;
  }

  async function run(){
    const panel = qs('.right-panel');
    if(!panel) return; // no right panel, do nothing

    const data = await safeFetch(FEED_URL);
    if(!data || !Array.isArray(data.sections)) return;

    RIGHT_KEYS.forEach(key=>{
      const section = panel.querySelector('[data-psom-key="'+key+'"]');
      if(!section) return;

      const list = section.classList.contains('ad-list')
        ? section
        : section.querySelector('.ad-list');
      if(!list) return;

      const sec = data.sections.find(s=>s.id===key);
      if(!sec || !Array.isArray(sec.items)) return;

      const items = sec.items.map(normalize).filter(Boolean)
        .sort((a,b)=>a.priority-b.priority)
        .slice(0,LIMIT);

      if(!items.length) return;

      list.innerHTML='';
      items.forEach(it=> list.appendChild(buildCard(it)));
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', run, {once:true});
  }else{
    run();
  }
})();
