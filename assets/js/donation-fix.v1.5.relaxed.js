
/*! donation-fix.v1.5.js — mobile arrows, footer guard, '교육' placement, grids, cleanup */
(function(){
  'use strict';
  const isMobile = matchMedia('(max-width:1024px), (pointer:coarse)').matches;

  // 1) CSS guards (once)
  (function(){
    if(document.getElementById('don15-style')) return;
    const s=document.createElement('style'); s.id='don15-style';
    s.textContent=`
      /* Footer layout guard (relaxed: removed global flex layout to avoid footer overlapping content) */
      /* html,body{height:100%;min-height:100%} */
      /* body{display:flex;flex-direction:column;min-height:100vh;overflow-x:hidden!important} */
      /* main,.main-content,.content,.page-main{flex:1 1 auto;min-height:calc(100vh - var(--don-footer-h,0px))} */
      /* footer,.site-footer{flex:0 0 auto;width:100%;clear:both;position:relative;z-index:2} */

      /* Hide arrows on mobile (portrait/landscape) */
      @media (max-width:1024px), (pointer:coarse){
        .rscroll,.scroll-left,.scroll-right,.row-left,.row-right,[data-arrow],
        .igdc-scroll-left,.igdc-scroll-right,.btn-arrow,.btn-scroll-left,.btn-scroll-right{display:none!important;opacity:0!important;pointer-events:none!important}
      }

      /* Grids (cards/thumbnail rows) */
      :root{ --thumb-h: 240px; }
      @media (max-width:768px) and (orientation:portrait){
        .thumb-grid,.row-grid,.cards-row{display:grid!important;grid-template-columns:1fr!important;gap:12px}
        .thumb-card,.card{min-width:100%!important;max-width:100%!important}
        .sec-board .list{max-height:calc(var(--thumb-h)*0.66);overflow:auto}
      }
      @media (max-width:1024px) and (orientation:landscape){
        .thumb-grid,.row-grid,.cards-row{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:12px}
        .sec-board .list{max-height:var(--thumb-h);overflow:auto}
      }
      @media (max-width:640px){ .thumb-grid,.row-grid,.cards-row{grid-template-columns:repeat(2,minmax(0,1fr))!important} }

      /* Section board minimal style (if page already includes, this is harmless) */
      .sec-board{border:1px solid #e5e5e5;border-radius:12px;margin:10px 0;background:#fff;overflow:hidden}
      .sec-board .head{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px 10px;background:#fafafa;border-bottom:1px solid #eee}
      .sec-board .tabs{display:flex;gap:8px;font-size:13px}
      .sec-board .tabs button{border:1px solid #ddd;background:#fff;border-radius:10px;padding:4px 8px;cursor:pointer}
      .sec-board .tabs button.active{background:#222;color:#fff;border-color:#222}
      .sec-board .body{display:none;padding:10px}
      .sec-board.open .body{display:block}
    `;
    document.head.appendChild(s);
  })();

  // 2) Footer height sync
  function syncFooterH(){
    try{
      const f=document.querySelector('footer,.site-footer'); const h=f?Math.round(f.getBoundingClientRect().height):0;
      document.documentElement.style.setProperty('--don-footer-h',(h||0)+'px');
    }catch(e){}
  }

  // 3) Ensure '교육' section between '환경' and '기타'
  function ensureEdu(){
    const env = document.getElementById('sec-env') || document.querySelector('[id*="env"],[id*="환경"]');
    const etc = document.getElementById('sec-etc') || document.querySelector('[id*="etc"],[id*="기타"]');
    let edu = document.getElementById('sec-edu') || document.querySelector('[id*="edu"],[id*="교육"]');
    if(!env || !etc) return;
    if(!edu){
      edu = document.createElement('section'); edu.id='sec-edu'; edu.className='don-section';
      edu.innerHTML = '<h3 class="section-title">교육</h3><div class="thumb-grid" data-source="edu"></div>';
      etc.parentNode.insertBefore(edu, etc);
    }else{
      const parent = etc.parentNode;
      if(parent && edu.parentNode!==parent){ parent.appendChild(edu); }
      if(parent){ parent.insertBefore(edu, etc); }
    }
  }

  // 4) Cleanup leftovers (below footer & dummy cards)
  function cleanup(){
    const f=document.querySelector('footer,.site-footer');
    if(f){ let n=f.nextElementSibling; while(n){ const nn=n.nextElementSibling;
      if(n.querySelector?.('.thumb-card,.card,.sec-board,.composer')) n.remove(); n=nn; } }
    document.querySelectorAll('.thumb-card,.card').forEach(a=>{
      const img=a.querySelector && a.querySelector('img'); const url=(a.getAttribute && a.getAttribute('href'))||'';
      const dummy = (!url || url==='#') || (img && /placehold\.co|placeholder\.com|data:image\//.test(img.src||''));
      if(dummy && a.remove) a.remove();
    });
  }

  // 5) Hide any arrows injected after load
  function killArrows(){
    if(!isMobile) return;
    const sel='.rscroll,.scroll-left,.scroll-right,.row-left,.row-right,[data-arrow],.igdc-scroll-left,.igdc-scroll-right,.btn-arrow,.btn-scroll-left,.btn-scroll-right';
    document.querySelectorAll(sel).forEach(el=> el.remove());
    ['__scheduleArrows','scheduleArrows','updateArrows','placeArrows'].forEach(k=>{ try{ if(typeof window[k]==='function') window[k]=function(){}; }catch(_){ } });
  }

  // 6) Init
  function init(){
    ensureEdu();
    cleanup();
    syncFooterH();
    killArrows();
    setTimeout(syncFooterH, 120);
    setTimeout(killArrows, 200);
  }
  (document.readyState==='loading')? document.addEventListener('DOMContentLoaded', init, {once:true}) : init();
})();