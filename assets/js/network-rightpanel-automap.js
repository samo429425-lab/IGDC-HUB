/* ===================================================
   IGDC Network RightPanel Automap (Production Final)
   Same Architecture as Distribution
=================================================== */

(function(){

/* ================= CONFIG ================= */

const LIMIT = 100;

const FEED_URL = "/data/feed-network.json";

const SNAPSHOT_URLS = [
  "/data/networkhub-snapshot.json",
  "/.netlify/functions/networkSnapshot"
];


/* ================= UTILS ================= */

async function fetchJson(url){
  try{
    const r = await fetch(url, { cache:"no-store" });
    if(!r.ok) return null;
    return await r.json();
  }catch(e){
    return null;
  }
}

function toStr(v){
  return (v||"").toString().trim();
}


/* ================= SAMPLE BUILDER ================= */

function buildSamples(){

  const list = [];

  for(let i=1;i<=LIMIT;i++){

    const n = String(i).padStart(3,"0");

    list.push({
      id: "sample-"+n,
      title: "Network Sample "+i,
      url: "#",
      thumb: "/assets/sample/network/"+n+".jpg"
    });
  }

  return list;
}


/* ================= DATA LOADER ================= */

async function loadItems(){

  /* 1) Feed First */
  const feed = await fetchJson(FEED_URL+"?_t="+Date.now());

  if(feed && Array.isArray(feed.items) && feed.items.length){
    return feed.items;
  }

  /* 2) Snapshot Fallback */
  for(const u of SNAPSHOT_URLS){

    const snap = await fetchJson(u+"?_t="+Date.now());

    if(snap && Array.isArray(snap.items) && snap.items.length){
      return snap.items;
    }
  }

  /* 3) Internal Sample */
  return buildSamples();
}


/* ================= NORMALIZER ================= */

function normalize(items){

  const out = [];

  for(const it of (items||[])){

    const thumb = it.thumb || it.image || "";
    if(!thumb) continue;

    let url = it.url || "#";

    out.push({
      id: it.id || "",
      title: toStr(it.title||it.name||"Sample"),
      url,
      thumb
    });

    if(out.length>=LIMIT) break;
  }

  return out;
}


/* ================= RENDER ================= */

function createBox(it){

  const box = document.createElement("div");
  box.className = "ad-box";

  const a = document.createElement("a");
  a.className = "thumb-link";
  a.href = it.url || "#";

  if(it.url && it.url!=="#"){
    a.target="_blank";
    a.rel="noopener";
  }else{
    a.tabIndex=-1;
    a.setAttribute("aria-hidden","true");
  }

  const img = document.createElement("img");
  img.src = it.thumb;
  img.alt = it.title;
  img.loading="lazy";
  img.decoding="async";

  a.appendChild(img);
  box.appendChild(a);

  return box;
}


function render(items){

  const panel =
    document.querySelector(".right-panel .ad-panel") ||
    document.querySelector(".right-rail .ad-panel") ||
    document.querySelector(".ad-panel");

  if(!panel) return;

  panel.innerHTML = "";

  const frag = document.createDocumentFragment();

  for(const it of items){
    frag.appendChild(createBox(it));
  }

  panel.appendChild(frag);
}


/* ================= BOOT ================= */

async function boot(){

  const raw = await loadItems();

  const normalized = normalize(raw);

  render(normalized);
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded", boot,{once:true});
}else{
  boot();
}

})();