
(function(){
  'use strict';
  // ===== Rendering Policy (Distribution Hub) =====
  // initial: number of cards rendered at first paint
  // batch  : number of cards rendered per subsequent load
  const RENDER_POLICY = {
    initial: 6,
    batch: 8
  };

  const isMobile = matchMedia('(max-width:768px), (pointer:coarse)').matches;
  (function(){ if(document.getElementById('dh-footer-fix')) return;
    const s=document.createElement('style'); s.id='dh-footer-fix';
    s.textContent=`html,body{height:100%;min-height:100%}body{display:flex;flex-direction:column;min-height:100vh;overflow-x:hidden!important}
      main,.main-content,.content,.page-main{flex:1 1 auto;min-height:calc(100vh - var(--dh-footer-h,0px))}
      footer,.site-footer{flex:0 0 auto;width:100%;clear:both;position:relative;z-index:2}`;
    document.head.appendChild(s);
  })();
  function syncFooterHeight(){try{const f=document.querySelector('footer,.site-footer');const h=f?Math.max(0,Math.round(f.getBoundingClientRect().height)):0;
    document.documentElement.style.setProperty('--dh-footer-h',h+'px');}catch(e){}}

  async function loadFeed(){
    const tries=['/assets/data/distribution_feed.json','/.netlify/functions/feed?page=distributionhub','/assets/hero/psom.json'];
    for(const u of tries){ try{ const r=await fetch(u,{cache:'no-cache'}); if(r.ok) return await r.json(); }catch(e){} }
    return {sections:[]};
  }
  function isAllowed(x){ if(!x) return false;
    const ban=[/도박|베팅|카지노|토토/i,/성인|19\+|porn|sex/i,/범죄|마약|총기/i,/스캠|피싱|사기|scam/i];
    const t=[x.title,x.brand,x.desc,x.url].filter(Boolean).join(' '); if(ban.some(rx=>rx.test(t))) return false;
    return !!(x.id && (x.thumb||x.photo) && (x.detailUrl||x.url)); }
  const DETAIL=(x)=> x.detailUrl || ('/product.html?id='+encodeURIComponent(x.id));
  (function(){ if(!isMobile) return; if(document.getElementById('dh-mobile-css')) return;
    const s=document.createElement('style'); s.id='dh-mobile-css';
    s.textContent=`@media (max-width:600px) and (orientation:portrait){
      .thumb-scroller,.thumb-list,.thumb-row{display:flex!important;flex-wrap:nowrap!important;overflow-x:auto!important;gap:12px!important}
      .thumb-card{flex:0 0 calc(100vw - 28px)!important;max-width:calc(100vw - 28px)!important;scroll-snap-align:start}
    }
    @media (max-width:1024px) and (orientation:landscape){ .thumb-card{flex:0 0 48vw!important;max-width:48vw!important} }`;
    document.head.appendChild(s);
  })();
  function cardHTML(x){const title=(x.title||'').replace(/"/g,'');
    const price=x.price?`<div class="thumb-price">${x.price}</div>`:'';
    return `<a class="thumb-card product-card" href="${DETAIL(x)}" data-product-id="${x.id}" data-title="${title}" rel="noopener">
      <img class="thumb-img" loading="lazy" decoding="async" src="${x.thumb||x.photo}" alt="${title}">
      <div class="thumb-body"><div class="thumb-title">${title}</div><div class="thumb-meta">${price}<span class="thumb-tag">${x.tag||''}</span></div></div></a>`;}
  function openPhotoView(a){ let v=document.getElementById('dh-photoview'); if(!v){ v=document.createElement('div'); v.id='dh-photoview';
      v.innerHTML='<div class="pv-b"></div><div class="pv-c" role="dialog" aria-modal="true"></div>';
      Object.assign(v.style,{position:'fixed',inset:'0',zIndex:'10080',display:'none'});
      Object.assign(v.querySelector('.pv-b').style,{position:'absolute',inset:'0',background:'rgba(0,0,0,.55)'});
      Object.assign(v.querySelector('.pv-c').style,{position:'absolute',inset:'clamp(8px,4vw,24px)',background:'#fff',borderRadius:'14px',overflow:'auto',padding:'12px'});
      v.querySelector('.pv-b').addEventListener('click',()=>v.style.display='none'); document.addEventListener('keydown',(e)=>{if(e.key==='Escape') v.style.display='none';}); document.body.appendChild(v); }
    const c=v.querySelector('.pv-c'); const img=a.querySelector('img'); const title=a.getAttribute('data-title')||'';
    c.innerHTML=(img?`<img src="${img.src}" style="max-width:100%;height:auto;display:block;margin:0 auto 10px">`: '')+(title?`<div style="font-size:15px;padding:6px 2px">${title}</div>`:''); v.style.display='block'; }
  
  function mountGrid(container, items){
    const MAX_ITEMS = 100;
    const list = (items||[]).filter(isAllowed).slice(0, MAX_ITEMS);
    const grid = container.querySelector('.thumb-list,.thumb-scroller,.thumb-row,.cards-row')||container;
    grid.innerHTML='';
    const B0 = RENDER_POLICY.initial, B = RENDER_POLICY.batch;
    let i=0; const push=it=>grid.insertAdjacentHTML('beforeend', cardHTML(it));
    for(; i<Math.min(B0,list.length); i++) push(list[i]);
    if('IntersectionObserver' in window && grid.lastElementChild){
      const io=new IntersectionObserver((ents)=>{
        ents.forEach(ent=>{
          if(!ent.isIntersecting) return;
          io.unobserve(ent.target);
          const s=i, e=Math.min(i+B, list.length);
          for(let k=s;k<e;k++) push(list[k]);
          i=e;
          if(i<list.length) io.observe(grid.lastElementChild);
        });
      },{rootMargin:'800px 0px'});
      io.observe(grid.lastElementChild);
    }
  }

  (document.readyState==='loading')? document.addEventListener('DOMContentLoaded', init, {once:true}) : init();
})();