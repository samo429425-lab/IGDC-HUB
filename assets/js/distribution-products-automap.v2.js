// distribution-products-automap.v2.js (LOCKED MAPPING - PRODUCTION)
// - 1:1 section mapping ONLY (no auto merge)
// - Reads snapshot from /data/distribution.snapshot.json
// - Supports BOTH snapshot shapes:
//     A) { sections: { ... } }
//     B) { pages: { distribution: { sections: { ... }}}}
// - Limits:
//     main sections: 100
//     right panel:   80
//
// NOTE: Card DOM structure matches distributionhub.html's thumb-autofill-js
//       (.thumb-card > .thumb-img + .thumb-title + .thumb-meta)

(async function () {
  const SNAPSHOT_URL = '/data/distribution.snapshot.json';

  const LIMIT_MAIN = 100;
  const LIMIT_RIGHT = 80;

  const SECTION_MAP = [
    { key: 'distribution-recommend', selector: '[data-psom-key="distribution-recommend"]', limit: LIMIT_MAIN },
    { key: 'distribution-new',       selector: '[data-psom-key="distribution-new"]',       limit: LIMIT_MAIN },
    { key: 'distribution-best',      selector: '[data-psom-key="distribution-best"]',      limit: LIMIT_MAIN },
    { key: 'distribution-special',   selector: '[data-psom-key="distribution-special"]',   limit: LIMIT_MAIN },
    { key: 'distribution-others',    selector: '[data-psom-key="distribution-others"]',    limit: LIMIT_MAIN },
    { key: 'distribution-right',     selector: '[data-psom-key="distribution-right"]',     limit: LIMIT_RIGHT }
  ];

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function escUrl(u) {
    try { return String(u || '').replace(/'/g, '%27'); } catch { return ''; }
  }

  function pickImage(item) {
    return (item && (item.image || item.thumb || item.thumbnail || '')) || '';
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

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'thumb-card';

    const img = document.createElement('div');
    img.className = 'thumb-img';
    const src = pickImage(item);
    if (src) {
      img.style.backgroundImage = "url('" + escUrl(src) + "')";
      img.style.backgroundSize = 'cover';
      img.style.backgroundPosition = 'center';
    }

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = pickTitle(item) || 'Recommended';

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
    if (!res.ok) throw new Error('Snapshot load failed');
    return res.json();
  }

  function getSections(snapshot) {
    return snapshot?.pages?.distribution?.sections || snapshot?.sections || null;
  }

  try {
    const snapshot = await loadSnapshot();
    const sections = getSections(snapshot);

    if (!sections) {
      console.error('[AUTOMAP] Invalid snapshot structure (need snapshot.pages.distribution.sections OR snapshot.sections)');
      return;
    }

    SECTION_MAP.forEach(cfg => {
      const box = document.querySelector(cfg.selector);
      if (!box) return;

      const items = sections[cfg.key];
      if (!Array.isArray(items) || items.length === 0) return;

      const list = items.slice(0, cfg.limit || LIMIT_MAIN);

      clear(box);
      list.forEach(item => box.appendChild(createCard(item)));
    });

    console.log('[AUTOMAP] Locked mapping loaded');
  } catch (e) {
    console.error('[AUTOMAP] Error:', e);
  }
})();
