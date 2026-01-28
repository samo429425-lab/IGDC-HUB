/**
 * netlify/functions/maru-search.js
 * A-1 REAL FETCH (NAVER first, GOOGLE fallback) — SCHEMA FIX
 *
 * FIX:
 * - Return BOTH: items[] (standard) and results[] (legacy) so front search.js won't show "No results"
 *
 * Requires env:
 * - NAVER_API_KEY (Naver Client ID)
 * - NAVER_CLIENT_SECRET
 * - (optional) GOOGLE_API_KEY + GOOGLE_CSE_ID
 */

'use strict';


// ===== CORE ENGINE INTEGRATION (EXPAND ONLY) =====
let Core = null;
try {
  Core = require("./core");
} catch (e) {
  Core = null;
}


const VERSION = 'A1.2';
const DEFAULT_LIMIT = 10;

function ok(body) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
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
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, 20);
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
    payload: {}
  }));
}

async function naverSearch(q, limit) {
  const id = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;

  const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(q)}&display=${limit}`;
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
    const n = await naverSearch(q, limit);
    if (n && n.results && n.results.length) {
      const items = toStandardItems(n.results, n.source);
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        query: q,
        source: n.source,
        items,
        results: n.results,   // legacy alias
        meta: { count: items.length, limit },
      });
    }

    // GOOGLE fallback
    const g = await googleSearch(q, limit);
    if (g && g.results && g.results.length) {
      const items = toStandardItems(g.results, g.source);
      return ok({
        status: 'ok',
        engine: 'maru-search',
        version: VERSION,
        query: q,
        source: g.source,
        items,
        results: g.results,   // legacy alias
        meta: { count: items.length, limit },
      });
    }

    if (!n && !g) {
      return fail('Missing env', 'Set NAVER_API_KEY+NAVER_CLIENT_SECRET or GOOGLE_API_KEY+GOOGLE_CSE_ID');
    }

    // configured but empty
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
    const parsed = JSON.parse(res.body || "{}");
    if (parsed && parsed.items) {
      parsed.items = await applyCorePipeline(q, parsed.items);
      parsed.results = parsed.items;
    }
    return parsed;
  } catch (e) {
    return { status: "fail", message: "BAD_JSON" };
  }
}

exports.maruSearchDispatcher = maruSearchDispatcher;


// ===== CORE PIPELINE APPLY (NON-DESTRUCTIVE) =====
async function applyCorePipeline(query, items) {
  let q = query;
  if (Core && typeof Core.validateQuery === "function") {
    if (!Core.validateQuery(q)) {
      return { status: "fail", message: "INVALID_QUERY" };
    }
  }

  let results = items;

  if (Core && typeof Core.scoreItem === "function" && Array.isArray(results)) {
    results = results.map(it => ({
      ...it,
      _coreScore: Core.scoreItem(it),
    })).sort((a,b) => (b._coreScore||0)-(a._coreScore||0));
  }

  return results;
}
