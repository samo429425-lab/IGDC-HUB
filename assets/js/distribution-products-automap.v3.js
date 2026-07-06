// distribution-products-automap.v3.js
// IGDC/MARU Distribution Hub: immediate local first paint + safely merged verified snapshots.
//
// Display contract:
// - Canonical IP snapshot only: no seed cards, session cache or generic feed may
//   fill a product slot before the same-country snapshot is selected.
// - An unresolved IP scope stays empty rather than falling back across country or
//   to a global catalog.
// - Only this renderer owns Distribution Hub PSOM slots.
// - A partial regional response overlays only the sections it actually contains.
(function(){
  'use strict';
  if(window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V8__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V8__=true;

  const STATIC_SNAPSHOT_URL='/data/distribution.snapshot.json';
  const REGIONAL_SNAPSHOT_URL=''; // Edge-routed canonical snapshot is the only source.
  const LIMIT_MAIN=100, LIMIT_RIGHT=100;

  // Cached content is only the instant first view. Every return visit revalidates
  // the public snapshot without delaying the visible page.
  const STATIC_CACHE_TTL=10*60*1000;
  const REGIONAL_CACHE_TTL=5*60*1000;
  const REGIONAL_SUCCESS_RECHECK_TTL=2*60*1000;
  const REGIONAL_EMPTY_RECHECK_TTL=90*1000;
  const REGIONAL_FAILURE_RECHECK_TTL=45*1000;
  const REGIONAL_REFRESH_DELAY=1400;
  const INITIAL_SEED_PER_SECTION=0;
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
  function hasUsableDestination(value){const url=text(value).trim();return !!url&&url!=='#'&&!/^javascript:/i.test(url)&&!/\/pages\/coming-soon\.html/i.test(url)&&!/(?:^|\.)example\.com(?:[/:?#]|$)/i.test(url);}
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
      url:pick(item,['affiliateOutboundUrl','affiliate_outbound_url','externalOutboundUrl','external_outbound_url','url','href','link']),
      href:pick(item,['affiliateOutboundUrl','affiliate_outbound_url','externalOutboundUrl','external_outbound_url','href','url','link']),
      link:pick(item,['affiliateOutboundUrl','affiliate_outbound_url','externalOutboundUrl','external_outbound_url','link','url','href']),
      affiliateOutboundUrl:pick(item,['affiliateOutboundUrl','affiliate_outbound_url']),
      externalOutboundUrl:pick(item,['externalOutboundUrl','external_outbound_url']),
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
      compact:true,
      geoResolutionRequired:rawMeta.geoResolutionRequired===true,
      geoMatched:rawMeta.geoMatched===true,
      canonicalReleaseId:rawMeta.canonicalReleaseId||''
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
    if(item&&item.externalOutboundUrl) root.setAttribute('data-external-outbound','1');
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
    if(hasUsableDestination(href)){
      // Real product routes retain the renderer's original navigation path.
      root.dataset.igtcHooked='1';
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
    // Legacy no-op. IP-scoped surfaces must never synthesize placeholder cards.
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
        // A canonical IP gate deliberately returns an empty scope when no exact
        // same-country supply exists. Empty sections must therefore clear rather
        // than preserve a previous-country cache or a local seed.
        if(!list.length){
          if(snapshot&&snapshot.meta&&snapshot.meta.geoResolutionRequired===true){
            replaceChildren(box,document.createDocumentFragment());
          }
          continue;
        }
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
    // Deliberately disabled: the Edge-routed canonical snapshot already applies
    // the exact country/region scope. A second endpoint could reintroduce a
    // different selection contract or cross-scope overlay.
    return Promise.resolve(false);
  }
  function boot(){
    controlHosts();
    // Never restore session-cached product cards: an IP scope can change
    // between visits and a cached card has no request-time geo proof.
    baseSnapshot=null;
    regionalSnapshot=null;
    nextFrame(function(){refreshStatic();});
    document.addEventListener('visibilitychange',function(){
      if(document.hidden===false) nextFrame(function(){refreshStatic();});
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

/* IGDC Distribution Hub: pending-product entry bridge.
 * Scope: only [data-psom-key="distribution-*"] cards. Existing card layout,
 * snapshots, real destinations, section ownership and panel structure remain untouched.
 */
(function(){
  'use strict';
  if(window.__IGDC_DISTRIBUTION_PENDING_ENTRY_V1__) return;
  window.__IGDC_DISTRIBUTION_PENDING_ENTRY_V1__=true;

  function t(v){return v==null?'':String(v);}
  function lang(){var x=t(document.documentElement.lang||'en').toLowerCase().replace('_','-');if(x==='ko-kr')return'ko';if(x==='zh-cn')return'zh';if(x==='zh-tw'||x==='zh-hk')return'zht';return x.split('-')[0]||'en';}
  var C={
    ko:['상품 정보 준비 중','실제 상품 정보가 등록되면 이 자리에서 바로 상세 페이지로 연결됩니다.'],
    en:['Product information is being prepared','When the actual product is registered, this same place will open its detail page.'],
    ar:['يتم إعداد معلومات المنتج','عند تسجيل المنتج الفعلي، سيفتح هذا المكان صفحة التفاصيل مباشرة.'],
    bn:['পণ্যের তথ্য প্রস্তুত করা হচ্ছে','প্রকৃত পণ্য নিবন্ধিত হলে এখান থেকেই বিস্তারিত পৃষ্ঠা খুলবে।'],
    de:['Produktinformationen werden vorbereitet','Sobald das tatsächliche Produkt registriert ist, öffnet sich hier direkt die Detailseite.'],
    es:['La información del producto se está preparando','Cuando se registre el producto real, este mismo lugar abrirá su página de detalles.'],
    fa:['اطلاعات محصول در حال آماده‌سازی است','پس از ثبت محصول واقعی، صفحه جزئیات از همین‌جا باز می‌شود.'],
    fr:['Les informations sur le produit sont en préparation','Lorsque le produit réel sera enregistré, cette même zone ouvrira sa page de détail.'],
    hi:['उत्पाद जानकारी तैयार की जा रही है','वास्तविक उत्पाद दर्ज होने पर यहीं से उसका विवरण पृष्ठ खुलेगा।'],
    hu:['A termékinformáció előkészítés alatt áll','Amikor a tényleges termék regisztrálva lesz, innen közvetlenül megnyílik a részletező oldala.'],
    id:['Informasi produk sedang disiapkan','Saat produk sebenarnya terdaftar, halaman detailnya akan terbuka dari tempat yang sama.'],
    it:['Le informazioni sul prodotto sono in preparazione','Quando il prodotto reale sarà registrato, da qui si aprirà direttamente la pagina dei dettagli.'],
    ja:['商品情報を準備中です','実際の商品が登録されると、この場所から詳細ページが開きます。'],
    ms:['Maklumat produk sedang disediakan','Apabila produk sebenar didaftarkan, halaman butirannya akan dibuka dari tempat yang sama.'],
    nl:['Productinformatie wordt voorbereid','Wanneer het daadwerkelijke product is geregistreerd, opent hier de detailpagina.'],
    pl:['Informacje o produkcie są przygotowywane','Gdy właściwy produkt zostanie zarejestrowany, w tym miejscu otworzy się jego strona szczegółów.'],
    pt:['As informações do produto estão sendo preparadas','Quando o produto real for registrado, esta mesma área abrirá a página de detalhes.'],
    ru:['Информация о товаре готовится','Когда фактический товар будет зарегистрирован, здесь откроется его страница с подробностями.'],
    sv:['Produktinformationen förbereds','När den verkliga produkten är registrerad öppnas dess detaljsida här.'],
    sw:['Maelezo ya bidhaa yanaandaliwa','Bidhaa halisi itakaposajiliwa, ukurasa wake wa maelezo utafunguka hapa.'],
    ta:['தயாரிப்பு தகவல் தயாராகிக் கொண்டிருக்கிறது','உண்மையான தயாரிப்பு பதிவு செய்யப்பட்டவுடன், இதே இடத்தில் விவரப் பக்கம் திறக்கும்.'],
    th:['กำลังเตรียมข้อมูลสินค้า','เมื่อมีการลงทะเบียนสินค้าจริง หน้านี้จะเปิดรายละเอียดสินค้าในตำแหน่งเดิม'],
    tl:['Inihahanda ang impormasyon ng produkto','Kapag nairehistro ang aktuwal na produkto, bubuksan dito ang pahina ng detalye nito.'],
    tr:['Ürün bilgileri hazırlanıyor','Gerçek ürün kaydedildiğinde ayrıntı sayfası aynı yerden açılır.'],
    uk:['Інформація про товар готується','Коли фактичний товар буде зареєстровано, тут відкриється його сторінка з деталями.'],
    ur:['مصنوعات کی معلومات تیار کی جا رہی ہیں','اصل مصنوعہ درج ہونے پر اسی جگہ سے تفصیلی صفحہ کھل جائے گا۔'],
    uz:['Mahsulot ma’lumoti tayyorlanmoqda','Haqiqiy mahsulot ro‘yxatdan o‘tganda, shu joydan uning batafsil sahifasi ochiladi.'],
    vi:['Thông tin sản phẩm đang được chuẩn bị','Khi sản phẩm thực được đăng ký, trang chi tiết sẽ mở ngay tại đây.'],
    zh:['商品信息正在准备中','实际商品登记后，将从此处直接打开详情页。'],
    zht:['商品資訊準備中','實際商品登錄後，將從這裡直接開啟詳細頁面。']
  };
  function isReal(v){v=t(v).trim();return !!v&&v!=='#'&&!/^javascript:/i.test(v)&&!/\/pages\/coming-soon\.html/i.test(v)&&!/(?:^|\.)example\.com(?:[/:?#]|$)/i.test(v);}
  function actual(card){
    if(card.getAttribute('role')==='link')return true;
    var a=card.querySelector('a[href]'),v=a&&a.getAttribute('href');
    if(isReal(v))return true;
    return ['data-url','data-href','data-link','data-product-url','data-product-link','data-detail-url','data-content-url','data-affiliate-outbound-url'].some(function(n){return isReal(card.getAttribute(n));});
  }
  var state={open:false,pushed:false,last:null};
  function ensure(){
    var root=document.getElementById('igdcDistributionPendingEntry');if(root)return root;
    var st=document.createElement('style');st.id='igdcDistributionPendingEntryStyle';st.textContent=''
      +'#igdcDistributionPendingEntry{position:fixed;inset:0;z-index:2147483550;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.48)}'
      +'#igdcDistributionPendingEntry.open{display:flex}'
      +'#igdcDistributionPendingEntry .igdc-pending-sheet{width:min(680px,96vw);max-height:min(76vh,720px);overflow:auto;background:#0b0c0f;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 18px 46px rgba(0,0,0,.55)}'
      +'#igdcDistributionPendingEntry header{padding:15px 17px;border-bottom:1px solid rgba(255,255,255,.12)}'
      +'#igdcDistributionPendingEntry h3{margin:0;font-size:18px;line-height:1.35}'
      +'#igdcDistributionPendingEntry .igdc-pending-body{padding:20px 17px;line-height:1.65}'
      +'#igdcDistributionPendingEntry .igdc-pending-state{font-weight:800;font-size:1.05rem;margin-bottom:8px}'
      +'@media(max-width:768px){#igdcDistributionPendingEntry{padding:10px}#igdcDistributionPendingEntry .igdc-pending-sheet{width:100%;max-height:82dvh}}';
    (document.head||document.documentElement).appendChild(st);
    root=document.createElement('div');root.id='igdcDistributionPendingEntry';root.setAttribute('aria-hidden','true');
    root.innerHTML='<section class="igdc-pending-sheet" role="dialog" aria-modal="true" aria-labelledby="igdcDistributionPendingTitle"><header><h3 id="igdcDistributionPendingTitle"></h3></header><div class="igdc-pending-body"><div class="igdc-pending-state"></div><div class="igdc-pending-copy"></div></div></section>';
    document.body.appendChild(root);return root;
  }
  function open(card){
    var root=ensure(),copy=C[lang()]||C.en,title=t((card.querySelector('.thumb-title')||{}).textContent||card.getAttribute('aria-label')).trim()||copy[0];
    root.querySelector('#igdcDistributionPendingTitle').textContent=title;root.querySelector('.igdc-pending-state').textContent=copy[0];root.querySelector('.igdc-pending-copy').textContent=copy[1];
    state.last=document.activeElement;root.classList.add('open');root.setAttribute('aria-hidden','false');
    if(!state.open){state.open=true;try{history.pushState({igdcPendingDistribution:Date.now()},'',location.href);state.pushed=true;}catch(_){state.pushed=false;}}
  }
  function close(){var root=document.getElementById('igdcDistributionPendingEntry');if(root){root.classList.remove('open');root.setAttribute('aria-hidden','true');}var focus=state.last;state.open=false;state.pushed=false;if(focus&&focus.focus){try{focus.focus({preventScroll:true});}catch(_){}}}
  window.addEventListener('popstate',function(){if(state.open)close();});
  document.addEventListener('click',function(e){
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var card=e.target&&e.target.closest&&e.target.closest('[data-psom-key^="distribution-"] .thumb-card');
    if(!card||card.classList.contains('skeleton')||actual(card))return;
    e.preventDefault();e.stopPropagation();open(card);
  },true);
})();
