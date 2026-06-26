// distribution-products-automap.v3.js
// IGDC/MARU Distribution Hub: zero-wait first paint + background snapshot refresh.
//
// Design contract:
// - The hub always paints local sample slots first after DOMContentLoaded.
// - Large distribution.snapshot.json and regional selection never block first paint.
// - Returned data replaces the local sample only after it has been received and validated.
// - Same-session cache is used on every return visit.
// - The generic thumbnail loader is prevented from racing this page's controlled slots.
(function(){
  'use strict';
  if(window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V3__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V3__=true;

  const STATIC_SNAPSHOT_URL='/data/distribution.snapshot.json';
  const REGIONAL_SNAPSHOT_URL='/.netlify/functions/regional-brokerage-snapshot?hub=distribution';
  const LIMIT_MAIN=100, LIMIT_RIGHT=100;
  const STATIC_TTL=30*60*1000;
  const REGIONAL_TTL=15*60*1000;
  const REGIONAL_NEGATIVE_TTL=30*60*1000;
  const CACHE_PREFIX='igdc:distribution:instant-render:v4:';
  const SECTION_MAP=[
    {key:'distribution-recommend',selector:'[data-psom-key="distribution-recommend"]',limit:LIMIT_MAIN,label:'Recommend Item'},
    {key:'distribution-new',selector:'[data-psom-key="distribution-new"]',limit:LIMIT_MAIN,label:'New Item'},
    {key:'distribution-trending',selector:'[data-psom-key="distribution-trending"]',limit:LIMIT_MAIN,label:'Trending Item'},
    {key:'distribution-special',selector:'[data-psom-key="distribution-special"]',limit:LIMIT_MAIN,label:'Special Item'},
    {key:'distribution-sponsor',selector:'[data-psom-key="distribution-sponsor"]',limit:LIMIT_MAIN,label:'Sponsor Item'},
    {key:'distribution-others',selector:'[data-psom-key="distribution-others"]',limit:LIMIT_MAIN,label:'Product Item'},
    {key:'distribution-right',selector:'[data-psom-key="distribution-right"]',limit:LIMIT_RIGHT,label:'Recommended Brand'}
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
  const PLACEHOLDER_IMG='/assets/img/placeholder.png';
  let activePriority=-1;
  let activeFingerprint='';

  function text(v){return v==null?'':String(v);}
  function pick(item,names){for(const name of names){const value=item&&item[name];if(value!==undefined&&value!==null&&value!=='')return value;}return '';}
  function escUrl(v){try{return String(v||'').replace(/'/g,'%27');}catch(_e){return '';}}
  function cacheKey(kind){
    const lang=(document.documentElement&&document.documentElement.lang||'default').toLowerCase();
    return CACHE_PREFIX+kind+':'+lang;
  }
  function getCached(kind,ttl){
    try{
      const raw=sessionStorage.getItem(cacheKey(kind)); if(!raw) return null;
      const row=JSON.parse(raw);
      if(!row||!row.at||Date.now()-row.at>ttl){sessionStorage.removeItem(cacheKey(kind));return null;}
      return row;
    }catch(_e){return null;}
  }
  function setCached(kind,value){
    try{sessionStorage.setItem(cacheKey(kind),JSON.stringify({at:Date.now(),value:value}));}catch(_e){}
  }
  function sectionsOf(snapshot){
    return snapshot&&((snapshot.pages&&snapshot.pages.distribution&&snapshot.pages.distribution.sections)||snapshot.sections)||null;
  }
  function normalizeList(raw){
    return Array.isArray(raw)?raw:(raw&&Array.isArray(raw.slots)?raw.slots:[]);
  }
  function compactItem(item){
    item=item&&typeof item==='object'?item:{};
    return {
      id:pick(item,['id','uid','productId','contentId']),
      title:pick(item,['title','name','text']),
      name:pick(item,['name','title']),
      meta:pick(item,['meta','subtitle','summary','description']),
      summary:pick(item,['summary','description']),
      description:pick(item,['description','summary']),
      thumb:pick(item,['thumb','thumbnail','image','imageUrl','thumbnailUrl']),
      image:pick(item,['image','thumbnail','thumb','imageUrl']),
      url:pick(item,['url','href','link']),
      href:pick(item,['href','url','link']),
      link:pick(item,['link','url','href']),
      section:pick(item,['section','psom_key'])
    };
  }
  function compactSnapshot(snapshot){
    const source=sectionsOf(snapshot); if(!source) return null;
    const sections={};
    SECTION_MAP.forEach(function(cfg){
      const raw=source[cfg.key]||source[ALIAS[cfg.key]];
      sections[cfg.key]=normalizeList(raw).slice(0,cfg.limit).map(compactItem);
    });
    return {pages:{distribution:{sections:sections}},meta:{
      regionalBrokerage:!!(snapshot&&snapshot.meta&&snapshot.meta.regionalBrokerage),
      generatedAt:snapshot&&snapshot.meta&&snapshot.meta.generatedAt||'',
      targetMarket:snapshot&&snapshot.meta&&snapshot.meta.targetMarket||'',
      targetRegion:snapshot&&snapshot.meta&&snapshot.meta.targetRegion||'',
      compact:true
    }};
  }
  function seedSnapshot(){
    const sections={};
    SECTION_MAP.forEach(function(cfg){
      const list=[];
      for(let i=0;i<cfg.limit;i++){
        list.push({id:cfg.key+'-seed-'+(i+1),title:cfg.label+' '+(i+1),meta:'',thumb:PLACEHOLDER_IMG,image:PLACEHOLDER_IMG,url:'#',section:cfg.key});
      }
      sections[cfg.key]=list;
    });
    return {pages:{distribution:{sections:sections}},meta:{localSeed:true,generatedAt:'local-seed-v4'}};
  }
  const LOCAL_SEED=seedSnapshot();

  function makeCard(item){
    const root=document.createElement('div'); root.className='thumb-card';
    const img=document.createElement('div'); img.className='thumb-img';
    const image=pick(item,['thumb','thumbnail','image','imageUrl','thumbnailUrl'])||PLACEHOLDER_IMG;
    img.style.backgroundImage="url('"+escUrl(image)+"')";
    img.style.backgroundSize='cover'; img.style.backgroundPosition='center';
    const title=document.createElement('div'); title.className='thumb-title'; title.textContent=text(pick(item,['title','name','text'])||'Product');
    const meta=document.createElement('div'); meta.className='thumb-meta'; meta.textContent=text(pick(item,['meta','subtitle','summary','description']));
    root.appendChild(img); root.appendChild(title); root.appendChild(meta);
    const href=pick(item,['url','href','link']);
    if(href&&href!=='#'){
      root.style.cursor='pointer'; root.setAttribute('role','link'); root.tabIndex=0;
      const open=function(){
        try{if(window.MaruRevenueTracker&&typeof window.MaruRevenueTracker.trackClick==='function'){
          window.MaruRevenueTracker.trackClick(item,{service:'distributionhub',pageType:'distribution',page:'distribution',section:item.section||item.psom_key||null,revenueLine:'product_affiliate'});
        }}catch(_e){}
        window.location.assign(href);
      };
      root.addEventListener('click',open);
      root.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    }
    return root;
  }
  function fingerprint(snapshot,kind){
    try{
      const sections=sectionsOf(snapshot)||{};
      return String(kind||'')+'|'+SECTION_MAP.map(function(cfg){
        const list=normalizeList(sections[cfg.key]||sections[ALIAS[cfg.key]]);
        return cfg.key+':'+list.length+':'+list.slice(0,2).map(function(item){return pick(item,['id','title','url']);}).join('|');
      }).join('~');
    }catch(_e){return '';}
  }
  function controlHosts(){
    SECTION_MAP.forEach(function(cfg){
      const box=document.querySelector(cfg.selector);
      if(box){
        // thumbnail-loader.compat.min.js honours this flag on Distribution Hub.
        // It must not append a late network feed after this renderer owns the slots.
        box.dataset.mounted='1';
        box.dataset.distributionAutomap='v4';
      }
    });
  }
  function replaceChildren(box,fragment){
    if(typeof box.replaceChildren==='function'){box.replaceChildren(fragment);return;}
    while(box.firstChild)box.removeChild(box.firstChild); box.appendChild(fragment);
  }
  function render(snapshot,priority,kind){
    const sections=sectionsOf(snapshot); if(!sections||priority<activePriority) return false;
    const key=fingerprint(snapshot,kind); if(key&&key===activeFingerprint) return false;
    controlHosts();
    SECTION_MAP.forEach(function(cfg){
      const box=document.querySelector(cfg.selector); if(!box) return;
      const raw=sections[cfg.key]||sections[ALIAS[cfg.key]];
      const list=normalizeList(raw).slice(0,cfg.limit);
      if(!list.length) return;
      const fragment=document.createDocumentFragment();
      list.forEach(function(item){fragment.appendChild(makeCard(item));});
      replaceChildren(box,fragment);
    });
    activePriority=priority; activeFingerprint=key;
    return true;
  }
  async function fetchJson(url,timeout,cacheMode){
    const controller=typeof AbortController!=='undefined'?new AbortController():null;
    const timer=controller?setTimeout(function(){controller.abort();},timeout):null;
    try{
      const response=await fetch(url,{cache:cacheMode||'default',credentials:'same-origin',signal:controller&&controller.signal});
      if(response.status===204) return null;
      if(!response.ok) throw new Error('HTTP '+response.status);
      return await response.json();
    }finally{if(timer)clearTimeout(timer);}
  }
  function idle(task,delay){
    const run=function(){
      if(typeof window.requestIdleCallback==='function') window.requestIdleCallback(task,{timeout:1800});
      else setTimeout(task,0);
    };
    setTimeout(run,Math.max(0,delay||0));
  }
  function refreshStatic(){
    return fetchJson(STATIC_SNAPSHOT_URL,18000,'force-cache').then(function(snapshot){
      const compact=compactSnapshot(snapshot); if(!compact) return;
      setCached('static',compact); render(compact,2,'static');
    }).catch(function(){/* Local seed or same-session cache stays visible. */});
  }
  function refreshRegional(){
    const checked=getCached('regional-check',REGIONAL_NEGATIVE_TTL);
    if(checked) return;
    setCached('regional-check',{pending:true});
    return fetchJson(REGIONAL_SNAPSHOT_URL,14000,'no-store').then(function(snapshot){
      if(snapshot&&snapshot.meta&&snapshot.meta.regionalBrokerage===true){
        const compact=compactSnapshot(snapshot); if(compact){setCached('regional',compact);render(compact,3,'regional');}
      }
    }).catch(function(){/* keep the negative cooldown; request failures never affect visible slots */});
  }
  function boot(){
    controlHosts();
    const regional=getCached('regional',REGIONAL_TTL);
    const statik=getCached('static',STATIC_TTL);
    if(regional&&regional.value) render(regional.value,3,'regional-cache');
    else if(statik&&statik.value) render(statik.value,2,'static-cache');
    else render(LOCAL_SEED,1,'local-seed');

    // The 5.7 MB production snapshot is deliberately fetched after the first paint.
    // It can improve card details but is never allowed to delay the visible slots.
    if(!statik) idle(refreshStatic,600);
    // Discovery is the most expensive operation. It is delayed well beyond first paint,
    // and a no-result response is cooled down for the rest of the normal visit window.
    if(!regional) idle(refreshRegional,8000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();

/* Revenue support remains non-blocking and does not control slot rendering. */
(function loadMaruRevenueTracker(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined')return;
  const id='maruRevenueTrackerScript';
  if(window.MaruRevenueTracker||document.getElementById(id))return;
  const script=document.createElement('script');
  script.id=id; script.src='/assets/js/maru-revenue-tracker.js'; script.async=true;
  (document.head||document.documentElement).appendChild(script);
})();
