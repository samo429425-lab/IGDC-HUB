"use strict";

/*
==================================================
MARU DONATION AUTOMAP ENGINE (FULL RESTORE)
- feed 의존성 복구
- snapshot fallback 유지
- HTML 자동 주입
==================================================
*/

async function loadJSON(path){
  try{
    const res = await fetch(path);
    return await res.json();
  }catch(e){
    console.error("JSON load fail:", path);
    return null;
  }
}

/* --------------------------------------------------
FEED LOAD (핵심 복구 포인트)
-------------------------------------------------- */

async function loadFeed(){
  try{
    if(window.runDonationFeed){
      return await window.runDonationFeed();
    }
  }catch(e){
    console.warn("feed 실행 실패 → snapshot fallback");
  }
  return null;
}

/* --------------------------------------------------
SNAPSHOT LOAD
-------------------------------------------------- */

async function loadSnapshot(){
  return await loadJSON("/donation.snapshot.json");
}

/* --------------------------------------------------
CARD RENDER
-------------------------------------------------- */

function createCard(item){
  const card = document.createElement("div");
  card.className = "card";

  const thumb = document.createElement("div");
  thumb.className = "thumb";

  const img = document.createElement("img");
  img.src = item.thumb || "/assets/img/placeholder.png";

  thumb.appendChild(img);

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = item.title || "";

  const summary = document.createElement("div");
  summary.className = "card-preview";
  summary.textContent = item.summary || "";

  body.appendChild(title);
  body.appendChild(summary);

  card.appendChild(thumb);
  card.appendChild(body);

  card.onclick = () => {
    if(item.url) window.open(item.url, "_blank");
  };

  return card;
}

/* --------------------------------------------------
SECTION RENDER
-------------------------------------------------- */

function renderSection(sectionId, items){
  const container = document.querySelector(`[data-section="${sectionId}"]`);
  if(!container) return;

  container.innerHTML = "";

  items.forEach(item => {
    container.appendChild(createCard(item));
  });
}

/* --------------------------------------------------
MAIN AUTOMAP
-------------------------------------------------- */

async function runDonationAutomap(){

  // 1. feed 우선
  let snapshot = await loadFeed();

  // 2. feed 실패 시 snapshot
  if(!snapshot){
    snapshot = await loadSnapshot();
  }

  if(!snapshot || !snapshot.sections){
    console.warn("donation snapshot 없음");
    return;
  }

  // 3. section mapping
  Object.keys(snapshot.sections).forEach(section => {
    renderSection(section, snapshot.sections[section]);
  });

  console.log("donation automap 완료");
}

/* --------------------------------------------------
AUTO RUN
-------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  runDonationAutomap();
});

/* --------------------------------------------------
EXPORT (OPTIONAL)
-------------------------------------------------- */

window.runDonationAutomap = runDonationAutomap;
