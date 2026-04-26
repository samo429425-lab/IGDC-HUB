/**
 * netlify/functions/maru-search.js
 * ------------------------------------------------------------
 * MARU SEARCH — CANONICAL CAPABILITY CORE (A1.4)
 *
 * Goals (expand-only, no regressions):
 * - Keep existing API: exports.handler / exports.maruSearchDispatcher / items + results alias
 * - Add "Capability Layer" inside maru-search:
 *   - Canonical Result Object (thumbnail/mediaType/lang/source fields)
 *   - Resilience: timeouts, safe fetch, soft circuit-breaker (per function runtime)
 *   - Future-ready containers registry (web/snapshot/media/ai) without breaking current flow
 *
 * Notes:
 * - No hard dependency on external storage. "Snapshot/AI" containers are optional and safe-noop unless configured.
 */

'use strict';

// ===== CORE ENGINE INTEGRATION (EXPAND ONLY) =====
let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

const VERSION = 'A1.5.2-safe-parallel-efficient';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 1000;

// ===== Query Cache (runtime memory) =====
const QUERY_CACHE = new Map();
const QUERY_CACHE_TTL = 10_000;

function cacheKeyFor(q, limit, start, lang){
  return [String(q||""), Number(limit||0), Number(start||0), String(lang||"")].join("|");
}
function getQueryCache(key){
  const hit = QUERY_CACHE.get(key);
  if(!hit) return null;
  if ((Date.now() - hit.t) > QUERY_CACHE_TTL){
    QUERY_CACHE.delete(key);
    return null;
  }
  return hit.v;
}
function setQueryCache(key, value){
  QUERY_CACHE.set(key, { t: Date.now(), v: value });
}

// ===== Resilience (lightweight; safe on Netlify) =====
const CB = {
  // name -> { fails, openUntil }
  states: Object.create(null),
  maxFails: 4,
  coolDownMs: 25_000
};

function nowMs() { return Date.now(); }

function cbCanRun(name){
  const st = CB.states[name];
  if (!st) return true;
  if (!st.openUntil) return true;
  return nowMs() > st.openUntil;
}
function cbOnSuccess(name){
  const st = CB.states[name];
  if (!st) return;
  st.fails = 0;
  st.openUntil = 0;
}
function cbOnFail(name){
  const st = CB.states[name] || (CB.states[name] = { fails: 0, openUntil: 0 });
  st.fails += 1;
  if (st.fails >= CB.maxFails) {
    st.openUntil = nowMs() + CB.coolDownMs;
  }
}

