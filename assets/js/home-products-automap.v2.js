
/**
 * home-products-automap.v3.js
 * - Batch rendering for HOME
 * - Main sections: max 100, batch 7
 * - Right sections: max 80, batch 5
 * - Scroll-to-load
 */

(function () {
  if (window.__HOME_AUTOMAP_V3__) return;
  window.__HOME_AUTOMAP_V3__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';

  const MAIN_KEYS = ['home_1','home_2','home_3','home_4','home_5'];
  const RIGHT_KEYS = ['home_right_top','home_right_middle','home_right_bottom'];

  const MAIN_LIMIT = 100;
  const MAIN_BATCH = 7;

  const RIGHT_LIMIT = 80;
  const RIGHT_BATCH = 5;

  function qs(sel, root){ return (root||document).querySelector(sel); }

  function getLang(){
    const v = (localStorage.getItem('igdc_lang') || document.documentElement.lang || 'en').toLowerCase();
    return v.split('-')[0];
  }

  const MSG = {
    en: 'Content is being prepared.',
    ko: '콘텐츠 준비 중입니다.',
    ja: 'コンテンツ準備中です。',
    zh: '内容正在准备中。',
    fr: 'Contenu en cours de préparation.',
    de: 'Inhalte werden vorbereitet.',
    es: 'El contenido está en preparación.',
    pt: 'Conteúdo em preparação.',
    ru: 'Контент готовится.',
    th: 'กำลังเตรียมเนื้อหาอยู่',
    tr: 'İçerik hazırlanıyor.',
    vi: 'Nội dung đang được chuẩn bị.'
  };

  function emptyMsg(){
    return MSG[getLang()] || MSG.en;
  }

  function normalize(item){
    return {
      title: item.title || item.name || '',
      url: item.url || item.href || '#',
      thumb: item.thumb || item.image || item.img || item.cover || ''
    };
  }

  function card(item){
    const d = document.createElement('div');
    d.className = 'thumb-card';
    d.style.flex = '0 0 180px';
    d.style.height = '160px';
    d.style.border = '1px solid #ddd';
    d.style.borderRadius = '6px';
    d.style.overflow = 'hidden';
    d.style.cursor = 'pointer';
    d.style.display = 'grid';
    d.style.gridTemplateRows = '1fr auto';

    const img = document.createElement('div');
    img.style.background = item.thumb
      ? `center/cover no-repeat url("${item.thumb}")`
      : '#eee';
    img.style.height = '120px';

    const t = document.createElement('div');
    t.textContent = item.title || '';
    t.style.fontSize = '13px';
    t.style.fontWeight = '600';
    t.style.padding = '6px 8px';
    t.style.whiteSpace = 'nowrap';
    t.style.overflow = 'hidden';
    t.style.textOverflow = 'ellipsis';

    d.onclick = () => {
      if (!item.url) return;
      if (/^https?:\/\//i.test(item.url)) {
        window.open(item.url, '_blank');
      } else {
        location.href = item.url;
      }
    };

    d.appendChild(img);
    d.appendChild(t);
    return d;
  }

  function renderBatch(container, items, state, batchSize, limit) {
    const end = Math.min(state.offset + batchSize, limit, items.length);
    for (let i = state.offset; i < end; i++) {
      const it = normalize(items[i]);
      if (!it.thumb || !it.url) continue;
      container.appendChild(card(it));
    }
    state.offset = end;
  }

  function attachScroll(container, items, batch, limit) {
    const state = { offset: 0 };

    renderBatch(container, items, state, batch, limit);

    container.addEventListener('scroll', () => {
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 20) {
        renderBatch(container, items, state, batch, limit);
      }
    });
  }

  function prepareContainer(container, isRight){
    container.innerHTML = '';
    container.style.overflowY = 'auto';
    container.style.overflowX = 'hidden';
    container.style.display = 'flex';
    container.style.flexWrap = 'nowrap';
    container.style.gap = '12px';

    if (isRight) {
      container.style.flexDirection = 'column';
      container.style.maxHeight = '520px';
    } else {
      container.style.flexDirection = 'row';
    }
  }

  async function boot(){
    let data;
    try {
      const r = await fetch(FEED_URL, { cache: 'no-store' });
      data = await r.json();
    } catch(e){
      return;
    }

    const sections = data.sections || [];

    for (const sec of sections) {
      const id = sec.id;
      const el = qs(`[data-psom-key="${id}"]`);
      if (!el) continue;

      const items = Array.isArray(sec.items) ? sec.items : [];
      if (!items.length) {
        el.textContent = emptyMsg();
        continue;
      }

      const isRight = RIGHT_KEYS.includes(id);
      prepareContainer(el, isRight);

      attachScroll(
        el,
        items,
        isRight ? RIGHT_BATCH : MAIN_BATCH,
        isRight ? RIGHT_LIMIT : MAIN_LIMIT
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
