/**
 * maru-search-bridge.js
 * ------------------------------------------------------------
 * CANONICAL v2 Bridge (CommonJS)
 * - For Netlify / Node runtime
 * - For maru-global-insight-engine and others
 */
const { maruSearchDispatcher } = require("./maru-search");

async function callMaruSearch(params = {}) {
  return maruSearchDispatcher({
    mode: params.mode || "search",
    q: params.q || params.query || "",
    limit: params.limit,
    context: params.context || null,
    headers: params.headers || null
  });
}

/**
 * dispatch(payload)
 * Accepts either:
 * - { query, options }
 * - { q, mode, limit, context }
 */
function dispatch(payload = {}) {
  const query = (payload.query || payload.q || "").trim();
  if (!query) {
    return Promise.resolve({ ok: false, error: "INVALID_PAYLOAD" });
  }

  const merged = { ...(payload.options || {}), ...payload };
  delete merged.options;

  return callMaruSearch({
    query,
    mode: merged.mode,
    limit: merged.limit,
    context: merged.context,
    headers: merged.headers
  });
}

module.exports = { callMaruSearch, dispatch };
