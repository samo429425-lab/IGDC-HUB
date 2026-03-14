/**
 * MARU Engine Core (v1)
 * - Connector → Normalize → Store → Index/Score → Serve
 * - No external deps (Netlify Functions friendly)
 */
const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function requestId() {
  return crypto.randomBytes(12).toString("hex");
}

/** Basic allowlist-based input validation (defensive) */
function validateQuery(q) {
  if (typeof q !== "string") return { ok: false, code: "BAD_QUERY", message: "q must be string" };
  const qq = q.trim();
  if (!qq) return { ok: false, code: "BAD_QUERY", message: "q is empty" };
  if (qq.length > 200) return { ok: false, code: "BAD_QUERY", message: "q too long" };
  // block obvious injection primitives for safety (not exhaustive)
  if (/[<>`$\\]/.test(qq)) return { ok: false, code: "BAD_QUERY", message: "q contains disallowed chars" };
  return { ok: true, value: qq };
}

function safeInt(n, d, min, max) {
  const x = Number.isFinite(Number(n)) ? Number(n) : d;
  return Math.min(max, Math.max(min, Math.trunc(x)));
}

/**
 * Simple internal index scorer.
 * This is a placeholder scoring model; swap with BM25/vector later without breaking API.
 */
function scoreItem(q, item) {
  const needle = q.toLowerCase();
  const title = (item.title || "").toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.join(" ").toLowerCase() : "";
  let s = 0;
  if (title.includes(needle)) s += 2;
  if (tags.includes(needle)) s += 1;
  // short boost
  s += Math.max(0, 0.2 - (title.length / 1000));
  return s;
}

/**
 * normalizeResult(res)
 * - 엔진 응답 형태를 { items: [] } 중심으로 정규화
 */
function normalizeResult(res) {
  if (!res || typeof res !== "object") return res;

  if (Array.isArray(res.items)) return res;
  if (res.data && Array.isArray(res.data.items)) return res.data;

  if (res.baseResult && Array.isArray(res.baseResult.items)) return res.baseResult;
  if (res.baseResult?.data && Array.isArray(res.baseResult.data.items)) return res.baseResult.data;

  if (Array.isArray(res.results)) return { ...res, items: res.results };

  return res;
}

/**
 * Store layer (in-memory per invocation). For Netlify, real cache/snapshot is on disk or KV.
 * We implement a tiered fetch:
 *  - liveProvider(): live (optional)
 *  - cacheProvider(): cache (optional)
 *  - snapshotProvider(): snapshot (required)
 */
async function tieredFetch({ liveProvider, cacheProvider, snapshotProvider }) {
  // live
  if (typeof liveProvider === "function") {
    try {
      const data = await liveProvider();
      if (data && Array.isArray(data.items)) return { served_from: "live", data };
    } catch (e) {}
  }
  // cache
  if (typeof cacheProvider === "function") {
    try {
      const data = await cacheProvider();
      if (data && Array.isArray(data.items)) return { served_from: "cache", data };
    } catch (e) {}
  }
  // snapshot (must exist)
  const data = await snapshotProvider();
  return { served_from: "snapshot", data };
}

module.exports = {
  nowIso,
  requestId,
  validateQuery,
  safeInt,
  scoreItem,
  normalizeResult,
  tieredFetch,
};

/* ===== MARU CORE EXTENSION LAYER (SANMARU READY) ===== */
const CORE = module.exports || {};


/* ===== ENGINE REGISTRY ===== */
CORE.engineRegistry = {
  engines: new Map(),

  register(name, engine) {
    if (!name || !engine) return;
    this.engines.set(name, engine);
  },

  get(name) {
    return this.engines.get(name);
  },

  list() {
    return Array.from(this.engines.keys());
  }
};


/* ===== GLOBAL ENGINE BUS ===== */
CORE.engineBus = {
  listeners: new Map(),

  on(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(fn);
  },

emit: async function(event, payload) {
  const list = this.listeners.get(event) || [];

  for (const fn of list) {
    try {
      await fn(payload);
    } catch (e) {}
  }
 }
};


/* ===== AI ADAPTER ===== */
CORE.aiAdapter = {

  normalizeAIResult(res) {
    if (!res) return [];

    if (Array.isArray(res)) return res;

    if (res.items && Array.isArray(res.items)) {
      return res.items;
    }

    return [res];
  },

  mergeResults(searchResults = [], aiResults = []) {

    const merged = [
      ...(searchResults || []),
      ...(aiResults || [])
    ];

    const seen = new Set();
    const out = [];

    for (const it of merged) {
      const key = (it.url || it.title || "").toLowerCase();
      if (!key) continue;
      if (seen.has(key)) continue;

      seen.add(key);
      out.push(it);
    }

    return out;
  }

};


/* ===== TRUST LAYER ===== */
CORE.trustLayer = {

  trustScore(item) {

    let score = 1;

    if (typeof item.sourceTrust === "number") {
      score *= item.sourceTrust;
    }

    if (typeof item.deepfakeRisk === "number") {
      score *= (1 - item.deepfakeRisk);
    }

    if (typeof item.manipulationRisk === "number") {
      score *= (1 - item.manipulationRisk);
    }

    return score;
  }

};


/* ===== FEDERATION ROUTER ===== */
CORE.federation = {

  async route(query, engines = []) {

    const tasks = [];

    for (const name of engines) {

      const engine = CORE.engineRegistry.get(name);

      if (!engine || typeof engine.search !== "function") {
        continue;
      }

      try {
        tasks.push(engine.search(query));
      } catch (e) {}
    }

    const results = await Promise.allSettled(tasks);

    const items = [];

    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        items.push(...r.value);
      }
    }

    return items;
  }

};


/* ===== PLUGIN SYSTEM ===== */
CORE.plugins = {

  list: [],

  load(plugin) {

    if (!plugin) return;

    this.list.push(plugin);

    if (typeof plugin.init === "function") {
      try {
        plugin.init(CORE);
      } catch (e) {}
    }
  }

};


module.exports = CORE;