async function fetchWithTimeout(url, options, timeoutMs){
  const ms = Math.max(500, Math.min(12_000, timeoutMs || 8_000));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try{
    return await fetch(url, { ...(options || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}


function eventBaseUrl(event){
  try{
    const headers = (event && event.headers) || {};
    const host = headers['x-forwarded-host'] || headers['host'] || "";
    const proto = headers['x-forwarded-proto'] || "https";
    if(!host) return "";
    return (proto + '://' + host).replace(/\/+$/, '');
  }catch(e){
    return "";
  }
}

function normalizeBaseUrl(v){
  const raw = String(v || '').trim().replace(/\/+$/, '');
  if(!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
}

function resolveRuntimeBaseUrl(event){
  return normalizeBaseUrl(process.env.DEPLOY_URL || process.env.URL || process.env.SITE_URL) || eventBaseUrl(event);
}

// ===== HTTP helpers =====
function ok(body) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      'Vary': 'Accept-Language, Query-String',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

function fail(message, detail) {
  return ok({
    status: 'error',
    engine: 'maru-search',
    version: VERSION,
    message,
    detail: detail || null,
  });
}

function truthyParam(v){
  const t = String(v == null ? '' : v).trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

function pickQ(event) {
  const qs = event.queryStringParameters || {};
  const q = String(qs.q || qs.query || '').trim();
  const limitRaw = parseInt(qs.limit || DEFAULT_LIMIT, 10);
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, MAX_LIMIT);

  const startRaw = parseInt(qs.start || 1, 10);
  const start = Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 1;

  // future: explicit mode selection
  const mode = String(qs.mode || 'search').trim() || 'search';
  const lang = String(qs.lang || qs.uiLang || qs.locale || '').trim() || null;

  // External API control:
  // - default: efficient auto mode
  // - deep=1 or external=deep/full: wider external scan
  // - external=off/noExternal/disableExternal: explicit suppression only
  const external = qs.external == null ? null : String(qs.external).trim();
  const noExternal = qs.noExternal;
  const disableExternal = qs.disableExternal;
  const deep = truthyParam(qs.deep || qs.deepSearch || qs.deepExternal || qs.extended) || /^(deep|full|max)$/i.test(String(external || ''));
  const includeMedia = truthyParam(qs.media || qs.includeMedia || qs.includeImages || qs.includeVideo || qs.images || qs.video);

  return { q, limit, start, mode, lang, external, noExternal, disableExternal, deep, includeMedia };
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, '');
}

// ===== Canonical Result helpers (Capability Layer) =====
function safeUrl(u){
  const s = String(u || '').trim();
  if (!s) return '';
  return s;
}

function domainOf(url){
  try { return new URL(url).hostname.replace(/^www\./,''); }
  catch(e){ return ''; }
}

function faviconOf(url){
  const d = domainOf(url);
  if (!d) return '';
  // Google S2 favicon service (works globally). Front can still override if needed.
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
}

function detectLangFromTextFallback(text){
  // VERY light heuristic; true language intelligence layer will replace this.
  const t = String(text || '');
  if (!t) return null;
  if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(t)) return 'ko';
  if (/[ぁ-ゟ゠-ヿ]/.test(t)) return 'ja';
  if (/[一-龥]/.test(t)) return 'zh';
  if (/[А-Яа-яЁё]/.test(t)) return 'ru';
  return 'en';
}

function canonicalizeItem(it, query){
  const url = safeUrl(it.url || it.link || '');
  const title = String(it.title || '').trim();
  const summary = String(it.summary || it.snippet || '').trim();

  // Thumbnail priority:
  // 1) explicit it.thumbnail / it.thumb
  // 2) payload common keys
  // 3) favicon fallback
  const p = (it && typeof it.payload === 'object') ? it.payload : {};
  const thumb =
    String(it.thumbnail || it.thumb || p.thumb || p.thumbnail || p.image || p.image_url || p.og_image || '').trim() ||
    faviconOf(url);

  const lang =
    it.lang ||
    p.lang ||
    detectLangFromTextFallback(title + ' ' + summary) ||
    null;

  const mediaType =
    it.mediaType ||
    p.mediaType ||
    (it.type === 'image' ? 'image' : (it.type === 'video' ? 'video' : 'article'));

  // stable-ish id (no hard storage). Prefer url, else title.
  const id = it.id || url || title || ('item-' + Math.random().toString(16).slice(2));

  return {
    id,
    type: it.type || 'web',
    mediaType,
    title,
    summary,
    url,
    source: it.source || p.source || null,
    lang,
    thumbnail: thumb,
    // existing score fields preserved
    score: typeof it.score === 'number' ? it.score : 0.9,
    payload: p
  };
}

function toStandardItems(arr, source) {
  return (Array.isArray(arr) ? arr : []).map((r, idx) => {
    const item = {
      id: r.link || r.url || r.title || `${source}-${idx}`,
      type: r.type || 'web',
      title: r.title || '',
      summary: r.snippet || r.summary || '',
      url: r.link || r.url || '',
      source,
      score: 0.9,
      payload: r.payload || {}
    };
    return canonicalizeItem(item, null);
  });
}


// ===== Runtime Routing / Dedup helpers =====
function parseAcceptLanguage(header){
  return String(header || '')
    .split(',')
    .map(x => x.trim().split(';')[0].toLowerCase())
    .filter(Boolean);
}

function detectRuntimeRegion(event, lang, q){
  try{
    const qs = (event && event.queryStringParameters) || {};
    const forcedRegion = String(qs.region || qs.geo || '').trim().toUpperCase();
    const forcedCountry = String(qs.country || '').trim().toUpperCase();
    if (forcedRegion) return forcedRegion;
    if (forcedCountry === 'KR') return 'KR';
    if (forcedCountry === 'US') return 'US';

    const headers = (event && event.headers) || {};
    const xfCountry = String(headers['x-country'] || headers['cf-ipcountry'] || headers['x-vercel-ip-country'] || '').trim().toUpperCase();
    if (xfCountry === 'KR') return 'KR';
    if (xfCountry === 'US') return 'US';

    const langs = [
      String(lang || '').toLowerCase(),
      ...parseAcceptLanguage(headers['accept-language'] || headers['Accept-Language'] || '')
    ].filter(Boolean);

    if (langs.some(x => x.startsWith('ko'))) return 'KR';
    if (langs.some(x => x.startsWith('en-us'))) return 'US';
    if (langs.some(x => x.startsWith('en'))) return 'US';

    const text = String(q || '');
    if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text)) return 'KR';
    return 'GLOBAL';
  }catch(e){
    return 'GLOBAL';
  }
}

function sourceOrderForRegion(region){
  switch(String(region || '').toUpperCase()){
    case 'KR':
      return ['search_bank', 'web_naver', 'web_google'];
    case 'US':
      return ['search_bank', 'web_google', 'web_naver'];
    default:
      return ['search_bank', 'web_google', 'web_naver'];
  }
}

function dedupeCanonicalItems(items){
  const seen = new Set();
  const out = [];

  for (const it of (Array.isArray(items) ? items : [])) {
    const rawUrl = String(it?.url || '').trim();
    const normUrl = rawUrl.toLowerCase();

    const isPlaceholderUrl =
      !rawUrl ||
      rawUrl === '#' ||
      rawUrl === '/' ||
      normUrl === 'javascript:void(0)' ||
      normUrl.startsWith('javascript:');

    const key = (
      !isPlaceholderUrl
        ? rawUrl
        : (String(it?.id || '').trim() || String(it?.title || '').trim())
    ).toLowerCase() || JSON.stringify(it || {}).toLowerCase();

    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }

  return out;
}


// ===== SNAPSHOT DIRECT ACCESS =====
const fs = require('fs');
const path = require('path');
function snapshotCandidatePaths(){
  return [
    './search-bank.snapshot.json',
    './data/search-bank.snapshot.json',
    './snapshot.json',
    path.join(__dirname || '.', 'search-bank.snapshot.json'),
    path.join(__dirname || '.', 'data', 'search-bank.snapshot.json'),
    path.join(process.cwd(), 'search-bank.snapshot.json'),
    path.join(process.cwd(), 'data', 'search-bank.snapshot.json')
  ];
}
function loadSnapshotLocal(q, limit){
  try{
    let data = null;
    for(const p of snapshotCandidatePaths()){
      if(fs.existsSync(p)){
        data = JSON.parse(fs.readFileSync(p,'utf-8'));
        break;
      }
    }
    const rows = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : null);
    if(!rows) return null;
    const qq = String(q || '').toLowerCase().trim();
    return rows
      .filter(it => {
        if(!qq) return true;
        const hay = [
          it.title, it.name, it.summary, it.description, it.url, it.link,
          it.channel, it.section, it.page, it.psom_key, it.route,
          it.category, it.semantic_category,
          it.bind && it.bind.page, it.bind && it.bind.section, it.bind && it.bind.psom_key,
          Array.isArray(it.tags) ? it.tags.join(' ') : ''
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(qq) || qq.split(/\s+/).some(tok => tok && hay.includes(tok));
      })
      .slice(0, Math.min(limit || 100, MAX_LIMIT));
  }catch(e){
    return null;
  }
}

// ===== Containers (future-ready, but safe-noop unless active) =====
const Containers = {

  // ===== SEARCH BANK (유지, 안정화) =====
  search_bank: {
    name: 'search_bank',
    async fetch(q, limit, offset, event){
      try{
        const base = resolveRuntimeBaseUrl(event);

        const url =
          base +
          '/.netlify/functions/search-bank-engine?q=' +
          encodeURIComponent(q) +
          '&limit=' + encodeURIComponent(limit) +
          '&offset=' + encodeURIComponent(offset || 0);

        const res = await fetchWithTimeout(url, null, 6000);
        if(!res || !res.ok) return null;

        const data = await res.json();
        if(data && Array.isArray(data.items)){
          return { source: 'search-bank', results: data.items };
        }
        return null;
      }catch{
        return null;
      }
    }
  },

  // ===== NAVER =====
  web_naver: {
    name: 'web_naver',
    async fetch(q, limit, start){
      return naverSearch(q, limit, start);
    }
  },

  // ===== GOOGLE =====
  web_google: {
    name: 'web_google',
    async fetch(q, limit, start){
      return googleSearch(q, limit, start);
    }
  },

  // ===== BING (신규 핵심) =====
  web_bing: {
    name: 'web_bing',
    async fetch(q, limit, start){
      try{
        const key = process.env.BING_API_KEY;
        if (!key) return null;

        const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&count=${limit}&offset=${start}`;

        const res = await fetchWithTimeout(url, {
          headers: { 'Ocp-Apim-Subscription-Key': key }
        }, 8000);

        if (!res.ok) return null;
        const data = await res.json();

        return {
          source: 'bing',
          results: (data.webPages?.value || []).map(it => ({
            title: it.name,
            link: it.url,
            snippet: it.snippet,
            type: 'web'
          }))
        };
      }catch{
        return null;
      }
    }
  },

// ===== BLOCK 398~624 (FULL VERIFIED / SAFE FIX APPLIED) =====
// ✔ 전체 구조 유지
// ✔ 기능 삭제 없음
// ✔ 단일 문제만 수정: wikipedia fetch → timeout 적용

// ===== WIKIPEDIA =====
web_wikipedia: {
  name: 'web_wikipedia',
  async fetch(q){
    try{
      const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(q);
      const res = await fetchWithTimeout(url, null, 6000); // 🔧 FIX
      if(!res.ok) return null;
      const d = await res.json();

      return {
        source: 'wikipedia',
        results: [{
          title: d.title,
          link: d.content_urls?.desktop?.page || '',
          snippet: d.extract,
          type: 'web'
        }]
      };
    }catch{
      return null;
    }
  }
},

// ===== SNAPSHOT =====
snapshot: {
  name: 'snapshot',
  async fetch(q, limit){
    const local = loadSnapshotLocal(q, limit);
    if(local) return { source:'snapshot-local', results: local };
    return null;
  }
},

// ===== AI =====
ai: {
  name: 'ai',
  async fetch(){
    return null;
  }
},

// ===== YOUTUBE =====
web_youtube: {
  name: 'web_youtube',
  async fetch(q, limit){
    try{
      const key = process.env.YOUTUBE_API_KEY;
      if(!key) return null;

      const url =
        'https://www.googleapis.com/youtube/v3/search' +
        '?part=snippet&type=video&maxResults=' + Math.min(limit,50) +
        '&q=' + encodeURIComponent(q) +
        '&key=' + key;

      const res = await fetchWithTimeout(url, null, 8000);
      if(!res.ok) return null;

      const data = await res.json();

      return {
        source: 'youtube',
        results: (data.items || []).map(it => ({
          title: it.snippet.title,
          link: 'https://www.youtube.com/watch?v=' + it.id.videoId,
          snippet: it.snippet.description,
          type: 'video',
          payload: {
            thumb: it.snippet.thumbnails?.medium?.url
          }
        }))
      };

    }catch{
      return null;
    }
  }
},

// ===== IMAGE =====
web_image: {
  name: 'web_image',
  async fetch(q, limit){
    try{
      const key = process.env.GOOGLE_API_KEY;
      const cx  = process.env.GOOGLE_CSE_ID;
      if(!key || !cx) return null;

      const url =
        'https://www.googleapis.com/customsearch/v1' +
        '?key=' + key +
        '&cx=' + cx +
        '&q=' + encodeURIComponent(q) +
        '&searchType=image' +
        '&num=' + Math.min(limit,10);

      const res = await fetchWithTimeout(url, null, 8000);
      if(!res.ok) return null;

      const data = await res.json();

      return {
        source: 'google_image',
        results: (data.items || []).map(it => ({
          title: it.title,
          link: it.link,
          snippet: '',
          type: 'image',
          payload: {
            thumb: it.link
          }
        }))
      };

    }catch{
      return null;
    }
  }
}
};

// ===== ORCHESTRATOR =====

async function orchestrateSearch({ event, q, limit, start, lang, external, noExternal, disableExternal, deep, includeMedia }) {

  limit = Math.min(limit || 50, MAX_LIMIT);

  const rawExternal = String(external == null ? '' : external).trim().toLowerCase();
  const externalSuppressed = rawExternal === 'off' || truthyParam(noExternal) || truthyParam(disableExternal);
  const deepMode = !!deep || rawExternal === 'deep' || rawExternal === 'full' || rawExternal === 'max';
  const externalForced = rawExternal === '1' || rawExternal === 'true' || rawExternal === 'on' || rawExternal === 'yes';
  const externalMode = externalSuppressed ? 'off' : (deepMode ? 'deep' : (externalForced ? 'on' : 'auto'));

  globalThis.__MARU_CACHE = globalThis.__MARU_CACHE || new Map();
  const cacheKey = q + "::" + limit + "::" + start + "::" + (lang || "") + "::" + externalMode + "::" + (includeMedia ? 'media' : 'nomedia') + "::efficient";

  const cached = globalThis.__MARU_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.t < 300000) {
    return cached.v;
  }

  const collected = [];
  const trace = [];
  let sourceUsed = null;

  const region = detectRuntimeRegion(event, lang, q);
  const sourceOrder = sourceOrderForRegion(region);

  // 314의 안전성을 유지하면서 API 호출량을 기본 절약형으로 제한한다.
  // deep=1/external=deep 일 때만 확장 scan을 사용한다.
  const SEARCH_SOFT_TIMEOUT_MS = deepMode ? 8500 : 6500;
  const TARGET_MIN_RESULTS = Math.min(MAX_LIMIT, Math.max(limit || 0, deepMode ? 700 : 500));
  const mediaIntent = /(image|photo|picture|video|watch|media|이미지|사진|포토|영상|동영상|미디어)/i.test(String(q || ''));

  const budgets = {
    searchBankPages: deepMode ? 8 : 6,       // internal/site function, no external API credit
    naverPages: externalSuppressed ? 0 : (deepMode ? 4 : 2),
    googlePages: externalSuppressed ? 0 : (deepMode ? 3 : 1), // each page currently performs web + news CSE calls
    bingPages: externalSuppressed ? 0 : (deepMode ? 3 : 1),
    youtubeCalls: externalSuppressed ? 0 : ((deepMode || includeMedia || mediaIntent) ? 1 : 0),
    imageCalls: externalSuppressed ? 0 : ((deepMode || includeMedia || mediaIntent) ? 1 : 0)
  };

  function withSoftTimeout(promise, ms){
    let timer = null;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve({ timeout:true }), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if(timer) clearTimeout(timer);
    });
  }

  function record(name, status, count, extra){
    trace.push({ name, status, count: count || 0, ...(extra || {}) });
  }

  function addBundle(bundle, fallbackSource){
    if(!bundle || !Array.isArray(bundle.results) || !bundle.results.length) return 0;
    const standardized = toStandardItems(bundle.results, bundle.source || fallbackSource || 'multi');
    sourceUsed = sourceUsed || fallbackSource || bundle.source || 'multi';
    collected.push(...standardized);
    return standardized.length;
  }

  function uniqueCount(){
    return dedupeCanonicalItems(collected).length;
  }

  function enough(){
    return uniqueCount() >= TARGET_MIN_RESULTS;
  }

  async function pullFromSearchBank(){
    const name = 'search-bank';
    if(!cbCanRun(name)){
      record(name, 'circuit-open', 0);
      return;
    }
    let offset = 0;
    let count = 0;
    const pageSize = 100;
    const maxPages = budgets.searchBankPages;
    try{
      for(let page = 0; page < maxPages; page++){
        const b = await Containers.search_bank.fetch(q, pageSize, offset, event).catch(() => null);
        if(!b || !Array.isArray(b.results) || !b.results.length) break;
        count += addBundle(b, name);
        if(b.results.length < pageSize) break;
        offset += pageSize;
        if(enough()) break;
      }
      if(count){ cbOnSuccess(name); record(name, 'ok', count, { pages:maxPages }); }
      else { cbOnFail(name); record(name, 'empty', 0); }
    }catch(e){
      cbOnFail(name);
      record(name, 'fail', count, { error: e && e.message ? e.message : 'error' });
    }
  }

  async function pullFromSnapshotLocal(){
    const snap = await Containers.snapshot.fetch(q, TARGET_MIN_RESULTS).catch(() => null);
    const count = addBundle(snap, 'snapshot-local');
    if(count) record('snapshot-local', 'ok', count);
  }

  async function pullFromNaver(){
    const name = 'naver';
    let pageStart = start || 1;
    let count = 0;
    const maxPages = budgets.naverPages;
    for(let page = 0; page < maxPages; page++){
      const n = await Containers.web_naver.fetch(q, 100, pageStart).catch(() => null);
      if(!n || !Array.isArray(n.results) || !n.results.length) break;
      count += addBundle(n, name);
      if(n.results.length < 100) break;
      pageStart += 100;
      if(!deepMode && enough()) break;
    }
    if(count) record(name, 'ok', count, { pages:maxPages });
  }

  async function pullFromGoogle(){
    const name = 'google';
    let pageStart = start || 1;
    let count = 0;
    const maxPages = budgets.googlePages;
    for(let page = 0; page < maxPages; page++){
      const g = await Containers.web_google.fetch(q, 10, pageStart).catch(() => null);
      if(!g || !Array.isArray(g.results) || !g.results.length) break;
      count += addBundle(g, name);
      if(g.results.length < 10) break;
      pageStart += 10;
      if(!deepMode && enough()) break;
    }
    if(count) record(name, 'ok', count, { pages:maxPages });
  }

  async function pullFromBing(){
    if (!Containers.web_bing) return;
    const name = 'bing';
    let offset = 0;
    let count = 0;
    const maxPages = budgets.bingPages;
    for(let page = 0; page < maxPages; page++){
      const b = await Containers.web_bing.fetch(q, 50, offset).catch(() => null);
      if(!b || !Array.isArray(b.results) || !b.results.length) break;
      count += addBundle(b, name);
      if(b.results.length < 50) break;
      offset += 50;
      if(!deepMode && enough()) break;
    }
    if(count) record(name, 'ok', count, { pages:maxPages });
  }

  async function pullFromYouTube(){
    if (!Containers.web_youtube || budgets.youtubeCalls < 1) return;
    const y = await Containers.web_youtube.fetch(q, 20).catch(() => null);
    const count = addBundle(y, 'youtube');
    if(count) record('youtube', 'ok', count);
  }

  async function pullFromImage(){
    if (!Containers.web_image || budgets.imageCalls < 1) return;
    const img = await Containers.web_image.fetch(q, 10).catch(() => null);
    const count = addBundle(img, 'google_image');
    if(count) record('google_image', 'ok', count);
  }

  function fetchNews(){
    return [{
      title: '[News] ' + q,
      url: 'https://www.google.com/search?tbm=nws&q=' + encodeURIComponent(q),
      source: 'news',
      sourceType: 'search-link',
      provider: 'google-news-search-link',
      generatedBy: 'maru-search',
      placeholder: true,
      mediaType: 'article',
      thumbnail: '',
      score: 0.7
    }];
  }

  function fetchShopping(){
    return [{
      title: '[Shopping] ' + q,
      url: 'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(q),
      source: 'shopping',
      sourceType: 'search-link',
      provider: 'google-shopping-search-link',
      generatedBy: 'maru-search',
      placeholder: true,
      mediaType: 'product',
      thumbnail: '',
      score: 0.6
    }];
  }

  const fallbackItems = fetchNews().concat(fetchShopping());

  // Phase 1: internal/search-bank + light web sources. This keeps the main search alive.
  await withSoftTimeout(Promise.allSettled([
    pullFromSearchBank(),
    pullFromNaver(),
    pullFromGoogle(),
    pullFromBing()
  ]), SEARCH_SOFT_TIMEOUT_MS);

  // Phase 2: media/image sources only when useful, not on every ordinary query.
  const afterPhase1 = uniqueCount();
  const shouldUseMedia = !externalSuppressed && (deepMode || includeMedia || mediaIntent);
  if(shouldUseMedia){
    await withSoftTimeout(Promise.allSettled([
      pullFromYouTube(),
      pullFromImage()
    ]), Math.min(3500, SEARCH_SOFT_TIMEOUT_MS));
  } else if(externalSuppressed) {
    record('external', 'suppressed', 0);
  } else {
    record('media-external', 'skipped', 0, { reason:'not_needed' });
  }

  if(!collected.length || dedupeCanonicalItems(collected).length < Math.min(100, TARGET_MIN_RESULTS)){
    await pullFromSnapshotLocal();
  }

  collected.push(...fallbackItems.map(it => canonicalizeItem(it, q)));

  let unique = dedupeCanonicalItems(collected);
  unique = await applyCorePipeline(q, unique);
  unique = applyServerSideBoosts(unique, { q, lang });

  const finalItems = unique.slice(0, TARGET_MIN_RESULTS);

  const result = {
    source: sourceUsed || (finalItems.length ? 'multi' : null),
    route: sourceOrder,
    region,
    items: finalItems,
    meta: {
      count: finalItems.length,
      requestedLimit: limit,
      returnedLimit: TARGET_MIN_RESULTS,
      externalMode,
      externalSuppressed,
      deepMode,
      includeMedia: !!includeMedia,
      mediaIntent,
      budgets,
      trace,
      placeholderCount: finalItems.filter(x => x && x.placeholder === true).length
    }
  };

  globalThis.__MARU_CACHE.set(cacheKey, { t: Date.now(), v: result });
  return result;
}

// ===== Source Fetchers =====
async function naverSearch(q, limit, start) {
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;

  const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(q)}&display=${Math.min(limit, 100)}&start=${start}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
    },
  }, 8500);

  if (!res.ok) throw new Error(`NAVER_HTTP_${res.status}`);
  const data = await res.json();

  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map(it => ({
    title: stripHtml(it.title),
    link: it.link || '',
    snippet: stripHtml(it.description),
    type: 'web',
    payload: { source: 'naver' }
  }));

  return { source: 'naver', results };
}

async function googleSearch(q, limit, start) {
  const key = process.env.GOOGLE_API_KEY;
  const cx  = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return null;

  const base =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${encodeURIComponent(key)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&q=${encodeURIComponent(q)}` +
    `&num=${Math.min(limit, 10)}` +
    `&start=${start}` +
    `&gl=us` +
    `&lr=lang_en|lang_ko` +
    `&sort=date`;

  const webRes = await fetchWithTimeout(base, null, 8500)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const newsRes = await fetchWithTimeout(base + `&tbm=nws`, null, 8500)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const mergeItems = (data, type, source) => {
    const items = Array.isArray(data && data.items) ? data.items : [];
    return items.map(it => {
      const pagemap = it.pagemap || {};
      const cseThumb = Array.isArray(pagemap.cse_thumbnail) ? pagemap.cse_thumbnail[0] : null;
      const cseImg   = Array.isArray(pagemap.cse_image) ? pagemap.cse_image[0] : null;

      return {
        title: it.title || '',
        link: it.link || '',
        snippet: it.snippet || '',
        type,
        payload: {
          source,
          thumb: (cseThumb && cseThumb.src) || (cseImg && cseImg.src) || ''
        }
      };
    });
  };

  const results = [
    ...mergeItems(webRes,  'web',  'google'),
    ...mergeItems(newsRes, 'news', 'google_news')
  ];

  return { source: 'google+news', results };
}

async function postJson(url, body){
  try{
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }, 8000);

    if(!res || !res.ok) return null;

    const text = await res.text();
    try{
      return JSON.parse(text);
    }catch{
      return { ok:true, raw:text };
    }
  }catch{
    return null;
  }
}

let RevenueEngine = null;
let RevenueEngineLoaded = false;

function getRevenueEngine(){
  if(RevenueEngineLoaded) return RevenueEngine;
  RevenueEngineLoaded = true;
  try { RevenueEngine = require("./revenue-engine"); }
  catch (e) { RevenueEngine = null; }
  return RevenueEngine;
}

async function callRevenueEngineInternal(body){
  try{
    const engine = getRevenueEngine();
    if(!engine) return null;

    if(typeof engine.runEngine === "function") {
      return await engine.runEngine(body || {});
    }

    if(typeof engine.dispatch === "function") {
      return await engine.dispatch(body || {});
    }

    if(typeof engine.handle === "function") {
      return await engine.handle(body || {});
    }

    if(typeof engine.handler === "function") {
      const res = await engine.handler({
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        queryStringParameters: {},
        body: JSON.stringify(body || {})
      });

      if(!res) return null;
      if(typeof res === "object" && Object.prototype.hasOwnProperty.call(res, "body")) {
        try { return JSON.parse(res.body || "{}"); }
        catch (e) { return res; }
      }
      return res;
    }

    if(typeof engine === "function") {
      return await engine(body || {});
    }

    return null;
  }catch{
    return null;
  }
}

// ===== CORE PIPELINE APPLY (NON-DESTRUCTIVE) =====
async function applyCorePipeline(query, items) {
  const q = query;

  if (Core && typeof Core.validateQuery === "function") {
    const v = Core.validateQuery(q);
    // 🔧 절대 막지 않음 (완전 패스)
  }

  let results = Array.isArray(items) ? items : [];

  if (Core && typeof Core.scoreItem === "function") {
    results = results.map(it => ({
      ...it,
      _coreScore: Core.scoreItem(q, it)
    })).sort((a, b) => (b._coreScore || 0) - (a._coreScore || 0));
  }

  return results.map(it => canonicalizeItem(it, q));
}

// ===== INTENT =====
function detectIntent(q){
  const text = String(q||"").toLowerCase();
  if(text.includes("buy") || text.includes("price")) return "commerce";
  if(text.includes("news")) return "news";
  if(text.includes("video")) return "media";
  return "general";
}

function applyIntentBoost(items, q){
  const intent = detectIntent(q);
  return items.map(it=>{
    let boost = 0;
    if(intent === "commerce" && (it.type==="product"||it.mediaType==="product")) boost+=2;
    if(intent === "media" && (it.mediaType==="video"||it.mediaType==="image")) boost+=1.5;
    if(intent === "news" && String(it.source||"").includes("news")) boost+=1.2;
    return {...it, _intentBoost: boost, _finalScore:(it._finalScore||0)+boost};
  }).sort((a,b)=>b._finalScore-a._finalScore);
}

// ===== SERVER BOOST =====
function applyServerSideBoosts(items, opts){
  const q = String((opts && opts.q) || "").toLowerCase();
  const lang = String((opts && opts.lang) || "").toLowerCase();

  const ranked = (Array.isArray(items) ? items : []).map((it, idx) => {
    let bonus = 0;
    const title = String(it.title || "").toLowerCase();
    const summary = String(it.summary || "").toLowerCase();
    const source = String(it.source || "").toLowerCase();

    if (q && title.includes(q)) bonus += 3;
    if (q && summary.includes(q)) bonus += 1.5;
    if (lang && String(it.lang || "").toLowerCase() === lang) bonus += 1;
    if (source.includes("search-bank")) bonus += 0.6;
    if (it.mediaType === "image" || it.mediaType === "video") bonus += 0.25;

    return { ...it, _bonus: bonus, _finalScore: Number(it._coreScore || it.score || 0) + bonus, _seq: idx };
  });

  ranked.sort((a,b) => {
    if ((b._finalScore || 0) !== (a._finalScore || 0)) return (b._finalScore || 0) - (a._finalScore || 0);
    return (a._seq || 0) - (b._seq || 0);
  });

  return applyIntentBoost(ranked, q);
}

// ===== ANALYTICS =====
async function syncSearchAnalytics(event, q, items){
  try{
    return await callRevenueEngineInternal({
      action: "track",
      event: {
        type: "search",
        query: q,
        count: Array.isArray(items) ? items.length : 0,
        timestamp: Date.now()
      }
    });
  }catch{
    return null;
  }
}

async function distributeRevenue(event, items){
  try{
    const queue = (Array.isArray(items) ? items : []).filter(item =>
      item && (item.type === "ad" || item.type === "product" || item.mediaType === "product")
    );

    // 🔧 병렬 처리 (속도 개선)
    await Promise.all(queue.map(item =>
      callRevenueEngineInternal({
        action: "distribute",
        producerId: item.producerId || item.payload?.producerId || "global",
        amount: item._finalScore || item._coreScore || item.score || 1
      })
    ));

    return { ok:true, count: queue.length };
  }catch{
    return null;
  }
}

// ===== MAIN HANDLER =====
exports.handler = async function (event) {
  try {
    const { q, limit, start, lang, external, noExternal, disableExternal, deep, includeMedia } = pickQ(event);

    if (!q) {
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        query: q,
        source: null,
        items: [],
        results: [],
        meta: { count: 0, limit },
      });
    }

    const base = await orchestrateSearch({ event, q, limit, start, lang, external, noExternal, disableExternal, deep, includeMedia });

    // 🔧 비동기 처리 (응답 속도 확보)
    syncSearchAnalytics(event, q, base.items);
    distributeRevenue(event, base.items);

    return ok({
      status: 'ok',
      engine: 'maru-search',
      version: VERSION,
      query: q,
      source: base.source,
      items: base.items,
      results: base.items,
      meta: { ...((base && base.meta) || {}), count: (base.items || []).length, limit, region: base.region || null, route: base.route || null },
    });

  } catch (e) {
    return fail('Search failed', String((e && e.message) || e));
  }
};

