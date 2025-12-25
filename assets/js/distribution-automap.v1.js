
// distribution-automap.v1.js (REBUILT ENGINE)
// 목표: "정상 1차 렌더"를 절대 무너뜨리지 않음
// - 기존 카드가 있으면 절대 손대지 않음 (완성본 존중)
// - 비어있는 섹션만 채움
// - 필요한 섹션들의 데이터를 '전부' 받은 뒤 한 번에 DOM 반영
// - 반영은 section 단위로 한 번에 append (중간 상태 노출 최소화)
// - 스켈레톤은 실카드 반영 직후 해당 섹션에서만 제거

(function () {
  'use strict';

  const SECTION_SELECTOR = '.thumb-grid[data-psom-key]';
  const REAL_CARD_SELECTOR = '.thumb-card:not(.skeleton)';
  const SKELETON_SELECTOR = '.thumb-card.skeleton';

  function hasFeedAPI() {
    return !!(window.FeedAPI && typeof window.FeedAPI.get === 'function');
  }

  function hasRealCards(section) {
    return !!section.querySelector(REAL_CARD_SELECTOR);
  }

  function buildCardsFragment(items) {
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
    return frag;
  }

  function removeSkeleton(section) {
    section.querySelectorAll(SKELETON_SELECTOR).forEach(el => el.remove());
  }

  async function fetchSectionData(key) {
    return window.FeedAPI.get({ key });
  }

  async function run() {
    if (!hasFeedAPI()) return;

    const sections = Array.from(document.querySelectorAll(SECTION_SELECTOR));
    if (!sections.length) return;

    const targets = sections
      .filter(sec => !hasRealCards(sec))
      .map(sec => ({ section: sec, key: sec.dataset.psomKey }))
      .filter(x => !!x.key);

    if (!targets.length) return;

    const results = await Promise.allSettled(
      targets.map(t => fetchSectionData(t.key))
    );

    requestAnimationFrame(() => {
      targets.forEach((t, idx) => {
        const section = t.section;

        if (hasRealCards(section)) return;

        const r = results[idx];
        if (!r || r.status !== 'fulfilled') return;

        const payload = r.value || {};
        const items = Array.isArray(payload.items) ? payload.items : null;
        if (!items || items.length === 0) return;

        const prevVisibility = section.style.visibility;
        section.style.visibility = 'hidden';

        section.appendChild(buildCardsFragment(items));
        removeSkeleton(section);
        section.dataset.automapDone = '1';

        section.style.visibility = prevVisibility || '';
      });
    });
  }

  if (window.__DISTRIBUTION_AUTOMAP_RAN__) return;
  window.__DISTRIBUTION_AUTOMAP_RAN__ = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
