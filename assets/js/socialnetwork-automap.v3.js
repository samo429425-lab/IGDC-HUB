
/* =========================================================
   IGDC SOCIAL AUTOMAP v5 REBUILD
   Desktop + Mobile Stable
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

let snapshotCache=null;

/* ---------------- CARD ---------------- */

function createCard(item){

const a=document.createElement("a");
a.className="social-card";
a.href=item.link || "#";
a.target="_blank";

const thumb=document.createElement("div");
thumb.className="thumb";

if(item.thumb){
thumb.style.backgroundImage='url("'+item.thumb+'")';
thumb.style.backgroundSize="cover";
thumb.style.backgroundPosition="center";
}

const body=document.createElement("div");
body.className="body";

const title=document.createElement("div");
title.className="title";
title.textContent=item.title || "Item";

const btn=document.createElement("div");
btn.className="cta";
btn.textContent="Open";

body.appendChild(title);
body.appendChild(btn);

a.appendChild(thumb);
a.appendChild(body);

return a;

}

/* ---------------- MAIN GRID ---------------- */

function renderMain(){

MAIN_ROWS.forEach(function(r){

const row=document.getElementById(r.rowId);
if(!row) return;

const grid=row.querySelector(".thumb-grid");
if(!grid) return;

grid.innerHTML="";

const items=snapshotCache[r.key] || [];

items.forEach(function(it){
grid.appendChild(createCard(it));
});

});

}

/* ---------------- RIGHT PANEL ---------------- */

function renderRight(){

const panel=document.getElementById("rightAutoPanel");
if(!panel) return;

panel.innerHTML="";

const items=snapshotCache[RIGHT_KEY] || [];

items.forEach(function(it){

const box=document.createElement("div");
box.className="ad-box";

box.appendChild(createCard(it));

panel.appendChild(box);

});

}

/* ---------------- MOBILE RAIL ---------------- */

function ensureMobileRail(){

let rail=document.getElementById("socialMobileRailList");

if(!rail){

const container=document.createElement("div");
container.id="socialMobileRailList";

const target=document.querySelector("main, .container, body");

if(target){
target.appendChild(container);
}

rail=container;

}

return rail;

}

function mirrorRightToMobile(){

const panel=document.getElementById("rightAutoPanel");
if(!panel) return;

const rail=ensureMobileRail();

rail.innerHTML="";

panel.querySelectorAll(".ad-box").forEach(function(el){

rail.appendChild(el.cloneNode(true));

});

}

/* ---------------- SNAPSHOT LOAD ---------------- */

async function fetchJson(url){

const r=await fetch(url,{cache:"no-store"});
if(!r.ok) throw new Error();
return await r.json();

}

async function loadSnapshot(){

for(const url of SNAPSHOT_URLS){

try{

const j=await fetchJson(url);
const snap=j.snapshot || j;
const sections=snap?.pages?.social?.sections;

if(sections) return sections;

}catch(e){}

}

throw new Error("snapshot load fail");

}

/* ---------------- RENDER ---------------- */

function renderAll(){

renderMain();
renderRight();
mirrorRightToMobile();

}

/* ---------------- BOOT ---------------- */

async function boot(){

try{

snapshotCache=await loadSnapshot();

renderAll();

window.addEventListener("resize",function(){

setTimeout(function(){

mirrorRightToMobile();

},300);

},{passive:true});

}catch(e){

console.warn("automap fail",e);

}

}

if(document.readyState==="loading"){
document.addEventListener("DOMContentLoaded",boot,{once:true});
}else{
boot();
}

})();
