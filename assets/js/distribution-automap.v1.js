
// distribution-automap.v1.js (FINAL STABLE)
// 역할:
// - 섹션 단위 자동 맵핑
// - 비어 있는 섹션만 데이터 삽입
// - 스켈레톤은 실카드 삽입 직후 즉시 제거
// - 기존 DOM / 레이아웃 절대 파괴하지 않음

(function () {
  'use strict';

  const SECTION_SELECTOR = '.thumb-grid[data-psom-key]';

  function hasRealCard(section) {
    return !!section.querySelector('.thumb-card:not(.skeleton)');
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

          // 1) 실카드 생성
          createCards(section, res.items);

          // 2) 같은 섹션의 스켈레톤 즉시 제거 (핵심)
          section.querySelectorAll('.thumb-card.skeleton').forEach(el => el.remove());
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
