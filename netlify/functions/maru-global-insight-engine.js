
/**
 * maru-global-insight-engine.js
 * ------------------------------------------------------------
 * MARU Global Insight Engine (Upgraded / Expanded Edition)
 *
 * ROLE:
 * - Central orchestrator between:
 *   maru-search  →  insight logic  →  core engine
 *
 * PRINCIPLES:
 * - Expand-only (no feature removal)
 * - Backward compatible
 * - Future-ready
 */

"use strict";

// -------------------------------------------------------------
// Dependencies (Safe Load)
// -------------------------------------------------------------
let Core = null;
try {
  Core = require("./core");
} catch (e) {
  Core = null;
}

let Bridge = null;
try {
  Bridge = require("./maru-search-bridge");
} catch (e) {
  Bridge = null;
}

// -------------------------------------------------------------
// Utility
// -------------------------------------------------------------
function normalizeQuery(q) {
  if (!q) return "";
  return String(q).trim();
}

// -------------------------------------------------------------
// MAIN INSIGHT PIPELINE
// -------------------------------------------------------------
async function runGlobalInsight(params = {}) {
  const query = normalizeQuery(params.q || params.query);
  const mode = params.mode || "search";

  if (!query && mode === "search") {
    return { status: "fail", message: "EMPTY_QUERY" };
  }

  // ---------------------------------------------------------
  // 1) MARU SEARCH (Central Processing)
  // ---------------------------------------------------------
  let searchResult = null;
  if (Bridge && typeof Bridge.dispatch === "function") {
    searchResult = await Bridge.dispatch({ q: query, mode });
  } else {
    return { status: "fail", message: "SEARCH_BRIDGE_UNAVAILABLE" };
  }

  // ---------------------------------------------------------
  // 2) CORE ENGINE (Optional Enrichment)
  // ---------------------------------------------------------
  let enriched = searchResult;
  if (Core && typeof Core.validateQuery === "function") {
    const valid = Core.validateQuery(query);
    if (!valid) {
      return { status: "fail", message: "INVALID_QUERY" };
    }
  }

  if (Core && typeof Core.normalizeResult === "function") {
    enriched = Core.normalizeResult(searchResult);
  }

  // ---------------------------------------------------------
  // 3) GLOBAL INSIGHT WRAP
  // ---------------------------------------------------------
  return {
    status: "ok",
    engine: "maru-global-insight",
    timestamp: Date.now(),
    query,
    mode,
    data: enriched,
  };
}

// -------------------------------------------------------------
// HTTP HANDLER (Netlify / External)
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// INTERNAL EXPORT (Engine-to-Engine)
// -------------------------------------------------------------
exports.runGlobalInsight = runGlobalInsight;
