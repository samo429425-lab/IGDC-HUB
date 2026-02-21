/**
 * network-rightpanel-automap.v6.js (NETWORK HUB)
 * ------------------------------------------------------------
 * 목적(고정):
 *  - 실데이터(네트워크허브 스냅샷)가 있으면: 더미를 밀고 실데이터 카드로 대체
 *  - 실데이터가 없으면: 더미를 절대 '비우지' 않음 (없어졌으면 자동 복구)
 *  - 모바일(<=1024)에서는 #rightAutoPanel 이 CSS로 숨겨지므로,
 *    별도 모바일 레일(#nh-mobile-rail-list)에도 동일 데이터 렌더
 *
 * 데이터 소스:
 *  - /data/networkhub-snapshot.json (single source of truth)
 */
(function () {
  if (typeof document === "undefined") return;

  const DESKTOP_PANEL_SELECTOR = "#rightAutoPanel";
  const MOBILE_LIST_SELECTOR   = "#nh-mobile-rail-list";
  const SNAPSHOT_URL           = "/data/networkhub-snapshot.json";

  const MAX_ITEMS = 100;
  const MOBILE_BP = 1024;

  function isMobileNow(){
    return (window.matchMedia && window.matchMedia(`(max-width:${MOBILE_BP}px)`).matches) || (window.innerWidth <= MOBILE_BP);
  }

  function toStr(x){ return (x == null) ? "" : String(x); }

  function pickUrl(it){
    return (it && (it.url || it.link || it.href)) ? (it.url || it.link || it.href) : "";
  }

  function pickThumb(it){
    return (it && (it.thumb || it.thumbnail || it.image || it.icon)) ? (it.thumb || it.thumbnail || it.image || it.icon) : "";
  }

  function svgPlaceholder(title){
    // data: URI (safe, no external file)
    const t = encodeURIComponent((title || "Network").slice(0, 40));
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#222"/>
      <stop offset="1" stop-color="#444"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <g fill="#fff" opacity="0.85" font-family="Arial, sans-serif">
    <text x="28" y="190" font-size="28">${t}</text>
  </g>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function createCard(it){
    const box = document.createElement("div");
    box.className = "ad-box";

    const a = document.createElement("a");
    a.className = "thumb-link";
    a.href = pickUrl(it) || "#";
    a.target = "_blank";
    a.rel = "noopener";

    const tid = it && (it.id || it.trackId || it._id || it.maruId || "");
    if (tid) a.dataset.trackId = String(tid);

    const img = document.createElement("img");
    const title = toStr((it && (it.title || it.name)) || "Network Item");

    img.alt = title;
    img.loading = "lazy";
    img.decoding = "async";

    // 1) try real thumb
    const thumb = pickThumb(it);
    img.src = thumb || svgPlaceholder(title);

    // 2) if thumb 404/blocked -> fallback to svg so card has height
    img.onerror = function(){
      img.onerror = null;
      img.src = svgPlaceholder(title);
    };

    a.appendChild(img);
    box.appendChild(a);
    return box;
  }

  async function loadSnapshot(){
    try{
      const r = await fetch(SNAPSHOT_URL, { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    }catch(e){
      return null;
    }
  }

  function normalizeItems(snap){
    const raw = (snap && Array.isArray(snap.items)) ? snap.items : [];
    const out = [];

    for (let i=0; i<raw.length && out.length<MAX_ITEMS; i++){
      const it = raw[i] || {};
      const url = pickUrl(it);
      // url이 없어도 "#"라도 있으면 카드로 보이게 함
      const title = toStr(it.title || it.name || `Network Item ${out.length+1}`);
      const thumb = pickThumb(it);

      // 최소 조건: title만 있어도 카드 만들기 (thumb/url 없어도 placeholder+"#")
      out.push({
        ...it,
        title,
        url: url || "#",
        thumb: thumb || ""  // createCard가 placeholder 처리
      });
    }

    return out;
  }

  function ensureFallbackPlaceholders(container, count){
    if (!container) return;
    if (container.children && container.children.length > 0) return; // 이미 무언가 있으면 건드리지 않음

    const n = Math.max(6, Math.min(24, Number(count)||12));
    for (let i=0; i<n; i++){
      const it = { title: `Network Placeholder ${i+1}`, url: "#", thumb: "" };
      container.appendChild(createCard(it));
    }
  }

  function renderInto(container, items){
    if (!container) return;

    if (!Array.isArray(items) || items.length === 0){
      // 실데이터 없음: 비우지 말고, 비어있으면 복구
      ensureFallbackPlaceholders(container, 12);
      return;
    }

    // 실데이터 있음: 이때만 clear
    container.innerHTML = "";
    for (const it of items){
      container.appendChild(createCard(it));
    }
  }

  async function run(){
    const desktopPanel = document.querySelector(DESKTOP_PANEL_SELECTOR);
    const mobileList   = document.querySelector(MOBILE_LIST_SELECTOR);

    // 바인딩 플래그: 여러번 로딩되어도 중복 실행 방지
    const boundKey = "__nhAutomapV6Bound__";
    if (window[boundKey]) return;
    window[boundKey] = true;

    const snap = await loadSnapshot();
    const items = snap ? normalizeItems(snap) : [];

    // 1) 데스크탑 패널 렌더 (항상)
    if (desktopPanel) renderInto(desktopPanel, items);

    // 2) 모바일 레일 렌더
    //    - mobileList가 존재하면 항상 유지/동기화
    //    - rightAutoPanel은 모바일에서 display:none 이므로 mobileList가 실 UI
    if (mobileList) renderInto(mobileList, items);

    // 3) 리사이즈/회전: 모바일/데스크탑 전환 시에도 모바일 리스트를 계속 최신화
    //    (단, snapshot 재-fetch는 부담이라 기존 items를 재사용)
    let raf = null;
    function onResize(){
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function(){
        raf = null;
        const mp = document.querySelector(MOBILE_LIST_SELECTOR);
        if (mp) renderInto(mp, items);
      });
    }
    window.addEventListener("resize", onResize, { passive:true });

    // If another script overwrites the mobile list (e.g., dummy-clone), re-render.
    (function(){
      const ml = document.querySelector(MOBILE_LIST_SELECTOR);
      if (!ml) return;

      const mo = new MutationObserver(function(){
        const kids = Array.from(ml.children || []);
        const allDummy = (kids.length > 0) && kids.every(n => (n && n.dataset && n.dataset.dummy === "1"));
        if (kids.length === 0 || allDummy){
          renderInto(ml, items);
        }
      });
      mo.observe(ml, { childList: true, subtree: false });

      // Initial race guard: render once more after other DOMContentLoaded scripts.
      setTimeout(function(){ renderInto(ml, items); }, 200);
    })();
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", run, { once:true });
  } else {
    run();
  }
})();
