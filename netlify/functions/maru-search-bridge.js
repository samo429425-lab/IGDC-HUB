/**
 * maru-search-bridge.js
 * ------------------------------------------------------------
 * CANONICAL v2 Bridge (CommonJS)
 * - For Netlify / Node runtime
 * - For maru-global-insight-engine and others
 */
const maruSearch = require("./maru-search");

async function callMaruSearch(params = {}) {
 return maruSearch.runEngine(null,{
  q: params.q || params.query || "",
  limit: params.limit,
  mode: params.mode || "search"
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

function runEngine(event, params = {}) {
  return callMaruSearch({
    q: params.q || params.query || "",
    mode: params.mode || "search",
    limit: params.limit,
    context: params.context || null,
    headers: event?.headers || null
  });
}

module.exports = { callMaruSearch, dispatch, runEngine };
