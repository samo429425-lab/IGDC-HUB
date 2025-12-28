
/**
 * home-products-automap.v2.js (HOME automap - RIGHT PANEL FIX)
 *
 * - MAIN (home_1..home_5): renders into the real card row (.shop-row) inside the same .shop-scroller
 * - RIGHT (home_right_*): renders directly into the psom container (.thumb-grid.thumb-scroller)
 *   - If no data: shows multilingual "콘텐츠 준비 중입니다" inside that container (does NOT wipe layout)
 *   - If data: clears container and renders .ad-box cards with photo view
 *
 * Fetch: /.netlify/functions/feed?page=homeproducts
 */

(function () {
  'use strict';
  if (window.__HOME_AUTOMAP_V2_RIGHT2__) return;
  window.__HOME_AUTOMAP_V2_RIGHT2__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';

  const MAIN_KEYS = ['home_1','home_2','home_3','home_4','home_5'];
  const RIGHT_KEYS = ['home_right_top','home_right_middle','home_right_bottom'];

  const MAIN_LIMIT = 100, MAIN_BATCH = 7;
  const RIGHT_LIMIT = 80, RIGHT_BATCH = 5;

  const I18N = {
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
  const SUPPORTED = new Set(['de','en','es','fr','id','ja','ko','pt','ru','th','tr','vi','zh']);

  function lang() {
    try {
      const raw = String(
        (localStorage && localStorage.getItem('igdc_lang')) ||
        (document.documentElement && document.documentElement.getAttribute('lang')) ||
        (navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) ||
        'en'
      ).toLowerCase();
      const base = raw.split('-')[0];
      return SUPPORTED.has(base) ? base : 'en';
    } catch(e) { return 'en'; }
  }
  function emptyText(){ return I18N[lang()] || I18N.en; }

  function pick(o, keys){
    for (const k of keys){
      const v = o && o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }
  function norm(it){
    it = it || {};
    return {
      title: pick(it, ['title','name','label','caption']) || 'Item',
      thumb: pick(it, ['thumb','image','image_url','img','photo','thumbnail','thumbnailUrl','cover','coverUrl']),
      url:   pick(it, ['checkoutUrl','productUrl','url','href','link','path','detailUrl']) || '#',
      priority: (typeof it.priority === 'number' ? it.priority : 999999)
    };
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
    // defensive: allow direct keys
    for (const k of MAIN_KEYS.concat(RIGHT_KEYS)){
      if (Array.isArray(payload[k])) map[k] = payload[k];
    }
    return map;
  }

  function buildMainCard(it){
    const a = document.createElement('a');
    a.className = 'shop-card';
    a.href = it.url || '#';
    if (/^https?:\/\//i.test(it.url)) { a.target = '_blank'; a.rel = 'noopener'; }
    if (it.thumb) a.style.background = `center/cover no-repeat url("${String(it.thumb).replace(/"/g,'\\"')}")`;

    const cap = document.createElement('div');
    cap.className = 'shop-card-cap';
    cap.textContent = it.title || '';
    a.style.display = 'grid';
    a.style.gridTemplateRows = '1fr auto';
    a.appendChild(cap);
    return a;
  }

  function buildRightCard(it){
    const a = document.createElement('a');
    a.className = 'ad-box';
    a.href = it.url || '#';
    if (/^https?:\/\//i.test(it.url)) { a.target = '_blank'; a.rel = 'noopener'; }

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (it.thumb) thumb.style.background = `center/cover no-repeat url("${String(it.thumb).replace(/"/g,'\\"')}")`;
    a.appendChild(thumb);
    return a;
  }

  function renderMain(key, raw){
    const anchor = document.querySelector(`[data-psom-key="${key}"]`);
    if (!anchor) return;

    const scroller = anchor.closest('.shop-scroller');
    const row = scroller && scroller.querySelector('.shop-row');
    if (!row || !scroller) return;

    const list = (raw||[]).map(norm).filter(x => x.thumb).sort((a,b)=>a.priority-b.priority);
    if (!list.length) return; // keep existing layout/placeholder

    row.innerHTML = '';
    let offset = 0;

    function renderMore(){
      const end = Math.min(offset + MAIN_BATCH, list.length, MAIN_LIMIT);
      const frag = document.createDocumentFragment();
      for (let i=offset;i<end;i++) frag.appendChild(buildMainCard(list[i]));
      row.appendChild(frag);
      offset = end;
    }

    renderMore();

    scroller.addEventListener('scroll', function(){
      if (offset >= list.length || offset >= MAIN_LIMIT) return;
      if (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 20) renderMore();
    }, { passive:true });
  }

  function renderRight(key, raw){
    const box = document.querySelector(`[data-psom-key="${key}"]`);
    if (!box) return;

    const list = (raw||[]).map(norm).filter(x => x.thumb).sort((a,b)=>a.priority-b.priority);

    // ensure container is visible and scrollable
    box.style.display = 'grid';
    box.style.gridAutoFlow = 'row';
    box.style.gap = box.style.gap || '10px';
    box.style.overflowY = 'auto';

    if (!list.length){
      // Show placeholder INSIDE the box (do not hide box)
      box.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'maru-empty';
      msg.textContent = emptyText();
      msg.style.padding = '12px';
      msg.style.background = '#f7f7f7';
      msg.style.borderRadius = '12px';
      msg.style.color = '#666';
      msg.style.textAlign = 'center';
      msg.style.lineHeight = '1.6';
      msg.style.fontSize = '14px';
      box.appendChild(msg);
      return;
    }

    // Data exists: render cards into the psom container itself
    box.innerHTML = '';
    let offset = 0;

    function renderMore(){
      const end = Math.min(offset + RIGHT_BATCH, list.length, RIGHT_LIMIT);
      const frag = document.createDocumentFragment();
      for (let i=offset;i<end;i++) frag.appendChild(buildRightCard(list[i]));
      box.appendChild(frag);
      offset = end;
    }

    renderMore();

    box.addEventListener('scroll', function(){
      if (offset >= list.length || offset >= RIGHT_LIMIT) return;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 20) renderMore();
    }, { passive:true });
  }

  async function boot(){
    try{
      const r = await fetch(FEED_URL, { cache:'no-store' });
      if (!r.ok) throw new Error('HTTP '+r.status);
      const payload = await r.json();
      const byId = indexSections(payload);

      for (const k of MAIN_KEYS){
        const alt = k.replace(/_/g,'-');
        const legacy = k.replace('home_','home-shop-');
        renderMain(k, byId[k] || byId[alt] || byId[legacy] || []);
      }
      for (const k of RIGHT_KEYS){
        const alt = k.replace(/_/g,'-');
        const legacy = k.replace('home_right_','home-right-');
        renderRight(k, byId[k] || byId[alt] || byId[legacy] || []);
      }
    }catch(e){
      // on fail: show right placeholders at least
      for (const k of RIGHT_KEYS) renderRight(k, []);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
