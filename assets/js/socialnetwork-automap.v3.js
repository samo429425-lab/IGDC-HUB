
/* =========================================================
   socialnetwork-automap.v3.js  (patched mobile split)
   - Desktop: #rightAutoPanel (unchanged)
   - Mobile : #rpMobileGrid only
   ========================================================= */

(function () {
"use strict";

const MAIN_ROWS = [
  { rowId:"rowGrid1", key:"social-youtube"},
  { rowId:"rowGrid2", key:"social-instagram"},
  { rowId:"rowGrid3", key:"social-tiktok"},
  { rowId:"rowGrid4", key:"social-facebook"},
  { rowId:"rowGrid5", key:"social-discord"},
  { rowId:"rowGrid6", key:"social-community"},
  { rowId:"rowGrid7", key:"social-threads"},
  { rowId:"rowGrid8", key:"social-telegram"},
  { rowId:"rowGrid9", key:"social-twitter"},
];

const RIGHT_PANEL_KEY="socialnetwork";
const MAIN_ROW_LIMIT=50;
const RIGHT_PANEL_LIMIT=100;

function $(s,r){return (r||document).querySelector(s);}

function card(it,row){
 const a=document.createElement("a");
 a.className="social-card";
 a.href=it?.link||"#";
 a.target="_blank";
 if(row)a.dataset.row=row;

 const t=document.createElement("div");
 t.className="thumb";
 if(it?.thumb){
   t.style.backgroundImage=`url("${it.thumb}")`;
   t.style.backgroundSize="cover";
   t.style.backgroundPosition="center";
 }

 const b=document.createElement("div");
 b.className="body";

 const h=document.createElement("div");
 h.className="title";
 h.textContent=it?.title||"Item";

 b.appendChild(h);
 a.appendChild(t);
 a.appendChild(b);
 return a;
}

function renderCards(container,list,row){
 if(!container)return;
 container.innerHTML="";
 (list||[]).slice(0,MAIN_ROW_LIMIT).forEach(it=>{
   container.appendChild(card(it,row));
 });
}

function renderMainRows(sections){
 MAIN_ROWS.forEach((r,i)=>{
   const row=document.getElementById(r.rowId);
   if(!row)return;
   const target=row.querySelector('.thumb-grid[data-psom-key="'+r.key+'"]');
   if(!target)return;
   renderCards(target,sections[r.key],i+1);
 });
}

/* DESKTOP RIGHT PANEL */
function renderRightDesktop(items){
 const panel=document.getElementById("rightAutoPanel");
 if(!panel)return;

 if(typeof window.__IGDC_RIGHTPANEL_RENDER==="function"){
   window.__IGDC_RIGHTPANEL_RENDER(items||[]);
   return;
 }

 panel.innerHTML="";
 (items||[]).slice(0,RIGHT_PANEL_LIMIT).forEach(it=>{
   const d=document.createElement("div");
   d.className="ad-box";
   d.innerHTML='<a href="'+(it?.link||"#")+'" target="_blank">Item</a>';
   panel.appendChild(d);
 });
}

/* MOBILE RIGHT PANEL */
function renderRightMobile(items){
 if(window.innerWidth>1024)return;

 const mobile=document.getElementById("rpMobileGrid");
 if(!mobile)return;

 mobile.innerHTML="";
 (items||[]).slice(0,RIGHT_PANEL_LIMIT).forEach(it=>{
   mobile.appendChild(card(it,null));
 });
}

async function loadSnapshot(){
 const urls=[
 "/data/social.snapshot.json",
 "/social.snapshot.json",
 "/snapshots/social.snapshot.json",
 "/.netlify/functions/feed-social"
 ];

 for(const u of urls){
   try{
     const r=await fetch(u,{cache:"no-store"});
     if(!r.ok)continue;
     const j=await r.json();
     const s=j?.snapshot||j;
     if(s?.pages?.social?.sections)return s.pages.social.sections;
   }catch(e){}
 }
 throw new Error("snapshot load fail");
}

let cache=null;

function renderAll(){
 if(!cache)return;
 renderMainRows(cache);
 const rp=cache[RIGHT_PANEL_KEY]||[];
 renderRightDesktop(rp);
 renderRightMobile(rp);
}

async function boot(){
 if(!document.getElementById("rowGrid1"))return;

 try{
   cache=await loadSnapshot();
   renderAll();

   window.addEventListener("resize",()=>{
     setTimeout(renderAll,120);
   });

 }catch(e){
   console.warn("social automap fail",e);
 }
}

if(document.readyState==="loading"){
 document.addEventListener("DOMContentLoaded",boot,{once:true});
}else{
 boot();
}

})();
