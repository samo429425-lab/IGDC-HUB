// socialnetwork-automap-v4.js
// 목적:
// 1) social.snapshot.json의 pages.social.sections 기준으로 메인 9섹션 + 우측 패널 렌더
// 2) HTML의 data-psom-key를 기준으로 메인 키를 읽는다
// 3) social-maru는 메인 9섹션 렌더 대상에서 제외한다
// 4) 데이터가 없으면 기존 HTML/더미를 유지한다
// 5) rightPanel key alias를 최대한 흡수한다
// 6) 런타임 에러를 window.__SOCIALNETWORK_AUTOMAP_V4_STATE__에 남긴다
// 7) 기존 mobile rail / rightpanel bootstrap과 충돌하지 않도록 안전하게 동작한다

function initSocialAutomap() {
  'use strict';

  if (window.__SOCIALNETWORK_AUTOMAP_V4__) return;
  window.__SOCIALNETWORK_AUTOMAP_V4__ = true;

  const SNAPSHOT_URL = (window.location.origin || '') + '/data/social.snapshot.json';
  const MAIN_LIMIT = 100;
  const DESKTOP_RIGHT_LIMIT = 100;
  const MOBILE_RIGHT_LIMIT = 1;

  const RIGHT_KEY_ALIASES = [
  'rightPanel',
  'rightpanel',
  'right_panel',
  'social-right',
  'social_right',
  'social-right-panel',
  'social_right_panel'
];

  const EXCLUDED_MAIN_KEYS = new Set(['rightPanel']);

  const STATE = {
    version: 'v4',
    startedAt: Date.now(),
    snapshotUrl: SNAPSHOT_URL,
    loaded: false,
    rendered: false,
    errors: [],
    mainKeys: [],
    rightKeyUsed: null
  };

  window.__SOCIALNETWORK_AUTOMAP_V4_STATE__ = STATE;

  function logError(stage, error, extra) {
    const payload = {
      stage,
      message: error && error.message ? error.message : String(error || ''),
      extra: extra || null
    };
    STATE.errors.push(payload);
    console.error('[socialnetwork-automap-v4]', payload);
  }

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function safeText(v) {
    return v == null ? '' : String(v);
  }

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function pickTitle(it) {
    return safeText(it && (it.title || it.name || it.text || it.label));
  }

  function pickUrl(it) {
    return safeText(it && (it.url || it.href || it.link || it.productUrl || it.detailUrl)) || '#';
  }

  function pickThumb(it) {
    return safeText(it && (it.thumb || it.image || it.thumbnail || it.imageUrl || it.thumbnailUrl));
  }

  function pickDesc(it) {
    return safeText(
      it && (
        it.description ||
        it.summary ||
        (it.source && (it.source.platform || it.source.site || it.source.provider || it.source.section_key)) ||
        ''
      )
    );
  }

  function isRenderableItem(it) {
    if (!it || typeof it !== 'object') return false;
    if (it.type === 'placeholder') return true;
    if (pickTitle(it)) return true;
    if (pickUrl(it) && pickUrl(it) !== '#') return true;
    if (pickThumb(it)) return true;
    return false;
  }

function makeSocialDummy(key, idx){
  const n = idx + 1;
  return {
    title: key + ' sample ' + n,
    url: '#',
    thumb: ''
  };
}

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('snapshot_load_failed:' + res.status);
    }
    const json = await res.json();
    STATE.loaded = true;
    return json;
  }

  function getSocialRoot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return {};
    return snapshot.pages && snapshot.pages.social ? snapshot.pages.social : (snapshot.social || {});
  }

  function getSectionMap(snapshot) {
    const socialRoot = getSocialRoot(snapshot);
    const sections = socialRoot && typeof socialRoot.sections === 'object' ? socialRoot.sections : {};
    return sections || {};
  }

