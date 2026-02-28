// social-rightpanel-automap.v3.js (PRODUCTION SAFE)
// Goal:
// - Main page: 9 SNS sections (keys usually start with "social-")
// - Right panel: Product model (same card model) (key often "socialnetwork" OR contains "right")
// Safety:
// - No fallback container insertion (prevents "wrong house" bug)
// - Renders ONLY into exact [data-psom-key="..."] boxes
// - Slot-first: always fills to LIMIT with dummy items

(function () {
  'use strict';

  if (window.__SOCIAL_AUTOMAP_V3__) return;
  window.__SOCIAL_AUTOMAP_V3__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';

  const LIMIT_MAIN = 100;
  const LIMIT_RIGHT = 100;

  const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  let HAS_RENDERED = false;

  function clear(el) {
    if (!el || HAS_RENDERED) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function escUrl(u) {
    try { return String(u || '').replace(/'/g, '%27'); } catch { return ''; }
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
    return (item && (item.url || item.href || item.link || '#')) || '#';
  }

  function isRightPanelKey(key) {
    const k = String(key || '').toLowerCase();
    if (!k) return false;
    return (
      k === 'socialnetwork' ||
      k.includes('right') ||
      k.includes('rightpanel') ||
      k.includes('right-panel') ||
      k.endsWith('-right') ||
      k.startsWith('right-')
    );
  }

  function makeDummy(key, idx, isRight) {
    const n = idx + 1;
    if (isRight) {
      return { title: 'Product ' + n, meta: '', thumb: PLACEHOLDER_IMG, url: '#' };
    }
    // SNS main
    return { title: (key || 'social') + ' Post ' + n, meta: '', thumb: PLACEHOLDER_IMG, url: '#' };
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
    title.textContent = pickTitle(item) || 'Item';

    const meta = document.createElement('div');
    meta.className = 'thumb-meta';
    meta.textContent = pickMeta(item);

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(meta);

    const href = pickUrl(item);
    if (href && href !== '#') {
      card.addEventListener('click', function(){ location.href = href; });
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

  function buildSectionMapFromDom() {
    // Strict: only render into boxes that explicitly declare data-psom-key
    const nodes = Array.from(document.querySelectorAll('[data-psom-key]'));
    const keys = [];
    const seen = new Set();
    nodes.forEach(n => {
      const k = (n.getAttribute('data-psom-key') || '').trim();
      if (!k) return;
      if (seen.has(k)) return;
      seen.add(k);
      keys.push(k);
    });
    return keys.map(k => ({
      key: k,
      selector: '[data-psom-key="' + k.replace(/"/g, '\\"') + '"]',
      limit: isRightPanelKey(k) ? LIMIT_RIGHT : LIMIT_MAIN,
      isRight: isRightPanelKey(k)
    }));
  }

  function renderSlotFirst(sections) {
    if (HAS_RENDERED) return;

    const SECTION_MAP = buildSectionMapFromDom();

    SECTION_MAP.forEach(cfg => {
      const box = document.querySelector(cfg.selector);
      if (!box) return;

      const raw = sections && sections[cfg.key];
      const arr = Array.isArray(raw) ? raw : [];
      const limit = cfg.limit || LIMIT_MAIN;

      const list = arr.slice(0, limit);
      while (list.length < limit) list.push(makeDummy(cfg.key, list.length, cfg.isRight));

      clear(box);
      list.forEach(item => box.appendChild(createCard(item)));
    });

    HAS_RENDERED = true;
  }

  (async function run(){
    try {
      const snapshot = await loadSnapshot();
      const sections = getSections(snapshot);
      if (!sections) return;

      renderSlotFirst(sections);

      console.log('[SOCIAL_AUTOMAP_V3] slot-first mapping loaded');
    } catch (e) {
      console.error('[SOCIAL_AUTOMAP_V3] Error:', e);
    }
  })();

})();
