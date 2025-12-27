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
  tieredFetch,
};
