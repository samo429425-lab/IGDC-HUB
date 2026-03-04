
/* =========================================================
   socialnetwork-automap.mobilefix.js
   Desktop logic unchanged / Mobile rail auto-fix
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

let cache=null;

/* ---------------- Card ---------------- */

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

const btn=document.createElement("div");
btn.className="cta";
btn.textContent="Open";

body.appendChild(btn);

a.appendChild(thumb);
a.appendChild(body);

return a;
}

/* ---------------- Main Rows ---------------- */

function renderMainRows(sections){

MAIN_ROWS.forEach((r,i)=>{

if(r.key===RIGHT_KEY) return;

const row=document.getElementById(r.rowId);
if(!row) return;

const grid=row.querySelector('.thumb-grid[data-psom-key="'+r.key+'"]');
if(!grid) return;

grid.innerHTML="";

(sections[r.key]||[]).slice(0,MAIN_LIMIT).forEach(it=>{
grid.appendChild(createCard(it,i+1));
});

});

}

/* ---------------- Right Panel ---------------- */

function renderRightPanel(items){

const panel=document.getElementById("rightAutoPanel");
if(!panel) return;

panel.innerHTML="";

(items||[]).slice(0,RIGHT_LIMIT).forEach(it=>{

const box=document.createElement("div");
box.className="ad-box";

box.appendChild(createCard(it));

panel.appendChild(box);

});

}

/* ---------------- Mobile Mirror ---------------- */

function mirrorRightPanel(){

const right=document.getElementById("rightAutoPanel");
const rail=document.getElementById("socialMobileRailList");

if(!right || !rail) return;

const cards=right.querySelectorAll(".ad-box");

if(cards.length===0) return;

rail.innerHTML="";

cards.forEach(card=>{
rail.appendChild(card.cloneNode(true));
});

}

/* wait until mobile rail exists */

function waitForMobileRail(){

const rail=document.getElementById("socialMobileRailList");

if(!rail){
setTimeout(waitForMobileRail,200);
return;
}

mirrorRightPanel();

}

/* ---------------- Render ---------------- */

function renderAll(){

if(!cache) return;

renderMainRows(cache);

const right=cache[RIGHT_KEY]||[];

renderRightPanel(right);

/* mobile fix */

waitForMobileRail();

}

/* ---------------- Snapshot ---------------- */

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

/* ---------------- Boot ---------------- */

async function boot(){

if(!document.getElementById("rowGrid1")) return;

try{

cache=await loadSections();

renderAll();

setTimeout(()=>{
renderRightPanel(cache[RIGHT_KEY] || []);
mirrorRightPanel();
},300);

window.addEventListener("resize",()=>{

setTimeout(mirrorRightPanel,300);

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
