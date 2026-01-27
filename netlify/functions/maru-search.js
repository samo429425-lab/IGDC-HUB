/**
 * netlify/functions/maru-search.js
 * A-1 REAL FETCH (NAVER first, GOOGLE fallback)
 *
 * Requires Netlify env:
 * - NAVER_API_KEY
 * - NAVER_CLIENT_SECRET
 * - GOOGLE_API_KEY
 * - GOOGLE_CSE_ID   (Custom Search Engine cx)
 *
 * Output (simple):
 * { status:'ok', query:'...', source:'naver|google', results:[{title,link,snippet}] }
 */

'use strict';

const VERSION = 'A1.1';
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
  }));

  return { source: 'google', results };
}

exports.handler = async function(event) {
  try {
    const { q, limit } = pickQ(event);
    if (!q) return ok({ status: 'ok', query: q, source: null, results: [], meta: { count: 0, limit } });

    // NAVER first
    const n = await naverSearch(q, limit);
    if (n && n.results && n.results.length) {
      return ok({ status: 'ok', engine: 'maru-search', version: VERSION, query: q, source: n.source, results: n.results, meta: { count: n.results.length, limit } });
    }

    // GOOGLE fallback
    const g = await googleSearch(q, limit);
    if (g && g.results && g.results.length) {
      return ok({ status: 'ok', engine: 'maru-search', version: VERSION, query: q, source: g.source, results: g.results, meta: { count: g.results.length, limit } });
    }

    // If both not configured or no results
    if (!n && !g) {
      return fail('Missing env', 'Set NAVER_API_KEY+NAVER_CLIENT_SECRET or GOOGLE_API_KEY+GOOGLE_CSE_ID');
    }

    return ok({ status: 'ok', engine: 'maru-search', version: VERSION, query: q, source: (n ? 'naver' : 'google'), results: [], meta: { count: 0, limit } });

  } catch (e) {
    return fail('Search failed', String(e && e.message || e));
  }
};
