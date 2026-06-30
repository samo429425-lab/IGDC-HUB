/**
 * MediaHub AutoMap v3.3 — production slot pipeline recovery
 * -----------------------------------------------------------
 * Scope:
 * - Preserves the current MediaHub screen/player structure.
 * - Restores the original snapshot -> fixed slot -> thumbnail-card pipeline.
 * - Retains the nine-category ranked first section.
 * - Never removes a reserved slot or manufactures content data.
 */
(function () {
  'use strict';

  if (window.__MEDIAHUB_AUTOMAP_V33_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V33_PROD__ = true;

  var D = document;
  var LIMIT = 50;

  var SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/data/media.snapshot.v6.keys.json',
    '/data/media.snapshot.v5.slots.json',
    '/data/media.snapshot.v4.ott.full.json'
  ];

  var CATEGORY_KEYS = [
    'media-movie', 'media-drama', 'media-thriller', 'media-romance',
    'media-variety', 'media-documentary', 'media-animation', 'media-music',
    'media-shorts'
  ];

  var KEY_ALIAS = {
    'trending_now': 'media-trending',
    'latest_movie': 'media-movie',
    'latest_drama': 'media-drama',
    'section_1': 'media-thriller',
    'section_2': 'media-romance',
    'section_3': 'media-variety',
    'section_4': 'media-documentary',
    'section_5': 'media-animation',
    'section_6': 'media-music',
    'section_7': 'media-shorts'
  };

  function q(sel, root){ return (root || D).querySelector(sel); }
  function qa(sel, root){ return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }
  function text(value){ return value == null ? '' : String(value).trim(); }
  function number(value){ var n = Number(value); return Number.isFinite(n) ? n : 0; }

  function canonKey(key){
    key = text(key);
    if (!key) return '';
    return key.indexOf('media-') === 0 ? key : (KEY_ALIAS[key] || key);
  }

  function isUsableUrl(value){
    value = text(value);
    return !!value && value !== '#' && !/^javascript:/i.test(value) && value !== 'about:blank';
  }

  function slotIdOf(item){
    return text(item && (item.slotId || item.slot_id || item.position || item.index));
  }

  function rawSourceOf(item){
    return text(item && (
      item.video || item.streamUrl || item.stream_url || item.embedUrl || item.embed_url ||
      item.url || item.link || item.href || item.source
    ));
  }

  function thumbnailOf(item){
    return text(item && (
      item.thumbnail || item.thumb || item.image || item.imageUrl || item.image_url ||
      item.thumbnailUrl || item.thumbnail_url
    ));
  }

  function titleOf(item){
    return text(item && (item.title || item.name || item.label || item.text));
  }

  function rawContentIdOf(item){
    return text(item && (
      item.contentId || item.content_id || item.id || item._id ||
      item.videoId || item.video_id || item.uid || item.slug
    ));
  }

  function metricsOf(item){
    return (item && (item.metrics || item.metric) && typeof (item.metrics || item.metric) === 'object')
      ? (item.metrics || item.metric)
      : {};
  }

  function metric(item, names){
    var metrics = metricsOf(item);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      if (metrics[name] != null) return number(metrics[name]);
      if (item && item[name] != null) return number(item[name]);
    }
    return 0;
  }

  /*
   * A slot record is always retained as a stable target.  Rendering is
   * intentionally decided separately so empty reservation slots do not erase
   * the existing HTML placeholder/sample card.
   */
  function normalizeItem(raw, sectionKey, order){
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      raw: raw,
      section: sectionKey,
      order: order,
      slotId: slotIdOf(raw),
      contentId: rawContentIdOf(raw),
      title: titleOf(raw),
      thumbnail: thumbnailOf(raw),
      source: rawSourceOf(raw),
      provider: text(raw.provider || raw.platform || raw.channel || raw.sourceProvider),
      description: text(raw.description || raw.summary || raw.excerpt),
      publishedAt: raw.publishedAt || raw.releaseDate || raw.createdAt || raw.date || '',
      views: metric(raw, ['view', 'views', 'viewCount']),
      clicks: metric(raw, ['click', 'clicks']),
      likes: metric(raw, ['like', 'likes']),
      recommends: metric(raw, ['recommend', 'recommends', 'recommendations']),
      watchTime: metric(raw, ['watchTime', 'watchSeconds', 'watch_time']),
      rating: metric(raw, ['rating', 'voteAverage', 'score', 'popularity'])
    };
  }

  function hasPresentation(item){
    return !!(item && (
      item.contentId ||
      item.title ||
      isUsableUrl(item.thumbnail) ||
      isUsableUrl(item.source)
    ));
  }

  async function fetchJson(url){
    var response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  async function loadSnapshotAny(){
    for (var i = 0; i < SNAPSHOT_URLS.length; i += 1) {
      try { return await fetchJson(SNAPSHOT_URLS[i]); } catch (_) {}
    }
    return null;
  }

  function normalizeSectionMap(snapshot){
    var map = {};
    if (!snapshot || !snapshot.sections) return map;

    if (Array.isArray(snapshot.sections)) {
      snapshot.sections.forEach(function(section){
        if (section) map[canonKey(section.key)] = section;
      });
    } else if (typeof snapshot.sections === 'object') {
      Object.keys(snapshot.sections).forEach(function(key){
        map[canonKey(key)] = snapshot.sections[key];
      });
    }
    return map;
  }

  function sectionRecords(section, key){
    if (!section) return [];
    var records = Array.isArray(section)
      ? section
      : (Array.isArray(section.items) ? section.items : (Array.isArray(section.slots) ? section.slots : []));
    return records.map(function(record, index){ return normalizeItem(record, key, index); });
  }

  async function loadFeedItems(key){
    try {
      var data = await fetchJson('/.netlify/functions/feed-media?key=' + encodeURIComponent(key) + '&limit=500');
      if (data && Array.isArray(data.items)) return data.items;
      if (data && Array.isArray(data.sections)) {
        var found = data.sections.find(function(section){
          return section && canonKey(section.key) === key;
        });
        if (found && Array.isArray(found.items)) return found.items;
      }
    } catch (_) {}
    return [];
  }

  function getContainer(line){
    return q('.scroll-content', line) || line;
  }

  function makePlaceholder(){
    var anchor = D.createElement('a');
    anchor.className = 'card media-card';
    anchor.href = 'javascript:void(0)';
    anchor.setAttribute('data-placeholder', 'true');

    var thumb = D.createElement('div');
    thumb.className = 'thumb ph';
    var meta = D.createElement('div');
    meta.className = 'meta';
    meta.textContent = 'Coming Soon';

    anchor.appendChild(thumb);
    anchor.appendChild(meta);
    return anchor;
  }

  function ensureSlotCards(line, key){
    var container = getContainer(line);
    var cards = qa('a.card', container);

    if (cards.length < LIMIT) {
      var fragment = D.createDocumentFragment();
      for (var i = cards.length; i < LIMIT; i += 1) fragment.appendChild(makePlaceholder());
      container.appendChild(fragment);
      cards = qa('a.card', container);
    }

    cards = cards.slice(0, LIMIT);
    cards.forEach(function(card, index){
      if (!card.dataset.mediaSlotId) card.dataset.mediaSlotId = String(index + 1);
      card.dataset.mediaSection = key;
      card.dataset.psomKey = key;
      card.setAttribute('data-igdc-media-card', '1');
    });

    return cards;
  }

  function stableContentId(item){
    if (!item || !hasPresentation(item)) return '';
    return item.contentId || '';
  }

  function setData(card, name, value){
    if (value === '' || value == null) delete card.dataset[name];
    else card.dataset[name] = String(value);
  }

  function clearLegacyClick(card){
    try { card.onclick = null; } catch (_) {}
  }

  function fillCard(card, item, key, slotId){
    var contentId = stableContentId(item);
    var source = item.source;
    var thumbUrl = item.thumbnail;
    var title = item.title || 'Coming Soon';

    clearLegacyClick(card);
    card.classList.add('media-card');
    card.removeAttribute('data-placeholder');
    card.dataset.mediaSlotId = String(slotId);
    card.dataset.mediaSection = key;
    card.dataset.psomKey = key;

    setData(card, 'igdcContentId', contentId);
    setData(card, 'contentId', contentId);
    setData(card, 'itemId', contentId);
    setData(card, 'mediaId', contentId);
    setData(card, 'mediaSource', source);
    setData(card, 'mediaTitle', item.title);
    setData(card, 'title', item.title);
    setData(card, 'mediaDescription', item.description);
    setData(card, 'provider', item.provider);
    setData(card, 'views', item.views);
    setData(card, 'clicks', item.clicks);
    setData(card, 'likes', item.likes);
    setData(card, 'recommends', item.recommends);
    setData(card, 'watchTime', item.watchTime);
    setData(card, 'mediaViews', item.views);
    setData(card, 'mediaClicks', item.clicks);
    setData(card, 'mediaWatchSeconds', item.watchTime);
    setData(card, 'maruRevenue', contentId ? 'media' : '');
    setData(card, 'revenueLine', contentId ? 'media_watchtime' : '');
    setData(card, 'itemType', 'media');

    /*
     * The current in-page playback controller captures clicks.  Keep the
     * original watch route available for non-JS navigation and accessibility.
     */
    card.href = contentId
      ? ('/media/watch.html?id=' + encodeURIComponent(contentId))
      : 'javascript:void(0)';
    card.removeAttribute('target');
    card.removeAttribute('rel');
    card.setAttribute('aria-label', item.title || 'Media content');

    var thumb = q('.thumb', card);
    if (!thumb) {
      thumb = D.createElement('div');
      thumb.className = 'thumb';
      card.insertBefore(thumb, card.firstChild);
    }

    var image = q('img', thumb);
    if (isUsableUrl(thumbUrl)) {
      if (!image) {
        image = D.createElement('img');
        image.loading = 'lazy';
        thumb.appendChild(image);
      }
      image.alt = item.title || '';
      image.src = thumbUrl;
      thumb.classList.remove('ph');
    } else {
      if (image) image.remove();
      thumb.classList.add('ph');
    }

    var meta = q('.meta', card);
    if (!meta) {
      meta = D.createElement('div');
      meta.className = 'meta';
      card.appendChild(meta);
    }
    meta.textContent = title;
    card.dataset.igdcAutomapFilled = '1';
  }

  /*
   * Reserved snapshot slots are never filtered out.  Only records that carry
   * presentable content update a card.  Empty reservations leave the existing
   * sample/placeholder card intact and remain ready for automatic replacement.
   */
  function applySlotItems(cards, items, key){
    var bySlot = {};
    cards.forEach(function(card){ bySlot[String(card.dataset.mediaSlotId)] = card; });

    var available = cards.slice();
    var used = {};
    function takeSequential(){
      while (available.length) {
        var candidate = available.shift();
        if (!used[candidate.dataset.mediaSlotId]) return candidate;
      }
      return null;
    }

    items.forEach(function(item){
      if (!hasPresentation(item)) return;
      var requested = text(item.slotId);
      var target = requested && bySlot[requested] && !used[requested] ? bySlot[requested] : null;
      if (!target) target = takeSequential();
      if (!target) return;
      var resolvedSlot = String(target.dataset.mediaSlotId);
      used[resolvedSlot] = true;
      fillCard(target, item, key, resolvedSlot);
    });
  }

  async function resolveSection(sectionMap, key){
    var reservations = sectionRecords(sectionMap[key], key);
    var visible = reservations.filter(hasPresentation);

    /*
     * A snapshot containing only empty reservation records must not suppress
     * the live feed fallback.  The reservations remain fixed targets while
     * feed content is injected into those targets.
     */
    if (!visible.length) {
      var feed = await loadFeedItems(key);
      visible = feed.map(function(item, index){ return normalizeItem(item, key, index); }).filter(hasPresentation);
    }
    return visible;
  }

  function recencyScore(item){
    var timestamp = Date.parse(item.publishedAt || '');
    if (!Number.isFinite(timestamp)) return 0;
    var days = Math.max(0, (Date.now() - timestamp) / 86400000);
    return Math.max(0, 30 - days) / 30;
  }

  function rankScore(item){
    return (
      number(item.views) +
      number(item.clicks) * 1.5 +
      number(item.likes) * 2 +
      number(item.recommends) * 3 +
      Math.min(number(item.watchTime), 86400) / 60 * 0.25 +
      number(item.rating) * 10 +
      recencyScore(item) * 5
    );
  }

  function rankedTrending(categoryMap){
    var seen = {};
    var merged = [];
    CATEGORY_KEYS.forEach(function(key){
      (categoryMap[key] || []).forEach(function(item){
        var identity = item.contentId || item.source || (item.title + '|' + item.thumbnail + '|' + item.slotId);
        if (!identity || seen[identity]) return;
        seen[identity] = true;
        merged.push(item);
      });
    });

    merged = merged.map(function(item, index){
      item._rankIndex = index;
      return item;
    });

    merged.sort(function(a, b){
      var difference = rankScore(b) - rankScore(a);
      return difference || (a._rankIndex - b._rankIndex);
    });

    return merged.slice(0, LIMIT);
  }

  async function applyHero(snapshot, categoryMap){
    var heroImg = q('.hero img');
    if (!heroImg) return;
    var hero = snapshot && snapshot.hero || {};
    var keys = hero.rotateFrom || hero.source || [];
    if (!Array.isArray(keys)) keys = [keys];

    for (var i = 0; i < keys.length; i += 1) {
      var sourceItems = categoryMap[canonKey(keys[i])] || [];
      var first = sourceItems.find(function(item){ return isUsableUrl(item.thumbnail); });
      if (first) {
        heroImg.src = first.thumbnail;
        return;
      }
    }
  }

  async function main(){
    var lines = qa('.thumb-line[data-psom-key]');
    if (!lines.length) return;

    var snapshot = await loadSnapshotAny();
    var sectionMap = normalizeSectionMap(snapshot);
    var categoryMap = {};

    await Promise.all(CATEGORY_KEYS.map(async function(key){
      categoryMap[key] = await resolveSection(sectionMap, key);
    }));

    var trending = rankedTrending(categoryMap);

    await applyHero(snapshot, categoryMap);

    lines.forEach(function(line){
      var key = canonKey(line.getAttribute('data-psom-key') || '');
      if (!key || key.indexOf('media-') !== 0 || key === 'media-hero') return;
      var cards = ensureSlotCards(line, key);
      var items = key === 'media-trending' ? trending : (categoryMap[key] || []);
      applySlotItems(cards, items, key);
    });
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', main, { once:true });
  else main();
})();

/*
 * Existing non-cash revenue tracking loader.  Rendering and slot allocation
 * above remain independent from revenue collection.
 */
(function loadMaruRevenueAutoHookForAutomap(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function install(){
    try {
      if (window.MaruRevenueAutoHook && typeof window.MaruRevenueAutoHook.install === 'function') {
        window.MaruRevenueAutoHook.install({ service:'front-automap' });
      }
    } catch (_) {}
  }

  function load(src, id, globalName, done){
    if (window[globalName]) { done(); return; }
    var tag = document.getElementById(id);
    if (tag) {
      tag.addEventListener('load', done, { once:true });
      return;
    }
    tag = document.createElement('script');
    tag.id = id;
    tag.src = src;
    tag.async = false;
    tag.onload = done;
    (document.head || document.documentElement).appendChild(tag);
  }

  load('/assets/js/maru-revenue-tracker.js', 'maruRevenueTrackerScript', 'MaruRevenueTracker', function(){
    load('/assets/js/maru-revenue-autohook.js', 'maruRevenueAutoHookScript', 'MaruRevenueAutoHook', install);
  });
})();
