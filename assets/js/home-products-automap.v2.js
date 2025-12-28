/**
 * home-products-automap.v2.js (MARU Home Automap - MERGED)
 * Baseline: user's original v2 (safe placeholders + DOM-matched)
 * Added: batch rendering + per-section limits + multilingual empty message (12 langs; others -> EN)
 *
 * Targets 8 slots via data-psom-key:
 *  home_1..home_5, home_right_top/middle/bottom
 * Fetches: /.netlify/functions/feed?page=homeproducts
 */

(function () {
  'use strict';

  if (window.__HOME_AUTOMAP_V2__) return;
  window.__HOME_AUTOMAP_V2__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';

  const KEYS_MAIN  = ['home_1','home_2','home_3','home_4','home_5'];
  const KEYS_RIGHT = ['home_right_top','home_right_middle','home_right_bottom'];
  const ALL_KEYS   = KEYS_MAIN.concat(KEYS_RIGHT);

  // Limits / batch
  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 7;

  const RIGHT_LIMIT = 80;
  const RIGHT_BATCH = 5;

  // ===== i18n empty message =====
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
      const ls = (typeof localStorage !== 'undefined' && localStorage.getItem('igdc_lang')) || '';
      const doc = (document && document.documentElement && document.documentElement.getAttribute('lang')) || '';
      const nav = (navigator && (navigator.language || (navigator.languages && navigator.languages[0])) ) || '';
      const raw = String(ls || doc || nav || 'en').trim().toLowerCase();
      const base = raw.split('-')[0];
      // 12 langs required; others -> EN
      if (SUPPORTED_12.has(base)) return base;
      if (base === 'ko') return 'ko'; // allow KO as well (site default)
      return 'en';
    }catch(e){
      return 'en';
    }
  }
  function emptyText(){
    const lang = getLangCode();
    return EMPTY_I18N[lang] || EMPTY_I18N.en;
  }

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
      id: String(it.id || it.uid || it.key || '').trim(),
      title: pick(it, ['title','name','label','caption']) || 'Item',
      thumb: pick(it, ['thumb','image','img','photo','thumbnail','cover']),
      url: pick(it, ['checkoutUrl','productUrl','url','href','link','detailUrl']) || '#',
      priority: (typeof it.priority === 'number' ? it.priority : null)
    };
  }

  function ensureScrollerStyle(container, isRight){
    // Match home.html containers (.thumb-grid.thumb-scroller)
    container.style.display = isRight ? 'grid' : 'flex';
    container.style.gap = '12px';
    container.style.alignItems = 'stretch';
    container.style.padding = '0';
    container.style.margin = '0';
    container.style.listStyle = 'none';

    if (isRight){
      container.style.gridTemplateColumns = '1fr';
      container.style.overflowX = 'hidden';
      container.style.overflowY = 'auto';        // IMPORTANT: enable vertical scroll for incremental loading
      container.style.scrollSnapType = 'none';
      if (!container.style.maxHeight) container.style.maxHeight = '520px';
      container.style.webkitOverflowScrolling = 'touch';
    } else {
      container.style.overflowX = 'auto';
      container.style.overflowY = 'hidden';
      container.style.scrollSnapType = 'x mandatory';
      container.style.webkitOverflowScrolling = 'touch';
    }
  }

  function navigate(url){
    if (!url || url === '#') return;
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    else location.href = url;
  }

  function cardNode(item){
    const d = document.createElement('div');
    d.className = 'thumb-card product-card';
    d.dataset.href = item.url;
    d.dataset.productUrl = item.url;

    d.style.height = '160px';
    d.style.minWidth = '180px';
    d.style.flex = '0 0 180px';
    d.style.border = '1px solid #dadada';
    d.style.borderRadius = '6px';
    d.style.background = '#fff';
    d.style.overflow = 'hidden';
    d.style.cursor = 'pointer';
    d.style.scrollSnapAlign = 'start';
    d.style.display = 'grid';
    d.style.gridTemplateRows = '1fr auto';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.style.height = '120px';
    thumb.style.background = item.thumb ? `#ddd center/cover no-repeat url("${String(item.thumb).replace(/"/g,'\\"')}")` : '#eee';

    const meta = document.createElement('div');
    meta.style.padding = '8px 10px';
    meta.style.fontSize = '0.92rem';
    meta.style.lineHeight = '1.2';
    meta.style.fontWeight = '700';
    meta.style.color = '#222';
    meta.style.whiteSpace = 'nowrap';
    meta.style.overflow = 'hidden';
    meta.style.textOverflow = 'ellipsis';
    meta.textContent = item.title || 'Item';

    d.appendChild(thumb);
    d.appendChild(meta);

    d.addEventListener('click', function(){
      navigate(item.url);
    });

    return d;
  }

  function adBoxNode(item){
    const a = document.createElement('a');
    a.className = 'ad-box';
    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.style.height = '160px';
    thumb.style.borderRadius = '8px';
    thumb.style.background = item.thumb ? `#ddd center/cover no-repeat url("${String(item.thumb).replace(/"/g,'\\"')}")` : '#eee';

    a.appendChild(thumb);
    return a;
  }

  function placeholder(container, text){
    const p = document.createElement('div');
    p.className = 'maru-empty';
    p.style.padding = '14px';
    p.style.borderRadius = '12px';
    p.style.background = '#f7f7f7';
    p.style.textAlign = 'center';
    p.style.color = '#666';
    p.style.fontSize = '14px';
    p.style.lineHeight = '1.6';
    p.textContent = text || emptyText();
    container.appendChild(p);
  }

  function indexSections(payload){
    const map = {};
    if (!payload) return map;

    // Preferred: { sections: [ {id, items} ] }
    if (Array.isArray(payload.sections)){
      for (const s of payload.sections){
        const id = String((s && (s.id || s.sectionId) || '')).trim();
        if (!id) continue;
        map[id] = Array.isArray(s.items) ? s.items : (Array.isArray(s.cards) ? s.cards : []);
      }
    }
    // Also accept direct keys { home_1:[...] }
    for (const k of ALL_KEYS){
      if (Array.isArray(payload[k])) map[k] = payload[k];
    }
    return map;
  }

  function getLimitBatch(isRight){
    return isRight ? { limit: RIGHT_LIMIT, batch: RIGHT_BATCH } : { limit: MAIN_LIMIT, batch: MAIN_BATCH };
  }

  function isNearEnd(container, isRight){
    if (isRight){
      return (container.scrollTop + container.clientHeight) >= (container.scrollHeight - 20);
    }
    return (container.scrollLeft + container.clientWidth) >= (container.scrollWidth - 20);
  }

  function renderChunk(container, isRight, state){
    const { limit, batch } = getLimitBatch(isRight);
    const items = state.items;

    const end = Math.min(state.offset + batch, limit, items.length);
    const frag = document.createDocumentFragment();

    for (let i = state.offset; i < end; i++){
      const it = items[i];
      frag.appendChild(isRight ? adBoxNode(it) : cardNode(it));
    }

    container.appendChild(frag);
    state.offset = end;
  }

  function bindIncremental(container, isRight, items){
    const state = { offset: 0, items: items };

    // first paint
    renderChunk(container, isRight, state);

    // scroll-to-load
    container.addEventListener('scroll', function(){
      if (state.offset >= state.items.length) return;
      if (!isNearEnd(container, isRight)) return;
      renderChunk(container, isRight, state);
    }, { passive: true });
  }

  function renderSlot(key, rawItems){
    const container = qs(`[data-psom-key="${key}"]`);
    if (!container) return;

    const isRight = key.indexOf('home_right_') === 0;

    // clean, but keep behavior consistent with original v2
    container.innerHTML = '';
    ensureScrollerStyle(container, isRight);

    // normalize + filter (require url+thumb to avoid "weird blocks")
    let list = (rawItems || [])
      .map(normItem)
      .filter(x => x && x.url && x.thumb);

    // optional priority sort (keeps stable if no priority)
    list.sort((a,b) => {
      const pa = (a.priority == null ? 999999 : a.priority);
      const pb = (b.priority == null ? 999999 : b.priority);
      return pa - pb;
    });

    if (!list.length){
      placeholder(container, emptyText());
      return;
    }

    // cap by limit, then incremental render by batch
    const { limit } = getLimitBatch(isRight);
    list = list.slice(0, limit);

    bindIncremental(container, isRight, list);
  }

  async function load(){
    try{
      const r = await fetch(FEED_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const payload = await r.json();
      const byId = indexSections(payload);

      for (const key of ALL_KEYS){
        const alt = key.replace(/_/g,'-');
        renderSlot(key, byId[key] || byId[alt] || []);
      }
    }catch(e){
      // feed fail -> placeholders for all keys
      for (const key of ALL_KEYS){
        const c = qs(`[data-psom-key="${key}"]`);
        if (!c) continue;
        c.innerHTML = '';
        ensureScrollerStyle(c, key.indexOf('home_right_')===0);
        placeholder(c, emptyText());
      }
    }
  }

  function boot(){
    load();

    // keep in sync if DOM updates later (same as original v2)
    const mo = new MutationObserver(() => {
      clearTimeout(window.__home_automap_t);
      window.__home_automap_t = setTimeout(load, 200);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
