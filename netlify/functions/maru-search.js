/**
 * maru-search.js — v1.7 (Stabilized + Minor Upgrade)
 *
 * 목적:
 * - 기존 v1.6 구조 유지 (호환성 100%)
 * - 스코어링/정렬 안정화 (체감 개선)
 * - 중복 제거 강화
 * - 페이징(limit/offset) 지원
 * - 경량 캐시 훅(옵션) 추가
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const SNAPSHOT_PATH = path.join(DATA_DIR, "snapshot.internal.v1.json");
const ALLOWLIST_PATH = path.join(DATA_DIR, "trust.allowlist.json");
const BLOCKLIST_PATH = path.join(DATA_DIR, "trust.blocklist.json");

const CACHE_TTL_MS = Math.max(0, parseInt(process.env.MARU_SEARCH_CACHE_TTL_MS || "0", 10)); // 0=off
const _cache = new Map();

function nowISO() { return new Date().toISOString(); }
function now() { return Date.now(); }

function cacheGet(key) {
  if (!CACHE_TTL_MS) return null;
  const v = _cache.get(key);
  if (!v) return null;
  if (now() - v.t > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return v.v;
}
function cacheSet(key, val) {
  if (!CACHE_TTL_MS) return;
  _cache.set(key, { t: now(), v: val });
}

function safeInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function safeText(s, maxLen) {
  if (typeof s !== "string") return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}
function safeUrl(u) {
  if (typeof u !== "string") return "";
  const t = u.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return "";
  try {
    const url = new URL(t);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch (_) {}
  return "";
}
function uniqueStrings(arr, max = 20, eachMaxLen = 40) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = safeText(String(v), eachMaxLen);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
function safeLoadJson(p, fb) {
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : fb;
  } catch (_) { return fb; }
}
function loadSnapshot() {
  return safeLoadJson(SNAPSHOT_PATH, { items: [], sections: [] });
}

function inferType(raw) {
  const t = safeText(raw?.type || "", 20).toLowerCase();
  if (t) return t;
  const url = String(raw?.url || "");
  const title = String(raw?.title || "");
  const summary = String(raw?.summary || raw?.desc || "");
  const hasImage = !!(raw?.image || raw?.thumb || raw?.thumbnail);
  const hasAudio = /audio|mp3|wav|m4a|podcast/i.test(url) || /오디오|팟캐스트|음성/i.test(title + " " + summary);
  const hasVideo = /youtube|vimeo|video|watch/i.test(url) || /영상|비디오|시청/i.test(title + " " + summary);
  if (hasVideo) return "video";
  if (hasAudio) return "audio";
  if (hasImage) return "image";
  return "text";
}
function normalizeItem(raw = {}) {
  const url = safeUrl(raw.url || "");
  return {
    id: raw.id ? String(raw.id) : null,
    type: inferType(raw),
    title: safeText(raw.title || "", 140),
    summary: safeText(raw.summary || raw.desc || "", 280),
    url,
    provider: safeText(raw.provider || "", 40) || (url ? (new URL(url)).hostname : "internal"),
    tags: uniqueStrings(raw.tags),
    lang: safeText(raw.lang || "all", 8) || "all",
    active: raw.active !== false,
    sectionId: raw.sectionId ? String(raw.sectionId) : null,
    updatedAt: raw.updatedAt || raw.updated || null,
    score: 0
  };
}

function scoreBM25Lite(item, q) {
  if (!q) return 0;
  const query = q.toLowerCase();
  const title = (item.title || "").toLowerCase();
  const summary = (item.summary || "").toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.join(" ").toLowerCase() : "";
  let s = 0;
  if (title.includes(query)) s += 10;
  if (summary.includes(query)) s += 4;
  if (tags.includes(query)) s += 2;
  if (item.type === "video") s += 0.8;
  if (item.type === "audio") s += 0.6;
  if (item.type === "image") s += 0.4;
  if (item.updatedAt) {
    const t = Date.parse(item.updatedAt);
    if (!Number.isNaN(t)) {
      const days = Math.max(1, (Date.now() - t) / (1000 * 3600 * 24));
      s += Math.min(1.5, 1 / Math.log2(days + 1));
    }
  }
  return s;
}

function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store"
  };
}

function parseHostname(u) { try { return new URL(u).hostname.toLowerCase(); } catch (_) { return ""; } }
function tldOf(h) { const p = String(h||"").split(".").filter(Boolean); return p.length>=2 ? p[p.length-1].toLowerCase() : ""; }
function matchAnyPattern(ps, text) {
  if (!Array.isArray(ps) || !text) return false;
  const s = String(text).toLowerCase();
  for (const p of ps) { try { if (new RegExp(String(p), "i").test(s)) return true; } catch (_) {} }
  return false;
}
function isBlockedUrl(u, blocklist) {
  if (!u) return false;
  const host = parseHostname(u);
  if (!host) return false;
  const tld = tldOf(host);
  if (Array.isArray(blocklist?.tlds) && blocklist.tlds.includes(tld)) return true;
  if (Array.isArray(blocklist?.domains)) {
    const ds = blocklist.domains.map(d => String(d).toLowerCase());
    if (ds.includes(host)) return true;
  }
  if (matchAnyPattern(blocklist?.patterns, u)) return true;
  return false;
}
function isAllowedDomain(u, allowlist) {
  if (!u) return false;
  const host = parseHostname(u);
  if (!host) return false;
  const allowed = Array.isArray(allowlist?.domains) ? allowlist.domains.map(d => String(d).toLowerCase()) : [];
  if (!allowed.length) return true;
  return allowed.includes(host) || allowed.some(d => host.endsWith("." + d));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders(), body: "" };

  const params = event.queryStringParameters || {};
  const q = safeText(params.q || "", 180);
  const lang = safeText(params.lang || "all", 8);
  const limit = safeInt(params.limit, 24, 1, 60);
  const offset = safeInt(params.offset, 0, 0, 1000);
  const scope = safeText(params.scope || "all", 20) || "all";
  const quality = safeText(params.quality || "standard", 20) || "standard";

  const cacheKey = JSON.stringify({ q, lang, limit, offset, scope, quality });
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const snapshot = loadSnapshot();
  const allowlist = safeLoadJson(ALLOWLIST_PATH, { domains: [] });
  const blocklist = safeLoadJson(BLOCKLIST_PATH, { domains: [], tlds: [], patterns: [] });

  const base = []
    .concat(Array.isArray(snapshot.items) ? snapshot.items : [])
    .concat(Array.isArray(snapshot.sections) ? snapshot.sections.flatMap(s => s.items || s.cards || []) : []);

  let items = base.map(normalizeItem).filter(i => i.active !== false);

  if (lang !== "all") items = items.filter(i => !i.lang || i.lang === "all" || i.lang === lang);

  items = items.filter(i => !i.url || (!isBlockedUrl(i.url, blocklist) && isAllowedDomain(i.url, allowlist)));

  let scored = q ? items.map(i => ({ ...i, score: scoreBM25Lite(i, q) })).filter(i => i.score > 0) : items;

  const seen = new Set();
  const deduped = [];
  for (const it of scored.sort((a,b)=>b.score-a.score)) {
    const key = it.url || (it.title||"").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  const paged = deduped.slice(offset, offset + limit);

  const res = {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      meta: {
        engine: "maru-search",
        version: "1.7",
        mode: q ? "search" : "recommend",
        query: q,
        scope,
        quality,
        lang,
        offset,
        limit,
        count: paged.length,
        total: deduped.length,
        updated: nowISO()
      },
      items: paged
    })
  };

  cacheSet(cacheKey, res);
  return res;
};
