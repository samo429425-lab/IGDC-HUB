/* Distribution right-panel mobile mirror v4.
 * The canonical AutoMap owns the source and its complete ordered product list.
 * This file NEVER inserts placeholder cards into the authoritative source rail.
 * No country cache, URL rewriting or extra product-network request is used.
 */
(function(){
  'use strict';
  if(window.__IGDC_DISTRIBUTION_RIGHT_MIRROR_V4__)return;
  window.__IGDC_DISTRIBUTION_RIGHT_MIRROR_V4__=true;
  var MAX=100, sourceNodes=[], mobileView=window.matchMedia ? window.matchMedia('(max-width:1024px)') : null;
  var scheduled=false, source=null, target=null;
  // Desktop source cards are hidden on mobile, so their image observer never
  // fires. The mobile clone must independently reveal the exact same image.
  var imageObserver=null;
  function showImage(el){
    if(!el)return;
    var url=el.dataset.igdcDeferredBg||'';
    if(!url)return;
    el.style.setProperty('background-image',"url('"+url.replace(/'/g,'%27')+"')",'important');
    el.style.setProperty('background-size','contain','important');
    el.style.setProperty('background-position','center center','important');
    el.style.setProperty('background-repeat','no-repeat','important');
    el.style.setProperty('background-color','#fff','important');
    delete el.dataset.igdcDeferredBg;
  }
  function prepareImage(card,index){
    var img=card.querySelector('.thumb-img[data-igdc-deferred-bg]');
    if(!img)return;
    if(index<4||!('IntersectionObserver' in window)){showImage(img);return;}
    if(!imageObserver){
      imageObserver=new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(!entry.isIntersecting)return;
          imageObserver.unobserve(entry.target);
          showImage(entry.target);
        });
      },{root:null,rootMargin:'550px 300px',threshold:.01});
    }
    imageObserver.observe(img);
  }
  function mobile(){return !mobileView || mobileView.matches;}
  function placeholder(index){
    var card=document.createElement('div');
    card.className='thumb-card thumb-card--seed';
    card.setAttribute('data-igdc-sample','1');
    var pic=document.createElement('div');pic.className='thumb-img';
    var title=document.createElement('div');title.className='thumb-title';title.textContent='Recommended Brand '+(index+1);
    card.appendChild(pic);card.appendChild(title);
    return card;
  }
  function mirror(){
    scheduled=false;
    if(!mobile()||!source||!target)return;
    // Keep the scroll position; replacing all 100 cards on every batch causes
    // mobile rail jumps, heavy layout and duplicate image decoding.
    var pos=target.scrollLeft;
    var count=Math.min(source.children.length,MAX);
    for(var i=0;i<count;i++){
      var node=source.children[i];
      if(sourceNodes[i]===node)continue;
      var copy=node.cloneNode(true);
      // cloneNode does not copy the canonical card's click/keyboard handlers.
      // Forward user intent to that exact source card; never rebuild its URL.
      if(node.getAttribute('role')==='link'){
        (function(original,replica){
          replica.addEventListener('click',function(event){
            event.preventDefault();event.stopPropagation();original.click();
          });
          replica.addEventListener('keydown',function(event){
            if(event.key==='Enter'||event.key===' '){
              event.preventDefault();event.stopPropagation();original.click();
            }
          });
        })(node,copy);
      }
      prepareImage(copy,i);
      if(target.children[i])target.replaceChild(copy,target.children[i]);
      else target.appendChild(copy);
      sourceNodes[i]=node;
    }
    // If the canonical source becomes shorter during a refresh, old mobile
    // real cards must not remain visible in the now-unfilled sample slots.
    for(var j=count;j<sourceNodes.length;j++){
      if(target.children[j])target.replaceChild(placeholder(j),target.children[j]);
    }
    sourceNodes.length=count;
    while(target.children.length<MAX)target.appendChild(placeholder(target.children.length));
    while(target.children.length>MAX)target.removeChild(target.lastElementChild);
    if(target.scrollLeft!==pos)target.scrollLeft=pos;
  }
  function schedule(){
    if(scheduled||!mobile())return;
    scheduled=true;
    if(typeof window.requestAnimationFrame==='function')window.requestAnimationFrame(mirror);
    else window.setTimeout(mirror,16);
  }
  function maybeExtend(){
    if(!mobile()||!source||!target)return;
    var visible=Math.min(source.children.length,MAX);
    if(!visible)return;
    var last=target.children[visible-1];
    if(!last)return;
    if(target.scrollLeft+target.clientWidth*2 < last.offsetLeft)return;
    var api=window.IGDCDistributionRightRail;
    if(api&&typeof api.appendNextBatch==='function'&&api.appendNextBatch())schedule();
  }
  function boot(){
    source=document.querySelector('.thumb-grid[data-psom-key="distribution-right"]');
    target=document.getElementById('mobile-ad-rail-list');
    if(!source||!target)return;
    // Observe only the canonical source and only for added/replaced product cards.
    if('MutationObserver' in window)new MutationObserver(function(){schedule();}).observe(source,{childList:true});
    target.addEventListener('scroll',function(){maybeExtend();},{passive:true});
    window.addEventListener('igdc:distribution-full-snapshot',function(){maybeExtend();schedule();});
    window.addEventListener('resize',function(){schedule();maybeExtend();},{passive:true});
    if(mobileView && mobileView.addEventListener)mobileView.addEventListener('change',function(){schedule();maybeExtend();});
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
