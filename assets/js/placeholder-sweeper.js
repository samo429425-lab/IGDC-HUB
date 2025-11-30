/* placeholder sweeper - base */

/* --- Ghost cleaner enhancement --- */
(function(){
  function cleanGhosts(root){
    root = root || document;
    const cards = root.querySelectorAll('.card, .thumb-item, .ad-box, li.article, article');
    cards.forEach(el=>{
      const hasMedia = !!el.querySelector('img,video,iframe');
      const text = (el.textContent||'').replace(/\s+/g,' ').trim();
      const hasText  = !!text;
      const badHref  = !!el.querySelector('a[href="#"], a:not([href])');
      if ((!hasMedia && !hasText) || badHref){
        el.setAttribute('hidden',''); el.style.display='none'; return;
      }
      const t = el.querySelector('.thumb');
      const img = el.querySelector('img,video,iframe');
      if (t && !img){
        t.style.background='transparent';
        if(!hasText) { el.setAttribute('hidden',''); el.style.display='none'; }
      }
      if(!hasMedia && !hasText){
        el.style.boxShadow='none';
        el.style.background='transparent';
      }
    });
  }
  document.addEventListener('DOMContentLoaded', ()=> cleanGhosts(document));
  window.addEventListener('igdc:feed:ready', ()=> cleanGhosts(document));
  try {
    new MutationObserver(ms=>{
      for (const m of ms){
        if (m.addedNodes && m.addedNodes.length){ cleanGhosts(document); break; }
      }
    }).observe(document.documentElement,{childList:true,subtree:true});
  } catch(e){}
  window.IGDC = window.IGDC || {}; window.IGDC.cleanGhosts = cleanGhosts;
})();

