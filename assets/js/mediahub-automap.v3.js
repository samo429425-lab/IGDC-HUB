// mediahub-automap.v3.js (REBUILT FROM DISTRIBUTION SAMPLE - PRODUCTION SAFE)
// Rules (Chairman-defined):
// - HTML owns dummy placeholders (50 per section). Automap NEVER creates dummy cards.
// - If items exist: replace HTML placeholders in-place (slot-first).
// - If no items: do nothing (keep HTML dummy).
// - Mobile (<=1024): buttons hidden; native horizontal scroll used (handled in HTML/CSS).

(function () {
  'use strict';

  if (window.__MEDIAHUB_AUTOMAP_V3_REBUILT__) return;
  window.__MEDIAHUB_AUTOMAP_V3_REBUILT__ = true;

  const SNAPSHOT_URL = '/data/media.snapshot.json';
  const FEED_URL = '/.netlify/functions/feed-media';

  const LIMIT = 50;

  const SECTION_KEYS = [
    'media-trending',
    'media-movie',
    'media-drama',
    'media-thriller',
    'media-romance',
    'media-variety',
    'media-documentary',
    'media-animation',
    'media-music',
    'media-shorts'
  ];

  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function safeStr(v){ return (v === null || v === undefined) ? '' : String(v); }

  function pickTitle(it){
    return safeStr(it.title || it.name || it.text || it.caption || it.headline || '');
  }
  function pickThumb(it){
    return safeStr(it.thumb || it.thumbnail || it.image || it.poster || it.cover || it.thumbnailUrl || it.imageUrl || '');
  }
  function pickUrl(it){
    // allow video url too
    return safeStr(it.url || it.href || it.link || it.video || it.watchUrl || '');
  }
  function pickProvider(it){
    return safeStr(it.provider || it.source || it.channel || '');
  }

  function setCard(a, it){
    if (!a || !it) return;

    const title = pickTitle(it);
    const thumb = pickThumb(it);
    const url = pickUrl(it);
    const provider = pickProvider(it);

    // thumb
    const thumbDiv = qs('.thumb', a) || qs('.thumb-img', a);
    if (thumbDiv && thumb) {
      // supports both <div class="thumb"> and bg-image tiles
      thumbDiv.style.backgroundImage = "url('" + thumb.replace(/'/g, "%27") + "')";
      thumbDiv.classList.remove('ph');
    }

    // meta
    const metaDiv = qs('.meta', a) || qs('.thumb-title', a);
    if (metaDiv) {
      metaDiv.textContent = title || provider || metaDiv.textContent || '';
    }

    // href
    if (url) {
      a.setAttribute('href', url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }

    // mark as filled
    a.removeAttribute('data-placeholder');
    a.dataset.filled = '1';
  }

  function applySection(key, items){
    const box = qs('[data-psom-key="' + key + '"]');
    if (!box) return;

    const placeholders = qsa('a.media-card, a.card.media-card, a.card', box)
      .filter(a => (a.getAttribute('data-placeholder') === 'true') || (a.dataset && a.dataset.placeholder === 'true') || a.classList.contains('media-card'));

    if (!placeholders.length) return;

    const list = Array.isArray(items) ? items : [];
    const usable = list.slice(0, Math.min(LIMIT, placeholders.length));

    // If there is zero usable data, do nothing (keep HTML dummy)
    if (usable.length === 0) return;

    for (let i = 0; i < usable.length; i++){
      setCard(placeholders[i], usable[i]);
    }
  }

  async function fetchJson(url){
    try{
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    }catch(e){
      return null;
    }
  }

  async function loadSnapshot(){
    const snap = await fetchJson(SNAPSHOT_URL);
    return snap || null;
  }

  function snapshotToItems(snapshot, key){
    // supports: snapshot.sections[key].items | snapshot.sections[key].slots | snapshot.sections[key] as array
    const sec = snapshot && snapshot.sections && snapshot.sections[key];
    if (!sec) return [];
    if (Array.isArray(sec)) return sec;
    if (Array.isArray(sec.items)) return sec.items;
    if (Array.isArray(sec.slots)) {
      // slots -> items
      return sec.slots.map(s => ({
        title: s.title || '',
        thumb: s.thumb || '',
        url: (s.url || (s.outbound && (s.outbound.url || s.outbound.href || s.outbound.link)) || ''),
        provider: s.provider || ''
      }));
    }
    return [];
  }

  async function loadItemsForKey(key, snapshotCache){
    // 1) feed first
    const feed = await fetchJson(FEED_URL + '?key=' + encodeURIComponent(key));
    const feedItems = feed && Array.isArray(feed.items) ? feed.items : [];
    if (feedItems.length) return feedItems;

    // 2) snapshot fallback
    const snap = snapshotCache || await loadSnapshot();
    return snapshotToItems(snap, key);
  }

  (async function run(){
    try{
      const snapshotCache = await loadSnapshot(); // one-time cache (fast path)
      for (const key of SECTION_KEYS){
        const items = await loadItemsForKey(key, snapshotCache);
        applySection(key, items);
      }
      console.log('[MEDIA AUTOMAP] slot-first mapping applied');
    }catch(e){
      console.error('[MEDIA AUTOMAP] error', e);
    }
  })();

})();