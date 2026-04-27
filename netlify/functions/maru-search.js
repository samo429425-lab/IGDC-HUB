/**
 * netlify/functions/maru-search.js
 * ------------------------------------------------------------
 * MARU SEARCH — STABILIZED INTERNAL-FIRST + WEEKLY SETTLEMENT (A1.5.4)
 *
 * Design goal:
 * - Keep the working 313/314 API shape: handler / maruSearchDispatcher / runEngine / items+results
 * - Keep the safe 314 parallel/allSettled pattern
 * - Restore controlled wide scanning so search results do not stall around ~200
 * - Preserve thumbnails/images/video/map cards for richer search cards
 * - Do NOT pull collector/planetary in the default search path
 */

'use strict';

let Core = null;
try { Core = require('./core'); } catch (e) { Core = null; }

const fs = require('fs');
const path = require('path');

const VERSION = 'A1.5.18-hybrid-meaningful-image-filter';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const MIN_RESULT_TARGET = 500;
const DEFAULT_SOFT_TIMEOUT_MS = 10500;

// MARU gateway policy:
// - Internal search-bank first.
// - External APIs are not globally blocked; they are allowed only through maru-search,
//   after internal results are insufficient or when explicitly requested.
// - Same query calls are cached and in-flight de-duplicated to prevent recursive / repeated bursts.
const MARU_GATEWAY_CACHE_TTL_MS = 5 * 60 * 1000;
const MARU_INFLIGHT_TTL_MS = 30 * 1000;
const DEFAULT_EXTERNAL_TRIGGER_MIN = 60;
const OG_IMAGE_ENRICH_LIMIT = 30;
const OG_IMAGE_ENRICH_CONCURRENCY = 4;
const OG_IMAGE_ENRICH_TIMEOUT_MS = 1800;
const OG_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_SEARCH_BANK_PAGES_NORMAL = 14;
const MAX_SEARCH_BANK_PAGES_DEEP = 30;

function nowMs(){ return Date.now(); }

