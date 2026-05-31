// socialnetwork-automap.v3.fixed.js
// 목적:
// 1) social.snapshot.json 실데이터가 있으면 메인 9섹션 + 우측 패널에 꽂는다.
// 2) 실데이터가 없으면 기존 HTML/더미를 절대 지우지 않는다.
// 3) key는 하드코딩 최소화: HTML의 data-psom-key를 그대로 읽는다.
// 4) 우측 패널도 실데이터가 있을 때만 기존 더미를 밀어내고 교체한다.

(function () {
  'use strict';

 // --- bootstrap guard ---
 if (window.__SOCIALNETWORK_AUTOMAP_V3_FIXED__ === true) return;
 window.__SOCIALNETWORK_AUTOMAP_V3_FIXED__ = true;

 // --- config ---
 const SNAPSHOT_URL = "/data/social.snapshot.json";
 const MAIN_ROWS = 9;
 const MAIN_LIMIT = 100;
 const RIGHT_LIMIT = 100;
 const RIGHT_SECTION_KEY = "rightPanel";

  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function safeText(v){ return v == null ? '' : String(v); }

  function pickTitle(it){
    return safeText(it && (it.title || it.name || it.text || it.label));
  }

  function pickUrl(it){
    return safeText(it && (it.url || it.href || it.link || it.productUrl || it.detailUrl)) || '#';
  }

  function pickThumb(it){
    return safeText(it && (it.thumb || it.image || it.thumbnail || it.imageUrl || it.thumbnailUrl));
  }

  function pickDesc(it){
    return safeText(
      it && (
        it.description ||
        it.summary ||
        (it.source && (it.source.platform || it.source.site || it.source.provider)) ||
        ''
      )
    );
  }

function isRealItem(it){
  return !!it;
}

function getSections(snapshot){
  if(!snapshot) return null;

  const sec =
    snapshot?.pages?.social?.sections ||
    snapshot?.sections ||
    null;

  if(!sec) return null;

  return sec;
}

  async function loadSnapshot(){
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error('snapshot_load_failed:' + res.status);
    return res.json();
  }

function getMainSlots(gridEl){
  if(!gridEl) return [];
  return qsa('a.card', gridEl);
}

  function paintMainCard(card, it){
    if(!card) return;

    const url = pickUrl(it);
    const title = pickTitle(it) || 'Item';
    const desc = pickDesc(it) || ' ';
    const thumb = pickThumb(it);

    card.href = url || '#';
    card.target = (url && url !== '#') ? '_blank' : '_self';
    card.rel = 'noopener';
    card.removeAttribute('data-dummy');

    const pic = qs('.pic', card);
    const metaTitle = qs('.title', card);
    const metaDesc = qs('.desc', card);

    if(metaTitle) metaTitle.textContent = title;
    if(metaDesc) metaDesc.textContent = desc;

    if(pic){
      if(thumb){
        pic.textContent = '';
        pic.style.backgroundImage = "url('" + thumb.replace(/'/g, "%27") + "')";
        pic.style.backgroundSize = 'cover';
        pic.style.backgroundPosition = 'center';
      }else{
        pic.style.backgroundImage = '';
        pic.textContent = '•';
      }
    }
  }

 function resetMainCardToDummy(card){
  if(!card) return;

  card.href = '#';
  card.target = '_self';
  card.rel = 'noopener';
  card.dataset.dummy = '1';

  const pic = qs('.pic', card);
  const metaTitle = qs('.title', card);
  const metaDesc = qs('.desc', card);

  if(metaTitle) metaTitle.textContent = 'Loading';
  if(metaDesc) metaDesc.textContent = 'Preparing';

  if(pic){
    pic.style.backgroundImage = '';
    pic.textContent = '';
  }
}

function mountMainRow(gridEl, items){
  if(!gridEl) return;

const raw = Array.isArray(items) ? items : [];
const displayItems = raw.slice(0, MAIN_LIMIT);

// 🔥 핵심: slot 강제 채움 (디스트리뷰션 방식)
while (displayItems.length < MAIN_LIMIT) {
  displayItems.push(null);
}

  // 기존 카드 가져오기
  let cards = getMainSlots(gridEl);

  // 부족하면 카드 생성
  if(cards.length < MAIN_LIMIT){

    const frag = document.createDocumentFragment();

    for(let i = cards.length; i < MAIN_LIMIT; i++){
      const a = document.createElement('a');
      a.className = 'card';
      a.href = '#';

      a.innerHTML = `
        <div class="pic"></div>
        <div class="meta">
          <div class="title"></div>
          <div class="desc"></div>
        </div>
      `;

      frag.appendChild(a);
    }

    gridEl.appendChild(frag);

    // 다시 카드 목록 갱신
    cards = getMainSlots(gridEl);
  }

  // 데이터 렌더
  for(let i = 0; i < cards.length; i++){
    const card = cards[i];
    const it = displayItems[i] || null;

    if(it) paintMainCard(card, it);
    else resetMainCardToDummy(card);
  }
}

 function getRightPanels(){
  return qsa('[data-psom-key="rightPanel"]');
}

function getRightCards(panel){
  if(!panel) return [];

  let cards = qsa('.ad-box', panel);

  if(cards.length === 0){
    const frag = document.createDocumentFragment();

    for(let i = 0; i < RIGHT_LIMIT; i++){
      const box = document.createElement('div');
      box.className = 'ad-box product-card';
      box.dataset.dummy = '1';
      box.innerHTML = '<a href="/pages/coming-soon.html?from=social-rightpanel" data-product-id="" data-product-title="RIGHT SAMPLE" data-product-link="/pages/coming-soon.html?from=social-rightpanel">RIGHT SAMPLE</a>';
      frag.appendChild(box);
    }

    panel.appendChild(frag);
    cards = qsa('.ad-box', panel);
  }

  return cards;
}

function paintRightCard(box, it){
  if(!box) return;

  const url = pickUrl(it) || '/pages/coming-soon.html?from=social-rightpanel';
  const title = pickTitle(it) || 'RIGHT SAMPLE';
  const productId = safeText(it && (it.productId || it.product_id || it.id || it.sku || it.code));

  box.className = 'ad-box product-card';
  box.removeAttribute('data-dummy');
  box.dataset.productId = productId;
  box.dataset.productTitle = title;
  box.dataset.productLink = url;

  let a = qs('a', box);
  if(!a){
    box.innerHTML = '';
    a = document.createElement('a');
    box.appendChild(a);
  }

  a.href = url;
  a.target = (url && url !== '#' && !url.includes('/pages/coming-soon.html')) ? '_blank' : '_self';
  a.rel = 'noopener';
  a.textContent = title;
  a.dataset.productId = productId;
  a.dataset.productTitle = title;
  a.dataset.productLink = url;
}

function resetRightCardToDummy(box){
  if(!box) return;

  const fallback = '/pages/coming-soon.html?from=social-rightpanel';

  box.className = 'ad-box product-card';
  box.dataset.dummy = '1';
  box.dataset.productId = '';
  box.dataset.productTitle = 'RIGHT SAMPLE';
  box.dataset.productLink = fallback;

  let a = qs('a', box);
  if(!a){
    box.innerHTML = '';
    a = document.createElement('a');
    box.appendChild(a);
  }

  a.href = fallback;
  a.target = '_self';
  a.rel = 'noopener';
  a.textContent = 'RIGHT SAMPLE';
  a.dataset.productId = '';
  a.dataset.productTitle = 'RIGHT SAMPLE';
  a.dataset.productLink = fallback;
}

function mountRightPanel(panel, items){
  if(!panel) return;

  const raw = Array.isArray(items) ? items : [];

  const usable = raw.filter(function(it){
    if(!it) return false;

    const title = pickTitle(it).trim();
    const url = pickUrl(it).trim();
    const thumb = pickThumb(it).trim();

    // placeholder/빈데이터는 실카드로 취급하지 않음
    if(title === 'Loading…' || title === 'Loading...' || title === 'RIGHT SAMPLE') return false;
    if(url === '#' && !thumb) return false;

    return !!(title || thumb || (url && url !== '#'));
  });

  const displayItems = usable.slice(0, RIGHT_LIMIT);

  while(displayItems.length < RIGHT_LIMIT){
    displayItems.push(null);
  }

  const cards = getRightCards(panel);

  for(let i = 0; i < cards.length; i++){
    const box = cards[i];
    const it = displayItems[i];

    if(it){
      paintRightCard(box, it);
    }else{
      resetRightCardToDummy(box);
    }
  }
}

  async function run(){
	  
    try{
      const snap = await loadSnapshot();
      const sections = getSections(snap);
      if(!sections) return;

const grids = document.querySelectorAll('[data-psom-key]');

grids.forEach(grid => {
  const key = grid.getAttribute('data-psom-key');
  if(!key) return;

  if(key === 'rightPanel') return;
  if(key === 'social-maru') return;

const raw = sections[key];

const items = Array.isArray(raw)
  ? raw
  : (Array.isArray(raw?.items) ? raw.items : []);

// 🔥 샘플 자동 주입 (데이터 없을 때)
const finalItems = items.length > 0 ? items : [{
  title: key + " SAMPLE",
  url: "#",
  thumbnail: ""
}];

  mountMainRow(grid, finalItems);
});

const rightPanels = getRightPanels();

if(rightPanels.length){
  const raw =
    Array.isArray(sections.rightPanel)
      ? sections.rightPanel
      : (Array.isArray(sections.rightPanel?.items) ? sections.rightPanel.items : []);

  const finalItems = raw.length > 0 ? raw : [{
    title: "RIGHT SAMPLE",
    url: "/pages/coming-soon.html?from=social-rightpanel"
  }];

  rightPanels.forEach(function(panel){
    mountRightPanel(panel, finalItems);
  });
}

      window.__SOCIALNETWORK_AUTOMAP_V3_DONE__ = true;
    }catch(e){
      console.error('[social-automap-fixed] fail', e);
    }
  }

  function boot(){
    run();
  }
window.addEventListener('igdc:rightpanel:refresh', function(){
  run();
});
  boot();

})();


