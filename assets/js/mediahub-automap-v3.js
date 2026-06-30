/**
 * MediaHub automap v3.1 — slot-first rendering and ranked first section.
 *
 * Contract:
 * - Keep the existing 10 section DOM and its 50-slot rails.
 * - Build “Trending Now” from all nine category sections by actual metrics.
 * - Preserve source IDs, source URLs and metrics on cards for the in-page
 *   playback controller and revenue/engagement bridges.
 * - Never manufacture a content ID, thumbnail, view, like or watch value.
 */
(function () {
  'use strict';
  if (window.__MEDIAHUB_AUTOMAP_V31_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V31_PROD__ = true;

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
    trending_now:'media-trending', latest_movie:'media-movie', latest_drama:'media-drama',
    section_1:'media-thriller', section_2:'media-romance', section_3:'media-variety',
    section_4:'media-documentary', section_5:'media-animation', section_6:'media-music',
    section_7:'media-shorts'
  };

  function q(sel, root){ return (root || D).querySelector(sel); }
  function qa(sel, root){ return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }
  function text(value){ return value == null ? '' : String(value).trim(); }
  function number(value){ var n = Number(value); return Number.isFinite(n) ? n : 0; }
  function canonKey(key){ key = text(key); return key.indexOf('media-') === 0 ? key : (KEY_ALIAS[key] || key); }
  function isValue(value){
    value = text(value);
    return !!value && value !== '#' && !/^javascript:/i.test(value) && value !== 'about:blank';
  }
  function mediaUrl(item){ return text(item && (item.embedUrl || item.embed_url || item.video || item.videoUrl || item.video_url || item.url || item.link || item.href || item.source)); }
  function imageUrl(item){ return text(item && (item.thumbnail || item.thumb || item.image || item.imageUrl || item.image_url || item.thumbnailUrl || item.thumbnail_url)); }
  function contentId(item){ return text(item && (item.contentId || item.content_id || item.videoId || item.video_id || item.id || item._id || item.uid || item.slug)); }

  async function fetchJson(url){
    var response = await fetch(url, { cache:'no-store' });
    if(!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }
  async function loadSnapshotAny(){
    for(var i = 0; i < SNAPSHOT_URLS.length; i += 1){
      try { return await fetchJson(SNAPSHOT_URLS[i]); } catch (_) {}
    }
    return null;
  }
  async function loadFeedItems(key){
    try {
      var data = await fetchJson('/.netlify/functions/feed-media?key=' + encodeURIComponent(key) + '&limit=500');
      if(data && Array.isArray(data.items)) return data.items;
      if(data && Array.isArray(data.sections)){
        var found = data.sections.find(function(section){ return section && canonKey(section.key) === key; });
        if(found && Array.isArray(found.items)) return found.items;
      }
    } catch (_) {}
    return [];
  }
  function normalizeSectionMap(snapshot){
    var map = {};
    if(!snapshot || !snapshot.sections) return map;
    if(Array.isArray(snapshot.sections)){
      snapshot.sections.forEach(function(section){ if(section) map[canonKey(section.key)] = section; });
    } else if(typeof snapshot.sections === 'object') {
      Object.keys(snapshot.sections).forEach(function(key){ map[canonKey(key)] = snapshot.sections[key]; });
    }
    return map;
  }
  function normalizeItem(raw, sectionKey){
    if(raw && raw.__igdcMediaNormalized) return raw;
    raw = raw || {};
    var metrics = raw.metrics || raw.metric || {};
    return {
      __igdcMediaNormalized:true,
      id: contentId(raw),
      slotId: text(raw.slotId || raw.slot_id || raw.position || raw.index),
      title: text(raw.title || raw.name || raw.label || raw.text),
      thumbnail: imageUrl(raw),
      source: mediaUrl(raw),
      provider: text(raw.provider || raw.platform || raw.channel || raw.sourceProvider),
      description: text(raw.description || raw.summary || raw.excerpt),
      section: sectionKey || canonKey(raw.section || raw.psom_key || raw.psomKey),
      publishedAt: raw.publishedAt || raw.releaseDate || raw.createdAt || raw.date || '',
      views: number(raw.views != null ? raw.views : (raw.viewCount != null ? raw.viewCount : metrics.view)),
      clicks: number(raw.clicks != null ? raw.clicks : metrics.click),
      likes: number(raw.likes != null ? raw.likes : metrics.like),
      recommends: number(raw.recommendations != null ? raw.recommendations : (raw.recommends != null ? raw.recommends : (raw.recommend != null ? raw.recommend : metrics.recommend))),
      watchTime: number(raw.watchTime != null ? raw.watchTime : (raw.watch_time != null ? raw.watch_time : metrics.watchTime)),
      rating: number(raw.rating != null ? raw.rating : (raw.voteAverage != null ? raw.voteAverage : raw.score)),
      raw: raw
    };
  }
  function hasRealContent(item){
    return !!(item && (item.id || item.title || isValue(item.thumbnail) || isValue(item.source)));
  }
  function extractItems(section, sectionKey){
    if(!section) return [];
    var items = Array.isArray(section) ? section : (Array.isArray(section.items) ? section.items : (Array.isArray(section.slots) ? section.slots : []));
    return items.map(function(item){ return normalizeItem(item, sectionKey); }).filter(hasRealContent);
  }
  function getContainer(line){ return q(':scope > .scroll-content', line) || q('.scroll-content', line) || line; }
  function makePlaceholder(){
    var a = D.createElement('a');
    a.className = 'card media-card';
    a.href = 'javascript:void(0)';
    a.setAttribute('data-placeholder','true');
    a.setAttribute('data-igdc-media-card','1');
    var thumb = D.createElement('div'); thumb.className = 'thumb ph';
    var meta = D.createElement('div'); meta.className = 'meta'; meta.textContent = 'Coming Soon';
    a.appendChild(thumb); a.appendChild(meta);
    return a;
  }
  function ensurePlaceholders(line){
    var container = getContainer(line);
    var cards = qa(':scope > a.card', container);
    if(cards.length < LIMIT){
      var fragment = D.createDocumentFragment();
      for(var i = cards.length; i < LIMIT; i += 1) fragment.appendChild(makePlaceholder());
      container.appendChild(fragment);
      cards = qa(':scope > a.card', container);
    }
    return cards.slice(0, LIMIT);
  }
  function setData(a, name, value){
    if(value === '' || value == null) delete a.dataset[name]; else a.dataset[name] = String(value);
  }
  function fillAnchor(anchor, item, lineKey){
    anchor.href = 'javascript:void(0)';
    anchor.classList.add('media-card');
    anchor.setAttribute('data-igdc-media-card','1');
    anchor.removeAttribute('data-placeholder');
    setData(anchor, 'igdcContentId', item.id);
    setData(anchor, 'contentId', item.id);
    setData(anchor, 'itemId', item.id);
    setData(anchor, 'mediaSource', item.source);
    setData(anchor, 'mediaTitle', item.title);
    setData(anchor, 'title', item.title);
    setData(anchor, 'mediaDescription', item.description);
    setData(anchor, 'mediaSection', item.section || lineKey);
    setData(anchor, 'psomKey', item.section || lineKey);
    setData(anchor, 'slotId', item.slotId);
    setData(anchor, 'provider', item.provider);
    setData(anchor, 'views', item.views);
    setData(anchor, 'clicks', item.clicks);
    setData(anchor, 'likes', item.likes);
    setData(anchor, 'recommends', item.recommends);
    setData(anchor, 'watchTime', item.watchTime);
    if(item.id) anchor.setAttribute('data-maru-revenue','media'); else anchor.removeAttribute('data-maru-revenue');
    anchor.setAttribute('aria-label', item.title || 'Media content');

    var thumb = q('.thumb', anchor);
    if(!thumb){ thumb = D.createElement('div'); thumb.className = 'thumb'; anchor.insertBefore(thumb, anchor.firstChild); }
    var existingImg = q('img', thumb);
    if(isValue(item.thumbnail)){
      var img = existingImg || D.createElement('img');
      img.loading = 'lazy'; img.alt = item.title || ''; img.src = item.thumbnail;
      if(!existingImg) thumb.appendChild(img);
      thumb.classList.remove('ph');
    } else {
      if(existingImg) existingImg.remove();
      thumb.classList.add('ph');
    }
    var meta = q('.meta', anchor);
    if(!meta){ meta = D.createElement('div'); meta.className = 'meta'; anchor.appendChild(meta); }
    meta.textContent = item.title || 'Coming Soon';
  }
  function applyLine(line, items, key){
    var cards = ensurePlaceholders(line);
    for(var i = 0; i < cards.length; i += 1){
      if(items && items[i]) fillAnchor(cards[i], items[i], key);
      else {
        cards[i].setAttribute('data-igdc-media-card','1');
        cards[i].href = 'javascript:void(0)';
      }
    }
  }
  function recencyScore(item){
    var time = Date.parse(item.publishedAt || '');
    if(!Number.isFinite(time)) return 0;
    var days = Math.max(0, (Date.now() - time) / 86400000);
    return Math.max(0, 30 - days) / 30;
  }
  function rankScore(item){
    return (
      item.views +
      item.clicks * 1.5 +
      item.likes * 2 +
      item.recommends * 3 +
      Math.min(item.watchTime, 86400) / 60 * 0.25 +
      item.rating * 10 +
      recencyScore(item) * 5
    );
  }
  function rankedTrending(sectionMap){
    var seen = new Set();
    var merged = [];
    CATEGORY_KEYS.forEach(function(key){
      extractItems(sectionMap[key], key).forEach(function(item){
        var identity = item.id || item.source || (item.title + '|' + item.thumbnail);
        if(!identity || seen.has(identity)) return;
        seen.add(identity);
        merged.push(item);
      });
    });
    merged.sort(function(a, b){
      var byScore = rankScore(b) - rankScore(a);
      if(byScore) return byScore;
      return String(a.title).localeCompare(String(b.title));
    });
    return merged.slice(0, LIMIT);
  }
  async function hydrateCategory(sectionMap, key){
    var items = extractItems(sectionMap[key], key);
    if(!items.length){
      var feed = await loadFeedItems(key);
      items = feed.map(function(item){ return normalizeItem(item, key); }).filter(hasRealContent);
    }
    sectionMap[key] = { items:items };
    return items;
  }
  async function applyHero(snapshot, sectionMap){
    var heroImg = q('.hero img');
    if(!heroImg) return;
    var hero = snapshot && snapshot.hero || {};
    var keys = hero.rotateFrom || hero.source || [];
    if(!Array.isArray(keys)) keys = [keys];
    for(var i = 0; i < keys.length; i += 1){
      var items = extractItems(sectionMap[canonKey(keys[i])], canonKey(keys[i]));
      if(items[0] && isValue(items[0].thumbnail)){ heroImg.src = items[0].thumbnail; return; }
    }
  }
  async function main(){
    var lines = qa('.thumb-line[data-psom-key]');
    if(!lines.length) return;
    lines.forEach(ensurePlaceholders);
    var snapshot = await loadSnapshotAny();
    var sectionMap = normalizeSectionMap(snapshot);
    /* Load the same nine source sections before ranking the first rail. */
    await Promise.all(CATEGORY_KEYS.map(function(key){ return hydrateCategory(sectionMap, key); }));
    var trending = rankedTrending(sectionMap);
    sectionMap['media-trending'] = { items: trending };
    await applyHero(snapshot, sectionMap);
    for(var i = 0; i < lines.length; i += 1){
      var line = lines[i];
      var key = canonKey(line.getAttribute('data-psom-key'));
      if(!key || key.indexOf('media-') !== 0 || key === 'media-hero') continue;
      var items = key === 'media-trending' ? trending : extractItems(sectionMap[key], key);
      applyLine(line, items, key);
    }
  }
  if(D.readyState === 'loading') D.addEventListener('DOMContentLoaded', main, { once:true }); else main();
})();

/* Preserve the existing non-cash revenue tracking loader. */
(function loadMaruRevenueAutoHookForAutomap(){
  'use strict';
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  function install(){
    try { if(window.MaruRevenueAutoHook && typeof window.MaruRevenueAutoHook.install === 'function') window.MaruRevenueAutoHook.install({ service:'front-automap' }); } catch (_) {}
  }
  function load(src, id, globalName, done){
    if(window[globalName]) { done(); return; }
    var tag = document.getElementById(id);
    if(tag){ tag.addEventListener('load', done, { once:true }); return; }
    tag = document.createElement('script'); tag.id = id; tag.src = src; tag.async = false; tag.onload = done; (document.head || document.documentElement).appendChild(tag);
  }
  load('/assets/js/maru-revenue-tracker.js', 'maruRevenueTrackerScript', 'MaruRevenueTracker', function(){
    load('/assets/js/maru-revenue-autohook.js', 'maruRevenueAutoHookScript', 'MaruRevenueAutoHook', install);
  });
})();
