/**
 * mediahub-automap.v3.js (SAFE)
 * ------------------------------------------------------------
 * Goals:
 *  - HARD scope: runs only on mediahub page (requires .thumb-line[data-psom-key]).
 *  - Data source priority:
 *      1) /data/media.snapshot.json  (existing snapshot)
 *      2) /.netlify/functions/feed-media?key=<sectionKey>&limit=200  (new feed convention)
 *      3) /.netlify/functions/media-feed?key=<sectionKey>&limit=200  (legacy feed name fallback)
 *  - FAIL-SAFE:
 *      - If data missing/empty: keep original DOM (do NOT clear).
 *      - Replace only placeholder anchors marked data-placeholder="true".
 */
(function () {
  'use strict';
  if (window.__MEDIAHUB_AUTOMAP_V3_SAFE__) return;
  window.__MEDIAHUB_AUTOMAP_V3_SAFE__ = true;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // HARD scope guard
  function hasMediaSlots(){
    try { return !!document.querySelector('.thumb-line[data-psom-key]'); } catch(e){ return false; }
  }
  if (!hasMediaSlots()) return;

  var SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/assets/data/media.snapshot.json',
    'data/media.snapshot.json'
  ];

  function isNonEmpty(v) { return typeof v === 'string' ? v.trim().length > 0 : !!v; }

  function isRealItem(it) {
    if (!it || typeof it !== 'object') return false;
    return isNonEmpty(it.thumbnail) || isNonEmpty(it.poster) || isNonEmpty(it.preview) || isNonEmpty(it.title) || isNonEmpty(it.video);
  }

  async function fetchJson(url) {
    var res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
  }

  async function loadSnapshot() {
    var lastErr = null;
    for (var i = 0; i < SNAPSHOT_URLS.length; i++) {
      try {
        var data = await fetchJson(SNAPSHOT_URLS[i]);
        window.__MEDIAHUB_SNAPSHOT_URL__ = SNAPSHOT_URLS[i];
        return data;
      } catch (e) { lastErr = e; }
    }
    return null;
  }

  async function loadFeedSection(sectionKey){
    var urls = [
      '/.netlify/functions/feed-media?key=' + encodeURIComponent(sectionKey) + '&limit=200',
      '/.netlify/functions/media-feed?key=' + encodeURIComponent(sectionKey) + '&limit=200'
    ];
    for (var i=0; i<urls.length; i++){
      try{
        var d = await fetchJson(urls[i]);
        if (d && Array.isArray(d.items)) return d.items;
      }catch(e){}
    }
    return null;
  }

  function getLine(sectionKey) {
    return q('.thumb-line[data-psom-key="' + sectionKey + '"]');
  }

  function applyIntoCardAnchor(a, item) {
    a.dataset.maruReal = '1';
    if (a.hasAttribute('data-placeholder')) a.removeAttribute('data-placeholder');

    var href = (item && item.video) ? String(item.video) : 'javascript:void(0)';
    a.setAttribute('href', href);
    if (item && item.video) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    } else {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }

    var thumb = q('.thumb', a);
    if (!thumb) {
      thumb = document.createElement('div');
      thumb.className = 'thumb';
      a.insertBefore(thumb, a.firstChild);
    }
    thumb.innerHTML = '';

    var imgUrl = (item && (item.thumbnail || item.poster || item.preview)) ? (item.thumbnail || item.poster || item.preview) : '';
    if (isNonEmpty(imgUrl)) {
      var img = document.createElement('img');
      img.src = imgUrl;
      img.alt = (item && item.title) ? String(item.title) : '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      var ph = document.createElement('div');
      ph.className = 'thumb ph';
      thumb.appendChild(ph);
    }

    var meta = q('.meta', a);
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'meta';
      a.appendChild(meta);
    }
    meta.textContent = (item && item.title) ? String(item.title) : '';
  }

  function showAllPlaceholders(line) {
    qa('a.card.media-card[data-placeholder="true"]', line).forEach(function(a){
      a.style.display = '';
    });
  }

  function hideUnusedPlaceholders(line, usedCount) {
    var cards = qa('a.card.media-card', line);
    for (var i = usedCount; i < cards.length; i++) {
      if (cards[i].getAttribute('data-placeholder') === 'true') cards[i].style.display = 'none';
    }
  }

  function renderSection(line, items) {
    if (!line) return false;

    var list = Array.isArray(items) ? items : [];
    var realItems = [];
    for (var i = 0; i < list.length; i++) {
      if (isRealItem(list[i])) realItems.push(list[i]);
    }

    // FAIL-SAFE: no real items -> keep placeholders (do NOT clear)
    if (realItems.length === 0) {
      showAllPlaceholders(line);
      return false;
    }

    var placeholders = qa('a.card.media-card[data-placeholder="true"]', line);
    var n = Math.min(realItems.length, placeholders.length);

    if (n === 0) return false;

    for (var j = 0; j < n; j++) applyIntoCardAnchor(placeholders[j], realItems[j]);
    hideUnusedPlaceholders(line, n);

    line.dataset.maruAutomap = '1';
    return true;
  }

  async function run() {
    // 1) snapshot (bulk)
    var snapshot = await loadSnapshot();

    // Collect html keys
    var htmlKeys = qa('.thumb-line[data-psom-key]').map(function(el){ return el.getAttribute('data-psom-key'); });

    // Build map from snapshot if possible
    var map = Object.create(null);
    if (snapshot && Array.isArray(snapshot.sections)) {
      for (var i = 0; i < snapshot.sections.length; i++) {
        var s = snapshot.sections[i];
        if (s && s.key) map[s.key] = s.items || [];
      }
    }

    // Render 1:1 (skip hero if present)
    for (var k = 0; k < htmlKeys.length; k++) {
      var key = htmlKeys[k];
      if (!key) continue;
      if (key === 'media-hero') continue;

      var line = getLine(key);

      // prefer snapshot section; if missing, try feed section
      var items = map[key];
      if (!Array.isArray(items)) items = null;

      if (!items) {
        var feedItems = await loadFeedSection(key);
        if (Array.isArray(feedItems)) items = feedItems;
      }

      // If still nothing -> keep DOM (do nothing)
      if (!items) continue;

      renderSection(line, items);
    }

    window.__MEDIAHUB_AUTOMAP_RAN__ = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      run().catch(function(e){ console.error('[mediahub-automap.v3] init failed:', e); });
    }, { once:true });
  } else {
    run().catch(function(e){ console.error('[mediahub-automap.v3] init failed:', e); });
  }
})();
