// network-rightpanel-automap.js
// Snapshot First → Auto Sample → Never Blank

(function(){
  'use strict';

  if (window.__NH_AUTO_V4__) return;
  window.__NH_AUTO_V4__ = true;

  const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
  const LIMIT = 100;

  const DESKTOP_ID = 'rightAutoPanel';
  const MOBILE_ID  = 'nh-mobile-rail-list';

  const PLACEHOLDER = '/assets/sample/placeholder.jpg';

  function $(id){ return document.getElementById(id); }

  function pick(it, keys){
    for(const k of keys){
      const v = it && it[k];
      if(typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function pickImg(it){
    return pick(it,['thumb','image','img','photo','cover']) || PLACEHOLDER;
  }

  function pickUrl(it){
    return pick(it,['url','href','link']) || '#';
  }

  function makeSample(i){
    return {
      title: 'Network Sample ' + (i+1),
      thumb: PLACEHOLDER,
      url: '#'
    };
  }

  function buildList(items){
    const list = Array.isArray(items) ? items.slice(0,LIMIT) : [];
    while(list.length < LIMIT){
      list.push(makeSample(list.length));
    }
    return list;
  }

  function createCard(item){
    const box = document.createElement('div');
    box.className = 'ad-box';

    const a = document.createElement('a');
    const href = pickUrl(item);
    a.href = href;

    if(href !== '#'){
      a.target = '_blank';
      a.rel = 'noopener';
    }

    const img = document.createElement('img');
    img.src = pickImg(item);
    img.loading = 'lazy';
    img.decoding = 'async';

    a.appendChild(img);
    box.appendChild(a);

    return box;
  }

  function render(box, list){
    if(!box) return;
    while(box.firstChild) box.removeChild(box.firstChild);
    list.forEach(it => box.appendChild(createCard(it)));
  }

  async function loadSnapshot(){
    try{
      const r = await fetch(SNAPSHOT_URL, {cache:'no-store'});
      if(!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j.items) ? j.items : [];
    }catch{
      return [];
    }
  }

  async function run(){
    const items = await loadSnapshot();
    const list = buildList(items);

    render($(DESKTOP_ID), list);
    render($(MOBILE_ID), list);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', run, {once:true});
  }else{
    run();
  }

})();