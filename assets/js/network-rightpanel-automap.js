// network-rightpanel-automap.js (DISTRIBUTION STYLE - FINAL)

(function () {
  'use strict';

  if (window.__NETWORK_AUTOMAP_V3__) return;
  window.__NETWORK_AUTOMAP_V3__ = true;

  const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
  const LIMIT = 100;

  const DESKTOP = 'rightAutoPanel';
  const MOBILE = 'nh-mobile-rail-list';

  const PLACEHOLDER = '/assets/sample/placeholder.jpg';

  function $(id){ return document.getElementById(id); }

  function pick(it, keys){
    for (const k of keys){
      const v = it && it[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
  }

  function pickImg(it){
    return pick(it,['thumb','image','img','photo','cover']) || PLACEHOLDER;
  }

  function pickUrl(it){
    return pick(it,['url','href','link']) || '#';
  }

  function makeDummy(i){
    return {
      title: 'Network Item ' + (i+1),
      thumb: PLACEHOLDER,
      url: '#'
    };
  }

  function create(item){

    const box = document.createElement('div');
    box.className = 'ad-box';

    const a = document.createElement('a');
    const href = pickUrl(item);

    a.href = href;

    if (href !== '#'){
      a.target = '_blank';
      a.rel = 'noopener';
    }

    const img = document.createElement('img');
    img.src = pickImg(item);
    img.loading = 'lazy';

    a.appendChild(img);
    box.appendChild(a);

    return box;
  }

  async function loadSnapshot(){
    const r = await fetch(SNAPSHOT_URL,{ cache:'no-store' });
    if (!r.ok) throw new Error('snapshot fail');
    return r.json();
  }

  function buildList(items){

    const list = Array.isArray(items) ? items.slice(0,LIMIT) : [];

    while (list.length < LIMIT){
      list.push(makeDummy(list.length));
    }

    return list;
  }

  function render(box, list){

    if (!box) return;

    while (box.firstChild) box.removeChild(box.firstChild);

    list.forEach(it=>{
      box.appendChild(create(it));
    });
  }

  async function run(){

    try{

      const snap = await loadSnapshot();

      const raw = snap && Array.isArray(snap.items)
        ? snap.items
        : [];

      const list = buildList(raw);

      render($(DESKTOP), list);
      render($(MOBILE), list);

    }catch(e){
      console.error('[NETWORK] render fail', e);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', run, { once:true });
  }else{
    run();
  }

})();