/**
 * distribution-products-automap.v2.js
 * -------------------------------------------------
 * DISTRIBUTION HUB Auto Mapping Engine (V2)
 *
 * Goals:
 * - HARD scope to Distribution Hub (no Home bleed)
 * - Data source: /data/front.snapshot.json (snapshot-only)
 * - Section 1:1 mapping via data-psom-key (list element itself supported)
 * - Dummy handling:
 *    - Hide/replace ONLY on successful render with real items
 *    - If snapshot missing/empty or fetch fails -> keep original DOM (offline-safe)
 *    - Additionally, purge obvious "home * Product *" foreign seeds from being treated as dummy
 *
 * Non-breaking:
 * - Does not touch other pages.
 * - No global mutations beyond the distribution section containers.
 */

(function () {
  'use strict';

  // ---- CONFIG -------------------------------------------------
  const SNAPSHOT_URL = '/data/front.snapshot.json'; // keep canonical static path
  const PSOM_PREFIX = 'distribution';
  const LIST_SELF_CLASS = ['thumb-list', 'card-list'];
  const LIST_CHILD_SELECTORS = ['.thumb-list', '.card-list'];

  // Optional: limit items per section (UI is 4-col grid; 8 is safe)
  const MAX_ITEMS_PER_SECTION = 12;

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
    // IMPORTANT: in Distribution Hub HTML, data-psom-key sits on the list itself
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
    const source = pick(item, ['source', 'provider', 'site']);

    return { title, url, thumb, source, raw: item };
  }

  function looksLikeForeignHomeSeed(node) {
    // purge obvious home-seed text to avoid "home_* Product_*" bleeding into Distribution UI
    if (!node) return false;
    const t = (node.textContent || '').trim();
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
      // thumbnail-loader.compat expects data-src in some pages; keep both to be safe
      img.setAttribute('data-src', n.thumb);
      img.src = n.thumb;
      img.alt = safeText(n.title);
      a.appendChild(img);
    } else {
      // keep layout stable
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

    // 1) array form: dist.sections = [{ key, items: [...] }, ...]
    if (Array.isArray(dist.sections)) {
      const sec = dist.sections.find(s => s && (String(s.key || s.id || '').trim() === key));
      if (sec && Array.isArray(sec.items)) return sec.items;
      return [];
    }

    // 2) object form: dist.sections = { "distribution-recommend": [..], ... }
    if (dist.sections && typeof dist.sections === 'object') {
      const arr = dist.sections[key];
      if (Array.isArray(arr)) return arr;
      // allow fallback without prefix
      const k2 = key.startsWith(PSOM_PREFIX + '-') ? key.slice((PSOM_PREFIX + '-').length) : key;
      const arr2 = dist.sections[k2];
      if (Array.isArray(arr2)) return arr2;
      return [];
    }

    return [];
  }

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('snapshot fetch failed: ' + res.status);
    return await res.json();
  }

  // ---- MAIN ---------------------------------------------------
  function init() {
    // Scope guard: run only on pages containing distribution psom keys
    const targets = qsa('[data-psom-key^="distribution"]');
    if (!targets.length) return;

    // Capture dummy nodes per target (offline-safe).
    const state = targets.map(wrapper => {
      const listEl = findListEl(wrapper);
      if (!listEl) return null;

      // capture and purge obvious foreign home-seeds so they won't persist as "dummy"
      const children = Array.from(listEl.childNodes || []);
      const dummy = [];
      for (const n of children) {
        if (n.nodeType === 1 && looksLikeForeignHomeSeed(n)) {
          // remove foreign seed now
          try { listEl.removeChild(n); } catch (e) {}
          continue;
        }
        dummy.push(n);
      }

      return { wrapper, listEl, key: wrapper.getAttribute('data-psom-key'), dummy };
    }).filter(Boolean);

    // If nothing usable, stop.
    if (!state.length) return;

    // Attempt render; on failure, keep dummy (do not wipe).
    loadSnapshot().then(snapshot => {
      // If distribution page missing -> do nothing (offline-safe / no-data safe)
      const hasDist = !!(snapshot && snapshot.pages && snapshot.pages.distribution);
      if (!hasDist) return;

      for (const t of state) {
        const items = extractSectionItems(snapshot, t.key);
        if (!Array.isArray(items) || items.length === 0) continue;

        const norm = items.map(normalizeItem).filter(Boolean).slice(0, MAX_ITEMS_PER_SECTION);
        if (!norm.length) continue;

        // SUCCESS PATH: replace dummy with real content
        clear(t.listEl);
        for (const n of norm) t.listEl.appendChild(createCard(n));
      }
    }).catch(() => {
      // Failure path: restore dummy exactly as captured (no changes).
      for (const t of state) {
        if (!t.listEl) continue;
        // If list already has content, don't fight it (avoid flicker).
        if (t.listEl.childNodes && t.listEl.childNodes.length) continue;
        for (const n of t.dummy) t.listEl.appendChild(n);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
