// === PATCH: RIGHT PANEL USE SECTIONS ONLY (FINAL) ===
/**
 * home-products-automap.v2.js  (RIGHT-PANEL SAFE)
 * Purpose:
 *  - Keep MAIN (home_1..home_5) behavior unchanged.
 *  - Enable RIGHT panel (home_right_top/middle/bottom) rendering for BOTH DOM layouts:
 *      A) .ad-section > .ad-scroll > .ad-list  (structured)
 *      B) data-psom-key is directly on .ad-list (direct/legacy)
 *
 * Data source:
 *  - /.netlify/functions/feed?page=homeproducts
 *  - Expects payload.sections = [{id, items:[...]} ...]
 *
 * Notes:
 *  - No global CSS/zoom/transform changes.
 *  - No deletion of existing features: empty-state i18n, incremental rendering, priority sort.
 */
(function () {
  'use strict';
  if (window.__HOME_PRODUCTS_AUTOMAP_V2__) return;
  window.__HOME_PRODUCTS_AUTOMAP_V2__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';

  const KEYS_MAIN  = ['home_1','home_2','home_3','home_4','home_5'];
  const KEYS_RIGHT = ['home_right_top','home_right_middle','home_right_bottom'];

  const MAIN_LIMIT = 100, MAIN_BATCH = 7;
  const RIGHT_LIMIT = 80, RIGHT_BATCH = 5;

  const EMPTY_I18N = {
    de: 'Inhalte werden vorbereitet.',
    en: 'Content is being prepared.',
    es: 'El contenido está en preparación.',
    fr: 'Contenu en cours de préparation.',
    id: 'Konten sedang disiapkan.',
    ja: 'コンテンツ準備中です。',
    ko: '콘텐츠 준비 중입니다.',
    pt: 'Conteúdo em preparação.',
    ru: 'Контент готовится.',
    th: 'กำลังเตรียมเนื้อหาอยู่',
    tr: 'İçerik hazırlanıyor.',
    vi: 'Nội dung đang được chuẩn bị.',
    zh: '内容正在准备中。'
  };
// 인덱스 상단 – 전체 선택용
const ALL_LOCALES = [
  'ko','en','ja','zh','fr','de','es','pt','ru','it','tr','vi','th',
  'id','pl','nl','sv','no','fi','da','ar'
];

  function getLangCode(){
    try{
      const raw = String(
        (window.localStorage && localStorage.getItem('igdc_lang')) ||
        (document.documentElement && document.documentElement.getAttribute('lang')) ||
        (navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) ||
        'en'
      ).trim().toLowerCase();
      const base = raw.split('-')[0];
      if (SUPPORTED_12.has(base)) return base;
      if (base === 'ko') return 'ko';
      return 'en';
    }catch(e){ return 'en'; }
  }
  function emptyText(){ return EMPTY_I18N[getLangCode()] || EMPTY_I18N.en; }

  function qs(sel, root){ return (root||document).querySelector(sel); }

  function pick(o, keys){
    for (const k of keys){
      const v = o && o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function normItem(it){
    it = it || {};
    return {
      title: pick(it, ['title','name','label','caption']) || 'Item',
      thumb: pick(it, ['thumb','image','image_url','img','photo','thumbnail','thumbnailUrl','cover','coverUrl']),
      url:   pick(it, ['checkoutUrl','productUrl','url','href','link','path','detailUrl']) || '#',
      priority: (typeof it.priority === 'number' ? it.priority : null)
    };
  }

  function isExternal(url){ return /^https?:\/\//i.test(url); }

  // ===== DOM target resolution =====
  
function getSectionItemsByKey(data, key){
  if (!data || !Array.isArray(data.sections)) return [];
  const sec = data.sections.find(s => s.id === key);
  return sec && Array.isArray(sec.items) ? sec.items : [];
}

function resolveTargets(psomEl, key){
    const isRight = key.indexOf('home_right_') === 0;

    if (isRight){
      // Layout A: structured ad-section
      const section = psomEl.closest('.ad-section');
      const scrollA = section && (section.querySelector('.ad-scroll') || section);
      const listA = section && section.querySelector('.ad-list');
      if (listA) {
        return { isRight: true, mode: 'ad-section', section, scroller: scrollA, list: listA, psomEl };
      }

      // Layout B: direct list (data-psom-key is on .ad-list itself)
      const panel = psomEl.closest('.right-panel') || psomEl.closest('.ad-panel') || null;
      const scrollB = psomEl.closest('.ad-scroll') || panel || null;
      const listB = psomEl; // render directly into psom node
      return { isRight: true, mode: 'direct', section: panel, scroller: scrollB, list: listB, psomEl };
    }

    // MAIN
    const scroller = psomEl.closest('.shop-scroller');
    const row = scroller && scroller.querySelector('.shop-row');
    return { isRight: false, mode: 'shop', section: scroller, scroller, list: row, psomEl };
  }

    function showEmpty(t){
    // If psomEl is the render list itself (RIGHT panels often use data-psom-key on .ad-list),
    // never hide the list; show the empty message inside it.
    const psomIsList = (t.psomEl === t.list);

    // RIGHT direct 모드에서는 빈 상태를 리스트에 그리지 않음 (반짝 방지)
    if (t.isRight && t.mode === 'direct') {
    return;
  }

    t.psomEl.style.display = 'block';
    t.psomEl.textContent = emptyText();
    t.psomEl.style.padding = '12px';
    t.psomEl.style.borderRadius = '12px';
    t.psomEl.style.background = '#f7f7f7';
    t.psomEl.style.color = '#666';
    t.psomEl.style.textAlign = 'center';
    t.psomEl.style.fontSize = '14px';
    t.psomEl.style.lineHeight = '1.6';
    t.psomEl.style.minHeight = '44px';

    if (t.scroller) {
      if (!t.isRight) {
        t.scroller.style.display = 'none';
      } else if (t.mode === 'ad-section') {
        // RIGHT ad-section: keep scroller visible when psomEl is list (otherwise list will disappear)
        if (!psomIsList) t.scroller.style.display = 'none';
      } else {
        // RIGHT direct: keep panel visible
      }
    }
  }

  function showData(t){
    const psomIsList = (t.psomEl === t.list);

    // If psomEl is the list itself, do NOT hide it.
    if (!psomIsList) {
      t.psomEl.style.display = 'none';
    } else {
      t.psomEl.style.display = '';
      // clear empty message styling if any
      t.psomEl.textContent = '';
      t.psomEl.style.padding = '';
      t.psomEl.style.background = '';
      t.psomEl.style.borderRadius = '';
      t.psomEl.style.color = '';
      t.psomEl.style.textAlign = '';
      t.psomEl.style.fontSize = '';
      t.psomEl.style.lineHeight = '';
      t.psomEl.style.minHeight = '';
    }

    if (t.scroller) {
      if (!t.isRight) {
        t.scroller.style.display = '';
      } else if (t.mode === 'ad-section') {
        t.scroller.style.display = '';
      } else {
        // RIGHT direct: keep panel visible
      }
    }
  }

  function buildMainCard(item){
    const a = document.createElement('a');
    a.className = 'shop-card';
    a.href = item.url || '#';
    if (isExternal(item.url)) { a.target = '_blank'; a.rel = 'noopener'; }

    if (item.thumb){
      const u = String(item.thumb).replace(/"/g,'\\"');
      a.style.backgroundImage = `url("${u}")`;
      a.style.backgroundPosition = 'center';
      a.style.backgroundSize = 'cover';
      a.style.backgroundRepeat = 'no-repeat';
    }

    const cap = document.createElement('div');
    cap.className = 'shop-card-cap';
    cap.textContent = item.title || '';
    cap.style.alignSelf = 'end';
    cap.style.width = '100%';
    cap.style.background = 'rgba(255,255,255,.88)';
    cap.style.padding = '6px 8px';
    cap.style.fontWeight = '700';
    cap.style.fontSize = '14px';
    cap.style.color = '#222';
    cap.style.whiteSpace = 'nowrap';
    cap.style.overflow = 'hidden';
    cap.style.textOverflow = 'ellipsis';

    a.style.display = 'grid';
    a.style.gridTemplateRows = '1fr auto';
    a.style.alignItems = 'stretch';
    a.style.justifyItems = 'stretch';

    a.appendChild(cap);
    return a;
  }

   function buildRightCard(item){
  const a = document.createElement('a');
  a.className = 'ad-box news-btn';
  a.href = item.url || '#';
  a.target = '_blank';
  a.draggable = false;

  /* mobile drag friendliness */
  a.style.touchAction = 'auto';
  a.style.userSelect = 'none';
  a.style.webkitUserSelect = 'none';
  a.style.webkitTouchCallout = 'none';
  a.style.flex = '0 0 auto';

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = item.thumb || '';
  img.alt = item.title || '';
  img.draggable = false;
  img.style.pointerEvents = 'none';
  img.style.userSelect = 'none';
  img.style.webkitUserSelect = 'none';

  a.appendChild(img);
  return a;
}


  function indexSections(payload){
    const map = {};
    if (!payload) return map;

    if (Array.isArray(payload.sections)){
      for (const s of payload.sections){
        const id = String((s && (s.id || s.sectionId) || '')).trim();
        if (!id) continue;
        map[id] = Array.isArray(s.items) ? s.items : (Array.isArray(s.cards) ? s.cards : []);
      }
    }


    return map;
  }

  function legacyKey(key){
    if (key.startsWith('home_right_')) return key.replace('home_right_','home-right-');
    return key.replace('home_','home-shop-');
  }

 function bindIncremental(t, items){
  const isRight = t.isRight;
  const limit = isRight ? RIGHT_LIMIT : MAIN_LIMIT;
  const batch = isRight ? RIGHT_BATCH : MAIN_BATCH;

  let offset = 0;

  function renderMore(){
    const end = Math.min(offset + batch, limit, items.length);
    const frag = document.createDocumentFragment();
    for (let i = offset; i < end; i++){
      const it = items[i];
      frag.appendChild(isRight ? buildRightCard(it) : buildMainCard(it));
    }
    t.list.appendChild(frag);
    offset = end;
  }

  t.list.innerHTML = '';
  renderMore();

  const sc = t.scroller;
  if (!sc) return;

  if (isRight){
  try{
    sc.style.overflowX = 'auto';
    sc.style.overflowY = 'hidden';
    sc.style.webkitOverflowScrolling = 'touch';

    /* mobile drag sensitivity improve */
    sc.style.scrollBehavior = 'smooth';
    sc.style.touchAction = 'pan-x pan-y';
  }catch(e){}


  sc.addEventListener('scroll', function(){
    if (offset >= items.length || offset >= limit) return;

    const nearEnd = isRight
      ? (sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 120)
      : (sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 20);

    if (nearEnd) renderMore();
  }, { passive: true });
}

  function renderSlot(key, rawItems){
    const psomEl = qs(`[data-psom-key="${key}"]`);
    if (!psomEl) return;

    const t = resolveTargets(psomEl, key);
    if (!t.list) return;

 // RIGHT panel scroll safety (mobile drag fix)
if (t.isRight && t.scroller) {
  try{
    /* allow vertical page scroll + horizontal card drag */
    t.scroller.style.overflow = 'auto';
    t.scroller.style.webkitOverflowScrolling = 'touch';
    t.scroller.style.touchAction = 'auto';
  }catch(e){}
}

    const isRight = t.isRight;

    let list = (rawItems || []).map(normItem).filter(x => {
      if (!x) return false;
      if (isRight) return true;
      return !!x.thumb;
    });

    list.sort((a,b) => {
      const pa = (a.priority == null ? 999999 : a.priority);
      const pb = (b.priority == null ? 999999 : b.priority);
      return pa - pb;
    });

    if (!list.length){
      showEmpty(t);
      return;
    }

    // RIGHT panel: 기존 카드 제거 (데이터 1개라도 오면 교체)
    if (t.isRight) {
      t.list.innerHTML = '';
    }

    showData(t);
    bindIncremental(t, list);
  }

async function load(){
  try{
    const r = await fetch(FEED_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const payload = await r.json();
    const byId = indexSections(payload);

    // MAIN (복구)
    for (const key of KEYS_MAIN){
      const alt = key.replace(/_/g,'-');
      renderSlot(key, byId[key] || byId[alt] || byId[legacyKey(key)] || []);
    }

    // RIGHT (유지)
    for (const key of KEYS_RIGHT){
      const alt = key.replace(/_/g,'-');
      renderSlot(key, byId[key] || byId[alt] || byId[legacyKey(key)] || []);
    }

  }catch(e){
    // 에러 시에도 MAIN + RIGHT 모두 empty 처리
    for (const key of KEYS_MAIN.concat(KEYS_RIGHT)){
      const psomEl = qs(`[data-psom-key="${key}"]`);
      if (!psomEl) continue;
      const t = resolveTargets(psomEl, key);
      showEmpty(t);
    }
  }
}



  function boot(){ load(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
