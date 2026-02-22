/**
 * network-rightpanel-automap.js (v2) - NetworkHub Right-Only
 *
 * 원칙(홈/디스트리뷰션 안정 패턴 참고, 코드 이식 아님):
 * - 유효 데이터 >= 1 : 100개까지 순환 확장 → 렌더(그때만 innerHTML 교체)
 * - 유효 데이터 == 0 : 기존 HTML 더미는 절대 건드리지 않음
 *   단, 대상 컨테이너가 "완전 비어있을 때만" 안전 더미 100개 주입
 *
 * 추가 안정화:
 * - 외부 스크립트가 DOM을 비우면(충돌) : MutationObserver로 자동 복구
 *   - 캐시된 filled가 있으면 다시 렌더
 *   - 없으면 더미만 복구
 */

(function(){
  "use strict";
  if (typeof document === "undefined") return;

  // 실행 가드: 파일명(networkhub.html) 또는 핵심 앵커 존재
  const path = (location && location.pathname) ? String(location.pathname) : "";
  const isNetworkHubPage =
    /(^|\/)networkhub\.html$/i.test(path) ||
    (!!document.getElementById("nh-mobile-rail-list") && !!document.querySelector("#rightAutoPanel"));

  if (!isNetworkHubPage) return;

  if (window.__NETWORK_AUTOMAP_V2__) return;
  window.__NETWORK_AUTOMAP_V2__ = true;

  const LIMIT = 100;
  const FEED_URL = "/.netlify/functions/feed-network?limit=100";
  const SNAPSHOT_URLS = [
    "/data/networkhub-snapshot.json",
    "/networkhub-snapshot.json",
    "./data/networkhub-snapshot.json",
    "./networkhub-snapshot.json"
  ];

  const DESKTOP_SELECTOR = "#rightAutoPanel";
  const MOBILE_LIST_ID = "nh-mobile-rail-list";

  const toStr = (x)=> (x==null ? "" : String(x));
  const pick = (it, keys)=> {
    for (const k of keys){
      const v = it && it[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const pickUrl = (it)=> pick(it, ["url","link","href","path"]);
  const pickThumb = (it)=> pick(it, ["thumb","thumbnail","image","icon","photo","img","cover","thumbnailUrl","coverUrl"]);

  function safeDummySvg(n){
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

  function bindImgFallback(img, idx){
    if (!img) return;
    img.addEventListener('error', ()=>{
      try{
        img.onerror = null;
        img.src = safeDummySvg(idx);
      }catch(_){}
    }, { once:true });
  }

  function createDesktopBox(i, href, imgSrc, title, trackId){
    const box = document.createElement("div");
    box.className = "ad-box";

    const a = document.createElement("a");
    a.className = "thumb-link";
    a.href = href || "#";
    if (href && href !== "#"){
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      a.tabIndex = -1;
      a.setAttribute("aria-hidden","true");
    }
    if (trackId) a.dataset.trackId = trackId;

    const img = document.createElement("img");
    img.src = imgSrc || safeDummySvg(i);
    img.alt = title || "Loading";
    img.loading = href && imgSrc ? "lazy" : "eager";
    img.decoding = "async";
    bindImgFallback(img, i);

    a.appendChild(img);
    box.appendChild(a);
    return box;
  }

  function createMobileCard(i, href, imgSrc, title, trackId){
    const card = document.createElement("div");
    card.className = "card";

    const a = document.createElement("a");
    a.className = "thumb-link";
    a.href = href || "#";
    if (href && href !== "#"){
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      a.tabIndex = -1;
      a.setAttribute("aria-hidden","true");
    }
    if (trackId) a.dataset.trackId = trackId;

    const img = document.createElement("img");
    img.src = imgSrc || safeDummySvg(i);
    img.alt = title || "Loading";
    img.loading = href && imgSrc ? "lazy" : "eager";
    img.decoding = "async";
    bindImgFallback(img, i);

    a.appendChild(img);
    card.appendChild(a);
    return card;
  }

  function hasSlotDesktop(container){
    return !!(container && container.querySelector && container.querySelector(".ad-box"));
  }
  function hasSlotMobile(container){
    return !!(container && container.querySelector && container.querySelector(".card"));
  }

  function ensureDummyDesktop(container){
    if (!container) return;
    // 기존 더미가 있으면 건드리지 않음
    if (hasSlotDesktop(container)) return;
    // 랩퍼(타이틀 등)만 있고 슬롯이 없을 수도 있음 → 완전 비었을 때만 주입
    if (container.children && container.children.length > 0) return;

    const frag = document.createDocumentFragment();
    for (let i=1;i<=LIMIT;i++) frag.appendChild(createDesktopBox(i));
    container.appendChild(frag);
  }

  function ensureDummyMobile(container){
    if (!container) return;
    if (hasSlotMobile(container)) return;
    if (container.children && container.children.length > 0) return;

    const frag = document.createDocumentFragment();
    for (let i=1;i<=LIMIT;i++) frag.appendChild(createMobileCard(i));
    container.appendChild(frag);
  }

  async function fetchJson(url){
    try{
      const r = await fetch(url, { cache:"no-store" });
      if (!r.ok) return null;
      return await r.json();
    }catch(_){
      return null;
    }
  }

  async function loadItems(){
    // feed 우선
    const f = await fetchJson(FEED_URL + "&_t=" + Date.now());
    if (f && Array.isArray(f.items) && f.items.length) return f.items;

    // snapshot fallback
    for (const u of SNAPSHOT_URLS){
      const j = await fetchJson(u + "?_t=" + Date.now());
      if (j && Array.isArray(j.items) && j.items.length) return j.items;
    }
    return [];
  }

  function normalizeValid(items){
    const out = [];
    for (const it of (items || [])){
      const url = pickUrl(it);
      const thumb = pickThumb(it);
      if (!url || !thumb) continue;
      out.push({
        id: it.id || it._id || it.trackId || "",
        title: toStr(it.title || it.name || it.label || ""),
        url, thumb
      });
      if (out.length >= LIMIT) break;
    }
    return out;
  }

  function expandToLimit(list){
    const src = Array.isArray(list) ? list : [];
    if (!src.length) return [];
    const out = [];
    for (let i=0;i<LIMIT;i++) out.push(src[i % src.length]);
    return out;
  }

  // 캐시(충돌 복구용)
  let _lastFilled = null;

  function renderDesktop(container, normalized){
    if (!container) return;

    if (!normalized || !normalized.length){
      // 데이터 0이면: 기존 DOM 유지, 비었을 때만 더미 복구
      ensureDummyDesktop(container);
      return;
    }

    const filled = expandToLimit(normalized);
    if (!filled.length){
      ensureDummyDesktop(container);
      return;
    }

    _lastFilled = filled;

    const frag = document.createDocumentFragment();
    let i = 1;
    for (const it of filled){
      frag.appendChild(createDesktopBox(i, it.url, it.thumb, it.title, it.id));
      i++;
    }

    container.innerHTML = "";
    container.appendChild(frag);
  }

  function renderMobile(container, normalized){
    if (!container) return;

    if (!normalized || !normalized.length){
      ensureDummyMobile(container);
      return;
    }

    const filled = expandToLimit(normalized);
    if (!filled.length){
      ensureDummyMobile(container);
      return;
    }

    _lastFilled = filled;

    const frag = document.createDocumentFragment();
    let i = 1;
    for (const it of filled){
      frag.appendChild(createMobileCard(i, it.url, it.thumb, it.title, it.id));
      i++;
    }

    container.innerHTML = "";
    container.appendChild(frag);
  }

  function attachRecovery(container, kind){
    if (!container || container.dataset.v2Recovery === "1") return;
    container.dataset.v2Recovery = "1";

    const mo = new MutationObserver(()=> {
      // 슬롯이 0개가 되면 복구 시도
      const slotOk = (kind === "desktop") ? hasSlotDesktop(container) : hasSlotMobile(container);
      if (slotOk) return;

      // 데이터 캐시가 있으면 다시 렌더
      if (_lastFilled && _lastFilled.length){
        const normalized = _lastFilled;
        if (kind === "desktop") renderDesktop(container, normalized);
        else renderMobile(container, normalized);
        return;
      }

      // 캐시도 없으면 더미만 복구
      if (kind === "desktop") ensureDummyDesktop(container);
      else ensureDummyMobile(container);
    });

    mo.observe(container, { childList:true, subtree:false });
  }

  async function run(){
    const desktop = document.querySelector(DESKTOP_SELECTOR);
    const mobile = document.getElementById(MOBILE_LIST_ID);

    // 초기: 완전 비었을 때만 더미(기존 HTML 더미가 있으면 그대로 둠)
    if (desktop) ensureDummyDesktop(desktop);
    if (mobile) ensureDummyMobile(mobile);

    if (desktop) attachRecovery(desktop, "desktop");
    if (mobile) attachRecovery(mobile, "mobile");

    const items = await loadItems();
    const normalized = normalizeValid(items);

    if (desktop) renderDesktop(desktop, normalized);
    if (mobile) renderMobile(mobile, normalized);
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ()=> {
      requestAnimationFrame(()=>requestAnimationFrame(run));
    }, { once:true });
  } else {
    requestAnimationFrame(()=>requestAnimationFrame(run));
  }
})();
