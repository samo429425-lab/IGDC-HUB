/* =========================================================
   IGDC TOUR AUTOMAP – Long Term Stable Version
   - Netlify Function 기반
   - 전역 오염 없음
   - 중복 실행 방지
   - 슬롯 자동 생성 + 안전 채움
   ========================================================= */

(function(){

  if (window.__IGDC_TOUR_AUTOMAP_LOADED__) return;
  window.__IGDC_TOUR_AUTOMAP_LOADED__ = true;

  const FEED_ENDPOINT = '/.netlify/functions/feed-tour';
  const PANEL_SELECTOR = '.ad-panel';
  const SLOT_CLASS = 'ad-box';
  const SLOT_COUNT = 100;   // 필요시 조정 가능

  /* -------------------------
     슬롯 생성 (안전)
  ------------------------- */
  function buildSlots(panel){
    if (!panel) return;

    const existing = panel.querySelectorAll('.' + SLOT_CLASS);
    if (existing.length >= SLOT_COUNT) return;

    panel.innerHTML = '';

    for(let i=0; i<SLOT_COUNT; i++){
      const box = document.createElement('div');
      box.className = SLOT_CLASS;
      panel.appendChild(box);
    }
  }

  /* -------------------------
     Feed 로드
  ------------------------- */
  async function loadFeed(){
    try{
      const res = await fetch(FEED_ENDPOINT);
      if(!res.ok) throw new Error('Feed load failed');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }catch(err){
      console.error('[TOUR FEED ERROR]', err);
      return [];
    }
  }

  /* -------------------------
     카드 채우기
  ------------------------- */
  function fillSlots(panel, items){
    if (!panel) return;

    const slots = panel.querySelectorAll('.' + SLOT_CLASS);
    if (!slots.length) return;

    slots.forEach((slot, index)=>{
      const item = items[index];
      if (!item) return;

      const link = item.link || '#';
      const image = item.image || '';
      const title = item.title || '';

      slot.innerHTML = `
        <a href="${link}">
          ${image ? `<img src="${image}" alt="">` : ''}
          ${title ? `<div class="tour-card-title">${title}</div>` : ''}
        </a>
      `;
    });
  }

  /* -------------------------
     초기화
  ------------------------- */
  async function init(){
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) return;

    buildSlots(panel);
    const items = await loadFeed();
    fillSlots(panel, items);
  }

  /* -------------------------
     DOM Ready
  ------------------------- */
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();