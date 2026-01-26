/**
 * maru-search-bridge.js
 * ---------------------------------------------
 * Bridge between maru-global-insight-engine
 * and maru-search core.
 *
 * Netlify Functions safe.
 */

const { maruSearchDispatcher } = require("./maru-search");

async function callMaruSearch(params = {}) {
  return maruSearchDispatcher({
    mode: params.mode || "search",
    q: params.q || params.query || "",
    limit: params.limit,
    context: params.context || null
  });
}

module.exports = {
  callMaruSearch
};
