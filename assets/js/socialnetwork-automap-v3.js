// socialnetwork-automap.v3.fixed.js
// 목적:
// 1) social.snapshot.json 실데이터가 있으면 메인 9섹션 + 우측 패널에 꽂는다.
// 2) 실데이터가 없으면 기존 HTML/더미를 절대 지우지 않는다.
// 3) key는 하드코딩 최소화: HTML의 data-psom-key를 그대로 읽는다.
// 4) 우측 패널도 실데이터가 있을 때만 기존 더미를 밀어내고 교체한다.

(function () {
  'use strict';

  if (window.__SOCIALNETWORK_AUTOMAP_V3_FIXED__) return;
  window.__SOCIALNETWORK_AUTOMAP_V3_FIXED__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';
  const MAIN_ROWS = 9;
  const MAIN_LIMIT = 100;
  const RIGHT_LIMIT = 100;
  const RIGHT_SECTION_KEY = 'rightPanel';

  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function safeText(v){ return v == null ? '' : String(v); }

  function pickTitle(it){
    return safeText(it && (it.title || it.name || it.text || it.label));
  }

  function pickUrl(it){
    return safeText(it && (it.url || it.href || it.link || it.productUrl || it.detailUrl)) || '#';
  }

  function pickThumb(it){
    return safeText(it && (it.thumb || it.image || it.thumbnail || it.imageUrl || it.thumbnailUrl));
  }

  function pickDesc(it){
    return safeText(
      it && (
        it.description ||
        it.summary ||
        (it.source && (it.source.platform || it.source.site || it.source.provider)) ||
        ''
      )
    );
  }

function isRealItem(it){
  if (!it || typeof it !== 'object') return false;

  const url = pickUrl(it);
  const title = pickTitle(it);
  const thumb = pickThumb(it);

  // placeholder도 슬롯이면 허용
  if (it.type === 'placeholder') return true;

  // 일반 데이터도 허용
  if (url && url !== '#') return true;
  if (title) return true;
  if (thumb) return true;

  return false;
}

function getSections(snapshot){
  if(!snapshot) return { main:{}, right:{} };

  const social = snapshot.pages?.social || {};

  return {
    main: social.sections || {},

    right: (
      social.sections?.rightPanel
        ? { rightPanel: social.sections.rightPanel }
        : (social.rightPanel
            ? { rightPanel: social.rightPanel }
            : {})
    )
  };
}

  async function loadSnapshot(){
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error('snapshot_load_failed:' + res.status);
    return res.json();
  }

  function getMainSlots(gridEl){
    if(!gridEl) return [];

    let cards = qsa('a.card', gridEl);

    if(cards.length === 0){
      const frag = document.createDocumentFragment();
      for(let i=0;i<MAIN_LIMIT;i++){
        const a = document.createElement('a');
        a.className = 'card';
        a.href = '#';
        a.target = '_self';
        a.rel = 'noopener';
        a.dataset.dummy = '1';
        a.innerHTML =
          '<div class="pic">•</div>' +
          '<div class="meta">' +
            '<div class="title">Loading…</div>' +
            '<div class="desc">Preparing</div>' +
            '<span class="cta">Open</span>' +
          '</div>';
        frag.appendChild(a);
      }
      gridEl.appendChild(frag);
      cards = qsa('a.card', gridEl);
    }

    return cards;
  }

  function paintMainCard(card, it){
    if(!card) return;

    const url = pickUrl(it);
    const title = pickTitle(it) || 'Item';
    const desc = pickDesc(it) || ' ';
    const thumb = pickThumb(it);

    card.href = url || '#';
    card.target = (url && url !== '#') ? '_blank' : '_self';
    card.rel = 'noopener';
    card.removeAttribute('data-dummy');

    const pic = qs('.pic', card);
    const metaTitle = qs('.title', card);
    const metaDesc = qs('.desc', card);

    if(metaTitle) metaTitle.textContent = title;
    if(metaDesc) metaDesc.textContent = desc;

    if(pic){
      if(thumb){
        pic.textContent = '';
        pic.style.backgroundImage = "url('" + thumb.replace(/'/g, "%27") + "')";
        pic.style.backgroundSize = 'cover';
        pic.style.backgroundPosition = 'center';
      }else{
        pic.style.backgroundImage = '';
        pic.textContent = '•';
      }
    }
  }

  function resetMainCardToDummy(card){
    if(!card) return;
    card.href = '#';
    card.target = '_self';
    card.rel = 'noopener';
    card.dataset.dummy = '1';

    const pic = qs('.pic', card);
    const metaTitle = qs('.title', card);
    const metaDesc = qs('.desc', card);

    if(metaTitle) metaTitle.textContent = 'Loading…';
    if(metaDesc) metaDesc.textContent = 'Preparing';

    if(pic){
      pic.style.backgroundImage = '';
      pic.textContent = '•';
    }
  }

 function mountMainRow(gridEl, items){
  if(!gridEl) return;

  const displayItems = (Array.isArray(items) ? items : []).filter(isRealItem).slice(0, MAIN_LIMIT);

  // 표시할 게 없으면 기존 더미 유지
  if(displayItems.length === 0) return;

  const cards = getMainSlots(gridEl);
  const count = Math.max(cards.length, MAIN_LIMIT);

  if(cards.length < count){
    getMainSlots(gridEl);
  }

  const finalCards = qsa('a.card', gridEl);

  for(let i=0;i<finalCards.length;i++){
    const card = finalCards[i];
    const it = displayItems[i] || null;

    if(it) paintMainCard(card, it);
    else resetMainCardToDummy(card);
  }
}

  function getRightCards(panel){
    if(!panel) return [];

    let cards = qsa('.ad-box', panel);

    if(cards.length === 0){
      const frag = document.createDocumentFragment();
      for(let i=0;i<RIGHT_LIMIT;i++){
        const box = document.createElement('div');
        box.className = 'ad-box';
        box.dataset.dummy = '1';
        box.innerHTML = '<a href="#">Loading...</a>';
        frag.appendChild(box);
      }
      panel.appendChild(frag);
      cards = qsa('.ad-box', panel);
    }

    return cards;
  }

  function paintRightCard(box, it){
    if(!box) return;

    const url = pickUrl(it);
    const title = pickTitle(it) || 'Item';

    box.removeAttribute('data-dummy');
    box.innerHTML = '';

    const a = document.createElement('a');
    a.href = url || '#';
    a.target = (url && url !== '#') ? '_blank' : '_self';
    a.rel = 'noopener';
    a.textContent = title;
    box.appendChild(a);
  }

  function resetRightCardToDummy(box){
    if(!box) return;
    box.dataset.dummy = '1';
    box.innerHTML = '<a href="#">Loading...</a>';
  }

function mountRightPanel(panel, items){
  if(!panel) return;

  const displayItems = (Array.isArray(items) ? items : []).filter(isRealItem).slice(0, RIGHT_LIMIT);

  // 표시할 게 없으면 기존 더미 유지
  if(displayItems.length === 0) return;

  const cards = getRightCards(panel);

  for(let i=0;i<cards.length;i++){
    const box = cards[i];
    const it = displayItems[i] || null;

    if(it) paintRightCard(box, it);
    else resetRightCardToDummy(box);
  }
}

 function collectRightItems(sections){
  if(!sections || typeof sections !== 'object') return [];

  const sec = sections.right?.rightPanel;

  if(!sec) return [];

  return Array.isArray(sec)
    ? sec
    : (Array.isArray(sec?.items) ? sec.items : []);
}

  function getMainGridByRow(i){
    const rowGrid = qs('#rowGrid' + i);
    if(!rowGrid) return null;
    return qs('[data-psom-key]', rowGrid);
  }

  async function run(){
	  
    try{
      const snap = await loadSnapshot();
      const sections = getSections(snap);
      if(!sections) return;

const grids = document.querySelectorAll('[data-psom-key]');

grids.forEach(grid => {
  const key = grid.getAttribute('data-psom-key');
  if(!key) return;

  // social-maru는 현재 제외
  if(key === 'social-maru') return;

  const items = sections.main?.[key] || [];
  mountMainRow(grid, items);
});

      const rightPanel = qs('#rightAutoPanel');
      if(rightPanel){
        const rightItems = collectRightItems(sections);
        mountRightPanel(rightPanel, rightItems);

        const shadow = qs('[data-psom-key="' + RIGHT_SECTION_KEY + '"]');
        if(shadow && rightItems.filter(isRealItem).length > 0){
          shadow.innerHTML = rightPanel.innerHTML;
        }
      }

      window.__SOCIALNETWORK_AUTOMAP_V3_DONE__ = true;
    }catch(e){
      console.error('[social-automap-fixed] fail', e);
    }
  }

  function boot(){
    run();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  }else{
    boot();
  }
})();
