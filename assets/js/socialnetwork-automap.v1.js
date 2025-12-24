
(function(){
  'use strict';

  // ===== Social Network AutoMap v1 =====
  // Policy: initial 7, batch 8, max 100 per section
  const POLICY = { initial: 7, batch: 8, max: 100 };

  // Section order mapping (DOM order -> data file)
  const SECTION_MAP = [
    { selector: '#sns-instagram, .sns-instagram', key: 'social-instagram' },
    { selector: '#sns-youtube, .sns-youtube',     key: 'social-youtube' },
    { selector: '#sns-twitter, .sns-twitter',     key: 'social-twitter' },
    { selector: '#sns-facebook, .sns-facebook',   key: 'social-facebook' },
    { selector: '#sns-tiktok, .sns-tiktok',       key: 'social-tiktok' },
    { selector: '#sns-threads, .sns-threads',     key: 'social-threads' },
    { selector: '#sns-telegram, .sns-telegram',   key: 'social-telegram' },
    { selector: '#sns-discord, .sns-discord',     key: 'social-discord' },
    { selector: '#sns-community, .sns-community', key: 'social-community' }
  ];

  function cardHTML(x){
    const title = (x.title||'').replace(/"/g,'');
    const meta  = x.meta ? `<div class="thumb-meta">${x.meta}</div>` : '';
    return `<a class="thumb-card social-card" href="${x.url||'#'}" target="_blank" rel="noopener">
      <img class="thumb-img" loading="lazy" decoding="async" src="${x.thumbnail||''}" alt="${title}">
      <div class="thumb-body">
        <div class="thumb-title">${title}</div>${meta}
      </div>
    </a>`;
  }

  async function loadJSON(key){
    try{
      const r = await fetch(`/assets/data/${key}.json`, { cache:'no-cache' });
      if(!r.ok) return null;
      return await r.json();
    }catch(e){ return null; }
  }

  function mount(container, items){
    const list = (items||[]).slice(0, POLICY.max);
    const grid = container.querySelector('.thumb-grid,.thumb-scroller,.thumb-list') || container;
    grid.innerHTML = '';

    let i = 0;
    const push = it => grid.insertAdjacentHTML('beforeend', cardHTML(it));

    for(; i < Math.min(POLICY.initial, list.length); i++) push(list[i]);

    if('IntersectionObserver' in window && grid.lastElementChild){
      const io = new IntersectionObserver((ents)=>{
        ents.forEach(ent=>{
          if(!ent.isIntersecting) return;
          io.unobserve(ent.target);
          const s = i, e = Math.min(i + POLICY.batch, list.length);
          for(let k=s; k<e; k++) push(list[k]);
          i = e;
          if(i < list.length) io.observe(grid.lastElementChild);
        });
      }, { rootMargin: '800px 0px' });
      io.observe(grid.lastElementChild);
    }
  }

  async function init(){
    for(const def of SECTION_MAP){
      const el = document.querySelector(def.selector);
      if(!el) continue;
      const data = await loadJSON(def.key);
      if(!data || !Array.isArray(data.items)) continue;
      mount(el, data.items);
    }
  }

  (document.readyState==='loading')
    ? document.addEventListener('DOMContentLoaded', init, { once:true })
    : init();

})();
