
/* =========================================================
   socialnetwork-automap.v3.js  (FINAL FIXED VERSION)
   ========================================================= */

(function(){
"use strict";

const SNAPSHOT_URLS=[
"/data/social.snapshot.json",
"/social.snapshot.json",
"/snapshots/social.snapshot.json",
"/.netlify/functions/feed-social"
];

const MAIN_ROWS=[
{rowId:"rowGrid1",key:"social-youtube"},
{rowId:"rowGrid2",key:"social-instagram"},
{rowId:"rowGrid3",key:"social-tiktok"},
{rowId:"rowGrid4",key:"social-facebook"},
{rowId:"rowGrid5",key:"social-discord"},
{rowId:"rowGrid6",key:"social-community"},
{rowId:"rowGrid7",key:"social-threads"},
{rowId:"rowGrid8",key:"social-telegram"},
{rowId:"rowGrid9",key:"social-twitter"}
];

const RIGHT_KEY="socialnetwork";
const MAIN_LIMIT=50;
const RIGHT_LIMIT=100;

function createCard(it,row){

const a=document.createElement("a");
a.className="social-card";
a.href=it?.link||"#";
a.target="_blank";

if(row) a.dataset.row=row;

const thumb=document.createElement("div");
thumb.className="thumb";

if(it?.thumb){
thumb.style.backgroundImage='url("'+it.thumb+'")';
thumb.style.backgroundSize="cover";
thumb.style.backgroundPosition="center";
}

const body=document.createElement("div");
body.className="body";

const title=document.createElement("div");
title.className="title";
title.textContent=it?.title||"Item";

body.appendChild(title);

if(it?.desc){
const d=document.createElement("div");
d.className="desc";
d.textContent=it.desc;
body.appendChild(d);
}

const btn=document.createElement("div");
btn.className="cta";
btn.textContent="Open";

body.appendChild(btn);

a.appendChild(thumb);
a.appendChild(body);

return a;
}

function renderList(container,list,limit,row){

if(!container) return;

container.innerHTML="";

(list||[]).slice(0,limit).forEach(it=>{
container.appendChild(createCard(it,row));
});

}

function renderMainRows(sections){

MAIN_ROWS.forEach((r,i)=>{

if(r.key===RIGHT_KEY) return;

const row=document.getElementById(r.rowId);
if(!row) return;

const grid=row.querySelector('.thumb-grid[data-psom-key="'+r.key+'"]');

if(!grid) return;

renderList(grid,sections[r.key],MAIN_LIMIT,i+1);

});

}

function renderRightDesktop(items){

const panel=document.getElementById("rightAutoPanel");
if(!panel) return;

panel.innerHTML="";

(items||[]).slice(0,RIGHT_LIMIT).forEach(it=>{

const box=document.createElement("div");
box.className="ad-box";

box.innerHTML='<a href="'+(it?.link||"#")+'" target="_blank">Item</a>';

panel.appendChild(box);

});

s
function syncRightToMobileRail(){
  try{
    const panel = document.getElementById("rightAutoPanel");
    const mobileList = document.getElementById("socialMobileRailList") || document.querySelector("#social-mobile-rail .list");
    if(!panel || !mobileList) return;

    // clone existing right items into the mobile rail list (keeps desktop untouched)
    const kids = Array.from(panel.children).filter(n => n && n.nodeType===1);
    if(kids.length===0) return;

    mobileList.innerHTML = "";
    kids.slice(0, RIGHT_LIMIT).forEach((node)=>{
      const clone = node.cloneNode(true);
      // avoid duplicated ids
      if(clone.id) clone.removeAttribute("id");
      mobileList.appendChild(clone);
    });
  }catch(e){}
}

function watchRightPanelForMobileSync(){
  const panel = document.getElementById("rightAutoPanel");
  if(!panel || panel.__smrObs) return;
  panel.__smrObs = new MutationObserver(()=>syncRightToMobileRail());
  panel.__smrObs.observe(panel,{childList:true,subtree:false});
}
yncRightToMobileRail();

}

function renderRightMobile(items){

  // Mobile: still render into #rightAutoPanel (hidden by CSS) so the page-level
  // mobile-rail cloner can duplicate cards into #social-mobile-rail.
  renderRightDesktop(items);

}

async function fetchJson(url){

const r=await fetch(url,{cache:"no-store"});
if(!r.ok) throw new Error();

return await r.json();

}

async function loadSections(){

for(const u of SNAPSHOT_URLS){

try{

const j=await fetchJson(u);
const snap=j?.snapshot||j;
const s=snap?.pages?.social?.sections;

if(s) return s;

}catch(e){}

}

throw new Error("snapshot load fail");

}

let cache=null;
let timer=null;

function renderAll(){

if(!cache) return;

renderMainRows(cache);

const right=cache[RIGHT_KEY]||[];

renderRightDesktop(right);
renderRightMobile(right);

}

async function boot(){

if(!document.getElementById("rowGrid1")) return;

watchRightPanelForMobileSync();

try{

cache=await loadSections();

renderAll();

window.addEventListener("resize",()=>{

clearTimeout(timer);
timer=setTimeout(renderAll,150);

},{passive:true});

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
