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
try { Core = require("../core/core"); } catch (e) { Core = null; }

const VERSION = 'A1.5-runtime-routing';
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
  const ms = Math.max(500, Math.min(12000, timeoutMs || 8000));
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

    const host =
      headers['x-forwarded-host'] ||
      headers['host'] ||
      "localhost:4000";

    const proto =
      headers['x-forwarded-proto'] ||
      "http";

    return proto + "://" + host;

  }catch(e){
    return "http://localhost:4000";
  }
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

function pickQ(event) {
  const qs = event.queryStringParameters || {};
  const q = String(qs.q || qs.query || '').trim();
  const limitRaw = parseInt(qs.limit || DEFAULT_LIMIT, 10);
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, MAX_LIMIT);

  const startRaw = parseInt(qs.start || 1, 10);
  const start = Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 1;

  // future: explicit mode selection
  const mode = String(qs.mode || 'search').trim() || 'search';
  const lang = String(qs.lang || '').trim() || null;

  return { q, limit, start, mode, lang };
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
  for(const it of (Array.isArray(items) ? items : [])){
    const key =
      String(it && (it.url || it.id || it.title || ''), '').trim().toLowerCase() ||
      JSON.stringify(it || {}).toLowerCase();
    if(!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}


// ===== SNAPSHOT DIRECT ACCESS =====
const fs = require('fs');
function loadSnapshotLocal(q, limit){
  try{
    const path = './snapshot.json';
    if(!fs.existsSync(path)) return null;
    const data = JSON.parse(fs.readFileSync(path,'utf-8'));
    if(!Array.isArray(data)) return null;
    return data
      .filter(it => String(it.title||'').toLowerCase().includes(String(q).toLowerCase()))
      .slice(0, limit);
  }catch(e){
    return null;
  }
}

// ===== Containers (future-ready, but safe-noop unless active) =====
const Containers = {

  search_bank: {
    name: 'search_bank',
    async fetch(q, limit, offset, event){
      try{
        const off = Number.isFinite(Number(offset)) ? Math.max(0, Number(offset)) : 0;

        const base = eventBaseUrl(event) || "http://localhost:4000";

        const res = await fetchWithTimeout(
          (base + "/search-bank?q=") +
          encodeURIComponent(q) +
          "&limit=" + encodeURIComponent(limit) +
          "&offset=" + encodeURIComponent(off),
          null,
          6000
        );

        if(!res || !res.ok) return null;

        const data = await res.json();

        if(data && Array.isArray(data.items)){
          return { source: 'search-bank-engine', results: data.items };
        }

        return null;

      }catch(e){
        return null;
      }
    }
  },

  web_naver: {
    name: 'web_naver',
    async fetch(q, limit, start){
      return naverSearch(q, limit, start);
    }
  },

  web_google: {
    name: 'web_google',
    async fetch(q, limit, start){
      return googleSearch(q, limit, start);
    }
  },

  snapshot: {
    name: 'snapshot',
    async fetch(q, limit){
      const local = loadSnapshotLocal(q, limit);
      if(local) return { source:'snapshot-local', results: local };
      return null;
    }
  },

  ai: {
    name: 'ai',
    async fetch(_q, _limit){
      return null;
    }
  }

};

  web_naver: {
    name: 'web_naver',
    async fetch(q, limit, start){
      return naverSearch(q, limit, start);
    }
  },

  web_google: {
    name: 'web_google',
    async fetch(q, limit, start){
      return googleSearch(q, limit, start);
    }
  },

  snapshot: {
    name: 'snapshot',
    async fetch(q, limit){
      const local = loadSnapshotLocal(q, limit);
      if(local) return { source:'snapshot-local', results: local };
      return null;
    }
  },

  ai: {
    name: 'ai',
    async fetch(_q, _limit){
      return null;
    }
  }

};

// Orchestrator: chooses containers, runs safely, accumulates, merges (FUTURE-GRADE)

