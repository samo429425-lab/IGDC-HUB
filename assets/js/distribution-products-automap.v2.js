/**
 * distribution-products-automap.v4.js (STRICT KEY / ALL = 30)
 * -------------------------------------------------
 * Distribution Hub Auto Mapping Engine (FINAL)
 * - Snapshot normalized
 * - Strict key mapping
 * - No section bleed
 * - MAIN / RIGHT unified = 30
 */

(function () {
  'use strict';

  // ---- CONFIG ------------------------------------
  const SNAPSHOT_URL = '/data/distribution.snapshot.json';
  const FEED_FALLBACK_URL = '/.netlify/functions/distribution-feed';

  const LIMIT_ALL = 30;

  const LIST_SELF_CLASS = ['thumb-list', 'card-list'];
  const LIST_CHILD_SELECTORS = ['.thumb-list', '.card-list'];

  // ---- UTILS -------------------------------------
  const qsa = (sel, root) =>
    Array.from((root || document).querySelectorAll(sel));

  function isListEl(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = el.classList || { contains: () => false };
    return LIST_SELF_CLASS.some(c => cls.contains(c));
  }

  function findListEl(wrapper) {
    if (!wrapper) return null;
    if (isListEl(wrapper)) return wrapper;

    for (const sel of LIST_CHILD_SELECTORS) {
      const el = wrapper.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function safeText(v) {
    return String(v == null ? '' : v).replace(/[<>]/g, '');
  }

  function pick(obj, keys) {
    for (const k of keys) {
      const v = obj && obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function normalizeItem(item) {
    if (!item || typeof item !== 'object') return null;

    const title = pick(item, ['title', 'name', 'label', 'text']) || 'Untitled';
    const url = pick(item, ['url', 'link', 'href']) || '#';
    const thumb = pick(item, ['thumb', 'thumbnail', 'image', 'img', 'cover', 'poster']);

    return { title, url, thumb };
  }

  function clear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function createCard(n) {
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = n.url || '#';
    a.target = '_blank';
    a.rel = 'noopener';

    if (n.thumb) {
      const img = document.createElement('img');
      img.className = 'thumb-img';
      img.src = n.thumb;
      img.alt = safeText(n.title);
      a.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'thumb-img';
      a.appendChild(ph);
    }

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = safeText(n.title);
    a.appendChild(title);

    return a;
  }

  // ---- SNAPSHOT NORMALIZE -------------------------
  function normalizeSections(snapshot) {
    const dist = snapshot?.pages?.distribution;
    if (!dist || !dist.sections) return null;

    const map = Object.create(null);

    // Object type
    if (!Array.isArray(dist.sections)) {
      for (const k in dist.sections) {
        if (Array.isArray(dist.sections[k])) {
          map[k] = dist.sections[k];
        }
      }
      return map;
    }

    // Array type
    for (const sec of dist.sections) {
      const key = String(sec?.key || sec?.id || '').trim();
      if (!key) continue;
      if (Array.isArray(sec.items)) {
        map[key] = sec.items;
      }
    }

    return map;
  }

  async function loadJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(url + ' ' + res.status);
    return await res.json();
  }

  // ---- MAIN --------------------------------------
  function init() {
    const targets = qsa('[data-psom-key]');

    if (!targets.length) return;

    const state = targets.map(wrapper => {
      const listEl = findListEl(wrapper);
      if (!listEl) return null;

      return {
        listEl,
        key: wrapper.getAttribute('data-psom-key').trim()
      };
    }).filter(Boolean);

    if (!state.length) return;

    (async () => {
      let snapshot = null;

      try {
        snapshot = await loadJSON(SNAPSHOT_URL);
      } catch (e1) {
        try {
          snapshot = await loadJSON(FEED_FALLBACK_URL);
        } catch (e2) {
          snapshot = null;
        }
      }

      if (!snapshot) return;

      const sectionMap = normalizeSections(snapshot);
      if (!sectionMap) return;

      for (const t of state) {
        const items = sectionMap[t.key];

        if (!Array.isArray(items) || !items.length) continue;

        const norm = items
          .map(normalizeItem)
          .filter(Boolean)
          .slice(0, LIMIT_ALL);

        if (!norm.length) continue;

        clear(t.listEl);

        for (const n of norm) {
          t.listEl.appendChild(createCard(n));
        }
      }
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
