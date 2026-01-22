
/**
 * home-search-overlay.js (GLOBAL ADVANCED SEARCH)
 * - Layout unchanged (overlay UI preserved)
 * - Global search like Google/Naver/MS
 * - Policy: Platform assets first, external results blended naturally
 * - Engine: Netlify Function maru-search (helper search engine)
 *
 * Safe:
 * - No global CSS changes
 * - No dependency on other home scripts
 */
(function(){
  'use strict';
  if (window.__HOME_SEARCH_OVERLAY_ADV__) return;
  window.__HOME_SEARCH_OVERLAY_ADV__ = true;

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function esc(s){ return String(s||'').replace(/[<>]/g,''); }

  function getLang(){
    try{
      var raw =
        (window.localStorage && localStorage.getItem('igdc_lang')) ||
        (document.documentElement && document.documentElement.getAttribute('lang')) ||
        (navigator.language || 'en');
      raw = String(raw||'en').toLowerCase();
      return raw.split('-')[0] || 'en';
    }catch(e){ return 'en'; }
  }

  var searchState = {
    scope: 'all',
    mode: 'search',
    limit: 24
  };

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

  function setEmpty(msg){
    var box = qs('#homeSearchResult');
    if (!box) return;
    box.className = 'home-search-empty';
    box.textContent = msg;
  }

  function renderLoading(q){
    setEmpty('검색 중… "' + esc(q) + '"');
  }

  function renderError(msg){
    setEmpty(msg || '검색을 불러오지 못했습니다.');
  }

  function renderItems(items){
    var box = qs('#homeSearchResult');
    if (!box) return;

    if (!Array.isArray(items) || items.length === 0){
      setEmpty('검색 결과가 없습니다.');
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'home-search-grid';

    items.slice(0, searchState.limit).forEach(function(it){
      var a = document.createElement('a');
      a.className = 'home-search-card';
      a.href = it.url || '#';
      if (/^https?:\/\//i.test(it.url||'')) { a.target = '_blank'; a.rel = 'noopener'; }

      var th = document.createElement('div');
      th.className = 'home-search-thumb';
      if (it.thumb){
        th.style.backgroundImage = 'url("' + String(it.thumb).replace(/"/g,'\\"') + '")';
      }

      var body = document.createElement('div');
      body.className = 'home-search-card-body';

      var h = document.createElement('div');
      h.className = 'home-search-card-title';
      h.textContent = it.title || 'Item';

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
    searchState.mode = q ? 'search' : 'recommend';

    openOverlay();

    if (searchState.mode === 'search') renderLoading(q);
    else setEmpty('추천 콘텐츠를 불러오는 중…');

    var lang = getLang();

    var url = '/.netlify/functions/maru-search'
      + (searchState.mode === 'search'
          ? '?q=' + encodeURIComponent(q)
          : '?domain=' + encodeURIComponent(searchState.scope))
      + '&lang=' + encodeURIComponent(lang)
      + '&limit=' + encodeURIComponent(searchState.limit)
      + '&prefer=platform';

    if (searchState.mode === 'search' && searchState.scope !== 'all'){
      url += '&domain=' + encodeURIComponent(searchState.scope);
    }

    try{
      var r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var payload = await r.json();
      var items = payload && (payload.items || payload.results || payload.data) || [];
      renderItems(items);
    }catch(e){
      renderError('검색 실패');
    }
  }

  function bindScope(){
    var scopeWrap = qs('#homeSearchScope');
    if (!scopeWrap) return;

    qsa('[data-scope]', scopeWrap).forEach(function(btn){
      btn.addEventListener('click', function(){
        qsa('[data-scope]', scopeWrap).forEach(function(b){ b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        searchState.scope = btn.getAttribute('data-scope') || 'all';

        var input = qs('#homeSearchInput');
        if (input && input.value.trim()){
          doSearch(input.value);
        }
      });
    });
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

    bindScope();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
