/**
 * network-rightpanel-automap.js (v7 - HARD GUARANTEE)
 *
 * 증상(확정 대응):
 * - 더미가 "타이틀만 남고" 통째로 사라짐 = 누군가 list/panel을 비우고 있음.
 *
 * v7 원칙(절대 변경 금지):
 * 1) 실데이터(유효 카드) 1개 이상이 '확정'되기 전에는 기존 DOM(더미)을 절대 삭제/초기화하지 않는다.
 * 2) 누군가가 DOM을 비워버리면(=0 children) 즉시 안전 더미(100)로 복구한다.
 * 3) 데이터 소스는 2단계:
 *    A) /.netlify/functions/feed-network (items[])
 *    B) /data/networkhub-snapshot.json (items[])  (fallback)
 * 4) 모바일 하단(#nh-mobile-rail-list)도 동일 아이템으로 재렌더 (존재할 때만)
 */

(function(){
  "use strict";
  if (typeof document === "undefined") return;
  if (window.__NETWORK_AUTOMAP_V7__) return;
  window.__NETWORK_AUTOMAP_V7__ = true;

  const LIMIT = 100;

  const FEED_URL = "/.netlify/functions/feed-network?limit=100&channel=web";
  const SNAPSHOT_URLS = [
    "/data/networkhub-snapshot.json",
    "/networkhub-snapshot.json",
    "./data/networkhub-snapshot.json",
    "./networkhub-snapshot.json"
  ];

  const DESKTOP_TARGETS = [
    "#rightAutoPanel",                       // legacy
    '[data-psom-key="right-network-100"]'    // psom
  ];
  const MOBILE_LIST_ID = "nh-mobile-rail-list"; // networkhub.html 하단 레일

  function pickThumb(it){
    return (it && (it.thumb || it.thumbnail || it.image || it.icon || it.photo)) || "";
  }
  function pickUrl(it){
    return (it && (it.url || it.link || it.href)) || "";
  }
  function toStr(x){ return (x==null) ? "" : String(x); }

  // sweeper 타겟(dummy-card/data-dummy)을 쓰지 않는 안전 더미
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

  function createSafeDummyCard(i){
    const card = document.createElement("div");
    card.className = "ad-box rp-safe-placeholder"; // ✅ dummy-card 금지

    const a = document.createElement("a");
    a.className = "thumb-link";
    a.href = "#";
    a.tabIndex = -1;
    a.setAttribute("aria-hidden","true");

    const img = document.createElement("img");
    img.src = safeDummySvg(i);
    img.alt = "Loading";
    img.loading = "eager";
    img.decoding = "async";

    a.appendChild(img);
    card.appendChild(a);
    return card;
  }

  function ensureNotEmpty(container){
    if (!container) return;
    if (container.children && container.children.length) return;

    const frag = document.createDocumentFragment();
    for (let i=1;i<=LIMIT;i++){
      frag.appendChild(createSafeDummyCard(i));
    }
    container.appendChild(frag);
  }

  function buildRealCards(items){
    const frag = document.createDocumentFragment();
    let n = 0;

    for (const it of (items || [])){
      const url = pickUrl(it);
      const thumb = pickThumb(it);
      if (!url || !thumb) continue;

      const card = document.createElement("div");
      card.className = "ad-box";
      card.dataset.real = "1";

      const a = document.createElement("a");
      a.className = "thumb-link";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";

      const tid = it && (it.id || it.trackId || it._id || "");
      if (tid) a.dataset.trackId = tid;

      const img = document.createElement("img");
      img.src = thumb;
      img.alt = toStr(it.title || it.name || "Network Item");
      img.loading = "lazy";
      img.decoding = "async";

      a.appendChild(img);
      card.appendChild(a);

      frag.appendChild(card);
      n++;
      if (n >= LIMIT) break;
    }

    return { frag, count: n };
  }

  async function fetchJson(url){
    try{
      const r = await fetch(url, { cache:"no-store" });
      if (!r.ok) return null;
      return await r.json();
    }catch(e){
      return null;
    }
  }

  async function loadItems(){
    // A) function feed-network: { items:[...] }
    const f = await fetchJson(FEED_URL);
    if (f && Array.isArray(f.items) && f.items.length) return f.items;

    // B) networkhub snapshot: { items:[...] }
    for (const u of SNAPSHOT_URLS){
      const j = await fetchJson(u);
      if (j && Array.isArray(j.items) && j.items.length) return j.items;
    }

    return [];
  }

  function getDesktopContainers(){
    const arr = [];
    for (const sel of DESKTOP_TARGETS){
      const el = document.querySelector(sel);
      if (el) arr.push(el);
    }
    // 중복 제거
    return Array.from(new Set(arr));
  }

  function getMobileContainer(){
    return document.getElementById(MOBILE_LIST_ID);
  }

  function safeReplace(container, items){
    if (!container) return false;

    const { frag, count } = buildRealCards(items);
    if (!count) {
      // 데이터가 없으면 절대 삭제하지 않음. 단, 이미 비어있으면 안전 더미 복구.
      ensureNotEmpty(container);
      return false;
    }

    // ✅ 여기서만 교체 권한 발생
    container.innerHTML = "";
    container.appendChild(frag);
    return true;
  }

  function attachGuard(container){
    if (!container || container.dataset.guardBound === "1") return;
    container.dataset.guardBound = "1";

    const mo = new MutationObserver(function(){
      if (!container.children || container.children.length === 0){
        ensureNotEmpty(container);
      }
    });

    mo.observe(container, { childList:true, subtree:false });
  }

  async function run(){
    const desktops = getDesktopContainers();
    const mobile = getMobileContainer();

    // 1) 가드 먼저 장착 + 비어있으면 복구
    desktops.forEach(c => { attachGuard(c); ensureNotEmpty(c); });
    if (mobile) { attachGuard(mobile); ensureNotEmpty(mobile); }

    // 2) 데이터 로드
    const items = await loadItems();

    // 3) 실데이터가 있으면 desktop + mobile 모두 교체 시도
    desktops.forEach(c => safeReplace(c, items));
    if (mobile) safeReplace(mobile, items);
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){
      // sweeper/더미엔진과 경합 완화
      requestAnimationFrame(()=>requestAnimationFrame(run));
    }, { once:true });
  } else {
    requestAnimationFrame(()=>requestAnimationFrame(run));
  }
})();
