/* IGDC NETWORK FEED v1.0 (called ONLY by network-automap.js) */
(function () {
  'use strict';

  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function isObj(x){ return x && typeof x === 'object' && !Array.isArray(x); }

  async function fetchJson(url){
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok) throw new Error(`Snapshot fetch failed: ${res.status} ${res.statusText} (${url})`);
    return await res.json();
  }

  function buildCard(item){
    const title = item.title || item.name || 'Item';
    const href = item.url || item.link || '#';
    const img = item.thumb || item.image || '';

    const rev = isObj(item.revenue) ? item.revenue : {};
    const lr = isObj(item.linkRevenue) ? item.linkRevenue : {};
    const monet = isObj(item.monetization) ? item.monetization : {};

    const dataAttrs = [
      ['data-hub','network'],
      ['data-item-id', item.id || ''],
      ['data-rev-type', rev.type || lr.type || monet.type || ''],
      ['data-rev-partner', rev.partner || lr.partner || monet.partner || ''],
      ['data-rev-commission', (rev.commission ?? lr.commission ?? monet.commission ?? '')],
      ['data-rev-settle', rev.settle || lr.settle || monet.settle || ''],
      ['data-rev-dest', item.revenueDestination || ''],
    ].map(([k,v]) => v!=='' ? `${k}="${esc(v)}"` : '').filter(Boolean).join(' ');

    const safeTitle = esc(title);
    const safeHref = esc(href);

    if(img){
      const safeImg = esc(img);
      return `<a href="${safeHref}" target="_blank" rel="noopener" aria-label="${safeTitle}" ${dataAttrs}><img src="${safeImg}" alt="${safeTitle}" loading="lazy"></a>`;
    }
    return `<a href="${safeHref}" target="_blank" rel="noopener" aria-label="${safeTitle}" ${dataAttrs}><span>${safeTitle}</span></a>`;
  }

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

  function fillMobile(listEl, items, limit){
    if(!listEl) return;
    const n = Math.min(limit, items.length);
    listEl.innerHTML = '';
    for(let i=0;i<n;i++){
      const item = items[i];
      const box = document.createElement('div');
      box.className = 'mcard';
      const href = item.url || item.link || '#';
      const img = item.thumb || item.image || '';
      const title = item.title || item.name || 'Item';

      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('data-hub','network');
      if(item.id) a.setAttribute('data-item-id', String(item.id));
      if(item.revenue && typeof item.revenue === 'object'){
        if(item.revenue.type) a.setAttribute('data-rev-type', String(item.revenue.type));
        if(item.revenue.partner) a.setAttribute('data-rev-partner', String(item.revenue.partner));
        if(item.revenue.commission!=null) a.setAttribute('data-rev-commission', String(item.revenue.commission));
        if(item.revenue.settle) a.setAttribute('data-rev-settle', String(item.revenue.settle));
      }
      if(item.revenueDestination) a.setAttribute('data-rev-dest', String(item.revenueDestination));

      if(img){
        const im = document.createElement('img');
        im.src = img;
        im.alt = title;
        im.loading = 'lazy';
        a.appendChild(im);
      }else{
        a.textContent = title;
      }
      box.appendChild(a);
      listEl.appendChild(box);
    }
  }

  async function fill(params){
    const hubKey = params.hubKey || 'network';
    const snapshotUrl = params.snapshotUrl;
    const slots = Array.isArray(params.slots) ? params.slots : [];
    const mobileListEl = params.mobileListEl || null;
    const mobileLimit = params.mobileLimit || 20;

    if(!snapshotUrl) throw new Error('snapshotUrl is required');

    const data = await fetchJson(snapshotUrl);

    if(!data || !data.meta || data.meta.hub !== hubKey){
      throw new Error(`Hub mismatch. expected=${hubKey}, got=${data?.meta?.hub || '(none)'}`);
    }
    const items = Array.isArray(data.items) ? data.items : [];
    if(!items.length){
      console.warn('[NETWORK FEED] no items in snapshot:', snapshotUrl);
    }

    fillDesktop(slots, items);
    fillMobile(mobileListEl, items, mobileLimit);

    console.log(`[NETWORK FEED] filled hub=${hubKey} items=${items.length} slots=${slots.length}`);
    return { itemsCount: items.length };
  }

  window.IGDC_FEED_NETWORK = { fill };
})();