async function orchestrateSearch({ event, q, limit, start, lang }) {
  const cacheKey = cacheKeyFor(q, limit, start, lang);
  const cached = getQueryCache(cacheKey);
  if (cached) return cached;

  const collected = [];
  let sourceUsed = null;
  const region = detectRuntimeRegion(event, lang, q);
  const sourceOrder = sourceOrderForRegion(region);

  async function pullFromSearchBank(){
    if (!cbCanRun('bank')) return;
let offset = 0;
const batchSize = 100;

while (collected.length < limit) {

  const b = await Containers.search_bank.fetch(q, batchSize, offset, event)
    .catch(() => { cbOnFail('bank'); return null; });

  if (!b || !b.results || !b.results.length) break;

  cbOnSuccess('bank');
  sourceUsed = sourceUsed || 'search-bank-engine';

  collected.push(...toStandardItems(b.results, 'search-bank-engine'));

  if (b.results.length < batchSize) break;

  offset += batchSize;
}
  }

  async function pullFromNaver(){
    if (!cbCanRun('naver')) return;
    let pageStart = Math.max(1, start || 1);

    while (collected.length < limit) {
      const batchSize = Math.min(100, limit - collected.length);
      const n = await Containers.web_naver.fetch(q, batchSize, pageStart)
        .catch(() => { cbOnFail('naver'); return null; });

      if (!n || !n.results || !n.results.length) break;

      cbOnSuccess('naver');
      sourceUsed = sourceUsed || 'naver';
      collected.push(...toStandardItems(n.results, n.source));

      if (n.results.length < batchSize) break;
      pageStart += batchSize;
    }
  }

  async function pullFromGoogle(){
    if (!cbCanRun('google')) return;
    let pageStart = Math.max(1, start || 1);

    while (collected.length < limit && pageStart <= 91) {
      const batchSize = Math.min(10, limit - collected.length);
      const g = await Containers.web_google.fetch(q, batchSize, pageStart)
        .catch(() => { cbOnFail('google'); return null; });

      if (!g || !g.results || !g.results.length) break;

      cbOnSuccess('google');
      sourceUsed = sourceUsed || 'google';
      collected.push(...toStandardItems(g.results, g.source));

      if (g.results.length < batchSize) break;
      pageStart += batchSize;
    }
  }

  for(const sourceName of sourceOrder){
    if (collected.length >= limit) break;
    if (sourceName === 'search_bank') await pullFromSearchBank();
    if (sourceName === 'web_naver') await pullFromNaver();
    if (sourceName === 'web_google') await pullFromGoogle();
  }

  const uniqueCollected = dedupeCanonicalItems(collected);

  if (uniqueCollected.length > 0) {
    let finalItems = await applyCorePipeline(q, uniqueCollected.slice(0, limit));
    finalItems = applyServerSideBoosts(finalItems, { q, lang }).slice(0, limit);

    await syncSearchAnalytics(event, q, finalItems);
    await distributeRevenue(event, finalItems);

    const out = {
      source: sourceUsed,
      route: sourceOrder,
      region,
      items: finalItems
    };
    setQueryCache(cacheKey, out);
    return out;
  }

  let fallbackItems = await applyCorePipeline(q, [
    {
      title: q,
      summary: 'Loose fallback result',
      source: 'fallback',
      score: 0.01
    }
  ]);
  fallbackItems = applyServerSideBoosts(fallbackItems, { q, lang }).slice(0, limit);

  await syncSearchAnalytics(event, q, fallbackItems);

  const out = {
    source: 'fallback',
    route: sourceOrder,
    region,
    items: fallbackItems
  };
  setQueryCache(cacheKey, out);
  return out;
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
    payload: {
      // naver webkr doesn't give thumb; leave payload open for future connectors
      source: 'naver'
    }
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

  // 1) WEB
  const webRes = await fetchWithTimeout(base, null, 8500)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  // 2) NEWS
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body || {})
    }, 8000);

    if(!res || !res.ok) return null;

    const text = await res.text();
    try{
      return JSON.parse(text);
    }catch(e){
      return { ok:true, raw:text };
    }
  }catch(e){
    return null;
  }
}

