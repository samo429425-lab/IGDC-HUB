/**
 * home-products-automap.v2.js (MARU Home Automap - DOM matched)
 * - Targets 8 slots via data-psom-key:
 *   home_1..home_5, home_right_top/middle/bottom
 * - Fetches: /.netlify/functions/feed?page=homeproducts
 * - Renders thumbnail cards INSIDE the existing slot containers (no page layout changes)
 */

(function () {
  'use strict';

  if (window.__HOME_AUTOMAP_V2__) return;
  window.__HOME_AUTOMAP_V2__ = true;

  
  // i18n: placeholder message (12 supported languages; others fallback to English)
  const __PLACEHOLDER_I18N__ = {
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

  const __SUPPORTED_PLACEHOLDER_LANGS__ = new Set(['de','en','es','fr','id','ja','pt','ru','th','tr','vi','zh','ko']);

  function getLangCode(){
    try{
      const ls = (typeof localStorage !== 'undefined' && localStorage.getItem('igdc_lang')) || '';
      const doc = (document && document.documentElement && document.documentElement.getAttribute('lang')) || '';
      const nav = (navigator && (navigator.language || (navigator.languages && navigator.languages[0])) ) || '';
      const raw = String(ls || doc || nav || 'en').trim().toLowerCase();
      const base = raw.split('-')[0]; // e.g., 'pt-br' -> 'pt'
      if (__SUPPORTED_PLACEHOLDER_LANGS__.has(base)) return base;
      return 'en';
    }catch(e){
      return 'en';
    }
  }

  function placeholderText(){
    const lang = getLangCode();
    return __PLACEHOLDER_I18N__[lang] || __PLACEHOLDER_I18N__.en;
  }

const FEED_URL = '/.netlify/functions/feed?page=homeproducts';
  const KEYS_MAIN = ['home_1','home_2','home_3','home_4','home_5'];
  const KEYS_RIGHT = ['home_right_top','home_right_middle','home_right_bottom'];
  const ALL_KEYS = KEYS_MAIN.concat(KEYS_RIGHT);

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }

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
      thumb: pick(it, ['thumb','image','img','photo','thumbnail','cover']) ,
      url: pick(it, ['checkoutUrl','productUrl','url','href','link','detailUrl']) || '#'
    };
  }

  function ensureScrollerStyle(container, isRight){
    // Containers are .thumb-grid.thumb-scroller in home.html; ensure it behaves like a row scroller
    container.style.display = isRight ? 'grid' : 'flex';
    container.style.gap = isRight ? '12px' : '12px';
    container.style.alignItems = 'stretch';
    container.style.padding = '0';
    container.style.margin = '0';
    container.style.listStyle = 'none';
    container.style.overflowX = isRight ? 'hidden' : 'auto';
    container.style.overflowY = 'hidden';
    container.style.scrollSnapType = isRight ? 'none' : 'x mandatory';
  }

  function cardNode(item){
    const d = document.createElement('div');
    d.className = 'thumb-card product-card';
    d.dataset.href = item.url;
    d.dataset.productUrl = item.url;
    d.style.height = '160px';
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
    thumb.style.background = item.thumb ? `#ddd center/cover no-repeat url("${item.thumb.replace(/"/g,'\\"')}")` : '#eee';

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
    thumb.style.background = item.thumb ? `#ddd center/cover no-repeat url("${item.thumb.replace(/"/g,'\\"')}")` : '#eee';

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
    p.textContent = text || placeholderText();
    container.appendChild(p);
  }

  function renderSlot(key, items){
    const container = qs(`[data-psom-key="${key}"]`);
    if (!container) return;

    const isRight = key.indexOf('home_right_') === 0;

    // clean
    container.innerHTML = '';
    ensureScrollerStyle(container, isRight);

    const list = (items || []).map(normItem).filter(x => x.url && x.thumb);

    if (!list.length){
      placeholder(container, placeholderText());
      return;
    }

    for (const it of list){
      container.appendChild(isRight ? adBoxNode(it) : cardNode(it));
    }
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
    // also accept direct keys {home_1:[...]}
    for (const k of ALL_KEYS){
      if (Array.isArray(payload[k])) map[k] = payload[k];
    }
    return map;
  }

  async function load(){
    try{
      const r = await fetch(FEED_URL, { cache: 'no-store' });
      const payload = await r.json();
      const byId = indexSections(payload);

      for (const key of ALL_KEYS){
        // support variants: home-1 vs home_1
        const alt = key.replace(/_/g,'-');
        renderSlot(key, byId[key] || byId[alt] || []);
      }
    }catch(e){
      // if feed fails, keep placeholders stable
      for (const key of ALL_KEYS){
        const c = qs(`[data-psom-key="${key}"]`);
        if (c && !c.querySelector('.maru-empty')) {
          c.innerHTML = '';
          ensureScrollerStyle(c, key.indexOf('home_right_')===0);
          placeholder(c, placeholderText());
        }
      }
    }
  }

  function boot(){
    load();
    // keep in sync if DOM updates later
    const mo = new MutationObserver(() => {
      clearTimeout(window.__home_automap_t);
      window.__home_automap_t = setTimeout(load, 200);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
