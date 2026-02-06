// === PATCH: HOME PRODUCTS AUTOMAP (V3, SAFE + BANK-FEED) ===
/**
 * home-products-automap.v2.js  (V3-SAFE drop-in)
 * ------------------------------------------------------------
 * Data source: /.netlify/functions/feed-home
 * Expected: payload.sections = [{id, items:[...]} ...]
 *
 * SAFETY:
 *  - HARD scope to Home page only (avoid Distribution bleed).
 *  - If fetch fails OR sections empty -> keep original DOM (offline-safe).
 *  - RIGHT direct-mode never paints empty text into list (flicker-safe).
 */
(function () {
  'use strict';
  if (window.__HOME_PRODUCTS_AUTOMAP_V3__) return;
  window.__HOME_PRODUCTS_AUTOMAP_V3__ = true;

  // ---- HARD SCOPE GUARD: run only if Home psom keys exist ----
  function hasHomeSlots(){
    try{ return !!document.querySelector('[data-psom-key="home_1"], [data-psom-key="home_right_top"]'); }
    catch(e){ return false; }
  }
  if (!hasHomeSlots()) return;

  const FEED_URL = '/.netlify/functions/feed-home';

  const KEYS_MAIN  = ['home_1','home_2','home_3','home_4','home_5'];
  const KEYS_RIGHT = ['home_right_top','home_right_middle','home_right_bottom'];

  const MAIN_LIMIT = 50, MAIN_BATCH = 5;
  const RIGHT_LIMIT = 30, RIGHT_BATCH = 3;

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
  const SUPPORTED_12 = new Set(['ko','en','ja','zh','fr','de','es','pt','ru','th','tr','vi','id']);
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
      title: pick(it, ['title','name','label','caption','text']) || 'Item',
      thumb: pick(it, ['thumb','image','image_url','img','photo','thumbnail','thumbnailUrl','cover','coverUrl','poster']),
      url:   pick(it, ['checkoutUrl','productUrl','url','href','link','path','detailUrl']) || '#',
      priority: (typeof it.priority === 'number' ? it.priority : null)
    };
  }

  function isExternal(url){ return /^https?:\/\//i.test(url); }

  // ===== DOM target resolution =====
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
    const psomIsList = (t.psomEl === t.list);

    // RIGHT direct 모드에서는 빈 상태를 리스트에 그리지 않음 (반짝 방지)
    if (t.isRight && t.mode === 'direct') return;

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
        if (!psomIsList) t.scroller.style.display = 'none';
      }
    }
  }

  function showData(t){
    const psomIsList = (t.psomEl === t.list);

    if (!psomIsList) {
      t.psomEl.style.display = 'none';
    } else {
      t.psomEl.style.display = '';
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

    if (t.scroller) t.scroller.style.display = '';
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
    a.rel = 'noopener';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = item.thumb || '';
    img.alt = item.title || '';
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

    sc.addEventListener('scroll', function(){
      if (offset >= items.length || offset >= limit) return;

      const nearEnd = isRight
        ? (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 20)
        : (sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 20);

      if (nearEnd) renderMore();
    }, { passive: true });
  }

  function renderSlot(key, rawItems){
    const psomEl = qs(`[data-psom-key="${key}"]`);
    if (!psomEl) return;

    const t = resolveTargets(psomEl, key);
    if (!t.list) return;

    // RIGHT panel scroll safety
    if (t.isRight && t.scroller) {
      try{
        t.scroller.style.overflowY = 'auto';
        t.scroller.style.webkitOverflowScrolling = 'touch';
        t.scroller.style.touchAction = 'pan-y';
      }catch(e){}
    }

    const isRight = t.isRight;
    let list = (rawItems || []).map(normItem).filter(x => {
      if (!x) return false;
      if (isRight) return true;
      return !!x.thumb; // MAIN requires thumb
    });

    list.sort((a,b) => {
      const pa = (a.priority == null ? 999999 : a.priority);
      const pb = (b.priority == null ? 999999 : b.priority);
      return pa - pb;
    });

    if (!list.length){
      // DO NOT wipe original DOM on empty; just show empty message (MAIN) or do nothing (RIGHT direct)
      showEmpty(t);
      return;
    }

    // SUCCESS PATH: replace existing cards
    t.list.innerHTML = '';
    showData(t);
    bindIncremental(t, list);
  }

  async function load(){
    const r = await fetch(FEED_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const payload = await r.json();
    const byId = indexSections(payload);

    const anyData =
      Object.keys(byId).some(k => Array.isArray(byId[k]) && byId[k].length);

    if (!anyData) throw new Error('0 sections/items');

    for (const key of KEYS_MAIN){
      renderSlot(key, byId[key] || []);
    }
    for (const key of KEYS_RIGHT){
      renderSlot(key, byId[key] || []);
    }
  }

  function boot(){
    // Offline-safe: on failure, keep original DOM (do NOT clear)
    load().catch(() => {
      // MAIN: show empty text in psom placeholder only (non-destructive)
      for (const key of KEYS_MAIN.concat(KEYS_RIGHT)){
        const psomEl = qs(`[data-psom-key="${key}"]`);
        if (!psomEl) continue;
        const t = resolveTargets(psomEl, key);
        showEmpty(t);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
