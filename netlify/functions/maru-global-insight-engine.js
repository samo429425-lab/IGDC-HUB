/**
 * maru-global-insight-engine.js
 * ------------------------------------------------------------
 * MARU Global Insight Engine (Expanded Edition)
 * - Orchestrator between maru-search → insight logic → core engine
 * - Backward compatible / expand-only
 */
"use strict";

let Core = null;
try { Core = require("./core"); } catch (e) { Core = null; }

let Bridge = null;
try { Bridge = require("./maru-search-bridge"); } catch (e) { Bridge = null; }

function normalizeQuery(q) {
  if (!q) return "";
  return String(q).trim();
}

async function runGlobalInsight(params = {}) {
  const query = normalizeQuery(params.q || params.query);
  const mode = params.mode || "search";

  if (!query && mode === "search") {
    return { status: "fail", message: "EMPTY_QUERY" };
  }

  let searchResult = null;
  if (Bridge && typeof Bridge.dispatch === "function") {
    searchResult = await Bridge.dispatch({
      q: query,
      mode,
      limit: params.limit || 20
    });
  } else {
    return { status: "fail", message: "SEARCH_BRIDGE_UNAVAILABLE" };
  }

  let enriched = searchResult;

  if (Core && typeof Core.validateQuery === "function") {
    const valid = Core.validateQuery(query);
    if (!valid || valid.ok === false) {
      return { status: "fail", message: "INVALID_QUERY" };
    }
  }

  if (Core && typeof Core.normalizeResult === "function") {
    enriched = Core.normalizeResult(searchResult);
  }

  return {
    status: "ok",
    engine: "maru-global-insight",
    timestamp: Date.now(),
    query,
    mode,
    data: enriched,
  };
}

exports.handler = async function (event) {
  try {
    const params = event.queryStringParameters || {};
    const res = await runGlobalInsight(params);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(res),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: "fail", message: e.message }),
    };
  }
};

exports.runGlobalInsight = runGlobalInsight;
