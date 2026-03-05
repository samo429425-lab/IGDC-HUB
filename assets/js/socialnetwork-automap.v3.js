
(function(){
"use strict";

const SLOT_SELECTOR = "[data-psom-key]";
const CARD_CLASS = "snapshot-card";

function createCard(item){
  const card = document.createElement("div");
  card.className = CARD_CLASS;

  const img = document.createElement("img");
  img.src = item.thumbnail || "";
  img.alt = item.title || "";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = item.title || "";

  card.appendChild(img);
  card.appendChild(title);

  return card;
}

function replaceCards(slot, items){
  if(!slot) return;

  const old = slot.querySelectorAll("." + CARD_CLASS);
  old.forEach(el => el.remove());

  items.forEach(item => {
    const card = createCard(item);
    slot.appendChild(card);
  });
}

async function loadSnapshot(){
  try{
    const res = await fetch("/data/socialnetwork.snapshot.json");
    return await res.json();
  }catch(e){
    return null;
  }
}

async function runAutomap(){

  const snapshot = await loadSnapshot();
  if(!snapshot) return;

  const slots = document.querySelectorAll(SLOT_SELECTOR);

  slots.forEach(slot=>{

    const key = slot.dataset.psomKey;
    const items = snapshot[key];

    if(!items || !items.length) return;

    replaceCards(slot, items);

  });
}

function boot(){
  runAutomap();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded",boot,{once:true});
}else{
  boot();
}

let resizeTimer;

window.addEventListener("resize",()=>{

  clearTimeout(resizeTimer);

  resizeTimer=setTimeout(()=>{
    runAutomap();
  },250);

});

})();
