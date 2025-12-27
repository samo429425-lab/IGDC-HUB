
/* home-products-automap.v2.js — 8 sections product injection (initial 10 each, lazy add) */
(function(){
  'use strict';
  const isMobile = matchMedia('(max-width:768px), (pointer:coarse)').matches;

  async function loadFeed(){
    const tries=['/.netlify/functions/feed?page=homeproducts'];
    for(const u of tries){ try{ const r=await fetch(u,{cache:'no-cache'}); if(r.ok) return await r.json(); }catch(_){ } }
    return { sections: [] };
  }

  function isValid(c){
    if(!c) return false;
    const bad=[/도박|베팅|카지노|토토/i,/성인|19\+|porn|sex/i,/범죄|마약|총기/i,/스캠|피싱|scam/i];
    const t=[c.title,c.brand,c.desc,c.url].filter(Boolean).join(' ');
    if(bad.some(rx=>rx.test(t))) return false;
    return !!(c.id && c.url && (c.thumb||c.photo));
  }

  const DETAIL=(c)=> c.detailUrl || ('/product.html?id='+encodeURIComponent(c.id));

  function el(q){ return document.querySelector(q); }
  function els(q){ return Array.from(document.querySelectorAll(q)); }

  function findMainSections(){
    // Try explicit ids first
    const ids=['section-1','section-2','section-3','section-4','section-5'];
    const found = ids.map(id=>({id, el: document.getElementById(id)})).filter(x=>x.el);
    if(found.length>=4) return found;
    // Fallback: first five shopping sections/grids on page
    const grids = els('.shopping-section, .hot-section, .shopping-row, .shop-row, .shopping-hot-item')
                  .filter((n,i,self)=> self.indexOf(n)===i).slice(0,5);
    return grids.map((el,idx)=>({ id:'main-'+(idx+1), el }));
  }
  function findRightPanelSections(){
    const ad = el('.ad-panel');
    if(!ad) return [];
    const subs = els('.ad-panel .ad-section');
    if(subs.length) return subs.slice(0,3).map((el,idx)=>({ id:'ad-'+(idx+1), el }));
    return [];
  }

  function cardHTML(c){
    const title=(c.title||'').replace(/\"/g,'');
    const price = c.price ? `<div class="p">${c.price}</div>` : '';
    return `<a class="product-card" href="${DETAIL(c)}" data-product-id="${c.id}" target="_blank" rel="noopener">
      <img loading="lazy" decoding="async" src="${c.thumb||c.photo}" alt="${title}">
      <div class="meta"><div class="t">${title}</div>${price}</div>
    </a>`;
  }

  
  function mountSection(sectionEl, cards, maxItems){
    const grid = sectionEl.querySelector('.shopping-hot-item, .hot-today, .shopping-row, .shop-row, .grid, .row-grid') || sectionEl;
    grid.innerHTML='';
    const list = cards.filter(isValid).slice(0, maxItems);
    const B0 = Math.min(list.length, 10);
    const B  = 10;
    let i=0;
    const push = it => grid.insertAdjacentHTML('beforeend', cardHTML(it));
    for(; i<Math.min(B0, list.length); i++) push(list[i]);
    if('IntersectionObserver' in window && grid.lastElementChild){
      const io = new IntersectionObserver((ents)=>{
        ents.forEach(ent=>{
          if(!ent.isIntersecting) return; io.unobserve(ent.target);
          const s=i, e=Math.min(i+B, list.length);
          for(let k=s;k<e;k++) push(list[k]); i=e;
          if(i<list.length) io.observe(grid.lastElementChild);
        });
      },{ rootMargin:'800px 0px' });
      io.observe(grid.lastElementChild);
    }
  }


  function cleanup(){
    // Remove dummies
    els('.product-card').forEach(a=>{
      const href=(a.getAttribute('href')||'').trim();
      const id=a.getAttribute('data-product-id');
      const img=a.querySelector('img');
      const ph=img && /placehold\.co|data:image\/gif;base64/.test(img.src||'');
      if((!href||href==='#') && !id && ph){ a.remove(); }
    });
    // Below footer
    const f=el('footer, .site-footer');
    if(f){
      let n=f.nextElementSibling;
      while(n){ const nn=n.nextElementSibling;
        if(n.querySelector?.('.product-card')||n.classList?.contains('product-card')) n.remove();
        n=nn;
      }
    }
  }

  async function init(){
    const feed = await loadFeed();
    const main = findMainSections();
    const right = findRightPanelSections();
    const all = main.concat(right).slice(0,8);
    const dataMap = {};
    (feed.sections||feed.rows||[]).forEach(s=>{ dataMap[(s.id||s.sectionId||'').toLowerCase()] = (s.items||s.cards||[]); });

    all.forEach((slot, idx)=>{
      // Match by id; otherwise distribute sequentially
      const key=(slot.id||'').toLowerCase();
      const list = dataMap[key] || dataMap['main-'+(idx+1)] || dataMap['section-'+(idx+1)] || [];
      const maxItems = (idx < 5) ? 100 : 50;
      mountSection(slot.el, list, maxItems);
    });

    cleanup();
  }

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init, {once:true}); }
  else { init(); }
})();
