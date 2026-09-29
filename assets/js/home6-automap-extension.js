/* IGDC Home 6 AutoMap extension
 * Front-only first-stage patch.
 * - home_6 = webtoon / books / ebooks / digital reading
 * - Reads the same country-scoped front.snapshot.json used by Home AutoMap.
 * - Keeps 100 slots. Real snapshot items replace sample slots; if they disappear,
 *   the sample slots are restored automatically on the next load.
 */
(function(){
  'use strict';
  if(window.__IGDC_HOME6_AUTOMAP__) return;
  window.__IGDC_HOME6_AUTOMAP__=true;

  var KEY='home_6', LIMIT=100, SNAPSHOT='/data/front.snapshot.json';

  function q(sel){return document.querySelector(sel);}
  function str(v){return String(v==null?'':v).trim();}
  function pick(o,keys){for(var i=0;i<keys.length;i++){var v=o&&o[keys[i]];if(typeof v==='string'&&v.trim())return v.trim();}return '';}
  function lang(){
    return str(document.documentElement&&document.documentElement.getAttribute('lang')||navigator.language||'en').toLowerCase().split('-')[0];
  }
  var SAMPLE={
    ko:'웹툰 · 서적 · 디지털 독서',
    en:'Webtoons · Books · Digital Reading',
    ja:'ウェブトゥーン・書籍・デジタル読書',
    zh:'网络漫画 · 书籍 · 数字阅读',
    ar:'ويب تون · الكتب · القراءة الرقمية',
    fa:'وب‌تون · کتاب · مطالعه دیجیتال',
    ur:'ویب ٹون · کتابیں · ڈیجیٹل مطالعہ'
  };
  function sampleTitle(){return SAMPLE[lang()]||SAMPLE.en;}

  function hrefOf(it){
    var id=pick(it,['id','contentId','productId','itemId','sku','code','pid']);
    if(id)return '/content.html?id='+encodeURIComponent(id);
    var u=pick(it,['affiliateOutboundUrl','externalOutboundUrl','outboundUrl','productUrl','purchaseUrl','url','href','link']);
    return /^https?:\/\//i.test(u)?u:'#';
  }

  function card(it,isSample,index){
    var a=document.createElement('a');
    a.className='shop-card';
    if(isSample){
      a.href='#';
      a.setAttribute('aria-disabled','true');
      a.setAttribute('data-igdc-slot-placeholder','1');
      a.addEventListener('click',function(e){e.preventDefault();});
    }else{
      var h=hrefOf(it);
      a.href=h;
      if(/^https?:\/\//i.test(h)){a.target='_top';a.rel='noopener';}
    }
    var image=pick(it,['thumb','image','image_url','img','photo','thumbnail','thumbnailUrl','cover','coverUrl']);
    if(image){
      a.style.backgroundImage='url("'+image.replace(/"/g,'&quot;')+'")';
      a.style.backgroundPosition='center';
      a.style.backgroundSize='cover';
      a.style.backgroundRepeat='no-repeat';
    }
    var cap=document.createElement('div');
    cap.className='shop-card-cap';
    cap.textContent=isSample ? sampleTitle() : (pick(it,['title','name','label','caption'])||sampleTitle());
    cap.style.alignSelf='end';
    cap.style.width='100%';
    cap.style.boxSizing='border-box';
    cap.style.background='rgba(255,255,255,.88)';
    cap.style.padding='6px 8px';
    cap.style.fontWeight='700';
    cap.style.fontSize='14px';
    cap.style.color='#222';
    cap.style.textAlign='center';
    cap.style.lineHeight='1.35';
    cap.style.display='-webkit-box';
    cap.style.webkitBoxOrient='vertical';
    cap.style.webkitLineClamp='2';
    cap.style.overflow='hidden';
    a.style.display='grid';
    a.style.gridTemplateRows='1fr auto';
    a.appendChild(cap);
    return a;
  }

  function render(items){
    var row=q('#shopRow6');
    if(!row)return;
    row.innerHTML='';
    var list=Array.isArray(items)?items.slice(0,LIMIT):[];
    for(var i=0;i<LIMIT;i++)row.appendChild(card(list[i]||{},i>=list.length,i));
  }

  async function boot(){
    try{
      var r=await fetch(SNAPSHOT,{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      var d=await r.json();
      var items=d&&d.pages&&d.pages.home&&d.pages.home.sections&&d.pages.home.sections[KEY];
      render(Array.isArray(items)?items:[]);
    }catch(_e){render([]);}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();


/* HOME visual correction + right-panel semantic rebalance, 2026-09-30 */
(function(){
  'use strict';
  if(window.__IGDC_HOME_VISUAL_RIGHT_FIX_V1__) return;
  window.__IGDC_HOME_VISUAL_RIGHT_FIX_V1__=true;

  var SNAPSHOT='/data/front.snapshot.json';
  var RIGHT_KEYS=['home_right_top','home_right_middle','home_right_bottom'];
  var LIMIT=100, BATCH=12;

  function arr(v){return Array.isArray(v)?v:[];}
  function pick(o,keys){
    for(var i=0;i<keys.length;i++){
      var v=o&&o[keys[i]];
      if(typeof v==='string'&&v.trim()) return v.trim();
    }
    return '';
  }
  function stableId(it,key,idx){
    return pick(it,['id','contentId','productId','itemId','sku','code','pid']) || (key+'-'+String(idx+1).padStart(3,'0'));
  }
  function hrefOf(it,key,idx){
    var id=stableId(it,key,idx);
    if(id) return '/content.html?id='+encodeURIComponent(id);
    var u=pick(it,['affiliateOutboundUrl','affiliate_outbound_url','externalOutboundUrl','external_outbound_url','productUrl','purchaseUrl','orderUrl','url','href','link']);
    return /^https?:\/\//i.test(u)?u:'#';
  }
  function imageOf(it){
    return pick(it,['thumb','image','image_url','img','photo','thumbnail','thumbnailUrl','cover','coverUrl']);
  }

  /* Thumbnail above, product name below. */
  function fixMainCard(card){
    if(!card || card.nodeType!==1 || card.dataset.igdcCaptionBelow==='1') return;
    if(!card.classList.contains('shop-card')) return;
    var cap=card.querySelector('.shop-card-cap');
    if(!cap) return;

    var bg=card.style.backgroundImage||'';
    var pending=card.dataset.igdcDeferredBg||'';
    if(!bg && !pending) return;

    var image=document.createElement('div');
    image.className='home-product-image';
    if(bg) image.style.backgroundImage=bg;
    else if(pending) image.style.backgroundImage='url("'+pending.replace(/"/g,'&quot;')+'")';
    image.style.backgroundPosition='center';
    image.style.backgroundSize='contain';
    image.style.backgroundRepeat='no-repeat';
    image.style.width='100%';
    image.style.minHeight='0';

    card.style.display='grid';
    card.style.gridTemplateRows='minmax(0,1fr) auto';
    card.style.backgroundImage='none';
    card.style.backgroundColor='#fff';

    cap.style.position='static';
    cap.style.alignSelf='stretch';
    cap.style.boxSizing='border-box';
    cap.style.background='#fff';
    cap.style.borderTop='1px solid #eee';
    cap.style.padding='6px 8px';
    cap.style.minHeight='42px';

    card.insertBefore(image,cap);
    card.dataset.igdcCaptionBelow='1';
  }

  function fixAllMainCards(root){
    var scope=root&&root.querySelectorAll?root:document;
    Array.prototype.forEach.call(scope.querySelectorAll('.shop-row .shop-card'),fixMainCard);
  }

  function installCardObserver(){
    fixAllMainCards(document);
    var root=document.querySelector('.shopping-section')||document.body;
    if(!root || typeof MutationObserver==='undefined') return;
    var queued=false;
    var obs=new MutationObserver(function(){
      if(queued) return;
      queued=true;
      (window.requestAnimationFrame||function(fn){return setTimeout(fn,0);})(function(){
        queued=false;
        fixAllMainCards(root);
      });
    });
    obs.observe(root,{childList:true,subtree:true});
  }

  function categoryFor(item,sourceKey){
    var hay=[
      pick(item,['title','name','label','caption']),
      pick(item,['category','subcategory','type','kind']),
      arr(item&&item.tags).join(' ')
    ].join(' ').toLowerCase();

    var autoOutdoor=/(자동차|차량|차량용|오토바이|모터사이클|타이어|휠|블랙박스|카케어|아웃도어|등산|등산복|트레킹|하이킹|캠핑|골프|골프장|클라이밍|방풍|고어텍스|재킷|자켓|car\b|vehicle|automotive|motorcycle|tire|wheel|dashcam|outdoor|hiking|trekking|camping|golf|climbing|jacket)/i;
    var livingBooks=/(리빙|가구|책장|선반|수납장|수납|침구|인테리어|홈데코|조명|서적|도서|책방|서점|전자책|웹툰|만화|출판|living|furniture|shelf|cabinet|storage|bedding|interior|home decor|book\b|books|bookstore|ebook|webtoon|comic|publishing)/i;
    var healthLife=/(지식|교육|학습|건강|헬스|웰니스|영양제|비타민|건강식품|생필품|생활필수|위생|세제|세정제|청소|화장지|티슈|물티슈|주방소모품|욕실용품|식재료|식료품|조미료|간편식|음료|knowledge|education|learning|health|wellness|supplement|vitamin|essential|hygiene|detergent|cleaning|tissue|grocery|ingredient|seasoning|beverage)/i;

    if(autoOutdoor.test(hay)) return 'home_right_middle';
    if(livingBooks.test(hay)) return 'home_right_bottom';
    if(healthLife.test(hay)) return 'home_right_top';

    /* Current production snapshot still has the previous right-rail order. */
    if(sourceKey==='home_right_top') return 'home_right_middle';
    if(sourceKey==='home_right_middle') return 'home_right_bottom';
    return 'home_right_top';
  }

  function buildRightCard(item,key,idx){
    var a=document.createElement('a');
    a.className='ad-box news-btn';
    var href=hrefOf(item,key,idx);
    a.href=href;
    if(/^https?:\/\//i.test(href)){a.target='_top';a.rel='noopener';}
    var img=document.createElement('img');
    img.loading='lazy';
    img.decoding='async';
    img.src=imageOf(item)||'';
    img.alt='';
    a.appendChild(img);
    return a;
  }

  function targetList(key){
    var marker=document.querySelector('[data-psom-key="'+key+'"]');
    if(!marker) return null;
    var section=marker.closest('.ad-section');
    return (section&&section.querySelector('.ad-list'))||marker;
  }

  function renderRight(key,items){
    var list=targetList(key);
    if(!list) return;
    var offset=0, data=arr(items).slice(0,LIMIT);
    list.innerHTML='';

    function more(){
      var end=Math.min(offset+BATCH,data.length);
      var frag=document.createDocumentFragment();
      for(var i=offset;i<end;i++) frag.appendChild(buildRightCard(data[i],key,i));
      list.appendChild(frag);
      offset=end;
    }
    more();

    var section=list.closest('.ad-section');
    var scroller=section&&(section.querySelector('.ad-scroll')||section);
    if(scroller && !scroller.dataset.igdcRightSemanticScroll){
      scroller.dataset.igdcRightSemanticScroll='1';
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

  async function rebalanceRight(){
    try{
      var res=await fetch(SNAPSHOT,{cache:'no-store'});
      if(!res.ok) return;
      var doc=await res.json();
      var sections=doc&&doc.pages&&doc.pages.home&&doc.pages.home.sections;
      if(!sections) return;

      var buckets={home_right_top:[],home_right_middle:[],home_right_bottom:[]};
      RIGHT_KEYS.forEach(function(sourceKey){
        arr(sections[sourceKey]).forEach(function(item){
          var target=categoryFor(item,sourceKey);
          if(buckets[target].length<LIMIT) buckets[target].push(item);
        });
      });
      RIGHT_KEYS.forEach(function(key){renderRight(key,buckets[key]);});
    }catch(_e){}
  }

  function boot(){
    installCardObserver();
    rebalanceRight();
    setTimeout(rebalanceRight,700);
    setTimeout(function(){fixAllMainCards(document);},900);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();

/* Force main product title below thumbnail — 2026-09-30 */
(function(){
  'use strict';
  if(window.__IGDC_HOME_TITLE_BELOW_FIX_V2__) return;
  window.__IGDC_HOME_TITLE_BELOW_FIX_V2__=true;

  var style=document.createElement('style');
  style.id='igdc-home-title-below-fix-v2';
  style.textContent=[
    '.shop-row .shop-card{',
    'display:grid!important;',
    'grid-template-rows:minmax(0,1fr) auto!important;',
    'align-items:stretch!important;',
    'justify-items:stretch!important;',
    'background-position:center top!important;',
    'background-repeat:no-repeat!important;',
    '}',
    '.shop-row .shop-card .shop-card-cap{',
    'grid-row:2!important;',
    'position:static!important;',
    'align-self:stretch!important;',
    'width:100%!important;',
    'box-sizing:border-box!important;',
    'background:#fff!important;',
    'border-top:1px solid #e7e7e7!important;',
    'padding:6px 8px!important;',
    'margin:0!important;',
    'z-index:2!important;',
    'text-align:left!important;',
    '}'
  ].join('');
  (document.head||document.documentElement).appendChild(style);

  function apply(){
    var cards=document.querySelectorAll('.shop-row .shop-card');
    for(var i=0;i<cards.length;i++){
      var card=cards[i];
      var cap=card.querySelector('.shop-card-cap');
      if(!cap) continue;
      cap.style.gridRow='2';
      cap.style.position='static';
      cap.style.background='#fff';
      cap.style.borderTop='1px solid #e7e7e7';
      cap.style.margin='0';
      card.style.display='grid';
      card.style.gridTemplateRows='minmax(0,1fr) auto';
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      apply();
      setTimeout(apply,300);
      setTimeout(apply,900);
    },{once:true});
  }else{
    apply();
    setTimeout(apply,300);
    setTimeout(apply,900);
  }

  if(typeof MutationObserver!=='undefined'){
    var obs=new MutationObserver(function(){apply();});
    var root=document.querySelector('.shopping-section')||document.body;
    if(root) obs.observe(root,{childList:true,subtree:true});
  }
})();