/* ------------------------------------------------------------------
 * MARU Revenue AutoHook Loader
 * Added by revenue tracking patch.
 *
 * Purpose:
 * - Load /assets/js/maru-revenue-tracker.js
 * - Then load /assets/js/maru-revenue-autohook.js
 * - Do not change this automap's original rendering pipeline.
 * ------------------------------------------------------------------ */
(function loadMaruRevenueAutoHookForAutomap(){
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function installIfReady(){
    try {
      if (
        window.MaruRevenueAutoHook &&
        typeof window.MaruRevenueAutoHook.install === "function"
      ) {
        window.MaruRevenueAutoHook.install({
          service: "front-automap"
        });
      }
    } catch (e) {
      console.warn("[MARU Revenue] autohook install skipped:", e);
    }
  }

  function loadScriptOnce(src, id, globalName, done){
    var existing = document.getElementById(id);

    if (window[globalName]) {
      if (typeof done === "function") done();
      return;
    }

    if (existing) {
      existing.addEventListener("load", function(){
        if (typeof done === "function") done();
      }, { once:true });
      existing.addEventListener("error", function(){
        console.warn("[MARU Revenue] failed to load:", src);
      }, { once:true });
      return;
    }

    var script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    script.onload = function(){
      if (typeof done === "function") done();
    };
    script.onerror = function(){
      console.warn("[MARU Revenue] failed to load:", src);
    };

    (document.head || document.documentElement).appendChild(script);
  }

  if (window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__) {
    installIfReady();
    return;
  }

  window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__ = true;

  loadScriptOnce(
    "/assets/js/maru-revenue-tracker.js",
    "maruRevenueTrackerScript",
    "MaruRevenueTracker",
    function(){
      loadScriptOnce(
        "/assets/js/maru-revenue-autohook.js",
        "maruRevenueAutoHookScript",
        "MaruRevenueAutoHook",
        installIfReady
      );
    }
  );
})();
