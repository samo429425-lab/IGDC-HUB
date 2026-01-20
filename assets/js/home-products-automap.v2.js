/**
 * home-products-automap.v2.js (EXTENDED STABLE)
 * - Sections unified: home_1 ~ home_8
 * - 1~5  : MAIN sections
 * - 6~8  : RIGHT panel (top / middle / bottom)
 * - No change to home.html / feed / snapshot / maru-search
 * - Deterministic routing by section index (NO special-casing)
 */

(function () {
  'use strict';
  if (window.__HOME_AUTOMAP_EXTENDED__) return;
  window.__HOME_AUTOMAP_EXTENDED__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';

  // Unified section keys (EXTENDED)
  const SECTION_KEYS = [
    'home_1','home_2','home_3','home_4','home_5',
    'home_6','home_7','home_8'
  ];

  // Right panel DOM mapping by section index
  const RIGHT_DOM_MAP = {
    6: 'top',
    7: 'middle',
    8: 'bottom'
  };

  const MAIN_BATCH = 7;
  const RIGHT_BATCH = 5;

  const EMPTY_I18N = {
    de:'Inhalte werden vorbereitet.',
    en:'Content is being prepared.',
    es:'El contenido está en preparación.',
    fr:'Contenu en cours de préparation.',
    id:'Konten sedang disiapkan.',
    ja:'コンテンツ準備中です。',
    ko:'콘텐츠 준비 중입니다.',
    pt:'Conteúdo em preparação.',
    ru:'Контент готовится.',
    th:'กำลังเตรียมเนื้อหาอยู่',
    tr:'İçerik hazırlanıyor.',
    vi:'Nội dung đang được chuẩn bị.',
    zh:'内容正在准备中。'
  };

  function getLang(){
    try{
      const raw =
        localStorage.getItem('igdc_lang') ||
        document.documentElement.getAttribute('lang') ||
        navigator.language || 'en';
      return raw.split('-')[0].toLowerCase();
    }catch(e){ return 'en'; }
  }
  function emptyText(){
    const l = getLang();
    return EMPTY_I18N[l] || EMPTY_I18N.en;
  }

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  function normalizeItem(it){
    it = it || {};
    return {
      title: it.title || it.name || it.label || 'Item',
      thumb: it.thumb || it.image || it.image_url || it.thumbnail || '',
      url: it.url || it.link || '#'
    };
  }

  function renderCard(item){
    const a = document.createElement('a');
    a.className = 'shop-card';
    a.href = item.url;
    a.innerHTML = item.thumb
      ? `<img src="${item.thumb}" alt="">`
      : `<span>${item.title}</span>`;
    return a;
  }

  function clear(el){ while(el && el.firstChild) el.removeChild(el.firstChild); }

  function resolveMainTarget(sectionIndex){
    // main: nth shop-row
    const rows = qsa('.shop-row');
    return rows[sectionIndex - 1] || null;
  }

  function resolveRightTarget(sectionIndex){
    const key = RIGHT_DOM_MAP[sectionIndex];
    if (!key) return null;
    const section = qs(`.ad-section[data-section="${key}"]`);
    return section ? qs('.ad-list', section) : null;
  }

  function renderSection(sectionIndex, items){
    const isRight = sectionIndex >= 6;
    const target = isRight
      ? resolveRightTarget(sectionIndex)
      : resolveMainTarget(sectionIndex);

    if (!target) return;

    clear(target);

    if (!items || !items.length){
      const msg = document.createElement('div');
      msg.className = 'psom-empty';
      msg.textContent = emptyText();
      target.appendChild(msg);
      return;
    }

    const batch = isRight ? RIGHT_BATCH : MAIN_BATCH;
    items.slice(0, batch).forEach(it => {
      target.appendChild(renderCard(normalizeItem(it)));
    });
  }

  fetch(FEED_URL)
    .then(r => r.json())
    .then(data => {
      if (!data) return;

      SECTION_KEYS.forEach((key, idx) => {
        const sectionIndex = idx + 1;
        const items = data[key]?.items || [];
        renderSection(sectionIndex, items);
      });
    })
    .catch(err => {
      console.error('[HOME AUTOMAP EXTENDED ERROR]', err);
    });

})();
