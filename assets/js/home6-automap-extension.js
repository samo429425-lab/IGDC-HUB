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