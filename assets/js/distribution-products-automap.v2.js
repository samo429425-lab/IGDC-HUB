/**
 * distribution-products-automap.v2.js  (V3-SAFE drop-in)
 * -------------------------------------------------
 * DISTRIBUTION HUB Auto Mapping Engine (V3)
 *
 * Goals:
 * - HARD scope to Distribution Hub (no Home bleed)
 * - Primary data source: /data/distribution.snapshot.json (distribution-only snapshot)
 * - Fallback data source: /.netlify/functions/distribution-feed (safe when snapshot missing)
 * - Section 1:1 mapping via data-psom-key (list element itself supported)
 * - Dummy handling:
 *    - Replace ONLY on successful render with real items
 *    - If snapshot missing/empty or fetch fails -> keep original DOM (offline-safe)
 */
(function () {
  'use strict';

  // ---- CONFIG -------------------------------------------------
  const SNAPSHOT_URL = '/data/distribution.snapshot.json';
  const FEED_FALLBACK_URL = '/.netlify/functions/distribution-feed';
  const PSOM_PREFIX = 'distribution';
  const LIST_SELF_CLASS = ['thumb-list', 'card-list'];
  const LIST_CHILD_SELECTORS = ['.thumb-list', '.card-list'];
  const MAIN_LIMIT = 30;
  const RIGHT_LIMIT = 30;


  // ---- UTILS --------------------------------------------------
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

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
    return { title, url, thumb, raw: item };
  }

  function looksLikeForeignHomeSeed(node) {
    const t = (node && node.textContent || '').trim();
    return /^home\s*[\d_]+\s*product\s*\d+/i.test(t) || /^home\s*right/i.test(t);
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
      img.setAttribute('data-src', n.thumb);
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

  // ---- SNAPSHOT READERS --------------------------------------
  function extractSectionItems(snapshot, key) {
    const pages = snapshot && snapshot.pages;
    const dist = pages && pages.distribution;
    if (!dist) return null;

    // object form: dist.sections = { "distribution-recommend": [..], ... }
    if (dist.sections && typeof dist.sections === 'object' && !Array.isArray(dist.sections)) {
      const arr = dist.sections[key];
      if (Array.isArray(arr)) return arr;
      const k2 = key.startsWith(PSOM_PREFIX + '-') ? key.slice((PSOM_PREFIX + '-').length) : key;
      const arr2 = dist.sections[k2];
      if (Array.isArray(arr2)) return arr2;
      return [];
    }

    // array form: dist.sections = [{ key, items: [...] }, ...]
    if (Array.isArray(dist.sections)) {
      const sec = dist.sections.find(s => s && (String(s.key || s.id || '').trim() === key));
      if (sec && Array.isArray(sec.items)) return sec.items;
      return [];
    }

    return [];
  }

  async function loadJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed: ' + url + ' ' + res.status);
    return await res.json();
  }

  // ---- MAIN ---------------------------------------------------
  function init() {
    const targets = qsa('[data-psom-key^="distribution"]');
    if (!targets.length) return;

    // Capture dummy nodes per target (offline-safe).
    const state = targets.map(wrapper => {
      const listEl = findListEl(wrapper);
      if (!listEl) return null;

      // purge foreign home seeds
      const children = Array.from(listEl.childNodes || []);
      const dummy = [];
      for (const n of children) {
        if (n.nodeType === 1 && looksLikeForeignHomeSeed(n)) {
          try { listEl.removeChild(n); } catch (e) {}
          continue;
        }
        dummy.push(n);
      }
      return { wrapper, listEl, key: wrapper.getAttribute('data-psom-key'), dummy };
    }).filter(Boolean);

    if (!state.length) return;

    // Attempt render:
    //  1) snapshot file
    //  2) fallback function
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

      // Failure path: do nothing (keep DOM)
      if (!snapshot || !(snapshot.pages && snapshot.pages.distribution)) return;

      for (const t of state) {
        const items = extractSectionItems(snapshot, t.key);
        if (!Array.isArray(items) || items.length === 0) continue;

      const limit = 30;

      const norm = items
        .map(normalizeItem)
        .filter(Boolean)
        .slice(0, limit);

    if (!norm.length) continue;

        // SUCCESS PATH: replace dummy with real content
        clear(t.listEl);
        for (const n of norm) t.listEl.appendChild(createCard(n));
      }
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
