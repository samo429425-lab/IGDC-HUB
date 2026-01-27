/**
 * netlify/functions/maru-search.js
 * -------------------------------------------------
 * MARU SEARCH FUNCTION (FIXED EXPORTS)
 *
 * Fix:
 * - Do NOT overwrite module.exports after defining exports.handler
 * - Export BOTH: handler + maruSearchDispatcher
 *
 * Overlay endpoint:
 *   /.netlify/functions/maru-search?q=...&scope=...&quality=...
 *
 * Returns STANDARD:
 *   { status:'ok', items:[...], meta:{...} }
 */

'use strict';

const DEFAULT_LIMIT = 20;
const VERSION = '1.2.1';

function normalizeQuery(q) {
  if (!q) return '';
  return String(q).trim().slice(0, 300);
}
function toInt(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}
function now() { return Date.now(); }
function safeJsonParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

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

/** Core dispatcher (used by maru-search-bridge.js / global-insight-engine) */
async function maruSearchDispatcher(params = {}) {
  const mode = String(params.mode || 'search').toLowerCase();
  const q = normalizeQuery(params.q || params.query || '');
  const limit = toInt(params.limit, DEFAULT_LIMIT);
  const context = params.context || null;

  const res = baseResponse({ mode, query: q, limit, context });
  if (!q) return res;

  // Placeholder result (schema-stable)
  res.items = [
    {
      id: `sample-${now()}`,
      type: 'text',
      title: `Result for: ${q}`,
      summary: `Maru Search Engine normalized result (mode: ${mode}).`,
      score: 1.0,
      source: 'internal',
      url: '',
      payload: { scope: params.scope || null, quality: params.quality || null }
    }
  ].slice(0, limit);

  res.meta.count = res.items.length;
  res.meta.sources.push('internal');

  return res;
}

/** Netlify Function handler */
async function handler(event) {
  try {
    const qs = event.queryStringParameters || {};
    const mode = qs.mode || 'search';
    const q = qs.q || qs.query || '';
    const limit = qs.limit;
    const context = qs.context ? safeJsonParse(qs.context) : null;

    // pass-through optional params so we can introspect later
    const scope = qs.scope || null;
    const quality = qs.quality || null;

    const data = await maruSearchDispatcher({ mode, q, limit, context, scope, quality });

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
      statusCode: 500,
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
}

exports.handler = handler;
exports.maruSearchDispatcher = maruSearchDispatcher;
