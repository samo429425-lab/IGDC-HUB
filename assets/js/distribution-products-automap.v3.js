// distribution-products-automap.v3.js
// IGDC/MARU Distribution Hub: immediate local first paint + safely merged verified snapshots.
//
// Display contract:
// - Never leave the visitor with a blank hub while data is loading.
// - Reuse the most recent same-session view immediately, then revalidate safely.
// - Prefer a verified regional snapshot, but never replace a visible valid view
//   with an error, an empty response, or an older snapshot.
// - Recheck a no-result or transient failure soon; do not impose a long cooldown.
// - Only this renderer owns Distribution Hub PSOM slots.
// - A partial regional response overlays only the sections it actually contains.
(function(){
  'use strict';
  if(window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V8__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V8__=true;

  const STATIC_SNAPSHOT_URL='/data/distribution.snapshot.json';
  const REGIONAL_SNAPSHOT_URL='/.netlify/functions/regional-brokerage-snapshot?hub=distribution';
  const LIMIT_MAIN=100, LIMIT_RIGHT=100;

  // Cached content is only the instant first view. Every return visit revalidates
  // the public snapshot without delaying the visible page.
  const STATIC_CACHE_TTL=10*60*1000;
  const REGIONAL_CACHE_TTL=5*60*1000;
  const REGIONAL_SUCCESS_RECHECK_TTL=2*60*1000;
  const REGIONAL_EMPTY_RECHECK_TTL=90*1000;
  const REGIONAL_FAILURE_RECHECK_TTL=45*1000;
  const REGIONAL_REFRESH_DELAY=1400;
  const INITIAL_SEED_PER_SECTION=8;
  const STATIC_TIMEOUT=12000;
  const REGIONAL_TIMEOUT=8500;
  const CACHE_PREFIX='igdc:distribution:instant-render:v5:';

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
  let activePriority=-1;
  let activeFingerprint='';
  let activeStamp=0;
  // Keep the full public snapshot and the regional overlay separately.
  // A partial regional payload must never hide unrelated verified sections.
  let baseSnapshot=null;
  let regionalSnapshot=null;
  let regionalRefreshInFlight=false;
  let regionalFollowUpScheduled=false;
  let regionalRetryCount=0;
  let renderGeneration=0;

  function text(v){return v==null?'':String(v);}
  function pick(item,names){for(const name of names){const value=item&&item[name];if(value!==undefined&&value!==null&&value!=='')return value;}return '';}
  function escUrl(v){try{return String(v||'').replace(/'/g,'%27');}catch(_e){return '';}}
  function revenue(item,kind){
    try{
      if(window.MaruRevenueTracker&&typeof window.MaruRevenueTracker[kind]==='function'){
        const affiliateReady=!!(item&&item.affiliateOutboundUrl)||!!(item&&item.affiliate&&item.affiliate.eligible===true);
        window.MaruRevenueTracker[kind](item,{
          service:'distributionhub-regional-brokerage',pageType:'distribution',page:'distribution',
          section:item.section||item.psom_key||null,
          // Only an explicitly approved provider route is an affiliate signal.
          // Seller visits without a provider contract remain non-cash traffic signals.
          revenueLine:affiliateReady?'product_affiliate':'external_seller_visit'
        });
      }
    }catch(_e){}
  }
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
  function clearCached(kind){try{sessionStorage.removeItem(cacheKey(kind));}catch(_e){}}
  function sectionsOf(snapshot){
    return snapshot&&((snapshot.pages&&snapshot.pages.distribution&&snapshot.pages.distribution.sections)||snapshot.sections)||null;
  }
  function normalizeList(raw){return Array.isArray(raw)?raw:(raw&&Array.isArray(raw.slots)?raw.slots:[]);}
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
      url:pick(item,['affiliateOutboundUrl','affiliate_outbound_url','url','href','link']),
      href:pick(item,['affiliateOutboundUrl','affiliate_outbound_url','href','url','link']),
      link:pick(item,['affiliateOutboundUrl','affiliate_outbound_url','link','url','href']),
      affiliateOutboundUrl:pick(item,['affiliateOutboundUrl','affiliate_outbound_url']),
      affiliate:item&&item.affiliate&&typeof item.affiliate==='object'?item.affiliate:null,
      trackId:pick(item,['trackId','track_id']) || pick(item,['id','uid','productId','contentId']),
      revenueLine:pick(item,['revenueLine','revenue_line']),
      price:pick(item,['price','salePrice','amount']),
      currency:pick(item,['currency','ccy']),
      section:pick(item,['section','psom_key'])
    };
  }
  function compactSnapshot(snapshot,networkMeta){
    const source=sectionsOf(snapshot); if(!source) return null;
    const sections={};
    SECTION_MAP.forEach(function(cfg){
      const raw=source[cfg.key]||source[ALIAS[cfg.key]];
      sections[cfg.key]=normalizeList(raw).slice(0,cfg.limit).map(function(item){
        const compact=compactItem(item);
        if(!compact.section) compact.section=cfg.key;
        return compact;
      });
    });
    const rawMeta=snapshot&&snapshot.meta||{};
    return {pages:{distribution:{sections:sections}},meta:{
      regionalBrokerage:rawMeta.regionalBrokerage===true,
      generatedAt:rawMeta.generatedAt||'',
      targetMarket:rawMeta.targetMarket||'',
      targetRegion:rawMeta.targetRegion||'',
      snapshotRevision:rawMeta.snapshotRevision||rawMeta.revision||rawMeta.version||rawMeta.contentHash||'',
      etag:networkMeta&&networkMeta.etag||'',
      compact:true
    }};
  }
  // Local seed cards are used only when the server HTML has no visible cards.


  function makeCard(item,track){
    const root=document.createElement('div'); root.className='thumb-card';
    // This renderer already emits its own exact tracker calls. Keep the global
    // autohook from duplicating the same signals on Distribution Hub cards.
    root.setAttribute('data-igdc-revenue-manual','1');
    if(item&&item.id) root.setAttribute('data-item-id',text(item.id));
    if(item&&item.trackId) root.setAttribute('data-track-id',text(item.trackId));
    if(item&&item.section) root.setAttribute('data-section',text(item.section));
    if(item&&item.affiliateOutboundUrl) root.setAttribute('data-affiliate-outbound','1');
    const img=document.createElement('div'); img.className='thumb-img';
    const image=pick(item,['thumb','thumbnail','image','imageUrl','thumbnailUrl']);
    if(image){
      img.style.backgroundImage="url('"+escUrl(image)+"')";
      img.style.backgroundSize='cover'; img.style.backgroundPosition='center';
    }
    const title=document.createElement('div'); title.className='thumb-title'; title.textContent=text(pick(item,['title','name','text'])||'Product');
    const meta=document.createElement('div'); meta.className='thumb-meta'; meta.textContent=text(pick(item,['meta','subtitle','summary','description']));
    root.appendChild(img); root.appendChild(title); root.appendChild(meta);
    const href=pick(item,['url','href','link']);
    if(href&&href!=='#'){
      root.style.cursor='pointer'; root.setAttribute('role','link'); root.tabIndex=0;
      const open=function(){
        revenue(item,'trackClick');
        window.location.assign(href);
      };
      root.addEventListener('click',open);
      root.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    }
    if(track!==false) revenue(item,'trackImpression');
    return root;
  }
  function addHash(hash,value){
    const input=text(value);
    for(let i=0;i<input.length;i++){
      hash^=input.charCodeAt(i);
      hash=Math.imul(hash,16777619);
    }
    return hash;
  }
  function fingerprint(snapshot,kind){
    try{
      const meta=snapshot&&snapshot.meta||{};
      const sections=sectionsOf(snapshot)||{};
      let hash=2166136261;
      hash=addHash(hash,kind||'');
      hash=addHash(hash,meta.snapshotRevision||meta.revision||meta.version||'');
      hash=addHash(hash,meta.generatedAt||'');
      hash=addHash(hash,meta.targetMarket||'');
      hash=addHash(hash,meta.targetRegion||'');
      SECTION_MAP.forEach(function(cfg){
        const list=normalizeList(sections[cfg.key]||sections[ALIAS[cfg.key]]);
        hash=addHash(hash,cfg.key+':'+list.length+'|');
        list.forEach(function(item){
          hash=addHash(hash,[pick(item,['id','uid','productId','contentId']),pick(item,['title','name','text']),pick(item,['meta','subtitle','summary','description']),pick(item,['thumb','thumbnail','image','imageUrl']),pick(item,['url','href','link'])].join('\u001f'));
        });
      });
      return (hash>>>0).toString(16);
    }catch(_e){return '';}
  }
  function cloneSnapshot(value){
    try{return JSON.parse(JSON.stringify(value));}catch(_e){return value;}
  }
  function mergedSnapshot(){
    const base=baseSnapshot;
    const regional=regionalSnapshot;
    if(!base) return regional;
    if(!regional||!(regional.meta&&regional.meta.regionalBrokerage===true)) return base;

    const merged=cloneSnapshot(base);
    const target=sectionsOf(merged);
    const incoming=sectionsOf(regional);
    if(!target||!incoming) return base;

    SECTION_MAP.forEach(function(cfg){
      const regionalList=normalizeList(incoming[cfg.key]||incoming[ALIAS[cfg.key]]).slice(0,cfg.limit);
      // Regional supply may be intentionally partial. Only a non-empty verified
      // regional section replaces its matching public section; every other
      // visible section remains on the last valid public snapshot.
      if(regionalList.length) target[cfg.key]=regionalList;
    });
    merged.meta=Object.assign({},base.meta||{},regional.meta||{}, {
      regionalBrokerage:true,
      mergedRegionalOverlay:true
    });
    return merged;
  }
  function renderMerged(){
    const snapshot=mergedSnapshot();
    if(!snapshot) return false;
    return render(snapshot,regionalSnapshot?3:2,'merged');
  }
  function snapshotStamp(snapshot){
    try{
      const raw=snapshot&&snapshot.meta&&snapshot.meta.generatedAt;
      const stamp=raw?Date.parse(raw):0;
      return Number.isFinite(stamp)&&stamp>0?stamp:0;
    }catch(_e){return 0;}
  }
  function controlHosts(){
    SECTION_MAP.forEach(function(cfg){
      const box=document.querySelector(cfg.selector);
      if(box){
        // thumbnail-loader.compat.min.js honours this flag on Distribution Hub.
        // It must not append a late network feed after this renderer owns the slots.
        box.dataset.mounted='1';
        box.dataset.distributionAutomap='v8';
      }
    });
  }
  function makeSeedCard(cfg,index){
    const item={
      id:'distribution-seed-'+cfg.key+'-'+(index+1),
      title:cfg.label+' '+(index+1),
      meta:'',
      section:cfg.key,
      url:'#'
    };
    const card=makeCard(item,false);
    card.classList.add('thumb-card--seed');
    card.setAttribute('aria-busy','true');
    return card;
  }
  function seedInitialView(){
    // The HTML starts with empty hosts. Build only the immediately useful cards
    // locally so slow networks never leave the hub blank while the full snapshot
    // is downloading. Verified data always replaces these cards later.
    SECTION_MAP.forEach(function(cfg){
      const box=document.querySelector(cfg.selector);
      if(!box||box.children.length) return;
      const fragment=document.createDocumentFragment();
      for(let i=0;i<INITIAL_SEED_PER_SECTION;i++) fragment.appendChild(makeSeedCard(cfg,i));
      box.appendChild(fragment);
    });
  }
  function replaceChildren(box,fragment){
    if(typeof box.replaceChildren==='function'){box.replaceChildren(fragment);return;}
    while(box.firstChild)box.removeChild(box.firstChild); box.appendChild(fragment);
  }
  function nextFrame(task){
    if(typeof window.requestAnimationFrame==='function') window.requestAnimationFrame(task);
    else setTimeout(task,16);
  }
  function shouldRender(snapshot,priority,kind){
    const key=fingerprint(snapshot,kind);
    if(key&&key===activeFingerprint) return false;
    // A verified regional result is more specific than a generic static snapshot.
    // Static data may fill an empty page, but may never displace a visible regional view.
    if(priority<activePriority) return false;
    return true;
  }
  function render(snapshot,priority,kind){
    const sections=sectionsOf(snapshot);
    if(!sections||!shouldRender(snapshot,priority,kind)) return false;

    // Rendering 700 cards in one task can delay the first usable screen on
    // slower devices. Commit a completed section per frame and keep the last
    // valid cards in every other section until its replacement is ready.
    const generation=++renderGeneration;
    const nextFingerprint=fingerprint(snapshot,kind);
    activePriority=priority;
    activeFingerprint=nextFingerprint;
    activeStamp=snapshotStamp(snapshot);
    controlHosts();

    let cursor=0;
    const commitNext=function(){
      if(generation!==renderGeneration) return;
      while(cursor<SECTION_MAP.length){
        const cfg=SECTION_MAP[cursor++];
        const box=document.querySelector(cfg.selector);
        if(!box) continue;
        const raw=sections[cfg.key]||sections[ALIAS[cfg.key]];
        const list=normalizeList(raw).slice(0,cfg.limit);
        // A partial/empty response must never erase the last valid visible section.
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
      const etag=response.headers&&typeof response.headers.get==='function'?response.headers.get('etag')||'':'';
      if(response.status===204) return {empty:true,status:204,etag:etag,payload:null};
      if(!response.ok) throw new Error('HTTP '+response.status);
      return {empty:false,status:response.status,etag:etag,payload:await response.json()};
    }finally{if(timer)clearTimeout(timer);}
  }
  function idle(task,delay){
    const run=function(){
      if(typeof window.requestIdleCallback==='function') window.requestIdleCallback(task,{timeout:1800});
      else setTimeout(task,0);
    };
    setTimeout(run,Math.max(0,delay||0));
  }
  function getRegionalStatus(){
    const row=getCached('regional-status',REGIONAL_CACHE_TTL);
    if(!row||!row.value||typeof row.value!=='object') return null;
    const value=row.value;
    if(!value.retryAt||Date.now()>=value.retryAt){clearCached('regional-status');return null;}
    return value;
  }
  function setRegionalStatus(state,waitMs){
    setCached('regional-status',{state:state,retryAt:Date.now()+waitMs});
  }
  function canRefreshRegional(){return !regionalRefreshInFlight&&!getRegionalStatus();}
  function nextRegionalRetryDelay(state){
    regionalRetryCount=Math.min(regionalRetryCount+1,4);
    const base=state==='failure'?REGIONAL_FAILURE_RECHECK_TTL:REGIONAL_EMPTY_RECHECK_TTL;
    return Math.min(5*60*1000,base*Math.pow(2,regionalRetryCount-1));
  }
  function scheduleSingleRegionalFollowUp(waitMs){
    if(regionalFollowUpScheduled) return;
    regionalFollowUpScheduled=true;
    setTimeout(function(){
      regionalFollowUpScheduled=false;
      if(document.hidden===true) return;
      if(canRefreshRegional()) refreshRegional();
    },waitMs+150);
  }
  function refreshStatic(){
    return fetchJson(STATIC_SNAPSHOT_URL,STATIC_TIMEOUT,'no-cache').then(function(result){
      if(result.empty||!result.payload) return;
      const compact=compactSnapshot(result.payload,{etag:result.etag}); if(!compact) return;
      baseSnapshot=compact;
      setCached('static',compact);
      renderMerged();
    }).catch(function(){/* Existing visible cards or same-session cache stay visible. */});
  }
  function refreshRegional(){
    if(!canRefreshRegional()) return Promise.resolve(false);
    regionalRefreshInFlight=true;
    return fetchJson(REGIONAL_SNAPSHOT_URL,REGIONAL_TIMEOUT,'no-store').then(function(result){
      if(result.empty||!result.payload){
        const waitMs=nextRegionalRetryDelay('empty');
        setRegionalStatus('empty',waitMs);
        scheduleSingleRegionalFollowUp(waitMs);
        return false;
      }
      const raw=result.payload;
      if(raw&&raw.meta&&raw.meta.regionalBrokerage===true){
        const compact=compactSnapshot(raw,{etag:result.etag});
        if(compact){
          regionalSnapshot=compact;
          setCached('regional',compact);
          regionalRetryCount=0;
          setRegionalStatus('success',REGIONAL_SUCCESS_RECHECK_TTL);
          renderMerged();
          scheduleSingleRegionalFollowUp(REGIONAL_SUCCESS_RECHECK_TTL);
          return true;
        }
      }
      const waitMs=nextRegionalRetryDelay('empty');
      setRegionalStatus('empty',waitMs);
      scheduleSingleRegionalFollowUp(waitMs);
      return false;
    }).catch(function(){
      const waitMs=nextRegionalRetryDelay('failure');
      setRegionalStatus('failure',waitMs);
      scheduleSingleRegionalFollowUp(waitMs);
      return false;
    }).finally(function(){regionalRefreshInFlight=false;});
  }
  function boot(){
    controlHosts();
    const regional=getCached('regional',REGIONAL_CACHE_TTL);
    const statik=getCached('static',STATIC_CACHE_TTL);
    baseSnapshot=statik&&statik.value||null;
    regionalSnapshot=regional&&regional.value||null;
    if(!renderMerged()) seedInitialView();

    // Start the public snapshot request on the next paint, not during an idle
    // window. The request remains non-blocking, while the local seed keeps the
    // page immediately usable on a slow connection.
    nextFrame(function(){refreshStatic();});
    idle(refreshRegional,REGIONAL_REFRESH_DELAY);

    document.addEventListener('visibilitychange',function(){
      if(document.hidden===false){
        nextFrame(function(){refreshStatic();});
        if(canRefreshRegional()) idle(refreshRegional,REGIONAL_REFRESH_DELAY);
      }
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();

/* Revenue support remains non-blocking and does not control slot rendering. */
(function loadMaruRevenueAutoHookForAutomap(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined')return;
  function installIfReady(){
    try{
      if(window.MaruRevenueAutoHook&&typeof window.MaruRevenueAutoHook.install==='function'){
        window.MaruRevenueAutoHook.install({service:'front-automap'});
      }
    }catch(_e){}
  }
  function loadScriptOnce(src,id,globalName,done){
    const existing=document.getElementById(id);
    if(window[globalName]){if(typeof done==='function')done();return;}
    if(existing){
      existing.addEventListener('load',function(){if(typeof done==='function')done();},{once:true});
      return;
    }
    const script=document.createElement('script');
    script.id=id;script.src=src;script.async=false;
    script.onload=function(){if(typeof done==='function')done();};
    (document.head||document.documentElement).appendChild(script);
  }
  if(window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__){installIfReady();return;}
  window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__=true;
  loadScriptOnce('/assets/js/maru-revenue-tracker.js','maruRevenueTrackerScript','MaruRevenueTracker',function(){
    loadScriptOnce('/assets/js/maru-revenue-autohook.js','maruRevenueAutoHookScript','MaruRevenueAutoHook',installIfReady);
  });
})();