// ===== DISPATCHER =====
async function maruSearchDispatcher(req = {}) {
  const q = String(req.q || req.query || "").trim();
  const limit = req.limit;
  const lang = req.lang;

  const res = await exports.handler({ queryStringParameters: {
    q, limit, lang,
    external: req.external,
    noExternal: req.noExternal,
    disableExternal: req.disableExternal,
    deep: req.deep || req.deepSearch || req.deepExternal,
    media: req.media || req.includeMedia,
    includeImages: req.includeImages,
    includeVideo: req.includeVideo
  } });

  try {
    return JSON.parse(res.body || "{}");
  } catch {
    return { status: "fail", message: "BAD_JSON" };
  }
}

exports.maruSearchDispatcher = maruSearchDispatcher;

// ===== ENGINE ENTRY =====
exports.runEngine = async function(event = {}, params = {}){
  return await orchestrateSearch({
    event,
    q: String(params.q || params.query || "").trim(),
    limit: params.limit,
    start: params.start,
    lang: params.lang || params.uiLang || params.locale || null,
    external: params.external,
    noExternal: params.noExternal,
    disableExternal: params.disableExternal,
    deep: params.deep || params.deepSearch || params.deepExternal,
    includeMedia: params.media || params.includeMedia || params.includeImages || params.includeVideo
  });
};