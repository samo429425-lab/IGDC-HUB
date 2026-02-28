// tour-rightpanel-automap.v5.js (PRODUCTION)
// - snapshot 우선 → feed fallback
// - desktop: existing hook(__IGDC_RIGHTPANEL_RENDER) 사용 + caption overlay 후처리
// - mobile: #tour-mobile-rail .list 에 .card + .cap 렌더
// - sweeper 없이도 안전

(function () {
  "use strict";

  if (window.__TOUR_AUTOMAP_V5__) return;
  window.__TOUR_AUTOMAP_V5__ = true;

  const SNAPSHOT_URL = "/data/tour-snapshot.json";
  const FEED_URL = "/.netlify/functions/feed-tour?limit=100";
  const LIMIT = 100;

  const DESKTOP_PANEL_ID = "rightAutoPanel";

  const MOBILE_RAIL_ID = "tour-mobile-rail";
  const MOBILE_LIST_SEL = "#tour-mobile-rail .list";
  const MOBILE_CSS_ID = "tour-mobile-rail-fix-v1";
  const DESKTOP_CSS_ID = "tour-rightpanel-cap-fix-v1";

  function $(sel, root = document) { return root.querySelector(sel); }
  function byId(id){ return document.getElementById(id); }

  function pick(it, keys){
    for (const k of keys){
      const v = it && it[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function pickLink(it){ return pick(it, ["link","url","href"]) || "#"; }
  function pickThumb(it){ return pick(it, ["thumb","image","thumbnail","img","photo","cover"]); }
  function pickTitle(it){ return pick(it, ["title","name","label"]); }
  function pickId(it){ return pick(it, ["id","pid","productId"]); }

  function ensureMobileCss(){
    if (document.getElementById(MOBILE_CSS_ID)) return;
    const style = document.createElement("style");
    style.id = MOBILE_CSS_ID;
    style.textContent = `
/* tour mobile rail (production) */
#${MOBILE_RAIL_ID} .card{ position:relative; }
#${MOBILE_RAIL_ID} .card a{ display:block; width:100%; height:100%; }
#${MOBILE_RAIL_ID} .card img{ display:block; width:100%; height:100%; object-fit:cover; }
#${MOBILE_RAIL_ID} .cap{
  position:absolute; left:0; right:0; bottom:0;
  padding:6px 10px;
  font-weight:800; font-size:.92rem; line-height:1.15;
  color:#fff;
  background:linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0));
  text-shadow:0 1px 2px rgba(0,0,0,.55);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
`;
    document.head.appendChild(style);
  }

  function ensureDesktopCapCss(){
    if (document.getElementById(DESKTOP_CSS_ID)) return;
    const style = document.createElement("style");
    style.id = DESKTOP_CSS_ID;
    style.textContent = `
/* tour right panel caption overlay (production) */
#${DESKTOP_PANEL_ID} .ad-box{ position:relative; }
#${DESKTOP_PANEL_ID} .cap{
  position:absolute; left:0; right:0; bottom:0;
  padding:6px 8px;
  font-weight:800; font-size:.86rem; line-height:1.15;
  color:#fff;
  background:linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0));
  text-shadow:0 1px 2px rgba(0,0,0,.55);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  pointer-events:none;
}
`;
    document.head.appendChild(style);
  }

  async function fetchJson(url){
    try{
      const r = await fetch(url, { cache:"no-store" });
      if (!r.ok) return null;
      return await r.json();
    }catch{
      return null;
    }
  }

  function normalizeItems(raw){
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const it of arr){
      const thumb = pickThumb(it);
      const title = pickTitle(it);
      if (!thumb || !title) continue; // ✅ 빈 슬롯 방지
      out.push({
        id: pickId(it),
        title,
        thumb,
        link: pickLink(it)
      });
      if (out.length >= LIMIT) break;
    }
    return out;
  }

  function renderMobile(items){
    const rail = byId(MOBILE_RAIL_ID);
    const list = $(MOBILE_LIST_SEL);
    if (!rail || !list) return;
    if (!items || !items.length) return;

    // rail은 기본 display:none 이므로, 데이터 있을 때만 오픈
    rail.style.display = "block";

    ensureMobileCss();
    list.innerHTML = "";

    const frag = document.createDocumentFragment();
    for (const item of items.slice(0, 30)){
      const card = document.createElement("div");
      card.className = "card";

      const a = document.createElement("a");
      a.href = item.link || "#";
      if (item.link && item.link !== "#"){
        a.target = "_blank";
        a.rel = "noopener";
      }else{
        a.tabIndex = -1;
        a.setAttribute("aria-hidden","true");
      }

      const img = document.createElement("img");
      img.src = item.thumb;
      img.alt = item.title || "";
      img.loading = "lazy";
      img.decoding = "async";

      a.appendChild(img);
      card.appendChild(a);

      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = item.title || "";
      card.appendChild(cap);

      frag.appendChild(card);
    }
    list.appendChild(frag);
  }

  function renderDesktopViaHook(items){
    if (typeof window.__IGDC_RIGHTPANEL_RENDER === "function"){
      window.__IGDC_RIGHTPANEL_RENDER(items);
      return true;
    }
    return false;
  }

  function postProcessDesktopCaps(items){
    const panel = byId(DESKTOP_PANEL_ID);
    if (!panel) return;
    if (!items || !items.length) return;

    ensureDesktopCapCss();

    const boxes = panel.querySelectorAll(".ad-box");
    const n = Math.min(boxes.length, items.length);

    for (let i=0;i<n;i++){
      const box = boxes[i];
      if (!box) continue;

      let cap = box.querySelector(".cap");
      if (!cap){
        cap = document.createElement("div");
        cap.className = "cap";
        box.appendChild(cap);
      }
      cap.textContent = items[i].title || "";
    }
  }

  async function run(){
    // 1) snapshot 우선
    const snap = await fetchJson(SNAPSHOT_URL);
    let items = snap && Array.isArray(snap.items) ? normalizeItems(snap.items) : [];

    // 2) snapshot items 없으면 feed fallback
    if (!items.length){
      const feed = await fetchJson(FEED_URL);
      items = feed && Array.isArray(feed.items) ? normalizeItems(feed.items) : [];
    }

    // 3) mobile rail
    renderMobile(items);

    // 4) desktop hook
    const okHook = renderDesktopViaHook(items);
    if (okHook){
      // hook이 렌더한 뒤 캡션 강제 삽입
      setTimeout(() => postProcessDesktopCaps(items), 0);
      return;
    }

    // hook이 늦게 준비될 수 있어 재시도
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (renderDesktopViaHook(items)){
        clearInterval(t);
        setTimeout(() => postProcessDesktopCaps(items), 0);
      }else if (tries >= 20){
        clearInterval(t);
      }
    }, 100);
  }

  if (document.readyState === "complete" || document.readyState === "interactive"){
    setTimeout(run, 0);
  } else {
    document.addEventListener("DOMContentLoaded", run, { once:true });
    window.addEventListener("load", run, { once:true });
  }
})();