// distribution-products-automap.v3.js
// IGDC/MARU Distribution Hub: regional brokerage snapshot first, static snapshot safe fallback.
(function(){
  'use strict';
  if(window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V3__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V3__=true;

  const STATIC_SNAPSHOT_URL='/data/distribution.snapshot.json';
  const REGIONAL_SNAPSHOT_URL='/.netlify/functions/regional-brokerage-snapshot?hub=distribution';
  const LIMIT_MAIN=100, LIMIT_RIGHT=100;
  const SECTION_MAP=[
    {key:'distribution-recommend',selector:'[data-psom-key="distribution-recommend"]',limit:LIMIT_MAIN},
    {key:'distribution-new',selector:'[data-psom-key="distribution-new"]',limit:LIMIT_MAIN},
    {key:'distribution-trending',selector:'[data-psom-key="distribution-trending"]',limit:LIMIT_MAIN},
    {key:'distribution-special',selector:'[data-psom-key="distribution-special"]',limit:LIMIT_MAIN},
    {key:'distribution-sponsor',selector:'[data-psom-key="distribution-sponsor"]',limit:LIMIT_MAIN},
    {key:'distribution-others',selector:'[data-psom-key="distribution-others"]',limit:LIMIT_MAIN},
    {key:'distribution-right',selector:'[data-psom-key="distribution-right"]',limit:LIMIT_RIGHT}
  ];
  const ALIAS={'distribution-recommend':'distribution_1','distribution-new':'distribution_2','distribution-trending':'distribution_3','distribution-special':'distribution_4','distribution-sponsor':'distribution_5','distribution-others':'distribution_6','distribution-right':'distribution_7'};
  let rendered=false;
  function escUrl(v){try{return String(v||'').replace(/'/g,'%27');}catch(_e){return '';}}
  function text(v){return v==null?'':String(v);}
  function pick(item,names){for(const name of names){const value=item&&item[name];if(value)return value;}return '';}
  function sectionsOf(snapshot){return snapshot&&(snapshot.pages&&snapshot.pages.distribution&&snapshot.pages.distribution.sections||snapshot.sections)||null;}
  function revenue(item,kind){try{if(window.MaruRevenueTracker&&typeof window.MaruRevenueTracker[kind]==='function'){window.MaruRevenueTracker[kind](item,{service:'distributionhub-regional-brokerage',pageType:'distribution',page:'distribution',section:item.section||item.psom_key||null,revenueLine:'product_affiliate'});}}catch(_e){}}
  function card(item){
    const root=document.createElement('div');root.className='thumb-card';
    const img=document.createElement('div');img.className='thumb-img';
    const image=pick(item,['thumb','thumbnail','image','imageUrl','thumbnailUrl']);if(image){img.style.backgroundImage="url('"+escUrl(image)+"')";img.style.backgroundSize='cover';img.style.backgroundPosition='center';}
    const title=document.createElement('div');title.className='thumb-title';title.textContent=text(pick(item,['title','name','text'])||'Product');
    const meta=document.createElement('div');meta.className='thumb-meta';meta.textContent=text(pick(item,['meta','subtitle','summary','description']));
    root.appendChild(img);root.appendChild(title);root.appendChild(meta);
    const href=pick(item,['url','href','link']);if(href&&href!=='#'){
      root.style.cursor='pointer';root.setAttribute('role','link');root.tabIndex=0;
      const open=function(){revenue(item,'trackClick');window.location.assign(href);};
      root.addEventListener('click',open);root.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    }
    revenue(item,'trackImpression');return root;
  }
  async function fetchJson(url,timeout){
    const controller=typeof AbortController!=='undefined'?new AbortController():null;
    const timer=controller?setTimeout(function(){controller.abort();},timeout):null;
    try{const r=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller&&controller.signal});if(r.status===204)throw new Error('empty');if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}finally{if(timer)clearTimeout(timer);}
  }
  async function loadSnapshot(){
    try{const regional=await fetchJson(REGIONAL_SNAPSHOT_URL,8500);if(regional&&regional.meta&&regional.meta.regionalBrokerage===true&&sectionsOf(regional))return regional;}catch(_e){}
    return fetchJson(STATIC_SNAPSHOT_URL,5000);
  }
  function render(sections,dynamic){
    if(rendered||!sections)return;
    SECTION_MAP.forEach(function(cfg){const box=document.querySelector(cfg.selector);if(!box)return;const raw=sections[cfg.key]||sections[ALIAS[cfg.key]];const list=Array.isArray(raw)?raw:(raw&&Array.isArray(raw.slots)?raw.slots:[]);while(box.firstChild)box.removeChild(box.firstChild);list.slice(0,cfg.limit).forEach(function(item){box.appendChild(card(item));});if(!dynamic&&list.length===0){/* preserve existing empty-state layout without fabricating product cards */}});
    rendered=true;
  }
  (async function(){try{const snapshot=await loadSnapshot();render(sectionsOf(snapshot),!!(snapshot&&snapshot.meta&&snapshot.meta.regionalBrokerage));}catch(e){console.error('[Distribution AutoMap] snapshot unavailable',e);}})();
})();
