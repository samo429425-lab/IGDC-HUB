/**
 * home-search-overlay.js
 * - Adds "hero search bar" behavior (homeSearchInput + homeSearchBtn).
 * - Opens a medium-size page-like overlay (not full screen).
 * - Calls Netlify function maru-search in SEARCH mode: /.netlify/functions/maru-search?q=...&lang=...
 * - Renders results as cards.
 *
 * Safe:
 * - No global CSS/zoom/transform changes
 * - No interference with existing home scripts
 */
(function(){
  'use strict';
  if (window.__HOME_SEARCH_OVERLAY__) return;
  window.__HOME_SEARCH_OVERLAY__ = true;

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function esc(s){ return String(s||'').replace(/[<>]/g,''); }
  function getLang(){
    try{
      var raw = (localStorage && localStorage.getItem('igdc_lang')) ||
                (document.documentElement && document.documentElement.getAttribute('lang')) ||
                (navigator.language || 'en');
      raw = String(raw||'en').toLowerCase();
      return raw.split('-')[0] || 'en';
    }catch(e){ return 'en'; }
  }
  function openOverlay(){
    var ov = qs('#homeSearchOverlay');
    if (!ov) return;
    ov.classList.add('is-open');
    ov.setAttribute('aria-hidden','false');
    try{ document.body.style.overflow = 'hidden'; }catch(e){}
  }
  function closeOverlay(){
    var ov = qs('#homeSearchOverlay');
    if (!ov) return;
    ov.classList.remove('is-open');
    ov.setAttribute('aria-hidden','true');
    try{ document.body.style.overflow = ''; }catch(e){}
  }

  function renderLoading(q){
    var box = qs('#homeSearchResult');
    if (!box) return;
    box.className = 'home-search-empty';
    box.textContent = '검색 중... "' + q + '"';
  }

  function renderEmpty(q){
    var box = qs('#homeSearchResult');
    if (!box) return;
    box.className = 'home-search-empty';
    box.textContent = '검색 결과가 없습니다: "' + q + '"';
  }

  function renderError(msg){
    var box = qs('#homeSearchResult');
    if (!box) return;
    box.className = 'home-search-empty';
    box.textContent = msg || '검색을 불러오지 못했습니다.';
  }

  function renderItems(items){
    var box = qs('#homeSearchResult');
    if (!box) return;

    if (!Array.isArray(items) || items.length === 0){
      box.className = 'home-search-empty';
      box.textContent = '검색 결과가 없습니다.';
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'home-search-grid';

    items.slice(0, 24).forEach(function(it){
      var a = document.createElement('a');
      a.className = 'home-search-card';
      a.href = it.url || '#';
      if (/^https?:\/\//i.test(it.url||'')) { a.target = '_blank'; a.rel = 'noopener'; }

      var th = document.createElement('div');
      th.className = 'home-search-thumb';
      if (it.thumb) th.style.backgroundImage = 'url("' + String(it.thumb).replace(/"/g,'\\"') + '")';

      var body = document.createElement('div');
      body.className = 'home-search-card-body';

      var h = document.createElement('div');
      h.className = 'home-search-card-title';
      h.textContent = (it.title || 'Item');

      var p = document.createElement('p');
      p.className = 'home-search-card-summary';
      p.textContent = (it.summary || '').slice(0, 140);

      body.appendChild(h);
      body.appendChild(p);

      a.appendChild(th);
      a.appendChild(body);
      wrap.appendChild(a);
    });

    box.replaceWith(wrap);
    wrap.id = 'homeSearchResult';
  }

  async function doSearch(q){
    q = String(q||'').trim();
    if (!q) return;

    openOverlay();
    renderLoading(q);

    var lang = getLang();
    var url = '/.netlify/functions/maru-search?q=' + encodeURIComponent(q) + '&lang=' + encodeURIComponent(lang) + '&limit=24';

    try{
      var r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var payload = await r.json();
      var items = payload && (payload.items || payload.results || payload.data) || [];
      if (!Array.isArray(items) || items.length === 0){
        renderEmpty(q);
        return;
      }
      renderItems(items);
    }catch(e){
      renderError('검색 실패: ' + (e && e.message ? e.message : 'unknown'));
    }
  }

  function bind(){
    var input = qs('#homeSearchInput');
    var btn = qs('#homeSearchBtn');
    var closeBtn = qs('#homeSearchClose');
    var ov = qs('#homeSearchOverlay');
    if (!input || !btn || !closeBtn || !ov) return;

    btn.addEventListener('click', function(){ doSearch(input.value); });
    input.addEventListener('keydown', function(e){
      if (e.key === 'Enter'){ e.preventDefault(); doSearch(input.value); }
    });
    closeBtn.addEventListener('click', closeOverlay);
    ov.addEventListener('click', function(e){
      if (e.target === ov) closeOverlay();
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') closeOverlay();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
