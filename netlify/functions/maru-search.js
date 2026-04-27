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

const VERSION = 'A1.5.4-stabilized-internal-first-weekly-settlement';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const MIN_RESULT_TARGET = 500;
const DEFAULT_SOFT_TIMEOUT_MS = 8500;

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
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
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
  // Default is internal-only. External APIs run only when explicitly requested.
  const externalOff = explicitExternalBlocked(qs) || !explicitExternalRequested(qs);
  const noMedia = truthy(qs.noMedia) || truthy(qs.disableMedia);
  return { q, limit, start, lang, deep, externalOff, noMedia, raw: qs };
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

function snapshotCandidates(){
  const bases = [
    '.',
    './data',
    './assets/data',
    './public',
    process.cwd(),
    path.join(process.cwd(), 'data'),
    path.join(process.cwd(), 'assets', 'data'),
    path.join(process.cwd(), 'public'),
    __dirname || '.',
    path.join(__dirname || '.', 'data'),
    path.join(__dirname || '.', 'assets', 'data'),
    path.join(__dirname || '.', '..'),
    path.join(__dirname || '.', '..', 'data'),
    path.join(__dirname || '.', '..', 'assets', 'data')
  ];
  const names = [
    'search-bank.snapshot.json',
    'search-bank.snapshot(144).json',
    'search-bank.snapshot',
    'snapshot.json'
  ];
  const out = [];
  const seen = new Set();
  function add(p){
    const s = safeString(p);
    if(!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  }
  bases.forEach(base => names.forEach(name => add(path.join(base, name))));
  // Last-resort discovery for archived snapshot filenames such as search-bank.snapshot(144).json.
  bases.forEach(base => {
    try{
      if(!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return;
      fs.readdirSync(base).forEach(name => {
        if(/^search-bank\.snapshot.*\.json$/i.test(name) || /^snapshot.*\.json$/i.test(name)){
          add(path.join(base, name));
        }
      });
    }catch(e){}
  });
  return out;
}

function unwrapSearchPayload(data){
  if(!data) return null;
  if(typeof data === 'string'){
    try { return JSON.parse(data); } catch(e) { return null; }
  }
  if(typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'body')){
    const body = data.body;
    if(typeof body === 'string'){
      try { return JSON.parse(body || '{}'); } catch(e) { return null; }
    }
    if(body && typeof body === 'object') return body;
  }
  return data;
}

function extractSearchItems(data){
  const d = unwrapSearchPayload(data);
  if(!d) return [];
  if(Array.isArray(d.items)) return d.items;
  if(Array.isArray(d.results)) return d.results;
  if(Array.isArray(d.data)) return d.data;
  if(d.data && Array.isArray(d.data.items)) return d.data.items;
  if(d.data && Array.isArray(d.data.results)) return d.data.results;
  if(d.baseResult && Array.isArray(d.baseResult.items)) return d.baseResult.items;
  if(d.baseResult && Array.isArray(d.baseResult.results)) return d.baseResult.results;
  if(d.baseResult && d.baseResult.data && Array.isArray(d.baseResult.data.items)) return d.baseResult.data.items;
  if(d.baseResult && d.baseResult.data && Array.isArray(d.baseResult.data.results)) return d.baseResult.data.results;
  return [];
}

function normalizeSearchBundle(data, fallbackSource){
  const d = unwrapSearchPayload(data) || {};
  const items = extractSearchItems(d);
  if(!items.length) return null;
  const total = typeof d.total === 'number' ? d.total : (typeof d.count === 'number' ? d.count : null);
  return { source: d.source || d.engine || fallbackSource || 'search-bank', results: items, total };
}

let SnapshotRowsCache = null;
let SnapshotRowsPath = null;

function getSnapshotRowsLocal(){
  if(Array.isArray(SnapshotRowsCache)) return SnapshotRowsCache;
  SnapshotRowsCache = [];
  SnapshotRowsPath = null;
  for(const p of snapshotCandidates()){
    try{
      if(!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      let rows = extractSearchItems(data);
      if(!rows.length && Array.isArray(data)) rows = data;
      if(rows && rows.length){
        SnapshotRowsCache = rows;
        SnapshotRowsPath = p;
        break;
      }
    }catch(e){}
  }
  return SnapshotRowsCache;
}

function loadSnapshotLocal(q, limit, offset){
  try{
    const rows = getSnapshotRowsLocal();
    if(!rows || !rows.length) return null;
    const qq = safeString(q).trim().toLowerCase();
    const tokens = qq.split(/\s+/).filter(Boolean);
    const filtered = rows.filter(it => {
      const h = [
        it && it.id, it && it.title, it && it.name, it && it.summary, it && it.description,
        it && it.url, it && it.link, it && it.channel, it && it.section, it && it.page,
        it && it.psom_key, it && it.route, it && it.category,
        Array.isArray(it && it.tags) ? it.tags.join(' ') : '',
        it && it.bind && it.bind.page, it && it.bind && it.bind.section, it && it.bind && it.bind.psom_key,
        it && it.payload && it.payload.title, it && it.payload && it.payload.summary
      ].join(' ').toLowerCase();
      if(!qq) return true;
      return h.includes(qq) || tokens.some(t => h.includes(t));
    });
    const startAt = Math.max(0, parseInt(offset || 0, 10) || 0);
    const take = Math.min(limit || MAX_LIMIT, MAX_LIMIT);
    return filtered.slice(startAt, startAt + take);
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
  const names = [
    './search-bank-engine',
    './searchBankEngine',
    './search-bank.engine',
    './search-bank',
    './maru-search-bank-engine',
    './engines/search-bank-engine',
    './lib/search-bank-engine'
  ];
  const bases = [__dirname || '.', process.cwd()];
  for(const name of names){
    try { SearchBankEngine = require(name); if(SearchBankEngine) return SearchBankEngine; } catch(e) {}
  }
  for(const base of bases){
    for(const name of names){
      try {
        const full = path.join(base, name.replace(/^\.\//, ''));
        if(fs.existsSync(full + '.js') || fs.existsSync(full) || fs.existsSync(path.join(full, 'index.js'))){
          SearchBankEngine = require(full);
          if(SearchBankEngine) return SearchBankEngine;
        }
      } catch(e) {}
    }
  }
  SearchBankEngine = null;
  return SearchBankEngine;
}

async function callSearchBankEngineInternal(event, params){
  try{
    const engine = getSearchBankEngine();
    if(!engine) return null;

    const safeParams = Object.assign({}, params || {});
    const safeEvent = {
      httpMethod: 'GET',
      headers: (event && event.headers) || {},
      queryStringParameters: safeParams
    };

    let res = null;

    if(typeof engine.runEngine === 'function'){
      res = await engine.runEngine(event || safeEvent, safeParams);
    } else if(typeof engine.maruSearchDispatcher === 'function'){
      res = await engine.maruSearchDispatcher(safeParams);
    } else if(typeof engine.search === 'function'){
      res = await engine.search(safeParams, event || {});
    } else if(typeof engine.handler === 'function'){
      res = await engine.handler(safeEvent);
    } else if(typeof engine === 'function'){
      res = await engine(event || safeEvent, safeParams);
    }

    return unwrapSearchPayload(res);
  }catch(e){
    return null;
  }
}

const Containers = {
  search_bank: {
    async fetch(q, limit, offset, event){
      try{
        const safeLimit = Math.max(1, Math.min(parseInt(limit || 100, 10) || 100, MAX_LIMIT));
        const safeOffset = Math.max(0, parseInt(offset || 0, 10) || 0);
        const data = await callSearchBankEngineInternal(event, {
          q: safeString(q),
          query: safeString(q),
          limit: safeString(safeLimit),
          offset: safeString(safeOffset),
          from: 'maru-search',
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
        const bundle = normalizeSearchBundle(data, 'search-bank');
        if(bundle) return bundle;

        // Internal-only fallback: read bundled snapshot directly. No external API or function URL call.
        const local = loadSnapshotLocal(q, safeLimit, safeOffset);
        if(local && local.length) return { source: 'snapshot-local', results: local, total: null };

        return null;
      }catch(e){ return null; }
    }
  },
  web_naver: { async fetch(q, limit, start){ return naverSearch(q, limit, start); } },
  web_google: { async fetch(q, limit, start){ return googleSearch(q, limit, start); } },
  web_bing: { async fetch(q, limit, start){ return bingSearch(q, limit, start); } },
  web_youtube: { async fetch(q, limit){ return youtubeSearch(q, limit); } },
  web_image: { async fetch(q, limit, start){ return googleImageSearch(q, limit, start); } },
  snapshot: { async fetch(q, limit, offset){ const local = loadSnapshotLocal(q, limit, offset || 0); return (local && local.length) ? { source: 'snapshot-local', results: local } : null; } }
};

function sourceCaps(opts){
  const deep = !!opts.deep;
  return {
    searchBankPages: deep ? 50 : 50,
    naverPages: deep ? 6 : 2,
    googlePages: deep ? 6 : 2,
    bingPages: deep ? 5 : 2,
    imagePages: deep ? 5 : 1,
    youtubeLimit: deep ? 50 : 20,
    timeoutMs: deep ? 10500 : DEFAULT_SOFT_TIMEOUT_MS
  };
}

function addBundle(bundle, fallbackSource, collected, sourceState){
  if(!bundle || !Array.isArray(bundle.results) || !bundle.results.length) return 0;
  if(!sourceState.used) sourceState.used = fallbackSource || bundle.source || 'multi';
  const items = toStandardItems(bundle.results, bundle.source || fallbackSource || 'multi');
  collected.push.apply(collected, items);
  return items.length;
}

async function orchestrateSearch({ event, q, limit, start, lang, deep, externalOff, noMedia }){
  limit = clampInt(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  globalThis.__MARU_CACHE = globalThis.__MARU_CACHE || new Map();
  const cacheKey = [q, limit, start, lang || '', deep ? 'deep' : 'normal', externalOff ? 'external-off' : 'external-on', noMedia ? 'no-media' : 'media'].join('::');
  const cached = globalThis.__MARU_CACHE.get(cacheKey);
  if(cached && Date.now() - cached.t < 300000) return cached.v;

  const started = nowMs();
  const caps = sourceCaps({ deep });
  const deadline = started + caps.timeoutMs;
  const timeLeft = () => Math.max(0, deadline - nowMs());
  const collected = [];
  const sourceState = { used: null };
  const trace = [];
  const region = detectRuntimeRegion(event, lang, q);
  const sourceRoute = sourceOrderForRegion(region);

  function record(name, status, count){ trace.push({ name, status, count: count || 0 }); }

  async function pullFromSearchBank(){
    let count = 0;
    let offset = 0;
    for(let i=0; i<caps.searchBankPages && timeLeft() > 900; i++){
      const b = await Containers.search_bank.fetch(q, 100, offset, event).catch(() => null);
      const n = addBundle(b, 'search-bank', collected, sourceState);
      count += n;
      if(!b || !b.results || b.results.length < 100) break;
      offset += 100;
      if(count >= Math.max(MIN_RESULT_TARGET, limit)) break;
    }
    record('search-bank', count ? 'ok' : 'empty', count);
    if(!count){
      const snap = await Containers.snapshot.fetch(q, Math.max(limit, MIN_RESULT_TARGET)).catch(() => null);
      const n = addBundle(snap, 'snapshot-local', collected, sourceState);
      if(n) record('snapshot-local', 'ok', n);
    }
  }

  async function pullFromNaver(){
    if(externalOff) { record('naver', 'suppressed', 0); return; }
    let count = 0;
    let pageStart = start || 1;
    for(let i=0; i<caps.naverPages && pageStart <= 1000 && timeLeft() > 1200; i++){
      const naver = await Containers.web_naver.fetch(q, 100, pageStart).catch(() => null);
      const n = addBundle(naver, 'naver', collected, sourceState);
      count += n;
      if(!naver || !naver.results || naver.results.length < 100) break;
      pageStart += 100;
    }
    record('naver', count ? 'ok' : 'empty', count);
  }

  async function pullFromGoogle(){
    if(externalOff) { record('google', 'suppressed', 0); return; }
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
  }

  async function pullFromBing(){
    if(externalOff) { record('bing', 'suppressed', 0); return; }
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
  }

  async function pullFromYouTube(){
    if(externalOff || noMedia) { record('youtube', externalOff ? 'suppressed' : 'media-disabled', 0); return; }
    const y = await Containers.web_youtube.fetch(q, caps.youtubeLimit).catch(() => null);
    const n = addBundle(y, 'youtube', collected, sourceState);
    record('youtube', n ? 'ok' : 'empty', n);
  }

  async function pullFromImage(){
    if(externalOff || noMedia) { record('google_image', externalOff ? 'suppressed' : 'media-disabled', 0); return; }
    let count = 0;
    let pageStart = 1;
    for(let i=0; i<caps.imagePages && pageStart <= 91 && timeLeft() > 1200; i++){
      const img = await Containers.web_image.fetch(q, 10, pageStart).catch(() => null);
      const n = addBundle(img, 'google_image', collected, sourceState);
      count += n;
      if(!img || !img.results || img.results.length < 10) break;
      pageStart += 10;
    }
    record('google_image', count ? 'ok' : 'empty', count);
  }

  await Promise.allSettled([
    pullFromSearchBank(),
    pullFromNaver(),
    pullFromGoogle(),
    pullFromBing(),
    pullFromYouTube(),
    pullFromImage()
  ]);

  // No external navigation/link cards in internal-only mode.
  if(!externalOff){
    collected.push.apply(collected, mapCards(q, region));
    collected.push.apply(collected, googleLikeSearchLinks(q));
  }

  let unique = dedupeCanonicalItems(collected);
  unique = backfillVisuals(unique);
  unique = await applyCorePipeline(q, unique);
  unique = applyServerSideBoosts(unique, { q, lang });

  const finalTarget = Math.min(MAX_LIMIT, Math.max(limit, MIN_RESULT_TARGET));
  const finalItems = unique.slice(0, finalTarget);

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
      trace,
      externalSuppressed: !!externalOff,
      mediaDisabled: !!noMedia,
      deep: !!deep,
      elapsedMs: nowMs() - started
    }
  };

  globalThis.__MARU_CACHE.set(cacheKey, { t: Date.now(), v: result });
  return result;
}

function backfillVisuals(items){
  const list = Array.isArray(items) ? items.slice() : [];
  const imagePool = [];
  list.forEach(it => {
    if(!it) return;
    if(Array.isArray(it.imageSet)) imagePool.push.apply(imagePool, it.imageSet.filter(isRealImageUrl));
    if(it.mediaType === 'image' && isRealImageUrl(it.url)) imagePool.push(it.url);
    if(isRealImageUrl(it.thumbnail)) imagePool.push(it.thumbnail);
  });
  const pool = compactImages(imagePool);
  if(!pool.length) return list;
  let cursor = 0;
  return list.map((it, idx) => {
    if(!it || isRealImageUrl(it.thumbnail)) return it;
    const img = pool[cursor % pool.length];
    cursor += 1;
    const imageSet = compactImages([img].concat(Array.isArray(it.imageSet) ? it.imageSet : []).concat(pool.slice(0,3)));
    return Object.assign({}, it, { thumbnail: img, thumb: it.thumb || img, image: it.image || img, imageSet });
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

function applyIntentBoost(items, q){
  const intent = detectIntent(q);
  return (Array.isArray(items) ? items : []).map(it => {
    let boost = 0;
    if(intent === 'commerce' && (it.type === 'product' || it.mediaType === 'product')) boost += 2;
    if((intent === 'media' || intent === 'image') && (it.mediaType === 'video' || it.mediaType === 'image')) boost += 1.5;
    if(intent === 'news' && safeString(it.source).includes('news')) boost += 1.2;
    return Object.assign({}, it, { _intentBoost: boost, _finalScore: (it._finalScore || 0) + boost });
  }).sort((a,b) => (b._finalScore || 0) - (a._finalScore || 0));
}

function applyServerSideBoosts(items, opts){
  const q = safeString(opts && opts.q).toLowerCase();
  const lang = safeString(opts && opts.lang).toLowerCase();
  const ranked = (Array.isArray(items) ? items : []).map((it, idx) => {
    let bonus = 0;
    const title = safeString(it.title).toLowerCase();
    const summary = safeString(it.summary).toLowerCase();
    const source = safeString(it.source).toLowerCase();
    if(q && title.includes(q)) bonus += 3;
    if(q && summary.includes(q)) bonus += 1.5;
    if(lang && safeString(it.lang).toLowerCase() === lang) bonus += 1;
    if(source.includes('search-bank')) bonus += 0.6;
    if(it.mediaType === 'image' || it.mediaType === 'video') bonus += 0.8;
    if(isRealImageUrl(it.thumbnail)) bonus += 0.5;
    if(it.type === 'map' || it.mediaType === 'map') bonus += 0.3;
    return Object.assign({}, it, { _bonus: bonus, _finalScore: Number(it._coreScore || it.score || 0) + bonus, _seq: idx });
  });
  ranked.sort((a,b) => ((b._finalScore || 0) - (a._finalScore || 0)) || ((a._seq || 0) - (b._seq || 0)));
  return applyIntentBoost(ranked, q);
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

exports.handler = async function(event){
  try{
    const picked = pickQ(event || {});
    const { q, limit, start, lang, deep, externalOff, noMedia, raw } = picked;
    if(!q){
      return ok({ status: 'ok', engine: 'maru-search', version: VERSION, query: q, source: null, items: [], results: [], meta: { count: 0, limit } });
    }
    const base = await orchestrateSearch({ event, q, limit, start, lang, deep, externalOff, noMedia });
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
    externalOff: explicitExternalBlocked(params) || !explicitExternalRequested(params),
    noMedia: truthy(params.noMedia) || truthy(params.disableMedia)
  });
};
