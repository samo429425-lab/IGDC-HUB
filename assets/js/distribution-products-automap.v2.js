// distribution-products-automap.v5.locked.js
// Locked 1:1 section mapping - NO auto merge, NO fallback

(async function () {
  const SNAPSHOT_URL = '/data/distribution.snapshot.json';
  const LIMIT = 30;

  const SECTION_MAP = [
    { key: 'distribution-recommend', selector: '[data-psom-key="distribution-recommend"]' },
    { key: 'distribution-new', selector: '[data-psom-key="distribution-new"]' },
    { key: 'distribution-best', selector: '[data-psom-key="distribution-best"]' },
    { key: 'distribution-special', selector: '[data-psom-key="distribution-special"]' },
    { key: 'distribution-others', selector: '[data-psom-key="distribution-others"]' },
    { key: 'distribution-right', selector: '[data-psom-key="distribution-right"]' }
  ];

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function createCard(item) {
    const a = document.createElement('a');
    a.className = 'thumb-card';
    a.href = item.url || '#';

    const img = document.createElement('img');
    img.src = item.image || '';
    img.alt = item.title || '';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = item.title || '';

    a.appendChild(img);
    a.appendChild(title);
    return a;
  }

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Snapshot load failed');
    return res.json();
  }

  try {
    const snapshot = await loadSnapshot();

    if (!snapshot || !snapshot.sections) {
      console.error('[AUTOMAP] Invalid snapshot');
      return;
    }

    SECTION_MAP.forEach(cfg => {
      const box = document.querySelector(cfg.selector);
      if (!box) return;

      const items = snapshot.sections[cfg.key];
      if (!Array.isArray(items)) return;

      const list = items.slice(0, LIMIT);

      clear(box);

      list.forEach(item => {
        box.appendChild(createCard(item));
      });
    });

    console.log('[AUTOMAP] Locked mapping loaded');

  } catch (e) {
    console.error('[AUTOMAP] Error:', e);
  }

})();
