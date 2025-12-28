/**
 * home-products-automap.v2.js (MARU Home Automap - MERGE SAFE, DOM matched)
 *
 * - Preserves existing layout containers (no structural changes)
 * - Empty state: multilingual "콘텐츠 준비 중입니다" (12 langs + KO; others -> EN)
 * - Data state: renders real thumbnail cards with images
 * - Incremental rendering:
 *    Main (home_1..home_5):  limit 100, batch 7 (scroll host: .shop-scroller if present)
 *    Right (home_right_*):    limit  80, batch 5 (scroll host: .ad-scroll if present)
 *
 * Fetch: /.netlify/functions/feed?page=homeproducts
 */

(function () {
  'use strict';

  // IMPORTANT: use a unique guard so updated file always runs after deploy
  if (window.__HOME_AUTOMAP_MERGED_V2__) return;
  window.__HOME_AUTOMAP_MERGED_V2__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';

  const KEYS_MAIN  = ['home_1','home_2','home_3','home_4','home_5'];
  const KEYS_RIGHT = ['home_right_top','home_right_middle','home_right_bottom'];
  const ALL_KEYS   = KEYS_MAIN.concat(KEYS_RIGHT);

  const MAIN_LIMIT  = 100;
  const MAIN_BATCH  = 7;
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

  function getLangCode() {
    try {
      const ls = (typeof localStorage !== 'undefined' && localStorage.getItem('igdc_lang')) || '';
      const doc = (document && document.documentElement && (
        document.documentElement.getAttribute('lang') ||
        document.documentElement.getAttribute('data-lang')
      )) || '';
      const nav = (navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) || '';
      const raw = String(ls || doc || nav || 'en').trim().toLowerCase();
      const base = raw.split('-')[0];
      if (base === 'ko') return 'ko';
      if (SUPPORTED_12.has(base)) return base;
      return 'en';
    } catch (e) {
      return 'en';
    }
  }
  function emptyText() {
    const lang = getLangCode();
    return EMPTY_I18N[lang] || EMPTY_I18N.en;
  }

  // ===== DOM helpers =====
  function qs(sel, root){ return (root||document).querySelector(sel); }

  function getScrollHost(container, isRight){
    // Use existing scroll wrapper if present (keeps arrows / panels working)
    if (isRight) return container.closest('.ad-scroll') || container;
    return container.closest('.shop-scroller') || container;
  }

  // ===== data normalization =====
  function pick(o, keys){
    for (const k of keys){
      const v = o && o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function normItem(it){
    it = it || {};
    const thumb = pick(it, [
      'thumb','image','img','photo','thumbnail','cover',
      'imageUrl','image_url','thumbUrl','thumb_url','thumbnailUrl','thumbnail_url',
      'coverUrl','cover_url','src'
    ]);
    const url = pick(it, [
      'checkoutUrl','productUrl','url','href','link','detailUrl','detail_url',
      'path','route'
    ]);
    const title = pick(it, ['title','name','label','caption','text']) || 'Item';
    const priorityRaw = it.priority;
    const priority = (typeof priorityRaw === 'number') ? priorityRaw : null;
    const openNew = (it.openNewTab === true || it.newTab === true || it.target === '_blank');
    return { title, thumb, url, priority, openNew };
  }

  // ===== rendering nodes =====
  function navigate(url, forceNew){
    if (!url || url === '#') return;
    const isExternal = /^https?:\/\//i.test(url);
    const newTab = forceNew || isExternal;
    if (newTab) window.open(url, '_blank', 'noopener');
    else location.href = url;
  }

  function cardNode(item){
    const d = document.createElement('div');
    d.className = 'thumb-card product-card';
    d.dataset.href = item.url;
    d.dataset.productUrl = item.url;

    // minimal inline - should not fight existing CSS much
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
    thumb.style.background = item.thumb
      ? `#ddd center/cover no-repeat url("${String(item.thumb).replace(/"/g,'\\"')}")`
      : '#eee';

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
      navigate(item.url, item.openNew);
    });

    return d;
  }

  function adBoxNode(item){
    const a = document.createElement('a');
    a.className = 'ad-box';
    a.href = item.url || '#';
    a.target = (item.openNew || /^https?:\/\//i.test(item.url||'')) ? '_blank' : '_self';
    a.rel = 'noopener';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.style.height = '160px';
    thumb.style.borderRadius = '8px';
    thumb.style.background = item.thumb
      ? `#ddd center/cover no-repeat url("${String(item.thumb).replace(/"/g,'\\"')}")`
      : '#eee';

    a.appendChild(thumb);
    return a;
  }

  function ensurePlaceholder(container){
    // Preserve any existing placeholder text nodes, but also ensure a consistent block exists.
    // We do NOT clear container here.
    let p = container.querySelector('.maru-empty');
    if (!p){
      p = document.createElement('div');
      p.className = 'maru-empty';
      p.style.padding = '14px';
      p.style.borderRadius = '12px';
      p.style.background = '#f7f7f7';
      p.style.textAlign = 'center';
      p.style.color = '#666';
      p.style.fontSize = '14px';
      p.style.lineHeight = '1.6';
      container.appendChild(p);
    }
    p.textContent = emptyText();
  }

  function clearForData(container){
    container.innerHTML = '';
  }

  function indexSections(payload){
    const map = {};
    if (!payload) return map;

    if (Array.isArray(payload.sections)){
      for (const s of payload.sections){
        const id = String((s && (s.id || s.sectionId) || '')).trim();
        if (!id) continue;
        const items = Array.isArray(s.items) ? s.items : (Array.isArray(s.cards) ? s.cards : []);
        map[id] = items;
      }
    }
    for (const k of ALL_KEYS){
      if (Array.isArray(payload[k])) map[k] = payload[k];
    }
    return map;
  }

  function getLimitBatch(isRight){
    return isRight ? { limit: RIGHT_LIMIT, batch: RIGHT_BATCH } : { limit: MAIN_LIMIT, batch: MAIN_BATCH };
  }

  function isNearEnd(host, isRight){
    if (isRight){
      return (host.scrollTop + host.clientHeight) >= (host.scrollHeight - 20);
    }
    return (host.scrollLeft + host.clientWidth) >= (host.scrollWidth - 20);
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

  function bindIncremental(container, host, isRight, items){
    const state = { offset: 0, items };

    renderChunk(container, isRight, state);

    host.addEventListener('scroll', function(){
      if (state.offset >= state.items.length) return;
      if (!isNearEnd(host, isRight)) return;
      renderChunk(container, isRight, state);
    }, { passive: true });
  }

  function normalizeList(rawItems){
    let list = (rawItems || []).map(normItem).filter(x => x && x.url && x.thumb);

    list.sort((a,b) => {
      const pa = (a.priority == null ? 999999 : a.priority);
      const pb = (b.priority == null ? 999999 : b.priority);
      return pa - pb;
    });

    return list;
  }

  function renderSlot(key, rawItems){
    const container = qs(`[data-psom-key="${key}"]`);
    if (!container) return;

    const isRight = key.indexOf('home_right_') === 0;
    const host = getScrollHost(container, isRight);

    const list = normalizeList(rawItems);

    if (!list.length){
      ensurePlaceholder(container);
      return;
    }

    // Data exists -> yield to real cards
    clearForData(container);

    const { limit } = getLimitBatch(isRight);
    const capped = list.slice(0, limit);

    bindIncremental(container, host, isRight, capped);
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
      // feed failure -> placeholders for all keys (preserve DOM)
      for (const key of ALL_KEYS){
        const c = qs(`[data-psom-key="${key}"]`);
        if (!c) continue;
        ensurePlaceholder(c);
      }
    }
  }

  function boot(){
    load();
    const mo = new MutationObserver(() => {
      clearTimeout(window.__home_automap_t);
      window.__home_automap_t = setTimeout(load, 200);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
