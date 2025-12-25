
// distribution-automap.v1.js (FIXED)
// YES: Create cards ONLY if none exist
// NO: Re-render, clear, or touch existing DOM

(function () {
  const CONTAINER_SELECTOR = '.thumb-grid';

  function hasCards() {
    const container = document.querySelector(CONTAINER_SELECTOR);
    return !!(container && container.children.length > 0);
  }

  function createCardsOnce(data) {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    // SAFETY: never touch if cards already exist
    if (container.children.length > 0) return;

    if (!Array.isArray(data)) return;

    data.forEach(item => {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.innerHTML = `
        <img src="${item.thumbnail || ''}" alt="">
        <div class="thumb-title">${item.title || ''}</div>
      `;
      container.appendChild(card);
    });
  }

  // Initial run: ONLY if empty
  document.addEventListener('DOMContentLoaded', () => {
    if (hasCards()) return;

    if (window.FeedAPI && typeof window.FeedAPI.get === 'function') {
      window.FeedAPI.get({ page: 'distribution' })
        .then(res => {
          if (res && res.items) {
            createCardsOnce(res.items);
          }
        })
        .catch(() => {});
    }
  });
})();
