/**
 * maru-global-insight-engine.js
 * --------------------------------------------
 * Always-on Global Insight Engine (FINAL)
 *
 * Role:
 * - Core-linked, always-on orchestration layer
 * - Central decision hub for search/snapshot/insight
 * - Delegates execution to maru-search
 */

const { callMaruSearch } = require("./maru-search-bridge");

let initialized = false;

const InsightEngine = {
  version: "1.0.0",
  status: "idle",
  bootTime: null,

  init() {
    if (initialized) return;
    initialized = true;
    this.status = "ready";
    this.bootTime = Date.now();
  },

  async dispatch(req = {}) {
    const mode = req.mode || "search";
    const params = req.params || {};

    switch (mode) {
      case "search":
        return this.handleSearch(params);
      case "snapshot":
        return this.handleSnapshot(params);
      case "insight":
        return this.handleInsight(params);
      default:
        return this.handleSearch(params);
    }
  },

  async handleSearch(params) {
    return callMaruSearch({
      ...params,
      mode: "search"
    });
  },

  async handleSnapshot(params) {
    return callMaruSearch({
      ...params,
      mode: "snapshot"
    });
  },

  async handleInsight(params) {
    const baseResult = await callMaruSearch({
      ...params,
      mode: "search"
    });

    return {
      insight: true,
      source: "maru-global-insight-engine",
      baseResult
    };
  }
};

InsightEngine.init();

module.exports = InsightEngine;
