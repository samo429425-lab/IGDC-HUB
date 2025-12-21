// netlify/functions/feed.js
// Maru Platform – Unified Feed & Hybrid Search API (MARU Engine adapter)
//
// Backward compatible with existing automap scripts:
// - returns { sections: [{id,title,items:[]}, ...] } for feed mode
// - supports aliases: distributionhub/socialnetwork/networkhub/homeproducts → distribution/social/network/home
//
// Also supports hybrid search (q=...):
// - returns internal ranked results + external provider links (Google/Bing/Naver)
// - does not require committing secret keys (can be wired later via Netlify env)

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ---------- small utilities ----------
function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) return fallback;
    return safeJsonParse(raw, fallback);
  } catch (e) {
    return fallback;
  }
}

function safeInt(v, def = 10, min = 1, max = 50) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function normalizeQuery(q) {
  const s = (q ?? "").toString().trim();
  if (!s) return { ok: false, code: "INVALID_QUERY", message: "q is required" };
  if (s.length > 200) return { ok: false, code: "QUERY_TOO_LONG", message: "q too long" };
  return { ok: true, value: s };
}

function scoreItem(q, item) {
  const needle = q.toLowerCase();
  const title = (item.title || "").toLowerCase();
  const name = (item.name || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  const section = (item.section || "").toLowerCase();
  let s = 0;
  if (title.includes(needle)) s += 3;
  if (name.includes(needle)) s += 2;
  if (category.includes(needle)) s += 1;
  if (section.includes(needle)) s += 0.5;
  return s;
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function getBaseUrl(event) {
  const h = event.headers || {};
  const proto = (h["x-forwarded-proto"] || h["X-Forwarded-Proto"] || "https").toString();
  const host = (h["x-forwarded-host"] || h["X-Forwarded-Host"] || h.host || h.Host || "").toString();
  if (!host) return null;
  return `${proto}://${host}`;
}

function fetchJson(url, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    try {
      const lib = url.startsWith("https:") ? https : http;
      const req = lib.get(url, { timeout: timeoutMs }, (res) => {
        if (!res || res.statusCode < 200 || res.statusCode >= 300) {
          res?.resume?.();
          return reject(new Error(`HTTP_${res?.statusCode || 0}`));
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(safeJsonParse(data, null)));
      });
      req.on("timeout", () => {
        req.destroy(new Error("TIMEOUT"));
      });
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- feed mode (page sections) ----------
const PAGES_JSON_PATH = path.join(__dirname, "pages.json");
const FUNCTIONS_DATA_DIR = path.join(__dirname, "data");

// external static feed fallbacks (published assets)
const ASSET_FEED_MAP = {
  home: "/assets/data/products_feed.json",
  distribution: "/assets/data/distribution_feed.json",
  donation: "/assets/data/donation_feed.json",
};

const PAGE_ALIAS = {
  // scripts in the platform use these keys
  distributionhub: "distribution",
  socialnetwork: "social",
  networkhub: "network",
  homeproducts: "home",
  // safe aliases
  dist: "distribution",
  sn: "social",
  nw: "network",
};

function getPageKey(raw) {
  const k = (raw || "home").toString().trim().toLowerCase();
  return PAGE_ALIAS[k] || k;
}

function getPageConfig(pageKey) {
  const pagesConfig = safeReadJson(PAGES_JSON_PATH, {});
  if (!pagesConfig || typeof pagesConfig !== "object") return null;
  return pagesConfig[pageKey] || null;
}

/**
 * Support multiple data schemas:
 * A) legacy: { overrides: {sectionId:[...]}, auto:{sectionId:[...]} }
 * B) front style: { sections:[{id,title,items:[...]}], meta, config }
 */
function loadLocalSections(pageKey, pageConfig) {
  // Try legacy name first, then *_front.json (current bundle has *_front.json placeholders)
  const candidates = [
    path.join(FUNCTIONS_DATA_DIR, `${pageKey}.json`),
    path.join(FUNCTIONS_DATA_DIR, `${pageKey}_front.json`),
  ];

  for (const p of candidates) {
    const data = safeReadJson(p, null);
    if (!data) continue;

    // Schema B
    if (data.sections && Array.isArray(data.sections) && data.sections.length) {
      return data.sections.map((s) => ({
        id: (s.id || s.sectionId || "").toString(),
        title: (s.title || "").toString(),
        items: Array.isArray(s.items) ? s.items : (Array.isArray(s.cards) ? s.cards : []),
      }));
    }

    // Schema A
    if ((data.overrides && typeof data.overrides === "object") || (data.auto && typeof data.auto === "object")) {
      const overrides = data.overrides && typeof data.overrides === "object" ? data.overrides : {};
      const auto = data.auto && typeof data.auto === "object" ? data.auto : {};
      const sections = (pageConfig?.sections || []).map((section) => {
        const id = section.id;
        const items = [...(overrides[id] || []), ...(auto[id] || [])];
        return { id, title: section.title || "", items };
      });
      // only accept if at least one section has items
      if (sections.some((s) => Array.isArray(s.items) && s.items.length)) return sections;
    }
  }

  return null;
}

async function loadAssetSections(event, pageKey) {
  const baseUrl = getBaseUrl(event);
  const rel = ASSET_FEED_MAP[pageKey];
  if (!baseUrl || !rel) return null;

  try {
    const data = await fetchJson(`${baseUrl}${rel}`);
    if (!data) return null;

    const sections = (data.sections || data.rows || []);
    if (!Array.isArray(sections) || !sections.length) return null;

    return sections.map((s) => ({
      id: (s.id || s.sectionId || "").toString(),
      title: (s.title || "").toString(),
      items: Array.isArray(s.items) ? s.items : (Array.isArray(s.cards) ? s.cards : []),
    }));
  } catch (_) {
    return null;
  }
}

function emptySectionsFromConfig(pageConfig) {
  const sections = (pageConfig?.sections || []).map((s) => ({
    id: (s.id || "").toString(),
    title: (s.title || "").toString(),
    items: [],
  }));
  return sections;
}

// ---------- search mode (q=...) ----------
async function loadPSOMList(event) {
  // Prefer local copy if later placed under functions/data, else fetch from published asset
  const local = safeReadJson(path.join(FUNCTIONS_DATA_DIR, "psom.json"), null);
  if (Array.isArray(local) && local.length) return local;

  const baseUrl = getBaseUrl(event);
  if (!baseUrl) return [];
  try {
    const remote = await fetchJson(`${baseUrl}/assets/hero/psom.json`);
    return Array.isArray(remote) ? remote : [];
  } catch (_) {
    return [];
  }
}

function buildExternalLinks(q) {
  const enc = encodeURIComponent(q);
  return {
    google: `https://www.google.com/search?q=${enc}`,
    bing: `https://www.bing.com/search?q=${enc}`,
    naver: `https://search.naver.com/search.naver?query=${enc}`,
  };
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};

    // Search mode if q is present
    if (typeof qs.q !== "undefined") {
      const vq = normalizeQuery(qs.q);
      if (!vq.ok) return json(400, { ok: false, error: vq.code, message: vq.message, results: [] });

      const q = vq.value;
      const limit = safeInt(qs.limit, 20, 1, 50);
      const psom = await loadPSOMList(event);

      const scored = psom
        .map((it) => ({ ...it, score: scoreItem(q, it) }))
        .filter((it) => it.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return json(200, {
        ok: true,
        type: "search",
        q,
        limit,
        count: scored.length,
        providers: buildExternalLinks(q),
        results: scored,
        updatedAt: new Date().toISOString(),
      });
    }

    // Feed mode (page)
    const pageKey = getPageKey(qs.page);
    const pageConfig = getPageConfig(pageKey);
    if (!pageConfig) {
      return json(404, { ok: false, error: "PAGE_NOT_FOUND", message: `Unknown page key: ${pageKey}` });
    }

    // 1) local (functions/data) 2) published assets 3) empty from pages.json
    let sections =
      loadLocalSections(pageKey, pageConfig) ||
      (await loadAssetSections(event, pageKey)) ||
      emptySectionsFromConfig(pageConfig);

    // Normalize items arrays
    sections = sections.map((s) => ({
      id: (s.id || "").toString(),
      title: (s.title || "").toString(),
      items: Array.isArray(s.items) ? s.items : [],
    }));

    return json(200, {
      ok: true,
      type: "feed",
      page: pageKey,
      title: pageConfig.title || "",
      sections,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[feed] Unhandled error:", err);
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: "Unexpected error in feed function" });
  }
};
