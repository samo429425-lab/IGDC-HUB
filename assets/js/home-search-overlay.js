/**
 * home-search-overlay.js — v1.1 (Merged Upgrade)
 *
 * BASE: original working overlay (open/close preserved 100%)
 * ADD: search scope / quality options + paramized dispatch
 *
 * - UI trigger behavior unchanged
 * - Overlay open/close unchanged
 * - Engine-neutral, future-ready
 */
(function () {
  'use strict';

  if (window.__HOME_SEARCH_CONTROLLER__) return;
  window.__HOME_SEARCH_CONTROLLER__ = true;

  const qs = (s, r = document) => r.querySelector(s);

  /* =========================
     SEARCH ENGINE DEFINITIONS
  ========================= */
  const SEARCH_ENGINES = {
    internal: { endpoint: '/.netlify/functions/maru-search', enabled: true },
    global:   { endpoint: '/.netlify/functions/global-search', enabled: false } // future
  };

  let activeEngine = 'internal';

  /* =========================
     OVERLAY CORE (UNCHANGED)
  ========================= */
  function openOverlay() {
    const ov = qs('#homeSearchOverlay');
    if (!ov) return;
    ov.classList.add('is-open');
    ov.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeOverlay() {
    const ov = qs('#homeSearchOverlay');
    if (!ov) return;
    ov.classList.remove('is-open');
    ov.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  /* =========================
     RENDERING
  ========================= */
  function renderMessage(msg) {
    const box = qs('#homeSearchResult');
    if (!box) return;
    box.innerHTML = `<div class="home-search-message">${msg}</div>`;
  }

  function renderResults(items = []) {
    const box = qs('#homeSearchResult');
    if (!box) return;

    if (!items.length) {
      renderMessage('검색 결과가 없습니다.');
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'home-search-grid';

    items.forEach(item => {
      const card = document.createElement('a');
      card.className = 'home-search-card';
      card.href = item.url || '#';
      card.target = '_blank';
      card.rel = 'noopener';

      const title = document.createElement('div');
      title.className = 'home-search-title';
      title.textContent = item.title || 'Untitled';

      const summary = document.createElement('div');
      summary.className = 'home-search-summary';
      summary.textContent = item.summary || '';

      card.appendChild(title);
      card.appendChild(summary);
      grid.appendChild(card);
    });

    box.innerHTML = '';
    box.appendChild(grid);
  }

  /* =========================
     DISPATCH (UPGRADED)
  ========================= */
  async function dispatchSearch(query) {
    openOverlay(); // 핵심: 기존 동작 유지

    if (!query) {
      renderMessage('검색어를 입력하세요.');
      return;
    }

    const engine = SEARCH_ENGINES[activeEngine];
    if (!engine || !engine.enabled) {
      renderMessage('검색 엔진이 준비되지 않았습니다.');
      return;
    }

    // 확장 파라미터 (범위/품질)
    const params = new URLSearchParams({
      q: query,
      scope: qs('#homeSearchScope')?.value || 'all',
      quality: qs('#homeSearchQuality')?.value || 'standard'
    });

    renderMessage('검색 중입니다...');

    try {
      const res = await fetch(`${engine.endpoint}?${params.toString()}`, {
        cache: 'no-store'
      });
      if (!res.ok) throw new Error();

      const data = await res.json();
      renderResults(data.items || data.results || []);
    } catch (e) {
      renderMessage('검색 중 오류가 발생했습니다.');
    }
  }

  /* =========================
     BINDINGS (UNCHANGED + SAFE ADD)
  ========================= */
  function bind() {
    const input = qs('#homeSearchInput');
    const btn = qs('#homeSearchBtn');
    const closeBtn = qs('#homeSearchClose');
    const ov = qs('#homeSearchOverlay');

    if (!input || !btn || !closeBtn || !ov) return;

    btn.addEventListener('click', () => dispatchSearch(input.value.trim()));

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') dispatchSearch(input.value.trim());
    });

    closeBtn.addEventListener('click', closeOverlay);

    ov.addEventListener('click', e => {
      if (e.target === ov) closeOverlay();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeOverlay();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();