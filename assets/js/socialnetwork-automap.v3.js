// socialnetwork-automap.v3.js (PRODUCTION — PSOM/SNAPSHOT LOCKED)
// A: Slot-out / wrong append issue
// A-1: No fallback append. Only renders into fixed slots (rowGrid1..9 + [data-psom-key="socialnetwork"]).
// B: What we do: fetch social.snapshot.json and mount 9*100 + right*100 safely.
// FIX ONLY: key mapping alignment (HTML ↔ snapshot ↔ automap). No feature reduction.

(function () {
  'use strict';

  if (window.__SOCIALNETWORK_AUTOMAP_V3_PROD__) return;
  window.__SOCIALNETWORK_AUTOMAP_V3_PROD__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';

  const MAIN_ROWS = 9;
  const MAIN_LIMIT = 100;
  const RIGHT_LIMIT = 100;

  // FIXED: aligned with socialnetwork.html / social.snapshot.json / feed-social.js canon
  const MAIN_SECTION_ORDER = [
  'social-youtube',
  'social-instagram',
  'social-tiktok',
  'social-facebook',
  'social-wechat',
  'social-weibo',
  'social-pinterest',
  'social-reddit',
  'social-twitter'
];

  const RIGHT_SECTION_KEY = 'socialnetwork';

  function qs(sel, root){ return (root || document).querySelector(sel); }

  function safeText(v){ return (v == null) ? '' : String(v); }

  function pickTitle(it){
    return safeText(it && (it.title || it.name || it.text || it.label));
  }
  function pickUrl(it){
    return safeText(it && (it.url || it.href || it.link)) || '#';
  }
  function pickThumb(it){
    return safeText(it && (it.thumb || it.image || it.thumbnail || it.imageUrl || it.thumbnailUrl));
  }
  function pickPlatform(it){
    return safeText(it && it.source && (it.source.platform || it.source.site || it.source.provider));
  }

  function ensureCards(gridEl, count){
    if(!gridEl) return [];
    const existing = Array.from(gridEl.querySelectorAll('a.card'));
    const need = count - existing.length;
    if(need > 0){
      const frag = document.createDocumentFragment();
      for(let i=0;i<need;i++){
        const a = document.createElement('a');
        a.className = 'card';
        a.href = '#';
        a.target = '_blank';
        a.rel = 'noopener';

        a.innerHTML =
          '<div class="pic">•</div>' +
          '<div class="meta">' +
            '<div class="title">Loading…</div>' +
            '<div class="desc">Preparing</div>' +
            '<span class="cta">Open</span>' +
          '</div>';

        frag.appendChild(a);
      }
      gridEl.appendChild(frag);
    }
    return Array.from(gridEl.querySelectorAll('a.card'));
  }

  function renderRow(gridEl, items){
  if(!gridEl) return;

  // 기존 더미/잔존 카드 제거 후 오토맵 결과만 다시 렌더
  gridEl.innerHTML = '';

  const list = Array.isArray(items) ? items.slice(0, MAIN_LIMIT) : [];
  const frag = document.createDocumentFragment();

  for(let i=0;i<MAIN_LIMIT;i++){
    const it = list[i] || null;

    const url = it ? pickUrl(it) : '#';
    const title = it ? pickTitle(it) : 'Loading…';
    const platform = it ? (pickPlatform(it) || '') : '';
    const thumb = it ? pickThumb(it) : '';

    const card = document.createElement('a');
    card.className = gridEl.closest('#rightAutoPanel') ? 'ad-box' : 'card';
    card.href = url || '#';
    card.target = (url && url !== '#') ? '_blank' : '_self';
    card.rel = 'noopener';

    card.innerHTML =
      '<div class="pic">•</div>' +
      '<div class="meta">' +
        '<div class="title">Loading…</div>' +
        '<div class="desc">Preparing</div>' +
        '<span class="cta">Open</span>' +
      '</div>';

    const pic = card.querySelector('.pic');
    const metaTitle = card.querySelector('.title');
    const desc = card.querySelector('.desc');

    if(metaTitle) metaTitle.textContent = title || 'Item';
    if(desc) desc.textContent = platform ? platform : ' ';

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

    frag.appendChild(card);
  }

  gridEl.appendChild(frag);
}

  function ensureThumbCards(boxEl, count){
    if(!boxEl) return [];
    const existing = Array.from(boxEl.querySelectorAll('a.thumb-card'));
    const need = count - existing.length;
    if(need > 0){
      const frag = document.createDocumentFragment();
      for(let i=0;i<need;i++){
        const a = document.createElement('a');
        a.className = 'thumb-card';
        a.href = '#';
        a.target = '_blank';
        a.rel = 'noopener';

        const img = document.createElement('img');
        img.className = 'thumb-media';
        img.alt = '';
        a.appendChild(img);

        const t = document.createElement('div');
        t.className = 'thumb-title';
        t.textContent = 'Loading…';
        a.appendChild(t);

        frag.appendChild(a);
      }
      boxEl.appendChild(frag);
    }
    return Array.from(boxEl.querySelectorAll('a.thumb-card'));
  }

  function renderRight(boxEl, items){
    if(!boxEl) return;

    const cards = ensureThumbCards(boxEl, RIGHT_LIMIT);
    const list = Array.isArray(items) ? items.slice(0, RIGHT_LIMIT) : [];

    for(let i=0;i<RIGHT_LIMIT;i++){
      const a = cards[i];
      if(!a) continue;

      const it = list[i] || null;
      const url = it ? pickUrl(it) : '#';
      const title = it ? pickTitle(it) : 'Loading…';
      const thumb = it ? pickThumb(it) : '';

      a.href = url || '#';
      a.target = (url && url !== '#') ? '_blank' : '_self';

      const img = a.querySelector('img.thumb-media') || a.querySelector('img');
      if(img){
        img.src = thumb || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
        img.alt = title || '';
      }
      const t = a.querySelector('.thumb-title');
      if(t) t.textContent = title || 'Item';
    }
  }

  function getSections(snapshot){
    try{
      return snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections;
    }catch(e){
      return null;
    }
  }

  async function loadSnapshot(){
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error('snapshot_load_failed:' + res.status);
    return res.json();
  }

  async function run(){
    try{
      const snap = await loadSnapshot();
      const sections = getSections(snap);
      if(!sections) return;

      // MAIN 9 rows
      for(let i=1;i<=MAIN_ROWS;i++){
        const key = MAIN_SECTION_ORDER[i-1];

        // rowGrid 자체를 비우지 말고, 그 안의 실제 슬롯 컨테이너만 잡는다
    const grid = qs('#rowGrid' + i + ' [data-psom-key="' + key + '"]');

        if(!grid) continue;

        const items = sections[key] || [];
        renderRow(grid, items);
      }

// RIGHT panel (실제 화면 기준 + psom 동기화 포함)
const rightBox = qs('#rightAutoPanel');
if(rightBox){

  const page = snap.pages.social || {};
  const pageSections = page.sections || {};

  let rightItems = pageSections[RIGHT_SECTION_KEY];

  if(!rightItems && page.right && page.right.sections){
    rightItems = page.right.sections[RIGHT_SECTION_KEY];
  }

  if(rightItems && !Array.isArray(rightItems)){
    rightItems = rightItems.items || [];
  }

  rightItems = (Array.isArray(rightItems) ? rightItems : [])
    .filter(it => it && it.type !== 'placeholder'); // 🔴 더미 제거

  renderRight(rightBox, rightItems);

  // 🔴 psom-key 영역도 동기화 (기존 구조 유지)
  const shadow = qs('[data-psom-key="' + RIGHT_SECTION_KEY + '"]');
  if(shadow){
    shadow.innerHTML = rightBox.innerHTML;
  }
}

window.__SOCIALNETWORK_AUTOMAP_V3_DONE__ = true;

}catch(e){
  console.error('[social-automap] fail', e);
}

  // run after DOM is ready + one micro delay (so dummy bootstrap has finished first paint)
 function boot(){
  run();
}

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }else{
    boot();
  }

})();
