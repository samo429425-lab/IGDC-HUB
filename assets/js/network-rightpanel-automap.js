/**
 * network-rightpanel-automap.js (v8)
 *
 * FIX 목표(정이사장님 스크린샷 기준):
 * 1) 카드가 1장만 보이는 현상 → 실제로는 데이터가 많아도 "모바일 레일 구조(.card)"와 불일치로 레이아웃이 깨짐.
 * 2) 모바일 가로/태블릿에서 이미지가 분산/중복 → 데스크탑 패널(#rightAutoPanel)과 모바일 레일(#nh-mobile-rail-list)의 DOM/CSS가 서로 다른데 같은 마크업(.ad-box)으로 넣어서 깨짐.
 *
 * v8 원칙:
 * - 데스크탑(우측패널): .ad-box (기존 CSS 그대로 사용)
 * - 모바일 레일: .card (networkhub.html의 #nh-mobile-rail CSS와 1:1 매칭)
 * - 실데이터가 1개라도 있으면: 1..N은 실데이터, N+1..100은 안전 더미(Loading)로 채워서 "100개 규정" 보장
 * - 실데이터 0이면: 기존 더미 DOM을 절대 삭제하지 않음. (비어있으면 안전 더미 100개 복구)
 */

(function(){
  "use strict";
  if (typeof document === "undefined") return;
  if (window.__NETWORK_AUTOMAP_V8__) return;
  window.__NETWORK_AUTOMAP_V8__ = true;

  const LIMIT = 100;

  // ✅ channel=web 강제 제거(필터로 인해 1개만 남는 경우 차단)
  const FEED_URL = "/.netlify/functions/feed-network?limit=100";

  const SNAPSHOT_URLS = [
    "/data/networkhub-snapshot.json",
    "/networkhub-snapshot.json",
    "./data/networkhub-snapshot.json",
    "./networkhub-snapshot.json"
  ];

  const DESKTOP_TARGETS = [
    "#rightAutoPanel",
    '[data-psom-key="right-network-100"]'
  ];
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

  // __IMG_ONERROR_PATCH_V1__: broken image -> dummy svg
  function bindImgFallback(img, idx){
    if (!img) return;
    img.addEventListener('error', ()=>{
      try{
        // prevent infinite loop
        img.onerror = null;
        img.src = safeDummySvg(idx);
      }catch(_){/*noop*/}
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

  // ✅ mobile rail은 반드시 .card 구조
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

  function ensureNotEmptyDesktop(container){
    if (!container) return;
    if (container.children && container.children.length) return;
    const frag = document.createDocumentFragment();
    for (let i=1;i<=LIMIT;i++) frag.appendChild(createDesktopBox(i));
    container.appendChild(frag);
  }

  function ensureNotEmptyMobile(container){
    if (!container) return;
    if (container.children && container.children.length) return;
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

  function getDesktopContainers(){
    const els = [];
    for (const sel of DESKTOP_TARGETS){
      const el = document.querySelector(sel);
      if (el) els.push(el);
    }
    return Array.from(new Set(els));
  }

  function attachGuard(container, ensureFn){
    if (!container || container.dataset.guardBound === "1") return;
    container.dataset.guardBound = "1";
    const mo = new MutationObserver(()=> {
      if (!container.children || container.children.length === 0){
        ensureFn(container);
      }
    });
    mo.observe(container, { childList:true, subtree:false });
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
    for (let i = 0; i < LIMIT; i++){
      out.push(src[i % src.length]); // ✅ 1개 이상이면 100까지 순환 확장
    }
    return out;
  }

  function renderDesktop(container, normalized){
    if (!container) return;

    // ✅ 실데이터 0이면 더미 유지
    if (!normalized || !normalized.length){
      ensureNotEmptyDesktop(container);
      return;
    }

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

  // ✅ 실데이터 0이면 더미 유지
  if (!normalized || !normalized.length){
    ensureNotEmptyMobile(container);
    return;
  }

  // ✅ 1개 이상이면 100개까지 순환 확장
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
    const desktops = getDesktopContainers();
    const mobile = document.getElementById(MOBILE_LIST_ID);

    desktops.forEach(c => { attachGuard(c, ensureNotEmptyDesktop); ensureNotEmptyDesktop(c); });
    if (mobile) { attachGuard(mobile, ensureNotEmptyMobile); ensureNotEmptyMobile(mobile); }

    const items = await loadItems();
    const normalized = normalizeValid(items);

    desktops.forEach(c => renderDesktop(c, normalized));
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
