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
    return pick(it,['thumb','image','image_url','img','photo','thumbnail','thumbnailUrl','cover','coverUrl']);
  }

  function stableId(it,key,idx){
    return pick(it,['id','contentId','productId','itemId','sku','code','pid']) ||
      (key+'-'+String(idx+1).padStart(3,'0'));
  }

  function hrefOf(it,key,idx){
    var id=stableId(it,key,idx);
    if(id) return '/content.html?id='+encodeURIComponent(id);
    var u=pick(it,[
      'affiliateOutboundUrl','affiliate_outbound_url',
      'externalOutboundUrl','external_outbound_url',
      'productUrl','purchaseUrl','orderUrl','url','href','link'
    ]);
    return /^https?:\/\//i.test(u) ? u : '#';
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
      if(/^https?:\/\//i.test(h)){a.target='_top';a.rel='noopener';}
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

    if(autoOutdoor.test(hay)) return 'home_right_middle';
    if(livingBooks.test(hay)) return 'home_right_bottom';
    if(healthLife.test(hay)) return 'home_right_top';

    // Compatibility with the currently published legacy right-panel order.
    if(sourceKey==='home_right_top') return 'home_right_middle';
    if(sourceKey==='home_right_middle') return 'home_right_bottom';
    return 'home_right_top';
  }

  function rightCard(item,key,idx){
    var a=document.createElement('a');
    a.className='ad-box news-btn';
    var href=hrefOf(item,key,idx);
    a.href=href;
    if(/^https?:\/\//i.test(href)){a.target='_top';a.rel='noopener';}

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
    img.src=imageOf(item)||'';
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

/* Final caption full-width guard — 2026-09-30 */
(function(){
  'use strict';
  if (document.getElementById('igdc-home-caption-fullwidth-final-v4')) return;
  var st=document.createElement('style');
  st.id='igdc-home-caption-fullwidth-final-v4';
  st.textContent=`
    section.shopping-section .shop-row > .shop-card{
      padding:0 !important;
      margin:0 !important;
      box-sizing:border-box !important;
    }
    section.shopping-section .shop-row > .shop-card > .shop-card-cap{
      width:100% !important;
      min-width:100% !important;
      max-width:100% !important;
      margin:0 !important;
      padding:6px 8px !important;
      box-sizing:border-box !important;
      justify-self:stretch !important;
    }
    section.shopping-section .shop-row > .shop-card > .shop-card-cap > .shop-card-cap-text{
      display:-webkit-box !important;
      width:100% !important;
      min-width:100% !important;
      max-width:100% !important;
      box-sizing:border-box !important;
      -webkit-box-orient:vertical !important;
      -webkit-line-clamp:3 !important;
    }
    .ad-panel .ad-section .ad-list > .ad-box{
      padding:0 !important;
      margin:0 !important;
      box-sizing:border-box !important;
    }
    .ad-panel .ad-section .ad-list > .ad-box > .home-right-card-cap{
      width:100% !important;
      min-width:100% !important;
      max-width:100% !important;
      margin:0 !important;
      padding:5px 6px !important;
      box-sizing:border-box !important;
      justify-self:stretch !important;
    }
    .ad-panel .ad-section .ad-list > .ad-box > .home-right-card-cap > .home-right-card-cap-text{
      display:-webkit-box !important;
      width:100% !important;
      min-width:100% !important;
      max-width:100% !important;
      box-sizing:border-box !important;
      -webkit-box-orient:vertical !important;
      -webkit-line-clamp:3 !important;
    }
  `;
  (document.head||document.documentElement).appendChild(st);
})();
