(function () {
  'use strict';

  if (window.__SOCIALNETWORK_AUTOMAP_V4_REBUILT__) return;
  window.__SOCIALNETWORK_AUTOMAP_V4_REBUILT__ = true;

  const SNAPSHOT_URL = '/data/social.snapshot.json';
  const MAIN_LIMIT = 100;
  const RIGHT_LIMIT = 100;
  const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  // HTML 실제 메인 9섹션 순서 기준 정본
  const MAIN_SECTION_ORDER = [
    'social-youtube',
    'social-instagram',
    'social-tiktok',
    'social-facebook',
    'social-wechat',
    'social-weibo',
    'social-pinterest',
    'social-reddit',
    'social-twitter'
  ];

  const RIGHT_SECTION_KEY = 'socialnetwork';

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function safeText(v) {
    return v == null ? '' : String(v);
  }

  function safeUrl(v) {
    const s = safeText(v).trim();
    if (!s) return '#';
    if (/^javascript:/i.test(s)) return '#';
    return s;
  }

  function pickTitle(it) {
    return safeText(
      it && (
        it.title ||
        it.name ||
        it.text ||
        it.label ||
        it.caption
      )
    ).trim();
  }

  function pickUrl(it) {
    return safeUrl(
      it && (
        it.url ||
        it.href ||
        it.link ||
        it.detailUrl ||
        it.productUrl
      )
    );
  }

  function pickThumb(it) {
    const media = (it && typeof it.media === 'object') ? it.media : null;
    const preview = media && typeof media.preview === 'object' ? media.preview : null;

    const thumb = safeText(
      it && (
        it.thumb ||
        it.image ||
        it.img ||
        it.thumbnail ||
        it.imageUrl ||
        it.thumbnailUrl ||
        it.cover ||
        it.poster
      )
    ).trim();

    if (thumb) return thumb;

    const nested = safeText(
      preview && (
        preview.poster ||
        preview.thumbnail ||
        preview.image
      )
    ).trim();

    return nested || '';
  }

  function pickPlatform(it) {
    const src = (it && typeof it.source === 'object') ? it.source : null;
    return safeText(
      src && (
        src.platform ||
        src.site ||
        src.provider ||
        src.name
      )
    ).trim();
  }

  function isPlaceholderItem(it) {
    if (!it || typeof it !== 'object') return true;

    const type = safeText(it.type).trim().toLowerCase();
    const title = pickTitle(it);
    const url = pickUrl(it);
    const thumb = pickThumb(it);
    const platform = pickPlatform(it).toLowerCase();
    const origin = safeText(it?.audit?.origin).trim().toLowerCase();

    if (type === 'placeholder') return true;
    if (origin === 'placeholder_seed') return true;
    if (platform === 'placeholder') return true;
    if (title === 'Loading…' || title === 'Loading...' || title === 'Loading') return true;
    if (url === '#' && (!thumb || thumb === BLANK_GIF)) return true;

    return false;
  }

  function normalizeItem(it, idx, sectionKey) {
    if (!it || typeof it !== 'object') return null;

    return {
      id: safeText(it.id || it.uid || `${sectionKey}-${idx + 1}`),
      title: pickTitle(it) || 'Item',
      url: pickUrl(it),
      thumb: pickThumb(it),
      platform: pickPlatform(it),
      raw: it
    };
  }

  function normalizeList(rawList, sectionKey, limit) {
    const src = Array.isArray(rawList) ? rawList : [];
    const out = [];

    for (let i = 0; i < src.length; i++) {
      const raw = src[i];
      if (isPlaceholderItem(raw)) continue;
      const norm = normalizeItem(raw, i, sectionKey);
      if (!norm) continue;
      out.push(norm);
      if (out.length >= limit) break;
    }

    return out;
  }

  function buildSnapshotAccessor(snapshot) {
    const page = snapshot && snapshot.pages && snapshot.pages.social ? snapshot.pages.social : {};
    const pageSections = page && page.sections && typeof page.sections === 'object' ? page.sections : {};

    return {
      page,
      sections: pageSections,
      get(sectionKey) {
        const value = pageSections[sectionKey];
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object' && Array.isArray(value.items)) return value.items;
        return [];
      }
    };
  }

  async function loadSnapshot() {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('snapshot_load_failed:' + res.status);
    return res.json();
  }

  function findMainContainerByKey(key) {
    const direct = qs('[data-psom-key="' + key + '"]');
    if (direct) return direct;

    const all = qsa('[data-psom-key]');
    for (const el of all) {
      if ((el.dataset.psomKey || '') === key) return el;
    }

    return null;
  }

  function findMainContainerByRow(rowIndex) {
    return qs('#rowGrid' + rowIndex);
  }

  function resolveMainContainer(key, rowIndex) {
    return findMainContainerByKey(key) || findMainContainerByRow(rowIndex);
  }

  function clearNode(el) {
    if (el) el.innerHTML = '';
  }

  function makeMainCard(item) {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = item.url || '#';
    a.target = item.url && item.url !== '#' ? '_blank' : '_self';
    a.rel = 'noopener';

    const pic = document.createElement('div');
    pic.className = 'pic';
    if (item.thumb) {
      pic.textContent = '';
      pic.style.backgroundImage = "url('" + item.thumb.replace(/'/g, '%27') + "')";
      pic.style.backgroundSize = 'cover';
      pic.style.backgroundPosition = 'center';
    } else {
      pic.textContent = '•';
      pic.style.backgroundImage = '';
    }

    const meta = document.createElement('div');
    meta.className = 'meta';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title || 'Item';

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = item.platform || ' ';

    const cta = document.createElement('span');
    cta.className = 'cta';
    cta.textContent = 'Open';

    meta.appendChild(title);
    meta.appendChild(desc);
    meta.appendChild(cta);

    a.appendChild(pic);
    a.appendChild(meta);

    return a;
  }

  function renderMainSection(container, items) {
    if (!container) return;
    clearNode(container);

    const frag = document.createDocumentFragment();
    const list = Array.isArray(items) ? items : [];

    for (let i = 0; i < list.length; i++) {
      frag.appendChild(makeMainCard(list[i]));
    }

    container.appendChild(frag);
  }

  function makeRightCard(item) {
    const box = document.createElement('div');
    box.className = 'ad-box';

    const link = document.createElement('a');
    link.href = item.url || '#';
    link.target = item.url && item.url !== '#' ? '_blank' : '_self';
    link.rel = 'noopener';
    link.style.display = 'block';
    link.style.height = '100%';
    link.style.textDecoration = 'none';
    link.style.color = 'inherit';

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.height = '100%';
    wrap.style.alignItems = 'stretch';
    wrap.style.justifyContent = 'flex-start';

    const media = document.createElement('div');
    media.style.height = '94px';
    media.style.background = '#f5f5f5 center/cover no-repeat';
    if (item.thumb) media.style.backgroundImage = "url('" + item.thumb.replace(/'/g, '%27') + "')";

    const title = document.createElement('div');
    title.style.padding = '8px 10px 4px';
    title.style.fontSize = '.85rem';
    title.style.fontWeight = '700';
    title.style.lineHeight = '1.25';
    title.textContent = item.title || 'Item';

    const meta = document.createElement('div');
    meta.style.padding = '0 10px 8px';
    meta.style.fontSize = '.75rem';
    meta.style.color = '#666';
    meta.textContent = item.platform || ' '; 

    wrap.appendChild(media);
    wrap.appendChild(title);
    wrap.appendChild(meta);
    link.appendChild(wrap);
    box.appendChild(link);

    return box;
  }

  function renderRightPanel(panel, items) {
    if (!panel) return;
    clearNode(panel);

    const frag = document.createDocumentFragment();
    const list = Array.isArray(items) ? items : [];

    for (let i = 0; i < list.length; i++) {
      frag.appendChild(makeRightCard(list[i]));
    }

    panel.appendChild(frag);
  }

  function syncShadowRightBucket(items) {
    const shadow = qs('[data-psom-key="socialnetwork"]');
    if (!shadow) return;

    clearNode(shadow);
    const frag = document.createDocumentFragment();

    (Array.isArray(items) ? items : []).forEach((item) => {
      const a = document.createElement('a');
      a.className = 'thumb-card';
      a.href = item.url || '#';
      a.target = item.url && item.url !== '#' ? '_blank' : '_self';
      a.rel = 'noopener';

      const img = document.createElement('img');
      img.className = 'thumb-media';
      img.alt = item.title || '';
      img.src = item.thumb || BLANK_GIF;

      const t = document.createElement('div');
      t.className = 'thumb-title';
      t.textContent = item.title || 'Item';

      a.appendChild(img);
      a.appendChild(t);
      frag.appendChild(a);
    });

    shadow.appendChild(frag);
  }

  function renderMain(accessor) {
    for (let i = 0; i < MAIN_SECTION_ORDER.length; i++) {
      const key = MAIN_SECTION_ORDER[i];
      const mount = resolveMainContainer(key, i + 1);
      const items = normalizeList(accessor.get(key), key, MAIN_LIMIT);
      renderMainSection(mount, items);
    }
  }

  function renderRight(accessor) {
    const items = normalizeList(accessor.get(RIGHT_SECTION_KEY), RIGHT_SECTION_KEY, RIGHT_LIMIT);
    const panel = qs('#rightAutoPanel');
    renderRightPanel(panel, items);
    syncShadowRightBucket(items);

    if (typeof window.__IGDC_RIGHTPANEL_RENDER === 'function') {
      const bridged = items.map((item) => ({
        link: item.url,
        title: item.title,
        thumb: item.thumb,
        platform: item.platform
      }));
      try {
        window.__IGDC_RIGHTPANEL_RENDER(bridged);
      } catch (_e) {}
    }
  }

  async function run() {
    try {
      const snapshot = await loadSnapshot();
      const accessor = buildSnapshotAccessor(snapshot);
      renderMain(accessor);
      renderRight(accessor);
      window.__SOCIALNETWORK_AUTOMAP_V4_DONE__ = true;
    } catch (e) {
      console.error('[socialnetwork-automap.v4.rebuilt] fail', e);
    }
  }

  function boot() {
    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
