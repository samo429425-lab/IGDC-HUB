
/* NETWORK AUTOMAP v2 - desktop safe */

(function(){
'use strict';

const HUB = 'network';
const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
const FEED_SRC = '/assets/js/feed-network.js';
const SLOT_COUNT = 100;

function $(s,r=document){return r.querySelector(s);}

function ensureScript(src){
 return new Promise((res,rej)=>{
  const e=[...document.scripts].find(s=>(s.src||'')===src);
  if(e){ if(e.dataset.loaded==='1') return res();
    e.addEventListener('load',()=>res(),{once:true});
    return;
  }
  const s=document.createElement('script');
  s.src=src; s.async=true;
  s.dataset.loaded='0';
  s.onload=()=>{s.dataset.loaded='1';res();};
  s.onerror=()=>rej(src);
  document.head.appendChild(s);
 });
}

function disablePsom(){
 const g=$('.thumb-grid[data-psom-key="network"]');
 if(!g) return;
 g.innerHTML='';
 g.style.visibility='hidden';
 g.style.height='0';
 g.style.overflow='hidden';
 g.dataset.disabled='1';
}

function build(panel){
 panel.innerHTML='';
 const arr=[];
 for(let i=0;i<SLOT_COUNT;i++){
  const d=document.createElement('div');
  d.className='ad-box';
  d.dataset.slot=i+1;
  panel.appendChild(d);
  arr.push(d);
 }
 return arr;
}

async function run(){
 if(window.__NET_AUTOMAP_V2__) return;
 window.__NET_AUTOMAP_V2__=1;

 const panel=document.getElementById('rightAutoPanel');
 if(!panel) return;

 disablePsom();
 const slots=build(panel);

 await ensureScript(FEED_SRC);

 if(!window.IGDC_FEED_NETWORK) return;

 await window.IGDC_FEED_NETWORK.fill({
  hubKey:HUB,
  snapshotUrl:SNAPSHOT_URL,
  slots:slots
 });
}

window.addEventListener('load',()=>run());

})();
