/**
 * mediahub-automap.v3.js (PRODUCTION SAFE / SINGLE VERSION)
 * ------------------------------------------------------------
 * 목적:
 *  - MediaHub 메인 10섹션(data-psom-key="media-*")에 "미디어 콘텐츠"를 슬롯-우선(slot-first)으로 꽂는다.
 *  - 우선순위: /data/media.snapshot*.json 단일 경로(feed-media legacy fallback 비활성)
 *  - 데이터 없으면 HTML 더미(placeholder) 유지 (파괴/삭제 금지)
 *  - 일반 섹션 100개, 음악·쇼츠 50개 상한(부족하면 placeholder 추가)
 *  - 우측 패널 없음(처리하지 않음)
 *  - Hero는 snapshot.hero.rotateFrom 순서로 1개 썸네일을 골라 img src에 적용(가능한 경우)
 */
(function () {
  'use strict';

  if (window.__MEDIAHUB_AUTOMAP_V3_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V3_PROD__ = true;

  const D = document;

  const DEFAULT_LIMIT = 100;
  const COMPACT_LIMIT = 50;

  // Legacy feed-media fallback is disabled.
  // Keep the original snapshot -> automap -> front sample/real-content rendering process unchanged.
  const ENABLE_FEED_MEDIA_FALLBACK = false;

  const SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/data/media.snapshot.v6.keys.json',
    '/data/media.snapshot.v5.slots.json',
    '/data/media.snapshot.v4.ott.full.json'
  ];

  const KEY_ALIAS = {
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

  function q(sel, root){ return (root||D).querySelector(sel); }
  function qa(sel, root){ return Array.prototype.slice.call((root||D).querySelectorAll(sel)); }

  function canonKey(k){
    if(!k) return '';
    if(k.indexOf('media-') === 0) return k;
    return KEY_ALIAS[k] || k;
  }

  function limitForKey(key){
    return key === 'media-trending' || key === 'media-music' || key === 'media-shorts'
      ? COMPACT_LIMIT
      : DEFAULT_LIMIT;
  }

  async function fetchJson(url){
    const r = await fetch(url, { cache: 'no-store' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }

  async function loadSnapshotAny(){
    for (const url of SNAPSHOT_URLS){
      try { return await fetchJson(url); } catch(e){ /* continue */ }
    }
    return null;
  }

  function normalizeSectionMap(snapshot){
    const map = {};
    if(!snapshot) return map;

    // object sections
    if(snapshot.sections && !Array.isArray(snapshot.sections) && typeof snapshot.sections === 'object'){
      Object.keys(snapshot.sections).forEach((k)=>{
        map[canonKey(k)] = snapshot.sections[k] || {};
      });
      return map;
    }

    // array sections
    if(Array.isArray(snapshot.sections)){
      snapshot.sections.forEach((s)=>{
        if(!s) return;
        map[canonKey(s.key || '')] = s;
      });
    }
    return map;
  }

  function isReleasedItem(item){
    if(!item || item.candidateOnly === true || item.seedContent === true) return false;
    const contract = item.releaseContract || item.release_contract || {};
    if(contract.policy === 'media-candidate-policy-v2.0.0' && contract.eligible === true) return true;
    const verification = String(item.verificationStatus || item.verification_status || '').toLowerCase();
    const rights = item.rights || {};
    const rightsStatus = String(rights.status || item.rights_status || '').toLowerCase();
    const allowedUse = String(rights.allowedUse || item.allowed_use || '').toLowerCase();
    return verification === 'approved_for_snapshot' &&
      /^(rights_verified_by_admin|public_domain_verified|cc0_verified|cc_by_verified|cc_by_sa_verified|direct_license_verified)$/.test(rightsStatus) &&
      /^(approved_for_snapshot|approved_embed_or_link|public_domain|cc0|cc_by|cc_by_sa|direct_license)$/.test(allowedUse);
  }

  function slotsToItems(section){
    const slots = section && Array.isArray(section.slots) ? section.slots : [];
    return slots.filter(isReleasedItem).map((slot)=>Object.assign({}, slot, {
      id: slot.id || slot.contentId || '',
      contentId: slot.contentId || slot.id || '',
      title: slot.title || '',
      thumbnail: slot.thumb || slot.thumbnail || '',
      url: slot.url || slot.video || '',
      video: slot.video || '',
      provider: slot.provider || '',
      captions: Array.isArray(slot.captions) ? slot.captions : [],
      year: slot.year || null,
      publishedAt: slot.publishedAt || null,
      ageRating: slot.ageRating || '',
      contentWarnings: Array.isArray(slot.contentWarnings) ? slot.contentWarnings : []
    }));
  }

  function extractItems(section){
    if(!section) return [];
    if(Array.isArray(section.items)) return section.items.filter(isReleasedItem);
    if(Array.isArray(section.slots)) return slotsToItems(section);
    return [];
  }

  async function loadFeedItems(key){
    if(!ENABLE_FEED_MEDIA_FALLBACK) return [];
    const url = `/.netlify/functions/feed-media?key=${encodeURIComponent(key)}&limit=500`;
    try{
      const data = await fetchJson(url);
      if(data && Array.isArray(data.items)) return data.items;
      if(data && Array.isArray(data.sections)){
        const found = data.sections.find(s => s && canonKey(s.key) === key);
        if(found && Array.isArray(found.items)) return found.items;
      }
    }catch(e){ /* ignore */ }
    return [];
  }

  function makePlaceholder(){
    const a = D.createElement('a');
    a.className = 'card media-card';
    a.setAttribute('data-placeholder','true');
    a.href = 'javascript:void(0)';
    const thumb = D.createElement('div');
    thumb.className = 'thumb ph';
    const meta = D.createElement('div');
    meta.className = 'meta';
    meta.textContent = 'Coming Soon';
    a.appendChild(thumb);
    a.appendChild(meta);
    return a;
  }

  function getContainer(line){
    // Some pages wrap cards in .scroll-content. If not, cards are directly inside .thumb-line.
    return q('.scroll-content', line) || line;
  }

  function ensurePlaceholders(line, limit){
    const container = getContainer(line);
    limit = Math.max(1, Number(limit) || DEFAULT_LIMIT);

    // collect existing placeholders (preferred)
    let ph = qa('a[data-placeholder="true"]', container);

    // mark empty anchors as placeholders (non-destructive)
    if(ph.length === 0){
      const anchors = qa('a.card', container);
      anchors.forEach((a)=>{
        const hasImg = !!q('img', a);
        const hasText = (a.textContent || '').trim().length > 0;
        if(!hasImg && !hasText) a.setAttribute('data-placeholder','true');
      });
      ph = qa('a[data-placeholder="true"]', container);
    }

    // Keep total cards at the section capacity. Counting only placeholders
    // would grow the row every time an already-filled line is re-applied.
    let cards = qa('a.card', container);
    if(cards.length < limit){
      const frag = D.createDocumentFragment();
      for(let i=cards.length;i<limit;i++){
        frag.appendChild(makePlaceholder());
      }
      container.appendChild(frag);
      ph = qa('a[data-placeholder="true"]', container);
      cards = qa('a.card', container);
    }

    // if too many, keep the configured capacity as fill targets
    if(ph.length > limit) ph = ph.slice(0, limit);

    return ph;
  }

  
 function ensureContentId(item){
  if(!item) return '';

  const hasRealContent =
    !!(item.title || item.name || item.text || item.thumbnail || item.thumb || item.image || item.imageUrl || item.thumbnailUrl || item.url || item.video || item.link || item.href);

  if(!hasRealContent) return '';

  return (
    item.id ||
    item._id ||
    item.contentId ||
    item.videoId ||
    item.slug ||
    (item.url ? btoa(item.url).replace(/=/g,'') : '')
  );
}

  function fillAnchor(a, item){
    const title = (item && (item.title || item.name || item.text || '')) || '';
    const thumb = (item && (item.thumbnail || item.thumb || item.image || item.imageUrl || item.thumbnailUrl || '')) || '';
    const url = (item && (item.url || item.video || item.link || item.href || '#')) || '#';

    
    const videoId = ensureContentId(item);

    if(videoId){
      a.href = `/media/watch.html?id=${encodeURIComponent(videoId)}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }else{
      a.href = "javascript:void(0)";
      a.onclick = function(){ alert("콘텐츠 준비 중입니다."); };
    }


    if(item && item.provider) a.dataset.provider = item.provider;

    // Media playback handoff contract. Keep the card renderer slot-first, but
    // carry the normalized media fields needed by the existing inline player.
    // No seller/product pipeline fields are touched here.
    if(title) a.dataset.mediaTitle = title;
    if(videoId){
      a.dataset.igdcContentId = String(videoId);
      a.dataset.contentId = String(videoId);
    }
    if(item){
      const directUrl = /\.(mp4|webm|ogv|ogg|m4v)(?:[?#].*)?$/i.test(String(item.url || '')) || /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/)/i.test(String(item.url || '')) ? item.url : '';
      const mediaSource = item.video || item.streamUrl || item.mediaUrl || item.playbackUrl || item.sourceUrl || directUrl || '';
      if(mediaSource) a.dataset.mediaSource = String(mediaSource);
      const captions = item.captions || item.subtitleTracks || item.subtitles;
      if(Array.isArray(captions) && captions.length){
        try { a.dataset.captions = JSON.stringify(captions); } catch(_e){}
      }
      // Native-player launch URLs are accepted only when the verified catalog
      // explicitly supplies them. The website never fabricates an app scheme.
      if(item.windowsPlayerUrl) a.dataset.windowsPlayerUrl = String(item.windowsPlayerUrl);
      if(item.androidPlayerUrl) a.dataset.androidPlayerUrl = String(item.androidPlayerUrl);
      if(item.maruAppUrl) a.dataset.maruAppUrl = String(item.maruAppUrl);
    }

    let thumbBox = q('.thumb', a);
    if(!thumbBox){
      thumbBox = D.createElement('div');
      thumbBox.className = 'thumb';
      a.insertBefore(thumbBox, a.firstChild);
    }

    let img = q('img', thumbBox);
    if(!img){
      img = D.createElement('img');
      thumbBox.appendChild(img);
    }
    img.alt = title || '';
    img.loading = 'lazy';
    if(thumb) img.src = thumb;

    let metaBox = q('.meta', a);
    if(!metaBox){
      metaBox = D.createElement('div');
      metaBox.className = 'meta';
      a.appendChild(metaBox);
    }
    metaBox.textContent = title;

    a.removeAttribute('data-placeholder');
  }

  function applyLine(line, items, key){
    if(!Array.isArray(items) || items.length === 0) return; // keep dummy
    const limit = limitForKey(key);
    const ph = ensurePlaceholders(line, limit);
    const container = getContainer(line);
    const existing = qa('a.card[data-igdc-content-id]', container);
    let placeholderIndex = 0;
    const seen = new Set();
    for(let i=0;i<items.length && seen.size<limit;i++){
      const contentId = String(ensureContentId(items[i]) || '');
      if(!contentId || seen.has(contentId)) continue;
      seen.add(contentId);
      const current = existing.find((anchor)=>String(anchor.dataset.igdcContentId || '') === contentId);
      if(current){
        fillAnchor(current, items[i]);
        continue;
      }
      while(placeholderIndex<ph.length && !ph[placeholderIndex].hasAttribute('data-placeholder')) placeholderIndex++;
      if(placeholderIndex>=ph.length) break;
      fillAnchor(ph[placeholderIndex], items[i]);
      placeholderIndex++;
    }
  }

  async function applyHero(heroRotateKeys, sectionMap){
    const heroImg = q('.hero img');
    if(!heroImg) return;

    const keys = Array.isArray(heroRotateKeys) ? heroRotateKeys.map(canonKey) : [];
    if(keys.length === 0) return;

    // snapshot first
    for(const k of keys){
      const items = extractItems(sectionMap[k]);
      const first = items && items[0];
      const thumb = first && (first.thumbnail || first.thumb || first.image || first.imageUrl || first.thumbnailUrl || '');
      if(thumb){
        heroImg.src = thumb;
        return;
      }
    }

    // fallback feed (best-effort)
    for(const k of keys){
      const items = await loadFeedItems(k);
      const first = items && items[0];
      const thumb = first && (first.thumbnail || first.thumb || first.image || first.imageUrl || first.thumbnailUrl || '');
      if(thumb){
        heroImg.src = thumb;
        return;
      }
    }
  }

  async function main(){
    const lines = qa('.thumb-line[data-psom-key]');
    if(lines.length === 0) return;

    // stabilize layout first
    lines.forEach((line)=>{
      const key = canonKey(line.getAttribute('data-psom-key') || '');
      ensurePlaceholders(line, limitForKey(key));
    });

    const snapshot = await loadSnapshotAny();
    const sectionMap = normalizeSectionMap(snapshot);
	
// ===== MEDIA TRENDING AUTO-COMBINE (FINAL PRO) =====
(function(){

  if(!sectionMap) return;

  const existing = extractItems(sectionMap["media-trending"]);
  if(Array.isArray(existing) && existing.length > 0){
    return;
  }

  const sourceKeys = [
    "media-movie",
    "media-drama",
    "media-variety",
    "media-music"
  ];

  let merged = [];

 sourceKeys.forEach(key => {
  const items = extractItems(sectionMap[key]);

  if(Array.isArray(items)){
    items.forEach(item => {

      // Keep snapshot objects immutable while adding the derived section weight.
      merged.push(Object.assign({}, item, { _sectionKey:key }));
    });
  }
});

  // 🔥 최신성 점수 (0~1)
  function getRecency(item){
    const now = Date.now();

    const t =
      item.publishedAt ||
      item.releaseDate ||
      item.createdAt ||
      item.date ||
      null;

    if(!t) return 0;

    const time = new Date(t).getTime();
    if(isNaN(time)) return 0;

    const diffDays = (now - time) / (1000 * 60 * 60 * 24);

    return Math.max(0, 1 - (diffDays / 30)); // 30일 기준
  }

  // 🔥 섹션 가중치 (영화/드라마 우선)
  function getSectionWeight(item){
    const key = item._sectionKey || '';

    if(key === "media-movie") return 1.2;
    if(key === "media-drama") return 1.15;
    if(key === "media-variety") return 1.05;
    if(key === "media-music") return 1.0;

    return 1.0;
  }

  // 🔥 점수 계산 (완성형)
  function getScore(item){

    const views = item.views || item.viewCount || 0;
    const popularity = item.popularity || item.score || 0;
    const rating = item.rating || item.voteAverage || 0;
    const recency = getRecency(item);
    const weight = getSectionWeight(item);

    const base =
      views * 0.5 +
      popularity * 0.2 +
      rating * 0.1 +
      recency * 100 * 0.2;

    return base * weight;
  }

  // 🔥 정렬
  merged.sort((a, b) => getScore(b) - getScore(a));

  // 🔥 중복 제거
  const seen = new Set();
  const filtered = [];

  for(const item of merged){
    const key =
      item.url ||
      item.video ||
      item.id ||
      JSON.stringify(item);

    if(seen.has(key)) continue;
    seen.add(key);
    filtered.push(item);
  }

  sectionMap["media-trending"] = {
    items: filtered.slice(0, 50)
  };

})();

    // hero
    const heroRotateFrom = snapshot && snapshot.hero && (snapshot.hero.rotateFrom || snapshot.hero.source);
    await applyHero(heroRotateFrom, sectionMap);

    // sections
    for(const line of lines){
      const key = canonKey(line.getAttribute('data-psom-key') || '');
      if(!key || key.indexOf('media-') !== 0) continue;

      let items = extractItems(sectionMap[key]);
      if(!items || items.length === 0){
        items = await loadFeedItems(key);
      }
      applyLine(line, items, key);
    }
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', main);
  else main();

})();


/* ------------------------------------------------------------------
 * MARU Revenue AutoHook Loader
 * Added by revenue tracking patch.
 *
 * Purpose:
 * - Load /assets/js/maru-revenue-tracker.js
 * - Then load /assets/js/maru-revenue-autohook.js
 * - Do not change this automap's original rendering pipeline.
 * ------------------------------------------------------------------ */
(function loadMaruRevenueAutoHookForAutomap(){
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function installIfReady(){
    try {
      if (
        window.MaruRevenueAutoHook &&
        typeof window.MaruRevenueAutoHook.install === "function"
      ) {
        window.MaruRevenueAutoHook.install({
          service: "front-automap"
        });
      }
    } catch (e) {
      console.warn("[MARU Revenue] autohook install skipped:", e);
    }
  }

  function loadScriptOnce(src, id, globalName, done){
    var existing = document.getElementById(id);

    if (window[globalName]) {
      if (typeof done === "function") done();
      return;
    }

    if (existing) {
      existing.addEventListener("load", function(){
        if (typeof done === "function") done();
      }, { once:true });
      existing.addEventListener("error", function(){
        console.warn("[MARU Revenue] failed to load:", src);
      }, { once:true });
      return;
    }

    var script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    script.onload = function(){
      if (typeof done === "function") done();
    };
    script.onerror = function(){
      console.warn("[MARU Revenue] failed to load:", src);
    };

    (document.head || document.documentElement).appendChild(script);
  }

  if (window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__) {
    installIfReady();
    return;
  }

  window.__MARU_REVENUE_AUTOMAP_LOADER_DONE__ = true;

  loadScriptOnce(
    "/assets/js/maru-revenue-tracker.js",
    "maruRevenueTrackerScript",
    "MaruRevenueTracker",
    function(){
      loadScriptOnce(
        "/assets/js/maru-revenue-autohook.js",
        "maruRevenueAutoHookScript",
        "MaruRevenueAutoHook",
        installIfReady
      );
    }
  );
})();
