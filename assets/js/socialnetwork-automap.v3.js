'use strict';
/**
 * socialnetwork-automap.v3.js — OpenLab (AutoMap) FINAL
 * 역할: socialnetwork.html의 [data-psom-key] 컨테이너에 feed-social 결과를 꽂는다.
 */
(function(){
  var FEED_URL = '/.netlify/functions/feed-social?page=socialnetwork';

  function qsLang(){
    try{
      var u = new URL(location.href);
      return (u.searchParams.get('lang') || '').trim();
    }catch(e){ return ''; }
  }

  function el(tag, cls){
    var n = document.createElement(tag);
    if(cls) n.className = cls;
    return n;
  }

  function renderCard(item){
    var a = el('a','thumb-card');
    a.href = item && item.url ? item.url : '#';
    a.target = '_blank';
    a.rel = 'noopener';

    var imgSrc = item && item.thumb ? item.thumb : '';
    if(imgSrc){
      var img = el('img','thumb-media');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = imgSrc;
      img.alt = (item && item.title) ? item.title : 'thumb';
      a.appendChild(img);
    } else {
      var ph = el('div','thumb-media');
      ph.style.display = 'block';
      ph.style.width = '100%';
      ph.style.aspectRatio = '4/3';
      ph.style.background = 'rgba(0,0,0,0.06)';
      a.appendChild(ph);
    }

    var t = el('div','thumb-title');
    t.textContent = (item && item.title) ? item.title : 'Item';
    a.appendChild(t);
    return a;
  }

  function fillContainer(container, items){
    container.innerHTML = '';
    var frag = document.createDocumentFragment();
    for(var i=0;i<items.length;i++){
      frag.appendChild(renderCard(items[i]));
    }
    container.appendChild(frag);
  }

  function main(){
    var containers = document.querySelectorAll('[data-psom-key]');
    if(!containers || !containers.length) return;

    var lang = qsLang();
    var url = FEED_URL + (lang ? ('&lang=' + encodeURIComponent(lang)) : '');

    fetch(url, { cache:'no-store' })
      .then(function(res){ if(!res.ok) throw new Error('http '+res.status); return res.json(); })
      .then(function(data){
        var sections = (data && data.grid && Array.isArray(data.grid.sections)) ? data.grid.sections : [];
        var map = Object.create(null);
        for(var i=0;i<sections.length;i++){
          map[sections[i].id] = Array.isArray(sections[i].items) ? sections[i].items : [];
        }
        for(var j=0;j<containers.length;j++){
          var c = containers[j];
          var key = (c.getAttribute('data-psom-key') || '').trim();
          if(!key) continue;
          fillContainer(c, map[key] || []);
        }
      })
      .catch(function(err){
        console.warn('[social-automap] feed failed:', err && err.message);
      });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', main, { once:true });
  } else {
    main();
  }
})();
