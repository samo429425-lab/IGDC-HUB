
/* IGDC SOCIAL AUTOMAP - STABLE (overwrite existing v3) */

(async function(){

const SNAPSHOT_URLS=[
"/data/social.snapshot.json",
"/social.snapshot.json",
"/snapshots/social.snapshot.json",
"/.netlify/functions/feed-social"
];

async function loadSnapshot(){
for(const url of SNAPSHOT_URLS){
try{
const r=await fetch(url,{cache:"no-store"});
if(!r.ok) continue;
const j=await r.json();
const snap=j.snapshot||j;
const sections=snap?.pages?.social?.sections;
if(sections) return sections;
}catch(e){}
}
throw new Error("snapshot load fail");
}

function createCard(item){
const card=document.createElement("div");
card.className="snapshot-card";
card.innerHTML=`
<div class="thumb"></div>
<div class="title">${item?.title||""}</div>
<a class="cta" href="${item?.link||"#"}" target="_blank">Open</a>
`;
return card;
}

function render(sections){

Object.keys(sections).forEach(key=>{

const slot=document.querySelector('[data-psom-key="'+key+'"]');
if(!slot) return;

slot.innerHTML="";

(sections[key]||[]).forEach(item=>{
slot.appendChild(createCard(item));
});

});

}

async function boot(){

try{

const sections=await loadSnapshot();
render(sections);

}catch(e){
console.warn("automap error",e);
}

}

if(document.readyState==="loading"){
document.addEventListener("DOMContentLoaded",boot,{once:true});
}else{
boot();
}

})();
