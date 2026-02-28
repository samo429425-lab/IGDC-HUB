// tour-rightpanel-automap.v6.js
// - 모바일 세로 막대 현상 제거
// - 모바일 가로에서도 우측패널과 동일한 카드 구조 유지
// - 30년 운영용 레이아웃 고정 안정 버전

(function () {
  "use strict";

  if (window.__TOUR_RIGHTPANEL_AUTOMAP_V6__) return;
  window.__TOUR_RIGHTPANEL_AUTOMAP_V6__ = true;

  const HUB = "tour";
  const SNAPSHOT_URL = "/data/tour-snapshot.json";
  const FEED_URL = "/.netlify/functions/feed-tour?limit=100";

  const RIGHT_PANEL_ID = "rightAutoPanel";
  const RIGHT_SLOT_COUNT = 100;

  const MOBILE_RAIL_ID = "tour-mobile-rail";
  const MOBILE_LIST_SEL = "#tour-mobile-rail .list";
  const MOBILE_LIMIT = 30;

  const PLACEHOLDER_IMG = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  const CSS_ID = "tour-layout-fix-v6";

  function $(sel, root = document) { return root.querySelector(sel); }
  function byId(id) { return document.getElementById(id); }

  function ensureLayoutFix() {
    if (document.getElementById(CSS_ID)) return;

    const style = document.createElement("style");
    style.id = CSS_ID;
    style.textContent = `
/* =========================
   RIGHT PANEL FIX
========================= */

#${RIGHT_PANEL_ID}{
  display:grid !important;
  grid-template-columns:repeat(auto-fill,minmax(120px,1fr)) !important;
  gap:10px;
}

#${RIGHT_PANEL_ID} .ad-box{
  position:relative;
  aspect-ratio:1/1;
  min-height:120px;
  overflow:hidden;
}

#${RIGHT_PANEL_ID} .ad-box img{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
}

/* =========================
   MOBILE LANDSCAPE FIX
========================= */
@media (max-width:1024px) and (orientation:landscape){
  #${RIGHT_PANEL_ID}{
    grid-template-columns:repeat(auto-fill,minmax(110px,1fr)) !important;
  }
}

/* =========================
   MOBILE PORTRAIT FIX
========================= */
@media (max-width:768px){
  #${RIGHT_PANEL_ID}{
    grid-template-columns:repeat(auto-fill,minmax(100px,1fr)) !important;
  }
}

/* =========================
   MOBILE RAIL FIX
========================= */
#${MOBILE_RAIL_ID} .card{
  position:relative;
  aspect-ratio:1/1;
  overflow:hidden;
}

#${MOBILE_RAIL_ID} .card img{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
}

#${MOBILE_RAIL_ID} .cap{
  position:absolute;
  left:0; right:0; bottom:0;
  padding:6px 10px;
  font-weight:800;
  font-size:.92rem;
  color:#fff;
  background:linear-gradient(to top, rgba(0,0,0,.65), rgba(0,0,0,0));
  text-shadow:0 1px 2px rgba(0,0,0,.6);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
`;
    document.head.appendChild(style);
  }

  function pick(it, keys) {
    for (const k of keys) {
      const v = it && it[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function normalizeItems(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const it of arr) {
      const title = pick(it, ["title","name","label"]);
      const thumb = pick(it, ["thumb","image","thumbnail","img","photo","cover"]);
      const link = pick(it, ["link","url","href"]) || "#";
      if (!title || !thumb) continue;
      out.push({ title, thumb, link });
      if (out.length >= RIGHT_SLOT_COUNT) break;
    }
    return out;
  }

  async function fetchJson(url){
    try{
      const r = await fetch(url,{cache:"no-store"});
      if(!r.ok) return null;
      return await r.json();
    }catch{return null;}
  }

  function renderRight(items){
    const panel = byId(RIGHT_PANEL_ID);
    if(!panel) return;
    panel.innerHTML="";
    const frag=document.createDocumentFragment();

    for(let i=0;i<RIGHT_SLOT_COUNT;i++){
      const it=items[i]||{title:`Tour Brand ${i+1}`,thumb:PLACEHOLDER_IMG,link:"#"};
      const box=document.createElement("div");
      box.className="ad-box";

      const a=document.createElement("a");
      a.href=it.link||"#";
      if(it.link!=="#"){a.target="_blank";a.rel="noopener";}

      const img=document.createElement("img");
      img.src=it.thumb||PLACEHOLDER_IMG;
      img.alt=it.title||"";

      const cap=document.createElement("div");
      cap.className="tour-card-title";
      cap.textContent=it.title||"";

      a.appendChild(img);
      a.appendChild(cap);
      box.appendChild(a);
      frag.appendChild(box);
    }

    panel.appendChild(frag);
  }

  function renderMobile(items){
    const rail=byId(MOBILE_RAIL_ID);
    const list=$(MOBILE_LIST_SEL);
    if(!rail||!list) return;

    rail.style.display="block";
    list.innerHTML="";
    const frag=document.createDocumentFragment();

    for(const it of items.slice(0,MOBILE_LIMIT)){
      const card=document.createElement("div");
      card.className="card";

      const a=document.createElement("a");
      a.href=it.link||"#";
      if(it.link!=="#"){a.target="_blank";a.rel="noopener";}

      const img=document.createElement("img");
      img.src=it.thumb||PLACEHOLDER_IMG;
      img.alt=it.title||"";

      const cap=document.createElement("div");
      cap.className="cap";
      cap.textContent=it.title||"";

      a.appendChild(img);
      card.appendChild(a);
      card.appendChild(cap);
      frag.appendChild(card);
    }

    list.appendChild(frag);
  }

  async function run(){
    ensureLayoutFix();

    let items=[];
    const snap=await fetchJson(SNAPSHOT_URL);

    if(snap && snap.meta?.hub===HUB && Array.isArray(snap.items)){
      items=normalizeItems(snap.items);
    }

    if(!items.length){
      const feed=await fetchJson(FEED_URL);
      items=feed && Array.isArray(feed.items) ? normalizeItems(feed.items) : [];
    }

    renderMobile(items);
    renderRight(items);
  }

  if(document.readyState==="complete"||document.readyState==="interactive"){
    setTimeout(run,0);
  }else{
    document.addEventListener("DOMContentLoaded",run,{once:true});
    window.addEventListener("load",run,{once:true});
  }

})();