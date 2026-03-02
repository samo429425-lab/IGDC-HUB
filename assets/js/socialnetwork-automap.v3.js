// socialnetwork-automap.v3.js (PRODUCTION SAFE VERSION)
// Fixed: strict PSOM key mapping, right/main separation, mobile rail target support
// Stable single-pass rendering (no placeholder override)

(function () {
  'use strict';

  if (window.__SOCIALNETWORK_AUTOMAP_V3_PROD__) return;
  window.__SOCIALNETWORK_AUTOMAP_V3_PROD__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';

  const LIMIT_MAIN = 100;
  const LIMIT_RIGHT = 80;

  // Main 9 sections + Right rail (socialnetwork)
  const SECTION_MAP = [
    { key: 'social-instagram', selectors: ['[data-psom-key="social-instagram"]'], limit: LIMIT_MAIN },
    { key: 'social-youtube', selectors: ['[data-psom-key="social-youtube"]'], limit: LIMIT_MAIN },
    { key: 'social-twitter', selectors: ['[data-psom-key="social-twitter"]'], limit: LIMIT_MAIN },
    { key: 'social-facebook', selectors: ['[data-psom-key="social-facebook"]'], limit: LIMIT_MAIN },
    { key: 'social-tiktok', selectors: ['[data-psom-key="social-tiktok"]'], limit: LIMIT_MAIN },
    { key: 'social-threads', selectors: ['[data-psom-key="social-threads"]'], limit: LIMIT_MAIN },
    { key: 'social-telegram', selectors: ['[data-psom-key="social-telegram"]'], limit: LIMIT_MAIN },
    { key: 'social-discord', selectors: ['[data-psom-key="social-discord"]'], limit: LIMIT_MAIN },
    { key: 'social-community', selectors: ['[data-psom-key="social-community"]'], limit: LIMIT_MAIN },

    // RIGHT: desktop right panel + mobile last rail (above footer)
    { key: 'socialnetwork', selectors: ['[data-psom-key="socialnetwork"]', '#social-mobile-rail .list'], limit: LIMIT_RIGHT }
  ];

  const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  let HAS_RENDERED = false;
  const RENDERED_NODES = new WeakSet();

  function clear(el) {
    if (!el || RENDERED_NODES.has(el)) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function escText(s) {
    try { return String(s ?? ''); } catch { return ''; }
  }

  function escUrl(u) {
    try { return String(u ?? '').replace(/'/g, '%27'); } catch { return ''; }
  }

  function pickImage(item) {
    return (item && (item.thumb || item.image || item.thumbnail || item.imageUrl || item.thumbnailUrl || '')) || '';
  }

  function pickTitle(item) {
    return (item && (item.title || item.name || item.text || '')) || '';
  }

  function pickMeta(item) {
    return (item && (item.meta || item.subtitle || item.summary || '')) || '';
  }

  function pickUrl(item) {
    return (item && (item.url || item.href || item.link || '')) || '';
  }

  function makeDummy(cfg, idx) {
    const n = idx + 1;
    return {
      title: (cfg.key || 'social') + ' ' + n,
      meta: '',
      thumb: PLACEHOLDER_IMG,
      url: '#'
    };
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'thumb-card';

    const img = document.createElement('div');
    img.className = 'thumb-img';
    const src = pickImage(item);
    const useSrc = src || PLACEHOLDER_IMG;
    img.style.backgroundImage = "url('" + escUrl(useSrc) + "')";
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = escText(pickTitle(item));

    const meta = document.createElement('div');
    meta.className = 'thumb-meta';
    meta.textContent = escText(pickMeta(item));

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(meta);

    const href = pickUrl(item);
    if (href && href !== '#') {
      card.addEventListener('click', function () { location.href = href; });
      card.style.cursor = 'pointer';
    }

    return card;
  }

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Snapshot load failed: ' + res.status);
    return res.json();
  }

  function getSections(snapshot) {
    return (snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections) ||
           (snapshot && snapshot.sections) ||
           null;
  }

  function selectTargets(selectors) {
    const out = [];
    (selectors || []).forEach(sel => {
      try {
        const nodes = document.querySelectorAll(sel);
        nodes.forEach(n => out.push(n));
      } catch {
        // ignore selector errors
      }
    });
    return out;
  }

  function renderStrict(sections) {
    if (HAS_RENDERED) return;

    // Strict: only SECTION_MAP keys are allowed to render
    SECTION_MAP.forEach(cfg => {
      const raw = sections && sections[cfg.key];
      const arr = Array.isArray(raw) ? raw : [];
      const limit = cfg.limit || LIMIT_MAIN;

      const list = arr.slice(0, limit);

      // If snapshot provides fewer items, fill with dummy (but do not invent cross-section items)
      while (list.length < limit) list.push(makeDummy(cfg, list.length));

      const targets = selectTargets(cfg.selectors);
      if (!targets.length) return;

      targets.forEach(box => {
        if (!box || RENDERED_NODES.has(box)) return;
        clear(box);
        list.forEach(item => box.appendChild(createCard(item)));
        RENDERED_NODES.add(box);
      });
    });

    HAS_RENDERED = true;
  }

  async function run() {
    try {
      const snapshot = await loadSnapshot();
      const sections = getSections(snapshot);
      if (!sections) return;

      renderStrict(sections);

      console.log('[AUTOMAP] Socialnetwork v3 production mapping loaded');
    } catch (e) {
      console.error('[AUTOMAP] Socialnetwork v3 error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

})();
