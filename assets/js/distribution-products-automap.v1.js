/**
 * distribution-products-automap.v3.js
 * CLONED FROM home-products-automap.v2.js
 * Snapshot-first + Feed overwrite (IDENTICAL ENGINE)
 *
 * Differences:
 * - MAIN sections: 6
 * - RIGHT panel: single (distribution)
 * - Keys mapped to Distribution PSOM
 */

(function () {
  'use strict';
  if (window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V3__) return;
  window.__DISTRIBUTION_PRODUCTS_AUTOMAP_V3__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=distribution';
  const SNAPSHOT_URL = '/data/front.snapshot.json';

  const KEYS_MAIN = [
    'distribution-recommend',
    'distribution-sponsor',
    'distribution-trending',
    'distribution-new',
    'distribution-special',
    'distribution-others'
  ];
  const KEYS_RIGHT = ['distribution'];

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

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

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

  function resolveTargets(psomEl, key){
    const isRight = (key === 'distribution');
    if (isRight){
      const section = psomEl.closest('.ad-section') || psomEl.closest('.brand-rail') || null;
      const scroller = section && (section.querySelector('.ad-scroll') || section);
      const list = section && (section.querySelector('.ad-list') || psomEl);
      return { isRight:true, section, scroller, list, psomEl };
    }
    const scroller = psomEl.closest('.shop-scroller');
    const list = scroller && scroller.querySelector('.shop-row');
    return { isRight:false, section:scroller, scroller, list, psomEl };
  }

  function showEmpty(t){
    if (!t || !t.list) return;
    t.list.innerHTML = '<div class="empty">'+emptyText()+'</div>';
  }

  function showData(t){
    if (!t || !t.list) return;
    t.list.innerHTML = '';
  }

  function bindIncremental(t, items){
    const isRight = t.isRight;
    const limit = isRight ? RIGHT_LIMIT : MAIN_LIMIT;
    const batch = isRight ? RIGHT_BATCH : MAIN_BATCH;
    let offset = 0;

    function buildCard(it){
      const a = document.createElement('a');
      a.className = isRight ? 'ad-box news-btn' : 'thumb-card';
      a.href = it.url || '#';
      if (it.thumb){
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = it.thumb;
        img.alt = it.title || '';
        a.appendChild(img);
      }
      if (!isRight){
        const cap = document.createElement('div');
        cap.className = 'thumb-title';
        cap.textContent = it.title || '';
        a.appendChild(cap);
      }
      return a;
    }

    function renderMore(){
      const end = Math.min(offset + batch, limit, items.length);
      const frag = document.createDocumentFragment();
      for (let i = offset; i < end; i++){
        frag.appendChild(buildCard(items[i]));
      }
      t.list.appendChild(frag);
      offset = end;
    }

    renderMore();
    if (!t.scroller) return;
    t.scroller.addEventListener('scroll', function(){
      const nearEnd = isRight
        ? (t.scroller.scrollTop + t.scroller.clientHeight >= t.scroller.scrollHeight - 20)
        : (t.scroller.scrollLeft + t.scroller.clientWidth >= t.scroller.scrollWidth - 20);
      if (nearEnd && offset < items.length) renderMore();
    }, { passive:true });
  }

  async function applySnapshot(){
    try{
      const r = await fetch(SNAPSHOT_URL, { cache:'no-store' });
      if (!r.ok) return;
      const snap = await r.json();
      const sections = snap?.pages?.distribution?.sections || {};
      KEYS_MAIN.forEach(key => {
        const el = qs('[data-psom-key="'+key+'"]');
        if (!el) return;
        const t = resolveTargets(el, key);
        const list = (sections[key]||[]).map(normItem).filter(x=>x.thumb);
        if (!list.length) return;
        showData(t);
        bindIncremental(t, list);
      });
      KEYS_RIGHT.forEach(key => {
        const el = qs('[data-psom-key="'+key+'"]');
        if (!el) return;
        const t = resolveTargets(el, key);
        const list = (sections[key]||[]).map(normItem);
        if (!list.length) return;
        showData(t);
        bindIncremental(t, list);
      });
    }catch(e){}
  }

  async function applyFeed(){
    try{
      const r = await fetch(FEED_URL, { cache:'no-store' });
      if (!r.ok) return;
      const payload = await r.json();
      const byId = {};
      (payload.sections||[]).forEach(s=>{
        if (s && s.id && Array.isArray(s.items)) byId[s.id] = s.items;
      });
      KEYS_MAIN.forEach(key => {
        const el = qs('[data-psom-key="'+key+'"]');
        if (!el) return;
        const t = resolveTargets(el, key);
        const list = (byId[key]||[]).map(normItem).filter(x=>x.thumb);
        if (!list.length) return;
        showData(t);
        bindIncremental(t, list);
      });
      KEYS_RIGHT.forEach(key => {
        const el = qs('[data-psom-key="'+key+'"]');
        if (!el) return;
        const t = resolveTargets(el, key);
        const list = (byId[key]||[]).map(normItem);
        if (!list.length) return;
        showData(t);
        bindIncremental(t, list);
      });
    }catch(e){}
  }

  async function boot(){
    await applySnapshot();
    await applyFeed();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();