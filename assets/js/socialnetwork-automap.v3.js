
/* =========================================================
   socialnetwork-automap.v3.REBUILD-STABLE.js
   (Rebuilt version – right panel slots safe + mobile mirror)
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
const s = snap?.sections || snap?.pages?.social?.sections || snap;

if(s) return s;

}catch(e){}

}

throw new Error("snapshot load fail");

}

let cache=null;
let timer=null;

function mirrorRightPanelToMobile(){

const rightPanel=document.querySelector("#rightAutoPanel");
const mobileRail=document.querySelector("#socialMobileRailList");

if(!rightPanel || !mobileRail) return;

const cards=rightPanel.children;

if(!cards.length) return;

mobileRail.innerHTML="";

[...cards].forEach(card=>{
mobileRail.appendChild(card.cloneNode(true));
});

}

function renderAll(){

if(!cache) return;

renderMainRows(cache);

const right=cache[RIGHT_KEY]||[];

renderRightDesktop(right);

/* mirror AFTER automap rendering */
setTimeout(mirrorRightPanelToMobile,800);

}

async function boot(){

if(!document.getElementById("rowGrid1")) return;

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
