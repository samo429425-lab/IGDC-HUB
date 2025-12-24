(function(){
  'use strict';

  var IS_DESKTOP = !matchMedia('(max-width:1024px)').matches;

  function qsAll(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }

  function removeLegacySentinels(){
    try{
      qsAll('.thumb-sentinel').forEach(function(n){
        try{ n.remove(); }catch(e){ if(n && n.parentNode) n.parentNode.removeChild(n); }
      });
    }catch(e){}
  }

  function normalizeItems(payload){
    if(!payload) return [];
    if(Array.isArray(payload.items)) return payload.items;
    if(Array.isArray(payload)) return payload;
    if(payload.data && Array.isArray(payload.data.items)) return payload.data.items;
    return [];
  }

  function getItemFields(it){
    if(!it) it = {};
    var title = (it.title || it.name || it.caption || '상품').toString();
    var url   = (it.url || it.href || it.link || it.detailUrl || '#').toString();
    var thumb = (it.thumbnail || it.thumb || it.img || it.image || it.photo || '/assets/img/placeholder.png').toString();
    var price = (it.price || it.cost || it.amount || '').toString();
    var tag   = (it.tag || it.badge || '').toString();
    return {title:title, url:url, thumb:thumb, price:price, tag:tag};
  }

  function buildCard(it){
    var f = getItemFields(it);

    var article = document.createElement('article');
    article.className = 'thumb-card';
    article.setAttribute('role','button');
    article.setAttribute('tabindex','0');
    article.setAttribute('aria-label', f.title);

    var img = document.createElement('img');
    img.className = 'thumb-img';
    img.alt = f.title + ' 썸네일';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = f.thumb;

    var body = document.createElement('div');
    body.className = 'thumb-body';

    var t = document.createElement('div');
    t.className = 'thumb-title';
    t.textContent = f.title;

    var meta = document.createElement('div');
    meta.className = 'thumb-meta';

    var price = document.createElement('div');
    price.className = 'thumb-price';
    price.textContent = f.price || '';

    var badge = document.createElement('span');
    badge.className = 'thumb-tag ' + (f.tag || '');
    badge.textContent = (f.tag === 'ad') ? 'AD' : (f.tag || '');

    meta.appendChild(price);
    meta.appendChild(badge);

    body.appendChild(t);
    body.appendChild(meta);

    article.appendChild(img);
    article.appendChild(body);

    function go(){
      if(!f.url || f.url === '#') return;
      try{ window.open(f.url, '_blank', 'noopener'); }catch(e){ location.href = f.url; }
    }
    article.addEventListener('click', function(){ go(); });
    article.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); }
    });

    return article;
  }

  async function fetchJSON(url){
    var r = await fetch(url, {cache:'no-store'});
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }

  async function loadItemsForKey(key){
    var tries = [
      '/.netlify/functions/feed?key=' + encodeURIComponent(key),
      '/.netlify/functions/feed?page=' + encodeURIComponent(key),
      '/assets/data/' + encodeURIComponent(key) + '.json',
      '/assets/data/' + encodeURIComponent(key).replace(/_/g,'-') + '.json'
    ];

    for(var i=0;i<tries.length;i++){
      try{
        var data = await fetchJSON(tries[i]);
        var items = normalizeItems(data);
        if(items && items.length) return items;
      }catch(e){}
    }
    return [];
  }

  async function rerender(){
    try{
      removeLegacySentinels();

      var grids = qsAll('.thumb-grid[data-psom-key]');
      if(!grids.length) return;

      grids.forEach(function(g){
        try{ delete g._igdcPool; delete g._igdcRendered; }catch(e){}
      });

      for(var i=0;i<grids.length;i++){
        var grid = grids[i];
        var key = (grid.getAttribute('data-psom-key') || '').trim();
        if(!key) continue;

        grid.innerHTML = '';
        var items = await loadItemsForKey(key);

        var max = 40;
        for(var j=0;j<items.length && j<max;j++){
          grid.appendChild(buildCard(items[j]));
        }
      }

      setTimeout(removeLegacySentinels, 120);
    }catch(e){}
  }

  function boot(){
    if(!IS_DESKTOP) return;

    setTimeout(rerender, 50);
    setTimeout(rerender, 400);
    setTimeout(rerender, 1200);

    window.addEventListener('resize', function(){ setTimeout(rerender, 250); }, {passive:true});
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, {once:true});
  } else {
    boot();
  }
})();