// distribution-products-automap.v3.js
// IGDC/MARU Distribution Hub: staged local paint + verified regional supply merge.
(function(){
  'use strict';
  if(window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V7__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V7__=true;

  const STATIC_SNAPSHOT_URL='/data/distribution.snapshot.json';
  const REGIONAL_SNAPSHOT_URL='/.netlify/functions/regional-brokerage-snapshot?hub=distribution';
  const LIMIT_MAIN=100, LIMIT_RIGHT=100;
  const INITIAL_SEED_PER_SECTION=8;
  const STATIC_TTL=30*60*1000;
  const REGIONAL_TTL=15*60*1000;
  const NO_RESULT_TTL=30*60*1000;
  const TRANSIENT_ERROR_TTL=3*60*1000;
  const STATIC_REVALIDATE_TTL=5*60*1000;
  const STATIC_DELAY=600;
  const REGIONAL_DELAY=8000;
  const STATIC_TIMEOUT=18000;
  const REGIONAL_TIMEOUT=14000;
  const CACHE_PREFIX='igdc:distribution:controlled-supply:v7:';
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
  let baseSnapshot=null;
  let regionalSnapshot=null;
  let activeFingerprint='';
  let renderGeneration=0;
  let regionalRefreshInFlight=false;
  let staticRefreshInFlight=false;
  let lastStaticRefreshAt=0;

  function text(v){return v==null?'':String(v);}
  function pick(item,names){
    for(const name of names){
      const value=item&&item[name];
      if(value!==undefined&&value!==null&&value!=='') return value;
    }
    return '';
  }
  function escUrl(v){try{return String(v||'').replace(/'/g,'%27');}catch(_e){return '';}}
  function cacheKey(kind){
    const lang=(document.documentElement&&document.documentElement.lang||'default').toLowerCase();
    return CACHE_PREFIX+kind+':'+lang;
  }
  function getCached(kind,ttl){
    try{
      const raw=sessionStorage.getItem(cacheKey(kind));
      if(!raw) return null;
      const row=JSON.parse(raw);
      if(!row||!row.at||Date.now()-row.at>ttl){sessionStorage.removeItem(cacheKey(kind));return null;}
      return row.value;
    }catch(_e){return null;}
  }
  function setCached(kind,value){try{sessionStorage.setItem(cacheKey(kind),JSON.stringify({at:Date.now(),value:value}));}catch(_e){}}
  function clearCached(kind){try{sessionStorage.removeItem(cacheKey(kind));}catch(_e){}}
  function sectionsOf(snapshot){return snapshot&&((snapshot.pages&&snapshot.pages.distribution&&snapshot.pages.distribution.sections)||snapshot.sections)||null;}
  function normalizeList(raw){return Array.isArray(raw)?raw:(raw&&Array.isArray(raw.slots)?raw.slots:[]);}
  function clone(value){try{return JSON.parse(JSON.stringify(value));}catch(_e){return value;}}
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
      section:pick(item,['section','psom_key']),
      listingHealth:item.listingHealth||null
    };
  }
  function compactSnapshot(snapshot){
    const source=sectionsOf(snapshot);
    if(!source) return null;
    const sections={};
    SECTION_MAP.forEach(function(cfg){
      const raw=source[cfg.key]||source[ALIAS[cfg.key]];
      sections[cfg.key]=normalizeList(raw).slice(0,cfg.limit).map(function(item){
        const card=compactItem(item);
        if(!card.section) card.section=cfg.key;
        return card;
      });
    });
    return {pages:{distribution:{sections:sections}},meta:Object.assign({},snapshot&&snapshot.meta||{},{
      compact:true,
      regionalBrokerage:!!(snapshot&&snapshot.meta&&snapshot.meta.regionalBrokerage)
    })};
  }
  function seedSnapshot(){
    const sections={};
    SECTION_MAP.forEach(function(cfg){
      const list=[];
      for(let i=0;i<INITIAL_SEED_PER_SECTION;i++){
        list.push({
          id:'distribution-seed-'+cfg.key+'-'+(i+1),
          title:cfg.label+' '+(i+1),
          meta:'',
          thumb:PLACEHOLDER_IMG,
          image:PLACEHOLDER_IMG,
          url:'#',
          section:cfg.key,
          localSeed:true
        });
      }
      sections[cfg.key]=list;
    });
    return {pages:{distribution:{sections:sections}},meta:{localSeed:true,generatedAt:'local-seed-v7'}};
  }
  const LOCAL_SEED=seedSnapshot();

  function track(item,kind){
    try{
      if(window.MaruRevenueTracker&&typeof window.MaruRevenueTracker[kind]==='function'){
        window.MaruRevenueTracker[kind](item,{service:'distributionhub',pageType:'distribution',page:'distribution',section:item.section||item.psom_key||null,revenueLine:'product_affiliate'});
      }
    }catch(_e){}
  }
  function makeCard(item){
    const root=document.createElement('div');
    root.className='thumb-card';
    if(item&&item.localSeed){root.classList.add('thumb-card--seed');root.setAttribute('aria-busy','true');}
    const img=document.createElement('div');
    img.className='thumb-img';
    const image=pick(item,['thumb','thumbnail','image','imageUrl','thumbnailUrl'])||PLACEHOLDER_IMG;
    img.style.backgroundImage="url('"+escUrl(image)+"')";
    img.style.backgroundSize='cover';
    img.style.backgroundPosition='center';
    const title=document.createElement('div');
    title.className='thumb-title';
    title.textContent=text(pick(item,['title','name','text'])||'Product');
    const meta=document.createElement('div');
    meta.className='thumb-meta';
    meta.textContent=text(pick(item,['meta','subtitle','summary','description']));
    root.appendChild(img);
    root.appendChild(title);
    root.appendChild(meta);
    const href=pick(item,['url','href','link']);
    if(href&&href!=='#'){
      root.style.cursor='pointer';
      root.setAttribute('role','link');
      root.tabIndex=0;
      const open=function(){track(item,'trackClick');window.location.assign(href);};
      root.addEventListener('click',open);
      root.addEventListener('keydown',function(event){
        if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}
      });
      track(item,'trackImpression');
    }
    return root;
  }
  function addHash(hash,value){
    const input=text(value);
    for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return hash;
  }
  function fingerprint(snapshot){
    try{
      const sections=sectionsOf(snapshot)||{};
      let hash=2166136261;
      const meta=snapshot&&snapshot.meta||{};
      hash=addHash(hash,meta.generatedAt||meta.snapshotRevision||meta.version||'');
      SECTION_MAP.forEach(function(cfg){
        hash=addHash(hash,cfg.key);
        normalizeList(sections[cfg.key]||sections[ALIAS[cfg.key]]).forEach(function(item){
          hash=addHash(hash,[pick(item,['id','uid','productId','contentId']),pick(item,['title','name','text']),pick(item,['meta','subtitle','summary','description']),pick(item,['thumb','thumbnail','image','imageUrl']),pick(item,['url','href','link'])].join('\u001f'));
        });
      });
      return (hash>>>0).toString(16);
    }catch(_e){return '';}
  }
  function controlHosts(){
    SECTION_MAP.forEach(function(cfg){
      const box=document.querySelector(cfg.selector);
      if(box){
        // thumbnail-loader.compat.min.js honours the controlled owner flag.
        box.dataset.mounted='1';
        box.dataset.distributionAutomap='v7';
      }
    });
  }
  function replaceChildren(box,fragment){
    if(typeof box.replaceChildren==='function'){box.replaceChildren(fragment);return;}
    while(box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(fragment);
  }
  function mergedSnapshot(){
    const base=compactSnapshot(baseSnapshot)||LOCAL_SEED;
    const regional=compactSnapshot(regionalSnapshot);
    if(!regional||!(regional.meta&&regional.meta.regionalBrokerage)) return base;
    const merged=clone(base);
    const target=sectionsOf(merged);
    const incoming=sectionsOf(regional);
    if(!target||!incoming) return base;
    SECTION_MAP.forEach(function(cfg){
      const list=normalizeList(incoming[cfg.key]||incoming[ALIAS[cfg.key]]);
      // Empty regional sections never erase the last verified public snapshot.
      if(list.length) target[cfg.key]=list.slice(0,cfg.limit);
    });
    merged.meta=Object.assign({},base.meta||{},regional.meta||{},{regionalBrokerage:true,mergedFallback:true});
    return merged;
  }
  function nextFrame(task){
    if(typeof window.requestAnimationFrame==='function') window.requestAnimationFrame(task);
    else setTimeout(task,16);
  }
  function render(){
    const snapshot=mergedSnapshot();
    const sections=sectionsOf(snapshot);
    if(!sections) return false;
    const key=fingerprint(snapshot);
    if(key&&key===activeFingerprint) return false;
    activeFingerprint=key;
    controlHosts();

    // Commit one completed section per frame so a large snapshot never freezes the hub.
    const generation=++renderGeneration;
    let cursor=0;
    const commitNext=function(){
      if(generation!==renderGeneration) return;
      while(cursor<SECTION_MAP.length){
        const cfg=SECTION_MAP[cursor++];
        const box=document.querySelector(cfg.selector);
        if(!box) continue;
        const list=normalizeList(sections[cfg.key]||sections[ALIAS[cfg.key]]).slice(0,cfg.limit);
        // Preserve the last visible section if an incoming payload is partial.
        if(!list.length) continue;
        const fragment=document.createDocumentFragment();
        list.forEach(function(item){fragment.appendChild(makeCard(item));});
        if(generation!==renderGeneration) return;
        replaceChildren(box,fragment);
        nextFrame(commitNext);
        return;
      }
    };
    commitNext();
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
    }finally{if(timer) clearTimeout(timer);}
  }
  function idle(task,delay){
    const run=function(){
      if(typeof window.requestIdleCallback==='function') window.requestIdleCallback(task,{timeout:1800});
      else setTimeout(task,0);
    };
    setTimeout(run,Math.max(0,delay||0));
  }
  function refreshStatic(force){
    if(staticRefreshInFlight) return Promise.resolve();
    if(!force&&lastStaticRefreshAt&&Date.now()-lastStaticRefreshAt<STATIC_REVALIDATE_TTL) return Promise.resolve();
    staticRefreshInFlight=true;
    lastStaticRefreshAt=Date.now();
    return fetchJson(STATIC_SNAPSHOT_URL,STATIC_TIMEOUT,'no-cache').then(function(snapshot){
      const compact=compactSnapshot(snapshot);
      if(!compact) return;
      baseSnapshot=compact;
      setCached('static',compact);
      render();
    }).catch(function(){/* Existing seed, cache, or verified regional cards stay visible. */}).finally(function(){staticRefreshInFlight=false;});
  }
  function refreshRegional(){
    if(regionalRefreshInFlight) return Promise.resolve();
    if(getCached('regional-no-result',NO_RESULT_TTL)||getCached('regional-error',TRANSIENT_ERROR_TTL)) return Promise.resolve();
    regionalRefreshInFlight=true;
    return fetchJson(REGIONAL_SNAPSHOT_URL,REGIONAL_TIMEOUT,'no-store').then(function(snapshot){
      const compact=compactSnapshot(snapshot);
      if(compact&&compact.meta&&compact.meta.regionalBrokerage===true){
        regionalSnapshot=compact;
        setCached('regional',compact);
        clearCached('regional-no-result');
        clearCached('regional-error');
        render();
      }else{
        // A true no-result is cooled down; it never clears visible verified cards.
        setCached('regional-no-result',{at:Date.now()});
      }
    }).catch(function(){
      // Temporary Netlify/Sanmaru errors are retried sooner than a confirmed no-result.
      setCached('regional-error',{at:Date.now()});
    }).finally(function(){regionalRefreshInFlight=false;});
  }
  function boot(){
    controlHosts();
    const cachedStatic=getCached('static',STATIC_TTL);
    const cachedRegional=getCached('regional',REGIONAL_TTL);
    baseSnapshot=cachedStatic||LOCAL_SEED;
    regionalSnapshot=cachedRegional||null;
    render();

    // No network wait is allowed before a visible first paint.
    idle(function(){refreshStatic(false);},STATIC_DELAY);
    // Sanmaru-backed discovery runs only after the hub has settled.
    if(!cachedRegional) idle(refreshRegional,REGIONAL_DELAY);

    document.addEventListener('visibilitychange',function(){
      if(document.hidden===false){
        idle(function(){refreshStatic(false);},STATIC_DELAY);
        if(!getCached('regional',REGIONAL_TTL)) idle(refreshRegional,REGIONAL_DELAY);
      }
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();

/* Revenue support remains non-blocking and does not control slot rendering. */
(function loadMaruRevenueTracker(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined') return;
  const id='maruRevenueTrackerScript';
  if(window.MaruRevenueTracker||document.getElementById(id)) return;
  const script=document.createElement('script');
  script.id=id;
  script.src='/assets/js/maru-revenue-tracker.js';
  script.async=true;
  (document.head||document.documentElement).appendChild(script);
})();
