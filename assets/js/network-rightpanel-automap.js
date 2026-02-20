/**
 * network-rightpanel-automap.js (FIX2 - NEVER EMPTY)
 *
 * 핵심:
 * - placeholder-sweeper가 더미를 "통째로" 지워도, 우측패널(#rightAutoPanel)을 절대 비워두지 않음.
 * - /data/networkhub-snapshot.json 로드 성공 + 유효 아이템 있으면 그때만 실데이터로 교체.
 * - 스냅샷 실패/빈 아이템이면 '안전 플레이스홀더(100)'를 즉시 재생성.
 * - MutationObserver로 "지워지는 순간" 자동 복구(모바일 포함).
 */
(function(){
  if (typeof document === "undefined") return;

  const PANEL_SELECTOR = "#rightAutoPanel";
  const SNAPSHOT_URL   = "/data/networkhub-snapshot.json";
  const MAX_ITEMS      = 100;
  const PLACEHOLDER_N  = 100;

  let cachedSnap = null;
  let snapTried = false;
  let rendering = false;
  let mo = null;

  function pickThumb(it){
    return it?.thumb || it?.thumbnail || it?.image || "";
  }
  function pickUrl(it){
    return it?.url || it?.link || it?.href || "";
  }
  function str(x){ return (x==null) ? "" : String(x); }

  // svg placeholder (data URI) - sweeper가 img 기반 카드를 "더미"로 인식하지 못하도록
  function placeholderSvg(n){
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420">
        <defs>
          <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#eef2f7"/>
            <stop offset="1" stop-color="#dbe4f0"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="420" height="420" rx="24" fill="url(#g)"/>
        <text x="210" y="210" text-anchor="middle" dominant-baseline="central"
              font-family="system-ui, -apple-system, Segoe UI, Roboto"
              font-size="88" font-weight="800" fill="#4a6fa5">${n}</text>
        <text x="210" y="290" text-anchor="middle"
              font-family="system-ui, -apple-system, Segoe UI, Roboto"
              font-size="26" font-weight="600" fill="#7a8da8">Loading</text>
      </svg>`;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function createCard(it){
    const box = document.createElement("div");
    box.className = "ad-box";

    const a = document.createElement("a");
    a.className = "thumb-link";
    a.href = pickUrl(it) || "#";
    a.target = "_blank";
    a.rel = "noopener";

    const tid = it?.id || it?.trackId || it?._id || "";
    if (tid) a.dataset.trackId = tid;

    const img = document.createElement("img");
    img.src = pickThumb(it);
    img.alt = str(it?.title || it?.name || "Network Item");
    img.loading = "lazy";
    img.decoding = "async";

    a.appendChild(img);
    box.appendChild(a);
    return box;
  }

  function createPlaceholderCard(i){
    const box = document.createElement("div");
    // ✅ dummy-card / data-dummy 제거 (sweeper 타겟 회피)
    box.className = "ad-box rp-safe-placeholder";

    const a = document.createElement("a");
    a.className = "thumb-link";
    a.href = "#";
    a.tabIndex = -1;
    a.setAttribute("aria-hidden","true");

    const img = document.createElement("img");
    img.src = placeholderSvg(i);
    img.alt = "Loading";
    img.loading = "eager";
    img.decoding = "async";

    a.appendChild(img);
    box.appendChild(a);
    return box;
  }

  function buildPlaceholders(panel){
    panel.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i=1;i<=PLACEHOLDER_N;i++){
      frag.appendChild(createPlaceholderCard(i));
    }
    panel.appendChild(frag);
  }

  function renderReal(panel, items){
    const buf = [];
    const take = Math.min(MAX_ITEMS, items.length);
    for (let i=0;i<take;i++){
      const it = items[i] || {};
      const url = pickUrl(it);
      const thumb = pickThumb(it);
      if (!url || !thumb) continue;
      buf.push(createCard(it));
    }
    if (!buf.length) return false;
    panel.innerHTML = "";
    const frag = document.createDocumentFragment();
    buf.forEach(n => frag.appendChild(n));
    panel.appendChild(frag);
    return true;
  }

  async function loadSnapshot(){
    try{
      const res = await fetch(SNAPSHOT_URL, { cache:"no-store" });
      if (!res.ok) return null;
      return await res.json();
    }catch(e){
      return null;
    }
  }

  async function ensurePanelHasContent(panel){
    if (!panel || rendering) return;
    rendering = true;
    try{
      // 1) snapshot이 아직 시도되지 않았으면 1회 시도
      if (!snapTried){
        snapTried = true;
        cachedSnap = await loadSnapshot();
      }

      const items = Array.isArray(cachedSnap?.items) ? cachedSnap.items : [];

      // 2) 실데이터 유효하면 실데이터로 렌더
      if (items.length){
        const ok = renderReal(panel, items);
        if (ok) return;
        // 유효 아이템이 하나도 없으면 fallthrough -> placeholder
      }

      // 3) snapshot 실패/빈 아이템이면 placeholder(절대 비우지 않음)
      buildPlaceholders(panel);

    } finally {
      rendering = false;
    }
  }

  function attachObserver(panel){
    if (mo) return;
    let t = null;

    mo = new MutationObserver(function(){
      // debounce
      if (t) clearTimeout(t);
      t = setTimeout(function(){
        // children이 "0"이면 즉시 복구
        if (!panel.children || panel.children.length === 0){
          // snapshot을 재시도(한번 더) : 배포 직후 타이밍 이슈 대비
          snapTried = false;
          cachedSnap = null;
          ensurePanelHasContent(panel);
        }
      }, 60);
    });

    mo.observe(panel, { childList:true, subtree:false });
  }

  async function run(){
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return;

    if (panel.dataset.bound === "true") return;
    panel.dataset.bound = "true";

    attachObserver(panel);

    // 초기 상태가 비었거나 sweeper가 곧 지울 수 있으니: 즉시 1차 보장
    if (!panel.children || panel.children.length === 0){
      buildPlaceholders(panel);
    }

    // snapshot이 준비되면 실데이터로 교체 (실패해도 placeholder 유지)
    await ensurePanelHasContent(panel);

    // 안전망: 1~2초 뒤 다시 한번 체크(모바일/느린 로드)
    setTimeout(function(){
      if (!panel.children || panel.children.length === 0){
        snapTried = false;
        cachedSnap = null;
        ensurePanelHasContent(panel);
      }
    }, 1200);
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", run, { once:true });
  }else{
    run();
  }
})();
