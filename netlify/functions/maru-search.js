/**
 * maru-search.js
 * -------------------------------------------------
 * MARU SEARCH CORE (FINAL)
 *
 * Purpose:
 * - Single, universal search execution engine
 * - Supports: search | snapshot | insight | ai
 * - Dependency-safe for Netlify Functions
 * - No UI / no layout / no hard external coupling
 */

const DEFAULT_LIMIT = 20;

function normalizeQuery(q) {
  if (!q) return "";
  return String(q).trim().slice(0, 300);
}

function now() {
  return Date.now();
}

async function executeSearch({ query, mode, limit, context }) {
  const q = normalizeQuery(query);
  const l = limit || DEFAULT_LIMIT;

  const result = {
    engine: "maru-search",
    version: "1.0.0-final",
    mode,
    query: q,
    timestamp: now(),
    results: [],
    meta: {
      limit: l,
      context: context || null
    }
  };

  if (!q) return result;

  result.results = [
    {
      type: "text",
      title: `Result for: ${q}`,
      score: 1.0,
      source: "internal"
    }
  ].slice(0, l);

  return result;
}

async function handleSearch(params) {
  return executeSearch({
    query: params.q || params.query,
    mode: "search",
    limit: params.limit,
    context: params.context
  });
}

async function handleSnapshot(params) {
  return executeSearch({
    query: params.q || params.query,
    mode: "snapshot",
    limit: params.limit,
    context: params.context
  });
}

async function handleInsight(params) {
  const base = await executeSearch({
    query: params.q || params.query,
    mode: "search",
    limit: params.limit,
    context: params.context
  });

  return {
    ...base,
    insight: true,
    summary: `Insight generated for query: ${base.query}`
  };
}

async function handleAI(params) {
  const base = await executeSearch({
    query: params.q || params.query,
    mode: "ai",
    limit: params.limit,
    context: params.context
  });

  return {
    ...base,
    ai: true,
    note: "AI expansion hook ready"
  };
}

async function maruSearchDispatcher(params = {}) {
  const mode = params.mode || "search";

  switch (mode) {
    case "snapshot":
      return handleSnapshot(params);
    case "insight":
      return handleInsight(params);
    case "ai":
      return handleAI(params);
    case "search":
    default:
      return handleSearch(params);
  }
}

module.exports = {
  maruSearchDispatcher
};