function truthy(v){
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function explicitExternalRequested(qs){
  qs = qs || {};
  const external = String(qs.external == null ? '' : qs.external).trim().toLowerCase();
  return ['1','true','yes','on','live','deep'].includes(external)
    || truthy(qs.useExternalSources)
    || truthy(qs.useExternal)
    || truthy(qs.useLive)
    || truthy(qs.live);
}

function explicitExternalBlocked(qs){
  qs = qs || {};
  const external = String(qs.external == null ? '' : qs.external).trim().toLowerCase();
  return external === 'off'
    || external === '0'
    || external === 'false'
    || truthy(qs.noExternal)
    || truthy(qs.disableExternal);
}

function normalizeSearchType(v){
  const raw = safeString(v || '').trim().toLowerCase();
  const alias = {
    '': 'all', all: 'all', total: 'all', web: 'web', general: 'web',
    image: 'image', images: 'image', img: 'image', photo: 'image',
    news: 'news', map: 'map', maps: 'map', local: 'map', place: 'map',
    knowledge: 'knowledge', know: 'knowledge', encyclopedia: 'knowledge', wiki: 'knowledge',
    tour: 'tour', travel: 'tour', tourism: 'tour', place_tour: 'tour',
    video: 'video', youtube: 'video', media: 'video',
    sns: 'sns', social: 'sns', blog: 'blog', cafe: 'cafe', community: 'cafe',
    shopping: 'shopping', shop: 'shopping', commerce: 'shopping',
    sports: 'sports', sport: 'sports', finance: 'finance', stock: 'finance', market: 'finance',
    webtoon: 'webtoon', cartoon: 'webtoon'
  };
  return alias[raw] || 'all';
}

function safeString(v){ return String(v == null ? '' : v); }
function stripHtml(s){ return safeString(s).replace(/<[^>]*>/g, ''); }

function clampInt(v, d, min, max){
  const n = parseInt(v, 10);
  const x = Number.isFinite(n) ? n : d;
  return Math.max(min, Math.min(max, x));
}

function normalizeBaseUrl(v){
  const s = safeString(v).trim().replace(/\/+$/, '');
  if(!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

function eventBaseUrl(event){
  try{
    const headers = (event && event.headers) || {};
    const host = headers['x-forwarded-host'] || headers['host'] || '';
    const proto = headers['x-forwarded-proto'] || 'https';
    if(!host) return '';
    return (proto + '://' + host).replace(/\/+$/, '');
  }catch(e){ return ''; }
}

function resolveRuntimeBaseUrl(event){
  return normalizeBaseUrl(process.env.DEPLOY_URL || process.env.URL || process.env.SITE_URL) || eventBaseUrl(event);
}

async function fetchWithTimeout(url, options, timeoutMs){
  const ms = Math.max(500, Math.min(12000, timeoutMs || 6000));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try{
    return await fetch(url, Object.assign({}, options || {}, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

function ok(body){
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'Accept-Language, Query-String',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type'
    },
    body: JSON.stringify(body)
  };
}

function fail(message, detail){
  return ok({
    status: 'error',
    engine: 'maru-search',
    version: VERSION,
    message,
    detail: detail || null
  });
}

function pickQ(event){
  const qs = (event && event.queryStringParameters) || {};
  const q = safeString(qs.q || qs.query || '').trim();
  const limit = clampInt(qs.limit || qs.max || qs.count, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const start = clampInt(qs.start || 1, 1, 1, 1000);
  const lang = safeString(qs.lang || qs.uiLang || qs.locale || '').trim() || null;
  const deep = truthy(qs.deep) || String(qs.external || '').toLowerCase() === 'deep';

  const externalBlocked = explicitExternalBlocked(qs);
  const externalRequested = explicitExternalRequested(qs);

  // 외부 API 무조건 차단이 아님.
  // 기본은 auto: 내부 search-bank/snapshot 먼저 확인하고, 부족할 때만 maru-search가 단일 창구로 통제 호출.
  const externalMode = externalBlocked ? 'off' : (externalRequested || deep ? 'force' : 'auto');
  const externalOff = externalMode === 'off';
  const noMedia = truthy(qs.noMedia) || truthy(qs.disableMedia);
  const searchType = normalizeSearchType(qs.type || qs.category || qs.tab || qs.vertical);
  return { q, limit, start, lang, deep, externalOff, externalMode, noMedia, searchType, raw: qs };
}

function parseAcceptLanguage(header){
  return safeString(header)
    .split(',')
    .map(x => x.trim().split(';')[0].toLowerCase())
    .filter(Boolean);
}

function detectRuntimeRegion(event, lang, q){
  try{
    const qs = (event && event.queryStringParameters) || {};
    const forcedRegion = safeString(qs.region || qs.geo || '').trim().toUpperCase();
    const forcedCountry = safeString(qs.country || '').trim().toUpperCase();
    if(forcedRegion) return forcedRegion;
    if(forcedCountry === 'KR') return 'KR';
    if(forcedCountry === 'US') return 'US';

    const headers = (event && event.headers) || {};
    const xfCountry = safeString(headers['x-country'] || headers['cf-ipcountry'] || headers['x-vercel-ip-country'] || '').trim().toUpperCase();
    if(xfCountry === 'KR') return 'KR';
    if(xfCountry === 'US') return 'US';

    const langs = [safeString(lang).toLowerCase()].concat(parseAcceptLanguage(headers['accept-language'] || headers['Accept-Language'] || '')).filter(Boolean);
    if(langs.some(x => x.startsWith('ko'))) return 'KR';
    if(langs.some(x => x.startsWith('en-us'))) return 'US';
    if(langs.some(x => x.startsWith('en'))) return 'US';
    if(/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(safeString(q))) return 'KR';
    return 'GLOBAL';
  }catch(e){ return 'GLOBAL'; }
}

function sourceOrderForRegion(region){
  const r = safeString(region).toUpperCase();
  if(r === 'KR') return ['search_bank','web_naver','web_google','web_bing','web_youtube','web_image','maps'];
  return ['search_bank','web_google','web_bing','web_naver','web_youtube','web_image','maps'];
}

function domainOf(url){
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch(e){ return ''; }
}

function faviconOf(url){
  const d = domainOf(url);
  return d ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d) + '&sz=64' : '';
}

function isRealImageUrl(u){
  const s = safeString(u).trim();
  if(!s) return false;
  const low = s.toLowerCase();
  if(low.includes('google.com/s2/favicons') || low.includes('favicon') || low.endsWith('.ico')) return false;
  if(low.startsWith('data:')) return true;
  if(/^https?:\/\//i.test(s) || s.startsWith('/')) return true;
  return false;
}

function firstNonEmpty(){
  for(let i=0; i<arguments.length; i++){
    const v = arguments[i];
    if(v === undefined || v === null) continue;
    const s = safeString(v).trim();
    if(s) return v;
  }
  return '';
}

function detectLangFromTextFallback(text){
  const t = safeString(text);
  if(!t) return null;
  if(/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(t)) return 'ko';
  if(/[ぁ-ゟ゠-ヿ]/.test(t)) return 'ja';
  if(/[一-龥]/.test(t)) return 'zh';
  if(/[А-Яа-яЁё]/.test(t)) return 'ru';
  return 'en';
}

function compactImages(arr){
  const out = [];
  const seen = new Set();
  (Array.isArray(arr) ? arr : []).forEach(v => {
    const s = safeString(v).trim();
    if(!s || seen.has(s)) return;
    if(isRealImageUrl(s)){
      seen.add(s);
      out.push(s);
    }
  });
  return out.slice(0, 6);
}

function mediaPoster(raw, payload){
  const media = raw && raw.media;
  const preview = media && media.preview;
  return firstNonEmpty(
    preview && preview.poster,
    payload && payload.poster,
    payload && payload.thumb,
    payload && payload.thumbnail
  );
}

function canonicalizeItem(raw, query, sourceHint){
  const it = (raw && typeof raw === 'object') ? raw : {};
  const p = (it.payload && typeof it.payload === 'object') ? it.payload : {};
  const url = safeString(firstNonEmpty(it.url, it.link, it.href, p.url, p.link)).trim();
  const title = safeString(firstNonEmpty(it.title, it.name, p.title, p.name, url)).trim();
  const summary = safeString(firstNonEmpty(it.summary, it.snippet, it.description, p.summary, p.snippet, p.description)).trim();

  const imageCandidates = compactImages([
    it.thumbnail, it.thumb, it.image, it.image_url, it.og_image,
    p.thumbnail, p.thumb, p.image, p.image_url, p.og_image,
    mediaPoster(it, p)
  ].concat(Array.isArray(it.imageSet) ? it.imageSet : []).concat(Array.isArray(p.imageSet) ? p.imageSet : []));

  const favicon = faviconOf(url);
  const thumbnail = imageCandidates[0] || favicon;
  const type = safeString(it.type || p.type || 'web') || 'web';
  const mediaType = safeString(it.mediaType || p.mediaType || (type === 'image' ? 'image' : (type === 'video' ? 'video' : 'article')));
  const source = firstNonEmpty(it.source, p.source, sourceHint, domainOf(url));
  const id = safeString(firstNonEmpty(it.id, url, title, source + '-' + Math.random().toString(16).slice(2))).trim();
  const tags = Array.isArray(it.tags) ? it.tags : (Array.isArray(p.tags) ? p.tags : []);

  const out = Object.assign({}, it, {
    id,
    type,
    mediaType,
    title,
    summary,
    description: it.description !== undefined ? it.description : summary,
    url,
    link: firstNonEmpty(it.link, url),
    source,
    lang: it.lang || p.lang || detectLangFromTextFallback(title + ' ' + summary),
    thumbnail,
    thumb: firstNonEmpty(it.thumb, imageCandidates[0], thumbnail),
    image: firstNonEmpty(it.image, imageCandidates[0], ''),
    imageSet: imageCandidates,
    media: it.media || p.media || undefined,
    channel: it.channel || p.channel,
    section: it.section || p.section,
    page: it.page || p.page,
    psom_key: it.psom_key || p.psom_key,
    route: it.route || p.route,
    bind: (it.bind && typeof it.bind === 'object') ? it.bind : p.bind,
    tags,
    score: typeof it.score === 'number' ? it.score : (typeof p.score === 'number' ? p.score : 0.9),
    payload: p
  });

  if(!out.media && mediaType === 'video' && thumbnail){
    out.media = { type: 'video', preview: { poster: thumbnail } };
  }

  return out;
}

function toStandardItems(arr, source){
  return (Array.isArray(arr) ? arr : []).map((r, idx) => {
    const raw = (r && typeof r === 'object') ? r : {};
    const item = Object.assign({}, raw, {
      id: firstNonEmpty(raw.id, raw.link, raw.url, raw.title, source + '-' + idx),
      type: raw.type || 'web',
      title: firstNonEmpty(raw.title, raw.name, ''),
      summary: firstNonEmpty(raw.snippet, raw.summary, raw.description, ''),
      url: firstNonEmpty(raw.url, raw.link, raw.href, ''),
      link: firstNonEmpty(raw.link, raw.url, raw.href, ''),
      source: raw.source || source,
      score: typeof raw.score === 'number' ? raw.score : 0.9,
      payload: raw.payload || {}
    });
    return canonicalizeItem(item, null, source);
  });
}

function dedupeCanonicalItems(items){
  const seen = new Set();
  const out = [];
  for(const it of (Array.isArray(items) ? items : [])){
    const rawUrl = safeString(it && (it.url || it.link)).trim();
    const normUrl = rawUrl.toLowerCase();
    const placeholder = !rawUrl || rawUrl === '#' || rawUrl === '/' || normUrl === 'javascript:void(0)' || normUrl.startsWith('javascript:');
    const key = (placeholder ? (safeString(it && it.id).trim() || safeString(it && it.title).trim() + '|' + safeString(it && it.source).trim()) : rawUrl).toLowerCase();
    if(!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}


function isLikelyMeaninglessImageUrl(imageUrl){
  const s = safeString(imageUrl).toLowerCase();
  if(!s) return true;

  const bad = [
    'favicon', 'logo', 'symbol', 'emblem', 'slogan', 'brand',
    '/ci', '_ci', '-ci', '/bi', '_bi', '-bi',
    'placeholder', 'noimage', 'no_image', 'default-image', 'default_img',
    'sprite', 'button', 'btn_', '/btn', 'sns_logo', 'kakao', 'facebook',
    'header_logo', 'footer_logo'
  ];

  if(bad.some(k => s.includes(k))) return true;
  if(/\.(svg|ico)(\?|#|$)/i.test(s)) return true;

  return false;
}

function isGenericGovOfficialItem(it){
  const url = safeString(firstNonEmpty(it && it.url, it && it.link)).toLowerCase();
  const host = domainOf(url).toLowerCase();
  const title = safeString(it && it.title).toLowerCase();
  const summary = safeString(firstNonEmpty(it && it.summary, it && it.description)).toLowerCase();
  const text = title + ' ' + summary + ' ' + url;

  const isGov =
    host.includes('.go.kr') ||
    host.endsWith('.gov') ||
    host.includes('.gov.') ||
    host.includes('gov.uk') ||
    host.includes('go.jp') ||
    host.includes('gov.cn');

  if(!isGov) return false;

  const meaningfulTerms = [
    '관광', '여행', '명소', '야경', '축제', '행사', '문화', '공연',
    '갤러리', '사진', '포토', '한컷', '리포트', '스토리', '영상',
    'tour', 'travel', 'visit', 'photo', 'gallery', 'festival', 'culture',
    'landmark', 'attraction', 'story', 'video'
  ];

  if(meaningfulTerms.some(k => text.includes(k))) return false;

  return true;
}

function isMeaningfulImageForItem(imageUrl, it){
  const img = safeString(imageUrl).trim();
  if(!isRealImageUrl(img)) return false;

  const source = safeString(it && it.source).toLowerCase();
  const type = safeString(it && it.type).toLowerCase();
  const mediaType = safeString(it && it.mediaType).toLowerCase();

  // Pure image/video providers already return image objects. Keep them unless clearly icon/logo.
  const isMediaResult =
    source.includes('image') ||
    source.includes('youtube') ||
    type === 'image' ||
    type === 'video' ||
    mediaType === 'image' ||
    mediaType === 'video';

  if(isLikelyMeaninglessImageUrl(img) && !isMediaResult) return false;

  // Generic government/portal pages often expose slogan/logo/text banners as og:image.
  // Do not display those unless the result itself is clearly tourism/news/photo/culture/media.
  if(isGenericGovOfficialItem(it) && !isMediaResult) return false;

  return true;
}

function naturalImagesForItem(it, maxCount){
  const images = compactImages([
    it && it.thumbnail,
    it && it.thumb,
    it && it.image
  ].concat(Array.isArray(it && it.imageSet) ? it.imageSet : []));

  const out = [];
  const seen = new Set();

  for(const img of images){
    if(!isMeaningfulImageForItem(img, it)) continue;

    let key = safeString(img).split('#')[0].toLowerCase();
    try{
      const u = new URL(img, safeString(firstNonEmpty(it && it.url, it && it.link)) || undefined);
      key = (u.origin + u.pathname).toLowerCase();
    }catch(e){}

    if(seen.has(key)) continue;
    seen.add(key);
    out.push(img);
    if(out.length >= (maxCount || 3)) break;
  }

  return out;
}


function compactResultItem(it){
  it = (it && typeof it === 'object') ? it : {};

  const type = it.type || 'web';
  const mediaType = it.mediaType || (type === 'image' ? 'image' : 'article');
  const sourceText = safeString(it.source).toLowerCase();

  let ownImages = naturalImagesForItem(it, 3);

  // Naver image API item is usually one image result; thumbnail/original often look duplicated.
  if(sourceText.includes('naver_image') && ownImages.length > 1){
    ownImages = ownImages.slice(0, 1);
  }

  const ownThumb = ownImages[0] || '';

  return {
    id: safeString(firstNonEmpty(it.id, it.url, it.link, it.title)).trim(),
    type,
    mediaType,
    title: safeString(it.title).trim(),
    summary: safeString(firstNonEmpty(it.summary, it.snippet, it.description)).trim(),
    description: safeString(firstNonEmpty(it.description, it.summary, it.snippet)).trim(),
    url: safeString(firstNonEmpty(it.url, it.link, it.href)).trim(),
    link: safeString(firstNonEmpty(it.link, it.url, it.href)).trim(),
    source: it.source || null,
    lang: it.lang || null,
    thumbnail: ownThumb,
    thumb: ownThumb,
    image: ownThumb,
    imageSet: ownImages,
    media: it.media || undefined,
    channel: it.channel || undefined,
    section: it.section || undefined,
    page: it.page || undefined,
    psom_key: it.psom_key || undefined,
    route: it.route || undefined,
    bind: it.bind && typeof it.bind === 'object' ? it.bind : undefined,
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 12) : [],
    score: typeof it.score === 'number' ? it.score : undefined,
    _finalScore: typeof it._finalScore === 'number' ? it._finalScore : undefined,
    _authorityScore: typeof it._authorityScore === 'number' ? it._authorityScore : undefined
  };
}

function responseSizeHint(items){
  try { return Buffer.byteLength(JSON.stringify(items || []), 'utf8'); }
  catch(e){ return 0; }
}

function gatewayExternalTriggerCount(){
  return clampInt(process.env.MARU_EXTERNAL_TRIGGER_MIN, DEFAULT_EXTERNAL_TRIGGER_MIN, 0, 1000);
}

function snapshotCandidates(){
  return [
    './search-bank.snapshot.json', './data/search-bank.snapshot.json', './snapshot.json',
    path.join(process.cwd(), 'search-bank.snapshot.json'),
    path.join(process.cwd(), 'data', 'search-bank.snapshot.json'),
    path.join(__dirname || '.', 'search-bank.snapshot.json'),
    path.join(__dirname || '.', 'data', 'search-bank.snapshot.json')
  ];
}

function loadSnapshotLocal(q, limit){
  try{
    let rows = null;
    for(const p of snapshotCandidates()){
      if(fs.existsSync(p)){
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        rows = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : null);
        if(rows) break;
      }
    }
    if(!rows) return null;
    const qq = safeString(q).trim().toLowerCase();
    const tokens = qq.split(/\s+/).filter(Boolean);
    const filtered = rows.filter(it => {
      const h = [it.title, it.name, it.summary, it.description, it.url, it.link, it.channel, it.section, it.page, it.psom_key, it.route, Array.isArray(it.tags) ? it.tags.join(' ') : ''].join(' ').toLowerCase();
      if(!qq) return true;
      return h.includes(qq) || tokens.some(t => h.includes(t));
    });
    return filtered.slice(0, Math.min(limit || MAX_LIMIT, MAX_LIMIT));
  }catch(e){ return null; }
}

function googleLikeSearchLinks(q){
  const enc = encodeURIComponent(q);
  return [
    { title: '[News] ' + q, url: 'https://www.google.com/search?tbm=nws&q=' + enc, source: 'news', sourceType: 'search-link', provider: 'google-news-search-link', placeholder: true, generatedBy: 'maru-search', mediaType: 'article', score: 0.7 },
    { title: '[Images] ' + q, url: 'https://www.google.com/search?tbm=isch&q=' + enc, source: 'images', sourceType: 'search-link', provider: 'google-image-search-link', placeholder: true, generatedBy: 'maru-search', mediaType: 'image', score: 0.68 },
    { title: '[Videos] ' + q, url: 'https://www.youtube.com/results?search_query=' + enc, source: 'youtube', sourceType: 'search-link', provider: 'youtube-search-link', placeholder: true, generatedBy: 'maru-search', mediaType: 'video', score: 0.66 },
    { title: '[Shopping] ' + q, url: 'https://www.google.com/search?tbm=shop&q=' + enc, source: 'shopping', sourceType: 'search-link', provider: 'google-shopping-search-link', placeholder: true, generatedBy: 'maru-search', mediaType: 'product', score: 0.6 }
  ].map(x => canonicalizeItem(x, q, x.source));
}

function mapCards(q, region){
  if(!q) return [];
  const enc = encodeURIComponent(q);
  const cards = [
    { title: '[Map] ' + q + ' - Google Maps', url: 'https://www.google.com/maps/search/' + enc, source: 'google_maps', mediaType: 'map', type: 'map', summary: q + ' 지도 검색', score: 0.72 },
    { title: '[Map] ' + q + ' - Naver Map', url: 'https://map.naver.com/p/search/' + enc, source: 'naver_map', mediaType: 'map', type: 'map', summary: q + ' 네이버 지도 검색', score: 0.71 }
  ];
  return cards.map(x => canonicalizeItem(x, q, x.source));
}

let SearchBankEngine = null;
let SearchBankEngineLoaded = false;

function getSearchBankEngine(){
  if(SearchBankEngineLoaded) return SearchBankEngine;
  SearchBankEngineLoaded = true;
  try { SearchBankEngine = require('./search-bank-engine'); } catch(e) { SearchBankEngine = null; }
  return SearchBankEngine;
}

async function callSearchBankEngineInternal(event, params){
  try{
    const engine = getSearchBankEngine();
    if(!engine) return null;

    const safeParams = Object.assign({}, params || {});

    if(typeof engine.runEngine === 'function'){
      return await engine.runEngine(event || {}, safeParams);
    }

    if(typeof engine.handler === 'function'){
      const res = await engine.handler({
        httpMethod: 'GET',
        headers: (event && event.headers) || {},
        queryStringParameters: safeParams
      });
      if(!res) return null;
      if(typeof res === 'object' && Object.prototype.hasOwnProperty.call(res, 'body')){
        try { return JSON.parse(res.body || '{}'); } catch(e) { return null; }
      }
      return res;
    }

    if(typeof engine === 'function'){
      return await engine(event || {}, safeParams);
    }

    return null;
  }catch(e){
    return null;
  }
}

const Containers = {
  search_bank: {
    async fetch(q, limit, offset, event){
      try{
        const data = await callSearchBankEngineInternal(event, {
          q: safeString(q),
          query: safeString(q),
          limit: safeString(limit),
          offset: safeString(offset || 0),
          from: 'maru-search',
          // recursion guard: search-bank-engine must not bounce back into maru-search.
          external: 'off',
          noExternal: '1',
          disableExternal: '1',
          skipMaruSearch: '1',
          noMaruSearch: '1',
          skipCollector: '1',
          skipPlanetary: '1',
          noAnalytics: '1',
          noRevenue: '1'
        });
        const root = data && data.data && Array.isArray(data.data.items) ? data.data : data;
        const base = data && data.baseResult ? data.baseResult : root;
        const baseData = base && base.data && Array.isArray(base.data.items) ? base.data : base;
        const results =
          (root && Array.isArray(root.items) && root.items) ||
          (root && Array.isArray(root.results) && root.results) ||
          (baseData && Array.isArray(baseData.items) && baseData.items) ||
          (baseData && Array.isArray(baseData.results) && baseData.results) ||
          [];
        if(results.length) return { source: 'search-bank', results, total: typeof (root && root.total) === 'number' ? root.total : null };
        return null;
      }catch(e){ return null; }
    }
  },
  web_naver: { async fetch(q, limit, start){ return naverSearch(q, limit, start); } },
  web_naver_image: { async fetch(q, limit, start){ return naverImageSearch(q, limit, start); } },
  web_naver_blog: { async fetch(q, limit, start){ return naverGenericSearch('blog.json', q, limit, start, 'naver_blog', 'blog'); } },
  web_naver_news: { async fetch(q, limit, start){ return naverGenericSearch('news.json', q, limit, start, 'naver_news', 'news'); } },
  web_naver_cafe: { async fetch(q, limit, start){ return naverGenericSearch('cafearticle.json', q, limit, start, 'naver_cafe', 'community'); } },
  web_naver_encyc: { async fetch(q, limit, start){ return naverGenericSearch('encyc.json', q, limit, start, 'naver_encyc', 'encyclopedia'); } },
  web_naver_kin: { async fetch(q, limit, start){ return naverGenericSearch('kin.json', q, limit, start, 'naver_kin', 'qa'); } },
  web_naver_local: { async fetch(q, limit, start){ return naverGenericSearch('local.json', q, Math.min(limit, 5), start, 'naver_local', 'local'); } },
  web_google: { async fetch(q, limit, start){ return googleSearch(q, limit, start); } },
  web_bing: { async fetch(q, limit, start){ return bingSearch(q, limit, start); } },
  web_youtube: { async fetch(q, limit){ return youtubeSearch(q, limit); } },
  web_image: { async fetch(q, limit, start){ return googleImageSearch(q, limit, start); } },
  snapshot: { async fetch(q, limit){ const local = loadSnapshotLocal(q, limit); return local ? { source: 'snapshot-local', results: local } : null; } }
};

function sourceCaps(opts){
  const deep = !!opts.deep;
  return {
    searchBankPages: deep ? MAX_SEARCH_BANK_PAGES_DEEP : MAX_SEARCH_BANK_PAGES_NORMAL,
    // External APIs are controlled by maru-search gateway only; no recursive / unbounded loops.
    // Normal mode target: enough for 30~50 front pages when the provider has data.
    // Naver supports 100 per page; 8 pages = up to 800 results in one controlled gateway pass.
    naverPages: deep ? 10 : 8,
    // Controlled vertical expansion. Runs only inside maru-search gateway, never recursively.
    naverBlogPages: deep ? 3 : 2,
    naverNewsPages: deep ? 2 : 1,
    naverCafePages: deep ? 2 : 1,
    naverEncycPages: deep ? 1 : 1,
    naverKinPages: deep ? 1 : 1,
    naverLocalPages: 1,
    googlePages: deep ? 3 : 2,
    bingPages: deep ? 3 : 2,
    imagePages: deep ? 2 : 1,
    naverImagePages: deep ? 3 : 2,
    youtubeLimit: deep ? 40 : 20,
    timeoutMs: deep ? 12000 : DEFAULT_SOFT_TIMEOUT_MS
  };
}

function addBundle(bundle, fallbackSource, collected, sourceState){
  if(!bundle || !Array.isArray(bundle.results) || !bundle.results.length) return 0;
  if(!sourceState.used) sourceState.used = fallbackSource || bundle.source || 'multi';
  const items = toStandardItems(bundle.results, bundle.source || fallbackSource || 'multi');
  collected.push.apply(collected, items);
  return items.length;
}

async function orchestrateSearch({ event, q, limit, start, lang, deep, externalOff, externalMode, noMedia, searchType }){
  limit = clampInt(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  globalThis.__MARU_CACHE = globalThis.__MARU_CACHE || new Map();
  globalThis.__MARU_INFLIGHT = globalThis.__MARU_INFLIGHT || new Map();

  const mode = externalMode || (externalOff ? 'off' : 'auto');
  const viewType = normalizeSearchType(searchType);
  const cacheKey = [q, limit, start, lang || '', deep ? 'deep' : 'normal', mode, noMedia ? 'no-media' : 'media', viewType].join('::');
  const cached = globalThis.__MARU_CACHE.get(cacheKey);
  if(cached && Date.now() - cached.t < MARU_GATEWAY_CACHE_TTL_MS) return cached.v;

  const inflight = globalThis.__MARU_INFLIGHT.get(cacheKey);
  if(inflight && Date.now() - inflight.t < MARU_INFLIGHT_TTL_MS) return await inflight.p;

  const work = (async () => {
    const started = nowMs();
    const caps = sourceCaps({ deep });
    const deadline = started + caps.timeoutMs;
    const timeLeft = () => Math.max(0, deadline - nowMs());
    const collected = [];
    const sourceState = { used: null };
    const trace = [];
    const region = detectRuntimeRegion(event, lang, q);
    const sourceRoute = sourceOrderForRegion(region);
    const externalTriggerMin = Math.min(
      MAX_LIMIT,
      Math.max(gatewayExternalTriggerCount(), Math.min(limit, MIN_RESULT_TARGET))
    );

    function record(name, status, count, extra){ trace.push(Object.assign({ name, status, count: count || 0 }, extra || {})); }

    async function pullFromSearchBank(){
      let count = 0;
      let offset = 0;
      const pageSigs = new Set();
      const target = Math.min(MAX_LIMIT, Math.max(limit, MIN_RESULT_TARGET));
      const maxPages = Math.min(caps.searchBankPages, Math.ceil(target / 100) + 3);
      for(let i=0; i<maxPages && timeLeft() > 900; i++){
        const b = await Containers.search_bank.fetch(q, 100, offset, event).catch(() => null);
        if(!b || !b.results || !b.results.length) break;
        const sig = b.results.slice(0, 3).map(x => safeString(x && (x.id || x.url || x.link || x.title))).join('|') + '::' +
          b.results.slice(-3).map(x => safeString(x && (x.id || x.url || x.link || x.title))).join('|');
        if(sig && pageSigs.has(sig)) { record('search-bank', 'duplicate-page-break', count, { offset }); break; }
        pageSigs.add(sig);
        const n = addBundle(b, 'search-bank', collected, sourceState);
        count += n;
        if(b.results.length < 100) break;
        offset += 100;
        if(count >= target) break;
      }
      record('search-bank', count ? 'ok' : 'empty', count);
      if(!count){
        const snap = await Containers.snapshot.fetch(q, Math.max(limit, MIN_RESULT_TARGET)).catch(() => null);
        const n = addBundle(snap, 'snapshot-local', collected, sourceState);
        if(n) record('snapshot-local', 'ok', n);
        return n || 0;
      }
      return count;
    }

    async function pullFromNaver(){
      let count = 0;
      const firstStart = start || 1;
      const starts = [];
      for(let i=0; i<caps.naverPages; i++){
        const pageStart = firstStart + (i * 100);
        if(pageStart > 1000) break;
        starts.push(pageStart);
      }

      // Controlled batch inside the single maru-search gateway pass.
      // This avoids the old 2-page/~200 result ceiling without opening recursive loops.
      const settled = await Promise.allSettled(
        starts.map(pageStart =>
          Containers.web_naver.fetch(q, 100, pageStart)
            .then(bundle => ({ pageStart, bundle }))
            .catch(() => ({ pageStart, bundle: null }))
        )
      );

      for(const s of settled){
        const pack = s && s.status === 'fulfilled' ? s.value : null;
        const naver = pack && pack.bundle;
        const n = addBundle(naver, 'naver', collected, sourceState);
        count += n;
      }

      record('naver', count ? 'ok' : 'empty', count, { pagesTried: starts.length, mode: 'controlled-batch' });
      return count;
    }

    async function pullFromGoogle(){
      let count = 0;
      let pageStart = start || 1;
      for(let i=0; i<caps.googlePages && pageStart <= 91 && timeLeft() > 1500; i++){
        const g = await Containers.web_google.fetch(q, 10, pageStart).catch(() => null);
        const n = addBundle(g, 'google', collected, sourceState);
        count += n;
        if(!g || !g.results || g.results.length < 10) break;
        pageStart += 10;
      }
      record('google', count ? 'ok' : 'empty', count);
      return count;
    }

    async function pullFromBing(){
      let count = 0;
      let offset = 0;
      for(let i=0; i<caps.bingPages && offset <= 450 && timeLeft() > 1200; i++){
        const b = await Containers.web_bing.fetch(q, 50, offset).catch(() => null);
        const n = addBundle(b, 'bing', collected, sourceState);
        count += n;
        if(!b || !b.results || b.results.length < 50) break;
        offset += 50;
      }
      record('bing', count ? 'ok' : 'empty', count);
      return count;
    }

    async function pullFromYouTube(){
      if(noMedia) { record('youtube', 'media-disabled', 0); return 0; }
      const y = await Containers.web_youtube.fetch(q, caps.youtubeLimit).catch(() => null);
      const n = addBundle(y, 'youtube', collected, sourceState);
      record('youtube', n ? 'ok' : 'empty', n);
      return n;
    }

    async function pullFromImage(){
      if(noMedia) {
        record('naver_image', 'media-disabled', 0);
        record('google_image', 'media-disabled', 0);
        return 0;
      }

      let total = 0;

      // Naver image: Korean/local thumbnail pool. Controlled inside maru-search gateway.
      let naverCount = 0;
      let naverStart = 1;
      for(let i=0; i<(caps.naverImagePages || 1) && naverStart <= 1000 && timeLeft() > 1200; i++){
        const img = await Containers.web_naver_image.fetch(q, 30, naverStart).catch(() => null);
        const n = addBundle(img, 'naver_image', collected, sourceState);
        naverCount += n;
        total += n;
        if(!img || !img.results || img.results.length < 30) break;
        naverStart += 30;
      }
      record('naver_image', naverCount ? 'ok' : 'empty', naverCount);

      // Google image: global thumbnail pool. Small probe in normal mode.
      let googleCount = 0;
      let pageStart = 1;
      for(let i=0; i<caps.imagePages && pageStart <= 91 && timeLeft() > 1200; i++){
        const img = await Containers.web_image.fetch(q, 10, pageStart).catch(() => null);
        const n = addBundle(img, 'google_image', collected, sourceState);
        googleCount += n;
        total += n;
        if(!img || !img.results || img.results.length < 10) break;
        pageStart += 10;
      }
      record('google_image', googleCount ? 'ok' : 'empty', googleCount);

      return total;
    }

    async function pullFromNaverVerticals(){
      let total = 0;

      async function runPaged(name, container, pages, display){
        let count = 0;
        const starts = [];
        for(let i=0; i<pages; i++){
          const st = 1 + (i * display);
          if(st > 1000) break;
          starts.push(st);
        }

        const settled = await Promise.allSettled(
          starts.map(st =>
            container.fetch(q, display, st)
              .then(bundle => ({ st, bundle }))
              .catch(() => ({ st, bundle: null }))
          )
        );

        for(const item of settled){
          const pack = item && item.status === 'fulfilled' ? item.value : null;
          const n = addBundle(pack && pack.bundle, name, collected, sourceState);
          count += n;
        }

        record(name, count ? 'ok' : 'empty', count, { pagesTried: starts.length, mode: 'controlled-vertical' });
        total += count;
      }

      // These verticals are the missing source pool behind the 203/263 ceiling.
      await runPaged('naver_blog', Containers.web_naver_blog, caps.naverBlogPages || 0, 100);
      await runPaged('naver_news', Containers.web_naver_news, caps.naverNewsPages || 0, 100);
      await runPaged('naver_cafe', Containers.web_naver_cafe, caps.naverCafePages || 0, 100);
      await runPaged('naver_encyc', Containers.web_naver_encyc, caps.naverEncycPages || 0, 100);
      await runPaged('naver_kin', Containers.web_naver_kin, caps.naverKinPages || 0, 100);
      await runPaged('naver_local', Containers.web_naver_local, caps.naverLocalPages || 0, 5);

      return total;
    }

    const internalCount = await pullFromSearchBank();
    const shouldUseExternal = !externalOff && (mode === 'force' || !!deep || viewType !== 'all' || internalCount < externalTriggerMin);

    if(shouldUseExternal){
      // Single maru-search gateway pass. No recursive loops, no repeated fan-out.
      await Promise.allSettled([
        pullFromNaver(),
        pullFromGoogle(),
        pullFromBing(),
        (deep || viewType === 'video' || /영상|비디오|video|youtube|유튜브/i.test(q)) ? pullFromYouTube() : Promise.resolve(0),
        pullFromImage()
      ]);

      const afterPrimaryExternal = collected.length;
      const naturalExpansionTarget = Math.min(Math.max(limit, MIN_RESULT_TARGET), 700);
      if((mode === 'force' || deep || viewType !== 'all' || afterPrimaryExternal < naturalExpansionTarget) && timeLeft() > 1800){
        await pullFromNaverVerticals();
      } else {
        record('naver_verticals', 'skipped-enough-primary', 0, { afterPrimaryExternal, naturalExpansionTarget });
      }

      collected.push.apply(collected, mapCards(q, region));
      record('search-link-cards', 'skipped-natural-flow', 0);
    }else{
      record('external-gateway', externalOff ? 'blocked-by-request' : 'skipped-internal-enough', 0, { internalCount, trigger: externalTriggerMin, mode });
    }

    let unique = dedupeCanonicalItems(collected);
    unique = backfillVisuals(unique);
    unique = await applyCorePipeline(q, unique);
    unique = applyServerSideBoosts(unique, { q, lang, searchType: viewType });

    // Natural image enrichment:
    // Only checks the result page itself for og:image/twitter:image.
    // No random image matching, no borrowed images from other results.
    unique = await enrichOwnImages(unique, { trace, timeLeft });

    const finalTarget = Math.min(MAX_LIMIT, Math.max(limit, MIN_RESULT_TARGET));
    const finalItems = unique.slice(0, finalTarget).map(compactResultItem);

    const result = {
      source: sourceState.used || (finalItems.length ? 'multi' : null),
      route: sourceRoute,
      sourceRoute,
      region,
      items: finalItems,
      meta: {
        count: finalItems.length,
        requestedLimit: limit,
        target: finalTarget,
        totalCandidates: collected.length,
        deduped: Math.max(0, collected.length - unique.length),
        richMedia: finalItems.filter(x => x && isRealImageUrl(x.thumbnail)).length,
        imagePolicy: 'hybrid-render-page-own-og-image-meaningful-filter',
        trace,
        externalSuppressed: !!externalOff,
        externalMode: mode,
        externalGatewayUsed: !!shouldUseExternal,
        externalTriggerMin,
        naturalFlow: true,
        balancedRanking: viewType === 'all',
        searchType: viewType,
        syntheticSearchLinks: false,
        providerCaps: {
          searchBankPages: caps.searchBankPages,
          naverPages: caps.naverPages,
          naverBlogPages: caps.naverBlogPages,
          naverNewsPages: caps.naverNewsPages,
          naverCafePages: caps.naverCafePages,
          naverEncycPages: caps.naverEncycPages,
          naverKinPages: caps.naverKinPages,
          naverLocalPages: caps.naverLocalPages,
          googlePages: caps.googlePages,
          bingPages: caps.bingPages,
          naverImagePages: caps.naverImagePages,
          imagePages: caps.imagePages,
          youtubeLimit: caps.youtubeLimit
        },
        mediaDisabled: !!noMedia,
        deep: !!deep,
        responseBytes: responseSizeHint(finalItems),
        elapsedMs: nowMs() - started
      }
    };

    globalThis.__MARU_CACHE.set(cacheKey, { t: Date.now(), v: result });
    return result;
  })();

  globalThis.__MARU_INFLIGHT.set(cacheKey, { t: Date.now(), p: work });
  try { return await work; }
  finally { globalThis.__MARU_INFLIGHT.delete(cacheKey); }
}


function absolutizeUrl(baseUrl, imageUrl){
  try{
    const img = safeString(imageUrl).trim();
    if(!img) return '';
    if(/^https?:\/\//i.test(img)) return img;
    if(img.startsWith('//')) return 'https:' + img;
    if(img.startsWith('data:')) return img;
    return new URL(img, baseUrl).href;
  }catch(e){ return ''; }
}

function extractOgImageFromHtml(html, baseUrl){
  const text = safeString(html);
  if(!text) return '';

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["'][^>]*>/i
  ];

  for(const re of patterns){
    const m = text.match(re);
    if(m && m[1]){
      const u = absolutizeUrl(baseUrl, m[1]);
      if(isRealImageUrl(u)) return u;
    }
  }

  return '';
}

function shouldSkipOgImageFetch(it){
  const url = safeString(firstNonEmpty(it && it.url, it && it.link)).trim();
  if(!url || !/^https?:\/\//i.test(url)) return true;

  const host = domainOf(url).toLowerCase();
  if(!host) return true;

  if(host.includes('google.com') && url.includes('/search')) return true;
  if(host.includes('youtube.com') && url.includes('/results')) return true;
  if(host.includes('map.naver.com') || host.includes('maps.google.')) return true;

  return false;
}

async function fetchOwnOgImage(url){
  try{
    globalThis.__MARU_OG_IMAGE_CACHE = globalThis.__MARU_OG_IMAGE_CACHE || new Map();

    const cacheKey = safeString(url).trim();
    const hit = globalThis.__MARU_OG_IMAGE_CACHE.get(cacheKey);
    if(hit && Date.now() - hit.t < OG_IMAGE_CACHE_TTL_MS) return hit.v;

    const res = await fetchWithTimeout(cacheKey, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 MaruSearchBot/1.0'
      }
    }, OG_IMAGE_ENRICH_TIMEOUT_MS);

    if(!res || !res.ok) {
      globalThis.__MARU_OG_IMAGE_CACHE.set(cacheKey, { t: Date.now(), v: '' });
      return '';
    }

    const ctype = safeString(res.headers && res.headers.get && res.headers.get('content-type')).toLowerCase();
    if(ctype && !ctype.includes('text/html') && !ctype.includes('application/xhtml')) {
      globalThis.__MARU_OG_IMAGE_CACHE.set(cacheKey, { t: Date.now(), v: '' });
      return '';
    }

    const html = await res.text();
    const img = extractOgImageFromHtml(html.slice(0, 300000), cacheKey);

    globalThis.__MARU_OG_IMAGE_CACHE.set(cacheKey, { t: Date.now(), v: img || '' });
    return img || '';
  }catch(e){
    return '';
  }
}

async function enrichOwnImages(items, opts){
  const list = Array.isArray(items) ? items.slice() : [];
  const max = Math.min(list.length, OG_IMAGE_ENRICH_LIMIT);
  const trace = opts && Array.isArray(opts.trace) ? opts.trace : null;
  const timeLeft = opts && typeof opts.timeLeft === 'function' ? opts.timeLeft : (() => 9999);

  let enriched = 0;
  let skipped = 0;
  let cursor = 0;

  async function worker(){
    while(cursor < max && timeLeft() > 1200){
      const idx = cursor++;
      const it = list[idx];
      if(!it) { skipped += 1; continue; }

      const ownImages = compactImages([
        it.thumbnail,
        it.thumb,
        it.image
      ].concat(Array.isArray(it.imageSet) ? it.imageSet : []));

      if(ownImages.length) { skipped += 1; continue; }
      if(shouldSkipOgImageFetch(it)) { skipped += 1; continue; }

      const url = safeString(firstNonEmpty(it.url, it.link)).trim();
      const img = await fetchOwnOgImage(url);

      if(img && isMeaningfulImageForItem(img, it)){
        const nextImages = naturalImagesForItem(Object.assign({}, it, {
          thumbnail: img,
          thumb: img,
          image: img,
          imageSet: [img]
        }), 3);

        if(nextImages.length){
          list[idx] = Object.assign({}, it, {
            thumbnail: nextImages[0],
            thumb: nextImages[0],
            image: nextImages[0],
            imageSet: nextImages,
            _ogImageEnriched: true
          });
          enriched += 1;
        } else {
          skipped += 1;
        }
      } else {
        skipped += 1;
      }
    }
  }

  const workers = [];
  const n = Math.min(OG_IMAGE_ENRICH_CONCURRENCY, max);
  for(let i=0; i<n; i++) workers.push(worker());
  await Promise.allSettled(workers);

  if(trace){
    trace.push({
      name: 'own-og-image-enrich',
      status: enriched ? 'ok' : 'empty',
      count: enriched,
      checked: max,
      skipped,
      mode: 'natural-own-page'
    });
  }

  return list;
}


function backfillVisuals(items){
  // Natural media only:
  // - do not borrow images from other results
  // - keep only this result's own meaningful distinct images
  // - allow 1~3 images when naturally present
  // - none means none
  return (Array.isArray(items) ? items : []).map(it => {
    if(!it) return it;

    const sourceText = safeString(it.source).toLowerCase();
    let ownImages = naturalImagesForItem(it, 3);

    if(sourceText.includes('naver_image') && ownImages.length > 1){
      ownImages = ownImages.slice(0, 1);
    }

    const ownThumb = ownImages[0] || '';

    return Object.assign({}, it, {
      thumbnail: ownThumb,
      thumb: ownThumb,
      image: ownThumb,
      imageSet: ownImages
    });
  });
}

async function naverSearch(q, limit, start){
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if(!id || !secret) return null;
  const url = 'https://openapi.naver.com/v1/search/webkr.json?query=' + encodeURIComponent(q) + '&display=' + Math.min(limit,100) + '&start=' + start;
  const res = await fetchWithTimeout(url, { headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret } }, 3000);
  if(!res.ok) throw new Error('NAVER_HTTP_' + res.status);
  const data = await res.json();
  const results = (Array.isArray(data.items) ? data.items : []).map(it => ({
    title: stripHtml(it.title), link: it.link || '', url: it.link || '', snippet: stripHtml(it.description), type: 'web', source: 'naver', payload: { source: 'naver' }
  }));
  return { source: 'naver', results };
}


async function naverImageSearch(q, limit, start){
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if(!id || !secret) return null;

  const url = 'https://openapi.naver.com/v1/search/image.json?query=' +
    encodeURIComponent(q) +
    '&display=' + Math.min(limit, 100) +
    '&start=' + (start || 1) +
    '&sort=sim';

  const res = await fetchWithTimeout(url, {
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret
    }
  }, 3000);

  if(!res.ok) return null;
  const data = await res.json();

  return {
    source: 'naver_image',
    results: (Array.isArray(data.items) ? data.items : []).map(it => {
      const thumb = it.thumbnail || it.link || '';
      const imageUrl = it.link || thumb || '';
      const context = it.originallink || imageUrl;
      return {
        title: stripHtml(it.title || q),
        link: context,
        url: context,
        snippet: '',
        type: 'image',
        mediaType: 'image',
        source: 'naver_image',
        thumbnail: thumb,
        thumb,
        image: imageUrl,
        imageSet: [],
        payload: {
          source: 'naver_image',
          thumb,
          image: thumb,
          contextLink: context
        }
      };
    })
  };
}

async function naverGenericSearch(endpoint, q, limit, start, source, type){
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if(!id || !secret) return null;

  const display = Math.max(1, Math.min(limit || 100, endpoint === 'local.json' ? 5 : 100));
  const url = 'https://openapi.naver.com/v1/search/' + endpoint +
    '?query=' + encodeURIComponent(q) +
    '&display=' + display +
    '&start=' + (start || 1) +
    (endpoint === 'blog.json' || endpoint === 'cafearticle.json' || endpoint === 'kin.json' ? '&sort=sim' : '');

  const res = await fetchWithTimeout(url, {
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret
    }
  }, 3000);

  if(!res.ok) return null;
  const data = await res.json();

  const results = (Array.isArray(data.items) ? data.items : []).map(it => {
    const title = stripHtml(it.title || q);
    const desc = stripHtml(it.description || it.summary || '');
    const link = it.link || it.originallink || '';
    const address = [it.category, it.roadAddress || it.address].filter(Boolean).join(' · ');
    const thumb = it.thumbnail || '';

    return {
      title,
      link,
      url: link,
      snippet: address ? (desc ? desc + ' · ' + address : address) : desc,
      summary: address ? (desc ? desc + ' · ' + address : address) : desc,
      type,
      mediaType: type === 'news' ? 'article' : (type === 'local' ? 'map' : 'article'),
      source,
      thumbnail: thumb,
      thumb,
      image: thumb,
      imageSet: [],
      payload: {
        source,
        endpoint,
        bloggername: it.bloggername,
        cafename: it.cafename,
        postdate: it.postdate,
        pubDate: it.pubDate,
        category: it.category,
        address: it.address,
        roadAddress: it.roadAddress
      }
    };
  });

  return { source, results };
}


async function googleSearch(q, limit, start){
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if(!key || !cx) return null;
  const base = 'https://www.googleapis.com/customsearch/v1' +
    '?key=' + encodeURIComponent(key) +
    '&cx=' + encodeURIComponent(cx) +
    '&q=' + encodeURIComponent(q) +
    '&num=' + Math.min(limit,10) +
    '&start=' + start +
    '&gl=us' +
    '&lr=lang_en|lang_ko';
  const webRes = await fetchWithTimeout(base, null, 3000).then(r => r.ok ? r.json() : null).catch(() => null);
  const newsRes = await fetchWithTimeout(base + '&sort=date', null, 3000).then(r => r.ok ? r.json() : null).catch(() => null);
  const mergeItems = (data, type, source) => {
    const items = Array.isArray(data && data.items) ? data.items : [];
    return items.map(it => {
      const pagemap = it.pagemap || {};
      const cseThumb = Array.isArray(pagemap.cse_thumbnail) ? pagemap.cse_thumbnail[0] : null;
      const cseImg = Array.isArray(pagemap.cse_image) ? pagemap.cse_image[0] : null;
      const img = (cseThumb && cseThumb.src) || (cseImg && cseImg.src) || '';
      return { title: it.title || '', link: it.link || '', url: it.link || '', snippet: it.snippet || '', type, source, thumbnail: img, thumb: img, image: img, payload: { source, thumb: img, image: img } };
    });
  };
  return { source: 'google', results: mergeItems(webRes, 'web', 'google').concat(mergeItems(newsRes, 'news', 'google_news')) };
}

async function bingSearch(q, limit, offset){
  const key = process.env.BING_API_KEY;
  if(!key) return null;
  const url = 'https://api.bing.microsoft.com/v7.0/search?q=' + encodeURIComponent(q) + '&count=' + Math.min(limit,50) + '&offset=' + (offset || 0);
  const res = await fetchWithTimeout(url, { headers: { 'Ocp-Apim-Subscription-Key': key } }, 3000);
  if(!res.ok) return null;
  const data = await res.json();
  return { source: 'bing', results: ((data.webPages && data.webPages.value) || []).map(it => ({ title: it.name, link: it.url, url: it.url, snippet: it.snippet, type: 'web', source: 'bing' })) };
}

async function youtubeSearch(q, limit){
  const key = process.env.YOUTUBE_API_KEY;
  if(!key) return null;
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=' + Math.min(limit,50) + '&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(key);
  const res = await fetchWithTimeout(url, null, 3500);
  if(!res.ok) return null;
  const data = await res.json();
  const results = (data.items || []).map(it => {
    const thumb = (it.snippet && it.snippet.thumbnails && (it.snippet.thumbnails.high || it.snippet.thumbnails.medium || it.snippet.thumbnails.default) || {}).url || '';
    const videoId = it.id && it.id.videoId;
    return { title: (it.snippet && it.snippet.title) || '', link: videoId ? 'https://www.youtube.com/watch?v=' + videoId : '', url: videoId ? 'https://www.youtube.com/watch?v=' + videoId : '', snippet: (it.snippet && it.snippet.description) || '', type: 'video', mediaType: 'video', source: 'youtube', thumbnail: thumb, thumb, image: thumb, media: { type: 'video', preview: { poster: thumb } }, payload: { source: 'youtube', thumb } };
  });
  return { source: 'youtube', results };
}

async function googleImageSearch(q, limit, start){
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if(!key || !cx) return null;
  const url = 'https://www.googleapis.com/customsearch/v1' +
    '?key=' + encodeURIComponent(key) +
    '&cx=' + encodeURIComponent(cx) +
    '&q=' + encodeURIComponent(q) +
    '&searchType=image' +
    '&num=' + Math.min(limit,10) +
    '&start=' + (start || 1);
  const res = await fetchWithTimeout(url, null, 3500);
  if(!res.ok) return null;
  const data = await res.json();
  return { source: 'google_image', results: (data.items || []).map(it => ({ title: it.title || '', link: it.image && it.image.contextLink ? it.image.contextLink : it.link, url: it.image && it.image.contextLink ? it.image.contextLink : it.link, snippet: it.snippet || '', type: 'image', mediaType: 'image', source: 'google_image', thumbnail: it.link, thumb: it.link, image: it.link, imageSet: [it.link], payload: { source: 'google_image', thumb: it.link, image: it.link, contextLink: it.image && it.image.contextLink } })) };
}

async function applyCorePipeline(query, items){
  let results = Array.isArray(items) ? items : [];
  if(Core && typeof Core.validateQuery === 'function'){
    try { Core.validateQuery(query); } catch(e) {}
  }
  if(Core && typeof Core.scoreItem === 'function'){
    results = results.map(it => Object.assign({}, it, { _coreScore: Core.scoreItem(query, it) })).sort((a,b) => (b._coreScore || 0) - (a._coreScore || 0));
  }
  return results.map(it => canonicalizeItem(it, query, it.source));
}

function detectIntent(q){
  const text = safeString(q).toLowerCase();
  if(text.includes('buy') || text.includes('price') || text.includes('shop')) return 'commerce';
  if(text.includes('news') || text.includes('breaking')) return 'news';
  if(text.includes('video') || text.includes('watch') || text.includes('영상')) return 'media';
  if(text.includes('image') || text.includes('photo') || text.includes('사진')) return 'image';
  return 'general';
}

function classifySearchCategory(it){
  const url = safeString(firstNonEmpty(it && it.url, it && it.link)).toLowerCase();
  const host = domainOf(url).toLowerCase();
  const source = safeString(it && it.source).toLowerCase();
  const title = safeString(it && it.title).toLowerCase();
  const summary = safeString(firstNonEmpty(it && it.summary, it && it.description)).toLowerCase();
  const mediaType = safeString(it && it.mediaType).toLowerCase();
  const type = safeString(it && it.type).toLowerCase();
  const text = [host, source, title, summary, mediaType, type].join(' ');

  if(mediaType === 'image' || type === 'image' || source.includes('image')) return 'image';
  if(mediaType === 'video' || type === 'video' || source.includes('youtube') || source.includes('video')) return 'video';
  if(mediaType === 'map' || type === 'map' || source.includes('local') || source.includes('map') || text.includes('지도') || text.includes('길찾기')) return 'map';
  if(source.includes('news') || type === 'news' || text.includes('뉴스') || text.includes('보도자료')) return 'news';
  if(source.includes('blog')) return 'blog';
  if(source.includes('cafe') || type === 'community') return 'cafe';
  if(source.includes('kin') || text.includes('지식') || text.includes('q&a')) return 'knowledge';
  if(source.includes('encyc') || host.includes('wikipedia.org') || host.includes('wikidata.org') || host.includes('namu.wiki') || host.includes('doopedia') || host.includes('britannica')) return 'knowledge';
  if(text.includes('관광') || text.includes('여행') || text.includes('명소') || text.includes('축제') || host.includes('visit')) return 'tour';
  if(text.includes('인스타') || text.includes('facebook') || text.includes('twitter') || text.includes('x.com') || source.includes('sns') || source.includes('social')) return 'sns';
  if(text.includes('쇼핑') || text.includes('가격') || text.includes('구매') || type === 'product' || mediaType === 'product') return 'shopping';
  if(text.includes('스포츠') || text.includes('축구') || text.includes('야구') || text.includes('농구')) return 'sports';
  if(text.includes('증권') || text.includes('주식') || text.includes('환율') || text.includes('금융')) return 'finance';
  if(text.includes('웹툰') || text.includes('webtoon')) return 'webtoon';
  if(host.endsWith('.go.kr') || host.includes('.go.kr') || host.endsWith('.gov') || host.includes('.gov.') || host.includes('gov.uk') || host.includes('korea.kr')) return 'official';
  return 'web';
}

function authorityBonusForItem(it, q){
  const url = safeString(firstNonEmpty(it && it.url, it && it.link)).toLowerCase();
  const host = domainOf(url).toLowerCase();
  const source = safeString(it && it.source).toLowerCase();
  const title = safeString(it && it.title).toLowerCase();
  const summary = safeString(firstNonEmpty(it && it.summary, it && it.description)).toLowerCase();
  const query = safeString(q).toLowerCase();
  const cat = classifySearchCategory(it);

  let bonus = 0;

  if(query && title === query) bonus += 6;
  if(query && title.includes(query)) bonus += 4;
  if(query && summary.includes(query)) bonus += 1.5;

  if(host.endsWith('.go.kr') || host.includes('.go.kr')) bonus += 10;
  if(host.endsWith('.or.kr') || host.includes('.or.kr')) bonus += 1.5;
  if(host.endsWith('.ac.kr') || host.includes('.ac.kr')) bonus += 3;
  if(host.endsWith('.gov') || host.includes('.gov.') || host.endsWith('.gov.uk') || host.includes('gov.uk')) bonus += 9;
  if(host.includes('go.jp') || host.includes('gov.cn') || host.includes('gouv.fr') || host.includes('bund.de')) bonus += 7;
  if(host.endsWith('.edu') || host.includes('.edu.') || host.includes('ac.uk') || host.includes('edu.cn')) bonus += 4;

  if(host.includes('busan.go.kr')) bonus += 10;
  if(host.includes('seoul.go.kr')) bonus += 10;
  if(host.includes('korea.kr')) bonus += 8;
  if(host.includes('visitbusan.net') || host.includes('visitseoul.net') || host.includes('visitkorea.or.kr')) bonus += 7;

  if(query && (query.includes('부산') || query.includes('busan')) && (host.includes('busan') || title.includes('부산광역시'))) bonus += 5;
  if(query && (query.includes('서울') || query.includes('seoul')) && (host.includes('seoul') || title.includes('서울특별시'))) bonus += 5;

  if(host.includes('wikipedia.org') || host.includes('wikidata.org')) bonus += 5;
  if(host.includes('namu.wiki')) bonus += 3;
  if(host.includes('britannica.com') || host.includes('doopedia.co.kr')) bonus += 3;

  if(source.includes('search-bank')) bonus += 0.8;
  if(cat === 'news') bonus += 1.8;
  if(cat === 'tour') bonus += 2.4;
  if(cat === 'map') bonus += 2.1;
  if(cat === 'knowledge') bonus += 1.7;
  if(cat === 'image' || cat === 'video') bonus += 1.4;
  if(it && isRealImageUrl(it.thumbnail)) bonus += 1.0;

  if(host.includes('google.com') && url.includes('/search?')) bonus -= 2;
  if(host.includes('youtube.com') && url.includes('/results?')) bonus -= 1;

  return bonus;
}

function matchesSearchType(it, searchType){
  const t = normalizeSearchType(searchType);
  if(t === 'all') return true;
  const cat = classifySearchCategory(it);
  if(t === 'web') return ['web','official'].includes(cat);
  if(t === 'map') return cat === 'map' || cat === 'tour';
  if(t === 'knowledge') return cat === 'knowledge' || cat === 'official';
  if(t === 'tour') return cat === 'tour' || cat === 'map';
  if(t === 'sns') return cat === 'sns';
  return cat === t;
}

function balanceMixedResults(ranked){
  const out = [];
  const used = new Set();
  const buckets = Object.create(null);

  // After the first authority cards, rotate through human-useful verticals.
  const order = ['news','tour','map','knowledge','image','video','blog','cafe','web','official','sns','shopping','sports','finance','webtoon'];

  for(const it of ranked){
    const cat = classifySearchCategory(it);
    it._category = cat;
    (buckets[cat] || (buckets[cat] = [])).push(it);
  }

  function itemKey(it){
    return safeString(firstNonEmpty(it && it.id, it && it.url, it && it.link, it && it.title));
  }

  function take(cat, n){
    const arr = buckets[cat] || [];
    let c = 0;
    while(arr.length && c < n){
      const it = arr.shift();
      const key = itemKey(it);
      if(!key || used.has(key)) continue;
      used.add(key);
      out.push(it);
      c += 1;
    }
  }

  // First screen target:
  // official authority 1~2, then news/tour/map/knowledge/image naturally mixed.
  take('official', 2);
  take('news', 2);
  take('tour', 2);
  take('map', 1);
  take('knowledge', 2);
  take('image', 2);
  take('video', 1);
  take('blog', 1);
  take('cafe', 1);

  let guard = 0;
  while(out.length < ranked.length && guard < ranked.length * 2){
    guard += 1;
    let moved = false;
    for(const cat of order){
      const arr = buckets[cat] || [];
      while(arr.length){
        const it = arr.shift();
        const key = itemKey(it);
        if(!key || used.has(key)) continue;
        used.add(key);
        out.push(it);
        moved = true;
        break;
      }
      if(out.length >= ranked.length) break;
    }
    if(!moved) break;
  }

  for(const it of ranked){
    const key = itemKey(it);
    if(key && !used.has(key)){
      used.add(key);
      out.push(it);
    }
  }

  return out;
}

function applyServerSideBoosts(items, opts){
  const q = safeString(opts && opts.q).toLowerCase();
  const lang = safeString(opts && opts.lang).toLowerCase();
  const searchType = normalizeSearchType(opts && opts.searchType);

  const ranked = (Array.isArray(items) ? items : [])
    .filter(it => matchesSearchType(it, searchType))
    .map((it, idx) => {
      let bonus = authorityBonusForItem(it, q);
      if(lang && safeString(it.lang).toLowerCase() === lang) bonus += 1;
      const finalScore = Number(it._coreScore || it.score || 0) + bonus;
      const category = classifySearchCategory(it);
      return Object.assign({}, it, {
        _bonus: bonus,
        _authorityScore: bonus,
        _finalScore: finalScore,
        _seq: idx,
        _category: category,
        searchType: category
      });
    });

  ranked.sort((a,b) =>
    ((b._finalScore || 0) - (a._finalScore || 0)) ||
    ((b._authorityScore || 0) - (a._authorityScore || 0)) ||
    ((a._seq || 0) - (b._seq || 0))
  );

  if(searchType !== 'all') return ranked;
  return balanceMixedResults(ranked);
}

async function postJson(url, body){
  try{
    const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, 2500);
    if(!res || !res.ok) return null;
    const text = await res.text();
    try { return JSON.parse(text); } catch(e) { return { ok: true, raw: text }; }
  }catch(e){ return null; }
}

let RevenueEngine = null;
let RevenueEngineLoaded = false;
function getRevenueEngine(){
  if(RevenueEngineLoaded) return RevenueEngine;
  RevenueEngineLoaded = true;
  try { RevenueEngine = require('./revenue-engine'); } catch(e) { RevenueEngine = null; }
  return RevenueEngine;
}

async function callRevenueEngineInternal(body){
  try{
    const engine = getRevenueEngine();
    if(!engine) return null;
    if(typeof engine.runEngine === 'function') return await engine.runEngine(body || {});
    if(typeof engine.dispatch === 'function') return await engine.dispatch(body || {});
    if(typeof engine.handle === 'function') return await engine.handle(body || {});
    if(typeof engine.handler === 'function'){
      const res = await engine.handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, queryStringParameters: {}, body: JSON.stringify(body || {}) });
      if(!res) return null;
      if(typeof res === 'object' && Object.prototype.hasOwnProperty.call(res, 'body')){
        try { return JSON.parse(res.body || '{}'); } catch(e) { return res; }
      }
      return res;
    }
    if(typeof engine === 'function') return await engine(body || {});
    return null;
  }catch(e){ return null; }
}

async function syncSearchAnalytics(event, q, items){
  return await callRevenueEngineInternal({ action: 'track', event: { type: 'search', query: q, count: Array.isArray(items) ? items.length : 0, timestamp: Date.now() } });
}

async function distributeRevenue(event, items){
  const queue = (Array.isArray(items) ? items : []).filter(item => item && (item.type === 'ad' || item.type === 'product' || item.mediaType === 'product'));
  await Promise.all(queue.map(item => callRevenueEngineInternal({ action: 'distribute', producerId: item.producerId || (item.payload && item.payload.producerId) || 'global', amount: item._finalScore || item._coreScore || item.score || 1 })));
  return { ok: true, count: queue.length };
}


function parseEventJsonBody(event){
  try{
    const raw = event && event.body;
    if(!raw) return {};
    const text = event && event.isBase64Encoded
      ? Buffer.from(raw, 'base64').toString('utf8')
      : safeString(raw);
    if(!text.trim()) return {};
    return JSON.parse(text);
  }catch(e){
    return {};
  }
}


exports.handler = async function(event){
  try{
    const picked = pickQ(event || {});
    const { q, limit, start, lang, deep, externalOff, externalMode, noMedia, searchType, raw } = picked;

    const action = safeString((raw && (raw.action || raw.mode || raw.fn)) || '').trim().toLowerCase();
    if(action === 'enrich-images' || action === 'enrichimages' || action === 'image-enrich'){
      const payload = parseEventJsonBody(event || {});
      const incoming = Array.isArray(payload.items) ? payload.items : [];
      const trace = [];
      const started = nowMs();

      const enriched = await enrichOwnImages(incoming, {
        trace,
        timeLeft: () => Math.max(0, 6500 - (nowMs() - started))
      });

      const items = enriched.map(compactResultItem);
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        action: 'enrich-images',
        query: q,
        items,
        results: items,
        meta: {
          count: items.length,
          imagePolicy: 'render-page-own-og-image-only',
          trace,
          elapsedMs: nowMs() - started
        }
      });
    }

    if(!q){
      return ok({ status: 'ok', engine: 'maru-search', version: VERSION, query: q, source: null, items: [], results: [], meta: { count: 0, limit } });
    }
    const base = await orchestrateSearch({ event, q, limit, start, lang, deep, externalOff, externalMode, noMedia, searchType });
    // Search must not trigger heavy settlement/distribution by default.
    // Analytics is opt-in for this endpoint; weekly settlement is handled by revenue/commerce engines.
    const analyticsRequested = truthy(raw && (raw.analytics || raw.track || raw.enableAnalytics)) || truthy(process.env.MARU_SEARCH_ANALYTICS);
    const realtimeRevenueRequested = truthy(raw && (raw.realtimeRevenue || raw.distributeNow || raw.enableRealtimeRevenue)) || truthy(process.env.MARU_SEARCH_REALTIME_REVENUE);
    const analyticsOff = truthy(raw && (raw.noAnalytics || raw.disableAnalytics)) || !analyticsRequested;
    const revenueOff = truthy(raw && (raw.noRevenue || raw.disableRevenue)) || !realtimeRevenueRequested;
    if(!analyticsOff) syncSearchAnalytics(event, q, base.items).catch(() => null);
    if(!revenueOff) distributeRevenue(event, base.items).catch(() => null);
    return ok({
      status: 'ok', engine: 'maru-search', version: VERSION, query: q, source: base.source,
      items: base.items, results: base.items,
      meta: Object.assign({}, base.meta || {}, { count: (base.items || []).length, limit, region: base.region || null, route: base.route || null, sourceRoute: base.sourceRoute || base.route || null, analyticsSuppressed: analyticsOff, revenueSuppressed: revenueOff, settlementMode: 'weekly_batch', settlementCronUTC: '30 12 * * 1' })
    });
  }catch(e){
    return fail('Search failed', String((e && e.message) || e));
  }
};

async function maruSearchDispatcher(req){
  req = req || {};
  const res = await exports.handler({ queryStringParameters: {
    q: safeString(req.q || req.query || '').trim(),
    limit: req.limit,
    start: req.start,
    lang: req.lang || req.uiLang || req.locale,
    deep: req.deep,
    external: req.external,
    noExternal: req.noExternal,
    disableExternal: req.disableExternal,
    noMedia: req.noMedia,
    disableMedia: req.disableMedia,
    type: req.type || req.category || req.tab || req.vertical,
    noAnalytics: req.noAnalytics,
    noRevenue: req.noRevenue
  }, headers: req.headers || {} });
  try { return JSON.parse(res.body || '{}'); }
  catch(e){ return { status: 'fail', message: 'BAD_JSON' }; }
}

exports.maruSearchDispatcher = maruSearchDispatcher;

exports.runEngine = async function(event, params){
  params = params || {};
  return await orchestrateSearch({
    event: event || {},
    q: safeString(params.q || params.query || '').trim(),
    limit: params.limit || DEFAULT_LIMIT,
    start: params.start || 1,
    lang: params.lang || params.uiLang || params.locale || null,
    deep: truthy(params.deep) || String(params.external || '').toLowerCase() === 'deep',
    externalOff: explicitExternalBlocked(params),
    externalMode: explicitExternalBlocked(params) ? 'off' : (explicitExternalRequested(params) || truthy(params.deep) ? 'force' : 'auto'),
    noMedia: truthy(params.noMedia) || truthy(params.disableMedia),
    searchType: params.type || params.category || params.tab || params.vertical || 'all'
  });
};
