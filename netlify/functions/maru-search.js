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

const VERSION = 'A1.5.36-590-pinned-visible15-google-sns-youtube';
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
const OG_IMAGE_ENRICH_LIMIT = 36;
const OG_IMAGE_ENRICH_CONCURRENCY = 6;
const OG_IMAGE_ENRICH_TIMEOUT_MS = 1200;
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
    book: 'book', books: 'book', 도서: 'book', 책: 'book',
    webtoon: 'webtoon', cartoon: 'webtoon'
  };
  return alias[raw] || 'all';
}

function safeString(v){ return String(v == null ? '' : v); }
function envFirst(){
  for(let i=0; i<arguments.length; i++){
    const key = arguments[i];
    const val = key && process && process.env ? process.env[key] : '';
    if(safeString(val).trim()) return val;
  }
  return '';
}
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



function isHardRejectImageUrl(imageUrl){
  const s = safeString(imageUrl).toLowerCase();
  if(!s) return true;

  const hardBad = [
    'favicon',
    'apple-touch-icon',
    '/icon-',
    '/icons/',
    'sprite',
    'spacer',
    'blank.gif',
    'blank.png',
    'transparent',
    '1x1',
    'pixel',
    'tracking',
    'analytics',
    'captcha',
    'placeholder',
    'noimage',
    'no_image',
    'no-img',
    'default-image',
    'default_img'
  ];

  if(hardBad.some(k => s.includes(k))) return true;
  if(/\.(ico)(\?|#|$)/i.test(s)) return true;

  // SVG is often a logo/icon. Do not globally reject it if it is a real provider thumbnail,
  // but reject obvious logo/icon SVG paths.
  if(/\.(svg)(\?|#|$)/i.test(s) && /(logo|symbol|icon|emblem|brand|ci|bi)/i.test(s)) return true;

  return false;
}

function isSoftBrandImageUrl(imageUrl){
  const s = safeString(imageUrl).toLowerCase();
  if(!s) return false;

  const softBad = [
    'logo',
    'symbol',
    'emblem',
    'slogan',
    'brand',
    '/ci',
    '_ci',
    '-ci',
    '/bi',
    '_bi',
    '-bi',
    'header_logo',
    'footer_logo',
    'sns_logo'
  ];

  return softBad.some(k => s.includes(k));
}

function providerSuppliedThisImage(it, imageUrl){
  const target = safeString(imageUrl).trim();
  if(!target) return false;

  let targetKey = target.split('#')[0].toLowerCase();
  try{
    const u = new URL(target);
    targetKey = (u.origin + u.pathname).toLowerCase();
  }catch(e){}

  return providedMediaCandidatesForItem(it).some(v => {
    const s = safeString(v).trim();
    if(!s) return false;
    let key = s.split('#')[0].toLowerCase();
    try{
      const u = new URL(s);
      key = (u.origin + u.pathname).toLowerCase();
    }catch(e){}
    return key === targetKey || s === target;
  });
}


function isLikelyMeaninglessImageUrl(imageUrl){
  // This function must be conservative.
  // We only reject images that are almost certainly unusable in search cards.
  // Provider-supplied thumbnails should not be dropped just because the URL contains
  // words like logo/brand/banner; many real news/company/tourism thumbnails use such paths.
  return isHardRejectImageUrl(imageUrl);
}

function isGenericGovOfficialItem(it){
  const url = safeString(firstNonEmpty(it && it.url, it && it.link)).toLowerCase();
  const host = domainOf(url).toLowerCase();

  const isGov =
    host.includes('.go.kr') ||
    host.endsWith('.gov') ||
    host.includes('.gov.') ||
    host.includes('gov.uk') ||
    host.includes('go.jp') ||
    host.includes('gov.cn');

  return !!isGov;
}

function isMeaningfulImageForItem(imageUrl, it){
  const img = safeString(imageUrl).trim();
  if(!isRealImageUrl(img)) return false;

  if(isHardRejectImageUrl(img)) return false;

  const source = safeString(it && it.source).toLowerCase();
  const type = safeString(it && it.type).toLowerCase();
  const mediaType = safeString(it && it.mediaType).toLowerCase();

  const isMediaResult =
    source.includes('image') ||
    source.includes('youtube') ||
    source.includes('video') ||
    source.includes('news') ||
    type === 'image' ||
    type === 'video' ||
    mediaType === 'image' ||
    mediaType === 'video';

  const providerSupplied = providerSuppliedThisImage(it, img);

  // Provider/API supplied media should be preserved unless it is a hard reject.
  if(providerSupplied || isMediaResult) return true;

  // For page-scanned fallback images, still avoid obvious brand/logo-only assets.
  // But do not block an entire government/official page just because it is official.
  if(isSoftBrandImageUrl(img)) return false;

  return true;
}


function imageResolutionHint(imageUrl){
  const raw = safeString(imageUrl).trim();
  const low = raw.toLowerCase();
  let bestW = 0;
  let bestH = 0;

  function keep(w, h){
    w = parseInt(w, 10) || 0;
    h = parseInt(h, 10) || 0;
    if(w > 0 && h > 0 && w * h > bestW * bestH){
      bestW = w;
      bestH = h;
    }
  }

  const pathDims = low.match(/(?:^|[^\d])([1-9]\d{2,4})[x_-]([1-9]\d{2,4})(?:[^\d]|$)/);
  if(pathDims) keep(pathDims[1], pathDims[2]);

  try{
    const u = new URL(raw);
    const sp = u.searchParams;
    keep(sp.get('w') || sp.get('width') || sp.get('imageWidth') || sp.get('resizeWidth'), sp.get('h') || sp.get('height') || sp.get('imageHeight') || sp.get('resizeHeight'));
    const size = sp.get('size') || sp.get('s');
    const m = safeString(size).match(/([1-9]\d{2,4})[x_-]([1-9]\d{2,4})/i);
    if(m) keep(m[1], m[2]);
  }catch(e){}

  return { width: bestW, height: bestH, pixels: bestW * bestH };
}

function imagePurposePenalty(imageUrl, it){
  const lowUrl = safeString(imageUrl).toLowerCase();
  const text = [lowUrl, safeString(it && it.title), safeString(it && it.summary), safeString(it && it.source)].join(' ').toLowerCase();
  let penalty = 0;
  const hardNoise = ['favicon','apple-touch-icon','sprite','spacer','blank','pixel','tracking','captcha','qr','placeholder','noimage','no-image','no_img'];
  if(hardNoise.some(k => text.includes(k))) penalty += 80;

  const source = safeString(it && it.source).toLowerCase();
  const type = safeString(it && it.type).toLowerCase();
  const mediaType = safeString(it && it.mediaType).toLowerCase();
  const isProviderMedia = /naver_image|google_image|youtube|video|image/.test(source) || type === 'image' || type === 'video' || mediaType === 'image' || mediaType === 'video';

  const brandNoise = ['logo','symbol','emblem','slogan','brandmark','watermark','sprite'];
  if(!isProviderMedia && brandNoise.some(k => text.includes(k))) penalty += 30;
  const adNoise = ['adserver','doubleclick','banner','ads/','advertisement','promo-banner','tracking'];
  if(adNoise.some(k => text.includes(k))) penalty += 25;
  return penalty;
}

function imageQualityScore(imageUrl, it){
  const u = safeString(imageUrl).trim();
  const low = u.toLowerCase();
  if(!isRealImageUrl(u)) return -999;

  let score = 0;
  if(/\.(jpg|jpeg|png|webp|avif)(\?|#|$)/i.test(low)) score += 10;
  if(/original|origin|source|full|large|xlarge|xl|high|photo|image|og:image|represent|main|hero|visual/i.test(low)) score += 10;
  if(/maxresdefault|sddefault|hqdefault/i.test(low)) score += 10;
  if(/mqdefault|default\.jpg/i.test(low)) score += 1;
  if(/thumb|thumbnail|small|mini|150x|100x|80x|64x/i.test(low)) score -= 6;

  const dim = imageResolutionHint(u);
  if(dim.pixels >= 1600000) score += 18;
  else if(dim.pixels >= 900000) score += 14;
  else if(dim.pixels >= 480000) score += 9;
  else if(dim.pixels >= 180000) score += 4;
  else if(dim.pixels > 0) score -= 8;

  const source = safeString(it && it.source).toLowerCase();
  const mediaType = safeString(it && it.mediaType).toLowerCase();
  const type = safeString(it && it.type).toLowerCase();
  if(source.includes('naver_image') || source.includes('google_image')) score += 12;
  else if(source.includes('image') || mediaType === 'image' || type === 'image') score += 8;
  if(source.includes('youtube') || mediaType === 'video' || type === 'video') score += 7;
  if(source.includes('news')) score += 3;

  const explicitOriginal = [it && it.originalImage, it && it.fullImage, it && it.imageOriginal, it && it.viewerImage, it && it.openImageUrl, it && it.contentUrl].some(v => safeString(v).trim() === u);
  if(explicitOriginal) score += 16;
  score -= imagePurposePenalty(u, it);
  return score;
}

function qualitySortImagesForItem(images, it){
  return compactImages(Array.isArray(images) ? images : [])
    .filter(img => isMeaningfulImageForItem(img, it))
    .map((img, idx) => ({ img, idx, score: imageQualityScore(img, it) }))
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
    .map(x => x.img);
}

function mediaQualityProfileForItem(it, images){
  const list = qualitySortImagesForItem(images, it);
  const first = list.length ? list[0] : (Array.isArray(images) && images.length ? images[0] : '');
  const score = imageQualityScore(first, it);
  const dim = imageResolutionHint(first);
  return {
    enabled: true,
    selectedScore: score,
    selectedWidth: dim.width || undefined,
    selectedHeight: dim.height || undefined,
    selection: 'highest-quality-content-image',
    preference: 'prefer-original-large-content-image-over-logo-banner-thumbnail',
    enhanceHint: {
      color: 'balanced-saturation',
      contrast: 'soft-contrast',
      sharpness: 'light-sharpen',
      upscale: score < 8 ? 'recommended' : 'not-needed'
    }
  };
}



function providedMediaCandidatesForItem(it){
  it = (it && typeof it === 'object') ? it : {};
  const p = (it.payload && typeof it.payload === 'object') ? it.payload : {};
  const media = (it.media && typeof it.media === 'object') ? it.media : {};
  const preview = (media.preview && typeof media.preview === 'object') ? media.preview : {};
  const pMedia = (p.media && typeof p.media === 'object') ? p.media : {};
  const pPreview = (pMedia.preview && typeof pMedia.preview === 'object') ? pMedia.preview : {};

  const source = safeString(it.source || p.source).toLowerCase();
  const type = safeString(it.type || p.type).toLowerCase();
  const mediaType = safeString(it.mediaType || p.mediaType).toLowerCase();
  const isImageLike = source.includes('image') || type === 'image' || mediaType === 'image';

  const direct = [
    // Explicit original/full-size fields first. The sorter still validates and scores them.
    it.originalImage, it.fullImage, it.imageOriginal, it.viewerImage, it.openImageUrl, it.contentUrl,
    it.imageUrl, it.image_url, it.og_image, it.ogImage, it.image, it.poster,
    preview.original, preview.image, preview.poster, preview.thumbnail, preview.thumb,
    it.thumbnail, it.thumb,

    p.originalImage, p.fullImage, p.imageOriginal, p.viewerImage, p.openImageUrl, p.contentUrl,
    p.imageUrl, p.image_url, p.og_image, p.ogImage, p.image, p.poster,
    pPreview.original, pPreview.image, pPreview.poster, pPreview.thumbnail, pPreview.thumb,
    p.thumbnail, p.thumb
  ];

  // Some image APIs use link as the actual image URL and originallink/contextLink as the page URL.
  if(isImageLike){
    direct.unshift(it.link, it.url, p.link, p.url, p.contextLink);
  }

  return direct
    .concat(Array.isArray(it.imageSet) ? it.imageSet : [])
    .concat(Array.isArray(p.imageSet) ? p.imageSet : []);
}

function hasProviderSuppliedMedia(it){
  return providedMediaCandidatesForItem(it).some(x => isRealImageUrl(x));
}


function naturalImagesForItem(it, maxCount){
  const candidates = providedMediaCandidatesForItem(it);
  const images = qualitySortImagesForItem(candidates, it);
  const out = [];
  const seen = new Set();

  for(const img of images){
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

function youtubeIdFromUrl(url){
  const u = safeString(url);
  const m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) || u.match(/embed\/([A-Za-z0-9_-]{11})/);
  return m && m[1] ? m[1] : '';
}

function youtubePosterCandidates(videoId, current){
  const id = safeString(videoId).trim();
  const out = [];
  if(current) out.push(current);
  if(id){
    out.push('https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg');
    out.push('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg');
    out.push('https://i.ytimg.com/vi/' + id + '/mqdefault.jpg');
  }
  return compactImages(out);
}

function isYoutubeLikeItem(it){
  it = (it && typeof it === 'object') ? it : {};
  const p = (it.payload && typeof it.payload === 'object') ? it.payload : {};
  const url = safeString(firstNonEmpty(it.url, it.link, it.href, p.url, p.link, it.videoUrl, p.videoUrl)).toLowerCase();
  const source = safeString(firstNonEmpty(it.source, p.source)).toLowerCase();
  const type = safeString(firstNonEmpty(it.type, it.mediaType, p.type, p.mediaType)).toLowerCase();
  return !!(
    source.includes('youtube') ||
    source.includes('youtu.be') ||
    url.includes('youtube.com') ||
    url.includes('youtu.be') ||
    firstNonEmpty(it.videoId, p.videoId, youtubeIdFromUrl(url)) ||
    (type === 'video' && source.includes('youtube'))
  );
}

function preferredYoutubePoster(videoId, current){
  const id = safeString(videoId).trim();
  const cur = safeString(current).trim();
  if(id) return 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg';
  return cur;
}

function mediaProfileForItem(it){
  it = (it && typeof it === 'object') ? it : {};
  const p = (it.payload && typeof it.payload === 'object') ? it.payload : {};
  const url = safeString(firstNonEmpty(it.url, it.link, it.href, p.url, p.link, p.contextLink)).trim();
  const sourceText = safeString(firstNonEmpty(it.source, p.source)).toLowerCase();
  const typeText = safeString(firstNonEmpty(it.type, it.mediaType, p.type, p.mediaType)).toLowerCase();
  const videoId = firstNonEmpty(it.videoId, p.videoId, youtubeIdFromUrl(url));
  const youtubeLike = isYoutubeLikeItem(Object.assign({}, it, { source: sourceText, type: typeText, mediaType: typeText, videoId, url, link: url }));

  let images = naturalImagesForItem(it, youtubeLike ? 1 : 6);

  if(youtubeLike){
    const representative = preferredYoutubePoster(videoId, images[0] || firstNonEmpty(
      it.originalImage, it.fullImage, it.imageOriginal, it.viewerImage, it.openImageUrl, it.contentUrl,
      it.imageUrl, it.image, it.thumbnail, it.thumb,
      p.originalImage, p.fullImage, p.imageOriginal, p.imageUrl, p.image, p.thumbnail, p.thumb
    ));
    images = compactImages([representative]);
    const thumb = images[0] || representative || '';
    const videoUrl = videoId ? 'https://www.youtube.com/watch?v=' + videoId : (typeText === 'video' ? url : firstNonEmpty(it.videoUrl, p.videoUrl));
    const embedUrl = videoId ? 'https://www.youtube.com/embed/' + videoId : firstNonEmpty(it.embedUrl, p.embedUrl);
    return {
      thumbnail: thumb,
      image: thumb,
      imageSet: thumb ? [thumb] : [],
      originalImage: thumb,
      fullImage: thumb,
      viewerImage: thumb,
      openImageUrl: thumb,
      contentUrl: thumb,
      selectedImageQuality: imageQualityScore(thumb, it),
      selectedCardImageQuality: imageQualityScore(thumb, it),
      videoId,
      videoUrl,
      watchUrl: videoUrl,
      embedUrl,
      openUrl: videoUrl || url,
      pageUrl: url
    };
  }

  const explicitOriginals = qualitySortImagesForItem([
    it.originalImage, it.fullImage, it.imageOriginal, it.viewerImage, it.openImageUrl, it.contentUrl,
    p.originalImage, p.fullImage, p.imageOriginal, p.image, p.imageUrl, p.thumb
  ].concat(images), it);

  const original = explicitOriginals[0] || images[0] || '';
  const bestDisplay = qualitySortImagesForItem([original].concat(images), it)[0] || original || images[0] || '';
  const imageSet = qualitySortImagesForItem([bestDisplay, original].concat(images), it).slice(0, 6);
  const thumb = bestDisplay || original || '';
  const videoUrl = videoId ? 'https://www.youtube.com/watch?v=' + videoId : (typeText === 'video' ? url : firstNonEmpty(it.videoUrl, p.videoUrl));
  const embedUrl = videoId ? 'https://www.youtube.com/embed/' + videoId : firstNonEmpty(it.embedUrl, p.embedUrl);

  return {
    thumbnail: thumb,
    image: original || thumb,
    imageSet: imageSet.length ? imageSet : compactImages([thumb, original]),
    originalImage: original || thumb,
    fullImage: original || thumb,
    viewerImage: original || thumb,
    openImageUrl: original || thumb,
    contentUrl: original || thumb,
    selectedImageQuality: imageQualityScore(original || thumb, it),
    selectedCardImageQuality: imageQualityScore(thumb || original, it),
    videoId,
    videoUrl,
    watchUrl: videoUrl,
    embedUrl,
    openUrl: videoUrl || url,
    pageUrl: url
  };
}

function compactResultItem(it){
  it = (it && typeof it === 'object') ? it : {};

  const type = it.type || 'web';
  const mediaType = it.mediaType || (type === 'image' ? 'image' : (type === 'video' ? 'video' : 'article'));
  const profile = mediaProfileForItem(it);
  const youtubeLike = isYoutubeLikeItem(Object.assign({}, it, { type, mediaType, videoId: profile.videoId, videoUrl: profile.videoUrl, watchUrl: profile.watchUrl }));
  const ownImages = youtubeLike && profile.thumbnail ? [profile.thumbnail] : (profile.imageSet || []);
  const ownThumb = profile.thumbnail || '';
  const originalImage = youtubeLike ? ownThumb : (profile.originalImage || ownThumb || '');
  const mediaBase = (it.media && typeof it.media === 'object') ? Object.assign({}, it.media) : undefined;
  const previewBase = (mediaBase && mediaBase.preview && typeof mediaBase.preview === 'object') ? Object.assign({}, mediaBase.preview) : {};

  const media = mediaBase || (mediaType === 'video' || ownThumb ? { type: mediaType === 'video' ? 'video' : 'image' } : undefined);
  if(media){
    if(youtubeLike){
      media.type = 'video';
      media.preview = Object.assign({}, previewBase, {
        poster: ownThumb || originalImage,
        image: ownThumb || originalImage,
        original: ownThumb || originalImage,
        thumbnail: ownThumb || originalImage,
        thumb: ownThumb || originalImage,
        videoUrl: firstNonEmpty(profile.videoUrl, previewBase.videoUrl),
        embedUrl: firstNonEmpty(profile.embedUrl, previewBase.embedUrl)
      });
    }else{
      media.preview = Object.assign({}, previewBase, {
        poster: firstNonEmpty(previewBase.poster, ownThumb, originalImage),
        image: firstNonEmpty(previewBase.image, originalImage, ownThumb),
        original: firstNonEmpty(previewBase.original, originalImage, ownThumb),
        videoUrl: firstNonEmpty(previewBase.videoUrl, profile.videoUrl),
        embedUrl: firstNonEmpty(previewBase.embedUrl, profile.embedUrl)
      });
    }
  }

  return {
    id: safeString(firstNonEmpty(it.id, it.url, it.link, it.title)).trim(),
    type,
    mediaType,
    title: safeString(it.title).trim(),
    summary: safeString(firstNonEmpty(it.summary, it.snippet, it.description)).trim(),
    description: safeString(firstNonEmpty(it.description, it.summary, it.snippet)).trim(),
    url: safeString(firstNonEmpty(it.url, it.link, it.href, profile.openUrl)).trim(),
    link: safeString(firstNonEmpty(it.link, it.url, it.href, profile.openUrl)).trim(),
    source: it.source || null,
    lang: it.lang || null,
    thumbnail: ownThumb,
    thumb: ownThumb,
    image: firstNonEmpty(originalImage, ownThumb),
    imageUrl: firstNonEmpty(originalImage, ownThumb),
    imageSet: ownImages,
    originalImage,
    fullImage: originalImage,
    imageOriginal: originalImage,
    viewerImage: originalImage,
    openImageUrl: originalImage,
    contentUrl: originalImage,
    cardImage: ownThumb || originalImage,
    mediaQuality: mediaQualityProfileForItem(it, ownImages),
    selectedImageQuality: profile.selectedImageQuality,
    selectedCardImageQuality: profile.selectedCardImageQuality,
    clickTargetType: profile.videoUrl ? 'video' : (originalImage ? 'image' : 'page'),
    media,
    videoId: profile.videoId || undefined,
    videoUrl: profile.videoUrl || undefined,
    watchUrl: profile.watchUrl || undefined,
    embedUrl: profile.embedUrl || undefined,
    openUrl: profile.openUrl || undefined,
    pageUrl: profile.pageUrl || undefined,
    channel: it.channel || undefined,
    section: it.section || undefined,
    page: it.page || undefined,
    psom_key: it.psom_key || undefined,
    route: it.route || undefined,
    bind: it.bind && typeof it.bind === 'object' ? it.bind : undefined,
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 12) : [],
    score: typeof it.score === 'number' ? it.score : undefined,
    _finalScore: typeof it._finalScore === 'number' ? it._finalScore : undefined,
    _authorityScore: typeof it._authorityScore === 'number' ? it._authorityScore : undefined,
    searchCategory: it.searchCategory || it.searchType || it._category || classifySearchCategory(it),
    displayGroup: it.displayGroup || sectionIdForItem(it),
    sectionId: it.sectionId || sectionIdForItem(it),
    sectionTitle: it.sectionTitle || (SEARCH_SECTION_META[sectionIdForItem(it)] && SEARCH_SECTION_META[sectionIdForItem(it)].title),
    _category: it._category || classifySearchCategory(it)
  };
}



// =========================================================
// SEARCH RESULT SECTION PACK — FRONT SECTION SUPPLY LAYER
// ---------------------------------------------------------
// Additive only: keeps the flat items/results list unchanged while also
// supplying Naver/Google-like expandable sections for front pages.
// =========================================================
const SEARCH_SECTION_ORDER = [
  'official_authority',
  'map_local_tour',
  'knowledge_wiki',
  'news',
  'video_vlog',
  'image_gallery',
  'blog_review',
  'community_sns',
  'shopping_product',
  'company_web',
  'general_web'
];

const SEARCH_SECTION_META = {
  official_authority: {
    title: '공식 / 관공서 / 권위 정보',
    label: '공식/권위',
    previewLimit: 6,
    rank: 10,
    description: '정부·공공기관·공식 홈페이지·권위 출처를 먼저 보여주는 섹션'
  },
  map_local_tour: {
    title: '지도 / 지역 / 관광 / 맛집',
    label: '지도/관광',
    previewLimit: 8,
    rank: 20,
    description: '지도, 위치, 교통, 관광지, 맛집, 볼거리 결과'
  },
  knowledge_wiki: {
    title: '위키 / 백과 / 지식',
    label: '지식/백과',
    previewLimit: 6,
    rank: 30,
    description: '위키, 백과, 지식, 연구·자료형 결과'
  },
  news: {
    title: '뉴스 / 보도 / 최신 이슈',
    label: '뉴스',
    previewLimit: 8,
    rank: 40,
    description: '뉴스, 보도자료, 최신 이슈 결과'
  },
  video_vlog: {
    title: '동영상 / 유튜브 / 브이로그',
    label: '영상',
    previewLimit: 8,
    rank: 50,
    description: '유튜브, 영상, 브이로그, 쇼츠·릴스 계열 결과'
  },
  image_gallery: {
    title: '이미지 / 사진 / 홍보 스냅샷',
    label: '이미지',
    previewLimit: 10,
    rank: 60,
    description: '원본 이미지, 대표 이미지, 홍보 사진, 갤러리 결과'
  },
  blog_review: {
    title: '블로그 / 리뷰 / 후기',
    label: '블로그/리뷰',
    previewLimit: 8,
    rank: 70,
    description: '블로그, 리뷰, 여행기, 방문 후기 결과'
  },
  community_sns: {
    title: 'SNS / 커뮤니티 / 카페',
    label: 'SNS/커뮤니티',
    previewLimit: 8,
    rank: 80,
    description: '인스타그램, 페이스북, 틱톡, X, 카페, 커뮤니티 결과'
  },
  shopping_product: {
    title: '상품 / 쇼핑 / 광고',
    label: '상품/쇼핑',
    previewLimit: 8,
    rank: 90,
    description: '상품, 가격, 쇼핑, 광고·홍보형 결과'
  },
  company_web: {
    title: '기업 / 홈페이지 / 일반 웹',
    label: '기업/웹',
    previewLimit: 8,
    rank: 100,
    description: '회사, 브랜드, 공식 사이트, 일반 웹페이지 결과'
  },
  general_web: {
    title: '기타 웹 결과',
    label: '웹',
    previewLimit: 8,
    rank: 110,
    description: '다른 섹션에 속하지 않는 일반 웹 결과'
  }
};

function sectionIdForItem(it){
  const category = safeString((it && (it._category || it.searchCategory || it.searchType || it.type)) || '').toLowerCase() || classifySearchCategory(it);
  const url = safeString(firstNonEmpty(it && it.url, it && it.link, it && it.pageUrl)).toLowerCase();
  const host = domainOf(url).toLowerCase();
  const source = safeString(it && it.source).toLowerCase();
  const mediaType = safeString(it && it.mediaType).toLowerCase();
  const type = safeString(it && it.type).toLowerCase();
  const text = [host, source, type, mediaType, safeString(it && it.title), safeString(firstNonEmpty(it && it.summary, it && it.description))].join(' ').toLowerCase();

  if(category === 'official' || host.includes('.go.kr') || host.endsWith('.gov') || host.includes('.gov.') || host.includes('korea.kr') || /공식|관공서|시청|구청|정부|공공기관|official|government office/.test(text)) return 'official_authority';
  if(category === 'map' || category === 'tour' || mediaType === 'map' || type === 'map' || /지도|주소|위치|길찾기|관광|여행|맛집|명소|랜드마크|박물관|미술관|축제|교통|지하철|map|nearby|travel|tour|restaurant|landmark|attraction/.test(text)) return 'map_local_tour';
  if(category === 'knowledge' || category === 'book' || host.includes('wikipedia') || host.includes('wikidata') || host.includes('britannica') || host.includes('namu.wiki') || /위키|백과|지식|논문|연구|자료|encyclopedia|knowledge|research|paper/.test(text)) return 'knowledge_wiki';
  if(category === 'news' || source.includes('news') || /뉴스|속보|보도|신문|latest|breaking|press/.test(text)) return 'news';
  if(category === 'video' || mediaType === 'video' || type === 'video' || source.includes('youtube') || host.includes('youtube') || host.includes('youtu.be') || /동영상|영상|유튜브|브이로그|쇼츠|릴스|vlog|video|shorts|reels/.test(text)) return 'video_vlog';
  if(category === 'image' || mediaType === 'image' || type === 'image' || source.includes('image') || /이미지|사진|갤러리|포토|스냅샷|photo|image|gallery/.test(text)) return 'image_gallery';
  if(category === 'blog' || source.includes('blog') || host.includes('blog') || /블로그|후기|리뷰|방문기|blog|review/.test(text)) return 'blog_review';
  if(category === 'cafe' || category === 'sns' || source.includes('cafe') || source.includes('sns') || source.includes('social') || host.includes('instagram') || host.includes('facebook') || host.includes('tiktok') || host.includes('twitter') || host.includes('x.com') || host.includes('threads.net') || /카페|커뮤니티|인스타|페이스북|틱톡|트위터|SNS|community|forum|instagram|facebook|tiktok/.test(text)) return 'community_sns';
  if(category === 'shopping' || mediaType === 'product' || type === 'product' || /쇼핑|상품|가격|구매|판매|광고|프로모션|shopping|product|price|buy|sale|ad\b/.test(text)) return 'shopping_product';
  if(/회사|기업|브랜드|홈페이지|공식 사이트|company|corporate|brand|homepage|official site/.test(text)) return 'company_web';
  return 'general_web';
}

function sectionSortScore(item){
  const base = Number(item && (item._finalScore || item._authorityScore || item.score || 0)) || 0;
  const hasImage = isRealImageUrl(item && (item.thumbnail || item.image || item.originalImage || item.openImageUrl)) ? 1 : 0;
  const hasVideo = item && (item.videoUrl || item.watchUrl || item.embedUrl || item.mediaType === 'video' || item.type === 'video') ? 1 : 0;
  return base + (hasImage * 0.8) + (hasVideo * 0.6);
}

function buildSearchSections(items, q, opts){
  const list = Array.isArray(items) ? items : [];
  const buckets = Object.create(null);
  const seenBySection = Object.create(null);

  for(const raw of list){
    if(!raw || typeof raw !== 'object') continue;
    const sectionId = sectionIdForItem(raw);
    const sectionMeta = SEARCH_SECTION_META[sectionId] || SEARCH_SECTION_META.general_web;
    if(!buckets[sectionId]) buckets[sectionId] = [];
    if(!seenBySection[sectionId]) seenBySection[sectionId] = new Set();

    const key = safeString(firstNonEmpty(raw.url, raw.link, raw.openUrl, raw.id, raw.title)).toLowerCase();
    if(!key || seenBySection[sectionId].has(key)) continue;
    seenBySection[sectionId].add(key);

    buckets[sectionId].push(Object.assign({}, raw, {
      sectionId,
      sectionTitle: sectionMeta.title,
      sectionLabel: sectionMeta.label,
      sectionRank: sectionMeta.rank
    }));
  }

  const sections = SEARCH_SECTION_ORDER.map(sectionId => {
    const meta = SEARCH_SECTION_META[sectionId] || SEARCH_SECTION_META.general_web;
    const all = (buckets[sectionId] || []).slice().sort((a,b) => sectionSortScore(b) - sectionSortScore(a));
    const previewLimit = meta.previewLimit || 6;
    return {
      id: sectionId,
      title: meta.title,
      label: meta.label,
      description: meta.description,
      rank: meta.rank,
      total: all.length,
      previewLimit,
      hasMore: all.length > previewLimit,
      items: all.slice(0, previewLimit),
      more: {
        q: safeString(q || ''),
        type: sectionId,
        section: sectionId,
        perPage: previewLimit,
        action: 'expand-section'
      }
    };
  }).filter(section => section.total > 0);

  const sectionCounts = {};
  for(const section of sections) sectionCounts[section.id] = section.total;

  return {
    enabled: true,
    mode: 'grouped-expandable-search-sections',
    order: SEARCH_SECTION_ORDER,
    counts: sectionCounts,
    totalSections: sections.length,
    sections
  };
}


function buildVisiblePagePack(items, q, raw){
  raw = raw || {};
  const list = Array.isArray(items) ? items : [];
  const page = clampInt(firstNonEmpty(raw.page, raw.p, raw.visiblePage, raw.sectionPage), 1, 1, 100000);
  const perPage = clampInt(firstNonEmpty(raw.perPage, raw.pageSize, raw.visibleCardsPerPage, raw.visibleLimit, raw.cardsPerPage), 15, 1, 100);
  const totalItems = list.length;
  const totalPages = Math.max(totalItems ? 1 : 0, Math.ceil(totalItems / perPage));
  const safePage = totalPages ? Math.min(page, totalPages) : 1;
  const offset = totalPages ? (safePage - 1) * perPage : 0;
  const pageItems = list.slice(offset, offset + perPage);

  return {
    enabled: true,
    mode: 'render-viewport-only-do-not-limit-search-body',
    q: safeString(q || ''),
    page: safePage,
    requestedPage: page,
    perPage,
    visibleCardsPerPage: perPage,
    visibleCount: pageItems.length,
    pageItems,
    totalItems,
    totalPages,
    hasPrevPage: totalPages ? safePage > 1 : false,
    hasNextPage: totalPages ? safePage < totalPages : false,
    prevPage: safePage > 1 ? safePage - 1 : null,
    nextPage: safePage < totalPages ? safePage + 1 : null,
    bodyPreserved: true,
    doesNotLimitItemsResults: true,
    sectionsPreserved: true
  };
}

function parseSectionListValue(v){
  if(Array.isArray(v)) return v.map(x => safeString(x).trim()).filter(Boolean);
  const s = safeString(v).trim();
  if(!s) return [];
  return s.split(/[|,\s]+/).map(x => safeString(x).trim()).filter(Boolean);
}

function normalizeSectionIdForViewport(v){
  const raw = safeString(v).trim().toLowerCase();
  if(!raw) return '';
  if(SEARCH_SECTION_META[raw]) return raw;
  const type = normalizeSearchType(raw);
  const map = {
    official: 'official_authority', authority: 'official_authority', gov: 'official_authority', government: 'official_authority',
    map: 'map_local_tour', maps: 'map_local_tour', tour: 'map_local_tour', travel: 'map_local_tour', local: 'map_local_tour',
    knowledge: 'knowledge_wiki', wiki: 'knowledge_wiki', encyclopedia: 'knowledge_wiki', book: 'knowledge_wiki',
    news: 'news', video: 'video_vlog', youtube: 'video_vlog', image: 'image_gallery', img: 'image_gallery',
    blog: 'blog_review', review: 'blog_review', sns: 'community_sns', social: 'community_sns', cafe: 'community_sns', community: 'community_sns',
    shopping: 'shopping_product', shop: 'shopping_product', product: 'shopping_product', company: 'company_web', web: 'general_web', all: ''
  };
  return map[raw] || map[type] || raw;
}

function expandedSectionSetFromRaw(raw){
  raw = raw || {};
  const arr = []
    .concat(parseSectionListValue(raw.expandedSections))
    .concat(parseSectionListValue(raw.openSections))
    .concat(parseSectionListValue(raw.expandedSectionIds))
    .concat(parseSectionListValue(raw.expandSections))
    .concat(parseSectionListValue(raw.expanded));
  const action = safeString(raw.action || raw.mode || raw.fn).trim().toLowerCase();
  if(action === 'expand-section' || action === 'expandsection'){
    arr.push.apply(arr, parseSectionListValue(firstNonEmpty(raw.sourceSectionId, raw.sectionId, raw.section, raw.type)));
  }
  return new Set(arr.map(normalizeSectionIdForViewport).filter(Boolean));
}

function buildSectionBucketsForViewport(items){
  const buckets = Object.create(null);
  const seen = Object.create(null);
  for(const raw of (Array.isArray(items) ? items : [])){
    if(!raw || typeof raw !== 'object') continue;
    const sectionId = sectionIdForItem(raw);
    if(!buckets[sectionId]) buckets[sectionId] = [];
    if(!seen[sectionId]) seen[sectionId] = new Set();
    const key = safeString(firstNonEmpty(raw.url, raw.link, raw.openUrl, raw.id, raw.title)).toLowerCase();
    if(key && seen[sectionId].has(key)) continue;
    if(key) seen[sectionId].add(key);
    buckets[sectionId].push(raw);
  }
  return buckets;
}

function buildCollapseAwareVisiblePagePack(items, q, raw, fullSectionPack){
  raw = raw || {};
  const list = Array.isArray(items) ? items : [];
  const page = clampInt(firstNonEmpty(raw.page, raw.p, raw.visiblePage, raw.sectionPage), 1, 1, 100000);
  const perPage = clampInt(firstNonEmpty(raw.perPage, raw.pageSize, raw.visibleCardsPerPage, raw.visibleLimit, raw.cardsPerPage), 15, 1, 100);
  const expandedSet = expandedSectionSetFromRaw(raw);
  const expandAll = truthy(raw.expandAll) || truthy(raw.allExpanded) || truthy(raw.sectionsExpanded);
  const buckets = buildSectionBucketsForViewport(list);
  const fullSections = (fullSectionPack && Array.isArray(fullSectionPack.sections)) ? fullSectionPack.sections : [];
  const fullById = Object.create(null);
  for(const section of fullSections){
    if(section && section.id) fullById[section.id] = section;
  }

  const orderedIds = SEARCH_SECTION_ORDER
    .filter(id => buckets[id] && buckets[id].length)
    .concat(Object.keys(buckets).filter(id => SEARCH_SECTION_ORDER.indexOf(id) < 0 && buckets[id] && buckets[id].length));

  const visibleStream = [];
  const sectionState = Object.create(null);
  let collapsedExcludedCount = 0;

  for(const sectionId of orderedIds){
    const meta = SEARCH_SECTION_META[sectionId] || SEARCH_SECTION_META.general_web;
    const all = (buckets[sectionId] || []).slice().sort((a,b) => sectionSortScore(b) - sectionSortScore(a));
    const full = fullById[sectionId] || null;
    const previewLimit = clampInt(firstNonEmpty(raw['previewLimit_' + sectionId], raw.previewLimit, full && full.previewLimit, meta.previewLimit), meta.previewLimit || 6, 1, 100);
    const expanded = !!(expandAll || expandedSet.has(sectionId));
    const visibleTotal = expanded ? all.length : Math.min(previewLimit, all.length);
    const collapsedCount = Math.max(0, all.length - visibleTotal);
    collapsedExcludedCount += collapsedCount;

    sectionState[sectionId] = {
      id: sectionId,
      title: meta.title,
      label: meta.label,
      rank: meta.rank,
      previewLimit,
      expanded,
      collapsed: !expanded,
      sourceTotal: all.length,
      visibleTotal,
      collapsedCount,
      hiddenCount: collapsedCount,
      collapsedItemsExcludedFromCount: true
    };

    for(let i=0; i<visibleTotal; i++){
      visibleStream.push(Object.assign({}, all[i], {
        sectionId,
        sourceSectionId: sectionId,
        sectionTitle: meta.title,
        sectionLabel: meta.label,
        sectionRank: meta.rank,
        visibleViewportCard: true,
        collapsedAwareViewportCard: true,
        sectionExpanded: expanded,
        sectionCollapsed: !expanded,
        sectionVisibleIndex: i,
        sectionVisibleTotal: visibleTotal,
        sectionSourceTotal: all.length,
        sectionCollapsedCount: collapsedCount
      }));
    }
  }

  const totalVisibleItems = visibleStream.length;
  const totalPages = Math.max(totalVisibleItems ? 1 : 0, Math.ceil(totalVisibleItems / perPage));
  const safePage = totalPages ? Math.min(page, totalPages) : 1;
  const offset = totalPages ? (safePage - 1) * perPage : 0;
  const pageItems = visibleStream.slice(offset, offset + perPage).map((it, idx) => Object.assign({}, it, {
    viewportIndex: idx,
    viewportGlobalIndex: offset + idx
  }));

  return {
    enabled: true,
    mode: 'collapse-aware-visible-card-viewport',
    q: safeString(q || ''),
    page: safePage,
    requestedPage: page,
    perPage,
    visibleCardsPerPage: perPage,
    visibleCount: pageItems.length,
    pageItems,
    totalItems: list.length,
    totalVisibleItems,
    totalPages,
    hasPrevPage: totalPages ? safePage > 1 : false,
    hasNextPage: totalPages ? safePage < totalPages : false,
    prevPage: safePage > 1 ? safePage - 1 : null,
    nextPage: safePage < totalPages ? safePage + 1 : null,
    expandedSections: Array.from(expandedSet),
    allSectionsExpanded: expandAll,
    collapsedExcludedCount,
    collapsedItemsExcludedFromCount: true,
    sectionState,
    bodyPreserved: true,
    doesNotLimitItemsResults: true,
    sectionsPreserved: true,
    principle: 'Only actually visible cards consume the 15-card viewport. Collapsed section items are excluded and later visible cards backfill the page.'
  };
}


function blockingImageEnrichRequested(event){
  const qs = (event && event.queryStringParameters) || {};
  return truthy(qs.enrichImages) || truthy(qs.imageEnrich) || truthy(qs.ogImages) || truthy(qs.waitImages) || truthy(process.env.MARU_SEARCH_BLOCKING_IMAGE_ENRICH);
}

function buildViewportDisplaySections(pageItems, q, fullSectionPack, visiblePagePack){
  const list = Array.isArray(pageItems) ? pageItems : [];
  const out = [];
  const fullSections = (fullSectionPack && Array.isArray(fullSectionPack.sections)) ? fullSectionPack.sections : [];
  const sectionState = (visiblePagePack && visiblePagePack.sectionState) || Object.create(null);
  const fullById = Object.create(null);
  for(const section of fullSections){
    if(section && section.id) fullById[section.id] = section;
  }

  let sectionSeq = 0;
  let current = null;

  function flush(){
    if(!current || !current.items.length) return;
    const firstId = current.sourceSectionId;
    const meta = SEARCH_SECTION_META[firstId] || SEARCH_SECTION_META.general_web;
    const full = fullById[firstId] || null;
    const state = sectionState[firstId] || {};
    const sourceTotal = typeof state.sourceTotal === 'number'
      ? state.sourceTotal
      : (full && typeof full.total === 'number' ? Math.max(full.total, current.items.length) : current.items.length);
    const visibleTotal = typeof state.visibleTotal === 'number' ? state.visibleTotal : sourceTotal;
    const collapsedCount = typeof state.collapsedCount === 'number' ? state.collapsedCount : Math.max(0, sourceTotal - visibleTotal);
    const firstVisibleIndex = current.items.reduce((min, it) => Math.min(min, typeof it.sectionVisibleIndex === 'number' ? it.sectionVisibleIndex : min), Number.POSITIVE_INFINITY);
    const lastVisibleIndex = current.items.reduce((max, it) => Math.max(max, typeof it.sectionVisibleIndex === 'number' ? it.sectionVisibleIndex : max), -1);
    const normalizedFirst = Number.isFinite(firstVisibleIndex) ? firstVisibleIndex : 0;
    const normalizedLast = lastVisibleIndex >= 0 ? lastVisibleIndex : (normalizedFirst + current.items.length - 1);
    const pageOverflowCount = Math.max(0, visibleTotal - normalizedLast - 1);

    out.push({
      id: firstId + '_viewport_' + (++sectionSeq),
      sourceSectionId: firstId,
      title: meta.title,
      label: meta.label,
      description: meta.description,
      rank: meta.rank,
      displayTotal: current.items.length,
      total: current.items.length,
      sourceTotal,
      sourceVisibleTotal: visibleTotal,
      previewLimit: current.items.length,
      hasMore: collapsedCount > 0 || pageOverflowCount > 0,
      collapsed: state.expanded === true ? false : true,
      expanded: state.expanded === true,
      collapsedCount,
      hiddenCount: collapsedCount,
      pageOverflowCount,
      collapsedItemsExcludedFromCount: true,
      items: current.items,
      more: {
        q: safeString(q || ''),
        type: firstId,
        section: firstId,
        sourceSectionId: firstId,
        action: collapsedCount > 0 ? 'expand-section' : (pageOverflowCount > 0 ? 'next-page' : 'none'),
        hiddenCount: collapsedCount,
        collapsedCount,
        pageOverflowCount,
        sourceTotal,
        sourceVisibleTotal: visibleTotal,
        visibleAlready: normalizedLast + 1,
        note: 'Collapsed items do not consume the 15-card viewport; expanded visible overflow is paginated.'
      }
    });
    current = null;
  }

  for(let i=0; i<list.length; i++){
    const raw = list[i];
    const sectionId = raw && raw.sourceSectionId ? raw.sourceSectionId : sectionIdForItem(raw);
    const meta = SEARCH_SECTION_META[sectionId] || SEARCH_SECTION_META.general_web;
    if(!current || current.sourceSectionId !== sectionId){
      flush();
      current = { sourceSectionId: sectionId, items: [] };
    }
    current.items.push(Object.assign({}, raw, {
      sectionId,
      sourceSectionId: sectionId,
      sectionTitle: meta.title,
      sectionLabel: meta.label,
      viewportCard: true,
      viewportIndex: typeof raw.viewportIndex === 'number' ? raw.viewportIndex : i,
      visibleViewportCard: true,
      collapsedAwareViewportCard: true
    }));
  }
  flush();

  return {
    enabled: true,
    mode: 'collapse-aware-visible-card-sections-backfill-15',
    visibleCount: list.length,
    collapsedExcludedCount: visiblePagePack && typeof visiblePagePack.collapsedExcludedCount === 'number' ? visiblePagePack.collapsedExcludedCount : undefined,
    collapsedItemsExcludedFromCount: true,
    sections: out,
    visibleSections: out,
    displaySections: out,
    viewportSections: out,
    totalSections: out.length,
    principle: '접힌 항목은 15장 뷰포트 카운트를 먹지 않으며, 뒤 항목이 앞으로 당겨져 현재 페이지 실제 표시 카드 15장을 채운다.'
  };
}


function queryNeedlesForResident(q){
  const raw = safeString(q).trim().toLowerCase();
  if(!raw) return [];
  const parts = raw.split(/[\s,.;:/|()[\]{}"'`~!@#$%^&*_+=<>?\\-]+/).map(x => x.trim()).filter(x => x.length >= 2);
  const needles = [raw].concat(parts);
  const out = [];
  const seen = new Set();
  for(const n of needles){
    if(!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function residentItemMatchesQuery(it, q){
  const needles = queryNeedlesForResident(q);
  if(!needles.length) return true;
  const h = [
    it && it.title,
    it && it.summary,
    it && it.description,
    it && it.url,
    it && it.link,
    it && it.source,
    it && it.channel,
    it && it.section,
    Array.isArray(it && it.tags) ? it.tags.join(' ') : ''
  ].join(' ').toLowerCase();
  if(!h.trim()) return false;
  if(h.includes(needles[0])) return true;
  if(needles.length === 1) return h.includes(needles[0]);
  const tokenHits = needles.slice(1).filter(n => h.includes(n)).length;
  return tokenHits >= Math.max(1, Math.ceil(Math.min(needles.length - 1, 4) * 0.6));
}

function getSanmaruResidentForMaru(q, raw, opts){
  raw = raw || {};
  opts = opts || {};
  const page = clampInt(firstNonEmpty(raw.page, raw.p, raw.visiblePage, raw.sectionPage, raw.start), 1, 1, 100000);
  const residentKey = [safeString(q).trim(), normalizeSearchType(opts.searchType || raw.type || raw.category || raw.tab || raw.vertical), safeString(opts.lang || raw.lang || raw.uiLang || raw.locale || ''), page].join('::');
  let Sanmaru = null;
  try { Sanmaru = require('./sanmaru_engine_v2'); } catch(e) { Sanmaru = null; }
  if(!Sanmaru) return { items: [], meta: { status:'unavailable', residentKey } };
  try{
    if(typeof Sanmaru.ensureResidentBoot === 'function') Sanmaru.ensureResidentBoot({ reason: opts.reason || 'maru-search-touch', q, query: q, residentKey });
    if(typeof Sanmaru.supplyResidentSync === 'function'){
      const res = Sanmaru.supplyResidentSync(q, {
        q,
        query: q,
        page,
        start: raw.start || page,
        cacheKey: residentKey,
        residentKey,
        strictQuery: true,
        isolateByQuery: true,
        limit: Math.min(MAX_LIMIT, Math.max(clampInt(raw.limit, DEFAULT_LIMIT, 1, MAX_LIMIT), MIN_RESULT_TARGET)),
        candidatePoolTarget: Math.min(MAX_LIMIT, Math.max(clampInt(raw.candidatePool || raw.candidatePoolTarget, DEFAULT_LIMIT, 1, MAX_LIMIT), MIN_RESULT_TARGET)),
        searchType: opts.searchType,
        type: opts.searchType,
        lang: opts.lang
      });
      const rawItems = Array.isArray(res && res.items) ? res.items : [];
      const canonical = rawItems.map(x => canonicalizeItem(x, q, x && (x.source || x.provider || 'sanmaru-resident')));
      const items = canonical.filter(x => residentItemMatchesQuery(x, q));
      const droppedByQueryGuard = Math.max(0, canonical.length - items.length);
      return {
        items,
        meta: Object.assign({
          status: items.length ? 'ok' : (canonical.length ? 'filtered-empty' : 'empty'),
          residentKey,
          queryIsolated: true,
          droppedByQueryGuard
        }, res && res.meta || {})
      };
    }
    return { items: [], meta: { status:'no-resident-supply-export', residentKey } };
  }catch(e){
    return { items: [], meta: { status:'soft-failed', residentKey, error: safeString((e && e.message) || e).slice(0,160) } };
  }
}


function absorbIntoSanmaruResident(q, items, ctx){
  try{
    let Sanmaru = null;
    try { Sanmaru = require('./sanmaru_engine_v2'); } catch(e) { Sanmaru = null; }
    if(Sanmaru && typeof Sanmaru.absorbResidentItems === 'function'){
      Sanmaru.absorbResidentItems(items || [], { q, searchType: ctx && ctx.searchType, lang: ctx && ctx.lang, source:'maru-search-result' });
    }
  }catch(e){}
}

function buildImmediateResidentResponse(q, raw, residentPack, baseMeta){
  const candidateTarget = Math.min(MAX_LIMIT, Math.max(clampInt(raw && (raw.candidatePool || raw.candidatePoolTarget || raw.limit), DEFAULT_LIMIT, 1, MAX_LIMIT), MIN_RESULT_TARGET));
  const items = dedupeCanonicalItems(residentPack.items || []).slice(0, candidateTarget).map(compactResultItem);
  const fullSectionPack = buildSearchSections(items, q, { searchType: raw && (raw.type || raw.category || raw.tab || raw.vertical) });
  const visiblePagePack = buildCollapseAwareVisiblePagePack(items, q, raw || {}, fullSectionPack);
  const viewportSections = buildViewportDisplaySections(visiblePagePack.pageItems, q, fullSectionPack, visiblePagePack);
  const sectionPack = Object.assign({}, fullSectionPack, {
    sections: viewportSections.sections,
    fullSections: fullSectionPack.sections,
    visibleSections: viewportSections.visibleSections || viewportSections.sections,
    displaySections: viewportSections.displaySections || viewportSections.sections,
    viewportSections: viewportSections.viewportSections || viewportSections.sections,
    pageItems: visiblePagePack.pageItems,
    visiblePagePack,
    visibleCardsPerPage: visiblePagePack.visibleCardsPerPage,
    visibleCount: visiblePagePack.visibleCount,
    page: visiblePagePack.page,
    totalPages: visiblePagePack.totalPages,
    hasNextPage: visiblePagePack.hasNextPage,
    bodyPreserved: true,
    doesNotLimitItemsResults: true,
    viewportBackfill: true
  });
  return {
    status: 'ok', engine: 'maru-search', version: VERSION, query: q, source: 'sanmaru-resident',
    items, results: items,
    sections: viewportSections.sections,
    visibleSections: viewportSections.visibleSections || viewportSections.sections,
    displaySections: viewportSections.displaySections || viewportSections.sections,
    viewportSections: viewportSections.viewportSections || viewportSections.sections,
    pageItems: visiblePagePack.pageItems,
    visiblePagePack,
    sectionPack,
    meta: Object.assign({}, baseMeta || {}, {
      count: items.length,
      fastResidentResponse: true,
      sanmaruResident: residentPack.meta || {},
      viewport: { page: visiblePagePack.page, perPage: visiblePagePack.perPage, totalPages: visiblePagePack.totalPages, visibleCount: visiblePagePack.visibleCount, totalVisibleItems: visiblePagePack.totalVisibleItems, collapsedExcludedCount: visiblePagePack.collapsedExcludedCount, collapsedItemsExcludedFromCount: true, backfill:true },
      sections: { enabled:true, mode:viewportSections.mode, totalSections:viewportSections.totalSections, fullSectionCount:fullSectionPack.totalSections },
      doesNotCallExternal: true,
      principle: 'Sanmaru resident hub supplied this response; deep provider refresh can be called separately.'
    })
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


function transportCards(q){
  if(!q) return [];
  const enc = encodeURIComponent(q);
  const cards = [
    {
      title: '[Subway] ' + q + ' 지하철 / 대중교통',
      url: 'https://map.naver.com/p/search/' + enc + '%20%EC%A7%80%ED%95%98%EC%B2%A0',
      source: 'naver_map_transport',
      mediaType: 'map',
      type: 'map',
      summary: q + ' 지하철·대중교통 검색',
      score: 0.69
    },
    {
      title: '[Transit] ' + q + ' Google Maps Transit',
      url: 'https://www.google.com/maps/search/' + enc + '%20transit',
      source: 'google_maps_transport',
      mediaType: 'map',
      type: 'map',
      summary: q + ' 교통·환승 지도 검색',
      score: 0.68
    }
  ];
  return cards.map(x => canonicalizeItem(x, q, x.source));
}


function openDiscoverySurfaceCards(q){
  if(!q) return [];
  const enc = encodeURIComponent(q);
  const cards = [
    { title: '[News] ' + q + ' - Google News', url: 'https://news.google.com/search?q=' + enc, source: 'google_news_discovery', mediaType: 'article', type: 'news', summary: q + ' 구글 뉴스 검색', score: 0.66 },
    { title: '[News] ' + q + ' - Naver News', url: 'https://search.naver.com/search.naver?where=news&query=' + enc, source: 'naver_news_discovery', mediaType: 'article', type: 'news', summary: q + ' 네이버 뉴스 검색', score: 0.66 },
    { title: '[Video] ' + q + ' - YouTube', url: 'https://www.youtube.com/results?search_query=' + enc, source: 'youtube_discovery', mediaType: 'video', type: 'video', summary: q + ' 유튜브 영상·브이로그 검색', score: 0.64 },
    { title: '[Vlog] ' + q + ' 브이로그 / 리뷰 영상', url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' vlog review'), source: 'youtube_vlog_discovery', mediaType: 'video', type: 'video', summary: q + ' 브이로그·리뷰 영상 검색', score: 0.63 },
    { title: '[Shorts] ' + q + ' Shorts / Reels', url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' shorts reels'), source: 'shorts_reels_discovery', mediaType: 'video', type: 'video', summary: q + ' 쇼츠·릴스 영상 검색', score: 0.61 },
    { title: '[SNS] ' + q + ' - Instagram', url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:instagram.com'), source: 'instagram_discovery', mediaType: 'article', type: 'sns', summary: q + ' 인스타그램 공개 게시물 검색', score: 0.58 },
    { title: '[SNS] ' + q + ' - Facebook', url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:facebook.com'), source: 'facebook_discovery', mediaType: 'article', type: 'sns', summary: q + ' 페이스북 공개 페이지 검색', score: 0.57 },
    { title: '[SNS] ' + q + ' - TikTok', url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:tiktok.com'), source: 'tiktok_discovery', mediaType: 'video', type: 'sns', summary: q + ' 틱톡 공개 영상 검색', score: 0.57 },
    { title: '[SNS] ' + q + ' - X / Twitter', url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:x.com OR site:twitter.com'), source: 'x_twitter_discovery', mediaType: 'article', type: 'sns', summary: q + ' X/Twitter 공개 게시물 검색', score: 0.56 },
    { title: '[Company] ' + q + ' 공식 홈페이지 / 기업 사이트', url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' 공식 홈페이지 회사 기업 official site'), source: 'company_official_discovery', mediaType: 'article', type: 'web', summary: q + ' 공식 홈페이지·회사·기업 사이트 검색', score: 0.60 },
    { title: '[Official] ' + q + ' 정부 / 공공 / 기관', url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' site:go.kr OR site:gov official'), source: 'official_gov_discovery', mediaType: 'article', type: 'web', summary: q + ' 정부·공공·기관 공식 정보 검색', score: 0.60 },
    { title: '[Blog] ' + q + ' - Naver Blog', url: 'https://search.naver.com/search.naver?where=blog&query=' + enc, source: 'naver_blog_discovery', mediaType: 'article', type: 'blog', summary: q + ' 네이버 블로그 검색', score: 0.59 },
    { title: '[Cafe] ' + q + ' - Naver Cafe', url: 'https://search.naver.com/search.naver?where=article&query=' + enc, source: 'naver_cafe_discovery', mediaType: 'article', type: 'cafe', summary: q + ' 네이버 카페·커뮤니티 검색', score: 0.58 },
    { title: '[Community] ' + q + ' 커뮤니티 / 후기', url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' 커뮤니티 후기 리뷰 forum community'), source: 'community_discovery', mediaType: 'article', type: 'community', summary: q + ' 커뮤니티·후기·리뷰 검색', score: 0.56 },
    { title: '[Knowledge] ' + q + ' 위키 / 백과 / 지식', url: 'https://www.google.com/search?q=' + encodeURIComponent(q + ' wikipedia encyclopedia wiki 지식백과'), source: 'knowledge_discovery', mediaType: 'article', type: 'knowledge', summary: q + ' 위키·백과·지식 검색', score: 0.57 }
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
  web_naver_book: { async fetch(q, limit, start){ return naverGenericSearch('book.json', q, limit, start, 'naver_book', 'book'); } },
  web_google: { async fetch(q, limit, start){ return googleSearch(q, limit, start); } },
  web_google_sns: { async fetch(q, limit, start){ return googleSnsSearch(q, limit, start); } },
  web_bing: { async fetch(q, limit, start){ return bingSearch(q, limit, start); } },
  web_youtube: { async fetch(q, limit){ return youtubeSearch(q, limit); } },
  web_image: { async fetch(q, limit, start){ return googleImageSearch(q, limit, start); } },
  snapshot: { async fetch(q, limit){ const local = loadSnapshotLocal(q, limit); return local ? { source: 'snapshot-local', results: local } : null; } }
};


function uniqueCompactStrings(arr, maxCount){
  const out = [];
  const seen = new Set();
  (Array.isArray(arr) ? arr : []).forEach(v => {
    const s = safeString(v).trim();
    if(!s) return;
    const key = s.toLowerCase();
    if(seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out.slice(0, maxCount || out.length);
}

function queryScriptProfile(q){
  const s = safeString(q);
  if(/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(s)) return 'ko';
  if(/[ぁ-ゟ゠-ヿ]/.test(s)) return 'ja';
  if(/[一-龥]/.test(s)) return 'zh';
  if(/[А-Яа-яЁё]/.test(s)) return 'ru';
  if(/[A-Za-z]/.test(s)) return 'latin';
  return 'global';
}

function detectQueryIntentCluster(q){
  const text = safeString(q).toLowerCase();

  if(hasAnyLooseTerm(text, [
    '봉사단체','자원봉사','비영리','ngo','npo','nonprofit','non-profit','charity','volunteer',
    'foundation','association','organization','organisation','소규모 단체','시민단체','공익단체','구호단체'
  ])) return 'organization';

  if(hasAnyLooseTerm(text, [
    '무기','방산','국방','군사','군수','무기 동향','방위산업','arms','weapon','weapons','defense',
    'defence','military','arms trade','arms market','security trend'
  ])) return 'defense_trend';

  if(hasAnyLooseTerm(text, [
    '동향','트렌드','시장','산업','통계','보고서','리포트','trend','trends','market','industry',
    'statistics','report','research','analysis'
  ])) return 'trend';

  if(hasAnyLooseTerm(text, [
    '목록','리스트','단체','기관','협회','재단','업체','회사','directory','list','database',
    'association','foundation','companies','organizations','institutions'
  ])) return 'directory';

  return 'general';
}

function semanticExpansionTerms(searchType, profile, q){
  const t = normalizeSearchType(searchType);
  const cluster = detectQueryIntentCluster(q);

  const placeKo = ['랜드마크','명소','맛집','카페','공원','박물관','미술관','타워','전망대','시장','거리','역','지하철','교통','법원','구청','시청','관공서','주소'];
  const placeEn = ['landmark','attractions','restaurants','cafes','parks','museum','gallery','tower','viewpoint','market','street','station','subway','transit','court','city hall','district office','government office','address'];
  const placeGlobal = ['landmark','restaurant','cafe','park','museum','station','transit','court','city hall'];

  const intentKo = {
    organization: ['목록','리스트','국제','전국','지역','협회','재단','NGO','NPO','비영리','자원봉사','공익','구호','단체 소개','연락처','공식 사이트','네트워크'],
    defense_trend: ['동향','뉴스','시장','산업','국제','전 세계','보고서','통계','정책','국방','방산','안보','수출입','기술','전망','분석'],
    trend: ['동향','뉴스','시장','산업','보고서','통계','연구','분석','전망','정책','국제','글로벌'],
    directory: ['목록','리스트','데이터베이스','공식 사이트','협회','기관','연락처','지역','전국','국제']
  };

  const intentEn = {
    organization: ['directory','list','global','international','local','association','foundation','NGO','NPO','nonprofit','charity','volunteer','civil society','official site','network','contact'],
    defense_trend: ['trends','news','market','industry','global','worldwide','report','statistics','policy','defense','military','security','arms trade','technology','forecast','analysis'],
    trend: ['trends','news','market','industry','report','statistics','research','analysis','forecast','policy','global','worldwide'],
    directory: ['directory','list','database','official site','association','institution','contact','local','global','international']
  };

  const byType = {
    tour: {
      ko: ['관광','여행','가볼만한곳','랜드마크','명소','맛집','카페','공원','야경','전시','축제','박물관','미술관','타워','전망대','산책','시장','거리','교통'],
      en: ['travel','tourism','things to do','landmarks','attractions','restaurants','cafes','parks','night view','exhibition','festival','museum','gallery','tower','viewpoint','walk','market','street','transit'],
      global: placeGlobal
    },
    map: {
      ko: ['지도','주소','길찾기','위치','근처','지하철','지하철역','버스','교통','노선','환승','주차장','맛집','카페','공원','법원','구청','시청','관공서'],
      en: ['map','address','directions','location','nearby','subway','metro station','bus','transit','route','parking','restaurants','cafes','parks','court','city hall','district office','government office'],
      global: ['map','address','directions','nearby','station','transit','court','city hall','restaurant','cafe']
    },
    knowledge: {
      ko: ['정보','역사','뜻','백과','지식','공식','자료','문화','교통','행정','법원','기관','인물','작품','책','보고서','통계'],
      en: ['information','history','meaning','encyclopedia','knowledge','official','data','culture','transportation','administration','court','institution','people','works','books','report','statistics'],
      global: ['information','history','official','encyclopedia','data','books','report']
    },
    image: {
      ko: ['사진','이미지','풍경','갤러리','포토','랜드마크','공원','카페','야경','건축','작품'],
      en: ['photos','images','scenery','gallery','landmark','parks','cafes','night view','architecture','artwork'],
      global: ['photos','images','gallery','landmark']
    },
    cafe: {
      ko: ['카페','맛집','후기','리뷰','디저트','브런치','분위기','공간','추천','근처'],
      en: ['cafe','restaurants','reviews','dessert','brunch','atmosphere','space','recommended','nearby'],
      global: ['cafe','restaurants','reviews','nearby']
    },
    blog: {
      ko: ['블로그','후기','리뷰','여행','맛집','카페','일상','추천'],
      en: ['blog','reviews','travel','restaurants','cafes','daily life','recommended'],
      global: ['blog','reviews','travel']
    },
    news: {
      ko: ['뉴스','오늘','실시간','속보','이슈','행사','발표','공식','동향','분석'],
      en: ['news','today','latest','breaking','issue','event','announcement','official','trends','analysis'],
      global: ['news','latest','breaking','event','trends']
    },
    sns: {
      ko: ['유튜브','인스타그램','틱톡','쇼츠','릴스','SNS','영상','후기'],
      en: ['youtube','instagram','tiktok','shorts','reels','social','video','reviews'],
      global: ['youtube','instagram','tiktok','video']
    },
    video: {
      ko: ['영상','동영상','유튜브','쇼츠','브이로그','리뷰'],
      en: ['video','youtube','shorts','vlog','review'],
      global: ['video','youtube']
    },
    book: {
      ko: ['책','도서','서점','출판','저자','전자책','추천도서','작품'],
      en: ['book','books','bookstore','publishing','author','ebook','recommended books','works'],
      global: ['book','author','works']
    },
    webtoon: {
      ko: ['웹툰','만화','웹소설','캐릭터','애니','코믹','작가','추천'],
      en: ['webtoon','comic','manga','web novel','character','animation','author','recommendation'],
      global: ['webtoon','comic','manga']
    },
    shopping: {
      ko: ['쇼핑','가격','구매','추천','리뷰','판매','상품'],
      en: ['shopping','price','buy','recommended','reviews','sale','product'],
      global: ['shopping','price','reviews']
    },
    web: {
      ko: ['정보','사이트','홈페이지','공식','자료','서비스'],
      en: ['information','site','homepage','official','data','service'],
      global: ['information','official','site']
    }
  };

  const group = byType[t] || byType.web;
  let picked = [];

  if(profile === 'ko') picked = group.ko || [];
  else if(profile === 'latin') picked = group.en || [];
  else picked = (group.global || []).concat((group.en || []).slice(0, 3));

  if(['tour','map'].includes(t)){
    picked = picked.concat(profile === 'ko' ? placeEn.slice(0, 4) : placeKo.slice(0, 4));
  }

  if(cluster !== 'general'){
    picked = picked.concat(profile === 'ko' ? (intentKo[cluster] || []) : (intentEn[cluster] || []));
  }

  return uniqueCompactStrings(picked, 24);
}

function expandedSearchQueries(q, searchType){
  const base = safeString(q).trim();
  if(!base) return [];
  const t = normalizeSearchType(searchType);
  const profile = queryScriptProfile(base);
  const cluster = detectQueryIntentCluster(base);

  // all 검색도 강한 의도어는 가볍게 확장한다.
  // 예: 봉사단체, 소규모 단체, NGO, 무기 동향, 시장/산업/보고서 등.
  const terms = semanticExpansionTerms(t === 'all' && cluster !== 'general' ? 'web' : t, profile, base);
  const variants = [base];

  const maxVariants = t === 'all'
    ? (cluster === 'general' ? 1 : 7)
    : 12;

  if(maxVariants <= 1) return variants;

  for(const term of terms){
    const tt = safeString(term).trim();
    if(!tt) continue;
    const lowBase = base.toLowerCase();
    const lowTerm = tt.toLowerCase();

    if(lowBase === lowTerm || lowBase.includes(lowTerm)) continue;
    variants.push(base + ' ' + tt);
    if(variants.length >= maxVariants) break;
  }

  return uniqueCompactStrings(variants, maxVariants);
}

function semanticExpansionTerms(searchType, profile){
  const t = normalizeSearchType(searchType);

  const placeKo = ['랜드마크','명소','맛집','카페','공원','박물관','미술관','타워','전망대','시장','거리','역','지하철','교통','법원','구청','시청','관공서','주소'];
  const placeEn = ['landmark','attractions','restaurants','cafes','parks','museum','gallery','tower','viewpoint','market','street','station','subway','transit','court','city hall','district office','government office','address'];
  const placeGlobal = ['landmark','restaurant','cafe','park','museum','station','transit','court','city hall'];

  const byType = {
    tour: {
      ko: ['관광','여행','가볼만한곳','랜드마크','명소','맛집','카페','공원','야경','전시','축제','박물관','미술관','타워','전망대','산책','시장','거리','교통'],
      en: ['travel','tourism','things to do','landmarks','attractions','restaurants','cafes','parks','night view','exhibition','festival','museum','gallery','tower','viewpoint','walk','market','street','transit'],
      global: placeGlobal
    },
    map: {
      ko: ['지도','주소','길찾기','위치','근처','지하철','지하철역','버스','교통','노선','환승','주차장','맛집','카페','공원','법원','구청','시청','관공서'],
      en: ['map','address','directions','location','nearby','subway','metro station','bus','transit','route','parking','restaurants','cafes','parks','court','city hall','district office','government office'],
      global: ['map','address','directions','nearby','station','transit','court','city hall','restaurant','cafe']
    },
    knowledge: {
      ko: ['정보','역사','뜻','백과','지식','공식','자료','문화','교통','행정','법원','기관','인물','작품','책'],
      en: ['information','history','meaning','encyclopedia','knowledge','official','data','culture','transportation','administration','court','institution','people','works','books'],
      global: ['information','history','official','encyclopedia','data','books']
    },
    image: {
      ko: ['사진','이미지','풍경','갤러리','포토','랜드마크','공원','카페','야경','건축','작품'],
      en: ['photos','images','scenery','gallery','landmark','parks','cafes','night view','architecture','artwork'],
      global: ['photos','images','gallery','landmark']
    },
    cafe: {
      ko: ['카페','맛집','후기','리뷰','디저트','브런치','분위기','공간','추천','근처'],
      en: ['cafe','restaurants','reviews','dessert','brunch','atmosphere','space','recommended','nearby'],
      global: ['cafe','restaurants','reviews','nearby']
    },
    blog: {
      ko: ['블로그','후기','리뷰','여행','맛집','카페','일상','추천'],
      en: ['blog','reviews','travel','restaurants','cafes','daily life','recommended'],
      global: ['blog','reviews','travel']
    },
    news: {
      ko: ['뉴스','오늘','실시간','속보','이슈','행사','발표','공식'],
      en: ['news','today','latest','breaking','issue','event','announcement','official'],
      global: ['news','latest','breaking','event']
    },
    sns: {
      ko: ['유튜브','인스타그램','틱톡','쇼츠','릴스','SNS','영상','후기'],
      en: ['youtube','instagram','tiktok','shorts','reels','social','video','reviews'],
      global: ['youtube','instagram','tiktok','video']
    },
    video: {
      ko: ['영상','동영상','유튜브','쇼츠','브이로그','리뷰'],
      en: ['video','youtube','shorts','vlog','review'],
      global: ['video','youtube']
    },
    book: {
      ko: ['책','도서','서점','출판','저자','전자책','추천도서','작품'],
      en: ['book','books','bookstore','publishing','author','ebook','recommended books','works'],
      global: ['book','author','works']
    },
    webtoon: {
      ko: ['웹툰','만화','웹소설','캐릭터','애니','코믹','작가','추천'],
      en: ['webtoon','comic','manga','web novel','character','animation','author','recommendation'],
      global: ['webtoon','comic','manga']
    },
    shopping: {
      ko: ['쇼핑','가격','구매','추천','리뷰','판매','상품'],
      en: ['shopping','price','buy','recommended','reviews','sale','product'],
      global: ['shopping','price','reviews']
    },
    web: {
      ko: ['정보','사이트','홈페이지','공식','자료','서비스'],
      en: ['information','site','homepage','official','data','service'],
      global: ['information','official','site']
    }
  };

  const group = byType[t] || byType.web;
  let picked = [];

  if(profile === 'ko') picked = group.ko || [];
  else if(profile === 'latin') picked = group.en || [];
  else picked = (group.global || []).concat((group.en || []).slice(0, 3));

  // For local/place-heavy tabs, mix a few universal terms so non-Korean/global searches can still broaden.
  if(['tour','map'].includes(t)){
    picked = picked.concat(profile === 'ko' ? placeEn.slice(0, 4) : placeKo.slice(0, 4));
  }

  return uniqueCompactStrings(picked, 18);
}

function expandedSearchQueries(q, searchType){
  const base = safeString(q).trim();
  if(!base) return [];
  const t = normalizeSearchType(searchType);
  const profile = queryScriptProfile(base);

  // all 검색은 속도 유지를 위해 확장하지 않고,
  // 선택 탭에서만 전 세계/다국어 맥락 확장을 연다.
  if(t === 'all') return [base];

  const terms = semanticExpansionTerms(t, profile);
  const variants = [base];

  for(const term of terms){
    const tt = safeString(term).trim();
    if(!tt) continue;
    const lowBase = base.toLowerCase();
    const lowTerm = tt.toLowerCase();

    // 같은 단어 반복 방지: "맛집 맛집", "webtoon webtoon" 같은 확장 제거
    if(lowBase === lowTerm || lowBase.includes(lowTerm)) continue;
    variants.push(base + ' ' + tt);
  }

  return uniqueCompactStrings(variants, 12);
}

function itemLooseText(it){
  const url = safeString(firstNonEmpty(it && it.url, it && it.link)).toLowerCase();
  return [
    url,
    domainOf(url),
    safeString(it && it.source),
    safeString(it && it.type),
    safeString(it && it.mediaType),
    safeString(it && it.title),
    safeString(firstNonEmpty(it && it.summary, it && it.description))
  ].join(' ').toLowerCase();
}

function hasAnyLooseTerm(text, terms){
  const t = safeString(text).toLowerCase();
  return (Array.isArray(terms) ? terms : []).some(x => t.includes(safeString(x).toLowerCase()));
}

function sourceCaps(opts){
  const deep = !!opts.deep;
  return {
    searchBankPages: deep ? MAX_SEARCH_BANK_PAGES_DEEP : MAX_SEARCH_BANK_PAGES_NORMAL,
    // External APIs are controlled by maru-search gateway only; no recursive / unbounded loops.
    // Normal mode target: enough for 30~50 front pages when the provider has data.
    // Naver supports 100 per page; 8 pages = up to 800 results in one controlled gateway pass.
    // Fast-first mode: primary web is enough for broad coverage; verticals fill quality.
    naverPages: deep ? 8 : 5,
    // Controlled vertical expansion. Runs only inside maru-search gateway, never recursively.
    naverBlogPages: deep ? 4 : 2,
    naverNewsPages: deep ? 4 : 3,
    naverCafePages: deep ? 3 : 2,
    naverEncycPages: deep ? 1 : 1,
    naverKinPages: deep ? 1 : 1,
    naverBookPages: deep ? 2 : 1,
    naverLocalPages: 1,
    googlePages: deep ? 4 : 2,
    bingPages: deep ? 3 : 2,
    imagePages: deep ? 3 : 2,
    naverImagePages: deep ? 4 : 3,
    youtubeLimit: deep ? 80 : 50,
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
      let lastMeta = null;
      for(let i=0; i<caps.googlePages && pageStart <= 91 && timeLeft() > 1500; i++){
        const g = await Containers.web_google.fetch(q, 10, pageStart).catch(e => ({ source:'google', results: [], meta: { status:'google exception', reason: safeString((e && e.message) || e).slice(0, 160) } }));
        lastMeta = g && g.meta || lastMeta;
        const n = addBundle(g, 'google', collected, sourceState);
        count += n;
        if(!g || !g.results || g.results.length < 10) break;
        pageStart += 10;
      }
      record('google', count ? 'ok' : ((lastMeta && lastMeta.status) || 'google empty'), count, Object.assign({
        reason: lastMeta && lastMeta.reason,
        httpStatus: lastMeta && lastMeta.httpStatus,
        cseParams: lastMeta && lastMeta.cseParams
      }, lastMeta && lastMeta.detail ? { detail: lastMeta.detail } : {}));
      return count;
    }

    async function pullFromGoogleSns(){
      let count = 0;
      if(timeLeft() <= 1400) { record('google_sns', 'skipped-time', 0); return 0; }
      const g = await Containers.web_google_sns.fetch(q, 10, 1).catch(e => ({ source:'google_sns', results: [], meta: { status:'google sns exception', reason: safeString((e && e.message) || e).slice(0, 160) } }));
      const n = addBundle(g, 'google_sns', collected, sourceState);
      count += n;
      const meta = g && g.meta || {};
      record('google_sns', count ? 'ok' : (meta.status || 'google sns empty'), count, {
        reason: meta.reason,
        routes: meta.routes,
        cseParams: meta.cseParams
      });
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

        record(name, count ? 'ok' : 'empty', count, { pagesTried: starts.length, mode: 'controlled-vertical-parallel' });
        total += count;
        return count;
      }

      // Parallel vertical pulse:
      // keeps first response faster while bringing news/local/knowledge/cafe/book into the first result set.
      await Promise.allSettled([
        runPaged('naver_news', Containers.web_naver_news, caps.naverNewsPages || 0, 100),
        runPaged('naver_local', Containers.web_naver_local, caps.naverLocalPages || 0, 5),
        runPaged('naver_encyc', Containers.web_naver_encyc, caps.naverEncycPages || 0, 100),
        runPaged('naver_kin', Containers.web_naver_kin, caps.naverKinPages || 0, 100),
        runPaged('naver_blog', Containers.web_naver_blog, caps.naverBlogPages || 0, 100),
        runPaged('naver_cafe', Containers.web_naver_cafe, caps.naverCafePages || 0, 100),
        Containers.web_naver_book
          ? runPaged('naver_book', Containers.web_naver_book, caps.naverBookPages || 0, 100)
          : Promise.resolve(0)
      ]);

      return total;
    }


    async function pullFromIntentExpansion(){
      if(viewType === 'all') return 0;
      if(timeLeft() <= 1300) {
        record('intent-expansion', 'skipped-time', 0, { searchType: viewType });
        return 0;
      }

      const variants = expandedSearchQueries(q, viewType).slice(1, 10);
      if(!variants.length) {
        record('intent-expansion', 'skipped-no-variants', 0, { searchType: viewType });
        return 0;
      }

      let total = 0;

      async function one(name, container, queryText, display, startAt){
        if(!container || typeof container.fetch !== 'function' || timeLeft() <= 900) return 0;
        try{
          const bundle = await container.fetch(queryText, display, startAt || 1);
          const n = addBundle(bundle, name, collected, sourceState);
          total += n;
          return n;
        }catch(e){
          return 0;
        }
      }

      function containersForType(t){
        if(t === 'tour') return [
          ['naver_local_intent', Containers.web_naver_local, 5],
          ['google_web_intent', Containers.web_google, 10],
          ['bing_web_intent', Containers.web_bing, 20],
          ['naver_blog_intent', Containers.web_naver_blog, 30],
          ['naver_cafe_intent', Containers.web_naver_cafe, 30],
          ['naver_image_intent', Containers.web_naver_image, 30],
          ['naver_news_intent', Containers.web_naver_news, 30]
        ];
        if(t === 'map') return [
          ['naver_local_intent', Containers.web_naver_local, 5],
          ['google_web_intent', Containers.web_google, 10],
          ['bing_web_intent', Containers.web_bing, 20],
          ['naver_blog_intent', Containers.web_naver_blog, 30],
          ['naver_cafe_intent', Containers.web_naver_cafe, 30],
          ['naver_image_intent', Containers.web_naver_image, 20]
        ];
        if(t === 'webtoon') return [
          ['naver_webtoon_web', Containers.web_naver, 50],
          ['naver_webtoon_image', Containers.web_naver_image, 30],
          ['naver_webtoon_blog', Containers.web_naver_blog, 30],
          ['naver_webtoon_cafe', Containers.web_naver_cafe, 30],
          ['naver_webtoon_book', Containers.web_naver_book, 40]
        ];
        if(t === 'book') return [
          ['naver_book_intent', Containers.web_naver_book, 60],
          ['naver_blog_intent', Containers.web_naver_blog, 30],
          ['naver_kin_intent', Containers.web_naver_kin, 30],
          ['naver_image_intent', Containers.web_naver_image, 20]
        ];
        if(t === 'knowledge') return [
          ['naver_encyc_intent', Containers.web_naver_encyc, 50],
          ['naver_kin_intent', Containers.web_naver_kin, 50],
          ['naver_book_intent', Containers.web_naver_book, 40],
          ['google_web_intent', Containers.web_google, 10],
          ['bing_web_intent', Containers.web_bing, 20],
          ['naver_news_intent', Containers.web_naver_news, 30]
        ];
        if(t === 'sns') return [
          ['google_sns_intent', Containers.web_google_sns, 10],
          ['youtube_intent', Containers.web_youtube, 12],
          ['naver_blog_intent', Containers.web_naver_blog, 30],
          ['naver_cafe_intent', Containers.web_naver_cafe, 30],
          ['naver_image_intent', Containers.web_naver_image, 20]
        ];
        if(t === 'cafe') return [
          ['naver_cafe_intent', Containers.web_naver_cafe, 50],
          ['naver_blog_intent', Containers.web_naver_blog, 30],
          ['naver_local_intent', Containers.web_naver_local, 5],
          ['naver_image_intent', Containers.web_naver_image, 20]
        ];
        if(t === 'image') return [
          ['naver_image_intent', Containers.web_naver_image, 50],
          ['google_image_intent', Containers.web_image, 10],
          ['naver_blog_intent', Containers.web_naver_blog, 20],
          ['naver_cafe_intent', Containers.web_naver_cafe, 20]
        ];
        if(t === 'video') return [
          ['youtube_intent', Containers.web_youtube, 20],
          ['naver_blog_intent', Containers.web_naver_blog, 20],
          ['naver_image_intent', Containers.web_naver_image, 20]
        ];
        if(t === 'news') return [
          ['naver_news_intent', Containers.web_naver_news, 70],
          ['naver_web_intent', Containers.web_naver, 50],
          ['google_news_intent', Containers.web_google, 10]
        ];
        return [
          ['naver_web_intent', Containers.web_naver, 50],
          ['google_web_intent', Containers.web_google, 10],
          ['bing_web_intent', Containers.web_bing, 20],
          ['naver_news_intent', Containers.web_naver_news, 30],
          ['naver_encyc_intent', Containers.web_naver_encyc, 30],
          ['naver_blog_intent', Containers.web_naver_blog, 30],
          ['naver_cafe_intent', Containers.web_naver_cafe, 30],
          ['naver_image_intent', Containers.web_naver_image, 20]
        ];
      }

      const selected = containersForType(viewType);
      const tasks = [];

      for(const queryText of variants){
        for(const spec of selected){
          if(tasks.length >= (detectQueryIntentCluster(q) !== 'general' ? 30 : 24)) break;
          tasks.push(one(spec[0], spec[1], queryText, spec[2], 1));
        }
        if(tasks.length >= (detectQueryIntentCluster(q) !== 'general' ? 30 : 24)) break;
      }

      await Promise.allSettled(tasks);
      record('intent-expansion', total ? 'ok' : 'empty', total, {
        searchType: viewType,
        queries: variants,
        tasks: tasks.length,
        expansionBudget: detectQueryIntentCluster(q) !== 'general' ? 30 : 24,
        mode: 'informal-controlled'
      });
      return total;
    }

    const internalCount = await pullFromSearchBank();
    // PRESERVE + EXPAND: Search Bank/Index must never stop the broad Maru Search gateway.
    // If the caller did not explicitly block external sources, run the controlled gateway pass.
    // This restores news/blog/cafe/youtube/image/company discovery that disappeared when internal results were considered "enough".
    const shouldUseExternal = !externalOff;

    if(shouldUseExternal){
      // Single maru-search gateway pass. No recursive loops, no repeated fan-out.
      await Promise.allSettled([
        pullFromNaver(),
        pullFromGoogle(),
        pullFromGoogleSns(),
        pullFromBing(),
        pullFromYouTube(),
        pullFromImage()
      ]);

      const afterPrimaryExternal = collected.length;
      const naturalExpansionTarget = Math.min(Math.max(limit, MIN_RESULT_TARGET), 700);
      if(timeLeft() > 1200){
        await pullFromNaverVerticals();
      } else {
        record('naver_verticals', 'skipped-time', 0, { afterPrimaryExternal, naturalExpansionTarget });
      }

      if((viewType !== 'all' || detectQueryIntentCluster(q) !== 'general') && timeLeft() > 1300){
        await pullFromIntentExpansion();
      }

      record('search-link-cards', 'skipped-natural-flow', 0);
    }else{
      record('external-gateway', externalOff ? 'blocked-by-request' : 'skipped-internal-enough', 0, { internalCount, trigger: externalTriggerMin, mode });
    }

    const directMapCards = mapCards(q, region);
    if(directMapCards.length){
      collected.push.apply(collected, directMapCards);
      record('map-link-cards', 'ok', directMapCards.length, { mode: 'direct-navigation-links' });
    }

    if(viewType === 'map' || viewType === 'tour'){
      const directTransportCards = transportCards(q);
      if(directTransportCards.length){
        collected.push.apply(collected, directTransportCards);
        record('transport-link-cards', 'ok', directTransportCards.length, { mode: 'direct-navigation-links' });
      }
    }

    // Open/public discovery surfaces: SNS, company/official pages, blogs, communities, videos, vlogs and news.
    // These are additive bridge cards only; they do not replace provider/API results and do not touch media/image fields.
    const discoveryCards = openDiscoverySurfaceCards(q);
    if(discoveryCards.length){
      collected.push.apply(collected, discoveryCards);
      record('open-discovery-surfaces', 'ok', discoveryCards.length, {
        includes: ['news','youtube','vlog','instagram','facebook','tiktok','x-twitter','company-official','blog','cafe','community','knowledge']
      });
    }

    let unique = dedupeCanonicalItems(collected);
    unique = backfillVisuals(unique);
    unique = await applyCorePipeline(q, unique);
    unique = applyServerSideBoosts(unique, { q, lang, searchType: viewType });

    // Controlled card-media autofill:
    // Keep the existing wide search pipeline, but make visible search cards useful by filling
    // each result's own OG / provider image where possible within the remaining response budget.
    if(blockingImageEnrichRequested(event)){
      unique = await enrichOwnImages(unique, { trace, timeLeft });
    }else{
      record('own-og-image-enrich', 'deferred-first-response', 0, { action:'enrich-images', reason:'do-not-block-search-render' });
    }

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
        mediaQualityPriority: true,
        ownPageMediaOnly: true,
        providedThumbnailPreserve: true,
        permissiveThumbnailFilter: true,
        imagePolicy: 'fast-first-own-page-representative-media-only',
        trace,
        externalSuppressed: !!externalOff,
        externalMode: mode,
        externalGatewayUsed: !!shouldUseExternal,
        externalTriggerMin,
        naturalFlow: true,
        balancedRanking: viewType === 'all',
        searchType: viewType,
        informalVerticalExpansion: viewType !== 'all',
        globalContextExpansion: viewType !== 'all' || detectQueryIntentCluster(q) !== 'general',
        intentCluster: detectQueryIntentCluster(q),
        syntheticSearchLinks: false,
        providerCaps: {
          searchBankPages: caps.searchBankPages,
          naverPages: caps.naverPages,
          naverBlogPages: caps.naverBlogPages,
          naverNewsPages: caps.naverNewsPages,
          naverCafePages: caps.naverCafePages,
          naverEncycPages: caps.naverEncycPages,
          naverKinPages: caps.naverKinPages,
          naverBookPages: caps.naverBookPages,
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


function decodeHtmlEntitiesLite(v){
  return safeString(v)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function attrValue(tag, name){
  const re = new RegExp(name + "\\s*=\\s*([\\\"'])(.*?)\\1", "i");
  const m = safeString(tag).match(re);
  return m && m[2] ? decodeHtmlEntitiesLite(m[2]) : '';
}

function bestFromSrcset(srcset){
  const parts = safeString(srcset).split(',').map(x => x.trim()).filter(Boolean);
  if(!parts.length) return '';
  let best = '';
  let bestScore = -1;
  for(const part of parts){
    const bits = part.split(/\s+/).filter(Boolean);
    const url = bits[0] || '';
    let score = 1;
    const desc = bits.slice(1).join(' ');
    const wm = desc.match(/(\d+)w/i);
    const xm = desc.match(/([\d.]+)x/i);
    if(wm) score = parseInt(wm[1], 10) || score;
    if(xm) score = Math.round((parseFloat(xm[1]) || 1) * 1000);
    if(score > bestScore){
      bestScore = score;
      best = url;
    }
  }
  return best;
}

function isLikelyContentImageUrl(imageUrl){
  const s = safeString(imageUrl).toLowerCase();
  if(!s) return false;
  if(isHardRejectImageUrl(s)) return false;

  const bad = [
    'spacer',
    'blank',
    'transparent',
    'pixel',
    'tracking',
    'analytics',
    'captcha',
    'qr'
  ];

  if(bad.some(k => s.includes(k))) return false;
  return isRealImageUrl(imageUrl);
}

function pushOwnImageCandidate(out, url, baseUrl, source, weight){
  const u = absolutizeUrl(baseUrl, decodeHtmlEntitiesLite(url));
  if(!isLikelyContentImageUrl(u)) return;
  out.push({
    url: u,
    source,
    weight: weight || 0
  });
}


function extractOgImageFromHtml(html, baseUrl){
  const text = safeString(html);
  if(!text) return '';

  const candidates = [];

  // 1) Explicit representative images selected by the page owner.
  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/ig,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/ig,
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["'][^>]*>/ig,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']image["'][^>]*>/ig
  ];

  for(const re of metaPatterns){
    let m;
    while((m = re.exec(text)) && candidates.length < 24){
      if(m && m[1]) pushOwnImageCandidate(candidates, m[1], baseUrl, 'meta', 100);
    }
  }

  // 2) link rel=image_src / preload image.
  const linkRe = /<link[^>]+(?:rel=["'][^"']*(?:image_src|preload)[^"']*["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*rel=["'][^"']*(?:image_src|preload)[^"']*["'])[^>]*>/ig;
  let lm;
  while((lm = linkRe.exec(text)) && candidates.length < 30){
    const u = lm[1] || lm[2];
    if(u) pushOwnImageCandidate(candidates, u, baseUrl, 'link', 80);
  }

  // 3) JSON-LD/schema.org image fields. Keep this regex light and bounded.
  const jsonImageRe = /"image"\s*:\s*(?:"([^"]+)"|\{\s*"url"\s*:\s*"([^"]+)"|\[\s*"([^"]+)")/ig;
  let jm;
  while((jm = jsonImageRe.exec(text)) && candidates.length < 36){
    const u = jm[1] || jm[2] || jm[3];
    if(u) pushOwnImageCandidate(candidates, u, baseUrl, 'schema', 70);
  }

  const thumbnailUrlRe = /"thumbnailUrl"\s*:\s*"([^"]+)"/ig;
  let tm;
  while((tm = thumbnailUrlRe.exec(text)) && candidates.length < 40){
    if(tm && tm[1]) pushOwnImageCandidate(candidates, tm[1], baseUrl, 'schema-thumbnail', 65);
  }

  // 4) Video poster owned by the result page.
  const posterRe = /<video[^>]+poster=["']([^"']+)["'][^>]*>/ig;
  let pm;
  while((pm = posterRe.exec(text)) && candidates.length < 44){
    if(pm && pm[1]) pushOwnImageCandidate(candidates, pm[1], baseUrl, 'video-poster', 75);
  }

  // 5) First meaningful page images.
  // This is still own-page media, not generated media and not borrowed media.
  const headAndTop = text.slice(0, 180000);
  const imgRe = /<img\b[^>]*>/ig;
  let im;
  let inspected = 0;
  while((im = imgRe.exec(headAndTop)) && inspected < 80 && candidates.length < 60){
    inspected += 1;
    const tag = im[0];
    const srcset = attrValue(tag, 'srcset') || attrValue(tag, 'data-srcset');
    const src =
      bestFromSrcset(srcset) ||
      attrValue(tag, 'src') ||
      attrValue(tag, 'data-src') ||
      attrValue(tag, 'data-original') ||
      attrValue(tag, 'data-lazy-src') ||
      attrValue(tag, 'data-url');

    if(!src) continue;

    const width = parseInt(attrValue(tag, 'width') || '0', 10) || 0;
    const height = parseInt(attrValue(tag, 'height') || '0', 10) || 0;
    const alt = low(attrValue(tag, 'alt'));
    const cls = low(attrValue(tag, 'class'));
    const tagText = low(tag);

    if(width && height && width * height < 30000) continue;
    if(hasAnyLooseTerm(cls + ' ' + alt + ' ' + tagText, ['logo','icon','sprite','captcha','banner-text','text-banner','sns','share','qr'])) continue;

    let weight = 45;
    if(width * height >= 480000) weight += 20;
    else if(width * height >= 180000) weight += 10;
    if(hasAnyLooseTerm(cls + ' ' + alt, ['thumb','thumbnail'])) weight -= 8;
    if(hasAnyLooseTerm(cls + ' ' + alt, ['main','visual','hero','photo','image','대표','사진','갤러리'])) weight += 16;

    pushOwnImageCandidate(candidates, src, baseUrl, 'page-img', weight);
  }

  if(!candidates.length) return '';

  const seen = new Set();
  const unique = [];
  for(const c of candidates){
    let key = c.url.split('#')[0].toLowerCase();
    try{
      const u = new URL(c.url);
      key = (u.origin + u.pathname).toLowerCase();
    }catch(e){}
    if(seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  unique.sort((a, b) =>
    ((b.weight || 0) + imageQualityScore(b.url, { source: b.source, type: 'image', mediaType: 'image' })) -
    ((a.weight || 0) + imageQualityScore(a.url, { source: a.source, type: 'image', mediaType: 'image' }))
  );

  return unique[0] ? unique[0].url : '';
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

      const ownImages = naturalImagesForItem(it, 3);

      // If the provider already supplied a usable thumbnail/media URL, keep it.
      // Do not skip with compactImages only, because that can preserve a raw URL
      // that later gets filtered out by the meaningful-image layer.
      if(ownImages.length) {
        list[idx] = Object.assign({}, it, {
          thumbnail: ownImages[0],
          thumb: ownImages[0],
          image: ownImages[0],
          imageUrl: ownImages[0],
          imageSet: ownImages,
          originalImage: ownImages[0],
          fullImage: ownImages[0],
          viewerImage: ownImages[0],
          openImageUrl: ownImages[0],
          contentUrl: ownImages[0],
          cardImage: ownImages[0],
          mediaQuality: mediaQualityProfileForItem(it, ownImages),
          selectedImageQuality: imageQualityScore(ownImages[0], it),
          selectedCardImageQuality: imageQualityScore(ownImages[0], it),
          clickTargetType: 'image',
          _providedImagePreserved: hasProviderSuppliedMedia(it)
        });
        skipped += 1;
        continue;
      }

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
            imageUrl: nextImages[0],
            imageSet: nextImages,
            originalImage: nextImages[0],
            fullImage: nextImages[0],
            viewerImage: nextImages[0],
            openImageUrl: nextImages[0],
            contentUrl: nextImages[0],
            cardImage: nextImages[0],
            mediaQuality: mediaQualityProfileForItem(it, nextImages),
            selectedImageQuality: imageQualityScore(nextImages[0], it),
            selectedCardImageQuality: imageQualityScore(nextImages[0], it),
            clickTargetType: 'image',
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
      mode: 'own-page-representative-media-only'
    });
  }

  return list;
}


function backfillVisuals(items){
  // Preserve every result's own media fields and expose original/full image aliases for the front card viewer.
  // Do not erase existing provider thumbnails when a stricter filter cannot find a better image.
  return (Array.isArray(items) ? items : []).map(it => {
    if(!it) return it;
    const profile = mediaProfileForItem(it);
    const existing = firstNonEmpty(it.thumbnail, it.thumb, it.image, it.imageUrl, it.og_image, it.originalImage);
    const safeExisting = isRealImageUrl(existing) && !isHardRejectImageUrl(existing) ? existing : '';
    const thumb = profile.thumbnail || safeExisting || '';
    const original = profile.originalImage || safeExisting || thumb || '';
    const imageSet = profile.imageSet && profile.imageSet.length ? profile.imageSet : compactImages([thumb, original]);

    const media = (it.media && typeof it.media === 'object') ? Object.assign({}, it.media) : (it.mediaType === 'video' || it.type === 'video' ? { type: 'video' } : undefined);
    if(media){
      media.preview = Object.assign({}, media.preview || {}, {
        poster: firstNonEmpty(media.preview && media.preview.poster, thumb, original),
        image: firstNonEmpty(media.preview && media.preview.image, original, thumb),
        original: firstNonEmpty(media.preview && media.preview.original, original, thumb),
        videoUrl: firstNonEmpty(media.preview && media.preview.videoUrl, profile.videoUrl),
        embedUrl: firstNonEmpty(media.preview && media.preview.embedUrl, profile.embedUrl)
      });
    }

    return Object.assign({}, it, {
      thumbnail: thumb,
      thumb,
      image: original,
      imageUrl: original,
      imageSet,
      originalImage: original,
      fullImage: original,
      imageOriginal: original,
      viewerImage: original,
      openImageUrl: original,
      contentUrl: original,
      cardImage: thumb || original,
      videoId: profile.videoId || it.videoId,
      videoUrl: profile.videoUrl || it.videoUrl,
      watchUrl: profile.watchUrl || it.watchUrl,
      embedUrl: profile.embedUrl || it.embedUrl,
      openUrl: profile.openUrl || it.openUrl || it.url || it.link,
      mediaQuality: mediaQualityProfileForItem(it, imageSet),
      selectedImageQuality: imageQualityScore(original, it),
      selectedCardImageQuality: imageQualityScore(thumb || original, it),
      clickTargetType: profile.videoUrl ? 'video' : (original ? 'image' : 'page'),
      media
    });
  });
}

async function naverSearch(q, limit, start){
  const id = envFirst('NAVER_API_KEY','NAVER_CLIENT_ID','NAVER_SEARCH_CLIENT_ID','NAVER_OPENAPI_CLIENT_ID');
  const secret = envFirst('NAVER_CLIENT_SECRET','NAVER_API_SECRET','NAVER_SEARCH_CLIENT_SECRET','NAVER_OPENAPI_CLIENT_SECRET');
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
  const id = envFirst('NAVER_API_KEY','NAVER_CLIENT_ID','NAVER_SEARCH_CLIENT_ID','NAVER_OPENAPI_CLIENT_ID');
  const secret = envFirst('NAVER_CLIENT_SECRET','NAVER_API_SECRET','NAVER_SEARCH_CLIENT_SECRET','NAVER_OPENAPI_CLIENT_SECRET');
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
      const thumb = it.thumbnail || '';
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
        thumbnail: imageUrl || thumb,
        thumb: imageUrl || thumb,
        image: imageUrl || thumb,
        imageUrl: imageUrl || thumb,
        imageSet: compactImages([imageUrl, thumb]),
        originalImage: imageUrl || thumb,
        fullImage: imageUrl || thumb,
        viewerImage: imageUrl || thumb,
        openImageUrl: imageUrl || thumb,
        contentUrl: imageUrl || thumb,
        cardImage: imageUrl || thumb,
        payload: {
          source: 'naver_image',
          thumb,
          image: imageUrl || thumb,
          contextLink: context,
          qualityMode: 'prefer-original'
        }
      };
    })
  };
}

async function naverGenericSearch(endpoint, q, limit, start, source, type){
  const id = envFirst('NAVER_API_KEY','NAVER_CLIENT_ID','NAVER_SEARCH_CLIENT_ID','NAVER_OPENAPI_CLIENT_ID');
  const secret = envFirst('NAVER_CLIENT_SECRET','NAVER_API_SECRET','NAVER_SEARCH_CLIENT_SECRET','NAVER_OPENAPI_CLIENT_SECRET');
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
    const thumb = it.thumbnail || it.image || '';

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
        roadAddress: it.roadAddress,
        author: it.author,
        publisher: it.publisher,
        pubdate: it.pubdate,
        isbn: it.isbn,
        image: it.image
      }
    };
  });

  return { source, results };
}


function googleCseKeys(){
  return {
    key: envFirst('GOOGLE_API_KEY','GOOGLE_SEARCH_API_KEY','GOOGLE_CUSTOM_SEARCH_API_KEY','GOOGLE_CLOUD_API_KEY'),
    cx: envFirst('GOOGLE_CSE_ID','GOOGLE_CX','GOOGLE_SEARCH_ENGINE_ID','GOOGLE_CUSTOM_SEARCH_ENGINE_ID','GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID')
  };
}

async function googleCseRequest(q, limit, start, opts){
  opts = opts || {};
  const keys = googleCseKeys();
  const cseParams = { hl:'ko', gl:'kr', safe:'off', filter:'0', lr:'removed' };
  if(!keys.key) return { source: opts.source || 'google', results: [], meta: { status:'google key missing', reason:'GOOGLE_API_KEY missing', cseParams } };
  if(!keys.cx) return { source: opts.source || 'google', results: [], meta: { status:'google key missing', reason:'GOOGLE_CSE_ID missing', cseParams } };

  const params = new URLSearchParams();
  params.set('key', keys.key);
  params.set('cx', keys.cx);
  params.set('q', safeString(q));
  params.set('num', safeString(Math.min(limit || 10, 10)));
  params.set('start', safeString(start || 1));
  params.set('hl', 'ko');
  params.set('gl', 'kr');
  params.set('safe', 'off');
  params.set('filter', '0');
  if(opts.searchType) params.set('searchType', opts.searchType);
  if(opts.sort) params.set('sort', opts.sort);

  const url = 'https://www.googleapis.com/customsearch/v1?' + params.toString();
  let res = null;
  let data = null;
  try{
    res = await fetchWithTimeout(url, null, opts.timeoutMs || 3200);
    try { data = await res.json(); } catch(e) { data = null; }
  }catch(e){
    return { source: opts.source || 'google', results: [], meta: { status:'google http error', reason:safeString((e && e.message) || e).slice(0,160), cseParams } };
  }
  if(!res || !res.ok){
    const detail = safeString(data && data.error && (data.error.message || data.error.status) || '').slice(0,200);
    return { source: opts.source || 'google', results: [], meta: { status:'google http error', reason: detail || 'HTTP ' + (res && res.status), httpStatus: res && res.status, detail, cseParams } };
  }

  const items = Array.isArray(data && data.items) ? data.items : [];
  const source = opts.source || 'google';
  const type = opts.type || 'web';
  const results = items.map(it => {
    const pagemap = it.pagemap || {};
    const cseThumb = Array.isArray(pagemap.cse_thumbnail) ? pagemap.cse_thumbnail[0] : null;
    const cseImg = Array.isArray(pagemap.cse_image) ? pagemap.cse_image[0] : null;
    const img = (cseImg && cseImg.src) || (cseThumb && cseThumb.src) || '';
    return {
      title: it.title || '',
      link: it.link || '',
      url: it.link || '',
      snippet: it.snippet || '',
      type,
      mediaType: opts.mediaType || (type === 'sns_video' ? 'video' : 'article'),
      source,
      thumbnail: img,
      thumb: img,
      image: img,
      imageSet: compactImages([img]),
      payload: { source, thumb: img, image: img, cseQuery: q }
    };
  });

  return {
    source,
    results,
    meta: {
      status: results.length ? 'ok' : 'google empty',
      reason: results.length ? undefined : 'Custom Search returned no items',
      totalResults: data && data.searchInformation && data.searchInformation.totalResults,
      cseParams
    }
  };
}

async function googleSearch(q, limit, start){
  const webRes = await googleCseRequest(q, limit, start, { source:'google', type:'web' });
  const newsRes = await googleCseRequest(q, limit, start, { source:'google_news', type:'news', sort:'date' });
  const results = [].concat(webRes.results || [], newsRes.results || []);
  const meta = results.length
    ? { status:'ok', web: webRes.meta, news: newsRes.meta, cseParams: webRes.meta && webRes.meta.cseParams }
    : (webRes.meta && webRes.meta.status !== 'ok' ? webRes.meta : (newsRes.meta || webRes.meta || { status:'google empty' }));
  return { source: 'google', results, meta };
}

async function googleSnsSearch(q, limit, start){
  const keys = googleCseKeys();
  const cseParams = { hl:'ko', gl:'kr', safe:'off', filter:'0', lr:'removed' };
  if(!keys.key) return { source:'google_sns', results: [], meta:{ status:'google key missing', reason:'GOOGLE_API_KEY missing', cseParams } };
  if(!keys.cx) return { source:'google_sns', results: [], meta:{ status:'google key missing', reason:'GOOGLE_CSE_ID missing', cseParams } };

  const routes = [
    { name:'instagram', query:'site:instagram.com ' + q, source:'google_sns_instagram', type:'sns', mediaType:'article' },
    { name:'facebook', query:'site:facebook.com ' + q, source:'google_sns_facebook', type:'sns', mediaType:'article' },
    { name:'tiktok', query:'site:tiktok.com ' + q, source:'google_sns_tiktok', type:'sns', mediaType:'video' },
    { name:'x_twitter', query:'(site:x.com OR site:twitter.com) ' + q, source:'google_sns_x_twitter', type:'sns', mediaType:'article' },
    { name:'threads', query:'site:threads.net ' + q, source:'google_sns_threads', type:'sns', mediaType:'article' }
  ];

  const perRoute = Math.max(1, Math.min(3, Math.ceil(Math.min(limit || 10, 10) / 3)));
  const settled = await Promise.allSettled(routes.map(route =>
    googleCseRequest(route.query, perRoute, start || 1, {
      source: route.source,
      type: route.type,
      mediaType: route.mediaType,
      timeoutMs: 2500
    }).then(bundle => Object.assign({}, bundle, { route: route.name }))
  ));

  const results = [];
  const routeMeta = [];
  for(const s of settled){
    const pack = s && s.status === 'fulfilled' ? s.value : null;
    if(pack && Array.isArray(pack.results)) results.push.apply(results, pack.results.slice(0, perRoute));
    routeMeta.push({ route: pack && pack.route || 'unknown', status: pack && pack.meta && pack.meta.status || (s && s.status) || 'unknown', count: pack && pack.results ? pack.results.length : 0 });
  }

  return {
    source: 'google_sns',
    results: results.slice(0, Math.min(limit || 10, 15)),
    meta: {
      status: results.length ? 'ok' : 'google sns empty',
      reason: results.length ? undefined : 'No SNS site-search results from Google CSE',
      routes: routeMeta,
      cseParams
    }
  };
}


async function bingSearch(q, limit, offset){
  const key = envFirst('BING_API_KEY','BING_SEARCH_API_KEY','AZURE_BING_SEARCH_API_KEY','BING_SUBSCRIPTION_KEY');
  if(!key) return null;
  const url = 'https://api.bing.microsoft.com/v7.0/search?q=' + encodeURIComponent(q) + '&count=' + Math.min(limit,50) + '&offset=' + (offset || 0);
  const res = await fetchWithTimeout(url, { headers: { 'Ocp-Apim-Subscription-Key': key } }, 3000);
  if(!res.ok) return null;
  const data = await res.json();
  return { source: 'bing', results: ((data.webPages && data.webPages.value) || []).map(it => ({ title: it.name, link: it.url, url: it.url, snippet: it.snippet, type: 'web', source: 'bing' })) };
}

async function youtubeSearch(q, limit){
  const key = envFirst('YOUTUBE_API_KEY','GOOGLE_YOUTUBE_API_KEY','GOOGLE_API_KEY','GOOGLE_SEARCH_API_KEY');
  if(!key) return null;
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=' + Math.min(limit,50) + '&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(key);
  const res = await fetchWithTimeout(url, null, 3500);
  if(!res.ok) return null;
  const data = await res.json();
  const results = (data.items || []).map(it => {
    const rawThumb = (it.snippet && it.snippet.thumbnails && (it.snippet.thumbnails.high || it.snippet.thumbnails.medium || it.snippet.thumbnails.default) || {}).url || '';
    const videoId = it.id && it.id.videoId;
    const watchUrl = videoId ? 'https://www.youtube.com/watch?v=' + videoId : '';
    const representative = preferredYoutubePoster(videoId, rawThumb);
    return { title: (it.snippet && it.snippet.title) || '', link: watchUrl, url: watchUrl, snippet: (it.snippet && it.snippet.description) || '', type: 'video', mediaType: 'video', source: 'youtube', thumbnail: representative, thumb: representative, image: representative, imageUrl: representative, imageSet: representative ? [representative] : [], originalImage: representative, fullImage: representative, viewerImage: representative, openImageUrl: representative, contentUrl: representative, cardImage: representative, videoId, videoUrl: watchUrl, watchUrl, embedUrl: videoId ? 'https://www.youtube.com/embed/' + videoId : '', openUrl: watchUrl, media: { type: 'video', preview: { poster: representative, image: representative, original: representative, thumbnail: representative, thumb: representative, videoUrl: watchUrl, embedUrl: videoId ? 'https://www.youtube.com/embed/' + videoId : '' } }, payload: { source: 'youtube', thumb: representative, thumbnail: representative, image: representative, originalImage: representative, videoId, videoUrl: watchUrl } };
  });
  return { source: 'youtube', results };
}

async function googleImageSearch(q, limit, start){
  const key = envFirst('GOOGLE_API_KEY','GOOGLE_SEARCH_API_KEY','GOOGLE_CUSTOM_SEARCH_API_KEY','GOOGLE_CLOUD_API_KEY');
  const cx = envFirst('GOOGLE_CSE_ID','GOOGLE_CX','GOOGLE_SEARCH_ENGINE_ID','GOOGLE_CUSTOM_SEARCH_ENGINE_ID','GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID');
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
  return { source: 'google_image', results: (data.items || []).map(it => ({ title: it.title || '', link: it.image && it.image.contextLink ? it.image.contextLink : it.link, url: it.image && it.image.contextLink ? it.image.contextLink : it.link, snippet: it.snippet || '', type: 'image', mediaType: 'image', source: 'google_image', thumbnail: it.link, thumb: it.link, image: it.link, imageUrl: it.link, imageSet: [it.link], originalImage: it.link, fullImage: it.link, viewerImage: it.link, openImageUrl: it.link, contentUrl: it.link, cardImage: it.link, payload: { source: 'google_image', thumb: it.link, image: it.link, originalImage: it.link, contextLink: it.image && it.image.contextLink } })) };
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
  if(source.includes('news') || type === 'news' || text.includes('뉴스') || text.includes('속보') || text.includes('실시간') || text.includes('보도자료') || text.includes('breaking') || text.includes('latest')) return 'news';
  if(mediaType === 'map' || type === 'map' || source.includes('local') || source.includes('map') || text.includes('지도') || text.includes('길찾기') || text.includes('주소') || text.includes('directions') || text.includes('nearby') || text.includes('transit')) return 'map';
  if(source.includes('book') || type === 'book' || text.includes('도서') || text.includes('책 ') || text.includes('서적') || text.includes('출판') || text.includes('저자') || text.includes('book') || text.includes('author')) return 'book';
  if(source.includes('blog')) return 'blog';
  if(source.includes('cafe') || type === 'community') return 'cafe';
  if(source.includes('kin') || text.includes('지식') || text.includes('q&a') || text.includes('문답')) return 'knowledge';
  if(source.includes('encyc') || host.includes('wikipedia.org') || host.includes('wikidata.org') || host.includes('namu.wiki') || host.includes('doopedia') || host.includes('britannica')) return 'knowledge';

  if(
    text.includes('관광') || text.includes('여행') || text.includes('명소') || text.includes('축제') ||
    text.includes('맛집') || text.includes('카페') || text.includes('공원') || text.includes('야경') ||
    text.includes('랜드마크') || text.includes('타워') || text.includes('전망대') || text.includes('박물관') || text.includes('미술관') ||
    text.includes('tour') || text.includes('travel') || text.includes('landmark') || text.includes('attraction') ||
    text.includes('restaurant') || text.includes('cafe') || text.includes('park') || text.includes('museum') || text.includes('gallery') ||
    host.includes('visit')
  ) return 'tour';

  if(text.includes('법원') || text.includes('구청') || text.includes('시청') || text.includes('관공서') || text.includes('court') || text.includes('city hall') || text.includes('district office') || text.includes('government office')) return 'map';
  if(text.includes('지하철') || text.includes('지하철역') || text.includes('버스') || text.includes('교통') || text.includes('metro') || text.includes('subway') || text.includes('station') || text.includes('bus route')) return 'map';

  if(text.includes('인스타') || host.includes('instagram.') || host.includes('threads.net') || host.includes('tiktok.') || host.includes('facebook.') || host.includes('x.com') || host.includes('twitter.') || source.includes('sns') || source.includes('social')) return 'sns';
  if(mediaType === 'video' || type === 'video' || source.includes('youtube') || source.includes('video') || host.includes('youtube.com') || host.includes('youtu.be')) return 'video';
  if(text.includes('쇼핑') || text.includes('가격') || text.includes('구매') || text.includes('shopping') || text.includes('price') || text.includes('product') || type === 'product' || mediaType === 'product') return 'shopping';
  if(text.includes('스포츠') || text.includes('축구') || text.includes('야구') || text.includes('농구') || text.includes('sports')) return 'sports';
  if(text.includes('증권') || text.includes('주식') || text.includes('환율') || text.includes('금융') || text.includes('finance') || text.includes('stock')) return 'finance';
  if(text.includes('웹툰') || text.includes('만화') || text.includes('webtoon') || text.includes('comic') || text.includes('manga')) return 'webtoon';

  if(host.includes('go.kr') || host.endsWith('.gov') || host.includes('.gov.') || host.includes('gov.uk') || host.includes('korea.kr')) return 'official';

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

  // Authority remains important, but should not dominate the whole first screen.
  if(host.endsWith('.go.kr') || host.includes('.go.kr')) bonus += 7;
  if(host.endsWith('.or.kr') || host.includes('.or.kr')) bonus += 1.5;
  if(host.endsWith('.ac.kr') || host.includes('.ac.kr')) bonus += 3;
  if(host.endsWith('.gov') || host.includes('.gov.') || host.endsWith('.gov.uk') || host.includes('gov.uk')) bonus += 7;
  if(host.includes('go.jp') || host.includes('gov.cn') || host.includes('gouv.fr') || host.includes('bund.de')) bonus += 6;
  if(host.endsWith('.edu') || host.includes('.edu.') || host.includes('ac.uk') || host.includes('edu.cn')) bonus += 4;

  if(host.includes('busan.go.kr')) bonus += 8;
  if(host.includes('seoul.go.kr')) bonus += 8;
  if(host.includes('korea.kr')) bonus += 7;
  if(host.includes('visitbusan.net') || host.includes('visitseoul.net') || host.includes('visitkorea.or.kr')) bonus += 7;

  if(query && (query.includes('부산') || query.includes('busan')) && (host.includes('busan') || title.includes('부산광역시'))) bonus += 5;
  if(query && (query.includes('서울') || query.includes('seoul')) && (host.includes('seoul') || title.includes('서울특별시'))) bonus += 5;

  if(host.includes('wikipedia.org') || host.includes('wikidata.org')) bonus += 5;
  if(host.includes('namu.wiki')) bonus += 3;
  if(host.includes('britannica.com') || host.includes('doopedia.co.kr')) bonus += 3;

  if(source.includes('search-bank')) bonus += 0.8;
  if(cat === 'news') bonus += 3.0;
  if(cat === 'tour') bonus += 2.4;
  if(cat === 'map') bonus += 3.0;
  if(cat === 'knowledge') bonus += 2.0;
  if(cat === 'book') bonus += 2.2;
  if(cat === 'image' || cat === 'video') bonus += 1.4;
  if(it && isRealImageUrl(it.thumbnail)) bonus += 1.0;

  if(host.includes('google.com') && url.includes('/search?')) bonus -= 2;
  if(host.includes('youtube.com') && url.includes('/results?')) bonus -= 1.5;

  return bonus;
}

function matchesSearchType(it, searchType, q){
  const t = normalizeSearchType(searchType);
  if(t === 'all') return true;

  const cat = classifySearchCategory(it);
  const text = itemLooseText(it);
  const query = safeString(q).toLowerCase();

  if(t === 'web') return ['web','official','news','blog','cafe','knowledge','tour'].includes(cat);

  if(t === 'map') {
    return ['map','tour','cafe','blog','image','web','official','news'].includes(cat) ||
      hasAnyLooseTerm(text, [
        '지도','주소','길찾기','위치','근처','맛집','카페','공원',
        '지하철','지하철역','역 ', '역)', '역,', '버스','교통','노선','환승','주차장',
        '법원','구청','시청','관공서','랜드마크',
        'map','address','directions','location','nearby','restaurant','cafe','park',
        'subway','metro','station','bus','transit','route','parking','court','city hall','district office','government office','landmark'
      ]);
  }

  if(t === 'knowledge') {
    return ['knowledge','official','book','news','web','tour','map'].includes(cat) ||
      hasAnyLooseTerm(text, ['정보','역사','뜻','의미','백과','지식','자료','문화','교통','행정','생활정보','법원','기관','information','history','meaning','official','data','culture','institution']);
  }

  if(t === 'tour') {
    return ['tour','map','cafe','blog','image','video','news','knowledge','web','official'].includes(cat) ||
      hasAnyLooseTerm(text, [
        '관광','여행','명소','공원','카페','맛집','야경','축제','행사',
        '박물관','미술관','한강','산책','둘레길','문화','전시','공연',
        '데이트','가볼만한곳','지하철','교통','버스','역','시장','거리','랜드마크','타워','전망대',
        'travel','tourism','things to do','landmark','attraction','restaurant','cafe','park','museum','gallery','tower','viewpoint','market','street','transit'
      ]);
  }

  if(t === 'sns') {
    return ['sns','video','blog','cafe','image','news'].includes(cat) ||
      hasAnyLooseTerm(text, ['유튜브','youtube','인스타','instagram','threads','틱톡','tiktok','facebook','x.com','twitter','sns','소셜','쇼츠','릴스','social','shorts','reels']);
  }

  if(t === 'book') return ['book','knowledge','webtoon','blog','image','shopping','web'].includes(cat) || hasAnyLooseTerm(text, ['책','도서','서점','출판','저자','웹소설','전자책','book','author','ebook','publishing']);
  if(t === 'webtoon') return ['webtoon','image','book','blog','cafe','video','web'].includes(cat) || hasAnyLooseTerm(text, ['웹툰','만화','웹소설','캐릭터','애니','코믹','comic','cartoon','manga','web novel','character','author']);
  if(t === 'cafe') return ['cafe','blog','tour','map','image','web','news'].includes(cat) || hasAnyLooseTerm(text, ['카페','커뮤니티','후기','모임','맛집','디저트','브런치','분위기','공간','cafe','restaurant','review','dessert','brunch']);
  if(t === 'blog') return ['blog','cafe','tour','image','web','news','map'].includes(cat);
  if(t === 'image') return ['image','tour','blog','cafe','video','web','map'].includes(cat) || hasAnyLooseTerm(text, ['사진','이미지','풍경','갤러리','포토','공원','카페','야경','photo','image','gallery','landmark']);
  if(t === 'video') return ['video','sns','image','blog','tour'].includes(cat) || hasAnyLooseTerm(text, ['영상','동영상','유튜브','youtube','쇼츠','브이로그','video','vlog']);

  if(cat === t) return true;
  if(query && text.includes(query) && ['web','blog','cafe','image','video','news','map','tour','knowledge'].includes(cat)) return true;
  return false;
}

function balanceMixedResults(ranked){
  const out = [];
  const used = new Set();
  const buckets = Object.create(null);

  const order = ['news','tour','map','knowledge','image','video','book','blog','cafe','sns','web','official','shopping','sports','finance','webtoon'];

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

  // First screen balance:
  // authority only 1~2, then real-time/news/local/tour/knowledge/book/media.
  take('official', 2);
  take('news', 3);
  take('map', 2);
  take('tour', 2);
  take('knowledge', 2);
  take('book', 1);
  take('image', 2);
  take('video', 1);
  take('blog', 1);
  take('cafe', 1);
  take('sns', 1);

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
    .filter(it => matchesSearchType(it, searchType, q))
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



// =========================================================
// MARU MEDIA ENGINE HOOK — SAFE EXPLICIT OPT-IN ONLY
// ---------------------------------------------------------
// This block is intentionally isolated from the core search pipeline.
// It never throws to the caller and never runs unless explicitly requested.
// =========================================================
let MaruMediaEngine = null;
let MaruMediaEngineLoaded = false;

function getMaruMediaEngine(){
  if(MaruMediaEngineLoaded) return MaruMediaEngine;
  MaruMediaEngineLoaded = true;
  try { MaruMediaEngine = require('./maru-media-engine'); }
  catch(e) { MaruMediaEngine = null; }
  return MaruMediaEngine;
}

function mediaEngineExplicitRequested(raw){
  raw = raw || {};
  return truthy(raw.includeMedia)
    || truthy(raw.useMediaEngine)
    || truthy(raw.mediaEngine)
    || truthy(raw.enableMediaEngine)
    || truthy(raw.includeImmersive)
    || truthy(raw.useImmersiveMedia);
}

function mediaEngineExplicitBlocked(raw, noMedia){
  raw = raw || {};
  return !!noMedia
    || truthy(raw.noMediaEngine)
    || truthy(raw.disableMediaEngine)
    || truthy(raw.skipMediaEngine);
}

function shouldAttachMediaEngine(raw, noMedia){
  if(mediaEngineExplicitBlocked(raw, noMedia)) return false;
  return true;
}

function mediaEngineQueryType(searchType, raw){
  const forced = normalizeSearchType(raw && (raw.mediaType || raw.mediaSearchType || raw.type || raw.category || raw.tab || raw.vertical));
  const direct = safeString(raw && (raw.mediaType || raw.mediaSearchType)).trim().toLowerCase();
  if(direct) return direct;
  return forced === 'all' ? normalizeSearchType(searchType) : forced;
}

function compactMediaHookItem(item, query){
  const raw = (item && typeof item === 'object') ? item : {};
  const out = canonicalizeItem(raw, query, raw.source || raw.provider || 'maru-media-engine');

  // Preserve media-engine specific fields that compact/canonical layers should not lose.
  if(raw.mediaPackage) out.mediaPackage = raw.mediaPackage;
  if(raw.mediaEngine) out.mediaEngine = raw.mediaEngine;
  if(raw.immersive) out.immersive = raw.immersive;
  if(raw.rights) out.rights = raw.rights;
  if(raw.risk) out.risk = raw.risk;
  if(raw.ai) out.ai = raw.ai;
  if(raw.mediaRevenue) out.mediaRevenue = raw.mediaRevenue;
  if(raw.linkRevenue) out.linkRevenue = raw.linkRevenue;
  if(raw.monetization) out.monetization = raw.monetization;

  out._mediaEngineHook = true;
  return out;
}

async function attachMediaEngineResults(base, event, ctx){
  base = base && typeof base === 'object' ? base : { items: [], results: [], meta: {} };
  const raw = (ctx && ctx.raw) || {};
  const q = safeString(ctx && ctx.q).trim();
  const limit = clampInt(ctx && ctx.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const hookMeta = {
    enabled: false,
    mode: 'controlled_auto_card_media_pulse',
    routedThrough: null,
    status: 'skipped',
    count: 0
  };

  if(!q || !shouldAttachMediaEngine(raw, ctx && ctx.noMedia)){
    return Object.assign({}, base, {
      meta: Object.assign({}, base.meta || {}, { mediaEngineHook: hookMeta })
    });
  }

  const engine = getMaruMediaEngine();
  if(!engine || typeof engine.runEngine !== 'function'){
    hookMeta.enabled = true;
    hookMeta.status = 'unavailable';
    hookMeta.error = 'maru-media-engine module not available';
    return Object.assign({}, base, {
      meta: Object.assign({}, base.meta || {}, { mediaEngineHook: hookMeta })
    });
  }

  try{
    const mediaLimit = clampInt(raw.mediaLimit || raw.mediaEngineLimit || Math.min(limit, 40), 20, 1, 80);
    const mediaType = mediaEngineQueryType(ctx && ctx.searchType, raw);

    const payload = {
      q,
      query: q,
      limit: mediaLimit,
      type: mediaType,
      mediaType,
      lang: ctx && ctx.lang,
      region: raw.region,
      country: raw.country,
      from: 'maru-search',
      source: 'maru-search',
      useMaruSearch: '0',
      viaMaruSearch: '0',
      noRevenue: '1',
      noAnalytics: '1',
      external: truthy(raw.mediaExternal) || truthy(raw.mediaEngineExternal) ? '1' : 'off',
      noExternal: truthy(raw.mediaExternal) || truthy(raw.mediaEngineExternal) ? undefined : '1',
      disableExternal: truthy(raw.mediaExternal) || truthy(raw.mediaEngineExternal) ? undefined : '1'
    };

    const res = await engine.runEngine({}, payload);
    const mediaItems = Array.isArray(res && res.items)
      ? res.items
      : (Array.isArray(res && res.results) ? res.results : []);

    const converted = mediaItems.map(it => compactMediaHookItem(it, q));
    const merged = dedupeCanonicalItems([].concat(base.items || [], converted)).slice(0, limit);

    const trace = Array.isArray(base.meta && base.meta.trace) ? base.meta.trace.slice() : [];
    trace.push({
      name: 'maru-media-engine',
      status: converted.length ? 'ok' : 'empty',
      count: converted.length,
      mode: 'controlled_auto_card_media_pulse'
    });

    hookMeta.enabled = true;
    hookMeta.routedThrough = 'maru-media-engine';
    hookMeta.status = converted.length ? 'ok' : 'empty';
    hookMeta.count = converted.length;
    hookMeta.mediaType = mediaType;

    return Object.assign({}, base, {
      source: base.source || 'maru-search',
      items: merged,
      results: merged,
      meta: Object.assign({}, base.meta || {}, {
        trace,
        mediaEngineHook: hookMeta
      })
    });
  }catch(e){
    hookMeta.enabled = true;
    hookMeta.routedThrough = 'maru-media-engine';
    hookMeta.status = 'soft-failed';
    hookMeta.error = safeString((e && e.message) || e).slice(0, 300);

    // Never break the main search response because of media hook failure.
    return Object.assign({}, base, {
      meta: Object.assign({}, base.meta || {}, { mediaEngineHook: hookMeta })
    });
  }
}



async function attachSanmaruAugmentResults(base, event, ctx){
  base = base && typeof base === 'object' ? base : { items: [], results: [], meta: {} };
  const raw = (ctx && ctx.raw) || {};
  const q = safeString(ctx && ctx.q).trim();
  const limit = clampInt(ctx && ctx.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const hookMeta = {
    enabled: false,
    mode: 'resident-first-augment-preserve-existing-results',
    status: 'skipped',
    count: 0,
    waitedForDeepSanmaru: false
  };

  if(!q || truthy(raw.noSanmaru) || truthy(raw.skipSanmaru) || truthy(raw.disableSanmaru)){
    return Object.assign({}, base, { meta: Object.assign({}, base.meta || {}, { sanmaruAugment: hookMeta }) });
  }

  const currentCount = Array.isArray(base.items) ? base.items.length : 0;
  const resident = getSanmaruResidentForMaru(q, raw, { searchType: ctx && ctx.searchType, lang: ctx && ctx.lang, reason:'maru-augment' });
  const residentItems = (resident.items || []).map(x => canonicalizeItem(x, q, x && (x.source || x.provider || 'sanmaru-resident')));
  let merged = dedupeCanonicalItems([].concat(base.items || [], residentItems));
  let trace = Array.isArray(base.meta && base.meta.trace) ? base.meta.trace.slice() : [];

  hookMeta.enabled = true;
  hookMeta.status = residentItems.length ? 'resident-ok' : (resident.meta && resident.meta.status) || 'resident-empty';
  hookMeta.count = residentItems.length;
  hookMeta.legacyCountBeforeSanmaru = currentCount;
  hookMeta.mergedCountAfterResident = merged.length;
  hookMeta.preservedExistingResults = true;
  hookMeta.resident = resident.meta || {};
  trace.push({ name: 'sanmaru-resident-augment', status: hookMeta.status, count: residentItems.length, mode:'no-blocking-external' });

  const waitRequested = truthy(raw.waitSanmaru) || truthy(raw.deepSanmaru) || truthy(raw.blockingSanmaru) || truthy(process.env.MARU_SEARCH_BLOCKING_SANMARU);
  if(waitRequested){
    let Sanmaru = null;
    try { Sanmaru = require('./sanmaru_engine_v2'); } catch(e) { Sanmaru = null; }
    if(Sanmaru && typeof Sanmaru.runSanmaru === 'function'){
      try{
        hookMeta.waitedForDeepSanmaru = true;
        const res = await Sanmaru.runSanmaru(q, {
          event: event || {}, q, query: q,
          limit: Math.min(MAX_LIMIT, Math.max(limit, currentCount, 1000)),
          candidatePool: Math.min(MAX_LIMIT, Math.max(limit, currentCount, 3000)),
          searchType: ctx && ctx.searchType,
          lang: ctx && ctx.lang,
          from: 'maru-search-augment-deep',
          source: 'maru-search',
          noMaruSearch: '1', skipMaruSearch: '1', noCollector: '1', skipCollector: '1', noPlanetary: '1', skipPlanetary: '1'
        });
        const sanItemsRaw = Array.isArray(res && res.items) ? res.items : (Array.isArray(res && res.results) ? res.results : []);
        const sanItems = sanItemsRaw.map(x => canonicalizeItem(x, q, x && (x.source || x.provider || 'sanmaru')));
        merged = dedupeCanonicalItems([].concat(merged, sanItems));
        hookMeta.deepCount = sanItems.length;
        hookMeta.status = sanItems.length ? 'resident-plus-deep-ok' : hookMeta.status;
        trace.push({ name: 'sanmaru-deep-augment', status: sanItems.length ? 'ok' : 'empty', count: sanItems.length, mode:'explicit-wait' });
      }catch(e){
        hookMeta.deepError = safeString((e && e.message) || e).slice(0, 200);
        trace.push({ name: 'sanmaru-deep-augment', status:'soft-failed', count:0, mode:'explicit-wait' });
      }
    }
  }

  const finalTarget = Math.min(MAX_LIMIT, Math.max(limit, currentCount, merged.length, MIN_RESULT_TARGET));
  const finalItems = merged.slice(0, finalTarget);
  absorbIntoSanmaruResident(q, finalItems, { searchType: ctx && ctx.searchType, lang: ctx && ctx.lang });

  return Object.assign({}, base, {
    source: base.source || (residentItems.length ? 'sanmaru-resident' : 'maru-search'),
    items: finalItems,
    results: finalItems,
    meta: Object.assign({}, base.meta || {}, {
      trace,
      sanmaruAugment: hookMeta,
      sanmaruRelation: 'maru-search-asks-resident-sanmaru-first; deep sanmaru is explicit only',
      legacyWideSearchPreserved: true
    })
  });
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

    const visibleNeed = clampInt(firstNonEmpty(raw && (raw.perPage || raw.pageSize || raw.visibleCardsPerPage || raw.visibleLimit), 15), 15, 1, 100);
    const forceProviderRefresh = deep || explicitExternalRequested(raw) || truthy(raw && (raw.refresh || raw.forceRefresh || raw.waitProviders || raw.waitExternal));
    if(!forceProviderRefresh && !truthy(raw && (raw.noResident || raw.skipResident || raw.disableResident))){
      const residentPack = getSanmaruResidentForMaru(q, raw || {}, { searchType, lang, reason:'maru-immediate-response' });
      if((residentPack.items || []).length >= visibleNeed){
        return ok(buildImmediateResidentResponse(q, raw || {}, residentPack, {
          residentImmediateThreshold: visibleNeed,
          note: 'provider refresh was not forced; returned Sanmaru resident supply immediately'
        }));
      }
    }

    let base = await orchestrateSearch({ event, q, limit, start, lang, deep, externalOff, externalMode, noMedia, searchType });
    base = await attachMediaEngineResults(base, event, { q, limit, start, lang, searchType, raw, noMedia });
    base = await attachSanmaruAugmentResults(base, event, { q, limit, start, lang, searchType, raw, noMedia });
    // Search must not trigger heavy settlement/distribution by default.
    // Analytics is opt-in for this endpoint; weekly settlement is handled by revenue/commerce engines.
    const analyticsRequested = truthy(raw && (raw.analytics || raw.track || raw.enableAnalytics)) || truthy(process.env.MARU_SEARCH_ANALYTICS);
    const realtimeRevenueRequested = truthy(raw && (raw.realtimeRevenue || raw.distributeNow || raw.enableRealtimeRevenue)) || truthy(process.env.MARU_SEARCH_REALTIME_REVENUE);
    const analyticsOff = truthy(raw && (raw.noAnalytics || raw.disableAnalytics)) || !analyticsRequested;
    const revenueOff = truthy(raw && (raw.noRevenue || raw.disableRevenue)) || !realtimeRevenueRequested;
    if(!analyticsOff) syncSearchAnalytics(event, q, base.items).catch(() => null);
    base.items = (Array.isArray(base.items) ? base.items : []).map(compactResultItem);
    base.results = base.items;
    absorbIntoSanmaruResident(q, base.items, { searchType, lang });
    const fullSectionPack = buildSearchSections(base.items, q, { searchType });
    const visiblePagePack = buildCollapseAwareVisiblePagePack(base.items, q, raw || {}, fullSectionPack);
    const viewportSections = buildViewportDisplaySections(visiblePagePack.pageItems, q, fullSectionPack, visiblePagePack);
    const sectionPackWithViewport = Object.assign({}, fullSectionPack, {
      sections: viewportSections.sections,
      fullSections: fullSectionPack.sections,
      visibleSections: viewportSections.visibleSections || viewportSections.sections,
      displaySections: viewportSections.displaySections || viewportSections.sections,
      viewportSections: viewportSections.viewportSections || viewportSections.sections,
      pageItems: visiblePagePack.pageItems,
      visiblePagePack,
      visibleCardsPerPage: visiblePagePack.visibleCardsPerPage,
      visibleCount: visiblePagePack.visibleCount,
      page: visiblePagePack.page,
      totalPages: visiblePagePack.totalPages,
      hasNextPage: visiblePagePack.hasNextPage,
      bodyPreserved: true,
      sectionsPreserved: false,
      fullSectionsPreserved: true,
      viewportBackfill: true,
      doesNotLimitItemsResults: true
    });
    if(!revenueOff) distributeRevenue(event, base.items).catch(() => null);
    return ok({
      status: 'ok', engine: 'maru-search', version: VERSION, query: q, source: base.source,
      items: base.items, results: base.items,
      sections: viewportSections.sections,
      visibleSections: viewportSections.visibleSections || viewportSections.sections,
      displaySections: viewportSections.displaySections || viewportSections.sections,
      viewportSections: viewportSections.viewportSections || viewportSections.sections,
      pageItems: visiblePagePack.pageItems,
      visiblePagePack,
      sectionPack: sectionPackWithViewport,
      meta: Object.assign({}, base.meta || {}, { count: (base.items || []).length, limit, viewport: { page: visiblePagePack.page, perPage: visiblePagePack.perPage, totalPages: visiblePagePack.totalPages, visibleCount: visiblePagePack.visibleCount, totalVisibleItems: visiblePagePack.totalVisibleItems, collapsedExcludedCount: visiblePagePack.collapsedExcludedCount, collapsedItemsExcludedFromCount: true, bodyPreserved: true, backfill:true }, region: base.region || null, route: base.route || null, sourceRoute: base.sourceRoute || base.route || null, sections: { enabled: true, mode: viewportSections.mode, totalSections: viewportSections.totalSections, fullSectionCount: fullSectionPack.totalSections, counts: fullSectionPack.counts, order: fullSectionPack.order }, groupedSectionsEnabled: true, expandableSectionsEnabled: true, analyticsSuppressed: analyticsOff, revenueSuppressed: revenueOff, settlementMode: 'weekly_batch', settlementCronUTC: '30 12 * * 1', preservationPatch: 'A1.5.35-559-visible15-provider-alias-safe' })
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
    noRevenue: req.noRevenue,
    includeMedia: req.includeMedia,
    useMediaEngine: req.useMediaEngine,
    mediaEngine: req.mediaEngine,
    enableMediaEngine: req.enableMediaEngine,
    noMediaEngine: req.noMediaEngine,
    disableMediaEngine: req.disableMediaEngine,
    skipMediaEngine: req.skipMediaEngine,
    mediaLimit: req.mediaLimit,
    mediaEngineLimit: req.mediaEngineLimit,
    mediaExternal: req.mediaExternal,
    mediaEngineExternal: req.mediaEngineExternal,
    includeImmersive: req.includeImmersive,
    useImmersiveMedia: req.useImmersiveMedia
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
