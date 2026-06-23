// distribution-products-automap.v3.js
// IGDC/MARU Distribution Hub: instant static render + non-blocking regional refresh.
// Purpose: never wait for the regional autoselector before showing the hub;
//          reuse the same-session regional result on page revisits.
(function(){
  'use strict';
  if(window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V3__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V3__=true;

  const STATIC_SNAPSHOT_URL='/data/distribution.snapshot.json';
  const REGIONAL_SNAPSHOT_URL='/.netlify/functions/regional-brokerage-snapshot?hub=distribution';
  const LIMIT_MAIN=100, LIMIT_RIGHT=100;
  const SESSION_CACHE_TTL=10*60*1000;
  const SESSION_CACHE_PREFIX='igdc:distribution:regional-snapshot:v2:';
  const SECTION_MAP=[
    {key:'distribution-recommend',selector:'[data-psom-key="distribution-recommend"]',limit:LIMIT_MAIN},
    {key:'distribution-new',selector:'[data-psom-key="distribution-new"]',limit:LIMIT_MAIN},
    {key:'distribution-trending',selector:'[data-psom-key="distribution-trending"]',limit:LIMIT_MAIN},
    {key:'distribution-special',selector:'[data-psom-key="distribution-special"]',limit:LIMIT_MAIN},
    {key:'distribution-sponsor',selector:'[data-psom-key="distribution-sponsor"]',limit:LIMIT_MAIN},
    {key:'distribution-others',selector:'[data-psom-key="distribution-others"]',limit:LIMIT_MAIN},
    {key:'distribution-right',selector:'[data-psom-key="distribution-right"]',limit:LIMIT_RIGHT}
  ];
  const ALIAS={
    'distribution-recommend':'distribution_1',
    'distribution-new':'distribution_2',
    'distribution-trending':'distribution_3',
    'distribution-special':'distribution_4',
    'distribution-sponsor':'distribution_5',
    'distribution-others':'distribution_6',
    'distribution-right':'distribution_7'
  };
  let activePriority=0;
  let activeFingerprint='';

  function escUrl(v){try{return String(v||'').replace(/'/g,'%27');}catch(_e){return '';}}
  function text(v){return v==null?'':String(v);}
  function pick(item,names){for(const name of names){const value=item&&item[name];if(value)return value;}return '';}
  function sectionsOf(snapshot){return snapshot&&(snapshot.pages&&snapshot.pages.distribution&&snapshot.pages.distribution.sections||snapshot.sections)||null;}
  function revenue(item,kind){
    try{
      if(window.MaruRevenueTracker&&typeof window.MaruRevenueTracker[kind]==='function'){
        window.MaruRevenueTracker[kind](item,{
          service:'distributionhub-regional-brokerage',pageType:'distribution',page:'distribution',
          section:item.section||item.psom_key||null,revenueLine:'product_affiliate'
        });
      }
    }catch(_e){}
  }
  function card(item){
    const root=document.createElement('div');root.className='thumb-card';
    const img=document.createElement('div');img.className='thumb-img';
    const image=pick(item,['thumb','thumbnail','image','imageUrl','thumbnailUrl']);
    if(image){img.style.backgroundImage="url('"+escUrl(image)+"')";img.style.backgroundSize='cover';img.style.backgroundPosition='center';}
    const title=document.createElement('div');title.className='thumb-title';title.textContent=text(pick(item,['title','name','text'])||'Product');
    const meta=document.createElement('div');meta.className='thumb-meta';meta.textContent=text(pick(item,['meta','subtitle','summary','description']));
    root.appendChild(img);root.appendChild(title);root.appendChild(meta);
    const href=pick(item,['url','href','link']);
    if(href&&href!=='#'){
      root.style.cursor='pointer';root.setAttribute('role','link');root.tabIndex=0;
      const open=function(){revenue(item,'trackClick');window.location.assign(href);};
      root.addEventListener('click',open);
      root.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    }
    revenue(item,'trackImpression');
    return root;
  }
  function snapshotFingerprint(snapshot){
    try{
      const meta=snapshot&&snapshot.meta||{};
      const sections=sectionsOf(snapshot)||{};
      const first=Object.keys(sections).sort().map(function(key){
        const v=sections[key];const list=Array.isArray(v)?v:(v&&Array.isArray(v.slots)?v.slots:[]);
        return key+':'+list.length+':'+list.slice(0,3).map(function(item){return pick(item,['id','title','name','url']);}).join('|');
      }).join('~');
      return [meta.targetMarket||'',meta.targetRegion||'',meta.generatedAt||'',meta.cardCount||'',first].join('::');
    }catch(_e){return '';}
  }
  function render(snapshot,priority){
    const sections=sectionsOf(snapshot);
    if(!sections || priority<activePriority)return false;
    const fingerprint=snapshotFingerprint(snapshot);
    if(fingerprint && fingerprint===activeFingerprint)return false;
    SECTION_MAP.forEach(function(cfg){
      const box=document.querySelector(cfg.selector);if(!box)return;
      const raw=sections[cfg.key]||sections[ALIAS[cfg.key]];
      const list=Array.isArray(raw)?raw:(raw&&Array.isArray(raw.slots)?raw.slots:[]);
      while(box.firstChild)box.removeChild(box.firstChild);
      list.slice(0,cfg.limit).forEach(function(item){box.appendChild(card(item));});
    });
    activePriority=priority;
    activeFingerprint=fingerprint;
    return true;
  }
  async function fetchJson(url,timeout,cacheMode){
    const controller=typeof AbortController!=='undefined'?new AbortController():null;
    const timer=controller?setTimeout(function(){controller.abort();},timeout):null;
    try{
      const r=await fetch(url,{cache:cacheMode||'default',credentials:'same-origin',signal:controller&&controller.signal});
      if(r.status===204)throw new Error('empty');
      if(!r.ok)throw new Error('HTTP '+r.status);
      return await r.json();
    }finally{if(timer)clearTimeout(timer);}
  }
  function cacheKey(){
    const lang=(document.documentElement&&document.documentElement.lang||'default').toLowerCase();
    return SESSION_CACHE_PREFIX+lang;
  }
  function readRegionalCache(){
    try{
      const raw=sessionStorage.getItem(cacheKey());if(!raw)return null;
      const row=JSON.parse(raw);
      if(!row||!row.snapshot||!row.at||Date.now()-row.at>SESSION_CACHE_TTL){sessionStorage.removeItem(cacheKey());return null;}
      return row;
    }catch(_e){return null;}
  }
  function writeRegionalCache(snapshot){
    try{sessionStorage.setItem(cacheKey(),JSON.stringify({at:Date.now(),snapshot:snapshot}));}catch(_e){}
  }
  function schedule(task){
    if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(task,{timeout:1200});
    else setTimeout(task,0);
  }
  function loadStaticImmediately(){
    return fetchJson(STATIC_SNAPSHOT_URL,3500,'default')
      .then(function(snapshot){render(snapshot,1);return snapshot;})
      .catch(function(e){console.warn('[Distribution AutoMap] static snapshot unavailable',e);return null;});
  }
  function refreshRegionalInBackground(){
    return fetchJson(REGIONAL_SNAPSHOT_URL,4200,'no-store')
      .then(function(snapshot){
        if(snapshot&&snapshot.meta&&snapshot.meta.regionalBrokerage===true&&sectionsOf(snapshot)){
          writeRegionalCache(snapshot);
          render(snapshot,2);
        }
      })
      .catch(function(){/* Static snapshot remains visible; regional refresh is never render-blocking. */});
  }
  (function boot(){
    const cached=readRegionalCache();
    if(cached&&cached.snapshot){
      render(cached.snapshot,2);
      // Do not repeat the server-side selection during a normal same-session return visit.
      return;
    }
    // Static content is the first render. The potentially slow collector is only a background refresh.
    loadStaticImmediately();
    schedule(refreshRegionalInBackground);
  })();
})();

/* ------------------------------------------------------------------
 * MARU Revenue AutoHook Loader
 * Retained from the production baseline; it does not block card rendering.
 * ------------------------------------------------------------------ */
(function loadMaruRevenueAutoHookForAutomap(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined')return;
  function installIfReady(){
    try{
      if(window.MaruRevenueAutoHook&&typeof window.MaruRevenueAutoHook.install==='function'){
        window.MaruRevenueAutoHook.install({service:'front-automap'});
      }
    }catch(e){console.warn('[MARU Revenue] autohook install skipped:',e);}
  }
  function loadScriptOnce(src,id,globalName,done){
    const existing=document.getElementById(id);
    if(window[globalName]){if(typeof done==='function')done();return;}
    if(existing){
      existing.addEventListener('load',function(){if(typeof done==='function')done();},{once:true});
      existing.addEventListener('error',function(){console.warn('[MARU Revenue] failed to load:',src);},{once:true});
      return;
    }
    const script=document.createElement('script');
    script.id=id;script.src=src;script.async=false;
    script.onload=function(){if(typeof done==='function')done();};
    script.onerror=function(){console.warn('[MARU Revenue] failed to load:',src);};
    (document.head||document.documentElement).appendChild(script);
  }
  if(window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__){installIfReady();return;}
  window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__=true;
  loadScriptOnce('/assets/js/maru-revenue-tracker.js','maruRevenueTrackerScript','MaruRevenueTracker',function(){
    loadScriptOnce('/assets/js/maru-revenue-autohook.js','maruRevenueAutoHookScript','MaruRevenueAutoHook',installIfReady);
  });
})();
