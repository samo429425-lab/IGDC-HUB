// IGDC Media Automap Stable

(function(){

'use strict';

if(window.__MEDIA_AUTOMAP_V3_STABLE__) return;
window.__MEDIA_AUTOMAP_V3_STABLE__ = true;

const q=(s,r)=> (r||document).querySelector(s);
const qa=(s,r)=> Array.from((r||document).querySelectorAll(s));

const lines = qa('.thumb-line[data-psom-key]');

if(!lines.length) return;

init();

async function init(){

  for(const line of lines){

    const key = line.dataset.psomKey;

    const items = await fetchFeed(key);

    render(line,items);

  }

  buildHero();

}

async function fetchFeed(key){

  try{

    const r = await fetch('/.netlify/functions/feed-media?key='+key+'&limit=50');

    const j = await r.json();

    return j.items||[];

  }catch(e){

    return [];

  }

}

function render(line,items){

  const cards = qa('a',line);

  for(let i=0;i<cards.length;i++){

    const item = items[i];

    if(!item) continue;

    const card = cards[i];

    const img = q('img',card);

    if(img && item.thumbnail){
      img.src = item.thumbnail;
    }

    const title = q('.title',card);

    if(title && item.title){
      title.textContent = item.title;
    }

    if(item.url){
      card.href = item.url;
    }

  }

}

async function buildHero(){

  const hero = q('.hero-card');

  if(!hero) return;

  try{

    const r = await fetch('/.netlify/functions/feed-media?key=media-trending&limit=1');
    const j = await r.json();

    const item = j.items[0];

    if(!item) return;

    const img = q('img',hero);
    const title = q('.title',hero);

    if(img && item.thumbnail) img.src=item.thumbnail;
    if(title && item.title) title.textContent=item.title;

    if(item.url) hero.href=item.url;

  }catch(e){}

}

})();