/**
 * mediahub-automap.v3.js (PRODUCTION SAFE / SINGLE VERSION)
 * ------------------------------------------------------------
 * 목적:
 *  - MediaHub 메인 10섹션(data-psom-key="media-*")에 "미디어 콘텐츠"를 슬롯-우선(slot-first)으로 꽂는다.
 *  - 우선순위: /data/media.snapshot*.json -> /.netlify/functions/feed-media?key=... fallback
 *  - 데이터 없으면 HTML 더미(placeholder) 유지 (파괴/삭제 금지)
 *  - 모든 섹션 카드 수: 50 고정(부족하면 placeholder 추가)
 *  - 우측 패널 없음(처리하지 않음)
 *  - Hero는 snapshot.hero.rotateFrom 순서로 1개 썸네일을 골라 img src에 적용(가능한 경우)
 */
(function () {
  'use strict';

  if (window.__MEDIAHUB_AUTOMAP_V3_PROD__) return;
  window.__MEDIAHUB_AUTOMAP_V3_PROD__ = true;

  const D = document;

  const LIMIT = 50;

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

  function cleanText(v){
    return (v === null || v === undefined) ? '' : String(v).trim();
  }

  function isInvalidMediaValue(v){
    const raw = cleanText(v);
    if(!raw) return true;
    const s = raw.toLowerCase();
    if(s === '#' || s === 'about:blank') return true;
    if(s === 'null' || s === 'undefined' || s === 'false') return true;
    if(s === 'javascript:void(0)' || s === 'javascript:;' || s === 'javascript:void(0);') return true;
    if(s === 'loading…' || s === 'loading...' || s === 'loading' || s === 'coming soon') return true;
    if(s.indexOf('placeholder') >= 0 || s.indexOf('placehold.co') >= 0) return true;
    if(s.indexOf('data:image/gif;base64,r0lgodlhaqabaiaaaaaaap') === 0) return true;
    return false;
  }

  function firstValid(){
    for(let i=0;i<arguments.length;i++){
      const v = cleanText(arguments[i]);
      if(!isInvalidMediaValue(v)) return v;
    }
    return '';
  }

  function isUnverifiedCandidate(item){
    if(!item || typeof item !== 'object') return true;

    if(item.candidateOnly === true || item.candidate_only === true) return true;
    if(item.seedContent === true || item.seed_content === true) return true;

    const rights = item.rights && typeof item.rights === 'object' ? item.rights : {};
    const statusValues = [
      item.verificationStatus, item.verification_status,
      item.reviewStatus, item.review_status,
      item.rightsStatus, item.rights_status,
      item.allowedUse, item.allowed_use,
      rights.status, rights.verificationStatus, rights.allowedUse
    ].map(v => cleanText(v).toLowerCase()).filter(Boolean);

    const blocked = new Set([
      'verification_required',
      'web_verification_required',
      'pending',
      'unverified',
      'not_verified',
      'hold',
      'blocked',
      'rejected',
      'candidate',
      'seed'
    ]);

    return statusValues.some(v => blocked.has(v));
  }

  function normalizeMediaItem(item){
    if(!item || typeof item !== 'object') return null;

    const title = firstValid(item.title, item.name, item.text);
    const thumb = firstValid(item.thumbnail, item.thumb, item.image, item.imageUrl, item.thumbnailUrl, item.poster, item.posterUrl);
    const source = firstValid(item.url, item.video, item.playUrl, item.embedUrl, item.sourceUrl, item.link, item.href);
    const id = firstValid(item.id, item._id, item.contentId, item.videoId, item.slug);

    if(!title) return null;
    if(!id && !source) return null;
    if(!thumb && !source) return null;
    if(isUnverifiedCandidate(item)) return null;

    const out = Object.assign({}, item);
    out.title = title;
    if(id && !out.id) out.id = id;
    if(id && !out.contentId) out.contentId = id;
    if(thumb) out.thumbnail = thumb;
    if(source) out.url = source;
    if(!out.provider) out.provider = firstValid(item.provider, item.sourceName, item.platform, item.channelTitle);
    return out;
  }

  function filterRenderableItems(items){
    if(!Array.isArray(items)) return [];
    return items.map(normalizeMediaItem).filter(Boolean);
  }

  function slotsToItems(section){
    const slots = section && Array.isArray(section.slots) ? section.slots : [];
    return filterRenderableItems(slots.map((slot)=>({
      id: slot.id || slot.contentId || slot.videoId || slot.slug || '',
      contentId: slot.contentId || slot.id || slot.videoId || slot.slug || '',
      videoId: slot.videoId || '',
      slug: slot.slug || '',
      title: slot.title || slot.name || '',
      thumbnail: slot.thumbnail || slot.thumb || slot.image || slot.imageUrl || slot.thumbnailUrl || slot.poster || slot.posterUrl || '',
      thumb: slot.thumb || '',
      url: slot.url || slot.video || slot.playUrl || slot.embedUrl || slot.sourceUrl || slot.link || slot.href || '',
      video: slot.video || slot.playUrl || '',
      embedUrl: slot.embedUrl || '',
      provider: slot.provider || slot.sourceName || slot.platform || slot.channelTitle || '',
      publishedAt: slot.publishedAt || slot.releaseDate || slot.createdAt || slot.date || '',
      releaseDate: slot.releaseDate || '',
      views: slot.views || slot.viewCount || 0,
      viewCount: slot.viewCount || 0,
      popularity: slot.popularity || slot.score || 0,
      score: slot.score || 0,
      rating: slot.rating || slot.voteAverage || 0,
      voteAverage: slot.voteAverage || 0,
      candidateOnly: slot.candidateOnly || slot.candidate_only || false,
      candidate_only: slot.candidate_only || false,
      seedContent: slot.seedContent || slot.seed_content || false,
      seed_content: slot.seed_content || false,
      verificationStatus: slot.verificationStatus || slot.verification_status || '',
      verification_status: slot.verification_status || '',
      reviewStatus: slot.reviewStatus || slot.review_status || '',
      review_status: slot.review_status || '',
      rightsStatus: slot.rightsStatus || slot.rights_status || '',
      rights_status: slot.rights_status || '',
      allowedUse: slot.allowedUse || slot.allowed_use || '',
      allowed_use: slot.allowed_use || '',
      rights: slot.rights || null
    })));
  }

  function extractItems(section){
    if(!section) return [];
    if(Array.isArray(section)) return filterRenderableItems(section);
    if(Array.isArray(section.items)) return filterRenderableItems(section.items);
    if(Array.isArray(section.slots)) return slotsToItems(section);
    return [];
  }

  function hasSnapshotSection(sectionMap, key){
    return !!(sectionMap && Object.prototype.hasOwnProperty.call(sectionMap, key));
  }

  async function loadFeedItems(key){
    const url = `/.netlify/functions/feed-media?key=${encodeURIComponent(key)}&limit=500`;
    try{
      const data = await fetchJson(url);
      if(data && Array.isArray(data.items)) return filterRenderableItems(data.items);
      if(data && Array.isArray(data.sections)){
        const found = data.sections.find(s => s && canonKey(s.key) === key);
        if(found && Array.isArray(found.items)) return filterRenderableItems(found.items);
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

  function ensurePlaceholders(line){
    const container = getContainer(line);

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

    // add up to LIMIT
    if(ph.length < LIMIT){
      const frag = D.createDocumentFragment();
      for(let i=ph.length;i<LIMIT;i++){
        frag.appendChild(makePlaceholder());
      }
      container.appendChild(frag);
      ph = qa('a[data-placeholder="true"]', container);
    }

    // if too many, keep first LIMIT as fill targets
    if(ph.length > LIMIT) ph = ph.slice(0, LIMIT);

    return ph;
  }

  
 function ensureContentId(item){
  if(!item) return '';

  const title = firstValid(item.title, item.name, item.text);
  const source = firstValid(item.url, item.video, item.playUrl, item.embedUrl, item.sourceUrl, item.link, item.href);
  if(!title && !source) return '';

  return (
    firstValid(item.id, item._id, item.contentId, item.videoId, item.slug) ||
    (source ? btoa(source).replace(/=/g,'') : '')
  );
}

  function fillAnchor(a, item){
    const title = firstValid(item && item.title, item && item.name, item && item.text);
    const thumb = firstValid(item && item.thumbnail, item && item.thumb, item && item.image, item && item.imageUrl, item && item.thumbnailUrl, item && item.poster, item && item.posterUrl);

    const videoId = ensureContentId(item);

    if(videoId){
      a.href = `/media/watch.html?id=${encodeURIComponent(videoId)}`;
      a.onclick = null;
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }else{
      a.href = "javascript:void(0)";
      a.onclick = function(){ alert("콘텐츠 준비 중입니다."); };
    }


    if(item && item.provider) a.dataset.provider = item.provider;

    let thumbBox = q('.thumb', a);
    if(!thumbBox){
      thumbBox = D.createElement('div');
      thumbBox.className = 'thumb';
      a.insertBefore(thumbBox, a.firstChild);
    }

    if(thumb) thumbBox.classList.remove('ph');

    let img = q('img', thumbBox);
    if(thumb){
      if(!img){
        img = D.createElement('img');
        thumbBox.appendChild(img);
      }
      img.alt = title || '';
      img.loading = 'lazy';
      img.src = thumb;
    }else if(img){
      img.removeAttribute('src');
      img.alt = title || '';
    }

    let metaBox = q('.meta', a);
    if(!metaBox){
      metaBox = D.createElement('div');
      metaBox.className = 'meta';
      a.appendChild(metaBox);
    }
    metaBox.textContent = title;

    a.removeAttribute('data-placeholder');
  }

  function applyLine(line, items){
    if(!Array.isArray(items) || items.length === 0) return; // keep dummy
    const ph = ensurePlaceholders(line);
    const n = Math.min(LIMIT, ph.length, items.length);
    for(let i=0;i<n;i++){
      fillAnchor(ph[i], items[i]);
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

    // fallback feed (best-effort). If a media snapshot is present but only has empty/sample slots, keep the existing hero.
    if(sectionMap && Object.keys(sectionMap).length > 0) return;

    for(const k of keys){
      const items = await loadFeedItems(k);
      const first = items && items[0];
      const thumb = first && firstValid(first.thumbnail, first.thumb, first.image, first.imageUrl, first.thumbnailUrl, first.poster, first.posterUrl);
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
    lines.forEach(ensurePlaceholders);

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

      // 🔥 여기서 바로 섹션 정보 주입
      item._sectionKey = key;

      merged.push(item);
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
      if((!items || items.length === 0) && !hasSnapshotSection(sectionMap, key)){
        items = await loadFeedItems(key);
      }
      applyLine(line, items);
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
