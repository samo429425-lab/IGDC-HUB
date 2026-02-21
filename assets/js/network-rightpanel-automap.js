/**
 * network-rightpanel-automap.js (v4 - robust)
 *
 * 핵심 문제(현재 현상)
 * - /data/networkhub-snapshot.json 이 404/로드실패/형식불일치면 실데이터가 0개로 판단되어 더미만 남는다.
 * - 실제 모바일/데스크탑/윈도우-모바일뷰에서 경로/캐시/서빙차이로 fetch가 실패할 수 있다.
 *
 * 해법
 * 1) 스냅샷을 여러 경로로 시도 ( /data/... , /... , ./... )
 * 2) 스냅샷이 실패하면 Netlify function feed-network로 한번 더 시도
 * 3) 최종적으로 "유효 아이템"이 1개 이상일 때만 더미를 교체
 * 4) networkhub.html 에 이미 존재하는 window.__IGDC_RIGHTPANEL_RENDER 훅을 우선 사용(더미 제거/렌더를 기존 엔진이 처리)
 */
(function(){
  if (typeof document === "undefined") return;

  const PANEL_SELECTOR = "#rightAutoPanel";
  const MAX_ITEMS = 100;

  // snapshot candidates (order matters)
  const SNAPSHOT_CANDIDATES = [
    "/data/networkhub-snapshot.json",
    "/networkhub-snapshot.json",
    "./data/networkhub-snapshot.json",
    "./networkhub-snapshot.json"
  ];

  // feed fallback (Netlify)
  const FEED_URL = "/.netlify/functions/feed-network?limit=" + MAX_ITEMS + "&channel=web";

  function pickThumb(it){
    return it?.thumb || it?.thumbnail || it?.image || it?.icon || "";
  }
  function pickLink(it){
    return it?.url || it?.link || it?.href || "";
  }

  async function fetchJson(url){
    try{
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    }catch{
      return null;
    }
  }

  function normalizeItems(raw){
    // 1) networkhub-snapshot.json format: { items: [...] }
    if (raw && Array.isArray(raw.items)) return raw.items;
    // 2) feed-network format: { items: [...] } (already normalized)
    if (raw && Array.isArray(raw.items)) return raw.items;
    // 3) allow raw array
    if (Array.isArray(raw)) return raw;
    return [];
  }

  function toHookPayload(items){
    // networkhub.html dummy-engine expects: {id, link, thumb}
    return items.map(it => ({
      id: it?.id || it?.trackId || it?._id || "",
      link: pickLink(it) || "#",
      thumb: pickThumb(it) || "",
      title: it?.title || it?.name || ""
    })).filter(x => x.link && x.thumb);
  }

  function directRender(panel, items){
    // minimal direct renderer (fallback only)
    const frag = document.createDocumentFragment();
    for (const it of items){
      const link = pickLink(it);
      const thumb = pickThumb(it);
      if (!link || !thumb) continue;

      const card = document.createElement("div");
      card.className = "ad-box";

      const a = document.createElement("a");
      a.className = "thumb-link";
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";

      const tid = it?.id || it?.trackId || it?._id || "";
      if (tid) a.dataset.trackId = tid;

      const img = document.createElement("img");
      img.src = thumb;
      img.alt = String(it?.title || it?.name || "Network Item");
      img.loading = "lazy";
      img.decoding = "async";

      a.appendChild(img);
      card.appendChild(a);
      frag.appendChild(card);
    }

    // 유효 아이템 없으면 더미 유지
    if (!frag.childNodes.length) return false;

    panel.innerHTML = "";
    panel.appendChild(frag);
    return true;
  }

  async function loadBestSource(){
    // Try snapshots
    for (const u of SNAPSHOT_CANDIDATES){
      const j = await fetchJson(u);
      if (j) return { source: u, json: j };
    }
    // Fallback: feed function
    const fj = await fetchJson(FEED_URL);
    if (fj) return { source: FEED_URL, json: fj };

    return { source: null, json: null };
  }

  async function run(){
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return;

    // prevent double-run
    if (panel.dataset.bound === "true") return;
    panel.dataset.bound = "true";

    const { source, json } = await loadBestSource();
    if (!json){
      console.warn("[network-automap] no data source available; keep dummy.");
      return;
    }

    const itemsRaw = normalizeItems(json);
    if (!itemsRaw.length){
      console.warn("[network-automap] empty items from source:", source);
      return;
    }

    const payload = toHookPayload(itemsRaw).slice(0, MAX_ITEMS);
    if (!payload.length){
      console.warn("[network-automap] no valid (link+thumb) items; keep dummy. source:", source);
      return;
    }

    // Prefer existing hook (keeps dummy engine responsibilities)
    if (typeof window !== "undefined" && typeof window.__IGDC_RIGHTPANEL_RENDER === "function"){
      try{
        window.__IGDC_RIGHTPANEL_RENDER(payload);
        console.info("[network-automap] rendered via hook. source:", source, "count:", payload.length);
        return;
      }catch(e){
        console.warn("[network-automap] hook render failed; fallback direct render.", e);
      }
    }

    // Fallback direct render
    const ok = directRender(panel, itemsRaw.slice(0, MAX_ITEMS));
    if (ok){
      console.info("[network-automap] rendered directly. source:", source);
    }
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", run, { once: true });
  }else{
    run();
  }
})();
