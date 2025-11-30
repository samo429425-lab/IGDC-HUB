/*
  SN Automap Patch v1 (release)
  - Social Network automapping engine per agreed specs.
  - Do NOT include any secrets. Client-side only.
*/
(function(){
  const IG = (window.IGTC = window.IGTC || {});
  const isMobile = matchMedia('(max-width:1100px)').matches || matchMedia('(pointer:coarse)').matches;

  const killArrows = () => {
    if(!isMobile) return;
    const sel = '.rscroll,.row-arrow,.scroll-left,.scroll-right,.row-left,.row-right,[data-arrow],.igdc-scroll-left,.igdc-scroll-right';
    document.querySelectorAll(sel).forEach(el=>el.remove());
    const noop = ()=>{}; ['__scheduleArrows','scheduleArrows','updateArrows','placeArrows'].forEach(k=>{ try{ if(typeof window[k]==='function') window[k]=noop; }catch(_){} });
  };

  const injectCSS = () => {
    if(document.getElementById('sn-automap-style')) return;
    const css = `
      @media (max-width:1100px), (pointer:coarse){
        .rscroll,.row-arrow,.scroll-left,.scroll-right,.row-left,.row-right,[data-arrow],.igdc-scroll-left,.igdc-scroll-right{display:none!important;opacity:0!important;pointer-events:none!important}
      }
      @media (max-width:768px) and (orientation:portrait){
        .row-scroller{overflow-x:hidden!important}
        .row-grid{display:grid!important;grid-auto-flow:row!important;grid-template-columns:1fr!important;gap:12px!important}
        .row-grid .card{min-width:100%!important;max-width:100%!important}
      }
      @media (max-width:768px) and (orientation:landscape){
        .row-scroller{overflow-x:hidden!important}
        .row-grid{display:grid!important;grid-auto-flow:row!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:12px!important}
      }
      @media (max-width:640px){ .row-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important} }
      #sn-fullview{position:fixed;inset:0;display:none;z-index:10080}
      #sn-fullview.open{display:block}
      #sn-fullview .fv-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}
      #sn-fullview .fv-body{position:absolute;inset:clamp(8px,4vw,24px);background:#fff;border-radius:14px;overflow:auto}
      #sn-fullview .fv-body iframe, #sn-fullview .fv-body img {display:block;max-width:100%;height:auto;margin:0 auto}
      .sn-label-badge{font-size:11px;border:1px solid #ddd;border-radius:10px;padding:2px 6px}
      .sn-badge-sponsored{border-color:#999}
    `;
    const s = document.createElement('style');
    s.id='sn-automap-style'; s.textContent=css; document.head.appendChild(s);
  };

  const isBlocked = (card)=>{
    const badKw = [
      /도박|베팅|카지노|바카라|토토|먹튀/i,
      /성매매|성인용|19\\+|야동|AV|porn|sex|escort/i,
      /마약|대마|코카인|필로폰|스테로이드/i,
      /총기|무기거래|테러/i,
      /보이스피싱|폰테크|작전주|묻지마 코인|러그풀|scam/i
    ];
    const txt = [card.title, card.channel, card.desc, card.url].filter(Boolean).join(' ');
    if(badKw.some(rx=>rx.test(txt))) return true;
    if(card.status && card.status!=='live') return true;
    if(!card.id||!card.platform||!card.url||!card.thumb) return true;
    return false;
  };

  const shortsCap = (N)=> Math.floor(N*3/20);
  const isShorts = (c)=> c.platform==='youtube' && (c.isShorts===true || /shorts\\//.test(c.url));
  const computeRevenueSlots = (N)=>({min: Math.max(1, Math.floor(N/10)), max: Math.floor(N/10)*2});

  async function resolveSections(){
    try{
      const r = await fetch('/assets/data/pages.json', {cache:'no-cache'});
      if(r.ok){ const pj = await r.json();
        const ids = [];
        (pj.sections||pj.rows||[]).forEach(s=>{ if(s && (s.type==='socialnetwork'||/social/.test(s.id||s.type||''))) ids.push(s.id||'socialnetwork'); });
        const maps = ids.map(id=>({id, el: document.getElementById(id) || document.querySelector(`[data-section-id=\"${id}\"]`) || document.querySelector('.row-grid')}));
        return maps.filter(m=>m.el);
      }
    }catch(e){}
    const g = document.querySelector('.row-grid') || document.querySelector('[data-grid=\"social\"]');
    return g? [{id:'socialnetwork', el:g}] : [];
  }

  const cardHTML = (c)=>{
    const lab = c.revenue? '<span class=\"sn-label-badge sn-badge-sponsored\">스폰서</span>':'';
    return `<a class=\"card\" href=\"${c.url}\" target=\"_blank\" rel=\"noopener\" data-id=\"${c.id}\" data-platform=\"${c.platform}\" data-embed=\"${c.embedMode||'linkcard'}">
      <img class=\"thumb-img\" loading=\"lazy\" decoding=\"async\" src=\"${c.thumb}\" alt=\"${(c.title||c.channel||'content').replace(/\"/g,'')}\">
      <div class=\"meta\"><div class=\"t\">${c.title?c.title:''}</div><div class=\"c\">${c.channel?c.channel:''} ${lab}</div></div>
    </a>`;
  };

  function openFullscreen(card){
    let v = document.getElementById('sn-fullview');
    if(!v){
      v = document.createElement('div'); v.id='sn-fullview';
      v.innerHTML = '<div class=\"fv-backdrop\"></div><div class=\"fv-body\" role=\"dialog\" aria-modal=\"true\"></div>';
      document.body.appendChild(v);
      v.querySelector('.fv-backdrop').addEventListener('click', ()=>v.classList.remove('open'));
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') v.classList.remove('open'); });
    }
    const body = v.querySelector('.fv-body');
    const url = card.getAttribute('href');
    const plat = card.getAttribute('data-platform');
    if(plat==='youtube'){
      const idMatch = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\\.be\\/([^?]+)/) || url.match(/shorts\\/([^?]+)/);
      const vid = idMatch? idMatch[1] : '';
      body.innerHTML = vid? `<iframe title=\"YouTube\" width=\"100%\" height=\"520\" src=\"https://www.youtube.com/embed/${vid}\" frameborder=\"0\" allow=\"autoplay; encrypted-media\" allowfullscreen></iframe>` : `<img src=\"${card.querySelector('img').src}\">`;
    }else{
      body.innerHTML = `<img src=\"${card.querySelector('img').src}\">`;
    }
    v.classList.add('open');
  }
  document.addEventListener('click', function(e){
    const a = e.target.closest('.row-grid .card');
    if(!a) return; const mobile = matchMedia('(max-width:768px)').matches || matchMedia('(pointer:coarse)').matches;
    if(mobile){ e.preventDefault(); openFullscreen(a); }
  });

  async function loadFeed(){
    const tries = [
      '/assets/data/social_feed.json',
      '/.netlify/functions/feed?page=socialnetwork',
      '/assets/hero/psom.json',
    ];
    for(const u of tries){
      try{ const r = await fetch(u,{cache:'no-cache'}); if(r.ok) return await r.json(); }catch(e){}
    }
    return { rows: [] };
  }

  function applyFeedData(feed){
    const rows = (feed&&feed.rows)||[];
    for(const row of rows){
      const target = document.getElementById(row.sectionId||row.id) || document.querySelector(`[data-section-id=\"${row.sectionId||row.id}\"]`) || document.querySelector('.row-grid');
      if(!target) continue;
      const grid = target.classList.contains('row-grid')? target : target.querySelector('.row-grid') || target;
      grid.innerHTML = '';
      let cards = (row.cards||[]).filter(c=>!isBlocked(c));
      const cap = shortsCap(cards.length);
      let shorts = cards.filter(isShorts);
      let normal = cards.filter(c=>!isShorts(c));
      shorts = shorts.slice(0, cap);
      cards = normal.concat(shorts);

      if(row.revenueCandidates && row.revenueCandidates.length){
        const {min, max} = computeRevenueSlots(cards.length);
        const count = Math.min(Math.max(min,1), max||min);
        const picks = row.revenueCandidates.filter(c=>!isBlocked(c)).slice(0, count).map(c=>({...c, revenue:true}));
        const slots = []; const base = 10;
        for(let i=base-2;i<=base+2 && slots.length<picks.length;i++) slots.push(Math.min(Math.max(i,1), cards.length));
        picks.forEach((p,idx)=>{ const at = slots[idx]|| (8+idx*10); cards.splice(Math.min(at, cards.length), 0, p); });
      }

      const BATCH0 = 12, BATCH = 11;
      let idx=0;
      const mount = (item)=>{ grid.insertAdjacentHTML('beforeend', cardHTML(item)); };
      for(; idx<Math.min(BATCH0, cards.length); idx++) mount(cards[idx]);

      const io = ('IntersectionObserver' in window)? new IntersectionObserver((ents)=>{
        ents.forEach(ent=>{
          if(ent.isIntersecting){
            io.unobserve(ent.target);
            const start = idx, end = Math.min(idx+BATCH, cards.length);
            for(let i=start;i<end;i++) mount(cards[i]);
            idx = end;
            if(idx < cards.length) io.observe(grid.lastElementChild);
          }
        });
      },{rootMargin:'800px 0px'}): null;
      if(io && grid.lastElementChild) io.observe(grid.lastElementChild);
    }
    cleanupOrphans();
  }

  function cleanupOrphans(){
    const footer = document.querySelector('footer, .site-footer');
    const afterFooter = [];
    if(footer){
      let n = footer.nextElementSibling; while(n){ afterFooter.push(n); n = n.nextElementSibling; }
      afterFooter.forEach(node=>{
        if(node.matches && (node.matches('.thumb-card,.ad,[data-card],[data-ad]') || node.querySelector?.('.thumb-card,[data-card],.ad'))){ node.remove(); }
      });
    }
    document.querySelectorAll('.card').forEach(el=>{
      if(!el.closest('.row-grid')) el.remove();
    });
    document.querySelectorAll('[style*="overflow"]').forEach(el=>{
      const st = getComputedStyle(el); if(st.position==='fixed' && !el.closest('header') && !el.closest('footer')){ el.style.overflow='visible'; }
    });
  }

  window.addEventListener('IGTC_FEED_UPDATE', (e)=>{
    try{ applyFeedData(e.detail||{rows:[]}); }catch(err){ console.warn('IGTC_FEED_UPDATE failed', err); }
  });

  (async function init(){
    try{
      injectCSS();
      killArrows();
      const sections = await resolveSections();
      if(!sections.length){ console.warn('[SN-Automap] sections not found'); return; }
      const feed = await loadFeed();
      applyFeedData(feed);
    }catch(err){ console.error('[SN-Automap] init error', err); }
  })();
})();