// ===== CORE PIPELINE APPLY (NON-DESTRUCTIVE) =====
async function applyCorePipeline(query, items) {
  const q = query;

  // Core.validateQuery may return boolean OR {ok, value}
  if (Core && typeof Core.validateQuery === "function") {
    const v = Core.validateQuery(q);
    if (v === false) return [];
    if (v && typeof v === 'object' && v.ok === false) return [];
  }

  let results = Array.isArray(items) ? items : [];

  if (Core && typeof Core.scoreItem === "function" && Array.isArray(results)) {
    results = results.map(it => ({
      ...it,
      _coreScore: Core.scoreItem(q, it)  // core.js signature supports (q,item); safe for older too
    })).sort((a, b) => (b._coreScore || 0) - (a._coreScore || 0));
  }

  // final canonical pass (ensures thumbnail/lang exist)
  results = results.map(it => canonicalizeItem(it, q));
  return results;
}


// ===== AI INTENT LAYER =====
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

// ===== SERVER-SIDE BOOSTS (safe on Netlify) =====
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

// ===== ANALYTICS / REVENUE SYNC =====
async function syncSearchAnalytics(event, q, items){
  try{
    const base = eventBaseUrl(event);
    if(!base) return null;
    return await postJson(`${base}/.netlify/functions/revenue-engine`, {
      action: "track",
      event: {
        type: "search",
        query: q,
        count: Array.isArray(items) ? items.length : 0,
        timestamp: Date.now()
      }
    });
  }catch(e){
    return null;
  }
}

async function distributeRevenue(event, items){
  try{
    const base = eventBaseUrl(event);
    if(!base) return null;

    const queue = (Array.isArray(items) ? items : []).filter(item =>
      item && (item.type === "ad" || item.type === "product" || item.mediaType === "product")
    );

    for (const item of queue){
      await postJson(`${base}/.netlify/functions/revenue-engine`, {
        action: "distribute",
        producerId: item.producerId || item.payload?.producerId || "global",
        amount: item._finalScore || item._coreScore || item.score || 1
      });
    }
    return { ok:true, count: queue.length };
  }catch(e){
    return null;
  }
}

// ===== MAIN HANDLER =====
exports.handler = async function (event) {
  try {
   const { q, limit, start, lang } = pickQ(event);

// env missing check stays consistent with previous behavior
/*
const envOk = !!(
  (process.env.NAVER_API_KEY && process.env.NAVER_CLIENT_SECRET) ||
  (process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID)
);
if (!envOk) {
  return fail('Missing env', 'Set NAVER_API_KEY+NAVER_CLIENT_SECRET or GOOGLE_API_KEY+GOOGLE_CSE_ID');
}
*/

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

    const base = await orchestrateSearch({ event, q, limit, start, lang });


    return ok({
      status: 'ok',
      engine: 'maru-search',
      version: VERSION,
      query: q,
      source: base.source,
      items: base.items,
      results: base.items, // legacy alias
      meta: { count: (base.items || []).length, limit, region: base.region || null, route: base.route || null },
    });

  } catch (e) {
    return fail('Search failed', String((e && e.message) || e));
  }
};

// ===== Internal dispatcher for bridge (non-HTTP call) =====
async function maruSearchDispatcher(req = {}) {
  const q = String(req.q || req.query || "").trim();
  const limit = req.limit;
  const lang = req.lang;
  const event = { queryStringParameters: { q, limit, lang } };
  const res = await exports.handler(event);
  try {
    return JSON.parse(res.body || "{}");
  } catch (e) {
    return { status: "fail", message: "BAD_JSON" };
  }
}

exports.maruSearchDispatcher = maruSearchDispatcher;


