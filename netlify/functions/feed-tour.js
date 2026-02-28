/* IGDC TOUR FEED – PRODUCTION STABLE VERSION */

(function () {
  'use strict';

  /* ===============================
     기본 유틸
  =============================== */

  function esc(s){
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[m]));
  }

  function isObj(x){
    return x && typeof x === 'object' && !Array.isArray(x);
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok){
      throw new Error(`Snapshot fetch failed: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  /* ===============================
     카드 생성 (항상 이미지 + 제목 구조)
  =============================== */

  function buildCard(item){

    const title = item.title || item.name || 'Item';
    const href  = item.url || item.link || '#';
    const img   = item.thumb || item.image || '';

    const rev = isObj(item.revenue) ? item.revenue : {};
    const lr  = isObj(item.linkRevenue) ? item.linkRevenue : {};
    const monet = isObj(item.monetization) ? item.monetization : {};

    const dataAttrs = [
      ['data-hub','tour'],
      ['data-item-id', item.id || ''],
      ['data-rev-type', rev.type || lr.type || monet.type || ''],
      ['data-rev-partner', rev.partner || lr.partner || monet.partner || ''],
      ['data-rev-commission', (rev.commission ?? lr.commission ?? monet.commission ?? '')],
      ['data-rev-settle', rev.settle || lr.settle || monet.settle || ''],
      ['data-rev-dest', item.revenueDestination || ''],
    ]
    .map(([k,v]) => v!=='' ? `${k}="${esc(v)}"` : '')
    .filter(Boolean)
    .join(' ');

    const safeTitle = esc(title);
    const safeHref  = esc(href);
    const safeImg   = img ? esc(img) : '';

    return `
      <a href="${safeHref}" target="_blank" rel="noopener" ${dataAttrs}>
        ${safeImg ? `<img src="${safeImg}" alt="${safeTitle}" loading="lazy">` : ''}
        <div class="tour-card-title">${safeTitle}</div>
      </a>
    `;
  }

  /* ===============================
     데스크탑 채움
  =============================== */

  function fillDesktop(slots, items){

    const n = Math.min(slots.length, items.length);

    for(let i=0;i<n;i++){
      slots[i].innerHTML = buildCard(items[i]);
      slots[i].setAttribute('data-filled','1');
    }

    for(let i=n;i<slots.length;i++){
      slots[i].innerHTML = '';
      slots[i].removeAttribute('data-filled');
    }
  }

  /* ===============================
     모바일 채움
  =============================== */

  function fillMobile(listEl, items, limit){

    if(!listEl) return;

    const n = Math.min(limit, items.length);
    listEl.innerHTML = '';

    for(let i=0;i<n;i++){

      const item = items[i];
      const title = item.title || item.name || 'Item';
      const href  = item.url || item.link || '#';
      const img   = item.thumb || item.image || '';

      const box = document.createElement('div');
      box.className = 'mcard';

      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('data-hub','tour');

      if(item.id){
        a.setAttribute('data-item-id', String(item.id));
      }

      if(img){
        const im = document.createElement('img');
        im.src = img;
        im.alt = title;
        im.loading = 'lazy';
        a.appendChild(im);
      }

      const titleDiv = document.createElement('div');
      titleDiv.className = 'tour-card-title';
      titleDiv.textContent = title;

      a.appendChild(titleDiv);
      box.appendChild(a);
      listEl.appendChild(box);
    }
  }

  /* ===============================
     메인 진입
  =============================== */

  async function fill(params){

    const hubKey = params.hubKey || 'tour';
    const snapshotUrl = params.snapshotUrl;
    const slots = Array.isArray(params.slots) ? params.slots : [];
    const mobileListEl = params.mobileListEl || null;
    const mobileLimit = params.mobileLimit || 20;

    if(!snapshotUrl){
      throw new Error('snapshotUrl is required');
    }

    const data = await fetchJson(snapshotUrl);

    if(!data || !data.meta || data.meta.hub !== hubKey){
      throw new Error(`Hub mismatch. expected=${hubKey}, got=${data?.meta?.hub || '(none)'}`);
    }

    const items = Array.isArray(data.items) ? data.items : [];

    fillDesktop(slots, items);
    fillMobile(mobileListEl, items, mobileLimit);

    console.log(`[TOUR FEED] hub=${hubKey} items=${items.length}`);
    return { itemsCount: items.length };
  }

  window.IGDC_FEED_TOUR = { fill };

})();