/**
 * network-rightpanel-automap.js (FIXED)
 * Right panel automap for Network Hub
 * - Uses /data/networkhub-snapshot.json ONLY (anti-mix)
 * - Renders into #rightAutoPanel ONLY
 * - Supports 100 items (scroll)
 * - Emits .thumb-link with data-track-id for feed-network.js logger
 */
(function () {
  if (typeof document === "undefined") return;

  const PANEL_SELECTOR = "#rightAutoPanel";
  const SNAPSHOT_URL   = "/data/networkhub-snapshot.json";
  const MAX_ITEMS      = 100;
  const MOBILE_MAX    = 15;

  function toStr(x){ return (x==null) ? "" : String(x); }

  function pickThumb(item){
    return item.thumb || item.thumbnail || item.image || "";
  }

  function createCard(item) {
    const box = document.createElement("div");
    box.className = "ad-box";

    const a = document.createElement("a");
    a.className = "thumb-link";
    a.href = item.url || item.link || "#";
    a.target = "_blank";
    a.rel = "noopener";

    // tracking (feed-network.js listens on .thumb-link)
    const tid = item.id || item.trackId || item._id || "";
    if (tid) a.dataset.trackId = tid;

    const img = document.createElement("img");
    img.src = pickThumb(item);
    img.alt = toStr(item.title || item.name || "Network Item");
    img.loading = "lazy";
    img.decoding = "async";

    a.appendChild(img);
    box.appendChild(a);
    return box;
  }

  async function loadSnapshot() {
    try {
      const res = await fetch(SNAPSHOT_URL, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function disablePSOMGrid(){
    const grid = document.querySelector('.right-rail .thumb-grid[data-psom-key="network"]')
              || document.querySelector('.thumb-grid[data-psom-key="network"]');
    if(!grid) return;
    try{ grid.removeAttribute('data-psom-key'); grid.style.display='none'; grid.innerHTML=''; }catch(e){}
  }

  function fillMobile(items){
    const list = document.getElementById('nh-mobile-rail-list');
    if(!list) return;
    if(list.children && list.children.length) return;
    const take = Math.min(MOBILE_MAX, items.length);
    if(!take) return;
    for(let i=0;i<take;i++){
      const it = items[i]||{};
      const url = it.url || it.link || '#';
      const thumb = pickThumb(it);
      if(!url || url==='#' || !thumb) continue;
      const a=document.createElement('a');
      a.className='card';
      a.href=url; a.target='_blank'; a.rel='noopener';
      const img=document.createElement('img');
      img.src=thumb; img.alt=toStr(it.title||it.name||'Item');
      img.loading='lazy'; img.decoding='async';
      a.appendChild(img);
      list.appendChild(a);
    }
  }

async function run() {
    disablePSOMGrid();
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return;

    if (panel.dataset.bound === "true") return;
    panel.dataset.bound = "true";

    const snap = await loadSnapshot();
    const items = (snap && Array.isArray(snap.items)) ? snap.items : [];
    if (!items.length) return;

    // Build valid cards first; only then replace dummy DOM
    const valid = [];
    const cap = Math.min(MAX_ITEMS, items.length);
    for (let i=0;i<cap;i++){
      const it = items[i] || {};
      const url = it.url || it.link;
      const thumb = pickThumb(it);
      if (!url || !thumb) continue;
      valid.push(it);
    }
    if (!valid.length) return;

 // 기존 더미/슬롯 유지, 데이터 있을 때만 교체
const oldCards = panel.querySelectorAll(".ad-box, .thumb-item, .card");

if (oldCards.length && valid.length) {
  oldCards.forEach(el => el.remove());
}

// 데이터 있을 때만 렌더링
if (valid.length) {
  for (let i = 0; i < valid.length; i++) {
    panel.appendChild(createCard(valid[i]));
  }

  fillMobile(valid);
}


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
