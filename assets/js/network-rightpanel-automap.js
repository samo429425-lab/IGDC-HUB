// network-rightpanel-automap.js (PRODUCTION v5 - DESKTOP HOOK 유지 + MOBILE RAIL 정합)
// - sweeper 없이도 안전
// - 모바일 레일은 #nh-mobile-rail-list 에 .card 구조로 렌더 + 캡션(타이틀) 포함
// - 데스크탑은 window.__IGDC_RIGHTPANEL_RENDER(items) 그대로 사용

(function () {
  'use strict';

  if (window.__NETWORK_AUTOMAP_V5__) return;
  window.__NETWORK_AUTOMAP_V5__ = true;

  const SNAPSHOT_URL = '/data/networkhub-snapshot.json';
  const FEED_URL = '/.netlify/functions/feed-network?limit=100';
  const LIMIT = 100;

  const MOBILE_ID = 'nh-mobile-rail-list';
  const MOBILE_CSS_ID = 'nh-mobile-rail-fix-v1';

  function $(id){ return document.getElementById(id); }

  function pick(it, keys){
    for (const k of keys){
      const v = it && it[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function pickLink(it){ return pick(it, ['link','url','href']) || '#'; }
  function pickThumb(it){ return pick(it, ['thumb','image','thumbnail','img','photo','cover']); }
  function pickTitle(it){ return pick(it, ['title','name','label']); }

  function ensureMobileCss(){
    if (document.getElementById(MOBILE_CSS_ID)) return;
    const style = document.createElement('style');
    style.id = MOBILE_CSS_ID;
    style.textContent = `
/* network mobile rail fix (production) */
#nh-mobile-rail .card{ position:relative; }
#nh-mobile-rail .card a{ display:block; width:100%; height:100%; }
#nh-mobile-rail .card img{ display:block; width:100%; height:100%; object-fit:cover; }
#nh-mobile-rail .cap{
  position:absolute; left:0; right:0; bottom:0;
  padding:6px 10px;
  font-weight:800; font-size:.92rem; line-height:1.15;
  color:#fff;
  background:linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0));
  text-shadow:0 1px 2px rgba(0,0,0,.55);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
`;
    document.head.appendChild(style);
  }

  async function fetchJson(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      if (!r.ok) return null;
      return await r.json();
    }catch{
      return null;
    }
  }

  function normalizeItems(raw){
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const it of arr){
      const thumb = pickThumb(it);
      if (!thumb) continue;
      out.push({
        title: pickTitle(it),
        thumb,
        link: pickLink(it)
      });
      if (out.length >= LIMIT) break;
    }
    return out;
  }

  function renderMobile(items){
    const list = $(MOBILE_ID);
    if (!list) return;

    // 아이템이 없으면 기존 더미/기존 상태 유지 (절대 wipe 금지)
    if (!items || !items.length) return;

    ensureMobileCss();
    list.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const item of items){
      const card = document.createElement('div');
      card.className = 'card'; // ✅ CSS가 기대하는 클래스

      const a = document.createElement('a');
      a.href = item.link || '#';
      if (item.link && item.link !== '#'){
        a.target = '_blank';
        a.rel = 'noopener';
      }else{
        a.tabIndex = -1;
        a.setAttribute('aria-hidden','true');
      }

      const img = document.createElement('img');
      img.src = item.thumb;
      img.alt = item.title || '';
      img.loading = 'lazy';
      img.decoding = 'async';

      a.appendChild(img);
      card.appendChild(a);

      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = item.title || '';
      card.appendChild(cap);

      frag.appendChild(card);
    }
    list.appendChild(frag);
  }

 // ✅ 데스크탑 직접 렌더 함수 (hook 제거)
function renderDesktopDirect(items){
  const panel = document.getElementById('rightAutoPanel');
  if (!panel) return;

  // 데이터 없으면 기존 유지 (안전)
  if (!items || !items.length) return;

  panel.innerHTML = '';

  const frag = document.createDocumentFragment();

  for (const item of items){
    const box = document.createElement('div');
    box.className = 'ad-box';

    box.innerHTML = `
      <a href="${item.link || '#'}" target="_blank" rel="noopener">
        <img src="${item.thumb}" alt="${item.title || ''}" />
        <div class="ad-title">${item.title || ''}</div>
      </a>
    `;

    frag.appendChild(box);
  }

  panel.appendChild(frag);
}

// ✅ run 함수 교체
async function run(){
  const snap = await fetchJson(SNAPSHOT_URL);

  let items = snap && Array.isArray(snap.items)
    ? normalizeItems(snap.items)
    : [];

  if (!items.length){
    const feed = await fetchJson(FEED_URL);
    items = feed && Array.isArray(feed.items)
      ? normalizeItems(feed.items)
      : [];
  }

  // 모바일
  renderMobile(items);

  // 🔥 데스크탑 → 직접 렌더 (핵심 변경)
  renderDesktopDirect(items);
}

  // load + DOMContentLoaded 이중 안전
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(run, 0);
  } else {
    document.addEventListener('DOMContentLoaded', run, { once:true });
    window.addEventListener('load', run, { once:true });
  }

})();