(function(global){
  'use strict';
  function ready(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    try{
      var grids = document.querySelectorAll('[data-media-grid], .media-grid, .content-grid');
      grids.forEach(function(grid){
        if(grid.children && grid.children.length) return;
        grid.setAttribute('data-maru-empty','1');
      });
    }catch(e){}
  });
  global.MaruMediaEmptyHandler = global.MaruMediaEmptyHandler || { ready:true };
})(window);

/* IGDC Media Hero one-point link patch
 * Scope: MediaHub only. The 05:42 AutoMap/render pipeline remains untouched.
 * Policy: among successfully rendered Movie/Drama cards, ranking first;
 * then recency; then actual thumbnail resolution. The hero image itself is
 * the shortcut to the exact selected card.
 */
(function(){
  'use strict';
  if(window.__IGDC_MEDIA_HERO_ONEPOINT__) return;
  window.__IGDC_MEDIA_HERO_ONEPOINT__ = true;

  var D=document;
  var currentCard=null;
  var applying=false;
  var timer=null;
  var observer=null;

  function num(v){
    var n=Number(v);
    return Number.isFinite(n)?n:0;
  }
  function itemOf(card){
    return card&&card.__igdcMediaItem&&typeof card.__igdcMediaItem==='object'?card.__igdcMediaItem:{};
  }
  function metric(item,names){
    for(var i=0;i<names.length;i++){
      var v=item&&item[names[i]];
      if(v!==undefined&&v!==null&&v!==''){
        var n=Number(v);
        if(Number.isFinite(n)) return n;
      }
    }
    return 0;
  }
  function popularity(card){
    var item=itemOf(card);
    var score=metric(item,['heroScore','rankingScore','rankScore','popularity','score','qualityScore','trendScore','hotScore']);
    var pos=metric(item,['rank','ranking','rankPosition','position']);
    var views=metric(item,['views','viewCount']);
    var rating=metric(item,['rating','voteAverage']);
    var m=item.metrics&&typeof item.metrics==='object'?item.metrics:{};
    var likes=num(m.like||m.likes||item.likes||item.likeCount);
    var recommends=num(m.recommend||m.recommends||item.recommendCount);
    var watch=num(m.watchTime||item.watchTime);
    var front=num(card&&card.dataset&&card.dataset.frontPriority);
    var rankBonus=pos>0?Math.max(0,12000-(Math.min(pos,1200)*10)):0;
    return (score*1000)+rankBonus+(Math.log10(Math.max(1,views))*260)+(rating*80)+(Math.log10(Math.max(1,likes+recommends+watch))*120)+front;
  }
  function freshness(card){
    var item=itemOf(card);
    var raw=item.publishedAt||item.published_at||item.releaseDate||item.release_date||item.createdAt||item.created_at||item.updatedAt||item.updated_at||item.premiereDate||item.premieredAt||item.date||'';
    if(!raw) return 0;
    var t=typeof raw==='number'?raw:new Date(raw).getTime();
    if(!Number.isFinite(t)) return 0;
    if(t>0&&t<100000000000) t*=1000;
    return t;
  }
  function imageOf(card){
    if(!card) return null;
    var img=card.querySelector('img');
    if(!img) return null;
    var src=String(img.currentSrc||img.src||'').trim();
    if(!src||/media-sample-card\.png|placeholder|placehold\./i.test(src)) return null;
    return img;
  }
  function quality(card){
    var img=imageOf(card);
    if(!img) return 0;
    return num(img.naturalWidth)*num(img.naturalHeight);
  }
  function eligible(card){
    if(!card||card.getAttribute('data-placeholder')==='true') return false;
    var line=card.closest&&card.closest('[data-psom-key]');
    var key=line&&String(line.getAttribute('data-psom-key')||'');
    if(key!=='media-movie'&&key!=='media-drama') return false;
    if(!imageOf(card)) return false;
    return true;
  }
  function selectCard(){
    var cards=Array.prototype.slice.call(D.querySelectorAll('a.card.media-card')).filter(eligible);
    if(!cards.length) return null;
    cards.sort(function(a,b){
      var ar=popularity(a),br=popularity(b);
      if(ar!==br) return br-ar;
      var ad=freshness(a),bd=freshness(b);
      if(ad!==bd) return bd-ad;
      var aq=quality(a),bq=quality(b);
      if(aq!==bq) return bq-aq;
      return 0;
    });
    return cards[0]||null;
  }
  function apply(){
    if(applying) return;
    applying=true;
    try{
      var hero=D.querySelector('.hero');
      var heroImg=hero&&hero.querySelector('img');
      var card=selectCard();
      var cardImg=imageOf(card);
      if(!hero||!heroImg||!card||!cardImg) return;
      currentCard=card;
      var src=String(cardImg.currentSrc||cardImg.src||'').trim();
      if(src&&String(heroImg.currentSrc||heroImg.src||'')!==src) heroImg.src=src;
      heroImg.alt=String((itemOf(card).title||itemOf(card).name||card.dataset.mediaTitle||cardImg.alt||'Featured media'));
      heroImg.loading='eager';
      try{heroImg.fetchPriority='high';}catch(_e){}
      hero.style.cursor='pointer';
      hero.setAttribute('role','link');
      hero.setAttribute('tabindex','0');
      hero.setAttribute('aria-label',heroImg.alt||'Featured media');
      hero.dataset.igdcHeroOnepoint='true';
    }finally{
      applying=false;
    }
  }
  function schedule(delay){
    if(timer) clearTimeout(timer);
    timer=setTimeout(function(){timer=null;apply();},Math.max(0,Number(delay)||0));
  }
  function activateSelected(event){
    var hero=event.target&&event.target.closest&&event.target.closest('.hero');
    if(!hero) return;
    var card=currentCard&&currentCard.isConnected?currentCard:selectCard();
    if(!card) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(typeof card.click==='function') card.click();
  }
  function install(){
    apply();
    [250,700,1800,4200,9000,18500].forEach(function(ms){setTimeout(apply,ms);});
    D.addEventListener('igdc:media-thumbnail-ready',function(){schedule(60);});
    D.addEventListener('click',activateSelected,true);
    D.addEventListener('keydown',function(event){
      if(event&&(event.key==='Enter'||event.key===' '||event.code==='Space')) activateSelected(event);
    },true);
    if(!observer&&D.documentElement){
      observer=new MutationObserver(function(records){
        var relevant=false;
        for(var i=0;i<records.length;i++){
          var t=records[i]&&records[i].target;
          if(t&&t.nodeType===1&&(t.closest&&t.closest('.hero, [data-psom-key="media-movie"], [data-psom-key="media-drama"]'))){relevant=true;break;}
        }
        if(relevant) schedule(40);
      });
      observer.observe(D.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','data-placeholder','data-front-priority','data-front-order']});
    }
  }
  if(D.readyState==='loading') D.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
