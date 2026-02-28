/**
 * socialnetwork-automap.PRODUCTION.js — LONG-TERM OPERATIONS ENGINE
 * -----------------------------------------------------------------
 * Canon:
 *  - Reads ONLY from /.netlify/functions/feed-social?page=social (no cross-page snapshot URLs).
 *  - Renders ONLY into nodes that declare data-psom-key.
 *  - Supports duplicate keys (desktop right rail + mobile rail share "socialnetwork").
 *
 * Guarantees:
 *  - No DOM-order dependency (uses querySelectorAll).
 *  - Incremental rendering (batch) for long lists.
 *  - Empty-state i18n.
 *  - Anti-collision: marks containers as owned; restores if another script wipes them.
 */
(function () {
  'use strict';
  if (window.__SOCIAL_AUTOMAP_PRODUCTION__) return;
  window.__SOCIAL_AUTOMAP_PRODUCTION__ = true;

  const FEED_URL = '/.netlify/functions/feed-social?page=social';

  const MAIN_LIMIT = 100, MAIN_BATCH = 10;
  const RIGHT_LIMIT = 100, RIGHT_BATCH = 8;

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

  const OWN_ATTR = 'data-igdc-owned';
  const OWN_VAL = 'social-automap';

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

  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
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
      url:   pick(it, ['url','href','link','path','detailUrl','productUrl']) || '#',
      priority: (typeof it.priority === 'number' ? it.priority : null),
      meta: pick(it, ['meta','category','type'])
    };
  }
  function isExternal(url){ return /^https?:\/\//i.test(url); }

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

  function isRightKey(key){ return key === 'socialnetwork'; }

  function resolveTargets(psomEl, key){
    const isRight = isRightKey(key);
    let scroller = null;

    if (isRight){
      scroller = psomEl.closest('#rpMobileScroller') ||
                 psomEl.closest('.right-rail') ||
                 psomEl.closest('#rightRail') ||
                 psomEl.closest('.right-panel') ||
                 psomEl.parentElement;
      return { isRight:true, key, list: psomEl, scroller };
    }

    scroller = psomEl.closest('.row-scroller') ||
               psomEl.closest('.row-viewport') ||
               psomEl.parentElement;
    return { isRight:false, key, list: psomEl, scroller };
  }

  function showEmpty(t){
    t.list.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'igdc-empty';
    msg.textContent = emptyText();
    msg.style.padding = '12px';
    msg.style.borderRadius = '12px';
    msg.style.background = '#f7f7f7';
    msg.style.color = '#666';
    msg.style.textAlign = 'center';
    msg.style.fontSize = '14px';
    msg.style.lineHeight = '1.6';
    msg.style.minHeight = '44px';
    t.list.appendChild(msg);
  }

  function buildCard(item){
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = item.url || '#';
    if (isExternal(item.url)) { a.target = '_blank'; a.rel = 'noopener'; }

    const img = document.createElement('div');
    img.className = 'thumb-img';
    if (item.thumb){
      const u = String(item.thumb).replace(/"/g,'\\"');
      img.style.backgroundImage = `url("${u}")`;
      img.style.backgroundPosition = 'center';
      img.style.backgroundSize = 'cover';
      img.style.backgroundRepeat = 'no-repeat';
    }

    const cap = document.createElement('div');
    cap.className = 'thumb-title';
    cap.textContent = item.title || '';

    a.appendChild(img);
    a.appendChild(cap);
    return a;
  }

  function sortByPriority(list){
    return list.slice().sort((a,b) => {
      const pa = (a.priority == null ? 999999 : a.priority);
      const pb = (b.priority == null ? 999999 : b.priority);
      return pa - pb;
    });
  }

  const CACHE = new Map(); // key -> normalized items

  function bindIncremental(t, items){
    const isRight = t.isRight;
    const limit = isRight ? RIGHT_LIMIT : MAIN_LIMIT;
    const batch = isRight ? RIGHT_BATCH : MAIN_BATCH;

    try{ t.list.setAttribute(OWN_ATTR, OWN_VAL); }catch(e){}

    t.list.innerHTML = '';

    const list = sortByPriority(items).slice(0, limit);
    if (!list.length){ showEmpty(t); return; }

    let offset = 0;
    function renderMore(){
      const end = Math.min(offset + batch, list.length);
      const frag = document.createDocumentFragment();
      for (let i = offset; i < end; i++){
        frag.appendChild(buildCard(list[i]));
      }
      t.list.appendChild(frag);
      offset = end;
    }

    renderMore();

    const sc = t.scroller;
    if (!sc) return;

    const onScroll = function(){
      if (offset >= list.length) return;

      const nearEnd = isRight
        ? (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 30)
        : (sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 30);

      if (nearEnd) renderMore();
    };

    sc.addEventListener('scroll', onScroll, { passive: true });
  }

  function attachObserver(t){
    const el = t.list;
    if (!el || el.__igdcObserverAttached) return;
    el.__igdcObserverAttached = true;

    const obs = new MutationObserver(() => {
      try{
        if (el.getAttribute(OWN_ATTR) !== OWN_VAL) return;
        if (el.childElementCount === 0){
          const cached = CACHE.get(t.key) || [];
          bindIncremental(t, cached);
        }
      }catch(e){}
    });

    obs.observe(el, { childList: true });
  }

  function renderKeyToAllTargets(key, rawItems){
    const items = (rawItems || []).map(normItem).filter(Boolean);
    CACHE.set(key, items);

    const nodes = qsa(`[data-psom-key="${key}"]`);
    if (!nodes.length) return;

    nodes.forEach(psomEl => {
      const t = resolveTargets(psomEl, key);
      bindIncremental(t, items);
      attachObserver(t);
    });
  }

  async function load(){
    const r = await fetch(FEED_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }

  async function boot(){
    try{
      const payload = await load();
      const byId = indexSections(payload);

      Object.keys(byId).forEach(key => {
        renderKeyToAllTargets(key, byId[key] || []);
      });

      // DOM keys without data => empty-state (never fill with other-page data)
      qsa('[data-psom-key]').forEach(el => {
        const key = String(el.getAttribute('data-psom-key') || '').trim();
        if (!key) return;
        if (CACHE.has(key)) return;
        const t = resolveTargets(el, key);
        showEmpty(t);
      });

      console.log('[SOCIAL AUTOMAP PRODUCTION] ok');
    }catch(e){
      console.error('[SOCIAL AUTOMAP ERROR]', e);
      qsa('[data-psom-key]').forEach(el => {
        const key = String(el.getAttribute('data-psom-key') || '').trim();
        if (!key) return;
        const t = resolveTargets(el, key);
        showEmpty(t);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
