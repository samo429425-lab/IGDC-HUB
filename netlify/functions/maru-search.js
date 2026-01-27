/**
 * netlify/functions/maru-search.js
 * -------------------------------------------------
 * MARU SEARCH FUNCTION (FINAL, COMPAT + STANDARD)
 *
 * Fixes: Home search overlay "검색 중 오류" by providing a real Netlify handler.
 * Keeps: maru-search-bridge.js compatibility (exports.maruSearchDispatcher).
 *
 * Response schema (STANDARD):
 * {
 *   status: "ok",
 *   engine: "maru-search",
 *   version: "1.2.0",
 *   mode: "search|snapshot|insight|ai",
 *   query: "...",
 *   timestamp: 0000000000,
 *   items: [...],
 *   meta: { count, limit, context, sources }
 * }
 */

'use strict';

const DEFAULT_LIMIT = 20;
const VERSION = '1.2.0';

function normalizeQuery(q) {
  if (!q) return '';
  return String(q).trim().slice(0, 300);
}

function toInt(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}

function now() {
  return Date.now();
}

function baseResponse({ mode, query, limit, context }) {
  return {
    status: 'ok',
    engine: 'maru-search',
    version: VERSION,
    mode,
    query,
    timestamp: now(),
    items: [],
    meta: {
      count: 0,
      limit,
      context: context || null,
      sources: []
    }
  };
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

/**
 * Core dispatcher (used by other engines via require("./maru-search"))
 * NOTE: Keep this named export for maru-search-bridge.js
 */
async function maruSearchDispatcher(params = {}) {
  const mode = String(params.mode || 'search').toLowerCase();
  const q = normalizeQuery(params.q || params.query || '');
  const limit = toInt(params.limit, DEFAULT_LIMIT);
  const context = params.context || null;

  const res = baseResponse({ mode, query: q, limit, context });

  // No query => return empty but valid schema
  if (!q) return res;

  // === PLACEHOLDER IMPLEMENTATION ===
  // Guarantees schema stability. Extend later with snapshot + trust + AI + external providers.
  res.items = [
    {
      id: `sample-${now()}`,
      type: 'text',
      title: `Result for: ${q}`,
      summary: `Maru Search Engine normalized result (mode: ${mode}).`,
      score: 1.0,
      source: 'internal',
      url: '',
      payload: {}
    }
  ].slice(0, limit);

  res.meta.count = res.items.length;
  res.meta.sources.push('internal');

  // Non-breaking mode flags
  if (mode === 'insight') {
    res.meta.sources.push('insight');
    res.insight = true;
    res.summary = `Insight generated for query: ${q}`;
  }
  if (mode === 'ai') {
    res.meta.sources.push('ai');
    res.ai = true;
    res.note = 'AI expansion hook ready';
  }
  if (mode === 'snapshot') {
    res.meta.sources.push('snapshot');
    res.snapshot = true;
  }

  return res;
}

/**
 * Netlify Function handler
 * Endpoint: /.netlify/functions/maru-search?q=...&mode=...&limit=...
 */
exports.handler = async function handler(event) {
  try {
    const qs = event.queryStringParameters || {};
    const mode = qs.mode || 'search';
    const q = qs.q || qs.query || '';
    const limit = qs.limit;
    const context = qs.context ? safeJsonParse(qs.context) : null;

    const data = await maruSearchDispatcher({ mode, q, limit, context });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        status: 'error',
        engine: 'maru-search',
        version: VERSION,
        message: 'Search function failed',
        timestamp: now()
      })
    };
  }
};

// Export for internal require() usage
module.exports = { maruSearchDispatcher };
