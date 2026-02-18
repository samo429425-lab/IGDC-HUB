/**
 * netlify/functions/maru-search.js
 * ------------------------------------------------------------
 * MARU SEARCH — CANONICAL CAPABILITY CORE (A1.4+ bankfix)
 *
 * Expand-only:
 * - Keep existing API: exports.handler / exports.maruSearchDispatcher / items + results alias
 *
 * Patch:
 * - search-bank container now uses absolute URL (Netlify Functions safe)
 */

'use strict';

// ===== CORE ENGINE INTEGRATION (EXPAND ONLY) =====
let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

const VERSION = 'A1.4-capability+bankfix';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 1000;

// ===== Resilience (lightweight; safe on Netlify) =====
const CB = {
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

// ===== HTTP helpers =====
function ok(body) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
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
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
}

function detectLangFromTextFallback(text){
  const t = String(text || '');
  if (!t) return null;
  if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(t)) return 'ko';
  if (/[ぁ-ゟ゠-ヿ]/.test(t)) return 'ja';
  if (/[一-龥]/.test(t)) return 'zh';
  if (/[А-Яа-яЁё]/.test(t)) return 'ru';
  return 'en';
}

function canonicalizeItem(it, _query){
  const url = safeUrl(it.url || it.link || '');
  const title = String(it.title || '').trim();
  const summary = String(it.summary || it.snippet || '').trim();

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

function baseUrlFromEvent(event){
  const host = (event && event.headers && (event.headers["x-forwarded-host"] || event.headers["host"])) || "";
  const proto = (event && event.headers && event.headers["x-forwarded-proto"]) || "https";
  return host ? `${proto}://${host}` : "";
}

// ===== Containers =====
const Containers = {
  search_bank: {
    name: 'search_bank',
    async fetch(event, q, limit){
      try{
        const base = baseUrlFromEvent(event);
        if(!base) return null;

        const res = await fetchWithTimeout(
          `${base}/.netlify/functions/search-bank?q=` +
          encodeURIComponent(q) +
          `&limit=` + encodeURIComponent(limit),
          null,
          6000
        );
        if(!res || !res.ok) return null;
        const data = await res.json();
        if(data && Array.isArray(data.items)){
          return { source: 'search-bank', results: data.items };
        }
        return null;
      }catch(e){
        return null;
      }
    }
  },

  web_naver: {
    name: 'web_naver',
    async fetch(_event, q, limit, start){
      return naverSearch(q, limit, start);
    }
  },

  web_google: {
    name: 'web_google',
    async fetch(_event, q, limit, start){
      return googleSearch(q, limit, start);
    }
  },

  // Snapshot container placeholder (optional) — currently same as bank for compatibility
  snapshot: {
    name: 'snapshot',
    async fetch(event, q, limit){
      return Containers.search_bank.fetch(event, q, limit);
    }
  },

  ai: {
    name: 'ai',
    async fetch(_event, _q, _limit){
      return null;
    }
  }
};

// Orchestrator
async function orchestrateSearch({ event, q, limit, start }) {
  const collected = [];
  let sourceUsed = null;

  // 0) SEARCH-BANK
  if (cbCanRun('bank')) {
    const b = await Containers.search_bank.fetch(event, q, limit)
      .catch(() => { cbOnFail('bank'); return null; });

    if (b && b.results && b.results.length) {
      cbOnSuccess('bank');
      sourceUsed = sourceUsed || 'search-bank';
      collected.push(...toStandardItems(b.results, 'search-bank'));
    }
  }

  // 1) NAVER
  if (cbCanRun('naver')) {
    let s = start || 1;

    while (collected.length < limit) {
      const batchSize = Math.min(100, limit - collected.length);

      const n = await Containers.web_naver.fetch(event, q, batchSize, s)
        .catch(() => { cbOnFail('naver'); return null; });

      if (!n || !n.results || !n.results.length) break;

      cbOnSuccess('naver');
      sourceUsed = sourceUsed || 'naver';
      collected.push(...toStandardItems(n.results, n.source));

      if (n.results.length < batchSize) break;
      s += batchSize;
    }
  }

  // 2) GOOGLE
  if (collected.length < limit && cbCanRun('google')) {
    let s = start || 1;

    while (collected.length < limit && s <= 91) {
      const batchSize = Math.min(10, limit - collected.length);

      const g = await Containers.web_google.fetch(event, q, batchSize, s)
        .catch(() => { cbOnFail('google'); return null; });

      if (!g || !g.results || !g.results.length) break;

      cbOnSuccess('google');
      sourceUsed = sourceUsed || 'google';
      collected.push(...toStandardItems(g.results, g.source));

      if (g.results.length < batchSize) break;
      s += batchSize;
    }
  }

  if (collected.length > 0) {
    const finalItems = await applyCorePipeline(q, collected.slice(0, limit));
    return { source: sourceUsed, items: finalItems };
  }

  return {
    source: 'fallback',
    items: await applyCorePipeline(q, [{
      title: q,
      summary: 'Loose fallback result',
      source: 'fallback',
      score: 0.01
    }])
  };
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

// ===== CORE PIPELINE APPLY (NON-DESTRUCTIVE) =====
async function applyCorePipeline(query, items) {
  const q = query;

  if (Core && typeof Core.validateQuery === "function") {
    const v = Core.validateQuery(q);
    if (v === false) return [];
    if (v && typeof v === 'object' && v.ok === false) return [];
  }

  let results = Array.isArray(items) ? items : [];

  if (Core && typeof Core.scoreItem === "function" && Array.isArray(results)) {
    results = results.map(it => ({
      ...it,
      _coreScore: Core.scoreItem(q, it)
    })).sort((a, b) => (b._coreScore || 0) - (a._coreScore || 0));
  }

  results = results.map(it => canonicalizeItem(it, q));
  return results;
}

// ===== MAIN HANDLER =====
exports.handler = async function (event) {
  try {
    const { q, limit, start } = pickQ(event);

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

    const base = await orchestrateSearch({ event, q, limit, start });

    return ok({
      status: 'ok',
      engine: 'maru-search',
      version: VERSION,
      query: q,
      source: base.source,
      items: base.items,
      results: base.items,
      meta: { count: (base.items || []).length, limit },
    });

  } catch (e) {
    return fail('Search failed', String((e && e.message) || e));
  }
};

// ===== Internal dispatcher for bridge (non-HTTP call) =====
async function maruSearchDispatcher(req = {}) {
  const q = String(req.q || req.query || "").trim();
  const limit = req.limit;
  const event = { queryStringParameters: { q, limit }, headers: req.headers || {} };
  const res = await exports.handler(event);
  try {
    return JSON.parse(res.body || "{}");
  } catch (e) {
    return { status: "fail", message: "BAD_JSON" };
  }
}

exports.maruSearchDispatcher = maruSearchDispatcher;
