/* IGDC Home 6 + Home right-panel compatibility
 * 2026-09-30
 *
 * Main Home AutoMap v2 now renders home_1..home_6 directly.
 * This file remains as:
 * 1) backward-compatible home_6 fallback when an older Home AutoMap is loaded;
 * 2) temporary semantic rebalance for the three Home right-panel pools until
 *    the administrator/PSOM migration publishes the new section policy.
 *
 * It reuses the same snapshot promise/data as Home AutoMap to avoid duplicate
 * network requests and duplicate JSON parsing.
 */
(function(){
  'use strict';
  if(window.__IGDC_HOME6_AUTOMAP__) return;
  window.__IGDC_HOME6_AUTOMAP__=true;

  var SNAPSHOT='/data/front.snapshot.json?view=front';
  var HOME6='home_6';
  var RIGHT_KEYS=['home_right_top','home_right_middle','home_right_bottom'];
  var LIMIT=100;
  var HOME6_BATCH=6;
  var RIGHT_BATCH=4;
  var COMMERCE_VIEWER_SRC='/assets/js/igdc-contained-external-viewer.js?v=20261011-commerce-contained-v2';
  var COMMERCE_VIEWER_SCRIPT_ID='igdc-commerce-contained-viewer-loader-v2';

  function ensureCommerceContainedViewer(){
    if(window.IGDCContainedViewer && Number(window.IGDCContainedViewer.version||0)>=10 && typeof window.IGDCContainedViewer.open==='function') return Promise.resolve(window.IGDCContainedViewer);
    if(window.__IGDC_COMMERCE_CONTAINED_VIEWER_V2_PROMISE__) return window.__IGDC_COMMERCE_CONTAINED_VIEWER_V2_PROMISE__;
    window.__IGDC_COMMERCE_CONTAINED_VIEWER_V2_PROMISE__=new Promise(function(resolve,reject){
      var script=document.getElementById(COMMERCE_VIEWER_SCRIPT_ID);
      function finish(){
        if(window.IGDCContainedViewer && Number(window.IGDCContainedViewer.version||0)>=10 && typeof window.IGDCContainedViewer.open==='function') resolve(window.IGDCContainedViewer);
        else reject(new Error('IGDC contained viewer unavailable'));
      }
      if(script){
        if(script.dataset.loaded==='1'){finish();return;}
        script.addEventListener('load',finish,{once:true});
        script.addEventListener('error',function(){reject(new Error('IGDC contained viewer load failed'));},{once:true});
        return;
      }
      script=document.createElement('script');
      script.id=COMMERCE_VIEWER_SCRIPT_ID;
      script.src=COMMERCE_VIEWER_SRC;
      script.async=true;
      script.addEventListener('load',function(){script.dataset.loaded='1';finish();},{once:true});
      script.addEventListener('error',function(){reject(new Error('IGDC contained viewer load failed'));},{once:true});
      (document.head||document.documentElement).appendChild(script);
    }).catch(function(error){window.__IGDC_COMMERCE_CONTAINED_VIEWER_V2_PROMISE__=null;throw error;});
    return window.__IGDC_COMMERCE_CONTAINED_VIEWER_V2_PROMISE__;
  }

  function bindCommerceDestination(a,href,label){
    if(!a || !/^https?:\/\//i.test(String(href||''))) return;
    a.removeAttribute('target');
    a.rel='noopener';
    a.setAttribute('data-igdc-contained-product','1');
    a.addEventListener('click',function(ev){
      if(ev.defaultPrevented || ev.button!==0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      ensureCommerceContainedViewer().then(function(viewer){
        return viewer.open(href,{label:String(label||'').trim(),kind:'commerce-product',pushHistory:true});
      }).catch(function(error){
        try{console.warn('[IGDC][HomeRight] contained viewer unavailable:',error&&error.message?error.message:error);}catch(_e){}
      });
    },{passive:false});
  }

  function arr(v){ return Array.isArray(v) ? v : []; }
  function pick(o,keys){
    for(var i=0;i<keys.length;i++){
      var v=o&&o[keys[i]];
      if(typeof v==='string'&&v.trim()) return v.trim();
    }
    return '';
  }

  var TITLE_KEYS=[
    'title','name','label','caption',
    'productName','product_name','productTitle','product_title',
    'itemName','item_name','itemTitle','item_title',
    'displayName','display_name','displayTitle','display_title',
    'offerTitle','offer_title','sourceTitle','source_title'
  ];
  var TITLE_NESTED_KEYS=[
    'product','item','offer','metadata','meta',
    'sourcePayload','source_payload','raw','data'
  ];

  function resolveTitle(obj){
    var seen=[];
    function visited(x){ return seen.indexOf(x)>=0; }
    function visit(x,depth){
      if(!x || typeof x!=='object' || visited(x)) return '';
      seen.push(x);
      var direct=pick(x,TITLE_KEYS);
      if(direct) return direct;
      if(depth>=2) return '';
      for(var i=0;i<TITLE_NESTED_KEYS.length;i++){
        var got=visit(x[TITLE_NESTED_KEYS[i]],depth+1);
        if(got) return got;
      }
      return '';
    }
    return visit(obj,0)||'상품';
  }

  function imageOf(it){
    return pick(it,['thumb','image','image_url','imageUrl','imageOriginalUrl','img','photo','thumbnail','thumbnail_url','thumbnailUrl','cover','coverUrl']);
  }

  function explicitId(it){
    return pick(it,['id','contentId','productId','itemId','sku','code','pid','candidateId','candidate_id']);
  }

  function stableId(it,key,idx){
    return explicitId(it) || (key+'-'+String(idx+1).padStart(3,'0'));
  }

  function hrefOf(it,key,idx){
    // The administrator-verified seller/product detail URL is authoritative.
    // Never let a client-generated fallback id hijack a valid external product
    // into /content.html where that synthetic id does not exist.
    var u=pick(it,[
      'affiliateOutboundUrl','affiliate_outbound_url',
      'externalOutboundUrl','external_outbound_url',
      'externalProductUrl','officialProductUrl',
      'productUrl','product_url','productPageUrl','detailUrl','checkoutUrl',
      'purchaseUrl','orderUrl','productLink','displayUrl','sourceUrl',
      'url','href','link'
    ]);
    if(/^https?:\/\//i.test(u)) return u;
    var id=explicitId(it);
    return id ? '/content.html?id='+encodeURIComponent(id) : '#';
  }

  function getSnapshot(){
    if(window.__IGDC_HOME_SNAPSHOT_DATA__) {
      return Promise.resolve(window.__IGDC_HOME_SNAPSHOT_DATA__);
    }
    if(window.__IGDC_HOME_SNAPSHOT_PROMISE__) {
      return window.__IGDC_HOME_SNAPSHOT_PROMISE__;
    }

    var p=fetch(SNAPSHOT,{cache:'no-store',priority:'high'}).then(function(res){
      if(!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    }).then(function(data){
      window.__IGDC_HOME_SNAPSHOT_DATA__=data;
      return data;
    }).catch(function(err){
      window.__IGDC_HOME_SNAPSHOT_PROMISE__=null;
      throw err;
    });

    window.__IGDC_HOME_SNAPSHOT_PROMISE__=p;
    return p;
  }

  function productCard(it,isSample,key,idx){
    var a=document.createElement('a');
    a.className='shop-card';

    if(isSample){
      a.href='#';
      a.setAttribute('aria-disabled','true');
      a.setAttribute('data-igdc-slot-placeholder','1');
      a.addEventListener('click',function(e){e.preventDefault();});
    }else{
      var h=hrefOf(it,key,idx);
      a.href=h;
      if(/^https?:\/\//i.test(h)){bindCommerceDestination(a,h,resolveTitle(it));}
    }

    a.style.display='grid';
    a.style.gridTemplateRows='minmax(0,1fr) 72px';
    a.style.alignItems='stretch';
    a.style.justifyItems='stretch';
    a.style.background='#fff';
    a.style.backgroundImage='none';
    a.style.overflow='hidden';
    a.style.padding='0';
    a.style.margin='0';
    a.style.boxSizing='border-box';

    var imageWrap=document.createElement('div');
    imageWrap.className='shop-card-image';
    imageWrap.style.width='100%';
    imageWrap.style.height='100%';
    imageWrap.style.minWidth='0';
    imageWrap.style.minHeight='0';
    imageWrap.style.overflow='hidden';
    imageWrap.style.background='#fff';
    imageWrap.style.display='flex';
    imageWrap.style.alignItems='center';
    imageWrap.style.justifyContent='center';

    var image=imageOf(it);
    if(image){
      var img=document.createElement('img');
      img.loading=idx<5?'eager':'lazy';
      img.decoding='async';
      if(idx<5){ try{img.fetchPriority='high';}catch(_e){} }
      if(/^https?:\/\//i.test(image)){ try{img.referrerPolicy='no-referrer';}catch(_e){} img.setAttribute('referrerpolicy','no-referrer'); }
      img.src=image;
      img.alt='';
      img.style.width='100%';
      img.style.height='100%';
      img.style.objectFit='contain';
      img.style.display='block';
      imageWrap.appendChild(img);
    }

    var cap=document.createElement('div');
    cap.className='shop-card-cap';
    cap.style.width='100%';
    cap.style.minWidth='100%';
    cap.style.maxWidth='100%';
    cap.style.height='72px';
    cap.style.minHeight='72px';
    cap.style.maxHeight='72px';
    cap.style.boxSizing='border-box';
    cap.style.background='#f4f6f8';
    cap.style.borderTop='1px solid #cfd5db';
    cap.style.padding='6px 8px';
    cap.style.margin='0';
    cap.style.overflow='hidden';
    cap.style.display='block';

    var text=document.createElement('span');
    text.className='shop-card-cap-text';
    text.textContent=isSample?'Home 6':resolveTitle(it);
    text.style.display='-webkit-box';
    text.style.width='100%';
    text.style.maxWidth='100%';
    text.style.fontWeight='700';
    text.style.fontSize='14px';
    text.style.lineHeight='1.35';
    text.style.color='#222';
    text.style.textAlign='left';
    text.style.whiteSpace='normal';
    text.style.overflow='hidden';
    text.style.overflowWrap='anywhere';
    text.style.wordBreak='break-word';
    text.style.webkitBoxOrient='vertical';
    text.style.webkitLineClamp='3';
    cap.appendChild(text);

    a.appendChild(imageWrap);
    a.appendChild(cap);
    return a;
  }

  function fallbackRenderHome6(items){
    if(window.__HOME_PRODUCTS_AUTOMAP_V2_HOME6__) return;

    var row=document.querySelector('#shopRow6');
    var scroller=document.querySelector('#shopScroller6');
    if(!row) return;

    var list=arr(items).slice(0,LIMIT);
    var offset=0;
    row.innerHTML='';

    function more(){
      var end=Math.min(offset+HOME6_BATCH,LIMIT);
      var frag=document.createDocumentFragment();
      for(var i=offset;i<end;i++){
        var isSample=i>=list.length;
        frag.appendChild(productCard(isSample?{}:list[i],isSample,HOME6,i));
      }
      row.appendChild(frag);
      offset=end;
    }

    more();

    if(scroller){
      scroller.addEventListener('scroll',function(){
        if(offset>=LIMIT) return;
        if(scroller.scrollLeft+scroller.clientWidth>=scroller.scrollWidth-24) more();
      },{passive:true});
    }
  }

  function categoryFor(item,sourceKey){
    var hay=[
      resolveTitle(item),
      pick(item,['category','subcategory','type','kind']),
      arr(item&&item.tags).join(' ')
    ].join(' ').toLowerCase();

    var autoOutdoor=/(자동차|차량|차량용|오토바이|모터사이클|타이어|휠|블랙박스|카케어|아웃도어|등산|등산복|트레킹|하이킹|캠핑|골프|골프장|클라이밍|방풍|고어텍스|재킷|자켓|car\b|vehicle|automotive|motorcycle|tire|wheel|dashcam|outdoor|hiking|trekking|camping|golf|climbing|jacket)/i;
    var livingBooks=/(리빙|가구|책장|선반|수납장|수납|침구|인테리어|홈데코|조명|서적|도서|책방|서점|전자책|웹툰|만화|출판|living|furniture|shelf|cabinet|storage|bedding|interior|home decor|book\b|books|bookstore|ebook|webtoon|comic|publishing)/i;
    var healthLife=/(지식|교육|학습|건강|헬스|웰니스|영양제|비타민|건강식품|생필품|생활필수|위생|세제|세정제|청소|화장지|티슈|물티슈|주방소모품|욕실용품|식재료|식료품|조미료|간편식|음료|knowledge|education|learning|health|wellness|supplement|vitamin|essential|hygiene|detergent|cleaning|tissue|grocery|ingredient|seasoning|beverage)/i;

    // Administrator/Snapshot section assignment is authoritative.
    // Never rotate right-panel data between top/middle/bottom at render time.
    // Semantic tests remain above only as diagnostics for old data, but a card
    // that already belongs to a valid Home right section stays in that section.
    if(RIGHT_KEYS.indexOf(sourceKey)>=0) return sourceKey;
    if(autoOutdoor.test(hay)) return 'home_right_middle';
    if(livingBooks.test(hay)) return 'home_right_bottom';
    if(healthLife.test(hay)) return 'home_right_top';
    return 'home_right_top';
  }

  function rightCard(item,key,idx){
    var a=document.createElement('a');
    a.className='ad-box news-btn';
    var href=hrefOf(item,key,idx);
    a.href=href;
    if(/^https?:\/\//i.test(href)){bindCommerceDestination(a,href,resolveTitle(item));}

    a.style.display='grid';
    a.style.gridTemplateRows='minmax(0,1fr) 58px';
    a.style.alignItems='stretch';
    a.style.justifyItems='stretch';
    a.style.overflow='hidden';
    a.style.background='#fff';
    a.style.padding='0';
    a.style.margin='0';
    a.style.boxSizing='border-box';

    var imageWrap=document.createElement('div');
    imageWrap.className='home-right-card-image';
    imageWrap.style.width='100%';
    imageWrap.style.height='100%';
    imageWrap.style.minWidth='0';
    imageWrap.style.minHeight='0';
    imageWrap.style.overflow='hidden';
    imageWrap.style.display='flex';
    imageWrap.style.alignItems='center';
    imageWrap.style.justifyContent='center';
    imageWrap.style.background='#fff';

    var img=document.createElement('img');
    img.loading=idx<3?'eager':'lazy';
    img.decoding='async';
    if(idx<3){ try{img.fetchPriority='high';}catch(_e){} }
    var rightImage=imageOf(item)||'';
    if(/^https?:\/\//i.test(rightImage)){ try{img.referrerPolicy='no-referrer';}catch(_e){} img.setAttribute('referrerpolicy','no-referrer'); }
    img.src=rightImage;
    img.alt='';
    img.style.width='100%';
    img.style.height='100%';
    img.style.objectFit='contain';
    img.style.display='block';
    imageWrap.appendChild(img);

    var cap=document.createElement('div');
    cap.className='home-right-card-cap';
    cap.style.width='100%';
    cap.style.minWidth='100%';
    cap.style.maxWidth='100%';
    cap.style.height='58px';
    cap.style.minHeight='58px';
    cap.style.maxHeight='58px';
    cap.style.boxSizing='border-box';
    cap.style.padding='5px 6px';
    cap.style.margin='0';
    cap.style.background='#f4f6f8';
    cap.style.borderTop='1px solid #cfd5db';
    cap.style.overflow='hidden';
    cap.style.display='block';

    var text=document.createElement('span');
    text.className='home-right-card-cap-text';
    text.textContent=resolveTitle(item);
    text.style.display='-webkit-box';
    text.style.width='100%';
    text.style.maxWidth='100%';
    text.style.fontSize='12px';
    text.style.fontWeight='700';
    text.style.lineHeight='1.3';
    text.style.color='#222';
    text.style.textAlign='left';
    text.style.whiteSpace='normal';
    text.style.overflow='hidden';
    text.style.overflowWrap='anywhere';
    text.style.wordBreak='break-word';
    text.style.webkitBoxOrient='vertical';
    text.style.webkitLineClamp='3';
    cap.appendChild(text);

    a.appendChild(imageWrap);
    a.appendChild(cap);
    return a;
  }

  function rightList(key){
    var marker=document.querySelector('[data-psom-key="'+key+'"]');
    if(!marker) return null;
    var section=marker.closest('.ad-section');
    return (section&&section.querySelector('.ad-list'))||marker;
  }

  function renderRight(key,items){
    var list=rightList(key);
    if(!list) return;

    var data=arr(items).slice(0,LIMIT);
    var offset=0;
    list.innerHTML='';

    function more(){
      var end=Math.min(offset+RIGHT_BATCH,data.length);
      var frag=document.createDocumentFragment();
      for(var i=offset;i<end;i++) frag.appendChild(rightCard(data[i],key,i));
      list.appendChild(frag);
      offset=end;
    }
    more();

    var section=list.closest('.ad-section');
    var scroller=section&&(section.querySelector('.ad-scroll')||section);
    if(scroller && !scroller.dataset.igdcRightSemanticScrollV2){
      scroller.dataset.igdcRightSemanticScrollV2='1';
      scroller.addEventListener('scroll',function(){
        if(offset>=data.length) return;
        var horizontal=scroller.scrollWidth>scroller.clientWidth+1;
        var nearEnd=horizontal
          ? scroller.scrollLeft+scroller.clientWidth>=scroller.scrollWidth-24
          : scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-24;
        if(nearEnd) more();
      },{passive:true});
    }
  }

  var lastRightRenderToken=0;
  function rebalanceRight(){
    // Home AutoMap v2 now owns all three right rails. Repainting the exact
    // same authoritative snapshot here doubles DOM/image work and resets
    // scroll position. Keep this renderer only for legacy Home AutoMap.
    if(window.__HOME_PRODUCTS_AUTOMAP_V2__) return;
    var token=++lastRightRenderToken;
    return getSnapshot().then(function(doc){
      if(token!==lastRightRenderToken) return;
      var sections=doc&&doc.pages&&doc.pages.home&&doc.pages.home.sections;
      if(!sections) return;

      var buckets={
        home_right_top:[],
        home_right_middle:[],
        home_right_bottom:[]
      };

      RIGHT_KEYS.forEach(function(sourceKey){
        arr(sections[sourceKey]).forEach(function(item){
          var target=categoryFor(item,sourceKey);
          if(buckets[target].length<LIMIT) buckets[target].push(item);
        });
      });

      RIGHT_KEYS.forEach(function(key){renderRight(key,buckets[key]);});
    }).catch(function(){});
  }

  function fallbackHome6(){
    if(window.__HOME_PRODUCTS_AUTOMAP_V2_HOME6__) return;
    getSnapshot().then(function(doc){
      var items=doc&&doc.pages&&doc.pages.home&&doc.pages.home.sections&&doc.pages.home.sections[HOME6];
      fallbackRenderHome6(items);
    }).catch(function(){fallbackRenderHome6([]);});
  }

  function boot(){
    fallbackHome6();

    document.addEventListener('igdc:home-automap-rendered',function(){
      rebalanceRight();
    });

    if(window.__IGDC_HOME_AUTOMAP_RENDERED__) {
      rebalanceRight();
    } else {
      // Fallback only; normal path is the explicit event from Home AutoMap.
      setTimeout(function(){
        if(!window.__IGDC_HOME_AUTOMAP_RENDERED__) rebalanceRight();
      },1200);
    }
  }

  if(document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded',boot,{once:true});
  } else {
    boot();
  }
})();

/* IGDC HOME card caption geometry final guard v5 — 2026-09-30
 * Guarantees edge-to-edge title strips for every Home main/right card.
 * Works for all lazy/incremental batches, not only the first visible cards.
 */
(function(){
  'use strict';
  if (document.getElementById('igdc-home-caption-geometry-final-v5')) return;
  var st=document.createElement('style');
  st.id='igdc-home-caption-geometry-final-v5';
  st.textContent=`
    /* MAIN: home_1 ... home_6 */
    section.shopping-section .shop-row > .shop-card{
      position:relative !important;
      display:block !important;
      padding:0 !important;
      margin:0 !important;
      box-sizing:border-box !important;
      overflow:hidden !important;
      background:#fff !important;
      background-image:none !important;
    }
    section.shopping-section .shop-row > .shop-card > .shop-card-image{
      position:absolute !important;
      top:0 !important;
      left:0 !important;
      right:0 !important;
      bottom:72px !important;
      width:auto !important;
      min-width:0 !important;
      max-width:none !important;
      height:auto !important;
      min-height:0 !important;
      margin:0 !important;
      padding:0 !important;
      box-sizing:border-box !important;
      overflow:hidden !important;
      background:#fff !important;
    }
    section.shopping-section .shop-row > .shop-card > .shop-card-image > img{
      display:block !important;
      width:100% !important;
      min-width:100% !important;
      max-width:100% !important;
      height:100% !important;
      margin:0 !important;
      padding:0 !important;
      object-fit:contain !important;
    }
    section.shopping-section .shop-row > .shop-card > .shop-card-cap{
      position:absolute !important;
      left:0 !important;
      right:0 !important;
      bottom:0 !important;
      top:auto !important;
      width:auto !important;
      min-width:0 !important;
      max-width:none !important;
      height:72px !important;
      min-height:72px !important;
      max-height:72px !important;
      margin:0 !important;
      padding:6px 8px !important;
      box-sizing:border-box !important;
      background:#f4f6f8 !important;
      border-top:1px solid #cfd5db !important;
      overflow:hidden !important;
      text-align:left !important;
    }
    section.shopping-section .shop-row > .shop-card > .shop-card-cap > .shop-card-cap-text{
      display:-webkit-box !important;
      width:100% !important;
      min-width:100% !important;
      max-width:100% !important;
      margin:0 !important;
      padding:0 !important;
      box-sizing:border-box !important;
      color:#222 !important;
      font-size:14px !important;
      font-weight:700 !important;
      line-height:1.35 !important;
      white-space:normal !important;
      overflow:hidden !important;
      overflow-wrap:anywhere !important;
      word-break:break-word !important;
      -webkit-box-orient:vertical !important;
      -webkit-line-clamp:3 !important;
    }

    /* RIGHT: top / middle / bottom */
    .ad-panel .ad-section .ad-list > .ad-box{
      position:relative !important;
      display:block !important;
      padding:0 !important;
      margin:0 !important;
      box-sizing:border-box !important;
      overflow:hidden !important;
      background:#fff !important;
    }
    .ad-panel .ad-section .ad-list > .ad-box > .home-right-card-image{
      position:absolute !important;
      top:0 !important;
      left:0 !important;
      right:0 !important;
      bottom:58px !important;
      width:auto !important;
      min-width:0 !important;
      max-width:none !important;
      height:auto !important;
      min-height:0 !important;
      margin:0 !important;
      padding:0 !important;
      box-sizing:border-box !important;
      overflow:hidden !important;
      background:#fff !important;
    }
    .ad-panel .ad-section .ad-list > .ad-box > .home-right-card-image > img{
      display:block !important;
      width:100% !important;
      min-width:100% !important;
      max-width:100% !important;
      height:100% !important;
      margin:0 !important;
      padding:0 !important;
      object-fit:contain !important;
    }
    .ad-panel .ad-section .ad-list > .ad-box > .home-right-card-cap{
      position:absolute !important;
      left:0 !important;
      right:0 !important;
      bottom:0 !important;
      top:auto !important;
      width:auto !important;
      min-width:0 !important;
      max-width:none !important;
      height:58px !important;
      min-height:58px !important;
      max-height:58px !important;
      margin:0 !important;
      padding:5px 6px !important;
      box-sizing:border-box !important;
      background:#f4f6f8 !important;
      border-top:1px solid #cfd5db !important;
      overflow:hidden !important;
      text-align:left !important;
    }
    .ad-panel .ad-section .ad-list > .ad-box > .home-right-card-cap > .home-right-card-cap-text{
      display:-webkit-box !important;
      width:100% !important;
      min-width:100% !important;
      max-width:100% !important;
      margin:0 !important;
      padding:0 !important;
      box-sizing:border-box !important;
      color:#222 !important;
      font-size:12px !important;
      font-weight:700 !important;
      line-height:1.3 !important;
      white-space:normal !important;
      overflow:hidden !important;
      overflow-wrap:anywhere !important;
      word-break:break-word !important;
      -webkit-box-orient:vertical !important;
      -webkit-line-clamp:3 !important;
    }
  `;
  (document.head||document.documentElement).appendChild(st);
})();

/* Home 6 arrow wiring / locale accessibility, 2026-10-29.
 * Each of the 30 language homes already ships #shopScroller6 and arrows, but
 * the legacy inline binder hard-codes ROWS=5. Bind ONLY row 6 here; rows 1..5
 * remain owned by the original page and their card/fallback logic is untouched.
 */
(function(){
  'use strict';
  if(window.__IGDC_HOME6_ARROWS_BOUND__) return;
  window.__IGDC_HOME6_ARROWS_BOUND__=true;
  var LABELS={
    ko:'잡화 · 생필품 · 생활용품',en:'Daily Goods · Household Essentials',
    ja:'日用雑貨・生活必需品',zh:'日用杂货 · 生活必需品',zht:'日用雜貨 · 生活必需品',
    ar:'سلع يومية · مستلزمات منزلية',fa:'کالاهای روزمره · لوازم ضروری خانه',
    ur:'روزمرہ سامان · گھریلو ضروریات',de:'Alltagswaren · Haushaltsbedarf',
    fr:'Articles du quotidien · Essentiels ménagers',es:'Artículos cotidianos · Esenciales del hogar',
    pt:'Utilidades domésticas · Essenciais do dia a dia',it:'Articoli quotidiani · Essenziali per la casa',
    nl:'Dagelijkse artikelen · Huishoudelijke benodigdheden',sv:'Vardagsvaror · Hushållsartiklar',
    no:'Hverdagsvarer · Husholdningsartikler',da:'Dagligvarer · Husholdningsartikler',
    fi:'Arkitavarat · Kodin tarvikkeet',pl:'Artykuły codzienne · Artykuły gospodarstwa domowego',
    tr:'Günlük ürünler · Ev ihtiyaçları',ru:'Товары для дома · Повседневные товары',
    th:'ของใช้ประจำวัน · ของใช้ในบ้าน',vi:'Đồ dùng hằng ngày · Đồ gia dụng',
    id:'Barang sehari-hari · Kebutuhan rumah tangga',ms:'Barangan harian · Keperluan rumah',
    bn:'দৈনন্দিন পণ্য · গৃহস্থালির প্রয়োজনীয় সামগ্রী',hi:'रोजमर्रा का सामान · घरेलू आवश्यक वस्तुएँ',
    ta:'அன்றாடப் பொருட்கள் · வீட்டு அத்தியாவசியங்கள்',tl:'Pang-araw-araw na gamit · Pangangailangan sa bahay',
    uk:'Повсякденні товари · Товари для дому',hu:'Mindennapi cikkek · Háztartási kellékek',
    sw:'Bidhaa za kila siku · Mahitaji ya nyumbani',uz:'Kundalik tovarlar · Uy-ro‘zg‘or buyumlari'
  };
  function locale(){
    var path=(location.pathname||'').split('/').filter(Boolean);
    var lang=path.length>1&&/^home_[a-z]+\.html$/i.test(path[path.length-1])?path[0]:'';
    return lang||String(document.documentElement.lang||'ko').toLowerCase().replace(/[-_].*$/,'');
  }
  function setup(){
    var wrap=document.querySelector('.shop-row-wrap[data-srow="6"]');
    var rail=document.getElementById('shopScroller6');
    var left=document.getElementById('srowLeft6');
    var right=document.getElementById('srowRight6');
    if(!wrap||!rail||!left||!right) return;
    wrap.setAttribute('aria-label',LABELS[locale()]||LABELS.en);
    // Leave the 30 home HTML files and their existing inline fingerprint intact;
    // update the in-page descriptor used by later client-side consumers.
    var fingerprint=document.getElementById('shopping-fingerprint');
    if(fingerprint&&fingerprint.type==='application/json'){
      try{var json=JSON.parse(fingerprint.textContent);if(json&&json.lines&&json.lines['6']){
        json.lines['6'].category=['misc_daily_goods','household_essentials','living_supplies'];
        json.lines['6'].notes='individual purchasable miscellaneous, daily household and essential goods';
        fingerprint.textContent=JSON.stringify(json);
      }}catch(_e){}
    }
    function width(){return Math.max(220,Math.floor(rail.clientWidth*.9));}
    function update(){
      var overflow=rail.scrollWidth>rail.clientWidth+2;
      var atStart=rail.scrollLeft<=1;
      var atEnd=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-2;
      left.style.display=right.style.display=overflow?'block':'none';
      left.classList.toggle('disabled',!overflow||atStart);
      right.classList.toggle('disabled',!overflow||atEnd);
      left.disabled=!overflow||atStart;
      right.disabled=!overflow||atEnd;
    }
    left.addEventListener('click',function(){rail.scrollBy({left:-width(),behavior:'smooth'});});
    right.addEventListener('click',function(){rail.scrollBy({left:width(),behavior:'smooth'});});
    rail.addEventListener('scroll',update,{passive:true});
    window.addEventListener('resize',update,{passive:true});
    document.addEventListener('igdc:home-automap-rendered',update);
    // Home AutoMap renders incrementally after the page's DOMContentLoaded.
    // Child additions trigger visibility updates without polling or repainting.
    if(typeof MutationObserver!=='undefined'){
      var observer=new MutationObserver(update);
      observer.observe(rail,{childList:true,subtree:true});
    }
    update();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})();
