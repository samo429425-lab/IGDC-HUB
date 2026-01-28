/**
 * netlify/functions/maru-search.js
 * ------------------------------------------------------------
 * MARU SEARCH — BUILD-FIX CANONICAL (Fan-out ready, syntax-safe)
 *
 * 목적:
 * - Netlify 번들링 실패(Unexpected "try")를 일으키는 깨진 삽입/훅 제거
 * - 기존 파이프라인 유지: exports.handler / exports.maruSearchDispatcher / items+results
 * - 확장만: core scoring 적용 유지
 */

'use strict';

// ===== CORE ENGINE INTEGRATION (EXPAND ONLY) =====
let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

const VERSION = 'A1.3-buildfix';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100; // 프론트 제한 해제 대응 (엔진은 더 받을 수 있게)

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
  return { q, limit };
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, '');
}

function toStandardItems(arr, source) {
  return (Array.isArray(arr) ? arr : []).map((r, idx) => ({
    id: r.link || r.url || r.title || `${source}-${idx}`,
    type: r.type || 'web',
    title: r.title || '',
    summary: r.snippet || r.summary || '',
    url: r.link || r.url || '',
    source,
    score: 0.9,
    payload: r.payload || {}
  }));
}

async function naverSearch(q, limit) {
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;

  const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(q)}&display=${Math.min(limit, 100)}`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
    },
  });

  if (!res.ok) throw new Error(`NAVER_HTTP_${res.status}`);
  const data = await res.json();

  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map(it => ({
    title: stripHtml(it.title),
    link: it.link || '',
    snippet: stripHtml(it.description),
    type: 'web'
  }));

  return { source: 'naver', results };
}

async function googleSearch(q, limit) {
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return null;

  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=${Math.min(limit, 10)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GOOGLE_HTTP_${res.status}`);
  const data = await res.json();

  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map(it => ({
    title: it.title || '',
    link: it.link || '',
    snippet: it.snippet || '',
    type: 'web'
  }));

  return { source: 'google', results };
}

// ===== CORE PIPELINE APPLY (NON-DESTRUCTIVE) =====
async function applyCorePipeline(query, items) {
  const q = query;

  if (Core && typeof Core.validateQuery === "function") {
    if (!Core.validateQuery(q)) {
      return [];
    }
  }

  let results = items;

  if (Core && typeof Core.scoreItem === "function" && Array.isArray(results)) {
    results = results.map(it => ({
      ...it,
      _coreScore: Core.scoreItem(it),
    })).sort((a, b) => (b._coreScore || 0) - (a._coreScore || 0));
  }

  return results;
}

exports.handler = async function (event) {
  try {
    const { q, limit } = pickQ(event);

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

    // NAVER first
    const n = await naverSearch(q, limit).catch(() => null);
    if (n && n.results && n.results.length) {
      let items = toStandardItems(n.results, n.source);
      items = await applyCorePipeline(q, items);
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        query: q,
        source: n.source,
        items,
        results: items, // legacy alias: keep same shape
        meta: { count: items.length, limit },
      });
    }

    // GOOGLE fallback
    const g = await googleSearch(q, limit).catch(() => null);
    if (g && g.results && g.results.length) {
      let items = toStandardItems(g.results, g.source);
      items = await applyCorePipeline(q, items);
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        query: q,
        source: g.source,
        items,
        results: items, // legacy alias
        meta: { count: items.length, limit },
      });
    }

    if (!n && !g) {
      return fail('Missing env', 'Set NAVER_API_KEY+NAVER_CLIENT_SECRET or GOOGLE_API_KEY+GOOGLE_CSE_ID');
    }

    return ok({
      status: 'ok',
      engine: 'maru-search',
      version: VERSION,
      query: q,
      source: (n ? 'naver' : 'google'),
      items: [],
      results: [],
      meta: { count: 0, limit },
    });

  } catch (e) {
    return fail('Search failed', String((e && e.message) || e));
  }
};

// ===== Internal dispatcher for bridge (non-HTTP call) =====
async function maruSearchDispatcher(req = {}) {
  const q = String(req.q || req.query || "").trim();
  const limit = req.limit;
  const event = { queryStringParameters: { q, limit } };
  const res = await exports.handler(event);
  try {
    return JSON.parse(res.body || "{}");
  } catch (e) {
    return { status: "fail", message: "BAD_JSON" };
  }
}

exports.maruSearchDispatcher = maruSearchDispatcher;