function getSections(snapshot){
  const sec = getSectionMap(snapshot);

  return {
    main: sec,
    right: {
      rightPanel: sec.rightPanel || []
    }
  };
}

  function pickRightSectionKey(sectionMap) {
    for (const key of RIGHT_KEY_ALIASES) {
      if (sectionMap && Object.prototype.hasOwnProperty.call(sectionMap, key)) {
        STATE.rightKeyUsed = key;
        return key;
      }
    }
    return null;
  }

  function normalizeItems(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    return [];
  }

  function getMainTargets() {
    return qsa('[data-psom-key]')
      .map(function (el) {
        return {
          el,
          key: el.getAttribute('data-psom-key') || ''
        };
      })
      .filter(function (row) {
        return !!row.key && !EXCLUDED_MAIN_KEYS.has(row.key);
      });
  }

  function ensureMainCards(gridEl, requiredCount) {
    let cards = qsa('a.card', gridEl);

    if (cards.length < requiredCount) {
      const frag = document.createDocumentFragment();

      for (let i = cards.length; i < requiredCount; i++) {
        const a = document.createElement('a');
        a.className = 'card';
        a.href = '#';
        a.target = '_self';
        a.rel = 'noopener';
        a.dataset.dummy = '1';

        const pic = document.createElement('div');
        pic.className = 'pic';

        const meta = document.createElement('div');
        meta.className = 'meta';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = 'Loading';

        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = 'Preparing';

        const cta = document.createElement('span');
        cta.className = 'cta';
        cta.textContent = 'Open';

        meta.appendChild(title);
        meta.appendChild(desc);
        meta.appendChild(cta);

        a.appendChild(pic);
        a.appendChild(meta);

        frag.appendChild(a);
      }

      gridEl.appendChild(frag);
      cards = qsa('a.card', gridEl);
    }

    return cards;
  }

  function resetMainCard(card) {
    if (!card) return;

    card.href = '#';
    card.target = '_self';
    card.rel = 'noopener';
    card.dataset.dummy = '1';

    const pic = qs('.pic', card);
    const title = qs('.title', card);
    const desc = qs('.desc', card);

    if (title) title.textContent = 'Loading';
    if (desc) desc.textContent = 'Preparing';

    if (pic) {
      pic.style.backgroundImage = '';
      pic.style.backgroundSize = '';
      pic.style.backgroundPosition = '';
      pic.textContent = '';
    }
  }

  function paintMainCard(card, item) {
    if (!card) return;

    const url = pickUrl(item);
    const titleText = pickTitle(item) || 'Item';
    const descText = pickDesc(item) || ' ';
    const thumb = pickThumb(item);

    card.href = url || '#';
    card.target = (url && url !== '#') ? '_blank' : '_self';
    card.rel = 'noopener';
    card.removeAttribute('data-dummy');

    const pic = qs('.pic', card);
    const title = qs('.title', card);
    const desc = qs('.desc', card);

    if (title) title.textContent = titleText;
    if (desc) desc.textContent = descText;

    if (pic) {
      if (thumb) {
        pic.textContent = '';
        pic.style.backgroundImage = "url('" + thumb.replace(/'/g, '%27') + "')";
        pic.style.backgroundSize = 'cover';
        pic.style.backgroundPosition = 'center';
      } else {
        pic.style.backgroundImage = '';
        pic.style.backgroundSize = '';
        pic.style.backgroundPosition = '';
        pic.textContent = '';
      }
    }
  }

  function mountMainGrid(gridEl, rawItems) {
    if (!gridEl) return;

let items = normalizeItems(rawItems)
  .filter(isRenderableItem)
  .slice(0, MAIN_LIMIT);

// ✅ 핵심 fallback
while(items.length < MAIN_LIMIT){
  items.push(makeSocialDummy('social', items.length));
}

    const cards = ensureMainCards(gridEl, MAIN_LIMIT);

    for (let i = 0; i < cards.length; i++) {
      const item = items[i];
      if (item) paintMainCard(cards[i], item);
      else resetMainCard(cards[i]);
    }
  }

  function ensureRightCards(panel, requiredCount) {
    let cards = qsa('.ad-box', panel);

    if (cards.length < requiredCount) {
      const frag = document.createDocumentFragment();

      for (let i = cards.length; i < requiredCount; i++) {
        const box = document.createElement('div');
        box.className = 'ad-box';
        box.dataset.dummy = '1';

        const a = document.createElement('a');
        a.href = '#';
        a.textContent = 'Loading...';

        box.appendChild(a);
        frag.appendChild(box);
      }

      panel.appendChild(frag);
      cards = qsa('.ad-box', panel);
    }

    return cards;
  }

  function resetRightCard(box) {
    if (!box) return;
    box.dataset.dummy = '1';
    box.innerHTML = '';

    const a = document.createElement('a');
    a.href = '#';
    a.textContent = 'Loading...';
    box.appendChild(a);
  }

  function paintRightCard(box, item) {
    if (!box) return;

    const url = pickUrl(item);
    const title = pickTitle(item) || 'Item';

    box.removeAttribute('data-dummy');
    box.innerHTML = '';

    const a = document.createElement('a');
    a.href = url || '#';
    a.target = (url && url !== '#') ? '_blank' : '_self';
    a.rel = 'noopener';
    a.textContent = title;

    box.appendChild(a);
  }

 function mountRightPanel(panel, rawItems) {
  if (!panel) return;

  let items = normalizeItems(rawItems).filter(isRenderableItem);

  const desired = isMobile() ? MOBILE_RIGHT_LIMIT : DESKTOP_RIGHT_LIMIT;
  const existingCards = qsa('.ad-box', panel).length;
  const limit = existingCards > 0 ? Math.min(existingCards, desired) : desired;

  // ✅ fallback (핵심)
  while(items.length < limit){
    items.push(makeSocialDummy('right', items.length));
  }

  const renderItems = items.slice(0, limit);
  const cards = ensureRightCards(panel, limit);

  for (let i = 0; i < cards.length; i++) {
    const item = renderItems[i];
    if (item) paintRightCard(cards[i], item);
    else resetRightCard(cards[i]);
  }
}

  function callExistingRightRenderer(rawItems) {
    if (typeof window.__IGDC_RIGHTPANEL_RENDER !== 'function') return false;

    try {
      const items = normalizeItems(rawItems).filter(isRenderableItem).map(function (it) {
        return {
          title: pickTitle(it) || 'Item',
          link: pickUrl(it) || '#',
          url: pickUrl(it) || '#'
        };
      });

      if (!items.length) return false;

      window.__IGDC_RIGHTPANEL_RENDER(items);
      return true;
    } catch (e) {
      logError('right_renderer', e);
      return false;
    }
  }

  function runMain(sectionMap) {
    const targets = getMainTargets();
    STATE.mainKeys = targets.map(function (t) { return t.key; });

    targets.forEach(function (target) {

    const raw = sectionMap && sectionMap[target.key];
    const items = raw && raw.items ? raw.items : raw;

    mountMainGrid(target.el, items);
});
  }
function runRight(sectionMap) {
  const panel = document.getElementById('rightAutoPanel');
  if (!panel) return;

  const items = sectionMap.rightPanel || [];

  const renderedByExisting = callExistingRightRenderer(items);

  if (!renderedByExisting) {
    mountRightPanel(panel, items);
  }
}

async function run() {
  try {
    const snapshot = await loadSnapshot();

    // ✅ 핵심 구조 분리
    const { main, right } = getSections(snapshot);

    // ✅ 메인 렌더
    runMain(main);

    // ✅ 우측 패널 렌더
    runRight({
      rightPanel: right.rightPanel
    });

    STATE.rendered = true;
    window.__SOCIALNETWORK_AUTOMAP_V4_DONE__ = true;

  } catch (e) {
    logError('run', e);
  }
}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSocialAutomap);
} else {
  initSocialAutomap();
}