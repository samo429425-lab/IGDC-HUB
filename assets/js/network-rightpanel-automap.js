/**
 * network-rightpanel-automap.js (v9)
 * 네트워크 허브(파일명: networkhub.html, 타이틀은 마켓허브일 수 있음) 전용.
 *
 * 규칙:
 * - 유효 데이터(normalized) >= 1 : 100개까지 순환 확장 → 렌더(기존 더미/DOM 교체)
 * - 유효 데이터(normalized) == 0 : 기존 HTML 더미는 절대 건드리지 않음
 *   단, 대상 컨테이너가 "완전 비어있을 때만" 안전 더미 100개 주입
 *
 * 타겟:
 * - Desktop: #rightAutoPanel  (slot: .ad-box)
 * - Mobile : #nh-mobile-rail-list (slot: .card)
 */
(function(){
  "use strict";
  if (typeof document === "undefined") return;

  // ✅ 페이지 가드: 파일명 기반(타이틀 무관) + 모바일 레일 존재 기반
  const path = (location && location.pathname) ? String(location.pathname) : "";
  const isNetworkHubPage =
    /(^|\/)networkhub\.html$/i.test(path) ||
    !!document.getElementById("nh-mobile-rail-list");

  if (!isNetworkHubPage) return;

  if (window.__NETWORK_AUTOMAP_V9__) return;
  window.__NETWORK_AUTOMAP_V9__ = true;

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
    if (href && imgSrc) box.dataset.real = "1";

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
    if (href && imgSrc) card.dataset.real = "1";

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

  function ensureDummyDesktop(container){
    if (!container) return;
    // ✅ 기존 HTML 더미가 있으면 손대지 않음 (ad-box가 하나라도 있으면 OK)
    if (container.querySelector && container.querySelector(".ad-box")) return;
    // ✅ 완전 비어있을 때만 100개 주입
    if (container.children && container.children.length > 0) return;

    const frag = document.createDocumentFragment();
    for (let i=1;i<=LIMIT;i++) frag.appendChild(createDesktopBox(i));
    container.appendChild(frag);
  }

  function ensureDummyMobile(container){
    if (!container) return;
    if (container.querySelector && container.querySelector(".card")) return;
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
    const f = await fetchJson(FEED_URL);
    if (f && Array.isArray(f.items) && f.items.length) return f.items;

    for (const u of SNAPSHOT_URLS){
      const j = await fetchJson(u);
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
    for (let i = 0; i < LIMIT; i++) out.push(src[i % src.length]);
    return out;
  }

 function renderDesktop(container, normalized){
  if (!container) return;

  // ✅ 실데이터 0이면: 기존 더미 DOM을 절대 삭제하지 않음 (비어있으면 더미 복구)
  if (!normalized || !normalized.length){
    ensureNotEmptyDesktop(container);   // container가 비어있을 때만 채움
    return;
  }

  // ✅ 1개 이상이면 100개까지 순환 확장 후, 그때만 교체 렌더(더미 제거 포함)
  const filled = expandToLimit(normalized);

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

  // ✅ 실데이터 0이면: 기존 더미 DOM을 절대 삭제하지 않음 (비어있으면 더미 복구)
  if (!normalized || !normalized.length){
    ensureNotEmptyMobile(container);    // container가 비어있을 때만 채움
    return;
  }

  // ✅ 1개 이상이면 100개까지 순환 확장 후, 그때만 교체 렌더(더미 제거 포함)
  const filled = expandToLimit(normalized);

  const frag = document.createDocumentFragment();
  let i = 1;
  for (const it of filled){
    frag.appendChild(createMobileCard(i, it.url, it.thumb, it.title, it.id));
    i++;
  }

  container.innerHTML = "";
  container.appendChild(frag);
}

  async function run(){
    const desktop = document.querySelector(DESKTOP_SELECTOR);
    const mobile = document.getElementById(MOBILE_LIST_ID);

    // ✅ 초기 상태: 비어있으면만 더미 주입(기존 더미가 있으면 건드리지 않음)
    if (desktop) ensureDummyDesktop(desktop);
    if (mobile) ensureDummyMobile(mobile);

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
