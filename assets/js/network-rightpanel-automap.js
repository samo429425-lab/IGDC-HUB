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

  async function run() {
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return;

    if (panel.dataset.bound === "true") return;
    panel.dataset.bound = "true";

    const snap = await loadSnapshot();
    const items = (snap && Array.isArray(snap.items)) ? snap.items : [];
    if (!items.length) return;

    panel.innerHTML = "";
    const take = Math.min(MAX_ITEMS, items.length);

    for (let i = 0; i < take; i++) {
      const it = items[i] || {};
      const url = it.url || it.link;
      const thumb = pickThumb(it);
      // 최소 안전 필터: url+thumb 없으면 skip (빈 카드 방지)
      if (!url || !thumb) continue;
      panel.appendChild(createCard(it));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
