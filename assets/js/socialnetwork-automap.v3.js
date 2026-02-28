// socialnetwork-automap.LONGTERM.js
// IGDC Social Automap Engine - Production Grade

(function () {
  'use strict';

  if (window.__IGDC_SOCIAL_ENGINE__) return;
  window.__IGDC_SOCIAL_ENGINE__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';
  const LIMIT_MAIN = 100;
  const LIMIT_RIGHT = 100;
  const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  const RENDERED = new WeakSet();

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'thumb-card';

    const img = document.createElement('div');
    img.className = 'thumb-img';
    img.style.backgroundImage = `url('${item.thumb || PLACEHOLDER}')`;
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = item.title || '';

    const meta = document.createElement('div');
    meta.className = 'thumb-meta';
    meta.textContent = item.meta || '';

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(meta);

    if (item.url && item.url !== '#') {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        location.href = item.url;
      });
    }

    return card;
  }

  function buildList(key, data) {
    const limit = key === 'socialnetwork' ? LIMIT_RIGHT : LIMIT_MAIN;
    const arr = Array.isArray(data) ? data.slice(0, limit) : [];

    while (arr.length < limit) {
      arr.push({
        title: `${key} ${arr.length + 1}`,
        meta: '',
        thumb: PLACEHOLDER,
        url: '#'
      });
    }

    return arr;
  }

  function renderKey(key, data) {
    const nodes = document.querySelectorAll(`[data-psom-key="${key}"]`);
    if (!nodes.length) return;

    const list = buildList(key, data);

    nodes.forEach(node => {
      if (RENDERED.has(node)) return;
      clear(node);
      list.forEach(item => node.appendChild(createCard(item)));
      RENDERED.add(node);
    });
  }

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    return await res.json();
  }

  async function run() {
    try {
      const snapshot = await loadSnapshot();
      const sections = snapshot?.pages?.social?.sections || {};

      Object.keys(sections).forEach(key => {
        renderKey(key, sections[key]);
      });

      console.log('[IGDC SOCIAL ENGINE] Render complete');

    } catch (err) {
      console.error('[IGDC SOCIAL ENGINE ERROR]', err);
    }
  }

  // DOM Ready 보장
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();