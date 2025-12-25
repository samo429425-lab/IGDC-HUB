
// distribution-automap.v1.js (FINAL)
// YES: Section-by-section mapping
// YES: Fill ONLY empty sections
// NO: Touch sections that already have real cards

(function () {
  const SECTION_SELECTOR = '.thumb-grid[data-psom-key]';

  function hasRealCard(section) {
    return !!(section && section.querySelector('.thumb-card:not(.skeleton)'));
  }

  function createCards(section, items) {
    if (!Array.isArray(items) || items.length === 0) return;

    const frag = document.createDocumentFragment();
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.innerHTML = `
        <img class="thumb-img" src="${item.thumbnail || ''}" alt="">
        <div class="thumb-body">
          <div class="thumb-title">${item.title || ''}</div>
        </div>
      `;
      frag.appendChild(card);
    });
    section.appendChild(frag);
  }

  function mapSection(section) {
    if (hasRealCard(section)) return;

    const key = section.dataset.psomKey;
    if (!key) return;

    if (!window.FeedAPI || typeof window.FeedAPI.get !== 'function') return;

    window.FeedAPI.get({ key })
      .then(res => {
        if (res && Array.isArray(res.items)) {
          createCards(section, res.items);
        }
      })
      .catch(() => {});
  }

  function init() {
    document.querySelectorAll(SECTION_SELECTOR).forEach(mapSection);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
