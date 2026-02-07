/**
 * home-products-automap.v2.domfit.safe.js
 * Baseline: domfit (renders into real containers used by home.html)
 * Safety upgrades (no layout break):
 *  - Never "main disappears" due to thumb filter (removed).
 *  - Do NOT wipe existing DOM on fetch error / empty payload.
 *  - Only replace list when VALID data exists.
 *  - Attach scroll listener once (avoid duplicates).
 *  - Keep MAIN in .shop-row and RIGHT in .ad-list (no direct-mode).
 *
 * Fetch: /.netlify/functions/feed?page=homeproducts
 */

(function () {
  'use strict';
  if (window.__HOME_AUTOMAP_DOMFIT_SAFE__) return;
  window.__HOME_AUTOMAP_DOMFIT_SAFE__ = true;

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

  // ===== DOM target resolution (REAL containers only) =====
  function resolveTargets(psomEl, key){
    const isRight = key.indexOf('home_right_') === 0;

    if (isRight){
      const section = psomEl.closest('.ad-section');
      const scroll = section && (section.querySelector('.ad-scroll') || section);
      const list = section && section.querySelector('.ad-list');
      return { isRight: true, section, scroller: scroll, list, psomEl };
    }

    const scroller = psomEl.closest('.shop-scroller');
    const row = scroller && scroller.querySelector('.shop-row');
    return { isRight: false, section: scroller, scroller, list: row, psomEl };
  }

  // ===== Empty/Data state (SAFE: preserve existing visuals when present) =====
  function showEmpty(t, opts){
    opts = opts || {};
    const preserveIfHasChildren = !!opts.preserveIfHasChildren;

    // Always show message on psom (per baseline),
    // BUT do not hide existing list if it already has content and we want to preserve.
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

    if (!t.scroller) return;

    const hasChildren = !!(t.list && t.list.children && t.list.children.length);
    if (preserveIfHasChildren && hasChildren) {
      // keep scroller visible; message still appears (psom), but list remains
      t.scroller.style.display = '';
      return;
    }

    // baseline: hide list area when empty
    t.scroller.style.display = 'none';
  }

  function showData(t){
    // hide message, show list area
    t.psomEl.style.display = 'none';
    if (t.scroller) t.scroller.style.display = '';
  }

  // ===== Card builders (match home.html CSS) =====
  function buildMainCard(item){
    const a = document.createElement('a');
    a.className = 'shop-card';
    a.href = item.url || '#';
    if (isExternal(item.url)) { a.target = '_blank'; a.rel = 'noopener'; }

    // image background (optional)
    if (item.thumb){
      a.style.background = `center/cover no-repeat url("${String(item.thumb).replace(/"/g,'\\"')}")`;
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
      thumb.style.background = `center/cover no-repeat url("${String(item.thumb).replace(/"/g,'\\"')}")`;
    }
    a.appendChild(thumb);
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

    // defensive: accept direct keys
    for (const k of ALL_KEYS){
      if (Array.isArray(payload[k])) map[k] = payload[k];
    }
    return map;
  }

  function legacyKey(key){
    // Accept snapshot legacy ids too (if feed isn't mapped)
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

    // Replace only when we have VALID data (caller guarantees items.length > 0)
    t.list.innerHTML = '';
    t.list.dataset.automapManaged = '1';
    renderMore();

    const sc = t.scroller;
    if (!sc) return;

    // Attach scroll listener once per scroller+key
    const marker = `automapBound:${t.isRight ? 'R' : 'M'}:${t.psomEl.getAttribute('data-psom-key') || ''}`;
    if (sc.dataset && sc.dataset[marker] === '1') return;
    if (sc.dataset) sc.dataset[marker] = '1';

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
    if (!t || !t.list) return;

    // Normalize (NO thumb filter: keep titles even if thumb missing)
    let list = (rawItems || []).map(normItem).filter(x => !!x);

    // priority sort (stable-ish)
    list.sort((a,b) => {
      const pa = (a.priority == null ? 999999 : a.priority);
      const pb = (b.priority == null ? 999999 : b.priority);
      return pa - pb;
    });

    // If no data: show message but PRESERVE existing visuals if present
    if (!list.length){
      showEmpty(t, { preserveIfHasChildren: true });
      return;
    }

    // Data exists: show list and replace with fresh cards
    showData(t);
    bindIncremental(t, list);
  }

  async function load(){
    // Before fetch: do nothing (do NOT wipe). We only render when data is valid.
    try{
      const r = await fetch(FEED_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);

      const payload = await r.json();
      const byId = indexSections(payload);

      // Render all slots with best-effort id mapping
      for (const key of ALL_KEYS){
        const alt = key.replace(/_/g,'-');
        renderSlot(key, byId[key] || byId[alt] || byId[legacyKey(key)] || []);
      }
    }catch(e){
      // On fail: preserve existing layout, show psom message without hiding existing cards
      for (const key of ALL_KEYS){
        const psomEl = qs(`[data-psom-key="${key}"]`);
        if (!psomEl) continue;
        const t = resolveTargets(psomEl, key);
        if (!t) continue;
        showEmpty(t, { preserveIfHasChildren: true });
      }
      // Optional debug
      try{ console.warn('[HOME_AUTOMAP_DOMFIT_SAFE] feed failed:', e); }catch(_){}
    }
  }

  function boot(){ load(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
