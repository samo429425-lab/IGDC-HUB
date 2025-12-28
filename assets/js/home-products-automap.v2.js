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
    container.style.overflowY = isRight ? 'auto' : 'hidden';
    if (isRight) container.style.minHeight = '60px';
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
    p.textContent = text || '콘텐츠 준비 중입니다.';
    container.appendChild(p);
  }

  function renderSlot(key, items){
    const container = qs(`[data-psom-key="${key}"]`);
    if (!container) return;

    const isRight = key.indexOf('home_right_') === 0;
    // NOTE: Do NOT clear container until we confirm we have real items.
    ensureScrollerStyle(container, isRight);

    const list = (items || []).map(normItem).filter(x => x.url && x.thumb);

    if (!list.length){
      // Keep any existing right-panel message if present; otherwise show placeholder.
      if (!container.querySelector('.maru-empty')) placeholder(container, '콘텐츠 준비 중입니다.');
      return;
    }

    // Now we have real items -> clear and render (HTML yields to real data)
    container.innerHTML = '';
    ensureScrollerStyle(container, isRight);

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
        const legacy = (key.startsWith('home_right_') ? key.replace('home_right_','home-right-') : key.replace('home_','home-shop-'));
        renderSlot(key, byId[key] || byId[alt] || byId[legacy] || []);
      }
    }catch(e){
      // if feed fails, keep placeholders stable
      for (const key of ALL_KEYS){
        const c = qs(`[data-psom-key="${key}"]`);
        if (c && !c.querySelector('.maru-empty')) {
          c.innerHTML = '';
          ensureScrollerStyle(c, key.indexOf('home_right_')===0);
          placeholder(c, '콘텐츠 준비 중입니다.');
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
