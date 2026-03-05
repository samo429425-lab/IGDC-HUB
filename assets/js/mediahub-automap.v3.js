/* mediahub-automap.v4.stable.js */

(function(){
'use strict';

if(window.__MEDIA_AUTOMAP_V4__) return;
window.__MEDIA_AUTOMAP_V4__ = true;

const D=document;
const LIMIT=50;

const SNAPSHOT_URL="/data/media.snapshot.json";

function q(s,r){return (r||D).querySelector(s)}
function qa(s,r){return Array.from((r||D).querySelectorAll(s))}

function canonKey(k){
 if(!k) return '';
 if(k.startsWith('media-')) return k;

 const alias={
  trending_now:'media-trending',
  latest_movie:'media-movie',
  latest_drama:'media-drama'
 };

 return alias[k]||k;
}

async function fetchJSON(url){
 try{
  const r=await fetch(url,{cache:'no-store'});
  if(!r.ok) throw new Error();
  return await r.json();
 }catch(e){
  return null;
 }
}

async function loadSnapshot(){
 return await fetchJSON(SNAPSHOT_URL);
}

function extractItems(section){
 if(!section) return [];

 if(Array.isArray(section.items))
  return section.items;

 if(Array.isArray(section.slots)){
  return section.slots.map(s=>({
   title:s.title||"",
   thumbnail:s.thumb||"",
   url:s.url||s.video||"#"
  }));
 }

 return [];
}

function makePlaceholder(){
 const a=D.createElement("a");
 a.className="card media-card";
 a.dataset.placeholder="true";
 a.href="javascript:void(0)";

 const thumb=D.createElement("div");
 thumb.className="thumb ph";

 const meta=D.createElement("div");
 meta.className="meta";
 meta.textContent="Coming Soon";

 a.appendChild(thumb);
 a.appendChild(meta);

 return a;
}

function ensurePlaceholders(line){

 let ph=qa('[data-placeholder="true"]',line);

 if(ph.length===0){

  const cards=qa('a.card',line);

  cards.forEach(c=>{
   if(!q('img',c)){
    c.dataset.placeholder="true";
   }
  });

  ph=qa('[data-placeholder="true"]',line);
 }

 if(ph.length<LIMIT){
  const frag=D.createDocumentFragment();

  for(let i=ph.length;i<LIMIT;i++)
   frag.appendChild(makePlaceholder());

  line.appendChild(frag);
 }

 return qa('[data-placeholder="true"]',line);
}

function fillCard(a,item){

 const title=item.title||"";
 const thumb=item.thumbnail||"";
 const url=item.url||"#";

 a.href=url;
 a.target="_blank";

 let thumbBox=q(".thumb",a);
 if(!thumbBox){
  thumbBox=D.createElement("div");
  thumbBox.className="thumb";
  a.prepend(thumbBox);
 }

 let img=q("img",thumbBox);
 if(!img){
  img=D.createElement("img");
  thumbBox.appendChild(img);
 }

 img.src=thumb;
 img.alt=title;
 img.loading="lazy";

 let meta=q(".meta",a);
 if(!meta){
  meta=D.createElement("div");
  meta.className="meta";
  a.appendChild(meta);
 }

 meta.textContent=title;

 delete a.dataset.placeholder;
}

function applyItems(line,items){

 if(!items||items.length===0) return;

 const ph=ensurePlaceholders(line);

 const n=Math.min(items.length,ph.length);

 for(let i=0;i<n;i++)
  fillCard(ph[i],items[i]);
}

async function main(){

 const lines=qa(".thumb-line[data-psom-key]");
 if(lines.length===0) return;

 lines.forEach(ensurePlaceholders);

 const snapshot=await loadSnapshot();

 let sectionMap={};

 if(snapshot && snapshot.sections){
  snapshot.sections.forEach(s=>{
   sectionMap[canonKey(s.key)]=s;
  });
 }

 for(const line of lines){

  const key=canonKey(line.dataset.psomKey);

  if(!key.startsWith("media-")) continue;
  if(key==="media-hero") continue;

  let items=[];

  try{
   const feed=await fetchJSON(
    `/.netlify/functions/feed-media?key=${key}&limit=50`
   );

   if(feed && feed.items)
    items=feed.items;

  }catch(e){}

  if(items.length===0){
   items=extractItems(sectionMap[key]);
  }

  applyItems(line,items);
 }
}

if(document.readyState==="loading")
 document.addEventListener("DOMContentLoaded",main);
else
 main();

})();