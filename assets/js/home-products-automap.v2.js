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
  const ALL_KEYS   = KEYS_MAIN.concat(KEYS_RIGHT);

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
  const SUPPORTED_12 = new Set(['de','en','es','fr','id','ja','pt','ru','th','tr','vi','zh']);

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
        t.scroller.style.display = 'none';
      } else {
        // RIGHT direct: keep panel visible
      }
    }
  }

  function showData(t){
    t.psomEl.style.display = 'none';
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
    a.className = 'ad-box';
    a.href = item.url || '#';
    if (isExternal(item.url)) { a.target = '_blank'; a.rel = 'noopener'; }
    else { a.target = '_self'; }

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (item.thumb){
      const u = String(item.thumb).replace(/"/g,'\\"');
      thumb.style.backgroundImage = `url("${u}")`;
      thumb.style.backgroundPosition = 'center';
      thumb.style.backgroundSize = 'cover';
      thumb.style.backgroundRepeat = 'no-repeat';
    }

    // ✅ 우측 패널도 “실데이터 카드”처럼 보이도록 캡션 추가
    const cap = document.createElement('div');
    cap.className = 'ad-cap';
    cap.textContent = item.title || item.name || '';
    cap.style.width = '100%';
    cap.style.background = 'rgba(255,255,255,.88)';
    cap.style.padding = '6px 8px';
    cap.style.fontWeight = '700';
    cap.style.fontSize = '13px';
    cap.style.color = '#222';
    cap.style.whiteSpace = 'nowrap';
    cap.style.overflow = 'hidden';
    cap.style.textOverflow = 'ellipsis';

    a.style.display = 'grid';
    a.style.gridTemplateRows = '1fr auto';
    a.style.alignItems = 'stretch';
    a.style.justifyItems = 'stretch';

    a.appendChild(thumb);
    if (cap.textContent) a.appendChild(cap);

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

    for (const k of ALL_KEYS){
      if (Array.isArray(payload[k])) map[k] = payload[k];
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

      for (const key of ALL_KEYS){
        const alt = key.replace(/_/g,'-');
        renderSlot(key, byId[key] || byId[alt] || byId[legacyKey(key)] || []);
      }
    }catch(e){
      for (const key of ALL_KEYS){
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

// hasReal flag fallback
