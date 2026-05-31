(function(global){
  'use strict';
  function ready(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function pickImage(card){
    return card && (card.getAttribute('data-image') || card.getAttribute('data-thumb') || card.querySelector('img') && card.querySelector('img').getAttribute('src'));
  }
  ready(function(){
    try{
      var root = document.querySelector('[data-media-hero], .media-hero, #mediaHero');
      if(!root) return;
      var first = document.querySelector('[data-media-item], .media-card, .content-card');
      var img = first && pickImage(first);
      if(img && !root.querySelector('img')){
        var el = document.createElement('img'); el.src = img; el.alt = '';
        root.insertBefore(el, root.firstChild || null);
      }
      root.setAttribute('data-maru-media-hero-ready','1');
    }catch(e){}
  });
  global.MaruMediaHeroEngine = global.MaruMediaHeroEngine || { ready:true };
})(window);
