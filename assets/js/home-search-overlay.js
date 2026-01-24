/**
 * home-search-overlay.js
 * SEARCH CONTROLLER / GATEWAY (v1)
 *
 * - Internal search first (maru-search)
 * - Global / future search engine ready
 * - Layout & UI unchanged
 * - Engine-neutral design
 */
(function () {
  'use strict';

  if (window.__HOME_SEARCH_CONTROLLER__) return;
  window.__HOME_SEARCH_CONTROLLER__ = true;

  const qs = (s, r = document) => r.querySelector(s);

  const SEARCH_ENGINES = {
    internal: { endpoint: '/.netlify/functions/maru-search', enabled: true },
    global:   { endpoint: '/.netlify/functions/global-search', enabled: false }
  };

  let activeEngine = 'internal';

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

  async function dispatchSearch(query) {
    openOverlay();

    if (!query) {
      renderMessage('검색어를 입력하세요.');
      return;
    }

    const engine = SEARCH_ENGINES[activeEngine];
    if (!engine || !engine.enabled) {
      renderMessage('검색 엔진이 준비되지 않았습니다.');
      return;
    }

    renderMessage('검색 중입니다...');

    try {
      const res = await fetch(
        `${engine.endpoint}?q=${encodeURIComponent(query)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error();

      const data = await res.json();
      renderResults(data.items || data.results || []);
    } catch (e) {
      renderMessage('검색 중 오류가 발생했습니다.');
    }
  }

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