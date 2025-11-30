
(function(){
  'use strict';
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
  function mountGrid(container, items){ const list=(items||[]).filter(isAllowed);
    const grid=container.querySelector('.thumb-list,.thumb-scroller,.thumb-row,.cards-row')||container; grid.innerHTML='';
    const B0=10,B=10; let i=0; const push=it=>grid.insertAdjacentHTML('beforeend', cardHTML(it));
    for(; i<Math.min(B0,list.length); i++) push(list[i]);
    if('IntersectionObserver' in window && grid.lastElementChild){ const io=new IntersectionObserver((ents)=>{
          ents.forEach(ent=>{ if(!ent.isIntersecting) return; io.unobserve(ent.target);
            const s=i,e=Math.min(i+B,list.length); for(let k=s;k<e;k++) push(list[k]); i=e;
            if(i<list.length) io.observe(grid.lastElementChild); }); },{rootMargin:'800px 0px'});
      io.observe(grid.lastElementChild); } }
  function cleanup(){ document.querySelectorAll('.product-card').forEach(a=>{
      const href=(a.getAttribute('href')||'').trim(); const id=a.getAttribute('data-product-id');
      const img=a.querySelector('img'); const ph=img && /placehold\.co|placeholder\.com|data:image\//.test(img.src||'');
      if((!href||href==='#') && !id && ph){ a.remove(); }
    });
    const f=document.querySelector('footer,.site-footer'); if(f){ let n=f.nextElementSibling; while(n){ const nn=n.nextElementSibling;
        if(n.querySelector?.('.product-card')||n.classList?.contains('product-card')) n.remove(); n=nn; } } }
  document.addEventListener('click', function(e){ const a=e.target.closest('.thumb-card.product-card'); if(!a) return;
    if(isMobile){ e.preventDefault(); openPhotoView(a); } }, {passive:false});
  function mainSections(){ const ids=['sec-reco','sec-ads','sec-trend','sec-new','sec-special','sec-others'];
    const out=[]; ids.forEach(id=>{ const el=document.getElementById(id); if(el) out.push({id,el}); }); return out; }
  function adPanelToMobile7(){ if(!isMobile) return; const ad=document.querySelector('.ad-panel'); const main=document.querySelector('.main-content,main,.content,.page-main')||document.body;
    if(!ad||!main) return; let wrap=document.getElementById('sec-mobile-ads');
    if(!wrap){ wrap=document.createElement('section'); wrap.className='content-box'; wrap.id='sec-mobile-ads';
      wrap.innerHTML='<h3>📣 인기 브랜드(모바일)</h3><div class="scroller-wrap"><div class="thumb-list thumb-scroller" data-source="mobile-ads"></div></div>'; main.appendChild(wrap); }
    const list=wrap.querySelector('.thumb-list'); list.innerHTML=''; ad.querySelectorAll('.ad-box a').forEach((a,i)=>{
      const img=a.querySelector('img'); const title=a.getAttribute('title')||('광고 '+(i+1));
      const card={ id:'ad'+(i+1), title, thumb: img?img.src: 'https://via.placeholder.com/600x400?text=Ad', url: a.href, detailUrl:a.href, tag:'ad' };
      list.insertAdjacentHTML('beforeend', cardHTML(card)); }); }
  async function init(){
    adPanelToMobile7();
    const feed=await loadFeed();
    const map={}; (feed.sections||feed.rows||[]).forEach(s=>{ map[(s.id||s.sectionId||'').toLowerCase()]=(s.items||s.cards||[]); });
    const sections=mainSections(); const keys=['recommend','ads','trending','new','special','others'];
    sections.forEach((slot,idx)=>{ const container=slot.el; const key=container.querySelector('.thumb-list,.thumb-scroller')?.getAttribute('data-source') || keys[idx] || ('sec'+(idx+1));
      const items=map[key]||[]; mountGrid(container, items); });
    cleanup(); syncFooterHeight(); setTimeout(syncFooterHeight,60); setTimeout(syncFooterHeight,300);
    const mo=new MutationObserver(()=>{ cleanup(); }); mo.observe(document.documentElement,{subtree:true,childList:true});
  }
  (document.readyState==='loading')? document.addEventListener('DOMContentLoaded', init, {once:true}) : init();
})();