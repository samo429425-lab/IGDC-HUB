/*
  IGDC Social Network AutoMap (v3.PROD2)
  - Reads /data/social.snapshot.json (placeholder_cards)
  - Renders 9 main sections into existing .thumb-grid[data-psom-key]
  - Renders RIGHT panel into #rightAutoPanel using .card markup (so CSS + mobile rail work)
  - On resize, re-renders AFTER the page's dummy right-panel bootstrap runs
*/

(function(){
  'use strict';

  const SNAPSHOT_URL = '/data/social.snapshot.json';
  const MAX_RIGHT = 100; // requested target

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function esc(s){
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
    }[c]));
  }

  function safeUrl(u){
    const s = String(u ?? '').trim();
    if(!s) return '#';
    // allow http(s), mailto, tel, and relative
    if(/^https?:\/\//i.test(s) || /^mailto:/i.test(s) || /^tel:/i.test(s) || s.startsWith('/') || s.startsWith('./') || s.startsWith('#')) return s;
    return '#';
  }

  function normalizeCard(raw){
    const o = raw && typeof raw === 'object' ? raw : {};
    const title = o.title ?? o.name ?? o.label ?? 'Loading...';
    const subtitle = o.subtitle ?? o.desc ?? o.description ?? '';
    const href = o.href ?? o.url ?? o.link ?? '#';
    const ctaText = o.ctaText ?? o.cta ?? 'Open';
    const thumb = o.thumb ?? o.image ?? o.img ?? '';
    return { title:String(title), subtitle:String(subtitle), href:String(href), ctaText:String(ctaText), thumb:String(thumb) };
  }

  function cardHTML(card, {forceFullWidth=false, fixedWidthPx=null}={}){
    const c = normalizeCard(card);
    const href = safeUrl(c.href);
    const target = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';

    // Use same card structure the page already styles (.card > .pic + .meta)
    const styles = [];
    if(forceFullWidth) styles.push('width:100%');
    if(typeof fixedWidthPx === 'number' && fixedWidthPx > 0) styles.push(`width:${fixedWidthPx}px`);
    const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';

    const img = c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy" decoding="async">` : '';

    return `
      <a class="card" data-card="1" href="${esc(href)}"${target}${styleAttr}>
        <div class="pic">${img}</div>
        <div class="meta">
          <div class="title">${esc(c.title)}</div>
          <div class="desc">${esc(c.subtitle)}</div>
          <div class="cta">${esc(c.ctaText || 'Open')}</div>
        </div>
      </a>
    `.trim();
  }

  function getSnapshotCards(snapshot){
    // Accept either new or legacy shapes.
    if(snapshot && snapshot.placeholder_cards && typeof snapshot.placeholder_cards === 'object') return snapshot.placeholder_cards;
    if(snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.placeholder_cards) return snapshot.pages.social.placeholder_cards;
    if(snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections) return snapshot.pages.social.sections; // legacy
    return {};
  }

  function renderSectionGrid(gridEl, cards){
    if(!gridEl) return;
    const list = Array.isArray(cards) ? cards : [];
    gridEl.innerHTML = list.map(c => cardHTML(c)).join('');
  }

  function isPortraitMobile(){
    return window.matchMedia('(max-width: 520px)').matches;
  }

  function isLandscapeSmall(){
    return window.matchMedia('(max-width: 1024px)').matches && window.matchMedia('(orientation: landscape)').matches;
  }

  function renderRightPanel(panelEl, cardsByKey){
    if(!panelEl) return;

    // Key declared in HTML for right rail.
    const src = Array.isArray(cardsByKey.socialnetwork) ? cardsByKey.socialnetwork : [];

    const out = [];
    for(let i=0;i<MAX_RIGHT;i++){
      out.push(src[i] ?? { title:'Loading...', subtitle:'', href:'#', ctaText:'', thumb:'' });
    }

    const portrait = isPortraitMobile();
    const landscape = isLandscapeSmall();

    // The HTML has styles for .rp-hscroll on mobile-landscape.
    panelEl.classList.toggle('rp-hscroll', landscape && !portrait);

    // In landscape strip, fixed width makes scrolling natural.
    const fixed = (landscape && !portrait) ? 220 : null;
    panelEl.innerHTML = out.map(c => cardHTML(c, {forceFullWidth: portrait, fixedWidthPx: fixed})).join('');
  }

  function renderAll(cardsByKey){
    // Main 9 section grids (ignore the right-rail thumb-grid; we use #rightAutoPanel instead)
    $$('.thumb-grid[data-psom-key]').forEach(grid => {
      const key = String(grid.getAttribute('data-psom-key') || '').trim();
      if(!key) return;
      if(key === 'socialnetwork') return;
      renderSectionGrid(grid, cardsByKey[key]);
    });

    renderRightPanel($('#rightAutoPanel'), cardsByKey);
  }

  async function loadSnapshot(){
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
    return await res.json();
  }

  function installRightPanelRenderer(cardsByKey){
    // Replace dummy renderer (defined inside socialnetwork.html) with a stable one.
    window.__IGDC_RIGHTPANEL_RENDER = function(){
      renderRightPanel($('#rightAutoPanel'), cardsByKey);
    };
  }

  function debounce(fn, ms=140){
    let t = null;
    return function(){
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  async function boot(){
    try{
      const snapshot = await loadSnapshot();
      const cardsByKey = getSnapshotCards(snapshot);

      renderAll(cardsByKey);
      installRightPanelRenderer(cardsByKey);

      // Re-render on resize AFTER the dummy bootstrap rebuilds its placeholders.
      window.addEventListener('resize', debounce(() => renderAll(cardsByKey), 160));

    } catch (err){
      console.error('[socialnetwork-automap] boot failed:', err);
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
