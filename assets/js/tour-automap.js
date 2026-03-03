/* ===============================
   TOUR AUTOMAP - PRODUCTION (FIXED)
   - ONLY loads TOUR feed
   - Renders into existing TOUR right panel (#rightAutoPanel)
   - No dummy generation, no other hub mixing
================================= */

(function(){
  const FEED_URLS = [
    "/.netlify/functions/feed-tour?limit=100",
    "/netlify/functions/feed-tour?limit=100",
    "/api/feed-tour?limit=100"
  ];

  const RIGHT_PANEL_ID = "rightAutoPanel";
  const MAX_SLOTS = 100;

  async function fetchTourFeed(){
    for (const url of FEED_URLS){
      try{
        const res = await fetch(url, { cache: "no-store" });
        if(!res.ok) continue;
        const json = await res.json();
        if(json && Array.isArray(json.items)) return json.items;
      }catch(_){ }
    }
    return [];
  }

  function buildAdBox(item){
    const box = document.createElement("div");
    box.className = "ad-box";

    const a = document.createElement("a");
    a.href = (item && item.link) ? item.link : "#";
    a.target = "_self";
    a.rel = "noopener";

    const img = document.createElement("img");
    img.alt = (item && item.title) ? item.title : "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = item.thumb;

    const title = document.createElement("div");
    title.className = "tour-card-title";
    title.textContent = item.title || "";

    a.appendChild(img);
    a.appendChild(title);
    box.appendChild(a);
    return box;
  }

  async function run(){
    const panel = document.getElementById(RIGHT_PANEL_ID);
    if(!panel) return;

    const items = await fetchTourFeed();
    if(!items.length) return;

    // Clear only our panel; do not touch other containers.
    panel.innerHTML = "";

    const limit = Math.min(MAX_SLOTS, items.length);
    for(let i=0;i<limit;i++){
      const it = items[i];
      if(!it || !it.title || !it.thumb) continue;
      panel.appendChild(buildAdBox(it));
    }

    // Notify mobile rail to rebuild after real cards exist.
    document.dispatchEvent(new CustomEvent("tour:automap:done"));
    if (typeof window.buildTourMobileRail === "function") {
      try { window.buildTourMobileRail(); } catch(_){ }
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", run, { once: true });
  }else{
    run();
  }
})();
