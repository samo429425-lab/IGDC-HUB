
"use strict";

async function loadDonation(){
  const res = await fetch("/.netlify/functions/donation-feed");
  if(!res.ok) throw new Error("FEED_FAIL");
  return res.json();
}

function renderSection(psomKey, items){
  const box = document.querySelector('[data-psom-key="'+psomKey+'"]');
  if(!box) return;

  box.innerHTML = "";

  items.forEach(it=>{
    const card = document.createElement("div");
    card.className = "donation-card";

    card.innerHTML = `
      <div class="donation-thumb">
        <img src="${it.media?.thumb||it.image}" loading="lazy" />
      </div>
      <div class="donation-title">
        ${it.title||""}
      </div>
    `;

    card.onclick = ()=>{
      if(it.link) window.open(it.link,"_blank");
    };

    box.appendChild(card);
  });
}

async function initDonation(){
  try{
    const data = await loadDonation();
    const items = data.items || [];

    const groups = {};
    items.forEach(it=>{
      if(!groups[it.psom_key]) groups[it.psom_key]=[];
      groups[it.psom_key].push(it);
    });

    Object.keys(groups).forEach(k=>{
      renderSection(k, groups[k]);
    });

  }catch(e){
    console.error("Donation automap failed:", e);
  }
}

document.addEventListener("DOMContentLoaded", initDonation);
