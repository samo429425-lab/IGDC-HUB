
/**
 * home-right-panel.controller.js
 * ------------------------------------------------------------
 * PURPOSE
 *  - Controls ONLY the Home right panel automap (top/middle/bottom)
 *  - Does NOT touch main sections (home_1 ~ home_5)
 *  - Safe, additive controller layer (no override, no global collision)
 *
 * DATA SOURCE
 *  - /.netlify/functions/feed?page=homeproducts
 *    → sections: home_right_top / home_right_middle / home_right_bottom
 *
 * SAFETY
 *  - No overwrite of existing pipelines
 *  - Namespaced flag to prevent double init
 */

(function () {
  'use strict';

  if (window.__HOME_RIGHT_PANEL_CONTROLLER__) return;
  window.__HOME_RIGHT_PANEL_CONTROLLER__ = true;

  const FEED_URL = '/.netlify/functions/feed?page=homeproducts';
  const RIGHT_KEYS = [
    'home_right_top',
    'home_right_middle',
    'home_right_bottom'
  ];

  const LIMIT = 50;

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function safeFetch(url, timeout = 2000) {
    return new Promise((resolve) => {
      const ac = new AbortController();
      const t = setTimeout(() => {
        try { ac.abort(); } catch (_) {}
        resolve(null);
      }, timeout);

      fetch(url, { cache: 'no-store', signal: ac.signal })
        .then(r => r && r.ok ? r.json() : null)
        .then(j => {
          clearTimeout(t);
          resolve(j);
        })
        .catch(() => {
          clearTimeout(t);
          resolve(null);
        });
    });
  }

  function normalizeItem(it) {
    if (!it) return null;
    return {
      title: it.title || '',
      thumb: it.thumb || '',
      url: it.url || '#',
      priority: typeof it.priority === 'number' ? it.priority : 999999
    };
  }

  function buildCard(item) {
    const a = document.createElement('a');
    a.className = 'ad-box news-btn';
    a.href = item.url || '#';
    a.target = '_blank';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item.title || '';
    img.src = item.thumb || '';

    a.appendChild(img);
    return a;
  }

  function resolvePanel(key) {
    // Expected DOM:
    // .ad-section[data-psom-key="home_right_top"] .ad-list
    const section = qs('[data-psom-key="' + key + '"]');
    if (!section) return null;

    const list =
      section.classList.contains('ad-list')
        ? section
        : qs('.ad-list', section);

    if (!list) return null;

    return { section, list };
  }

  async function run() {
    const data = await safeFetch(FEED_URL);
    if (!data || !Array.isArray(data.sections)) return;

    RIGHT_KEYS.forEach(key => {
      const target = resolvePanel(key);
      if (!target) return;

      const sec = data.sections.find(s => s.id === key);
      if (!sec || !Array.isArray(sec.items)) return;

      const items = sec.items
        .map(normalizeItem)
        .filter(Boolean)
        .sort((a, b) => a.priority - b.priority)
        .slice(0, LIMIT);

      if (!items.length) return;

      target.list.innerHTML = '';
      items.forEach(it => target.list.appendChild(buildCard(it)));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
