
'use strict';
/**
 * socialnetwork-automap.core.js
 * CORE Social AutoMap Engine (10Y+ Stable Edition)
 * Author: IGDC / MARU
 * Purpose: Snapshot/Feed driven, fail-safe, monetization-ready automap
 */

(function(){

/* ================= CONFIG ================= */

const FEED_URL = '/.netlify/functions/feed-social?page=socialnetwork';
const SNAPSHOT_URL = '/data/social.snapshot.json';

const MAX_ITEMS = 200;
const BATCH_SIZE = 12;

const SAFE_PLATFORMS = [
  'youtube','tiktok','instagram','facebook',
  'twitter','pinterest','reddit','wechat','weibo'
];

const DEBUG = false;

/* ================= UTIL ================= */

function log(){
  if(DEBUG) console.log.apply(console, arguments);
}

function safeJSON(text){
  try{ return JSON.parse(text); }
  catch(e){ return null; }
}

function qs(sel, root){
  return (root||document).querySelector(sel);
}

function qsa(sel, root){
  return Array.prototype.slice.call((root||document).querySelectorAll(sel));
}

function pick(obj, keys){
  for(const k of keys){
    const v = obj && obj[k];
    if(typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function nowISO(){
  return new Date().toISOString();
}

/* ================= LOADERS ================= */

async function loadSnapshot(){
  try{
    const r = await fetch(SNAPSHOT_URL, {cache:'no-store'});
    if(!r.ok) return null;
    return await r.json();
  }catch(e){
    return null;
  }
}

async function loadFeed(lang){
  let url = FEED_URL;
  if(lang) url += '&lang=' + encodeURIComponent(lang);

  try{
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok) return null;
    return await r.json();
  }catch(e){
    return null;
  }
}

/* ================= FILTER ================= */

function isBlocked(item){

  if(!item) return true;

  const bad = [
    /도박|베팅|카지노|바카라|토토/i,
    /성인|야동|porn|sex|escort/i,
    /마약|대마|코카인|필로폰/i,
    /사기|스캠|scam|피싱/i
  ];

  const txt = [
    item.title,
    item.channel,
    item.desc,
    item.url
  ].filter(Boolean).join(' ');

  if(bad.some(r=>r.test(txt))) return true;

  if(item.status && item.status !== 'live') return true;

  if(!item.url || !item.thumb) return true;

  if(item.platform && !SAFE_PLATFORMS.includes(item.platform)) return true;

  return false;
}

/* ================= NORMALIZE ================= */

function normalize(it, idx){

  return {
    id: it.id || ('sn-'+idx),
    title: pick(it,['title','name','label','caption']) || 'Item',
    url: pick(it,['url','href','link','path']) || '#',
    thumb: pick(it,['thumb','image','img','thumbnail','poster','cover']),
    channel: pick(it,['channel','author','owner']),
    platform: it.platform || it.source || null,
    priority: typeof it.priority === 'number' ? it.priority : 999999,
    revenue: it.revenue === true,
    signals: it.signals || null,
    raw: it
  };

}

/* ================= SCORE ================= */

function score(item){

  let s = 0;

  if(item.revenue) s += 5000;

  if(item.signals){
    if(typeof item.signals.quality_score === 'number'){
      s += item.signals.quality_score * 100;
    }
    if(typeof item.signals.trust_score === 'number'){
      s += item.signals.trust_score * 100;
    }
  }

  if(item.raw && item.raw.engagement){
    const e = item.raw.engagement;
    s += (e.views||0)/100;
    s += (e.likes||0)/10;
  }

  s -= item.priority;

  return s;
}

/* ================= RENDER ================= */

function makeCard(item){

  const a = document.createElement('a');
  a.className = 'thumb-card';
  a.href = item.url;
  a.target = '_blank';
  a.rel = 'noopener';

  const img = document.createElement('img');
  img.className = 'thumb-media';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = item.thumb;
  img.alt = item.title || '';

  const t = document.createElement('div');
  t.className = 'thumb-title';
  t.textContent = item.title;

  a.appendChild(img);
  a.appendChild(t);

  return a;
}


function render(container, items){

  let idx = 0;
  container.innerHTML = '';

  function mount(){

    const end = Math.min(idx + BATCH_SIZE, items.length);

    const frag = document.createDocumentFragment();

    for(let i=idx;i<end;i++){
      frag.appendChild(makeCard(items[i]));
    }

    container.appendChild(frag);
    idx = end;

    if(idx < items.length){
      observe();
    }
  }

  let io = null;

  function observe(){
    if(!('IntersectionObserver' in window)) return;

    if(io) io.disconnect();

    io = new IntersectionObserver(function(ent){
      ent.forEach(e=>{
        if(e.isIntersecting){
          io.disconnect();
          mount();
        }
      });
    }, {rootMargin:'600px'});

    if(container.lastElementChild){
      io.observe(container.lastElementChild);
    }
  }

  mount();
}

/* ================= CORE ================= */

async function run(){

  const boxes = qsa('[data-psom-key]');
  if(!boxes.length) return;

  const lang = (new URL(location.href)).searchParams.get('lang') || null;

  const snapshot = await loadSnapshot();
  const feed = await loadFeed(lang);

  let sectionMap = Object.create(null);

  /* snapshot priority */
  if(snapshot && snapshot.pages && snapshot.pages.social){
    sectionMap = snapshot.pages.social.sections || {};
    log('[CORE] snapshot loaded');
  }

  /* feed fallback */
  if(feed && feed.grid && Array.isArray(feed.grid.sections)){
    feed.grid.sections.forEach(s=>{
      if(!sectionMap[s.id]){
        sectionMap[s.id] = s.items || [];
      }
    });
    log('[CORE] feed merged');
  }

  boxes.forEach(box=>{

    const key = box.getAttribute('data-psom-key');
    if(!key) return;

    let raw = sectionMap[key] || [];

    if(!Array.isArray(raw)) raw = [];

    let list = raw
      .map(normalize)
      .filter(it=>!isBlocked(it));

    list.forEach(it=>{
      it.__score = score(it);
    });

    list.sort((a,b)=> b.__score - a.__score);

    list = list.slice(0, MAX_ITEMS);

   if(!list.length){
    box.innerHTML = '';
    box.classList.remove('thumb-grid','thumb-list','thumb-scroller');
    box.classList.add('empty-slot');
    box.innerHTML = '<div class="empty-msg">콘텐츠 준비 중입니다.</div>';
    box.style.padding = '12px';
   return;
  }


    render(box, list);

  });

  log('[CORE] done', nowISO());
}

/* ================= BOOT ================= */

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', run, {once:true});
}else{
  run();
}

})();
