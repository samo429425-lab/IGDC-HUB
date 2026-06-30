/**
 * MediaHub AutoMap v3.2 — snapshot slot contract preserving renderer
 * -------------------------------------------------------------------
 * Contract:
 * - /data/media.snapshot.json is the primary source of truth.
 * - Every snapshot slot remains a stable front slot target, including a
 *   replaceable preliminary/sample slot.
 * - A later real item must replace the same slot by contentId/slotId without
 *   changing the rail structure or discarding the receiving card.
 * - The first "trending" rail is derived from ranked, displayable items in
 *   the nine lower content sections; it never owns an independent inventory.
 */
(function(){
  'use strict';
  if(window.__MEDIAHUB_AUTOMAP_V3_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V3_PROD__ = true;

  var D = document;
  var LIMIT = 50;
  var SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/data/media.snapshot.v6.keys.json',
    '/data/media.snapshot.v5.slots.json',
    '/data/media.snapshot.v4.ott.full.json'
  ];
  var CATEGORY_KEYS = [
    'media-movie','media-drama','media-thriller','media-romance',
    'media-variety','media-documentary','media-animation','media-music',
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
  function isUsable(value){ value = text(value); return !!value && value !== '#' && value !== 'about:blank' && !/^javascript:/i.test(value); }
  function sourceOf(raw){
    raw = raw || {};
    var outbound = raw.outbound || {};
    return text(raw.video || raw.videoUrl || raw.video_url || raw.embedUrl || raw.embed_url || raw.url || raw.link || raw.href || outbound.url || outbound.link || outbound.href || raw.source);
  }
  function thumbOf(raw){ raw = raw || {}; return text(raw.thumbnail || raw.thumb || raw.image || raw.imageUrl || raw.image_url || raw.thumbnailUrl || raw.thumbnail_url || raw.poster); }
  function contentIdOf(raw){ raw = raw || {}; return text(raw.contentId || raw.content_id || raw.videoId || raw.video_id || raw.id || raw._id || raw.uid || raw.slug); }
  function titleOf(raw){ raw = raw || {}; return text(raw.title || raw.name || raw.label || raw.text); }
  function metricOf(raw, name){
    raw = raw || {}; var metrics = raw.metrics || raw.metric || {};
    if(name === 'views') return number(raw.views != null ? raw.views : (raw.viewCount != null ? raw.viewCount : (metrics.view != null ? metrics.view : metrics.views)));
    if(name === 'clicks') return number(raw.clicks != null ? raw.clicks : (metrics.click != null ? metrics.click : metrics.clicks));
    if(name === 'likes') return number(raw.likes != null ? raw.likes : (metrics.like != null ? metrics.like : metrics.likes));
    if(name === 'recommends') return number(raw.recommendations != null ? raw.recommendations : (raw.recommends != null ? raw.recommends : (raw.recommend != null ? raw.recommend : (metrics.recommend != null ? metrics.recommend : metrics.recommends))));
    if(name === 'watchTime') return number(raw.watchTime != null ? raw.watchTime : (raw.watch_time != null ? raw.watch_time : metrics.watchTime));
    if(name === 'priority') return number(raw.priority != null ? raw.priority : (raw.popularity != null ? raw.popularity : (raw.score != null ? raw.score : metrics.priority)));
    if(name === 'rating') return number(raw.rating != null ? raw.rating : (raw.voteAverage != null ? raw.voteAverage : metrics.rating));
    return 0;
  }

  function normalizeSlot(raw, sectionKey, ordinal){
    raw = raw || {};
    return {
      raw:raw,
      slotId:text(raw.slotId != null ? raw.slotId : (raw.slot_id != null ? raw.slot_id : (raw.position != null ? raw.position : (raw.index != null ? raw.index : ordinal + 1)))),
      id:contentIdOf(raw),
      title:titleOf(raw),
      thumbnail:thumbOf(raw),
      source:sourceOf(raw),
      provider:text(raw.provider || raw.platform || raw.channel || raw.sourceProvider),
      description:text(raw.description || raw.summary || raw.excerpt),
      section:sectionKey || canonKey(raw.section || raw.psom_key || raw.psomKey),
      publishedAt:raw.publishedAt || raw.releaseDate || raw.createdAt || raw.date || '',
      views:metricOf(raw,'views'), clicks:metricOf(raw,'clicks'), likes:metricOf(raw,'likes'), recommends:metricOf(raw,'recommends'), watchTime:metricOf(raw,'watchTime'), priority:metricOf(raw,'priority'), rating:metricOf(raw,'rating')
    };
  }
  function isDisplayable(item){ return !!(item && (item.id || item.title || isUsable(item.thumbnail) || isUsable(item.source))); }
  function normalizeSectionMap(snapshot){
    var map = {};
    if(!snapshot || !snapshot.sections) return map;
    if(Array.isArray(snapshot.sections)) snapshot.sections.forEach(function(section){ if(section) map[canonKey(section.key)] = section; });
    else if(typeof snapshot.sections === 'object') Object.keys(snapshot.sections).forEach(function(key){ map[canonKey(key)] = snapshot.sections[key]; });
    return map;
  }
  function slotsOf(section, sectionKey){
    if(!section) return [];
    var list = Array.isArray(section) ? section : (Array.isArray(section.slots) ? section.slots : (Array.isArray(section.items) ? section.items : []));
    return list.map(function(raw, index){ return normalizeSlot(raw, sectionKey, index); });
  }
  async function fetchJson(url){ var response = await fetch(url, { cache:'no-store' }); if(!response.ok) throw new Error('HTTP ' + response.status); return response.json(); }
  async function loadSnapshot(){
    for(var i = 0; i < SNAPSHOT_URLS.length; i += 1){ try { return await fetchJson(SNAPSHOT_URLS[i]); } catch(_){} }
    return null;
  }
  async function loadFeedSlots(key){
    try{
      var data = await fetchJson('/.netlify/functions/feed-media?key=' + encodeURIComponent(key) + '&limit=' + LIMIT);
      var list = data && Array.isArray(data.items) ? data.items : [];
      if(!list.length && data && Array.isArray(data.sections)){
        var section = data.sections.find(function(entry){ return entry && canonKey(entry.key) === key; });
        list = section && Array.isArray(section.items) ? section.items : [];
      }
      return list.map(function(raw,index){ return normalizeSlot(raw,key,index); });
    }catch(_){ return []; }
  }

  function cardContainer(line){ return q(':scope > .scroll-content', line) || q('.scroll-content', line) || line; }
  function makePlaceholder(){
    var a = D.createElement('a'); a.className = 'card media-card'; a.href = 'javascript:void(0)'; a.setAttribute('data-placeholder','true');
    var thumb = D.createElement('div'); thumb.className = 'thumb ph';
    var meta = D.createElement('div'); meta.className = 'meta'; meta.textContent = 'Coming Soon';
    a.appendChild(thumb); a.appendChild(meta); return a;
  }
  function ensureCards(line){
    var container = cardContainer(line);
    var cards = qa(':scope > a.card', container);
    if(cards.length < LIMIT){
      var fragment = D.createDocumentFragment();
      for(var i = cards.length; i < LIMIT; i += 1) fragment.appendChild(makePlaceholder());
      container.appendChild(fragment);
      cards = qa(':scope > a.card', container);
    }
    return cards.slice(0, LIMIT);
  }
  function setData(node, name, value){ if(value == null || value === '') delete node.dataset[name]; else node.dataset[name] = String(value); }
  function clearCard(card, key, ordinal){
    card.href = 'javascript:void(0)'; card.setAttribute('data-placeholder','true'); card.classList.add('media-card');
    setData(card,'mediaSlotId',ordinal + 1); setData(card,'slotId',ordinal + 1); setData(card,'mediaSection',key); setData(card,'psomKey',key);
    ['igdcContentId','contentId','itemId','mediaSource','mediaTitle','title','mediaDescription','provider','views','clicks','likes','recommends','watchTime'].forEach(function(name){ delete card.dataset[name]; });
    card.removeAttribute('data-media-id'); card.removeAttribute('data-maru-revenue'); card.removeAttribute('aria-label');
    var thumb = q('.thumb',card); if(!thumb){ thumb = D.createElement('div'); thumb.className = 'thumb'; card.insertBefore(thumb,card.firstChild); }
    var image = q('img',thumb); if(image) image.remove(); thumb.classList.add('ph');
    var meta = q('.meta',card); if(!meta){ meta = D.createElement('div'); meta.className='meta'; card.appendChild(meta); } meta.textContent = 'Coming Soon';
  }
  function fillCard(card, item, key, ordinal){
    if(!isDisplayable(item)){ clearCard(card,key,ordinal); return; }
    card.href = 'javascript:void(0)'; card.classList.add('media-card'); card.removeAttribute('data-placeholder');
    setData(card,'mediaSlotId',item.slotId || ordinal + 1); setData(card,'slotId',item.slotId || ordinal + 1); setData(card,'mediaSection',item.section || key); setData(card,'psomKey',item.section || key);
    setData(card,'igdcContentId',item.id); setData(card,'contentId',item.id); setData(card,'itemId',item.id);
    setData(card,'mediaSource',item.source); setData(card,'mediaTitle',item.title); setData(card,'title',item.title); setData(card,'mediaDescription',item.description); setData(card,'provider',item.provider);
    setData(card,'views',item.views); setData(card,'clicks',item.clicks); setData(card,'likes',item.likes); setData(card,'recommends',item.recommends); setData(card,'watchTime',item.watchTime);
    if(item.id) { card.setAttribute('data-media-id',item.id); card.setAttribute('data-maru-revenue','media'); }
    else { card.removeAttribute('data-media-id'); card.removeAttribute('data-maru-revenue'); }
    card.setAttribute('aria-label',item.title || 'Media content');
    var thumb = q('.thumb',card); if(!thumb){ thumb = D.createElement('div'); thumb.className='thumb'; card.insertBefore(thumb,card.firstChild); }
    var image = q('img',thumb);
    if(isUsable(item.thumbnail)){
      if(!image){ image = D.createElement('img'); image.loading='lazy'; thumb.appendChild(image); }
      image.alt = item.title || ''; image.src = item.thumbnail; thumb.classList.remove('ph');
    } else { if(image) image.remove(); thumb.classList.add('ph'); }
    var meta = q('.meta',card); if(!meta){ meta = D.createElement('div'); meta.className='meta'; card.appendChild(meta); } meta.textContent = item.title || 'Coming Soon';
  }
  function renderLine(line, items, key){
    var cards = ensureCards(line); var used = new Set(); var slotTargets = {};
    cards.forEach(function(card,index){ var id = text(card.dataset.mediaSlotId || card.dataset.slotId); if(id && !slotTargets[id]) slotTargets[id] = card; });
    items.slice(0,LIMIT).forEach(function(item,index){
      var target = item.slotId && slotTargets[item.slotId] && !used.has(slotTargets[item.slotId]) ? slotTargets[item.slotId] : cards[index];
      if(!target || used.has(target)) target = cards.find(function(card){ return !used.has(card); });
      if(!target) return; used.add(target); fillCard(target,item,key,index);
    });
    cards.forEach(function(card,index){ if(!used.has(card)) clearCard(card,key,index); });
  }
  function recency(item){ var time = Date.parse(item.publishedAt || ''); if(!Number.isFinite(time)) return 0; var days = Math.max(0,(Date.now()-time)/86400000); return Math.max(0,30-days)/30; }
  function rankScore(item){ return item.priority * 10 + item.views + item.clicks * 1.5 + item.likes * 2 + item.recommends * 3 + Math.min(item.watchTime,86400)/60*0.25 + item.rating*10 + recency(item)*5; }
  function rankedTrending(sectionMap){
    var seen = new Set(), merged=[];
    CATEGORY_KEYS.forEach(function(key){
      slotsOf(sectionMap[key],key).filter(isDisplayable).forEach(function(item){
        var identity = item.id || item.source || (item.title + '|' + item.thumbnail + '|' + item.slotId);
        if(!identity || seen.has(identity)) return; seen.add(identity); merged.push(item);
      });
    });
    merged.sort(function(a,b){ var score = rankScore(b)-rankScore(a); return score || String(a.title).localeCompare(String(b.title)); });
    return merged.slice(0,LIMIT);
  }
  async function sectionSlots(sectionMap,key){
    var snapshotSlots = slotsOf(sectionMap[key],key);
    if(snapshotSlots.some(isDisplayable)) return snapshotSlots;
    var feedSlots = await loadFeedSlots(key);
    return feedSlots.length ? feedSlots : snapshotSlots;
  }
  function heroFrom(snapshot, sectionMap){
    var heroImage = q('.hero img'); if(!heroImage) return;
    var hero = snapshot && snapshot.hero || {}; var keys = hero.rotateFrom || hero.source || []; if(!Array.isArray(keys)) keys = [keys];
    for(var i=0;i<keys.length;i+=1){ var first = slotsOf(sectionMap[canonKey(keys[i])],canonKey(keys[i])).find(isDisplayable); if(first && isUsable(first.thumbnail)){ heroImage.src=first.thumbnail; return; } }
  }
  async function main(){
    var lines = qa('.thumb-line[data-psom-key]'); if(!lines.length) return;
    lines.forEach(ensureCards);
    var snapshot = await loadSnapshot(); var sectionMap = normalizeSectionMap(snapshot);
    var resolved = {};
    for(var i=0;i<CATEGORY_KEYS.length;i+=1) resolved[CATEGORY_KEYS[i]] = await sectionSlots(sectionMap,CATEGORY_KEYS[i]);
    CATEGORY_KEYS.forEach(function(key){ sectionMap[key] = { slots:resolved[key] || [] }; });
    var trending = rankedTrending(sectionMap);
    sectionMap['media-trending'] = { slots:trending };
    heroFrom(snapshot,sectionMap);
    lines.forEach(function(line){
      var key = canonKey(line.getAttribute('data-psom-key'));
      if(!key || key.indexOf('media-') !== 0 || key === 'media-hero') return;
      renderLine(line,key === 'media-trending' ? trending : (resolved[key] || slotsOf(sectionMap[key],key)),key);
    });
  }
  if(D.readyState === 'loading') D.addEventListener('DOMContentLoaded',main,{once:true}); else main();
})();

/* Keep the existing non-cash revenue event hook available; it does not alter slot rendering. */
(function loadMaruRevenueAutoHookForAutomap(){
  'use strict';
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  function install(){ try{ if(window.MaruRevenueAutoHook && typeof window.MaruRevenueAutoHook.install === 'function') window.MaruRevenueAutoHook.install({service:'front-automap'}); }catch(_){} }
  function load(src,id,globalName,done){
    if(window[globalName]) { done(); return; }
    var tag=document.getElementById(id); if(tag){ tag.addEventListener('load',done,{once:true}); return; }
    tag=document.createElement('script'); tag.id=id; tag.src=src; tag.async=false; tag.onload=done; (document.head||document.documentElement).appendChild(tag);
  }
  load('/assets/js/maru-revenue-tracker.js','maruRevenueTrackerScript','MaruRevenueTracker',function(){ load('/assets/js/maru-revenue-autohook.js','maruRevenueAutoHookScript','MaruRevenueAutoHook',install); });
})();
