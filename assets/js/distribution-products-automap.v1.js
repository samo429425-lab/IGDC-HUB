// === DISTRIBUTION PRODUCTS AUTOMAP v1 (RIGHT-PANEL SINGLE) ===
/**
 * distribution-products-automap.v1.js
 * Purpose:
 *  - Render DistributionHub main 6 sections + RIGHT panel (single) from FEED sections.
 *  - Non-invasive: no CSS/global mutations; only fills [data-psom-key] targets.
 *
 * Data source:
 *  - /.netlify/functions/feed?page=distribution
 *  - Expects payload.sections = [{id, items:[...]} ...]
 *
 * DOM keys (distributionhub.html):
 *  - MAIN:  distribution-recommend / distribution-sponsor / distribution-trending / distribution-new / distribution-special / distribution-others
 *  - RIGHT: distribution   (brand rail)
 *
 * Compatibility:
 *  - Accepts FEED section ids either as above keys OR legacy dist_1..dist_6 + dist_right.
 */
(function () {
  'use strict';
  if (window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V1__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V1__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=distribution';

  const KEYS_MAIN = [
    'distribution-recommend',
    'distribution-sponsor',
    'distribution-trending',
    'distribution-new',
    'distribution-special',
    'distribution-others'
  ];
  const KEY_RIGHT = 'distribution'; // single right panel

  // If feed returns legacy dist_* ids, map them to DOM keys
  const LEGACY_MAP = {
    'distribution-recommend': 'dist_1',
    'distribution-sponsor':   'dist_2',
    'distribution-trending':  'dist_3',
    'distribution-new':       'dist_4',
    'distribution-special':   'dist_5',
    'distribution-others':    'dist_6',
    'distribution':           'dist_right'
  };

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

  function qs(sel, root){ return (root||document).querySelector(sel); }

  function getLangCode(){
    try{
      const raw = String(
        (window.localStorage && localStorage.getItem('igdc_lang')) ||
        (document.documentElement && document.documentElement.getAttribute('lang')) ||
        (navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) ||
        'en'
      ).trim().toLowerCase();
      const base = raw.split('-')[0];
      return EMPTY_I18N[base] ? base : 'en';
    }catch(e){ return 'en'; }
  }
  function emptyText(){ return EMPTY_I18N[getLangCode()] || EMPTY_I18N.en; }

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
      id: it.id || null,
      title: pick(it, ['title','name','label','caption']) || '상품',
      thumb: pick(it, ['thumb','image','image_url','img','photo','thumbnail','thumbnailUrl','cover','coverUrl']),
      url:   pick(it, ['checkoutUrl','productUrl','url','href','link','path','detailUrl']) || '#',
      price: pick(it, ['price','amount','krw','usd','value']) || ''
    };
  }

  function isExternal(url){ return /^https?:\/\//i.test(url); }

  // payload.sections -> { id: items[] }
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

  // Resolve render target for distributionhub.html (thumb scroller)
  function resolveTargets(psomEl, key){
    const wrap = psomEl.closest('.scroller-wrap') || psomEl.parentElement || null;
    const scroller = psomEl; // thumb-grid thumb-scroller thumb-list
    const list = psomEl;     // render directly into same node

    const isRight = (key === KEY_RIGHT);
    return { isRight, wrap, scroller, list, psomEl };
  }

  function showEmpty(t){
    // For distribution we render empty text INSIDE the list (no hide/show flicker)
    t.psomEl.style.display = 'flex';
    t.psomEl.textContent = '';
    t.psomEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.textContent = emptyText();
    msg.style.padding = '12px';
    msg.style.borderRadius = '12px';
    msg.style.background = '#f7f7f7';
    msg.style.color = '#666';
    msg.style.textAlign = 'center';
    msg.style.fontSize = '14px';
    msg.style.lineHeight = '1.6';
    msg.style.minWidth = '240px';
    msg.style.maxWidth = '80vw';
    t.psomEl.appendChild(msg);
  }

  function showData(t){
    // clear any empty message styling
    t.psomEl.style.display = '';
    t.psomEl.textContent = '';
  }

  // Build distribution thumb-card (matches skeleton structure)
  function buildThumbCard(item){
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = item.url || '#';
    if (isExternal(item.url)) { a.target = '_blank'; a.rel = 'noopener'; }

    const imgWrap = document.createElement('div');
    imgWrap.className = 'thumb-img';

    if (item.thumb){
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = item.title || '';
      img.src = item.thumb;
      imgWrap.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'thumb-body';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = item.title || '';

    const meta = document.createElement('div');
    meta.className = 'thumb-meta';

    if (item.price){
      const price = document.createElement('div');
      price.className = 'thumb-price';
      price.textContent = item.price;
      meta.appendChild(price);
    }

    body.appendChild(title);
    body.appendChild(meta);

    a.appendChild(imgWrap);
    a.appendChild(body);
    return a;
  }

  function bindIncremental(t, items){
    const limit = t.isRight ? RIGHT_LIMIT : MAIN_LIMIT;
    const batch = t.isRight ? RIGHT_BATCH : MAIN_BATCH;

    let offset = 0;
    function renderMore(){
      const end = Math.min(offset + batch, limit, items.length);
      const frag = document.createDocumentFragment();
      for (let i = offset; i < end; i++){
        frag.appendChild(buildThumbCard(items[i]));
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
      const nearEnd = (sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 20);
      if (nearEnd) renderMore();
    }, { passive: true });
  }

  function pickItemsForKey(byId, key){
    // Prefer exact match, then legacy feed id, then underscore/hyphen variants
    const legacy = LEGACY_MAP[key];
    const alt1 = key.replace(/_/g, '-');
    const alt2 = key.replace(/-/g, '_');

    return (
      byId[key] ||
      (legacy ? byId[legacy] : null) ||
      byId[alt1] ||
      byId[alt2] ||
      []
    );
  }

  function renderSlot(key, rawItems){
    const psomEl = qs('[data-psom-key="'+ key +'"]');
    if (!psomEl) return;

    const t = resolveTargets(psomEl, key);
    if (!t.list) return;

    const list = (rawItems || []).map(normItem).filter(Boolean);

    if (!list.length){
      showEmpty(t);
      return;
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

      for (const key of KEYS_MAIN){
        renderSlot(key, pickItemsForKey(byId, key));
      }
      renderSlot(KEY_RIGHT, pickItemsForKey(byId, KEY_RIGHT));

    }catch(e){
      for (const key of KEYS_MAIN.concat([KEY_RIGHT])){
        const psomEl = qs('[data-psom-key="'+ key +'"]');
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
