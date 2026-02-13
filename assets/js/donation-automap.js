
/**
 * donation-automap.enterprise.stable.js
 * Purpose: Safely replace dummy slots with snapshot data
 * Pipeline: Snapshot -> Automap -> Front
 */

(async function(){

  const SNAPSHOT_PATHS = [
    "/data/donation.snapshot.json",
    "/netlify/functions/data/donation.snapshot.json"
  ];

  const PSOM_KEYS = [
    "donation-global",
    "donation-ngo",
    "donation-mission",
    "donation-service",
    "donation-relief",
    "donation-education",
    "donation-environment",
    "donation-others"
  ];

  /* =========================
     Utils
  ========================= */

  async function loadJSON(url){
    try{
      const res = await fetch(url, {cache:"no-store"});
      if(!res.ok) return null;
      return await res.json();
    }catch(e){
      console.warn("[DonationAutomap] Load fail:", url);
      return null;
    }
  }

  async function loadSnapshot(){
    for(const p of SNAPSHOT_PATHS){
      const j = await loadJSON(p);
      if(j && j.sections && j.items) return j;
    }
    return null;
  }

  function clearContainer(el){
    if(!el) return;
    el.innerHTML = "";
    el.dataset.mapped = "1";
  }

  function buildCard(item){

    const card = document.createElement("div");
    card.className = "donation-card";

    const img = document.createElement("img");
    img.src = item.thumb || item.image || "/assets/img/placeholder.png";
    img.alt = item.title || "";

    const title = document.createElement("h4");
    title.textContent = item.title || "";

    const desc = document.createElement("p");
    desc.textContent = item.summary || item.description || "";

    const link = document.createElement("a");
    link.href = item.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "바로가기";

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(link);

    return card;
  }


  /* =========================
     Core Render
  ========================= */

  function renderSection(key, items){

    const container = document.querySelector(
      `[data-psom-key="${key}"]`
    );

    if(!container) return;
    if(container.dataset.mapped === "1") return;

    // Remove dummy
    clearContainer(container);

    items.forEach(item=>{
      const card = buildCard(item);
      container.appendChild(card);
    });

  }


  /* =========================
     Bootstrap
  ========================= */

  async function init(){

    const snapshot = await loadSnapshot();

    if(!snapshot){
      console.warn("[DonationAutomap] Snapshot not found.");
      return;
    }

    PSOM_KEYS.forEach(key=>{

      const section = snapshot.sections.find(
        s => s.key === key
      );

      if(!section) return;

      const items = snapshot.items.filter(
        i => i.section === key
      );

      if(!items || !items.length) return;

      renderSection(key, items);

    });

    console.log("[DonationAutomap] Mapping completed.");
  }


  document.addEventListener("DOMContentLoaded", init);

})();
