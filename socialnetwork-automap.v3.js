// socialnetwork-automap.V5.js
// FULL AUTO ADAPTIVE PRODUCTION VERSION

(function () {
  'use strict';

  if (window.__SOCIAL_AUTOMAP_V5__) return;
  window.__SOCIAL_AUTOMAP_V5__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';
  const LIMIT_MAIN = 100;
  const LIMIT_RIGHT = 100;
  const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'thumb-card';

    const img = document.createElement('div');
    img.className = 'thumb-img';
    img.style.backgroundImage = `url('${item.thumb || PLACEHOLDER}')`;
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center';

    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = item.title || '';

    const meta = document.createElement('div');
    meta.className = 'thumb-meta';
    meta.textContent = item.meta || '';

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(meta);

    if (item.url && item.url !== '#') {
      card.style.cursor = 'pointer';
      card.onclick = () => location.href = item.url;
    }

    return card;
  }

  function dummy(key, i) {
    return {
      title: `${key} ${i + 1}`,
      meta: '',
      thumb: PLACEHOLDER,
      url: '#'
    };
  }

  async function run() {
    try {
      const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
      const snapshot = await res.json();
      const sections = snapshot?.pages?.social?.sections || {};

      // HTML에 실제 존재하는 psom-key만 수집
      const htmlKeys = Array.from(
        document.querySelectorAll('[data-psom-key]')
      ).map(el => el.getAttribute('data-psom-key'));

      Object.keys(sections).forEach(key => {

        if (!htmlKeys.includes(key)) return;

        const box = document.querySelector(`[data-psom-key="${key}"]`);
        if (!box) return;

        const limit = key === 'socialnetwork' ? LIMIT_RIGHT : LIMIT_MAIN;

        const arr = Array.isArray(sections[key]) ? sections[key] : [];
        const list = arr.slice(0, limit);

        while (list.length < limit) {
          list.push(dummy(key, list.length));
        }

        clear(box);
        list.forEach(item => box.appendChild(createCard(item)));

      });

      console.log('[SOCIAL V5] FULL AUTO PRODUCTION LOADED');

    } catch (e) {
      console.error('[SOCIAL V5 ERROR]', e);
    }
  }

  run();

})();