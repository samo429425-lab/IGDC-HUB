/**
 * MARU Engine Core (v2 - search-bank ready)
 * - Connector → Normalize → Store → Index/Score → Serve
 * - No external deps (Netlify Functions friendly)
 * - Expand-only: keeps API compatible with v1 exports
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

function low(x){ return String(x==null?"":x).trim().toLowerCase(); }
function s(x){ return x==null? "" : String(x); }

/**
 * scoreItem(q, item)
 * - Backward compatible signature
 * - Adds optional quality/trust/dispute/geo/producers signals when present
 */
function scoreItem(q, item) {
  const needle = low(q);
  const title = low(item && item.title);
  const summary = low(item && (item.summary || item.description || ""));
  const tags = Array.isArray(item && item.tags) ? low(item.tags.join(" ")) : "";

  let sc = 0;

  // lexical match (legacy)
  if (needle && title.includes(needle)) sc += 2;
  if (needle && tags.includes(needle)) sc += 1;
  if (needle && summary.includes(needle)) sc += 0.6;

  // producer / geo boost (optional)
  const producerName = low(item && (item.producer && item.producer.name));
  const producerId = low(item && (item.producer && item.producer.id));
  const geo = item && item.geo ? item.geo : null;
  const geoText = geo ? low([geo.country, geo.state, geo.city].filter(Boolean).join(" ")) : "";

  if (needle) {
    if (producerName && producerName.includes(needle)) sc += 1.2;
    if (producerId && producerId.includes(needle)) sc += 0.8;
    if (geoText && geoText.includes(needle)) sc += 0.5;
  }

  // quality (optional; normalized 0..1 preferred)
  const q0 = item && item.quality ? item.quality : null;
  const trust = q0 && typeof q0.trust === "number" ? q0.trust : null;
  const rank = q0 && typeof q0.rank === "number" ? q0.rank : null;
  const freshness = q0 && typeof q0.freshness === "number" ? q0.freshness : null;

  if (trust != null) sc += Math.max(-0.5, Math.min(1.5, trust)) * 0.8;
  if (rank != null) sc += Math.max(0, Math.min(1.5, rank)) * 0.6;
  if (freshness != null) sc += Math.max(0, Math.min(1.5, freshness)) * 0.4;

  // dispute penalties (optional)
  const dp = item && item.dispute_profile ? item.dispute_profile : (item && item.extension && item.extension.dispute_profile) ? item.extension.dispute_profile : null;
  if (dp && typeof dp.refund_rate === "number") sc -= Math.min(1.2, Math.max(0, dp.refund_rate)) * 2.0;
  if (dp && typeof dp.complaint_ratio === "number") sc -= Math.min(1.2, Math.max(0, dp.complaint_ratio)) * 2.4;

  // short-title boost (legacy)
  sc += Math.max(0, 0.2 - (s(item && item.title).length / 1000));

  return sc;
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
 * tieredFetch({ liveProvider, cacheProvider, snapshotProvider })
 */
async function tieredFetch({ liveProvider, cacheProvider, snapshotProvider }) {
  if (typeof liveProvider === "function") {
    try {
      const data = await liveProvider();
      if (data && Array.isArray(data.items)) return { served_from: "live", data };
    } catch (e) {}
  }
  if (typeof cacheProvider === "function") {
    try {
      const data = await cacheProvider();
      if (data && Array.isArray(data.items)) return { served_from: "cache", data };
    } catch (e) {}
  }
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
