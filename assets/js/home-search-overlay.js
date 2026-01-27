/**
 * home-search-overlay.js — v2.0 (DIRECT SEARCH PAGE)
 *
 * Goal (per user decision):
 * - NO popup/overlay results
 * - On search submit: navigate directly to /search.html?q=...
 *
 * Notes:
 * - Keeps existing input/button IDs if present
 * - Does not require overlay DOM to exist
 */

(function () {
  'use strict';

  if (window.__HOME_SEARCH_DIRECT_V2__) return;
  window.__HOME_SEARCH_DIRECT_V2__ = true;

  const qs = (s, r = document) => r.querySelector(s);

  function getQuery() {
    const input =
      qs('#homeSearchInput') ||
      qs('#homeSearchBox input[type="search"]') ||
      qs('#homeSearchBox input') ||
      qs('input[type="search"]');

    return (input && input.value ? input.value : '').trim();
  }

  function goSearchPage(q) {
    if (!q) return;
    // user-edited canonical route
    window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
  }

  function bind() {
    const btn =
      qs('#homeSearchBtn') ||
      qs('#homeSearchButton') ||
      qs('#homeSearchBox button') ||
      qs('button[data-home-search]');

    const input =
      qs('#homeSearchInput') ||
      qs('#homeSearchBox input[type="search"]') ||
      qs('#homeSearchBox input') ||
      qs('input[type="search"]');

    if (btn) {
      btn.addEventListener('click', () => {
        const q = getQuery();
        goSearchPage(q);
      });
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = getQuery();
          goSearchPage(q);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
