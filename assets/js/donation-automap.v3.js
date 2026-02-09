
"use strict";

async function fetchDonation(){
  const r = await fetch("/.netlify/functions/donation-feed",{cache:"no-store"});
  if(!r.ok) throw new Error("FEED_ERROR");
  return r.json();
}

function esc(s){
  return String(s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function card(it){

  const a = document.createElement("a");

  a.className = "donation-card";
  a.href = it?.link?.url || "#";
  a.target = it?.link?.target || "_blank";
  a.rel = "noopener noreferrer";

  const img = it?.media?.thumb || it?.image || "";
  const title = it?.title || "";

  a.innerHTML = `
    <div class="donation-card-img">
      <img src="${esc(img)}" loading="lazy"/>
    </div>
    <div class="donation-card-title">${esc(title)}</div>
  `;

  /* ===== Popup Binding (핵심) ===== */
  if(window.__bindDonationCard){
    window.__bindDonationCard(a, it);
  }

  return a;
}


function render(key,items){
  const box=document.querySelector('[data-psom-key="'+key+'"]');
  if(!box) return;

  box.innerHTML="";

  items.slice(0,24).forEach(it=>box.appendChild(card(it)));
}

async function init(){
  try{
    const snap=await fetchDonation();
    const items=Array.isArray(snap.items)?snap.items:[];

    const map={};

    items.forEach(it=>{
      const k=it.psom_key||it.category||"donation-others";
      if(!map[k]) map[k]=[];
      map[k].push(it);
    });

    Object.keys(map).forEach(k=>render(k,map[k]));
  }catch(e){
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded",init);
