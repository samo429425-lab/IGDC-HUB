/**
 * network-rightpanel-automap.js (HARDENED)
 * Right panel automap for Network Hub
 *
 * Goal:
 * - NEVER leave #rightAutoPanel empty.
 * - Prefer real data from /data/networkhub-snapshot.json (100 slots).
 * - If snapshot missing/empty, rebuild safe dummy (100) so panel is never blank
 *   even if placeholder-sweeper removed initial dummy.
 *
 * Notes:
 * - Renders into #rightAutoPanel ONLY
 * - Emits .thumb-link with data-track-id for feed-network.js logger
 */
(function () {
  if (typeof document === "undefined") return;

  const PANEL_SELECTOR = "#rightAutoPanel";
  const SNAPSHOT_URL   = "/data/networkhub-snapshot.json";
  const MAX_ITEMS      = 100;
  const DUMMY_CNT      = 100;

  function toStr(x){ return (x==null) ? "" : String(x); }

  function pickThumb(item){
    return item.thumb || item.thumbnail || item.image || "";
  }

  function buildFallbackDummy(panel){
    if (!panel) return;
    panel.innerHTML = "";
    for (let i=1; i<=DUMMY_CNT; i++){
      const card = document.createElement("div");
      card.className = "ad-box dummy-card";
      card.dataset.dummy = "1";
      card.innerHTML = `
        <div class="dummy-thumb"
             style="
               width:100%;
               height:100%;
               border-radius:12px;
               background:linear-gradient(135deg,#eef2f7,#dbe4f0);
               display:flex;
               flex-direction:column;
               justify-content:center;
               align-items:center;
               box-shadow:0 2px 6px rgba(0,0,0,.08);
               border:1px solid rgba(0,0,0,.05);
               font-family:system-ui;
             ">
          <div style="
               font-size:26px;
               font-weight:700;
               color:#4a6fa5;
               line-height:1;
               margin-bottom:4px;
             ">${i}</div>
          <div style="
               font-size:11px;
               color:#7a8da8;
               letter-spacing:.5px;
             ">Loading</div>
        </div>
      `;
      panel.appendChild(card);
    }
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

  async function run() {
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return;

    if (panel.dataset.bound === "true") return;
    panel.dataset.bound = "true";

    const snap = await loadSnapshot();
    if (!snap) {
      // If something removed the initial dummy (e.g., placeholder-sweeper),
      // rebuild safe dummy to avoid empty panel.
      if (!panel.children || panel.children.length === 0) {
        console.error("[network-automap] snapshot load failed -> rebuild dummy");
        buildFallbackDummy(panel);
      } else {
        console.error("[network-automap] snapshot load failed -> keep existing");
      }
      return;
    }

    const items = (snap && Array.isArray(snap.items)) ? snap.items : [];
    if (!items.length) {
      if (!panel.children || panel.children.length === 0) {
        console.warn("[network-automap] snapshot has no items -> rebuild dummy");
        buildFallbackDummy(panel);
      }
      return;
    }

    const take = Math.min(MAX_ITEMS, items.length);
    const buffer = [];

    for (let i = 0; i < take; i++) {
      const it = items[i] || {};
      const url = it.url || it.link;
      const thumb = pickThumb(it);
      if (!url || !thumb) continue;
      buffer.push(createCard(it));
    }

    // If data is not valid, keep whatever exists; if empty, rebuild dummy.
    if (!buffer.length) {
      if (!panel.children || panel.children.length === 0) {
        console.warn("[network-automap] no valid items -> rebuild dummy");
        buildFallbackDummy(panel);
      } else {
        console.warn("[network-automap] no valid items -> keep existing");
      }
      return;
    }

    // 정상일 때만 초기화
    panel.innerHTML = "";
    buffer.forEach(node => panel.appendChild(node));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
