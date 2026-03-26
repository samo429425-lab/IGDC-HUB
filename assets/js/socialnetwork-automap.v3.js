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
    'social-tiktok',
    'social-instagram',
    'social-facebook',
    'social-twitter',
    'social-pinterest',
    'social-reddit',
    'social-wechat',
    'social-weibo'
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

    // Hard rule: never move/append outside. Only touch inside gridEl.
    const cards = ensureCards(gridEl, MAIN_LIMIT);
    const list = Array.isArray(items) ? items.slice(0, MAIN_LIMIT) : [];

    for(let i=0;i<MAIN_LIMIT;i++){
      const card = cards[i];
      if(!card) continue;

      const it = list[i] || null;
      const url = it ? pickUrl(it) : '#';
      const title = it ? pickTitle(it) : 'Loading…';
      const platform = it ? (pickPlatform(it) || '') : '';

      card.href = url || '#';
      card.target = (url && url !== '#') ? '_blank' : '_self';

      const pic = card.querySelector('.pic');
      const metaTitle = card.querySelector('.title');
      const desc = card.querySelector('.desc');

      if(metaTitle) metaTitle.textContent = title || 'Item';
      if(desc) desc.textContent = platform ? platform : ' ';

      // thumb as background image if exists, else keep emoji dot
      if(pic){
        const thumb = it ? pickThumb(it) : '';
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
        const grid = qs('#rowGrid' + i);
        if(!grid) continue;

        const key = MAIN_SECTION_ORDER[i-1];
        const items = sections[key] || [];
        renderRow(grid, items);
      }

// RIGHT panel
const rightBox = qs('[data-psom-key="' + RIGHT_SECTION_KEY + '"]');
if(rightBox){

  const page = snapshot.pages.social || {};
  const sections = page.sections || {};

  let rightItems = sections[RIGHT_SECTION_KEY];

  // 1차 fallback (right 구조)
  if(!rightItems && page.right && page.right.sections){
    rightItems = page.right.sections[RIGHT_SECTION_KEY];
  }

  // 2차 fallback (items 구조 대응)
  if(rightItems && !Array.isArray(rightItems)){
    rightItems = rightItems.items || [];
  }

  // 최종 정리
  rightItems = Array.isArray(rightItems) ? rightItems : [];

  renderRight(rightBox, rightItems);
}

window.__SOCIALNETWORK_AUTOMAP_V3_DONE__ = true;

}catch(e){
  console.error('[social-automap] fail', e);
}

  // run after DOM is ready + one micro delay (so dummy bootstrap has finished first paint)
  function boot(){
    setTimeout(run, 0);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }else{
    boot();
  }

})();
